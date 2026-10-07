import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { compile } from '@vue/compiler-dom';
import { compileScript, parse } from '@vue/compiler-sfc';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { type Browser, chromium, type Page } from 'playwright';
import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as t from '@/content/frameworks/forms/data';
import { loadModel, loadRender } from '@/widgets/form-lab/model/run';
import type { FieldModel, ModelMods, RenderSpec } from '@/widgets/form-lab/model/types';

/**
 * Тема «Формы во фреймворках: где живёт значение поля».
 *
 * Три слоя проверок:
 *   — компилятор Vue: `VMODEL_COMPILED`, `VMODEL_ROWS`, `VMODEL_COMPONENT` — тот же вывод,
 *     что даёт `@vue/compiler-sfc`/`compiler-dom` сейчас;
 *   — happy-dom: мини-`v-model` (`MODEL_CODE`) против настоящих директив Vue на одних и тех же
 *     сценариях ввода; модель рендеров (`RENDER_CODE`) против счётчиков настоящих React 19.3
 *     и Vue 3.5 на вариантах `RENDER_SETUPS` — их код монтируется как есть; механика
 *     контролируемого поля React;
 *   — Chromium: тест собирает фикстуру esbuild'ом, поднимает её на 127.0.0.1:52010 и печатает
 *     клавиатурой Playwright — каретка, IME (через CDP), встроенная проверка, `FormData`,
 *     действия React 19. Код `REACT_CARET_FIX_CODE`, `VUE_CARET_FIX_CODE`, `ACTION_CODE`,
 *     разметка `VALID_HTML` и `FORMDATA_HTML` попадают на страницу без изменений.
 *
 * Глобалы happy-dom ставятся до загрузки `react-dom` и `vue` (оба — через `require`, чтобы
 * копия была одна). `vue` в Node — полная сборка с компилятором шаблонов.
 */

const require = createRequire(import.meta.url);

// ─── DOM для React и Vue ───────────────────────────────────────────────────────────────────

