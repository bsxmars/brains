import type { Pitfall } from '@/widgets/pitfalls/model/types';

/**
 * Данные темы «Связь объектов: наблюдатель, посредник, цепочка обязанностей».
 *
 * Источник — видеокурс по TypeScript из папки автора (ролики 112 «Chain of Command», 113
 * «Mediator», 119 «Observer», расшифрованы whisper). Из курса взяты сквозные примеры: новый лид
 * с сайта и два подписчика (`NotificationService`, `LeadService`), посредник между обработчиком
 * события, уведомлениями, логом и кешем, цепочка `auth → validate → controller` с методом
 * `next()`. Угол темы — не «как нарисовать UML», а **что платформа уже делает сама**
 * (`EventTarget`, `EventEmitter`, стор, middleware) и где книжная версия ломается.
 *
 * ── Чем проверено ───────────────────────────────────────────────────────────────────────
 * Каждый пример — строка в этом файле, и `tests/unit/patterns-communication.test.ts` берёт
 * **эту строку**: компиляция `tsc` 6.0.3 со `strict` (ошибки сверяются с пометками `// ts(NNNN)`
 * по строкам), исполнение со сверкой вывода по массивам `*_OUT`. Таблицу `DISPATCH_ROWS`
 * тест не читает, а **вычисляет заново** — четырьмя реализациями в отдельном процессе `node`
 * (исключение в слушателе `EventTarget` Node бросает в `nextTick`, и в процессе vitest оно
 * уронило бы прогон).
 *
 * Найдено запуском (Node 26.8.2) и стоит знать (курс этого не говорит):
 *   — книжный `notify` на массиве + `for…of`: подписчик, который отписался во время рассылки,
 *     **пропускает соседа** — следующий за ним не получает события;
 *   — `EventEmitter` раздаёт по снимку: снятый во время рассылки сосед всё равно вызывается;
 *     `EventTarget` снятого пропускает сразу; `Set` вызывает добавленного в той же рассылке;
 *   — `EventTarget` в Node 26 вызывает добавленного во время рассылки (если добавивший не
 *     последний), а Chromium — нет, как велит спецификация DOM. Chromium сверен разовым прогоном
 *     Playwright 2026-10-06 (`a b c`); в тесте закреплена сторона Node;
 *   — исключение в слушателе: `EventEmitter` и массив обрывают рассылку и бросают в вызывающего,
 *     `EventTarget` доводит рассылку до конца, а ошибку сообщает отдельно — в Node это
 *     `nextTick` и падение процесса, `try` вокруг `dispatchEvent` не ловит;
 *   — одна и та же функция, подписанная дважды: `EventEmitter` зовёт её дважды, `EventTarget` — раз;
 *   — Node предупреждает `MaxListenersExceededWarning` на 11-м слушателе одного события —
 *     и у `EventEmitter`, и у `EventTarget`;
 *   — цепочка, собранная одним выражением `new A().next(new B()).next(new C())`, начинается
 *     с последнего звена: `next()` возвращает переданное, и проверка доступа пропущена;
 *   — `next()`, вызванный дважды, без защиты выполняет хвост цепочки дважды.
 */

/* ──────────────────── Вводный раздел · словарь ──────────────────── */

export const GLOSSARY = [
  {
    k: 'связность',
    d: 'Сколько один объект знает о других: чьи методы зовёт, в каком порядке, что они возвращают. Чем больше знает, тем больше правок в нём при каждом изменении соседей. По-английски — coupling. Все три паттерна темы её уменьшают.',
  },
  {
    k: 'издатель и подписчик',
    d: 'Издатель — объект, у которого что-то происходит: пришла заявка, нажата кнопка. Подписчик — функция или объект, которые хотят об этом узнать. В книге издатель называется subject, подписчик — observer (наблюдатель), в DOM — цель события и слушатель.',
  },
  {
    k: 'рассылка',
    d: 'Вызов всех подписчиков по очереди: `notify()` в книге, `dispatchEvent` в DOM, `emit` в Node. Все три — обычный синхронный цикл: строка после вызова выполнится, когда отработали все подписчики.',
  },
  {
    k: 'отписка',
    d: 'Удаление подписчика из списка: `detach`, `removeEventListener`, `off`, функция, которую вернула подписка. Пока подписчик в списке, издатель держит ссылку на него — и на всё, что он помнит.',
  },
  {
    k: 'шина событий',
    d: 'Общий для всего приложения объект, через который одни части сообщают о событиях, а другие на них подписываются. Ни отправитель, ни получатель друг о друге не знают — знают только имя события.',
  },
  {
    k: 'стор',
    d: 'Объект, который хранит общее состояние и рассылает подписчикам его изменения. Отличие от шины — память: стор помнит последнее значение, шина — нет.',
  },
  {
    k: 'middleware',
    d: 'Промежуточный обработчик запроса: проверка доступа, разбор тела, журнал. Получает запрос и функцию `next`, вызов которой передаёт управление следующему обработчику. Не вызвал — цепочка дальше не идёт.',
  },
];

/* ──────────────────── Раздел 0 · перед началом ──────────────────── */

export const PREREQ_NOTE = 'Тема опирается на четыре вещи, и все четыре разобраны на сайте.';

