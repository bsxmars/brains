/** Сценарий демо: файлы проекта и то, что rolldown собрал из них на стенде (см. шапку `data.ts` темы). */
export interface BundleScenario {
  id: string;
  label: string;
  /** Путь → текст файла. `package.json` пакета лежит здесь же: из него учебный сборщик читает `sideEffects`. */
  files: Record<string, string>;
  entry: string;
  /** Подпись над сценарием. Строчная разметка. */
  note: string;
  /** Вывод rolldown 1.2.8 на этих файлах; табуляция заменена двумя пробелами. */
  rolldown: string;
}

/** Оператор верхнего уровня так, как его разбирает `parseStatement` из `GRAPH_CODE`. */
export interface Statement {
  path: string;
  /** Текст без `export `. */
  code: string;
  exported: boolean;
  name: string | null;
  /** Правая часть `const x = …`, если оператор — объявление переменной. */
  init?: string;
  effect: boolean;
}

export interface ModuleRecord {
  path: string;
  imports: { from: string; names: { imported: string; local: string }[] }[];
  body: Statement[];
  noSideEffects: boolean;
}

export interface Graph {
  modules: Map<string, ModuleRecord>;
  order: ModuleRecord[];
}

export interface Shaken {
  /** Оператор → почему оставлен: `'эффект'` или оператор, который на него сослался. */
  kept: Map<Statement, 'эффект' | Statement>;
  needed: Set<Statement>;
}

export interface BundleResult {
  graph: Graph;
  shaken: Shaken;
  finalName: Map<Statement, string>;
  code: string;
}

export interface BundlerApi {
  resolve(spec: string, from: string): string;
  buildGraph(files: Record<string, string>, entry: string): Graph;
  shake(graph: Graph): Shaken;
  bundle(files: Record<string, string>, entry: string): BundleResult;
}

export interface ChunkInput {
  code: string;
  deps: string[];
}

export type ChunkHashesFn = (chunks: Record<string, ChunkInput>) => Map<string, string>;
