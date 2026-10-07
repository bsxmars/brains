import type {
  Call,
  Clock,
  LimiterApi,
  LimiterLane,
  RateCode,
  Verdict,
  WrapperApi,
  WrapperLane,
  Wrapped,
} from './types';

/**
 * Демо и тест спрашивают одни и те же функции — строки темы «Debounce, throttle и token bucket»
 * (`CLOCK_CODE`, `DEBOUNCE_CODE`, `THROTTLE_CODE`, `RAF_CODE`, `TOKEN_CODE`, `LEAKY_CODE`,
 * `FIXED_CODE`, `SLIDING_LOG_CODE`, `SLIDING_COUNTER_CODE`). Строки напечатаны на странице,
 * собраны здесь `new Function` и прогоняются `tests/unit/rate-limiting.test.ts`: debounce
 * и throttle — против `lodash-es` под `vi.useFakeTimers` на одних и тех же лентах событий,
 * ограничители — на свойствах. Копий кода нет.
 *
 * Ни DOM, ни Vue, ни настоящих таймеров: всё время — виртуальное.
 */

export function loadWrappers(code: Pick<RateCode, 'clock' | 'debounce' | 'throttle' | 'raf'>): WrapperApi {
  return new Function(
    `${code.clock}\n${code.debounce}\n${code.throttle}\n${code.raf}\nreturn { createClock, debounce, throttle, rafThrottle };`,
  )() as WrapperApi;
}

export function loadLimiters(code: Pick<RateCode, 'token' | 'leaky' | 'fixed' | 'log' | 'counter'>): LimiterApi {
  return new Function(
    `${code.token}\n${code.leaky}\n${code.fixed}\n${code.log}\n${code.counter}\n` +
      'return { createTokenBucket, createLeakyBucket, createFixedWindow, createSlidingLog, createSlidingCounter };',
  )() as LimiterApi;
}

/**
 * Прогнать ленту через обёртку на виртуальных часах темы: перед каждым событием часы доводятся
 * до его момента (по дороге срабатывают созревшие таймеры и кадры), в конце — до `end`.
 * Аргумент события — его номер в ленте, чтобы было видно, чьи данные дошли до функции.
 */
export function runTape(
  api: WrapperApi,
  times: number[],
  make: (fn: (arg: number) => void, clock: Clock) => Wrapped,
  end: number,
  frame = 16,
): Call[] {
  const clock = api.createClock(frame);
  const calls: Call[] = [];
  const wrapped = make((arg) => calls.push({ t: clock.now(), arg }), clock);
  times.forEach((t, i) => {
    clock.advanceTo(t);
    wrapped(i);
  });
  clock.advanceTo(end);
  return calls;
}

export interface WrapperParams {
  wait: number;
  /** 0 — без maxWait. */
  maxWait: number;
  frame?: number;
}

/** Все дорожки обёрток на одной ленте. */
export function runWrappers(api: WrapperApi, times: number[], p: WrapperParams, end: number): WrapperLane[] {
  const lanes: WrapperLane[] = [
    { id: 'debounce', label: 'debounce', calls: runTape(api, times, (fn, c) => api.debounce(fn, p.wait, {}, c), end) },
    {
      id: 'leading',
      label: 'debounce · leading',
      calls: runTape(api, times, (fn, c) => api.debounce(fn, p.wait, { leading: true }, c), end),
    },
  ];
  if (p.maxWait > 0) {
    lanes.push({
      id: 'maxwait',
      label: `debounce · maxWait ${Math.max(p.maxWait, p.wait)}`,
      calls: runTape(api, times, (fn, c) => api.debounce(fn, p.wait, { maxWait: p.maxWait }, c), end),
    });
  }
  lanes.push(
    { id: 'throttle', label: 'throttle', calls: runTape(api, times, (fn, c) => api.throttle(fn, p.wait, {}, c), end) },
    {
      id: 'raf',
      label: `rAF · кадр ${p.frame ?? 16} мс`,
      calls: runTape(api, times, (fn, c) => api.rafThrottle(fn, c), end, p.frame ?? 16),
    },
  );
  return lanes;
}

/** Наибольшее число моментов из отсортированного списка, попавших в полуинтервал длиной `window`. */
export function maxInWindow(sorted: number[], window: number): number {
  let best = 0;
  let j = 0;
  for (let i = 0; i < sorted.length; i++) {
    while (sorted[i] - sorted[j] >= window) j++;
    best = Math.max(best, i - j + 1);
  }
  return best;
}

export interface LimiterParams {
  /** Событий в секунду: скорость вёдер и лимит окна в 1000 мс. */
  rate: number;
  /** Ёмкость ведра жетонов и длина очереди дырявого ведра. */
  burst: number;
}

export const WINDOW = 1000;

/** Все ограничители на одной ленте; у ведра жетонов ещё и уровень жетонов во времени. */
export function runLimiters(
  api: LimiterApi,
  times: number[],
  p: LimiterParams,
  end: number,
): { lanes: LimiterLane[]; level: [number, number][] } {
  const verdicts = (take: (t: number) => boolean): Verdict[] => times.map((t, i) => ({ i, t, ok: take(t) }));
  const lane = (id: string, label: string, v: Verdict[]): LimiterLane => ({
    id,
    label,
    verdicts: v,
    worst: maxInWindow(
      v.filter((x) => x.ok).map((x) => x.out ?? x.t).sort((a, b) => a - b),
      WINDOW,
    ),
  });

  const bucket = api.createTokenBucket({ rate: p.rate, burst: p.burst });
  const level: [number, number][] = [];
  const tokenV = times.map((t, i) => {
    level.push([t, bucket.tokens(t)]);
    const ok = bucket.take(t);
    level.push([t, bucket.tokens(t)]);
    return { i, t, ok };
  });
  level.push([end, bucket.tokens(end)]);

  const leaky = api.createLeakyBucket({ rate: p.rate, capacity: p.burst });
  const leakyV = times.map((t, i) => {
    const out = leaky.offer(t);
    return out === null ? { i, t, ok: false } : { i, t, ok: true, out };
  });

  const opts = { limit: p.rate, window: WINDOW };
  const fixed = api.createFixedWindow(opts);
  const slog = api.createSlidingLog(opts);
  const counter = api.createSlidingCounter(opts);
  return {
    lanes: [
      lane('token', 'ведро жетонов', tokenV),
      lane('leaky', 'дырявое ведро', leakyV),
      lane('fixed', 'фиксированное окно', verdicts((t) => fixed.take(t))),
      lane('log', 'скользящий журнал', verdicts((t) => slog.take(t))),
      lane('counter', 'скользящий счётчик', verdicts((t) => counter.take(t))),
    ],
    level,
  };
}

/** Детерминированная лента: генератор mulberry32 с зерном `seed`. Серии плотных событий с паузами. */
export function seededTape(seed: number, n = 36): number[] {
  let s = seed;
  const rnd = () => {
    s = (s + 0x6d2b79f5) | 0;
    let x = Math.imul(s ^ (s >>> 15), 1 | s);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const out: number[] = [];
  let t = 0;
  for (let i = 0; i < n; i++) {
    const g = rnd();
    t += g < 0.15 ? 0 : g < 0.6 ? Math.floor(rnd() * 40) : g < 0.85 ? Math.floor(rnd() * 150) : Math.floor(rnd() * 500);
    out.push(t);
  }
  return out;
}
