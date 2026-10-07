/**
 * Шаг сценария — одна строка его кода: `[операция, аргумент?, уточнение?]`.
 *
 * Операции: `tx` (создать транзакцию), `store` (`objectStore`), `put` / `add` / `get` (запрос;
 * уточнение `'await'` — строка ждёт его результат), `onerror` (обработчик ошибки последнего
 * запроса с `preventDefault`), `commit`, `log`, `micro` (`await` готового промиса),
 * `timeout` (`await` таймера), `net` (`await fetch`).
 */
export type TxStep = [string, (string | number)?, string?];

/** Строка журнала модели: что произошло, где и в каком состоянии осталась транзакция. */
export interface TxTraceEntry {
  /** Номер строки кода с нуля; `null` — событие не из кода сценария (задача базы, фиксация). */
  line: number | null;
  /** `задача: …` или `микрозадача`. */
  where: string;
  what: string;
  /** `active`, `inactive`, `committing`, `finished` или `—`, пока транзакции нет. */
  state: string;
  /** Запросы, которые ещё не получили результат: исполняемый первым. */
  queue: string[];
}

export interface TxResult {
  log: string[];
  trace: TxTraceEntry[];
}

/** Сценарий для обвязки `runTx`: те же поля, что у строки `TX_HARNESS_CODE`. */
export interface TxScenarioCode {
  id: string;
  initial: number[];
  code: string;
}

export interface TxScenario extends TxScenarioCode {
  label: string;
  steps: TxStep[];
  /** Журнал Chromium со стенда — литерал. */
  chromium: string[];
  /** Что здесь происходит. Строчная разметка. */
  note: string;
}

export type SimulateTransaction = (steps: TxStep[], initial: number[]) => TxResult;
export type RunTx = (
  indexedDB: IDBFactory,
  scenario: TxScenarioCode,
  fetch: (url: string) => Promise<{ status: number }>,
) => Promise<string[]>;
