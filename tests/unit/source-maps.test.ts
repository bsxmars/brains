import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import remapping from '@jridgewell/remapping';
import { decode } from '@jridgewell/sourcemap-codec';
import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping';
import { build, transform, type BuildOptions } from 'esbuild';
import { minify } from 'terser';
import { beforeAll, describe, expect, it } from 'vitest';
import * as t from '@/content/tooling/source-maps/data';
import { loadLookup, loadVlq } from '@/widgets/source-map-lab/model/run';
import type { RawMap } from '@/widgets/source-map-lab/model/types';

/**
 * Тема «Source maps изнутри».
 *
 * `VLQ_CODE` и `LOOKUP_CODE` — строки из темы: напечатаны на странице и исполняются демо.
 * Здесь они сверяются с `@jridgewell/sourcemap-codec` и `trace-mapping` на **каждой**
 * позиции бандлов, которые сейчас пишут esbuild и terser. Литералы стенда (`CART_JS`,
 * `CART_MAP`, `GREET_*`, стеки) пересобираются теми же вызовами и сверяются как есть: сменится
 * версия сборщика и вывод — покраснеет здесь, а не останется неправдой на странице.
 */

const vlq = loadVlq(t.VLQ_CODE);
const lookup = loadLookup(t.LOOKUP_CODE);

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'source-maps-')));
const read = (p: string) => readFileSync(join(dir, p), 'utf8');
const readMap = (p: string) => JSON.parse(read(p)) as RawMap & { version: number };
const stripComment = (code: string) => code.replace(/\n\/\/# sourceMappingURL=.*\n?$/, '');

/** Стек без абсолютного пути до каталога стенда — как он напечатан в теме. */
function run(file: string, flags: string[] = []): string {
  try {
    execFileSync(process.execPath, [...flags, join(dir, file)], { cwd: dir, stdio: 'pipe' });
    return '';
  } catch (e) {
    return String((e as { stderr: Buffer }).stderr).replaceAll(`${dir}/`, '');
  }
}

let step1Map: RawMap;

beforeAll(async () => {
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src/price.ts'), t.PRICE_TS);
  writeFileSync(join(dir, 'src/cart.ts'), t.CART_TS);
  const common: BuildOptions = { entryPoints: [join(dir, 'src/cart.ts')], bundle: true, sourcemap: true, format: 'esm', platform: 'node', charset: 'utf8' };

  await build({ ...common, minify: true, outfile: join(dir, 'dist/one/cart.js') });
  await build({ ...common, outfile: join(dir, 'dist/step1/cart.js') });

  const step1 = stripComment(read('dist/step1/cart.js')) + '\n';
  step1Map = readMap('dist/step1/cart.js.map');
  for (const [name, content] of [['chain-lost', undefined], ['chain-ok', read('dist/step1/cart.js.map')]] as const) {
    const out = await minify({ 'cart.js': step1 }, {
      module: true,
      format: { ascii_only: false },
      sourceMap: { filename: 'cart.min.js', url: 'cart.min.js.map', ...(content ? { content } : {}) },
    });
    mkdirSync(join(dir, 'dist', name), { recursive: true });
    writeFileSync(join(dir, 'dist', name, 'cart.min.js'), out.code ?? '');
    writeFileSync(join(dir, 'dist', name, 'cart.min.js.map'), String(out.map));
    // Карта без входной ведёт в промежуточный cart.js — пусть он лежит рядом, как на стенде.
    writeFileSync(join(dir, 'dist', name, 'cart.js'), read('dist/step1/cart.js'));
  }
}, 60_000);

describe('литералы стенда совпадают с тем, что пишут сборщики сейчас', () => {
  it('бандл и карта за один шаг — CART_JS и CART_MAP', () => {
    expect(stripComment(read('dist/one/cart.js'))).toBe(t.CART_JS);
    const map = readMap('dist/one/cart.js.map');
    expect(map).toEqual(t.CART_MAP);
  });

  it('маленький пример — GREET_JS и GREET_MAP', async () => {
    const r = await transform(t.GREET_TS, { loader: 'ts', sourcemap: 'external', sourcefile: 'greet.ts', charset: 'utf8' });
    expect(r.code.replace(/\n$/, '')).toBe(t.GREET_JS);
    expect(JSON.parse(r.map)).toEqual(t.GREET_MAP);
  });

  it('стек без карты и с --enable-source-maps — как напечатан', () => {
    const tail = (s: string) => s.split('\n').slice(1).join('\n');
    const bare = run('dist/one/cart.js').replaceAll('dist/one/', 'dist/');
    const mapped = run('dist/one/cart.js', ['--enable-source-maps']);
    for (const line of tail(t.STACK_BARE).split('\n')) expect(bare).toContain(line);
    for (const line of tail(t.STACK_MAPPED).split('\n')) expect(mapped).toContain(line);
  });

  it('цепочка: без входной карты стек уходит в промежуточный cart.js:14, с ней — в cart.ts:11', () => {
    const lost = run('dist/chain-lost/cart.min.js', ['--enable-source-maps']);
    const ok = run('dist/chain-ok/cart.min.js', ['--enable-source-maps']);
    expect(lost).toContain('at checkout (dist/chain-lost/cart.js:14:11)');
    expect(ok).toContain('at checkout (src/cart.ts:11:11)');
    expect(t.CHAIN_LOST_CODE).toContain('at checkout (dist/cart.js:14:11)');
    expect(t.CHAIN_OK_CODE).toContain('at checkout (src/cart.ts:11:11)');
  });
});

/** Все карты стенда: на них сверяются функции темы. */
const maps = (): [string, RawMap][] => [
  ['greet', t.GREET_MAP],
  ['cart', t.CART_MAP],
  ['step1', step1Map],
  ['chain-lost', readMap('dist/chain-lost/cart.min.js.map')],
  ['chain-ok', readMap('dist/chain-ok/cart.min.js.map')],
];

describe('VLQ_CODE против @jridgewell/sourcemap-codec', () => {
  it('decodeMappings даёт те же сегменты на всех картах стенда', () => {
    for (const [name, map] of maps()) {
      expect(vlq.decodeMappings(map.mappings), name).toEqual(decode(map.mappings));
    }
  });

  it('readVlq читает отрицательные и многобуквенные числа', () => {
    // «D» = 3: младший бит 1 — минус, число 1. «gB» = 32: два знака.
    expect(vlq.readVlq('D', 0)).toEqual([-1, 1]);
    expect(vlq.readVlq('gB', 0)).toEqual([16, 2]);
    expect(vlq.readVlq('iB', 0)).toEqual([17, 2]);
  });

  it('разбор SAAiB по буквам в теме совпадает с функцией', () => {
    const raw = t.GREET_MAP.mappings.split(';')[0].split(',')[4];
    expect(raw).toBe('SAAiB');
    expect(t.SEGMENT_STEPS.map((s) => s.ch).join('')).toBe(raw);
    for (const s of t.SEGMENT_STEPS) {
      expect(s.bits).toBe(vlq.B64.indexOf(s.ch).toString(2).padStart(6, '0'));
    }
    const deltas: number[] = [];
    for (let pos = 0; pos < raw.length; ) {
      const [v, next] = vlq.readVlq(raw, pos);
      deltas.push(v);
      pos = next;
    }
    expect(deltas).toEqual([9, 0, 0, 17]);
    expect(vlq.decodeMappings(t.GREET_MAP.mappings)[0][4]).toEqual([24, 0, 0, 32]);
    expect(t.SEGMENT_NOTE).toContain('колонку 24 бандла и 32 исходника');
    expect(t.GREET_TS.slice(19, 27)).toBe(': string');
  });
});

describe('LOOKUP_CODE против @jridgewell/trace-mapping', () => {
  it('на каждой позиции каждой строки всех карт ответ совпадает', () => {
    for (const [name, map] of maps()) {
      const lines = vlq.decodeMappings(map.mappings);
      const tm = new TraceMap(map as never);
      lines.forEach((segs, li) => {
        const width = (segs.at(-1)?.[0] ?? 0) + 5;
        for (let col = 0; col <= width; col++) {
          const want = originalPositionFor(tm, { line: li + 1, column: col });
          const got = lookup(map, lines, li + 1, col);
          const norm = got ?? { source: null, line: null, column: null, name: null };
          expect(norm, `${name} ${li + 1}:${col}`).toEqual(want);
        }
      });
    }
  });

  it('разбор стека в теме: 1:171 → сегмент 51 на колонке 170 → cart.ts:11:11, имя из объявления', () => {
    const lines = vlq.decodeMappings(t.CART_MAP.mappings);
    expect(lines[0]).toHaveLength(68);
    expect(t.LOOKUP_STEPS[1].d).toContain('68 сегментов');
    expect(lines[0][51][0]).toBe(170);
    expect(t.DEMO_EXAMPLES[1].start).toEqual([0, 51]);
    expect(t.CART_JS.slice(170, 173)).toBe('new');
    expect(lookup(t.CART_MAP, lines, 1, 170)).toEqual({ source: '../../src/cart.ts', line: 11, column: 10, name: null });
    // Объявление `function i` — колонка 139: там сегмент с именем checkout.
    expect(t.CART_JS.slice(130, 140)).toBe('function i');
    expect(lookup(t.CART_MAP, lines, 1, 139)?.name).toBe('checkout');
  });
});

describe('склейка карт', () => {
  it('remapping карты «без входной» с картой первого шага ведёт туда же, куда склеенная terser', () => {
    const lost = readMap('dist/chain-lost/cart.min.js.map');
    const ok = new TraceMap(readMap('dist/chain-ok/cart.min.js.map') as never);
    const merged = new TraceMap(remapping([lost as never, step1Map as never], () => null) as never);
    const code = read('dist/chain-ok/cart.min.js');
    const col = code.indexOf('new Error');
    expect(col).toBeGreaterThan(0);
    const a = originalPositionFor(merged, { line: 1, column: col });
    const b = originalPositionFor(ok, { line: 1, column: col });
    expect(a.line).toBe(11);
    expect(a.source).toMatch(/cart\.ts$/);
    expect({ line: a.line, column: a.column }).toEqual({ line: b.line, column: b.column });
  });
});
