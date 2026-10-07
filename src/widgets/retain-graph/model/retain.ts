import { nodeOf } from './graph';
import type { GraphEdge, ObjectGraph, RetainRow, RetainStat, Weight } from './types';

/**
 * Удержание, доминаторы и «лестница» — посчитанные обходом, а не набранные в таблице.
 *
 * Определение взято буквально: retained size узла — это то, что освободится, если узел убрать.
 * Так здесь и считается: достижимое от корня минус достижимое от корня в обход этого узла.
 * Дороже алгоритма Ленгауэра — Тарьяна, зато это ровно то предложение, которое читатель видит
 * в словаре урока, и сверять их между собой не нужно. Граф здесь на полтора десятка узлов.
 *
 * Из того же определения получается и ближайший доминатор, и ответ на вопрос, ради которого
 * раздел написан: почему у замыкания с двумя путями к массиву retained size обрушивается,
 * хотя под ним висят те же байты.
 */

/** Что пропустить при обходе: узел целиком или отдельные рёбра. */
export interface Skip {
  node?: string;
  edges?: ReadonlySet<string>;
}

/** Рёбра, сгруппированные по началу. */
export function outgoing(graph: ObjectGraph): Map<string, GraphEdge[]> {
  const out = new Map<string, GraphEdge[]>();
  for (const edge of graph.edges) {
    const list = out.get(edge.from);
    if (list) list.push(edge);
    else out.set(edge.from, [edge]);
  }
  return out;
}

/** Достижимое от корня. `skip` убирает узел или рёбра — на этом стоит всё остальное. */
export function reachable(graph: ObjectGraph, skip: Skip = {}): Set<string> {
  const seen = new Set<string>();
  if (skip.node === graph.root) return seen;

  const out = outgoing(graph);
  const queue = [graph.root];
  seen.add(graph.root);

  while (queue.length) {
    const id = queue.shift() as string;
    for (const edge of out.get(id) ?? []) {
      if (skip.edges?.has(edge.id)) continue;
      if (edge.to === skip.node || seen.has(edge.to)) continue;
      seen.add(edge.to);
      queue.push(edge.to);
    }
  }
  return seen;
}

/** Сложить вес набора узлов: байты объявлены, узлы и настоящие объекты посчитаны. */
export function weigh(graph: ObjectGraph, ids: Iterable<string>): Weight {
  let bytes = 0;
  let nodes = 0;
  let objects = 0;
  for (const id of ids) {
    const node = nodeOf(graph, id);
    if (!node) continue;
    bytes += node.shallow;
    nodes += 1;
    objects += node.count;
  }
  return { bytes, nodes, objects };
}

/**
 * Что удерживает узел: он сам плюс всё, что держится ТОЛЬКО через него.
 *
 * Прямо по определению: достижимое минус достижимое в обход узла.
 */
export function retainedBy(graph: ObjectGraph, id: string, skip: Skip = {}): RetainStat {
  const all = reachable(graph, skip);
  if (!all.has(id)) return { ids: [], bytes: 0, nodes: 0, objects: 0 };

  const rest = reachable(graph, { node: id, edges: skip.edges });
  const ids = [...all].filter((other) => !rest.has(other));
  return { ids, ...weigh(graph, ids) };
}

/** Кратчайшие расстояния от корня, в рёбрах. Та самая колонка Distance. */
export function distances(graph: ObjectGraph): Map<string, number> {
  const out = outgoing(graph);
  const dist = new Map<string, number>([[graph.root, 0]]);
  const queue = [graph.root];

  while (queue.length) {
    const id = queue.shift() as string;
    const step = (dist.get(id) as number) + 1;
    for (const edge of out.get(id) ?? []) {
      if (dist.has(edge.to)) continue;
      dist.set(edge.to, step);
      queue.push(edge.to);
    }
  }
  return dist;
}

/** Входящие рёбра — те самые retainers. Больше одного означает развилку. */
export function retainers(graph: ObjectGraph, id: string): GraphEdge[] {
  return graph.edges.filter((edge) => edge.to === id);
}

