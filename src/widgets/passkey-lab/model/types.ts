/** Ответ браузера в том виде, в каком его шлёт `cred.toJSON()`: поля нужные проверке. */
export interface CredentialJSON {
  id: string;
  rawId?: string;
  type?: string;
  authenticatorAttachment?: string;
  clientExtensionResults?: Record<string, unknown>;
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    /** Только у `create`. */
    attestationObject?: string;
    publicKey?: string;
    publicKeyAlgorithm?: number;
    transports?: string[];
    /** Только у `get`. */
    signature?: string;
    userHandle?: string;
  };
}

/** Чего ждёт сервер: выданный challenge, разрешённый origin, свой `rp.id`, нужен ли флаг UV. */
export interface Expected {
  challenge: string;
  origin: string;
  rpId: string;
  requireUV: boolean;
}

/** Строка отчёта: имя проверки, что пришло, что ожидалось. Пройдена, если `got === want`. */
export interface Check {
  k: string;
  got: string | number | boolean;
  want: string | number | boolean;
}

export interface AuthData {
  rpIdHash: Uint8Array;
  flags: { UP: boolean; UV: boolean; BE: boolean; BS: boolean; AT: boolean; ED: boolean };
  signCount: number;
  aaguid?: Uint8Array;
  credentialId?: Uint8Array;
  /** Ключ COSE: словарь с числовыми ключами. */
  publicKey?: Map<number, unknown>;
}

/** Запись о ключе, которую сервер сохранил при регистрации. */
export interface StoredCredential {
  id: string;
  jwk: JsonWebKey;
  signCount: number;
  BE: boolean;
  BS: boolean;
}

export interface VerifyResult {
  ok: boolean;
  checks: Check[];
  auth: AuthData;
  credential?: StoredCredential | null;
}

/** Функции темы, собранные из строк `AUTHDATA_CODE` и `VERIFY_CODE`. */
export interface WebAuthnApi {
  b64url(s: string): Uint8Array;
  toB64url(bytes: Uint8Array): string;
  hex(bytes: Uint8Array): string;
  readCbor(bytes: Uint8Array, pos?: number): [unknown, number];
  parseAuthData(bytes: Uint8Array): AuthData;
  derToRaw(der: Uint8Array): Uint8Array;
  coseToJwk(cose: Map<number, unknown>): JsonWebKey;
  verifyRegistration(cred: CredentialJSON, expected: Expected): Promise<VerifyResult>;
  verifyAssertion(cred: CredentialJSON, expected: Expected, credential: StoredCredential): Promise<VerifyResult>;
}

/** Сценарий демо: ответ стенда и то, чего ждёт сервер. */
export interface PasskeyScenario {
  id: string;
  label: string;
  kind: 'create' | 'get';
  cred: CredentialJSON;
  expected: Expected;
  /** Для входа: счётчик, который сервер хранил к этому моменту. */
  stored?: number;
  /** Что здесь произошло. Строчная разметка. */
  note: string;
}
