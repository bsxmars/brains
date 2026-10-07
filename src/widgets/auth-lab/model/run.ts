import type { AuthApi } from './types';

/**
 * Демо и тест спрашивают одни и те же функции — строки `JWT_CODE` и `PKCE_CODE` из темы
 * «Аутентификация».
 *
 * Строки напечатаны на странице, собраны здесь `new Function` и прогоняются
 * `tests/unit/authentication.test.ts` против тестовых векторов RFC 7515 и RFC 7636 и против
 * `node:crypto`. Копии нет: если показанный код разойдётся с эталоном, покраснеет тест.
 *
 * Web Crypto (`crypto.subtle`) есть и в браузере, и в Node 24, поэтому один и тот же код
 * работает в обоих. Он асинхронный — подпись, проверка и хеш возвращают промисы.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadAuth(jwtCode: string, pkceCode: string): AuthApi {
  return new Function(
    `${jwtCode}\n${pkceCode}\nreturn { b64url, fromB64url, signJwt, verifyJwt, randomVerifier, isValidVerifier, pkceChallenge };`,
  )() as AuthApi;
}
