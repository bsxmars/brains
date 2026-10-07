/** Строки кода темы «Ограничение частоты в API», которые исполняют демо и тест. */
export interface RetryCode {
  retryAfter: string;
  backoff: string;
  policy: string;
  breaker: string;
  sim: string;
}

export type Strategy = 'none' | 'full' | 'equal' | 'decorrelated';
export type RetryAfterMode = 'ignore' | 'exact' | 'jitter';

export interface PolicyOptions {
  maxRetries?: number;
  base?: number;
  cap?: number;
  strategy?: Strategy;
  seed?: number;
  retryAfter?: RetryAfterMode;
  maxRetryAfter?: number;
  budget?: { ratio: number; reserve: number } | null;
}

export interface Decision {
  retry: boolean;
  delay?: number;
  why: string;
}

export interface Outcome {
  status?: number;
  retryAfter?: string | null;
  code?: string;
}

export interface RetryPolicy {
  started(): void;
  decide(
    req: { method: string; idempotencyKey?: string },
    outcome: Outcome,
    state: { attempt: number; prev?: number; now?: number },
  ): Decision;
}

export interface Breaker {
  allow(now: number): boolean;
  record(ok: boolean, now: number): void;
}

export interface SimOptions {
  starts: number[];
  downUntil?: number;
  rate?: number;
  burst?: number;
  latency?: number;
  policy?: PolicyOptions;
  breaker?: { threshold?: number; cooldown?: number } | null;
}

export interface SimResult {
  calls: number;
  ok: number;
  s429: number;
  s503: number;
  fastFail: number;
  gaveUp: number;
  lastOk: number | null;
  /** `[момент на сервере, статус]` по каждому запросу, дошедшему до сервера. */
  log: [number, number][];
}

export interface RetryApi {
  parseRetryAfter(value: string | null | undefined, now: number): number | null;
  seeded(seed: number): () => number;
  backoff(strategy: Strategy, attempt: number, prev: number, opts: { base: number; cap: number }, random: () => number): number;
  createRetryPolicy(options?: PolicyOptions): RetryPolicy;
  createBreaker(options?: { threshold?: number; cooldown?: number }): Breaker;
  simulate(options: SimOptions): SimResult;
}

/** Сценарий демо «стадо после сбоя»: те же числа стоят в таблице темы и в тесте. */
export interface HerdPreset {
  clients: number;
  downUntil: number;
  rate: number;
  latency: number;
  base: number;
  cap: number;
  maxRetries: number;
  /** Ширина столбика гистограммы, мс. */
  bin: number;
}

export interface Bin {
  ok: number;
  s429: number;
  s503: number;
}
