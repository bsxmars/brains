/**
 * Калькулятор политики изоляции ресурсов: компиляция и вызов **той же строки кода**,
 * которую тема печатает (`RIP_CODE` в `content/platform/xs-leaks/data.ts`).
 *
 * Строка приходит в остров пропом, а не импортом: виджет не знает, в какой теме живёт,
 * и не может «подправить» политику у себя. Демо, текст и тест исполняют один и тот же код —
 * `tests/unit/xs-leaks.test.ts` импортирует этот модуль и ту же строку.
 *
 * Модуль чистый: ни DOM, ни Vue. `new Function` здесь законен — код не читательский,
 * а авторский, и лежит в исходниках рядом с темой.
 */
export type FetchSite = 'same-origin' | 'same-site' | 'cross-site' | 'none';

export interface PolicyRequest {
  method: string;
  path: string;
  /** Имена в нижнем регистре, как их отдаёт `node:http`; отсутствующий заголовок — нет ключа. */
  headers: Record<string, string | undefined>;
}

export interface PolicyDecision {
  allow: boolean;
  /** Какая ветка политики сработала: `no-metadata`, `own-site`, `navigation`, `public-path`, `cross-site`. */
  rule: string;
}

export type Policy = (req: PolicyRequest) => PolicyDecision;

/** Имя функции, которую обязана объявить строка политики. */
export const POLICY_ENTRY = 'isolationPolicy';

export function compilePolicy(code: string): Policy {
  const make = new Function(`${code}\n;return typeof ${POLICY_ENTRY} === 'function' ? ${POLICY_ENTRY} : undefined;`);
  const fn = make() as Policy | undefined;
  if (typeof fn !== 'function') {
    throw new Error(`строка политики не объявляет функцию ${POLICY_ENTRY}`);
  }
  return fn;
}

/**
 * Запрос из трёх заголовков, метода и пути. `undefined` у `site` значит «заголовков нет вовсе»:
 * браузер присылает их тройкой или не присылает ни одного (замер на http — см. тему).
 */
export function buildRequest(
  site: FetchSite | undefined,
  mode: string,
  dest: string,
  method: string,
  path: string,
): PolicyRequest {
  const headers: Record<string, string | undefined> = {};
  if (site !== undefined) {
    headers['sec-fetch-site'] = site;
    headers['sec-fetch-mode'] = mode;
    headers['sec-fetch-dest'] = dest;
  }
  return { method, path, headers };
}
