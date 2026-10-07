/**
 * Декодер двоичного модуля WebAssembly — ровно для того подмножества, из которого собран
 * учебный модуль темы. Он читает **байты**, а не описание секций из `data.ts`: тест сверяет
 * одно с другим, и если байты и описание разойдутся, покраснеет тест, а не читатель.
 *
 * Ни DOM, ни Vue: тот же модуль зовёт демо в браузере читателя и `tests/unit/wasm-threads.test.ts`.
 */

/** Имена секций по номеру — из спецификации (Binary Format, Sections). */
export const SECTION_NAMES: Record<number, string> = {
  0: 'custom',
  1: 'type',
  2: 'import',
  3: 'function',
  4: 'table',
  5: 'memory',
  6: 'global',
  7: 'export',
  8: 'start',
  9: 'element',
  10: 'code',
  11: 'data',
  12: 'datacount',
};

const VALTYPE: Record<number, string> = {
  0x7f: 'i32',
  0x7e: 'i64',
  0x7d: 'f32',
  0x7c: 'f64',
  0x7b: 'v128',
  0x70: 'funcref',
  0x6f: 'externref',
};

const EXTERNAL_KIND = ['функция', 'таблица', 'память', 'глобальная'];

/** Одна секция: где лежит заголовок, где содержимое и что в нём прочитано. */
export interface DecodedSection {
  id: number;
  name: string;
  /** Смещение байта с номером секции. */
  start: number;
  /** Смещение первого байта содержимого — после номера и длины. */
  contentStart: number;
  /** Смещение за последним байтом секции. */
  end: number;
  size: number;
  /** Прочитанное содержимое — по строке на запись. */
  items: string[];
}

export interface DecodedFunction {
  index: number;
  locals: string[];
  /** Инструкции без завершающего `end` функции — в том виде, как их пишут в WAT. */
  code: string[];
}

export interface DecodedModule {
  version: number;
  sections: DecodedSection[];
  functions: DecodedFunction[];
  length: number;
}

class Reader {
  pos: number;
  readonly bytes: ArrayLike<number>;
  constructor(bytes: ArrayLike<number>, start = 0) {
    this.bytes = bytes;
    this.pos = start;
  }

  byte(): number {
    if (this.pos >= this.bytes.length) throw new Error(`модуль оборвался на смещении ${this.pos}`);
    return this.bytes[this.pos++];
  }

  u32(): number {
    let result = 0;
    let shift = 0;
    for (;;) {
      const b = this.byte();
      result += (b & 0x7f) * 2 ** shift;
      if ((b & 0x80) === 0) return result;
      shift += 7;
    }
  }

  /** Знаковое LEB128 — так записаны константы `i32.const` и `i64.const`. */
  s64(): bigint {
    let result = 0n;
    let shift = 0n;
    let b: number;
    do {
      b = this.byte();
      result |= BigInt(b & 0x7f) << shift;
      shift += 7n;
    } while (b & 0x80);
    if (b & 0x40) result -= 1n << shift;
    return result;
  }

  name(): string {
    const len = this.u32();
    let s = '';
    for (let i = 0; i < len; i++) s += String.fromCharCode(this.byte());
    return s;
  }

  valtype(): string {
    const b = this.byte();
    const t = VALTYPE[b];
    if (!t) throw new Error(`неизвестный тип 0x${b.toString(16)} на смещении ${this.pos - 1}`);
    return t;
  }

  limits(): string {
    const flag = this.byte();
    const min = this.u32();
    const max = flag & 0x01 ? this.u32() : null;
    const shared = flag & 0x02 ? ', общая' : '';
    return max === null ? `мин ${min}${shared}` : `мин ${min}, макс ${max}${shared}`;
  }
}

