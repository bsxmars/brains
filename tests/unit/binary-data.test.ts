import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import * as t from '@/content/lessons/binary-data/data';
import { loadPng, loadRead, pngFields } from '@/widgets/bytes-lab/model/run';
import type { LensType } from '@/widgets/bytes-lab/model/types';

/**
 * Тема «Бинарные данные: ArrayBuffer, TypedArray, DataView, Blob».
 *
 * Примеры кода исполняются построчно, как напечатаны: строка `выражение; // → литерал`
 * сверяет значение выражения с литералом (типизированные массивы сравниваются как обычные),
 * `// ✗ Имя` — что строка бросает ошибку с этим именем. Текст ошибки не проверяется: он
 * у Node и Chromium разный, нормативно только имя.
 *
 * `READ_CODE` сверяется с настоящими типизированными массивами (порядок машины) и с
 * перевёрнутыми байтами (другой порядок). `PNG_CODE` — с `zlib.crc32` и `zlib.inflateSync`
 * Node на PNG от кодировщика Chromium (`PNG_BYTES`) и на трёх PNG из `node_modules` проекта:
 * размеры этих файлов сняты стендом через `createImageBitmap` Chromium 153.
 *
 * Стенд Chromium в тест не входит (см. шапку `data.ts`): здесь — то, что воспроизводит Node.
 */

const read = loadRead(t.READ_CODE);
const png = loadPng(t.PNG_CODE);
const PNG = Uint8Array.from(t.PNG_BYTES);

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...a: string[]) => (...a: unknown[]) => Promise<void>;

interface Check {
  line: string;
  kind: 'value' | 'throws';
  expected: string;
  got?: unknown;
  want?: unknown;
  error?: string;
}

const norm = (v: unknown) => (ArrayBuffer.isView(v) && !(v instanceof DataView) ? Array.from(v as Uint8Array) : v);

/** Исполнить пример построчно: значения после `// →`, имена ошибок после `// ✗`. */
async function runAnnotated(code: string): Promise<Check[]> {
  const checks: Check[] = [];
  const body = code
    .split('\n')
    .map((line) => {
      const value = line.match(/^(.*?);\s*\/\/ → (.+?)(?:\s+—\s.*)?$/);
      if (value) {
        checks.push({ line: value[1].trim(), kind: 'value', expected: value[2] });
        const i = checks.length - 1;
        return `__got[${i}] = (${value[1]}); __want[${i}] = (${value[2]});`;
      }
      const thrown = line.match(/^(.*?);\s*\/\/ ✗ (\w+)/);
      if (thrown) {
        checks.push({ line: thrown[1].trim(), kind: 'throws', expected: thrown[2] });
        const i = checks.length - 1;
        return `try { ${thrown[1]}; __err[${i}] = 'нет ошибки'; } catch (e) { __err[${i}] = e.name; }`;
      }
      return line;
    })
    .join('\n');
  const got: unknown[] = [];
  const want: unknown[] = [];
  const err: string[] = [];
  await new AsyncFunction('__got', '__want', '__err', '"use strict";\n' + body)(got, want, err);
  return checks.map((c, i) => ({ ...c, got: norm(got[i]), want: want[i], error: err[i] }));
}

function expectAll(checks: Check[]) {
  expect(checks.length).toBeGreaterThan(0);
  for (const c of checks) {
    if (c.kind === 'value') expect(c.got, c.line).toEqual(c.want);
    else expect(c.error, c.line).toBe(c.expected);
  }
}

