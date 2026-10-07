import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  CELLS_LOG,
  COND_CONTEXT_CODE,
  CONTEXT_LOG,
  DEMO_SCENARIOS,
  DEPS_IS_CODE,
  DEPS_IS_LOG,
  DIFF,
  DISPATCHER_REACT_NOTE,
  HOOK_CELLS,
  HOOK_CELLS_CODE,
  MEMO_TEXT_CODE,
  MINI_HOOKS_CODE,
  REDUCER_SAME_CODE,
  REDUCER_SAME_LOG,
  SAME_VALUE_CODE,
  SAME_VALUE_LOG,
  SCENARIO_CELLS,
  SCENARIO_CONTEXT,
  SCENARIO_TEAR_MOUNT_PLAIN,
  SCENARIO_TEAR_MOUNT_SYNC,
  SCENARIO_TEAR_PLAIN,
  SCENARIO_TEAR_SYNC,
  STEP_DISPATCHER,
  TEAR_MOUNT_LOG,
  TEAR_UPDATE_SCREENS,
  UNCACHED_SNAPSHOT_CODE,
} from '@/content/frameworks/react-hooks-internals/data';
import { buildMiniHooks, loadScenario } from '@/widgets/mini-hooks/model/build';
import { createScheduler, DRAIN_LIMIT } from '@/widgets/mini-hooks/model/scheduler';
import { isTorn, screenOf } from '@/widgets/mini-hooks/model/screen';
import { createSession } from '@/widgets/mini-hooks/model/session';
import type { HookCell, HooksApi } from '@/widgets/mini-hooks/model/types';

/**
 * «React изнутри: хуки и контекст»: мини-реализация темы против настоящего React 19.3.
 *
 * Исполняется **та же строка** `MINI_HOOKS_CODE`, что напечатана в теме, и те же исходники
 * сценариев (`SCENARIO_*`) — у мини-версии со своими хуками, у React — с его хуками.
 * Сверяется наблюдаемое: кто вызван, сколько раз, что на экране после каждого коммита,
 * и **форма списка хуков на файбере** — последнее читается прямо из файбера React.
 *
 * **Как React работает без DOM и без таймеров.**
 *   — Документ поддельный, из обычных объектов (как в `react-internals.test.ts`): jsdom
 *     в зависимостях курса нет.
 *   — Планировщик подменён на `scheduler/unstable_mock`: модуль кладётся в кеш `require`
 *     под именем `scheduler` **до** загрузки `react-dom`. Тогда «отдать поток» решает не время,
 *     а число строк, выведенных компонентами (`unstable_flushNumberOfYields`), и переход
 *     можно остановить ровно после первого компонента — без единого замера времени.
 *   — Экран после каждого коммита снимается через `__REACT_DEVTOOLS_GLOBAL_HOOK__`: React зовёт
 *     `onCommitFiberRoot` после каждого коммита, если хук установлен до загрузки `react-dom`.
 *
 * Обе подмены проверяются первым же тестом: если `react-dom` оказался загружен раньше (чужим
 * файлом в том же процессе), тест падает с внятным текстом, а не показывает зелёное про
 * настоящий планировщик.
 *
 * `vitest` выставляет `NODE_ENV=test`, и `react`/`react-dom` отдают **отладочную** сборку.
 * Поведение, которое здесь сверяется, от сборки не зависит; предупреждения — зависят, и
 * единственная проверка про предупреждение помечена ниже.
 */

/* ───────────────────────── Поддельный документ для React ───────────────────────── */

class FakeNode {
  childNodes: FakeNode[] = [];
  parentNode: FakeNode | null = null;
  nodeValue: string | null = null;
  constructor(public nodeType: number) {}
  get ownerDocument(): FakeNode {
    return fakeDocument;
  }
  get firstChild() {
    return this.childNodes[0] ?? null;
  }
  get lastChild() {
    return this.childNodes[this.childNodes.length - 1] ?? null;
  }
  get nextSibling() {
    const siblings = this.parentNode?.childNodes ?? [];
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }
  appendChild(child: FakeNode) {
    child.parentNode?.detach(child);
    this.childNodes.push(child);
    child.parentNode = this;
    return child;
  }
  insertBefore(child: FakeNode, before: FakeNode | null) {
    if (!before) return this.appendChild(child);
    child.parentNode?.detach(child);
    this.childNodes.splice(this.childNodes.indexOf(before), 0, child);
    child.parentNode = this;
    return child;
  }
  removeChild(child: FakeNode) {
    this.detach(child);
    return child;
  }
  detach(child: FakeNode) {
    const i = this.childNodes.indexOf(child);
    if (i >= 0) this.childNodes.splice(i, 1);
    child.parentNode = null;
  }
  addEventListener() {}
  removeEventListener() {}
  get textContent(): string {
    return this.nodeType === 3 ? (this.nodeValue ?? '') : this.childNodes.map((c) => c.textContent).join('');
  }
  set textContent(value: string) {
    if (this.nodeType === 3) {
      this.nodeValue = value;
      return;
    }
    this.childNodes.forEach((c) => (c.parentNode = null));
    this.childNodes = [];
    if (value !== '' && value != null) {
      const text = new FakeNode(3);
      text.nodeValue = String(value);
      text.parentNode = this;
      this.childNodes.push(text);
    }
  }
  get data() {
    return this.nodeValue ?? '';
  }
  set data(value: string) {
    this.nodeValue = value;
  }
}

