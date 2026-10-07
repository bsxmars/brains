/* eslint-disable vue/one-component-per-file -- компоненты здесь — подписчики стенда, а не модули приложения */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { configureStore, createSlice } from '@reduxjs/toolkit';
import { createStore as reduxCreateStore } from 'redux';
import { createSelector } from 'reselect';
import { createStore as zustandCreateStore } from 'zustand/vanilla';
import { subscribeWithSelector } from 'zustand/middleware';
import { shallow as zustandShallow } from 'zustand/vanilla/shallow';
import { afterAll, describe, expect, it } from 'vitest';
import * as t from '@/content/frameworks/state-managers/data';
import { createLab, initialState, LAB_COMPONENTS, loadDefineStore, loadMini, snapshotIsStable } from '@/widgets/store-lab/model/run';
import type { LabAction, LabMode, LabState, MiniStore, TrackedStore } from '@/widgets/store-lab/model/types';

/**
 * Тема «Стейт-менеджеры изнутри».
 *
 * Строки мини-реализации из темы (`STORE_CODE`, `REDUX_CODE`, `SELECTOR_CODE`, `HOOK_CODE`,
 * `PINIA_CODE`) исполняются здесь и сверяются с настоящими библиотеками на одной и той же
 * последовательности действий: redux 5, zustand 5 (vanilla, `subscribeWithSelector`, `create`
 * с React 19.3), pinia 4 с Vue 3.5. Таблицы темы (`NOTIFY_ROWS`, `SELECTOR_ROWS`,
 * `REACT_RENDERS`, `PINIA_RENDERS`) — литералы, и каждый сверяется с библиотекой и с мини-версией.
 * Демо (`widgets/store-lab`) проверено тем же модулем `run.ts`, что исполняет на странице.
 *
 * DOM — happy-dom в глобальной области, до первого рендера. React и zustand грузятся через
 * `require`, чтобы React был один (CJS); Vue и pinia — через `import`, по той же причине (pinia
 * есть только в ESM и сама импортирует `vue`). JSX примеров снимает TypeScript: плагина Babel
 * для JSX в проекте нет (см. `docs/agents/stack.md`).
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);

// ─── DOM ───────────────────────────────────────────────────────────────────────────────────

const win = new Window({ url: 'http://localhost/' });
const GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Text', 'Comment', 'DocumentFragment', 'Event', 'MouseEvent', 'SVGElement'] as const;
const saved = new Map<string, PropertyDescriptor | undefined>();
for (const key of GLOBALS) {
  saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  const value = key === 'window' ? win : (win as unknown as Record<string, unknown>)[key];
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}
afterAll(async () => {
  // Пассивные эффекты React планировщик доделывает в следующих макрозадачах — дать им дойти.
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  for (const [key, desc] of saved) {
    if (desc) Object.defineProperty(globalThis, key, desc);
    else delete (globalThis as Record<string, unknown>)[key];
  }
});
const doc = win.document as unknown as Document;

// Vue запоминает `document` при загрузке модуля, поэтому грузится только после подмены DOM.
const { computed, createApp, defineComponent, effect, effectScope, h, nextTick, reactive, toRefs } = await import('vue');
const { createPinia, defineStore: piniaDefineStore, setActivePinia, storeToRefs } = await import('pinia');

// ─── Мини-версия из темы ───────────────────────────────────────────────────────────────────

const mini = loadMini(t.STORE_CODE, t.SELECTOR_CODE);
const miniRedux = new Function(`${t.REDUX_CODE}\nreturn createReduxStore;`)() as typeof reduxCreateStore;
const reducer = new Function(`${t.REDUCER_CODE}\nreturn reducer;`)() as Parameters<typeof reduxCreateStore>[0];

/** Последовательность сквозного примера: пять действий над стором с `setState`. */
const SEQUENCE: [string, (s: LabState) => Partial<LabState> | LabState][] = [
  ['inc', (s) => ({ count: s.count + 1 })],
  ['rename', () => ({ user: { name: 'Боря' } })],
  ['sameCount', (s) => ({ count: s.count })],
  ['identity', (s) => s],
  ['addTodo', (s) => ({ todos: [...s.todos, 'хлеб'] })],
];

