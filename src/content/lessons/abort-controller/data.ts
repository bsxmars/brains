import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { AbortScenario } from '@/widgets/abort-lab/model/types';

/**
 * Данные темы «Отмена: AbortController и AbortSignal».
 *
 * Тема написана 2026-10-01. Основы уже разобраны в других темах и здесь даны фразой со ссылкой:
 * `AbortController` как единая отписка от слушателей и `fetch` — «Колбэки», раздел «Отмена»
 * (`/js/callbacks/#s8`); «промис — результат, а не операция» — «Промис изнутри», раздел 1;
 * `controller.abort()` против `reader.cancel()` при чтении тела — «Стримы», раздел 5;
 * `TimeoutError` против `AbortError` в фильтре отмены — «Планирование задач», раздел 1;
 * сигнал внутрь асинхронного генератора — «Генераторы», раздел 5. Тема идёт глубже: алгоритм
 * `signal abort` и зависимые сигналы `any()`, что именно видит сервер при отмене `fetch`,
 * правило «проверь — подпишись — отпишись» и утечка слушателей числом, ошибки отмены
 * в API Node, гонка отмены с завершением.
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * Node **24.11.0** (основной) и **26.8.2** (сравнение), Chromium **153.0.8010.12** (Playwright,
 * headless shell), октябрь 2026. Каталог стенда — `scratchpad/agent-abort/`, порты 51800–51804.
 * Без таймерных замеров: всё, что утверждает тема, — порядок событий, имена ошибок, счётчики.
 *
 *   — сценарии `SCENARIOS` исполнены на настоящих `AbortController`/`AbortSignal` в Node 24.11
 *     и в Chromium 153 и на учебной реализации `MINI_CODE`: выводы совпали построчно в обоих;
 *   — `fetch` на свой `node:http` (`SERVER_CODE` + `CLIENT_CODE`): что видит клиент и сервер
 *     на шести стадиях — `FETCH_ROWS`. Тот же опыт в Chromium 153 против того же сервера дал
 *     те же события сервера (`res` `close`, `writableFinished: false`) и те же имена ошибок;
 *   — HTTP/2: Chromium 153 по TLS к `node:http2` и клиент `node:http2` с `{ signal }` — поток
 *     закрывается с `rstCode` 8 (CANCEL), сессия остаётся, следующий запрос идёт по ней же;
 *   — сборщик и `AbortSignal.any()` (`GC_ROWS`): по 1000 зависимых сигналов на долгоживущем,
 *     `WeakRef` + уступка потоку + `gc()` (рецепт из `docs/agents/lesson-structure.md`),
 *     Node 24.11 и 26.8 с `--expose-gc`, Chromium с `--js-flags=--expose-gc`; 3 прогона из 3;
 *   — API Node (`NODE_API_ROWS`): имя, `code`, `cause` ошибки; число слушателей
 *     через `events.getEventListeners`; `getMaxListeners(signal)` — 0;
 *   — встроенный `fetch` Node 24.11: 200 запросов с одним сигналом оставляют на нём 200 слушателей
 *     `abort` до сборки мусора; Node 26.8.2 — 1;
 *   — сообщения ошибок (`message`) различаются между Node и Chromium и не нормативны — в теме
 *     сравниваются только имена.
 *
 * Только по документации, без запуска: порядок `readFile` при отмене (что уже начатое чтение
 * ОС не прерывается), отзыв предложения об отменяемых промисах TC39 (2016).
 *
 * Всё перечисленное, кроме Chromium, повторяет `tests/unit/abort-controller.test.ts`: код
 * примеров — эти же строки. Демо (`widgets/abort-lab`) исполняет `MINI_CODE` и настоящий
 * `AbortController` браузера на каждом сценарии и показывает, совпали ли выводы.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: '`EventTarget` и слушатель',
    d: 'Объект, на который подписываются через `addEventListener(type, fn)` и который рассылает события через `dispatchEvent`. Слушатель — функция `fn`, которую он позовёт. `AbortSignal` — тоже `EventTarget`.',
  },
  {
    k: '`DOMException`',
    d: 'Класс ошибок веб-платформы. Различают их по `name`: `AbortError`, `TimeoutError`, `DataCloneError`. В Node он тоже есть — для совместимости с браузером.',
  },
  {
    k: 'keep-alive соединение',
    d: 'TCP-соединение, которое после ответа не закрывают, а отдают следующему запросу к тому же серверу. В HTTP/1.1 по нему идёт один запрос за раз, в HTTP/2 — много одновременно, каждый своим потоком.',
  },
  {
    k: 'стрим и читатель',
    d: '`ReadableStream` — тело ответа, которое приходит кусками. `getReader()` даёт читателя, а его `read()` — промис следующего куска.',
  },
];

export const PLAIN_PAIR =
  'Как стоп-кран в поезде. Дёрнуть его может тот, у кого есть доступ к ручке, — это контроллер. А лампочка «экстренная остановка» горит в каждом вагоне — это сигнал. По лампочке видно, что поезд останавливают, но сама она ничего не тормозит: тормозит машинист, когда её заметит.';

export const PREREQ_NOTE =
  'Тема опирается на три вещи, разобранные в других темах. Если какая-то из них незнакома, начните со ссылки на карточке.';

export const PREREQ: { t: string; d: string; href: string; hrefLabel: string; tone: 'info' }[] = [
  {
    t: 'Отписка через `AbortController`',
    d: 'Один `controller.abort()` снимает все слушатели, добавленные с его сигналом, и отменяет `fetch`. Это замена полудюжине способов отписаться — и база, на которой стоит эта тема.',
    href: '/js/callbacks/#s8',
    hrefLabel: '«Колбэки», раздел «Отмена, утечки, реентерантность»',
    tone: 'info',
  },
  {
    t: 'Промис — результат, а не операция',
    d: 'У промиса нет ссылки на работу, которая его выполнит. Остановить можно только саму работу, а промис просто получит отказ.',
    href: '/js/promise-internals/#s1',
    hrefLabel: '«Промис изнутри», раздел «Пять скрытых полей»',
    tone: 'info',
  },
  {
    t: '`dispatchEvent` — синхронный вызов',
    d: 'Отправка события зовёт слушателей прямо внутри вашего кода, по порядку подписки. Строка после `dispatchEvent` выполнится, когда отработают все.',
    href: '/render/dom-events/#s7',
    hrefLabel: '«События DOM», раздел «Синхронная отправка»',
    tone: 'info',
  },
];

// ─── Раздел 1. Контроллер и сигнал ─────────────────────────────────────────────────────────

/** Разделение прав. Тест проверяет, что у сигнала нет `abort`, а `search` отменяется владельцем. */
export const PAIR_CODE = `// Функция получает только сигнал: слушать может, отменить — нет
function search(query, signal) {
  return fetch('/api/search?q=' + query, { signal });
}

// Контроллер остаётся у того, кто решает
let current = null;
input.addEventListener('input', () => {
  current?.abort();                  // прошлый запрос больше не нужен
  current = new AbortController();
  search(input.value, current.signal).then(show, ignoreAbort);
});`;

