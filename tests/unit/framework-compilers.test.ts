import Module, { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Window } from 'happy-dom';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BAILOUTS,
  MINI_COMPILER_CODE,
  MINI_COUNTER_OUT,
  MEMO_DROPPED_LINE,
  MINI_PRESETS,
  REACT_COUNTER_OUT,
  REACT_COUNTER_SRC,
  REACT_MEMO_SUM_SRC,
  REACT_SUM_OUT,
  REACT_SUM_SRC,
  SOLID_COUNTER_OUT,
  SOLID_COUNTER_SRC,
  SOLID_DESTRUCTURE,
  SOLID_DESTRUCTURE_SRC,
  STALE_LIST_COUNTS,
  STALE_LIST_SRC,
  STEP_ANALYZE,
  STEP_GENERATE,
  STEP_INTERPRET,
  STEP_PARSE,
  STEP_RUNTIME,
  SUM_CALLS,
  SVELTE_COUNTER_OUT,
  SVELTE_COUNTER_SRC,
  SVELTE_HINT_SRC,
  SVELTE_PROXY_OUT,
  SVELTE_PROXY_SRC,
  SVELTE_STALE,
  SVELTE_STALE_SRC,
  UPDATE_COUNTS,
} from '@/content/frameworks/framework-compilers/data';
import { CompilerLab, countNodes, loadMiniCompiler } from '@/widgets/fc-mini-compiler';
import type { UpdateCount } from '@/content/frameworks/framework-compilers/data';

/**
 * «Компиляторы фреймворков»: учебный компилятор и три настоящих.
 *
 * Что здесь закреплено:
 *   - учебный компилятор — **та же строка** `MINI_COMPILER_CODE`, что напечатана в теме,
 *     исполненная тем же модулем `widgets/fc-mini-compiler/model/lab.ts`, что и демо;
 *   - вывод `babel-plugin-react-compiler` 1.0.0, `svelte/compiler` 5.57.1 и `babel-preset-solid`
 *     1.9.15 на исходниках из `data.ts` — **целиком**, строка в строку. Вывод этих трёх на
 *     небольших компонентах детерминирован и не шумит (ни хешей, ни путей), поэтому сверяется
 *     весь: на странице напечатан именно он, и подстрока допустила бы расхождение в остальном;
 *   - таблица отказов React Compiler — категория и причина из его `logger` дословно;
 *   - числа: вызовы функций компонентов и записи `MutationObserver` за один клик в happy-dom.
 *
 * Как исполняется скомпилированное (все три — в одном процессе с happy-dom вместо DOM):
 *   - React: вывод компилятора (JSX) → `typescript.transpileModule` с `jsx: react-jsx` →
 *     CommonJS → `react-dom/client` и `act`. TypeScript здесь только снимает JSX: плагина
 *     `@babel/plugin-transform-react-jsx` в проекте нет, а ставить пакеты ради темы не стали;
 *   - Svelte: импорты вывода заменены параметрами `new Function`, монтирование — `mount`
 *     из **клиентской** сборки (`svelte/src/index-client.js` по пути: в Node условие `default`
 *     отдаёт серверную, где `mount` бросает);
 *   - Solid: `solid-js` и `solid-js/web` подменены на браузерные сборки подменой разрешения
 *     имён (тем же приёмом, что `tests/unit/vue-internals.test.ts`): условие `node` отдаёт
 *     серверный `solid-js`, в котором нет реактивности.
 */

const require = createRequire(import.meta.url);
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

// ---------------------------------------------------------------------------
// DOM: happy-dom в глобальной области — до загрузки React, Svelte и Solid
// ---------------------------------------------------------------------------

