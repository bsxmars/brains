/**
 * Формы данных демо «канарейка по шагам». Описывают то, что возвращают строки
 * `MODEL_PARTS` темы «Прогрессивная доставка», — ровно в той части, которую читают
 * демо и тест.
 */

export type Verdict = 'continue' | 'wait' | 'rollback';

export interface Side {
  n: number;
  errors: number;
  lat: number[];
}

export interface Interval {
  p: number;
  lo: number;
  hi: number;
}

export interface QuantileCI {
  v: number;
  lo: number;
  hi: number;
}

export interface ErrorsJudgement {
  verdict: Verdict;
  ci: Interval;
  limit: number;
  why: string;
}

export interface LatencyJudgement {
  verdict: Verdict;
  ci: QuantileCI;
  base: number;
  limit: number;
  why: string;
}

export interface Decision {
  verdict: Verdict;
  errors: ErrorsJudgement;
  latency: LatencyJudgement;
}

export interface ScenarioParams {
  baseErr: number;
  nextErr: number;
  nextSlow: number;
}

export interface TrafficOptions {
  seed?: number;
  perMinute?: number;
  users?: number;
  median?: number;
  sigma?: number;
}

export interface Traffic {
  stats: { base: Side; next: Side };
  tick(route: (id: string) => 'base' | 'next'): void;
  minute(): number;
}

export type Step = { setWeight: number } | { pause: { duration?: string | number } };

export interface PlanRow {
  weight: number;
  minute: number;
  extra?: number;
  verdict: Verdict | 'hold';
  why?: string;
  canary?: { n: number; errors: number };
  decision?: Decision;
}

export interface PlanResult {
  outcome: 'promoted' | 'rolledBack' | 'hold';
  rows: PlanRow[];
}

export interface AnalysisConfig {
  z?: number;
  minRequests?: number;
  errorMargin?: number;
  q?: number;
  latencyRatio?: number;
}

export interface Flag {
  key: string;
  percent: number;
  killed?: boolean;
}

/** То, что возвращают строки `MODEL_PARTS`. */
export interface Model {
  fnv1a(text: string): number;
  hash32(text: string): number;
  bucketOf(salt: string, id: string): number;
  inRollout(salt: string, id: string, percent: number): boolean;
  flagOn(flag: Flag | undefined | null, id: string): boolean;
  wilson(x: number, n: number, z: number): Interval;
  quantile(sorted: ArrayLike<number>, q: number, z: number): QuantileCI;
  judgeErrors(base: { n: number; errors: number }, canary: { n: number; errors: number }, cfg?: AnalysisConfig): ErrorsJudgement;
  judgeLatency(base: Side, canary: Side, cfg?: AnalysisConfig): LatencyJudgement;
  decide(base: Side, canary: Side, cfg?: AnalysisConfig): Decision;
  ANALYSIS: Required<AnalysisConfig>;
  mulberry32(seed: number): () => number;
  createTraffic(scenario: ScenarioParams, opts?: TrafficOptions): Traffic;
  TRAFFIC: Required<TrafficOptions>;
  minutesOf(duration: string | number | undefined): number | null;
  stagesOf(steps: Step[]): { weight: number; minutes: number | null }[];
  flaggerSteps(analysis: { stepWeight: number; maxWeight: number; interval: string }): Step[];
  runPlan(
    steps: Step[],
    scenario: ScenarioParams,
    opts?: { salt?: string; extraMinutes?: number; traffic?: TrafficOptions; analysis?: AnalysisConfig },
  ): PlanResult;
  compatible(
    code: { reads: string[]; writes: string[] },
    schema: Record<string, 'required' | 'optional'>,
  ): { ok: boolean; missing: string[]; unfilled: string[] };
}

export type Mode = 'canary' | 'flag';

/** Одна накопленная минута в ручном режиме демо: какая была доля и был ли выключен флаг. */
export interface Minute {
  weight: number;
  killed: boolean;
}

export interface Replay {
  stats: { base: Side; next: Side };
  /** Решение анализа после каждой минуты — по накопленным числам. */
  log: { minute: number; weight: number; killed: boolean; decision: Decision }[];
}
