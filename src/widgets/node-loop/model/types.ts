/** Фаза оборота libuv. */
export interface NodePhase {
  name: string;
  what: string;
}

/** Шаг сценария в Node: где цикл сейчас и что уже напечатано. */
export interface NodeStep {
  message: string;
  tone?: 'ok' | 'warn';
  /** Индекс подсвеченной фазы libuv; −1 — цикл ещё не начался. */
  phase: number;
  /** Вывод фишками: янтарная означает «здесь гонка, порядок не гарантирован». */
  out: { text: string; tone?: 'ok' | 'warn' }[];
}
