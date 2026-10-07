import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  BOUNDARY_BYTES,
  BOUNDARY_ROWS,
  GROW_BYTES,
  GROW_CODE,
  IMPORT_FACTS,
  JS_STRING_BYTES,
  MODULE_BYTES,
  MODULE_SECTIONS,
  MODULE_WAT,
  PAGE_FACTS,
  RACY_OBSERVED,
  RESIZABLE_CODE,
  RESIZABLE_EXPECT,
  SHARED_BYTES,
  SHARED_RULES,
  SIMD_BYTES,
  SIMD_EXPORT_BYTES,
  STRING_CODE,
  STRING_EXPECT,
  THREADS_MAIN_CODE,
  THREADS_N,
  THREADS_RESULT,
  THREADS_WORKER_CODE,
} from '@/content/lessons/wasm-threads/data';
import { decodeModule, watInstructions } from '@/widgets/wasm-bytes/model/decode';
import { probeShared, runBoundary, runModule } from '@/widgets/wasm-bytes/model/run';

/**
 * «WebAssembly: память, потоки и граница с JS» — всё, что тема утверждает о движке, здесь
 * исполняется.
 *
 * Модули собраны руками, байтами, в `data.ts` темы; компилятора нет ни одного. Тест берёт
 * **те же** массивы, что показывает демо, и те же строки кода, что видит читатель
 * (`STRING_CODE`, `GROW_CODE`, `RESIZABLE_CODE`, `THREADS_*_CODE`), — копии примеров
 * здесь нет. Декодер и исполнитель демо (`widgets/wasm-bytes/model/*`) — тоже те же модули,
 * что зовёт остров в браузере читателя.
 *
 * Что проверяется в браузере, а не здесь: общая память без изоляции, ловушка `wait`
 * на главном потоке и CSP — `tests/e2e/wasm-threads.spec.ts`.
 *
 * ⚠️ Таймерных проверок нет. Потоки проверяются по тому, что от расписания не зависит:
 * атомарный счётчик даёт ровно 2 × N, неатомарный — не больше; число разбуженных равно числу
 * тех, кто ответил «разбудили».
 */

const u8 = (bytes: number[]) => new Uint8Array(bytes);

/**
 * Методы памяти и буфера, которых ещё нет в стандартной библиотеке типов TypeScript,
 * хотя в Node 26.8.2 и Chromium 153 они есть: `toResizableBuffer`, `toFixedLengthBuffer`,
 * `resize` и `detached`.
 */
type Buf = ArrayBuffer & { detached: boolean; resize: (n: number) => void };
type Mem = WebAssembly.Memory & { toResizableBuffer: () => Buf; toFixedLengthBuffer: () => Buf };
const mem = (m: WebAssembly.Memory) => m as Mem;
const buf = (b: ArrayBufferLike) => b as Buf;

interface Teaching {
  add: (a: number, b: number) => number;
  upper: (ptr: number, len: number) => void;
  memory: WebAssembly.Memory;
  table: WebAssembly.Table;
}

function teaching(report: (n: number) => void = () => {}): Teaching {
  const instance = new WebAssembly.Instance(new WebAssembly.Module(u8(MODULE_BYTES)), { env: { report } });
  return instance.exports as unknown as Teaching;
}

function errorName(fn: () => unknown): string {
  try {
    fn();
    return 'не бросило';
  } catch (failure) {
    return failure instanceof Error ? failure.name : String(failure);
  }
}

