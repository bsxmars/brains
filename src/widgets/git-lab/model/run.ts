import type { GitApi } from './types';

/**
 * Демо и тест спрашивают одни и те же функции — строку `GIT_CODE` из темы.
 *
 * Строка напечатана на странице, собрана здесь `new Function` и прогоняется
 * `tests/unit/git-internals.test.ts` против настоящего git и `isomorphic-git`. Копии нет —
 * если показанный код разойдётся с git, покраснеет тест.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadGit(code: string): GitApi {
  return new Function(`${code}\nreturn { hashObject, writeTree, commitText, ancestors, mergeBase, mergeIndex };`)() as GitApi;
}
