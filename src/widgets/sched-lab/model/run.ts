import type { HeapApi, HeapNode, HeapOp, LogEntry, RunScenario, SliceEntry } from './types';

/**
 * Демо и тест спрашивают одни и те же функции — строки из темы «Планировщики»
 * (`HEAP_CODE`, `SORTED_CODE`, `LESS_NO_ID_CODE`, `SCHED_CODE`, `HOST_CODE`, `JOB_CODE`,
 * `SCENARIO_CODE`). Строки напечатаны на странице, собраны здесь `new Function` и прогоняются
 * `tests/unit/schedulers.test.ts`: куча — против сортировки и против кучи из исходника
 * `scheduler`, планировщик — против настоящего `scheduler` 0.28 на тех же виртуальных часах
 * и против `scheduler/unstable_mock`. Копий кода нет.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */

/** Куча (и отсортированный массив для сравнения) с собственным счётчиком. */
export function loadHeap(heapCode: string, sortedCode: string, lessOverride = ''): HeapApi {
  return new Function(
    `${heapCode}\n${sortedCode}\n${lessOverride}\nreturn { stats, less, peek, push, pop, insertSorted };`,
  )() as HeapApi;
}

/** Код сценария вместе с хостом и работой. `createScheduler` приходит снаружи — мини или настоящий. */
export function loadRunner(
  hostCode: string,
  jobCode: string,
  scenarioCode: string,
  createScheduler: unknown,
): RunScenario {
  return new Function('createScheduler', `${hostCode}\n${jobCode}\n${scenarioCode}\nreturn runScenario;`)(
    createScheduler,
  ) as RunScenario;
}

/** Мини-планировщик темы: куча + планировщик, без хоста — хост даёт сценарий. */
export function loadMiniScheduler(heapCode: string, schedCode: string): unknown {
  return new Function(`${heapCode}\n${schedCode}\nreturn createScheduler;`)();
}

/** Номер макрозадачи → номер кванта: считаются только макрозадачи, в которых шла работа. */
export function toSlices(log: LogEntry[]): SliceEntry[] {
  const turns = [...new Set(log.map((e) => e.turn))];
  return log.map((e) => ({ ...e, slice: turns.indexOf(e.turn) + 1 }));
}

export interface HeapStep {
  /** Что сделали на этом шаге, для подписи. */
  op: HeapOp;
  popped: HeapNode | null;
  before: HeapNode[];
  after: HeapNode[];
  /** Сколько стоил шаг: сравнения и перемещения кучи, сдвиги отсортированного массива. */
  compares: number;
  moves: number;
  sortedMoves: number;
  /** Итог с начала сценария. */
  total: { compares: number; moves: number; sortedMoves: number };
}

/** Прогон сценария кучи по шагам: кучей темы и, параллельно, отсортированным массивом. */
export function traceHeap(api: () => HeapApi, ops: HeapOp[]): HeapStep[] {
  const heap = api();
  const sorted = api();
  const h: HeapNode[] = [];
  const s: HeapNode[] = [];
  let nextId = 1;
  const steps: HeapStep[] = [];
  for (const op of ops) {
    const before = [...h];
    const c0 = heap.stats.compares;
    const m0 = heap.stats.moves;
    const s0 = sorted.stats.moves;
    let popped: HeapNode | null = null;
    if (op.op === 'push') {
      const id = nextId++;
      heap.push(h, { id, sortIndex: op.key, name: op.name });
      sorted.insertSorted(s, { id, sortIndex: op.key, name: op.name });
    } else {
      popped = heap.pop(h);
      s.pop();
    }
    steps.push({
      op,
      popped,
      before,
      after: [...h],
      compares: heap.stats.compares - c0,
      moves: heap.stats.moves - m0,
      sortedMoves: sorted.stats.moves - s0,
      total: { compares: heap.stats.compares, moves: heap.stats.moves, sortedMoves: sorted.stats.moves },
    });
  }
  return steps;
}
