import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { CloneSample } from '@/widgets/clone-lab/model/types';

/**
 * Данные темы «Копирование и сериализация: JSON и structuredClone».
 *
 * Тема написана здесь, 2026-10-02.
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * Node 24.11.0 (V8 13.6.233.10), Chromium 153.0.8010.12 (Playwright 1.63, headless, about:blank),
 * lodash-es 4.18.1 из `node_modules` проекта. Октябрь 2026. Скрипты стенда — одна страница
 * выражений: каждое исполнено в Node и в Chromium, результат напечатан строкой.
 *
 * Что снято и как совпало:
 *   — `JSON.stringify`/`JSON.parse`: все строки `STRINGIFY_ROWS`, порядок вызовов replacer
 *     и reviver, `context.source` (есть в обоих — у примитивов, у объектов и массивов его нет),
 *     текст ошибки цикла. В Node и Chromium вывод совпал байт в байт, включая текст ошибок
 *     `Converting circular structure to JSON …` и `Do not know how to serialize a BigInt`;
 *   — `structuredClone`: тридцать пять случаев (классы, геттеры, дескрипторы, символы, прокси,
 *     `WeakMap`, `Promise`, `RegExp.lastIndex`, `Error` с `cause` и подклассом, буферы, перенос,
 *     порядок вызова геттеров, исключение посреди обхода). Результаты в Node и Chromium
 *     одинаковы; отличается только текст `DataCloneError`: Chromium приписывает спереди
 *     «Failed to execute 'structuredClone' on 'Window': ». Имя `DataCloneError` и `code` 25 —
 *     в обоих. В тексте темы печатается только имя: оно нормативно, текст — нет;
 *   — `Error`: `cause` не описан в спецификации HTML (там только имя, `message` и стек),
 *     но V8 копирует его, если это собственное data-свойство, — неперечисляемым, даже если
 *     у оригинала оно было перечисляемым. Стек в V8 — собственный аксессор `stack`;
 *   — `cloneDeep` из lodash-es 4.18.1 — только в Node (это обычный JS, от движка не зависит).
 *
 * Пересобирает всё перечисленное `tests/unit/serialization.test.ts`: примеры исполняются
 * и сверяются со стрелками `// →` в коде, таблицы — с движком, учебные `stringify` и `clone` —
 * с настоящими `JSON.stringify` и `structuredClone` на наборе значений и на 400 случайных
 * деревьях с фиксированным зерном (сверка `stringify` — байт в байт, `clone` — по `shape`
 * из `widgets/clone-lab/model/shape.ts`: типы, прототипы, ключи с флагами, граф ссылок).
 * Браузерную часть тест не поднимает: она снята стендом один раз и совпала с Node.
 *
 * Только по документации, без запуска: DOM-узлы и прочие platform-объекты в `structuredClone`
 * (в Node их нет; список — по спецификации HTML и MDN); IndexedDB как третий потребитель
 * того же алгоритма (по спецификации IndexedDB, разбор — в «Хранилищах браузера»).
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'сериализация',
    d: 'Перевод значения в форму, которую можно сохранить или передать: в текст (JSON) или во внутренний поток байтов (structured clone). Обратный шаг — десериализация: собрать значение заново.',
  },
  {
    k: 'поверхностная и глубокая копия',
    d: 'Поверхностная копирует только верхний уровень: вложенные объекты остаются общими с оригиналом. Глубокая проходит всё дерево и создаёт новые объекты на каждом уровне.',
  },
  {
    k: 'дескриптор свойства',
    d: 'Настройки одного свойства: значение или пара геттер/сеттер и три флага — `writable`, `enumerable`, `configurable`. Копирование почти всегда их теряет.',
  },
  {
    k: 'внутренний слот',
    d: 'Скрытое поле объекта, которое видит только движок: `[[DateValue]]` у `Date`, `[[MapData]]` у `Map`. По слотам, а не по `instanceof`, алгоритмы спецификации узнают тип объекта.',
  },
  {
    k: '`replacer` и `reviver`',
    d: 'Функции-перехватчики. `replacer` — второй аргумент `JSON.stringify`, вызывается на каждое свойство перед записью. `reviver` — второй аргумент `JSON.parse`, вызывается на каждое свойство после разбора.',
  },
  {
    k: '`DataCloneError`',
    d: 'Исключение `structuredClone` и `postMessage`: в значении нашлось то, что алгоритм копировать не умеет, — функция, символ, прокси, DOM-узел. Это `DOMException`, а не `TypeError`.',
  },
];

export const PLAIN_COPY =
  'Скопировать объект — как переписать адресную книгу. Можно переписать только первую страницу, а на остальные поставить «см. оригинал» — это поверхностная копия. Можно переписать всё, но через диктовку по телефону (JSON): что не произносится словами — фотография, закладка, — не дойдёт. А можно снять ксерокопию (`structuredClone`): страницы и закладки приедут, но переплёт и подписи на полях — нет.';

export const PREREQ_NOTE =
  'Тема опирается на четыре вещи из других тем. Каждая объяснена на карточке коротко, подробности — по ссылке.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'Дескрипторы и прототип',
    d: 'У каждого свойства есть флаги, а у объекта — ссылка на прототип, где живут методы и геттеры класса. Обычное чтение свойства этих деталей не показывает, а копирование их как раз и теряет.',
    href: '/js/object-model/#s5',
    hrefLabel: '«Объектная модель», раздел «Дескрипторы»',
    tone: 'info',
  },
  {
    t: 'Передача данных в воркер',
    d: '`postMessage` копирует сообщение тем же алгоритмом, что и `structuredClone`. Список того, что переживает копию и что теряется, проверенный в вашем браузере, уже разобран.',
    href: '/js/workers/#s2',
    hrefLabel: '«Воркеры», раздел «Клонирование»',
    tone: 'info',
  },
  {
    t: 'Число double и предел 2⁵³',
    d: 'Числа в JavaScript — 64-битные с плавающей точкой. Целые больше 2⁵³ хранятся с пропусками, и соседние значения сливаются.',
    href: '/js/numbers/#s3',
    hrefLabel: '«Числа», раздел «Где теряются целые»',
    tone: 'info',
  },
  {
    t: 'Объект ошибки',
    d: '`message`, `stack` и `cause` у ошибки — неперечисляемые свойства, а не обычные поля. Поэтому разные способы копирования берут у ошибки разное.',
    href: '/js/errors/#s1',
    hrefLabel: '«Ошибки и стеки», раздел «Объект ошибки»',
    tone: 'info',
  },
];

// ─── Сквозной пример ───────────────────────────────────────────────────────────────────────

/**
 * Заказ — сквозной пример темы. Все примеры ниже исполняются с этим кодом впереди
 * (`new Function('console', ORDER_CODE + код)`), а стрелки `// →` сверяет тест.
 */
