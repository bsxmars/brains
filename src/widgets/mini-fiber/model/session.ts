import { buildMiniReact, loadScenario } from './build';
import { createJournalHost, type JournalHost } from './host';
import type { FiberRow, FramePhase, MiniFiber, MiniFrame, MiniHook, MiniReact, MiniScenario } from './types';

/**
 * Прогон мини-рендерера с протоколом: что он делал, в каком порядке и как при этом
 * выглядели оба дерева.
 *
 * Здесь нет заготовленных кадров. Сессия исполняет код темы на сценарии читателя и после
 * каждого события снимает снимок: цикл взял файбер, хост выполнил операцию, компонент
 * что-то вывел, коммит начался. Демо листает то, что получилось, — как лента событий
 * в `widgets/scheduler-queue`. Нажали «setState» — сессия выполняет настоящий `setState`
 * и дописывает протокол.
 *
 * **Квант — один файбер.** `shouldYield` отвечает «пора» после каждой единицы работы, и
 * рендер режется на столько задач, сколько в дереве файберов. У React квант — около 5 мс;
 * здесь он сжат до предела, чтобы прерываемость была видна на дереве из пяти узлов.
 * На результат это не влияет — проверено тестом: итог с квантом в один файбер и без
 * нарезки одинаков.
 *
 * Протокол — обычные массивы, а не реактивное состояние: запись идёт из глубины рендерера,
 * и компонент получает её одним присваиванием, когда прогон закончился.
 */

export interface Session {
  frames: MiniFrame[];
  ops: string[];
  logs: string[];
  /** Выполнить действие сценария; возвращает номер первого нового кадра. */
  act: (name: string) => number;
  html: () => string;
  journal: JournalHost;
  react: MiniReact;
}

const PHASE_OF: Record<string, FramePhase> = {
  performUnitOfWork: 'render',
  performWork: 'render',
  commitRoot: 'commit',
  flushPassiveEffects: 'passive',
};

const FLAG_NAMES: Array<[number, string]> = [
  [1, 'Placement'],
  [2, 'Update'],
];

function format(value: unknown): string {
  if (typeof value === 'string') return `'${value}'`;
  if (Array.isArray(value)) return `[${value.map(format).join(', ')}]`;
  return String(value);
}

export function fiberLabel(fiber: MiniFiber): string {
  const props = fiber.props ?? {};
  let base: string;
  if (fiber.type === 'ROOT') base = 'root';
  else if (typeof props.nodeValue === 'string') base = `«${props.nodeValue}»`;
  else if (typeof fiber.type === 'function') base = (fiber.type as { name: string }).name || 'компонент';
  else base = String(fiber.type);
  return fiber.key != null ? `${base} key=${fiber.key}` : base;
}

function hookLine(hook: MiniHook, live: boolean): string {
  if (hook.kind === 'state') {
    const queued = hook.queue.length ? ` · в очереди ${hook.queue.length}` : '';
    return `useState = ${format(hook.state)}${queued}`;
  }
  const name = hook.kind === 'layout' ? 'useLayoutEffect' : 'useEffect';
  return live && hook.changed ? `${name} · к запуску` : name;
}

