/** Ключ B-дерева: в демо — числа, в тесте ещё и адреса почты. */
export type BtKey = number | string;

/** Страница учебного B-дерева — как её строит `BTREE_CODE`. */
export interface BtPage {
  leaf: boolean;
  keys: BtKey[];
  /** Только у внутренней страницы: `children.length === keys.length + 1`. */
  children?: BtPage[];
  /** Сосед справа на том же уровне; у самой правой страницы — `null`. */
  next: BtPage | null;
}

export interface BtTree {
  root: BtPage;
  capacity: number;
  rightFill: number;
  levels: number;
  pages: number;
}

export interface BtreeApi {
  createTree(capacity: number, rightFill?: number): BtTree;
  insert(tree: BtTree, key: BtKey): void;
  /** `pages` — прочитанные страницы по порядку, от корня к листу. */
  search(tree: BtTree, key: BtKey): { found: boolean; pages: BtPage[] };
  /** Один спуск к `from`, дальше листья вправо: `pages` — все прочитанные. */
  range(tree: BtTree, from: BtKey, to: BtKey): { keys: BtKey[]; pages: BtPage[] };
}

/** Сценарий демо B-дерева: ключи в порядке вставки и стартовые запросы. */
export interface BtreeScenario {
  id: string;
  label: string;
  keys: number[];
  capacity: number;
  rightFill: number;
  /** Строчная разметка. */
  note: string;
  search: number;
  range: [number, number];
}

export type ScanNode = 'Seq Scan' | 'Index Scan' | 'Bitmap Heap Scan';

/** Статистика, по которой считает `planCosts`: таблица и один индекс. */
export interface TableStats {
  pages: number;
  tuples: number;
  indexPages: number;
  /** Уровней в B-дереве, корень и листья — это 2. */
  levels: number;
  correlation: number;
}

export interface PlanCosts {
  costs: Record<ScanNode, number>;
  winner: ScanNode;
}

export type PlannerFn = (t: TableStats, rows: number) => PlanCosts;

/** Точка стенда: запрос с параметром `n`, оценка строк, выбор Postgres и его цены вариантов. */
export interface PlanPoint {
  n: number;
  rows: number;
  chosen: ScanNode;
  costs: Record<ScanNode, number>;
}

export interface PlanColumn {
  id: string;
  label: string;
  /** Строчная разметка. */
  note: string;
  stats: TableStats;
  points: PlanPoint[];
  /** Запрос; `{n}` заменяется на параметр точки. */
  sql: string;
  /** Подпись точки; `{n}` — параметр. */
  unit: string;
}
