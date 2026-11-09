/** Точка мира в пикселях на уровне `z`: мир — квадрат `256 · 2^z`, начало — левый верхний угол. */
export interface WorldPoint {
  x: number;
  y: number;
}

/** Тайл, в который попала точка, и пиксель внутри него. */
export interface TileHit {
  z: number;
  x: number;
  y: number;
  px: number;
  py: number;
}

/** Тайл в окне: адрес `z/x/y` и где его левый верхний угол встаёт в окне. */
export interface ViewTile {
  z: number;
  x: number;
  y: number;
  left: number;
  top: number;
}

/** Точка набора: долгота и широта в градусах. */
export interface Place {
  lng: number;
  lat: number;
}

/** Метка уровня кластеров: доли мира `[0, 1]`, `count` точек; у одиночной точки `count = 1` и её номер `id`. */
export interface Mark {
  x: number;
  y: number;
  count: number;
  id?: number;
}

/** Строки темы, из которых собирается код демо. */
export interface MapCodes {
  mercator: string;
  tiles: string;
  points: string;
  cluster: string;
}

/** То, что возвращают строки темы, собранные `new Function`. */
export interface MapApi {
  TILE: number;
  R: number;
  MAX_LAT: number;
  project(lng: number, lat: number, z: number): WorldPoint;
  unproject(x: number, y: number, z: number): Place;
  tileOf(lng: number, lat: number, z: number): TileHit;
  metersPerPixel(lat: number, z: number): number;
  tilesInView(cx: number, cy: number, z: number, width: number, height: number): ViewTile[];
  tileUrl(template: string, t: { z: number; x: number; y: number }): string;
  mulberry32(seed: number): () => number;
  makePlaces(n: number, seed: number): Place[];
  buildClusters(points: Place[], radius?: number, maxZoom?: number): Record<number, Mark[]>;
}
