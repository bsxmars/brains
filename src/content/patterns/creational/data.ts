import type { Pitfall } from '@/widgets/pitfalls/model/types';

/**
 * Данные темы «Создание объектов: фабрика, строитель, прототип, одиночка».
 *
 * Источник — видеокурс по TypeScript из папки автора (`~/Desktop/курсы/ts/pattern`, ролики
 * 101–104, расшифрованы whisper). Из курса взят сквозной пример (страховой агент и два
 * партнёра, `ImageBuilder`, история пользователя, общий `MyMap`) и классические реализации.
 * Угол темы — не «как нарисовать UML», а **что из этого JavaScript уже умеет сам** и где
 * книжная версия ломается на особенностях языка: стирании типов, `#`-полях, модульном кеше.
 *
 * ── Чем проверено ───────────────────────────────────────────────────────────────────────
 * Каждый пример — строка в этом файле, и `tests/unit/patterns-creational.test.ts` берёт
 * **эту строку**: TypeScript-примеры компилируются `tsc` 6.0.3 со `strict`, а ошибки сверяются
 * с пометками `// ts(NNNN)` по строкам; вывод примеров сверяется с массивами `*_OUT`, полученными
 * исполнением. Примеры про модули (`MODULE_FILES`, `DUPLICATE_FILES`) тест раскладывает во
 * временную папку и запускает настоящим `node` — кеш модулей в процессе vitest не тот.
 *
 * Найдено запуском и стоит знать (курс этого не говорит):
 *   — наивный дженерик над реестром теряет конкретный класс (`ts(2339)`), точный тип через
 *     `InstanceType` не сходится без приведения (`ts(2322)`); сходится карта «ключ → тип»;
 *   — ключ `'constructor'` из непроверенного ввода находит в реестре-объекте `Object` из
 *     прототипа, и `new` молча возвращает `{}`;
 *   — строитель, переиспользованный как заготовка, копит шаги всех, кто им пользовался;
 *   — фантомный параметр типа в строителе ничего не проверяет, пока не попал в поле
 *     (`declare private readonly state: S` — ни байта в `.js`);
 *   — `Object.assign(Object.create(proto), x)` сохраняет класс, но не `#`-поля: метод, который
 *     их читает, бросает `TypeError`;
 *   — модуль выполняется один раз **на адрес**: `?v=2` даёт второй экземпляр;
 *   — две копии пакета в `node_modules` — два «одиночки»; `Symbol.for` на `globalThis` сводит их.
 */

/* ──────────────────── Вводный раздел · словарь ──────────────────── */

export const GLOSSARY = [
  {
    k: 'паттерн проектирования',
    d: 'Повторяющееся решение повторяющейся задачи, у которого есть имя. Ценность имени — в разговоре: «здесь фабрика» короче, чем абзац про то, кто и где создаёт объекты. Двадцать три классических паттерна описаны в книге «банды четырёх» (1994) для C++ и Smalltalk — языков, где у класса нет значения при выполнении.',
  },
  {
    k: 'порождающий паттерн',
    d: 'Паттерн про то, **как появляется объект**: кто решает, какой класс создать, в каком порядке заполнить поля, когда сделать копию и можно ли сделать второй экземпляр. Их четыре в этой теме: фабрика, строитель, прототип, одиночка.',
  },
  {
    k: 'экземпляр',
    d: 'Объект, созданный из класса через `new`. У экземпляра свои данные (поля) и общая для всех экземпляров ссылка на прототип, где лежат методы.',
  },
  {
    k: 'фабричная функция',
    d: 'Обычная функция, которая возвращает новый объект: `makeInsurance(\'tf\')` вместо `new TfInsurance()`. В JS это самая частая фабрика: ни классов, ни `new`, ни `this`.',
  },
  {
    k: 'реестр',
    d: 'Словарь «ключ → класс» или «ключ → функция-создатель». Фабрика по ключу находит, что создать. Добавить вариант — значит дописать строку в реестр, а не `if` в каждое место.',
  },
  {
    k: 'цепочка вызовов',
    d: 'Метод возвращает тот же объект (`return this`), поэтому следующий метод вызывается через точку: `builder.addFormat(\'png\').addSize(100, 50).build()`. По-английски — chainable или fluent interface.',
  },
  {
    k: 'поверхностная и глубокая копия',
    d: 'Поверхностная копия заводит новый объект, но вложенные объекты (массив, `Date`) у оригинала и копии **общие**. Глубокая копирует и вложенные. Почти все встроенные способы копируют поверхностно.',
  },
  {
    k: 'состояние модуля',
    d: 'Переменные на верхнем уровне файла-модуля. Модуль выполняется один раз, и все, кто его импортирует, видят **одни и те же** переменные. Это и есть одиночка, который JS даёт бесплатно.',
  },
];

/* ──────────────────── Раздел 0 · перед началом ──────────────────── */

export const PREREQ_NOTE = 'Тема опирается на три вещи, и все три разобраны на сайте.';

