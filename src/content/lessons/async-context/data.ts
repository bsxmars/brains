import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { LogEntry, Scenario } from '@/widgets/context-lab/model/types';

/**
 * Данные темы «Асинхронный контекст: AsyncLocalStorage и AsyncContext».
 *
 * Тема написана здесь, 2026-10-02, для направления «Внутренности JS».
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * Node **24.11.0** (V8 13.6), он же исполняет vitest проекта; для сравнения — Node 20.14.0
 * и 26.8.2 с машины автора. `@opentelemetry/api` 1.9.1 и `@vue/compiler-sfc` 3.5.42 — из
 * `node_modules` проекта. Chromium 153.0.8010.12, Firefox 155.0, WebKit 26.6 (Playwright 1.63).
 * Октябрь 2026.
 *
 * Что снято и как:
 *   — сервер на `node:http` (`SERVER_GLOBAL_CODE`, `SERVER_ALS_CODE`): клиент шлёт `/cart`
 *     с `x-request-id: r-1`, через 20 мс — `/profile` с `r-2`; вывод сервера — `SERVER_*_LOG`.
 *     На стенде порт 5020, тест подставляет свободный;
 *   — момент снимка (`CAPTURE_CODE` → `CAPTURE_SEEN`), `enterWith` (`ENTER_WITH_CODE` →
 *     `ENTER_WITH_SEEN`) — в обоих режимах Node 24: по умолчанию и с `--no-async-context-frame`.
 *     Ответы совпали; совпали и на четырёх дополнительных случаях, которых в теме нет
 *     (`await` thenable-объекта, обработчик `unhandledRejection`, `als.exit`, `emit` вне `run`);
 *   — цена старой реализации (`COST_CODE` → `COST_RESULT`): число вызовов `_propagate` —
 *     метода, через который хук `init` старой реализации раскладывает хранилище по новым
 *     асинхронным ресурсам. Время не мерялось. Состав ресурсов (6 промисов и 2 `Timeout`
 *     на один запрос) снят отдельным `async_hooks.createHook` — это `COST_RESOURCES`;
 *   — устройство новой реализации прочитано в самом Node: `--expose-internals`,
 *     `require('internal/async_context_frame')` — класс `AsyncContextFrame` поверх `SafeMap`
 *     (внутренняя копия `Map`, `Object.prototype.toString` — `[object Map]`),
 *     `require('internal/async_local_storage/async_context_frame')` — `run` через `enterWith`;
 *     `getHookArrays()` из `internal/async_hooks` — хуков 0 в новом режиме и 1 в старом,
 *     причём в старом хук ставится уже конструктором `AsyncLocalStorage`. Символ
 *     `kAsyncContextFrame` у объекта `Timeout` виден и без флага (`Object.getOwnPropertySymbols`);
 *   — флаги: Node 24.11 и 26.8 знают `--no-async-context-frame`; `--experimental-async-context-frame`
 *     24.11 отвергает (`bad option`), Node 20.14 — тоже (там нет новой реализации вовсе).
 *     **Только по документации**: в Node 22 новая реализация включалась этим флагом, по умолчанию
 *     она с 24.0.0 (CLI-документация Node, `added: v24.0.0` у `--no-async-context-frame`);
 *     `withScope` — с 24.20.0 (проверено запуском на 26.8.2, на 24.11 метода нет);
 *   — учебная обёртка (`MINI_CODE`) прогнана на шести сценариях `SCENARIOS` против настоящего
 *     `AsyncLocalStorage` (в обоих режимах) и против глобальной переменной (`GLOBAL_CODE`).
 *     Журналы — `LOGS`. Та же обёртка исполнена в Chromium 153 — журналы те же;
 *   — `AsyncContext` и `AsyncLocalStorage` как глобальные имена: `typeof` в трёх движках —
 *     `undefined` везде (`BROWSER_ROWS`). Статус предложения — README репозитория
 *     `tc39/proposals` (раздел Stage 2) и `tc39/proposal-async-context`, октябрь 2026;
 *     правила для событий — их `WEB-INTEGRATION.md`. API `AsyncContext` — цитата, не запуск;
 *   — OpenTelemetry (`OTEL_CODE`): без менеджера контекста `context.active()` пуст даже
 *     синхронно; с менеджером на `AsyncLocalStorage` значение доживает до конца `await`;
 *   — **Только по документации и исходникам OpenTelemetry** (пакеты в проекте не установлены):
 *     `AsyncLocalStorageContextManager` в `@opentelemetry/context-async-hooks`, `StackContextManager`
 *     веб-SDK по умолчанию и `ZoneContextManager` в `@opentelemetry/context-zone`;
 *   — Vue: `compileScript` из `@vue/compiler-sfc` 3.5.42 на `<script setup>` с `await` —
 *     `VUE_OUT_CODE` дословно (кроме отступов внутри выражения).
 *
 * Всё, кроме браузеров и Node 20/26, повторяет `tests/unit/async-context.test.ts`.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'асинхронный контекст',
    d: 'Значение, которое «едет» вместе с цепочкой асинхронной работы: всё, что запущено ради одного запроса, видит его id, хотя между шагами стек пустел и выполнялся чужой код.',
  },
  {
    k: 'регистрация и вызов колбэка',
    d: 'Регистрация — момент, когда колбэк отдали: `setTimeout(fn)`, `p.then(fn)`. Вызов — момент, когда его выполнили. Между ними проходит время, и «текущий запрос» за это время может смениться.',
  },
  {
    k: 'снимок (snapshot)',
    d: 'Копия всех значений контекста на один момент. Снимок берут при регистрации колбэка и восстанавливают на время его вызова.',
  },
  {
    k: '`AsyncLocalStorage` (ALS)',
    d: 'Встроенный в Node механизм асинхронного контекста: `run(значение, fn)` задаёт значение, `getStore()` читает его из любого кода, запущенного внутри `fn`, — сразу или потом.',
  },
  {
    k: '`async_hooks`',
    d: 'Старый низкоуровневый модуль Node: колбэки на создание и запуск каждого асинхронного ресурса — промиса, таймера, сокета. На нём ALS был построен до Node 24.',
  },
  {
    k: '`AsyncContext`',
    d: 'Предложение в стандарт языка: тот же механизм, что ALS, но в самом JavaScript и в браузере. Пока черновик, ни в одном движке его нет.',
  },
];

export const PLAIN_CONTEXT =
  'Как бирка на чемодане в аэропорту. Багаж едет по лентам, ждёт в тележках, его перекладывают чужие руки — но бирку прикрепили при сдаче, и на выдаче по ней понятно, чей он. Глобальная переменная — это табло над лентой: на нём рейс, который сдавал багаж последним, а не тот, чей чемодан сейчас едет.';

export const PREREQ_NOTE =
  'Тема опирается на то, как устроены цикл событий и промисы. Достаточно общей картины — подробности по ссылкам.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'Колбэк выполняется на пустом стеке',
    d: 'Таймер, событие, ответ сети вызывает цикл событий, а не ваша функция. Когда колбэк начинает работу, кадров того, кто его поставил, на стеке уже нет.',
    href: '/js/callbacks/#s1',
    hrefLabel: '«Колбэки», раздел «Стек»',
    tone: 'info',
  },
  {
    t: 'Задачи и микрозадачи',
    d: 'Между задачами (таймер, событие) движок выполняет все микрозадачи: продолжения промисов и `queueMicrotask`. Два запроса к серверу идут «одновременно» именно так — по очереди, кусками.',
    href: '/js/event-loop/#s1',
    hrefLabel: '«Event Loop», раздел «Оборот»',
    tone: 'info',
  },
  {
    t: '`then` записывает реакцию в промис',
    d: 'Вызов `p.then(fn)` не выполняет `fn`, а кладёт её в список реакций промиса. Когда промис выполнится, движок поставит микрозадачу. `await` делает то же самое, но без вызова метода `then`.',
    href: '/js/promise-internals/#s2',
    hrefLabel: '«Промис изнутри», раздел «Три операции»',
    tone: 'info',
  },
];

// ─── Раздел 1. Одна переменная на всех ─────────────────────────────────────────────────────

/** Сервер с id запроса в глобальной переменной. Вывод — `SERVER_GLOBAL_LOG`. */
export const SERVER_GLOBAL_CODE = `import http from 'node:http';

let requestId;                          // одна ячейка на весь процесс
const log = (msg) => console.log(\`[\${requestId}] \${msg}\`);
const db = (ms) => new Promise((r) => setTimeout(r, ms));

http.createServer(async (req, res) => {
  requestId = req.headers['x-request-id'];
  log(\`\${req.url} принят\`);
  await db(req.url === '/cart' ? 60 : 10);  // корзина считается дольше
  log(\`\${req.url} база ответила\`);
  res.end('ok');
}).listen(5020);`;

