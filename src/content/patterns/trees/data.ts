import type { Pitfall } from '@/widgets/pitfalls/model/types';

/**
 * Данные темы «Деревья и обход: компоновщик и итератор».
 *
 * Источник — видеокурс по TypeScript из папки автора (`~/Desktop/курсы/ts/pattern`, ролики
 * 110 «Composite» и 117 «Iterator», расшифрованы whisper). Из курса взяты сквозные примеры
 * (заказ из магазина с упаковками и товарами, `getPrice()`; список задач и итератор по
 * приоритету) и классические реализации — почти дословно, с одной правкой: компаратор
 * сортировки записан вычитанием, поведение то же.
 * Угол темы — не «как нарисовать UML», а **что JS, TypeScript и DOM уже дают сами** и где
 * книжная версия ломается: лист с `addItem`, итератор, который переставляет коллекцию,
 * рекурсивный генератор на глубоком дереве.
 *
 * Механика протокола итератора, генераторов и помощников итераторов здесь не пересказывается —
 * она разобрана в «Объектной модели» (раздел «Итераторы и генераторы») и в «Генераторах».
 *
 * ── Чем проверено ───────────────────────────────────────────────────────────────────────
 * Каждый пример — строка в этом файле, и `tests/unit/patterns-trees.test.ts` берёт **эту
 * строку**: компиляция `tsc` 6.0.3 со `strict` (ошибки сверяются с пометками `// ts(NNNN)`
 * по строкам), исполнение — с выводом `*_OUT`. Примеры раздела «Обход» продолжают дерево
 * заказа из `UNION_CODE`: тест компилирует и исполняет их склейкой `UNION_CODE + WALK_CODE
 * (+ FLAT_CODE)`. Стенд — Node 26.8.2.
 *
 * Найдено запуском и стоит знать (курс этого не говорит):
 *   — в книжном («прозрачном») компоновщике у товара есть `addItem`: вложенное в товар
 *     компилируется и молча не попадает в цену (500 вместо 650);
 *   — итератор из курса сортирует **сам список** в конструкторе (`sort` меняет массив на месте):
 *     после `getIterator()` порядок `getTasks()` уже другой; а `while (it.next())` пропускает
 *     первый элемент — `next()` сдвигается до чтения;
 *   — рекурсивный генератор с `yield*` платит за каждый узел его глубиной: цепочка из 1000
 *     узлов — 501 500 вызовов `next` (счёт подменой `next` у прототипа генераторов);
 *   — `JSON.parse` строит дерево глубиной 100 000 без ошибки, а рекурсивный обход того же
 *     дерева падает `RangeError`; явный стек проходит и миллион уровней. Предел рекурсивного
 *     генератора на Node 26.8.2 со стеком по умолчанию — около 4,4 тысячи уровней (замер
 *     двоичным поиском, разовый; тест закрепляет только «меньше 100 000»);
 *   — рекурсивный генератор без аннотации типа — `ts(7023)`; помощники итераторов на нём при
 *     `lib` ниже ES2025 — `ts(2339)`;
 *   — тип id всех пунктов меню, выведенный из `as const`-дерева, сходится на 45 уровнях
 *     и ломается на 60: уже `satisfies` даёт `ts(2321)`, сам вывод — `ts(2589)`.
 *
 * DOM: `Text.appendChild` типизирован (метод объявлен у `Node`), а при выполнении бросает
 * `HierarchyRequestError` — по спецификации DOM (pre-insertion validity) и разовым запуском
 * в Chromium 153.0.8010.12 (Playwright, 2026-10-06). happy-dom 20.14.5 этого **не** делает —
 * тест закрепляет расхождение, чтобы не принять happy-dom за стенд.
 */

/* ──────────────────── Вводный раздел · словарь ──────────────────── */

export const PLAIN_TREE =
  'Дерево — как папки на диске. В папке лежат файлы и другие папки, в тех — снова файлы и папки, и сколько этажей вниз, заранее не знает никто. Чтобы узнать размер папки, не нужен отдельный код на каждый этаж: «размер папки — это сумма размеров всего, что в ней лежит», и тот же вопрос задаётся каждой вложенной папке. Компоновщик — это правило «спроси у содержимого». Итератор — это способ пройти по всем файлам по одному, не думая, как они разложены.';

export const GLOSSARY = [
  {
    k: 'дерево',
    d: 'Набор узлов, где у каждого узла, кроме одного, есть ровно один родитель. Узел без родителя — **корень**, узел без детей — **лист**, узел со всем, что под ним, — **поддерево**. DOM, дерево компонентов, меню, файловая система, ветка комментариев — всё деревья.',
  },
  {
    k: 'контейнер и лист',
    d: 'Контейнер (в книге — composite, «составной») хранит детей и отвечает на вопрос, опрашивая их. Лист детей не имеет и отвечает сам. Коробка с товарами — контейнер, товар — лист.',
  },
  {
    k: 'компоновщик',
    d: 'Паттерн, при котором лист и контейнер отвечают на один и тот же вызов: `item.getPrice()` работает и для товара, и для коробки с коробками внутри. Код снаружи не проверяет, что перед ним, и не знает глубины. По-английски — Composite.',
  },
  {
    k: 'итератор',
    d: 'Объект, который выдаёт элементы коллекции по одному и помнит, где остановился. В книге — интерфейс с `next()`, `current()`, иногда `prev()`. В JavaScript — встроенный протокол: объект с `next()`, возвращающим `{ value, done }`. Его понимают `for…of`, спред `[...x]` и деструктуризация.',
  },
  {
    k: 'обход в глубину и в ширину',
    d: 'В глубину — узел, потом целиком его первое поддерево, потом второе: так читают оглавление книги. В ширину — сначала все узлы первого уровня, потом все второго: так смотрят на задачи «сначала верхние, потом зависимые».',
  },
  {
    k: 'ленивый обход',
    d: 'Следующий узел вычисляется, только когда его попросили. Обход, который нашёл нужное на третьем узле, до четвёртого не доходит. Генераторы и помощники итераторов (`filter`, `map`, `take`, `find`) — ленивые.',
  },
  {
    k: 'размеченное объединение',
    d: 'Тип вида `{ kind: \'product\'; … } | { kind: \'box\'; … }`: варианты различаются полем-меткой, и после `switch (item.kind)` TypeScript знает, какой вариант перед ним. Им описывают дерево из обычных объектов — без классов.',
  },
];

