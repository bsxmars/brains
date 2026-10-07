import { describe, expect, it } from 'vitest';
import * as t from '@/content/render/virtual-lists/data';
import { extraLines, loadWindow } from '@/widgets/vlist-lab/model/window';

/**
 * Тема «Длинные списки: виртуализация».
 *
 *  1. **Код окна.** `WINDOW_CODE` — строка из темы, та же, что напечатана на странице
 *     и исполняется демо. Её функции прогоняются по таблицам случаев, посчитанных руками,
 *     и по свойствам, которые обязаны держаться на любых входах: две реализации окна
 *     совпадают на одинаковых высотах, поиск логарифмический, поправка прокрутки оставляет
 *     видимое на месте.
 *  2. **Отношения из замеров.** Страница показывает отношения («×0.13–0.15»), а не
 *     миллисекунды. Тест пересчитывает их из `COST_RAW` и `CV_FIRST_RAW` — сырых чисел,
 *     снятых в Chromium 153 (условия — в шапке `data.ts`). Разойдётся строка таблицы
 *     с замером — красный тест, а не находка читателя.
 */

const w = loadWindow(t.WINDOW_CODE);

describe('WINDOW_CODE: fixedRange по таблице', () => {
  const cases: [string, Parameters<typeof w.fixedRange>, ReturnType<typeof w.fixedRange>][] = [
    ['начало, без запаса', [0, 400, 32, 10000, 0], { start: 0, end: 13, padTop: 0, padBottom: 9987 * 32 }],
    ['начало, запас 5 — сверху запасать нечего', [0, 400, 32, 10000, 5], { start: 0, end: 18, padTop: 0, padBottom: 9982 * 32 }],
    ['середина, запас 3', [5000, 400, 32, 10000, 3], { start: 153, end: 172, padTop: 153 * 32, padBottom: 9828 * 32 }],
    ['строка, начавшаяся ровно на нижнем крае, не видна', [320, 400, 40, 100, 0], { start: 8, end: 18, padTop: 320, padBottom: 82 * 40 }],
    ['прокрутка за концом списка', [1e6, 400, 32, 100, 2], { start: 97, end: 100, padTop: 97 * 32, padBottom: 0 }],
    ['упругая прокрутка меньше нуля', [-50, 400, 32, 100, 0], { start: 0, end: 13, padTop: 0, padBottom: 87 * 32 }],
    ['список короче окна', [0, 400, 32, 5, 3], { start: 0, end: 5, padTop: 0, padBottom: 0 }],
    ['окно нулевой высоты — одна строка', [64, 0, 32, 100, 0], { start: 2, end: 3, padTop: 64, padBottom: 97 * 32 }],
    ['пустой список', [0, 400, 32, 0, 3], { start: 0, end: 0, padTop: 0, padBottom: 0 }],
  ];
  for (const [label, args, expected] of cases) {
    it(label, () => expect(w.fixedRange(...args)).toEqual(expected));
  }

  it('распорки и окно вместе дают полную высоту списка', () => {
    for (const st of [0, 17, 999, 5000, 319600]) {
      const r = w.fixedRange(st, 400, 32, 10000, 4);
      expect(r.padTop + (r.end - r.start) * 32 + r.padBottom).toBe(10000 * 32);
    }
  });
});