export const PREREQ = [
  {
    t: 'Класс, прототип и `#`-поля',
    d: 'Что делает `new`, где лежат методы (в прототипе, один раз на всех) и чем `#`-поле отличается от обычного. Без этого непонятно, почему копия экземпляра теряет методы или ломается на приватном поле.',
    href: '/js/object-model/',
    hrefLabel: 'Объектная модель',
    tone: 'info' as const,
  },
  {
    t: 'Что из TypeScript стирается при сборке',
    d: '`abstract`, `private`, `implements` — проверки компилятора, а не движка. Классические реализации паттернов опираются на них, и в `.js` от этих запретов не остаётся ничего.',
    href: '/tooling/typescript/#s7',
    hrefLabel: 'TypeScript на уровне типов, раздел «Классы»',
    tone: 'warn' as const,
  },
  {
    t: 'Модуль выполняется один раз',
    d: 'Импорт не копирует модуль: второй `import` получает тот же, уже выполненный. На этом держится одиночка в JS — и на этом же он ломается, когда модуль выполняется второй раз.',
    href: '/tooling/modules/#s1',
    hrefLabel: 'Модули и сборка, раздел «Три фазы»',
    tone: 'info' as const,
  },
];

/* ──────────────────── Раздел 1 · зачем ──────────────────── */

export const PLAIN_PATTERN =
  'Паттерн — как типовой узел у моряков: «булинь» не изобретают заново, его узнают и называют. Но узлы придуманы для верёвки. Если у вас вместо верёвки застёжка-молния, половина узлов не нужна, а оставшиеся вяжутся иначе. Классические паттерны придуманы для C++ и Smalltalk; в JavaScript у класса есть значение при выполнении, у функций — замыкания, у модулей — свой кеш, и часть книжных конструкций становится одной строкой.';

/**
 * С чего начинается фабрика: создание размазано по коду.
 *
 * Иллюстрация, а не исполняемый пример: тест только компилирует её (`tsc`, ошибок нет).
 */
export const PROBLEM_CODE = `interface Insurance {
  id: string;
  status: string;
  submit(): Promise<boolean>;
}
class TfInsurance implements Insurance {
  id = 'tf-1'; status = 'new';
  async submit() { return true; }        // POST в API «ТФ»
  tfDiscount() { return 0.1; }           // своё, только у «ТФ»
}
class AbInsurance implements Insurance {
  id = 'ab-1'; status = 'new';
  async submit() { return true; }        // другой API, другая анкета
}

// так выглядит код до фабрики: выбор класса — в каждом месте, где нужен полис
function onFormSubmit(partner: string) {
  const policy = partner === 'tf' ? new TfInsurance() : new AbInsurance();
  return policy.submit();
}
function onImport(partner: string) {
  const policy = partner === 'tf' ? new TfInsurance() : new AbInsurance();
  return policy.id;
}
// третий партнёр — правка во всех таких местах`;

/** Четыре паттерна: что решает каждый и что из этого JS уже даёт сам. */
export const PATTERN_ROWS: { k: string; task: string; js: string; book: string }[] = [
  {
    k: 'Фабрика',
    task: 'выбрать класс в одном месте, а не в каждом',
    js: 'класс — значение: его кладут в объект-реестр; функция, возвращающая объект, — уже фабрика',
    book: 'общая логика для всех вариантов, которую удобно держать в базовом классе фабрики',
  },
  {
    k: 'Строитель',
    task: 'собрать сложный объект по шагам',
    js: 'объект с параметрами и значениями по умолчанию закрывает большинство случаев',
    book: 'шаги накапливаются, зависят друг от друга или требуют проверки в конце',
  },
  {
    k: 'Прототип',
    task: 'сделать копию готового объекта и поменять одно поле',
    js: '`{ ...obj }` и `structuredClone` — для простых данных',
    book: 'у объекта есть класс, `#`-поля или общие вложенные объекты — копию умеет сделать только он сам',
  },
  {
    k: 'Одиночка',
    task: 'один экземпляр на всё приложение',
    js: 'переменная в модуле: модуль выполняется один раз',
    book: 'почти никогда: «второй экземпляр» в JS возникает не от `new`, а от второго выполнения модуля',
  },
];

/* ──────────────────── Раздел 2 · фабрика ──────────────────── */

/**
 * Фабричный метод в книжном виде — как в видеокурсе: абстрактная фабрика с общим `saveHistory`
 * и по наследнику на партнёра.
 *
 * Закреплено тестом: компиляция (`ts(2511)` на `new InsuranceFactory`) и вывод `FACTORY_CLASSIC_OUT`.
 */
export const FACTORY_CLASSIC_CODE = `interface Insurance { id: string; status: string }
class TfInsurance implements Insurance { id = 'tf-1'; status = 'new'; tfDiscount() { return 0.1; } }
class AbInsurance implements Insurance { id = 'ab-1'; status = 'new'; }

abstract class InsuranceFactory {
  history: string[] = [];
  abstract createInsurance(): Insurance;       // что создать — решает наследник
  saveHistory(i: Insurance) {                   // как учитывать — общее для всех
    this.history.push(i.id + ':' + i.status);
  }
}
class TfFactory extends InsuranceFactory {
  createInsurance() { return new TfInsurance(); }   // тип возврата сузился до TfInsurance
}
class AbFactory extends InsuranceFactory {
  createInsurance() { return new AbInsurance(); }
}

const tf = new TfFactory();
const policy = tf.createInsurance();
console.log(policy.tfDiscount());               // своё у «ТФ» — видно без приведения
tf.saveHistory(policy);
console.log(tf.history.join());
new InsuranceFactory();                         // ts(2511): абстрактный`;