/** Тот же сервер на `AsyncLocalStorage`. Вывод — `SERVER_ALS_LOG`. */
export const SERVER_ALS_CODE = `import http from 'node:http';
import { AsyncLocalStorage } from 'node:async_hooks';

const als = new AsyncLocalStorage();
const log = (msg) => console.log(\`[\${als.getStore()}] \${msg}\`);
const db = (ms) => new Promise((r) => setTimeout(r, ms));

http.createServer((req, res) => {
  als.run(req.headers['x-request-id'], async () => {
    log(\`\${req.url} принят\`);
    await db(req.url === '/cart' ? 60 : 10);
    log(\`\${req.url} база ответила\`);
    res.end('ok');
  });
}).listen(5020);`;

/** Клиент стенда: `/cart` с `r-1`, через 20 мс `/profile` с `r-2`. */
export const CLIENT_CODE = `const get = (path, id) =>
  fetch(\`http://localhost:5020\${path}\`, { headers: { 'x-request-id': id } });

const cart = get('/cart', 'r-1');
await new Promise((r) => setTimeout(r, 20));
await Promise.all([cart, get('/profile', 'r-2')]);`;

export const SERVER_GLOBAL_LOG = `[r-1] /cart принят
[r-2] /profile принят
[r-2] /profile база ответила
[r-2] /cart база ответила`;

export const SERVER_ALS_LOG = `[r-1] /cart принят
[r-2] /profile принят
[r-2] /profile база ответила
[r-1] /cart база ответила`;

export const RACE_STEPS = [
  {
    k: '0 мс: пришёл `/cart`',
    d: 'Обработчик записал `requestId = r-1`, напечатал первую строку и дошёл до `await`. Функция встала на паузу, стек опустел — сервер свободен.',
  },
  {
    k: '20 мс: пришёл `/profile`',
    d: 'Второй вызов того же обработчика записал в **ту же** переменную `r-2`. Первый запрос стоит на паузе и ничего об этом не знает.',
  },
  {
    k: '80 мс: база ответила для `/cart`',
    d: 'Первый обработчик продолжился после `await` и прочитал `requestId`. Там `r-2` — последнее, что записали. Лог корзины ушёл с чужим id, и никакой ошибки не было.',
  },
];

export const RACE_NOTE =
  'Синхронный код такой ошибки не даёт: пока функция работает, никто другой не выполняется, и переменная — её. Ломает всё `await`: функция отдаёт поток посреди работы, а глобальная переменная не знает, что «её» запрос стоит на паузе. В тестах с одним запросом за раз ошибку не видно — она появляется только под нагрузкой.';

export const PLAIN_ALS =
  'Как номерок в гардеробе, который выдают каждому гостю. Табло «последний пришедший» врёт, как только гостей двое. А номерок у каждого свой и путешествует вместе с ним — куда бы гость ни отошёл и сколько бы ни ждал.';

// ─── Раздел 2. AsyncLocalStorage ───────────────────────────────────────────────────────────

