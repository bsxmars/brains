import Module, { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import {
  BLOCK_CODE,
  BLOCK_LOG,
  COMPILED_SAMPLE,
  COMPONENT_CODE,
  COMPONENT_LOG,
  FLAGS_CODE,
  FLAGS_LOG,
  KEYED_LOG,
  KEYED_WALK,
  MINI_PATCH_CODE,
  MOUNT_CODE,
  MOUNT_LOG,
  MOVES_ROWS,
  PATCH_SCENARIOS,
  STATIC_NOTE,
  TEMPLATE_SAMPLE,
  UNKEYED_CODE,
  UNKEYED_LOG,
  VNODE_CODE,
  VNODE_LOG,
} from '@/content/frameworks/vue-patch-internals/data';
import { keyedList, loadMiniPatch, reactRuleMoves, runKeyed, shuffleKeys } from '@/widgets/mini-patch/model/run';
import type { MiniPatch, RendererApi, TraceEvent } from '@/widgets/mini-patch/model/types';

/**
 * «Vue 3 изнутри: рендерер и patch»: мини-рендерер против настоящего.
 *
 * Все проверки исполняют **ту же строку** `MINI_PATCH_CODE`, что напечатана в теме по шагам,
 * и тот же модуль `widgets/mini-patch/model/run.ts`, которым её гоняет демо. Сверка идёт
 * с `createRenderer` из `@vue/runtime-core` 3.5.42 — это настоящий рендерер Vue, только
 * поставленный на наш хост: `createLogHost` отдаёт те же имена операций, что `runtime-dom`.
 * Хост у обеих сторон **один и тот же код**, поэтому сравниваются журналы операций —
 * вплоть до порядка `insert`/`move`/`remove` и их якорей.
 *
 * ⚠️ **Обе сборки — и выбрать их можно только подменой разрешения имён.** Vitest разрешает
 * `@vue/*` с условием `development`, и `NODE_ENV` на выбор файла не влияет (см. шапку
 * `tests/unit/vue-internals.test.ts`). Поэтому `runtime-core`, `reactivity` и `shared`
 * подгружаются из заказанных `dist/` явно, и отдельная проверка удостоверяется, что в кеше
 * `require` лежит именно заказанная сборка. Реактивность компонентов мини-версии берётся
 * из **той же** сборки: мини-рендерер свой, реактивность — настоящая.
 *
 * Как устроены проверки:
 *   - журналы мини-версии и Vue сравниваются целиком, а ожидание для примеров из текста
 *     записано литералом (`*_LOG` в `data.ts`) — закреплено не только «совпадают», но и «что»;
 *   - «без этой строки сломается» — сломанные варианты: подмена одной строки `MINI_PATCH_CODE`;
 *     подменяемый текст сначала ищется, иначе подмена ушла бы в никуда;
 *   - намеренные отличия от Vue — отдельный блок, с объяснением у каждой проверки.
 */

const require = createRequire(import.meta.url);

type Build = 'production' | 'development';

type VueRuntime = RendererApi & {
  reactive: <T extends object>(t: T) => T;
  effect: (...args: never[]) => unknown;
  shallowReactive: <T extends object>(t: T) => T;
  Fragment: symbol;
};

function loadVue(build: Build): { vue: VueRuntime; files: string[] } {
  const resolver = Module as unknown as { _resolveFilename: (request: string, ...rest: unknown[]) => string };
  const original = resolver._resolveFilename;
  const suffix = build === 'production' ? '.prod' : '';
  for (const key of Object.keys(require.cache)) if (key.includes('/node_modules/@vue/')) delete require.cache[key];
  resolver._resolveFilename = function (request, ...rest) {
    const pkg = /^@vue\/(runtime-core|reactivity|shared)$/.exec(request)?.[1];
    if (pkg) return original.call(this, `@vue/${pkg}/dist/${pkg}.cjs${suffix}.js`, ...rest);
    return original.call(this, request, ...rest);
  };
  try {
    const vue = require('@vue/runtime-core') as VueRuntime;
    const files = Object.keys(require.cache).filter((key) => key.includes('/node_modules/@vue/'));
    return { vue, files };
  } finally {
    resolver._resolveFilename = original;
  }
}

const VUE: Record<Build, ReturnType<typeof loadVue>> = {
  production: loadVue('production'),
  development: loadVue('development'),
};
const BUILDS: Build[] = ['production', 'development'];

/** Мини-рендерер на реактивности заказанной сборки. Каждый раз свежий: своя очередь, свои блоки. */
const mini = (build: Build = 'production'): MiniPatch => loadMiniPatch(MINI_PATCH_CODE, VUE[build].vue);

/** Настоящий Vue на нашем хосте: `createLogHost` берётся из той же строки. */
const vueOn = (build: Build) => ({ ...VUE[build].vue, createLogHost: mini(build).createLogHost });

type Impl = RendererApi & Pick<MiniPatch, 'createLogHost'> & { reactive: VueRuntime['reactive'] };

/** Реализации под сверку. */
const IMPLS: [string, () => Impl][] = BUILDS.flatMap((build) => [
  [`мини-версия · реактивность ${build}`, () => ({ ...mini(build), reactive: VUE[build].vue.reactive })],
  [`Vue ${build}`, () => vueOn(build)],
] as [string, () => Impl][]);

const API_NAMES = ['createRenderer', 'createLogHost', 'h', 'createVNode', 'openBlock', 'createBlock', 'nextTick', 'reactive'] as const;

/** Исполнить пример из текста как напечатан: с публичными именами реализации и `log`. */
async function exec(impl: Impl, code: string): Promise<string> {
  const out: string[] = [];
  const log = (...args: unknown[]) => out.push(args.map(String).join(' '));
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as FunctionConstructor;
  await new AsyncFunction(...API_NAMES, 'log', code)(...API_NAMES.map((n) => impl[n]), log);
  return out.join('\n');
}

/** Журнал обновления `from → to` без окна `trace` — так, как его видит любой рендерер. */
function journal(impl: RendererApi & Pick<MiniPatch, 'createLogHost'>, from: string[], to: string[]) {
  const host = impl.createLogHost();
  const { render } = impl.createRenderer(host.nodeOps);
  render(keyedList(impl, from), host.root);
  const mountLog = host.log.map((e) => e.text);
  host.log.length = 0;
  render(keyedList(impl, to), host.root);
  return { mountLog, log: host.log.map((e) => e.text), html: host.html() };
}

const htmlOf = (keys: string[]) => `<ul>${keys.map((k) => `<li>${k}</li>`).join('')}</ul>`;

/** Сломанный вариант мини-версии: подмена по одной строке, и подменяемый текст обязан существовать. */
function broken(...pairs: [find: string, replace: string][]): MiniPatch {
  let code = MINI_PATCH_CODE;
  for (const [find, replace] of pairs) {
    expect(code.includes(find), `в MINI_PATCH_CODE нет строки «${find}» — текст шага переписан`).toBe(true);
    code = code.replace(find, replace);
  }
  return loadMiniPatch(code, VUE.production.vue);
}

/** Детерминированный генератор: случайные пары воспроизводятся от прогона к прогону. */
function lcg(seed: number) {
  let s = seed;
  return () => ((s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff);
}

function randomPairs(count: number, seed: number): [string[], string[]][] {
  const rnd = lcg(seed);
  const pool = 'ABCDEFGHIJKLMNOP'.split('');
  const pairs: [string[], string[]][] = [];
  for (let t = 0; t < count; t++) {
    const from = pool.filter(() => rnd() < 0.6);
    const to = pool.filter(() => rnd() < 0.6);
    for (let i = to.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [to[i], to[j]] = [to[j], to[i]];
    }
    pairs.push([from, to]);
  }
  return pairs;
}

describe('сборки Vue загружены те, что заказаны', () => {
  it('production — все три пакета из *.cjs.prod.js', () => {
    expect(VUE.production.files.map((f) => f.split('/dist/')[1]).sort()).toEqual([
      'reactivity.cjs.prod.js',
      'runtime-core.cjs.prod.js',
      'shared.cjs.prod.js',
    ]);
  });
  it('development — все три пакета из *.cjs.js', () => {
    expect(VUE.development.files.map((f) => f.split('/dist/')[1]).sort()).toEqual([
      'reactivity.cjs.js',
      'runtime-core.cjs.js',
      'shared.cjs.js',
    ]);
  });
  it('это действительно разные экземпляры', () => {
    expect(VUE.production.vue.createRenderer).not.toBe(VUE.development.vue.createRenderer);
  });
});

// ---------------------------------------------------------------------------
// Дети с ключами: сценарии демо и случайные пары
// ---------------------------------------------------------------------------

describe('списки с ключами: журнал мини-версии совпадает с Vue', () => {
  const fixed = PATCH_SCENARIOS.filter((s) => !s.shuffle);

  it('сценариев шесть, перетасовка — последняя', () => {
    expect(PATCH_SCENARIOS.map((s) => s.id)).toEqual(['mixed', 'move', 'insert', 'remove', 'reverse', 'shuffle']);
  });

  describe.each(fixed.map((s) => [s.id, s] as const))('%s', (_id, scenario) => {
    it.each(BUILDS)('против Vue %s — журнал монтирования и обновления', (build) => {
      const m = journal(mini(build), scenario.from, scenario.to);
      const v = journal(vueOn(build), scenario.from, scenario.to);
      expect(m).toEqual(v);
      expect(m.html).toBe(htmlOf(scenario.to));
    });
  });

  it.each(BUILDS)('перетасовка, номера 1…30 — против Vue %s', (build) => {
    const from = PATCH_SCENARIOS.find((s) => s.shuffle)!.from;
    for (let seed = 1; seed <= 30; seed++) {
      const to = shuffleKeys(from, seed);
      expect(journal(mini(build), from, to)).toEqual(journal(vueOn(build), from, to));
    }
  });

  it('перетасовка детерминирована и действительно перемешивает', () => {
    const from = PATCH_SCENARIOS.find((s) => s.shuffle)!.from;
    expect(shuffleKeys(from, 7)).toEqual(shuffleKeys(from, 7));
    expect([...shuffleKeys(from, 7)].sort()).toEqual(from);
    const distinct = new Set(Array.from({ length: 10 }, (_, i) => shuffleKeys(from, i + 1).join('')));
    expect(distinct.size).toBeGreaterThan(5);
  });

  it.each(BUILDS)('400 случайных пар со вставками и удалениями — против Vue %s', (build) => {
    const m = mini(build);
    const v = vueOn(build);
    for (const [from, to] of randomPairs(400, 42)) {
      const got = journal(m, from, to);
      expect(got, `${from.join('')} → ${to.join('')}`).toEqual(journal(v, from, to));
      expect(got.html).toBe(htmlOf(to));
    }
  });

  it('число move у Vue = сохранённые узлы середины − длина LIS (из трассы мини-версии)', () => {
    const m = mini();
    const v = vueOn('production');
    for (const [from, to] of randomPairs(200, 7)) {
      const run = runKeyed(m, from, to);
      const lis = run.steps.find((s) => s.phase === 'lis');
      const vueMoves = journal(v, from, to).log.filter((l) => l.startsWith('move ')).length;
      expect(run.moves).toBe(vueMoves);
      if (!lis?.map || !lis.seq) {
        expect(vueMoves).toBe(0);
        continue;
      }
      const survivors = lis.map.filter((x) => x !== 0).length;
      // lis.seq в кадре уже без нуля на позиции 0 — только настоящие узлы цепочки
      // пустая цепочка — порядок не нарушался, LIS не считался, двигать некого
      expect(vueMoves).toBe(lis.seq.length ? survivors - lis.seq.length : 0);
    }
  });

  it('окно trace не меняет поведения: журнал демо равен журналу без окна', () => {
    for (const [from, to] of randomPairs(100, 3)) {
      expect(runKeyed(mini(), from, to).log).toEqual(journal(mini(), from, to).log);
    }
  });
});

describe('getSequence: наибольшая возрастающая подпоследовательность', () => {
  /** Переборная LIS за O(n²) — независимая от проверяемой. Нули не участвуют. */
  function bruteLength(arr: number[]): number {
    const best = arr.map(() => 0);
    let max = 0;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] === 0) continue;
      best[i] = 1;
      for (let j = 0; j < i; j++) if (arr[j] !== 0 && arr[j] < arr[i]) best[i] = Math.max(best[i], best[j] + 1);
      max = Math.max(max, best[i]);
    }
    return max;
  }

  it('на 2000 случайных перестановках с нулями: длина — наибольшая, индексы возрастают', () => {
    const { getSequence } = mini();
    const rnd = lcg(11);
    for (let t = 0; t < 2000; t++) {
      const n = 1 + Math.floor(rnd() * 14);
      const values = Array.from({ length: n }, (_, i) => i + 1).sort(() => rnd() - 0.5);
      const arr = values.map((v) => (rnd() < 0.2 ? 0 : v));
      if (arr.every((v) => v === 0)) continue;
      const seq = getSequence(arr);
      // причуда Vue: result стартует с [0], и нуль на позиции 0 остаётся в цепочке (см. LIS_NOTE)
      const chain = seq.filter((i) => arr[i] !== 0);
      expect(seq.length - chain.length).toBe(arr[0] === 0 && seq[0] === 0 ? 1 : 0);
      expect(chain.length).toBe(bruteLength(arr));
      for (let i = 1; i < seq.length; i++) expect(seq[i]).toBeGreaterThan(seq[i - 1]);
      for (let i = 1; i < chain.length; i++) expect(arr[chain[i]]).toBeGreaterThan(arr[chain[i - 1]]);
    }
  });

  it('пример из разбора: [5, 3, 4, 0] → позиции 1 и 2', () => {
    expect(mini().getSequence([5, 3, 4, 0])).toEqual([1, 2]);
  });

  it('нуль на позиции 0 остаётся в цепочке — и это не меняет журнал (сверка с Vue выше)', () => {
    expect(mini().getSequence([0, 3, 1, 2])).toEqual([0, 2, 3]);
  });
});

