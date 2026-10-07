import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { AsyncCase, ReportCase } from '@/widgets/error-lab/model/types';

/**
 * Данные темы «Ошибки и стеки: от throw до отчёта».
 *
 * Тема написана 2026-10-01. Уже разобранное в других темах здесь дано фразой со ссылкой:
 * стек вызовов и куда уходит бросок из колбэка — «Колбэки», разделы «Стек» и «Ошибки»
 * (`/js/callbacks/#s1`, `#s5`); когда именно срабатывает `unhandledrejection` и флаги
 * `--unhandled-rejections` — «Промис изнутри», раздел «Отказ» (`/js/promise-internals/#s5`);
 * перевод позиций стека через карту и то, что браузер `error.stack` не переводит, —
 * «Source maps изнутри» (`/tooling/source-maps/#s3`); форматы стека в трёх движках —
 * «Три движка», раздел «Язык» (`/render/browser-engines/#s2`); `finally` с `yield` —
 * «Генераторы», раздел «Ранний выход»; номер трассы в отчёте — «Наблюдаемость», раздел
 * «С фронта на бэк». Тема идёт глубже: что лежит в объекте ошибки, когда снимается и когда
 * печатается стек, CallSite API, асинхронные стеки V8, глобальные обработчики в браузере
 * и Node с чужим источником и кодами выхода, `finally` и `using`, сборка отчёта.
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * Node **24.11.0** (V8 13.6) — основной; Node 26.8.2 (V8 14.6) — для сравнения; Chromium
 * **153.0.8010.12** (Playwright 1.63, headless shell). Каталог стенда — `scratchpad/agent-errors/`,
 * порты 53001–53012. Без таймерных замеров: всё, что утверждает тема, — тексты стеков, порядок
 * событий, коды выхода.
 *
 *   — примеры `*_RUN` — файлы `.mjs`, исполненные `node <файл>` в отдельном процессе; вывод —
 *     stdout и stderr как есть. Нормализовано одно: абсолютный путь до каталога стенда заменён
 *     на `/app` (в стеке это `file:///app/…`);
 *   — асинхронные сценарии `ASYNC_CASES` — те же файлы в Node и в Chromium: страница со своего
 *     `node:http` на `localhost:53010` подключает файл модулем, `error.stack` уходит в консоль;
 *   — глобальные обработчики в браузере (`BROWSER_ROWS`) — два `node:http`: страница на
 *     `localhost:53011`, «чужой» скрипт на `127.0.0.1:53012` (другой источник: другой хост);
 *     с `crossorigin` и без, с заголовком `Access-Control-Allow-Origin` и без;
 *   — Node 26.8.2 даёт те же пользовательские кадры и счёт кадров, у внутренних кадров Node
 *     (`node:internal/…`) другие номера строк и имена. Поэтому в примерах печатаются в основном
 *     пользовательские кадры, а тест сверяет внутренние кадры без номеров строк.
 *
 * Найдено стендом и вынесено в тему:
 *   — заголовок стека (`Error: текст`) Node строит при **первом чтении** `stack` из текущих
 *     `name` и `message`; Chromium берёт текущее `name`, но `message` — тот, что был при
 *     создании (`LAZY_RUN`, `LAZY_CHROMIUM`);
 *   — `Error.prepareStackTrace` в Node 24 — функция самого Node, в Chromium — `undefined`;
 *     вызывается один раз, при первом чтении `stack`;
 *   — `window.onerror` получает строку и колонку места **создания** ошибки, а не `throw`;
 *   — отказ промиса в скрипте с чужого источника без `crossorigin` не даёт события
 *     `unhandledrejection` вовсе, а исключение — даёт, но в виде «Script error.»;
 *   — `structuredClone` ошибки сохраняет `message`, `stack`, `cause` и класс встроенных
 *     ошибок, но теряет `errors` у `AggregateError`, свои поля (`code`) и подкласс — в Node 24.11
 *     и Chromium 153 одинаково;
 *   — `cause`, присвоенный после создания (`a.cause = b`), перечисляемый: с циклом
 *     `JSON.stringify` бросает `TypeError`.
 *
 * Только по документации, без запуска: что DevTools при открытой панели записывают
 * асинхронный стек при постановке задачи (`ASYNC_DEVTOOLS_NOTE`), и устройство «нулевой цены»
 * асинхронных стеков в V8 (по статье V8 «Faster async functions and promises» и по самим
 * стекам: какие кадры видны, снято, а как V8 их находит — из статьи).
 *
 * Всё перечисленное повторяет `tests/unit/errors.test.ts`: примеры исполняются этими же
 * строками в отдельном процессе Node, браузерная часть — в Chromium через Playwright, разбор
 * стека сверяется с CallSite API, сборка отчёта — со `structuredClone`.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'кадр стека',
    d: 'Одна строка вида `at saveOrder (file:///app/order.mjs:8:3)`: функция, которая была в работе, файл, строка и колонка. Стек — список таких кадров, от места ошибки к самому первому вызову.',
  },
  {
    k: 'V8',
    d: 'Движок JavaScript в Chrome, Edge и Node. Формат `error.stack` с `at …`, `Error.captureStackTrace` и асинхронные кадры — его изобретения; другие движки пишут стек иначе.',
  },
  {
    k: 'отказ промиса',
    d: 'Промис завершился ошибкой: `reject(…)` или `throw` внутри `async`-функции. Значение, с которым он отклонён, — причина отказа (reason). Это не исключение: пока у промиса нет обработчика, никто его не ловит.',
  },
  {
    k: 'источник (origin)',
    d: 'Схема, хост и порт адреса: `http://localhost:53011` и `http://127.0.0.1:53012` — разные источники. Браузер не отдаёт странице подробности о том, что пришло с чужого источника без разрешения.',
  },
  {
    k: 'сериализация',
    d: 'Перевод объекта в строку или байты, чтобы отправить по сети или сохранить: `JSON.stringify`, `structuredClone`, `postMessage`. Каждый способ решает сам, какие поля взять, — и у ошибки берёт разное.',
  },
  {
    k: 'код выхода',
    d: 'Число, с которым завершился процесс: `0` — всё хорошо, остальное — сбой. По нему оболочка, Docker и менеджер процессов понимают, что программа упала. В оболочке его показывает `echo $?`.',
  },
];

export const PLAIN_ERROR =
  'Ошибка похожа на акт о происшествии. Вид происшествия — `name`, что случилось — `message`, маршрут, по которому шли до места, — `stack`. А `cause` — ссылка на предыдущий акт: «упало, потому что раньше упало вот это». Если вместо акта бросить записку «что-то сломалось» — строку, — маршрута в ней не будет.';

export const PREREQ_NOTE =
  'Тема опирается на четыре вещи, каждая разобрана отдельно. Здесь — только то, что нужно, чтобы понимать стеки и отчёты.';

export const PREREQ: { t: string; d: string; href: string; hrefLabel: string; tone: 'info' }[] = [
  {
    t: 'Стек вызовов',
    d: 'Стопка функций, которые сейчас выполняются: каждая вызвала следующую и ждёт её возврата. Колбэк из `setTimeout` вызывается позже, под пустым стеком: того, кто его поставил, на стеке уже нет.',
    href: '/js/callbacks/#s1',
    hrefLabel: '«Колбэки», раздел «Стек»',
    tone: 'info',
  },
  {
    t: 'Отказ промиса и `unhandledrejection`',
    d: 'Отклонённый промис ждёт обработчика. Если его нет, когда закончились микрозадачи, браузер шлёт событие `unhandledrejection`, а Node по умолчанию завершает процесс.',
    href: '/js/promise-internals/#s5',
    hrefLabel: '«Промис изнутри», раздел «Отказ»',
    tone: 'info',
  },
  {
    t: '`await` — пауза функции на промисе',
    d: '`async`-функция на `await` останавливается и возвращает управление. Продолжит её реакция промиса — уже в другой микрозадаче, с другим стеком под ней.',
    href: '/js/generators/#s2',
    hrefLabel: '«Генераторы», раздел «async/await из генератора»',
    tone: 'info',
  },
  {
    t: 'Позиции стека в бандле',
    d: 'Строка и колонка в стеке — это место в том файле, который исполнял движок. После сборки это бандл, и до исходника позицию доводит карта исходников.',
    href: '/tooling/source-maps/#s3',
    hrefLabel: '«Source maps изнутри», раздел «От стека к исходнику»',
    tone: 'info',
  },
];

// ─── Примеры: файл, код и то, что напечатал Node ───────────────────────────────────────────

/** Пример, исполненный `node <file>` на стенде. `out` — то, что напечатал терминал. */
export interface NodeRun {
  file: string;
  code: string;
  out: string;
  /** Код выхода процесса; по умолчанию 0. */
  exit?: number;
}

