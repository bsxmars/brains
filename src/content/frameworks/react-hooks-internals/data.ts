import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { HooksScenario } from '@/widgets/mini-hooks/model/types';
import { STEP_ELEMENT } from '../react-internals/data';

/**
 * Данные темы «React изнутри: хуки и контекст».
 *
 * Тема продолжает «React изнутри: свой рендерер и хуки» и берёт оттуда одну вещь как есть —
 * `createElement` (`STEP_ELEMENT`, импортом, а не копией). Всё остальное здесь своё: у того
 * рендерера нет пропуска поддерева, а без него не показать ни `memo`, ни контекст, ни то,
 * почему `setState` тем же значением иногда всё же вызывает функцию.
 *
 * Код мини-реализации — строки `STEP_*`, напечатанные по разделам; `MINI_HOOKS_CODE` — они же
 * подряд. Эту склейку исполняют **и тест, и демо** через `buildMiniHooks` из
 * `widgets/mini-hooks/model/build.ts`. Код сценариев (`SCENARIO_*`) исполняется дважды:
 * мини-версией и **настоящим React 19.3.0** — в `tests/unit/react-hooks-internals.test.ts`.
 *
 * React в тесте работает на поддельном документе (как в `react-internals.test.ts`) и на
 * **`scheduler/unstable_mock`** вместо настоящего планировщика: тест подкладывает его в кеш
 * модулей до загрузки `react-dom`. Так нарезка перехода управляется без таймеров — «отдать
 * поток после первого компонента» — и разрыв стора воспроизводится у React детерминированно.
 * Экран после каждого коммита тест снимает через `__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot` —
 * тем же входом, которым пользуются инструменты разработчика.
 *
 * Что проверено этим тестом (Node 26.8.2, React 19.3.0, отладочная сборка):
 *   — `HOOK_CELLS`: форма каждой ячейки списка хуков — у мини-версии и у файбера React;
 *     `useContext` ячейки не занимает, `useSyncExternalStore` занимает две;
 *   — `CONTEXT_LOG`: кто вызван при смене темы, пользователя и постороннего состояния — у обоих;
 *   — `CELLS_LOG`: когда вызывается фабрика `useMemo`, что делает запись в `ref.current` — у обоих;
 *   — `SAME_VALUE_LOG`: `setState` тем же значением — ноль, один, ноль вызовов — у обоих;
 *   — `REDUCER_SAME_LOG`: `dispatch` к тому же состоянию вызывает функцию каждый раз — у обоих;
 *   — `TEAR_UPDATE_SCREENS` и `TEAR_MOUNT_LOG`: разрыв без хука и его отсутствие с хуком;
 *   — тексты ошибок правил хуков: «больше», «меньше», «вне компонента».
 *
 * Намеренные отличия зафиксированы тестом отдельно: срочный рендер мини-версия делает вместе
 * с переходом (React — отдельно, двумя коммитами), `memo` над текстовыми детьми у неё
 * не срабатывает, а бесконечный цикл из-за некешированного `getSnapshot` останавливает
 * предохранитель демо, а не счётчик вложенных обновлений.
 */

/* ───────────────────────────── Код мини-реализации ───────────────────────────── */

/** Каркас: файбер, у которого есть работа своя и работа ниже, и пропуск поддерева. */
export const STEP_BAILOUT = `const NoLanes = 0;
const SyncLane = 1;         // обновление из обработчика: рендер одним куском
const TransitionLane = 2;   // из startTransition: рендер режется на кванты

let root = null;            // { current, pendingProps, pendingLanes }
let wipRoot = null;
let nextUnitOfWork = null;
let renderLanes = NoLanes;  // какие обновления входят в этот рендер
let deletions = [];
let renderedFibers = [];    // чьи функции вызваны в этом рендере — дети раньше родителей

function createFiber(type, key, props) {
  return {
    type, key, props,
    memoizedProps: null,    // пропсы прошлого рендера — с ними сравнивают новые
    memoizedState: null,    // у компонента — первая ячейка списка хуков
    updateQueue: null,      // эффекты этого рендера
    dependencies: null,     // какие контексты компонент прочитал
    lanes: NoLanes,         // есть работа у самого файбера
    childLanes: NoLanes,    // есть работа где-то ниже
    return: null, child: null, sibling: null, alternate: null,
    index: 0, rendered: false,
  };
}

function createWorkInProgress(current, props) {
  let wip = current.alternate;
  if (wip === null) {
    wip = createFiber(current.type, current.key, props);
    wip.alternate = current;
    current.alternate = wip;
  }
  wip.props = props;
  wip.memoizedProps = current.memoizedProps;
  wip.memoizedState = current.memoizedState;
  wip.dependencies = current.dependencies;
  wip.updateQueue = null;
  wip.lanes = current.lanes;
  wip.childLanes = current.childLanes;
  wip.child = current.child;   // пока нет сверки — те же дети, что на экране
  wip.sibling = null;
  wip.rendered = false;
  return wip;
}

// memo — тип-обёртка: решение о пропуске принимает beginWork, а не сам компонент
function memo(type) {
  return { $$memo: true, type };
}

function beginWork(wip) {
  const current = wip.alternate;
  if (wip.type.$$context) pushProvider(wip.type, wip.props.value);   // стек — до любого пропуска
  if (current !== null) {
    if (wip.type.$$memo && shallowEqual(current.memoizedProps, wip.props)) {
      wip.props = current.memoizedProps;   // memo: равные пропсы считаются теми же
    }
    if (wip.props === current.memoizedProps && (wip.lanes & renderLanes) === NoLanes) {
      return bailout(wip);                 // ни новых пропсов, ни своей работы
    }
  }
  wip.lanes = NoLanes;
  if (typeof wip.type === 'function' || wip.type.$$memo) return updateFunctionComponent(current, wip);
  if (wip.type.$$context) return updateProvider(current, wip);
  reconcileChildren(wip, wip.props.children);   // корень и хост-элементы
  return wip.child;
}

function bailout(wip) {
  if ((wip.childLanes & renderLanes) === NoLanes) return null;   // ниже работы нет — поддерево не трогаем
  let prev = null;                                               // есть — спускаемся, не вызывая функцию
  for (let old = wip.alternate.child; old !== null; old = old.sibling) {
    const child = createWorkInProgress(old, old.memoizedProps);   // те же пропсы: ребёнок тоже сможет пропуститься
    child.return = wip;
    child.index = old.index;
    if (prev) prev.sibling = child;
    else wip.child = child;
    prev = child;
  }
  return wip.child;
}

function performUnitOfWork(fiber) {
  const next = beginWork(fiber);
  fiber.memoizedProps = fiber.props;
  if (next !== null) return next;
  for (let node = fiber; node !== null; node = node.return) {
    completeUnitOfWork(node);
    if (node === wipRoot) return null;
    if (node.sibling !== null) return node.sibling;
  }
  return null;
}

function completeUnitOfWork(fiber) {
  if (fiber.type.$$context) popProvider(fiber.type);
  if (fiber.rendered) renderedFibers.push(fiber);
}

// Сверка без хоста: тип и ключ решают, обновить файбер или завести новый
function reconcileChildren(wip, elements) {
  const current = wip.alternate;
  const oldByKey = new Map();
  for (let old = current ? current.child : null; old !== null; old = old.sibling) {
    oldByKey.set(old.key ?? old.index, old);
  }
  let prev = null;
  wip.child = null;
  elements.forEach((element, index) => {
    const key = element.key ?? index;
    const old = oldByKey.get(key);
    let fiber;
    if (old && old.type === element.type) {
      oldByKey.delete(key);
      fiber = createWorkInProgress(old, element.props);
    } else {
      fiber = createFiber(element.type, element.key, element.props);
    }
    fiber.index = index;
    fiber.return = wip;
    if (prev) prev.sibling = fiber;
    else wip.child = fiber;
    prev = fiber;
  });
  oldByKey.forEach((old) => deletions.push(old));
}

function shallowEqual(a, b) {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => key === 'children'
    // createElement кладёт детей в новый массив на каждый вызов — сравниваем поэлементно
    ? a.children.length === b.children.length && a.children.every((child, i) => Object.is(child, b.children[i]))
    : Object.is(a[key], b[key]));
}`;