describe('учебный модуль: байты, декодер и текст WAT говорят одно и то же', () => {
  const decoded = decodeModule(MODULE_BYTES);

  it('все модули темы проходят validate', () => {
    for (const [name, bytes] of Object.entries({
      MODULE_BYTES,
      BOUNDARY_BYTES,
      SHARED_BYTES,
      GROW_BYTES,
      SIMD_BYTES,
      SIMD_EXPORT_BYTES,
      JS_STRING_BYTES,
    })) {
      expect(WebAssembly.validate(u8(bytes)), name).toBe(true);
    }
  });

  it('декодер, читая байты, находит те же секции и те же длины, что описаны в data.ts', () => {
    expect(decoded.sections.map((s) => [s.id, s.name, s.size])).toEqual(
      MODULE_SECTIONS.map((s) => [s.id, s.name, s.content.length]),
    );
    expect(decoded.version).toBe(1);
    expect(decoded.sections.at(-1)!.end).toBe(MODULE_BYTES.length);
  });

  it('инструкции add и upper в WAT совпадают с дизассемблированными байтами', () => {
    const [add, upper] = decoded.functions;
    expect(add.index).toBe(1);
    expect(upper.index).toBe(2);
    expect(watInstructions(MODULE_WAT, '$add')).toEqual(add.code);
    expect(watInstructions(MODULE_WAT, '$upper')).toEqual(upper.code);
    expect(upper.locals).toEqual(['i32', 'i32', 'i32']);
  });

  it('заголовочные строки WAT совпадают с секциями: память 1…4, импорт env.report, четыре экспорта', () => {
    const items = decoded.sections.flatMap((s) => s.items);
    expect(MODULE_WAT).toContain('(memory 1 4)');
    expect(items).toContain('память 0: мин 1, макс 4 (страница — 64 КиБ)');
    expect(items).toContain('env.report: функция, тип 2');
    expect(items.filter((i) => i.startsWith('«'))).toEqual([
      '«add» → функция 1',
      '«upper» → функция 2',
      '«memory» → память 0',
      '«table» → таблица 0',
    ]);
    expect(items).toContain('таблица 0 с ячейки 0: функции 1');
  });

  it('движок видит те же импорты и экспорты, что и декодер', () => {
    const mod = new WebAssembly.Module(u8(MODULE_BYTES));
    expect(WebAssembly.Module.imports(mod)).toEqual([{ module: 'env', name: 'report', kind: 'function' }]);
    expect(WebAssembly.Module.exports(mod).map((e) => `${e.name}:${e.kind}`)).toEqual([
      'add:function',
      'upper:function',
      'memory:memory',
      'table:table',
    ]);
  });

  it('декодер общего модуля читает флаг 0x03 как «общая» и атомарные инструкции по именам', () => {
    const shared = decodeModule(SHARED_BYTES);
    expect(shared.sections.flatMap((s) => s.items)).toContain('env.mem: память, мин 1, макс 1, общая');
    const code = shared.functions.flatMap((f) => f.code);
    expect(code).toContain('i32.atomic.rmw.add');
    expect(code).toContain('memory.atomic.wait32');
    expect(code).toContain('memory.atomic.notify');
  });
});

describe('модуль и экземпляр: импорты проверяются при создании экземпляра', () => {
  const mod = new WebAssembly.Module(u8(MODULE_BYTES));

  it('без второго аргумента — TypeError, без env — TypeError, без report или не функция — LinkError', () => {
    expect(errorName(() => new WebAssembly.Instance(mod))).toBe('TypeError');
    expect(errorName(() => new WebAssembly.Instance(mod, {}))).toBe('TypeError');
    expect(errorName(() => new WebAssembly.Instance(mod, { env: {} }))).toBe('LinkError');
    expect(errorName(() => new WebAssembly.Instance(mod, { env: { report: 1 } }))).toBe('LinkError');
  });

  it('экспорт — обёртка: length — число параметров, name — номер функции строкой', () => {
    const e = teaching();
    expect(e.add.length).toBe(2);
    expect(e.add.name).toBe('1');
    // Тема называет это имя дословно — строка обязана совпадать с движком.
    expect(IMPORT_FACTS.map((f) => f.d).join(' ')).toContain("`'1'`");
  });

  it('таблица держит ту же функцию; JS-функцию в неё положить нельзя, null — можно', () => {
    const e = teaching();
    expect(e.table.get(0)).toBe(e.add);
    expect(errorName(() => e.table.set(0, (() => 1) as unknown as null))).toBe('TypeError');
    e.table.set(0, null);
    expect(e.table.get(0)).toBe(null);
  });

  /**
   * ⚠️ В отдельном процессе: vitest подменяет `Error.prepareStackTrace` ради карт исходников,
   * и внутри него кадр Wasm печатается как `wasm://wasm/…:1:138` — без номера функции.
   * Утверждение темы — про обычный Node, там его и проверяем.
   */
  it('стек ловушки называет функцию номером: wasm-function[2] (в обычном процессе Node)', () => {
    const code = `
      const bytes = new Uint8Array(${JSON.stringify(MODULE_BYTES)});
      const { exports: e } = new WebAssembly.Instance(new WebAssembly.Module(bytes), { env: { report() {} } });
      try { e.upper(65530, 100); } catch (x) { console.log(x.stack); }`;
    const stack = execFileSync(process.execPath, ['-e', code], { encoding: 'utf8' });
    expect(stack).toContain('wasm-function[2]');
  });
});

