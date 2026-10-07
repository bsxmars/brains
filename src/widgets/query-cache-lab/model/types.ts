/** Часы мини-кеша: «сейчас» и «позови через N мс» (возвращает отмену). */
export interface Clock {
  now(): number;
  after(ms: number, fn: () => void): () => void;
}

/** Виртуальные часы демо: время идёт только по `advance`, таймеры срабатывают по порядку. */
export interface VirtualClock extends Clock {
  advance(ms: number): Promise<void>;
}

export type Status = 'pending' | 'success' | 'error';
export type FetchStatus = 'idle' | 'fetching';

/** Что видит наблюдатель: поля записи, на которые он подписан. */
export interface Snapshot {
  status?: Status;
  fetchStatus?: FetchStatus;
  data?: unknown;
  error?: unknown;
  failures?: number;
}

/** Запись кеша из `CACHE_CODE`. */
export interface Entry {
  key: unknown[];
  hash: string;
  data: unknown;
  error: unknown;
  failures: number;
  status: Status;
  fetchStatus: FetchStatus;
  updatedAt: number;
  invalidated: boolean;
  observers: Set<unknown>;
  promise: Promise<void> | null;
}

export interface Cache {
  clock: Clock;
  entries: Map<string, Entry>;
}

export interface ObserveOptions {
  fn: (key: unknown[]) => Promise<unknown>;
  staleTime?: number;
  gcTime?: number;
  retry?: number;
  /** На какие поля подписан наблюдатель; по умолчанию — на все пять. */
  fields?: (keyof Snapshot)[];
}

/** Что собирает `loadMini` из строк темы. */
export interface MiniApi {
  hashKey(key: unknown[]): string;
  startsWith(key: unknown[], prefix: unknown[]): boolean;
  createCache(clock: Clock): Cache;
  observe(cache: Cache, key: unknown[], options: ObserveOptions, listener: (s: Snapshot) => void): () => void;
  onFocus(cache: Cache): void;
  invalidate(cache: Cache, prefix: unknown[]): void;
  cancel(cache: Cache, key: unknown[]): void;
  getData(cache: Cache, key: unknown[]): unknown;
  setData(cache: Cache, key: unknown[], updater: unknown): void;
  addTodo(cache: Cache, title: string, send: (title: string) => Promise<void>): Promise<void>;
  replaceEqualDeep<T>(prev: unknown, next: T): T;
}

export interface MiniCodes {
  key: string;
  cache: string;
  observe: string;
  invalidate: string;
  optimistic: string;
  share: string;
}

export type Who = 'A' | 'B';

/** Шаг сценария. Один и тот же список шагов исполняют демо (мини-кеш) и тест (TanStack Query, SWR). */
export type Step =
  | { do: 'mount'; who: Who }
  | { do: 'unmount'; who: Who }
  | { do: 'focus' }
  | { do: 'wait'; ms: number }
  | { do: 'add'; title: string; fail?: boolean }
  | { do: 'serverFails'; n: number };

export interface Scenario {
  id: string;
  label: string;
  /** Что увидеть в этом сценарии. Строчная разметка. */
  note: string;
  steps: Step[];
}

export interface LogLine {
  t: number;
  who: 'сеть' | 'кеш' | Who;
  text: string;
  tone?: 'ok' | 'err' | 'warn' | 'info';
}

export interface EntryView {
  hash: string;
  status: Status;
  fetchStatus: FetchStatus;
  data: string;
  updatedAt: number;
  stale: boolean;
  observers: number;
  inFlight: boolean;
  failures: number;
}

export interface ComponentView {
  id: Who;
  mounted: boolean;
  last: Snapshot | null;
  /** Сколько раз наблюдатель получил новое состояние с монтирования. */
  seen: number;
}

export interface LabView {
  now: number;
  components: ComponentView[];
  entry: EntryView | null;
  calls: number[];
  log: LogLine[];
}

/** Сводка прогона для сверки с библиотеками: когда уходили запросы и что видел каждый наблюдатель. */
export interface Trace {
  calls: number[];
  posts: number[];
  seen: Record<Who, string[]>;
}

export interface Lab {
  run(step: Step): Promise<void>;
  view(): LabView;
  trace(): Trace;
  /** Снять подписки: демо пересоздаёт стенд при смене сценария. */
  stop(): void;
}