const win = new Window({ url: 'http://localhost/' });
const GLOBALS = [
  'window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Text', 'Comment',
  'DocumentFragment', 'HTMLTemplateElement', 'MutationObserver', 'Event', 'MouseEvent', 'SVGElement',
] as const;
const saved = new Map<string, PropertyDescriptor | undefined>();
for (const key of GLOBALS) {
  saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  const value = key === 'window' ? win : (win as unknown as Record<string, unknown>)[key];
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const doc = win.document as unknown as Document;

/** Подмена разрешения имён: `solid-js` → браузерная сборка. */
const resolver = Module as unknown as { _resolveFilename: (request: string, ...rest: unknown[]) => string };
const originalResolve = resolver._resolveFilename;
resolver._resolveFilename = function (request, ...rest) {
  if (request === 'solid-js') return join(ROOT, 'node_modules/solid-js/dist/solid.cjs');
  if (request === 'solid-js/web') return join(ROOT, 'node_modules/solid-js/web/dist/web.cjs');
  return originalResolve.call(this, request, ...rest);
};

afterAll(() => {
  resolver._resolveFilename = originalResolve;
  for (const [key, desc] of saved) {
    if (desc) Object.defineProperty(globalThis, key, desc);
    else delete (globalThis as Record<string, unknown>)[key];
  }
  delete (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
});

// ---------------------------------------------------------------------------
// Компиляторы
// ---------------------------------------------------------------------------

interface Babel {
  transformSync(code: string, options: Record<string, unknown>): { code: string } | null;
}
const babel = require('@babel/core') as Babel;
const reactCompilerPlugin = require('babel-plugin-react-compiler') as unknown;
const syntaxJsx = require('@babel/plugin-syntax-jsx') as unknown;
const presetSolid = require('babel-preset-solid') as unknown;
const ts = require('typescript') as typeof import('typescript');

interface CompilerEvent {
  kind: string;
  fnName?: string | null;
  detail?: { options?: DiagOptions } & DiagOptions;
}
interface DiagOptions {
  category?: string;
  reason?: string;
}

function reactCompile(src: string): { code: string; events: CompilerEvent[] } {
  const events: CompilerEvent[] = [];
  const out = babel.transformSync(src, {
    filename: 'Component.jsx',
    babelrc: false,
    configFile: false,
    plugins: [[reactCompilerPlugin, { logger: { logEvent: (_file: string, e: CompilerEvent) => events.push(e) } }], syntaxJsx],
  });
  return { code: out!.code, events };
}

/** Без компилятора — только разбор JSX тем же Babel: так обе ветки одинаково отформатированы. */
function reactPlain(src: string): string {
  return babel.transformSync(src, { filename: 'Component.jsx', babelrc: false, configFile: false, plugins: [syntaxJsx] })!.code;
}

function diag(e: CompilerEvent): DiagOptions {
  return e.detail?.options ?? e.detail ?? {};
}

type Exports = Record<string, unknown>;

/** JSX + ESM → CommonJS и исполнение с `track` в области видимости. */
function runCjs(code: string, jsx: 'react' | 'none', scope: Record<string, unknown> = {}): Exports {
  const cjs = ts.transpileModule(code, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: jsx === 'react' ? ts.JsxEmit.ReactJSX : ts.JsxEmit.Preserve,
    },
  }).outputText;
  const exports: Exports = {};
  new Function('require', 'exports', ...Object.keys(scope), cjs)(require, exports, ...Object.values(scope));
  return exports;
}

function solidCompile(src: string): string {
  return babel.transformSync(src, {
    filename: 'Component.jsx',
    babelrc: false,
    configFile: false,
    presets: [[presetSolid, { generate: 'dom' }]],
  })!.code;
}

interface SvelteCompiler {
  compile(src: string, options: Record<string, unknown>): { js: { code: string }; warnings: { code: string }[] };
}
let svelte: SvelteCompiler;
let svelteRuntime: Record<string, unknown>;
let svelteMount: (component: unknown, options: { target: Element; props?: object }) => unknown;
let svelteFlush: () => void;

