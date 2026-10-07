import type { AutoPlace, FrApi, ResolveFlex } from './types';

/**
 * Демо и тест спрашивают одни и те же функции — строки `FLEX_CODE`, `FR_CODE` и `PLACE_CODE`
 * из темы «Раскладка изнутри».
 *
 * Строки напечатаны на странице, собраны здесь `new Function` и сверяются
 * `tests/unit/layout-internals.test.ts` с размерами, которые Chromium отдал через
 * `getBoundingClientRect` на тех же фикстурах. Копии нет — если показанный код разойдётся
 * с движком, покраснеет тест.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadFlex(code: string): ResolveFlex {
  return new Function(`${code}\nreturn resolveFlex;`)() as ResolveFlex;
}

export function loadFr(code: string): FrApi {
  return new Function(`${code}\nreturn { resolveFr, autoRepeat };`)() as FrApi;
}

export function loadPlace(code: string): AutoPlace {
  return new Function(`${code}\nreturn autoPlace;`)() as AutoPlace;
}