class FakeElement extends FakeNode {
  attrs: Record<string, string> = {};
  style: Record<string, string> = {};
  namespaceURI = 'http://www.w3.org/1999/xhtml';
  tagName: string;
  nodeName: string;
  constructor(public localName: string) {
    super(1);
    this.tagName = localName.toUpperCase();
    this.nodeName = this.tagName;
  }
  setAttribute(key: string, value: unknown) {
    this.attrs[key] = String(value);
  }
  removeAttribute(key: string) {
    delete this.attrs[key];
  }
  getAttribute(key: string) {
    return this.attrs[key] ?? null;
  }
  hasAttribute(key: string) {
    return key in this.attrs;
  }
}

const fakeDocument = Object.assign(new FakeNode(9), {
  nodeName: '#document',
  createElement: (tag: string) => new FakeElement(tag),
  createTextNode: (value: string) => {
    const text = new FakeNode(3);
    text.nodeValue = String(value);
    return text;
  },
  documentElement: new FakeElement('html'),
  body: new FakeElement('body'),
  activeElement: null as FakeNode | null,
  defaultView: null as unknown,
});
fakeDocument.activeElement = fakeDocument.body;

const fakeWindow = {
  document: fakeDocument,
  HTMLIFrameElement: class {},
  event: undefined,
  addEventListener() {},
  removeEventListener() {},
};
fakeDocument.defaultView = fakeWindow;

/** Разметка без атрибутов — в том же формате, что `serializeFiber` у мини-версии. */
function fakeHtml(node: FakeNode): string {
  if (node.nodeType === 3) return node.nodeValue ?? '';
  const el = node as FakeElement;
  return `<${el.localName}>${el.childNodes.map(fakeHtml).join('')}</${el.localName}>`;
}

/* ─────────────────────── Настоящий React на подменённом планировщике ─────────────────────── */

type ReactModule = typeof import('react');
type ClientModule = typeof import('react-dom/client');

interface MockScheduler {
  log: (value: unknown) => void;
  unstable_clearLog: () => unknown[];
  unstable_flushAllWithoutAsserting: () => boolean;
  unstable_flushNumberOfYields: (count: number) => void;
  unstable_hasPendingWork: () => boolean;
}

let React: ReactModule;
let client: ClientModule;
let mock: MockScheduler;
let devtoolsInjected = false;
/** Контейнер, экран которого снимается после каждого коммита. */
let watched: FakeElement | null = null;
const screens: string[] = [];

beforeAll(() => {
  const g = globalThis as Record<string, unknown>;
  g.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    inject: () => {
      devtoolsInjected = true;
      return 1;
    },
    onCommitFiberRoot: () => {
      if (watched) screens.push(watched.childNodes.map(fakeHtml).join(''));
    },
    onCommitFiberUnmount: () => {},
    onPostCommitFiberRoot: () => {},
    checkDCE: () => {},
  };
  Object.assign(g, { window: fakeWindow, document: fakeDocument });

  // `scheduler` разрешается от `react-dom` — туда и кладётся подмена.
  const fromDom = createRequire(createRequire(import.meta.url).resolve('react-dom/package.json'));
  const schedulerPath = fromDom.resolve('scheduler');
  mock = fromDom('scheduler/unstable_mock') as MockScheduler;
  fromDom.cache[schedulerPath] = {
    id: schedulerPath,
    filename: schedulerPath,
    loaded: true,
    exports: mock,
  } as NodeJS.Module;

  React = fromDom('react') as ReactModule;
  client = fromDom('react-dom/client') as ClientModule;
});

afterAll(() => {
  const g = globalThis as Record<string, unknown>;
  delete g.window;
  delete g.document;
  delete g.__REACT_DEVTOOLS_GLOBAL_HOOK__;
});

const microtasks = async () => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
};

/** Дать React доделать всё: микрозадачи, задачи планировщика, эффекты. */
async function settle() {
  for (let i = 0; i < 100; i += 1) {
    await microtasks();
    if (!mock.unstable_hasPendingWork()) return;
    mock.unstable_flushAllWithoutAsserting();
  }
  throw new Error('React не успокоился за 100 проходов');
}

interface Run {
  logs: string[];
  screens: string[];
  html: () => string;
  act: (name: string) => Promise<void> | void;
  /** Запустить ручку, дать рендеру вывести `afterLogs` строк, вклинить `then` и доделать. */
  interleave: (name: string, afterLogs: number, then: string) => Promise<void> | void;
}

function reactApi(): HooksApi {
  return {
    h: React.createElement,
    useState: React.useState,
    useReducer: React.useReducer,
    useRef: React.useRef,
    useMemo: React.useMemo,
    useCallback: React.useCallback,
    useContext: React.useContext,
    useEffect: React.useEffect,
    useSyncExternalStore: React.useSyncExternalStore,
    memo: React.memo,
    createContext: React.createContext,
    startTransition: React.startTransition,
  } as unknown as HooksApi;
}

