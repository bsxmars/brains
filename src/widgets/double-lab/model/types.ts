/** Поля double после разбора: знак, порядок как записан (0…2047), мантисса — 52 бита. */
export interface DoubleFields {
  sign: number;
  exponent: number;
  mantissa: bigint;
}

/** |x| = m · 2^e точно; `null` — бесконечность или NaN. */
export interface ExactParts {
  m: bigint;
  e: number;
}

/** Функции из строки `DOUBLE_CODE` темы — их же печатает страница и проверяет тест. */
export interface DoubleApi {
  decodeDouble(x: number): DoubleFields;
  encodeDouble(f: DoubleFields): number;
  fieldsToExact(f: Pick<DoubleFields, 'exponent' | 'mantissa'>): ExactParts | null;
  exactDecimal(x: number): string;
  nextAway(x: number): number;
}

/**
 * Готовое число для демо. Значение — 16 шестнадцатеричных цифр битов, а не `number`:
 * проп острова сериализуется, и `-0` с `NaN` по дороге не переживают. Тест сверяет `hex`
 * с битами выражения `label`.
 */
export interface DoublePreset {
  id: string;
  /** Выражение JS, которое даёт это число. */
  label: string;
  hex: string;
}
