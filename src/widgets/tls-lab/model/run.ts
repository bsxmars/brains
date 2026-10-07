import type { CertFact, CertLike, VerifyFn } from './types';

/**
 * Демо и тест спрашивают одну и ту же проверку — строку `VERIFY_CODE` из темы.
 *
 * Строка напечатана на странице, собрана здесь `new Function` и прогоняется
 * `tests/unit/tls-certificates.test.ts` дважды: на настоящих `X509Certificate` против решений
 * `tls.connect` Node и на заменителях из `toCertLike` — те же ответы. Копии нет.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadVerify(code: string): VerifyFn {
  return new Function(`${code}\nreturn verifyChain;`)() as VerifyFn;
}

/**
 * В браузере нет `node:crypto`, поэтому демо даёт проверке заменитель `X509Certificate`
 * из фактов стенда. Подпись здесь не считается: «подписал» означает «AKI этого сертификата
 * совпал с SKI того» — для сертификатов стенда это верно, и тест сверяет `checkIssued`
 * и `verify` заменителя с настоящими на всех парах.
 */
export function toCertLike(fact: CertFact): CertLike {
  return {
    subject: fact.subject,
    issuer: fact.issuer,
    ca: fact.ca,
    subjectAltName: fact.san ?? undefined,
    validFromDate: new Date(fact.from),
    validToDate: new Date(fact.to),
    fingerprint256: fact.fp,
    publicKey: { ski: fact.ski },
    checkIssued(other) {
      return this.issuer === other.subject && fact.aki === (other.publicKey as { ski: string }).ski;
    },
    verify(publicKey) {
      return fact.aki === (publicKey as { ski: string }).ski;
    },
  };
}