describe('примеры кода исполняются, как напечатаны', () => {
  const blocks = {
    VIEWS_CODE: t.VIEWS_CODE,
    ALIGN_CODE: t.ALIGN_CODE,
    OVERFLOW_CODE: t.OVERFLOW_CODE,
    ENDIAN_CODE: t.ENDIAN_CODE,
    TEXT_CODE: t.TEXT_CODE,
    BTOA_CODE: t.BTOA_CODE,
    BLOB_CODE: t.BLOB_CODE,
    RESIZE_CODE: t.RESIZE_CODE,
    TRANSFER_CODE: t.TRANSFER_CODE,
  };
  for (const [name, code] of Object.entries(blocks)) {
    it(name, async () => expectAll(await runAnnotated(code)));
  }

  // В Node 24.11 (стенд) новых методов base64 нет — пример исполнится там, где они есть.
  it.runIf(typeof (Uint8Array as unknown as { fromBase64?: unknown }).fromBase64 === 'function')(
    'NATIVE_B64_CODE — где есть Uint8Array.fromBase64',
    async () => expectAll(await runAnnotated(t.NATIVE_B64_CODE)),
  );

  it('ответы NATIVE_B64_CODE совпадают с Buffer Node', () => {
    expect(Buffer.from('Привет').toString('base64')).toBe('0J/RgNC40LLQtdGC');
    expect(Array.from(Buffer.from('+/8=', 'base64'))).toEqual([0xfb, 0xff]);
    expect(Buffer.from([0xfb, 0xff]).toString('base64url')).toBe('-_8');
    expect(Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('hex')).toBe('89504e47');
  });

  it('VIEWS_CODE начинается с первых 16 байт файла темы', () => {
    const hex = [...t.VIEWS_CODE.matchAll(/0x([0-9a-f]{2}),/g)].slice(0, 16).map((m) => parseInt(m[1], 16));
    expect(hex).toEqual(t.PNG_BYTES.slice(0, 16));
  });
});

describe('стенд: машина little-endian, переполнение и выравнивание', () => {
  it('порядок машины — little-endian, как сказано в ENDIAN_FACTS', () => {
    expect(new Uint8Array(new Uint16Array([1]).buffer)[0]).toBe(1);
    expect(t.ENDIAN_FACTS[0].d).toContain('little-endian в Node и в Chromium');
  });

  it('`String.fromCharCode(...bytes)` на мегабайте переполняет стек, кусками по 0x8000 — нет', () => {
    expect(() => String.fromCharCode(...new Uint8Array(1 << 20))).toThrow(RangeError);
    expect(String.fromCharCode(...new Uint8Array(0x8000)).length).toBe(0x8000);
  });

  it('таблица типов: размер элемента совпадает с BYTES_PER_ELEMENT', () => {
    const g = globalThis as unknown as Record<string, { BYTES_PER_ELEMENT: number }>;
    for (const row of t.TYPE_ROWS) {
      for (const name of row.k.match(/`(\w+Array)`/g)!.map((s) => s.slice(1, -1))) {
        expect(g[name], name).toBeDefined();
        expect(String(g[name].BYTES_PER_ELEMENT), name).toBe(row.size);
      }
    }
  });
});

describe('B64_CODE: обе ветки совпадают с Buffer', () => {
  const { toBase64, fromBase64 } = new Function(`${t.B64_CODE}\nreturn { toBase64, fromBase64 };`)() as {
    toBase64(b: Uint8Array): string;
    fromBase64(s: string): Uint8Array;
  };
  const sizes = [0, 1, 2, 3, 255, 0x8000, 0x8001, 1 << 20];
  for (const n of sizes) {
    it(`${n} байт`, () => {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 131 + 7) & 0xff);
      // Ветка через btoa: метод экземпляра закрыт своим свойством.
      const legacy = Object.assign(new Uint8Array(bytes), { toBase64: undefined });
      const b64 = Buffer.from(bytes).toString('base64');
      expect(toBase64(legacy)).toBe(b64);
      expect(toBase64(bytes)).toBe(b64);
      expect(Array.from(fromBase64(b64))).toEqual(Array.from(bytes));
    });
  }
});

