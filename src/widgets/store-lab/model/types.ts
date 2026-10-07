/** Состояние сквозного примера темы «Стейт-менеджеры изнутри». */
export interface LabState {
  count: number;
  user: { name: string };
  todos: string[];
}

export type Listener = (state: LabState, prev: LabState) => void;

/** Стор из `STORE_CODE`: тот же интерфейс, что у `zustand/vanilla`. */
export interface MiniStore {
  getState(): LabState;
  setState(partial: Partial<LabState> | ((state: LabState) => Partial<LabState> | LabState)): void;
  subscribe(listener: Listener): () => void;
}

/** Что собирает `loadMini` из строк `STORE_CODE` и `SELECTOR_CODE`. */
export interface MiniApi {
  createStore(createState: () => LabState): MiniStore;
  subscribeSelector<T>(
    store: MiniStore,
    selector: (state: LabState) => T,
    listener: (next: T, prev: T) => void,
    equals?: (a: T, b: T) => boolean,
  ): () => void;
  shallow(a: unknown, b: unknown): boolean;
}

/** Стор, который возвращает мини-`defineStore` из `PINIA_CODE`. */
export interface TrackedStore extends LabState {
  summary: string;
  inc(): void;
}

/** Что `PINIA_CODE` получает от Vue: только реактивность, без компонентов. */
export interface Reactivity {
  reactive<T extends object>(target: T): T;
  computed<T>(getter: () => T): { readonly value: T };
  toRefs<T extends object>(target: T): Record<string, unknown>;
}

/** Эффекты Vue: ими демо изображает рендер компонента в режиме Pinia. */
export interface Effects {
  effect(fn: () => void): unknown;
  effectScope(detached?: boolean): { run<T>(fn: () => T): T | undefined; stop(): void };
}

export type DefineStore = (
  id: string,
  options: {
    state: () => LabState;
    getters?: Record<string, (state: LabState) => unknown>;
    actions?: Record<string, (this: TrackedStore) => void>;
  },
) => () => TrackedStore;

/**
 * Способ, которым компонент узнаёт об изменении:
 * `all` — `store.subscribe(render)` без селектора; `selector` — селектор и `Object.is`;
 * `shallow` — селектор и поверхностное сравнение; `tracking` — Pinia: трекинг чтений Vue.
 */
export type LabMode = 'all' | 'selector' | 'shallow' | 'tracking';

export type LabAction = 'inc' | 'rename' | 'addTodo' | 'sameCount' | 'sameRef';

export type LabComponentId = 'counter' | 'name' | 'summary';

export interface LabRow {
  id: LabComponentId;
  /** Что компонент показывает сейчас. */
  value: string;
  /** Рендеров с монтирования, монтирование включено. */
  renders: number;
  /** Вызовов селектора вне рендера — проверок «мой ли это кусок». */
  checks: number;
  /** Рендеров за последнее действие. */
  lastRenders: number;
  /** Проверок за последнее действие. */
  lastChecks: number;
}

export interface Lab {
  rows(): LabRow[];
  act(action: LabAction): void;
  /** Снять подписки и эффекты: демо пересоздаёт стенд при смене режима. */
  stop(): void;
}