/** Корень: откуда берутся дорожки, кто режет рендер и что делает коммит. */
export const STEP_ROOT = `let isTransition = false;
let syncScheduled = false;
let taskScheduled = false;
let pendingPassive = null;

function render(element) {
  if (root === null) {
    const fiber = createFiber('ROOT', null, { children: [] });
    fiber.memoizedProps = fiber.props;
    root = { current: fiber, pendingProps: null, pendingLanes: NoLanes };
  }
  root.pendingProps = { children: [element] };
  root.pendingLanes |= SyncLane;
  ensureRootIsScheduled();
}

function startTransition(callback) {
  const prev = isTransition;
  isTransition = true;
  try { callback(); } finally { isTransition = prev; }
}

function requestUpdateLane() {
  return isTransition ? TransitionLane : SyncLane;
}

// Пометить работой сам файбер и дорожку к нему: пропуски выше не пройдут мимо
function scheduleUpdateOnFiber(fiber, lane) {
  fiber.lanes |= lane;
  if (fiber.alternate) fiber.alternate.lanes |= lane;
  for (let parent = fiber.return; parent !== null; parent = parent.return) {
    parent.childLanes |= lane;
    if (parent.alternate) parent.alternate.childLanes |= lane;
  }
  root.pendingLanes |= lane;
  ensureRootIsScheduled();
}

function ensureRootIsScheduled() {
  if (wipRoot !== null) {     // обновление посреди нарезанного рендера: начатое — в корзину
    wipRoot = null;
    nextUnitOfWork = null;
  }
  if (root.pendingLanes & SyncLane) {
    if (!syncScheduled) { syncScheduled = true; host.scheduleMicrotask(performSyncWork); }
  } else if (!taskScheduled) {
    taskScheduled = true;
    host.scheduleTask(performConcurrentWork);
  }
}

function performSyncWork() { syncScheduled = false; performWork(); }
function performConcurrentWork() { taskScheduled = false; performWork(); }

function performWork() {
  flushPassiveEffects();
  if (wipRoot === null) {
    if (root.pendingLanes === NoLanes) return;
    prepareFreshStack(root.pendingLanes);
  }
  const sliced = (renderLanes & SyncLane) === NoLanes;
  while (nextUnitOfWork !== null && !(sliced && host.shouldYield())) {
    nextUnitOfWork = performUnitOfWork(nextUnitOfWork);
  }
  if (nextUnitOfWork !== null) {             // отдали поток — продолжим следующей задачей
    if (!taskScheduled) { taskScheduled = true; host.scheduleTask(performConcurrentWork); }
    return;
  }
  if (sliced && !isRenderConsistentWithExternalStores()) {
    prepareFreshStack(renderLanes | SyncLane);   // стор сдвинулся между кусками — заново, без перерывов
    while (nextUnitOfWork !== null) nextUnitOfWork = performUnitOfWork(nextUnitOfWork);
  }
  commitRoot();
}

function prepareFreshStack(lanes) {
  unwindProviders();
  renderLanes = lanes;
  wipRoot = createWorkInProgress(root.current, root.pendingProps ?? root.current.memoizedProps);
  nextUnitOfWork = wipRoot;
  deletions = [];
  renderedFibers = [];
  storeChecks = [];
}

function commitRoot() {
  const unmounts = [];
  deletions.forEach((fiber) => collectUnmountEffects(fiber, unmounts));
  for (const fiber of renderedFibers) {
    for (let hook = fiber.memoizedState; hook !== null; hook = hook.next) {
      if (hook.processed) hook.queue.pending.splice(0, hook.processed);   // очередь чистит коммит
    }
  }
  root.current = wipRoot;                    // экран — это теперь дерево, собранное рендером
  root.pendingProps = null;
  root.pendingLanes &= ~renderLanes;
  wipRoot = null;
  renderLanes = NoLanes;
  pendingPassive = { fibers: renderedFibers.filter((fiber) => fiber.updateQueue !== null), unmounts };
  host.scheduleTask(flushPassiveEffects);
}`;

/** Общий механизм: диспетчер и две функции, которые ведут курсор по списку ячеек. */
export const STEP_DISPATCHER = `let currentlyRenderingFiber = null;
let currentHook = null;          // ячейка прошлого рендера, до которой дошли
let workInProgressHook = null;   // ячейка этого рендера
let didReceiveUpdate = false;    // изменилось ли то, что видит компонент
let dispatcher = null;           // вне рендера хуков нет

function updateFunctionComponent(current, wip) {
  didReceiveUpdate = current === null || wip.props !== current.memoizedProps
    || (wip.dependencies !== null && wip.dependencies.lanes !== NoLanes);   // сменился контекст
  const Component = wip.type.$$memo ? wip.type.type : wip.type;
  const children = renderWithHooks(current, wip, Component, wip.props);
  if (!didReceiveUpdate) {
    current.lanes &= ~renderLanes;   // функцию вызвали, результат тот же: снять работу и с текущего
    wip.updateQueue = null;
    return bailout(wip);
  }
  reconcileChildren(wip, children == null ? [] : [children]);
  return wip.child;
}

function renderWithHooks(current, wip, Component, props) {
  currentlyRenderingFiber = wip;
  wip.memoizedState = null;          // список ячеек строится заново
  wip.dependencies = null;
  wip.rendered = true;
  dispatcher = current !== null && current.memoizedState !== null
    ? HooksDispatcherOnUpdate
    : HooksDispatcherOnMount;
  try {
    const children = Component(props);
    if (currentHook !== null && currentHook.next !== null) {
      throw new Error('Rendered fewer hooks than expected. This may be caused by an accidental early return statement.');
    }
    return children;
  } finally {
    dispatcher = null;
    currentlyRenderingFiber = null;
    currentHook = null;
    workInProgressHook = null;
  }
}

// Первый рендер: завести ячейку и прицепить её в конец списка
function mountWorkInProgressHook(type) {
  const hook = { type, memoizedState: null, queue: null, next: null };
  if (workInProgressHook === null) currentlyRenderingFiber.memoizedState = workInProgressHook = hook;
  else workInProgressHook = workInProgressHook.next = hook;
  return hook;
}

// Следующие рендеры: шагнуть по списку прошлого рендера и скопировать ячейку
function updateWorkInProgressHook(type) {
  currentHook = currentHook === null
    ? currentlyRenderingFiber.alternate.memoizedState
    : currentHook.next;
  if (currentHook === null) throw new Error('Rendered more hooks than during the previous render.');
  const hook = { type, memoizedState: currentHook.memoizedState, queue: currentHook.queue, next: null };
  if (workInProgressHook === null) currentlyRenderingFiber.memoizedState = workInProgressHook = hook;
  else workInProgressHook = workInProgressHook.next = hook;
  return hook;
}

const HooksDispatcherOnMount = {
  useState: mountState, useReducer: mountReducer, useRef: mountRef,
  useMemo: mountMemo, useCallback: mountCallback, useContext: readContext,
  useEffect: mountEffect, useSyncExternalStore: mountSyncExternalStore,
};
const HooksDispatcherOnUpdate = {
  useState: updateState, useReducer: updateReducer, useRef: updateRef,
  useMemo: updateMemo, useCallback: updateCallback, useContext: readContext,
  useEffect: updateEffect, useSyncExternalStore: updateSyncExternalStore,
};

function resolveDispatcher() {
  if (dispatcher === null) {
    throw new Error('Invalid hook call. Hooks can only be called inside of the body of a function component.');
  }
  return dispatcher;
}

// То, что импортирует приложение, — только переадресация к текущему диспетчеру
function useState(initial) { return resolveDispatcher().useState(initial); }
function useReducer(reducer, arg, init) { return resolveDispatcher().useReducer(reducer, arg, init); }
function useRef(initial) { return resolveDispatcher().useRef(initial); }
function useMemo(create, deps) { return resolveDispatcher().useMemo(create, deps); }
function useCallback(callback, deps) { return resolveDispatcher().useCallback(callback, deps); }
function useContext(context) { return resolveDispatcher().useContext(context); }
function useEffect(create, deps) { return resolveDispatcher().useEffect(create, deps); }
function useSyncExternalStore(subscribe, getSnapshot) {
  return resolveDispatcher().useSyncExternalStore(subscribe, getSnapshot);
}`;

/** `useRef`: ячейка с объектом — и больше ничего. */
export const STEP_REF = `function mountRef(initial) {
  const hook = mountWorkInProgressHook('useRef');
  hook.memoizedState = { current: initial };
  return hook.memoizedState;
}

function updateRef() {
  return updateWorkInProgressHook('useRef').memoizedState;   // тот же объект, что при монтировании
}`;

/** `useMemo` и `useCallback`: пара «значение, зависимости» и сравнение через `Object.is`. */
export const STEP_MEMO = `function areHookInputsEqual(next, prev) {
  if (prev === null) return false;     // без массива зависимостей — пересчёт на каждом рендере
  for (let i = 0; i < prev.length && i < next.length; i++) {
    if (!Object.is(next[i], prev[i])) return false;
  }
  return true;
}

function mountMemo(create, deps) {
  const hook = mountWorkInProgressHook('useMemo');
  const value = create();
  hook.memoizedState = [value, deps === undefined ? null : deps];
  return value;
}

function updateMemo(create, deps) {
  const hook = updateWorkInProgressHook('useMemo');
  const nextDeps = deps === undefined ? null : deps;
  const [prevValue, prevDeps] = hook.memoizedState;
  if (nextDeps !== null && areHookInputsEqual(nextDeps, prevDeps)) return prevValue;   // пара не тронута
  const value = create();
  hook.memoizedState = [value, nextDeps];
  return value;
}

// useCallback — тот же useMemo, только «вычислять» нечего: хранится сама функция
function mountCallback(callback, deps) {
  const hook = mountWorkInProgressHook('useCallback');
  hook.memoizedState = [callback, deps === undefined ? null : deps];
  return callback;
}

function updateCallback(callback, deps) {
  const hook = updateWorkInProgressHook('useCallback');
  const nextDeps = deps === undefined ? null : deps;
  const [prevCallback, prevDeps] = hook.memoizedState;
  if (nextDeps !== null && areHookInputsEqual(nextDeps, prevDeps)) return prevCallback;
  hook.memoizedState = [callback, nextDeps];
  return callback;
}`;

