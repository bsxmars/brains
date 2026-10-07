import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import * as t from '@/content/render/images/data';
import { loadSrcset } from '@/widgets/srcset-lab/model/run';

/**
 * Тема «Картинки: загрузка, декодирование и выбор размера».
 *
 * `SRCSET_CODE` — строка из темы: напечатана на странице и исполняется демо. Здесь она
 * сверяется с тем, что Chromium 153 запросил на стенде (`SCENARIOS`, `EDGE_RUNS`, `CACHE_ROWS`,
 * `SIZES_ROWS`, см. шапку `data.ts`). Браузер в тесте не поднимается.
 *
 * Байты файлов и таблица форматов пересобираются `sharp` из того же детерминированного
 * генератора картинки, что на стенде (`scene` ниже — копия `scene.mjs` стенда; поменяете
 * генератор — поменяются все байты, и тест об этом скажет). `sharp` в проекте —
 * транзитивная зависимость Astro (так же его берёт `tests/e2e/scroll-timeline.spec.ts`).
 */

const api = loadSrcset(t.SRCSET_CODE);

/** «Фотография» стенда: небо, облака, солнце, холмы с шумовой травой. RGB, 3 байта на пиксель. */
function scene(W: number, H: number): Buffer {
  const buf = Buffer.alloc(W * H * 3);
  let s = 12345;
  const rnd = () => (s = (s * 1103515245 + 12345) >>> 0) / 4294967296;
  const G = 64;
  const grid = Array.from({ length: G * G }, rnd);
  const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
  const sm = (k: number) => k * k * (3 - 2 * k);
  const noise = (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = sm(x - xi);
    const yf = sm(y - yi);
    const g = (i: number, j: number) => grid[(j & (G - 1)) * G + (i & (G - 1))];
    return lerp(lerp(g(xi, yi), g(xi + 1, yi), xf), lerp(g(xi, yi + 1), g(xi + 1, yi + 1), xf), yf);
  };
  const fbm = (x: number, y: number) =>
    noise(x, y) * 0.5 + noise(x * 2, y * 2) * 0.25 + noise(x * 4, y * 4) * 0.125 + noise(x * 8, y * 8) * 0.0625;
  for (let y = 0; y < H; y++) {
    const v = y / H;
    for (let x = 0; x < W; x++) {
      const u = x / W;
      let r = lerp(120, 225, v * 1.6);
      let g = lerp(170, 220, v * 1.6);
      let b = lerp(235, 240, v);
      const cloud = fbm(u * 6, v * 10);
      if (cloud > 0.55) {
        const k = Math.min(1, (cloud - 0.55) * 4);
        r = lerp(r, 250, k);
        g = lerp(g, 250, k);
        b = lerp(b, 252, k);
      }
      const dx = ((u - 0.75) * W) / H;
      const dy = v - 0.22;
      const d = Math.hypot(dx, dy);
      if (d < 0.08) {
        r = 255;
        g = 236;
        b = 170;
      } else if (d < 0.2) {
        const k = ((0.2 - d) / 0.12) * 0.5;
        r = lerp(r, 255, k);
        g = lerp(g, 230, k);
        b = lerp(b, 180, k);
      }
      const h1 = 0.55 + 0.06 * Math.sin(u * 7.0) + 0.03 * Math.sin(u * 19 + 1.3);
      const h2 = 0.68 + 0.05 * Math.sin(u * 4.3 + 2.0) + 0.02 * Math.sin(u * 23);
      if (v > h1) {
        const k = fbm(u * 40, v * 40);
        r = lerp(70, 110, k);
        g = lerp(110, 150, k);
        b = lerp(80, 100, k);
      }
      if (v > h2) {
        const k = fbm(u * 120, v * 60);
        r = lerp(50, 120, k);
        g = lerp(100, 170, k);
        b = lerp(30, 60, k);
      }
      const i = (y * W + x) * 3;
      buf[i] = r;
      buf[i + 1] = g;
      buf[i + 2] = b;
    }
  }
  return buf;
}