export const PAIR_NOTE =
  'У сигнала нет метода `abort` — вообще нет, а не «закрыт». Поэтому сигнал можно отдать кому угодно: в библиотеку, в пять вложенных функций, в чужой код. Никто из них не отменит работу соседа, все только узнают об отмене. Право решать остаётся там, где создан контроллер.';

export const SIGNAL_API_ROWS: { k: string; d: string }[] = [
  { k: '`signal.aborted`', d: '`true`, если отмена уже была. Свойство только для чтения.' },
  { k: '`signal.reason`', d: 'Причина отмены: то, что передали в `abort(reason)`. До отмены — `undefined`.' },
  { k: '`signal.throwIfAborted()`', d: 'Бросает `reason`, если сигнал отменён; иначе ничего не делает. Одна строка вместо `if (signal.aborted) throw signal.reason`.' },
  { k: 'событие `abort`, `onabort`', d: 'Приходит один раз, в момент отмены, синхронно — внутри вызова `abort()`.' },
  { k: '`AbortSignal.abort(reason)`', d: 'Сразу отменённый сигнал. Удобен в тестах и как «уже поздно».' },
  { k: '`AbortSignal.timeout(ms)`', d: 'Сигнал, который отменится сам через `ms` миллисекунд с причиной `TimeoutError`.' },
  { k: '`AbortSignal.any([a, b])`', d: 'Сигнал, который отменится, как только отменится любой из перечисленных.' },
];

export const ORDER_FACTS: { t: string; d: string; tone?: 'warn' | 'err' }[] = [
  {
    t: 'Синхронно, внутри `abort()`',
    d: 'Все слушатели отработали раньше, чем `abort()` вернул управление. Флаг `aborted` уже стоит, когда зовут первого из них.',
  },
  {
    t: 'Один раз',
    d: 'Второй `abort(\'ещё раз\')` не меняет причину и не шлёт события. Сигнал отменяется навсегда: «включить обратно» нельзя, нужен новый контроллер.',
  },
  {
    t: '`onabort` — такой же слушатель',
    d: 'Он встаёт в общий список в момент первого присваивания. Поэтому «onabort» в выводе стоит между двумя слушателями, а не первым и не последним.',
  },
  {
    t: 'Ошибка в слушателе не останавливает остальных',
    d: 'Из `abort()` она не вылетает. Браузер сообщает о ней сразу (`window.onerror`) и зовёт следующего слушателя. Node 24 бросает её на следующем тике как `uncaughtException` — без обработчика процесс падает.',
    tone: 'warn',
  },
];

export const LATE_NOTE =
  'Событие не «запоминается». Слушатель, добавленный после отмены, не позовут никогда — и промис, который ждёт этого слушателя, повиснет навсегда. Поэтому код, принявший сигнал, сначала смотрит на `aborted` (или зовёт `throwIfAborted()`), а потом подписывается.';

export const REASON_NOTE =
  'Отменённым сигнал считается, когда `reason` не `undefined`. Отсюда два неочевидных случая. `abort(undefined)` равен `abort()` — подставится `DOMException` `AbortError`. А `abort(null)` отменяет сигнал с причиной `null`: `catch (e)` получит `null`, и `e.name` упадёт с `TypeError`. Строка в причине тоже допустима, но `throwIfAborted()` бросит строку — без стека и без `name`. Причина — то, что получат все, кто ждёт: передавайте `Error` или не передавайте ничего.';

// ─── Раздел 2. Учебная реализация ──────────────────────────────────────────────────────────

/**
 * Учебная реализация. Исполняется демо (`widgets/abort-lab/model/run.ts`) и тестом; ни DOM,
 * ни `DOMException` — только `EventTarget` и `Event`, которые есть и в браузере, и в Node.
 * Алгоритмы повторяют DOM Standard: `signal abort` (сначала зависимые получают причину,
 * потом события — сначала у самого сигнала, затем у зависимых) и `create a dependent abort
 * signal` (зависимый сигнал раскрывается до корней). Сознательные отличия перечислены
 * в `MINI_DIFF`.
 */
