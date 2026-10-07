import type { SrcsetApi } from './types';

/**
 * Демо и тест спрашивают одну и ту же функцию — строку `SRCSET_CODE` из темы «Картинки».
 *
 * Строка напечатана на странице, собрана здесь `new Function` и сверяется
 * `tests/unit/images.test.ts` с тем, что Chromium запросил на стенде при разных ширинах
 * вьюпорта и `deviceScaleFactor`. Копии нет: разойдётся показанный код со стендом — покраснеет тест.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadSrcset(code: string): SrcsetApi {
  return new Function(`${code}\nreturn { parseSrcset, slotWidth, pickCandidate };`)() as SrcsetApi;
}
