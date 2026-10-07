/** Кто сверяет хеш: браузер по спецификации SRI или npm через библиотеку `ssri`. */
export type Mode = 'browser' | 'npm';

/** Ответ `checkIntegrity` из темы. */
export interface IntegrityCheck {
  /** `none` — в строке не нашлось ни одного годного хеша. */
  result: 'match' | 'mismatch' | 'none';
  /** Сильнейший алгоритм из перечисленных — только по нему и сверяют. */
  alg: string | null;
  /** Хеши этого алгоритма из строки. */
  wanted: string[];
  /** Хеш настоящих байтов тем же алгоритмом. */
  got: string | null;
}

/** То, что возвращает строка `SRI_CODE`, собранная `new Function`. */
export interface SriApi {
  KNOWN: Record<Mode, string[]>;
  digest(alg: string, bytes: Uint8Array): Promise<string>;
  integrityOf(bytes: Uint8Array, algs?: string[]): Promise<string>;
  parseIntegrity(text: string, mode: Mode): { alg: string; digest: string }[];
  checkIntegrity(bytes: Uint8Array, text: string, mode: Mode): Promise<IntegrityCheck>;
  verdict(check: IntegrityCheck, mode: Mode): 'pass' | 'fail';
}

/** Вариант атрибута `integrity` у `<script>` в демо. */
export interface AttrVariant {
  id: string;
  label: string;
  integrity: string;
  /** Что в варианте важно. Строчная разметка. */
  note: string;
}

/** Всё, что демо получает из темы: байты стенда, записи и шаблоны сообщений. */
export interface SupplyDemo {
  /** Тарбол `greeter-1.0.0.tgz` стенда, base64. */
  tarball: string;
  /** Поле `integrity` его записи в `package-lock.json`. */
  lockIntegrity: string;
  /** Скрипт на CDN — текст. */
  libJs: string;
  libUrl: string;
  variants: AttrVariant[];
  /**
   * Шаблоны сообщений, снятые стендом. Подстановки: `{wanted}`, `{alg}`, `{got}`, `{size}`,
   * `{url}`, `{ALG}` (имя алгоритма, как его печатает Chromium: `SHA-512`).
   */
  npmIntegrityError: string;
  npmZlibError: string;
  chromiumBlocked: string;
}