export const MINI_CODE = `// Причина по умолчанию. В браузере и Node это DOMException,
// здесь — обычная ошибка с тем же name.
class SignalError extends Error {
  constructor(name, message) {
    super(message);
    this.name = name;
  }
}

// Внутренние поля сигнала — то, чего снаружи не видно
const slots = new WeakMap();
const KEY = Symbol('только изнутри');

class MiniAbortSignal extends EventTarget {
  constructor(key) {
    if (key !== KEY) throw new TypeError('Illegal constructor');
    super();
    slots.set(this, {
      reason: undefined,     // undefined — «не отменён»
      handler: null,         // onabort
      dependent: false,      // сигнал собран через any()
      sources: new Set(),    // от кого зависит (только корневые сигналы)
      dependents: new Set(), // кто зависит от него
    });
  }
  get aborted() { return slots.get(this).reason !== undefined; }
  get reason() { return slots.get(this).reason; }
  throwIfAborted() {
    if (this.aborted) throw this.reason;
  }
  get onabort() { return slots.get(this).handler; }
  set onabort(fn) {
    const s = slots.get(this);
    // Обработчик встаёт в общий список при первом присваивании
    if (s.handler === null && typeof fn === 'function') {
      this.addEventListener('abort', (e) => s.handler?.call(this, e));
    }
    s.handler = typeof fn === 'function' ? fn : null;
  }

  static abort(reason) {
    const signal = new MiniAbortSignal(KEY);
    slots.get(signal).reason =
      reason === undefined ? new SignalError('AbortError', 'aborted') : reason;
    return signal;
  }

  static timeout(ms) {
    const signal = new MiniAbortSignal(KEY);
    setTimeout(() => signalAbort(signal, new SignalError('TimeoutError', 'timed out')), ms);
    return signal;
  }

  static any(signals) {
    const result = new MiniAbortSignal(KEY);
    const r = slots.get(result);
    // Уже отменённый — первый по порядку в списке — решает сразу
    for (const s of signals) {
      if (s.aborted) {
        r.reason = s.reason;
        return result;
      }
    }
    r.dependent = true;
    for (const s of signals) {
      const own = slots.get(s);
      // Зависимый раскрывается до своих корней: цепочки any() не растут
      const roots = own.dependent ? own.sources : [s];
      for (const root of roots) {
        r.sources.add(root);
        slots.get(root).dependents.add(result);
      }
    }
    return result;
  }
}

function signalAbort(signal, reason) {
  if (signal.aborted) return;              // второй abort() ничего не делает
  const s = slots.get(signal);
  s.reason = reason === undefined ? new SignalError('AbortError', 'aborted') : reason;
  // Сначала все зависимые получают ту же причину — молча
  const toFire = [];
  for (const dep of s.dependents) {
    if (dep.aborted) continue;
    slots.get(dep).reason = s.reason;
    toFire.push(dep);
  }
  // Потом события: свой сигнал, за ним зависимые — синхронно
  signal.dispatchEvent(new Event('abort'));
  for (const dep of toFire) dep.dispatchEvent(new Event('abort'));
}

class MiniAbortController {
  #signal = new MiniAbortSignal(KEY);
  get signal() { return this.#signal; }
  abort(reason) { signalAbort(this.#signal, reason); }
}`;

export const MINI_FACTS: { t: string; d: string }[] = [
  {
    t: 'Контроллер — это одна функция',
    d: 'Всё состояние живёт в сигнале. Контроллер только хранит ссылку на него и даёт право позвать `signalAbort`. Снаружи до `signalAbort` не добраться: конструктор сигнала закрыт ключом, как настоящий `new AbortSignal()`, который бросает `TypeError`.',
  },
  {
    t: '`any()` не строит цепочку',
    d: 'Если в `any()` передать зависимый сигнал, результат подпишется не на него, а на его корни. `any([any([a])])` зависит прямо от `a`. Поэтому отмена доходит до всех за один проход, без рекурсии.',
  },
  {
    t: 'Причина раньше событий',
    d: 'Сначала все зависимые молча получают ту же причину, и только потом начинается рассылка. Слушатель на корневом сигнале уже видит `aborted: true` у зависимого, хотя событие тому ещё не пришло.',
  },
  {
    t: '`timeout()` — обычный таймер',
    d: 'Никакой магии: `setTimeout`, который через `ms` позовёт тот же `signalAbort` с причиной `TimeoutError`.',
  },
];

export const MINI_DIFF =
  'Чем учебная версия честно хуже настоящей. Причина — не `DOMException`, а свой класс с тем же `name`. Событие создаёт сам скрипт, поэтому у него `isTrusted: false`, а у настоящего — `true`. И главное: учебная держит зависимые сигналы сильными ссылками в `Set`, а настоящая — слабыми. Сколько это стоит, видно в подразделе про сборщик ниже.';

/** Счётчик слушателей для двух сценариев демо. Считает добавленные минус снятые. */
export const TRACK_CODE = `// Сколько слушателей abort сейчас на сигнале: добавлено минус снято
function track(signal) {
  const counter = { live: 0 };
  const add = signal.addEventListener;
  const remove = signal.removeEventListener;
  signal.addEventListener = function (type, fn, opts) {
    if (type === 'abort') counter.live++;
    return add.call(this, type, fn, opts);
  };
  signal.removeEventListener = function (type, fn, opts) {
    if (type === 'abort') counter.live--;
    return remove.call(this, type, fn, opts);
  };
  return counter;
}`;

/**
 * Сценарии демо. Код исполняется как тело async-функции с параметрами `AbortController`,
 * `AbortSignal`, `log`, `sleep`, `track`. `SCENARIO_LOGS` — что напечатали настоящие классы
 * Node 24.11 и Chromium 153 (одинаково); тест сверяет с ними и настоящие, и учебные.
 */
