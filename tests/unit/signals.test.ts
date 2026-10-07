import { readFileSync } from 'node:fs';
import Module, { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DOM_SCENARIO,
  FROZEN_CODE,
  GRAPH_SCENARIOS,
  MINI_SIGNALS_CODE,
  NAIVE_SIGNALS_CODE,
  STEP_DOM,
  STEP_EFFECT,
  STEP_PULL,
  STEP_PUSH,
  STEP_SIGNAL,
} from '@/content/frameworks/signals/data';
import { API_NAMES, DomLab, GraphLab, loadSignals, patchCode } from '@/widgets/mini-signals';
import type { GraphScenario, GraphStep, SignalsApi, TraceEntry } from '@/widgets/mini-signals';

/**
 * «Сигналы»: мини-реализация против `@vue/reactivity` 3.5 и alien-signals.
 *
 * Все проверки исполняют **те же строки** `MINI_SIGNALS_CODE` и `NAIVE_SIGNALS_CODE`, что
 * напечатаны в теме, и тот же модуль `widgets/mini-signals/model`, которым их гоняет демо.
 *
 * Сверка идёт с двумя настоящими реализациями через переходник к одним и тем же именам
 * (`signal`, `computed`, `effect`, `batch`):
 *   - `@vue/reactivity` 3.5.42 — **обе** сборки. Сборка выбирается подменой разрешения имён
 *     (приём и причина — в `tests/unit/vue-internals.test.ts`: vitest разрешает с условием
 *     `development`, и `NODE_ENV` ничего не меняет);
 *   - alien-signals 3.2.1 — ⚠️ не объявлен в `package.json`, приходит через `vue-tsc`. Если его
 *     не станет, тест упадёт на загрузке — и это правильно: молча пропущенная сверка хуже.
 *
 * Ожидаемые журналы записаны литералами: закреплено не только «совпадают», но и «что именно».
 */

const require = createRequire(import.meta.url);

type Build = 'production' | 'development';

interface VueReactivity {
  ref: <T>(v: T) => { value: T };
  computed: <T>(fn: () => T) => { readonly value: T };
  effect: (fn: () => unknown) => unknown;
  stop: (runner: unknown) => void;
}

