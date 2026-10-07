/** Версии по окружениям: `{ chrome: '109', safari: '26.5' }`. Ключи — имена таблиц Babel. */
export type Targets = Record<string, string>;

/** Таблица совместимости: имя плагина или модуля → «с какой версии умеет» по окружениям. */
export type CompatTable = Record<string, Record<string, string>>;

/** Функции из строки `DECIDE_CODE` темы, собранные `new Function`. */
export interface DecideApi {
  lowestVersions(browsers: string[]): Targets;
  blockers(support: Record<string, string>, targets: Targets): string[];
  required(table: CompatTable, targets: Targets): string[];
}

/** Запрос browserslist и то, что стенд снял для него (см. шапку `data.ts` темы). */
export interface TranspilePreset {
  id: string;
  /** Сам запрос — он же подпись переключателя. */
  query: string;
  /** Ответ browserslist с `mobileToDesktop: true`, как его зовёт Babel. */
  browsers: string[];
  /** Сквозной пример после `@babel/preset-env` без полифилов. */
  code: string;
  /** Байты `code` после минификации esbuild и после gzip -9. */
  min: number;
  gzip: number;
  /** Сколько плагинов-преобразований (не `syntax-*`) включил preset-env. */
  plugins: number;
  /** Модули core-js, которые добавил `useBuiltIns: 'usage'`, и их вес в сборке. */
  usage: string[];
  usageBytes: number;
  usageGzip: number;
  /** `useBuiltIns: 'entry'`: сколько модулей встало вместо `import 'core-js/stable'` и их вес. */
  entry: number;
  entryBytes: number;
  entryGzip: number;
}

/** Строка таблицы решений: конструкция из сквозного примера и то, что за неё отвечает. */
export interface FeatureRow {
  /** Как конструкция выглядит в коде. */
  code: string;
  kind: 'syntax' | 'api';
  /** Плагин Babel (`transform-…`) или модуль core-js (`es.…`, `web.…`). */
  item: string;
}

/** «Своя цель»: браузер и версии, между которыми можно двигать ползунок. */
export interface CustomRange {
  /** Имя браузера в browserslist: `chrome`, `firefox`, `safari`. */
  name: string;
  label: string;
  versions: string[];
}
