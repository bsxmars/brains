import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { CostBar, ProxyOp } from '@/widgets/proxy-traps/model/types';
import type { ReactiveScenario } from '@/widgets/proxy-reactivity/model/types';
import type { Snippet } from '@/widgets/snippet-lab/model/types';

/**
 * Данные темы «Proxy и Reflect: перехват операций над объектом».
 *
 * Тема написана 2026-10-02 выносом раздела «Proxy и Reflect» (`#s9`) из «Объектной модели»:
 * весь его материал переехал сюда без потерь — `PROXY_OPS`, `RECEIVER_*`, `SET_BOOL_*`,
 * `INVARIANT_ROWS`, `PROXY_COST*`, `PROXY_POLYFILL_NOTE`, `REFLECT_*`, `MEMBRANE_*`, источник
 * «ECMA-262 · 10.5», листинг песочницы «потерянный receiver». Проверки переехали вместе с ними
 * из `tests/unit/object-model.test.ts` в `tests/unit/proxy-reflect.test.ts`. В «Объектной модели»
 * на месте раздела остались два абзаца и ссылка сюда; якорь `#s9` там сохранён.
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * Node **24.11.0** (V8 13.6), Chromium **153.0.8010.12** (Playwright 1.63), `@vue/reactivity`
 * **3.5.42** и `immer` **11.1.18** — оба из `node_modules` проекта (Immer — зависимость
 * `@reduxjs/toolkit`; что цель черновика — служебная запись, а не исходник, прочитано
 * в `immer/src/core/proxy.ts`, `createProxyProxy`). Скрипты стенда лежали
 * в scratchpad агента; всё, что они показали, повторяет тест, кроме браузерной части:
 *
 *   — журнал ловушек: handler из `TRACE_CODE` (тринадцать ловушек, каждая пишет имя
 *     и делегирует в `Reflect`) над `{ x: 1 }` и над функцией — по нему собраны `TRAP_ROWS`
 *     и `PROXY_OPS`; тест прогоняет каждую операцию заново;
 *   — Chromium 153 на `http://localhost:4810/`: `structuredClone(proxy)`, `port.postMessage`,
 *     `window.postMessage` и `IDBObjectStore.put` с прокси бросают `DOMException`
 *     `DataCloneError`, `code` 25, текст «#<Object> could not be cloned». Вызов метода класса
 *     с `#`-полем через прокси — `TypeError` с тем же текстом, что в Node. Это снято **только
 *     стендом**: тест браузер не поднимает, в Node он проверяет `structuredClone`
 *     и `MessagePort.postMessage`;
 *   — `PROXY_COST` переехал из «Объектной модели» как есть: замер Node 26.8.2, V8 14.6,
 *     Apple M1 (там же история перемеров). Новых таймерных замеров тема не делала;
 *     отношение «прокси дороже в разы» сторожит `tests/unit/cost-invariants.test.ts`.
 *
 * Только из документации, без запуска: поведение MobX (пакета в проекте нет) — по странице
 * настроек MobX, раздел «Proxy support» (MobX 7 убрал режим без прокси, прочитано 2026-10-02). Номера шагов алгоритма клонирования в HTML — по тексту
 * спецификации (раздел StructuredSerializeInternal), не по исходникам браузера.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const PLAIN_PROXY =
  'Прокси — как секретарь у двери кабинета. Любая просьба к хозяину — «покажи», «положи», «есть ли у тебя» — идёт через секретаря. Он может записать её в журнал, отказать или ответить сам. Но если он просто передаёт просьбу дальше, посетитель разницы не заметит. `Reflect` — это и есть «передать дальше как есть».';

export const GLOSSARY = [
  {
    k: 'target и handler',
    d: '`new Proxy(target, handler)` берёт два объекта. **target** (цель) — объект, который прокси представляет. **handler** — объект с функциями-перехватчиками. Сам прокси — третий, новый объект.',
  },
  {
    k: 'внутренний метод',
    d: 'Операция, которую движок выполняет над объектом: прочитать свойство (`[[Get]]`), записать (`[[Set]]`), перечислить ключи (`[[OwnPropertyKeys]]`) и так далее. Из кода по имени её не вызвать — их вызывают точка, `in`, `delete`, `Object.keys` и прочий синтаксис.',
  },
  {
    k: 'ловушка (trap)',
    d: 'Функция в handler’е, которую движок зовёт **вместо** внутреннего метода прокси: `get` вместо `[[Get]]`, `has` вместо `[[HasProperty]]`. Ловушек тринадцать — по одной на внутренний метод. Нет ловушки — операция уходит прямо в target.',
  },
  {
    k: '`Reflect`',
    d: 'Встроенный объект с тринадцатью функциями — по одной на каждый внутренний метод, с теми же именами, что у ловушек. `Reflect.get(t, k, r)` делает ровно то, что сделал бы движок без прокси.',
  },
  {
    k: 'receiver',
    d: 'Объект, от имени которого идёт чтение или запись: обычно сам прокси или объект, у которого прокси стоит прототипом. Именно он станет `this` в геттере и сеттере.',
  },
  {
    k: 'инвариант',
    d: 'Правило, которое движок проверяет после ловушки: ответ не должен противоречить target. Ловушка, которая врёт про замороженное свойство, получает `TypeError`.',
  },
  {
    k: 'внутренний слот',
    d: 'Скрытое поле объекта, не свойство: `[[MapData]]` у `Map`, `[[DateValue]]` у `Date`, приватные `#`-поля у экземпляра класса. Ловушки слотов не видят — они перехватывают только внутренние методы.',
  },
];

export const PREREQ_NOTE =
  'Прокси подменяет операции, которые уже разобраны в «Объектной модели». Без них непонятно, что именно перехватывается.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' | 'warn' | 'err' }[] = [
  {
    t: 'Прототипы и чтение `[[Get]]`, запись `[[Set]]`',
    d: 'Чтение `obj.x` ищет ключ по цепочке прототипов, а запись ищет в цепочке причину **не** создавать свойство. Обе операции — внутренние методы, и обе передают по цепочке получателя: от его имени вызовется найденный геттер. Цепочка как таковая — в [«Объектной модели», раздел «Прототипы»](/js/object-model/#s2).',
    href: '/js/object-model/#s1',
    hrefLabel: '«Объектная модель», раздел «Модель»',
    tone: 'info',
  },
  {
    t: 'Дескрипторы и замки',
    d: 'У свойства есть флаги `writable`, `enumerable`, `configurable`; `Object.freeze` снимает `writable` и `configurable` у всех ключей и запрещает новые. На этих флагах стоят инварианты прокси: что target запретил, того ловушка не скроет.',
    href: '/js/object-model/#s5',
    hrefLabel: '«Объектная модель», раздел «Дескрипторы»',
    tone: 'warn',
  },
  {
    t: '`#`-поля живут в слоте, а не в свойстве',
    d: 'Приватное поле записано в сам объект, который создал конструктор, и доступ к нему проверяет именно этот объект. Ни одна операция над ключами его не видит.',
    href: '/js/object-model/#s4',
    hrefLabel: '«Объектная модель», раздел «Классы»',
    tone: 'warn',
  },
  {
    t: 'Что такое структурное клонирование',
    d: '`structuredClone`, `postMessage` и IndexedDB копируют данные одним алгоритмом. Он берёт не всё: функции, DOM-узлы, прототипы и приватные поля не переживают копирования.',
    href: '/js/workers/#s2',
    hrefLabel: '«Воркеры и параллелизм», раздел «Клонирование»',
    tone: 'err',
  },
];

// ─── Раздел 1 · ловушка и Reflect ──────────────────────────────────────────────────────────

export const PROXY_INTRO_NOTE =
  '`Object.defineProperty` вешает геттер на конкретный ключ и ничего не знает о ключах, которые появятся потом. Прокси стоит перед объектом целиком и перехватывает саму операцию: чтение любого ключа, даже несуществующего, `in`, `delete`, перебор ключей. Именно это позволило Vue 3 выкинуть `Vue.set`.';

/**
 * Handler, на котором сняты все журналы темы, — настоящий, а не эскиз.
 *
 * ⚠️ В «Объектной модели» здесь стоял листинг с двумя ловушками и комментарием «и так все
 * тринадцать» — исполнить его было нельзя. Теперь handler собирается циклом по `Reflect`:
 * у него ровно тринадцать функций с именами ловушек (тест сверяет и число, и имена).
 * Эту строку исполняет демо-пульт (`widgets/proxy-traps/model/run.ts`) и тест.
 */
export const TRACE_CODE = `function trace(target) {
  const log = [];
  const handler = {};
  // у Reflect ровно тринадцать функций — по одной на ловушку
  for (const name of Object.getOwnPropertyNames(Reflect)) {
    handler[name] = (...args) => {
      log.push(name);                // отметиться в журнале
      return Reflect[name](...args); // и сделать то, что сделал бы движок
    };
  }
  return { p: new Proxy(target, handler), log };
}

const { p, log } = trace({ name: 'Аня', age: 29 });
p.name;    // 'Аня'
log;       // ['get']`;

