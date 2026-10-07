import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { MiniScenario } from '@/widgets/mini-fiber/model/types';

/**
 * Данные темы «React изнутри: свой рендерер и хуки».
 *
 * Тема собирает мини-React по шагам. Каждый шаг — строка кода (`STEP_*`), напечатанная
 * в своём разделе; `MINI_REACT_CODE` — те же строки подряд. Эту склейку исполняют **и тест,
 * и демо**, обе стороны через `buildMiniReact` из `widgets/mini-fiber/model/build.ts`. Копий
 * кода нет нигде: правка шага в теме — это правка того, что проверяется.
 *
 * Код сценариев (`SCENARIO_*`) тоже строки, и они исполняются дважды: мини-версией и
 * **настоящим React 19.3.0** (`react-dom/client` из `node_modules` курса) — в тесте
 * `tests/unit/react-internals.test.ts`. React рендерит в поддельный документ из обычных
 * объектов, записанный в самом тесте: jsdom в зависимостях курса нет, а клиентскому
 * рендереру для этих сценариев хватает `createElement`, `appendChild`, `insertBefore`,
 * `removeChild` и текстовых узлов. Сверяется наблюдаемое: итоговая разметка, лог
 * компонентов (порядок рендеров и эффектов), сохранность состояния, перестановки узлов.
 *
 * Что проверено этим тестом (Node 26.8.2, React 19.3.0, отладочная сборка — её выбирает
 * `NODE_ENV=test` у vitest):
 *   — `EFFECTS_MOUNT_LOG` и `EFFECTS_UPDATE_LOG` — дословно у обоих;
 *   — `UNMOUNT_LOG` — очистки при удалении сверху вниз у обоих;
 *   — три `setN(c => c + 1)` — один рендер и `3` у обоих; три `setN(n + 1)` — один рендер и `1`;
 *   — перестановка `[a, b, c] → [c, a, b]`: узлы те же объекты, двигаются `a` и `b` — у обоих;
 *   — первое монтирование — одна вставка в контейнер у обоих;
 *   — `NO_BAILOUT_LOG` — **расхождение**, зафиксированное тестом: мини-версия зовёт соседа,
 *     React — нет;
 *   — `HOOK_ORDER_NOTE`: React бросает «Rendered more hooks than during the previous render»,
 *     мини-версия молча выдаёт новую ячейку.
 *
 * Не проверено запуском, а взято из исходников React (ссылки в `SOURCES`): что там хуки —
 * связный список, а очередь — кольцо с полосами; устройство `lanes`, Suspense и переходов.
 * Эти утверждения стоят только в разделе «Против настоящего React» и помечены как устройство,
 * а не как наблюдение.
 *
 * ── Проход «за кадром» (блок снят: его пункты раскрыты в разделах) ─────────────────────
 *
 *   — `react-reconciler` → карточка `RECONCILER_NOTE` в разделе «Две фазы». Пакета в
 *     `node_modules` курса нет, поэтому устройство — по README (ссылка в `SOURCES`); сверено
 *     только то, что видно в бандле `react-dom` 19.3.0: `commitUpdate(domElement, type,
 *     oldProps, newProps)` и `commitTextUpdate(textInstance, oldText, newText)` — те же
 *     сигнатуры, что в `HOST_SHAPE`; функции `prepareUpdate` в бандле нет вовсе;
 *     `resolveUpdatePriority` и `canHydrateInstance` — есть;
 *   — серверный рендер и гидратация → две строки `DIFF`. Гидратация проверена тестом
 *     (`hydrateRoot` на поддельном документе, отладочная сборка) и отдельным прогоном
 *     продакшен-сборки: узлов не создано ни одного, прежние узлы остались теми же объектами,
 *     лог клиента дословно `EFFECTS_MOUNT_LOG`;
 *   — React DevTools → `DEVTOOLS_CODE` в разделе «Против настоящего React». Код исполняется
 *     тестом как напечатан; вывод `DEVTOOLS_LOG` совпал и в продакшен-сборке (отдельный прогон
 *     Node 26.8.2, React 19.3.0): `inject` — один раз при загрузке `react-dom`,
 *     `onCommitFiberRoot` — на каждый коммит, объектов корня в `current` два, и они чередуются.
 *
 * Ссылки на соседние темы: строки `DIFF` про полосы, прерывание и Suspense ведут в
 * «React изнутри: конкурентность и lanes», про настоящие хуки и контекст — в «React изнутри:
 * хуки и контекст»; карточка про `lastPlacedIndex` в «Сверке» — на раздел «С ключами»
 * в «Vue 3 изнутри: рендерер и patch» (та же перестановка `[a, b, c] → [c, a, b]`, один перенос).
 */

/* ───────────────────────────── Код мини-рендерера ───────────────────────────── */

/** Элемент: JSX — это вызов функции, результат — обычный объект. */
export const STEP_ELEMENT = `const TEXT = 'TEXT';

// <li key="a">текст</li> компилируется в createElement('li', { key: 'a' }, 'текст')
function createElement(type, config, ...children) {
  const { key, ...props } = config ?? {};
  props.children = children
    .flat()                                             // массив из map() — тоже дети
    .filter((child) => child != null && typeof child !== 'boolean')
    .map((child) => (typeof child === 'object' ? child : createText(child)));
  return { type, key: key == null ? null : String(key), props };
}

// Строка и число становятся элементами того же вида — дальше код не различает случаи
function createText(value) {
  return { type: TEXT, key: null, props: { nodeValue: String(value), children: [] } };
}`;

/** Файбер и прерываемый цикл обхода. */
export const STEP_FIBER = `let currentRoot = null;     // дерево, которое сейчас на экране
let wipRoot = null;         // дерево «в работе» — work-in-progress
let nextUnitOfWork = null;  // файбер, с которого цикл продолжит

function createFiber(type, key, props) {
  return {
    type, key, props,
    stateNode: null,   // узел хоста; у компонента-функции его нет
    return: null,      // родитель
    child: null,       // первый ребёнок
    sibling: null,     // следующий брат
    alternate: null,   // пара из другого дерева
    index: 0, flags: 0, hooks: null,
  };
}

// Цикл, который можно прервать: между файберами он спрашивает, не пора ли отдать поток
function workLoop(shouldYield) {
  while (nextUnitOfWork && !shouldYield()) {
    nextUnitOfWork = performUnitOfWork(nextUnitOfWork);
  }
  if (nextUnitOfWork) return true;   // прервались — работа осталась
  if (wipRoot) commitRoot();         // дерево достроено — коммит целиком
  return false;
}

// Одна единица работы: обработать файбер и вернуть следующий — вниз, вбок или вверх
function performUnitOfWork(fiber) {
  if (typeof fiber.type === 'function') updateFunctionComponent(fiber);
  else updateHostComponent(fiber);

  if (fiber.child) return fiber.child;
  for (let next = fiber; next; next = next.return) {
    completeUnitOfWork(next);        // всё поддерево next готово
    if (next.sibling) return next.sibling;
  }
  return null;
}`;

