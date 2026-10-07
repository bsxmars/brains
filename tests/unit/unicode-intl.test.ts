import { describe, expect, it } from 'vitest';
import * as t from '@/content/lessons/unicode-intl/data';
import { intlPlural, loadGraphemes, loadPlural } from '@/widgets/unicode-lab/model/run';

/**
 * Тема «Unicode и Intl: символы, графемы и сравнение строк».
 *
 * `GRAPHEME_CODE` и `PLURAL_CODE` — строки из темы: напечатаны на странице и исполняются демо.
 * Здесь они сверяются с `Intl.Segmenter` и `Intl.PluralRules` того Node, в котором идёт тест:
 * полным перебором пар кодовых точек, случайным корпусом и сотней тысяч чисел. Там, где
 * учебное подмножество UAX #29 правил не покрывает (хангыль, SpacingMark, Prepend, индийские
 * связки), сверки нет — но проверяется, что расхождения лежат **только** в этих классах.
 *
 * Примеры кода с комментариями `// → литерал` исполняются построчно (приём из
 * `v8-strings-unicode.test.ts`), таблицы темы — пересчитываются.
 *
 * Стенд снят на Node 24.11.0 (ICU 77.1, Unicode 16.0). Литералы про ICU (`ICU_ROWS`) привязаны
 * к этой версии: при смене Node тест скажет об этом первым, а не текст темы молча.
 */

const g = loadGraphemes(t.GRAPHEME_CODE);
const p = loadPlural(t.PLURAL_CODE);
const seg = new Intl.Segmenter('ru', { granularity: 'grapheme' });
const icu = (s: string) => [...seg.segment(s)].map((x) => x.segment);

function runAnnotated(code: string) {
  const checks: { line: string; expected: string }[] = [];
  const body = code
    .split('\n')
    .map((line) => {
      const m = line.match(/^(.*?);\s*\/\/ → (.+)$/);
      if (!m) return line;
      checks.push({ line: m[1].trim(), expected: m[2].trim() });
      const i = checks.length - 1;
      return `__got[${i}] = (${m[1]}); __want[${i}] = (${m[2]});`;
    })
    .join('\n');
  const got: unknown[] = [];
  const want: unknown[] = [];
  new Function('__got', '__want', '"use strict";\n' + body)(got, want);
  return checks.map((c, i) => ({ ...c, got: got[i], want: want[i] }));
}

describe('стенд: версии Node, на которых снята тема', () => {
  it('ICU 77.1, Unicode 16.0, CLDR 47.0', () => {
    expect(process.versions.icu).toBe('77.1');
    expect(process.versions.unicode).toBe('16.0');
    expect(process.versions.cldr).toBe('47.0');
    expect(t.ICU_ROWS[0].node).toContain('ICU 77.1');
  });
});

describe('примеры кода исполняются, как напечатаны', () => {
  const blocks = {
    UNITS_CODE: t.UNITS_CODE,
    BROKEN_CODE: t.BROKEN_CODE,
    TRUNCATE_CODE: t.TRUNCATE_CODE,
    NORMALIZE_CODE: t.NORMALIZE_CODE,
    CASE_CODE: t.CASE_CODE,
    CASELESS_CODE: t.CASELESS_CODE,
    LEVELS_CODE: t.LEVELS_CODE,
    FILES_CODE: t.FILES_CODE,
    FORMAT_CODE: t.FORMAT_CODE,
    SEPARATOR_CODE: t.SEPARATOR_CODE,
    BYTES_CUT_CODE: t.BYTES_CUT_CODE,
  };
  for (const [name, code] of Object.entries(blocks)) {
    const results = runAnnotated(code);
    it(`${name}: есть что проверять`, () => expect(results.length).toBeGreaterThanOrEqual(1));
    it.each(results)(`${name}: $line → $expected`, ({ got, want }) => {
      expect(got).toStrictEqual(want);
    });
  }

  it('«выглядит как 1 234,5» — только выглядит: разделитель неразрывный', () => {
    // Строка в SEPARATOR_CODE помечена «выглядит как» и набрана с обычным пробелом намеренно.
    const nf = new Intl.NumberFormat('ru');
    expect(nf.format(1234.5)).not.toBe('1 234,5');
    expect(nf.format(1234.5).replace('\u00a0', ' ')).toBe('1 234,5');
  });
});