export const ALS_API = [
  {
    k: '`als.run(value, fn, ...args)`',
    d: 'Выполняет `fn` с этим значением и возвращает её результат. Всё, что `fn` запланирует, — таймеры, `then`, `await` — увидит то же значение. После выхода из `run` значение прежнее.',
  },
  {
    k: '`als.getStore()`',
    d: 'Значение для текущего кода. Вне всякого `run` — `undefined` или `defaultValue`, если его передали в конструктор (с Node 24).',
  },
  {
    k: '`als.exit(fn)`',
    d: 'Выполняет `fn` так, будто значения нет. Это `run(undefined, fn)`.',
  },
  {
    k: '`als.enterWith(value)`',
    d: 'Задаёт значение **без** функции-рамки: до конца текущего синхронного кода и для всего, что он запланирует. Вернуть прежнее значение некому — об этом ниже.',
  },
];

export const ENTER_WITH_CODE = `const als = new AsyncLocalStorage();
const seen = {};
const emitter = new EventEmitter();
emitter.on('req', () => als.enterWith('чужой'));        // «удобно» — без колбэка
emitter.on('req', () => (seen.sibling = als.getStore()));

als.run('A', () => {
  emitter.emit('req');
  seen.afterEmit = als.getStore();
});
seen.afterRun = als.getStore() ?? '—';

async function middleware() {
  als.enterWith('из middleware');
}
als.run('B', () => {
  middleware();
  seen.caller = als.getStore();
});
return seen;`;

export const ENTER_WITH_SEEN = {
  sibling: 'чужой',
  afterEmit: 'чужой',
  afterRun: '—',
  caller: 'из middleware',
};

export const ENTER_WITH_ROWS = [
  { k: 'соседний слушатель того же события', v: '`чужой`', d: 'Слушатели `emit` вызываются подряд в одном синхронном коде, и значение первого достаётся всем следующим.', tone: 'err' as const },
  { k: 'код после `emit` внутри `run(\'A\')`', v: '`чужой`', d: 'Тот, кто вызвал `emit`, потерял своё `A` до конца своей функции — и всё, что он ещё запланирует, тоже уедет с `чужой`.', tone: 'err' as const },
  { k: 'после выхода из `run`', v: '`—`', d: 'Внешний `run` вернул то, что было до него. Рамка `run` — единственное, что ограничивает `enterWith`.', tone: 'ok' as const },
  { k: 'вызвавший `async`-функцию', v: '`из middleware`', d: 'Код `async`-функции до первого `await` выполняется синхронно в кадре вызывающего — и `enterWith` там меняет контекст вызывающему.', tone: 'err' as const },
];

export const ENTER_WITH_NOTE =
  '`enterWith` нужен там, где нет функции, в которую можно завернуть остаток работы: например, в хуке фреймворка, который вызывают «до» обработчика. Безопасная форма — по-прежнему `run`. В Node 24.20 появился `withScope(value)` для `using`: значение живёт до конца блока и возвращается само, даже при исключении. В 24.11 его ещё нет.';

// ─── Раздел 3. Момент снимка ───────────────────────────────────────────────────────────────

export const PLAIN_SNAPSHOT =
  'Как штамп с датой на заявлении. Его ставят, когда заявление **приняли**, а не когда его наконец рассмотрели. Кто был дежурным в день рассмотрения, на штамп не влияет.';

/** Исполняется тестом в обоих режимах Node 24. Результат — `CAPTURE_SEEN`. */
export const CAPTURE_CODE = `const als = new AsyncLocalStorage();
const seen = {};
const read = (key) => () => (seen[key] = als.getStore() ?? '—');

// промис создан в A, подписка в B, разрешён в C
let resolve;
const p = als.run('A', () => new Promise((r) => (resolve = r)));
als.run('B', () => p.then(read('then')));
als.run('B', async () => { await p; read('await')(); });
als.run('C', () => resolve());

als.run('A', () => setTimeout(read('setTimeout'), 1));
als.run('A', () => setImmediate(read('setImmediate')));
als.run('A', () => process.nextTick(read('nextTick')));
als.run('A', () => queueMicrotask(read('queueMicrotask')));

// событие: подписка в A, emit в B
const emitter = new EventEmitter();
als.run('A', () => {
  emitter.on('x', read('on'));
  emitter.on('x', AsyncResource.bind(read('AsyncResource.bind')));
  emitter.on('x', AsyncLocalStorage.bind(read('AsyncLocalStorage.bind')));
});
als.run('B', () => emitter.emit('x'));

const snapshot = als.run('A', () => AsyncLocalStorage.snapshot());
als.run('B', () => snapshot(read('snapshot')));

await new Promise((r) => setTimeout(r, 20));
return seen;`;

export const CAPTURE_SEEN: Record<string, string> = {
  then: 'B',
  await: 'B',
  setTimeout: 'A',
  setImmediate: 'A',
  nextTick: 'A',
  queueMicrotask: 'A',
  on: 'B',
  'AsyncResource.bind': 'A',
  'AsyncLocalStorage.bind': 'A',
  snapshot: 'A',
};

/** Пояснения к строкам таблицы. Ключи — те же, что в `CAPTURE_SEEN`. */
export const CAPTURE_ROWS: { key: string; when: string; d: string }[] = [
  { key: 'then', when: 'подписка', d: 'Не создание промиса (`A`) и не разрешение (`C`), а вызов `then`: реакция записывается в промис вместе со снимком.' },
  { key: 'await', when: 'подписка', d: 'То же, что `then`: `await` подписывает продолжение функции на промис в момент, когда до него дошло выполнение.' },
  { key: 'setTimeout', when: 'регистрация', d: 'Объект `Timeout` хранит снимок в поле `Symbol(kAsyncContextFrame)` с момента создания.' },
  { key: 'setImmediate', when: 'регистрация', d: 'Так же, как таймер.' },
  { key: 'nextTick', when: 'регистрация', d: 'Запись в очереди `nextTick` хранит снимок рядом с колбэком и аргументами.' },
  { key: 'queueMicrotask', when: 'регистрация', d: 'В Node это `AsyncResource`, созданный при вызове, — а он запоминает снимок в конструкторе.' },
  { key: 'on', when: '`emit`', d: 'Подписка ничего не запоминает: `emit` — обычный синхронный вызов слушателей, и они видят контекст того, кто вызвал `emit`.' },
  { key: 'AsyncResource.bind', when: 'обёртка', d: 'Обёртка запоминает снимок, когда её создали, и восстанавливает на время вызова.' },
  { key: 'AsyncLocalStorage.bind', when: 'обёртка', d: 'Тот же `AsyncResource.bind` — в исходнике Node это одна строка.' },
  { key: 'snapshot', when: 'снимок', d: '`snapshot()` возвращает функцию «выполни это в контексте A». Удобно, когда колбэков много, а снимок один.' },
];

