import { buildMiniLanes, loadScenario } from './build';
import { createClockHost, type ClockHost } from './host';
import type {
  LaneFrame,
  LaneFrameKind,
  LanesAction,
  LanesFiber,
  LanesScenario,
  MiniLanes,
  TaskRow,
  TimelineSegment,
  WipRow,
} from './types';

/**
 * Живой прогон мини-реализации с протоколом.
 *
 * Здесь нет заготовленных кадров. Сессия исполняет код темы на сценарии читателя и после
 * каждого события снимает снимок: планировщик начал квант, цикл взял компонент, квант кончился,
 * начатое дерево выброшено, коммит. Протокол растёт по мере того, как читатель шагает: шаг
 * за последним кадром выполняет **следующий колбэк хоста** — одну микрозадачу или одну
 * макрозадачу. Поэтому срочный ввод можно «нажать» ровно между двумя квантами перехода
 * и увидеть, как начатое дерево выбрасывается.
 *
 * Время — виртуальное: его двигает только `work(ms)` в компонентах сценария. Прогон
 * детерминирован и одинаков у читателя, в тесте и на любой машине.
 *
 * Протокол — обычные массивы, а не реактивное состояние: запись идёт из глубины кода темы,
 * и компонент получает её одним присваиванием, когда шаг закончился.
 */

export interface LanesSession {
  frames: LaneFrame[];
  logs: string[];
  /** Выполнить действие сценария; возвращает номер первого нового кадра. */
  fire: (action: LanesAction) => number;
  /** Выполнить один колбэк хоста; `-1` — работы нет. */
  step: () => number;
  hasWork: () => boolean;
  clock: ClockHost;
  mini: MiniLanes;
}

const LANE_NAMES: Array<[number, string]> = [
  [2, 'SyncLane'],
  [8, 'InputContinuousLane'],
  [32, 'DefaultLane'],
  [256, 'TransitionLane'],
  [4194304, 'RetryLane'],
];

export function laneName(lanes: number): string {
  if (!lanes) return 'NoLanes';
  const names = LANE_NAMES.filter(([bit]) => lanes & bit).map(([, name]) => name);
  return names.length ? names.join(' | ') : String(lanes);
}

const PRIORITY_NAMES: Record<number, string> = { 1: 'Immediate', 2: 'UserBlocking', 3: 'Normal' };

export function fiberLabel(fiber: LanesFiber): string {
  const type = fiber.type as { name?: string } | null;
  const name = type?.name ?? '?';
  if (name === 'Suspense') return fiber.didSuspend ? 'Suspense · заглушка' : 'Suspense';
  const props = fiber.props ?? {};
  const arg = props.i ?? props.n;
  return arg === undefined ? name : `${name} ${String(arg)}`;
}

/** Компоненты — то, что читатель узнаёт в сценарии; узлы хоста и текст в ленте не нужны. */
const isComponent = (fiber: LanesFiber) =>
  typeof fiber.type === 'function' || (fiber.type as { name?: string } | null)?.name === 'Suspense';

