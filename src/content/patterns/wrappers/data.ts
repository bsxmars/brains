import type { Pitfall } from '@/widgets/pitfalls/model/types';

/**
 * Данные темы «Обёртки: адаптер, фасад, заместитель, декоратор, мост».
 *
 * Источник — видеокурс по TypeScript из папки автора: ролики 106–109 раздела о паттернах
 * (мост, фасад, адаптер, прокси) и ролик 083 о паттерне декоратора; расшифрованы whisper.
 * Из курса взяты сквозные примеры и классические реализации: `KVDatabase` и
 * `PersistentDBAdapter`, `NotificationFacade` над `Notify`/`Log`/`Template`,
 * `PaymentAccessProxy`, «декораторы» `nullUser`/`logUsers`, `NotificationSender` с провайдерами.
 * Угол темы — не UML, а **что JS, TypeScript и платформа уже делают сами** и где книжная
 * версия ломается на особенностях языка.
 *
 * ── Чем проверено ───────────────────────────────────────────────────────────────────────
 * Каждый пример — строка в этом файле, и `tests/unit/patterns-wrappers.test.ts` берёт
 * **эту строку**: TypeScript-примеры компилируются `tsc` 6.0.3 со `strict`, ошибки сверяются
 * с пометками `// ts(NNNN)` по строкам; вывод сверяется с массивами `*_OUT`, полученными
 * исполнением в Node 26.8.2. `PROMISIFY_CODE` тест стирает от типов и запускает настоящим
 * `node` (в нём `import 'node:util'`), `FETCH_CODE` ходит в настоящий HTTP-сервер на `localhost`,
 * `DECORATOR_SYNTAX_CODE` проходит через эмит TypeScript — в Node 26.8.2 синтаксиса `@` нет.
 *
 * Найдено запуском и стоит знать (курс этого не говорит):
 *   — `private`-поле делает класс «номинальным»: объект с тем же публичным методом не подходит
 *     туда, где ждут класс (`ts(2345)`, «Property 'db' is missing»), — поэтому адаптер в курсе
 *     вынужден наследовать базу, которую адаптирует;
 *   — `promisify(store.load)` отрывает метод от объекта: внутри `this === undefined`, и промис
 *     отклоняется `TypeError`;
 *   — `fetch` на ответ 500 **выполняется**, а не отклоняется (`ok: false`), и `res.json()`
 *     в `lib.dom.d.ts` — `Promise<any>`: аннотация `User` ничего не проверяет;
 *   — заместитель-класс не компилируется, пока не реализует новый метод интерфейса
 *     (`ts(2420)`), а встроенный `Proxy` пропускает новый метод к цели без проверки;
 *   — кеширующий заместитель, который хранит промис, хранит и **отказ**: сеть моргнула один
 *     раз — ошибка отдаётся до перезагрузки;
 *   — «декоратор» из курса меняет переданный объект: необёрнутый сервис тоже обнулён;
 *     спред вместо обёртки теряет методы класса (`ts(2339)`);
 *   — стопка `@`-декораторов применяется снизу вверх, а вызывается сверху вниз;
 *   — Vue собирает DOM-рендерер мостом: `runtime-dom` передаёт `createRenderer` объект
 *     `extend({ patchProp }, nodeOps)` (проверено по `@vue/runtime-dom` 3.5.42 в `node_modules`).
 */

/* ──────────────────── Вводный раздел · словарь ──────────────────── */

export const PLAIN_WRAPPER =
  'Обёртка — как переходник, пульт и секретарь сразу. Переходник позволяет вставить чужую вилку в вашу розетку. Пульт от кондиционера даёт три кнопки вместо платы с проводами. Секретарь пропускает к директору не всех. Во всех трёх случаях между вами и устройством стоит ещё один объект. Разница — в том, **зачем** он там стоит. Пять паттернов этой темы устроены одинаково: один объект держит ссылку на другой и передаёт ему вызовы. Различаются они целью.';

export const GLOSSARY = [
  {
    k: 'обёртка',
    d: 'Объект, который хранит ссылку на другой объект и вызывает его методы, добавляя что-то своё: перевод, проверку, запись в журнал. Снаружи с обёрткой работают как с обычным объектом.',
  },
  {
    k: 'структурный паттерн',
    d: 'Паттерн о том, **как объекты собраны вместе**: кто кого держит и через что с ним говорит. В книге «банды четырёх» их семь; пять из них — обёртки этой темы.',
  },
  {
    k: 'интерфейс',
    d: 'Список методов и полей, которые объект обещает. В TypeScript это `interface`, но и без него у любого объекта есть интерфейс — набор того, что у него можно вызвать.',
  },
  {
    k: 'композиция',
    d: 'Объект получает другой объект и пользуется им, вместо того чтобы от него наследоваться. «Имеет», а не «является». Все обёртки построены на композиции.',
  },
  {
    k: 'делегирование',
    d: 'Обёртка не делает работу сама, а передаёт вызов внутреннему объекту: `inner.save(key, value)`. Свой код она добавляет до или после этого вызова.',
  },
  {
    k: 'структурная типизация',
    d: 'TypeScript сравнивает типы по форме: подходит любой объект, у которого есть нужные поля и методы, как бы он ни был создан. Исключение — классы с `private` и `#`-полями.',
  },
  {
    k: 'функция высшего порядка',
    d: 'Функция, которая принимает функцию или возвращает её. `debounce(fn, 300)` — пример: берёт функцию и возвращает новую, обёрнутую. Это декоратор для функций.',
  },
];