export const CAPTURE_NOTE =
  'Правило одно: **контекст берётся в тот момент, когда колбэк кому-то отдали.** Всё, что движок или Node откладывают сами, — промисы, таймеры, `nextTick` — отдают снимок вместе с колбэком. `EventEmitter` ничего не откладывает: `emit` синхронно перебирает массив функций. Поэтому слушатель видит контекст того, кто вызвал `emit`, — а если событие пришло из сети, контекст того, кто открыл сокет, или пустой.';

export const EMITTER_NOTE =
  'Отсюда частая потеря контекста в Node: библиотека держит свой пул соединений и вызывает ваши колбэки из события своего сокета. Сокет открыли для первого запроса — и все следующие ответы «принадлежат» первому. Лечение — обернуть колбэк в `AsyncResource.bind` в момент, когда вы его отдаёте, или перевести библиотеку на промисы: `then` берёт снимок сам.';

// ─── Раздел 4. Как это устроено в Node ─────────────────────────────────────────────────────

export const PLAIN_FRAME =
  'Как вагон поезда, к которому цепляют вагоны. Новое значение не меняет вагон, а прицепляет новый состав: старые снимки ссылаются на старые составы, и им ничего не грозит. Таймеру и промису отдают ссылку на текущий состав — копировать ничего не нужно.';

export const FRAME_STEPS = [
  {
    k: 'кадр — это словарь',
    d: 'Значения всех `AsyncLocalStorage` процесса лежат в одном объекте `AsyncContextFrame`. По устройству это `Map` (во внутреннем коде Node — её защищённая копия `SafeMap`): ключ — экземпляр ALS, значение — то, что передали в `run`. Кадр никогда не меняют на месте: `run` создаёт новый, копию старого с одной заменой.',
  },
  {
    k: 'текущий кадр хранит V8',
    d: 'Ссылка на текущий кадр лежит в поле движка с длинным именем continuation-preserved embedder data. Его V8 сам кладёт в каждую реакцию промиса при `then` и `await` и сам восстанавливает перед её выполнением. Для промисов Node не делает ничего.',
  },
  {
    k: 'остальное — Node',
    d: 'Таймер, `setImmediate`, `nextTick`, `AsyncResource` запоминают кадр при создании и подставляют его на время колбэка. Это одна ссылка на объект, без обхода и копирования.',
  },
];

/** Исполняется тестом дважды: по умолчанию и с `--no-async-context-frame`. Вывод — `COST_RESULT`. */
export const COST_CODE = `const { AsyncLocalStorage } = require('node:async_hooks');
const proto = AsyncLocalStorage.prototype;
const legacy = typeof proto._propagate === 'function';  // есть только в старой реализации
let calls = 0;
if (legacy) {
  const original = proto._propagate;
  proto._propagate = function (...args) {
    calls++;
    return original.apply(this, args);
  };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function handler() {
  await sleep(1);
  await sleep(1);
}

const als = new AsyncLocalStorage();
(async () => {
  calls = 0;
  await als.run('r-1', handler);                      // запрос внутри run
  const inRun = calls;
  calls = 0;
  await handler();                                    // тот же код вне run
  const outside = calls;

  const als2 = new AsyncLocalStorage();               // второе хранилище, run не вызван
  calls = 0;
  await als.run('r-1', handler);
  const secondCreated = calls;
  calls = 0;
  await als.run('r-1', () => als2.run('u-7', handler));  // оба в деле
  const twoStores = calls;
  console.log(JSON.stringify({ legacy, inRun, outside, secondCreated, twoStores }));
})();`;

export const COST_RESULT = {
  frame: { legacy: false, inRun: 0, outside: 0, secondCreated: 0, twoStores: 0 },
  legacy: { legacy: true, inRun: 8, outside: 8, secondCreated: 16, twoStores: 16 },
};

/** Из чего состоят 8 вызовов: ресурсы одного `handler`, снятые `async_hooks.createHook`. */
export const COST_RESOURCES = { PROMISE: 6, Timeout: 2 };

export const COST_ROWS = [
  { k: 'запрос внутри `run`', frame: '0', legacy: '8', d: 'За время запроса родились шесть промисов и два таймера. На каждый — вызов хука `init`, который копирует значение хранилища в новый ресурс.' },
  { k: 'тот же код вне всякого `run`', frame: '0', legacy: '8', d: 'Хук не знает, нужен ли кому-то контекст: он срабатывает на каждый ресурс процесса, как только создан хотя бы один ALS.' },
  { k: 'создано второе хранилище, его `run` не вызывали', frame: '0', legacy: '16', d: 'Хук ставит уже конструктор. Хранилище, которое завела библиотека «на всякий случай», удваивает работу для всего процесса.' },
  { k: 'два хранилища в деле (`requestId` и `userId`)', frame: '0', legacy: '16', d: 'Каждое хранилище копирует себя в каждый ресурс отдельно. В новой реализации оба значения едут в одном кадре.' },
];

export const COST_NOTE =
  'Время не мерялось — считались вызовы. Старая реализация платит **на каждый асинхронный ресурс процесса**, даже там, где контекст никто не читает. Новая платит на `run` (копия маленькой `Map`) и ничего — на `await`: ссылку на кадр V8 переносит сам. Включается старая флагом `--no-async-context-frame`; в Node 24 новая стоит по умолчанию.';

export const FLAG_ROWS = [
  { k: 'Node 20', v: 'только `async_hooks`', d: 'Флага `--experimental-async-context-frame` нет.' },
  { k: 'Node 22', v: 'старая по умолчанию', d: 'Новая — по флагу `--experimental-async-context-frame` (по документации Node).' },
  { k: 'Node 24', v: 'новая по умолчанию', d: 'Старая — флагом `--no-async-context-frame`. Экспериментальный флаг 24.11 уже не принимает: `bad option`.' },
];