export const SCENARIOS: AbortScenario[] = [
  {
    id: 'order',
    label: 'порядок',
    code: `const ac = new AbortController();
const signal = ac.signal;
signal.addEventListener('abort', () => log('слушатель 1, aborted = ' + signal.aborted));
signal.onabort = () => log('onabort');
signal.addEventListener('abort', () => log('слушатель 2'));
log('до abort()');
ac.abort();
log('после abort()');
ac.abort('ещё раз');
log('reason: ' + signal.reason.name);`,
    note: 'Все три слушателя отработали **внутри** `abort()`: «после abort()» напечатано последним. Второй `abort` не изменил ни причину, ни вывод.',
  },
  {
    id: 'reason',
    label: 'причина',
    code: `const show = (r) => (r === null ? 'null' : typeof r === 'string' ? 'строка ' + r : r.name);
const a = new AbortController(); a.abort();
const b = new AbortController(); b.abort(undefined);
const c = new AbortController(); c.abort(null);
const d = new AbortController(); d.abort('ушёл');
log('abort(): ' + show(a.signal.reason));
log('abort(undefined): ' + show(b.signal.reason));
log('abort(null): ' + show(c.signal.reason) + ', aborted = ' + c.signal.aborted);
try { d.signal.throwIfAborted(); } catch (e) { log('throwIfAborted бросил ' + typeof e); }`,
    note: '`undefined` значит «причины нет» и заменяется на `AbortError`. `null` — уже причина. Строка — тоже, и бросается как есть.',
  },
  {
    id: 'late',
    label: 'подписка после',
    code: `const ac = new AbortController();
ac.abort();
ac.signal.addEventListener('abort', () => log('не позовут никогда'));
log('подписались после отмены');
if (ac.signal.aborted) log('проверка aborted: уже отменён');`,
    note: 'Событие было и прошло. Тот, кто подписался позже, узнает об отмене только из `aborted`.',
  },
  {
    id: 'anyOrder',
    label: 'any: чья причина',
    code: `const a = new AbortController();
const b = new AbortController();
const both = AbortSignal.any([a.signal, b.signal]);
a.signal.addEventListener('abort', () => log('a'));
both.addEventListener('abort', () => log('any, reason = ' + both.reason));
b.signal.addEventListener('abort', () => log('b, any.aborted = ' + both.aborted));
b.abort('B');
a.abort('A');
log('итог: ' + both.reason);`,
    note: 'Побеждает тот, кто отменился **первым по времени**, а не первым в списке. Сначала слушатели самого `b`, потом — зависимого `any`. Поздний `a.abort` до `any` уже не доходит.',
  },
  {
    id: 'anyAlready',
    label: 'any из отменённых',
    code: `const live = new AbortController();
const c = new AbortController(); c.abort('C');
const d = new AbortController(); d.abort('D');
const s = AbortSignal.any([live.signal, d.signal, c.signal]);
log('aborted = ' + s.aborted + ', reason = ' + s.reason);
s.addEventListener('abort', () => log('не позовут: событие уже было бы'));
live.abort('L');
log('reason после live.abort: ' + s.reason);`,
    note: 'Если отменённых в списке несколько, причину даёт **первый по порядку в массиве** — `D`, хотя `C` отменили раньше. Такой сигнал рождается отменённым, и события у него не будет.',
  },
  {
    id: 'chain',
    label: 'цепочка any',
    code: `const root = new AbortController();
const inner = AbortSignal.any([root.signal]);
const outer = AbortSignal.any([inner]);
outer.addEventListener('abort', () => log('outer'));
inner.addEventListener('abort', () => log('inner'));
root.signal.addEventListener('abort', () => log('root, outer.aborted = ' + outer.aborted));
root.abort('R');`,
    note: '`outer` подписан не на `inner`, а прямо на `root`. Порядок событий — порядок создания зависимых, а не подписки на них. И пока идёт слушатель `root`, `outer` уже отменён.',
  },
  {
    id: 'timeout',
    label: 'timeout',
    code: `const user = new AbortController();
const signal = AbortSignal.any([user.signal, AbortSignal.timeout(10)]);
signal.addEventListener('abort', () => log('abort: ' + signal.reason.name));
await sleep(30);
user.abort();
log('после user.abort(): ' + signal.reason.name);`,
    note: 'Таймаут сработал первым, и причина `TimeoutError` закрепилась. Пользователь нажал «отмена» позже — ничего не изменилось.',
  },
  {
    id: 'leak',
    label: 'утечка',
    code: `async function work(signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    queueMicrotask(() => resolve('ok'));
  });
}
const ac = new AbortController();
const count = track(ac.signal);
for (let i = 0; i < 100; i++) await work(ac.signal);
log('после 100 вызовов слушателей: ' + count.live);`,
    note: '`{ once: true }` снимает слушателя, только **когда он сработал**. Работа закончилась штатно, отмены не было — и все сто слушателей остались на сигнале.',
  },
  {
    id: 'leakFixed',
    label: 'без утечки',
    code: `async function work(signal) {
  signal.throwIfAborted();
  const { promise, resolve, reject } = Promise.withResolvers();
  const onAbort = () => reject(signal.reason);
  signal.addEventListener('abort', onAbort);
  try {
    queueMicrotask(() => resolve('ok'));
    return await promise;
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}
const ac = new AbortController();
const count = track(ac.signal);
for (let i = 0; i < 100; i++) await work(ac.signal);
log('после 100 вызовов слушателей: ' + count.live);`,
    note: 'Та же работа, но с отпиской в `finally`. Она выполнится при любом исходе — успехе, ошибке, отмене, — и сигнал остаётся чистым.',
  },
];

export const SCENARIO_LOGS: Record<string, string[]> = {
  order: ['до abort()', 'слушатель 1, aborted = true', 'onabort', 'слушатель 2', 'после abort()', 'reason: AbortError'],
  reason: ['abort(): AbortError', 'abort(undefined): AbortError', 'abort(null): null, aborted = true', 'throwIfAborted бросил string'],
  late: ['подписались после отмены', 'проверка aborted: уже отменён'],
  anyOrder: ['b, any.aborted = true', 'any, reason = B', 'a', 'итог: B'],
  anyAlready: ['aborted = true, reason = D', 'reason после live.abort: D'],
  chain: ['root, outer.aborted = true', 'inner', 'outer'],
  timeout: ['abort: TimeoutError', 'после user.abort(): TimeoutError'],
  leak: ['после 100 вызовов слушателей: 100'],
  leakFixed: ['после 100 вызовов слушателей: 0'],
};

/** Сценарии по id — тема печатает код части из них прямо в разделах. */
export const SCENARIO_BY_ID: Record<string, AbortScenario> = Object.fromEntries(SCENARIOS.map((s) => [s.id, s]));

export const DEMO_CAPTION =
  'Один и тот же код исполняется дважды: на учебных классах из листинга выше и на настоящих `AbortController` и `AbortSignal` этого браузера. Если учебная модель где-то разойдётся с движком, это будет видно сразу.';

export const PLAIN_DEPENDENT =
  'Зависимый сигнал — как общий выключатель в подъезде, который соединён прямо с рубильниками квартир, а не с другими выключателями. Сколько ни собирай «выключатель выключателей», провода всё равно тянутся к рубильникам. Поэтому щелчок доходит до всех сразу, в одном проходе.';

/** `AbortSignal.any([long.signal, …])` по 1000 раз; сколько зависимых пережило `gc()`. */
export const GC_ROWS: { k: string; node24: string; node26: string; chromium: string; tone?: 'warn' | 'err' }[] = [
  { k: 'без слушателей', node24: '0 из 1000', node26: '0 из 1000', chromium: '0 из 1000' },
  { k: 'со слушателем `abort`', node24: '1000 из 1000', node26: '1000 из 1000', chromium: '1000 из 1000', tone: 'warn' },
  { k: 'слушателя добавили и сняли', node24: '0 из 1000', node26: '0 из 1000', chromium: '0 из 1000' },
  { k: 'со слушателем, но второй источник уже отменил его', node24: '1000 из 1000', node26: '0 из 1000', chromium: '0 из 1000', tone: 'err' },
];

