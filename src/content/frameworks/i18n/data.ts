import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { IcuPreset, IcuValues } from '@/widgets/i18n-lab/model/types';

/**
 * Данные темы «Интернационализация во фронтенде: ICU MessageFormat и словари».
 *
 * Тема написана здесь, 2026-10-02, для направления «Фреймворки изнутри».
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * `intl-messageformat` **12.1.2** (парсер `@formatjs/icu-messageformat-parser` 3.5.20),
 * `@messageformat/core` **3.4.0** (`@messageformat/parser` 5.1.1, `@messageformat/runtime` 3.0.2,
 * правила множественного числа — `make-plural` 7.5.0), `vue-i18n` **11.4.12** (`@intlify/core-base`
 * и `@intlify/message-compiler` 11.4.12), Vue 3.5.42, happy-dom, esbuild 0.28.2 — всё из
 * `node_modules` проекта. Node 24.11.0 (ICU 77.1, CLDR 47.0), Chromium 153.0.8010.12
 * (headless shell из Playwright 1.63), macOS, октябрь 2026. Скрипты стенда — вне проекта,
 * в рабочем каталоге автора темы (`s1.mjs`, `s2.mjs`, `cmp.mjs`, `sizes.mjs`, `vi.cjs`, `chr.mjs`).
 *
 * Что снято и где перепроверяется (`tests/unit/i18n.test.ts`):
 *   — `ICU_CODE` (учебный разбор и формат) сверен с `intl-messageformat` и `@messageformat/core`
 *     на наборе «9 видов сообщений × 213 чисел (0…200 и дроби) × 3 значения select × 6 локалей
 *     (ru, en, uk, pl, ar, ja)» — 34 506 сравнений с каждой библиотекой, расхождений ноль. Тест
 *     повторяет набор целиком. Случаи, где библиотеки расходятся между собой (`#` в select внутри
 *     plural, незакрытая цитата, `{n}` при отсутствующем значении), из набора вынесены и
 *     проверяются отдельно — они в «Тонких местах»;
 *   — выводы всех примеров со стрелкой `// →` исполняются тестом как есть (`CONCAT_CODE`,
 *     `GENDER_CODE`, `AST_CODE`, `VI_PLURAL_CODE`, `VI_ICU_CODE`, `NEGOTIATE_CODE`,
 *     `DIRECTION_CODE`); таблица `ICU_ROWS` пересчитывается `intl-messageformat`;
 *   — `MF_MODULE_OUT` — вывод `compileModule` из `@messageformat/core`, тест пересобирает его
 *     и сверяет текст; там же — что `compile` зовёт `new Function` ровно один раз;
 *   — `SIZE_ROWS` — байты после `esbuild --bundle --minify` (`vue` внешний, `NODE_ENV=production`)
 *     и gzip уровня 9 из `node:zlib`. Тест пересобирает каждую строку и сверяет байты точно;
 *   — vue-i18n: правило множественного числа по умолчанию, `@` в тексте, ICU-строка в его
 *     компиляторе, цепочки запасных локалей (`fallbackWithLocaleChain` — та самая функция,
 *     которую vue-i18n регистрирует как `localeFallbacker`), перерисовка после смены локали
 *     (happy-dom, рендер-функции), ленивая загрузка `VI_LAZY_CODE` (тест пишет код и словари
 *     на диск и импортирует как модуль) и разбиение словарей на чанки esbuild'ом;
 *   — Chromium: без `locale` у контекста headless shell не шлёт `Accept-Language` вовсе, с
 *     `locale: 'ru-RU'` шлёт `ru-RU`; `navigator.languages` — `['ru-RU']`; `Intl.MessageFormat`
 *     нет ни в Node 24, ни в Chromium 153; `getTextInfo()` есть в обоих. Логические свойства
 *     CSS (`LOGICAL_CSS`) тест проверяет в Chromium при `dir="ltr"` и `dir="rtl"`.
 *
 * Что взято без стенда:
 *   — MessageFormat 2 (`MF2_CODE`) — **по спецификации** Unicode MessageFormat 2.0 (LDML 47) и
 *     предложению TC39 `Intl.MessageFormat`: ни один установленный пакет MF2 не разбирает
 *     (`@messageformat/core` 3 и `intl-messageformat` 12 — это MessageFormat 1), движков с
 *     `Intl.MessageFormat` на стенде нет. Тест проверяет только, как MF2-строку принимают
 *     библиотеки MF1;
 *   — сборка словарей vue-i18n заранее (`@intlify/unplugin-vue-i18n`) и флаг
 *     `__INTLIFY_DROP_MESSAGE_COMPILER__` — по документации vue-i18n; плагин не установлен,
 *     байты «без компилятора» сняты тем же флагом в esbuild;
 *   — что Googlebot ходит без `Accept-Language`, и правила `hreflang`/`x-default` — по
 *     документации Google Search Central;
 *   — заголовок `Accept-Language` настоящего Chrome с несколькими языками — пример, не замер.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'локаль',
    d: 'Язык плюс местные правила: как писать числа, даты, множественное число. Записывается тегом BCP 47: `ru`, `ru-RU`, `pt-BR`, `zh-Hant-TW` — язык, по желанию письменность и регион через дефис.',
  },
  {
    k: 'сообщение и ключ',
    d: 'Сообщение — одна фраза интерфейса целиком, с местами под значения. Ключ — её имя в коде: `cart.deleteFiles`. Код знает ключ, переводчик пишет сообщение.',
  },
  {
    k: 'словарь',
    d: 'Все сообщения одной локали: объект или JSON «ключ → сообщение». У каждой локали свой словарь, ключи одинаковые.',
  },
  {
    k: 'ICU MessageFormat',
    d: 'Язык записи сообщений: текст с аргументами в фигурных скобках и ветками по числу (`plural`) и по значению (`select`). Пришёл из библиотеки ICU, его понимают formatjs, messageformat, Java, Android, iOS-инструменты.',
  },
  {
    k: 'CLDR и категория числа',
    d: 'CLDR — общая база языковых правил Unicode. Для множественного числа она делит числа на категории: в русском `one`, `few`, `many`, `other`. `Intl.PluralRules` говорит, в какую категорию попало число.',
  },
  {
    k: 'запасная локаль (fallback)',
    d: 'Куда идти за сообщением, если в словаре нужной локали его нет: `pt-BR` → `pt` → `en`. Цепочка таких шагов и решает, что увидит человек вместо пустого места.',
  },
  {
    k: 'RTL',
    d: 'Right-to-left — письмо справа налево: арабский, иврит, персидский. Строка, отступы и стрелки в таком интерфейсе зеркальны.',
  },
];

export const PLAIN_MESSAGE =
  'Как бланк с вариантами «нужное подчеркнуть». Переводчик заранее пишет все варианты фразы целиком: «1 файл», «2 файла», «5 файлов». Программа не собирает фразу из кусков, а только подчёркивает нужный вариант и вписывает число.';

export const PREREQ_NOTE =
  'Тема опирается на три разбора с других страниц и на одну вещь из Vue.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'Категории множественного числа',
    d: 'Правила CLDR для «1 файл, 2 файла, 5 файлов», учебная функция `pluralRu` и `Intl.PluralRules` — со всеми операндами и дробями. Здесь они используются как готовый инструмент.',
    href: '/js/unicode-intl/#s7',
    hrefLabel: '«Unicode и Intl», раздел «Числа и слова»',
    tone: 'info',
  },
  {
    t: 'Даты и часовые пояса',
    d: '`Intl.DateTimeFormat` и почему одна и та же дата печатается по-разному на сервере и у читателя. В сообщениях даты форматирует тот же `Intl`.',
    href: '/js/time-dates/#s4',
    hrefLabel: '«Время и даты», раздел «Сравнение и вывод»',
    tone: 'info',
  },
  {
    t: 'Динамический `import()` и чанки',
    d: 'Сборщик выносит модуль, загруженный через `import()`, в отдельный файл. На этом держится ленивая загрузка словарей.',
    href: '/tooling/bundler-internals/#s4',
    hrefLabel: '«Бандлер изнутри», раздел «Чанки»',
    tone: 'info',
  },
  {
    t: 'Перерисовка во Vue',
    d: 'Запись в `ref` не меняет DOM сразу: Vue копит обновления и применяет их пачкой перед следующей отрисовкой (`nextTick`).',
    href: '/frameworks/vue-reactivity/#s3',
    hrefLabel: '«Реактивность Vue», раздел «Планировщик»',
    tone: 'info',
  },
];

// ─── Склейка строк ─────────────────────────────────────────────────────────────────────────

/** Исполняется тестом: `IntlMessageFormat` передаётся параметром, строки `// →` — проверки. */
export const CONCAT_CODE = `// Склейка: фразу собирает код, переводчику достаются обрывки
const glued = (n, folder) => 'Удалить ' + n + ' файлов из папки ' + folder + '?';
glued(1, 'Загрузки');   // → 'Удалить 1 файлов из папки Загрузки?'
glued(3, 'Загрузки');   // → 'Удалить 3 файлов из папки Загрузки?'

// Сообщение: фраза целиком у переводчика, код подставляет значения
const ru = new IntlMessageFormat(
  'Удалить {n, plural, one {# файл} few {# файла} many {# файлов} other {# файла}} из папки «{folder}»?',
  'ru',
);
const ja = new IntlMessageFormat('「{folder}」から{n}個のファイルを削除しますか？', 'ja');

ru.format({ n: 1, folder: 'Загрузки' });   // → 'Удалить 1 файл из папки «Загрузки»?'
ru.format({ n: 3, folder: 'Загрузки' });   // → 'Удалить 3 файла из папки «Загрузки»?'
ja.format({ n: 3, folder: 'Downloads' });  // → '「Downloads」から3個のファイルを削除しますか？'`;

