import type { Finding, LoadEnvApi, ScanApi, ScanSample } from './types';

/**
 * Демо и тест спрашивают одни и те же функции — строки `LOAD_ENV_CODE` и `SCAN_CODE` из темы
 * «Секреты и конфигурация».
 *
 * Строки напечатаны на странице, собраны здесь `new Function` и прогоняются
 * `tests/unit/secrets-config.test.ts`: `loadEnvFiles` — против `loadEnv` из настоящего Vite
 * на всех сочетаниях файлов, режимов и префиксов, `scanSecrets` — на бандлах, которые собирают
 * Vite и esbuild. Копии нет: разойдётся показанный код с библиотекой — покраснеет тест.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadEnvApi(code: string): LoadEnvApi {
  return new Function(`${code}\nreturn { parseDotenv, envFilesFor, loadEnvFiles };`)() as LoadEnvApi;
}

export function loadScan(code: string): ScanApi {
  return new Function(`${code}\nreturn { entropy, scanSecrets };`)() as ScanApi;
}

export interface ScanVerdict {
  /** Находки, в которых есть настоящий секрет образца. */
  caught: Finding[];
  /** Находки без секрета — ложная тревога. */
  noise: Finding[];
  /** Секреты образца, которых сканер не увидел. */
  missed: string[];
}

/** Разложить находки по образцу: пойманное, ложная тревога, пропущенное. */
export function judge(sample: ScanSample, found: Finding[]): ScanVerdict {
  const hits = (f: Finding) => sample.secrets.some((s) => f.value.includes(s) || s.includes(f.value));
  return {
    caught: found.filter(hits),
    noise: found.filter((f) => !hits(f)),
    missed: sample.secrets.filter((s) => !found.some((f) => f.value.includes(s) || s.includes(f.value))),
  };
}
