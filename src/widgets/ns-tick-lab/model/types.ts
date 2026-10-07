/**
 * Формы данных демо «Readable по тикам».
 *
 * Поля кадра называются так же, как свойства настоящего стрима, с которых они сняты:
 * `length` — `readableLength`, `flowing` — `readableFlowing`, `wlength` — `writableLength`.
 * Кадр пишет сценарий темы (`NS_SCENARIO_CODE`), и пишет одинаково для модели и для
 * `node:stream` — это сверяет `tests/unit/node-streams.test.ts`.
 */

/** Как потребитель забирает данные — четыре способа из темы. */
export type NsMode = 'data' | 'readable' | 'iterator' | 'pipe';

export interface NsParams {
  mode: NsMode;
  /** Порог читаемого стрима, в объектах. */
  hwm: number;
  /** Порог записываемого стрима в режиме `pipe`. */
  whwm: number;
  /** Сколько тиков потребитель тратит на один чанк. */
  delay: number;
  /** Сколько чанков отдаст источник до `push(null)`. */
  n: number;
  /** Сколько тиков прогнать. */
  ticks: number;
}

export interface NsFrame {
  t: number;
  /** Что случилось за тик: вызовы, события, ответы `write()`. */
  log: string[];
  /** `_readableState.buffer` от `bufferIndex` до конца. */
  buffer: unknown[];
  length: number;
  flowing: boolean | null;
  /** `_readableState.reading`: `_read()` вызван, ответа (`push`) ещё не было. */
  reading: boolean;
  /** `readableEnded` — событие `'end'` уже отдано. */
  ended: boolean;
  /** Взято из стрима, но ещё не обработано — память вне стрима. */
  backlog: unknown[];
  /** Чанк, над которым потребитель работает сейчас. */
  current: unknown;
  wlength: number | null;
  needDrain: boolean | null;
}

/** То, что сценарию нужно от реализации стримов: два класса и «доиграть отложенное». */
export interface NsStreams {
  Readable: unknown;
  Writable: unknown;
  settle: () => Promise<void> | void;
}

export type NsRun = (streams: NsStreams, params: NsParams) => Promise<NsFrame[]>;

/** Хост модели: как дождаться макрозадачи — чтобы доиграли микрозадачи. */
export interface NsHost {
  macrotask: () => Promise<void>;
}

/** Режим в переключателе демо: подпись и объяснение под ним. */
export interface NsModeInfo {
  value: NsMode;
  label: string;
  /** Строчная разметка. */
  note: string;
}
