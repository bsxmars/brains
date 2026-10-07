import Module, { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { MINI_VUE_CODE } from '@/content/frameworks/vue-internals/data';
import {
  CHAIN,
  CLEANUP_ORDER_CODE,
  CLEANUP_ORDER_OUT,
  DEEP_CODE,
  DEEP_OUT,
  DIRTY_ONLY_PATCH,
  FLUSH_CODE,
  FLUSH_OUT,
  LEAK_CODE,
  LEAK_OUT,
  MINI_WATCH_CODE,
  ONCE_CODE,
  ONCE_OUT,
  PAUSE_CODE,
  PAUSE_OUT,
  RACE_CODE,
  RACE_NAIVE_CODE,
  RACE_STEPS,
  SCOPE_CODE,
  SCOPE_COMPUTED_CODE,
  SCOPE_COMPUTED_OUT,
  SCOPE_NODE_CODE,
  SCOPE_OUT,
  SOURCES_CODE,
  SOURCES_OUT,
} from '@/content/frameworks/vue-watch-internals/data';
import { API_NAMES, apiArgs, ChainLab, loadMiniWatch, patchCode, runRace, ScopeLab } from '@/widgets/mini-watch';
import type { MiniRef, MiniWatch, WatchApi } from '@/widgets/mini-watch';

/**
 * «Vue 3 изнутри: watch, effectScope и computed 3.5»: мини-реализация против настоящего Vue.
 *
 * Все проверки исполняют **ту же строку** `MINI_WATCH_CODE`, что напечатана в теме по шагам,
 * и те же модули `widgets/mini-watch/model/*.ts`, которыми её гоняют демо. Сверка — с
 * `@vue/runtime-core` 3.5.42: он реэкспортирует `@vue/reactivity`, и `watch` с `flush`
 * берётся оттуда же, откуда эффекты.
 *
 * ⚠️ **Обе сборки — подменой разрешения имён, а не `NODE_ENV`.** Vitest разрешает `@vue/*`
 * с условием `development`, и `require` отдаёт отладочную сборку при любом `NODE_ENV`. Приём
 * и его обоснование — в `tests/unit/vue-internals.test.ts`; здесь он повторён, а отдельная
 * проверка удостоверяется, что в кеше `require` лежит именно заказанная сборка.
 *
 * Как устроены проверки:
 *   - примеры из текста исполняются как напечатаны на трёх реализациях, вывод сверяется
 *     с литералом `*_OUT` из `data.ts` — то есть закреплено не только «совпадают», но и «что»;
 *   - модели демо (гонка, дерево областей, цепочка) исполняются против мини-версии и Vue
 *     одним и тем же кодом;
 *   - «без этой строки сломается» — сломанные варианты через `patchCode`, который падает,
 *     если подменяемого текста нет;
 *   - намеренные отличия — отдельный блок.
 */

const require = createRequire(import.meta.url);

type Build = 'production' | 'development';

function loadVue(build: Build): { api: WatchApi; files: string[] } {
  const resolver = Module as unknown as { _resolveFilename: (request: string, ...rest: unknown[]) => string };
  const original = resolver._resolveFilename;
  const suffix = build === 'production' ? '.prod' : '';
  const purge = () => {
    for (const key of Object.keys(require.cache)) if (key.includes('/node_modules/@vue/')) delete require.cache[key];
  };

  purge();
  resolver._resolveFilename = function (request, ...rest) {
    const pkg = /^@vue\/(runtime-core|reactivity|shared)$/.exec(request)?.[1];
    if (pkg) return original.call(this, `@vue/${pkg}/dist/${pkg}.cjs${suffix}.js`, ...rest);
    return original.call(this, request, ...rest);
  };
  try {
    const api = require('@vue/runtime-core') as WatchApi;
    const files = Object.keys(require.cache).filter((key) => key.includes('/node_modules/@vue/'));
    return { api, files };
  } finally {
    resolver._resolveFilename = original;
  }
}

const VUE: Record<Build, ReturnType<typeof loadVue>> = {
  production: loadVue('production'),
  development: loadVue('development'),
};

const BUILDS: Build[] = ['production', 'development'];

/** Реализации под сверку. Мини-версия каждый раз свежая. */
const IMPLS: [string, () => WatchApi][] = [
  ['мини-версия', () => loadMiniWatch(MINI_WATCH_CODE)],
  ['Vue prod', () => VUE.production.api],
  ['Vue dev', () => VUE.development.api],
];

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
  ...args: string[]
) => (...values: unknown[]) => Promise<unknown>;

