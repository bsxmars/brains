import { describe, expect, it } from 'vitest';
import * as t from '@/content/render/layout-internals/data';
import { loadFlex, loadFr, loadPlace } from '@/widgets/flex-lab/model/run';

/**
 * Тема «Раскладка изнутри: flex и grid».
 *
 * `FLEX_CODE`, `FR_CODE` и `PLACE_CODE` — строки из темы: напечатаны на странице, исполняются
 * демо (`widgets/flex-lab`). Здесь они гоняются на входах фикстур стенда и сверяются с тем,
 * что Chromium 153 вернул из `getBoundingClientRect` (литералы в `data.ts`, стенд описан
 * в его шапке). Браузер в тесте не поднимается: сверка идёт по литералам.
 *
 * Допуск — 1/64 px: Chromium хранит координаты в LayoutUnit, и 580 / 3 приходит как
 * 193.328125. Строже сравнивать нельзя, мягче — незачем.
 */

const resolveFlex = loadFlex(t.FLEX_CODE);
const { resolveFr, autoRepeat } = loadFr(t.FR_CODE);
const autoPlace = loadPlace(t.PLACE_CODE);

const near = (got: number[], want: number[]) => {
  expect(got).toHaveLength(want.length);
  got.forEach((g, i) => expect(Math.abs(g - want[i]), `элемент ${i}: ${g} против ${want[i]}`).toBeLessThanOrEqual(t.LAYOUT_UNIT));
};

describe('resolveFlex совпадает с Chromium на каждой флекс-фикстуре', () => {
  it.each(t.FLEX_FIXTURES.map((f) => [f.id, f] as const))('%s', (_, f) => {
    near(resolveFlex(f.container, f.items).sizes, f.measured);
  });

  it('переполнение при flex: 1 в 150 px — 118.84', () => {
    const f = t.flexFixture('flex-1-narrow');
    const r = resolveFlex(f.container, f.items);
    expect(r.overflow).toBeCloseTo(t.TEXT_SIZES.url.min + t.TEXT_SIZES.ok.min - 150, 6);
    expect(t.px(r.overflow)).toBe('118.84');
    expect(f.how).toContain('118.84');
  });

  it('упор в max — два прохода, во втором заморожены B и C', () => {
    const f = t.flexFixture('grow-max');
    const r = resolveFlex(f.container, f.items);
    expect(r.rounds).toHaveLength(2);
    expect(r.rounds[0].sizes).toEqual([120, 200, 200]);
    expect(r.rounds[0].frozen).toEqual([0]);
    expect(r.rounds[1].free).toBe(280);
  });

  it('сжатие делится по flex-shrink × базовый размер: каждый вдвое', () => {
    const f = t.flexFixture('shrink');
    const r = resolveFlex(f.container, f.items);
    expect(r.mode).toBe('shrink');
    r.sizes.forEach((s, i) => expect(s).toBe(f.items[i].basis / 2));
  });

  it('ссылка с min-width: auto заморожена сразу, ещё шире базового', () => {
    const f = t.flexFixture('shrink-auto');
    const r = resolveFlex(f.container, f.items);
    expect(r.sizes[0]).toBeGreaterThan(f.items[0].basis);
    expect(r.rounds[0].frozen).toEqual([1]);
  });

  it('flex: auto делит поровну только остаток', () => {
    const f = t.flexFixture('flex-auto');
    const r = resolveFlex(f.container, f.items);
    const add = r.sizes.map((s, i) => s - f.items[i].basis);
    expect(add[0]).toBeCloseTo(add[1], 9);
    expect(t.px(add[0])).toBe('206.59');
    expect(t.px(f.container - f.items[0].basis - f.items[1].basis)).toBe('413.17');
  });

  it('сумма flex-grow 0.25 + 0.25 оставляет 200 px пустыми', () => {
    const f = t.flexFixture('grow-fraction');
    const r = resolveFlex(f.container, f.items);
    expect(f.container - r.sizes.reduce((a, b) => a + b, 0)).toBe(200);
  });
});