/** Две фазы и два буфера. */
export const STEP_PHASES = `// Второй буфер: у файбера есть пара, и новый рендер пишет в неё, а не в свежий объект
function createWorkInProgress(current, props) {
  let wip = current.alternate;
  if (wip === null) {
    wip = createFiber(current.type, current.key, props);
    wip.stateNode = current.stateNode;
    wip.alternate = current;
    current.alternate = wip;
  }
  wip.props = props;
  wip.flags = 0;
  wip.child = null;
  wip.sibling = null;
  wip.hooks = null;
  return wip;
}

function updateHostComponent(fiber) {
  if (!fiber.stateNode) {
    // Узел создаётся в render-фазе, но в документ пока не попадает
    fiber.stateNode = fiber.type === TEXT
      ? host.createTextInstance(fiber.props.nodeValue)
      : host.createInstance(fiber.type, fiber.props);
  } else if (fiber.alternate && propsChanged(fiber.alternate.props, fiber.props)) {
    fiber.flags |= UPDATE;
  }
  reconcileChildren(fiber, fiber.props.children);
}

// На обратном пути: новый узел собирает детей у себя, вне документа, а файбер
// с работой для коммита встаёт в список эффектов — дети раньше родителя
function completeUnitOfWork(fiber) {
  if (fiber.stateNode && !fiber.alternate && fiber.type !== TEXT) {
    for (const node of hostNodesBelow(fiber)) host.appendInitialChild(fiber.stateNode, node);
  }
  if (fiber.flags || fiber.hooks) wipRoot.effects.push(fiber);
}

function commitRoot() {
  const finished = wipRoot;
  deletions.forEach(commitDeletion);              // 1. снести то, что пропало
  finished.effects.forEach(commitMutation);       // 2. вставки и правки
  currentRoot = finished;                         // 3. буферы меняются ролями
  wipRoot = null;
  finished.effects.forEach(commitLayoutEffects);  // 4. layout-эффекты — та же задача
  schedulePassiveEffects(finished.effects);       // 5. useEffect — потом
}

function commitMutation(fiber) {
  if (fiber.flags & PLACEMENT) commitPlacement(fiber);
  if (fiber.flags & UPDATE) {
    const prev = fiber.alternate.props;
    if (fiber.type === TEXT) host.commitTextUpdate(fiber.stateNode, prev.nodeValue, fiber.props.nodeValue);
    else host.commitUpdate(fiber.stateNode, fiber.type, prev, fiber.props);
  }
  for (const hook of fiber.hooks ?? []) {
    if (hook.kind === 'state') hook.queue.splice(0, hook.consumed);  // очередь — см. useState
    if (hook.kind === 'layout' && hook.changed) runDestroy(hook);    // очистка — см. эффекты
  }
}`;

/** Сверка детей, флаги и то, как коммит их исполняет. */
export const STEP_RECONCILE = `const PLACEMENT = 1;   // вставить или переставить узел
const UPDATE = 2;      // поменять свойства узла
let deletions = [];    // старые файберы, которые коммит снесёт

function reconcileChildren(wip, elements) {
  const current = wip.alternate;
  const oldByKey = new Map();
  for (let old = current ? current.child : null; old; old = old.sibling) {
    oldByKey.set(old.key ?? old.index, old);   // без ключа — сопоставляем по позиции
  }

  let lastPlacedIndex = 0;
  let prev = null;
  elements.forEach((element, index) => {
    const key = element.key ?? index;
    const old = oldByKey.get(key);
    let fiber;
    if (old && old.type === element.type) {
      oldByKey.delete(key);
      fiber = createWorkInProgress(old, element.props);          // тип совпал — обновляем
      if (old.index < lastPlacedIndex) fiber.flags |= PLACEMENT; // стоял левее — переставить
      else lastPlacedIndex = old.index;
    } else {
      fiber = createFiber(element.type, element.key, element.props); // не совпал — новый
      if (current) fiber.flags |= PLACEMENT;  // в новом поддереве вставка одна — на вершине
    }
    fiber.index = index;
    fiber.return = wip;
    if (prev) prev.sibling = fiber;
    else wip.child = fiber;
    prev = fiber;
  });

  oldByKey.forEach((old) => deletions.push(old));   // никто не забрал — снести
}

function propsChanged(prev, next) {
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  keys.delete('children');
  return [...keys].some((key) => !Object.is(prev[key], next[key]));
}

function commitPlacement(fiber) {
  const parent = hostParentOf(fiber);
  const before = hostSiblingOf(fiber);
  for (const node of hostNodesOf(fiber)) {
    if (before) host.insertBefore(parent, node, before);
    else host.appendChild(parent, node);
  }
}

function commitDeletion(fiber) {
  const parent = hostParentOf(fiber);
  runUnmountEffects(fiber);
  for (const node of hostNodesOf(fiber)) host.removeChild(parent, node);
}

// Узлы хоста: свой, а у компонента-функции — верхние узлы его поддерева
function hostNodesOf(fiber) {
  return fiber.stateNode ? [fiber.stateNode] : hostNodesBelow(fiber);
}
function hostNodesBelow(fiber) {
  const nodes = [];
  for (let child = fiber.child; child; child = child.sibling) nodes.push(...hostNodesOf(child));
  return nodes;
}
function hostParentOf(fiber) {
  let parent = fiber.return;
  while (!parent.stateNode) parent = parent.return;
  return parent.stateNode;
}
// Перед чем вставлять: ближайший брат, который сам не едет, — поднимаясь сквозь компоненты
function hostSiblingOf(fiber) {
  for (let f = fiber; f; f = f.return) {
    for (let s = f.sibling; s; s = s.sibling) {
      if (s.flags & PLACEMENT) continue;
      const [node] = hostNodesOf(s);
      if (node) return node;
    }
    if (f.return && f.return.stateNode) return null;   // дошли до узла-родителя — в конец
  }
  return null;
}`;

