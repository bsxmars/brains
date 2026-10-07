import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { CompatTable, CustomRange, FeatureRow, TranspilePreset } from '@/widgets/transpile-lab/model/types';

/**
 * Данные темы «Транспиляция и полифилы: что сборка переписывает, а что дописывает».
 *
 * Тема написана здесь, 2026-10-01, по списку кандидатов для направления «Сборка и инструменты».
 * Что уже разобрано на сайте и здесь даётся одной фразой со ссылкой: двойная сборка
 * `type="module"`/`nomodule` и `@vitejs/plugin-legacy` — «Модули и сборка», раздел «Dev не равен
 * prod»; `async/await` как генератор под `spawn` — «Генераторы», раздел «async/await из
 * генератора»; приватность через `WeakMap` и то, что `Proxy` нельзя полифилить, — «Объектная
 * модель», разделы «Классы» и «Proxy и Reflect». Здесь — механика выбора: запрос → цели →
 * плагины и модули, цена каждого преобразования и места, где копия расходится с оригиналом.
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * `@babel/core` и `@babel/preset-env` **7.29.7**, `core-js` и `core-js-compat` **3.50.0**,
 * `browserslist` **4.28.9** с `caniuse-lite` 1.0.30001810, esbuild **0.28.2**, TypeScript
 * **6.0.3** — всё из `node_modules` проекта. Node 24.11.0, Chromium 153.0.8010.12 (Playwright
 * 1.63), октябрь 2026.
 *
 * Вызовы:
 *   — browserslist: `browserslist(query, { mobileToDesktop: true })` — с этим флагом его зовёт
 *     сам Babel (`@babel/helper-compilation-targets`), поэтому список в `PRESETS[].browsers`
 *     тот же, что видит preset-env;
 *   — Babel: `transformSync(SAMPLE_CODE, { configFile: false, babelrc: false,
 *     browserslistConfigFile: false, filename: 'cart.js', presets: [['@babel/preset-env',
 *     { targets: query, modules: false, debug: true }]] })` → `PRESETS[].code`; число
 *     плагинов — строки под «Using plugins:» без `syntax-*`;
 *   — полифилы: то же с `useBuiltIns: 'usage', corejs: '3.50'` → `PRESETS[].usage`;
 *     `'entry'` на исходнике `import "core-js/stable";` → `PRESETS[].entry`;
 *   — байты: код — `esbuild.transform(code, { minify: true, format: 'esm', charset: 'utf8' })`,
 *     gzip — `zlib.gzipSync(…, { level: 9 })`; полифилы — `esbuild.build` из строки
 *     `import "core-js/modules/<модуль>.js"` по списку, `bundle + minify`, `format: 'iife'`.
 *     Это вес полифилов в сборке, без вашего кода;
 *   — отдельные конструкции (`SNIPPETS`) — Babel с одним плагином (`plugins: [...]`), без
 *     preset-env: так видно цену одной конструкции без соседей.
 *
 * Что снято запуском, а не взято из документации, — всё, кроме помеченного «по документации»:
 * версия Chrome 109 как последняя для Windows 7, «Babel 8 включает `bugfixes` по умолчанию»,
 * `typeof` у полифила `Symbol`, `@babel/plugin-transform-runtime` (пакета в проекте нет), причина
 * сравнения с `null` и `undefined` порознь в `?.` (`document.all`, допущение `noDocumentAll`).
 * Подмена `structuredClone` полифилом снята и в Node 24.11.0, и в Chromium 153 (скриптом
 * через Playwright на странице `about:blank`); в тесте — только Node.
 *
 * Всё перечисленное пересобирается `tests/unit/transpilation.test.ts`: литералы сверяются
 * с тем, что Babel, esbuild, tsc и browserslist выдают сейчас, а `DECIDE_CODE` — с решением
 * самого preset-env на двух десятках запросов.
 *
 * Найдено по дороге, в текст не пошло: на запросе из одного `safari TP` учебная функция
 * и Babel расходятся — Babel оставляет цель `tp` и считает её «умеющей всё», учебная функция
 * пропускает TP и остаётся без целей. В реальных запросах TP идёт вместе с выпущенными
 * версиями, и тогда Babel тоже берёт выпущенную.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'транспиляция',
    d: 'Перевод кода с новой версии JavaScript на старую: `a?.b` становится проверкой на `null` и `undefined`, `async` — генератором с обвязкой. Результат — снова JavaScript, просто написанный старыми словами.',
  },
  {
    k: 'полифил',
    d: 'Код, который при запуске проверяет, есть ли у движка встроенный метод или объект, и если нет — дописывает свою реализацию в прототип или глобальный объект. Синтаксис полифилом не добавить: до запуска дело не дойдёт.',
  },
  {
    k: 'browserslist',
    d: 'Строка-запрос вроде `defaults` или `safari >= 13`, которую библиотека browserslist превращает в список конкретных версий браузеров. Лежит в `package.json` или в файле `.browserslistrc`, её читают Babel и инструменты CSS.',
  },
  {
    k: 'цели (targets)',
    d: 'Самая старая версия каждого браузера из списка: `{ chrome: 109, safari: 26.5 }`. Решение принимают по ним — если самая старая версия умеет конструкцию, новые умеют тем более.',
  },
  {
    k: 'таблица совместимости',
    d: 'Данные «с какой версии браузер умеет X». Для синтаксиса это пакет `@babel/compat-data`, для встроенных функций — `core-js-compat`. Их составляют по тестам, а не по датам релизов.',
  },
  {
    k: 'хелпер',
    d: 'Служебная функция, которую Babel вписывает в начало файла, чтобы переписанный код работал: `_classPrivateFieldGet`, `_asyncToGenerator`, `_toConsumableArray`.',
  },
  {
    k: 'core-js',
    d: 'Самая распространённая библиотека полифилов. Один модуль — одна возможность: `es.array.at` дописывает `Array.prototype.at`, `web.structured-clone` — `structuredClone`.',
  },
];

export const PLAIN_TRANSPILE =
  'Представьте, что вы пишете письмо человеку, который учил язык по учебнику двадцатилетней давности. Новое слово, которого он не знает, можно заменить описанием из старых слов — это транспиляция: смысл тот же, слов больше. Но если в письме вы просите его воспользоваться вещью, которой у него дома нет, перефразировать бесполезно — вещь нужно положить в посылку. Это полифил.';

export const PREREQ_NOTE =
  'Тема опирается на четыре вещи. Каждая разобрана в своей теме — здесь хватит того, что написано на карточке.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'Сборка — цепочка инструментов',
    d: 'Код, который вы пишете, и код, который скачивает браузер, — разные файлы. Между ними стоит сборка: склейка модулей, минификация, а среди прочего — перевод синтаксиса под нужные браузеры. Отдельную легаси-сборку для старых браузеров через `type="module"`/`nomodule` эта тема не повторяет.',
    href: '/tooling/modules/#s6',
    hrefLabel: '«Модули и сборка», раздел «Dev не равен prod»',
    tone: 'info',
  },
  {
    t: 'Методы живут в прототипе',
    d: '`[1, 2].at(-1)` находит `at` не в самом массиве, а в `Array.prototype`. Поэтому полифил — это запись одного свойства в прототип: после неё метод появляется у всех массивов сразу.',
    href: '/js/object-model/#s2',
    hrefLabel: '«Объектная модель», раздел «Прототипы»',
    tone: 'info',
  },
  {
    t: 'Приватное поле `#x`',
    d: 'Поле, которое видно только коду внутри класса. Снаружи его не прочитать ни через `obj["#x"]`, ни через `Object.keys`. Ту же приватность можно изобразить `WeakMap`, где ключ — сам объект.',
    href: '/js/object-model/#s4',
    hrefLabel: '«Объектная модель», раздел «Классы»',
    tone: 'info',
  },
  {
    t: '`async/await` — генератор и промисы',
    d: 'Async-функцию можно записать генератором, который отдаёт промис через `yield`, и маленькой функцией, которая продолжает генератор, когда промис выполнится. Ровно это и делает Babel.',
    href: '/js/generators/#s2',
    hrefLabel: '«Генераторы», раздел «async/await из генератора»',
    tone: 'info',
  },
];

// ─── Раздел 1. Переписать или дописать ─────────────────────────────────────────────────────

/** Сквозной пример. Babel, esbuild и tsc на стенде получают именно эту строку. */
export const SAMPLE_CODE = `export class Cart {
  #items = [];

  add(item, ...rest) {
    this.#items = [...this.#items, item, ...rest];
    return this;
  }

  get last() {
    return this.#items.at(-1)?.title ?? 'пусто';
  }

  async total(fetchPrice) {
    let sum = 0;
    for (const item of this.#items) {
      sum += await fetchPrice(item.id);
    }
    return { ...this.snapshot(), sum };
  }

  snapshot() {
    return structuredClone({ items: this.#items });
  }
}

export function deferred() {
  const { promise, resolve } = Promise.withResolvers();
  return { promise, resolve };
}
`;

export const KIND_ROWS = [
  {
    k: 'синтаксис',
    what: '`#items`, `...rest`, `?.`, `??`, `async`/`await`, `{ ...obj }`, `const { a } =`',
    fail: 'Движок не может разобрать файл: `SyntaxError` до запуска, не выполняется **ни одна строка** этого файла.',
    fix: 'Транспилятор: плагин Babel переписывает конструкцию старыми словами.',
    tone: 'err' as const,
  },
  {
    k: 'встроенные функции (API)',
    what: '`.at(-1)`, `Promise.withResolvers()`, `structuredClone()`',
    fail: 'Файл разбирается и работает. Ошибка `TypeError` или `ReferenceError` — только в той строке, где вызвали то, чего нет.',
    fix: 'Полифил: модуль core-js проверяет, есть ли функция, и дописывает свою.',
    tone: 'warn' as const,
  },
];

