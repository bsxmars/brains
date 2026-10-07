import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { HeapScenario, Job, SchedScenario } from '@/widgets/sched-lab/model/types';

/**
 * Данные темы «Планировщики: очередь с приоритетом и нарезка времени».
 *
 * Тема написана 2026-10-01 для направления «Алгоритмы во фронтенде».
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * Пакет `scheduler` **0.28.0** (стоит транзитивно: `react-dom` 19.3.0 требует `^0.28.0`),
 * Node 24.11.0, Chromium 153.0.8010.12 (Playwright 1.63), октябрь 2026. Скрипты стенда —
 * в scratchpad агента (`agent-sched/`).
 *
 * Как снято и чем пересобирается в `tests/unit/schedulers.test.ts`:
 *   — **настоящий планировщик на виртуальных часах.** `cjs/scheduler.production.js` исполняется
 *     в `vm`-контексте, где `performance.now`, `setImmediate`, `setTimeout` и `clearTimeout`
 *     подменены хостом темы (`HOST_CODE`). Время идёт только тогда, когда работа сценария
 *     говорит `work(ms)`, поэтому кванты и уступки воспроизводятся одинаково на любой машине.
 *     Мини-планировщик темы (`SCHED_CODE`) и настоящий прогоняются **одним** `SCENARIO_CODE`;
 *     журналы (номер кванта, время, кусок, `didTimeout`) совпали дословно на всех сценариях
 *     темы и на 300 случайных (стенд), в тесте — на своих 200 случайных;
 *   — **`scheduler/unstable_mock`** (тестовая сборка команды React: часы двигает
 *     `unstable_advanceTime`, уступок по времени нет вовсе — `shouldYield` там отвечает по числу
 *     записей в журнале) — второй, независимый оракул **порядка**: на сценариях без нарезки
 *     последовательность задач совпала с мини-версией (200 случайных, `ORDER_LOG` дословно,
 *     со временем);
 *   — куча (`HEAP_CODE`) сверена с сортировкой на случайных операциях и **с кучей из исходника
 *     `scheduler`**: функции `push`/`peek`/`pop`/`compare` вырезаны из `unstable_mock` и собраны
 *     `new Function`; раскладка массива после каждой из 20 000 операций — та же;
 *   — `COST_ROWS`: счётчики сравнений и перемещений на n = 100/1000/10 000, ключи случайные
 *     (mulberry32, зерно 1, ключ 0…9999) и растущие (`5000 + i`). Это счёт операций, не время;
 *   — сроки приоритетов (`PRIORITY_ROWS`) — `expirationTime − startTime` задач, поставленных
 *     настоящим планировщиком; квант 5 мс — по моменту уступки на виртуальных часах;
 *   — «после продолжения уступает всегда» — у настоящего и у мини: колбэк, вернувший функцию
 *     через 0 мс работы, всё равно получает новую макрозадачу;
 *   — выбор хоста: при `setImmediate` планировщик ставит кванты им, без него — `MessageChannel`
 *     (в `vm` подложен счётчик портов).
 *
 * Снято стендом один раз, тестом не повторяется (живой браузер и живые часы):
 *   — Chromium 153: `setImmediate` нет, четыре куска одной задачи — четыре
 *     `MessagePort.prototype.postMessage`, ни одного `setTimeout`;
 *   — Chromium 153, `scheduler.postTask`: `background` и `user-visible`, поставленные первыми,
 *     ждали всю цепочку из 300 задач `user-blocking` по 2 мс (каждая ставит следующую):
 *     выполнились 301-й и 302-й;
 *   — Node 24.11: настоящий `scheduler` с `busy(1)` в цикле уступает каждые 5 кусков,
 *     кванты ставит `setImmediate` (5 вызовов, `setTimeout` — 0).
 *
 * Из документации и исходников, без проверки запуском: правило выбора очереди в спецификации
 * Prioritized Task Scheduling (самый высокий приоритет, при равенстве — самая старая задача по
 * «enqueue order») и отсутствие в ней старения; комментарий в `Scheduler.js` про уступку после
 * продолжения и файл `SchedulerFeatureFlags.js` с `frameYieldMs` — ссылки в `SOURCES`.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'очередь с приоритетом',
    d: 'Хранилище, из которого всегда достают самый срочный элемент, а не тот, что пришёл первым. Три операции: положить (`push`), посмотреть верхний (`peek`), достать верхний (`pop`).',
  },
  {
    k: 'двоичная куча (min-heap)',
    d: 'Самый частый способ сделать такую очередь. Дерево, где каждый родитель не больше своих детей, поэтому минимум всегда в корне. Хранится в обычном массиве, без объектов-узлов и ссылок.',
  },
  {
    k: 'просеивание',
    d: 'Ремонт кучи после правки. Вверх — новый элемент меняется с родителем, пока тот больше. Вниз — элемент, поставленный в корень, меняется с меньшим из детей, пока тот меньше.',
  },
  {
    k: '`O(log n)`',
    d: 'Работа растёт как высота дерева. В куче из тысячи элементов десять уровней, из миллиона — двадцать. Удвоили очередь — добавился один шаг.',
  },
  {
    k: 'квант',
    d: 'Отрезок времени, который планировщик работает без перерыва. У React — 5 мс. Потом он возвращает поток браузеру, даже если работа не кончилась.',
  },
  {
    k: 'продолжение',
    d: 'Функция, которую задача возвращает вместо `undefined`: «я не доделала, вот остаток». Планировщик оставляет задачу на месте и в следующий раз зовёт уже остаток.',
  },
  {
    k: 'срок (`expirationTime`)',
    d: 'Момент, к которому задачу пора сделать: время постановки плюс таймаут приоритета. По сроку задачи и упорядочены. Задача, чей срок прошёл, считается просроченной.',
  },
  {
    k: 'голодание',
    d: 'Задача с низким приоритетом не выполняется никогда, потому что всё время приходят более срочные. Лечится старением: чем дольше задача ждёт, тем она срочнее.',
  },
];

export const PLAIN_PQ =
  'Очередь с приоритетом — приёмный покой. Пациентов зовут не по порядку прихода, а по тяжести: с переломом — раньше, чем с занозой, даже если тот пришёл позже. Регистратору не нужен список, отсортированный целиком. Ему нужно одно: быстро узнать, кто сейчас самый тяжёлый, и быстро вписать нового.';

export const PREREQ_NOTE =
  'Тема опирается на три вещи из других тем и на одну школьную — она объяснена прямо на карточке.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'Задача и цикл событий',
    d: 'Браузер выполняет JS по одной задаче за раз, и пока задача идёт, страница не рисуется и не отвечает на клики. Между задачами браузер успевает и то и другое.',
    href: '/js/event-loop/#s1',
    hrefLabel: '«Event Loop», раздел «Оборот»',
    tone: 'info',
  },
  {
    t: 'Уступить поток',
    d: 'Длинную работу режут на куски и между кусками отдают управление циклу. Чем отдавать — `setTimeout`, `MessageChannel`, `scheduler.postTask`, `scheduler.yield` — и сколько это стоит, разобрано отдельно.',
    href: '/js/task-scheduling/#s1',
    hrefLabel: '«Планирование задач», раздел «Чем возвращать управление циклу»',
    tone: 'info',
  },
  {
    t: 'Сообщение порта — задача без задержки',
    d: '`port.postMessage` ставит новую задачу сразу, без минимальной паузы в 4 мс, как у вложенного `setTimeout`. Поэтому на нём и построен планировщик React.',
    href: '/js/message-channel/#s2',
    hrefLabel: '«MessageChannel», раздел «Почему планировщик React построен не на `setTimeout`»',
    tone: 'info',
  },
  {
    t: 'Двоичный логарифм',
    d: '`log₂ n` — сколько раз n можно поделить пополам, пока не останется единица. `log₂ 1024 = 10`, `log₂ 1 000 000 ≈ 20`. Растёт очень медленно — в этом вся выгода кучи.',
    tone: 'info',
  },
];

// ─── Раздел 1. Задача ──────────────────────────────────────────────────────────────────────

export const TASK_ROWS = [
  { k: 'клик по кнопке', who: 'пользователь ждёт отклика прямо сейчас', prio: '`UserBlockingPriority`', tone: 'err' as const },
  { k: 'рендер нового списка', who: 'нужен скоро, но может идти кусками', prio: '`NormalPriority`', tone: 'warn' as const },
  { k: 'предзагрузка следующей страницы', who: 'пригодится, если пользователь туда пойдёт', prio: '`LowPriority`', tone: 'info' as const },
  { k: 'отправка аналитики', who: 'никто не ждёт', prio: '`IdlePriority`', tone: 'ok' as const },
];

export const QUEUE_NOTE =
  'Поток один, и любая задача, начавшись, занимает его целиком. Планировщику остаётся решать только одно: **что взять следующим**. Задачи приходят в любом порядке и всё время, поэтому структура данных должна быстро делать две вещи: принимать новую задачу и отдавать самую срочную. Сортировать всё целиком не нужно.';

export const SORTED_CODE = `// Отсортированный массив: самый срочный — в конце, pop() бесплатный.
// Место вставки находит бинарный поиск, но все, кто срочнее, сдвигаются на клетку.
function insertSorted(arr, node) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (less(arr[mid], node)) hi = mid; else lo = mid + 1;
  }
  arr.push(node);
  for (let i = arr.length - 1; i > lo; i--) {
    arr[i] = arr[i - 1];                 // сдвиг на одну клетку вправо
    stats.moves++;
  }
  arr[lo] = node;
}`;

export const SORTED_NOTE =
  'Бинарный поиск находит место за `log n` сравнений — но вставка всё равно стоит `O(n)`: всех, кто правее, нужно сдвинуть. Хуже всего планировщику: срок задачи — «сейчас плюс таймаут», сейчас всё время растёт, и новая задача почти всегда **самая несрочная**. В массиве, где срочные в конце, она встаёт в начало и сдвигает всех. Если хранить срочные в начале, вставка дешёвая, зато `pop` сдвигает весь массив.';

/** Счётчики `stats` на n операций `push` (и n `pop` у кучи). Снято стендом, пересобирается тестом. */
export const COST_ROWS = [
  { keys: 'случайные', n: 100, heapPush: 104, heapPop: 409, sorted: 2384 },
  { keys: 'случайные', n: 1000, heapPush: 1201, heapPop: 7362, sorted: 254952 },
  { keys: 'случайные', n: 10000, heapPush: 12576, heapPop: 106802, sorted: 25105461 },
  { keys: 'растущие', n: 100, heapPush: 0, heapPop: 417, sorted: 4950 },
  { keys: 'растущие', n: 1000, heapPush: 0, heapPop: 7317, sorted: 499500 },
  { keys: 'растущие', n: 10000, heapPush: 0, heapPop: 106697, sorted: 49995000 },
];

