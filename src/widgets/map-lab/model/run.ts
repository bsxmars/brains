import type { MapApi, MapCodes, Mark, ViewTile } from './types';

/**
 * Демо и тест спрашивают одни и те же функции — строки `*_CODE` из темы «Карты в интерфейсе».
 *
 * Строки напечатаны на странице, собраны здесь `new Function` и прогоняются
 * `tests/unit/maps.test.ts` против `@math.gl/web-mercator` (проекция, границы окна) и
 * `supercluster` (кластеры). Копии нет: если показанный код разойдётся с библиотекой,
 * покраснеет тест.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadMaps(c: MapCodes): MapApi {
  const body = [c.mercator, c.tiles, c.points, c.cluster].join('\n');
  return new Function(
    `${body}\nreturn { TILE, R, MAX_LAT, project, unproject, tileOf, metersPerPixel, tilesInView, tileUrl, mulberry32, makePlaces, buildClusters };`,
  )() as MapApi;
}

export const tileKey = (t: { z: number; x: number; y: number }) => `${t.z}/${t.x}/${t.y}`;

/** Сколько разных адресов среди тайлов окна: на мелком масштабе один тайл виден в окне несколько раз. */
export const uniqueRequests = (tiles: ViewTile[]) => new Set(tiles.map(tileKey)).size;

/** Адреса из `next`, которых не было в `prev`: столько запросов уйдёт после жеста, если старые тайлы ещё в памяти. */
export function freshTiles(prev: ViewTile[], next: ViewTile[]): string[] {
  const had = new Set(prev.map(tileKey));
  return [...new Set(next.map(tileKey))].filter((k) => !had.has(k));
}

/** Окно в долях мира `[0, 1]`: центр (`cx`, `cy`) — пиксели мира на уровне `z`. */
export function viewBox(tile: number, cx: number, cy: number, z: number, width: number, height: number) {
  const size = tile * 2 ** z;
  return {
    minX: (cx - width / 2) / size,
    minY: (cy - height / 2) / size,
    maxX: (cx + width / 2) / size,
    maxY: (cy + height / 2) / size,
  };
}

/**
 * Метки уровня `z`, попавшие в окно. Как `getClusters` у supercluster: дробный zoom
 * округляется вниз, выше `maxZoom` — точки без кластеров (уровень `maxZoom + 1`).
 */
export function marksInView(
  levels: Record<number, Mark[]>,
  z: number,
  box: { minX: number; minY: number; maxX: number; maxY: number },
): Mark[] {
  const top = Math.max(...Object.keys(levels).map(Number));
  const level = levels[Math.max(0, Math.min(Math.floor(z), top))];
  return level.filter((m) => m.x >= box.minX && m.x <= box.maxX && m.y >= box.minY && m.y <= box.maxY);
}
