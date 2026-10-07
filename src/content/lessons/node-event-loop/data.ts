import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { LoopScenario, PoolStand } from '@/widgets/libuv-lab/model/types';

/**
 * Данные темы «Цикл событий Node: фазы libuv».
 *
 * Тема написана здесь, 2026-10-01. Общий принцип цикла и фазы Node одним списком уже разобраны
 * в «Event Loop» (раздел «Node»: CommonJS против ESM, гонка `setTimeout`/`setImmediate`, Node 11,
 * пять хешей на четыре потока, слив `nextTick`). Здесь — на шаг глубже: что делает `uv_run`
 * по строкам исходника, где именно Node вклинивает свои очереди, сколько спит poll, что идёт
 * в пул и когда процесс выходит.
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * Node **24.11.0** (V8 13.6, libuv **1.51.0**), macOS arm64; для сверки — Node 26.8.2
 * (Homebrew): все детерминированные сценарии дали тот же вывод. Октябрь 2026. Каталог стенда —
 * `scratchpad/agent-nodeloop/` (`run.mjs`, `poolrun.mjs`, `sc/*.js`), порты 51001–51003.
 * Таймерных замеров нет: снимается **порядок строк вывода**, и каждый прогон — отдельный
 * процесс `node file.cjs` (CommonJS). Частоты в `LOOP_SCENARIOS[].real` — сколько раз из `runs`
 * отдельных запусков вышел каждый порядок; это не бенчмарк, они зависят от загрузки машины
 * (тот же сценарий `race` дал 196/4, 282/18 и 293/7 в трёх сериях; в `real` — последняя,
 * снятая скриптом `stand.mts` прямо из строк этого файла). Тест проверяет не частоты,
 * а то, что каждый встреченный порядок входит в множество допустимых по модели.
 *
 * Что снято и чем:
 *   — `LOOP_SCENARIOS` — код сценария + `LOOP_PRELUDE` склеиваются в файл и запускаются
 *     в отдельном процессе (`tests/unit/node-event-loop.test.ts` делает это заново);
 *   — `TIMER_ROWS` — `setTimeout(f, d)._idleTimeout` и имя предупреждения в stderr;
 *   — `POOL_PROBE_OUT` — сценарий `POOL_PROBE_CODE` при `UV_THREADPOOL_SIZE=1`, 5 прогонов из 5;
 *   — `POOL_STAND` — `POOL_ORDER_SCENE` при размерах пула 1, 2, 4, 5, по 8 прогонов;
 *     `process.env.UV_THREADPOOL_SIZE = '5'` в первой строке скрипта (и CJS, и ESM) работает,
 *     а выставленное после первой задачи пула — нет (размер остался 4, 3 прогона из 3);
 *   — `ALIVE_OUT` — `process.getActiveResourcesInfo()` до и после `unref()`, события
 *     `beforeExit` и `exit`;
 *   — `IDLE_OUT` — `performance.eventLoopUtilization()`: простой цикла (время сна в poll)
 *     за 200 мс ожидания таймера и за 200 мс «насоса» из `setImmediate`. Тест сверяет отношение
 *     (простой > 90 % против < 10 %), а не миллисекунды.
 *
 * Исходники, прочитанные для текста (не запуск):
 *   — libuv 1.51.0 `src/unix/core.c` — `uv_run`, `uv__backend_timeout`, `uv__loop_alive`
 *     (дословный порядок фаз и правило таймаута poll в `UV_RUN_SHAPE`, `POLL_RULES`);
 *     `src/timer.c` — `uv__next_timeout`; `src/threadpool.c` — `UV_THREADPOOL_SIZE`, предел
 *     1024 и правило «медленного ввода-вывода»: `getaddrinfo` (`dns.lookup`) занимает не больше
 *     `(n + 1) / 2` потоков пула. ⚠️ Это правило в теме **только по исходнику**, запуском
 *     не проверено;
 *   — Node 24.11 `lib/internal/timers.js` (`processImmediate`, `processTimers`, `insert`,
 *     конструктор `Timeout`), `lib/internal/process/task_queues.js` (`runNextTicks`) —
 *     прочитаны из самого бинарника: `node --expose-internals -e "…toString()"`;
 *   — то, что Node держит idle-хендл, пока есть `setImmediate`, и потому poll не спит, —
 *     по исходнику Node (`src/env.cc`, `ToggleImmediateRef`) и документации; запуском видно
 *     только следствие (`IDLE_OUT`: простой 0 мс при насосе).
 *
 * Только по документации, без запуска: `dns.resolve*` идёт через c-ares мимо пула, `fs.watch`
 * не в пуле (строки `POOL_ROWS`); idle-хендл для `setImmediate`. Запуском на стенде, но не тестом:
 * ESM-скрипт с вечным `await` верхнего уровня выходит с кодом 13 и предупреждением (тест
 * проверяет только CommonJS — код 0).
 *
 * Учебная модель `LOOP_CODE` исполняется виджетом `libuv-lab` и тестом: на каждом сценарии
 * модель прогоняется с `slack = 0` и `slack = 1`; детерминированный сценарий обязан дать
 * одинаковый вывод при обоих и совпасть с настоящим Node, недетерминированный — дать два
 * разных, и любой вывод Node обязан быть одним из них. `POOL_CODE` сверяется с позицией
 * `fs.stat` в настоящих прогонах.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'libuv',
    d: 'Библиотека на C, на которой стоит Node. Она даёт циклу событий таймеры, сокеты, файлы и пул потоков — одинаково на Linux, macOS и Windows. Сам JS про неё ничего не знает: её колбэки зовёт Node.',
  },
  {
    k: 'фаза',
    d: 'Шаг оборота цикла, у которого своя очередь колбэков: таймеры, ввод-вывод, `setImmediate`, закрытия. Фазы идут по кругу всегда в одном порядке.',
  },
  {
    k: 'handle (хендл)',
    d: 'Долгоживущий объект libuv: таймер, сервер, сокет. Пока активный хендл есть и он «держит» цикл (ref), процесс не завершится.',
  },
  {
    k: 'request (запрос)',
    d: 'Разовая операция libuv: чтение файла, поиск адреса, запись в сокет. Живёт, пока не придёт ответ, и всё это время тоже держит процесс.',
  },
  {
    k: 'poll',
    d: 'Фаза, в которой цикл спрашивает операционную систему, что готово, и при необходимости засыпает. На macOS это вызов `kevent`, на Linux — `epoll_wait`.',
  },
  {
    k: 'пул потоков',
    d: 'Несколько служебных потоков libuv — по умолчанию четыре. В них уходит работа, которую ОС не умеет делать «по готовности»: файлы, поиск адреса по имени, хеши, сжатие.',
  },
  {
    k: '`process.nextTick`',
    d: 'Очередь Node, которая выполняется сразу после текущего колбэка — раньше промисов. Это не фаза цикла: в libuv её нет.',
  },
  {
    k: 'микрозадача',
    d: 'Реакция промиса или функция из `queueMicrotask`. Очередь живёт в движке V8; Node просит выполнить её после каждого колбэка.',
  },
];

export const PLAIN_LOOP =
  'Представьте вахтёра, который обходит здание по одному и тому же маршруту: почтовый ящик с будильниками, дежурный телефон, лоток «сделать сразу после обхода», корзина с ключами от закрытых комнат. У каждой точки он делает всё, что там лежит, и идёт дальше. Если делать нечего, он садится у телефона и ждёт звонка — но не дольше, чем до ближайшего будильника. Это и есть цикл libuv: точки — фазы, телефон — фаза poll.';

export const PREREQ_NOTE =
  'Тема продолжает «Event Loop» и опирается на три вещи оттуда.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'Задача и оборот цикла',
    d: 'Один поток выполняет одну задачу до конца, потом берёт следующую. Перебить начатую задачу нельзя.',
    href: '/js/event-loop/#s1',
    hrefLabel: '«Event Loop», раздел «Оборот»',
    tone: 'info',
  },
  {
    t: 'Микрозадачи',
    d: 'Реакции промисов ждут, пока опустеет стек, и тогда выполняются все разом — включая добавленные по ходу.',
    href: '/js/event-loop/#s3',
    hrefLabel: '«Event Loop», раздел «Checkpoint»',
    tone: 'info',
  },
  {
    t: 'Фазы Node одним списком',
    d: 'timers → pending → idle/prepare → poll → check → close, и то, что CommonJS и ESM печатают `nextTick` и промис в разном порядке. Здесь все примеры — CommonJS.',
    href: '/js/event-loop/#s5',
    hrefLabel: '«Event Loop», раздел «Node»',
    tone: 'info',
  },
];

// ─── Раздел 1. Оборот uv_run ───────────────────────────────────────────────────────────────

/**
 * Скелет `uv_run` из libuv 1.51.0 (`src/unix/core.c`), сокращённый: убраны метрики, флаг
 * остановки и режимы, кроме `UV_RUN_DEFAULT`, которым Node крутит цикл. Порядок вызовов —
 * дословный. Это не исполняемый код (C), поэтому тест его не исполняет; сверено чтением
 * исходника по тегу v1.51.0.
 */
