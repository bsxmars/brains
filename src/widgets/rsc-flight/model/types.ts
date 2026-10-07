/**
 * Типы демо «поток Flight своими руками».
 *
 * Сериализатор и десериализатор — не здесь: они живут строками в `data.ts` темы
 * (`FLIGHT_SERVER_CODE`, `FLIGHT_CLIENT_CODE`), напечатаны на странице и собираются
 * `new Function` в `run.ts`. Здесь только то, что нужно, чтобы их вызвать и показать результат.
 */

/** Переключатели демо — те же поля, что читает `page(opts, api)` из `PAGE_CODE`. */
export interface PageOptions {
  like: 'client' | 'server';
  comments: 'sync' | 'async';
  suspense: boolean;
  prop: PropKind;
}

export type PropKind = 'number' | 'date' | 'promise' | 'action' | 'class' | 'function';

/** Запись манифеста клиентских модулей: так её ждёт и настоящий `react-server-dom-webpack`. */
export interface ManifestEntry {
  id: string;
  chunks: string[];
  name: string;
}

/** Всё, что `page()` получает вторым аргументом: создание элементов и «база». */
export interface PageApi {
  h: (type: unknown, config?: Record<string, unknown> | null, ...children: unknown[]) => unknown;
  Suspense: symbol;
  client: (moduleId: string, name: string) => unknown;
  action: (moduleId: string, name: string) => unknown;
  query: (name: string) => Promise<unknown>;
}

export type PageFn = (opts: PageOptions, api: PageApi) => unknown;

export interface FlightOptions {
  onChunk?: (chunk: string) => void;
  onError?: (error: Error) => void;
}

export type RenderToFlight = (
  root: unknown,
  manifest: Record<string, ManifestEntry>,
  options?: FlightOptions,
) => Promise<void>;

export type CreateFromFlight = (
  text: string,
  modules: Record<string, Record<string, unknown>>,
  callServer?: (id: string, args: unknown[]) => unknown,
) => unknown;

/** Разобранная строка потока — для подсветки в демо. */
export interface RowView {
  id: string;
  /** `module` — I-строка, `symbol` — `"$S…"`, `error` — E-строка, `model` — всё остальное. */
  kind: 'module' | 'symbol' | 'error' | 'model';
  text: string;
}

/** Строка дерева «что увидит клиент». */
export interface TreeLine {
  depth: number;
  text: string;
  /**
   * `host` — обычный тег, готовый к показу; `client` — клиентский компонент (его код грузится
   * и гидратируется); `fallback` — заглушка Suspense вместо ещё не пришедшего;
   * `hole` — дыра без Suspense; `error` — элемент, который упадёт; `text` — текст.
   */
  kind: 'host' | 'client' | 'fallback' | 'hole' | 'error' | 'text';
}
