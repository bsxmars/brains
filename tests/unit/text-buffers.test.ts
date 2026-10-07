import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { TextDocument } from 'vscode-languageserver-textdocument';
import * as t from '@/content/algorithms/text-buffers/data';
import { KINDS, lineStarts, loadAll, makeDoc, measure, measureAll, playAll, playDemo, rng } from '@/widgets/textbuf-lab/model/run';
import type { BufApi, Counted, RopeTree } from '@/widgets/textbuf-lab/model/types';

/**
 * Тема «Как редактор хранит текст: строка, gap buffer, rope и piece table».
 *
 * Строки `STRING_CODE`, `GAP_CODE`, `ROPE_CODE`, `PIECE_CODE` напечатаны на странице и исполняются
 * демо через `widgets/textbuf-lab/model/run.ts`. Здесь:
 *   — строковая модель как оракул: тысячи случайных последовательностей правок, тексты всех
 *     моделей совпадают со строкой, начала строк — с `split('\n')`, rope сбалансирован,
 *     снимки piece table возвращают старые тексты;
 *   — настоящие реализации: `TextDocument` (одна строка + начала строк) и `Y.Text` из Yjs
 *     (список кусков); V8 — отдельным процессом с `--allow-natives-syntax`;
 *   — счётчики работы растут так, как сказано в тексте, и все числа темы пересчитываются.
 */

const apis = loadAll({ string: t.STRING_CODE, gap: t.GAP_CODE, rope: t.ROPE_CODE, piece: t.PIECE_CODE });

/** Число так, как оно набрано в тексте темы: группы через пробел, дробь через запятую. */
const ru = (x: number) => x.toLocaleString('ru-RU', { maximumFractionDigits: 1 }).replace(/\s/g, ' ');

/** Высота поддерева или -1, если нарушен баланс или сводка узла не сходится с детьми. */
function ropeHeight(n: RopeTree): number {
  if (n.h === 0 || !('left' in n)) return 0;
  const hl = ropeHeight(n.left);
  const hr = ropeHeight(n.right);
  if (hl < 0 || hr < 0 || Math.abs(hl - hr) > 1 || n.h !== Math.max(hl, hr) + 1) return -1;
  if (n.len !== n.left.len + n.right.len || n.lines !== n.left.lines + n.right.lines) return -1;
  return n.h;
}

// ─── Оракул ────────────────────────────────────────────────────────────────────────────────

