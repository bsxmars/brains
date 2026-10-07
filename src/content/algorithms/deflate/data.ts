import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { DeflateCodes, DeflatePreset } from '@/widgets/deflate-lab/model/types';

/**
 * Данные темы «Что внутри gzip: LZ77 и коды Хаффмана».
 *
 * Тема написана здесь, 2026-10-02, для направления «Алгоритмы во фронтенде». HTTP-сторона
 * сжатия (`Accept-Encoding`, уровни на файлах сайта, словари, BREACH) — в «Сжатии в вебе»,
 * здесь одной фразой со ссылкой. CRC-32 — в «Бинарных данных», раздел «Разбор PNG»; статический
 * канонический код Хаффмана HPACK — в «HTTP/2 и HTTP/3», раздел «HPACK»; `CompressionStream`
 * как трансформ — в «Стримах», раздел «Итерация и байты». Здесь — алгоритмы и формат.
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * Node **24.11.0** (`zlib` 1.3.1, brotli и zstd встроенные), fflate **0.8.3**, pako **1.0.11**
 * из `node_modules` курса; Chromium **153.0.8010.12** (Playwright 1.63, headless shell),
 * macOS arm64, октябрь 2026. Скрипты стенда — в scratchpad автора, не в репозитории;
 * свой `node:http` на порту 5010.
 *
 * Что снято:
 *   — функции темы (`LZ77_CODE` … `BITS_CODE`) сверены с zlib, fflate и pako: учебный
 *     `inflateRaw` распаковал их вывод на уровнях 0–9 (у zlib — ещё со стратегиями `Z_FIXED`,
 *     `Z_HUFFMAN_ONLY`, `Z_RLE`) на восьми наборах байт, 480 потоков из 480 — байт в байт и
 *     ровно до конца потока. Это повторяет тест;
 *   — `blockBits`, применённый к токенам, которые выбрал сам zlib, даёт ровно столько бит
 *     данных, сколько их в блоке zlib (688 на `HTML_SAMPLE`): значит длины кодов из
 *     `huffmanLengths` так же оптимальны, как у zlib;
 *   — `FIB_*`: частоты, на которых дерево Хаффмана выходит глубже 15 бит; `huffmanLengths`
 *     даёт те же длины, что zlib в своём dynamic-блоке (`Z_HUFFMAN_ONLY`), символ в символ;
 *   — `LEVEL_ROWS`: размеры `deflateRawSync` по уровням на `vue.global.prod.js` (Vue 3.5.42,
 *     167 536 байт, sha-256 `aae6339a0e744cc3…`) и учебный `lz77` с параметрами того же уровня.
 *     Таблица параметров — `configuration_table` из исходника zlib; тест читает её из исходника
 *     pako (порт zlib, таблица та же), там же — правило `TOO_FAR` и `NIL = 0`;
 *   — `HEADER_ROWS`, `HTML_SIZES`: заголовок dynamic-блока zlib уровня 6 на `HTML_SAMPLE`;
 *   — `ENTROPY_ROWS`, `WINDOW_ROWS`, `AAA_ZLIB`, `BLAH_ZLIB`: байты, детерминированы;
 *     случайные данные — xorshift32 с заданным зерном (`xorshift` в тесте);
 *   — Chromium (литерал, в тест не входит — нужен браузер): `CompressionStream` для `gzip`,
 *     `deflate` и `deflate-raw` выдал байт в байт то же, что `zlib` Node уровня 6, на
 *     `HTML_SAMPLE` и на `platform/compression/data.ts` (байт ОС в заголовке — 19 у обоих).
 *     Ответы своего сервера: `Content-Encoding: deflate` с «голым» DEFLATE без обёртки zlib —
 *     распакован; два gzip-члена подряд — `fetch` вернул только первый; испорченные CRC-32
 *     и ISIZE — текст отдан без ошибки. `DecompressionStream('gzip')` на тех же двух случаях
 *     бросил `TypeError`. В Node `gunzipSync` склеивает оба члена и на плохой CRC бросает
 *     `Z_DATA_ERROR` — это тест повторяет.
 *
 * Что по документации, а не снято: смысл колонок `configuration_table` и то, что на уровнях
 * 1–3 колонка `lazy` значит «не вставлять в цепочку позиции внутри длинного совпадения»
 * (комментарии исходника zlib); байт ОС 3 на Linux (`zutil.h`); устройство Brotli
 * (статический словарь, контекстное моделирование — RFC 7932) и zstd (FSE/ANS — RFC 8878);
 * слабость Adler-32 на коротких данных (RFC 3309).
 *
 * Пересобирает всё, кроме Chromium, `tests/unit/deflate.test.ts`.
 */

const n = (x: number) => x.toLocaleString('ru-RU');

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const PLAIN_DEFLATE =
  'Как конспект лекции. Повторившуюся фразу вы не переписываете, а ставите «см. выше, строка 3, пять слов» — это LZ77. А слова, которые встречаются постоянно, сокращаете: «т. к.», «напр.», — и чем слово частее, тем короче сокращение. Это Хаффман. Конспект читается без лектора: всё нужное для расшифровки лежит в нём самом.';

export const GLOSSARY = [
  {
    k: 'DEFLATE',
    d: 'Формат сжатых данных из RFC 1951. Внутри gzip, zlib, PNG, zip и `Content-Encoding: gzip` лежит именно он, обёртки отличаются только заголовком и контрольной суммой.',
  },
  {
    k: 'литерал',
    d: 'Байт, записанный как есть: повтора для него не нашлось.',
  },
  {
    k: 'ссылка, пара (расстояние, длина)',
    d: '«Вернись на `расстояние` байт назад и скопируй `длину` байт». Расстояние в DEFLATE — от 1 до 32 768, длина — от 3 до 258.',
  },
  {
    k: 'окно',
    d: 'Сколько последних байт сжатие помнит и может назвать ссылкой. У DEFLATE — 32 КБ. Повтор дальше окна для него не существует.',
  },
  {
    k: 'код Хаффмана',
    d: 'Запись символов кодами разной длины: частым — короткие, редким — длинные. Длины подбираются по частотам так, чтобы сумма бит была наименьшей.',
  },
  {
    k: 'префиксный код',
    d: 'Набор кодов, где ни один не начинается с другого. Тогда разделители не нужны: читаешь биты, пока не совпал код, — это и есть граница символа.',
  },
  {
    k: 'блок',
    d: 'Кусок потока DEFLATE со своим заголовком. Тип блока говорит, как записаны данные: как есть, готовыми кодами из RFC или своими кодами, таблица которых лежит в заголовке.',
  },
  {
    k: 'extra-биты',
    d: 'Несколько бит сразу после кода длины или расстояния. Код называет диапазон («длина 19–22»), extra-биты — точное число в нём.',
  },
];

export const PREREQ_NOTE =
  'Тема опирается на три вещи из других тем и на одну, которой на сайте нет, — она объяснена прямо на карточке.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'Сжатие в HTTP',
    d: 'Браузер пишет в `Accept-Encoding`, что умеет распаковать, сервер выбирает и называет выбранное в `Content-Encoding`. Распаковывает браузер сам, скрипт видит готовый текст.',
    href: '/platform/compression/#s1',
    hrefLabel: '«Сжатие в вебе», раздел «Договор заголовков»',
    tone: 'info',
  },
  {
    t: 'Байты и порядок байт',
    d: '`Uint8Array`, `DataView`, little-endian и big-endian: в каком порядке многобайтовое число лежит в памяти. Обёртки gzip и zlib пишут свои числа по-разному.',
    href: '/js/binary-data/#s3',
    hrefLabel: '«Бинарные данные», раздел «Порядок байт»',
    tone: 'info',
  },
  {
    t: 'Контрольная сумма CRC-32',
    d: 'Четыре байта, посчитанные из данных: изменился бит — сумма не сойдётся. gzip кладёт её в хвост, как PNG — в каждый блок, и функция та же.',
    href: '/js/binary-data/#s7',
    hrefLabel: '«Бинарные данные», раздел «Разбор PNG»',
    tone: 'info',
  },
  {
    t: 'Биты внутри числа',
    d: '`x & 1` — младший бит, `x >> 3` — сдвиг на три бита вправо, `code * 2 + bit` — дописать бит справа. Код темы читает поток по одному биту только этими действиями.',
    tone: 'info',
  },
];