/** Хуки: массив ячеек на файбере, найденных по номеру вызова. */
export const STEP_HOOKS = `let wipFiber = null;
let hookIndex = 0;

function updateFunctionComponent(fiber) {
  wipFiber = fiber;
  hookIndex = 0;
  fiber.hooks = [];
  const child = fiber.type(fiber.props);   // тот самый «вызов функции компонента»
  reconcileChildren(fiber, child == null ? [] : [child]);
}

// Хук своего имени не знает: его ячейку находят по номеру вызова в прошлом рендере
function nextOldHook() {
  const old = wipFiber.alternate?.hooks?.[hookIndex] ?? null;
  hookIndex++;
  return old;
}

function useState(initial) {
  const old = nextOldHook();
  const queue = old ? old.queue : [];
  let state = old ? old.state : typeof initial === 'function' ? initial() : initial;
  for (const action of queue) {
    state = typeof action === 'function' ? action(state) : action;
  }
  const setState = old ? old.setState : (action) => {
    queue.push(action);   // обновление — запись в очередь, а не новое значение
    scheduleUpdate();
  };
  // Очередь чистит коммит: выброшенный рендер не должен съесть обновления
  wipFiber.hooks.push({ kind: 'state', state, queue, consumed: queue.length, setState });
  return [state, setState];
}`;

/** Планирование: откуда берётся батчинг и прерывание. */
export const STEP_SCHEDULE = `let rootProps = null;
let scheduled = false;

function render(element, container) {
  if (!currentRoot) {
    currentRoot = createFiber('ROOT', null, { children: [] });
    currentRoot.stateNode = container;
  }
  rootProps = { children: [element] };
  scheduleUpdate();
}

// Любое обновление начинает рендер от корня заново: недостроенное дерево выбрасывается
function scheduleUpdate() {
  wipRoot = createWorkInProgress(currentRoot, rootProps);
  wipRoot.effects = [];
  deletions = [];
  nextUnitOfWork = wipRoot;
  if (scheduled) return;   // сколько бы setState ни пришло — работа одна
  scheduled = true;
  host.scheduleMicrotask(performWork);
}

function performWork() {
  scheduled = false;
  flushPassiveEffects();   // хвост прошлого коммита — до нового рендера
  if (!wipRoot) return;
  if (workLoop(host.shouldYield)) {
    scheduled = true;
    host.scheduleTask(performWork);   // отпустили поток — продолжим следующей задачей
  }
}`;

/** Эффекты: layout — внутри коммита, useEffect — после. */
export const STEP_EFFECTS = `let pendingPassive = null;
let pendingUnmounts = [];

function useLayoutEffect(create, deps) { pushEffect('layout', create, deps); }
function useEffect(create, deps) { pushEffect('passive', create, deps); }

function pushEffect(kind, create, deps) {
  const old = nextOldHook();
  const changed = !old || !deps || deps.some((dep, i) => !Object.is(dep, old.deps[i]));
  wipFiber.hooks.push({ kind, create, deps, changed, destroy: old ? old.destroy : null });
}

function runDestroy(hook) {
  if (hook.destroy) hook.destroy();
  hook.destroy = null;
}
function runCreate(hook) {
  const destroy = hook.create();
  hook.destroy = typeof destroy === 'function' ? destroy : null;
}

// Очистки layout-эффектов прошли в commitMutation; здесь — сами эффекты, дети раньше родителя
function commitLayoutEffects(fiber) {
  for (const hook of fiber.hooks ?? []) {
    if (hook.kind === 'layout' && hook.changed) runCreate(hook);
  }
}

function schedulePassiveEffects(fibers) {
  pendingPassive = { fibers, unmounts: pendingUnmounts };
  pendingUnmounts = [];
  host.scheduleTask(flushPassiveEffects);
}

// Сначала все очистки, потом все эффекты: новый эффект не увидит несобранный старый
function flushPassiveEffects() {
  if (!pendingPassive) return;
  const { fibers, unmounts } = pendingPassive;
  pendingPassive = null;
  unmounts.forEach((destroy) => destroy());
  const passive = fibers.flatMap((f) => (f.hooks ?? []).filter((h) => h.kind === 'passive' && h.changed));
  passive.forEach(runDestroy);
  passive.forEach(runCreate);
}

// Удаление идёт сверху вниз: родитель раньше детей; layout — сразу, useEffect — позже
function runUnmountEffects(fiber) {
  for (const hook of fiber.hooks ?? []) {
    if (hook.kind === 'layout') runDestroy(hook);
    if (hook.kind === 'passive' && hook.destroy) pendingUnmounts.push(hook.destroy);
  }
  for (let child = fiber.child; child; child = child.sibling) runUnmountEffects(child);
}`;

/**
 * Весь рендерер — шаги подряд. Порядок склейки не важен для работы (объявления функций
 * всплывают, а `let` успевают выполниться до первого вызова), он важен для чтения.
 */
export const MINI_REACT_CODE = [
  STEP_ELEMENT,
  STEP_FIBER,
  STEP_PHASES,
  STEP_RECONCILE,
  STEP_HOOKS,
  STEP_SCHEDULE,
  STEP_EFFECTS,
].join('\n\n');

/**
 * Как этим пользоваться: хост — объект с операциями, рендерер — функция от него.
 * Печатается в разделе про фазы; тот же объект (с журналом) лежит в `widgets/mini-fiber/model/host.ts`.
 */
export const HOST_SHAPE = `const host = {
  // render-фаза: узлы создаются и собираются вне документа
  createInstance(type, props) {},
  createTextInstance(text) {},
  appendInitialChild(parent, child) {},
  // commit: единственное место, где меняется то, что видит пользователь
  appendChild(parent, child) {},
  insertBefore(parent, child, before) {},
  removeChild(parent, child) {},
  commitUpdate(node, type, prevProps, nextProps) {},
  commitTextUpdate(node, prevText, nextText) {},
  // планирование
  scheduleMicrotask(callback) {},
  scheduleTask(callback) {},
  shouldYield() {},   // пора ли отдать поток
};`;

/**
 * Раздел «Две фазы»: настоящий host config. Устройство — по README `react-reconciler`;
 * сигнатуры `commitUpdate`/`commitTextUpdate` и отсутствие `prepareUpdate` сверены по бандлу
 * `react-dom` 19.3.0 (см. шапку).
 */
