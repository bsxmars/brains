/** Карта в том виде, в каком её пишет сборщик: только поля, нужные демо и поиску. */
export interface RawMap {
  sources: string[];
  sourcesContent: string[];
  names: string[];
  mappings: string;
}

/**
 * Сегмент после разбора: абсолютные числа, как их возвращает `decodeMappings`.
 * `[колонка]` — кусок без источника; `[колонка, файл, строка, колонка]`; пятое поле — имя.
 * Строка и колонки — с нуля.
 */
export type Segment = number[];

/** Пример для демо: сгенерированный код и карта к нему, сняты стендом (см. шапку `data.ts` темы). */
export interface MapExample {
  id: string;
  label: string;
  /** Сгенерированный код без комментария `sourceMappingURL`. */
  generated: string;
  map: RawMap;
  /** Подпись над примером. Строчная разметка. */
  note: string;
  /** Сегмент, выбранный при открытии: строка с нуля и номер сегмента в ней. */
  start: [number, number];
}

export interface OriginalPosition {
  source: string;
  /** С единицы, как в стеке ошибки. */
  line: number;
  /** С нуля, как в карте. */
  column: number;
  name: string | null;
}

export interface VlqApi {
  B64: string;
  readVlq(str: string, pos: number): [number, number];
  decodeMappings(mappings: string): Segment[][];
}

export type LookupFn = (
  map: Pick<RawMap, 'sources' | 'names'>,
  lines: Segment[][],
  line: number,
  column: number,
) => OriginalPosition | null;