// ─── LZ77: ссылки назад ────────────────────────────────────────────────────────────────────

export const PLAIN_LZ77 =
  'Как диктовать телефонный номер «восемь-девятьсот-двадцать-два, двадцать-два, двадцать-два». Вы не повторяете цифры, а говорите: «и ещё дважды последние две». Получатель записывает их сам, глядя на уже записанное. LZ77 делает так с байтами: вместо повтора — ссылка на то, что получатель уже распаковал.';

/** Маленький пример раздела: пять литералов, одна ссылка с перекрытием, ещё литерал. */
export const BLAH_TEXT = 'blah blah blah blah!';

export const BLAH_TOKENS = [
  { k: '`b` `l` `a` `h` `␠`', d: 'пять литералов: повторять пока нечего' },
  { k: '`(5, 14)`', d: 'назад на 5, скопировать 14: `blah blah blah`' },
  { k: '`!`', d: 'литерал' },
];

export const BLAH_NOTE =
  'Двадцать байт стали семью токенами. Ссылка `(5, 14)` копирует **больше, чем есть позади**: за пять байт до неё лежит только `blah␠`. Это не ошибка, а приём. Распаковщик копирует по одному байту и к шестому байту копии уже дописал первый — дальше копия читает саму себя. Так любая серия из одного повторяющегося куска сжимается одной парой: тысяча букв `a` — это литерал `a` и четыре ссылки с расстоянием 1.';

export const LZ77_CODE = `// LZ77 как в zlib: окно 32 КБ, совпадение от 3 до 258 байт.
const WINDOW = 32768, MIN_MATCH = 3, MAX_MATCH = 258;

// chain — сколько кандидатов проверить, nice — длина, на которой поиск
// останавливается, lazy — до какой длины заглядывать на байт вперёд (0 — жадно).
function lz77(data, { chain = 128, nice = 128, lazy = 16 } = {}) {
  const head = new Map();                   // три байта → последняя позиция с ними
  const prev = new Int32Array(data.length); // позиция → прошлая с теми же тремя
  const key = (i) => data[i] * 65536 + data[i + 1] * 256 + data[i + 2];

  function insert(i) {                      // вписать позицию в её цепочку
    if (i + MIN_MATCH > data.length) return;
    const k = key(i);
    prev[i] = head.has(k) ? head.get(k) : -1;
    head.set(k, i);
  }

  function longestMatch(i) {                // лучшее совпадение для позиции i
    let best = { len: 0, dist: 0 };
    if (i + MIN_MATCH > data.length) return best;
    const limit = Math.min(MAX_MATCH, data.length - i);
    let cand = head.has(key(i)) ? head.get(key(i)) : -1;
    for (let left = chain; cand >= 0 && i - cand <= WINDOW && left > 0; left--) {
      let len = 0;
      while (len < limit && data[cand + len] === data[i + len]) len++;
      if (len > best.len) {
        best = { len, dist: i - cand };
        if (len >= nice) break;             // «достаточно хорошо» — хватит искать
      }
      cand = prev[cand];                    // следующий кандидат — дальше в прошлое
    }
    return best.len >= MIN_MATCH ? best : { len: 0, dist: 0 };
  }

  const tokens = [];
  let i = 0;
  while (i < data.length) {
    const m = longestMatch(i);
    insert(i);
    if (m.len > 0 && m.len < lazy) {        // ленивый шаг: а с байта дальше длиннее?
      const next = longestMatch(i + 1);
      if (next.len > m.len) m.len = 0;      // да — здесь отдаём литерал
    }
    if (m.len === 0) {
      tokens.push({ lit: data[i] });
      i++;
      continue;
    }
    tokens.push({ len: m.len, dist: m.dist });
    for (let j = i + 1; j < i + m.len; j++) insert(j);
    i += m.len;
  }
  return tokens;
}

// Обратно: литерал — байт как есть, пара — копия из уже собранного.
function unlz77(tokens) {
  const out = [];
  for (const t of tokens) {
    if ('lit' in t) out.push(t.lit);
    // По байту: при dist < len копия читает то, что сама только что дописала.
    else for (let k = 0; k < t.len; k++) out.push(out[out.length - t.dist]);
  }
  return Uint8Array.from(out);
}`;

export const LZ77_NOTE =
  '`lz77` возвращает токены, `unlz77` собирает из них исходные байты. Ссылка всегда ведёт **назад**, в уже распакованное, поэтому распаковщику не нужно ничего, кроме самих токенов: словарь он строит сам, по ходу.';

/** Средняя цена в битах на Vue: учебный `lz77` уровня 6, длины кодов — `blockBits`. Сверяется тестом. */
export const PAIR_COST = { lit: '7,3', pair: '18,0', pair3: '16,7' };

export const LIMIT_ROWS = [
  {
    k: 'окно 32 768 байт',
    d: 'Расстояние записывается кодом из 30 значений и до 13 extra-бит — потолок ровно 32 768. Распаковщику хватает буфера этого размера: дальше назад ссылок не бывает.',
  },
  {
    k: 'длина от 3',
    d: `Ссылка стоит битов: код длины, код расстояния и их extra-биты. На сжатом Vue (\`vue.global.prod.js\`, тот же файл, что в таблице уровней ниже) литерал в среднем стоил ${PAIR_COST.lit} бита, пара — ${PAIR_COST.pair}, а самые короткие пары, из трёх байт, — ${PAIR_COST.pair3}. Два литерала дешевле, поэтому пары короче трёх байт в формате нет.`,
  },
  {
    k: 'длина до 258',
    d: '3 + 255: всё, что помещается в байт сверх минимума. Серию длиннее формат пишет несколькими парами подряд.',
  },
];

export const ZLIB_START_NOTE =
  'Настоящий zlib на тех же двадцати байтах выдал **шесть** литералов и пару `(5, 13)`, а тысячу `a` — два литерала и четыре пары. Причина в его таблице: номер позиции 0 там значит «цепочка пуста», поэтому на самый первый байт потока zlib сослаться не может и начинает со второго. На размере это почти не сказывается, но показывает, что ссылки у разных компрессоров разные, а распаковщик у всех один.';

// ─── Поиск повторов и уровни ───────────────────────────────────────────────────────────────

export const PLAIN_CHAIN =
  'Как предметный указатель в конце книги. Чтобы найти, где раньше встречалось слово, вы не листаете книгу с начала, а открываете указатель на нужное слово и читаете список страниц — от последней к первой. Хеш-цепочка — такой указатель для каждой тройки байт: `head` даёт последнюю позицию, `prev` — предыдущую с той же тройкой.';

