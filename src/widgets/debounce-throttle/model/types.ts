/** Поток событий: моменты вызова обёртки и предел шкалы, мс. */
export interface EventSequence {
  label: string;
  times: number[];
  max: number;
}

/** Одно фактическое срабатывание обёрнутой функции. */
export interface Fire {
  /** Момент вызова `fn`, мс. */
  t: number;
  /** Аргумент, с которым её позвали: момент события, чьи аргументы сохранены последними. */
  arg: number;
  kind: 'leading' | 'trailing';
}
