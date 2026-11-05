import type { Pitfall } from '@/widgets/pitfalls/model/types';

/**
 * Данные темы «Процессы и потоки в Node».
 *
 * Тема написана 2026-11-03 по просьбе автора курса: подраздел «В Node: `worker_threads` против
 * `cluster`» уехал сюда из «Воркеров и параллелизма» (`NODE_PAR`, `CLUSTER_CODE`, `SHARE_ENV_CODE`
 * и их проверки), там остался абзац со ссылкой. Соседние темы про Node не повторяются: фазы цикла
 * и пул libuv — дом в «Цикле событий Node», потолок памяти воркера `resourceLimits` — в «Памяти
 * в Node», клонирование и пул воркеров — в «Воркерах», инъекция через `exec` — в «Безопасности
 * бэкенда», `SIGTERM` в контейнере — в Docker.
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * Официальный Node **26.8.2**, macOS arm64, 8 логических ядер. Каталог проб —
 * `scratchpad/np/` (`p1.mjs`, `p2.mjs`, `c1.cjs`…`c4.cjs`).
 *
 * Каждый пример с заявленным выводом исполняет `tests/unit/node-processes.test.ts`: строка
 * из этого файла пишется во временный файл и запускается отдельным процессом `node` — тот же
 * код, что видит читатель. Таймерных сверок в тесте нет.
 *
 * Числа, снятые замером (в тест не идут, машинозависимы):
 *   — старт воркера до первого сообщения — медиана 15.1 мс из семи (13.7–15.9);
 *   — запуск дочернего `node -e 0` до `exit` — медиана 34.1 мс из семи.
 *
 * Что снято пробами и закреплено тестом:
 *   — `cluster.schedulingPolicy` на macOS — `SCHED_RR`; соединения ходят по кругу A B A B,
 *     а шесть запросов по одному keep-alive соединению уходят одному процессу (2 прогона из 2);
 *   — брошенная ошибка и отклонённый промис в воркере: событие `error`, затем `exit` с кодом 1;
 *     `process.exit(3)` — только `exit` с кодом 3;
 *   — `events.once(worker, 'exit')` **отклоняется**, если раньше пришло `error`;
 *   — `process.chdir` в воркере — `ERR_WORKER_UNSUPPORTED_OPERATION`;
 *   — `exec` с выводом 2 МБ — `ERR_CHILD_PROCESS_STDIO_MAXBUFFER`, вывод обрезан до 1 048 576;
 *   — `spawn` несуществующей программы без обработчика `error` роняет процесс (код 1);
 *   — `fork` с JSON-каналом: `Date` приезжает строкой, `Map` — `{}`; с `advanced` — оба целы.
 */

// ─── Вводный раздел ────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'процесс',
    d: 'Запущенная программа со своей памятью, своим номером `pid` и своими открытыми файлами. Два процесса не видят память друг друга — так их разделяет операционная система.',
  },
  {
    k: 'поток',
    d: 'Отдельная линия выполнения **внутри** процесса. Все потоки процесса живут в одной памяти и могут работать на разных ядрах одновременно.',
  },
  {
    k: 'агент',
    d: 'Так спецификация JS называет исполнителя кода: свой стек, свой цикл событий, своя куча. В Node главный поток и каждый воркер — отдельные агенты.',
  },
  {
    k: 'IPC',
    d: 'Канал между процессами (inter-process communication). Сообщение по нему превращается в байты в одном процессе и собирается заново в другом.',
  },
  {
    k: 'stdin, stdout, stderr',
    d: 'Три стандартных потока байтов у любого процесса: ввод, вывод и вывод ошибок. Родитель читает вывод ребёнка именно через них.',
  },
  {
    k: 'код выхода',
    d: 'Число, с которым процесс завершается: 0 — успех, любое другое — сбой. Если процесс убит сигналом, кода нет, вместо него — имя сигнала.',
  },
  {
    k: 'сигнал',
    d: 'Короткое уведомление процессу от операционной системы: `SIGTERM` — «завершись», `SIGKILL` — «умри немедленно», `SIGINT` — Ctrl+C в терминале.',
  },
];