/** Учебный полифил. Тест исполняет его в чистом realm без `Array.prototype.at` и сверяет с родным. */
export const POLYFILL_AT_CODE = `if (!Array.prototype.at) {
  Object.defineProperty(Array.prototype, 'at', {
    // как у встроенных методов: не видно в for…in, можно заменить
    enumerable: false, writable: true, configurable: true,
    value: function at(index) {
      const o = Object(this);
      const len = Math.min(Math.max(Math.trunc(Number(o.length)) || 0, 0), 2 ** 53 - 1);
      let k = Math.trunc(Number(index)) || 0;   // NaN и -0 → 0
      if (k < 0) k += len;                      // -1 → последний
      return k < 0 || k >= len ? undefined : o[k];
    },
  });
}`;

export const NAIVE_AT_CODE = `// Короче — и хуже: свойство, созданное присваиванием, перечисляемое
Array.prototype.at = function (i) { return this[i < 0 ? this.length + i : i]; };

for (const key in ['a', 'b']) console.log(key);   // 0, 1, at`;

export const POLYFILL_NOTE =
  'Полифил — обычный JavaScript, выполненный **до** вашего кода. Проверка «а есть ли уже» обязательна: на новом движке родная функция быстрее и точнее. core-js идёт дальше и проверяет не только «есть ли», но и «правильно ли работает» — и заменяет родную, если она расходится с его тестами. К чему это приводит, видно на `structuredClone` в разделе про полифилы.';

// ─── Раздел 2. От запроса к плагинам ───────────────────────────────────────────────────────

export const DECIDE_CHIPS = [
  { label: 'запрос: defaults', tone: 'ok' as const },
  { label: 'browserslist: 35 версий' },
  { label: 'цели: chrome 109, safari 26.5, …' },
  { label: 'таблица: с какой версии умеет' },
  { label: 'плагины и модули', tone: 'warn' as const },
];

export const PLAIN_TARGETS =
  'Как поход группой: идут все вместе, поэтому скорость задаёт самый медленный. Из двадцати версий Chrome в списке важна одна — самая старая. Если она понимает `?.`, понимают и остальные; если нет — переписывать придётся для всех, включая тех, кому это не нужно.';

/** Учебная функция: решение preset-env по таблице. Тест сверяет её с Babel на двух десятках запросов. */
export const DECIDE_CODE = `// Имена из browserslist → имена в таблицах Babel и core-js.
// Кого в словаре нет (op_mini, kaios, and_uc, and_qq), Babel пропускает молча.
const ENV = {
  chrome: 'chrome', and_chr: 'chrome', android: 'android', edge: 'edge',
  firefox: 'firefox', and_ff: 'firefox', safari: 'safari', ios_saf: 'ios',
  opera: 'opera', op_mob: 'opera_mobile', samsung: 'samsung',
  ie: 'ie', ie_mob: 'ie', node: 'node',
};

// "18.5-18.7" → [18, 5, 0]: от диапазона берётся нижняя граница.
function parse(version) {
  const [major = 0, minor = 0, patch = 0] =
    String(version).split('-')[0].split('.').map(Number);
  return [major, minor, patch];
}

function older(a, b) {
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i];
  return false;
}

// Шаг 1. Список браузеров → самая старая версия каждого.
function lowestVersions(browsers) {
  const targets = {};
  for (const line of browsers) {
    const [name, range] = line.split(' ');
    const env = ENV[name];
    if (!env || range === 'TP') continue;      // Safari Technology Preview не считается
    const version = range.split('-')[0];
    if (!targets[env] || older(version, targets[env])) targets[env] = version;
  }
  return targets;
}

// Шаг 2. Кто из целей мешает оставить конструкцию как есть:
// браузер старше версии из таблицы — или таблица о нём молчит.
function blockers(support, targets) {
  return Object.keys(targets).filter((env) => {
    const since = support[env] ?? (env === 'android' ? support.chrome : undefined);
    return since === undefined || older(targets[env], since);
  });
}

// Шаг 3. Включить всё, чему мешает хоть одна цель. Целей нет — включить всё.
function required(table, targets) {
  const none = Object.keys(targets).length === 0;
  return Object.keys(table).filter((name) => none || blockers(table[name], targets).length > 0);
}`;

export const DECIDE_NOTE =
  'Одна и та же функция работает с обеими таблицами: с `@babel/compat-data` она выбирает плагины синтаксиса, с `core-js-compat` — модули полифилов. Два правила в ней не очевидны. Пустая клетка таблицы значит «не умеет»: браузер, о котором таблица молчит, считается мешающим. А цели, которых не осталось вовсе, значат «перевести всё» — запрос `op_mini all` даёт Babel пустые цели, и он включает все 46 плагинов: на четыре больше, чем для IE 11.';

export const QUERY_NOTE =
  'В `defaults` нижнюю планку держат две старые версии: Chrome 109 — последняя, что выходила для Windows 7 (по документации Chrome), и Firefox 140 с длинной поддержкой (ESR). Даже Chrome 109 умеет весь синтаксис корзины, поэтому код не тронут, — а вот `Promise.withResolvers` появился в Chrome 119, и полифил для него нужен. Opera Mini, KaiOS, UC и QQ в списке есть, но Babel их не знает и решает так, будто их нет.';

export const DEBUG_CODE = `// babel.config.json
{
  "presets": [["@babel/preset-env", {
    "targets": "safari >= 13",
    "debug": true
  }]]
}`;

/** Начало вывода `debug` для `safari >= 13` — строки сверяются тестом с настоящим выводом. */
export const DEBUG_OUT = `Using targets:
{
  "safari": "13"
}

Using plugins:
  proposal-class-properties { safari < 14.1 }
  proposal-nullish-coalescing-operator { safari < 13.1 }
  proposal-optional-chaining { safari < 13.1 }
  transform-parameters { safari < 16.3 }
  transform-destructuring { safari < 14.1 }
  …`;

export const DEBUG_NOTE =
  'Опция `debug` печатает цели и каждый включённый плагин с причиной: `{ safari < 14.1 }` — «включён, потому что Safari 13 старше 14.1». Это та же пара «цель — версия из таблицы», которую возвращает `blockers`. Имена `proposal-…` — старые имена тех же плагинов `transform-…`: так их по традиции печатает `debug`.';

export const DEMO_CAPTION =
  'Решение «переписать», «дописать» или «оставить» считает `DECIDE_CODE` выше по двум таблицам — той же строкой, что напечатана на странице. Код после Babel и байты сняты стендом для каждого запроса; для своей цели Babel в браузере не запускается, поэтому показано только решение.';

// ─── Раздел 3. Во что превращается синтаксис ───────────────────────────────────────────────

export const SNIPPET_NOTE_ASYNC =
  '`_asyncToGenerator` — это и есть функция `spawn` из [«Генераторов»](/js/generators/#s2): генератор отдаёт промис через `yield`, обвязка ждёт его и продолжает. Если цель не умеет и генераторы, второй плагин переписывает генератор в конечный автомат — `switch` по номеру шага с обвязкой regenerator, и четыре строки весят уже 2 772 байта.';

export const SNIPPET_NOTE_PRIVATE =
  'Приватное поле становится записью в `WeakMap`, где ключ — сам объект. Снаружи до неё не добраться, как и до настоящего `#n`. Но каждое чтение теперь вызов функции с проверкой «этот ли это объект», а пять хелперов приезжают в начало файла.';

export const BUGFIX_NOTE =
  'Chrome 80 понимает `?.` — таблица Babel это знает. Но в V8 до Chrome 91 была ошибка в вызове `a?.(...args)`, и Babel 7 по умолчанию переписывает **всю** конструкцию из-за одного больного случая: в таблице у `transform-optional-chaining` стоит Chrome 91, а не 80. Опция `bugfixes: true` подключает вместо этого маленький плагин, который чинит только больной случай. В Babel 8 она включена по умолчанию (по документации). Тот же эффект у Safari: из-за ошибок в Safari до 16.3 Babel 7 переписывает остаточные параметры `...rest` — на `safari 14.1` корзина весит 470 байт вместо 393, а с `bugfixes` — снова 393.';

export const HELPERS_NOTE =
  'Хелперы вписываются в **каждый** файл, где понадобились: десять модулей с приватными полями — десять копий `_classPrivateFieldGet`. Плагин `@babel/plugin-transform-runtime` заменяет копии импортом из пакета `@babel/runtime`, и сборщик кладёт их один раз (по документации; в проекте этого пакета нет).';

// ─── Раздел 4. Полифилы и core-js ──────────────────────────────────────────────────────────

export const PLAIN_USAGE =
  'Как собрать аптечку в поездку. `usage` — смотрите, что вы будете делать, и берёте только нужное: идёте в горы — пластырь и бинт. `entry` — берёте всё, чего может не оказаться в стране, куда едете, независимо от планов. Первое легче, второе надёжнее, если планы поменяются, — например, если код, который пройдёт мимо Babel, тоже чего-то ждёт.';

export const USE_ROWS = [
  {
    k: '`false` (по умолчанию)',
    how: 'Полифилов не добавляет. Синтаксис переписан, `.at` и `structuredClone` остались как есть.',
  },
  {
    k: '`\'usage\'`',
    how: 'Смотрит, какие имена встречаются **в этом файле**, и для тех, которых нет у целей, вписывает в начало файла `import "core-js/modules/…"`.',
  },
  {
    k: '`\'entry\'`',
    how: 'Ищет в коде строку `import "core-js/stable"` и заменяет её импортами **всех** модулей, которых нет у целей, — используются они или нет.',
  },
];

/** Какие модули core-js добавил `usage` для одного вызова. Строки сняты стендом и сверяются тестом. */
export const API_ROWS = [
  {
    call: '`items.at(-1)`',
    modules: '`es.array.at`, `es.string.at-alternative`',
    why: 'Чем окажется `items`, Babel не знает: у строк тоже есть `.at`, и подключаются оба модуля. Для `[1, 2].at(-1)` — только `es.array.at`.',
  },
  {
    call: '`Promise.withResolvers()`',
    modules: '`es.promise.with-resolvers`; для IE 11 ещё `es.promise` и `es.object.to-string`',
    why: 'Метод опирается на сам `Promise`, а его в IE 11 нет: модуль тянет за собой зависимости.',
  },
  {
    call: '`structuredClone(x)`',
    modules: '`web.structured-clone`, `web.dom-exception.stack`; для IE 11 — девять модулей',
    why: 'Добавляется **для любой цели**, даже для последнего Chrome: в таблице core-js у `web.structured-clone` нет ни одной версии.',
  },
];

