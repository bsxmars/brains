import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  DEFERRED_LOG,
  DEMO_SCENARIOS,
  INTERRUPT_LOG,
  MINI_LANES_CODE,
  PENDING_LOG,
  REBASE_LOG,
  SCENARIO_ASYNC,
  SCENARIO_DEFERRED,
  SCENARIO_INTERRUPT,
  SCENARIO_PENDING,
  SCENARIO_REBASE,
  SCENARIO_STARVE,
  SCENARIO_STRICT,
  SCENARIO_SUSPENSE,
  STARVE_FACTS,
  SYNC_BATCH_LOG,
} from '@/content/frameworks/react-concurrent-internals/data';
import { buildMiniLanes, loadScenario } from '@/widgets/mini-lanes/model/build';
import { createClockHost } from '@/widgets/mini-lanes/model/host';
import { createSession } from '@/widgets/mini-lanes/model/session';
import type { LanesScenarioApi } from '@/widgets/mini-lanes/model/types';

/**
 * «React изнутри: конкурентность и lanes»: мини-реализация темы против настоящего React 19.3.
 *
 * Исполняется **та же строка** `MINI_LANES_CODE`, что напечатана в теме, и те же исходники
 * сценариев (`SCENARIO_*`) — у мини-версии с её хуками, у React — с его хуками.
 *
 * **Как наблюдать конкурентный React без таймеров.** Под `act` React рендерит переходы
 * синхронным циклом (`workLoopSync`, если `actQueue` не пуст) — прерывания там не бывает
 * вовсе, это проверено чтением `react-dom-client.development.js`. Поэтому здесь `act` нет,
 * а планировщик подменён на `scheduler/unstable_mock` — тот самый, на котором пишет тесты
 * команда React. Он лежит в `node_modules/scheduler` рядом с настоящим и отличается одним:
 * время и уступки задаёт тест. `shouldYield` отвечает «пора», когда компоненты вывели
 * заданное число строк (`unstable_flushNumberOfYields`), а часы двигает `unstable_advanceTime`.
 * Ни `performance.now()`, ни настоящих таймеров в прогоне нет — это те же виртуальные часы,
 * что у мини-версии, только чужие.
 *
 * Подмена делается через `require.cache` до первой загрузки `react-dom`: он берёт планировщик
 * `require("scheduler")` один раз, при загрузке. Первая проверка ниже удостоверяется, что
 * подмена сработала, — иначе все остальные проверяли бы не то.
 *
 * Срочное событие — `window.event = { type: 'click' }` на время вызова: так React DOM
 * узнаёт приоритет события (`getCurrentEventPriority` смотрит на тип `window.event`),
 * и `setState` получает `SyncLane`. Без события `setState` получает `DefaultLane`.
 *
 * `vitest` выставляет `NODE_ENV=test`, и React отдаёт **отладочную** сборку. От сборки здесь
 * зависит одна проверка — про StrictMode; она помечена.
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
  event: undefined as undefined | { type: string },
  addEventListener() {},
  removeEventListener() {},
};
fakeDocument.defaultView = fakeWindow;

/** Разметка без атрибутов — в том же виде, что `toMarkup` у мини-версии. */
function fakeHtml(node: FakeNode): string {
  if (node.nodeType === 3) return node.nodeValue ?? '';
  const el = node as FakeElement;
  return `<${el.localName}>${el.childNodes.map(fakeHtml).join('')}</${el.localName}>`;
}

/* ─────────────────────────── React с подменённым планировщиком ─────────────────────────── */

type ReactModule = typeof import('react');
type ClientModule = typeof import('react-dom/client');

interface MockScheduler {
  log: (value: unknown) => void;
  unstable_clearLog: () => unknown[];
  unstable_flushAllWithoutAsserting: () => boolean;
  unstable_flushNumberOfYields: (count: number) => void;
  unstable_advanceTime: (ms: number) => void;
  unstable_hasPendingWork: () => boolean;
  unstable_now: () => number;
}

let React: ReactModule;
let client: ClientModule;
let Scheduler: MockScheduler;