export const ORDER_CODE = `const order = {
  id: 1017,
  createdAt: new Date('2026-10-02T09:30:00Z'),
  items: [{ title: 'Кофе', qty: 2 }],
  tags: new Set(['new']),
  promo: undefined,
};`;

// ─── Раздел 1. Поверхностная копия ─────────────────────────────────────────────────────────

export const SHALLOW_CODE = `const copy = { ...order };

copy.id = 2000;
console.log(order.id);                      // → 1017

copy.items[0].qty = 5;
console.log(order.items[0].qty);            // → 5
console.log(copy.items === order.items);    // → true`;

export const SHALLOW_NOTE =
  'Спред создал новый объект и переписал в него значения свойств. Для числа значение — само число, поэтому `copy.id` живёт отдельно. Для массива значение — ссылка, и `copy.items` указывает на тот же массив, что и `order.items`. Правка через копию меняет оригинал.';

export const PLAIN_SHALLOW =
  'Как ключи от квартиры. Сделали дубликат связки — связка новая, а квартира та же. Кто откроет дверь своим ключом и переставит мебель, переставит её для всех.';

export const GETTER_CODE = `let reads = 0;
const cart = {
  get total() { reads += 1; return 500; },
};
Object.defineProperty(cart, 'id', { value: 7, enumerable: false });

const a = { ...cart };
const b = Object.assign({}, cart);

console.log(reads);                                      // → 2
console.log(typeof Object.getOwnPropertyDescriptor(a, 'total').get); // → undefined
console.log(a.total, 'id' in a, 'id' in b);              // → 500 false false`;

export const GETTER_NOTE =
  'Оба способа читают свойство обычным образом, то есть **вызывают геттер**, и кладут в копию его результат. В копии `total` — уже не геттер, а число 500, и пересчитываться оно больше не будет. Неперечисляемое `id` не попало никуда: оба способа берут только свои перечисляемые ключи.';

/**
 * Таблица сверяется тестом построчно: каждая ячейка — результат кода в `SHALLOW_PROBES`
 * теста, а не память автора.
 */
export const SHALLOW_ROWS = [
  { k: 'вложенный объект', spread: 'общий с оригиналом', assign: 'общий с оригиналом', tone: 'err' as const },
  { k: 'геттер', spread: 'вызван, в копии — значение', assign: 'вызван, в копии — значение', tone: 'warn' as const },
  { k: 'неперечисляемое свойство', spread: 'пропало', assign: 'пропало', tone: 'warn' as const },
  { k: 'ключ-символ', spread: 'скопирован', assign: 'скопирован', tone: 'ok' as const },
  { k: 'только для чтения (`writable: false`)', spread: 'стало записываемым', assign: 'стало записываемым', tone: 'warn' as const },
  { k: 'прототип класса и `#`-поля', spread: 'потеряны: копия — обычный объект', assign: 'потеряны: копия — обычный объект', tone: 'err' as const },
  { k: 'сеттер у **цели** копирования', spread: 'не вызывается: свойство создаётся заново', assign: 'вызывается: запись идёт через `[[Set]]`', tone: 'warn' as const },
];

export const SHALLOW_LINK =
  'Почему так: спред и `Object.assign` перебирают собственные перечисляемые ключи и копируют **значения**, а не дескрипторы. Чем отличаются `[[Get]]` и `[[Set]]`, дескриптор данных и аксессор — в [«Объектной модели», раздел «Дескрипторы»](/js/object-model/#s5). Там же копия, которая сохраняет дескрипторы: `Object.defineProperties({}, Object.getOwnPropertyDescriptors(src))` — но и она остаётся поверхностной.';

// ─── Раздел 2. JSON.stringify ──────────────────────────────────────────────────────────────

export const STRINGIFY_ORDER_CODE = `console.log(JSON.stringify(order));
// → {"id":1017,"createdAt":"2026-10-02T09:30:00.000Z","items":[{"title":"Кофе","qty":2}],"tags":{}}`;

export const STRINGIFY_ORDER_NOTE =
  'Три потери за одну строку, и ни одного предупреждения. `createdAt` стал строкой: у `Date` есть метод `toJSON`, и сериализатор взял его результат. `tags` стал пустым объектом: у `Set` нет ни `toJSON`, ни перечисляемых свойств. `promo` пропал целиком: `undefined` в JSON не существует.';

export const STRINGIFY_STEPS = [
  '**Прочитать значение.** `holder[key]` — обычное чтение, геттеры вызываются. Самый первый вызов — для обёртки `{ "": value }`, поэтому корень приходит с ключом `""`.',
  '**Спросить `toJSON`.** Если у объекта или `BigInt` есть метод `toJSON`, значение заменяется его результатом. Аргументом идёт ключ — `Date` его не использует, а свой `toJSON` может.',
  '**Спросить replacer.** Если передана функция, она получает ключ и **уже заменённое** значение, `this` — объект-владелец.',
  '**Развернуть обёртки.** `new Number(5)`, `Object(\'x\')` и соседи становятся примитивами.',
  '**Записать.** `null`, `true`, `false`, строка в кавычках, конечное число. `NaN` и `Infinity` — `null`. `BigInt` — `TypeError`. Массив и объект — рекурсией. Всё остальное (`undefined`, функция, символ) — «нет значения».',
];

export const STRINGIFY_STEPS_NOTE =
  '«Нет значения» — главное слово этого алгоритма. В объекте такое свойство просто не пишется, в массиве на его месте встаёт `null`: выкинуть элемент нельзя, иначе съедут индексы соседей.';