describe('таблицы темы пересчитываются', () => {
  it('UNIT_API_ROWS — на 👍🏽', () => {
    const s = '\u{1F44D}\u{1F3FD}';
    for (const row of t.UNIT_API_ROWS) {
      const got = new Function('s', `return (${row.code});`)(s);
      expect(JSON.stringify(got), row.code).toBe(row.out);
    }
  });

  it('GRAPHEME_ROWS — длины, точки, графемы, байты и склеивающие правила', () => {
    const enc = new TextEncoder();
    for (const r of t.GRAPHEME_ROWS) {
      expect(r.value.length, r.label).toBe(r.length);
      expect([...r.value].length, r.label).toBe(r.points);
      expect(icu(r.value).length, r.label).toBe(r.graphemes);
      expect(g.splitGraphemes(r.value).length, r.label).toBe(r.graphemes);
      expect(enc.encode(r.value).length, r.label).toBe(r.utf8);
      const rules = [...new Set(g.graphemeBreaks(r.value).steps.filter((s) => s.join).map((s) => s.rule))];
      expect(rules.length ? rules.join(', ') : '—', r.label).toBe(r.glue);
    }
  });

  it('SORT_ROWS — три способа сортировки из SORT_CODE', () => {
    const cols = [
      [...t.SORT_FILES].sort(),
      [...t.SORT_FILES].sort(new Intl.Collator('ru').compare),
      [...t.SORT_FILES].sort(new Intl.Collator('ru', { numeric: true }).compare),
    ];
    const rows = t.SORT_FILES.map((_, i) => cols.map((c) => `\`${c[i]}\``));
    expect(rows).toEqual(t.SORT_ROWS);
  });

  it('GERMAN_ROWS — sort(), de, sv, de-u-co-phonebk', () => {
    const cols = [
      [...t.GERMAN_WORDS].sort(),
      ...['de', 'sv', 'de-u-co-phonebk'].map((l) => [...t.GERMAN_WORDS].sort(new Intl.Collator(l).compare)),
    ];
    const rows = t.GERMAN_WORDS.map((_, i) => cols.map((c) => `\`${c[i]}\``));
    expect(rows).toEqual(t.GERMAN_ROWS);
  });

  it('SENSITIVITY_ROWS — compare(е, ё) и compare(е, Е)', () => {
    for (const r of t.SENSITIVITY_ROWS) {
      const sensitivity = r.s.replaceAll("'", '') as Intl.CollatorOptions['sensitivity'];
      const c = new Intl.Collator('ru', { sensitivity });
      expect(String(c.compare('е', 'ё')), r.s).toBe(r.ee);
      expect(String(c.compare('е', 'Е')), r.s).toBe(r.eE);
    }
    expect(new Intl.Collator('ru').resolvedOptions().sensitivity).toBe('variant');
  });

  it('COLLATOR_OPTIONS — caseFirst и ignorePunctuation как написано', () => {
    expect(['а', 'А', 'б', 'Б'].sort(new Intl.Collator('ru').compare)).toEqual(['а', 'А', 'б', 'Б']);
    expect(['а', 'А', 'б', 'Б'].sort(new Intl.Collator('ru', { caseFirst: 'upper' }).compare)).toEqual(['А', 'а', 'Б', 'б']);
    expect(new Intl.Collator('ru', { ignorePunctuation: true }).compare('по-русски', 'по русски')).toBe(0);
    expect(new Intl.Collator('ru').compare('по-русски', 'по русски')).not.toBe(0);
  });

  it('BYTES_ROWS — байты UTF-8 и единицы UTF-16 у примеров каждого диапазона', () => {
    const enc = new TextEncoder();
    for (const c of t.BYTES_EXAMPLES) {
      const cp = c.codePointAt(0)!;
      const row = t.BYTES_ROWS.find((r) => r.ex.includes(`\`${c}\``))!;
      expect(row, c).toBeDefined();
      expect(String(enc.encode(c).length), c).toBe(row.utf8);
      expect(String(c.length), c).toBe(row.utf16);
      const [lo, hi] = row.range.replaceAll('`', '').split('…').map((x) => parseInt(x.slice(2), 16));
      expect(cp >= lo && cp <= hi, c).toBe(true);
    }
  });
});

