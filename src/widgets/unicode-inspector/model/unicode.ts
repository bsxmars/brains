/**
 * Разбор строки по уровням Юникода: кодовые единицы, точки, графемы, байты UTF-8.
 *
 * Зачем отдельный модуль, а не логика внутри компонента: ровно эти функции зовёт юнит-тест.
 * Демо и тест обязаны спрашивать движок одним и тем же кодом — иначе «проверено запуском»
 * относится к тому разовому запуску, которого больше никто не повторит (тот же довод,
 * что у `widgets/clone-survival` и `widgets/ic-bench`).
 *
 * ⚠️ **`Intl.Segmenter` и `TextEncoder` создаются внутри функций, а не на уровне модуля.**
 * Остров сперва рендерится в Node, и модуль исполняется там целиком. Конструктор на верхнем
 * уровне уронил бы не остров, а сборку всей страницы — ровно так это уже случилось
 * в `widgets/two-models/model/bus.ts`.
 *
 * ⚠️ **Граница наблюдаемого.** Внутреннее представление строки (`SeqOneByteString` против
 * `SeqTwoByteString`) из JS не видно: `%DebugPrint` требует `--allow-natives-syntax`
 * у самого бинарника. Поэтому `isTwoByte` и `storageBytes` — это **вывод из кодов символов**,
 * а не ответ движка. Правило вывода проверено запуском (Node 26.8, `--allow-natives-syntax`):
 * строка из латиницы с одной «я» и строка с одним знаком ☀ — обе
 * `INTERNALIZED_TWO_BYTE_STRING_TYPE`, то есть двухбайтность даёт выход за латиницу-1,
 * а не суррогатная пара.
 */

/** Верхняя половина суррогатной пары. По отдельности текстом не является. */
const HIGH_SURROGATE: readonly [number, number] = [0xd800, 0xdbff];

/** Нижняя половина суррогатной пары. */
const LOW_SURROGATE: readonly [number, number] = [0xdc00, 0xdfff];

/**
 * Граница однобайтного представления. Именно `U+00FF`, а не `U+007F`: латиница-1 — это
 * первые 256 кодовых точек, и `é`, `©`, `±` в неё входят.
 */
export const LATIN1_MAX = 0xff;

export function isHighSurrogate(code: number): boolean {
  return code >= HIGH_SURROGATE[0] && code <= HIGH_SURROGATE[1];
}

export function isLowSurrogate(code: number): boolean {
  return code >= LOW_SURROGATE[0] && code <= LOW_SURROGATE[1];
}

/** `U+0444` печатается как `0444`: четыре знака, как принято в кодовых таблицах. */
export function hex(code: number): string {
  return code.toString(16).toUpperCase().padStart(4, '0');
}

export type UnitKind = 'plain' | 'high' | 'low';

/** Одна кодовая единица UTF-16 — ровно то, что считает `.length` и режет `slice`. */
export interface CodeUnit {
  /** Индекс единицы: по нему же ползунок демо делает разрез. */
  i: number;
  code: number;
  hex: string;
  kind: UnitKind;
  /** Сам знак, если он самостоятельный. У половинки суррогатной пары знака нет. */
  char: string;
}

/** Кодовые единицы UTF-16: то, чем измеряет длину сам язык. */
export function codeUnits(value: string): CodeUnit[] {
  return Array.from({ length: value.length }, (_, i) => {
    const code = value.charCodeAt(i);
    const kind: UnitKind = isHighSurrogate(code) ? 'high' : isLowSurrogate(code) ? 'low' : 'plain';
    return { i, code, hex: hex(code), kind, char: kind === 'plain' ? value[i] : '' };
  });
}

/** Кодовые точки: то, что перебирают спред, `for…of` и `codePointAt`. */
export function codePoints(value: string): string[] {
  return [...value];
}

/** Есть ли в среде сегментатор. Ветка «среды нет» честная: графемы не выдумываются. */
export function segmenterReady(): boolean {
  return typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function';
}

/**
 * Графемы — то, что человек считает одним символом.
 *
 * Без сегментатора отдаются кодовые точки: это не тот же ответ, и он заведомо завышен
 * на составных эмодзи. Отличить один случай от другого позволяет `segmenterReady()`.
 */
export function graphemes(value: string): string[] {
  if (!segmenterReady()) return codePoints(value);
  const segmenter = new Intl.Segmenter('ru', { granularity: 'grapheme' });
  return [...segmenter.segment(value)].map((part) => part.segment);
}

export function graphemeCount(value: string): number {
  return graphemes(value).length;
}

/** Есть ли чем считать байты. */
export function encoderReady(): boolean {
  return typeof TextEncoder === 'function';
}

/**
 * Вес строки в UTF-8 — то, во что она превратится в сети и в файле.
 *
 * `null` означает «в этой среде нет `TextEncoder`»: числа здесь не досчитываются вручную,
 * потому что вручную посчитанное уже не было бы ответом движка.
 */
export function utf8Bytes(value: string): number | null {
  if (!encoderReady()) return null;
  return new TextEncoder().encode(value).length;
}

/** Наибольший код единицы в строке. Пустая строка даёт 0. */
export function maxCharCode(value: string): number {
  let max = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code > max) max = code;
  }
  return max;
}

/**
 * Вывод о двухбайтности: одна кодовая единица выше `U+00FF` переводит в двухбайтное
 * представление **всю строку целиком**, а не только эту единицу.
 *
 * ⚠️ Это вывод, а не наблюдение — см. докстринг модуля.
 */
export function isTwoByte(value: string): boolean {
  return maxCharCode(value) > LATIN1_MAX;
}

/** Сколько байт уйдёт на сами знаки. Заголовок объекта строки сюда не входит. */
export function storageBytes(value: string): number {
  return value.length * (isTwoByte(value) ? 2 : 1);
}

/** Что осталось от строки после разреза по кодовым единицам. */
export interface SliceReport {
  text: string;
  units: number;
  points: number;
  graphemes: number;
  /** Разрез прошёл внутри суррогатной пары: осталась одинокая верхняя половина. */
  broken: boolean;
}

/**
 * Срез по кодовым единицам — ровно то, что делает `slice`.
 *
 * Разрыв пары определяется по последней оставшейся единице: если она верхний суррогат,
 * его нижняя половина осталась за срезом. Получается валидная JS-строка и невалидный текст.
 */
export function sliceUnits(value: string, cut: number): SliceReport {
  const limit = Math.min(Math.max(cut, 0), value.length);
  const text = value.slice(0, limit);
  return {
    text,
    units: text.length,
    points: codePoints(text).length,
    graphemes: graphemeCount(text),
    broken: limit > 0 && isHighSurrogate(value.charCodeAt(limit - 1)),
  };
}