/** Инструкции подмножества: байт (или пара с префиксом) → имя и разбор непосредственных. */
type Imm = 'none' | 'u32' | 's32' | 's64' | 'block' | 'memarg' | 'mem' | 'v128';
const OPS: Record<number, [string, Imm]> = {
  0x02: ['block', 'block'],
  0x03: ['loop', 'block'],
  0x04: ['if', 'block'],
  0x0b: ['end', 'none'],
  0x0c: ['br', 'u32'],
  0x0d: ['br_if', 'u32'],
  0x10: ['call', 'u32'],
  0x1a: ['drop', 'none'],
  0x20: ['local.get', 'u32'],
  0x21: ['local.set', 'u32'],
  0x22: ['local.tee', 'u32'],
  0x28: ['i32.load', 'memarg'],
  0x2d: ['i32.load8_u', 'memarg'],
  0x36: ['i32.store', 'memarg'],
  0x3a: ['i32.store8', 'memarg'],
  0x40: ['memory.grow', 'mem'],
  0x41: ['i32.const', 's32'],
  0x42: ['i64.const', 's64'],
  0x45: ['i32.eqz', 'none'],
  0x49: ['i32.lt_u', 'none'],
  0x4f: ['i32.ge_u', 'none'],
  0x6a: ['i32.add', 'none'],
  0x6b: ['i32.sub', 'none'],
  0x7c: ['i64.add', 'none'],
};
/** Префикс 0xFE — атомарные инструкции (предложение threads). */
const ATOMIC_OPS: Record<number, string> = {
  0x00: 'memory.atomic.notify',
  0x01: 'memory.atomic.wait32',
  0x1e: 'i32.atomic.rmw.add',
};
/** Префикс 0xFD — SIMD. */
const SIMD_OPS: Record<number, [string, Imm]> = {
  0x0c: ['v128.const', 'v128'],
};

/** Естественное выравнивание по имени инструкции: memarg пишет его логарифмом. */
function naturalAlign(op: string): number {
  if (op.includes('8')) return 0;
  return 2;
}

function immediate(r: Reader, op: string, imm: Imm): string {
  switch (imm) {
    case 'none':
      return op;
    case 'u32':
      return `${op} ${r.u32()}`;
    case 's32':
    case 's64':
      return `${op} ${r.s64()}`;
    case 'block': {
      const bt = r.byte();
      if (bt === 0x40) return op;
      const t = VALTYPE[bt];
      if (!t) throw new Error(`тип блока 0x${bt.toString(16)} не поддержан`);
      return `${op} (result ${t})`;
    }
    case 'memarg': {
      const align = r.u32();
      const offset = r.u32();
      const parts = [op];
      if (offset) parts.push(`offset=${offset}`);
      if (align !== naturalAlign(op)) parts.push(`align=${2 ** align}`);
      return parts.join(' ');
    }
    case 'mem': {
      const index = r.u32();
      return index === 0 ? op : `${op} ${index}`;
    }
    case 'v128': {
      const lanes: number[] = [];
      for (let i = 0; i < 16; i++) lanes.push(r.byte());
      return `${op} i8x16 ${lanes.join(' ')}`;
    }
  }
}

function instruction(r: Reader): string {
  const at = r.pos;
  const b = r.byte();
  if (b === 0xfe) {
    const sub = r.u32();
    const op = ATOMIC_OPS[sub];
    if (!op) throw new Error(`атомарная 0xFE ${sub} не поддержана (смещение ${at})`);
    return op === 'memory.atomic.notify' || op === 'memory.atomic.wait32' || op === 'i32.atomic.rmw.add'
      ? immediate(r, op, 'memarg')
      : op;
  }
  if (b === 0xfd) {
    const sub = r.u32();
    const entry = SIMD_OPS[sub];
    if (!entry) throw new Error(`SIMD 0xFD ${sub} не поддержана (смещение ${at})`);
    return immediate(r, entry[0], entry[1]);
  }
  const entry = OPS[b];
  if (!entry) throw new Error(`опкод 0x${b.toString(16)} не поддержан (смещение ${at})`);
  return immediate(r, entry[0], entry[1]);
}

/** Тело функции: локальные группами и инструкции до парного `end`. */
function decodeBody(r: Reader, end: number, index: number): DecodedFunction {
  const locals: string[] = [];
  const groups = r.u32();
  for (let g = 0; g < groups; g++) {
    const count = r.u32();
    const type = r.valtype();
    for (let i = 0; i < count; i++) locals.push(type);
  }
  const code: string[] = [];
  let depth = 0;
  while (r.pos < end) {
    const ins = instruction(r);
    if (ins === 'end') {
      if (depth === 0) {
        if (r.pos !== end) throw new Error(`функция ${index}: байты после конца тела`);
        return { index, locals, code };
      }
      depth--;
    } else if (/^(block|loop|if)\b/.test(ins)) {
      depth++;
    }
    code.push(ins);
  }
  throw new Error(`функция ${index}: тело без завершающего end`);
}

function signature(r: Reader): string {
  if (r.byte() !== 0x60) throw new Error('ожидалась сигнатура функции (0x60)');
  const params: string[] = [];
  const results: string[] = [];
  for (let i = r.u32(); i > 0; i--) params.push(r.valtype());
  for (let i = r.u32(); i > 0; i--) results.push(r.valtype());
  return `(${params.join(', ')}) → ${results.length ? results.join(', ') : '()'}`;
}

