import Flatbush from 'flatbush';
import RBush from 'rbush';
import { describe, expect, it } from 'vitest';
import * as t from '@/content/algorithms/spatial-index/data';
import {
  buildQuad,
  buildRTree,
  emptyStats,
  loadShapes,
  loadSpatial,
  quadNodes,
  rNodes,
  standQueries,
} from '@/widgets/spatial-lab/model/run';
import type { Box, Layout, RNode, Shape } from '@/widgets/spatial-lab/model/types';

/**
 * Тема «Пространственные индексы: quadtree и R-tree».
 *
 * `*_CODE` — строки из темы: напечатаны на странице и исполняются демо. Здесь они сверяются
 * с `rbush` 4 и `flatbush` 4 и с полным перебором на наборах с зерном: множества найденных id
 * и расстояния ближайших совпадают. Числа таблиц (`COST_ROWS`, `TREE_ROWS`, …) пересчитываются
 * теми же функциями — это счёт проверок и узлов, не время, поэтому он повторяется дословно.
 */

const api = loadSpatial({
  brute: t.BRUTE_CODE,
  grid: t.GRID_CODE,
  quad: t.QUAD_CODE,
  rtree: t.RTREE_CODE,
  split: t.SPLIT_CODE,
  remove: t.REMOVE_CODE,
  knn: t.KNN_CODE,
});
const gen = loadShapes(t.SHAPES_CODE);
const { seed, cell, cap, maxDepth } = t.SETUP;
const Q = t.QUERIES;

const LAYOUT: Record<string, Layout> = { равномерно: 'uniform', сгустки: 'clusters' };
const sortNum = (a: number[]) => [...a].sort((x, y) => x - y);

function flat(shapes: Shape[], nodeSize = 16) {
  const f = new Flatbush(shapes.length, nodeSize);
  for (const s of shapes) f.add(s.minX, s.minY, s.maxX, s.maxY);
  f.finish();
  return f;
}

/** Узлы, которые открывает `flatbush.search`: повтор его обхода со счётчиком (без быстрого сбора «целиком внутри»). */
function flatVisits(f: Flatbush, b: Box) {
  const { _boxes: boxes, _levelBounds: lb, _indices: idx, nodeSize } = f as unknown as {
    _boxes: Float64Array;
    _levelBounds: number[];
    _indices: Uint16Array | Uint32Array;
    nodeSize: number;
  };
  const n4 = f.numItems * 4;
  let nodeIndex: number | undefined = boxes.length - 4;
  let level = lb.length - 1;
  let opened = 0;
  let checks = 0;
  const q: number[] = [];
  while (nodeIndex !== undefined) {
    opened++;
    const end = Math.min(nodeIndex + nodeSize * 4, lb[level]);
    const isNode = nodeIndex >= n4;
    for (let pos = nodeIndex; pos < end; pos += 4) {
      checks++;
      if (b.maxX < boxes[pos] || b.maxY < boxes[pos + 1] || b.minX > boxes[pos + 2] || b.minY > boxes[pos + 3]) continue;
      if (isNode) q.push(idx[pos >> 2], level - 1);
    }
    level = q.pop() as number;
    nodeIndex = q.pop();
  }
  return { opened, checks };
}

/** Средние проверки и узлы на запрос, округлённые так же, как в таблицах темы. */
function average(qs: Box[], run: (q: Box, s: ReturnType<typeof emptyStats>) => number[]) {
  let checks = 0;
  let nodes = 0;
  let found = 0;
  for (const q of qs) {
    const s = emptyStats();
    found += run(q, s).length;
    checks += s.checks;
    nodes += s.nodes.length;
  }
  return { checks: Math.round(checks / qs.length), nodes: nodes / qs.length, found: Math.round(found / qs.length) };
}

