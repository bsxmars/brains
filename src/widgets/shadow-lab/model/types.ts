/**
 * Типы демо «Стили веб-компонентов».
 *
 * Правила, которые включает читатель, лежат в данных темы (`SD_RULES`): тот же текст печатается
 * на странице и исполняется прогоном. Модуль прогона знает только, куда правило положить
 * и на каком элементе смотреть результат.
 */

/** Куда кладётся правило: лист документа, `<style>` внутри теневого корня или общий сконструированный лист. */
export type SdSide = 'page' | 'shadow' | 'adopted';

/** Элемент, на котором снимается итоговое значение. */
export type SdTarget = 'host' | 'title' | 'body' | 'slotted' | 'title-b';

export interface SdRule {
  key: string;
  side: SdSide;
  /** На каком элементе видно действие правила. */
  target: SdTarget;
  /** Токен цвета, который правило ставит: по нему итоговое значение узнаётся как «от этого правила». */
  token: string;
  /** CSS как напечатан и как исполняется. */
  css: string;
  /** Подпись на переключателе и в столбце «откуда». Строчная разметка. */
  label: string;
}

/** Правило из собственного листа компонента, которое действует всегда. */
export interface SdBase {
  target: SdTarget;
  token: string;
  label: string;
}

/** Откуда пришло значение: ключ правила, внутреннее правило или наследование. */
export type SdSource =
  | { kind: 'rule'; key: string }
  | { kind: 'base' }
  | { kind: 'inherited'; from: 'page' | 'slot' }
  | { kind: 'unknown' };

export interface SdReading {
  target: SdTarget;
  /** `getComputedStyle(…).color` как его отдал браузер. */
  value: string;
  source: SdSource;
}

export interface SdFonts {
  /** Шрифт родителя хоста — то есть страницы вокруг демо. */
  page: string;
  /** Шрифт абзаца внутри теневого дерева, у которого своего `font-family` нет. */
  inner: string;
  /** Шрифт `<button>` внутри теневого дерева. */
  button: string;
}

/** Строка таблицы «что проходит через границу»: вывод в трёх движках, снятый стендом. */
export interface BoundaryRow {
  key: string;
  /** Что проверяется — строчная разметка. */
  what: string;
  chromium: boolean;
  firefox: boolean;
  webkit: boolean;
}