describe('pickCandidate против Chromium на стенде', () => {
  for (const sc of t.SCENARIOS) {
    it.each(sc.runs.map((r) => [`${sc.id} ${r.vw}@${r.dpr}`, r] as const))('%s', (_, run) => {
      expect(api.pickCandidate(sc.srcset, sc.sizes, { vw: run.vw, dpr: run.dpr }).pick).toBe(run.got);
    });
  }

  it('57 прогонов, как сказано в тексте', () => {
    const n = t.SCENARIOS.reduce((s, sc) => s + sc.runs.length, 0);
    expect(n).toBe(57);
    expect(t.SRCSET_FACTS[0].d).toContain(`${n} прогонах`);
  });

  it('граница: плотность ровно DPR подходит', () => {
    for (const r of t.EDGE_RUNS) expect(api.pickCandidate(t.SRCSET_W, t.SIZES, { vw: r.vw, dpr: r.dpr }).pick).toBe(r.got);
  });

  it('разбор sizes: какое правило сработало', () => {
    expect(api.slotWidth(t.SIZES, { vw: 1280, dpr: 1 })).toEqual({ px: 600, rule: '(min-width: 1000px) 600px' });
    expect(api.slotWidth(t.SIZES, { vw: 768, dpr: 1 })).toEqual({ px: 384, rule: '(min-width: 600px) 50vw' });
    expect(api.slotWidth(t.SIZES, { vw: 414, dpr: 1 })).toEqual({ px: 414, rule: '100vw' });
    expect(api.slotWidth(null, { vw: 800, dpr: 1 })).toEqual({ px: 800, rule: null });
    expect(api.slotWidth('(max-width: 500px) 100px, 50vw', { vw: 500, dpr: 1 }).px).toBe(100);
    expect(api.slotWidth('(max-width: 500px) 100px, 50vw', { vw: 501, dpr: 1 }).px).toBe(250.5);
    // неразобранная часть пропускается, как в браузере
    expect(api.slotWidth('calc(100vw - 20px), 300px', { vw: 800, dpr: 1 }).px).toBe(300);
  });

  it('кеш: элемент показывает файл плотнее, а упреждающий парсер качает свой', () => {
    const narrow = api.pickCandidate(t.SRCSET_W, t.SIZES, { vw: 375, dpr: 2, cached: ['p-1200.jpg'] });
    expect([narrow.pick, narrow.shown]).toEqual(['p-800.jpg', 'p-1200.jpg']);
    const row = t.CACHE_ROWS.find((r) => r.k === 'переход на страницу')!;
    expect(row.req).toContain(narrow.pick);
    expect(row.shown).toContain(narrow.shown);
    // файл в кеше менее плотный — не помогает
    const wide = api.pickCandidate(t.SRCSET_W, t.SIZES, { vw: 1440, dpr: 2, cached: ['p-800.jpg'] });
    expect([wide.pick, wide.shown]).toEqual(['p-1200.jpg', 'p-1200.jpg']);
    expect(t.CACHE_ROWS.find((r) => r.k === 'окно расширили')!.req).toContain(wide.pick);
  });

  it('карточка 300 px: sizes, sizes="auto" и lazy — как на стенде', () => {
    const at = (sizes: string | null, dpr: number, lazy = false) =>
      api.pickCandidate(t.SRCSET_W, sizes, { vw: 1440, dpr, lazy, layoutWidth: 300 }).pick;
    const cell = (k: string, col: 'dpr1' | 'dpr2') => t.SIZES_ROWS.find((r) => r.k === k)![col];
    expect(cell('`sizes` нет', 'dpr1')).toContain(at(null, 1));
    expect(cell('`sizes` нет', 'dpr2')).toContain(at(null, 2));
    expect(cell('честный `sizes`', 'dpr1')).toContain(at('300px', 1));
    expect(cell('честный `sizes`', 'dpr2')).toContain(at('300px', 2));
    expect(cell('`sizes="auto"` + lazy', 'dpr1')).toContain(at('auto', 1, true));
    expect(cell('`sizes="auto"` + lazy', 'dpr2')).toContain(at('auto', 2, true));
    expect(cell('`sizes="auto"` без lazy', 'dpr1')).toContain(at('auto', 1));
    expect(cell('`sizes="auto"` без lazy', 'dpr2')).toContain(at('auto', 2));
    // и байты в ячейках — байты файлов
    for (const r of t.SIZES_ROWS)
      for (const c of [r.dpr1, r.dpr2]) {
        const f = c.match(/`(p-\d+\.jpg)`/)![1];
        expect(c).toContain(`${t.FILES[f].bytes.toLocaleString('ru-RU').replace(/\s/g, ' ')} Б`);
      }
  });

  it('отношения в тексте посчитаны из байтов', () => {
    const b = (f: string) => t.FILES[f].bytes;
    expect((b('p-800.jpg') / b('p-400.jpg')).toFixed(1)).toBe('2.7');
    expect(t.DEMO_CAPTION).toContain('в 2.7 раза');
    expect((b('p-1600.jpg') / b('p-400.jpg')).toFixed(1)).toBe('7.2');
    expect(t.SIZES_NOTE).toContain('в 7.2 раза');
  });
});