/* ──────────────────── Раздел 0 · перед началом ──────────────────── */

export const PREREQ_NOTE = 'Тема опирается на четыре вещи, и все четыре разобраны на сайте.';

export const PREREQ = [
  {
    t: 'Протокол итератора',
    d: 'Iterable — объект с `[Symbol.iterator]()`, то есть фабрика итераторов; iterator — объект с `next()`, то есть состояние одного обхода. Отсюда одноразовость итератора, `return()` при `break` и помощники `map`/`filter`/`take` на всех встроенных итераторах.',
    href: '/js/object-model/#s8',
    hrefLabel: 'Объектная модель, раздел «Итераторы и генераторы»',
    tone: 'info' as const,
  },
  {
    t: 'Генератор и пауза на `yield`',
    d: '`function*` возвращает итератор, тело которого останавливается на каждом `yield` и продолжается со следующим `next()`. `yield* другой()` отдаёт наружу всё, что выдаёт вложенный генератор. На этом держится обход дерева в пять строк.',
    href: '/js/generators/#s1',
    hrefLabel: 'Генераторы и асинхронные итераторы, раздел «Пауза генератора»',
    tone: 'info' as const,
  },
  {
    t: 'Сужение по полю-метке',
    d: 'Внутри `case \'product\':` TypeScript знает, что у `item` есть `price`, а `items` нет. На этом стоит дерево из обычных объектов и проверка, что все варианты узла учтены.',
    href: '/tooling/typescript/#s2',
    hrefLabel: 'TypeScript на уровне типов, раздел «Сужение»',
    tone: 'info' as const,
  },
  {
    t: '`abstract` и что стирается при сборке',
    d: 'Книжный компоновщик держится на абстрактном классе с абстрактным `getPrice()`. Запрет создать абстрактный класс — проверка компилятора, а не движка.',
    href: '/tooling/typescript/#s7',
    hrefLabel: 'TypeScript на уровне типов, раздел «Классы»',
    tone: 'warn' as const,
  },
];

/* ──────────────────── Раздел 1 · зачем ──────────────────── */

/**
 * Без компоновщика: цена заказа двумя вложенными циклами.
 *
 * Закреплено тестом: компиляция и вывод `PROBLEM_OUT` — 1600 вместо 1630, плёнка из пакета
 * в коробке 2 не посчитана.
 */
export const PROBLEM_CODE = `type Product = { title: string; price: number };
type Box = { title: string; items: (Product | Box)[] };

const order = {
  fee: 100,                                       // доставка магазина
  items: [
    { title: 'ноутбук', price: 1000 },
    { title: 'коробка 1', items: [{ title: 'мышь', price: 200 }, { title: 'наушники', price: 300 }] },
    { title: 'коробка 2', items: [{ title: 'пакет', items: [{ title: 'плёнка', price: 30 }] }] },
  ] as (Product | Box)[],
};

function total(o: typeof order) {
  let sum = o.fee;
  for (const item of o.items) {
    if ('price' in item) sum += item.price;
    else for (const inner of item.items) {         // коробка — заглянули на этаж ниже…
      if ('price' in inner) sum += inner.price;    // …а коробку в коробке пропустили
    }
  }
  return sum;
}
console.log(total(order));                        // 1600, а должно быть 1630`;

export const PROBLEM_OUT = [1600];

/** Два паттерна: что решает каждый и что из этого уже есть в языке и платформе. */
export const PATTERN_ROWS: { k: string; task: string; js: string; book: string }[] = [
  {
    k: 'Компоновщик',
    task: 'один вызов для листа и для контейнера любой глубины',
    js: 'рекурсивная функция над размеченным объединением; в DOM — `textContent`, `remove()`, `contains()`, которые сразу работают на всё поддерево',
    book: 'у узлов есть своё поведение и состояние, которое удобно держать в классах: фигуры в редакторе, объекты сцены',
  },
  {
    k: 'Итератор',
    task: 'пройти коллекцию, не зная её устройства, и уметь проходить по-разному',
    js: 'протокол `Symbol.iterator`, `for…of`, генераторы, помощники `filter`/`map`/`take`; в DOM — `TreeWalker`',
    book: 'нужен курсор, а не поток: шаг назад, текущая позиция, сброс. Протокол JS умеет только вперёд',
  },
];

