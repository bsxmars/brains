/**
 * Режим нарезки работы на шкале времени.
 *
 * `chunk` в миллисекундах; `null` — не уступать вовсе, вся работа одной задачей.
 */
export interface TimelineMode {
  key: string;
  label: string;
  chunk: number | null;
  tone: 'ok' | 'warn' | 'err';
  /** Вывод, который показывается под шкалой в этом режиме. */
  note: string;
}

/** Момент, когда пользователь нажал на кнопку, мс от начала работы. */
export interface TimelineClick {
  at: number;
  label: string;
}