export const CONCAT_NOTE =
  'В японской фразе папка стоит первой, а число — в середине. Склейка `t(\'delete\') + n + t(\'files\')` такой порядок не выразит: его задаёт код, а не переводчик. В сообщении порядок — часть текста, и переводчик переставляет аргументы как хочет.';

export const BREAK_CARDS = [
  {
    t: 'Порядок слов',
    d: 'В английском «Delete 3 files from Downloads», в японском — «из Downloads 3 файла удалить?». Немецкий отправляет глагол в конец, арабский пишет справа налево. Любой порядок, зашитый в код, в каком-то языке будет неверным.',
  },
  {
    t: 'Число',
    d: 'Русскому нужно три формы слова и ещё одна для дробей, японскому — одна, арабскому — шесть. Выбор формы по `n === 1` верен только для английского; правила — в CLDR.',
  },
  {
    t: 'Род',
    d: 'По-английски «Sasha left the chat» — глагол один. По-русски «Саша вышел» или «Саша вышла»: глагол прошедшего времени согласуется с родом, и выбрать форму может только тот, кто знает пол. Значит, пол — такой же аргумент сообщения, как число.',
  },
  {
    t: 'Падеж',
    d: 'Подставить «Загрузки» в «из папки …» можно, а в «удалить из …» — нет: нужно «из Загрузок». ICU не склоняет слова. Выход — строить фразу так, чтобы подставленное значение стояло в именительном падеже: «из папки «{folder}»», «Папка: {folder}».',
  },
];

export const PLAIN_CONCAT =
  'Как собрать предложение из магнитиков на холодильнике, если магнитики делали для другого языка. Слова переведены верно, но их порядок, окончания и даже число магнитиков задал тот, кто резал первый набор. Переводчику нужно дать не магнитики, а всё предложение.';

export const GENDER_CODE = `const left = new IntlMessageFormat(
  '{name} {gender, select, female {вышла} male {вышел} other {вышел(а)}} из чата',
  'ru',
);
left.format({ name: 'Саша', gender: 'female' });   // → 'Саша вышла из чата'
left.format({ name: 'Саша', gender: 'male' });     // → 'Саша вышел из чата'
left.format({ name: 'Саша', gender: 'unknown' });  // → 'Саша вышел(а) из чата'`;

// ─── Синтаксис ICU ─────────────────────────────────────────────────────────────────────────

interface IcuRow {
  k: string;
  msg: string;
  locale: string;
  vals: IcuValues;
  out: string;
  d: string;
}

const show = (v: IcuValues) => Object.entries(v).map(([k, x]) => `${k} = ${typeof x === 'string' ? `'${x}'` : x}`).join(', ');

/** `out` пересчитывается тестом через `intl-messageformat` той же локали. */
const ICU_RAW: IcuRow[] = [
  { k: 'аргумент', msg: 'Привет, {name}!', locale: 'ru', vals: { name: 'Аня' }, out: 'Привет, Аня!', d: 'Значение подставляется строкой, как есть.' },
  { k: 'select', msg: '{g, select, female {Она} male {Он} other {Они}} в сети', locale: 'ru', vals: { g: 'male' }, out: 'Он в сети', d: 'Ветка по точному значению. `other` обязательна — она ловит всё, чего нет в списке.' },
  { k: 'plural и #', msg: '{n, plural, one {# файл} few {# файла} many {# файлов} other {# файла}}', locale: 'ru', vals: { n: 21 }, out: '21 файл', d: 'Ветка по категории CLDR. `#` — само число, отформатированное по локали.' },
  { k: 'plural, дробь', msg: '{n, plural, one {# файл} few {# файла} many {# файлов} other {# файла}}', locale: 'ru', vals: { n: 1.5 }, out: '1,5 файла', d: 'Дробь в русском — всегда `other`. Запятая вместо точки — от `Intl.NumberFormat`.' },
  { k: '=N', msg: '{n, plural, =0 {Файлов нет} one {# файл} few {# файла} many {# файлов} other {# файла}}', locale: 'ru', vals: { n: 0 }, out: 'Файлов нет', d: 'Точное значение проверяется раньше категории: без `=0` здесь было бы «0 файлов».' },
  { k: 'offset', msg: '{n, plural, offset:1 =0 {В чате никого} =1 {{name} в чате} one {{name} и ещё # человек} few {{name} и ещё # человека} many {{name} и ещё # человек} other {{name} и ещё # человека}}', locale: 'ru', vals: { n: 3, name: 'Аня' }, out: 'Аня и ещё 2 человека', d: '`offset:1` вычитает единицу: `#` и категория считаются от `n − 1`, а `=0` и `=1` сравниваются с самим `n`.' },
  { k: 'selectordinal', msg: '{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}} place', locale: 'en', vals: { n: 23 }, out: '23rd place', d: 'Порядковые категории: в английском четыре. В русском одна, `other`, — окончание «-й/-я» зависит от рода, а не от цифр.' },
  { k: 'вложенность', msg: '{g, select, female {Купила {n, plural, one {# книгу} few {# книги} many {# книг} other {# книги}}} other {Купил {n, plural, one {# книгу} few {# книги} many {# книг} other {# книги}}}}', locale: 'ru', vals: { g: 'female', n: 5 }, out: 'Купила 5 книг', d: 'Ветка — это снова сообщение, в ней могут быть свои select и plural.' },
  { k: "''", msg: "It''s {name}", locale: 'en', vals: { name: 'Ann' }, out: "It's Ann", d: 'Два апострофа подряд — один апостроф.' },
  { k: "'{…}'", msg: "Шаблон: '{name}' → {name}", locale: 'ru', vals: { name: 'Аня' }, out: 'Шаблон: {name} → Аня', d: 'Апостроф перед `{` или `}` открывает цитату: текст до следующего апострофа печатается буквально.' },
  { k: "'#'", msg: "{n, plural, other {Номер '#'#}}", locale: 'ru', vals: { n: 7 }, out: 'Номер #7', d: 'Внутри plural `#` — число, а `\'#\'` — сам знак решётки.' },
];