export const FACTORY_CLASSIC_OUT = [0.1, 'tf-1:new'];

/**
 * Фабрика по реестру: три попытки типизировать одну и ту же функцию.
 *
 * `tsc` 6.0.3; закреплено тестом — коды по строкам. Вывод при выполнении — `FACTORY_REGISTRY_OUT`.
 */
export const FACTORY_REGISTRY_CODE = `class TfInsurance { id = 'tf-1'; tfDiscount() { return 0.1; } }
class AbInsurance { id = 'ab-1'; }

// 1. наивно: тип результата — объединение всех классов
const NAIVE = { tf: TfInsurance, ab: AbInsurance };
function createNaive<K extends keyof typeof NAIVE>(kind: K) {
  return new NAIVE[kind]();
}
createNaive('tf').tfDiscount();                  // ts(2339): а вдруг это AbInsurance

// 2. точный тип через InstanceType — компилятор не может его доказать
function createCast<K extends keyof typeof NAIVE>(kind: K): InstanceType<(typeof NAIVE)[K]> {
  return new NAIVE[kind]();                      // ts(2322)
}

// 3. карта «ключ → тип», а реестр описан через неё — сходится без приведений
type ByKind = { tf: TfInsurance; ab: AbInsurance };
const REGISTRY: { [K in keyof ByKind]: new () => ByKind[K] } = { tf: TfInsurance, ab: AbInsurance };
function create<K extends keyof ByKind>(kind: K): ByKind[K] {
  return new REGISTRY[kind]();
}
console.log(create('tf').tfDiscount());          // TfInsurance — видно по ключу
create('xx');                                    // ts(2345): такого партнёра нет`;

export const FACTORY_REGISTRY_OUT = [0.1];

export const FACTORY_REGISTRY_NOTES: string[] = [
  '**Класс в JS — значение, поэтому реестр — просто объект.** `{ tf: TfInsurance, ab: AbInsurance }` хранит сами конструкторы, и `new REGISTRY[kind]()` создаёт нужный. Иерархия фабрик из книги здесь сворачивается в одну функцию. Третий партнёр — одна строка в реестре.',
  '**Наивный дженерик теряет конкретный класс.** Внутри `createNaive` компилятор знает только «`K` — один из ключей», а значит, `new NAIVE[kind]()` для него — `TfInsurance | AbInsurance`. Вызов `createNaive(\'tf\')` возвращает то же объединение, и метод «ТФ» недоступен.',
  '**Карта типов решает задачу без приведения.** Тип `ByKind` говорит, какой экземпляр соответствует какому ключу, а реестр объявлен как mapped-тип поверх неё. Теперь `REGISTRY[kind]` — это «конструктор `ByKind[K]`», и результат совпадает с объявленным. Тот же приём стоит в `lib.dom.d.ts` у `document.createElement`: по строке `\'input\'` через карту `HTMLElementTagNameMap` он возвращает `HTMLInputElement`.',
];

/**
 * Фабричная функция вместо класса: замыкание вместо `#`, и цена за это.
 *
 * Закреплено тестом: вывод `FACTORY_FN_OUT`.
 */
export const FACTORY_FN_CODE = `function makeInsurance(id: string) {
  let status = 'new';                          // приватно без # — видно только замыканию
  return {
    id,
    getStatus: () => status,
    submit: async () => { status = 'sent'; return true; },
  };
}
class Policy {
  status = 'new';
  getStatus() { return this.status; }
}

const p1 = makeInsurance('tf-1');
const p2 = makeInsurance('tf-2');
console.log(p1.getStatus === p2.getStatus);                  // у каждого своя копия
console.log(new Policy().getStatus === new Policy().getStatus); // один метод в прототипе

const { submit } = p1;                         // оторвали от объекта — и ничего не сломалось
await submit();
console.log(p1.getStatus());`;

export const FACTORY_FN_OUT = [false, true, 'sent'];

export const FACTORY_FN_NOTES: string[] = [
  '**Фабричная функция — самая частая фабрика в JS.** Она возвращает обычный объект, и всё, что объявлено внутри неё, но не возвращено, доступно только методам этого объекта. Это приватность без `#` и без классов — та, которой JS обходился до 2022 года.',
  '**`this` нет — терять нечего.** Методы читают `status` из замыкания, а не из `this`, поэтому `submit`, оторванный деструктуризацией или переданный колбэком, работает. У класса так теряется `this` (раздел «Классы» темы о TypeScript).',
  '**Цена — по копии каждого метода на объект.** У класса метод один на всех, в прототипе. У фабричной функции каждый вызов создаёт новые стрелки. Сотня полисов — незаметно; сто тысяч строк таблицы — заметно. Тогда класс.',
];

/**
 * Реестр на обычном объекте и ключ из непроверенного ввода.
 *
 * Закреплено тестом: вывод `REGISTRY_KEY_OUT`.
 */
