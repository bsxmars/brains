import type { WeightResult, WeightRow, WeightSample } from './types';

/**
 * Вес строки вживую: сколько единиц, точек, графем и байт в наборе образцов.
 *
 * Тема утверждает таблицей, что одна нелатинская буква удваивает **всю** строку. Это
 * измеримо прямо у читателя, и здесь оно меряется: `length`, спред, `Intl.Segmenter`
 * и `TextEncoder` отвечают на машине того, кто открыл страницу.
 *
 * Зачем модуль, а не логика в компоненте: ровно эти функции зовёт юнит-тест. Демо и тест
 * обязаны спрашивать движок одним и тем же кодом — иначе «проверено запуском» относится
 * к разовому запуску, которого больше никто не повторит (тот же довод, что
 * у `widgets/clone-survival` и `widgets/ic-bench`).
 *
 * ⚠️ **Граница честности.** Внутреннее представление строки из JS не наблюдаемо:
 * `%DebugPrint` требует `--allow-natives-syntax` у самого бинарника, а сайт собирается
 * статически. Поэтому стенд ничего не спрашивает у движка о представлении. Он **делает
 * вывод** из кодов символов — и обязан говорить это вслух, как `widgets/ic-bench` говорит
 * про состояние площадки inline cache.
 *
 * Правило вывода проверено запуском (Node 26.8, `--allow-natives-syntax`):
 *
 * | строка | что печатает `%DebugPrint` |
 * |---|---|
 * | латиница | `INTERNALIZED_ONE_BYTE_STRING_TYPE` |
 * | латиница и одна «я» | `INTERNALIZED_TWO_BYTE_STRING_TYPE` |
 * | латиница и один ☀ (U+2600, **одна** единица) | `INTERNALIZED_TWO_BYTE_STRING_TYPE` |
 * | латиница и один 😀 (суррогатная пара) | `INTERNALIZED_TWO_BYTE_STRING_TYPE` |
 *
 * То есть двухбайтность даёт **выход за латиницу-1**, а не суррогатная пара: ☀ занимает
 * одну кодовую единицу и переводит строку в двухбайтную ровно так же, как пара.
 *
 * ⚠️ `Intl.Segmenter` и `TextEncoder` создаются **внутри функций**: остров сперва рендерится
 * в Node, и конструктор на уровне модуля уронил бы не остров, а сборку всей страницы.
 */

/** Граница однобайтного представления: латиница-1 — это первые 256 кодовых точек. */
export const LATIN1_MAX = 0xff;

/**
 * Набор образцов.
 *
 * Первые два — пара, ради которой стенд и написан: **одинаковая длина**, разница в UTF-8
 * ровно в один байт, а вес в памяти отличается вдвое. Третий показывает, что сплошная
 * кириллица не дороже латиницы с одной буквой. Четвёртый и пятый разводят два повода
 * для двухбайтности, которые обычно путают: выход за латиницу-1 и суррогатную пару.
 */
export const WEIGHT_SAMPLES: WeightSample[] = [
  {
    key: 'latin',
    label: 'чистая латиница',
    value: 'the quick brown fox jumps!',
    note: 'Все коды ≤ U+00FF — строка однобайтная. Байт ровно столько же, сколько знаков.',
  },
  {
    key: 'one-cyrillic',
    label: 'латиница и одна «я»',
    value: 'the quick brown fox jumpsя',
    note: 'Та же длина, что у строки выше, и на один байт больше в UTF-8. А в памяти — вдвое: одна буква переводит в двухбайтное представление всю строку целиком.',
  },
  {
    key: 'cyrillic',
    label: 'целиком кириллица',
    value: 'быстрая бурая лиса прыгает!',
    note: 'Сплошная кириллица не дороже латиницы с одной «я»: платить дважды за единицу строка начинает с первого же нелатинского знака.',
  },
  {
    key: 'bmp-emoji',
    label: 'эмодзи основной плоскости ☀',
    value: 'the quick brown fox ☀',
    note: 'U+2600 — это одна кодовая единица, суррогатной пары здесь нет. Строка всё равно двухбайтная: дело в выходе за U+00FF, а не в паре.',
  },
  {
    key: 'surrogate-emoji',
    label: 'эмодзи-суррогат 😀',
    value: 'the quick brown fox 😀',
    note: 'U+1F600 выше U+FFFF, поэтому пара: length на единицу больше числа кодовых точек. На двухбайтность это уже ничего не добавляет — она наступила бы и без пары.',
  },
];