export const ICU_ROWS = ICU_RAW.map((r) => ({ ...r, args: show(r.vals) }));

export const ICU_NOTE =
  'Пробелы внутри веток сохраняются: `{n, plural, one { # }}` даст число с пробелами по краям. А ветка `other` обязательна и у `select`, и у `plural` — без неё и `intl-messageformat`, и `@messageformat/core` отказываются разбирать сообщение.';

export const PLURAL_LINK =
  'Откуда берутся `one`, `few`, `many` и `other`, подробно — в теме [«Unicode и Intl», раздел «Числа и слова»](/js/unicode-intl/#s7). Здесь хватит одного: категорию выбирает `Intl.PluralRules` локали, и у дроби она своя. `new Intl.PluralRules(\'ru\').select(1.5)` — `\'other\'`, поэтому «1,5 файла», а не «1,5 файл».';

export const PLAIN_OFFSET =
  'Как подпись под постом: «Аня и ещё 2 человека». Имя Ани уже названо, и считать надо остальных. `offset:1` вычитает её из числа — и для `#`, и для выбора формы слова. А точные `=0` и `=1` смотрят на полное число: «никого» и «только Аня» — особые случаи всей группы.';

export const FORMAT_CODE = `const mf = (msg, values) => new IntlMessageFormat(msg, 'ru').format(values);

mf('{n}', { n: 1234.5 });                       // → '1234.5'
mf('{n, number}', { n: 1234.5 });               // → '1\u00a0234,5'
mf('{p, number, percent}', { p: 0.25 });        // → '25\u00a0%'
mf('{sum, number, ::currency/RUB}', { sum: 1234.5 });   // → '1\u00a0234,50\u00a0₽'
mf('{d, date, long}', { d: new Date(Date.UTC(2026, 9, 2, 12)) });   // → '2 октября 2026 г.'`;

export const FORMAT_NOTE =
  'Без `number` аргумент печатается через `String`: «1234.5», точка и без разрядов. `number`, `date` и `time` передают значение в `Intl.NumberFormat` и `Intl.DateTimeFormat` локали сообщения, а `::currency/RUB` — это «скелет», краткая запись опций того же форматтера. Пробелы между разрядами и перед «%» и «₽» — неразрывные. Как устроены сами форматтеры и часовые пояса — в темах [«Unicode и Intl»](/js/unicode-intl/#s7) и [«Время и даты»](/js/time-dates/#s4).';

// ─── Разбор своими руками ──────────────────────────────────────────────────────────────────

/** Учебный разбор и формат ICU. Печатает тема, исполняют демо (`model/run.ts`) и тест. */
export const ICU_CODE = String.raw`// Узел дерева — текст (строка) или объект:
//   { type: 'arg', name }                         {name}
//   { type: 'pound' }                             # внутри plural
//   { type: 'select' | 'plural' | 'selectordinal', name, offset, options }
function parse(src) {
  let pos = 0;
  const fail = (why) => { throw new SyntaxError(why + ', позиция ' + pos); };
  const spaces = () => { while (/\s/.test(src[pos] ?? '')) pos++; };
  const word = () => {
    spaces();
    const m = /^[^\s{}#,]+/.exec(src.slice(pos));
    if (!m) fail('ждали имя');
    pos += m[0].length;
    return m[0];
  };
  const expect = (ch) => { spaces(); if (src[pos] !== ch) fail('ждали ' + ch); pos++; };

  // Текст до закрывающей } своей ветки. В ветке plural '#' — это число.
  function message(inPlural, inBranch) {
    const nodes = [];
    let text = '';
    const flush = () => { if (text) nodes.push(text); text = ''; };
    while (pos < src.length) {
      const ch = src[pos];
      if (ch === "'") {
        const next = src[pos + 1];
        if (next === "'") { text += "'"; pos += 2; continue; }   // '' — один апостроф
        if (next === '{' || next === '}' || (inPlural && next === '#')) {
          pos++;                                                 // цитата до следующего '
          while (pos < src.length) {
            if (src[pos] === "'" && src[pos + 1] === "'") { text += "'"; pos += 2; continue; }
            if (src[pos] === "'") { pos++; break; }
            text += src[pos++];
          }
          continue;
        }
        text += "'"; pos++; continue;                            // I'm — просто знак
      }
      if (ch === '{') { flush(); nodes.push(argument()); continue; }
      if (ch === '}' && inBranch) break;                         // снаружи веток } — просто знак
      if (ch === '#' && inPlural) { flush(); nodes.push({ type: 'pound' }); pos++; continue; }
      text += ch; pos++;
    }
    flush();
    return nodes;
  }

  function argument() {
    pos++;                                                       // {
    const name = word();
    spaces();
    if (src[pos] === '}') { pos++; return { type: 'arg', name }; }
    expect(',');
    const type = word();
    if (!['select', 'plural', 'selectordinal'].includes(type)) fail('тип ' + type + ' не разобран');
    expect(',');
    let offset = 0;
    spaces();
    if (type === 'plural' && src.startsWith('offset:', pos)) { pos += 7; offset = Number(word()); }
    const options = {};
    for (spaces(); src[pos] !== '}'; spaces()) {
      if (pos >= src.length) fail('нет закрывающей }');
      const key = word();
      expect('{');
      options[key] = message(type !== 'select', true);
      expect('}');
    }
    pos++;                                                       // }
    if (!Object.hasOwn(options, 'other')) fail('нет ветки other у ' + name);
    return { type, name, offset, options };
  }

  return message(false, false);
}

// Какую ветку взять: точное =N, иначе категория CLDR, иначе other.
function pick(node, values, locale) {
  const has = (key) => Object.hasOwn(node.options, key);
  if (node.type === 'select') {
    const key = String(values[node.name]);
    return { key: has(key) ? key : 'other' };
  }
  const n = Number(values[node.name]);
  const type = node.type === 'plural' ? 'cardinal' : 'ordinal';
  const category = new Intl.PluralRules(locale, { type }).select(n - node.offset);
  const key = has('=' + n) ? '=' + n : has(category) ? category : 'other';
  return { key, category, pound: n - node.offset };
}

// Обход дерева. pound — число для # ближайшего plural.
function format(nodes, values, locale, pound) {
  let out = '';
  for (const node of nodes) {
    if (typeof node === 'string') out += node;
    else if (node.type === 'pound') out += new Intl.NumberFormat(locale).format(pound);
    else if (node.type === 'arg') out += String(values[node.name]);
    else {
      const { key, pound: inner } = pick(node, values, locale);
      out += format(node.options[key], values, locale, inner ?? pound);
    }
  }
  return out;
}`;

