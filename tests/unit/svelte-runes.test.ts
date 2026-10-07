import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { reactive } from '@vue/reactivity';
import { Window } from 'happy-dom';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as t from '@/content/frameworks/svelte-runes/data';
import { loadRunes, runScenario, traceScenario } from '@/widgets/svelte-lab/model/run';

/**
 * Тема «Svelte 5 изнутри: руны и компилятор».
 *
 * Что здесь сверяется с настоящим svelte 5.57.1:
 *
 *   - вывод `svelte/compiler` на исходниках темы (`*_SRC` → `*_OUT`) — целиком, строка в строку;
 *   - каждый сценарий `SCENARIOS` исполнен на `svelte/internal/client` и на мини-рунах
 *     `MINI_RUNES_CODE` (той же строкой, что печатается на странице и исполняется демо, —
 *     через `widgets/svelte-lab/model/run.ts`): оба журнала равны полю `svelte`;
 *   - «без этой строки сломается» — испорченными копиями мини-рун: каждая ломает свой сценарий;
 *   - сквозной пример `Todos` и `App`, `Cart`, `Counter` в двух синтаксисах скомпилированы,
 *     смонтированы `mount` в happy-dom и прокликаны: счётчики вызовов, записи `MutationObserver`,
 *     тексты кнопок, порядок журналов — против литералов `data.ts`.
 *
 * Монтирование — `mount` из **клиентской** сборки (`svelte/src/index-client.js` по пути: в Node
 * условие `default` отдаёт серверную, где `mount` бросает). Вывод компилятора исполняется
 * `new Function`: импорты вырезаны и поданы параметрами, `export default` стал возвратом.
 *
 * ⚠️ Режим совместимости включается импортом `svelte/internal/flags/legacy` — это глобальный
 * флаг рантайма на весь процесс. Поэтому блок про `let` и `$:` стоит последним, и журнал
 * `$effect` (`ORDER_RUNES`) снят до него.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

// ---------------------------------------------------------------------------
// DOM: happy-dom в глобальной области — до загрузки рантайма Svelte
// ---------------------------------------------------------------------------

const win = new Window({ url: 'http://localhost/' });
const GLOBALS = [
  'window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Text', 'Comment', 'DocumentFragment',
  'HTMLTemplateElement', 'MutationObserver', 'Event', 'MouseEvent', 'SVGElement', 'HTMLMediaElement',
] as const;
const saved = new Map<string, PropertyDescriptor | undefined>();
for (const key of GLOBALS) {
  saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  const value = key === 'window' ? win : (win as unknown as Record<string, unknown>)[key];
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}
const doc = win.document as unknown as Document;

afterAll(() => {
  for (const [key, desc] of saved) {
    if (desc) Object.defineProperty(globalThis, key, desc);
    else delete (globalThis as Record<string, unknown>)[key];
  }
});

// ---------------------------------------------------------------------------
// Svelte: компилятор, рантайм, монтирование
// ---------------------------------------------------------------------------

interface Compiled {
  js: { code: string };
  warnings: { code: string }[];
}
type Runtime = Record<string, (...args: never[]) => unknown>;

let compile: (src: string, options: Record<string, unknown>) => Compiled;
let $rt: Runtime;
let mount: (component: unknown, options: { target: Element; props?: object }) => unknown;
let flushSync: () => void;
let EACH: Record<string, number>;

beforeAll(async () => {
  compile = ((await import('svelte/compiler')) as unknown as { compile: typeof compile }).compile;
  // имя через переменную: у `svelte/internal/client` нет объявлений типов
  const runtimeId = 'svelte/internal/client';
  $rt = (await import(/* @vite-ignore */ runtimeId)) as Runtime;
  const client = (await import(pathToFileURL(join(ROOT, 'node_modules/svelte/src/index-client.js')).href)) as {
    mount: typeof mount;
    flushSync: typeof flushSync;
  };
  mount = client.mount;
  flushSync = client.flushSync;
  EACH = (await import(pathToFileURL(join(ROOT, 'node_modules/svelte/src/constants.js')).href)) as Record<string, number>;
});

function svelteCompile(src: string, file: string): Compiled {
  return compile(src, { filename: `${file}.svelte`, generate: 'client', dev: false });
}