/** Прочитать модуль целиком. Бросает, если встретит то, чего подмножество не знает. */
export function decodeModule(bytes: ArrayLike<number>): DecodedModule {
  const r = new Reader(bytes);
  const magic = [r.byte(), r.byte(), r.byte(), r.byte()];
  if (magic.join() !== '0,97,115,109') throw new Error('нет магии \\0asm в начале');
  const version = r.byte() | (r.byte() << 8) | (r.byte() << 16) | (r.byte() << 24);

  const sections: DecodedSection[] = [];
  const functions: DecodedFunction[] = [];
  let importedFuncs = 0;

  while (r.pos < bytes.length) {
    const start = r.pos;
    const id = r.byte();
    const size = r.u32();
    const contentStart = r.pos;
    const end = contentStart + size;
    const items: string[] = [];
    const name = SECTION_NAMES[id] ?? `?${id}`;

    const count = r.u32();
    for (let i = 0; i < count; i++) {
      switch (id) {
        case 1:
          items.push(`тип ${i}: ${signature(r)}`);
          break;
        case 2: {
          const mod = r.name();
          const field = r.name();
          const kind = r.byte();
          let what: string;
          if (kind === 0) {
            what = `функция, тип ${r.u32()}`;
            importedFuncs++;
          } else if (kind === 2) {
            what = `память, ${r.limits()}`;
          } else {
            throw new Error(`импорт вида ${kind} не поддержан`);
          }
          items.push(`${mod}.${field}: ${what}`);
          break;
        }
        case 3:
          items.push(`функция ${importedFuncs + i}: тип ${r.u32()}`);
          break;
        case 4: {
          const type = r.valtype();
          items.push(`таблица ${i}: ${type}, ${r.limits()}`);
          break;
        }
        case 5:
          items.push(`память ${i}: ${r.limits()} (страница — 64 КиБ)`);
          break;
        case 7: {
          const field = r.name();
          const kind = r.byte();
          items.push(`«${field}» → ${EXTERNAL_KIND[kind] ?? `вид ${kind}`} ${r.u32()}`);
          break;
        }
        case 9: {
          const flags = r.u32();
          if (flags !== 0) throw new Error(`сегмент элементов с флагами ${flags} не поддержан`);
          const offset = instruction(r);
          if (r.byte() !== 0x0b) throw new Error('смещение сегмента без end');
          const refs: number[] = [];
          for (let k = r.u32(); k > 0; k--) refs.push(r.u32());
          items.push(`таблица 0 с ячейки ${offset.split(' ')[1]}: функции ${refs.join(', ')}`);
          break;
        }
        case 10: {
          const len = r.u32();
          const fn = decodeBody(r, r.pos + len, importedFuncs + i);
          functions.push(fn);
          const locals = fn.locals.length ? `, локальные: ${fn.locals.join(' ')}` : '';
          items.push(`тело функции ${fn.index}: ${len} Б, инструкций ${fn.code.length}${locals}`);
          break;
        }
        default:
          throw new Error(`секция ${id} (${name}) не поддержана`);
      }
    }
    if (r.pos !== end) throw new Error(`секция ${name}: прочитано ${r.pos - contentStart} из ${size} байт`);
    sections.push({ id, name, start, contentStart, end, size, items });
  }

  return { version, sections, functions, length: bytes.length };
}

/**
 * Инструкции функции из текста WAT: строки между заголовком `(func $имя` и следующим `(func`
 * или концом модуля, без скобок и комментариев. Нужна тесту — сверить текст с байтами.
 */
export function watInstructions(wat: string, fn: string): string[] {
  // Заголовок функции — строка, которая с него начинается; `(func $add)` внутри экспорта не в счёт.
  const lines = wat.split('\n');
  const from = lines.findIndex((l) => l.trimStart().startsWith(`(func ${fn} `));
  if (from < 0) throw new Error(`в тексте нет функции ${fn}`);
  const rest = lines.slice(from + 1);
  const out: string[] = [];
  for (const raw of rest) {
    const line = raw.replace(/;;.*$/, '').trim();
    if (line.startsWith('(func')) break;
    const ins = line.replace(/\)+$/, '').trim();
    if (ins) out.push(ins);
  }
  return out;
}

/** Байты в шестнадцатеричном виде по два знака — так их показывает демо. */
export function hex(b: number): string {
  return b.toString(16).padStart(2, '0');
}