export const PLAIN_PARSER =
  'Как разбирать матрёшку. `message` идёт по тексту, пока не встретит `{`. Тогда `argument` открывает куклу: читает имя, тип и ветки, а каждую ветку снова отдаёт `message` — внутри может быть следующая кукла. Закрывающая `}` значит «эта кукла кончилась, вернись на уровень выше».';

export const PARSER_STEPS = [
  {
    k: 'parse: текст → дерево',
    d: 'Две функции вызывают друг друга. `message` копит текст и на `{` зовёт `argument`; `argument` читает `имя, тип,` и ветки `ключ {…}`, а содержимое каждой ветки снова читает `message`. Так вложенность любой глубины получается сама.',
  },
  {
    k: 'Апостроф',
    d: 'Правило ICU: апостроф особый, только если за ним стоит `{`, `}` или (в ветке plural) `#`. Тогда он открывает цитату до следующего апострофа. `\'\'` — всегда один апостроф. В остальных случаях — обычный знак, поэтому `I\'m` не ломает сообщение.',
  },
  {
    k: 'pick: какая ветка',
    d: 'Для `select` — ветка с ключом, равным значению, иначе `other`. Для `plural` — сначала точное `=N` по самому числу, потом категория `Intl.PluralRules` от числа минус `offset`, потом `other`. Категория, которой нет среди веток, тоже уходит в `other`.',
  },
  {
    k: 'format: обход',
    d: 'Текст переписывается как есть, `{name}` — через `String`, ветвление — через `pick` и рекурсивный вызов. `#` печатает число своего ближайшего plural через `Intl.NumberFormat`, поэтому во вложенном plural у `#` своё число.',
  },
];

export const ICU_TEST_NOTE =
  'Сто строк — без форматов `number` и `date` и без тегов вроде `<b>`, которые умеет `intl-messageformat`. Всё остальное совпадает с двумя библиотеками на тысячах сообщений, чисел и локалей; где сами библиотеки расходятся, функция идёт за `intl-messageformat` — так же, как ICU.';

export const DEMO_PRESETS: IcuPreset[] = [
  {
    id: 'files',
    label: 'Файлы',
    message: '{n, plural, =0 {Файлов нет} one {# файл} few {# файла} many {# файлов} other {# файла}}',
    locale: 'ru',
    values: { n: 21 },
    note: 'Двигайте число и смотрите на категорию: 21 и 1 — `one`, 11 и 12 — `many`, любая дробь — `other`. Переключите локаль на `ar` — у арабского шесть категорий, `zero` и `two` в сообщении нет, и они уходят в `other`.',
  },
  {
    id: 'offset',
    label: 'offset',
    message: '{n, plural, offset:1 =0 {В чате никого} =1 {{name} в чате} one {{name} и ещё # человек} few {{name} и ещё # человека} many {{name} и ещё # человек} other {{name} и ещё # человека}}',
    locale: 'ru',
    values: { n: 3, name: 'Аня' },
    note: 'При `n = 22` в чате Аня и ещё 21 человек: `#` и категория считаются от `n − 1`, а `=0` и `=1` — от самого `n`.',
  },
  {
    id: 'gender',
    label: 'Род и число',
    message: '{g, select, female {{name} купила {n, plural, one {# книгу} few {# книги} many {# книг} other {# книги}}} male {{name} купил {n, plural, one {# книгу} few {# книги} many {# книг} other {# книги}}} other {{name}: {n, plural, one {# книга} few {# книги} many {# книг} other {# книги}}}}',
    locale: 'ru',
    values: { g: 'female', n: 3, name: 'Саша' },
    note: 'Имя одно, а глагол зависит от рода — его передают аргументом `g`. Внутри каждой ветки select — свой plural со своим `#`.',
  },
  {
    id: 'ordinal',
    label: 'Порядковые',
    message: '{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}} place',
    locale: 'en',
    values: { n: 23 },
    note: 'В английском у порядковых четыре категории: 1st, 2nd, 3rd — но 11th, 12th, 13th. Переключите на `ru`: русских порядковых категорий одна, и любое число получает `other`.',
  },
  {
    id: 'quote',
    label: 'Апострофы',
    message: "It''s '{'{n}'}' and '#' — {n, plural, one {'#'# item} other {'#'# items}}",
    locale: 'en',
    values: { n: 5 },
    note: "`''` — один апостроф. `'{'` и `'}'` — скобки буквально, между ними настоящий аргумент. Снаружи plural `'#'` печатается с апострофами: там `#` не особый знак.",
  },
];

export const DEMO_LOCALES = ['ru', 'en', 'uk', 'pl', 'ar', 'ja'];

export const DEMO_CAPTION =
  'Дерево строит `parse`, ветку выбирает `pick`, строку собирает `format` — функции из кода выше, без изменений. Категорию считает `Intl.PluralRules` вашего браузера. Направление вывода — `direction(locale)` из раздела про выбор локали: на `ar` строка выравнивается справа.';

// ─── Сборка сообщений ─────────────────────────────────────────────────────────────────────

export const AST_CODE = `// При сборке: разобрать один раз и положить дерево в JSON
const ast = parse('{n, plural, one {# файл} few {# файла} many {# файлов} other {# файла}}');
ast[0].type;   // → 6

// В браузере: формат берёт готовое дерево, и парсер можно не везти
new IntlMessageFormat(ast, 'ru').format({ n: 3 });   // → '3 файла'`;

export const AST_NOTE =
  '`parse` — из `@formatjs/icu-messageformat-parser`, того же, что `intl-messageformat` зовёт внутри. `6` — номер типа «plural» в этом дереве. Чтобы парсер действительно не попал в бандл, сборщику подменяют этот пакет на его же `no-parser.js`; так делает и инструмент formatjs, который компилирует словари.';

export const MF_MODULE_CODE = `import MessageFormat from '@messageformat/core';
import compileModule from '@messageformat/core/compile-module.js';

const mf = new MessageFormat('ru');
const source = compileModule(mf, {
  files: '{n, plural, one {# файл} few {# файла} many {# файлов} other {# файла}}',
  hello: 'Привет, {name}!',
});`;

/** Вывод `compileModule` — дословно, тест пересобирает его. */
export const MF_MODULE_OUT = `import { number, plural } from "@messageformat/runtime";
import { ru } from "@messageformat/runtime/lib/cardinals";
export default {
  files: (d) => plural(d.n, 0, ru, { one: number("ru", d.n, 0) + " файл", few: number("ru", d.n, 0) + " файла", many: number("ru", d.n, 0) + " файлов", other: number("ru", d.n, 0) + " файла" }),
  hello: (d) => "Привет, " + d.name + "!"
}`;

