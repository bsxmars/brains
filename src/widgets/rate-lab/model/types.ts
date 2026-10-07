/** Вызов обёрнутой функции: когда он случился и аргумент какого события (номер в ленте) он нёс. */
export interface Call {
  t: number;
  arg: number;
}

/** Виртуальные часы темы (`CLOCK_CODE`): время идёт только через `advanceTo`. */
export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number | null): void;
  requestAnimationFrame(fn: (t: number) => void): void;
  advanceTo(t: number): void;
}

export type Wrapped = (arg: number) => void;
type Fn = (arg: number) => void;

export interface DebounceOptions {
  leading?: boolean;
  trailing?: boolean;
  maxWait?: number;
}

/** Функции темы: часы, debounce, throttle и rAF-throttle (`CLOCK_CODE`, `DEBOUNCE_CODE`, …). */
export interface WrapperApi {
  createClock(frame?: number): Clock;
  debounce(fn: Fn, wait: number, options: DebounceOptions, clock: Clock): Wrapped;
  throttle(fn: Fn, wait: number, options: Omit<DebounceOptions, 'maxWait'>, clock: Clock): Wrapped;
  rafThrottle(fn: Fn, clock: Clock): Wrapped;
}

export interface Limit {
  take(now: number): boolean;
}

/** Ограничители темы (`TOKEN_CODE`, `LEAKY_CODE`, `FIXED_CODE`, `SLIDING_LOG_CODE`, `SLIDING_COUNTER_CODE`). */
export interface LimiterApi {
  createTokenBucket(o: { rate: number; burst: number }): Limit & { tokens(now: number): number };
  createLeakyBucket(o: { rate: number; capacity: number }): { offer(now: number): number | null };
  createFixedWindow(o: { limit: number; window: number }): Limit;
  createSlidingLog(o: { limit: number; window: number }): Limit;
  createSlidingCounter(o: { limit: number; window: number }): Limit;
}

/** Строки кода темы, которые исполняет демо. */
export interface RateCode {
  clock: string;
  debounce: string;
  throttle: string;
  raf: string;
  token: string;
  leaky: string;
  fixed: string;
  log: string;
  counter: string;
}

/** Готовая лента событий для демо. `times` — моменты событий в мс, по возрастанию. */
export interface TapePreset {
  id: string;
  label: string;
  times: number[];
  /** Что увидеть на этой ленте. Строчная разметка. */
  note: string;
}

/** Дорожка обёрток: вызовы функции. */
export interface WrapperLane {
  id: string;
  label: string;
  calls: Call[];
}

/** Решение ограничителя по одному событию ленты. */
export interface Verdict {
  /** Номер события в ленте. */
  i: number;
  t: number;
  ok: boolean;
  /** Для ведра-очереди — когда запрос вышел из ведра. */
  out?: number;
}

export interface LimiterLane {
  id: string;
  label: string;
  verdicts: Verdict[];
  /** Сколько пропущено за худшие `window` мс подряд. */
  worst: number;
}