export const PLAIN_PROCESS =
  'Процесс — квартира со своим адресом: стены, свои вещи, к соседям без приглашения не зайти. Поток — ещё один жилец той же квартиры. В обычных языках жильцы пользуются общими вещами, и им приходится договариваться, кто что взял. В Node каждый жилец живёт в своей запертой комнате: адрес у квартиры общий, а вещи у каждого свои, и передают их только записками под дверь. Это и есть воркер. Второй процесс — уже соседняя квартира: туда записку несут через лестничную клетку, и по дороге она может помяться.';

export const PREREQ_NOTE =
  'Тема опирается на три вещи из соседних тем.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'Цикл событий Node',
    d: 'Один поток выполняет колбэки по одному. Пока колбэк считает, ни один запрос, таймер или ответ сети не будет обработан.',
    href: '/js/node-event-loop/#s1',
    hrefLabel: '«Цикл событий Node», раздел «Оборот цикла — это функция uv_run»',
    tone: 'info',
  },
  {
    t: 'Агент и его изоляция',
    d: 'У воркера своя память и свой цикл событий; общих объектов с главным потоком нет, есть только сообщения.',
    href: '/js/workers/#s1',
    hrefLabel: '«Воркеры и параллелизм», раздел «Агент и его изоляция»',
    tone: 'info',
  },
  {
    t: 'Копия при отправке',
    d: 'Сообщение воркеру — копия, собранная алгоритмом structured clone: `Map` и `Date` доезжают, прототип класса и функции — нет.',
    href: '/js/serialization/#s4',
    hrefLabel: '«Копирование и сериализация», раздел «Structured clone по шагам»',
    tone: 'info',
  },
];

// ─── Раздел 1. Первый воркер и карта ───────────────────────────────────────────────────────

/**
 * Пара файлов «главный поток + воркер». Тест кладёт обе строки рядом во временный каталог
 * (`main.mjs`, `sum.mjs`), запускает `main.mjs` и сверяет вывод с `FIRST_OUT`.
 */
export const FIRST_MAIN_CODE = `// main.mjs
import { Worker } from 'node:worker_threads';

const worker = new Worker(new URL('./sum.mjs', import.meta.url), {
  workerData: { from: 1, to: 10_000_000 },   // уедет копией
});

worker.on('message', (sum) => console.log('сумма:', sum));
worker.on('error', (err) => console.error('воркер упал:', err.message));
worker.on('exit', (code) => console.log('воркер вышел с кодом', code));

console.log('главный поток свободен');`;

export const FIRST_WORKER_CODE = `// sum.mjs
import { workerData, parentPort } from 'node:worker_threads';

let sum = 0;
for (let i = workerData.from; i <= workerData.to; i++) sum += i;

parentPort.postMessage(sum);`;

export const FIRST_OUT = `главный поток свободен
сумма: 50000005000000
воркер вышел с кодом 0`;

export const FIRST_NOTE =
  'Отличий от браузерного воркера три. Модуль называется `node:worker_threads`, а не глобальный `Worker`. Стартовые данные передают опцией `workerData` — воркер получает их копию сразу, без первого сообщения. А канал к родителю внутри воркера называется `parentPort`: `self` там нет. Порядок вывода тот же, что в браузере: конструктор не ждёт воркер, поэтому «главный поток свободен» печатается первым.';

export const PLAIN_FOUR =
  'Работу из главного потока Node можно убрать четырьмя способами, и они различаются тем, что делят с главным потоком. Пул libuv — служебные потоки самого Node: туда уходят файлы, хеши и сжатие, ваш JS там не выполняется. Воркер — ваш JS в другом потоке того же процесса. Дочерний процесс — любая программа рядом, хоть `ffmpeg`, хоть ещё один `node`. `cluster` — несколько копий вашего сервера, которые слушают один порт.';