describe('поиск рамкой: учебные функции, rbush, flatbush и перебор находят одно и то же', () => {
  const cases: [Layout, number][] = [
    ['uniform', 0],
    ['clusters', 0],
    ['pile', 0],
    ['uniform', 30],
    ['clusters', 30],
  ];
  for (const [layout, size] of cases) {
    it(`${layout}, ${size ? 'прямоугольники' : 'точки'}`, () => {
      for (const sd of [1, 2]) {
        const shapes = gen.makeShapes(2000, sd, layout, size);
        const grid = api.buildGrid(shapes, cell);
        const quad = size ? null : buildQuad(api, shapes, cap, maxDepth);
        const tree = buildRTree(api, shapes);
        const loaded = new RBush<Shape>().load(shapes);
        const inserted = new RBush<Shape>();
        for (const s of shapes) inserted.insert(s);
        const fb = flat(shapes);
        const qs = [
          ...standQueries(gen, shapes, 60, Q.cursor, Q.cursor, sd + 10),
          ...standQueries(gen, shapes, 60, Q.frameW, Q.frameH, sd + 20),
        ];
        for (const q of qs) {
          const brute = sortNum(api.bruteSearch(shapes, q, emptyStats()));
          expect(sortNum(api.gridSearch(grid, q, emptyStats()))).toEqual(brute);
          if (quad) expect(sortNum(api.quadSearch(quad, q, [], emptyStats()))).toEqual(brute);
          expect(sortNum(api.rSearch(tree.root, q, [], emptyStats()))).toEqual(brute);
          expect(sortNum(loaded.search(q).map((s) => s.id))).toEqual(brute);
          expect(sortNum(inserted.search(q).map((s) => s.id))).toEqual(brute);
          expect(sortNum(fb.search(q.minX, q.minY, q.maxX, q.maxY).map((i) => shapes[i].id))).toEqual(brute);
          // учебный обход над деревом rbush: формат узлов тот же
          expect(sortNum(api.rSearch(loaded.toJSON() as RNode, q, [], emptyStats()))).toEqual(brute);
        }
      }
    });
  }

  it('у учебного R-дерева все листья на одной глубине и не больше M детей в узле', () => {
    const tree = buildRTree(api, gen.makeShapes(5000, seed, 'clusters', 20));
    const nodes = rNodes(tree.root);
    const leafDepths = new Set(nodes.filter((n) => n.node.leaf).map((n) => n.depth));
    expect(leafDepths.size).toBe(1);
    expect(Math.max(...nodes.map((n) => n.node.children.length))).toBeLessThanOrEqual(9);
    // MBR узла накрывает всех детей
    for (const { node } of nodes) {
      for (const c of node.children) {
        expect(node.minX <= c.minX && node.minY <= c.minY && c.maxX <= node.maxX && c.maxY <= node.maxY).toBe(true);
      }
    }
  });
});

describe('k ближайших: rKnn против flatbush.neighbors и полной сортировки', () => {
  for (const [layout, size] of [['uniform', 0], ['clusters', 0], ['uniform', 30], ['pile', 0]] as [Layout, number][]) {
    it(`${layout}, ${size ? 'прямоугольники' : 'точки'}`, () => {
      const shapes = gen.makeShapes(3000, 3, layout, size);
      const tree = buildRTree(api, shapes);
      const fb = flat(shapes);
      const rnd = gen.mulberry32(99);
      for (let i = 0; i < 60; i++) {
        const x = rnd() * 1000;
        const y = rnd() * 1000;
        const all = shapes.map((s) => api.boxDist(x, y, s)).sort((a, b) => a - b).slice(0, 7);
        const mine = api.rKnn(tree, x, y, 7, emptyStats());
        expect(mine.map((f) => f.dist)).toEqual(all);
        // расстояние в ответе — настоящее расстояние до найденной фигуры
        for (const f of mine) expect(api.boxDist(x, y, shapes[f.id])).toBe(f.dist);
        expect(fb.neighbors(x, y, 7).map((id) => api.boxDist(x, y, shapes[id]))).toEqual(all);
      }
    });
  }
});