export const MF_MODULE_NOTE =
  'Словарь превратился в модуль с обычными функциями. Разбирать в браузере больше нечего: осталась склейка строк, `plural` и правило `ru`. Правило берётся не из `Intl.PluralRules`, а из пакета `make-plural` — это CLDR, переписанная в функции на JavaScript.';

export const SIZE_ROWS: { k: string; how: string; min: number; gz: number; tone?: 'ok' | 'warn' }[] = [
  { k: '`intl-messageformat`', how: 'строка разбирается в браузере', min: 33502, gz: 9871, tone: 'warn' },
  { k: '`intl-messageformat` без парсера', how: 'дерево готово заранее, пакет подменён на `no-parser.js`', min: 7240, gz: 2536, tone: 'ok' },
  { k: '`@messageformat/core`', how: '`compile` в браузере: разбор и `new Function`', min: 74525, gz: 21647, tone: 'warn' },
  { k: 'модуль `compileModule`', how: 'два сообщения выше плюс `@messageformat/runtime`', min: 738, gz: 419, tone: 'ok' },
  { k: '`vue-i18n`', how: 'с компилятором сообщений', min: 54011, gz: 19003 },
  { k: '`vue-i18n` без компилятора', how: '`__INTLIFY_DROP_MESSAGE_COMPILER__: true`, словари собраны заранее', min: 37646, gz: 14095 },
  { k: 'учебные `parse` + `pick` + `format`', how: 'код выше после минификации', min: 2073, gz: 969 },
];

/** Строки таблицы: байты с разрядами, gzip — в КБ с одним знаком. */
export const SIZE_TABLE = SIZE_ROWS.map((r) => [
  r.k,
  r.how,
  r.min.toLocaleString('ru'),
  (r.gz / 1024).toLocaleString('ru', { maximumFractionDigits: 1 }) + ' КБ',
]);

export const SIZE_NOTE =
  'Байты — `esbuild --bundle --minify`, `vue` внешний, gzip уровня 9. Сам парсер ICU в `intl-messageformat` — около 26 КБ из 33: разница между первыми двумя строками почти целиком его. Компилятор vue-i18n весит меньше, около 16 КБ, но работает так же: разбирает строку словаря при первом `t()` с этим ключом.';

export const COMPILE_CARDS = [
  {
    t: 'Разбор в браузере',
    d: 'Словарь — JSON со строками ICU. Строку разбирают при первом показе и запоминают результат: так делает встроенный компилятор vue-i18n. Просто подключить, словарь можно подменить без пересборки. Цена — парсер в бандле и разбор на клиенте.',
  },
  {
    t: 'Разбор при сборке',
    d: 'Словарь превращается в дерево (formatjs) или в функции (`compileModule`, плагин vue-i18n). Парсера в бандле нет, ошибка синтаксиса в переводе ломает сборку, а не страницу у пользователя.',
    tone: 'ok' as const,
  },
  {
    t: '`new Function` и CSP',
    d: '`compile` из `@messageformat/core` собирает функцию из текста: на стенде — ровно один вызов `new Function` на сообщение. Под политикой CSP без `\'unsafe-eval\'` это запрещено. `intl-messageformat` и vue-i18n 11 обходят дерево и `eval` не требуют.',
    tone: 'warn' as const,
  },
];

export const CSP_LINK =
  'Что именно запрещает `script-src` без `\'unsafe-eval\'` — в теме [«CSP», раздел «Как браузер решает»](/platform/csp/#s1).';

// ─── MessageFormat 2 ───────────────────────────────────────────────────────────────────────

/** По спецификации Unicode MessageFormat 2.0 — ни один пакет стенда этот синтаксис не разбирает. */
export const MF2_CODE = `.input {$count :number}
.match $count
0    {{Новых сообщений нет}}
one  {{{$count} новое сообщение}}
few  {{{$count} новых сообщения}}
many {{{$count} новых сообщений}}
*    {{{$count} новых сообщения}}`;

export const MF2_FACTS = [
  {
    t: 'Что поменялось',
    d: 'Ветвление вынесено наверх: `.match` перечисляет варианты всей фразы, а не вложенные куски. Переменные пишутся с `$`, функции — с `:` (`:number`, `:string`, `:datetime`). Текст варианта — в двойных фигурных скобках, ветка «всё остальное» — `*`.',
  },
  {
    t: 'Где это есть',
    d: 'Синтаксис закреплён в стандарте Unicode (LDML 47, 2025). `Intl.MessageFormat` — предложение TC39, в движках его нет: на стенде `typeof Intl.MessageFormat` — `\'undefined\'` и в Node 24, и в Chromium 153. Установленные пакеты — `intl-messageformat` 12 и `@messageformat/core` 3 — понимают только первую версию.',
    tone: 'warn' as const,
  },
  {
    t: 'Что делать сейчас',
    d: 'Писать на MessageFormat 1: его понимают все инструменты перевода. MF2-строку библиотека первой версии не разберёт: пример выше обе отвергают с ошибкой синтаксиса.',
  },
];

// ─── vue-i18n ──────────────────────────────────────────────────────────────────────────────

export const VI_SYNTAX_ROWS = [
  { k: 'аргумент', icu: '`{name}`', vi: '`{name}`' },
  { k: 'множественное число', icu: '`{n, plural, one {…} few {…} …}`', vi: '`{n} файл | {n} файла | {n} файлов` — варианты через `|`' },
  { k: 'выбор по значению', icu: '`{g, select, …}`', vi: 'нет — отдельные ключи' },
  { k: 'ссылка на другой ключ', icu: 'нет', vi: '`@:common.ok`' },
  { k: 'буквальная `{` или `@`', icu: "`'{'`", vi: "`{'{'}`, `{'@'}`" },
];

export const VI_SYNTAX_NOTE =
  'У vue-i18n свой формат сообщений, не ICU. Строку ICU его компилятор не примет: `{n, plural, …}` даёт ошибку `Invalid token in placeholder: \'n,\'`. А обычный адрес почты `help@site.ru` в тексте — тоже ошибка, `Invalid linked format`: `@` начинает ссылку на другой ключ. Буквальный `@` пишут как `{\'@\'}`.';

export const VI_PLURAL_CODE = `const messages = { ru: { files: '{n} файл | {n} файла | {n} файлов' } };

const plain = createI18n({ legacy: false, locale: 'ru', messages });
[0, 1, 2, 5, 21].map((n) => plain.global.t('files', n));
// → ['0 файл', '1 файла', '2 файлов', '5 файлов', '21 файлов']

const pr = new Intl.PluralRules('ru');
const index = { one: 0, few: 1, many: 2, other: 1 };
const fixed = createI18n({
  legacy: false, locale: 'ru', messages,
  pluralRules: { ru: (n) => index[pr.select(n)] },
});
[0, 1, 2, 5, 21].map((n) => fixed.global.t('files', n));
// → ['0 файлов', '1 файл', '2 файла', '5 файлов', '21 файл']`;

