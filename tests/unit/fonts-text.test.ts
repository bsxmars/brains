import { existsSync, readFileSync } from 'node:fs';
import { create, type Font } from 'fontkitten';
import { fontace } from 'fontace';
import { describe, expect, it } from 'vitest';
import * as t from '@/content/render/fonts-text/data';
import { loadFontDisplay, loadOverrides, loadRanges } from '@/widgets/font-display-lab/model/run';
import type { Phase } from '@/widgets/font-display-lab/model/types';

/**
 * Тема «Шрифты и текст».
 *
 * `FONT_DISPLAY_CODE`, `OVERRIDES_CODE` и `RANGE_CODE` — строки из темы: напечатаны на
 * странице и исполняются демо. Здесь они сверяются с тем, что Chromium 153 показал на стенде
 * (литералы `STAND_RUNS`, `RANGE_RUNS`, `CLS_ROWS`, см. шапку `data.ts`). Браузер в тесте не
 * поднимается. Метрики шрифтов, на которых стоит подгонка, перечитываются `fontkitten`
 * из тех же woff2, что отдаёт сайт (`src/shared/styles/fonts/`); Georgia — системная macOS,
 * её проверка пропускается там, где файла нет.
 */

const fd = loadFontDisplay(t.FONT_DISPLAY_CODE);
const fallbackOverrides = loadOverrides(t.OVERRIDES_CODE);
const ranges = loadRanges(t.RANGE_CODE);

/** Точность стенда — длительность одного снимка экрана (~30 мс); берём с запасом. */
const TOL = 50;

const FONTS = 'src/shared/styles/fonts';

describe('fontPhase против Chromium на стенде', () => {
  it('стенд покрывает все пять значений и все задержки', () => {
    for (const display of ['auto', 'block', 'swap', 'fallback', 'optional'] as const) {
      const delays = t.STAND_RUNS.filter((r) => r.display === display && !r.preload).map((r) => r.delay);
      expect(delays).toEqual([30, 300, 1500, 2500, 4000, 5000]);
    }
  });

  it.each(t.STAND_RUNS.map((r) => [`${r.display}@${r.delay}${r.preload ? '+preload' : ''}`, r] as const))(
    '%s',
    (_, run) => {
      const wrong: string[] = [];
      for (const [state, from, to] of run.segs) {
        for (let x = from + TOL; x <= to - TOL; x += 10) {
          const got = fd.fontPhase(run.display, run.loaded, x, run.preload);
          if (got !== state) wrong.push(`t=${x}: стенд ${state}, модель ${got}`);
        }
      }
      expect(wrong.slice(0, 5)).toEqual([]);
    },
  );

  it('модель повторяет главные факты темы', () => {
    const at = (d: Parameters<typeof fd.fontPhase>[0], load: number, x: number, pre = false): Phase =>
      fd.fontPhase(d, load, x, pre);
    // auto сдаётся раньше block
    expect(at('block', 4000, 2500)).toBe('invisible');
    expect(at('auto', 4000, 2500)).toBe('fallback');
    // optional без preload не показывает шрифт даже при 30 мс
    expect(at('optional', 30, 1000)).toBe('fallback');
    expect(at('optional', 30, 1000, true)).toBe('font');
    expect(at('optional', 300, 1000, true)).toBe('fallback');
    // fallback: опоздал больше чем на 3.1 с — навсегда запасной
    expect(at('fallback', 2500, 5000)).toBe('font');
    expect(at('fallback', 4000, 5000)).toBe('fallback');
    // swap без пустых кадров
    expect(at('swap', 5000, 0)).toBe('fallback');
  });

  it('ширина невидимого текста — ширина запасного (310.38 против 295.72)', () => {
    expect(t.STAND_FACTS[0].d).toContain('310.38');
    expect(t.STAND_FACTS[0].d).toContain('295.72');
  });
});

