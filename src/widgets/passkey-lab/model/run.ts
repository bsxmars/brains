import type { PasskeyScenario, VerifyResult, WebAuthnApi } from './types';

/**
 * Демо и тест спрашивают одни и те же функции — строки `AUTHDATA_CODE` и `VERIFY_CODE` из темы
 * «Passkeys и WebAuthn».
 *
 * Строки напечатаны на странице, собраны здесь `new Function` и прогоняются
 * `tests/unit/passkeys.test.ts` против `@simplewebauthn/server` на ответах, снятых в Chromium
 * с виртуальным аутентификатором. Копии нет: если показанный код разойдётся с библиотекой,
 * покраснеет тест.
 *
 * Проверка подписи — `crypto.subtle`, он есть и в браузере (в безопасном контексте), и в Node 24.
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadWebAuthn(authDataCode: string, verifyCode: string): WebAuthnApi {
  return new Function(
    `${authDataCode}\n${verifyCode}\nreturn { b64url, toB64url, hex, readCbor, parseAuthData, derToRaw, coseToJwk, verifyRegistration, verifyAssertion };`,
  )() as WebAuthnApi;
}

/** Бит флага по имени — как в `parseAuthData`. */
export const FLAG_BITS: { name: string; bit: number }[] = [
  { name: 'ED', bit: 7 },
  { name: 'AT', bit: 6 },
  { name: '—', bit: 5 },
  { name: 'BS', bit: 4 },
  { name: 'BE', bit: 3 },
  { name: 'UV', bit: 2 },
  { name: '—', bit: 1 },
  { name: 'UP', bit: 0 },
];

/** Ответ входа с другим байтом флагов: остальное, включая подпись, — как прислал браузер. */
export function withFlags(api: WebAuthnApi, s: PasskeyScenario, flags: number): PasskeyScenario {
  const bytes = api.b64url(s.cred.response.authenticatorData);
  if (bytes[32] === flags) return s;
  bytes[32] = flags;
  return {
    ...s,
    cred: { ...s.cred, response: { ...s.cred.response, authenticatorData: api.toB64url(bytes) } },
  };
}

/**
 * Прогон сценария так, как его прошёл бы сервер: для входа сначала регистрация (`reg`) —
 * из неё берётся сохранённый ключ, — затем проверка ответа с тем счётчиком, что хранился.
 */
export async function runScenario(api: WebAuthnApi, s: PasskeyScenario, reg: PasskeyScenario): Promise<VerifyResult> {
  if (s.kind === 'create') return api.verifyRegistration(s.cred, s.expected);
  const registered = await api.verifyRegistration(reg.cred, reg.expected);
  if (!registered.credential) throw new Error('регистрация стенда не прошла проверку');
  return api.verifyAssertion(s.cred, s.expected, { ...registered.credential, signCount: s.stored ?? 0 });
}
