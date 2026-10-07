import { createRequire } from 'node:module';
import { InMemoryProvider, OpenFeature, type EvaluationContext } from '@openfeature/server-sdk';
import { afterAll, describe, expect, it } from 'vitest';
import * as t from '@/content/delivery/feature-flags/data';
import { demoFlag, loadFlagApi, loadFlags, resolveAll } from '@/widgets/flag-lab/model/run';
import type { Flag } from '@/widgets/flag-lab/model/types';

/**
 * Тема «Фича-флаги: раскатка без деплоя».
 *
 * `FLAG_CODE`, `FLAGS_CODE`, `PROVIDER_CODE`, `USAGE_CODE` и `COIN_CODE` — строки из темы:
 * напечатаны на странице, исполняются демо и здесь. Проверяется:
 *  1. `murmur3` — против `imurmurhash` (его импортирует JS-ядро flagd) на 10 000 ASCII-ключах
 *     и против опорных значений MurmurHash3_x86_32; расхождение на кириллице — тоже.
 *  2. `pickVariant` — против векторов `open-feature/flagd-testbed` (`fractional.feature`, v2),
 *     а формула v1 — против векторов v1: так закреплено, что смена формулы перемешивает людей.
 *  3. Числа раскладки из текста — на `user-0…user-9999`.
 *  4. `evaluate` через провайдера из темы в настоящем `@openfeature/server-sdk`; таблица ответов,
 *     вывод хуков и слияние контекста — как напечатано; тот же набор — против `InMemoryProvider`.
 *  5. Модель демо: ни одного выпавшего при росте доли под хешем, выпавшие под монеткой.
 */

// `imurmurhash` приходит транзитивно (зависимость eslint), типов у него нет.
const MurmurHash3 = createRequire(import.meta.url)('imurmurhash') as new (key: string) => { result(): number };
const imurmur = (s: string) => new MurmurHash3(s).result() >>> 0;

const api = loadFlagApi(t.FLAG_CODE, t.COIN_CODE);
const FLAGS = loadFlags(t.FLAGS_CODE);
const IDS = Array.from({ length: 10_000 }, (_, i) => `user-${i}`);
const share = (p: number): [string, number][] => [
  ['on', p],
  ['off', 100 - p],
];
const onSet = (key: string, p: number) => new Set(IDS.filter((id) => api.pickVariant(key, id, share(p)) === 'on'));

/** Векторы из `flagd-testbed/evaluator/gherkin/fractional.feature`, коммит e77ced0 (2026-09-26). */
const SUITS: [string, number][] = [
  ['clubs', 25],
  ['diamonds', 25],
  ['hearts', 25],
  ['spades', 25],
];
const FLAGD_VECTORS = {
  // ключ флага `fractional-flag`, строка для хеша — ключ флага + user.name
  v2: { jack: 'hearts', queen: 'spades', ten: 'clubs', nine: 'diamonds', '3': 'clubs' },
  v1: { jack: 'spades', queen: 'clubs', ten: 'diamonds', nine: 'hearts', '3': 'diamonds' },
  // `fractional-flag-A-shared-seed`: строка — "shared-seed" + user.name
  sharedV2: { seven: 'hearts', eight: 'diamonds', nine: 'clubs', two: 'spades' },
  // `fractional-flag-shorthand`: без выражения — ключ флага + targetingKey, веса 1:1
  shorthandV2: { 'jon@company.com': 'heads', 'jane@company.com': 'tails' },
  // `fractional-hash-edge-flag`: строка — сам targetingKey; хеши 0, 1, 2³¹−1, 2³¹, 2³²−1
  edgeV2: { ejOoVL: 'lower', 'bY9fO-': 'lower', 'SI7p-': 'lower', '6LvT0': 'upper', ceQdGm: 'upper' },
};

/** Формула v1 flagd, как её описывает testbed: abs(int32 hash) / MaxInt32 * 100, граница включена. */
function flagdV1(key: string, split: [string, number][]) {
  const bucket = (Math.abs(new MurmurHash3(key).result() | 0) / 2147483647) * 100;
  let sum = 0;
  for (const [variant, weight] of split) {
    sum += weight;
    if (sum >= bucket) return variant;
  }
}