describe('READ_CODE: readAs против настоящих типизированных массивов', () => {
  const ctors: Record<LensType, new (b: ArrayBuffer) => ArrayLike<number>> = {
    Uint8: Uint8Array,
    Int16: Int16Array,
    Uint16: Uint16Array,
    Uint32: Uint32Array,
    Float32: Float32Array,
  };
  const samples = [
    ...t.LENS_PRESETS.filter((p) => p.bytes.length).map((p) => p.bytes),
    Array.from(new TextEncoder().encode('Привет')),
    Array.from({ length: 64 }, (_, i) => (i * 37 + 11) & 0xff),
  ];
  for (const type of Object.keys(ctors) as LensType[]) {
    it(type, () => {
      const size = read.TYPES[type].size;
      for (const s of samples) {
        const usable = s.slice(0, s.length - (s.length % size));
        const le = Array.from(new ctors[type](Uint8Array.from(usable).buffer));
        expect(read.readAs(Uint8Array.from(s), type, true)).toEqual(le);
        // Big-endian — те же числа из байтов, перевёрнутых внутри каждого элемента.
        const flipped = usable.map((_, i) => usable[i - (i % size) + (size - 1 - (i % size))]);
        expect(read.readAs(Uint8Array.from(s), type, false)).toEqual(Array.from(new ctors[type](Uint8Array.from(flipped).buffer)));
      }
    });
  }

  it('окно в середине буфера читается со своего смещения', () => {
    const window = PNG.subarray(16, 24);
    expect(read.readAs(window, 'Uint32', false)).toEqual([3, 2]);
    expect(read.readAs(window, 'Uint32', true)).toEqual([50331648, 33554432]);
  });

  it('подписи пресетов: ширина и высота, float', () => {
    expect(t.LENS_PRESETS[0].bytes).toEqual(t.PNG_BYTES.slice(16, 24));
    expect(read.readAs(Uint8Array.from(t.LENS_PRESETS[1].bytes), 'Float32', true)).toEqual([Math.fround(1.1), -2]);
    expect(Array.from(new Uint8Array(new Float32Array([1.1, -2]).buffer))).toEqual(t.LENS_PRESETS[1].bytes);
  });
});

describe('PNG_CODE: crc32 против zlib.crc32', () => {
  it('на случайных байтах и по частям', () => {
    for (const n of [0, 1, 4, 13, 1000, 65537]) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 7919 + n) & 0xff);
      expect(png.crc32(bytes)).toBe(zlib.crc32(bytes));
      const half = n >> 1;
      expect(png.crc32(bytes.subarray(half), png.crc32(bytes.subarray(0, half)))).toBe(
        zlib.crc32(bytes.subarray(half), zlib.crc32(bytes.subarray(0, half))),
      );
    }
    expect(png.crc32(new TextEncoder().encode('IEND'))).toBe(0xae426082);
  });
});

/** Распаковать пиксели: склеить все IDAT и разжать. Длина — высота × (1 + ширина × байт на пиксель). */
function inflate(chunks: { type: string; data: Uint8Array }[]) {
  return zlib.inflateSync(Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data)));
}
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

