import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { MapExample } from '@/widgets/source-map-lab/model/types';

/**
 * Данные темы «Source maps изнутри: как стек ошибки находит строку исходника».
 *
 * Тема написана здесь, 2026-10-01, по списку кандидатов для направления «Сборка и инструменты».
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * esbuild **0.28.2**, terser **5.51.2**, `@jridgewell/sourcemap-codec` 1.6.0,
 * `@jridgewell/trace-mapping` 0.3.31, `@jridgewell/remapping` 2.3.5 — всё из `node_modules`
 * проекта. Node 24.11.0, Chromium 153.0.8010.12 (Playwright 1.63), октябрь 2026.
 *
 * Фикстура — два файла TypeScript: `price.ts` (функция `total`) и `cart.ts`, который бросает
 * ошибку, если сумма больше 500. Сборки:
 *   — «за один шаг»: `esbuild.build({ bundle, minify, sourcemap, format: 'esm', platform: 'node',
 *     charset: 'utf8' })` — это `CART_JS` и `CART_MAP`;
 *   — «цепочкой»: тот же `build` без `minify`, затем `terser.minify` — один раз без входной
 *     карты (`sourceMap: { filename, url }`), второй — с ней (`content: <карта первого шага>`);
 *   — «маленький пример»: `esbuild.transform` двух строк TS без минификации — `GREET_*`.
 *
 * Стеки сняты запуском бандла: `node cart.js` и `node --enable-source-maps cart.js`; абсолютный
 * путь до каталога стенда в стеке заменён на относительный, больше ничего не тронуто.
 * Браузер: та же фикстура в формате `iife` на локальном сервере, Chromium без DevTools. Сервер
 * записал запросы `/` и `/cart.js` — карту браузер не запрашивал; `error.stack` из обработчика
 * `error` — `at i (http://localhost:49400/cart.js:1:177)`, то есть позиция бандла.
 *
 * Вес: `export { createApp, ref, computed, h } from 'vue'` (Vue 3.5.42), esbuild с `minify`
 * и `NODE_ENV=production`: код 63 943 байта, карта 573 785 (×8,97) с `sourcesContent` и
 * 136 592 (×2,14) без него.
 *
 * Всё перечисленное, кроме браузера и веса, пересобирается `tests/unit/source-maps.test.ts`:
 * литералы ниже сверяются с тем, что esbuild и terser пишут сейчас.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'source map (карта исходников)',
    d: 'JSON-файл рядом с бандлом. Для каждого куска сгенерированного кода в нём записано, из какого файла, строки и колонки исходника этот кусок получился.',
  },
  {
    k: 'сгенерированная и исходная позиция',
    d: 'Сгенерированная — строка и колонка в том, что исполняет движок: в бандле. Исходная — строка и колонка в файле, который вы писали. Карта переводит первую во вторую.',
  },
  {
    k: 'сегмент',
    d: 'Одна запись карты: «с этой колонки сгенерированной строки начинается код из такого-то места исходника». Сегмент покрывает код до начала следующего сегмента.',
  },
  {
    k: 'Base64 VLQ',
    d: 'Способ записать числа буквами: каждая буква несёт 5 бит числа и бит «дальше будет ещё». Маленькие числа занимают одну букву, поэтому карта хранит не позиции, а разницы между соседними.',
  },
  {
    k: '`sourcesContent`',
    d: 'Необязательное поле карты: тексты исходных файлов целиком. С ним инструмент покажет исходник, даже если самих файлов у него нет; без него — только имя файла и номер строки.',
  },
  {
    k: '`names`',
    d: 'Список исходных имён, которые минификатор заменил короткими: `checkout` стал `i`. Сегмент может сослаться на имя по номеру в этом списке.',
  },
];

export const PLAIN_SOURCEMAP =
  'Как сноски в переводной книге. Читатель держит перевод — бандл, — а на полях стоит «см. оригинал, глава 2, абзац 3». Сама книга от сносок не меняется и читается без них; сноски нужны тому, кто хочет сверить место с оригиналом: отладчику, Node, сервису ошибок.';

export const PREREQ_NOTE =
  'Тема опирается на две вещи из других тем и на одну, которой на сайте нет, — она объяснена прямо на карточке.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'Рабочая сборка не похожа на исходники',
    d: 'Сборщик склеивает модули в один файл, стирает типы, переименовывает переменные и убирает пробелы. Строки и колонки бандла поэтому ничего не говорят о том, где эта строка лежала у вас.',
    href: '/tooling/modules/#s6',
    hrefLabel: '«Модули и сборка», раздел «Dev не равен prod»',
    tone: 'info',
  },
  {
    t: 'Стек вызовов',
    d: 'Стопка вызовов, которые сейчас выполняются. Ошибка запоминает её в момент создания: имя функции, файл, строку и колонку каждого кадра.',
    href: '/js/callbacks/#s1',
    hrefLabel: '«Колбэки», раздел «Стек»',
    tone: 'info',
  },
  {
    t: 'Число в двоичной записи',
    d: 'Нужно для раздела про VLQ. Число 18 в двоичной записи — `10010`: 16 + 2. Шесть бит вмещают числа от 0 до 63, и ровно столько символов в алфавите Base64.',
    tone: 'info',
  },
];

// ─── Раздел 1. Что лежит в .map ────────────────────────────────────────────────────────────

/** Исходники фикстуры. Тест пишет их на диск и собирает теми же вызовами, что и стенд. */
export const PRICE_TS = `export interface Item {
  title: string;
  price: number;
  qty: number;
}

export function total(items: Item[]): number {
  return items.reduce((sum, item) => sum + item.price * item.qty, 0);
}
`;

