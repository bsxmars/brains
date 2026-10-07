/** Строка базы-заглушки: номер, версия (растёт с каждым UPDATE) и имя. */
export interface Row {
  id: number;
  v: number;
  name: string;
}

/** Кеш, с которым умеют работать планировщик и `simulate`: учебный Redis или настоящий через ioredis. */
export interface CacheLike {
  call(cmd: string, ...args: unknown[]): unknown;
}

export interface MiniRedis extends CacheLike {
  call(cmd: string, ...args: unknown[]): string | number | null;
  /** Живые ключи и их значения — для демо. */
  dump(): Record<string, string>;
}

export interface Db {
  read(id: number): Row | null;
  replay(): string;
  snapshot(): { primary: Row[]; replica: Row[] | null; tx: Row[] | null };
}

export type Op = [string, ...unknown[]];
export type Client = Generator<Op, unknown, unknown>;

/** Гонка по шагам: какие клиенты участвуют и в каком порядке делают шаги. */
export interface RaceScenario {
  id: string;
  label: string;
  /** `race` — гонки без защиты, `fix` — способы их лечить. */
  group: 'race' | 'fix';
  replica: boolean;
  /** Имя клиента → имя генератора из темы и его аргументы. */
  clients: Record<string, [string, ...(string | number)[]]>;
  /** Буква — шаг клиента, `R` — реплика догоняет. Пробелы — только для чтения. */
  order: string;
  /** Подпись над сценарием. Строчная разметка. */
  note: string;
  /** Что случилось в итоге. Строчная разметка. */
  verdict: string;
}

/** Итог гонки: журнал шагов и что лежит в кеше и в основной базе после них. */
export interface RaceResult {
  log: string[];
  cached: string | null;
  primary: string;
}

export type Strategy = 'plain' | 'lock' | 'xfetch' | 'swr';
/** `miss` — ключа нет, N читателей разом; `stale` — лежит просроченное по мягкому сроку; `stream` — поток чтений через истечение. */
export type HerdPattern = 'miss' | 'stale' | 'stream';

export interface HerdParams {
  /** Сколько читателей приходят разом на промахе. */
  n: number;
  /** Сколько читателей в потоке. */
  streamN: number;
  dbMs: number;
  /** Для потока: когда истекает ключ и как часто приходят читатели. */
  expiryMs: number;
  intervalMs: number;
  /** Первый читатель потока приходит в `offsetMs`: так ни одно чтение не совпадает с концом похода в базу. */
  offsetMs: number;
  beta: number;
}

export interface Reader {
  at: number;
  wait: number;
  db: boolean;
  slept: boolean;
  result: unknown;
}

export interface HerdResult {
  dbCalls: number;
  readers: Reader[];
}

export interface EvictionRun {
  s: number;
  h: number;
  c: number;
  evicted: number;
  fails: number;
  firstFail: number | null;
  /** Какие ключи остались — для демо. */
  kept: Set<string>;
  /** Все ключи нагрузки по порядку записи. */
  all: string[];
}

export interface Store {
  set(key: string, ttl?: number | null): string;
  get(key: string): string | null;
  tick(sec: number): void;
  keys(): string[];
  evicted(): number;
}

export interface CacheModel {
  createRedis(now?: () => number): MiniRedis;
  createDb(rows: Row[], opts?: { replica?: boolean }): Db;
  runSchedule(o: { cache: CacheLike; db: Db; clients: Record<string, Client>; order: string }): Promise<string[]>;
  simulate(o: { cache: CacheLike; clock: { now: number }; clients: { at: number; gen: Client }[]; dbMs: number }): Promise<HerdResult>;
  createStore(o: { capacity: number; policy: string; samples?: number; random?: () => number }): Store;
  /** `['set', key, ttl]`, `['get', key]` или `['tick', секунды]`. */
  workload(): Generator<[string, string | number, (number | null)?], void, unknown>;
  [generator: string]: unknown;
}
