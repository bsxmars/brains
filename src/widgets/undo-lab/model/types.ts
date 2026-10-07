/** Правка одного символа — как в `OPS_CODE` темы. */
export interface Op {
  type: 'ins' | 'del';
  pos: number;
  ch: string;
}

/** Запись стопки: правки шага (`null` — съеденная чужим удалением), снимок, выделение после шага. */
export interface Entry {
  ops: (Op | null)[];
  text: string | null;
  sel: [number, number];
}

export type Mode = 'ops' | 'naive' | 'snapshots';

/** То, что возвращает `createEditor` из `HISTORY_CODE`. */
export interface Editor {
  text: string;
  sel: [number, number];
  undoStack: Entry[];
  redoStack: Entry[];
  open: boolean;
  kind: 'ins' | 'del' | null;
  last: number;
  insert(str: string, now: number): void;
  backspace(now: number): void;
  remote(op: Op): void;
  select(from: number, to?: number): void;
  stop(): void;
  undo(): boolean;
  redo(): boolean;
}

export type CreateEditor = (opts?: { text?: string; mode?: Mode; timeout?: number }) => Editor;

/** Шаг сценария на виртуальном времени: набор (по символу через 120 мс), пауза, отмена, повтор. */
export type DemoStep = { do: 'type'; s: string } | { do: 'wait'; ms: number } | { do: 'undo' } | { do: 'redo' };

/** Строка таблицы «две стопки»: действие, итог и глубина стопок. */
export interface StackRow {
  act: string;
  steps: DemoStep[];
  text: string;
  undo: number;
  redo: number;
}

/** Действие над `<textarea>` в сценарии сверки с Chromium. */
export type NativeAct =
  | ['type', string]
  | ['key', 'ArrowLeft' | 'ArrowRight' | 'Backspace' | 'Enter']
  | ['select', number, number]
  | ['wait', number]
  | ['undo']
  | ['redo'];

/** Значение, selectionStart, selectionEnd. */
export type FieldState = [string, number, number];

export interface NativeRun {
  id: string;
  label: string;
  acts: NativeAct[];
  /** После каждого Ctrl+Z / Ctrl+Shift+Z в Chromium. */
  chrome: FieldState[];
  /** То же у `createEditor({ timeout: Infinity })`. */
  model: FieldState[];
  note: string;
  tone?: 'warn';
}