/** `useReducer` и `useState`: очередь, редьюсер и ранний выход. */
export const STEP_REDUCER = `function basicStateReducer(state, action) {
  return typeof action === 'function' ? action(state) : action;
}

function mountReducer(reducer, initialArg, init) {
  const hook = mountWorkInProgressHook('useReducer');
  hook.memoizedState = init !== undefined ? init(initialArg) : initialArg;
  hook.queue = { pending: [], lastRenderedReducer: reducer, lastRenderedState: hook.memoizedState, dispatch: null };
  hook.queue.dispatch = dispatchReducerAction.bind(null, currentlyRenderingFiber, hook.queue);
  return [hook.memoizedState, hook.queue.dispatch];
}

// useState — тот же useReducer с готовым редьюсером. Отличие одно — в dispatch
function mountState(initial) {
  const hook = mountWorkInProgressHook('useState');
  hook.memoizedState = typeof initial === 'function' ? initial() : initial;
  hook.queue = { pending: [], lastRenderedReducer: basicStateReducer, lastRenderedState: hook.memoizedState, dispatch: null };
  hook.queue.dispatch = dispatchSetState.bind(null, currentlyRenderingFiber, hook.queue);
  return [hook.memoizedState, hook.queue.dispatch];
}

function updateReducer(reducer) { return updateReducerImpl(updateWorkInProgressHook('useReducer'), reducer); }
function updateState() { return updateReducerImpl(updateWorkInProgressHook('useState'), basicStateReducer); }

function updateReducerImpl(hook, reducer) {
  const queue = hook.queue;
  let state = hook.memoizedState;            // состояние последнего коммита
  for (const update of queue.pending) {
    state = update.hasEagerState ? update.eagerState : reducer(state, update.action);
  }
  hook.processed = queue.pending.length;     // убрать из очереди — дело коммита
  if (!Object.is(state, hook.memoizedState)) didReceiveUpdate = true;
  hook.memoizedState = state;
  queue.lastRenderedReducer = reducer;
  queue.lastRenderedState = state;
  return [state, queue.dispatch];
}

function dispatchReducerAction(fiber, queue, action) {
  queue.pending.push({ action, hasEagerState: false, eagerState: null });
  scheduleUpdateOnFiber(fiber, requestUpdateLane());
}

function dispatchSetState(fiber, queue, action) {
  const update = { action, hasEagerState: false, eagerState: null };
  const alternate = fiber.alternate;
  if (fiber.lanes === NoLanes && (alternate === null || alternate.lanes === NoLanes)) {
    // Работы у файбера нет ни в одном из деревьев — новое состояние можно посчитать прямо здесь
    update.hasEagerState = true;
    update.eagerState = queue.lastRenderedReducer(queue.lastRenderedState, action);
    if (Object.is(update.eagerState, queue.lastRenderedState)) return;   // то же значение — рендера не будет
  }
  queue.pending.push(update);
  scheduleUpdateOnFiber(fiber, requestUpdateLane());
}`;

/** Контекст: стек значений при обходе и пометка читателей мимо пропсов. */
export const STEP_CONTEXT = `const providerStack = [];   // { context, value } — что было до провайдера

function createContext(defaultValue) {
  const context = { $$context: true, _currentValue: defaultValue, displayName: undefined };
  context.Provider = context;       // в React 19 <Ctx value> и <Ctx.Provider value> — одно и то же
  return context;
}

function pushProvider(context, value) {
  providerStack.push({ context, value: context._currentValue });
  context._currentValue = value;
}
function popProvider(context) {
  context._currentValue = providerStack.pop().value;
}
function unwindProviders() {        // брошенный посреди дерева рендер оставил провайдеры на стеке
  while (providerStack.length) {
    const { context, value } = providerStack.pop();
    context._currentValue = value;
  }
}

// Чтение — это и подписка: запись на файбере. Ячейки в списке хуков нет
function readContext(context) {
  const fiber = currentlyRenderingFiber;
  if (fiber.dependencies === null) fiber.dependencies = { lanes: NoLanes, contexts: [] };
  fiber.dependencies.contexts.push(context);
  return context._currentValue;
}

function updateProvider(current, wip) {
  if (current !== null && !Object.is(current.memoizedProps.value, wip.props.value)) {
    propagateContextChange(wip, wip.type);
  }
  reconcileChildren(wip, wip.props.children);
  return wip.child;
}

// Обойти поддерево провайдера и дать работу каждому, кто читал этот контекст
function propagateContextChange(provider, context) {
  const visit = (fiber) => {
    for (; fiber !== null; fiber = fiber.sibling) {
      if (fiber.dependencies !== null && fiber.dependencies.contexts.includes(context)) {
        fiber.lanes |= renderLanes;
        if (fiber.alternate) fiber.alternate.lanes |= renderLanes;
        fiber.dependencies.lanes |= renderLanes;
        for (let p = fiber.return; p !== null && p !== provider && p !== provider.alternate; p = p.return) {
          p.childLanes |= renderLanes;              // дорожка вниз — сквозь любой memo
          if (p.alternate) p.alternate.childLanes |= renderLanes;
        }
      }
      if (fiber.type !== context) visit(fiber.child);   // вложенный провайдер того же контекста — граница
    }
  };
  visit(provider.child);
}`;

/** Внешний стор: снимок, подписка и проверка согласованности. */
export const STEP_STORE = `let storeChecks = [];   // что прочитано из сторов в нарезанном рендере

function mountSyncExternalStore(subscribe, getSnapshot) {
  const fiber = currentlyRenderingFiber;
  const hook = mountWorkInProgressHook('useSyncExternalStore');
  const value = getSnapshot();
  hook.memoizedState = value;
  const inst = { value, getSnapshot };
  hook.queue = inst;
  // Подписка — эффект, а у эффекта своя ячейка: хук занимает две
  mountEffectImpl('useEffect ← подписка', () => subscribeToStore(fiber, inst, subscribe), [subscribe]);
  pushEffect(true, () => updateStoreInstance(fiber, inst, value, getSnapshot), null, { destroy: null });
  if ((renderLanes & SyncLane) === NoLanes) storeChecks.push({ getSnapshot, value });
  return value;
}

function updateSyncExternalStore(subscribe, getSnapshot) {
  const fiber = currentlyRenderingFiber;
  const hook = updateWorkInProgressHook('useSyncExternalStore');
  const value = getSnapshot();
  const changed = !Object.is(hook.memoizedState, value);
  if (changed) {
    hook.memoizedState = value;
    didReceiveUpdate = true;
  }
  const inst = hook.queue;
  updateEffectImpl('useEffect ← подписка', () => subscribeToStore(fiber, inst, subscribe), [subscribe]);
  if (changed || inst.getSnapshot !== getSnapshot) {
    pushEffect(true, () => updateStoreInstance(fiber, inst, value, getSnapshot), null, { destroy: null });
    if ((renderLanes & SyncLane) === NoLanes) storeChecks.push({ getSnapshot, value });
  }
  return value;
}

// После коммита: запомнить показанное и сразу проверить, не устарело ли оно уже
function updateStoreInstance(fiber, inst, value, getSnapshot) {
  inst.value = value;
  inst.getSnapshot = getSnapshot;
  if (checkIfSnapshotChanged(inst)) forceStoreRerender(fiber);
}

function subscribeToStore(fiber, inst, subscribe) {
  return subscribe(() => {
    if (checkIfSnapshotChanged(inst)) forceStoreRerender(fiber);
  });
}

function checkIfSnapshotChanged(inst) {
  return !Object.is(inst.value, inst.getSnapshot());
}

// Только синхронно: нарезанный рендер мог бы собрать экран из разных версий стора
function forceStoreRerender(fiber) {
  scheduleUpdateOnFiber(fiber, SyncLane);
}

// Конец нарезанного рендера: всё ли прочитанное ещё совпадает со стором
function isRenderConsistentWithExternalStores() {
  return storeChecks.every((check) => Object.is(check.getSnapshot(), check.value));
}`;

/** `useEffect` — коротко: ячейка с зависимостями и объект `inst`, где живёт очистка. */
export const STEP_EFFECT = `function pushEffect(hasEffect, create, deps, inst) {
  const effect = { hasEffect, create, deps, inst };
  if (currentlyRenderingFiber.updateQueue === null) currentlyRenderingFiber.updateQueue = [];
  currentlyRenderingFiber.updateQueue.push(effect);
  return effect;
}

function mountEffectImpl(type, create, deps) {
  const hook = mountWorkInProgressHook(type);
  hook.memoizedState = pushEffect(true, create, deps === undefined ? null : deps, { destroy: null });
}

function updateEffectImpl(type, create, deps) {
  const hook = updateWorkInProgressHook(type);
  const nextDeps = deps === undefined ? null : deps;
  const prev = hook.memoizedState;
  const changed = nextDeps === null || !areHookInputsEqual(nextDeps, prev.deps);
  hook.memoizedState = pushEffect(changed, create, nextDeps, prev.inst);   // inst общий: в нём очистка
}

function mountEffect(create, deps) { mountEffectImpl('useEffect', create, deps); }
function updateEffect(create, deps) { updateEffectImpl('useEffect', create, deps); }

// Задача после коммита: сначала все очистки, потом все эффекты
function flushPassiveEffects() {
  if (pendingPassive === null) return;
  const { fibers, unmounts } = pendingPassive;
  pendingPassive = null;
  unmounts.forEach((destroy) => destroy());
  const effects = fibers.flatMap((fiber) => fiber.updateQueue).filter((effect) => effect.hasEffect);
  effects.forEach((effect) => {
    if (effect.inst.destroy) effect.inst.destroy();
    effect.inst.destroy = null;
  });
  effects.forEach((effect) => {
    const destroy = effect.create();
    effect.inst.destroy = typeof destroy === 'function' ? destroy : null;
  });
}

function collectUnmountEffects(fiber, out) {
  for (let hook = fiber.memoizedState; typeof fiber.type !== 'string' && hook !== null; hook = hook.next) {
    const destroy = hook.memoizedState?.inst?.destroy;   // ячейка эффекта хранит объект эффекта
    if (destroy) out.push(destroy);
  }
  for (let child = fiber.child; child !== null; child = child.sibling) collectUnmountEffects(child, out);
}`;