describe('таблица перемещений MOVES_ROWS пересчитывается', () => {
  it.each(MOVES_ROWS.map((row) => [row[0], row] as const))('%s', (_label, row) => {
    const [from, to] = /`(\w+) → (\w+)`/.exec(row[0])!.slice(1).map((s) => [...s]);
    const run = runKeyed(mini(), from, to);
    const vueMoves = journal(vueOn('production'), from, to).log.filter((l) => l.startsWith('move ')).length;
    expect([String(vueMoves), String(run.movesWithoutLis), String(reactRuleMoves(from, to))]).toEqual(row.slice(1));
    expect(run.moves).toBe(vueMoves);
  });

  it('правило React — на примере из «React изнутри»: [a, b, c] → [c, a, b] — два перемещения', () => {
    expect(reactRuleMoves(['a', 'b', 'c'], ['c', 'a', 'b'])).toBe(2);
  });
});

describe('разбор канонического примера KEYED_WALK — это трасса алгоритма', () => {
  const run = runKeyed(mini(), [...'ABCDEFG'], [...'ABECDHFG']);
  const lis = run.steps.find((s) => s.phase === 'lis')!;

  it('newIndexToOldIndex = [5, 3, 4, 0], LIS — C и D', () => {
    expect(lis.map).toEqual([5, 3, 4, 0]);
    expect(lis.seq!.map((p) => 'ABECDHFG'[lis.s + p])).toEqual(['C', 'D']);
    expect(KEYED_WALK).toContain('newIndexToOldIndex = [5, 3, 4, 0]');
    expect(KEYED_WALK).toContain('i = 2');
    expect(KEYED_WALK).toContain('e1 = 4, e2 = 5');
  });

  it('указатели после краёв: i = 2, e1 = 4, e2 = 5', () => {
    const lastTail = run.steps.filter((s) => s.phase === 'tail').at(-1)!;
    expect([lastTail.i, lastTail.e1, lastTail.e2]).toEqual([2, 4, 5]);
  });

  it.each(BUILDS)('KEYED_LOG дословно — мини-версия и Vue %s', (build) => {
    expect(journal(mini(build), [...'ABCDEFG'], [...'ABECDHFG']).log.join('\n')).toBe(KEYED_LOG);
    expect(journal(vueOn(build), [...'ABCDEFG'], [...'ABECDHFG']).log.join('\n')).toBe(KEYED_LOG);
  });
});