export const UV_RUN_SHAPE = `// libuv 1.51.0, src/unix/core.c — сокращено
int uv_run(uv_loop_t* loop, uv_run_mode mode) {
  int r = uv__loop_alive(loop);
  if (r) {
    uv__update_time(loop);
    uv__run_timers(loop);              // timers — до входа в круг
  }
  while (r != 0) {
    uv__run_pending(loop);             // pending callbacks
    uv__run_idle(loop);                // idle
    uv__run_prepare(loop);             // prepare
    int timeout = uv__backend_timeout(loop);
    uv__io_poll(loop, timeout);        // poll: ждать ввод-вывод
    uv__run_check(loop);               // check: setImmediate
    uv__run_closing_handles(loop);     // close callbacks
    uv__update_time(loop);
    uv__run_timers(loop);              // timers — в конце круга
    r = uv__loop_alive(loop);
  }
  return r;
}`;

export const UV_RUN_NOTE =
  'Таймеры стоят в коде дважды: один раз перед кругом и один раз в его конце. На деле это то же самое, что «в начале каждого оборота», — так их и рисуют на схемах. Важнее две строки вокруг: `uv__update_time` перед таймерами (цикл смотрит на часы **только здесь и после poll**) и `uv__loop_alive` в конце (круг идёт, пока процессу есть чего ждать).';

export const PHASE_ROWS: { phase: string; who: string; node: string; tone?: 'info' | 'ok' | 'warn' }[] = [
  {
    phase: 'timers',
    who: 'созревшие таймеры libuv',
    node: 'У Node **один** таймер libuv на все `setTimeout` и `setInterval`. Его колбэк — `processTimers` — сам перебирает созревшие таймеры JS по сроку.',
    tone: 'info',
  },
  {
    phase: 'pending callbacks',
    who: 'колбэки, отложенные с прошлого оборота',
    node: 'Из JS сюда ничего не поставить. libuv кладёт сюда, например, колбэк записи в сокет, который нельзя было вызвать сразу.',
  },
  {
    phase: 'idle, prepare',
    who: 'служебные хендлы',
    node: 'Node включает idle-хендл, пока есть хоть один `setImmediate`: сам хендл ничего не делает, но из-за него poll не засыпает.',
  },
  {
    phase: 'poll',
    who: 'готовый ввод-вывод: сокеты, ответы пула потоков',
    node: 'Колбэки `fs.*`, `net`, `dns.lookup`, `crypto.pbkdf2` выполняются здесь. Если ничего не готово, цикл спит.',
    tone: 'ok',
  },
  {
    phase: 'check',
    who: 'check-хендлы',
    node: 'Один check-хендл Node; его колбэк `processImmediate` выполняет очередь `setImmediate`.',
    tone: 'info',
  },
  {
    phase: 'close callbacks',
    who: 'колбэки закрытых хендлов',
    node: 'Здесь сокет, у которого вызвали `destroy()`, получает событие `\'close\'`.',
  },
];

export const PLAIN_TWO_QUEUES =
  'Вернёмся к вахтёру. У него в кармане два листка: «срочно» (`nextTick`) и «не забыть» (микрозадачи). После **каждого** дела — каждого будильника, звонка, пункта из лотка — он сначала выполняет весь листок «срочно», потом весь «не забыть», и только потом идёт к следующему делу. Листки — не точки маршрута: libuv о них не знает, их проверяет сам Node.';