export const GC_CODE = `const long = new AbortController();     // живёт, пока живёт приложение

for (const req of requests) {
  const signal = AbortSignal.any([long.signal, req.signal]);
  signal.addEventListener('abort', () => cleanup(req));
  handle(req, signal);
}`;

export const GC_NOTE =
  'Настоящий `any()` держит зависимые сигналы слабо: сигнал без слушателей сборщик заберёт, даже если корень жив. Но сигнал со слушателем `abort` удерживается, пока жив хотя бы один его неотменённый источник, — иначе слушатель некому было бы позвать. В цикле выше каждый запрос оставляет на долгоживущем `long` по сигналу, и в Node 24.11 их не отпускает даже отмена самого запроса. В Node 26.8 и Chromium 153 отменённый зависимый отпускается. Средство одно на всех: снять слушателя, когда работа закончена.';

// ─── Раздел 3. fetch ────────────────────────────────────────────────────────────────────────

/** Сервер стенда. Тест исполняет его вместе с `CLIENT_CODE` в отдельном процессе Node. */
export const SERVER_CODE = `import http from 'node:http';
import { setTimeout as sleep, setInterval as every } from 'node:timers/promises';

const seen = {};                       // что сервер узнал о каждом запросе
const note = (url, text) => (seen[url] ??= []).push(text);

const server = http.createServer(async (req, res) => {
  const url = req.url;
  note(url, 'запрос пришёл');
  // Своя отмена на каждый запрос: клиент ушёл — бросаем работу
  const work = new AbortController();
  res.on('close', () => {
    note(url, 'close, ответ дописан: ' + res.writableFinished);
    if (!res.writableFinished) work.abort();
  });
  try {
    if (url.startsWith('/slow')) {
      await sleep(1000, null, { signal: work.signal }); // «долгий запрос в базу»
      res.end('поздно');
    } else if (url.startsWith('/stream')) {
      res.writeHead(200);
      let n = 0;
      for await (const _ of every(20, null, { signal: work.signal })) {
        res.write('кусок ' + ++n + '\\n');
        if (n === 50) break;
      }
      res.end();
    } else {
      res.end('готово');
    }
  } catch (e) {
    note(url, 'работа брошена: ' + e.name);
  }
});`;

export const CLIENT_CODE = `const client = [];
const base = 'http://127.0.0.1:' + server.address().port;

// 1. Сигнал отменён заранее
await fetch(base + '/never', { signal: AbortSignal.abort() })
  .catch((e) => client.push('1: ' + e.name));

// 2. Отмена до заголовков ответа
const ac2 = new AbortController();
const p2 = fetch(base + '/slow/2', { signal: ac2.signal });
await sleep(50);
ac2.abort();
await p2.catch((e) => client.push('2: ' + e.name));

// 3. Отмена посреди тела
const ac3 = new AbortController();
const res3 = await fetch(base + '/stream/3', { signal: ac3.signal });
const reader = res3.body.getReader();
await reader.read();                      // первый кусок пришёл
ac3.abort();
await reader.read().catch((e) => client.push('3: read() — ' + e.name));

// 4. Своя причина
const ac4 = new AbortController();
const why = new Error('пользователь ушёл');
const p4 = fetch(base + '/slow/4', { signal: ac4.signal });
await sleep(50);
ac4.abort(why);
await p4.catch((e) => client.push('4: отклонён самой причиной — ' + (e === why)));

// 5. Таймаут
await fetch(base + '/slow/5', { signal: AbortSignal.timeout(50) })
  .catch((e) => client.push('5: ' + e.name));

// 6. Отмена после ответа
const ac6 = new AbortController();
const text = await (await fetch(base + '/fast/6', { signal: ac6.signal })).text();
ac6.abort();
client.push('6: ' + text + ', abort() опоздал');`;

/** Вывод стенда: `client` и `seen` после прогона. Тест сверяет построчно. */
export const FETCH_RESULT = {
  client: [
    '1: AbortError',
    '2: AbortError',
    '3: read() — AbortError',
    '4: отклонён самой причиной — true',
    '5: TimeoutError',
    '6: готово, abort() опоздал',
  ],
  seen: {
    '/slow/2': ['запрос пришёл', 'close, ответ дописан: false', 'работа брошена: AbortError'],
    '/stream/3': ['запрос пришёл', 'close, ответ дописан: false', 'работа брошена: AbortError'],
    '/slow/4': ['запрос пришёл', 'close, ответ дописан: false', 'работа брошена: AbortError'],
    '/slow/5': ['запрос пришёл', 'close, ответ дописан: false', 'работа брошена: AbortError'],
    '/fast/6': ['запрос пришёл', 'close, ответ дописан: true'],
  } as Record<string, string[]>,
};

export const FETCH_ROWS: { k: string; client: string; server: string; tone?: 'ok' | 'warn' }[] = [
  {
    k: '1. сигнал отменён заранее',
    client: '`fetch` сразу отклонён с `AbortError`',
    server: 'ничего: запрос не ушёл, в `seen` нет `/never`',
  },
  {
    k: '2. до заголовков',
    client: '`fetch` отклонён с `AbortError`',
    server: '`close` при недописанном ответе → своя отмена → «долгий запрос в базу» брошен',
  },
  {
    k: '3. посреди тела',
    client: '`fetch` уже выполнился, отклоняется ждущий `read()`',
    server: 'то же: `close`, генерация кусков остановлена',
  },
  {
    k: '4. своя причина',
    client: 'отклонён **самим объектом** `why`, не `DOMException`',
    server: 'то же, что в шаге 2: причина до сервера не доходит',
  },
  {
    k: '5. `AbortSignal.timeout(50)`',
    client: '`TimeoutError`, а не `AbortError`',
    server: 'то же, что в шаге 2',
  },
  {
    k: '6. после ответа',
    client: '`abort()` ничего не делает, тело уже прочитано',
    server: 'обычный конец: `close` с дописанным ответом',
    tone: 'ok',
  },
];

