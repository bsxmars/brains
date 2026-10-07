/** CSS-свойства элемента так, как их пишут в стилях: имя через дефис, значение строкой. */
export type Css = Record<string, string>;

/** Элемент дерева: учебная функция видит только свойства, геометрию добавляет `layoutTree`. */
export interface StackNode {
  id: string;
  css: Css;
  kids?: StackNode[];
}

/**
 * Шаг отрисовки по CSS 2.1, приложение E: 2 — контексты с отрицательным `z-index`,
 * 3 — фоны блоков, 4 — float, 5 — строчные (`inline-block`, flex-элементы),
 * 6 — позиционированные с `z-index: auto`/`0`, 7 — положительный `z-index`.
 */
export type PaintStep = 2 | 3 | 4 | 5 | 6 | 7;

/** Одна запись порядка отрисовки, снизу вверх. `ctx` — чей контекст рисует; `null` — корень. */
export interface PaintEntry {
  id: string;
  step: PaintStep;
  ctx: string | null;
}

export interface ContextInfo {
  id: string;
  /** Почему элемент создаёт контекст наложения; `null` — не создаёт. */
  reason: string | null;
  /** Действующий `z-index`: у кого он не работает, там 0. */
  z: number;
  /** Ближайший предок-контекст; `null` — корневой контекст (`<html>`). */
  ctx: string | null;
}

export interface PaintResult {
  order: PaintEntry[];
  contexts: ContextInfo[];
}

export interface StackingApi {
  contextReason(css: Css, parentCss?: Css): string | null;
  paintOrder(tree: StackNode[]): PaintResult;
}

/** Сцена демо: дерево и подпись над ним. */
export interface StackScene {
  id: string;
  label: string;
  /** Строчная разметка. */
  note: string;
  tree: StackNode[];
}

/** Варианты одного свойства в редакторе демо: подпись и CSS, который она добавляет. */
export interface PropOption {
  value: string;
  label: string;
  css: Css;
}
