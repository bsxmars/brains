import type { ConceptDiagramData } from '@/shared/ui/concept-diagram';
import type { GlossaryTerm, Pitfall, Prereq, Source } from '@/entities/lesson';
import type { StandProfile } from '@/widgets/pp-flame/model/types';

/**
 * Данные темы «Непрерывное профилирование памяти».
 *
 * Тема написана здесь. До неё предмет висел строкой «Память в проде изо дня в день:
 * непрерывное профилирование и метрики кластера — Отдельная тема — готовится» в `OFFSCREEN`
 * у «Памяти в Node».
 *
 * Границы с соседями (правило «информацию не дублируем»):
 *   - снимок кучи, три снимка, retainers, доминаторы — дом «Профилирование памяти»;
 *   - поля `memoryUsage`, `--trace-gc`, лимиты, снимок с живого процесса и его цена,
 *     `--heap-prof` — дом «Память в Node»;
 *   - нижняя огибающая и пила графика — дом «Память и GC»;
 *   - `monitorEventLoopDelay` как индикатор блокировки — «Цикл событий Node», раздел «Между колбэками».
 * Здесь — наблюдение за работающим сервисом, когда снимок снять нельзя.
 *
 * ⚠️ ГДЕ И КАК СНЯТО. Node 26.8.2 (V8 14.6), macOS arm64, 8 ядер. Выборочный профиль,
 * режимы «всё / живое», `PerformanceObserver('gc')`, `GCProfiler`, `eventLoopUtilization`
 * и пол `monitorEventLoopDelay` повторены на Node 24.11.0 — совпало. `v8.startHeapProfile`
 * и `v8.startCpuProfile` в 24.11 и 20.14 нет (`typeof … === 'undefined'`).
 *
 * ⚠️ ОБСТАНОВКА ЗАМЕРОВ ВРЕМЕНИ. Машина НЕ была тихой: параллельно работали другие процессы
 * (load average 1.8–3.5 на 8 ядрах). Поэтому (1) все режимы гонялись вперемешку в одном
 * процессе, по семь повторов, в прямом и обратном порядке; (2) в текст идут только отношения
 * медиан; (3) в тест — только направление («дороже / не дороже»), не число. См. OVERHEAD_ROWS.
 *
 * Что чем проверено (`tests/unit/continuous-profiling.test.ts`):
 *   - `STAND_CODE` и `CAPTURE_CODE` исполняются как напечатаны в отдельном процессе; профиль
 *     всех выделений называет `renderCatalog`, профиль живого — `login`;
 *   - `FOLD_CODE` сворачивает этот живой профиль, и сумма корня равна сумме `size` сэмплов;
 *   - литералы `STAND_ALL` и `STAND_LIVE` согласованы сами с собой и с тем, что показано в тексте;
 *   - разброс оценки против `1/√n` — сорок записей одного и того же кода;
 *   - `PerformanceObserver('gc')`: виды сборок, флаг принудительной, доставка только после того, как поток отдан циклу;
 *   - `eventLoopUtilization` — направление «занят > простаивает»;
 *   - `GCProfiler`: пол после major GC у кеша стоит, у утечки растёт;
 *   - накладные расходы — только направление.
 * Уточнения 2026-11-11:
 *   - live означает исключение уже собранных объектов, а не полный граф достижимости.
 *     Node forceGC=false / true проверяются отдельной пробой до и после GC;
 *   - CDP и CLI --heap-prof получают профиль с kSamplingForceGC: исходники inspector
 *     Node v26.8.2 и V8HeapProfilerAgentImpl; это не режим без возможных пауз;
 *   - CAPTURE_V8_CODE теперь законченный модуль и также исполняется тестом;
 *   - FOLD_CODE — импортируемый ESM-модуль; UI адаптирует только его export;
 *   - рост пола и долей не доказывает утечку, стоимость не является константой агента.
 */

/* ──────────────────── Раздел 1 · стенд и профиль ──────────────────── */

/**
 * Учебный сервис. Печатается в теме и исполняется тестом — именно эта строка.
 *
 * Обработчики вызываются через таблицу маршрутов: вызов по шести разным функциям мегаморфный,
 * и оптимизатор не встраивает их в `route`. Без этого профиль приписал бы все выделения тому,
 * куда их встроили (см. PITFALLS, «встраивание»), — это проверено: в первой версии стенда
 * с прямыми вызовами профиль показывал безымянный кадр модуля вместо обработчиков.
 */
export const STAND_CODE = `// stand.mjs — учебный сервис: роутер и шесть обработчиков
export const sessions = new Map();

function renderCatalog(req) {
  const rows = [];
  for (let i = 0; i < 40; i++) rows.push(\`<li data-id="\${req.id + i}">товар \${i}</li>\`);
  return rows.join('');
}
function searchApi(req) {
  const body = JSON.stringify({ q: 'чай', page: req.id % 7, filters: ['a', 'b', 'c'] });
  return JSON.parse(body).filters.map((f) => ({ f, hits: req.id % 13 }));
}
function login(req) {
  // утечка: сессии кладутся в Map и не удаляются никогда
  sessions.set(req.id, { user: 'u' + req.id, at: req.id, scopes: new Array(24).fill('read') });
  return 'ok';
}
function cart(req) {
  const items = [];
  for (let i = 0; i < 6; i++) items.push({ sku: i, price: (req.id % 100) + i });
  return items.reduce((s, x) => s + x.price, 0);
}
function sign(req) {
  // только счёт: ни одного объекта, зато много процессорного времени
  let h = 2166136261;
  for (let i = 0; i < 4000; i++) h = Math.imul(h ^ (req.id + i), 16777619);
  return h & 0xffff; // малое целое: V8 хранит его в самой ссылке, не в куче
}
function health() {
  return 'ok';
}

const routes = { '/catalog': renderCatalog, '/api/search': searchApi, '/login': login,
  '/cart': cart, '/sign': sign, '/health': health };
const paths = ['/catalog', '/api/search', '/catalog', '/cart', '/api/search',
  '/login', '/health', '/catalog', '/cart', '/api/search', '/sign'];

export function route(req) {
  return routes[req.path](req);
}

// n запросов пачками по сто; между пачками поток отдаётся циклу событий
export async function serve(n) {
  for (let b = 0; b < n / 100; b++) {
    for (let j = 0; j < 100; j++) {
      const id = b * 100 + j;
      route({ id, path: paths[id % paths.length] });
    }
    await new Promise((r) => setImmediate(r));
  }
}`;

/**
 * Запись профиля через протокол отладчика. Работает в Node 20, 24 и 26 одинаково.
 * Печатается в теме и исполняется тестом как есть (рабочая папка — временная).
 */
