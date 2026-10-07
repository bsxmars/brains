import type { GraphemeApi, PluralApi } from './types';

/**
 * Демо и тест спрашивают одни и те же функции — строки `GRAPHEME_CODE` и `PLURAL_CODE` из темы
 * «Unicode и Intl».
 *
 * Строки напечатаны на странице, собраны здесь `new Function` и прогоняются
 * `tests/unit/unicode-intl.test.ts` против `Intl.Segmenter` и `Intl.PluralRules`. Копии нет:
 * разойдётся показанный код с ICU — покраснеет тест.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadGraphemes(code: string): GraphemeApi {
  return new Function(`${code}\nreturn { kind, graphemeBreaks, splitGraphemes };`)() as GraphemeApi;
}

export function loadPlural(code: string): PluralApi {
  return new Function(`${code}\nreturn { operands, pluralRu };`)() as PluralApi;
}

/** Номер кодовой точки в привычной записи: `U+1F600`. */
export function hex(c: string): string {
  return 'U+' + (c.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Ответ `Intl.PluralRules('ru')` для числа, записанного строкой: столько знаков после точки,
 * сколько в записи, — так число и будет показано. Этим же сверяет тест.
 */
export function intlPlural(value: string): string {
  const frac = value.split('.')[1]?.length ?? 0;
  const pr = new Intl.PluralRules('ru', { minimumFractionDigits: frac, maximumFractionDigits: Math.max(frac, 3) });
  return pr.select(Number(value));
}
