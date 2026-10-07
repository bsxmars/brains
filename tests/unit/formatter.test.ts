import * as prettier from 'prettier';
import { builders as b, printer } from 'prettier/doc';
import { describe, expect, it } from 'vitest';
import * as t from '@/content/tooling/formatter/data';
import { loadPrinter, outline } from '@/widgets/format-lab/model/run';
import type { Doc, DocCommand } from '@/widgets/format-lab/model/types';

/**
 * Тема «Форматтер изнутри».
 *
 * `PRINTER_CODE` — строка из темы: напечатана на странице и исполняется демо. Здесь она
 * сверяется с настоящим `printDocToString` из `prettier/doc` — на случайных Doc (генератор
 * с seed) на всех ширинах 10…100 и на Doc настоящего кода. Doc примеров (`SNIPPETS`),
 * печать Doc, выводы `prettier.format`, ширины строк и нестабильные случаи пересобираются
 * Prettier из `node_modules`: сменится версия и вывод — покраснеет здесь.
 */

const printDoc = loadPrinter(t.PRINTER_CODE);
/** Отладочный вход Prettier: в типах пакета его нет, в сборке 3.9.6 есть (см. шапку темы). */
const debug = (prettier as unknown as {
  __debug: {
    printToDoc(code: string, opts: prettier.Options): Promise<unknown>;
    formatDoc(doc: unknown, opts: prettier.Options): Promise<string>;
  };
}).__debug;
const OPTS = { printWidth: 80, tabWidth: 2, useTabs: false } as const;
const fmt = (code: string, opts: prettier.Options = {}) => prettier.format(code, { parser: 'babel', ...opts });
/** Вывод без завершающего перевода строки — так он напечатан в теме. */
const fmtTrim = async (code: string, opts: prettier.Options = {}) => (await fmt(code, opts)).replace(/\n$/, '');

/** Doc без символов: id групп — строки, как в `data.ts` (см. шапку темы). */
function toPlain(doc: unknown): Doc {
  const names = new Map<symbol, string>();
  const sym = (s: symbol) => {
    if (!names.has(s)) names.set(s, `${s.description}#${names.size + 1}`);
    return names.get(s);
  };
  return JSON.parse(JSON.stringify(doc, (_k, v) => (typeof v === 'symbol' ? sym(v) : v))) as Doc;
}

/** mulberry32 — воспроизводимый генератор для случайных Doc. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = s;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = ['a', 'id', 'foo', 'item', 'value', 'render', 'callback', '(', ')', '[', ']', '{', '}', ',', ':', '=>', 'x + y', 'items.length', ''];

/**
 * Случайный Doc из настоящих builders. Покрывает всё, что умеет учебный принтер: группы
 * с `shouldBreak` и `id`, `indent`, `align`, три вида переносов, `ifBreak` с `groupId`
 * (в том числе на группу, которая ещё не напечатана), `fill`, `conditionalGroup`, `breakParent`.
 */
function gen(r: () => number, depth: number, ids: symbol[]): unknown {
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const k = depth <= 0 ? 0 : r();
  const kids = () => Array.from({ length: 1 + Math.floor(r() * 4) }, () => gen(r, depth - 1, ids));
  if (k < 0.3) return pick(WORDS);
  if (k < 0.38) return pick([b.line, b.line, b.softline, b.hardline]);
  if (k < 0.55) return kids();
  if (k < 0.7) {
    const opts: { shouldBreak?: boolean; id?: symbol } = {};
    if (r() < 0.1) opts.shouldBreak = true;
    if (r() < 0.3) {
      opts.id = Symbol('g');
      ids.push(opts.id);
    }
    return b.group(kids() as never, opts);
  }
  if (k < 0.78) return b.indent(kids() as never);
  if (k < 0.81) return b.align(1 + Math.floor(r() * 3), kids() as never);
  if (k < 0.87) {
    const opts: { groupId?: symbol } = {};
    if (ids.length && r() < 0.5) opts.groupId = pick(ids);
    if (r() < 0.05) opts.groupId = Symbol('ещё не напечатана');
    return b.ifBreak(gen(r, depth - 1, ids) as never, (r() < 0.5 ? gen(r, depth - 1, ids) : '') as never, opts);
  }
  if (k < 0.93) {
    const n = 1 + Math.floor(r() * 6);
    const parts: unknown[] = [];
    for (let i = 0; i < n; i++) {
      if (i) parts.push(pick([b.line, b.line, b.softline]));
      parts.push(gen(r, depth - 2, ids));
    }
    return b.fill(parts as never);
  }
  if (k < 0.97) return b.conditionalGroup(Array.from({ length: 2 + Math.floor(r() * 2) }, () => kids()) as never);
  return b.breakParent;
}