export const REGISTRY_KEY_CODE = `const REGISTRY: Record<string, new () => object> = {
  tf: class TfInsurance {},
  ab: class AbInsurance {},
};

function createFrom(kind: string) {           // kind пришёл из адреса: ?partner=…
  const Cls = REGISTRY[kind];
  if (!Cls) throw new Error('нет партнёра ' + kind);
  return new Cls();
}

const odd = createFrom('constructor');           // ключа нет — но ошибки тоже нет
console.log(odd.constructor === Object);         // создан пустой {} из Object.prototype

function createSafe(kind: string) {
  if (!Object.hasOwn(REGISTRY, kind)) throw new Error('нет партнёра ' + kind);
  return new REGISTRY[kind]();
}
try { createSafe('constructor'); } catch (e) { console.log((e as Error).message); }`;

export const REGISTRY_KEY_OUT = [true, 'нет партнёра constructor'];

export const REGISTRY_KEY_NOTE =
  'У любого объекта есть прототип, а в нём — `constructor`, `toString`, `hasOwnProperty`. Обращение `REGISTRY[\'constructor\']` находит `Object`, и проверка `if (!Cls)` проходит: фабрика молча создаёт пустой объект вместо ошибки. Пока ключ задан в коде, это невозможно, — TypeScript не даст написать несуществующий. Но ключ из адреса, формы или JSON — `string`, и тип его уже не проверит. Лечение — `Object.hasOwn`, `Map` вместо объекта или реестр, созданный через `Object.create(null)`. Как такие ключи превращаются в уязвимость при слиянии объектов — в теме [«Безопасность бэкенда», раздел «Лишние поля»](/platform/backend-security/#s4).';

/* ──────────────────── Раздел 3 · строитель ──────────────────── */

export const PLAIN_BUILDER =
  'Строитель — как заказ в кофейне по пунктам: «латте, овсяное молоко, без сахара, большой». Каждый пункт кассир записывает в один и тот же чек, а напиток готовят, когда вы сказали «всё». Опасность того же рода: если следующий покупатель продолжит **ваш** чек, он получит и ваш латте.';

/**
 * Строитель из видеокурса: `ImageBuilder`, форматы × размеры.
 *
 * Закреплено тестом: вывод `BUILDER_OUT` — 2 записи у превью, 4 у обложек вместо 2.
 */
export const BUILDER_CODE = `type ImageFormat = 'png' | 'jpeg';
interface Conversion { format: ImageFormat; width: number; height: number }

class ImageBuilder {
  private formats: ImageFormat[] = [];
  private sizes: { width: number; height: number }[] = [];
  addFormat(f: ImageFormat) {
    if (!this.formats.includes(f)) this.formats.push(f);
    return this;                                  // цепочка
  }
  addSize(width: number, height: number) {
    this.sizes.push({ width, height });
    return this;
  }
  build(): Conversion[] {                         // все сочетания формат × размер
    return this.formats.flatMap((format) => this.sizes.map((s) => ({ format, ...s })));
  }
}

// заготовка «png и jpeg», от которой строят два заказа
const base = new ImageBuilder().addFormat('png').addFormat('jpeg');
const thumbs = base.addSize(100, 50).build();
const covers = base.addSize(1200, 600).build();
console.log(thumbs.length);                       // 2
console.log(covers.length);                       // 4 — в обложки уехал размер превью`;

export const BUILDER_OUT = [2, 4];

/**
 * Неизменяемый строитель: каждый шаг возвращает новый объект.
 *
 * Закреплено тестом: вывод `FROZEN_BUILDER_OUT`.
 */
export const FROZEN_BUILDER_CODE = `type ImageFormat = 'png' | 'jpeg';
type Size = { width: number; height: number };

class ImageBuilder {
  constructor(
    private readonly formats: readonly ImageFormat[] = [],
    private readonly sizes: readonly Size[] = [],
  ) {}
  addFormat(f: ImageFormat) { return new ImageBuilder([...this.formats, f], this.sizes); }
  addSize(width: number, height: number) {
    return new ImageBuilder(this.formats, [...this.sizes, { width, height }]);
  }
  build() { return this.formats.flatMap((format) => this.sizes.map((s) => ({ format, ...s }))); }
}

const base = new ImageBuilder().addFormat('png').addFormat('jpeg');
console.log(base.addSize(100, 50).build().length);     // 2
console.log(base.addSize(1200, 600).build().length);   // 2 — заготовка не изменилась`;

export const FROZEN_BUILDER_OUT = [2, 2];

/**
 * Строитель, у которого `build()` нельзя вызвать раньше времени.
 *
 * `tsc` 6.0.3; закреплено тестом: `ts(2684)` на строке без размера, порядок шагов не важен,
 * и в выводе `tsc` нет ни следа поля `state`.
 */
export const STRICT_BUILDER_CODE = `type ImageFormat = 'png' | 'jpeg';
type Steps = { format: boolean; size: boolean };

class ImageBuilder<S extends Steps = { format: false; size: false }> {
  declare private readonly state: S;              // только для компилятора: в .js его нет
  private formats: ImageFormat[] = [];
  private sizes: { width: number; height: number }[] = [];

  addFormat(f: ImageFormat): ImageBuilder<{ format: true; size: S['size'] }> {
    this.formats.push(f);
    return this as any;
  }
  addSize(width: number, height: number): ImageBuilder<{ format: S['format']; size: true }> {
    this.sizes.push({ width, height });
    return this as any;
  }
  build(this: ImageBuilder<{ format: true; size: true }>) {
    return this.formats.flatMap((format) => this.sizes.map((s) => ({ format, ...s })));
  }
}

new ImageBuilder().addFormat('png').build();                 // ts(2684): нет размера
new ImageBuilder().addSize(100, 50).addFormat('png').build(); // порядок шагов любой`;

