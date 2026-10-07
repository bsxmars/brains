/** Пакет монорепозитория: имя, папка от корня и соседи-зависимости из того же репозитория. */
export interface WsPackage {
  name: string;
  dir: string;
  deps: string[];
}

/** Правка из стенда: изменённые файлы и что выбрал `pnpm --filter "...[origin/main]"`. */
export interface FilterPreset {
  id: string;
  label: string;
  files: string[];
  /** Выборка настоящего pnpm, отсортирована. */
  pnpm: string[];
  /** Подпись к примеру. Строчная разметка. */
  note: string;
}

export interface GraphApi {
  topoLevels(packages: WsPackage[]): string[][];
  affected(packages: WsPackage[], changedFiles: string[], rootName: string): { changed: string[]; withDependents: string[] };
}

export interface PublishApi {
  publishSpec(spec: string, version: string): string;
}

/** Один прогон учебного кеша: окружение процесса, в котором запускают сборку. */
export interface CacheRun {
  id: string;
  label: string;
  env: Record<string, string>;
}

/** Настройка кеша: какие переменные объявлены и видит ли задача необъявленные. */
export interface CacheMode {
  id: string;
  label: string;
  declared: string[];
  strict: boolean;
  /** Что увидеть во втором прогоне. Строчная разметка. */
  note: string;
}

export interface CacheLogEntry {
  name: string;
  key: string;
  hit: boolean;
  output: string;
}

export interface CacheApi {
  sha256(text: string): Promise<string>;
  taskKey(task: { command: string; files: Record<string, string>; depKeys: string[]; env: Record<string, string> }): Promise<string>;
  buildPackage(name: string, env: Record<string, string | undefined>): string;
  runWithCache(opts: {
    packages: WsPackage[];
    levels: string[][];
    files: Record<string, Record<string, string>>;
    cache: Map<string, string>;
    env: Record<string, string>;
    declared: string[];
    strict: boolean;
  }): Promise<CacheLogEntry[]>;
}