/** Вывод компилятора → функция компонента: импорты — параметрами, `export default` — возвратом. */
function instantiate(code: string, name: string, $: Runtime, scope: Record<string, unknown> = {}): unknown {
  const body =
    code.replace(/^import .*;$/gm, '').replace(`export default function ${name}`, `function ${name}`) + `\nreturn ${name};`;
  return new Function('$', ...Object.keys(scope), body)($, ...Object.values(scope));
}

function freshRoot(): HTMLElement {
  const el = doc.createElement('div');
  doc.body.appendChild(el);
  return el;
}

/** Рантайм с обёртками-счётчиками: сам рантайм не тронут, считаются вызовы функций, которые дал ему компонент. */
function countingRuntime(calls: Record<string, number>): Runtime {
  const hit = (k: string) => (calls[k] = (calls[k] ?? 0) + 1);
  const wrap = (name: string) => (fn: (...a: unknown[]) => unknown, ...rest: unknown[]) =>
    ($rt[name] as (...a: unknown[]) => unknown)((...a: unknown[]) => (hit(name), fn(...a)), ...rest);
  return { ...$rt, template_effect: wrap('template_effect'), user_effect: wrap('user_effect'), derived: wrap('derived') } as Runtime;
}

/** Записи `MutationObserver` за действие, по типам. */
function records(root: Element, act: () => void): Record<string, number> {
  const mo = new MutationObserver(() => {});
  mo.observe(root, { subtree: true, childList: true, characterData: true, attributes: true });
  act();
  flushSync();
  const out: Record<string, number> = {};
  for (const r of mo.takeRecords()) out[r.type] = (out[r.type] ?? 0) + 1;
  mo.disconnect();
  return out;
}

const take = (calls: Record<string, number>) => {
  const copy = { ...calls };
  for (const k of Object.keys(calls)) delete calls[k];
  return copy;
};

async function realLog(code: string): Promise<string[]> {
  const out: string[] = [];
  await runScenario($rt, code, (line) => out.push(line));
  return out;
}

async function miniLog(miniCode: string, code: string): Promise<string[]> {
  const out: string[] = [];
  await runScenario(loadRunes(miniCode).$, code, (line) => out.push(line));
  return out;
}

const scenario = (id: string) => t.SCENARIOS.find((s) => s.id === id)!;

// ===========================================================================
// Вывод компилятора
// ===========================================================================

