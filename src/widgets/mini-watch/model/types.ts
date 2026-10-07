/**
 * Типы демо «Vue 3 изнутри: watch, effectScope и computed 3.5».
 *
 * Сама реализация здесь не описана: она живёт строкой `MINI_WATCH_CODE` в `data.ts` темы
 * и собирается `new Function` — ровно та строка, что напечатана на странице. Типы описывают
 * то, что эта строка возвращает, и внутренние поля, которые читают демо.
 *
 * ⚠️ Имена внутренних полей (`deps`, `nextDep`, `subs`, `prevSub`, `version`) совпадают
 * с полями `@vue/reactivity` 3.5 намеренно: тест снимает список связей одним и тем же кодом
 * с мини-версии и с настоящего Vue. Поля у Vue внутренние и могут смениться.
 */

/** Узел-связь «источник × подписчик». */
export interface MiniLink {
  dep: MiniDep;
  sub: MiniSub;
  version: number;
  prevDep: MiniLink | null | undefined;
  nextDep: MiniLink | null | undefined;
  prevSub: MiniLink | null | undefined;
  nextSub: MiniLink | null | undefined;
}

export interface MiniDep {
  version: number;
  /** Хвост списка подписчиков. */
  subs: MiniLink | null | undefined;
  computed: MiniComputed | null | undefined;
}

export interface MiniSub {
  deps: MiniLink | null | undefined;
  depsTail: MiniLink | null | undefined;
}

export interface MiniComputed extends MiniSub {
  dep: MiniDep;
  readonly value: unknown;
  /** Только у мини-версии; у Vue — бит `DIRTY` в `flags`. */
  dirty?: boolean;
  flags?: number;
}

export interface MiniEffect extends MiniSub {
  active?: boolean;
}

export interface MiniRef<T = unknown> {
  value: T;
  dep: MiniDep;
}

export interface MiniScope {
  readonly active: boolean;
  run<T>(fn: () => T): T | undefined;
  stop(): void;
}

export interface MiniRunner {
  (): unknown;
  effect: MiniEffect;
}

type WatchSource = unknown;
type WatchCallback = (value: never, oldValue: never, onCleanup: (fn: () => void) => void) => unknown;

/**
 * Публичные функции — те же имена, что у настоящего Vue. На этом держится сверка: код
 * пишется один раз и исполняется и мини-версией, и `@vue/runtime-core`.
 */
export interface WatchApi {
  ref: <T>(value: T) => MiniRef<T>;
  reactive: <T extends object>(target: T) => T;
  computed: <T>(getter: () => T) => { readonly value: T };
  effect: (fn: () => unknown) => MiniRunner;
  stop: (runner: MiniRunner) => void;
  watch: (source: WatchSource, cb: WatchCallback, options?: Record<string, unknown>) => () => void;
  watchEffect: (fn: (onCleanup: (fn: () => void) => void) => unknown, options?: Record<string, unknown>) => () => void;
  onWatcherCleanup: (fn: () => void) => void;
  effectScope: (detached?: boolean) => MiniScope;
  onScopeDispose: (fn: () => void) => void;
  nextTick: (fn?: () => void) => Promise<void>;
}

/** Всё, что возвращает `MINI_WATCH_CODE`: публичное плюс внутренности для демо. */
export interface MiniWatch extends WatchApi {
  targetMap: WeakMap<object, Map<string | symbol, MiniDep>>;
  getGlobalVersion: () => number;
  getBatchDepth: () => number;
}

/** Подмена одной строки реализации: демо и тест исполняют один и тот же вариант. */
export interface CodePatch {
  find: string;
  replace: string;
  /** Что меняет подмена — для подписи на странице. */
  why: string;
}

// ---- гонка ------------------------------------------------------------------

export type RaceAct = { kind: 'start' } | { kind: 'write'; value: string } | { kind: 'answer'; index: number };

export interface RaceStep {
  label: string;
  act: RaceAct;
}

export interface RaceRequest {
  id: number;
  query: string;
  state: 'waiting' | 'answered';
}

/** Кадр демо гонки: что на экране и где запросы после шага. */
export interface RaceFrame {
  label: string;
  query: string;
  shown: string;
  requests: RaceRequest[];
  /** Журнал целиком, от начала до этого кадра. */
  log: string[];
}

// ---- области ----------------------------------------------------------------

export interface ScopeNodeView {
  id: number;
  name: string;
  /** В чьём `run` создан — для отступа в дереве. Не то же, что «кто остановит». */
  parent: number | null;
  depth: number;
  detached: boolean;
  active: boolean;
  /** Сколько раз выполнился эффект узла. */
  runs: number;
}

// ---- цепочка computed -------------------------------------------------------

export interface ChainScenario {
  /** Обязан объявить `n`, `parity`, `label` и `E`. */
  setup: string;
  actions: string[];
  note: string;
}

export interface LinkView {
  /** Имя источника: `n`, `parity`, `label`. */
  dep: string;
  /** Версия источника, которую подписчик видел последней. */
  seen: number;
  /** Текущая версия источника. */
  current: number;
}

export interface SubView {
  name: string;
  kind: 'effect' | 'computed';
  /** У computed: версия его собственного `Dep`. */
  version?: number;
  dirty?: boolean;
  links: LinkView[];
  /** У computed: кто на него подписан — по списку `prevSub` от хвоста. */
  readers?: string[];
}

export interface ChainSnapshot {
  counts: Record<string, number>;
  log: string[];
  subs: SubView[];
  globalVersion: number | null;
}
