/**
 * Типы flame graph по выборочному профилю выделений.
 *
 * Профиль в `data.ts` хранится не сырым JSON из V8 (там дерево узлов с `id` и список сэмплов
 * со ссылкой на узел), а в сжатом виде: таблица кадров, таблица стеков и сэмплы, сгруппированные
 * по одинаковому стеку. Это ровно то, что делает формат pprof: сэмпл — это список адресов
 * в стеке и вектор значений (здесь два: байты и число сэмплов).
 */

/** Один сэмпл — или группа сэмплов с одинаковым стеком. */
export interface FlameSample {
  /** Стек от корня к листу: имена кадров вида `renderCatalog stand.mjs:5`. */
  stack: string[];
  /** Оценка байт, которые представляет сэмпл (поле `size` сэмпла V8). */
  bytes: number;
  /** Сколько сэмплов в группе. У одного сырого сэмпла — 1. */
  count: number;
}

/** Узел дерева вызовов после сворачивания. `children` — Map, чтобы порядок вставки не терялся. */
export interface FoldNode {
  name: string;
  /** Значение только этого кадра — выделено прямо в нём. */
  self: number;
  /** Значение кадра вместе со всем, что под ним. Это и есть ширина прямоугольника. */
  total: number;
  children: Map<string, FoldNode>;
}

/** Прямоугольник flame graph: доли ширины от корня раскладки, глубина — номер ряда. */
export interface FlameRect {
  name: string;
  x: number;
  w: number;
  depth: number;
  total: number;
  self: number;
  node: FoldNode;
}

/** Что по чему считать: оценку байт или число сэмплов. */
export type FlameMetric = 'bytes' | 'samples';

/** Сырой профиль V8 — то, что возвращают `HeapProfiler.stopSampling` и `v8.startHeapProfile().stop()`. */
export interface V8HeapProfile {
  head: V8HeapNode;
  samples: { size: number; nodeId: number; ordinal: number }[];
}

export interface V8HeapNode {
  id: number;
  selfSize: number;
  callFrame: { functionName: string; url: string; lineNumber: number; columnNumber: number };
  children: V8HeapNode[];
}

/** Функции учебного кода `FOLD_CODE` — то, что возвращает его тело. */
export interface FoldApi {
  fromV8(profile: V8HeapProfile): FlameSample[];
  fold(samples: FlameSample[], metric: FlameMetric): FoldNode;
  layout(root: FoldNode): FlameRect[];
  matchShare(root: FoldNode, query: string): number;
}

/** Профиль стенда в сжатом виде — литерал в `data.ts`. */
export interface StandProfile {
  /** `all` — все выделения за окно, `live` — только то, что дожило до конца записи. */
  mode: 'all' | 'live';
  /** Интервал выборки, байт. */
  interval: number;
  /** Сколько запросов прогнал стенд за время записи. */
  requests: number;
  frames: string[];
  /** Стек — индексы в `frames`, от корня к листу. */
  stacks: number[][];
  /** [индекс стека, сумма байт, число сэмплов]. */
  samples: [number, number, number][];
  /** Сумма полей `size` всех сэмплов в сыром профиле. */
  recordedBytes: number;
  /** Сумма `selfSize` всех узлов сырого профиля. */
  selfTotal: number;
  /** Сырых сэмплов до группировки. */
  rawSamples: number;
}
