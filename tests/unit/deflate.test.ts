import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import zlib from 'node:zlib';
import * as fflate from 'fflate';
import { describe, expect, it } from 'vitest';
import * as t from '@/content/algorithms/deflate/data';
import { describeReads, gzipText, loadDeflate } from '@/widgets/deflate-lab/model/run';
import type { ReadEvent, Token } from '@/widgets/deflate-lab/model/types';

/**
 * Тема «Что внутри gzip: LZ77 и коды Хаффмана».
 *
 * Код темы — строки `LZ77_CODE`, `HUFFMAN_CODE`, `INFLATE_CODE`, `WRAP_CODE`, `BITS_CODE`:
 * напечатаны на странице и исполняются демо. Здесь учебный `inflateRaw` распаковывает вывод
 * настоящих zlib, fflate и pako на всех уровнях байт в байт; длины кодов `huffmanLengths`
 * сверяются с теми, что zlib записал в свои dynamic-блоки; `lz77` проверяется на свойствах.
 * Числа из текста (размеры, биты заголовка, таблица уровней) пересчитываются здесь же:
 * сменится zlib — покраснеет тест, а не останется неправдой на странице.
 */

/** pako 1.0 приходит без типов — берём единственную функцию, которая нужна тесту. */
const pako = createRequire(import.meta.url)('pako') as { deflateRaw(data: Uint8Array, opts: { level: number }): Uint8Array };

const api = loadDeflate(t.LAB_CODES);
const enc = new TextEncoder();
const root = new URL('../../', import.meta.url);
const file = (p: string) => new Uint8Array(readFileSync(new URL(p, root)));
const same = (a: Uint8Array, b: Uint8Array) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

/** xorshift32 — повторяемые «случайные» байты. */
function xorshift(seed: number) {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x;
  };
}
function randomBytes(n: number, seed: number) {
  const r = xorshift(seed);
  return Uint8Array.from({ length: n }, () => r() & 255);
}

/** Все чтения распаковщика. */
function reads(raw: Uint8Array): ReadEvent[] {
  const ev: ReadEvent[] = [];
  api.inflateRaw(raw, (what, value, from, to) => ev.push({ what, value, from, to }));
  return ev;
}

/** Блоки потока: тип, токены, которые выбрал компрессор, и сколько бит заняли данные блока. */
function blocks(ev: ReadEvent[]) {
  const out: { type: number; tokens: Token[]; dataBits: number; lengths: number[] }[] = [];
  let cur: (typeof out)[number] | null = null;
  let pending: { len: number; d: number } = { len: 0, d: 0 };
  let lastSym = 0;
  for (const e of ev) {
    if (e.what === 'BTYPE') {
      cur = { type: e.value, tokens: [], dataBits: 0, lengths: [] };
      out.push(cur);
      continue;
    }
    if (!cur) continue;
    if (e.what === 'LENSYM') {
      lastSym = e.value;
      if (e.value < 16) cur.lengths.push(e.value);
    }
    if (e.what === 'REP') {
      const prev = cur.lengths[cur.lengths.length - 1];
      const nrep = e.value + (lastSym === 18 ? 11 : 3);
      cur.lengths.push(...new Array(nrep).fill(lastSym === 16 ? prev : 0));
    }
    if (['SYM', 'LENX', 'DIST', 'DISTX'].includes(e.what)) cur.dataBits += e.to - e.from;
    if (e.what === 'SYM' && e.value < 256) cur.tokens.push({ lit: e.value });
    if (e.what === 'SYM' && e.value > 256) pending = { len: api.LEN_BASE[e.value - 257], d: 0 };
    if (e.what === 'LENX') pending.len += e.value;
    if (e.what === 'DIST') pending.d = e.value;
    if (e.what === 'DISTX') cur.tokens.push({ len: pending.len, dist: api.DIST_BASE[pending.d] + e.value });
  }
  return out;
}

const tokenString = (text: string, tokens: Token[]) => {
  let i = 0;
  return tokens
    .map((tk) => {
      if ('lit' in tk) {
        i++;
        return text[i - 1] === ' ' ? '␠' : text[i - 1];
      }
      i += tk.len;
      return `(${tk.dist}, ${tk.len})`;
    })
    .join(' ');
};

const VUE = file('node_modules/vue/dist/vue.global.prod.js');
const VUE_SHA = createHash('sha256').update(VUE).digest('hex').slice(0, 16);

