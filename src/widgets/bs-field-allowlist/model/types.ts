/** Тело запроса и что с ним сделают три способа записи. Тексты — для таблицы, поля — для теста. */
export interface FieldCase {
  label: string;
  /** JSON тела запроса — строкой, как он приходит по сети. */
  body: string;
  naive: string;
  schema: string;
  pick: string;
  /** Поля записи, которые изменились после `Object.assign` (включая унаследованные). */
  changed: Record<string, unknown>;
  /** Что пропустила схема zod; `null` — отказ (400). */
  schemaPatch: Record<string, unknown> | null;
  /** Что пропустил список имён. */
  pickPatch: Record<string, unknown>;
  tone?: 'err' | 'warn';
}

export type Profile = Record<string, unknown>;

export interface FieldCode {
  updateProfile(user: Profile, body: unknown): Profile;
  pickEditable(body: Record<string, unknown>): Profile;
}

export interface FieldRow {
  key: string;
  before: unknown;
  naive: unknown;
  /** Значение после `Object.assign` не своё, а пришло через прототип. */
  inherited: boolean;
  pick: unknown;
}
