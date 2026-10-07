/**
 * Типы графа объектов: узлы, рёбра и то, что о графе можно посчитать.
 *
 * ⚠️ Главное поле здесь — `origin`. Оно отвечает на вопрос, который в теме про память задавать
 * обязательно: это движок сказал или мы домыслили? `engine` — узел или ребро найдены отражением
 * по настоящему объекту (`Object.keys`, индекс массива, `Map.entries`). `declared` — узел модели:
 * слот замыкания и служебный `(object elements)` из JS не наблюдаются вовсе, и притвориться,
 * что они «найдены», значило бы подделать ровно то, ради чего виджет и написан.
 *
 * ⚠️ Вес узлов (`shallow`) объявлен, а не измерен, — во всех случаях без исключения. `sizeof`
 * в JS нет и не будет: собственный размер объекта из кода не узнать никогда. Числа взяты из
 * замера урока (Node 24.11, без сжатия указателей) и живут одной таблицей в `scene.ts`.
 */

/** Чем узел является в снимке кучи. */
export type NodeKind =
  | 'root'
  | 'function'
  | 'scope'
  | 'array'
  | 'elements'
  | 'group'
  | 'object'
  | 'map'
  | 'weakmap';

/** Откуда узел или ребро взялись: спросили движок или объявили сами. */
export type Origin = 'engine' | 'declared';

/** Узел графа. */
export interface GraphNode {
  id: string;
  /** Подпись как в снимке: `(closure) held`, `system / Context`, `Object × 500 000`. */
  label: string;
  /** Как узел называется справа от `in` в цепочке retainers: `Chart`, `(array)`, `Map`. */
  ref: string;
  kind: NodeKind;
  /** Объявленный собственный вес, байты. Не измерен — измерить нечем. */
  shallow: number;
  /** Сколько НАСТОЯЩИХ объектов стоит за узлом. У служебных узлов — ноль. */
  count: number;
  origin: Origin;
  note?: string;
}

/** Ребро: кто на кого ссылается и как эта ссылка называется. */
export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  /** Имя ссылки, собранное обходом: `el in Chart`, `3 in (array)`, `chart in Map`. */
  label: string;
  origin: Origin;
}

/** Ссылка, которую видно, но не пройти: содержимое слабой коллекции неперечислимо. */
export interface OpaqueRef {
  from: string;
  ref: string;
  why: string;
}

/** Граф целиком. */
export interface ObjectGraph {
  root: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  opaque: OpaqueRef[];
}

/** Вес набора узлов: в байтах (объявлено), в узлах и в настоящих объектах (посчитано). */
export interface Weight {
  bytes: number;
  nodes: number;
  objects: number;
}

/** Что удерживает узел: сам плюс всё, что держится ТОЛЬКО через него. */
export interface RetainStat extends Weight {
  ids: string[];
}

/** Строка «лестницы» retained size — то же, что в панели Summary. */
export interface RetainRow {
  id: string;
  label: string;
  ref: string;
  kind: NodeKind;
  origin: Origin;
  /** Глубина в дереве доминирования: по ней рисуется отступ. */
  depth: number;
  /** Кратчайший путь от корня, в рёбрах. Считается обходом. */
  distance: number;
  shallow: number;
  /** Вес одного объекта: у группы — `shallow / count`, у остальных равен `shallow`. */
  per: number;
  count: number;
  retained: RetainStat;
  /** Сколько ссылок ведёт в узел. Больше одной — развилка, и «лестница» на ней ломается. */
  retainers: number;
  /** Подпись ближайшего доминатора. */
  dominator: string;
  /** Разница с ретейном родителя по дереву доминирования. */
  gap: number;
  /** Равна ли эта разница собственному весу родителя — то самое правило «лестницы». */
  ladderHolds: boolean;
}

/** Звено пути удержания. `edge` — имя ссылки, которой родитель держит это звено. */
export interface PathStep {
  id: string;
  label: string;
  ref: string;
  kind: NodeKind;
  origin: Origin;
  edge: string;
}

/** Разрыв одной ссылки в проверке «критерий починки — ноль». */
export interface ProbeCut {
  /** Идентификатор ребра. */
  edge: string;
  /** Что это за правка в терминах кода. */
  what: string;
}

/** Итог одного разрыва: цель ещё жива или уже нет и сколько байт это освободило. */
export interface ProbeStep {
  what: string;
  cutLabel: string;
  /** Цель всё ещё достижима от корня. */
  reachable: boolean;
  /** Освободилось этим разрывом. */
  freed: Weight;
  /** Освободилось всеми разрывами с начала проверки. */
  freedTotal: Weight;
}