/** Один и тот же Doc дважды: Prettier дописывает в группы `break: 'propagated'`, пусть пишет в свою копию. */
function twin(seed: number): [unknown, Doc] {
  const real = gen(rng(seed), 6, []);
  const mine = gen(rng(seed), 6, []);
  return [real, mine as Doc];
}

describe('PRINTER_CODE против printDocToString', () => {
  it('случайные Doc: 300 seed × ширины 10…100 — тот же текст', () => {
    let compared = 0;
    let multiline = 0;
    for (let seed = 1; seed <= 300; seed++) {
      for (let w = 10; w <= 100; w++) {
        const [real, mine] = twin(seed);
        const want = printer.printDocToString(real as never, { ...OPTS, printWidth: w }).formatted;
        expect(printDoc(mine, w).text, `seed ${seed}, ширина ${w}`).toBe(want);
        compared++;
        if (want.includes('\n')) multiline++;
      }
    }
    expect(compared).toBe(300 * 91);
    // Генератор не вырожден: заметная доля выводов многострочная, но не все.
    expect(multiline / compared).toBeGreaterThan(0.2);
    expect(multiline / compared).toBeLessThan(0.95);
  });

  it('hardline в плоской группе заставляет мерить следующую группу заново', () => {
    const mk = () => b.group(['ab', b.line, b.group(['x', b.hardline, 'y']), b.group(['ccc', b.line, 'ddd'])]);
    for (let w = 3; w <= 12; w++) {
      expect(printDoc(mk() as Doc, w).text).toBe(printer.printDocToString(mk(), { ...OPTS, printWidth: w }).formatted);
    }
  });

  it('ifBreak с groupId группы, которая ещё не напечатана, не печатает ничего', () => {
    const id = Symbol('later');
    const mk = () => [b.ifBreak('BREAK', 'FLAT', { groupId: id }), b.group(['a', b.line, 'b'], { id })];
    expect(printer.printDocToString(mk(), OPTS).formatted).toBe('a b');
    expect(printDoc(mk() as Doc, 80).text).toBe('a b');
  });

  it('то, чего учебный принтер не умеет, — ошибка, а не молчаливая неправда', () => {
    expect(() => printDoc(b.lineSuffix(' // c') as Doc, 80)).toThrow(/line-suffix/);
    expect(() => printDoc(b.dedent(['a', b.hardline, 'b']) as Doc, 80)).toThrow(/align/);
  });
});

