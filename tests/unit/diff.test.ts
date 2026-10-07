import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diffArrays, diffChars } from 'diff';
import { Window } from 'happy-dom';
import { afterAll, describe, expect, it } from 'vitest';
import * as t from '@/content/algorithms/diff/data';
import { frontier, loadLis, loadMyers, loadReactMoves, loadVueMoves, scriptPath } from '@/widgets/diff-lab/model/run';

/**
 * Тема «Diff: как git и фреймворки находят разницу».
 *
 * Строки из темы (`MYERS_CODE`, `LCS_CODE`, `LIS_CODE`, `VUE_MOVES_CODE`, `REACT_MOVES_CODE`)
 * напечатаны на странице и исполняются демо через `widgets/diff-lab/model/run.ts`. Здесь они
 * сверяются с эталонами: Майерс — с jsdiff (число правок **и сам скрипт**), LIS — с `getSequence`,
 * вырезанной из исходника Vue, перемещения — с настоящими Vue 3.5 и React 19.3 в happy-dom.
 * Литералы стенда (вывод git, таблица, фронт по шагам, счёт операций) пересобираются.
 */

// ─── DOM: до загрузки Vue ──────────────────────────────────────────────────────────────────

const win = new Window({ url: 'http://localhost/' });
const GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Text', 'Comment', 'DocumentFragment', 'Event', 'MouseEvent', 'SVGElement'] as const;
const saved = new Map<string, PropertyDescriptor | undefined>();
for (const key of GLOBALS) {
  saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  const value = key === 'window' ? win : (win as unknown as Record<string, unknown>)[key];
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}
afterAll(async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  for (const [key, desc] of saved) {
    if (desc) Object.defineProperty(globalThis, key, desc);
    else delete (globalThis as Record<string, unknown>)[key];
  }
});
const doc = win.document as unknown as Document;

/** Вызовы вставки на `<ul>`: ключ узла, имя метода и был ли узел уже в списке. */
interface DomCall {
  op: string;
  key: string;
  move: boolean;
}
let calls: DomCall[] | null = null;
const NodeProto = (win as unknown as { Node: { prototype: Record<string, unknown> } }).Node.prototype;
for (const name of ['insertBefore', 'appendChild']) {
  const orig = NodeProto[name] as (this: Node, ...args: unknown[]) => unknown;
  NodeProto[name] = function (this: Element, child: Node, ref?: Node | null) {
    if (calls && this.tagName === 'UL') calls.push({ op: name, key: child.textContent ?? '', move: child.parentNode === this });
    return orig.call(this, child, ref);
  };
}

const vue = await import('vue');
const require = createRequire(import.meta.url);
const React = require('react') as typeof import('react');
const { createRoot } = require('react-dom/client') as typeof import('react-dom/client');
const { flushSync } = require('react-dom') as typeof import('react-dom');

async function runVue(from: string[], to: string[]): Promise<{ calls: DomCall[]; text: string }> {
  const el = doc.createElement('div');
  const items = vue.shallowRef(from);
  const app = vue.createApp({ render: () => vue.h('ul', items.value.map((k) => vue.h('li', { key: k }, k))) });
  app.mount(el as unknown as Element);
  calls = [];
  items.value = to;
  await vue.nextTick();
  const out = { calls, text: el.textContent ?? '' };
  calls = null;
  app.unmount();
  return out;
}

function runReact(from: string[], to: string[]): { calls: DomCall[]; text: string } {
  const el = doc.createElement('div');
  const root = createRoot(el as unknown as Element);
  const List = (p: { items: string[] }) => React.createElement('ul', null, p.items.map((k) => React.createElement('li', { key: k }, k)));
  flushSync(() => root.render(React.createElement(List, { items: from })));
  calls = [];
  flushSync(() => root.render(React.createElement(List, { items: to })));
  const out = { calls, text: el.textContent ?? '' };
  calls = null;
  root.unmount();
  return out;
}

const movedOf = (c: DomCall[]) => c.filter((x) => x.move).map((x) => x.key).join('');
const mountedOf = (c: DomCall[]) => c.filter((x) => !x.move).map((x) => x.key).join('');

