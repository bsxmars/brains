/** Узел ESTree в том виде, в каком его отдаёт espree: интерпретатору нужны тип и строка. */
export interface EsNode {
  type: string;
  loc?: { start: { line: number; column: number }; end: { line: number; column: number } };
  [key: string]: unknown;
}

/** Окружение, как его держит интерпретатор темы (`ENV_CODE`). */
export interface RawEnv {
  id: number;
  kind: 'global' | 'function' | 'block' | 'for' | 'iteration';
  name: string;
  outer: RawEnv | null;
  vars: Map<string, { kind: string; value: unknown; ready: boolean }>;
}

/** Замыкание интерпретатора: код плюс окружение, где его создали. */
export interface RawClosure {
  closure: true;
  node: EsNode;
  name: string;
  env: RawEnv;
}

export type StepEvent = 'start' | 'stmt' | 'call' | 'block' | 'for' | 'copy' | 'timer' | 'error' | 'end';

export type StepHook = (event: StepEvent, node: EsNode | null, env: RawEnv | null) => void;

/** Что возвращают строки темы, собранные `new Function`. */
export interface Interpreter {
  run(program: EsNode, print: (text: string, error?: boolean) => void): void;
  frames: RawEnv[];
  timers: { fn: RawClosure; ms: number; order: number }[];
}

export interface OutLine {
  text: string;
  error: boolean;
}

export interface BindingView {
  name: string;
  /** var, let, const, function, param. */
  kind: string;
  /** Значение для показа; у привязки в мёртвой зоне — пусто. */
  value: string;
  tdz: boolean;
  /** У функции — номер окружения, где её создали. */
  fnEnv: number | null;
}

export interface EnvView {
  id: number;
  title: string;
  outer: number | null;
  vars: BindingView[];
  /** current — где сейчас исполнение; chain — его внешние; held — живо только благодаря замыканиям. */
  role: 'current' | 'chain' | 'held';
}

export interface TraceStep {
  event: StepEvent;
  /** Строка программы с единицы; `null` — у событий без своей строки. */
  line: number | null;
  /** Подпись шага. Строчная разметка. */
  note: string;
  envs: EnvView[];
  out: OutLine[];
  /** Сколько окружений создано к этому шагу и сколько из них ещё достижимо. */
  created: number;
  alive: number;
}

export interface Trace {
  steps: TraceStep[];
  out: OutLine[];
  /** Программа вышла за подмножество интерпретатора или не разобралась. */
  problem: string | null;
}

/** Программа для демо. Код исполняют интерпретатор темы и движок — тест сверяет их вывод. */
export interface ScopeProgram {
  id: string;
  label: string;
  code: string;
  /** Подпись над программой: на что смотреть. Строчная разметка. */
  note: string;
}