/** Все узлы, без которых `id` недостижим. Сам узел в список не входит. */
export function dominatorsOf(graph: ObjectGraph, id: string): string[] {
  const all = reachable(graph);
  if (!all.has(id)) return [];
  return [...all].filter((other) => other !== id && !reachable(graph, { node: other }).has(id));
}

/**
 * Ближайший доминатор.
 *
 * Доминаторы узла всегда выстраиваются в цепочку от корня, поэтому ближайший — тот, у кого
 * доминаторов больше всех. Считать глубже (например, по Distance) нельзя: кратчайший путь
 * и путь через доминатор — разные вещи, и на развилке они расходятся.
 */
export function immediateDominator(graph: ObjectGraph, id: string): string | null {
  const doms = dominatorsOf(graph, id);
  if (!doms.length) return null;

  let best = doms[0];
  let bestRank = dominatorsOf(graph, best).length;
  for (const candidate of doms.slice(1)) {
    const rank = dominatorsOf(graph, candidate).length;
    if (rank > bestRank) {
      best = candidate;
      bestRank = rank;
    }
  }
  return best;
}

/** Дерево доминирования: родитель и дети для каждого достижимого узла. */
export interface DominatorTree {
  parent: Map<string, string | null>;
  children: Map<string, string[]>;
}

export function dominatorTree(graph: ObjectGraph): DominatorTree {
  const parent = new Map<string, string | null>();
  const children = new Map<string, string[]>();

  for (const id of reachable(graph)) {
    const up = id === graph.root ? null : immediateDominator(graph, id);
    parent.set(id, up);
    if (!up) continue;
    const list = children.get(up);
    if (list) list.push(id);
    else children.set(up, [id]);
  }
  return { parent, children };
}

/**
 * «Лестница» retained size: строка на узел, обходом дерева доминирования сверху вниз.
 *
 * Здесь же проверяется правило урока — разница между соседними ступенями равна собственному
 * весу вышестоящего. Правило верное, но только пока цепочка не ветвится, и `ladderHolds`
 * показывает это по каждой ступени отдельно, вместо того чтобы обещать словами.
 */
export function ladder(graph: ObjectGraph): RetainRow[] {
  const tree = dominatorTree(graph);
  const dist = distances(graph);
  const rows: RetainRow[] = [];

  const walk = (id: string, depth: number, parentRetained: number, parentShallow: number) => {
    const node = nodeOf(graph, id);
    if (!node) return;

    const retained = retainedBy(graph, id);
    const dominator = tree.parent.get(id);
    const gap = parentRetained - retained.bytes;

    rows.push({
      id,
      label: node.label,
      ref: node.ref,
      kind: node.kind,
      origin: node.origin,
      depth,
      distance: dist.get(id) ?? -1,
      shallow: node.shallow,
      per: node.count > 1 ? node.shallow / node.count : node.shallow,
      count: node.count,
      retained,
      retainers: retainers(graph, id).length,
      dominator: dominator ? (nodeOf(graph, dominator)?.label ?? dominator) : '—',
      gap,
      ladderHolds: depth > 0 && gap === parentShallow,
    });

    const kids = [...(tree.children.get(id) ?? [])].sort(
      (a, b) => retainedBy(graph, b).bytes - retainedBy(graph, a).bytes,
    );
    for (const kid of kids) walk(kid, depth + 1, retained.bytes, node.shallow);
  };

  walk(graph.root, 0, 0, 0);
  return rows;
}

/** Строки одного поддерева — когда нужна не вся куча, а ветка про замыкание. */
export function subtree(rows: RetainRow[], id: string): RetainRow[] {
  const from = rows.findIndex((row) => row.id === id);
  if (from < 0) return [];
  const base = rows[from].depth;
  const rest = rows.slice(from + 1).findIndex((row) => row.depth <= base);
  return rest < 0 ? rows.slice(from) : rows.slice(from, from + 1 + rest);
}