export const BUILDER_NOTES: string[] = [
  '**`return this` делает цепочку — и делает заготовку опасной.** Все шаги меняют один и тот же объект. `base` после `addSize(100, 50)` уже содержит этот размер, поэтому обложки получили и его: четыре записи вместо двух. Строитель «на один заказ» с изменяемым состоянием — нормально; строитель, который передают дальше как заготовку, — ошибка, которую не видно ни в типах, ни в чтении кода.',
  '**Неизменяемый строитель возвращает новый объект на каждом шаге.** Заготовку можно переиспользовать сколько угодно. Цена — копия массивов на каждый шаг; для объекта из десятка полей она не видна. Библиотеки делают по-разному: строитель запросов Knex, например, изменяемый, и чтобы использовать запрос как заготовку, у него есть `.clone()`.',
  '**Типы могут запретить `build()` раньше времени.** Параметр `S` помнит, какие шаги уже сделаны, а `build` через `this`-параметр требует, чтобы были оба. Ошибка — на компиляции, `ts(2684)`. Важная деталь: параметр, который не используется ни в одном поле, компилятор при сравнении по форме не видит, и без строки `declare private readonly state: S` проверка молча пропускает всё. `declare` не порождает кода: поле существует только для компилятора.',
];

export const BUILDER_OPTIONS_NOTE =
  'Прежде чем писать строитель, стоит проверить, не хватит ли объекта с параметрами: `convert({ formats: [\'png\', \'jpeg\'], sizes: [{ width: 100, height: 50 }] })`. Именованные поля, значения по умолчанию через деструктуризацию и проверка всех полей типом — то, ради чего строитель придумали в языках без литералов объектов. Строитель окупается, когда шаги **накапливаются** (добавить формат, ещё формат), **зависят друг от друга** или когда собранное надо **проверить целиком** в `build()`. И в строителях запросов — `select`, `where`, `orderBy` в любом порядке, — как в Mongoose.';

/* ──────────────────── Раздел 4 · прототип ──────────────────── */

export const PLAIN_PROTOTYPE =
  'В JS слово «прототип» занято: это объект, **на который ссылаются** все экземпляры класса, чтобы брать из него методы. Паттерн «прототип» — наоборот, про **копию**: взять готовый объект и сделать независимого двойника. Общее у них одно — новый объект делается от образца, а не с нуля.';

/**
 * Четыре способа скопировать экземпляр класса с `#`-полем — и что получилось.
 *
 * Закреплено тестом: исполнение, вывод `CLONE_OUT` (имя ошибки, а не её текст — текст у движков разный).
 */
export const CLONE_CODE = `class Draft {
  #createdAt: Date;
  tags = ['new'];
  constructor(public email: string, createdAt = new Date('2026-01-01')) {
    this.#createdAt = createdAt;
  }
  ageMs(now: Date) { return now.getTime() - this.#createdAt.getTime(); }
  clone() {
    const copy = new Draft(this.email, new Date(this.#createdAt));
    copy.tags = [...this.tags];
    return copy;
  }
}
const draft = new Draft('a@x.ru');
const day = new Date('2026-01-02');
const show = (label: string, f: () => unknown) => {
  try { console.log(label + ': ' + f()); } catch (e) { console.log(label + ': ' + (e as Error).name); }
};

const spread: any = { ...draft };
show('spread — класс', () => spread instanceof Draft);          // false

const assigned = Object.assign(Object.create(Draft.prototype), draft) as Draft;
show('assign — класс', () => assigned instanceof Draft);        // true
show('assign — ageMs', () => assigned.ageMs(day));              // TypeError

const cloned = structuredClone(draft);
show('structuredClone — класс', () => cloned instanceof Draft); // false

const own = draft.clone();
show('clone() — ageMs', () => own.ageMs(day));                  // 86400000 — сутки
own.tags.push('vip');
show('у оригинала tags', () => draft.tags.join());              // new — без vip`;

export const CLONE_OUT = [
  'spread — класс: false',
  'assign — класс: true',
  'assign — ageMs: TypeError',
  'structuredClone — класс: false',
  'clone() — ageMs: 86400000',
  'у оригинала tags: new',
];