beforeAll(() => {
  const require = createRequire(import.meta.url);
  Scheduler = require('scheduler/unstable_mock');
  // До первой загрузки react-dom: он берёт планировщик один раз, при загрузке модуля.
  for (const id of Object.keys(require.cache)) {
    if (/[\\/]node_modules[\\/](react-dom|scheduler)[\\/]/.test(id) && !id.includes('unstable_mock')) {
      delete require.cache[id];
    }
  }
  const realScheduler = require.resolve('scheduler');
  require.cache[realScheduler] = {
    id: realScheduler,
    filename: realScheduler,
    loaded: true,
    exports: Scheduler,
  } as unknown as NodeJS.Module;
  Object.assign(globalThis, { window: fakeWindow, document: fakeDocument });
  React = require('react');
  client = require('react-dom/client');
});

afterAll(() => {
  const g = globalThis as Record<string, unknown>;
  delete g.window;
  delete g.document;
});

/** Дать отработать микрозадачам React: он заказывает работу корня из микрозадачи. */
async function microtasks() {
  for (let i = 0; i < 10; i += 1) await null;
}

/** Довести всё до конца: микрозадачи, задачи планировщика, снова микрозадачи. */
async function settle() {
  for (let i = 0; i < 20; i += 1) {
    await microtasks();
    if (!Scheduler.unstable_flushAllWithoutAsserting()) {
      await microtasks();
      if (!Scheduler.unstable_hasPendingWork()) return;
    }
  }
  throw new Error('React не успокоился за 20 оборотов');
}

type EventKind = 'discrete' | 'default';

async function runReact(code: string, wrap?: (app: unknown) => unknown) {
  Scheduler.unstable_clearLog();
  const logs: string[] = [];
  const exposed = new Map<string, () => void>();
  const api = {
    h: React.createElement,
    useState: React.useState,
    useTransition: React.useTransition,
    useDeferredValue: React.useDeferredValue,
    startTransition: React.startTransition,
    Suspense: React.Suspense,
  } as unknown as LanesScenarioApi;
  const App = loadScenario(
    code,
    api,
    (line) => {
      logs.push(line);
      Scheduler.log(line);
    },
    (ms) => Scheduler.unstable_advanceTime(ms),
    (name, fn) => exposed.set(name, fn),
  );
  const container = new FakeElement('div');
  const root = client.createRoot(container as unknown as HTMLElement);
  const app = React.createElement(App as () => null);
  root.render((wrap ? wrap(app) : app) as never);
  await settle();
  Scheduler.unstable_clearLog();
  // Лог монтирования — отдельно: проверки ниже смотрят на то, что было после действия.
  const mountLogs = logs.splice(0);
  return {
    logs,
    mountLogs,
    root,
    html: () => container.childNodes.map(fakeHtml).join(''),
    /** Вызвать ручку сценария внутри события нужного вида — без ожидания рендера. */
    fire(name: string, kind: EventKind) {
      fakeWindow.event = kind === 'discrete' ? { type: 'click' } : undefined;
      try {
        exposed.get(name)!();
      } finally {
        fakeWindow.event = undefined;
      }
    },
  };
}

function runMini(code: string) {
  const logs: string[] = [];
  const exposed = new Map<string, () => void>();
  const clock = createClockHost();
  const mini = buildMiniLanes(MINI_LANES_CODE, clock.host);
  const App = loadScenario(
    code,
    mini,
    (line) => void logs.push(line),
    (ms) => clock.advance(ms),
    (name, fn) => exposed.set(name, fn),
  );
  mini.render(mini.h(App));
  clock.drain();
  const mountLogs = logs.splice(0);
  return {
    logs,
    mountLogs,
    mini,
    clock,
    exposed,
    html: clock.markup,
    fire(name: string, kind: EventKind) {
      const fn = exposed.get(name)!;
      if (kind === 'discrete') mini.discreteUpdates(fn);
      else fn();
    },
    /** Крутить очереди, пока лог не дорастёт до `count` строк (или работа не кончится). */
    runUntilLogs(count: number) {
      let guard = 0;
      while (logs.length < count && clock.runOne()) if (++guard > 10_000) throw new Error('не дорос');
    },
    /** Выполнить только микрозадачи — «конец текущей макрозадачи». */
    flushMicrotasks() {
      while (clock.micro()) clock.runOne();
    },
  };
}

