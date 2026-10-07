/** Набор байтов для демо «Как смотреть на байты». */
export interface LensPreset {
  id: string;
  label: string;
  /** Байты. Пустой массив — байты берутся из поля ввода (текст в UTF-8). */
  bytes: number[];
  /** Подпись над демо. Строчная разметка. */
  note: string;
}

export type LensType = 'Uint8' | 'Int16' | 'Uint16' | 'Uint32' | 'Float32';

export interface ReadApi {
  TYPES: Record<LensType, { size: number; get: string }>;
  readAs(bytes: Uint8Array, type: LensType, littleEndian: boolean): number[];
}

/** Вариант файла для демо «Разбор PNG»: исходные байты темы с правками. */
export interface PngVariant {
  id: string;
  label: string;
  /** Правки: `[смещение, новый байт]`. */
  patch: [number, number][];
  /** Обрезать файл до стольких байт. */
  cut?: number;
  note: string;
}

export interface PngChunk {
  offset: number;
  length: number;
  type: string;
  data: Uint8Array;
  crc: number;
  crcOk: boolean;
}

export interface PngInfo {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  interlace: number;
  chunks: PngChunk[];
}

export interface PngApi {
  SIGNATURE: number[];
  crc32(bytes: Uint8Array, crc?: number): number;
  parsePng(bytes: Uint8Array): PngInfo;
}

/** Вид поля в разметке файла: от него зависит цвет байтов. */
export type FieldKind = 'sig' | 'len' | 'type' | 'data' | 'crc';

/** Поле файла: полуинтервал байтов `[start, end)` и что в нём записано. */
export interface PngField {
  start: number;
  end: number;
  kind: FieldKind;
  /** Имя поля: «длина IHDR», «ширина». */
  name: string;
  /** Значение словами. Строчная разметка. */
  value: string;
}
