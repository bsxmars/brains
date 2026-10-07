import type {
  BkApi,
  Entry,
  LevApi,
  RadixApi,
  SearchApi,
  SearchCodes,
  SearchTopic,
  SearchTrieFn,
  SubseqApi,
  TrieApi,
  WithinFn,
} from './types';

/**
 * Демо и тест спрашивают одни и те же функции — строки `*_CODE` из темы «Нечёткий поиск».
 *
 * Строки напечатаны на странице, собраны здесь `new Function` и прогоняются
 * `tests/unit/fuzzy-search.test.ts` против перебора всего словаря, независимых реализаций
 * расстояний и Fuse.js. Копии нет: разойдётся показанный код с оракулом — покраснеет тест.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
function load<T>(code: string, names: string[]): T {
  return new Function(`${code}\nreturn { ${names.join(', ')} };`)() as T;
}

export const loadTrie = (code: string) => load<TrieApi>(code, ['createTrie', 'insert', 'withPrefix']);
export const loadRadix = (code: string) => load<RadixApi>(code, ['compress', 'countNodes']);
export const loadLev = (code: string) => load<LevApi>(code, ['levenshtein', 'damerau']);
export const loadWithin = (code: string) => load<{ levenshteinWithin: WithinFn }>(code, ['levenshteinWithin']).levenshteinWithin;
export const loadSearchTrie = (code: string) => load<{ searchTrie: SearchTrieFn }>(code, ['searchTrie']).searchTrie;
export const loadBk = (code: string) => load<BkApi>(code, ['bkInsert', 'bkSearch']);
export const loadSubsequence = (code: string) => load<SubseqApi>(code, ['S', 'bonusAt', 'subsequenceScore']);

/** `SEARCH_CODE` опирается на `createTrie`, `insert`, `withPrefix` и `searchTrie` — склеиваем строки темы. */
export function loadSearch(codes: SearchCodes): SearchApi {
  return load<SearchApi>([codes.trie, codes.fuzzy, codes.search, codes.rank].join('\n'), ['buildIndex', 'search', 'rank']);
}

/** Снимок курса → строки поиска: заголовок темы, затем подписи её разделов. */
export function toEntries(topics: SearchTopic[]): Entry[] {
  return topics.flatMap(([title, href, links, sections]) => [
    { text: title, href, kind: 'topic' as const, links, topic: title },
    ...sections.map(([id, label]) => ({ text: label, href: `${href}#${id}`, kind: 'section' as const, links, topic: title })),
  ]);
}

/** Слова запроса — тем же шаблоном, что и в `search`. */
export function terms(query: string): string[] {
  return query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/**
 * Работа перебора без trie, для сравнения в демо: `startsWith` по каждому слову словаря
 * на каждое слово запроса, а с опечатками — ещё полная таблица `|запрос| × |слово|`.
 */
export function naiveWork(words: string[], query: string, typos: boolean): { checks: number; cells: number } {
  const ts = terms(query);
  let cells = 0;
  if (typos) for (const t of ts) for (const w of words) cells += t.length * w.length;
  return { checks: ts.length * words.length, cells };
}

/** Позиции подпоследовательности → куски `[start, end)` для подсветки (соседние склеены). */
export function positionsToMarks(positions: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (const p of positions) {
    const last = out[out.length - 1];
    if (last && last[1] === p) last[1] = p + 1;
    else out.push([p, p + 1]);
  }
  return out;
}

/** Текст, разрезанный на куски с подсветкой и без. Пересекающиеся куски объединяются. */
export function highlight(text: string, marks: [number, number][]): { text: string; on: boolean }[] {
  const sorted = [...marks].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [s, e] of sorted) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  const out: { text: string; on: boolean }[] = [];
  let pos = 0;
  for (const [s, e] of merged) {
    if (s > pos) out.push({ text: text.slice(pos, s), on: false });
    out.push({ text: text.slice(s, e), on: true });
    pos = e;
  }
  if (pos < text.length) out.push({ text: text.slice(pos), on: false });
  return out;
}