describe('WINDOW_CODE: префиксные суммы и бинарный поиск', () => {
  const offsets = w.prefixSums([10, 20, 30, 40, 50]);

  it('offsets[i] — верх строки i, последний — высота списка', () => {
    expect(offsets).toBeInstanceOf(Float64Array);
    expect([...offsets]).toEqual([0, 10, 30, 60, 100, 150]);
  });

  const search: [number, boolean, number][] = [
    [-5, false, 0],
    [0, false, 0],
    [0, true, 1],
    [10, false, 1],
    [10, true, 2],
    [99, false, 4],
    [100, true, 5],
    [1e9, true, 5],
  ];
  for (const [y, orEqual, expected] of search) {
    it(`countBefore(y=${y}, orEqual=${orEqual}) = ${expected}`, () => {
      expect(w.countBefore(offsets, y, orEqual)).toBe(expected);
    });
  }

  /**
   * Словарь обещает «из 100 000 смещений — за 17 сравнений». Считаем чтения массива
   * прокси: сравнение в цикле читает ровно один элемент.
   */
  it('поиск среди 100 000 строк читает не больше 17 смещений', () => {
    const big = w.prefixSums(Array.from({ length: 100000 }, (_, i) => 20 + (i % 7) * 9));
    let reads = 0;
    const counted = new Proxy(big, {
      get(target, key) {
        if (typeof key === 'string' && /^\d+$/.test(key)) reads += 1;
        const value = Reflect.get(target, key, target) as unknown;
        return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    });
    let worst = 0;
    for (const y of [0, 1, 12345, 777777, big[50000], big[99999], big[100000], 1e12]) {
      reads = 0;
      w.countBefore(counted, y, true);
      worst = Math.max(worst, reads);
    }
    expect(worst).toBeLessThanOrEqual(17);
    expect(t.GLOSSARY.find((g) => g.k === 'бинарный поиск')?.d).toContain('17 сравнений');
  });
});

describe('WINDOW_CODE: variableRange', () => {
  const offsets = w.prefixSums([10, 20, 30, 40, 50]);
  const cases: [string, number, number, number, ReturnType<typeof w.variableRange>][] = [
    ['начало', 0, 25, 0, { start: 0, end: 2, padTop: 0, padBottom: 120 }],
    ['строка ровно заполняет окно', 30, 30, 0, { start: 2, end: 3, padTop: 30, padBottom: 90 }],
    ['запас 1 с обеих сторон', 35, 30, 1, { start: 1, end: 5, padTop: 10, padBottom: 0 }],
    ['за концом списка — последняя строка', 1000, 30, 0, { start: 4, end: 5, padTop: 100, padBottom: 0 }],
  ];
  for (const [label, st, vp, over, expected] of cases) {
    it(label, () => expect(w.variableRange(st, vp, offsets, over)).toEqual(expected));
  }

  it('на одинаковых высотах совпадает с fixedRange — на любой прокрутке и любом запасе', () => {
    for (const h of [32, 40, 17]) {
      const count = 500;
      const off = w.prefixSums(new Array(count).fill(h));
      for (let st = -40; st <= count * h + 40; st += 7) {
        for (const vp of [0, 1, 400, h * 3]) {
          for (const over of [0, 3]) {
            expect(w.variableRange(st, vp, off, over), `h=${h} st=${st} vp=${vp} over=${over}`).toEqual(
              w.fixedRange(st, vp, h, count, over),
            );
          }
        }
      }
    }
  });
});

describe('WINDOW_CODE: applyMeasured', () => {
  it('сдвигает все смещения ниже строки и не трогает выше', () => {
    const off = w.prefixSums([10, 10, 10, 10]);
    w.applyMeasured(off, 1, 25, 0);
    expect([...off]).toEqual([0, 10, 35, 45, 55]);
  });

  it('поправка прокрутки — только если строка начиналась выше окна', () => {
    expect(w.applyMeasured(w.prefixSums([10, 10, 10, 10]), 1, 25, 5)).toBe(0);
    expect(w.applyMeasured(w.prefixSums([10, 10, 10, 10]), 1, 25, 20)).toBe(15);
    expect(w.applyMeasured(w.prefixSums([10, 10, 10, 10]), 1, 4, 20)).toBe(-6);
    expect(w.applyMeasured(w.prefixSums([10, 10, 10, 10]), 1, 10, 20)).toBe(0);
  });

  /**
   * Смысл поправки: то, что читатель видит, остаётся на месте. Если измеренная строка
   * начиналась выше окна, съехало всё видимое — и поправка возвращает его ровно на место.
   * Если строка сама в окне, двигаться обязано только то, что ниже неё: строка стала выше,
   * и это видно, — а всё над ней стоит, и поправки нет.
   */
  it('после поправки видимое над измеренной строкой не сдвигается ни на пиксель', () => {
    const heights = Array.from({ length: 300 }, (_, i) => 30 + extraLines(i) * 18);
    for (const [index, measured, scrollTop] of [
      [10, 90, 2000],
      [40, 12, 2000],
      [60, 60, 1801],
      [120, 12, 2000],
      [200, 100, 2000],
    ]) {
      const off = w.prefixSums(heights);
      const before = Float64Array.from(off);
      const fix = w.applyMeasured(off, index, measured, scrollTop);
      const above = before[index] < scrollTop;
      expect(fix, `index=${index}`).toBe(above ? measured - heights[index] : 0);
      for (let k = 0; k < heights.length; k++) {
        if (before[k] < scrollTop) continue; // выше окна — не видно
        if (!above && k > index) continue; // ниже выросшей видимой строки — сдвиг законный
        expect(off[k] - (scrollTop + fix), `index=${index} k=${k}`).toBe(before[k] - scrollTop);
      }
    }
  });
});

describe('WINDOW_CODE: withSticky', () => {
  const headers = [0, 50, 120];
  const cases: [number, number, number[], number[]][] = [
    [60, 63, headers, [50, 60, 61, 62]],
    [50, 53, headers, [50, 51, 52]],
    [10, 12, headers, [0, 10, 11]],
    [0, 3, headers, [0, 1, 2]],
    [130, 132, headers, [120, 130, 131]],
    [3, 5, [5], [3, 4]],
    [3, 5, [], [3, 4]],
  ];
  for (const [start, end, hs, expected] of cases) {
    it(`[${start}, ${end}) при заголовках ${JSON.stringify(hs)}`, () => {
      expect(w.withSticky(start, end, hs)).toEqual(expected);
    });
  }
});

describe('демо: высоты строк задаёт содержимое', () => {
  it('extraLines даёт 0, 1 и 2 строчки вперемешку', () => {
    const seen = new Set(Array.from({ length: 50 }, (_, i) => extraLines(i)));
    expect([...seen].sort()).toEqual([0, 1, 2]);
  });

  it('искомая строка есть и в 10 000, и в 100 000', () => {
    expect(t.DEMO_TARGET).toBeLessThan(10000);
    expect(t.DEMO_FOOTER).not.toContain(String(t.DEMO_TARGET));
    for (const m of t.DEMO_MODES) expect(m.note).not.toContain(String(t.DEMO_TARGET));
  });

  it('тяжёлые режимы помечены и строятся только по кнопке', () => {
    expect(t.DEMO_MODES.find((m) => m.key === 'virtual')?.heavy).toBe(false);
    expect(t.DEMO_MODES.filter((m) => m.heavy).map((m) => m.key).sort()).toEqual(['all', 'cv']);
  });
});

/** Отношение по двум прогонам: наименьшее и наибольшее. */
function span(a: [number, number], b: [number, number]): [number, number] {
  const r = [a[0] / b[0], a[1] / b[1]];
  return [Math.min(...r), Math.max(...r)];
}

function within([lo, hi]: [number, number], min: number, max: number, what: string) {
  expect(lo, `${what}: ${lo.toFixed(3)}…${hi.toFixed(3)}`).toBeGreaterThanOrEqual(min);
  expect(hi, `${what}: ${lo.toFixed(3)}…${hi.toFixed(3)}`).toBeLessThanOrEqual(max);
}

describe('отношения на странице пересчитываются из сырых замеров', () => {
  const k10 = t.COST_RAW['10k'];
  const k100 = t.COST_RAW['100k'];
  const row = (label: string) => {
    const found = t.COST_ROWS.find((r) => r[0] === label);
    expect(found, `нет строки «${label}» в COST_ROWS`).toBeTruthy();
    return found!;
  };

  it('узлы: окно — константа, остальное растёт вдесятеро', () => {
    expect(row('узлов в документе')).toEqual(['узлов в документе', '50 011', '50 011', '102']);
    expect(k10.all.nodes).toBe(50011);
    expect(k100.virtual.nodes).toBe(k10.virtual.nodes);
    expect(k100.all.nodes).toBe(500011);
  });

  it('раскладка при построении', () => {
    expect(row('раскладка при построении').slice(2)).toEqual(['×0.15', '×0.05']);
    within(span(k10.cv.layout, k10.all.layout), 0.145, 0.155, 'cv / all');
    within(span(k10.virtual.layout, k10.all.layout), 0.045, 0.056, 'virtual / all');
  });

  it('стиль при построении', () => {
    expect(row('стиль при построении').slice(2)).toEqual(['×0.9–1.0', '≈ 0']);
    within(span(k10.cv.style, k10.all.style), 0.895, 1.0, 'cv / all');
    within(span(k10.virtual.style, k10.all.style), 0, 0.015, 'virtual / all');
  });

  it('раскладка при смене ширины', () => {
    expect(row('раскладка при смене ширины').slice(2)).toEqual(['×0.58', '×0.008–0.009']);
    within(span(k10.cv.resize, k10.all.resize), 0.575, 0.585, 'cv / all');
    within(span(k10.virtual.resize, k10.all.resize), 0.0075, 0.0095, 'virtual / all');
  });

  it('прирост памяти процесса', () => {
    expect(row('прирост памяти процесса').slice(2)).toEqual(['×0.8', '×0.14']);
    within(span(k10.cv.rss, k10.all.rss), 0.75, 0.85, 'cv / all');
    within(span(k10.virtual.rss, k10.all.rss), 0.135, 0.145, 'virtual / all');
  });

  it('рост от 10 000 к 100 000', () => {
    expect(row('всё то же при 100 000 строк').slice(1)).toEqual(['растёт ×8–11', 'растёт ×7–11', 'не растёт']);
    const growth = (mode: 'all' | 'cv', keys: ('layout' | 'style' | 'resize' | 'rss' | 'scroll')[]) =>
      keys.flatMap((key) => span(k100[mode][key], k10[mode][key]));
    const all = growth('all', ['layout', 'style', 'resize', 'rss']);
    within([Math.min(...all), Math.max(...all)], 7.5, 11.0, 'все в DOM');
    const cv = growth('cv', ['layout', 'style', 'resize', 'rss', 'scroll']);
    within([Math.min(...cv), Math.max(...cv)], 6.5, 11.5, 'content-visibility');
    expect(k100.virtual.rss).toEqual(k10.virtual.rss);
  });

  it('прокрутка: content-visibility дорожает с длиной, полный DOM не раскладывает вовсе', () => {
    expect(k10.all.scroll).toEqual([0, 0]);
    within(span(k100.cv.scroll, k10.cv.scroll), 9.5, 11, 'cv 100k / 10k');
    within(span(k100.cv.scroll, k100.virtual.scroll), 39.5, 51, 'cv / virtual при 100k');
    expect(t.COST_SCROLL_NOTE).toContain('в 40–50 раз');
  });

  it('первый кадр content-visibility: без запасного размера дороже, чем без свойства', () => {
    const f = t.CV_FIRST_RAW;
    const rows = Object.fromEntries(t.CV_FIRST_ROWS.map((r) => [r[0], r.slice(1)]));
    expect(rows['`content-visibility: auto` без запасного размера']).toEqual(['×1.3–1.4', '×2.4–2.5']);
    within(span(f.none.layout, f.plain.layout), 1.3, 1.4, 'none / plain, раскладка');
    within(span(f.none.style, f.plain.style), 2.35, 2.55, 'none / plain, стиль');
    expect(rows['с `contain-intrinsic-size: 32px`']).toEqual(['×0.27–0.29', '×0.72–0.76']);
    within(span(f.fixed.layout, f.plain.layout), 0.265, 0.295, 'fixed / plain, раскладка');
    within(span(f.fixed.style, f.plain.style), 0.715, 0.765, 'fixed / plain, стиль');
    within(span(f.auto.layout, f.fixed.layout), 0.95, 1.05, 'auto / fixed');
    // «в 3.4–8 раз дешевле» — оба стенда: разная высота (CV_FIRST_RAW) и 100 000 строк (COST_RAW).
    const speedups = [...span(f.plain.layout, f.fixed.layout), ...span(k100.all.layout, k100.cv.layout)];
    within([Math.min(...speedups), Math.max(...speedups)], 3.35, 8.15, 'выигрыш раскладки');
    expect(t.CV_ROWS.find((r) => r[0] === 'раскладка первого кадра')?.[2]).toBe('в 3.4–8 раз дешевле полного DOM');
  });
});
