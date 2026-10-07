/** Момент сборки на графике: где произошла и какого рода. */
export interface HeapGc {
  /** Индекс точки в `points`. */
  at: number;
  kind: 'minor' | 'major';
}

/** Событие сценария: «серия из 20 переходов», «открыли модалку сто раз». */
export interface HeapMarker {
  at: number;
  label: string;
}

/**
 * Пресет графика heap во времени.
 *
 * Огибающая **не хранится** — она вычисляется из `points` по точкам Major GC. Так подпись
 * под графиком не может разойтись с самим графиком: в оригинале текст обещал ускоряющийся
 * рост (200 → 215 → 240 → 280), а нарисована была линейная пила.
 */
export interface HeapPreset {
  key: string;
  label: string;
  tone: 'ok' | 'err';
  /** Занятая память по шагам времени, МБ. */
  points: number[];
  gc: HeapGc[];
  markers?: HeapMarker[];
  /** Вердикт: что именно на этом графике видно. */
  verdict: string;
}