beforeAll(async () => {
  svelte = (await import('svelte/compiler')) as unknown as SvelteCompiler;
  // имя через переменную: у `svelte/internal/client` нет объявлений типов, а они здесь и не нужны
  const runtimeId = 'svelte/internal/client';
  svelteRuntime = (await import(/* @vite-ignore */ runtimeId)) as Record<string, unknown>;
  const client = (await import(pathToFileURL(join(ROOT, 'node_modules/svelte/src/index-client.js')).href)) as {
    mount: typeof svelteMount;
    flushSync: () => void;
  };
  svelteMount = client.mount;
  svelteFlush = client.flushSync;
});

function svelteCompile(src: string, filename: string, extra: Record<string, unknown> = {}) {
  return svelte.compile(src, { filename, generate: 'client', dev: false, ...extra });
}

/** Вывод Svelte → функция: импорты становятся параметрами, `export default` — возвратом. */
function svelteInstantiate(code: string, name: string, scope: Record<string, unknown>): unknown {
  const body =
    code
      .replace(/^import .*;$/gm, '')
      .replace(`export default function ${name}`, `function ${name}`) + `\nreturn ${name};`;
  return new Function('$', ...Object.keys(scope), body)(svelteRuntime, ...Object.values(scope));
}

// ---------------------------------------------------------------------------
// Счёт: вызовы и записи DOM
// ---------------------------------------------------------------------------

function tracker() {
  const calls: Record<string, number> = {};
  return {
    calls,
    track: (name: string) => {
      calls[name] = (calls[name] ?? 0) + 1;
    },
    reset: () => {
      for (const key of Object.keys(calls)) calls[key] = 0;
    },
  };
}

interface Rec {
  type: string;
  text: string;
}

function observe(root: Element): { records: Rec[]; stop: () => Promise<Rec[]> } {
  const records: Rec[] = [];
  const mo = new win.MutationObserver((list) => {
    for (const r of list) records.push({ type: r.type, text: r.target.textContent ?? '' });
  });
  mo.observe(root as never, { subtree: true, childList: true, characterData: true, attributes: true });
  return {
    records,
    stop: async () => {
      await new Promise((r) => setTimeout(r, 0));
      mo.disconnect();
      return records;
    },
  };
}

function freshRoot(): Element {
  const root = doc.createElement('div');
  doc.body.append(root);
  return root;
}

interface ReactDom {
  createRoot(el: Element): { render(node: unknown): void; unmount(): void };
}
interface ReactLib {
  act(fn: () => void): void;
  createElement(type: unknown, props?: object | null): unknown;
}
const React = require('react') as ReactLib;
const ReactDOM = require('react-dom/client') as ReactDom;

function reactMount(component: unknown, props: object = {}): { root: Element; rerender: (p: object) => void } {
  const root = freshRoot();
  const r = ReactDOM.createRoot(root);
  React.act(() => r.render(React.createElement(component, props)));
  return { root, rerender: (p) => React.act(() => r.render(React.createElement(component, p))) };
}

/** Один клик «+1»: сколько вызовов и какие записи. */
async function measureClick(root: Element, t: ReturnType<typeof tracker>, click: () => void): Promise<Omit<UpdateCount, 'id' | 'label'>> {
  t.reset();
  const obs = observe(root);
  click();
  const records = await obs.stop();
  expect(records.every((r) => r.type === 'characterData'), JSON.stringify(records)).toBe(true);
  return {
    counter: t.calls.Counter ?? 0,
    hint: t.calls.Hint ?? 0,
    mutations: records.length,
    texts: records.map((r) => r.text),
  };
}

function expected(id: string): Omit<UpdateCount, 'id' | 'label'> {
  const row = UPDATE_COUNTS.find((u) => u.id === id)!;
  return { counter: row.counter, hint: row.hint, mutations: row.mutations, texts: row.texts };
}

// ===========================================================================
// Учебный компилятор
// ===========================================================================

