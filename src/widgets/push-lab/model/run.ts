import type { BodyPart, DemoRun, DemoSubscription, PushApi, PushMode } from './types';

/**
 * Демо и тест спрашивают одни и те же функции — строки `PUSH_CODE` и `VAPID_CODE` из темы
 * «Web Push».
 *
 * Строки напечатаны на странице, собраны здесь `new Function` и прогоняются
 * `tests/unit/web-push.test.ts`: против примера из RFC 8291 (байт в байт), против тела, которое
 * шифрует пакет `web-push`, и против `webpush.getVapidHeaders`. Копии нет — если показанный код
 * разойдётся с пакетом или стандартом, покраснеет тест.
 *
 * Всё на `crypto.subtle`: он есть и в браузере (в безопасном контексте), и в Node 24.
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadPush(pushCode: string, vapidCode: string): PushApi {
  return new Function(
    `${pushCode}\n${vapidCode}\nreturn { b64url, fromB64url, hkdf, encryptPush, decryptPush, vapidAuth, checkVapid };`,
  )() as PushApi;
}

/** Новая подписка «браузера»: пара ECDH P-256 и 16 случайных байт `auth` — как делает `subscribe`. */
export async function makeSubscription(api: PushApi): Promise<DemoSubscription> {
  const ua = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const p256dh = new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey));
  return { ua, auth, keys: { p256dh: api.b64url(p256dh), auth: api.b64url(auth) } };
}

/** Поля тела aes128gcm по RFC 8188: заголовок 86 байт, затем шифротекст и 16 байт метки GCM. */
export function bodyParts(body: Uint8Array): BodyPart[] {
  const keyEnd = 21 + body[20];
  return [
    { k: 'salt', from: 0, to: 16, tone: 'info' },
    { k: 'rs', from: 16, to: 20, tone: 'dim' },
    { k: 'idlen', from: 20, to: 21, tone: 'dim' },
    { k: 'keyid', from: 21, to: keyEnd, tone: 'ok' },
    { k: 'шифротекст', from: keyEnd, to: body.length - 16, tone: 'plain' },
    { k: 'метка GCM', from: body.length - 16, to: body.length, tone: 'warn' },
  ];
}

/**
 * Один проход «сервер → push-сервис → браузер».
 * `ok` — как есть; `flip` — в пути изменён первый байт шифротекста; `auth` — отправитель знает
 * `p256dh`, но не `auth`; `key` — тело зашифровано для `other`, а расшифровывает `sub`.
 */
export async function runDemo(api: PushApi, sub: DemoSubscription, other: DemoSubscription, text: string, mode: PushMode): Promise<DemoRun> {
  let target = sub.keys;
  if (mode === 'auth') target = { p256dh: sub.keys.p256dh, auth: api.b64url(crypto.getRandomValues(new Uint8Array(16))) };
  if (mode === 'key') target = other.keys;

  const body = await api.encryptPush(target, text);
  let flipped: number | null = null;
  if (mode === 'flip') {
    flipped = 21 + body[20];
    body[flipped] ^= 0x01;
  }

  let result: DemoRun['result'];
  try {
    result = { ok: true, text: await api.decryptPush(body, sub.ua, sub.auth) };
  } catch (e) {
    const err = e as Error;
    result = { ok: false, error: err.message ? `${err.name}: ${err.message}` : err.name };
  }
  return { body, parts: bodyParts(body), textBytes: new TextEncoder().encode(text).length, flipped, result };
}

export const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
