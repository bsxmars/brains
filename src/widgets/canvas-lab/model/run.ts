import type { DrawSpinner, LineKind, ProbeFn, RasterApi } from './types';

/**
 * Демо и тест спрашивают одни и те же функции — строки `RASTER_CODE`, `PROBE_CODE`
 * и `SPINNER_WORKER_CODE` из темы «Canvas 2D и OffscreenCanvas».
 *
 * Строки напечатаны на странице и собраны здесь `new Function`. `tests/unit/canvas.test.ts`
 * сверяет `rasterColumns` с альфой, которую Chromium дал на стенде, и исполняет `PROBE_CODE`
 * в Chromium заново. Копии нет: разойдётся показанный код с движком — покраснеет тест.
 *
 * `loadRaster` — чистые функции без DOM. `loadProbe` и `loadSpinner` возвращают функции,
 * которым нужен браузер, но сами по себе ничего не исполняют: их зовут из `onMounted`
 * или по нажатию.
 */
export function loadRaster(code: string): RasterApi {
  return new Function(`${code}\nreturn { coverage, band, rasterColumns, bufferSize, crispX };`)() as RasterApi;
}

export function loadProbe(code: string): ProbeFn {
  return new Function(`${code}\nreturn probeColumns;`)() as ProbeFn;
}

/** Из файла воркера берётся только `drawSpinner`: `self.onmessage` вне воркера не нужен. */
export function loadSpinner(workerCode: string): DrawSpinner {
  const self = {};
  return new Function('self', `${workerCode}\nreturn drawSpinner;`)(self) as DrawSpinner;
}

/** Совпадение двух рядов альфы с допуском на округление половин. */
export function sameColumns(a: number[], b: number[], tolerance = 1): boolean {
  return a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tolerance);
}

/** Ключ `STAND_COLUMNS`: `вид:масштаб:x:толщина`. */
export const columnsKey = (kind: LineKind, scale: number, x: number, width: number) =>
  `${kind}:${scale}:${x}:${width}`;