// ─── Модель: сценарии и учебная функция ────────────────────────────────────────────────────

/**
 * Общая шапка сценариев. В настоящем Node она приклеивается перед кодом сценария
 * (файл `.cjs`), в модели те же имена подставляет `runLoop`.
 */
export const LOOP_PRELUDE = `const fs = require('node:fs');
const net = require('node:net');
const log = (s) => console.log(s);
// занять поток на ms миллисекунд: цикл ничего не может сделать, пока он крутится
const work = (ms) => { const end = performance.now() + ms; while (performance.now() < end); };`;

/**
 * Учебная модель одного процесса Node: фазы `uv_run` и две очереди Node между колбэками.
 *
 * Печатается на странице, исполняется виджетом `libuv-lab` и `tests/unit/node-event-loop.test.ts`.
 * Время виртуальное. `slack` — сколько миллисекунд уходит на сам оборот при каждом обновлении
 * часов перед таймерами: 0 — бесконечно быстрая машина, 1 — медленная.
 */
export const LOOP_CODE = `// Модель процесса Node: фазы libuv (uv_run) и две очереди Node между колбэками.
// Время виртуальное: оно идёт от work(ms) и от сна в фазе poll.
// slack — сколько мс теряется на сам оборот перед фазой timers: 0 — быстрая машина,
// 1 — медленная. Если вывод зависит от slack, Node этот порядок не обещает.
function runLoop(source, slack = 0) {
  const IO_MS = 0.5;          // через сколько готов ответ пула или сокета
  let now = 0;                // часы процесса
  let loopTime = 0;           // часы, как их видел цикл в последний раз (uv_now)
  let seq = 0;                // порядок постановки
  let turn = 0;
  let phase = 'main';
  const out = [];
  const trace = [];           // что выполнилось: { turn, phase, kind, out } или сон в poll
  let timers = [];            // { due, seq, cb, ref }
  let immediates = [];        // очередь setImmediate (фаза check)
  const ticks = [];           // process.nextTick
  const micro = [];           // промисы и queueMicrotask
  let io = [];                // { ready, seq, cb } — ответы ввода-вывода (фаза poll)
  let closing = [];           // колбэки закрытых хендлов (close callbacks)
  let handles = 0;            // серверы и сокеты, которые держат процесс

  // После каждого колбэка: вся очередь nextTick, потом все микрозадачи — и так,
  // пока обе не опустеют (nextTick из микрозадачи ждёт конца микрозадач).
  function drain() {
    while (ticks.length || micro.length) {
      while (ticks.length) ticks.shift()();
      while (micro.length) micro.shift()();
    }
  }
  function run(kind, cb) {
    const from = out.length;
    cb();
    drain();
    trace.push({ turn, phase, kind, out: out.slice(from) });
  }

  // ── То, что видит сценарий вместо настоящего Node ──
  const api = {
    log: (s) => { out.push(String(s)); },
    work: (ms) => { now += ms; },
    setTimeout(cb, ms) {
      const d = ms >= 1 && ms <= 2147483647 ? Math.trunc(ms) : 1;   // 0, -5, NaN → 1 мс
      const t = { due: now + d, seq: seq++, cb, ref: true };          // отсчёт от «сейчас»
      timers.push(t);
      return { unref() { t.ref = false; return this; } };
    },
    setImmediate(cb) { immediates.push(cb); },
    process: { nextTick: (cb) => { ticks.push(cb); } },
    queueMicrotask: (cb) => { micro.push(cb); },
    Promise: { resolve: () => ({ then: (cb) => { micro.push(cb); } }) },
    fs: { stat: (path, cb) => { io.push({ ready: now + IO_MS, seq: seq++, cb }); } },
    net: {
      createServer: () => ({
        listen() { handles++; return this; },
        unref() { handles--; return this; },
        close() { handles--; closing.push(() => {}); },
      }),
      connect(port, cb) {
        handles++;
        let onClose = () => {};
        const socket = {
          on(event, fn) { if (event === 'close') onClose = fn; },
          destroy() { handles--; closing.push(() => onClose()); },
        };
        io.push({ ready: now + IO_MS, seq: seq++, cb });
        return socket;
      },
    },
    __filename: 'scene.js',
  };

  // ── Фазы ──
  const updateTime = () => { now += slack; loopTime = now; };
  function runTimers() {
    phase = 'timers';
    for (;;) {
      const due = timers.filter((t) => t.due <= loopTime);
      if (!due.length) break;
      const t = due.sort((a, b) => a.due - b.due || a.seq - b.seq)[0];
      timers = timers.filter((x) => x !== t);
      run('timeout', t.cb);
    }
  }
  function poll() {
    phase = 'poll';
    let timeout = Infinity;                                   // спать, пока что-то не придёт
    if (immediates.length || closing.length) timeout = 0;     // дальше по кругу есть работа
    else if (timers.length) timeout = Math.max(0, Math.min(...timers.map((t) => t.due)) - loopTime);
    const wake = Math.min(loopTime + timeout, ...io.map((e) => e.ready));
    if (wake > now) {
      trace.push({ turn, phase, kind: 'sleep', out: [], ms: wake - now });
      now = wake;
    }
    loopTime = now;
    const ready = io.filter((e) => e.ready <= now).sort((a, b) => a.ready - b.ready || a.seq - b.seq);
    io = io.filter((e) => e.ready > now);
    for (const e of ready) run('io', e.cb);
  }
  function check() {
    phase = 'check';
    const batch = immediates;                 // поставленные сейчас — уже на следующий оборот
    immediates = [];
    for (const cb of batch) run('immediate', cb);
  }
  function closeCallbacks() {
    phase = 'close';
    const batch = closing;
    closing = [];
    for (const cb of batch) run('close', cb);
  }
  const alive = () =>
    timers.some((t) => t.ref) || immediates.length > 0 || io.length > 0 || closing.length > 0 || handles > 0;

  // ── Сам процесс: модуль целиком, потом uv_run ──
  const names = Object.keys(api);
  run('main', () => new Function(...names, source)(...names.map((k) => api[k])));
  if (alive()) { updateTime(); runTimers(); }
  while (alive() && turn < 10000) {
    turn++;
    // pending, idle, prepare: из JS их не наполнить — в модели пусто
    poll();
    check();
    closeCallbacks();
    updateTime();
    runTimers();
  }
  return { out, trace };
}`;

