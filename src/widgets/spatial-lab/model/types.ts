/** Прямоугольник в координатах поля 1000 × 1000. У точки `min` и `max` совпадают. */
export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Фигура набора: прямоугольник с номером. Тот же вид, что ждут `rbush` и учебные функции. */
export interface Shape extends Box {
  id: number;
}

export type Layout = 'uniform' | 'clusters' | 'pile';

/** Счётчики запроса: каждая проверка `intersects` и каждый открытый узел (у сетки — клетка). */
export interface Stats {
  checks: number;
  nodes: Box[];
}

export interface Grid {
  cell: number;
  cols: number;
  at(v: number): number;
  buckets: Shape[][];
}

export interface QuadNode extends Box {
  size: number;
  depth: number;
  points: Shape[];
  kids: QuadNode[] | null;
}

export interface RNode extends Box {
  leaf: boolean;
  children: (RNode | Shape)[];
}

export interface RTree {
  root: RNode;
}

export interface Neighbor {
  id: number;
  /** Квадрат расстояния до прямоугольника фигуры. */
  dist: number;
}

/** Строки темы, из которых собирается учебный код. */
export interface SpatialCodes {
  brute: string;
  grid: string;
  quad: string;
  rtree: string;
  split: string;
  remove: string;
  knn: string;
}

export interface SpatialApi {
  intersects(a: Box, b: Box): boolean;
  bruteSearch(shapes: Shape[], box: Box, stats: Stats): number[];
  buildGrid(shapes: Shape[], cell: number): Grid;
  gridSearch(grid: Grid, box: Box, stats: Stats): number[];
  createQuad(minX: number, minY: number, size: number, depth: number): QuadNode;
  quadInsert(node: QuadNode, p: Shape, cap: number, maxDepth: number): void;
  quadSearch(node: QuadNode, box: Box, found: number[], stats: Stats): number[];
  createRTree(): RTree;
  rInsert(tree: RTree, item: Shape): void;
  rSearch(node: RNode, box: Box, found: number[], stats: Stats): number[];
  quadraticSplit(node: RNode): [RNode, RNode];
  rRemove(tree: RTree, item: Shape): boolean;
  rMove(tree: RTree, item: Shape, dx: number, dy: number): void;
  boxDist(x: number, y: number, b: Box): number;
  rKnn(tree: RTree, x: number, y: number, k: number, stats: Stats): Neighbor[];
}

export interface ShapesApi {
  mulberry32(seed: number): () => number;
  makeShapes(n: number, seed: number, layout: Layout, size: number): Shape[];
}

/** Параметры стенда, общие для демо, теста и таблиц темы. */
export interface SpatialSetup {
  seed: number;
  /** Сторона клетки сетки. */
  cell: number;
  /** Ёмкость листа квадродерева и предел глубины. */
  cap: number;
  maxDepth: number;
}