describe('четыре модели против строки и split', () => {
  it('3000 случайных последовательностей по 40 правок: текст, начала строк, баланс rope, отмена', () => {
    const alphabet = 'ab\nцд';
    let checked = 0;
    const bad: string[] = [];
    for (let seed = 1; seed <= 3000; seed++) {
      const r = rng(seed);
      const ri = (n: number) => Math.floor(r() * n);
      let model = '';
      for (let i = ri(40); i > 0; i--) model += alphabet[ri(alphabet.length)];
      const bufs: [BufApi, Counted][] = [
        [apis.string, apis.string.create(model)],
        [apis.gap as BufApi, apis.gap.create(model, ri(4))],
        [apis.rope as BufApi, apis.rope.create(model, 2 + ri(8))],
        [apis.piece as BufApi, apis.piece.create(model)],
      ];
      const piece = bufs[3][1] as ReturnType<typeof apis.piece.create>;
      const snaps: [ReturnType<typeof apis.piece.snapshot>, string][] = [];
      for (let step = 0; step < 40; step++) {
        if (model.length && r() < 0.4) {
          const pos = ri(model.length);
          const len = 1 + ri(Math.min(model.length - pos, 12));
          model = model.slice(0, pos) + model.slice(pos + len);
          for (const [api, b] of bufs) api.remove(b, pos, len);
        } else {
          const pos = ri(model.length + 1);
          let s = '';
          for (let i = 1 + ri(r() < 0.1 ? 60 : 4); i > 0; i--) s += alphabet[ri(alphabet.length)];
          model = model.slice(0, pos) + s + model.slice(pos);
          for (const [api, b] of bufs) api.insert(b, pos, s);
        }
        snaps.push([apis.piece.snapshot(piece), model]);
        const starts = lineStarts(model);
        bufs.forEach(([api, b], i) => {
          if (api.text(b) !== model) bad.push(`${KINDS[i]} текст, зерно ${seed}, шаг ${step}`);
          if (starts.some((x, k) => api.lineStart(b, k) !== x)) bad.push(`${KINDS[i]} строки, зерно ${seed}, шаг ${step}`);
        });
        if (ropeHeight((bufs[2][1] as ReturnType<typeof apis.rope.create>).root) < 0) bad.push(`баланс rope, зерно ${seed}`);
        checked++;
      }
      for (const [snap, m] of snaps) {
        apis.piece.restore(piece, snap);
        if (apis.piece.text(piece) !== m) bad.push(`отмена, зерно ${seed}`);
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
    expect(checked).toBe(120000);
  });
});

// ─── Настоящие реализации ──────────────────────────────────────────────────────────────────

describe('TextDocument: одна строка и массив начал строк', () => {
  it('те же случайные правки дают тот же текст и те же начала строк', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const r = rng(seed);
      const ri = (n: number) => Math.floor(r() * n);
      let model = 'строка\nещё\n'.repeat(1 + ri(5));
      const doc = TextDocument.create('file:///a.txt', 'plaintext', 0, model);
      const b = apis.string.create(model);
      for (let step = 0; step < 30; step++) {
        const pos = ri(model.length + 1);
        const len = r() < 0.4 ? ri(Math.min(5, model.length - pos) + 1) : 0;
        const ins = len ? '' : ['ж', '\n', 'а\nб'][ri(3)];
        TextDocument.update(doc, [{ range: { start: doc.positionAt(pos), end: doc.positionAt(pos + len) }, text: ins }], step + 1);
        if (len) apis.string.remove(b, pos, len);
        else apis.string.insert(b, pos, ins);
        model = model.slice(0, pos) + ins + model.slice(pos + len);
        expect(doc.getText()).toBe(model);
        expect(apis.string.text(b)).toBe(model);
        const starts = lineStarts(model);
        expect(starts.map((_, k) => doc.offsetAt({ line: k, character: 0 }))).toEqual(starts);
        expect(starts.map((_, k) => apis.string.lineStart(b, k))).toEqual(starts);
      }
    }
  });

  it('правка в первой строке сдвигает начала всех строк ниже', () => {
    const doc = TextDocument.create('file:///a.txt', 'plaintext', 0, 'а\n'.repeat(1000));
    const before = [...(doc as unknown as { getLineOffsets(): number[] }).getLineOffsets()];
    TextDocument.update(doc, [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: 'ж' }], 1);
    const after = (doc as unknown as { getLineOffsets(): number[] }).getLineOffsets();
    expect(after[0]).toBe(0);
    expect(after.slice(1).every((x, i) => x === before[i + 1] + 1)).toBe(true);
    expect(after.length).toBe(1001);
  });
});

describe('Yjs: Y.Text — тоже список кусков', () => {
  const liveItems = (text: Y.Text) => {
    const out: string[] = [];
    let all = 0;
    for (let n = text._start; n; n = n.right as typeof n) {
      all++;
      if (!n.deleted) out.push((n.content as Y.ContentString).str);
    }
    return { out, all };
  };

  it('вставка в середину режет кусок, печать подряд его удлиняет, удалённое остаётся надгробием', () => {
    const d = new Y.Doc();
    d.clientID = 1;
    const y = d.getText('t');
    const p = apis.piece.create('кот и пёс');
    y.insert(0, 'кот и пёс');
    y.insert(3, 'ик');
    apis.piece.insert(p, 3, 'ик');
    expect(liveItems(y).out).toEqual(['кот', 'ик', ' и пёс']);
    expect(p.pieces.map((x) => p[x.buf].slice(x.start, x.start + x.len))).toEqual(['кот', 'ик', ' и пёс']);
    y.insert(5, '!');
    apis.piece.insert(p, 5, '!');
    expect(liveItems(y).out).toEqual(['кот', 'ик!', ' и пёс']);
    expect(p.pieces).toHaveLength(3);
    y.delete(0, 1);
    apis.piece.remove(p, 0, 1);
    expect(liveItems(y)).toEqual({ out: ['от', 'ик!', ' и пёс'], all: 4 });
    expect(p.pieces).toHaveLength(3);
  });

  it('CRDT_LINK: 495 из 500 — число живых кусков Yjs равно числу кусков piece table', () => {
    let same = 0;
    for (let seed = 1; seed <= 500; seed++) {
      const r = rng(seed);
      const ri = (n: number) => Math.floor(r() * n);
      const base = 'строка\n'.repeat(1 + ri(20));
      const d = new Y.Doc();
      d.clientID = 1;
      const y = d.getText('t');
      y.insert(0, base);
      const p = apis.piece.create(base);
      let len = base.length;
      for (let i = 0; i < 60; i++) {
        if (len && r() < 0.4) {
          const pos = ri(len);
          const l = 1 + ri(Math.min(5, len - pos));
          y.delete(pos, l);
          apis.piece.remove(p, pos, l);
          len -= l;
        } else {
          const pos = ri(len + 1);
          const s = 'жуз'.slice(0, 1 + ri(3));
          y.insert(pos, s);
          apis.piece.insert(p, pos, s);
          len += s.length;
        }
      }
      expect(y.toString()).toBe(apis.piece.text(p));
      const live = liveItems(y).out.length;
      expect(Math.abs(live - p.pieces.length)).toBeLessThanOrEqual(1);
      if (live === p.pieces.length) same++;
    }
    expect(same).toBe(495);
    expect(t.CRDT_LINK).toContain('в 495 случаях');
    expect(t.CRDT_LINK).toContain('На 500 случайных последовательностях по 60 правок');
  });
});

