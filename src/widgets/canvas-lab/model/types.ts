/** Вид полосы: обводка линии пути или `fillRect`. */
export type LineKind = 'stroke' | 'fill';

/** Альфа ряда пикселей буфера, снятая в Chromium. Ключ — `вид:масштаб:x:толщина`. */
export type ColumnsStand = Record<string, number[]>;

/** Варианты, которые снял стенд и между которыми переключается демо. */
export interface LineCase {
  kinds: { value: LineKind; label: string }[];
  xs: number[];
  widths: number[];
  scales: number[];
}

/** Функции строки `RASTER_CODE` из темы. */
export interface RasterApi {
  coverage(a: number, b: number, i: number): number;
  band(kind: LineKind, x: number, width: number): [number, number];
  rasterColumns(kind: LineKind, x: number, width: number, scale: number, cols?: number): number[];
  bufferSize(cssWidth: number, cssHeight: number, dpr: number): { width: number; height: number };
  crispX(x: number, width: number, scale: number): number;
}

/** Функция строки `PROBE_CODE`: рисует в браузере и читает альфу ряда. */
export type ProbeFn = (kind: LineKind, x: number, width: number, scale: number, cols?: number) => number[];

/** Функция из строки `SPINNER_WORKER_CODE`. */
export type DrawSpinner = (
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  frame: number,
  color: string,
) => void;