export const SC_CODE = `const native = structuredClone;
const err = new AggregateError([1], 'сбой', { cause: 3 });

const a = native(err);
console.log(a.name, a.errors);              // родной клон

await import('core-js/modules/web.structured-clone.js');
console.log(structuredClone === native);    // подменён ли

const b = structuredClone(err);
console.log(b.name, b.errors);              // клон полифила`;

/** Вывод `SC_CODE` в Node 24.11.0 (то же в Chromium 153). Тест запускает код в отдельном процессе. */
export const SC_OUT = `Error undefined
false
AggregateError [ 1 ]`;

export const SC_NOTE =
  'Родной `structuredClone` в V8 превращает `AggregateError` в обычный `Error` и теряет список `errors`. core-js проверяет, что клон сохраняет и тип, и `errors`, — по новым правилам клонирования ошибок из предложения к стандарту HTML (whatwg/html#5749). Проверку не проходят ни Chromium 153, ни Node 24 — и полифил **подменяет родную функцию** своей реализацией на JavaScript. В сборке это 30 246 байт (12 160 после gzip) ради одного вызова — и так для любой цели, даже для последнего Chrome. Если ошибки вы не клонируете, а байты дороги, модуль исключают опцией `exclude: ["web.structured-clone"]`.';

export const HELPER_POLYFILL_NOTE =
  'Полифилы нужны и коду, который вписал сам Babel. Для `safari >= 13` в списке `usage` девять модулей, хотя в корзине три встроенных вызова: `es.weak-map.get-or-insert` пришёл из-за `new WeakMap()` в переписанном приватном поле, `es.error.cause` — из-за `new TypeError(…)` в хелперах. Сначала Babel переписывает синтаксис, потом ищет имена уже в переписанном коде.';

export const COREJS_VERSION_CODE = `// corejs: '3' — Babel считает, что стоит core-js 3.0
{ "useBuiltIns": "usage", "corejs": "3" }      // safari >= 13: ни одного import

// корректно — версия до минорной
{ "useBuiltIns": "usage", "corejs": "3.50" }   // es.array.at, es.promise.with-resolvers, …`;

export const COREJS_VERSION_NOTE =
  '`.at`, `Promise.withResolvers` и `structuredClone` появились в core-js позже 3.0. С `corejs: "3"` Babel считает, что таких модулей в пакете нет, и **молча** не подключает ничего — хотя в `node_modules` лежит 3.50. Без `corejs` вовсе — предупреждение и core-js 2.';

// ─── Раздел 5. Чего не переписать и не дописать ────────────────────────────────────────────

export const CANT_ROWS = [
  {
    k: '`Proxy`',
    why: 'Прокси перехватывает **любую** операцию с объектом — чтение несуществующего ключа, `in`, `delete`. Старый движок не даёт коду встать между объектом и операцией, и изобразить это нечем. Подробнее — в [«Proxy и Reflect», раздел «Цена перехвата»](/js/proxy-reflect/#s8).',
    what: 'Babel и esbuild оставляют `new Proxy(…)` как есть, `usage` не добавляет ничего — без предупреждения.',
    tone: 'err' as const,
  },
  {
    k: '`WeakRef`, `FinalizationRegistry`',
    why: 'Им нужна связь со сборщиком мусора: «отпусти, если больше никто не держит» и «позови, когда собрал». Из JavaScript сборщик не виден.',
    what: 'То же: оставлены как есть, в core-js таких модулей нет.',
    tone: 'err' as const,
  },
  {
    k: 'просмотр назад в RegExp `(?<=…)`',
    why: 'Это работа движка регулярных выражений. Переписать шаблон с просмотром назад в шаблон без него в общем случае нельзя.',
    what: 'Babel оставляет литерал — в Safari до 16.4 весь файл не разберётся. esbuild переписывает литерал в `new RegExp("…")`: файл разберётся, а ошибка случится в момент вызова этой строки.',
    tone: 'warn' as const,
  },
  {
    k: '`BigInt` и `**`',
    why: 'Операторы над `BigInt` не перегрузить из JavaScript. А плагин степени переписывает `**` в `Math.pow`, который `BigInt` не принимает.',
    what: 'Для целей `ie 11, chrome 100` строка `10n ** 20n` становится `Math.pow(10n, 20n)` — и в Chrome 100 бросает `TypeError`, хотя исходник там работал.',
    tone: 'err' as const,
  },
];

export const LOOKBEHIND_CODE = `// исходник
const price = /(?<=\\$)\\d+/.exec(text);

// Babel, safari >= 13 — без изменений
const price = /(?<=\\$)\\d+/.exec(text);

// esbuild, target safari13 — литерал стал вызовом
const price = new RegExp("(?<=\\\\$)\\\\d+").exec(text);`;

export const BIGINT_CODE = `// исходник: работает везде, где есть BigInt
const big = 10n ** 20n;

// Babel, targets: "ie 11, chrome 100"
var big = Math.pow(10n, 20n);
// Chrome 100: TypeError — Math.pow не умеет BigInt`;

export const DIVERGE_ROWS = [
  {
    k: '`structuredClone` из core-js',
    how: 'Подменяет родную функцию и клонирует `AggregateError` иначе, чем движок: с `errors` вместо обычного `Error`. Один вызов даёт разный результат в зависимости от того, загружен ли полифил.',
    tone: 'warn' as const,
  },
  {
    k: 'переписанный `async`',
    how: 'После Babel для IE 11 `Object.prototype.toString.call(cart.total)` — `[object Function]`, а не `[object AsyncFunction]`, и `cart.total.constructor.name` — `Function`. Код, который отличает async-функции по этим признакам, после сборки отличать перестанет.',
    tone: 'err' as const,
  },
  {
    k: 'переписанное `#items`',
    how: 'Чтение чужим объектом бросает тот же `TypeError`, но с другим текстом: «Private element is not present on this object» вместо родного «Cannot read private member #items…». Тип ошибки — часть языка, текст — нет; на него нельзя опираться в обоих случаях.',
    tone: 'neutral' as const,
  },
  {
    k: 'полифил `Symbol`',
    how: 'Настоящий символ — новый примитив, а полифил может вернуть только объект. Поэтому `typeof` для полифила ответил бы `object`, и Babel переписывает каждый `typeof` через хелпер `_typeof` — он есть в выводе корзины для IE 11 (поведение полифила — по документации core-js).',
    tone: 'neutral' as const,
  },
];

export const DIVERGE_NOTE =
  'Остальное в корзине после перевода для IE 11 ведёт себя так же: тест стенда исполняет вывод Babel для трёх запросов и получает один и тот же `last`, ту же сумму и тот же снимок. Расхождения живут на краях — там, где код спрашивает о самой функции или о тексте ошибки.';

// ─── Раздел 6. esbuild и tsc: только синтаксис ─────────────────────────────────────────────

export const ESBUILD_CODE = `import { transform } from 'esbuild';

await transform(code, { target: 'es2017', minify: true });
await transform(code, { target: ['chrome109', 'safari15'], minify: true });`;

export const TOOL_NOTE =
  'esbuild и tsc переписывают только синтаксис. `.at(-1)`, `Promise.withResolvers` и `structuredClone` они оставляют как есть **и ничего об этом не говорят**: на `es2017` корзина собралась без единого предупреждения, а в Safari 13 упадёт на `.at`. Полифилы при таких инструментах подключают отдельно — руками или вторым шагом через Babel.';

export const TSC_NOTE =
  'TypeScript ведёт себя так же: `target` переписывает синтаксис, а `lib` меняет только то, какие функции **проверка типов** считает существующими, — в вывод полифилы не попадают. `target: "ES5"` в TypeScript 6.0 объявлен устаревшим: `transpileModule` возвращает ошибку с советом поставить `ignoreDeprecations: "6.0"`, а в TypeScript 7.0 он перестанет работать.';