export const COST_NOTE =
  'Перемещение — запись элемента на новое место в массиве. На десяти тысячах растущих ключей отсортированный массив делает 49 995 000 сдвигов — ровно `n·(n−1)/2`: каждая новая задача сдвигает всех, кто был до неё. Куча на тех же ключах при вставке не двигает ничего: новый элемент не срочнее родителя и остаётся внизу. Изъятие обходится примерно в 10,7 перемещения — чуть меньше высоты дерева (`log₂ 10 000 ≈ 13,3`).';

// ─── Раздел 2. Куча ────────────────────────────────────────────────────────────────────────

export const PLAIN_HEAP =
  'Куча — турнирная сетка наоборот. В каждом матче «побеждает» более срочный, и он стоит выше. Чемпион, самый срочный, — на вершине. Новичок начинает снизу и играет только с теми, кто над ним: если он срочнее, они меняются местами. Всю сетку переигрывать не надо — только одну ветку от низа до верха.';

export const HEAP_CODE = `// Куча — обычный массив. У элемента i родитель лежит в (i - 1) >> 1, дети — в 2i + 1 и 2i + 2.
// Наверху, в heap[0], всегда самый срочный: меньший sortIndex, при равенстве — меньший id.
const stats = { compares: 0, moves: 0 };

function less(a, b) {
  stats.compares++;
  return a.sortIndex !== b.sortIndex ? a.sortIndex < b.sortIndex : a.id < b.id;
}

function peek(heap) {
  return heap.length === 0 ? null : heap[0];
}

function push(heap, node) {
  let i = heap.length;
  heap.push(node);
  while (i > 0) {                        // просеивание вверх
    const parent = (i - 1) >> 1;
    if (!less(node, heap[parent])) break;
    heap[i] = heap[parent];              // родитель спускается на место ребёнка
    stats.moves++;
    i = parent;
  }
  heap[i] = node;
}

function pop(heap) {
  if (heap.length === 0) return null;
  const first = heap[0];
  const last = heap.pop();               // последний лист идёт на место корня
  if (heap.length > 0) {
    let i = 0;
    while (true) {                       // просеивание вниз
      const left = 2 * i + 1;
      const right = left + 1;
      if (left >= heap.length) break;
      const child = right < heap.length && less(heap[right], heap[left]) ? right : left;
      if (!less(heap[child], last)) break;
      heap[i] = heap[child];             // меньший ребёнок поднимается
      stats.moves++;
      i = child;
    }
    heap[i] = last;
  }
  return first;
}`;