export const PROXY_HANDLER_NOTE =
  'Ловушка — функция в handler’е, которую движок зовёт **вместо** внутреннего метода. Это не «обработчик события»: событие можно не слушать, а ловушку обойти нельзя — она и есть операция. `Reflect` рядом делает то, что сделал бы движок без прокси. Так ловушка перехватывает операцию, не отменяя её.';

/**
 * `Reflect` — вторая половина пары. Перенесено из «Объектной модели» (там стояло отдельным
 * подразделом); правка одна — карточка про `new.target` ссылается на тему по адресу.
 */
export const REFLECT_PAIRS = [
  {
    k: 'тринадцать и тринадцать',
    d: 'У `Reflect` ровно столько же функций, сколько у прокси ловушек, и имена совпадают один в один. Это не удобство, а устройство: `Reflect.X` выполняет внутренний метод так, как он работал бы без перехвата. Поэтому ловушка, которая «ничего не меняет», пишется механически: `get: (t, k, r) => Reflect.get(t, k, r)`.',
  },
  {
    k: 'возвращает, а не бросает',
    d: '`Reflect.set` и `Reflect.defineProperty` отдают `boolean`, а `Object.defineProperty` при отказе бросает. Причина та же: внутренние методы возвращают признак успеха, а не исключение. Отсюда и требование к ловушке `set` вернуть `boolean` — `Reflect.set` отдаёт его сам.',
  },
  {
    k: 'receiver третьим аргументом',
    d: 'Только `Reflect.get(target, key, receiver)` умеет сказать, **от чьего имени** идёт чтение. Без него геттер, найденный в прототипе, получит в `this` цель, а не исходный объект. Это самая частая ошибка с прокси — ей посвящён раздел «Receiver».',
  },
  {
    k: '`Reflect.ownKeys` — это `[[OwnPropertyKeys]]`',
    d: 'Не «удобная обёртка над двумя вызовами», а прямой вызов внутреннего метода. Поэтому он единственный отвечает на вопрос «какие ключи есть у объекта» полностью: строки, символы и неперечисляемые сразу.',
  },
  {
    k: '`Reflect.construct` и `new.target`',
    d: 'Единственный способ вызвать конструктор, подставив `new.target` отличным от него самого. Прототип нового объекта берётся из `new.target.prototype` (шаги `new` — в [«Объектной модели», раздел «Модель»](/js/object-model/#s1)), значит через `Reflect.construct` можно создать экземпляр одного класса с прототипом другого.',
  },
  {
    k: 'не функция и не конструктор',
    d: '`Reflect` нельзя вызвать и нельзя применить с `new`: у него нет ни `[[Call]]`, ни `[[Construct]]`. Это пространство имён, как `Math`. Отдельная польза у `Reflect.apply`: он работает, даже если у функции переопределён `apply`.',
  },
];

export const REFLECT_NOTE =
  'Пара «ловушка ↔ `Reflect`» — то, чем прокси отличается от подмены свойств. Подменяя свойство, вы обязаны сами восстановить исходное поведение и почти наверняка ошибётесь в receiver. Вызывая `Reflect`, вы получаете поведение по умолчанию целиком и правите ровно то, что собирались.';

// ─── Раздел 2 · тринадцать ловушек ─────────────────────────────────────────────────────────

/**
 * Тринадцать ловушек и операции, которые их вызывают.
 *
 * Ни одна клетка не набрана по памяти: тест (блок «тринадцать ловушек») исполняет каждую
 * операцию из `ops` над прокси `trace(...)` и требует, чтобы ловушка `trap` была в журнале.
 * `fn: true` — цель функция (ловушки `apply` и `construct` бывают только у таких прокси).
 * Операция записана так, как её исполняет тест: телом функции от `p`.
 */
export interface TrapRow {
  trap: string;
  method: string;
  ops: string[];
  fn?: boolean;
  note: string;
}

export const TRAP_ROWS: TrapRow[] = [
  {
    trap: 'get',
    method: '[[Get]]',
    ops: ['p.x', "p['x']", 'Object.create(p).x', '`${p}`'],
    note: 'Любое чтение, в том числе через наследника: у `Object.create(p)` нет своего `x`, поиск уходит в прототип — в прокси. Шаблонная строка читает `Symbol.toPrimitive`, `toString` и `Symbol.toStringTag` — три вызова `get`.',
  },
  {
    trap: 'set',
    method: '[[Set]]',
    ops: ['p.x = 2', 'p.x++', 'Object.create(p).y = 1'],
    note: '`p.x++` — это `get`, затем `set`. Запись в наследника тоже приходит в прокси: присваивание ищет в цепочке, нет ли там сеттера или запрета.',
  },
  {
    trap: 'has',
    method: '[[HasProperty]]',
    ops: ["'x' in p", "Reflect.has(p, 'x')", "'x' in Object.create(p)"],
    note: 'Оператор `in` и всё, что спрашивает «есть ли ключ в цепочке». `Object.hasOwn` сюда не приходит: он спрашивает про собственное свойство.',
  },
  {
    trap: 'deleteProperty',
    method: '[[Delete]]',
    ops: ['delete p.x', "Reflect.deleteProperty(p, 'x')"],
    note: 'Только `delete`. Присваивание `undefined` удалением не считается — это `set`.',
  },
  {
    trap: 'ownKeys',
    method: '[[OwnPropertyKeys]]',
    ops: ['Reflect.ownKeys(p)', 'Object.getOwnPropertyNames(p)', 'Object.keys(p)', 'for (const k in p) {}', '({ ...p })'],
    note: 'Всё, что перечисляет ключи. Но `Object.keys`, `for…in` и спред спрашивают ещё и дескриптор каждого ключа, чтобы отсеять неперечисляемые.',
  },
  {
    trap: 'getOwnPropertyDescriptor',
    method: '[[GetOwnProperty]]',
    ops: ["Object.getOwnPropertyDescriptor(p, 'x')", "Object.hasOwn(p, 'x')", 'Object.keys(p)', 'p.x = 2'],
    note: 'Самая «невидимая» ловушка. Её зовут `Object.hasOwn`, перебор ключей — на каждый ключ — и даже обычное присваивание: `Reflect.set` возвращается в прокси узнать, есть ли уже такое свойство.',
  },
  {
    trap: 'defineProperty',
    method: '[[DefineOwnProperty]]',
    ops: ["Object.defineProperty(p, 'y', { value: 1 })", 'p.x = 2', 'Object.freeze(p)'],
    note: 'Явное определение свойства, заморозка — и снова присваивание: запись в итоге создаёт или меняет свойство через `[[DefineOwnProperty]]` получателя, а получатель — прокси.',
  },
  {
    trap: 'getPrototypeOf',
    method: '[[GetPrototypeOf]]',
    ops: ['Object.getPrototypeOf(p)', 'p instanceof Object', 'Object.prototype.isPrototypeOf(p)', 'for (const k in p) {}'],
    note: '`instanceof` идёт по цепочке прототипов и спрашивает её у прокси. `for…in` — тоже: ему нужны и унаследованные ключи.',
  },
  {
    trap: 'setPrototypeOf',
    method: '[[SetPrototypeOf]]',
    ops: ['Object.setPrototypeOf(p, null)', 'Reflect.setPrototypeOf(p, null)'],
    note: 'Смена прототипа. Присваивание `p.__proto__ = …` сначала приходит в `set`: `__proto__` — аксессор на `Object.prototype`, а не синтаксис.',
  },
  {
    trap: 'isExtensible',
    method: '[[IsExtensible]]',
    ops: ['Object.isExtensible(p)', 'Object.isFrozen(p)', 'Object.isSealed(p)'],
    note: '`isFrozen` и `isSealed` начинают с вопроса «можно ли добавлять ключи» — и на `true` дальше не идут.',
  },
  {
    trap: 'preventExtensions',
    method: '[[PreventExtensions]]',
    ops: ['Object.preventExtensions(p)', 'Object.seal(p)', 'Object.freeze(p)'],
    note: 'Все три замка начинают с запрета новых ключей, потом проходят по существующим.',
  },
  {
    trap: 'apply',
    method: '[[Call]]',
    ops: ['p()', 'p.call(null)', 'Reflect.apply(p, null, [])'],
    fn: true,
    note: 'Только у прокси над функцией. `p.call(null)` — сначала `get` за методом `call`, потом сам вызов.',
  },
  {
    trap: 'construct',
    method: '[[Construct]]',
    ops: ['new p()', 'Reflect.construct(p, [])', 'new (class extends p {})()'],
    fn: true,
    note: '`new` и `super()` в наследнике. После `construct` приходит ещё `get` за `prototype`: `new.target` — сам прокси, и прототип нового объекта читается у него.',
  },
];

export const TRAP_TABLE: string[][] = TRAP_ROWS.map((r) => [
  r.trap,
  `\`${r.method}\``,
  r.ops.map((o) => `\`${o}\``).join(' · '),
  r.note,
]);

