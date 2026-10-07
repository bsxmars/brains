/** Сценарий демо «Учебная отмена против настоящей». Код — строка из `data.ts` темы. */
export interface AbortScenario {
  id: string;
  /** Подпись на переключателе. */
  label: string;
  /**
   * Тело async-функции с параметрами `AbortController`, `AbortSignal`, `log`, `sleep`, `track`.
   * Одна и та же строка исполняется на учебных и на настоящих классах.
   */
  code: string;
  /** Что увидеть в выводе. Строчная разметка. */
  note: string;
}

/** Пара классов, на которой исполняется сценарий. */
export interface AbortImpl {
  AbortController: unknown;
  AbortSignal: unknown;
}
