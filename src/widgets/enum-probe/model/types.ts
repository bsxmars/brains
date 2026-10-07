/**
 * Категория ключа — те самые колонки, что стояли в булевой матрице перечисления.
 *
 * Символов два, а не один: `enumerable` у символа работает так же, как у строки, и разница
 * между спредом и `getOwnPropertySymbols` видна только когда рядом лежат оба.
 */
export type KeyKind = 'own-enum' | 'own-hidden' | 'symbol-enum' | 'symbol-hidden' | 'inherited';

/** Девять операций перечисления. */
export type EnumOp =
  | 'for-in'
  | 'keys'
  | 'values'
  | 'spread'
  | 'assign'
  | 'json'
  | 'names'
  | 'symbols'
  | 'ownKeys';

/** Один элемент из того, что операция реально вернула, вместе с его категорией. */
export interface EnumHit {
  label: string;
  kind: KeyKind;
}

/** Итог одного настоящего вызова. */
export interface EnumRun {
  /** Выражение, которое исполнилось. */
  code: string;
  hits: EnumHit[];
  /** Возвращённое значение целиком, как его напечатала бы консоль. */
  raw: string;
  note: string;
}
