import type { LookupFn, VlqApi } from './types';

/**
 * Демо и тест спрашивают одни и те же функции — строки `VLQ_CODE` и `LOOKUP_CODE` из темы.
 *
 * Строки напечатаны на странице, собраны здесь `new Function` и прогоняются
 * `tests/unit/source-maps.test.ts` против `@jridgewell/sourcemap-codec` и
 * `@jridgewell/trace-mapping` на картах, которые пишут esbuild и terser. Копии нет — если
 * показанный код разойдётся с библиотекой, покраснеет тест.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadVlq(code: string): VlqApi {
  return new Function(`${code}\nreturn { B64, readVlq, decodeMappings };`)() as VlqApi;
}

export function loadLookup(code: string): LookupFn {
  return new Function(`${code}\nreturn originalPositionFor;`)() as LookupFn;
}