export const FETCH_FACTS: { t: string; d: string; tone?: 'warn' | 'err' }[] = [
  {
    t: 'HTTP/1.1: соединение рвётся',
    d: 'В HTTP/1.1 нельзя сказать серверу «этот запрос больше не нужен» и остаться на связи. Клиент просто закрывает соединение, и сервер видит `close`. Следующему запросу придётся открыть новое.',
  },
  {
    t: 'HTTP/2: закрывается только поток',
    d: 'Здесь у каждого запроса свой поток внутри общего соединения. Отмена шлёт кадр `RST_STREAM` с кодом `CANCEL` (8): `node:http2` видит у потока `rstCode` 8, а соседние потоки и само соединение живут. Так ведут себя и Chromium 153, и клиент `node:http2` с опцией `signal`.',
  },
  {
    t: 'Сервер сам ничего не бросает',
    d: 'Обработчик на сервере работает дальше, пока его не остановят. Узнать об уходе клиента можно из `res.on(\'close\')` с `writableFinished: false`, а остановить работу — своим контроллером. Именно это делает `SERVER_CODE`.',
    tone: 'warn',
  },
  {
    t: 'Отмена ничего не откатывает',
    d: 'Если сервер уже записал заказ в базу, отмена на клиенте этого не отменит. Клиент только перестаёт ждать ответ. Для запросов, которые что-то меняют, «отменил» не значит «не случилось».',
    tone: 'err',
  },
  {
    t: 'Сравнивайте имена, не тексты',
    d: 'Тексты ошибок у движков разные: Node пишет «This operation was aborted», Chromium — «signal is aborted without reason», а при чтении тела — «BodyStreamBuffer was aborted». Совпадают только `name` и `code` (20 у `AbortError`, 23 у `TimeoutError`).',
  },
];

export const BODY_NOTE =
  'Отмена во время чтения тела отклоняет ждущий `read()` — или `res.text()` и `res.json()`, если читали ими. Чем `controller.abort()` отличается здесь от `reader.cancel()` и `break` в `for await`, разобрано в [«Стримах», раздел «Отмена, `tee` и блокировка читателя»](/platform/streams/#s5).';

// ─── Раздел 4. timeout и any ────────────────────────────────────────────────────────────────

/** Таймаут плюс отмена пользователем; тест зовёт с маленьким `ms`. */
export const COMBINE_CODE = `async function load(url, { signal, ms = 5000 } = {}) {
  const timeout = AbortSignal.timeout(ms);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    return await fetch(url, { signal: combined });
  } catch (e) {
    // Кто именно отменил — видно по сигналам, а не по тексту ошибки
    if (timeout.aborted && !signal?.aborted) {
      throw new Error('сервер не ответил за ' + ms + ' мс', { cause: e });
    }
    throw e;   // отмена пользователем или сетевая ошибка — как есть
  }
}`;

export const COMBINE_FACTS: { t: string; d: string; tone?: 'warn' | 'err' }[] = [
  {
    t: 'Кто отменил — спросите сигналы',
    d: 'Имя ошибки годится не всегда: пользователь мог отменить с причиной `TimeoutError`, а Node-API заворачивают любую причину в свой `AbortError`. Надёжнее проверить `timeout.aborted` и `signal.aborted` — они говорят, кто сработал на самом деле.',
  },
  {
    t: 'Причина — от первого по времени',
    d: 'Если отменились оба, `combined.reason` — причина того, кто успел раньше. Если в `any()` попали уже отменённые сигналы, побеждает первый из них по порядку в массиве.',
  },
  {
    t: 'Таймер `timeout()` в Node не держит процесс',
    d: 'Он снят с учёта цикла (`unref`): если больше ждать нечего, Node завершится, не дожидаясь отмены. Скрипт, который ждёт только события такого сигнала, выходит с кодом 13 и предупреждением о незавершённом `await` верхнего уровня.',
    tone: 'warn',
  },
];

// ─── Раздел 5. Своя функция с сигналом ─────────────────────────────────────────────────────

export const PLAIN_RULE =
  'Как смена на складе: пришёл — посмотри на табло, не объявлена ли эвакуация; работаешь — держи рацию включённой; уходишь — сдай рацию. Забудешь сдать — через месяц на складе сотня раций, которые никто не слушает, но которые все ещё ловят эфир.';

/** Правило темы на таймере. Тест: 100 вызовов — 0 слушателей; отмена — отказ с `reason`. */
export const DELAY_CODE = `async function delay(ms, { signal } = {}) {
  signal?.throwIfAborted();                  // 1. проверить в начале
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort); // 3. отписаться в конце
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true }); // 2. подписаться
  });
}`;

export const DELAY_FACTS: { t: string; d: string; tone?: 'warn' | 'err' }[] = [
  {
    t: 'Проверка в начале — внутри `async`',
    d: 'Если сигнал уже отменён, `throwIfAborted()` бросает, а `async` превращает это в отклонённый промис. Без `async` функция бросила бы синхронно, и вызывающему пришлось бы ловить ошибку двумя способами.',
  },
  {
    t: 'Подписка снимает таймер',
    d: 'Отклонить промис мало: таймер продолжит тикать и через `ms` позовёт `resolve` впустую. Отмена работы — это остановка того, что работу делает.',
  },
  {
    t: 'Отписка — при любом исходе',
    d: 'Здесь она в колбэке таймера, потому что другого исхода нет. Если исходов больше — успех, ошибка, отмена, — её место в `finally`, как в сценарии «без утечки» демо. `{ once: true }` спасает только от повторного вызова, не от утечки.',
    tone: 'warn',
  },
];

export const LEAK_NODE_NOTE =
  'Утечка молчит. Обычный `EventTarget` в Node предупреждает `MaxListenersExceededWarning` на одиннадцатом слушателе одного типа, а у `AbortSignal` порог выключен: `events.getMaxListeners(signal)` возвращает 0. Даже встроенный `fetch` в Node 24.11 после 200 запросов с одним сигналом оставляет на нём 200 слушателей — их снимает только сборщик. В Node 26.8 после тех же 200 запросов остаётся один.';