export const HEAP_NOTE =
  'Дерево нигде не хранится: его форму задают индексы. Массив заполняется слева направо без дыр, поэтому дерево всегда **полное** — высота у него `⌊log₂ n⌋`, а родителя и детей находит арифметика. React делает то же самое (`SchedulerMinHeap.js`), только меняет элементы местами по одному, а здесь элемент «держат в руке» и пишут на место один раз. Раскладка массива после каждой операции у двух версий одинаковая.';

export const PLAIN_ARRAY_TREE =
  'Массив как дерево — нумерация мест в зрительном зале, где в каждом следующем ряду мест вдвое больше. Место 0 — первый ряд. Зрители мест 1 и 2 сидят прямо за ним, за местом 1 — места 3 и 4, за местом 2 — 5 и 6. Чтобы найти, кто сидит перед вами, не нужен план зала: достаточно `(i − 1) >> 1`.';

/** Пример по шагам: пять задач — те же сроки, что дают приоритеты при постановке в момент 0. */
export const PUSH_STEPS = [
  { op: '`push` A, 5000', arr: '`[A:5000]`', how: 'куча была пустой — A сразу корень' },
  { op: '`push` B, 250', arr: '`[B:250, A:5000]`', how: 'B встаёт в индекс 1, его родитель — индекс 0, A. 250 < 5000 — A спускается, B поднимается в корень' },
  { op: '`push` C, 10000', arr: '`[B:250, A:5000, C:10000]`', how: 'C встаёт в индекс 2 под B. 10000 > 250 — остаётся' },
  { op: '`push` D, −1', arr: '`[D:-1, B:250, C:10000, A:5000]`', how: 'D в индексе 3 под A. Обгоняет A, потом B — два шага вверх, до корня' },
  { op: '`push` E, 250', arr: '`[D:-1, B:250, C:10000, A:5000, E:250]`', how: 'E в индексе 4 под B. Сроки равны, а id у B меньше — E остаётся' },
  { op: '`pop` → D', arr: '`[B:250, E:250, C:10000, A:5000]`', how: 'на место корня встаёт последний лист E. Меньший ребёнок — B (250, id 2), он срочнее E — поднимается. Под E теперь только A, A не срочнее — стоп' },
];

export const STEPS_NOTE =
  'Массив `[D, B, C, A, E]` **не отсортирован**: C со сроком 10 000 стоит раньше A с 5000. Куча обещает только одно — корень самый срочный. Остальной порядок наводится лениво, по одной ветке за раз, и именно поэтому каждая операция дешёвая.';