export const PREREQ = [
  {
    t: 'Функция как значение',
    d: 'Подписчик — это функция, которую отдали издателю на хранение. Что значит «передать функцию» и что она при этом помнит — основа всех трёх паттернов.',
    href: '/js/callbacks/#s2',
    hrefLabel: 'Колбэки, раздел «Функция как значение»',
    tone: 'info' as const,
  },
  {
    t: '`addEventListener` и `dispatchEvent`',
    d: 'Встроенный наблюдатель платформы: подписка, отписка, синхронная отправка. Тема сравнивает с ним книжную версию и не пересказывает фазы и всплытие.',
    href: '/render/dom-events/#s7',
    hrefLabel: 'События DOM, раздел «Синхронная отправка»',
    tone: 'info' as const,
  },
  {
    t: '`async`/`await` и необработанный отказ',
    d: 'Middleware в современных фреймворках — `async`-функции, и `await next()` в них решает порядок. Что происходит с промисом, который никто не ждёт, — тоже оттуда.',
    href: '/js/promise-internals/#s5',
    hrefLabel: 'Промис изнутри, раздел «Необработанный отказ»',
    tone: 'warn' as const,
  },
  {
    t: 'Mapped-типы и `keyof`',
    d: 'Типизированные события строятся на карте «имя события → тип данных» и дженерике `K extends keyof Events`. Без этого непонятно, откуда компилятор знает, что у события `lead` есть `phone`.',
    href: '/tooling/typescript/#s4',
    hrefLabel: 'TypeScript на уровне типов, раздел «Mapped-типы»',
    tone: 'info' as const,
  },
];

/* ──────────────────── Раздел 1 · зачем ──────────────────── */

export const PLAIN_COUPLING =
  'Связность — как в офисе, где каждый пишет каждому лично. Пока сотрудников трое, это удобно. Когда их двадцать, новичок должен узнать всех, а уход одного ломает чужие цепочки писем. Три паттерна темы — три способа это развязать: рассылка по подписке (наблюдатель), секретарь, который знает всех (посредник), и конвейер, где каждый передаёт работу следующему, не зная, кто дальше (цепочка обязанностей).';

/**
 * С чего начинается тема: обработчик формы знает всех, кому нужна заявка.
 *
 * Иллюстрация, а не исполняемый пример: тест только компилирует её (`tsc`, ошибок нет).
 */
export const PROBLEM_CODE = `type Lead = { name: string; phone: string };

class LeadService { create(lead: Lead) { /* запись в CRM */ } }
class SmsService { send(phone: string, text: string) { /* шлюз СМС */ } }
class Analytics { track(event: string) { /* счётчик */ } }

const crm = new LeadService();
const sms = new SmsService();
const analytics = new Analytics();

// обработчик формы знает каждого, кому нужна заявка, и порядок их вызова
function onLeadForm(lead: Lead) {
  crm.create(lead);
  sms.send(lead.phone, 'Свяжемся с вами за 15 минут');
  analytics.track('lead');
  // пятый потребитель — ещё одна строка здесь и ещё один импорт сверху
}`;

/** Три паттерна: что решает каждый и что из этого уже даёт платформа. */
export const PATTERN_ROWS: { k: string; task: string; js: string; book: string }[] = [
  {
    k: 'Наблюдатель',
    task: 'сообщить всем заинтересованным, не зная, кто они',
    js: '`EventTarget` и `CustomEvent` в браузере и Node, `EventEmitter` в Node, подписка в сторе и сигналах',
    book: 'свой список подписчиков — когда нужны типы событий или другой порядок рассылки; писать его стоит с оглядкой на отписку во время рассылки',
  },
  {
    k: 'Посредник',
    task: 'убрать связи «каждый с каждым» и собрать сценарий в одном месте',
    js: 'компонент-родитель, который держит поля формы и кнопку; стор; шина событий',
    book: 'сценарий из нескольких шагов, который не принадлежит ни одному участнику: отправить, записать в журнал, сбросить кеш',
  },
  {
    k: 'Цепочка обязанностей',
    task: 'провести запрос через ряд независимых шагов, где любой может остановить',
    js: 'middleware с `next()` в серверных фреймворках; всплытие события DOM — тоже цепочка: от узла к корню, пока кто-то не остановит',
    book: 'связанный список объектов с методом `next` — редко: массив функций проще и не теряет начало',
  },
];

/* ──────────────────── Раздел 2 · наблюдатель ──────────────────── */

export const PLAIN_OBSERVER =
  'Наблюдатель — как рассылка в мессенджере. Канал не знает, кто его читатели, он просто публикует пост, и пост приходит всем подписанным. Кто не хочет читать — отписывается. Альтернатива — каждые пять минут заходить и проверять, нет ли нового, — в коде это опрос по таймеру, и он либо опаздывает, либо зря тратит запросы.';

/**
 * Наблюдатель из видеокурса: `Subject` с `attach`/`detach`/`notify` и два подписчика.
 *
 * Закреплено тестом: компиляция без ошибок и вывод `OBSERVER_CLASSIC_OUT`.
 */
export const OBSERVER_CLASSIC_CODE = `type Lead = { name: string; phone: string };

interface Observer { update(subject: Subject): void }
interface Subject {
  attach(o: Observer): void;
  detach(o: Observer): void;
  notify(): void;
}

class NewLead implements Subject {
  private observers: Observer[] = [];
  state?: Lead;
  attach(o: Observer) {
    if (!this.observers.includes(o)) this.observers.push(o);   // дважды не подписать
  }
  detach(o: Observer) {
    const i = this.observers.indexOf(o);
    if (i !== -1) this.observers.splice(i, 1);
  }
  notify() {
    for (const o of this.observers) o.update(this);
  }
}

class NotificationService implements Observer {
  update(subject: Subject) {
    if (subject instanceof NewLead) console.log('СМС для ' + subject.state?.name);
  }
}
class LeadService implements Observer {
  update(subject: Subject) {
    if (subject instanceof NewLead) console.log('лид в CRM: ' + subject.state?.name);
  }
}

const subject = new NewLead();
const sms = new NotificationService();
subject.attach(sms);
subject.attach(new LeadService());

subject.state = { name: 'Антон', phone: '+7 900 000-00-01' };
subject.notify();
subject.detach(sms);
subject.state = { name: 'Борис', phone: '+7 900 000-00-02' };
subject.notify();`;