describe('Doc настоящего кода', () => {
  it('SNIPPETS: Doc в теме = printToDoc сейчас', async () => {
    for (const s of t.SNIPPETS) {
      const doc = toPlain(await debug.printToDoc(s.code, { parser: 'babel' }));
      expect(s.doc, s.id).toEqual(doc);
    }
  });

  it('SNIPPETS: учебный принтер на их Doc = prettier.format на всех ширинах 10…100', async () => {
    for (const s of t.SNIPPETS) {
      for (let w = 10; w <= 100; w++) {
        const want = await fmt(s.code, { printWidth: w });
        expect(printDoc(structuredClone(s.doc), w).text, `${s.id}, ширина ${w}`).toBe(want);
      }
    }
  });

  it('DOC_NEST_PRINT — то, что печатает formatDoc', async () => {
    const doc = await debug.printToDoc(t.NEST_CODE, { parser: 'babel' });
    expect((await debug.formatDoc(doc, {})).trimEnd()).toBe(t.DOC_NEST_PRINT);
  });

  it('BUILD_CODE: Doc руками печатается так, как написано', () => {
    const body = t.BUILD_CODE.replace(/^import .*$/m, '');
    const run = new Function('builders', 'printer', `${body}\nreturn { at80, at20 };`) as (
      bb: typeof b,
      p: typeof printer,
    ) => { at80: string; at20: string };
    const { at80, at20 } = run(b, printer);
    expect(at80).toBe(t.BUILD_OUT_80);
    expect(at20).toBe(t.BUILD_OUT_20);
  });

  it('объект с переносом после { получает в Doc группу с break: true', () => {
    const obj = t.SNIPPETS.find((s) => s.id === 'obj')!;
    expect(JSON.stringify(obj.doc)).toContain('"break":true');
    const others = t.SNIPPETS.filter((s) => s.id !== 'obj' && s.id !== 'call');
    for (const s of others) expect(JSON.stringify(s.doc), s.id).not.toContain('"break":true');
  });

  it('у «последнего аргумента» два conditionalGroup по три варианта; на 63 второй у .then, на 40 — и у fetchUser', () => {
    const call = t.SNIPPETS.find((s) => s.id === 'call')!;
    const at = (w: number) => {
      const r = printDoc(structuredClone(call.doc), w);
      const conds = [...r.decisions].filter(([g]) => g.expandedStates);
      expect(conds).toHaveLength(2);
      for (const [g] of conds) expect(g.expandedStates).toHaveLength(3);
      const fetch = conds.find(([g]) => JSON.stringify(g.contents).includes('"userId"'))!;
      const then = conds.find(([g]) => g !== fetch[0])!;
      return { text: r.text, fetch: fetch[1], then: then[1] };
    };
    const a = at(call.start);
    expect(call.start).toBe(63);
    expect(a.then).toEqual({ mode: 'flat', state: 1 });
    expect(a.fetch).toEqual({ mode: 'flat', state: 0 });
    expect(a.text).toBe('fetchUser(userId, { retries: 3, timeout: 5000 }).then((user) =>\n  render(user),\n);\n');
    const b40 = at(40);
    expect(b40.fetch).toEqual({ mode: 'flat', state: 1 });
    expect(b40.text.startsWith('fetchUser(userId, {\n')).toBe(true);
    expect(call.note).toContain('Сузьте до 40');
  });
});

describe('сквозной пример: снаружи внутрь', () => {
  it('OUTER_ROWS: число сломанных групп и строк — учебный принтер и prettier.format', async () => {
    for (const row of t.OUTER_ROWS) {
      const r = printDoc(structuredClone(t.SNIPPETS[0].doc), row.w);
      const broken = [...r.decisions.values()].filter((d) => d.mode === 'break').length;
      expect(broken, `ширина ${row.w}`).toBe(row.groups);
      const out = await fmt(t.NEST_CODE, { printWidth: row.w });
      expect(out.split('\n').length - 1, `ширина ${row.w}`).toBe(row.lines);
    }
    // Сломанные группы — именно названные: внешний вызов, потом массив, потом format(…).
    expect(await fmtTrim(t.NEST_CODE, { printWidth: 79 })).toBe(t.OUTER_79);
    expect(await fmt(t.NEST_CODE, { printWidth: 38 })).toContain('  [\n    order.items.length,');
    expect(await fmt(t.NEST_CODE, { printWidth: 38 })).toContain('  format(order.id, order.total),');
    expect(await fmt(t.NEST_CODE, { printWidth: 31 })).toContain('  format(\n    order.id,');
    // И это границы: на ширину больше раскладка как у предыдущей строки таблицы.
    expect(await fmt(t.NEST_CODE, { printWidth: 39 })).toBe(`${t.OUTER_79}\n`);
    expect(await fmt(t.NEST_CODE, { printWidth: 32 })).toBe(await fmt(t.NEST_CODE, { printWidth: 38 }));
  });

  it('пример ровно 80 символов вместе с «;» — FITS_NOTE и подпись примера', async () => {
    expect(t.NEST_CODE).toHaveLength(80);
    expect(t.NEST_CODE.endsWith(');')).toBe(true);
    expect(await fmtTrim(t.NEST_CODE)).toBe(t.NEST_CODE);
    expect(t.FITS_NOTE).toContain('длиной 79 символов плюс `;`');
  });

  it('BREAK_PARENT: перенос во внутреннем объекте раскрывает внешний', async () => {
    expect(await fmtTrim(t.NESTED_IN)).toBe(t.NESTED_OUT);
  });

  it('BREAK_PARENT_NOTE и тонкое место 04: что раскрывается обязательным переносом', async () => {
    // Метод с телом раскрывает объект на любой ширине.
    for (const w of [80, 100, 200]) {
      expect(await fmtTrim('const o = { f() { return 1; } };', { printWidth: w })).toBe('const o = {\n  f() {\n    return 1;\n  },\n};');
    }
    expect(t.BREAK_PARENT_NOTE).toContain('`{ f() { return 1; } }`');
    expect(t.PITFALLS[3].d).toContain('на пять строк');
    // Функцию-аргумент спасает conditionalGroup вызова.
    expect(await fmtTrim('foo(x, () => { a(); });')).toBe('foo(x, () => {\n  a();\n});');
    // Шаблонная строка с переносом и комментарий // раскрывают вызов вокруг.
    expect(await fmtTrim('foo(`a\nb`, c);')).toBe('foo(\n  `a\nb`,\n  c,\n);');
    expect(await fmtTrim('foo(a, // c\n b);')).toBe('foo(\n  a, // c\n  b,\n);');
  });
});