export const FOUR_WAYS = {
  head: ['', 'пул libuv', '`worker_threads`', '`child_process`', '`cluster`'],
  cols: 'minmax(130px,.8fr) minmax(150px,1fr) minmax(170px,1fr) minmax(170px,1fr) minmax(170px,1fr)',
  kinds: ['prose', 'prose', 'prose', 'prose', 'prose'] as ('mono' | 'prose' | 'muted' | 'ok' | 'warn')[],
  minWidth: 820,
  rows: [
    ['что выполняет', 'C++ внутри Node: `fs`, `crypto`, `zlib`, `dns.lookup`', 'ваш JS-модуль', 'любую программу', 'копию вашего приложения'],
    ['`process.pid`', 'тот же', 'тот же', 'свой', 'свой'],
    ['память', 'общая, но ваш код её не видит', 'своя куча; общим бывает только `SharedArrayBuffer`', 'своя целиком', 'своя целиком'],
    ['канал', 'колбэк или промис API', '`postMessage`, structured clone', 'stdin/stdout; у `fork` — ещё IPC', 'IPC, по умолчанию **JSON**'],
    ['старт', 'потоки уже запущены', 'около 15 мс', 'около 35 мс для `node`', 'как у `child_process.fork`'],
    ['зачем', 'ввод-вывод без блокировки цикла — сам, без вашего участия', 'тяжёлый расчёт на JS, не останавливая цикл', 'запустить внешнюю программу или изолировать ненадёжный код', 'раздать соединения одного порта по ядрам'],
  ],
};

export const FOUR_WAYS_NOTE =
  'Пул libuv здесь для полноты: вызывать его не нужно, Node отправляет туда работу сам. Как он устроен и почему из четырёх потоков бывает тесно — в [«Цикле событий Node», раздел «Пул потоков: кто в нём ждёт»](/js/node-event-loop/#s6). Числа старта сняты на ноутбуке и нужны для порядка: воркер дешевле процесса примерно вдвое, а оба — в тысячи раз дороже одного сообщения.';

// ─── Раздел 2. worker_threads ──────────────────────────────────────────────────────────────

export const SHARED_ROWS: { k: string; v: string; tone?: 'ok' | 'warn' }[] = [
  { k: 'номер процесса `process.pid`', v: '**общий**: воркер — поток внутри того же процесса', tone: 'ok' },
  { k: 'куча V8, глобальные переменные, кеш модулей', v: '**свои**: модуль, импортированный и в главном потоке, и в воркере, выполняется дважды, и его переменные у каждого свои' },
  { k: 'цикл событий', v: '**свой** у каждого воркера; а пул libuv — **один** на процесс, и воркеры занимают его вместе с главным потоком', tone: 'warn' },
  { k: '`process.env`', v: '**копия**, снятая при старте; общим его делает опция `env: SHARE_ENV`' },
  { k: '`process.exit()`', v: 'завершает **только воркер**; родитель получает событие `exit` с кодом', tone: 'ok' },
  { k: '`process.chdir()`, `process.on(\'SIGINT\')`', v: 'не работают: смена каталога — ошибка `ERR_WORKER_UNSUPPORTED_OPERATION`, сигналы получает только главный поток', tone: 'warn' },
  { k: '`console.log` в воркере', v: 'пишет не сам: вывод уходит в главный поток, и печатает его цикл главного потока' },
];

/** ⚠️ Исполняется тестом: вывод сверяется с `SHARE_ENV_OUT`. Перенесено из «Воркеров». */
export const SHARE_ENV_CODE = `import { Worker, SHARE_ENV } from 'node:worker_threads';
import { once } from 'node:events';

for (const env of [undefined, SHARE_ENV]) {
  process.env.MODE = 'main';
  const w = new Worker(\`process.env.MODE = 'worker'\`, { eval: true, env });
  await once(w, 'exit');
  console.log(process.env.MODE);
}`;

export const SHARE_ENV_OUT = ['main', 'worker'];

