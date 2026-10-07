import { createServer, type Server } from 'node:http';
import { isDeepStrictEqual } from 'node:util';
import { applyPatches, enablePatches, produce, produceWithPatches } from 'immer';
import { type Browser, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as t from '@/content/algorithms/undo-redo/data';
import { loadEditor, play, playNative } from '@/widgets/undo-lab/model/run';
import type { DemoStep, FieldState, NativeAct } from '@/widgets/undo-lab/model/types';

/**
 * Тема «Отмена и повтор: undo/redo изнутри».
 *
 * `OPS_CODE`, `XFORM_CODE`, `HISTORY_CODE` и `PATCH_CODE` — строки из темы: напечатаны на
 * странице и исполняются демо. Здесь они сверяются с настоящими реализациями: `PATCH_CODE` —
 * с `produceWithPatches` Immer, история над строкой — с `Y.UndoManager` на двух клиентах
 * и с историей `<textarea>` в Chromium. Литералы стенда (`NATIVE_RUNS`, `NATIVE_FACTS`,
 * `YJS_OUT`, `SHARING_OUT`…) снимаются заново и сверяются как есть.
 *
 * Часы Yjs. `lib0/time` запоминает `Date.now` при загрузке модуля (`getUnixTime = Date.now`),
 * поэтому подменить часы после `import 'yjs'` нельзя. Тест подменяет `Date.now` своей функцией,
 * грузит `yjs` динамическим `import()` и сразу возвращает настоящие часы — у `lib0` остаётся
 * подменённая функция, и группировка `captureTimeout` идёт по виртуальному времени. Если `yjs`
 * в процессе уже был загружен кем-то раньше, это поймает первая же проверка `YJS_OUT`
 * (две записи вместо одной).
 */

enablePatches();
const createEditor = loadEditor(t.OPS_CODE, t.XFORM_CODE, t.HISTORY_CODE);

let fakeNow = 1_000;
const realNow = Date.now;
Date.now = () => fakeNow;
const Y = await import('yjs');
Date.now = realNow;

/** ЛКГ стенда: s = (s·1103515245 + 12345) mod 2³¹. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

// ─── Учебная история на виртуальном времени ─────────────────────────────────────────────────

describe('HISTORY_CODE: стопки, снимки, группировка', () => {
  it('STACK_ROWS: две стопки и очистка redo новой правкой', () => {
    const ed = createEditor();
    let now = 0;
    for (const row of t.STACK_ROWS) {
      now = play(ed, row.steps, now);
      expect({ text: ed.text, undo: ed.undoStack.length, redo: ed.redoStack.length }).toEqual({
        text: row.text,
        undo: row.undo,
        redo: row.redo,
      });
    }
  });

  it('SNAP_COST: снимки хранят весь текст, правки — по символу', () => {
    const steps: DemoStep[] = Array.from({ length: t.SNAP_COST.entries }, () => [
      { do: 'type' as const, s: ' слов' },
      { do: 'wait' as const, ms: 1000 },
    ]).flat();
    const base = 'а'.repeat(t.SNAP_COST.base);
    const snaps = createEditor({ text: base, mode: 'snapshots' });
    const ops = createEditor({ text: base, mode: 'ops' });
    play(snaps, steps);
    play(ops, steps);
    expect(snaps.text).toBe(ops.text);
    expect(snaps.undoStack.length).toBe(t.SNAP_COST.entries);
    expect(ops.undoStack.length).toBe(t.SNAP_COST.entries);
    expect(snaps.undoStack.reduce((s, e) => s + (e.text?.length ?? 0), 0)).toBe(t.SNAP_COST.snapChars);
    expect(ops.undoStack.reduce((s, e) => s + e.ops.length, 0)).toBe(t.SNAP_COST.ops);
    // Отмена до конца в обоих режимах возвращает исходный текст.
    while (snaps.undo());
    while (ops.undo());
    expect(snaps.text).toBe(base);
    expect(ops.text).toBe(base);
  });

  it('снимки и правки дают одно и то же на случайных локальных сценариях', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const r = rng(seed);
      const ri = (n: number) => Math.floor(r() * n);
      const a = createEditor({ mode: 'ops', timeout: 500 });
      const b = createEditor({ mode: 'snapshots', timeout: 500 });
      let now = 0;
      for (let i = 0; i < 60; i++) {
        now += ri(800);
        const x = r();
        const ch = 'abcxyz'[ri(6)];
        const pos = ri(a.text.length + 1);
        for (const ed of [a, b]) {
          if (x < 0.45) ed.insert(ch, now);
          else if (x < 0.6) ed.backspace(now);
          else if (x < 0.7) ed.select(pos);
          else if (x < 0.85) ed.undo();
          else ed.redo();
        }
        expect([a.text, a.sel, a.undoStack.length, a.redoStack.length]).toEqual([b.text, b.sel, b.undoStack.length, b.redoStack.length]);
      }
    }
  });

  it('обратные правки с начала, а не с конца, ломают текст — HISTORY_FACTS', () => {
    const ed = createEditor();
    play(ed, [{ do: 'type', s: 'кот' }]);
    const inverse = ed.undoStack[0].ops;
    expect(inverse.map((o) => o?.pos)).toEqual([2, 1, 0]);
    const apply = new Function(`${t.OPS_CODE}\nreturn apply;`)() as (s: string, o: unknown) => string;
    expect([...inverse].reverse().reduce(apply, 'кот')).not.toBe('');
    expect(inverse.reduce(apply, 'кот')).toBe('');
  });

  it('COLLAB_ROWS: снимки, наивные правки и пересчёт при вставке Бориса', () => {
    const modes = ['snapshots', 'naive', 'ops'] as const;
    modes.forEach((mode, i) => {
      const ed = createEditor({ mode });
      play(ed, [{ do: 'type', s: 'Привет' }, { do: 'wait', ms: 600 }, { do: 'type', s: ', мир' }]);
      [...'Борис: '].forEach((ch, k) => ed.remote({ type: 'ins', pos: k, ch }));
      expect(ed.text).toBe('Борис: Привет, мир');
      ed.undo();
      const u1 = ed.text;
      ed.undo();
      const u2 = ed.text;
      ed.redo();
      const row = t.COLLAB_ROWS[i];
      expect({ u1, u2, r: ed.text }).toEqual({ u1: row.u1, u2: row.u2, r: row.r });
    });
    const yjs = t.YJS_OUT.split('\n').map((l) => l.split(' | ')[0]);
    const row = t.COLLAB_ROWS[3];
    expect([row.u1, row.u2, row.r]).toEqual([yjs[1], yjs[2], yjs[3]]);
  });

  it('DEMO_START набирает то же, что Аня в разделе «Совместно»', () => {
    const ed = createEditor();
    play(ed, t.DEMO_START);
    expect(ed.text).toBe('Привет, мир');
    expect(ed.undoStack.length).toBe(2);
  });
});

// ─── Immer ──────────────────────────────────────────────────────────────────────────────────

describe('Immer 11: структурное разделение и патчи', () => {
  it('SHARING_CODE с настоящим produce печатает SHARING_OUT', () => {
    const out: string[] = [];
    new Function('produce', 'console', t.SHARING_CODE)(produce, { log: (...a: unknown[]) => out.push(a.join(' ')) });
    expect(out).toEqual([t.SHARING_OUT]);
  });

  it('IMMER_SPLICE: splice(0, 1) — замена и удаление хвоста', () => {
    const base = { todos: [{ id: 1, text: 'молоко' }, { id: 2, text: 'хлеб' }] };
    const [next, patches, inverse] = produceWithPatches(base, (d) => {
      d.todos.splice(0, 1);
    });
    expect({ patches, inverse }).toEqual(t.IMMER_SPLICE);
    expect(applyPatches(next, inverse)).toEqual(base);
  });

  type Kind = 'set' | 'remove' | 'push';
  type Path = (string | number)[];
  interface ObjOp {
    kind: Kind;
    path: Path;
    value?: unknown;
  }
  const update = new Function(`${t.PATCH_CODE}\nreturn update;`)() as (s: unknown, op: ObjOp) => [unknown, unknown[], unknown[]];

  function objects(o: unknown, seen = new Set<object>()): Set<object> {
    if (o && typeof o === 'object' && !seen.has(o)) {
      seen.add(o);
      for (const v of Object.values(o)) objects(v, seen);
    }
    return seen;
  }
  const shared = (a: unknown, b: unknown) => {
    const old = objects(a);
    return [...objects(b)].filter((o) => old.has(o)).length;
  };

  /** Случайная правка: спуститься по дереву и выбрать, что сделать с узлом. */
  function randomOp(state: unknown, r: () => number): ObjOp | null {
    const ri = (n: number) => Math.floor(r() * n);
    const path: Path = [];
    let node = state as Record<string, unknown>;
    for (;;) {
      const keys = Object.keys(node);
      const inner = keys.filter((k) => node[k] && typeof node[k] === 'object');
      if (!inner.length || r() < 0.35) break;
      const k = inner[ri(inner.length)];
      path.push(Array.isArray(node) ? Number(k) : k);
      node = node[k] as Record<string, unknown>;
    }
    const value = r() < 0.3 ? { v: ri(100) } : r() < 0.5 ? ri(100) : 's' + ri(10);
    const x = r();
    if (Array.isArray(node)) {
      if (path.length && x < 0.4) return { kind: 'push', path, value };
      if (node.length && x < 0.7) return { kind: 'remove', path: [...path, node.length - 1] };
      if (node.length) return { kind: 'set', path: [...path, ri(node.length)], value };
      return path.length ? { kind: 'push', path, value } : null;
    }
    const keys = Object.keys(node);
    if (keys.length && x < 0.25) return { kind: 'remove', path: [...path, keys[ri(keys.length)]] };
    if (x < 0.4) return { kind: 'set', path: [...path, 'k' + ri(5)], value: r() < 0.5 ? value : [] };
    if (keys.length) return { kind: 'set', path: [...path, keys[ri(keys.length)]], value };
    return { kind: 'set', path: [...path, 'k' + ri(5)], value };
  }

  /** Та же правка рецептом Immer. */
  const recipe =
    ({ kind, path, value }: ObjOp) =>
    (draft: unknown) => {
      let n = draft as Record<string | number, unknown>;
      for (const k of path.slice(0, -1)) n = n[k] as Record<string | number, unknown>;
      const key = path[path.length - 1];
      if (kind === 'push') (n[key] as unknown[]).push(value);
      else if (kind === 'remove') {
        if (Array.isArray(n)) n.splice(key as number, 1);
        else delete n[key];
      } else n[key] = value;
    };

  it('PATCH_CODE против produceWithPatches на случайных правках — PATCH_MATCH', () => {
    let ops = 0;
    let same = 0;
    for (let seed = 1; seed <= t.PATCH_MATCH.seeds; seed++) {
      const r = rng(seed);
      const base = { title: 'Список', todos: [{ text: 'молоко', done: false }], meta: { owner: 'Аня', tags: ['дом'] } };
      let mine: unknown = base;
      let theirs: unknown = base;
      const inverses: unknown[][] = [];
      for (let i = 0; i < 40; i++) {
        const op = randomOp(mine, r);
        if (!op) continue;
        ops++;
        const [n1, p1, i1] = update(mine, op);
        const [n2, p2, i2] = produceWithPatches(theirs, recipe(op));
        if (isDeepStrictEqual([n1, p1, i1], [n2, p2, i2]) && shared(mine, n1) === shared(theirs, n2)) same++;
        else expect({ seed, i, op, p1, i1 }).toEqual({ seed, i, op, p1: p2, i1: i2 });
        inverses.push(i1);
        mine = n1;
        theirs = n2;
      }
      let back = theirs;
      for (const inv of inverses.reverse()) back = applyPatches(back as object, inv as never);
      expect(back).toEqual(base);
    }
    expect({ seeds: t.PATCH_MATCH.seeds, ops, same }).toEqual(t.PATCH_MATCH);
  });
});

