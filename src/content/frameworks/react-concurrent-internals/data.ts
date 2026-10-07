import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { LanesScenario } from '@/widgets/mini-lanes/model/types';
import { STEP_ELEMENT } from '../react-internals/data';

/**
 * Данные темы «React изнутри: конкурентность и lanes».
 *
 * Тема продолжает мини-рендерер из «React изнутри: свой рендерер и хуки» и добавляет к нему
 * то, чего там нет: полосы, планировщик, прерывание с перезапуском, переходы, Suspense
 * и просрочку. Каждый шаг — строка кода (`STEP_*`), напечатанная в своём разделе;
 * `MINI_LANES_CODE` — те же строки подряд. Её исполняют **и тест, и демо**, обе стороны через
 * `buildMiniLanes` из `widgets/mini-lanes/model/build.ts`. Шаг «элемент» не переписан, а взят
 * строкой `STEP_ELEMENT` из темы «React изнутри» — копий кода нет нигде.
 *
 * Время у мини-версии виртуальное: его двигает только `work(ms)` в компонентах сценария.
 * Поэтому квант, прерывание и просрочка воспроизводятся одинаково везде и без таймеров.
 *
 * Код сценариев (`SCENARIO_*`) исполняется дважды: мини-версией и **настоящим React 19.3.0**
 * в `tests/unit/react-concurrent-internals.test.ts`. React там работает без `act` (под `act`
 * он рендерит переходы синхронным циклом и не прерывается никогда) и на подменённом
 * планировщике `scheduler/unstable_mock`: уступки и часы задаёт тест, тоже без таймеров.
 *
 * Что проверено этим тестом (Node 26.8.2, React 19.3.0, отладочная сборка — `NODE_ENV=test`):
 *   — биты `SyncLane` = 2 и `DefaultLane` = 32 — в `pendingLanes` корня у обоих; полоса
 *     перехода у React — один бит от 256 и выше, и номер зависит от числа прошлых переходов;
 *   — `INTERRUPT_LOG` — дословно у обоих: клик посреди перехода выбрасывает начатое дерево,
 *     `App` вызывается заново; итог тот же, что без прерывания;
 *   — `DefaultLane` переход не прерывает — у обоих;
 *   — `REBASE_LOG`, `PENDING_LOG`, `DEFERRED_LOG` — дословно у обоих;
 *   — Suspense: заглушка → содержимое; переход держит прежнюю страницу и `isPending` — у обоих;
 *   — после `await` в `startTransition` обновление получает `DefaultLane` — у обоих;
 *   — просрочка: у React рендер перестаёт уступать после сдвига часов на 6 с; у мини-версии —
 *     `STARVE_FACTS` на виртуальных часах;
 *   — `<StrictMode>` зовёт функцию дважды — только отладочная сборка React;
 *   — **намеренные отличия**: предпрогрев Suspense (React зовёт `Page 0` дважды) и пачка
 *     срочных полос (`SYNC_BATCH_LOG`).
 *
 * Не проверено запуском, а взято из исходников React 19.3 (`react-dom-client.development.js`,
 * `scheduler.development.js`; ссылки в `SOURCES`): таблица полос целиком (`LANES_TABLE`),
 * десять полос переходов по кругу, `FALLBACK_THROTTLE_MS` = 300, квант планировщика 5 мс,
 * порядок `setImmediate` → `MessageChannel` → `setTimeout`, сцепление полос. Эти утверждения
 * помечены в тексте как устройство, а не как наблюдение.
 */

export { STEP_ELEMENT };

/* ───────────────────────────── Код мини-реализации ───────────────────────────── */


/** Раздел «Полосы»: приоритет — это бит, набор приоритетов — число. */
export const STEP_LANES = `// Полоса — один бит. Чем младше бит, тем срочнее работа. Значения — как в React 19.3
const NoLanes = 0;
const SyncLane = 1 << 1;             //       2 — клик, нажатие клавиши
const InputContinuousLane = 1 << 3; //       8 — mousemove, scroll, wheel
const DefaultLane = 1 << 5;         //      32 — setState вне события: таймер, ответ fetch
const TransitionLane = 1 << 8;      //     256 — внутри startTransition
const RetryLane = 1 << 22;          // 4194304 — повторная попытка после Suspense

// Операции над наборами — одна инструкция процессора каждая
const mergeLanes = (a, b) => a | b;
const removeLanes = (set, subset) => set & ~subset;
const includesSomeLane = (a, b) => (a & b) !== NoLanes;
const isSubsetOfLanes = (set, subset) => (set & subset) === subset;
// Младший установленный бит: в дополнительном коде -x — это ~x + 1
const getHighestPriorityLane = (lanes) => lanes & -lanes;

// Что рендерить следующим: самую срочную из ожидающих полос
function getNextLanes(root, wipLanes) {
  const pending = removeLanes(root.pendingLanes, root.suspendedLanes); // уснувшие ждут промиса
  if (pending === NoLanes) return NoLanes;
  const next = getHighestPriorityLane(pending);
  if (wipLanes !== NoLanes && wipLanes !== next) {
    // Начатый рендер не бросают ради работы не срочнее его самого. И отдельное правило:
    // DefaultLane не прерывает переход — считается, что такое обновление короткое
    const notUrgentEnough = next >= wipLanes || (next === DefaultLane && wipLanes === TransitionLane);
    if (notUrgentEnough) return wipLanes;
  }
  return next;
}`;

/** Раздел «Планировщик»: очередь задач с дедлайнами и квант на виртуальных часах. */
export const STEP_SCHEDULER = `// Приоритеты планировщика — у него свои, а не полосы: он ничего не знает о React
const ImmediatePriority = 1, UserBlockingPriority = 2, NormalPriority = 3;
const TIMEOUT = { 1: -1, 2: 250, 3: 5000 };   // сколько задача может ждать, мс
const frameInterval = 5;                      // квант: 5 мс, потом поток отдают браузеру

let taskQueue = [];
let taskIdCounter = 0;
let hostCallbackScheduled = false;
let startTime = -1;

function scheduleCallback(priority, callback) {
  const now = host.now();
  const task = { id: ++taskIdCounter, callback, priority, expirationTime: now + TIMEOUT[priority] };
  taskQueue.push(task);
  // Порядок — по дедлайну: срочная задача получает ранний. У React вместо сортировки куча
  taskQueue.sort((a, b) => a.expirationTime - b.expirationTime || a.id - b.id);
  if (!hostCallbackScheduled) {
    hostCallbackScheduled = true;
    host.postTask(flushWork);       // в браузере — MessageChannel, а не setTimeout
  }
  return task;
}

function cancelCallback(task) {
  task.callback = null;             // из кучи не вынимают: пустую задачу пропустят при разборе
}

function shouldYield() {
  return host.now() - startTime >= frameInterval;
}

// Одна макрозадача: разбирать очередь, пока не кончится квант
function flushWork() {
  hostCallbackScheduled = false;
  startTime = host.now();
  while (taskQueue.length > 0) {
    const task = taskQueue[0];
    if (task.callback === null) { taskQueue.shift(); continue; }
    const didTimeout = task.expirationTime <= host.now();
    if (!didTimeout && shouldYield()) break;          // просроченная задача не уступает
    const callback = task.callback;
    task.callback = null;
    const continuation = callback(didTimeout);
    if (typeof continuation === 'function') task.callback = continuation; // та же задача, дальше
    else taskQueue.splice(taskQueue.indexOf(task), 1);
  }
  if (taskQueue.some((task) => task.callback !== null)) {
    hostCallbackScheduled = true;
    host.postTask(flushWork);       // остальное — следующей макрозадачей, после отрисовки
  }
}`;