/* ─────────────────────────────── Подмена сработала ─────────────────────────────── */

describe('стенд: React работает на подменённом планировщике', () => {
  it('переход не рендерится, пока тест не отпустит планировщик', async () => {
    const react = await runReact(SCENARIO_INTERRUPT);
    react.fire('transition', 'default');
    await microtasks();
    expect(react.logs).toEqual([]);
    expect(Scheduler.unstable_hasPendingWork()).toBe(true);
    await settle();
    expect(react.html()).toContain('x0');
  });

  it('полосы корня: 2 у клика, 32 без события, 256 у перехода — те же биты, что в STEP_LANES', async () => {
    const react = await runReact(SCENARIO_INTERRUPT);
    const internal = (react.root as unknown as { _internalRoot: { pendingLanes: number } })._internalRoot;
    const mini = runMini(SCENARIO_INTERRUPT);
    const pendingOf = () => mini.mini.inspect().root.pendingLanes;

    react.fire('input', 'discrete');
    mini.fire('input', 'discrete');
    expect(internal.pendingLanes).toBe(2);
    expect(pendingOf()).toBe(2);
    await settle();
    mini.clock.drain();

    react.fire('input', 'default');
    mini.fire('input', 'default');
    expect(internal.pendingLanes).toBe(32);
    expect(pendingOf()).toBe(32);
    await settle();
    mini.clock.drain();

    // У React полос перехода несколько, и каждый новый startTransition берёт следующую
    // по кругу — поэтому точное число зависит от того, сколько переходов было до этого.
    // Проверяется класс: один бит из диапазона переходов, начиная с 256.
    react.fire('transition', 'discrete');
    mini.fire('transition', 'discrete');
    const lane = internal.pendingLanes;
    expect(lane & (lane - 1)).toBe(0);
    expect(lane).toBeGreaterThanOrEqual(256);
    expect(lane).toBeLessThan(1 << 18);
    expect(pendingOf()).toBe(256);
    expect(mini.mini.lanes).toEqual({
      SyncLane: 2,
      InputContinuousLane: 8,
      DefaultLane: 32,
      TransitionLane: 256,
      RetryLane: 4194304,
    });
  });
});

/* ─────────────────────────── Поведение: одинаково у обоих ─────────────────────────── */

