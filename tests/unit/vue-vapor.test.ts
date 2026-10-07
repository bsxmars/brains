import Module, { createRequire } from 'node:module';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { Window } from 'happy-dom';
import { rolldown } from 'rolldown';
import { describe, expect, it } from 'vitest';
import * as D from '@/content/frameworks/vue-vapor/data';
import {
  applyScenario,
  BINDINGS,
  countKinds,
  DomProbe,
  evalModule,
  loadMiniVapor,
  MiniSide,
  VdomSide,
  type DomOp,
  type MiniRef,
  type Scenario,
  type VueLike,
} from '@/widgets/vapor-lab';

/**
 * «Vapor Mode во Vue»: настоящий Vapor 3.6.0-rc.9 против VDOM 3.5/3.6 и учебного мини-vapor.
 *
 * ⚠️ **Три версии Vue в одном процессе — и каждую легко загрузить не ту.**
 *   - Сайт живёт на 3.5.42 (`node_modules/@vue/*`). Здесь он нужен как VDOM-сторона: из него же
 *     демо исполняет `VDOM_CODE` в браузере.
 *   - 3.6.0-rc.9 стоит алиасом `node_modules/vue-vapor`, его `@vue/*` вложены. `compiler-vapor`
 *     при этом лежит **наверху** (`node_modules/@vue/compiler-vapor`) со своими вложенными
 *     `compiler-dom`/`compiler-core` 3.6 — а соседний верхний `compiler-dom` это 3.5.42. Поэтому
 *     проверка версий обходит все загруженные `package.json`, а не верит пути входа.
 *   - Рантайм 3.6 берётся самодостаточными файлами `vue.runtime-with-vapor.esm-browser*.js`:
 *     у `runtime-vapor` есть только `esm-bundler`-сборка с голыми импортами, а условие
 *     `development`, с которым vitest разрешает пакеты (см. `vue-internals.test.ts`), выбрало бы
 *     сборку за нас. Файл называется явно — значит, и сборка выбрана явно; каждая проверяется
 *     по `version` и по наличию `createVaporApp`.
 *
 * DOM — happy-dom, глобалами, до загрузки любого рантайма: `runtime-dom` 3.5 запоминает
 * `document` при загрузке модуля.
 *
 * Все DOM-операции считает один щуп — `widgets/vapor-lab/model/probe.ts`, тот же, что в демо.
 * Таймеров нет: только `nextTick`.
 */

// ---------------------------------------------------------------------------
// Окружение: happy-dom глобалами
// ---------------------------------------------------------------------------

const win = new Window();
const G = globalThis as Record<string, unknown>;
for (const key of [
  'document', 'Node', 'Element', 'HTMLElement', 'Text', 'Comment', 'CharacterData', 'Document', 'DocumentFragment',
  'HTMLTemplateElement', 'SVGElement', 'MathMLElement', 'MutationObserver', 'Event', 'customElements',
]) {
  G[key] = (win as unknown as Record<string, unknown>)[key];
}
G.window = win;

const ENV = win as unknown as ConstructorParameters<typeof DomProbe>[1];
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const VAPOR_PKG = join(ROOT, 'node_modules/vue-vapor');
const RC = '3.6.0-rc.9';

