import type { DoubleApi, DoubleFields } from './types';

/**
 * Демо и тест спрашивают одни и те же функции — строку `DOUBLE_CODE` из темы.
 *
 * Строка напечатана на странице, собрана здесь `new Function` и прогоняется
 * `tests/unit/numbers.test.ts` против `Float64Array`, `toFixed` и `BigInt`. Копии нет — если
 * показанный код разойдётся с движком, покраснеет тест.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadDouble(code: string): DoubleApi {
  return new Function(
    `${code}\nreturn { decodeDouble, encodeDouble, fieldsToExact, exactDecimal, nextAway };`,
  )() as DoubleApi;
}

/** Биты из 16 шестнадцатеричных цифр — в поля. Без `number` посередине: так доезжают `-0` и NaN. */
export function fieldsFromHex(hex: string): DoubleFields {
  const bits = BigInt(`0x${hex}`);
  return {
    sign: Number(bits >> 63n),
    exponent: Number((bits >> 52n) & 0x7ffn),
    mantissa: bits & 0xfffffffffffffn,
  };
}

/** Поля — в 64 символа `0`/`1`: знак, 11 бит порядка, 52 бита мантиссы. */
export function bitString(f: DoubleFields): string {
  return (
    String(f.sign) +
    f.exponent.toString(2).padStart(11, '0') +
    f.mantissa.toString(2).padStart(52, '0')
  );
}

/** Строка из 64 бит — обратно в поля. */
export function fieldsFromBits(bits: string): DoubleFields {
  return {
    sign: Number(bits[0]),
    exponent: parseInt(bits.slice(1, 12), 2),
    mantissa: BigInt(`0b${bits.slice(12)}`),
  };
}

/** Печать числа так, как её видит читатель: `-0` отдельно, остальное — `String`. */
export function show(x: number): string {
  return Object.is(x, -0) ? '-0' : String(x);
}
