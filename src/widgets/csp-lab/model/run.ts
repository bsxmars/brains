import type { CheckFn } from './types';

/**
 * Демо и тест спрашивают одну и ту же функцию — строку `CSP_CHECK_CODE` из темы
 * «CSP и Trusted Types».
 *
 * Строка напечатана на странице, собрана здесь `new Function` и прогоняется
 * `tests/unit/csp.test.ts` против журнала Chromium: на каждой паре «политика × проба»
 * сквозной страницы ответ функции обязан совпасть с тем, что браузер выполнил. Копии нет —
 * разойдётся показанный код с браузером, покраснеет тест.
 *
 * Ни DOM, ни Vue: чистая функция, чтобы её мог импортировать юнит-тест.
 */
export function loadCheck(code: string): CheckFn {
  return new Function(`${code}\nreturn checkScript;`)() as CheckFn;
}