export const TRAP_TABLE_NOTE =
  'Ловушек ровно тринадцать: по одной на каждый внутренний метод обычного объекта и ещё две, `apply` и `construct`, — для объекта-функции. Ловушки `enumerate` больше нет: её удалили в ES2016, и статьи про «четырнадцать ловушек» описывают язык, которого уже не существует.';

/** Общая цель пульта — выражение, его исполняет `runOp` для операций без своей `target`. */
export const PROXY_TARGET = "{ name: 'Аня', age: 29 }";

/**
 * Пятнадцать операций пульта. Перенесены из «Объектной модели» с четырьмя правками ради того,
 * чтобы демо считало само (`widgets/proxy-traps/model/run.ts`), а не листало литерал:
 *
 *   p.age = 30          результат `30` вместо `true`: значение присваивания — присвоенное,
 *                       а `true` — то, что вернула ловушка `set`, его видно в подписи;
 *   for…in              подпись дописана до `keys.push(k)`, результат — массив ключей;
 *   p.inc(), p.get('a') у операций своя цель (`target`): класс с `#n` и `Map`. Раньше это были
 *                       «p» и «pm» без кода, который их создаёт.
 *   Object.freeze       ⚠️ порядок исправлен: было «getOwnPropertyDescriptor × 2, затем
 *                       defineProperty × 2», движок (и спецификация, SetIntegrityLevel) идёт
 *                       по ключам парами: дескриптор, определение, дескриптор, определение.
 *                       Число вызовов (шесть) было верным — старая проверка считала только его
 *                       и виды ловушек, порядок не сверялся. Нашлось, когда демо стало считать само.
 *
 * Последовательности ловушек сняты handler’ом `TRACE_CODE`; тест (блок «пульт ловушек»)
 * прогоняет каждую строку тем же `runOp`, что и демо, и сверяет `traps` и `res`.
 *
 * История из «Объектной модели»: четыре строки там когда-то разошлись с оригиналом — все
 * в сторону «ловушек больше, чем кажется» (`p.age = 30` — три, а не одна; у `JSON.stringify`
 * первая ловушка `get("toJSON")`; у `for…in` `getPrototypeOf` сразу после `ownKeys`;
 * `Object.freeze` — шесть вызовов).
 */
export const PROXY_OPS: ProxyOp[] = [
  {
    op: 'p.name',
    traps: [{ name: 'get', note: "(target, 'name', p) → Reflect.get" }],
    res: "'Аня'",
    note: 'Базовый случай. Ловушка получает третьим аргументом receiver — его обязательно пробрасывать в `Reflect.get`.',
  },
  {
    op: 'p.missing',
    traps: [{ name: 'get', note: 'ловушка вызвана и для несуществующего ключа' }],
    res: 'undefined',
    note: 'В этом и разница с `defineProperty`: прокси знает о ключах, которых нет. Отсюда Vue 3 без `Vue.set`.',
  },
  {
    op: 'p.age = 30',
    traps: [
      { name: 'set', note: 'обязана вернуть boolean' },
      { name: 'getOwnPropertyDescriptor', note: 'сюда вернул Reflect.set — receiver это сам прокси' },
      { name: 'defineProperty', note: 'и запись тоже пошла обратно через прокси' },
    ],
    res: '30',
    tone: 'warn',
    note: 'Три ловушки вместо одной, и это сюрприз даже для тех, кто прокси пишет. `Reflect.set(t, k, v, receiver)` получает `receiver === p`, а спецификация при `receiver !== target` обязана идти через `[[GetOwnProperty]]` и `[[DefineOwnProperty]]` получателя — то есть обратно в ваш handler. Хотите одну ловушку — пишите `target[k] = v` вручную, ценой потери правильного поведения с наследованием. И не забудьте `return`: `undefined` — ложное значение, а это `TypeError` в строгом режиме, то есть в любом модуле и любом классе.',
  },
  {
    op: "'name' in p",
    traps: [{ name: 'has' }],
    res: 'true',
    note: 'Оператор `in` — это внутренний метод `[[HasProperty]]`, а не сахар над чтением.',
  },
  {
    op: 'delete p.age',
    traps: [{ name: 'deleteProperty' }],
    res: 'true',
    note: 'Не может сообщить об успехе для неконфигурируемого свойства — сработает инвариант.',
  },
  {
    op: 'Object.keys(p)',
    traps: [
      { name: 'ownKeys', note: 'получить список ключей' },
      { name: 'getOwnPropertyDescriptor', times: 2, note: 'на каждый ключ — отфильтровать неперечисляемые' },
    ],
    res: "['name', 'age']",
    note: 'Две ловушки на один вызов, а не одна. Прокси с `ownKeys`, но без `getOwnPropertyDescriptor` часто отдаёт пустоту: дескрипторов на target нет, фильтр их и вырезает.',
  },
  {
    op: 'JSON.stringify(p)',
    traps: [
      { name: 'get', note: 'сначала toJSON — про эту ловушку забывают' },
      { name: 'ownKeys' },
      { name: 'getOwnPropertyDescriptor', times: 2 },
      { name: 'get', times: 2, note: 'значение каждого ключа' },
    ],
    res: '\'{"name":"Аня","age":29}\'',
    tone: 'warn',
    note: 'Шесть обращений к handler’у на одну сериализацию. Первым делом спрашивается `toJSON` — и если он у target есть, всё сворачивается в одну ловушку, остального не будет вовсе. Дорогие геттеры здесь выстрелят по разу на ключ.',
  },
  {
    op: 'for (const k in p) keys.push(k)',
    code: 'const keys = [];\nfor (const k in p) keys.push(k);\nreturn keys;',
    traps: [
      { name: 'ownKeys' },
      { name: 'getPrototypeOf', note: 'сразу после ownKeys — обойти цепочку' },
      { name: 'getOwnPropertyDescriptor', times: 2 },
    ],
    res: "['name', 'age']",
    note: 'Ловушки `enumerate` не существует — её удалили в ES2016. `for…in` собирает ключи из `ownKeys`, цепочку берёт у `getPrototypeOf`, а перечисляемость проверяет дескриптором.',
  },
  {
    op: 'p instanceof Object',
    traps: [{ name: 'getPrototypeOf' }],
    res: 'true',
    note: '`instanceof` читает цепочку — значит проходит через ловушку `getPrototypeOf`.',
  },
  {
    op: 'Object.freeze(p)',
    traps: [
      { name: 'preventExtensions' },
      { name: 'ownKeys' },
      { name: 'getOwnPropertyDescriptor', note: 'ключ name: какой он сейчас' },
      { name: 'defineProperty', note: 'name: writable: false, configurable: false' },
      { name: 'getOwnPropertyDescriptor', note: 'то же для age' },
      { name: 'defineProperty' },
    ],
    res: 'p',
    tone: 'warn',
    note: 'Шесть вызовов: сначала запрет новых ключей, потом по каждому ключу пара «спросить дескриптор — переопределить». Обратная ситуация — прокси над замороженным объектом — почти бессмысленна: инварианты заставят отвечать правду. Отдельно: `Object.isFrozen(p)` — это ещё одна ловушка `isExtensible`.',
  },
  {
    op: 'p === target',
    traps: [],
    res: 'false',
    tone: 'err',
    note: 'Сравнение по ссылке — не внутренний метод. Прокси всегда отдельный объект. Отсюда классический баг: положили в `Set` оригинал, ищете прокси — не находите.',
  },
  {
    op: 'typeof p',
    traps: [],
    res: "'object'",
    tone: 'warn',
    note: '`typeof` не перехватывается. Над функцией даст `function`, над объектом — `object`, изменить нельзя.',
  },
  {
    op: 'structuredClone(p)',
    traps: [],
    res: 'DataCloneError',
    tone: 'err',
    note: 'Ни одной ловушки: клонирование отвергает прокси до всякого обращения к нему. Почему — в разделе «Личность и слоты». Живая проблема Vue 3: `reactive(obj)` нельзя отправить в воркер или в IndexedDB, лечится `toRaw(state)`.',
  },
  {
    op: 'p.inc()  // внутри this.#n',
    target: 'new (class Counter { #n = 0; inc() { return ++this.#n; } })()',
    traps: [{ name: 'get', note: 'вернула функцию inc, и на этом всё' }],
    res: 'TypeError',
    tone: 'err',
    note: 'Вызов записан как `p.inc()`, значит `this === p`. Слот `#n` есть только у target: «Cannot read private member #n from an object whose class did not declare it». Приватные поля не проходят ни через один внутренний метод.',
  },
  {
    op: "p.get('a')  // target — Map",
    target: "new Map([['a', 1]])",
    traps: [{ name: 'get', note: 'вернула Map.prototype.get' }],
    res: 'TypeError',
    tone: 'err',
    note: '«Method Map.prototype.get called on incompatible receiver». Та же природа: методы `Map` читают слот `[[MapData]]` у `this`, а `this` — прокси. Vue 3 решает это отдельными обработчиками для коллекций, вручную проксируя каждый метод.',
  },
];

