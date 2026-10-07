import type { FontDisplayApi, OverridesFn, RangeApi } from './types';

/**
 * Демо и тест спрашивают одни и те же функции — строки `FONT_DISPLAY_CODE`, `OVERRIDES_CODE`
 * и `RANGE_CODE` из темы «Шрифты и текст».
 *
 * Строки напечатаны на странице, собраны здесь `new Function` и сверяются
 * `tests/unit/fonts-text.test.ts` с тем, что Chromium показал на стенде: фазы `font-display`
 * при разных задержках шрифта, подгонку запасного шрифта без сдвига, файлы подмножеств,
 * которые браузер запросил под текст. Копии нет — разойдётся показанный код со стендом,
 * покраснеет тест.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadFontDisplay(code: string): FontDisplayApi {
  return new Function(`${code}\nreturn { PERIODS, fontPhase };`)() as FontDisplayApi;
}

export function loadOverrides(code: string): OverridesFn {
  return new Function(`${code}\nreturn fallbackOverrides;`)() as OverridesFn;
}

export function loadRanges(code: string): RangeApi {
  return new Function(`${code}\nreturn { parseRange, facesToFetch };`)() as RangeApi;
}