export const ESBUILD_REFUSE_NOTE =
  'Различие в характере: Babel переписывает всё, для чего у него есть плагин, а esbuild **отказывается** собирать то, что не умеет переписать. На `es5` он перечисляет двенадцать мест — классы, `let`, `const`, `for…of`, `async` — и не выдаёт ничего. На `safari13` он отказал из-за деструктуризации: в его таблице она в Safari 13 считается неполной. Ошибка при сборке лучше, чем `SyntaxError` у пользователя.';

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: '`structuredClone` полифилится для любой цели',
    d: 'В таблице core-js у `web.structured-clone` нет ни одной версии браузера: родные реализации не проходят его проверки клонирования ошибок. С `usage` это 30 КБ в каждой сборке, где встретился вызов, — даже под последний Chrome. И полифил подменяет родную функцию. Если клонировать ошибки не нужно — `exclude`.',
    tone: 'warn',
  },
  {
    n: '02',
    t: '`corejs: "3"` молча выключает всё новое',
    d: 'Babel читает это как core-js 3.0 и не подключает модулей, которых в 3.0 не было: `.at`, `Promise.withResolvers`, `structuredClone`. Ни ошибки, ни предупреждения. Версию указывают до минорной — ту, что стоит в `package.json`.',
    tone: 'err',
  },
  {
    n: '03',
    t: 'Неизвестные браузеры выпадают из решения',
    d: 'Opera Mini, KaiOS, UC Browser и QQ есть в ответе browserslist на `defaults`, но в таблицах Babel их нет — и Babel их просто пропускает. А если неизвестны все браузеры запроса, целей не остаётся, и Babel переписывает всё — даже больше, чем для IE 11.',
    tone: 'warn',
  },
  {
    n: '04',
    t: 'Целую конструкцию переписывают из-за одной ошибки движка',
    d: 'Без `bugfixes: true` Babel 7 переписывает `?.` для Chrome 80–90 и `...rest` для Safari до 16.3, хотя синтаксис там есть: в таблице стоит версия, где исправлена ошибка, а не где появилась конструкция. `bugfixes` чинит только больной случай.',
  },
  {
    n: '05',
    t: 'Код переписан под старейшего, а исполняется у всех',
    d: 'Одна сборка на все цели: если в списке есть IE 11, Chrome 150 получает тот же пониженный код — медленнее и тяжелее. Иногда и неправильный: `10n ** 20n` после плагина степени — `Math.pow(10n, 20n)`, и в Chrome 100 это `TypeError`.',
    tone: 'err',
  },
  {
    n: '06',
    t: 'Чего нельзя сделать, о том не предупреждают',
    d: '`Proxy`, `WeakRef`, просмотр назад в регулярных выражениях Babel оставляет как есть, `usage` ничего не добавляет, esbuild на `es2017` тоже молчит. Узнать можно только запуском в самом старом браузере из списка — или запросом browserslist вида `safari >= 13 and not supports js-regexp-lookbehind`.',
    tone: 'err',
  },
  {
    n: '07',
    t: '`usage` видит только то, что прошло через Babel',
    d: 'Полифилы подбираются по файлу. Если сборка не пропускает через Babel `node_modules` — так настроены многие конфигурации, — зависимость, которая зовёт `.at`, полифила не получит. Это случай для `entry` или для явного импорта нужного модуля.',
    tone: 'warn',
  },
  {
    n: '08',
    t: 'Наивный полифил виден в `for…in`',
    d: '`Array.prototype.at = function …` создаёт перечисляемое свойство, и `for (const k in arr)` вдруг выдаёт `at`. Родные методы и core-js пишут свойство через `defineProperty` с `enumerable: false`.',
  },
  {
    n: '09',
    t: 'Хелперы — в каждом файле заново',
    d: 'Десять модулей с приватными полями — десять копий `_classPrivateFieldGet` в сборке. Для приложения это сотни байт, для библиотеки — повод подключить `@babel/plugin-transform-runtime`.',
  },
];

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'Babel — `@babel/preset-env`',
    href: 'https://babeljs.io/docs/babel-preset-env',
    what: '`targets`, `bugfixes`, `useBuiltIns`, `corejs`, `debug`, `exclude`; версия 7.29.7 на стенде',
  },
  {
    title: 'Babel — `@babel/compat-data` и `helper-compilation-targets`',
    href: 'https://github.com/babel/babel/tree/main/packages/babel-compat-data',
    what: 'таблица «плагин → версии», `plugin-bugfixes.json`; решение `isRequired`, с которым сверяется учебная функция',
  },
  {
    title: 'browserslist',
    href: 'https://github.com/browserslist/browserslist',
    what: 'язык запросов, `defaults`, `supports …`, `mobileToDesktop`; 4.28.9 на стенде',
  },
  {
    title: 'core-js',
    href: 'https://github.com/zloirock/core-js',
    what: 'модули, `core-js-compat`, `structuredClone` и что полифил не может',
  },
  {
    title: 'babel-polyfills — `usage-global`, `entry-global`, `usage-pure`',
    href: 'https://github.com/babel/babel-polyfills',
    what: 'как preset-env подбирает полифилы; `babel-plugin-polyfill-corejs3` 0.14.2 на стенде',
  },
  {
    title: 'HTML — structured clone и ошибки (whatwg/html#5749)',
    href: 'https://github.com/whatwg/html/pull/5749',
    what: 'новые правила клонирования ошибок, по которым core-js проверяет родную функцию',
  },
  {
    title: 'esbuild — `target`',
    href: 'https://esbuild.github.io/api/#target',
    what: 'цели по версиям браузеров и ES, отказ вместо молчаливого пропуска; 0.28.2 на стенде',
  },
  {
    title: 'TypeScript — `target` и `lib`',
    href: 'https://www.typescriptlang.org/tsconfig/#target',
    what: 'понижение синтаксиса без полифилов; 6.0.3 на стенде',
  },
];

export const RELATED =
  'Смежное на сайте: [Модули и сборка, раздел «Dev не равен prod»](/tooling/modules/#s6) — две сборки, современная и легаси, через `type="module"` и `nomodule`. [Бандлер изнутри](/tooling/bundler-internals/) — что сборщик делает с кодом после перевода. [Source maps изнутри, раздел «Цепочка сборщиков»](/tooling/source-maps/#s4) — почему шаг Babel должен передать карту дальше. [Генераторы, раздел «async/await из генератора»](/js/generators/#s2) — откуда берётся `_asyncToGenerator`. [Proxy и Reflect, раздел «Цена перехвата»](/js/proxy-reflect/#s8) — почему прокси не полифилится. [Компиляторы фреймворков, раздел «Где делается работа»](/frameworks/framework-compilers/#s1) — работа, перенесённая со страницы в сборку. [AST и линтеры](/tooling/ast-linters/) — само дерево, его обход и правила ESLint с автоисправлениями.';

// ─── Сгенерировано стендом ─────────────────────────────────────────────────────────────────
// Ниже — литералы, снятые скриптом стенда (вызовы — в шапке файла). Не править руками:
// тест пересобирает каждый и сравнивает как есть.

export const SOURCE_BYTES = {
  bytes: 572,
  min: 393,
  gzip: 271
};