/** Раздел «Прерывание»: корень, заказ работы и рендер, который можно выбросить. */
export const STEP_ROOT = `const root = {
  current: null,                // дерево на экране
  element: null,                // что рендерить: <App />
  pendingLanes: NoLanes,        // полосы, где есть необработанные обновления
  suspendedLanes: NoLanes,      // полосы, уснувшие на промисе
  expiredLanes: NoLanes,        // полосы, которые ждут дольше положенного
  expirationTimes: {},          // полоса → когда она просрочится
  callbackNode: null,           // задача в планировщике
  callbackLane: NoLanes,        // и полоса, ради которой она заказана
};

let wipRoot = null;               // корень дерева в работе
let wipRootLanes = NoLanes;       // полоса, которую это дерево рендерит
let workInProgress = null;        // закладка: следующий файбер
let wipRemainingLanes = NoLanes;  // что рендер оставил на потом

function render(element) {
  root.element = element;
  scheduleUpdateOnRoot(requestUpdateLane());
}

function scheduleUpdateOnRoot(lane) {
  root.pendingLanes = mergeLanes(root.pendingLanes, lane);
  // Обновление той же полосы посреди её рендера: рендер его уже не увидит — не потерять
  if (workInProgress && includesSomeLane(wipRootLanes, lane)) wipRemainingLanes |= lane;
  ensureRootIsScheduled();
}

// Одна задача на корень, заказанная с приоритетом самой срочной полосы
function ensureRootIsScheduled() {
  markStarvedLanesAsExpired(host.now());
  const lane = getHighestPriorityLane(getNextLanes(root, wipRootLanes));
  if (lane === root.callbackLane) return;          // такая уже стоит в очереди
  if (root.callbackNode) cancelCallback(root.callbackNode);
  root.callbackNode = null;
  root.callbackLane = lane;
  if (lane === NoLanes) return;
  if (lane === SyncLane) host.scheduleMicrotask(performSyncWork);   // до конца текущей задачи
  else root.callbackNode = scheduleCallback(lanePriority(lane), performConcurrentWork);
}

function lanePriority(lane) {
  return lane === InputContinuousLane ? UserBlockingPriority : NormalPriority;
}

function performSyncWork() {
  if (root.callbackLane !== SyncLane) return;
  root.callbackLane = NoLanes;
  renderRoot(getNextLanes(root, wipRootLanes), true);
  ensureRootIsScheduled();
}

function performConcurrentWork(didTimeout) {
  const node = root.callbackNode;
  const lanes = getNextLanes(root, wipRootLanes);
  if (lanes === NoLanes) return null;
  // Просроченную полосу рендерят без уступок — как срочную
  renderRoot(lanes, didTimeout || includesSomeLane(root.expiredLanes, lanes));
  if (workInProgress && root.callbackNode === node) return performConcurrentWork; // квант кончился
  if (root.callbackNode === node) { root.callbackNode = null; root.callbackLane = NoLanes; }
  ensureRootIsScheduled();
  return null;
}

function renderRoot(lanes, sync) {
  // Другая полоса — начатое дерево выбрасывается, рендер идёт с корня заново
  if (lanes !== wipRootLanes || wipRoot === null) prepareFreshStack(lanes);
  while (workInProgress !== null && (sync || !shouldYield())) {
    workInProgress = performUnitOfWork(workInProgress);
  }
  if (workInProgress === null && wipRoot !== null) commitRoot();
}

function prepareFreshStack(lanes) {
  wipRootLanes = lanes;
  wipRemainingLanes = NoLanes;
  wipRoot = createFiber(null, null, { children: [root.element] }, root.current);
  workInProgress = wipRoot;
}`;

/** Раздел «Прерывание»: единица работы, дети и коммит — короче, чем в «React изнутри». */
export const STEP_WORK = `function createFiber(type, key, props, alternate) {
  return { type, key, props, alternate, return: null, child: null, sibling: null, index: 0, hooks: null };
}

function performUnitOfWork(fiber) {
  try {
    if (typeof fiber.type === 'function') updateFunctionComponent(fiber);
    else if (fiber.type === Suspense) updateSuspenseComponent(fiber);
    else if (fiber.type !== TEXT) reconcileChildren(fiber, fiber.props.children);
  } catch (thrown) {
    return throwException(fiber, thrown);       // промис — это Suspense, см. ниже
  }
  if (fiber.child) return fiber.child;
  for (let next = fiber; next; next = next.return) {
    if (next.sibling) return next.sibling;
  }
  return null;
}

// Пару в прошлом дереве ищем по ключу или позиции — и только при том же типе
function reconcileChildren(wip, elements) {
  const old = new Map();
  for (let c = wip.alternate ? wip.alternate.child : null; c; c = c.sibling) old.set(c.key ?? c.index, c);
  let prev = null;
  elements.forEach((element, index) => {
    const match = old.get(element.key ?? index);
    const fiber = createFiber(element.type, element.key, element.props,
      match && match.type === element.type ? match : null);
    fiber.index = index;
    fiber.return = wip;
    if (prev) prev.sibling = fiber;
    else wip.child = fiber;
    prev = fiber;
  });
}

// Коммит одним заходом: полосы снять, очереди почистить, дерево показать
function commitRoot() {
  const finished = wipRoot;
  root.pendingLanes = mergeLanes(removeLanes(root.pendingLanes, wipRootLanes), wipRemainingLanes);
  root.expiredLanes &= root.pendingLanes;
  for (const lane of Object.keys(root.expirationTimes)) {
    if (!includesSomeLane(root.pendingLanes, Number(lane))) delete root.expirationTimes[lane];
  }
  forEachFiber(finished, (fiber) => {
    for (const hook of fiber.hooks ?? []) if (hook.queue) hook.queue.pending.splice(0, hook.consumed);
  });
  root.current = finished;
  wipRoot = null;
  workInProgress = null;
  wipRootLanes = NoLanes;
  host.commit(toMarkup(finished));   // в «React изнутри» здесь были вставки и правки узлов
}

function forEachFiber(fiber, visit) {
  visit(fiber);
  for (let c = fiber.child; c; c = c.sibling) forEachFiber(c, visit);
}

function toMarkup(fiber) {
  let inner = '';
  for (let c = fiber.child; c; c = c.sibling) inner += toMarkup(c);
  if (fiber.type === TEXT) return fiber.props.nodeValue;
  if (typeof fiber.type === 'string') return '<' + fiber.type + '>' + inner + '</' + fiber.type + '>';
  return inner;
}`;

/** Раздел «Переходы»: обновление несёт полосу, рендер берёт только свои. */
export const STEP_UPDATES = `let wipFiber = null;
let hookIndex = 0;
let currentUpdateLane = NoLanes;  // полоса, которую выставил обработчик или startTransition

function updateFunctionComponent(fiber) {
  wipFiber = fiber;
  hookIndex = 0;
  fiber.hooks = [];
  const child = fiber.type(fiber.props);
  reconcileChildren(fiber, child == null ? [] : [child]);
}

function nextOldHook() {
  const old = wipFiber.alternate?.hooks?.[hookIndex] ?? null;
  hookIndex++;
  return old;
}

function requestUpdateLane() {
  return currentUpdateLane !== NoLanes ? currentUpdateLane : DefaultLane;
}

function useState(initial) {
  const old = nextOldHook();
  const queue = old ? old.queue : { pending: [] };
  let state = old ? old.baseState : typeof initial === 'function' ? initial() : initial;
  let newBaseState = null;
  const kept = [];
  for (const update of [...(old ? old.baseUpdates : []), ...queue.pending]) {
    if (!isSubsetOfLanes(wipRootLanes, update.lane)) {
      // Не наша полоса: пропустить, но запомнить, с какого состояния придётся переиграть
      if (newBaseState === null) newBaseState = state;
      kept.push(update);
      wipRemainingLanes |= update.lane;
      continue;
    }
    // После пропущенного обновление применяется сейчас и ещё раз потом — в исходном порядке
    if (newBaseState !== null) kept.push({ ...update, lane: NoLanes });
    state = typeof update.action === 'function' ? update.action(state) : update.action;
  }
  const setState = old ? old.setState : (action) => {
    const lane = requestUpdateLane();   // полосу выбирает не setState, а момент вызова
    queue.pending.push({ action, lane });
    scheduleUpdateOnRoot(lane);
  };
  wipFiber.hooks.push({
    queue, setState, state,
    baseState: newBaseState ?? state, baseUpdates: kept,
    consumed: queue.pending.length,     // очередь чистит коммит, а не рендер
  });
  return [state, setState];
}`;