/** Исполнить пример из темы как напечатан: публичные имена реализации и `log`. */
async function run(api: WatchApi, code: string): Promise<unknown[]> {
  const out: unknown[] = [];
  const fn = new AsyncFunction(...API_NAMES, 'log', code);
  await fn(...apiArgs(api), (v: unknown) => out.push(v));
  return out;
}

/** Сломанный вариант мини-версии: подмены по строке, каждая обязана найтись. */
const broken = (...pairs: [find: string, replace: string][]): MiniWatch =>
  loadMiniWatch(patchCode(MINI_WATCH_CODE, pairs.map(([find, replace]) => ({ find, replace }))));

/** Vue dev предупреждает о `onWatcherCleanup` вне watcher’а — это ожидаемо, а не шум теста. */
async function quiet<T>(fn: () => Promise<T>): Promise<T> {
  const warn = console.warn;
  console.warn = () => {};
  try {
    return await fn();
  } finally {
    console.warn = warn;
  }
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
  it('это разные экземпляры', () => {
    expect(VUE.production.api.watch).not.toBe(VUE.development.api.watch);
  });
});

// ---------------------------------------------------------------------------
// Примеры из текста: как напечатаны, на трёх реализациях, вывод — литералом из data.ts
// ---------------------------------------------------------------------------

const EXAMPLES: [string, string, unknown[]][] = [
  ['SOURCES_CODE: четыре вида источника', SOURCES_CODE, SOURCES_OUT],
  ['DEEP_CODE: deep и глубина числом', DEEP_CODE, DEEP_OUT],
  ['CLEANUP_ORDER_CODE: очистка перед следующим колбэком и на stop', CLEANUP_ORDER_CODE, CLEANUP_ORDER_OUT],
  ['ONCE_CODE: once зовёт очистку сразу после колбэка', ONCE_CODE, ONCE_OUT],
  ['FLUSH_CODE: sync → pre → post → nextTick', FLUSH_CODE, FLUSH_OUT],
  ['SCOPE_CODE: stop останавливает вложенную, но не отсоединённую', SCOPE_CODE, SCOPE_OUT],
  ['SCOPE_COMPUTED_CODE: computed в области stop не касается', SCOPE_COMPUTED_CODE, SCOPE_COMPUTED_OUT],
  ['LEAK_CODE: эффект вне области переживает stop', LEAK_CODE, LEAK_OUT],
];

describe.each(EXAMPLES)('%s', (_name, code, want) => {
  it.each(IMPLS)('%s', async (_impl, make) => {
    expect(await run(make(), code)).toEqual(want);
  });
});

// ---------------------------------------------------------------------------
// Поведение, о котором говорит текст, но без отдельного примера
// ---------------------------------------------------------------------------

type Case = { name: string; code: string; want: unknown[] };