export const RECONCILER_NOTE =
  'Этот объект — не учебная выдумка. Ровно так устроен пакет `react-reconciler`: его автор пишет host config, а сверку, хуки, полосы и планирование получает готовыми. На нём написаны React Three Fiber (сцена WebGL вместо DOM), Ink (терминал), React PDF; сам `react-dom` — тот же реконсилер со своим хостом внутри. Настоящий интерфейс шире: кроме операций из списка выше в нём есть контекст хоста (`getRootHostContext`, `getChildHostContext` — например, «мы внутри `<svg>`»), пара `prepareForCommit`/`resetAfterCommit` вокруг коммита, `shouldSetTextContent` («текст ребёнка поставлю сам, отдельный узел не нужен»), ветка гидратации и `resolveUpdatePriority` — хост отвечает, насколько срочно обновление, по тому, какое событие сейчас обрабатывается. У `react-dom` 19.3 `commitUpdate(node, type, prevProps, nextProps)` и `commitTextUpdate(node, prevText, nextText)` — те же сигнатуры, что здесь. Интерфейс меняется между версиями: в React 19 из него ушёл `prepareUpdate`, и свой рендерер привязывают к точной версии `react-reconciler`.';

/* ─────────────────────────────── Сценарии ─────────────────────────────── */

/**
 * Код сценариев исполняется как есть: у мини-версии `h` — её `createElement`, у React —
 * `React.createElement`. `log` — вывод компонента, `expose` — ручка для кнопки демо и теста.
 */
export const SCENARIO_MOUNT = `function Item({ label }) {
  log('render Item ' + label);
  useLayoutEffect(() => log('layout Item ' + label));
  useEffect(() => log('effect Item ' + label));
  return h('li', null, label);
}

function App() {
  log('render App');
  useLayoutEffect(() => log('layout App'));
  useEffect(() => log('effect App'));
  return h('ul', null, h(Item, { label: 'a' }), h(Item, { label: 'b' }));
}`;

export const SCENARIO_UPDATE = `function Counter() {
  const [n, setN] = useState(0);
  log('render Counter n=' + n);
  useLayoutEffect(() => {
    log('layout n=' + n);
    return () => log('cleanup layout n=' + n);
  }, [n]);
  useEffect(() => {
    log('effect n=' + n);
    return () => log('cleanup effect n=' + n);
  }, [n]);
  expose('setState', () => setN((c) => c + 1));
  return h('p', null, 'n = ', n);
}

function App() {
  return h('div', null, h(Counter), h('span', null, 'сосед'));
}`;

export const SCENARIO_KEYS = `let mounted = 0;

function Row({ id }) {
  const [serial] = useState(() => ++mounted);   // выдаётся один раз — при монтировании
  log('render Row ' + id);
  return h('li', null, id + ' · смонтирован ' + serial + '-м');
}

function App() {
  const [order, setOrder] = useState(['a', 'b', 'c']);
  expose('setState', () => setOrder((o) => [o[2], o[0], o[1]]));
  return h('ul', null, order.map((id) => h(Row, { key: id, id })));
}`;

export const SCENARIO_BATCH = `function App() {
  const [n, setN] = useState(0);
  log('render App n=' + n);
  expose('setState', () => {
    setN((c) => c + 1);
    setN((c) => c + 1);
    setN((c) => c + 1);
  });
  expose('stale', () => {
    setN(n + 1);
    setN(n + 1);
    setN(n + 1);
  });
  return h('p', null, 'n = ', n);
}`;

export const DEMO_SCENARIOS: MiniScenario[] = [
  {
    key: 'mount',
    label: 'первый рендер',
    code: SCENARIO_MOUNT,
    note: 'Узлы создаются в render-фазе и собираются в поддерево **вне документа**: `appendInitialChild`. В контейнер уходит одна операция — `appendChild` в самом коммите. Эффекты выходят **снизу вверх**: `Item` раньше `App`.',
  },
  {
    key: 'update',
    label: 'обновление',
    code: SCENARIO_UPDATE,
    action: { name: 'setState', label: 'setN(c => c + 1)' },
    note: 'Посмотрите на журнал после коммита: из всех узлов тронут один текстовый. Номера файберов при этом другие: второй рендер пишет в **пару** каждого файбера (`↔`), а не в новый объект. Функцию `App` мини-версия зовёт заново — у React здесь пропуск поддерева (bailout).',
  },
  {
    key: 'keys',
    label: 'перестановка по ключам',
    code: SCENARIO_KEYS,
    action: { name: 'setState', label: 'переставить: [c, a, b]' },
    note: 'Номер монтирования живёт в `useState` строки и едет вместе с ключом. Узлы не создаются заново — в журнале только `appendChild` двух строк: `c` стояла правее всех и осталась на месте, `a` и `b` переехали за неё.',
  },
  {
    key: 'batch',
    label: 'батч из трёх setState',
    code: SCENARIO_BATCH,
    action: { name: 'setState', label: 'три setN(c => c + 1)' },
    note: 'После обработчика в очереди хука три записи, а запланирована **одна** микрозадача. Рендер один, функция вызвана один раз и свернула всю очередь: `0 → 1 → 2 → 3`.',
  },
];

/* ──────────────────────── Что сверено с настоящим React ──────────────────────── */

/** Первое монтирование `SCENARIO_MOUNT`: лог дословно одинаков у обоих рендереров. */
export const EFFECTS_MOUNT_LOG = [
  'render App',
  'render Item a',
  'render Item b',
  'layout Item a',
  'layout Item b',
  'layout App',
  'effect Item a',
  'effect Item b',
  'effect App',
];

/** Одно обновление `SCENARIO_UPDATE` после монтирования: тоже дословно у обоих. */
export const EFFECTS_UPDATE_LOG = [
  'render Counter n=1',
  'cleanup layout n=0',
  'layout n=1',
  'cleanup effect n=0',
  'effect n=1',
];

/** Удаление поддерева: очистки идут сверху вниз — у React и у мини-версии. */
export const UNMOUNT_CODE = `function Leaf() {
  useLayoutEffect(() => () => log('cleanup layout Leaf'));
  useEffect(() => () => log('cleanup effect Leaf'));
  return h('i', null, 'лист');
}

function Middle() {
  useLayoutEffect(() => () => log('cleanup layout Middle'));
  useEffect(() => () => log('cleanup effect Middle'));
  return h('b', null, h(Leaf));
}

function App() {
  const [shown, setShown] = useState(true);
  expose('hide', () => setShown(false));
  return h('div', null, shown ? h(Middle) : null);
}`;

export const UNMOUNT_LOG = [
  'cleanup layout Middle',
  'cleanup layout Leaf',
  'cleanup effect Middle',
  'cleanup effect Leaf',
];

/** Намеренное отличие: у мини-версии нет bailout — сосед обновлённого компонента вызывается. */
export const NO_BAILOUT_CODE = `function Sibling() {
  log('render Sibling');
  return h('span', null, 'сосед');
}

function Counter() {
  const [n, setN] = useState(0);
  log('render Counter');
  expose('bump', () => setN((c) => c + 1));
  return h('b', null, n);
}

function App() {
  log('render App');
  return h('div', null, h(Counter), h(Sibling));
}`;