// ─── Yjs ────────────────────────────────────────────────────────────────────────────────────

describe('Y.UndoManager 13.6 на подменённых часах', () => {
  const wait = (ms: number) => {
    fakeNow += ms;
  };

  it('YJS_CODE печатает YJS_OUT', () => {
    const out: string[] = [];
    new Function('Y', 'wait', 'console', t.YJS_CODE)(Y, wait, { log: (...a: unknown[]) => out.push(a.join(' ')) });
    expect(out.join('\n')).toBe(t.YJS_OUT);
  });

  it('YJS_FACTS: транзакции сливаются, stopCapturing делит, null — своё, чужое не чистит redo', () => {
    const doc = new Y.Doc();
    const text = doc.getText('t');
    const um = new Y.UndoManager(text, { trackedOrigins: new Set(['me']), captureTimeout: 500 });
    doc.transact(() => text.insert(0, 'a'), 'me');
    wait(100);
    doc.transact(() => text.insert(1, 'b'), 'me');
    expect(um.undoStack.length).toBe(1);
    um.stopCapturing();
    doc.transact(() => text.insert(2, 'c'), 'me');
    expect(um.undoStack.length).toBe(2);

    um.undo();
    expect(um.redoStack.length).toBe(1);
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
    other.getText('t').insert(0, 'X');
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(other, Y.encodeStateVector(doc)), 'bob');
    expect(um.redoStack.length).toBe(1);
    um.redo();
    expect(text.toString()).toBe('Xabc');

    // Без trackedOrigins своё — это null, а applyUpdate без пометки — тоже null.
    wait(1000);
    const d2 = new Y.Doc();
    const t2 = d2.getText('t');
    const um2 = new Y.UndoManager(t2);
    t2.insert(0, 'abc');
    wait(1000);
    const o2 = new Y.Doc();
    o2.getText('t').insert(0, 'XYZ');
    Y.applyUpdate(d2, Y.encodeStateAsUpdate(o2));
    expect(um2.undoStack.length).toBe(2);
    um2.undo();
    expect(t2.toString()).toBe('abc');
  });

  it('HISTORY_CODE против Y.UndoManager на случайных сценариях двух клиентов — YJS_MATCH', () => {
    let same = 0;
    for (let seed = 1; seed <= t.YJS_MATCH.runs; seed++) {
      const r = rng(seed);
      const ri = (n: number) => Math.floor(r() * n);
      const a = new Y.Doc();
      a.clientID = 1;
      const b = new Y.Doc();
      b.clientID = 2;
      const ta = a.getText('t');
      const tb = b.getText('t');
      const um = new Y.UndoManager(ta, { trackedOrigins: new Set(['local']), captureTimeout: 500 });
      const ed = createEditor({ timeout: 500 });
      const push = () => Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)), 'remote');
      const pull = () => Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)), 'remote');
      // Группы у Yjs режет только время, у учебной истории — ещё вид правки и место.
      // Поэтому каретка прыгает и вид меняется только после паузы длиннее captureTimeout.
      let lastKind: string | null = null;
      let ok = true;
      for (let s = 0; s < t.YJS_MATCH.actions && ok; s++) {
        const x = r();
        if (x < 0.4) {
          let pos = ed.sel[0];
          if (lastKind !== 'ins' || r() < 0.2) {
            wait(600);
            pos = ri(ta.length + 1);
            ed.select(pos);
          }
          wait(50 + ri(300));
          const ch = 'ABCDEFGH'[ri(8)];
          a.transact(() => ta.insert(pos, ch), 'local');
          ed.insert(ch, fakeNow);
          lastKind = 'ins';
        } else if (x < 0.55) {
          if (!ta.length) continue;
          let pos = ed.sel[0];
          if (lastKind !== 'del' || pos === 0 || r() < 0.2) {
            wait(600);
            pos = 1 + ri(ta.length);
            ed.select(pos);
          }
          wait(50 + ri(300));
          a.transact(() => ta.delete(pos - 1, 1), 'local');
          ed.backspace(fakeNow);
          lastKind = 'del';
        } else if (x < 0.8) {
          push();
          wait(ri(300));
          if (r() < 0.6 || !tb.length) {
            const pos = ri(tb.length + 1);
            const ch = 'xyz'[ri(3)];
            b.transact(() => tb.insert(pos, ch));
            ed.remote({ type: 'ins', pos, ch });
          } else {
            const pos = ri(tb.length);
            const ch = tb.toString()[pos];
            b.transact(() => tb.delete(pos, 1));
            ed.remote({ type: 'del', pos, ch });
          }
          pull();
        } else if (x < 0.92) {
          um.undo();
          ed.undo();
          lastKind = null;
          wait(600);
        } else {
          um.redo();
          ed.redo();
          lastKind = null;
          wait(600);
        }
        if (ta.toString() !== ed.text) ok = false;
      }
      if (ok) same++;
    }
    expect({ runs: t.YJS_MATCH.runs, actions: t.YJS_MATCH.actions, same }).toEqual(t.YJS_MATCH);
  }, 60_000);
});

