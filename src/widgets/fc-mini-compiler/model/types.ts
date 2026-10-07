/**
 * Типы демо «Компиляторы фреймворков».
 *
 * Сам компилятор здесь не описан: он живёт строкой `MINI_COMPILER_CODE` в `data.ts` темы
 * и собирается `new Function` — ровно та строка, что напечатана на странице. Типы описывают
 * то, что эта строка возвращает.
 */

/** Пример для демо: шаблон и начальные значения имён, которые в нём встречаются. */
export interface MiniPreset {
  id: string;
  label: string;
  source: string;
  state: Record<string, string | number>;
}

export interface Compiled {
  /** Статическая разметка с метками `<!---->` на месте изменчивого текста. */
  html: string;
  /** Сгенерированный JS: тело функции, которое получает `rt` и возвращает `mount`. */
  code: string;
  /** Имена, от которых зависит хоть одно изменчивое место, — в порядке появления. */
  names: string[];
}

/** Минимум DOM, который нужен рантайму учебного компилятора. */
export type MiniDocument = Pick<Document, 'createElement' | 'createTextNode'>;

export interface MiniRuntime {
  template(html: string): unknown;
  clone(tpl: unknown): DocumentFragment;
  hole(mark: ChildNode): Text;
  text(node: Text, value: unknown): void;
  attr(el: Element, name: string, value: unknown): void;
}

export type State = Record<string, unknown>;
export type Update = (s: State, changed: Record<string, boolean>) => void;
export type Mount = (target: Element, s: State) => Update;

/** То, что возвращает `MINI_COMPILER_CODE`. */
export interface MiniCompiler {
  parse(source: string): unknown;
  compile(source: string): Compiled;
  createRuntime(document: MiniDocument, log: (op: string) => void): MiniRuntime;
  instantiate(code: string, rt: MiniRuntime): Mount;
  interpret(source: string, s: State): string;
}

/** Итог одного изменения: что сделал скомпилированный код и что сделал бы интерпретатор. */
export interface ChangeReport {
  /** Записи в DOM, которые сделал рантайм (`text "1"`, `attr title="…"`). */
  ops: string[];
  /** Сколько узлов создал бы интерпретатор, заново собрав всю разметку. */
  rebuilt: number;
  /** Разметка корня после изменения. */
  html: string;
}