export const CART_TS = `import { total, type Item } from './price';

const items: Item[] = [
  { title: 'Кофе', price: 250, qty: 2 },
  { title: 'Круассан', price: 180, qty: 1 },
];

function checkout(cart: Item[]): string {
  const sum = total(cart);
  if (sum > 500) {
    throw new Error(\`Лимит превышен: \${sum}\`);
  }
  return \`К оплате: \${sum}\`;
}

console.log(checkout(items));
`;

/** Бандл за один шаг: esbuild с `minify`. Одна строка, без комментария `sourceMappingURL`. */
export const CART_JS =
  'function n(e){return e.reduce((t,r)=>t+r.price*r.qty,0)}var o=[{title:"Кофе",price:250,qty:2},{title:"Круассан",price:180,qty:1}];function i(e){let t=n(e);if(t>500)throw new Error(`Лимит превышен: ${t}`);return`К оплате: ${t}`}console.log(i(o));';

export const CART_MAP = {
  version: 3,
  sources: ['../../src/price.ts', '../../src/cart.ts'],
  sourcesContent: [PRICE_TS, CART_TS],
  names: ['total', 'items', 'sum', 'item', 'items', 'checkout', 'cart', 'sum', 'total'],
  mappings:
    'AAMO,SAASA,EAAMC,EAAuB,CAC3C,OAAOA,EAAM,OAAO,CAACC,EAAKC,IAASD,EAAMC,EAAK,MAAQA,EAAK,IAAK,CAAC,CACnE,CCNA,IAAMC,EAAgB,CACpB,CAAE,MAAO,OAAQ,MAAO,IAAK,IAAK,CAAE,EACpC,CAAE,MAAO,WAAY,MAAO,IAAK,IAAK,CAAE,CAC1C,EAEA,SAASC,EAASC,EAAsB,CACtC,IAAMC,EAAMC,EAAMF,CAAI,EACtB,GAAIC,EAAM,IACR,MAAM,IAAI,MAAM,mBAAmBA,CAAG,EAAE,EAE1C,MAAO,aAAaA,CAAG,EACzB,CAEA,QAAQ,IAAIF,EAASD,CAAK,CAAC',
};

/** Карта, как она выглядит в файле. `mappings` и `sourcesContent` укорочены для печати. */
export const MAP_PRINT_CODE = `{
  "version": 3,
  "sources": ["../../src/price.ts", "../../src/cart.ts"],
  "sourcesContent": ["export interface Item {\\n  title: string; …", "import { total, …"],
  "mappings": "AAMO,SAASA,EAAMC,EAAuB,CAC3C,OAAOA,EAAM,OAAO,CAACC,…",
  "names": ["total", "items", "sum", "item", "items", "checkout", "cart", "sum", "total"]
}`;