// ─── Chromium ───────────────────────────────────────────────────────────────────────────────

const PORT = 5083;
const PAGE = `<!doctype html><meta charset="utf-8"><textarea id="t"></textarea><textarea id="u"></textarea><div id="ce" contenteditable></div>
<script>
window.log = [];
for (const id of ['t', 'u', 'ce']) {
  const el = document.getElementById(id);
  el.addEventListener('beforeinput', (e) => log.push('beforeinput:' + e.inputType));
  el.addEventListener('input', (e) => log.push('input:' + e.inputType));
  el.addEventListener('keydown', (e) => { if (e.key === 'z') log.push('keydown'); });
}
</script>`;

let server: Server;
let browser: Browser;
let page: Page;
const URL_ = `http://127.0.0.1:${PORT}/`;
const UNDO = 'ControlOrMeta+z';
const REDO = 'ControlOrMeta+Shift+z';

async function fresh(id = 't') {
  await page.goto(URL_);
  await page.focus('#' + id);
}
const value = (id = 't') =>
  page.evaluate((id) => {
    const el = document.getElementById(id) as HTMLTextAreaElement | HTMLDivElement;
    return 'value' in el ? el.value : el.innerText;
  }, id);
async function undos(n: number, id = 't') {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    await page.keyboard.press(UNDO);
    out.push(await value(id));
  }
  return out;
}