export const PLAIN_SPEC_STEPS =
  'Спецификация описывает `JSON.stringify` не словами «превращает объект в строку», а пошаговым рецептом, как поваренная книга. Шаги видно снаружи: в каком порядке вызываются `toJSON` и replacer, когда читается геттер. Поэтому рецепт можно переписать на JavaScript и проверить, что он даёт ту же строку, что и движок.';

/**
 * Учебный `JSON.stringify`. Печатается на странице, исполняется демо и тестом
 * (`tests/unit/serialization.test.ts` сверяет его с `JSON.stringify` байт в байт).
 * `JSON.rawJSON` (разобран в «Числах») опущен ради длины.
 */
export const STRINGIFY_CODE = String.raw`// Учебный JSON.stringify — по шагам ECMA-262 (25.5.2).
function stringify(value, replacer, space) {
  const stack = [];          // объекты, которые сейчас на пути: от циклов
  let indent = '';
  let replacerFn;
  let keys;                  // «белый список» из массива-replacer

  if (typeof replacer === 'function') {
    replacerFn = replacer;
  } else if (Array.isArray(replacer)) {
    keys = [];
    for (let i = 0; i < replacer.length; i++) {
      const v = replacer[i];
      const kind = typeof unbox(v) === 'undefined' ? typeof v : typeof unbox(v);
      if (kind !== 'string' && kind !== 'number') continue;   // остальное молча пропускается
      const item = String(v);
      if (!keys.includes(item)) keys.push(item);
    }
  }

  let sp = space;
  if (typeof unbox(sp) === 'number') sp = Number(sp);
  else if (typeof unbox(sp) === 'string') sp = String(sp);
  const gap = typeof sp === 'number' ? ' '.repeat(Math.min(10, Math.max(0, Math.trunc(sp) || 0)))
    : typeof sp === 'string' ? sp.slice(0, 10)
    : '';

  // SerializeJSONProperty: значение свойства key у holder → текст или undefined.
  function property(holder, key) {
    let value = holder[key];
    if (value !== null && (typeof value === 'object' || typeof value === 'bigint')) {
      const toJSON = value.toJSON;
      if (typeof toJSON === 'function') value = toJSON.call(value, key);
    }
    if (replacerFn) value = replacerFn.call(holder, key, value);
    if (value !== null && typeof value === 'object') {
      const prim = unbox(value);
      if (typeof prim === 'number') value = Number(value);
      else if (typeof prim === 'string') value = String(value);
      else if (prim !== undefined) value = prim;     // boolean, bigint
    }
    if (value === null) return 'null';
    if (value === true) return 'true';
    if (value === false) return 'false';
    if (typeof value === 'string') return quote(value);
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
    if (typeof value === 'bigint') throw new TypeError('Do not know how to serialize a BigInt');
    if (typeof value === 'object') return Array.isArray(value) ? array(value) : object(value);
    return undefined;        // undefined, функция, символ
  }

  function enter(value) {
    if (stack.includes(value)) throw new TypeError('Converting circular structure to JSON');
    stack.push(value);
    const stepback = indent;
    indent += gap;
    return stepback;
  }

  function wrap(open, parts, close, stepback) {
    stack.pop();
    const inner = indent;
    indent = stepback;
    if (parts.length === 0) return open + close;
    if (gap === '') return open + parts.join(',') + close;
    return open + '\n' + inner + parts.join(',\n' + inner) + '\n' + stepback + close;
  }

  function object(value) {
    const stepback = enter(value);
    const parts = [];
    for (const key of keys ?? Object.keys(value)) {
      const str = property(value, key);
      if (str !== undefined) parts.push(quote(key) + ':' + (gap ? ' ' : '') + str);
    }
    return wrap('{', parts, '}', stepback);
  }

  function array(value) {
    const stepback = enter(value);
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(property(value, String(i)) ?? 'null');
    return wrap('[', parts, ']', stepback);
  }

  return property({ '': value }, '');
}

// Строка в кавычках: управляющие символы и одиночные суррогаты — через \uXXXX.
function quote(str) {
  const short = { '\b': '\\b', '\t': '\\t', '\n': '\\n', '\f': '\\f', '\r': '\\r', '"': '\\"', '\\': '\\\\' };
  let out = '"';
  for (const ch of str) {
    const code = ch.codePointAt(0);
    if (short[ch]) out += short[ch];
    else if (code < 0x20 || (code >= 0xd800 && code <= 0xdfff)) out += '\\u' + code.toString(16).padStart(4, '0');
    else out += ch;
  }
  return out + '"';
}

// Объект-обёртка (new Number(1), Object('x')…) → примитив внутри; иначе undefined.
function unbox(v) {
  if (v === null || typeof v !== 'object') return undefined;
  for (const C of [Number, String, Boolean, BigInt]) {
    try { return C.prototype.valueOf.call(v); } catch {}
  }
  return undefined;
}`;

export const STRINGIFY_CODE_NOTE =
  'Восемьдесят строк повторяют шаги спецификации `SerializeJSONProperty`, `SerializeJSONObject`, `SerializeJSONArray` и `QuoteJSONString`. Цикл ловится стеком объектов, которые сейчас на пути: объект, который уже **в стеке**, — цикл, а объект, который просто встречался раньше в другой ветке, — нет. Поэтому общая ссылка записывается дважды, а цикл бросает исключение.';

