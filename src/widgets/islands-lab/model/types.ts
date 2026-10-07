/** Директива острова Astro: когда браузер скачает его код. */
export type Directive = 'load' | 'idle' | 'visible' | 'media' | 'only';

/**
 * Остров страницы, как его видит `planLoads` из темы.
 * Координаты и высоты — пиксели страницы при окне 1280×800, сняты в Chromium (см. шапку `data.ts`).
 */
export interface IslandSpec {
  id: string;
  client: Directive;
  /** `opts.value` из атрибута острова: `true` у голого `client:visible`, строка запроса у `media`, объект с `rootMargin`/`timeout`. */
  value: boolean | string | { rootMargin?: string; timeout?: number };
  /** Верх первого дочернего элемента острова до того, как что-либо ожило. */
  top: number;
  /** Высота серверной разметки острова. */
  ssrHeight: number;
  /** Высота того же острова после гидратации. */
  liveHeight: number;
  /** Корневые модули: компонент (`component-url`) и рендерер (`renderer-url`). */
  files: string[];
}

/** Чанки сборки: размер файла в байтах и его статические импорты. */
export type ChunkGraph = Record<string, { bytes: number; imports: string[] }>;

/** Шаг, снятый в Chromium: после прокрутки к `y` браузер запросил эти файлы и оживил эти острова. */
export interface TraceStep {
  y: number;
  islands: string[];
  files: string[];
}

/** Страница этого сайта, снятая стендом. */
export interface StandPage {
  key: string;
  route: string;
  label: string;
  /** Высота страницы, когда ожили все острова. */
  pageHeight: number;
  htmlBytes: number;
  islands: IslandSpec[];
  graph: ChunkGraph;
  /** Как собрано (`client:visible`): шаги с запросами. */
  trace: TraceStep[];
  /** Та же страница, где все острова переписаны на `client:load`. */
  traceLoad: TraceStep[];
  /** И на `client:idle`. */
  traceIdle: TraceStep[];
}

export interface PlanEnv {
  viewport: number;
  scrolls: number[];
  matches(query: string): boolean;
}

/** Шаг расчёта: прокрутка к `y` и что на ней скачано впервые. */
export interface PlanStep {
  y: number;
  islands: string[];
  files: string[];
  bytes: number;
}

export type PlanFn = (islands: IslandSpec[], graph: ChunkGraph, env: PlanEnv) => PlanStep[];

/** Режим демо: как собрано или все острова на одной директиве. */
export interface LabMode {
  value: string;
  label: string;
  /** `null` — директивы как в сборке. */
  client: Directive | null;
}
