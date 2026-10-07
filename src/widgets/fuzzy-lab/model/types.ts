/** Тема в снимке словаря курса: заголовок, адрес, сколько других тем ссылаются, разделы `[id, подпись]`. */
export type SearchTopic = [title: string, href: string, links: number, sections: [id: string, label: string][]];

/** Строка, по которой ищет демо: заголовок темы или подпись её раздела. */
export interface Entry {
  text: string;
  href: string;
  kind: 'topic' | 'section';
  /** Сколько других тем ссылаются на тему — вместо статистики кликов. */
  links: number;
  /** Заголовок темы, к которой относится строка. */
  topic: string;
}

/** Узел trie, как его строит `TRIE_CODE`. */
export interface TrieNode {
  next: Map<string, TrieNode>;
  end: boolean;
}

export interface Trie {
  root: TrieNode;
  nodes: number;
}

/** Узел сжатого дерева, как его строит `compress`. */
export interface RadixNode {
  edges: Map<string, RadixNode>;
  end: boolean;
}

export interface TrieApi {
  createTrie(): Trie;
  insert(trie: Trie, word: string): void;
  withPrefix(trie: Trie, prefix: string, limit?: number): { words: string[]; visited: number };
}

export interface RadixApi {
  compress(node: TrieNode): RadixNode;
  countNodes(node: RadixNode): number;
}

export interface LevApi {
  levenshtein(a: string, b: string): number;
  damerau(a: string, b: string): number;
}

export type WithinFn = (a: string, b: string, k: number) => { distance: number; cells: number };

export interface Found {
  word: string;
  distance: number;
}

export type SearchTrieFn = (trie: Trie, word: string, k: number, transpose?: boolean) => { found: Found[]; visited: number };

export type Dist = (a: string, b: string) => number;

export interface BkTree {
  root: { word: string; kids: Map<number, unknown> } | null;
}

export interface BkApi {
  bkInsert(tree: BkTree, word: string, dist: Dist): void;
  bkSearch(tree: BkTree, word: string, k: number, dist: Dist): { found: Found[]; calls: number };
}

export interface Subsequence {
  score: number;
  positions: number[];
}

export interface SubseqApi {
  S: Record<'match' | 'gapStart' | 'gapExtend' | 'boundary' | 'camel' | 'consecutive' | 'first', number>;
  bonusAt(text: string, j: number): number;
  subsequenceScore(query: string, text: string): Subsequence | null;
}

/** Находка `search`: номер строки, цена опечаток, место, целые слова и куски для подсветки `[start, end)`. */
export interface Hit {
  id: number;
  cost: number;
  at: number;
  whole: number;
  marks: [number, number][];
}

export interface Place {
  id: number;
  at: number;
  start: number;
  end: number;
}

export interface SearchIndex {
  trie: Trie;
  where: Map<string, Place[]>;
  entries: Entry[];
}

export interface SearchApi {
  buildIndex(entries: Entry[]): SearchIndex;
  search(index: SearchIndex, query: string, typos: boolean): { hits: Hit[]; visited: number };
  rank(hit: Hit, entry: Entry): number;
}

/** Строки темы, из которых демо собирает поиск. */
export interface SearchCodes {
  trie: string;
  fuzzy: string;
  search: string;
  rank: string;
}