describe('подгонка запасного шрифта', () => {
  const w18 = t.SAMPLE_WIDTHS.find((w) => w.size === 18)!;
  const ov = fallbackOverrides(t.NEWSREADER_METRICS, w18.newsreader, w18.georgia);

  it('даёт те числа, с которыми на стенде CLS стал нулём', () => {
    expect(ov).toEqual({
      'size-adjust': '92.21%',
      'ascent-override': '79.71%',
      'descent-override': '28.74%',
      'line-gap-override': '0.00%',
    });
    for (const [k, v] of Object.entries(ov)) expect(t.FALLBACK_FACE_CODE).toContain(`${k}: ${v};`);
    expect(t.CLS_ROWS.find((r) => r.k === 'ширина и высота')!.cls).toBe('0');
    expect(t.CLS_ROWS.find((r) => r.k === 'только ширина')!.css).toContain(ov['size-adjust']);
  });

  it('высота строки запасного после подгонки равна высоте строки Newsreader', () => {
    const m = t.NEWSREADER_METRICS;
    const size = parseFloat(ov['size-adjust']) / 100;
    const fb = (parseFloat(ov['ascent-override']) + parseFloat(ov['descent-override'])) / 100 * size;
    expect(fb).toBeCloseTo((m.ascent - m.descent + m.lineGap) / m.upm, 3);
  });

  it('числа про opsz и высоту строки в тексте посчитаны из замеров', () => {
    const pct = (w: { newsreader: number; georgia: number }) => ((w.newsreader / w.georgia) * 100).toFixed(2);
    const [w16, , w100] = t.SAMPLE_WIDTHS;
    expect(t.OPSZ_NOTE).toContain(`${pct(w16)}%`);
    expect(t.OPSZ_NOTE).toContain(`${pct(w100)}%`);
    expect(t.OPSZ_NOTE).toContain(`${pct(w18)}%`);
    const g = t.GEORGIA_METRICS;
    expect(((g.ascent - g.descent) / g.upm).toFixed(2)).toBe('1.14');
    expect(t.CLS_NOTE).toContain('≈ 1.14 em');
  });

  it('метрики Newsreader — из файла шрифта', () => {
    const f = create(readFileSync(`${FONTS}/newsreader-normal-300-700-latin.woff2`)) as Font;
    const m = t.NEWSREADER_METRICS;
    expect([f.unitsPerEm, f.ascent, f.descent, f.lineGap]).toEqual([m.upm, m.ascent, m.descent, m.lineGap]);
  });

  const GEORGIA = '/System/Library/Fonts/Supplemental/Georgia.ttf';
  it.skipIf(!existsSync(GEORGIA))('метрики Georgia — из системного файла', () => {
    const f = create(readFileSync(GEORGIA)) as Font;
    const g = t.GEORGIA_METRICS;
    expect([f.unitsPerEm, f.hhea.ascent, f.hhea.descent, f.hhea.lineGap]).toEqual([g.upm, g.ascent, g.descent, g.lineGap]);
  });
});

describe('unicode-range: какие файлы скачать', () => {
  it('parseRange понимает диапазоны, одиночные точки и «?»', () => {
    expect(ranges.parseRange('U+0400-045F, U+2116, U+4??')).toEqual([
      [0x400, 0x45f],
      [0x2116, 0x2116],
      [0x400, 0x4ff],
    ]);
    expect(ranges.parseRange('U+??')).toEqual([[0, 0xff]]);
  });

  it.each(t.RANGE_RUNS.map((r) => [r.text, r] as const))('«%s» — как на стенде', (_, run) => {
    expect([...ranges.facesToFetch(run.text, t.PLEX_FACES)].sort()).toEqual([...run.fetched].sort());
  });

  it('и два случая из текста, снятые отдельно', () => {
    // ★ — нет ни в одном файле: тянется latin (в нём пробел)
    expect(ranges.facesToFetch('★', t.PLEX_FACES)).toEqual(['plex-latin.woff2']);
    // latin без пробела в диапазоне: иероглифы не тянут ничего
    expect(ranges.facesToFetch('你好', [{ file: 'latin', range: 'U+0041-007A' }])).toEqual([]);
  });

  it('размеры подмножеств в примере — размеры файлов курса', () => {
    for (const f of ['ibm-plex-mono-normal-400-latin.woff2', 'ibm-plex-mono-normal-400-cyrillic.woff2']) {
      const buf = readFileSync(`${FONTS}/${f}`);
      expect(fontace(buf).family).toBe('IBM Plex Mono');
      expect(t.SUBSET_CODE).toContain(`${buf.length.toLocaleString('ru-RU').replace(/\s/g, ' ')} байт`);
    }
  });
});

describe('шейпинг: литералы и выводы', () => {
  it('разницы в тексте посчитаны из замеров', () => {
    const row = (s: string, k = 'auto') => t.SHAPING_ROWS.find((r) => r.s === s && r.kerning === k)!;
    const avatar = row('AVATAR');
    const office = row('office');
    expect((avatar.sum - avatar.whole).toFixed(2)).toBe('15.64');
    expect((office.sum - office.whole).toFixed(2)).toBe('3.83');
    expect(t.SHAPING_NOTE).toContain('15.64 px');
    expect(t.SHAPING_NOTE).toContain('3.83 px');
    expect(((avatar.sum - avatar.whole) / avatar.sum * 100).toFixed(1)).toBe('9.5');
    // без кернинга сумма сходится, лигатура остаётся
    expect(row('AVATAR', 'none').whole).toBe(row('AVATAR', 'none').sum);
    expect(row('office', 'none').whole).toBeLessThan(row('office', 'none').sum);
    // DOM и canvas отдают одну ширину
    expect(t.DOM_ROWS[0].avatar).toBe(avatar.whole);
    expect(t.MEASURE_CODE).toContain(String(avatar.whole));
    expect(t.MEASURE_CODE).toContain(String(avatar.sum));
  });
});