const captureLog = (fn: (log: (...a: unknown[]) => void) => void): string => {
  const out: string[] = [];
  fn((...a) => out.push(a.join(' ')));
  return out.join('\n');
};

describe('стор: createStore из темы против zustand/vanilla', () => {
  it('сквозной пример печатает USAGE_OUT — у обоих', () => {
    for (const createStore of [mini.createStore, zustandCreateStore]) {
      const out = captureLog((log) => new Function('createStore', 'console', t.USAGE_CODE)(createStore, { log }));
      expect(out).toBe(t.USAGE_OUT);
    }
  });

  it('на пяти действиях подписчика зовут одинаково: всё, кроме «того же состояния»', () => {
    const calls = (store: MiniStore) => {
      const out: number[] = [];
      let n = 0;
      store.subscribe(() => n++);
      for (const [, a] of SEQUENCE) {
        const was = n;
        store.setState(a);
        out.push(n - was);
      }
      return out;
    };
    const want = [1, 1, 1, 0, 1];
    expect(calls(mini.createStore(initialState))).toEqual(want);
    expect(calls(zustandCreateStore(initialState) as unknown as MiniStore)).toEqual(want);
  });

  it('слияние — новый объект, нетронутые ветки прежние', () => {
    for (const store of [mini.createStore(initialState), zustandCreateStore(initialState) as unknown as MiniStore]) {
      const before = store.getState();
      store.setState({ count: 5 });
      expect(store.getState()).not.toBe(before);
      expect(store.getState().user).toBe(before.user);
    }
  });
});

describe('Redux: createReduxStore из темы против redux.createStore', () => {
  const ACTIONS = [{ type: 'inc' }, { type: 'same' }, { type: 'rename', name: 'Боря' }, { type: 'unknown' }, { type: 'addTodo', text: 'хлеб' }];

  it('пять dispatch — пять вызовов подписчика у обоих, состояние одинаковое', () => {
    const run = (create: typeof reduxCreateStore) => {
      const store = create(reducer);
      let n = 0;
      store.subscribe(() => n++);
      for (const a of ACTIONS) store.dispatch(a);
      return { n, state: store.getState() };
    };
    const a = run(miniRedux);
    const b = run(reduxCreateStore);
    expect(a.n).toBe(5);
    expect(b.n).toBe(5);
    expect(a.state).toEqual(b.state);
    expect(t.REDUX_NOTE).toContain('пять вызовов подписчика');
  });

  it('NOTIFY_ROWS: Zustand молчит на «том же состоянии», Redux — нет', () => {
    expect(t.NOTIFY_ROWS[2].zustand).toContain('не зовёт');
    expect(t.NOTIFY_ROWS[2].redux).toContain('зовёт всех');
    const z = zustandCreateStore(initialState);
    let zn = 0;
    z.subscribe(() => zn++);
    z.setState((s) => s);
    const r = reduxCreateStore(reducer);
    let rn = 0;
    r.subscribe(() => rn++);
    r.dispatch({ type: 'unknown' });
    expect([zn, rn]).toEqual([0, 1]);
  });

  it('MUTATE_CODE: подписчик на s.todos не вызван, а в сторе уже два дела', () => {
    const [caseLines, usage] = t.MUTATE_CODE.split('\n\n');
    const mutating = t.REDUCER_CODE.replace(/case 'addTodo':\n.*\n/, `${caseLines}\n`);
    expect(mutating).toContain('state.todos.push');
    const mutReducer = new Function(`${mutating}\nreturn reducer;`)();
    for (const create of [miniRedux, reduxCreateStore]) {
      const store = create(mutReducer);
      let renders = 0;
      new Function('store', 'subscribeSelector', 'renderTodos', usage)(store, mini.subscribeSelector, () => renders++);
      expect(renders).toBe(0);
      expect((store.getState() as LabState).todos).toHaveLength(2);
    }
  });
});