const CORPUS: Record<string, Uint8Array> = {
  'compression/data.ts': file('src/content/platform/compression/data.ts'),
  'diff/index.mdx': file('src/content/algorithms/diff/index.mdx'),
  'deflate/data.ts': file('src/content/algorithms/deflate/data.ts'),
  'onig.wasm (200 КБ)': file('node_modules/shiki/dist/onig.wasm').subarray(0, 200_000),
  'случайные, зерно 42': randomBytes(100_000, 42),
  пусто: new Uint8Array(0),
  'один байт': Uint8Array.of(65),
  'сто тысяч a': new Uint8Array(100_000).fill(97),
  '70 000 нулей': new Uint8Array(70_000),
  'лесенка 0..255': Uint8Array.from({ length: 66_000 }, (_, i) => i & 255),
};

describe('учебный inflateRaw распаковывает настоящие компрессоры байт в байт', () => {
  const S = zlib.constants;
  for (const [name, data] of Object.entries(CORPUS)) {
    it(name, () => {
      for (let level = 0; level <= 9; level++) {
        const streams: [string, Uint8Array][] = [
          ['zlib', zlib.deflateRawSync(data, { level })],
          ['fflate', fflate.deflateSync(data, { level: level as 0 })],
          ['pako', pako.deflateRaw(data, { level })],
          ['zlib Z_FIXED', zlib.deflateRawSync(data, { level, strategy: S.Z_FIXED })],
          ['zlib Z_HUFFMAN_ONLY', zlib.deflateRawSync(data, { level, strategy: S.Z_HUFFMAN_ONLY })],
          ['zlib Z_RLE', zlib.deflateRawSync(data, { level, strategy: S.Z_RLE })],
        ];
        for (const [who, raw] of streams) {
          const out = api.inflateRaw(raw);
          expect(same(out.data, data), `${who}, уровень ${level}`).toBe(true);
          // Поток прочитан ровно до конца — хвост обёртки начнётся с правильного байта.
          expect(Math.ceil(out.bitLength / 8), `${who}, уровень ${level}`).toBe(raw.length);
        }
      }
    }, 60_000);
  }

  it('битый поток — ошибка, а не мусор', () => {
    expect(() => api.inflateRaw(Uint8Array.of(0b111))).toThrow('BTYPE 3');
    expect(() => api.inflateRaw(Uint8Array.of(1, 5, 0, 5, 0))).toThrow('LEN и NLEN');
    const raw = zlib.deflateRawSync(t.HTML_SAMPLE);
    expect(() => api.inflateRaw(raw.subarray(0, raw.length - 3))).toThrow('поток кончился');
  });
});