/**
 * Вся мини-реализация подряд. Первым — `createElement` из «React изнутри», импортом:
 * элемент тот же, меняется только то, что с ним делают.
 */
export const MINI_HOOKS_CODE = [
  STEP_ELEMENT,
  STEP_BAILOUT,
  STEP_ROOT,
  STEP_DISPATCHER,
  STEP_REF,
  STEP_MEMO,
  STEP_REDUCER,
  STEP_CONTEXT,
  STEP_STORE,
  STEP_EFFECT,
].join('\n\n');

/* ─────────────────────────────── Сценарии ─────────────────────────────── */

/**
 * Код сценариев исполняется как есть: у мини-версии `h` — её `createElement`, у React —
 * `React.createElement`, и так же со всеми хуками, `memo`, `createContext` и `startTransition`.
 * `log` — вывод компонента, `expose` — ручка наружу для кнопки демо и для теста.
 */
export const SCENARIO_CELLS = `const Theme = createContext('светлая');
Theme.displayName = 'Theme';

const FRUITS = ['ананас', 'банан', 'вишня', 'груша', 'дыня'];

function Search() {
  const [query, setQuery] = useState('');
  const [tick, setTick] = useState(0);
  const clicks = useRef(0);
  const found = useMemo(() => {
    log('useMemo: фильтрую по «' + query + '»');
    return FRUITS.filter((fruit) => fruit.includes(query));
  }, [query]);
  const pick = useCallback((fruit) => setQuery(fruit), []);
  const theme = useContext(Theme);
  useEffect(() => log('effect: query=«' + query + '»'), [query]);
  log('render Search tick=' + tick);

  expose('query', () => setQuery((q) => (q === '' ? 'ш' : '')));
  expose('tick', () => setTick((t) => t + 1));
  expose('ref', () => { clicks.current += 1; });
  expose('same', () => setQuery(query));
  return h('p', null, theme + ': ' + found.join(', '));
}

function App() {
  return h(Theme, { value: 'тёмная' }, h(Search));
}`;

export const SCENARIO_CONTEXT = `const Settings = createContext(null);   // тема и язык — одним объектом
Settings.displayName = 'Settings';
const User = createContext(null);       // пользователь — отдельным контекстом
User.displayName = 'User';

function ThemeLabel() {
  const { theme } = useContext(Settings);
  log('render ThemeLabel');
  return h('i', null, theme);
}

function LangLabel() {
  const { lang } = useContext(Settings);   // читает только язык — но подписан на весь объект
  log('render LangLabel');
  return h('i', null, lang);
}

function UserBadge() {
  const user = useContext(User);
  log('render UserBadge');
  return h('b', null, user);
}

const Toolbar = memo(function Toolbar() {
  log('render Toolbar');
  return h('div', null, h(ThemeLabel), h(LangLabel), h(UserBadge));
});

const Sidebar = memo(function Sidebar() {
  log('render Sidebar');
  return h('aside', null, 'меню');
});

function App() {
  const [theme, setTheme] = useState('светлая');
  const [user, setUser] = useState('Аня');
  const [tick, setTick] = useState(0);
  const settings = useMemo(() => ({ theme, lang: 'ru' }), [theme]);
  log('render App');

  expose('theme', () => setTheme((t) => (t === 'светлая' ? 'тёмная' : 'светлая')));
  expose('user', () => setUser((u) => (u === 'Аня' ? 'Борис' : 'Аня')));
  expose('tick', () => setTick((t) => t + 1));
  return h(Settings, { value: settings },
    h(User, { value: user }, h(Toolbar), h(Sidebar)));
}`;

/** Стор без React: одно число и список слушателей. Общий для обоих вариантов разрыва. */
const STORE_CODE = `function createStore() {
  let value = 0;
  const listeners = new Set();
  return {
    get: () => value,
    set: (next) => {
      value = next;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const store = createStore();`;

const tearScenario = (read: string) => `${STORE_CODE}

function Cell({ name }) {
  ${read}
  log(name + '=' + value);
  return h('b', null, name + '=' + value + ' ');
}

function App() {
  const [round, setRound] = useState(0);
  expose('transition', () => startTransition(() => setRound((r) => r + 1)));
  expose('storeSet', () => store.set(store.get() + 1));
  return h('p', null,
    h(Cell, { name: 'A', round }),
    h(Cell, { name: 'B', round }),
    h(Cell, { name: 'C', round }));
}`;

export const SCENARIO_TEAR_PLAIN = tearScenario('const value = store.get();   // чтение в рендере, без подписки');
export const SCENARIO_TEAR_SYNC = tearScenario('const value = useSyncExternalStore(store.subscribe, store.get);');

/** Разрыв на монтировании: подписки ещё нет, спасает только проверка в конце рендера. */
const tearMountScenario = (read: string) => `${STORE_CODE}

function Cell({ name }) {
  ${read}
  log(name + '=' + value);
  return h('b', null, name + '=' + value + ' ');
}

function App() {
  const [shown, setShown] = useState(false);
  expose('reveal', () => startTransition(() => setShown(true)));
  expose('storeSet', () => store.set(store.get() + 1));
  return h('p', null, shown
    ? [h(Cell, { key: 'A', name: 'A' }), h(Cell, { key: 'B', name: 'B' }), h(Cell, { key: 'C', name: 'C' })]
    : null);
}`;

export const SCENARIO_TEAR_MOUNT_PLAIN = tearMountScenario('const value = store.get();');
export const SCENARIO_TEAR_MOUNT_SYNC = tearMountScenario('const value = useSyncExternalStore(store.subscribe, store.get);');

const TEAR_ACTIONS = [
  {
    name: 'transition',
    label: 'переход, и посреди рендера store.set',
    interleave: { afterLogs: 1, then: 'storeSet', label: 'store.set(store.get() + 1)' },
  },
  { name: 'storeSet', label: 'store.set вне рендера' },
];

export const DEMO_SCENARIOS: HooksScenario[] = [
  {
    key: 'cells',
    label: 'ячейки одного компонента',
    code: SCENARIO_CELLS,
    actions: [
      { name: 'query', label: 'setQuery: «» ↔ «ш»' },
      { name: 'tick', label: 'setTick(t + 1)' },
      { name: 'ref', label: 'clicks.current += 1' },
      { name: 'same', label: 'setQuery(query)' },
    ],
    note: 'Семь вызовов хуков — шесть ячеек: `useContext` в списке не живёт, он записан в `dependencies`. `setTick` вызывает функцию, но `useMemo` отдаёт пару из кеша: зависимость `query` та же по `Object.is`. `clicks.current += 1` меняет ячейку — и ничего больше: ни рендера, ни коммита. `setQuery(query)` сразу после смены `query` вызовет функцию **один раз**, а повторное нажатие — уже ни разу.',
  },
  {
    key: 'context',
    label: 'контекст мимо memo',
    code: SCENARIO_CONTEXT,
    actions: [
      { name: 'theme', label: 'сменить тему' },
      { name: 'user', label: 'сменить пользователя' },
      { name: 'tick', label: 'App: постороннее состояние' },
    ],
    note: 'Смена темы: `App` рендерится, `Toolbar` и `Sidebar` пропускаются как `memo` — но `Toolbar` пропускается **со спуском**: у него `childLanes`, и под ним рендерятся оба читателя `Settings`. `LangLabel` читает язык, который не менялся, и всё равно вызван: подписка — на весь объект. `UserBadge` не тронут: у него другой контекст. Постороннее состояние `App` не будит никого: `useMemo` вернул тот же объект настроек.',
  },
  {
    key: 'tear-plain',
    label: 'стор без хука',
    code: SCENARIO_TEAR_PLAIN,
    actions: TEAR_ACTIONS,
    tearCheck: true,
    note: 'Переход режет рендер по одному файберу. После `A` в поток вклинивается событие и меняет стор. `B` и `C` читают уже новое значение — и коммит показывает экран, которого не было ни в одной версии стора: `A=0 B=1 C=1`. Подписки нет, и исправить его некому до следующего рендера.',
  },
  {
    key: 'tear-sync',
    label: 'стор через useSyncExternalStore',
    code: SCENARIO_TEAR_SYNC,
    actions: TEAR_ACTIONS,
    tearCheck: true,
    note: 'То же событие в то же место. Но теперь у ячеек есть подписка: слушатель видит, что снимок устарел, и ставит **синхронное** обновление. Оно бросает недостроенный переход, и дерево строится заново, одним куском. Экран с разрывом не попадает в коммит ни разу.',
  },
];

/* ──────────────────────── Что сверено с настоящим React ──────────────────────── */

/** Компонент со всеми хуками темы — по одному. Список его ячеек сверяется с файбером React. */
export const HOOK_CELLS_CODE = `const Theme = createContext('светлая');
const store = { get: () => 7, subscribe: () => () => {} };

function Probe() {
  const [count] = useState(0);
  const box = useRef(null);
  const double = useMemo(() => count * 2, [count]);
  const onClick = useCallback(() => count, [count]);
  const theme = useContext(Theme);
  useEffect(() => {}, [count]);
  const seven = useSyncExternalStore(store.subscribe, store.get);
  const [mode] = useReducer((state, action) => action, 'чтение');
  return h('p', null, theme + ' ' + double + ' ' + seven + ' ' + mode);
}

function App() {
  return h(Theme, { value: 'тёмная' }, h(Probe));
}`;