export const CAPTURE_CODE = `// capture.mjs
import { Session } from 'node:inspector/promises';
import { writeFileSync } from 'node:fs';
import { serve } from './stand.mjs';

const session = new Session();
session.connect();
try {
  await session.post('HeapProfiler.enable');
  await session.post('HeapProfiler.startSampling', {
    samplingInterval: 32768,                 // средний интервал, байт
    includeObjectsCollectedByMajorGC: true,  // сохранять и уже собранные сэмплы
    includeObjectsCollectedByMinorGC: true,  // обеих категорий GC
  });
  await serve(20000);
  const { profile } = await session.post('HeapProfiler.stopSampling');
  writeFileSync('stand.heapprofile', JSON.stringify(profile));
} finally {
  session.disconnect();
}`;

/** Node 26.8.2: тот же формат файла, но другие умолчания GC и глубины стека. */
export const CAPTURE_V8_CODE = `// capture-v8.mjs — рядом с stand.mjs
import v8 from 'node:v8';
import { writeFileSync } from 'node:fs';
import { serve } from './stand.mjs';

const handle = v8.startHeapProfile({
  sampleInterval: 32768,        // умолчание этого API — 512 КБ
  stackDepth: 128,             // согласовать с примером CDP
  forceGC: false,              // чтение не запрашивает принудительную GC
  includeObjectsCollectedByMajorGC: true,
  includeObjectsCollectedByMinorGC: true,
});
try {
  await serve(20000);
} finally {
  writeFileSync('stand.heapprofile', handle.stop()); // JSON: head + samples
}`;

/**
 * Режимы выборочного профиля, снятые на стенде (Node 26.8.2 и 24.11.0, по два прогона,
 * интервал 32 КБ, 20 000 запросов; плюс прогон, записанный в литералы). Доли — от суммы
 * `selfSize`. У «всех выделений» они повторяются до пары процентов; у «живого» сэмплов около
 * двадцати, и `set` то попадает в выборку, то нет.
 */
export const MODE_ROWS: string[][] = [
  [
    'все выделения (два флага `include…` включены)',
    '`renderCatalog` ≈ 57–58%, `join` (это `rows.join` внутри `renderCatalog`) ≈ 28–30%, `searchApi` ≈ 4%, `login` ≈ 1%',
    'где выделяли байты за окно, включая уже собранные объекты',
  ],
  [
    'только живое (умолчание)',
    '`login` — от 86 до 100% вместе с вызванным из него `set` (это `sessions.set`); `renderCatalog` нет вовсе. Сэмплов всего около двадцати, отсюда и разброс',
    'где выделили попавшие в выборку объекты, ещё не собранные к чтению профиля',
  ],
];

/* ──────────────────── Раздел 2 · цена выборки ──────────────────── */

/**
 * Накладные расходы выборки на стенде: время `serve(30000)` с профилем против без него.
 *
 * ⚠️ Обстановка: машина под параллельной нагрузкой (load average 1.8–3.5 на 8 ядрах). Семь
 * повторов каждого режима вперемешку в одном процессе, медиана; четыре независимых прогона
 * (первый — на стенде без маршрута `/sign`; он же дал верхние границы диапазонов). В строке — диапазон отношений медиан по четырём
 * прогонам. Стенд интенсивно выделяет память: это один нагрузочный сценарий, не верхняя граница цены: у сервиса, который
 * больше считает и ждёт, чем выделяет, сэмплов в секунду меньше, и доля ниже.
 */
export const OVERHEAD_ROWS: string[][] = [
  ['512 КБ (умолчание `v8.startHeapProfile`)', '≈ 120–180', '×0.99–1.01 — в пределах шума'],
  ['32 КБ (умолчание протокола)', '≈ 2 400–2 700', '×1.04–1.11'],
  ['4 КБ', '≈ 18 000–20 000', '×1.38–1.60'],
  ['512 Б', '≈ 114 000–126 000', '×3.3–4.7'],
  ['64 Б', '≈ 600 000–650 000', '×13–20'],
  ['32 КБ, только живое', '≈ 30–40 в итоге', '×1.05–1.08 — столько же, сколько с флагами'],
];

/* ──────────────────── Раздел 3 · flame graph ──────────────────── */

/**
 * Учебное сворачивание: сэмплы → дерево вызовов → ширины. Язык — JS-модуль без типов: адаптер заменяет только export на return
 * перед `new Function` (демо — `widgets/pp-flame/model/fold.ts`, тест — тем же модулем).
 */
export const FOLD_CODE = `// 1. Профиль V8 → сэмплы: у каждого сэмпла стек от корня к листу и оценка байт.
function fromV8(profile) {
  const stackOf = new Map();
  const walk = (node, stack) => {
    const { functionName, url, lineNumber } = node.callFrame;
    const file = url ? ' ' + url.split('/').pop() + ':' + (lineNumber + 1) : '';
    const here = node === profile.head ? [] : [...stack, (functionName || '(anonymous)') + file];
    stackOf.set(node.id, here);
    for (const child of node.children) walk(child, here);
  };
  walk(profile.head, []);
  // Встречаются nodeId без узла: такой сэмпл нельзя привязать к стеку этой выгрузки.
  return profile.samples
    .filter((s) => stackOf.has(s.nodeId))
    .map((s) => ({ stack: stackOf.get(s.nodeId), bytes: s.size, count: 1 }));
}

// 2. Сэмплы → дерево: одинаковые префиксы стеков сливаются в один узел.
function fold(samples, metric) {
  const make = (name) => ({ name, self: 0, total: 0, children: new Map() });
  const root = make('все');
  for (const s of samples) {
    const value = metric === 'samples' ? s.count : s.bytes;
    let node = root;
    root.total += value;
    for (const frame of s.stack) {
      if (!node.children.has(frame)) node.children.set(frame, make(frame));
      node = node.children.get(frame);
      node.total += value;
    }
    node.self += value;
  }
  return root;
}

// 3. Дерево → прямоугольники: ширина — доля total родителя, ряд — глубина.
function layout(root) {
  const rects = [];
  const place = (node, x, w, depth) => {
    rects.push({ name: node.name, x, w, depth, total: node.total, self: node.self, node });
    let left = x;
    const kids = [...node.children.values()].sort((a, b) => b.total - a.total);
    for (const kid of kids) {
      const kw = node.total ? (w * kid.total) / node.total : 0;
      place(kid, left, kw, depth + 1);
      left += kw;
    }
  };
  place(root, 0, 1, 0);
  return rects;
}

// 4. Поиск: доля корня под кадрами, чьё имя содержит строку. Вложенное не считается дважды.
function matchShare(root, query) {
  const q = query.trim().toLowerCase();
  if (!q || !root.total) return 0;
  let hit = 0;
  const visit = (node) => {
    if (node !== root && node.name.toLowerCase().includes(q)) { hit += node.total; return; }
    node.children.forEach(visit);
  };
  visit(root);
  return hit / root.total;
}

export { fromV8, fold, layout, matchShare };`;

/*
 * Профили стенда — литералы, снятые `CAPTURE_CODE` на `STAND_CODE` (Node 26.8.2, интервал
 * 32 КБ, 20 000 запросов, без прогрева) и сжатые `scripts`-ом сессии: одинаковые стеки
 * сгруппированы, байты и число сэмплов сложены. Кадры — ровно так, как их назвал `fromV8`.
 * ⚠️ Это один конкретный прогон: выборка случайна, и у вас доли будут отличаться на проценты.
 */
