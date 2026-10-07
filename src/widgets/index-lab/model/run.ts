import type { BtreeApi, PlannerFn } from './types';

/**
 * Демо и тест спрашивают одни и те же функции — строки `BTREE_CODE` и `PLANNER_CODE` из темы.
 *
 * Строки напечатаны на странице, собраны здесь `new Function` и прогоняются
 * `tests/unit/indexes.test.ts` против настоящего Postgres (PGlite): дерево — против
 * `pageinspect` и SQL на тех же данных, модель стоимости — против цен и выбора `EXPLAIN`.
 * Копии нет — разойдётся показанный код с базой, покраснеет тест.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadBtree(code: string): BtreeApi {
  return new Function(`${code}\nreturn { createTree, insert, search, range };`)() as BtreeApi;
}

export function loadPlanner(code: string): PlannerFn {
  return new Function(`${code}\nreturn planCosts;`)() as PlannerFn;
}