/* ──────────────────── Раздел 2 · компоновщик ──────────────────── */

export const PLAIN_COMPOSITE =
  'Кассир не разбирает посылку, чтобы назвать цену. Он спрашивает у посылки: «сколько ты стоишь?» — а посылка спрашивает у каждой коробки внутри, коробка — у каждого товара. Товар просто называет свою цену. Вопрос один и тот же на всех этажах, поэтому неважно, сколько коробок вложено друг в друга.';

/**
 * Компоновщик из видеокурса: абстрактный `DeliveryItem`, магазин, упаковка, товар.
 *
 * Закреплено тестом: компиляция без ошибок и вывод `COMPOSITE_OUT` — 1630 за заказ и 500
 * за чехол, в который «положили» товар за 150.
 */
export const COMPOSITE_CODE = `abstract class DeliveryItem {
  items: DeliveryItem[] = [];
  addItem(item: DeliveryItem) { this.items.push(item); }
  getItemPrices(): number {
    return this.items.reduce((acc, item) => acc + item.getPrice(), 0);
  }
  abstract getPrice(): number;                    // как считать — решает каждый узел
}
class DeliveryShop extends DeliveryItem {
  constructor(private deliveryFee: number) { super(); }
  getPrice() { return this.getItemPrices() + this.deliveryFee; }
}
class Package extends DeliveryItem {
  getPrice() { return this.getItemPrices(); }
}
class Product extends DeliveryItem {
  constructor(public price: number) { super(); }
  getPrice() { return this.price; }
}

const shop = new DeliveryShop(100);
shop.addItem(new Product(1000));
const pack1 = new Package();
pack1.addItem(new Product(200));
pack1.addItem(new Product(300));
const pack2 = new Package();
const bag = new Package();                        // упаковка в упаковке
bag.addItem(new Product(30));
pack2.addItem(bag);
shop.addItem(pack1);
shop.addItem(pack2);
console.log(shop.getPrice());                     // 1630 — одна строка на любую глубину

const phoneCase = new Product(500);
phoneCase.addItem(new Product(150));              // компилируется: addItem есть у всех
console.log(phoneCase.getPrice());                // 500 — вложенное потерялось молча`;

export const COMPOSITE_OUT = [1630, 500];

export const COMPOSITE_NOTES: string[] = [
  '**Клиенту хватает одного вызова.** `shop.getPrice()` не знает, сколько этажей у заказа: каждый узел отвечает за себя и опрашивает детей. Упаковку в упаковке, которую пропустили вложенные циклы, компоновщик посчитал сам — добавлять код на новый этаж не пришлось.',
  '**`addItem` в базовом классе — выбор, у которого есть цена.** Книжная версия кладёт `items` и `addItem` в `DeliveryItem`, и тогда у товара тоже есть дети. Книга называет это «прозрачным» компоновщиком: все узлы выглядят одинаково. Цена видна в последних строках: в чехол «положили» товар за 150, компилятор промолчал, а цена его не учла — `Product.getPrice()` про `items` не знает.',
  '**«Безопасный» вариант переносит `items` и `addItem` в контейнеры.** Тогда `phoneCase.addItem(…)` — ошибка компиляции. Платить приходится в другом месте: чтобы добавить ребёнка к узлу неизвестного вида, его сначала надо проверить. В TypeScript эту развилку удобнее всего решает не иерархия классов, а тип-объединение.',
];

/**
 * То же дерево обычными объектами: размеченное объединение и рекурсивная функция.
 *
 * Закреплено тестом: `ts(2353)` на чехле с `items`, вывод `UNION_OUT`. Это же дерево `order`
 * продолжают `WALK_CODE` и `FLAT_CODE`.
 */
export const UNION_CODE = `type Item =
  | { kind: 'product'; title: string; price: number }
  | { kind: 'box'; title: string; items: Item[] }
  | { kind: 'shop'; title: string; fee: number; items: Item[] };

function price(item: Item): number {
  switch (item.kind) {
    case 'product': return item.price;
    case 'box': return sum(item.items);
    case 'shop': return sum(item.items) + item.fee;
  }
}
const sum = (items: Item[]) => items.reduce((acc, i) => acc + price(i), 0);

const order: Item = { kind: 'shop', title: 'магазин', fee: 100, items: [
  { kind: 'product', title: 'ноутбук', price: 1000 },
  { kind: 'box', title: 'коробка 1', items: [
    { kind: 'product', title: 'мышь', price: 200 },
    { kind: 'product', title: 'наушники', price: 300 },
  ] },
  { kind: 'box', title: 'коробка 2', items: [
    { kind: 'box', title: 'пакет', items: [{ kind: 'product', title: 'плёнка', price: 30 }] },
  ] },
] };
console.log(price(order));                        // 1630
console.log(price(JSON.parse(JSON.stringify(order))));  // 1630 — дерево пережило JSON

const phoneCase: Item = { kind: 'product', title: 'чехол', price: 500, items: [] }; // ts(2353)`;

export const UNION_OUT = [1630, 1630];