export const SHARE_ENV_NOTE =
  '`eval: true` значит «первый аргумент — не путь к файлу, а сам код»: так удобно показывать короткие воркеры, в жизни их кладут в файл. `process.env` воркера — копия, снятая при старте: запись в ней видна только самому воркеру, поэтому первая строка вывода — `main`. Опция `env: SHARE_ENV` делает окружение одним на всех, и запись воркера видна родителю — вторая строка. Нужно это редко: обычно настройки передают явно через `workerData`, тогда видно, что именно воркер получил.';

/**
 * ⚠️ Исполняется тестом: вывод сверяется с `ERRORS_OUT`. Ожидание выхода — через `on('exit')`,
 * а не `events.once`: тот отклоняется на событии `error` (тонкое место 01, тоже под тестом).
 */
export const ERRORS_CODE = `import { Worker } from 'node:worker_threads';

const bodies = [
  \`throw new TypeError('сломался')\`,
  \`Promise.reject(new Error('отказ'))\`,
  \`process.exit(3)\`,
];

for (const body of bodies) {
  const w = new Worker(body, { eval: true });
  w.on('error', (err) => console.log('error:', err.name, err.message));
  const code = await new Promise((resolve) => w.on('exit', resolve));
  console.log('exit:', code);
}
console.log('процесс жив');`;

export const ERRORS_OUT = [
  'error: TypeError сломался',
  'exit: 1',
  'error: Error отказ',
  'exit: 1',
  'exit: 3',
  'процесс жив',
];

export const ERRORS_NOTE =
  'Ошибка воркера не роняет процесс: она приходит родителю событием `error` — с тем же классом и текстом, — а следом `exit` с кодом 1. Отклонённый промис без обработчика в Node тоже убивает воркер. В браузере не так: там он остаётся событием внутри воркера, и страница о нём не узнаёт. `process.exit(3)` — не ошибка, поэтому события `error` нет, только `exit` с кодом 3. Обработчик `error` обязателен: без него ошибка воркера становится ошибкой главного потока и роняет весь процесс.';

export const WORKER_FACTS: { t: string; d: string; tone?: 'ok' | 'warn' }[] = [
  {
    t: 'Воркер заводят заранее',
    d: 'Около 15 мс от `new Worker` до первого сообщения и несколько мегабайт на свою кучу. Воркер под каждый запрос съест больше, чем сэкономит. Встроенного пула в Node нет: его пишут сами или берут `piscina`. Правила пула — те же, что в браузере, и разобраны в [«Воркерах», раздел «Пул воркеров: сколько заводить»](/js/workers/#s5).',
    tone: 'warn',
  },
  {
    t: '`Atomics.wait` в главном потоке разрешён',
    d: 'В браузере главный поток ждать на общей памяти не может — `TypeError`: он рисует страницу. В Node запрета нет: главный поток сервера можно усыпить на `Atomics.wait`, и вместе с ним уснут все запросы. Как устроены `wait`, `notify` и общая память — в [«Общая память и Atomics», раздел «Ждать и будить»](/js/atomics/#s5).',
  },
  {
    t: 'Потолок памяти задаётся на воркер',
    d: 'Опция `resourceLimits` ограничивает кучу одного воркера: при превышении падает только он, с ошибкой `ERR_WORKER_OUT_OF_MEMORY`, а процесс живёт. Числа и связь с лимитом контейнера — в [«Памяти в Node», раздел «Лимиты и контейнеры»](/js/node-memory/#s4).',
    tone: 'ok',
  },
  {
    t: 'Порты и синхронное чтение',
    d: 'Кроме `parentPort` воркеру можно отдать любой `MessagePort`, а `receiveMessageOnPort` читает сообщение синхронно, без цикла событий, — этого в браузере нет. Разобрано в [«MessageChannel», раздел «Применение»](/js/message-channel/#s4).',
  },
];

