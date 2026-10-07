/** Ячейка сравнения: значение и вердикт. Без тона — просто факт, без оценки. */
export interface CompareCell {
  v: string;
  tone?: 'ok' | 'warn' | 'err';
}

/** Строка сравнения: признак слева, по ячейке на каждый инструмент. */
export interface CompareRow {
  k: string;
  cells: CompareCell[];
}
