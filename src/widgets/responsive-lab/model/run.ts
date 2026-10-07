import type { ResolveFn } from './types';

/**
 * Демо и тест спрашивают одну и ту же функцию — строку `RESOLVE_CODE` из темы.
 *
 * Строка напечатана на странице, собрана здесь `new Function` и сверяется
 * `tests/unit/responsive.test.ts` с настоящим Chromium: `setViewportSize` на сетке ширин
 * и `getComputedStyle`. Копии нет — разойдётся показанный код с браузером, покраснеет тест.
 *
 * Ни DOM, ни Vue: чистая функция, чтобы её мог импортировать юнит-тест.
 */
export function loadResolve(code: string): ResolveFn {
  return new Function(`${code}\nreturn resolve;`)() as ResolveFn;
}

/** Число без хвоста нулей: 16, 16.5, 17.12. */
export function fmt(n: number): string {
  return String(Math.round(n * 100) / 100);
}