export const VI_PLURAL_NOTE =
  'Правило по умолчанию — не CLDR. При трёх вариантах оно берёт номер `min(n, 2)`: 0 → первый, 1 → второй, всё остальное → третий. Это схема «ноль | один | много», и для русского она неверна на каждом числе. Правило для языка задают опцией `pluralRules` — функцией «число → номер варианта», и проще всего построить её на `Intl.PluralRules`.';

export const VI_ICU_CODE = `const compiled = new Map();   // свой компилятор vue-i18n не кеширует — кешируем сами

const i18n = createI18n({
  legacy: false,
  locale: 'ru',
  messages: { ru: { files: '{n, plural, one {# файл} few {# файла} many {# файлов} other {# файла}}' } },
  // Строка словаря → функция, которую vue-i18n позовёт с аргументами
  messageCompiler: (message, { locale }) => {
    const id = locale + ' ' + message;
    if (!compiled.has(id)) {
      const mf = new IntlMessageFormat(message, locale);
      compiled.set(id, (ctx) => mf.format(ctx.values));
    }
    return compiled.get(id);
  },
});
i18n.global.t('files', { n: 21 });    // → '21 файл'
i18n.global.t('files', { n: 1.5 });   // → '1,5 файла'
compiled.size;                        // → 1`;

export const VI_ICU_NOTE =
  'Опция `messageCompiler` подменяет формат сообщений целиком. Словари остаются ICU — их понимают сервисы перевода, — а `t`, `$t`, ленивые словари и запасные локали работают как раньше. Две оговорки. Встроенный компилятор хранит разобранное сообщение в своём кеше, а свой vue-i18n зовёт на **каждый** `t()`: на стенде без `Map` два вызова с одним ключом дали два разбора. И dev-сборка vue-i18n 11 предупреждает, что свой компилятор — экспериментальная возможность и может измениться.';

/**
 * Модуль: тест пишет его на диск рядом с `locales/ru.js` и `locales/uk.js` и импортирует.
 * `i18n` — экземпляр `createI18n`, его передаёт вызывающий.
 */
export const VI_LAZY_CODE = `const loaders = {
  ru: () => import('./locales/ru.js'),
  uk: () => import('./locales/uk.js'),
};
const loaded = new Set(['en']);           // en лежит в основном бандле как запасной

export async function setLocale(i18n, locale) {
  if (!loaded.has(locale)) {
    const { default: messages } = await loaders[locale]();
    i18n.global.setLocaleMessage(locale, messages);
    loaded.add(locale);
  }
  i18n.global.locale.value = locale;      // переключать после загрузки, не до
  document.documentElement.lang = locale;
}`;

export const VI_LAZY_NOTE =
  'Каждый `import()` с постоянной строкой сборщик выносит в отдельный файл: на стенде esbuild с `splitting` дал основной модуль и по чанку на `ru` и `uk`. Пользователь качает только свой язык. Почему так устроены чанки — в теме [«Бандлер изнутри», раздел «Чанки»](/tooling/bundler-internals/#s4).';

export const VI_REACT_FACTS = [
  {
    t: 'Смена локали — это запись в `ref`',
    d: '`i18n.global.locale` — `ref`. `t()` читает его во время рендера, поэтому компонент на него подписан. На стенде после `locale.value = \'ru\'` DOM в тот же миг ещё английский, а после `nextTick` — русский, и компонент перерисовался ровно один раз.',
  },
  {
    t: 'Сначала словарь, потом локаль',
    d: 'Если переключить `locale` до загрузки словаря, `t()` не найдёт ключ и уйдёт по запасной цепочке: на стенде вышло «Hello, Аня!» вместо «Привет, Аня!». Пользователь увидит мелькание языка.',
    tone: 'warn' as const,
  },
  {
    t: '`$t` и `useI18n`',
    d: 'В режиме Composition (`legacy: false`) `$t` в шаблоне — тот же `t` глобального экземпляра: vue-i18n 11 вешает его на приложение по умолчанию (`globalInjection`). `useI18n()` даёт `t` и `locale` внутри `setup`.',
  },
  {
    t: '`v-t` устарел',
    d: 'Директива `v-t="\'hello\'"` в vue-i18n 11 помечена устаревшей: сборка для сборщиков пишет в dev-режиме «`\'v-t\' has been deprecated in v11`», удаление обещано в v12. Режим `legacy: true` — туда же.',
  },
];

/** Цепочки пересчитывает тест функцией `fallbackWithLocaleChain` из `@intlify/core-base`. */
export const FALLBACK_ROWS: { start: string; fallback: string; chain: string[]; d: string; tone?: 'warn' | 'err' }[] = [
  { start: 'ru-RU', fallback: "'en'", chain: ['ru-RU', 'ru', 'en'], d: 'Неявный шаг: тег обрезается справа по дефису.' },
  { start: 'pt-BR', fallback: "{ 'pt-BR': ['pt-PT'], default: ['en'] }", chain: ['pt-BR', 'pt-PT', 'pt', 'en'], d: 'Явная запасная идёт первой, а `pt` появляется уже как родитель `pt-PT`.' },
  { start: 'de-CH', fallback: "{ 'de-CH': ['fr'], default: ['en'] }", chain: ['de-CH', 'fr', 'en'], d: 'Явный список **заменяет** неявный шаг: немецкого `de` в цепочке нет.', tone: 'warn' },
  { start: 'zh-Hant-TW', fallback: "'en'", chain: ['zh-Hant-TW', 'zh-Hant', 'zh', 'en'], d: 'Обрезка не знает письменностей: `zh` по умолчанию упрощённое письмо, а человек читает традиционное.', tone: 'warn' },
];

export const FALLBACK_NOTE =
  'Если ключа нет во всей цепочке, `t()` возвращает сам ключ — `\'nope.key\'`. Dev-сборка при этом пишет предупреждения на каждый шаг: `Not found \'nope.key\' key in \'ru\' locale messages.`, `Fall back to translate \'nope.key\' key with \'en\' locale.` и снова «not found» для `en`. Опция `missing` — функция `(locale, key) => …`: в ней ключ отправляют в журнал и возвращают что-то заметное, например `⟦nope.key⟧`.';

// ─── Выбор локали ──────────────────────────────────────────────────────────────────────────

export const LOCALE_SOURCES = [
  { k: 'путь `/ru/…`', who: 'сервер и клиент одинаково', d: 'Одна локаль — один адрес. Ссылку можно отправить, поисковик видит каждую версию отдельно. Обычный выбор по умолчанию.', tone: 'ok' as const },
  { k: 'cookie', who: 'сервер и клиент', d: 'Запоминает явный выбор человека. Адрес без локали отдаёт разное разным людям — поисковику и кешу нужно это знать.' },
  { k: '`Accept-Language`', who: 'только сервер', d: 'Заголовок со списком языков браузера по убыванию `q`. Годится для первого захода: перенаправить на `/ru/` один раз.' },
  { k: '`navigator.languages`', who: 'только клиент', d: 'Тот же список из JS. Сервер о нём не знает: страница, отрисованная сервером, может разойтись с клиентом.', tone: 'warn' as const },
  { k: 'локаль по умолчанию', who: 'все', d: 'Когда ничего не подошло или заголовка нет вовсе.' },
];

