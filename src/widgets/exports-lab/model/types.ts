/** Значение поля `exports` — как его отдаёт `JSON.parse`. */
export type ExportsValue = string | null | ExportsValue[] | { [key: string]: ExportsValue };

/** Ответ учебного резолвера: файл относительно корня пакета или код ошибки Node. */
export interface ResolveResult {
  /** `./dist/node.js` — путь от корня пакета; `null`, если путь не найден. */
  file: string | null;
  /** `ERR_PACKAGE_PATH_NOT_EXPORTED` и соседи — те же коды, что бросает Node. */
  error: string | null;
  /** Шаги разбора по порядку — что резолвер проверил и почему пошёл дальше. */
  log: string[];
}

export interface ResolverApi {
  resolveExports(exports: ExportsValue, subpath: string, conditions: string[]): ResolveResult;
  /** `pkg/a/b` → `['pkg', './a/b']`, `@scope/pkg` → `['@scope/pkg', '.']`. */
  splitSpecifier(spec: string): [string, string];
}

/** Готовый вариант карты для демо: пакет-фикстура стенда. */
export interface ExportsPreset {
  id: string;
  label: string;
  /** Имя пакета — с него начинается спецификатор. */
  name: string;
  exports: ExportsValue;
  /** Файлы, которые лежат в пакете: по ним видно, найдётся ли выбранный файл. */
  files: string[];
  /** Спецификаторы, которые стоит попробовать. */
  specifiers: string[];
  /** Подпись к варианту. Строчная разметка. */
  note: string;
}

/** Набор условий, который включает среда. */
export interface ConditionEnv {
  id: string;
  label: string;
  conditions: string[];
  /** Пояснение к среде. Строчная разметка. */
  note: string;
}