/** Подпись под демо. */
export const LOOP_DEMO_NOTE =
  'Модель выполняет тот же код сценария, что и настоящий Node, только время у неё виртуальное. Переключатель машины меняет одно: сколько миллисекунд проходит, пока цикл добирается до фазы timers. Если от этого меняется вывод, порядок в Node не определён — и рядом стоит, как часто какой порядок выпадал в настоящих запусках.';

export const LOOP_SCENARIOS: LoopScenario[] = [
  {
    id: 'race',
    label: 'гонка в модуле',
    code: `setTimeout(() => log('timeout'), 0);
setImmediate(() => log('immediate'));`,
    deterministic: false,
    runs: 300,
    real: { 'immediate timeout': 293, 'timeout immediate': 7 },
    note: 'Таймер на «ноль» — это 1 мс, отсчитанная от вызова `setTimeout`. Если до первой фазы timers прошла целая миллисекунда, таймер созрел и идёт первым. Если нет — цикл проходит poll и check, печатает `immediate`, и таймер ждёт следующего круга.',
  },
  {
    id: 'busy-after',
    label: 'работа после',
    code: `setTimeout(() => log('timeout'), 0);
setImmediate(() => log('immediate'));
work(5);`,
    deterministic: true,
    runs: 20,
    real: { 'timeout immediate': 20 },
    note: 'Модуль после постановки таймера ещё 5 мс занят. К первой фазе timers миллисекунда таймера уже прошла — гонки нет, `timeout` первый всегда.',
  },
  {
    id: 'busy-before',
    label: 'работа до',
    code: `work(5);
setTimeout(() => log('timeout'), 0);
setImmediate(() => log('immediate'));`,
    deterministic: false,
    runs: 300,
    real: { 'immediate timeout': 285, 'timeout immediate': 15 },
    note: 'Те же 5 мс, но до `setTimeout` — и гонка вернулась. Таймер считает свою миллисекунду от момента вызова, а не от старта процесса: Node берёт для него свежее время цикла.',
  },
  {
    id: 'io',
    label: 'внутри ввода-вывода',
    code: `fs.stat(__filename, () => {
  setTimeout(() => log('timeout'), 0);
  setImmediate(() => log('immediate'));
});`,
    deterministic: true,
    runs: 20,
    real: { 'immediate timeout': 20 },
    note: 'Колбэк `fs.stat` выполняется в фазе poll. Следующая по кругу — check, а timers будут только после неё. `immediate` первый при любой скорости машины.',
  },
  {
    id: 'in-timer',
    label: 'внутри таймера',
    code: `setTimeout(() => {
  setTimeout(() => log('timeout'), 0);
  setImmediate(() => log('immediate'));
}, 0);`,
    deterministic: true,
    runs: 20,
    real: { 'immediate timeout': 20 },
    note: 'Из фазы timers до следующей фазы timers лежит целый круг, и check в нём раньше. Новый таймер не выполнится в той фазе, которая его поставила: его срок ещё не наступил.',
  },
  {
    id: 'in-immediate',
    label: 'внутри setImmediate',
    code: `setImmediate(() => {
  setTimeout(() => log('timeout'), 0);
  setImmediate(() => log('immediate'));
});`,
    deterministic: false,
    runs: 300,
    real: { 'immediate timeout': 293, 'timeout immediate': 7 },
    note: 'Из фазы check ближайшая — timers в конце того же круга. Успела пройти миллисекунда — `timeout` первый, нет — первым будет новый `setImmediate` на следующем круге. Опять гонка, хотя мы внутри цикла.',
  },
  {
    id: 'queues',
    label: 'nextTick и промисы',
    code: `Promise.resolve().then(() => {
  log('p1');
  process.nextTick(() => log('n-from-p'));
});
process.nextTick(() => {
  log('n1');
  Promise.resolve().then(() => log('p-from-n'));
});
queueMicrotask(() => log('q1'));
log('sync');`,
    deterministic: true,
    runs: 20,
    real: { 'sync n1 p1 q1 p-from-n n-from-p': 20 },
    note: 'Модуль закончился — Node сливает очереди: вся очередь `nextTick` (`n1`), потом все микрозадачи по порядку постановки (`p1`, `q1`, `p-from-n` — добавленная по ходу). `nextTick`, поставленный из микрозадачи, ждёт, пока кончатся микрозадачи.',
  },
  {
    id: 'between',
    label: 'между двумя setImmediate',
    code: `setImmediate(() => {
  log('i1');
  setImmediate(() => log('i3'));
  process.nextTick(() => log('n1'));
  Promise.resolve().then(() => log('p1'));
});
setImmediate(() => {
  log('i2');
  process.nextTick(() => log('n2'));
});`,
    deterministic: true,
    runs: 20,
    real: { 'i1 n1 p1 i2 n2 i3': 20 },
    note: 'Очереди сливаются после **каждого** колбэка, а не на границе фазы: `n1` и `p1` идут раньше `i2`. А `i3`, поставленный во время фазы check, ждёт следующего круга — очередь `setImmediate` берётся снимком.',
  },
  {
    id: 'starve',
    label: 'голод: nextTick',
    code: `let n = 0;
setTimeout(() => log('timeout after ' + n), 0);
function spin() {
  work(1);
  if (++n < 100) process.nextTick(spin);
}
process.nextTick(spin);`,
    deterministic: true,
    runs: 20,
    real: { 'timeout after 100': 20 },
    note: 'Сто тиков по миллисекунде: таймер созрел ещё на втором, но очередь `nextTick` сливается до дна вместе с добавленным, и цикл не доходит даже до фазы timers. Сделайте условие бесконечным — и таймер не выполнится никогда.',
  },
  {
    id: 'no-starve',
    label: 'без голода: setImmediate',
    code: `let n = 0;
setTimeout(() => log('timeout after ' + n), 0);
function spin() {
  work(1);
  if (++n < 100) setImmediate(spin);
}
setImmediate(spin);`,
    deterministic: false,
    runs: 300,
    real: { 'timeout after 1': 288, 'timeout after 0': 12 },
    note: 'Та же работа через `setImmediate`. Каждый новый вызов уходит на следующий круг, а по дороге цикл проходит timers — таймер выполняется после первого же шага (или до него, если машина медленная).',
  },
  {
    id: 'close',
    label: 'фаза close',
    code: `const server = net.createServer().listen(51001);
const socket = net.connect(51001, () => {
  socket.on('close', () => log('close'));
  socket.destroy();
  setTimeout(() => log('timeout'), 0);
  setImmediate(() => log('immediate'));
  process.nextTick(() => log('tick'));
  server.close();
});`,
    deterministic: true,
    runs: 20,
    real: { 'tick immediate close timeout': 20 },
    note: 'Колбэк подключения — в poll. За ним check (`immediate`), потом close callbacks: `destroy()` закрыл хендл сокета, и `\'close\'` приходит здесь. Таймер — только в конце круга.',
  },
  {
    id: 'unref',
    label: 'unref',
    code: `setTimeout(() => log('unref timer'), 20).unref();
setTimeout(() => log('ref timer'), 5);
setImmediate(() => log('immediate'));`,
    deterministic: true,
    runs: 20,
    real: { 'immediate ref timer': 20 },
    note: 'После `ref timer` у цикла остался один таймер, и он `unref`: процессу нечего ждать, и он выходит. Колбэк на 20 мс не выполнится никогда.',
  },
];