describe('множественные формы: факты из текста', () => {
  it('категории языков, диапазоны, порядковые', () => {
    const cats = (l: string, o?: Intl.PluralRulesOptions) => new Intl.PluralRules(l, o).resolvedOptions().pluralCategories;
    expect(cats('ja')).toEqual(['other']);
    expect(cats('en')).toHaveLength(2);
    for (const l of ['ru', 'uk', 'pl']) expect(cats(l)).toEqual(['one', 'few', 'many', 'other']);
    expect(cats('ar')).toHaveLength(6);
    expect(cats('ar')).toContain('zero');
    expect(cats('ru', { type: 'ordinal' })).toEqual(['other']);
    // selectRange есть в Node 24, но не в lib.d.ts проекта.
    const pr = new Intl.PluralRules('ru') as Intl.PluralRules & { selectRange(a: number, b: number): string };
    expect(pr.selectRange(1, 5)).toBe('many');
    expect(pr.selectRange(2, 21)).toBe('one');
    const ord = new Intl.PluralRules('en', { type: 'ordinal' });
    const suf: Record<string, string> = { one: 'st', two: 'nd', few: 'rd', other: 'th' };
    expect([1, 2, 3, 4, 11, 12, 13].map((n) => n + suf[ord.select(n)]).join(' ')).toBe('1st 2nd 3rd 4th 11th 12th 13th');
    expect(new Intl.PluralRules('ru', { minimumFractionDigits: 1 }).select(1)).toBe('other');
  });

  it('формы в PLURAL_FORMS дают верную фразу для образцов демо', () => {
    const want: Record<string, string> = { '1': 'файл', '3': 'файла', '5': 'файлов', '11': 'файлов', '21': 'файл', '112': 'файлов', '1.5': 'файла', '1.0': 'файла', '0': 'файлов' };
    for (const s of t.NUMBER_SAMPLES) expect(t.PLURAL_FORMS[intlPlural(s.value)], s.value).toBe(want[s.value]);
  });
});

describe('PLURAL_CODE против Intl.PluralRules', () => {
  const pr = new Intl.PluralRules('ru');

  it('все целые от −2 000 до 200 000', () => {
    const bad: number[] = [];
    for (let n = -2000; n <= 200_000; n++) if (p.pluralRu(n) !== pr.select(n)) bad.push(n);
    expect(bad).toEqual([]);
  });

  it('дроби с одной–тремя цифрами после точки', () => {
    const bad: number[] = [];
    for (let i = 0; i <= 20_000; i++) {
      for (const d of [1, 2, 3]) {
        const x = Number((i / 10 ** d).toFixed(d));
        if (p.pluralRu(x) !== pr.select(x)) bad.push(x);
      }
    }
    expect(bad).toEqual([]);
  });

  it('запись с нулями после точки: "1.0", "21.00" — как PluralRules с minimumFractionDigits', () => {
    const bad: string[] = [];
    for (let i = 0; i <= 3000; i++) {
      for (const d of [1, 2, 3]) {
        const s = i.toFixed(d);
        if (p.pluralRu(s) !== intlPlural(s)) bad.push(s);
      }
    }
    expect(bad).toEqual([]);
  });

  it('больше трёх цифр после точки — вне модели: PluralRules сначала округляет', () => {
    // Модель берёт запись как есть, ICU — после округления до трёх знаков.
    // Поэтому здесь сверки нет, а сам факт из FILES_NOTE закреплён.
    expect(pr.select(1.0004)).toBe('one');
    expect(pr.select(1.0005)).toBe('other');
    expect(p.pluralRu(1.0004)).toBe('other');
  });

  it('операнды: i и v', () => {
    expect(p.operands('1.0')).toEqual({ i: 1, v: 1 });
    expect(p.operands(-21)).toEqual({ i: 21, v: 0 });
    expect(p.operands(1.25)).toEqual({ i: 1, v: 2 });
  });
});

