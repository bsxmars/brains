/** Поле до первого действия: значение и каретка (выделения нет). */
export interface FieldStart {
  value: string;
  caret: number;
}

/**
 * Шаг сценария. `key` — нажатие клавиши (`key` — символ раскладки, `code` — место клавиши);
 * `paste` — Ctrl+V / Cmd+V с текстом в буфере; `compose` — очередное слово IME в наборе;
 * `commit` — выбор слова в IME; `set` — запись `el.value = …` из кода.
 */
export type InputAction =
  | { do: 'key'; key: string; code: string }
  | { do: 'paste'; text: string }
  | { do: 'compose'; text: string }
  | { do: 'commit'; text: string }
  | { do: 'set'; value: string };

/** Запись журнала: те поля, что пишет `watchField` из темы. */
export interface FieldEvent {
  type: string;
  key?: string;
  code?: string;
  keyCode?: number;
  inputType?: string;
  data?: string | null;
  /** `isComposing` — есть только у событий клавиатуры и ввода. */
  composing?: boolean;
  cancelable: boolean;
  /** `value` поля в момент события. */
  value: string;
  /** `[selectionStart, selectionEnd]` в момент события. */
  sel: number[];
}

/** Итог прогона: журнал и поле после последнего шага. */
export interface FieldRun {
  value: string;
  sel: number[];
  log: FieldEvent[];
}

/** Сценарий демо и стенда. */
export interface InputScenario {
  id: string;
  label: string;
  /** Подпись над журналом. Строчная разметка. */
  note: string;
  start: FieldStart;
  /** События, в которых слушатель зовёт `preventDefault()`. */
  cancel: string[];
  actions: InputAction[];
}

export type SimulateFn = (start: FieldStart, actions: InputAction[], cancel?: string[]) => FieldRun;

export type WatchFn = (field: HTMLInputElement, onEvent: (e: FieldEvent) => void, cancel?: string[]) => void;