async function runReact(code: string): Promise<Run & { container: FakeElement }> {
  const logs: string[] = [];
  const exposed = new Map<string, () => void>();
  const App = loadScenario(
    code,
    reactApi(),
    (line) => {
      logs.push(line);
      mock.log(line);
    },
    (name, fn) => exposed.set(name, fn),
  );
  const container = new FakeElement('div');
  watched = container;
  screens.length = 0;
  // Ошибку рендера React не бросает наружу, а сообщает корню: забираем её и бросаем сами.
  const errors: unknown[] = [];
  const root = client.createRoot(container as unknown as HTMLElement, {
    onUncaughtError: (error: unknown) => void errors.push(error),
  });
  const settleOrThrow = async () => {
    await settle();
    if (errors.length) throw errors.shift();
  };
  root.render(React.createElement(App as () => null));
  await settleOrThrow();
  mock.unstable_clearLog();
  const own = screens;
  return {
    logs,
    container,
    screens: own,
    html: () => container.childNodes.map(fakeHtml).join(''),
    act: async (name) => {
      exposed.get(name)!();
      await settleOrThrow();
      mock.unstable_clearLog();
    },
    interleave: async (name, afterLogs, then) => {
      mock.unstable_clearLog();
      exposed.get(name)!();
      await microtasks();
      mock.unstable_flushNumberOfYields(afterLogs);
      exposed.get(then)!();
      await settleOrThrow();
      mock.unstable_clearLog();
    },
  };
}

/* ─────────────────────────────── Мини-версия ─────────────────────────────── */

/** Квант в один файбер: первый вопрос за задачу — «работай», второй — «уступи». */
function oneUnitPerTask() {
  let used = false;
  return {
    reset: () => void (used = false),
    shouldYield: () => {
      if (used) return true;
      used = true;
      return false;
    },
  };
}

function runMini(code: string) {
  const logs: string[] = [];
  const own: string[] = [];
  const exposed = new Map<string, () => void>();
  const quantum = oneUnitPerTask();
  const scheduler = createScheduler(quantum.shouldYield);
  const mini = buildMiniHooks(MINI_HOOKS_CODE, scheduler.host);
  mini.instrument(
    () => {},
    (name) => {
      if (name === 'commitRoot') own.push(screenOf(mini.inspect().root));
    },
  );
  // Квант считается на задачу: новая задача — новый квант.
  const runOne = () => {
    quantum.reset();
    return scheduler.runOne();
  };
  const drain = () => {
    let guard = 0;
    while (runOne()) {
      if (++guard >= DRAIN_LIMIT) throw new Error(`очереди не опустели за ${DRAIN_LIMIT} колбэков`);
    }
  };
  const App = loadScenario(code, mini, (line) => void logs.push(line), (name, fn) => exposed.set(name, fn));
  mini.render(mini.h(App));
  drain();
  return {
    logs,
    screens: own,
    mini,
    exposed,
    html: () => screenOf(mini.inspect().root),
    act: (name: string) => {
      exposed.get(name)!();
      drain();
    },
    interleave: (name: string, afterLogs: number, then: string) => {
      const base = logs.length;
      exposed.get(name)!();
      while (logs.length - base < afterLogs && runOne());
      exposed.get(then)!();
      drain();
    },
  };
}

/** Логи одного действия: очистить, нажать, вернуть новое. */
async function step(run: Run, name: string) {
  run.logs.length = 0;
  await run.act(name);
  return [...run.logs];
}

/* ─────────────────────────── Форма списка хуков ─────────────────────────── */

interface AnyHook {
  memoizedState: unknown;
  queue: unknown;
  next: AnyHook | null;
}

/**
 * Что лежит в ячейке — по форме, одинаково для React и мини-версии. Имени у ячейки React нет,
 * поэтому сверяется то, что в ней хранится: очередь редьюсера, снимок стора, пара
 * «значение, зависимости», объект эффекта, объект `{ current }`.
 */
function cellShape(hook: AnyHook): string {
  const ms = hook.memoizedState as Record<string, unknown> | null;
  const queue = hook.queue as Record<string, unknown> | null;
  if (queue && 'lastRenderedReducer' in queue) return 'очередь';
  if (queue && 'getSnapshot' in queue) return 'снимок стора';
  if (Array.isArray(ms) && ms.length === 2) return '[значение, deps]';
  if (ms && typeof ms === 'object' && 'create' in ms && 'inst' in ms) return 'эффект';
  if (ms && typeof ms === 'object' && Object.keys(ms).join() === 'current') return '{ current }';
  return `? ${typeof ms}`;
}

function cellsOf(first: AnyHook | null) {
  const out: string[] = [];
  for (let hook = first; hook; hook = hook.next) out.push(cellShape(hook));
  return out;
}

interface AnyFiber {
  type: unknown;
  child: AnyFiber | null;
  sibling: AnyFiber | null;
  memoizedState: unknown;
}