export const CHAIN_STEPS = [
  {
    k: '1. Ключ — три байта',
    d: 'Совпадение короче трёх байт бесполезно, поэтому искать имеет смысл только позиции, где следующие три байта те же. zlib сворачивает их в 15-битный хеш, учебный код берёт сами три байта числом.',
  },
  {
    k: '2. Цепочка позиций',
    d: '`head` хранит последнюю позицию с этой тройкой, `prev[i]` — предыдущую перед `i`. Пройти цепочку — значит перебрать все прошлые места, где начиналось то же самое, от ближнего к дальнему.',
  },
  {
    k: '3. Сравнение и пределы',
    d: 'На каждом кандидате байты сравниваются подряд — так находится длина. Перебор обрывается на трёх условиях: кандидат вышел из окна, кончился запас `chain` или найдена длина `nice`.',
  },
];

export const LAZY_TEXT = 'abc bcde abcde';

export const LAZY_ROWS = [
  { k: 'жадно', tokens: '`a b c ␠ b c d e ␠` `(9, 3)` `d e`', count: '12 токенов', tone: 'warn' as const },
  { k: 'лениво', tokens: '`a b c ␠ b c d e ␠` `a` `(6, 4)`', count: '11 токенов', tone: 'ok' as const },
];

export const LAZY_NOTE =
  'На второй `abcde` жадный поиск хватает первое найденное — `abc` с расстояния 9 — и остаток `de` уходит литералами. Ленивый, найдя совпадение, проверяет следующую позицию: оттуда начинается `bcde` длиной 4. Раз там длиннее, текущий байт становится литералом, а ссылка — на байт позже. Проверка стоит второго поиска на каждом совпадении, поэтому zlib делает её, только пока найденное короче порога `lazy`.';

/** `configuration_table` из zlib (`deflate.c`): параметры уровней. Тест сверяет с исходником pako. */
export const ZLIB_CONFIG = [
  { level: 0, good: 0, lazy: 0, nice: 0, chain: 0, func: 'stored' },
  { level: 1, good: 4, lazy: 4, nice: 8, chain: 4, func: 'fast' },
  { level: 2, good: 4, lazy: 5, nice: 16, chain: 8, func: 'fast' },
  { level: 3, good: 4, lazy: 6, nice: 32, chain: 32, func: 'fast' },
  { level: 4, good: 4, lazy: 4, nice: 16, chain: 16, func: 'slow' },
  { level: 5, good: 8, lazy: 16, nice: 32, chain: 32, func: 'slow' },
  { level: 6, good: 8, lazy: 16, nice: 128, chain: 128, func: 'slow' },
  { level: 7, good: 8, lazy: 32, nice: 128, chain: 256, func: 'slow' },
  { level: 8, good: 32, lazy: 128, nice: 258, chain: 1024, func: 'slow' },
  { level: 9, good: 32, lazy: 258, nice: 258, chain: 4096, func: 'slow' },
];

export const LEVEL_FILE = { name: '`vue.global.prod.js` (Vue 3.5.42)', size: 167536, sha: 'aae6339a0e744cc3' };

/** Байты `deflateRawSync` по уровням и учебный `lz77` + `blockBits` с параметрами уровня (1–3 — жадно). */
export const LEVEL_SIZES: Record<number, { zlib: number; ours: number }> = {
  1: { zlib: 68240, ours: 66916 },
  2: { zlib: 66610, ours: 65146 },
  3: { zlib: 65548, ours: 63893 },
  4: { zlib: 63135, ours: 63145 },
  5: { zlib: 61475, ours: 61495 },
  6: { zlib: 61202, ours: 61143 },
  7: { zlib: 61160, ours: 61108 },
  8: { zlib: 61141, ours: 61104 },
  9: { zlib: 61141, ours: 61104 },
};

export const LEVEL_ROWS = ZLIB_CONFIG.filter((c) => c.level > 0).map((c) => [
  String(c.level),
  String(c.chain),
  String(c.nice),
  c.func === 'fast' ? '—' : String(c.lazy),
  String(c.good),
  n(LEVEL_SIZES[c.level].zlib),
  n(LEVEL_SIZES[c.level].ours),
]);

export const LEVEL_NOTE = `Файл — ${LEVEL_FILE.name}, ${n(LEVEL_FILE.size)} байт. **Уровень — это не другой алгоритм, а четыре числа:** сколько кандидатов цепочки перебрать (\`chain\`), на какой длине остановиться (\`nice\`), до какой длины проверять следующую позицию (\`lazy\`) и при какой длине уже найденного сократить перебор вчетверо (\`good\`). Уровни 1–3 — жадные. Там колонка \`lazy\` в zlib значит другое: позиции внутри совпадения длиннее этого порога даже не вписываются в цепочку, ради скорости. С уровня 6 на 9 файл похудел на ${LEVEL_SIZES[6].zlib - LEVEL_SIZES[9].zlib} байт из ${n(LEVEL_SIZES[6].zlib)}, а перебор вырос в 32 раза. Последняя колонка — учебный \`lz77\` с теми же \`chain\`, \`nice\` и \`lazy\`, посчитанный \`blockBits\` одним блоком без заголовка: числа ведут себя так же, потому что работу делают именно эти параметры.`;

export const TOO_FAR_NOTE =
  'Ещё одно правило zlib: совпадение длиной ровно 3 дальше 4096 байт отбрасывается. Код такого далёкого расстояния несёт 11–13 extra-бит, и пара выходит дороже трёх литералов. В исходнике это константа `TOO_FAR`.';

export const DEMO_PRESETS: DeflatePreset[] = [
  {
    id: 'html',
    label: 'HTML',
    text: `<ul class="menu">
  <li class="menu-item"><a href="/docs/">Документация</a></li>
  <li class="menu-item"><a href="/blog/">Блог</a></li>
  <li class="menu-item"><a href="/about/">О проекте</a></li>
</ul>
`,
  },
  {
    id: 'json',
    label: 'JSON',
    text: '[{"id":1,"name":"Анна","role":"admin","active":true},{"id":2,"name":"Борис","role":"editor","active":true},{"id":3,"name":"Вера","role":"editor","active":false}]',
  },
  { id: 'blah', label: 'Перекрытие', text: BLAH_TEXT },
  { id: 'lazy', label: 'Ленивый шаг', text: LAZY_TEXT },
  { id: 'plain', label: 'Без повторов', text: 'Съешь же ещё этих мягких французских булок, да выпей чаю.' },
];

/** Первый пример демо — он же сквозной пример раздела про блоки. */
export const HTML_SAMPLE = DEMO_PRESETS[0].text;

export const DEMO_CAPTION =
  'Токены считает `lz77` из раздела про LZ77, коды — `huffmanLengths` и `canonicalCodes`, биты — `blockBits` и `fixedBits`, разбор gzip — `gunzip` и `inflateRaw`: всё это строки, напечатанные в теме. Сжатый поток для разбора делает `CompressionStream(\'gzip\')` браузера — в Chromium это тот же zlib, что в Node, байт в байт. Кириллическая буква в UTF-8 — два байта, и граница ссылки может пройти посреди буквы: LZ77 о буквах не знает.';

// ─── Коды Хаффмана ─────────────────────────────────────────────────────────────────────────

export const PLAIN_HUFFMAN =
  'Как азбука Морзе. Буква E — одна точка, потому что в английском она самая частая; Q — четыре знака. Если писать частое коротко, сообщение в среднем выходит короче. Хаффман подбирает такие длины для конкретного текста, а не для языка вообще, и доказуемо лучше любого другого набора длин.';

export const ABRA_TEXT = 'abracadabra';