export function createSession(code: string, scenario: LanesScenario): LanesSession {
  const frames: LaneFrame[] = [];
  const logs: string[] = [];
  const segments: TimelineSegment[] = [];
  const performed = new WeakSet<object>();
  let open: TimelineSegment | null = null;
  let attempt = 0;
  let calls = 0;
  let commits = 0;
  let restarts = 0;
  let committedNow = false;
  let commitLane = 0;
  // Появятся после сборки; до неё снимков не бывает.
  let mini: MiniLanes | null = null;
  let clock: ClockHost | null = null;

  const wipRows = (): WipRow[] => {
    const state = mini!.inspect();
    const rows: WipRow[] = [];
    let nextFound = false;
    const walk = (fiber: LanesFiber, depth: number) => {
      let childDepth = depth;
      if (isComponent(fiber)) {
        let rowState: WipRow['state'] = performed.has(fiber) ? 'done' : 'todo';
        if (rowState === 'todo' && !nextFound && state.workInProgress) {
          rowState = 'next';
          nextFound = true;
        }
        rows.push({ label: fiberLabel(fiber), depth, state: rowState });
        childDepth = depth + 1;
      }
      for (let child = fiber.child; child; child = child.sibling) walk(child, childDepth);
    };
    if (state.wipRoot) walk(state.wipRoot, 0);
    return rows;
  };

  const taskRows = (): TaskRow[] =>
    mini!
      .inspect()
      .taskQueue.filter((task) => task.callback !== null)
      .map((task) => ({
        id: task.id,
        priority: PRIORITY_NAMES[task.priority] ?? String(task.priority),
        expires: task.expirationTime,
        what: task.callback!.name || 'задача',
      }));

  const snap = (kind: LaneFrameKind, text: string) => {
    if (!mini || !clock) return;
    const state = mini.inspect();
    const now = clock.time();
    const shown = segments.map((segment) => ({ ...segment }));
    if (open) shown.push({ ...open, to: now });
    frames.push({
      kind,
      text,
      time: now,
      pending: state.root.pendingLanes,
      suspended: state.root.suspendedLanes,
      expired: state.root.expiredLanes,
      expirationTimes: { ...state.root.expirationTimes },
      renderLane: state.wipRoot ? state.wipRootLanes : 0,
      wip: wipRows(),
      tasks: taskRows(),
      micro: clock.micro(),
      html: clock.markup(),
      logs: logs.length,
      segments: shown,
      calls,
      commits,
      restarts,
    });
  };

  const markAttempt = (id: number, outcome: TimelineSegment['outcome']) => {
    for (const segment of segments) if (segment.attempt === id) segment.outcome = outcome;
    if (open && open.attempt === id) open.outcome = outcome;
  };

  clock = createClockHost({
    onSchedule: (kind, name) => {
      if (kind === 'micro') snap('schedule', `поставлена микрозадача ${name}: срочная работа — до конца текущей задачи`);
      else snap('schedule', `поставлена макрозадача ${name}: планировщик продолжит после отрисовки`);
    },
  });

  mini = buildMiniLanes(code, clock.host);
  mini.instrument(
    (name, args) => {
      const state = mini!.inspect();
      const now = clock!.time();
      if (name === 'flushWork') {
        snap('task', `макрозадача планировщика: квант 5 мс, с t=${now} до t=${now + 5}`);
      } else if (name === 'performSyncWork') {
        snap('task', 'микрозадача: срочная работа SyncLane — без квантов и уступок');
      } else if (name === 'renderRoot') {
        committedNow = false;
        open = { from: now, to: now, lane: args[0] as number, attempt, outcome: 'running' };
      } else if (name === 'prepareFreshStack') {
        const lanes = args[0] as number;
        if (state.wipRoot) {
          restarts += 1;
          markAttempt(attempt, 'thrown');
          snap(
            'restart',
            `начатое дерево ${laneName(state.wipRootLanes)} выброшено: пришла более срочная ${laneName(lanes)}`,
          );
        }
        attempt += 1;
        if (open) open.attempt = attempt;
      } else if (name === 'performUnitOfWork') {
        const fiber = args[0] as LanesFiber;
        performed.add(fiber);
        if (isComponent(fiber)) {
          if (typeof fiber.type === 'function') calls += 1;
          snap('unit', `рендер ${laneName(state.wipRootLanes)}: цикл взял ${fiberLabel(fiber)}`);
        }
      } else if (name === 'commitRoot') {
        commits += 1;
        commitLane = state.wipRootLanes;
        committedNow = true;
        markAttempt(attempt, 'commit');
      } else if (name === 'pingRoot') {
        snap('ping', `промис выполнился — пинг: заказать рендер ${laneName(args[0] as number)}`);
      }
    },
    (name, result) => {
      const state = mini!.inspect();
      const now = clock!.time();
      if (name === 'commitRoot') {
        snap('commit', `коммит ${laneName(commitLane)}: дерево на экране одним заходом`);
      } else if (name === 'throwException') {
        if (result === null) {
          markAttempt(attempt, 'suspended');
          snap('suspend', 'компонент бросил промис, а граница уже показывает содержимое: переход откладывается целиком');
        } else {
          snap('suspend', 'компонент бросил промис: ближайшая граница Suspense покажет заглушку');
        }
      } else if (name === 'renderRoot' && open) {
        open.to = now;
        if (state.workInProgress) open.outcome = 'yield';
        else if (!committedNow && open.outcome === 'running') open.outcome = 'suspended';
        segments.push(open);
        open = null;
        if (state.workInProgress) {
          snap('yield', `t=${now}: квант кончился — отдать поток браузеру; закладка остаётся в workInProgress`);
        }
      }
    },
  );

  const exposed = new Map<string, () => void>();
  const App = loadScenario(
    scenario.code,
    mini,
    (line) => void logs.push(line),
    (ms) => clock!.advance(ms),
    (name, fn) => exposed.set(name, fn),
  );

  const hasWork = () => clock!.micro() + clock!.tasks() > 0;

  const step = () => {
    if (!hasWork()) return -1;
    const start = frames.length;
    clock!.runOne();
    if (!hasWork()) snap('idle', 'очереди пусты — корень ждёт следующего обновления');
    return start;
  };

  snap('event', 'root.render(<App />) — обновление корня в DefaultLane');
  mini.render(mini.h(App));
  while (hasWork()) step();

  const fire = (action: LanesAction) => {
    const start = frames.length;
    const fn = exposed.get(action.name);
    if (!fn) return start;
    const how = action.event === 'discrete' ? 'клик — обновления получат SyncLane' : 'не событие (таймер, fetch) — DefaultLane';
    snap('event', `${action.label}: ${how}`);
    if (action.event === 'discrete') mini!.discreteUpdates(fn);
    else fn();
    snap('event', 'обработчик закончился: полосы помечены, рендер заказан, но не начат');
    return start;
  };

  return { frames, logs, fire, step, hasWork, clock, mini };
}