export const UNION_NOTES: string[] = [
  '**Дерево — это данные, а компоновщик — функция над ними.** `price` делает то же, что `getPrice` в классах: товар отвечает сам, коробка и магазин суммируют детей. Тип `Item` ссылается сам на себя (`items: Item[]`), и TypeScript это разрешает: такие рекурсивные типы он раскрывает лениво, по мере надобности.',
  '**Лист без детей здесь проверяет компилятор.** У варианта `product` поля `items` нет, и чехол с вложенным товаром — ошибка `ts(2353)`, а не молча потерянные 150. Новый вид узла — новая строка в объединении, и `switch` без ветки для него не скомпилируется: функция с типом возврата `number` не может дойти до конца без `return`.',
  '**Обычные объекты переживают JSON, `structuredClone` и хранилище состояния.** Ответ API уже такое дерево — его не надо превращать в экземпляры классов, чтобы посчитать цену. Экземпляр `DeliveryShop` после `JSON.parse` становится простым объектом без `getPrice`.',
];

/**
 * DOM — компоновщик, который уже есть в браузере.
 *
 * Тест компилирует строку с `lib.dom` (ошибок нет — в том числе на `text.appendChild`)
 * и исполняет её в happy-dom 20.14.5 без последней строки: вывод `DOM_OUT`. Последнюю строку
 * happy-dom выполняет без ошибки, а Chromium 153 и спецификация DOM — `HierarchyRequestError`
 * (см. шапку файла).
 */
export const DOM_CODE = `const menu = document.createElement('ul');
menu.innerHTML = '<li>Профиль<ul><li>Сеансы</li></ul></li><li>Выход</li>';

console.log(menu.textContent);              // текст всего поддерева — одним свойством

const walker = document.createTreeWalker(menu, NodeFilter.SHOW_TEXT);
while (walker.nextNode()) console.log(walker.currentNode.textContent);

const text = document.createTextNode('лист');
text.appendChild(document.createElement('b'));  // компилируется — и HierarchyRequestError`;

export const DOM_OUT = ['ПрофильСеансыВыход', 'Профиль', 'Сеансы', 'Выход'];

export const DOM_NOTE =
  'DOM устроен как «прозрачный» компоновщик. `appendChild` объявлен у `Node`, общего предка элементов и текстовых узлов, поэтому TypeScript пропускает `text.appendChild(…)`. Но браузер, в отличие от `Product.getPrice()`, не молчит: спецификация требует, чтобы родителем был документ, фрагмент или элемент, и вставка в текстовый узел бросает `HierarchyRequestError`. Операции над поддеревом — `textContent`, `remove()`, `contains()`, `cloneNode(true)` — работают на любой глубине одним вызовом. А `TreeWalker` — встроенный итератор по DOM: обходит в глубину, фильтрует по типу узла и не держит рекурсии, поэтому ему не страшна вложенность, на которой падает рекурсивная функция. Как по этому же дереву идёт событие — в теме [«События DOM», раздел «Путь и фазы»](/render/dom-events/#s1).';

/* ──────────────────── Раздел 3 · итератор ──────────────────── */

export const PLAIN_ITERATOR =
  'Итератор — закладка в книге. Закладок может быть несколько, и каждая помнит своё место, а книга от них не меняется. Книжный итератор устроен иначе: чтобы читать «по приоритету», он сначала переплетает саму книгу в новом порядке. Вторая закладка, вставленная после этого, увидит уже переплетённую книгу.';

/**
 * Итератор из видеокурса: `TaskList`, интерфейс с `current/next/prev/index`, итератор по приоритету.
 *
 * Закреплено тестом: `ts(2488)` на двух последних строках (при выполнении они выброшены),
 * вывод `COURSE_ITER_OUT` — список переставлен итератором, первый элемент пропущен.
 */
export const COURSE_ITER_CODE = `class Task {
  constructor(public priority: number) {}
}
interface IIterator<T> {
  current(): T | undefined;
  next(): T | undefined;
  prev(): T | undefined;
  index(): number;
}
class TaskList {
  private tasks: Task[] = [];
  sortByPriority() {
    this.tasks = this.tasks.sort((a, b) => a.priority - b.priority);
  }
  addTask(task: Task) { this.tasks.push(task); }
  getTasks() { return this.tasks; }
  count() { return this.tasks.length; }
  getIterator() { return new PriorityTaskIterator(this); }
}
class PriorityTaskIterator implements IIterator<Task> {
  private position = 0;
  private taskList: TaskList;
  constructor(taskList: TaskList) {
    taskList.sortByPriority();                    // сортирует сам список, а не копию
    this.taskList = taskList;
  }
  current() { return this.taskList.getTasks()[this.position]; }
  next() { this.position += 1; return this.taskList.getTasks()[this.position]; }
  prev() { this.position -= 1; return this.taskList.getTasks()[this.position]; }
  index() { return this.position; }
}

const list = new TaskList();
list.addTask(new Task(8));
list.addTask(new Task(1));
list.addTask(new Task(3));
const before = list.getTasks().map((t) => t.priority).join();
const it = list.getIterator();
console.log(before + ' → ' + list.getTasks().map((t) => t.priority).join());

const seen: number[] = [];
let task: Task | undefined;
while ((task = it.next())) seen.push(task.priority);
console.log(seen.join());                         // 3,8 — где задача с приоритетом 1?

for (const t of list) {}                          // ts(2488)
for (const t of it) {}                            // ts(2488)`;

export const COURSE_ITER_OUT = ['8,1,3 → 1,3,8', '3,8'];