export const PROXY_DEMO_NOTE =
  'Одна строка кода — не всегда одна ловушка. `p.age = 30` проходит через `set`, а потом `Reflect.set` возвращается в прокси за `getOwnPropertyDescriptor` и `defineProperty`. `Object.keys(p)` зовёт `ownKeys` и `getOwnPropertyDescriptor` на каждый ключ. А пять последних операций показывают обратное: есть вещи, которые прокси не перехватит никогда.';

// ─── Раздел 3 · receiver ───────────────────────────────────────────────────────────────────

export const PLAIN_RECEIVER =
  'Секретарь передаёт хозяину просьбу «покажи своё имя». Если он не скажет, **от кого** просьба, хозяин назовёт своё имя. Если скажет «от Оли, у неё своя табличка» — хозяин прочитает табличку Оли. Receiver и есть это «от кого».';

/**
 * Исполняемый вариант бывшего фрагмента из двух `return` подряд (в «Объектной модели» он
 * был иллюстрацией и исполниться не мог). Тест выполняет строку и сверяет оба комментария.
 */
export const RECEIVER_CODE = `const target = {
  name: 'Аня',
  get label() { return 'я ' + this.name; },
};

const lost = new Proxy(target, {
  get: (t, key) => Reflect.get(t, key),                     // ✗
});
const kept = new Proxy(target, {
  get: (t, key, receiver) => Reflect.get(t, key, receiver), // ✓
});

const a = Object.create(lost); a.name = 'Оля';
const b = Object.create(kept); b.name = 'Оля';

a.label;   // 'я Аня' — геттер получил this = target
b.label;   // 'я Оля' — this = b, как и без прокси`;

export const RECEIVER_NOTE =
  'Без третьего аргумента `Reflect.get` зовёт геттер с `this = target`, и наследник читает чужие данные. Во Vue 3 та же ошибка выглядит иначе: вычисляемое свойство читает «сырой» объект, зависимость не записывается, компонент молча не перерисовывается. Это видно в демо раздела «Реактивность».';

export const SET_BOOL_CODE = `'use strict';
const p = new Proxy({}, { set() { /* забыли return */ } });
p.x = 1;
// TypeError: 'set' on proxy: trap returned falsish for property 'x'`;

export const SET_BOOL_NOTE =
  'Модули и тела классов всегда строгие, так что это `TypeError` на каждом присваивании. В нестрогом скрипте запись молча не произойдёт. `Reflect.set` возвращает нужный `boolean` сам — поэтому ловушку пишут как `return Reflect.set(…)`.';

// ─── Раздел 4 · инварианты ─────────────────────────────────────────────────────────────────

/**
 * Инварианты по каждой ловушке — таблица, которую не набирали, а прогнали. Перенесена
 * из «Объектной модели» без изменений.
 *
 * У каждой строки исполнимое нарушение: `target`, `handler` и `op` склеиваются
 * в `new Proxy(target, handler)` и выполняются тестом (блок «инварианты по каждой ловушке»).
 * Тест требует двух вещей сразу: нарушение даёт `TypeError`, а **тот же handler** над
 * `control` — там, где он задан, — проходит. Без второй половины проверка не отличила бы
 * «сработал инвариант» от «handler сломан сам по себе».
 *
 * `control` нет у строк, где запрет не зависит от target: он действует всегда.
 * Ловушка `apply` в таблице отсутствует намеренно: инвариантов у неё нет вовсе.
 */
export interface InvariantRow {
  trap: string;
  rule: string;
  target: string;
  handler: string;
  op: string;
  control?: string;
}

export const INVARIANT_ROWS: InvariantRow[] = [
  {
    trap: 'getPrototypeOf',
    rule: 'у нерасширяемого target — только его настоящий прототип',
    target: 'Object.preventExtensions({})',
    handler: '{ getPrototypeOf: () => Array.prototype }',
    op: 'Object.getPrototypeOf(p)',
    control: '{}',
  },
  {
    trap: 'getPrototypeOf',
    rule: 'всегда — объект или `null`',
    target: '{}',
    handler: '{ getPrototypeOf: () => 42 }',
    op: 'Object.getPrototypeOf(p)',
  },
  {
    trap: 'setPrototypeOf',
    rule: 'нерасширяемому нельзя «успешно» сменить прототип',
    target: 'Object.preventExtensions({})',
    handler: '{ setPrototypeOf: () => true }',
    op: 'Object.setPrototypeOf(p, Array.prototype)',
    control: '{}',
  },
  {
    trap: 'isExtensible',
    rule: 'ответ обязан совпасть с target',
    target: '{}',
    handler: '{ isExtensible: () => false }',
    op: 'Object.isExtensible(p)',
    control: 'Object.preventExtensions({})',
  },
  {
    trap: 'preventExtensions',
    rule: '`true` — только если target действительно заперт',
    target: '{}',
    handler: '{ preventExtensions: () => true }',
    op: 'Object.preventExtensions(p)',
    control: 'Object.preventExtensions({})',
  },
  {
    trap: 'getOwnPropertyDescriptor',
    rule: 'не спрятать неконфигурируемое свойство',
    target: 'Object.freeze({ x: 1 })',
    handler: '{ getOwnPropertyDescriptor: () => undefined }',
    op: "Object.getOwnPropertyDescriptor(p, 'x')",
    control: '{ x: 1 }',
  },
  {
    trap: 'getOwnPropertyDescriptor',
    rule: 'не выдать изменяемое за «только чтение и навсегда»',
    target: "Object.defineProperty({}, 'x', { value: 1, writable: true })",
    handler: '{ getOwnPropertyDescriptor: () => ({ value: 1, writable: false, configurable: false }) }',
    op: "Object.getOwnPropertyDescriptor(p, 'x')",
    control: "Object.defineProperty({}, 'x', { value: 1 })",
  },
  {
    trap: 'defineProperty',
    rule: 'нерасширяемому не «добавить» ключ',
    target: 'Object.preventExtensions({})',
    handler: '{ defineProperty: () => true }',
    op: "Object.defineProperty(p, 'x', { value: 1 })",
    control: '{}',
  },
  {
    trap: 'has',
    rule: 'не спрятать неконфигурируемое свойство',
    target: 'Object.freeze({ x: 1 })',
    handler: '{ has: () => false }',
    op: "'x' in p",
    control: '{ x: 1 }',
  },
  {
    trap: 'has',
    rule: 'у нерасширяемого target — не спрятать **никакое**',
    target: 'Object.preventExtensions({ x: 1 })',
    handler: '{ has: () => false }',
    op: "'x' in p",
    control: '{ x: 1 }',
  },
  {
    trap: 'get',
    rule: 'неизменяемое и неконфигурируемое — ровно значение target',
    target: 'Object.freeze({ x: 1 })',
    handler: '{ get: () => 2 }',
    op: 'p.x',
    control: '{ x: 1 }',
  },
  {
    trap: 'get',
    rule: 'неконфигурируемый аксессор без геттера — только `undefined`',
    target: "Object.defineProperty({}, 'x', { set() {} })",
    handler: '{ get: () => 2 }',
    op: 'p.x',
    control: "Object.defineProperty({}, 'x', { set() {}, configurable: true })",
  },
  {
    trap: 'set',
    rule: 'не «записать» в неизменяемое и неконфигурируемое',
    target: 'Object.freeze({ x: 1 })',
    handler: '{ set: () => true }',
    op: 'p.x = 2',
    control: '{ x: 1 }',
  },
  {
    trap: 'set',
    rule: 'не «записать» в неконфигурируемый аксессор без сеттера',
    target: "Object.defineProperty({}, 'x', { get() { return 1; } })",
    handler: '{ set: () => true }',
    op: 'p.x = 2',
    control: "Object.defineProperty({}, 'x', { get() { return 1; }, configurable: true })",
  },
  {
    trap: 'deleteProperty',
    rule: 'не «удалить» неконфигурируемое свойство',
    target: 'Object.freeze({ x: 1 })',
    handler: '{ deleteProperty: () => true }',
    op: 'delete p.x',
    control: '{ x: 1 }',
  },
  {
    trap: 'deleteProperty',
    rule: 'у нерасширяемого target — не «удалить» **никакое** свойство',
    target: 'Object.preventExtensions({ x: 1 })',
    handler: '{ deleteProperty: () => true }',
    op: 'delete p.x',
    control: '{ x: 1 }',
  },
  {
    trap: 'ownKeys',
    rule: 'включить все неконфигурируемые ключи',
    target: 'Object.freeze({ x: 1 })',
    handler: '{ ownKeys: () => [] }',
    op: 'Reflect.ownKeys(p)',
    control: '{ x: 1 }',
  },
  {
    trap: 'ownKeys',
    rule: 'у нерасширяемого target — ровно его ключи, без лишних',
    target: 'Object.preventExtensions({})',
    handler: "{ ownKeys: () => ['y'] }",
    op: 'Reflect.ownKeys(p)',
    control: '{}',
  },
  {
    trap: 'ownKeys',
    rule: 'всегда — без повторов, только строки и символы',
    target: '{}',
    handler: "{ ownKeys: () => ['a', 'a'] }",
    op: 'Reflect.ownKeys(p)',
  },
  {
    trap: 'construct',
    rule: 'всегда — объект',
    target: 'function () {}',
    handler: '{ construct: () => 1 }',
    op: 'new p()',
  },
];

