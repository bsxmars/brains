import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import Fuse from 'fuse.js';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import * as t from '@/content/algorithms/fuzzy-search/data';
import {
  loadBk,
  loadLev,
  loadRadix,
  loadSearch,
  loadSearchTrie,
  loadSubsequence,
  loadTrie,
  loadWithin,
  terms,
  toEntries,
} from '@/widgets/fuzzy-lab/model/run';
import type { BkTree } from '@/widgets/fuzzy-lab/model/types';

/**
 * Тема «Нечёткий поиск и автодополнение».
 *
 * Строки из темы (`TRIE_CODE`, `RADIX_CODE`, `LEV_CODE`, `WITHIN_CODE`, `TRIE_FUZZY_CODE`,
 * `BK_CODE`, `SUBSEQ_CODE`, `SEARCH_CODE`, `RANK_CODE`) напечатаны на странице и исполняются
 * демо через `widgets/fuzzy-lab/model/run.ts`. Здесь они сверяются с оракулами: перебором
 * всего словаря, независимыми реализациями расстояний (полная таблица, настоящий
 * Дамерау—Левенштейн, Селлерс), полным перебором расстановок букв и Fuse.js 7.5.0.
 * Числа из текста пересчитываются; таблицы на миллион слов — в отдельном процессе Node.
 */

const trieApi = loadTrie(t.TRIE_CODE);
const radix = loadRadix(t.RADIX_CODE);
const { levenshtein, damerau } = loadLev(t.LEV_CODE);
const within = loadWithin(t.WITHIN_CODE);
const searchTrie = loadSearchTrie(t.TRIE_FUZZY_CODE);
const bk = loadBk(t.BK_CODE);
const sub = loadSubsequence(t.SUBSEQ_CODE);
const api = loadSearch({ trie: t.TRIE_CODE, fuzzy: t.TRIE_FUZZY_CODE, search: t.SEARCH_CODE, rank: t.RANK_CODE });

const entries = toEntries(t.SEARCH_TOPICS);
const index = api.buildIndex(entries);
const words = [...index.where.keys()];

/** ГПСЧ Лемера — как на стенде. */
function lehmer(seed: number) {
  let s = seed;
  return (n: number) => {
    s = (s * 48271) % 2147483647;
    return s % n;
  };
}

const ALPH = 'абвгдеёжзийклмнопрстуфхцчшщъыьэюяabcdefghijklmnopqrstuvwxyz';
function mutate(w: string, rnd: (n: number) => number, maxOps = 3, alph = ALPH): string {
  const a = [...w];
  const ops = 1 + rnd(maxOps);
  for (let i = 0; i < ops; i++) {
    const op = rnd(4);
    const p = rnd(a.length + 1);
    if (op === 0) a.splice(p, 0, alph[rnd(alph.length)]);
    else if (op === 1 && a.length > 1) a.splice(p % a.length, 1);
    else if (op === 2 && a.length) a[p % a.length] = alph[rnd(alph.length)];
    else if (a.length > 1) {
      const q = p % (a.length - 1);
      [a[q], a[q + 1]] = [a[q + 1], a[q]];
    }
  }
  return a.join('');
}

// ─── Независимые реализации расстояний ─────────────────────────────────────────────────────