describe('Redux Toolkit', () => {
  it('IMMER_CODE печатает IMMER_OUT: корень новый, user и todos — прежние', () => {
    const out = captureLog((log) =>
      new Function('createSlice', 'configureStore', 'console', t.IMMER_CODE)(createSlice, configureStore, { log }),
    );
    expect(out).toBe(t.IMMER_OUT);
  });

  it('состояние заморожено, запись мимо reducer — TypeError', () => {
    const slice = createSlice({ name: 'a', initialState: initialState(), reducers: { inc: (s) => void s.count++ } });
    const store = configureStore({ reducer: slice.reducer });
    expect(Object.isFrozen(store.getState())).toBe(true);
    expect(Object.isFrozen(store.getState().user)).toBe(true);
    expect(() => {
      (store.getState() as LabState).count = 9;
    }).toThrow(TypeError);
    expect(t.RTK_FACTS[0].d).toContain('Cannot assign to read only property');
  });

  it('черновик без изменений — тот же объект, а подписчик всё равно позван', () => {
    // eslint-disable-next-line no-self-assign -- запись того же значения и есть проверяемый случай
    const slice = createSlice({ name: 'a', initialState: initialState(), reducers: { same: (s) => void (s.count = s.count) } });
    const store = configureStore({ reducer: slice.reducer });
    let n = 0;
    store.subscribe(() => n++);
    const before = store.getState();
    store.dispatch(slice.actions.same());
    expect(store.getState()).toBe(before);
    expect(n).toBe(1);
  });

  it('мутация ловится в разработке — тексты из RTK_FACTS', () => {
    const mutReducer = (state = initialState(), action: { type: string }) => {
      if (action.type === 'mutate') state.count++;
      return state;
    };
    const inside = configureStore({ reducer: mutReducer });
    expect(() => inside.dispatch({ type: 'mutate' })).toThrow('A state mutation was detected inside a dispatch, in the path: count');
    const between = configureStore({ reducer: mutReducer });
    between.getState().user.name = 'X';
    expect(() => between.dispatch({ type: 'any' })).toThrow('detected between dispatches');
    expect(t.RTK_FACTS[1].d).toContain('A state mutation was detected inside a dispatch, in the path: count');
    expect(t.RTK_FACTS[1].d).toContain('detected between dispatches');
  });

  it('при NODE_ENV=production проверки мутаций нет', () => {
    const code = `
      import { configureStore } from '@reduxjs/toolkit';
      const r = (s = { count: 0 }, a) => { if (a.type === 'mutate') s.count++; return s; };
      const st = configureStore({ reducer: r });
      st.dispatch({ type: 'mutate' }); st.dispatch({ type: 'x' });
      console.log('молча', st.getState().count);`;
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', code], {
      cwd: ROOT,
      env: { ...process.env, NODE_ENV: 'production' },
      encoding: 'utf8',
    });
    expect(out.trim()).toBe('молча 1');
  });
});

