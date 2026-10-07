/** Прямоугольник в пикселях окна — как у `getBoundingClientRect()`. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Запись IntersectionObserver, как её считает `IO_CODE` темы. */
export interface IoEntry {
  rootBounds: Rect;
  intersectionRect: Rect;
  intersectionRatio: number;
  isIntersecting: boolean;
  /** Сколько порогов достигнуто; 0 — «не пересекается». */
  thresholdIndex: number;
}

export interface IoApi {
  parseMargin(text: string): string[];
  expand(root: Rect, rootMargin: string): Rect;
  intersect(a: Rect, b: Rect): Rect | null;
  computeEntry(target: Rect, root: Rect, rootMargin: string, thresholds: number[]): IoEntry;
  compareFrames(
    prev: Pick<IoEntry, 'thresholdIndex'>,
    next: Pick<IoEntry, 'thresholdIndex'>,
    thresholds: number[],
  ): { fires: boolean; crossed: number[] };
}

/** Один кадр ResizeObserver: круги доставки и кто остался на следующий кадр. */
export interface RoFrame {
  rounds: string[][];
  skipped: string[];
  error: boolean;
}

export type ResizeFrameFn = (
  depthOf: Record<string, number>,
  observed: string[],
  dirty: Set<string>,
  reactions: Record<string, string[]>,
) => RoFrame;

/** Сцена для демо «Глубина»: дерево блоков и что делает колбэк. */
export interface RoScene {
  id: string;
  label: string;
  /** Узлы в порядке документа; `parent: null` — верхний уровень сцены. */
  nodes: { id: string; parent: string | null }[];
  /** Цели в порядке `observe()`. */
  observed: string[];
  /** Чей размер меняется первым — «толчок». */
  start: string;
  /** Получив запись про ключ, колбэк меняет размеры перечисленных узлов. */
  reactions: Record<string, string[]>;
  /** Что увидеть. Строчная разметка. */
  note: string;
}

/** Набор порогов для демо «Пересечение». */
export interface ThresholdOption {
  value: string;
  label: string;
  thresholds: number[];
}
