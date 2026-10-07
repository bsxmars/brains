/** Образец строки для демо графем: снят и объяснён в `data.ts` темы. */
export interface StringSample {
  id: string;
  label: string;
  value: string;
  /** Пояснение к образцу. Строчная разметка. */
  note: string;
}

/** Образец числа для демо множественных форм. `value` — запись с точкой, как в JS. */
export interface NumberSample {
  label: string;
  value: string;
}

/** Вид кодовой точки по правилам границ (подмножество UAX #29). */
export type PointKind = 'CR' | 'LF' | 'ZWJ' | 'Extend' | 'RI' | 'Control' | 'Pict' | 'Any';

/** Решение между точками `at - 1` и `at`: склеить или разорвать, и номер правила. */
export interface BreakStep {
  at: number;
  rule: string;
  join: boolean;
}

export interface GraphemeApi {
  kind(c: string): PointKind;
  graphemeBreaks(str: string): { cps: string[]; steps: BreakStep[] };
  splitGraphemes(str: string): string[];
}

export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';

export interface PluralApi {
  operands(n: number | string): { i: number; v: number };
  pluralRu(n: number | string): PluralCategory;
}