describe('PNG_CODE: parsePng на настоящих файлах', () => {
  it('PNG_BYTES от кодировщика Chromium: 3×2 RGBA, блоки как в PNG_CHUNKS', () => {
    const info = png.parsePng(PNG);
    expect([info.width, info.height, info.bitDepth, info.colorType, info.interlace]).toEqual([3, 2, 8, 6, 0]);
    expect(info.chunks.map(({ offset, length, type, crc }) => ({ offset, length, type, crc }))).toEqual(t.PNG_CHUNKS);
    for (const c of info.chunks) {
      expect(c.crcOk).toBe(true);
      expect(c.crc).toBe(zlib.crc32(PNG.subarray(c.offset + 4, c.offset + 8 + c.length)));
      expect(c.data.buffer, 'данные блока — окно, не копия').toBe(PNG.buffer);
    }
    expect(PNG.length).toBe(105);
    expect(info.chunks.filter((c) => c.type === 'IDAT').map((c) => c.length)).toEqual([30, 6]);
  });

  it('пиксели PNG_BYTES — те шесть цветов, что рисовал стенд', () => {
    const info = png.parsePng(PNG);
    const raw = inflate(info.chunks);
    const stride = 1 + info.width * 4;
    expect(raw.length).toBe(info.height * stride);
    // Фильтр 2 («Up»): байт = разница с байтом строки выше. Распаковываем только его.
    const rows: number[][] = [];
    for (let y = 0; y < info.height; y++) {
      expect(raw[y * stride]).toBe(2);
      const row = Array.from(raw.subarray(y * stride + 1, (y + 1) * stride));
      rows.push(row.map((b, i) => (b + (rows[y - 1]?.[i] ?? 0)) & 0xff));
    }
    const colors = rows.flatMap((r) => Array.from({ length: info.width }, (_, x) => '#' + r.slice(x * 4, x * 4 + 3).map((b) => b.toString(16).padStart(2, '0')).join('')));
    expect(colors).toEqual(t.PNG_PIXELS);
  });

  // Размеры сняты стендом: createImageBitmap в Chromium 153 на этих же файлах.
  const files = [
    { path: 'node_modules/istanbul-reports/lib/html/assets/favicon.png', w: 16, h: 16 },
    { path: 'node_modules/@jest/reporters/assets/jest_logo.png', w: 70, h: 70 },
    { path: 'node_modules/playwright-core/lib/server/chromium/appIcon.png', w: 400, h: 400 },
  ];
  for (const f of files) {
    it(f.path.split('/').slice(1, 2).join(), () => {
      const bytes = new Uint8Array(readFileSync(new URL(`../../${f.path}`, import.meta.url)));
      const info = png.parsePng(bytes);
      expect([info.width, info.height]).toEqual([f.w, f.h]);
      for (const c of info.chunks) {
        expect(c.crcOk, c.type).toBe(true);
        expect(c.crc).toBe(zlib.crc32(bytes.subarray(c.offset + 4, c.offset + 8 + c.length)));
      }
      expect(info.chunks.at(-1)?.type).toBe('IEND');
      expect(inflate(info.chunks).length).toBe(info.height * (1 + (info.width * CHANNELS[info.colorType] * info.bitDepth) / 8));
    });
  }

  it('порченые варианты демо: CRC не сходится, обрезанный — ошибка', () => {
    const variant = (id: string) => {
      const v = t.PNG_VARIANTS.find((x) => x.id === id)!;
      const b = Uint8Array.from(t.PNG_BYTES.slice(0, v.cut ?? t.PNG_BYTES.length));
      for (const [at, val] of v.patch) b[at] = val;
      return b;
    };
    const bad = png.parsePng(variant('width'));
    expect(bad.width).toBe(4);
    expect(bad.chunks.map((c) => c.crcOk)).toEqual([false, true, true, true]);
    expect(() => png.parsePng(variant('cut'))).toThrow('файл обрезан');
    expect(() => png.parsePng(Uint8Array.from([0x88, ...t.PNG_BYTES.slice(1)]))).toThrow('не PNG: байт 0');
    // Окно в середине чужого буфера: byteOffset учтён.
    const big = new Uint8Array(200);
    big.set(PNG, 50);
    expect(png.parsePng(big.subarray(50, 155)).width).toBe(3);
  });

  it('pngFields покрывает файл без дыр и наложений', () => {
    const fields = pngFields(png.parsePng(PNG), PNG.length);
    expect(fields[0].start).toBe(0);
    expect(fields.at(-1)!.end).toBe(PNG.length);
    for (let i = 1; i < fields.length; i++) expect(fields[i].start).toBe(fields[i - 1].end);
    expect(fields.find((f) => f.name === 'ширина')).toMatchObject({ start: 16, end: 20 });
  });
});

describe('FILE_SIZE_CODE и COLLECT_CODE', () => {
  const { pngSize } = new Function(`${t.FILE_SIZE_CODE}\nreturn { pngSize };`)() as { pngSize(f: Blob): Promise<{ width: number; height: number }> };
  const { collect } = new Function(`${t.COLLECT_CODE}\nreturn { collect };`)() as {
    collect(s: ReadableStream<Uint8Array>, max?: number): Promise<Uint8Array>;
  };

  it('pngSize читает размер из первых 24 байт File', async () => {
    const file = new File([PNG], 'canvas.png', { type: 'image/png' });
    expect(await pngSize(file)).toEqual({ width: 3, height: 2 });
    const icon = readFileSync(new URL('../../node_modules/playwright-core/lib/server/chromium/appIcon.png', import.meta.url));
    expect(await pngSize(new Blob([icon]))).toEqual({ width: 400, height: 400 });
    await expect(pngSize(new Blob(['GIF89a……………………………']))).rejects.toThrow('не PNG');
  });

  it('collect собирает поток блоба в растущий буфер и упирается в потолок', async () => {
    const parts = [PNG.subarray(0, 10), PNG.subarray(10, 60), PNG.subarray(60)];
    const got = await collect(new Blob(parts).stream());
    expect(Array.from(got)).toEqual(t.PNG_BYTES);
    expect((got.buffer as ArrayBuffer).resizable).toBe(true);
    await expect(collect(new Blob([PNG]).stream(), 50)).rejects.toThrow(RangeError);
  });
});