export const STAND_ALL: StandProfile = {
  mode: 'all',
  interval: 32768,
  requests: 20000,
  frames: [
    '(anonymous)',
    'serve stand.mjs:43',
    'renderCatalog stand.mjs:4',
    'searchApi stand.mjs:9',
    'map',
    '(anonymous) stand.mjs:11',
    'join',
    'route stand.mjs:38',
    'cart stand.mjs:18',
    'login stand.mjs:13',
    'processImmediate timers:525',
    'emitBeforeScript async_hooks:519',
    'pushAsyncContext async_hooks:549',
    '(anonymous) capture.mjs:1',
    'emitAfterScript async_hooks:527',
    'popAsyncContext async_hooks:563',
    'Promise',
    '(anonymous) stand.mjs:49',
    'setImmediate node:timers:215',
    'set',
    'Immediate timers:747',
    'initAsyncResource timers:203',
    'newAsyncId async_hooks:427',
    'push',
  ],
  stacks: [
    [0, 1, 2],
    [0, 1, 3, 4, 5],
    [0, 1, 2, 6],
    [0, 1, 3],
    [0, 1, 7, 2],
    [0, 1, 8],
    [0, 1, 7, 3],
    [0, 1, 9],
    [0, 1],
    [0, 1, 3, 4],
    [0, 1, 7, 3, 4],
    [10, 11, 12],
    [0, 1, 7, 2, 6],
    [0, 13, 1, 7, 2],
    [10, 14, 15],
    [0, 1, 16, 17, 18],
    [10],
    [0, 13, 1, 7, 2, 6],
    [0, 1, 9, 19],
    [0, 1, 7],
    [0, 1, 16, 17, 18, 20, 21, 22],
    [0, 1, 7, 9],
    [0, 1, 7, 8],
    [0, 1, 7, 8, 23],
    [0, 13],
  ],
  samples: [
    [0, 28859376, 879],
    [1, 524800, 16],
    [2, 13920576, 412],
    [3, 1838768, 56],
    [4, 2494448, 76],
    [5, 1673584, 51],
    [6, 328192, 10],
    [7, 459936, 14],
    [8, 721632, 22],
    [9, 295200, 9],
    [10, 65600, 2],
    [11, 32928, 1],
    [12, 1120512, 33],
    [13, 131200, 4],
    [14, 32784, 1],
    [15, 32800, 1],
    [16, 32784, 1],
    [17, 100224, 3],
    [18, 114808, 2],
    [19, 65648, 2],
    [20, 32784, 1],
    [21, 65760, 2],
    [22, 164080, 5],
    [23, 32832, 1],
    [24, 32832, 1],
  ],
  recordedBytes: 53174088,
  selfTotal: 53216600,
  rawSamples: 1605,
};

export const STAND_LIVE: StandProfile = {
  mode: 'live',
  interval: 32768,
  requests: 20000,
  frames: [
    '(anonymous)',
    'serve stand.mjs:43',
    'login stand.mjs:13',
    'route stand.mjs:38',
    '(anonymous) capture.mjs:1',
  ],
  stacks: [
    [0, 1, 2],
    [0, 1, 3, 2],
    [0, 4, 1, 3, 2],
  ],
  samples: [
    [0, 591504, 18],
    [1, 98640, 3],
    [2, 32832, 1],
  ],
  recordedBytes: 722976,
  selfTotal: 722976,
  rawSamples: 22,
};

/**
 * CPU-профиль против профиля выделений на одном и том же прогоне стенда: оба профиля
 * включены одновременно (`v8.startCpuProfile()` и `v8.startHeapProfile` с интервалом 32 КБ
 * и обоими флагами), 200 000 запросов, Node 26.8.2, четыре прогона (два — на черновике стенда с тем же набором функций). Доля — от всех сэмплов
 * своего профиля, по собственному времени (self) и собственным байтам функции.
 */
export const CPU_VS_HEAP_ROWS: string[][] = [
  ['`renderCatalog`', '≈ 29–35%', '≈ 58%'],
  ['`join` (встроенная функция массива)', 'не в первой шестёрке', '≈ 30%'],
  ['`sign`', '≈ 24–30%', '0 — в профиле выделений её нет вовсе'],
  ['`searchApi`', '≈ 8–11%', '≈ 5%'],
  ['`(garbage collector)`', '≈ 6–9%', 'такого кадра нет'],
];

/* ──────────────────── Раздел 4 · метрики процесса ──────────────────── */

/**
 * Сборщик метрик для алертов. Печатается в теме и исполняется тестом как модуль:
 * тест подставляет короткий период, гоняет простой, занятый цикл и две принудительные сборки.
 */
export const METRICS_CODE = `// metrics.mjs — раз в period мс: память, загрузка цикла, задержка цикла, сборки
import { performance, monitorEventLoopDelay, PerformanceObserver, constants } from 'node:perf_hooks';

export function startMetrics(report, period = 10_000) {
  const resolution = 20;
  const delay = monitorEventLoopDelay({ resolution });
  delay.enable();

  let gc = { major: 0, minor: 0, majorMs: 0 };
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.detail.kind === constants.NODE_PERFORMANCE_GC_MAJOR) {
        gc.major++;
        gc.majorMs += entry.duration;
      } else if (entry.detail.kind === constants.NODE_PERFORMANCE_GC_MINOR) {
        gc.minor++;
      }
    }
  });
  observer.observe({ entryTypes: ['gc'] });

  let last = performance.eventLoopUtilization();
  const timer = setInterval(() => {
    const { rss, heapUsed, external } = process.memoryUsage();
    const now = performance.eventLoopUtilization();
    const delayRawP99Ms = delay.count ? delay.percentile(99) / 1e6 : null;
    report({
      rss, heapUsed, external,
      delayRawP99Ms, delayResolutionMs: resolution, delaySamples: delay.count,
      elu: performance.eventLoopUtilization(now, last).utilization,
      // Оценка превышения номинального шага, не точная задержка каждого запроса.
      delayP99Ms: delayRawP99Ms === null ? null : Math.max(0, delayRawP99Ms - resolution),
      ...gc,
    });
    last = now;
    delay.reset();
    gc = { major: 0, minor: 0, majorMs: 0 };
  }, period);
  timer.unref();

  return () => {
    clearInterval(timer);
    observer.disconnect();
    delay.disable();
  };
}`;