describe('обёртки gzip и zlib', () => {
  it('gunzip и unzlib на всём корпусе; CRC — тем же zlib.crc32, Adler-32 проверяет сам unzlib', () => {
    for (const data of Object.values(CORPUS)) {
      const g = api.gunzip(new Uint8Array(zlib.gzipSync(data)));
      expect(same(g.data, data)).toBe(true);
      expect(g.crc).toBe(zlib.crc32(data));
      const z = api.unzlib(new Uint8Array(zlib.deflateSync(data)));
      expect(same(z.data, data)).toBe(true);
      expect(z.window).toBe(32768);
    }
  }, 60_000);

  it('имя файла и время из заголовка fflate', () => {
    const data = enc.encode(t.HTML_SAMPLE);
    const g = api.gunzip(fflate.gzipSync(data, { filename: 'menu.html', mtime: 1_700_000_000_000 }));
    expect(g.name).toBe('menu.html');
    expect(g.mtime).toBe(1_700_000_000);
    expect(g.flags & 8).toBe(8);
    expect(same(g.data, data)).toBe(true);
  });

  it('испорченный ISIZE — ошибка; испорченный Adler-32 — ошибка', () => {
    const gz = new Uint8Array(zlib.gzipSync(t.HTML_SAMPLE));
    gz[gz.length - 1] ^= 1;
    expect(() => api.gunzip(gz)).toThrow('ISIZE');
    const zl = new Uint8Array(zlib.deflateSync(t.HTML_SAMPLE));
    zl[zl.length - 1] ^= 1;
    expect(() => api.unzlib(zl)).toThrow('Adler-32');
  });

  it('размеры обёрток на HTML_SAMPLE: 134 / 140 / 152, хвост gzip — 18 байт обвязки', () => {
    expect(enc.encode(t.HTML_SAMPLE).length).toBe(t.HTML_SIZES.raw);
    expect(zlib.deflateRawSync(t.HTML_SAMPLE).length).toBe(t.HTML_SIZES.deflate);
    expect(zlib.deflateSync(t.HTML_SAMPLE).length).toBe(t.HTML_SIZES.zlib);
    expect(zlib.gzipSync(t.HTML_SAMPLE).length).toBe(t.HTML_SIZES.gzip);
    expect(t.WRAP_ROWS.map((r) => r.size)).toEqual([134, 140, 152]);
  });

  it('заголовок gzip — как в таблице; байт ОС — 3 или 19 смотря где собран zlib; XFL по уровню', () => {
    const gz = zlib.gzipSync(t.HTML_SAMPLE);
    expect([...gz.subarray(0, 9)]).toEqual([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0]);
    expect([3, 19]).toContain(gz[9]);
    expect(zlib.gzipSync('x', { level: 1 })[8]).toBe(4);
    expect(zlib.gzipSync('x', { level: 9 })[8]).toBe(2);
    expect(t.GZIP_HEADER_ROWS.find((r) => r.k === '`OS`')?.v).toBe('`13`');
  });

  it('CompressionStream в Node — байт в байт zlib уровня 6', async () => {
    const cs = await gzipText(t.HTML_SAMPLE);
    expect(same(cs, new Uint8Array(zlib.gzipSync(t.HTML_SAMPLE)))).toBe(true);
  });

  it('два gzip-члена: Node склеивает, учебный gunzip читает первый; плохая CRC в Node — Z_DATA_ERROR', () => {
    const two = Buffer.concat([zlib.gzipSync('первый '), zlib.gzipSync('второй')]);
    expect(zlib.gunzipSync(two).toString()).toBe('первый второй');
    expect(new TextDecoder().decode(api.gunzip(new Uint8Array(two)).data)).toBe('первый ');
    const bad = zlib.gzipSync(t.HTML_SAMPLE);
    bad[bad.length - 6] ^= 1;
    expect(() => zlib.gunzipSync(bad)).toThrow(expect.objectContaining({ code: 'Z_DATA_ERROR' }));
  });
});