// ─── Раздел 1. Объект ошибки ───────────────────────────────────────────────────────────────

export const ANATOMY_RUN: NodeRun = {
  file: 'anatomy.mjs',
  code: `const db = new Error('connect ETIMEDOUT 10.0.0.5:5432');
db.code = 'ETIMEDOUT';
const err = new Error('Заказ не сохранён', { cause: db });

console.log(err.name, Object.hasOwn(err, 'name'));
console.log(Object.getOwnPropertyNames(err));
console.log(Object.keys(err), Object.keys(db));
console.log(JSON.stringify(err), JSON.stringify(db));
console.log(err.cause === db, err.stack.split('\\n')[0]);`,
  out: `$ node anatomy.mjs
Error false
[ 'stack', 'message', 'cause' ]
[] [ 'code' ]
{} {"code":"ETIMEDOUT"}
true Error: Заказ не сохранён`,
};

export const ANATOMY_ROWS = {
  head: ['свойство', 'где лежит', 'в `JSON.stringify`', 'что важно'],
  rows: [
    ['`name`', 'прототип', 'нет', 'Своего `name` у ошибки нет: `Error`, `TypeError` берутся из прототипа класса. Подкласс обычно пишет `this.name = …` в конструкторе — тогда поле своё и перечисляемое.'],
    ['`message`', 'сама ошибка', 'нет', 'Своё, но неперечисляемое. Появляется, только если текст передан: у `new Error()` его нет вовсе.'],
    ['`stack`', 'сама ошибка', 'нет', 'Стандарт его не описывает. В V8 (Node 24, Chromium 153) это свой неперечисляемый геттер: строка собирается при первом чтении.'],
    ['`cause`', 'сама ошибка', 'нет', 'ES2022. Создаётся, только если в опциях есть ключ `cause`: `{}` его не даёт, `{ cause: undefined }` — даёт.'],
    ['`errors`', '`AggregateError`', 'нет', 'Массив причин: так отклоняется `Promise.any`, когда отказали все.'],
    ['свои поля: `code`, `status`', 'сама ошибка', '**да**', 'Обычные свойства, записанные присваиванием. Только они и попадают в `JSON.stringify`.'],
  ],
};

export const ANATOMY_NOTE =
  'Отсюда главный сюрприз отчётов: `JSON.stringify(err)` даёт `{}`. Текст, стек и причина у ошибки есть, но все три неперечисляемые, а `JSON.stringify` берёт только перечисляемые свои поля. Консоль Node и DevTools их показывают — у них свой обход, — поэтому в отладке всё выглядит на месте, а на сервер уходит пустой объект.';

export const CLASS_RUN: NodeRun = {
  file: 'class.mjs',
  code: `class HttpError extends Error {
  constructor(status, options) {
    super(\`HTTP \${status}\`, options);
    this.name = 'HttpError';
    this.status = status;
  }
}
function load() {
  throw new HttpError(502);
}
try {
  load();
} catch (e) {
  console.log(e.stack.split('\\n').slice(0, 2).join('\\n'));
  console.log(e instanceof HttpError, JSON.stringify(e));
}`,
  out: `$ node class.mjs
HttpError: HTTP 502
    at load (file:///app/class.mjs:9:9)
true {"name":"HttpError","status":502}`,
};

export const CLASS_NOTE =
  'Два наблюдения. Кадра конструктора `HttpError` в стеке нет: V8 начинает стек с того, кто вызвал `new`, — служебная обвязка класса читателю стека не нужна. И `name`, записанный в конструкторе, уже попадает в заголовок стека: заголовок строится позже, чем отработал конструктор. Опции `options` передаются в `super` — так у подкласса работает `cause`.';

export const THROWN_RUN: NodeRun = {
  file: 'thrown.mjs',
  code: `try {
  throw 'нет денег';
} catch (e) {
  console.log(typeof e, e instanceof Error, e.stack);
}
const fake = { name: 'Error', message: 'похож на ошибку' };
console.log(fake instanceof Error, Error.isError(fake));
console.log(Error.isError(new TypeError('настоящая')));`,
  out: `$ node thrown.mjs
string false undefined
false false
true`,
};

export const THROWN_NOTE =
  '`throw` принимает что угодно: строку, число, объект, `undefined`. Стек снимает только конструктор ошибки, поэтому у брошенной строки его нет — ни кадров, ни места. Код, который ловит, должен быть готов к любому значению: `e.message` у строки — `undefined`, а у `null` — `TypeError` прямо в обработчике. `Error.isError` (Node 24, Chromium 153) отличает настоящую ошибку от похожего объекта и, в отличие от `instanceof`, работает для ошибок из другого окна или `iframe`.';

export const THROW_STRING_RUN: NodeRun = {
  file: 'throw-string.mjs',
  code: `throw 'нет денег';`,
  out: `$ node throw-string.mjs

node:internal/modules/run_main:107
    triggerUncaughtException(
    ^
нет денег
(Use \`node --trace-uncaught ...\` to show where the exception was thrown)

Node.js v24.11.0`,
  exit: 1,
};

// ─── Раздел 2. Когда записывается стек ─────────────────────────────────────────────────────

export const PLAIN_SNAPSHOT =
  'Стек — фотография, а не видеозапись. Её делают в момент `new Error`: кто кого вызвал прямо сейчас. Что потом происходит с ошибкой — куда её передали, где бросили, где поймали, — на снимок уже не попадает. Как фото на паспорт: сделано в одном городе, а предъявлено может быть в любом.';

export const WHERE_RUN: NodeRun = {
  file: 'where.mjs',
  code: `function makeError() {
  return new Error('создана здесь');
}
function fail(err) {
  throw err;
}
try {
  fail(makeError());
} catch (e) {
  console.log(e.stack.split('\\n').slice(0, 3).join('\\n'));
}`,
  out: `$ node where.mjs
Error: создана здесь
    at makeError (file:///app/where.mjs:2:10)
    at file:///app/where.mjs:8:8`,
};

export const WHERE_NOTE =
  'Кадра `fail` в стеке нет, хотя бросила именно она. Колонка `2:10` — это `new`, а не `return`. Повторный `throw` того же объекта в `catch` стек не меняет, и это хорошо: при пробросе наверх место происшествия не теряется. Но и обратное верно — ошибку, заготовленную заранее (`const TIMEOUT = new Error(…)` на уровне модуля), стек всегда привяжет к загрузке модуля.';