/** Пять запросов демо. `code` — вывод preset-env как есть, остальное — байты и полифилы. */
export const PRESETS: TranspilePreset[] = [
  {
    id: "chrome-last",
    query: "last 2 chrome versions",
    browsers: [
      "chrome 151",
      "chrome 150"
    ],
    code: "export class Cart {\n  #items = [];\n  add(item, ...rest) {\n    this.#items = [...this.#items, item, ...rest];\n    return this;\n  }\n  get last() {\n    return this.#items.at(-1)?.title ?? 'пусто';\n  }\n  async total(fetchPrice) {\n    let sum = 0;\n    for (const item of this.#items) {\n      sum += await fetchPrice(item.id);\n    }\n    return {\n      ...this.snapshot(),\n      sum\n    };\n  }\n  snapshot() {\n    return structuredClone({\n      items: this.#items\n    });\n  }\n}\nexport function deferred() {\n  const {\n    promise,\n    resolve\n  } = Promise.withResolvers();\n  return {\n    promise,\n    resolve\n  };\n}",
    min: 393,
    gzip: 271,
    plugins: 0,
    usage: [
      "web.dom-exception.stack",
      "web.structured-clone"
    ],
    usageBytes: 30246,
    usageGzip: 12160,
    entry: 7,
    entryBytes: 41671,
    entryGzip: 16660
  },
  {
    id: "defaults",
    query: "defaults",
    browsers: [
      "and_chr 151",
      "and_chr 150",
      "and_ff 154",
      "and_ff 153",
      "and_qq 14.9",
      "and_uc 15.5",
      "android 151",
      "android 150",
      "chrome 151",
      "chrome 150",
      "chrome 149",
      "chrome 148",
      "chrome 145",
      "chrome 120",
      "chrome 109",
      "edge 151",
      "edge 150",
      "edge 149",
      "firefox 154",
      "firefox 153",
      "firefox 152",
      "firefox 140",
      "ios_saf 26.6",
      "ios_saf 26.5",
      "ios_saf 18.5-18.7",
      "kaios 3.0-3.1",
      "kaios 2.5",
      "op_mini all",
      "op_mob 80",
      "opera 131",
      "opera 127",
      "safari 26.6",
      "safari 26.5",
      "samsung 30",
      "samsung 29"
    ],
    code: "export class Cart {\n  #items = [];\n  add(item, ...rest) {\n    this.#items = [...this.#items, item, ...rest];\n    return this;\n  }\n  get last() {\n    return this.#items.at(-1)?.title ?? 'пусто';\n  }\n  async total(fetchPrice) {\n    let sum = 0;\n    for (const item of this.#items) {\n      sum += await fetchPrice(item.id);\n    }\n    return {\n      ...this.snapshot(),\n      sum\n    };\n  }\n  snapshot() {\n    return structuredClone({\n      items: this.#items\n    });\n  }\n}\nexport function deferred() {\n  const {\n    promise,\n    resolve\n  } = Promise.withResolvers();\n  return {\n    promise,\n    resolve\n  };\n}",
    min: 393,
    gzip: 271,
    plugins: 4,
    usage: [
      "es.promise.with-resolvers",
      "web.dom-exception.stack",
      "web.structured-clone"
    ],
    usageBytes: 30716,
    usageGzip: 12339,
    entry: 78,
    entryBytes: 98744,
    entryGzip: 38306
  },
  {
    id: "chrome-80",
    query: "chrome 80",
    browsers: [
      "chrome 80"
    ],
    code: "export class Cart {\n  #items = [];\n  add(item, ...rest) {\n    this.#items = [...this.#items, item, ...rest];\n    return this;\n  }\n  get last() {\n    var _this$items$at;\n    return ((_this$items$at = this.#items.at(-1)) === null || _this$items$at === void 0 ? void 0 : _this$items$at.title) ?? 'пусто';\n  }\n  async total(fetchPrice) {\n    let sum = 0;\n    for (const item of this.#items) {\n      sum += await fetchPrice(item.id);\n    }\n    return {\n      ...this.snapshot(),\n      sum\n    };\n  }\n  snapshot() {\n    return structuredClone({\n      items: this.#items\n    });\n  }\n}\nexport function deferred() {\n  const {\n    promise,\n    resolve\n  } = Promise.withResolvers();\n  return {\n    promise,\n    resolve\n  };\n}",
    min: 431,
    gzip: 297,
    plugins: 10,
    usage: [
      "es.array.at",
      "es.promise.with-resolvers",
      "es.string.at-alternative",
      "web.dom-exception.stack",
      "web.structured-clone"
    ],
    usageBytes: 32672,
    usageGzip: 13184,
    entry: 95,
    entryBytes: 109420,
    entryGzip: 42146
  },
  {
    id: "safari-13",
    query: "safari >= 13",
    browsers: [
      "safari 26.6",
      "safari 26.5",
      "safari 26.4",
      "safari 26.3",
      "safari 26.2",
      "safari 26.1",
      "safari 26.0",
      "safari 18.5-18.7",
      "safari 18.4",
      "safari 18.3",
      "safari 18.2",
      "safari 18.1",
      "safari 18.0",
      "safari 17.6",
      "safari 17.5",
      "safari 17.4",
      "safari 17.3",
      "safari 17.2",
      "safari 17.1",
      "safari 17.0",
      "safari 16.6",
      "safari 16.5",
      "safari 16.4",
      "safari 16.3",
      "safari 16.2",
      "safari 16.1",
      "safari 16.0",
      "safari 15.6",
      "safari 15.5",
      "safari 15.4",
      "safari 15.2-15.3",
      "safari 15.1",
      "safari 15",
      "safari 14.1",
      "safari 14",
      "safari 13.1",
      "safari 13"
    ],
    code: "function _classPrivateFieldInitSpec(e, t, a) { _checkPrivateRedeclaration(e, t), t.set(e, a); }\nfunction _checkPrivateRedeclaration(e, t) { if (t.has(e)) throw new TypeError(\"Cannot initialize the same private elements twice on an object\"); }\nfunction _classPrivateFieldGet(s, a) { return s.get(_assertClassBrand(s, a)); }\nfunction _classPrivateFieldSet(s, a, r) { return s.set(_assertClassBrand(s, a), r), r; }\nfunction _assertClassBrand(e, t, n) { if (\"function\" == typeof e ? e === t : e.has(t)) return arguments.length < 3 ? t : n; throw new TypeError(\"Private element is not present on this object\"); }\nvar _items = /*#__PURE__*/new WeakMap();\nexport class Cart {\n  constructor() {\n    _classPrivateFieldInitSpec(this, _items, []);\n  }\n  add(item) {\n    for (var _len = arguments.length, rest = new Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {\n      rest[_key - 1] = arguments[_key];\n    }\n    _classPrivateFieldSet(_items, this, [..._classPrivateFieldGet(_items, this), item, ...rest]);\n    return this;\n  }\n  get last() {\n    var _classPrivateFieldGet2, _classPrivateFieldGet3;\n    return (_classPrivateFieldGet2 = (_classPrivateFieldGet3 = _classPrivateFieldGet(_items, this).at(-1)) === null || _classPrivateFieldGet3 === void 0 ? void 0 : _classPrivateFieldGet3.title) !== null && _classPrivateFieldGet2 !== void 0 ? _classPrivateFieldGet2 : 'пусто';\n  }\n  async total(fetchPrice) {\n    let sum = 0;\n    for (const item of _classPrivateFieldGet(_items, this)) {\n      sum += await fetchPrice(item.id);\n    }\n    return {\n      ...this.snapshot(),\n      sum\n    };\n  }\n  snapshot() {\n    return structuredClone({\n      items: _classPrivateFieldGet(_items, this)\n    });\n  }\n}\nexport function deferred() {\n  const _Promise$withResolver = Promise.withResolvers(),\n    promise = _Promise$withResolver.promise,\n    resolve = _Promise$withResolver.resolve;\n  return {\n    promise,\n    resolve\n  };\n}",
    min: 972,
    gzip: 563,
    plugins: 14,
    usage: [
      "es.error.cause",
      "es.array.at",
      "es.promise.with-resolvers",
      "es.string.at-alternative",
      "es.weak-map.get-or-insert",
      "es.weak-map.get-or-insert-computed",
      "web.dom-collections.iterator",
      "web.dom-exception.stack",
      "web.structured-clone"
    ],
    usageBytes: 40442,
    usageGzip: 16021,
    entry: 113,
    entryBytes: 156417,
    entryGzip: 60562
  },
  {
    id: "ie-11",
    query: "ie 11",
    browsers: [
      "ie 11"
    ],
    code: "function _typeof(o) { \"@babel/helpers - typeof\"; return _typeof = \"function\" == typeof Symbol && \"symbol\" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && \"function\" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? \"symbol\" : typeof o; }, _typeof(o); }\nfunction _regenerator() { /*! regenerator-runtime -- Copyright (c) 2014-present, Facebook, Inc. -- license (MIT): https://github.com/babel/babel/blob/main/packages/babel-helpers/LICENSE */ var e, t, r = \"function\" == typeof Symbol ? Symbol : {}, n = r.iterator || \"@@iterator\", o = r.toStringTag || \"@@toStringTag\"; function i(r, n, o, i) { var c = n && n.prototype instanceof Generator ? n : Generator, u = Object.create(c.prototype); return _regeneratorDefine2(u, \"_invoke\", function (r, n, o) { var i, c, u, f = 0, p = o || [], y = !1, G = { p: 0, n: 0, v: e, a: d, f: d.bind(e, 4), d: function d(t, r) { return i = t, c = 0, u = e, G.n = r, a; } }; function d(r, n) { for (c = r, u = n, t = 0; !y && f && !o && t < p.length; t++) { var o, i = p[t], d = G.p, l = i[2]; r > 3 ? (o = l === n) && (u = i[(c = i[4]) ? 5 : (c = 3, 3)], i[4] = i[5] = e) : i[0] <= d && ((o = r < 2 && d < i[1]) ? (c = 0, G.v = n, G.n = i[1]) : d < l && (o = r < 3 || i[0] > n || n > l) && (i[4] = r, i[5] = n, G.n = l, c = 0)); } if (o || r > 1) return a; throw y = !0, n; } return function (o, p, l) { if (f > 1) throw TypeError(\"Generator is already running\"); for (y && 1 === p && d(p, l), c = p, u = l; (t = c < 2 ? e : u) || !y;) { i || (c ? c < 3 ? (c > 1 && (G.n = -1), d(c, u)) : G.n = u : G.v = u); try { if (f = 2, i) { if (c || (o = \"next\"), t = i[o]) { if (!(t = t.call(i, u))) throw TypeError(\"iterator result is not an object\"); if (!t.done) return t; u = t.value, c < 2 && (c = 0); } else 1 === c && (t = i.return) && t.call(i), c < 2 && (u = TypeError(\"The iterator does not provide a '\" + o + \"' method\"), c = 1); i = e; } else if ((t = (y = G.n < 0) ? u : r.call(n, G)) !== a) break; } catch (t) { i = e, c = 1, u = t; } finally { f = 1; } } return { value: t, done: y }; }; }(r, o, i), !0), u; } var a = {}; function Generator() {} function GeneratorFunction() {} function GeneratorFunctionPrototype() {} t = Object.getPrototypeOf; var c = [][n] ? t(t([][n]())) : (_regeneratorDefine2(t = {}, n, function () { return this; }), t), u = GeneratorFunctionPrototype.prototype = Generator.prototype = Object.create(c); function f(e) { return Object.setPrototypeOf ? Object.setPrototypeOf(e, GeneratorFunctionPrototype) : (e.__proto__ = GeneratorFunctionPrototype, _regeneratorDefine2(e, o, \"GeneratorFunction\")), e.prototype = Object.create(u), e; } return GeneratorFunction.prototype = GeneratorFunctionPrototype, _regeneratorDefine2(u, \"constructor\", GeneratorFunctionPrototype), _regeneratorDefine2(GeneratorFunctionPrototype, \"constructor\", GeneratorFunction), GeneratorFunction.displayName = \"GeneratorFunction\", _regeneratorDefine2(GeneratorFunctionPrototype, o, \"GeneratorFunction\"), _regeneratorDefine2(u), _regeneratorDefine2(u, o, \"Generator\"), _regeneratorDefine2(u, n, function () { return this; }), _regeneratorDefine2(u, \"toString\", function () { return \"[object Generator]\"; }), (_regenerator = function _regenerator() { return { w: i, m: f }; })(); }\nfunction _regeneratorDefine2(e, r, n, t) { var i = Object.defineProperty; try { i({}, \"\", {}); } catch (e) { i = 0; } _regeneratorDefine2 = function _regeneratorDefine(e, r, n, t) { function o(r, n) { _regeneratorDefine2(e, r, function (e) { return this._invoke(r, n, e); }); } r ? i ? i(e, r, { value: n, enumerable: !t, configurable: !t, writable: !t }) : e[r] = n : (o(\"next\", 0), o(\"throw\", 1), o(\"return\", 2)); }, _regeneratorDefine2(e, r, n, t); }\nfunction ownKeys(e, r) { var t = Object.keys(e); if (Object.getOwnPropertySymbols) { var o = Object.getOwnPropertySymbols(e); r && (o = o.filter(function (r) { return Object.getOwnPropertyDescriptor(e, r).enumerable; })), t.push.apply(t, o); } return t; }\nfunction _objectSpread(e) { for (var r = 1; r < arguments.length; r++) { var t = null != arguments[r] ? arguments[r] : {}; r % 2 ? ownKeys(Object(t), !0).forEach(function (r) { _defineProperty(e, r, t[r]); }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function (r) { Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r)); }); } return e; }\nfunction _defineProperty(e, r, t) { return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: !0, configurable: !0, writable: !0 }) : e[r] = t, e; }\nfunction _createForOfIteratorHelper(r, e) { var t = \"undefined\" != typeof Symbol && r[Symbol.iterator] || r[\"@@iterator\"]; if (!t) { if (Array.isArray(r) || (t = _unsupportedIterableToArray(r)) || e && r && \"number\" == typeof r.length) { t && (r = t); var _n = 0, F = function F() {}; return { s: F, n: function n() { return _n >= r.length ? { done: !0 } : { done: !1, value: r[_n++] }; }, e: function e(r) { throw r; }, f: F }; } throw new TypeError(\"Invalid attempt to iterate non-iterable instance.\\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.\"); } var o, a = !0, u = !1; return { s: function s() { t = t.call(r); }, n: function n() { var r = t.next(); return a = r.done, r; }, e: function e(r) { u = !0, o = r; }, f: function f() { try { a || null == t.return || t.return(); } finally { if (u) throw o; } } }; }\nfunction asyncGeneratorStep(n, t, e, r, o, a, c) { try { var i = n[a](c), u = i.value; } catch (n) { return void e(n); } i.done ? t(u) : Promise.resolve(u).then(r, o); }\nfunction _asyncToGenerator(n) { return function () { var t = this, e = arguments; return new Promise(function (r, o) { var a = n.apply(t, e); function _next(n) { asyncGeneratorStep(a, r, o, _next, _throw, \"next\", n); } function _throw(n) { asyncGeneratorStep(a, r, o, _next, _throw, \"throw\", n); } _next(void 0); }); }; }\nfunction _toConsumableArray(r) { return _arrayWithoutHoles(r) || _iterableToArray(r) || _unsupportedIterableToArray(r) || _nonIterableSpread(); }\nfunction _nonIterableSpread() { throw new TypeError(\"Invalid attempt to spread non-iterable instance.\\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.\"); }\nfunction _unsupportedIterableToArray(r, a) { if (r) { if (\"string\" == typeof r) return _arrayLikeToArray(r, a); var t = {}.toString.call(r).slice(8, -1); return \"Object\" === t && r.constructor && (t = r.constructor.name), \"Map\" === t || \"Set\" === t ? Array.from(r) : \"Arguments\" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0; } }\nfunction _iterableToArray(r) { if (\"undefined\" != typeof Symbol && null != r[Symbol.iterator] || null != r[\"@@iterator\"]) return Array.from(r); }\nfunction _arrayWithoutHoles(r) { if (Array.isArray(r)) return _arrayLikeToArray(r); }\nfunction _arrayLikeToArray(r, a) { (null == a || a > r.length) && (a = r.length); for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e]; return n; }\nfunction _classCallCheck(a, n) { if (!(a instanceof n)) throw new TypeError(\"Cannot call a class as a function\"); }\nfunction _defineProperties(e, r) { for (var t = 0; t < r.length; t++) { var o = r[t]; o.enumerable = o.enumerable || !1, o.configurable = !0, \"value\" in o && (o.writable = !0), Object.defineProperty(e, _toPropertyKey(o.key), o); } }\nfunction _createClass(e, r, t) { return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, \"prototype\", { writable: !1 }), e; }\nfunction _toPropertyKey(t) { var i = _toPrimitive(t, \"string\"); return \"symbol\" == _typeof(i) ? i : i + \"\"; }\nfunction _toPrimitive(t, r) { if (\"object\" != _typeof(t) || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || \"default\"); if (\"object\" != _typeof(i)) return i; throw new TypeError(\"@@toPrimitive must return a primitive value.\"); } return (\"string\" === r ? String : Number)(t); }\nfunction _classPrivateFieldInitSpec(e, t, a) { _checkPrivateRedeclaration(e, t), t.set(e, a); }\nfunction _checkPrivateRedeclaration(e, t) { if (t.has(e)) throw new TypeError(\"Cannot initialize the same private elements twice on an object\"); }\nfunction _classPrivateFieldGet(s, a) { return s.get(_assertClassBrand(s, a)); }\nfunction _classPrivateFieldSet(s, a, r) { return s.set(_assertClassBrand(s, a), r), r; }\nfunction _assertClassBrand(e, t, n) { if (\"function\" == typeof e ? e === t : e.has(t)) return arguments.length < 3 ? t : n; throw new TypeError(\"Private element is not present on this object\"); }\nvar _items = /*#__PURE__*/new WeakMap();\nexport var Cart = /*#__PURE__*/function () {\n  function Cart() {\n    _classCallCheck(this, Cart);\n    _classPrivateFieldInitSpec(this, _items, []);\n  }\n  return _createClass(Cart, [{\n    key: \"add\",\n    value: function add(item) {\n      for (var _len = arguments.length, rest = new Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {\n        rest[_key - 1] = arguments[_key];\n      }\n      _classPrivateFieldSet(_items, this, [].concat(_toConsumableArray(_classPrivateFieldGet(_items, this)), [item], rest));\n      return this;\n    }\n  }, {\n    key: \"last\",\n    get: function get() {\n      var _classPrivateFieldGet2, _classPrivateFieldGet3;\n      return (_classPrivateFieldGet2 = (_classPrivateFieldGet3 = _classPrivateFieldGet(_items, this).at(-1)) === null || _classPrivateFieldGet3 === void 0 ? void 0 : _classPrivateFieldGet3.title) !== null && _classPrivateFieldGet2 !== void 0 ? _classPrivateFieldGet2 : 'пусто';\n    }\n  }, {\n    key: \"total\",\n    value: function () {\n      var _total = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee(fetchPrice) {\n        var sum, _iterator, _step, item, _t, _t2;\n        return _regenerator().w(function (_context) {\n          while (1) switch (_context.p = _context.n) {\n            case 0:\n              sum = 0;\n              _iterator = _createForOfIteratorHelper(_classPrivateFieldGet(_items, this));\n              _context.p = 1;\n              _iterator.s();\n            case 2:\n              if ((_step = _iterator.n()).done) {\n                _context.n = 5;\n                break;\n              }\n              item = _step.value;\n              _t = sum;\n              _context.n = 3;\n              return fetchPrice(item.id);\n            case 3:\n              sum = _t += _context.v;\n            case 4:\n              _context.n = 2;\n              break;\n            case 5:\n              _context.n = 7;\n              break;\n            case 6:\n              _context.p = 6;\n              _t2 = _context.v;\n              _iterator.e(_t2);\n            case 7:\n              _context.p = 7;\n              _iterator.f();\n              return _context.f(7);\n            case 8:\n              return _context.a(2, _objectSpread(_objectSpread({}, this.snapshot()), {}, {\n                sum: sum\n              }));\n          }\n        }, _callee, this, [[1, 6, 7, 8]]);\n      }));\n      function total(_x) {\n        return _total.apply(this, arguments);\n      }\n      return total;\n    }()\n  }, {\n    key: \"snapshot\",\n    value: function snapshot() {\n      return structuredClone({\n        items: _classPrivateFieldGet(_items, this)\n      });\n    }\n  }]);\n}();\nexport function deferred() {\n  var _Promise$withResolver = Promise.withResolvers(),\n    promise = _Promise$withResolver.promise,\n    resolve = _Promise$withResolver.resolve;\n  return {\n    promise: promise,\n    resolve: resolve\n  };\n}",
    min: 7016,
    gzip: 3068,
    plugins: 42,
    usage: [
      "es.symbol",
      "es.symbol.description",
      "es.symbol.iterator",
      "es.symbol.to-primitive",
      "es.error.cause",
      "es.array.at",
      "es.array.concat",
      "es.array.filter",
      "es.array.from",
      "es.array.iterator",
      "es.array.push",
      "es.array.slice",
      "es.date.to-primitive",
      "es.function.name",
      "es.iterator.constructor",
      "es.iterator.filter",
      "es.iterator.for-each",
      "es.map",
      "es.number.constructor",
      "es.object.get-own-property-descriptor",
      "es.object.get-own-property-descriptors",
      "es.object.get-prototype-of",
      "es.object.keys",
      "es.object.to-string",
      "es.promise",
      "es.promise.with-resolvers",
      "es.regexp.exec",
      "es.regexp.test",
      "es.regexp.to-string",
      "es.set",
      "es.string.at-alternative",
      "es.string.iterator",
      "es.weak-map",
      "es.weak-map.get-or-insert",
      "es.weak-map.get-or-insert-computed",
      "web.dom-collections.for-each",
      "web.dom-collections.iterator",
      "web.dom-exception.constructor",
      "web.dom-exception.stack",
      "web.dom-exception.to-string-tag",
      "web.structured-clone"
    ],
    usageBytes: 85635,
    usageGzip: 34329,
    entry: 284,
    entryBytes: 229304,
    entryGzip: 87338
  }
];