export const HEAP_SCENARIOS: HeapScenario[] = [
  {
    id: 'five',
    label: 'Пять задач',
    note: 'Пять задач со сроками разных приоритетов: `−1` — Immediate, 250 — UserBlocking, 5000 — Normal, 10 000 — Low. Нажимайте «Шаг»: подсвечены элементы, которые сдвинулись, а счётчики показывают цену шага у кучи и у отсортированного массива.',
    ops: [
      { op: 'push', name: 'A', key: 5000 },
      { op: 'push', name: 'B', key: 250 },
      { op: 'push', name: 'C', key: 10000 },
      { op: 'push', name: 'D', key: -1 },
      { op: 'push', name: 'E', key: 250 },
      { op: 'pop' },
      { op: 'push', name: 'F', key: 100 },
      { op: 'pop' },
      { op: 'pop' },
      { op: 'pop' },
    ],
  },
  {
    id: 'growing',
    label: 'Растущие сроки',
    note: 'Так ключи приходят в настоящем планировщике: каждая следующая задача Normal ставится чуть позже, и её срок — `5000 + время` — больше всех прежних. Куча вставляет их без единого перемещения, отсортированный массив сдвигает всех.',
    ops: [
      ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((t) => ({ op: 'push' as const, name: String.fromCharCode(65 + t), key: 5000 + t })),
      { op: 'pop' },
      { op: 'pop' },
    ],
  },
  {
    id: 'ties',
    label: 'Равные сроки',
    note: 'Пять задач с одним и тем же сроком — например, пять `setState` в одну миллисекунду. Сравнение по `id` выдаёт их в порядке постановки: A, B, C, D, E.',
    ops: [
      ...['A', 'B', 'C', 'D', 'E'].map((name) => ({ op: 'push' as const, name, key: 5000 })),
      { op: 'pop' },
      { op: 'pop' },
      { op: 'pop' },
      { op: 'pop' },
      { op: 'pop' },
    ],
  },
  {
    id: 'ties-no-id',
    label: 'Без счётчика',
    note: 'Те же пять задач, но `less` сравнивает только срок. Порядок постановки потерян: после A выходит E, а B — последней.',
    noId: true,
    ops: [
      ...['A', 'B', 'C', 'D', 'E'].map((name) => ({ op: 'push' as const, name, key: 5000 })),
      { op: 'pop' },
      { op: 'pop' },
      { op: 'pop' },
      { op: 'pop' },
      { op: 'pop' },
    ],
  },
];

export const HEAP_CAPTION =
  'Перемещений у кучи на шаг не больше высоты дерева, у отсортированного массива — сколько угодно до длины очереди. Зато у массива бесплатен `pop`: самый срочный лежит в конце.';

// ─── Раздел 3. Равные сроки ────────────────────────────────────────────────────────────────

export const LESS_NO_ID_CODE = `// Сравнение только по сроку — так делать нельзя
function less(a, b) {
  stats.compares++;
  return a.sortIndex < b.sortIndex;
}`;

/** Порядок выхода n задач с одним сроком при `LESS_NO_ID_CODE`. Пересобирается тестом. */
export const NO_ID_ORDERS = [
  { n: 3, order: '1 3 2' },
  { n: 5, order: '1 5 4 3 2' },
  { n: 8, order: '1 8 7 6 5 4 3 2' },
];

export const STABLE_NOTE =
  'Куча **неустойчива**: элементы с равными ключами она выдаёт не в порядке прихода. Причина — `pop` ставит в корень последний лист, то есть самый свежий элемент, и при равенстве ему незачем опускаться. Для планировщика это ошибка: два обновления в одну миллисекунду обязаны примениться в том порядке, в каком их вызвали. Лечение — второй ключ: растущий счётчик `id`. В пакете `scheduler` это `taskIdCounter`, и `compare` сравнивает `sortIndex`, а при равенстве — `id`.';

export const STABLE_POSTTASK =
  'У `scheduler.postTask` то же правило записано в спецификации: внутри одного приоритета выбирается самая старая задача по «порядку постановки» (enqueue order), а он у всех задач разный. Это тот же счётчик, только в браузере.';

// ─── Раздел 4. Планировщик React ───────────────────────────────────────────────────────────

export const PLAIN_TWO_HEAPS =
  'Две кучи — две полки в почтовом отделении. На одной письма, которые можно выдавать, разложены по сроку. На другой — «вручить не раньше такого-то числа», разложены по этой дате. Каждое утро почтальон перекладывает со второй полки на первую то, чему пришёл день.';

/** Сроки приоритетов: `expirationTime − startTime` у настоящего `scheduler` 0.28. Сверяется тестом. */
export const PRIORITY_ROWS = [
  { name: 'ImmediatePriority', n: 1, timeout: -1, meaning: 'просрочена в момент постановки: выполняется с `didTimeout = true` и не уступает' },
  { name: 'UserBlockingPriority', n: 2, timeout: 250, meaning: 'отклик на ввод: четверть секунды — и задача просрочена' },
  { name: 'NormalPriority', n: 3, timeout: 5000, meaning: 'приоритет по умолчанию' },
  { name: 'LowPriority', n: 4, timeout: 10000, meaning: 'то, что подождёт' },
  { name: 'IdlePriority', n: 5, timeout: 1073741823, meaning: '2³⁰ − 1 мс, около 12,4 суток: на деле «никогда»' },
];

export const PRIORITY_NOTE =
  'Приоритет в планировщике не хранится как отдельный ключ кучи. Он превращается в **срок**: `expirationTime = startTime + timeout`, и задачи сравниваются только по сроку. Отсюда два следствия. Задача Normal, поставленная пять секунд назад, срочнее только что пришедшей UserBlocking. А у Immediate срок уже в прошлом — она выполняется первой и без уступок.';

export const HOST_CODE = `// Виртуальная среда вместо браузера: часы стоят, пока задача не скажет work(ms).
// Цикл событий — одна очередь макрозадач; таймер встаёт в неё, когда подошло его время.
function createHost() {
  let time = 0;
  let nextTimerId = 1;
  let turn = 0;                          // номер макрозадачи — по нему видно уступки
  const ready = [];                      // очередь макрозадач
  const timers = [];                     // { at, id, fn }

  function queueDueTimers() {
    timers.sort((a, b) => a.at - b.at || a.id - b.id);
    while (timers.length > 0 && timers[0].at <= time) ready.push(timers.shift().fn);
  }

  return {
    now: () => time,
    turn: () => turn,
    work(ms) { time += ms; },                                // задача «считала» ms
    postTask(fn) { queueDueTimers(); ready.push(fn); },     // MessageChannel / setImmediate
    setTimer(fn, ms) {                                       // setTimeout
      const id = nextTimerId++;
      timers.push({ at: time + Math.max(ms, 0), id, fn });
      return id;
    },
    clearTimer(id) {
      const i = timers.findIndex((t) => t.id === id);
      if (i !== -1) timers.splice(i, 1);
    },
    run(limit = 10000) {                                     // крутить цикл, пока есть дела
      while (turn < limit) {
        queueDueTimers();
        if (ready.length === 0) {
          if (timers.length === 0) return;
          time = Math.max(time, timers[0].at);               // простой: часы прыгают к таймеру
          continue;
        }
        turn++;
        ready.shift()();
      }
    },
  };
}`;

