import type { ResolverApi } from './types';

/**
 * Демо и тест спрашивают одну и ту же функцию — строку `RESOLVE_CODE` из темы.
 *
 * Строка напечатана на странице, собрана здесь `new Function` и прогоняется
 * `tests/unit/package-publishing.test.ts` против настоящего Node (`import.meta.resolve`
 * и `require.resolve` на пакетах-фикстурах): каждый спецификатор, четыре набора условий.
 * Копии нет — разойдётся показанный код с Node, покраснеет тест.
 *
 * Ни DOM, ни Vue: чистая функция, чтобы её мог импортировать юнит-тест.
 */
export function loadResolver(code: string): ResolverApi {
  return new Function(`${code}\nreturn { resolveExports, splitSpecifier };`)() as ResolverApi;
}