export const HOOK_CELLS = [
  { hook: 'useState', shape: 'очередь', note: '`memoizedState` — значение, `queue` — очередь обновлений и `dispatch`' },
  { hook: 'useRef', shape: '{ current }', note: 'объект, созданный один раз' },
  { hook: 'useMemo', shape: '[значение, deps]', note: 'пара «результат, зависимости»' },
  { hook: 'useCallback', shape: '[значение, deps]', note: 'та же пара, в ней сама функция' },
  { hook: 'useEffect', shape: 'эффект', note: 'объект эффекта: `create`, `deps`, `inst` с очисткой' },
  { hook: 'useSyncExternalStore', shape: 'снимок стора', note: 'снимок, в `queue` — `{ value, getSnapshot }`' },
  { hook: 'useSyncExternalStore', shape: 'эффект', note: 'вторая ячейка того же хука: эффект подписки' },
  { hook: 'useReducer', shape: 'очередь', note: 'то же устройство, что у `useState`' },
];

/**
 * `SCENARIO_CELLS` по шагам — логи дословно одинаковы у React и у мини-версии.
 * Порядок шагов важен: `same` сразу после `tick` вызывает функцию, повторный `same` — уже нет.
 */
export const CELLS_LOG = {
  mount: ['useMemo: фильтрую по «»', 'render Search tick=0', 'effect: query=«»'],
  steps: [
    ['query', ['useMemo: фильтрую по «ш»', 'render Search tick=0', 'effect: query=«ш»']],
    ['tick', ['render Search tick=1']],
    ['ref', []],
    ['same', ['render Search tick=1']],
    ['same', []],
    ['query', ['useMemo: фильтрую по «»', 'render Search tick=1', 'effect: query=«»']],
  ] as Array<[string, string[]]>,
};

/** `SCENARIO_CONTEXT` по шагам — дословно у обоих. */
export const CONTEXT_LOG = {
  mount: ['render App', 'render Toolbar', 'render ThemeLabel', 'render LangLabel', 'render UserBadge', 'render Sidebar'],
  steps: [
    ['theme', ['render App', 'render ThemeLabel', 'render LangLabel']],
    ['user', ['render App', 'render UserBadge']],
    ['tick', ['render App']],
    ['theme', ['render App', 'render ThemeLabel', 'render LangLabel']],
  ] as Array<[string, string[]]>,
};

export const SAME_VALUE_CODE = `function Child() {
  log('render Child');
  return h('i', null, 'ребёнок');
}

function App() {
  const [n, setN] = useState(0);
  log('render App n=' + n);
  expose('set0', () => setN(0));
  expose('set1', () => setN(1));
  return h('p', null, h(Child), String(n));
}`;

/** `setState` тем же значением: ноль, один, ноль — у обоих. Порядок шагов — часть утверждения. */
export const SAME_VALUE_LOG: Array<[string, string[]]> = [
  ['set0', []],
  ['set1', ['render App n=1', 'render Child']],
  ['set1', ['render App n=1']],
  ['set1', []],
  ['set0', ['render App n=0', 'render Child']],
  ['set0', ['render App n=0']],
  ['set0', []],
];

export const REDUCER_SAME_CODE = `function Child() {
  log('render Child');
  return h('i', null, 'ребёнок');
}

function App() {
  const [mode, dispatch] = useReducer((state, action) => action, 'чтение');
  log('render App ' + mode);
  expose('edit', () => dispatch('правка'));
  return h('p', null, h(Child), mode);
}`;

/** `dispatch` к тому же состоянию: функция вызывается каждый раз, ребёнок — только в первый. */
export const REDUCER_SAME_LOG: Array<[string, string[]]> = [
  ['edit', ['render App правка', 'render Child']],
  ['edit', ['render App правка']],
  ['edit', ['render App правка']],
];

/**
 * Экраны после каждого коммита, когда стор меняется между двумя кусками перехода.
 * `plain` — дословно у обоих. `sync` — у React: срочный рендер и затем сам переход, два
 * коммита; у мини-версии коммит один, последний (намеренное отличие, закреплено тестом).
 */
export const TEAR_UPDATE_SCREENS = {
  plain: ['<p><b>A=0 </b><b>B=1 </b><b>C=1 </b></p>'],
  sync: ['<p><b>A=1 </b><b>B=1 </b><b>C=1 </b></p>', '<p><b>A=1 </b><b>B=1 </b><b>C=1 </b></p>'],
};

/** То же на монтировании: подписки ещё нет. Логи и экраны дословно у обоих. */
export const TEAR_MOUNT_LOG = {
  plain: {
    logs: ['A=0', 'B=1', 'C=1'],
    screens: ['<p><b>A=0 </b><b>B=1 </b><b>C=1 </b></p>'],
  },
  sync: {
    logs: ['A=0', 'B=1', 'C=1', 'A=1', 'B=1', 'C=1'],
    screens: ['<p><b>A=1 </b><b>B=1 </b><b>C=1 </b></p>'],
  },
};

export const MEMO_TEXT_CODE = `const Label = memo(function Label({ children }) {
  log('render Label');
  return h('b', null, children);
});

function App() {
  const [n, setN] = useState(0);
  log('render App');
  expose('bump', () => setN((x) => x + 1));
  return h('p', null, h(Label, null, 'текст'), String(n));
}`;

export const UNCACHED_SNAPSHOT_CODE = `const store = { subscribe: () => () => {}, get: () => ({ value: 1 }) };

function App() {
  const snapshot = useSyncExternalStore(store.subscribe, store.get);   // новый объект на каждый вызов
  return h('p', null, String(snapshot.value));
}`;

/** `useContext` под условием: ячейки нет — список не сдвигается. */
export const COND_CONTEXT_CODE = `const Theme = createContext('светлая');

function App() {
  const [on, setOn] = useState(false);
  expose('on', () => setOn(true));
  const theme = on ? useContext(Theme) : '—';   // так писать нельзя — но что именно сломается?
  const [mark] = useState('!');
  return h('p', null, theme + mark);
}`;

/** Зависимости сравниваются через `Object.is`: `NaN` равен себе, новый объект — нет. */
export const DEPS_IS_CODE = `function App() {
  const [n, setN] = useState(0);
  useMemo(() => log('NaN: пересчёт'), [NaN]);
  useMemo(() => log('объект: пересчёт'), [{ id: 1 }]);
  useMemo(() => log('без массива: пересчёт'));
  expose('bump', () => setN((x) => x + 1));
  return h('p', null, String(n));
}`;

export const DEPS_IS_LOG = ['объект: пересчёт', 'без массива: пересчёт'];

/* ─────────────────────────── Демо по разделам ─────────────────────────── */

const pick = (...keys: string[]) => DEMO_SCENARIOS.filter((scenario) => keys.includes(scenario.key));

/** Каждое демо стоит в том разделе, который объясняет его механизм. */
export const DEMO_CELLS = pick('cells');
export const DEMO_CONTEXT = pick('context');
export const DEMO_TEAR = pick('tear-plain', 'tear-sync');

/** Как читать демо — один раз, у первого из трёх. */
export const DEMO_NOTE =
  'Демо исполняет всю мини-реализацию темы — шаги 1–9 подряд — в вашем браузере, на сценарии слева. Кнопки вызывают настоящие `setState`, запись в `ref` и `store.set`; «шаг» листает то, что при этом произошло. У каждого файбера видно, что с ним случилось в этом рендере: **вызван**, **пропущен** или **пропущен со спуском** — функция не вызвана, но ниже есть работа. Метки `lanes` и `childLanes` — работа у самого файбера и работа ниже. Под именем компонента — его ячейки по порядку, а прочитанный контекст отдельной строкой: ячейки у него нет.';

/* ────────────────────────────── Логи для страницы ────────────────────────────── */

/** Лог шагов строкой: `имя → вывод` или «ничего». Собирается из проверенных тестом массивов. */
const trace = (steps: Array<[string, string[]]>) =>
  steps.map(([name, logs]) => `${name.padEnd(6)} → ${logs.length ? logs.join(' · ') : 'функция не вызвана'}`).join('\n');

export const SAME_VALUE_TRACE = trace(SAME_VALUE_LOG);
export const REDUCER_SAME_TRACE = trace(REDUCER_SAME_LOG);
export const CONTEXT_TRACE = trace([['mount', CONTEXT_LOG.mount], ...CONTEXT_LOG.steps]);
export const DEPS_IS_TRACE = `bump   → ${DEPS_IS_LOG.join(' · ')}`;
export const TEAR_TRACE = [
  `без хука:  ${TEAR_UPDATE_SCREENS.plain.join('  ')}`,
  `с хуком:   ${TEAR_UPDATE_SCREENS.sync.join('  ')}   (React, два коммита)`,
].join('\n');
export const TEAR_MOUNT_TRACE = [
  `без хука:  рендер ${TEAR_MOUNT_LOG.plain.logs.join(' ')}  →  ${TEAR_MOUNT_LOG.plain.screens.join('  ')}`,
  `с хуком:   рендер ${TEAR_MOUNT_LOG.sync.logs.join(' ')}  →  ${TEAR_MOUNT_LOG.sync.screens.join('  ')}`,
].join('\n');

/** Таблица ячеек `Probe` — строки `HOOK_CELLS`, та же форма, что сверяет тест. */
export const HOOK_CELLS_TABLE = {
  head: ['#', 'вызов', 'что лежит в ячейке'],
  rows: HOOK_CELLS.map((row, i) => [String(i), `\`${row.hook}\``, row.note]),
};