export const HOST_NOTE =
  'В браузере `now` — это `performance.now()`, `postTask` — `port.postMessage` у `MessageChannel`, `setTimer` — `setTimeout`. Здесь всё то же, но часы виртуальные: время идёт, только когда работа говорит `work(ms)`. Таймер, чьё время пришло, встаёт в очередь раньше сообщения, отправленного позже, — как клик, случившийся посреди долгой задачи.';

export const SCHED_CODE = `// Приоритеты и сроки ожидания — как в пакете scheduler 0.28.
const ImmediatePriority = 1, UserBlockingPriority = 2, NormalPriority = 3,
  LowPriority = 4, IdlePriority = 5;
const TIMEOUT = { 1: -1, 2: 250, 3: 5000, 4: 10000, 5: 1073741823 };
const FRAME_MS = 5;                       // квант: столько работать без уступки

function createScheduler(host) {
  const taskQueue = [];                   // готовые задачи; ключ — срок, expirationTime
  const timerQueue = [];                  // отложенные; ключ — время старта, startTime
  let nextId = 1;
  let sliceStart = 0;
  let loopRunning = false;                // макрозадача с workLoop уже поставлена
  let timerId = null;

  function shouldYield() {
    return host.now() - sliceStart >= FRAME_MS;
  }

  function scheduleCallback(priority, callback, delay = 0) {
    const now = host.now();
    const startTime = delay > 0 ? now + delay : now;
    const task = {
      id: nextId++, callback, priority, startTime,
      expirationTime: startTime + TIMEOUT[priority],
      sortIndex: 0,
    };
    if (startTime > now) {                // отложенная — ждёт в куче таймеров
      task.sortIndex = startTime;
      push(timerQueue, task);
      if (peek(taskQueue) === null && peek(timerQueue) === task) armTimer(startTime - now);
    } else {
      task.sortIndex = task.expirationTime;
      push(taskQueue, task);
      requestLoop();
    }
    return task;
  }

  function cancelCallback(task) {
    task.callback = null;                 // из кучи не вынимают: пропустят, когда всплывёт
  }

  // Таймеры, чьё время пришло, переезжают в кучу задач — с новым ключом.
  function advanceTimers(now) {
    let timer = peek(timerQueue);
    while (timer !== null) {
      if (timer.callback === null) pop(timerQueue);
      else if (timer.startTime <= now) {
        pop(timerQueue);
        timer.sortIndex = timer.expirationTime;
        push(taskQueue, timer);
      } else return;
      timer = peek(timerQueue);
    }
  }

  function requestLoop() {
    if (loopRunning) return;
    loopRunning = true;
    host.postTask(workLoop);
  }

  function armTimer(ms) {
    if (timerId !== null) host.clearTimer(timerId);
    timerId = host.setTimer(() => {
      timerId = null;
      const now = host.now();
      advanceTimers(now);
      if (peek(taskQueue) !== null) requestLoop();
      else if (peek(timerQueue) !== null) armTimer(peek(timerQueue).startTime - now);
    }, ms);
  }

  // Одна макрозадача — один квант.
  function workLoop() {
    let now = host.now();
    sliceStart = now;
    if (timerId !== null) { host.clearTimer(timerId); timerId = null; }
    advanceTimers(now);
    let task = peek(taskQueue);
    while (task !== null) {
      if (task.expirationTime > now && shouldYield()) break;  // просроченная не уступает
      const callback = task.callback;
      if (typeof callback !== 'function') { pop(taskQueue); task = peek(taskQueue); continue; }
      task.callback = null;
      const next = callback(task.expirationTime <= now);       // аргумент — didTimeout
      now = host.now();
      if (typeof next === 'function') {   // продолжение: та же задача, то же место в куче
        task.callback = next;
        advanceTimers(now);
        host.postTask(workLoop);          // и уступить сразу, даже если квант не кончился
        return;
      }
      if (task === peek(taskQueue)) pop(taskQueue);
      advanceTimers(now);
      task = peek(taskQueue);
    }
    if (task !== null) { host.postTask(workLoop); return; }   // квант кончился, работа есть
    loopRunning = false;
    const timer = peek(timerQueue);
    if (timer !== null) armTimer(timer.startTime - now);
  }

  return { scheduleCallback, cancelCallback, shouldYield, now: host.now };
}`;

export const SCHED_FACTS = [
  {
    t: 'Ключ меняется при переезде',
    d: 'В куче таймеров задача лежит по `startTime` — важно, **когда** её можно начать. Переехав в кучу задач, она получает ключ `expirationTime` — важно, **к какому сроку** её сделать. Один и тот же объект, две кучи, два ключа.',
  },
  {
    t: 'Отмена — ленивая',
    d: '`cancelCallback` только обнуляет `callback`. Вынуть элемент из середины кучи дорого: его ещё надо найти. Пустую задачу выбросят, когда она всплывёт наверх, — `pop` и так понадобится.',
  },
  {
    t: 'Таймер хоста — один',
    d: '`setTimeout` ставится только на самую раннюю отложенную задачу и только когда готовых задач нет. Пока идёт работа, отложенные переезжают сами — `advanceTimers` после каждой задачи.',
  },
  {
    t: 'Макрозадача — одна',
    d: 'Флаг `loopRunning` склеивает постановки: сто `scheduleCallback` подряд дают одно сообщение, а не сто. Пока квант идёт, новые задачи просто ложатся в кучу.',
  },
];

