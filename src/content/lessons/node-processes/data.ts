import type { ConceptDiagramData } from '@/shared/ui/concept-diagram';
import type { GlossaryTerm, Pitfall, Prereq, Source } from '@/entities/lesson';

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
 *   — `cluster.schedulingPolicy` на macOS — `SCHED_RR`; записанный порядок A B A B,
 *     но строгое чередование не обещано API (проверяется записанный стенд),
 *     а шесть запросов по одному keep-alive соединению уходят одному процессу (2 прогона из 2);
 *   — брошенная ошибка и отклонённый промис в воркере: событие `error`, затем `exit` с кодом 1;
 *     `process.exit(3)` — только `exit` с кодом 3;
 *   — `events.once(worker, 'exit')` **отклоняется**, если раньше пришло `error`;
 *   — `process.chdir` в воркере — `ERR_WORKER_UNSUPPORTED_OPERATION`;
 *   — `exec` с выводом 2 МБ — `ERR_CHILD_PROCESS_STDIO_MAXBUFFER`, вывод обрезан до 1 048 576;
 *   — `spawn` несуществующей программы без обработчика `error` роняет процесс (код 1);
 *   — первый пример сообщает сбой родителю даже при exit без error/ответа; fork наследует
 *     stdio, silent:true создаёт pipe; spawn собирает вывод без ожидания фиксированных кусков;
 *   — `fork` с JSON-каналом: `Date` приезжает строкой, `Map` — `{}`; с `advanced` — оба целы.
 */

// ─── Вводный раздел ────────────────────────────────────────────────────────────────────────

export const GLOSSARY: GlossaryTerm[] = [
  {
    k: 'процесс',
    d: 'Запущенная программа с отдельным адресным пространством и своим номером `pid`. Обычная ссылка на JS-объект одного процесса не позволяет прочитать его из другого.',
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
    d: 'Статус, с которым процесс завершается: обычно 0 означает успех, ненулевое значение — ошибку или иной исход по протоколу программы. Если процесс убит сигналом, кода нет, вместо него — имя сигнала.',
  },
  {
    k: 'сигнал',
    d: 'Короткое уведомление процессу от операционной системы: `SIGTERM` — «завершись», `SIGKILL` — «умри немедленно», `SIGINT` — Ctrl+C в терминале.',
  },
];

export const PLAIN_PROCESS = "Процесс имеет своё адресное пространство: обычный JS-объект соседнего процесса нельзя прочитать по ссылке. Потоки находятся внутри одного процесса, но Node создаёт каждому JS-воркеру отдельный экземпляр V8 со своей кучей. Поэтому переменные модуля не становятся общими. Обычно данные отправляют сообщениями; общий участок памяти создают явно, через `SharedArrayBuffer`. Это исключение из изоляции куч, а не общие JS-объекты.";

export const PREREQ_NOTE =
  'Тема опирается на три вещи из соседних тем.';

export const PREREQ: Prereq[] = [
  {
    t: 'Цикл событий Node',
    d: 'Один поток выполняет колбэки по одному. Пока колбэк считает, ни один запрос, таймер или ответ сети не будет обработан.',
    href: '/js/node-event-loop/#s1',
    hrefLabel: '«Цикл событий Node», раздел «Оборот цикла — это функция uv_run»',
    tone: 'info',
  },
  {
    t: 'Агент и его изоляция',
    d: 'У воркера своя JS-куча и свой цикл событий. Обычные объекты клонируются; буферы можно передавать, общие байты — разделять явно.',
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
  workerData: { from: 1, to: 10_000_000 },
});
let received = false;
worker.once('message', (sum) => {
  received = true;
  console.log('сумма:', sum);
});
worker.on('error', (error) => {
  console.error('воркер упал:', error.message);
  process.exitCode = 1; // ошибка задачи должна быть видна запускающей программе
});
worker.once('exit', (code) => {
  console.log('воркер вышел с кодом', code);
  if (code !== 0 || !received) process.exitCode = 1;
});

console.log('главный поток свободен');`;

export const FIRST_WORKER_CODE = `// sum.mjs
import { workerData, parentPort } from 'node:worker_threads';

let sum = 0;
for (let i = workerData.from; i <= workerData.to; i++) sum += i;