export const MAP_FIELDS = [
  { k: 'version', v: '`3`', d: 'Версия формата. Других в ходу нет: версии 1 и 2 вышли из употребления больше десяти лет назад.' },
  { k: 'sources', v: 'пути', d: 'Исходные файлы. Пути считаются **от адреса самой карты**: `../../src/cart.ts` рядом с `dist/one/cart.js.map` — это `src/cart.ts`.' },
  { k: 'sourcesContent', v: 'тексты', d: 'Тексты тех же файлов в том же порядке. Необязательно, но без него отладчику придётся скачивать исходники по путям из `sources`.' },
  { k: 'names', v: 'имена', d: 'Исходные имена переменных и функций, на которые ссылаются сегменты.' },
  { k: 'mappings', v: 'строка', d: 'Сами соответствия: строки бандла через `;`, сегменты одной строки через `,`, числа в сегменте — буквами Base64 VLQ.' },
  { k: 'file, sourceRoot, ignoreList', v: 'необяз.', d: '`file` — имя бандла; `sourceRoot` — префикс ко всем `sources`; `ignoreList` — номера источников, которые отладчик прячет из стека (обычно `node_modules`).' },
];

/**
 * `${'//'}#` вместо цельного комментария — не ради красоты. Vite (и vitest) ищут в тексте модуля
 * строку, начинающуюся с `//# sourceMappingURL=`, и пытаются загрузить такую карту — даже если
 * это пример внутри строкового литерала. Цельный комментарий здесь давал `ENOENT … cart.js.map`
 * при каждом прогоне теста. Читатель видит то же самое: подстановка склеивается в `//#`.
 */
export const FIND_MAP_CODE = `// 1. Комментарий в конце бандла — так делает esbuild с sourcemap: true
console.log(i(o));
${'//'}# sourceMappingURL=cart.js.map

// 2. Или заголовок ответа — тогда в самом файле ничего нет
SourceMap: /assets/cart.js.map`;

export const FIND_MAP_NOTE =
  'Адрес в комментарии считается от адреса бандла. Если есть и комментарий, и заголовок, побеждает заголовок. Карту читает тот, кому она нужна, — отладчик или Node с флагом. Обычная загрузка страницы её не трогает: на стенде Chromium без открытого DevTools запросил `/` и `/cart.js`, а `/cart.js.map` — ни разу.';

// ─── Раздел 2. mappings: строки, сегменты, VLQ ─────────────────────────────────────────────

export const PLAIN_VLQ =
  'Представьте, что вы диктуете по телефону длинный список чисел и платите за каждую букву. Выгоднее говорить не «колонка 1024, колонка 1031», а «плюс семь»: разница почти всегда маленькая. А чтобы собеседник понял, где кончается одно число и начинается следующее, на каждой букве вы помечаете: «это ещё не всё» или «конец числа».';

export const VLQ_CODE = `const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// Одно число: буквы по 6 бит. Старший бит (32) — «дальше ещё буква»,
// младшие пять — данные. Младший бит всего числа — знак.
function readVlq(str, pos) {
  let value = 0, shift = 0, digit;
  do {
    digit = B64.indexOf(str[pos++]);
    value += (digit & 31) * 2 ** shift;   // пять бит данных на своё место
    shift += 5;
  } while (digit & 32);
  const n = Math.floor(value / 2);
  return [value % 2 ? -n : n, pos];
}

function decodeMappings(mappings) {
  const lines = [];
  // Эти четыре счётчика переходят со строки на строку.
  let source = 0, srcLine = 0, srcCol = 0, name = 0;
  for (const lineText of mappings.split(';')) {
    const segments = [];
    let genCol = 0;                       // а этот обнуляется на каждой строке
    for (const text of lineText.split(',')) {
      if (!text) continue;
      const d = [];
      for (let pos = 0; pos < text.length; ) {
        let v;
        [v, pos] = readVlq(text, pos);
        d.push(v);
      }
      genCol += d[0];
      if (d.length === 1) { segments.push([genCol]); continue; }
      source += d[1]; srcLine += d[2]; srcCol += d[3];
      if (d.length === 5) {
        name += d[4];
        segments.push([genCol, source, srcLine, srcCol, name]);
      } else {
        segments.push([genCol, source, srcLine, srcCol]);
      }
    }
    lines.push(segments);
  }
  return lines;
}`;

