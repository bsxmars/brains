import type { GrowthSet, RegexEngine } from './types';

/**
 * Демо и тест спрашивают один и тот же движок — строки `PARSE_CODE` и `MATCH_CODE` из темы.
 *
 * Строки напечатаны на странице, собраны здесь `new Function` и прогоняются
 * `tests/unit/regex.test.ts` против `RegExp` V8 на тысячах шаблонов и строк. Копии нет —
 * если показанный код разойдётся с движком, покраснеет тест.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadEngine(parseCode: string, matchCode: string): RegexEngine {
  return new Function(`${parseCode}\n${matchCode}\nreturn { parse, match };`)() as RegexEngine;
}

/** Длины строки на графике. Дальше плохой шаблон считается заметно долго даже учебным движком. */
export const GROWTH_LENGTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];

export interface GrowthPoint {
  n: number;
  steps: number;
}

/** Число шагов учебного движка для каждой длины строки и каждого шаблона набора. */
export function growth(engine: RegexEngine, set: GrowthSet, lengths = GROWTH_LENGTHS): GrowthPoint[][] {
  return set.series.map((s) =>
    lengths.map((n) => ({ n, steps: engine.match(s.pattern, set.unit.repeat(n) + set.tail).steps })),
  );
}
