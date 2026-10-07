import type { TzApi } from './types';

/**
 * Демо и тест спрашивают одни и те же функции — строку `LOCAL_TO_UTC_CODE` из темы.
 *
 * Строка напечатана на странице, собрана здесь `new Function` и прогоняется
 * `tests/unit/time-dates.test.ts` против `Temporal.ZonedDateTime` из `temporal-polyfill`
 * (все четыре значения `disambiguation`) и против `Date` в отдельных процессах Node с `TZ=…`.
 * Копии нет — если показанный код разойдётся с ними, покраснеет тест.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadTz(code: string): TzApi {
  return new Function(`${code}\nreturn { offsetAt, candidates, localToUtc };`)() as TzApi;
}

const MINUTE = 60_000;

/** `+05:45`, `-04:00` — подпись смещения. Это вывод, а не расчёт. */
export function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/** «Время на часах» в виде `2026-03-29 02:30`. */
export function formatWall(local: number): string {
  return new Date(local).toISOString().slice(0, 16).replace('T', ' ');
}

/** Момент UTC в виде `2026-03-29T01:30Z`. */
export function formatUtc(utc: number): string {
  return `${new Date(utc).toISOString().slice(0, 16)}Z`;
}

/** Момент глазами зоны: время на часах и смещение, как пишет Temporal. */
export function formatZoned(utc: number, offset: number): string {
  return `${new Date(utc + offset * MINUTE).toISOString().slice(11, 16)}${formatOffset(offset)}`;
}