/** Та же таблица в виде строк для `Table`: нарушение печатается тремя частями, как его собирает тест. */
export const INVARIANT_TABLE: string[][] = INVARIANT_ROWS.map((row) => [
  row.trap,
  row.rule,
  `\`${row.target}\` · \`${row.handler}\` · \`${row.op}\``,
]);

export const INVARIANTS_NOTE =
  '**Практический вывод:** хотите от ловушек свободы — держите target максимально открытым, а лучше пустым `{}`, если данные лежат отдельно. Чем больше на target запретов, тем меньше прокси может отвечать по-своему: каждый запрет движок проверит и на расхождении бросит `TypeError`.';

// ─── Раздел 5 · личность и слоты ───────────────────────────────────────────────────────────

/** Строка консоли: выражение и ответ движка. `out` сверяет тест, исполняя `expr` после `setup`. */
export interface Probe {
  expr: string;
  out: string;
  why: string;
}

/** Листинг «как в консоли»: подготовка, затем выражения с ответами в комментариях. */
function listing(setup: string, probes: Probe[]): string {
  const width = Math.max(...probes.map((p) => p.expr.length));
  return `${setup}\n\n${probes.map((p) => `${p.expr.padEnd(width)}  // ${p.out}`).join('\n')}`;
}

export const IDENTITY_SETUP = `const target = { name: 'Аня' };
const p = new Proxy(target, {});        // пустой handler: всё «как было»
const list = new Proxy([1, 2], {});
const fn = new Proxy(function () {}, {});
const date = new Proxy(new Date(0), {});
const seen = new WeakMap([[target, 'метка']]);`;

/**
 * Что прокси пропускает к цели, а что нет. Каждую строку тест исполняет после
 * `IDENTITY_SETUP` и сверяет ответ (`formatValue` из `widgets/proxy-traps/model/run.ts`;
 * брошенная ошибка — её имя).
 */
export const IDENTITY_PROBES: Probe[] = [
  { expr: 'p === target', out: 'false', why: 'Прокси — отдельный объект со своей ссылкой. Сравнение ссылок не внутренний метод, перехватывать нечего.' },
  { expr: 'seen.get(p)', out: 'undefined', why: '`Map`, `Set`, `WeakMap` ищут ключ по ссылке. Записали под целью — под прокси не найдёте, и наоборот.' },
  { expr: 'typeof fn', out: "'function'", why: '`typeof` смотрит, есть ли у объекта `[[Call]]`. У прокси он есть ровно тогда, когда есть у цели, — подделать нельзя.' },
  { expr: 'Array.isArray(list)', out: 'true', why: 'Единственная проверка, которая заглядывает сквозь прокси: алгоритм `IsArray` в спецификации сам спрашивает цель.' },
  { expr: 'JSON.stringify(list)', out: "'[1,2]'", why: 'Сериализация решает «массив или объект» тем же `IsArray`, поэтому прокси над массивом уходит в JSON массивом.' },
  { expr: 'Object.prototype.toString.call(list)', out: "'[object Array]'", why: 'Тег `Array` тоже берётся через `IsArray`.' },
  { expr: 'Object.prototype.toString.call(date)', out: "'[object Object]'", why: 'А тег `Date` берётся из слота `[[DateValue]]` самого объекта. У прокси такого слота нет — и `Date` превратился в `Object`.' },
  { expr: 'date.getTime()', out: 'TypeError', why: 'Метод `Date` читает `[[DateValue]]` у `this`, а `this` — прокси. Так же падают методы `Map`, `Set`, `Promise`, `RegExp`.' },
];

export const IDENTITY_CODE = listing(IDENTITY_SETUP, IDENTITY_PROBES);

export const IDENTITY_NOTE =
  'Правило одно: прокси перехватывает **внутренние методы** и только их. Всё, что работает со ссылкой (`===`, ключи коллекций) или со слотом объекта (`Date`, `Map`, `#`-поля), проходит мимо handler’а — и упирается в сам прокси, у которого слотов цели нет.';

export const PRIVATE_SETUP = `class Counter {
  #n = 0;
  inc() { return ++this.#n; }
  static owns(obj) { return #n in obj; }
}
const c = new Counter();
const p = new Proxy(c, {});

// обход: метод зовётся с this = цель
const bound = new Proxy(c, {
  get(t, key) {
    const v = Reflect.get(t, key);
    return typeof v === 'function' ? v.bind(t) : v;
  },
});`;

/** Порядок важен: строки исполняются подряд над одним `c`, счётчик растёт. */
export const PRIVATE_PROBES: Probe[] = [
  { expr: 'p.inc()', out: 'TypeError', why: '«Cannot read private member #n from an object whose class did not declare it». `this` в методе — прокси, а слот `#n` записан в `c`.' },
  { expr: 'Counter.owns(p)', out: 'false', why: 'Проверка `#n in obj` смотрит слот самого объекта. Прокси его не проходит — для класса это чужой объект.' },
  { expr: 'c.inc()', out: '1', why: 'Сам объект в порядке: ломается только вызов через прокси.' },
  { expr: 'bound.inc()', out: '2', why: 'Метод, привязанный к цели, читает слот у `c`. Цена: всё, что метод делает с `this`, идёт мимо ловушек.' },
];

export const PRIVATE_CODE = listing(PRIVATE_SETUP, PRIVATE_PROBES);

/** Все три факта проверены тестом (блок «#-поля сквозь прокси»). */
export const PRIVATE_FACTS = [
  {
    t: 'Почему не помогает никакая ловушка',
    d: 'Доступ `this.#n` — не внутренний метод, а прямое обращение к списку приватных элементов объекта в `this`. Handler его не видит, поэтому и перехватить, и «пробросить» нечего. Ловушка `get` успевает отдать функцию `inc`, а падает уже сам вызов.',
    tone: 'err' as const,
  },
  {
    t: 'Привязка к цели — обход с ценой',
    d: 'Ловушка `get`, которая отдаёт методы через `bind(target)`, лечит `#`-поля. Но внутри метода `this.count++` пойдёт прямо в цель: реактивная библиотека этого чтения не увидит. Поэтому Vue так не делает и честно предупреждает, что класс с `#`-полями реактивным не станет.',
    tone: 'warn' as const,
  },
  {
    t: 'Поле может жить и на самом прокси',
    d: 'Если базовый класс возвращает из конструктора `new Proxy(this, {})`, наследник получает в `this` этот прокси — и его `#`-поля записываются **прямо на прокси**. Тогда методы наследника через прокси работают. Приватный слот бывает у любого объекта, который прошёл через конструктор, и прокси — не исключение.',
    tone: 'info' as const,
  },
];

export const CLONE_SETUP = `const state = new Proxy({ n: 1 }, {});`;

export const CLONE_PROBES: Probe[] = [
  { expr: 'structuredClone(state)', out: 'DataCloneError', why: 'Сам прокси — отказ.' },
  { expr: 'structuredClone({ inner: state })', out: 'DataCloneError', why: 'Прокси где-то внутри — тоже отказ: алгоритм обходит граф целиком.' },
  { expr: 'structuredClone({ ...state }).n', out: '1', why: 'Спред читает ключи через ловушки и складывает их в обычный объект — а его клонировать можно.' },
];

export const CLONE_CODE = listing(CLONE_SETUP, CLONE_PROBES);

/**
 * Шаги алгоритма — по тексту HTML (StructuredSerializeInternal): «value has any internal slot
 * other than [[Prototype]], [[Extensible]], or [[PrivateElements]]» и «value is an exotic object».
 * Номера шагов в тексте не названы намеренно — они сдвигаются от редакции к редакции.
 */
export const CLONE_NOTE =
  'Алгоритм клонирования из спецификации HTML смотрит на сам объект, а не на его свойства. Прокси — **экзотический объект**: у него свои внутренние методы и два слота, `[[ProxyTarget]]` и `[[ProxyHandler]]`. Алгоритм отказывает любому объекту со слотами, которых не знает, и любому экзотическому, кроме массива, — до того, как прочитает хоть одно свойство. Поэтому журнал ловушек пуст. Тот же алгоритм стоит за `postMessage` и записью в IndexedDB, и все три бросают `DataCloneError` (в браузере это `DOMException` с `code` 25). Где это ломает передачу сообщений, разобрано в [«MessageChannel», раздел «Transfer»](/js/message-channel/#s3).';