/* ──────────────────── Раздел 0 · перед началом ──────────────────── */

export const PREREQ_NOTE = 'Тема опирается на четыре вещи, и все четыре разобраны на сайте.';

export const PREREQ = [
  {
    t: 'Класс, `this` и методы в прототипе',
    d: 'Что делает `new`, где лежат методы и почему спред экземпляра теряет их. Без этого непонятно, почему обёртка — другой объект, а не тот же самый.',
    href: '/js/object-model/#s4',
    hrefLabel: 'Объектная модель, раздел «Классы»',
    tone: 'info' as const,
  },
  {
    t: '`interface` и `implements`',
    d: 'Что TypeScript проверяет в классе, который обещает интерфейс, и что стирается при сборке. Все книжные обёртки держатся на одном интерфейсе снаружи и внутри.',
    href: '/tooling/typescript/#s7',
    hrefLabel: 'TypeScript на уровне типов, раздел «Классы»',
    tone: 'info' as const,
  },
  {
    t: 'Почему метод теряет `this`',
    d: '`this` определяется в момент вызова. Метод, переданный в чужую функцию без объекта, получает `this === undefined`. На этом спотыкаются функции-адаптеры.',
    href: '/js/callbacks/#s4',
    hrefLabel: 'Колбэки, раздел «`this` в колбэке»',
    tone: 'warn' as const,
  },
  {
    t: 'Встроенный `Proxy` и ловушка `get`',
    d: '`new Proxy(target, { get })` перехватывает чтение любого свойства. Заместитель в JS часто пишут на нём, а не классом.',
    href: '/js/proxy-reflect/#s1',
    hrefLabel: 'Proxy и Reflect, раздел «Ловушка и Reflect»',
    tone: 'info' as const,
  },
];

/* ──────────────────── Раздел 1 · зачем ──────────────────── */

/** Пять обёрток: что видит код снаружи, ради чего обёртка стоит и что из этого уже есть. */
export const WRAPPER_ROWS: { k: string; outside: string; why: string; js: string }[] = [
  {
    k: 'Адаптер',
    outside: 'тот интерфейс, который ждёт ваш код, — а внутри чужой',
    why: 'подружить готовый код с объектом, который ему не подходит',
    js: '`util.promisify` в Node; функция, которая переводит ответ API в ваши типы',
  },
  {
    k: 'Фасад',
    outside: 'новый, короче и проще, чем у всех объектов под ним',
    why: 'спрятать несколько объектов и порядок работы с ними за одним методом',
    js: 'модуль, который экспортирует две функции и прячет остальное',
  },
  {
    k: 'Заместитель',
    outside: 'тот же, что у объекта внутри',
    why: 'решить, пускать ли вызов дальше: проверка доступа, кеш, отложенная загрузка',
    js: 'встроенный `Proxy` — перехват без перечисления методов',
  },
  {
    k: 'Декоратор',
    outside: 'тот же, что у объекта внутри',
    why: 'добавить поведение — журнал, кеш, повтор — и складывать обёртки стопкой',
    js: 'функция высшего порядка (`debounce`); синтаксис `@` для методов класса',
  },
  {
    k: 'Мост',
    outside: 'свой у абстракции; реализация подставляется снаружи',
    why: 'развести две независимые оси изменений, чтобы классы не множились',
    js: 'рендереры Vue и React: ядро отдельно, операции с DOM — отдельно',
  },
];

export const WRAPPERS_NOTE =
  'По коду их часто не отличить: объект держит другой объект и зовёт его методы. Отличает вопрос «зачем». Адаптер и мост похожи сильнее всех, но адаптер ставят **потом**, когда два готовых куска не сошлись, а мост закладывают **заранее**, когда видно, что вариантов будет много по двум осям. Заместитель и декоратор оба сохраняют интерфейс, но заместитель решает, **пускать ли** вызов, а декоратор **добавляет** к нему работу.';

/* ──────────────────── Раздел 2 · адаптер ──────────────────── */

export const PLAIN_ADAPTER =
  'Адаптер — переходник для розетки. Чайник не переделывают, стену не долбят: между ними ставят маленькую штуку, у которой с одной стороны ваша форма, с другой — чужая. В коде то же: ни ваш код, ни чужую библиотеку не трогают, а пишут прослойку, которая переводит вызовы.';

/**
 * Адаптер из видеокурса: `PersistentDBAdapter extends KVDatabase`.
 *
 * `tsc` 6.0.3; закреплено тестом: `ts(2345)` на объекте без `extends`, вывод `ADAPTER_OUT`.
 */
export const ADAPTER_CODE = `class KVDatabase {
  private db = new Map<string, string>();
  save(key: string, value: string) { this.db.set(key, value); }
}
class PersistentDB {                                  // сторонняя библиотека
  savePersistent(data: object) { console.log('persistent: ' + JSON.stringify(data)); }
}
function run(base: KVDatabase) {                      // код, который знает только KVDatabase
  base.save('key', 'myValue');
}

// книжный адаптер: наследует KVDatabase, а внутри зовёт PersistentDB
class PersistentDBAdapter extends KVDatabase {
  constructor(private database: PersistentDB) { super(); }
  override save(key: string, value: string) {
    this.database.savePersistent({ key, value });
  }
}
run(new PersistentDBAdapter(new PersistentDB()));

// зачем extends? без него проверку не пройти
run({ save: (key: string, value: string) => {} });    // ts(2345): нет свойства db`;

