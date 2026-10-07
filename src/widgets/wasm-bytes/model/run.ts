/**
 * Исполнение учебного модуля — в браузере читателя и в тесте одним и тем же кодом.
 *
 * Здесь нет ни одной заготовленной строки результата: каждое число берётся у движка —
 * `WebAssembly.instantiate`, вызов экспорта, чтение `memory.buffer`, `memory.grow`.
 */

/** Сколько байт памяти показывать: адрес строки плюс запас. */
export const WINDOW = 48;

/** Куда класть строку. У учебного модуля нет распределителя памяти — адрес выбран руками. */
export const STRING_PTR = 16;

export interface ModuleRun {
  add: { a: number; b: number; result: number };
  /** Длина строки в JS — кодовые единицы UTF-16. */
  chars: number;
  /** Байт UTF-8 — ровно столько переехало в память и обратно. */
  bytes: number;
  before: number[];
  after: number[];
  result: string;
  /** Что модуль передал в импорт `env.report` — число поменянных букв. */
  reported: number[];
  grow: {
    /** `memory.grow(1)` вернул прежний размер в страницах. */
    previousPages: number;
    oldByteLength: number;
    oldDetached: boolean | null;
    newByteLength: number;
    sameObject: boolean;
  };
  tableHoldsAdd: boolean;
}

interface Exports {
  add: (a: number, b: number) => number;
  upper: (ptr: number, len: number) => void;
  memory: WebAssembly.Memory;
  table: WebAssembly.Table;
}

/** Создать экземпляр, сложить, провести строку через память и вырастить память на страницу. */
export async function runModule(bytes: ArrayLike<number>, text: string, a: number, b: number): Promise<ModuleRun> {
  const reported: number[] = [];
  const { instance } = await WebAssembly.instantiate(new Uint8Array(bytes), {
    env: { report: (n: number) => reported.push(n) },
  });
  const e = instance.exports as unknown as Exports;

  const sum = e.add(a, b);

  // Строка в память: закодировать, записать по адресу, передать указатель и длину.
  const encoded = new TextEncoder().encode(text);
  const view = new Uint8Array(e.memory.buffer);
  view.set(encoded, STRING_PTR);
  const before = [...view.subarray(0, WINDOW)];
  e.upper(STRING_PTR, encoded.length);
  const after = [...new Uint8Array(e.memory.buffer, 0, WINDOW)];
  const result = new TextDecoder().decode(new Uint8Array(e.memory.buffer, STRING_PTR, encoded.length));

  // Рост памяти: старый ArrayBuffer отсоединяется, у памяти — новый.
  const old = e.memory.buffer;
  const previousPages = e.memory.grow(1);
  const detached = (old as ArrayBuffer & { detached?: boolean }).detached;

  return {
    add: { a, b, result: sum },
    chars: text.length,
    bytes: encoded.length,
    before,
    after,
    result,
    reported,
    grow: {
      previousPages,
      oldByteLength: old.byteLength,
      oldDetached: typeof detached === 'boolean' ? detached : null,
      newByteLength: e.memory.buffer.byteLength,
      sameObject: e.memory.buffer === old,
    },
    tableHoldsAdd: e.table.get(0) === (e.add as unknown),
  };
}

/** Строка байтов для витрины: печатные ASCII как есть, остальное точкой. */
export function ascii(bytes: number[]): string {
  return bytes.map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '·')).join('');
}

/* ──────────────────────────── Граница: что происходит с числом ──────────────────────────── */

export interface BoundaryRow {
  /** Какой экспорт и с чем позван — ключ для сверки с таблицей темы. */
  call: string;
  /** Что вернулось, в виде строки: `5`, `-1`, `6n`, `TypeError`. */
  got: string;
}

/** Вызовы, из которых складывается таблица границы. Порядок — как в таблице темы. */
export const BOUNDARY_CALLS: { call: string; fn: string; arg: () => unknown }[] = [
  { call: 'i32(2 ** 32 + 5)', fn: 'i32', arg: () => 2 ** 32 + 5 },
  { call: 'i32(0xFFFFFFFF)', fn: 'i32', arg: () => 0xffffffff },
  { call: 'i32(3.99)', fn: 'i32', arg: () => 3.99 },
  { call: "i32('12')", fn: 'i32', arg: () => '12' },
  { call: 'i32(NaN)', fn: 'i32', arg: () => NaN },
  { call: 'i32(10n)', fn: 'i32', arg: () => 10n },
  { call: 'f32(0.1)', fn: 'f32', arg: () => 0.1 },
  { call: 'f32(16777217)', fn: 'f32', arg: () => 16777217 },
  { call: 'f64(0.1)', fn: 'f64', arg: () => 0.1 },
  { call: 'i64(5)', fn: 'i64', arg: () => 5 },
  { call: 'i64(5n)', fn: 'i64', arg: () => 5n },
  { call: 'i64(2n ** 63n - 1n)', fn: 'i64', arg: () => 2n ** 63n - 1n },
  { call: 'externref(obj) === obj', fn: 'externref', arg: () => BOUNDARY_OBJECT },
];

const BOUNDARY_OBJECT = { note: 'любой объект JS' };

function show(v: unknown): string {
  if (typeof v === 'bigint') return `${v}n`;
  if (typeof v === 'string') return `'${v}'`;
  return String(v);
}

/** Прогнать `BOUNDARY_CALLS` через модуль-«зеркало» и записать, что вернулось. */
export async function runBoundary(bytes: ArrayLike<number>): Promise<BoundaryRow[]> {
  const { instance } = await WebAssembly.instantiate(new Uint8Array(bytes));
  const fns = instance.exports as Record<string, (x: unknown) => unknown>;
  return BOUNDARY_CALLS.map(({ call, fn, arg }) => {
    try {
      const value = fns[fn](arg());
      return { call, got: fn === 'externref' ? String(value === BOUNDARY_OBJECT) : show(value) };
    } catch (failure) {
      return { call, got: failure instanceof Error ? failure.name : String(failure) };
    }
  });
}

/* ──────────────────────────── Общая память в этой вкладке ──────────────────────────── */

export interface SharedProbe {
  isolated: boolean | null;
  /** `typeof SharedArrayBuffer` — есть ли глобальное имя. */
  globalName: string;
  /** Удалось ли создать `new WebAssembly.Memory({ shared: true, … })`, иначе имя ошибки. */
  memory: string;
  /** Тег буфера такой памяти: `[object SharedArrayBuffer]` или `[object ArrayBuffer]`. */
  bufferTag: string;
  /** Что сделал `structuredClone(memory)` — шаг, без которого память не попадёт в воркер. */
  clone: string;
}

/** Спросить у среды, где исполняется код, можно ли здесь общую память и можно ли её отправить. */
export function probeShared(): SharedProbe {
  const g = globalThis as { crossOriginIsolated?: boolean };
  const out: SharedProbe = {
    isolated: typeof g.crossOriginIsolated === 'boolean' ? g.crossOriginIsolated : null,
    globalName: typeof (globalThis as { SharedArrayBuffer?: unknown }).SharedArrayBuffer,
    memory: '',
    bufferTag: '',
    clone: '',
  };
  let memory: WebAssembly.Memory;
  try {
    memory = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });
    out.memory = 'создана';
  } catch (failure) {
    out.memory = failure instanceof Error ? failure.name : String(failure);
    return out;
  }
  out.bufferTag = Object.prototype.toString.call(memory.buffer);
  try {
    structuredClone(memory);
    out.clone = 'клонирована';
  } catch (failure) {
    out.clone = failure instanceof Error ? failure.name : String(failure);
  }
  return out;
}