describe('файлы и форматы — пересборка sharp', () => {
  const W = 2400;
  const H = 1600;
  let raw: Buffer;
  const master = () => sharp(raw, { raw: { width: W, height: H, channels: 3 } });

  beforeAll(() => {
    raw = scene(W, H);
  });

  it('кандидаты srcset: байты и размеры', async () => {
    for (const [name, f] of Object.entries(t.FILES)) {
      const m = name.match(/^p-(\d+)\.jpg$/);
      const x = name.match(/^a-(\d)x\.jpg$/);
      const width = m ? Number(m[1]) : Number(x![1]) * 300;
      const { data, info } = await master().resize(width).jpeg({ quality: 75 }).toBuffer({ resolveWithObject: true });
      expect([data.length, info.width, info.height], name).toEqual([f.bytes, f.w, f.h]);
    }
  }, 60_000);

  it('таблица форматов: байты и PSNR', async () => {
    const base = await master().resize(1200).raw().toBuffer({ resolveWithObject: true });
    const ref = base.data;
    const src = () => sharp(ref, { raw: { width: base.info.width, height: base.info.height, channels: 3 } });
    const psnr = async (buf: Buffer) => {
      const d = await sharp(buf).removeAlpha().raw().toBuffer();
      let se = 0;
      for (let i = 0; i < ref.length; i++) se += (ref[i] - d[i]) ** 2;
      const mse = se / ref.length;
      return mse === 0 ? '∞' : (10 * Math.log10((255 * 255) / mse)).toFixed(2);
    };
    for (const row of t.FORMAT_ROWS) {
      const lossless = row.q === 'без потерь';
      const fmt = row.fmt === 'JPEG' ? 'jpeg' : row.fmt === 'WebP' ? 'webp' : row.fmt === 'AVIF' ? 'avif' : 'png';
      const opts = lossless ? (fmt === 'webp' ? { lossless: true } : {}) : { quality: Number(row.q) };
      const buf = await src().toFormat(fmt, opts).toBuffer();
      expect([buf.length, await psnr(buf)], `${row.fmt} ${row.q}`).toEqual([row.bytes, row.psnr]);
    }
  }, 120_000);

  it('выводы про форматы — из таблицы', () => {
    const r = (fmt: string, q: string) => t.FORMAT_ROWS.find((x) => x.fmt === fmt && x.q === q)!;
    // «качество 75»: AVIF тяжелее WebP, но ближе к оригиналу
    expect(r('AVIF', '75').bytes).toBeGreaterThan(r('WebP', '75').bytes);
    expect(Number(r('AVIF', '75').psnr)).toBeGreaterThan(Number(r('WebP', '75').psnr));
    // около 41–42 дБ
    for (const x of [r('JPEG', '60'), r('WebP', '75'), r('AVIF', '30')]) {
      expect(Number(x.psnr)).toBeGreaterThanOrEqual(41);
      expect(Number(x.psnr)).toBeLessThan(42);
    }
    expect((r('JPEG', '60').bytes / r('AVIF', '30').bytes).toFixed(1)).toBe('4.4');
    expect(t.FORMAT_NOTE).toContain('в 4.4 раза');
  });

  it('файлы из таблицы памяти: байты', async () => {
    const want = new Map(t.DECODE_ROWS.map((r) => [r.file, r.fileBytes]));
    const make: Record<string, () => Promise<Buffer>> = {
      'p-1600.avif': () => master().resize(1600).avif({ quality: 50 }).toBuffer(),
      'p-1600.jpg': () => master().resize(1600).jpeg({ quality: 75 }).toBuffer(),
      'p-2400.jpg': () => master().resize(2400).jpeg({ quality: 75 }).toBuffer(),
      'm-1600.png': () => master().resize(1600).png().toBuffer(),
    };
    for (const [file, bytes] of want) expect((await make[file]()).length, file).toBe(bytes);
  }, 60_000);
});