describe('утверждения текста закрыты проверками', () => {
  it('File.slice возвращает Blob без имени', () => {
    const f = new File(['abc'], 'a.txt');
    expect(f).toBeInstanceOf(Blob);
    expect(f.slice(0, 1)).not.toBeInstanceOf(File);
  });

  it('blob.stream() в Node отдаёт первым куском 12 байт из 13', async () => {
    const r = new Blob(['Привет', new Uint8Array([33])]).stream().getReader();
    expect((await r.read()).value!.length).toBe(12);
    expect(t.PITFALLS.find((p) => p.n === '06')!.d).toContain('в Node первым куском в 12 байт');
  });

  it('transfer сохраняет растущесть, transferToFixedLength — нет', () => {
    expect(new ArrayBuffer(4, { maxByteLength: 8 }).transfer().resizable).toBe(true);
    expect(new ArrayBuffer(4, { maxByteLength: 8 }).transferToFixedLength().resizable).toBe(false);
  });

  it('Uint8Array: 250 + 10 даёт 4, а Uint8ClampedArray — 255', () => {
    expect(Uint8Array.of(250 + 10)[0]).toBe(4);
    expect(Uint8ClampedArray.of(250 + 10)[0]).toBe(255);
  });

  it('TextDecoder windows-1251 читает кириллицу', () => {
    expect(new TextDecoder('windows-1251').decode(Uint8Array.of(0xcf, 0xf0, 0xe8))).toBe('При');
  });

  it('IHDR_ROWS совпадает с разбором', () => {
    const info = png.parsePng(PNG);
    const head = info.chunks[0].data;
    const vals = [info.width, info.height, info.bitDepth, info.colorType, head[10], head[11], info.interlace];
    expect(t.IHDR_ROWS.map((r) => Number(r.v.match(/`(\d+)`/)![1]))).toEqual(vals);
  });

  it('CHUNK_FACTS: 36 байт сжатых пикселей — 30 и 6', () => {
    const idat = png.parsePng(PNG).chunks.filter((c) => c.type === 'IDAT');
    expect(idat.reduce((s, c) => s + c.length, 0)).toBe(36);
  });
});

describe('таблица видов и отсоединённый буфер', () => {
  it('видов двенадцать, как сказано в TYPES_NOTE', () => {
    const names = t.TYPE_ROWS.flatMap((r) => r.k.match(/`(\w+Array)`/g)!);
    expect(names.length).toBe(12);
    expect(t.TYPES_NOTE).toContain('двенадцать');
  });

  it('диапазоны Float16: 65 504 — предел, дальше бесконечность', () => {
    const F16 = (globalThis as unknown as { Float16Array: { of(...n: number[]): ArrayLike<number> } }).Float16Array;
    expect(F16.of(65504)[0]).toBe(65504);
    expect(F16.of(65520)[0]).toBe(Infinity);
    expect(t.TYPE_ROWS.find((r) => r.k.includes('Float16'))!.range).toContain('65 504');
  });

  it('на отсоединённом буфере молчат индексы, а методы бросают TypeError', () => {
    const buf = new ArrayBuffer(8);
    const v = new Uint8Array(buf);
    buf.transfer();
    v[0] = 5;
    expect(v[0]).toBeUndefined();
    expect(v.length).toBe(0);
    for (const f of [() => v.set([1]), () => v.fill(1), () => v.at(0), () => v.slice(), () => v.subarray(0, 1), () => Array.from(v)]) {
      expect(f).toThrow(TypeError);
    }
  });
});
