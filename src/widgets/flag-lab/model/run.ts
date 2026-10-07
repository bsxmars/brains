import type { Decider, Flag, FlagApi, Resolution } from './types';

/**
 * Демо и тест спрашивают одни и те же функции — строки `FLAG_CODE`, `FLAGS_CODE` и `COIN_CODE`
 * из темы «Фича-флаги». Строки напечатаны на странице, собраны здесь `new Function` и прогоняются
 * `tests/unit/feature-flags.test.ts` против `imurmurhash`, векторов flagd-testbed и настоящего
 * `@openfeature/server-sdk`. Копии нет.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadFlagApi(flagCode: string, coinCode: string): FlagApi {
  return new Function(`${flagCode}\n${coinCode}\nreturn { murmur3, bucketOf, pickVariant, evaluate, coinFlip };`)() as FlagApi;
}

export function loadFlags(flagsCode: string): Record<string, Flag> {
  return new Function(`${flagsCode}\nreturn FLAGS;`)() as Record<string, Flag>;
}

/** Флаг демо: `new-cart` из темы с долей из ползунка, с правилами или без, выключенный или нет. */
export function demoFlag(base: Flag, percent: number, withRules: boolean, killed: boolean): Flag {
  return {
    ...base,
    disabled: killed,
    rules: withRules ? base.rules : [],
    split: [
      ['on', percent],
      ['off', 100 - percent],
    ],
  };
}

/**
 * Генератор с сидом (mulberry32) — для режима «монетка»: каждое изменение ползунка — новый
 * бросок, но один и тот же для сервера и браузера, чтобы гидратация не расходилась.
 */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Ответ флага для каждого пользователя. В режиме «монетка» доли решает `coinFlip`,
 * а выключатель и правила — тот же `evaluate`: монетка подменяет только корзину.
 */
export function resolveAll(
  api: FlagApi,
  flagKey: string,
  flag: Flag,
  users: Record<string, unknown>[],
  decider: Decider,
  roll: number,
): Resolution[] {
  const random = seeded(roll);
  return users.map((ctx) => {
    const r = api.evaluate(flagKey, flag, ctx, false);
    if (decider === 'hash' || r.reason !== 'SPLIT') return r;
    const on = api.coinFlip(flag.split?.[0]?.[1] ?? 0, random);
    return { value: on, variant: on ? 'on' : 'off', reason: 'SPLIT' };
  });
}