export const OBSERVER_CLASSIC_OUT = ['СМС для Антон', 'лид в CRM: Антон', 'лид в CRM: Борис'];

/**
 * Продолжение примера курса: подписчик отписывается во время рассылки.
 *
 * Печатается отдельно, но компилируется и исполняется тестом **вместе** с `OBSERVER_CLASSIC_CODE`
 * (классы оттуда). Вывод — `SELF_DETACH_OUT`: при первой рассылке CRM не узнала о лиде.
 */
export const SELF_DETACH_CODE = `// приветственное СМС — один раз: подписчик сам снимает себя
class WelcomeSms implements Observer {
  constructor(private from: NewLead) {}
  update() {
    console.log('приветствие');
    this.from.detach(this);
  }
}

const leads = new NewLead();
leads.attach(new WelcomeSms(leads));
leads.attach(new LeadService());
leads.state = { name: 'Вера', phone: '+7 900 000-00-03' };
leads.notify();          // приветствие — и всё: CRM о Вере не узнала
leads.notify();          // лид в CRM: Вера — только со второго раза`;

export const SELF_DETACH_OUT = ['приветствие', 'лид в CRM: Вера'];

export const OBSERVER_CLASSIC_NOTES: string[] = [
  '**Отписка во время рассылки пропускает соседа.** `for…of` по массиву идёт по индексу. `WelcomeSms` стоит под индексом 0 и во время своего `update` вырезает себя через `splice` — `LeadService` съезжает на индекс 0, а цикл переходит к индексу 1, где уже никого нет. Ошибки нет, CRM просто не получила лид. Лечение — рассылать по копии: `for (const o of [...this.observers])`.',
  '**Подписчик получает весь `Subject` и вынужден гадать, что это.** Интерфейс обещает `update(subject: Subject)`, а нужен лид — отсюда `instanceof NewLead` и `state?.` в каждом подписчике. Передавать подписчику стоит только данные. В TypeScript так и стоит: подписчик — функция `(lead: Lead) => void`, и проверка типа уходит в компилятор.',
  '**Интерфейс `Observer` с одним методом — это функция.** В языках без функций-значений подписчика приходилось оборачивать в объект. В JS подписчик — стрелка, а отписку удобнее возвращать из подписки: `const off = bus.on(…)`. Так делают и сторы, и сигналы.',
];

/**
 * Как ведут себя четыре реализации рассылки, когда список меняется во время неё.
 *
 * ⚠️ Таблицу не набирают — её **вычисляет** тест (`DISPATCH_PROBE` в тесте исполняет каждый
 * сценарий четырьмя реализациями отдельным процессом `node`) и сверяет с `got`.
 * Подписчики `a`, `b`, `c` подписаны по порядку; в журнале — кто был вызван.
 */
export type DispatchImpl = 'array' | 'set' | 'target' | 'emitter';

export const DISPATCH_ROWS: { k: string; got: Record<DispatchImpl, string> }[] = [
  {
    k: '`a` отписывает себя',
    got: { array: 'a c', set: 'a b c', target: 'a b c', emitter: 'a b c' },
  },
  {
    k: '`a` отписывает `b`',
    got: { array: 'a c', set: 'a c', target: 'a c', emitter: 'a b c' },
  },
  {
    k: '`a` подписывает `d`',
    got: { array: 'a b c d', set: 'a b c d', target: 'a b c d', emitter: 'a b c' },
  },
  {
    k: '`b` бросает исключение',
    got: {
      array: 'a, ошибка у вызывающего',
      set: 'a, ошибка у вызывающего',
      target: 'a c, ошибка отдельно',
      emitter: 'a, ошибка у вызывающего',
    },
  },
  {
    k: 'одну функцию подписали дважды',
    got: { array: 'f f', set: 'f', target: 'f', emitter: 'f f' },
  },
];

export const DISPATCH_HEAD = ['что случилось', 'массив: `push`, `for…of`', '`Set`, `for…of`', '`EventTarget` в Node', '`EventEmitter`'];

export const DISPATCH_NOTES: string[] = [
  '**`EventEmitter` раздаёт по снимку.** Перед рассылкой Node копирует список слушателей, поэтому всё, что случилось со списком во время `emit`, подействует только со следующего раза. Снятый сосед `b` в этой рассылке ещё вызывается, добавленный `d` — ещё нет.',
  '**`EventTarget` по спецификации DOM работает по копии, но снятого пропускает сразу.** У снятого слушателя стоит пометка «удалён», и копия её видит; добавленный в копию не попадает и в этой рассылке не вызывается — так ведёт себя Chromium (тема [«События DOM», раздел «Остановки и список слушателей»](/render/dom-events/#s3)). `EventTarget` в Node 26 здесь от спецификации отходит: добавленного во время рассылки он вызывает в ту же рассылку, если после добавившего в списке ещё кто-то есть. Код, который подписывается из слушателя, ведёт себя в браузере и на сервере по-разному.',
  '**Исключение в слушателе `EventTarget` не доходит до того, кто отправил событие.** Рассылка идёт дальше, `dispatchEvent` возвращается как обычно, а ошибка сообщается отдельно: в браузере — в консоль и событием `error` у `window`, в Node — броском в `process.nextTick`, то есть **падением процесса**, и `try` вокруг `dispatchEvent` его не поймает. `EventEmitter` и самописный цикл ведут себя как обычный вызов функции: рассылка обрывается, ошибка летит в `emit`.',
  '**`Set` вызывает подписанного по ходу.** Его итератор живой: добавленное во время обхода он посетит в той же рассылке. Если подписчик снимает себя и тут же подписывается снова — обход не кончится никогда. Безопасный вариант для самописного издателя — копия: `for (const fn of [...listeners])`. Это поведение `EventEmitter`.',
];