/** Левенштейн полной таблицей, без экономии строк. */
function refLev(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** OSA рекурсией с запоминанием — другая форма той же формулы. */
function refOsa(a: string, b: string): number {
  const memo = new Map<string, number>();
  const go = (i: number, j: number): number => {
    if (i === 0) return j;
    if (j === 0) return i;
    const key = `${i},${j}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    let r = Math.min(go(i - 1, j) + 1, go(i, j - 1) + 1, go(i - 1, j - 1) + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) r = Math.min(r, go(i - 2, j - 2) + 1);
    memo.set(key, r);
    return r;
  };
  return go(a.length, b.length);
}

/** Настоящий Дамерау—Левенштейн (Лоуренс—Вагнер, с таблицей последних позиций букв). */
function refTrueDl(a: string, b: string): number {
  const INF = a.length + b.length;
  const da = new Map<string, number>();
  const d = Array.from({ length: a.length + 2 }, () => new Array<number>(b.length + 2).fill(0));
  d[0][0] = INF;
  for (let i = 0; i <= a.length; i++) {
    d[i + 1][0] = INF;
    d[i + 1][1] = i;
  }
  for (let j = 0; j <= b.length; j++) {
    d[0][j + 1] = INF;
    d[1][j + 1] = j;
  }
  for (let i = 1; i <= a.length; i++) {
    let db = 0;
    for (let j = 1; j <= b.length; j++) {
      const i1 = da.get(b[j - 1]) ?? 0;
      const j1 = db;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      if (!cost) db = j;
      d[i + 1][j + 1] = Math.min(d[i][j] + cost, d[i + 1][j] + 1, d[i][j + 1] + 1, d[i1][j1] + (i - i1 - 1) + 1 + (j - j1 - 1));
    }
    da.set(a[i - 1], i);
  }
  return d[a.length + 1][b.length + 1];
}

/** Селлерс: запрос против любого куска текста — первая строка таблицы из нулей. */
function sellers(p: string, text: string): number {
  let prev = new Array<number>(text.length + 1).fill(0);
  for (let i = 1; i <= p.length; i++) {
    const cur = [i];
    for (let j = 1; j <= text.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (p[i - 1] === text[j - 1] ? 0 : 1));
    prev = cur;
  }
  return Math.min(...prev);
}

/** Лучший счёт Fuse по умолчанию: совпадение с e ошибками начинается в p, счёт e/m + p/distance. */
function bestLocated(p: string, text: string, distance: number): number {
  let best = Infinity;
  for (let s = 0; s <= text.length; s++) {
    const piece = text.slice(s, s + p.length * 2 + 2);
    let prev: number[] = [];
    for (let j = 0; j <= piece.length; j++) prev[j] = j;
    for (let i = 1; i <= p.length; i++) {
      const cur = [i];
      for (let j = 1; j <= piece.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (p[i - 1] === piece[j - 1] ? 0 : 1));
      prev = cur;
    }
    best = Math.min(best, Math.min(...prev) / p.length + s / distance);
  }
  return best;
}

// ─── Trie ──────────────────────────────────────────────────────────────────────────────────

describe('trie и словарь курса', () => {
  it('словарь курса — числа из текста', () => {
    expect(entries.length).toBe(843);
    expect(t.SEARCH_TOPICS.length).toBe(114);
    expect(words.length).toBe(1140);
    expect(index.trie.nodes).toBe(4499);
    expect(words.reduce((s, w) => s + [...w].length, 0)).toBe(7552);
    expect(radix.countNodes(radix.compress(index.trie.root))).toBe(1553);
    expect(t.MEMORY_ROWS[0]).toMatchObject({ words: '1 140', chars: '7 552', trie: '4 499', radix: '1 553' });
  });

  it('withPrefix совпадает с filter(startsWith) на всех префиксах словаря', () => {
    const prefixes = new Set<string>();
    for (const w of words) for (let i = 0; i <= w.length; i++) prefixes.add(w.slice(0, i));
    // Префиксов ровно столько, сколько узлов: каждый узел — один префикс.
    expect(prefixes.size).toBe(index.trie.nodes);
    for (const p of prefixes) {
      const got = trieApi.withPrefix(index.trie, p);
      // Порядок — порядок вставки, а не алфавит: сверяется набор.
      expect([...got.words].sort(), p).toEqual(words.filter((w) => w.startsWith(p)).sort());
      expect(trieApi.withPrefix(index.trie, p, 10).words).toEqual(got.words.slice(0, 10));
    }
    expect(trieApi.withPrefix(index.trie, 'нетакого').words).toEqual([]);
  });

  it('отсортированная вставка даёт подсказки по алфавиту', () => {
    const tr = trieApi.createTrie();
    const sorted = [...words].sort();
    for (const w of sorted) trieApi.insert(tr, w);
    expect(trieApi.withPrefix(tr, 'с').words).toEqual(sorted.filter((w) => w.startsWith('с')));
  });

  it('TRIE_NOTE: «с» — 108 слов, 398 узлов, первые десять — 40', () => {
    const all = trieApi.withPrefix(index.trie, 'с');
    const ten = trieApi.withPrefix(index.trie, 'с', 10);
    expect([all.words.length, all.visited, ten.visited]).toEqual([108, 398, 40]);
    expect(t.TRIE_NOTE).toContain('108 слов и 398 узлов');
    expect(t.TRIE_NOTE).toContain('40 узлов');
  });

  it('compress перечисляет те же слова', () => {
    const list: string[] = [];
    const walk = (n: ReturnType<typeof radix.compress>, path: string) => {
      if (n.end) list.push(path);
      for (const [label, child] of n.edges) walk(child, path + label);
    };
    walk(radix.compress(index.trie.root), '');
    expect(list.sort()).toEqual([...words].sort());
  });
});

// ─── Расстояния ────────────────────────────────────────────────────────────────────────────

describe('Левенштейн и Дамерау', () => {
  it('совпадают с независимыми реализациями на случайных парах', () => {
    const rnd = lehmer(17);
    const rw = () => {
      let w = '';
      const n = rnd(8);
      for (let i = 0; i < n; i++) w += 'абвкоab'[rnd(7)];
      return w;
    };
    for (let i = 0; i < 4000; i++) {
      const a = rw();
      const b = rnd(2) ? mutate(a || 'а', rnd, 3, 'абвкоab') : rw();
      expect(levenshtein(a, b), `${a}/${b}`).toBe(refLev(a, b));
      expect(damerau(a, b), `${a}/${b}`).toBe(refOsa(a, b));
      // OSA никогда не меньше настоящего Дамерау—Левенштейна и не больше Левенштейна.
      expect(damerau(a, b)).toBeGreaterThanOrEqual(refTrueDl(a, b));
      expect(damerau(a, b)).toBeLessThanOrEqual(levenshtein(a, b));
    }
  });

  it('таблица LEV_ROWS', () => {
    for (const r of t.LEV_ROWS) {
      expect(levenshtein(r.a, r.b), r.a).toBe(r.lev);
      expect(damerau(r.a, r.b), r.a).toBe(r.dam);
    }
    // «Настоящий Дамерау—Левенштейн даёт 2: ca → ac → abc».
    expect(refTrueDl('ca', 'abc')).toBe(2);
    expect(t.LEV_ROWS[3].d).toContain('даёт 2');
  });

  it('levenshteinWithin = min(расстояние, k + 1)', () => {
    const rnd = lehmer(23);
    for (let i = 0; i < 3000; i++) {
      const a = words[rnd(words.length)];
      const b = rnd(3) ? mutate(a, rnd) : words[rnd(words.length)];
      const k = rnd(4);
      expect(within(a, b, k).distance, `${a}/${b}/${k}`).toBe(Math.min(levenshtein(a, b), k + 1));
    }
  });

  it('WITHIN: рекативность против всех слов курса, k = 2', () => {
    const q = 'рекативность';
    let full = 0;
    let band = 0;
    for (const w of words) {
      full += q.length * w.length;
      band += within(q, w, 2).cells;
    }
    expect({ full, band }).toEqual(t.WITHIN);
    expect(t.WITHIN_NOTE).toContain('90 624');
    expect(t.WITHIN_NOTE).toContain('2329');
  });

  it('тонкое место 07: кодовые единицы, а не буквы', () => {
    expect(levenshtein('é', 'é')).toBe(2);
    expect(levenshtein('😀', 'a')).toBe(2);
    expect(levenshtein('é'.normalize(), 'é'.normalize())).toBe(0);
  });
});

// ─── Поиск в словаре ───────────────────────────────────────────────────────────────────────

describe('searchTrie и BK-дерево против перебора', () => {
  const sortWords = (xs: { word: string }[]) => xs.map((x) => x.word).sort();

  it('на 2000 запросов с опечатками — те же слова и расстояния', () => {
    const rnd = lehmer(7);
    const bkLev: BkTree = { root: null };
    for (const w of words) bk.bkInsert(bkLev, w, levenshtein);
    for (let q = 0; q < 2000; q++) {
      const query = mutate(words[rnd(words.length)], rnd);
      const k = 1 + rnd(2);
      const lev = words.filter((w) => levenshtein(query, w) <= k).sort();
      const osa = words.filter((w) => damerau(query, w) <= k).sort();
      const r = searchTrie(index.trie, query, k);
      expect(sortWords(r.found), query).toEqual(lev);
      for (const f of r.found) expect(f.distance).toBe(levenshtein(query, f.word));
      const rt = searchTrie(index.trie, query, k, true);
      expect(sortWords(rt.found), query).toEqual(osa);
      for (const f of rt.found) expect(f.distance).toBe(damerau(query, f.word));
      expect(sortWords(bk.bkSearch(bkLev, query, k, levenshtein).found), query).toEqual(lev);
    }
  });

  it('BK-дерево с OSA теряет слово: корт, кто; запрос кот', () => {
    const tree: BkTree = { root: null };
    for (const w of t.BK_OSA_DICT) bk.bkInsert(tree, w, damerau);
    const want = t.BK_OSA_DICT.filter((w) => damerau(t.BK_OSA_QUERY, w) <= 1);
    const got = bk.bkSearch(tree, t.BK_OSA_QUERY, 1, damerau).found.map((f) => f.word);
    expect(want).toEqual(['корт', 'кто']);
    expect(got).toEqual(['корт']);
    expect([damerau('кот', 'корт'), damerau('кот', 'кто'), damerau('корт', 'кто'), refTrueDl('корт', 'кто')]).toEqual([1, 1, 3, 2]);
    // С метрикой (Левенштейн) дерево находит всё, что должно.
    const lev: BkTree = { root: null };
    for (const w of t.BK_OSA_DICT) bk.bkInsert(lev, w, levenshtein);
    expect(sortWords(bk.bkSearch(lev, 'кот', 1, levenshtein).found)).toEqual(t.BK_OSA_DICT.filter((w) => levenshtein('кот', w) <= 1).sort());
  });
});

// ─── Подпоследовательность ─────────────────────────────────────────────────────────────────

describe('subsequenceScore', () => {
  const { S, bonusAt, subsequenceScore } = sub;
  function scoreOf(text: string, pos: number[]): number {
    let s = 0;
    pos.forEach((p, i) => {
      s += S.match + bonusAt(text, p) * (i === 0 ? S.first : 1);
      if (i) {
        const g = p - pos[i - 1] - 1;
        s += g === 0 ? S.consecutive : S.gapStart + (g - 1) * S.gapExtend;
      }
    });
    return s;
  }
  function brute(q: string, text: string): number | null {
    const tl = text.toLowerCase();
    const ql = q.toLowerCase();
    let best: number | null = null;
    const rec = (i: number, from: number, pos: number[]) => {
      if (i === ql.length) {
        const s = scoreOf(text, pos);
        if (best === null || s > best) best = s;
        return;
      }
      for (let j = from; j < tl.length; j++) if (tl[j] === ql[i]) rec(i + 1, j + 1, [...pos, j]);
    };
    rec(0, 0, []);
    return best;
  }

  it('совпадает с полным перебором расстановок', () => {
    const rnd = lehmer(3);
    for (let it = 0; it < 5000; it++) {
      let text = '';
      const len = 1 + rnd(12);
      for (let i = 0; i < len; i++) text += 'abAB -cк'[rnd(8)];
      let q = '';
      const m = 1 + rnd(4);
      for (let i = 0; i < m; i++) q += 'abcк'[rnd(4)];
      const r = subsequenceScore(q, text);
      expect(r?.score ?? null, `${q} / ${text}`).toBe(brute(q, text));
      if (r) expect(scoreOf(text, r.positions)).toBe(r.score);
    }
  });

  it('константы — как в fzf', () => {
    expect(S).toEqual({ match: 16, gapStart: -3, gapExtend: -1, boundary: 8, camel: 7, consecutive: 4, first: 2 });
  });

  it('таблица SUBSEQ_ROWS', () => {
    for (const r of t.SUBSEQ_ROWS) {
      const max = Math.max(...entries.map((e) => subsequenceScore(r.q, e.text)?.score ?? -Infinity));
      expect(max, r.q).toBe(r.bestScore);
      expect(subsequenceScore(r.q, r.best)?.score).toBe(r.bestScore);
      expect(subsequenceScore(r.q, r.other)?.score).toBe(r.otherScore);
      expect(entries.some((e) => e.text === r.best) && entries.some((e) => e.text === r.other)).toBe(true);
    }
    expect(subsequenceScore('sc', 'effectScope')?.score).toBe(50);
  });
});

// ─── Ранжирование ──────────────────────────────────────────────────────────────────────────

describe('search и rank', () => {
  const tokens = entries.map((e) => (e.text.match(/[\p{L}\p{N}]+/gu) ?? []).map((w) => w.toLowerCase()));
  const autoK = (term: string) => (term.length < 3 ? 0 : term.length < 6 ? 1 : 2);

  it('совпадает с перебором: префиксы и опечатки', () => {
    const rnd = lehmer(41);
    for (let q = 0; q < 600; q++) {
      const n = 1 + rnd(2);
      const parts: string[] = [];
      for (let i = 0; i < n; i++) {
        const w = words[rnd(words.length)];
        parts.push(rnd(2) ? w.slice(0, 1 + rnd(w.length)) : mutate(w, rnd, 2));
      }
      const query = parts.join(' ');
      const ts = terms(query);
      for (const typos of [false, true]) {
        const want = entries
          .map((_, id) => id)
          .filter((id) => ts.every((term) => tokens[id].some((w) => w.startsWith(term) || (typos && damerau(term, w) <= autoK(term)))));
        const got = api.search(index, query, typos).hits.map((h) => h.id).sort((a, b) => a - b);
        expect(got, `${query} ${typos}`).toEqual(want);
      }
    }
  });

  it('RANK_ROWS: react — порядок search + rank', () => {
    const ranked = api
      .search(index, 'react', false)
      .hits.map((h) => ({ text: entries[h.id].text, s: api.rank(h, entries[h.id]) }))
      .sort((a, b) => b.s - a.s);
    t.RANK_ROWS.forEach((row, i) => {
      expect(row.ours).toBe(`«${ranked[i].text}» — ${ranked[i].s.toFixed(1)}`);
    });
  });

  it('RANK_ROWS: react — порядок Fuse.js по умолчанию', () => {
    const found = new Fuse(entries, { keys: ['text'], includeScore: true }).search('react');
    t.RANK_ROWS.forEach((row, i) => {
      const text = found[i].item.text;
      const shown = /\s/.test(text) ? `«${text}»` : `\`${text}\``;
      expect(row.fuse).toBe(`${shown} — ${(found[i].score ?? 0).toFixed(3)}`);
    });
    // `reactive` — раздел темы про Vue, а не React.
    expect(found[0].item.topic).toBe('Vue 3 изнутри: своя реактивность');
  });
});

