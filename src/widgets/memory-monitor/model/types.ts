/**
 * Как ведёт себя линия от серии к серии.
 *
 *   flat        поднимается и полностью возвращается — нижняя огибающая стоит на месте;
 *   rise        возвращается не до конца — огибающая ползёт вверх, это и есть утечка;
 *   rise-nofall растёт и не падает вовсе.
 */
export type Trend = 'flat' | 'rise' | 'rise-nofall';

/**
 * Комбинация трёх линий Performance monitor.
 *
 * Диагноз даёт не одна линия, а то, какие растут вместе, — поэтому пресет задаёт сразу три.
 */
export interface MonitorCombo {
  /** Подпись переключателя и заголовок комбинации. */
  label: string;
  /** Что это означает. */
  dx: string;
  tone: 'warn' | 'err';
  heap: Trend;
  dom: Trend;
  listeners: Trend;
}

/** Метрика Performance monitor: имя, цвет линии и что означает её рост. */
export interface Metric {
  key: 'heap' | 'dom' | 'listeners';
  label: string;
  what: string;
}