export const NO_BAILOUT_LOG = {
  mini: ['render App', 'render Counter', 'render Sibling'],
  react: ['render Counter'],
};

/* ───────────────────────────── Текст темы ───────────────────────────── */

export const GLOSSARY = [
  {
    k: 'элемент',
    d: 'Объект `{ type, key, props }` — результат JSX. Описание «здесь должен быть такой-то компонент с такими-то пропсами», а не узел документа. Каждый рендер создаёт элементы заново.',
  },
  {
    k: 'файбер',
    d: 'Узел внутреннего дерева React. Живёт между рендерами и помнит то, что элемент забывает: состояние хуков, ссылку на узел документа, флаги работы для коммита. Он же единица работы для цикла обхода.',
  },
  {
    k: 'хост',
    d: 'То, во что рендерер в итоге рисует: DOM у `react-dom`, нативные виды у React Native, терминал у Ink. Рендерер не знает, что это, — он зовёт набор функций, **host config**: создать узел, вставить, удалить, обновить.',
  },
  {
    k: 'work-in-progress и `alternate`',
    d: 'Два дерева файберов: `current` — то, что на экране, и work-in-progress — то, что строится сейчас. У каждого файбера есть пара в другом дереве, ссылка на неё — поле `alternate`.',
  },
  {
    k: 'коммит',
    d: 'Вторая фаза обновления: применить к хосту всё, что render-фаза насчитала, одним непрерывным куском. Первая фаза считает и может быть выброшена, вторая меняет видимое и прерваться не может.',
  },
  {
    k: 'флаги',
    d: 'Пометки на файбере о работе для коммита: `Placement` — вставить или переставить узел, `Update` — поменять свойства, `Deletion` — снести. Render-фаза их ставит, коммит исполняет.',
  },
];

export const PREREQ_NOTE =
  'Мини-версия повторяет поведение React, а не выводит его заново. Каким это поведение бывает — сколько раз зовётся функция компонента, что делает ключ, почему три `setState` дают один рендер, — здесь считается известным; ответ тут на другой вопрос: каким кодом оно получается.';

export const PREREQ = [
  {
    t: 'Что такое ре-рендер и две фазы',
    d: '`setState` помечает компонент, React вызывает функцию заново, сравнивает результат и правит DOM только там, где есть разница. Здесь этот абзац превращается в код — полезно знать, как он выглядит снаружи.',
    href: '/frameworks/react-rerender/#s1',
    hrefLabel: 'Ре-рендеринг в React · Модель',
    tone: 'info' as const,
  },
  {
    t: 'Что микрозадача выполняется до отрисовки',
    d: 'Батчинг в мини-версии — один флаг и одна микрозадача. Почему этого хватает, чтобы промежуточное состояние не попало на экран, объясняет порядок цикла событий, а не React.',
    href: '/js/event-loop/#s3',
    hrefLabel: 'Event Loop · Checkpoint',
    tone: 'err' as const,
  },
  {
    t: 'Как планировщик отпускает поток',
    d: 'Прерываемый цикл здесь спрашивает `shouldYield()` и продолжает следующей задачей. Чем именно React ставит эту задачу и почему не `setTimeout` — в теме про каналы сообщений.',
    href: '/js/message-channel/#s2',
    hrefLabel: 'MessageChannel · Тайминг',
    tone: 'warn' as const,
  },
];

/** «На пальцах» к каждому шагу — там, где понятие впервые встречается. */
export const PLAIN_ELEMENT =
  'Элемент — это строчка в списке покупок, а не продукт в холодильнике. «Молоко, 1 литр» можно переписать сколько угодно раз, сравнить со вчерашним списком и выбросить — холодильник от этого не меняется. Меняет его только поход в магазин, и в React это отдельная фаза.';

export const PLAIN_LINKED =
  'Рекурсивный обход — как читать книгу, держа пальцы между страницами каждой главы, в которую вы зашли: закрыть её и продолжить завтра нельзя, пальцы — это стек вызовов, и он исчезнет. Файбер-дерево — закладка: одна бумажка с номером страницы, `nextUnitOfWork`. Книгу можно закрыть после любой страницы и открыть на том же месте.';

export const PLAIN_BUFFERS =
  'Двойная буферизация — два холста у художника. Пока на выставке висит первый, он пишет на втором; дописал — меняет их местами, а старый забирает под следующую работу. Посетитель ни разу не видит холст наполовину записанным, а новый холст каждый раз покупать не нужно.';

export const PLAIN_LAST_PLACED =
  'Представьте, что расставляете книги на полке слева направо и держите палец на последней, которую оставили на месте. Книга, которая раньше стояла левее пальца, должна переехать. Книга, которая стояла правее, остаётся, и палец переходит на неё. Отсюда странность: перенести последнюю книгу в начало — значит сдвинуть все остальные.';

export const PLAIN_HOOK_ORDER =
  'Хуки — камера хранения без табличек. Вещи сдают по очереди, и ячейки выдают по порядку прихода: первая, вторая, третья. Имени у ячейки нет. Пропустили в этот раз один вызов — и все, кто шёл за вами, получат чужие вещи.';

export const PLAIN_SCHEDULED =
  'Флаг `scheduled` — курьер, который зашёл за почтой. Пока он поднимается по лестнице, в ящик можно бросить ещё три письма — унесёт все разом. Звонить второй раз незачем: курьер уже идёт.';

export const PLAIN_EFFECTS =
  '`useLayoutEffect` — поправить картину, пока на ней ещё покрывало: зритель увидит уже поправленную. `useEffect` — поправить после открытия выставки: быстрее для открытия, но кто-то успеет заметить, как картину двигали.';

/** Лид раздела «Элемент»: в MDX-атрибуте кавычки и фигурные скобки неудобны, поэтому строкой. */
export const S1_LEAD =
  '`<li key="a">текст</li>` — не узел документа и не компонент, а вызов `createElement(\'li\', { key: \'a\' }, \'текст\')`. Результат — обычный объект. Всё, что React делает дальше, он делает с деревом таких объектов, и первое, что нужно рендереру, — функция, которая их строит.';

/** Раздел «Элемент»: чем элемент настоящего React отличается от нашего. Сверено тестом. */
export const ELEMENT_DIFF =
  'У настоящего React у элемента есть ещё `$$typeof: Symbol.for(\'react.transitional.element\')` — метка, которую нельзя получить из JSON: сервер не подсунет объект, притворяющийся элементом. И текст React в элементы не заворачивает: у `<p>текст</p>` поле `props.children` — просто строка `\'текст\'`, а не массив. Мини-версия заворачивает текст в `TEXT`-элемент, чтобы дальше не различать случаи — ради краткости, а не ради точности.';