/** Строки `@babel/compat-data/plugins` для конструкций корзины — только окружения, которые знает Babel. */
export const COMPAT: CompatTable = {
  "transform-classes": {
    chrome: "46",
    edge: "13",
    firefox: "45",
    safari: "10",
    ios: "10",
    opera: "33",
    opera_mobile: "33",
    samsung: "5",
    node: "5"
  },
  "transform-block-scoping": {
    chrome: "50",
    edge: "14",
    firefox: "53",
    safari: "11",
    ios: "11",
    opera: "37",
    opera_mobile: "37",
    samsung: "5",
    node: "6"
  },
  "transform-class-properties": {
    chrome: "74",
    edge: "79",
    firefox: "90",
    safari: "14.1",
    ios: "14.5",
    opera: "62",
    opera_mobile: "53",
    samsung: "11",
    node: "12"
  },
  "transform-parameters": {
    chrome: "49",
    edge: "18",
    firefox: "52",
    safari: "16.3",
    ios: "16.3",
    opera: "36",
    opera_mobile: "36",
    samsung: "5",
    node: "6"
  },
  "transform-spread": {
    chrome: "46",
    edge: "13",
    firefox: "45",
    safari: "10",
    ios: "10",
    opera: "33",
    opera_mobile: "33",
    samsung: "5",
    node: "5"
  },
  "transform-for-of": {
    chrome: "51",
    edge: "15",
    firefox: "53",
    safari: "10",
    ios: "10",
    opera: "38",
    opera_mobile: "41",
    samsung: "5",
    node: "6.5"
  },
  "transform-async-to-generator": {
    chrome: "55",
    edge: "15",
    firefox: "52",
    safari: "11",
    ios: "11",
    opera: "42",
    opera_mobile: "42",
    samsung: "6",
    node: "7.6"
  },
  "transform-regenerator": {
    chrome: "50",
    edge: "13",
    firefox: "53",
    safari: "10",
    ios: "10",
    opera: "37",
    opera_mobile: "37",
    samsung: "5",
    node: "6"
  },
  "transform-optional-chaining": {
    chrome: "91",
    edge: "91",
    firefox: "74",
    safari: "13.1",
    ios: "13.4",
    opera: "77",
    opera_mobile: "64",
    samsung: "16",
    node: "16.9"
  },
  "transform-nullish-coalescing-operator": {
    chrome: "80",
    edge: "80",
    firefox: "72",
    safari: "13.1",
    ios: "13.4",
    opera: "67",
    opera_mobile: "57",
    samsung: "13",
    node: "14"
  },
  "transform-object-rest-spread": {
    chrome: "60",
    edge: "79",
    firefox: "55",
    safari: "11.1",
    ios: "11.3",
    opera: "47",
    opera_mobile: "44",
    samsung: "8",
    node: "8.3"
  },
  "transform-destructuring": {
    chrome: "51",
    edge: "15",
    firefox: "53",
    safari: "14.1",
    ios: "14.5",
    opera: "38",
    opera_mobile: "41",
    samsung: "5",
    node: "6.5"
  }
};

