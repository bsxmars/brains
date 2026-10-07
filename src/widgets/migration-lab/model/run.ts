import type { BackfillFn, CompatApi } from './types';

/**
 * Демо и тест спрашивают одни и те же функции — строки `COMPAT_CODE` и `BACKFILL_CODE` из темы.
 *
 * Строки напечатаны на странице, собраны здесь `new Function` и прогоняются
 * `tests/unit/db-migrations.test.ts` против настоящего Postgres (PGlite): вердикт `check`
 * сверяется с кодом ошибки, который Postgres вернул на тот же запрос, а `backfill` переносит
 * данные в настоящей таблице. Копии нет — разойдётся показанный код с базой, покраснеет тест.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadCompat(code: string): CompatApi {
  return new Function(`${code}\nreturn { columnsOf, insertedColumns, check, stepVerdict };`)() as CompatApi;
}

export function loadBackfill(code: string): BackfillFn {
  return new Function(`${code}\nreturn backfill;`)() as BackfillFn;
}
