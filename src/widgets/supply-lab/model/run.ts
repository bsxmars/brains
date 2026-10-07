import type { SriApi } from './types';

/**
 * Демо и тест спрашивают одну и ту же функцию — строку `SRI_CODE` из темы.
 *
 * Строка напечатана на странице, собрана здесь `new Function` и прогоняется
 * `tests/unit/supply-chain.test.ts` против `ssri` и `node:crypto` на наборе файлов и против
 * настоящего Chromium на атрибутах `<script integrity>`. Хеши считает Web Crypto
 * (`crypto.subtle`) — он есть и в браузере, и в Node, поэтому копии кода нет.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadSri(code: string): SriApi {
  return new Function(
    `${code}\nreturn { KNOWN, digest, integrityOf, parseIntegrity, checkIntegrity, verdict };`,
  )() as SriApi;
}

/** Байты из base64 — без `Buffer`, чтобы работало в браузере. */
export function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Распаковывается ли gzip — `DecompressionStream`, тот же zlib-формат, что читает npm.
 * Нужен демо, чтобы честно сказать, на чём npm остановится раньше: на распаковке или на хеше.
 * Тест сверяет ответ с `zlib.gunzipSync` на каждом однобитном искажении тарбола стенда.
 */
export async function gunzipOk(bytes: Uint8Array): Promise<boolean> {
  try {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
    await new Response(stream).arrayBuffer();
    return true;
  } catch {
    return false;
  }
}

/**
 * На чём остановится `npm ci` с этим архивом вместо записанного: на распаковке
 * (`Z_DATA_ERROR`) или на хеше (`EINTEGRITY`). Правило снято стендом и сверяется тестом
 * с настоящим npm: без подписи gzip `1f 8b` в начале npm не распаковывает файл как gzip,
 * и до ошибки zlib не доходит; с подписью, но битым потоком — zlib падает раньше хеша.
 * Вызывать только для байтов, хеш которых уже не совпал.
 */
export async function npmOutcome(bytes: Uint8Array): Promise<'zlib' | 'integrity'> {
  const gzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
  return gzip && !(await gunzipOk(bytes)) ? 'zlib' : 'integrity';
}

/** Подставить значения в шаблон сообщения: `{wanted}` → `vars.wanted`. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** `sha512` → `SHA-512`: так алгоритм называет консоль Chromium. */
export const upperAlg = (alg: string) => alg.toUpperCase().replace(/^SHA/, 'SHA-');