describe('svelte/compiler 5.57.1: вывод совпадает с напечатанным', () => {
  it.each([
    ['TODOS_SRC', t.TODOS_SRC, 'Todos', t.TODOS_OUT],
    ['PARENT_SRC', t.PARENT_SRC, 'App', t.PARENT_OUT],
    ['CART_SRC', t.CART_SRC, 'Cart', t.CART_OUT],
    ['LEGACY_SRC', t.LEGACY_SRC, 'Counter', t.LEGACY_OUT],
  ])('%s', (_name, src, file, out) => {
    const r = svelteCompile(src, file);
    expect(r.js.code).toBe(out);
    expect(r.warnings).toEqual([]);
  });

  it('в выводе нет ни хешей, ни путей — нормализовать нечего', () => {
    for (const out of [t.TODOS_OUT, t.PARENT_OUT, t.CART_OUT, t.LEGACY_OUT]) {
      expect(out).not.toMatch(/svelte-[a-z0-9]{6}|\/Users\/|node_modules/);
    }
  });

  it('проп — геттер у родителя и `$$props.title` у ребёнка; `todos` без `$.state`', () => {
    expect(t.PARENT_OUT).toContain('get title() {\n\t\t\treturn $.get(name);');
    expect(t.TODOS_OUT).toContain('$$props.title');
    expect(t.TODOS_OUT).toContain('let todos = $.proxy([');
    expect(t.TODOS_OUT).not.toContain('$.state(');
    expect(t.TODOS_OUT).toContain('let left = $.derived(() => todos.filter((t) => !t.done).length);');
    expect(t.TODOS_OUT).toContain('$.sibling(h2, 2)');
  });

  it('флаги `$.each`: 21 = элемент реактивен (1) + блок единственный в родителе (4) + элементы неизменяемы (16)', () => {
    expect(t.TODOS_OUT).toContain('$.each(ul, 21, () => todos, (todo) => todo.id,');
    expect(EACH.EACH_ITEM_REACTIVE).toBe(1);
    expect(EACH.EACH_IS_CONTROLLED).toBe(4);
    expect(EACH.EACH_ITEM_IMMUTABLE).toBe(16);
    expect(t.OUT_NOTES.find((n) => n.t.includes('{#each}'))!.d).toContain('(1)');
  });

  it('Cart: `$state` с переприсваиванием — `$.state($.proxy(…))` и `$.set(…, true)`; `$state.raw` — без прокси', () => {
    expect(t.CART_OUT).toContain("let cart = $.state($.proxy({ items: ['чай'] }));");
    expect(t.CART_OUT).toContain("let history = $.state({ items: ['чай'] });");
    expect(t.CART_OUT).toContain('$.set(cart, { items: [] }, true)');
    expect(t.CART_OUT).toMatch(/\$\.set\(history, \{ items: \[\.\.\.\$\.get\(history\)\.items, 'кофе'\] \}\)\)/);
  });

  it('режим совместимости: флаг legacy, mutable_source, зависимости `$:` выписаны компилятором', () => {
    expect(t.LEGACY_OUT).toContain("import 'svelte/internal/flags/legacy';");
    expect(t.LEGACY_OUT).toContain('let count = $.mutable_source(0);');
    expect(t.LEGACY_OUT).toContain('$.legacy_pre_effect(() => ($.get(count)), () => {');
    expect(svelteCompile(t.RUNES_SRC, 'Counter').js.code).not.toContain('flags/legacy');
  });

  it('руны и старый синтаксис в одном компоненте — ошибка компиляции', () => {
    const codeOf = (src: string) => {
      try {
        svelteCompile(src, 'Mixed');
        return 'скомпилировалось';
      } catch (e) {
        return (e as { code: string }).code;
      }
    };
    expect(codeOf('<script>\n  let count = $state(0);\n  $: x = count * 2;\n</script>\n{x}')).toBe('legacy_reactive_statement_invalid');
    expect(codeOf('<script>\n  export let a;\n  let count = $state(0);\n</script>\n{a}{count}')).toBe('legacy_export_invalid');
    expect(t.SVELTE4_NOTE).toContain('legacy_reactive_statement_invalid');
  });
});

// ===========================================================================
// Сценарии: мини-руны против svelte/internal/client
// ===========================================================================

describe('сценарии: настоящий Svelte и мини-руны дают один журнал', () => {
  it.each(t.SCENARIOS.map((s) => [s.id, s] as const))('%s — svelte/internal/client', async (_id, s) => {
    expect(await realLog(s.code)).toEqual(s.svelte);
  });

  it.each(t.SCENARIOS.map((s) => [s.id, s] as const))('%s — мини-руны', async (_id, s) => {
    expect(await miniLog(t.MINI_RUNES_CODE, s.code)).toEqual(s.svelte);
  });

  it.each(t.SCENARIOS.map((s) => [s.id, s] as const))('%s — прогон демо с журналом шагов', async (_id, s) => {
    const run = await traceScenario(t.MINI_RUNES_CODE, s.code);
    expect(run.logs).toEqual(s.svelte);
    expect(run.steps.filter((st) => st.kind === 'log').map((st) => st.text)).toEqual(s.svelte);
    expect(run.steps.length).toBeGreaterThan(s.svelte.length);
  });

  it('ромб в демо: после записи `a` — `b`, `c` DIRTY, эффект MAYBE_DIRTY', async () => {
    const run = await traceScenario(t.MINI_RUNES_CODE, scenario('diamond').code);
    const write = run.steps.findIndex((st) => st.kind === 'write' && st.text.startsWith('запись a = 2'));
    const marked = run.steps[write + 3].nodes;
    const status = Object.fromEntries(marked.map((n) => [n.name, n.status]));
    expect(status).toMatchObject({ b: 'DIRTY', c: 'DIRTY', $effect: 'MAYBE_DIRTY' });
    expect(scenario('diamond').note).toContain('`MAYBE_DIRTY`');
  });

  it('эффект, который читает и пишет одно и то же, бросает effect_update_depth_exceeded — оба', async () => {
    await expect(realLog(t.LOOP_CODE)).rejects.toThrow(/effect_update_depth_exceeded/);
    await expect(miniLog(t.MINI_RUNES_CODE, t.LOOP_CODE)).rejects.toThrow(/effect_update_depth_exceeded/);
  });

  it('запись из $derived — state_unsafe_mutation', async () => {
    await expect(realLog(t.UNSAFE_CODE)).rejects.toThrow(/state_unsafe_mutation/);
  });
});

