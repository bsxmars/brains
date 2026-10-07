/**
 * Переход часов в зоне: момент по UTC и смещения до и после него.
 * Смещения — в минутах к востоку от Гринвича: Берлин зимой `60`, Нью-Йорк зимой `-300`.
 */
export interface Transition {
  /** Момент перехода, миллисекунды от эпохи (UTC). */
  at: number;
  before: number;
  after: number;
}

/** Таблица переходов одной зоны на отрезке времени — снята стендом (см. шапку `data.ts` темы). */
export interface ZoneTable {
  /** Имя зоны IANA. */
  zone: string;
  /** Версия tzdata, по которой снята таблица. */
  tzdata: string;
  transitions: Transition[];
}

/** Сценарий демо: таблица зоны и переход, вокруг которого рисуется лента времени. */
export interface TzScenario {
  id: string;
  label: string;
  table: ZoneTable;
  /** Номер перехода в `table.transitions`, вокруг которого лента. */
  focus: number;
  /** Шаг ленты, минуты. */
  step: number;
  /** Сколько минут ленты до и после разрыва или повтора. */
  around: number;
  /** Подпись над лентой. Строчная разметка. */
  note: string;
}

export type Disambiguation = 'compatible' | 'earlier' | 'later' | 'reject';

export interface Candidate {
  /** Смещение, которое пробуем, минуты. */
  offset: number;
  /** `local − offset`: момент, который получился бы с этим смещением. */
  utc: number;
  /** Жила ли зона в этот момент с этим смещением. */
  fits: boolean;
}

/** Функции из строки `LOCAL_TO_UTC_CODE`. `local` — время на часах, записанное как `Date.UTC(…)`. */
export interface TzApi {
  offsetAt(table: Transition[], utc: number): number;
  candidates(table: Transition[], local: number): Candidate[];
  localToUtc(table: Transition[], local: number, disambiguation?: Disambiguation): number;
}
