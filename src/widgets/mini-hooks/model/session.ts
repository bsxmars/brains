import { buildMiniHooks, loadScenario } from './build';
import { createScheduler, DRAIN_LIMIT } from './scheduler';
import { screenOf } from './screen';
import type {
  CellRow,
  FiberStatus,
  HookCell,
  HooksAction,
  HooksFiber,
  HooksFrame,
  HooksPhase,
  HooksRow,
  HooksScenario,
  MiniHooks,
} from './types';

/**
 * Прогон мини-реализации хуков с протоколом: что она делала и как при этом выглядели
 * файберы и их ячейки.
 *
 * Заготовленных кадров нет. Сессия исполняет код темы на сценарии читателя и после каждого
 * события снимает снимок: цикл взял файбер, функция компонента вызвана или пропущена,
 * провайдер пометил читателей, коммит, эффекты. Кнопка действия выполняет настоящий
 * `setState` (или `store.set`) и дописывает протокол; «шаг» листает то, что записано.
 *
 * **Квант — один файбер.** Нарезанный рендер (переход) отдаёт поток после каждой единицы
 * работы — так событие можно вклинить ровно после первого компонента. Синхронный рендер
 * `shouldYield` не спрашивает вовсе, как и у React.
 *
 * Протокол — обычные массивы, а не реактивное состояние: запись идёт из глубины реализации,
 * и компонент получает её одним присваиванием, когда прогон закончился.
 */

export interface HooksSession {
  frames: HooksFrame[];
  logs: string[];
  screens: string[];
  /** Выполнить действие сценария; возвращает номер первого нового кадра. */
  act: (action: HooksAction) => number;
  mini: MiniHooks;
}

const PHASE_OF: Record<string, HooksPhase> = {
  beginWork: 'render',
  renderWithHooks: 'render',
  commitRoot: 'commit',
  flushPassiveEffects: 'passive',
};

const STATUS_TEXT: Record<FiberStatus, string> = {
  mount: 'монтирование',
  render: 'функция вызвана',
  same: 'вызвана, результат тот же — дети пропущены',
  skip: 'пропущен целиком',
  descend: 'пропущен, но работа ниже',
  host: 'хост',
  idle: 'не тронут',
};