// ─── Раздел 2. Между колбэками ─────────────────────────────────────────────────────────────

export const DRAIN_STEPS: { k: string; d: string }[] = [
  {
    k: '1. Вся очередь `nextTick`',
    d: 'По одному, по порядку постановки, включая добавленные по ходу. Пока в ней что-то есть, до промисов дело не дойдёт.',
  },
  {
    k: '2. Все микрозадачи',
    d: 'Node просит V8 выполнить свою очередь целиком: реакции промисов, продолжения после `await`, `queueMicrotask` — одна общая очередь, без приоритетов.',
  },
  {
    k: '3. Снова, если появились тики',
    d: 'Микрозадача поставила `nextTick` — Node вернётся к шагу 1. И так, пока обе очереди не пусты одновременно. Только потом — следующий колбэк фазы.',
  },
];

export const DRAIN_NOTE =
  'Где это происходит: после модуля, после **каждого** таймера, каждого колбэка ввода-вывода, каждого `setImmediate` и каждого закрытия. В исходнике Node это видно прямо: `processTimers` и `processImmediate` зовут `runNextTicks()` между соседними колбэками, а после последнего очереди сливает выход из колбэка в C++.';

export const STARVE_NOTE =
  'Отсюда разница между двумя способами «отложить на потом». `nextTick` и микрозадачи не отпускают цикл: всё, что добавлено по ходу, выполнится в том же сливе. `setImmediate` отпускает: новый вызов из фазы check попадает в следующий круг, и между ними цикл успевает пройти timers и poll. Длинную работу кусками режут через `setImmediate`, а не через `nextTick`.';

// ─── Раздел 3. setTimeout(0) и setImmediate ────────────────────────────────────────────────

/** Сниппет к `TIMER_ROWS`: тест исполняет его в отдельном процессе и читает stderr. */
export const TIMER_PROBE_CODE = `for (const d of [0, 0.5, 1.7, -5, NaN, 2 ** 31]) {
  const t = setTimeout(() => {}, d);
  console.log(d, t._idleTimeout);   // поле Node: задержка, которую он запомнил
  clearTimeout(t);
}`;

export const TIMER_ROWS: { call: string; stored: string; warning: string; tone?: 'warn' }[] = [
  { call: 'setTimeout(f, 0)', stored: '1', warning: '—' },
  { call: 'setTimeout(f, 0.5)', stored: '1', warning: '—' },
  { call: 'setTimeout(f, 1.7)', stored: '1.7', warning: '—' },
  { call: 'setTimeout(f, -5)', stored: '1', warning: 'TimeoutNegativeWarning', tone: 'warn' },
  { call: 'setTimeout(f, NaN)', stored: '1', warning: 'TimeoutNaNWarning', tone: 'warn' },
  { call: 'setTimeout(f, 2 ** 31)', stored: '1', warning: 'TimeoutOverflowWarning', tone: 'warn' },
];

export const TIMER_NOTE =
  'Всё меньше единицы становится одной миллисекундой — как в браузере, только без браузерного правила «4 мс после пятой вложенности». Дробная задержка запоминается как есть, но в список таймеров попадает отброшенной до целого: `1.7` срабатывает вместе с таймерами на 1 мс. Отрицательная, нечисловая и слишком большая задержка тоже дают 1 мс — с предупреждением в stderr.';

export const RACE_FACTS: { t: string; d: string; tone?: 'ok' | 'warn' }[] = [
  {
    t: 'Почему гонка вообще есть',
    d: 'Миллисекунда таймера отсчитывается от вызова `setTimeout`. Фаза timers смотрит на часы, обновлённые прямо перед ней. Если между этими двумя моментами прошло меньше 1 мс, таймер ещё не созрел — и `setImmediate` проходит раньше.',
    tone: 'warn',
  },
  {
    t: 'Что решает исход',
    d: 'Сколько работы между `setTimeout` и первой фазой timers: остаток модуля, загрузка машины, планировщик ОС. Поэтому частоты в таблице — свойство конкретного запуска на конкретной машине, а не константа Node.',
  },
  {
    t: 'Где порядок гарантирован',
    d: 'Из poll (колбэк ввода-вывода) и из timers (колбэк таймера) следующей идёт check, а timers — через круг. `setImmediate` первый всегда.',
    tone: 'ok',
  },
  {
    t: 'Где снова гонка',
    d: 'Из check (колбэк `setImmediate`) ближайшая фаза — timers в конце того же круга. Снова всё решает, прошла ли миллисекунда.',
    tone: 'warn',
  },
];

// ─── Раздел 4. Poll ────────────────────────────────────────────────────────────────────────