export const ABRA_STEPS = [
  { k: 'частоты', d: '`a` 5, `b` 2, `r` 2, `c` 1, `d` 1' },
  { k: 'склейка 1', d: '`c` + `d` → узел 2' },
  { k: 'склейка 2', d: '`b` + `r` → узел 4' },
  { k: 'склейка 3', d: 'узел `cd` + узел `br` → 6' },
  { k: 'склейка 4', d: '`a` + узел 6 → 11, корень' },
];

export const ABRA_ROWS = [
  { sym: '`a`', freq: 5, len: 1, code: '`0`' },
  { sym: '`b`', freq: 2, len: 3, code: '`100`' },
  { sym: '`c`', freq: 1, len: 3, code: '`101`' },
  { sym: '`d`', freq: 1, len: 3, code: '`110`' },
  { sym: '`r`', freq: 2, len: 3, code: '`111`' },
];

export const ABRA_BITS = 23;

export const ABRA_NOTE = `Длина кода — глубина листа в дереве: \`a\` склеивали один раз, остальные — по три. Итог: 5 · 1 + 6 · 3 = ${ABRA_BITS} бита вместо 88 по восемь бит на букву. Код префиксный: ни один из кодов не начало другого, поэтому строку \`0100111\` можно прочитать только как \`a\`, \`b\`, \`r\`.`;

export const HUFFMAN_CODE = `// Длины кодов по частотам: дерево Хаффмана. freqs[s] — сколько раз встречен s.
function huffmanLengths(freqs, maxBits = 15) {
  const lengths = new Array(freqs.length).fill(0);
  const nodes = [];
  freqs.forEach((w, s) => { if (w > 0) nodes.push({ w, syms: [s] }); });
  if (nodes.length === 1) lengths[nodes[0].syms[0]] = 1;
  // Склеиваем два самых редких узла, пока не останется один.
  while (nodes.length > 1) {
    nodes.sort((a, b) => a.w - b.w);
    const [a, b] = nodes.splice(0, 2);
    const syms = [...a.syms, ...b.syms];
    for (const s of syms) lengths[s]++;     // все листья под узлом — на уровень ниже
    nodes.push({ w: a.w + b.w, syms });
  }
  return limitLengths(lengths, freqs, maxBits);
}

// Дерево вышло глубже maxBits? Чиним, как zlib: длинные коды обрезаем,
// а за перебор платим, удлиняя коды покороче. Считаем в «долях»:
// код длины l занимает 2^(maxBits − l) из 2^maxBits.
function limitLengths(lengths, freqs, maxBits) {
  if (Math.max(...lengths) <= maxBits) return lengths;
  const count = new Array(maxBits + 1).fill(0);
  for (const l of lengths) if (l) count[Math.min(l, maxBits)]++;
  let used = 0;
  for (let l = 1; l <= maxBits; l++) used += count[l] * 2 ** (maxBits - l);
  while (used > 2 ** maxBits) {             // каждый шаг освобождает одну долю
    let l = maxBits - 1;
    while (count[l] === 0) l--;
    count[l]--;                             // лист длины l становится узлом,
    count[l + 1] += 2;                      // под ним он сам и лист с самого низа
    count[maxBits]--;
    used--;
  }
  // Короткие длины — частым символам.
  const order = lengths.map((l, s) => s).filter((s) => lengths[s])
    .sort((a, b) => freqs[b] - freqs[a] || a - b);
  const out = new Array(lengths.length).fill(0);
  let l = 1;
  for (const s of order) {
    while (count[l] === 0) l++;
    out[s] = l;
    count[l]--;
  }
  return out;
}

// Канонический код (RFC 1951, 3.2.2): коды выводятся из одних длин.
// Коды одной длины идут подряд по номерам символов, длиннее — после.
function canonicalCodes(lengths) {
  const maxLen = Math.max(0, ...lengths);
  const count = new Array(maxLen + 1).fill(0);
  for (const l of lengths) if (l) count[l]++;
  const next = [0];
  let code = 0;
  for (let l = 1; l <= maxLen; l++) {
    code = (code + count[l - 1]) * 2;       // первый код длины l
    next[l] = code;
  }
  return lengths.map((l) => (l ? next[l]++ : -1));
}`;

export const HUFFMAN_NOTE =
  'Склеивать два самых редких — весь алгоритм. Редкие уходят вниз дерева и получают длинные коды, частые остаются у корня. Учебный код не строит дерево узлами: ему нужна только глубина каждого листа, поэтому при склейке он просто прибавляет единицу всем листьям узла. `huffmanLengths` возвращает только длины, сами коды выдаёт `canonicalCodes` — о нём раздел «Канонический код».';

export const PLAIN_KRAFT =
  'Как делить торт. Код длины 1 забирает половину всех возможных битовых строк, длины 2 — четверть, длины 15 — одну 32 768-ю. Сумма долей не может быть больше целого торта, иначе какие-то два кода начнутся одинаково. Обрезая слишком длинные коды до 15 бит, мы раздаём лишние куски — и забираем их обратно, удлиняя другие коды.';

/** Частоты, на которых дерево выходит глубже 15: числа Фибоначчи, начиная с 2, и символ «конец блока». */
export const FIB_FREQS = [2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597, 2584, 4181];

export const FIB_RESULT = { depth: 17, limited: 15, costFree: 28615, costLimited: 28619 };

export const FIB_NOTE = `Частоты, где каждая следующая больше суммы предыдущих, дают дерево-«лесенку»: у семнадцати символов (буквы \`A\`–\`Q\` с частотами Фибоначчи от 2 до 4181) и символа «конец блока» оно выходит глубиной ${FIB_RESULT.depth}. DEFLATE разрешает коды не длиннее 15 бит — так распаковщику хватает небольших таблиц. После \`limitLengths\` самые длинные коды — по 15 бит, а сумма выросла на ${FIB_RESULT.costLimited - FIB_RESULT.costFree} бита из ${n(FIB_RESULT.costFree)}. zlib на тех же байтах записал в свой блок **те же длины, символ в символ**.`;

// ─── Канонический код ──────────────────────────────────────────────────────────────────────

export const PLAIN_CANON =
  'Как раздавать номера в очереди. Если договориться «сначала короткие номера, внутри одной длины — по алфавиту фамилий», то достаточно сообщить, у кого какая длина номера, — сами номера каждый вычислит одинаково. Таблицу кодов не передают, передают только длины.';

export const CANON_STEPS = [
  { k: 'длина 1', d: 'один код. Первый код длины 1 — `0`: его получает `a`' },
  { k: 'длина 2', d: 'кодов нет. Следующий свободный: (0 + 1) · 2 = `10`' },
  { k: 'длина 3', d: '(2 + 0) · 2 = `100` — и подряд по номерам символов: `b` `100`, `c` `101`, `d` `110`, `r` `111`' },
];

export const CANON_NOTE =
  'Это и делает `canonicalCodes`: первый код каждой длины — «следующий за последним кодом прошлой длины, с дописанным нулём». Дерево из раздела про Хаффмана могло дать `a` код `1`, а остальным — `000`…`011`: длины те же, коды другие. Канонический код из всех таких вариантов выбирает один, и тогда заголовку блока достаточно длин. Тот же приём у статического кода HPACK — [«HTTP/2 и HTTP/3», раздел «HPACK»](/platform/http2-http3/#s4): там длины зашиты в стандарт, а здесь приходят в каждом блоке.';

/** Готовые (fixed) коды DEFLATE: RFC 1951, 3.2.6. Коды пересчитываются тестом `canonicalCodes`. */
export const FIXED_ROWS = [
  { range: '0–143', what: 'литералы', len: 8, from: '`00110000`', to: '`10111111`' },
  { range: '144–255', what: 'литералы', len: 9, from: '`110010000`', to: '`111111111`' },
  { range: '256–279', what: 'конец блока, длины 3–114', len: 7, from: '`0000000`', to: '`0010111`' },
  { range: '280–287', what: 'длины 115–258 (286, 287 не бывает)', len: 8, from: '`11000000`', to: '`11000111`' },
];

