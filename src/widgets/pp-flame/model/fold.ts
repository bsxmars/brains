import type { FlameSample, FoldApi, StandProfile } from './types';

/**
 * Демо и тест сворачивают профиль одним и тем же кодом — строкой `FOLD_CODE` из `data.ts`.
 *
 * Строка напечатана в теме целиком, и её же здесь собирает `new Function`: копии нет,
 * поэтому то, что читатель видит, и то, что рисует flame graph, разойтись не могут.
 * `tests/unit/continuous-profiling.test.ts` кормит ту же строку настоящим профилем
 * из отдельного процесса Node и сверяет суммы.
 *
 * Ни DOM, ни Vue — чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadFold(code: string): FoldApi {
  return new Function(code)() as FoldApi;
}

/** Литерал стенда → список сэмплов, который принимает `fold`. */
export function expandProfile(profile: StandProfile): FlameSample[] {
  return profile.samples.map(([stack, bytes, count]) => ({
    stack: profile.stacks[stack].map((i) => profile.frames[i]),
    bytes,
    count,
  }));
}

/** Байты — в КБ или МБ, чтобы подпись помещалась в узкий прямоугольник. */
export function fmtBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${bytes} Б`;
}

/** Доля в процентах с одним знаком — и «<0.1%», чтобы тонкий кадр не выглядел нулём. */
export function fmtShare(part: number, whole: number): string {
  if (whole <= 0) return '—';
  const pct = (part / whole) * 100;
  if (pct > 0 && pct < 0.1) return '<0.1%';
  return `${pct.toFixed(1)}%`;
}

/** Имя функции без файла и строки: `renderCatalog stand.mjs:5` → `renderCatalog`. */
export function shortName(frame: string): string {
  return frame.split(' ')[0];
}