describe('память битмапа', () => {
  const bitmapBytes = new Function(`${t.BITMAP_CODE}\nreturn bitmapBytes;`)() as (w: number, h: number) => number;

  it('код из темы считает то, что написано в его комментариях', () => {
    expect(bitmapBytes(1600, 1067)).toBe(6_828_800);
    expect(bitmapBytes(2400, 1600)).toBe(15_360_000);
    expect(t.BITMAP_CODE).toContain('6 828 800');
    expect(t.BITMAP_CODE).toContain(`${t.FILES['p-2400.jpg'].bytes.toLocaleString('ru-RU').replace(/\s/g, ' ')} байта`);
  });

  it('снимок memory-infra совпадает с w × h × 4 до 0.1%', () => {
    for (const row of t.DECODE_ROWS) {
      if (!row.bitmaps.length) continue;
      const [w, h] = row.file.includes('2400') ? [2400, 1600] : [1600, 1067];
      expect(Math.abs(row.bitmaps[0] - bitmapBytes(w, h)) / bitmapBytes(w, h), row.k).toBeLessThan(0.001);
    }
  });

  it('числа текста — из таблицы', () => {
    const avif = t.DECODE_ROWS[0];
    expect(Math.round(avif.bitmaps[0] / avif.fileBytes!)).toBe(294);
    expect(t.DECODE_NOTE).toContain('в 294 раза');
    expect(t.DECODE_NOTE).toContain(avif.bitmaps[0].toLocaleString('ru-RU').replace(/\s/g, ' '));
    // уменьшенная копия добавляется к полному битмапу, а не заменяет его
    for (const r of t.DECODE_ROWS.filter((x) => x.k.includes('показан в') && x.bitmaps.length === 2)) {
      expect(r.bitmaps[1]).toBeLessThan(r.bitmaps[0]);
    }
    // двадцать картинок 1600×1067 — больше 130 МБ
    expect((20 * avif.bitmaps[0]) / 1e6).toBeGreaterThan(130);
  });
});

describe('lazy, LCP, место под картинку — согласованность литералов', () => {
  it('порог: последнее расстояние с запросом на 1 меньше первого без', () => {
    for (const r of t.LAZY_ROWS) expect(r.first - r.last).toBe(1);
    expect(t.LAZY_ROWS[0].first).toBe(3000);
    expect(t.LAZY_NOTE).toContain('3000 px');
    // в скроллере вдвое меньше
    expect(t.LAZY_ROWS[0].first / t.LAZY_ROWS.at(-1)!.first).toBe(2);
  });

  it('LCP: числа текста — из таблицы', () => {
    const r = (k: string) => t.LCP_ROWS.find((x) => x.k === k)!;
    expect(t.LCP_NOTE).toContain(`${r('обычная').req}-й`);
    expect(t.LCP_NOTE).toContain(`LCP ${r('обычная').lcp} мс`);
    expect(t.LCP_NOTE).toContain(`${r('`loading="lazy"`').req}-й`);
    expect(t.LCP_NOTE).toContain(`${r('`loading="lazy"`').lcp} мс`);
    // lazy сдвигает LCP почти на время загрузки картинки (200 мс задержки сервера)
    expect(r('`loading="lazy"`').lcp - r('обычная').lcp).toBeGreaterThanOrEqual(190);
  });

  it('место под картинку: высота из пропорции', () => {
    const r = (k: string) => t.RATIO_ROWS.find((x) => x.k === k)!;
    expect(r('`width` и `height`').before).toBe(`375×${Math.round((375 * 800) / 1200)}`);
    expect(r('атрибуты не те').before).toBe(`375×${Math.round((375 * 600) / 1200)}`);
    for (const x of t.RATIO_ROWS) if (x.before.split(' ')[0] === x.after.split(' ')[0]) expect(x.cls, x.k).toBe('0');
  });
});