export const LAZY_RUN: NodeRun = {
  file: 'lazy.mjs',
  code: `const err = new Error('черновик');
err.message = 'Заказ 42 не сохранён';   // stack ещё не читали
console.log(err.stack.split('\\n')[0]);
err.message = 'поздно';                  // а теперь уже прочитан
console.log(err.stack.split('\\n')[0]);`,
  out: `$ node lazy.mjs
Error: Заказ 42 не сохранён
Error: Заказ 42 не сохранён`,
};

/** Тот же код в Chromium 153 — первая строка стека. Снято стендом, повторяет тест. */
export const LAZY_CHROMIUM = ['Error: черновик', 'Error: черновик'];

export const LAZY_NOTE =
  'Кадры V8 снимает в `new Error`, а **строку** `stack` собирает позже, при первом чтении, — и дальше хранит готовой. В Node заголовок берётся из `name` и `message` на момент этого чтения, поэтому первая правка видна, а вторая — нет. Chromium тот же код печатает как `Error: черновик` оба раза: текущее `name` он берёт, а `message` — тот, что был при создании. Вывод один на оба движка: не правьте `message` после создания, оберните ошибку в новую с `cause`.';

export const CAPTURE_RUN: NodeRun = {
  file: 'capture.mjs',
  code: `function assert(ok, message) {
  if (ok) return;
  const err = new Error(message);
  console.log(err.stack.split('\\n')[1]);
  Error.captureStackTrace(err, assert);   // всё от assert и выше — прочь
  throw err;
}
function pay(sum) {
  assert(sum > 0, 'сумма должна быть больше нуля');
}
try {
  pay(-5);
} catch (e) {
  console.log(e.stack.split('\\n').slice(0, 3).join('\\n'));
}`,
  out: `$ node capture.mjs
    at assert (file:///app/capture.mjs:3:15)
Error: сумма должна быть больше нуля
    at pay (file:///app/capture.mjs:9:3)
    at file:///app/capture.mjs:12:3`,
};

export const CAPTURE_NOTE =
  '`Error.captureStackTrace(obj, fn)` снимает стек заново — прямо сейчас — и кладёт его в `obj.stack`. Второй аргумент отрезает кадры: всё от `fn` и выше по стеку не попадёт. Так библиотеки проверок прячут себя, и первым кадром становится строка, где проверку нарушили, — `pay`, а не `assert`. Объектом может быть что угодно, не только ошибка: `Error.captureStackTrace({})` даёт обычному объекту `stack`. Это API V8: в Node и Chromium оно есть всегда, в других движках на него полагаться нельзя.';

export const LIMIT_RUN: NodeRun = {
  file: 'limit.mjs',
  code: `function dive(n) {
  return n === 0 ? new Error('дно') : dive(n - 1);
}
const frames = (e) => e.stack.split('\\n').length - 1;

console.log(Error.stackTraceLimit, frames(dive(20)));
const early = dive(20);
Error.stackTraceLimit = Infinity;
console.log(frames(early), frames(dive(20)));
Error.stackTraceLimit = 0;
console.log(JSON.stringify(dive(20).stack));`,
  out: `$ node limit.mjs
10 10
10 25
"Error: дно"`,
};

export const LIMIT_NOTE =
  'По умолчанию V8 хранит **10** кадров — и в Node, и в Chromium. Из 25 настоящих кадров (21 вызов `dive`, верхний уровень модуля и три кадра загрузчика Node) в стек попали первые 10: самый глубокий конец, где ошибка родилась, а не начало, откуда всё пошло. Предел читается в момент создания: `early` создана при 10, и `Infinity` после этого её не удлиняет. `0` оставляет один заголовок. Поднять предел можно и флагом: `node --stack-trace-limit=50`.';

export const PREPARE_RUN: NodeRun = {
  file: 'prepare.mjs',
  code: `Error.prepareStackTrace = (err, callSites) =>
  callSites.map((s) => ({
    fn: s.getFunctionName(),
    line: s.getLineNumber(),
    col: s.getColumnNumber(),
    async: s.isAsync(),
  }));

async function query() {
  await null;
  throw new Error('таймаут');
}
async function save() {
  await query();
}
save().catch((e) => {
  console.log(Array.isArray(e.stack));
  for (const f of e.stack) console.log(f);
});`,
  out: `$ node prepare.mjs
true
{ fn: 'query', line: 11, col: 9, async: false }
{ fn: 'save', line: 14, col: 3, async: true }`,
};

export const PREPARE_FACTS = [
  {
    t: 'Кадры — объекты, а не строки',
    d: '`Error.prepareStackTrace(err, callSites)` получает кадры объектами CallSite: `getFunctionName()`, `getFileName()`, `getLineNumber()`, `getColumnNumber()`, `isAsync()`, `isConstructor()`, `getPromiseIndex()`. То, что функция вернёт, и станет `err.stack` — хоть массив, как в примере.',
  },
  {
    t: 'Зовётся один раз — при первом чтении',
    d: 'Не в `new Error`, а когда кто-то впервые прочёл `stack`. Ошибку, у которой `stack` так и не прочли, V8 не форматирует вовсе. Повторное чтение отдаёт сохранённое значение: два чтения — один вызов.',
  },
  {
    t: 'Хук глобальный',
    d: 'В Node 24 `Error.prepareStackTrace` по умолчанию — функция самого Node, в Chromium 153 — `undefined`. Подменив её, вы меняете `stack` всех ошибок процесса, включая чужие: код, который ждёт строку и делает `stack.split`, упадёт на массиве. Безопаснее подменять на время и возвращать прежнюю.',
    tone: 'warn' as const,
  },
];

// ─── Раздел 3. Асинхронные стеки ───────────────────────────────────────────────────────────

export const PLAIN_ASYNC =
  'Представьте очередь у окошка, где каждый стоит за кем-то с запиской «я жду вот его». Когда окошко отказывает первому, по запискам можно пройти назад и узнать, кто ещё ждал этот ответ. `await` и есть такая записка. А `setTimeout` — человек, который ушёл и попросил позвонить: записки нет, и по цепочке назад к нему не пройти.';

const TICK = `const tick = () => new Promise((r) => setTimeout(r, 0));
`;