// ---------------------------------------------------------------------------
// Примеры из текста — как напечатаны
// ---------------------------------------------------------------------------

describe('примеры из текста исполняются как напечатаны', () => {
  const CASES: [string, string, string][] = [
    ['VNODE_CODE', VNODE_CODE, VNODE_LOG],
    ['MOUNT_CODE', MOUNT_CODE, MOUNT_LOG],
    ['UNKEYED_CODE', UNKEYED_CODE, UNKEYED_LOG],
    ['FLAGS_CODE', FLAGS_CODE, FLAGS_LOG],
    ['BLOCK_CODE', BLOCK_CODE, BLOCK_LOG],
    ['COMPONENT_CODE', COMPONENT_CODE, COMPONENT_LOG],
  ];

  describe.each(CASES)('%s', (_name, code, want) => {
    it.each(IMPLS)('%s', async (_impl, make) => {
      expect(await exec(make(), code)).toBe(want);
    });
  });

  it.each(IMPLS)('без флагов и без ключей h идёт тем же путём, что UNKEYED_FRAGMENT · %s', async (_impl, make) => {
    const viaH = UNKEYED_CODE.replace(
      "createVNode('ul', null, keys.map((k) => h('li', null, k)), 256 /* UNKEYED_FRAGMENT */)",
      "h('ul', null, keys.map((k) => h('li', null, k)))",
    );
    expect(viaH).not.toBe(UNKEYED_CODE);
    expect(await exec(make(), viaH)).toBe(UNKEYED_LOG);
  });
});