// ─── Fuse.js ───────────────────────────────────────────────────────────────────────────────

describe('Fuse.js 7.5.0', () => {
  it('версия на стенде', () => {
    const require = createRequire(import.meta.url);
    const pkgPath = join(require.resolve('fuse.js').replace(/dist\/.*$/, ''), 'package.json');
    expect((JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string }).version).toBe('7.5.0');
  });

  it('ignoreLocation: true — найденное = строки с куском не дальше ⌊threshold·m⌋ правок', () => {
    const rnd = lehmer(5);
    for (const threshold of [0.2, 0.34, 0.6]) {
      const fuse = new Fuse(entries, { keys: ['text'], ignoreLocation: true, threshold });
      for (let q = 0; q < 300; q++) {
        const query = mutate(words[rnd(words.length)], rnd, 3, `${ALPH} `).slice(0, 32);
        if (!query.trim()) continue;
        const got = fuse
          .search(query)
          .map((r) => r.refIndex)
          .sort((a, b) => a - b);
        const pl = query.toLowerCase();
        const want = entries.map((e, i) => (sellers(pl, e.text.toLowerCase()) / pl.length <= threshold ? i : -1)).filter((i) => i >= 0);
        expect(got, `${threshold} ${query}`).toEqual(want);
      }
    }
  });

  it('по умолчанию — e/m + p/100 ≤ 0.6, окно около 60 символов', () => {
    // Длинные тексты: подряд склеенные заголовки тем.
    const texts = Array.from({ length: 20 }, (_, i) =>
      t.SEARCH_TOPICS.slice(i * 5, i * 5 + 5)
        .map((x) => x[0])
        .join('. '),
    );
    const docs = texts.map((lead) => ({ lead }));
    const fuse = new Fuse(docs, { keys: ['lead'] });
    const pool = [...new Set(texts.flatMap((x) => x.toLowerCase().match(/\p{L}{4,}/gu) ?? []))];
    const rnd = lehmer(9);
    for (let q = 0; q < 60; q++) {
      const w = pool[rnd(pool.length)];
      const got = fuse
        .search(w)
        .map((r) => r.refIndex)
        .sort((a, b) => a - b);
      const want = texts.map((x, i) => (bestLocated(w, x.toLowerCase(), 100) <= 0.6 ? i : -1)).filter((i) => i >= 0);
      expect(got, w).toEqual(want);
    }
  });

  it('LOCATION_CODE: «исходников» в позиции 138 не найдено, с ignoreLocation — найдено', () => {
    expect(t.LONG_TEXT.toLowerCase().indexOf('исходников')).toBe(138);
    const run = new Function('Fuse', 'LONG_TEXT', `${t.LOCATION_CODE}\nreturn [fuse.search('исходников').length, wide.search('исходников').length];`);
    expect(run(Fuse, t.LONG_TEXT)).toEqual([0, 1]);
    expect([...t.LOCATION_CODE.matchAll(/\/\/ (\d+)/g)].map((m) => Number(m[1]))).toEqual([0, 1]);
    expect(t.LOCATION_CODE).toContain('позиции 138');
    // Лид в теме — копия: тема «Source maps» пока говорит то же самое.
    const fm = parse(readFileSync('src/content/tooling/source-maps/index.mdx', 'utf8').split('---')[1]) as { lead: string };
    expect(fm.lead).toBe(t.LONG_TEXT);
  });

  it('FUSE_ROWS — сколько и что первым', () => {
    const fuse = new Fuse(entries, { keys: ['text'], includeScore: true });
    for (const r of t.FUSE_ROWS) {
      const found = fuse.search(r.q);
      expect(found.length, r.q).toBe(r.found);
      const top = [...r.top.matchAll(/«([^»]+)»/g)].map((m) => m[1]);
      expect(found.slice(0, top.length).map((f) => f.item.text), r.q).toEqual(top);
    }
    // «ивент» не находит Event Loop; «мгу» — ни одной строки про Vue.
    expect(fuse.search('ивент').some((f) => f.item.text === 'Event Loop')).toBe(false);
    expect(fuse.search('мгу').some((f) => /vue/i.test(f.item.text))).toBe(false);
    // «кэш»: счёт 0.46 у «Кеш …» сразу.
    expect(fuse.search('кэш')[0].score?.toFixed(2)).toBe('0.46');
    // «каждая одиннадцатая строка».
    expect(Math.round(entries.length / 76)).toBe(11);
  });

  it('норма длины поля: счёт в степени 1/√(число слов)', () => {
    const fuse = new Fuse(entries, { keys: ['text'], includeScore: true });
    const hit = fuse.search('react').find((f) => f.item.text === 'React против Vue');
    const norm = Math.round(1000 / Math.sqrt(3)) / 1000;
    expect(hit?.score).toBeCloseTo(0.001 ** norm, 6);
  });

  it('ignoreDiacritics: й → и, ё → е', () => {
    const fuse = new Fuse(['ёжик', 'йогурт'], { ignoreDiacritics: true, threshold: 0 });
    expect(fuse.search('иогурт').map((r) => r.item)).toEqual(['йогурт']);
    expect(fuse.search('ежик').map((r) => r.item)).toEqual(['ёжик']);
    expect(new Fuse(['ёжик'], { threshold: 0 }).search('ежик')).toEqual([]);
  });

  it('раскладка: vue в русской раскладке — мгу', () => {
    expect(t.LAYOUT_EN.length).toBe(t.LAYOUT_RU.length);
    const toRu = (s: string) => [...s].map((c) => t.LAYOUT_RU[t.LAYOUT_EN.indexOf(c)] ?? c).join('');
    expect(toRu('vue')).toBe('мгу');
    expect(levenshtein('мгу', 'vue')).toBe(3);
  });
});