export const ASYNC_CASES: AsyncCase[] = [
  {
    id: 'await',
    label: 'await',
    file: 'await.mjs',
    code: `${TICK}
async function query() {
  await tick();
  throw new Error('таймаут базы');
}
async function saveOrder() {
  await query();
}
async function checkout() {
  await saveOrder();
}
checkout().catch((e) => console.log(e.stack));`,
    node: `Error: таймаут базы
    at query (file:///app/await.mjs:5:9)
    at async saveOrder (file:///app/await.mjs:8:3)
    at async checkout (file:///app/await.mjs:11:3)`,
    chromium: `Error: таймаут базы
    at query (http://localhost:53010/await.mjs:5:9)
    at async saveOrder (http://localhost:53010/await.mjs:8:3)
    at async checkout (http://localhost:53010/await.mjs:11:3)`,
    note: 'Ошибка родилась после `await`, под пустым стеком, — настоящий кадр один, `query`. Остальные два V8 восстановил по цепочке `await`: `saveOrder` ждёт промис `query`, `checkout` — промис `saveOrder`. Позиции у таких кадров — место `await`, на котором функция стоит.',
  },
  {
    id: 'sync',
    label: 'до первого await',
    file: 'sync.mjs',
    code: `${TICK}
async function query(id) {
  if (!id) throw new Error('нет id заказа');
  await tick();
}
async function saveOrder(id) {
  await query(id);
}
async function checkout() {
  await saveOrder(null);
}
checkout().catch((e) => console.log(e.stack));`,
    node: `Error: нет id заказа
    at query (file:///app/sync.mjs:4:18)
    at saveOrder (file:///app/sync.mjs:8:9)
    at checkout (file:///app/sync.mjs:11:9)
    at file:///app/sync.mjs:13:1
    at ModuleJob.run (node:internal/modules/esm/module_job:377:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:691:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:101:5)`,
    chromium: `Error: нет id заказа
    at query (http://localhost:53010/sync.mjs:4:18)
    at saveOrder (http://localhost:53010/sync.mjs:8:9)
    at checkout (http://localhost:53010/sync.mjs:11:9)
    at http://localhost:53010/sync.mjs:13:1`,
    note: 'До первого `await` `async`-функция исполняется синхронно, прямо внутри вызова. Все три функции ещё на настоящем стеке — кадры обычные, без `async`, и есть даже верхний уровень модуля. В Node ниже видны и кадры его загрузчика.',
  },
  {
    id: 'then',
    label: '.then',
    file: 'then.mjs',
    code: `${TICK}
function query() {
  return tick().then(() => {
    throw new Error('таймаут базы');
  });
}
function saveOrder() {
  return query().then((row) => row.id);
}
async function checkout() {
  await saveOrder();
}
checkout().catch((e) => console.log(e.stack));`,
    node: `Error: таймаут базы
    at file:///app/then.mjs:5:11
    at async checkout (file:///app/then.mjs:12:3)`,
    chromium: `Error: таймаут базы
    at http://localhost:53010/then.mjs:5:11
    at async checkout (http://localhost:53010/then.mjs:12:3)`,
    note: '`query` и `saveOrder` пропали. Они не `async`: вернули промис и закончились задолго до ошибки, и ничто в цепочке промисов не помнит, кто вызвал `.then`. Кадр колбэка — без имени. А `checkout` на месте: она `await`-ит промис, и по этой записке V8 до неё дошёл.',
  },
  {
    id: 'timer',
    label: 'setTimeout',
    file: 'timer.mjs',
    code: `function query() {
  return new Promise((resolve, reject) => {
    setTimeout(() => reject(new Error('таймаут базы')), 0);
  });
}
async function saveOrder() {
  await query();
}
async function checkout() {
  await saveOrder();
}
checkout().catch((e) => console.log(e.stack));`,
    node: `Error: таймаут базы
    at Timeout._onTimeout (file:///app/timer.mjs:3:29)
    at listOnTimeout (node:internal/timers:608:17)
    at process.processTimers (node:internal/timers:543:7)`,
    chromium: `Error: таймаут базы
    at http://localhost:53010/timer.mjs:3:29`,
    note: 'Ошибка создана в колбэке таймера — обычной задаче, а не продолжении `async`-функции. Восстанавливать цепочку не от чего: `saveOrder` и `checkout` ждут, но ошибка ещё не связана ни с одним промисом, когда V8 снимает стек. В Node под колбэком видна только его же машинерия таймеров.',
  },
  {
    id: 'all',
    label: 'Promise.all',
    file: 'all.mjs',
    code: `${TICK}
async function reserve() {
  await tick();
}
async function charge() {
  await tick();
  throw new Error('карта отклонена');
}
async function checkout() {
  await Promise.all([reserve(), charge()]);
}
checkout().catch((e) => console.log(e.stack));`,
    node: `Error: карта отклонена
    at charge (file:///app/all.mjs:8:9)
    at async Promise.all (index 1)
    at async checkout (file:///app/all.mjs:11:3)`,
    chromium: `Error: карта отклонена
    at charge (http://localhost:53010/all.mjs:8:9)
    at async Promise.all (index 1)
    at async checkout (http://localhost:53010/all.mjs:11:3)`,
    note: '`Promise.all` V8 тоже умеет проходить: кадр `async Promise.all (index 1)` говорит, что упал второй промис из массива. То же для `Promise.any` и `Promise.allSettled`.',
  },
];

export const ASYNC_CAPTION =
  'Стеки напечатали Node 24.11 и Chromium 153, исполнив эти же файлы. Кадры разбирает `parseStack` из раздела «Отчёт об ошибке», строки кода, на которые они указывают, подсвечены. Функции из кода, которых в стеке нет, перечислены отдельно.';

export const ASYNC_HOW =
  'Как V8 это делает. В момент `await` движок ничего не записывает — отсюда название «асинхронные стеки нулевой цены» (zero-cost async stack traces). Работа откладывается до `new Error`: сняв настоящий стек, V8 смотрит, не продолжение ли `async`-функции сейчас выполняется. Если да — берёт её промис, ищет среди его подписчиков другую `async`-функцию, которая этот промис `await`-ит, пишет её кадром `at async …` и повторяет. Ходит он только по таким связям; обычные функции, вызвавшие `.then`, в промисе не записаны.';

export const ASYNC_ROWS = {
  head: ['как связаны функции', 'что видно в стеке'],
  rows: [
    ['ошибка до первого `await`', 'все вызывающие, обычными кадрами — как у синхронного кода'],
    ['цепочка `await`', 'место ошибки и каждая ждущая `async`-функция с пометкой `async`'],
    ['`Promise.all`, `any`, `allSettled`', 'кадр `async Promise.all (index N)` и `async`-функции выше'],
    ['`.then` в обычной функции', 'колбэк без имени; вызвавшие `.then` пропадают, ближайшая `async`-функция с `await` выше — видна'],
    ['колбэк таймера, события, `postMessage`', 'только сам колбэк и то, что под ним: кто его поставил, не видно'],
  ],
  tones: [undefined, 'ok', 'ok', 'warn', 'err'] as ('ok' | 'warn' | 'err' | undefined)[],
};

export const ASYNC_DEVTOOLS_NOTE =
  'DevTools в Chromium при открытой панели показывают в отладчике и полный «асинхронный стек» — с теми, кто ставил таймер или вешал `.then`. Это другая машина: панель записывает стек в момент постановки каждой задачи, и платит за это временем (по документации Chrome DevTools). В `error.stack`, который уйдёт в отчёт, этих кадров нет — там только то, что видно выше.';

export const ASYNC_PRACTICE =
  'Практический вывод для своего кода: цепочки `.then` в обычных функциях и колбэки таймеров — дыры в асинхронном стеке. Писать `await` в `async`-функциях выгодно не только ради читаемости: каждая такая функция остаётся в стеке. Где разрыв неизбежен — таймер, событие, очередь, — контекст несут сами: оборачивают ошибку с `cause` и понятным текстом, а в Node передают идентификатор запроса через `AsyncLocalStorage`.';

// ─── Раздел 4. Необработанные ошибки ───────────────────────────────────────────────────────

export const GLOBAL_CODE = `window.onerror = (message, source, lineno, colno, error) => {
  send({ message, source, lineno, colno, error });
};
window.addEventListener('unhandledrejection', (event) => {
  send({ reason: event.reason });
});
// Ошибки загрузки картинок и скриптов не всплывают:
// поймать их можно только на фазе перехвата.
window.addEventListener('error', (event) => {
  if (!(event instanceof ErrorEvent)) send({ failed: event.target.src });
}, true);`;

