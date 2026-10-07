/**
 * Состояние генератора.
 *
 *   0 — suspended-start: объект создан, тело не выполнялось ни строчки;
 *   1 — suspended на первом `yield`;
 *   2 — suspended на втором `yield`;
 *   3 — completed: закрыт навсегда, что бы ему теперь ни звали.
 */
export type GenPhase = 0 | 1 | 2 | 3;

/** Строка журнала: что вызвали, что вернулось и почему именно это. */
export interface GenLogEntry {
  call: string;
  res: string;
  note: string;
  tone?: 'warn' | 'err';
}

/** Машина целиком: где стоим, что запомнили из `next(v)` и что уже успели вызвать. */
export interface GenMachine {
  phase: GenPhase;
  /** Имя, пришедшее аргументом второго `next` — им резолвится первый `yield`. */
  name: string | null;
  log: GenLogEntry[];
}