/** Каждая строка: выражение, ответ `JSON.stringify` (строкой, как напечатал бы `console.log`), причина. */
export const STRINGIFY_ROWS = [
  { expr: "{ a: undefined, f() {}, s: Symbol('x') }", out: '{}', why: '«нет значения» — свойство не пишется', tone: 'warn' as const },
  { expr: "[undefined, () => 1, Symbol('x')]", out: '[null,null,null]', why: 'в массиве «нет значения» — это `null`', tone: 'warn' as const },
  { expr: "{ [Symbol('k')]: 1 }", out: '{}', why: 'ключи-символы не перебираются вовсе', tone: 'warn' as const },
  { expr: '[NaN, Infinity, -0]', out: '[null,null,0]', why: 'в JSON есть только конечные числа; знак нуля теряется при печати', tone: 'err' as const },
  { expr: "new Date('2026-10-02T09:30:00Z')", out: '"2026-10-02T09:30:00.000Z"', why: '`Date.prototype.toJSON` → `toISOString`', tone: 'warn' as const },
  { expr: 'new Date(NaN)', out: 'null', why: '`toJSON` неверной даты возвращает `null`, а не бросает', tone: 'warn' as const },
  { expr: "new Map([['k', 1]])", out: '{}', why: 'содержимое `Map` лежит во внутреннем слоте, а не в свойствах', tone: 'err' as const },
  { expr: '/ab+c/g', out: '{}', why: 'у `RegExp` нет перечисляемых свойств', tone: 'err' as const },
  { expr: 'new Uint8Array([1, 2])', out: '{"0":1,"1":2}', why: 'не массив (`Array.isArray` — `false`), а объект с индексами', tone: 'warn' as const },
  { expr: "new Error('boom')", out: '{}', why: '`message` и `stack` неперечисляемые', tone: 'err' as const },
  { expr: "Object('x')", out: '"x"', why: 'обёртка разворачивается в примитив', tone: undefined },
  { expr: '{ toJSON: () => 42 }', out: '42', why: 'объект заменён результатом `toJSON`', tone: undefined },
  { expr: '"\\u0007\\ud800"', out: '"\\u0007\\ud800"', why: 'управляющий символ и одиночный суррогат — через `\\uXXXX`', tone: undefined },
  { expr: '{ a: 1n }', out: 'TypeError', why: '`BigInt` в JSON не превращается сам — нужен `toJSON` или replacer', tone: 'err' as const },
  { expr: 'undefined', out: 'undefined', why: 'не строка: на верхнем уровне «нет значения» возвращается как есть', tone: 'warn' as const },
];

export const STRINGIFY_ERRORS_LINK =
  'Отдельная история — ошибки: `JSON.stringify(err)` даёт `{}` или одно поле `code`, а сериализовать их приходится своим обходом. Это разобрано в [«Ошибках и стеках», раздел «Отчёт»](/js/errors/#s6).';

export const REPLACER_CODE = `const seen = [];
JSON.stringify(order, function (key, value) {
  seen.push(key === '' ? '(корень)' : key);
  if (key === 'createdAt') {
    console.log(typeof value, this[key] instanceof Date); // → string true
  }
  return value;
});
console.log(seen.join(' '));
// → (корень) id createdAt items 0 title qty tags promo`;

export const REPLACER_NOTE =
  'Два факта из одного примера. Порядок обхода — сверху вниз: сначала владелец, потом его свойства, корень первым с ключом `""`. И replacer получает `createdAt` **уже строкой**: `toJSON` у `Date` отработал раньше. Проверка `value instanceof Date` в replacer не сработает никогда. Исходный объект достаётся через `this[key]`: `this` — объект, в котором лежит свойство.';

export const ARRAY_REPLACER_CODE = `console.log(JSON.stringify(order, ['items', 'id', 'title']));
// → {"items":[{"title":"Кофе"}],"id":1017}`;

export const ARRAY_REPLACER_NOTE =
  'Массив вместо функции — белый список ключей. Он действует **на всех уровнях** (у вложенного товара остался только `title`) и **задаёт порядок**: `items` записан раньше `id`, как в списке, а не как в объекте. Индексы массивов список не трогает. Числа в списке превращаются в строки, повторы отбрасываются, всё остальное — молча пропускается.';

export const SPACE_CODE = `console.log(JSON.stringify({ id: 1, tags: ['new'] }, null, '··'));`;

export const SPACE_OUT = `{
··"id": 1,
··"tags": [
····"new"
··]
}`;

export const SPACE_NOTE =
  'Третий аргумент — отступ. Число означает столько пробелов, но не больше 10: `20` даст те же 10. Строка повторяется как есть и тоже обрезается до 10 символов. С отступом после двоеточия появляется пробел, а пустые `{}` и `[]` остаются в одну строку.';

export const CYCLE_CODE = `const author = { name: 'Аня' };
const post = { author, editor: author };   // один объект в двух полях
console.log(JSON.stringify(post));
// → {"author":{"name":"Аня"},"editor":{"name":"Аня"}}

post.self = post;                          // а теперь цикл
JSON.stringify(post);                      // TypeError`;

/** Текст ошибки — V8 (Node 24.11 и Chromium 153 дали один и тот же). Тест сверяет с Node. */
export const CYCLE_ERROR = `TypeError: Converting circular structure to JSON
    --> starting at object with constructor 'Object'
    --- property 'self' closes the circle`;

export const CYCLE_NOTE =
  'Общая ссылка — не ошибка: автор записан дважды, а после `JSON.parse` это будут **два разных** объекта. Цикл — ошибка: сериализатор вошёл бы в `post` бесконечно. Спецификация требует только `TypeError`, а подробный текст с путём до цикла — забота V8; в других движках он другой.';

// ─── Раздел 3. JSON.parse ──────────────────────────────────────────────────────────────────

export const REVIVER_CODE = `const text = '{"id":1017,"items":[{"qty":2}],"at":"2026-10-02T09:30:00.000Z"}';

const back = JSON.parse(text, function (key, value, context) {
  console.log(key || '(корень)', context.source ?? '—');
  return key === 'at' ? new Date(value) : value;
});
// → id 1017
// → qty 2
// → 0 —
// → items —
// → at "2026-10-02T09:30:00.000Z"
// → (корень) —

console.log(back.at instanceof Date);   // → true`;

export const REVIVER_NOTE =
  'Reviver идёт **снизу вверх**: сначала все дети, потом их владелец, корень последним. Так к моменту вызова для `items` его элементы уже обработаны, и функция видит готовое поддерево. Это обратный порядок по сравнению с replacer. Тип `Date` сам не восстанавливается: в JSON это просто строка, и вернуть дату может только reviver, который знает, в каком ключе она лежит.';

export const PLAIN_REVIVER =
  'Как сборка мебели по инструкции: сначала собирают ящики, потом вставляют их в шкаф, и только в конце ставят шкаф к стене. Reviver видит шкаф, когда ящики в нём уже собраны.';

export const SOURCE_NOTE =
  'Третий аргумент `context` — новинка из предложения «JSON.parse source text access»; на стенде он есть в Node 24 и Chromium 153. В `context.source` лежит **исходный текст** значения, как он был в JSON, — только у примитивов: у объектов и массивов его нет. Этим исходным текстом спасают большие идентификаторы, которые `JSON.parse` иначе молча округлил бы, — разобрано в [«Числах», раздел «Где теряются целые»](/js/numbers/#s3).';