// ---------------------------------------------------------------------------
// Флаги, компилятор, фрагменты, слоты — то, что проверяется только на Vue
// ---------------------------------------------------------------------------

describe('компилятор шаблонов 3.5.42', () => {
  const { compile } = require('@vue/compiler-dom') as {
    compile: (t: string, o: object) => { code: string };
  };
  const compiled = (t: string) => compile(t, { hoistStatic: true, mode: 'module' }).code;

  it('COMPILED_SAMPLE — дословный хвост вывода на TEMPLATE_SAMPLE', () => {
    expect(compiled(TEMPLATE_SAMPLE).endsWith(COMPILED_SAMPLE)).toBe(true);
  });

  it('статика кешируется в _cache с CACHED, а не выносится константой', () => {
    const code = compiled(TEMPLATE_SAMPLE);
    expect(code).toContain('_cache[0] || (_cache[0] = _createElementVNode("p"');
    expect(code).toContain('-1 /* CACHED */');
    expect(code).not.toMatch(/const _hoisted_\d+ = _createElementVNode/);
  });

  it('значения флагов в выводе совпадают с PatchFlags мини-версии', () => {
    const { PatchFlags } = mini();
    for (const [name, value] of Object.entries(PatchFlags)) {
      if (['STYLE', 'FULL_PROPS', 'UNKEYED_FRAGMENT'].includes(name)) continue; // в примере их нет
      expect(compiled(TEMPLATE_SAMPLE)).toContain(`${value} /* ${name} */`);
    }
  });

  it('порог сворачивания статики из STATIC_NOTE: 9 <p> — нет, 10 — да; с атрибутом 4 — нет, 5 — да', () => {
    const t = (s: string) => compiled(`<div>${s}<p>{{ x }}</p></div>`).includes('_createStaticVNode');
    expect(t('<p>a</p>'.repeat(9))).toBe(false);
    expect(t('<p>a</p>'.repeat(10))).toBe(true);
    expect(t('<p class="c">a</p>'.repeat(4))).toBe(false);
    expect(t('<p class="c">a</p>'.repeat(5))).toBe(true);
    expect(STATIC_NOTE).toContain('девять');
    expect(STATIC_NOTE).toContain('четыре');
  });
});