describe('селектор: subscribeSelector из темы против subscribeWithSelector', () => {
  type Row = { calls: number; renders: number };
  const selectors: [(s: LabState) => unknown, boolean][] = [
    [(s) => s.count, false],
    [(s) => s.user.name, false],
    [(s) => ({ count: s.count, todos: s.todos.length }), false],
    [(s) => ({ count: s.count, todos: s.todos.length }), true],
  ];

  const run = (
    store: MiniStore,
    subscribe: (sel: (s: LabState) => unknown, listener: () => void, useShallow: boolean) => void,
  ): Row[] => {
    const rows = selectors.map(() => ({ calls: 0, renders: 0 }));
    selectors.forEach(([sel, sh], i) =>
      subscribe(
        (s) => {
          rows[i].calls++;
          return sel(s);
        },
        () => rows[i].renders++,
        sh,
      ),
    );
    for (const [, a] of SEQUENCE) store.setState(a);
    return rows;
  };

  it('SELECTOR_ROWS — у мини-версии и у zustand', () => {
    const want = t.SELECTOR_ROWS.map((r) => ({ calls: r.calls, renders: r.renders }));
    const m = mini.createStore(initialState);
    expect(run(m, (sel, l, sh) => mini.subscribeSelector(m, sel, l, sh ? mini.shallow : undefined))).toEqual(want);
    const z = zustandCreateStore(subscribeWithSelector(initialState));
    expect(
      run(z as unknown as MiniStore, (sel, l, sh) => z.subscribe(sel, l, sh ? { equalityFn: zustandShallow } : undefined)),
    ).toEqual(want);
    expect(t.SELECTOR_NOTE).toContain('Уведомлений было четыре');
    expect(t.SELECTOR_NOTE).toContain('вызван пять раз');
  });

  it('shallow из темы отвечает как shallow из zustand', () => {
    const cases: [unknown, unknown][] = [
      [{ a: 1 }, { a: 1 }],
      [{ a: 1 }, { a: 1, b: 2 }],
      [{ a: 1, b: 2 }, { a: 1, c: 2 }],
      [[1, 2], [1, 2]],
      [[1], [1, 2]],
      [{ a: {} }, { a: {} }],
      [NaN, NaN],
      [null, {}],
      [1, '1'],
    ];
    for (const [a, b] of cases) expect(mini.shallow(a, b), JSON.stringify([a, b])).toBe(zustandShallow(a, b));
  });

  it('тонкое место 02: .map в селекторе — 4 вызова слушателя из 4, reselect — 2 расчёта и 1 вызов', () => {
    const z = zustandCreateStore(subscribeWithSelector(initialState));
    let plain = 0;
    let memo = 0;
    const memoSel = createSelector([(s: LabState) => s.todos], (todos) => todos.map((x) => x.toUpperCase()));
    z.subscribe((s) => s.todos.map((x) => x.toUpperCase()), () => plain++);
    z.subscribe(memoSel, () => memo++);
    for (const [, a] of SEQUENCE) z.setState(a as never);
    expect([plain, memoSel.recomputations(), memo]).toEqual([4, 2, 1]);
    expect(t.PITFALLS[1].d).toContain('четыре раза из четырёх');
    expect(t.PITFALLS[1].d).toContain('два расчёта и один вызов');
  });
});

// ─── React ─────────────────────────────────────────────────────────────────────────────────

interface ReactLib {
  createElement: (...a: unknown[]) => unknown;
  useSyncExternalStore: unknown;
  useRef: unknown;
}
const React = require('react') as ReactLib;
const { createRoot } = require('react-dom/client') as { createRoot: (el: Element) => { render(n: unknown): void; unmount(): void } };
const { flushSync } = require('react-dom') as { flushSync: (fn: () => void) => void };
const zustand = require('zustand') as { create: (fn: unknown) => UseApp };
const { useShallow: zustandUseShallow } = require('zustand/react/shallow') as { useShallow: Hooks['useShallow'] };
const ts = require('typescript') as typeof import('typescript');

type UseApp = ((selector?: (s: LabState) => unknown) => unknown) & MiniStore;
interface Hooks {
  useStore: (store: MiniStore, selector?: (s: LabState) => unknown) => unknown;
  useShallow: (selector: (s: LabState) => unknown) => (s: LabState) => unknown;
}
const hooks = new Function('useSyncExternalStore', 'useRef', `${t.SELECTOR_CODE}\n${t.HOOK_CODE}\nreturn { useStore, useShallow };`)(
  React.useSyncExternalStore,
  React.useRef,
) as Hooks;

