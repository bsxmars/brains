/**
 * Демо и тест разбирают кадр WebSocket одним и тем же кодом — строкой `FRAME_CODE`.
 *
 * `loadFrameCode` собирает функции из той строки, что напечатана в теме «Долгие соединения»
 * (`src/content/platform/realtime/data.ts`). Копии нет: тот же текст тест кладёт файлом рядом
 * с сервером и гоняет против настоящих клиентов — Node и Chromium. Если напечатанный код
 * разойдётся с протоколом, покраснеет `tests/unit/realtime.test.ts`, а не читатель.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы модуль мог импортировать юнит-тест.
 */

export interface DecodedFrame {
  fin: boolean;
  opcode: number;
  masked: boolean;
  mask: Uint8Array | null;
  payload: Uint8Array;
  size: number;
}

export interface FrameApi {
  OP: Record<'continuation' | 'text' | 'binary' | 'close' | 'ping' | 'pong', number>;
  encodeFrame(frame: { opcode: number; payload: Uint8Array; mask?: Uint8Array | null; fin?: boolean }): Uint8Array;
  decodeFrame(bytes: Uint8Array): DecodedFrame | null;
  closePayload(code: number, reason?: string): Uint8Array;
  readClose(payload: Uint8Array): { code: number; reason: string };
}

/**
 * Код в теме — модуль (`export function …`): так его и пишут в проекте, и так его запускает тест.
 * `new Function` модулей не понимает, поэтому слово `export` в начале строки снимается —
 * больше ничего в тексте не меняется.
 */
export function loadFrameCode(code: string): FrameApi {
  const body = code.replace(/^export /gm, '');
  return new Function(`${body}\nreturn { OP, encodeFrame, decodeFrame, closePayload, readClose };`)() as FrameApi;
}

/** Маска из примера RFC 6455, §5.7: `Hello` под ней даёт известные байты — демо стартует с них. */
export const RFC_MASK = new Uint8Array([0x37, 0xfa, 0x21, 0x3d]);

export type FrameKind = 'text' | 'ping' | 'close';
export type FrameSize = 'as-is' | '200' | '70000';

export interface FrameInput {
  text: string;
  kind: FrameKind;
  /** Клиент обязан маскировать, сервер — не маскировать. */
  fromClient: boolean;
  size: FrameSize;
  mask: Uint8Array;
}

/** Одна клетка байтовой ленты: сам байт и к какой части кадра он относится. */
export interface ByteCell {
  hex: string;
  part: 'head' | 'len' | 'mask' | 'payload';
}

export interface FrameView {
  frame: Uint8Array;
  payload: Uint8Array;
  cells: ByteCell[];
  /** Сколько байт полезной нагрузки не показано (длинный кадр). */
  hidden: number;
  headerBytes: number;
  fin: boolean;
  opcode: number;
  opcodeName: string;
  masked: boolean;
  /** Семь бит длины во втором байте: сама длина, 126 или 127. */
  len7: number;
  lengthNote: string;
  /** Что получит другая сторона, разобрав эти байты тем же `decodeFrame`. */
  roundTrip: string;
  /** Управляющий кадр длиннее 125 байт — получатель обязан отвергнуть его. */
  tooLongControl: boolean;
}

const OP_NAMES: Record<number, string> = { 0: 'continuation', 1: 'text', 2: 'binary', 8: 'close', 9: 'ping', 10: 'pong' };

/** Сколько байт полезной нагрузки печатать: длинный кадр в ленту целиком не помещается. */
export const SHOWN_PAYLOAD = 24;

function stretch(text: string, size: FrameSize): string {
  if (size === 'as-is') return text;
  const target = Number(size);
  const seed = text || '·';
  let out = seed;
  while (new TextEncoder().encode(out).length < target) out += seed;
  // Режем по байтам, а не по символам: иначе кириллица даст вдвое больше байт, чем обещано.
  const bytes = new TextEncoder().encode(out).slice(0, target);
  return new TextDecoder().decode(bytes);
}

const hex = (b: number) => b.toString(16).padStart(2, '0');

export function buildFrame(api: FrameApi, input: FrameInput): FrameView {
  const text = stretch(input.text, input.size);
  const opcode = api.OP[input.kind];
  const payload =
    input.kind === 'close' ? api.closePayload(1000, text) : new TextEncoder().encode(text);
  const mask = input.fromClient ? input.mask : null;
  const frame = api.encodeFrame({ opcode, payload, mask });

  const len7 = frame[1] & 0x7f;
  const extBytes = len7 === 126 ? 2 : len7 === 127 ? 8 : 0;
  const headerBytes = 2 + extBytes + (mask ? 4 : 0);

  const cells: ByteCell[] = [];
  for (let i = 0; i < headerBytes; i++) {
    const part: ByteCell['part'] = i < 2 ? 'head' : i < 2 + extBytes ? 'len' : 'mask';
    cells.push({ hex: hex(frame[i]), part });
  }
  const shown = Math.min(payload.length, SHOWN_PAYLOAD);
  for (let i = 0; i < shown; i++) cells.push({ hex: hex(frame[headerBytes + i]), part: 'payload' });

  const decoded = api.decodeFrame(frame);
  let roundTrip = 'кадр не разобран';
  if (decoded) {
    if (decoded.opcode === api.OP.close) {
      const { code, reason } = api.readClose(decoded.payload);
      roundTrip = `close, код ${code}, причина «${short(reason)}»`;
    } else {
      roundTrip = `${OP_NAMES[decoded.opcode]}: «${short(new TextDecoder().decode(decoded.payload))}»`;
    }
  }

  const lengthNote =
    len7 < 126
      ? `длина ${payload.length} уместилась в 7 бит второго байта`
      : len7 === 126
        ? `126 во втором байте: длина ${payload.length} — в следующих 2 байтах`
        : `127 во втором байте: длина ${payload.length} — в следующих 8 байтах`;

  return {
    frame,
    payload,
    cells,
    hidden: payload.length - shown,
    headerBytes,
    fin: (frame[0] & 0x80) !== 0,
    opcode,
    opcodeName: OP_NAMES[opcode],
    masked: (frame[1] & 0x80) !== 0,
    len7,
    lengthNote,
    roundTrip,
    tooLongControl: input.kind !== 'text' && payload.length > 125,
  };
}

function short(s: string): string {
  return s.length > 40 ? `${s.slice(0, 40)}…` : s;
}

/** Байты полезной нагрузки до маски — чтобы показать, во что их превратил XOR. */
export function plainBytes(view: FrameView): string[] {
  return [...view.payload.slice(0, SHOWN_PAYLOAD)].map(hex);
}
