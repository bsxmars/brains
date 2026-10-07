/** Индекс: путь файла → хеш блоба. Так git видит снимок проекта: и индекс, и дерево коммита. */
export type Index = Record<string, string>;

export type Sha1 = (bytes: Uint8Array) => string;

export type ObjType = 'blob' | 'tree' | 'commit';

export interface CommitFields {
  tree: string;
  parents: string[];
  /** `Имя <почта>`. */
  author: string;
  /** Секунды Unix. */
  authorTime: number;
  /** Секунды Unix; по умолчанию — `authorTime`. */
  commitTime?: number;
  message: string;
}

/** Функции из строки `GIT_CODE` темы — их печатает страница, исполняет демо и проверяет тест. */
export interface GitApi {
  hashObject(type: ObjType | 'tag', body: string | Uint8Array, sha1: Sha1): { hash: string; raw: Uint8Array };
  writeTree(index: Index, sha1: Sha1, save?: (type: 'tree', hash: string, raw: Uint8Array) => void): string;
  commitText(c: CommitFields): string;
  ancestors(parents: Record<string, string[]>, start: string): Set<string>;
  mergeBase(parents: Record<string, string[]>, a: string, b: string): string[];
  mergeIndex(base: Index, ours: Index, theirs: Index): { result: Index; both: string[] };
}

/** Объект в хранилище демо: что это и сколько байт содержимого (без заголовка). */
export interface StoredObject {
  hash: string;
  type: ObjType;
  size: number;
  /** Чем объект является в проекте: путь файла, «корень», сообщение коммита. */
  label: string;
}

export interface CommitNode {
  hash: string;
  parents: string[];
  tree: string;
  index: Index;
  message: string;
  authorTime: number;
  commitTime: number;
  /** Текст объекта — то, что печатает `git cat-file -p`. */
  text: string;
  /** Дорожка на графе: ветка, на которой коммит создан. */
  lane: number;
  /** Порядковый номер создания — столбец на графе. */
  seq: number;
}

export interface ReflogEntry {
  from: string;
  to: string;
  /** Как в `.git/logs/HEAD`: «commit: docs», «merge feature: Fast-forward». */
  what: string;
}

export interface Repo {
  objects: Map<string, StoredObject>;
  /** Содержимое блобов: демо правит файлы, читая прошлую версию. */
  contents: Map<string, string>;
  commits: Map<string, CommitNode>;
  refs: Record<string, string>;
  head: string;
  reflog: ReflogEntry[];
  /** Время следующего коммита — секунды Unix; шаг 60 с, как на стенде. */
  clock: number;
  /** Сколько коммитов сделано на каждой ветке: от этого зависит, какую правку внесёт следующий. */
  made: Record<string, number>;
  seq: number;
}

export type StepKind = 'commit' | 'switch' | 'merge' | 'rebase' | 'reset';

/** Что поменял один шаг — для подписи в демо и для теста, который повторяет шаг в git. */
export interface StepResult {
  kind: StepKind;
  /** Команда git, которой равен шаг. */
  command: string;
  /** Объекты, которых до шага не было. */
  created: StoredObject[];
  /** Пояснение. Строчная разметка. */
  note: string;
  /** Правка файла перед `commit` — тест пишет её на диск. */
  edit?: { path: string; content: string; message: string };
  /** Время, с которым шаг создавал коммиты (если создавал). */
  time?: number;
}
