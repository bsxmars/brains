import type { FindBoundary } from './types';

/**
 * Демо и тест спрашивают одну и ту же функцию — строку `FIND_BOUNDARY_CODE` из темы.
 *
 * Строка напечатана на странице, собрана здесь `new Function` и прогоняется
 * `tests/unit/hmr.test.ts` на графах стенда: ответ сверяется с тем, что прислал настоящий
 * Vite 8.3.0. Копии нет — если показанный код разойдётся с Vite, покраснеет тест.
 *
 * Ни DOM, ни Vue: чистая функция, чтобы её мог импортировать юнит-тест.
 */
export function loadFindBoundary(code: string): FindBoundary {
  return new Function(`${code}\nreturn findBoundary;`)() as FindBoundary;
}