describe('снятие поддерева — одна операция хоста (UNMOUNT_NOTE)', () => {
  it.each(IMPLS)('ul с тремя li заменён на p · %s', (_name, make) => {
    const impl = make();
    const host = impl.createLogHost();
    const { render } = impl.createRenderer(host.nodeOps);
    render(impl.h('div', null, [keyedList(impl, ['A', 'B', 'C'])]), host.root);
    host.log.length = 0;
    render(impl.h('div', null, [impl.h('p', null, 'пусто')]), host.root);
    expect(host.log.map((e) => e.text)).toEqual([
      'remove ul',
      'createElement p',
      'setElementText p ← "пусто"',
      'insert p(пусто) → div, в конец',
    ]);
  });
});

describe('флаги патча: Vue верит флагу и не смотрит остальное', () => {
  it.each(IMPLS)('TEXT вне блока: текст дважды, пропсы — ни разу (FLAG_OUTSIDE_NOTE) · %s', (_name, make) => {
    const impl = make();
    const host = impl.createLogHost();
    const { render } = impl.createRenderer(host.nodeOps);
    render(impl.createVNode('p', { id: 'a', class: 'x', title: 't1' }, 'раз', 1), host.root);
    host.log.length = 0;
    render(impl.createVNode('p', { id: 'b', class: 'y', title: 't2' }, 'два', 1), host.root);
    expect(host.log.map((e) => e.text)).toEqual(['setElementText p(раз) ← "два"', 'setElementText p(два) ← "два"']);
  });

  it.each(IMPLS)('TEXT внутри блока: одна запись текста, пропсы — ни разу · %s', (_name, make) => {
    const impl = make();
    const host = impl.createLogHost();
    const { render } = impl.createRenderer(host.nodeOps);
    const view = (id: string, text: string) => (
      impl.openBlock(), impl.createBlock('div', null, [impl.createVNode('p', { id, title: id }, text, 1)])
    );
    render(view('a', 'раз'), host.root);
    host.log.length = 0;
    render(view('b', 'два'), host.root);
    expect(host.log.map((e) => e.text)).toEqual(['setElementText p(раз) ← "два"']);
  });

  it.each(IMPLS)('CLASS: только класс; PROPS: только названные · %s', (_name, make) => {
    const impl = make();
    const host = impl.createLogHost();
    const { render } = impl.createRenderer(host.nodeOps);
    render(impl.createVNode('a', { class: 'x', href: '/1', title: 't1' }, 'y', 2 | 8, ['href']), host.root);
    host.log.length = 0;
    render(impl.createVNode('a', { class: 'z', href: '/2', title: 't2' }, 'y', 2 | 8, ['href']), host.root);
    expect(host.log.map((e) => e.text)).toEqual([
      'patchProp a(y) class: null → "z"',
      'patchProp a(y) href: "/1" → "/2"',
    ]);
  });

  it.each(IMPLS)('без флагов: полное сравнение — сперва удалённые, потом изменённые · %s', (_name, make) => {
    const impl = make();
    const host = impl.createLogHost();
    const { render } = impl.createRenderer(host.nodeOps);
    render(impl.h('a', { class: 'x', href: '/1', title: 't' }, 'y'), host.root);
    host.log.length = 0;
    render(impl.h('a', { href: '/2', rel: 'r' }, 'y'), host.root);
    expect(host.log.map((e) => e.text)).toEqual([
      'patchProp a(y) class: "x" → null',
      'patchProp a(y) title: "t" → null',
      'patchProp a(y) href: "/1" → "/2"',
      'patchProp a(y) rel: undefined → "r"',
    ]);
  });

  it.each(IMPLS)('тот же объект VNode — ноль операций, что бы в нём ни поменяли · %s', (_name, make) => {
    const impl = make();
    const host = impl.createLogHost();
    const { render } = impl.createRenderer(host.nodeOps);
    const cached = impl.createVNode('p', { class: 'c' }, 'статика', -1);
    render(impl.h('div', null, [cached, impl.h('b', null, 'раз')]), host.root);
    host.log.length = 0;
    (cached.props as Record<string, unknown>).class = 'другой';
    render(impl.h('div', null, [cached, impl.h('b', null, 'два')]), host.root);
    expect(host.log.map((e) => e.text)).toEqual(['setElementText b(раз) ← "два"']);
  });
});