describe('murmur3 темы — это MurmurHash3_x86_32', () => {
  it('опорные значения', () => {
    expect(api.murmur3('')).toBe(0);
    expect(api.murmur3('hello')).toBe(0x248bfa47);
    expect(api.murmur3('The quick brown fox jumps over the lazy dog')).toBe(0x2e4ff723);
  });

  it('совпадает с imurmurhash на 10 000 ASCII-ключах', () => {
    const diff = IDS.filter((id) => api.murmur3('new-cart' + id) !== imurmur('new-cart' + id));
    expect(diff).toEqual([]);
  });

  it('на кириллице imurmurhash (UTF-16) расходится с UTF-8 — на всех ключах (UTF_NOTE)', () => {
    const keys = IDS.map((id) => 'new-cart' + id.replace('user', 'юзер'));
    expect(keys.filter((k) => api.murmur3(k) === imurmur(k)).length).toBe(0);
    // вариант при 50/50: половина пользователей разложена по-разному
    const differ = keys.filter((k) => {
      const ours = Math.floor((api.murmur3(k) * 100) / 2 ** 32) < 50;
      const theirs = Number((BigInt(imurmur(k)) * 100n) >> 32n) < 50;
      return ours !== theirs;
    }).length;
    expect(differ).toBe(5085);
    expect(t.UTF_NOTE).toContain('у половины');
  });
});

describe('pickVariant повторяет fractional flagd (векторы flagd-testbed)', () => {
  it('v2: ключ флага + user.name', () => {
    for (const [name, want] of Object.entries(FLAGD_VECTORS.v2)) {
      expect(api.pickVariant('fractional-flag', name, SUITS), name).toBe(want);
    }
  });

  it('v2: общий seed, короткая запись с весами по умолчанию, граничные хеши', () => {
    for (const [name, want] of Object.entries(FLAGD_VECTORS.sharedV2)) {
      expect(api.pickVariant('shared-seed', name, SUITS), name).toBe(want);
    }
    for (const [key, want] of Object.entries(FLAGD_VECTORS.shorthandV2)) {
      expect(api.pickVariant('fractional-flag-shorthand', key, [['heads', 1], ['tails', 1]]), key).toBe(want);
    }
    for (const [key, want] of Object.entries(FLAGD_VECTORS.edgeV2)) {
      expect(api.pickVariant('', key, [['lower', 50], ['upper', 50]]), key).toBe(want);
    }
    expect(['ejOoVL', 'bY9fO-', 'SI7p-', '6LvT0', 'ceQdGm'].map(api.murmur3)).toEqual([
      0, 1, 0x7fffffff, 0x80000000, 0xffffffff,
    ]);
  });

  it('v1 даёт другие варианты тем же людям — и это векторы v1 testbed', () => {
    for (const [name, want] of Object.entries(FLAGD_VECTORS.v1)) {
      expect(flagdV1('fractional-flag' + name, SUITS), name).toBe(want);
    }
    const changed = IDS.filter((id) => flagdV1('fractional-flag' + id, SUITS) !== api.pickVariant('fractional-flag', id, SUITS));
    expect(changed.length).toBe(7503);
  });
});

describe('раскладка на user-0…user-9999 — числа из текста', () => {
  it('SPREAD_ROWS', () => {
    for (const row of t.SPREAD_ROWS) expect(onSet('new-cart', row.p).size, `${row.p}%`).toBe(row.on);
  });

  it('рост доли 0 → 100 по 1%: ни одного выпавшего', () => {
    let prev = new Set<string>();
    let drops = 0;
    for (let p = 0; p <= 100; p++) {
      const cur = onSet('new-cart', p);
      for (const id of prev) if (!cur.has(id)) drops++;
      prev = cur;
    }
    expect(drops).toBe(0);
  });

  it('STICKY_ROWS и тонкие места: переименование, порядок, три варианта', () => {
    const a = onSet('new-cart', 10);
    const renamed = onSet('new-cart-v2', 10);
    expect([a.size, [...a].filter((id) => renamed.has(id)).length]).toEqual([966, 101]);

    const reordered = IDS.filter(
      (id) => api.pickVariant('new-cart', id, [['on', 20], ['off', 80]]) !== api.pickVariant('new-cart', id, [['off', 80], ['on', 20]]),
    ).length;
    expect(reordered).toBe(4039);

    const s1: [string, number][] = [['A', 34], ['B', 33], ['C', 33]];
    const s2: [string, number][] = [['A', 50], ['B', 25], ['C', 25]];
    const moved = IDS.filter((id) => api.pickVariant('layout', id, s1) !== api.pickVariant('layout', id, s2));
    expect(moved.length).toBe(2418);
    expect(moved.filter((id) => api.pickVariant('layout', id, s1) === 'A').length).toBe(0);

    const text = JSON.stringify(t.STICKY_ROWS) + JSON.stringify(t.PITFALLS);
    for (const n of ['966', '101', '4039', '2418', '7503']) expect(text, n).toContain(n);
  });

  it('две соли независимы: пересечение двух 10% около 1%', () => {
    const a = onSet('new-cart', 10);
    const b = onSet('dark-theme', 10);
    const both = [...a].filter((id) => b.has(id)).length;
    expect(both).toBeGreaterThan(60);
    expect(both).toBeLessThan(140);
  });
});

