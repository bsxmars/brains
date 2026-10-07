import type { CompareFn, LatencyFn, ScalePoint, SimulateFn, StandRun } from './types';

/**
 * Демо и тест спрашивают одни и те же функции — строки `SCALE_CODE` и `LATENCY_CODE` из темы.
 *
 * Строки напечатаны на странице, собраны здесь `new Function` и прогоняются
 * `tests/unit/serverless-edge.test.ts`: модель масштабирования — против вывода эмулятора
 * с настоящим Postgres (каждая точка временной линии) и против закона Литтла, модель задержки —
 * против аналитической границы «edge против региона».
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadSimulate(code: string): SimulateFn {
  return new Function(`${code}\nreturn simulate;`)() as SimulateFn;
}

export function loadLatency(code: string): { latency: LatencyFn; compare: CompareFn } {
  return new Function(`${code}\nreturn { latency, compare };`)() as { latency: LatencyFn; compare: CompareFn };
}

/** Временная линия стенда в том же виде, что у модели. */
export function standTimeline(run: StandRun): ScalePoint[] {
  return run.timeline.map(([t, instances, conns, running, waiting]) => ({ t, instances, conns, running, waiting }));
}
