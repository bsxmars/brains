import type { CacheApi, CacheLogEntry, CacheMode, CacheRun, GraphApi, PublishApi, WsPackage } from './types';

/**
 * Демо и тест спрашивают одни и те же функции — строки `GRAPH_CODE`, `PUBLISH_CODE`
 * и `CACHE_CODE` из темы «Монорепозиторий».
 *
 * Строки напечатаны на странице, собраны здесь `new Function` и прогоняются
 * `tests/unit/monorepo.test.ts` против порядка `pnpm -r` и выборок `pnpm --filter`, снятых
 * стендом, а ключи кеша — против `node:crypto`. Копии нет: разойдётся показанный код с
 * настоящим поведением — покраснеет тест.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadGraph(code: string): GraphApi {
  return new Function(`${code}\nreturn { topoLevels, affected };`)() as GraphApi;
}

export function loadPublish(code: string): PublishApi {
  return new Function(`${code}\nreturn { publishSpec };`)() as PublishApi;
}

export function loadCache(code: string): CacheApi {
  return new Function(`${code}\nreturn { sha256, taskKey, buildPackage, runWithCache };`)() as CacheApi;
}

/**
 * Прогоны подряд с одним общим кешем — как в демо. Возвращает журнал каждого прогона.
 * Кеш создаётся заново на каждый вызов: режимы не делят записи между собой.
 */
export async function playRuns(
  api: CacheApi,
  packages: WsPackage[],
  levels: string[][],
  files: Record<string, Record<string, string>>,
  runs: CacheRun[],
  mode: Pick<CacheMode, 'declared' | 'strict'>,
): Promise<CacheLogEntry[][]> {
  const cache = new Map<string, string>();
  const out: CacheLogEntry[][] = [];
  for (const run of runs) {
    out.push(await api.runWithCache({ packages, levels, files, cache, env: run.env, declared: mode.declared, strict: mode.strict }));
  }
  return out;
}