export const ADAPTER_OUT = ['persistent: {"key":"key","value":"myValue"}'];

/**
 * Тот же адаптер, когда `run` зависит от интерфейса, а не от класса.
 *
 * Закреплено тестом: компилируется чисто, вывод `ADAPTER_IFACE_OUT`.
 */
export const ADAPTER_IFACE_CODE = `class PersistentDB {
  savePersistent(data: object) { console.log('persistent: ' + JSON.stringify(data)); }
}
interface KeyValueStore {                             // run просит то, что ему нужно, — один метод
  save(key: string, value: string): void;
}
function run(store: KeyValueStore) { store.save('key', 'myValue'); }

const persistent = new PersistentDB();
run({ save: (key, value) => persistent.savePersistent({ key, value }) });   // адаптер — один объект`;

export const ADAPTER_IFACE_OUT = ['persistent: {"key":"key","value":"myValue"}'];

export const ADAPTER_NOTES: string[] = [
  '**`private` делает класс «номинальным».** Обычно TypeScript сравнивает типы по форме, и объект с методом `save` подошёл бы. Но у `KVDatabase` есть `private db`, а закрытое поле совпадает только с самим собой: подходит экземпляр этого класса или наследника, и больше никто. С `#db` то же самое. Поэтому книжный адаптер вынужден наследовать базу, которую адаптирует, — и тащит в себя её пустую `Map`, которой не пользуется.',
  '**Зависимость от интерфейса снимает проблему.** Если `run` просит `KeyValueStore` — «что-то с методом `save`», — адаптером становится объект из одной строки, а `new KVDatabase()` подходит без правок. Класс-адаптер нужен, когда переводить приходится много методов или у перевода есть своё состояние.',
  '**Самый частый адаптер во фронтенде — функция на границе с API.** Сервер присылает `created_at` строкой, а код хочет `createdAt: Date`. Функция `toUser(dto)` в одном месте переводит имена и типы, и остальной код не знает, как выглядел ответ. Это тот же адаптер, только без класса.',
];

/**
 * Адаптер, который Node даёт сам: `util.promisify` — колбэк → промис.
 *
 * Тест стирает типы, кладёт результат во временный `.mjs` и запускает настоящим `node`:
 * вывод `PROMISIFY_OUT`. Компилируется с `@types/node`, ошибок нет.
 */
export const PROMISIFY_CODE = `import { promisify } from 'node:util';

class LegacyStore {                                   // старый API на колбэках
  prefix = 'user-';
  load(id: number, cb: (err: Error | null, value?: string) => void) {
    const key = this.prefix + id;
    setTimeout(() => cb(null, key), 1);
  }
}
const store = new LegacyStore();

const load = promisify(store.load);                   // метод оторван от объекта
try { await load(1); } catch (e) { console.log((e as Error).name); }

const loadBound = promisify(store.load.bind(store));  // привязали this
console.log(await loadBound(1));`;

export const PROMISIFY_OUT = ['TypeError', 'user-1'];

export const PROMISIFY_NOTE =
  '`promisify` — адаптер из стандартной библиотеки Node: берёт функцию в стиле «последний аргумент — колбэк `(err, value)`» и возвращает функцию, которая отдаёт промис. Но получает он **функцию**, а не метод с объектом. `store.load` без точки перед вызовом — это функция без `this`, и чтение `this.prefix` бросает `TypeError`, который превращается в отказ промиса. Типы этого не видят: `promisify(store.load)` компилируется. Лечение — `bind` или стрелка `(id, cb) => store.load(id, cb)`. Тот же разрыв ждёт любой самописный адаптер, который принимает метод.';

/* ──────────────────── Раздел 3 · фасад ──────────────────── */

export const PLAIN_FACADE =
  'Фасад — как кнопка «Отправить» в мессенджере. Под ней запрос на сервер, запись в базу, пуш-уведомление собеседнику. Вам не нужно знать порядок этих шагов: одна кнопка делает всё. Фасад в коде — та же кнопка: один простой метод вместо нескольких объектов, которые надо вызвать в правильном порядке.';

/**
 * Фасад из видеокурса: `NotificationFacade` над тремя сервисами.
 *
 * Закреплено тестом: вывод `FACADE_OUT` — оба вызова возвращают `undefined`.
 */
export const FACADE_CODE = `class Notify {
  send(template: string, to: string) { console.log('отправляю ' + template + ' → ' + to); }
}
class Log {
  log(message: string) { console.log(message); }
}
class Template {
  private templates = [{ name: 'other', template: '<h1>Шаблон</h1>' }];
  getByName(name: string) { return this.templates.find((t) => t.name === name); }
}

class NotificationFacade {
  private notify = new Notify();
  private template = new Template();
  private logger = new Log();

  send(to: string, templateName: string) {
    const data = this.template.getByName(templateName);
    if (!data) {
      this.logger.log('не найден шаблон');
      return;
    }
    this.notify.send(data.template, to);
    this.logger.log('шаблон отправлен');
  }
}

const facade = new NotificationFacade();
console.log(facade.send('a@x.ru', 'other'));          // отправлено
console.log(facade.send('a@x.ru', 'welcome'));        // не отправлено — снаружи не отличить`;