export const LOCALE_NOTE =
  'Порядок в таблице — порядок проверки: явное (адрес, cookie) сильнее догадки (заголовок, настройки браузера). Шаблон пути с параметром локали разбирает роутер, как любой другой — см. [«Роутер изнутри», раздел «Шаблон пути»](/frameworks/router/#s4).';

export const NEGOTIATE_CODE = `const valid = (tag) => {
  try { return Intl.getCanonicalLocales(tag).length > 0; } catch { return false; }
};

// 'ru-RU,ru;q=0.9,en;q=0.8' → ['ru-RU', 'ru', 'en'] по убыванию q
function parseAcceptLanguage(header = '') {
  return header.split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      return { tag: tag.trim(), q: q ? Number(q.slice(2)) : 1 };
    })
    .filter(({ tag, q }) => tag !== '*' && q > 0 && valid(tag))
    .sort((a, b) => b.q - a.q)
    .map(({ tag }) => tag);
}

// Сначала точное совпадение, потом тот же язык с другим регионом.
function pickLocale(wanted, supported, fallback) {
  for (const tag of wanted) {
    const exact = supported.find((s) => s.toLowerCase() === tag.toLowerCase());
    if (exact) return exact;
    const lang = new Intl.Locale(tag).language;
    const same = supported.find((s) => new Intl.Locale(s).language === lang);
    if (same) return same;
  }
  return fallback;
}

const ours = ['en', 'ru', 'pt-PT'];
pickLocale(parseAcceptLanguage('ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7'), ours, 'en');   // → 'ru'
pickLocale(parseAcceptLanguage('de-CH,de;q=0.9,fr;q=0.8'), ours, 'en');               // → 'en'
pickLocale(parseAcceptLanguage('en;q=0.5,ru;q=0.9'), ours, 'en');                     // → 'ru'
pickLocale(parseAcceptLanguage('pt-BR'), ours, 'en');                                 // → 'pt-PT'
pickLocale(parseAcceptLanguage('ru_RU,pt;q=0.5'), ours, 'en');                       // → 'pt-PT'
pickLocale(parseAcceptLanguage(''), ours, 'en');                                      // → 'en'`;

export const NEGOTIATE_NOTE =
  'Порядок решает `q`, а не место в строке: при `en;q=0.5,ru;q=0.9` выигрывает русский. Заголовок пишет клиент, и верить его формату нельзя: на теге с подчёркиванием `ru_RU` `Intl.getCanonicalLocales` бросает `RangeError`, поэтому `valid` ловит ошибку и тег отбрасывается. Пустой заголовок — обычный случай: headless Chromium на стенде без настроенной локали не прислал `Accept-Language` вовсе.';

export const SSR_FACTS = [
  {
    t: 'Сервер и клиент выбирают по-разному',
    d: 'Сервер видит заголовок, клиент — `navigator.languages`. Если сервер отрисовал страницу по-русски, а клиент при гидратации выбрал английский, текст разойдётся с разметкой. Локаль выбирают один раз, на сервере, и передают клиенту вместе с данными страницы. Что бывает при расхождении — в теме [«SSR и гидратация», раздел «Несовпадения»](/frameworks/ssr-hydration/#s3).',
    tone: 'warn' as const,
  },
  {
    t: 'Поисковик не шлёт языков',
    d: 'По документации Google, робот обычно приходит без `Accept-Language`. Перенаправление «по заголовку» на одну версию прячет остальные. Каждая языковая версия должна жить по своему адресу и ссылаться на соседей через `hreflang`.',
  },
  {
    t: '`Vary: Accept-Language`',
    d: 'Если один адрес отдаёт разные языки по заголовку, ответ обязан говорить об этом кешу. Иначе CDN закеширует русскую страницу и отдаст её всем.',
  },
];

export const HREFLANG_HTML = `<html lang="ru">
<head>
  <link rel="alternate" hreflang="ru" href="https://example.com/ru/pricing/">
  <link rel="alternate" hreflang="en" href="https://example.com/en/pricing/">
  <link rel="alternate" hreflang="pt-PT" href="https://example.com/pt-PT/pricing/">
  <link rel="alternate" hreflang="x-default" href="https://example.com/pricing/">
</head>`;

export const HREFLANG_NOTE =
  'Каждая версия страницы перечисляет все версии, включая саму себя. `x-default` — адрес для тех, чей язык не подошёл: обычно страница выбора языка или английская. `lang` на `<html>` нужен не поисковику, а экранному диктору и переносам слов — без него русский текст читается английским голосом.';

export const DIRECTION_CODE = `const direction = (locale) => new Intl.Locale(locale).getTextInfo().direction;

direction('ar');   // → 'rtl'
direction('he');   // → 'rtl'
direction('fa');   // → 'rtl'
direction('ru');   // → 'ltr'`;

export const LOGICAL_CSS = `.card {
  margin-inline-start: 16px;   /* слева при ltr, справа при rtl */
  padding-inline: 12px 24px;   /* начало строки, конец строки */
  border-inline-start: 4px solid;
  text-align: start;
}`;

export const RTL_NOTE =
  '`<html dir="rtl">` зеркалит строку и порядок элементов во flex и grid. Чего он не трогает — это `left` и `right` в ваших стилях: `margin-left` остаётся слева. Логические свойства (`inline-start` — «где начинается строка») поворачиваются вместе с `dir`: на стенде Chromium при `dir="rtl"` превратил `margin-inline-start: 16px` в `margin-right`. Значения, пришедшие от пользователя, — имя, адрес, — вставляют в `<bdi>`: иначе латинское имя посреди арабской фразы переставит соседние знаки препинания.';