describe('фрагмент v-for и слоты — только Vue', () => {
  it.each(BUILDS)('KEYED_FRAGMENT: два пустых текстовых якоря, дети — перед правым · Vue %s', (build) => {
    const vue = vueOn(build);
    const host = vue.createLogHost();
    const { render } = vue.createRenderer(host.nodeOps);
    const view = (keys: string[]) =>
      vue.h('ul', null, [vue.createVNode(vue.Fragment, null, keys.map((k) => vue.h('li', { key: k }, k)), 128)]);
    render(view(['A', 'B']), host.root);
    expect(host.log.map((e) => e.text).slice(1, 8)).toEqual([
      'createText ""',
      'createText ""',
      'insert "" → ul, в конец',
      'insert "" → ul, в конец',
      'createElement li',
      'setElementText li ← "A"',
      'insert li(A) → ul, перед ""',
    ]);
    host.log.length = 0;
    render(view(['B', 'A', 'C']), host.root);
    expect(host.log.map((e) => e.text)).toContain('insert li(C) → ul, перед ""');
  });

  it.each(BUILDS)('данные родителя, прочитанные только в слоте, будят ребёнка, а не родителя · Vue %s', async (build) => {
    const vue = vueOn(build);
    const host = vue.createLogHost();
    const { render } = vue.createRenderer(host.nodeOps);
    const state = vue.reactive({ x: 1 });
    let parent = 0;
    let child = 0;
    const Child = { setup: (_p: unknown, ctx: { slots: { default: () => unknown } }) => () => (child++, vue.h('div', null, ctx.slots.default() as never)) };
    const Parent = { setup: () => () => (parent++, vue.h(Child, null, { default: () => vue.h('i', null, String(state.x)) })) };
    render(vue.h(Parent), host.root);
    state.x++;
    await vue.nextTick();
    expect([parent, child]).toEqual([1, 2]);
    expect(host.html()).toBe('<div><i>2</i></div>');
  });
});