export const CLONE_FIX_NOTE =
  'Лечение — отдать алгоритму данные, а не прокси. Во Vue это `toRaw(state)` — исходный объект, который прокси оборачивает. В Immer — `current(draft)`, копия черновика на этот момент. Вручную — спред или `JSON.parse(JSON.stringify(…))`, если хватает плоских данных.';

/**
 * Песочница: листинги, которые читатель запускает и правит сам. Код уходит в воркер
 * (`features/run-snippet/lib/worker.ts`): без `import`/`export`, объекты печатать строками.
 * «Потерянный receiver» переехал из песочницы «Объектной модели». Все четыре исполняет тест
 * (блок «песочница») и сверяет вывод с обещанием в `note`.
 */
export const LAB_SNIPPETS: Snippet[] = [
  {
    label: 'потерянный receiver',
    code: `const target = {
  name: 'Аня',
  get label() { return 'я ' + this.name; },
};

const p = new Proxy(target, {
  get(t, key, receiver) {
    return Reflect.get(t, key);   // receiver не проброшен
  },
});

const child = Object.create(p);
child.name = 'Оля';

console.log('child.label →', child.label);`,
    note: 'Ожидается «я Оля», а приходит «я Аня»: без третьего аргумента геттер получает в `this` цель, а не исходный объект. Допишите `receiver` в `Reflect.get` — и наследование геттеров снова заработает.',
  },
  {
    label: '#-поле сквозь прокси',
    code: `class Counter {
  #n = 0;
  inc() { return ++this.#n; }
}

const p = new Proxy(new Counter(), {});

try {
  console.log('p.inc() →', p.inc());
} catch (e) {
  console.log('p.inc() →', e.name + ': ' + e.message);
}`,
    note: 'Вызов падает на `this.#n`. Попробуйте в handler’е ловушку `get`, которая возвращает `v.bind(t)` для функций, — и вызов пройдёт.',
  },
  {
    label: 'клон прокси',
    code: `const state = new Proxy({ n: 1, list: [1, 2] }, {});

try {
  structuredClone(state);
} catch (e) {
  console.log('прокси →', e.name);
}

console.log('копия →', JSON.stringify(structuredClone({ ...state })));`,
    note: 'Прокси не клонируется вовсе, а его спред — обычный объект. Замените `{ ...state }` на `{ inner: state }` — и отказ вернётся: алгоритм находит прокси на любой глубине.',
  },
  {
    label: 'что видит прокси',
    code: `const target = [1, 2];
const p = new Proxy(target, {});

console.log('p === target       →', p === target);
console.log('Array.isArray(p)   →', Array.isArray(p));
console.log('new Set([target]).has(p) →', new Set([target]).has(p));
console.log('typeof p           →', typeof p);`,
    note: '`Array.isArray` видит сквозь прокси массив, а `===` и `Set` различают прокси и цель. Замените `[1, 2]` на функцию — и `typeof p` станет `function`.',
  },
];

export const LAB_DEMO_NOTE =
  'Четыре примера, и любой можно переписать. Вывод настоящий, из вашего браузера; кнопка «вернуть пример» отменяет правки.';

// ─── Раздел 6 · реактивность ───────────────────────────────────────────────────────────────

export const PLAIN_REACTIVE =
  'Секретарь не только передаёт просьбы, но и ведёт журнал: «отчёт читал раздел про бюджет». Когда кто-то правит бюджет, секретарь открывает журнал и звонит всем, кто его читал. Журнал — это `track`, звонки — `trigger`, а вести журнал секретарь может только потому, что все просьбы идут через него.';

/**
 * Учебная реактивность на прокси — одна строка, её печатает тема, исполняет демо
 * (`widgets/proxy-reactivity/model/run.ts`) и тест.
 *
 * Тест (блок «реактивность») прогоняет каждый сценарий `REACTIVE_SCENARIOS` этой строкой
 * и `@vue/reactivity` 3.5.42 и требует одинакового вывода эффектов. Вторая проверка — поломка:
 * строка `Reflect.get(target, key, receiver)` подменяется на `target[key]`, и сценарий
 * с геттером перестаёт перезапускаться, а сценарий с `#`-полем — наоборот, начинает работать.
 *
 * `trace` — журнал демо; в сверке с Vue он пустой. Мини-версия намеренно не умеет массивов,
 * коллекций, очистки зависимостей и `computed` — это разобрано в «Vue 3 изнутри».
 */
export const REACTIVE_CODE = `const targetMap = new WeakMap(); // объект → Map(ключ → эффекты)
const proxies = new WeakMap();   // объект → его прокси
const ITERATE = Symbol('перебор'); // «ключ» для ownKeys
let activeEffect = null;         // эффект, который выполняется сейчас

function track(target, key) {
  if (!activeEffect) return;
  trace('track ' + String(key));
  let deps = targetMap.get(target);
  if (!deps) targetMap.set(target, (deps = new Map()));
  let dep = deps.get(key);
  if (!dep) deps.set(key, (dep = new Set()));
  dep.add(activeEffect);
}

function trigger(target, key, type) {
  trace('trigger ' + String(key) + ' · ' + type);
  const deps = targetMap.get(target);
  if (!deps) return;
  const toRun = new Set(deps.get(key));
  // новый или удалённый ключ меняет и список ключей
  if (type !== 'set') deps.get(ITERATE)?.forEach((e) => toRun.add(e));
  toRun.forEach((e) => e());
}

const handler = {
  get(target, key, receiver) {
    track(target, key);
    const value = Reflect.get(target, key, receiver);
    // вложенный объект заворачивается при чтении
    return Object(value) === value ? reactive(value) : value;
  },
  set(target, key, value, receiver) {
    const had = Object.hasOwn(target, key);
    const old = target[key];
    const ok = Reflect.set(target, key, value, receiver);
    if (!had) trigger(target, key, 'add');
    else if (!Object.is(old, value)) trigger(target, key, 'set');
    return ok;
  },
  deleteProperty(target, key) {
    const had = Object.hasOwn(target, key);
    const ok = Reflect.deleteProperty(target, key);
    if (had && ok) trigger(target, key, 'delete');
    return ok;
  },
  has(target, key) {
    track(target, key);
    return Reflect.has(target, key);
  },
  ownKeys(target) {
    track(target, ITERATE);
    return Reflect.ownKeys(target);
  },
};

function reactive(target) {
  let proxy = proxies.get(target);
  if (!proxy) proxies.set(target, (proxy = new Proxy(target, handler)));
  return proxy;
}

function effect(fn) {
  const run = () => {
    const prev = activeEffect;
    activeEffect = run;
    try { fn(); } finally { activeEffect = prev; }
  };
  run();
}`;

/** Строка, которую демо и тест подменяют, чтобы показать «потерянный receiver». */
export const RECEIVER_LINE = 'Reflect.get(target, key, receiver)';
export const RECEIVER_LOST = 'target[key]';

/**
 * Сценарии демо. `out` — вывод эффектов, одинаковый у мини-версии и у Vue 3.5.42;
 * `lost` — вывод мини-версии с `target[key]` вместо `Reflect.get(…, receiver)`.
 * Оба поля сверяет тест.
 */
export const REACTIVE_SCENARIOS: ReactiveScenario[] = [
  {
    id: 'basic',
    label: 'чтение и запись',
    code: `const s = reactive({ n: 1 });
effect(() => log('n = ' + s.n));
s.n = 2;
s.n = 2; // то же значение`,
    out: ['n = 1', 'n = 2'],
    lost: ['n = 1', 'n = 2'],
    note: '`get` записывает в журнал, что эффект читал `n`, `set` по журналу его будит. Вторая запись того же значения тишина: `Object.is` сравнил старое и новое.',
  },
  {
    id: 'keys',
    label: 'новый ключ',
    code: `const s = reactive({ a: 1 });
effect(() => log('ключи: ' + Object.keys(s)));
s.b = 2; // новый ключ
s.a = 5; // старый ключ`,
    out: ['ключи: a', 'ключи: a,b'],
    lost: ['ключи: a', 'ключи: a,b'],
    note: '`Object.keys` не читает ни одного ключа — ловушка `ownKeys` ключа не получает. Поэтому зависимость пишется на выдуманный ключ `ITERATE`, и его будит только **добавление** или удаление. Запись в `a` список ключей не меняет — эффект молчит.',
  },
  {
    id: 'has',
    label: 'in и delete',
    code: `const s = reactive({});
effect(() => log('b есть: ' + ('b' in s)));
s.b = 1;
delete s.b;`,
    out: ['b есть: false', 'b есть: true', 'b есть: false'],
    lost: ['b есть: false', 'b есть: true', 'b есть: false'],
    note: 'Ключа `b` ещё нет, а зависимость от него уже есть: ловушка `has` получила имя. Это то, чего не умел Vue 2 на `defineProperty`, — следить за ключом, которого нет.',
  },
  {
    id: 'getter',
    label: 'геттер',
    code: `const s = reactive({
  first: 'Ада',
  last: 'Лавлейс',
  get full() { return this.first + ' ' + this.last; },
});
effect(() => log(s.full));
s.first = 'Августа';`,
    out: ['Ада Лавлейс', 'Августа Лавлейс'],
    lost: ['Ада Лавлейс'],
    note: 'Геттер читает `this.first`. С receiver `this` — прокси, и оба чтения внутри попадают в журнал. С `target[key]` `this` — сырой объект: журнал видит только `full`, и запись в `first` никого не будит.',
  },
  {
    id: 'nested',
    label: 'вложенный объект',
    code: `const s = reactive({ user: { name: 'Аня' } });
effect(() => log('имя: ' + s.user.name));
s.user.name = 'Оля';
log('одна обёртка: ' + (s.user === s.user));`,
    out: ['имя: Аня', 'имя: Оля', 'одна обёртка: true'],
    lost: ['имя: Аня', 'имя: Оля', 'одна обёртка: true'],
    note: 'Вложенный объект заворачивается в момент чтения, а `WeakMap` `proxies` держит одну обёртку на объект. Без неё каждое `s.user` давало бы новый прокси, и `s.user === s.user` было бы `false`.',
  },
  {
    id: 'private',
    label: '#-поле',
    code: `class Counter {
  #n = 0;
  get n() { return this.#n; }
}
const s = reactive(new Counter());
try {
  effect(() => log(s.n));
} catch (e) {
  log(e.name);
}`,
    out: ['TypeError'],
    lost: ['0'],
    note: 'Обратная сторона receiver: геттер с `this` = прокси не находит слот `#n`. С `target[key]` поле читается — но ценой того, что журнал не видит чтений внутри геттера. Vue выбирает receiver, поэтому экземпляр с `#`-полем реактивным не станет.',
  },
];