export const POLL_RULES: { k: string; v: string; tone?: 'ok' | 'warn' | 'info' }[] = [
  {
    k: 'есть `setImmediate`, отложенный колбэк или закрываемый хендл',
    v: '`0` — заглянуть и сразу дальше',
    tone: 'warn',
  },
  { k: 'есть таймеры', v: 'до срока ближайшего таймера, в миллисекундах', tone: 'info' },
  { k: 'таймеров нет, но есть сокет, сервер или запрос в пуле', v: '`-1` — спать, пока ОС не разбудит', tone: 'ok' },
  { k: 'нет ничего, что держит процесс', v: 'круг не начнётся: цикл завершён' },
];

export const POLL_NOTE =
  'Правило — функция `uv__backend_timeout` в libuv. Пока poll спит в `kevent` или `epoll_wait`, процессор процессу не нужен: ОС разбудит его, когда придут данные или истечёт время. Отсюда главная особенность Node: тысячи простаивающих соединений почти ничего не стоят. И отсюда же цена `setImmediate`-«насоса»: пока в очереди check что-то есть, poll не спит ни разу.';

/** Сценарий к `IDLE_OUT`: простой цикла, пока он ждёт таймер, и пока его гоняет setImmediate. */
export const IDLE_CODE = `const { performance } = require('node:perf_hooks');
const start = performance.eventLoopUtilization();
let stop = false;
const pump = () => { if (!stop) setImmediate(pump); };
if (process.argv[2] === 'pump') setImmediate(pump);
setTimeout(() => {
  stop = true;
  const elu = performance.eventLoopUtilization(start);
  console.log('idle ' + Math.round(elu.idle) + ' ms, active ' + Math.round(elu.active) + ' ms');
}, 200);`;

export const IDLE_OUT: { k: string; out: string; tone?: 'ok' | 'warn' }[] = [
  { k: '`node idle.js` — только таймер', out: 'idle 202 ms, active 0 ms', tone: 'ok' },
  { k: '`node idle.js pump` — таймер и насос', out: 'idle 0 ms, active 200 ms', tone: 'warn' },
];

export const IDLE_NOTE =
  '`idle` в `eventLoopUtilization` — это время, которое цикл провёл во сне внутри poll. В первом запуске цикл 200 мс спал до таймера. Во втором ни разу не уснул: `setImmediate` держал таймаут poll на нуле, и круг вертелся вхолостую все 200 мс.';

export const PLAIN_POLL =
  'Вахтёр у телефона не ходит кругами и не проверяет трубку каждую секунду — он дремлет, и его будит звонок или будильник. Но если в лотке «сделать сразу после обхода» что-то лежит, он не садится вовсе: глянул на телефон — и дальше по маршруту.';

// ─── Раздел 5. Пул потоков ─────────────────────────────────────────────────────────────────

export const POOL_PROBE_CODE = `const crypto = require('node:crypto');
const zlib = require('node:zlib');
const dns = require('node:dns');
net.createServer((s) => s.end()).listen(51002).unref();

crypto.pbkdf2('pass', 'salt', 1_000_000, 64, 'sha512', () => log('pbkdf2'));
fs.stat(__filename, () => log('fs.stat'));
dns.lookup('localhost', () => log('dns.lookup'));
zlib.gzip('hello', () => log('zlib.gzip'));
crypto.randomBytes(16, () => log('crypto.randomBytes'));
net.connect(51002, '127.0.0.1', () => log('net.connect 127.0.0.1'));
net.connect(51002, 'localhost', () => log('net.connect localhost'));
setTimeout(() => log('setTimeout 10'), 10);`;

/** Вывод `POOL_PROBE_CODE` при `UV_THREADPOOL_SIZE=1`, 5 прогонов из 5. */
export const POOL_PROBE_OUT = [
  'net.connect 127.0.0.1',
  'setTimeout 10',
  'pbkdf2',
  'fs.stat',
  'dns.lookup',
  'crypto.randomBytes',
  'zlib.gzip',
  'net.connect localhost',
];

export const POOL_PROBE_NOTE =
  'Пул из одного потока, и его на сотни миллисекунд занимает хеш. Всё, что встало в пул следом, ждёт хеша: `fs.stat`, `dns.lookup`, `randomBytes`, `gzip`. Сокет по адресу `127.0.0.1` и таймер не ждут — их обслуживает сам цикл через poll и timers. А `net.connect` к `localhost` пришёл последним: прежде чем подключиться, он ищет адрес через `dns.lookup`, а тот — в пуле.';

export const POOL_ROWS: { k: string; pool: string; why: string; tone?: 'warn' | 'ok' }[] = [
  { k: '`fs.*` (кроме `fs.watch`)', pool: 'да', why: 'обычные файлы в ОС не бывают «готовы к чтению», их читают блокирующим вызовом в потоке пула', tone: 'warn' },
  { k: '`dns.lookup`, а с ним `net.connect` и `http.get` по имени хоста', pool: 'да', why: 'системный `getaddrinfo` блокирующий. По исходнику libuv он занимает не больше половины пула', tone: 'warn' },
  { k: '`crypto.pbkdf2`, `scrypt`, `randomBytes` с колбэком', pool: 'да', why: 'чистые вычисления; синхронные версии считают в главном потоке', tone: 'warn' },
  { k: '`zlib` с колбэком и потоки zlib', pool: 'да', why: 'сжатие кусками в потоке пула', tone: 'warn' },
  { k: 'сокеты: `net`, `http`, `fetch` по IP-адресу', pool: 'нет', why: 'ОС умеет сказать «готово» — их ждёт poll', tone: 'ok' },
  { k: '`dns.resolve*`', pool: 'нет', why: 'библиотека c-ares ходит в DNS сама, по сокету, мимо `getaddrinfo` и файла hosts', tone: 'ok' },
  { k: 'таймеры, `setImmediate`, `nextTick`', pool: 'нет', why: 'это сам цикл', tone: 'ok' },
];

export const PLAIN_POOL =
  'Пул — четыре кассы с общей очередью. Хеш, чтение файла и поиск адреса стоят в **одной** очереди: если четыре человека пришли с тележками на час, пятый с одной шоколадкой ждёт, пока освободится касса. Сокеты стоят в другой очереди — у турникета, который открывается сам, как только пришёл человек.';