export const GLOBAL_FACTS = [
  {
    t: '`onerror` или слушатель `error`',
    d: 'Одно и то же событие `ErrorEvent`: `onerror` получает его поля пятью аргументами, слушатель — объектом (`event.message`, `event.error`). У `onerror` одна функция на окно, слушателей — сколько угодно.',
  },
  {
    t: 'Строка и колонка — место создания',
    d: 'В Chromium ошибка, созданная в строке 2 и брошенная в строке 4, пришла в `onerror` с `lineno` 2 и `colno` 14 — местом `new Error`. Для `TypeError` от `null.x` это место обращения: там ошибку и создал движок.',
  },
  {
    t: '`reportError(err)`',
    d: 'Сообщает об ошибке так, будто её не поймали: то же событие `error`, та же строка в консоли, — но выполнение продолжается. Удобно в обработчике, который не должен падать сам, но промолчать тоже не должен.',
  },
  {
    t: '`console.error` — не событие',
    d: 'Ни `onerror`, ни слушатель `error` его не видят. Ошибка, которую поймали и только напечатали, в отчёт сама не попадёт.',
    tone: 'warn' as const,
  },
];

export const BROWSER_ROWS = {
  head: ['что случилось', '`message`', 'место и `error`', '`unhandledrejection`'],
  rows: [
    ['исключение в скрипте своего источника', '`Uncaught Error: …` — текст как есть', '`…/boom.js`, 1:25, объект ошибки со стеком', '—'],
    ['исключение в скрипте с чужого источника, **без** `crossorigin`', '**`Script error.`**', 'пустой адрес, 0:0, `error: null`', '—'],
    ['то же, колбэк `setTimeout` из чужого скрипта', '**`Script error.`**', 'пустой адрес, 0:0, `error: null`', '—'],
    ['`crossorigin="anonymous"` и ответ с `Access-Control-Allow-Origin`', '`Uncaught Error: …`', 'адрес, 1:25, объект ошибки', '—'],
    ['`crossorigin`, но сервер **без** заголовка', 'скрипт не исполнен', 'событие `error` у элемента `<script>`, не у окна', '—'],
    ['отказ промиса в чужом скрипте без `crossorigin`', '—', '—', '**события нет**'],
    ['отказ промиса в чужом скрипте с `crossorigin`', '—', '—', 'есть, `reason` со стеком'],
    ['`throw \'строка\'`', '`Uncaught строка`', 'адрес, строка и колонка; `error` — сама строка', '—'],
    ['картинка ответила 404', 'нет `ErrorEvent`', 'обычное `Event` у `<img>`, только на перехвате', '—'],
  ],
  tones: [undefined, 'err', 'err', 'ok', 'warn', 'err', 'ok', 'warn', undefined] as ('ok' | 'warn' | 'err' | undefined)[],
};

export const PLAIN_MUTED =
  'Как телефонный звонок с чужого номера через коммутатор: вы слышите, что звонили, но не слышите, кто и что сказал. Браузер не даёт странице прочитать данные с чужого источника — и текст ошибки тоже данные: в нём бывают куски ответа сервера, имена, токены. Поэтому страница узнаёт только «что-то упало».';

export const MUTED_NOTE =
  'Скрипт с чужого источника браузер помечает как «заглушённый» (muted errors в спецификации HTML). Исключения из него доходят до `onerror` обезличенными: `Script error.`, пустой адрес, нули, `error: null` — даже если код вызван позже, из таймера. Отказы промисов из такого скрипта не доходят вовсе: события `unhandledrejection` нет, строка остаётся только в консоли. Чинится в два шага: `<script crossorigin="anonymous">` и ответ CDN с заголовком `Access-Control-Allow-Origin`. Первый шаг без второго хуже, чем ничего: скрипт не загрузится.';

export const NODE_ROWS = {
  head: ['что случилось', 'что делает Node 24.11', 'код выхода'],
  rows: [
    ['исключение в колбэке таймера, обработчика нет', 'печатает строку кода с `^` под `throw`, затем стек — и завершает процесс', '`1`'],
    ['отказ промиса, обработчиков нет', 'то же: печатает стек причины и завершает процесс (режим по умолчанию `throw`)', '`1`'],
    ['отказ со строкой, а не ошибкой', 'заворачивает её в `UnhandledPromiseRejection` с `code: \'ERR_UNHANDLED_REJECTION\'`: стек — внутренности Node', '`1`'],
    ['`throw \'строка\'` на верхнем уровне', 'печатает саму строку без места; где брошено — только с `--trace-uncaught`', '`1`'],
    ['есть `uncaughtException`', 'зовёт его и для исключений, и для отказов (второй аргумент — откуда); процесс живёт', '`0`'],
    ['обработчик `uncaughtException` сам бросил', 'печатает уже его ошибку и завершается', '**`7`**'],
    ['есть только `uncaughtExceptionMonitor`', 'зовёт его и всё равно завершает процесс', '`1`'],
  ],
  tones: ['err', 'err', 'err', 'err', 'warn', 'err', 'warn'] as ('ok' | 'warn' | 'err' | undefined)[],
};

export const CRASH_RUN: NodeRun = {
  file: 'crash-timer.mjs',
  code: `setTimeout(() => {
  throw new Error('упал таймер');
}, 0);
setTimeout(() => console.log('не дойдёт'), 10);`,
  out: `$ node crash-timer.mjs
file:///app/crash-timer.mjs:2
  throw new Error('упал таймер');
  ^

Error: упал таймер
    at Timeout._onTimeout (file:///app/crash-timer.mjs:2:9)
    at listOnTimeout (node:internal/timers:608:17)
    at process.processTimers (node:internal/timers:543:7)

Node.js v24.11.0`,
  exit: 1,
};

export const CRASH_NOTE =
  'Два указателя на одно место смотрят в разные колонки. Строку с `^` Node берёт из места `throw` — колонка 3. Стек снят в `new Error` — колонка 9. Для ошибки, созданной заранее, они разойдутся и по строкам.';

export const HANDLERS_RUN: NodeRun = {
  file: 'handlers.mjs',
  code: `process.on('uncaughtException', (err, origin) => {
  console.log(origin, '→', err.message);
});
setTimeout(() => {
  throw new Error('упал таймер');
}, 0);
Promise.reject(new Error('отказ без catch'));
setTimeout(() => console.log('процесс жив'), 10);`,
  out: `$ node handlers.mjs
unhandledRejection → отказ без catch
uncaughtException → упал таймер
процесс жив`,
};

export const HANDLERS_NOTE =
  'В режиме по умолчанию необработанный отказ Node превращает в исключение, поэтому оба приходят в `uncaughtException`, а различает их второй аргумент. Если повесить ещё и `unhandledRejection`, отказы уйдут туда, и до `uncaughtException` не дойдут. Процесс после этого живёт — но документация Node прямо говорит, что продолжать работу после неперехваченного исключения небезопасно: состояние программы неизвестно. Обработчик нужен, чтобы отправить отчёт и завершиться с ненулевым кодом, а не чтобы жить дальше.';

export const LATE_RUN: NodeRun = {
  file: 'late.mjs',
  code: `process.on('unhandledRejection', (reason) => console.log('unhandledRejection:', reason.message));
process.on('rejectionHandled', () => console.log('rejectionHandled'));
const p = Promise.reject(new Error('поздно'));
setTimeout(() => p.catch(() => console.log('catch')), 0);`,
  out: `$ node late.mjs
unhandledRejection: поздно
catch
rejectionHandled`,
};

