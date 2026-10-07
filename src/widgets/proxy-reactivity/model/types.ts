/** Сценарий демо: код над `reactive`/`effect`/`log` и что он должен напечатать. */
export interface ReactiveScenario {
  id: string;
  label: string;
  /** Тело сценария; видит `reactive`, `effect` и `log`. */
  code: string;
  /** Вывод эффектов с `Reflect.get(…, receiver)` — у мини-версии и у Vue он одинаков. */
  out: string[];
  /** Вывод мини-версии, где receiver потерян (`target[key]`). */
  lost: string[];
  /** Подпись: что увидеть и почему. Строчная разметка. */
  note: string;
}

/** Две функции, которых сценарию достаточно, — у мини-версии и у Vue одни и те же имена. */
export interface ReactiveApi {
  reactive<T extends object>(target: T): T;
  effect(fn: () => void): unknown;
}

/** Строка журнала: служебная запись мини-версии (`track`/`trigger`) или вывод эффекта. */
export interface JournalLine {
  kind: 'trace' | 'out';
  text: string;
}
