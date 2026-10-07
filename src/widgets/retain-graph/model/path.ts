import { nodeOf } from './graph';
import { outgoing, reachable, weigh } from './retain';
import type { GraphEdge, ObjectGraph, PathStep, ProbeCut, ProbeStep } from './types';

/**
 * Путь удержания: обход от корня с памятью о родителе, затем обратный ход.
 *
 * Панель Retainers читается снизу вверх, но строится сверху вниз — и именно это здесь и делается.
 * Каждое звено несёт имя ссылки, которой родитель его держит, и имя это взято из обхода
 * (`graph.ts`), а не из данных: `el in Chart` появляется потому, что у объекта есть ключ `el`,
 * а `3 in (array)` — потому, что функция лежит в массиве третьей.
 *
 * Символы `└─` и отступы рисует вид. В данных их нет и быть не должно: путь может оказаться
 * любой длины, и записанный в строку отступ — это отступ ровно для одного случая.
 */

/** Шаги от корня до цели. Пустой массив — цель недостижима. */
export function shortestPath(graph: ObjectGraph, target: string): PathStep[] {
  const out = outgoing(graph);
  const from = new Map<string, GraphEdge>();
  const seen = new Set([graph.root]);
  const queue = [graph.root];

  while (queue.length) {
    const id = queue.shift() as string;
    if (id === target) break;
    for (const edge of out.get(id) ?? []) {
      if (seen.has(edge.to)) continue;
      seen.add(edge.to);
      from.set(edge.to, edge);
      queue.push(edge.to);
    }
  }

  if (target !== graph.root && !from.has(target)) return [];

  const chain: PathStep[] = [];
  let cursor = target;
  for (;;) {
    const node = nodeOf(graph, cursor);
    const edge = from.get(cursor);
    if (node) {
      chain.unshift({
        id: node.id,
        label: node.label,
        ref: node.ref,
        kind: node.kind,
        origin: node.origin,
        edge: edge?.label ?? '',
      });
    }
    if (!edge) break;
    cursor = edge.from;
  }
  return chain;
}

/**
 * Все простые пути от корня до цели.
 *
 * DevTools показывает один — кратчайший, — и это прямая дорога к тонкому месту темы: разорвав
 * показанный путь, вы не освободите ничего, если есть второй. Сколько их на самом деле, видно
 * только полным перебором, и на графе такого размера он стоит доли миллисекунды.
 */
export function allPaths(graph: ObjectGraph, target: string, limit = 8): PathStep[][] {
  const out = outgoing(graph);
  const found: PathStep[][] = [];
  const stack: { id: string; edge: string }[] = [{ id: graph.root, edge: '' }];
  const onStack = new Set([graph.root]);

  const step = (id: string, edge: string): PathStep => {
    const node = nodeOf(graph, id);
    return {
      id,
      label: node?.label ?? id,
      ref: node?.ref ?? id,
      kind: node?.kind ?? 'object',
      origin: node?.origin ?? 'engine',
      edge,
    };
  };

  const walk = (id: string) => {
    if (found.length >= limit) return;
    if (id === target) {
      found.push(stack.map((item) => step(item.id, item.edge)));
      return;
    }
    for (const edge of out.get(id) ?? []) {
      if (onStack.has(edge.to)) continue;
      onStack.add(edge.to);
      stack.push({ id: edge.to, edge: edge.label });
      walk(edge.to);
      stack.pop();
      onStack.delete(edge.to);
    }
  };

  walk(graph.root);
  return found;
}

/**
 * Проверка «критерий починки — ноль»: рвать ссылки по одной и смотреть, что освободилось.
 *
 * Тонкое место 5.4 урока утверждает, что разрыв одного из двух удерживающих путей не даёт
 * ничего. Здесь это не утверждение, а результат: после первого разрыва цель всё ещё достижима
 * от корня, и освободилось ровно ноль байт; после второго — исчезает вся ветка. Если однажды
 * граф изменится так, что первый же разрыв станет достаточным, виджет покажет это сам.
 */
export function repairProbe(graph: ObjectGraph, target: string, cuts: ProbeCut[]): ProbeStep[] {
  const cut = new Set<string>();
  const start = weigh(graph, reachable(graph));
  let previous = start;

  return cuts.map((item) => {
    cut.add(item.edge);
    const live = reachable(graph, { edges: cut });
    const now = weigh(graph, live);
    const edge = graph.edges.find((candidate) => candidate.id === item.edge);

    const step: ProbeStep = {
      what: item.what,
      cutLabel: edge?.label ?? '—',
      reachable: live.has(target),
      freed: {
        bytes: previous.bytes - now.bytes,
        nodes: previous.nodes - now.nodes,
        objects: previous.objects - now.objects,
      },
      freedTotal: {
        bytes: start.bytes - now.bytes,
        nodes: start.nodes - now.nodes,
        objects: start.objects - now.objects,
      },
    };
    previous = now;
    return step;
  });
}
