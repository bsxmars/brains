/** Узел графа, как его строят функции темы: статические и динамические импорты чанка. */
export interface GraphNode {
  imports: string[];
  dynamic: string[];
}

export type Graph = Record<string, GraphNode>;

/** Чанк из снимка `dist/`: узел графа плюс размеры и число страниц, которые его качают. */
export interface ChunkInfo extends GraphNode {
  /** Сырые байты файла. */
  bytes: number;
  /** `zlib.gzipSync` с уровнем по умолчанию (6). */
  gzip: number;
  /** Brotli, качество 11. */
  br: number;
  /** Сколько страниц сайта получают этот чанк по статическим импортам. */
  pages: number;
}

/** Страница для демо: входы из HTML и порог из `tests/e2e/weight.spec.ts`. */
export interface BudgetPage {
  route: string;
  label: string;
  /** Чанки, на которые ссылается HTML страницы: острова и рендереры. */
  entries: string[];
  /** Порог в КБ (1 КБ = 1024 байта) — как в weight.spec. */
  budgetKb: number;
  /** Имя порога в weight.spec: `LEAN_BUDGET_KB` и т. п. */
  budgetName: string;
  /** Подпись над деревом. Строчная разметка. */
  note: string;
}

export interface GraphApi {
  parseImports(code: string): GraphNode;
  buildGraph(files: Record<string, string>): Graph;
  walk(graph: Graph, entries: string[], withDynamic?: boolean): Map<string, string | null>;
  pageChunks(graph: Graph, entries: string[], withDynamic?: boolean): string[];
  whyIncluded(graph: Graph, entries: string[], target: string, withDynamic?: boolean): string[] | null;
  weigh(chunks: string[], size: (file: string) => number): number;
}

export interface ManifestApi {
  fromViteManifest(manifest: Record<string, { file: string; imports?: string[]; dynamicImports?: string[] }>): Graph;
  fromMetafile(meta: { outputs: Record<string, { imports: { path: string; kind: string }[] }> }): Graph;
}

export interface BudgetChange {
  name: string;
  before: number;
  after: number;
  delta: number;
}

export interface BudgetResult {
  total: number;
  delta: number;
  budget: number;
  over: boolean;
  changes: BudgetChange[];
}

export interface CiApi {
  stripHash(file: string): string;
  groupByName(files: Record<string, number>): Record<string, number>;
  checkBudget(args: { base: Record<string, number>; head: Record<string, number>; budget: number; tolerance: number }): BudgetResult;
  report(page: string, r: BudgetResult): string;
}
