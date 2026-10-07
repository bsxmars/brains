import type { VlWindow } from './types';

/**
 * Демо и тест считают окно одним и тем же кодом — строкой `WINDOW_CODE` из темы.
 *
 * Строка напечатана на странице, здесь она собирается `new Function`, и тот же вызов делает
 * `tests/unit/virtual-lists.test.ts`. Копии на TypeScript нет намеренно: она проверяла бы
 * саму себя, а не то, что читает читатель.
 *
 * Ни DOM, ни Vue: модуль импортирует юнит-тест.
 */
export function loadWindow(code: string): VlWindow {
  return new Function(
    `"use strict";\n${code}\nreturn { fixedRange, prefixSums, countBefore, variableRange, applyMeasured, withSticky };`,
  )() as VlWindow;
}

/**
 * Высота строки в режиме «разная высота» задаётся **содержимым**, а не числом: у строки
 * 0–2 дополнительные строчки текста. Число строчек детерминировано номером строки — иначе
 * тест и демо разошлись бы на случайности, — но настоящую высоту знает только раскладка.
 */
export function extraLines(i: number): number {
  // Кнут, мультипликативный хеш: соседние номера дают разное число строчек.
  return ((Math.imul(i + 1, 2654435761) >>> 0) % 7) % 3;
}

/** Разряды пробелом — как в соседних демо курса, без зависимости от ICU. */
export function groups(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