parentPort.postMessage(sum);`;

export const FIRST_OUT = `главный поток свободен
сумма: 50000005000000
воркер вышел с кодом 0`;

export const FIRST_NOTE = "Сохраните оба файла рядом и выполните `node main.mjs`. `new Worker` запускает модуль, не дожидаясь расчёта: главный поток сразу выполняет следующую строку и затем может обрабатывать другие события. `workerData` передаёт стартовые данные копией, `parentPort` отправляет ответ. Полученный ответ и успешный выход — разные события: пример считает задачу успешной, только если ответ пришёл и воркер завершился с кодом 0. Сложение здесь показывает протокол одной задачи, а не доказывает ускорение: запуск воркера и обмен тоже имеют цену.";

export const PLAIN_FOUR =
  'Работу из главного потока Node можно убрать четырьмя способами. Они различаются тем, что делят с главным потоком. Пул libuv — служебные потоки самого Node: туда уходят файлы, хеши и сжатие, ваш JS там не выполняется. Воркер — ваш JS в другом потоке того же процесса. Дочерний процесс — любая программа рядом, хоть `ffmpeg`, хоть ещё один `node`. `cluster` — несколько копий вашего сервера, которые слушают один порт.';

export const FOUR_WAYS = {
  head: ['', 'пул libuv', '`worker_threads`', '`child_process`', '`cluster`'],
  cols: 'minmax(130px,.8fr) minmax(150px,1fr) minmax(170px,1fr) minmax(170px,1fr) minmax(170px,1fr)',
  kinds: ['prose', 'prose', 'prose', 'prose', 'prose'] as ('mono' | 'prose' | 'muted' | 'ok' | 'warn')[],
  minWidth: 820,
  rows: [
    ['что выполняет', 'C++ внутри Node: `fs`, `crypto`, `zlib`, `dns.lookup`', 'ваш JS-модуль', 'любую программу', 'копию вашего приложения'],
    ['`process.pid`', 'тот же', 'тот же', 'свой', 'свой'],
    ['память', 'общая, но ваш код её не видит', 'своя куча; общие байты — через `SharedArrayBuffer`', 'своя целиком', 'своя целиком'],
    ['канал', 'колбэк или промис API', '`postMessage`, structured clone', 'stdin/stdout; у `fork` — ещё IPC', 'IPC, по умолчанию **JSON**'],
    ['создание', 'пулом управляет Node', 'новый поток и экземпляр V8', 'новый процесс программы', 'новый Node-процесс через fork'],
    ['зачем', 'ввод-вывод без блокировки цикла — сам, без вашего участия', 'тяжёлый расчёт на JS, не останавливая цикл', 'запустить внешнюю программу с отдельной памятью', 'раздать соединения одного порта по ядрам'],
  ],
};

export const FOUR_WAYS_NOTE = "Пул libuv Node использует для определённых операций API, а не для произвольного JS. Его очереди разобраны в [«Цикле событий Node», раздел «Пул потоков»](/js/node-event-loop/#s6). Создание воркера или процесса требует времени и памяти: на старом стенде Node 26.8.2 старт воркера до первого сообщения занял около 15 мс, а запуск дочернего Node до выхода — около 34 мс. Это разные операции, не универсальное сравнение скорости. Для частых задач воркеры обычно переиспользуют. Дочерний процесс сам по себе не песочница: без дополнительных ограничений у него остаются права запустившего пользователя.";

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

export const ERRORS_NOTE = "Брошенная ошибка приходит родителю событием `error`, затем воркер завершается с кодом 1. Если родитель обработал `error`, он может продолжить работу. Необработанный отказ промиса в показанном режиме Node тоже завершает воркер; поведение зависит от настроек обработки отказов и установленных обработчиков. `process.exit(3)` даёт только `exit` с кодом 3: это отдельный повод проверить результат задачи. В браузерном воркере необработанный отказ промиса сам по себе воркер не завершает. Ошибки всего процесса, например общее исчерпание памяти или сбой нативного кода, этой изоляцией не покрываются.";

export const WORKER_FACTS: { t: string; d: string; tone?: 'ok' | 'warn' }[] = [
  {
    t: 'Воркер заводят заранее',
    d: 'Каждому воркеру нужны поток, собственный V8 и память. Для коротких частых задач создание может оказаться дороже расчёта, поэтому воркеры переиспользуют. Встроенного пула задач в Node нет: его пишут сами или берут библиотеку. Правила пула — те же, что в браузере, и разобраны в [«Воркерах», раздел «Пул воркеров: сколько заводить»](/js/workers/#s5).',
    tone: 'warn',
  },
  {
    t: '`Atomics.wait` в главном потоке разрешён',
    d: 'В браузере главный поток ждать на общей памяти не может — `TypeError`: он рисует страницу. В Node запрета нет: главный поток сервера можно усыпить на `Atomics.wait`, и вместе с ним уснут все запросы. Как устроены `wait`, `notify` и общая память — в [«Общая память и Atomics», раздел «Ждать и будить»](/js/atomics/#s5).',
  },
  {
    t: 'Лимит движка не равен лимиту процесса',
    d: 'Опция `resourceLimits` ограничивает ресурсы JS-движка воркера, но не память `ArrayBuffer` и не весь `rss`. Достижение такого лимита завершает воркер; общее исчерпание памяти может завершить весь процесс. Числа и связь с лимитом контейнера — в [«Памяти в Node», раздел «Лимиты и контейнеры»](/js/node-memory/#s4).',
    tone: 'ok',
  },
  {
    t: 'Порты и синхронное чтение',
    d: 'Кроме `parentPort` воркеру можно отдать любой `MessagePort`, а `receiveMessageOnPort` читает сообщение синхронно, без цикла событий, — этого в браузере нет. Разобрано в [«MessageChannel», раздел «Применение»](/js/message-channel/#s3).',
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
  'Буфер можно не копировать, а **передать** воркеру списком переноса: `postMessage(msg, [buf])`. Тогда у отправителя он становится пустым — как это устроено, разобрано в [«Воркерах», раздел «Передача владения»](/js/workers/#s3). В Node бывает и обратная задача: буфер, который передавать **нельзя**, потому что им пользуется кто-то ещё. Главный пример — сам `Buffer`. Маленькие буферы (`Buffer.from`, `Buffer.allocUnsafe`) Node нарезает из одного большого блока памяти — пула. Поэтому у трёхбайтного `chunk` поле `chunk.buffer` — весь пул, а не три байта (первая строка вывода). Если бы такой буфер можно было передать, память пропала бы у всех буферов, нарезанных из того же пула. Чтобы этого не случилось, Node помечает пул функцией `markAsUntransferable` (вторая строка). Попытка передать помеченный буфер бросает `DataCloneError`, и буфер остаётся у владельца. Копией такой буфер уходит как обычно (последняя строка). Той же функцией можно пометить и свой буфер — например, рабочий, который переиспользуется от сообщения к сообщению. `Buffer.alloc` пул не использует, и его буфер передаётся без ограничений. В браузере такой функции нет.';

// ─── Раздел 3. child_process ───────────────────────────────────────────────────────────────

export const CP_FUNCS = {
  head: ['функция', 'оболочка', 'вывод', 'канал сообщений', 'когда'],
  cols: 'minmax(110px,.6fr) minmax(110px,.6fr) minmax(170px,1fr) minmax(130px,.7fr) minmax(220px,1.3fr)',
  kinds: ['mono', 'prose', 'prose', 'prose', 'prose'] as ('mono' | 'prose' | 'muted' | 'ok' | 'warn')[],
  minWidth: 760,
  rows: [
    ['spawn', 'нет', 'потоки stdout/stderr по умолчанию', 'нет по умолчанию', 'долгая программа или большой вывод'],
    ['execFile', 'нет', 'буфер для колбэка; лимит maxBuffer', 'нет по умолчанию', 'короткая команда с аргументами'],
    ['exec', '**да**: командная оболочка', 'буфер для колбэка; лимит maxBuffer', 'нет по умолчанию', 'нужны возможности оболочки: `|`, `*`, `&&`'],
    ['fork', 'нет', 'наследует вывод; silent: true даёт потоки', '**да**: `send` и событие `message`', 'дочерний процесс на Node, с которым надо переписываться'],
  ],
};

export const CP_FUNCS_NOTE = "Таблица описывает настройки по умолчанию. `exec` использует `/bin/sh` на Unix и системную оболочку на Windows. `exec` и `execFile` собирают вывод для колбэка: `maxBuffer` по умолчанию равен 1 048 576 байтам отдельно для stdout и stderr; их потоки тоже доступны. `fork` наследует стандартные потоки родителя, если не задать `silent: true` или `stdio`. Строка `exec` интерпретируется оболочкой: пользовательский ввод в ней может стать командой. Разбор — в [«Безопасности бэкенда», раздел «Инъекции»](/platform/backend-security/#s3).";

/** ⚠️ Исполняется тестом: вывод сверяется с `SPAWN_OUT`. */
export const SPAWN_CODE = `import { spawn } from 'node:child_process';

