import type { BundlerApi, ChunkHashesFn } from './types';

/**
 * Демо и тест спрашивают одни и те же функции — строки `GRAPH_CODE`, `SHAKE_CODE`
 * и `HOIST_CODE` из темы «Бандлер изнутри», склеенные в том же порядке, в каком они
 * напечатаны на странице.
 *
 * `tests/unit/bundler-internals.test.ts` собирает те же файлы настоящим rolldown и сверяет
 * вывод с `bundle` посимвольно (табуляция rolldown заменена двумя пробелами). Копии нет:
 * разойдётся показанный код с rolldown — покраснеет тест.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadBundler(graphCode: string, shakeCode: string, hoistCode: string): BundlerApi {
  return new Function(
    `${graphCode}\n${shakeCode}\n${hoistCode}\nreturn { resolve, buildGraph, shake, bundle };`,
  )() as BundlerApi;
}

/** `HASH_CODE` из темы: хеши чанков с каскадом от листьев ко входу. */
export function loadChunkHashes(code: string): ChunkHashesFn {
  return new Function(`${code}\nreturn chunkHashes;`)() as ChunkHashesFn;
}