/** ⚠️ Исполняется тестом `tests/unit/node-processes.test.ts`: вывод сверяется с `UNTRANSFERABLE_OUT`. Перенесено из «Воркеров». */
export const UNTRANSFERABLE_CODE = `import { markAsUntransferable, isMarkedAsUntransferable } from 'node:worker_threads';

const chunk = Buffer.from('abc');     // маленький Buffer нарезан из общего пула
console.log(chunk.length, chunk.buffer.byteLength > chunk.length);
console.log(isMarkedAsUntransferable(chunk.buffer));

const own = new ArrayBuffer(8);
markAsUntransferable(own);
try {
  structuredClone(own, { transfer: [own] });
} catch (e) {
  console.log(e.name);
}
console.log(own.byteLength, structuredClone(own).byteLength);`;

export const UNTRANSFERABLE_OUT = ['3 true', 'true', 'DataCloneError', '8 8'];

export const UNTRANSFERABLE_NOTE =
  'Буфер можно не копировать, а **передать** воркеру списком переноса: `postMessage(msg, [buf])`. Тогда у отправителя он пустеет — как это устроено, разобрано в [«Воркерах», раздел «Передача владения»](/js/workers/#s3). В Node бывает и обратная задача: буфер, который передавать **нельзя**, потому что им пользуется кто-то ещё. Главный пример — сам `Buffer`. Маленькие буферы (`Buffer.from`, `Buffer.allocUnsafe`) нарезаются из одного большого блока — пула, поэтому у трёхбайтного `chunk` поле `chunk.buffer` — весь пул, а не три байта (первая строка). Перенеси его — и отсоединишь память у всех буферов, нарезанных из того же пула. Поэтому Node помечает пул функцией `markAsUntransferable` (вторая строка), и перенос помеченного буфера бросает `DataCloneError`, оставляя его у владельца. Копией такой буфер уходит как обычно (последняя строка). Той же функцией помечают и свой буфер — например, рабочий, который переиспользуется от сообщения к сообщению. `Buffer.alloc` пул не использует, и его буфер переносится. В браузере такой функции нет.';

// ─── Раздел 3. child_process ───────────────────────────────────────────────────────────────

export const CP_FUNCS = {
  head: ['функция', 'оболочка', 'вывод', 'канал сообщений', 'когда'],
  cols: 'minmax(110px,.6fr) minmax(110px,.6fr) minmax(170px,1fr) minmax(130px,.7fr) minmax(220px,1.3fr)',
  kinds: ['mono', 'prose', 'prose', 'prose', 'prose'] as ('mono' | 'prose' | 'muted' | 'ok' | 'warn')[],
  minWidth: 760,
  rows: [
    ['spawn', 'нет', 'поток: куски по мере работы', 'нет', 'долгая программа или большой вывод'],
    ['execFile', 'нет', 'весь сразу, в колбэке; не больше 1 МБ', 'нет', 'короткая команда с аргументами'],
    ['exec', '**да**: строка уходит в `/bin/sh`', 'весь сразу, в колбэке; не больше 1 МБ', 'нет', 'нужны возможности оболочки: `|`, `*`, `&&`'],
    ['fork', 'нет', 'поток, как у `spawn`', '**да**: `send` и событие `message`', 'дочерний процесс на Node, с которым надо переписываться'],
  ],
};

export const CP_FUNCS_NOTE =
  'Под всеми четырьмя — один `spawn`: остальные добавляют к нему сбор вывода, оболочку или канал. `exec` опаснее прочих: строка целиком уходит в оболочку, и пользовательский ввод в ней превращается в команду. Как это эксплуатируют и почему лечится `execFile` с массивом аргументов — в [«Безопасности бэкенда», раздел «Инъекции: SQL, HTML и командная строка»](/platform/backend-security/#s3).';

/** ⚠️ Исполняется тестом: вывод сверяется с `SPAWN_OUT`. */
export const SPAWN_CODE = `import { spawn } from 'node:child_process';

// process.execPath — путь к тому же node, что запустил этот файл
const child = spawn(process.execPath, ['-e', \`
  process.stdout.write('раз');
  setTimeout(() => process.stdout.write('два'), 50);
\`]);

child.stdout.on('data', (chunk) => console.log('кусок:', String(chunk)));
child.on('exit', (code, signal) => console.log('exit:', code, signal));
child.on('close', (code) => console.log('close:', code));`;