/** Раздел «Переходы»: три API — одна идея, «пометить полосой Transition». */
export const STEP_TRANSITION = `function runWithLane(lane, callback) {
  const previous = currentUpdateLane;
  currentUpdateLane = lane;
  try { callback(); } finally { currentUpdateLane = previous; }
}

// Весь startTransition: обновления внутри получают полосу перехода. Колбэк — сразу
function startTransition(callback) {
  runWithLane(TransitionLane, callback);
}

// Так React DOM оборачивает обработчик клика: всё, что внутри, — SyncLane
function discreteUpdates(callback) {
  runWithLane(SyncLane, callback);
}

function useTransition() {
  const [isPending, setPending] = useState(false);
  const start = (callback) => {
    setPending(true);                 // полоса события: срочно, с прежним состоянием
    startTransition(() => {
      setPending(false);              // полоса перехода: вместе с самим обновлением
      callback();
    });
  };
  return [isPending, start];
}

function useDeferredValue(value) {
  const old = nextOldHook();
  let shown = value;
  if (old && !Object.is(old.value, value) && wipRootLanes !== TransitionLane) {
    shown = old.value;                         // срочный рендер: показать прежнее
    wipRemainingLanes |= TransitionLane;       // и заказать несрочный — с новым
  }
  wipFiber.hooks.push({ value: shown });
  return shown;
}`;

/** Раздел «Suspense»: брошенный промис ловит ближайшая граница. */
export const STEP_SUSPENSE = `const Suspense = { name: 'Suspense' };

function updateSuspenseComponent(fiber) {
  // Сперва — дети. Если кто-то из них бросит промис, сюда вернутся уже с didSuspend
  reconcileChildren(fiber, fiber.didSuspend ? [fiber.props.fallback] : fiber.props.children);
}

function throwException(fiber, thrown) {
  if (typeof thrown?.then !== 'function') throw thrown;     // обычная ошибка — не к Suspense
  let boundary = fiber.return;
  while (boundary && boundary.type !== Suspense) boundary = boundary.return;
  if (!boundary) throw new Error('компонент приостановился, а границы <Suspense> над ним нет');

  const wasShowingContent = boundary.alternate !== null && !boundary.alternate.didSuspend;
  if (wipRootLanes === TransitionLane && wasShowingContent) {
    // Переход не прячет уже показанное: рендер откладывается целиком, на экране прежнее
    root.suspendedLanes |= wipRootLanes;
    thrown.then(() => pingRoot(TransitionLane));
    wipRoot = null;
    wipRootLanes = NoLanes;
    return null;
  }
  thrown.then(() => pingRoot(RetryLane));
  boundary.didSuspend = true;
  boundary.child = null;
  return boundary;           // тот же файбер ещё раз — теперь с заглушкой вместо детей
}

function pingRoot(lane) {
  root.suspendedLanes = removeLanes(root.suspendedLanes, lane);
  scheduleUpdateOnRoot(lane);
}`;

/** Раздел «Голодание»: у каждой полосы есть срок, после него она перестаёт уступать. */
export const STEP_EXPIRE = `function markStarvedLanesAsExpired(now) {
  for (let lanes = root.pendingLanes; lanes !== NoLanes; ) {
    const lane = getHighestPriorityLane(lanes);
    lanes = removeLanes(lanes, lane);
    const expiresAt = root.expirationTimes[lane];
    if (expiresAt === undefined) root.expirationTimes[lane] = computeExpirationTime(lane, now);
    else if (expiresAt !== -1 && expiresAt <= now) root.expiredLanes |= lane;
  }
}

function computeExpirationTime(lane, now) {
  switch (lane) {
    case SyncLane:
    case InputContinuousLane: return now + 250;
    case DefaultLane:
    case TransitionLane: return now + 5000;
    default: return -1;      // RetryLane не просрочивается: торопить промис бессмысленно
  }
}`;

/**
 * Вся мини-реализация — шаги подряд. Объявления функций всплывают, а `let` и `const`
 * успевают выполниться до первого вызова: первый вызов делает `render` снаружи.
 */
export const MINI_LANES_CODE = [
  STEP_ELEMENT,
  STEP_LANES,
  STEP_SCHEDULER,
  STEP_ROOT,
  STEP_WORK,
  STEP_UPDATES,
  STEP_TRANSITION,
  STEP_SUSPENSE,
  STEP_EXPIRE,
].join('\n\n');

/** Хост мини-версии: часы, две очереди и «экран». Печатается в разделе про планировщик. */
export const HOST_SHAPE = `const host = {
  now() {},                  // виртуальные часы: время идёт, только когда компонент «работает»
  postTask(callback) {},     // макрозадача — у React это MessageChannel
  scheduleMicrotask(callback) {},
  commit(markup) {},         // показать закоммиченное дерево
};`;

/* ─────────────────────────────── Сценарии ─────────────────────────────── */

/**
 * Сценарии исполняются дважды: мини-версией и настоящим React 19.3.0 в тесте. Каким событием
 * пришло действие — клик или таймер, — решает вызывающий (демо, тест), а не код сценария:
 * так устроен и React DOM — полосу `setState` выбирает момент вызова.
 */

/** Срочный ввод посреди перехода: список из шести «тяжёлых» строк и строка ввода. */
export const SCENARIO_INTERRUPT = `function Item({ i, query }) {
  work(2);                                  // «тяжёлая» строка: 2 мс на виртуальных часах
  log('Item ' + i + ' query="' + query + '"');
  return h('li', null, query + i);
}

function App() {
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  log('App text="' + text + '" query="' + query + '"');
  expose('transition', () => startTransition(() => setQuery((q) => q + 'x')));
  expose('input', () => setText((t) => t + 'a'));
  return h('div', null,
    h('p', null, 'ввод: ', text),
    h('ul', null, [0, 1, 2, 3, 4, 5].map((i) => h(Item, { key: i, i, query }))));
}`;

/** Одно состояние, два обновления в разных полосах: порядок сохраняется. */
export const SCENARIO_REBASE = `function App() {
  const [trail, setTrail] = useState('');
  log('render trail="' + trail + '"');
  expose('both', () => {
    startTransition(() => setTrail((s) => s + 'T'));   // первым — несрочное
    setTrail((s) => s + 'S');                          // вторым — срочное
  });
  return h('p', null, trail);
}`;

export const SCENARIO_PENDING = `function App() {
  const [tab, setTab] = useState('a');
  const [isPending, start] = useTransition();
  log('App tab=' + tab + ' isPending=' + isPending);
  expose('switch', () => start(() => setTab('b')));
  return h('p', null, tab, isPending ? ' …' : '');
}`;

export const SCENARIO_DEFERRED = `function Slow({ value }) {
  work(10);
  log('Slow ' + value);
  return h('b', null, value);
}

function App() {
  const [value, setValue] = useState(0);
  const deferred = useDeferredValue(value);
  log('App value=' + value + ' deferred=' + deferred);
  expose('bump', () => setValue((v) => v + 1));
  return h('div', null, h('p', null, value), h(Slow, { value: deferred }));
}`;