/** Что принимает сигнал в Node и чем отклоняется. Тест повторяет каждую строку. */
export const NODE_API_ROWS: { k: string; how: string; what: string }[] = [
  {
    k: '`setTimeout`, `setInterval` из `node:timers/promises`',
    how: '`sleep(ms, value, { signal })`',
    what: 'Таймер снят, промис отклонён. Цикл `for await` по `setInterval` бросает на очередном шаге.',
  },
  {
    k: '`events.once(emitter, name, { signal })`',
    how: 'третьим аргументом',
    what: 'Слушатель снят с эмиттера: `listenerCount` был 1, стал 0.',
  },
  {
    k: '`fs.readFile(path, { signal })`',
    how: 'в опциях',
    what: 'Промис или колбэк получает отказ. По документации Node уже начатое обращение к диску не прерывается — прекращается чтение следующих кусков.',
  },
  {
    k: '`child_process.spawn`, `exec`',
    how: 'в опциях',
    what: 'Процесс убит сигналом `SIGTERM` (или тем, что указан в `killSignal`). Событие `\'error\'` с отказом, затем `\'exit\'` с `signal`.',
  },
  {
    k: '`events.addAbortListener(signal, fn)`',
    how: 'вместо `addEventListener`',
    what: 'Возвращает объект с `[Symbol.dispose]`: после `dispose` слушатель снят. Подходит для `using`.',
  },
  {
    k: '`ReadableStream.pipeTo(dest, { signal })`',
    how: 'в опциях',
    what: 'У источника вызван `cancel(reason)`, у приёмника — `abort(reason)`, промис `pipeTo` отклонён с той же причиной. Уже прочитанный кусок перед этим дописывается.',
  },
];

/** Ошибка отмены в API Node и в fetch с одной и той же причиной. Исполняется тестом. */
export const NODE_ERR_CODE = `import { setTimeout as sleep } from 'node:timers/promises';

const why = new Error('пользователь ушёл');
const signal = AbortSignal.abort(why);

const fromFetch = await fetch('http://127.0.0.1:9', { signal }).catch((e) => e);
const fromSleep = await sleep(1000, null, { signal }).catch((e) => e);

fromFetch === why;                    // true:  fetch отдаёт причину как есть
fromSleep === why;                    // false: Node заворачивает её
fromSleep.name;                       // 'AbortError'
fromSleep.code;                       // 'ABORT_ERR'
fromSleep.cause === why;              // true:  причина — в cause
fromSleep instanceof DOMException;    // false: это свой класс Node`;

export const NODE_ERR_NOTE =
  'Два стандарта отказа в одном процессе. `fetch` и веб-стримы отклоняются самой причиной. API Node — своим `AbortError` с `code: \'ABORT_ERR\'`, а причину кладут в `cause`. Проверка `e === signal.reason` работает для первых и молча не срабатывает для вторых; `e.name === \'AbortError\'` — наоборот, промахивается по `fetch` со своей причиной. Работает везде одно: `signal.aborted`.';

export const ELSEWHERE_NOTE =
  'Слушатели DOM с `{ signal }` и `EventEmitter`, который такой опции не понимает, разобраны в [«Колбэках», раздел «Отмена, утечки, реентерантность»](/js/callbacks/#s8). Как передать сигнал внутрь асинхронного генератора, чтобы прервать его ожидание, — в [«Генераторах», раздел «Ранний выход»](/js/generators/#s5). Как нарезанная работа проверяет сигнал между кусками — в [«Планировании задач», подраздел «Нарезанную работу нужно уметь отменить»](/js/task-scheduling/#s2).';

// ─── Раздел 6. Гонка и промис ──────────────────────────────────────────────────────────────

export const RACE_CODE = `const ac = new AbortController();
let finish;
const job = new Promise((resolve, reject) => {
  finish = resolve;
  ac.signal.addEventListener('abort', () => {
    log('слушатель abort всё равно сработал');
    reject(ac.signal.reason);
  });
});
finish('данные');   // операция успела
ac.abort();         // отмена опоздала на одну строку
const result = await job;
log('результат: ' + result + ', aborted: ' + ac.signal.aborted);`;

export const RACE_LOG = ['слушатель abort всё равно сработал', 'результат: данные, aborted: true'];

export const RACE_FACTS: { t: string; d: string; tone?: 'warn' | 'err' }[] = [
  {
    t: 'Первым решает тот, кто успел',
    d: 'Промис получает результат один раз. `reject` после `resolve` ничего не меняет, и `await` отдаёт данные, хотя сигнал отменён. Это не ошибка, а единственно возможное поведение: отменять уже нечего.',
  },
  {
    t: 'Но слушатель отработал',
    d: 'Если он не только отклоняет промис, а ещё что-то делает — пишет в лог «отменено», откатывает интерфейс, — это случится зря. Ещё одна причина снимать слушателя, когда работа закончена.',
    tone: 'warn',
  },
  {
    t: 'После `await` спросите сигнал',
    d: 'Если результат после отмены применять нельзя — например, ответ на старый поисковый запрос, — проверьте `signal.aborted` после `await`. Данные могли прийти за мгновение до отмены.',
  },
];

export const NO_CANCEL_NOTE =
  'Почему у промиса нет метода `cancel`, разобрано в [«Промисе изнутри»](/js/promise-internals/#s1): промис — результат, а не операция. Есть и вторая причина, практическая. Один промис может ждать сколько угодно потребителей. Если бы любой из них мог его отменить, он отменил бы работу и для всех остальных. Поэтому отмена принадлежит операции, и делить её между потребителями приходится вручную.';

/** Общий запрос с отменой «когда ушли все». Тест исполняет вместе с `SHARED_DEMO_CODE`. */
export const SHARED_CODE = `// Один запрос на всех, кому он нужен. Каждый уходит своим сигналом,
// а сам запрос отменяется, только когда ушли все.
function shareable(load) {
  let current = null;
  return async function get(signal) {
    signal.throwIfAborted();
    if (!current) {
      const ac = new AbortController();
      const fresh = { ac, users: 0, promise: load(ac.signal) };
      fresh.promise.catch(() => {}).finally(() => {
        if (current === fresh) current = null;
      });
      current = fresh;
    }
    const entry = current;
    entry.users++;
    const { promise, resolve, reject } = Promise.withResolvers();
    const leave = () => {
      reject(signal.reason);
      if (--entry.users === 0) entry.ac.abort();
    };
    signal.addEventListener('abort', leave);
    entry.promise.then(resolve, reject);
    try {
      return await promise;
    } finally {
      signal.removeEventListener('abort', leave);
    }
  };
}`;