describe('исполнитель демо: строка через память, рост, сложение', () => {
  it('runModule даёт то, что обещает тема', async () => {
    const run = await runModule(MODULE_BYTES, STRING_EXPECT.text, 2, 3);
    expect(run.add.result).toBe(5);
    expect(run.result).toBe(STRING_EXPECT.result);
    expect(run.chars).toBe(STRING_EXPECT.chars);
    expect(run.bytes).toBe(STRING_EXPECT.bytes);
    expect(run.reported).toEqual([STRING_EXPECT.reported]);
    expect(run.tableHoldsAdd).toBe(true);
    expect(run.grow).toEqual({
      previousPages: 1,
      oldByteLength: 0,
      oldDetached: true,
      newByteLength: 131072,
      sameObject: false,
    });
  });

  it('значения по умолчанию в демо: 2147483647 + 1 даёт -2147483648', async () => {
    const run = await runModule(MODULE_BYTES, 'x', 2147483647, 1);
    expect(run.add.result).toBe(-2147483648);
  });

  it('STRING_CODE, исполненный как есть, даёт тот же результат', () => {
    const reported: number[] = [];
    const e = teaching((n) => reported.push(n));
    const result = new Function('text', 'memory', 'upper', `${STRING_CODE}\nreturn result;`)(
      STRING_EXPECT.text,
      e.memory,
      e.upper,
    );
    expect(result).toBe(STRING_EXPECT.result);
    expect(reported).toEqual([STRING_EXPECT.reported]);
  });

  it('GROW_CODE: grow возвращает прежний размер, старый вид пуст, новый буфер — две страницы', () => {
    const e = teaching();
    const got = new Function('memory', `${GROW_CODE}\nreturn { pages, lost: view.length, now: memory.buffer.byteLength };`)(
      e.memory,
    );
    expect(got).toEqual({ pages: 1, lost: 0, now: 131072 });
  });

  it('RESIZABLE_CODE: растягиваемый буфер не отсоединяется и растёт вместе с памятью', () => {
    const e = teaching();
    const got = new Function('memory', `${RESIZABLE_CODE}\nreturn { length: view.length, same: memory.buffer === buffer };`)(
      e.memory,
    );
    expect(got).toEqual(RESIZABLE_EXPECT);
  });

  it('toResizableBuffer требует maximum; toFixedLengthBuffer отсоединяет растягиваемый; resize — только вверх и страницами', () => {
    expect(errorName(() => mem(new WebAssembly.Memory({ initial: 1 })).toResizableBuffer())).toBe('TypeError');

    const m = mem(new WebAssembly.Memory({ initial: 1, maximum: 4 }));
    const r = m.toResizableBuffer();
    expect(errorName(() => r.resize(65536 * 2 + 1))).toBe('RangeError');
    expect(errorName(() => r.resize(0))).toBe('RangeError');
    r.resize(65536 * 2);
    expect(m.buffer.byteLength).toBe(131072);
    m.toFixedLengthBuffer();
    expect(r.detached).toBe(true);
  });
});

describe('линейная память: страницы, потолок, рост изнутри', () => {
  it('потолок V8 — 65 536 страниц: initial 65537 даёт RangeError (так и сказано в PAGE_FACTS)', () => {
    expect(errorName(() => new WebAssembly.Memory({ initial: 65537 }))).toBe('RangeError');
    expect(PAGE_FACTS.join(' ')).toContain('65 536 страниц');
  });

  it('memory.grow изнутри за потолок не бросает, а возвращает -1; рост изнутри тоже отсоединяет буфер', () => {
    const { exports } = new WebAssembly.Instance(new WebAssembly.Module(u8(GROW_BYTES)));
    const e = exports as unknown as { grow: (n: number) => number; memory: WebAssembly.Memory };
    const old = e.memory.buffer;
    expect(e.grow(5)).toBe(-1);
    expect(old.byteLength, 'неудачный рост буфер не трогает').toBe(65536);
    expect(e.grow(1)).toBe(1);
    expect(buf(old).detached).toBe(true);
    expect(errorName(() => e.memory.grow(1)), 'а из JS тот же рост бросает').toBe('RangeError');
    expect(errorName(() => e.memory.grow(-1)), 'и уменьшить нельзя').toBe('TypeError');
  });

  it('ловушка не откатывает записанное: шесть букв подняты, report не вызван', () => {
    const reported: number[] = [];
    const e = teaching((n) => reported.push(n));
    new Uint8Array(e.memory.buffer).fill(97, 65530);
    expect(errorName(() => e.upper(65530, 100))).toBe('RuntimeError');
    expect(String.fromCharCode(...new Uint8Array(e.memory.buffer, 65530, 6))).toBe('AAAAAA');
    expect(reported).toEqual([]);
  });
});