function container(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

/** Комментарии у сторон разные (`<!--v-if-->` в dev-VDOM, `<!---->` у Vapor) — сверяем без них. */
const html = (el: Element) => el.innerHTML.replace(/<!--[\s\S]*?-->/g, '');

/** Пустые строки и хвостовые пробелы в выводе компилятора — шум форматирования, а не смысл. */
const norm = (code: string) => code.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

// ---------------------------------------------------------------------------
// Компиляторы: 3.5.42 сверху, 3.6.0-rc.9 из vue-vapor
// ---------------------------------------------------------------------------

/** Та часть `@vue/compiler-sfc`, что нужна здесь. Типы 3.5 про `vapor` не знают, поэтому свои. */
interface Sfc {
  version: string;
  parse(source: string, options?: { filename?: string }): { descriptor: { vapor?: boolean } };
  compileScript(descriptor: object, options: { id: string; inlineTemplate?: boolean; vapor?: boolean }): { content: string };
}
const requireTop = createRequire(join(ROOT, 'package.json'));
const requireVapor = createRequire(join(VAPOR_PKG, 'package.json'));
const SFC35 = requireTop('@vue/compiler-sfc') as Sfc;
const SFC36 = requireVapor('@vue/compiler-sfc') as Sfc;

/** Версии всех пакетов `@vue/*`, чьи файлы лежат в кеше `require`. */
function loadedVersions(filter: (file: string) => boolean): Record<string, string> {
  const out: Record<string, string> = {};
  for (const file of Object.keys(requireTop.cache).filter(filter)) {
    const m = /^(.*\/node_modules\/@vue\/[^/]+)\//.exec(file);
    if (!m) continue;
    out[m[1].slice(ROOT.length + 1)] = JSON.parse(readFileSync(join(m[1], 'package.json'), 'utf8')).version;
  }
  return out;
}

function compile(sfc: Sfc, source: string, vapor?: boolean): string {
  const { descriptor } = sfc.parse(source, { filename: 'Cart.vue' });
  return sfc.compileScript(descriptor, { id: 'cart', inlineTemplate: true, vapor }).content;
}

const VDOM_SFC = D.CART_SFC.replace('<script setup vapor>', '<script setup>');

// ---------------------------------------------------------------------------
// Рантаймы
// ---------------------------------------------------------------------------

type Build = 'production' | 'development';
const BUILDS: Build[] = ['production', 'development'];

/** Vue 3.5.42 заказанной сборки — подменой разрешения имён, как в `vue-internals.test.ts`. */
function loadVue35(build: Build): { vue: VueLike; files: string[] } {
  const resolver = Module as unknown as { _resolveFilename: (request: string, ...rest: unknown[]) => string };
  const original = resolver._resolveFilename;
  const suffix = build === 'production' ? '.prod' : '';
  const top = (key: string) => key.includes('/node_modules/@vue/') && !key.includes('/vue-vapor/') && !key.includes('/compiler-');
  for (const key of Object.keys(requireTop.cache)) if (top(key)) delete requireTop.cache[key];
  resolver._resolveFilename = function (request, ...rest) {
    const pkg = /^@vue\/(runtime-dom|runtime-core|reactivity|shared)$/.exec(request)?.[1];
    if (pkg) return original.call(this, join(ROOT, `node_modules/@vue/${pkg}/dist/${pkg}.cjs${suffix}.js`), ...rest);
    return original.call(this, request, ...rest);
  };
  try {
    const vue = requireTop('@vue/runtime-dom') as VueLike;
    const files = Object.keys(requireTop.cache).filter(top).map((f) => f.split('/dist/')[1]);
    return { vue, files };
  } finally {
    resolver._resolveFilename = original;
  }
}

interface App36 {
  mount(el: Element): unknown;
  use(plugin: unknown): App36;
  unmount(): void;
  config: { globalProperties: Record<string, unknown> };
}

type Vue36 = {
  [helper: string]: unknown;
  ref(value: unknown): MiniRef;
  nextTick(): Promise<void>;
  version: string;
  createVaporApp(component: unknown): App36;
  createApp(component: unknown): App36;
  vaporInteropPlugin: unknown;
  ReactiveEffect: { prototype: { run(): unknown } };
  defineVaporComponent(options: unknown): unknown;
  template(html: string): () => Node;
  renderEffect(fn: () => void): void;
  setText(node: Node, value: string): void;
  getCurrentInstance(): unknown;
  h(component: unknown): unknown;
};

async function loadVue36(build: Build): Promise<Vue36> {
  const file = join(VAPOR_PKG, `dist/vue.runtime-with-vapor.esm-browser${build === 'production' ? '.prod' : ''}.js`);
  return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Vue36;
}

const VUE35: Record<Build, ReturnType<typeof loadVue35>> = { production: loadVue35('production'), development: loadVue35('development') };
const VUE36: Record<Build, Vue36> = { production: await loadVue36('production'), development: await loadVue36('development') };

/** Счётчик прогонов `ReactiveEffect.run` — у каждого экземпляра Vue 3.6 свой. */
const EFFECT_RUNS = new Map<Vue36, { n: number }>();
function effectCounter(vue: Vue36): { n: number } {
  let counter = EFFECT_RUNS.get(vue);
  if (!counter) {
    const c = { n: 0 };
    counter = c;
    const proto = vue.ReactiveEffect.prototype;
    const run = proto.run;
    proto.run = function (this: unknown) {
      c.n++;
      return run.call(this);
    };
    EFFECT_RUNS.set(vue, c);
  }
  return counter;
}

/** Настоящий Vapor-компонент `Cart` из литерала `VAPOR_CODE` — со счётчиками. */
class RealVaporSide {
  readonly refs = {} as Record<(typeof BINDINGS)[number], MiniRef>;
  readonly counter: { n: number };
  setTextCalls = 0;

  constructor(
    private readonly vue: Vue36,
    readonly el: HTMLElement,
  ) {
    this.counter = effectCounter(vue);
    const created: MiniRef[] = [];
    const deps = {
      ...vue,
      ref: (v: unknown) => (created.push(vue.ref(v)), created.at(-1)),
      setText: (node: Node, value: string) => {
        this.setTextCalls++;
        vue.setText(node, value);
      },
    };
    vue.createVaporApp(evalModule(D.VAPOR_CODE, deps)).mount(el);
    BINDINGS.forEach((name, i) => (this.refs[name] = created[i]));
  }

  async run(scenario: Pick<Scenario, 'code'>) {
    this.counter.n = 0;
    this.setTextCalls = 0;
    const probe = new DomProbe(this.el, ENV).start();
    try {
      applyScenario(this.refs, scenario.code);
      await this.vue.nextTick();
    } finally {
      probe.stop();
    }
    return { effects: this.counter.n, ops: probe.ops, setText: this.setTextCalls };
  }
}

const scenario = (id: string) => {
  const s = D.SCENARIOS.find((x) => x.id === id);
  if (!s) throw new Error(`нет сценария ${id}`);
  return s;
};

const mini = () => new MiniSide(loadMiniVapor(D.MINI_VAPOR_CODE), D.CART_TEMPLATE, D.CART_INITIAL, container(), ENV);
const vdom = (vue: VueLike) => new VdomSide(vue, D.VDOM_CODE, container(), ENV);
const kinds = (ops: DomOp[]) => countKinds(ops);

// ---------------------------------------------------------------------------
// 1. Загружено то, что заказано
// ---------------------------------------------------------------------------

describe('версии и сборки', () => {
  it('компилятор 3.6 — rc.9 целиком, включая compiler-vapor и его вложенные пакеты', () => {
    expect(SFC36.version).toBe(RC);
    compile(SFC36, D.CART_SFC, true); // подтянуть compiler-vapor
    const versions = loadedVersions((f) => f.includes('/vue-vapor/') || f.includes('/compiler-vapor/'));
    expect(Object.keys(versions)).toEqual(
      expect.arrayContaining([
        'node_modules/vue-vapor/node_modules/@vue/compiler-sfc',
        'node_modules/@vue/compiler-vapor',
        'node_modules/@vue/compiler-vapor/node_modules/@vue/compiler-dom',
      ]),
    );
    expect(new Set(Object.values(versions))).toEqual(new Set([RC]));
  });

  it('компилятор 3.5 — 3.5.42', () => {
    expect(SFC35.version).toBe('3.5.42');
  });

  it.each(BUILDS)('Vue 3.5 %s — три пакета нужной сборки', (build) => {
    const suffix = build === 'production' ? '.cjs.prod.js' : '.cjs.js';
    expect(VUE35[build].files.sort()).toEqual(['reactivity', 'runtime-core', 'runtime-dom', 'shared'].map((p) => p + suffix));
    expect((VUE35[build].vue as unknown as { version: string }).version).toBe('3.5.42');
  });

  it.each(BUILDS)('Vue 3.6 %s — rc.9 с Vapor', (build) => {
    expect(VUE36[build].version).toBe(RC);
    expect(typeof VUE36[build].createVaporApp).toBe('function');
    expect(VUE36.production).not.toBe(VUE36.development);
  });
});

// ---------------------------------------------------------------------------
// 2. Вывод компиляторов
// ---------------------------------------------------------------------------

describe('раздел «Один компонент — два вывода»: литералы = живой вывод', () => {
  it('VAPOR_CODE — вывод compiler-sfc 3.6.0-rc.9 с vapor', () => {
    expect(D.VAPOR_CODE).toBe(norm(compile(SFC36, D.CART_SFC, true)));
  });

  it('VDOM_CODE — вывод compiler-sfc 3.5.42', () => {
    expect(D.VDOM_CODE).toBe(norm(compile(SFC35, VDOM_SFC)));
  });

  it('VDOM-вывод 3.6.0-rc.9 совпадает с 3.5.42 символ в символ', () => {
    expect(compile(SFC36, VDOM_SFC)).toBe(compile(SFC35, VDOM_SFC));
  });

  it('факты карточек: строка шаблона, один эффект на блок, флаги', () => {
    expect(D.VAPOR_CODE).toContain('_template("<section class=cart><h2> </h2><p> </p><ul></ul><!><button>+1", 1)');
    // два эффекта на весь компонент: корень и строка списка; title и count — в одном
    expect(D.VAPOR_CODE.match(/_renderEffect\(/g)).toHaveLength(2);
    const root = D.VAPOR_CODE.slice(D.VAPOR_CODE.indexOf('_renderEffect(() => {'), D.VAPOR_CODE.indexOf('_setInsertionState(n'));
    expect(root).toContain('title.value');
    expect(root).toContain('_count');
    expect(D.VAPOR_CODE).toContain('9 /* FAST_REMOVE, IS_SINGLE_NODE */');
    expect(D.VAPOR_CODE).toContain('33 /* TRUE_SINGLE_ROOT, TRUE_NO_SCOPE */');
    expect(D.OUTPUT_FACTS.map((f) => f.d).join(' ')).toContain('"<section class=cart><h2> </h2><p> </p><ul></ul><!><button>+1"');
  });

  it('у VDOM — девять вызовов, создающих VNode, в тексте render-функции', () => {
    expect(D.VDOM_CODE.match(/_create(ElementVNode|ElementBlock|CommentVNode)\(/g)).toHaveLength(9);
    expect(D.OUTPUT_NOTE).toContain('девять вызовов');
  });
});

describe('раздел «Рантайм»: исходник rc.9', () => {
  const dist = readFileSync(join(VAPOR_PKG, 'node_modules/@vue/runtime-vapor/dist/runtime-vapor.esm-bundler.js'), 'utf8');
  it('setText пишет, только если значение сменилось', () => {
    expect(dist).toContain(D.SETTEXT_SOURCE);
  });
  it('setClassName сверяет маску', () => {
    expect(dist).toContain('if (flags === el.$clsFlags) return;');
  });
  it('template разбирает строку через <template> один раз, дальше клонирует', () => {
    expect(dist).toMatch(/t = t \|\| document\.createElement\("template"\)/);
    expect(dist).toContain('const ret = cloneTemplate(node);');
  });
});

// ---------------------------------------------------------------------------
// 3. Мини-vapor: вывод и честность счётчиков
// ---------------------------------------------------------------------------

describe('мини-vapor', () => {
  it('MINI_OUT — вывод мини-компилятора для шаблона Cart', () => {
    expect(loadMiniVapor(D.MINI_VAPOR_CODE).compile(D.CART_TEMPLATE, [...BINDINGS])).toBe(D.MINI_OUT);
  });

  it('«примерно на трёхстах строках» — правда', () => {
    const lines = D.MINI_VAPOR_CODE.split('\n').length;
    expect(lines).toBeGreaterThan(270);
    expect(lines).toBeLessThan(350);
    expect(D.INTRO_NOTE).toContain('примерно на трёхстах строках');
  });

  it('как у настоящего: два renderEffect — корень и строка', () => {
    expect(D.MINI_OUT.match(/renderEffect\(/g)).toHaveLength(2);
  });

  it('собственный крючок touch и щуп DOM видят одно и то же на каждом шаге', async () => {
    const side = mini();
    for (const id of D.SEQUENCE) {
      const r = await side.run(scenario(id));
      expect(kinds(r.touched), id).toEqual(kinds(r.ops));
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Замер: последовательность действий
// ---------------------------------------------------------------------------

describe('раздел «Одна запись»: MEASURED снят, а не написан', () => {
  it('таблица покрывает SEQUENCE по порядку', () => {
    expect(D.MEASURED.map((r) => r.id)).toEqual(D.SEQUENCE);
  });

  it.each([
    ['3.5 prod', () => VUE35.production.vue],
    ['3.5 dev', () => VUE35.development.vue],
    ['3.6 prod', () => VUE36.production],
    ['3.6 dev', () => VUE36.development],
  ] as const)('VDOM %s', async (_name, get) => {
    const side = vdom(get());
    const got = [];
    for (const id of D.SEQUENCE) got.push({ id, vdom: (await side.run(scenario(id))).step });
    expect(got).toEqual(D.MEASURED.map(({ id, vdom }) => ({ id, vdom })));
  });

  it.each(BUILDS)('Vapor 3.6.0-rc.9 %s', async (build) => {
    const side = new RealVaporSide(VUE36[build], container());
    const got = [];
    for (const id of D.SEQUENCE) {
      const r = await side.run(scenario(id));
      got.push({ id, vapor: { effects: r.effects, ops: r.ops.length } });
    }
    expect(got).toEqual(D.MEASURED.map(({ id, vapor }) => ({ id, vapor })));
  });

  it('мини-vapor', async () => {
    const side = mini();
    const got = [];
    for (const id of D.SEQUENCE) got.push({ id, vapor: (await side.run(scenario(id))).step });
    expect(got).toEqual(D.MEASURED.map(({ id, vapor }) => ({ id, vapor })));
  });

  it.each(BUILDS)('мини против Vapor %s: виды операций и HTML на каждом шаге', async (build) => {
    const real = new RealVaporSide(VUE36[build], container());
    const m = mini();
    const v = vdom(VUE35.production.vue);
    const el = (side: { container: Element }) => side.container;
    expect(html(real.el)).toBe(html(el(m)));
    expect(html(el(v))).toBe(html(real.el));
    for (const id of D.SEQUENCE) {
      const a = await real.run(scenario(id));
      const b = await m.run(scenario(id));
      await v.run(scenario(id));
      expect(kinds(b.ops), id).toEqual(kinds(a.ops));
      expect(html(el(m)), id).toBe(html(real.el));
      expect(html(el(v)), id).toBe(html(real.el));
    }
  });

  it('текст опирается на таблицу: VNode 7–10 на действие, DOM у сторон поровну или у Vapor меньше', () => {
    const acting = D.MEASURED.filter((r) => r.vdom.render > 0);
    expect(Math.min(...acting.map((r) => r.vdom.vnodes))).toBe(7);
    expect(Math.max(...acting.map((r) => r.vdom.vnodes))).toBe(10);
    for (const r of D.MEASURED) expect(r.vapor.ops, r.id).toBeLessThanOrEqual(r.vdom.ops);
    // меньше — только на ветках v-if
    expect(D.MEASURED.filter((r) => r.vapor.ops < r.vdom.ops).map((r) => r.id)).toEqual(['toggle', 'toggle']);
    expect(D.MEASURE_NOTE).toContain('7–10 VNode');
    expect(D.MEASURE_NOTE).toContain('На `v-if` Vapor ещё и экономит DOM');
  });

  it('смена заголовка: один эффект, два вызова setText, одна DOM-операция', async () => {
    const side = new RealVaporSide(VUE36.production, container());
    const r = await side.run(scenario('title'));
    expect([r.effects, r.setText, r.ops.length]).toEqual([1, 2, 1]);
    expect(D.BLOCK_EFFECT_NOTE).toContain('один прогон эффекта, два вызова `setText` и **одна** DOM-операция');
  });

  it('count 4 → 5: условие пересчитано, ветка не тронута — одна запись текста', async () => {
    for (const make of [() => new RealVaporSide(VUE36.production, container()), mini]) {
      const side = make();
      await side.run({ code: 'count.value = 4' });
      const r = await side.run({ code: 'count.value = 5' });
      const effects = 'step' in r ? r.step.effects : r.effects;
      expect(effects).toBe(2);
      expect(kinds(r.ops)).toEqual({ text: 1 });
    }
  });

  it('FAST_REMOVE: очистка пяти строк — 2 операции у Vapor и мини, 5 у VDOM', async () => {
    const fill = "items.value = [1, 2, 3, 4, 5].map((id) => ({ id, name: 'x' + id }))";
    const out: number[] = [];
    for (const side of [new RealVaporSide(VUE36.production, container()), mini(), vdom(VUE35.production.vue), vdom(VUE36.production)]) {
      await side.run({ code: fill });
      out.push((await side.run(scenario('clear'))).ops.length);
    }
    expect(out).toEqual([2, 2, 5, 5]);
    expect(D.FAST_REMOVE_NOTE).toContain('на пяти строках замер дал 5 операций против 2');
  });
});

// ---------------------------------------------------------------------------
// 5. Включение, смешивание, ограничения
// ---------------------------------------------------------------------------

function capture<T>(fn: () => T): { value: T | string; warnings: string[] } {
  const warnings: string[] = [];
  const { warn, error } = console;
  console.warn = (...a: unknown[]) => warnings.push(a.map(String).join(' '));
  console.error = (...a: unknown[]) => warnings.push(a.map(String).join(' '));
  try {
    return { value: fn(), warnings };
  } catch (e) {
    return { value: `${(e as Error).name}: ${(e as Error).message}`, warnings };
  } finally {
    console.warn = warn;
    console.error = error;
  }
}

function sfcComponent(vue: Vue36, source: string, deps: Record<string, unknown> = {}): unknown {
  const { descriptor } = SFC36.parse(source, { filename: 'C.vue' });
  return evalModule(SFC36.compileScript(descriptor, { id: 'c', inlineTemplate: true }).content, { ...vue, ...deps });
}

const VAPOR_CHILD = "<script setup vapor>\nimport { ref } from 'vue'\nconst n = ref(1)\n</script>\n<template><b>vapor {{ n }}</b></template>";
const VDOM_CHILD = "<script setup>\nimport { ref } from 'vue'\nconst n = ref(2)\n</script>\n<template><i>vdom {{ n }}</i></template>";
const VAPOR_PARENT = "<script setup vapor>\nimport D from './D.vue'\n</script>\n<template><div><D /></div></template>";

describe('раздел «Как включить и смешать»', () => {
  it('атрибут vapor: у <script setup>, у <script> без setup и у <template>', () => {
    expect(SFC36.parse(D.CART_SFC).descriptor.vapor).toBe(true);
    expect(SFC36.parse('<template vapor><b>1</b></template>').descriptor.vapor).toBe(true);
    expect(SFC36.parse(VDOM_CHILD).descriptor.vapor).toBe(false);
    const code = compile(SFC36, '<script vapor>\nconst a = 1\n</script>\n<template><b>{{ a }}</b></template>');
    expect(code).toContain('__vapor: true');
    expect(code).toContain('setup(__props)');
  });

  it('<script vapor> с export default — ошибка компиляции', () => {
    const r = capture(() => compile(SFC36, '<script vapor>\nexport default { data() { return { m: 5 } } }\n</script>\n<template><b>{{ m }}</b></template>'));
    expect(r.value).toMatch(/<script setup> cannot contain ES module exports/);
  });

  describe.each(BUILDS)('%s', (build) => {
    const vue = VUE36[build];
    const dev = build === 'development';

    it('createApp + Vapor-компонент без плагина: TypeError, в dev ещё и предупреждение', () => {
      const child = sfcComponent(vue, VAPOR_CHILD);
      const r = capture(() => vue.createApp({ render: () => vue.h(child) }).mount(container()));
      expect(r.value).toMatch(/^TypeError/);
      expect(r.warnings.some((w) => w.includes('vapor-in-vdom interop was not installed'))).toBe(dev);
    });

    it('createApp + Vapor-компонент с плагином рендерится', () => {
      const child = sfcComponent(vue, VAPOR_CHILD);
      const el = container();
      vue.createApp({ render: () => vue.h(child) }).use(vue.vaporInteropPlugin).mount(el);
      expect(el.innerHTML).toBe('<b>vapor 1</b>');
    });

    it('createVaporApp + VDOM-компонент без плагина: пустота; в prod — без единого слова', () => {
      const D2 = sfcComponent(vue, VDOM_CHILD);
      const el = container();
      const r = capture(() => vue.createVaporApp(sfcComponent(vue, VAPOR_PARENT, { D: D2 })).mount(el));
      expect(el.innerHTML).toBe('<div></div>');
      expect(r.warnings.length > 0).toBe(dev);
    });

    it('createVaporApp + VDOM-компонент с плагином рендерится', () => {
      const D2 = sfcComponent(vue, VDOM_CHILD);
      const el = container();
      const app = vue.createVaporApp(sfcComponent(vue, VAPOR_PARENT, { D: D2 }));
      app.use(vue.vaporInteropPlugin);
      app.mount(el);
      expect(el.innerHTML).toBe('<div><i>vdom 2</i></div>');
    });
  });

  it('таблица APPS_ROWS называет обе сборки и тишину prod', () => {
    expect(D.APPS_ROWS[0][2]).toContain('`TypeError`');
    expect(D.APPS_ROWS[1][2]).toContain('в prod — **ни слова**');
  });
});

describe('раздел «Чего нет в rc.9»', () => {
  it.each(BUILDS)('%s: data() и mounted у defineVaporComponent молча игнорируются', (build) => {
    const vue = VUE36[build];
    let mounted = false;
    const C = vue.defineVaporComponent({
      data: () => ({ m: 5 }),
      mounted() {
        mounted = true;
      },
      setup() {
        const n = vue.template('<u> ')();
        const i = vue.getCurrentInstance() as { proxy?: { m?: unknown } } | null;
        vue.renderEffect(() => vue.setText(n.firstChild!, String(i?.proxy?.m)));
        return n;
      },
    });
    const el = container();
    const r = capture(() => vue.createVaporApp(C).mount(el));
    expect(el.innerHTML).toBe('<u>undefined</u>');
    expect(mounted).toBe(false);
    expect(r.warnings).toEqual([]);
  });

  it.each(BUILDS)('%s: getCurrentInstance() в Vapor — null, в VDOM — объект', (build) => {
    const vue = VUE36[build];
    const src = (vapor: boolean) =>
      `<script setup${vapor ? ' vapor' : ''}>\nimport { getCurrentInstance } from 'vue'\nconst t = String(getCurrentInstance() === null)\n</script>\n<template><b>{{ t }}</b></template>`;
    const a = container();
    const b = container();
    vue.createVaporApp(sfcComponent(vue, src(true))).mount(a);
    vue.createApp(sfcComponent(vue, src(false))).mount(b);
    expect([a.innerHTML, b.innerHTML]).toEqual(['<b>true</b>', '<b>false</b>']);
  });

  it.each(BUILDS)('%s: globalProperties — голое $x в Vapor, значение в VDOM', (build) => {
    const vue = VUE36[build];
    const src = (vapor: boolean) => `<script setup${vapor ? ' vapor' : ''}>\nconst k = 1\n</script>\n<template><b>{{ $x }}</b></template>`;
    const a = container();
    const b = container();
    const va = vue.createVaporApp(sfcComponent(vue, src(true)));
    va.config.globalProperties.$x = 'GP';
    const r = capture(() => va.mount(a));
    const vb = vue.createApp(sfcComponent(vue, src(false)));
    vb.config.globalProperties.$x = 'GP';
    vb.mount(b);
    expect(b.innerHTML).toBe('<b>GP</b>');
    expect(a.innerHTML).toBe('');
    if (build === 'development') expect(r.value).toBe('ReferenceError: $x is not defined');
    // в prod mount не бросает: ошибка уходит в console.error, а на месте компонента пусто
    else expect([r.value, r.warnings]).toEqual([undefined, ['ReferenceError: $x is not defined']]);
    expect(D.LIMITS[2].d).toContain('в prod `mount` не бросает');
  });
});

// ---------------------------------------------------------------------------
// 6. Вес
// ---------------------------------------------------------------------------

const bytes = (s: string) => s.replace(/\s/g, '');

describe('раздел «Вес»', () => {
  it('размеры файлов dist', () => {
    for (const [file, size] of D.WEIGHT_ROWS) {
      const name = file.replace(/`/g, '');
      expect(String(statSync(join(VAPOR_PKG, 'dist', name)).size), name).toBe(bytes(size));
    }
  });

  it('три сборки rolldown: байты, gzip и то, что они работают', async () => {
    expect((requireTop('rolldown/package.json') as { version: string }).version).toBe('1.2.8');
    const VUE_ENTRY = join(VAPOR_PKG, 'dist/vue.runtime.esm-bundler.js');
    const app = (vapor: boolean) => compile(SFC36, vapor ? D.BUNDLE_APP : D.BUNDLE_APP.replace(' vapor', ''), vapor);
    const entries = [
      "import App from 'virtual:vdom'\nimport { createApp } from 'vue'\ncreateApp(App).mount('#app')",
      "import App from 'virtual:vapor'\nimport { createVaporApp } from 'vue'\ncreateVaporApp(App).mount('#app')",
      "import App from 'virtual:vapor'\nimport { createApp, vaporInteropPlugin } from 'vue'\ncreateApp(App).use(vaporInteropPlugin).mount('#app')",
    ];
    const got: string[][] = [];
    for (const entry of entries) {
      const bundle = await rolldown({
        input: 'entry',
        logLevel: 'silent',
        plugins: [
          {
            name: 'cart',
            resolveId: (id: string) => (id === 'entry' || id.startsWith('virtual:') ? '\0' + id : id === 'vue' ? VUE_ENTRY : null),
            load: (id: string) => (id === '\0entry' ? entry : id === '\0virtual:vdom' ? app(false) : id === '\0virtual:vapor' ? app(true) : null),
          },
        ],
        transform: {
          define: {
            'process.env.NODE_ENV': '"production"',
            __VUE_OPTIONS_API__: 'false',
            __VUE_PROD_DEVTOOLS__: 'false',
            __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
          },
        },
      });
      const { output } = await bundle.generate({ format: 'esm', minify: true });
      const code = output[0].code;
      got.push([String(Buffer.byteLength(code)), String(gzipSync(code, { level: 9 }).length)]);

      // сборка работает: кнопка печатает 0, после клика 1
      document.body.innerHTML = '<div id="app"></div>';
      await evalBundle(code);
      const button = document.querySelector('button')!;
      expect(button.textContent).toBe('0');
      button.click();
      for (let i = 0; i < 4; i++) await Promise.resolve();
      expect(button.textContent).toBe('1');
    }
    expect(got).toEqual(D.BUNDLE_ROWS.map(([, size, gz]) => [bytes(size), bytes(gz)]));
    // вывод текста: «легче примерно на четверть, смешанное — вдвое тяжелее»
    const [vdomSize, vaporSize, mixedSize] = got.map(([size]) => Number(size));
    expect(1 - vaporSize / vdomSize).toBeGreaterThan(0.2);
    expect(1 - vaporSize / vdomSize).toBeLessThan(0.3);
    expect(mixedSize / vdomSize).toBeGreaterThan(1.9);
    expect(mixedSize / vdomSize).toBeLessThan(2.2);
  });
});

/** Собранный ESM без импортов: исполнить как тело функции, `export` в нём нет. */
async function evalBundle(code: string): Promise<void> {
  expect(code).not.toMatch(/^\s*(import|export)\b/m);
  new Function(code)();
}