export const FACADE_OUT = [
  'отправляю <h1>Шаблон</h1> → a@x.ru',
  'шаблон отправлен',
  undefined,
  'не найден шаблон',
  undefined,
];

export const FACADE_NOTES: string[] = [
  '**Фасад решает, что знает вызывающий.** Снаружи — один метод `send`. Внутри — три сервиса, их порядок и проверка «шаблон нашёлся». Добавить четвёртый шаг, например запись в базу, можно, не трогая ни одного места вызова.',
  '**Простота может спрятать и то, что прятать нельзя.** Успех и неудача возвращают одно и то же — `undefined`. Неудача видна только в журнале, и вызывающий код не может её обработать. У фасада два честных выхода: вернуть результат (`true`/`false` или объект с причиной) или бросить ошибку.',
  '**Фасад не обязан быть классом.** В JS естественный фасад — модуль: он экспортирует `send`, а `Notify`, `Log` и `Template` остаются внутри файла. Класс с `new Notify()` в конструкторе к тому же трудно тестировать: сервисы создаются внутри, и подменить их нечем. Если подмена нужна, сервисы передают в конструктор.',
];

/**
 * Фасад над `fetch`: что `fetch` не делает сам.
 *
 * Тест поднимает HTTP-сервер на `localhost`, который на любой запрос отвечает 500 с телом
 * `{"error":"boom"}`, и передаёт его адрес как `API`. Вывод — `FETCH_OUT`.
 */
export const FETCH_CODE = `declare const API: string;                            // адрес бэкенда
interface User { id: number; name: string }

const res = await fetch(API + '/users/1');            // сервер ответил 500
const user: User = await res.json();                  // json() — Promise<any>: тип не проверен
console.log(res.ok + ' ' + res.status + ' ' + user.name);

class HttpError extends Error {
  constructor(readonly status: number) { super('HTTP ' + status); }
}
async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(API + path, { signal, headers: { accept: 'application/json' } });
  if (!res.ok) throw new HttpError(res.status);
  return res.json();
}
try { await getJson<User>('/users/1'); } catch (e) { console.log((e as Error).message); }`;

export const FETCH_OUT = ['false 500 undefined', 'HTTP 500'];

export const FETCH_NOTES: string[] = [
  '**`fetch` не считает 404 и 500 ошибкой.** Промис отклоняется, только если ответа нет вовсе: сеть, DNS, отмена. Ответ сервера с любым статусом — это успех, просто с `ok: false`. Код без фасада получает `user.name === undefined` и падает дальше, в другом месте. Проверка `res.ok` — первое, ради чего пишут обёртку над `fetch`.',
  '**`res.json()` возвращает `Promise<any>`.** Так объявлено в `lib.dom.d.ts`. Аннотация `const user: User` — обещание программиста, а не проверка: компилятор принимает любой `any`. `getJson<User>` честнее не стал — он лишь собрал это обещание в одно место. Если форма ответа важна, её проверяют при выполнении, там же, в фасаде.',
  '**Фасад должен пропускать то, что нужно вызывающему.** `signal` в `getJson` — пример: без него запрос через фасад нельзя отменить. Как работает отмена у `fetch` — в теме [«Отмена: AbortController и AbortSignal», раздел «fetch»](/js/abort-controller/#s3).',
];

/* ──────────────────── Раздел 4 · заместитель ──────────────────── */

export const PLAIN_PROXY =
  'Заместитель — как секретарь у директора. Снаружи вы обращаетесь «к директору» тем же способом, но сначала секретарь решает: пустить, попросить подождать или ответить сам, потому что директор на этот вопрос уже отвечал. У заместителя тот же интерфейс, что у объекта за ним, — поэтому код вызова о нём не знает.';

/**
 * Заместитель из видеокурса и он же на встроенном `Proxy`; в интерфейс добавлен `refund`.
 *
 * `tsc` 6.0.3; закреплено тестом: `ts(2420)` на классе-заместителе, вывод `PROXY_OUT`
 * (строку с ошибкой компиляции тест выполняет как есть — класс в `.js` собирается).
 */
export const PROXY_CODE = `interface PaymentDetails { id: number; sum: number }
interface IPaymentAPI {
  getPaymentDetails(id: number): PaymentDetails | undefined;
  refund(id: number): string;                         // метод добавили позже
}
class PaymentAPI implements IPaymentAPI {
  private data = [{ id: 1, sum: 10000 }];
  getPaymentDetails(id: number) { return this.data.find((p) => p.id === id); }
  refund(id: number) { return 'возврат ' + id; }
}

// книжный заместитель: тот же интерфейс, проверка доступа перед вызовом
class PaymentAccessProxy implements IPaymentAPI {     // ts(2420): refund не реализован
  constructor(private api: IPaymentAPI, private userId: number) {}
  getPaymentDetails(id: number) {
    if (this.userId !== 1) return undefined;
    return this.api.getPaymentDetails(id);
  }
}

// то же на встроенном Proxy: всё, что не перехвачено, проходит к цели
function guard(api: IPaymentAPI, userId: number): IPaymentAPI {
  return new Proxy(api, {
    get(target, key, receiver) {
      if (key === 'getPaymentDetails' && userId !== 1) return () => undefined;
      return Reflect.get(target, key, receiver);
    },
  });
}
const stranger = guard(new PaymentAPI(), 2);
console.log(stranger.getPaymentDetails(1));           // закрыто
console.log(stranger.refund(1));                      // новый метод — открыт`;