export const VLQ_NOTE =
  'Каждое число в сегменте — **разница** с тем же полем предыдущего сегмента, а не позиция. Колонка в бандле считается заново на каждой строке, остальные четыре поля копятся через всю карту. Сегмент из одного числа — кусок кода без источника: обвязка, которую дописал сам сборщик.';

export const GREET_TS = `const greet = (name: string) => "Привет, " + name;
console.log(greet("мир"));
`;

export const GREET_JS = `const greet = (name) => "Привет, " + name;
console.log(greet("мир"));`;

export const GREET_MAP = {
  version: 3,
  sources: ['greet.ts'],
  sourcesContent: [GREET_TS],
  names: [] as string[],
  mappings: 'AAAA,MAAM,QAAQ,CAAC,SAAiB,aAAa;AAC7C,QAAQ,IAAI,MAAM,KAAK,CAAC;',
};

/** Разобранный по буквам сегмент `SAAiB` — тот, что открыт в демо первым. Сверяется тестом. */
export const SEGMENT_STEPS = [
  { ch: 'S', bits: '010010', more: 'нет', data: '10010 = 18', value: '18 → чётное, +9' },
  { ch: 'A', bits: '000000', more: 'нет', data: '0', value: '0' },
  { ch: 'A', bits: '000000', more: 'нет', data: '0', value: '0' },
  { ch: 'i', bits: '100010', more: '**да**', data: '00010 = 2', value: 'ждём следующую букву' },
  { ch: 'B', bits: '000001', more: 'нет', data: '00001 → 1 · 32 = 32', value: '2 + 32 = 34 → чётное, +17' },
];

export const SEGMENT_NOTE =
  'Итог `SAAiB` — разницы `+9, 0, 0, +17`. Предыдущий сегмент указывал на колонку 15 и в бандле, и в исходнике, так что этот — на колонку 24 бандла и 32 исходника. Колонки разошлись на 8 символов: ровно столько занимало `: string`, которое esbuild стёр. Карта не хранит «тип стёрт»; она просто начинает считать колонки исходника с другого места.';

export const DEMO_EXAMPLES: MapExample[] = [
  {
    id: 'greet',
    label: 'Две строки TS',
    generated: GREET_JS,
    map: GREET_MAP,
    note: 'Только перевод TS в JS, без минификации: сегменты почти совпадают с исходником. Найдите место, где колонки расходятся, — это стёртый тип.',
    start: [0, 4],
  },
  {
    id: 'cart',
    label: 'Минифицированный бандл',
    generated: CART_JS,
    map: CART_MAP,
    note: 'Два файла, склеенные и сжатые в одну строку. Сегмент `throw` ведёт в `cart.ts`, а `reduce` — в `price.ts`: номер источника — второе число сегмента.',
    start: [0, 51],
  },
];

export const DEMO_CAPTION =
  'Нажмите на кусок сгенерированного кода. Разбор сегмента считают функции `readVlq` и `decodeMappings` выше, место в исходнике — `originalPositionFor` из следующего раздела: обе строки напечатаны на странице и проверены тестом против библиотек `@jridgewell`.';

// ─── Раздел 3. Обратный путь: от стека к исходнику ─────────────────────────────────────────

export const LOOKUP_CODE = `// line — с единицы, column — с нуля: так считают trace-mapping и сервисы ошибок.
// В стеке ошибки колонка с единицы, поэтому перед поиском вычтите 1.
function originalPositionFor(map, lines, line, column) {
  const segments = lines[line - 1];
  if (!segments) return null;

  // Последний сегмент, который начинается не правее column.
  let lo = 0, hi = segments.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segments[mid][0] <= column) { found = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  if (found < 0) return null;

  const s = segments[found];
  if (s.length === 1) return null;        // кусок без источника
  return {
    source: map.sources[s[1]],
    line: s[2] + 1,                       // в карте строки с нуля
    column: s[3],
    name: s.length === 5 ? map.names[s[4]] : null,
  };
}`;