export const HOST_FACTS =
  'Чем ставить следующий квант, настоящий пакет выбирает при загрузке: `setImmediate`, если он есть (Node и старый IE), иначе `MessageChannel`, иначе `setTimeout(…, 0)`. В Chromium 153 `setImmediate` нет, и четыре куска одной задачи — это четыре вызова `port.postMessage` и ни одного `setTimeout`. Почему не таймер — в [«MessageChannel», раздел «Тайминг»](/js/message-channel/#s2); как `setImmediate` встаёт в фазы Node — в [«Цикле событий Node», раздел «setTimeout и setImmediate»](/js/node-event-loop/#s4).';

export const PRIORITY_DEMO_LOG_NOTE =
  'Шесть задач поставлены в момент 0, у каждой кусок в 1 мс. Срок решает всё: Immediate (`−1`), UserBlocking (250), Normal (5000), Low (10 000), Idle. Шестая — Normal с `delay: 10`: она лежит в куче таймеров и попадает в работу только на десятой миллисекунде, отдельным квантом.';

/** Журнал сценария «Порядок»: `#квант t=мс имяКусок`, `!` — didTimeout. Сверяется тестом у трёх реализаций. */
export const ORDER_LOG = ['#1 t=0 I0!', '#1 t=1 U0', '#1 t=2 N0', '#1 t=3 L0', '#1 t=4 Z0', '#2 t=10 D0'];

// ─── Раздел 5. Нарезка ─────────────────────────────────────────────────────────────────────

export const PLAIN_SLICE =
  'Нарезка времени — шахматист на сеансе одновременной игры. Он делает ход за одной доской и идёт дальше, не дожидаясь, пока партия кончится. Партия длинная, но каждый соперник ждёт недолго. Сделать ход — квант; доска, к которой он вернётся, — продолжение.';

export const JOB_CODE = `// Работа, которую можно резать: units — куски по столько-то миллисекунд.
function makeJob(scheduler, host, job, log) {
  let done = 0;
  return function run(didTimeout) {
    while (done < job.units.length) {
      log(job.name, done, didTimeout);
      host.work(job.units[done]);
      done++;
      const more = done < job.units.length;
      if (more && !didTimeout && scheduler.shouldYield()) return run;   // продолжение
    }
    return null;
  };
}`;

export const SCENARIO_CODE = `// Сценарий — список работ; at — когда работа появится (клик, ответ сети), мс.
function runScenario(jobs) {
  const host = createHost();
  const scheduler = createScheduler(host);
  const log = [];
  const record = (name, part, didTimeout) =>
    log.push({ turn: host.turn(), t: host.now(), name, part, didTimeout });
  const add = (job) =>
    scheduler.scheduleCallback(job.priority, makeJob(scheduler, host, job, record), job.delay ?? 0);
  for (const job of jobs) {
    if (job.at > 0) host.setTimer(() => add(job), job.at);
    else add(job);
  }
  host.run();
  return log;
}`;

export const JOB_NOTE =
  '`shouldYield` спрашивает **сама работа**, между своими кусками. Планировщик не может остановить функцию посреди выполнения — в JS нет вытеснения. Он может только не позвать следующую задачу и ответить «пора» на вопрос. Поэтому квант — нижняя граница, а не точная: кусок в 2 мс, начатый на 4-й миллисекунде, доработает до 6-й.';

export const CONTINUATION_NOTE =
  '**Продолжение сохраняет срок.** Задача, вернувшая функцию, остаётся в куче с прежним `expirationTime`. Задачи того же приоритета, пришедшие позже, её не обгонят: их срок дальше. Обгонит только более срочная — клик UserBlocking со сроком «сейчас + 250».';

export const ALWAYS_YIELD_NOTE =
  '**В 0.28 после продолжения планировщик уступает всегда** — даже если квант не кончился. Так написано в исходнике: «If a continuation is returned, immediately yield to the main thread regardless of how much time is left in the current time slice». Задача, вернувшая функцию через 0 мс работы, всё равно получает новую макрозадачу — у настоящего пакета и у мини-версии. Цикл не тратит остаток кванта на следующую задачу: браузер получает поток при каждой возможности.';

/** «Нарезка и клик»: журнал при клике UserBlocking и при клике Normal. Сверяется тестом. */
export const SLICE_LOGS = {
  userBlocking: ['#1 t=0 R0', '#1 t=2 R1', '#1 t=4 R2', '#2 t=6 C0', '#2 t=7 R3', '#2 t=9 R4', '#3 t=11 R5', '#3 t=13 R6', '#3 t=15 R7'],
  normal: ['#1 t=0 R0', '#1 t=2 R1', '#1 t=4 R2', '#2 t=6 R3', '#2 t=8 R4', '#2 t=10 R5', '#3 t=12 R6', '#3 t=14 R7', '#3 t=16 C0'],
};

export const SLICE_NOTE =
  'Рендер R — восемь кусков по 2 мс, приоритет Normal. На 5-й миллисекунде приходит клик C. Квант R кончается на 6-й (три куска — 6 мс, проверка между кусками), и в очереди уже лежит событие клика: оно поставило C в кучу раньше, чем продолжился R. Клик UserBlocking (срок 255) обгоняет R (срок 5000) и выполняется на 6-й мс. Клик Normal получает срок 5005 — позже, чем у R, — и ждёт, пока R доделает всё, до 16-й мс.';

const STARVE_JOBS: Job[] = [
  { name: 'U', priority: 2, units: [5] },
  { name: 'N', priority: 3, at: 1, units: [1] },
  ...Array.from({ length: 1499 }, (_, i): Job => ({ name: 'U', priority: 2, at: 4 * (i + 1), units: [5] })),
];