/** Что даёт каждое поле отчёта `startMetrics` — и на какой вопрос алерта оно отвечает. */
export const METRIC_ROWS: string[][] = [
  ['`rss`', 'резидентная память процесса. Лимит контейнера считают по метрикам cgroup: там могут быть другие процессы и файловый кеш, поэтому RSS одного PID его не заменяет', 'тренд резидентной памяти процесса; для OOM сопоставляют с памятью и лимитом контейнера'],
  ['`heapUsed`', 'занятое в куче JS сейчас, вместе с ещё не собранным мусором', 'сам по себе пилит; смотрят его минимумы, а не пики'],
  ['`external`', 'учтённая V8 внешняя память, связанная с JS-объектами, включая backing store Buffer/ArrayBuffer; не вся native-память процесса', 'растёт `rss`, а куча нет — смотреть сюда'],
  ['`elu`', 'доля времени, когда цикл работал, а не ждал событий', 'насыщение цикла работой; сравнивают с задержками запросов и числом ожидающих задач'],
  ['`delayP99Ms`', 'p99 интервала опроса минус номинальный resolution; приближение, рядом сохраняется исходное delayRawP99Ms', 'задержки обслуживания цикла; короткий всплеск может не попасть в p99, поэтому иногда нужен и максимум'],
  ['`major`, `majorMs`', 'события major GC за период и сумма их длительностей; это не счётчик CPU всех потоков GC', 'сборщик ест время; частота сама по себе утечку не выдаёт'],
];

/**
 * ELU против задержки цикла — три режима, Node 26.8.2, два прогона, `resolution: 10`.
 * Задержка здесь **без** вычета шага опроса — так, как её отдаёт гистограмма.
 */
export const LOOP_ROWS: string[][] = [
  ['простой 400 мс', '0.00', '≈ 12 мс — это шаг опроса, а не задержка'],
  ['400 задач по 1 мс подряд', '1.00', '≈ 10 мс — опять шаг опроса: задачи короткие'],
  ['одна задача на 400 мс', '0.90', '≈ 400 мс'],
];

/** Пол гистограммы в простое: минимум при трёх значениях `resolution`, 500 мс простоя. */
export const DELAY_FLOOR_ROWS: string[][] = [
  ['1 мс', '1.07 мс', '0.01 мс', '≈ 1.4–1.5 мс'],
  ['10 мс', '9.28 мс', '9.04 мс', '≈ 10.5 мс'],
  ['20 мс', '19.09 мс', '19.09 мс', '≈ 21 мс'],
];

/**
 * Пол кучи после каждой полной сборки: кеш с потолком против утечки. Печатается и исполняется
 * тестом как есть (`node floor.mjs cache` и `node floor.mjs leak`).
 */
export const FLOOR_CODE = `// floor.mjs — пол кучи после каждой полной сборки: кеш с потолком против утечки
import v8 from 'node:v8';

const mode = process.argv[2]; // 'cache' или 'leak'
const store = new Map();
let id = 0;
function put() {
  const key = id++;
  store.set(key, { key, body: 'x'.repeat(64) + key, tags: [key, key + 1] });
  if (mode === 'cache' && store.size > 20000) store.delete(store.keys().next().value);
}

const profiler = new v8.GCProfiler();
profiler.start();
for (let tick = 0; tick < 600; tick++) {
  for (let i = 0; i < 1500; i++) put();
  let junk = 0;
  for (let i = 0; i < 20000; i++) junk += [i].length; // мусор самого запроса
  await new Promise((r) => setImmediate(r));
}
const majors = profiler.stop().statistics.filter((s) => s.gcType === 'MarkSweepCompact');
const floor = majors.map((s) => (s.afterGC.heapStatistics.usedHeapSize / 2 ** 20).toFixed(1));
console.log(mode, 'major GC:', majors.length, '· пол после каждой, МБ:', floor.join(' '));`;

/** Вывод `FLOOR_CODE` на Node 26.8.2 — один прогон; повторы давали те же числа ± 0.5 МБ. */
export const FLOOR_OUT = `cache major GC: 8 · пол после каждой, МБ: 10.4 11.4 11.8 11.4 11.4 10.6 10.6 10.6
leak major GC: 2 · пол после каждой, МБ: 10.8 54.2`;

/* ──────────────────── Раздел 5 · непрерывное профилирование ──────────────────── */

/**
 * Инструменты — по их документации, сверено 29 сентября 2026; запуском не проверено ни одно.
 * Здесь только модель агента и виды профилей, а не флаги и не цены:
 *   — Pyroscope: grafana.com/docs/pyroscope/latest/configure-client/language-sdks/nodejs/
 *     (`@pyroscope/nodejs`, wall + `collectCpuTime`, heap с `heapSamplingIntervalBytes` 524288,
 *     теги) и …/configure-client/profile-types/ (у Node.js: CPU, Wall, Heap — Alloc нет).
 *     Пакет 0.6.4 стоит на `@datadog/pprof` 5.14.4 — обёртке над профилировщиками V8;
 *   — Datadog: docs.datadoghq.com/profiler/profile_types/ (Node.js: Heap Live Size/Objects;
 *     Allocated Memory — Preview, Node.js 26+ и `DD_PROFILING_ALLOCATION_ENABLED=true`),
 *     …/profiler/compare_profiles/ (сравнение по тегу `version`);
 *   — Parca: parca.dev/docs/parca-agent (eBPF, CPU; выделения памяти — «Soon»)
 *     и …/parca-agent-language-support (Node.js — JIT: указатель кадра и perf map или jitdump).
 * ⚠️ Уточнено против черновика: «профиль выделений» у Pyroscope и Datadog по умолчанию — профиль
 * **живой** кучи (режим «только живое» из раздела про стенд), а не всех выделений.
 */
export const TOOLS: { t: string; d: string }[] = [
  {
    t: 'Pyroscope (Grafana)',
    d: 'Агент — пакет `@pyroscope/nodejs` внутри процесса: периодически снимает профиль по времени (wall — отметки ставятся по настенным часам, а не по процессорному времени; процессорное — по флагу `collectCpuTime`) и профиль кучи, отправляет на сервер с метками (сервис, версия, под). Профиль кучи — тот же выборочный профилировщик V8 в режиме «только живое», шаг по умолчанию 512 КБ; всех выделений у Node.js в таблице видов профилей Pyroscope нет. Сервер хранит профили во времени и отдаёт flame graph за любой диапазон и разницу двух диапазонов.',
  },
  {
    t: 'Datadog Continuous Profiler',
    d: 'Та же модель, агент — библиотека трассировки `dd-trace`. Профиль кучи в Node (Heap Live Size) — тот же выборочный профилировщик V8 в режиме «только живое»; все выделения (Allocated Memory) — предварительная функция, только на Node.js 26+ и с `DD_PROFILING_ALLOCATION_ENABLED=true`. Профили несут тег версии развёртывания, поэтому «что поменялось после релиза» — штатное сравнение в интерфейсе.',
  },
  {
    t: 'Parca',
    d: 'Другая модель: агент на eBPF (механизме ядра Linux, который позволяет наблюдать за любым процессом без его участия) снимает стеки **процессора** со всего узла, не трогая код приложения. Для JIT-кода Node — машинного кода, который V8 собирает на ходу и у которого нет файла с именами функций, — ему нужны указатели кадров и карта символов (perf map — её пишет флаг `--perf-basic-prof` — или jitdump). Профиля **выделений** в агенте нет (в документации — «скоро»), а кучу V8 снаружи процесса и не увидеть — она видна только изнутри движка.',
  },
];