describe('LZ77: свойства учебного разбора', () => {
  const options = [{ chain: 4, nice: 8, lazy: 0 }, {}, { chain: 4096, nice: 258, lazy: 258 }];

  it('токены собираются обратно в исходник; пределы окна и длины соблюдены', () => {
    for (const [name, data] of Object.entries(CORPUS)) {
      for (const opt of options) {
        const tokens = api.lz77(data, opt);
        expect(same(api.unlz77(tokens), data), name).toBe(true);
        let at = 0;
        for (const tk of tokens) {
          if ('lit' in tk) {
            at++;
            continue;
          }
          expect(tk.len).toBeGreaterThanOrEqual(api.MIN_MATCH);
          expect(tk.len).toBeLessThanOrEqual(api.MAX_MATCH);
          expect(tk.dist).toBeGreaterThanOrEqual(1);
          expect(tk.dist).toBeLessThanOrEqual(Math.min(api.WINDOW, at));
          at += tk.len;
        }
      }
    }
  }, 60_000);

  it('blah blah…: пять литералов, (5, 14) с перекрытием, «!»', () => {
    const tokens = api.lz77(enc.encode(t.BLAH_TEXT));
    expect(tokenString(t.BLAH_TEXT, tokens)).toBe('b l a h ␠ (5, 14) !');
    expect(t.BLAH_TOKENS.map((r) => r.k).join(' ')).toBe('`b` `l` `a` `h` `␠` `(5, 14)` `!`');
  });

  it('тысяча a: литерал и четыре пары с расстоянием 1', () => {
    const tokens = api.lz77(new Uint8Array(1000).fill(97));
    expect(tokens).toEqual([{ lit: 97 }, { len: 258, dist: 1 }, { len: 258, dist: 1 }, { len: 258, dist: 1 }, { len: 225, dist: 1 }]);
  });

  it('zlib не ссылается на байт 0: blah — шесть литералов и (5, 13); тысяча a — два литерала и четыре пары', () => {
    const blah = blocks(reads(zlib.deflateRawSync(t.BLAH_TEXT)))[0].tokens;
    expect(tokenString(t.BLAH_TEXT, blah)).toBe('b l a h ␠ b (5, 13) !');
    const aaa = blocks(reads(zlib.deflateRawSync(Buffer.alloc(1000, 97))))[0].tokens;
    expect(aaa.filter((tk) => 'lit' in tk)).toHaveLength(2);
    expect(aaa.filter((tk) => 'len' in tk)).toHaveLength(4);
    expect(zlib.deflateRawSync(Buffer.alloc(1000, 97)).length).toBe(11);
    // Исходник zlib (через порт pako): позиция 0 — это NIL, «цепочка пуста».
    expect(readFileSync(new URL('node_modules/pako/lib/zlib/deflate.js', root), 'utf8')).toContain('hash_head !== 0/*NIL*/');
  });

  it('жадно и лениво — как в таблице', () => {
    const data = enc.encode(t.LAZY_TEXT);
    const greedy = tokenString(t.LAZY_TEXT, api.lz77(data, { lazy: 0 }));
    const lazy = tokenString(t.LAZY_TEXT, api.lz77(data, { lazy: 16 }));
    expect(greedy).toBe('a b c ␠ b c d e ␠ (9, 3) d e');
    expect(lazy).toBe('a b c ␠ b c d e ␠ a (6, 4)');
    expect(t.LAZY_ROWS[0].count).toBe(`${api.lz77(data, { lazy: 0 }).length} токенов`);
    expect(t.LAZY_ROWS[1].count).toBe(`${api.lz77(data, { lazy: 16 }).length} токенов`);
  });

  it('повтор дальше окна не находится; размеры WINDOW_ROWS', () => {
    const r = xorshift(1);
    const block = Uint8Array.from({ length: 4096 }, () => r() & 255);
    for (const row of t.WINDOW_ROWS) {
      const gap = Uint8Array.from({ length: row.gap }, () => r() & 255);
      const data = Buffer.concat([block, gap, block]);
      expect(row.distance).toBe(4096 + row.gap);
      expect(data.length).toBe(row.raw);
      expect(zlib.deflateRawSync(data, { level: 9 }).length).toBe(row.zlib);
      expect(zlib.brotliCompressSync(data).length).toBe(row.br);
      expect(zlib.zstdCompressSync(data).length).toBe(row.zstd);
      const long = api.lz77(data).filter((tk) => 'len' in tk && tk.len > 100);
      if (row.distance <= api.WINDOW) expect(long.length).toBeGreaterThan(0);
      else expect(long).toEqual([]);
    }
  });
});

describe('уровни zlib', () => {
  const src = readFileSync(new URL('node_modules/pako/lib/zlib/deflate.js', root), 'utf8');

  it('ZLIB_CONFIG — configuration_table из исходника (порт pako), там же TOO_FAR = 4096', () => {
    const rows = [...src.matchAll(/new Config\((\d+), (\d+), (\d+), (\d+), deflate_(\w+)\)/g)].map((m, level) => ({
      level,
      good: +m[1],
      lazy: +m[2],
      nice: +m[3],
      chain: +m[4],
      func: m[5],
    }));
    expect(rows).toEqual(t.ZLIB_CONFIG);
    expect(src).toContain('4096/*TOO_FAR*/');
  });

  it('размеры по уровням на vue.global.prod.js — zlib и учебный lz77 с теми же параметрами', () => {
    expect(VUE.length).toBe(t.LEVEL_FILE.size);
    expect(VUE_SHA).toBe(t.LEVEL_FILE.sha);
    for (const c of t.ZLIB_CONFIG.filter((x) => x.level > 0)) {
      expect(zlib.deflateRawSync(VUE, { level: c.level }).length, `zlib ${c.level}`).toBe(t.LEVEL_SIZES[c.level].zlib);
      const tokens = api.lz77(VUE, { chain: c.chain, nice: c.nice, lazy: c.func === 'fast' ? 0 : c.lazy });
      expect(Math.ceil(api.blockBits(tokens).bits / 8), `учебный ${c.level}`).toBe(t.LEVEL_SIZES[c.level].ours);
    }
    expect(t.LEVEL_NOTE).toContain(`похудел на ${t.LEVEL_SIZES[6].zlib - t.LEVEL_SIZES[9].zlib} байт`);
  }, 60_000);

  it('средняя цена литерала и пары на Vue — PAIR_COST', () => {
    const tokens = api.lz77(VUE);
    const st = api.blockBits(tokens);
    let lit = 0, nl = 0, pair = 0, np = 0, p3 = 0, n3 = 0;
    for (const tk of tokens) {
      if ('lit' in tk) {
        lit += st.litL[tk.lit];
        nl++;
        continue;
      }
      const [l] = api.symbolOf(tk.len, api.LEN_BASE);
      const [d] = api.symbolOf(tk.dist, api.DIST_BASE);
      const cost = st.litL[257 + l] + api.LEN_EXTRA[l] + st.distL[d] + api.DIST_EXTRA[d];
      pair += cost;
      np++;
      if (tk.len === 3) {
        p3 += cost;
        n3++;
      }
    }
    const f = (x: number) => x.toFixed(1).replace('.', ',');
    expect({ lit: f(lit / nl), pair: f(pair / np), pair3: f(p3 / n3) }).toEqual(t.PAIR_COST);
    expect(2 * (lit / nl)).toBeLessThan(p3 / n3);
  });

  it('типы блоков: abracadabra — fixed в 13 байт, Vue — три dynamic, случайные 64 КБ — четыре stored', () => {
    const abra = zlib.deflateRawSync(t.ABRA_TEXT);
    expect(abra.length).toBe(13);
    expect(blocks(reads(abra)).map((b) => b.type)).toEqual([1]);
    expect(blocks(reads(zlib.deflateRawSync(VUE, { level: 9 }))).map((b) => b.type)).toEqual([2, 2, 2]);
    const rnd = blocks(reads(zlib.deflateRawSync(randomBytes(65536, 42), { level: 9 })));
    expect(rnd.filter((b) => b.type === 0)).toHaveLength(4);
    expect(t.BLOCK_NOTE).toContain('четыре stored-блока');
  });
});