/** Что сохраняет каждый способ — по выводу `CLONE_CODE` и замеру с `JSON` (см. тест). */
export const CLONE_ROWS: { k: string; cls: string; priv: string; deep: string; tone?: 'ok' | 'err' | 'warn' }[] = [
  { k: '`{ ...obj }`', cls: 'нет — обычный объект, методов нет', priv: 'нет', deep: 'нет: `tags` общий' },
  { k: '`Object.assign(Object.create(proto), obj)`', cls: 'да', priv: 'нет — метод с `#` бросает `TypeError`', deep: 'нет', tone: 'err' },
  { k: '`structuredClone(obj)`', cls: 'нет — обычный объект', priv: 'нет', deep: 'да; `Date`, `Map` сохраняет; функцию — `DataCloneError`' },
  { k: '`JSON.parse(JSON.stringify(obj))`', cls: 'нет', priv: 'нет', deep: 'да, но `Date` стал строкой, `Map` — `{}`, `undefined` пропал', tone: 'warn' },
  { k: '`obj.clone()` внутри класса', cls: 'да', priv: 'да — класс видит свои `#`-поля', deep: 'как решит класс', tone: 'ok' },
];

export const CLONE_NOTES: string[] = [
  '**Скопировать `#`-поле может только сам класс.** `#createdAt` не перечисляется, не попадает в `Object.keys`, в spread и в `structuredClone`. `Object.assign` поверх `Object.create(Draft.prototype)` даёт объект, который выглядит как `Draft`, — `instanceof` отвечает `true`, — но настоящего `#createdAt` у него нет, и первый же метод, который его читает, бросает `TypeError`. Поэтому в JS у паттерна «прототип» есть причина существовать: метод `clone()` — единственное место, откуда приватное состояние видно целиком.',
  '**`structuredClone` копирует данные, а не объект.** Глубоко, с `Date`, `Map` и циклами, но класс теряется: получается обычный объект с теми же перечислимыми полями. Для ответа API это ровно то, что нужно; для экземпляра с методами — нет. Что ещё он теряет и на чём падает — в теме [«Воркеры и параллелизм»](/js/workers/).',
];

/**
 * Копия из видеокурса: поле `createdAt` переносится присваиванием.
 *
 * Закреплено тестом: вывод `SHARED_DATE_OUT`.
 */
export const SHARED_DATE_CODE = `class History {
  constructor(public name: string, public createdAt = new Date('2026-01-01')) {}
  clone() { return new History(this.name, this.createdAt); }   // тот же Date, не копия
}
const a = new History('Аня');
const b = a.clone();
b.createdAt.setFullYear(2030);                // правим копию…
console.log(a.createdAt.getFullYear());        // …а поменялся оригинал`;

export const SHARED_DATE_OUT = [2030];

export const SHARED_DATE_NOTE =
  '`Date` — объект, и `this.createdAt` в конструкторе копии передаёт **ссылку** на тот же объект. Пока даты только читают, разницы нет. Первый `setFullYear` на копии меняет оригинал. Изменяемые вложенные объекты — `Date`, массивы, `Map` — в `clone()` копируют явно: `new Date(this.createdAt)`, `[...this.tags]`, `structuredClone(this.meta)`. Решить, что копировать глубоко, может только класс: он знает, какие из его полей общие по смыслу, а какие — нет.';

/* ──────────────────── Раздел 5 · одиночка ──────────────────── */

export const PLAIN_SINGLETON =
  'Одиночка — как единственная касса в магазине: кто бы ни пришёл, платит в одну и ту же, и чек виден всем кассирам. В JS такую кассу ставят не замком на двери (`private constructor`), а тем, что магазин строится один раз: модуль выполняется однажды, и всё, что в нём создано, — общее. Сюрпризы начинаются, когда магазин по ошибке построили дважды.';

/**
 * Одиночка из видеокурса: `private constructor` и статический `get`.
 *
 * `tsc` 6.0.3; закреплено тестом: `ts(2673)` на `new MyMap()`, вывод `SINGLETON_CLASS_OUT`.
 */
export const SINGLETON_CLASS_CODE = `class MyMap {
  private static instance: MyMap;
  map = new Map<number, string>();
  private constructor() {}
  static get(): MyMap {
    if (!MyMap.instance) MyMap.instance = new MyMap();
    return MyMap.instance;
  }
}

// сервис 1 пишет, сервис 2 читает — через одну и ту же карту
MyMap.get().map.set(1, 'работает');
console.log(MyMap.get().map.get(1));

new MyMap();                                       // ts(2673): конструктор закрыт…
const second = new (MyMap as any)();              // …но только для компилятора
console.log(second === MyMap.get());`;

export const SINGLETON_CLASS_OUT = ['работает', false];

/**
 * Одиночка, который даёт сам язык: состояние модуля.
 *
 * Тест раскладывает файлы во временную папку и запускает `node main.mjs` отдельным процессом;
 * вывод — `MODULE_OUT`.
 */
export const MODULE_FILES: { path: string; code: string }[] = [
  {
    path: 'policies.mjs',
    code: `export const policies = new Map();     // один на всех, кто импортирует
console.log('policies.mjs выполнен');`,
  },
  {
    path: 'main.mjs',
    code: `import { policies } from './policies.mjs';
const again = await import('./policies.mjs');
const fresh = await import('./policies.mjs?v=2');      // тот же файл, другой адрес

console.log(policies === again.policies);
console.log(policies === fresh.policies);`,
  },
];

/** Несколько файлов — одним блоком кода, с именем файла над каждым. */
const asFiles = (files: { path: string; code: string }[]) =>
  files.map((f) => `// ── ${f.path}\n${f.code}`).join('\n\n');

export const MODULE_CODE = asFiles(MODULE_FILES);