// ---------------------------------------------------------------------------
// Тонкие места
// ---------------------------------------------------------------------------

describe('тонкие места', () => {
  it.each(BUILDS)('01 дубликат ключа: призрак в хосте у обоих · Vue %s', (build) => {
    const from = ['A', 'A', 'B'];
    const to = ['B', 'A', 'A'];
    const m = journal(mini(build), from, to);
    const v = journal(vueOn(build), from, to);
    expect(m).toEqual(v);
    expect(v.html).toBe('<ul><li>A</li><li>B</li><li>A</li><li>A</li></ul>');
  });

  it('01 предупреждение о дубликате — только в отладочной сборке', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      journal(vueOn('production'), ['A', 'A', 'B'], ['B', 'A', 'A']);
      expect(warn).not.toHaveBeenCalled();
      journal(vueOn('development'), ['A', 'A', 'B'], ['B', 'A', 'A']);
      expect(warn.mock.calls.map((c) => String(c[0])).join()).toContain('Duplicate keys');
    } finally {
      warn.mockRestore();
    }
  });

  it('02 и 03: см. примеры UNKEYED_CODE и FLAGS_CODE выше — они исполняются на обоих рендерерах', () => {
    expect(UNKEYED_LOG).toContain('первый узел хоста тот же: true');
    expect(FLAGS_LOG).toContain('class в хосте: old');
  });

  it('04 без `patchFlag > 0` узел CACHED с текстом уходит в сверку списков', () => {
    const run = (m: MiniPatch) => {
      const host = m.createLogHost();
      const { render } = m.createRenderer(host.nodeOps);
      render(m.createVNode('p', null, 'раз', -1), host.root);
      host.log.length = 0;
      render(m.createVNode('p', null, 'два', -1), host.root);
      return host.html();
    };
    expect(-1 & 128).toBe(128);
    expect(run(mini())).toBe('<p>два</p>');
    const bad = broken(['if (patchFlag > 0) {                    // > 0 обязательно', 'if (true) {  //']);
    expect(run(bad)).toBe('<p>раз</p>'); // молча: ни исключения, ни нового текста
  });

  it('05 разворот: LIS длиной 1, перемещений столько же, сколько по правилу React', () => {
    const run = runKeyed(mini(), [...'ABCDEF'], [...'FEDCBA']);
    expect(run.steps.find((s) => s.phase === 'lis')!.seq).toHaveLength(1);
    expect(run.moves).toBe(5);
    expect(reactRuleMoves([...'ABCDEF'], [...'FEDCBA'])).toBe(5);
  });

  it('06 обход слева направо: итоговый порядок в хосте неверен', () => {
    const bad = broken(['for (let k = toBePatched - 1; k >= 0; k--) {', 'for (let k = 0; k < toBePatched; k++) {']);
    const wrong = PATCH_SCENARIOS.filter((s) => !s.shuffle).filter(
      (s) => journal(bad, s.from, s.to).html !== htmlOf(s.to),
    );
    expect(wrong.map((s) => s.id).length).toBeGreaterThan(0);
  });
});