/**
 * Встроенный наблюдатель и его типизация: `CustomEvent` на голом `EventTarget` типов не знает,
 * карта событий — знает.
 *
 * `tsc` 6.0.3; закреплено тестом: `ts(2339)`, `ts(2345)`, `ts(2322)` по строкам и вывод `TYPED_OUT`.
 */
export const TYPED_CODE = `type Lead = { name: string; phone: string };

// 1. платформа: EventTarget есть и в браузере, и в Node
const target = new EventTarget();
target.addEventListener('lead', (e) => console.log('target: ' + e.detail.name)); // ts(2339)
target.dispatchEvent(new CustomEvent<Lead>('lead', { detail: { name: 'Антон', phone: '+7 900' } }));

// 2. своя рассылка с картой «имя события → данные»
type LeadEvents = { lead: Lead; cancel: { id: number } };

class Emitter<E extends Record<string, unknown>> {
  #listeners: { [K in keyof E]?: Set<(data: E[K]) => void> } = {};
  on<K extends keyof E>(type: K, fn: (data: E[K]) => void): () => void {
    (this.#listeners[type] ??= new Set()).add(fn);
    return () => this.#listeners[type]?.delete(fn);       // отписка — функция
  }
  emit<K extends keyof E>(type: K, data: E[K]) {
    for (const fn of [...(this.#listeners[type] ?? [])]) fn(data);  // по копии
  }
}

const bus = new Emitter<LeadEvents>();
const off = bus.on('lead', (lead) => console.log('bus: ' + lead.phone));
bus.emit('lead', { name: 'Антон', phone: '+7 900' });
bus.emit('leed', { name: 'Антон', phone: '+7 900' });     // ts(2345): опечатка в имени
bus.emit('cancel', { id: '7' });                          // ts(2322): id — число
off();
bus.emit('lead', { name: 'Борис', phone: '+7 901' });     // никто не слушает`;

export const TYPED_OUT = ['target: Антон', 'bus: +7 900'];

export const TYPED_NOTES: string[] = [
  '**Голый `EventTarget` не знает своих событий.** `addEventListener(\'lead\', …)` даёт слушателю `Event`, а не `CustomEvent<Lead>`, и `e.detail` — `ts(2339)`. При выполнении `detail` на месте: строка работает, просто компилятор её не пропускает. Элементы DOM типизированы иначе: в `lib.dom.d.ts` у `addEventListener` перегрузка `K extends keyof HTMLElementEventMap`, и для `\'click\'` слушатель получает `MouseEvent`. Своему издателю нужна такая же карта.',
  '**Карта событий ловит опечатку в имени и не те данные.** `LeadEvents` говорит, какие данные у какого события, а `on` и `emit` берут тип по ключу. Строка `\'leed\'` — уже не «событие, на которое никто не подписан», а ошибка компиляции.',
  '**Отписка — функция, которую вернула подписка.** Не надо хранить ссылку на слушателя, чтобы потом передать её в `off`: стрелку можно написать прямо в вызове. Для DOM ту же роль играет `{ signal }`: один `abort()` снимает все подписки, сделанные с этим сигналом. Как это устроено и почему `EventEmitter.on` опцию `signal` молча игнорирует — в теме [«Колбэки», раздел «Отмена, утечки, реентерантность»](/js/callbacks/#s8).',
];

/**
 * Рассылка синхронна, а слушатель с `await` — нет: `dispatchEvent` не ждёт его промиса.
 *
 * Закреплено тестом: вывод `ASYNC_OUT`.
 */
export const ASYNC_CODE = `const saveToCrm = () => new Promise((r) => setTimeout(r, 5));
const leads = new EventTarget();

leads.addEventListener('lead', async () => {
  await saveToCrm();
  console.log('лид сохранён');
});

leads.dispatchEvent(new Event('lead'));
console.log('dispatchEvent вернулся');     // раньше, чем лид сохранён

await new Promise((r) => setTimeout(r, 20));   // подождать CRM`;

export const ASYNC_OUT = ['dispatchEvent вернулся', 'лид сохранён'];

export const ASYNC_NOTE =
  'Рассылка — синхронный цикл, а `async`-слушатель возвращает промис после первого `await`. Ни `dispatchEvent`, ни `emit` этот промис не ждут и не смотрят на него. Отсюда два следствия. Порядок: код после рассылки выполнится раньше, чем слушатель закончит работу. Ошибки: если CRM откажет, промис слушателя станет отклонённым, и его никто не ждёт — это необработанный отказ, а не исключение в `try` вокруг рассылки (тема [«Промис изнутри», раздел «Необработанный отказ»](/js/promise-internals/#s5)). Если отправителю важно дождаться всех — это уже не наблюдатель, а цепочка или `Promise.all` по списку обработчиков.';