/** Раздел «Сверка»: связь с разделом про ключи в соседней теме. */
export const KEYS_LINK =
  'Что ломает `key={index}` и почему он теряет состояние строк — разобрано в [«Ре-рендеринге в React», раздел «Ключи»](/frameworks/react-rerender/#s3). Здесь видно, откуда это берётся: без ключа карта старых файберов строится по позиции, и строка на месте первой получает файбер прежней первой — со всем её состоянием.';

/**
 * Сквозной пример к `lastPlacedIndex`. Автор курса (2026-09-29): трудное не сокращать,
 * а объяснять подробно. Правило «стоял левее отметки — едет» было сказано одной фразой; здесь
 * оно пройдено по шагам кода `STEP_RECONCILE`. Перестановка `[a, b, c] → [c, a, b]` и итог
 * «едут a и b» закреплены тестом (`react-internals.test.ts`: `append a`, `append b` у React
 * и мини-версии). Вторая перестановка `[b, c, a]` — трассировка того же кода, не замер.
 */
export const LAST_PLACED_SCENE_CODE = `было на экране:   a  b  c        старые индексы: a → 0, b → 1, c → 2
стало в JSX:      c  a  b

lastPlacedIndex = 0`;

export const LAST_PLACED_SCENE_NOTE =
  'Что было бы **без отметки**. Сверке пришлось бы решать задачу «как из старого порядка получить новый за наименьшее число переносов» — а это отдельный алгоритм с сортировкой и памятью под него. React выбирает проще: один проход слева направо и одно число. Цена простоты видна на этой самой перестановке: переносов выйдет два, хотя хватило бы одного — перенести `c` в начало.';

export const LAST_PLACED_SCENE_STEPS: { k: string; what: string }[] = [
  {
    k: '1 · `c`, старый индекс 2',
    what: 'Сравниваем с отметкой: `2 < 0`? Нет. Значит, `c` стоит не левее уже оставленных — его не трогаем, а отметку сдвигаем: `lastPlacedIndex = 2`.',
  },
  {
    k: '2 · `a`, старый индекс 0',
    what: '`0 < 2`? Да. В новом порядке `a` должен идти после `c`, а на экране он левее — флаг `PLACEMENT`, узел поедет. Отметка не меняется: `a` на место не «встал».',
  },
  {
    k: '3 · `b`, старый индекс 1',
    what: '`1 < 2`? Да — тоже `PLACEMENT`. Итог прохода: `c` на месте, `a` и `b` едут в конец. В журнале хоста это две вставки, `append a` и `append b`, — у мини-версии и у React 19.3 одинаково.',
  },
  {
    k: 'Для сравнения: `[a, b, c] → [b, c, a]`',
    what: '`b` (1) не меньше 0 — остаётся, отметка 1; `c` (2) не меньше 1 — остаётся, отметка 2; `a` (0) меньше 2 — едет. Один перенос. Правило в целом: перенос элемента **назад** стоит одной вставки, перенос **вперёд** — вставки всех, кого он обогнал.',
  },
];

/**
 * Сквозной пример к порядку хуков. Автор курса (2026-09-29): не сокращать, а объяснять подробно.
 * `HOOK_ORDER_NOTE` называл два исхода нарушения; здесь они пройдены по ячейкам на одном
 * компоненте. Механика — `STEP_HOOKS` (`nextOldHook` берёт ячейку по номеру вызова); поведение
 * React 19.3 в обоих исходах — то, что `HOOK_ORDER_NOTE` утверждает по тесту. Новых утверждений
 * о React нет.
 */
export const HOOK_SCENE_CODE = `function Profile({ showAge }) {
  const [name] = useState('Аня');
  if (showAge) {
    const [age] = useState(30);       // хук под условием
  }
  const [theme] = useState('светлая');
  …
}`;

export const HOOK_SCENE_STEPS: { k: string; what: string }[] = [
  {
    k: 'Рендер 1 · `showAge = false`',
    what: 'Вызовов `useState` два. `hookIndex` 0 — ячейки прошлого рендера нет, в ячейку 0 кладётся `\'Аня\'`. `hookIndex` 1 — в ячейку 1 кладётся `\'светлая\'`. На файбере: `[\'Аня\', \'светлая\']`.',
  },
  {
    k: 'Рендер 2 · `showAge = true`',
    what: '`name` берёт ячейку 0 — `\'Аня\'`, всё верно. `age` берёт ячейку 1 — там `\'светлая\'`, и начальное `30` проигнорировано: ячейка же нашлась. `theme` идёт третьим и в прошлом рендере ячейки не находит. Мини-версия молча заводит новую, и `theme` становится `\'светлая\'` уже по начальному значению — а `age` показывает слово вместо числа. React 19.3 на этом месте бросает `Rendered more hooks than during the previous render`: хуков стало больше, чем было.',
  },
  {
    k: 'Тот же сдвиг без ошибки',
    what: 'Если бы условие меняло не **число** хуков, а их **порядок** — два `useState` в разных ветках `if` в разной последовательности, — ячейки поменялись бы местами при том же счёте. Ни мини-версия, ни React ничего не скажут: предупреждение отладочной сборки сверяет вид хука, а оба — `useState`. Значения просто окажутся не у тех переменных.',
  },
];

/** Раздел «Хуки»: связь с очередью в соседней теме. */
export const QUEUE_LINK =
  'Почему `setN(n + 1)` три раза даёт `1`, а `setN(c => c + 1)` — `3`, показано в [«Ре-рендеринге в React», раздел «Батчинг и нарезка»](/frameworks/react-rerender/#s4). В коде это цикл по очереди: функция получает результат предыдущей записи, а значение — нет, и три одинаковых `n + 1` дают одно и то же число. Оба случая тест прогоняет и на мини-версии, и на React: `3` и `1` у обоих.';

export const HOOK_ORDER_NOTE =
  'На React 19.3: хуков стало больше, чем в прошлом рендере, — React бросает `Rendered more hooks than during the previous render`; мини-версия в том же случае молча выдаёт новую ячейку. А если число хуков то же и поменялся только порядок двух `useState`, **молчат оба**: значения меняются местами, ни ошибки, ни предупреждения. Предупреждение отладочной сборки React смотрит на вид хука, а не на то, какое состояние в нём лежит.';

