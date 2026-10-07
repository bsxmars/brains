import type { NegotiateApi } from './types';

/**
 * Демо и тест спрашивают одни и те же функции — строку `NEGOTIATE_CODE` из темы
 * «Сжатие в вебе: gzip, Brotli, zstd».
 *
 * Строка напечатана на странице, собрана здесь `new Function` и прогоняется
 * `tests/unit/compression.test.ts`: на примерах RFC 9110, на заголовках, которые прислали
 * Chromium 153, Node и curl, и против таблицы ответов negotiator, sirv и h3 со стенда. Копии нет —
 * разойдётся показанный код с таблицей, покраснеет тест.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadNegotiate(code: string): NegotiateApi {
  return new Function(`${code}\nreturn { parseAcceptEncoding, weight, negotiate };`)() as NegotiateApi;
}