/* ──────────────────── Раздел 6 · браузер ──────────────────── */

/**
 * Замер в Chromium 153.0.8010.12 (Playwright): локальный `node:http`, одна страница без
 * заголовков изоляции, одна с `COOP: same-origin` + `COEP: require-corp`.
 *
 * Огрубление `performance.memory` (абзац в index.mdx) снято 2026-10-01 тем же Chromium 153,
 * headless shell, страница `setContent`: без флага `usedJSHeapSize` = 18 200 000 и не меняется
 * за восемь пачек по 300 000 объектов; с `--enable-precise-memory-info` растёт с каждой пачкой.
 * Тестом не закреплено — юнит-тест в браузер не ходит.
 */
export const BROWSER_ROWS: string[][] = [
  ['без изоляции', '`false`', '`undefined` — имени нет вовсе', 'объект есть'],
  ['с изоляцией, полный Chromium', '`true`', 'вернул 420 КБ, 4 записи разбивки (`JavaScript`, `DOM`, `Shared`) — через 18 с', 'объект есть'],
  ['с изоляцией, headless shell', '`true`', '`SecurityError: … is not available`', 'объект есть'],
];

/* ──────────────────── Тонкие места ──────────────────── */

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'Профиль приписывает выделение той функции, куда его встроили',
    d: 'V8 собирает стек сэмпла по настоящим кадрам, а встроенная функция своего кадра не имеет. В черновике стенда обработчики вызывались напрямую из цикла модуля — и профиль приписал почти все выделения безымянному кадру модуля: оптимизатор встроил обработчики в цикл. В проверенном стенде таблица маршрутов сохранила нужные имена. Это приём для опыта, а не запрет оптимизатору встраивать подобные вызовы в любых программах. На живом сервисе это значит: выделение могло случиться в любой функции, встроенной в этот кадр, и искать её придётся вручную, читая его код. Как устроено встраивание — в [«Движке V8»](/js/v8-engine/#s1).',
    tone: 'warn',
  },
  {
    n: '02',
    t: 'Размер сэмпла — не размер объекта',
    d: 'Поле `size` сэмпла — это размер объекта, умноженный на **округлённое** число объектов, которые он представляет. У мелкого объекта это почти ровно интервал; у средних объектов округление меняет результат: 3000 массивов по ~8 КБ при интервале 16 КБ дали по сэмплам 28.5 МБ, по `selfSize` дерева — 24.5 МБ, а на деле было около 24.1. Отсюда правило: суммы по сэмплам и по `selfSize` совпадают до долей процента, только пока объекты мелкие; selfSize тоже статистическая оценка, а не точный счётчик; учитывайте выбранный способ агрегирования.',
    tone: 'warn',
  },
  {
    n: '03',
    t: 'Последний сэмпл бывает без узла',
    d: 'В пяти записях стенда из двадцати четырёх последние один-два сэмпла ссылались на `nodeId`, которого в дереве нет: их сняли, пока V8 собирал сам профиль. Конвертер, который ищет узел без проверки, падает на `undefined` — ровно так упала первая версия `fromV8`. Конвертер пропускает записи, которые не может привязать к стеку. Для рабочего конвейера дополнительно считают число и вес пропусков: необъяснимые потери нельзя объявлять несущественными.',
    tone: 'err',
  },
  {
    n: '04',
    t: 'Утечка может давать меньше полных сборок, чем здоровый кеш',
    d: 'Частота major GC сама по себе не устанавливает наличие утечки: на стенде `floor.mjs` кеш с потолком прошёл восемь полных сборок, утечка — две. В этом опыте рост кучи сопровождался более редкими сборками. Тренд после major GC сужает поиск, но сам не доказывает ошибку удержания — разбор трёх кандидатов в алерт в разделе [«Метрики процесса для алертов»](#s4).',
    tone: 'warn',
  },
  {
    n: '05',
    t: 'Записи о сборках приходят не сразу',
    d: '`PerformanceObserver` доставляет записи асинхронно. Сразу после gc() новые записи ещё могут быть не доставлены. Наблюдателю нужно отдать управление и дождаться доставки; один setImmediate не является универсальным барьером. Количество записей зависит от произошедших сборок, не от числа ожиданий.',
  },
  {
    n: '06',
    t: 'Умолчания интервала разные у двух API',
    d: 'Протокол отладчика (`HeapProfiler.startSampling`) по умолчанию берёт 32 КБ, `v8.startHeapProfile` в Node 26 — 512 КБ: это видно в исходнике `normalizeHeapProfileOptions`. В Node 24 этого метода нет, но флаг `--heap-prof` и там пишет профиль с теми же 512 КБ. У мелких выделений ожидаемая частота сэмплов различается примерно в 16 раз, относительный разброс — примерно в 4 раза. Для сравнения учитывают интервал, режим, глубину стека и достаточность выборки.',
  },
];

/* ──────────────────── Источники ──────────────────── */