export const PLAIN_LOOKUP =
  'Как найти дом по номеру, если таблички висят только на углах кварталов. Вы идёте вдоль улицы до последней таблички, номер на которой не больше вашего: ваш дом в этом квартале. Сегменты — таблички, колонка из стека — номер дома.';

export const STACK_BARE = `$ node dist/cart.js
Error: Лимит превышен: 680
    at i (dist/cart.js:1:171)
    at Object.<anonymous> (dist/cart.js:1:240)`;

export const STACK_MAPPED = `$ node --enable-source-maps dist/cart.js
Error: Лимит превышен: 680
    at checkout (src/cart.ts:11:11)
    at Object.<anonymous> (src/cart.ts:16:13)`;

export const LOOKUP_STEPS = [
  { k: '1. Колонку — к счёту с нуля', d: 'В стеке `1:171`: строка 1, колонка 171, обе с единицы. В карте колонки с нуля — ищем 170.' },
  { k: '2. Сегмент', d: 'В первой строке бандла 68 сегментов. Последний, что начинается не правее 170, начинается ровно на 170 — на слове `new` в `throw new Error`. Его поля: источник 1, строка 10, колонка 10.' },
  { k: '3. Источник и строка', d: 'Источник 1 — `../../src/cart.ts`. Строка 10 с нуля — одиннадцатая с единицы. Колонку отладчик снова печатает с единицы: `cart.ts:11:11`.' },
  { k: '4. Имя функции', d: 'Отдельный поиск: Node берёт позицию, где **объявлена** функция `i`, и находит там сегмент с пятым полем — имя номер 5, `checkout`. Поэтому кадр подписан исходным именем, хотя у самого `throw` имени в сегменте нет.' },
];

export const STACK_FACTS = [
  {
    t: 'Позиция — место `new Error`, а не `throw`',
    d: 'Стек ошибка записывает при создании. Колонка `11:11` указывает на `new`, а не на `throw`, стоящий шестью символами левее. Если ошибку создают в одной функции, а бросают в другой, стек покажет первую.',
  },
  {
    t: 'Браузер `error.stack` не переводит',
    d: 'На стенде Chromium отдал в обработчик `error` строку `at i (…/cart.js:1:177)` — позицию бандла. Исходные строки показывает **консоль DevTools**, когда открыта: она переводит стек при выводе. В логгер, который шлёт `error.stack` на сервер, уходит бандл.',
    tone: 'warn' as const,
  },
  {
    t: 'Кто ещё ищет',
    d: 'Сервис ошибок делает тот же поиск у себя: получает стек с позициями бандла и прогоняет его через карту, загруженную при сборке. Тот же `originalPositionFor`, только на сервере и для всех пользователей.',
  },
];

// ─── Раздел 4. Цепочка: почему строки съезжают ─────────────────────────────────────────────

export const CHAIN_CHIPS = [
  { label: 'cart.ts', tone: 'ok' as const },
  { label: 'esbuild → cart.js + карта 1' },
  { label: 'terser → cart.min.js + карта 2' },
  { label: 'стек: cart.min.js:1:…', tone: 'warn' as const },
];

export const CHAIN_LOST_CODE = `// terser не получил карту первого шага
await minify({ 'cart.js': step1 }, {
  sourceMap: { filename: 'cart.min.js', url: 'cart.min.js.map' },
});

// node --enable-source-maps dist/cart.min.js
//     at checkout (dist/cart.js:14:11)`;

export const CHAIN_OK_CODE = `// terser получил карту первого шага и склеил две карты в одну
await minify({ 'cart.js': step1 }, {
  sourceMap: { filename: 'cart.min.js', url: 'cart.min.js.map',
               content: step1Map },
});

// node --enable-source-maps dist/cart.min.js
//     at checkout (src/cart.ts:11:11)`;

export const CHAIN_NOTE =
  'Без входной карты terser честно описал свою работу: «этот кусок `cart.min.js` пришёл из `cart.js`, строка 14». Строка 14 существует, код на ней тот же — только это промежуточный бандл, который после сборки не лежит нигде. Ошибки нет, всё выглядит правдоподобно, и именно поэтому такую поломку долго не замечают: «строки съехали», хотя каждая карта по отдельности верна.';

