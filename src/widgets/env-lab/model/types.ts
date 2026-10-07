/** Имя `.env`-файла → его текст. Нет ключа — нет файла. */
export type EnvFiles = Record<string, string>;

/** Результат `loadEnvFiles` из строки `LOAD_ENV_CODE`. */
export interface LoadedEnv {
  /** Что Vite положит в `import.meta.env`: только имена с префиксом. */
  env: Record<string, string>;
  /** Все прочитанные переменные — и с префиксом, и без. */
  all: Record<string, string>;
  /** Откуда взято итоговое значение: имя файла или `оболочка`. */
  from: Record<string, string>;
  /** Кого перебили: ключ → пары [откуда, значение] в порядке чтения. */
  lost: Record<string, [string, string][]>;
}

export type LoadEnvFn = (
  mode: string,
  files: EnvFiles,
  shell: Record<string, string>,
  prefixes?: string[],
) => LoadedEnv;

export interface LoadEnvApi {
  parseDotenv(text: string): Record<string, string>;
  envFilesFor(mode: string): string[];
  loadEnvFiles: LoadEnvFn;
}

/** Находка сканера: правило, найденная строка и её смещение в тексте. */
export interface Finding {
  rule: string;
  value: string;
  at: number;
}

export interface ScanOptions {
  minLen?: number;
  minBits?: number;
  needDigit?: boolean;
}

export interface ScanApi {
  entropy(s: string): number;
  scanSecrets(text: string, options?: ScanOptions): Finding[];
}

/** Образец для сканера: текст и то, что в нём на самом деле секрет. */
export interface ScanSample {
  id: string;
  label: string;
  /** Откуда текст. Строчная разметка. */
  note: string;
  text: string;
  /** Значения, которые сканер обязан найти; всё остальное найденное — ложная тревога. */
  secrets: string[];
}