export function createSession(code: string, scenario: MiniScenario): Session {
  const ids = new WeakMap<object, number>();
  let nextId = 1;
  const idOf = (fiber: object) => {
    if (!ids.has(fiber)) ids.set(fiber, nextId++);
    return ids.get(fiber)!;
  };

  const frames: MiniFrame[] = [];
  const logs: string[] = [];
  const active: string[] = [];
  let calls = 0;
  let commits = 0;
  let unitUsed = false;
  // Появится после сборки; до неё снимков не бывает.
  let react: MiniReact | null = null;
  let journal: JournalHost | null = null;

  const rows = (root: MiniFiber | null, live: boolean, marked: Set<MiniFiber>, next: MiniFiber | null) => {
    const out: FiberRow[] = [];
    const walk = (fiber: MiniFiber, depth: number) => {
      const flags = live ? FLAG_NAMES.filter(([bit]) => fiber.flags & bit).map(([, name]) => name) : [];
      if (marked.has(fiber)) flags.push('Deletion');
      out.push({
        id: idOf(fiber),
        label: fiberLabel(fiber),
        depth,
        flags,
        hooks: (fiber.hooks ?? []).map((hook) => hookLine(hook, live)),
        next: fiber === next,
        alt: fiber.alternate ? idOf(fiber.alternate) : null,
      });
      for (let child = fiber.child; child; child = child.sibling) walk(child, depth + 1);
    };
    if (root) walk(root, 0);
    return out;
  };

  const phase = (): FramePhase => {
    for (let i = active.length - 1; i >= 0; i -= 1) {
      const found = PHASE_OF[active[i]];
      if (found && active[i] !== 'performWork') return found;
    }
    return active.length ? 'render' : 'event';
  };

  const snap = (kind: MiniFrame['kind'], text: string, forced?: FramePhase) => {
    if (!react || !journal) return;
    const state = react.inspect();
    const marked = new Set(state.wipRoot ? state.deletions : []);
    frames.push({
      phase: forced ?? phase(),
      kind,
      text,
      current: rows(state.currentRoot, false, marked, null),
      wip: rows(state.wipRoot, true, new Set(), state.nextUnitOfWork),
      ops: journal.ops.length,
      logs: logs.length,
      html: journal.html(),
      calls,
      commits,
    });
  };

  journal = createJournalHost({
    onOp: (line) => snap('op', line),
    onSchedule: (kind, name) =>
      snap('schedule', kind === 'micro' ? `запланирована микрозадача: ${name}` : `запланирована задача: ${name}`),
    // Квант — один файбер: первый вопрос за задачу получает «работай», второй — «уступи».
    shouldYield: () => {
      if (unitUsed) return true;
      unitUsed = true;
      return false;
    },
  });

  react = buildMiniReact(code, journal.host);
  react.instrument(
    (name, fiber) => {
      active.push(name);
      if (name === 'performWork') unitUsed = false;
      if (name === 'performUnitOfWork' && fiber) {
        if (typeof fiber.type === 'function') calls += 1;
        snap('unit', `цикл взял файбер ${fiberLabel(fiber)}`);
      }
      if (name === 'commitRoot') {
        commits += 1;
        snap('commit', 'commitRoot: дерево достроено — коммит одним заходом, без перерывов');
      }
      if (name === 'flushPassiveEffects' && react!.inspect().pendingPassive) {
        snap('passive', 'flushPassiveEffects: очистки и эффекты useEffect');
      }
    },
    () => {
      active.pop();
    },
  );

  const exposed = new Map<string, () => void>();
  const App = loadScenario(
    scenario.code,
    { h: react.createElement, useState: react.useState, useEffect: react.useEffect, useLayoutEffect: react.useLayoutEffect },
    (line) => {
      logs.push(line);
      snap('log', line);
    },
    (name, fn) => exposed.set(name, fn),
  );

  snap('event', 'render(<App />, контейнер) — рендер заказан, но ещё не начат', 'event');
  react.render(react.createElement(App), journal.container);
  snap('event', 'render() вернул управление: DOM-операций пока ноль', 'event');
  journal.drain();
  snap('event', 'очереди пусты — рендерер ждёт следующего обновления', 'event');

  const act = (name: string) => {
    const start = frames.length;
    const fn = exposed.get(name);
    if (!fn || !journal) return start;
    snap('event', `обработчик: ${scenario.action?.label ?? name}`, 'event');
    fn();
    snap('event', 'обработчик закончился — очередь хука заполнена, рендера ещё не было', 'event');
    journal.drain();
    snap('event', 'очереди пусты — рендерер ждёт следующего обновления', 'event');
    return start;
  };

  return {
    frames,
    ops: journal.ops,
    logs,
    act,
    html: journal.html,
    journal,
    react,
  };
}
