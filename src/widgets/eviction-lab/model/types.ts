/** Строки кода темы, из которых собирается всё, что считает демо. */
export interface EvictionCodes {
  lru: string;
  lfu: string;
  sketch: string;
  tinylfu: string;
  sieve: string;
  trace: string;
}

/** Общий вид учебных кешей: `get` отдаёт значение или `undefined`, `set` кладёт. */
export interface Cache {
  get(key: unknown): unknown;
  set(key: unknown, value: unknown): void;
}

export interface LruCache extends Cache {
  max: number;
  map: Map<unknown, { value: unknown; start: number }>;
}

export interface LfuCache extends Cache {
  max: number;
  values: Map<unknown, unknown>;
  counts: Map<unknown, number>;
  buckets: Map<number, { keys: Set<unknown>; oldest: Iterator<unknown> }>;
  minFreq: number;
}

export interface Sketch {
  rows: Uint8Array[];
  sampleSize: number;
  additions: number;
  estimate(key: unknown): number;
  increment(key: unknown): void;
  reset(): void;
}

export interface TinyLfuCache extends Cache {
  windowMax: number;
  mainMax: number;
  protectedMax: number;
  window: Map<unknown, unknown>;
  probation: Map<unknown, unknown>;
  protected: Map<unknown, unknown>;
  sketch: Sketch;
}

export interface SieveNode {
  key: unknown;
  value: unknown;
  visited: boolean;
  prev: SieveNode | null;
  next: SieveNode | null;
}

export interface SieveCache extends Cache {
  max: number;
  map: Map<unknown, SieveNode>;
  head: SieveNode | null;
  tail: SieveNode | null;
  hand: SieveNode | null;
}

export type TraceKind = 'zipf' | 'scan' | 'loop' | 'shift';

export interface TraceOptions {
  length?: number;
  seed?: number;
  keys?: number;
  s?: number;
  loop?: number;
  burst?: number;
}

export interface SimResult {
  hitRate: number;
  /** Доля попаданий в каждом окне трассы — то, что рисует график. */
  curve: number[];
}

export interface EvictionApi {
  LRU: new (max: number, options?: { ttl?: number; now?: () => number }) => LruCache;
  LFU: new (max: number) => LfuCache;
  CountMinSketch: new (width: number, sampleSize: number, depth?: number) => Sketch;
  WTinyLFU: new (max: number) => TinyLfuCache;
  Sieve: new (max: number) => SieveCache;
  mulberry32(seed: number): () => number;
  zipf(keys: number, s: number, random: () => number): () => number;
  makeTrace(kind: TraceKind, options?: TraceOptions): number[];
  simulate(cache: Cache, trace: unknown[], windows?: number): SimResult;
}

export type AlgoId = 'lru' | 'lfu' | 'tinylfu' | 'sieve';

/** Один ключ в снимке содержимого кеша. */
export interface SnapItem {
  key: string;
  /** Подпись рядом с ключом: частота, оценка sketch, бит «спрашивали». */
  badge?: string;
  /** Стрелка SIEVE стоит на этом узле. */
  hand?: boolean;
}

/** Часть кеша: у LRU одна, у LFU — корзина частоты, у W-TinyLFU — окно и две части основной памяти. */
export interface SnapGroup {
  label: string;
  items: SnapItem[];
}

export interface Frame {
  key: string;
  hit: boolean;
  /** Кто покинул кеш на этом шаге и почему. */
  gone: { key: string; why: 'evict' | 'reject' }[];
  groups: SnapGroup[];
}

/** Короткая трасса для пошагового режима. */
export interface StepTrace {
  id: string;
  label: string;
  /** Запросы через пробел. */
  keys: string;
  /** Что увидеть. Строчная разметка. */
  note: string;
}

/** Длинная трасса для графика. */
export interface ChartTrace {
  id: TraceKind;
  label: string;
  /** Что увидеть. Строчная разметка. */
  note: string;
}