/* ─────────────────────────────────── Зачин ─────────────────────────────────── */

export const GLOSSARY = [
  {
    k: 'ячейка хука',
    d: 'Объект `{ memoizedState, queue, next }` на файбере компонента. Каждый вызов хука в рендере берёт следующую ячейку, и ячейки связаны в список: `fiber.memoizedState` — первая, дальше по `next`.',
  },
  {
    k: 'диспетчер',
    d: 'Объект с реализациями всех хуков. `useState`, который импортирует приложение, только спрашивает у текущего диспетчера, что делать. В React он лежит в `ReactSharedInternals.H`, и рендерер подменяет его перед каждым вызовом компонента.',
  },
  {
    k: '`lanes` и `childLanes`',
    d: 'Два числа на файбере: есть ли работа у него самого и есть ли она где-то ниже. По ним React решает, вызывать ли функцию компонента и спускаться ли в его детей. Биты этих чисел — приоритеты обновлений.',
  },
  {
    k: 'bailout',
    d: 'Пропуск файбера: функция компонента не вызывается, прошлый результат остаётся. Бывает двух видов — пропустить поддерево целиком или пропустить только сам файбер и спуститься ниже, где есть работа.',
  },
  {
    k: 'eager state',
    d: 'Новое состояние, посчитанное прямо в `setState`, до рендера. Если оно равно текущему по `Object.is`, рендер не заказывается вовсе. Считать заранее можно не всегда — условие разобрано в теме.',
  },
  {
    k: 'внешний стор',
    d: 'Состояние, которое живёт вне React: модуль с переменной, Redux, Zustand, `window.matchMedia`. React не знает, когда оно меняется, — стор сам зовёт подписчиков.',
  },
  {
    k: 'разрыв (tearing)',
    d: 'Один экран показывает разные версии одних данных: одна часть интерфейса прочитала стор до изменения, другая — после. Возможен только тогда, когда рендер прерывается посередине.',
  },
];

export const PREREQ_NOTE =
  'Тема отвечает на вопрос «каким кодом это получается», а не «как это выглядит снаружи». Что такое файбер и почему хуки нельзя вызывать под условием, когда React пропускает компонент и зачем переходу нарезанный рендер — всё это здесь считается известным.';

export const PREREQ = [
  {
    t: 'Хуки — ячейки по номеру вызова',
    d: 'Хук не знает своего имени и находит своё состояние по порядку вызова. Там же — очередь `setState` и почему `setN(n + 1)` три раза даёт единицу. Здесь та же идея доведена до связного списка React.',
    href: '/frameworks/react-internals/#s5',
    hrefLabel: 'React изнутри: свой рендерер и хуки · Хуки',
    tone: 'info' as const,
  },
  {
    t: 'Файбер, два буфера и коммит',
    d: '`alternate`, дерево в работе и текущее дерево, render-фаза, которую можно выбросить, и коммит, который прервать нельзя. Ранний выход `setState` решается как раз по двум буферам.',
    href: '/frameworks/react-internals/#s3',
    hrefLabel: 'React изнутри: свой рендерер и хуки · Две фазы',
    tone: 'ok' as const,
  },
  {
    t: 'Когда React пропускает компонент',
    d: 'Три условия bailout, что меняет `memo` и почему контекст идёт мимо него — снаружи, на счётчиках вызовов. Здесь то же самое видно изнутри `beginWork`.',
    href: '/frameworks/react-rerender/#s2',
    hrefLabel: 'Ре-рендеринг в React · Дерево',
    tone: 'warn' as const,
  },
  {
    t: 'Переход режет рендер на куски',
    d: '`startTransition` помечает обновление несрочной полосой, и такой рендер отдаёт поток между файберами. Разрыв стора появляется ровно в этих промежутках.',
    href: '/frameworks/react-concurrent-internals/#s4',
    hrefLabel: 'React изнутри: конкурентность и lanes · Переходы',
    tone: 'err' as const,
  },
];

/* ─────────────────────────────── «На пальцах» ─────────────────────────────── */

export const PLAIN_CHILD_LANES =
  '`lanes` и `childLanes` — записки для почтальона. `lanes` висит на двери квартиры: «здесь ждут письмо». `childLanes` — на двери подъезда: «в этом подъезде кто-то ждёт». Почтальон не заходит в подъезд без записки, а в подъезде с запиской поднимается мимо всех дверей без записок — ни в одну не стучит.';

export const PLAIN_DISPATCHER =
  'Диспетчер — дежурный у камеры хранения. Кнопка одна и та же — `useState`, — но в первый день дежурный выдаёт новый шкафчик и записывает его в журнал, а во все следующие открывает шкафчики по журналу, по порядку. Когда дежурного нет, кнопка не работает вовсе: это и есть ошибка «хук вне компонента».';

export const PLAIN_EAGER =
  'Ранний выход — продавец, который смотрит в чек, прежде чем пробить покупку. Если вы просите то же, что уже купили, он отвечает «у вас это уже есть» и кассу не открывает. Но если у кассы очередь из ваших же непробитых покупок, по чеку ответить нельзя — чек устарел, и приходится пробивать всё заново.';

export const PLAIN_PROVIDER_STACK =
  'Провайдер — табличка «здесь говорят по-английски» на двери комнаты. Кто вошёл, говорит по-английски; вышел — снова на том языке, что был снаружи. Обход дерева входит в провайдер на спуске и выходит на подъёме, и стопка табличек у него в руке всегда отвечает, где он сейчас.';

export const PLAIN_TEARING =
  'Разрыв — перепись, которую ведут три счётчика по очереди. Первый переписал дом до того, как в него въехала семья, двое других — после. Каждый записал правду, но итоговая таблица описывает город, которого не было ни в одну минуту.';

/* ──────────────────────────────── Пояснения ──────────────────────────────── */

/** Раздел «Каркас». */
export const SKELETON_NOTE =
  'Мини-рендерер из [«React изнутри: свой рендерер и хуки»](/frameworks/react-internals/#s6) начинает каждый рендер с корня и вызывает все функции подряд. Такой рендерер не может показать ни `memo`, ни контекст: ему нечего пропускать. Поэтому здесь каркас свой — меньше того, зато с пропуском поддерева. Хоста нет вовсе: «экран» — разметка, прочитанная из текущего дерева файберов после коммита.';

export const LANES_NOTE =
  'Полос здесь две — синхронная и переходная, — и только ради того, чтобы нарезать рендер. У React их 31, и как он выбирает между ними, разобрано в [«React изнутри: конкурентность и lanes»](/frameworks/react-concurrent-internals/#s1).';

/** Раздел «Диспетчер». */
export const DISPATCHER_REACT_NOTE =
  'У React диспетчеров не два, а четыре — это видно прямо в продакшен-сборке `react-dom` 19.3.0. Третий, `HooksDispatcherOnRerender`, ставится, когда компонент вызвал `setState` прямо в своём теле: React тут же вызывает функцию ещё раз, не больше 25 раз подряд. Четвёртый, `ContextOnlyDispatcher`, стоит вне рендера: в нём каждый хук заменён заглушкой, которая бросает `Invalid hook call`. Не заменены только `use` и `readContext`: у них своя проверка и своя ошибка — про чтение контекста вне рендера. У мини-версии вне рендера просто `null`.';

export const CELLS_NOTE =
  '`useContext` в списке нет: чтение контекста записывается в `fiber.dependencies`, а не в ячейку. В отладочной сборке React ведёт отдельный список имён вызванных хуков, `_debugHookTypes`, — там `useContext` есть. `useSyncExternalStore` занимает **две** ячейки: снимок и эффект подписки.';

/** Раздел «useRef, useMemo, useCallback». */
export const MEMO_NOTE =
  '`useCallback(fn, deps)` — это `useMemo(() => fn, deps)`: «вычислять» нечего, в паре хранится сама функция. Новая функция создаётся на каждом рендере всё равно — стрелка в теле компонента вычисляется при каждом вызове, — просто наружу отдаётся старая. Когда эта стабильность что-то даёт, а когда нет, разобрано в [«Ре-рендеринге в React», раздел «Мемоизация»](/frameworks/react-rerender/#s5).';

export const DEPS_NOTE =
  '`Object.is(NaN, NaN)` — `true`, поэтому `[NaN]` считается неизменным. Литерал `{ id: 1 }` на каждом рендере новый, и пересчёт идёт каждый раз. Без массива зависимостей `areHookInputsEqual` не вызывается вовсе — пересчёт на каждом рендере. Вывод одинаков у мини-версии и у React.';

export const REF_NOTE =
  '`useRef` — ячейка, в которой лежит объект `{ current }`, созданный на монтировании. Запись в `current` меняет этот объект и больше ничего не делает: ни очереди, ни `scheduleUpdateOnFiber`. Поэтому `clicks.current += 1` в демо не даёт ни рендера, ни коммита — у мини-версии и у React.';

/** Раздел «useReducer и useState». */
export const EAGER_NOTE =
  'Считать заранее можно, только если у файбера нет работы **ни в одном из двух буферов**: иначе в очереди могут лежать обновления, которых `lastRenderedState` ещё не видел. Отсюда «ноль, один, ноль» по шагам. Первый `set1` меняет значение — вызваны `App` и `Child`. Рендер снимает пометку работы только с буфера, который строит, а на втором она остаётся. Второй `set1` видит эту пометку и считать заранее не может: `App` вызван, состояние то же, `Child` пропущен — и заодно снята пометка со второго буфера. Третий `set1` выходит рано: вызовов ноль. На практике: `setState` тем же значением не бесплатен гарантированно — функция компонента может вызваться ещё раз, но дети при этом не рендерятся, и DOM не трогается.';

