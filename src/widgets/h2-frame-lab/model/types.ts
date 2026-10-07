/** Кусок байтов, как его прочитал прокси стенда: направление и байты в hex. */
export interface StandChunk {
  /** `c2s` — от клиента к серверу, `s2c` — обратно. */
  dir: 'c2s' | 's2c';
  hex: string;
}

/** Запись снятого соединения для демо: подпись и куски байтов в порядке прихода на прокси. */
export interface Capture {
  id: string;
  label: string;
  /** Подпись над записью. Строчная разметка. */
  note: string;
  /** Кто клиент и кто сервер — для подписей направлений. */
  client: string;
  server: string;
  chunks: StandChunk[];
}

export interface FrameHeader {
  length: number;
  type: string;
  flags: number;
  stream: number;
}

export interface Frame extends FrameHeader {
  /** Смещение заголовка кадра в потоке байтов своей стороны. */
  at: number;
  payload: number[];
}

/** Одна запись блока HPACK после разбора. */
export interface HeaderField {
  /** `indexed` — запись таблицы целиком; `incremental` — литерал с записью в таблицу;
   *  `literal` — без записи; `never` — «никогда не запоминать»; `size` — новый размер таблицы. */
  kind: 'indexed' | 'incremental' | 'literal' | 'never' | 'size';
  index?: number;
  name?: string;
  value?: string;
  size?: number;
  nameHuffman?: boolean;
  valueHuffman?: boolean;
  /** Байты записи в блоке: [начало, конец). */
  bytes: [number, number];
}

export interface DynamicTable {
  entries: [string, string][];
  size: number;
  maxSize: number;
}

/** Функции темы, собранные из строк `FRAME_CODE`, `HPACK_INT_CODE`, `HPACK_TABLE_CODE`, `HPACK_DECODE_CODE`. */
export interface H2Api {
  FRAME_TYPES: string[];
  PREFACE: string;
  readFrameHeader(b: number[], at: number): FrameHeader;
  splitFrames(b: number[]): Frame[];
  readPayload(f: Frame): {
    ack?: boolean;
    settings?: [string, number][];
    increment?: number;
    error?: number;
    lastStream?: number;
  };
  headerBlockOf(f: Frame): number[];
  encodeInt(value: number, n: number, high?: number): number[];
  decodeInt(b: number[], at: number, n: number): [number, number];
  STATIC_TABLE: ([string, string] | null)[];
  findStatic(name: string, value: string): { index: number; exact: boolean } | null;
  createTable(maxSize?: number): DynamicTable;
  addEntry(t: DynamicTable, name: string, value: string): void;
  entryAt(t: DynamicTable, index: number): [string, string];
  decodeHuffman(bytes: number[]): string;
  decodeString(b: number[], at: number): [string, number, boolean];
  decodeHeaderBlock(b: number[], table: DynamicTable): HeaderField[];
}

/** Кадр в общей ленте соединения — с разбором полезной нагрузки. */
export interface TimelineFrame extends Frame {
  dir: 'c2s' | 's2c';
  /** Номер куска на прокси, в котором кадр начался: так восстанавливается порядок сторон. */
  chunk: number;
  /** Сквозной номер кадра в ленте. */
  n: number;
  /** Девять байт заголовка кадра, как они пришли. */
  head: number[];
  /** Поля HPACK — только у HEADERS и PUSH_PROMISE. */
  fields?: HeaderField[];
  /** Длина блока HPACK в байтах. */
  blockLength?: number;
  /** Смещение блока HPACK внутри полезной нагрузки. */
  blockOffset?: number;
  /** Динамическая таблица своей стороны после этого блока. */
  tableAfter?: DynamicTable;
}

/** Первый UDP-пакет QUIC: длинный заголовок, разобранный `QUIC_CODE`. */
export interface QuicLongHeader {
  long: boolean;
  type: string;
  version: number;
  dcid: string;
  scid: string;
  tokenLength: number;
  length: number;
  headerBytes: number;
}

export interface QuicApi {
  readVarint(b: number[], at: number): [number, number];
  readLongHeader(b: number[]): QuicLongHeader;
}