/** Классы, которые учебное подмножество не покрывает. Списки — из перебора на стенде. */
const PREPEND = /[\u0600-\u0605\u06dd\u070f\u0890\u0891\u08e2\u0d4e\u{110BD}\u{110CD}\u{111C2}\u{111C3}\u{113D1}\u{1193F}\u{11941}\u{11A3A}\u{11A84}-\u{11A89}\u{11D46}\u{11F02}]/u;
const SPACING = /[\p{Mc}\u0e33\u0eb3]/u;
// Класс L/V/T/LV/LVT: хангыль и пять гласных письма кирата-раи (Юникод 16), у которых класс V.
const HANGUL = /[\u1100-\u11ff\ua960-\ua97f\uac00-\ud7a3\ud7b0-\ud7ff\u{16D63}\u{16D67}-\u{16D6A}]/u;
const VIRAMA = /[\u094d\u09cd\u0acd\u0b4d\u0c4d\u0d4d]/u;
const outside = (s: string) => PREPEND.test(s) || SPACING.test(s) || HANGUL.test(s) || VIRAMA.test(s);
const same = (s: string) => JSON.stringify(g.splitGraphemes(s)) === JSON.stringify(icu(s));

describe('GRAPHEME_CODE против Intl.Segmenter', () => {
  it('полный перебор: a + c, c + a, c + c, 😀 + c — расхождения только вне подмножества', () => {
    const bad: string[] = [];
    let compared = 0;
    let outsideMismatch = 0;
    for (let cp = 0; cp <= 0x10ffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const c = String.fromCodePoint(cp);
      for (const s of ['a' + c, c + 'a', c + c, '\u{1F600}' + c]) {
        if (same(s)) continue;
        if (outside(c)) outsideMismatch++;
        else bad.push(cp.toString(16));
      }
      compared++;
    }
    expect(bad).toEqual([]);
    expect(compared).toBe(0x110000 - 0x800);
    // На Node 24.11: SpacingMark 378 × 3 пары, Prepend 28 × 2, хангыль — c + c у чамо и слогов.
    expect(outsideMismatch).toBeGreaterThan(1000);
  }, 300_000);

  it('случайный корпус из «трудных» точек: 100 000 строк', () => {
    const pool = ['a', '\u044f', '\u0438', '\u0306', '\u0301', '\u0308', '\r', '\n', '\t', '\u200d', '\u200c', '\ufe0f', '\u{1F468}', '\u{1F469}', '\u{1F467}', '\u2764', '\u{1F525}', '\u{1F426}', '\u{1F44D}', '\u{1F3FD}', '\u{1F3FB}', '\u{1F1F7}', '\u{1F1FA}', '\u{1F1E9}', '\u{1F1EA}', '\u{1F3F4}', '\u{E0067}', '\u{E007F}', '\u200b', '\u00ad', ' ', '1', '\u20e3', '#', '\u00a9', '\uD83D', '\uDE00', '\u1ad0', '\u{1FAEA}', '\u0915', '\u094d', '\u0937', '\u093f', '\uac01', '\u1100', '\u1161', '\u0600'];
    let seed = 42;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    let compared = 0;
    const bad: string[] = [];
    for (let n = 0; n < 100_000; n++) {
      const len = 1 + Math.floor(rnd() * 8);
      let s = '';
      for (let i = 0; i < len; i++) s += pool[Math.floor(rnd() * pool.length)];
      if (outside(s)) continue;
      compared++;
      if (!same(s)) bad.push([...s].map((c) => c.codePointAt(0)!.toString(16)).join(' '));
    }
    expect(compared).toBeGreaterThan(50_000);
    expect(bad).toEqual([]);
  }, 120_000);

  it('одинокий суррогат ICU склеивает с Extend, как обычный знак — модель так же', () => {
    expect(icu('\uD83D\u0306')).toHaveLength(1);
    expect(g.splitGraphemes('\uD83D\u0306')).toHaveLength(1);
  });

  it('образцы демо: совпадают с ICU везде, кроме заявленной индийской связки', () => {
    for (const s of t.STRING_SAMPLES) {
      if (s.id === 'deva') {
        expect(icu(s.value)).toHaveLength(1);
        expect(g.splitGraphemes(s.value)).toHaveLength(2);
        continue;
      }
      expect(g.splitGraphemes(s.value), s.id).toEqual(icu(s.value));
    }
  });

  it('флаги после slice(2): Швеция и одинокая буква', () => {
    const flags = t.STRING_SAMPLES.find((s) => s.id === 'flags')!.value;
    const cut = t.STRING_SAMPLES.find((s) => s.id === 'flags-cut')!.value;
    expect(flags.slice(2)).toBe(cut);
    expect(icu(cut)).toEqual(['\u{1F1F8}\u{1F1EA}', '\u{1F1F8}']);
  });

  it('образец Юникода 17: в Node 24 — две графемы (в Chromium 153 снята одна)', () => {
    const u17 = t.STRING_SAMPLES.find((s) => s.id === 'u17')!.value;
    expect(icu(u17)).toHaveLength(2);
    expect(t.ICU_ROWS.find((r) => r.k.includes('1AD0'))?.node).toBe('2');
  });

  it('в каждом правиле RULE_NOTES есть подпись, и функция пользуется только ими', () => {
    const used = new Set<string>();
    for (const s of t.STRING_SAMPLES) for (const step of g.graphemeBreaks(s.value).steps) used.add(step.rule);
    for (const r of used) expect(t.RULE_NOTES[r], r).toBeTruthy();
  });
});

