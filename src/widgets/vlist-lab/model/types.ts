/** Режим демо: как список попадает в DOM. */
export interface VlMode {
  key: 'virtual' | 'cv' | 'all';
  label: string;
  /** Режим строит все строки сразу — только по кнопке, никогда в `setup`. */
  heavy: boolean;
  /** Пояснение под демо. Строчная разметка. */
  note: string;
}

/** Окно: полуоткрытый диапазон `[start, end)` и высоты распорок. */
export interface VlRange {
  start: number;
  end: number;
  padTop: number;
  padBottom: number;
}

/** Функции из `WINDOW_CODE` — ровно те, что напечатаны в теме. */
export interface VlWindow {
  fixedRange(scrollTop: number, viewport: number, rowHeight: number, count: number, overscan: number): VlRange;
  prefixSums(heights: ArrayLike<number>): Float64Array;
  countBefore(offsets: ArrayLike<number>, y: number, orEqual: boolean): number;
  variableRange(scrollTop: number, viewport: number, offsets: ArrayLike<number>, overscan: number): VlRange;
  applyMeasured(offsets: Float64Array, index: number, height: number, scrollTop: number): number;
  withSticky(start: number, end: number, headers: number[]): number[];
}