describe('таблицы темы пересчитываются', () => {
  const cache = new Map<string, ReturnType<typeof buildAll>>();
  function buildAll(layout: Layout, n: number) {
    const shapes = gen.makeShapes(n, seed, layout, 0);
    return {
      shapes,
      grid: api.buildGrid(shapes, cell),
      quad: buildQuad(api, shapes, cap, maxDepth),
      tree: buildRTree(api, shapes),
      loaded: new RBush<Shape>().load(shapes),
    };
  }
  const get = (layout: Layout, n: number) => {
    const key = `${layout}:${n}`;
    if (!cache.has(key)) cache.set(key, buildAll(layout, n));
    return cache.get(key)!;
  };
  function row(layout: Layout, n: number, w: number, h: number) {
    const b = get(layout, n);
    const qs = standQueries(gen, b.shapes, Q.count, w, h, Q.seed);
    return {
      n,
      brute: average(qs, (q, s) => api.bruteSearch(b.shapes, q, s)).checks,
      grid: average(qs, (q, s) => api.gridSearch(b.grid, q, s)).checks,
      quad: average(qs, (q, s) => api.quadSearch(b.quad, q, [], s)).checks,
      rtree: average(qs, (q, s) => api.rSearch(b.tree.root, q, [], s)).checks,
      rbush: average(qs, (q, s) => api.rSearch(b.loaded.toJSON() as RNode, q, [], s)).checks,
      found: average(qs, (q, s) => api.bruteSearch(b.shapes, q, s)).found,
    };
  }

  it('COST_ROWS — курсор 8 × 8', () => {
    for (const r of t.COST_ROWS) {
      expect({ layout: r.layout, ...row(LAYOUT[r.layout], r.n, Q.cursor, Q.cursor) }).toEqual(r);
    }
  }, 120_000);

  it('FRAME_ROWS — рамка 200 × 150', () => {
    for (const r of t.FRAME_ROWS) {
      expect({ layout: r.layout, ...row(LAYOUT[r.layout], r.n, Q.frameW, Q.frameH) }).toEqual(r);
    }
  }, 120_000);

  it('COST_NOTE и FRAME_NOTE называют числа из таблиц', () => {
    const u100 = t.COST_ROWS.find((r) => r.layout === 'равномерно' && r.n === 100000)!;
    const c100 = t.COST_ROWS.find((r) => r.layout === 'сгустки' && r.n === 100000)!;
    expect(t.COST_NOTE).toContain(`делает ${u100.quad} проверки, rbush — ${u100.rbush}`);
    expect(t.COST_NOTE).toContain(`${c100.grid.toLocaleString('ru-RU').replace(/\s/g, ' ')} проверок против ${c100.quad}`);
    expect(t.FRAME_NOTE).toContain('16 727');
    expect(t.FRAME_ROWS.at(-1)!.found).toBe(16727);
  });

  it('GRID_ROWS — сетка 400 клеток на 10 000 точек', () => {
    for (const r of t.GRID_ROWS) {
      const b = get(LAYOUT[r.layout], 10000);
      const sizes = b.grid.buckets.map((x) => x.length);
      expect(sizes.length).toBe(400);
      const cursor = t.COST_ROWS.find((c) => c.layout === r.layout && c.n === 10000)!.grid;
      expect({ layout: r.layout, empty: sizes.filter((x) => !x).length, max: Math.max(...sizes), cursor }).toEqual(r);
    }
  });

  it('GRID_RECT_ROWS — записей в списках у прямоугольников', () => {
    for (const r of t.GRID_RECT_ROWS) {
      const g = api.buildGrid(gen.makeShapes(10000, seed, 'uniform', r.size), cell);
      expect(g.buckets.reduce((s, b) => s + b.length, 0)).toBe(r.entries);
    }
  });

  it('QUAD_SHAPE — узлы и глубина квадродерева', () => {
    for (const r of t.QUAD_SHAPE) {
      const nodes = quadNodes(get(LAYOUT[r.layout], 10000).quad);
      expect({ layout: r.layout, nodes: nodes.length, depth: Math.max(...nodes.map((n) => n.depth)) }).toEqual(r);
    }
  });

  it('PILE_ROWS — стопка одинаковых точек и предел глубины', () => {
    const shapes = gen.makeShapes(2000, seed, 'pile', 0);
    for (const r of t.PILE_ROWS) {
      const root = buildQuad(api, shapes, cap, r.maxDepth);
      const nodes = quadNodes(root);
      const s = emptyStats();
      const found = api.quadSearch(root, { minX: 505, minY: 505, maxX: 511, maxY: 511 }, [], s);
      expect(found).toEqual([]);
      expect({
        maxDepth: r.maxDepth,
        nodes: nodes.length,
        leaf: Math.max(...nodes.filter((n) => !n.kids).map((n) => n.points.length)),
        near: s.checks,
      }).toEqual(r);
    }
  });

  it('без предела глубины стопка роняет вставку с RangeError', () => {
    const shapes = gen.makeShapes(2000, seed, 'pile', 0);
    expect(() => buildQuad(api, shapes, cap, Infinity)).toThrow(RangeError);
    expect(t.PILE_NOTE).toContain('RangeError: Maximum call stack size exceeded');
  });

  it('TREE_ROWS — форма деревьев и цена рамки на 10 000 фигур', () => {
    const overlap = (root: RNode) => {
      let sum = 0;
      for (const { node } of rNodes(root)) {
        if (node.leaf) continue;
        const ch = node.children;
        for (let i = 0; i < ch.length; i++) {
          for (let j = i + 1; j < ch.length; j++) {
            const a = ch[i];
            const b = ch[j];
            sum += Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX)) * Math.max(0, Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY));
          }
        }
      }
      const v = sum / 1e6;
      return v === 0 ? '0' : v.toFixed(2).replace('.', ',');
    };
    const stats = (root: RNode, qs: Box[]) => {
      const a = average(qs, (q, s) => api.rSearch(root, q, [], s));
      return {
        overlap: overlap(root),
        leaves: rNodes(root).filter((n) => n.node.leaf).length,
        nodes: Math.round(a.nodes * 10) / 10,
        checks: a.checks,
      };
    };
    for (const [set, size] of [['точки', 0], ['прямоугольники', 20]] as const) {
      const shapes = gen.makeShapes(10000, seed, 'uniform', size);
      const qs = standQueries(gen, shapes, Q.count, Q.frameW, Q.frameH, Q.seed);
      const mine = buildRTree(api, shapes).root;
      const ins = new RBush<Shape>();
      for (const s of shapes) ins.insert(s);
      const load = new RBush<Shape>().load(shapes);
      const fb = flat(shapes);
      let opened = 0;
      let checks = 0;
      for (const q of qs) {
        const v = flatVisits(fb, q);
        opened += v.opened;
        checks += v.checks;
      }
      const got = [
        { set, tree: 'учебное: вставка, квадратичное', ...stats(mine, qs) },
        { set, tree: 'rbush: insert, разбиение R*', ...stats(ins.toJSON() as RNode, qs) },
        { set, tree: 'rbush: load, OMT', ...stats(load.toJSON() as RNode, qs) },
        {
          set,
          tree: 'flatbush: Гильберт',
          overlap: '—',
          leaves: Math.ceil(10000 / 16),
          nodes: Math.round((opened / qs.length) * 10) / 10,
          checks: Math.round(checks / qs.length),
        },
      ];
      expect(got).toEqual(t.TREE_ROWS.filter((r) => r.set === set));
      // flatbush.search находит то же, что и повтор его обхода не теряет узлов
      for (const q of qs.slice(0, 20)) {
        expect(sortNum(fb.search(q.minX, q.minY, q.maxX, q.maxY))).toEqual(sortNum(api.bruteSearch(shapes, q, emptyStats())));
      }
    }
  }, 60_000);

  it('TREE_NOTE: курсор над сотней тысяч точек — учебное дерево против rbush.load', () => {
    const r = t.COST_ROWS.find((c) => c.layout === 'равномерно' && c.n === 100000)!;
    expect(t.TREE_NOTE).toContain(`делает ${r.rtree} проверок, упакованное rbush — ${r.rbush}`);
  });

  it('HEIGHT_ROWS — уровни rbush.load и flatbush, вес буфера', () => {
    for (const r of t.HEIGHT_ROWS) {
      const shapes = gen.makeShapes(r.n, seed, 'uniform', 0);
      const rb = new RBush<Shape>().load(shapes);
      const fb = flat(shapes);
      const levels = (fb as unknown as { _levelBounds: number[] })._levelBounds.length - 1;
      expect({ n: r.n, rbush: (rb.toJSON() as { height: number }).height, flat: levels, bytes: fb.data.byteLength }).toEqual(r);
    }
  }, 60_000);

  it('KNN_ROWS — проверки поиска пяти ближайших', () => {
    for (const r of t.KNN_ROWS) {
      const b = get(LAYOUT[r.layout], 10000);
      const rnd = gen.mulberry32(5);
      let checks = 0;
      let nodes = 0;
      for (let i = 0; i < 200; i++) {
        const s = emptyStats();
        api.rKnn(b.tree, rnd() * 1000, rnd() * 1000, 5, s);
        checks += s.checks;
        nodes += s.nodes.length;
      }
      expect({ layout: r.layout, checks: Math.round(checks / 200), nodes: Math.round(nodes / 200), brute: b.shapes.length }).toEqual(r);
    }
  });

  it('COLLIDE_ROWS — пары каждый с каждым против R-дерева', () => {
    for (const r of t.COLLIDE_ROWS) {
      const shapes = gen.makeShapes(r.n, seed, 'uniform', 20);
      const tree = buildRTree(api, shapes);
      let checks = 0;
      let pairs = 0;
      for (const s of shapes) {
        const st = emptyStats();
        pairs += api.rSearch(tree.root, s, [], st).filter((id) => id > s.id).length;
        checks += st.checks;
      }
      let brutePairs = 0;
      for (let i = 0; i < shapes.length; i++) {
        for (let j = i + 1; j < shapes.length; j++) if (api.intersects(shapes[i], shapes[j])) brutePairs++;
      }
      expect(brutePairs).toBe(pairs);
      expect({ n: r.n, pairs, brute: (r.n * (r.n - 1)) / 2, tree: checks }).toEqual(r);
    }
    expect(t.COLLIDE_NOTE).toContain(`в ${Math.round(t.COLLIDE_ROWS[0].brute / t.COLLIDE_ROWS[0].tree)} и в ${Math.round(t.COLLIDE_ROWS[1].brute / t.COLLIDE_ROWS[1].tree)} раза`);
  }, 60_000);
});