export const FIXED_NOTE =
  'Fixed-коды — канонический код по длинам, записанным в RFC: ASCII и длины покороче, остальные байты подлиннее. Расстояния в fixed-блоке — пятибитные коды 0–29 подряд. Заголовок с таблицами такому блоку не нужен, поэтому на коротких данных он выигрывает: zlib записал `abracadabra` fixed-блоком в 13 байт.';

// ─── Блоки DEFLATE ─────────────────────────────────────────────────────────────────────────

export const BLOCK_ROWS = [
  { k: '`00` stored', how: 'Байты как есть: выравнивание до границы байта, `LEN` и `NLEN` по 16 бит, затем до 65 535 байт данных.', when: 'Данные не сжимаются: случайные байты, уже сжатое. Уровень 0 — только такие блоки.', tone: undefined },
  { k: '`01` fixed', how: 'Коды из RFC: таблицы в потоке нет.', when: 'Короткие данные, где таблица стоила бы больше, чем экономит.', tone: undefined },
  { k: '`10` dynamic', how: 'Свои коды: в заголовке — длины кодов обоих алфавитов, сжатые ещё одним кодом Хаффмана.', when: 'Почти всё остальное. Новый блок с новыми кодами — когда меняется характер данных или заполнился буфер символов.', tone: 'ok' as const },
  { k: '`11`', how: 'Ошибка: такого типа нет.', when: '—', tone: 'err' as const },
];

export const BLOCK_NOTE =
  'Каждый блок начинается тремя битами: `BFINAL` — последний ли он, и два бита `BTYPE`. Тип zlib выбирает, посчитав размер всех трёх вариантов для накопленных символов, и берёт меньший. На стенде: `abracadabra` — fixed, `vue.global.prod.js` — три dynamic-блока, 64 КБ случайных байт — четыре stored-блока.';

export const PLAIN_BITORDER =
  'Как бусины на нитке, которые нанизывают с конца. DEFLATE укладывает биты в байт начиная с младшего. Числа — `HLIT`, extra-биты, `LEN` — пишутся младшим битом вперёд, а коды Хаффмана — старшим вперёд, чтобы читать их по биту и узнавать код, как только он совпал. Перепутать эти два порядка — самая частая ошибка своего распаковщика.';

export const LEN_ROWS = [
  { codes: '257–264', extra: 0, range: '3–10' },
  { codes: '265–268', extra: 1, range: '11–18' },
  { codes: '269–272', extra: 2, range: '19–34' },
  { codes: '273–276', extra: 3, range: '35–66' },
  { codes: '277–280', extra: 4, range: '67–130' },
  { codes: '281–284', extra: 5, range: '131–257' },
  { codes: '285', extra: 0, range: '258' },
];

export const DIST_ROWS = [
  { codes: '0–3', extra: 0, range: '1–4' },
  { codes: '4–5', extra: 1, range: '5–8' },
  { codes: '6–7', extra: 2, range: '9–16' },
  { codes: '8–9', extra: 3, range: '17–32' },
  { codes: '…', extra: 0, range: '…' },
  { codes: '26–27', extra: 12, range: '8193–16 384' },
  { codes: '28–29', extra: 13, range: '16 385–32 768' },
];

export const ALPHABET_NOTE =
  'Литералы и длины делят **один алфавит** 0–285: 0–255 — байты, 256 — конец блока, 257–285 — длины. Поэтому после каждого кода распаковщик знает, что дальше: ещё символ или код расстояния. Близкие длины и расстояния встречаются чаще, поэтому у них коды точные, а у далёких — грубые, с extra-битами: код 284 значит «длина 227–257», и 5 extra-бит уточняют, какая. Последняя строка `LEN_ROWS` — особая: 258 выделено в отдельный код 285, потому что серия максимальной длины встречается часто.';

export const HEADER_LEAD =
  'Dynamic-блок перед данными несёт таблицу: длину кода каждого символа обоих алфавитов. Чтобы таблица была короче, её саму сжимают — серии и третий код Хаффмана. Вот заголовок, который zlib записал для HTML из демо.';

/** Сквозной пример: размер `HTML_SAMPLE` и его сжатого вида (zlib уровня 6). Сверяется тестом. */
export const HTML_SIZES = { raw: 227, deflate: 134, zlib: 140, gzip: 152, headerBits: 71, tableBits: 310, dataBits: 688, totalBits: 1069, lenSyms: 89 };

export const HEADER_ROWS = [
  { bits: '`1`', field: '`BFINAL`', value: '1', meaning: 'блок последний', tone: undefined },
  { bits: '`01`', field: '`BTYPE`', value: '2', meaning: 'dynamic. Биты читаются младшим вперёд: `0`, потом `1` → 0 + 2 = 2', tone: undefined },
  { bits: '`01001`', field: '`HLIT`', value: '18', meaning: '18 + 257 = 275 длин: литералы 0–255, конец блока и длины до кода 274', tone: undefined },
  { bits: '`00110`', field: '`HDIST`', value: '12', meaning: '12 + 1 = 13 длин: коды расстояний 0–12, не дальше 96 байт назад', tone: undefined },
  { bits: '`0111`', field: '`HCLEN`', value: '14', meaning: '14 + 4 = 18 длин по 3 бита для алфавита длин', tone: undefined },
  { bits: '`000 110 001 010 …`', field: 'длины 16, 17, 18, 0, …', value: '0, 3, 4, 2, …', meaning: 'в порядке `16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15`: в хвосте редкие длины, хвост можно не передавать — последнюю, 15, здесь и не передали', tone: 'info' as const },
  { bits: '310 бит', field: 'длины кодов', value: '89 символов', meaning: '288 длин (275 + 13) записаны 89 символами алфавита длин: 0–15 — сама длина, 16 — повторить прошлую 3–6 раз, 17 — 3–10 нулей, 18 — 11–138 нулей', tone: 'info' as const },
  { bits: '688 бит', field: 'данные', value: '124 символа', meaning: '117 литералов, 6 пар и конец блока', tone: 'ok' as const },
];

export const HEADER_NOTE = `Всего блок — ${n(HTML_SIZES.totalBits)} бит, ${HTML_SIZES.deflate} байт на ${HTML_SIZES.raw} байт текста. Заголовок с таблицей — ${HTML_SIZES.headerBits + HTML_SIZES.tableBits} бит, больше трети. На маленьком тексте таблица дорогая, на файле в сотни килобайт она теряется. Порядок \`16, 17, 18, 0, 8, 7, …\` выбран так, чтобы в конце списка стояли длины, которых обычно нет: \`HCLEN\` позволяет хвост отрезать.`;