/** Строки `core-js-compat/data.json` для встроенных вызовов корзины — те же окружения. */
export const CORE_COMPAT: CompatTable = {
  "es.array.at": {
    chrome: "92",
    android: "92",
    edge: "92",
    firefox: "90",
    safari: "15.4",
    ios: "15.4",
    opera: "78",
    opera_mobile: "65",
    samsung: "16.0",
    node: "16.6"
  },
  "es.string.at-alternative": {
    chrome: "92",
    android: "92",
    edge: "92",
    firefox: "90",
    safari: "15.4",
    ios: "15.4",
    opera: "78",
    opera_mobile: "65",
    samsung: "16.0",
    node: "16.6"
  },
  "es.promise.with-resolvers": {
    chrome: "119",
    android: "119",
    edge: "119",
    firefox: "121",
    safari: "17.4",
    ios: "17.4",
    opera: "105",
    opera_mobile: "79",
    samsung: "25.0",
    node: "22.0"
  },
  "web.structured-clone": {},
  "web.dom-exception.stack": {
    firefox: "37",
    node: "17.0"
  }
};

/** Конструкция в одиночку: Babel с одним плагином; байты — после минификации esbuild. */
export const SNIPPETS = {
  optional: {
    code: "const title = cart?.items?.at(-1)?.title;",
    plugins: [
      "transform-optional-chaining"
    ],
    out: "var _cart;\nconst title = (_cart = cart) === null || _cart === void 0 || (_cart = _cart.items) === null || _cart === void 0 || (_cart = _cart.at(-1)) === null || _cart === void 0 ? void 0 : _cart.title;",
    before: 36,
    after: 123
  },
  nullish: {
    code: "const label = title ?? 'пусто';",
    plugins: [
      "transform-nullish-coalescing-operator"
    ],
    out: "var _title;\nconst label = (_title = title) !== null && _title !== void 0 ? _title : 'пусто';",
    before: 29,
    after: 59
  },
  private: {
    code: "class Counter {\n  #n = 0;\n  inc() { return ++this.#n; }\n}",
    plugins: [
      "transform-class-properties"
    ],
    out: "function _classPrivateFieldInitSpec(e, t, a) { _checkPrivateRedeclaration(e, t), t.set(e, a); }\nfunction _checkPrivateRedeclaration(e, t) { if (t.has(e)) throw new TypeError(\"Cannot initialize the same private elements twice on an object\"); }\nfunction _classPrivateFieldSet(s, a, r) { return s.set(_assertClassBrand(s, a), r), r; }\nfunction _classPrivateFieldGet(s, a) { return s.get(_assertClassBrand(s, a)); }\nfunction _assertClassBrand(e, t, n) { if (\"function\" == typeof e ? e === t : e.has(t)) return arguments.length < 3 ? t : n; throw new TypeError(\"Private element is not present on this object\"); }\nvar _n = /*#__PURE__*/new WeakMap();\nclass Counter {\n  constructor() {\n    _classPrivateFieldInitSpec(this, _n, 0);\n  }\n  inc() {\n    var _this$n;\n    return _classPrivateFieldSet(_n, this, (_this$n = _classPrivateFieldGet(_n, this), ++_this$n));\n  }\n}",
    before: 37,
    after: 487
  },
  async: {
    code: "async function load(id) {\n  const res = await fetch(`/api/${id}`);\n  return res.json();\n}",
    plugins: [
      "transform-async-to-generator"
    ],
    out: "function asyncGeneratorStep(n, t, e, r, o, a, c) { try { var i = n[a](c), u = i.value; } catch (n) { return void e(n); } i.done ? t(u) : Promise.resolve(u).then(r, o); }\nfunction _asyncToGenerator(n) { return function () { var t = this, e = arguments; return new Promise(function (r, o) { var a = n.apply(t, e); function _next(n) { asyncGeneratorStep(a, r, o, _next, _throw, \"next\", n); } function _throw(n) { asyncGeneratorStep(a, r, o, _next, _throw, \"throw\", n); } _next(void 0); }); }; }\nfunction load(_x) {\n  return _load.apply(this, arguments);\n}\nfunction _load() {\n  _load = _asyncToGenerator(function* (id) {\n    const res = yield fetch(`/api/${id}`);\n    return res.json();\n  });\n  return _load.apply(this, arguments);\n}",
    before: 61,
    after: 463
  },
  asyncEs5: {
    code: "async function load(id) {\n  const res = await fetch(`/api/${id}`);\n  return res.json();\n}",
    plugins: [
      "transform-async-to-generator",
      "transform-regenerator"
    ],
    out: "function _regenerator() { /*! regenerator-runtime -- Copyright (c) 2014-present, Facebook, Inc. -- license (MIT): https://github.com/babel/babel/blob/main/packages/babel-helpers/LICENSE */ var e, t, r = \"function\" == typeof Symbol ? Symbol : {}, n = r.iterator || \"@@iterator\", o = r.toStringTag || \"@@toStringTag\"; function i(r, n, o, i) { var c = n && n.prototype instanceof Generator ? n : Generator, u = Object.create(c.prototype); return _regeneratorDefine(u, \"_invoke\", function (r, n, o) { var i, c, u, f = 0, p = o || [], y = !1, G = { p: 0, n: 0, v: e, a: d, f: d.bind(e, 4), d: function (t, r) { return i = t, c = 0, u = e, G.n = r, a; } }; function d(r, n) { for (c = r, u = n, t = 0; !y && f && !o && t < p.length; t++) { var o, i = p[t], d = G.p, l = i[2]; r > 3 ? (o = l === n) && (u = i[(c = i[4]) ? 5 : (c = 3, 3)], i[4] = i[5] = e) : i[0] <= d && ((o = r < 2 && d < i[1]) ? (c = 0, G.v = n, G.n = i[1]) : d < l && (o = r < 3 || i[0] > n || n > l) && (i[4] = r, i[5] = n, G.n = l, c = 0)); } if (o || r > 1) return a; throw y = !0, n; } return function (o, p, l) { if (f > 1) throw TypeError(\"Generator is already running\"); for (y && 1 === p && d(p, l), c = p, u = l; (t = c < 2 ? e : u) || !y;) { i || (c ? c < 3 ? (c > 1 && (G.n = -1), d(c, u)) : G.n = u : G.v = u); try { if (f = 2, i) { if (c || (o = \"next\"), t = i[o]) { if (!(t = t.call(i, u))) throw TypeError(\"iterator result is not an object\"); if (!t.done) return t; u = t.value, c < 2 && (c = 0); } else 1 === c && (t = i.return) && t.call(i), c < 2 && (u = TypeError(\"The iterator does not provide a '\" + o + \"' method\"), c = 1); i = e; } else if ((t = (y = G.n < 0) ? u : r.call(n, G)) !== a) break; } catch (t) { i = e, c = 1, u = t; } finally { f = 1; } } return { value: t, done: y }; }; }(r, o, i), !0), u; } var a = {}; function Generator() {} function GeneratorFunction() {} function GeneratorFunctionPrototype() {} t = Object.getPrototypeOf; var c = [][n] ? t(t([][n]())) : (_regeneratorDefine(t = {}, n, function () { return this; }), t), u = GeneratorFunctionPrototype.prototype = Generator.prototype = Object.create(c); function f(e) { return Object.setPrototypeOf ? Object.setPrototypeOf(e, GeneratorFunctionPrototype) : (e.__proto__ = GeneratorFunctionPrototype, _regeneratorDefine(e, o, \"GeneratorFunction\")), e.prototype = Object.create(u), e; } return GeneratorFunction.prototype = GeneratorFunctionPrototype, _regeneratorDefine(u, \"constructor\", GeneratorFunctionPrototype), _regeneratorDefine(GeneratorFunctionPrototype, \"constructor\", GeneratorFunction), GeneratorFunction.displayName = \"GeneratorFunction\", _regeneratorDefine(GeneratorFunctionPrototype, o, \"GeneratorFunction\"), _regeneratorDefine(u), _regeneratorDefine(u, o, \"Generator\"), _regeneratorDefine(u, n, function () { return this; }), _regeneratorDefine(u, \"toString\", function () { return \"[object Generator]\"; }), (_regenerator = function () { return { w: i, m: f }; })(); }\nfunction _regeneratorDefine(e, r, n, t) { var i = Object.defineProperty; try { i({}, \"\", {}); } catch (e) { i = 0; } _regeneratorDefine = function (e, r, n, t) { function o(r, n) { _regeneratorDefine(e, r, function (e) { return this._invoke(r, n, e); }); } r ? i ? i(e, r, { value: n, enumerable: !t, configurable: !t, writable: !t }) : e[r] = n : (o(\"next\", 0), o(\"throw\", 1), o(\"return\", 2)); }, _regeneratorDefine(e, r, n, t); }\nfunction asyncGeneratorStep(n, t, e, r, o, a, c) { try { var i = n[a](c), u = i.value; } catch (n) { return void e(n); } i.done ? t(u) : Promise.resolve(u).then(r, o); }\nfunction _asyncToGenerator(n) { return function () { var t = this, e = arguments; return new Promise(function (r, o) { var a = n.apply(t, e); function _next(n) { asyncGeneratorStep(a, r, o, _next, _throw, \"next\", n); } function _throw(n) { asyncGeneratorStep(a, r, o, _next, _throw, \"throw\", n); } _next(void 0); }); }; }\nfunction load(_x) {\n  return _load.apply(this, arguments);\n}\nfunction _load() {\n  _load = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee(id) {\n    var res;\n    return _regenerator().w(function (_context) {\n      while (1) switch (_context.n) {\n        case 0:\n          _context.n = 1;\n          return fetch(`/api/${id}`);\n        case 1:\n          res = _context.v;\n          return _context.a(2, res.json());\n      }\n    }, _callee);\n  }));\n  return _load.apply(this, arguments);\n}",
    before: 61,
    after: 2772
  },
  spread: {
    code: "const all = [...a, ...b];",
    plugins: [
      "transform-spread"
    ],
    out: "function _toConsumableArray(r) { return _arrayWithoutHoles(r) || _iterableToArray(r) || _unsupportedIterableToArray(r) || _nonIterableSpread(); }\nfunction _nonIterableSpread() { throw new TypeError(\"Invalid attempt to spread non-iterable instance.\\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.\"); }\nfunction _unsupportedIterableToArray(r, a) { if (r) { if (\"string\" == typeof r) return _arrayLikeToArray(r, a); var t = {}.toString.call(r).slice(8, -1); return \"Object\" === t && r.constructor && (t = r.constructor.name), \"Map\" === t || \"Set\" === t ? Array.from(r) : \"Arguments\" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0; } }\nfunction _iterableToArray(r) { if (\"undefined\" != typeof Symbol && null != r[Symbol.iterator] || null != r[\"@@iterator\"]) return Array.from(r); }\nfunction _arrayWithoutHoles(r) { if (Array.isArray(r)) return _arrayLikeToArray(r); }\nfunction _arrayLikeToArray(r, a) { (null == a || a > r.length) && (a = r.length); for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e]; return n; }\nconst all = [].concat(_toConsumableArray(a), _toConsumableArray(b));",
    before: 21,
    after: 767
  },
  objectSpread: {
    code: "const next = { ...prev, done: true };",
    plugins: [
      "transform-object-rest-spread"
    ],
    out: "function ownKeys(e, r) { var t = Object.keys(e); if (Object.getOwnPropertySymbols) { var o = Object.getOwnPropertySymbols(e); r && (o = o.filter(function (r) { return Object.getOwnPropertyDescriptor(e, r).enumerable; })), t.push.apply(t, o); } return t; }\nfunction _objectSpread(e) { for (var r = 1; r < arguments.length; r++) { var t = null != arguments[r] ? arguments[r] : {}; r % 2 ? ownKeys(Object(t), !0).forEach(function (r) { _defineProperty(e, r, t[r]); }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function (r) { Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r)); }); } return e; }\nfunction _defineProperty(e, r, t) { return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: !0, configurable: !0, writable: !0 }) : e[r] = t, e; }\nfunction _toPropertyKey(t) { var i = _toPrimitive(t, \"string\"); return \"symbol\" == typeof i ? i : i + \"\"; }\nfunction _toPrimitive(t, r) { if (\"object\" != typeof t || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || \"default\"); if (\"object\" != typeof i) return i; throw new TypeError(\"@@toPrimitive must return a primitive value.\"); } return (\"string\" === r ? String : Number)(t); }\nconst next = _objectSpread(_objectSpread({}, prev), {}, {\n  done: true\n});",
    before: 27,
    after: 1057
  }
};