export const SOURCES: Source[] = [
  { title: 'V8 · Sampling flags и чтение профиля через Inspector', href: 'https://github.com/v8/v8/blob/main/src/inspector/v8-heap-profiler-agent-impl.cc', what: 'startSampling задаёт kSamplingForceGC; получение профиля вызывает GetAllocationProfile. Сопоставляется с параметром forceGC нового API Node.' },
  { title: 'Node 26.8.2 · CLI-профили через Inspector', href: 'https://github.com/nodejs/node/blob/v26.8.2/src/inspector_profiler.cc', what: 'Путь --heap-prof: startSampling, stopSampling при завершении, без параметров сохранения собранных объектов.' },
  {
    title: 'Chrome DevTools Protocol · HeapProfiler',
    href: 'https://chromedevtools.github.io/devtools-protocol/tot/HeapProfiler/',
    what: '`startSampling` с `samplingInterval` и двумя флагами `includeObjectsCollectedBy…GC`, формат `SamplingHeapProfile`: дерево узлов и список сэмплов.',
  },
  {
    title: 'Node.js · Inspector (`node:inspector/promises`)',
    href: 'https://nodejs.org/api/inspector.html',
    what: '`Session`, `connect()` и `post()` — как слать команды протокола из самого процесса, без открытого порта.',
  },
  {
    title: 'Node.js · V8 module (`startHeapProfile`, `startCpuProfile`, `GCProfiler`)',
    href: 'https://nodejs.org/api/v8.html',
    what: 'Синхронные профили без протокола и `GCProfiler` со статистикой кучи до и после каждой сборки — источник «пола» в разделе про метрики.',
  },
  {
    title: 'Node.js · Performance measurement APIs (`perf_hooks`)',
    href: 'https://nodejs.org/api/perf_hooks.html',
    what: '`eventLoopUtilization`, `monitorEventLoopDelay` и записи `gc` с полями `detail.kind` и `detail.flags`.',
  },
  {
    title: 'V8 · `sampling-heap-profiler.cc`',
    href: 'https://github.com/v8/v8/blob/main/src/profiler/sampling-heap-profiler.cc',
    what: 'Откуда формула масштаба `1 / (1 − e^(−size/rate))` с округлением и почему стек сэмпла состоит из настоящих кадров, без встроенных функций.',
  },
  {
    title: 'google/pprof · `profile.proto`',
    href: 'https://github.com/google/pprof/blob/main/proto/profile.proto',
    what: 'Формат pprof: сэмпл — список адресов в стеке и вектор значений разных типов (байты, штуки). Профиль стенда в демо flame graph хранится так же: одинаковые стеки сгруппированы, у каждого — байты и число сэмплов.',
  },
  {
    title: 'Brendan Gregg · Flame Graphs',
    href: 'https://www.brendangregg.com/flamegraphs.html',
    what: 'Откуда flame graph и формат «свёрнутых стеков»: ширина — доля сэмплов, порядок по горизонтали смысла не несёт.',
  },
  {
    title: 'MDN · `Performance.measureUserAgentSpecificMemory()`',
    href: 'https://developer.mozilla.org/en-US/docs/Web/API/Performance/measureUserAgentSpecificMemory',
    what: 'Требование изоляции и форма результата: `bytes` и `breakdown`. Остальное в разделе [«В браузере»](#s6) — замер в Chromium 153.',
  },
  {
    title: 'Grafana Pyroscope · Node.js',
    href: 'https://grafana.com/docs/pyroscope/latest/configure-client/language-sdks/nodejs/',
    what: 'Модель агента внутри процесса, настройки Node-клиента (`heapSamplingIntervalBytes`, `collectCpuTime`, теги). Повторно открыто 11.11.2026.',
  },
  {
    title: 'Grafana Pyroscope · Profile types',
    href: 'https://grafana.com/docs/pyroscope/latest/configure-client/profile-types/',
    what: 'Какие виды профилей снимает SDK каждого языка: у Node.js — CPU, Wall и Heap. Повторно открыто 11.11.2026.',
  },
  {
    title: 'Datadog · Profile Types',
    href: 'https://docs.datadoghq.com/profiler/profile_types/',
    what: 'Виды профилей Node.js: Heap Live Size и Heap Live Objects; Allocated Memory — Preview, Node.js 26+. Повторно открыто 11.11.2026.',
  },
  {
    title: 'Parca · Documentation',
    href: 'https://www.parca.dev/docs/overview',
    what: 'Модель eBPF-агента на уровне узла. Повторно открыто 11.11.2026.',
  },
  {
    title: 'Parca Agent · Language Support',
    href: 'https://www.parca.dev/docs/parca-agent-language-support',
    what: 'Node.js — среди JIT-языков: нужны указатель кадра и perf map или jitdump. Повторно открыто 11.11.2026.',
  },
];

/* ──────────────────── Вводный раздел · словарь ──────────────────── */

export const GLOSSARY: GlossaryTerm[] = [
  {
    k: 'выборочный профиль',
    d: 'Профиль, который записывает не каждое событие, а случайную долю: здесь — одно выделение памяти примерно на каждые `N` байт. Это уменьшает число записей, но оставляет статистическую неопределённость и собственную цену.',
  },
  {
    k: 'интервал выборки',
    d: 'Сколько байт в среднем проходит между двумя сэмплами. Меньше интервал — больше сэмплов, точнее оценка и дороже запись.',
  },
  {
    k: 'сэмпл',
    d: 'Одна запись выборки: стек вызовов в момент выделения и оценка, сколько байт этот сэмпл представляет.',
  },
  {
    k: 'flame graph',
    d: 'Картинка из прямоугольников: ряд — глубина стека, ширина — доля сэмплов под этим кадром. Читают по ширине; порядок слева направо смысла не несёт.',
  },
  {
    k: 'pprof',
    d: 'Формат профиля от Google, общий для многих языков: сэмплы со стеками и несколькими значениями на сэмпл. Его принимают почти все системы непрерывного профилирования.',
  },
  {
    k: 'пол кучи',
    d: 'Сколько занято в куче сразу после полной сборки, когда мусор уже убран, — то, что действительно живо. Устойчивый рост при сопоставимой нагрузке — повод искать удержание. Растущий кеш или число активных сессий тоже могут поднимать этот уровень.',
  },
  {
    k: 'ELU',
    d: 'Event loop utilization — доля времени, когда цикл событий был занят работой, а не ждал событий: от 0 до 1.',
  },
  {
    k: 'major и minor GC',
    d: 'Полная сборка всей кучи и быстрая сборка только молодых объектов. Подробно — в [«Памяти и GC»](/js/memory-gc/).',
  },
  {
    k: 'встраивание',
    d: 'Inlining: оптимизатор копирует тело маленькой функции в вызывающую. Своего кадра у встроенной функции больше нет — и профиль её не видит.',
  },
  {
    k: 'p99',
    d: '99-й перцентиль: значение, которое не превысили 99% замеров. Среднее прячет редкие долгие задержки, p99 — показывает.',
  },
  {
    k: 'алерт',
    d: 'Автоматическое оповещение дежурному, когда метрика перешла порог: «память процесса близка к лимиту», «цикл событий занят больше 90% времени».',
  },
  {
    k: 'под',
    d: 'В Kubernetes — группа совместно размещаемых контейнеров. Лимиты памяти обычно задают контейнерам; при OOM и перезапуске действуют политики окружения.',
  },
  {
    k: 'агент профилирования',
    d: 'Библиотека внутри процесса (или программа на узле), которая снимает профили по расписанию и отправляет их на сервер хранения.',
  },
  {
    k: 'RUM',
    d: 'Real User Monitoring — метрики, собранные в браузерах настоящих пользователей, а не на стенде.',
  },
];

/* ──────────────────── Перед началом ──────────────────── */

export const PREREQ: Prereq[] = [
  {
    t: 'Снимок кучи и «кто держит»',
    d: 'Снимок — граф всех живых объектов; retainers показывают, кто удерживает объект. В этой теме снимок снять **нельзя**, поэтому важно понимать, чего без него не узнать.',
    href: '/js/memory-profiling/',
    hrefLabel: 'Профилирование памяти',
    tone: 'info' as const,
  },
  {
    t: 'Поля `memoryUsage` и цена снимка',
    d: 'Что значат `rss`, `heapUsed`, `external`, и сколько стоит снимок живого процесса: пауза на всё время записи и пик памяти в разы больше кучи.',
    href: '/js/node-memory/',
    hrefLabel: 'Память в Node',
    tone: 'warn' as const,
  },
  {
    t: 'Поколения и нижняя огибающая',
    d: 'Почему график памяти пилит, что такое полная и молодая сборка и почему утечку ищут по минимумам после сборок.',
    href: '/js/memory-gc/',
    hrefLabel: 'Память и GC',
    tone: 'ok' as const,
  },
  {
    t: 'Цикл событий в Node',
    d: 'Одна очередь задач на поток: пока задача выполняется, остальные ждут. Без этого не понять, что меряют загрузка и задержка цикла.',
    href: '/js/node-event-loop/#s3',
    hrefLabel: 'Цикл событий Node, раздел «Между колбэками»',
    tone: 'info' as const,
  },
];