/** Испорченная копия мини-рун: замена обязана сработать, иначе проверка молча ничего не ломает. */
function broken(find: string, replace: string): string {
  expect(t.MINI_RUNES_CODE, `в MINI_RUNES_CODE нет «${find}»`).toContain(find);
  return t.MINI_RUNES_CODE.replace(find, replace);
}

describe('без этой строки сломается: испорченные мини-руны расходятся со Svelte', () => {
  it('всё DIRTY вместо MAYBE_DIRTY за derived — пропадает отсечка', async () => {
    const code = broken('mark_reactions(reaction, MAYBE_DIRTY)', 'mark_reactions(reaction, DIRTY)');
    const log = await miniLog(code, scenario('cutoff').code);
    expect(log).not.toEqual(scenario('cutoff').svelte);
    expect(log).toContain('эффект: odd = true');
    expect(log.filter((l) => l === 'эффект: odd = true')).toHaveLength(2);
  });

  it('новый номер derived при любом пересчёте — пропадает отсечка', async () => {
    const code = broken('if (value !== d.v) {', 'if (true) {');
    expect(await miniLog(code, scenario('cutoff').code)).not.toEqual(scenario('cutoff').svelte);
  });

  it('$effect выполняется при обходе вместе с шаблоном — ломается порядок', async () => {
    const code = broken('if ((effect.f & EFFECT) !== 0) user.push(effect)', 'if (false) user.push(effect)');
    const log = await miniLog(code, scenario('order').code);
    expect(log).not.toEqual(scenario('order').svelte);
    expect(log.indexOf('$effect видит 1')).toBeLessThan(log.indexOf('шаблон видит 1'));
  });

  it('сброс прямо в set — пропадает пакет', async () => {
    const code = broken('  ensure_batch()                              // сброс', '  ensure_batch(); flush()  // сброс');
    const log = await miniLog(code, scenario('batch').code);
    expect(log).toContain('эффект: итого 240');
  });

  it('без самопометки эффекта цикл не ловится', async () => {
    const code = broken('own_writes.some((s) => new_deps.includes(s))', 'false');
    await expect(miniLog(code, t.LOOP_CODE)).resolves.toEqual([]);
  });
});

// ===========================================================================
// Сквозной пример: Todos и App
// ===========================================================================