export const SPAWN_OUT = ['кусок: раз', 'кусок: два', 'exit: 0 null', 'close: 0'];

export const SPAWN_NOTE =
  'Вывод приходит кусками, по мере того как ребёнок пишет, — `spawn` не копит его в памяти. Событий конца два. `exit` значит «процесс завершился», но его stdout в этот момент может быть ещё не дочитан. `close` приходит позже, когда закрылись и процесс, и все его потоки вывода. Поэтому собранный вывод разбирают в `close`. У `exit` два аргумента: код и сигнал. Если процесс убит сигналом — например, `child.kill()` шлёт `SIGTERM`, — код равен `null`, а сигнал — `\'SIGTERM\'`.';

export const CP_FACTS: { t: string; d: string; tone?: 'ok' | 'warn' }[] = [
  {
    t: 'Ненулевой код — не исключение',
    d: 'Для `spawn` упавшая программа — это обычное событие `exit` с кодом 1, и проверять код нужно самому. `exec` и `execFile` в этом случае передают в колбэк ошибку, у которой `err.code` — тот же код выхода.',
  },
  {
    t: 'Программы нет — событие, а не `throw`',
    d: '`spawn(\'no-such-bin\')` возвращает объект как ни в чём не бывало; `ENOENT` приходит позже событием `error`. Без обработчика `error` это необработанная ошибка, и падает **весь** родительский процесс.',
    tone: 'warn',
  },
  {
    t: 'Сигнал — просьба, а не приговор',
    d: '`child.kill()` шлёт `SIGTERM`, и программа может его перехватить и завершиться аккуратно — или проигнорировать. Безусловно убивает только `SIGKILL`. Как Node-приложению правильно обработать `SIGTERM` в контейнере — в [Docker, раздел «Запуск: первый процесс и сигналы»](/delivery/docker/#s6).',
  },
];

/**
 * ⚠️ Исполняется тестом: тест кладёт `FORK_CHILD_CODE` рядом в `echo.cjs` и сверяет вывод
 * с `FORK_OUT`.
 */
export const FORK_CODE = `// parent.mjs
import { fork } from 'node:child_process';
import { once } from 'node:events';

for (const serialization of ['json', 'advanced']) {
  const child = fork('./echo.cjs', { serialization });
  child.send({ when: new Date(0), tags: new Map([['a', 1]]) });
  const [back] = await once(child, 'message');
  console.log(serialization, typeof back.when, back.tags instanceof Map);
  child.disconnect();                  // закрыть канал — echo.cjs завершится сам
}`;

export const FORK_CHILD_CODE = `// echo.cjs
process.on('message', (msg) => process.send(msg));`;

export const FORK_OUT = ['json string false', 'advanced object true'];

export const FORK_NOTE =
  'Канал между процессами по умолчанию сериализует сообщения JSON-ом. Поэтому `Date` приезжает строкой, а `Map` — пустым объектом `{}`, и всё это **без единой ошибки**. Опция `serialization: \'advanced\'` включает то же structured clone, что у воркеров, и `Date` с `Map` доезжают целыми. Но общей памяти между процессами нет ни в каком режиме: `SharedArrayBuffer` в `advanced` даёт ошибку `could not be cloned`, а в JSON — снова молчаливый `{}`.';

// ─── Раздел 4. cluster ─────────────────────────────────────────────────────────────────────

export const PLAIN_CLUSTER =
  '`cluster` — это `fork` с одной дополнительной услугой. Главный процесс открывает порт сам, а входящие соединения раздаёт копиям приложения по очереди, как администратор в ресторане сажает гостей за столики официантов по кругу. Официант обслуживает свой столик до конца: гость, который сел, больше не пересаживается.';

/**
 * ⚠️ Исполняется тестом: вывод сверяется с `CLUSTER_RR_OUT`. `listen(0)` в процессах-копиях
 * даёт всем **один** случайный порт — тест не занимает фиксированный.
 */
