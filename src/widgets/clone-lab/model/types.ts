/** Учебные реализации из темы, собранные `new Function` (см. `run.ts`). */
export interface CloneImpl {
  stringify(value: unknown, replacer?: unknown, space?: unknown): string | undefined;
  clone<T>(value: T): T;
}

/** Значение-пример для демо: тело функции, которое возвращает значение. */
export interface CloneSample {
  id: string;
  label: string;
  /** Тело функции: `new Function(code)()` возвращает свежий экземпляр значения. */
  code: string;
  /** Подпись над примером. Строчная разметка. */
  note: string;
}

export type MethodId = 'spread' | 'json' | 'clone';

export interface MethodResult {
  id: MethodId;
  /** Выражение, которым снята копия, — подпись колонки. */
  label: string;
  /** Копия, напечатанная `show`, или `null`, если способ бросил исключение. */
  shown: string | null;
  /** Имя и текст исключения, если способ бросил. */
  error: string | null;
  /** Что потерялось по дороге — строки со строчной разметкой. */
  losses: string[];
  /**
   * Сверка учебной функции с настоящей в этом движке: `same` / `differs`;
   * `null` — у способа нет учебной реализации (спред).
   */
  native: 'same' | 'differs' | null;
}
