/** Тон строки схемы: `ok` — прошло, `err` — сработало против пользователя, `info` — проверка. */
export type SeqTone = 'ok' | 'err' | 'warn' | 'info';

/** Сообщение от одного участника другому: номера — индексы в `lanes`. */
export interface SeqMessage {
  from: number;
  to: number;
  text: string;
  tone?: SeqTone;
  /** Оборванная стрелка: сообщение не дошло до кода получателя. */
  cut?: boolean;
}

/** Событие внутри участника (или двух соседних): проверка, решение, состояние. */
export interface SeqNote {
  at: number;
  span?: 1 | 2;
  text: string;
  tone?: SeqTone;
}

export type SeqRow = SeqMessage | SeqNote;

export interface SeqDiagram {
  title: string;
  lanes: string[];
  rows: SeqRow[];
  caption: string;
}
