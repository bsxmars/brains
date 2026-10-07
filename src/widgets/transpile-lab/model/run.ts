import type { DecideApi } from './types';

/**
 * Демо и тест спрашивают одни и те же функции — строку `DECIDE_CODE` из темы.
 *
 * Строка напечатана на странице, собрана здесь `new Function` и прогоняется
 * `tests/unit/transpilation.test.ts` против `@babel/helper-compilation-targets` и решения
 * `@babel/preset-env` (вывод опции `debug`) на двух десятках запросов browserslist, а против
 * `useBuiltIns: 'usage'` — на модулях core-js. Копии нет: если показанный код разойдётся
 * с Babel, покраснеет тест.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadDecide(code: string): DecideApi {
  return new Function(`${code}\nreturn { lowestVersions, blockers, required };`)() as DecideApi;
}
