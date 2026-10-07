/**
 * Элемент флекс-строки в том виде, в каком его принимает `resolveFlex` из темы.
 * Всё в пикселях. `min` — уже посчитанный минимум: для `min-width: auto` это min-content
 * содержимого (снят стендом, см. шапку `data.ts` темы). `max: null` — без предела.
 */
export interface FlexItem {
  name: string;
  basis: number;
  grow: number;
  shrink: number;
  min: number;
  max: number | null;
}

export interface FlexHit {
  i: number;
  by: 'min' | 'max';
}

/** Один проход распределения: сколько раздавали, что вышло, кого заморозили. */
export interface FlexRound {
  free: number;
  sizes: number[];
  frozen: number[];
  hit: FlexHit[];
}

export interface FlexResult {
  mode: 'grow' | 'shrink';
  sizes: number[];
  rounds: FlexRound[];
  /** На сколько строка вылезла за контейнер; 0 — влезла. */
  overflow: number;
}

export type ResolveFlex = (container: number, items: FlexItem[]) => FlexResult;

/** Сценарий демо: контейнер и элементы. */
export interface FlexScenario {
  id: string;
  label: string;
  container: number;
  items: FlexItem[];
  /** Подпись над сценарием. Строчная разметка. */
  note: string;
}

/** Колонка грида: фиксированная (`px`) или гибкая (`fr` и нижняя граница `min`). */
export interface FrTrack {
  px?: number;
  fr?: number;
  min?: number;
}

export interface FrApi {
  resolveFr(container: number, tracks: FrTrack[], gap?: number): { frSize: number; sizes: number[] };
  autoRepeat(container: number, min: number, gap: number, itemCount: number, fit: boolean): number;
}

/** Место элемента после авторасстановки: строка и колонка с единицы, как в CSS. */
export interface Placed {
  row: number;
  col: number;
  span: number;
}

export type AutoPlace = (columns: number, spans: number[], dense: boolean) => Placed[];