export const OBSERVER_PLATFORM_NOTE =
  'Наблюдатель встроен в платформу и в другом виде. `IntersectionObserver`, `ResizeObserver` и `MutationObserver` — издатели, которых браузер ведёт сам: в отличие от событий, они копят изменения и отдают их пачкой, в своё время кадра (тема [«Наблюдатели: Intersection, Resize, Mutation»](/render/observers/)). Сигналы и сторы — наблюдатель с памятью: подписчик получает не событие, а новое значение (темы [«Сигналы»](/frameworks/signals/) и [«Стейт-менеджеры изнутри»](/frameworks/state-managers/)). Ещё одна форма — RxJS: подписка на поток значений, где события можно фильтровать и склеивать, как массивы.';

/* ──────────────────── Раздел 3 · посредник ──────────────────── */

export const PLAIN_MEDIATOR =
  'Посредник — как диспетчер такси. Водители не договариваются друг с другом, кто поедет на заказ, а пассажир не обзванивает водителей. Все говорят с диспетчером, и только он знает, кто свободен и в каком порядке что делать. Сменить правила — значит переучить одного диспетчера, а не всех водителей.';

/**
 * Посредник из видеокурса: обработчик события сообщает посреднику, а тот ведёт сценарий —
 * уведомление, журнал, сброс кеша. Имена событий — объединение строк, а не `string`.
 *
 * `tsc` 6.0.3; закреплено тестом: `ts(2678)` на опечатке в `case`, вывод `MEDIATOR_OUT`.
 */
export const MEDIATOR_CODE = `type AppEvent = 'notification:requested' | 'cache:stale';

interface Mediator { notify(sender: string, event: AppEvent): void }

abstract class Mediated {                     // общий предок всех участников
  protected mediator?: Mediator;
  setMediator(m: Mediator) { this.mediator = m; }
}

class Notifications { send() { console.log('уведомление отправлено'); } }
class Log { write(text: string) { console.log('лог: ' + text); } }
class Cache { reset() { console.log('кеш сброшен'); } }

class EventHandler extends Mediated {
  onMyEvent() {
    this.mediator?.notify('EventHandler', 'notification:requested');  // о других не знает
  }
}

class NotificationMediator implements Mediator {
  constructor(private n: Notifications, private log: Log, private cache: Cache) {}
  notify(sender: string, event: AppEvent) {
    switch (event) {
      case 'notification:requested':          // весь сценарий — здесь, по шагам
        this.n.send();
        this.log.write('отправлено');
        this.cache.reset();
        this.log.write('кеш сброшен');
        break;
      case 'cache:stal':                      // ts(2678): такого события нет
        this.cache.reset();
    }
  }
}

const handler = new EventHandler();
handler.onMyEvent();                          // посредника ещё нет — тишина
handler.setMediator(new NotificationMediator(new Notifications(), new Log(), new Cache()));
handler.onMyEvent();`;

export const MEDIATOR_OUT = ['уведомление отправлено', 'лог: отправлено', 'кеш сброшен', 'лог: кеш сброшен'];

export const MEDIATOR_NOTES: string[] = [
  '**Посредник знает порядок, участники — только своё дело.** `Notifications` умеет отправлять, `Log` — писать, `EventHandler` — принимать событие. Сценарий «отправить, записать, сбросить кеш, записать ещё раз» живёт в одном методе, и его видно целиком. У наблюдателя порядок реакций — это порядок подписки, а порядок подписки — это порядок, в котором выполнились модули. Если шагам важна очерёдность, нужен посредник, а не рассылка.',
  '**`this.mediator?.` превращает забытую настройку в тишину.** Первый `onMyEvent()` ничего не сделал и ничего не сказал: посредника ещё не назначили, и `?.` молча пропустил вызов. Сеттер `setMediator` после конструктора — то самое место, где такое случается. Если участник без посредника бессмыслен, посредника передают в конструктор, и забыть его не даст компилятор.',
  '**Общий базовый класс — дорогой способ раздать одно поле.** Минус книжной версии: в TypeScript у класса один предок, и кнопка, которая уже наследует другую кнопку, `Mediated` не унаследует. Полю `mediator` предок не нужен — его передают аргументом.',
  '**Имя события — объединение строк, а не `string`.** С `event: string` опечатка в `case` даёт ветку, которая никогда не сработает. С `AppEvent` компилятор отвечает `ts(2678)`: такую строку сравнивать не с чем.',
];

/**
 * Посредник в виде шины и в виде стора: шина не помнит, что уже случилось.
 *
 * Закреплено тестом: вывод `BUS_OUT`.
 */
export const BUS_CODE = `type Listener<T> = (value: T) => void;

function createBus<T>() {                     // шина: передала и забыла
  const listeners = new Set<Listener<T>>();
  return {
    on(fn: Listener<T>) { listeners.add(fn); return () => listeners.delete(fn); },
    emit(value: T) { for (const fn of [...listeners]) fn(value); },
  };
}

function createStore<T>(value: T) {           // стор: помнит последнее значение
  const listeners = new Set<Listener<T>>();
  return {
    get: () => value,
    set(next: T) { value = next; for (const fn of [...listeners]) fn(value); },
    subscribe(fn: Listener<T>) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}

// профиль загрузился раньше, чем шапка страницы подписалась
const userBus = createBus<string>();
userBus.emit('Антон');
userBus.on((name) => console.log('шапка по шине: ' + name));     // событие уже прошло

const user = createStore('гость');
user.set('Антон');
console.log('шапка по стору: ' + user.get());                     // прочитала текущее
user.subscribe((name) => console.log('шапка по стору: ' + name));
user.set('Борис');`;

