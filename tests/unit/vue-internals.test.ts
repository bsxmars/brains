import Module, { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import {
  BRANCH_CODE,
  COLLECTIONS_CODE,
  COLLECTIONS_LOG,
  MINI_SCENARIOS,
  MINI_VUE_CODE,
  RECEIVER_CODE,
} from '@/content/frameworks/vue-internals/data';
import {
  API_NAMES,
  compileScenario,
  loadMiniVue,
  MiniSession,
} from '@/widgets/mini-reactivity/model/session';
import type { MiniVue, ReactivityApi } from '@/widgets/mini-reactivity/model/types';

/**
 * «Vue 3 изнутри»: мини-реализация против настоящего Vue.
 *
 * Все проверки здесь исполняют **ту же строку** `MINI_VUE_CODE`, что напечатана в теме
 * по шагам, и тот же модуль `widgets/mini-reactivity/model/session.ts`, которым её гоняет
 * демо. Сверка идёт с `@vue/runtime-core` 3.5.42 — он же реэкспортирует `@vue/reactivity`,
 * так что планировщик и реактивность берутся из одного экземпляра.
 *
 * ⚠️ **Обе сборки — и здесь это труднее, чем кажется.** `@vue/*` выбирают сборку двумя путями:
 * `index.js` смотрит на `NODE_ENV`, а поле `exports` пакета — на условия разрешения
 * (`node.production` / `node.development`). Vitest запускает тесты с условием `development`,
 * и оно побеждает: `require('@vue/runtime-core')` отдаёт отладочную сборку **при любом**
 * `NODE_ENV` — проверено, выставленный `production` ничего не меняет. Поэтому сборка
 * выбирается явно, подменой разрешения имён `@vue/*` на нужный файл `dist/`, а отдельная
 * проверка удостоверяется, что в кеше `require` лежит именно заказанная сборка.
 *
 * Как устроены проверки:
 *   - поведенческие случаи — одна функция на случай, исполняемая каждой реализацией; ожидаемый
 *     журнал записан литералом, то есть закреплено не только «совпадают», но и «что именно»;
 *   - «без этой строки сломается» из текста темы — сломанные варианты: тест подменяет одну
 *     строку `MINI_VUE_CODE` и показывает поломку. Подменяемый текст сначала ищется: если его
 *     переписали, упадёт поиск, а не молча пройдёт подмена в никуда;
 *   - намеренные отличия мини-версии от Vue — отдельный блок, с объяснением у каждой проверки.
 */

const require = createRequire(import.meta.url);

type Build = 'production' | 'development';

/**
 * Загрузить Vue заказанной сборки: чистый кеш `require` и подмена разрешения трёх имён
 * (`runtime-core`, `reactivity`, `shared`) на файлы `dist/` нужной сборки — иначе
 * `runtime-core` из продакшен-сборки подтянул бы отладочную `reactivity`.
 */
function loadVue(build: Build): { api: ReactivityApi; files: string[] } {
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
    const api = require('@vue/runtime-core') as ReactivityApi;
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

/** Реализации под сверку. Мини-версия каждый раз свежая: своя таблица, своя очередь. */
const IMPLS: [string, () => ReactivityApi][] = [
  ['мини-версия', () => loadMiniVue(MINI_VUE_CODE)],
  ['Vue prod', () => VUE.production.api],
  ['Vue dev', () => VUE.development.api],
];

/** Исполнить кусок кода с публичными именами реализации и `log`. */
function exec(api: ReactivityApi, code: string, log: (v: unknown) => void): unknown {
  const fn = new Function(...API_NAMES, 'log', code);
  return fn(...API_NAMES.map((name) => api[name]), log);
}

/**
 * Сломанный вариант мини-версии: подмены по одной строке, и каждый подменяемый текст обязан
 * существовать — иначе «поломка» ушла бы в никуда, и проверка доказывала бы несуществующее.
 */
function broken(...pairs: [find: string, replace: string][]): MiniVue {
  let code = MINI_VUE_CODE;
  for (const [find, replace] of pairs) {
    expect(code.includes(find), `в MINI_VUE_CODE нет строки «${find}» — текст шага переписан`).toBe(true);
    code = code.replace(find, replace);
  }
  return loadMiniVue(code);
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
    expect(VUE.production.api.reactive).not.toBe(VUE.development.api.reactive);
  });
});

// ---------------------------------------------------------------------------
// Сценарии демо: один код, три реализации
// ---------------------------------------------------------------------------