export const INFLATE_CODE = `// Распаковка DEFLATE (RFC 1951). canonicalCodes — из раздела про Хаффмана.
// Код длины 257 + i: длина LEN_BASE[i] плюс LEN_EXTRA[i] битов сверху.
const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31,
  35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2,
  3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193,
  257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6,
  7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
// В этом порядке идут длины кодов «алфавита длин»: частые — вперёд.
const ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

// log(что, значение, с какого бита, по какой) — для разбора; можно не давать.
function inflateRaw(bytes, log = () => {}) {
  let pos = 0;                              // позиция в БИТАХ
  function bits(n, what) {                  // число из n бит, младший — первым
    const from = pos;
    let v = 0;
    for (let i = 0; i < n; i++, pos++) {
      if (pos >= bytes.length * 8) throw new Error('поток кончился');
      v += ((bytes[pos >> 3] >> (pos & 7)) & 1) * 2 ** i;
    }
    if (what) log(what, v, from, pos);
    return v;
  }
  function table(lengths) {                 // «длина и код» → символ
    const map = new Map();
    canonicalCodes(lengths).forEach((c, s) => { if (c >= 0) map.set(lengths[s] * 65536 + c, s); });
    return map;
  }
  function symbol(t, what) {                // код Хаффмана: по биту, старшим вперёд
    const from = pos;
    let code = 0;
    for (let len = 1; len <= 15; len++) {
      code = code * 2 + bits(1);
      const s = t.get(len * 65536 + code);
      if (s !== undefined) { log(what, s, from, pos); return s; }
    }
    throw new Error('нет такого кода');
  }
  function dynamicTables() {
    const hlit = bits(5, 'HLIT') + 257, hdist = bits(5, 'HDIST') + 1;
    const hclen = bits(4, 'HCLEN') + 4;
    const clLens = new Array(19).fill(0);   // по 3 бита на длину, в порядке ORDER
    for (let i = 0; i < hclen; i++) clLens[ORDER[i]] = bits(3, 'CL' + ORDER[i]);
    const cl = table(clLens);
    const lens = [];                        // длины обоих алфавитов — одной лентой
    while (lens.length < hlit + hdist) {
      const s = symbol(cl, 'LENSYM');
      if (s < 16) lens.push(s);
      else if (s === 16) {                  // повторить прошлую длину 3–6 раз
        if (!lens.length) throw new Error('повторять нечего');
        lens.push(...new Array(3 + bits(2, 'REP')).fill(lens[lens.length - 1]));
      } else if (s === 17) lens.push(...new Array(3 + bits(3, 'REP')).fill(0));
      else lens.push(...new Array(11 + bits(7, 'REP')).fill(0));
    }
    if (lens.length > hlit + hdist) throw new Error('повтор вылез за алфавит');
    return [table(lens.slice(0, hlit)), table(lens.slice(hlit))];
  }

  const out = [];
  let last;
  do {
    last = bits(1, 'BFINAL');
    const type = bits(2, 'BTYPE');
    if (type === 0) {                       // stored: байты как есть
      pos = Math.ceil(pos / 8) * 8;         // до границы байта
      const len = bits(16, 'LEN');
      if ((bits(16, 'NLEN') ^ len) !== 0xffff) throw new Error('LEN и NLEN не сходятся');
      for (let i = 0; i < len; i++) out.push(bits(8));
      continue;
    }
    let lit, dist;
    if (type === 1) {                       // fixed: длины заданы RFC
      lit = table([...new Array(144).fill(8), ...new Array(112).fill(9),
        ...new Array(24).fill(7), ...new Array(8).fill(8)]);
      dist = table(new Array(30).fill(5));
    } else if (type === 2) [lit, dist] = dynamicTables();
    else throw new Error('BTYPE 3 не бывает');
    for (;;) {
      const s = symbol(lit, 'SYM');
      if (s < 256) { out.push(s); continue; }
      if (s === 256) break;                 // конец блока
      const len = LEN_BASE[s - 257] + bits(LEN_EXTRA[s - 257], 'LENX');
      const d = symbol(dist, 'DIST');
      const distance = DIST_BASE[d] + bits(DIST_EXTRA[d], 'DISTX');
      if (distance > out.length) throw new Error('ссылка до начала данных');
      for (let k = 0; k < len; k++) out.push(out[out.length - distance]);
    }
  } while (!last);
  return { data: Uint8Array.from(out), bitLength: pos };
}`;

export const INFLATE_NOTE =
  'Девяносто строк — и это полный распаковщик: он разбирает вывод zlib на всех уровнях от 0 до 9, fflate и pako байт в байт. Обратите внимание, чего в нём нет. Нет уровня сжатия, размера окна, параметров поиска: всё, чем компрессоры отличаются, остаётся у компрессора. Распаковщику нужны только три типа блоков и правило копирования. Настоящий zlib делает то же быстрее: берёт сразу 9 бит и находит код в таблице одним обращением, а не по биту.';

export const BITS_CODE = `// Сколько бит займут токены в dynamic-блоке — без заголовка с таблицами.
function symbolOf(value, base) {            // номер кода и значение extra-битов
  let i = base.length - 1;
  while (base[i] > value) i--;
  return [i, value - base[i]];
}

function blockBits(tokens) {
  const litF = new Array(286).fill(0), distF = new Array(30).fill(0);
  let extra = 0;
  for (const t of tokens) {
    if ('lit' in t) { litF[t.lit]++; continue; }
    const [l] = symbolOf(t.len, LEN_BASE);
    const [d] = symbolOf(t.dist, DIST_BASE);
    litF[257 + l]++; extra += LEN_EXTRA[l];
    distF[d]++; extra += DIST_EXTRA[d];
  }
  litF[256]++;                              // символ «конец блока» — ровно один
  const litL = huffmanLengths(litF), distL = huffmanLengths(distF);
  let bits = extra;
  litF.forEach((f, s) => { bits += f * litL[s]; });
  distF.forEach((f, s) => { bits += f * distL[s]; });
  return { litF, distF, litL, distL, extra, bits };
}

// Те же токены fixed-кодами: длины известны заранее, заголовка нет.
function fixedBits({ litF, distF, extra }) {
  let bits = extra;
  litF.forEach((f, s) => { bits += f * (s < 144 ? 8 : s < 256 ? 9 : s < 280 ? 7 : 8); });
  distF.forEach((f) => { bits += f * 5; });
  return bits;
}`;

export const BITS_NOTE = `\`blockBits\` переводит токены в символы двух алфавитов, считает частоты, строит длины \`huffmanLengths\` и складывает биты. Проверка честная: если подать ему токены, которые выбрал сам zlib, выходит ровно ${HTML_SIZES.dataBits} бит — столько данных и в блоке zlib.`;

export const DEMO_GZIP_CAPTION =
  'Тот же текст сжат настоящим gzip браузера и разобран `gunzip` и `inflateRaw` из темы: каждая строка — одно чтение распаковщика, с номерами бит и самими битами в том порядке, в каком он их читал. Измените текст — у короткого появится fixed-блок, у текста без повторов — меньше пар и длиннее таблица.';

// ─── Обёртки gzip и zlib ───────────────────────────────────────────────────────────────────

export const WRAP_ROWS = [
  { k: 'raw DEFLATE', head: '—', tail: '—', size: HTML_SIZES.deflate, where: '`deflateRawSync`, `CompressionStream(\'deflate-raw\')`, внутри zip' },
  { k: 'zlib, RFC 1950', head: '2 байта: метод и окно, проверка `% 31`', tail: 'Adler-32, big-endian', size: HTML_SIZES.zlib, where: '`deflateSync`, `Content-Encoding: deflate`, PNG' },
  { k: 'gzip, RFC 1952', head: '10 байт и больше: `1f 8b`, метод, флаги, время, ОС', tail: 'CRC-32 и длина, little-endian', size: HTML_SIZES.gzip, where: '`gzipSync`, `Content-Encoding: gzip`, файлы `.gz`' },
];

