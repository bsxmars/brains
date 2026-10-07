/** Режим проверки изменений: zone.js или планировщик без зоны. */
export type ZoneMode = 'zone' | 'zoneless';

/** Компоненты сквозного примера — те же четыре, что в `ANGULAR_APP_CODE` темы. */
export type ViewName = 'App' | 'Counter' | 'Clock' | 'List';

export type ScenarioId =
  | 'click'
  | 'timerNoop'
  | 'timerField'
  | 'threeSignals'
  | 'microtask'
  | 'mousemove'
  | 'markForCheck'
  | 'awaitField'
  | 'awaitFieldLowered'
  | 'awaitSignal';

/** Ключ конфигурации стенда: режим и стратегия компонентов. */
export type ConfigKey = 'zone' | 'zone/onpush' | 'zoneless' | 'zoneless/onpush';

/** Что видно после сценария: число тиков, запуски шаблонов, текст на экране. */
export interface RunResult {
  ticks: number;
  hits: Record<ViewName, number>;
  /** Поле `label` компонента Clock — как его показывает экран. */
  label: string;
  /** Сигнал `status` компонента Clock — как его показывает экран. */
  status: string;
  /** Сигнал `count` компонента Counter — как его показывает экран. */
  count: string;
}

/** Результат настоящего Angular: то же плюс значения, с которыми выполнился `effect` в Counter. */
export interface StandRun extends RunResult {
  effects: number[];
}

/** Подробный прогон мини-версии для демо. */
export interface MiniRun extends RunResult {
  /** Каждый тик — список компонентов, чей шаблон выполнился. */
  log: ViewName[][];
  /** Колбэки, которые выполнила мини-зона (в режиме без зоны — `null`). */
  zoneTasks: number | null;
  /** Значения в данных компонентов — чтобы сравнить с экраном. */
  state: { label: string; status: string; count: string };
}

export interface Scenario {
  id: ScenarioId;
  label: string;
  /** Что делает сценарий. Строчная разметка. */
  what: string;
}

/** Функции, которые возвращают строки `ZONE_CODE`, `SCHEDULER_CODE` и `TREE_CODE` темы. */
export interface MiniView {
  name: ViewName;
  render: () => void;
  onPush: boolean;
  parent: MiniView | null;
  children: MiniView[];
  dirty: boolean;
  signal: boolean;
  through: boolean;
}

export interface MiniZone {
  run<T>(fn: () => T): T;
  patch(api: LoopApi): LoopApi;
  stats: { tasks: number };
  inside(): boolean;
}

export interface MiniApi {
  createZone(onStable: () => void): MiniZone;
  createScheduler(tick: () => void, later: (fn: () => void) => void): () => void;
  createView(name: ViewName, render: () => void, opts?: { onPush?: boolean; parent?: MiniView | null }): MiniView;
  markDirty(view: MiniView): void;
  markSignal(view: MiniView): void;
  check(view: MiniView, global: boolean, log: ViewName[]): void;
}

/** Асинхронные API, которые подменяет мини-зона: модель того, что даёт браузер. */
export interface LoopApi {
  setTimeout(fn: () => void, ms?: number): void;
  queueMicrotask(fn: () => void): void;
  addEventListener(target: string, type: string, fn: () => void): void;
}