// ─── Раздел 5. Своими руками ───────────────────────────────────────────────────────────────

/** Учебная переменная контекста. Исполняется демо и тестом через `widgets/context-lab/model/run.ts`. */
export const MINI_CODE = `let frame = new Map();               // значения всех переменных контекста разом

class Variable {
  get() {
    return frame.get(this);
  }
  run(value, fn, ...args) {
    const prev = frame;
    frame = new Map(prev).set(this, value);  // копия: снимки, взятые раньше, не меняются
    try {
      return fn(...args);
    } finally {
      frame = prev;
    }
  }
}

function wrap(fn) {
  const saved = frame;               // снимок — сейчас, в момент регистрации
  return function (...args) {
    const prev = frame;
    frame = saved;                   // восстановление — потом, в момент вызова
    try {
      return fn.apply(this, args);
    } finally {
      frame = prev;
    }
  };
}

const native = {
  then: Promise.prototype.then,
  setTimeout: globalThis.setTimeout,
  queueMicrotask: globalThis.queueMicrotask,
};

function install() {
  Promise.prototype.then = function (onOk, onFail) {
    return native.then.call(
      this,
      typeof onOk === 'function' ? wrap(onOk) : onOk,
      typeof onFail === 'function' ? wrap(onFail) : onFail,
    );
  };
  globalThis.setTimeout = (fn, ms, ...args) =>
    native.setTimeout.call(globalThis, wrap(fn), ms, ...args);
  globalThis.queueMicrotask = (fn) =>
    native.queueMicrotask.call(globalThis, wrap(fn));
}

function uninstall() {
  Promise.prototype.then = native.then;
  globalThis.setTimeout = native.setTimeout;
  globalThis.queueMicrotask = native.queueMicrotask;
}`;

/** «Текущий запрос» одной переменной — то, с чего начинают все. */
export const GLOBAL_CODE = `let current;                         // одна ячейка на всех
const ctx = {
  run(value, fn) {
    current = value;
    return fn();
  },
  get: () => current,
};`;

/** Три `ctx` для одних и тех же сценариев. Тест собирает их из этих строк. */
export const ALS_CTX_CODE = `const als = new AsyncLocalStorage();
const ctx = { run: (v, fn) => als.run(v, fn), get: () => als.getStore() };`;

export const MINI_CTX_CODE = `const id = new Variable();
const ctx = { run: (v, fn) => id.run(v, fn), get: () => id.get() };
install();                           // подменить then, setTimeout, queueMicrotask`;

/** Объявлен перед каждым сценарием. `setTimeout` ищется в момент вызова — подменённый, если включён. */
export const SLEEP_CODE = 'const sleep = (ms) => new Promise((r) => setTimeout(r, ms));';

export const MINI_STEPS = [
  {
    k: '`frame` и `Variable`',
    d: 'Все переменные контекста живут в одной `Map`. `run` подменяет её копией с новым значением и возвращает прежнюю в `finally`, даже если `fn` бросила исключение.',
  },
  {
    k: '`wrap`: снимок и восстановление',
    d: 'Обёртку создают в момент регистрации, и она запоминает текущую `frame`. Когда колбэк наконец вызовут, обёртка поставит запомненную `frame` на время вызова и вернёт ту, что была.',
  },
  {
    k: '`install`: подменить вход',
    d: 'Чтобы снимок брался сам, обёртку вставляют туда, где колбэки отдают: в `then`, `setTimeout`, `queueMicrotask`. `catch` и `finally` подменять не надо: они вызывают `this.then`.',
  },
];

export const SCENARIOS: Scenario[] = [
  {
    id: 'parallel',
    label: 'три запроса',
    note: 'Три запроса с разной скоростью «базы». Глобальная переменная после старта всех трёх навсегда показывает `C` — последний записанный.',
    code: `function request(id, ms) {
  return ctx.run(id, () => {
    log(id, 'принят');
    return sleep(ms)
      .then(() => log(id, 'база ответила'))
      .then(() => sleep(ms))
      .then(() => log(id, 'ответ ушёл'));
  });
}
return Promise.all([
  request('A', 50),
  request('B', 10),
  request('C', 30),
]);`,
  },
  {
    id: 'nested',
    label: 'вложенный run',
    note: 'Синхронный код, без единого `await`. Глобальная переменная ломается и здесь: после вложенного вызова её никто не вернул.',
    code: `ctx.run('A', () => {
  log('A', 'начало');
  ctx.run('B', () => log('B', 'вложенный run'));
  log('A', 'после вложенного');
});`,
  },
  {
    id: 'all',
    label: 'Promise.all',
    note: '`A` ждёт две части, `B` — одну. Каждая часть видит свой запрос, и продолжение после `Promise.all` — тоже.',
    code: `const part = (id, ms) => sleep(ms).then(() => log(id, 'часть ' + ms + ' мс'));
return Promise.all([
  ctx.run('A', () => Promise.all([part('A', 10), part('A', 40)])
    .then(() => log('A', 'обе части'))),
  ctx.run('B', () => Promise.all([part('B', 20)])
    .then(() => log('B', 'одна часть'))),
]);`,
  },
  {
    id: 'timers',
    label: 'таймеры',
    note: 'Таймер и микрозадача поставлены внутри `run`, а выполняются, когда `run` давно закончился. Снимок взят при постановке.',
    code: `ctx.run('A', () => {
  setTimeout(() => log('A', 'setTimeout 20'), 20);
  queueMicrotask(() => log('A', 'queueMicrotask'));
});
ctx.run('B', () => {
  setTimeout(() => log('B', 'setTimeout 10'), 10);
  queueMicrotask(() => log('B', 'queueMicrotask'));
});
return sleep(40);`,
  },
  {
    id: 'registration',
    label: 'создан, подписан, разрешён',
    note: 'Промис создан в `A`, `then` вызван в `B`, разрешён в `C`. Колбэк видит `B`: снимок берёт подписка.',
    code: `let resolve;
const p = ctx.run('A', () => new Promise((r) => (resolve = r)));
const done = ctx.run('B', () => p.then(() => log('B', 'then')));
ctx.run('C', () => resolve());
return done;`,
  },
  {
    id: 'await',
    label: 'async/await',
    note: 'Здесь учебная обёртка проигрывает: после `await` у неё пусто. `await` подписывается на промис внутри движка и подменённый `then` не вызывает.',
    code: `async function request(id, ms) {
  log(id, 'до await');
  await sleep(ms);
  log(id, 'после await');
}
return Promise.all([
  ctx.run('A', () => request('A', 30)),
  ctx.run('B', () => request('B', 10)),
]);`,
  },
];