export const GZIP_HEADER_ROWS = [
  { at: '0–1', k: '`ID1 ID2`', v: '`1f 8b`', d: 'метка формата' },
  { at: '2', k: '`CM`', v: '`08`', d: 'метод: 8 — DEFLATE, других нет' },
  { at: '3', k: '`FLG`', v: '`00`', d: 'флаги: имя файла (8), комментарий (16), доп. поле (4), CRC заголовка (2)' },
  { at: '4–7', k: '`MTIME`', v: '`00 00 00 00`', d: 'время изменения; 0 — «не указано»' },
  { at: '8', k: '`XFL`', v: '`00`', d: '2 — сжато «сильнее всего» (уровень 9), 4 — «быстрее всего» (уровень 1)' },
  { at: '9', k: '`OS`', v: '`13`', d: 'система: 3 — Unix; 19 (0x13) — macOS у zlib 1.3' },
];

export const WRAP_CODE = `// gzip (RFC 1952): заголовок от 10 байт, поток DEFLATE, CRC-32 и длина.
function gunzip(bytes, log) {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) throw new Error('не gzip');
  if (bytes[2] !== 8) throw new Error('метод не deflate');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const flags = bytes[3];
  let at = 10, name = '';
  if (flags & 4) at += 2 + view.getUint16(at, true);       // FEXTRA
  if (flags & 8) {                                         // FNAME, Latin-1, до нуля
    while (bytes[at]) name += String.fromCharCode(bytes[at++]);
    at++;
  }
  if (flags & 16) { while (bytes[at]) at++; at++; }        // FCOMMENT
  if (flags & 2) at += 2;                                  // FHCRC
  const { data, bitLength } = inflateRaw(bytes.subarray(at), log);
  const end = at + Math.ceil(bitLength / 8);               // хвост — с границы байта
  const crc = view.getUint32(end, true);                   // little-endian
  const isize = view.getUint32(end + 4, true);
  if (isize !== data.length % 2 ** 32) throw new Error('ISIZE не сходится');
  return { data, name, flags, mtime: view.getUint32(4, true), os: bytes[9], at, end, crc, isize };
}

// zlib (RFC 1950): 2 байта заголовка, поток DEFLATE, Adler-32.
function adler32(bytes) {
  let a = 1, b = 0;
  for (const x of bytes) { a = (a + x) % 65521; b = (b + a) % 65521; }
  return b * 65536 + a;
}

function unzlib(bytes) {
  const cmf = bytes[0], flg = bytes[1];
  if ((cmf & 15) !== 8 || (cmf * 256 + flg) % 31 !== 0) throw new Error('не zlib');
  if (flg & 32) throw new Error('нужен заранее заданный словарь');
  const { data, bitLength } = inflateRaw(bytes.subarray(2));
  const end = 2 + Math.ceil(bitLength / 8);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(end) !== adler32(data)) throw new Error('Adler-32 не сходится');
  return { data, window: 2 ** ((cmf >> 4) + 8) };          // big-endian, в отличие от gzip
}`;

export const WRAP_NOTE =
  '`gunzip` возвращает сохранённый CRC-32, но не проверяет его: функция `crc32` разобрана в [«Бинарных данных», раздел «Разбор PNG»](/js/binary-data/#s7), и тест сверяет ею. Adler-32 — две суммы по модулю 65 521: считается быстрее CRC, но на коротких данных ловит ошибки хуже — поэтому RFC 3309 заменил его на CRC в протоколе SCTP. Окно в заголовке zlib — подсказка распаковщику, сколько памяти держать: у `78` в первом байте это 32 КБ.';

export const BROWSER_FACTS = [
  {
    t: '`CompressionStream` — тот же zlib',
    d: 'Chromium 153 сжал HTML из демо и файл в 60 КБ во всех трёх форматах байт в байт так же, как Node с уровнем по умолчанию, вплоть до байта ОС. В Node это и вовсе один код. Сам трансформ — в [«Стримах», раздел «Итерация и байты»](/platform/streams/#s6).',
  },
  {
    t: '`deflate` в HTTP — с обёрткой zlib',
    d: 'По RFC 9110 `Content-Encoding: deflate` — это zlib, а не голый DEFLATE. Старые серверы слали голый, и браузеры к этому привыкли: Chromium распаковал оба варианта. А вот gzip под именем `deflate` — уже ошибка `Failed to fetch`.',
    tone: 'warn' as const,
  },
  {
    t: 'Сеть не проверяет хвост gzip',
    d: 'Ответ с испорченными CRC-32 и ISIZE Chromium отдал в `fetch` без ошибки. Два gzip-члена подряд — вернул только первый. `DecompressionStream(\'gzip\')` на тех же байтах бросил `TypeError`, а `gunzipSync` в Node склеил оба члена.',
    tone: 'err' as const,
  },
];

/** Все строки кода темы — для демо и теста. */
export const LAB_CODES: DeflateCodes = {
  lz77: LZ77_CODE,
  huffman: HUFFMAN_CODE,
  inflate: INFLATE_CODE,
  wrap: WRAP_CODE,
  bits: BITS_CODE,
};

// ─── Предел сжатия ─────────────────────────────────────────────────────────────────────────

export const PLAIN_ENTROPY =
  'Как угадывать следующую букву в чужом тексте. В русском после «щ» почти наверняка гласная — подсказка почти ничего не стоит. В случайном пароле угадать нельзя, и каждую букву приходится называть целиком. Энтропия — средняя цена такой подсказки в битах. Сжатие не может сделать подсказку дешевле, чем она есть.';

/** Байты по стенду: энтропия по байтам и размеры. `random` — xorshift32, зерно 42. */
export const ENTROPY_ROWS = [
  { k: '`vue.global.prod.js`', size: 167536, h0: 5.282, bound: 110609, huff: 111048, deflate: 61141, tone: 'ok' as const },
  { k: 'случайные байты', size: 65536, h0: 7.997, bound: 65510, huff: 65558, deflate: 65558, tone: 'err' as const },
  { k: 'тот же Vue, уже в gzip 9', size: 61159, h0: 7.996, bound: 61131, huff: 61179, deflate: 61179, tone: 'err' as const },
];

export const ENTROPY_NOTE = `Энтропия по отдельным байтам у Vue — 5,28 бита: если сжимать каждый байт сам по себе, меньше ${n(ENTROPY_ROWS[0].bound)} байт не выйдет, и один Хаффман без LZ77 дал ${n(ENTROPY_ROWS[0].huff)}. DEFLATE уходит вдвое ниже, потому что видит не только частоты букв, но и повторы целых кусков. У случайных байт повторов нет, а частоты ровные — почти 8 бит на байт. Сжатое уже похоже на случайное: повторы съедены, частоты выровнены. Поэтому вторая упаковка только добавляет байт — на заголовки stored-блоков и обёртку. Размеры JPEG, woff2 и прочих готовых форматов после gzip — в [«Сжатии в вебе», раздел «Заранее или на лету»](/platform/compression/#s3).`;

/** Повтор 4 КБ случайных байт через промежуток: внутри окна и за ним. xorshift32, зерно 1. */
export const WINDOW_ROWS = [
  { gap: 28000, distance: 32096, raw: 36192, zlib: 32190, br: 32117, zstd: 32119 },
  { gap: 32000, distance: 36096, raw: 40192, zlib: 40207, br: 36117, zstd: 36119 },
];

export const WINDOW_NOTE = `Четыре килобайта случайных байт, потом случайный промежуток, потом те же четыре килобайта. Пока повтор ближе 32 768 байт, gzip его находит. Стоит отодвинуть на ${n(WINDOW_ROWS[1].distance)} — и gzip 9 выдаёт на ${WINDOW_ROWS[1].zlib - WINDOW_ROWS[1].raw} байт **больше** исходника, а Brotli и zstd с окном в мегабайты находят повтор, как ни в чём не бывало.`;