describe('учебный компилятор: та же строка, что на странице', () => {
  const api = loadMiniCompiler(MINI_COMPILER_CODE);

  it('исполняемая строка — это напечатанные шаги подряд', () => {
    for (const step of [STEP_PARSE, STEP_ANALYZE, STEP_GENERATE, STEP_RUNTIME, STEP_INTERPRET]) {
      expect(MINI_COMPILER_CODE).toContain(step);
    }
  });

  it('вывод на пресете «счётчик» совпадает с напечатанным', () => {
    expect(api.compile(MINI_PRESETS[0].source).code).toBe(MINI_COUNTER_OUT);
  });

  it.each(MINI_PRESETS)('$id: скомпилированный код и интерпретатор дают одну разметку — до и после каждого изменения', (preset) => {
    const target = freshRoot();
    const lab = new CompilerLab(api, preset.source, doc, target, preset.state);
    expect(target.innerHTML).toBe(api.interpret(preset.source, lab.values));
    for (const name of lab.compiled.names) {
      const report = lab.set(name, typeof lab.values[name] === 'number' ? Number(lab.values[name]) + 7 : `${lab.values[name]}!`);
      expect(report.html).toBe(api.interpret(preset.source, lab.values));
      const fresh = doc.createElement('div');
      fresh.innerHTML = report.html;
      expect(report.rebuilt).toBe(countNodes(fresh));
    }
  });

  it('«счётчик»: count = 1 — две записи текста, ровно столько же записей MutationObserver', async () => {
    const target = freshRoot();
    const lab = new CompilerLab(api, MINI_PRESETS[0].source, doc, target, MINI_PRESETS[0].state);
    const obs = observe(target);
    const report = lab.set('count', 1);
    const records = await obs.stop();
    expect(report.ops).toEqual(['text "1"', 'text "2"']);
    expect(records.every((r) => r.type === 'characterData')).toBe(true);
    const row = expected('mini');
    expect({ mutations: records.length, texts: records.map((r) => r.text) }).toEqual({ mutations: row.mutations, texts: row.texts });
    // интерпретатор на то же изменение пересоздал бы все узлы: два <p>, их тексты и перевод строки
    expect(report.rebuilt).toBe(5);
  });

  it('то же значение ещё раз — ни одной записи', () => {
    const lab = new CompilerLab(api, MINI_PRESETS[0].source, doc, freshRoot(), MINI_PRESETS[0].state);
    lab.set('count', 1);
    expect(lab.set('count', 1).ops).toEqual([]);
  });

  it('«цена»: qty трогает один узел, currency — атрибут и текст', () => {
    const preset = MINI_PRESETS.find((p) => p.id === 'price')!;
    const lab = new CompilerLab(api, preset.source, doc, freshRoot(), preset.state);
    expect(lab.set('qty', 3).ops).toEqual(['text "360"']);
    expect(lab.set('currency', '$').ops).toEqual(['attr data-currency="$"', 'text "$"']);
  });

  it('update читает только имена, от которых зависят изменённые места', () => {
    const preset = MINI_PRESETS.find((p) => p.id === 'price')!;
    const { code } = api.compile(preset.source);
    const rt = api.createRuntime(doc, () => {});
    const update = api.instantiate(code, rt)(freshRoot(), { ...preset.state });
    const reads: string[] = [];
    const state = new Proxy({ ...preset.state, qty: 5 }, {
      get(target, key) {
        reads.push(String(key));
        return Reflect.get(target, key);
      },
    });
    update(state, { qty: true });
    expect(reads.sort()).toEqual(['price', 'qty']);
  });

  it('проверка «то же значение» — не украшение: без неё повтор даёт запись', () => {
    const broken = MINI_COMPILER_CODE.replace("if (node.data === next) return  // то же значение — DOM не трогаем\n", '');
    expect(broken).not.toBe(MINI_COMPILER_CODE);
    const lab = new CompilerLab(loadMiniCompiler(broken), MINI_PRESETS[0].source, doc, freshRoot(), { count: 0 });
    lab.set('count', 1);
    expect(lab.set('count', 1).ops).toEqual(['text "1"', 'text "2"']);
  });

  it('ошибки шаблона — SyntaxError с понятным текстом', () => {
    expect(() => api.compile('<p>{1 + 1}</p>')).toThrow(/нет ни одного имени/);
    expect(() => api.compile('<p>текст')).toThrow(/не закрыт <p>/);
    expect(() => api.compile("<p>{name + 'x'}</p>")).toThrow(/недопустимый знак/);
    expect(() => api.compile('<p></b>')).toThrow(/лишний <\/b>/);
  });
});