export const BUS_OUT = ['шапка по стору: Антон', 'шапка по стору: Борис'];

export const BUS_NOTES: string[] = [
  '**Шина — посредник без сценария.** Отправитель и получатель не знают друг о друге, как и с посредником, но порядок шагов никто не держит: кто подписан, тот и реагирует. Найти всех, кто отвечает на событие `\'lead\'`, можно только поиском строки по проекту. Карта событий из раздела «Наблюдатель» превращает этот поиск в «найти все ссылки» в редакторе.',
  '**Шина не помнит прошлого — стор помнит.** Компонент, который появился после события, его пропустил: шапка не узнала имя. Стор хранит последнее значение, и опоздавший сначала читает текущее, потом подписывается на изменения. Поэтому общее состояние компонентов держат в сторе, а шину оставляют для того, что действительно событие: «показать уведомление», «закрыть все меню». Как стор связывает подписку с отрисовкой — в теме [«Стейт-менеджеры изнутри», раздел «Стор: состояние и подписчики»](/frameworks/state-managers/#s1).',
];

/* ──────────────────── Раздел 4 · цепочка обязанностей ──────────────────── */

export const PLAIN_CHAIN =
  'Цепочка обязанностей — как проход в аэропорт: проверка билета, досмотр, паспортный контроль. Каждый пост делает своё и либо пропускает дальше, либо разворачивает. Пост не знает, какой будет следующим, — его можно убрать, переставить или добавить новый, не трогая остальных.';

/**
 * Цепочка из видеокурса: звенья-объекты, `next()` назначает следующее и возвращает его.
 *
 * Закреплено тестом: вывод `CHAIN_OUT` — три запроса, три разных места остановки.
 */
export const CHAIN_CODE = `type Req = { userId: number; body?: string };

interface IMiddleware {
  next(mid: IMiddleware): IMiddleware;
  handle(request: Req): string;
}

abstract class AbstractMiddleware implements IMiddleware {
  private nextMiddleware?: IMiddleware;
  next(mid: IMiddleware): IMiddleware {
    this.nextMiddleware = mid;
    return mid;                               // чтобы цеплять через точку
  }
  handle(request: Req): string {
    if (this.nextMiddleware) return this.nextMiddleware.handle(request);
    return 'конец цепочки';
  }
}

class AuthMiddleware extends AbstractMiddleware {
  override handle(request: Req): string {
    console.log('auth');
    if (request.userId !== 1) return 'вы не авторизованы';
    return super.handle(request);             // пропустить дальше
  }
}
class ValidateMiddleware extends AbstractMiddleware {
  override handle(request: Req): string {
    console.log('validate');
    if (!request.body) return 'нет body';
    return super.handle(request);
  }
}
class Controller extends AbstractMiddleware {
  override handle(request: Req): string {
    console.log('controller');
    return 'ok';
  }
}

const auth = new AuthMiddleware();
auth.next(new ValidateMiddleware()).next(new Controller());

console.log(auth.handle({ userId: 3 }));
console.log(auth.handle({ userId: 1 }));
console.log(auth.handle({ userId: 1, body: 'I am ok' }));`;

export const CHAIN_OUT = [
  'auth',
  'вы не авторизованы',
  'auth',
  'validate',
  'нет body',
  'auth',
  'validate',
  'controller',
  'ok',
];

/**
 * Продолжение: та же цепочка одним выражением. Компилируется и исполняется тестом **вместе**
 * с `CHAIN_CODE`; вывод `CHAIN_HEAD_OUT` — проверка доступа не вызывалась.
 */
export const CHAIN_HEAD_CODE = `// та же цепочка, собранная одним выражением
const api = new AuthMiddleware()
  .next(new ValidateMiddleware())
  .next(new Controller());                    // api — это Controller: next() вернул последнее звено

console.log(api.handle({ userId: 3, body: 'чужой запрос' }));`;

export const CHAIN_HEAD_OUT = ['controller', 'ok'];

export const CHAIN_NOTES: string[] = [
  '**`next()` возвращает переданное звено — и цепочка теряет начало.** Это сделано, чтобы цеплять через точку, но результат выражения — **последнее** звено. `api` указывает на `Controller`, и чужой запрос прошёл, не встретив ни `auth`, ни `validate`. Типы молчат: и начало, и конец цепочки — `IMiddleware`. В примере курса первое звено сохранено в отдельную переменную, и только поэтому всё работает.',
  '**Звено решает само, пускать ли дальше.** Не вызвал `super.handle` — запрос остановлен, и остальные звенья о нём не узнают. Это и отличает цепочку от наблюдателя: там издатель зовёт всех, здесь каждый следующий вызывается, только если предыдущий так решил.',
  '**В книге цепочка ищет одного обработчика, в middleware — проходит всех.** Классическая цепочка обязанностей передаёт запрос, пока кто-то не возьмётся его обработать: так событие DOM всплывает от кнопки к корню, пока его не остановят (тема [«События DOM», раздел «Делегирование»](/render/dom-events/#s5)). Middleware — вариант, где каждое звено делает своё и обычно пропускает дальше. Устройство одно: следующего вызывает текущий.',
];

