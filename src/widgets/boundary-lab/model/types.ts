/** Состояние компонента в демо: готов, ждёт данных или падает в рендере. */
export type Status = 'ok' | 'wait' | 'fail';

/** У кого смотрим поведение у корня: React и Vue расходятся только там. */
export type Mode = 'react' | 'vue';

/** Узел дерева учебной модели — тот же формат, что описан в начале `BOUNDARY_CODE`. */
export type TreeNode =
  | { type: 'component'; name: string; children: TreeNode[] }
  | { type: 'suspense'; fallback: string; children: TreeNode[] }
  | { type: 'boundary'; fallback: string; children: TreeNode[] };

export interface RootResult {
  /** Что видно на экране, по порядку: имена компонентов и тексты заглушек. */
  shown: string[];
  /** Ход рендера словами — то, что печатает демо. */
  log: string[];
  /** Кто бросил промис и был ли над ним Suspense. */
  asked: { name: string; inSuspense: boolean }[];
  /** Границы ошибок, чья заглушка закоммичена (React) или сработал `onErrorCaptured` (Vue). */
  caught: string[];
  /** Ошибки, которые не поймал никто: имя упавшего компонента. */
  uncaught: string[];
}

export interface Wave {
  /** Компоненты, которые начали загрузку в этой волне. */
  started: string[];
  /** Что видно на экране, пока эти загрузки идут. */
  shown: string[];
}

export interface BoundaryApi {
  renderRoot(tree: TreeNode, status: Record<string, Status>, mode?: Mode): RootResult;
  loadWaves(tree: TreeNode, initial: Record<string, Status>, mode?: Mode): Wave[];
}
