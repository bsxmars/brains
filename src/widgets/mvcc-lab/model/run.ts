import type { Level, MvccModel, Scenario, StepRecord } from './types';

/**
 * Демо и тест исполняют одну и ту же модель — строки `ENGINE_CODE`, `SNAPSHOT_CODE`,
 * `WRITE_CODE` и `SSI_CODE` из темы, склеенные и собранные `new Function`. Те же строки
 * напечатаны на странице, а `tests/unit/transactions.test.ts` сверяет ответы модели с выводом
 * двух настоящих сеансов Postgres (литерал `STAND_RUNS`) и с PGlite в одной сессии.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadModel(parts: string[]): MvccModel {
  return new Function(
    `${parts.join('\n\n')}\nreturn { runSchedule, createDb, execute, takeSnapshot, visible, CONFLICTS };`,
  )() as MvccModel;
}

/**
 * Шаг одной строкой — так же записан вывод настоящего Postgres в `STAND_RUNS`:
 * `ждал до шага N → ` (номер с единицы), затем строки `psql` через ` / ` или ошибка с кодом.
 */
export function formatStep(rec: StepRecord): string {
  const wait = rec.waited ? `ждал до шага ${(rec.until ?? -1) + 1} → ` : '';
  const body = rec.error ? `ERROR ${rec.error.code}: ${rec.error.message}` : (rec.lines ?? []).join(' / ') || '—';
  return wait + body;
}

/** Что осталось в базе: запрос `check` отдельной транзакцией после всех шагов. */
export function finalOf(model: MvccModel, sc: Scenario, level: Level): string {
  const run = model.runSchedule(structuredClone(sc.rows), [...sc.steps, { s: 'A', sql: sc.check.sql, op: sc.check.op }], level);
  return formatStep(run.out[run.out.length - 1]);
}