export const PLAIN_COMPOSE =
  'Как перевод через язык-посредник. Японский роман перевели на английский, потом с английского на русский. Если у русского переводчика были сноски английского, он может написать «оригинал, глава 2». Если не было — его сноски ведут в английское издание, которого у читателя нет.';

export const COMPOSE_CODE = `import remapping from '@jridgewell/remapping';

// Карты от последнего шага к первому: каждую позицию карты 2
// прогоняют через карту 1 — получается одна карта до cart.ts.
const merged = remapping([terserMap, esbuildMap], () => null);`;

export const COMPOSE_NOTE =
  'Склеить две карты можно и после сборки: для каждого сегмента последней карты найти его позицию в предыдущей тем же `originalPositionFor`. Тест темы так и делает с картой «без входной карты»: после `remapping` она указывает на `cart.ts:11`, как и карта, которую склеил сам terser.';

export const PRECISION_ROWS = [
  { k: 'сегменты только в начале токенов', how: 'Позиция в середине длинного выражения находит ближайший сегмент левее — начало выражения или вызова.', tone: undefined },
  { k: 'карта «только строки»', how: 'Некоторые режимы сборщиков ради скорости пишут один сегмент на строку исходника. Строка верная, колонка — всегда начало строки.', tone: 'warn' as const },
  { k: 'шаг без входной карты', how: 'Позиция уходит в промежуточный файл: правдоподобная строка в файле, которого нет.', tone: 'err' as const },
  { k: 'карта от другой сборки', how: 'Числа расшифровываются, но ведут в чужой код: строки и имена «почти те». Карту связывают с бандлом по версии релиза.', tone: 'err' as const },
];

// ─── Раздел 5. Карты в продакшене ──────────────────────────────────────────────────────────

export const PROD_ROWS = [
  { k: 'публичная карта', how: 'Бандл со ссылкой на карту, карта лежит рядом. Вид в Vite: `build.sourcemap: true`.', who: 'Любой, кто откроет DevTools, — вместе с исходниками, если в карте есть `sourcesContent`.', tone: 'warn' as const },
  { k: 'скрытая карта', how: 'Карта пишется, но комментария в бандле нет; карту загружают в сервис ошибок и на сайт не выкладывают. Vite: `build.sourcemap: \'hidden\'`.', who: 'Только сервис ошибок и команда.', tone: 'ok' as const },
  { k: 'без карты', how: 'Карта не пишется.', who: 'Никто: стеки из прода — это `at i (cart.js:1:171)`.', tone: 'err' as const },
];

export const PROD_FACTS = [
  {
    t: 'Вес пользователю ничего не стоит',
    d: 'Карта рантайма Vue весит в 9 раз больше кода (574 КБ на 64 КБ) с текстами исходников и в 2,1 раза — без них. Но браузер карту не качает, пока не открыт DevTools, — платит только сервер, который её хранит.',
  },
  {
    t: '`ignoreList` чистит стек',
    d: 'Поле перечисляет источники, которые отладчик сворачивает в стеке и пропускает при пошаговой отладке. Сборщики вписывают туда `node_modules`: в стеке остаются ваши функции, а не тридцать кадров фреймворка.',
  },
  {
    t: 'Пути считаются от карты',
    d: 'Перенесли карту в другой каталог при деплое — пути в `sources` теперь ведут не туда. С `sourcesContent` отладчик всё равно покажет код, без него — «файл не найден».',
    tone: 'warn' as const,
  },
];

