/**
 * Типы демо «мини-Vue изнутри».
 *
 * Сама реализация здесь не описана и описана быть не может: она живёт строкой
 * `MINI_VUE_CODE` в `data.ts` темы и собирается `new Function` — ровно та строка,
 * что напечатана на странице. Поэтому типы описывают **то, что эта строка возвращает**,
 * и то, что демо из неё читает. Разойдутся они — упадёт `tests/unit/vue-internals.test.ts`.
 */

/** Внутреннее представление эффекта мини-версии: ровно поля, которые заводит `createEffect`. */
export interface MiniEffect {
  id: number;
  fn: (...args: unknown[]) => unknown;
  scheduler?: () => void;
  deps: MiniDep[];
  active: boolean;
  running: boolean;
  computed: MiniComputed | null;
}

/** `Dep` мини-версии — `Set` подписчиков с номером версии. */
export type MiniDep = Set<MiniEffect> & { version: number; computed?: MiniComputed };

export interface MiniComputed {
  dep: MiniDep;
  dirty: boolean;
  effect: MiniEffect;
  readonly value: unknown;
}

export interface MiniJob {
  (): void;
  id: number;
  effect: MiniEffect;
}

/**
 * Публичные функции — те же имена, что у настоящего Vue. На этом держится сверка:
 * сценарий пишется один раз и исполняется и мини-версией, и `@vue/runtime-core`.
 */
export interface ReactivityApi {
  reactive: <T extends object>(target: T) => T;
  toRaw: <T>(value: T) => T;
  ref: <T>(value: T) => { value: T };
  shallowRef: <T>(value: T) => { value: T };
  computed: <T>(getter: () => T) => { readonly value: T };
  effect: (fn: () => unknown, options?: { scheduler?: () => void }) => unknown;
  stop: (runner: never) => void;
  watch: (...args: never[]) => unknown;
  watchEffect: (fn: () => unknown, options?: { flush?: 'pre' | 'post' | 'sync' }) => unknown;
  nextTick: (fn?: () => void) => Promise<void>;
}

/** Всё, что возвращает `MINI_VUE_CODE`: публичные функции плюс внутренности для демо. */
export interface MiniVue extends ReactivityApi {
  targetMap: WeakMap<object, Map<string | symbol, MiniDep>>;
  ITERATE_KEY: symbol;
  queue: MiniJob[];
  postQueue: MiniJob[];
  getActiveEffect: () => MiniEffect | null;
}

/** Сценарий демо. Код в нём — не подпись, а то, что исполняется. */
export interface MiniScenario {
  id: string;
  /** Подпись на переключателе. */
  label: string;
  /** Код сценария. Обязан объявить `const state = reactive(…)`: от него демо строит граф. */
  setup: string;
  /** Кнопки. Подпись кнопки и есть выполняемый код. */
  actions: string[];
  /** Что смотреть в этом сценарии. */
  note: string;
}

/** Строка журнала: что выполнилось и кто был `activeEffect` в этот момент. */
export interface LogEntry {
  text: string;
  /** Имя функции, записанной в `activeEffect`, или `null` — вне эффектов. */
  active: string | null;
}

export type SubKind = 'effect' | 'computed' | 'job';

export interface SubRef {
  name: string;
  kind: SubKind;
}

/** Строка графа: один `Dep` и те, кто на нём записан. */
export interface DepRow {
  /** `state.a`, `state[перебор]` или имя `computed`. */
  label: string;
  kind: 'key' | 'iterate' | 'computed';
  version: number;
  subs: SubRef[];
  /** Только у `computed`: помечен ли он как устаревший. */
  dirty?: boolean;
}

/** Один шаг демо: синхронная часть, что осталось в очереди, и что случилось в микрозадаче. */
export interface StepResult {
  sync: LogEntry[];
  queued: { pre: string[]; post: string[] };
  flush: LogEntry[];
  graph: DepRow[];
  /** `activeEffect` после шага, прочитанный у реализации. Всегда `null` — и это видно. */
  active: string | null;
}