describe('Хаффман и канонический код', () => {
  it('abracadabra: склейки 2, 4, 6, 11; длины и коды как в таблице; 23 бита', () => {
    const freqs = new Array(256).fill(0);
    for (const b of enc.encode(t.ABRA_TEXT)) freqs[b]++;
    // Те же склейки, что делает huffmanLengths: веса новых узлов по порядку.
    const w = freqs.filter((f) => f > 0);
    const merged: number[] = [];
    while (w.length > 1) {
      w.sort((a, b) => a - b);
      const [a, b] = w.splice(0, 2);
      merged.push(a + b);
      w.push(a + b);
    }
    expect(merged).toEqual([2, 4, 6, 11]);
    expect(t.ABRA_STEPS.slice(1).map((s) => Number(/→ (?:узел )?(\d+)/.exec(s.d)?.[1]))).toEqual(merged);

    const lengths = api.huffmanLengths(freqs);
    const codes = api.canonicalCodes(lengths);
    for (const row of t.ABRA_ROWS) {
      const s = row.sym.replaceAll('`', '').charCodeAt(0);
      expect(freqs[s]).toBe(row.freq);
      expect(lengths[s]).toBe(row.len);
      expect('`' + codes[s].toString(2).padStart(lengths[s], '0') + '`').toBe(row.code);
    }
    expect(freqs.reduce((sum, f, s) => sum + f * lengths[s], 0)).toBe(t.ABRA_BITS);
  });

  it('пример RFC 1951 (3.2.2): длины 3,3,3,3,3,2,4,4 → 010 011 100 101 110 00 1110 1111', () => {
    const lengths = [3, 3, 3, 3, 3, 2, 4, 4];
    const codes = api.canonicalCodes(lengths).map((c, i) => c.toString(2).padStart(lengths[i], '0'));
    expect(codes).toEqual(['010', '011', '100', '101', '110', '00', '1110', '1111']);
  });

  it('fixed-коды RFC 1951 (3.2.6) — канонический код по длинам; FIXED_ROWS', () => {
    const lengths = [...new Array(144).fill(8), ...new Array(112).fill(9), ...new Array(24).fill(7), ...new Array(8).fill(8)];
    const codes = api.canonicalCodes(lengths);
    const bin = (s: number) => '`' + codes[s].toString(2).padStart(lengths[s], '0') + '`';
    const ranges = [[0, 143], [144, 255], [256, 279], [280, 287]];
    t.FIXED_ROWS.forEach((row, i) => {
      const [a, b] = ranges[i];
      expect(row.range).toBe(`${a}–${b}`);
      expect(row.len).toBe(lengths[a]);
      expect(row.from).toBe(bin(a));
      expect(row.to).toBe(bin(b));
    });
  });

  it('лесенка Фибоначчи: дерево глубиной 17 → 15 бит, +4 бита, длины те же, что у zlib', () => {
    const freqs = new Array(286).fill(0);
    t.FIB_FREQS.forEach((f, i) => (freqs[65 + i] = f));
    freqs[256] = 1;
    const free = api.huffmanLengths(freqs, 99);
    const limited = api.huffmanLengths(freqs);
    const cost = (l: number[]) => freqs.reduce((s, f, i) => s + f * l[i], 0);
    expect(Math.max(...free)).toBe(t.FIB_RESULT.depth);
    expect(Math.max(...limited)).toBe(t.FIB_RESULT.limited);
    expect(cost(free)).toBe(t.FIB_RESULT.costFree);
    expect(cost(limited)).toBe(t.FIB_RESULT.costLimited);
    // Код полный: сумма долей ровно 2^15.
    expect(limited.reduce((s, l) => s + (l ? 2 ** (15 - l) : 0), 0)).toBe(2 ** 15);

    // Те же байты в перемешанном порядке — zlib без LZ77 записывает частоты как есть.
    const bytes: number[] = [];
    t.FIB_FREQS.forEach((f, i) => bytes.push(...new Array(f).fill(65 + i)));
    const r = xorshift(7);
    for (let i = bytes.length - 1; i > 0; i--) {
      const j = r() % (i + 1);
      [bytes[i], bytes[j]] = [bytes[j], bytes[i]];
    }
    const raw = zlib.deflateRawSync(Uint8Array.from(bytes), { strategy: zlib.constants.Z_HUFFMAN_ONLY });
    const [blk] = blocks(reads(raw));
    expect(blk.type).toBe(2);
    const hlit = reads(raw).find((e) => e.what === 'HLIT')!.value + 257;
    const zl = blk.lengths.slice(0, hlit);
    expect(zl).toEqual(limited.slice(0, hlit));
  });

  it('длины huffmanLengths оптимальны, как у zlib: blockBits на токенах zlib = бит данных в блоке', () => {
    for (const data of [enc.encode(t.HTML_SAMPLE), CORPUS['compression/data.ts'], CORPUS['diff/index.mdx'], VUE]) {
      for (const level of [1, 6, 9]) {
        for (const b of blocks(reads(zlib.deflateRawSync(data, { level })))) {
          if (b.type !== 2) continue;
          expect(api.blockBits(b.tokens).bits).toBe(b.dataBits);
        }
      }
    }
    expect(t.BITS_NOTE).toContain(`ровно ${t.HTML_SIZES.dataBits} бит`);
  }, 60_000);

  it('код любого набора частот полный и не длиннее 15 бит', () => {
    const r = xorshift(3);
    for (let k = 0; k < 200; k++) {
      const n = 2 + (r() % 285);
      const freqs = Array.from({ length: n }, () => (r() % 4 === 0 ? 0 : 1 + (r() % (k % 2 ? 50 : 100_000))));
      if (freqs.filter((f) => f > 0).length < 2) continue;
      const l = api.huffmanLengths(freqs);
      expect(Math.max(...l)).toBeLessThanOrEqual(15);
      expect(l.reduce((s, x) => s + (x ? 2 ** (15 - x) : 0), 0)).toBe(2 ** 15);
      freqs.forEach((f, i) => expect(f > 0).toBe(l[i] > 0));
    }
  });
});