/** Раздел «Батчинг». */
export const BATCH_NOTE =
  'Батчинг здесь — не отдельный механизм, а следствие двух строк: `setState` только пишет в очередь, а рендер начинается в микрозадаче, которую ставит первый вызов. Как React выбирает между микрозадачей и задачей для разных приоритетов — в [«Ре-рендеринге в React», раздел «Батчинг и нарезка»](/frameworks/react-rerender/#s4).';

export const RESTART_NOTE =
  'Каждый `scheduleUpdate` начинает рендер с корня. Пришло обновление посреди прерванного рендера — недостроенное дерево бросается, и функции компонентов, которые уже были вызваны, вызовутся ещё раз. Поэтому тело компонента обязано быть чистым: ни одна строка в нём не знает, станет ли её рендер коммитом. React решает тоньше — бросать ли начатое, он выбирает по приоритету пришедшего обновления, — но гарантии «функция вызвана ровно раз на коммит» не даёт и он.';

/** Раздел «Эффекты». */
export const EFFECTS_NOTE =
  'Оба списка — вывод сценариев «первый рендер» и «обновление» из демо ниже, и мини-версия с настоящим React 19.3 выдают их **дословно**. Когда `useEffect` выполняется относительно кадра браузера — зависит от того, что вызвало обновление; это разобрано в [«Ре-рендеринге в React», раздел «Модель»](/frameworks/react-rerender/#s1).';

export const UNMOUNT_NOTE =
  'При удалении порядок обратный: очистки идут **сверху вниз**, родитель раньше детей, — сначала все layout, потом все `useEffect`. Мини-версия получает это обходом поддерева в `runUnmountEffects`, React — своим обходом в коммите; тест требует у обоих один и тот же порядок.';

/** Раздел «Всё вместе». */
export const DEMO_NOTE =
  'Демо исполняет тот же код, что напечатан в шагах выше, — в вашем браузере, с хостом-журналом вместо DOM. Квант сжат до одного файбера: после каждой единицы работы цикл отдаёт поток и продолжает следующей задачей. Слева — дерево на экране, справа — дерево в работе; `↔` — номер пары в другом дереве.';

/** Раздел «Против настоящего React»: чего нет в мини-версии. */
export const DIFF = {
  head: ['что', 'мини-версия', 'React'],
  rows: [
    [
      'Пропуск поддерева (bailout)',
      'рендер идёт от корня, функции вызываются все',
      'начинает с фибера, где звали `setState`, и пропускает поддеревья без работы по `childLanes` — [разобрано здесь](/frameworks/react-rerender/#s2)',
    ],
    [
      'Приоритеты',
      'одна очередь, одна скорость',
      '**полосы** (`lanes`): биты одного числа на каждое обновление; клик срочнее перехода — [«React изнутри: конкурентность и lanes»](/frameworks/react-concurrent-internals/)',
    ],
    [
      'Прерывание',
      'любое новое обновление бросает дерево',
      'решает по приоритету пришедшего обновления, бросать ли начатое дерево — [там же](/frameworks/react-concurrent-internals/)',
    ],
    [
      'Хуки',
      'массив на файбере',
      'связный список (`memoizedState` → `next`), очередь — кольцо с полосой у каждой записи; есть ранний выход, когда `setState` получает то же значение — [«React изнутри: хуки и контекст»](/frameworks/react-hooks-internals/)',
    ],
    [
      'Suspense',
      'нет',
      'компонент бросает промис, React ловит его на ближайшей границе и показывает заглушку — [«React изнутри: конкурентность и lanes»](/frameworks/react-concurrent-internals/)',
    ],
    [
      'Контекст, `ref`, события',
      'нет',
      'контекст помечает потребителей работой мимо пропсов ([«React изнутри: хуки и контекст»](/frameworks/react-hooks-internals/)); `ref` присваивается в коммите; события — один слушатель на корне, делегирование',
    ],
    [
      'Компонент, вернувший массив или строку',
      'нельзя: один элемент или `null`',
      'можно: фрагменты, массивы, строки, числа',
    ],
    [
      'Серверный рендер',
      'нет',
      '`react-dom/server` проходит дерево один раз и пишет строку: без коммита и без эффектов. Что это значит для `memo` и эффектов — [«Ре-рендеринг в React», подраздел «Первый рендер»](/frameworks/react-rerender/#s2)',
    ],
    [
      'Гидратация',
      'нет',
      '`hydrateRoot` строит файберы поверх готовой разметки: вызывает каждую функцию компонента и выполняет все эффекты, но **не создаёт ни одного узла** — файбер забирает существующий. Проверено тестом: лог дословно как у первого монтирования, новых узлов ноль',
    ],
  ],
};

export const DIFF_NOTE =
  'Первая и последняя строки таблицы проверены тестом, остальные взяты из исходников React — ссылки в «Источниках». Расхождение по bailout тест держит явно: при `setState` в `Counter` мини-версия вызывает `App`, `Counter` и соседа, React — только `Counter`. Итоговая разметка при этом одинакова: лишние вызовы у мини-версии ничего не правят в хосте, потому что сверка не находит разницы.';

/**
 * Раздел «Против настоящего React»: как инструменты разработчика видят дерево файберов.
 * Исполняется тестом как напечатан — хук ставится до загрузки `react-dom`, дальше сценарий
 * `SCENARIO_UPDATE`: монтирование и два `setState`. Вывод — `DEVTOOLS_LOG`.
 */
export const DEVTOOLS_CODE = `// До загрузки react-dom — так делает расширение браузера
const buffers = [];   // корневые файберы, побывавшие на экране

window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
  supportsFiber: true,
  inject(renderer) { return 1; },          // react-dom представился: вот его номер
  onCommitFiberRoot(id, root) {            // зовётся после каждого коммита
    if (buffers.length === 0) walk(root.current.child, '');
    if (!buffers.includes(root.current)) buffers.push(root.current);
    log('коммит: на экране буфер ' + (buffers.indexOf(root.current) + 1) + ' из ' + buffers.length);
  },
  onCommitFiberUnmount() {},
};

// Панель компонентов — тот же обход, что у рабочего цикла: вниз к child, вбок к sibling
function walk(fiber, indent) {
  for (let f = fiber; f; f = f.sibling) {
    if (f.type) log(indent + (f.type.name || f.type));   // у текстового файбера type нет
    walk(f.child, indent + '  ');
  }
}`;

/** Вывод `DEVTOOLS_CODE` на `SCENARIO_UPDATE`: монтирование и два `setState`. */
export const DEVTOOLS_LOG = [
  'App',
  '  div',
  '    Counter',
  '      p',
  '    span',
  'коммит: на экране буфер 1 из 1',
  'коммит: на экране буфер 2 из 2',
  'коммит: на экране буфер 1 из 2',
];