export const LATE_NOTE =
  'Обработчик, добавленный в следующей задаче, опоздал — почему граница именно там, разобрано в «Промисе изнутри». Здесь важно другое: опоздание не бесследно. Node шлёт `rejectionHandled`, браузер — событие `rejectionhandled` (Chromium присылает его вслед за `unhandledrejection`). Сервис ошибок, который получает оба, может снять уже отправленную тревогу.';

// ─── Раздел 5. finally и порядок ───────────────────────────────────────────────────────────

export const FINALLY_ORDER_RUN: NodeRun = {
  file: 'order.mjs',
  code: `const log = [];
function save() {
  try {
    log.push('try');
    return 'итог';
  } finally {
    log.push('finally');
  }
}
log.push(save());
console.log(log.join(' → '));

async function load() {
  try {
    await null;
    throw new Error('сбой');
  } catch (e) {
    log.push('catch');
    throw e;
  } finally {
    log.push('finally');
  }
}
log.length = 0;
await load().catch(() => log.push('снаружи'));
console.log(log.join(' → '));`,
  out: `$ node order.mjs
try → finally → итог
catch → finally → снаружи`,
};

export const FINALLY_ORDER_NOTE =
  '`return` в `try` не выходит сразу: значение запоминается, выполняется `finally`, и только потом функция возвращает запомненное. С ошибкой так же — `catch` пробрасывает её, но наружу она выйдет после `finally`. В `async`-функции порядок тот же.';

export const FINALLY_LOSS_RUN: NodeRun = {
  file: 'loss.mjs',
  code: `function write() {
  try {
    throw new Error('не записалось');
  } finally {
    throw new Error('не закрылось');
  }
}
try {
  write();
} catch (e) {
  console.log(e.message, e.cause);
}

function quiet() {
  try {
    throw new Error('не записалось');
  } finally {
    return 'всё хорошо';
  }
}
console.log(quiet());`,
  out: `$ node loss.mjs
не закрылось undefined
всё хорошо`,
};

export const FINALLY_LOSS_NOTE =
  '`finally` побеждает. Исключение из него заменяет исходное, и `cause` при этом никто не заполняет: «не записалось» пропало без следа, в отчёт уйдёт вторичное «не закрылось». `return` из `finally` хуже — он глотает ошибку целиком. Правило: в `finally` только то, что не бросает, а если закрытие ресурса может упасть — ловить его там же.';

export const USING_RUN: NodeRun = {
  file: 'using.mjs',
  code: `function open() {
  return {
    [Symbol.dispose]() {
      throw new Error('не закрылось');
    },
  };
}
try {
  using file = open();
  throw new Error('не записалось');
} catch (e) {
  console.log(e.name);
  console.log('error:', e.error.message);
  console.log('suppressed:', e.suppressed.message);
}`,
  out: `$ node using.mjs
SuppressedError
error: не закрылось
suppressed: не записалось`,
};

export const USING_NOTE =
  '`using` (явное управление ресурсами, ES2026) закрывает ресурс сам, когда блок кончился, — как `finally`, но без потери. Если упали и тело, и закрытие, выходит `SuppressedError`: в `error` — ошибка закрытия, в `suppressed` — та, что она заглушила. Работает в Node 24.11 и Chromium 153. Сериализатору отчёта стоит знать и эти два поля.';

export const PROMISE_FINALLY_RUN: NodeRun = {
  file: 'promise-finally.mjs',
  code: `const a = await Promise.resolve('данные').finally(() => 'другое');
console.log(a);
const b = await Promise.reject(new Error('исходная'))
  .finally(() => { throw new Error('из finally'); })
  .catch((e) => e.message);
console.log(b);`,
  out: `$ node promise-finally.mjs
данные
из finally`,
};

export const PROMISE_FINALLY_NOTE =
  '`.finally()` у промиса устроен строже: то, что вернул его колбэк, игнорируется, и значение проходит насквозь. Но брошенное в колбэке — или отклонённый промис из него — так же заменяет исходный отказ.';

// ─── Раздел 6. Отчёт об ошибке ─────────────────────────────────────────────────────────────

export const REPORT_FIELDS = [
  { k: '`name`, `message`', d: 'Что случилось. По `name` сервис группирует однотипные ошибки, `message` читает человек.' },
  { k: '`stack`', d: 'Где. Позиции бандла: перевести их в исходник сервис сможет, только если знает релиз и у него есть карта.' },
  { k: '`cause` — вся цепочка', d: 'Почему. Верхняя ошибка обычно говорит «заказ не сохранён», настоящая причина — на два звена ниже.' },
  { k: '`errors` у `AggregateError`', d: 'Все отказы `Promise.any`: у самой агрегатной ошибки стек пустой, вся информация — в массиве.' },
  { k: 'свои поля: `code`, `status`', d: 'Машиночитаемая причина: `ETIMEDOUT`, `502`. По ним удобнее искать и считать, чем по тексту.' },
  { k: 'релиз, адрес, время, номер трассы', d: 'Контекст. Релиз связывает стек с картой исходников, номер трассы — с запросом на бэкенде.' },
];

export const REPORT_NOT =
  'Чего не отправлять: тела запросов, заголовки с токенами, куки, личные данные из `message`. Текст ошибки пишет код, и в него легко попадает всё, что было под рукой, — а отчёт хранится долго и читается многими.';

export const CLONE_ROWS = {
  head: ['способ', '`message`, `stack`', '`cause`', '`errors`', '`code`', 'класс'],
  rows: [
    ['`JSON.stringify(err)`', 'теряет', 'теряет (если задан в конструкторе)', 'теряет', 'берёт', 'теряет'],
    ['`structuredClone`, `postMessage`', 'берёт', 'берёт', 'теряет: `AggregateError` → `Error`', 'теряет', 'встроенный сохраняет, подкласс → `Error`'],
    ['консоль Node, DevTools', 'показывает', 'показывает, `[cause]`', 'показывает, `[errors]`', 'показывает', 'показывает'],
    ['`serializeError` ниже', 'берёт, стек — обрезанный', 'берёт всю цепочку', 'берёт', 'берёт', 'только `name`'],
  ],
  tones: ['err', 'warn', undefined, 'ok'] as ('ok' | 'warn' | 'err' | undefined)[],
};

export const CLONE_NOTE =
  'Строки `structuredClone` сняты в Node 24.11 и Chromium 153 — результат одинаковый. Консоль не в счёт: она печатает человеку, а не отправляет на сервер. Отдельная ловушка — `cause`, присвоенный после создания: `a.cause = b` делает поле перечисляемым, и если две ошибки ссылаются друг на друга, `JSON.stringify` бросает `TypeError: Converting circular structure to JSON` — прямо внутри обработчика ошибок.';

/**
 * Разбор строки стека V8 на кадры. Сверяется тестом с CallSite API (`Error.prepareStackTrace`)
 * на живых стеках Node и со снятыми стеками Node и Chromium (`ASYNC_CASES`).
 */
export const PARSE_CODE = `// Кадр V8: «    at [async ][имя (]место[)]».
const FRAME = /^\\s*at (?:(async) )?(?:(.+?) \\((.*)\\)|(.*))$/;
// Место: «файл:строка:колонка»; без чисел — «<anonymous>», «index 1».
const PLACE = /^(.*):(\\d+):(\\d+)$/;

function parseStack(stack) {
  const frames = [];
  for (const line of String(stack).split('\\n')) {
    const m = FRAME.exec(line);
    if (!m) continue;                     // заголовок «Error: …»
    const place = m[3] ?? m[4];
    const pos = PLACE.exec(place);
    let file = pos ? pos[1] : null;
    // Код из eval без имени: «eval at f (…), <anonymous>»
    if (file?.startsWith('eval at ')) file = null;
    frames.push({
      fn: m[2] ?? null,
      file,
      line: pos ? Number(pos[2]) : null,
      col: pos ? Number(pos[3]) : null,
      async: m[1] === 'async',
    });
  }
  return frames;
}`;