export const SCHED_SCENARIOS: SchedScenario[] = [
  {
    id: 'order',
    label: 'Порядок',
    note: PRIORITY_DEMO_LOG_NOTE,
    jobs: [
      { name: 'N', priority: 3, units: [1] },
      { name: 'L', priority: 4, units: [1] },
      { name: 'U', priority: 2, units: [1] },
      { name: 'I', priority: 1, units: [1] },
      { name: 'Z', priority: 5, units: [1] },
      { name: 'D', priority: 3, delay: 10, units: [1] },
    ],
  },
  {
    id: 'slice',
    label: 'Нарезка и клик',
    note: 'Рендер R — восемь кусков по 2 мс. На 5-й миллисекунде клик C ставит задачу в 1 мс. Смените приоритет клика: UserBlocking влезает между квантами, Normal и Low ждут конца рендера.',
    pickPriorityOf: 'C',
    jobs: [
      { name: 'R', priority: 3, units: [2, 2, 2, 2, 2, 2, 2, 2] },
      { name: 'C', priority: 2, at: 5, units: [1] },
    ],
  },
  {
    id: 'continue',
    label: 'Продолжение',
    note: 'A и B — Normal, поставлены подряд. A уступает после пяти кусков, но во втором кванте продолжается **A**, а не B: продолжение сохраняет срок. Клик C (UserBlocking) на 3-й мс встаёт перед ним.',
    pickPriorityOf: 'C',
    jobs: [
      { name: 'A', priority: 3, units: [1, 1, 1, 1, 1, 1, 1, 1] },
      { name: 'B', priority: 3, units: [1, 1, 1] },
      { name: 'C', priority: 2, at: 3, units: [1] },
    ],
  },
  {
    id: 'expired',
    label: 'Просрочка',
    note: 'U — UserBlocking, сорок кусков по 10 мс. Каждый кусок длиннее кванта, и до 250-й мс задача уступает после каждого. На 250-й её срок прошёл: она получает `didTimeout = true` и доделывает остаток одним квантом в 150 мс. N ждёт до конца.',
    jobs: [
      { name: 'U', priority: 2, units: Array.from({ length: 40 }, () => 10) },
      { name: 'N', priority: 3, units: [1] },
    ],
  },
  {
    id: 'starve',
    label: 'Голодание',
    note: 'Поток кликов: каждые 4 мс задача UserBlocking на 5 мс — очередь растёт быстрее, чем разбирается. Задача N (Normal) поставлена на 1-й мс. Каждый новый клик получает срок «сейчас + 250», и пока он раньше 5001, клик обгоняет N.',
    jobs: STARVE_JOBS,
  },
];

export const SCHED_CAPTION =
  'Полосы — куски работы на виртуальной шкале, вертикальные черты — начала квантов, то есть макрозадач, в которых шла работа. Точка над полосой — момент, когда работа появилась. Кусок, выполненный с `didTimeout = true`, обведён тёмно-красным. Журнал считает мини-планировщик темы; у настоящего пакета `scheduler` 0.28 на тех же часах он тот же.';

// ─── Раздел 6. Голодание ───────────────────────────────────────────────────────────────────

/** Сценарий «Голодание» в цифрах: у мини-версии и у настоящего пакета одинаково. Сверяется тестом. */
export const STARVE_FACTS = { startedAt: 5595, clicksBefore: 1119, didTimeout: true };

export const STARVE_NOTE =
  'N поставлена на 1-й мс со сроком 5001 и выполнилась на **5595-й**, пропустив вперёд 1119 кликов, — с `didTimeout = true`. Обгонять её перестали клики, чей срок оказался позже 5001, то есть поставленные на 4751-й мс и позже (при равных сроках N выигрывает по `id`). Голодание не исчезло, но у него есть потолок: таймаут приоритета. Через пять секунд Normal становится срочнее любого свежего UserBlocking, через десять — Low.';

export const PLAIN_AGING =
  'Старение по сроку — очередь в банке с талоном, где на талоне написано не «номер 42», а «принять до 15:05». Срочным клиентам пишут время поближе, обычным — подальше. Но обычный, пришедший утром, всё равно окажется раньше срочного, пришедшего к обеду: его время на талоне раньше.';

export const EXPIRED_NOTE =
  'У просрочки второй эффект — в рабочем цикле: `if (task.expirationTime > now && shouldYield()) break`. Просроченная задача квант не спрашивает. Планировщик вызывает её, даже если 5 мс давно прошли, и передаёт `didTimeout = true` — React в этом случае рендерит остаток без проверок `shouldYield`. Страница в это время не отвечает — это осознанная цена: лучше один долгий кадр, чем обновление, которое не наступает никогда.';

export const POSTTASK_NOTE =
  '`scheduler.postTask` в браузере устроен иначе: три приоритета — три очереди, и спецификация выбирает самую срочную непустую. Сроков и старения в ней нет. В Chromium 153 задачи `background` и `user-visible`, поставленные **раньше**, ждали всю цепочку из 300 задач `user-blocking` (каждая ставила следующую) и выполнились 301-й и 302-й. Для фоновой работы это нормально, но если низкий приоритет обязан когда-нибудь наступить, срок приходится вести самому — или поднимать приоритет через `TaskController.setPriority`, как в [«Планировании задач»](/js/task-scheduling/#s1).';