export const MODULE_OUT = ['policies.mjs выполнен', 'policies.mjs выполнен', 'true', 'false'];

/**
 * Две копии одного пакета — два «одиночки»; `Symbol.for` на `globalThis` сводит их в один.
 *
 * Тест раскладывает `node_modules` с двумя копиями `cache-lib` и запускает `node app.mjs`;
 * вывод — `DUPLICATE_OUT`.
 */
export const DUPLICATE_FILES: { path: string; code: string }[] = [
  {
    path: 'node_modules/cache-lib/index.mjs',
    code: `// копия, которую принёс пакет widgets, и копия, которую принёс charts, — один и тот же файл
export class Cache {}
export const cache = new Map();

const KEY = Symbol.for('cache-lib.shared');      // ключ общий для всего процесса
export const shared = (globalThis[KEY] ??= new Map());`,
  },
  {
    path: 'app.mjs',
    code: `import * as A from 'widgets';       // внутри: node_modules/widgets/node_modules/cache-lib
import * as B from 'charts';        // внутри: node_modules/charts/node_modules/cache-lib

console.log(A.cache === B.cache);                 // два модуля — две карты
console.log(new A.Cache() instanceof B.Cache);     // и два разных класса
console.log(A.shared === B.shared);               // а через Symbol.for — одна`,
  },
];

export const DUPLICATE_CODE = asFiles(DUPLICATE_FILES);

export const DUPLICATE_OUT = ['false', 'false', 'true'];

/**
 * Состояние модуля на сервере с SSR: один «одиночка» на все запросы.
 *
 * Закреплено тестом: исполнение с настоящими таймерами, вывод `SSR_LEAK_OUT`.
 */
export const SSR_LEAK_CODE = `let currentUser = '';                      // состояние модуля: одно на весь процесс сервера
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function renderProfile(user: string, dbMs: number) {
  currentUser = user;
  await delay(dbMs);                          // пока ждём базу, пришёл другой запрос
  return user + ' видит профиль ' + currentUser;
}

const pages = await Promise.all([renderProfile('Аня', 20), renderProfile('Борис', 5)]);
console.log(pages.join(' / '));`;

export const SSR_LEAK_OUT = ['Аня видит профиль Борис / Борис видит профиль Борис'];

export const SINGLETON_NOTES: string[] = [
  '**`private constructor` — запрет компилятора, а не движка.** `new MyMap()` в TypeScript — `ts(2673)`, а в `.js` слова `private` нет, и `new` создаёт второй экземпляр. Защищать одиночку от `new` в JS незачем: проще не давать классу выйти из модуля и экспортировать готовый экземпляр.',
  '**Модуль — одиночка, который язык даёт бесплатно.** `export const policies = new Map()` выполняется один раз, второй `import` получает тот же объект, но `policies.mjs выполнен` напечатано дважды. Модуль кешируется **по адресу**, а `?v=2` — другой адрес, поэтому файл выполнен второй раз и карта новая. Ровно так HMR подменяет модуль: добавляет к адресу метку, и всё состояние модуля начинается с нуля (тема [HMR, раздел «Граф и метка в адресе»](/tooling/hmr/#s1)).',
  '**Две копии пакета — два одиночки и два класса.** Если пакетный менеджер положил `cache-lib` дважды — потому что `widgets` и `charts` требуют несовместимых версий, — каждая копия выполнится отдельно. Карт две, и `instanceof` между копиями отвечает `false`. Тот же эффект даёт пакет, который загрузили и как ESM, и как CommonJS, — это разобрано в теме [«Публикация пакетов», раздел «ESM и CJS»](/tooling/package-publishing/#s3). Библиотеки, которым нужен один экземпляр на процесс, кладут его в `globalThis` под ключом `Symbol.for(…)`: этот реестр символов общий для всех копий.',
  '**На сервере «одно на приложение» значит «одно на всех пользователей».** В браузере модуль живёт на одной вкладке одного человека. На сервере с SSR тот же модуль обслуживает все запросы сразу, и переменная модуля, куда запрос положил «текущего пользователя», видна соседнему запросу, пока первый ждёт базу. Аня получает профиль Бориса — без единой ошибки. Состояние запроса передают аргументом, держат в объекте запроса или в `AsyncLocalStorage` (тема [«Асинхронный контекст»](/js/async-context/)).',
];

export const SINGLETON_DI_NOTE =
  'В приложении с внедрением зависимостей одиночек объявляют, а не пишут. Angular делает сервис одиночкой через `providedIn: \'root\'`, NestJS — по умолчанию. Разница с модулем принципиальная: контейнер создаёт экземпляр сам и может **подменить** его в тесте или выдать отдельный на поддерево. С переменной модуля так нельзя — её импортируют напрямую. Как устроены такие контейнеры — в теме [«Внедрение зависимостей»](/frameworks/dependency-injection/).';