/** Suspense: ресурс — «промис» с ручным выполнением, чтобы кнопка и тест решали, когда. */
export const SCENARIO_SUSPENSE = `function createResource(value) {
  let ready = false;
  const waiting = [];
  const thenable = { then(onReady) { waiting.push(onReady); } };
  return {
    ready: () => ready,
    read() {
      if (!ready) throw thenable;            // не готово — бросить промис, а не вернуть null
      return value;
    },
    resolve() {
      ready = true;
      waiting.splice(0).forEach((onReady) => onReady());
    },
  };
}

const pages = [createResource('первая страница'), createResource('вторая страница')];

function Page({ n }) {
  log('render Page ' + n);
  return h('p', null, pages[n].read());
}

function App() {
  const [n, setN] = useState(0);
  const [isPending, start] = useTransition();
  log('render App n=' + n + ' isPending=' + isPending);
  expose('next', () => start(() => setN(1)));
  expose('resolve', () => pages.find((page) => !page.ready())?.resolve());
  return h('div', null,
    h(Suspense, { fallback: h('i', null, 'загрузка…') }, h(Page, { n })),
    isPending ? h('i', null, 'грузим вторую…') : null);
}`;

/** Голодание: каждая строка — 100 мс, а срочный ввод приходит после каждого кванта. */
export const SCENARIO_STARVE = `function Item({ i, query }) {
  work(query ? 100 : 5);                    // строка с результатом дорогая, пустая — нет
  log('Item ' + i + ' query="' + query + '"');
  return h('li', null, query + i);
}

function App() {
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  log('App text="' + text + '" query="' + query + '"');
  expose('transition', () => startTransition(() => setQuery('x')));
  expose('input', () => setText((t) => t + 'a'));
  return h('div', null,
    h('p', null, text),
    h('ul', null, [0, 1, 2, 3, 4, 5, 6, 7].map((i) => h(Item, { key: i, i, query }))));
}`;

/** StrictMode в отладочной сборке: функция компонента — дважды на один рендер. */
export const SCENARIO_STRICT = `let calls = 0;

function App() {
  calls += 1;                               // побочный эффект в теле — так делать нельзя
  log('вызов ' + calls);
  return h('p', null, 'вызовов: ' + calls);
}`;

/* ──────────────────────── Что сверено с настоящим React ──────────────────────── */

/**
 * Срочный ввод посреди перехода (`SCENARIO_INTERRUPT`): лог дословно одинаков у мини-версии
 * и у React 19.3. Первые четыре строки — начатый и выброшенный рендер перехода.
 */
export const INTERRUPT_LOG = [
  'App text="" query="x"',
  'Item 0 query="x"',
  'Item 1 query="x"',
  'Item 2 query="x"',
  'App text="a" query=""',
  'Item 0 query=""',
  'Item 1 query=""',
  'Item 2 query=""',
  'Item 3 query=""',
  'Item 4 query=""',
  'Item 5 query=""',
  'App text="a" query="x"',
  'Item 0 query="x"',
  'Item 1 query="x"',
  'Item 2 query="x"',
  'Item 3 query="x"',
  'Item 4 query="x"',
  'Item 5 query="x"',
];

/** Async-переход: обновление после `await` уже не в полосе перехода. */
export const SCENARIO_ASYNC = `function App() {
  const [value, setValue] = useState('');
  log('render ' + value);
  expose('action', () => startTransition(async () => {
    setValue('до await');           // TransitionLane
    await null;
    setValue('после await');        // полосу выбирает момент вызова — а момент уже другой
  }));
  return h('p', null, value);
}`;

/** Намеренное отличие: таймер и клик до рендера. React 19.3 рендерит Sync и Default пачкой. */
export const SYNC_BATCH_LOG = {
  react: ['App text="aa" query=""'],
  mini: ['App text="a" query=""', 'App text="aa" query=""'],
};

/**
 * Голодание (`SCENARIO_STARVE`) на мини-версии: переход заказан в t=0, срочный ввод приходит
 * после каждого кванта. Числа сняты тестом на виртуальных часах и потому точные.
 */
export const STARVE_FACTS = {
  /** Столько раз начатое дерево перехода выброшено. */
  restarts: 36,
  /** Срок полосы перехода: t=0 + 5000 мс. */
  expiresAt: 5000,
  /** Когда переход всё-таки закоммичен — последний заход идёт целиком, 8 строк по 100 мс. */
  committedAt: 5880,
};

/** `SCENARIO_REBASE` после клика: одинаково у обоих. */
export const REBASE_LOG = ['render trail="S"', 'render trail="TS"'];

/** `SCENARIO_PENDING` после клика: одинаково у обоих. */
export const PENDING_LOG = ['App tab=a isPending=true', 'App tab=b isPending=false'];

/** `SCENARIO_DEFERRED` после клика: одинаково у обоих (без `memo`, поэтому `Slow` — дважды). */
export const DEFERRED_LOG = ['App value=1 deferred=0', 'Slow 0', 'App value=1 deferred=1', 'Slow 1'];

/** `INTERRUPT_LOG` для печати: где кончился квант и где пришёл клик. */
export const INTERRUPT_SHOWN = [
  '// переход: квант 5 мс — App и три строки по 2 мс',
  ...INTERRUPT_LOG.slice(0, 4),
  '// клик: SyncLane срочнее — начатое дерево выброшено',
  ...INTERRUPT_LOG.slice(4, 11),
  '// коммит «ввод: a» со старым списком; переход — заново, с App',
  ...INTERRUPT_LOG.slice(11),
].join('\n');

/* ─────────────────────────────── Демо ─────────────────────────────── */

export const DEMO_SCENARIOS: LanesScenario[] = [
  {
    key: 'interrupt',
    label: 'переход и срочный ввод',
    code: SCENARIO_INTERRUPT,
    actions: [
      { name: 'transition', label: 'startTransition(setQuery)', event: 'discrete' },
      { name: 'input', label: 'срочный ввод (клик)', event: 'discrete' },
      { name: 'input', label: 'setText из таймера', event: 'default' },
    ],
    note: 'Нажмите `startTransition` и пройдите несколько шагов: рендер перехода режется на кванты по 5 мс — `App` и три строки по 2 мс, потом уступка. Теперь «срочный ввод»: `SyncLane` уходит микрозадачей, начатое дерево выбрасывается (на шкале — пустой пунктир), срочный рендер коммитит `ввод: a` со **старым** списком, и переход начинается **с `App`** заново. Тот же ввод «из таймера» получает `DefaultLane` и переход не прерывает — он встаёт в очередь за ним.',
  },
  {
    key: 'suspense',
    label: 'Suspense и переход',
    code: SCENARIO_SUSPENSE,
    actions: [
      { name: 'resolve', label: 'промис выполнился', event: 'default' },
      { name: 'next', label: 'перейти: useTransition', event: 'discrete' },
    ],
    note: 'На монтировании `Page 0` бросает промис — граница показывает заглушку. «Промис выполнился» — пинг ставит `RetryLane`, и рендер пробует снова. Потом «перейти»: срочный рендер коммитит `isPending=true` с прежней страницей, а переход натыкается на новый промис и **не** прячет показанное — полоса перехода засыпает, дерево выброшено, на экране первая страница и «грузим вторую…». Второе «промис выполнился» будит полосу.',
  },
];

export const DEMO_NOTE =
  'Демо исполняет тот же код, что напечатан в разделах выше, — в вашем браузере, на виртуальных часах. «Шаг» за последним кадром выполняет следующую микрозадачу или макрозадачу хоста, а кнопки вызывают `setState` ровно там, где вы остановились: срочный ввод можно нажать между двумя квантами перехода. Полоса главного потока внизу рисует каждый заход рендера цветом его полосы; выброшенные заходы — пустые, с красной рамкой.';

/* ───────────────────────────── Текст темы ───────────────────────────── */