function findFiber(fiber: AnyFiber | null, name: string): AnyFiber | null {
  for (let node = fiber; node; node = node.sibling) {
    if (typeof node.type === 'function' && node.type.name === name) return node;
    const inner = findFiber(node.child, name);
    if (inner) return inner;
  }
  return null;
}

function reactRootFiber(container: FakeElement): AnyFiber {
  const key = Object.keys(container).find((k) => k.startsWith('__reactContainer$'))!;
  const hostRoot = (container as unknown as Record<string, { stateNode: { current: AnyFiber } }>)[key];
  return hostRoot.stateNode.current;
}

/* ─────────────────────────────── Проверки ─────────────────────────────── */

describe('подмены: React в тесте идёт на поддельном планировщике и отдаёт коммиты', () => {
  it('react-dom взял scheduler/unstable_mock и подключился к хуку инструментов', async () => {
    const run = await runReact(SCENARIO_CELLS);
    expect(devtoolsInjected, 'хук инструментов разработчика не подключён — react-dom загружен раньше подмены').toBe(true);
    expect(run.screens.length, 'после монтирования нет снимка экрана — onCommitFiberRoot не вызывается').toBe(1);

    // Обновление ждёт планировщика: пока его не прокрутили, рендера нет.
    run.logs.length = 0;
    const setTick = () => run.act('tick');
    const pending = setTick();
    expect(run.logs).toEqual([]);
    await pending;
    expect(run.logs.length).toBeGreaterThan(0);
  });
});