export const PROXY_OUT = [undefined, 'возврат 1'];

export const PROXY_NOTES: string[] = [
  '**Класс-заместитель закрыт по умолчанию.** Он отвечает только на те методы, которые в нём написаны. Добавили `refund` в интерфейс — компилятор не соберёт заместитель, пока в нём нет `refund` (`ts(2420)`). Это неудобно, зато ни один новый метод не проскочит мимо проверки.',
  '**Встроенный `Proxy` открыт по умолчанию.** Ловушка `get` видит каждое чтение свойства, и ни один метод не надо перечислять. Но всё, что ловушка не узнала, уходит к цели как есть: `refund` чужому пользователю доступен, и типы не скажут ни слова — `guard` возвращает тот же `IPaymentAPI`. Для проверки доступа такой заместитель пишут наоборот: список разрешённого, а всё прочее — отказ.',
  '**У встроенного `Proxy` своя цена.** Прокси — другой объект: `proxy !== target`, и `#`-поля цели через него не читаются — метод, который их трогает, бросает `TypeError`. Это разобрано в теме [«Proxy и Reflect», раздел «Личность и слоты»](/js/proxy-reflect/#s5).',
];

/**
 * Кеширующий заместитель: кешируется промис, и вместе с ним — отказ.
 *
 * Закреплено тестом: вывод `CACHE_OUT`; с вставленной строкой `CACHE_FIX_LINE` — `CACHE_FIX_OUT`.
 */
export const CACHE_CODE = `interface PaymentDetails { id: number; sum: number }
interface PaymentLoader { load(id: number): Promise<PaymentDetails> }

class CachedPayments implements PaymentLoader {
  private cache = new Map<number, Promise<PaymentDetails>>();
  constructor(private api: PaymentLoader) {}
  load(id: number) {
    let p = this.cache.get(id);
    if (!p) {
      p = this.api.load(id);
      this.cache.set(id, p);                          // кешируем промис, а не значение
    }
    return p;
  }
}

let requests = 0;
const api: PaymentLoader = {
  async load(id) {
    requests++;
    if (requests === 1) throw new Error('сеть моргнула');
    return { id, sum: 10000 };
  },
};
const payments = new CachedPayments(api);

const both = await Promise.allSettled([payments.load(1), payments.load(1)]);
console.log(requests + ' ' + both.map((r) => r.status).join());
const again = await payments.load(1).then((p) => 'сумма ' + p.sum, (e: Error) => e.message);
console.log(requests + ' ' + again);`;

export const CACHE_OUT = ['1 rejected,rejected', '1 сеть моргнула'];

/** Строка, которую тест вставляет в `load()` сразу после `this.cache.set(id, p);`. */
export const CACHE_FIX_LINE = `      p.catch(() => this.cache.delete(id));           // отказ забываем — следующий вызов спросит снова`;

/** Как строка напечатана на странице: с подписью, куда она встаёт. */
export const CACHE_FIX_CODE = `// в load(), сразу после this.cache.set(id, p):\n${CACHE_FIX_LINE.trim()}`;

export const CACHE_FIX_OUT = ['1 rejected,rejected', '2 сумма 10000'];

export const CACHE_NOTES: string[] = [
  '**Кешировать промис, а не значение, — правильно.** Два одновременных вызова получили один промис, и запрос ушёл один. Кеш значений этого не умеет: пока первый ответ не пришёл, значения ещё нет, и второй вызов пошёл бы в сеть сам.',
  '**Но промис помнит и отказ.** Первый запрос упал на секунду — и ошибка лежит в кеше, пока жива страница. Третий вызов не идёт в сеть вовсе: `requests` так и остался 1. Лечение — одна строка в `load()`: при отказе удалить запись. После неё третий вызов делает второй запрос и получает сумму.',
  '**Кеш без предела растёт без предела.** `Map` в заместителе хранит каждый `id`, о котором спросили. Для пары справочников это нормально; для ленты, где id тысячи, нужен предел и вытеснение — как это устроено, в теме [«Кеши с вытеснением», раздел «LRU на Map»](/algorithms/eviction/#s2).',
];

/* ──────────────────── Раздел 5 · декоратор ──────────────────── */

export const PLAIN_DECORATOR_PATTERN =
  'Декоратор — как чехол для телефона. Телефон тот же, звонит так же, но теперь не бьётся. Поверх чехла можно наклеить плёнку, а сверху надеть кольцо-держатель — каждый слой добавляет своё и не мешает остальным. Важно, что телефон внутри не меняли: снимите чехлы — останется прежний.';

/**
 * «Декораторы» из видеокурса: функции, которые меняют переданный объект и возвращают его.
 *
 * Закреплено тестом: вывод `DECORATOR_COURSE_OUT`.
 */
