/** Элемент кучи: ключ сравнения и порядковый номер — второй ключ при равенстве. */
export interface HeapNode {
  id: number;
  sortIndex: number;
  /** Подпись для демо: имя задачи. */
  name?: string;
}

export interface HeapStats {
  compares: number;
  moves: number;
}

/** То, что возвращает строка `HEAP_CODE` (+ `SORTED_CODE`), собранная `new Function`. */
export interface HeapApi {
  stats: HeapStats;
  less(a: HeapNode, b: HeapNode): boolean;
  peek(heap: HeapNode[]): HeapNode | null;
  push(heap: HeapNode[], node: HeapNode): void;
  pop(heap: HeapNode[]): HeapNode | null;
  insertSorted(arr: HeapNode[], node: HeapNode): void;
}

export type HeapOp = { op: 'push'; name: string; key: number } | { op: 'pop' };

export interface HeapScenario {
  id: string;
  label: string;
  /** Подпись над демо. Строчная разметка. */
  note: string;
  ops: HeapOp[];
  /** Сравнивать без счётчика: `LESS_NO_ID_CODE` поверх `HEAP_CODE`. */
  noId?: boolean;
}

/** Приоритеты пакета `scheduler`: 1 — Immediate … 5 — Idle. */
export type Priority = 1 | 2 | 3 | 4 | 5;

/** Работа сценария: `units` — куски по стольку-то миллисекунд виртуального времени. */
export interface Job {
  name: string;
  priority: Priority;
  /** Когда работа появится (клик, ответ сети), мс. 0 или нет — сразу. */
  at?: number;
  /** Параметр `delay` планировщика, мс. */
  delay?: number;
  units: number[];
}

/** Строка журнала: кусок работы начался. */
export interface LogEntry {
  /** Номер макрозадачи хоста. */
  turn: number;
  t: number;
  name: string;
  part: number;
  didTimeout: boolean;
}

/** Журнал после нормализации: `slice` — номер кванта (макрозадачи, в которой шла работа), с 1. */
export interface SliceEntry extends LogEntry {
  slice: number;
}

export interface SchedScenario {
  id: string;
  label: string;
  /** Подпись над демо. Строчная разметка. */
  note: string;
  jobs: Job[];
  /** У работы с этим именем приоритет выбирает читатель. */
  pickPriorityOf?: string;
}

export type RunScenario = (jobs: Job[]) => LogEntry[];