describe('ширина', () => {
  it('LONG_CODE: строку длиннее printWidth Prettier переносит, но не режет', async () => {
    const out = await fmtTrim(t.SNIPPETS.find((s) => s.id === 'long')!.code, { printWidth: 40 });
    expect(`// printWidth: 40\n${out}`).toBe(t.LONG_CODE);
    expect(Math.max(...out.split('\n').map((l) => l.length))).toBe(73);
    expect(t.PITFALLS[0].d).toContain('73 символами');
    // Подпись примера: «на ширине меньше 87».
    expect((await fmt(t.SNIPPETS.find((s) => s.id === 'long')!.code, { printWidth: 87 })).split('\n')).toHaveLength(2);
    expect((await fmt(t.SNIPPETS.find((s) => s.id === 'long')!.code, { printWidth: 86 })).split('\n')).toHaveLength(3);
  });

  it('WIDTH_ROWS: length, кодовые точки и getStringWidth', () => {
    for (const row of t.WIDTH_ROWS) {
      const s = row.s.startsWith('`é`') ? 'é' : row.s.slice(1, -1);
      expect(s.length, row.s).toBe(row.len);
      expect([...s].length, row.s).toBe(row.points);
      expect(prettier.util.getStringWidth(s), row.s).toBe(row.width);
    }
    // WIDTH_NOTE: «узкие» эмодзи — 1; основной блок комбинирующих знаков — 0.
    expect(prettier.util.getStringWidth('©')).toBe(1);
    expect(prettier.util.getStringWidth('\u0301')).toBe(0);
    expect(prettier.util.getStringWidth('\u1AB0')).toBe(1); // вне U+0300–U+036F уже не ноль
  });

  it('THRESHOLD_ROWS: с какой ширины вызов печатается в строку', async () => {
    for (const row of t.THRESHOLD_ROWS) {
      const code = `log(first, ${row.s.slice(1, -1)});`;
      const oneLine = async (w: number) => !(await fmt(code, { printWidth: w })).trimEnd().includes('\n');
      expect(await oneLine(row.at), row.s).toBe(true);
      expect(await oneLine(row.at - 1), row.s).toBe(false);
    }
  });
});