export const DECORATOR_COURSE_CODE = `interface IUserService {
  users: number;
  getUsersInDatabase(): number;
}
class UserService implements IUserService {
  users = 1000;
  getUsersInDatabase() { return this.users; }
}

// «декораторы», какими их часто пишут: меняют объект и возвращают его же
function nullUser(obj: IUserService) { obj.users = 0; return obj; }
function logUsers(obj: IUserService) { console.log('users: ' + obj.users); return obj; }

const service = new UserService();
const decorated = logUsers(nullUser(service));
console.log(decorated.getUsersInDatabase());
console.log(decorated === service);                   // это не обёртка, а тот же объект
console.log(service.getUsersInDatabase());            // «необёрнутый» сервис тоже обнулён`;

export const DECORATOR_COURSE_OUT = ['users: 0', 0, true, 0];

/**
 * Декоратор-обёртка: новый объект с тем же интерфейсом; порядок в стопке меняет поведение.
 *
 * `tsc` 6.0.3; закреплено тестом: `ts(2339)` на спреде, вывод `DECORATOR_WRAP_OUT`.
 */
export const DECORATOR_WRAP_CODE = `interface IUserService { getUsersInDatabase(): number }
class UserService implements IUserService {
  users = 1000;
  calls = 0;
  getUsersInDatabase() { this.calls++; return this.users; }
}

// обёртка: новый объект с тем же интерфейсом, внутри — вызов исходного
function withLog(inner: IUserService, label: string): IUserService {
  return {
    getUsersInDatabase() {
      const n = inner.getUsersInDatabase();
      console.log(label + ': ' + n);
      return n;
    },
  };
}
function withCache(inner: IUserService): IUserService {
  let value: number | undefined;
  return { getUsersInDatabase: () => (value ??= inner.getUsersInDatabase()) };
}

const service = new UserService();
const logEvery = withLog(withCache(service), 'снаружи');            // журнал видит каждый вызов
logEvery.getUsersInDatabase();
logEvery.getUsersInDatabase();
const logOnce = withCache(withLog(new UserService(), 'внутри'));    // журнал видит только промах
logOnce.getUsersInDatabase();
logOnce.getUsersInDatabase();
console.log(service.calls + ' ' + service.users);                   // сервис цел, спрошен однажды

const spread = { ...service, users: 0 };              // «обёртка» спредом
spread.getUsersInDatabase();                          // ts(2339): методы класса — в прототипе`;

export const DECORATOR_WRAP_OUT = ['снаружи: 1000', 'снаружи: 1000', 'внутри: 1000', '1 1000'];

export const DECORATOR_NOTES: string[] = [
  '**Такой «декоратор» — не обёртка.** `nullUser` меняет поле у переданного объекта и возвращает его же: `decorated === service`. Поэтому «необёрнутый» сервис тоже отдаёт 0, и снять декоратор нельзя. Это просто функция, которая портит объект. Декоратор возвращает **новый** объект с тем же интерфейсом и зовёт исходный внутри — `withLog` и `withCache`.',
  '**Порядок в стопке — это поведение.** Внешняя обёртка получает вызов первой. `withLog` снаружи `withCache` пишет в журнал каждый вызов. `withLog` внутри пишет только когда кеш промахнулся — один раз. Обе стопки правильные, но отвечают на разные вопросы: «сколько раз спросили» и «сколько раз сходили в базу».',
  '**Спред — не обёртка.** `{ ...service }` копирует собственные поля экземпляра, а методы класса лежат в прототипе и в копию не попадают. TypeScript это видит: у типа спреда нет `getUsersInDatabase`, и вызов — `ts(2339)`.',
  '**Декоратор для функций — функция высшего порядка.** `debounce(fn, 300)` и `throttle(fn, 100)` берут функцию и возвращают обёрнутую с тем же вызовом. Как они устроены — в теме [«Колбэки», раздел «Обёртки: debounce и throttle»](/js/callbacks/#s7).',
];

/**
 * Синтаксис `@`: декоратор метода применяется к классу, а не к объекту.
 *
 * В Node 26.8.2 синтаксиса декораторов нет, поэтому тест прогоняет строку через эмит TypeScript
 * (`experimentalDecorators` выключен) и исполняет результат. `tsc --strict` — без ошибок.
 * Вывод — `DECORATOR_SYNTAX_OUT`.
 */
export const DECORATOR_SYNTAX_CODE = `const log: string[] = [];

function tag(name: string) {
  return function <This, Args extends unknown[], R>(
    method: (this: This, ...args: Args) => R,
    context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => R>,
  ) {
    log.push('применён ' + name + ' к ' + String(context.name));
    return function (this: This, ...args: Args): R {
      log.push('вызов ' + name);
      return method.apply(this, args);
    };
  };
}

class UserService {
  users = 1000;
  @tag('внешний')
  @tag('внутренний')
  getUsersInDatabase() { return this.users; }
}
log.push('класс готов, объектов ещё нет');
new UserService().getUsersInDatabase();
for (const line of log) console.log(line);`;

export const DECORATOR_SYNTAX_OUT = [
  'применён внутренний к getUsersInDatabase',
  'применён внешний к getUsersInDatabase',
  'класс готов, объектов ещё нет',
  'вызов внешний',
  'вызов внутренний',
];

