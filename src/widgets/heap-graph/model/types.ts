/** Узел графа объектов: подпись и собственный вес. Геометрию задаёт сам виджет. */
export interface HeapNode {
  /** Идентификатор для раскладки и для списка «кем доминируется». */
  id: string;
  /** Подпись как в снимке: `(closure) held`, `system / Context`. */
  label: string;
  /** Собственный вес строкой — то, что в снимке стоит в колонке Shallow. */
  shallow: string;
}

/** Строка «лестницы» retained size — та самая таблица из панели Summary. */
export interface LadderRow {
  /** Конструктор или служебная категория. */
  c: string;
  /** Отступ в дереве: сколько пробелов перед именем. */
  depth: number;
  dist: string;
  shallow: string;
  retained: string;
  /** Строка, ради которой таблица показана: красная и жирная. */
  hot?: boolean;
}

/**
 * Вариант графа: один путь к массиву или два.
 *
 * Переключение между вариантами и есть содержание раздела: retained size замыкания
 * обрушивается, хотя под ним висят те же байты, — они уезжают к общему доминатору.
 */
export interface HeapVariant {
  /** Подпись переключателя. */
  label: string;
  /** Рисовать ли второе ребро от корня прямо к массиву. */
  secondPath: boolean;
  /** Узлы, которые доминирует замыкание, — то есть освободятся при его удалении. */
  ownedByClosure: string[];
  /** Кому приписаны байты массива. */
  dominator: string;
  rows: LadderRow[];
  verdict: string;
  tone: 'ok' | 'warn';
  note: string;
}
