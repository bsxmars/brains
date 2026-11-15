/**
 * Раскладка `node_modules` по двум правилам — подъёмом, как npm, и изолированно, как pnpm.
 *
 * Это ограниченная модель размещения: полный решатель менеджера пакетов она не воспроизводит.
 * Проверяется оно не само собой: `tests/unit/package-managers.test.ts` гоняет те же сценарии,
 * что сняты настоящими npm 11.19.1 и pnpm 11.0.9 на локальном реестре (`TREE_RUNS` в данных
 * темы), и требует совпадения строка в строку. Расхождение — красный тест, а не находка читателя.
 *
 * Версии выбирает `SemverApi` — та же учебная строка, что стоит в теме над калькулятором.
 * Модуль чистый: ни DOM, ни Vue.
 *
 * Чего правило не умеет, и где это сказано в теме: `overrides`, `--force`, раскладку с уже
 * существующим lock-файлом (история установки меняет дерево — раздел «Разрешение и подъём»)
 * и вложенные peer-конфликты глубже корня.
 */
import type { SemverApi } from './semver';

export interface Manifest {
  deps?: Record<string, string>;
  peers?: Record<string, string>;
}

/** Реестр: имя → версия → манифест. */
export type Registry = Record<string, Record<string, Manifest>>;

/**
 * `declared` — объявлен приложением; `phantom` — лежит наверху, но приложение его не объявляло;
 * `nested` — вложен под чужой пакет; `duplicate` — та же версия лежит на диске не один раз;
 * `hidden` — поднят в скрытый `.pnpm/node_modules`, куда смотрят пакеты, но не приложение.
 */
export type Tag = 'declared' | 'phantom' | 'nested' | 'duplicate' | 'hidden';

export interface Entry {
  path: string;
  /** Настоящая папка пакета. */
  version?: string;
  /** Симлинк: куда ведёт, относительно своей папки. */
  link?: string;
  tags: Tag[];
}

export interface Layout {
  entries: Entry[];
  /** Установка не состоялась: npm отказывает целиком, дерева нет. */
  error?: { code: string; message: string };
  warnings: string[];
  /** Что получит `require(имя)` из кода приложения: версия или `null` — «не найден». */
  visible: Record<string, string | null>;
}

export interface NpmOptions {
  /** `--legacy-peer-deps`: peer-зависимости не ставятся и не проверяются — поведение npm 3–6. */
  legacyPeerDeps?: boolean;
}

export interface LayoutApi {
  formatEntry(entry: Entry): string;
  layoutNpm(registry: Registry, deps: Record<string, string>, semver: SemverApi, options?: NpmOptions): Layout;
  layoutPnpm(registry: Registry, deps: Record<string, string>, semver: SemverApi): Layout;
}

/** Исполняет единственный исходник из data.ts, показанный перед PmTree. */
export function loadLayout(code: string): LayoutApi {
  return new Function(code + '\nreturn { formatEntry, layoutNpm, layoutPnpm };')() as LayoutApi;
}