export const DROP_CODE = `const list = JSON.parse('[1, 2, 3]', (key, value) => (value === 2 ? undefined : value));
console.log(list.length, 1 in list);    // → 3 false`;

export const DROP_NOTE =
  '`undefined` из reviver **удаляет** свойство. В объекте ключ пропадает, а в массиве остаётся дыра: длина прежняя, элемента нет. Отфильтровать массив reviver-ом нельзя — только оставить в нём пустое место.';

export const PARSE_FACTS = [
  {
    t: '`"__proto__"` — обычный ключ',
    d: 'Парсер JSON заводит его как собственное свойство и прототип не трогает. Опасным его делает код, который потом копирует такой объект присваиванием, — разобрано в [«Объектной модели», раздел «Прототипы»](/js/object-model/#s2).',
  },
  {
    t: 'Числа читаются как double',
    d: '`JSON.parse(\'{"id": 9007199254740993}\').id` — это `9007199254740992`, без ошибки. `1e400` — `Infinity`. JSON не ограничивает длину числа, ограничивает тип, в который его читают.',
    tone: 'err' as const,
  },
  {
    t: 'Повтор ключа — побеждает последний',
    d: '`JSON.parse(\'{"a":1,"a":2}\').a` — это `2`. Спецификация это допускает, и ни один движок не предупреждает. Валидаторы схем повтор тоже обычно не видят: они получают уже разобранный объект.',
    tone: 'warn' as const,
  },
];

// ─── Раздел 4. structuredClone ─────────────────────────────────────────────────────────────

export const CLONE_ORDER_CODE = `const copy = structuredClone(order);
console.log(copy.createdAt instanceof Date, copy.tags.has('new'), 'promo' in copy);
// → true true true
console.log(copy.items === order.items);   // → false`;

export const CLONE_ORDER_NOTE =
  'Тот же заказ, и на этот раз без потерь: `Date` остался датой, `Set` — множеством, ключ со значением `undefined` на месте, массив товаров — новый. Глубокая копия, которой JSON не умеет.';

export const CLONE_STEPS = [
  '**Уже видели?** У алгоритма есть таблица `memory`: объект оригинала → его копия. Если объект в ней есть, возвращается та же копия. Так общая ссылка остаётся общей, а цикл — циклом.',
  '**Примитив?** Копируется как есть, включая `undefined`, `NaN`, `-0` и `BigInt`. Символ — `DataCloneError`.',
  '**Какой объект?** Тип узнаётся по внутреннему слоту: `[[DateValue]]`, `[[RegExpMatcher]]`, `[[ArrayBufferData]]`, `[[MapData]]`, `[[SetData]]`, `[[ErrorData]]`, массив. Для каждого — свой рецепт копии.',
  '**Функция или незнакомый слот?** `DataCloneError`. Сюда попадают функции, `WeakMap`, `Promise`, прокси и DOM-узлы, у которых нет своего рецепта.',
  '**Обычный объект.** Новый `{}` с прототипом `Object.prototype` — **всегда**, какой бы ни был прототип у оригинала. Записать копию в `memory`.',
  '**Обход.** Для `Map` и `Set` — их записи. Для массивов и объектов — свои перечисляемые строковые ключи: прочитать значение (геттер вызовется) и скопировать его тем же алгоритмом.',
];

export const PLAIN_SLOT =
  'Внутренний слот — как штамп в паспорте, который видит только пограничник. Объект может назваться датой (`Symbol.toStringTag`), прикинуться ею через прототип — пограничник смотрит на штамп. `structuredClone` проверяет штампы, поэтому подделку под `Date` он скопирует как обычный объект, а настоящую дату — датой.';

/**
 * Учебный `structuredClone`. Печатается на странице, исполняется демо и тестом
 * (сверка с настоящим `structuredClone` по `shape`).
 */
export const CLONE_CODE = String.raw`// Учебный structuredClone — по шагам StructuredSerializeInternal из HTML.
// Запись и сборка копии слиты в один обход; memory помнит уже скопированные объекты.
// unbox — из учебного stringify выше.
function clone(value, memory = new Map()) {
  if (memory.has(value)) return memory.get(value);         // цикл или общая ссылка
  if (typeof value === 'symbol') throw cloneError(value);
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value;

  let out;
  let deep = false;                                         // обходить ли свойства
  if (unbox(value) !== undefined) out = Object(unbox(value)); // new Number(1) и соседи
  else if (is(Date.prototype.getTime, value)) out = new Date(value.getTime());
  else if (is(regExpSource, value) && value !== RegExp.prototype) {
    out = new RegExp(regExpSource.call(value), regExpFlags.call(value)); // lastIndex не берётся
  } else if (is(bufferLength, value)) {
    if (value.detached) throw cloneError(value);
    out = new ArrayBuffer(value.byteLength, value.resizable ? { maxByteLength: value.maxByteLength } : {});
    new Uint8Array(out).set(new Uint8Array(value));
  } else if (ArrayBuffer.isView(value)) {
    const buffer = clone(value.buffer, memory);             // общий буфер останется общим
    const name = typedArrayName.call(value);                // undefined у DataView
    out = name ? new globalThis[name](buffer, value.byteOffset, value.length)
      : new DataView(buffer, value.byteOffset, value.byteLength);
  } else if (is(Map.prototype.has, value)) { out = new Map(); deep = true; }
  else if (is(Set.prototype.has, value)) { out = new Set(); deep = true; }
  else if (Error.isError(value)) return cloneErrorObject(value, memory);
  else if (Array.isArray(value)) { out = new Array(value.length); deep = true; }
  else if (typeof value === 'function' || REFUSED.some((check) => is(check, value)) || value instanceof Promise) {
    throw cloneError(value);                                // функции и «чужие» внутренние слоты
  } else { out = {}; deep = true; }                         // прототип не копируется: всегда Object

  memory.set(value, out);
  if (!deep) return out;

  if (out instanceof Map) {
    for (const [k, v] of [...value]) out.set(clone(k, memory), clone(v, memory));
  } else if (out instanceof Set) {
    for (const v of [...value]) out.add(clone(v, memory));
  } else {
    for (const key of Object.keys(value)) {                 // свои перечисляемые, без символов
      if (!Object.hasOwn(value, key)) continue;             // геттер мог удалить ключ
      // Не out[key] = …: ключ "__proto__" сменил бы прототип вместо записи свойства.
      Object.defineProperty(out, key, {
        value: clone(value[key], memory), writable: true, enumerable: true, configurable: true,
      });
    }
  }
  return out;
}

// Ошибка: имя из семи стандартных, message и cause — только свои data-свойства.
function cloneErrorObject(value, memory) {
  const name = ERRORS.includes(value.name) ? value.name : 'Error';
  const message = Object.getOwnPropertyDescriptor(value, 'message');
  const cause = Object.getOwnPropertyDescriptor(value, 'cause');
  const out = new globalThis[name]();
  out.stack = value.stack;
  memory.set(value, out);
  if (message && 'value' in message) hide(out, 'message', String(message.value));
  if (cause && 'value' in cause) hide(out, 'cause', clone(cause.value, memory));
  return out;
}

function hide(obj, key, value) {
  Object.defineProperty(obj, key, { value, writable: true, enumerable: false, configurable: true });
}

// Проверка «у объекта есть такой внутренний слот»: родной метод бросает на чужом объекте.
function is(method, value) {
  try { method.call(value); return true; } catch { return false; }
}

function cloneError(value) {
  const text = typeof value === 'symbol' ? value.toString() : Object.prototype.toString.call(value);
  return new DOMException(text + ' could not be cloned.', 'DataCloneError');
}

const ERRORS = ['Error', 'EvalError', 'RangeError', 'ReferenceError', 'SyntaxError', 'TypeError', 'URIError'];
const getter = (proto, key) => Object.getOwnPropertyDescriptor(proto, key).get;
const regExpSource = getter(RegExp.prototype, 'source');
const regExpFlags = getter(RegExp.prototype, 'flags');
const bufferLength = getter(ArrayBuffer.prototype, 'byteLength');
const typedArrayName = getter(Object.getPrototypeOf(Uint8Array.prototype), Symbol.toStringTag);
const REFUSED = [WeakMap.prototype.has, WeakSet.prototype.has, WeakRef.prototype.deref, Symbol.prototype.valueOf];`;