describe('удаление, движение и тонкие места', () => {
  it('rMove сдвигает фигуры, и дерево остаётся согласным с перебором', () => {
    const shapes = gen.makeShapes(1000, seed, 'uniform', 20);
    const tree = buildRTree(api, shapes);
    const rnd = gen.mulberry32(3);
    for (let i = 0; i < 300; i++) api.rMove(tree, shapes[i], rnd() * 40 - 20, rnd() * 40 - 20);
    for (const q of standQueries(gen, shapes, 100, Q.frameW, Q.frameH, 9)) {
      expect(sortNum(api.rSearch(tree.root, q, [], emptyStats()))).toEqual(sortNum(api.bruteSearch(shapes, q, emptyStats())));
    }
    // удалить всё по одной — дерево пустое, вставка снова работает
    for (const s of shapes) expect(api.rRemove(tree, s)).toBe(true);
    expect(api.rSearch(tree.root, { minX: -1e9, minY: -1e9, maxX: 1e9, maxY: 1e9 }, [], emptyStats())).toEqual([]);
    api.rInsert(tree, shapes[0]);
    expect(api.rSearch(tree.root, shapes[0], [], emptyStats())).toEqual([0]);
  });

  it('сдвинули до удаления: фигура остаётся в дереве и не находится нигде (rbush и учебное)', () => {
    const shapes = gen.makeShapes(1000, seed, 'uniform', 20);
    const rb = new RBush<Shape>().load(shapes);
    const tree = buildRTree(api, shapes);
    const s = shapes[0];
    const old = { ...s };
    s.minX += 300;
    s.maxX += 300;
    rb.remove(s);
    expect(rb.all().length).toBe(1000);
    expect(api.rRemove(tree, s)).toBe(false);
    expect(rb.search(old).includes(s)).toBe(false);
    expect(rb.search(s).includes(s)).toBe(false);
    expect(api.rSearch(tree.root, old, [], emptyStats()).includes(s.id)).toBe(false);
    expect(api.rSearch(tree.root, s, [], emptyStats()).includes(s.id)).toBe(false);
    expect(t.PITFALLS[0].d).toContain('на 300 пикселей');
  });

  it('rbush.remove по копии не удаляет, с функцией сравнения — удаляет', () => {
    const shapes = gen.makeShapes(1000, seed, 'uniform', 20);
    const rb = new RBush<Shape>().load(shapes);
    rb.remove({ ...shapes[0] });
    expect(rb.all().length).toBe(1000);
    rb.remove({ ...shapes[0] }, (a, b) => a.id === b.id);
    expect(rb.all().length).toBe(999);
    expect(api.rRemove(buildRTree(api, shapes), { ...shapes[0] })).toBe(false);
  });

  it('касание краем считается пересечением у rbush, flatbush и учебного intersects', () => {
    const box = { id: 1, minX: 10, minY: 10, maxX: 20, maxY: 20 };
    const touch = { minX: 20, minY: 20, maxX: 30, maxY: 30 };
    const rb = new RBush<typeof box>();
    rb.insert(box);
    const fb = new Flatbush(1);
    fb.add(10, 10, 20, 20);
    fb.finish();
    expect(rb.search(touch)).toHaveLength(1);
    expect(fb.search(20, 20, 30, 30)).toHaveLength(1);
    expect(api.intersects(box, touch)).toBe(true);
  });

  it('flatbush: add после finish проходит, а search бросает', () => {
    const fb = flat(gen.makeShapes(100, 1, 'uniform', 0));
    expect(() => fb.add(1, 1, 1, 1)).not.toThrow();
    expect(() => fb.search(0, 0, 10, 10)).toThrow('Data not yet indexed');
  });

  it('quadraticSplit делит переполненный узел на группы не меньше m', () => {
    const shapes = gen.makeShapes(10, seed, 'uniform', 20);
    const node = { leaf: true, children: shapes, minX: 0, minY: 0, maxX: 0, maxY: 0 };
    const [a, b] = api.quadraticSplit(node);
    expect(a.children.length + b.children.length).toBe(10);
    expect(Math.min(a.children.length, b.children.length)).toBeGreaterThanOrEqual(4);
  });
});

describe('LIB_CODE исполняется с настоящими rbush и flatbush', () => {
  it('поиск рамкой у обеих библиотек совпадает с перебором', () => {
    const shapes = gen.makeShapes(3000, seed, 'clusters', 20);
    const extra = { id: 3000, minX: 1, minY: 1, maxX: 2, maxY: 2 };
    const body = t.LIB_CODE.replace(/^import .*$/gm, '');
    const out = new Function('RBush', 'Flatbush', 'shapes', 'extra', `${body}\nreturn { tree, inFrame, ids, nearest };`)(
      RBush,
      Flatbush,
      shapes,
      extra,
    ) as { tree: RBush<Shape>; inFrame: Shape[]; ids: number[]; nearest: number[] };
    const frame = { minX: 400, minY: 300, maxX: 600, maxY: 450 };
    const brute = sortNum(api.bruteSearch(shapes, frame, emptyStats()));
    expect(sortNum(out.inFrame.map((s) => s.id))).toEqual(brute);
    expect(sortNum(out.ids.map((i) => shapes[i].id))).toEqual(brute);
    expect(out.nearest).toHaveLength(5);
    expect(out.tree.all()).toHaveLength(3000);
  });
});
