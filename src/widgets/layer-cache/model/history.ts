/**
 * Разбор вывода `docker history` и арифметика размеров.
 *
 * Зачем это код, а не три числа в тексте. Все веса в теме сняты с живого демона, но снятое
 * надо ещё правильно сложить — а `docker history` печатает **округлённые** значения («6.86MB»,
 * «30.7kB»), и сумма таких строк никогда не совпадает с настоящим размером образа до байта.
 * Здесь один разбор на всю тему и одно место, где записано, что с чем сравнивать: сумма слоёв
 * сходится с `docker image inspect` только **в пределах округления**, и тест это и проверяет,
 * а не требует точного равенства.
 *
 * Единицы у Docker десятичные: `MB` — это 10⁶, а не 2²⁰. Проверяется это сложением: базовый
 * `node:22-alpine` весит 160 879 790 байт по `inspect`, и его слои печатаются как 8.66MB,
 * 147MB и 5.37MB — в 1000-й системе они дают 161.03 МБ, в 1024-й разъехались бы вдвое.
 */

/** Одна запись `docker history --format '{{json .}}'` — в тех полях, что нужны теме. */
export interface HistoryRow {
  /** Инструкция, создавшая слой, как её записал сборщик. */
  CreatedBy: string;
  /** Размер строкой, как его напечатал Docker: «6.86MB», «235B», «0B». */
  Size: string;
}

/** Слой с разобранным весом. */
export interface Layer {
  createdBy: string;
  bytes: number;
}

/** Десятичные приставки Docker: `kB` — тысяча байт, а не 1024. */
const UNITS: Record<string, number> = {
  B: 1,
  kB: 1e3,
  KB: 1e3,
  MB: 1e6,
  GB: 1e9,
  TB: 1e12,
};

/**
 * «6.86MB» → 6 860 000.
 *
 * Обратите внимание: это **не** обратимая операция. Строка уже округлена Docker’ом, и вернуть
 * из неё исходные байты нельзя — можно только восстановить порядок величины. Отсюда и все
 * допуски в тесте.
 */
export function parseSize(text: string): number {
  const match = /^([\d.]+)\s*([a-zA-Z]+)$/.exec(text.trim());
  if (!match) throw new Error(`Не разобрать размер слоя: «${text}»`);

  const [, value, unit] = match;
  const scale = UNITS[unit];
  if (scale === undefined) throw new Error(`Неизвестная единица размера: «${unit}»`);

  return Number(value) * scale;
}

/**
 * Строки `docker history --format '{{json .}}'` → слои.
 *
 * Порядок сохраняется тот же, что печатает Docker: **сверху новые**. Поэтому слои приложения
 * идут первыми, а хвост списка — это базовый образ.
 */
export function parseHistory(jsonl: string): Layer[] {
  return jsonl
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const row = JSON.parse(line) as HistoryRow;
      return { createdBy: row.CreatedBy, bytes: parseSize(row.Size) };
    });
}

/**
 * Слои, которые добавила сборка, — без слоёв базового образа.
 *
 * `baseRowCount` — длина `docker history` самого базового образа. Считать её приходится
 * снаружи: в истории готового образа нет отметки «отсюда начинается база», строки базы
 * ничем не отличаются от своих.
 */
export function appLayers(layers: Layer[], baseRowCount: number): Layer[] {
  return layers.slice(0, Math.max(0, layers.length - baseRowCount));
}

/** Сумма весов — столько сборка добавила поверх базы. */
export function sumBytes(layers: Layer[]): number {
  return layers.reduce((total, layer) => total + layer.bytes, 0);
}

/**
 * Сколько образ весит сверх своей базы.
 *
 * Это и есть «цена приложения», и считать её надо вычитанием по `inspect`, а не сложением
 * округлённых строк истории: вычитание точное.
 */
export function deltaOverBase(imageSize: number, baseSize: number): number {
  return imageSize - baseSize;
}

/** Первый слой, в инструкции которого встречается подстрока, — для «а сколько весит `npm ci`». */
export function findLayer(layers: Layer[], needle: string): Layer | undefined {
  return layers.find((layer) => layer.createdBy.includes(needle));
}
