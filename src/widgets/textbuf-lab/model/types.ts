/** Четыре модели буфера из темы «Как редактор хранит текст». */
export type Kind = 'string' | 'gap' | 'rope' | 'piece';

/** Исходники моделей — строки `*_CODE` из `data.ts` темы. */
export type Codes = Record<Kind, string>;

/** Любой буфер темы несёт два счётчика работы. */
export interface Counted {
  /** Сколько символов переписано (скопировано или записано). */
  copied: number;
  /** Сколько символов, узлов или кусков просмотрено при поиске места. */
  visited: number;
}

export interface GapBuf extends Counted {
  a: (string | undefined)[];
  start: number;
  end: number;
}

export interface RopeLeaf {
  s: string;
  len: number;
  lines: number;
  h: 0;
}
export interface RopeNode {
  left: RopeTree;
  right: RopeTree;
  len: number;
  lines: number;
  h: number;
}
export type RopeTree = RopeLeaf | RopeNode;
export interface RopeBuf extends Counted {
  leaf: number;
  root: RopeTree;
}

export interface Piece {
  buf: 'orig' | 'add';
  start: number;
  len: number;
  lines: number;
}
export interface PieceBuf extends Counted {
  orig: string;
  add: string;
  nl: { orig: number[]; add: number[] };
  pieces: Piece[];
}

/**
 * То, что возвращает строка `*_CODE`, собранная `new Function`. Методы, а не поля-стрелки:
 * так `BufApi<GapBuf>` можно передать туда, где ждут любой `BufApi`.
 */
export interface BufApi<B extends Counted = Counted> {
  create(text: string, opt?: number): B;
  insert(b: B, pos: number, str: string): void;
  remove(b: B, pos: number, len: number): void;
  text(b: B): string;
  lineStart(b: B, line: number): number;
}

export interface PieceApi extends BufApi<PieceBuf> {
  snapshot: (b: PieceBuf) => Piece[];
  restore: (b: PieceBuf, snap: Piece[]) => void;
}

export interface Apis {
  string: BufApi;
  gap: BufApi<GapBuf>;
  rope: BufApi<RopeBuf>;
  piece: PieceApi;
}

/** Шаг маленького сквозного примера. */
export type Step =
  | { op: 'ins'; pos: number; str: string }
  | { op: 'del'; pos: number; len: number }
  | { op: 'line'; line: number };

/** Сквозной пример: текст, размер дырки gap buffer и листа rope, шаги. */
export interface DemoCase {
  base: string;
  gap: number;
  leaf: number;
  steps: Step[];
}

export interface RopeRow {
  depth: number;
  leaf: boolean;
  /** У листа — его текст, у узла — пусто. */
  s: string;
  len: number;
  lines: number;
}

export interface PieceRow extends Piece {
  text: string;
}

/** Состояние всех четырёх буферов после шага и цена шага. */
export interface DemoState {
  step: Step | null;
  text: string;
  /** Для шага `line` — найденное начало строки (одинаковое у всех, иначе тест красный). */
  found: number | null;
  cost: Record<Kind, Counted>;
  gap: { cells: (string | null)[]; start: number; end: number };
  rope: RopeRow[];
  piece: { orig: string; add: string; pieces: PieceRow[] };
}

/** Сценарии «в масштабе»: 1000 операций над документом длины n. */
export type Scenario = 'type' | 'scatter' | 'lines' | 'paste';

export interface ScaleCell {
  /** Только у `type`: цена первой вставки, когда курсор пришёл в новое место. */
  first?: number;
  /** Символов переписано — в среднем на операцию (у `paste` — за одну вставку). */
  copied: number;
  /** Просмотрено — в среднем на операцию. */
  visited: number;
  /** Кусков в piece table после сценария. */
  pieces?: number;
  /** Высота rope после сценария. */
  h?: number;
}

export type ScaleResult = Record<Kind, ScaleCell>;
