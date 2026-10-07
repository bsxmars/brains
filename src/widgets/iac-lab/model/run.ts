import type { PlannerApi } from './types';

/**
 * Демо и тест спрашивают одну и ту же функцию — строку `PLAN_CODE` из темы.
 *
 * Строка напечатана на странице, собрана здесь `new Function` и прогоняется
 * `tests/unit/infrastructure-as-code.test.ts` против планов, которые снял настоящий
 * `tofu plan` (OpenTofu 1.12.7). Копии нет: если показанный код разойдётся с OpenTofu,
 * покраснеет тест.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadPlanner(code: string): PlannerApi {
  return new Function(`${code}\nreturn { UNKNOWN, plan };`)() as PlannerApi;
}