export const GLOSSARY = [
  {
    k: 'полоса (lane)',
    d: 'Приоритет обновления, записанный одним битом числа: `SyncLane` — 2, `DefaultLane` — 32, полосы переходов — от 256. Набор полос — то же число, в котором поднято несколько битов.',
  },
  {
    k: '`pendingLanes`',
    d: 'Поле корня: какие полосы ждут рендера. Каждый `setState` поднимает бит своей полосы, коммит опускает биты тех, что отрендерены.',
  },
  {
    k: 'планировщик (Scheduler)',
    d: 'Отдельный пакет `scheduler`: очередь задач с дедлайнами, которая режет работу на кванты и отдаёт поток браузеру между ними. О React он не знает ничего — React только отдаёт ему функции.',
  },
  {
    k: 'квант и `shouldYield`',
    d: 'Сколько работать без перерыва — 5 мс. `shouldYield()` отвечает «пора», когда квант исчерпан; рабочий цикл спрашивает его между файберами.',
  },
  {
    k: 'переход (transition)',
    d: 'Обновление в полосе перехода: его рендер можно резать, прерывать и выбрасывать. Ставят такую полосу `startTransition`, `useTransition` и `useDeferredValue`.',
  },
  {
    k: 'граница Suspense',
    d: 'Компонент `<Suspense fallback={…}>`. Ловит промис, брошенный кем-то из потомков во время рендера, и показывает заглушку вместо своего поддерева.',
  },
  {
    k: 'пинг',
    d: 'Колбэк на выполнение промиса, который бросил компонент. Снимает с полосы пометку «спит» и заказывает новый рендер.',
  },
  {
    k: 'дискретное событие',
    d: 'Событие с чёткой границей: клик, нажатие клавиши, `input`. React DOM даёт обновлениям внутри него `SyncLane`. Непрерывные — `mousemove`, `scroll`, `wheel` — получают `InputContinuousLane`.',
  },
];

export const PREREQ_NOTE =
  'Конкурентность — надстройка над рабочим циклом, а не новый рендерер: всё, что ниже, меняет только то, **когда** цикл запускается, **какие** обновления он учитывает и **выбрасывает** ли он результат.';

export const PREREQ = [
  {
    t: 'Файбер и прерываемый цикл',
    d: 'Рендер — обход дерева файберов по одному, с закладкой `workInProgress`: между любыми двумя файберами цикл может остановиться. Здесь этот цикл получает приоритеты.',
    href: '/frameworks/react-internals/#s2',
    hrefLabel: 'React изнутри · Файбер и цикл',
    tone: 'info' as const,
  },
  {
    t: 'Render можно выбросить, commit — нет',
    d: 'Дерево в работе строится вне экрана, а коммит показывает его одним заходом. Всё прерывание держится на этом: выбросить можно только то, чего пользователь не видел.',
    href: '/frameworks/react-internals/#s3',
    hrefLabel: 'React изнутри · Две фазы',
    tone: 'ok' as const,
  },
  {
    t: 'Как переходы выглядят снаружи',
    d: 'Сколько раз вызывается компонент, что показывает `isPending`, когда нужен `useDeferredValue`, а когда не поможет ни то ни другое, — описано там; здесь — код, который даёт это поведение.',
    href: '/frameworks/react-rerender/#s4',
    hrefLabel: 'Ре-рендеринг в React · Батчинг и нарезка',
    tone: 'warn' as const,
  },
  {
    t: 'Микрозадача, макрозадача и кадр',
    d: 'Срочный рендер ставится микрозадачей и успевает до отрисовки — это порядок шагов цикла событий, [Event Loop · Checkpoint](/js/event-loop/#s3). Следующий квант перехода — макрозадачей через `MessageChannel`, и почему не `setTimeout` — там, куда ведёт ссылка ниже.',
    href: '/js/message-channel/#s2',
    hrefLabel: 'MessageChannel · Тайминг',
    tone: 'err' as const,
  },
];

export const S1_LEAD =
  'У каждого обновления есть полоса — один бит. У корня есть `pendingLanes` — число, в котором подняты биты всех полос, ждущих рендера. Решить, что рендерить сейчас, значит выбрать один бит из этого числа, и делает это одна функция — `getNextLanes`.';

export const PLAIN_LANES =
  'Полосы — лампочки на пульте диспетчера: у каждой срочности своя, и горящие видно одним взглядом. Чтобы понять, есть ли срочная заявка, не нужно перебирать стопку бумаг — достаточно посмотреть на самую правую горящую лампочку: срочные стоят справа. Новая заявка зажигает свою лампочку, не трогая остальных; выполненная — гасит.';

/**
 * `getNextLanes` на трёх входящих. Автор курса (2026-09-29): не сокращать, а объяснять подробно.
 * Правило «не бросать ради работы не срочнее» и исключение про `DefaultLane` стояли в коде
 * `STEP_LANES` комментарием; здесь они посчитаны по этому коду. Это арифметика над битами
 * из `STEP_LANES`, а не замер. Что таймерный ввод встаёт за переходом, а клик выбрасывает
 * начатое, — сценарии демо, сверенные тестом с React 19.3.
 */
export const NEXT_LANES_SCENE_NOTE =
  'Идёт рендер перехода: `wipLanes = 256`, в `pendingLanes` тоже `256`. Что было бы **без выбора по битам**: любое новое обновление либо всегда прерывало бы переход — и долгий список не дорисовался бы никогда, пока пользователь двигает мышью, — либо всегда ждало бы его конца, и клик залипал бы. `getNextLanes` решает это на каждом входящем. Три случая, посчитанных по коду выше:';

export const NEXT_LANES_SCENE_STEPS: { k: string; math: string; what: string }[] = [
  {
    k: 'Клик: `SyncLane` = 2',
    math: '`pending = 256 | 2 = 258`, `next = 258 & -258 = 2`',
    what: '`2 >= 256`? Нет. Не `DefaultLane`. Значит, клик срочнее — возвращается `2`, и `renderRoot` видит другую полосу: `prepareFreshStack`, начатое дерево перехода — мусор. Переход начнётся заново, когда клик закоммитится.',
  },
  {
    k: 'Движение мыши: `InputContinuousLane` = 8',
    math: '`pending = 256 | 8 = 264`, `next = 8`',
    what: '`8 >= 256`? Нет — тоже прерывание. Непрерывные события срочнее перехода; именно поэтому переход при активной мыши может перезапускаться раз за разом — и на этот случай у полос есть срок, о нём раздел «Голодание».',
  },
  {
    k: '`setState` из таймера: `DefaultLane` = 32',
    math: '`pending = 256 | 32 = 288`, `next = 32`',
    what: '`32 >= 256`? Нет, по одному числу `DefaultLane` срочнее. Но срабатывает отдельное правило: `next === DefaultLane && wipLanes === TransitionLane` — возвращается `256`, переход продолжается с закладки, а обновление из таймера ждёт своей очереди. Расчёт в том, что такое обновление короткое и подождать может.',
  },
];

export const LANES_TABLE = {
  head: ['полоса', 'бит', 'откуда берётся', 'срок'],
  rows: [
    ['`SyncLane`', '`1 << 1` = 2', 'клик, клавиша, `input` — дискретные события; `flushSync`', '250 мс'],
    ['`InputContinuousLane`', '`1 << 3` = 8', '`mousemove`, `scroll`, `wheel` — непрерывные события', '250 мс'],
    ['`DefaultLane`', '`1 << 5` = 32', '`setState` вне события: таймер, ответ `fetch`, `root.render`', '5 с'],
    ['полосы переходов', '`1 << 8` … `1 << 17`', '`startTransition`, `useTransition`, `useDeferredValue` — каждый новый переход берёт следующий бит по кругу', '5 с'],
    ['полосы повтора', '`1 << 22` … `1 << 25`', 'пинг от промиса, брошенного под `Suspense`', 'нет'],
    ['`IdleLane`', '`1 << 28`', 'работа, которую можно делать, когда больше нечего', 'нет'],
  ],
};

export const LANES_NOTE =
  'Значения — из исходников React 19.3. Биты между строками таблицы — 1, 4, 16, 128 — полосы гидратации, по одной на приоритет. У мини-версии полоса перехода одна — `1 << 8`.';