describe('V8: вставка в середину откладывает копию на один шаг', () => {
  it('V8_CODE в отдельном процессе печатает V8_OUT, как в комментариях', () => {
    const out = execFileSync(process.execPath, ['--allow-natives-syntax', '-e', t.V8_CODE], { encoding: 'utf8' });
    expect(out.trim().split('\n')).toEqual(t.V8_OUT);
    const comments = [...t.V8_CODE.matchAll(/console\.log\(.*?\);\s+\/\/ (\w+)/g)].map((m) => m[1]);
    expect(comments).toEqual(t.V8_OUT);
    expect(t.V8_NOTE).toContain('все 100');
  });
});

// ─── Счётчики и числа темы ─────────────────────────────────────────────────────────────────

describe('счётчики работы', () => {
  it('SCALE пересчитывается той же measure', () => {
    for (const key of Object.keys(t.SCALE)) {
      const [scen, n] = key.split('/');
      expect(measureAll(apis, Number(n), scen as never)).toEqual(t.SCALE[key]);
    }
    expect(Object.keys(t.SCALE)).toHaveLength(t.SCENARIOS.length * t.SIZES.length);
  });

  it('строка: каждая правка переписывает весь документ — O(n)', () => {
    for (const n of t.SIZES) {
      expect(t.SCALE[`type/${n}`].string.first).toBe(n + 1);
      expect(t.SCALE[`scatter/${n}`].string.copied).toBeCloseTo(n + 0.5, 5);
    }
    expect(t.STRING_NOTE).toContain('100 001');
  });

  it('gap buffer: у курсора один символ, прыжок — расстояние, вразброс — около трети документа', () => {
    for (const n of t.SIZES) {
      expect(t.SCALE[`type/${n}`].gap.copied).toBe(1);
      expect(t.SCALE[`type/${n}`].gap.first).toBe(n / 2 + 1);
      const third = t.SCALE[`scatter/${n}`].gap.copied / n;
      expect(third).toBeGreaterThan(0.3);
      expect(third).toBeLessThan(0.37);
    }
    expect(t.GAP_FACTS.map((f) => f.d).join(' ')).toContain('50 001');
  });

  it('gap buffer: рост вдвое — амортизированно константа (GAP_GROW)', () => {
    const g = t.GAP_GROW;
    const b = apis.gap.create(makeDoc(g.doc));
    const at = g.doc / 2;
    apis.gap.insert(b, at, 'ж');
    const cells0 = b.a.length;
    b.copied = 0;
    let grows = 0;
    for (let i = 1; i <= g.typed; i++) {
      const L = b.a.length;
      apis.gap.insert(b, at + i, 'ж');
      if (b.a.length !== L) grows++;
    }
    expect([cells0, b.a.length]).toEqual(g.cells);
    expect(grows).toBe(g.grows);
    expect(b.copied).toBe(g.copied);
    expect(b.copied / g.typed).toBeLessThan(3);
    for (const x of [g.copied, g.typed, g.copied - g.typed, ...g.cells]) expect(t.GAP_GROW_NOTE).toContain(ru(x));
    expect(t.GAP_GROW_NOTE).toContain(`${ru(g.copied / g.typed)} символа`);
    expect(t.GAP_GROW_NOTE).toContain(`Дырка росла ${g.grows} раза`);
  });

  it('rope: путь растёт как log n, копируется не больше листа', () => {
    for (const n of t.SIZES) {
      const s = t.SCALE[`scatter/${n}`].rope;
      const h = s.h ?? 0;
      expect(h).toBeLessThanOrEqual(Math.ceil(1.45 * Math.log2(n / 64 + 2)) + 1);
      expect(s.visited).toBeLessThanOrEqual(2 * h + 2);
      expect(s.copied).toBeLessThanOrEqual(64);
      expect(t.SCALE[`lines/${n}`].rope.visited).toBeLessThanOrEqual(h + 1);
    }
    const v = t.SIZES.map((n) => t.SCALE[`scatter/${n}`].rope.visited);
    expect(t.GROWTH_NOTE).toContain(`с ${Math.round(v[0])} до ${Math.round(v[2])} узлов`);
  });

  it('rope: размер листа (ROPE_LEAF)', () => {
    for (const row of t.ROPE_LEAF) {
      const s = measure(apis.rope as BufApi, 100000, 'scatter', row.leaf);
      const l = measure(apis.rope as BufApi, 100000, 'lines', row.leaf);
      expect({ leaf: row.leaf, copied: s.copied, visited: s.visited, line: l.visited, h: s.h }).toEqual(row);
      expect(s.copied).toBeLessThanOrEqual(row.leaf);
    }
  });

  it('piece table: переписывается только новый текст, поиск идёт по кускам', () => {
    for (const n of t.SIZES) {
      expect(t.SCALE[`paste/${n}`].piece.copied).toBe(10000);
      expect(t.SCALE[`type/${n}`].piece.copied).toBe(1);
      expect(t.SCALE[`type/${n}`].piece.pieces).toBe(3);
      expect(t.SCALE[`scatter/${n}`].piece.copied).toBe(0.5);
      expect(t.SCALE[`lines/${n}`].piece.visited).toBeLessThanOrEqual(t.SCALE[`lines/${n}`].piece.pieces ?? 0);
    }
    const last = t.SCALE['lines/100000'].piece;
    expect(t.PIECE_NOTE).toContain(`кусков ${last.pieces}`);
    expect(t.PIECE_NOTE).toContain(`в среднем ${Math.round(last.visited)} из них`);
  });

  it('таблицы темы собраны из SCALE', () => {
    expect(t.COST_ROWS).toHaveLength(4);
    expect(t.COST_ROWS[0][1].replace(/\s/g, ' ')).toBe('100 001');
    expect(t.GROWTH_ROWS[0][1].replace(/\s/g, ' ')).toBe('1 000,5 → 10 000,5 → 100 000,5');
  });
});