export const CLONE_CODE_NOTE =
  'Слоты из JavaScript не видны, поэтому учебная функция проверяет их косвенно: вызывает родной метод на чужом объекте — `Date.prototype.getTime.call(value)` бросает, если у `value` нет `[[DateValue]]`. Так же устроен `Error.isError`. Две вещи эта функция повторить не может. Прокси снаружи неотличим от своей цели, а настоящий алгоритм видит его слот `[[ProxyHandler]]` и отказывает — разобрано в [«Proxy и Reflect», раздел «Личность и слоты»](/js/proxy-reflect/#s5). И DOM-узлы, `Blob` и прочие объекты браузера копируются по рецептам, которые описаны в их собственных спецификациях.';

export const SLOTS_CODE = `const buffer = new ArrayBuffer(8);
const head = new Uint8Array(buffer, 0, 4);
const tail = new Uint8Array(buffer, 4);
const parts = structuredClone({ head, tail });
console.log(parts.head.buffer === parts.tail.buffer, parts.tail.byteOffset); // → true 4

const re = /кофе/g;
re.test('кофе и кофе');
console.log(re.lastIndex, structuredClone(re).lastIndex);  // → 4 0`;

export const SLOTS_NOTE =
  'Два вида на один буфер в копии тоже смотрят в один буфер: буфер копируется через ту же таблицу `memory`. У регулярного выражения копируются только исходный текст и флаги. `lastIndex` — позиция, с которой продолжит поиск флаг `g`, — это обычное свойство, его алгоритм не берёт, и копия начнёт искать с начала.';

export const ERROR_CODE = `class HttpError extends Error {
  constructor(status, options) {
    super('HTTP ' + status, options);
    this.name = 'HttpError';
    this.status = status;
  }
}
const err = new HttpError(502, { cause: new TypeError('fetch failed') });
const copy = structuredClone(err);

console.log(copy instanceof HttpError, copy.name, copy.status);  // → false Error undefined
console.log(copy.message, '|', copy.cause.name, copy.cause.message); // → HTTP 502 | TypeError fetch failed
console.log(copy.stack === err.stack);                         // → true`;

export const ERROR_NOTE =
  'Рецепт для ошибок короткий. Имя берётся из `err.name`, и если это не одно из семи стандартных — `Error`, `EvalError`, `RangeError`, `ReferenceError`, `SyntaxError`, `TypeError`, `URIError`, — копия становится просто `Error`. Свои поля вроде `status` не копируются. `message` копируется, только если это собственное свойство-значение. Стек копируется строкой. `cause` в спецификации HTML не упомянут, но V8 его копирует — тем же алгоритмом, поэтому причина-`TypeError` осталась `TypeError`.';

export const THROW_CODE = `let calls = 0;
const draft = {
  get total() { calls += 1; return 500; },
  onSave() {},
};

try {
  structuredClone(draft);
} catch (e) {
  console.log(e.name);   // → DataCloneError
}
console.log(calls);      // → 1`;

export const THROW_NOTE =
  'Отказ случается посреди обхода, а не до него. К моменту, когда алгоритм дошёл до функции `onSave`, геттер `total` уже вызван — и его побочный эффект остался. Копии при этом нет вовсе: частичный результат не возвращается. Геттеры вызываются в порядке ключей объекта: сначала целочисленные по возрастанию, потом строковые в порядке добавления.';

export const TRANSFER_CODE = `const frame = new ArrayBuffer(1024);
const moved = structuredClone(frame, { transfer: [frame] });
console.log(frame.byteLength, moved.byteLength);   // → 0 1024`;

export const TRANSFER_NOTE =
  'Второй аргумент `structuredClone` — список переноса, как у `postMessage`. Буфер из списка не копируется, а **переезжает**: у копии данные, у оригинала пусто. Зачем это нужно и как ошибки в списке ломают передачу — в [«Воркерах», раздел «Передача владения»](/js/workers/#s3) и [«MessageChannel», раздел «Правила transfer-списка»](/js/message-channel/#s3).';