export const WHY_BITS =
  '**Почему биты, а не число «приоритет».** Число описывает одно обновление, а корню нужно **множество**: какие приоритеты вообще ждут. Список пришлось бы обходить и сортировать; маска отвечает на любой вопрос одной операцией: `a | b` — объединить, `a & b` — пересечь, `a & ~b` — вычесть, `lanes & -lanes` — взять самый срочный. Та же маска живёт на файбере (`lanes`) и на его предках (`childLanes`): пустой `childLanes` — и всё поддерево пропускается одним сравнением. Это и есть bailout из [«Ре-рендеринга в React», раздел «Дерево»](/frameworks/react-rerender/#s2).';

export const WHY_LOW_BIT =
  '**Почему срочное — младший бит.** В дополнительном коде `-x` равно `~x + 1`: все биты переворачиваются, и единица переносится вверх до первого нуля — то есть до младшей единицы исходного числа. `x & -x` оставляет только её. Для `pendingLanes = 290` (256 + 32 + 2) это `2` — `SyncLane`. Выбор следующей работы — одна инструкция процессора, без цикла.';

export const S2_LEAD =
  'Рендер перехода идёт кусками, и между кусками браузер успевает обработать ввод и нарисовать кадр. Резать работу умеет не React, а пакет `scheduler`: очередь задач, упорядоченная по дедлайну, и квант в 5 мс. React отдаёт ему функцию «порендерь немного», а тот решает, когда её звать и когда остановить.';

export const PLAIN_SCHEDULER =
  'Планировщик — повар на раздаче с таймером на пять минут. Берёт заказ с самым ранним сроком и готовит, пока не зазвенит таймер, — потом выходит в зал: вдруг там что-то срочное. Недоготовленное блюдо не выбрасывается, оно стоит на плите, и следующий подход начинается с него. А заказ, который уже опаздывает, повар доделывает, не глядя на таймер.';

export const CLOCK_NOTE =
  '**Виртуальные часы.** У настоящего планировщика `now()` — это `performance.now()`, и где кончится квант, зависит от скорости машины. У мини-версии часы двигает только компонент: `work(2)` значит «я считал две миллисекунды». Поэтому прерывание в демо случается в одном и том же месте — после третьей строки списка — на любом компьютере.';

export const CONTINUATION_NOTE =
  '**Продолжение — та же задача.** Колбэк вернул функцию — задача остаётся в очереди с прежним дедлайном, а колбэком становится возвращённое. Рендер перехода не уступает место свежим задачам с дальним сроком — среди задач планировщика он по-прежнему первый по сроку. Но поток после продолжения отдаётся браузеру **всегда**, даже если квант не кончился: в `scheduler` 0.28 вернувшая функцию задача завершает текущую порцию работы (стенд темы [«Планировщики»](/algorithms/schedulers/)). Мини-планировщик этой темы упрощает это место. А задача, чей дедлайн прошёл (`didTimeout`), квант не спрашивает вовсе.';

export const PRIORITIES_NOTE =
  '**Приоритетов два набора.** Полосы — язык React, у планировщика свой: `Immediate`, `UserBlocking`, `Normal`, `Idle` со сроками ожидания −1, 250 мс, 5 с и «никогда». `ensureRootIsScheduled` переводит самую срочную полосу в приоритет и держит **одну** задачу на корень: пришла полоса срочнее — старая задача отменяется. `SyncLane` в планировщик не попадает вовсе: её рендер ставится микрозадачей и выполняется до отрисовки кадра.';

export const YIELD_LINK =
  'Следующий квант планировщик ставит макрозадачей: в браузере — через `MessageChannel`, в Node — через `setImmediate`, и только там, где нет ни того ни другого, — через `setTimeout` (порядок проверок в `scheduler.development.js` 0.28). Почему не `setTimeout`: вложенные таймеры браузер зажимает до 4 мс, и пять квантов теряли бы на ожидании больше, чем работали, — [«MessageChannel», раздел «Тайминг»](/js/message-channel/#s2).';

export const S3_LEAD =
  'Рендер перехода идёт, и между двумя квантами приходит клик. У клика своя полоса, срочнее. Доделывать переход React не станет: дерево в работе посчитано без клика, а показать нужно клик. Начатое дерево выбрасывается целиком, срочный рендер проходит и коммитится, а переход начинается снова — с корня.';

export const PLAIN_RESTART =
  'Вы переписываете длинный отчёт набело, и начальник приносит правку в первую страницу. Дописывать чистовик нет смысла — он уже неверен. Лист отправляется в корзину, правка вносится в черновик, и переписывание начинается с первой строки. Потеряна работа, но не данные: черновик — очередь обновлений — цел.';

export const INTERRUPT_NOTE =
  'Лог одинаков у мини-версии и у React 19.3, и итоговая разметка та же, что без прерывания: `ввод: a` и список с `x`. Прерывание меняет число вызовов, а не результат — потому что очередь хука чистит коммит, а не рендер, и перезапущенный рендер проходит по той же очереди заново.';

export const PURE_NOTE =
  '**Отсюда — чистота render-фазы.** Первые четыре строки лога — вызовы, результата которых никто никогда не увидит. Всё, что тело компонента делает кроме вычисления разметки, — запрос, подписка, счётчик снаружи, — выполнилось бы и там, и ещё раз при повторе. Сколько раз будет вызвана функция компонента, в конкурентном React **не определено**: столько, сколько раз рендер начинали.';

export const STRICT_NOTE =
  '**StrictMode — репетиция прерывания.** Отладочная сборка React в `<StrictMode>` зовёт функцию компонента **дважды** на каждый рендер — чтобы нечистое тело проявилось сразу, а не при редком прерывании. Счётчик в теле это показывает: один коммит, два вызова, на экране `вызовов: 2`. В продакшен-сборке двойного вызова нет (по документации React), а прерывания — есть.';

export const DEFAULT_NOTE =
  '**Не каждое обновление прерывает переход.** Прерывает только то, что срочнее: `getNextLanes` оставляет начатую полосу, если новая не младше её. И отдельная строка для `DefaultLane`: обновление из таймера или ответа сети переход **не** прерывает — React считает его коротким и ставит за переходом. В React 19.3 так же: ввод, пришедший без события, ждёт, пока переход доделает строки 3–5 и закоммитится.';

export const S4_LEAD =
  '`startTransition(fn)` вызывает `fn` сразу и синхронно. Отложен не код, а рендер: на время вызова выставлена «текущая полоса» — полоса перехода, и каждый `setState` внутри берёт её. Всё остальное — `isPending`, отложенное значение, порядок обновлений — следует из двух правил: у обновления есть полоса, и рендер применяет только обновления своих полос.';

/**
 * Перебазирование по шагам. Автор курса (2026-09-29): трудное не сокращать, а объяснять подробно.
 * `REBASE_NOTE` описывал оба рендера одним абзацем; здесь очередь `SCENARIO_REBASE` пройдена
 * по обновлениям, с базой и остатком после каждого. Итоговый лог — `REBASE_LOG`, сверенный тестом
 * с React 19.3; механика — код `STEP_UPDATES` (`baseState`, `baseUpdates`, копия с `NoLanes`).
 */
export const REBASE_SCENE_NOTE =
  'Что было бы **без базы**. Срочный рендер применил бы `S` и показал `S` — это верно. А переход потом взял бы то, что на экране, и дописал `T`: вышло бы `ST`. Но в коде `T` вызван **первым**: пользователь написал «сначала T, потом S», и итог обязан быть `TS`. Рендеры идут в порядке срочности, а состояние должно собираться в порядке вызовов — эти два порядка и примиряет база. Очередь хука после клика: `T` в полосе перехода, `S` в `SyncLane`.';