describe('сквозной пример демо', () => {
  it('все четыре модели дают один текст и одно начало строки на каждом шаге', () => {
    let model = t.DEMO.base;
    const steps = playAll(apis, t.DEMO);
    t.DEMO.steps.forEach((step, i) => {
      if (step.op === 'ins') model = model.slice(0, step.pos) + step.str + model.slice(step.pos);
      if (step.op === 'del') model = model.slice(0, step.pos) + model.slice(step.pos + step.len);
      expect(steps[i].texts).toEqual(KINDS.map(() => model));
      if (step.op === 'line') expect(steps[i].found).toEqual(KINDS.map(() => lineStarts(model)[step.line]));
    });
  });

  it('DEMO_CAPTION: печать подряд — один символ у gap buffer и тот же кусок у piece table; прыжок в конец растит дырку', () => {
    const s = playDemo(apis, t.DEMO);
    expect(s).toHaveLength(t.DEMO.steps.length + 1);
    expect(s[2].cost.gap.copied).toBe(1);
    expect(s[2].piece.pieces).toHaveLength(s[1].piece.pieces.length);
    expect(s[3].gap.start).toBe(0);
    expect(s[4].gap.cells.length).toBeGreaterThan(s[3].gap.cells.length);
    expect(s[5].cost.rope.visited).toBeLessThan(s[5].cost.string.visited);
    expect(s[5].cost.piece.visited).toBeLessThan(s[5].cost.gap.visited);
    expect(s[5].found).toBe(13);
    // ячейки дырки — без «дыр» массива: демо печатает каждую
    for (const x of s) expect(Array.from(x.gap.cells).every((c) => c === null || typeof c === 'string')).toBe(true);
    expect(s[1].gap.cells.filter((c) => c === null).length + s[1].gap.cells.filter((c) => c !== null).length).toBe(13);
  });
});