export const COURSE_ITER_NOTES: string[] = [
  '**Получить итератор — значит переставить список.** `Array.prototype.sort` сортирует массив на месте и возвращает его же; присваивание `this.tasks = this.tasks.sort(…)` это только прячет. После `getIterator()` у списка другой порядок, и его видит каждый, кто держит `getTasks()`. Итератор «по зависимостям», созданный следом, получит уже отсортированный список. Принято считать, что итераторы одного списка не мешают друг другу, — для этой реализации это не так.',
  '**`next()` сдвигается раньше, чем читает.** Позиция начинается с нуля, и первый же `next()` отдаёт второй элемент. В книжном итераторе с `current()` так и задумано: первый элемент берут через `current()`. Но цикл `while (it.next())`, привычный по протоколу JS, где первый `next()` отдаёт первый элемент, теряет задачу с самым высоким приоритетом — без ошибки.',
  '**`for…of` такой итератор не понимает.** У объекта нет `[Symbol.iterator]`, и TypeScript говорит об этом прямо: `ts(2488)`. Без этого метода коллекция не работает ни со спредом, ни с деструктуризацией, ни с помощниками `filter`/`map`.',
];

/**
 * Тот же список на протоколе JS: `[Symbol.iterator]` и обход по приоритету по копии.
 *
 * Закреплено тестом: вывод `NATIVE_ITER_OUT`.
 */
export const NATIVE_ITER_CODE = `class Task {
  constructor(public priority: number) {}
}
class TaskList {
  #tasks: Task[] = [];
  add(task: Task) { this.#tasks.push(task); return this; }
  [Symbol.iterator]() { return this.#tasks.values(); }      // как добавляли
  byPriority() {                                             // по приоритету — по копии
    return this.#tasks.toSorted((a, b) => a.priority - b.priority).values();
  }
}

const list = new TaskList().add(new Task(8)).add(new Task(1)).add(new Task(3));
const show = (tasks: Iterable<Task>) => [...tasks].map((t) => t.priority).join();

console.log(show(list.byPriority()));             // 1,3,8
console.log(show(list));                          // 8,1,3 — сам список не тронут
console.log(list.byPriority().filter((t) => t.priority < 5).map((t) => t.priority).toArray().join());

const a = list.byPriority();
const b = list.byPriority();
a.next();
console.log(a.next().value?.priority + ' и ' + b.next().value?.priority);  // каждый помнит своё`;

export const NATIVE_ITER_OUT = ['1,3,8', '8,1,3', '1,3', '3 и 1'];

export const NATIVE_ITER_NOTES: string[] = [
  '**Коллекция — фабрика, обход — итератор.** `[Symbol.iterator]()` и `byPriority()` при каждом вызове заводят новый итератор, поэтому два обхода идут независимо, и `for…of`, спред и деструктуризация работают сразу. Почему отдавать наружу нужно фабрику, а не один итератор, — в теме [«Объектная модель», раздел «Итераторы и генераторы»](/js/object-model/#s8).',
  '**`toSorted` копирует, `sort` переставляет.** Обход по приоритету работает по копии, и порядок самого списка не меняется. Обратная сторона: копия снята в момент вызова, и задача, добавленная после, в этот обход не попадёт. `this.#tasks.values()`, наоборот, идёт по живому массиву и увидит добавленное — как итератор `Map` в теме [«Коллекции», раздел «Обход»](/js/collections/#s5).',
  '**Помощники достаются даром.** `values()` возвращает встроенный итератор массива, а у всех встроенных итераторов есть `filter`, `map`, `take`, `find`, `toArray`. Самописный итератор их не получит, пока его не обернуть в `Iterator.from(…)` — а для этого он должен соблюдать протокол.',
];

export const CURSOR_NOTE =
  '`prev()`, `current()` и `index()` книжного итератора протокол JS не заменяет: итератор в JS ходит только вперёд и не знает своей позиции. Если интерфейсу нужно именно это — листать карусель туда и обратно, двигать выделение в списке стрелками, — это курсор: массив и индекс, без всякого итератора. Книжная версия здесь честнее протокола, только сортировать она должна копию.';

/* ──────────────────── Раздел 4 · обход дерева ──────────────────── */

/**
 * Обход дерева заказа рекурсивным генератором — продолжение `UNION_CODE`.
 *
 * Закреплено тестом: склейка `UNION_CODE + WALK_CODE` компилируется, вывод — `UNION_OUT`,
 * затем `WALK_OUT`. С `lib` ES2022 та же склейка даёт `ts(2339)` на `.filter`.
 */
export const WALK_CODE = `const children = (item: Item) => (item.kind === 'product' ? [] : item.items);

function* walk(item: Item): Generator<Item> {
  yield item;
  for (const child of children(item)) yield* walk(child);
}

const titles = (items: Iterable<Item>) => [...items].map((i) => i.title).join(', ');
console.log(titles(walk(order)));

const products = walk(order).filter((i) => i.kind === 'product');
console.log(products.map((p) => p.price).reduce((a, b) => a + b, 0));   // 1530 — без доставки

let visited = 0;
const first = walk(order).find((i) => (visited++, i.kind === 'product' && i.price < 250));
console.log(first?.title + ', узлов просмотрено: ' + visited);`;

export const WALK_OUT = [
  'магазин, ноутбук, коробка 1, мышь, наушники, коробка 2, пакет, плёнка',
  1530,
  'мышь, узлов просмотрено: 4',
];

