/** Что сделать с сообщением по дороге: ничего, испортить байт, зашифровать без `auth`, для чужой подписки. */
export type PushMode = 'ok' | 'flip' | 'auth' | 'key';

/** Подписка в том виде, в каком её отдаёт `PushSubscription.toJSON()`: ключи в base64url. */
export interface SubscriptionKeys {
  p256dh: string;
  auth: string;
}

/** Функции из строк `PUSH_CODE` и `VAPID_CODE` темы «Web Push». */
export interface PushApi {
  b64url(bytes: Uint8Array): string;
  fromB64url(s: string): Uint8Array;
  hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array>;
  encryptPush(
    keys: SubscriptionKeys,
    text: string,
    opts?: { salt?: Uint8Array; serverKeys?: CryptoKeyPair },
  ): Promise<Uint8Array>;
  decryptPush(body: Uint8Array, uaKeys: CryptoKeyPair, auth: Uint8Array): Promise<string>;
  vapidAuth(endpoint: string, subject: string, keys: CryptoKeyPair, exp: number): Promise<string>;
  checkVapid(
    header: string | undefined,
    endpoint: string,
    subscribedKey: string,
    now: number,
  ): Promise<{ status: number; why: string }>;
}

/** Подписка «браузера» демо: пара ECDH, `auth` и то же самое в base64url — что получил бы сервер. */
export interface DemoSubscription {
  ua: CryptoKeyPair;
  auth: Uint8Array;
  keys: SubscriptionKeys;
}

/** Кусок тела aes128gcm: имя поля, границы в байтах и тон подсветки. */
export interface BodyPart {
  k: string;
  from: number;
  to: number;
  tone: 'info' | 'warn' | 'ok' | 'dim' | 'plain';
}

export interface DemoRun {
  /** Тело, которое пришло браузеру (после порчи, если она была). */
  body: Uint8Array;
  parts: BodyPart[];
  textBytes: number;
  /** Номер байта, изменённого в пути, — только для режима `flip`. */
  flipped: number | null;
  result: { ok: true; text: string } | { ok: false; error: string };
}