function loadVue(build: Build): { api: VueReactivity; files: string[] } {
  const resolver = Module as unknown as { _resolveFilename: (request: string, ...rest: unknown[]) => string };
  const original = resolver._resolveFilename;
  const suffix = build === 'production' ? '.prod' : '';
  for (const key of Object.keys(require.cache)) if (key.includes('/node_modules/@vue/')) delete require.cache[key];
  resolver._resolveFilename = function (request, ...rest) {
    const pkg = /^@vue\/(reactivity|shared)$/.exec(request)?.[1];
    if (pkg) return original.call(this, `@vue/${pkg}/dist/${pkg}.cjs${suffix}.js`, ...rest);
    return original.call(this, request, ...rest);
  };
  try {
    const api = require('@vue/reactivity') as VueReactivity;
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

/**
 * Переходник к Vue. ⚠️ `batch` здесь — просто вызов: синхронного пакета в публичном API
 * `@vue/reactivity` нет (`startBatch`/`endBatch` не экспортируются — проверено ниже).
 */
function vueApi(V: VueReactivity): SignalsApi {
  return {
    signal: (v) => {
      const r = V.ref(v);
      return { get: () => r.value, set: (x) => void (r.value = x) };
    },
    computed: (fn) => {
      const c = V.computed(() => fn());
      return { get: () => c.value };
    },
    effect: (fn) => {
      const runner = V.effect(fn);
      return () => V.stop(runner);
    },
    batch: (fn) => fn(),
  };
}

interface Alien {
  signal: <T>(v: T) => { (): T; (v: T): void };
  computed: <T>(fn: () => T) => () => T;
  effect: (fn: () => void) => () => void;
  startBatch: () => void;
  endBatch: () => void;
}

const ALIEN = require('alien-signals') as Alien;
/** `package.json` закрыт полем `exports` — читаем его с диска рядом с разрешённым входом. */
const ALIEN_VERSION = (() => {
  let dir = dirname(require.resolve('alien-signals'));
  while (!dir.endsWith('/alien-signals')) dir = dirname(dir);
  return (JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { version: string }).version;
})();

const alienApi: SignalsApi = {
  signal: (v) => {
    const s = ALIEN.signal(v);
    return { get: () => s(), set: (x) => s(x) };
  },
  computed: (fn) => {
    const c = ALIEN.computed(() => fn());
    return { get: () => c() };
  },
  effect: (fn) =>
    ALIEN.effect(() => {
      fn();
    }),
  batch: (fn) => {
    ALIEN.startBatch();
    try {
      return fn();
    } finally {
      ALIEN.endBatch();
    }
  },
};

/** Реализации, обязанные вести себя одинаково. Мини-версия каждый раз свежая. */
const PUSH_PULL: [string, () => SignalsApi][] = [
  ['мини-версия', () => loadSignals(MINI_SIGNALS_CODE)],
  ['Vue prod', () => vueApi(VUE.production.api)],
  ['Vue dev', () => vueApi(VUE.development.api)],
  ['alien-signals', () => alienApi],
];

/** Исполнить кусок кода с публичными именами реализации и `log`. */
function exec(api: SignalsApi, code: string): unknown[] {
  const out: unknown[] = [];
  new Function(...API_NAMES, 'log', code)(...API_NAMES.map((n) => api[n]), (v: unknown) => out.push(v));
  return out;
}

/** Весь журнал сценария: установка и каждая кнопка по разу. */
function play(api: SignalsApi, scenario: GraphScenario): GraphStep[] {
  const lab = new GraphLab(api, scenario);
  return [lab.start(), ...scenario.actions.map((_, i) => lab.step(i))];
}

/** Журнал в строку на шаг: `↻ b` — пересчёт, `E: …` — вывод, `⚠` — несогласованная пара. */
const brief = (steps: GraphStep[]) =>
  steps.map((s) =>
    s.trace
      .map((t: TraceEntry) => (t.kind === 'run' ? `↻ ${t.name}` : `${t.text}${t.consistent === false ? ' ⚠' : ''}`))
      .join(' | '),
  );

const scenario = (id: string) => {
  const s = GRAPH_SCENARIOS.find((x) => x.id === id);
  if (!s) throw new Error(`нет сценария ${id} в GRAPH_SCENARIOS`);
  return s;
};

describe('загрузка', () => {
  it('Vue: обе сборки те, что заказаны', () => {
    expect(VUE.production.files.map((f) => f.split('/dist/')[1]).sort()).toEqual(['reactivity.cjs.prod.js', 'shared.cjs.prod.js']);
    expect(VUE.development.files.map((f) => f.split('/dist/')[1]).sort()).toEqual(['reactivity.cjs.js', 'shared.cjs.js']);
  });

  it('alien-signals — той версии, что названа в теме', () => {
    expect(ALIEN_VERSION).toBe('3.2.1');
  });

  it('исполняемая строка — ровно шаги, напечатанные в теме', () => {
    for (const step of [STEP_SIGNAL, STEP_PUSH, STEP_PULL, STEP_EFFECT, STEP_DOM]) expect(MINI_SIGNALS_CODE).toContain(step);
    expect(MINI_SIGNALS_CODE.replace([STEP_SIGNAL, STEP_PUSH, STEP_PULL, STEP_EFFECT, STEP_DOM].join('\n\n'), '').trim())
      .toBe('return { signal, computed, effect, batch, createRenderer }');
  });
});

/** Журналы push-pull: одинаковы у мини-версии, Vue и alien-signals. */
const EXPECTED: Record<string, string[]> = {
  diamond: [
    '↻ E | ↻ b | ↻ c | E: b = 2, c = 2',
    '↻ b | ↻ E | ↻ c | E: b = 4, c = 3',   // один прогон E, пара согласована
    '',                                    // то же значение — никого
  ],
  lazy: [
    '↻ E | ↻ parity | E: чётное',          // heavy не считался
    '↻ parity',                            // пересчитан, прежний — E молчит
    '↻ parity | ↻ E | E: нечётное',
  ],
  batch: [
    '↻ E | ↻ full | E: Ада Лавлейс',
    '↻ full | ↻ E | E: Грейс Хоппер',      // пакет: один прогон
    '↻ full | ↻ E | E: Ада Хоппер | ↻ full | ↻ E | E: Ада Лавлейс',
  ],
};

describe('сценарии демо: push-pull одинаков у трёх реализаций', () => {
  for (const [name, make] of PUSH_PULL) {
    for (const s of GRAPH_SCENARIOS) {
      // Единственное исключение — пакет у Vue: он в отдельном блоке ниже.
      if (s.id === 'batch' && name.startsWith('Vue')) continue;
      it(`${name} · ${s.id}`, () => {
        expect(brief(play(make(), s))).toEqual(EXPECTED[s.id]);
      });
    }
  }

  it('у каждого сценария демо есть ожидаемый журнал', () => {
    expect(GRAPH_SCENARIOS.map((s) => s.id).sort()).toEqual(Object.keys(EXPECTED).sort());
  });
});

describe('наивный push: глитч и лишние прогоны', () => {
  const naive = () => loadSignals(NAIVE_SIGNALS_CODE);

  it('ромб: E выполняется дважды, первый раз — с несогласованной парой', () => {
    expect(brief(play(naive(), scenario('diamond')))).toEqual([
      '↻ b | ↻ c | ↻ E | E: b = 2, c = 2',   // жадно: b и c посчитаны при создании
      '↻ b | ↻ E | E: b = 4, c = 2 ⚠ | ↻ c | ↻ E | E: b = 4, c = 3',
      '',
    ]);
  });

  it('ленивости нет: heavy считается на каждой записи, хотя его не читает никто', () => {
    const steps = play(naive(), scenario('lazy'));
    expect(steps.at(-1)!.counts.heavy).toBe(3);
    expect(brief(steps)[1]).toBe('↻ parity | ↻ heavy');   // отсечка по равенству есть и тут
  });

  it('пакета нет: промежуточное «Грейс Лавлейс» видно', () => {
    expect(brief(play(naive(), scenario('batch')))[1]).toBe('↻ full | ↻ E | E: Грейс Лавлейс | ↻ full | ↻ E | E: Грейс Хоппер');
  });

  it('на цепочке наивная версия неотличима от push-pull (тонкое место 03)', () => {
    const code = `const a = signal(1)
const b = computed(() => a.get() * 2)
effect(() => log(b.get()))
a.set(2); a.set(3)`;
    expect(exec(naive(), code)).toEqual([2, 4, 6]);
    expect(exec(loadSignals(MINI_SIGNALS_CODE), code)).toEqual([2, 4, 6]);
  });
});

describe('поведение, заявленное в тексте, — на всех push-pull реализациях', () => {
  for (const [name, make] of PUSH_PULL) {
    it(`${name}: computed ленив и кеширует — 0, 1, 1, 2 вызова`, () => {
      expect(
        exec(
          make(),
          `let calls = 0
const n = signal(1)
const c = computed(() => { calls++; return n.get() * 2 })
log(calls)
c.get(); c.get(); log(calls)
n.set(2); log(calls)
c.get(); log(calls)`,
        ),
      ).toEqual([0, 1, 1, 2]);
    });

    it(`${name}: условная зависимость отписывается`, () => {
      expect(
        exec(
          make(),
          `const show = signal(true), a = signal(1), b = signal(10)
effect(() => log(show.get() ? 'a ' + a.get() : 'b ' + b.get()))
b.set(11)            // не читается — тишина
show.set(false)      // b 11
a.set(2)             // больше не читается — тишина
b.set(12)            // b 12`,
        ),
      ).toEqual(['a 1', 'b 11', 'b 12']);
    });

    it(`${name}: dispose отписывает эффект`, () => {
      expect(
        exec(
          make(),
          `const n = signal(0)
const dispose = effect(() => log(n.get()))
n.set(1); dispose(); n.set(2)`,
        ),
      ).toEqual([0, 1]);
    });
  }

  for (const [name, make] of PUSH_PULL.filter(([n]) => !n.startsWith('Vue'))) {
    it(`${name}: внутри пакета computed уже свежий (тонкое место 04)`, () => {
      expect(
        exec(
          make(),
          `const a = signal(1)
const b = computed(() => a.get() * 2)
effect(() => log('E ' + b.get()))
batch(() => {
  a.set(2)
  log('внутри ' + b.get())
})`,
        ),
      ).toEqual(['E 2', 'внутри 4', 'E 4']);
    });
  }
});

describe('намеренные отличия — закреплены явно', () => {
  it('у @vue/reactivity нет публичного startBatch/endBatch', () => {
    for (const build of ['production', 'development'] as const) {
      const V = VUE[build].api as unknown as Record<string, unknown>;
      expect(V.startBatch, build).toBeUndefined();
      expect(V.endBatch, build).toBeUndefined();
    }
  });

  it('Vue: две записи — два прогона эффекта, промежуточное «Грейс Лавлейс» видно', () => {
    for (const build of ['production', 'development'] as const) {
      expect(brief(play(vueApi(VUE[build].api), scenario('batch')))[1], build).toBe(
        '↻ full | ↻ E | E: Грейс Лавлейс | ↻ full | ↻ E | E: Грейс Хоппер',
      );
    }
  });

  /** Тонкое место 02. */
  const MUTATE = `const list = signal([])
effect(() => log(list.get().length))
list.get().push(1)
list.set([...list.get(), 2])`;

  it('мутация массива внутри сигнала: мини и alien молчат, ref у Vue глубокий и будит', () => {
    expect(exec(loadSignals(MINI_SIGNALS_CODE), MUTATE)).toEqual([0, 2]);
    expect(exec(alienApi, MUTATE)).toEqual([0, 2]);
    expect(exec(vueApi(VUE.production.api), MUTATE)).toEqual([0, 1, 2]);
    expect(exec(vueApi(VUE.development.api), MUTATE)).toEqual([0, 1, 2]);
  });

  /** Тонкое место 05. */
  const NESTED = `const a = signal(0), b = signal(0)
effect(() => {
  a.get()
  effect(() => log('inner ' + b.get()))
})
a.set(1); a.set(2)
log('—')
b.set(1)`;

  const innerRunsAfterWrite = (out: unknown[]) => out.slice(out.indexOf('—') + 1).length;

  it('вложенный эффект: мини-версия и Vue копят — три внутренних, alien-signals — один', () => {
    expect(innerRunsAfterWrite(exec(loadSignals(MINI_SIGNALS_CODE), NESTED))).toBe(3);
    expect(innerRunsAfterWrite(exec(vueApi(VUE.production.api), NESTED))).toBe(3);
    expect(innerRunsAfterWrite(exec(vueApi(VUE.development.api), NESTED))).toBe(3);
    expect(innerRunsAfterWrite(exec(alienApi, NESTED))).toBe(1);
  });
});

describe('«без этой строки сломается» — сломанными вариантами', () => {
  it('эффект, запущенный прямо во время пометки, возвращает глитч', () => {
    const code = patchCode(MINI_SIGNALS_CODE, [
      ["if (node.kind === 'effect') pending.push(node)", "if (node.kind === 'effect') refresh(node)"],
    ]);
    expect(brief(play(loadSignals(code), scenario('diamond')))[1]).toBe(
      '↻ b | ↻ E | E: b = 4, c = 2 ⚠ | ↻ c | ↻ E | E: b = 4, c = 3',
    );
  });

  it('без сверки версий теряется отсечка: E выполняется, хотя чётность прежняя', () => {
    const code = patchCode(MINI_SIGNALS_CODE, [
      ['if (node.ran && !sourcesChanged(node)) return', 'if (false) return'],
    ]);
    expect(brief(play(loadSignals(code), scenario('lazy')))[1]).toBe('↻ E | ↻ parity | E: чётное');
  });

  /**
   * Строка `if (node.stale) return` в `markStale` — про цену, а не про поведение: без неё эффект
   * встаёт в очередь по разу на каждый путь, но второй `refresh` застаёт `stale = false` и ничего
   * не делает. Проверка закрепляет именно это, чтобы текст не выдал её за защиту от глитча.
   */
  it('без пометки «уже помечен» вывод прежний — строка экономит обход, а не спасает от глитча', () => {
    const noGuard = ['if (node.stale) return            // уже помечен: ромб не обходится дважды', ''] as const;
    // счётчик постановок в очередь: первый прогон эффекта идёт прямо из effect(), мимо очереди
    const counted = (...extra: (readonly [string, string])[]) => {
      const code = patchCode(MINI_SIGNALS_CODE, [
        ...extra,
        ["if (node.kind === 'effect') pending.push(node)", "if (node.kind === 'effect') { pending.push(node); queued.push(node) }"],
        ['const pending = []', 'const pending = [], queued = []'],
        ['return { signal, computed, effect, batch, createRenderer }', 'return { signal, computed, effect, batch, createRenderer, queued }'],
      ]);
      const mini = loadSignals(code) as unknown as SignalsApi & { queued: unknown[] };
      return { mini, steps: play(mini, scenario('diamond')) };
    };

    const guarded = counted();
    expect(guarded.mini.queued.length).toBe(1);
    const bare = counted(noGuard);
    expect(bare.mini.queued.length).toBe(2);                   // по разу на путь через b и через c
    expect(brief(bare.steps)).toEqual(EXPECTED.diamond);       // а вывод тот же
  });

  it('batch без отложенного flush снова показывает промежуточное состояние', () => {
    const code = patchCode(MINI_SIGNALS_CODE, [['if (batchDepth === 0) flush()', 'flush()']]);
    expect(brief(play(loadSignals(code), scenario('batch')))[1]).toBe(
      '↻ full | ↻ E | E: Грейс Лавлейс | ↻ full | ↻ E | E: Грейс Хоппер',
    );
  });
});

describe('рендер без виртуального DOM', () => {
  it('операции DOM на каждый шаг и один вызов компонента', () => {
    const lab = new DomLab(loadSignals(MINI_SIGNALS_CODE), DOM_SCENARIO);
    const mount = lab.start();
    expect(mount.ops).toEqual([
      'createElement <p>#1',
      '<p>#1.setAttribute("class", "small")',
      'createText текст#2 "n = "',
      '<p>#1.append(текст#2)',
      'createText текст#3 ""',
      'текст#3.data = "0"',
      '<p>#1.append(текст#3)',
      'createText текст#4 ", "',
      '<p>#1.append(текст#4)',
      'createText текст#5 ""',
      'текст#5.data = "чётное"',
      '<p>#1.append(текст#5)',
      '<div>#0.append(<p>#1)',
    ]);
    expect(mount.html).toBe('<p class="small">n = 0, чётное</p>');

    const inc = lab.step(0);
    expect(inc.ops).toEqual(['текст#3.data = "1"', 'текст#5.data = "нечётное"']);   // класс не тронут

    expect(lab.step(1).ops).toEqual([]);                                             // то же значение

    const batched = lab.step(2);
    expect(batched.ops).toEqual(['<p>#1.setAttribute("class", "big")', 'текст#3.data = "3"']);
    expect(batched.html).toBe('<p class="big">n = 3, нечётное</p>');

    expect(batched.counts).toEqual({ Counter: 1 });
  });

  it('прочитанное в теле компонента застывает (тонкое место 01)', () => {
    const lab = new DomLab(loadSignals(MINI_SIGNALS_CODE), { setup: FROZEN_CODE, actions: [] });
    const { ops, html } = lab.start();
    expect(ops.at(-1)).toBe('<div>#0.append(<p>#1)');   // после монтирования — ни одной операции
    expect(html).toBe('<p>n = 0</p>');
  });
});