export const SHARED_DEMO_CODE = `const load = (signal) => new Promise((resolve, reject) => {
  const t = setTimeout(() => resolve('отчёт'), 20);
  signal.addEventListener('abort', () => {
    clearTimeout(t);
    log('запрос отменён');
    reject(signal.reason);
  });
});
const get = shareable(load);

const a = new AbortController(), b = new AbortController();
const pa = get(a.signal).catch((e) => 'A ушёл: ' + e.name);
const pb = get(b.signal);
a.abort();                    // первый ушёл — запрос живёт ради второго
log(await pa);
log('B получил: ' + await pb);

const c = new AbortController(), d = new AbortController();
const pc = get(c.signal).catch((e) => e.name);
const pd = get(d.signal).catch((e) => e.name);
c.abort();
d.abort();                    // ушли оба — запрос отменён
log('C и D: ' + await pc + ', ' + await pd);`;

export const SHARED_LOG = ['A ушёл: AbortError', 'B получил: отчёт', 'запрос отменён', 'C и D: AbortError, AbortError'];

export const SHARED_NOTE =
  '`AbortSignal.any` собирает «или»: отменить, если ушёл **хоть один**. Для общего запроса нужно «и»: отменить, когда ушли **все**. Такого готового метода нет, и он пишется счётчиком. Каждый потребитель получает свой промис и уходит своим сигналом, а общий контроллер срабатывает на последнем уходе.';

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: '`{ once: true }` — не отписка',
    d: 'Слушатель снимается, только когда сработает. Если отмены так и не было, он остаётся на сигнале навсегда. На долгоживущем сигнале сто вызовов оставят сто слушателей, и Node об этом не предупредит.',
    tone: 'err',
  },
  {
    n: '02',
    t: 'Подписка после отмены — вечное ожидание',
    d: 'Событие `abort` не повторяется для опоздавших. Промис, который ждёт его, не выполнится никогда. Сначала `throwIfAborted()`, потом `addEventListener`.',
    tone: 'err',
  },
  {
    n: '03',
    t: '`abort(null)` отменяет с причиной `null`',
    d: 'Только `undefined` заменяется на `AbortError`. `null` и строка становятся причиной как есть, и код в `catch`, который читает `e.name`, упадёт сам.',
    tone: 'warn',
  },
  {
    n: '04',
    t: '`fetch` и API Node отклоняются по-разному',
    d: '`fetch` отдаёт вашу причину как есть, API Node — свой `AbortError` с причиной в `cause`. Определяйте отмену по `signal.aborted`, а не по виду ошибки.',
    tone: 'warn',
  },
  {
    n: '05',
    t: 'Ошибка в слушателе `abort` в Node роняет процесс',
    d: 'Она не вылетает из `abort()` и не мешает остальным слушателям. Но на следующем тике Node бросает её как `uncaughtException`. В браузере её получит `window.onerror`, страница продолжит работу.',
    tone: 'err',
  },
  {
    n: '06',
    t: '`any()` со слушателем держит сигнал в памяти',
    d: 'Пока жив хотя бы один неотменённый источник. В Node 24.11 — даже после того, как зависимый отменён другим источником. Снимайте слушателя, когда работа закончена.',
    tone: 'warn',
  },
  {
    n: '07',
    t: 'Отмена `fetch` не останавливает сервер',
    d: 'Сервер узнаёт об уходе клиента только из `close` и сам решает, бросать ли работу. Запрос, который уже что-то записал, отмена не откатывает.',
  },
  {
    n: '08',
    t: '`AbortSignal.timeout()` в Node не держит процесс',
    d: 'Его таймер не учитывается циклом событий. Если больше ждать нечего, процесс выйдет раньше, чем сигнал сработает.',
  },
];

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'DOM Standard — Aborting ongoing activities',
    href: 'https://dom.spec.whatwg.org/#aborting-ongoing-activities',
    what: '`AbortController`, `AbortSignal`, алгоритм `signal abort`, зависимые сигналы `any()`, правила сборки мусора и требования к API, принимающим сигнал',
  },
  {
    title: 'Fetch Standard',
    href: 'https://fetch.spec.whatwg.org/',
    what: 'что делает `fetch` при отмене сигнала на каждой стадии: до ответа, во время чтения тела',
  },
  {
    title: 'Streams Standard',
    href: 'https://streams.spec.whatwg.org/',
    what: '`pipeTo` с `signal`: `cancel` у источника, `abort` у приёмника, дописывание прочитанного',
  },
  {
    title: 'RFC 9113 — HTTP/2, коды ошибок',
    href: 'https://www.rfc-editor.org/rfc/rfc9113#section-7',
    what: '`RST_STREAM` и код `CANCEL` (0x8): поток закрыт, соединение живёт',
  },
  {
    title: 'MDN — AbortSignal',
    href: 'https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal',
    what: 'свойства и статические методы `abort`, `timeout`, `any`; поддержка в браузерах',
  },
  {
    title: 'Node.js — AbortController (globals)',
    href: 'https://nodejs.org/api/globals.html#class-abortcontroller',
    what: 'реализация в Node; `AbortSignal.timeout` и его таймер вне учёта цикла',
  },
  {
    title: 'Node.js — events',
    href: 'https://nodejs.org/api/events.html',
    what: '`getEventListeners`, `getMaxListeners`, `addAbortListener`, `once` с `signal`',
  },
  {
    title: 'tc39 — proposal-cancelable-promises',
    href: 'https://github.com/tc39/proposal-cancelable-promises',
    what: 'отозванное в 2016 году предложение об отменяемых промисах',
  },
];

export const RELATED =
  'Смежное на сайте: [Колбэки, раздел «Отмена, утечки, реентерантность»](/js/callbacks/#s8) — `AbortController` как единая отписка и `EventEmitter` без `signal`. [Промис изнутри, раздел «Комбинаторы»](/js/promise-internals/#s4) — почему `Promise.race` не отменяет проигравших. [Генераторы, раздел «Ранний выход»](/js/generators/#s5) — сигнал внутрь асинхронного генератора. [Стримы, раздел «Отмена, tee и блокировка»](/platform/streams/#s5) — `abort` против `cancel` при чтении тела. [Стримы Node, раздел «Ошибки и destroy»](/platform/node-streams/#s6) — `addAbortSignal` и отмена как `destroy`. [Планирование задач, подраздел «Нарезанную работу нужно уметь отменить»](/js/task-scheduling/#s2) — `TaskSignal` и отмена нарезанной работы.';