export const CLONE_USERS =
  'Тот же алгоритм работает ещё в трёх местах: `postMessage` в воркер, окно или `MessageChannel`, запись в IndexedDB и `history.pushState`. Поэтому `reactive()`-объект из Vue одинаково не уходит ни в воркер, ни в базу. Как IndexedDB хранит клонированные записи — в [«Хранилищах браузера», раздел «IndexedDB»](/platform/browser-storage/#s3).';

// ─── Раздел 5. Три способа рядом ───────────────────────────────────────────────────────────

/**
 * Сравнение трёх способов глубокой копии. Каждую ячейку проверяет тест (блок «сравнение»):
 * JSON и `structuredClone` — в Node 24.11 (совпадает с Chromium 153 по стенду), `cloneDeep` —
 * lodash-es 4.18.1 из проекта.
 */
export const COMPARE_HEAD = ['в оригинале', 'JSON туда и обратно', '`structuredClone`', '`cloneDeep` (lodash)'];

export const COMPARE_ROWS: { k: string; json: string; clone: string; lodash: string }[] = [
  { k: '`Date`', json: 'строка ISO', clone: '`Date`', lodash: '`Date`' },
  { k: '`Map`, `Set`', json: '`{}`', clone: 'копия', lodash: 'копия; ключи `Map` — те же объекты' },
  { k: '`undefined` в поле', json: 'ключ пропал', clone: 'на месте', lodash: 'на месте' },
  { k: '`NaN`, `Infinity`', json: '`null`', clone: 'на месте', lodash: 'на месте' },
  { k: '`BigInt`', json: '`TypeError`', clone: 'на месте', lodash: 'на месте' },
  { k: 'общая ссылка', json: 'два разных объекта', clone: 'одна', lodash: 'одна' },
  { k: 'цикл', json: '`TypeError`', clone: 'цикл', lodash: 'цикл' },
  { k: 'экземпляр класса', json: 'объект, прототип потерян', clone: 'объект, прототип потерян', lodash: 'прототип **сохранён**, `#`-поля — нет: геттер класса бросает `TypeError`' },
  { k: 'геттер', json: 'вызван, значение', clone: 'вызван, значение', lodash: 'вызван, значение' },
  { k: 'неперечисляемое свойство', json: 'пропало', clone: 'пропало', lodash: 'пропало' },
  { k: 'ключ-символ', json: 'пропал', clone: 'пропал', lodash: 'скопирован' },
  { k: 'функция в поле', json: 'ключ пропал', clone: '`DataCloneError`', lodash: 'та же функция' },
  { k: '`Error`', json: '`{}`', clone: 'имя, `message`, `cause`, стек', lodash: 'внутри объекта — тот же объект ошибки' },
  { k: '`RegExp` с `lastIndex`', json: '`{}`', clone: 'копия, `lastIndex` 0', lodash: 'копия с `lastIndex`' },
  { k: 'два вида на один буфер', json: 'объекты с индексами', clone: 'буфер общий', lodash: 'два разных буфера' },
  { k: 'дыра в массиве', json: '`null`', clone: 'дыра', lodash: '`undefined` на месте дыры' },
  { k: '`WeakMap` в поле', json: '`{}`', clone: '`DataCloneError`', lodash: 'тот же `WeakMap`' },
];

export const COMPARE_NOTE =
  'Ни один способ не копирует «всё». JSON теряет больше всех, зато молча и предсказуемо: результат — данные, годные для сети и диска. `structuredClone` переносит типы и граф ссылок, но громко отказывает на функциях. `cloneDeep` ничего не роняет, но там, где не умеет копировать, оставляет **ссылку на оригинал** — функция, ошибка, `WeakMap` в копии те же, что в оригинале. И сохраняет прототип без приватных полей: объект выглядит как экземпляр класса, а его методы падают при первом обращении к `#`-полю.';

export const LODASH_CLASS_CODE = `class Money {
  #cents;
  constructor(cents) { this.#cents = cents; }
  get amount() { return this.#cents / 100; }
}
const copy = cloneDeep(new Money(1250));
console.log(copy instanceof Money);   // → true
try {
  copy.amount;
} catch (e) {
  console.log(e.name);                // → TypeError
}`;

export const DEMO_CAPTION =
  'Пример — тело функции, которое возвращает значение; его можно править. Каждый способ получает свой свежий экземпляр. Спред здесь — для сравнения: он копирует один уровень, и общие с оригиналом объекты помечены. Колонки JSON и `clone` считают учебные функции темы, а пометка у каждой из них говорит, совпал ли её ответ с настоящими `JSON.stringify` и `structuredClone` вашего браузера.';

const sample = (id: string, label: string, note: string, code: string): CloneSample => ({ id, label, note, code });