// ─── Функции темы ──────────────────────────────────────────────────────────────────────────

const myers = loadMyers(t.MYERS_CODE);
const lis = loadLis(t.LIS_CODE);
const vueMoves = loadVueMoves(t.LIS_CODE, t.VUE_MOVES_CODE);
const reactMoves = loadReactMoves(t.REACT_MOVES_CODE);
const lcsTable = new Function(`${t.LCS_CODE}\nreturn lcsTable;`)() as (a: unknown[], b: unknown[]) => number[][];

/** ГПСЧ Лемера — тот же, что на стенде: случайные пары воспроизводимы. */
function rng(seed: number) {
  let s = seed;
  return () => (s = (s * 48271) % 2147483647) / 2147483647;
}
function shuffle<T>(arr: T[], r: () => number): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
const opsOf = (script: [string, unknown][]) => script.map((s) => s[0]).join('');
const isSubsequence = (sub: string, s: string) => {
  let i = 0;
  for (const ch of s) if (ch === sub[i]) i++;
  return i === sub.length;
};

// ─── Майерс ────────────────────────────────────────────────────────────────────────────────

describe('MYERS_CODE: кратчайший скрипт правок', () => {
  it('сквозной пример: D = 5, скрипт как в SCRIPT_PRINT, оставлено CABA', () => {
    const r = myers([...t.PAIR_A], [...t.PAIR_B]);
    expect(r.d).toBe(5);
    const printed = r.script.map(([op, v]) => (op === '=' ? ` ${String(v)}` : `${op === '-' ? '−' : '+'}${String(v)}`)).join(' ');
    expect(t.SCRIPT_PRINT).toContain(`скрипт: ${printed}`);
    expect(r.script.filter(([op]) => op === '=').map(([, v]) => v).join('')).toBe('CABA');
    expect(t.SCRIPT_PRINT).toContain('оставлено: C A B A — 4 элемента');
    // «и другие скрипты длины 5 — оставить B A B A»: BABA — тоже общая подпоследовательность длины 4.
    expect(isSubsequence('BABA', t.PAIR_A) && isSubsequence('BABA', t.PAIR_B)).toBe(true);
  });

  it('совпадает с jsdiff на случайных парах — и по D, и по самому скрипту', () => {
    const r = rng(11);
    for (let it = 0; it < 1500; it++) {
      const al = 'ABCD'.slice(0, 2 + Math.floor(r() * 3));
      const a = Array.from({ length: Math.floor(r() * 15) }, () => al[Math.floor(r() * al.length)]);
      const b = Array.from({ length: Math.floor(r() * 15) }, () => al[Math.floor(r() * al.length)]);
      const mine = myers(a, b);
      const ref = diffArrays(a, b);
      const refOps = ref.map((c) => (c.added ? '+' : c.removed ? '-' : '=').repeat(c.count ?? c.value.length)).join('');
      expect(opsOf(mine.script), `${a.join('')} → ${b.join('')}`).toBe(refOps);
      const L = lcsTable(a, b)[a.length][b.length];
      expect(mine.d).toBe(a.length + b.length - 2 * L);

      // Скрипт действительно превращает a в b.
      let x = 0;
      let y = 0;
      for (const [op, v] of mine.script) {
        if (op !== '+') expect(a[x++]).toBe(v);
        if (op !== '-') expect(b[y++]).toBe(v);
      }
      expect([x, y]).toEqual([a.length, b.length]);
      // «Удаления всегда раньше вставок».
      expect(opsOf(mine.script)).not.toContain('+-');
    }
  });

  it('пары демо: D совпадает с diffChars', () => {
    for (const p of t.DEMO_PAIRS) {
      const ref = diffChars(p.a, p.b).reduce((s, c) => s + (c.added || c.removed ? c.value.length : 0), 0);
      expect(myers([...p.a], [...p.b]).d, p.id).toBe(ref);
    }
  });

  it('путь скрипта кончается в (n, m)', () => {
    const r = myers([...t.PAIR_A], [...t.PAIR_B]);
    expect(scriptPath(r).at(-1)).toEqual([7, 6]);
  });

  it('LCS_TABLE_PRINT — это lcsTable сквозного примера', () => {
    const a = [...t.PAIR_A];
    const b = [...t.PAIR_B];
    const tab = lcsTable(a, b);
    const head = '      ' + b.join('  ');
    const rows = tab.map((row, i) => `${i ? a[i - 1] : ' '}  ${row.join('  ')}`);
    expect([head, ...rows].join('\n')).toBe(t.LCS_TABLE_PRINT);
    expect(tab[7][6]).toBe(4);
  });

  it('V_ROWS — фронт по шагам из trace', () => {
    const r = myers([...t.PAIR_A], [...t.PAIR_B]);
    const minus = (k: number) => (k < 0 ? `−${-k}` : String(k));
    const rows = Array.from({ length: r.d + 1 }, (_, d) => [
      String(d),
      frontier(r, d, 7, 6)
        .map((p) => `k = ${minus(p.k)}: ${p.inside ? `(${p.x}, ${p.y})` : 'за краем'}`)
        .join(' · '),
    ]);
    expect(rows).toEqual(t.V_ROWS);
  });

  it('COST: таблица против числа чтений Майерса на runtime-core Vue', () => {
    expect((require('vue/package.json') as { version: string }).version).toBe('3.5.42');
    const a = readFileSync(require.resolve(t.COST.file), 'utf8').split('\n');
    const b = a.slice();
    b[1000] = '// changed';
    b.splice(3000, 1);
    b.splice(5000, 0, '// inserted');
    let reads = 0;
    const count = (arr: string[]) =>
      new Proxy(arr, {
        get(target, p, recv) {
          if (typeof p === 'string' && /^\d+$/.test(p)) reads++;
          return Reflect.get(target, p, recv) as unknown;
        },
      });
    const r = myers(count(a), count(b));
    expect(a.length).toBe(t.COST.lines);
    expect(r.d).toBe(t.COST.d);
    expect(reads).toBe(t.COST.reads);
    expect(a.length * b.length).toBe(t.COST.cells);
    expect(t.COST_ROWS[0].v).toBe('79 014 321 клетка');
    expect(t.COST_ROWS[1].v).toBe('26 689 чтений');
  });
});