/** JSX → CommonJS тем же способом, что в `framework-compilers.test.ts`; наружу — экспорт и объявленные функции. */
function jsx(code: string, scope: Record<string, unknown>): Record<string, unknown> {
  const out = ts.transpileModule(code, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const names = [...code.matchAll(/^function (\w+)/gm)].map((m) => m[1]);
  const exports: Record<string, unknown> = {};
  const body = `${out}\nreturn { ...exports, ${names.join(', ')} };`;
  return new Function('require', 'exports', ...Object.keys(scope), body)(require, exports, ...Object.values(scope));
}

/** Два «стора с хуком»: настоящий `create` и мини-версия из темы, с одинаковым интерфейсом. */
function makeUseApps(): [string, UseApp, Hooks['useShallow']][] {
  const real = zustand.create(initialState);
  const store = mini.createStore(initialState);
  const fake = Object.assign((sel?: (s: LabState) => unknown) => hooks.useStore(store, sel), store) as UseApp;
  return [
    ['zustand', real, zustandUseShallow],
    ['мини', fake, hooks.useShallow],
  ];
}

function mount(node: unknown) {
  const el = doc.createElement('div');
  const root = createRoot(el);
  flushSync(() => root.render(node));
  return { el, root };
}

function withConsole<T>(fn: () => T): { result: T; errors: string[] } {
  const errors: string[] = [];
  const { error, warn } = console;
  console.error = (...a: unknown[]) => void errors.push(String(a[0]));
  console.warn = () => {};
  try {
    return { result: fn(), errors };
  } finally {
    console.error = error;
    console.warn = warn;
  }
}

describe('Zustand в React: useStore из темы против create из zustand', () => {
  it('REACT_RENDERS — рендеры за каждое действие у обоих', () => {
    const h = React.createElement;
    for (const [name, useApp, useShallow] of makeUseApps()) {
      const renders = [0, 0, 0, 0];
      const Counter = () => (renders[0]++, h('p', null, useApp((s) => s.count)));
      const Name = () => (renders[1]++, h('p', null, useApp((s) => s.user.name)));
      const Whole = () => (renders[2]++, h('p', null, (useApp() as LabState).count));
      const Summary = () => {
        renders[3]++;
        const v = useApp(useShallow((s) => ({ count: s.count, todos: s.todos.length }))) as { count: number; todos: number };
        return h('p', null, `${v.count}/${v.todos}`);
      };
      const { el, root } = mount(h('div', null, h(Counter), h(Name), h(Whole), h(Summary)));
      expect(el.textContent, name).toBe('0Аня00/1');
      const got: number[][] = [];
      for (const [, a] of SEQUENCE) {
        renders.fill(0);
        flushSync(() => useApp.setState(a));
        got.push([...renders]);
      }
      expect(got, name).toEqual(t.REACT_RENDERS.map((r) => r.renders));
      root.unmount();
    }
  });

  it('компонент, которому изменение не нужно, вызывает селектор ровно один раз', () => {
    const h = React.createElement;
    for (const [name, useApp] of makeUseApps()) {
      let calls = 0;
      let renders = 0;
      const Name = () => {
        renders++;
        return h('p', null, useApp((s) => (calls++, s.user.name)));
      };
      const { root } = mount(h(Name));
      calls = 0;
      renders = 0;
      flushSync(() => useApp.setState((s) => ({ count: s.count + 1 })));
      expect([calls, renders], name).toEqual([1, 0]);
      root.unmount();
    }
    expect(t.REACT_NOTE).toContain('одним вызовом селектора, без рендера');
  });

  it('CREATE_CODE рендерит число и обновляется; методы стора лежат на самом хуке', () => {
    // Наружу нужен и сам `useApp` — экспорт дописывается к коду примера, сам пример не меняется.
    const mod = jsx(`${t.CREATE_CODE}\nexport { useApp };`, {}) as {
      Counter: () => unknown;
      useApp: { getState(): { inc(): void }; setState: unknown; subscribe: unknown };
    };
    const { el, root } = mount(React.createElement(mod.Counter));
    expect(el.textContent).toBe('0');
    flushSync(() => mod.useApp.getState().inc());
    expect(el.textContent).toBe('1');
    expect(typeof mod.useApp.setState).toBe('function');
    expect(typeof mod.useApp.subscribe).toBe('function');
    root.unmount();
  });

  it('LOOP_CODE: цикл при монтировании, полсотни рендеров, пустой экран — у обоих', () => {
    let first = true;
    for (const [name, useApp] of makeUseApps()) {
      let renders = 0;
      // Хук зовётся ровно раз за рендер `Summary` — им и считаются рендеры.
      const counted = ((sel?: (s: LabState) => unknown) => (renders++, useApp(sel))) as UseApp;
      const { Summary } = jsx(t.LOOP_CODE, { useApp: counted }) as { Summary: () => unknown };
      const Wrapped = () => React.createElement(Summary);
      const Other = () => React.createElement('p', null, 'соседний');
      const { result, errors } = withConsole(() => mount(React.createElement('div', null, React.createElement(Other), React.createElement(Wrapped))));
      expect(renders, name).toBeGreaterThanOrEqual(50);
      expect(renders, name).toBeLessThanOrEqual(60);
      expect(result.el.textContent, name).toBe('');
      expect(errors.some((e) => e.includes('Maximum update depth exceeded')), name).toBe(true);
      // Предупреждение React печатает один раз на процесс — оно достаётся первому прогону.
      if (first) expect(errors.some((e) => e.includes('The result of getSnapshot should be cached to avoid an infinite loop')), name).toBe(true);
      first = false;
      result.root.unmount();
    }
    expect(t.LOOP_NOTE).toContain('Maximum update depth exceeded');
    expect(t.LOOP_NOTE).toContain('The result of getSnapshot should be cached to avoid an infinite loop');
    expect(t.LOOP_NOTE).toContain('полсотни');
  });
});

// ─── Pinia ─────────────────────────────────────────────────────────────────────────────────

const miniDefineStore = loadDefineStore(t.PINIA_CODE, { reactive, computed, toRefs } as never);

const piniaOptions = () => ({
  state: initialState,
  getters: { summary: (s: LabState) => `${s.count}/${s.todos.length}` },
  actions: {
    inc(this: TrackedStore) {
      this.count++;
    },
  },
});

/** Действия `PINIA_RENDERS` по порядку. */
const PINIA_ACTIONS: ((s: TrackedStore) => void)[] = [
  (s) => s.inc(),
  (s) => {
    s.user.name = 'Боря';
  },
  (s) => {
    // eslint-disable-next-line no-self-assign -- та же запись и есть проверяемое действие
    s.count = s.count;
  },
  (s) => {
    // eslint-disable-next-line no-self-assign -- та же запись и есть проверяемое действие
    s.user = s.user;
  },
  (s) => {
    s.todos.push('хлеб');
  },
  (s) => {
    s.count++;
    s.count++;
    s.user.name = 'Вера';
  },
];

async function piniaBench(useApp: () => TrackedStore, withPinia: boolean): Promise<number[][]> {
  const renders = [0, 0, 0, 0];
  const reads: ((s: TrackedStore) => unknown)[] = [(s) => s.count, (s) => s.user.name, (s) => s.summary, (s) => s.todos.length];
  const comps = reads.map((read, i) =>
    defineComponent({
      setup() {
        const store = useApp();
        return () => (renders[i]++, h('p', null, String(read(store))));
      },
    }),
  );
  const app = createApp({ render: () => h('div', null, comps.map((c) => h(c))) });
  if (withPinia) app.use(createPinia());
  const el = doc.createElement('div');
  app.mount(el as unknown as Element);
  expect(el.textContent).toBe('0Аня0/11');
  const store = useApp();
  const out: number[][] = [];
  for (const act of PINIA_ACTIONS) {
    renders.fill(0);
    act(store);
    await nextTick();
    out.push([...renders]);
  }
  app.unmount();
  return out;
}

describe('Pinia: defineStore из темы против pinia', () => {
  it('PINIA_RENDERS — у обоих', async () => {
    const want = t.PINIA_RENDERS.map((r) => r.renders);
    expect(await piniaBench(piniaDefineStore('bench', piniaOptions()) as unknown as () => TrackedStore, true)).toEqual(want);
    expect(await piniaBench(miniDefineStore('bench', piniaOptions()), false)).toEqual(want);
  });

  it('PINIA_USAGE_CODE исполняется с обоими defineStore', () => {
    setActivePinia(createPinia());
    for (const define of [piniaDefineStore, miniDefineStore]) {
      const { store } = new Function('defineStore', `${t.PINIA_USAGE_CODE}\nreturn { store };`)(define) as { store: TrackedStore };
      store.inc();
      expect(store.summary).toBe('1/1');
    }
  });

  it('$subscribe: раз за очередь, с flush sync — на каждую запись, $patch — один раз', async () => {
    setActivePinia(createPinia());
    const store = piniaDefineStore('subs', piniaOptions())() as unknown as TrackedStore & {
      $subscribe: (cb: () => void, o?: { flush: 'sync' }) => void;
      $patch: (p: Partial<LabState>) => void;
    };
    let pre = 0;
    let sync = 0;
    store.$subscribe(() => pre++);
    store.$subscribe(() => sync++, { flush: 'sync' });
    store.count++;
    store.count++;
    store.user.name = 'Вера';
    await nextTick();
    expect([pre, sync]).toEqual([1, 3]);
    pre = sync = 0;
    store.$patch({ count: 10, user: { name: 'Гоша' } });
    await nextTick();
    expect([pre, sync]).toEqual([1, 1]);
  });

  it('деструктуризация застывает на 0, storeToRefs — нет', async () => {
    const useApp = piniaDefineStore('destr', piniaOptions()) as unknown as () => TrackedStore;
    const Destructured = defineComponent({
      setup() {
        const { count } = useApp();
        return () => h('i', null, String(count));
      },
    });
    const Refs = defineComponent({
      setup() {
        const { count } = storeToRefs(useApp() as never) as { count: { value: number } };
        return () => h('b', null, String(count.value));
      },
    });
    const app = createApp({ render: () => h('div', null, [h(Destructured), h(Refs)]) });
    app.use(createPinia());
    const el = doc.createElement('div');
    app.mount(el as unknown as Element);
    useApp().inc();
    useApp().inc();
    await nextTick();
    expect(el.textContent).toBe('02');
    app.unmount();
  });
});

// ─── Демо ──────────────────────────────────────────────────────────────────────────────────

describe('демо store-lab считает то же, что библиотеки', () => {
  const codes = { store: t.STORE_CODE, selector: t.SELECTOR_CODE, pinia: t.PINIA_CODE };
  const vue = { reactive, computed, toRefs, effect, effectScope } as never;
  const SEQ: LabAction[] = ['inc', 'rename', 'sameCount', 'sameRef', 'addTodo'];

  const deltas = (mode: LabMode) => {
    const lab = createLab(mode, codes, vue);
    const out = SEQ.map((a) => {
      lab.act(a);
      return lab.rows().map((r) => [r.lastRenders, r.lastChecks]);
    });
    const final = lab.rows().map((r) => r.value);
    lab.stop();
    return { out, final };
  };
  const col = (rows: number[][][], comp: number, field: 0 | 1) => rows.map((r) => r[comp][field]);
  const reactCol = (i: number) => t.REACT_RENDERS.map((r) => r.renders[i]);
  const piniaCol = (i: number) => t.PINIA_RENDERS.slice(0, 5).map((r) => r.renders[i]);
  /** PINIA_RENDERS идут в порядке inc, rename, sameCount, sameRef, addTodo — как SEQ. */

  it('без селектора — как Whole: рендер на каждое уведомление', () => {
    const { out } = deltas('all');
    for (let c = 0; c < 3; c++) expect(col(out, c, 0)).toEqual(reactCol(2));
  });

  it('селектор: Counter и Name — как в React, Summary — лишний рендер на каждое уведомление', () => {
    const { out } = deltas('selector');
    expect(col(out, 0, 0)).toEqual(reactCol(0));
    expect(col(out, 1, 0)).toEqual(reactCol(1));
    expect(col(out, 2, 0)).toEqual([1, 1, 1, 0, 1]);
    for (let c = 0; c < 3; c++) expect(col(out, c, 1)).toEqual([1, 1, 1, 0, 1]);
  });

  it('shallow: Summary — как useShallow в React', () => {
    const { out } = deltas('shallow');
    expect(col(out, 2, 0)).toEqual(reactCol(3));
  });

  it('Pinia: как компоненты Vue на pinia, проверок нет', () => {
    const { out, final } = deltas('tracking');
    for (let c = 0; c < 3; c++) {
      expect(col(out, c, 0)).toEqual(piniaCol(c));
      expect(col(out, c, 1)).toEqual([0, 0, 0, 0, 0]);
    }
    expect(final).toEqual(['1', 'Боря', '1/2']);
  });

  it('селектор Summary неустойчив, остальные — устойчивы', () => {
    const s = initialState();
    expect(LAB_COMPONENTS.map((c) => snapshotIsStable(c.selector, s))).toEqual([true, true, false]);
    expect(t.LAB_COMPONENTS_TEXT.map((c) => c.id)).toEqual(LAB_COMPONENTS.map((c) => c.id));
  });
});
