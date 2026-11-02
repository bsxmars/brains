/**
 * «Каскад CSS»: тексты про фолбэк `var()` сверены с Chromium 153 (шапка `VAR_CASES` в data.ts):
 * фолбэк берётся только у неопределённой переменной; пустое значение и неверный тип — `0px`.
 * Браузерный прогон здесь не повторяется — тест держит текст на стороне замера.
 */
import { describe, expect, it } from 'vitest';
import {
  FUNCTIONAL_CODE,
  IACVT_NOTE,
  LAYER_CODE,
  LAYER_PROJECT_CODE,
  NESTING_CODE,
  OVERRIDES_CODE,
  PITFALLS,
  PROPERTY_NOTE,
  RESOLVED_ITEMS,
  VAR_CASES,
} from '@/content/render/css-cascade/data';

describe('фолбэк var(): только для неопределённой переменной', () => {
  it('случай «пусто» не обещает фолбэк', () => {
    const empty = VAR_CASES.find((c) => c.id === 'empty')!;
    expect(empty.why).not.toMatch(/фолбэк[^.]*здесь бы сработал/);
    expect(empty.why).toContain('пустая переменная определена');
  });

  it('IACVT_NOTE не называет пустую переменную условием фолбэка', () => {
    expect(IACVT_NOTE).not.toContain('или пуста');
    expect(IACVT_NOTE).toContain('только когда переменная не определена');
  });

  it('тонкое место про IACVT говорит то же', () => {
    expect(PITFALLS.some((p) => p.d.includes('срабатывает только когда переменная не определена'))).toBe(true);
  });
});

/**
 * Специфичность по Selectors 4 для того подмножества, что стоит в примерах темы:
 * `#id`, `.class`, `[attr]`, `:псевдокласс`, тип, `::псевдоэлемент`; `:is/:not/:has` — самый
 * специфичный аргумент, `:where` — ноль, `:nth-child(… of S)` — псевдокласс плюс самый специфичный из S.
 */
type Spec = [number, number, number];
const add = (a: Spec, b: Spec): Spec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const max = (list: Spec[]): Spec =>
  list.reduce((m, x) => (x[0] !== m[0] ? (x[0] > m[0] ? x : m) : x[1] !== m[1] ? (x[1] > m[1] ? x : m) : x[2] > m[2] ? x : m), [0, 0, 0]);
function splitTop(text: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  return [...out, cur];
}
function specificity(selector: string): Spec {
  let spec: Spec = [0, 0, 0];
  let i = 0;
  const s = selector.trim();
  while (i < s.length) {
    const rest = s.slice(i);
    const fn = /^:(is|not|has|where|nth-child)\(/.exec(rest);
    if (fn) {
      let depth = 0, j = fn[0].length - 1;
      for (; j < rest.length; j++) { if (rest[j] === '(') depth++; if (rest[j] === ')' && --depth === 0) break; }
      const inner = rest.slice(fn[0].length, j);
      if (fn[1] === 'where') { /* ноль */ }
      else if (fn[1] === 'nth-child') {
        const of = / of (.+)$/.exec(inner);
        spec = add(add(spec, [0, 1, 0]), of ? max(splitTop(of[1], ',').map(specificity)) : [0, 0, 0]);
      } else spec = add(spec, max(splitTop(inner, ',').map(specificity)));
      i += j + 1;
      continue;
    }
    const tok = /^(#[\w-]+|\.[\w-]+|\[[^\]]*\]|::[\w-]+|:[\w-]+|[a-z][\w-]*|[\s>+~*]+)/.exec(rest);
    if (!tok) throw new Error(`не разобрать: ${rest}`);
    const t = tok[0];
    if (t.startsWith('#')) spec = add(spec, [1, 0, 0]);
    else if (t.startsWith('::')) spec = add(spec, [0, 0, 1]);
    else if (t.startsWith('.') || t.startsWith('[') || t.startsWith(':')) spec = add(spec, [0, 1, 0]);
    else if (/^[a-z]/.test(t)) spec = add(spec, [0, 0, 1]);
    i += t.length;
  }
  return spec;
}

describe('подсчёт специфичности в комментариях примеров', () => {
  /** Вычитка 2026-10-30: `.card` и `.title` — классы, а комментарии считали их типами. */
  it('FUNCTIONAL_CODE: итог в комментарии совпадает с подсчётом', () => {
    const lines = FUNCTIONAL_CODE.split('\n').filter((l) => /= \(\d,\d,\d\) /.test(l + ' '));
    expect(lines.length).toBe(4);
    for (const line of lines) {
      const selector = line.split('/*')[0];
      const stated = /= \((\d),(\d),(\d)\)/.exec(line)!.slice(1).map(Number);
      expect(specificity(selector), line).toEqual(stated);
    }
  });

  it('NESTING_CODE: `&` равен :is(родительский список)', () => {
    const line = NESTING_CODE.split('\n').find((l) => l.includes('→'))!;
    const expanded = /\/\* (.+) → \((\d),(\d),(\d)\)/.exec(line)!;
    expect(specificity(expanded[1])).toEqual(expanded.slice(2).map(Number));
  });
});

describe('@import стоит до любого блочного правила', () => {
  /**
   * CSS Cascade 5: `@import` после любого правила, кроме `@charset` и строки `@layer a, b;`,
   * отбрасывается (так и пишет `LAYER_PROJECT_FACTS`). lightningcss на прежнем `OVERRIDES_CODE`:
   * «@import rules must precede all rules aside from @charset and @layer statements».
   */
  it.each([
    ['LAYER_CODE', LAYER_CODE],
    ['OVERRIDES_CODE', OVERRIDES_CODE],
    ['LAYER_PROJECT_CODE', LAYER_PROJECT_CODE],
  ])('%s', (_, code) => {
    const css = code.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css.lastIndexOf('@import')).toBeGreaterThan(-1);
    expect(css.indexOf('{')).toBeGreaterThan(css.lastIndexOf('@import'));
  });
});

describe('line-height в getComputedStyle', () => {
  /** CSSOM, Resolved Values: для `line-height` — used value (или `normal`); пиксели в Chromium — по спецификации. */
  it('заметка не называет пиксели расхождением со спецификацией', () => {
    const note = RESOLVED_ITEMS.find((r) => r.name === 'line-height')!.note;
    expect(note).not.toContain('расходится со спецификацией');
    expect(note).toContain('used value');
  });
});

describe('@property и анимация', () => {
  /** `box-shadow` интерполируется и без регистрации (список теней); без `@property` не анимируется градиент. */
  it('регистрация не названа единственным способом анимировать тень', () => {
    expect(PROPERTY_NOTE).not.toMatch(/единственный[^.]*тень/);
    expect(PROPERTY_NOTE).toContain('способ анимировать градиент через CSS');
  });
});
