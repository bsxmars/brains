/** Запись журнала учебного движка. Позиции — с нуля. */
export interface JournalEntry {
  /** Номер шага, на котором сделана запись. */
  step: number;
  /** `check` — проверка атома, `back` — возврат к точке выбора, `start` — сдвиг стартовой позиции. */
  kind: 'check' | 'back' | 'start';
  /** Кусок шаблона, о котором запись: `[начало, конец)` в исходном тексте шаблона. */
  at: [number, number];
  /** Позиция в строке. */
  pos: number;
  ok: boolean;
  text: string;
}

export interface MatchResult {
  /** `groups[0]` — всё совпадение, дальше группы по номерам; `undefined` — группа не участвовала. */
  match: { index: number; groups: (string | undefined)[] } | null;
  steps: number;
  backtracks: number;
  journal: JournalEntry[];
  /** Остановлен по лимиту шагов: ответа нет. */
  stopped: boolean;
}

export interface MatchOptions {
  /** Предел шагов; дальше движок сдаётся и возвращает `stopped: true`. */
  limit?: number;
  /** Сколько первых записей журнала сохранить. */
  log?: number;
}

export interface RegexEngine {
  parse(source: string): { root: unknown; groups: number };
  match(source: string, input: string, options?: MatchOptions): MatchResult;
}

/** Пример для пошагового журнала. */
export interface TraceExample {
  id: string;
  label: string;
  pattern: string;
  input: string;
  /** Подпись над примером. Строчная разметка. */
  note: string;
}

/** Пара «плохой шаблон — исправленный» для графика числа шагов. */
export interface GrowthSet {
  id: string;
  label: string;
  /** Строка длины n собирается как `unit.repeat(n) + tail`. */
  unit: string;
  tail: string;
  series: { pattern: string; label: string; bad: boolean }[];
  /** Подпись под графиком. Строчная разметка. */
  note: string;
}