describe('сквозной пример Todos в happy-dom', () => {
  it('счётчики вызовов: монтирование, клик по «○», «перевернуть», переименование', () => {
    const calls: Record<string, number> = {};
    const $c = countingRuntime(calls);
    const Inner = instantiate(svelteCompile(t.TODOS_SRC, 'Todos').js.code, 'Todos', $c) as (...a: unknown[]) => unknown;
    const Todos = (...a: unknown[]) => ((calls.Todos = (calls.Todos ?? 0) + 1), Inner(...a));
    const App = instantiate(svelteCompile(t.PARENT_SRC, 'App').js.code, 'App', $rt, { Todos });
    const root = freshRoot();
    mount(App, { target: root });
    flushSync();
    expect(take(calls)).toEqual(t.TODO_COUNTS.mount);
    expect(root.querySelector('h2')!.textContent).toBe('Дела — осталось 2');
    expect(doc.title).toBe('Дела: 2');

    (root.querySelector('li button') as HTMLElement).click();
    flushSync();
    expect(take(calls)).toEqual(t.TODO_COUNTS.toggle);
    expect(root.querySelector('h2')!.textContent).toBe('Дела — осталось 1');

    (root.querySelector('h2 + button') as HTMLElement).click();
    flushSync();
    expect(take(calls)).toEqual(t.TODO_COUNTS.reverse);

    (root.querySelector('button') as HTMLElement).click();
    flushSync();
    expect(take(calls)).toEqual(t.TODO_COUNTS.rename);
    expect(root.querySelector('h2')!.textContent).toBe('Покупки — осталось 1');
    expect(doc.title).toBe('Покупки: 1');
  });

  it('таблица цены совпадает со счётчиками', () => {
    const [mount_, toggle, reverse, rename] = t.COST_ROWS;
    expect(mount_.slice(1, 5)).toEqual(['1', '4 из 4', '1', '1']);
    expect(toggle[1]).toBe('0');
    expect(toggle[2].startsWith(`${t.TODO_COUNTS.toggle.template_effect} из 4`)).toBe(true);
    expect(reverse.slice(1, 5)).toEqual(['0', '0', '1 — значение то же', '0']);
    expect(rename.slice(1, 5)).toEqual(['0', '1: `<h2>`', '0', '1']);
    expect(toggle[5]).toBe(`${t.EACH_RECORDS.keyed.toggle.characterData} текста`);
    expect(reverse[5]).toContain(`${t.EACH_RECORDS.keyed.reverse.childList}`);
  });

  it.each([
    ['keyed', t.TODOS_SRC],
    ['unkeyed', t.TODOS_SRC.replace(' (todo.id)', '')],
  ] as const)('{#each} %s: записи DOM и судьба узлов при перевороте', (kind, src) => {
    expect(src.includes('(todo.id)')).toBe(kind === 'keyed');
    const Todos = instantiate(svelteCompile(src, 'Todos').js.code, 'Todos', $rt);
    const root = freshRoot();
    mount(Todos, { target: root, props: { title: 'Дела' } });
    flushSync();
    const before = [...root.querySelectorAll('li')];
    const toggle = records(root, () => (before[0].querySelector('button') as HTMLElement).click());
    const reverse = records(root, () => (root.querySelector('h2 + button') as HTMLElement).click());
    expect({ toggle, reverse }).toEqual(t.EACH_RECORDS[kind]);
    const after = [...root.querySelectorAll('li')];
    expect(after.map((li) => li.textContent!.trim().replace(/\s+/g, ' '))).toEqual(['○ Полить цветы', '✓ Позвонить маме', '✓ Купить чай']);
    if (kind === 'keyed') expect(after.every((li, i) => li === before[before.length - 1 - i])).toBe(true);
    else expect(after.every((li, i) => li === before[i])).toBe(true);
  });

  it('DOM обновляется в микрозадаче: сразу после клика текст старый', async () => {
    const Todos = instantiate(svelteCompile(t.TODOS_SRC, 'Todos').js.code, 'Todos', $rt);
    const root = freshRoot();
    mount(Todos, { target: root, props: { title: 'Дела' } });
    flushSync();
    (root.querySelector('li button') as HTMLElement).click();
    expect(root.querySelector('h2')!.textContent).toBe('Дела — осталось 2');
    await Promise.resolve();
    expect(root.querySelector('h2')!.textContent).toBe('Дела — осталось 1');
  });
});

// ===========================================================================
// Proxy и $state.raw
// ===========================================================================

describe('$state и Proxy', () => {
  it('Cart: тексты кнопок после каждого клика', () => {
    const Cart = instantiate(svelteCompile(t.CART_SRC, 'Cart').js.code, 'Cart', $rt);
    const root = freshRoot();
    mount(Cart, { target: root });
    flushSync();
    const buttons = [...root.querySelectorAll('button')] as HTMLElement[];
    const texts = () => buttons.map((b) => b.textContent);
    const seen = [texts()];
    for (const i of [0, 2, 3, 1]) {
      buttons[i].click();
      flushSync();
      seen.push(texts());
    }
    expect(seen).toEqual(t.CART_CLICKS.map((c) => c.buttons));
  });

  it('исходный объект не меняется — у Svelte и у мини-рун; у Vue `reactive` меняется', () => {
    const mini = loadRunes(t.MINI_RUNES_CODE).$ as unknown as { proxy: <T>(v: T) => T };
    for (const proxy of [$rt.proxy as unknown as <T>(v: T) => T, mini.proxy]) {
      const o = { n: 1, inner: { m: 1 } };
      const p = proxy(o);
      p.n = 2;
      expect([p.n, o.n]).toEqual([2, 1]);
      expect(p.inner).not.toBe(o.inner); // вложенный объект обёрнут при чтении
    }
    const v = { n: 1 };
    reactive(v).n = 2;
    expect(v.n).toBe(2);
  });

  it('класс, Map, Date возвращаются без прокси — у Svelte и у мини-рун', () => {
    const mini = loadRunes(t.MINI_RUNES_CODE).$ as unknown as { proxy: (v: unknown) => unknown };
    class Box {
      x = 1;
    }
    for (const proxy of [$rt.proxy as unknown as (v: unknown) => unknown, mini.proxy]) {
      for (const value of [new Box(), new Map(), new Date(0)]) expect(proxy(value)).toBe(value);
      const plain = {};
      expect(proxy(plain)).not.toBe(plain);
    }
  });

  it('mutable_source режима совместимости считает объект изменённым при записи того же объекта', () => {
    const o = {};
    const ms = ($rt.mutable_source as (v: unknown) => unknown)(o);
    const st = ($rt.state as (v: unknown) => unknown)(o);
    const runs = { mutable: 0, state: 0 };
    const get = $rt.get as (s: unknown) => unknown;
    const set = $rt.set as (s: unknown, v: unknown) => unknown;
    ($rt.effect_root as (fn: () => void) => unknown)(() => {
      ($rt.template_effect as (fn: () => void) => unknown)(() => (get(ms), runs.mutable++));
      ($rt.template_effect as (fn: () => void) => unknown)(() => (get(st), runs.state++));
    });
    set(ms, o);
    set(st, o);
    flushSync();
    expect(runs).toEqual({ mutable: 2, state: 1 });
  });
});