/** Провайдер из темы: `FLAG_CODE` + `PROVIDER_CODE`, флаги — `FLAGS_CODE`. */
function loadProvider(flags: Record<string, Flag>) {
  return new Function('flags', `${t.FLAG_CODE}\n${t.PROVIDER_CODE}\nreturn createProvider(flags);`)(flags);
}

describe('через настоящий OpenFeature SDK', () => {
  afterAll(async () => {
    OpenFeature.clearHooks();
    await OpenFeature.clearProviders();
    OpenFeature.setContext({});
  });

  it('USAGE_CODE печатает USAGE_OUTPUT', async () => {
    const lines: string[] = [];
    const fakeConsole = { log: (...a: unknown[]) => lines.push(a.map(String).join(' ')) };
    const body = t.USAGE_CODE.replace(/^import .*\n+/, '');
    expect(body).not.toContain('import');
    const run = new Function(
      'OpenFeature',
      'FLAGS',
      'console',
      `${t.FLAG_CODE}\n${t.PROVIDER_CODE}\nreturn (async () => {\n${body}\n})();`,
    );
    await run(OpenFeature, FLAGS, fakeConsole);
    OpenFeature.clearHooks();
    expect(lines.join('\n')).toBe(t.USAGE_OUTPUT);
  });

  it('EVAL_ROWS — ответы провайдера темы через getBooleanDetails / getStringDetails', async () => {
    await OpenFeature.setProviderAndWait('ours', loadProvider(FLAGS));
    const client = OpenFeature.getClient('ours');
    for (const row of t.EVAL_ROWS) {
      const d =
        row.flag === 'cart-label'
          ? await client.getStringDetails(row.flag, 'x', row.ctx)
          : await client.getBooleanDetails(row.flag, false, row.ctx);
      const shown = typeof d.value === 'string' ? `«${d.value}»` : String(d.value);
      expect([shown, d.variant ?? '—', d.reason], JSON.stringify(row)).toEqual([row.value, row.variant, row.reason]);
      if (row.reason === 'ERROR') expect(row.why).toContain(d.errorCode);
    }
  });

  it('тот же набор совпадает с InMemoryProvider: значение, вариант, ошибка', async () => {
    // Правила new-cart написаны здесь заново, без кода темы: корзина — через imurmurhash и BigInt.
    const mem = new InMemoryProvider({
      'new-cart': {
        variants: { on: true, off: false },
        defaultVariant: 'off',
        disabled: false,
        contextEvaluator: (ctx: EvaluationContext) => {
          if (String(ctx.email ?? '').endsWith('@shop.example')) return 'on';
          if (ctx.country === 'DE') return 'off';
          const bucket = Number((BigInt(imurmur('new-cart' + String(ctx.targetingKey))) * 100n) >> 32n);
          return bucket < 20 ? 'on' : 'off';
        },
      },
      'old-search': { variants: { on: true, off: false }, defaultVariant: 'on', disabled: true },
      'cart-label': { variants: { short: 'Корзина', long: 'Перейти в корзину' }, defaultVariant: 'short', disabled: false },
    });
    await OpenFeature.setProviderAndWait('mem', mem);
    await OpenFeature.setProviderAndWait('ours', loadProvider(FLAGS));
    const ours = OpenFeature.getClient('ours');
    const theirs = OpenFeature.getClient('mem');

    const pick = (d: { value: unknown; variant?: string; errorCode?: string }) => [d.value, d.variant, d.errorCode];
    for (const id of IDS.slice(0, 500)) {
      const ctx = { targetingKey: id };
      expect(pick(await ours.getBooleanDetails('new-cart', false, ctx)), id).toEqual(pick(await theirs.getBooleanDetails('new-cart', false, ctx)));
    }
    for (const [key, def, ctx] of [
      ['old-search', false, {}],
      ['no-such-flag', false, {}],
      ['new-cart', false, { targetingKey: 'user-1', email: 'a@shop.example', country: 'DE' }],
    ] as const) {
      expect(pick(await ours.getBooleanDetails(key, def, ctx)), key).toEqual(pick(await theirs.getBooleanDetails(key, def, ctx)));
    }
    // строковый флаг и несовпадение типа
    expect(pick(await ours.getStringDetails('cart-label', 'x', {}))).toEqual(pick(await theirs.getStringDetails('cart-label', 'x', {})));
    expect(pick(await ours.getStringDetails('new-cart', 'x', { targetingKey: 'user-7' }))).toEqual(['x', undefined, 'TYPE_MISMATCH']);
    expect(pick(await theirs.getStringDetails('new-cart', 'x', { targetingKey: 'user-7' }))).toEqual(['x', undefined, 'TYPE_MISMATCH']);
    // и та же причина у обоих там, где она стандартна
    expect((await ours.getBooleanDetails('old-search', false, {})).reason).toBe('DISABLED');
    expect((await theirs.getBooleanDetails('old-search', false, {})).reason).toBe('DISABLED');
    expect((await theirs.getStringDetails('cart-label', 'x', {})).reason).toBe('STATIC');
  });

  it('MERGE_*: ближний к вызову слой контекста побеждает', async () => {
    let seen: EvaluationContext | undefined;
    await OpenFeature.setProviderAndWait(loadProvider(FLAGS));
    const run = new Function(
      'OpenFeature',
      'spy',
      `return (async () => {\n${t.MERGE_CODE.replace(
        "await client.getBooleanDetails('new-cart', false, { targetingKey: 'user-7' });",
        "await client.getBooleanDetails('new-cart', false, { targetingKey: 'user-7' }, { hooks: [spy] });",
      )}\n})();`,
    );
    await run(OpenFeature, { before: (hc: { context: EvaluationContext }) => void (seen = hc.context) });
    expect(seen).toEqual({ country: 'FR', targetingKey: 'user-7' });
    expect(t.MERGE_RESULT).toBe(`{ country: 'FR', targetingKey: 'user-7' }`);
  });

  it('несуществующий флаг не бросает, а отдаёт значение вызывающего (DETAILS_NOTE)', async () => {
    await OpenFeature.setProviderAndWait(loadProvider(FLAGS));
    const d = await OpenFeature.getClient().getBooleanDetails('no-such-flag', false, {});
    expect([d.value, d.errorCode]).toEqual([false, 'FLAG_NOT_FOUND']);
  });
});

