/** Одна запись журнала сценария: кто писал, что, и какой id в этот момент вернул контекст. */
export interface LogEntry {
  /** Запрос, от имени которого написана строка, — правильный ответ. */
  who: string;
  what: string;
  /** Что вернул `ctx.get()`; `null` — контекст пуст. */
  seen: string | null;
}

/** Общий вид трёх реализаций в демо: глобальная переменная, `AsyncLocalStorage`, учебная обёртка. */
export interface Ctx {
  run<R>(value: string, fn: () => R): R;
  get(): string | undefined;
}

/** Учебная «переменная контекста» из `MINI_CODE` темы. */
export interface MiniApi {
  Variable: new () => { get(): string | undefined; run<R>(value: string, fn: () => R): R };
  wrap<F extends (...args: never[]) => unknown>(fn: F): F;
  install(): void;
  uninstall(): void;
}

/** Сценарий демо: код — строка из темы, исполняется с `ctx`, `log` и `sleep`. */
export interface Scenario {
  id: string;
  label: string;
  code: string;
  /** Что смотреть в этом сценарии. Строчная разметка. */
  note: string;
}

export type ModeId = 'global' | 'als' | 'mini';