/** esbuild `transform(SAMPLE_CODE, { target, minify: true })`: байты или число ошибок. */
export const ESBUILD: Record<string, { bytes?: number; errors?: number }> = {
  chrome109: {
    bytes: 393
  },
  "safari14.1": {
    bytes: 393
  },
  safari13: {
    errors: 1
  },
  es2017: {
    bytes: 1247
  },
  es2015: {
    bytes: 1479
  },
  es5: {
    errors: 12
  }
};

/** tsc `transpileModule` с `module: ESNext`, затем минификация esbuild. */
export const TSC = {
  ES2022: 393,
  ES2017: 1221,
  ES2015: 1561
};

/** Babel на `safari 14.1`: байты после минификации без `bugfixes` и с ним. */
export const BABEL_SAFARI_141 = 470;
export const BABEL_SAFARI_141_BUGFIXES = 393;

/** `?.` на `chrome 80` без `bugfixes` и с ним. */
export const BUGFIX = {
  source: "const a = o?.x ?? 1;",
  plain: "var _o;\nconst a = ((_o = o) === null || _o === void 0 ? void 0 : _o.x) ?? 1;",
  bugfixes: "const a = o?.x ?? 1;"
};

// ─── Демо и таблицы, собранные из литералов стенда ─────────────────────────────────────────

/** Строки таблицы решений: конструкции сквозного примера и то, что за каждую отвечает. */
export const FEATURES: FeatureRow[] = [
  { code: 'class Cart', kind: 'syntax', item: 'transform-classes' },
  { code: '#items = []', kind: 'syntax', item: 'transform-class-properties' },
  { code: 'add(item, ...rest)', kind: 'syntax', item: 'transform-parameters' },
  { code: '[...this.#items, item]', kind: 'syntax', item: 'transform-spread' },
  { code: '?.title', kind: 'syntax', item: 'transform-optional-chaining' },
  { code: "?? 'пусто'", kind: 'syntax', item: 'transform-nullish-coalescing-operator' },
  { code: 'async / await', kind: 'syntax', item: 'transform-async-to-generator' },
  { code: 'генератор из async', kind: 'syntax', item: 'transform-regenerator' },
  { code: 'for (const item of …)', kind: 'syntax', item: 'transform-for-of' },
  { code: 'let sum, const', kind: 'syntax', item: 'transform-block-scoping' },
  { code: '{ ...this.snapshot(), sum }', kind: 'syntax', item: 'transform-object-rest-spread' },
  { code: 'const { promise, resolve } =', kind: 'syntax', item: 'transform-destructuring' },
  { code: '.at(-1) у массива', kind: 'api', item: 'es.array.at' },
  { code: '.at(-1) у строки', kind: 'api', item: 'es.string.at-alternative' },
  { code: 'Promise.withResolvers()', kind: 'api', item: 'es.promise.with-resolvers' },
  { code: 'structuredClone()', kind: 'api', item: 'web.structured-clone' },
  { code: 'structuredClone() — стек', kind: 'api', item: 'web.dom-exception.stack' },
];

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => String(from + i));

export const CUSTOM: CustomRange[] = [
  { name: 'chrome', label: 'Chrome', versions: range(49, 151) },
  { name: 'firefox', label: 'Firefox', versions: range(52, 154) },
  {
    name: 'safari',
    label: 'Safari',
    versions: ['10', '10.1', '11', '11.1', '12', '12.1', '13', '13.1', '14', '14.1', '15', '15.4', '16', '16.3', '16.4', '17', '17.4', '18', '26'],
  },
];

const fmt = (n: number) => n.toLocaleString('ru-RU').replace(/\s/g, ' ');
const times = (n: number) => `×${(n / SOURCE_BYTES.min).toFixed(1).replace('.', ',')}`;

/** Таблица «запрос → цена»: одна строка на запрос из демо. */
export const QUERY_ROWS = PRESETS.map((p) => ({
  query: `\`${p.query}\``,
  browsers: String(p.browsers.length),
  plugins: String(p.plugins),
  code: `${fmt(p.min)} Б (${times(p.min)})`,
  usage: `${p.usage.length} мод., ${fmt(p.usageBytes)} Б`,
  entry: `${p.entry} мод., ${fmt(p.entryBytes)} Б`,
}));

export const SNIPPET_ROWS = [
  { k: '`a?.b`', plugin: 'transform-optional-chaining', s: SNIPPETS.optional },
  { k: '`a ?? b`', plugin: 'transform-nullish-coalescing-operator', s: SNIPPETS.nullish },
  { k: '`#n` в классе', plugin: 'transform-class-properties', s: SNIPPETS.private },
  { k: '`async`/`await`', plugin: 'transform-async-to-generator', s: SNIPPETS.async },
  { k: '`async` → ES5', plugin: '+ transform-regenerator', s: SNIPPETS.asyncEs5 },
  { k: '`[...a, ...b]`', plugin: 'transform-spread', s: SNIPPETS.spread },
  { k: '`{ ...prev }`', plugin: 'transform-object-rest-spread', s: SNIPPETS.objectSpread },
].map((r) => {
  const name = r.plugin.replace('+ ', '');
  const v = COMPAT[name];
  return {
    k: r.k,
    plugin: `\`${r.plugin}\``,
    since: `Chrome ${v.chrome}, Firefox ${v.firefox}, Safari ${v.safari}`,
    bytes: `${r.s.before} → ${fmt(r.s.after)}`,
  };
});

export const ESBUILD_ROWS = [
  { k: '`chrome109`', res: `${ESBUILD.chrome109.bytes} Б — как исходник`, tone: 'ok' as const },
  { k: '`safari14.1`', res: `${ESBUILD['safari14.1'].bytes} Б; Babel на \`safari 14.1\` — ${BABEL_SAFARI_141} Б из-за \`...rest\``, tone: 'ok' as const },
  { k: '`safari13`', res: `отказ: ${ESBUILD.safari13.errors} ошибка, «Transforming destructuring … is not supported yet»`, tone: 'warn' as const },
  { k: '`es2017`', res: `${fmt(ESBUILD.es2017.bytes!)} Б — приватные поля и \`{ ...obj }\` переписаны; tsc: ${fmt(TSC.ES2017)} Б`, tone: 'ok' as const },
  { k: '`es2015`', res: `${fmt(ESBUILD.es2015.bytes!)} Б — ещё и \`async\` стал генератором; tsc: ${fmt(TSC.ES2015)} Б`, tone: 'ok' as const },
  { k: '`es5`', res: `отказ: ${ESBUILD.es5.errors} ошибок — классы, \`let\`, \`const\`, \`for…of\`, \`async\`, spread`, tone: 'err' as const },
];

const pair = (s: { code: string; out: string }) => `// было\n${s.code}\n\n// стало\n${s.out}`;

export const SNIP_OPTIONAL_CODE = `${pair(SNIPPETS.optional)}\n\n${pair(SNIPPETS.nullish)}`;
export const SNIP_PRIVATE_CODE = pair(SNIPPETS.private);
export const SNIP_ASYNC_CODE = pair(SNIPPETS.async);

export const BUGFIX_CODE = `// исходник
${BUGFIX.source}

// chrome 80, Babel 7 по умолчанию
${BUGFIX.plain}

// chrome 80, bugfixes: true
${BUGFIX.bugfixes}`;