describe('заголовок dynamic-блока на HTML_SAMPLE', () => {
  const raw = new Uint8Array(zlib.deflateRawSync(t.HTML_SAMPLE));
  const ev = reads(raw);
  const bitsOf = (e: ReadEvent) => {
    let s = '';
    for (let p = e.from; p < e.to; p++) s += (raw[p >> 3] >> (p & 7)) & 1;
    return s;
  };

  it('поля и биты — как в HEADER_ROWS', () => {
    const head = ev.slice(0, 5);
    expect(head.map((e) => e.what)).toEqual(['BFINAL', 'BTYPE', 'HLIT', 'HDIST', 'HCLEN']);
    head.forEach((e, i) => {
      expect(t.HEADER_ROWS[i].bits).toBe('`' + bitsOf(e) + '`');
      expect(t.HEADER_ROWS[i].value).toBe(String(e.value));
    });
    const cl = ev.filter((e) => e.what.startsWith('CL'));
    expect(cl).toHaveLength(ev[4].value + 4);
    expect(t.HEADER_ROWS[5].bits).toBe('`' + cl.slice(0, 4).map(bitsOf).join(' ') + ' …`');
    expect(t.HEADER_ROWS[5].value).toBe(cl.slice(0, 4).map((e) => e.value).join(', ') + ', …');
    expect(cl.map((e) => Number(e.what.slice(2)))).toEqual(api.ORDER.slice(0, cl.length));
  });

  it('бит на заголовок, таблицу и данные; символов алфавита длин; итог', () => {
    const firstLen = ev.find((e) => e.what === 'LENSYM')!;
    const firstSym = ev.find((e) => e.what === 'SYM')!;
    const [blk] = blocks(ev);
    const syms = ev.filter((e) => e.what === 'SYM');
    expect(firstLen.from).toBe(t.HTML_SIZES.headerBits);
    expect(firstSym.from - firstLen.from).toBe(t.HTML_SIZES.tableBits);
    expect(blk.dataBits).toBe(t.HTML_SIZES.dataBits);
    expect(ev[ev.length - 1].to).toBe(t.HTML_SIZES.totalBits);
    expect(ev.filter((e) => e.what === 'LENSYM')).toHaveLength(t.HTML_SIZES.lenSyms);
    expect(blk.lengths).toHaveLength(ev[2].value + 257 + ev[3].value + 1);
    expect(t.HEADER_ROWS[6]).toMatchObject({ bits: `${t.HTML_SIZES.tableBits} бит`, value: `${t.HTML_SIZES.lenSyms} символов` });
    expect(syms).toHaveLength(124);
    expect(syms.filter((e) => e.value < 256)).toHaveLength(117);
    expect(syms.filter((e) => e.value > 256)).toHaveLength(6);
    // Самое дальнее расстояние в блоке — в пределах кода 12.
    expect(Math.max(...blk.tokens.map((tk) => ('dist' in tk ? tk.dist : 0)))).toBeLessThanOrEqual(96);
  });

  it('describeReads демо разбирает тот же поток без сбоев', async () => {
    const gz = await gzipText(t.HTML_SAMPLE);
    const events: ReadEvent[] = [];
    const g = api.gunzip(gz, (what, value, from, to) => events.push({ what, value, from, to }));
    const rows = describeReads(events, gz.subarray(g.at), api);
    expect(rows[2].meaning).toContain('275');
    expect(rows.filter((r) => r.kind === 'data').length).toBeGreaterThan(100);
    expect(rows.every((r) => r.meaning !== '')).toBe(true);
  });
});

