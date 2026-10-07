/** Размер работы: сколько элементов обрабатываем. */
export interface YieldSize {
  key: string;
  label: string;
  items: number;
}

/** Как часто уступать: на каждом элементе или по бюджету времени. */
export interface YieldStrategy {
  key: 'each' | 'budget';
  label: string;
}

/**
 * Чем уступать.
 *
 * `cost` — модельная цена одной уступки в миллисекундах. Это не замер, а порядок величины:
 * у `setTimeout` в глубокой вложенности он задан спекой (кламп), у остальных — оценка.
 */
export interface YieldTool {
  key: string;
  label: string;
  cost: number;
  /** Чем этот инструмент хорош — подставляется в вердикт калькулятора. */
  note: string;
}