const L = (who: string, what: string, seen: string | null): LogEntry => ({ who, what, seen });

/**
 * Журналы шести сценариев в трёх реализациях — `LOGS[сценарий][режим]`. Сняты стендом
 * (Node 24.11, оба режима ALS дали одно и то же) и пересобираются тестом.
 * Демо показывает колонку ALS отсюда: в браузере `AsyncLocalStorage` нет.
 */
export const LOGS: Record<string, { global: LogEntry[]; als: LogEntry[]; mini: LogEntry[] }> = {
  parallel: {
    global: [L('A', 'принят', 'A'), L('B', 'принят', 'B'), L('C', 'принят', 'C'), L('B', 'база ответила', 'C'), L('B', 'ответ ушёл', 'C'), L('C', 'база ответила', 'C'), L('A', 'база ответила', 'C'), L('C', 'ответ ушёл', 'C'), L('A', 'ответ ушёл', 'C')],
    als: [L('A', 'принят', 'A'), L('B', 'принят', 'B'), L('C', 'принят', 'C'), L('B', 'база ответила', 'B'), L('B', 'ответ ушёл', 'B'), L('C', 'база ответила', 'C'), L('A', 'база ответила', 'A'), L('C', 'ответ ушёл', 'C'), L('A', 'ответ ушёл', 'A')],
    mini: [L('A', 'принят', 'A'), L('B', 'принят', 'B'), L('C', 'принят', 'C'), L('B', 'база ответила', 'B'), L('B', 'ответ ушёл', 'B'), L('C', 'база ответила', 'C'), L('A', 'база ответила', 'A'), L('C', 'ответ ушёл', 'C'), L('A', 'ответ ушёл', 'A')],
  },
  nested: {
    global: [L('A', 'начало', 'A'), L('B', 'вложенный run', 'B'), L('A', 'после вложенного', 'B')],
    als: [L('A', 'начало', 'A'), L('B', 'вложенный run', 'B'), L('A', 'после вложенного', 'A')],
    mini: [L('A', 'начало', 'A'), L('B', 'вложенный run', 'B'), L('A', 'после вложенного', 'A')],
  },
  all: {
    global: [L('A', 'часть 10 мс', 'B'), L('B', 'часть 20 мс', 'B'), L('B', 'одна часть', 'B'), L('A', 'часть 40 мс', 'B'), L('A', 'обе части', 'B')],
    als: [L('A', 'часть 10 мс', 'A'), L('B', 'часть 20 мс', 'B'), L('B', 'одна часть', 'B'), L('A', 'часть 40 мс', 'A'), L('A', 'обе части', 'A')],
    mini: [L('A', 'часть 10 мс', 'A'), L('B', 'часть 20 мс', 'B'), L('B', 'одна часть', 'B'), L('A', 'часть 40 мс', 'A'), L('A', 'обе части', 'A')],
  },
  timers: {
    global: [L('A', 'queueMicrotask', 'B'), L('B', 'queueMicrotask', 'B'), L('B', 'setTimeout 10', 'B'), L('A', 'setTimeout 20', 'B')],
    als: [L('A', 'queueMicrotask', 'A'), L('B', 'queueMicrotask', 'B'), L('B', 'setTimeout 10', 'B'), L('A', 'setTimeout 20', 'A')],
    mini: [L('A', 'queueMicrotask', 'A'), L('B', 'queueMicrotask', 'B'), L('B', 'setTimeout 10', 'B'), L('A', 'setTimeout 20', 'A')],
  },
  registration: {
    global: [L('B', 'then', 'C')],
    als: [L('B', 'then', 'B')],
    mini: [L('B', 'then', 'B')],
  },
  await: {
    global: [L('A', 'до await', 'A'), L('B', 'до await', 'B'), L('B', 'после await', 'B'), L('A', 'после await', 'B')],
    als: [L('A', 'до await', 'A'), L('B', 'до await', 'B'), L('B', 'после await', 'B'), L('A', 'после await', 'A')],
    mini: [L('A', 'до await', 'A'), L('B', 'до await', 'B'), L('B', 'после await', null), L('A', 'после await', null)],
  },
};

export const DEMO_CAPTION =
  'Каждая строка — один вызов `log` в том порядке, в каком он случился. Колонки исполняют один и тот же сценарий с разным `ctx`: глобальная переменная и учебная обёртка считаются прямо в браузере, колонка `AsyncLocalStorage` — журнал того же сценария в Node 24, потому что в браузере ALS нет.';

/** Сколько раз подменённый `then` вызывается изнутри движка. Снято тестом. */
export const THEN_CALLS = { await: 0, all2: 2, catch: 1, finally: 1 };

export const AWAIT_NOTE =
  'Почему так. `p.then(fn)` — вызов метода, который можно подменить. `await p` для настоящего промиса — операция движка: он подписывается на `p` напрямую, мимо `Promise.prototype.then`. Подменённый `then` при `await` вызывается **0** раз. А вот `Promise.all` из двух промисов зовёт `then` у каждого через свойство — **2** раза, поэтому его обёртка видит. Ровно эту стену встретил zone.js в Angular; родной `await` обходят тем, что сборщик переписывает его в генераторы.';

export const AWAIT_LIMIT_NOTE =
  'Это предел любой реализации поверх JavaScript. Чтобы контекст пережил `await`, снимок должен брать сам движок — в момент, когда он записывает реакцию промиса. В Node это и делает V8 по просьбе Node. В браузере такой просьбы нет: её и добавляет предложение `AsyncContext`.';