export const PROD_NOTE =
  'Карта — это исходники. С `sourcesContent` в ней лежат тексты файлов целиком: комментарии, имена, вырезанный из бандла мёртвый код. Если код не должен быть публичным, карту не выкладывают на тот же сервер, что и бандл.';

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'Колонка в стеке — с единицы, в карте — с нуля',
    d: 'Стек говорит `1:171`, сегмент нужно искать на 170. Ошибка на единицу почти всегда «работает»: соседний символ обычно в том же сегменте. И ломается, когда позиция попадает ровно на начало сегмента — тогда находится предыдущий, и строка исходника другая.',
    tone: 'warn',
  },
  {
    n: '02',
    t: 'Шаг сборки без входной карты сдвигает строки',
    d: 'terser без карты esbuild дал `cart.js:14` вместо `cart.ts:11`: позицию в промежуточном файле, которого после сборки нет. Каждая карта верна, цепочка — нет. Проверка — бросить ошибку в известном месте и сравнить стек с исходником.',
    tone: 'err',
  },
  {
    n: '03',
    t: '`error.stack` в браузере — позиции бандла',
    d: 'Консоль DevTools переводит стек при показе, поэтому кажется, что браузер «знает» исходники. Строка, которую ваш код отправляет на сервер, — непереведённая. Переводить её должен тот, у кого есть карта.',
    tone: 'err',
  },
  {
    n: '04',
    t: 'Карта от другой сборки расшифровывается без ошибок',
    d: 'Числа в `mappings` — просто числа: к чужому бандлу карта применится и выдаст правдоподобные строки. Поэтому сервисы ошибок хранят карты по релизу, а бандл и карту выкладывают одним шагом.',
    tone: 'err',
  },
  {
    n: '05',
    t: 'Публичная карта отдаёт исходники',
    d: 'С `sourcesContent` в карте лежат файлы целиком, вместе с комментариями и кодом, который сборщик вырезал из бандла как мёртвый. Для закрытого кода — скрытая карта и загрузка в сервис ошибок.',
    tone: 'warn',
  },
  {
    n: '06',
    t: 'Стек показывает место создания ошибки',
    d: 'Колонка `11:11` — это `new Error`, а не `throw`. Ошибку, созданную заранее (`const e = new Error(); … throw e`), стек привяжет к месту создания — и карта честно переведёт именно его.',
  },
  {
    n: '07',
    t: 'Имя функции в стеке — из отдельного поиска',
    d: 'У сегмента в месте ошибки имени может не быть. Исходное имя берётся по позиции объявления функции. Если на объявлении сегмента с именем нет, в стеке останется минифицированное `i`.',
  },
  {
    n: '08',
    t: 'Комментарий `sourceMappingURL` ищут в тексте, а не в синтаксисе',
    d: 'Инструменты находят ссылку на карту поиском строки, которая начинается с `//# sourceMappingURL=`. Пример такого комментария внутри строкового литерала в файле этой темы заставлял vitest искать несуществующий `cart.js.map` при каждом прогоне. В строке-примере комментарий приходится разбивать.',
    tone: 'warn',
  },
];

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'ECMA-426 — Source map format specification',
    href: 'https://tc39.es/ecma426/',
    what: 'поля карты, `mappings`, Base64 VLQ, `ignoreList`, поиск карты по комментарию и заголовку `SourceMap`',
  },
  {
    title: 'esbuild — Sourcemap',
    href: 'https://esbuild.github.io/api/#sourcemap',
    what: 'режимы `linked`, `external`, `inline`, `both`, `sourcesContent`; версия 0.28.2 на стенде',
  },
  {
    title: 'terser — Source map options',
    href: 'https://github.com/terser/terser#source-map-options',
    what: '`sourceMap.content` — входная карта предыдущего шага',
  },
  {
    title: 'Node.js — `--enable-source-maps`',
    href: 'https://nodejs.org/api/cli.html#--enable-source-maps',
    what: 'перевод стека через карту в Node; проверено на 24.11.0',
  },
  {
    title: '`@jridgewell/trace-mapping` и `@jridgewell/remapping`',
    href: 'https://github.com/jridgewell/sourcemaps',
    what: 'поиск позиции и склейка карт; с ними сверяются функции темы',
  },
  {
    title: 'Vite — `build.sourcemap`',
    href: 'https://vite.dev/config/build-options#build-sourcemap',
    what: '`true`, `\'inline\'`, `\'hidden\'`',
  },
];

export const RELATED =
  'Смежное на сайте: [Модули и сборка, раздел «Dev не равен prod»](/tooling/modules/#s6) — что делает со строками рабочая сборка. [HMR изнутри](/tooling/hmr/) — dev-сервер, который отдаёт модули по одному. [Колбэки, раздел «Стек»](/js/callbacks/#s1) — откуда берётся стек вызовов. [Безопасность бэкенда, раздел «Ошибки и секреты»](/platform/backend-security/#s5) — что ещё утекает через ошибки. [Ошибки и стеки](/js/errors/) — когда снимается стек, асинхронные кадры, необработанные ошибки и как собрать отчёт.';