const CASES: Case[] = [
  {
    name: 'immediate: колбэк сразу, old — undefined; у массива источников — []',
    code: `const s = ref(0)
watch(s, (v, o) => log(o + ' → ' + v), { immediate: true })
watch([s, () => s.value * 2], (v, o) => log(JSON.stringify([v, o])), { immediate: true })
s.value = 1
await nextTick()`,
    want: ['undefined → 0', '[[0,0],[]]', '0 → 1', '[[1,2],[0,0]]'],
  },
  {
    name: 'deep: old и new — один и тот же объект',
    code: `const r = ref({ x: 1 })
watch(r, (v, o) => log(v === o), { deep: true, flush: 'sync' })
r.value.x++`,
    want: [true],
  },
  {
    name: 'геттер, возвращающий тот же объект, без deep молчит',
    code: `const state = reactive({ obj: { x: 1 } })
watch(() => state.obj, () => log('колбэк'), { flush: 'sync' })
state.obj.x++
log('после записи')`,
    want: ['после записи'],
  },
  {
    name: 'reactive-источник: колбэк на каждое изменение, и на новый ключ тоже',
    code: `const state = reactive({ a: 1 })
watch(state, () => log('колбэк'), { flush: 'sync' })
state.a = 1
state.a = 2
state.b = 1`,
    want: ['колбэк', 'колбэк'],
  },
  {
    name: 'onWatcherCleanup регистрирует на текущий watcher; после await — никуда',
    code: `const s = ref(0)
const h = watch(s, async (v) => {
  onWatcherCleanup(() => log('до await ' + v))
  await null
  onWatcherCleanup(() => log('после await ' + v))
})
s.value = 1
await nextTick()
await null
s.value = 2
await nextTick()
await null
h()`,
    want: ['до await 1', 'до await 2'],
  },
  {
    name: 'watchEffect: очистка — перед повтором и на stop; видит уже новое значение',
    code: `const n = ref(0)
const h = watchEffect((onCleanup) => {
  log('прогон ' + n.value)
  onCleanup(() => log('очистка видит ' + n.value))
})
n.value = 1
await nextTick()
h()`,
    want: ['прогон 0', 'очистка видит 1', 'прогон 1', 'очистка видит 1'],
  },
  {
    name: 'stop одного watch в области не трогает соседей; область потом гасит остальных',
    code: `const n = ref(0)
const scope = effectScope()
let first
scope.run(() => {
  first = watch(n, (v) => log('первый ' + v), { flush: 'sync' })
  watch(n, (v) => log('второй ' + v), { flush: 'sync' })
})
first()
n.value = 1
scope.stop()
n.value = 2`,
    want: ['второй 1'],
  },
  {
    name: 'onScopeDispose: порядок — эффекты, очистки, потом дети',
    code: `const scope = effectScope()
scope.run(() => {
  onScopeDispose(() => log('родитель 1'))
  effectScope().run(() => onScopeDispose(() => log('ребёнок')))
  onScopeDispose(() => log('родитель 2'))
})
scope.stop()
scope.stop()`,
    want: ['родитель 1', 'родитель 2', 'ребёнок'],
  },
  {
    name: 'остановленная область run не выполняет',
    code: `const scope = effectScope()
scope.stop()
log(scope.run(() => 'выполнено'))`,
    want: [undefined],
  },
  {
    name: 'пакет: эффект, читающий два computed от одного источника, — один прогон на запись',
    code: `const n = ref(1)
const a = computed(() => n.value + 1)
const b = computed(() => n.value * 2)
effect(() => log(a.value + ' ' + b.value))
n.value = 5`,
    want: ['2 2', '6 10'],
  },
  {
    name: 'computed вне эффекта: пересчёт только при изменённых источниках',
    code: `const n = ref(1)
const other = ref(0)
effect(() => other.value)
let calls = 0
const c = computed(() => (calls++, n.value))
c.value; c.value
other.value++       // globalVersion сдвинулся, но источники c прежние
c.value
log(calls)
n.value = 2
c.value
log(calls)`,
    want: [1, 2],
  },
];

describe.each(CASES)('$name', ({ code, want }) => {
  it.each(IMPLS)('%s', async (_impl, make) => {
    expect(await quiet(() => run(make(), code))).toEqual(want);
  });
});

// ---------------------------------------------------------------------------
// Модели демо: один код, три реализации
// ---------------------------------------------------------------------------