describe('граница: таблица темы вычислена, а не набрана', () => {
  it('runBoundary в Node даёт ровно BOUNDARY_ROWS', async () => {
    const got = await runBoundary(BOUNDARY_BYTES);
    expect(got).toEqual(BOUNDARY_ROWS.map(({ call, got }) => ({ call, got })));
  });

  it('JS String Builtins: строка ссылкой, длина 6, импортов нет; без опции — TypeError', async () => {
    const withBuiltins = await WebAssembly.compile(u8(JS_STRING_BYTES), { builtins: ['js-string'] } as never);
    expect(WebAssembly.Module.imports(withBuiltins)).toEqual([]);
    const inst = await WebAssembly.instantiate(withBuiltins, {});
    expect((inst.exports as { len: (s: string) => number }).len('привет')).toBe(6);

    const plain = await WebAssembly.compile(u8(JS_STRING_BYTES));
    await expect(WebAssembly.instantiate(plain, {})).rejects.toThrow(TypeError);
  });

  it('SIMD: модуль с v128 валиден, а функцию с v128 в сигнатуре из JS не позвать', () => {
    expect(WebAssembly.validate(u8(SIMD_BYTES))).toBe(true);
    const { exports } = new WebAssembly.Instance(new WebAssembly.Module(u8(SIMD_EXPORT_BYTES)));
    expect(errorName(() => (exports as { v: () => unknown }).v())).toBe('TypeError');
  });
});

describe('общая память', () => {
  it('без maximum — TypeError; с ним буфер — SharedArrayBuffer', () => {
    expect(errorName(() => new WebAssembly.Memory({ initial: 1, shared: true } as WebAssembly.MemoryDescriptor))).toBe(
      'TypeError',
    );
    const m = new WebAssembly.Memory({ initial: 1, maximum: 2, shared: true });
    expect(Object.prototype.toString.call(m.buffer)).toBe('[object SharedArrayBuffer]');
  });

  it('рост общей памяти не отсоединяет старый буфер: он остаётся со старой длиной (цифры из SHARED_RULES)', () => {
    const m = new WebAssembly.Memory({ initial: 1, maximum: 2, shared: true });
    const old = m.buffer;
    m.grow(1);
    expect(old.byteLength).toBe(65536);
    expect(m.buffer.byteLength).toBe(131072);
    expect(m.buffer).not.toBe(old);
    expect(SHARED_RULES.join(' ')).toContain('65 536 после роста до 131 072');
  });

  it('проверка демо в Node: память создаётся и клонируется — изоляции здесь не требуют', () => {
    expect(probeShared()).toMatchObject({
      globalName: 'function',
      memory: 'создана',
      bufferTag: '[object SharedArrayBuffer]',
      clone: 'клонирована',
    });
  });

  it('в Node главный поток может ждать: таймаут 0 — 2, чужое значение — 1, будить некого — 0', () => {
    const memory = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });
    const { exports } = new WebAssembly.Instance(new WebAssembly.Module(u8(SHARED_BYTES)), { env: { mem: memory } });
    const e = exports as unknown as {
      wait: (addr: number, v: number, ns: bigint) => number;
      wake: (addr: number, count: number) => number;
    };
    expect(e.wait(64, 0, 0n)).toBe(2);
    expect(e.wait(64, 5, 0n)).toBe(1);
    expect(e.wake(64, 1)).toBe(0);
  });
});

describe('два worker_threads на одной памяти — код темы как есть', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wasm-threads-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  writeFileSync(join(dir, 'shared.wasm'), u8(SHARED_BYTES));
  writeFileSync(join(dir, 'worker.mjs'), THREADS_WORKER_CODE);
  writeFileSync(join(dir, 'main.mjs'), THREADS_MAIN_CODE);

  interface Race {
    total: number;
    woken: number;
    woke: number[];
  }
  let result: { atomic: Race; racy: Race } | null = null;
  const races = () => {
    result ??= JSON.parse(execFileSync(process.execPath, [join(dir, 'main.mjs')], { encoding: 'utf8', timeout: 60_000 }));
    return result!;
  };

  it('атомарный счётчик: ровно 2 × N', () => {
    expect(races().atomic.total).toBe(2 * THREADS_N);
  });

  it('неатомарный счётчик: не больше 2 × N (сколько потеряется — решает расписание)', () => {
    const { racy } = races();
    expect(racy.total).toBeGreaterThan(0);
    expect(racy.total).toBeLessThanOrEqual(2 * THREADS_N);
    for (const seen of RACY_OBSERVED) expect(seen).toBeLessThanOrEqual(2 * THREADS_N);
  });

  it('ворота: notify разбудил ровно тех, кто ответил 0; остальные ответили 1', () => {
    for (const race of [races().atomic, races().racy]) {
      expect(race.woke.every((w) => w === 0 || w === 1)).toBe(true);
      expect(race.woken).toBe(race.woke.filter((w) => w === 0).length);
    }
  });

  it('текст итогов называет ровно 2 000 000 и крайние наблюдённые значения racy', () => {
    const fmt = (n: number) => n.toLocaleString('ru-RU').replace(/\s/g, ' ');
    expect(THREADS_RESULT).toContain(fmt(2 * THREADS_N));
    expect(THREADS_RESULT).toContain(fmt(Math.min(...RACY_OBSERVED)));
    expect(THREADS_RESULT).toContain(fmt(Math.max(...RACY_OBSERVED)));
  });
});