/**
 * Журнал сценария так, как его проходит демо: установка, микрозадача, потом каждая кнопка
 * дважды подряд (второе нажатие проверяет «то же значение — тишина»). Граница между
 * синхронной частью и сливом очереди — в журнале отдельной строкой.
 */
async function transcript(api: ReactivityApi, index: number): Promise<string[]> {
  const out: string[] = [];
  const scenario = MINI_SCENARIOS[index];
  const compiled = compileScenario(api, scenario, (text) => out.push(text));
  out.push('— микрозадача');
  await api.nextTick();
  for (let i = 0; i < scenario.actions.length; i++) {
    for (let twice = 0; twice < 2; twice++) {
      out.push(`> ${scenario.actions[i]}`);
      compiled.act(i);
      out.push('— микрозадача');
      await api.nextTick();
    }
  }
  return out;
}

describe('сценарии демо: журнал мини-версии совпадает с Vue', () => {
  it('сценариев четыре, и у каждого есть state', () => {
    expect(MINI_SCENARIOS.map((s) => s.id)).toEqual(['branch', 'chain', 'batch', 'keys']);
    for (const s of MINI_SCENARIOS) expect(s.setup).toMatch(/const state = reactive\(/);
  });

  describe.each(MINI_SCENARIOS.map((s, i) => [s.id, i] as const))('%s', (_id, index) => {
    it.each(['production', 'development'] as Build[])('против Vue %s', async (build) => {
      const mini = await transcript(loadMiniVue(MINI_VUE_CODE), index);
      const vue = await transcript(VUE[build].api, index);
      expect(mini).toEqual(vue);
    });
  });

  /** Сверка «совпадает» ничего не стоит, если обе стороны молчат. Закрепляем и суть. */
  it('ветка if: после show = false запись в a никого не будит', async () => {
    const log = await transcript(loadMiniVue(MINI_VUE_CODE), 0);
    const afterToggle = log.slice(log.indexOf('> state.show = !state.show'));
    expect(log.slice(0, 2)).toEqual(['a = 1', '— микрозадача']);
    // b к этому моменту дважды увеличен кнопкой `state.b++`
    expect(afterToggle.slice(0, 3)).toEqual(['> state.show = !state.show', 'b = 4', '— микрозадача']);
  });

  it('цепочка: price += 10 пересчитывает оба computed, но E молчит', async () => {
    const log = await transcript(loadMiniVue(MINI_VUE_CODE), 1);
    const i = log.indexOf('> state.price += 10');
    expect(log.slice(i, i + 4)).toEqual(['> state.price += 10', 'total пересчитан', 'pricey пересчитан', '— микрозадача']);
  });

  it('три записи: sync трижды сразу, render и post — по разу после', async () => {
    const log = await transcript(loadMiniVue(MINI_VUE_CODE), 2);
    const i = log.indexOf('> state.n++; state.n++; state.n++');
    expect(log.slice(i, i + 7)).toEqual([
      '> state.n++; state.n++; state.n++',
      'n = 1',
      'n = 2',
      'n = 3',
      '— микрозадача',
      'n = 3',
      'n = 3',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Примеры из текста темы — как напечатаны
// ---------------------------------------------------------------------------

describe('примеры из текста исполняются как напечатаны', () => {
  it.each(IMPLS)('RECEIVER_CODE · %s', (_name, make) => {
    const log: unknown[] = [];
    exec(make(), RECEIVER_CODE, (v) => log.push(v));
    expect(log).toEqual(['Ада Лавлейс', 'Августа Лавлейс']);
  });

  it.each(IMPLS)('BRANCH_CODE · %s', (_name, make) => {
    const log: unknown[] = [];
    exec(make(), BRANCH_CODE, (v) => log.push(v));
    expect(log).toEqual([1, 2, 3]);
  });
});

// ---------------------------------------------------------------------------
// Поведение: каждый случай на трёх реализациях, ожидание — литералом
// ---------------------------------------------------------------------------

type Case = { name: string; run: (api: ReactivityApi, log: (v: unknown) => void) => unknown; want: unknown[] };

const CASES: Case[] = [
  {
    name: 'гранулярность: запись в непрочитанный ключ не будит',
    run: (api, log) => {
      const s = api.reactive({ a: 1, b: 1 });
      api.effect(() => log(s.a));
      s.b++;
      s.a++;
    },
    want: [1, 2],
  },
  {
    name: 'запись того же значения не будит',
    run: (api, log) => {
      const s = api.reactive({ a: 1 });
      api.effect(() => log(s.a));
      s.a = 1;
    },
    want: [1],
  },
  {
    name: 'NaN поверх NaN не будит (Object.is)',
    run: (api, log) => {
      const s = api.reactive({ x: NaN });
      api.effect(() => log(s.x));
      s.x = NaN;
      s.x = 0;
    },
    want: [NaN, 0],
  },
  {
    name: 'computed ленив и кеширует: 0 → 1 → 1 → 2 вызова геттера',
    run: (api, log) => {
      const s = api.reactive({ n: 1 });
      let calls = 0;
      const d = api.computed(() => (calls++, s.n * 2));
      log(calls);
      void d.value;
      void d.value;
      log(calls);
      s.n = 5;
      log(calls);
      log(d.value);
      log(calls);
    },
    want: [0, 1, 1, 10, 2],
  },
  {
    name: 'computed с прежним значением не будит читателя',
    run: (api, log) => {
      const s = api.reactive({ n: 1 });
      const positive = api.computed(() => s.n > 0);
      api.effect(() => log(positive.value));
      s.n = 2;
      s.n = 3;
      s.n = -1;
    },
    want: [true, false],
  },
  {
    name: 'глитча нет: эффект видит согласованную пару',
    run: (api, log) => {
      const s = api.reactive({ a: 1 });
      const double = api.computed(() => s.a * 2);
      api.effect(() => log(`${s.a} ${double.value}`));
      s.a = 2;
    },
    want: ['1 2', '2 4'],
  },
  {
    name: 'перебор: add и delete будят, set существующего — нет',
    run: (api, log) => {
      const s = api.reactive<Record<string, number>>({ a: 1 });
      api.effect(() => log(Object.keys(s).join()));
      s.a = 2;
      s.b = 1;
      delete s.a;
    },
    want: ['a', 'a,b', 'b'],
  },
  {
    name: '`in` подписывает на ключ',
    run: (api, log) => {
      const s = api.reactive<Record<string, number>>({});
      api.effect(() => log('z' in s));
      s.z = 1;
    },
    want: [false, true],
  },
  {
    name: 'эффект, пишущий в прочитанное, не зацикливается',
    run: (api, log) => {
      const s = api.reactive({ n: 0 });
      api.effect(() => {
        s.n++;
        log(s.n);
      });
      s.n = 10;
    },
    want: [1, 11],
  },
  {
    name: 'вложенные эффекты: activeEffect возвращается внешнему, внутренние копятся',
    run: (api, log) => {
      const s = api.reactive({ a: 1, b: 1, c: 1 });
      api.effect(() => {
        log('outer');
        void s.a;
        api.effect(() => {
          log('inner');
          void s.b;
        });
        void s.c; // прочитано ПОСЛЕ внутреннего — обязано записаться на внешний
      });
      s.b++;
      s.c++;
      s.b++;
    },
    want: ['outer', 'inner', 'inner', 'outer', 'inner', 'inner', 'inner'],
  },
  {
    name: 'ref глубокий, shallowRef — нет',
    run: (api, log) => {
      const r = api.ref({ x: 1 });
      const sr = api.shallowRef({ x: 1 });
      api.effect(() => log(`r ${r.value.x}`));
      api.effect(() => log(`sr ${sr.value.x}`));
      r.value.x++;
      sr.value.x++;
      sr.value = { x: 9 };
    },
    want: ['r 1', 'sr 1', 'r 2', 'sr 9'],
  },
  {
    name: 'вложенный объект: один и тот же прокси на каждом чтении',
    run: (api, log) => {
      const s = api.reactive({ inner: { x: 1 } });
      log(s.inner === s.inner);
      log(api.toRaw(s.inner) === api.toRaw(s).inner);
    },
    want: [true, true],
  },
  {
    name: 'stop: отписан, но прямой вызов выполняет функцию',
    run: (api, log) => {
      const s = api.reactive({ n: 0 });
      const runner = api.effect(() => log(s.n)) as () => void;
      api.stop(runner as never);
      s.n++;
      runner();
    },
    want: [0, 1],
  },
];

describe.each(CASES)('$name', ({ run, want }) => {
  it.each(IMPLS)('%s', (_name, make) => {
    const log: unknown[] = [];
    run(make(), (v) => log.push(v));
    expect(log).toEqual(want);
  });
});

type AsyncCase = { name: string; run: (api: ReactivityApi, log: (v: unknown) => void) => Promise<void>; want: unknown[] };

const ASYNC_CASES: AsyncCase[] = [
  {
    name: 'три записи подряд — один прогон задания',
    run: async (api, log) => {
      const s = api.reactive({ n: 0 });
      api.watchEffect(() => log(`job ${s.n}`));
      s.n++;
      s.n++;
      s.n++;
      log('синхронно');
      await api.nextTick();
    },
    want: ['job 0', 'синхронно', 'job 3'],
  },
  {
    name: 'порядок: sync → pre → post → nextTick',
    run: async (api, log) => {
      const s = api.reactive({ n: 0 });
      api.watchEffect(() => log(`pre ${s.n}`));
      api.watchEffect(() => log(`post ${s.n}`), { flush: 'post' });
      api.watchEffect(() => log(`sync ${s.n}`), { flush: 'sync' });
      await api.nextTick();
      s.n = 1;
      api.nextTick(() => log('nextTick'));
      await api.nextTick();
      await api.nextTick();
    },
    // `post 0` — первый прогон post-эффекта тоже отложен, до микрозадачи
    want: ['pre 0', 'sync 0', 'post 0', 'sync 1', 'pre 1', 'post 1', 'nextTick'],
  },
  {
    name: 'watch: колбэк только на смену значения, со старым значением',
    run: async (api, log) => {
      const s = api.reactive({ n: 0 });
      (api.watch as (g: () => unknown, cb: (v: unknown, o: unknown) => void) => void)(
        () => s.n % 2,
        (v, o) => log(`${o} → ${v}`),
      );
      s.n = 1;
      await api.nextTick();
      s.n = 3;
      await api.nextTick();
      s.n = 4;
      await api.nextTick();
    },
    want: ['0 → 1', '1 → 0'],
  },
];

describe.each(ASYNC_CASES)('$name', ({ run, want }) => {
  it.each(IMPLS)('%s', async (_name, make) => {
    const log: unknown[] = [];
    await run(make(), (v) => log.push(v));
    expect(log).toEqual(want);
  });
});

// ---------------------------------------------------------------------------
// «Без этой строки сломается»: сломанные варианты
// ---------------------------------------------------------------------------

/**
 * Массивы и коллекции — только настоящий Vue: мини-версия их не поддерживает, и тема говорит
 * это прямо. Проверяется напечатанный пример и в том числе его неочевидная строка: `size`
 * просыпается от смены значения существующего ключа, хотя сам не меняется.
 */
describe('COLLECTIONS_CODE исполняется как напечатан', () => {
  it.each([
    ['Vue prod', VUE.production.api],
    ['Vue dev', VUE.development.api],
  ] as const)('%s', (_name, api) => {
    const log: unknown[] = [];
    exec(api, COLLECTIONS_CODE, (v) => log.push(v));
    expect(log).toEqual(COLLECTIONS_LOG);
  });
});

describe('каждое «без этой строки сломается» проверено поломкой', () => {
  it('receiver: с target[key] геттер теряет зависимости', () => {
    const log: unknown[] = [];
    exec(broken(['Reflect.get(target, key, receiver)', 'target[key]']), RECEIVER_CODE, (v) => log.push(v));
    expect(log).toEqual(['Ада Лавлейс']);
  });

  it('кеш прокси: без reactiveMap state.inner !== state.inner', () => {
    const mini = broken(['let proxy = reactiveMap.get(target)', 'let proxy']);
    const s = mini.reactive({ inner: {} });
    expect(s.inner === s.inner).toBe(false);
  });

  it('очистка: без cleanup(e) ветка if держит лишнюю подписку', () => {
    const log: unknown[] = [];
    exec(broken(['      cleanup(e)', '      void 0']), BRANCH_CODE, (v) => log.push(v));
    expect(log).toEqual([1, 2, 2, 3]);
  });

  /**
   * Копия подписчиков. Прогон эффекта вычёркивает его из `Set` и вписывает обратно, и обход
   * живого `Set` встречает его второй раз. В мини-версии этот второй заход гасит `isDirty`
   * (версии уже свежие) — поэтому без одной копии прогонов столько же. Вечный цикл
   * получается, когда нет и копии, и проверки версий, — как в реализациях без версий.
   *
   * Источник — `ref`, а не ключ `reactive`: `trigger` по ключу и так собирает подписчиков
   * в новый `Set`, а живой набор `notify` получает от `triggerDep` — у `ref` и `computed`.
   */
  function fused(mini: MiniVue) {
    const r = mini.ref(1);
    let runs = 0;
    mini.effect(() => {
      if (++runs > 50) throw new Error('предохранитель');
      void r.value;
    });
    let thrown: unknown = null;
    try {
      r.value = 2;
    } catch (error) {
      thrown = error;
    }
    return { runs, thrown };
  }

  it('копия Set: без неё второй заход гасит isDirty', () => {
    expect(fused(broken(['const list = [...subs]', 'const list = subs']))).toEqual({ runs: 2, thrown: null });
  });

  it('копия Set: без неё и без проверки версий обход не заканчивается', () => {
    const { runs, thrown } = fused(
      broken(['const list = [...subs]', 'const list = subs'], ['else if (isDirty(e)) e.run()', 'else e.run()']),
    );
    expect(runs).toBeGreaterThan(50);
    expect(String(thrown)).toContain('предохранитель');
  });

  it('два прохода notify: без них эффект видит несогласованную пару', () => {
    const mini = broken([
      '  for (const e of list) if (e.computed) wake(e)    // сперва пометить computed\n  for (const e of list) if (!e.computed) wake(e)   // потом будить эффекты',
      '  for (const e of list) wake(e)',
    ]);
    const log: string[] = [];
    const s = mini.reactive({ a: 1 });
    const double = mini.computed(() => s.a * 2);
    mini.effect(() => log.push(`${s.a} ${double.value}`));
    s.a = 2;
    expect(log).toEqual(['1 2', '2 2', '2 4']);
  });

  it('Object.is: со строгим неравенством NaN будит на каждой записи', () => {
    const mini = broken(['!Object.is(old, value)', 'old !== value']);
    const log: unknown[] = [];
    const s = mini.reactive({ x: NaN });
    mini.effect(() => log.push(s.x));
    s.x = NaN;
    expect(log).toEqual([NaN, NaN]);
  });
});

// ---------------------------------------------------------------------------
// Намеренные отличия: закреплены, чтобы учебное упрощение не выдать за Vue
// ---------------------------------------------------------------------------

describe('намеренные отличия мини-версии от Vue', () => {
  /**
   * Мини-версия сортирует очередь по `id` = порядку создания эффекта. Vue сортирует по номеру
   * компонента, а у `watchEffect` вне компонента `id` нет (`getId` отдаёт −1 для заданий
   * `pre`), и такие задания идут в порядке записи.
   */
  async function order(api: ReactivityApi): Promise<string[]> {
    const log: string[] = [];
    const s = api.reactive({ a: 0, b: 0 });
    api.watchEffect(() => log.push(`A ${s.a}`));
    api.watchEffect(() => log.push(`B ${s.b}`));
    s.b++;
    s.a++;
    await api.nextTick();
    return log;
  }

  it('очередь pre вне компонента: мини — по id, Vue — по порядку записи', async () => {
    expect(await order(loadMiniVue(MINI_VUE_CODE))).toEqual(['A 0', 'B 0', 'A 1', 'B 1']);
    for (const build of ['production', 'development'] as Build[]) {
      expect(await order(VUE[build].api)).toEqual(['A 0', 'B 0', 'B 1', 'A 1']);
    }
  });

  /**
   * Порядок подписчиков внутри одной записи — не контракт. Vue копит эффекты пакетом
   * и выполняет его с конца, поэтому подписчики перебора (они добавлены вторыми) идут
   * первыми. Мини-версия будит в порядке сбора. Набор разбуженных при этом одинаков.
   */
  function addKey(api: ReactivityApi): string[] {
    const log: string[] = [];
    const s = api.reactive<Record<string, number>>({});
    api.effect(() => log.push(`keys ${Object.keys(s).join()}`));
    api.effect(() => log.push(`in ${'z' in s}`));
    log.length = 0;
    s.z = 1;
    return log;
  }

  it('порядок подписчиков внутри одной записи различается, набор — нет', () => {
    const mini = addKey(loadMiniVue(MINI_VUE_CODE));
    const vue = addKey(VUE.production.api);
    expect(mini).toEqual(['in true', 'keys z']);
    expect(vue).toEqual(['keys z', 'in true']);
    expect([...mini].sort()).toEqual([...vue].sort());
  });

  /**
   * `computed` без читателей. Vue 3.5 подписывает его на источники, только пока у него есть
   * свои подписчики; мини-версия — навсегда. ⚠️ Со стороны Vue это видно лишь по внутреннему
   * полю: `c.deps` — первый `Link`, `.dep.subs` — хвост подписчиков источника. Поле не
   * публичное и может смениться; если проверка упадёт после обновления Vue, начинать с него.
   */
  it('computed, прочитанный вне эффекта: мини подписан на источник, Vue — нет', () => {
    const mini = loadMiniVue(MINI_VUE_CODE);
    const raw = { a: 1 };
    const c = mini.computed(() => mini.reactive(raw).a);
    void c.value;
    expect(mini.targetMap.get(raw)?.get('a')?.size).toBe(1);

    for (const build of ['production', 'development'] as Build[]) {
      const vue = VUE[build].api;
      const s = vue.reactive({ a: 1 });
      const vc = vue.computed(() => s.a) as unknown as { value: number; deps: { dep: { subs?: unknown } } };
      void vc.value;
      expect(vc.deps.dep.subs).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Модель демо: то, что видит читатель
// ---------------------------------------------------------------------------

describe('модель демо (MiniSession)', () => {
  const scenario = (id: string) => MINI_SCENARIOS.find((s) => s.id === id)!;
  const subs = (rows: { label: string; subs: { name: string }[] }[], label: string) =>
    rows.find((r) => r.label === label)?.subs.map((s) => s.name);

  it('ветка if: после show = false E уходит из state.a и появляется в state.b', async () => {
    const session = new MiniSession(MINI_VUE_CODE, scenario('branch'));
    const first = await session.start();
    expect(first.sync).toEqual([{ text: 'a = 1', active: 'E' }]);
    expect(first.active).toBeNull();
    expect(subs(first.graph, 'state.a')).toEqual(['E']);
    expect(subs(first.graph, 'state.b')).toBeUndefined();

    const toggled = await session.act(2);
    expect(subs(toggled.graph, 'state.a')).toEqual([]);
    expect(subs(toggled.graph, 'state.b')).toEqual(['E']);

    const quiet = await session.act(0);
    expect(quiet.sync).toEqual([]);
    expect(quiet.graph.find((r) => r.label === 'state.a')?.version).toBe(1);
  });

  it('цепочка: computed в графе — и подписчик, и источник; activeEffect в журнале', async () => {
    const session = new MiniSession(MINI_VUE_CODE, scenario('chain'));
    const first = await session.start();
    expect(first.sync.map((e) => e.active)).toEqual(['pricey', 'total', 'E']);
    expect(subs(first.graph, 'state.price')).toEqual(['total']);
    expect(subs(first.graph, 'total · computed')).toEqual(['pricey']);
    expect(subs(first.graph, 'pricey · computed')).toEqual(['E']);

    const step = await session.act(0);
    expect(step.sync.map((e) => e.text)).toEqual(['total пересчитан', 'pricey пересчитан']);
    expect(step.graph.find((r) => r.label === 'pricey · computed')).toMatchObject({ dirty: false, version: 1 });
  });

  it('три записи: очередь снята между синхронной частью и сливом', async () => {
    const session = new MiniSession(MINI_VUE_CODE, scenario('batch'));
    const first = await session.start();
    expect(first.queued).toEqual({ pre: [], post: ['post'] });

    const step = await session.act(0);
    expect(step.sync.map((e) => e.active)).toEqual(['sync', 'sync', 'sync']);
    expect(step.queued).toEqual({ pre: ['render'], post: ['post'] });
    expect(step.flush).toEqual([
      { text: 'n = 3', active: 'render' },
      { text: 'n = 3', active: 'post' },
    ]);
    expect(subs(step.graph, 'state.n')).toEqual(['sync', 'render', 'post']);
  });

  it('новый ключ: перебор — отдельный Dep, его будит только добавление', async () => {
    const session = new MiniSession(MINI_VUE_CODE, scenario('keys'));
    await session.start();
    const set = await session.act(0);
    expect(set.sync.map((e) => e.active)).toEqual(['readA']);
    const add = await session.act(1);
    expect(add.sync).toEqual([{ text: 'a, b', active: 'keys' }]);
    expect(add.graph.find((r) => r.kind === 'iterate')).toMatchObject({ version: 1, subs: [{ name: 'keys', kind: 'effect' }] });
  });
});