export const WALK_NOTES: string[] = [
  '**Генератор отделяет «как пройти» от «что сделать».** `walk` знает только устройство дерева; суммировать цены, искать товар или собрать названия — дело того, кто обходит. Это и есть итератор поверх компоновщика: одна функция обхода на все задачи вместо `getPrice`, `getWeight`, `findById` в каждом классе.',
  '**Обход ленивый.** `find` остановился на мыши, четвёртом узле, и до коробки 2 не дошёл. Остановка закрывает все вложенные генераторы — тем же `return()`, что `break` в `for…of`.',
];

/**
 * Обход явным стеком, ошибка порядка и обход в ширину — продолжение `UNION_CODE + WALK_CODE`.
 *
 * Закреплено тестом: вывод `FLAT_OUT`.
 */
export const FLAT_CODE = `function* walkFlat(root: Item): Generator<Item> {
  const stack = [root];
  while (stack.length > 0) {
    const item = stack.pop()!;
    yield item;
    const kids = children(item);
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);   // с конца
  }
}
function* walkNaive(root: Item): Generator<Item> {
  const stack = [root];
  while (stack.length > 0) {
    const item = stack.pop()!;
    yield item;
    stack.push(...children(item));                // pop() возьмёт последнего ребёнка первым
  }
}
function* walkWide(root: Item): Generator<Item> {
  const queue = [root];
  for (let i = 0; i < queue.length; i++) {        // очередь: берём с начала
    yield queue[i];
    queue.push(...children(queue[i]));
  }
}
console.log(titles(walkFlat(order)) === titles(walk(order)));
console.log(titles(walkNaive(order)));
console.log(titles(walkWide(order)));`;

export const FLAT_OUT = [
  true,
  'магазин, коробка 2, пакет, плёнка, коробка 1, наушники, мышь, ноутбук',
  'магазин, ноутбук, коробка 1, коробка 2, мышь, наушники, пакет, плёнка',
];

export const PLAIN_CALL_STACK =
  'Стек вызовов — стопка недоделанных дел. Функция вызвала другую — на стопку легла записка «вернуться сюда, когда та закончит». Рекурсивный обход кладёт по записке на каждый этаж дерева, и стопка не бесконечна: на несколько тысяч этажей её хватает, на сто тысяч — нет. Явный стек — та же стопка, только в обычном массиве, а массив вмещает миллионы записей.';

/**
 * Глубокое дерево из JSON: рекурсивный генератор падает, явный стек — нет.
 *
 * Закреплено тестом: компиляция, вывод `DEEP_OUT`. Тест отдельно проверяет явный стек
 * на миллионе уровней.
 */
export const DEEP_CODE = `type Reply = { text: string; replies: Reply[] };

function* walk(r: Reply): Generator<Reply> {
  yield r;
  for (const child of r.replies) yield* walk(child);
}
function* walkFlat(root: Reply): Generator<Reply> {
  const stack = [root];
  while (stack.length > 0) {
    const r = stack.pop()!;
    yield r;
    for (let i = r.replies.length - 1; i >= 0; i--) stack.push(r.replies[i]);
  }
}

// ветка комментариев, где каждый ответ — на предыдущий
const depth = 100_000;
const json = '{"text":"ответ","replies":['.repeat(depth) + ']}'.repeat(depth);
const thread: Reply = JSON.parse(json);
console.log('JSON.parse: дерево построено');

try { walk(thread).toArray(); } catch (e) { console.log('walk: ' + (e as Error).name); }
console.log('walkFlat: ' + walkFlat(thread).toArray().length);`;

export const DEEP_OUT = ['JSON.parse: дерево построено', 'walk: RangeError', 'walkFlat: 100000'];

/**
 * Сколько стоит `yield*`: счёт вызовов `next` у всех генераторов.
 *
 * Закреплено тестом: вывод `COST_OUT` (прототип генераторов восстанавливается в конце).
 */
export const COST_CODE = `type Reply = { replies: Reply[] };

function* walk(r: Reply): Generator<Reply> {
  yield r;
  for (const child of r.replies) yield* walk(child);
}
function chain(depth: number): Reply {             // каждый узел вложен в предыдущий
  const root: Reply = { replies: [] };
  let last = root;
  for (let i = 1; i < depth; i++) last.replies.push((last = { replies: [] }));
  return root;
}

// подменяем next у общего прототипа генераторов, чтобы считать вызовы
const proto = Object.getPrototypeOf(walk.prototype);
const next = proto.next;
let calls = 0;
proto.next = function (this: unknown, v: unknown) { calls++; return next.call(this, v); };

for (const depth of [10, 100, 1000]) {
  calls = 0;
  const nodes = [...walk(chain(depth))].length;
  console.log(nodes + ' узлов → ' + calls + ' вызовов next');
}
proto.next = next;`;

export const COST_OUT = ['10 узлов → 65 вызовов next', '100 узлов → 5150 вызовов next', '1000 узлов → 501500 вызовов next'];