export const DECORATOR_SYNTAX_NOTES: string[] = [
  '**`@` — тот же паттерн, применённый к классу.** Декоратор метода получает метод и возвращает функцию, которая встанет на его место. Это та же обёртка, что `withLog`, только для метода. Механика — что получает `context`, когда вызывается `addInitializer` — в теме [«Объектная модель», раздел «Классы»](/js/object-model/#s4), подраздел «Декораторы».',
  '**Применяются снизу вверх, вызываются сверху вниз.** Ближний к методу `@tag(\'внутренний\')` оборачивает метод первым, `@tag(\'внешний\')` — уже его результат. Поэтому при вызове первой срабатывает внешняя обёртка. Это та же стопка, что `withLog(withCache(…))`, записанная столбиком.',
  '**Главное отличие — когда и для кого.** `@` срабатывает один раз, когда класс собирается, — до первого `new` — и меняет метод для **всех** экземпляров. Обёртка-функция выбирает объект при выполнении: можно обернуть один сервис, только в режиме разработки или только для одного потребителя. И объект из чужой библиотеки можно обернуть, а приписать `@` к её классу — нет.',
  '**`@` пока работает только после компилятора.** В Node 26.8.2 это синтаксическая ошибка; TypeScript переписывает декораторы в обычный код. Как типизировать декоратор, чтобы компилятор проверял, подходит ли он к методу, — в теме [«TypeScript на уровне типов», раздел «Классы»](/tooling/typescript/#s7).',
];

/* ──────────────────── Раздел 6 · мост ──────────────────── */

export const PLAIN_BRIDGE =
  'Мост — как пульт и телевизор. Пульты бывают простые и с микрофоном, телевизоры — разных марок. Если бы под каждую пару делали свой пульт, их было бы «пульты × телевизоры». Вместо этого договорились о сигнале: любой пульт шлёт команды по общему протоколу, любой телевизор их понимает. Два ряда вариантов растут независимо, и новых пар делать не надо.';

/**
 * Мост из видеокурса: `NotificationSender` (абстракция) и провайдеры (реализация).
 *
 * Закреплено тестом: компиляция без ошибок, вывод `BRIDGE_OUT`.
 */
export const BRIDGE_CODE = `interface IProvider {                                // реализация: кем доставить
  connect(config: string): void;
  sendMessage(message: string): void;
  disconnect(): void;
}
class TelegramProvider implements IProvider {
  connect(config: string) { console.log('tg: connect ' + config); }
  sendMessage(message: string) { console.log('tg: ' + message); }
  disconnect() { console.log('tg: disconnect'); }
}
class WhatsAppProvider implements IProvider {
  connect(config: string) { console.log('wa: connect ' + config); }
  sendMessage(message: string) { console.log('wa: ' + message); }
  disconnect() { console.log('wa: disconnect'); }
}

// абстракция: как и когда доставить; провайдер приходит снаружи
class NotificationSender {
  constructor(protected provider: IProvider) {}
  send(message: string) {
    this.provider.connect('token');
    this.provider.sendMessage(message);
    this.provider.disconnect();
  }
}
class DelayedNotificationSender extends NotificationSender {
  async sendDelayed(message: string, ms: number) {
    await new Promise((r) => setTimeout(r, ms));
    this.send(message);
  }
}

new NotificationSender(new TelegramProvider()).send('привет');
await new DelayedNotificationSender(new WhatsAppProvider()).sendDelayed('напоминание', 10);`;

export const BRIDGE_OUT = [
  'tg: connect token',
  'tg: привет',
  'tg: disconnect',
  'wa: connect token',
  'wa: напоминание',
  'wa: disconnect',
];

/** Сколько классов нужно на «типы × провайдеры» — наследованием и мостом. */
export const BRIDGE_ROWS: { k: string; inherit: string; bridge: string }[] = [
  { k: '2 типа × 2 провайдера', inherit: '4 класса', bridge: '2 + 2 = 4' },
  { k: '+ SMS', inherit: '6 классов', bridge: '2 + 3 = 5' },
  { k: '+ повторяющиеся', inherit: '9 классов', bridge: '3 + 3 = 6' },
];

export const BRIDGE_NOTES: string[] = [
  '**Мост — это две иерархии вместо одной.** Без него каждое сочетание — отдельный класс: `TelegramDelayed`, `WhatsAppDelayed`, `SmsRecurring`… Число классов — произведение. С мостом типы уведомлений наследуются от `NotificationSender`, провайдеры реализуют `IProvider`, и число классов — сумма. Новый провайдер — один класс, и он сразу работает со всеми типами.',
  '**Реализацию проверяет интерфейс, но не до конца.** Метод в интерфейсе пропускает реализацию с более узким параметром: `connect(config: \'wa-token\')` компилируется под `connect(config: string)`, хотя абстракция передаст любую строку. Это бивариантность методов; лечится объявлением `connect` полем-функцией — разобрано в теме [«TypeScript на уровне типов», раздел «Классы»](/tooling/typescript/#s7).',
];

export const BRIDGE_RENDERER_NOTE =
  'Во фронтенде самый известный мост — рендерер фреймворка. Ядро Vue умеет сравнивать виртуальные деревья и решать, что вставить и что удалить, но DOM не знает. `createRenderer` из `@vue/runtime-core` получает объект операций — `createElement`, `insert`, `remove`, `patchProp` — и уже через них трогает экран. Пакет `runtime-dom` передаёт ему операции над настоящим DOM: `createRenderer(extend({ patchProp }, nodeOps))`. Другой набор операций — и то же ядро рисует в canvas или в журнал. Как это работает изнутри — в теме [«Vue 3 изнутри: рендерер и patch», раздел «mount и patch»](/frameworks/vue-patch-internals/#s2). У React та же схема называется host config и живёт в пакете `react-reconciler` — в теме [«React изнутри: свой рендерер и хуки», раздел «Две фазы»](/frameworks/react-internals/#s3).';