describe('ячейки хуков: форма списка у мини-версии и у файбера React', () => {
  it('HOOK_CELLS: восемь вызовов — восемь ячеек, но не те же восемь', async () => {
    const react = await runReact(HOOK_CELLS_CODE);
    const mini = runMini(HOOK_CELLS_CODE);

    const reactFiber = findFiber(reactRootFiber(react.container).child, 'Probe')!;
    const miniFiber = findFiber(mini.mini.inspect().root!.current.child as unknown as AnyFiber, 'Probe')!;
    const expected = HOOK_CELLS.map((row) => row.shape);

    expect(cellsOf(reactFiber.memoizedState as AnyHook)).toEqual(expected);
    expect(cellsOf(miniFiber.memoizedState as AnyHook)).toEqual(expected);
    expect(react.html()).toBe(mini.html());
  });

  it('useContext ячейки не занимает: в отладочном списке имён React он есть, в списке ячеек — нет', async () => {
    const react = await runReact(HOOK_CELLS_CODE);
    const fiber = findFiber(reactRootFiber(react.container).child, 'Probe') as AnyFiber & { _debugHookTypes: string[] };
    // ⚠️ `_debugHookTypes` есть только в отладочной сборке — её и выбирает vitest.
    expect(fiber._debugHookTypes).toEqual(HOOK_CELLS_CODE.match(/use[A-Za-z]+(?=\()/g));
    expect(fiber._debugHookTypes).toContain('useContext');
    expect(HOOK_CELLS.map((row) => row.hook)).not.toContain('useContext');
  });

  it('список мини-версии строится заново на каждом рендере, а объекты ячеек — новые', () => {
    const mini = runMini(SCENARIO_CELLS);
    const first = findFiber(mini.mini.inspect().root!.current.child as unknown as AnyFiber, 'Search')!;
    const firstCell = first.memoizedState as HookCell;
    mini.act('tick');
    const second = findFiber(mini.mini.inspect().root!.current.child as unknown as AnyFiber, 'Search')!;
    const secondCell = second.memoizedState as HookCell;
    expect(second).not.toBe(first);           // второй буфер
    expect(secondCell).not.toBe(firstCell);   // ячейка скопирована
    expect(secondCell.queue).toBe(firstCell.queue);   // а очередь — общая
  });
});

describe('useMemo, useCallback, useRef — одинаково у обоих', () => {
  it('CELLS_LOG: фабрика useMemo зовётся только при смене зависимости; запись в ref рендера не заказывает', async () => {
    const react = await runReact(SCENARIO_CELLS);
    const mini = runMini(SCENARIO_CELLS);
    expect(react.logs).toEqual(CELLS_LOG.mount);
    expect(mini.logs).toEqual(CELLS_LOG.mount);

    for (const [name, expected] of CELLS_LOG.steps) {
      const r = await step(react, name);
      const m = await step(mini as unknown as Run, name);
      expect(r, `React: ${name}`).toEqual(expected);
      expect(m, `мини: ${name}`).toEqual(expected);
      expect(react.html(), name).toBe(mini.html());
    }
  });

  it('ref: значение в ячейке меняется, коммитов не прибавляется', async () => {
    const react = await runReact(SCENARIO_CELLS);
    const mini = runMini(SCENARIO_CELLS);
    const reactCommits = react.screens.length;
    const miniCommits = mini.screens.length;
    await react.act('ref');
    await react.act('ref');
    mini.act('ref');
    mini.act('ref');
    expect(react.screens.length).toBe(reactCommits);
    expect(mini.screens.length).toBe(miniCommits);

    const refCell = (first: AnyHook | null) => {
      for (let hook = first; hook; hook = hook.next) if (cellShape(hook) === '{ current }') return hook.memoizedState;
      return null;
    };
    const reactFiber = findFiber(reactRootFiber(react.container).child, 'Search')!;
    const miniFiber = findFiber(mini.mini.inspect().root!.current.child as unknown as AnyFiber, 'Search')!;
    expect(refCell(reactFiber.memoizedState as AnyHook)).toEqual({ current: 2 });
    expect(refCell(miniFiber.memoizedState as AnyHook)).toEqual({ current: 2 });
  });

  it('useCallback: та же функция, пока зависимости те же — у обоих', async () => {
    const CODE = `const seen = [];
    function App() {
      const [n, setN] = useState(0);
      const [dep, setDep] = useState('a');
      seen.push(useCallback(() => dep, [dep]));
      expose('n', () => setN((x) => x + 1));
      expose('dep', () => setDep('b'));
      expose('check', () => log(seen.map((fn) => seen.indexOf(fn)).join(',')));
      return h('p', null, String(n) + dep);
    }`;
    const react = await runReact(CODE);
    const mini = runMini(CODE);
    for (const run of [react, mini] as Run[]) {
      await run.act('n');
      await run.act('dep');
      await run.act('n');
      await run.act('check');
    }
    // Рендеры: монтирование, n, dep, n → индексы первых вхождений: 0, 0, 2, 2.
    expect(react.logs).toEqual(['0,0,2,2']);
    expect(mini.logs).toEqual(['0,0,2,2']);
  });
  it('DEPS_IS_LOG: зависимости сравниваются Object.is — NaN равен себе, новый объект нет', async () => {
    const react = await runReact(DEPS_IS_CODE);
    const mini = runMini(DEPS_IS_CODE);
    expect(await step(react, 'bump')).toEqual(DEPS_IS_LOG);
    expect(await step(mini as unknown as Run, 'bump')).toEqual(DEPS_IS_LOG);
  });
});

describe('useState и useReducer: ранний выход и его условие', () => {
  it('SAME_VALUE_LOG: то же значение — ноль вызовов, сразу после смены — один, потом снова ноль', async () => {
    const react = await runReact(SAME_VALUE_CODE);
    const mini = runMini(SAME_VALUE_CODE);
    for (const [name, expected] of SAME_VALUE_LOG) {
      expect(await step(react, name), `React: ${name}`).toEqual(expected);
      expect(await step(mini as unknown as Run, name), `мини: ${name}`).toEqual(expected);
    }
  });

  it('REDUCER_SAME_LOG: у useReducer раннего выхода нет — функция вызывается каждый раз, дети — нет', async () => {
    const react = await runReact(REDUCER_SAME_CODE);
    const mini = runMini(REDUCER_SAME_CODE);
    for (const [name, expected] of REDUCER_SAME_LOG) {
      expect(await step(react, name), `React: ${name}`).toEqual(expected);
      expect(await step(mini as unknown as Run, name), `мини: ${name}`).toEqual(expected);
    }
  });
});

describe('контекст мимо memo', () => {
  it('CONTEXT_LOG: кто вызван при смене темы, пользователя и постороннего состояния — у обоих', async () => {
    const react = await runReact(SCENARIO_CONTEXT);
    const mini = runMini(SCENARIO_CONTEXT);
    expect(react.logs).toEqual(CONTEXT_LOG.mount);
    expect(mini.logs).toEqual(CONTEXT_LOG.mount);

    for (const [name, expected] of CONTEXT_LOG.steps) {
      expect(await step(react, name), `React: ${name}`).toEqual(expected);
      expect(await step(mini as unknown as Run, name), `мини: ${name}`).toEqual(expected);
      expect(react.html(), name).toBe(mini.html());
    }
  });

  it('без useMemo на значении провайдера постороннее состояние будит всех читателей', async () => {
    const NO_MEMO = SCENARIO_CONTEXT.replace(
      "useMemo(() => ({ theme, lang: 'ru' }), [theme])",
      "({ theme, lang: 'ru' })",
    );
    expect(NO_MEMO).not.toBe(SCENARIO_CONTEXT);
    const react = await runReact(NO_MEMO);
    const mini = runMini(NO_MEMO);
    const expected = ['render App', 'render ThemeLabel', 'render LangLabel'];
    expect(await step(react, 'tick')).toEqual(expected);
    expect(await step(mini as unknown as Run, 'tick')).toEqual(expected);
  });
});

describe('внешний стор: разрыв без хука и его отсутствие с хуком', () => {
  it('TEAR_UPDATE_SCREENS: без хука коммит показывает разрыв — у обоих', async () => {
    const react = await runReact(SCENARIO_TEAR_PLAIN);
    const mini = runMini(SCENARIO_TEAR_PLAIN);
    react.screens.length = 0;
    mini.screens.length = 0;

    await react.interleave('transition', 1, 'storeSet');
    mini.interleave('transition', 1, 'storeSet');

    expect(react.screens).toEqual(TEAR_UPDATE_SCREENS.plain);
    expect(mini.screens).toEqual(TEAR_UPDATE_SCREENS.plain);
    expect(isTorn(react.screens[0])).toBe(true);
  });

  it('TEAR_UPDATE_SCREENS: с useSyncExternalStore ни один коммит не разорван — у обоих', async () => {
    const react = await runReact(SCENARIO_TEAR_SYNC);
    const mini = runMini(SCENARIO_TEAR_SYNC);
    react.screens.length = 0;
    mini.screens.length = 0;

    await react.interleave('transition', 1, 'storeSet');
    mini.interleave('transition', 1, 'storeSet');

    expect(react.screens.some(isTorn)).toBe(false);
    expect(mini.screens.some(isTorn)).toBe(false);
    expect(react.screens.at(-1)).toBe(TEAR_UPDATE_SCREENS.sync.at(-1));
    expect(mini.screens.at(-1)).toBe(TEAR_UPDATE_SCREENS.sync.at(-1));
  });

  it('TEAR_MOUNT_LOG: на монтировании подписки ещё нет — спасает проверка в конце рендера', async () => {
    for (const [code, key] of [
      [SCENARIO_TEAR_MOUNT_PLAIN, 'plain'],
      [SCENARIO_TEAR_MOUNT_SYNC, 'sync'],
    ] as const) {
      const react = await runReact(code);
      const mini = runMini(code);
      react.screens.length = 0;
      mini.screens.length = 0;
      react.logs.length = 0;
      mini.logs.length = 0;

      await react.interleave('reveal', 1, 'storeSet');
      mini.interleave('reveal', 1, 'storeSet');

      expect(react.logs, `React ${key}`).toEqual(TEAR_MOUNT_LOG[key].logs);
      expect(mini.logs, `мини ${key}`).toEqual(TEAR_MOUNT_LOG[key].logs);
      expect(react.screens, `React ${key}`).toEqual(TEAR_MOUNT_LOG[key].screens);
      expect(mini.screens, `мини ${key}`).toEqual(TEAR_MOUNT_LOG[key].screens);
    }
  });

  it('без перехода разрыва нет и без хука: синхронный рендер не режется', async () => {
    const CODE = SCENARIO_TEAR_PLAIN.replace('startTransition(() => setRound((r) => r + 1))', 'setRound((r) => r + 1)');
    expect(CODE).not.toBe(SCENARIO_TEAR_PLAIN);
    const react = await runReact(CODE);
    const mini = runMini(CODE);
    react.screens.length = 0;
    mini.screens.length = 0;
    await react.interleave('transition', 1, 'storeSet');
    mini.interleave('transition', 1, 'storeSet');
    // Рендер прошёл целиком до события: все три ячейки прочитали 0. Событие сменило стор,
    // но без подписки нового рендера нет — экран устарел, но не разорван.
    expect(react.screens).toEqual(['<p><b>A=0 </b><b>B=0 </b><b>C=0 </b></p>']);
    expect(mini.screens).toEqual(react.screens);
  });
  /**
   * `useContext` ячейки не занимает, поэтому под условием он ничего не сдвигает: значения
   * верные у обоих. Отладочная сборка React всё равно ругается — её проверка порядка смотрит
   * на имена вызовов (`_debugHookTypes`), а не на ячейки. `use(Context)` в этот список
   * не попадает и молчит.
   */
  it('useContext под условием: значения верные, отладочный React предупреждает, use() — нет', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const react = await runReact(COND_CONTEXT_CODE);
    const mini = runMini(COND_CONTEXT_CODE);
    await react.act('on');
    mini.act('on');
    expect(react.html()).toBe('<p>светлая!</p>');
    expect(mini.html()).toBe(react.html());
    // ⚠️ Предупреждение — только в отладочной сборке.
    expect(errors.mock.calls.some(([m]) => String(m).includes('change in the order of Hooks'))).toBe(true);

    errors.mockClear();
    // Тот же исходник, но имя `useContext` в нём ведёт к `React.use`.
    const api = { ...reactApi(), useContext: React.use } as HooksApi;
    const run = await (async () => {
      const exposed = new Map<string, () => void>();
      const App = loadScenario(COND_CONTEXT_CODE, api, () => {}, (n, fn) => exposed.set(n, fn));
      const container = new FakeElement('div');
      const root = client.createRoot(container as unknown as HTMLElement);
      root.render(React.createElement(App as () => null));
      await settle();
      exposed.get('on')!();
      await settle();
      return container.childNodes.map(fakeHtml).join('');
    })();
    expect(run).toBe('<p>светлая!</p>');
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});

describe('правило хуков: тексты ошибок у обоих одни', () => {
  it('хуков больше, чем в прошлый раз; меньше; вне компонента', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const GROW = `function App() {
      const [on, setOn] = useState(false);
      expose('go', () => setOn(true));
      if (on) useState('лишний');
      return h('p', null, String(on));
    }`;
    const SHRINK = `function App() {
      const [on, setOn] = useState(false);
      expose('go', () => setOn(true));
      if (on) return h('p', null, 'рано');
      useState('последний');
      return h('p', null, 'поздно');
    }`;

    for (const [code, message] of [
      [GROW, 'Rendered more hooks than during the previous render'],
      [SHRINK, 'Rendered fewer hooks than expected'],
    ] as const) {
      const react = await runReact(code);
      const mini = runMini(code);
      await expect(react.act('go')).rejects.toThrow(message);
      expect(() => mini.act('go')).toThrow(message);
      await settle().catch(() => {});
    }

    const mini = runMini(SCENARIO_CELLS);
    expect(() => React.useState(0)).toThrow('Invalid hook call');
    expect(() => (mini.mini.useState as (x: number) => unknown)(0)).toThrow('Invalid hook call');
    errors.mockRestore();
  });

  it('STEP_DISPATCHER держит обе ветки: mount и update', () => {
    expect(STEP_DISPATCHER).toContain('HooksDispatcherOnMount');
    expect(STEP_DISPATCHER).toContain('HooksDispatcherOnUpdate');
  });
});

/* ────────────────────────── Намеренные отличия — зафиксированы ────────────────────────── */

describe('где мини-версия отличается от React намеренно', () => {
  /**
   * Срочное обновление посреди перехода мини-версия рендерит **вместе** с переходом: у неё одна
   * очередь дорожек на всё. React рендерит срочное отдельно, а переход — следующим рендером.
   * Экранов с разрывом нет ни у одного; разница — в числе коммитов.
   */
  it('срочное посреди перехода: React — два коммита, мини-версия — один', async () => {
    const react = await runReact(SCENARIO_TEAR_SYNC);
    const mini = runMini(SCENARIO_TEAR_SYNC);
    react.screens.length = 0;
    mini.screens.length = 0;
    await react.interleave('transition', 1, 'storeSet');
    mini.interleave('transition', 1, 'storeSet');
    expect(react.screens).toEqual(TEAR_UPDATE_SCREENS.sync);
    expect(mini.screens).toEqual(TEAR_UPDATE_SCREENS.sync.slice(-1));
  });

  /**
   * `createElement` из «React изнутри» заворачивает текст в элемент, и у `memo` над текстовыми
   * детьми массив детей каждый раз новый. React держит текст строкой и пропускает.
   */
  it('memo над текстовыми детьми: React пропускает, мини-версия — нет', async () => {
    const react = await runReact(MEMO_TEXT_CODE);
    const mini = runMini(MEMO_TEXT_CODE);
    expect(await step(react, 'bump')).toEqual(['render App']);
    expect(await step(mini as unknown as Run, 'bump')).toEqual(['render App', 'render Label']);
  });

  /**
   * `getSnapshot`, возвращающий новый объект, зацикливает обоих. React останавливается на
   * счётчике вложенных обновлений, мини-версия — на предохранителе очередей.
   */
  it('некешированный getSnapshot: у React — «Maximum update depth», у мини — предохранитель', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(runReact(UNCACHED_SNAPSHOT_CODE)).rejects.toThrow('Maximum update depth exceeded');
    // ⚠️ Предупреждение — только в отладочной сборке React.
    expect(errors.mock.calls.some(([m]) => String(m).includes('getSnapshot should be cached'))).toBe(true);
    await settle().catch(() => {});
    errors.mockRestore();
    expect(() => runMini(UNCACHED_SNAPSHOT_CODE)).toThrow(/не опустели/);
  });
});