// ─── git ───────────────────────────────────────────────────────────────────────────────────

describe('git diff на фикстуре', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'diff-topic-')));
  writeFileSync(join(dir, 'a.js'), t.GIT_OLD);
  writeFileSync(join(dir, 'b.js'), t.GIT_NEW);
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  const git = (...args: string[]) => spawnSync('git', ['diff', '--no-index', '--no-color', ...args, 'a.js', 'b.js'], { cwd: dir, env, encoding: 'utf8' }).stdout;
  const body = (out: string) => out.slice(out.indexOf('@@')).replace(/\n$/, '');

  it('git 2.44 на стенде', () => {
    expect(spawnSync('git', ['--version'], { encoding: 'utf8' }).stdout).toContain('git version 2.44');
  });

  it('myers и minimal — GIT_MYERS, patience и histogram — GIT_PATIENCE', () => {
    expect(body(git('--diff-algorithm=myers'))).toBe(t.GIT_MYERS);
    expect(body(git('--diff-algorithm=minimal'))).toBe(t.GIT_MYERS);
    expect(body(git('--diff-algorithm=patience'))).toBe(t.GIT_PATIENCE);
    expect(body(git('--diff-algorithm=histogram'))).toBe(t.GIT_PATIENCE);
  });

  it('числа строк в GIT_ROWS — из --numstat', () => {
    for (const row of t.GIT_ROWS) {
      const alg = /`(\w+)`/.exec(row.k)![1];
      const [plus, minus] = git('--numstat', `--diff-algorithm=${alg}`).split('\t');
      expect(row.v, alg).toBe(`${minus} − / ${plus} +`);
    }
  });

  it('myers темы на строках даёт то же, что git myers: D = 14', () => {
    const lines = (s: string) => s.replace(/\n$/, '').split('\n');
    const r = myers(lines(t.GIT_OLD), lines(t.GIT_NEW));
    expect(r.d).toBe(14);
    const asGit = r.script.map(([op, v]) => `${op === '=' ? ' ' : op}${String(v)}`).join('\n');
    expect(asGit).toBe(t.GIT_MYERS.split('\n').slice(1).join('\n'));
    // patience: 9 + 9 = 18
    expect(t.GIT_PATIENCE.split('\n').filter((l) => /^[-+]/.test(l))).toHaveLength(18);
  });

  it('UNIQUE_LINES — строки, что встречаются по разу в каждом файле', () => {
    const count = (s: string) => {
      const m = new Map<string, number>();
      for (const l of s.replace(/\n$/, '').split('\n')) m.set(l, (m.get(l) ?? 0) + 1);
      return m;
    };
    const ca = count(t.GIT_OLD);
    const cb = count(t.GIT_NEW);
    const unique = t.GIT_NEW.replace(/\n$/, '').split('\n').filter((l) => ca.get(l) === 1 && cb.get(l) === 1);
    expect(unique).toEqual(t.UNIQUE_LINES);
    // Номера в старом файле (с единицы) в порядке нового — 9, 10, 14, 8; LIS выбрасывает пустую.
    const oldLines = t.GIT_OLD.split('\n');
    const pos = unique.map((l) => oldLines.indexOf(l) + 1);
    expect(pos).toEqual([9, 10, 14, 8]);
    expect(lis(pos).map((i) => unique[i])).toEqual(t.ANCHORS);
    expect(t.PATIENCE_STEPS[1].d).toContain('9, 10, 14, 8');
  });
});