describe('сломанные варианты: без LIS порядок верный, но перемещений больше', () => {
  it('«двигать всех, кто не новый» — 3 перемещения вместо 1 на смешанном сценарии', () => {
    const bad = broken(['if (j < 0 || k !== seq[j]) {', 'if (true) {']);
    const r = journal(bad, [...'ABCDEFG'], [...'ABECDHFG']);
    expect(r.html).toBe(htmlOf([...'ABECDHFG']));
    expect(r.log.filter((l) => l.startsWith('move ')).length).toBe(3);
    expect(runKeyed(mini(), [...'ABCDEFG'], [...'ABECDHFG']).movesWithoutLis).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Намеренные отличия
// ---------------------------------------------------------------------------

describe('намеренные отличия мини-версии от Vue — закреплены явно', () => {
  /**
   * Узел без ключа в середине списка. Vue ищет ему пару перебором по типу, мини-версия
   * ищет только по `Map` ключей — и снимает узел, чтобы смонтировать такой же заново.
   * Итоговое дерево одинаковое, журнал — нет. Строка `REAL_ROWS[0]`.
   */
  it.each(BUILDS)('[p, A, b] → [b, A, p] без ключей у p и b · Vue %s', (build) => {
    const run = (impl: RendererApi & Pick<MiniPatch, 'createLogHost'>) => {
      const host = impl.createLogHost();
      const { render } = impl.createRenderer(host.nodeOps);
      const list = (order: string[]) =>
        impl.h('div', null, order.map((t) => (t === 'A' ? impl.h('li', { key: 'A' }, 'A') : impl.h(t, null, t))));
      render(list(['p', 'A', 'b']), host.root);
      host.log.length = 0;
      render(list(['b', 'A', 'p']), host.root);
      return { log: host.log.map((e) => e.text), html: host.html() };
    };
    const m = run(mini(build));
    const v = run(vueOn(build));
    expect(m.html).toBe(v.html);
    expect(m.log).not.toEqual(v.log);
    expect(v.log.some((l) => l.startsWith('createElement'))).toBe(false);
    expect(m.log.filter((l) => l.startsWith('createElement'))).toEqual(['createElement p', 'createElement b']);
  });
});

describe('демо: кадры собраны из трассы, а не придуманы', () => {
  it('последний кадр — порядок хоста равен новому списку, счётчик — журналу', () => {
    for (const s of PATCH_SCENARIOS.filter((x) => !x.shuffle)) {
      const run = runKeyed(mini(), s.from, s.to);
      const last = run.steps.at(-1)!;
      expect(last.phase).toBe('done');
      expect(last.order).toEqual(s.to);
      expect(last.moves).toBe(run.log.filter((l) => l.startsWith('move ')).length);
      const ops = run.steps.flatMap((st) => st.ops.map((o) => o.text));
      expect(ops).toEqual(run.log);
    }
  });

  it('фазы трассы — только объявленные в типе', () => {
    const phases = new Set<TraceEvent['phase'] | 'start' | 'done'>();
    for (const s of PATCH_SCENARIOS.filter((x) => !x.shuffle)) for (const st of runKeyed(mini(), s.from, s.to).steps) phases.add(st.phase);
    expect([...phases].sort()).toEqual(['done', 'head', 'lis', 'match', 'mount', 'move', 'start', 'stay', 'tail', 'unmount'].sort());
  });
});