describe('ICU_ROWS — сторона Node пересчитывается', () => {
  it('назначенные точки, toUpperCase, эмодзи Юникода 17, порядок коллатора', () => {
    let assigned = 0;
    let upper = 0;
    for (let cp = 0; cp <= 0x10ffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) {
        assigned++; // суррогаты назначены, но String.fromCodePoint дал бы одиночку — считаем явно
        continue;
      }
      const c = String.fromCodePoint(cp);
      if (/\p{Assigned}/u.test(c)) assigned++;
      if (c.toUpperCase() !== c) upper++;
    }
    const num = (s: string) => Number(s.replace(/\D/g, '').slice(0, 6));
    expect(assigned).toBe(294_579);
    expect(num(t.ICU_ROWS[1].node)).toBe(294_579);
    expect(upper).toBe(1552);
    expect(t.ICU_ROWS.find((r) => r.k.includes('toUpperCase'))?.node).toBe('1 552');
    expect(/^\p{RGI_Emoji}$/v.test('\u{1FAEA}')).toBe(false);
    expect(['b', '\u{1FAEA}', 'a'].sort(new Intl.Collator('en').compare).at(-1)).toBe('\u{1FAEA}');
  }, 120_000);
});

describe('утверждения из текста', () => {
  it('UNITS_NOTE: диапазоны суррогатов', () => {
    expect('\u{10000}'.charCodeAt(0)).toBe(0xd800);
    expect('\u{10FFFF}'.charCodeAt(0)).toBe(0xdbff);
    expect('\u{10FFFF}'.charCodeAt(1)).toBe(0xdfff);
    expect('\u{10000}'.charCodeAt(1)).toBe(0xdc00);
  });

  it('BROKEN_NOTE: 13 байт «Привет » и 3 байта знака замены', () => {
    expect(new TextEncoder().encode('Привет ').length).toBe(13);
    expect([...new TextEncoder().encode('\uD83D')]).toEqual([0xef, 0xbf, 0xbd]);
    expect(() => new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array([0xf0, 0x9f, 0x98]))).toThrow(TypeError);
  });

  it('CASE_ROWS: на турецкой локали i → İ', () => {
    expect('file'.toLocaleUpperCase('tr')).toBe('FİLE');
    expect('İ'.toLowerCase()).toHaveLength(2);
  });

  it('CASELESS_NOTE: NFKC + toLowerCase', () => {
    expect('ＡＢＣ'.normalize('NFKC').toLowerCase()).toBe('abc');
  });

  it('SORT_NOTE: номера Ё, А, ё, я', () => {
    expect('Ё'.charCodeAt(0)).toBe(0x401);
    expect('А'.charCodeAt(0)).toBe(0x410);
    expect('ё'.charCodeAt(0)).toBe(0x451);
    expect('ё' > 'я').toBe(true);
  });

  it('PITFALLS: семья — 8 единиц, 🇺🇸🇪🇸.slice(2) — Швеция', () => {
    expect('\u{1F468}‍\u{1F469}‍\u{1F467}'.length).toBe(8);
    expect(icu('\u{1F1FA}\u{1F1F8}\u{1F1EA}\u{1F1F8}'.slice(2))[0]).toBe('\u{1F1F8}\u{1F1EA}');
  });
});