export const PARSE_NOTE =
  'Разбирает только формат V8 — Chromium, Edge, Node. Firefox и Safari пишут `имя@адрес:строка:колонка`, и там нужна своя ветка: форматы трёх движков сравниваются в «Трёх движках». Ещё одна честная дыра: если в `message` есть перевод строки и следующая строка начинается с `    at `, разбор примет её за кадр — по одной строке заголовок от кадра не отличить.';

/**
 * Сборка отчёта. Сверяется тестом: с `structuredClone` по `message`, `stack`, `cause`; на цикле,
 * глубокой цепочке, `AggregateError`, `SuppressedError`, брошенных не-ошибках.
 */
export const SERIALIZE_CODE = `const isError = Error.isError ?? ((v) => v instanceof Error);

function trimStack(stack, maxFrames) {
  if (typeof stack !== 'string') return null;
  const lines = stack.split('\\n');
  const first = lines.findIndex((l) => /^\\s+at /.test(l));
  if (first < 0) return stack;            // кадров нет или формат не V8
  const cut = lines.length - first - maxFrames;
  const kept = lines.slice(0, first + maxFrames);
  if (cut > 0) kept.push(\`    … отброшено кадров: \${cut}\`);
  return kept.join('\\n');
}

function serializeError(value, { maxFrames = 10, maxDepth = 5 } = {}) {
  const seen = new Set();

  function walk(v, depth) {
    if (!isError(v)) {
      // Бросили не ошибку: строку, число, объект. Стека у неё нет.
      let text;
      try { text = typeof v === 'string' ? v : JSON.stringify(v); }
      catch { text = String(v); }
      const type = v === null ? 'null' : typeof v;
      return { name: 'NonError', message: String(text), type };
    }
    if (seen.has(v)) return { name: v.name, message: v.message, circular: true };
    if (depth > maxDepth) return { name: v.name, message: v.message, truncated: true };
    seen.add(v);

    const out = { name: v.name, message: v.message,
                  stack: trimStack(v.stack, maxFrames) };
    for (const key of Object.keys(v)) {   // свои поля: code, status…
      const x = v[key];
      if (key in out || ['cause', 'errors', 'error', 'suppressed'].includes(key)) continue;
      if (['string', 'number', 'boolean'].includes(typeof x)) out[key] = x;
    }
    if ('cause' in v) out.cause = walk(v.cause, depth + 1);
    if (Array.isArray(v.errors)) out.errors = v.errors.map((e) => walk(e, depth + 1));
    if ('suppressed' in v) {                // SuppressedError из using
      out.error = walk(v.error, depth + 1);
      out.suppressed = walk(v.suppressed, depth + 1);
    }
    return out;
  }

  return walk(value, 0);
}`;

export const SERIALIZE_FACTS = [
  {
    t: 'Обходит, а не копирует',
    d: 'Поля перечислены явно: `name`, `message`, `stack`, свои простые поля, затем причины. Объекты в своих полях (`response`, `request`) не берутся — в них бывают тела и токены, да и размер непредсказуем.',
  },
  {
    t: 'Цикл и глубина',
    d: 'Множество `seen` помнит пройденные ошибки: на повторе — заглушка `circular`, а не бесконечный обход. `maxDepth` режет слишком длинную цепочку `cause`.',
  },
  {
    t: 'Не-ошибка — тоже отчёт',
    d: 'Брошенная строка или `null` превращаются в `NonError` с текстом и типом. Иначе отчёт о `throw \'нет денег\'` потерялся бы целиком — как раз там, где стека и так нет.',
  },
  {
    t: 'Обрезка стека',
    d: 'Кадры после `maxFrames` отбрасываются с пометкой, сколько их было. Для отчёта важнее начало стека — место ошибки; конец — обычно фреймворк и загрузчик.',
  },
];

export const REPORT_CASES: ReportCase[] = [
  {
    id: 'cause',
    label: 'Цепочка cause',
    code: `// Обёртка: своя ошибка сверху, исходная — в cause
function query() {
  const err = new Error('connect ETIMEDOUT 10.0.0.5:5432');
  err.code = 'ETIMEDOUT';
  throw err;
}
function saveOrder(id) {
  try {
    query();
  } catch (e) {
    throw new Error(\`Заказ \${id} не сохранён\`, { cause: e });
  }
}
saveOrder(42);`,
    note: 'Верхняя ошибка говорит, что случилось с точки зрения пользователя, причина — что случилось на самом деле. `JSON.stringify` не видит ни того, ни другого: у причины перечисляемо одно поле `code`, а до неё он даже не доходит.',
  },
  {
    id: 'any',
    label: 'Promise.any',
    code: `// Два банка, оба отказали
async function pay(bank, code) {
  const err = new Error(\`\${bank}: отказ\`);
  err.code = code;
  throw err;
}
await Promise.any([
  pay('Банк А', 'DECLINED'),
  pay('Банк Б', 'TIMEOUT'),
]);`,
    note: 'У самой `AggregateError` стек без кадров: её создал движок внутри `Promise.any`, а не ваш код. Всё полезное — в `errors`, и стеки там — от `pay`.',
  },
  {
    id: 'cycle',
    label: 'Цикл',
    code: `// cause, присвоенный после создания, — перечисляемый
const a = new Error('A');
const b = new Error('B');
a.cause = b;
b.cause = a;
throw a;`,
    note: 'Две ошибки ссылаются друг на друга. `JSON.stringify` бросает `TypeError` — в обработчике ошибок это вторая ошибка поверх первой. `serializeError` ставит заглушку `circular` на втором заходе в `A`.',
  },
  {
    id: 'string',
    label: 'Не ошибка',
    code: `// Бросили строку: ни стека, ни места
function charge() {
  throw 'нет денег';
}
charge();`,
    note: 'Стека нет и взять его неоткуда: конструктор ошибки не вызывался. Отчёт сохраняет хотя бы текст и тип — и сам факт, что бросили не ошибку.',
  },
  {
    id: 'deep',
    label: 'Глубокий стек',
    code: `// Рекурсия: кадров больше, чем stackTraceLimit
function walk(node, depth) {
  if (depth === 0) throw new Error('дерево слишком глубокое');
  walk(node, depth - 1);
}
walk({}, 30);`,
    note: 'Настоящих кадров здесь больше тридцати, но V8 сохранил столько, сколько разрешает `Error.stackTraceLimit`, — по умолчанию 10. Обрезка в отчёте режет уже от них.',
  },
];

export const REPORT_CAPTION =
  'Случай исполняется в вашем браузере, под именем файла `case.js`: стек — настоящий, вашего движка. Отчёт собирает `serializeError`, кадры разбирает `parseStack` — те же строки, что напечатаны выше. В Firefox и Safari стек другого формата, и `parseStack` кадров в нём не найдёт.';

export const MAX_FRAMES_OPTIONS = [
  { value: '3', label: '3 кадра' },
  { value: '10', label: '10' },
  { value: 'all', label: 'все' },
];