// ─── Масштаб: отдельный процесс ────────────────────────────────────────────────────────────

describe('тысяча, сто тысяч, миллион', () => {
  it('SCALE, FUZZY_SCALE, BK_ROWS и узлы миллиона пересчитываются', () => {
    const script = `
      const codes = JSON.parse(require('fs').readFileSync(0, 'utf8'));
      const api = new Function(codes.join('\\n') + '\\nreturn { makeWords, createTrie, insert, withPrefix, compress, countNodes, levenshtein, levenshteinWithin, searchTrie, bkInsert, bkSearch };')();
      const out = { scale: [], fuzzy: [], bk: [], million: null, heap: null };
      {
        // Память — первой, пока куча чистая.
        gc(); const h0 = process.memoryUsage().heapUsed;
        const copy = api.makeWords(100000);
        gc(); const h1 = process.memoryUsage().heapUsed;
        const t2 = api.createTrie();
        for (const w of copy) api.insert(t2, w);
        gc(); const h2 = process.memoryUsage().heapUsed;
        out.heap = { array: h1 - h0, trie: h2 - h1, keep: t2.nodes + copy.length };
      }
      for (const n of [1000, 100000, 1000000]) {
        const ws = api.makeWords(n);
        const trie = api.createTrie();
        for (const w of ws) api.insert(trie, w);
        const all = api.withPrefix(trie, 'ба');
        const ten = api.withPrefix(trie, 'ба', 10);
        out.scale.push({ n, found: all.words.length, all: all.visited, first10: ten.visited });
        let full = 0, band = 0, found = 0;
        for (const w of ws) {
          full += 6 * w.length;
          const r = api.levenshteinWithin('бароса', w, 2);
          band += r.cells;
          if (r.distance <= 2) found++;
        }
        const tr = api.searchTrie(trie, 'бароса', 2);
        if (tr.found.length !== found) throw new Error('searchTrie != перебор');
        out.fuzzy.push({ n, found, full, band, trie: tr.visited * 6 });
        if (n === 100000) {
          const tree = { root: null };
          for (const w of ws) api.bkInsert(tree, w, api.levenshtein);
          for (const [q, k] of [['бароса', 1], ['бароса', 2], ['кулимаро', 2]]) {
            const b = api.bkSearch(tree, q, k, api.levenshtein);
            out.bk.push({ q, k, found: b.found.length, calls: b.calls, trie: api.searchTrie(trie, q, k).visited });
          }
        }
        if (n === 1000000) {
          out.million = { chars: ws.reduce((a, w) => a + w.length, 0), trie: trie.nodes, radix: api.countNodes(api.compress(trie.root)),
            k1: api.searchTrie(trie, 'бароса', 1).visited * 6 };
        }
      }
      process.stdout.write(JSON.stringify(out));
    `;
    const codes = [t.WORDS_GEN_CODE, t.TRIE_CODE, t.RADIX_CODE, t.LEV_CODE, t.WITHIN_CODE, t.TRIE_FUZZY_CODE, t.BK_CODE];
    const raw = execFileSync(process.execPath, ['--expose-gc', '--max-old-space-size=4096', '-e', script], {
      input: JSON.stringify(codes),
      maxBuffer: 1 << 20,
    });
    const out = JSON.parse(String(raw)) as {
      scale: unknown[];
      fuzzy: unknown[];
      bk: unknown[];
      million: { chars: number; trie: number; radix: number; k1: number };
      heap: { array: number; trie: number; keep: number };
    };
    expect(out.scale).toEqual(t.SCALE);
    expect(out.fuzzy).toEqual(t.FUZZY_SCALE);
    expect(out.bk).toEqual(t.BK_ROWS);
    expect(out.million).toEqual({ chars: 8_060_662, trie: 2_919_382, radix: 1_286_823, k1: 10_386 });
    expect(t.MEMORY_ROWS[1]).toMatchObject({ chars: '8 060 662', trie: '2 919 382', radix: '1 286 823' });
    // Память приблизительна; закрепляется отношение: trie в десятки раз тяжелее массива строк.
    expect(out.heap.trie / out.heap.array).toBeGreaterThan(10);
  }, 180_000);
});