describe('resolveFr совпадает с Chromium на каждой сетке', () => {
  it.each(t.FR_FIXTURES.map((f) => [f.id, f] as const))('%s', (_, f) => {
    near(resolveFr(f.container, f.tracks, f.gap).sizes, f.measured);
  });

  it('auto-fill: четыре колонки, auto-fit: две', () => {
    const [fill, fit] = t.REPEAT_FIXTURES;
    const nFill = autoRepeat(fill.container, fill.min, fill.gap, fill.items, false);
    const nFit = autoRepeat(fit.container, fit.min, fit.gap, fit.items, true);
    expect([nFill, nFit]).toEqual([4, 2]);
    for (const [f, n] of [[fill, nFill], [fit, nFit]] as const) {
      const { sizes } = resolveFr(f.container, Array.from({ length: n }, () => ({ fr: 1, min: f.min })), f.gap);
      near(sizes.slice(0, f.items), f.measured);
      // Левый край второго элемента — первая колонка плюс промежуток.
      near([sizes[0] + f.gap], [f.x[1]]);
    }
  });

  it('флекс и грид на сумме долей 0.5 дают 200 и 150', () => {
    expect(t.flexFixture('grow-fraction').measured).toEqual([200, 200]);
    expect(t.FR_FIXTURES.find((f) => f.id === 'fr-sum-lt1')!.measured).toEqual([150, 150]);
  });
});

describe('autoPlace совпадает с Chromium', () => {
  it('row', () => {
    expect(autoPlace(t.PLACE_COLUMNS, t.PLACE_SPANS, false)).toEqual(t.PLACE_SPARSE);
  });
  it('row dense', () => {
    expect(autoPlace(t.PLACE_COLUMNS, t.PLACE_SPANS, true)).toEqual(t.PLACE_DENSE);
  });
});

describe('числа в тексте совпадают с замерами', () => {
  it('min-content абзаца — ширина самого длинного слова', () => {
    expect(t.INTRINSIC_ROWS[0].w).toBe(t.WORD_WIDTH);
    expect(t.INTRINSIC_ROWS[1].w).toBe(t.INTRINSIC_ROWS[2].w);
    // fit-content = min(max-content, max(min-content, доступно))
    const fit = (avail: number) => Math.min(t.INTRINSIC_ROWS[1].w, Math.max(t.INTRINSIC_ROWS[0].w, avail));
    expect(fit(1000)).toBe(t.INTRINSIC_ROWS[2].w);
    expect(fit(200)).toBe(t.INTRINSIC_ROWS[3].w);
  });

  it('способы лечения: break-word не меняет ширину, anywhere — меняет', () => {
    const by = (k: string) => t.FIX_ROWS.find((r) => r.k.includes(k))!;
    expect(by('ничего').w).toBe(t.TEXT_SIZES.url.min);
    expect(by('break-word').w).toBe(t.TEXT_SIZES.url.min);
    expect(by('anywhere').w).toBe(150);
    expect(by('anywhere').lines).toBe(2);
  });

  it('тонкие места называют снятые числа', () => {
    const text = t.PITFALLS.map((p) => p.d).join('\n');
    expect(text).toContain(t.px(t.TEXT_SIZES.url.min));
    expect(text).toContain(String(t.FR_FIXTURES.find((f) => f.id === 'fr-gap')!.measured[0]));
    expect(text).toContain(t.px(t.FR_FIXTURES.find((f) => f.id === 'fr-auto-min')!.measured[1]));
    expect(t.MIN_WIDTH_COMPUTED).toEqual({ flexItem: 'auto', block: '0px' });
  });

  it('у каждого сценария демо — элементы своей фикстуры, и функция их считает', () => {
    for (const s of t.DEMO_SCENARIOS) {
      const r = resolveFlex(s.container, s.items);
      expect(r.sizes.every(Number.isFinite)).toBe(true);
    }
  });
});
