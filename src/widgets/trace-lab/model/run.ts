import type { StatsApi, TraceparentApi, TreeApi } from './types';

/**
 * Демо и тест спрашивают одни и те же функции — строки `TRACEPARENT_CODE`, `TREE_CODE`
 * и `STATS_CODE` из темы «Наблюдаемость».
 *
 * Строки напечатаны на странице, собраны здесь `new Function` и прогоняются
 * `tests/unit/observability.test.ts`: разбор заголовка — против `W3CTraceContextPropagator`
 * из `@opentelemetry/core`, дерево — против спанов, которые записал SDK. Копии нет.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadTraceparent(code: string): TraceparentApi {
  return new Function(`${code}\nreturn { parseTraceparent, formatTraceparent };`)() as TraceparentApi;
}

export function loadTree(code: string): TreeApi {
  return new Function(`${code}\nreturn { buildTree, waterfall };`)() as TreeApi;
}

export function loadStats(code: string): StatsApi {
  return new Function(`${code}\nreturn { percentile, mean, bucketCounts, percentileFromBuckets };`)() as StatsApi;
}
