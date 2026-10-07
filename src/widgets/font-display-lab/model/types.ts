/** Значения `font-display`, которые разбирает тема. */
export type Display = 'auto' | 'block' | 'swap' | 'fallback' | 'optional';

/** Что видно на месте текста: пусто (место занято, букв нет), запасной шрифт, веб-шрифт. */
export type Phase = 'invisible' | 'fallback' | 'font';

/** Отрезок: состояние и его границы в мс от прихода запроса шрифта на сервер стенда. */
export type Segment = [Phase, number, number];

/** Один прогон стенда: значение `font-display`, задержка сервера и что показал Chromium. */
export interface StandRun {
  display: Display;
  /** Задержка ответа шрифта — параметр сервера стенда, мс. */
  delay: number;
  /** Был ли `<link rel="preload" as="font" crossorigin>` на тот же адрес. */
  preload: boolean;
  /** Когда сервер дописал ответ, мс от прихода запроса. */
  loaded: number;
  segs: Segment[];
}

export interface Periods {
  block: number;
  swap: number;
}

export interface FontDisplayApi {
  PERIODS: Record<Display, Periods>;
  fontPhase(display: Display, loadMs: number, t: number, preloaded?: boolean): Phase;
}

export interface Metrics {
  upm: number;
  ascent: number;
  descent: number;
  lineGap: number;
}

export type OverridesFn = (web: Metrics, webWidth: number, fallbackWidth: number) => Record<string, string>;

export interface Face {
  file: string;
  range: string;
}

export interface RangeApi {
  parseRange(css: string): [number, number][];
  facesToFetch(text: string, faces: Face[]): string[];
}