export const DEVTOOLS_NOTE =
  'Расширение React DevTools не лезет в React изнутри: оно заранее кладёт в `window` объект-хук, а `react-dom` при загрузке находит его, представляется через `inject` и после каждого коммита зовёт `onCommitFiberRoot` с корнем. Дальше расширение читает то же дерево, что строилось в этой теме: панель компонентов — обход `child` и `sibling` от `root.current`. Последние три строки вывода — двойная буферизация на настоящем React: после второго коммита на экране второй объект корня, после третьего — снова первый. Хук вызывается и в продакшен-сборке (проверено отдельным прогоном), поэтому дерево компонентов видно и на боевом сайте; времён рендера там нет — об этом в [«Ре-рендеринге в React», раздел «Мемоизация»](/frameworks/react-rerender/#s5).';

/* ────────────────────────────── Тонкие места ────────────────────────────── */

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'Перенести последний элемент в начало — значит сдвинуть все остальные',
    d: 'Алгоритм с `lastPlacedIndex` двигает только то, что стояло левее уже оставленного на месте. Из `[a, b, c]` в `[c, a, b]` уезжают **два** узла, а не один: `c` остаётся, `a` и `b` едут за неё. Проверено тестом на обоих рендерерах. Для длинного списка, где элемент переносят из конца в начало, это N−1 перемещений узлов вместо одного.',
    tone: 'warn',
  },
  {
    n: '02',
    t: 'DOM-узлы создаются в render-фазе, а не в коммите',
    d: '`createInstance` вызывается, когда цикл дошёл до файбера, и новое поддерево собирается целиком вне документа. Коммит только вставляет его вершину — одной операцией. Выброшенный рендер оставляет после себя созданные, но никуда не вставленные узлы — их просто подберёт сборщик мусора.',
  },
  {
    n: '03',
    t: 'Очистки при удалении идут в обратном порядке',
    d: 'Эффекты монтирования и обновления выполняются снизу вверх — ребёнок раньше родителя. Очистки при удалении поддерева — сверху вниз: родитель раньше ребёнка. Код, который в очистке родителя рассчитывает, что дети уже прибрались, ошибается. Порядок сверен с React 19.3 тестом.',
    tone: 'warn',
  },
  {
    n: '04',
    t: 'Хук под условием ломается по-разному',
    d: 'Хуков стало больше, чем в прошлый раз, — React бросает исключение. Число то же, а два `useState` поменялись местами — React молчит, и значения тоже меняются местами. Проверено тестом: ни ошибки, ни предупреждения даже в отладочной сборке. Второй случай хуже первого: ошибки нет, данные неверные.',
    tone: 'err',
  },
  {
    n: '05',
    t: 'Функция компонента может быть вызвана и выброшена',
    d: 'Прерванный рендер начинается заново, и уже вызванные функции вызываются снова. В мини-версии это видно прямо: `setState` посреди нарезанного рендера — и счётчик вызовов растёт без единого коммита между ними. Запрос, подписка или запись в переменную снаружи в теле компонента выполнятся столько раз, сколько было попыток, а не коммитов.',
    tone: 'err',
  },
  {
    n: '06',
    t: 'Очередь хука чистит коммит, а не рендер',
    d: 'Если бы рендер забирал обновления из очереди сразу, выброшенный рендер уносил бы их с собой. Поэтому обновления лежат в очереди, пока их рендер не закоммичен, — и перезапущенный рендер проходит по той же очереди заново. У React то же свойство держится на «базовой» очереди хука.',
  },
];

/* ───────────────────────────── Источники ───────────────────────────── */

export const SOURCES = [
  {
    title: 'Build your own React — Rodrigo Pombo',
    href: 'https://pomb.us/build-your-own-react/',
    what: 'Классический разбор «Didact» в восемь шагов: элемент, файбер, рабочий цикл, хуки. Мини-версия темы выросла из него и дополнена тем, чего там нет: двойной буферизацией, ключами, эффектами и батчингом.',
  },
  {
    title: 'ReactFiberWorkLoop.js — исходники React',
    href: 'https://github.com/facebook/react/blob/main/packages/react-reconciler/src/ReactFiberWorkLoop.js',
    what: '`workLoopConcurrent`, `performUnitOfWork`, `completeUnitOfWork` и `commitRoot` — настоящие версии функций с теми же именами.',
  },
  {
    title: 'ReactChildFiber.js — исходники React',
    href: 'https://github.com/facebook/react/blob/main/packages/react-reconciler/src/ReactChildFiber.js',
    what: '`reconcileChildrenArray` и `placeChild` с тем самым `lastPlacedIndex`.',
  },
  {
    title: 'ReactFiberHooks.js — исходники React',
    href: 'https://github.com/facebook/react/blob/main/packages/react-reconciler/src/ReactFiberHooks.js',
    what: 'Хуки как связный список, `mountState` и `updateReducer`, базовая очередь, ранний выход при том же значении, ошибка «Rendered more hooks».',
  },
  {
    title: 'react-reconciler — README',
    href: 'https://github.com/facebook/react/tree/main/packages/react-reconciler',
    what: 'Настоящий host config: полный список функций, которые пишет автор своего рендерера.',
  },
  {
    title: 'React Fiber Architecture — Andrew Clark',
    href: 'https://github.com/acdlite/react-fiber-architecture',
    what: 'Зачем понадобились файберы: прерываемость, приоритеты, переиспользование работы. Текст написан до выхода Fiber, но идеи в нём те же.',
  },
];

export const RELATED =
  'Смежное на сайте: [Vue 3 изнутри](/frameworks/vue-internals/) — вторая модель, тоже собранная своими руками: вместо сверки дерева — таблица «кто что читал». [Ре-рендеринг в React](/frameworks/react-rerender/) — то же самое снаружи: сколько вызовов, что делает `memo`, где bailout. [React против Vue](/frameworks/react-vs-vue/) — вторая модель рядом с этой. [Реактивность Vue](/frameworks/vue-reactivity/) — как можно обойтись без сверки деревьев вовсе. [React изнутри: хуки и контекст](/frameworks/react-hooks-internals/) и [React изнутри: конкурентность и lanes](/frameworks/react-concurrent-internals/) — то, что эта мини-версия упрощает: настоящие хуки и полосы приоритетов. [MessageChannel](/js/message-channel/) — чем планировщик React отпускает поток. [Event Loop](/js/event-loop/) — микрозадача, в которой начинается батч.';