export const DEEP_NOTES: string[] = [
  '**`JSON.parse` глубины не боится, а рекурсия — боится.** V8 разбирает JSON без рекурсии, и дерево в сто тысяч уровней строится без ошибки. Рекурсивный генератор на том же дереве падает `RangeError: Maximum call stack size exceeded`: на Node 26.8.2 со стеком по умолчанию его хватает примерно на 4,4 тысячи уровней, и обычная рекурсивная функция упирается почти туда же. Число зависит от движка и размера кадра, но порядок — тысячи. Ветка комментариев, вложенные категории из базы, дерево из пользовательского JSON легко его превышают.',
  '**`yield*` платит глубиной за каждый узел.** Чтобы достать значение с десятого этажа, `next()` проходит через десять вложенных генераторов — каждый передаёт вызов ниже. В цепочке из тысячи узлов это полмиллиона вызовов, и время растёт квадратично: вдвое глубже — вчетверо дольше. В сбалансированном дереве глубина — логарифм числа узлов, и цена незаметна. Явный стек платит за узел один шаг на любой глубине.',
  '**Порядок детей — забота явного стека.** `pop()` берёт последнего, поэтому детей кладут с конца; `push(...children)` молча переворачивает каждый уровень. Очередь вместо стека даёт обход в ширину — «сначала верхние задачи, потом зависимые».',
  '**React тоже обходит дерево без рекурсии — ради паузы.** Его обход дерева компонентов держит состояние не в стеке вызовов, а в самих узлах, поэтому его можно прервать между двумя узлами и продолжить позже: рекурсию на середине не отложишь. Как это устроено — в теме [«React изнутри», раздел «Файбер и цикл»](/frameworks/react-internals/#s2).',
];

/* ──────────────────── Раздел 5 · типы дерева ──────────────────── */

/**
 * Типы для дерева: id всех пунктов меню, выведенные из самого меню.
 *
 * Закреплено тестом: `ts(2345)` на опечатке. Предел глубины — `MENU_DEPTH`: тест строит меню
 * нужной глубины тем же типом `Ids` и проверяет, что 45 уровней сходятся, а на 60 появляются
 * `ts(2321)` и `ts(2589)`.
 */
export const MENU_CODE = `type MenuItem = { id: string; label: string; children?: readonly MenuItem[] };

const MENU = [
  { id: 'home', label: 'Главная' },
  { id: 'settings', label: 'Настройки', children: [
    { id: 'profile', label: 'Профиль' },
    { id: 'security', label: 'Безопасность', children: [{ id: 'sessions', label: 'Сеансы' }] },
  ] },
] as const satisfies readonly MenuItem[];

// все id на любой глубине: рекурсивный условный тип
type Ids<T> = T extends readonly (infer I)[]
  ? I extends { id: infer Id } ? Id | (I extends { children: infer C } ? Ids<C> : never) : never
  : never;
type MenuId = Ids<typeof MENU>;   // 'home' | 'settings' | 'profile' | 'security' | 'sessions'

function open(id: MenuId) { return id; }
open('sessions');
open('sesions');                  // ts(2345): опечатка видна до запуска`;

/** Глубина меню, на которой вывод `Ids` ещё сходится и уже ломается (`tsc` 6.0.3, закреплено тестом). */
export const MENU_DEPTH = { ok: 45, fail: 60 };

/**
 * Рекурсивный генератор без аннотации типа.
 *
 * Закреплено тестом: `ts(7023)` на объявлении `walk`, вторая функция чистая.
 */
export const GEN_TYPE_CODE = `type Reply = { text: string; replies: Reply[] };

function* walk(r: Reply) {                        // ts(7023)
  yield r;
  for (const child of r.replies) yield* walk(child);
}

function* walkTyped(r: Reply): Generator<Reply> {
  yield r;
  for (const child of r.replies) yield* walkTyped(child);
}`;

export const TYPES_NOTES: string[] = [
  '**Тип узла может ссылаться на себя — тип вычисления по нему тоже, но с пределом.** `MenuItem` с `children?: readonly MenuItem[]` компилятор раскрывает по мере надобности, и глубина ему безразлична. `Ids` — другое дело: он **вычисляется** рекурсивно по конкретному меню и упирается в предел вложенности. На TypeScript 6.0.3 меню в 45 уровней сходится, в 60 — ломается уже `satisfies` (`ts(2321)`), а сам `Ids` даёт `ts(2589)`. Для настоящего меню до предела далеко; почему он есть и как его отодвигают — в теме [«TypeScript на уровне типов», раздел «Рекурсия и её пределы»](/tooling/typescript/#s5).',
  '**`as const satisfies` сохраняет литералы и проверяет форму.** `as const` оставляет `\'sessions\'` строковым литералом, а не `string`, — иначе выводить было бы нечего. `satisfies` проверяет, что меню подходит под `MenuItem`, не расширяя его тип обратно.',
  '**Рекурсивному генератору нужна аннотация.** Чтобы вывести тип `walk`, компилятору нужен тип `yield* walk(child)`, то есть тип самой `walk`, — круг. В `strict` это ошибка `ts(7023)`, а не тихий `any`. Хватает `Generator<Reply>` в сигнатуре.',
  '**Помощники итераторов типизированы с ES2025.** Методы `filter`, `map`, `find`, `toArray` у генератора описаны в `lib.es2025.iterator.d.ts`. В проекте с `"lib": ["ES2022", "DOM"]` строка `walk(order).filter(…)` — `ts(2339)`, хотя Node 26 и современные браузеры её выполняют. Лечится строкой `"ES2025"` в `lib`.',
];