describe('что остаётся от исходника', () => {
  it('кавычки и скобки — KEEP_CODE', async () => {
    expect(await fmtTrim(t.KEEP_CODE_IN)).toBe(t.KEEP_CODE_OUT);
  });

  it('пустые строки: не больше одной подряд, в начале и в конце блока — нет', async () => {
    expect(await fmt('function f() {\n\n\n  a();\n\n\n\n  b();\n\n}\n\n\n')).toBe('function f() {\n  a();\n\n  b();\n}\n');
  });

  it('перенос после { держит только объект, а не деструктуризацию, массив и импорт', async () => {
    expect(await fmtTrim('const {\n m, n } = obj;')).toBe('const { m, n } = obj;');
    expect(await fmtTrim('const [p, q] = [\n1, 2];')).toBe('const [p, q] = [1, 2];');
    expect(await fmtTrim('import {\n x as xx } from "m";')).toBe('import { x as xx } from "m";');
    expect(await fmtTrim('const o = {\n x: 1 };')).toBe('const o = {\n  x: 1,\n};');
  });

  it('«залипание»: раскрытый из-за длины объект остаётся раскрытым', async () => {
    expect(t.STICKY_IN).toHaveLength(83);
    const first = await fmtTrim(t.STICKY_IN);
    expect(first).toBe(t.STICKY_OUT);
    const edited = first.replace('  lastSeen: lastSeenDate,\n', '');
    expect(await fmtTrim(edited)).toBe(t.STICKY_EDITED_OUT);
    expect(await fmtTrim('const user = { name: "Анна", role: "admin", active: true };')).toBe(t.STICKY_FRESH_OUT);
    expect(await fmtTrim(edited, { objectWrap: 'collapse' })).toBe(t.STICKY_FRESH_OUT);
  });

  it('LINT_ROWS: Prettier снимает скобки, которых требует no-mixed-operators', async () => {
    expect(await fmtTrim('z = (a * b) + c;')).toBe('z = a * b + c;');
  });
});

describe('идемпотентность', () => {
  it('все примеры темы: второй прогон не меняет ни символа', async () => {
    const inputs = [...t.SNIPPETS.map((s) => s.code), t.KEEP_CODE_IN, t.STICKY_IN, t.NESTED_IN];
    for (const code of inputs) {
      for (const w of [20, 40, 80]) {
        const once = await fmt(code, { printWidth: w });
        expect(await fmt(once, { printWidth: w }), code).toBe(once);
      }
    }
  });

  it('switch + комментарий: стабилен только со второго прогона', async () => {
    const p1 = await fmt(t.UNSTABLE_IN);
    const p2 = await fmt(p1);
    const p3 = await fmt(p2);
    expect(p1.trimEnd()).toBe(t.UNSTABLE_PASS1);
    expect(p2.trimEnd()).toBe(t.UNSTABLE_PASS2);
    expect(p3).toBe(p2);
  });

  it('export + комментарий + декоратор: пустых строк 0, 1, 2, дальше стоит', async () => {
    let s = t.DECORATOR_ROWS[0].text.slice(1, -1);
    const blanks: number[] = [];
    for (let i = 0; i < 4; i++) {
      s = await fmt(s);
      blanks.push(s.split('\n').filter((l) => l === '').length - 0);
    }
    // Последняя пустая «строка» в split — завершающий \n файла, вычитаем её.
    expect(blanks.map((n) => n - 1)).toEqual([0, 1, 2, 2]);
    expect(t.DECORATOR_ROWS.slice(1).map((r) => r.blank)).toEqual(['0', '1', '2']);
  });
});

describe('демо', () => {
  it('дерево Doc показывает решение у каждой группы, которую печатал принтер', () => {
    for (const s of t.SNIPPETS) {
      for (const w of [10, s.start, 100]) {
        const doc = structuredClone(s.doc);
        const r = printDoc(doc, w);
        const rows = outline(doc, r.decisions);
        const groups = rows.filter((x) => x.kind === 'group' || x.kind === 'conditionalGroup');
        expect(groups.length, s.id).toBeGreaterThan(0);
        for (const g of groups) expect(g.mode, `${s.id} ${w}`).toBeDefined();
      }
    }
  });

  it('ширины при открытии лежат в диапазоне ползунка', () => {
    for (const s of t.SNIPPETS) {
      expect(s.start).toBeGreaterThanOrEqual(10);
      expect(s.start).toBeLessThanOrEqual(100);
    }
  });

  it('decisions — по объектам того Doc, что передан', () => {
    const doc = structuredClone(t.SNIPPETS[0].doc);
    const r = printDoc(doc, 40);
    const keys = [...r.decisions.keys()] as DocCommand[];
    expect(keys.every((g) => g.type === 'group')).toBe(true);
  });
});
