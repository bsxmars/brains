/** Пара строк для демо Майерса. */
export interface DiffPair {
  id: string;
  label: string;
  a: string;
  b: string;
}

/** Сценарий перестановки списка; `vue`/`react` — какие ключи двигались, в порядке вызовов DOM. */
export interface MoveScenario {
  id: string;
  label: string;
  from: string;
  to: string;
  vue: string;
  react: string;
}

export type Op = ['=' | '-' | '+', unknown];

/** `v` после шага: ключ — диагональ k, значение — самый дальний x. */
export type Snapshot = Record<number, number>;

export interface MyersResult {
  d: number;
  script: Op[];
  trace: Snapshot[];
}

export type MyersFn = (a: unknown[], b: unknown[]) => MyersResult;

export interface Moves {
  moved: string[];
  mounted: string[];
}

export type MovesFn = (oldKeys: string[], newKeys: string[]) => Moves;

export type LisFn = (arr: number[]) => number[];

/** Точка фронта: куда дошёл путь из d правок на диагонали k. */
export interface FrontPoint {
  k: number;
  x: number;
  y: number;
  /** Внутри сетки: 0 ≤ x ≤ n, 0 ≤ y ≤ m. Путь, ушедший за край, алгоритм хранит, но он не нужен. */
  inside: boolean;
}