describe('модель демо', () => {
  const users = t.DEMO_USERS as unknown as Record<string, unknown>[];
  const at = (p: number, decider: 'hash' | 'coin', roll: number, key = 'new-cart', rules = true, killed = false) =>
    resolveAll(api, key, demoFlag(FLAGS['new-cart'], p, rules, killed), users, decider, roll).map((r) => r.value === true);

  it('пользователи — по правилу из подписи', () => {
    expect(t.DEMO_USERS).toHaveLength(200);
    expect(t.DEMO_USERS.filter((u) => u.email).length).toBe(4);
    expect(t.DEMO_USERS.filter((u) => u.country === 'DE').length).toBe(22);
    expect(t.DEMO_CAPTION).toContain('пятидесятого');
    expect(t.DEMO_CAPTION).toContain('девятого');
  });

  it('под хешем при росте доли не выпадает никто, под монеткой — выпадают', () => {
    let hashDrops = 0;
    let coinDrops = 0;
    for (let p = 1; p <= 100; p++) {
      const [h0, h1] = [at(p - 1, 'hash', p), at(p, 'hash', p + 1)];
      const [c0, c1] = [at(p - 1, 'coin', p), at(p, 'coin', p + 1)];
      hashDrops += h0.filter((on, i) => on && !h1[i]).length;
      coinDrops += c0.filter((on, i) => on && !c1[i]).length;
    }
    expect(hashDrops).toBe(0);
    expect(coinDrops).toBeGreaterThan(100);
  });

  it('выключатель гасит всех, включение возвращает тех же', () => {
    const live = at(30, 'hash', 1);
    expect(at(30, 'hash', 2, 'new-cart', true, true).some(Boolean)).toBe(false);
    expect(at(30, 'hash', 3)).toEqual(live);
  });

  it('первая строка вычислителя совпадает с напечатанной', () => {
    expect(loadFlags(t.FLAGS_CODE)['new-cart'].split).toEqual([
      ['on', 20],
      ['off', 80],
    ]);
    expect(t.FLAG_CODE.split('\n').length).toBeLessThanOrEqual(75);
  });
});