export const PLAIN_RTL =
  'Как левосторонний и правосторонний руль. Машина та же, но всё, что было «слева от водителя», переезжает направо. Если в инструкции написано «рычаг слева», она верна только для одной страны; «рычаг у двери водителя» — для обеих. `margin-left` — это «слева», `margin-inline-start` — «у начала строки».';

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: '`{n}` без `number` не локализуется',
    d: 'Простой аргумент печатается через `String`: `{n}` при 1234.5 — «1234.5» в любой локали. Число для людей пишут как `{n, number}` или через `#` в plural — тогда «1 234,5».',
    tone: 'warn',
  },
  {
    n: '02',
    t: 'vue-i18n по умолчанию склоняет не по-русски',
    d: 'Без `pluralRules` сообщение `{n} файл | {n} файла | {n} файлов` даёт «1 файла», «2 файлов», «21 файлов». Правило по умолчанию — «ноль | один | много», ошибки при этом нет никакой.',
    tone: 'err',
  },
  {
    n: '03',
    t: 'Апостроф перед `{` съедает аргумент',
    d: "Французское `Supprimer l'{item} ?` в `intl-messageformat` даёт «Supprimer l{item} ?»: апостроф открыл цитату, и аргумент стал текстом. `@messageformat/core` на той же строке печатает «l'image» — библиотеки расходятся. Надёжно — типографский апостроф `’` или удвоенный `''`.",
    code: "new IntlMessageFormat(\"Supprimer l'{item} ?\", 'fr').format({ item: 'image' });\n// → 'Supprimer l{item} ?'",
    tone: 'err',
  },
  {
    n: '04',
    t: '`@` в тексте vue-i18n — ошибка компиляции',
    d: '`help@site.ru` в сообщении vue-i18n — это `Invalid linked format`: `@` начинает ссылку на другой ключ. Буквальный знак пишут как `{\'@\'}`. Так же особые `{`, `}` и `|`.',
    tone: 'warn',
  },
  {
    n: '05',
    t: '`#` в select внутри plural',
    d: '`{n, plural, other {{g, select, x {#} other {#}}}}`: `intl-messageformat` печатает «#», `@messageformat/core` — число. Правило ICU — `#` особый только прямо в ветке plural. Число во вложенном select пишут аргументом: `{n, number}`.',
    tone: 'warn',
  },
  {
    n: '06',
    t: 'Явная запасная локаль заменяет неявную',
    d: 'С `fallbackLocale: { \'de-CH\': [\'fr\'], default: [\'en\'] }` цепочка для `de-CH` — `de-CH → fr → en`: словарь `de` не проверяется. Нужен — впишите его в список первым.',
    tone: 'warn',
  },
  {
    n: '07',
    t: 'Обрезка тега меняет письменность',
    d: '`zh-Hant-TW` падает в `zh`, а `zh` — это `zh-Hans-CN` (`new Intl.Locale(\'zh\').maximize()`): упрощённые иероглифы вместо традиционных. То же у `sr-Latn` и `sr` (кириллица). Таким локалям нужна явная запасная.',
  },
  {
    n: '08',
    t: 'Пропавший ключ виден только как ключ',
    d: 'В продакшене `t(\'cart.title\')` без перевода молча возвращает `cart.title` — предупреждения есть только в dev-сборке. Опция `missing` отправляет такие ключи в журнал.',
    tone: 'err',
  },
  {
    n: '09',
    t: '`date, short` в двух библиотеках — разный год',
    d: '`{d, date, short}` на 2 октября 2026: `intl-messageformat` — «02.10.26», `@messageformat/core` и `Intl.DateTimeFormat` с `dateStyle: \'short\'` — «02.10.2026». У formatjs свои пресеты (`year: \'2-digit\'`). Переезд между библиотеками меняет вывод без единой правки словаря.',
  },
  {
    n: '10',
    t: 'Сообщение MF2 в библиотеке MF1',
    d: 'Первая версия `.match` не понимает. Длинный пример из темы обе библиотеки отвергают. Но строку покороче — `.input {$n :number} .match $n one {{один}} * {{много}}` — `@messageformat/core` принимает без ошибки и печатает как текст с `{undefined}` вместо вариантов — мусор доходит до экрана.',
    tone: 'err',
  },
  {
    n: '11',
    t: 'Локаль, выбранная дважды',
    d: 'Сервер выбрал по `Accept-Language`, клиент — по `navigator.languages`, и гидратация встречает другой текст. Локаль выбирают один раз и передают клиенту.',
    tone: 'warn',
  },
  {
    n: '12',
    t: '`compile` в браузере и CSP',
    d: '`@messageformat/core` собирает функцию через `new Function`: под CSP без `\'unsafe-eval\'` сообщение не скомпилируется. Выход — `compileModule` при сборке.',
  },
];

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'ICU User Guide — Formatting Messages',
    href: 'https://unicode-org.github.io/icu/userguide/format_parse/messages/',
    what: 'синтаксис `plural`, `select`, `selectordinal`, `offset`, `#`, правила апострофа',
  },
  {
    title: 'ICU4J — MessagePattern (ApostropheMode)',
    href: 'https://unicode-org.github.io/icu-docs/apidoc/released/icu4j/com/ibm/icu/text/MessagePattern.html',
    what: 'точное правило: апостроф особый только перед `{`, `}`, `#` в plural и `|`',
  },
  {
    title: 'Unicode CLDR — Language Plural Rules',
    href: 'https://www.unicode.org/cldr/charts/latest/supplemental/language_plural_rules.html',
    what: 'категории для каждого языка: ru, uk, pl — четыре, ar — шесть, ja — одна',
  },
  {
    title: 'FormatJS — intl-messageformat',
    href: 'https://formatjs.github.io/docs/intl-messageformat',
    what: 'формат, пресеты дат и чисел, передача готового дерева; версия 12.1.2 на стенде',
  },
  {
    title: 'messageformat — compileModule',
    href: 'https://messageformat.github.io/messageformat/api/core.compilemodule/',
    what: 'сборка словаря в модуль функций; `@messageformat/core` 3.4.0 на стенде',
  },
  {
    title: 'Unicode MessageFormat 2.0 (LDML, часть 9)',
    href: 'https://www.unicode.org/reports/tr35/tr35-messageFormat.html',
    what: 'синтаксис `.input`, `.match`, `*`; по нему написан пример MF2',
  },
  {
    title: 'TC39 — Intl.MessageFormat',
    href: 'https://github.com/tc39/proposal-intl-messageformat',
    what: 'предложение встроить MF2 в язык',
  },
  {
    title: 'Vue I18n — Pluralization, Lazy loading, Fallbacking',
    href: 'https://vue-i18n.intlify.dev/guide/essentials/pluralization.html',
    what: '`pluralRules`, `setLocaleMessage`, `fallbackLocale`, `missing`; 11.4.12 на стенде',
  },
  {
    title: 'Vue I18n — Custom message format',
    href: 'https://vue-i18n.intlify.dev/guide/advanced/format.html',
    what: '`messageCompiler` и подключение `intl-messageformat`',
  },
  {
    title: 'RFC 9110 — Accept-Language',
    href: 'https://www.rfc-editor.org/rfc/rfc9110#name-accept-language',
    what: 'формат заголовка и веса `q`',
  },
  {
    title: 'Google Search Central — Localized versions (hreflang)',
    href: 'https://developers.google.com/search/docs/specialty/international/localized-versions',
    what: '`hreflang`, `x-default`, взаимные ссылки',
  },
  {
    title: 'Google Search Central — Locale-adaptive pages',
    href: 'https://developers.google.com/search/docs/specialty/international/locale-adaptive-pages',
    what: 'робот приходит без `Accept-Language`',
  },
  {
    title: 'MDN — CSS logical properties and values',
    href: 'https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_logical_properties_and_values',
    what: '`margin-inline-start`, `padding-inline`, `text-align: start`',
  },
];

export const RELATED =
  'Смежное на сайте: [Unicode и Intl, раздел «Числа и слова»](/js/unicode-intl/#s7) — категории CLDR, `Intl.PluralRules`, `NumberFormat`, `ListFormat`. [Время и даты, раздел «Сравнение и вывод»](/js/time-dates/#s4) — `Intl.DateTimeFormat` и часовые пояса. [SSR и гидратация, раздел «Несовпадения»](/frameworks/ssr-hydration/#s3) — что делает разная локаль сервера и клиента. [Роутер изнутри, раздел «Шаблон пути»](/frameworks/router/#s4) — как разбирается `/:locale/…`. [Бандлер изнутри, раздел «Чанки»](/tooling/bundler-internals/#s4) — во что превращается `import()` словаря. [CSP, раздел «Как браузер решает»](/platform/csp/#s1) — почему `new Function` бывает запрещён.';
