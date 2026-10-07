/** Шаг трассы модели: колбэк, выполненный в фазе, или сон в poll. */
export interface LoopStep {
  /** Номер круга `uv_run`: 0 — модуль и таймеры перед первым кругом. */
  turn: number;
  phase: 'main' | 'timers' | 'poll' | 'check' | 'close';
  kind: 'main' | 'timeout' | 'io' | 'immediate' | 'close' | 'sleep';
  /** Строки, напечатанные этим колбэком и очередями после него. */
  out: string[];
  /** Сколько виртуальных миллисекунд цикл проспал в poll (только у `sleep`). */
  ms?: number;
}

export interface LoopRun {
  out: string[];
  trace: LoopStep[];
}

/** `runLoop` из строки `LOOP_CODE` темы. */
export type RunLoop = (source: string, slack?: number) => LoopRun;

/**
 * Сценарий для модели и для настоящего Node — один и тот же текст `code`.
 * `real` — порядок вывода (строки через пробел) → сколько раз из `runs` отдельных запусков
 * Node 24.11 он выпал. Снято стендом, тест пересобирает выборку заново.
 */
export interface LoopScenario {
  id: string;
  label: string;
  code: string;
  /** Обещает ли Node порядок. Тест сверяет с моделью: вывод не зависит от `slack`. */
  deterministic: boolean;
  runs: number;
  real: Record<string, number>;
  /** Что увидеть и почему. Строчная разметка. */
  note: string;
}

export interface PoolTask {
  name: string;
  cost: number;
}

export interface PoolDone {
  name: string;
  thread: number;
  start: number;
  end: number;
}

export type PoolOrder = (size: number, tasks: PoolTask[]) => PoolDone[];

/** Стенд пула: при каком размере на каком месте пришёл `fs.stat` и сколько раз хеш 5 закончился последним из пяти хешей. */
export interface PoolStand {
  size: number;
  runs: number;
  /** Позиция `fs.stat` в выводе (с единицы) → число прогонов. */
  statPositions: Record<number, number>;
  hash5Last: number;
}