/** Сценарий в Chromium — тем же способом, что на стенде (`c3.mjs`). */
async function inChromium(acts: NativeAct[]): Promise<FieldState[]> {
  await fresh();
  const out: FieldState[] = [];
  for (const a of acts) {
    if (a[0] === 'type') await page.keyboard.type(a[1]);
    else if (a[0] === 'key') await page.keyboard.press(a[1]);
    else if (a[0] === 'wait') await page.waitForTimeout(a[1]);
    else if (a[0] === 'select') {
      const [, s, e] = a;
      await page.evaluate(([s, e]) => (document.getElementById('t') as HTMLTextAreaElement).setSelectionRange(s, e), [s, e]);
    } else {
      await page.keyboard.press(a[0] === 'undo' ? UNDO : REDO);
      out.push(
        await page.evaluate(() => {
          const f = document.getElementById('t') as HTMLTextAreaElement;
          return [f.value, f.selectionStart, f.selectionEnd] as FieldState;
        }),
      );
    }
  }
  return out;
}

describe('история <textarea> в Chromium против учебной модели', () => {
  beforeAll(async () => {
    server = createServer((_q, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(PAGE);
    });
    await new Promise<void>((ok) => server.listen(PORT, '127.0.0.1', () => ok()));
    browser = await chromium.launch();
    page = await browser.newPage();
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await new Promise((ok) => server?.close(ok));
  });

  it('модель (timeout: Infinity) — столбец model в NATIVE_RUNS', () => {
    for (const run of t.NATIVE_RUNS) {
      expect({ id: run.id, model: playNative(createEditor({ timeout: Infinity }), run.acts) }).toEqual({ id: run.id, model: run.model });
      // Где модель и Chromium расходятся — сценарий помечен и объяснён.
      expect(isDeepStrictEqual(run.model, run.chrome)).toBe(run.tone !== 'warn');
    }
  });

  it('Chromium — столбец chrome в NATIVE_RUNS', async () => {
    for (const run of t.NATIVE_RUNS) {
      expect({ id: run.id, chrome: await inChromium(run.acts) }).toEqual({ id: run.id, chrome: run.chrome });
    }
  }, 60_000);

  it('NATIVE_FACTS: общая история, предел, пустая история, setRangeText, contenteditable', async () => {
    const f = t.NATIVE_FACTS;

    await fresh();
    await page.keyboard.type('aa');
    await page.focus('#u');
    await page.keyboard.type('bb');
    await page.focus('#t');
    await page.keyboard.press(UNDO);
    expect({ first: await value('t'), second: await value('u'), focus: await page.evaluate(() => document.activeElement?.id) }).toEqual(f.shared);
    await page.keyboard.press(UNDO);
    expect({ first: await value('t'), second: await value('u'), focus: await page.evaluate(() => document.activeElement?.id) }).toEqual(f.sharedAgain);

    await fresh();
    const depth = await page.evaluate(() => {
      const ta = document.getElementById('t') as HTMLTextAreaElement;
      for (let i = 0; i < 1200; i++) {
        ta.setSelectionRange(ta.value.length, ta.value.length);
        document.execCommand('insertText', false, 'x');
      }
      let undone = 0;
      while (ta.value.length) {
        const before = ta.value.length;
        document.execCommand('undo');
        if (ta.value.length === before) break;
        undone++;
      }
      return { undone, left: ta.value.length };
    });
    expect(depth).toEqual(f.depth);

    await fresh();
    await page.evaluate(() => {
      (document.getElementById('t') as HTMLTextAreaElement).value = 'preset';
      (window as unknown as { log: string[] }).log = [];
    });
    await page.keyboard.press(UNDO);
    expect({ value: await value(), events: await page.evaluate(() => (window as unknown as { log: string[] }).log) }).toEqual(f.emptyHistory);

    await fresh('u');
    await page.keyboard.type('aa');
    await page.focus('#t');
    await page.keyboard.type('bb');
    await page.evaluate(() => ((document.getElementById('t') as HTMLTextAreaElement).value = 'XYZ'));
    await page.focus('#u');
    const dead: [string, string, string][] = [];
    for (let i = 0; i < 2; i++) {
      await page.keyboard.press(UNDO);
      dead.push([await value('t'), await value('u'), (await page.evaluate(() => document.activeElement?.id)) ?? '']);
    }
    expect(dead).toEqual(f.deadStep);

    await fresh();
    await page.keyboard.type('ab');
    await page.evaluate(() => (document.getElementById('t') as HTMLTextAreaElement).setRangeText('Q', 2, 2, 'end'));
    await page.keyboard.type('cd');
    expect(await undos(3)).toEqual(f.setRange);

    const ce: Record<string, string[]> = {};
    await fresh('ce');
    await page.keyboard.type('hello world');
    ce.run = await undos(2, 'ce');
    await fresh('ce');
    await page.keyboard.type('abc');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.type('X');
    ce.arrow = await undos(2, 'ce');
    await fresh('ce');
    await page.keyboard.type('abc');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    ce.backspaces = await undos(2, 'ce');
    await fresh('ce');
    await page.keyboard.type('ab');
    await page.keyboard.press('Enter');
    await page.keyboard.type('cd');
    ce.enter = await undos(2, 'ce');
    expect(ce).toEqual(f.ce);
    // В textarea — те же тексты, что у contenteditable.
    const byId = Object.fromEntries(t.NATIVE_RUNS.map((r) => [r.id, r.chrome.map((s) => s[0])]));
    expect({ run: byId.run, arrow: byId.arrow, backspaces: byId.backspaces, enter: byId.enter }).toEqual(f.ce);
  }, 60_000);

  it('INTERCEPT_CODE со своей историей в Chromium — INTERCEPT_RUN', async () => {
    await page.setContent('<textarea id="f"></textarea>');
    await page.addScriptTag({
      content: `${t.OPS_CODE}\n${t.XFORM_CODE}\n${t.HISTORY_CODE}\n${t.INTERCEPT_CODE}\nattachHistory(document.getElementById('f'), createEditor({ timeout: 500 }));`,
    });
    await page.focus('#f');
    await page.keyboard.type('При');
    await page.waitForTimeout(700);
    await page.keyboard.type('вет');
    const v = () => page.$eval('#f', (el) => (el as HTMLTextAreaElement).value);
    expect(await v()).toBe('Привет');
    const out: string[] = [];
    await page.keyboard.press(UNDO);
    out.push(await v());
    await page.keyboard.press(UNDO);
    out.push(await v());
    await page.keyboard.press(REDO);
    out.push(await v());
    expect(out).toEqual(t.INTERCEPT_RUN);
  }, 30_000);
});
