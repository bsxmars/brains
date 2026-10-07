/**
 * Типы демо «Сигналы: третья модель реактивности».
 *
 * Сама реализация здесь не описана: она живёт строками `MINI_SIGNALS_CODE` и
 * `NAIVE_SIGNALS_CODE` в `data.ts` темы и собирается `new Function` — ровно те строки,
 * что напечатаны на странице. Типы описывают то, что эти строки возвращают.
 */

/** Сигнал в форме предложения TC39: `get` и `set`. */
export interface SignalLike<T = unknown> {
  get(): T;
  set(value: T): void;
}

export interface ComputedLike<T = unknown> {
  get(): T;
}

/**
 * Публичные имена, под которыми код примеров видит реализацию. Одни и те же у мини-версии,
 * у наивной версии и у переходников к `@vue/reactivity` и alien-signals в тесте.
 */
export interface SignalsApi {
  signal: <T>(value: T) => SignalLike<T>;
  computed: <T>(fn: () => T) => ComputedLike<T>;
  effect: (fn: () => unknown) => () => void;
  batch: <T>(fn: () => T) => T;
}

/** Операции, которыми мини-рендерер трогает DOM. Реализацию подставляет вызывающий. */
export interface DomAdapter<N = unknown> {
  createElement(tag: string): N;
  createText(text: string): N;
  setText(node: N, text: string): void;
  setAttribute(node: N, name: string, value: string): void;
  append(parent: N, child: N): void;
}

export interface Renderer {
  h: (tag: string, props: Record<string, unknown> | null, ...children: unknown[]) => unknown;
  render: (component: () => unknown, parent: unknown) => void;
}

/** Всё, что возвращает `MINI_SIGNALS_CODE`. */
export interface MiniSignals extends SignalsApi {
  createRenderer: (dom: DomAdapter) => Renderer;
}

/** Сценарий графа. Код в нём — не подпись, а то, что исполняется. */
export interface GraphScenario {
  id: string;
  label: string;
  setup: string;
  /** Кнопки. Подпись кнопки и есть выполняемый код. */
  actions: string[];
  /** Узлы графа по рядам сверху вниз — для схемы над счётчиками. */
  rows: string[][];
  note: string;
}

/**
 * Строка журнала. `run` — вызов `count(имя)` в начале вычисления: кто пересчитался и в каком
 * порядке. `log` — вывод эффекта; `consistent: false` — эффект увидел несогласованную пару.
 */
export type TraceEntry =
  | { kind: 'run'; name: string }
  | { kind: 'log'; text: string; consistent?: boolean };

export interface GraphStep {
  trace: TraceEntry[];
  /** Счётчики прогонов за всё время жизни сценария. */
  counts: Record<string, number>;
}

/** Сценарий мини-«Solid». Установка обязана вызвать `render(…, root)`. */
export interface DomScenario {
  setup: string;
  actions: string[];
  note: string;
}

export interface DomStep {
  /** Операции над DOM за этот шаг, по порядку. */
  ops: string[];
  /** Итоговая разметка корня. */
  html: string;
  counts: Record<string, number>;
}