describe('демо «гонка»: кадры одинаковы на мини-версии и на Vue', () => {
  const variants: [string, string][] = [
    ['без очистки', RACE_NAIVE_CODE],
    ['с очисткой', RACE_CODE],
  ];

  describe.each(variants)('%s', (_name, code) => {
    it.each(BUILDS)('против Vue %s', async (build) => {
      const mini = await runRace(loadMiniWatch(MINI_WATCH_CODE), code, RACE_STEPS);
      const vue = await runRace(VUE[build].api, code, RACE_STEPS);
      expect(mini).toEqual(vue);
    });
  });

  it('без очистки на экране остаётся ответ на старый запрос', async () => {
    const frames = await runRace(loadMiniWatch(MINI_WATCH_CODE), RACE_NAIVE_CODE, RACE_STEPS);
    expect(frames.map((f) => f.shown)).toEqual(['—', '—', '—', 'результаты по «кот»', 'результаты по «ко»']);
    expect(frames.at(-1)?.query).toBe('кот');
  });

  it('с очисткой — верный ответ, а старый выброшен', async () => {
    const frames = await runRace(loadMiniWatch(MINI_WATCH_CODE), RACE_CODE, RACE_STEPS);
    expect(frames.map((f) => f.shown)).toEqual(['—', '—', '—', 'результаты по «кот»', 'результаты по «кот»']);
    expect(frames.at(-1)?.log).toEqual(['очистка: запрос «ко» больше не нужен', 'ответ «ко» пришёл — выброшен']);
    expect(frames[2].requests).toEqual([
      { id: 1, query: 'ко', state: 'waiting' },
      { id: 2, query: 'кот', state: 'waiting' },
    ]);
  });
});

describe('демо «дерево областей»: мини-версия и Vue одинаковы', () => {
  /** Корень, вложенная, отсоединённая (обе созданы в run корня), внучка во вложенной. */
  function scenario(api: WatchApi) {
    const lab = new ScopeLab(api, SCOPE_NODE_CODE);
    const root = lab.add(null)!;
    const nested = lab.add(root)!;
    lab.add(root, true);
    lab.add(nested);
    lab.bump();
    lab.stop(root);
    lab.bump();
    const afterStop = lab.add(root);
    return { tree: lab.snapshot(), log: lab.log, afterStop };
  }

  it.each(BUILDS)('против Vue %s', (build) => {
    expect(scenario(loadMiniWatch(MINI_WATCH_CODE))).toEqual(scenario(VUE[build].api));
  });

  it('stop корня гасит вложенные, но не отсоединённую', () => {
    const { tree, afterStop } = scenario(loadMiniWatch(MINI_WATCH_CODE));
    expect(tree.map((n) => [n.name, n.depth, n.detached, n.active, n.runs])).toEqual([
      ['S0', 0, false, false, 2],
      ['S1', 1, false, false, 2],
      ['S3', 2, false, false, 2],
      ['S2', 1, true, true, 3],
    ]);
    expect(afterStop).toBeNull();
  });
});