/**
 * Учебная модель пула: потоки и одна общая очередь FIFO. Печатается на странице,
 * исполняется виджетом и тестом.
 */
export const POOL_CODE = `// Пул libuv: size потоков и одна очередь FIFO.
// Задача из головы очереди берёт поток, который освободился первым.
function poolOrder(size, tasks) {
  const freeAt = Array(size).fill(0);          // когда освободится каждый поток
  const done = [];
  for (const task of tasks) {                  // задачи встают в очередь по порядку
    const free = Math.min(...freeAt);
    const thread = freeAt.indexOf(free);
    done.push({ name: task.name, thread, start: free, end: free + task.cost });
    freeAt[thread] = free + task.cost;
  }
  return done.sort((a, b) => a.end - b.end);   // порядок колбэков = порядок завершения
}`;

/**
 * Сценарий к `POOL_STAND`. В модели — те же задачи: хеш i стоит 100 + 10·i (в жизни равные
 * хеши кончаются в чуть разное время, добавка делает это явным), `fs.stat` — 1.
 */
export const POOL_ORDER_SCENE = `const crypto = require('node:crypto');
for (let i = 1; i <= 5; i++) {
  crypto.pbkdf2('pass', 'salt', 300_000, 64, 'sha512', () => log('hash ' + i));
}
fs.stat(__filename, () => log('fs.stat'));`;

export const POOL_TASKS = [
  { name: 'hash 1', cost: 110 },
  { name: 'hash 2', cost: 120 },
  { name: 'hash 3', cost: 130 },
  { name: 'hash 4', cost: 140 },
  { name: 'hash 5', cost: 150 },
  { name: 'fs.stat', cost: 1 },
];

/** Порядок завершения `POOL_ORDER_SCENE`, Node 24.11, по 8 прогонов на размер пула. */
export const POOL_STAND: PoolStand[] = [
  { size: 1, runs: 8, statPositions: { 6: 8 }, hash5Last: 8 },
  { size: 2, runs: 8, statPositions: { 5: 8 }, hash5Last: 8 },
  { size: 4, runs: 8, statPositions: { 3: 8 }, hash5Last: 8 },
  { size: 5, runs: 8, statPositions: { 2: 8 }, hash5Last: 3 },
];

export const POOL_DEMO_NOTE =
  'Шесть задач на пул выбранного размера: пять одинаковых хешей и одно `fs.stat`, поставленное последним. Чтение ждёт не диск, а поток: при четырёх потоках оно начнётся, только когда освободятся два. Порядок самих хешей в Node от запуска к запуску разный — они кончаются почти одновременно, — а место `fs.stat` одно и то же: его решает число потоков, а не скорость хешей.';

export const POOL_SIZE_FACTS: { t: string; d: string; tone?: 'warn' | 'ok' }[] = [
  {
    t: 'Размер — до первой задачи',
    d: 'Пул создаётся при первой постановке в него задачи и потом не меняется. `UV_THREADPOOL_SIZE=8 node app.js` работает всегда. `process.env.UV_THREADPOOL_SIZE = \'8\'` в первой строке скрипта тоже сработает, а после первого `fs.readFile` — уже нет, молча.',
    tone: 'warn',
  },
  {
    t: 'Предел — 1024',
    d: 'Больше libuv не создаст. Ноль и нечисловое значение превращаются в один поток. Пул общий на весь процесс: у каждого воркера из `worker_threads` свой цикл, но потоки пула те же.',
  },
  {
    t: 'Пул не виден в задержке цикла',
    d: 'Главный поток свободен, таймеры точны, `monitorEventLoopDelay` в норме — а `readFile` идёт секунды. Искать надо очередь пула: сколько одновременно хешей, сжатий и чтений.',
    tone: 'warn',
  },
];

// ─── Раздел 6. Когда процесс выходит ───────────────────────────────────────────────────────

export const ALIVE_CODE = `const timer = setTimeout(() => log('timer'), 1000);
const server = net.createServer().listen(51003);
fs.stat(__filename, () => log('stat'));
const before = process.getActiveResourcesInfo();
timer.unref();
server.unref();
const after = process.getActiveResourcesInfo();
log(before.join(', '));
log(after.join(', '));
process.on('beforeExit', () => log('beforeExit'));
process.on('exit', () => log('exit'));`;

/** Вывод `ALIVE_CODE`, Node 24.11 и 26.8.2, 5 прогонов из 5. */
export const ALIVE_OUT = [
  'FSReqCallback, TCPServerWrap, Timeout',
  'FSReqCallback',
  'stat',
  'beforeExit',
  'exit',
];

export const ALIVE_NOTE =
  '`getActiveResourcesInfo` перечисляет то, что держит процесс: запрос к файлу (`FSReqCallback`), слушающий сервер (`TCPServerWrap`), таймер (`Timeout`). После `unref()` таймер и сервер из списка ушли — они по-прежнему работают, но процесс ради них ждать не будет. Остался только `stat`: пришёл его ответ, держать стало нечего, и цикл вышел. Таймер на секунду не выполнился, сервер закрылся вместе с процессом.';