// ─── Снимок словаря курса против диска ─────────────────────────────────────────────────────

describe('SEARCH_TOPICS — снимок сайта', () => {
  /**
   * Мягкая сверка: снимок взят, пока рядом писались другие темы, и подписи разделов у соседей
   * ещё могут меняться. Адрес каждой темы обязан существовать; строк, которые есть на диске
   * дословно, — не меньше 90 %. Упало — пора переснять снимок (см. шапку data.ts).
   */
  const DIRS: Record<string, string> = { js: 'lessons', render: 'render', frameworks: 'frameworks', platform: 'platform', tooling: 'tooling', delivery: 'delivery', algorithms: 'algorithms', data: 'data', patterns: 'patterns' };

  it('темы на месте, строки в основном совпадают', () => {
    let same = 0;
    for (const [title, href, , sections] of t.SEARCH_TOPICS) {
      const [, dir, slug] = href.split('/');
      const file = join('src/content', DIRS[dir], slug, 'index.mdx');
      expect(existsSync(file), href).toBe(true);
      const fm = parse(readFileSync(file, 'utf8').split('---')[1]) as { title: string; nav: { id: string; label: string }[] };
      if (fm.title === title) same++;
      for (const [id, label] of sections) if (fm.nav.some((n) => n.id === id && n.label === label)) same++;
    }
    expect(same / entries.length).toBeGreaterThanOrEqual(0.9);
    // Снимок не включает саму эту тему.
    expect(t.SEARCH_TOPICS.some(([, href]) => href === '/algorithms/fuzzy-search/')).toBe(false);
    expect(readdirSync('src/content/algorithms')).toContain('fuzzy-search');
  });
});
