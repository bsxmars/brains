/**
 * Что случилось со строкой в этот момент: `info` — выполнилась, `warn` — выполнилась,
 * но впустую или устарела, `err` — испортила данные, `ok` — сработала как задумано,
 * `held` — придержана браузером, `none` — ничего не происходит.
 */
export type MomentTone = 'info' | 'warn' | 'err' | 'ok' | 'held' | 'none';

export interface MomentCell {
  text: string;
  tone: MomentTone;
}

export interface PrerenderLine {
  code: string;
  cells: MomentCell[];
}

export interface PrerenderDiagramData {
  title: string;
  /** Моменты — столбцы схемы, с событиями страницы в каждом. */
  moments: { k: string; events: string }[];
  lines: PrerenderLine[];
  caption: string;
}