/* ──────────────────── Раздел 6 · тонкие места ──────────────────── */

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: '`abstract` и `private constructor` не доживают до `.js`',
    d: 'Книжные реализации порождающих паттернов держатся на запретах: «эту фабрику нельзя создать», «этот конструктор нельзя вызвать». В TypeScript оба — проверки компилятора (`ts(2511)`, `ts(2673)`), в собранном коде их нет. Любой JS-код, `as any` или тест на чистом JS создадут то, что «нельзя». Если запрет важен при выполнении, его делают средствами языка: не экспортируют класс, а экспортируют готовый экземпляр или функцию-фабрику.',
    tone: 'warn',
  },
  {
    n: '02',
    t: 'Фабрика на `switch` молча возвращает `undefined` на новом варианте',
    d: 'Добавили партнёра в тип, забыли в `switch` — функция дошла до конца и вернула `undefined`, а упало где-то дальше, на `policy.submit()`. Лечится строкой `default: return assertNever(kind)`: компилятор покажет каждую такую фабрику, как только тип расширится. Приём разобран в теме [«TypeScript на уровне типов», раздел «Сужение»](/tooling/typescript/#s2). Реестр-объект с типом `{ [K in Kind]: … }` защищает так же: без нового ключа он не скомпилируется.',
    tone: 'err',
  },
  {
    n: '03',
    t: '`instanceof` не работает между копиями пакета и между окнами',
    d: 'Класс — это объект, и `instanceof` сравнивает прототипы по ссылке. Две копии пакета — два разных класса `Cache`, и экземпляр одного не `instanceof` другого. То же между `iframe` и основной страницей: у каждого окна свой `Array`, поэтому есть `Array.isArray`. Проверку «это наш полис?» надёжнее делать по полю-метке (`kind: \'tf\'`), чем по классу.',
  },
  {
    n: '04',
    t: 'Цепочка в строителе-наследнике возвращает базовый тип',
    d: 'Если `addFormat` объявлен в `ImageBuilder` с возвратом `ImageBuilder`, то `new WebpBuilder().addFormat(\'png\').addWebp()` не скомпилируется: после первого шага тип — базовый. Возвращайте `this` **как тип** (`addFormat(f): this`) — цепочка сохранит наследника. Подробно — в теме [«TypeScript на уровне типов», раздел «Вариантность»](/tooling/typescript/#s6), подраздел «Полиморфный `this`».',
  },
  {
    n: '05',
    t: '`JSON.parse(JSON.stringify(x))` — не клонирование',
    d: 'Старый приём глубокой копии. `Date` превращается в строку `\'2026-01-01T00:00:00.000Z\'`, `Map` и `Set` — в `{}`, `undefined` и функции исчезают, `BigInt` бросает `TypeError`, цикл — тоже. Ошибки при этом нет: копия просто другая. Для данных есть `structuredClone`, для экземпляров класса — их собственный `clone()`.',
    tone: 'err',
  },
  {
    n: '06',
    t: 'Одиночку трудно подменить в тесте',
    d: '`MyMap.get()` внутри сервиса — скрытая зависимость: в сигнатуре её нет, и тест не может подсунуть пустую карту вместо общей. Состояние к тому же переживает тест и достаётся следующему. Варианты: передавать зависимость аргументом или в конструктор (тогда это уже внедрение зависимостей), а у модульного состояния — экспортировать функцию сброса для тестов.',
  },
];

/* ──────────────────── Раздел 7 · источники ──────────────────── */

/** ⚠️ Без разметки: `SourceList` печатает `title` и `what` как есть. */
export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'patterns.dev — Design Patterns',
    href: 'https://www.patterns.dev/vanilla/',
    what: 'паттерны глазами JavaScript: модуль как одиночка, фабричные функции, прототип через Object.create',
  },
  {
    title: 'Refactoring Guru — порождающие паттерны',
    href: 'https://refactoring.guru/ru/design-patterns/creational-patterns',
    what: 'классические схемы и примеры на TypeScript',
  },
  {
    title: 'TypeScript Handbook — Classes',
    href: 'https://www.typescriptlang.org/docs/handbook/2/classes.html',
    what: 'abstract, private constructor, this-типы и this-параметры',
  },
  {
    title: 'MDN — structuredClone',
    href: 'https://developer.mozilla.org/en-US/docs/Web/API/Window/structuredClone',
    what: 'что копирует алгоритм структурного клонирования и на чём падает',
  },
  {
    title: 'MDN — Private properties',
    href: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Classes/Private_properties',
    what: 'почему #-поле нельзя прочитать у объекта, созданного не конструктором класса',
  },
  {
    title: 'Node.js — ECMAScript modules, URLs',
    href: 'https://nodejs.org/api/esm.html#urls',
    what: 'модули кешируются по адресу, и строка запроса даёт новый экземпляр',
  },
  {
    title: 'MDN — Symbol.for',
    href: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Symbol/for',
    what: 'глобальный реестр символов, общий для всех копий кода в одном окружении',
  },
];

export const RELATED =
  'Смежное на сайте: [Объектная модель](/js/object-model/) — прототип, `new` и `#`-поля, на которых держатся фабрика и копирование. [TypeScript на уровне типов, раздел «Классы»](/tooling/typescript/#s7) — что из классов стирается при сборке. [Внедрение зависимостей](/frameworks/dependency-injection/) — одиночки и фабрики, которые создаёт контейнер. [Модули и сборка](/tooling/modules/) — почему модуль выполняется один раз. [Замыкания](/js/closures/) — откуда у фабричной функции приватное состояние.';