/** Утверждения сверены тестом (блок «реактивность»). */
export const REACTIVE_FACTS = [
  {
    t: '`get` и `has` записывают',
    d: 'Каждое чтение внутри эффекта — строка журнала «этот эффект зависит от этого ключа этого объекта». Журнал — `WeakMap` от объекта к `Map` от ключа к набору эффектов, чтобы запись не держала объект в памяти.',
  },
  {
    t: '`set` и `deleteProperty` будят',
    d: 'Запись достаёт из журнала эффекты по ключу и перезапускает их. Ловушка различает «добавил» и «изменил»: от этого зависит, будить ли тех, кто перебирал ключи.',
  },
  {
    t: '`ownKeys` пишет на выдуманный ключ',
    d: 'Перебор не называет ни одного ключа, а следить за ним надо. Поэтому зависимость пишется на символ `ITERATE` — у Vue он называется `ITERATE_KEY`.',
  },
  {
    t: 'Чего здесь нет',
    d: 'Очистки зависимостей перед перезапуском, `computed`, очереди обновлений, массивов (`push` меняет `length` неявно) и коллекций. Всё это на тех же ловушках собрано и сверено с Vue в теме [«Vue 3 изнутри»](/frameworks/vue-internals/).',
  },
];

/**
 * Immer — вторая библиотека на прокси, с другой целью: не следить за чтением, а записать
 * изменения в копию. Пример исполняет тест с настоящим `produce` из `immer` 11.1.18.
 */
export const IMMER_CODE = `const base = { user: { name: 'Аня' }, tags: ['js'] };
let leaked;

const next = produce(base, (draft) => {
  draft.user.name = 'Оля';  // пишем, как в обычный объект
  leaked = draft.user;      // черновик утёк наружу
});

base.user.name;             // 'Аня' — исходник не тронут
next.user.name;             // 'Оля'
next.tags === base.tags;    // true — нетронутое не копируется
// leaked.name → TypeError: Cannot perform 'get'
//               on a proxy that has been revoked`;

export const IMMER_FACTS = [
  {
    t: 'Ловушка `set` пишет в копию',
    d: 'Цель черновика — не ваш объект, а служебная запись Immer со ссылкой на исходник: тот самый «пустой target», при котором инварианты не мешают. Первая запись в объект делает его поверхностную копию, и дальше чтение и запись идут в копию. Объекты, в которые не писали, попадают в результат **теми же ссылками**.',
    tone: 'info' as const,
  },
  {
    t: 'Черновик отзывается',
    d: 'Immer строит черновики через `Proxy.revocable` и в конце `produce` отзывает их все. Сохранённая наружу ссылка на черновик падает на любой операции — это тот же механизм, что у мембраны.',
    tone: 'warn' as const,
  },
  {
    t: 'MobX — третий вариант',
    d: 'MobX строит `observable` на прокси и следит за чтением, как Vue. Запасная реализация без прокси, для старых движков, жила до MobX 6 включительно; в MobX 7 её убрали, и `configure({ useProxies })` больше не поддерживается. Пакета MobX в проекте нет — это по документации, не по запуску.',
    tone: 'dim' as const,
  },
];

// ─── Раздел 7 · мембрана ───────────────────────────────────────────────────────────────────

/**
 * `Proxy.revocable` и мембрана — то, ради чего прокси задуман. Перенесено из «Объектной
 * модели» без изменений.
 *
 * Рабочий эскиз мембраны в одну сторону: всё, что выходит из графа наружу, уходит в обёртке,
 * и один `revoke` гасит все обёртки разом. Промышленные мембраны (экосистема Hardened
 * JavaScript, SES) делают то же в обе стороны — о них здесь только имя, их поведение этой
 * темой не проверялось. Код исполняет тест (блок «мембрана»).
 */
export const MEMBRANE_CODE = `function membrane(root) {
  const revokes = [];
  // один объект — одна обёртка: иначе p.user !== p.user
  const wrappers = new WeakMap();

  function wrap(value) {
    // примитив отзывать незачем: он не ведёт ни к чему
    if (Object(value) !== value) return value;
    if (wrappers.has(value)) return wrappers.get(value);

    const { proxy, revoke } = Proxy.revocable(value, {
      // всё, что выходит наружу, тоже уходит в обёртке
      get: (t, key, receiver) => wrap(Reflect.get(t, key, receiver)),
      apply: (t, self, args) => wrap(Reflect.apply(t, self, args)),
    });

    revokes.push(revoke);
    wrappers.set(value, proxy);
    return proxy;
  }

  return {
    proxy: wrap(root),
    // один рубильник на весь граф
    revoke: () => revokes.forEach((r) => r()),
  };
}

const api = {
  user: { name: 'Аня', greet() { return 'я ' + this.name; } },
};

const m = membrane(api);
const user = m.proxy.user;   // не сам user, а его обёртка

user.greet();                // 'я Аня'
m.proxy.user === user;       // true

m.revoke();
// user.name → TypeError: Cannot perform 'get' on a proxy
//             that has been revoked`;

export const PLAIN_MEMBRANE =
  'Прокси из `Proxy.revocable` — пропуск в здание, который можно аннулировать. Но если гость успел вынести папку, отзыв пропуска папку не вернёт. Мембрана вместо папки выдаёт ещё один пропуск — к папке, и так к каждой вещи, которую гость получает изнутри. Все пропуска висят на одном рубильнике: выключили — и погасло всё, что гость успел набрать.';

/** Все утверждения сверены тестом (блок «мембрана»). */
export const MEMBRANE_FACTS = [
  {
    t: 'Отозванный прокси отказывает во всём',
    d: 'Любая операция, которая идёт во внутренний метод, — `TypeError`: чтение, `in`, `Object.keys`, вызов, даже `Array.isArray` и `Object.prototype.toString.call`. И объект, у которого отозванный прокси стоит прототипом, падает на первом же чтении мимо собственных ключей. Работают только `===` и `typeof` — они внутренних методов не зовут. Повторный `revoke()` ничего не делает.',
    tone: 'err' as const,
  },
  {
    t: 'Почему одной обёртки мало',
    d: 'Отозвать один прокси — значит отобрать одну ссылку. Всё, что через неё успели прочитать, — `p.user` — лежит у получателя голым и отзыву неподвластно. Мембрана заворачивает каждый выходящий объект и результат каждого вызова, а `WeakMap` следит, чтобы у одного объекта была одна обёртка: иначе `m.proxy.user === m.proxy.user` было бы ложно.',
    tone: 'info' as const,
  },
  {
    t: 'Инвариант ломает наивную мембрану',
    d: 'Заверните так замороженный объект — и первое же чтение вложенного даст `TypeError`: ловушка `get` обязана вернуть **ровно** значение неизменяемого свойства, а возвращает обёртку. Настоящие мембраны поэтому проксируют не сам объект, а пустой «теневой» target и держат настоящий в стороне — тот самый совет «держите target пустым».',
    tone: 'warn' as const,
  },
  {
    t: 'Что в эскизе опущено',
    d: 'Обратное направление: аргументы, которые снаружи передают внутрь, здесь не разворачиваются и не заворачиваются, а ловушки `set`, `getPrototypeOf` и остальные не перехвачены. Полная мембрана перехватывает все тринадцать ловушек в обе стороны — поэтому её и пишут библиотекой, а не по месту.',
    tone: 'dim' as const,
  },
];