describe('мини-версия и React 19.3 на одних и тех же сценариях', () => {
  it('срочный ввод посреди перехода: начатое выброшено, App вызван заново, итог тот же', async () => {
    const react = await runReact(SCENARIO_INTERRUPT);
    react.fire('transition', 'default');
    await microtasks();
    // Четыре строки лога — и планировщик говорит «уступи»: App и три строки списка.
    Scheduler.unstable_flushNumberOfYields(4);
    expect(react.logs).toEqual(INTERRUPT_LOG.slice(0, 4));
    react.fire('input', 'discrete');
    await settle();
    expect(react.logs).toEqual(INTERRUPT_LOG);

    // У мини-версии уступает квант в 5 мс: App и три строки по 2 мс — те же четыре строки.
    const mini = runMini(SCENARIO_INTERRUPT);
    mini.fire('transition', 'default');
    mini.runUntilLogs(4);
    mini.flushMicrotasks();
    expect(mini.logs).toEqual(INTERRUPT_LOG.slice(0, 4));
    expect(mini.clock.markup()).not.toContain('x0'); // рендер начат, на экране — прежнее
    mini.fire('input', 'discrete');
    mini.clock.drain();
    expect(mini.logs).toEqual(INTERRUPT_LOG);

    const expected = '<div><p>ввод: a</p><ul><li>x0</li><li>x1</li><li>x2</li><li>x3</li><li>x4</li><li>x5</li></ul></div>';
    expect(react.html()).toBe(expected);
    expect(mini.html()).toBe(expected);
  });

  it('без прерывания итог тот же: прерывание меняет число вызовов, а не результат', async () => {
    const react = await runReact(SCENARIO_INTERRUPT);
    react.fire('transition', 'default');
    react.fire('input', 'discrete');
    await settle();
    const mini = runMini(SCENARIO_INTERRUPT);
    mini.fire('transition', 'default');
    mini.fire('input', 'discrete');
    mini.clock.drain();
    expect(react.html()).toBe(mini.html());
    expect(mini.html()).toContain('ввод: a');
    expect(mini.html()).toContain('x5');
  });

  it('DefaultLane не прерывает переход: переход доделывается и коммитится первым', async () => {
    const expected = [
      ...INTERRUPT_LOG.slice(0, 4),
      'Item 3 query="x"',
      'Item 4 query="x"',
      'Item 5 query="x"',
      'App text="a" query="x"',
      ...[0, 1, 2, 3, 4, 5].map((i) => `Item ${i} query="x"`),
    ];

    const react = await runReact(SCENARIO_INTERRUPT);
    react.fire('transition', 'default');
    await microtasks();
    Scheduler.unstable_flushNumberOfYields(4);
    react.fire('input', 'default');
    await settle();
    expect(react.logs).toEqual(expected);

    const mini = runMini(SCENARIO_INTERRUPT);
    mini.fire('transition', 'default');
    mini.runUntilLogs(4);
    mini.flushMicrotasks();
    mini.fire('input', 'default');
    mini.clock.drain();
    expect(mini.logs).toEqual(expected);
  });

  it('два обновления одного состояния в разных полосах: сначала S, потом TS — порядок сохранён', async () => {
    const react = await runReact(SCENARIO_REBASE);
    const mini = runMini(SCENARIO_REBASE);
    react.logs.length = 0;
    mini.logs.length = 0;

    react.fire('both', 'discrete');
    await settle();
    mini.fire('both', 'discrete');
    mini.clock.drain();

    expect(react.logs).toEqual(REBASE_LOG);
    expect(mini.logs).toEqual(react.logs);
  });

  it('useTransition: сначала срочный рендер с isPending=true и прежним состоянием, потом переход', async () => {
    const react = await runReact(SCENARIO_PENDING);
    const mini = runMini(SCENARIO_PENDING);
    react.logs.length = 0;
    mini.logs.length = 0;

    react.fire('switch', 'discrete');
    await microtasks();
    expect(react.html()).toBe('<p>a …</p>');
    await settle();
    mini.fire('switch', 'discrete');
    mini.flushMicrotasks();
    expect(mini.html()).toBe('<p>a …</p>');
    mini.clock.drain();

    expect(react.logs).toEqual(PENDING_LOG);
    expect(mini.logs).toEqual(react.logs);
    expect(react.html()).toBe('<p>b</p>');
    expect(mini.html()).toBe('<p>b</p>');
  });

  it('useDeferredValue: два рендера на одно изменение — срочный с прежним значением и несрочный', async () => {
    const react = await runReact(SCENARIO_DEFERRED);
    const mini = runMini(SCENARIO_DEFERRED);
    react.logs.length = 0;
    mini.logs.length = 0;

    react.fire('bump', 'discrete');
    await microtasks();
    expect(react.html()).toBe('<div><p>1</p><b>0</b></div>');
    await settle();
    mini.fire('bump', 'discrete');
    mini.flushMicrotasks();
    expect(mini.html()).toBe('<div><p>1</p><b>0</b></div>');
    mini.clock.drain();

    expect(react.logs).toEqual(DEFERRED_LOG);
    expect(mini.logs).toEqual(DEFERRED_LOG);
  });

  it('Suspense: заглушка, потом содержимое; переход держит прежнюю страницу и isPending', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const react = await runReact(SCENARIO_SUSPENSE);
    const mini = runMini(SCENARIO_SUSPENSE);
    const both = () => [react.html(), mini.html()];

    expect(both()).toEqual(['<div><i>загрузка…</i></div>', '<div><i>загрузка…</i></div>']);

    // React придерживает показ содержимого на 300 мс после заглушки (FALLBACK_THROTTLE_MS)
    // и считает их по часам планировщика — подвигаем виртуальные часы, а не ждём.
    Scheduler.unstable_advanceTime(500);
    react.fire('resolve', 'default');
    await settle();
    mini.fire('resolve', 'default');
    mini.clock.drain();
    expect(both()).toEqual(['<div><p>первая страница</p></div>', '<div><p>первая страница</p></div>']);

    react.fire('next', 'discrete');
    await settle();
    mini.fire('next', 'discrete');
    mini.clock.drain();
    const waiting = '<div><p>первая страница</p><i>грузим вторую…</i></div>';
    expect(both()).toEqual([waiting, waiting]);

    Scheduler.unstable_advanceTime(500);
    react.fire('resolve', 'default');
    await settle();
    mini.fire('resolve', 'default');
    mini.clock.drain();
    expect(both()).toEqual(['<div><p>вторая страница</p></div>', '<div><p>вторая страница</p></div>']);

    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it('голодание: переход, который прерывают после каждого кванта, через 5 с рендерится без уступок', async () => {
    // React: две строки — и уступить; но после 6 с виртуального времени полоса просрочена,
    // и тот же запрет на работу уже не действует — рендер идёт до конца.
    const react = await runReact(SCENARIO_STARVE);
    react.fire('transition', 'default');
    await microtasks();
    Scheduler.unstable_flushNumberOfYields(2);
    expect(react.logs).toEqual(['App text="" query="x"', 'Item 0 query="x"']);
    // Счёт уступок у поддельного планировщика — по строкам с последней очистки его лога.
    react.logs.length = 0;
    Scheduler.unstable_clearLog();
    Scheduler.unstable_flushNumberOfYields(1);
    expect(react.logs).toEqual(['Item 1 query="x"']); // контроль: без просрочки уступает сразу
    react.logs.length = 0;
    Scheduler.unstable_clearLog();
    Scheduler.unstable_advanceTime(6000);
    Scheduler.unstable_flushNumberOfYields(1);
    expect(react.logs).toHaveLength(6); // Item 2…7 — без единой уступки
    expect(react.html()).toContain('x7');

    // Мини-версия: срочный ввод после каждого кванта — пока переход не просрочится.
    const mini = runMini(SCENARIO_STARVE);
    mini.fire('transition', 'default');
    let restarts = 0;
    let lastPass: string[];
    for (;;) {
      if (restarts > 200) throw new Error('переход так и не закоммитился');
      const before = mini.logs.length;
      mini.clock.runOne(); // один заход планировщика
      mini.flushMicrotasks();
      lastPass = mini.logs.slice(before);
      if (mini.html().includes('x7')) break;
      restarts += 1;
      mini.fire('input', 'discrete'); // и сразу срочный ввод
      mini.flushMicrotasks();
    }
    expect(restarts).toBe(STARVE_FACTS.restarts);
    expect(mini.clock.time()).toBe(STARVE_FACTS.committedAt);
    // Последний заход — весь переход одним куском: App и восемь строк, без уступки.
    expect(lastPass).toHaveLength(9);
    expect(lastPass.every((line) => line.includes('query="x"'))).toBe(true);
  });

  it('async startTransition: обновление после await получает DefaultLane — у обоих', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const react = await runReact(SCENARIO_ASYNC);
    const internal = (react.root as unknown as { _internalRoot: { pendingLanes: number } })._internalRoot;
    const mini = runMini(SCENARIO_ASYNC);
    const miniPending = () => mini.mini.inspect().root.pendingLanes;

    react.fire('action', 'default');
    mini.fire('action', 'default');
    // Синхронная часть колбэка — в полосе перехода, и больше ничего.
    expect(internal.pendingLanes & 32).toBe(0);
    expect(internal.pendingLanes).toBeGreaterThanOrEqual(256);
    expect(miniPending()).toBe(256);

    await microtasks(); // await внутри колбэка прошёл
    expect(internal.pendingLanes & 32).toBe(32);
    expect(miniPending() & 32).toBe(32);

    await settle();
    mini.clock.drain();
    expect(react.html()).toBe('<p>после await</p>');
    expect(mini.html()).toBe('<p>после await</p>');
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});

/* ─────────────────────────── Чистота рендера ─────────────────────────── */

describe('почему тело компонента обязано быть чистым', () => {
  // ⚠️ Зависит от сборки: двойной вызов StrictMode есть только в отладочной сборке React.
  it('StrictMode в отладочной сборке зовёт функцию дважды на один рендер', async () => {
    const react = await runReact(SCENARIO_STRICT, (app) => React.createElement(React.StrictMode, null, app as never));
    expect(react.mountLogs).toEqual(['вызов 1', 'вызов 2']);
    // Счётчик в теле насчитал два вызова на один коммит — и это попало на экран.
    expect(react.html()).toBe('<p>вызовов: 2</p>');
  });
});

/* ──────────────────────────── Намеренные отличия ──────────────────────────── */

describe('где мини-версия отличается от React намеренно', () => {
  /**
   * React 19 после показа заглушки ещё раз рендерит приостановившееся поддерево —
   * «предпрогрев» (pre-warming): так он успевает заказать данные соседей. У мини-версии
   * этого прохода нет, поэтому `Page 0` на монтировании она зовёт один раз, React — дважды.
   */
  it('Suspense на монтировании: React зовёт приостановившийся компонент дважды, мини-версия — раз', async () => {
    const react = await runReact(SCENARIO_SUSPENSE);
    const mini = runMini(SCENARIO_SUSPENSE);
    const pageCalls = (logs: string[]) => logs.filter((line) => line === 'render Page 0').length;
    expect(pageCalls(react.mountLogs)).toBe(2);
    expect(pageCalls(mini.mountLogs)).toBe(1);
  });

  /** Мини-версия рендерит всё дерево от корня: bailout нет — как и в «React изнутри». */
  it('срочный ввод перерисовывает у мини-версии весь список — и у React без memo тоже', async () => {
    const react = await runReact(SCENARIO_INTERRUPT);
    const mini = runMini(SCENARIO_INTERRUPT);
    react.logs.length = 0;
    mini.logs.length = 0;
    react.fire('input', 'discrete');
    await settle();
    mini.fire('input', 'discrete');
    mini.clock.drain();
    expect(mini.logs).toEqual(react.logs);
    expect(mini.logs).toHaveLength(7);
  });

  /**
   * В React 19.3 `SyncLane`, `InputContinuousLane` и `DefaultLane` рендерятся **пачкой**:
   * `getHighestPriorityLanes` начинается с `lanes & 42` (42 = 2 | 8 | 32). Мини-версия берёт
   * одну полосу за раз, поэтому клик поверх ещё не отрисованного таймерного обновления
   * даёт у неё два рендера, а у React — один. Итог одинаков.
   */
  it('таймер и клик до рендера: React рендерит обе полосы одним проходом, мини-версия — двумя', async () => {
    const react = await runReact(SCENARIO_INTERRUPT);
    const mini = runMini(SCENARIO_INTERRUPT);
    react.logs.length = 0;
    mini.logs.length = 0;

    react.fire('input', 'default');
    react.fire('input', 'discrete');
    await settle();
    mini.fire('input', 'default');
    mini.fire('input', 'discrete');
    mini.clock.drain();

    const apps = (logs: string[]) => logs.filter((line) => line.startsWith('App'));
    expect(apps(react.logs)).toEqual(SYNC_BATCH_LOG.react);
    expect(apps(mini.logs)).toEqual(SYNC_BATCH_LOG.mini);
    expect(react.html()).toBe(mini.html());
  });
});

/* ─────────────────────────────── Модель демо ─────────────────────────────── */

describe('модель демо mini-lanes', () => {
  const byKey = (key: string) => DEMO_SCENARIOS.find((item) => item.key === key)!;
  const runToIdle = (session: ReturnType<typeof createSession>) => {
    let guard = 0;
    while (session.step() >= 0) if (++guard > 5000) throw new Error('демо не успокоилось');
  };

  it('у каждой кнопки демо есть ручка в сценарии', () => {
    for (const scenario of DEMO_SCENARIOS) {
      const mini = runMini(scenario.code);
      for (const action of scenario.actions) expect(mini.exposed.has(action.name), action.label).toBe(true);
    }
  });

  it('протокол детерминирован: два прогона дают одинаковые кадры', () => {
    for (const scenario of DEMO_SCENARIOS) {
      const a = createSession(MINI_LANES_CODE, scenario);
      const b = createSession(MINI_LANES_CODE, scenario);
      for (const action of scenario.actions) {
        a.fire(action);
        b.fire(action);
        runToIdle(a);
        runToIdle(b);
      }
      expect(a.frames.length, scenario.key).toBeGreaterThan(5);
      expect(JSON.stringify(a.frames), scenario.key).toBe(JSON.stringify(b.frames));
    }
  });

  it('клик между квантами перехода: в протоколе выброшенное дерево, на шкале — выброшенный заход', () => {
    const scenario = byKey('interrupt');
    const session = createSession(MINI_LANES_CODE, scenario);
    const [transition, input] = scenario.actions;
    const from = session.fire(transition);
    // Шагаем, пока переход не уступит в первый раз (монтирование тоже уступало — его не считаем).
    let guard = 0;
    while (!session.frames.slice(from).some((f) => f.kind === 'yield') && ++guard < 50) session.step();
    const beforeClick = session.frames.at(-1)!;
    expect(beforeClick.renderLane).toBe(256);
    expect(beforeClick.wip.filter((row) => row.state === 'done').map((row) => row.label)).toEqual([
      'App',
      'Item 0',
      'Item 1',
      'Item 2',
    ]);

    session.fire(input);
    expect(session.frames.at(-1)!.pending).toBe(256 | 2);
    runToIdle(session);

    const last = session.frames.at(-1)!;
    expect(session.frames.slice(from).filter((f) => f.kind === 'restart')).toHaveLength(1);
    expect(last.restarts).toBe(1);
    expect(last.segments.some((seg) => seg.lane === 256 && seg.outcome === 'thrown')).toBe(true);
    expect(last.segments.some((seg) => seg.lane === 2 && seg.outcome === 'commit')).toBe(true);
    expect(last.segments.at(-1)!).toMatchObject({ lane: 256, outcome: 'commit' });
    expect(session.logs.slice(-INTERRUPT_LOG.length)).toEqual(INTERRUPT_LOG);
    expect(last.pending).toBe(0);
    expect(last.html).toContain('ввод: a');
    expect(last.html).toContain('x5');
  });

  it('последний кадр показывает то же, что прогон без демо', () => {
    for (const scenario of DEMO_SCENARIOS) {
      const session = createSession(MINI_LANES_CODE, scenario);
      const plain = runMini(scenario.code);
      for (const action of scenario.actions) {
        session.fire(action);
        runToIdle(session);
        plain.fire(action.name, action.event);
        plain.clock.drain();
      }
      expect(session.frames.at(-1)!.html, scenario.key).toBe(plain.html());
    }
  });

  it('Suspense в демо: заглушка, пинг RetryLane, переход засыпает и просыпается', () => {
    const scenario = byKey('suspense');
    const session = createSession(MINI_LANES_CODE, scenario);
    const [resolve, next] = scenario.actions;
    expect(session.frames.at(-1)!.html).toBe('<div><i>загрузка…</i></div>');

    session.fire(resolve);
    expect(session.frames.some((f) => f.kind === 'ping' && f.text.includes('RetryLane'))).toBe(true);
    runToIdle(session);
    expect(session.frames.at(-1)!.html).toBe('<div><p>первая страница</p></div>');

    session.fire(next);
    runToIdle(session);
    const asleep = session.frames.at(-1)!;
    expect(asleep.html).toBe('<div><p>первая страница</p><i>грузим вторую…</i></div>');
    expect(asleep.suspended).toBe(256);
    expect(asleep.pending & 256).toBe(256);

    session.fire(resolve);
    runToIdle(session);
    const awake = session.frames.at(-1)!;
    expect(awake.html).toBe('<div><p>вторая страница</p></div>');
    expect(awake.suspended).toBe(0);
    expect(awake.pending).toBe(0);
  });
});