// ===========================================================================
// React Compiler
// ===========================================================================

describe('React Compiler 1.0.0: вывод и отказы', () => {
  it('Counter: вывод совпадает с напечатанным, обе функции скомпилированы', () => {
    const { code, events } = reactCompile(REACT_COUNTER_SRC);
    expect(code).toBe(REACT_COUNTER_OUT);
    expect(events.map((e) => `${e.kind} ${e.fnName}`)).toEqual(['CompileSuccess Hint', 'CompileSuccess Counter']);
  });

  it('Cart: под sum(items) ячейки нет — вывод совпадает с напечатанным', () => {
    expect(reactCompile(REACT_SUM_SRC).code).toBe(REACT_SUM_OUT);
  });

  it.each(BAILOUTS)('$id: $verdict', (b) => {
    const { code, events } = reactCompile(b.src);
    const compiled = code.includes('_c(');
    if (b.verdict === 'compiled') {
      expect(compiled).toBe(true);
      expect(events.map((e) => e.kind)).toEqual(['CompileSuccess']);
      return;
    }
    expect(compiled, 'функция не должна быть переписана').toBe(false);
    if (b.verdict === 'untouched') {
      expect(events).toEqual([]);
      return;
    }
    if (b.verdict === 'skip') {
      expect(events.map((e) => e.kind)).toEqual(['CompileSkip']);
      return;
    }
    const errors = events.filter((e) => e.kind === 'CompileError');
    expect(errors.length).toBeGreaterThan(0);
    expect(events.some((e) => e.kind === 'CompileSuccess')).toBe(false);
    expect({ category: diag(errors[0]).category, reason: diag(errors[0]).reason }).toEqual({ category: b.category, reason: b.reason });
  });

  it('отказ молчит: без логгера плагин не бросает, а вывод совпадает с разбором без компилятора', () => {
    for (const b of BAILOUTS.filter((x) => x.verdict === 'error')) {
      const out = babel.transformSync(b.src, {
        filename: 'Component.jsx',
        babelrc: false,
        configFile: false,
        plugins: [reactCompilerPlugin, syntaxJsx],
      })!.code;
      expect(out).toBe(reactPlain(b.src));
    }
  });

  it('хук без вызовов хуков не тронут, и логгер о нём молчит', () => {
    const { code, events } = reactCompile('function useTotal(items) {\n  return items.filter((i) => i.inCart);\n}');
    expect(code.includes('_c(')).toBe(false);
    expect(events).toEqual([]);
  });
});