/* ─────────────────────────────── Модель демо ─────────────────────────────── */

describe('модель демо mini-hooks', () => {
  it('у каждого действия сценария есть ручка', () => {
    for (const scenario of DEMO_SCENARIOS) {
      const run = runMini(scenario.code);
      for (const action of scenario.actions) {
        expect(run.exposed.has(action.name), `${scenario.key}: ${action.name}`).toBe(true);
        if (action.interleave) expect(run.exposed.has(action.interleave.then)).toBe(true);
      }
    }
  });

  it('протокол детерминирован, последний кадр совпадает с прогоном без демо', () => {
    for (const scenario of DEMO_SCENARIOS) {
      const a = createSession(MINI_HOOKS_CODE, scenario);
      const b = createSession(MINI_HOOKS_CODE, scenario);
      const plain = runMini(scenario.code);
      for (const action of scenario.actions) {
        a.act(action);
        b.act(action);
        if (action.interleave) plain.interleave(action.name, action.interleave.afterLogs, action.interleave.then);
        else plain.act(action.name);
      }
      expect(a.frames.length, scenario.key).toBeGreaterThan(5);
      expect(JSON.stringify(a.frames), scenario.key).toBe(JSON.stringify(b.frames));
      expect(a.frames.at(-1)!.screen, scenario.key).toBe(plain.html());
      expect(a.logs, scenario.key).toEqual(plain.logs);
    }
  });

  it('ячейки в демо: useContext без ячейки, useMemo из кеша при постороннем состоянии', () => {
    const session = createSession(MINI_HOOKS_CODE, DEMO_SCENARIOS.find((s) => s.key === 'cells')!);
    session.act({ name: 'tick', label: '' });
    const row = session.frames.at(-1)!.rows.find((r) => r.label === 'Search')!;
    expect(row.cells.map((c) => c.type)).toEqual(['useState', 'useState', 'useRef', 'useMemo', 'useCallback', 'useEffect']);
    expect(row.contexts).toEqual(['Theme']);
    expect(row.cells.find((c) => c.type === 'useMemo')!.note).toBe('из кеша');
    expect(row.cells.find((c) => c.type === 'useCallback')!.note).toBe('та же функция');
  });

  it('контекст в демо: Toolbar пропущен со спуском, UserBadge не тронут', () => {
    const session = createSession(MINI_HOOKS_CODE, DEMO_SCENARIOS.find((s) => s.key === 'context')!);
    session.act({ name: 'theme', label: '' });
    const rows = session.frames.at(-1)!.rows;
    const status = (label: string) => rows.find((r) => r.label === label)!.status;
    expect(status('memo(Toolbar)')).toBe('descend');
    expect(status('memo(Sidebar)')).toBe('skip');
    expect(status('ThemeLabel')).toBe('render');
    expect(status('LangLabel')).toBe('render');
    expect(status('UserBadge')).toBe('skip');
  });

  it('разрыв в демо: без хука последний экран разорван, с хуком — нет', () => {
    for (const [key, torn] of [
      ['tear-plain', true],
      ['tear-sync', false],
    ] as const) {
      const scenario = DEMO_SCENARIOS.find((s) => s.key === key)!;
      const session = createSession(MINI_HOOKS_CODE, scenario);
      session.act(scenario.actions[0]);
      expect(isTorn(session.frames.at(-1)!.screen), key).toBe(torn);
      expect(session.frames.some((f) => f.kind === 'interleave'), key).toBe(true);
    }
  });
});