/** Есть ли чем считать байты. Ветка «среды нет» честная: числа не выдумываются. */
export function encoderReady(): boolean {
  return typeof TextEncoder === 'function';
}

/** Есть ли чем считать графемы. */
export function segmenterReady(): boolean {
  return typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function';
}

/**
 * Графемы — то, что человек считает одним символом.
 *
 * ⚠️ Функция повторяет такую же в `widgets/unicode-inspector`, и это не небрежность:
 * виджет не импортирует виджет (AGENTS.md, «Слои»). Общее место здесь — три строки,
 * и тащить их в `shared` ради двух вызовов дороже, чем повторить.
 */
function graphemeCount(value: string): number {
  if (!segmenterReady()) return [...value].length;
  return [...new Intl.Segmenter('ru', { granularity: 'grapheme' }).segment(value)].length;
}

/** Наибольший код кодовой единицы в строке. Пустая строка даёт 0. */
export function maxCharCode(value: string): number {
  let max = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code > max) max = code;
  }
  return max;
}

/**
 * Первый знак, выводящий строку за латиницу-1. Пустая строка — значит такого знака нет.
 *
 * ⚠️ Возвращается **кодовая точка целиком**, а не та кодовая единица, которая первой превысила
 * `U+00FF`. Для эмодзи вне основной плоскости это разные вещи: правило срабатывает на верхнем
 * суррогате `U+D83D`, но половина пары знаком не является и рисуется квадратиком. Читателю
 * называют 😀 (`U+1F600`) — то, что он видит. На сам вывод о двухбайтности выбор не влияет:
 * обе величины выше `U+00FF`, а считается он всё равно по кодовым единицам (`maxCharCode`).
 */
export function firstAboveLatin1(value: string): string {
  for (const char of value) {
    if ((char.codePointAt(0) ?? 0) > LATIN1_MAX) return char;
  }
  return '';
}

/**
 * Взвесить один образец.
 *
 * Считанное и выведенное лежат в разных полях намеренно: `units`, `points`, `graphemes`
 * и `utf8` — ответы движка, `twoByte`, `storage` и `bytesPerUnit` — следствие правила,
 * записанного в докстринге модуля.
 */
export function weighSample(sample: WeightSample): WeightRow {
  const value = sample.value;
  const units = value.length;
  const points = [...value].length;
  const utf8 = new TextEncoder().encode(value).length;

  const maxCode = maxCharCode(value);
  const twoByte = maxCode > LATIN1_MAX;
  const culprit = twoByte ? firstAboveLatin1(value) : '';
  const storage = units * (twoByte ? 2 : 1);

  return {
    ...sample,
    units,
    points,
    graphemes: graphemeCount(value),
    utf8,
    maxCode,
    culprit,
    culpritHex: culprit ? (culprit.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0') : '',
    twoByte,
    storage,
    bytesPerUnit: units > 0 ? storage / units : 0,
    utf8PerPoint: points > 0 ? utf8 / points : 0,
  };
}

/** Взвешивание не состоялось: считать байты нечем. Числа не выдуманы, а отсутствуют. */
export function unavailable(): WeightResult {
  return {
    ok: false,
    rows: [],
    segmented: false,
    note: 'В этой среде нет `TextEncoder` — считать байты нечем, и придуманных чисел здесь не будет.',
  };
}

/**
 * Взвесить весь набор. Это и есть точка входа юнит-теста.
 *
 * Числа тут не машинозависимы — в отличие от замеров времени, это счёт, а не хронометраж:
 * `length`, кодовые точки и байты UTF-8 заданы стандартом, и тест вправе сверять их
 * дословно, а не отношением.
 */
export function weighAll(samples: WeightSample[] = WEIGHT_SAMPLES): WeightResult {
  if (!encoderReady()) return unavailable();

  const segmented = segmenterReady();
  return {
    ok: true,
    rows: samples.map(weighSample),
    segmented,
    note: segmented
      ? 'Единицы, точки и байты посчитаны движком; графемы — `Intl.Segmenter`. Строка «в памяти» — вывод из кодов, а не ответ V8.'
      : 'В этой среде нет `Intl.Segmenter`: вместо графем показаны кодовые точки. На составном эмодзи это число завышено.',
  };
}
