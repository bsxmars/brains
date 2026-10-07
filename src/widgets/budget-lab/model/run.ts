import type { CiApi, GraphApi, ManifestApi } from './types';

/**
 * Демо и тест спрашивают одни и те же функции — строки `GRAPH_CODE`, `MANIFEST_CODE`
 * и `CI_CODE` из темы «Бюджеты производительности».
 *
 * Строки напечатаны на странице, собраны здесь `new Function` и прогоняются
 * `tests/unit/performance-budgets.test.ts`: разбор импортов — против `es-module-lexer`
 * и `acorn` на всех чанках `dist/_astro`, замыкание — против логики `tests/e2e/weight.spec.ts`
 * на всех страницах сайта, адаптеры — против настоящих манифеста Vite и metafile esbuild.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadGraph(code: string): GraphApi {
  return new Function(`${code}\nreturn { parseImports, buildGraph, walk, pageChunks, whyIncluded, weigh };`)() as GraphApi;
}

export function loadManifest(code: string): ManifestApi {
  return new Function(`${code}\nreturn { fromViteManifest, fromMetafile };`)() as ManifestApi;
}

export function loadCi(code: string): CiApi {
  return new Function(`${code}\nreturn { stripHash, groupByName, checkBudget, report };`)() as CiApi;
}