/** Короткая запись значения ячейки: на экране демо мало места. */
export function formatValue(value: unknown, depth = 0): string {
  if (typeof value === 'string') return `'${value.length > 18 ? `${value.slice(0, 17)}…` : value}'`;
  if (typeof value === 'function') return value.name ? `ƒ ${value.name}` : 'ƒ';
  if (value === null || value === undefined || typeof value !== 'object') return String(value);
  if (depth > 1) return Array.isArray(value) ? '[…]' : '{…}';
  if (Array.isArray(value)) {
    const shown = value.slice(0, 3).map((item) => formatValue(item, depth + 1));
    return `[${shown.join(', ')}${value.length > 3 ? `, …+${value.length - 3}` : ''}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).slice(0, 3);
  return `{ ${entries.map(([k, v]) => `${k}: ${formatValue(v, depth + 1)}`).join(', ')} }`;
}

export function fiberLabel(fiber: HooksFiber): string {
  const type = fiber.type as { name?: string; $$memo?: boolean; type?: { name?: string }; $$context?: boolean; displayName?: string };
  if (typeof fiber.type === 'function') return type.name || 'компонент';
  if (type.$$memo) return `memo(${type.type?.name || 'компонент'})`;
  if (type.$$context) return `<${type.displayName ?? 'Context'}>`;
  return String(fiber.type);
}

function hookAt(first: HookCell | null, index: number): HookCell | null {
  let hook = first;
  for (let i = 0; hook && i < index; i += 1) hook = hook.next;
  return hook;
}

/** Строка ячейки: что в ней лежит и — если файбер прошёл этот рендер — что с ней стало. */
function cellRow(hook: HookCell, index: number, prev: HookCell | null, touched: boolean, mounted: boolean): CellRow {
  const ms = hook.memoizedState as unknown;
  // Ячейка заведена, но ещё не заполнена: снимок сделан изнутри фабрики useMemo или редьюсера.
  if (ms === null && hook.type !== 'useState' && hook.type !== 'useReducer') {
    return { index, type: hook.type, value: '…', note: 'заполняется' };
  }
  let value: string;
  let note = '';
  if (hook.type === 'useState' || hook.type === 'useReducer') {
    value = formatValue(ms);
    const pending = (hook.queue as { pending: unknown[] }).pending.length;
    if (pending) note = `в очереди ${pending}`;
  } else if (hook.type === 'useRef') {
    value = `{ current: ${formatValue((ms as { current: unknown }).current)} }`;
  } else if (hook.type === 'useMemo' || hook.type === 'useCallback') {
    const [stored, deps] = ms as [unknown, unknown];
    value = `[${hook.type === 'useCallback' ? 'ƒ' : formatValue(stored)}, ${formatValue(deps)}]`;
    if (touched && hook.type === 'useMemo') note = mounted ? 'вычислен' : prev && prev.memoizedState === ms ? 'из кеша' : 'пересчитан';
    if (touched && hook.type === 'useCallback') note = mounted ? 'создана' : prev && prev.memoizedState === ms ? 'та же функция' : 'новая функция';
  } else if (hook.type === 'useSyncExternalStore') {
    value = `снимок ${formatValue(ms)}`;
  } else {
    const effect = ms as { deps: unknown; hasEffect: boolean };
    value = `deps ${formatValue(effect.deps)}`;
    if (touched) note = effect.hasEffect ? 'к запуску' : 'deps те же';
  }
  return { index, type: hook.type, value, note };
}

export function createSession(code: string, scenario: HooksScenario): HooksSession {
  const ids = new WeakMap<object, number>();
  let nextId = 1;
  /** Номер пары: у файбера и его `alternate` он общий — это один компонент на экране. */
  const pairId = (fiber: HooksFiber) => {
    const known = ids.get(fiber) ?? (fiber.alternate ? ids.get(fiber.alternate) : undefined);
    const id = known ?? nextId++;
    ids.set(fiber, id);
    return id;
  };

  const frames: HooksFrame[] = [];
  const logs: string[] = [];
  const screens: string[] = [];
  const active: string[] = [];
  const renders = new Map<number, number>();
  let statuses = new WeakMap<HooksFiber, FiberStatus>();
  let called = new WeakSet<HooksFiber>();
  let calls = 0;
  let commits = 0;

  // Квант — один файбер на задачу.
  let used = false;
  const scheduler = createScheduler(() => {
    if (used) return true;
    used = true;
    return false;
  });
  const mini = buildMiniHooks(code, scheduler.host);

  const runOne = () => {
    used = false;
    return scheduler.runOne();
  };
  const drain = () => {
    let done = 0;
    while (runOne()) {
      if (++done >= DRAIN_LIMIT) throw new Error(`очереди не опустели за ${DRAIN_LIMIT} колбэков`);
    }
  };

  const rows = (): HooksRow[] => {
    const state = mini.inspect();
    const top = state.wipRoot ?? state.root?.current ?? null;
    const out: HooksRow[] = [];
    const walk = (fiber: HooksFiber | null, depth: number) => {
      for (let node = fiber; node; node = node.sibling) {
        if (node.type === 'TEXT') continue;
        if (node.type === 'ROOT') {
          walk(node.child, depth);
          continue;
        }
        const status = statuses.get(node) ?? 'idle';
        const touched = called.has(node);
        const mounted = touched && node.alternate === null;
        const cells: CellRow[] = [];
        if (typeof node.type !== 'string') {
          let i = 0;
          for (let hook = node.memoizedState; hook; hook = hook.next, i += 1) {
            cells.push(cellRow(hook, i, hookAt(node.alternate?.memoizedState ?? null, i), touched, mounted));
          }
        }
        const context = (node.type as { $$context?: boolean }).$$context;
        const id = pairId(node);
        out.push({
          id,
          label: fiberLabel(node),
          depth,
          status,
          renders: renders.get(id) ?? 0,
          cells,
          contexts: (node.dependencies?.contexts ?? []).map((ctx) => ctx.displayName ?? 'Context'),
          detail: context ? `value = ${formatValue(node.props.value)}` : '',
          lanes: node.lanes !== 0,
          childLanes: node.childLanes !== 0,
          next: node === state.nextUnitOfWork,
        });
        walk(node.child, depth + 1);
      }
    };
    walk(top, 0);
    return out;
  };

  const phase = (): HooksPhase => {
    for (let i = active.length - 1; i >= 0; i -= 1) {
      const found = PHASE_OF[active[i]];
      if (found) return found;
    }
    return 'event';
  };

  const snap = (kind: HooksFrame['kind'], text: string, forced?: HooksPhase) => {
    frames.push({
      phase: forced ?? phase(),
      kind,
      text,
      rows: rows(),
      logs: logs.length,
      screens: screens.length,
      screen: screenOf(mini.inspect().root),
      calls,
      commits,
    });
  };

  mini.instrument(
    (name, args) => {
      active.push(name);
      if (name === 'prepareFreshStack') {
        statuses = new WeakMap();
        called = new WeakSet();
      }
      if (name === 'beginWork') {
        const fiber = args[0] as HooksFiber;
        if (typeof fiber.type === 'string') statuses.set(fiber, 'host');
        if (fiber.type !== 'TEXT' && fiber.type !== 'ROOT') snap('unit', `beginWork: ${fiberLabel(fiber)}`);
      }
      if (name === 'renderWithHooks') {
        const [current, wip] = args as [HooksFiber | null, HooksFiber];
        calls += 1;
        const id = pairId(wip);
        renders.set(id, (renders.get(id) ?? 0) + 1);
        called.add(wip);
        statuses.set(wip, current === null ? 'mount' : 'render');
      }
      if (name === 'commitRoot') snap('commit', 'commitRoot: дерево в работе становится текущим — это и есть новый экран');
      if (name === 'flushPassiveEffects' && mini.inspect().pendingPassive) {
        snap('passive', 'flushPassiveEffects: эффекты после коммита — здесь подписываются и сторы');
      }
    },
    (name, args, result) => {
      if (name === 'bailout') {
        const fiber = args[0] as HooksFiber;
        const status: FiberStatus = called.has(fiber) ? 'same' : result === null ? 'skip' : 'descend';
        statuses.set(fiber, status);
        snap('unit', `${fiberLabel(fiber)}: ${STATUS_TEXT[status]}`);
      }
      if (name === 'renderWithHooks') {
        const wip = args[1] as HooksFiber;
        snap('unit', `${fiberLabel(wip)}: функция вызвана — список ячеек построен заново`);
      }
      if (name === 'propagateContextChange') {
        const [provider] = args as [HooksFiber];
        snap('unit', `${fiberLabel(provider)}: value изменилось — читатели ниже помечены работой`);
      }
      if (name === 'commitRoot') {
        commits += 1;
        const screen = screenOf(mini.inspect().root);
        screens.push(screen);
        active.pop();
        snap('commit', `коммит №${commits}: на экране ${screen}`, 'commit');
        return;
      }
      active.pop();
    },
  );

  const exposed = new Map<string, () => void>();
  const App = loadScenario(
    scenario.code,
    mini,
    (line) => {
      logs.push(line);
      snap('log', line);
    },
    (name, fn) => exposed.set(name, fn),
  );

  snap('event', 'render(<App />) — рендер заказан, но ещё не начат', 'event');
  mini.render(mini.h(App));
  drain();
  snap('event', 'очереди пусты — ждём следующего обновления', 'event');

  const act = (action: HooksAction) => {
    const start = frames.length;
    const fn = exposed.get(action.name);
    if (!fn) return start;
    statuses = new WeakMap();
    called = new WeakSet();
    snap('event', `обработчик: ${action.label}`, 'event');
    fn();
    snap(
      'event',
      scheduler.pending()
        ? 'обработчик закончился — рендер заказан, но ещё не начат'
        : 'обработчик закончился — и рендер не заказан вовсе',
      'event',
    );
    if (action.interleave) {
      const base = logs.length;
      while (logs.length - base < action.interleave.afterLogs && runOne());
      const then = exposed.get(action.interleave.then);
      snap('interleave', `рендер отдал поток — и в этот момент приходит событие: ${action.interleave.label}`, 'event');
      then?.();
    }
    drain();
    snap('event', 'очереди пусты — ждём следующего обновления', 'event');
    return start;
  };

  return { frames, logs, screens, act, mini };
}