export const REBASE_SCENE_STEPS: { k: string; what: string }[] = [
  {
    k: 'Срочный рендер · обновление `T`',
    what: 'Полоса перехода не входит в полосы этого рендера — `T` пропускается. Раз пропущено первое обновление, запоминается база: состояние **до** него, пустая строка. `T` уходит в остаток.',
  },
  {
    k: 'Срочный рендер · обновление `S`',
    what: 'Полоса своя — `S` применяется: `\'\' + \'S\'`, на экране `S`. Но раз перед ним что-то пропустили, `S` ещё и **копируется в остаток** — с пустой полосой `NoLanes`. Пустая полоса входит в любой набор, и эту копию применит любой следующий рендер. Остаток: `[T, S]`, база: `\'\'`.',
  },
  {
    k: 'Переход · переигрывание с базы',
    what: 'Рендер перехода начинает не с того, что на экране (`S`), а с базы — пустой строки. `T` теперь своя полоса: `T`. Копия `S` с `NoLanes` применяется всегда: `TS`. На экране `TS` — рендеры шли в обратном порядке, а итог собран в порядке вызовов.',
  },
];

export const PLAIN_REBASE =
  'Бухгалтер получил две проводки: несрочную «+T» и срочную «+S». Срочный отчёт нужен сейчас, и в нём только «+S». Но итоговый баланс обязан учесть обе — в том порядке, в каком они пришли. Поэтому бухгалтер запоминает остаток, с которого началась отложенная проводка, и в полном отчёте пересчитывает всё с этого места: сначала T, потом S.';

export const REBASE_NOTE =
  'Срочный рендер пропускает `T` — не его полоса — и применяет `S`: на экране `S`. Но базовым состоянием хука становится то, что было **до** `T`, а `S` остаётся в очереди копией с пустой полосой: `NoLanes` входит в любой набор, и её применит любой следующий рендер. Переход переигрывает с базы: `T`, потом `S` — `TS`. Рендеры шли в обратном порядке, а состояние собрано в порядке вызовов. Лог одинаков у мини-версии и React 19.3.';

export const PENDING_NOTE =
  'Внутри `start` сначала `setPending(true)` — в полосе события, срочно, — и только потом, уже в полосе перехода, `setPending(false)` вместе с вашим обновлением. Два рендера: срочный с `isPending=true` и **прежним** состоянием, затем переход с новым и `false`. `isPending` — не флаг, который кто-то снимает, а состояние с двумя обновлениями в разных полосах. Лог одинаков у обоих.';

export const DEFERRED_NOTE =
  'В срочном рендере хук видит новое значение, возвращает **прежнее** и оставляет полосу перехода на потом; коммит поднимает её бит в `pendingLanes`, и следующий рендер — уже переход — вернёт новое. Два рендера на одно изменение, у обоих. `Slow` здесь рендерится оба раза: без `memo` срочный рендер тоже его зовёт — с прежним значением. Как сделать, чтобы не звал, — в [«Ре-рендеринге в React», раздел «Батчинг и нарезка»](/frameworks/react-rerender/#s4).';

export const ASYNC_NOTE =
  '**После `await` полоса перехода теряется.** `startTransition(async () => …)` выставляет полосу только на синхронную часть колбэка. После `await` колбэк продолжается из микрозадачи, когда «текущей полосы» уже нет, и `setState` получает `DefaultLane`. Это видно в `pendingLanes` корня — и у мини-версии, и у React 19.3: до `await` там бит перехода, после добавился бит 32. Документация React советует обернуть обновление после `await` в ещё один `startTransition`.';

export const S5_LEAD =
  'Компонент, которому не хватает данных, бросает промис — прямо из рендера, как исключение. Рабочий цикл ловит его, поднимается к ближайшему `<Suspense>` и рендерит вместо поддерева заглушку. На промис вешается пинг: когда он выполнится, полоса повтора закажет рендер, и компонент попробует снова — с начала.';

export const PLAIN_SUSPENSE =
  'На кухне кончилась мука. Повар не стоит у пустой полки — он кричит «нет муки!», официант приносит гостю хлеб «пока ждёте», а поставщику оставляют записку «позвоните, как привезёте». Привезли — звонок, и повар начинает блюдо заново: полуготовое тесто он не хранил.';

export const WHY_THROW =
  '**Почему именно `throw`.** Компоненту нужно остановиться посреди своей функции — на строке `read()`, где данных нет, — и не выполнить ни строки ниже. Вернуть «пусто» можно только из своей функции, а прервать нужно рендер на произвольной глубине: от `Page` до границы может быть десять компонентов. Остановить функцию на середине и пронести сигнал через все кадры вверх умеет только исключение. А повторить рендер потом **с начала** безопасно по той же причине, по которой его можно выбросить: render-фаза чиста.';

export const KEEP_SHOWN =
  '**Переход не прячет показанное.** Если граница уже показывает содержимое, а приостановился рендер перехода, заглушки не будет: полоса перехода засыпает (`suspendedLanes`), дерево в работе выбрасывается, на экране остаётся прежняя страница. `isPending` при этом горит: срочный рендер с `true` уже закоммичен, а рендер с `false` отложен вместе с переходом. Пинг будит полосу, и переход проходит заново.';

export const REACT19_SUSPENSE =
  '**Чего у мини-версии нет.** Предпрогрев: закоммитив заглушку, React 19 ещё раз рендерит приостановленное поддерево, чтобы соседние компоненты успели заказать свои данные, пока первый промис в пути, — поэтому на монтировании `Page 0` вызван дважды. Придержка: если содержимое готово раньше чем через 300 мс после показа заглушки, React показывает его по истечении этих 300 мс (`FALLBACK_THROTTLE_MS`), чтобы заглушка не мигнула.';

export const USE_NOTE =
  'Бросать промис самому — старый приём: в исходниках 19.3 этот путь называется `SuspendedOnDeprecatedThrowPromise`. Официальный способ — `use(promise)`: по исходникам он бросает служебное исключение и сам следит за статусом промиса. Механизм тот же — рендер останавливается броском и повторяется по пингу, — а мини-версия показывает его в самом прямом виде.';

export const S6_LEAD =
  'Переход уступает всему срочному. Если срочное приходит чаще, чем переход успевает доделаться, он не закончится никогда — это голодание. Поэтому у полосы есть срок: при первом заказе ей ставится время, и когда оно проходит, полоса становится просроченной и рендерится без уступок — как срочная.';

export const STARVE_NOTE = `Вот как это выглядит на виртуальных часах мини-версии. Переход заказан в t=0; после каждого кванта — одна строка списка, 100 мс, — приходит срочный ввод и выбрасывает начатое. Так повторяется **${STARVE_FACTS.restarts} раз**. Когда срок полосы (t=${STARVE_FACTS.expiresAt}) прошёл, следующий заход рендерит переход одним куском — восемь строк без единой уступки — и коммитит в t=${STARVE_FACTS.committedAt}. React 19.3 ведёт себя так же: когда срок перехода прошёл, его рендер перестаёт уступать поток. Для своего кода это значит: переход не зависнет навсегда, но если его рендер тяжёлый, после просрочки ввод будет ждать весь этот рендер целиком — \`startTransition\` не заменяет облегчения самого рендера.`;

export const EXPIRE_NOTE =
  '**Срок — не таймер.** В t=5000 ничего не срабатывает. Просрочку замечает `markStarvedLanesAsExpired`, которую зовёт каждый `ensureRootIsScheduled`, — то есть следующее же обновление или заход планировщика. Срочные полосы получают 250 мс, `DefaultLane` и переходы — 5 с, повтор после Suspense не просрочивается вовсе: торопить промис бессмысленно.';