// ─── LIS ───────────────────────────────────────────────────────────────────────────────────

describe('LIS_CODE против getSequence из исходника Vue', () => {
  const src = readFileSync(require.resolve('@vue/runtime-core/dist/runtime-core.cjs.js'), 'utf8');
  const fn = /function getSequence\(arr\) \{[\s\S]*?\n\}\n/.exec(src)![0];
  const getSequence = new Function(`${fn}return getSequence;`)() as (arr: number[]) => number[];

  it('на перестановках 1…n — те же индексы', () => {
    const r = rng(5);
    for (let it = 0; it < 1500; it++) {
      const n = 1 + Math.floor(r() * 20);
      const arr = shuffle(Array.from({ length: n }, (_, i) => i + 1), r);
      expect(lis(arr), arr.join(',')).toEqual(getSequence(arr));
    }
  });

  it('цепочка возрастает и не короче перебора на малых массивах', () => {
    const r = rng(9);
    for (let it = 0; it < 300; it++) {
      const arr = Array.from({ length: Math.floor(r() * 9) }, () => Math.floor(r() * 6));
      const seq = lis(arr);
      for (let i = 1; i < seq.length; i++) expect(arr[seq[i]]).toBeGreaterThan(arr[seq[i - 1]]);
      let best = 0;
      for (let mask = 0; mask < 1 << arr.length; mask++) {
        const pick = arr.filter((_, i) => mask & (1 << i));
        if (pick.every((v, i) => i === 0 || v > pick[i - 1])) best = Math.max(best, pick.length);
      }
      expect(seq.length).toBe(best);
    }
  });

  it('тонкое место: нули в LIS — `ABC → BCXA` даёт лишнюю перестановку', () => {
    // [2, 3, 0, 1]: B, C, X (новый), A. С нулём LIS берёт [0, 1] — X и A.
    expect(lis([2, 3, 0, 1]).map((i) => [2, 3, 0, 1][i])).toEqual([0, 1]);
    expect(vueMoves([...'ABC'], [...'BCXA'])).toEqual({ moved: ['A'], mounted: ['X'] });
    expect(t.PITFALLS.find((p) => p.n === '05')!.d).toContain('`[2, 3, 0, 1]`');
  });
});

// ─── Перемещения: настоящие Vue и React ────────────────────────────────────────────────────