/* ──────────────── Устройство React, на которое ссылается «Чего в мини-версии нет» ──────────────── */

/**
 * Строки таблицы про диспетчеры, контекст и проверку стора — не о выводе, а об устройстве.
 * Сверить их прогоном нельзя, поэтому они сверяются с установленной **продакшен-сборкой**
 * `react-dom` 19.3: функции с этими именами есть, и стоят там, где сказано в теме. Обновится
 * React и переедет механизм — покраснеет здесь, а не останется неправдой на странице.
 */
describe('устройство React 19.3 по его сборке', () => {
  // Путь в обход `exports`: подпути `cjs/*` пакет наружу не объявляет.
  const pkg = createRequire(import.meta.url).resolve('react-dom/package.json');
  const build = readFileSync(new URL('cjs/react-dom-client.production.js', `file://${pkg}`), 'utf8');
  /** Тело функции верхнего уровня: от объявления до следующего `\nfunction `. */
  const body = (name: string) => {
    const start = build.indexOf(`\nfunction ${name}(`);
    expect(start, `в сборке нет функции ${name}`).toBeGreaterThan(-1);
    return build.slice(start, build.indexOf('\nfunction ', start + 1));
  };

  it('четыре диспетчера; вне рендера — заглушки, кроме use и readContext', () => {
    for (const name of ['HooksDispatcherOnMount', 'HooksDispatcherOnUpdate', 'HooksDispatcherOnRerender', 'ContextOnlyDispatcher']) {
      expect(build).toContain(`${name} = {`);
    }
    // Тема называет два «лишних» диспетчера по имени и говорит, что всего их четыре.
    expect(DISPATCHER_REACT_NOTE).toContain('четыре');
    expect(DISPATCHER_REACT_NOTE).toContain('`HooksDispatcherOnRerender`');
    expect(DISPATCHER_REACT_NOTE).toContain('`ContextOnlyDispatcher`');
    const only = build.slice(build.indexOf('ContextOnlyDispatcher = {'), build.indexOf('HooksDispatcherOnMount = {'));
    expect(only).toContain('use: use,');
    expect(only).toContain('readContext: readContext,');
    expect(only).toContain('useState: throwInvalidHookError');
    expect(only).toContain('useContext: throwInvalidHookError');
  });

  it('setState в теле: повтор не больше 25 раз', () => {
    const again = body('renderWithHooksAgain');
    expect(again).toContain('25 <= numberOfReRenders');
    expect(again).toContain('HooksDispatcherOnRerender');
    expect(DISPATCHER_REACT_NOTE).toContain('25 раз');
  });

  it('контекст распространяется лениво: провайдер ничего не обходит, обход начинает bailout', () => {
    expect(body('updateContextProvider')).not.toMatch(/propagate/);
    expect(body('bailoutOnAlreadyFinishedWork')).toContain('propagateParentContextChanges(');
    const row = DIFF.rows.find(([what]) => what === 'Распространение контекста')!;
    expect(row[2]).toContain('propagateParentContextChanges');
  });

  it('проверка стора — обход дерева, снимки в updateQueue.stores', () => {
    expect(body('isRenderConsistentWithExternalStores')).toContain('.stores');
    expect(body('dispatchSetStateInternal')).toMatch(/0 === fiber\.lanes &&\s*\(null === alternate \|\| 0 === alternate\.lanes\)/);
  });
});
