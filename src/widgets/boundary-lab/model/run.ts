import type { BoundaryApi } from './types';

/**
 * Демо и тест спрашивают одну и ту же модель — строку `BOUNDARY_CODE` из темы «Suspense
 * и границы ошибок».
 *
 * Строка напечатана на странице, собрана здесь `new Function` и прогоняется
 * `tests/unit/suspense-errors.test.ts` против настоящих React 19.3 и Vue 3.5 на всех
 * сочетаниях состояний демо-дерева. Копии нет — разойдётся показанный код с фреймворком,
 * покраснеет тест.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadBoundary(code: string): BoundaryApi {
  return new Function(`${code}\nreturn { renderRoot, loadWaves };`)() as BoundaryApi;
}