describe('перемещения: vueMoves и reactMoves против Vue 3.5 и React 19.3', () => {
  it('версии на стенде', () => {
    expect(vue.version).toBe('3.5.42');
    expect(React.version).toBe('19.3.0');
  });

  it('MOVE_SCENARIOS: те же узлы и в том же порядке', async () => {
    for (const s of t.MOVE_SCENARIOS) {
      const from = [...s.from];
      const to = [...s.to];
      const v = await runVue(from, to);
      const r = runReact(from, to);
      expect(v.text).toBe(s.to);
      expect(r.text).toBe(s.to);
      expect(movedOf(v.calls), `Vue ${s.id}`).toBe(s.vue);
      expect(movedOf(r.calls), `React ${s.id}`).toBe(s.react);
      expect(vueMoves(from, to).moved.join('')).toBe(s.vue);
      expect(reactMoves(from, to).moved.join('')).toBe(s.react);
      // «Vue всегда вызывает insertBefore».
      expect(v.calls.every((c) => c.op === 'insertBefore')).toBe(true);
    }
    // «A…E уезжают в конец через appendChild».
    const r = runReact([...'ABCDEF'], [...'FABCDE']);
    expect(r.calls.map((c) => c.op)).toEqual(Array(5).fill('appendChild'));
  });

  it('случайные пары с удалениями и новыми ключами', async () => {
    const r = rng(17);
    const pool = [...'ABCDEFGHIJKL'];
    for (let it = 0; it < 150; it++) {
      const from = pool.filter(() => r() < 0.7);
      const to = shuffle(pool.filter(() => r() < 0.7), r);
      const v = await runVue(from, to);
      const re = runReact(from, to);
      const vm = vueMoves(from, to);
      const rm = reactMoves(from, to);
      expect(v.text).toBe(to.join(''));
      expect(re.text).toBe(to.join(''));
      expect(movedOf(v.calls)).toBe(vm.moved.join(''));
      expect(mountedOf(v.calls)).toBe(vm.mounted.join(''));
      expect(movedOf(re.calls)).toBe(rm.moved.join(''));
      expect(mountedOf(re.calls)).toBe(rm.mounted.join(''));
    }
  });

  it('ABC → BCXA: настоящий Vue двигает один узел', async () => {
    const v = await runVue([...'ABC'], [...'BCXA']);
    expect(movedOf(v.calls)).toBe('A');
    expect(mountedOf(v.calls)).toBe('X');
  });

  it('RANDOM_STATS: Vue = n − LIS = D Майерса / 2, React не лучше', () => {
    const s = t.RANDOM_STATS;
    const r = rng(s.seed);
    const keys = [...'ABCDEFGHIJ'];
    let sv = 0;
    let sr = 0;
    let equal = 0;
    let worse = 0;
    let better = 0;
    let maxR = 0;
    let maxV = 0;
    for (let it = 0; it < s.runs; it++) {
      const to = shuffle(keys, r);
      const v = vueMoves(keys, to).moved.length;
      const re = reactMoves(keys, to).moved.length;
      const L = lis(to.map((k) => keys.indexOf(k))).length;
      expect(v).toBe(s.n - L);
      expect(myers(keys, to).d).toBe(2 * (s.n - L));
      sv += v;
      sr += re;
      if (v === re) equal++;
      if (re > v) worse++;
      if (re < v) better++;
      maxR = Math.max(maxR, re);
      maxV = Math.max(maxV, v);
    }
    expect({ vueAvg: sv / s.runs, reactAvg: sr / s.runs, equal, reactWorse: worse, reactMax: maxR, vueMax: maxV }).toEqual({
      vueAvg: s.vueAvg,
      reactAvg: s.reactAvg,
      equal: s.equal,
      reactWorse: s.reactWorse,
      reactMax: s.reactMax,
      vueMax: s.vueMax,
    });
    expect(better).toBe(0);
    expect(t.RANDOM_NOTE).toContain('**5,7**');
    expect(t.RANDOM_NOTE).toContain('**7,1**');
  });

  it('перенос ABCDEF → FABCDE: Майерс считает две правки', () => {
    expect(opsOf(myers([...'ABCDEF'], [...'FABCDE']).script)).toBe('+=====-');
  });
});