// ─── Раздел 6. Браузер и стандарт ──────────────────────────────────────────────────────────

/** Цитата из README `tc39/proposal-async-context` (Stage 2). Не запускалась: движков с ним нет. */
export const ASYNC_CONTEXT_CODE = `const requestId = new AsyncContext.Variable();

requestId.run('r-1', async () => {
  await fetch('/api');
  requestId.get();                    // 'r-1' — и после await
});

// снимок всех переменных разом — то же, что AsyncLocalStorage.snapshot()
const snapshot = new AsyncContext.Snapshot();
snapshot.run(() => requestId.get());

// обёртка — то же, что AsyncLocalStorage.bind()
const later = AsyncContext.Snapshot.wrap(() => requestId.get());`;

export const ALS_VS_PROPOSAL = [
  { als: '`new AsyncLocalStorage()`', ac: '`new AsyncContext.Variable()`', d: 'Одна «переменная» контекста.' },
  { als: '`als.run(v, fn)`, `als.getStore()`', ac: '`v.run(value, fn)`, `v.get()`', d: 'Задать на время функции, прочитать.' },
  { als: '`AsyncLocalStorage.snapshot()`', ac: '`new AsyncContext.Snapshot()`', d: 'Снимок всех переменных сразу.' },
  { als: '`AsyncLocalStorage.bind(fn)`', ac: '`AsyncContext.Snapshot.wrap(fn)`', d: 'Функция, которая всегда выполняется в снимке момента обёртки.' },
  { als: '`als.enterWith(v)`', ac: 'нет', d: 'В предложении задать значение можно только на время функции — опасной формы нет.' },
];

export const BROWSER_ROWS = [
  { k: 'Chromium 153', v: '`undefined`' },
  { k: 'Firefox 155', v: '`undefined`' },
  { k: 'WebKit 26.6', v: '`undefined`' },
  { k: 'Node 24.11', v: '`undefined` — есть только `AsyncLocalStorage`' },
];

export const PROPOSAL_FACTS = [
  {
    t: 'Stage 2 — черновик',
    d: 'Предложение в Stage 2 с 2023 года; последнее обсуждение в TC39 — май 2026, о том, как оно ляжет на API браузера. Сам язык — малая часть работы: нужно решить, какой контекст получает каждый колбэк платформы.',
    tone: 'warn' as const,
  },
  {
    t: 'События — по моменту вызова',
    d: 'В черновике правил для веба `addEventListener` снимок **не** берёт: синхронный `dispatchEvent` и `el.click()` передают контекст вызывающего — как `EventEmitter` в Node. Клик пользователя приходит с пустым контекстом. Снимок при подписке отвергли: он держит память, пока жив элемент.',
  },
  {
    t: 'Таймеры и промисы — по регистрации',
    d: '`setTimeout`, `then`, `await`, `queueMicrotask` — как в Node: снимок при постановке. Ответ `XMLHttpRequest` и `load` картинки получают контекст того, кто начал загрузку.',
  },
];

export const FRAMEWORK_ROWS = [
  { k: 'Angular на zone.js', how: 'Подменяет все функции, через которые ставят колбэк, — как учебная обёртка, только шире. Родной `await` проходит мимо, и Angular CLI переписывает `async` в генераторы.', link: '[Angular без zone.js](/frameworks/angular-zoneless/#s4)', tone: 'warn' as const },
  { k: 'React', how: 'Механизма нет. `startTransition(async () => …)` помечает переходом только код до первого `await`; документация React советует обернуть обновление после `await` ещё одним `startTransition`.', link: '[React: полосы и переходы](/frameworks/react-concurrent-internals/#s4)', tone: 'err' as const },
  { k: 'Vue `<script setup>`', how: 'Компилятор окружает каждый `await` верхнего уровня вызовом `withAsyncContext`: до `await` запоминает текущий компонент, после — возвращает. Работает только там, где есть компилятор.', link: '', tone: 'warn' as const },
  { k: 'OpenTelemetry в браузере', how: 'Веб-SDK по умолчанию держит активный спан только на время синхронного вызова. Чтобы спан пережил `then` и таймеры, подключают менеджер контекста на zone.js — с той же стеной на родном `await`.', link: '[Наблюдаемость, раздел «С фронта на бэк»](/delivery/observability/#s5)', tone: 'warn' as const },
];

/** `<script setup>`, который компилирует тест. */
export const VUE_SRC_CODE = `<script setup>
import { onMounted } from 'vue';
const user = await fetchUser();
onMounted(() => console.log(user));
</script>`;

/** Вывод `compileScript` (@vue/compiler-sfc 3.5.42) — фрагмент вокруг `await`. */
export const VUE_OUT_CODE = `const user = (
  ([__temp,__restore] = _withAsyncContext(() => fetchUser())),
  __temp = await __temp,
  __restore(),
  __temp
);
onMounted(() => console.log(user));`;

export const VUE_NOTE =
  '`onMounted` после `await` должен знать, какой компонент сейчас настраивается. Vue хранит это в глобальной переменной — ровно та ловушка, с которой начиналась тема, — и лечит её компилятором: `__restore()` ставит компонент обратно после `await`. В обычном `.js` без компилятора это не сработает.';

// ─── OpenTelemetry ─────────────────────────────────────────────────────────────────────────

/** Исполняется тестом. Результат — `OTEL_RESULT`. */
export const OTEL_CODE = `const KEY = createContextKey('request id');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const handler = async () => {
  await sleep(1);
  return context.active().getValue(KEY) ?? null;
};
const withId = ROOT_CONTEXT.setValue(KEY, 'r-1');

const noManager = {
  sync: context.with(withId, () => context.active().getValue(KEY) ?? null),
  afterAwait: await context.with(withId, handler),
};

class AlsContextManager {
  #als = new AsyncLocalStorage();
  active() { return this.#als.getStore() ?? ROOT_CONTEXT; }
  with(ctx, fn, thisArg, ...args) { return this.#als.run(ctx, () => fn.call(thisArg, ...args)); }
  bind(ctx, target) { return target; }
  enable() { return this; }
  disable() { this.#als.disable(); return this; }
}
context.setGlobalContextManager(new AlsContextManager());

const withAls = await context.with(withId, handler);
return { noManager, withAls };`;