export const NEWER_ROWS = [
  { k: 'Brotli, RFC 7932', d: 'Тот же LZ77 и Хаффман, но окно до 16 МБ и **встроенный словарь** на 120 КБ частых слов и кусков HTML, CSS и JS — ссылку можно сделать в текст, которого в файле нет. Плюс **контекстное моделирование**: свой набор кодов в зависимости от предыдущих байт, а не один на блок.' },
  { k: 'zstd, RFC 8878', d: 'LZ77 с большим окном, а вместо Хаффмана для длин и расстояний — **FSE**, вариант асимметричных систем счисления (ANS). Код Хаффмана тратит на символ целое число бит, ANS — дробное: символ с вероятностью 90% стоит около 0,15 бита, а не 1.' },
];

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'Уровень 9 почти не сжимает сильнее 6',
    d: `На \`vue.global.prod.js\` уровень 9 выиграл у 6 ${LEVEL_SIZES[6].zlib - LEVEL_SIZES[9].zlib} байт из ${n(LEVEL_SIZES[6].zlib)}, а перебирал цепочки в 32 раза длиннее. Формат тот же, код Хаффмана тот же — уровни отличаются только старательностью поиска. Хотите заметно меньше — нужен другой формат, а не другой уровень.`,
    tone: 'warn',
  },
  {
    n: '02',
    t: 'Повтор дальше 32 КБ для gzip не существует',
    d: `Два одинаковых куска бандла на расстоянии ${n(WINDOW_ROWS[1].distance)} байт gzip сжимает, как будто второй видит впервые. Brotli и zstd с большим окном находят его. В большом бандле одинаковые куски, разнесённые дальше 32 КБ, gzip сожмёт каждый заново.`,
    tone: 'warn',
  },
  {
    n: '03',
    t: 'Числа — младшим битом вперёд, коды — старшим',
    d: '`HLIT`, extra-биты и `LEN` читаются от младшего бита к старшему, коды Хаффмана — от старшего. Собственный распаковщик, перепутавший это, падает не сразу: первые биты заголовка часто симметричны, и ошибка всплывает в таблице длин.',
    tone: 'err',
  },
  {
    n: '04',
    t: 'Ссылка может быть длиннее расстояния',
    d: 'Пара `(1, 258)` значит «повтори последний байт 258 раз». Распаковщик, который копирует кусок разом (`copyWithin`, `slice`), получит мусор: источник ещё не дописан. Копировать надо по байту или кусками не длиннее расстояния.',
    tone: 'err',
  },
  {
    n: '05',
    t: 'Сжатое второй раз растёт',
    d: `Vue в gzip 9 — ${n(ENTROPY_ROWS[2].size)} байт, тот же файл, сжатый ещё раз, — ${n(ENTROPY_ROWS[2].size + 38)}. Байты сжатого похожи на случайные: повторов нет, частоты ровные. Перепаковка уже сжатого — процессор впустую и несколько лишних байт.`,
  },
  {
    n: '06',
    t: 'Браузер не проверяет CRC ответа',
    d: 'Chromium 153 отдал в `fetch` ответ gzip с испорченными CRC-32 и ISIZE без ошибки, а из двух gzip-членов подряд — только первый. `DecompressionStream` строже: на тех же байтах — `TypeError`. Целостность ответа держит TLS, а не хвост gzip.',
    tone: 'warn',
  },
  {
    n: '07',
    t: 'Одинаковый gzip на разных машинах — не одинаковые байты',
    d: 'Байт `OS` в заголовке — 3 на Linux и 19 на macOS у zlib 1.3, `MTIME` — время, если его кто-то записал. Хеш `.gz`-файла из сборки на разных машинах расходится, хотя данные те же. Для воспроизводимой сборки сравнивают распакованное или фиксируют заголовок.',
    tone: 'warn',
  },
  {
    n: '08',
    t: 'ISIZE — длина по модулю 4 ГБ',
    d: 'В хвосте gzip — длина исходника в 32 битах. У файла больше 4 ГБ там остаток, и «размер после распаковки» из заголовка врёт. Ещё одна причина: gzip может состоять из нескольких членов, и ISIZE последнего говорит только о нём.',
  },
  {
    n: '09',
    t: 'LZ77 сжимает байты, а не буквы',
    d: 'Кириллическая буква в UTF-8 — два байта, и ссылка может начаться посреди буквы. На сжатие это не влияет, но разбивать сжатый поток или считать «сколько букв сжалось» по токенам нельзя.',
  },
];

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'RFC 1951 — DEFLATE Compressed Data Format',
    href: 'https://www.rfc-editor.org/rfc/rfc1951',
    what: 'порядок бит (3.1.1), канонический код (3.2.2), типы блоков, алфавиты длин и расстояний, fixed-коды (3.2.6), заголовок dynamic-блока (3.2.7)',
  },
  {
    title: 'RFC 1952 — GZIP file format',
    href: 'https://www.rfc-editor.org/rfc/rfc1952',
    what: 'заголовок, флаги, `XFL`, `OS`, CRC-32 и `ISIZE`, несколько членов в одном файле',
  },
  {
    title: 'RFC 1950 — ZLIB Compressed Data Format',
    href: 'https://www.rfc-editor.org/rfc/rfc1950',
    what: '`CMF` и `FLG`, проверка `% 31`, `FDICT`, Adler-32',
  },
  {
    title: 'zlib — deflate.c',
    href: 'https://github.com/madler/zlib/blob/master/deflate.c',
    what: '`configuration_table`, хеш-цепочки `head` и `prev`, `deflate_fast` и `deflate_slow`, `TOO_FAR`; на стенде — Node 24.11.0 с zlib 1.3.1',
  },
  {
    title: 'zlib — trees.c',
    href: 'https://github.com/madler/zlib/blob/master/trees.c',
    what: 'построение дерева, ограничение длины кодов в `gen_bitlen`, выбор типа блока',
  },
  {
    title: 'zlib — algorithm.txt',
    href: 'https://github.com/madler/zlib/blob/master/doc/algorithm.txt',
    what: 'объяснение ленивого поиска и быстрой распаковки таблицами от автора zlib',
  },
  {
    title: 'RFC 7932 — Brotli Compressed Data Format',
    href: 'https://www.rfc-editor.org/rfc/rfc7932',
    what: 'окно до 16 МБ, статический словарь, контекстное моделирование',
  },
  {
    title: 'RFC 8878 — Zstandard Compression',
    href: 'https://www.rfc-editor.org/rfc/rfc8878',
    what: 'FSE и Хаффман для литералов, окно',
  },
  {
    title: 'fflate',
    href: 'https://github.com/101arrowz/fflate',
    what: 'независимая реализация DEFLATE на JS; версия 0.8.3 на стенде, с ней сверен `inflateRaw`',
  },
];

export const RELATED =
  'Смежное на сайте: [Сжатие в вебе](/platform/compression/) — `Accept-Encoding`, уровни gzip, Brotli и zstd на файлах сайта, словари, BREACH. [Бинарные данные, раздел «Разбор PNG»](/js/binary-data/#s7) — CRC-32 и PNG, внутри которого тот же DEFLATE. [HTTP/2 и HTTP/3, раздел «HPACK»](/platform/http2-http3/#s4) — статический канонический код Хаффмана для заголовков. [Стримы, раздел «Итерация и байты»](/platform/streams/#s6) — `CompressionStream` в цепочке трансформов. [Diff, раздел «LCS и таблица»](/algorithms/diff/#s2) — другая задача о повторах: общая подпоследовательность двух текстов.';