export const CLUSTER_RR_CODE = `const cluster = require('node:cluster');
const http = require('node:http');

if (cluster.isPrimary) {
  cluster.fork();
  cluster.fork();
  let ready = 0;
  cluster.on('listening', async (worker, { port }) => {
    if (++ready < 2) return;                      // ждём обе копии
    for (const keepAlive of [false, true]) {
      const agent = new http.Agent({ keepAlive, maxSockets: 1 });
      const pids = [];
      for (let i = 0; i < 6; i++) pids.push(await get(port, agent));
      console.log(keepAlive ? 'одно соединение:' : 'новые соединения:',
        pids.map((pid) => (pid === pids[0] ? 'A' : 'B')).join(' '));
      agent.destroy();
    }
    for (const w of Object.values(cluster.workers)) w.kill();
  });
} else {
  http.createServer((req, res) => res.end(String(process.pid))).listen(0);
}

function get(port, agent) {
  return new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port, agent }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve(body));
    });
  });
}`;

export const CLUSTER_RR_OUT = ['новые соединения: A B A B A B', 'одно соединение: A A A A A A'];

export const CLUSTER_RR_NOTE =
  'Каждая копия отвечает своим `pid`, и вывод показывает, кто обслужил запрос. Пока каждый запрос открывает новое соединение, копии чередуются строго по кругу. На одном keep-alive соединении все шесть запросов достаются одной копии: главный процесс раздаёт **соединения**, а не запросы, и после раздачи в разговор не вмешивается. Так ведёт себя и любой балансировщик четвёртого уровня — подробно в [«Балансировке нагрузки», раздел «Соединения или запросы: L4 и L7»](/delivery/load-balancing/#s1). По кругу раздаёт главный процесс везде, кроме Windows; там соединение достаётся той копии, которую разбудит операционная система.';

export const CLUSTER_ROWS: { k: string; v: string; tone?: 'ok' | 'warn' }[] = [
  { k: 'что создаётся', v: 'копия всего приложения: `cluster.fork()` — это `child_process.fork` того же файла' },
  { k: 'кто держит порт', v: 'главный процесс; копии получают от него уже принятые соединения' },
  { k: 'канал с главным', v: 'тот же IPC, что у `fork`, и тоже **JSON** по умолчанию: `Map` и `Date` теряются молча', tone: 'warn' },
  { k: 'копия упала', v: 'главный процесс получает событие `exit`; новую копию запускают сами: `cluster.on(\'exit\', () => cluster.fork())`' },
  { k: 'общее состояние', v: '**нет**: сессии в памяти, счётчики и кеш у каждой копии свои; общее выносят в Redis или базу', tone: 'warn' },
];

export const CLUSTER_NOTE =
  'Отсюда правило выбора. Сервер не справляется с числом соединений — это `cluster` или несколько контейнеров за балансировщиком, что делает то же самое снаружи. В Kubernetes обычно выбирают второе: одна копия на контейнер, а раздаёт запросы сервис. Один запрос долго считает и держит цикл событий — это воркер: процесс один, а расчёт уходит в отдельный поток. `cluster` такой запрос не ускорит: он считает в одной копии так же долго и так же держит её цикл.';

export const CLOSING =
  '**Процесс разделяет память, воркер разделяет процесс, а объекты не разделяет никто.** Отсюда всё остальное: воркер стартует быстрее и падает отдельно от процесса, дочерний процесс может быть любой программой, `cluster` раздаёт соединения, а не запросы. И в любом канале данные копируются — вопрос только в том, что при этом теряется молча.';

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

