/** `err` — пошёл к origin сам, `warn` — ждёт чужой поход, `ok` — получил ответ сразу. */
export type StampedeTone = 'ok' | 'warn' | 'err';

export interface StampedeCell {
  text: string;
  tone: StampedeTone;
}

export interface StampedeRow {
  k: string;
  cells: StampedeCell[];
  verdict: string;
  tone: StampedeTone;
}

export interface StampedeDiagramData {
  title: string;
  /** Подписи столбцов: кто пришёл и когда. */
  arrivals: string[];
  rows: StampedeRow[];
  caption: string;
}
