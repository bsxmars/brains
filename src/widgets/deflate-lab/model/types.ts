/** Токен LZ77: литерал — байт как есть; пара — «назад на dist байт, скопировать len». */
export type Token = { lit: number } | { len: number; dist: number };

export interface Lz77Options {
  /** Сколько кандидатов из хеш-цепочки проверить. */
  chain?: number;
  /** Длина совпадения, на которой поиск останавливается. */
  nice?: number;
  /** До какой длины заглядывать на байт вперёд; 0 — жадный поиск. */
  lazy?: number;
}

/** Что вернул `blockBits`: частоты, длины кодов и итог в битах (без заголовка блока). */
export interface BlockStats {
  litF: number[];
  distF: number[];
  litL: number[];
  distL: number[];
  extra: number;
  bits: number;
}

/** Одно чтение из потока: что читали, значение и диапазон БИТОВ `[from, to)`. */
export interface ReadEvent {
  what: string;
  value: number;
  from: number;
  to: number;
}

export type LogFn = (what: string, value: number, from: number, to: number) => void;

export interface GunzipResult {
  data: Uint8Array;
  name: string;
  flags: number;
  mtime: number;
  os: number;
  /** Байт, с которого начинается поток DEFLATE. */
  at: number;
  /** Байт, с которого начинается хвост: CRC-32 и ISIZE. */
  end: number;
  crc: number;
  isize: number;
}

/** Все функции темы, собранные из строк `LZ77_CODE`, `HUFFMAN_CODE`, `INFLATE_CODE`, `WRAP_CODE`, `BITS_CODE`. */
export interface DeflateApi {
  WINDOW: number;
  MIN_MATCH: number;
  MAX_MATCH: number;
  lz77(data: Uint8Array, options?: Lz77Options): Token[];
  unlz77(tokens: Token[]): Uint8Array;
  huffmanLengths(freqs: number[], maxBits?: number): number[];
  canonicalCodes(lengths: number[]): number[];
  LEN_BASE: number[];
  LEN_EXTRA: number[];
  DIST_BASE: number[];
  DIST_EXTRA: number[];
  ORDER: number[];
  inflateRaw(bytes: Uint8Array, log?: LogFn): { data: Uint8Array; bitLength: number };
  gunzip(bytes: Uint8Array, log?: LogFn): GunzipResult;
  adler32(bytes: Uint8Array): number;
  unzlib(bytes: Uint8Array): { data: Uint8Array; window: number };
  symbolOf(value: number, base: number[]): [number, number];
  blockBits(tokens: Token[]): BlockStats;
  fixedBits(stats: BlockStats): number;
}

/** Строки кода из темы — в том порядке, в каком они друг друга используют. */
export interface DeflateCodes {
  lz77: string;
  huffman: string;
  inflate: string;
  wrap: string;
  bits: string;
}

/** Готовый текст для демо. */
export interface DeflatePreset {
  id: string;
  label: string;
  text: string;
}

export type LabTab = 'tokens' | 'huffman' | 'gzip';