export const LANES_LINK =
  'У React есть и второй уровень защиты от голодания — на полосах: обновление, ждущее слишком долго, помечается просроченным и рендерится синхронно. Это уже не планировщик, а реконсилер — разобрано в [«React изнутри: конкурентность и lanes», раздел «Голодание»](/frameworks/react-concurrent-internals/#s6).';

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'Массив кучи — не порядок выполнения',
    d: 'В отладчике `taskQueue` выглядит как `[D, B, C, A, E]`, и кажется, что C выполнится третьей. Нет: отсортирован только корень. Порядок узнают последовательными `pop`, а не чтением массива.',
    tone: 'warn',
  },
  {
    n: '02',
    t: 'Без счётчика равные ключи перемешиваются',
    d: 'Куча неустойчива: три задачи с одним сроком без второго ключа выходят как 1, 3, 2. Для обновлений состояния это потерянный порядок `setState`, и ни одной ошибки в консоли.',
    tone: 'err',
  },
  {
    n: '03',
    t: 'Квант не прерывает длинный кусок',
    d: '`shouldYield` — вопрос, а не прерывание. Кусок на 300 мс доработает до конца, и 5 мс тут ничего не изменят. Резать работу должна сама задача — проверять `shouldYield` достаточно часто.',
    tone: 'err',
  },
  {
    n: '04',
    t: 'Immediate — не синхронно',
    d: 'Задача ImmediatePriority всё равно ждёт макрозадачи. Зато, начавшись, она не уступает вовсе: её срок `−1` в прошлом с момента постановки. Длинная Immediate блокирует страницу целиком.',
    tone: 'warn',
  },
  {
    n: '05',
    t: '`delay` сдвигает и срок',
    d: 'Отложенная задача считает срок от момента старта: `startTime + timeout`. Normal с `delay: 1000` станет просроченной через 6 с после постановки, а не через 5.',
  },
  {
    n: '06',
    t: 'Idle может не наступить никогда',
    d: 'Таймаут Idle — 1 073 741 823 мс, около 12,4 суток. Пока приходит другая работа, Idle-задача ждёт. Отправку, которая обязана случиться, на Idle не ставят.',
    tone: 'warn',
  },
  {
    n: '07',
    t: 'Отменённая задача занимает место',
    d: '`cancelCallback` не вынимает задачу из кучи, а обнуляет колбэк. Тысяча отменённых задач — это тысяча элементов, которые `pop` будет доставать впустую. Держать на объекте задачи тяжёлые данные после отмены не стоит.',
  },
  {
    n: '08',
    t: '`unstable_` — значит внутреннее',
    d: 'Пакет `scheduler` — внутренняя часть React, и его API помечен `unstable_`: сохранять его между версиями никто не обещает. Для своей работы в браузере есть стандартный `scheduler.postTask` — его разбор в теме «Планирование задач».',
    tone: 'warn',
  },
];

// ─── Источники ─────────────────────────────────────────────────────────────────────────────

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'React — packages/scheduler/src/forks/Scheduler.js',
    href: 'https://github.com/facebook/react/blob/main/packages/scheduler/src/forks/Scheduler.js',
    what: '`unstable_scheduleCallback`, `workLoop`, `advanceTimers`, `shouldYieldToHost`, уступка после продолжения, выбор `setImmediate` / `MessageChannel` / `setTimeout`',
  },
  {
    title: 'React — packages/scheduler/src/SchedulerMinHeap.js',
    href: 'https://github.com/facebook/react/blob/main/packages/scheduler/src/SchedulerMinHeap.js',
    what: 'куча на массиве и `compare` по `sortIndex`, затем по `id`',
  },
  {
    title: 'React — packages/scheduler/src/SchedulerFeatureFlags.js',
    href: 'https://github.com/facebook/react/blob/main/packages/scheduler/src/SchedulerFeatureFlags.js',
    what: '`frameYieldMs` — квант 5 мс и таймауты приоритетов',
  },
  {
    title: 'React — packages/scheduler/src/forks/SchedulerMock.js',
    href: 'https://github.com/facebook/react/blob/main/packages/scheduler/src/forks/SchedulerMock.js',
    what: 'тестовая сборка `unstable_mock`: ручные часы, `flushAll`, `advanceTime`',
  },
  {
    title: 'WICG — Prioritized Task Scheduling',
    href: 'https://wicg.github.io/scheduling-apis/',
    what: '`scheduler.postTask`, выбор очереди по приоритету и по порядку постановки (enqueue order)',
  },
  {
    title: 'MDN — Scheduler.postTask()',
    href: 'https://developer.mozilla.org/en-US/docs/Web/API/Scheduler/postTask',
    what: 'приоритеты `user-blocking`, `user-visible`, `background`, `delay`, `signal`',
  },
  {
    title: 'Wikipedia — Binary heap',
    href: 'https://en.wikipedia.org/wiki/Binary_heap',
    what: 'массив как дерево, просеивание вверх и вниз, оценки `O(log n)`',
  },
];

export const RELATED =
  'Смежное на сайте: [Планирование задач](/js/task-scheduling/) — чем уступать поток, `scheduler.postTask` и `scheduler.yield`, цена уступки. [MessageChannel, раздел «Тайминг»](/js/message-channel/#s2) — почему кванты ставятся сообщением порта. [React изнутри: конкурентность и lanes](/frameworks/react-concurrent-internals/#s2) — как React отдаёт планировщику рендер и что делает с полосами. [Ре-рендеринг в React, раздел «Батчинг и нарезка»](/frameworks/react-rerender/#s4) — нарезка глазами компонента. [Event Loop](/js/event-loop/) и [Цикл событий Node](/js/node-event-loop/#s4) — откуда берутся макрозадачи. [Debounce, throttle и token bucket](/algorithms/rate-limiting/) — один бюджет событий во времени: обёртки и ограничители. [Пространственные индексы](/algorithms/spatial-index/) — сетка, quadtree и R-tree для попадания курсором и рамки. [Кеши с вытеснением](/algorithms/eviction/) — LRU на `Map` и в `lru-cache`, провалы LRU на скане и цикле, LFU, W-TinyLFU и SIEVE.';
