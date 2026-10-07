/**
 * Учебная проверка диапазонов semver: компиляция **той же строки кода**, которую печатает
 * тема (`SEMVER_CODE` в `content/tooling/package-managers/data.ts`).
 *
 * Строка приходит в остров пропом, а не импортом — виджет не знает, в какой теме живёт.
 * Демо, текст и тест исполняют один и тот же код: `tests/unit/package-managers.test.ts`
 * компилирует эту строку и сверяет каждый её ответ с настоящим пакетом `semver`.
 *
 * Модуль чистый: ни DOM, ни Vue. `new Function` законен — код авторский и лежит рядом с темой.
 */
export interface SemverApi {
  /** Попадает ли версия в диапазон — с правилом пререлизов, как у npm. */
  satisfies(version: string, range: string): boolean;
  /** Старшая версия из списка, попавшая в диапазон; `null`, если ни одна. */
  maxSatisfying(versions: string[], range: string): string | null;
  /** Диапазон, развёрнутый в наборы сравнений: `^1.2.3` → `[['>=1.2.3', '<2.0.0-0']]`. */
  desugar(range: string): string[][];
  /** −1, 0 или 1 — порядок двух версий по semver. */
  compare(a: string, b: string): number;
  /** Одно сравнение из развёртки: `check('1.3.0', '<2.0.0-0')`. Правила пререлизов здесь нет. */
  check(version: string, comparator: string): boolean;
}

export function compileSemver(code: string): SemverApi {
  const make = new Function(`${code}\n;return { satisfies, maxSatisfying, desugar, compare, check };`);
  return make() as SemverApi;
}