export const REPORT_WHERE_CODE = `// Браузер: всё, что не поймали, — в один отчёт
window.addEventListener('error', (e) => send(serializeError(e.error ?? e.message)));
window.addEventListener('unhandledrejection', (e) => send(serializeError(e.reason)));

// Node: отчёт — и выход с ненулевым кодом
process.on('uncaughtException', (err, origin) => {
  send({ origin, ...serializeError(err) });
  process.exitCode = 1;
});`;

export const REPORT_WHERE_NOTE =
  'Для «Script error.» `e.error` — `null`, и в отчёт уйдёт хотя бы текст события. `send` — ваша отправка: `navigator.sendBeacon` в браузере переживает закрытие вкладки. В отчёт добавляют релиз (без него не найти карту исходников) и номер трассы запроса — как его получить на фронте, разобрано в «Наблюдаемости».';

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: '`JSON.stringify(err)` — это `{}`',
    d: '`message`, `stack` и `cause` неперечисляемые, а `JSON.stringify` берёт только перечисляемые свои поля. В лог уходит пустой объект или одно поле `code`. Сериализовать ошибку нужно явным обходом.',
    tone: 'err',
  },
  {
    n: '02',
    t: 'Стек — место `new Error`, а не `throw`',
    d: 'Ошибка, созданная заранее и брошенная позже, покажет место создания. `window.onerror` получает те же строку и колонку. Строка с `^`, которую печатает упавший Node, наоборот, указывает на `throw` — два указателя расходятся.',
    tone: 'warn',
  },
  {
    n: '03',
    t: 'Стек обрезан до 10 кадров',
    d: '`Error.stackTraceLimit` по умолчанию 10 в V8. Остаётся самый глубокий конец — место ошибки, а начало, откуда пришёл вызов, отрезано. Предел читается при создании ошибки: поднимать его надо заранее, при старте приложения.',
    tone: 'warn',
  },
  {
    n: '04',
    t: '`.then` и таймеры рвут асинхронный стек',
    d: 'V8 восстанавливает только цепочку `await` и `Promise.all`/`any`/`allSettled`. Обычная функция, вызвавшая `.then`, и тот, кто поставил таймер, в стеке не появятся.',
    tone: 'warn',
  },
  {
    n: '05',
    t: '«Script error.» — это CORS, а не баг',
    d: 'Скрипт с чужого источника без `crossorigin` отдаёт `onerror` пустые поля, а его отказы промисов не дают `unhandledrejection` вовсе. Нужны оба шага: атрибут `crossorigin` и заголовок `Access-Control-Allow-Origin` у CDN.',
    tone: 'err',
  },
  {
    n: '06',
    t: '`throw` не-ошибки теряет место',
    d: 'Строка, число, объект — без стека. Упавший Node печатает только саму строку, без файла и номера строки. Бросайте `Error` или подкласс; ловите с расчётом на что угодно.',
    tone: 'warn',
  },
  {
    n: '07',
    t: 'Исключение в `finally` стирает исходное',
    d: 'Ошибка из `finally` заменяет ту, что летела из `try`, без всякого `cause`, а `return` в `finally` глотает её целиком. `using` в этом случае даёт `SuppressedError` с обеими.',
    tone: 'err',
  },
  {
    n: '08',
    t: '`message` после создания правится по-разному',
    d: 'Node строит заголовок стека при первом чтении `stack` и подхватит новое `message`, Chromium оставит то, что было при создании. Не правьте ошибку — оборачивайте в новую с `cause`.',
  },
  {
    n: '09',
    t: '`uncaughtException` — не способ выжить',
    d: 'С обработчиком процесс не падает, но состояние программы после неперехваченной ошибки неизвестно. Обработчик — для отчёта и аккуратного выхода. Если он сам бросит, Node завершится с кодом 7.',
    tone: 'warn',
  },
  {
    n: '10',
    t: '`prepareStackTrace` меняет стек всем',
    d: 'Хук глобальный: подмена форматирует `stack` всех ошибок процесса, включая ошибки библиотек. Если он вернёт не строку, упадёт любой код, который делает `err.stack.split`.',
  },
];

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'ECMAScript — Error Objects',
    href: 'https://tc39.es/ecma262/#sec-error-objects',
    what: '`message`, `cause` (InstallErrorCause), `AggregateError`; о `stack` стандарт молчит',
  },
  {
    title: 'V8 — Stack trace API',
    href: 'https://v8.dev/docs/stack-trace-api',
    what: '`Error.captureStackTrace`, `Error.stackTraceLimit`, `Error.prepareStackTrace` и методы CallSite; формат кадра',
  },
  {
    title: 'V8 — Faster async functions and promises',
    href: 'https://v8.dev/blog/fast-async',
    what: 'асинхронные стеки «нулевой цены»: восстановление кадров `await` в момент создания ошибки',
  },
  {
    title: 'HTML — Runtime script errors',
    href: 'https://html.spec.whatwg.org/multipage/webappapis.html#runtime-script-errors',
    what: 'событие `error`, «заглушённые» ошибки чужого источника (muted errors), `reportError`',
  },
  {
    title: 'HTML — Unhandled promise rejections',
    href: 'https://html.spec.whatwg.org/multipage/webappapis.html#unhandled-promise-rejections',
    what: '`unhandledrejection` и `rejectionhandled`; отказы из заглушённых скриптов не сообщаются',
  },
  {
    title: 'Node.js — process: `uncaughtException`, `unhandledRejection`, exit codes',
    href: 'https://nodejs.org/api/process.html#event-uncaughtexception',
    what: 'аргумент `origin`, предупреждение о работе после исключения, `uncaughtExceptionMonitor`, коды выхода 1 и 7',
  },
  {
    title: 'TC39 — Error.isError',
    href: 'https://github.com/tc39/proposal-is-error',
    what: 'проверка настоящей ошибки, в том числе из другого окна',
  },
  {
    title: 'TC39 — Explicit Resource Management',
    href: 'https://github.com/tc39/proposal-explicit-resource-management',
    what: '`using`, `Symbol.dispose`, `SuppressedError`',
  },
  {
    title: 'HTML — Structured serialization',
    href: 'https://html.spec.whatwg.org/multipage/structured-data.html#structuredserializeinternal',
    what: 'что `structuredClone` и `postMessage` берут у ошибки: имя встроенного класса, `message`, `cause`, `stack`',
  },
];

export const RELATED =
  'Смежное на сайте: [Колбэки, раздел «Ошибки»](/js/callbacks/#s5) — куда уходит бросок из синхронного и асинхронного колбэка. [Промис изнутри, раздел «Отказ»](/js/promise-internals/#s5) — когда срабатывает `unhandledrejection` и флаги `--unhandled-rejections`. [Source maps изнутри, раздел «От стека к исходнику»](/tooling/source-maps/#s3) — как позицию из стека довести до исходника. [Три движка, раздел «Язык»](/render/browser-engines/#s2) — формат стека в Firefox и Safari. [Отмена: AbortController](/js/abort-controller/) — `AbortError` и причина отмены в `cause`. [Наблюдаемость, раздел «С фронта на бэк»](/delivery/observability/#s5) — номер трассы в отчёте об ошибке. [Безопасность бэкенда, раздел «Ошибки и секреты»](/platform/backend-security/#s5) — что утекает через текст ошибки. [Suspense и границы ошибок](/frameworks/suspense-errors/) — что ловит граница в React и Vue, водопад и стабильный промис. [Копирование и сериализация](/js/serialization/) — `JSON.stringify` по шагам, алгоритм `structuredClone` и что теряет каждая копия. [Асинхронный контекст](/js/async-context/) — AsyncLocalStorage, момент снимка контекста и почему в браузере его пока нет.';