export const OTEL_RESULT = { noManager: { sync: null, afterAwait: null }, withAls: 'r-1' };

export const OTEL_RESULT_TEXT = `Результат: \`${JSON.stringify(OTEL_RESULT)}\`.`;

export const OTEL_NOTE =
  'Пакет `@opentelemetry/api` сам контекст не хранит: без менеджера `context.with` ничего не делает, и `context.active()` пуст даже внутри синхронного колбэка. Для Node есть пакет `@opentelemetry/context-async-hooks` с менеджером `AsyncLocalStorageContextManager` — по сути это десять строк выше. Через границу процессов контекст едет уже не так, а заголовком `traceparent`.';

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'Глобальная переменная проходит тесты',
    d: 'С одним запросом за раз `requestId` в модульной переменной всегда верен. Ошибка видна только когда два запроса перекрываются по времени, то есть под нагрузкой — в проде. И она не падает, а молча подписывает логи чужим id.',
    tone: 'err',
  },
  {
    n: '02',
    t: 'Снимок берёт подписка, а не создание промиса',
    d: 'Промис, созданный в одном запросе и закешированный, а потом прочитанный через `await` в другом, отдаст продолжению контекст **второго** — того, кто ждёт. Обычно это и нужно. Но контекст создателя промиса до продолжения не доходит никогда: если он важен, его кладут в сам результат.',
    tone: 'warn',
  },
  {
    n: '03',
    t: '`EventEmitter` контекст не сохраняет',
    d: 'Слушатель видит контекст того, кто вызвал `emit`. Пул соединений, очередь, свой планировщик — всё, что вызывает ваши колбэки из своих событий, — теряет контекст. Лечится `AsyncResource.bind(fn)` в момент передачи колбэка.',
    tone: 'err',
  },
  {
    n: '04',
    t: '`enterWith` протекает наружу',
    d: 'В слушателе события — в соседние слушатели и в код после `emit`; в `async`-функции до первого `await` — в вызывающего. Рамку `run` ему никто не ставит. Где можно — `run`, в Node 24.20+ — `withScope` с `using`.',
    tone: 'err',
  },
  {
    n: '05',
    t: 'Старая реализация платит за всех',
    d: 'С `--no-async-context-frame` (и во всех Node до 24) хук срабатывает на каждый промис и таймер процесса, даже вне `run`, и умножается на число хранилищ. Если на сервере Node 20 и много `AsyncLocalStorage` от разных библиотек — это видно на профиле.',
    tone: 'warn',
  },
  {
    n: '06',
    t: 'Обёртка поверх `then` не видит `await`',
    d: 'Любая библиотека контекста в браузере, которая подменяет `Promise.prototype.then`, теряет значение после родного `await`. Проверка простая: прочитать контекст после `await` в `async`-функции. Если там пусто — код нужно собирать с понижением `async` или передавать значение явно.',
    tone: 'err',
  },
  {
    n: '07',
    t: 'Хранилище — объект, а не значение',
    d: '`run` защищает от **замены** значения: вложенный `run` не меняет внешний. Но если положить в хранилище объект и менять его поля, изменения увидят все, кто держит этот снимок, — в том числе уже запланированные колбэки.',
    tone: 'warn',
  },
];

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'Node.js — Asynchronous context tracking',
    href: 'https://nodejs.org/api/async_context.html',
    what: '`AsyncLocalStorage`: `run`, `enterWith`, `bind`, `snapshot`, `defaultValue`, `withScope`; `AsyncResource` и `EventEmitter`; раздел о потере контекста',
  },
  {
    title: 'Node.js — `--no-async-context-frame`',
    href: 'https://nodejs.org/api/cli.html#--no-async-context-frame',
    what: 'возврат к реализации на `async_hooks`; флаг с 24.0.0',
  },
  {
    title: 'Node.js — Async hooks',
    href: 'https://nodejs.org/api/async_hooks.html',
    what: '`createHook`, `init`, `before`, `after` — на них стояла старая реализация',
  },
  {
    title: 'TC39 — proposal-async-context',
    href: 'https://github.com/tc39/proposal-async-context',
    what: '`AsyncContext.Variable`, `Snapshot`, мотивация; Stage 2',
  },
  {
    title: 'proposal-async-context — WEB-INTEGRATION.md',
    href: 'https://github.com/tc39/proposal-async-context/blob/master/WEB-INTEGRATION.md',
    what: 'какой контекст получают таймеры, события, `XMLHttpRequest`; почему не снимок при `addEventListener`',
  },
  {
    title: 'proposal-async-context — FRAMEWORKS.md',
    href: 'https://github.com/tc39/proposal-async-context/blob/master/FRAMEWORKS.md',
    what: 'React, Vue, Solid, Svelte: где им не хватает контекста',
  },
  {
    title: 'OpenTelemetry JS — Context',
    href: 'https://opentelemetry.io/docs/languages/js/context/',
    what: 'менеджеры контекста, `context.with`, `AsyncLocalStorageContextManager`',
  },
];

export const RELATED =
  'Смежное на сайте: [Колбэки, раздел «Ошибки»](/js/callbacks/#s5) — почему колбэк теряет и стек, и контекст. [Ошибки и стеки, раздел «Асинхронный стек»](/js/errors/#s3) — какие кадры движок восстанавливает после `await`. [Цикл событий Node](/js/node-event-loop/#s3) — где выполняются `nextTick` и микрозадачи. [Angular без zone.js, раздел «async/await»](/frameworks/angular-zoneless/#s4) — та же стена у zone.js. [React: полосы и переходы](/frameworks/react-concurrent-internals/#s4) — переход после `await`. [Наблюдаемость](/delivery/observability/#s5) — как контекст трассы переходит между сервисами.';

/** Колонка ALS для демо: в браузере `AsyncLocalStorage` нет, журнал — из Node. */
export const ALS_LOGS: Record<string, LogEntry[]> = Object.fromEntries(
  Object.entries(LOGS).map(([id, logs]) => [id, logs.als]),
);
