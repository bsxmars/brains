/** Случай из демо: что сделали с массивом и в какую клетку решётки он переехал. */
export interface ElementsCase {
  label: string;
  code: string;
  /** Строка решётки: 0 — целые, 1 — дробные, 2 — что угодно. */
  row: number;
  /** Колонка: 0 — PACKED, 1 — HOLEY. */
  col: number;
  note: string;
}

/** Строка решётки видов: как называются плотный и дырявый варианты. */
export interface ElementsRow {
  row: string;
  packed: string;
  holey: string;
}
