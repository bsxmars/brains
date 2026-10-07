import type { DeflateApi, DeflateCodes, ReadEvent, Token } from './types';

/**
 * Демо и тест спрашивают одни и те же функции — строки `LZ77_CODE`, `HUFFMAN_CODE`,
 * `INFLATE_CODE`, `WRAP_CODE` и `BITS_CODE` из темы «Что внутри gzip».
 *
 * Строки напечатаны на странице, собраны здесь `new Function` и прогоняются
 * `tests/unit/deflate.test.ts`: распаковка — против настоящих `zlib`, fflate и pako на всех
 * уровнях, длины кодов — против dynamic-блоков zlib, LZ77 — на свойствах. Копии нет: разойдётся
 * показанный код с эталоном — покраснеет тест.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест. Единственное
 * исключение — `gzipText`: он зовёт `CompressionStream`, который есть и в браузере, и в Node.
 */
export function loadDeflate(codes: DeflateCodes): DeflateApi {
  return new Function(
    `${codes.lz77}\n${codes.huffman}\n${codes.inflate}\n${codes.wrap}\n${codes.bits}\n` +
      'return { WINDOW, MIN_MATCH, MAX_MATCH, lz77, unlz77, huffmanLengths, canonicalCodes,' +
      ' LEN_BASE, LEN_EXTRA, DIST_BASE, DIST_EXTRA, ORDER, inflateRaw, gunzip, adler32, unzlib,' +
      ' symbolOf, blockBits, fixedBits };',
  )() as DeflateApi;
}

/** Настоящий gzip того же текста — тем, что встроено в среду (в Chromium и Node это zlib). */
export async function gzipText(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Начало каждого токена в байтах исходника. */
export function tokenStarts(tokens: Token[]): number[] {
  const out: number[] = [];
  let at = 0;
  for (const t of tokens) {
    out.push(at);
    at += 'lit' in t ? 1 : t.len;
  }
  return out;
}

/** Символы строки с байтом, с которого каждый начинается в UTF-8. */
export function charStarts(text: string): { ch: string; at: number }[] {
  const enc = new TextEncoder();
  const out: { ch: string; at: number }[] = [];
  let at = 0;
  for (const ch of text) {
    out.push({ ch, at });
    at += enc.encode(ch).length;
  }
  return out;
}

/** Биты `[from, to)` в том порядке, в каком их читает распаковщик: с младшего бита байта. */
export function bitString(bytes: Uint8Array, from: number, to: number): string {
  let s = '';
  for (let p = from; p < to; p++) s += (bytes[p >> 3] >> (p & 7)) & 1;
  return s;
}

/** Байт как подпись: печатный ASCII — сам символ, остальное — шестнадцатеричным числом. */
export function byteLabel(b: number): string {
  if (b === 32) return '␠';
  if (b === 10) return '\\n';
  if (b > 32 && b < 127) return String.fromCharCode(b);
  return `0x${b.toString(16).padStart(2, '0')}`;
}

/** Символ алфавита литералов и длин — словами. */
export function litLenLabel(s: number, api: Pick<DeflateApi, 'LEN_BASE' | 'LEN_EXTRA'>): string {
  if (s < 256) return `литерал ${byteLabel(s)}`;
  if (s === 256) return 'конец блока';
  const i = s - 257;
  const lo = api.LEN_BASE[i];
  const hi = lo + 2 ** api.LEN_EXTRA[i] - 1;
  return lo === hi || i === 28 ? `длина ${lo}` : `длина ${lo}–${hi}`;
}

export interface ReadRow {
  key: number;
  from: number;
  to: number;
  bits: string;
  field: string;
  value: string;
  meaning: string;
  /** Чем подсветить строку: заголовок блока, таблица длин, данные. */
  kind: 'block' | 'table' | 'data';
}

/**
 * Чтения распаковщика — строками таблицы. Состояние нужно, чтобы назвать, чью длину
 * задаёт очередной символ алфавита длин: литерала, длины или расстояния.
 */
export function describeReads(
  events: ReadEvent[],
  bytes: Uint8Array,
  api: Pick<DeflateApi, 'LEN_BASE' | 'LEN_EXTRA' | 'DIST_BASE'>,
): ReadRow[] {
  let hlit = 0;
  let filled = 0;
  let lastLen = 0;
  let lastSym = 0;
  let lenBase = 0;
  const whose = (k: number) =>
    k < hlit ? (k < 256 ? `литерала ${byteLabel(k)}` : k === 256 ? 'конца блока' : `кода ${k}`) : `расстояния ${k - hlit}`;

  return events.map((e, key) => {
    const row: ReadRow = { key, from: e.from, to: e.to, bits: bitString(bytes, e.from, e.to), field: e.what, value: String(e.value), meaning: '', kind: 'block' };
    const v = e.value;
    switch (e.what) {
      case 'BFINAL':
        row.meaning = v ? 'последний блок' : 'за ним будут ещё блоки';
        break;
      case 'BTYPE':
        row.meaning = ['stored — байты как есть', 'fixed — коды из RFC', 'dynamic — свои коды', 'ошибка'][v];
        break;
      case 'LEN':
        row.meaning = `${v} байт без сжатия`;
        break;
      case 'NLEN':
        row.meaning = 'LEN с инвертированными битами — проверка';
        break;
      case 'HLIT':
        hlit = v + 257;
        filled = 0;
        row.meaning = `${v} + 257 = ${hlit} длин для литералов и длин`;
        break;
      case 'HDIST':
        row.meaning = `${v} + 1 = ${v + 1} длин для расстояний`;
        break;
      case 'HCLEN':
        row.meaning = `${v} + 4 = ${v + 4} длин для алфавита длин`;
        break;
      case 'LENSYM':
        row.kind = 'table';
        lastSym = v;
        if (v < 16) {
          row.field = 'длина';
          row.meaning = v ? `код ${whose(filled)} — ${v} бит` : `у ${whose(filled)} кода нет`;
          lastLen = v;
          filled++;
        } else {
          row.field = `символ ${v}`;
          row.meaning = v === 16 ? `повторить длину ${lastLen}` : 'серия нулей';
        }
        break;
      case 'REP': {
        row.kind = 'table';
        row.field = 'повторов';
        const n = v + (lastSym === 18 ? 11 : 3);
        const what = lastSym === 16 ? `длина ${lastLen}` : 'нет кода';
        row.value = `${v} → ${n}`;
        row.meaning = `${whose(filled)} … ${whose(filled + n - 1)}: ${what}`;
        if (lastSym !== 16) lastLen = 0;
        filled += n;
        break;
      }
      case 'SYM':
        row.kind = 'data';
        row.field = 'символ';
        row.meaning = litLenLabel(v, api);
        if (v > 256) lenBase = api.LEN_BASE[v - 257];
        break;
      case 'LENX':
        row.kind = 'data';
        row.field = 'extra длины';
        row.meaning = `длина ${lenBase} + ${v} = ${lenBase + v}`;
        break;
      case 'DIST':
        row.kind = 'data';
        row.field = 'код расст.';
        lenBase = api.DIST_BASE[v];
        row.meaning = `расстояние от ${lenBase}`;
        break;
      case 'DISTX':
        row.kind = 'data';
        row.field = 'extra расст.';
        row.meaning = `назад на ${lenBase + v}`;
        break;
      default:
        if (e.what.startsWith('CL')) {
          row.kind = 'table';
          row.field = `длина «${e.what.slice(2)}»`;
          row.meaning = v ? `символ ${e.what.slice(2)} алфавита длин — код ${v} бит` : `символа ${e.what.slice(2)} нет`;
        }
    }
    return row;
  });
}