/**
 * Цепочка как массив `async`-функций и `compose`: так устроены middleware в серверных
 * фреймворках. Защита от повторного `next()` — строка с `вызван дважды`.
 *
 * Закреплено тестом: вывод `COMPOSE_OUT`.
 */
export const COMPOSE_CODE = `type Ctx = { userId?: number; body?: string; log: string[] };
type Middleware = (ctx: Ctx, next: () => Promise<void>) => Promise<void>;

function compose(stack: Middleware[]) {
  return (ctx: Ctx) => {
    let last = -1;
    const run = async (i: number): Promise<void> => {
      if (i <= last) throw new Error('next() вызван дважды');
      last = i;
      const mw = stack[i];
      if (mw) await mw(ctx, () => run(i + 1));
    };
    return run(0);
  };
}

const timing: Middleware = async (ctx, next) => {
  ctx.log.push('timing →');
  await next();                               // всё, что дальше по цепочке
  ctx.log.push('← timing');                   // а это — на обратном пути
};
const auth: Middleware = async (ctx, next) => {
  if (ctx.userId !== 1) { ctx.body = 'вы не авторизованы'; return; }   // next не зовём
  await next();
};
const controller: Middleware = async (ctx) => {
  ctx.log.push('controller');
  ctx.body = 'ok';
};

const app = compose([timing, auth, controller]);   // начало цепочки не потерять

const ok: Ctx = { userId: 1, log: [] };
await app(ok);
console.log(ok.log.join(' ') + ' = ' + ok.body);

const denied: Ctx = { userId: 3, log: [] };
await app(denied);
console.log(denied.log.join(' ') + ' = ' + denied.body);`;

export const COMPOSE_OUT = ['timing → controller ← timing = ok', 'timing → ← timing = вы не авторизованы'];

/**
 * Две ошибки с `next()`: вызвать дважды и не дождаться. Компилируется и исполняется тестом
 * **вместе** с `COMPOSE_CODE`; вывод — `NEXT_BUGS_OUT`. Тест отдельно убирает защиту из
 * `compose` и проверяет, что списаний тогда два.
 */
export const NEXT_BUGS_CODE = `// 1. «повторить, если не вышло» — и next() вызван второй раз
const retry: Middleware = async (ctx, next) => {
  await next();
  if (ctx.body !== 'ok') await next();
};
const charge: Middleware = async (ctx) => {
  ctx.log.push('списано 100 ₽');
};
const paid: Ctx = { log: [] };
try {
  await compose([retry, charge])(paid);
} catch (e) {
  console.log((e as Error).message);
}
console.log(paid.log.length);                 // 1: без проверки в run было бы 2

// 2. next() без await — ответ уходит раньше, чем отработал контроллер
const respond: Middleware = async (ctx, next) => {
  next();                                     // промис брошен
  ctx.log.push('ответ: ' + ctx.body);
};
const slow: Middleware = async (ctx) => {
  await null;                                 // любое ожидание: база, сеть
  ctx.body = 'ok';
};
const early: Ctx = { log: [] };
await compose([respond, slow])(early);
console.log(early.log.join() + ', а body уже ' + early.body);`;

export const NEXT_BUGS_OUT = ['next() вызван дважды', 1, 'ответ: undefined, а body уже ok'];

export const COMPOSE_NOTES: string[] = [
  '**Массив функций не теряет начало.** Цепочку держит `compose`, а не звенья: порядок — это порядок в массиве, и вызывается всегда первое. Звену не нужно поле «следующий» — `next` ему передают аргументом.',
  '**`await next()` делит звено на «до» и «после».** Код до `await next()` выполняется по пути внутрь, код после — по пути обратно, когда вся цепочка дальше отработала. Поэтому `timing` видит и начало, и конец запроса и может замерить время. Эту форму называют «луковицей». В книжной цепочке обратный путь тоже есть — через `return`, — но только синхронный.',
  '**`next()` дважды — хвост цепочки выполняется дважды.** «Повторить при неудаче» выглядит невинно, но второй `next()` снова проходит всё, что дальше: без проверки в `run` деньги списались бы два раза. Проверка `i <= last` превращает это в ошибку. Такая же проверка — с сообщением `next() called multiple times` — есть в `compose` из Koa (исходник — в «Источниках»).',
  '**`next()` без `await` — звено не ждёт хвоста.** Вызов вернул промис, его бросили, и `respond` записал ответ, когда `body` ещё не было. Ошибки нет; через тик `body` появился, но ответ уже ушёл. А если контроллер упадёт, его отказ никто не ждёт — это необработанный отказ.',
];

export const INTERCEPTOR_NOTE =
  'Перехватчики запросов — та же цепочка, только вокруг `fetch`: «добавить токен», «повторить при 401», «записать в журнал» оборачивают запрос по очереди, и каждый решает, звать ли следующего. Сделать их можно тем же `compose` — звено получает запрос и `next`, который выполняет остальное и возвращает ответ. Отмена такого запроса проходит через всю цепочку одним `AbortSignal` (тема [«Отмена: AbortController и AbortSignal», раздел «Отмена в своём коде»](/js/abort-controller/#s5)).';