/** Раздел «Против настоящего React». */
export const DIFF = {
  head: ['что', 'мини-версия', 'React 19.3'],
  rows: [
    [
      'Полосы переходов',
      'одна: `1 << 8`',
      'десять, по кругу: каждый `startTransition` берёт следующий бит, и два перехода рендерятся по отдельности. Тест видит, что бит в `pendingLanes` меняется',
    ],
    [
      'Срочные полосы вместе',
      'по одной, самая срочная первой',
      '`SyncLane`, `InputContinuousLane` и `DefaultLane` — одной пачкой: `getHighestPriorityLanes` начинается с `lanes & 42`. **Тест**: таймер и клик до рендера — у React один рендер, у мини-версии два',
    ],
    [
      'Предпрогрев Suspense',
      'нет',
      'после заглушки приостановленное поддерево рендерится ещё раз. **Тест**: `Page 0` на монтировании вызван дважды',
    ],
    ['Придержка заглушки', 'нет', 'содержимое показывается не раньше 300 мс после заглушки (`FALLBACK_THROTTLE_MS`)'],
    [
      'Пропуск поддерева',
      'рендер всегда от корня',
      'по `lanes` и `childLanes` — [«Ре-рендеринг в React», раздел «Дерево»](/frameworks/react-rerender/#s2)',
    ],
    [
      'Коммит',
      'разметка целиком',
      'вставки и правки узлов — [«React изнутри», раздел «Сверка»](/frameworks/react-internals/#s4)',
    ],
    ['Сцепление полос', 'нет', '`getEntangledLanes`: сцепленные полосы рендерятся только вместе'],
    ['Очередь хука', 'массив и срез по `consumed`', 'кольцо на хуке, `baseQueue` и `baseState` — тот же приём переигрывания с базы'],
  ],
};

export const DIFF_NOTE =
  'Строки с пометкой «Тест» — отличия, которые видны по выводу. Остальные — об устройстве, по исходникам 19.3; ссылки — в «Источниках».';

export const SYNC_BATCH_NOTE =
  'Отличие в пачке срочных полос видно по логу. У мини-версии клик рендерится первым и один — `text="a"`: таймерное обновление в его полосу не входит и пропущено с переигрыванием, как `T` в разделе «Переходы». Потом таймерная полоса — `text="aa"`. React 19.3 берёт обе полосы в один проход и сразу рисует `aa`.';

/* ────────────────────────────── Тонкие места ────────────────────────────── */

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'Обновление из таймера или fetch не прерывает переход',
    d: 'Такое обновление получает `DefaultLane`, а `getNextLanes` отдельной строкой оставляет начатый переход на месте. Если «срочное» состояние меняется не из обработчика события, оно будет ждать конца перехода. Что должно обновиться сразу, меняйте из обработчика события.',
    tone: 'warn',
  },
  {
    n: '02',
    t: 'Число вызовов функции компонента не определено',
    d: 'Прерванный рендер выбрасывается, и уже вызванные функции вызываются снова — с `App`. В тесте темы клик посреди перехода даёт три вызова `App` на два коммита. Любой побочный эффект в теле — счётчик, запрос, запись в переменную снаружи — выполнится столько раз, сколько было попыток.',
    tone: 'err',
  },
  {
    n: '03',
    t: '`startTransition` не откладывает вычисление',
    d: 'Колбэк выполняется сразу и синхронно; отложен только рендер обновлений, сделанных внутри. Тяжёлый расчёт в самом колбэке заблокирует поток так же, как без перехода. Прервать можно только работу рендера — значит тяжёлое должно считаться в компоненте, либо уехать в воркер.',
    tone: 'warn',
  },
  {
    n: '04',
    t: 'После `await` в переходе — уже не переход',
    d: 'Полоса выставлена только на синхронную часть колбэка. `setState` после `await` получает `DefaultLane` — у мини-версии и у React 19.3 одинаково, тест видит бит 32 в `pendingLanes`. Обновление после `await` оборачивают в ещё один `startTransition`.',
    tone: 'err',
  },
  {
    n: '05',
    t: '`isPending` горит, пока переход висит на промисе',
    d: 'Срочный рендер с `true` уже закоммичен, а рендер с `false` отложен вместе с переходом: полоса спит, пока промис не выполнится. Индикатор на `isPending` честно горит до конца — в тесте «грузим вторую…» стоит на экране, пока не придёт пинг.',
  },
  {
    n: '06',
    t: 'Приостановившийся компонент на монтировании вызывается дважды',
    d: 'Первый вызов — рендер, который бросил промис; второй — предпрогрев React 19 после показа заглушки. Запрос, запущенный прямо в теле, уйдёт дважды — если его не кэширует тот, кто создаёт промис.',
    tone: 'warn',
  },
  {
    n: '07',
    t: 'Голодающий переход заканчивается рывком',
    d: 'Если срочные обновления идут чаще, чем переход успевает отрендериться, через 5 с его полоса просрочится, и следующий рендер пойдёт целиком, без уступок. Для пользователя это внезапный фриз на всю длину тяжёлого рендера — 800 мс в тесте темы. Лечится удешевлением самого перехода, а не надеждой на нарезку.',
    tone: 'err',
  },
];

/* ───────────────────────────── Источники ───────────────────────────── */

export const SOURCES = [
  {
    title: 'Initial Lanes implementation — Andrew Clark, PR #18796',
    href: 'https://github.com/facebook/react/pull/18796',
    what: 'Почему приоритет одним числом («время истечения») заменили битовыми масками: пачки обновлений, которые нужно учитывать и исключать независимо друг от друга.',
  },
  {
    title: 'ReactFiberLane.js — исходники React',
    href: 'https://github.com/facebook/react/blob/main/packages/react-reconciler/src/ReactFiberLane.js',
    what: 'Значения полос, `getNextLanes`, `getHighestPriorityLanes`, `computeExpirationTime`, `markStarvedLanesAsExpired`, сцепление полос.',
  },
  {
    title: 'ReactFiberRootScheduler.js — исходники React',
    href: 'https://github.com/facebook/react/blob/main/packages/react-reconciler/src/ReactFiberRootScheduler.js',
    what: '`ensureRootIsScheduled`: одна задача на корень, микрозадача для `SyncLane`, перевод полосы в приоритет планировщика.',
  },
  {
    title: 'ReactFiberWorkLoop.js — исходники React',
    href: 'https://github.com/facebook/react/blob/main/packages/react-reconciler/src/ReactFiberWorkLoop.js',
    what: '`renderRootConcurrent`, `prepareFreshStack` (выбросить начатое), `workLoopConcurrentByScheduler` и синхронный цикл под `act`.',
  },
  {
    title: 'Scheduler.js и SchedulerMock.js — исходники React',
    href: 'https://github.com/facebook/react/tree/main/packages/scheduler/src/forks',
    what: 'Очередь задач на куче, квант `frameInterval`, продолжение задачи, выбор `setImmediate` / `MessageChannel` / `setTimeout` — и поддельный планировщик, на котором стоит тест темы.',
  },
  {
    title: 'ReactFiberThrow.js и ReactFiberHooks.js — исходники React',
    href: 'https://github.com/facebook/react/blob/main/packages/react-reconciler/src/ReactFiberThrow.js',
    what: 'Как брошенный промис находит границу и получает пинг; в соседнем `ReactFiberHooks.js` — очередь хука с `baseQueue`, `startTransition` и `useDeferredValue`.',
  },
  {
    title: 'startTransition — документация React',
    href: 'https://react.dev/reference/react/startTransition',
    what: 'Колбэк выполняется сразу; обновления после `await` нужно оборачивать в `startTransition` ещё раз.',
  },
  {
    title: 'React 19 — релиз',
    href: 'https://react.dev/blog/2024/12/05/react-19',
    what: 'Переходы с async-функциями (Actions) и предпрогрев приостановленных поддеревьев в Suspense.',
  },
];

export const RELATED =
  'Смежное на сайте: [React изнутри: свой рендерер и хуки](/frameworks/react-internals/) — рабочий цикл, файберы и хуки, на которых стоит эта тема. [React изнутри: хуки и контекст](/frameworks/react-hooks-internals/) — хуки и контекст, которые мини-версия здесь упрощает. [Ре-рендеринг в React](/frameworks/react-rerender/) — то же снаружи: когда переход помогает, а когда нет. [MessageChannel](/js/message-channel/) — чем планировщик отпускает поток. [Event Loop](/js/event-loop/) — почему микрозадача срочного рендера успевает до кадра. [Кадр браузера](/render/render-pipeline/) — что браузер делает в паузе между квантами. [Suspense и границы ошибок](/frameworks/suspense-errors/) — что ловит граница в React и Vue, водопад и стабильный промис.';