// ─── Раздел 8 · цена ───────────────────────────────────────────────────────────────────────

/**
 * Замер перенесён из «Объектной модели» вместе с историей (см. там же, у прежнего места;
 * коротко — ниже). Таймерных замеров эта тема заново не делала.
 *
 * Своя функция на каждый случай (общая делает inline cache мегаморфным, и «дорого» становится
 * везде) и кольцо из 256 объектов одной формы (иначе чтение вылетает из цикла как инвариант).
 * Медиана пяти прогонов после двух прогревочных, Node 26.8.2, V8 14.6, Apple M1. Числа
 * оригинального конспекта (10 / 66 / 121 мс, ×6.6 и ×12) не воспроизвелись ни в одном режиме.
 * Отношение, а не миллисекунды, сторожит `tests/unit/cost-invariants.test.ts`.
 */
export const PROXY_COST: CostBar[] = [
  { label: 'прямое чтение поля', value: '10 мс · ×1', ratio: 0.04, tone: 'neutral' },
  { label: 'через геттер', value: '95 мс · ×9.5', ratio: 0.39, tone: 'violet' },
  { label: 'через прокси', value: '242 мс · ×24', ratio: 1, tone: 'amber' },
];

export const PROXY_COST_CAPTION = 'цена · 10⁷ чтений одного свойства · Node 26.8.2, V8 14.6, Apple M1';

export const PROXY_COST_NOTE =
  'Порядок величины — **десятки раз**, не проценты. Для реактивности это приемлемо: обращений к состоянию немного и они не в горячем цикле. Для обхода 100 000 элементов в рендере — нет; тогда берут «сырой» объект без прокси (`toRaw` в Vue) или поверхностную реактивность, следящую только за верхним уровнем. Отдельная деталь замера: `Reflect.get` в ловушке дороже прямого `t[k]` — 242 мс против 177.';

export const PROXY_POLYFILL_NOTE =
  'Прокси **нельзя полифиллить** — перехват произвольных ключей без поддержки движка невозможен в принципе. Это и была настоящая причина, по которой Vue 2 остался на `defineProperty`, а Vue 3 не работает в IE11.';

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

/** Каждый листинг исполняет тест (блок «тонкие места»). */
export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'Прокси и цель — два разных ключа',
    code: "const raw = { id: 1 };\nconst p = new Proxy(raw, {});\nconst selected = new Set([raw]);\n\nselected.has(p);   // false",
    d: 'Коллекции и `===` сравнивают ссылки, а у прокси своя. Баг выглядит как «элемент в списке, а `has` говорит нет»: в одном месте программы лежит сырой объект, в другом — его обёртка. → сравнивать по id или везде держать одно и то же — либо прокси, либо сырой объект (`toRaw` во Vue).',
    tone: 'err',
  },
  {
    n: '02',
    t: 'Ловушка `set` без `return`',
    code: "'use strict';\nconst p = new Proxy({}, {\n  set(t, k, v) { t[k] = v; }   // запись прошла…\n});\np.x = 1;   // …а это TypeError",
    d: 'Значение записано, но ловушка вернула `undefined`, и строгий режим считает запись отказом. В модуле или классе — исключение на каждом присваивании, в старом скрипте — тишина. → `return Reflect.set(t, k, v, r)`.',
    tone: 'err',
  },
  {
    n: '03',
    t: '`ownKeys` без `getOwnPropertyDescriptor`',
    code: "const p = new Proxy({}, {\n  ownKeys: () => ['a', 'b'],\n});\nReflect.ownKeys(p);   // ['a', 'b']\nObject.keys(p);       // []",
    d: '`Object.keys`, спред и `for…in` спрашивают дескриптор каждого ключа, чтобы отсеять неперечисляемые. У цели ключей `a` и `b` нет — дескриптора нет — ключ отсеян. → вместе с `ownKeys` перехватывать и `getOwnPropertyDescriptor`.',
    tone: 'warn',
  },
  {
    n: '04',
    t: 'Метод встроенного объекта через прокси',
    code: "const m = new Proxy(new Map([['a', 1]]), {});\nm.get('a');\n// TypeError: Method Map.prototype.get\n// called on incompatible receiver",
    d: 'Методы `Map`, `Set`, `Date`, `Promise`, `RegExp` читают внутренний слот у `this`, а `this` — прокси. Ловушка `get` отдаёт метод исправно, падает вызов. → в ловушке `get` привязывать методы к цели: `v.bind(target)`; так устроены коллекционные обработчики Vue.',
    tone: 'warn',
  },
  {
    n: '05',
    t: 'Консоль Node показывает цель, а не ответы ловушек',
    code: "const p = new Proxy({ a: 1 }, { get: () => 42 });\nconsole.log(p);         // { a: 1 }\nJSON.stringify(p);      // '{\"a\":42}'",
    d: '`console.log` в Node печатает цель напрямую и ловушек не зовёт: так он не вызывает побочных эффектов при отладке. Поэтому прокси, который «отдаёт 42», в консоли показывает `1`. → для проверки поведения читать свойства явно; `util.inspect(p, { showProxy: true })` покажет цель и handler раздельно.',
  },
  {
    n: '06',
    t: '`structuredClone` реактивного состояния',
    code: 'structuredClone(reactive({ n: 1 }))\n// DataCloneError — ни одной ловушки',
    d: 'Отказ приходит до чтения свойств, поэтому ни один handler его не исправит: проблема в самом объекте-прокси. То же с `postMessage` и IndexedDB. → `toRaw(state)` во Vue, `current(draft)` в Immer, спред для плоских данных.',
    tone: 'err',
  },
];

// ─── Источники и смежное ───────────────────────────────────────────────────────────────────

export const SOURCES = [
  {
    title: 'ECMA-262 · 10.5 Proxy Object Internal Methods and Internal Slots',
    href: 'https://tc39.es/ecma262/#sec-proxy-object-internal-methods-and-internal-slots',
    what: 'Тринадцать внутренних методов прокси и инварианты по каждой ловушке: почему прокси не может соврать про неконфигурируемое свойство.',
  },
  {
    title: 'ECMA-262 · The Reflect Object',
    href: 'https://tc39.es/ecma262/#sec-reflect-object',
    what: 'Тринадцать функций `Reflect` — по одной на внутренний метод.',
  },
  {
    title: 'ECMA-262 · OrdinarySetWithOwnDescriptor',
    href: 'https://tc39.es/ecma262/#sec-ordinarysetwithowndescriptor',
    what: 'Откуда три ловушки на одно присваивание: при чужом получателе запись идёт через его `[[GetOwnProperty]]` и `[[DefineOwnProperty]]`.',
  },
  {
    title: 'ECMA-262 · IsArray',
    href: 'https://tc39.es/ecma262/#sec-isarray',
    what: 'Единственная проверка, которая смотрит сквозь прокси на цель, — и отказывает, если прокси отозван.',
  },
  {
    title: 'HTML · StructuredSerializeInternal',
    href: 'https://html.spec.whatwg.org/multipage/structured-data.html#structuredserializeinternal',
    what: 'Шаги, на которых прокси получает `DataCloneError`: посторонний внутренний слот и экзотический объект.',
  },
  {
    title: 'MDN · Proxy',
    href: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy',
    what: 'Справочник по ловушкам с примерами и раздел о том, почему методы встроенных объектов и приватные поля не работают через прокси.',
  },
  {
    title: 'Vue · Reactivity in Depth',
    href: 'https://vuejs.org/guide/extras/reactivity-in-depth.html',
    what: 'Как Vue 3 строит `reactive` на прокси и почему сравнение с сырым объектом ломается.',
  },
  {
    title: 'Immer · Introduction',
    href: 'https://immerjs.github.io/immer/',
    what: 'Черновик-прокси, копирование при записи и общие ссылки на нетронутые части.',
  },
  {
    title: 'MobX · Configuration: proxy support',
    href: 'https://mobx.js.org/configuration.html#proxy-support',
    what: 'Раздел «Proxy support»: MobX 7 работает только на прокси, режим без них остался в MobX 6.',
  },
];

export const RELATED =
  'Смежное на сайте: [Объектная модель](/js/object-model/) — внутренние методы, дескрипторы, замки и `#`-поля, которые перехватывает и не может перехватить прокси. [Vue 3 изнутри](/frameworks/vue-internals/) — полная мини-реактивность на тех же ловушках, с очисткой связей, `computed` и очередью. [Реактивность Vue](/frameworks/vue-reactivity/) — то же поведение снаружи, на настоящем Vue. [Воркеры и параллелизм](/js/workers/#s2) — что ещё теряет и на чём падает структурное клонирование. [Транспиляция](/tooling/transpilation/) — почему прокси нельзя перенести в старый движок. [Копирование и сериализация](/js/serialization/) — `JSON.stringify` по шагам, алгоритм `structuredClone` и что теряет каждая копия.';