// ===========================================================================
// $effect против $derived и порядок — до включения режима совместимости
// ===========================================================================

describe('$effect видит обновлённый DOM', () => {
  function orderLog(src: string): string[] {
    const out: string[] = [];
    const Counter = instantiate(svelteCompile(src, 'Counter').js.code, 'Counter', $rt);
    const root = freshRoot();
    mount(Counter, { target: root, props: { log: (s: string) => out.push(s) } });
    flushSync();
    out.push('— клик');
    (root.querySelector('button') as HTMLElement).click();
    flushSync();
    return out;
  }

  it('руны: ORDER_RUNES', () => {
    expect(orderLog(t.RUNES_SRC)).toEqual(t.ORDER_RUNES);
  });

  it('$effect.pre видит DOM до обновления', () => {
    const log = orderLog(t.RUNES_SRC.replace('$effect(', '$effect.pre(').replace('button.textContent', 'button?.textContent'));
    expect(log[0]).toBe('$effect: count = 0, в DOM «undefined»');
    expect(log.at(-1)).toBe('$effect: count = 1, в DOM «0 × 2 = 0»');
    expect(t.LEGACY_ROWS.at(-1)![2]).toContain('`$effect.pre` — до');
  });
});

// ===========================================================================
// Режим совместимости — последним: флаг глобальный
// ===========================================================================

describe('let и $: в режиме совместимости', () => {
  beforeAll(async () => {
    await import(pathToFileURL(join(ROOT, 'node_modules/svelte/src/internal/flags/legacy.js')).href);
  });

  it('ORDER_LEGACY: $: выполняется до обновления DOM', () => {
    const out: string[] = [];
    const Counter = instantiate(svelteCompile(t.LEGACY_SRC, 'Counter').js.code, 'Counter', $rt);
    const root = freshRoot();
    mount(Counter, { target: root, props: { log: (s: string) => out.push(s) } });
    flushSync();
    out.push('— клик');
    (root.querySelector('button') as HTMLElement).click();
    flushSync();
    expect(out).toEqual(t.ORDER_LEGACY);
  });

  it('push без присваивания не виден, `items = items` — виден', () => {
    const src = `<script>
  let items = [];
</script>

<button on:click={() => items.push(1)}>{items.length}</button>
<button on:click={() => { items.push(1); items = items; }}>{items.length}</button>`;
    const C = instantiate(svelteCompile(src, 'Items').js.code, 'Items', $rt);
    const root = freshRoot();
    mount(C, { target: root });
    flushSync();
    const [a, b] = [...root.querySelectorAll('button')] as HTMLElement[];
    a.click();
    flushSync();
    expect([a.textContent, b.textContent]).toEqual(['0', '0']);
    b.click();
    flushSync();
    expect([a.textContent, b.textContent]).toEqual(['2', '2']);
    expect(t.LEGACY_ROWS.find((r) => r[0] === '`push` в массив')![1]).toContain('`items = items`');
  });
});
