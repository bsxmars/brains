/**
 * Сертификат стенда в виде фактов: то, что учебная проверка спрашивает у `X509Certificate`.
 * Сняты с настоящих сертификатов учебного УЦ (см. шапку `data.ts` темы); тест сверяет каждое
 * поле с `node:crypto`. Закрытых ключей здесь нет и быть не должно.
 */
export interface CertFact {
  id: string;
  label: string;
  /** Как печатает `X509Certificate.subject`, поля через «, ». */
  subject: string;
  issuer: string;
  /** basicConstraints CA:TRUE. */
  ca: boolean;
  /** Как `X509Certificate.subjectAltName`: `DNS:a, DNS:b`; `null` — расширения нет. */
  san: string | null;
  /** ISO-время notBefore / notAfter. */
  from: string;
  to: string;
  /** Subject / Authority Key Identifier — по ним издатель находится среди кандидатов. */
  ski: string;
  aki: string;
  /** Размер DER в байтах — столько сертификат весит в сообщении Certificate. */
  der: number;
  /** SHA-256 отпечаток. */
  fp: string;
  pem: string;
}

/** Минимум интерфейса `X509Certificate`, которым пользуется `verifyChain`. */
export interface CertLike {
  subject: string;
  issuer: string;
  ca: boolean;
  subjectAltName: string | undefined;
  validFromDate: Date;
  validToDate: Date;
  fingerprint256: string;
  publicKey: unknown;
  checkIssued(other: CertLike): boolean;
  verify(publicKey: unknown): boolean;
}

export type Step = 'chain' | 'ca' | 'signature' | 'time' | 'name';

export interface VerifyError {
  step: Step;
  code: string;
  /** Глубина в цепочке: 0 — лист. */
  depth: number;
}

export interface VerifyResult<C = CertLike> {
  chain: C[];
  errors: VerifyError[];
  code: string | null;
}

export type VerifyFn = <C extends CertLike>(input: {
  presented: C[];
  roots: C[];
  host: string;
  now: Date;
}) => VerifyResult<C>;

/** Подписи шагов и кодов для демо. Строчная разметка. */
export interface StepInfo {
  id: Step;
  label: string;
}