/* ──────────────────── Раздел 5 · тонкие места ──────────────────── */

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'Отписка во время рассылки пропускает соседа',
    d: 'Книжный `notify` идёт `for…of` по массиву, а подписчик «на один раз» вырезает себя через `splice` — и следующий за ним не получает события. Ни ошибки, ни предупреждения. Самописный издатель рассылает по копии: `[...observers]`. `EventTarget`, `EventEmitter` и `Set` этой ошибки не делают, но каждый по-своему обходится с изменениями списка — таблица в разделе «Наблюдатель».',
    tone: 'err',
  },
  {
    n: '02',
    t: 'Ошибка в слушателе `EventTarget` не ловится `try` вокруг `dispatchEvent`',
    d: 'Рассылка доходит до конца, `dispatchEvent` возвращается, а исключение сообщается отдельно. В браузере это строка в консоли и событие `error` у `window`. В Node — бросок в `process.nextTick`: процесс падает, хотя вызов стоял в `try`. `EventEmitter` устроен наоборот: исключение обрывает рассылку и вылетает из `emit`, остальные слушатели не вызываются.',
    tone: 'err',
  },
  {
    n: '03',
    t: 'Рассылка не ждёт `async`-слушателей',
    d: '`emit` и `dispatchEvent` возвращаются после первого `await` каждого слушателя. Код после рассылки идёт раньше их окончания, а отказ промиса становится необработанным. Если отправителю нужен результат обработчиков — это не событие, а вызов: `await Promise.all(handlers.map((h) => h(data)))`.',
    tone: 'warn',
  },
  {
    n: '04',
    t: 'Забытая отписка — утечка, и Node об этом подсказывает',
    d: 'Издатель держит подписчика, а подписчик — всё, что помнит его замыкание: компонент, DOM-узел, большой массив. Компонент давно убран, а слушатель на `window` или на общей шине живёт. Node предупреждает `MaxListenersExceededWarning` на одиннадцатом слушателе одного события — и у `EventEmitter`, и у `EventTarget`; браузер не предупреждает. Как искать такие утечки — в теме [«Колбэки», раздел «Отмена, утечки, реентерантность»](/js/callbacks/#s8).',
  },
  {
    n: '05',
    t: '`EventEmitter` вызывает дважды подписанную функцию дважды',
    d: '`addEventListener` с той же функцией и тем же этапом (захват или всплытие) второй раз ничего не добавляет. `emitter.on` добавляет, и слушатель срабатывает дважды — типичное следствие подписки в функции, которая вызывается больше одного раза. Книжный `attach` проверяет `includes`, как `EventTarget`.',
  },
  {
    n: '06',
    t: '`a.next(b).next(c)` указывает на `c`',
    d: 'Метод `next` в книжной цепочке возвращает переданное звено, чтобы цеплять через точку, — значит, результат всего выражения — последнее звено. Цепочка, сохранённая так, начинается с контроллера, мимо проверки доступа. Типы этого не видят. Первое звено держат в своей переменной — или собирают цепочку массивом.',
    tone: 'err',
  },
  {
    n: '07',
    t: 'Событие, отправленное до подписки, потеряно',
    d: 'Шина передаёт событие тем, кто подписан **сейчас**. Компонент, который смонтировался позже, его не увидит, и состояние «пользователь вошёл» для него не наступит никогда. Состояние держат в сторе, где опоздавший читает текущее значение; шина — для разовых событий.',
  },
];

/* ──────────────────── Раздел 6 · источники ──────────────────── */

/** ⚠️ Без разметки: `SourceList` печатает `title` и `what` как есть. */
export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'Refactoring Guru — поведенческие паттерны',
    href: 'https://refactoring.guru/ru/design-patterns/behavioral-patterns',
    what: 'наблюдатель, посредник и цепочка обязанностей в классической форме, с примерами на TypeScript',
  },
  {
    title: 'patterns.dev — Observer Pattern',
    href: 'https://www.patterns.dev/vanilla/observer-pattern/',
    what: 'наблюдатель глазами JavaScript: функция-подписчик, отписка, связь с реактивными библиотеками',
  },
  {
    title: 'DOM Standard — Dispatching events',
    href: 'https://dom.spec.whatwg.org/#dispatching-events',
    what: 'копия списка слушателей, пометка removed и сообщение об исключении вместо броска в dispatchEvent',
  },
  {
    title: 'Node.js — Events',
    href: 'https://nodejs.org/api/events.html',
    what: 'EventEmitter и EventTarget в Node: порядок вызова, событие error, setMaxListeners, отличия EventTarget от браузерного',
  },
  {
    title: 'Express — Writing middleware',
    href: 'https://expressjs.com/en/guide/writing-middleware.html',
    what: 'middleware с аргументом next: передать управление дальше или закончить запрос',
  },
  {
    title: 'koajs/compose — исходник',
    href: 'https://github.com/koajs/compose/blob/master/index.js',
    what: 'compose из Koa: цепочка async-функций с await next() и проверка повторного вызова next()',
  },
  {
    title: 'TypeScript — lib.dom.d.ts, HTMLElementEventMap',
    href: 'https://github.com/microsoft/TypeScript-DOM-lib-generator/blob/main/baselines/dom.generated.d.ts',
    what: 'как платформа типизирует события картой «имя → тип события» в перегрузке addEventListener',
  },
];

export const RELATED =
  'Смежное на сайте: [События DOM](/render/dom-events/) — встроенный наблюдатель, всплытие как цепочка и синхронная отправка. [Наблюдатели: Intersection, Resize, Mutation](/render/observers/) — наблюдатели, которых ведёт браузер. [Стейт-менеджеры изнутри](/frameworks/state-managers/) — стор как посредник с памятью. [Сигналы](/frameworks/signals/) — наблюдатель, который сам знает своих подписчиков. [Отмена: AbortController и AbortSignal](/js/abort-controller/) — одна отписка на всё. [Колбэки](/js/callbacks/) — подписчик как функция, утечки и реентерантность.';