/* ──────────────────── Раздел 6 · тонкие места ──────────────────── */

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'Лист с `addItem` теряет вложенное молча',
    d: 'В «прозрачном» компоновщике `items` и `addItem` объявлены в базовом классе, и товару можно «положить» другой товар. Компилятор согласен, исключения нет, а `getPrice()` листа про детей не знает — цена просто меньше. Либо `addItem` только у контейнеров, либо дерево из размеченного объединения, где у листа поля `items` нет вовсе.',
    tone: 'err',
  },
  {
    n: '02',
    t: 'Итератор, который сортирует коллекцию',
    d: '`array.sort()` меняет массив на месте. Итератор, который сортирует в конструкторе, переставляет коллекцию для всех, кто её держит, и следующий итератор получает уже переставленную. Сортировать надо копию: `toSorted()`, `[...array].sort()`.',
    tone: 'err',
  },
  {
    n: '03',
    t: '`while (it.next())` по книжному итератору пропускает первый элемент',
    d: 'В книжном итераторе с `current()` первый элемент берут через `current()`, а `next()` сразу сдвигается на второй. Протокол JS устроен наоборот: первый `next()` отдаёт первый элемент. Перенося код между этими двумя мирами, легко потерять первую — часто самую важную — запись.',
    tone: 'warn',
  },
  {
    n: '04',
    t: 'Рекурсивный обход и данные извне',
    d: 'Рекурсия — функция или генератор с `yield*` — держится на стеке вызовов, а его хватает на тысячи уровней, не на сотни тысяч. Дерево из JSON, базы или от пользователя может быть глубже: `JSON.parse` его построит, обход упадёт с `RangeError`. Для недоверенных данных — явный стек или проверка глубины.',
    tone: 'warn',
  },
  {
    n: '05',
    t: '`yield*` в глубоком дереве работает за квадрат',
    d: 'Каждое значение поднимается к внешнему `next()` через все вложенные генераторы. В сбалансированном дереве это логарифм и незаметно; в вырожденном, похожем на список, — цепочка из тысячи узлов делает полмиллиона вызовов `next`. Явный стек делает один шаг на узел.',
  },
  {
    n: '06',
    t: '`stack.push(...children)` переворачивает порядок',
    d: 'Явный стек отдаёт последним положенное первым, поэтому дети каждого узла выходят задом наперёд, и обход перестаёт совпадать с рекурсивным. Детей кладут с конца — `for (let i = kids.length - 1; i >= 0; i--)` — или берут `kids.toReversed()`.',
  },
  {
    n: '07',
    t: '`Property \'filter\' does not exist on type \'Generator\'`',
    d: 'Помощники итераторов есть в Node 26 и в современных браузерах, но в TypeScript они описаны в `lib.es2025.iterator.d.ts`. С `lib` ниже ES2025 — `ts(2339)`. Это не признак того, что метода нет при выполнении: поправить надо `lib`, а не код.',
  },
];

/* ──────────────────── Раздел 7 · источники ──────────────────── */

/** ⚠️ Без разметки: `SourceList` печатает `title` и `what` как есть. */
export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'Refactoring Guru — Компоновщик',
    href: 'https://refactoring.guru/ru/design-patterns/composite',
    what: 'классическая схема и пример на TypeScript; прозрачный и безопасный варианты',
  },
  {
    title: 'Refactoring Guru — Итератор',
    href: 'https://refactoring.guru/ru/design-patterns/iterator',
    what: 'книжный итератор с current и next и несколько обходов одной коллекции',
  },
  {
    title: 'MDN — Iteration protocols',
    href: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Iteration_protocols',
    what: 'протокол iterable и iterator, который понимают for…of, спред и деструктуризация',
  },
  {
    title: 'MDN — Iterator',
    href: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Iterator',
    what: 'помощники итераторов: filter, map, take, find, toArray и Iterator.from',
  },
  {
    title: 'MDN — yield*',
    href: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/yield*',
    what: 'делегирование вложенному генератору, на котором держится рекурсивный обход',
  },
  {
    title: 'DOM Standard — ensure pre-insertion validity',
    href: 'https://dom.spec.whatwg.org/#concept-node-ensure-pre-insertion-validity',
    what: 'почему вставка в текстовый узел бросает HierarchyRequestError',
  },
  {
    title: 'MDN — TreeWalker',
    href: 'https://developer.mozilla.org/en-US/docs/Web/API/TreeWalker',
    what: 'встроенный итератор по DOM-дереву с фильтром по типу узла',
  },
  {
    title: 'TypeScript 3.7 — More Recursive Type Aliases',
    href: 'https://www.typescriptlang.org/docs/handbook/release-notes/typescript-3-7.html#more-recursive-type-aliases',
    what: 'с какой версии тип может ссылаться на себя через массив и объект',
  },
];

export const RELATED =
  'Смежное на сайте: [Объектная модель, раздел «Итераторы и генераторы»](/js/object-model/#s8) — протокол, одноразовость итератора, `return()` и помощники. [Генераторы и асинхронные итераторы](/js/generators/) — что хранит пауза генератора и как обходить асинхронные источники. [React изнутри, раздел «Файбер и цикл»](/frameworks/react-internals/#s2) — обход дерева компонентов без рекурсии. [AST и линтеры, раздел «Обход и селекторы»](/tooling/ast-linters/#s2) — то же дерево и тот же обход в ESLint. [TypeScript на уровне типов, раздел «Рекурсия и её пределы»](/tooling/typescript/#s5) — откуда предел у рекурсивных типов. [Создание объектов](/patterns/creational/) — порождающие паттерны и что из них JS умеет сам.';