/* ──────────────────── Раздел 7 · тонкие места ──────────────────── */

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'Обёртка — другой объект',
    d: '`withLog(service) === service` — `false`, `withLog(service) instanceof UserService` — тоже `false`: обёртка собрана литералом, а не классом. Код, который проверяет `instanceof`, держит объект ключом в `WeakMap` или сравнивает по `===`, перестаёт узнавать его после обёртывания. Проверяйте по интерфейсу — наличию метода или полю-метке, — а не по классу.',
    tone: 'warn',
  },
  {
    n: '02',
    t: 'Встроенный `Proxy` над классом с `#`-полями ломает методы',
    d: 'Метод, вызванный через прокси, получает `this` — прокси, а `#`-поля у прокси нет: `TypeError`. Заместитель на `Proxy` над таким классом либо привязывает методы к цели (`value.bind(target)` в ловушке `get`), либо пишется классом. Подробно — в теме [«Proxy и Reflect», раздел «Личность и слоты»](/js/proxy-reflect/#s5).',
    tone: 'err',
  },
  {
    n: '03',
    t: 'Адаптер, принявший метод, теряет `this`',
    d: '`promisify(store.load)`, `withRetry(api.fetch)`, `arr.map(parser.parse)` — во всех трёх в обёртку уходит функция без объекта. Типы молчат, а при вызове `this` — `undefined`. Передавайте `store.load.bind(store)` или стрелку, а свои обёртки пишите так, чтобы они вызывали `fn.apply(this, args)`, — тогда обёрнутый метод сохранит `this`.',
  },
  {
    n: '04',
    t: 'Фасад над `fetch` без `res.ok` считает 500 успехом',
    d: '`fetch` отклоняется только без ответа. Фасад, который сразу возвращает `res.json()`, отдаст наверх тело ошибки сервера под видом данных — `{ error: \'…\' }` вместо пользователя. Проверка статуса — обязательная строка любой обёртки над `fetch`.',
    tone: 'err',
  },
  {
    n: '05',
    t: 'Кеширующий заместитель хранит отказ',
    d: 'Кешируя промис, кешируют и его отказ. Одна сетевая ошибка — и ответ «не удалось» отдаётся до перезагрузки страницы. При отказе запись удаляют: `p.catch(() => cache.delete(id))`.',
    tone: 'err',
  },
];

/* ──────────────────── Раздел 8 · источники ──────────────────── */

/** ⚠️ Без разметки: `SourceList` печатает `title` и `what` как есть. */
export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'Refactoring Guru — структурные паттерны',
    href: 'https://refactoring.guru/ru/design-patterns/structural-patterns',
    what: 'адаптер, мост, фасад, заместитель и декоратор: схемы и примеры на TypeScript',
  },
  {
    title: 'MDN — Proxy',
    href: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy',
    what: 'встроенный заместитель: ловушки, пересылка к цели по умолчанию, примеры проверки и журнала',
  },
  {
    title: 'Node.js — util.promisify',
    href: 'https://nodejs.org/api/util.html#utilpromisifyoriginal',
    what: 'адаптер колбэка к промису и отдельное предупреждение: методу, которому нужен this, его привязывают через bind',
  },
  {
    title: 'MDN — Response.ok',
    href: 'https://developer.mozilla.org/en-US/docs/Web/API/Response/ok',
    what: 'почему fetch выполняется на ответ с кодом 404 и 500',
  },
  {
    title: 'TypeScript 5.0 — Decorators',
    href: 'https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-0.html#decorators',
    what: 'нынешние декораторы: что получает декоратор метода, как типизировать, порядок применения',
  },
  {
    title: 'Vue — Custom Renderer API',
    href: 'https://vuejs.org/api/custom-renderer.html',
    what: 'createRenderer и набор операций, которые ядро Vue ждёт от платформы',
  },
  {
    title: 'react-reconciler — README',
    href: 'https://github.com/facebook/react/tree/main/packages/react-reconciler',
    what: 'host config: как ядро React отделено от платформы, на которой рисует',
  },
];

export const RELATED =
  'Смежное на сайте: [Создание объектов: фабрика, строитель, прототип, одиночка](/patterns/creational/) — порождающие паттерны и где их книжная версия ломается в JS. [Proxy и Reflect](/js/proxy-reflect/) — встроенный перехват, на котором пишут заместителей. [Объектная модель, раздел «Классы»](/js/object-model/#s4) — механика `@`-декораторов. [TypeScript на уровне типов, раздел «Классы»](/tooling/typescript/#s7) — `implements`, типизированный декоратор. [Колбэки, раздел «Обёртки: debounce и throttle»](/js/callbacks/#s7) — декораторы для функций. [Vue 3 изнутри: рендерер и patch](/frameworks/vue-patch-internals/) и [React изнутри](/frameworks/react-internals/) — мост между ядром и платформой. [Внедрение зависимостей](/frameworks/dependency-injection/) — как реализацию моста или обёртку подставляет контейнер.';