/* ──────────────────── Подписи к демо ──────────────────── */

/**
 * Что увидеть в демо flame graph. Доли посчитаны `FOLD_CODE` на литералах `STAND_ALL`/`STAND_LIVE`
 * и закреплены `tests/unit/continuous-profiling.test.ts` (блок «подписи к демо»).
 */
export const FLAME_DEMO_NOTE =
  'В профиле всех выделений почти всю ширину занимает `renderCatalog`: вместе с вызванным из него `join` — 88% байт. `sign` здесь нет вовсе — он только считает. В профиле «только живое» остаётся одна башня, `login`: сэмплы этого записанного профиля относятся к его выделениям; это не перепись всей кучи. Байты и сэмплы рисуют почти одинаковые ширины (расхождение меньше процентного пункта): объекты стенда мелкие, и каждый сэмпл весит почти ровно интервал.';

/**
 * Что увидеть в калькуляторе. Числа — `intervalReport` при умолчаниях виджета (20 МБ/с, 5%, 60 с);
 * закреплены тем же блоком теста.
 */
export const INTERVAL_DEMO_NOTE =
  'Сервис, выделяющий 20 МБ/с, при интервале 32 КБ даёт функции с долей 5% за минуту около двух тысяч сэмплов — модель даёт приблизительный 95%-интервал ±4.5%. При умолчании Node в 512 КБ сэмплов в шестнадцать раз меньше, и погрешность вырастает в √16 = 4 раза, до ±18%: эта функция едва проходит порог, ниже которого доля уже не оценивается с точностью ±20% (4%). Накладные расходы растут вместе с числом сэмплов, поэтому интервал выбирают по самой мелкой функции, которую нужно видеть.';

/* ──────────────────── На пальцах ──────────────────── */

export const PLAIN_SAMPLING =
  'Снимок кучи похож на перепись объектов и их связей. Выборка записывает лишь часть событий выделения: кто создавал объекты и сколько байт эти записи примерно представляют. Это меньше работы, чем запись каждого события, но точность и цена зависят от интервала, нагрузки и способа выгрузки.';

export const PLAIN_LIVE =
  'Профиль «всё» — журнал всех покупок в магазине за день: видно, какой отдел продаёт больше всего. Профиль «живое» — что из купленного ещё лежит у покупателей дома к вечеру: хлеб съели, а мебель стоит. Мебель могла быть нужна, а могла оказаться ненужной: само сохранение покупки не объясняет, почему её держат. Так и live-профиль ещё не доказывает утечку.';

export const PLAIN_FLAME =
  'Ширина полосы — вклад функции вместе с вызванными ею функциями. Каждый следующий уровень показывает вложенный вызов. Если большая часть ширины остаётся без дочерних полос, функция выделяет память сама; если под ней много веток, основная работа распределена между её вызовами. Положение по горизонтали не является шкалой времени.';

export const PLAIN_ELU =
  'Загрузка цикла — доля времени, когда кассир занят. Задержка — сколько ждёт человек, подошедший к кассе. Кассир может быть занят весь день, пробивая мелкие покупки, — и никто не ждёт дольше секунды. А одна долгая операция удержит кассу и задержит всех пришедших в это время. Загрузка и задержка описывают разные стороны работы, поэтому их смотрят вместе.';

/* ──────────────────── Трудные места подробно ──────────────────── */

/**
 * Три формулы раздела «Цена выборки» на одном профиле. Автор курса (2026-09-29): трудное
 * не сокращать, а объяснять подробно. Здесь нет нового замера — только арифметика по формулам
 * темы и числа, уже снятые на стенде: интервал 32 КБ, ≈ 2 400–2 700 сэмплов за прогон
 * (OVERHEAD_ROWS), доля `renderCatalog` ≈ 57–58 % и около двадцати сэмплов у «живого» `login`
 * (MODE_ROWS), «у мелкого объекта размер сэмпла почти ровно интервал» (PITFALLS 02), 64 Б —
 * ×13–20 (OVERHEAD_ROWS). Вероятности посчитаны по `1 − e^(−s/интервал)` и округлены.
 */
export const SAMPLING_SCENE =
  'Возьмём интервал 32 КБ — умолчание протокола, с которым сняты режимы стенда. **Что было бы без выборки**: записывать стек на каждом выделении. На стенде ближе всего к этому интервал 64 Б — сэмпл почти на каждый объект, около 600 тысяч записей за прогон, и тот же код идёт в 13–20 раз медленнее. Сервис, который так профилируют, ведёт себя совсем не так, как без профиля. Выборка жертвует точностью, чтобы не тратить время, а три формулы раздела показывают, сколько точности при этом остаётся.';

export const SAMPLING_OBJECTS: { k: string; chance: string; counted: string; trust: string }[] = [
  {
    k: 'Строка в 64 байта — как `<li>` из `renderCatalog`',
    chance: '`1 − e^(−64/32768)` ≈ 0.002: примерно одна строка из пятисот. Остальные четыреста девяносто девять профиль не видит вовсе.',
    counted: 'Попавшая строка записывается не как 64 байта, а как «строки этого места на ~32 КБ»: она представляет всех, кого пропустили вокруг неё. Отсюда размер сэмпла у мелких объектов — почти ровно интервал.',
    trust: 'По одной строке — никак. Но `renderCatalog` таких строк создаёт много: на неё пришлось больше половины из 2 400–2 700 сэмплов, то есть порядка полутора тысяч. `1/√1500` ≈ 0.026 — оценка ошибается на пару процентов, и именно так её доли менялись от прогона к прогону.',
  },
  {
    k: 'Массив на 8 КБ',
    chance: '`1 − e^(−8192/32768)` = `1 − e^(−0.25)` ≈ 0.22: примерно каждый пятый.',
    counted: 'Попавший массив тоже представляет пропущенных, но теперь «сколько их» округляется до целого — и на средних объектах округление ощутимо. В тонком месте «Размер сэмпла — не размер объекта» 3000 массивов по ~8 КБ при интервале 16 КБ дали по сэмплам 28.5 МБ против 24.1 на деле.',
    trust: 'Формула 1/√n здесь лишь ориентир: размеры и веса неоднородны. Для сумм по selfSize и по size учитывают разное округление; обе величины остаются оценками.',
  },
  {
    k: 'Массив на 1 МБ',
    chance: '`1 − e^(−32)` — единица с точностью до четырнадцатого знака: крупное выделение попадает в выборку практически наверняка.',
    counted: 'Записывается практически как есть: ему некого представлять, кроме себя.',
    trust: 'Точнее формулы: `1/√n` описывает мелкие объекты. Даже при умолчании Node в 512 КБ мегабайтный массив попадает в выборку с вероятностью `1 − e^(−2)` ≈ 0.86, а мелкий поток мусора набирает сэмплы только на длинном окне.',
  },
];