const win = new Window({ url: 'http://localhost/' });
const GLOBALS = [
  'window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement',
  'HTMLTextAreaElement', 'HTMLFormElement', 'Text', 'Comment', 'Event', 'InputEvent', 'CompositionEvent',
  'Document', 'ShadowRoot', 'SVGElement', 'MutationObserver', 'FormData',
] as const;
const saved = new Map<string, PropertyDescriptor | undefined>();
// `win.document instanceof win.Document` в happy-dom 20 — `false`. А Vue проверяет именно это,
// когда решает, в фокусе ли поле (поблажки `.trim` и `.lazy`). Глобальный `Document` — класс
// самого документа, иначе поблажки молча не срабатывают и мини-версия «расходится» с Vue.
const DOC_CLASS = Object.getPrototypeOf(win.document).constructor;
for (const key of GLOBALS) {
  saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  const value = key === 'window' ? win : key === 'Document' ? DOC_CLASS : (win as unknown as Record<string, unknown>)[key];
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const React = require('react') as typeof import('react');
const { createRoot } = require('react-dom/client') as typeof import('react-dom/client');
const Vue = require('vue') as typeof import('vue');
const { act } = React;

afterAll(() => {
  for (const [key, desc] of saved) {
    if (desc) Object.defineProperty(globalThis, key, desc);
    else delete (globalThis as Record<string, unknown>)[key];
  }
});

const doc = win.document as unknown as Document;
const valueSetter = (el: Element) =>
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')!.set!;
/** Ввод, как его делает testing-library: запись мимо трекера React и событие `input`. */
function typeInto(el: HTMLInputElement, value: string, init: Record<string, unknown> = {}) {
  valueSetter(el).call(el, value);
  el.dispatchEvent(new (win.InputEvent as unknown as typeof InputEvent)('input', { bubbles: true, ...init }));
}
const fire = (el: Element, type: string) => el.dispatchEvent(new win.Event(type, { bubbles: true }) as unknown as Event);
const container = () => {
  const div = doc.createElement('div');
  doc.body.appendChild(div);
  return div;
};

// ─── Компилятор Vue ────────────────────────────────────────────────────────────────────────

describe('компилятор Vue: во что превращается v-model', () => {
  it('SFC с v-model.trim — VMODEL_COMPILED дословно', () => {
    const { descriptor } = parse(t.VMODEL_SFC);
    const out = compileScript(descriptor, { id: 'forms', inlineTemplate: true }).content;
    const start = out.indexOf('return (_ctx, _cache) => {');
    const body = out.slice(start, out.indexOf('\n}\n', start) + 2);
    expect(body).toBe(t.VMODEL_COMPILED);
    // Ни :value, ни слушателя input в выводе нет — только проп и директива.
    expect(out).not.toMatch(/onInput|value:/);
  });

  it('директива выбирается по тегу и типу — VMODEL_ROWS', () => {
    for (const row of t.VMODEL_ROWS) {
      const tpl = t.VMODEL_ROW_TEMPLATES[row.tpl] ?? row.tpl;
      const { code } = compile(tpl, { mode: 'module', prefixIdentifiers: true });
      const used = [...code.matchAll(/\b(vModel\w+) as/g)].map((m) => m[1]);
      expect(used, row.tpl).toEqual([row.dir]);
      if (row.tpl.includes('.lazy')) expect(code).toContain('lazy: true');
    }
  });

  it('v-model на компоненте — проп, событие и modelModifiers', () => {
    const { code } = compile('<Field v-model.trim="name" />', { mode: 'module', prefixIdentifiers: true });
    const flat = (x: string) => x.replace(/\s+/g, ' ');
    const body = t.VMODEL_COMPONENT.split('\n').slice(1).join('\n');
    expect(flat(code)).toContain(flat(body));
  });

  it('runtime-dom не делает слушателя из onUpdate:modelValue на элементе', () => {
    const host = container();
    const seen: unknown[] = [];
    Vue.createApp({ render: () => Vue.h('input', { 'onUpdate:modelValue': (v: unknown) => seen.push(v) }) }).mount(host);
    fire(host.querySelector('input')!, 'update:modelValue');
    expect(seen).toEqual([]);
  });
});

// ─── Мини-v-model против директив Vue ──────────────────────────────────────────────────────

const bindModel = loadModel(t.MODEL_CODE);

type Action =
  | ['type', number, string]
  | ['change', number]
  | ['focus', number]
  | ['blur', number]
  | ['check', number, boolean]
  | ['pick', number, string[]]
  | ['compose', number, string[], string]
  | ['model', unknown];

interface ModelCase {
  id: string;
  /** Разметка; `V` заменяется на `v-model…` у Vue и стирается у мини. */
  html: string;
  mods?: ModelMods;
  initial: unknown;
  /** Сеттер модели: как в теме — computed с set. */
  transform?: (v: unknown) => unknown;
  steps: Action[];
}

const upper = (v: unknown) => String(v).toUpperCase();
const digits = (v: unknown) => String(v).replace(/\D/g, '');

const MODEL_CASES: ModelCase[] = [
  { id: 'text', html: '<input V>', initial: 'a', steps: [['type', 0, 'ab'], ['type', 0, 'abc'], ['model', 'x'], ['type', 0, '']] },
  { id: 'textarea', html: '<textarea V></textarea>', initial: '', steps: [['type', 0, 'a\nb'], ['model', 'c']] },
  { id: 'trim-focused', html: '<input V>', mods: { trim: true }, initial: '', steps: [['focus', 0], ['type', 0, ' abc '], ['change', 0], ['type', 0, 'abc '], ['blur', 0]] },
  { id: 'trim-blurred', html: '<input V>', mods: { trim: true }, initial: '', steps: [['type', 0, ' x '], ['change', 0]] },
  { id: 'number', html: '<input V>', mods: { number: true }, initial: 1, steps: [['focus', 0], ['type', 0, '1.'], ['type', 0, '1.5'], ['type', 0, 'abc'], ['type', 0, '12abc'], ['change', 0], ['model', 3]] },
  { id: 'type-number', html: '<input type="number" V>', initial: 0, steps: [['type', 0, '7'], ['type', 0, '007'], ['type', 0, '']] },
  { id: 'lazy', html: '<input V>', mods: { lazy: true }, initial: '', steps: [['focus', 0], ['type', 0, 'abc'], ['change', 0], ['type', 0, 'abcd'], ['model', 'x'], ['blur', 0]] },
  { id: 'ime', html: '<input V>', initial: '', steps: [['focus', 0], ['compose', 0, ['n', 'に', 'にほ', 'にほん'], '日本']] },
  { id: 'ime-lazy', html: '<input V>', mods: { lazy: true }, initial: '', steps: [['compose', 0, ['k', 'か'], 'かん'], ['change', 0]] },
  { id: 'upper', html: '<input V>', initial: 'AB', transform: upper, steps: [['focus', 0], ['type', 0, 'ABc'], ['type', 0, 'ABCd']] },
  { id: 'digits', html: '<input V>', initial: '12', transform: digits, steps: [['focus', 0], ['type', 0, '12a'], ['type', 0, '12a3']] },
  { id: 'ime-upper', html: '<input V>', initial: 'AB', transform: upper, steps: [['focus', 0], ['compose', 0, ['ABk', 'ABka'], 'ABかん']] },
  { id: 'checkbox', html: '<input type="checkbox" V>', initial: false, steps: [['check', 0, true], ['check', 0, false], ['model', true]] },
  { id: 'checkbox-array', html: '<input type="checkbox" value="a" V><input type="checkbox" value="b" V>', initial: ['b'], steps: [['check', 0, true], ['check', 1, false], ['model', ['b', 'a']]] },
  { id: 'radio', html: '<input type="radio" value="s" V><input type="radio" value="m" V>', initial: 'm', steps: [['check', 0, true], ['model', 'm']] },
  { id: 'select', html: '<select V><option>a</option><option>b</option></select>', initial: 'b', steps: [['pick', 0, ['a']], ['model', 'zzz'], ['model', 'b']] },
  { id: 'select-number', html: '<select V><option>1</option><option>2</option></select>', mods: { number: true }, initial: 1, steps: [['pick', 0, ['2']]] },
  { id: 'select-multiple', html: '<select multiple V><option>a</option><option>b</option><option>c</option></select>', initial: ['c'], steps: [['pick', 0, ['a', 'c']], ['model', ['b']]] },
];

type FieldEl = HTMLInputElement & { options: HTMLOptionsCollection };

/** Снимок поля: то, что видно в DOM. */
function snap(el: FieldEl) {
  if (el.tagName === 'SELECT') return [...el.options].map((o) => o.selected);
  if (el.type === 'checkbox' || el.type === 'radio') return el.checked;
  return el.value;
}

async function act$(el: FieldEl[], a: Action, setModel: (v: unknown) => void) {
  switch (a[0]) {
    case 'type': typeInto(el[a[1]], a[2]); break;
    case 'change': fire(el[a[1]], 'change'); break;
    case 'focus': el[a[1]].focus(); break;
    case 'blur': el[a[1]].blur(); break;
    case 'check': el[a[1]].checked = a[2]; fire(el[a[1]], 'change'); break;
    case 'pick': for (const o of el[a[1]].options) o.selected = a[2].includes(o.value); fire(el[a[1]], 'change'); break;
    case 'compose': {
      const target = el[a[1]];
      const compo = (type: string, data: string) =>
        target.dispatchEvent(new (win.CompositionEvent as unknown as typeof CompositionEvent)(type, { data }));
      compo('compositionstart', '');
      for (const s of [...a[2], a[3]]) typeInto(target, s, { isComposing: true, data: s });
      compo('compositionend', a[3]);
      break;
    }
    case 'model': setModel(a[1]); break;
  }
}

/** Прогон настоящего v-model: computed с сеттером поверх ref, как в теме. */
async function runVue(c: ModelCase) {
  const host = container();
  const mods = Object.entries(c.mods ?? {}).filter(([, on]) => on).map(([m]) => '.' + m).join('');
  let sets = 0;
  const raw = Vue.ref(c.initial);
  const m = Vue.computed({
    get: () => raw.value,
    set: (v) => {
      sets++;
      raw.value = c.transform ? c.transform(v) : v;
    },
  });
  Vue.createApp({ setup: () => ({ m }), template: `<div>${c.html.replaceAll('V', `v-model${mods}="m"`)}</div>` }).mount(host);
  const els = [...host.querySelectorAll('input,select,textarea')] as FieldEl[];
  const trace: unknown[] = [[Vue.toRaw(raw.value), els.map(snap)]];
  for (const a of c.steps) {
    await act$(els, a, (v) => (raw.value = v));
    await Vue.nextTick();
    trace.push([structuredClone(Vue.toRaw(raw.value)), els.map(snap)]);
  }
  host.remove();
  return { trace, sets };
}

/** Тот же прогон мини-версии: модель меняется — «рендер» зовёт update каждого поля. */
async function runMini(c: ModelCase) {
  const host = container();
  host.innerHTML = c.html.replaceAll(' V', '');
  const els = [...host.querySelectorAll('input,select,textarea')] as FieldEl[];
  let raw = c.initial;
  let sets = 0;
  let dirty = false;
  const model: FieldModel = {
    get: () => raw,
    set(v) {
      sets++;
      const next = c.transform ? c.transform(v) : v;
      if (!Object.is(next, raw)) {
        raw = next;
        dirty = true;
      }
    },
  };
  const updates = els.map((el) => bindModel(el, model, c.mods));
  const trace: unknown[] = [[raw, els.map(snap)]];
  for (const a of c.steps) {
    await act$(els, a, (v) => ((raw = v), (dirty = true)));
    if (dirty) for (const u of updates) u();
    dirty = false;
    trace.push([structuredClone(raw), els.map(snap)]);
  }
  host.remove();
  return { trace, sets };
}

describe('мини-v-model ведёт себя как директивы Vue 3.5', () => {
  it('Vue той версии, что на стенде', () => {
    expect(Vue.version).toBe('3.5.42');
  });

  for (const c of MODEL_CASES) {
    it(c.id, async () => {
      const real = await runVue(c);
      const mini = await runMini(c);
      expect(mini.trace).toEqual(real.trace);
      expect(mini.sets).toBe(real.sets);
    });
  }

  it('утверждения раздела: IME — одна запись, фильтр оставляет букву, .number — 12 из «12abc»', async () => {
    const ime = await runMini(MODEL_CASES.find((c) => c.id === 'ime')!);
    expect(ime.sets).toBe(1);
    const dig = await runMini(MODEL_CASES.find((c) => c.id === 'digits')!);
    expect(dig.trace[2]).toEqual(['12', ['12a']]);
    expect(dig.trace[3]).toEqual(['123', ['123']]);
    const num = await runMini(MODEL_CASES.find((c) => c.id === 'number')!);
    expect(num.trace[2]).toEqual([1, ['1.']]);
    expect(num.trace[4]).toEqual(['abc', ['abc']]);
    expect(num.trace[5]).toEqual([12, ['12abc']]);
    expect(num.trace[6]).toEqual([12, ['12']]);
    const trim = await runMini(MODEL_CASES.find((c) => c.id === 'trim-focused')!);
    expect(trim.trace[2]).toEqual(['abc', [' abc ']]);
    expect(trim.trace[3]).toEqual(['abc', ['abc']]);
    expect(t.MODEL_DEMO_IME).toEqual({ steps: ['n', 'に', 'にほ', 'にほん'], commit: '日本' });
  });

  it('сценарии различают модели: без защиты от IME мини-версия расходится с Vue', async () => {
    const broken = loadModel(t.MODEL_CODE.replace("if (!composing) model.set(cast(el.value));", 'model.set(cast(el.value));'));
    const c = MODEL_CASES.find((x) => x.id === 'ime-upper')!;
    const host = container();
    host.innerHTML = '<input>';
    const el = host.querySelector('input') as FieldEl;
    let raw: unknown = 'AB';
    let sets = 0;
    broken(el, { get: () => raw, set: (v) => ((sets++), (raw = upper(v))) });
    await act$([el], c.steps[1], () => {});
    expect(sets).toBeGreaterThan(1);
    host.remove();
  });
});

// ─── Контролируемое поле React ─────────────────────────────────────────────────────────────

/** JSX-код темы → компонент: TypeScript снимает JSX, имена из `scope` приходят параметрами. */
function runJsx(code: string, exportName: string, scope: Record<string, unknown>) {
  const cjs = ts.transpileModule(`${code}\nexport { ${exportName} };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports: Record<string, unknown> = {};
  new Function('require', 'exports', ...Object.keys(scope), cjs)(require, exports, ...Object.values(scope));
  return exports[exportName] as React.ComponentType;
}

describe('контролируемое поле React — CONTROL_FACTS', () => {
  it('React той версии, что на стенде, и хуки форм из React 19', () => {
    expect(React.version).toBe('19.3.0');
    expect(typeof React.useActionState).toBe('function');
    expect(typeof (require('react-dom') as Record<string, unknown>).useFormStatus).toBe('function');
  });

  it('onChange приходит на input; change с тем же значением отброшен трекером', async () => {
    const host = container();
    const calls: string[] = [];
    const root = createRoot(host);
    function F() {
      const [v, setV] = React.useState('');
      return React.createElement('input', { value: v, onChange: (e: { target: HTMLInputElement }) => (calls.push(e.target.value), setV(e.target.value)) });
    }
    await act(() => root.render(React.createElement(F)));
    const input = host.querySelector('input')!;
    await act(() => typeInto(input, 'к'));
    await act(() => fire(input, 'change'));
    await act(() => typeInto(input, 'кот'));
    expect(calls).toEqual(['к', 'кот']);
    await act(() => root.unmount());
  });

  it('value без onChange: React возвращает значение из пропа сразу после события', async () => {
    const host = container();
    const root = createRoot(host);
    const errors: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => errors.push(String(a[0]));
    await act(() => root.render(React.createElement('input', { value: 'abcdef' })));
    const input = host.querySelector('input')!;
    await act(() => typeInto(input, 'abxcdef'));
    console.error = orig;
    expect(input.value).toBe('abcdef');
    expect(errors.some((e) => e.includes('without an `onChange` handler'))).toBe(true);
    await act(() => root.unmount());
  });

  it('атрибут value идёт за значением; reset сбрасывает только неконтролируемое', async () => {
    const host = container();
    const root = createRoot(host);
    function F() {
      const [v, setV] = React.useState('abc');
      return React.createElement('form', null,
        React.createElement('input', { id: 'c', value: v, onChange: (e: { target: HTMLInputElement }) => setV(e.target.value) }),
        React.createElement('input', { id: 'u', defaultValue: 'abc' }));
    }
    await act(() => root.render(React.createElement(F)));
    const c = host.querySelector('#c') as HTMLInputElement;
    const u = host.querySelector('#u') as HTMLInputElement;
    await act(() => typeInto(c, 'abcXY'));
    await act(() => typeInto(u, 'abcXY'));
    expect([c.getAttribute('value'), u.getAttribute('value')]).toEqual(['abcXY', 'abc']);
    host.querySelector('form')!.reset();
    expect([c.value, u.value]).toEqual(['abcXY', 'abc']);
    await act(() => root.unmount());
  });

  it('Vue: :value переписывает атрибут, v-model — нет', async () => {
    const host = container();
    const v = Vue.ref('abc');
    Vue.createApp({ setup: () => ({ v }), template: '<input id="b" :value="v" @input="v = $event.target.value"><input id="m" v-model="v">' }).mount(host);
    typeInto(host.querySelector('#b') as HTMLInputElement, 'abcXY');
    await Vue.nextTick();
    expect([host.querySelector('#b')!.getAttribute('value'), host.querySelector('#m')!.getAttribute('value')]).toEqual(['abcXY', null]);
    host.remove();
  });

  it('value={undefined} → строка: ошибка «uncontrolled input to be controlled»', async () => {
    const host = container();
    const root = createRoot(host);
    const errors: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => errors.push(String(a[0]));
    function F() {
      const [v, setV] = React.useState<string>();
      return React.createElement('input', { value: v, onChange: (e: { target: HTMLInputElement }) => setV(e.target.value) });
    }
    await act(() => root.render(React.createElement(F)));
    await act(() => typeInto(host.querySelector('input')!, 'a'));
    console.error = orig;
    expect(errors.some((e) => e.includes('changing an uncontrolled input to be controlled'))).toBe(true);
    await act(() => root.unmount());
  });

  it('тексты фактов называют то, что проверено выше', () => {
    const text = t.CONTROL_FACTS.map((f) => f.d).join(' ');
    expect(text).toContain('without an `onChange` handler');
    expect(text).toContain('A component is changing an uncontrolled input to be controlled');
    expect(text).toContain('`abcXY`');
    expect(text).toContain('`v-model` атрибут не трогает');
  });
});

// ─── Кто перерисуется ──────────────────────────────────────────────────────────────────────

const render = loadRender(t.RENDER_CODE);
const FIELDS20 = [...t.FIELDS, ...Array.from({ length: 16 }, (_, i) => `f${i + 5}`)];

async function countReact(code: string, fields: string[]) {
  const counts = new Map<string, number>();
  const sent: unknown[] = [];
  const Form = runJsx(code, 'Form', {
    useState: React.useState,
    useCallback: React.useCallback,
    memo: React.memo,
    track: (name: string) => counts.set(name, (counts.get(name) ?? 0) + 1),
    FIELDS: fields,
    send: (x: unknown) => sent.push(x),
  });
  const host = container();
  const root = createRoot(host);
  await act(() => root.render(React.createElement(Form)));
  return {
    host,
    sent,
    async type(key: string) {
      counts.clear();
      const input = host.querySelector(`input[name="${key}"]`) as HTMLInputElement;
      await act(() => typeInto(input, input.value + 'к'));
      return [...counts.entries()];
    },
    close: () => act(() => root.unmount()),
  };
}

async function countVue(code: string, fields: string[]) {
  const counts = new Map<string, number>();
  const Form = new Function('reactive', 'onBeforeUpdate', 'track', 'FIELDS', `${code}\nreturn Form;`)(
    Vue.reactive,
    Vue.onBeforeUpdate,
    (name: string) => counts.set(name, (counts.get(name) ?? 0) + 1),
    fields,
  );
  const host = container();
  const app = Vue.createApp(Form);
  app.mount(host);
  return {
    host,
    async type(key: string) {
      counts.clear();
      const input = host.querySelector(`input[name="${key}"]`) as HTMLInputElement;
      typeInto(input, input.value + 'к');
      await Vue.nextTick();
      return [...counts.entries()];
    },
    close: () => app.unmount(),
  };
}

const counter = (s: { framework: 'react' | 'vue'; code: string }, fields: string[]) =>
  s.framework === 'react' ? countReact(s.code, fields) : countVue(s.code, fields);

const sorted = (xs: string[]) => [...xs].sort();

describe('модель рендеров против React 19.3 и Vue 3.5', () => {
  for (const s of t.RENDER_SETUPS) {
    it(`${s.id}: каждое поле, 4 и 20 полей`, async () => {
      for (const fields of [t.FIELDS, FIELDS20]) {
        const real = await counter(s, fields);
        const tree = render.buildTree(s, fields);
        for (const key of fields.slice(0, 5)) {
          const got = await real.type(key);
          // Каждый перерисованный — ровно один раз.
          expect(got.every(([, n]) => n === 1), `${s.id} ${key}`).toBe(true);
          expect(sorted(got.map(([name]) => name)), `${s.id} ${key}`).toEqual(sorted(render.whoRenders(s.framework, tree, key)));
        }
        await real.close();
      }
    });
  }

  it('Vue без emits: все поля перерисовываются — и модель говорит то же', async () => {
    const code = t.VUE_PROPS_CODE.replace("  emits: ['update:modelValue'],\n", '');
    expect(code).not.toBe(t.VUE_PROPS_CODE);
    const real = await countVue(code, t.FIELDS);
    const got = await real.type('phone');
    real.close();
    const model = render.whoRenders('vue', render.buildTree(t.VUE_NO_EMITS_SPEC as RenderSpec, t.FIELDS), 'phone');
    expect(sorted(got.map(([n]) => n))).toEqual(sorted(model));
    expect(model).toHaveLength(t.FIELDS.length + 1);
  });

  it('RENDER_TABLE — те же числа', () => {
    for (const row of t.RENDER_TABLE) {
      const s = t.RENDER_SETUPS.find((x) => x.id === row.id)!;
      const n = (fields: string[], key: string) => render.whoRenders(s.framework, render.buildTree(s, fields), key).length;
      expect([n(t.FIELDS, 'name'), n(t.FIELDS, 'phone'), n(FIELDS20, 'phone')], row.id).toEqual([row.name, row.phone, row.n20]);
    }
  });

  it('лид раздела: «от нуля до двадцати двух»', () => {
    const all = t.RENDER_TABLE.flatMap((r) => [r.name, r.phone, r.n20]);
    expect([Math.min(...all), Math.max(...all)]).toEqual([0, 22]);
    const mdx = readFileSync(new URL('../../src/content/frameworks/forms/index.mdx', import.meta.url), 'utf8');
    expect(mdx).toContain('от нуля до двадцати двух рендеров');
  });

  it('модель различает фреймворки: правило React на дереве Vue дало бы другое', () => {
    const s = t.RENDER_SETUPS.find((x) => x.id === 'vue-props')!;
    const tree = render.buildTree(s, t.FIELDS);
    expect(render.whoRenders('react', tree, 'phone')).not.toEqual(render.whoRenders('vue', tree, 'phone'));
  });

  it('значение в DOM: FormData при отправке собирает набранное', async () => {
    const s = t.RENDER_SETUPS.find((x) => x.id === 'react-dom')!;
    const real = await countReact(s.code, t.FIELDS);
    await real.type('name');
    await act(() => {
      (real.host.querySelector('form') as HTMLFormElement).requestSubmit();
    });
    expect(real.sent).toEqual([{ name: 'к', phone: '', email: '', comment: '' }]);
    await real.close();
  });
});

// ─── Chromium ──────────────────────────────────────────────────────────────────────────────

const PORT = 52010;
let server: Server;
let browser: Browser;
let page: Page;
const consoleErrors: string[] = [];

/** Фикстура: случаи каретки и IME, код темы как есть, разметка проверки и FormData. */
const ENTRY = `
import { useState, useRef, useLayoutEffect, useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { createApp, ref, computed, nextTick, reactive, onBeforeUpdate } from 'vue';

window.__log = {};
const log = (k, x) => (window.__log[k] ??= []).push(x);

function Controlled({ id, start, transform = (v) => v, later = false }) {
  const [v, setV] = useState(start);
  return <input id={id} value={v} onChange={(e) => {
    const next = transform(e.target.value);
    if (later) setTimeout(() => setV(next), 0); else setV(next);
  }} />;
}
function ImeReact({ id, start, transform = (v) => v }) {
  const [v, setV] = useState(start);
  return <input id={id} value={v} onChange={(e) => {
    log(id, e.nativeEvent.isComposing);
    setV(transform(e.target.value));
  }} />;
}

// ── код темы ──
const FIELDS = ${JSON.stringify(t.FIELDS)};
const track = (name) => log('track', name);
${t.REACT_LIFT_CODE}

${t.REACT_CARET_FIX_CODE}

const save = (title) => new Promise((ok) => { window.__saves.push(title); window.__release = ok; });
window.__saves = [];
${t.ACTION_CODE}
// ──

const up = (v) => v.toUpperCase();
const dig = (v) => v.replace(/\\D/g, '');
createRoot(document.getElementById('react')).render(<>
  <Controlled id="react-plain" start="abcdef" />
  <Controlled id="react-upper" start="ABCDEF" transform={up} />
  <Controlled id="react-digits" start="123456" transform={dig} />
  <Controlled id="react-async" start="abcdef" later />
  <input id="react-unc" defaultValue="abcdef" />
  <div id="react-fix"><UpperInput /></div>
  <ImeReact id="ime-react" start="" />
  <ImeReact id="ime-react-upper" start="ABCDEF" transform={up} />
  <div id="action"><OrderForm /></div>
  <div id="lift"><Form /></div>
</>);

function vueCase(id, start, transform, extra = '') {
  const el = document.createElement('div');
  document.getElementById('vue').append(el);
  createApp({
    setup() {
      const raw = ref(start);
      let sets = 0;
      const m = computed({ get: () => raw.value, set: (v) => { window.__log[id + ':sets'] = ++sets; raw.value = transform ? transform(v) : v; } });
      return { m, own: (e) => log(id + ':input', e.isComposing === true) };
    },
    template: '<input id="' + id + '" v-model="m"' + extra + '>',
  }).mount(el);
}
vueCase('vue-plain', 'abcdef');
vueCase('vue-upper', 'ABCDEF', up);
vueCase('vue-digits', '123456', dig);
vueCase('ime-vue', '', null, ' @input="own"');
vueCase('ime-vue-upper', 'ABCDEF', up);
vueCase('vue-lazy', '', null, '');
{
${t.VUE_PROPS_CODE}
  const el = document.createElement('div');
  el.id = 'vue-lift';
  document.getElementById('vue').append(el);
  createApp(Form).mount(el);
}
{
  const el = document.createElement('div');
  el.id = 'vue-fix';
  document.getElementById('vue').append(el);
  createApp({
    setup() {
${t.VUE_CARET_FIX_CODE}
      return { input, upper };
    },
    template: '<input ref="input" v-model="upper">',
  }).mount(el);
}
{
  const el = document.createElement('div');
  document.getElementById('vue').append(el);
  createApp({ setup: () => ({ v: ref('') }), template: '<input id="vue-lazy-enter" v-model.lazy="v"><span id="vue-lazy-out">{{ v }}</span>' }).mount(el);
}

const raw = document.getElementById('raw');
for (const type of ['compositionstart', 'compositionupdate', 'compositionend', 'beforeinput', 'input'])
  raw.addEventListener(type, (e) => log('raw', [type, e.data, 'isComposing' in e && type !== 'compositionstart' && type !== 'compositionupdate' && type !== 'compositionend' ? String(e.isComposing) : '—', raw.value]));
window.__ready = true;
`;

const HTML = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>forms</title></head><body>
<div id="react"></div><div id="vue"></div>
<div id="valid">${t.VALID_HTML}</div>
<div id="fd">${t.FORMDATA_HTML}</div>
<input id="raw">
<script type="module" src="/app.js"></script></body></html>`;

beforeAll(async () => {
  const out = await build({
    stdin: { contents: ENTRY, resolveDir: process.cwd(), loader: 'jsx' },
    bundle: true,
    format: 'esm',
    write: false,
    platform: 'browser',
    jsx: 'automatic',
    alias: { vue: 'vue/dist/vue.esm-bundler.js' },
    define: { 'process.env.NODE_ENV': '"development"', __VUE_OPTIONS_API__: 'true', __VUE_PROD_DEVTOOLS__: 'false', __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false' },
    logLevel: 'silent',
  });
  const bundle = out.outputFiles[0].text;
  server = createServer((req, res) => {
    const js = req.url === '/app.js';
    res.writeHead(200, { 'content-type': js ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8' });
    res.end(js ? bundle : HTML);
  });
  await new Promise<void>((r) => server.listen(PORT, '127.0.0.1', () => r()));
  browser = await chromium.launch();
  page = await browser.newPage();
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true);
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await new Promise((r) => server?.close(r));
});

const DUMP = !!process.env.DUMP;
const dump = (k: string, v: unknown) => DUMP && console.log(k, JSON.stringify(v));

describe('Chromium: каретка — CARET_ROWS', () => {
  it('браузер той версии, что на стенде', () => {
    expect(browser.version()).toBe('153.0.8010.12');
  });

  it('символ в середину строки', async () => {
    const got = [];
    for (const row of t.CARET_ROWS) {
      const el = page.locator(row.id === 'react-fix' || row.id === 'vue-fix' ? `#${row.id} input` : `#${row.id}`);
      await el.click();
      await el.evaluate((e: HTMLInputElement, p) => e.setSelectionRange(p, p), t.CARET_POS);
      expect(await el.inputValue(), row.id).toBe(row.start);
      await page.keyboard.type(row.typed);
      await page.waitForTimeout(40);
      const [value, caret] = await el.evaluate((e: HTMLInputElement) => [e.value, e.selectionStart]);
      got.push({ id: row.id, value, caret });
    }
    dump('caret', got);
    expect(got).toEqual(t.CARET_ROWS.map((r) => ({ id: r.id, value: r.value, caret: r.caret })));
  });
});

describe('Chromium: правки DOM от одного символа — RENDER_DOM', () => {
  for (const [id, renders, expected] of [['lift', 6, () => t.RENDER_DOM], ['vue-lift', 3, () => t.RENDER_DOM_VUE]] as const) it(`${id}: рендеры и записи в DOM`, async () => {
    await page.locator(`#${id} input[name="name"]`).click();
    const got = await page.evaluate(async (id) => {
      const w = window as unknown as { __log: Record<string, string[]>; __mut: string[] };
      w.__log.track = [];
      w.__mut = [];
      const mo = new MutationObserver((list) => {
        for (const r of list) w.__mut.push(r.type === 'attributes' ? `${r.attributeName} ${(r.target as Element).getAttribute('name')}` : r.type);
      });
      mo.observe(document.getElementById(id)!, { subtree: true, attributes: true, characterData: true, childList: true });
      (window as unknown as { __mo: MutationObserver }).__mo = mo;
      return null;
    }, id);
    void got;
    await page.keyboard.type('к');
    await page.waitForTimeout(40);
    const r = await page.evaluate(() => {
      const w = window as unknown as { __log: Record<string, string[]>; __mut: string[]; __mo: MutationObserver };
      w.__mut.push(...w.__mo.takeRecords().map((x) => x.type));
      w.__mo.disconnect();
      return { renders: w.__log.track, mutations: w.__mut };
    });
    dump(id + '-dom', r);
    expect(r.renders).toHaveLength(renders);
    expect(r.mutations).toEqual(expected());
  });

  it('RENDER_NOTE называет те же числа', () => {
    expect(t.RENDER_DOM).toHaveLength(12);
    expect(t.RENDER_DOM.filter((m) => m.startsWith('name '))).toHaveLength(10);
    expect(t.RENDER_NOTE).toContain('двенадцать изменений. Десять из них — атрибут `name`');
    expect(t.RENDER_DOM_VUE).toHaveLength(2);
    expect(t.RENDER_NOTE).toContain('сделал две правки');
  });
});

describe('Chromium: IME — IME_TRACE, IME_COUNTS, IME_UPPER', () => {
  async function compose(selector: string, steps: string[], commit: string, end = false) {
    const cdp = await page.context().newCDPSession(page);
    await page.locator(selector).click();
    if (end) await page.keyboard.press('End');
    for (const s of steps) await cdp.send('Input.imeSetComposition', { text: s, selectionStart: s.length, selectionEnd: s.length });
    await cdp.send('Input.insertText', { text: commit });
    await page.waitForTimeout(40);
    await cdp.detach();
  }
  const logOf = (k: string) => page.evaluate((k) => (window as unknown as { __log: Record<string, unknown> }).__log[k], k);

  it('порядок событий в поле без фреймворка', async () => {
    await compose('#raw', t.MODEL_DEMO_IME.steps, t.MODEL_DEMO_IME.commit);
    const raw = (await logOf('raw')) as string[][];
    dump('ime-raw', raw);
    const show = (x: string | null | undefined) => (x === undefined || x === null ? '' : JSON.stringify(x));
    const rows = raw.map(([ev, data, composing, value]) => ({ ev, data: show(data), composing, value: show(value) }));
    // В таблице темы шаги «にほ» и «にほん» свёрнуты в одну строку.
    const table = t.IME_TRACE.filter((r) => !r.ev.startsWith('…'));
    expect([...rows.slice(0, 7), ...rows.slice(-4)]).toEqual(table);
    expect(rows).toHaveLength(17);
  });

  it('React: onChange на каждый input набора, Vue: одна запись в модель', async () => {
    await compose('#ime-react', t.MODEL_DEMO_IME.steps, t.MODEL_DEMO_IME.commit);
    await compose('#ime-vue', t.MODEL_DEMO_IME.steps, t.MODEL_DEMO_IME.commit);
    const react = (await logOf('ime-react')) as boolean[];
    const vueOwn = (await logOf('ime-vue:input')) as boolean[];
    const got = {
      reactOnChange: react.length,
      reactComposing: react.filter(Boolean).length,
      vueModelSets: await logOf('ime-vue:sets'),
      vueOwnInput: vueOwn.length,
    };
    dump('ime-counts', got);
    expect(got).toEqual(t.IME_COUNTS);
    expect(await page.locator('#ime-vue').inputValue()).toBe('日本');
  });

  it('преобразование посреди набора: React ломает слово, Vue — нет', async () => {
    await compose('#ime-react-upper', ['k', 'ka', 'kan'], 'かん', true);
    await compose('#ime-vue-upper', ['k', 'ka', 'kan'], 'かん', true);
    const got = { react: await page.locator('#ime-react-upper').inputValue(), vue: await page.locator('#ime-vue-upper').inputValue() };
    dump('ime-upper', got);
    expect(got).toEqual({ react: t.IME_UPPER.react, vue: t.IME_UPPER.vue });
  });

  it('текст раздела называет снятые числа', () => {
    // «пять onChange» и итог «KKAKANかん» — ради них раздел и написан.
    expect(t.IME_COUNTS.reactOnChange).toBe(5);
    expect(t.IME_NOTE).toContain('пять `onChange`');
    expect(t.IME_NOTE).toContain(t.IME_UPPER.react.slice('ABCDEF'.length));
    expect(t.PITFALLS.find((p) => p.n === '04')!.d).toContain('Пять вызовов');
  });
});

describe('Chromium: .lazy — модель меняется на change', () => {
  it('Enter в поле с .lazy присылает change', async () => {
    await page.locator('#vue-lazy-enter').click();
    await page.keyboard.type('abc');
    const before = await page.locator('#vue-lazy-out').textContent();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(30);
    expect([before, await page.locator('#vue-lazy-out').textContent()]).toEqual(['', 'abc']);
  });
});

describe('Chromium: встроенная проверка — VALID_STEPS', () => {
  it('validity, :invalid и :user-invalid по шагам', async () => {
    const state = (id: string) =>
      page.evaluate((id) => {
        const e = document.getElementById(id) as HTMLInputElement;
        const flags = ['valueMissing', 'patternMismatch', 'typeMismatch', 'rangeOverflow', 'badInput', 'customError'].filter((k) => e.validity[k as keyof ValidityState]);
        return { flags: flags.join(','), invalid: e.matches(':invalid'), user: e.matches(':user-invalid') };
      }, id);
    const got: Record<string, unknown> = {};
    const take = async (id: string, field: string) => (got[id] = await state(field));
    await take('load', 'req');
    await take('load-pat', 'pat');
    await page.evaluate(() => {
      const w = window as unknown as { __ev: string[] };
      w.__ev = [];
      const f = document.getElementById('order')!;
      f.addEventListener('submit', (e) => (e.preventDefault(), w.__ev.push('submit')));
      for (const id of ['req', 'pat', 'mail', 'num']) document.getElementById(id)!.addEventListener('invalid', () => w.__ev.push('invalid ' + id));
    });
    const checked = await page.evaluate(() => (document.getElementById('order') as HTMLFormElement).checkValidity());
    const evCheck = await page.evaluate(() => (window as unknown as { __ev: string[] }).__ev.splice(0));
    await take('check', 'req');
    await page.locator('#req').click();
    await page.keyboard.type('a');
    await take('typed', 'req');
    await page.keyboard.press('Backspace');
    await take('cleared', 'req');
    await page.locator('#mail').click();
    await take('blurred', 'req');
    await page.keyboard.type('ivan');
    await take('mail-focus', 'mail');
    await page.locator('#num').click();
    await take('mail-blur', 'mail');
    await page.keyboard.type('1e');
    const numValue = await page.locator('#num').inputValue();
    await take('num-bad', 'num');
    await page.locator('#order button').click();
    await page.waitForTimeout(40);
    const evSubmit = await page.evaluate(() => (window as unknown as { __ev: string[] }).__ev.splice(0));
    const focused = await page.evaluate(() => document.activeElement?.id);
    await take('submit', 'pat');
    dump('valid', { got, checked, evCheck, evSubmit, focused, numValue });

    expect(got).toEqual(Object.fromEntries(t.VALID_STEPS.map((s) => [s.id, { flags: s.flags, invalid: s.invalid, user: s.user }])));
    expect([checked, evCheck]).toEqual([false, ['invalid req', 'invalid pat']]);
    expect(evSubmit).toEqual(['invalid req', 'invalid pat', 'invalid mail', 'invalid num']);
    expect(focused).toBe('req');
    expect(numValue).toBe('');
    // VALID_FACTS: novalidate и setCustomValidity.
    const novalidate = await page.evaluate(() => {
      const f = document.getElementById('order') as HTMLFormElement;
      f.noValidate = true;
      f.requestSubmit();
      f.noValidate = false;
      return (window as unknown as { __ev: string[] }).__ev.splice(0);
    });
    expect(novalidate).toEqual(['submit']);
    const custom = await page.evaluate(() => {
      const e = document.getElementById('req') as HTMLInputElement;
      e.value = 'Иван';
      e.setCustomValidity('Имя занято');
      const r = [e.validity.customError, e.validity.valid];
      e.value = 'Пётр';
      r.push(e.validity.valid);
      e.setCustomValidity('');
      r.push(e.validity.valid);
      return r;
    });
    expect(custom).toEqual([true, false, false, true]);
  });

  it('OWN_VALIDATE_CODE снимает старую ошибку и ставит свою', async () => {
    const r = await page.evaluate((code) => {
      const validateConfirm = new Function(`${code}\nreturn validateConfirm;`)();
      const p = document.createElement('input');
      const c = document.createElement('input');
      p.value = 'secret';
      c.value = 'secre';
      const a = [validateConfirm(p, c), c.validationMessage];
      c.value = 'secret';
      a.push(validateConfirm(p, c));
      return a;
    }, t.OWN_VALIDATE_CODE);
    expect(r).toEqual([false, 'Пароли не совпадают', true]);
  });
});

describe('Chromium: FormData — FORMDATA_ENTRIES и FORMDATA_ROWS', () => {
  it('что попадает в FormData', async () => {
    const r = await page.evaluate(() => {
      const f = document.querySelector('#fd form') as HTMLFormElement;
      const fd = new FormData(f);
      const buttons = [...f.querySelectorAll('button')];
      return {
        entries: [...fd],
        gift: fd.get('gift'),
        tags: fd.getAll('tag'),
        qty: typeof fd.get('qty'),
        fromEntries: Object.fromEntries(fd),
        withSave: [...new FormData(f, buttons[1])].filter(([k]) => k === 'act'),
      };
    });
    dump('formdata', r);
    expect(r.entries).toEqual(t.FORMDATA_ENTRIES);
    expect(t.FORMDATA_PRINT.split('\n')).toHaveLength(t.FORMDATA_ENTRIES.length);
    expect(r.gift).toBeNull();
    expect(r.tags).toEqual(['a', 'b']);
    expect(r.qty).toBe('string');
    expect(r.fromEntries).toMatchObject({ tag: 'b', city: 'Казань', wrap: 'on' });
    expect(r.withSave).toEqual([['act', 'save']]);
  });
});

describe('Chromium: действие формы React 19 — ACTION_STEPS', () => {
  it('pending, вызов с FormData, сброс неконтролируемого поля', async () => {
    const shot = () =>
      page.evaluate(() => {
        const f = document.querySelector('#action form')!;
        const [title, comment] = [...f.querySelectorAll('input')].map((i) => i.value);
        return { title, comment, button: f.querySelector('button')!.textContent, text: f.querySelector('p')?.textContent ?? '', url: location.pathname };
      });
    const inputs = page.locator('#action input');
    await inputs.nth(0).fill('Латте');
    await inputs.nth(1).fill('без сахара');
    const steps = [await shot()];
    await page.locator('#action button').click();
    await page.waitForTimeout(40);
    steps.push(await shot());
    const disabled = await page.locator('#action button').isDisabled();
    const saves = await page.evaluate(() => (window as unknown as { __saves: string[] }).__saves);
    await page.evaluate(() => (window as unknown as { __release: () => void }).__release());
    await page.waitForTimeout(60);
    steps.push(await shot());
    dump('action', { steps, disabled, saves });
    expect(steps.map(({ url, ...rest }) => (expect(url).toBe('/'), rest))).toEqual(t.ACTION_STEPS.map(({ k, ...rest }) => (void k, rest)));
    expect(disabled).toBe(true);
    expect(saves).toEqual(['Латте']);
  });

  it('в консоли нет ошибок, кроме тех, что тема ждёт', () => {
    expect(consoleErrors.filter((e) => !e.includes('Download the React DevTools'))).toEqual([]);
  });
});
