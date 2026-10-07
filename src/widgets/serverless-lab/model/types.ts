/** Запрос в профиле трафика: когда пришёл и сколько длится, логические миллисекунды. */
export interface Req {
  at: number;
  dur: number;
}

export interface ScaleOptions {
  concurrency: number;
  keepWarm: number;
  poolMax: number;
  dbLimit: number;
}

export interface ScalePoint {
  t: number;
  instances: number;
  conns: number;
  /** Запросов, которые держат соединение. */
  running: number;
  /** Запросов, которые ждут соединения в пуле. */
  waiting: number;
}

export interface ScaleResult {
  coldStarts: number;
  peakInstances: number;
  peakConns: number;
  refused: number;
  maxWait: number;
  timeline: ScalePoint[];
}

export type SimulateFn = (requests: Req[], options: ScaleOptions) => ScaleResult;

export interface ScaleProfile {
  id: string;
  label: string;
  /** Строчная разметка. */
  note: string;
  requests: Req[];
}

export interface ScalePlatform {
  id: string;
  label: string;
  concurrency: number;
  poolMax: number;
}

/**
 * Вывод эмулятора платформы на настоящем Postgres (см. шапку `data.ts` темы).
 * `timeline` — `[t, экземпляров, соединений, запросов с соединением, ждут пула]`.
 */
export interface StandRun {
  coldStarts: number;
  /** Сколько раз исполнился код верхнего уровня — сосчитано в самих экземплярах. */
  inits: number;
  peakInstances: number;
  peakConns: number;
  refused: number;
  maxWait: number;
  /** Коды ошибок Postgres при отказе в соединении. */
  errors: string[];
  timeline: number[][];
}

export interface LatencyParts {
  setup: number;
  db: number;
  total: number;
  ttfb: number;
}

export interface CompareInput {
  near: number;
  far: number;
  local: number;
  queries: number;
  setupTrips: number;
  stream: boolean;
}

export type CompareFn = (input: CompareInput) => { edge: LatencyParts; region: LatencyParts };
export type LatencyFn = (input: { userRtt: number; dbRtt: number; queries: number; setupTrips: number; stream: boolean }) => LatencyParts;

/** Где пользователь. `far` — условный RTT до региона базы, мс; координаты — для проверки предела оптоволокна. */
export interface PlacePreset {
  id: string;
  label: string;
  far: number;
  lat: number;
  lon: number;
}