describe('React: исполнение в happy-dom', () => {
  async function counterRow(compiled: boolean) {
    const t = tracker();
    const code = compiled ? reactCompile(REACT_COUNTER_SRC).code : reactPlain(REACT_COUNTER_SRC);
    const { Counter } = runCjs(code, 'react', { track: t.track });
    const { root } = reactMount(Counter);
    expect(t.calls).toEqual({ Counter: 1, Hint: 1 });
    expect(root.innerHTML).toBe('<div><button>+1</button><p>Нажато 0, вдвое — 0</p><p>Подсказка не зависит от count</p></div>');
    const row = await measureClick(root, t, () => React.act(() => (root.querySelector('button') as HTMLElement).click()));
    expect(root.querySelector('p')!.textContent).toBe('Нажато 1, вдвое — 2');
    return row;
  }

  it('без компилятора: Counter и Hint вызваны оба, записей в DOM две', async () => {
    expect(await counterRow(false)).toEqual(expected('react'));
  });

  it('с компилятором: Hint не вызван, записей в DOM столько же', async () => {
    expect(await counterRow(true)).toEqual(expected('react-compiler'));
  });

  it('мутация на месте: без компилятора 2 пункта, с компилятором — застывший 1', () => {
    const count = (compiled: boolean) => {
      const code = compiled ? reactCompile(STALE_LIST_SRC).code : reactPlain(STALE_LIST_SRC);
      const { Shop } = runCjs(code, 'react');
      const { root } = reactMount(Shop);
      React.act(() => (root.querySelector('button') as HTMLElement).click());
      return root.querySelectorAll('li').length;
    };
    expect({ plain: count(false), compiled: count(true) }).toEqual(STALE_LIST_COUNTS);
  });

  it('sum(items) при смене одного discount: с компилятором считается снова — и с useMemo тоже', () => {
    const calls = (src: string, compiled = true) => {
      let n = 0;
      const sum = (items: { price: number }[]) => {
        n++;
        return items.reduce((s, i) => s + i.price, 0);
      };
      const { Cart } = runCjs(compiled ? reactCompile(src).code : reactPlain(src), 'react', { sum });
      const items = [{ price: 100 }, { price: 50 }];
      const { root, rerender } = reactMount(Cart, { items, discount: 0 });
      n = 0;
      rerender({ items, discount: 0.5 });
      expect(root.textContent).toBe('75');
      return n;
    };
    expect({
      compiled: calls(REACT_SUM_SRC),
      compiledUseMemo: calls(REACT_MEMO_SUM_SRC),
      plainUseMemo: calls(REACT_MEMO_SUM_SRC, false),
    }).toEqual(SUM_CALLS);
  });

  it('ручной useMemo вокруг sum(items) компилятор выбрасывает, а при выводе прямо в JSX — запоминает', () => {
    const dropped = reactCompile(REACT_MEMO_SUM_SRC).code;
    expect(dropped).toContain(MEMO_DROPPED_LINE);
    expect(dropped).not.toContain('useMemo(');
    const direct = reactCompile(REACT_MEMO_SUM_SRC.replace('{total * (1 - discount)}', '{total}')).code;
    expect(direct).not.toContain(MEMO_DROPPED_LINE);
    expect(direct).toMatch(/if \(\$\[0\] !== items\) \{\n\s+t1 = sum\(items\);/);
  });
});

// ===========================================================================
// Svelte 5
// ===========================================================================

describe('Svelte 5.57.1: вывод и исполнение', () => {
  it('Counter: вывод совпадает с напечатанным, предупреждений нет', () => {
    const r = svelteCompile(SVELTE_COUNTER_SRC, 'Counter.svelte');
    expect(r.js.code).toBe(SVELTE_COUNTER_OUT);
    expect(r.warnings).toEqual([]);
  });

  it('$state с объектом и $effect: вывод совпадает с напечатанным; $.push появился только здесь', () => {
    const code = svelteCompile(SVELTE_PROXY_SRC, 'Cart.svelte').js.code;
    expect(code).toBe(SVELTE_PROXY_OUT);
    expect(code).toContain('$.push($$props, true)');
    expect(SVELTE_COUNTER_OUT).not.toContain('$.push(');
  });

  it('$state с объектом: push в массив будит и шаблон, и $effect', () => {
    const Cart = svelteInstantiate(svelteCompile(SVELTE_PROXY_SRC, 'Cart.svelte').js.code, 'Cart', {});
    const root = freshRoot();
    svelteMount(Cart, { target: root });
    svelteFlush();
    expect({ button: root.querySelector('button')!.textContent, title: doc.title }).toEqual({ button: '0', title: '0 в корзине' });
    (root.querySelector('button') as HTMLElement).click();
    svelteFlush();
    expect({ button: root.querySelector('button')!.textContent, title: doc.title }).toEqual({ button: '1', title: '1 в корзине' });
  });

  it('компонент без рун по умолчанию получает флаг совместимости — поэтому Hint собран с runes: true', () => {
    expect(svelteCompile(SVELTE_HINT_SRC, 'Hint.svelte').js.code).toContain("import 'svelte/internal/flags/legacy';");
    expect(svelteCompile(SVELTE_HINT_SRC, 'Hint.svelte', { runes: true }).js.code).not.toContain('flags/legacy');
  });

  it('клик: ни Counter, ни Hint не вызваны, запись в DOM одна', async () => {
    const t = tracker();
    const Hint = svelteInstantiate(svelteCompile(SVELTE_HINT_SRC, 'Hint.svelte', { runes: true }).js.code, 'Hint', { track: t.track });
    const Counter = svelteInstantiate(svelteCompile(SVELTE_COUNTER_SRC, 'Counter.svelte').js.code, 'Counter', { track: t.track, Hint });
    const root = freshRoot();
    svelteMount(Counter, { target: root });
    svelteFlush();
    expect(t.calls).toEqual({ Counter: 1, Hint: 1 });
    expect(root.querySelector('p')!.textContent).toBe('Нажато 0, вдвое — 0');
    const row = await measureClick(root, t, () => {
      (root.querySelector('button') as HTMLElement).click();
      svelteFlush();
    });
    expect(root.querySelector('p')!.textContent).toBe('Нажато 1, вдвое — 2');
    expect(row).toEqual(expected('svelte'));
  });

  it('let без $derived: предупреждение компилятора и застывшее значение после клика', () => {
    const r = svelteCompile(SVELTE_STALE_SRC, 'Stale.svelte');
    expect(r.warnings.map((w) => w.code)).toEqual([SVELTE_STALE.warning]);
    const Stale = svelteInstantiate(r.js.code, 'Stale', {});
    const root = freshRoot();
    svelteMount(Stale, { target: root });
    svelteFlush();
    (root.querySelector('button') as HTMLElement).click();
    svelteFlush();
    expect(root.querySelector('button')!.textContent).toBe(SVELTE_STALE.after);
  });
});

// ===========================================================================
// Solid
// ===========================================================================

describe('Solid 1.9.15: вывод и исполнение', () => {
  it('Counter: вывод совпадает с напечатанным', () => {
    expect(solidCompile(SOLID_COUNTER_SRC)).toBe(SOLID_COUNTER_OUT);
  });

  it('клик: ни Counter, ни Hint не вызваны, записей в DOM две', async () => {
    const t = tracker();
    const { Counter } = runCjs(solidCompile(SOLID_COUNTER_SRC), 'none', { track: t.track });
    const { render } = require('solid-js/web') as { render: (fn: unknown, el: Element) => () => void };
    const root = freshRoot();
    render(Counter, root);
    expect(t.calls).toEqual({ Counter: 1, Hint: 1 });
    const row = await measureClick(root, t, () => (root.querySelector('button') as HTMLElement).click());
    expect(root.querySelector('p')!.textContent).toBe('Нажато 1, вдвое — 2');
    expect(row).toEqual(expected('solid'));
  });

  it('деструктуризация пропсов: первый <b> застыл, второй обновился', () => {
    const code = solidCompile(SOLID_DESTRUCTURE_SRC);
    // так компилятор сохраняет реактивность пропса: чтение отложено в стрелку
    expect(code).toContain('_$insert(_el$2, () => props.text)');
    const { App } = runCjs(code, 'none');
    const { render } = require('solid-js/web') as { render: (fn: unknown, el: Element) => () => void };
    const root = freshRoot();
    render(App, root);
    (root.querySelector('button') as HTMLElement).click();
    const [destructured, props] = [...root.querySelectorAll('b')].map((b) => b.textContent);
    expect({ destructured, props }).toEqual(SOLID_DESTRUCTURE);
  });
});

