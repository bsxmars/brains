/** Ответ `verifyJwt` из темы: либо нагрузка, либо причина отказа словами. */
export type VerifyResult = { ok: true; payload: Record<string, unknown> } | { ok: false; reason: string };

/** Функции темы «Аутентификация», собранные из строк `JWT_CODE` и `PKCE_CODE`. */
export interface AuthApi {
  b64url(bytes: Uint8Array): string;
  fromB64url(str: string): Uint8Array;
  signJwt(payload: Record<string, unknown>, secret: string | Uint8Array): Promise<string>;
  verifyJwt(token: string, secret: string | Uint8Array, now?: number): Promise<VerifyResult>;
  randomVerifier(): string;
  isValidVerifier(verifier: string): boolean;
  pkceChallenge(verifier: string): Promise<string>;
}

/** Вариант токена в демо «Разбери JWT». */
export interface JwtVariant {
  id: string;
  label: string;
  /** Готовый токен. Если его нет — демо подписывает `resign` ключом из поля ввода. */
  token?: string;
  resign?: Record<string, unknown>;
  /** Момент проверки, секунды с эпохи: часы демо стоят, чтобы токен стенда не протух. */
  at: number;
  /** Что здесь произошло. Строчная разметка. */
  note: string;
}

/** Шаг обмена, снятого стендом. */
export interface FlowStep {
  id: string;
  /** Кто → кому, словами: «браузер → сервер авторизации». */
  route: string;
  title: string;
  /** Строка запроса или ответа, как в сети: `GET /authorize`, `302 Found`. */
  line: string;
  /** Параметры запроса или поля ответа: имя, значение, выделить ли. */
  params: { k: string; v: string; hot?: boolean }[];
  /** Пояснение. Строчная разметка. */
  note: string;
}
