/**
 * Типы демо «мини-рендерер Vue изнутри».
 *
 * Сама реализация здесь не описана и описана быть не может: она живёт строкой
 * `MINI_PATCH_CODE` в `data.ts` темы и собирается `new Function` — ровно та строка,
 * что напечатана на странице по шагам. Типы описывают **то, что эта строка возвращает**,
 * и то, что демо из неё читает. Разойдутся — упадёт `tests/unit/vue-patch-internals.test.ts`.
 */

/** Узел журналирующего хоста: то, что возвращает `createLogHost()` вместо DOM-узла. */
export interface HostNode {
  id: number;
  tag: string;
  text: string;
  props: Record<string, unknown>;
  parent: HostNode | null;
  children: HostNode[];
}

/** Запись журнала хоста: вид операции и её строка для человека. */
export interface HostEntry {
  op: 'createElement' | 'createText' | 'setText' | 'setElementText' | 'insert' | 'move' | 'remove' | 'patchProp';
  text: string;
}

/** Операции хоста — тот же набор имён, что ждёт `createRenderer` у Vue. */
export interface NodeOps {
  createElement: (tag: string) => HostNode;
  createText: (text: string) => HostNode;
  createComment: () => HostNode;
  setText: (node: HostNode, text: string) => void;
  setElementText: (el: HostNode, text: string) => void;
  insert: (child: HostNode, parent: HostNode, anchor?: HostNode | null) => void;
  remove: (child: HostNode) => void;
  patchProp: (el: HostNode, key: string, prev: unknown, next: unknown) => void;
  parentNode: (node: HostNode) => HostNode | null;
  nextSibling: (node: HostNode) => HostNode | null;
}

export interface LogHost {
  nodeOps: NodeOps;
  root: HostNode;
  log: HostEntry[];
  /** Дерево под корнем разметкой: `<ul><li>A</li></ul>`. */
  html: () => string;
}

/** Событие окна `trace` внутри `patchKeyedChildren`. В Vue такого окна нет. */
export type TraceEvent =
  | { phase: 'head'; data: { i: number } }
  | { phase: 'tail'; data: { e1: number; e2: number } }
  | { phase: 'mount' | 'move' | 'stay'; data: { index: number } }
  | { phase: 'unmount'; data: { index: number } }
  | { phase: 'match'; data: { index: number; newIndex: number } }
  | { phase: 'lis'; data: { s: number; map: number[]; seq: number[]; moved: boolean } };

export type Trace = <E extends TraceEvent>(phase: E['phase'], data: E['data']) => void;

/** Узел виртуального дерева — ровно поля, которые заводит `createVNode` мини-версии. */
export interface VNode {
  type: unknown;
  props: Record<string, unknown> | null;
  children: unknown;
  key: unknown;
  shapeFlag: number;
  patchFlag: number;
  dynamicProps: string[] | null;
  dynamicChildren: VNode[] | null;
  el: HostNode | null;
  component: unknown;
}

/**
 * Публичные имена — те же, что у `@vue/runtime-core`. На этом держится сверка: сценарий
 * пишется один раз и исполняется и мини-версией, и настоящим рендерером Vue.
 */
export interface RendererApi {
  createRenderer: (options: NodeOps & { trace?: Trace }) => {
    render: (vnode: unknown, container: HostNode) => void;
  };
  h: (type: unknown, props?: Record<string, unknown> | null, children?: unknown) => VNode;
  createVNode: (
    type: unknown,
    props?: Record<string, unknown> | null,
    children?: unknown,
    patchFlag?: number,
    dynamicProps?: string[] | null,
  ) => VNode;
  openBlock: () => void;
  createBlock: (
    type: unknown,
    props?: Record<string, unknown> | null,
    children?: unknown,
    patchFlag?: number,
    dynamicProps?: string[] | null,
  ) => VNode;
  nextTick: () => Promise<unknown>;
}

/** Всё, что возвращает `MINI_PATCH_CODE`. */
export interface MiniPatch extends RendererApi {
  createLogHost: () => LogHost;
  Text: symbol;
  ShapeFlags: Record<string, number>;
  PatchFlags: Record<string, number>;
  getSequence: (arr: number[]) => number[];
}

/** Реактивность, на которой стоят компоненты мини-версии. Берётся настоящая, из Vue. */
export interface ReactivityDeps {
  effect: (...args: never[]) => unknown;
  shallowReactive: <T extends object>(target: T) => T;
}

/** Сценарий демо: старый и новый порядок ключей. */
export interface PatchScenario {
  id: string;
  label: string;
  from: string[];
  to: string[];
  note: string;
  /** Перетасовка: новый порядок выводится из номера, кнопка «ещё» его меняет. */
  shuffle?: boolean;
}

export type OldCell = 'idle' | 'head' | 'tail' | 'kept' | 'removed';
export type NewCell = 'idle' | 'head' | 'tail' | 'mounted' | 'moved' | 'stay' | 'pending';

/** Один кадр демо: что сделал алгоритм и что после этого лежит в хосте. */
export interface DemoStep {
  phase: TraceEvent['phase'] | 'start' | 'done';
  /** Что произошло, простым текстом. */
  message: string;
  /** Операции хоста, случившиеся на этом шаге. */
  ops: HostEntry[];
  /** Порядок детей `ul` в хосте после шага. */
  order: string[];
  i: number;
  e1: number;
  e2: number;
  old: OldCell[];
  next: NewCell[];
  /** `newIndexToOldIndex` и начало середины — после фазы `lis`. */
  map: number[] | null;
  s: number;
  /** Позиции середины, входящие в LIS. */
  seq: number[] | null;
  /** Какая ячейка сейчас в фокусе. */
  focus: { side: 'old' | 'new'; index: number } | null;
  /** Перемещений хоста к этому шагу. */
  moves: number;
}

export interface KeyedRun {
  steps: DemoStep[];
  /** Журнал обновления (без монтирования) — строками. */
  log: string[];
  html: string;
  moves: number;
  /** Сколько узлов середины пришлось бы переставить без LIS: все сохранённые, если порядок нарушен. */
  movesWithoutLis: number;
  /** Сколько переставит правило `lastPlacedIndex` из React — на тех же ключах. */
  movesReactRule: number;
}