/** Пункты 01 и 02 исполняются тестом. */
export const ONCE_TRAP_CODE = `import { Worker } from 'node:worker_threads';
import { once } from 'node:events';

const w = new Worker(\`throw new Error('x')\`, { eval: true });
await once(w, 'exit');   // отклонён: once поймал событие error раньше exit`;

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: '`await once(worker, \'exit\')` бросает, если воркер упал',
    d: '`events.once` ждёт названное событие, но **отклоняется на любом событии `error`**, пришедшем раньше. Код после такого `await` не выполнится, а ошибка улетит выше. Ждать выхода упавшего воркера надо через `worker.on(\'exit\', …)`.',
    code: ONCE_TRAP_CODE,
    tone: 'err',
  },
  {
    n: '02',
    t: '`exec` обрезает вывод на 1 МБ',
    d: 'Колбэк получает ошибку `ERR_CHILD_PROCESS_STDIO_MAXBUFFER`, а программа завершается. Но в `stdout` при этом лежит ровно 1 048 576 байт, и код, который не смотрит на ошибку, разбирает обрубок. Для большого вывода — `spawn` и чтение потоком, или опция `maxBuffer`.',
    tone: 'err',
  },
  {
    n: '03',
    t: 'Вывод разбирают в `close`, а не в `exit`',
    d: 'К моменту `exit` процесс уже завершился, но его вывод мог ещё не дочитаться из трубы. Разбор в `exit` иногда видит неполные данные — и тем реже, чем меньше вывод, поэтому на тестах всё работает.',
    tone: 'warn',
  },
  {
    n: '04',
    t: '`cluster` не раздаёт запросы по keep-alive',
    d: 'Клиент с одним долгим соединением — прокси, мобильное приложение, другой сервис — приходит к одной копии и остаётся у неё. При малом числе таких клиентов нагрузка ложится на одно ядро, а остальные простаивают.',
    tone: 'warn',
  },
];

// ─── Источники ─────────────────────────────────────────────────────────────────────────────

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'Node.js API — Worker threads',
    href: 'https://nodejs.org/api/worker_threads.html',
    what: '`workerData`, `parentPort`, события `error` и `exit`, `SHARE_ENV`, отличия `process` в воркере',
  },
  {
    title: 'Node.js API — Child process',
    href: 'https://nodejs.org/api/child_process.html',
    what: '`spawn`, `exec`, `execFile`, `fork`, `maxBuffer`, события `exit` и `close`, `serialization`',
  },
  {
    title: 'Node.js API — Cluster: How it works',
    href: 'https://nodejs.org/api/cluster.html#how-it-works',
    what: 'раздача соединений по кругу, `SCHED_RR` и Windows',
  },
  {
    title: 'Node.js API — events.once',
    href: 'https://nodejs.org/api/events.html#eventsonceemitter-name-options',
    what: 'промис отклоняется, если раньше пришло `error`',
  },
  {
    title: 'Node.js API — Process: signal events',
    href: 'https://nodejs.org/api/process.html#signal-events',
    what: '`SIGTERM`, `SIGINT`, `SIGKILL`; сигналы не доходят до воркеров',
  },
  {
    title: 'Node.js API — os.availableParallelism',
    href: 'https://nodejs.org/api/os.html#osavailableparallelism',
    what: 'сколько ядер реально доступно процессу — от этого считают число копий и воркеров',
  },
  {
    title: 'Piscina',
    href: 'https://github.com/piscinajs/piscina',
    what: 'пул воркеров для Node с очередью, отменой и ограничением памяти',
  },
];

export const RELATED =
  'Смежное на сайте: [Воркеры и параллелизм](/js/workers/) — агент, клонирование, передача владения и общая память; в Node всё это работает так же. [Цикл событий Node](/js/node-event-loop/) — фазы, пул libuv и момент, когда процесс выходит. [Память в Node](/js/node-memory/) — `rss`, куча и `resourceLimits` воркера. [MessageChannel](/js/message-channel/) — порты между воркерами и `receiveMessageOnPort`. [Безопасность бэкенда, раздел «Инъекции: SQL, HTML и командная строка»](/platform/backend-security/#s3) — почему `exec` со строкой опасен. [Docker, раздел «Запуск: первый процесс и сигналы»](/delivery/docker/#s6) — `SIGTERM` и PID 1. [Балансировка нагрузки](/delivery/load-balancing/) — то, что `cluster` делает внутри одной машины, только снаружи.';