describe('демо «цепочка computed»: пересчёты и связи', () => {
  /** Сколько раз что выполнилось после установки и после каждого действия. */
  function counts(api: ConstructorParameters<typeof ChainLab>[0]) {
    const lab = new ChainLab(api, CHAIN);
    const out = [{ ...lab.counts }];
    CHAIN.actions.forEach((_, i) => {
      lab.act(i);
      out.push({ ...lab.counts });
    });
    return out;
  }

  const VERSIONED = [
    { parity: 1, label: 1, E: 1 },
    { parity: 2, label: 1, E: 1 },
    { parity: 3, label: 2, E: 2 },
    { parity: 3, label: 2, E: 2 },
  ];

  it('мини-версия: parity пересчитан, label и E не тронуты', () => {
    expect(counts(loadMiniWatch(MINI_WATCH_CODE))).toEqual(VERSIONED);
  });

  it.each(BUILDS)('Vue %s считает столько же', (build) => {
    expect(counts(VUE[build].api)).toEqual(VERSIONED);
  });

  it('мини-версия из «Vue 3 изнутри» тоже: флаг и версии там уже вместе', () => {
    const old = new Function(MINI_VUE_CODE)() as Partial<WatchApi>;
    expect(counts(old)).toEqual(VERSIONED);
  });

  it('«только флаг» пересчитывает всю цепочку и зовёт E зря', () => {
    const dirtyOnly = loadMiniWatch(patchCode(MINI_WATCH_CODE, DIRTY_ONLY_PATCH));
    expect(counts(dirtyOnly)).toEqual([
      { parity: 1, label: 1, E: 1 },
      { parity: 2, label: 2, E: 2 },
      { parity: 3, label: 3, E: 3 },
      { parity: 3, label: 3, E: 3 },
    ]);
  });

  /**
   * Списки `Link` сняты одним кодом с мини-версии и с Vue. Поля у Vue внутренние
   * (`deps`, `nextDep`, `subs`, `prevSub`, `version`, бит `DIRTY` в `flags`) — если проверка
   * упадёт после обновления Vue, начинать с них.
   */
  it.each(BUILDS)('списки Link и версии совпадают с Vue %s после каждого шага', (build) => {
    const mini = new ChainLab(loadMiniWatch(MINI_WATCH_CODE), CHAIN);
    const vue = new ChainLab(VUE[build].api, CHAIN);
    const strip = (lab: ChainLab) => ({ ...lab.snapshot(), globalVersion: null });
    expect(strip(mini)).toEqual(strip(vue));
    CHAIN.actions.forEach((_, i) => {
      mini.act(i);
      vue.act(i);
      expect(strip(mini)).toEqual(strip(vue));
    });
  });

  it('снимок: у E один Link — на label; версии после n += 2', () => {
    const lab = new ChainLab(loadMiniWatch(MINI_WATCH_CODE), CHAIN);
    lab.act(0);
    const snap = lab.snapshot();
    expect(snap.subs).toEqual([
      { name: 'E', kind: 'effect', links: [{ dep: 'label', seen: 1, current: 1 }] },
      { name: 'label', kind: 'computed', version: 1, dirty: false, links: [{ dep: 'parity', seen: 1, current: 1 }], readers: ['E'] },
      { name: 'parity', kind: 'computed', version: 1, dirty: false, links: [{ dep: 'n', seen: 1, current: 1 }], readers: ['label'] },
    ]);
    expect(snap.globalVersion).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// «Без этой строки сломается»: сломанные варианты
// ---------------------------------------------------------------------------

describe('каждое «без этой строки сломается» проверено поломкой', () => {
  it('без cleanup() перед колбэком гонка снова показывает старый ответ', async () => {
    const mini = broken(['    cleanup()                         // очистка прошлого колбэка — ДО нового\n', '']);
    const frames = await runRace(mini, RACE_CODE, RACE_STEPS);
    expect(frames.at(-1)?.shown).toBe('результаты по «ко»');
  });

  it('без выписки в родителя вложенная область переживает stop родителя', async () => {
    const mini = broken(['    activeScope.scopes.push(scope)\n', '']);
    expect(await run(mini, SCOPE_CODE)).toEqual([
      'внешний видит 0',
      'вложенный видит 0',
      'отсоединённый видит 0',
      'dispose: внешняя',
      'вложенный видит 1',
      'отсоединённый видит 1',
      'false, true, true',
    ]);
  });

  it('без forceTrigger watch(reactive) молчит на изменения внутри', async () => {
    const mini = broken(['    forceTrigger = true               // тот же объект', '    void 0                           // тот же объект']);
    const out = await run(mini, SOURCES_CODE);
    expect(out).not.toContain('reactive: что-то внутри');
  });

  it('без проверки глубины в seen deep: 1 проходит дерево целиком', async () => {
    const mini = broken(['(seen.get(value) || 0) >= depth', 'seen.has(value) && false'], ['if (depth <= 0 || !isObject(value))', 'if (!isObject(value))']);
    const out = await run(mini, DEEP_CODE);
    expect(out.slice(0, 3)).toEqual(['— state.a.b.c++', 'геттер + deep', 'deep: 1']);
  });

  it('без записи эффекта в область stop его не останавливает', async () => {
    const mini = broken(['  if (activeScope) activeScope.effects.push(e)', '  void 0']);
    expect(await run(mini, LEAK_CODE)).toEqual(['в области: 0', 'вне области: 0', 'в области: 1', 'вне области: 1']);
  });

  /**
   * Пакет. Без счётчика глубины каждый внутренний `endBatch` запускает эффекты сразу: `E`
   * просыпается от того `computed`, что подписан последним (обход идёт от хвоста), пока второй
   * ещё не помечен, и читает его старый кеш — несогласованная пара `2 10`. Флаг `notified` сам по себе от этого не спасает, а дубль
   * в списке гасит `isDirty`: поэтому поломка — именно в счётчике.
   */
  it('без счётчика глубины эффект видит несогласованную пару', async () => {
    const mini = broken(['  if (--batchDepth > 0) return       // внешняя запись ещё не закончилась', '  --batchDepth']);
    const out = await run(
      mini,
      `const n = ref(1)
const a = computed(() => n.value + 1)
const b = computed(() => n.value * 2)
effect(() => log(a.value + ' ' + b.value))
n.value = 5`,
    );
    expect(out).toEqual(['2 2', '2 10', '6 10']);
  });

  it('без ленивой подписки computed без читателей держит связь в источнике', () => {
    const mini = broken(['    if (sub.tracking) addSub(link)', '    addSub(link)']);
    const n = mini.ref(1);
    const c = mini.computed(() => n.value);
    void c.value;
    expect(n.dep.subs).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Утечки и ленивая подписка: по внутреннему полю, одинаково у мини-версии и Vue
// ---------------------------------------------------------------------------

describe('computed без читателей не держит источник', () => {
  /**
   * `ref.dep.subs` — хвост списка подписчиков. У Vue поле внутреннее (`RefImpl.dep`,
   * `Dep.subs`) и может смениться; если проверка упадёт после обновления, начинать с него.
   */
  it.each(IMPLS)('%s', (_impl, make) => {
    const api = make();
    const n = api.ref(1) as MiniRef<number>;
    const c = api.computed(() => n.value);
    void c.value;
    const idle = Boolean(n.dep.subs);
    const runner = api.effect(() => c.value);
    const read = Boolean(n.dep.subs);
    api.stop(runner);
    expect([idle, read, Boolean(n.dep.subs)]).toEqual([false, true, false]);
  });
});

// ---------------------------------------------------------------------------
// Намеренные отличия и граница проверки
// ---------------------------------------------------------------------------

describe('намеренные отличия мини-версии от Vue', () => {
  /** Мини-версия не удаляет опустевший `Dep` из `targetMap`; Vue удаляет по счётчику `sc`. */
  it('опустевший Dep: у мини-версии остаётся в targetMap', () => {
    const mini = loadMiniWatch(MINI_WATCH_CODE);
    const raw = { a: 1 };
    const s = mini.reactive(raw);
    const runner = mini.effect(() => s.a);
    mini.stop(runner);
    expect(mini.targetMap.get(raw)?.has('a')).toBe(true);
  });

  /** `pause`/`resume` из 3.5 есть только у Vue: пример из темы сверяется с обеими сборками. */
  it.each(BUILDS)('PAUSE_CODE: пауза области на Vue %s — один прогон после resume', async (build) => {
    expect(await run(VUE[build].api, PAUSE_CODE)).toEqual(PAUSE_OUT);
  });

  it('у мини-версии паузы нет — PAUSE_CODE на ней падает', async () => {
    await expect(run(loadMiniWatch(MINI_WATCH_CODE), PAUSE_CODE)).rejects.toThrow(TypeError);
  });

  /** `batchDepth` после записи — ноль: пакет закрыт. Проверяется только у мини-версии: у Vue счётчик не экспортирован. */
  it('batchDepth возвращается к нулю', () => {
    const mini = loadMiniWatch(MINI_WATCH_CODE);
    const s = mini.reactive<Record<string, number>>({});
    mini.effect(() => Object.keys(s));
    s.x = 1;
    expect(mini.getBatchDepth()).toBe(0);
  });
});
