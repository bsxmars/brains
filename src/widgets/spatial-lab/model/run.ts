import type { QuadNode, RNode, RTree, Shape, ShapesApi, SpatialApi, SpatialCodes, Stats } from './types';

/**
 * Демо и тест спрашивают одни и те же функции — строки `*_CODE` из темы
 * «Пространственные индексы».
 *
 * Строки напечатаны на странице, собраны здесь `new Function` и прогоняются
 * `tests/unit/spatial-index.test.ts` против `rbush`, `flatbush` и полного перебора на наборах
 * с зерном. Копии нет: если показанный код разойдётся с библиотекой, покраснеет тест.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadSpatial(c: SpatialCodes): SpatialApi {
  const body = [c.brute, c.grid, c.quad, c.rtree, c.split, c.remove, c.knn].join('\n');
  return new Function(
    `${body}\nreturn { intersects, bruteSearch, buildGrid, gridSearch, createQuad, quadInsert, quadSearch, createRTree, rInsert, rSearch, quadraticSplit, rRemove, rMove, boxDist, rKnn };`,
  )() as SpatialApi;
}

export function loadShapes(code: string): ShapesApi {
  return new Function(`${code}\nreturn { mulberry32, makeShapes };`)() as ShapesApi;
}

export const emptyStats = (): Stats => ({ checks: 0, nodes: [] });

/** Корень квадродерева — квадрат 1024: поле 1000 × 1000 помещается, а стороны делятся на 2 ровно. */
export function buildQuad(api: SpatialApi, shapes: Shape[], cap: number, maxDepth: number): QuadNode {
  const root = api.createQuad(0, 0, 1024, 0);
  for (const s of shapes) api.quadInsert(root, s, cap, maxDepth);
  return root;
}

export function buildRTree(api: SpatialApi, shapes: Shape[]): RTree {
  const tree = api.createRTree();
  for (const s of shapes) api.rInsert(tree, s);
  return tree;
}

export function quadNodes(root: QuadNode): QuadNode[] {
  const out: QuadNode[] = [];
  const walk = (n: QuadNode) => {
    out.push(n);
    n.kids?.forEach(walk);
  };
  walk(root);
  return out;
}

/** Узлы R-дерева с глубиной: корень — 0. Фигуры не входят. */
export function rNodes(root: RNode): { node: RNode; depth: number }[] {
  const out: { node: RNode; depth: number }[] = [];
  const walk = (n: RNode, depth: number) => {
    out.push({ node: n, depth });
    if (!n.leaf) for (const c of n.children) walk(c as RNode, depth + 1);
  };
  walk(root, 0);
  return out;
}

/** Рамка поиска вокруг точки: стороной `side`, как курсор в таблицах темы. */
export function around(x: number, y: number, side: number) {
  return { minX: x - side / 2, minY: y - side / 2, maxX: x + side / 2, maxY: y + side / 2 };
}

/**
 * Запросы для таблиц темы: `count` рамок `w × h`, центр каждой — в центре случайной фигуры
 * набора (курсор обычно наводят туда, где что-то нарисовано). Зерно своё.
 */
export function standQueries(shapes: ShapesApi, set: Shape[], count: number, w: number, h: number, seed: number) {
  const rnd = shapes.mulberry32(seed);
  const out = [];
  for (let i = 0; i < count; i++) {
    const s = set[Math.floor(rnd() * set.length)];
    const cx = (s.minX + s.maxX) / 2;
    const cy = (s.minY + s.maxY) / 2;
    out.push({ minX: cx - w / 2, minY: cy - h / 2, maxX: cx + w / 2, maxY: cy + h / 2 });
  }
  return out;
}