export const REDUCER_NOTE =
  'У `dispatch` из `useReducer` раннего выхода нет вовсе: `dispatchReducerAction` ничего не считает и всегда заказывает рендер. Функция компонента вызывается каждый раз, и только в рендере выясняется, что состояние то же. Дети при этом пропускаются: `didReceiveUpdate` остаётся `false`, и `updateFunctionComponent` уходит в `bailout`.';

export const REDUCER_WHY =
  'Почему `useState` может считать заранее, а `useReducer` нет: редьюсер `useState` известен заранее и не меняется, а редьюсер `useReducer` — функция из тела компонента. На следующем рендере это может быть уже другая функция, и считать по старой нельзя.';

export const QUEUE_LINK =
  'Очередь здесь — массив, и каждый рендер сворачивает её целиком. У React у каждого обновления своя полоса: рендер перехода пропускает срочные записи, рендер срочного — переходные, а пропущенное потом пересчитывается поверх. Как это устроено — в [«React изнутри: конкурентность и lanes», раздел «Переходы»](/frameworks/react-concurrent-internals/#s4).';

/** Раздел «Контекст». */
export const CONTEXT_NOTE =
  'Смена темы вызывает `App`, пропускает `memo(Toolbar)` — но **со спуском**: `propagateContextChange` дал ему `childLanes`, — и вызывает обоих читателей `Settings`. `LangLabel` читает язык, который не менялся, и всё равно вызван: подписка на контекст — это подписка на всё его значение. `UserBadge` не тронут: у него другой контекст. Постороннее состояние `App` не будит никого из читателей: `useMemo` вернул тот же объект настроек, и `Object.is` в `updateProvider` дал `true`.';

export const CONTEXT_LINK =
  'Практические следствия — разделять контексты по частоте изменений и держать `dispatch` отдельно от состояния — разобраны в [«Ре-рендеринге в React», раздел «Дерево»](/frameworks/react-rerender/#s2). Здесь видно, откуда они берутся: в `dependencies` записан контекст целиком, а не поле, которое компонент из него взял.';

export const NO_MEMO_NOTE =
  'Уберите `useMemo` вокруг `{ theme, lang }` — и постороннее состояние `App` начнёт будить обоих читателей `Settings`: литерал объекта на каждом рендере новый, и `Object.is` в `updateProvider` даёт `false`. Объект или массив в `value` провайдера поэтому держат в `useMemo`.';

export const COND_CONTEXT_NOTE =
  'Раз ячейки у `useContext` нет, условный вызов ничего не сдвигает: `mark` получает свою ячейку при любом `on`, и значения верные у обоих. Отладочная сборка React всё же предупреждает — «change in the order of Hooks»: она сверяет имена вызовов, а не ячейки. Если нужно прочитать контекст под условием, для этого есть `use(Theme)`: он в список имён не попадает, и предупреждения нет.';

/**
 * «Ноль, один, ноль» по шагам. Автор курса (2026-09-29): трудное не сокращать, а объяснять
 * подробно. `EAGER_NOTE` объяснял результат одним абзацем; здесь каждый клик из `SAME_VALUE_LOG`
 * пройден с состоянием двух буферов. Число вызовов — литерал `SAME_VALUE_LOG`, сверенный тестом
 * с React 19.3; механика «рендер снимает пометку только с буфера, который строит» — из `EAGER_NOTE`.
 */
export const EAGER_SCENE_NOTE =
  'Что было бы **без раннего выхода**. Любой `setState` заказывал бы рендер: `setN(0)` при `n = 0` вызывал бы `App`, `App` сравнивал бы результат, находил, что ничего не изменилось, — работа ради подтверждения того, что работы нет. Ранний выход пробует посчитать новое состояние прямо в `setState`, ещё до рендера. Но у `App` два файбера — тот, что на экране, и запасной, — и считать заранее можно, только если **ни на одном** нет пометки работы. Ниже клики из примера выше, по одному.';

export const EAGER_SCENE_STEPS: { k: string; bufs: string; what: string }[] = [
  {
    k: '`set0` при `n = 0`',
    bufs: 'пометок нет ни на одном файбере',
    what: 'Считать заранее можно: `0` и `0` равны по `Object.is`. Рендер не заказан — **ноль вызовов**.',
  },
  {
    k: 'первый `set1`',
    bufs: 'пометок нет → считаем: `1` не равно `0`',
    what: 'Значение новое — обновление в очередь, пометка работы, рендер. Вызваны `App` и `Child`. Рендер строит запасной файбер и снимает пометку **только с него**; после коммита он становится экранным. Бывший экранный стал запасным — и пометка на нём осталась.',
  },
  {
    k: 'второй `set1`',
    bufs: 'на запасном файбере — старая пометка',
    what: 'Считать заранее нельзя: пометка значит «в очереди может быть то, чего `lastRenderedState` не видел». Рендер заказан, `App` вызван, очередь свёрнута — `1`, то же, что было. `Child` пропущен, DOM не тронут. Этот рендер строил как раз бывший помеченный файбер и снял пометку с него — теперь чисто на обоих.',
  },
  {
    k: 'третий `set1`',
    bufs: 'пометок нет ни на одном файбере',
    what: 'Всё как в первом клике: считаем заранее, `1` и `1` равны — **ноль вызовов**. Дальше `set0` проходит тот же круг: один полный рендер, один вызов без детей, ноль.',
  },
];

/**
 * Разрыв по шагам. Автор курса (2026-09-29): не сокращать, а объяснять подробно. Абзац под
 * `TEAR_TRACE` рассказывал обе ветки сразу; здесь сценарий `SCENARIO_TEAR_PLAIN`/`SYNC` пройден
 * шаг за шагом. Экраны — литералы `TEAR_UPDATE_SCREENS`, сверенные тестом у React 19.3 и мини-версии;
 * порядок «слушатель → синхронное обновление → переход бросается» — из прозы раздела и `STORE_NOTE`.
 */
export const TEAR_SCENE_STEPS: { k: string; plain: string; sync: string }[] = [
  {
    k: '1 · переход начался',
    plain: '`startTransition` заказал нарезанный рендер. `App` вызван, дальше три ячейки — каждая отдельным куском работы.',
    sync: 'То же самое. Разница пока не видна: подписка ячеек на стор уже есть — её поставил эффект после первого коммита.',
  },
  {
    k: '2 · ячейка `A`',
    plain: '`store.get()` вернул `0`. Кусок работы кончился, цикл уступил поток.',
    sync: '`useSyncExternalStore` вернул снимок `0` и запомнил его в ячейке хука. Поток уступлен.',
  },
  {
    k: '3 · между кусками: `store.set`',
    plain: 'Стор стал `1`. React об этом не знает — подписки нет, и недостроенный рендер продолжится как ни в чём не бывало.',
    sync: 'Стор стал `1`, и стор зовёт слушателей. Слушатель сравнивает снимок с запомненным, видит разницу и ставит **синхронное** обновление. Синхронное — чтобы его нельзя было снова нарезать.',
  },
  {
    k: '4 · ячейки `B` и `C`',
    plain: 'Цикл продолжает с закладки: `B` и `C` читают `1`. Переход достроен и уходит в коммит.',
    sync: 'До них переход не доходит: срочное обновление важнее, недостроенный переход брошен. Синхронный рендер вызывает все три ячейки заново, и все читают `1`.',
  },
  {
    k: '5 · коммит',
    plain: 'На экране `A=0 B=1 C=1` — состояния, в котором стор не был ни в один момент.',
    sync: 'На экране `A=1 B=1 C=1`. Потом React заново делает сам переход и коммитит его — тот же целый экран. У мини-версии коммит один, но тоже целый.',
  },
];

/** Раздел «Внешний стор». */
export const TEAR_WHY =
  'Без перехода разрыва нет и у стора без хука: синхронный рендер не отдаёт поток, и событие приходит, когда все три ячейки уже прочитали `0`. Экран устареет, но не разорвётся — и так и останется устаревшим: без подписки нового рендера никто не закажет. Разрыв требует двух условий сразу: рендер нарезан, и между кусками стор изменился. Вывод для своего кода: состояние вне React читают только через `useSyncExternalStore`. Нынешние `react-redux` и Zustand делают это сами внутри своих хуков, а самописный стор, прочитанный `store.get()` в теле компонента, — ровно случай из примера выше.';

export const STORE_NOTE =
  'Защита двойная. Подписка ловит изменение **после** коммита: слушатель сравнивает снимок и ставит синхронное обновление. Синхронное — потому что нарезанный рендер мог бы собрать разрыв снова. Проверка в конце нарезанного рендера ловит изменение **во время** рендера, когда подписки ещё может не быть — на монтировании. Она перечитывает все снимки. Если хоть один устарел, рендер повторяется целиком, без перерывов. У React это `isRenderConsistentWithExternalStores`, у мини-версии — список `storeChecks`.';

export const EFFECT_LINK =
  'Здесь `useEffect` нужен только потому, что на нём держится подписка стора. Когда эффект запускается, в каком порядке идут очистки и что делает сравнение зависимостей — разобрано в [«React изнутри: свой рендерер и хуки», раздел «Эффекты»](/frameworks/react-internals/#s7). Ячейка эффекта здесь устроена так же, как у React: объект эффекта с `deps` и общим между рендерами `inst`, в котором лежит очистка.';