/** Итог разбора — после карточек, коротко. */
export const SAMPLING_TAKEAWAY =
  'Та же арифметика объясняет, почему в режиме «только живое» доли стенда так скачут: у `login` около двадцати сэмплов, `1/√20` ≈ 0.22, это большой относительный разброс оценки байт, но не точная формула разброса доли от корня. Если у интересной функции мало сэмплов, сначала удлиняют окно записи, а не уменьшают интервал. Длинное окно может дать больше наблюдений без учащения выборки. Однако у live-профиля объекты могут успеть исчезнуть, а хранение и выгрузка тоже имеют цену: длиннее не всегда означает точнее и не означает бесплатно.';

/** Продолжение PLAIN_SAMPLING: тот же опрос. */
export const PLAIN_SAMPLING_SIZES =
  'Выборка идёт по байтам, поэтому большой массив заметнее отдельного мелкого объекта. Один выбранный мелкий объект представляет множество пропущенных выделений. Чем меньше таких наблюдений у функции, тем осторожнее нужно относиться к оценке её байт. Большая вероятность попадания не даёт профиль всех ссылок на объект.';

/**
 * Разбор трёх кандидатов в алерт на одном прогоне `FLOOR_CODE` (FLOOR_OUT). Факты — из вывода
 * и из PITFALLS 04 (V8 отодвигает порог следующей сборки, у утечки две точки на прогон)
 * и METRIC_ROWS (`heapUsed` пилит, смотрят минимумы). Новых замеров нет.
 */
export const FLOOR_ALERTS: { k: string; cache: string; leak: string; verdict: string }[] = [
  {
    k: 'Алерт на частоту полных сборок',
    cache: 'восемь полных сборок за прогон',
    leak: 'две',
    verdict: 'Показывает обратное: у здорового кеша полных сборок больше, чем у утечки. В этом прогоне рост кучи сопровождался более редкими major GC. Это не универсальная связь частоты и утечки.',
  },
  {
    k: 'Алерт на `heapUsed` сейчас',
    cache: 'пилит: растёт между сборками, падает после',
    leak: 'пилит так же, только зубья выше',
    verdict: 'Для диагноза одного значения недостаточно: смешаны достижимые объекты и ещё не собранный мусор. При этом абсолютный порог всё равно полезен как сигнал близости к лимиту кучи.',
  },
  {
    k: 'Алерт на пол после полной сборки',
    cache: '10.4 → 11.4 → 11.8 → … → 10.6 МБ: стоит на месте',
    leak: '10.8 → 54.2 МБ: впятеро за две сборки',
    verdict: 'В этом контролируемом примере различает ограниченный кеш и неограниченное накопление. Минус — точки редкие: у утечки их две на весь прогон, поэтому алерт строят на тренде пола за часы, а не на одной точке.',
  },
];

export const RELATED =
  'Смежное на сайте: [«Профилирование памяти»](/js/memory-profiling/) — снимок, три снимка и панель Retainers: то, что делают, когда профиль назвал функцию. [«Память в Node»](/js/node-memory/) — поля `memoryUsage`, `--trace-gc`, лимиты контейнера и цена снимка с живого процесса. [«Память и GC»](/js/memory-gc/) — поколения и нижняя огибающая графика. [«Цикл событий Node»](/js/node-event-loop/#s3) — откуда берётся задержка цикла в Node. [«Движок V8»](/js/v8-engine/#s1) — встраивание, из-за которого профиль видит не все функции. [«Безопасность фронтенда», раздел «Изоляция страницы»](/platform/security/#s7) — изоляция источника, без которой браузер не меряет память.';


export const ALLOCATION_OWNER_DIAGRAM: ConceptDiagramData = {
  id: 'profile-allocation-owner',
  title: 'Схема: кто создал объект и кто его удерживает',
  description: 'Один login(req) из stand.mjs: функция создаёт сессию, а экспортированная Map sessions хранит ссылку на неё.',
  width: 920, height: 550,
  nodes: [
    { id: 'login', x: 0, y: 0, width: 270, height: 200, label: 'login(req)', detail: 'Место выделения объекта сессии.', tone: 'info' },
    { id: 'session', x: 340, y: 0, width: 240, height: 200, label: 'Объект сессии', detail: 'user, at, scopes — данные из примера.', tone: 'neutral' },
    { id: 'sessions', x: 680, y: 0, width: 240, height: 200, label: 'sessions: Map', detail: 'Хранит сессию по req.id и не удаляет её.', tone: 'err' },
    { id: 'profile', x: 0, y: 350, width: 270, height: 200, label: 'Выборочный профиль', detail: 'Стек выделения указывает на login. Держателя здесь нет.', tone: 'info' },
    { id: 'snapshot', x: 680, y: 350, width: 240, height: 200, label: 'Граф снимка', detail: 'Retainers раскрывает путь через sessions к объекту.', tone: 'ok' },
  ],
  edges: [
    { from: 'login', to: 'session', label: 'создаёт', labelX: 305, labelY: 75 },
    { from: 'sessions', to: 'session', fromSide: 'left', toSide: 'right', label: 'ссылка', labelX: 630, labelY: 75 },
    { from: 'login', to: 'profile', fromSide: 'bottom', toSide: 'top', dashed: true, label: 'запись стека', labelX: 135, labelY: 280 },
    { from: 'sessions', to: 'snapshot', fromSide: 'bottom', toSide: 'top', dashed: true, label: 'обход связей', labelX: 800, labelY: 280 },
  ],
  note: 'Это схема исходника, а не новый профиль или снимок. Живой сэмпл показывает место выделения; чтобы доказать утечку, проверяют, почему объект продолжает удерживаться.',
};


/** Controlled distinction: sampled window != whole heap; uncollected != reachable. */
export const LIVE_WINDOW_CODE = `// node --expose-gc live-window.mjs [force]
import v8 from 'node:v8';

function allocatedBeforeWindow() { return new Array(131072).fill(1); }
function discardedDuringWindow() { return new Array(131072).fill(2).length; }
const keep = allocatedBeforeWindow();
globalThis.gc(); // только контрольный опыт, не стратегия мониторинга
const forceGC = process.argv[2] === 'force';
const handle = v8.startHeapProfile({ sampleInterval: 1024, forceGC });
const temporaryLength = discardedDuringWindow(); // наружу вернулось число, не массив
const profile = JSON.parse(handle.stop());
const bytes = {};
function visit(node) {
  const name = node.callFrame.functionName;
  bytes[name] = (bytes[name] || 0) + node.selfSize;
  node.children.forEach(visit);
}
visit(profile.head);
console.log(JSON.stringify({ forceGC, keptLength: keep.length, temporaryLength,
  beforeBytes: bytes.allocatedBeforeWindow || 0,
  discardedBytes: bytes.discardedDuringWindow || 0 }));`;