const child = spawn(process.execPath, ['-e', \`
  process.stdout.write('раз');
  process.stdout.write('два');
\`], { stdio: ['ignore', 'pipe', 'pipe'] });

let output = '';
child.stdout.setEncoding('utf8'); // сохраняет символ между разрезанными кусками
child.stdout.on('data', (chunk) => { output += chunk; });
child.stderr.pipe(process.stderr); // stderr тоже нужно читать, чтобы труба не заполнилась
child.on('error', (error) => {
  console.error('не удалось запустить:', error.code);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => console.log('exit:', code, signal));
child.on('close', (code, signal) => {
  console.log('вывод:', output);
  console.log('close:', code, signal);
  if (code !== 0 || signal !== null) process.exitCode = 1;
});`;

export const SPAWN_OUT = ['exit: 0 null', 'вывод: раздва', 'close: 0 null'];

export const SPAWN_NOTE = "Два `write` не обещают два события `data`: границы кусков определяет поток. Этот короткий пример собирает вывод сам, поэтому печатает его только после `close`. Для большого вывода вместо накопления строки подключают обработку по частям или записывают поток в файл. `exit` сообщает о завершении процесса, когда его вывод ещё может дочитываться. `close` означает, что закрылись и стандартные потоки; при ошибке запуска он приходит после `error`, а `exit` может вообще не прийти. Если процесс завершён сигналом, `code` равен `null`, а `signal` содержит его имя.";

export const CP_FACTS: { t: string; d: string; tone?: 'ok' | 'warn' }[] = [
  {
    t: 'Ненулевой код выхода не бросает исключение',
    d: 'Для `spawn` упавшая программа — это обычное событие `exit` с кодом 1, и проверять код нужно самому. `exec` и `execFile` в этом случае передают в колбэк ошибку, у которой `err.code` — тот же код выхода.',
  },
  {
    t: 'Если программы нет, ошибка приходит событием',
    d: '`spawn(\'no-such-bin\')` не бросает исключение и возвращает обычный объект; ошибка `ENOENT` приходит позже событием `error`. Без обработчика `error` это необработанная ошибка, и падает **весь** родительский процесс.',
    tone: 'warn',
  },
  {
    t: 'На Unix SIGTERM можно перехватить, SIGKILL — нет',
    d: 'На Unix `child.kill()` шлёт `SIGTERM`, и программа может его перехватить и завершиться аккуратно — или проигнорировать. Безусловно убивает только `SIGKILL`. Как Node-приложению правильно обработать `SIGTERM` в контейнере — в [Docker, раздел «Запуск: первый процесс и сигналы»](/delivery/docker/#s6).',
  },
];

/**
 * ⚠️ Исполняется тестом: тест кладёт `FORK_CHILD_CODE` рядом в `echo.cjs` и сверяет вывод
 * с `FORK_OUT`.
 */
export const FORK_CODE = `// parent.mjs
import { fork } from 'node:child_process';

function echo(serialization, value) {
  return new Promise((resolve, reject) => {
    const child = fork(new URL('./echo.cjs', import.meta.url), { serialization });
    let received = false;
    let back;
    let failure;
    child.on('error', (error) => {
      if (child.pid === undefined) reject(error); // программа не запустилась
      else { failure = error; child.kill(); }
    });
    child.once('message', (message) => {
      received = true;
      back = message;
      if (child.connected) child.disconnect();
    });
    child.once('exit', (code, signal) => {
      if (failure) reject(failure);
      else if (code !== 0 || signal || !received) reject(new Error('Дочерний процесс не вернул ответ'));
      else resolve(back);
    });
    try {
      child.send(value, (error) => {
        if (error) { failure = error; child.kill(); }
      });
    } catch (error) {
      failure = error;
      child.kill();
    }
  });
}

for (const serialization of ['json', 'advanced']) {
  const back = await echo(serialization, { when: new Date(0), tags: new Map([['a', 1]]) });
  console.log(serialization, typeof back.when, back.tags instanceof Map);
}`;

export const FORK_CHILD_CODE = `// echo.cjs
process.on('message', (msg) => process.send(msg));`;

export const FORK_OUT = ['json string false', 'advanced object true'];

export const FORK_NOTE = "По умолчанию IPC использует JSON: `Date` становится строкой, а содержимое `Map` превращается в `{}` без ошибки. Режим `advanced` использует сериализацию V8 на основе structured clone и сохраняет эти встроенные типы. Но это не общий буфер памяти и не полный аналог канала воркера: `SharedArrayBuffer` в `advanced` не клонируется, а в JSON превращается в `{}`. `child_process.fork` запускает новый Node-процесс, а не копирует текущую JS-кучу. Функция `echo` ждёт ответ и завершение процесса: выход без ответа — ошибка, а закрытие IPC позволяет `echo.cjs` завершиться. Срок ожидания для зависшей программы здесь не задан; в приложении его задаёт владелец задачи, с обработкой завершения процесса.";

// ─── Раздел 4. cluster ─────────────────────────────────────────────────────────────────────

export const PLAIN_CLUSTER = 'Другой режим — `SCHED_NONE`: главный процесс создаёт слушающий сокет, а копии сами принимают соединения. Политику задают до создания копий. Значение по умолчанию зависит от платформы: вне Windows это `SCHED_RR`. Ни одна политика не объединяет сессии, счётчики и кеши разных процессов.';

/**
 * ⚠️ Исполняется тестом: вывод сверяется с `CLUSTER_RR_OUT`. `listen(0)` в процессах-копиях
 * даёт всем **один** случайный порт — тест не занимает фиксированный.
 */
export const CLUSTER_RR_CODE = `const cluster = require('node:cluster');
const http = require('node:http');

if (cluster.isPrimary) {
  cluster.schedulingPolicy = cluster.SCHED_RR; // до создания копий
  cluster.fork();
  cluster.fork();
  let ready = 0;
  cluster.on('listening', async (worker, { port }) => {
    if (++ready < 2) return;                      // ждём обе копии
    try {
      for (const keepAlive of [false, true]) {
        const agent = new http.Agent({ keepAlive, maxSockets: 1 });
        const pids = [];
        try {
          for (let i = 0; i < 6; i++) pids.push(await get(port, agent));
          console.log(keepAlive ? 'одно соединение:' : 'новые соединения:',
            pids.map((pid) => (pid === pids[0] ? 'A' : 'B')).join(' '));
        } finally { agent.destroy(); }
      }
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    } finally {
      cluster.disconnect(); // закрыть серверы и IPC после завершения запросов
    }
  });
} else {
  http.createServer((req, res) => res.end(String(process.pid))).listen(0);
}

function get(port, agent) {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: '127.0.0.1', port, agent }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve(body));
      res.on('error', reject);
    });
    request.on('error', reject);
  });
}`;

export const CLUSTER_RR_OUT = ['новые соединения: A B A B A B', 'одно соединение: A A A A A A'];

export const CLUSTER_RR_NOTE = "Это записанный порядок на Node 26.8.2/macOS: для новых соединений получились A/B, а все запросы по одному keep-alive соединению обслужила одна копия. В исходнике явно выбран `SCHED_RR`; обычно эта политика включена по умолчанию вне Windows. Она распределяет соединения с учётом доступности копий, поэтому строгое чередование A/B не является гарантией. Существенный результат — отсутствие новой балансировки каждого запроса внутри уже открытого соединения. Разница с балансировкой HTTP-запросов разобрана в [«Балансировке нагрузки», раздел «Соединения или запросы: L4 и L7»](/delivery/load-balancing/#s1).";

export const CLUSTER_ROWS: { k: string; v: string; tone?: 'ok' | 'warn' }[] = [
  { k: 'что создаётся', v: 'копия всего приложения: `cluster.fork()` — это `child_process.fork` того же файла' },
  { k: 'кто держит порт', v: 'при SCHED_RR главный принимает соединения и передаёт копиям; при SCHED_NONE копии принимают их сами' },
  { k: 'канал с главным', v: 'тот же IPC, что у `fork`, и тоже **JSON** по умолчанию: `Map` и `Date` теряются молча', tone: 'warn' },
  { k: 'копия упала', v: 'главный получает exit; перезапуск организует приложение. Нужно отличать сбой от планового завершения и ограничивать частоту перезапусков' },
  { k: 'общее состояние', v: '**нет**: сессии в памяти, счётчики и кеш у каждой копии свои; общее выносят в Redis или базу', tone: 'warn' },
];

export const CLUSTER_NOTE = "Если один запрос долго считает на JS, воркер может вынести расчёт из цикла событий. `cluster` не ускоряет этот расчёт, но позволяет разным копиям обслуживать другие соединения. Если нужна пропускная способность нескольких серверных процессов, выбирают `cluster` либо несколько экземпляров за внешним балансировщиком. Внешняя раздача тоже имеет уровень: маршрутизация TCP-соединений не означает распределение каждого HTTP-запроса. Общие сессии и состояние в обоих случаях хранят отдельно от памяти конкретной копии.";

export const CLOSING = "**Место выполнения и способ обмена выбирают отдельно.** Воркер выполняет JS в другом потоке и может клонировать данные, передавать буферы или разделять общие байты. Дочерний процесс запускает отдельную программу; его IPC не даёт общей JS-памяти. `cluster` создаёт такие процессы и помогает распределять соединения. Успех задачи подтверждает её протокол ответа, а ошибки и выход нужно обработать у владельца задачи.";

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
    t: 'Буфер exec ограничен, и его переполнение — ошибка',
    d: 'Колбэк получает ошибку `ERR_CHILD_PROCESS_STDIO_MAXBUFFER`, а программа завершается. Но в `stdout` в показанной ASCII-пробе лежит 1 048 576 байт, и код, который не смотрит на ошибку, разбирает обрубок. Для большого вывода — `spawn` и чтение потоком, или опция `maxBuffer`.',
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

export const SOURCES: Source[] = [
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
  'Смежное на сайте: [Воркеры и параллелизм](/js/workers/) — агент, клонирование, передача владения и общая память; в Node всё это работает так же. [Копирование и сериализация](/js/serialization/) — JSON, structured clone и потеря типов. [Цикл событий Node](/js/node-event-loop/) — фазы, пул libuv и момент, когда процесс выходит. [Память в Node](/js/node-memory/) — `rss`, куча и `resourceLimits` воркера. [MessageChannel](/js/message-channel/) — порты между воркерами и `receiveMessageOnPort`. [Безопасность бэкенда, раздел «Инъекции: SQL, HTML и командная строка»](/platform/backend-security/#s3) — почему `exec` со строкой опасен. [Docker, раздел «Запуск: первый процесс и сигналы»](/delivery/docker/#s6) — `SIGTERM` и PID 1. [Балансировка нагрузки](/delivery/load-balancing/) — то, что `cluster` делает внутри одной машины, только снаружи.';


/** Учебная схема CLUSTER_RR_CODE: тип маршрутизации, не прогноз порядка A/B. */
export const CLUSTER_CONNECTION_DIAGRAM: ConceptDiagramData = {
  id: 'cluster-connections',
  title: 'Новое соединение выбирает копию; запрос внутри него — уже нет',
  description: 'Механика SCHED_RR. Главный процесс принимает новое TCP-соединение и передаёт его одной копии. Запросы по уже открытому keep-alive соединению обслуживает владелец его сокета.',
  width: 900,
  height: 650,
  nodes: [
    { id: 'new', x: 25, y: 40, width: 240, height: 110, label: 'Клиент открывает TCP', detail: 'Каждое новое соединение', tone: 'info' },
    { id: 'primary', x: 355, y: 40, width: 240, height: 110, label: 'Главный процесс', detail: 'Выбирает доступную копию', tone: 'neutral' },
    { id: 'a', x: 685, y: 40, width: 190, height: 110, label: 'Копия A', detail: 'Свой процесс и куча', tone: 'ok' },
    { id: 'b', x: 685, y: 290, width: 190, height: 110, label: 'Копия B', detail: 'Свой процесс и куча', tone: 'ok' },
    { id: 'keepalive', x: 25, y: 500, width: 240, height: 110, label: 'Клиент сохраняет TCP', detail: 'Следующие HTTP-запросы', tone: 'info' },
    { id: 'socket', x: 355, y: 500, width: 240, height: 110, label: 'Открытое соединение', detail: 'Сокет уже у копии B', tone: 'neutral' },
  ],
  edges: [
    { from: 'new', to: 'primary', fromSide: 'right', toSide: 'left' },
    { from: 'primary', to: 'a', fromSide: 'right', toSide: 'left' },
    { from: 'primary', to: 'b', fromSide: 'bottom', toSide: 'left', via: [[475, 345]], label: 'одна из копий', labelX: 475, labelY: 250 },
    { from: 'keepalive', to: 'socket', fromSide: 'right', toSide: 'left' },
    { from: 'socket', to: 'b', fromSide: 'right', toSide: 'bottom', via: [[780, 555]], label: 'минуя главный', labelX: 730, labelY: 470 },
  ],
  note: 'A и B обозначают процессы, как в выводе примера. Владелец keep-alive выбран для иллюстрации: главное, что все запросы этого соединения остаются у него. Чередование новых соединений не обязано быть строго A/B.',
};
