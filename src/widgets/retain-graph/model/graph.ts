import { WEIGHTS, type Scene } from './scene';
import type { GraphEdge, GraphNode, ObjectGraph, OpaqueRef, Origin } from './types';

/**
 * Обход настоящей структуры объектов: узлы и имена ссылок спрашиваются у движка.
 *
 * Имя ребра нигде не написано руками — оно собирается прямо в обходе из того, чем ссылка
 * оказалась: ключ объекта даёт `el in Chart`, индекс массива даёт `3 in (array)`, ключ
 * коллекции даёт `chart in Map`. Ровно эти строки в теме лежали литералами, вместе
 * с рисующими отступ символами; теперь и строка, и отступ — следствие обхода.
 *
 * ⚠️ Два узла обход НЕ находит, а объявляет, и оба помечены `declared`:
 *
 *   `system / Context`     слоты замыкания из JS не интроспектируются ничем. Ребро
 *                          «функция → контекст» берётся из метки сцены, а не у движка;
 *   `(object elements)`    служебный узел V8: хранилище элементов массива. В снимке кучи он
 *                          есть и держит основную массу байт, из JS его не видно вообще.
 *
 * ⚠️ Полмиллиона элементов обходить поштучно незачем и нельзя: узел получился бы один на объект,
 * а страница легла бы. Массив из одинаковых по форме элементов сворачивается в один узел
 * `Object × N` — ровно так же, как это делает панель Summary. Число N настоящее (`length`),
 * а одинаковость формы проверена по первым `SAMPLE` элементам — и это тоже сказано в подписи.
 */

/** Сколько элементов массива проверяется на одинаковость формы. */
export const SAMPLE = 32;

/** С какой длины массив сворачивается в один узел `Object × N`. */
export const GROUP_MIN = 3;

const isRef = (value: unknown): value is object =>
  (typeof value === 'object' && value !== null) || typeof value === 'function';

const isPlain = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Одинакова ли форма элементов массива — по первым `sample` штукам.
 *
 * Полный проход по пятистам тысячам объектов дал бы честный ответ за десятые доли секунды,
 * и это дорого для гидратации острова. Поэтому проверяется префикс, а в подписи узла сказано,
 * сколько именно элементов проверено: приблизительный ответ с названной границей честнее
 * точного ответа без неё.
 */
export function sampleUniform(list: unknown[], sample = SAMPLE): boolean {
  const n = Math.min(list.length, sample);
  if (n === 0) return false;
  const first = list[0];
  if (!isPlain(first)) return false;
  const shape = Object.keys(first).join(',');
  for (let i = 1; i < n; i++) {
    const item = list[i];
    if (!isPlain(item) || Object.keys(item).join(',') !== shape) return false;
  }
  return true;
}

/** Построить граф обходом сцены. */
export function buildGraph(scene: Scene): ObjectGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const opaque: OpaqueRef[] = [];
  const byId = new Map<string, GraphNode>();
  const byObject = new Map<object, string>();
  const queue: object[] = [];
  let anon = 0;

  const add = (node: GraphNode): GraphNode => {
    nodes.push(node);
    byId.set(node.id, node);
    return node;
  };

  const link = (from: string, to: string, label: string, origin: Origin) => {
    edges.push({ id: `e${edges.length}`, from, to, label, origin });
  };

  /** Завести узел для настоящего объекта — или вернуть уже заведённый. */
  const visit = (value: object): string => {
    const known = byObject.get(value);
    if (known) return known;

    const spec = scene.tags.get(value);
    const node: GraphNode = spec
      ? {
          id: spec.id,
          label: spec.label,
          ref: spec.ref,
          kind: spec.kind,
          shallow: spec.shallow,
          count: 1,
          // Объект-скоуп настоящий, но моделирует он то, чего из JS не видно.
          origin: spec.kind === 'scope' ? 'declared' : 'engine',
          note: spec.note,
        }
      : {
          id: `anon-${anon++}`,
          label: 'Object',
          ref: 'Object',
          kind: 'object',
          shallow: WEIGHTS.object,
          count: 1,
          origin: 'engine',
        };

    add(node);
    byObject.set(value, node.id);
    queue.push(value);
    return node.id;
  };

  const expandArray = (list: unknown[], self: GraphNode) => {
    const storeId = `${self.id}-elements`;
    add({
      id: storeId,
      label: '(object elements)',
      ref: '(object elements)',
      kind: 'elements',
      shallow: WEIGHTS.elementsHeader + WEIGHTS.slot * list.length,
      count: 0,
      origin: 'declared',
      note: 'Служебный узел V8: хранилище элементов. В снимке кучи он есть, из JS не наблюдаем — здесь объявлен.',
    });
    link(self.id, storeId, 'elements', 'declared');

    if (list.length >= GROUP_MIN && sampleUniform(list)) {
      const groupId = `${self.id}-group`;
      add({
        id: groupId,
        label: `Object × ${list.length}`,
        ref: 'Object',
        kind: 'group',
        shallow: WEIGHTS.object * list.length,
        count: list.length,
        origin: 'engine',
        note: `Объекты настоящие, число настоящее (length). Одинаковость формы проверена по первым ${Math.min(
          list.length,
          SAMPLE,
        )} элементам, вес одного объявлен.`,
      });
      link(storeId, groupId, `× ${list.length}`, 'declared');
      return;
    }

    list.forEach((item, i) => {
      if (isRef(item)) link(storeId, visit(item), `${i} in ${self.ref}`, 'engine');
    });
  };

  const expand = (value: object, self: GraphNode) => {
    if (typeof value === 'function') {
      // Единственное ребро функции — в её контекст, и оно объявлено: захват из JS не виден.
      const scope = scene.tags.get(value)?.scope;
      if (scope) link(self.id, visit(scope), `context in ${self.ref}`, 'declared');
      return;
    }

    if (value instanceof WeakMap || value instanceof WeakSet || value instanceof WeakRef) {
      opaque.push({
        from: self.id,
        ref: self.ref,
        why: 'Содержимое слабой коллекции неперечислимо по определению: ни ключей, ни `size`, ни итератора. Путь удержания через неё не строится ни этим обходом, ни любым другим кодом на странице.',
      });
      return;
    }

    if (value instanceof Map) {
      for (const [key, item] of value) {
        if (isRef(item)) link(self.id, visit(item), `${String(key)} in ${self.ref}`, 'engine');
      }
      return;
    }

    if (value instanceof Set) {
      let i = 0;
      for (const item of value) {
        if (isRef(item)) link(self.id, visit(item), `${i} in ${self.ref}`, 'engine');
        i++;
      }
      return;
    }

    if (Array.isArray(value)) {
      expandArray(value, self);
      return;
    }

    for (const key of Object.keys(value)) {
      const item = (value as Record<string, unknown>)[key];
      if (isRef(item)) link(self.id, visit(item), `${key} in ${self.ref}`, 'engine');
    }
  };

  const root = visit(scene.root);

  while (queue.length) {
    const value = queue.shift() as object;
    const self = byId.get(byObject.get(value) as string) as GraphNode;
    expand(value, self);
  }

  return { root, nodes, edges, opaque };
}

/** Узел по идентификатору. */
export function nodeOf(graph: ObjectGraph, id: string): GraphNode | null {
  return graph.nodes.find((node) => node.id === id) ?? null;
}

/** Ребро между двумя узлами — по ним виджет и называет то, что собирается разорвать. */
export function edgeBetween(graph: ObjectGraph, from: string, to: string): GraphEdge | null {
  return graph.edges.find((edge) => edge.from === from && edge.to === to) ?? null;
}
