/** Столбец глазами миграции: обязателен ли и есть ли значение по умолчанию (`IDENTITY` — тоже). */
export interface ColumnInfo {
  notNull: boolean;
  hasDefault: boolean;
}

/** Схема одной таблицы: столбец → его ограничения. Порядок ключей — порядок столбцов. */
export type Schema = Record<string, ColumnInfo>;

/**
 * Цена оператора, снятая стендом на таблице из 10 000 строк (см. шапку `data.ts` темы):
 * самый сильный режим блокировки на таблице в именах `pg_locks`, сменился ли `relfilenode`
 * и сколько раз транзакция прочла таблицу целиком.
 */
export interface StatementCost {
  lock: string;
  rewrite: boolean;
  scans: number;
}

export interface PlanStatement {
  sql: string;
  cost: StatementCost;
}

export type VersionId = 'v1' | 'v2' | 'v3';

export interface PlanStep {
  id: string;
  label: string;
  /** Что происходит на шаге. Строчная разметка. */
  text: string;
  /** Операторы миграции; пусто у шагов, где меняется только код. */
  statements: PlanStatement[];
  /** Версии, которые обслуживают запросы после шага. */
  live: VersionId[];
  /** Версия, на которую откатятся, если что-то пойдёт не так. */
  fallback?: VersionId;
  /** Схема после шага — сверяется тестом с `information_schema`. */
  schema: Schema;
}

export interface MigrationPlan {
  id: string;
  label: string;
  /** Подпись над планом. Строчная разметка. */
  note: string;
  steps: PlanStep[];
}

/** Ответ `check`: `null` — запрос выполнится; иначе код ошибки Postgres и столбец. */
export type CheckResult = { code: '42703' | '23502'; column: string } | null;

export interface Broken {
  version: VersionId;
  /** `true` — сломана не работающая версия, а версия для отката. */
  fallback: boolean;
  error: NonNullable<CheckResult>;
}

/** Функции из строки `COMPAT_CODE`. */
export interface CompatApi {
  columnsOf(sql: string, table: string): string[];
  insertedColumns(sql: string): string[] | null;
  check(schema: Schema, table: string, sql: string): CheckResult;
  stepVerdict(
    schema: Schema,
    table: string,
    versions: Record<VersionId, string[]>,
    live: VersionId[],
    fallback?: VersionId,
  ): Broken[];
}

/** Перенос пачками из строки `BACKFILL_CODE`. */
export type BackfillFn = (
  run: (sql: string, params: number[]) => Promise<number>,
  maxId: number,
  batch?: number,
) => Promise<number[]>;