/** Примеры демо. Исполняет и тест: `runMethods` на каждом, ожидания — в блоке «демо». */
export const DEMO_SAMPLES: CloneSample[] = [
  sample(
    'order',
    'заказ',
    'Сквозной пример темы. JSON теряет дату, множество и `promo`, спред делит с оригиналом массив товаров.',
    `${ORDER_CODE}\nreturn order;`,
  ),
  sample(
    'class',
    'класс',
    'Экземпляр класса с приватным полем, геттером и методом. Все три способа отдают обычный объект.',
    `class Money {
  #cents;
  currency = 'EUR';
  constructor(cents) { this.#cents = cents; }
  get amount() { return this.#cents / 100; }
  format() { return this.amount + ' ' + this.currency; }
}
return { price: new Money(1250) };`,
  ),
  sample(
    'graph',
    'ссылки',
    'Один автор в двух полях. После JSON их два, после `clone` — снова один.',
    `const author = { name: 'Аня' };
return { author, editor: author, tags: [author] };`,
  ),
  sample(
    'cycle',
    'цикл',
    'Объект ссылается сам на себя. JSON бросает `TypeError`, `clone` сохраняет цикл.',
    `const node = { id: 1, children: [] };
node.children.push({ id: 2, parent: node });
return node;`,
  ),
  sample(
    'error',
    'ошибка',
    'Свой класс ошибки с полем и причиной. JSON видит только перечисляемые поля, `clone` — имя, текст, стек и `cause`.',
    `class HttpError extends Error {
  constructor(status, options) {
    super('HTTP ' + status, options);
    this.name = 'HttpError';
    this.status = status;
  }
}
return new HttpError(502, { cause: new TypeError('fetch failed') });`,
  ),
  sample(
    'props',
    'свойства',
    'Геттер, неперечисляемое свойство, ключ-символ и заморозка. Ни один способ не переносит все четыре.',
    `const settings = {
  theme: 'dark',
  get label() { return 'тема: ' + this.theme; },
  [Symbol('version')]: 3,
};
Object.defineProperty(settings, 'secret', { value: 'k-17', enumerable: false });
return Object.freeze(settings);`,
  ),
  sample(
    'refuse',
    'отказ',
    'Число `BigInt` и метод. JSON бросает на `BigInt`, `clone` — на функции.',
    `return { id: 9007199254740993n, total: NaN, onSave() {} };`,
  ),
];

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'Спред копирует один уровень',
    d: '`{ ...state }` выглядит как копия, но вложенные объекты и массивы общие с оригиналом. Правка `copy.items[0]` меняет оригинал. Для иммутабельных обновлений копируют каждый уровень на пути к изменению, а не только верхний.',
    tone: 'err',
  },
  {
    n: '02',
    t: 'Replacer видит дату строкой',
    d: '`toJSON` срабатывает раньше replacer, поэтому `value instanceof Date` в replacer всегда `false`. Исходное значение — `this[key]`.',
    code: "JSON.stringify(order, function (k, v) {\n  return this[k] instanceof Date ? this[k].getTime() : v;\n});",
    tone: 'warn',
  },
  {
    n: '03',
    t: '`JSON.parse(JSON.stringify(x))` теряет молча',
    d: '`undefined` пропадает, `NaN` и `Infinity` становятся `null`, `Date` — строкой, `Map` и `Set` — `{}`, общая ссылка — двумя объектами. Ни одного исключения. Как глубокая копия этот приём годится только для данных, которые и так пришли из JSON.',
    tone: 'err',
  },
  {
    n: '04',
    t: 'Копия вызывает геттеры',
    d: 'Спред, `Object.assign`, `JSON.stringify` и `structuredClone` читают свойства обычным образом. Дорогой или ленивый геттер выполнится в момент копирования, а в копии останется его значение — уже не геттер.',
    tone: 'warn',
  },
  {
    n: '05',
    t: '`DataCloneError` — после побочных эффектов',
    d: '`structuredClone` отказывает на функции посреди обхода. Геттеры, стоящие в объекте раньше, к этому моменту уже вызваны. Проверять «можно ли клонировать» пробным вызовом — значит выполнить их дважды.',
    tone: 'warn',
  },
  {
    n: '06',
    t: 'Экземпляр класса приезжает обычным объектом',
    d: '`structuredClone` и JSON всегда дают `Object.prototype`. `cloneDeep` прототип сохраняет, но приватные поля — нет, и метод, который читает `#`-поле, бросает `TypeError` на копии. Через границу копирования отправляют данные, а экземпляр собирают на месте: `Money.from(dto)`.',
    tone: 'err',
  },
  {
    n: '07',
    t: 'Свой класс ошибки становится `Error`',
    d: '`structuredClone(new HttpError(…))` — это `Error` с тем же текстом и стеком, но без `status` и с именем `Error`. Различать ошибки после `postMessage` надёжнее по полю в данных, чем по классу.',
    tone: 'warn',
  },
  {
    n: '08',
    t: 'Большие числа из JSON округляются',
    d: '`JSON.parse` читает число в double. Идентификатор `9007199254740993` приедет как `…992`. Такие поля передают строкой или разбирают через `context.source` в reviver.',
    tone: 'err',
  },
];

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'ECMA-262 — JSON.stringify',
    href: 'https://tc39.es/ecma262/#sec-json.stringify',
    what: '`SerializeJSONProperty`, `SerializeJSONObject`, `SerializeJSONArray`, `QuoteJSONString` — шаги, которые повторяет учебная функция',
  },
  {
    title: 'ECMA-262 — JSON.parse',
    href: 'https://tc39.es/ecma262/#sec-json.parse',
    what: '`InternalizeJSONProperty`: порядок обхода reviver и удаление свойства по `undefined`',
  },
  {
    title: 'TC39 — JSON.parse source text access',
    href: 'https://github.com/tc39/proposal-json-parse-with-source',
    what: '`context.source` в reviver и `JSON.rawJSON`',
  },
  {
    title: 'HTML Standard — Safe passing of structured data',
    href: 'https://html.spec.whatwg.org/multipage/structured-data.html',
    what: '`StructuredSerializeInternal` и `StructuredDeserialize`: таблица `memory`, рецепты по слотам, ошибки, `DataCloneError`',
  },
  {
    title: 'MDN — structuredClone()',
    href: 'https://developer.mozilla.org/en-US/docs/Web/API/Window/structuredClone',
    what: 'опция `transfer`, поддержка в браузерах',
  },
  {
    title: 'V8 — value-serializer.cc',
    href: 'https://chromium.googlesource.com/v8/v8/+/refs/heads/main/src/objects/value-serializer.cc',
    what: 'реализация structured clone в V8: в том числе копирование `cause` и стека у ошибок',
  },
  {
    title: 'lodash — cloneDeep',
    href: 'https://lodash.com/docs/#cloneDeep',
    what: 'что lodash копирует и что оставляет ссылкой; на стенде lodash-es 4.18.1',
  },
];

export const RELATED =
  'Смежное на сайте: [Воркеры, раздел «Клонирование»](/js/workers/#s2) — что переживает `postMessage`, проверка в вашем браузере. [MessageChannel, раздел «Правила transfer-списка»](/js/message-channel/#s3) — перенос вместо копии. [Ошибки и стеки, раздел «Отчёт»](/js/errors/#s6) — как сериализовать ошибку целиком. [Proxy и Reflect, раздел «Личность и слоты»](/js/proxy-reflect/#s5) — почему прокси не клонируется. [Числа, раздел «Где теряются целые»](/js/numbers/#s3) — большие числа в JSON. [Объектная модель, раздел «Дескрипторы»](/js/object-model/#s5) — что теряет спред. [Хранилища браузера, раздел «IndexedDB»](/platform/browser-storage/#s3) — третий потребитель того же алгоритма.';
