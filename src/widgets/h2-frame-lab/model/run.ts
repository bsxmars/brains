import type { DynamicTable, H2Api, QuicApi, StandChunk, TimelineFrame } from './types';

/**
 * Демо и тест спрашивают одни и те же функции — строки `FRAME_CODE`, `HPACK_INT_CODE`,
 * `HPACK_TABLE_CODE`, `HPACK_DECODE_CODE` и `QUIC_CODE` из темы «HTTP/2 и HTTP/3».
 *
 * Строки напечатаны на странице, собраны здесь `new Function` и прогоняются
 * `tests/unit/http2-http3.test.ts` против nghttp2 (через `node:http2`) и тестовых векторов
 * RFC 7541. Копии нет — если показанный код разойдётся с настоящей реализацией, покраснеет тест.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadH2(frameCode: string, intCode: string, tableCode: string, decodeCode: string): H2Api {
  return new Function(
    `${frameCode}\n${intCode}\n${tableCode}\n${decodeCode}\n` +
      'return { FRAME_TYPES, PREFACE, readFrameHeader, splitFrames, readPayload, headerBlockOf, encodeInt, decodeInt, ' +
      'STATIC_TABLE, findStatic, createTable, addEntry, entryAt, decodeHuffman, decodeString, decodeHeaderBlock };',
  )() as H2Api;
}

export function loadQuic(code: string): QuicApi {
  return new Function(`${code}\nreturn { readVarint, readLongHeader };`)() as QuicApi;
}

export function hexToBytes(hex: string): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
  return out;
}

export function bytesToHex(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ');
}

/** Байты одной стороны подряд и номер куска, с которого начинается каждый байт. */
function side(chunks: StandChunk[], dir: 'c2s' | 's2c') {
  const bytes: number[] = [];
  const starts: [number, number][] = [];
  chunks.forEach((c, i) => {
    if (c.dir !== dir) return;
    starts.push([bytes.length, i]);
    bytes.push(...hexToBytes(c.hex));
  });
  return { bytes, starts };
}

const snapshot = (t: DynamicTable): DynamicTable => ({ entries: t.entries.map(([n, v]) => [n, v]), size: t.size, maxSize: t.maxSize });

/**
 * Запись прокси → общая лента кадров соединения в порядке прихода. Блоки HPACK каждой стороны
 * декодируются строго по порядку и своей динамической таблицей — иначе номера съедут.
 */
export function buildTimeline(api: H2Api, chunks: StandChunk[]): TimelineFrame[] {
  const all: TimelineFrame[] = [];
  for (const dir of ['c2s', 's2c'] as const) {
    const { bytes, starts } = side(chunks, dir);
    const table = api.createTable();
    for (const f of api.splitFrames(bytes)) {
      let chunk = 0;
      for (const [off, idx] of starts) if (off <= f.at) chunk = idx;
      const frame: TimelineFrame = { ...f, dir, chunk, n: 0, head: bytes.slice(f.at, f.at + 9) };
      if (f.type === 'HEADERS' || f.type === 'PUSH_PROMISE') {
        const block = api.headerBlockOf(f);
        frame.blockLength = block.length;
        frame.blockOffset = f.payload.length - block.length - (f.flags & 0x08 ? f.payload[0] : 0);
        frame.fields = api.decodeHeaderBlock(block, table);
        frame.tableAfter = snapshot(table);
      }
      all.push(frame);
    }
  }
  all.sort((a, b) => a.chunk - b.chunk || a.at - b.at);
  all.forEach((f, i) => (f.n = i + 1));
  return all;
}

/** Коды ошибок RFC 9113, §7 — подписи для RST_STREAM и GOAWAY. */
export const ERROR_CODES = [
  'NO_ERROR',
  'PROTOCOL_ERROR',
  'INTERNAL_ERROR',
  'FLOW_CONTROL_ERROR',
  'SETTINGS_TIMEOUT',
  'STREAM_CLOSED',
  'FRAME_SIZE_ERROR',
  'REFUSED_STREAM',
  'CANCEL',
  'COMPRESSION_ERROR',
  'CONNECT_ERROR',
  'ENHANCE_YOUR_CALM',
  'INADEQUATE_SECURITY',
  'HTTP_1_1_REQUIRED',
];

/** Флаги кадра словами — RFC 9113, §6. Набор зависит от типа. */
export function flagNames(type: string, flags: number): string[] {
  const table: Record<string, [number, string][]> = {
    DATA: [[0x01, 'END_STREAM'], [0x08, 'PADDED']],
    HEADERS: [[0x01, 'END_STREAM'], [0x04, 'END_HEADERS'], [0x08, 'PADDED'], [0x20, 'PRIORITY']],
    PUSH_PROMISE: [[0x04, 'END_HEADERS'], [0x08, 'PADDED']],
    SETTINGS: [[0x01, 'ACK']],
    PING: [[0x01, 'ACK']],
    CONTINUATION: [[0x04, 'END_HEADERS']],
  };
  return (table[type] ?? []).filter(([bit]) => flags & bit).map(([, name]) => name);
}