export const EXIT_FACTS: { t: string; d: string; tone?: 'ok' | 'warn' }[] = [
  {
    t: 'Правило выхода',
    d: 'Круг идёт, пока есть активный хендл с ref, незавершённый запрос или закрываемый хендл (`uv__loop_alive`). Ожидающий промис в этот список **не входит**: `await new Promise(() => {})` в конце скрипта не держит процесс.',
    tone: 'warn',
  },
  {
    t: '`beforeExit` может продлить жизнь',
    d: 'Его зовут, когда цикл опустел. Поставили в обработчике таймер — цикл запустится снова, и `beforeExit` придёт ещё раз. `exit` — последнее слово: асинхронное там уже не выполнится.',
  },
  {
    t: '`unref` — для служебного',
    d: 'Таймер метрик, сервер для отладки, повторное подключение — всё, что не должно мешать процессу закончиться. `ref()` возвращает как было; `hasRef()` говорит, держит ли объект процесс.',
    tone: 'ok',
  },
];

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: '`setTimeout(f, 0)` и `setImmediate` в модуле — гонка',
    d: 'Порядок решает, прошла ли миллисекунда до первой фазы timers. На стенде — 293 запуска из 300 одним порядком и 7 другим. Нужен порядок — ставьте оба из колбэка ввода-вывода или таймера, где `setImmediate` первый всегда.',
    tone: 'warn',
  },
  {
    n: '02',
    t: 'Рекурсивный `nextTick` останавливает цикл',
    d: 'Очередь сливается до дна вместе с добавленным, и до таймеров, сокетов и `setImmediate` дело не доходит. То же с бесконечной цепочкой промисов. Работу кусками режут через `setImmediate`.',
    tone: 'err',
  },
  {
    n: '03',
    t: '`setImmediate` из фазы check — уже следующий круг',
    d: 'Очередь check берётся снимком. Вызов изнутри `setImmediate` не выполнится в той же фазе, в отличие от `nextTick`, который выполнится сразу после текущего колбэка.',
  },
  {
    n: '04',
    t: '`nextTick` из микрозадачи идёт после промисов',
    d: '«`nextTick` раньше промисов» верно, когда его ставят из обычного колбэка. Поставленный из `.then` или после `await`, он ждёт, пока кончится очередь микрозадач.',
    tone: 'warn',
  },
  {
    n: '05',
    t: 'Медленный `readFile` при свободном диске',
    d: 'Файлы, `dns.lookup`, хеши и сжатие делят один пул из четырёх потоков. Четыре долгих `pbkdf2` — и чтение конфига ждёт. Задержка цикла при этом в норме.',
    tone: 'err',
  },
  {
    n: '06',
    t: '`localhost` идёт через пул, `127.0.0.1` — нет',
    d: '`net.connect` и `http.get` по имени сначала зовут `dns.lookup`, а он работает в пуле. При занятом пуле подключение к собственному серверу на `localhost` ждёт хешей.',
    tone: 'warn',
  },
  {
    n: '07',
    t: '`UV_THREADPOOL_SIZE` после первой задачи пула не действует',
    d: 'Пул создаётся один раз. Переменная, выставленная из кода после первого `fs.readFile`, молча игнорируется. Надёжно — из окружения при запуске.',
    tone: 'err',
  },
  {
    n: '08',
    t: 'Промис не держит процесс',
    d: 'Процесс выходит, когда у цикла нет хендлов и запросов. Промис, который никто не разрешит, — не хендл: скрипт с `await` на таком промисе просто завершится с кодом 13 и предупреждением о незавершённом `await` верхнего уровня (в ESM) или тихо (в CommonJS).',
  },
  {
    n: '09',
    t: 'Задержка меньше 1 мс, отрицательная, `NaN` и больше 2³¹ − 1 — это 1 мс',
    d: '`setTimeout(f, 2 ** 31)` выстрелит почти сразу, с `TimeoutOverflowWarning` в stderr. Дробная задержка отбрасывается до целого.',
    tone: 'warn',
  },
];

// ─── Источники ─────────────────────────────────────────────────────────────────────────────

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'Node.js — The Node.js Event Loop',
    href: 'https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick',
    what: 'фазы, `setImmediate` против `setTimeout`, `process.nextTick`',
  },
  {
    title: 'Node.js — Don\'t Block the Event Loop (or the Worker Pool)',
    href: 'https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop',
    what: 'что идёт в пул потоков и как его занимают',
  },
  {
    title: 'libuv — Design overview',
    href: 'https://docs.libuv.org/en/v1.x/design.html',
    what: 'порядок фаз, правило таймаута poll, пул потоков',
  },
  {
    title: 'libuv — Thread pool work scheduling',
    href: 'https://docs.libuv.org/en/v1.x/threadpool.html',
    what: '`UV_THREADPOOL_SIZE`, размер по умолчанию 4, предел 1024',
  },
  {
    title: 'libuv 1.51.0 — src/unix/core.c',
    href: 'https://github.com/libuv/libuv/blob/v1.51.0/src/unix/core.c',
    what: '`uv_run`, `uv__backend_timeout`, `uv__loop_alive`',
  },
  {
    title: 'libuv 1.51.0 — src/threadpool.c',
    href: 'https://github.com/libuv/libuv/blob/v1.51.0/src/threadpool.c',
    what: 'общая очередь FIFO, «медленный ввод-вывод» не больше половины пула',
  },
  {
    title: 'Node.js — lib/internal/timers.js',
    href: 'https://github.com/nodejs/node/blob/v24.11.0/lib/internal/timers.js',
    what: '`processTimers`, `processImmediate`, нормализация задержки',
  },
  {
    title: 'Node.js API — Timers',
    href: 'https://nodejs.org/api/timers.html',
    what: '`unref`, `ref`, `hasRef`, `setImmediate`',
  },
  {
    title: 'Node.js API — process: getActiveResourcesInfo, beforeExit',
    href: 'https://nodejs.org/api/process.html#processgetactiveresourcesinfo',
    what: 'что держит процесс и когда он выходит',
  },
  {
    title: 'Node.js API — perf_hooks: eventLoopUtilization',
    href: 'https://nodejs.org/api/perf_hooks.html#performanceeventlooputilizationutilization1-utilization2',
    what: 'время сна цикла в poll',
  },
  {
    title: 'Node.js API — dns: implementation considerations',
    href: 'https://nodejs.org/api/dns.html#implementation-considerations',
    what: '`dns.lookup` в пуле, `dns.resolve*` — нет',
  },
];

export const RELATED =
  'Смежное на сайте: [Event Loop, раздел «Node»](/js/event-loop/#s5) — CommonJS против ESM, Node 11 и монитор задержки цикла. [Планирование задач, раздел «Чем возвращать управление циклу»](/js/task-scheduling/#s1) — уступка в браузере и `scheduler` из `node:timers/promises`. [Промис изнутри, раздел «Модель»](/js/promise-internals/#s1) — откуда берутся микрозадачи. [node:stream изнутри](/platform/node-streams/) — события стрима приходят через `nextTick`, а `for await` живёт на промисах. [MessageChannel, раздел «Тайминг»](/js/message-channel/#s2) — насос из `setImmediate` как прибор. [Память в Node](/js/node-memory/) — что ещё живёт в процессе рядом с циклом. [Асинхронный контекст](/js/async-context/) — AsyncLocalStorage, момент снимка контекста и почему в браузере его пока нет.';
