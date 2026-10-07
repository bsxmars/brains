/**
 * Типы демо «Vapor Mode во Vue».
 *
 * Мини-vapor здесь не описан: он живёт строкой `MINI_VAPOR_CODE` в `data.ts` темы и собирается
 * `new Function` — ровно та строка, что напечатана на странице. Типы описывают то, что эта
 * строка возвращает, и то, что меряют демо и тест.
 */

/** Ячейка-сигнал мини-vapor: то же `.value`, что у `ref` Vue. */
export interface MiniRef<T = unknown> {
  value: T;
}

/** Блок мини-vapor: узел плюс всё, что надо остановить вместе с ним. */
export interface MiniScope {
  node: Node;
  effects: unknown[];
  cleanups: (() => void)[];
}

export type Render = (state: Record<string, MiniRef>) => Node;

/** Что возвращает строка `MINI_VAPOR_CODE`. */
export interface MiniVapor {
  ref<T>(value: T): MiniRef<T>;
  nextTick(): Promise<void>;
  compile(source: string, bindings: string[]): string;
  build(code: string): Render;
  mount(render: Render, state: Record<string, MiniRef>, container: Node): MiniScope;
  dispose(scope: MiniScope, detach?: boolean): void;
  hooks: { touch: ((node: Node, op: OpKind) => void) | null };
  stats: { effects: number };
}

/** Вид DOM-операции — одинаковый словарь у мини-vapor и у щупа. */
export type OpKind = 'create' | 'insert' | 'remove' | 'text' | 'class' | 'attr';

export interface DomOp {
  kind: OpKind;
  /** Какой вызов DOM это был: `nodeValue=`, `insertBefore`… (у мини-vapor — пусто). */
  api: string;
  node: Node;
}

/** Действие читателя: код над ячейками `title`, `count`, `items`. */
export interface Scenario {
  id: string;
  label: string;
  code: string;
}

/** Замер одной стороны после одного действия. */
export interface VdomStep {
  render: number;
  vnodes: number;
  ops: number;
}

export interface VaporStep {
  effects: number;
  ops: number;
}

/** Строка таблицы замеров: шаг последовательности и обе стороны. */
export interface MeasuredRow {
  id: string;
  vdom: VdomStep;
  vapor: VaporStep;
}