export const UNCACHED_NOTE =
  '`getSnapshot` обязан возвращать тот же объект, пока стор не менялся. Новый объект на каждый вызов — и после коммита `updateStoreInstance` видит «изменение», ставит синхронный рендер, тот снова читает новый объект — и так без конца. React останавливается на `Maximum update depth exceeded`, а отладочная сборка заранее предупреждает: «The result of getSnapshot should be cached». Мини-версию останавливает предохранитель очередей.';

/** Раздел «Против React». */
export const DIFF = {
  head: ['что', 'мини-версия', 'React 19.3'],
  rows: [
    [
      'Список хуков',
      'связный список ячеек на файбере',
      'то же самое: форму каждой ячейки тест читает прямо из файбера React',
    ],
    [
      'Хук вне рендера',
      '`dispatcher = null` — бросает `resolveDispatcher`',
      '`ContextOnlyDispatcher`: каждый хук, кроме `use`, — заглушка, бросающая `Invalid hook call`',
    ],
    [
      '`setState` в теле компонента',
      'нет',
      '`HooksDispatcherOnRerender`: функция вызывается снова, не больше 25 раз подряд',
    ],
    [
      'Очередь обновлений',
      'массив, сворачивается целиком',
      'кольцо, у каждой записи полоса; пропущенное пересчитывается поверх — [«Переходы»](/frameworks/react-concurrent-internals/#s4)',
    ],
    [
      'Распространение контекста',
      'провайдер сразу обходит поддерево и метит читателей',
      'лениво: провайдер ничего не обходит, а `bailout`, собравшись пропустить поддерево, сперва ищет выше изменившиеся провайдеры (`propagateParentContextChanges`). Кто вызван — то же самое',
    ],
    [
      'Проверка стора в конце рендера',
      'список `storeChecks`, собранный в этом рендере',
      'обход дерева по флагу на файберах, снимки лежат в `updateQueue.stores`',
    ],
    [
      'Срочное посреди перехода',
      'рендерится вместе с переходом — один коммит',
      'отдельно: сначала срочное, потом переход — два коммита',
    ],
    [
      '`memo` над текстовыми детьми',
      'не пропускает: текст завёрнут в элемент, массив детей новый',
      'пропускает: текст — строка, `Object.is` даёт `true`',
    ],
    [
      'Бесконечный цикл обновлений',
      'предохранитель очередей демо',
      'счётчик вложенных обновлений: `Maximum update depth exceeded`',
    ],
  ],
};

export const DIFF_NOTE =
  'Строки про диспетчеры, распространение контекста и проверку стора — об устройстве, а не о выводе: кто вызван и что оказалось на экране, от них не меняется.';

/* ─────────────────────────────── Тонкие места ─────────────────────────────── */

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: '`setState` тем же значением иногда всё же вызывает функцию',
    d: 'Ранний выход работает, только когда у файбера нет работы ни в одном из двух буферов. Сразу после обновления пометка ещё висит на прошлом буфере, и следующий `setState` тем же значением вызовет функцию компонента — один раз, без детей. Это не лишний рендер по ошибке, а цена проверки: посчитать заранее было нельзя.',
    tone: 'warn',
  },
  {
    n: '02',
    t: '`dispatch` к тому же состоянию вызывает функцию каждый раз',
    d: 'У `useReducer` раннего выхода нет: редьюсер может поменяться между рендерами, и считать по старому нельзя. Функция компонента вызывается на каждый `dispatch`, и только в рендере выясняется, что состояние то же. Дети пропускаются, но тело компонента выполняется. Тяжёлое вычисление в теле при частом `dispatch` без изменений — ровно этот случай.',
    tone: 'warn',
  },
  {
    n: '03',
    t: 'Объект в `value` провайдера без `useMemo` будит всех читателей',
    d: '`updateProvider` сравнивает значение через `Object.is`. Литерал `{ theme, lang }` на каждом рендере новый, и любой `setState` в компоненте провайдера помечает работой всех, кто читает контекст, — сквозь любой `memo` между ними.',
    code: `// каждый рендер App — новый объект, все читатели Settings вызваны
<Settings value={{ theme, lang }}>

// тот же объект, пока theme та же
const settings = useMemo(() => ({ theme, lang }), [theme, lang]);
<Settings value={settings}>`,
    tone: 'err',
  },
  {
    n: '04',
    t: 'Стор, прочитанный в рендере, рвётся только в переходе',
    d: 'Пока все обновления синхронные, `store.get()` прямо в рендере выглядит рабочим: рендер не прерывается, и все компоненты читают одну версию. Разрыв появляется с первым `startTransition` или `useDeferredValue` рядом — и воспроизводится только когда событие пришло посреди рендера. Тест на синхронном рендере такой баг не увидит никогда.',
    tone: 'err',
  },
  {
    n: '05',
    t: '`getSnapshot` с новым объектом — бесконечный цикл',
    d: 'Снимок сравнивается через `Object.is`. `() => ({ ...store.state })` или `() => store.items.filter(…)` возвращает новый объект на каждый вызов, и после каждого коммита проверка находит «изменение». Кешировать надо в сторе или в селекторе, а не в компоненте.',
    code: `// бесконечный цикл: каждый вызов — новый массив
useSyncExternalStore(store.subscribe, () => store.items.filter(isDone));

// снимок — сам массив стора; фильтр — в рендере или в useMemo
const items = useSyncExternalStore(store.subscribe, () => store.items);
const done = useMemo(() => items.filter(isDone), [items]);`,
    tone: 'err',
  },
  {
    n: '06',
    t: '`useContext` под условием работает — и всё равно нарушает правило',
    d: 'Ячейки у `useContext` нет, поэтому условный вызов ничего не сдвигает, и значения верные. Но отладочная сборка React сверяет имена вызванных хуков и предупреждает о смене порядка, а линтер хуков такой код не пропустит. Для чтения контекста под условием есть `use(Context)` — это законно и без предупреждений.',
  },
  {
    n: '07',
    t: 'Подписка на контекст — на всё значение, а не на поле',
    d: 'В `dependencies` записан контекст целиком. Компонент, который берёт из объекта только `lang`, вызывается при смене `theme` в том же объекте. Селекторов у `useContext` нет; если поле меняется часто, его место — в своём контексте или во внешнем сторе с `useSyncExternalStore` и селектором.',
  },
  {
    n: '08',
    t: 'Запись в `ref.current` ничего не заказывает',
    d: '`useRef` — ячейка с объектом, и запись в `current` меняет только этот объект. Ни очереди, ни пометки работы — экран не обновится, пока что-нибудь другое не вызовет рендер. Показывать значение из `ref` на экране — значит показывать устаревшее.',
  },
];

/* ─────────────────────────────── Источники ─────────────────────────────── */

export const SOURCES = [
  {
    title: 'ReactFiberHooks.js — исходники React',
    href: 'https://github.com/facebook/react/blob/main/packages/react-reconciler/src/ReactFiberHooks.js',
    what: 'Все функции этой темы под теми же именами: `renderWithHooks`, `mountWorkInProgressHook`, `updateWorkInProgressHook`, `areHookInputsEqual`, `dispatchSetState` с eager state, `mountSyncExternalStore` и `forceStoreRerender`.',
  },
  {
    title: 'ReactFiberNewContext.js — исходники React',
    href: 'https://github.com/facebook/react/blob/main/packages/react-reconciler/src/ReactFiberNewContext.js',
    what: '`pushProvider` и `popProvider`, `readContext` с записью в `dependencies`, ленивое распространение — `propagateParentContextChanges`.',
  },
  {
    title: 'ReactFiberBeginWork.js — исходники React',
    href: 'https://github.com/facebook/react/blob/main/packages/react-reconciler/src/ReactFiberBeginWork.js',
    what: '`beginWork`, `bailoutOnAlreadyFinishedWork`, `updateMemoComponent` и `didReceiveUpdate` — где решается, вызывать ли функцию компонента.',
  },
  {
    title: 'useState — react.dev',
    href: 'https://react.dev/reference/react/useState',
    what: 'Документация прямо оговаривает: при том же значении React пропустит детей, но «в некоторых случаях может понадобиться вызвать ваш компонент». Условие этих случаев — два буфера — в документации не названо.',
  },
  {
    title: 'useSyncExternalStore — react.dev',
    href: 'https://react.dev/reference/react/useSyncExternalStore',
    what: 'Контракт `subscribe` и `getSnapshot`, требование кешировать снимок, `getServerSnapshot` для серверного рендера.',
  },
  {
    title: 'What is tearing? — React 18 Working Group',
    href: 'https://github.com/reactwg/react-18/discussions/69',
    what: 'Объяснение разрыва от команды React: почему он появился вместе с конкурентным рендером и почему внешним сторам понадобился отдельный хук.',
  },
];

export const RELATED =
  'Смежное на сайте: [React изнутри: свой рендерер и хуки](/frameworks/react-internals/) — мини-рендерер с нуля: элемент, файбер, сверка, эффекты; его `createElement` эта тема берёт как есть. [Ре-рендеринг в React](/frameworks/react-rerender/) — то же поведение снаружи: сколько вызовов, где bailout, когда `memo` и `useMemo` окупаются. [React изнутри: конкурентность и lanes](/frameworks/react-concurrent-internals/) — полосы, переходы и прерывание, на которых держится разрыв. [React против Vue](/frameworks/react-vs-vue/) — модель, в которой разрыва нет по построению. [Vue 3 изнутри: своя реактивность](/frameworks/vue-internals/) — подписка, записанная при чтении, но на уровне поля, а не всего значения.';