describe('предел сжатия', () => {
  const H0 = (d: Uint8Array) => {
    const c = new Array(256).fill(0);
    for (const b of d) c[b]++;
    return c.reduce((h, x) => (x ? h - (x / d.length) * Math.log2(x / d.length) : h), 0);
  };
  const gz = new Uint8Array(zlib.gzipSync(VUE, { level: 9 }));
  const sets = [VUE, randomBytes(65536, 42), gz];

  it('ENTROPY_ROWS', () => {
    t.ENTROPY_ROWS.forEach((row, i) => {
      const d = sets[i];
      expect(d.length).toBe(row.size);
      expect(Number(H0(d).toFixed(3))).toBe(row.h0);
      expect(Math.ceil((H0(d) * d.length) / 8)).toBe(row.bound);
      expect(zlib.deflateRawSync(d, { strategy: zlib.constants.Z_HUFFMAN_ONLY }).length).toBe(row.huff);
      expect(zlib.deflateRawSync(d, { level: 9 }).length).toBe(row.deflate);
    });
    // Тонкое место «сжатое второй раз растёт»: +38 байт.
    expect(zlib.gzipSync(gz, { level: 9 }).length).toBe(t.ENTROPY_ROWS[2].size + 38);
  });
});

describe('демо', () => {
  it('каждый пример демо проходит весь путь: токены, коды, биты', () => {
    expect(t.DEMO_PRESETS[0].text).toBe(t.HTML_SAMPLE);
    for (const p of t.DEMO_PRESETS) {
      const data = enc.encode(p.text);
      const tokens = api.lz77(data);
      expect(same(api.unlz77(tokens), data)).toBe(true);
      const st = api.blockBits(tokens);
      expect(st.bits).toBeGreaterThan(0);
      expect(api.fixedBits(st)).toBeGreaterThan(0);
    }
  });
});
