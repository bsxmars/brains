import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { ChainScenario, CodePatch, RaceStep } from '@/widgets/mini-watch/model/types';

/**
 * Данные темы «Vue 3 изнутри: watch, effectScope и computed 3.5».
 *
 * Главное здесь — `MINI_WATCH_CODE`: вторая мини-реализация реактивности, разложенная на шаги
 * `STEP_*`. Каждый шаг печатается в теме `<CodeBlock code={STEP_…} />`, а склейку **той же
 * строки** исполняют и три демо (`widgets/mini-watch/model/*.ts` собирают её `new Function`),
 * и тест `tests/unit/vue-watch-internals.test.ts`. Копии нет.
 *
 * Почему не дописана к `MINI_VUE_CODE` из «Vue 3 изнутри: своя реактивность». Там `Dep` —
 * это `Set`, а `computed` держит флаг и карту версий. Здесь предмет темы — ровно то, что
 * в 3.5 устроено иначе: узлы `Link` в двух списках, `globalVersion`, пакет со счётчиком
 * глубины и подписка `computed` только при живых читателях. Дописать это поверх `Set`
 * значило бы переписать ядро, поэтому ядро написано заново, а старая мини-версия участвует
 * в тесте как третья сторона сверки пересчётов `computed`.
 *
 * Что чем проверено (`tests/unit/vue-watch-internals.test.ts`, Node 26.8.2,
 * `@vue/runtime-core` 3.5.42, **обе** сборки — выбор сборки подменой разрешения имён,
 * как в `tests/unit/vue-internals.test.ts`):
 *
 *   - примеры `SOURCES_CODE`, `DEEP_CODE`, `CLEANUP_ORDER_CODE`, `ONCE_CODE`, `FLUSH_CODE`,
 *     `SCOPE_CODE`, `SCOPE_COMPUTED_CODE`, `LEAK_CODE` исполняются как напечатаны на мини-версии
 *     и на Vue, а их вывод сверяется с литералом `*_OUT` здесь же; `PAUSE_CODE` — только на Vue,
 *     у мини-версии паузы нет, и тест закрепляет это отдельно;
 *   - гонка `RACE_CODE` / `RACE_NAIVE_CODE`: кадры демо одинаковы на мини-версии и на Vue;
 *   - дерево областей демо (`SCOPE_NODE_CODE`) останавливает вложенные, но не отсоединённые,
 *     на мини-версии и на Vue одинаково;
 *   - цепочка `CHAIN`: число пересчётов каждого `computed` и прогонов эффекта совпадает у мини-
 *     версии, у Vue и у мини-версии из «Vue 3 изнутри»; вариант «только флаг»
 *     (`DIRTY_ONLY_PATCH`) пересчитывает больше — это закреплено литералом;
 *   - каждое «без этой строки сломается» проверено сломанным вариантом.
 *
 * По исходнику `reactivity.cjs.prod.js` 3.5.42 (не запуском): поле `activeLink` у `Dep`,
 * счётчик подписчиков `sc` и удаление опустевшего `Dep` из `depsMap`, битовые флаги эффекта.
 */

// ---------------------------------------------------------------------------
// Мини-реализация: шаги и склейка
// ---------------------------------------------------------------------------

/** Шаг 1: `effectScope` — массив эффектов, массив очисток и дети. */
export const STEP_SCOPE = `let activeScope = null   // область, в которую записываются новые эффекты

function effectScope(detached = false) {
  const scope = {
    active: true, detached, parent: null,
    effects: [], cleanups: [], scopes: [],
    run(fn) {
      if (!scope.active) return undefined   // остановленная область ничего не запускает
      const prev = activeScope
      activeScope = scope
      try {
        return fn()
      } finally {
        activeScope = prev
      }
    },
    stop(fromParent) {
      if (!scope.active) return
      scope.active = false
      for (const e of scope.effects) e.stop()
      for (const fn of scope.cleanups) fn()
      for (const child of scope.scopes.slice()) child.stop(true)
      // остановили не через родителя — выписаться из его списка детей
      if (scope.parent && !fromParent) remove(scope.parent.scopes, scope)
      scope.effects.length = scope.cleanups.length = scope.scopes.length = 0
      scope.parent = null
    },
  }
  // отсоединённая область родителя не заводит: его stop до неё не дойдёт
  if (!detached && activeScope) {
    scope.parent = activeScope
    activeScope.scopes.push(scope)
  }
  return scope
}

function onScopeDispose(fn) {
  if (activeScope) activeScope.cleanups.push(fn)
}

function getCurrentScope() {
  return activeScope
}

function remove(list, item) {
  const i = list.indexOf(item)
  if (i !== -1) list.splice(i, 1)
}`;

/** Шаг 2: `Dep`, узлы `Link`, версии и пакет. */
export const STEP_LINK = `let activeSub = null      // кто сейчас читает: эффект или computed
let globalVersion = 0     // растёт на каждое изменение где угодно
let batchDepth = 0        // сколько записей сейчас «открыто»
let batchedSubs = null    // эффекты, ждущие конца пакета (список через .next)
const batchedComputeds = []

function createDep(computed = null) {
  return { version: 0, subs: null, computed }   // subs — ХВОСТ списка подписчиков
}

// Link — один узел на пару «источник × подписчик», вставленный сразу в два списка:
// в список источников подписчика (prevDep/nextDep) и в список подписчиков источника
// (prevSub/nextSub). version — версия источника, которую подписчик видел последней.
function track(dep) {
  const sub = activeSub
  if (!sub || sub === dep.computed) return null
  let link = sub.deps
  while (link && link.dep !== dep) link = link.nextDep
  if (!link) {
    link = { dep, sub, version: dep.version, prevDep: null, nextDep: null, prevSub: null, nextSub: null }
    appendDep(sub, link)
    if (sub.tracking) addSub(link)
  } else if (link.version === -1) {
    // связь с прошлого прогона: подтвердить на месте, без новой аллокации
    link.version = dep.version
    if (link !== sub.depsTail) {
      unlinkDep(sub, link)
      appendDep(sub, link)          // порядок источников = порядок чтения
    }
  }
  return link
}

function appendDep(sub, link) {
  link.prevDep = sub.depsTail
  link.nextDep = null
  if (sub.depsTail) sub.depsTail.nextDep = link
  else sub.deps = link
  sub.depsTail = link
}

function unlinkDep(sub, link) {
  const { prevDep, nextDep } = link
  if (prevDep) prevDep.nextDep = nextDep
  else sub.deps = nextDep
  if (nextDep) nextDep.prevDep = prevDep
  else sub.depsTail = prevDep
  link.prevDep = link.nextDep = null
}

function addSub(link) {
  const c = link.dep.computed
  if (c && !link.dep.subs) {
    // у computed появился первый читатель — только теперь он подписывается на источники
    c.tracking = true
    c.dirty = true
    for (let l = c.deps; l; l = l.nextDep) addSub(l)
  }
  link.prevSub = link.dep.subs
  if (link.dep.subs) link.dep.subs.nextSub = link
  link.dep.subs = link
}

function removeSub(link) {
  const { dep, prevSub, nextSub } = link
  if (prevSub) prevSub.nextSub = nextSub
  if (nextSub) nextSub.prevSub = prevSub
  if (dep.subs === link) {
    dep.subs = prevSub
    if (!prevSub && dep.computed) {
      // ушёл последний читатель — computed отписывается от своих источников
      dep.computed.tracking = false
      for (let l = dep.computed.deps; l; l = l.nextDep) removeSub(l)
    }
  }
  link.prevSub = link.nextSub = null
}

function prepareDeps(sub) {
  for (let l = sub.deps; l; l = l.nextDep) l.version = -1   // все связи «под вопросом»
}

function cleanupDeps(sub) {
  for (let l = sub.deps; l; ) {
    const next = l.nextDep
    if (l.version === -1) {          // в этот прогон не прочитано — связь долой
      removeSub(l)
      unlinkDep(sub, l)
    }
    l = next
  }
}

function triggerDep(dep) {
  dep.version++
  globalVersion++
  notifyDep(dep)
}

function notifyDep(dep) {
  startBatch()
  try {
    for (let l = dep.subs; l; l = l.prevSub) l.sub.notify()   // от хвоста к голове
  } finally {
    endBatch()
  }
}

function startBatch() {
  batchDepth++
}

function endBatch() {
  if (--batchDepth > 0) return       // внешняя запись ещё не закончилась
  for (const c of batchedComputeds.splice(0)) c.notified = false
  while (batchedSubs) {
    let e = batchedSubs
    batchedSubs = null
    while (e) {
      const next = e.next
      e.next = null
      e.notified = false
      if (e.active) e.trigger()
      e = next
    }
  }
}

// изменилось ли что-нибудь из прочитанного — сравнением версий, без пересчёта
function isDirty(sub) {
  for (let l = sub.deps; l; l = l.nextDep) {
    if (l.dep.version !== l.version) return true
    if (l.dep.computed) {
      refreshComputed(l.dep.computed)   // досчитать computed — и сравнить ещё раз
      if (l.dep.version !== l.version) return true
    }
  }
  return false
}`;

/** Шаг 3: эффект — подписчик со своим списком `Link`. */
export const STEP_EFFECT = `function createEffect(fn) {
  const e = {
    fn, deps: null, depsTail: null, next: null,
    active: true, running: false, notified: false, tracking: true,
    scheduler: null, onStop: null,
    notify() {
      if (e.running || e.notified) return   // в пакете — один раз
      e.notified = true
      e.next = batchedSubs
      batchedSubs = e
    },
    trigger() {
      if (e.scheduler) e.scheduler()        // watch: поставить задание
      else if (isDirty(e)) e.run()          // effect: выполнить, если правда нужно
    },
    run() {
      if (!e.active) return fn()
      e.running = true
      prepareDeps(e)
      const prev = activeSub
      activeSub = e
      try {
        return fn()
      } finally {
        cleanupDeps(e)
        activeSub = prev
        e.running = false
      }
    },
    stop() {
      if (!e.active) return
      for (let l = e.deps; l; l = l.nextDep) removeSub(l)
      e.deps = e.depsTail = null
      if (e.onStop) e.onStop()
      e.active = false
    },
  }
  if (activeScope) activeScope.effects.push(e)   // эффект записывается в текущую область
  return e
}

function effect(fn) {
  const e = createEffect(fn)
  e.run()
  const runner = () => e.run()
  runner.effect = e
  return runner
}

function stop(runner) {
  runner.effect.stop()
}`;

/** Шаг 4: `reactive` и `ref` поверх того же `Dep`. */
export const STEP_SOURCES = `const RAW = Symbol('raw')
const ITERATE_KEY = Symbol('iterate')
const targetMap = new WeakMap()     // объект → Map(ключ → Dep)
const proxies = new WeakMap()
const isObject = (v) => v !== null && typeof v === 'object'
const isRef = (v) => isObject(v) && v.__v_isRef === true
const isReactive = (v) => isObject(v) && v[RAW] !== undefined
const toRaw = (v) => (isReactive(v) ? v[RAW] : v)
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k)

function depOf(target, key) {
  let deps = targetMap.get(target)
  if (!deps) targetMap.set(target, (deps = new Map()))
  let dep = deps.get(key)
  if (!dep) deps.set(key, (dep = createDep()))
  return dep
}

function reactive(target) {
  if (!isObject(target) || isReactive(target)) return target
  let proxy = proxies.get(target)
  if (!proxy) proxies.set(target, (proxy = new Proxy(target, handlers)))
  return proxy
}

const handlers = {
  get(target, key, receiver) {
    if (key === RAW) return target
    if (activeSub) track(depOf(target, key))
    const value = Reflect.get(target, key, receiver)
    return isObject(value) ? reactive(value) : value
  },
  set(target, key, value, receiver) {
    value = toRaw(value)
    const had = hasOwn(target, key)
    const old = target[key]
    const ok = Reflect.set(target, key, value, receiver)
    if (!had) trigger(target, key, true)
    else if (!Object.is(old, value)) trigger(target, key, false)
    return ok
  },
  deleteProperty(target, key) {
    const had = hasOwn(target, key)
    const ok = Reflect.deleteProperty(target, key)
    if (had && ok) trigger(target, key, true)
    return ok
  },
  ownKeys(target) {
    if (activeSub) track(depOf(target, ITERATE_KEY))
    return Reflect.ownKeys(target)
  },
}

function trigger(target, key, keysChanged) {
  const deps = targetMap.get(target)
  if (!deps) {
    globalVersion++                 // никто не читал — но computed должен узнать
    return
  }
  startBatch()                      // две Dep одной записью — один пакет
  if (deps.has(key)) triggerDep(deps.get(key))
  if (keysChanged && deps.has(ITERATE_KEY)) triggerDep(deps.get(ITERATE_KEY))
  endBatch()
}

function ref(value) {
  let raw = toRaw(value)
  let current = reactive(value)
  const dep = createDep()
  return {
    __v_isRef: true,
    dep,
    get value() {
      track(dep)
      return current
    },
    set value(next) {
      if (Object.is(toRaw(next), raw)) return
      raw = toRaw(next)
      current = reactive(next)
      triggerDep(dep)
    },
  }
}`;

/** Шаг 5: `computed` 3.5 — версии, `globalVersion`, ленивая подписка. */
export const STEP_COMPUTED = `function computed(getter) {
  const c = {
    fn: getter, deps: null, depsTail: null, next: null,
    dep: null, _value: undefined,
    dirty: true, tracking: false, notified: false, evaluated: false,
    globalVersion: globalVersion - 1,
    __v_isRef: true,
    notify() {
      c.dirty = true                  // пометить — и ничего не считать
      if (c.notified || activeSub === c) return
      c.notified = true
      batchedComputeds.push(c)
      notifyDep(c.dep)                // передать пометку своим читателям
    },
    get value() {
      const link = track(c.dep)
      refreshComputed(c)
      if (link) link.version = c.dep.version   // читающий видел свежую версию
      return c._value
    },
  }
  c.dep = createDep(c)
  return c
}

function refreshComputed(c) {
  if (c.tracking && !c.dirty) return            // подписан и не помечен — кеш верен
  c.dirty = false
  if (c.globalVersion === globalVersion) return  // в системе не менялось ничего
  c.globalVersion = globalVersion
  if (c.evaluated && !isDirty(c)) return         // источники прежние — не пересчитывать
  const prev = activeSub
  activeSub = c
  try {
    prepareDeps(c)
    const value = c.fn(c._value)
    if (c.dep.version === 0 || !Object.is(value, c._value)) {
      c.evaluated = true
      c._value = value
      c.dep.version++                 // версия растёт, только если значение другое
    }
  } finally {
    activeSub = prev
    cleanupDeps(c)
  }
}`;

/** Шаг 6: `watch`, `traverse`, `onWatcherCleanup`. */
export const STEP_WATCH = `const INITIAL = {}                 // «старого значения ещё не было»
const cleanupMap = new WeakMap()   // эффект watcher'а → его очистки
let activeWatcher = null

function onWatcherCleanup(fn, owner = activeWatcher) {
  if (!owner) return                // после await владельца уже нет — молча ничего
  let list = cleanupMap.get(owner)
  if (!list) cleanupMap.set(owner, (list = []))
  list.push(fn)
}

// прочитать всё до глубины depth — чтобы каждое чтение записалось в зависимости
function traverse(value, depth = Infinity, seen = new Map()) {
  if (depth <= 0 || !isObject(value)) return value
  if ((seen.get(value) || 0) >= depth) return value   // цикл или уже пройдено глубже
  seen.set(value, depth)
  depth--
  if (isRef(value)) traverse(value.value, depth, seen)
  else for (const key in value) traverse(value[key], depth, seen)
  return value
}

function watch(source, cb, { immediate, deep, once, flush = 'pre' } = {}) {
  const readReactive = (s) => (deep ? s : traverse(s, deep === false || deep === 0 ? 1 : Infinity))
  let getter
  let forceTrigger = false
  let multi = false
  if (isRef(source)) getter = () => source.value
  else if (isReactive(source)) {
    getter = () => readReactive(source)
    forceTrigger = true               // тот же объект — но внутри что-то поменялось
  } else if (Array.isArray(source)) {
    multi = true
    forceTrigger = source.some(isReactive)
    getter = () => source.map((s) => (isRef(s) ? s.value : isReactive(s) ? readReactive(s) : s()))
  } else if (cb) getter = source
  else {
    getter = () => {                  // watchEffect: очистка — перед каждым прогоном
      untracked(cleanup)
      const prev = activeWatcher
      activeWatcher = e
      try {
        return source(onCleanup)
      } finally {
        activeWatcher = prev
      }
    }
  }
  if (cb && deep) {
    const base = getter
    const depth = deep === true ? Infinity : deep
    getter = () => traverse(base(), depth)
  }

  const scope = activeScope
  const handle = () => {
    e.stop()
    if (scope) remove(scope.effects, e)
  }
  if (once && cb) {
    const first = cb
    cb = (...args) => {
      first(...args)
      handle()                        // stop сразу после первого колбэка
    }
  }

  let oldValue = multi ? source.map(() => INITIAL) : INITIAL
  const job = (firstRun) => {
    if (!e.active || (!firstRun && !isDirty(e))) return
    if (!cb) return void e.run()
    const value = e.run()
    const changed = multi ? value.some((v, i) => !Object.is(v, oldValue[i])) : !Object.is(value, oldValue)
    if (!(firstRun || deep || forceTrigger || changed)) return
    cleanup()                         // очистка прошлого колбэка — ДО нового
    const prev = activeWatcher
    activeWatcher = e
    try {
      const old = oldValue === INITIAL ? undefined : multi && oldValue[0] === INITIAL ? [] : oldValue
      oldValue = value
      cb(value, old, onCleanup)
    } finally {
      activeWatcher = prev
    }
  }

  const e = createEffect(getter)
  e.scheduler = flush === 'sync' ? job : flush === 'post' ? () => queuePostJob(job) : () => queueJob(job)
  const onCleanup = (fn) => onWatcherCleanup(fn, e)
  const cleanup = (e.onStop = () => {  // та же функция — и перед колбэком, и на stop
    const list = cleanupMap.get(e)
    if (!list) return
    for (const fn of list) fn()
    cleanupMap.delete(e)
  })

  if (cb) {
    if (immediate) job(true)
    else oldValue = e.run()           // первый прогон — только собрать зависимости
  } else if (flush === 'post') queuePostJob(() => job(true))
  else job(true)
  return handle
}

function watchEffect(fn, options) {
  return watch(fn, null, options)
}

function untracked(fn) {
  const prev = activeSub
  activeSub = null
  try {
    fn()
  } finally {
    activeSub = prev
  }
}`;

/** Шаг 7: очередь — минимум, без которого `flush` не показать. */
export const STEP_QUEUE = `const queue = []
const postQueue = []
const resolved = Promise.resolve()
let currentFlush = null

function queueJob(job) {
  if (!queue.includes(job)) queue.push(job)
  queueFlush()
}

function queuePostJob(job) {
  if (!postQueue.includes(job)) postQueue.push(job)
  queueFlush()
}

function queueFlush() {
  if (!currentFlush) currentFlush = resolved.then(flushJobs)
}

function flushJobs() {
  while (queue.length || postQueue.length) {
    while (queue.length) queue.shift()()
    for (const job of postQueue.splice(0)) job()
  }
  currentFlush = null
}

function nextTick(fn) {
  const p = currentFlush || resolved
  return fn ? p.then(fn) : p
}`;

/**
 * Что реализация отдаёт наружу: первая строка — публичные имена Vue, вторая — внутренности,
 * которые демо читает напрямую.
 */
export const STEP_EXPORT = `return {
  ref, reactive, toRaw, isRef, isReactive, computed, effect, stop,
  watch, watchEffect, onWatcherCleanup, effectScope, getCurrentScope, onScopeDispose, nextTick,
  targetMap, getGlobalVersion: () => globalVersion, getBatchDepth: () => batchDepth,
}`;

/** Вся мини-реализация одной строкой — тело функции. */
export const MINI_WATCH_CODE = [
  STEP_SCOPE,
  STEP_LINK,
  STEP_EFFECT,
  STEP_SOURCES,
  STEP_COMPUTED,
  STEP_WATCH,
  STEP_QUEUE,
  STEP_EXPORT,
].join('\n\n');

// ---------------------------------------------------------------------------
// Вводный раздел · словарь
// ---------------------------------------------------------------------------

export const INTRO_NOTE =
  'Почему `watch(state)` срабатывает на любое поле, а `watch(() => state.obj)` — ни на одно? Почему ответ на старый поисковый запрос перетирает ответ на новый? Почему эффект продолжает работать, когда компонента уже нет? У каждого из этих вопросов ответ — одна-две строки в устройстве `watch`, `effectScope` и `computed`. Здесь они написаны руками, исполняются в демо и сверены с настоящим Vue 3.5.42.';

export const PLAIN_INTRO =
  'Эффект — лампочка, которая загорается, когда меняется то, на что она смотрит. `watch` — та же лампочка с секретарём: он сравнивает, что было и что стало, и зовёт вас, только если разница есть, а перед новым звонком сам кладёт трубку прошлого. `effectScope` — рубильник на щитке: одним движением гасит все лампочки комнаты. Версии у `computed` — отметки «проверено» на счётчиках: пока цифры те же, что при прошлой проверке, пересчитывать нечего.';

export const GLOSSARY = [
  {
    k: 'источник `watch`',
    d: 'Первый аргумент `watch`: `ref`, реактивный объект, функция-геттер или массив из них. Из него `watch` строит геттер эффекта — функцию, чьи чтения становятся зависимостями.',
  },
  {
    k: 'задание (job)',
    d: 'Функция, которую эффект со `scheduler` ставит в очередь вместо немедленной работы. У `watch` задание перечитывает источник, сравнивает значения и зовёт колбэк. Очередь разбирается в микрозадаче.',
  },
  {
    k: '`flush`',
    d: 'Когда выполнится задание `watch`: `\'sync\'` — прямо в строке записи, `\'pre\'` — в микрозадаче до обновления DOM, `\'post\'` — в той же микрозадаче после него.',
  },
  {
    k: 'очистка (cleanup)',
    d: 'Функция, которую колбэк `watch` регистрирует через `onCleanup` или `onWatcherCleanup`. Vue вызывает её перед следующим колбэком того же watcher’а и при его остановке.',
  },
  {
    k: 'область (`effectScope`)',
    d: 'Объект, который запоминает все эффекты, созданные внутри его `run`, и останавливает их одним `stop`. У каждого компонента есть своя.',
  },
  {
    k: '`Dep` и версия',
    d: 'Источник зависимостей — ключ реактивного объекта, `ref` или `computed` — со счётчиком `version`, который растёт на каждое изменение. Подробно — в [«Vue 3 изнутри», раздел «`track` и `trigger`»](/frameworks/vue-internals/#s2).',
  },
  {
    k: '`Link`',
    d: 'Узел, связывающий один `Dep` с одним подписчиком. Хранит версию `Dep`, которую подписчик видел последней, и стоит сразу в двух двусвязных списках.',
  },
  {
    k: 'пакет (batch)',
    d: 'Промежуток, в течение которого пробуждённые эффекты не запускаются, а копятся. Счётчик `batchDepth` считает вложенные записи; запуск — когда закрылась самая внешняя.',
  },
];

// ---------------------------------------------------------------------------
// Перед началом
// ---------------------------------------------------------------------------

export const PREREQ = [
  {
    t: 'Как устроены `effect`, `track`/`trigger` и очередь',
    d: 'Эффект перед запуском забывает старые зависимости и собирает новые, `Dep` будит подписчиков, задание встаёт в очередь один раз, очередь разбирается в микрозадаче. Здесь всё это переписано в форме Vue 3.5.',
    href: '/frameworks/vue-internals/',
    hrefLabel: 'Vue 3 изнутри: своя реактивность',
    tone: 'info' as const,
  },
  {
    t: 'Как `watch`, `watchEffect` и `effectScope` ведут себя снаружи',
    d: 'Что компонент останавливает сам, что после `await` становится «ничьим», как Pinia держит свои эффекты в отдельной области. Здесь — строки, из которых это поведение следует.',
    href: '/frameworks/vue-reactivity/#s5',
    hrefLabel: 'Реактивность Vue · Жизнь эффекта',
    tone: 'warn' as const,
  },
  {
    t: 'Что `await` отдаёт продолжение в микрозадачу',
    d: 'Колбэк `watch` с `await` возвращается на первом же `await`, а остаток выполняется позже. От этого зависит и гонка ответов, и то, почему `onWatcherCleanup` после `await` не работает.',
    href: '/js/promise-internals/#s1',
    hrefLabel: 'Промис изнутри · Модель',
    tone: 'err' as const,
  },
  {
    t: 'Что объект живёт, пока до него можно дойти по ссылкам',
    d: 'Незабытый эффект — это ссылка из `Dep` источника на эффект и из эффекта на его замыкание. Почему этого достаточно, чтобы память не освободилась, — там.',
    href: '/js/memory-gc/#s2',
    hrefLabel: 'Память и GC · Утечки',
    tone: 'info' as const,
  },
];

// ---------------------------------------------------------------------------
// Раздел 1 · watch поверх effect
// ---------------------------------------------------------------------------

export const PLAIN_WATCH =
  'Эффект — сигнализация: сработала — действуй. `watch` — сигнализация с охранником, который сначала смотрит на экран: что там было в прошлый раз и что сейчас. Сквозняк качнул дверь, а она осталась закрытой — охранник никого не будит.';

/** Исполняется тестом как напечатано — на мини-версии и на Vue. */
export const SOURCES_CODE = `const count = ref(0)
const state = reactive({ user: { name: 'Ада' }, n: 1 })

watch(count, (v, old) => log('ref: ' + old + ' → ' + v))
watch(() => state.n * 2, (v, old) => log('геттер: ' + old + ' → ' + v))
watch(state, () => log('reactive: что-то внутри'))
watch([count, () => state.n], ([c, n]) => log('массив: ' + c + ', ' + n))

count.value++
state.n++
await nextTick()
state.user.name = 'Грейс'
await nextTick()`;

export const SOURCES_OUT = [
  'ref: 0 → 1',
  'массив: 1, 2',
  'геттер: 2 → 4',
  'reactive: что-то внутри',
  'reactive: что-то внутри',
];

export const SOURCES_HEAD = ['источник', 'геттер эффекта', 'колбэк зовётся, когда'];

export const SOURCES_ROWS: string[][] = [
  ['`ref`', '`() => source.value`', 'значение `.value` другое по `Object.is`'],
  ['функция', 'сама функция', 'результат другой по `Object.is`. Возвращает тот же объект — колбэка нет, даже если внутри всё поменялось'],
  [
    '`reactive`',
    '`traverse(source)` — обход всего дерева',
    '**всегда**, когда эффект проснулся: `forceTrigger`, потому что объект тот же самый, а изменилось что-то внутри',
  ],
  ['массив', 'массив значений по тем же правилам', 'хотя бы один элемент другой; с `reactive` внутри — всегда'],
];

export const WATCH_NOTE =
  'Первый прогон эффекта `watch` ничего не вызывает: он только собирает зависимости и запоминает `oldValue`. Дальше каждое пробуждение ставит задание, а задание сначала спрашивает `isDirty(e)` — изменилось ли хоть что-то из прочитанного, — потом перечитывает источник и сравнивает. Отсюда в примере выше ровно четыре строки на первый такт: `массив` проснулся от двух записей, но задание в очереди одно, и перечитал он уже оба новых значения.';

/** Исполняется тестом как напечатано. */
export const DEEP_CODE = `const state = reactive({ a: { b: { c: 1 } } })
const sync = { flush: 'sync' }
watch(() => state.a, () => log('геттер'), sync)
watch(() => state.a, () => log('геттер + deep'), { ...sync, deep: true })
watch(state, () => log('deep: 1'), { ...sync, deep: 1 })
watch(state, () => log('deep: 2'), { ...sync, deep: 2 })

log('— state.a.b.c++');            state.a.b.c++
log('— state.a.b = { c: 5 }');     state.a.b = { c: 5 }
log('— state.a = { b: { c: 1 } }'); state.a = { b: { c: 1 } }`;

export const DEEP_OUT = [
  '— state.a.b.c++',
  'геттер + deep',
  '— state.a.b = { c: 5 }',
  'геттер + deep',
  'deep: 2',
  '— state.a = { b: { c: 1 } }',
  'геттер',
  'геттер + deep',
  'deep: 1',
  'deep: 2',
];

export const TRAVERSE_NOTE =
  '«Глубоко» — это не флаг, который Vue где-то проверяет, а **чтения**. `traverse` обходит значение и читает каждое поле, и каждое чтение под активным эффектом записывается в зависимости. Глубина — сколько уровней прочитано: `deep: 1` читает ключи самого `state`, поэтому замена `state.a` его будит, а запись в `state.a.b` — уже нет. Число вместо `true` появилось в 3.5. `seen` — не только защита от циклов: он помнит, с каким запасом глубины узел уже пройден, и не обходит его снова, если к нему пришли с запасом не больше прежнего.';

export const COST_NOTE =
  'Цена `deep` платится **на каждом** пробуждении: задание перечитывает всё дерево, чтобы заново собрать зависимости. На объекте в десять тысяч узлов это десять тысяч чтений через прокси после каждой записи в любое из них. Когда нужен один уровень, `deep: 1` сокращает обход до числа ключей верхнего уровня.';

export const OPTIONS_FACTS = [
  {
    t: '`immediate`',
    d: 'Первый прогон сразу идёт через задание с флагом `firstRun`: колбэк зовётся с `oldValue`, равным `undefined`, — у массива источников это `[]`. Сверено с Vue.',
  },
  {
    t: '`once`',
    d: 'Колбэк оборачивается: после первого вызова — `stop` этого же watcher’а. `stop` запускает очистку, поэтому очистка, зарегистрированная в единственном колбэке, срабатывает **сразу после него**. Как это ломает асинхронный запрос — в тонких местах.',
  },
  {
    t: '`oldValue` у `deep`',
    d: 'Старое и новое значение — один и тот же объект: `watch` не копирует дерево, он хранит ссылку. Сравнивать `v` и `old` внутри колбэка на мутацию бесполезно — `v === old`.',
  },
];

// ---------------------------------------------------------------------------
// Раздел 2 · onCleanup и гонка
// ---------------------------------------------------------------------------

export const PLAIN_CLEANUP =
  'Вы заказали такси, передумали и заказали другое, а первое не отменили. Приедут оба, и сядете вы в то, что подъехало **последним**, — а это не обязательно второе. Очистка — это звонок «первое не нужно» в момент второго заказа.';

/** Исполняется тестом как напечатано. */
export const CLEANUP_ORDER_CODE = `const id = ref(1)
const stopWatch = watch(id, (v, _old, onCleanup) => {
  log('запрос ' + v)
  onCleanup(() => log('очистка ' + v))
})
id.value = 2
await nextTick()
id.value = 3
await nextTick()
stopWatch()`;

export const CLEANUP_ORDER_OUT = ['запрос 2', 'очистка 2', 'запрос 3', 'очистка 3'];

export const CLEANUP_NOTE =
  'Очистки хранятся не в замыкании колбэка, а в `WeakMap` от эффекта watcher’а к списку. Вызывает их одна и та же функция `cleanup` из двух мест: из задания — **перед** новым колбэком, и из `onStop` — при остановке. Поэтому последняя зарегистрированная очистка срабатывает и тогда, когда нового колбэка уже не будет. `onCleanup` — третий аргумент колбэка — привязан к своему эффекту навсегда. `onWatcherCleanup` из 3.5 ищет владельца в `activeWatcher`, а тот выставлен только на время синхронной части колбэка: после первого `await` регистрация молча уходит в никуда — снаружи это разобрано в [«Реактивности Vue», раздел «Жизнь эффекта»](/frameworks/vue-reactivity/#s5).';

/** Гонка без очистки: исполняется демо и тестом. */
export const RACE_NAIVE_CODE = `const query = ref('')
const shown = ref('—')

watch(query, async (q) => {
  const answer = await search(q)
  shown.value = answer
})`;

/** Гонка с очисткой: исполняется демо и тестом. */
export const RACE_CODE = `const query = ref('')
const shown = ref('—')

watch(query, async (q, _old, onCleanup) => {
  let stale = false
  onCleanup(() => {
    stale = true
    log('очистка: запрос «' + q + '» больше не нужен')
  })
  const answer = await search(q)
  if (stale) log('ответ «' + q + '» пришёл — выброшен')
  else shown.value = answer
})`;

/** Шаги демо гонки. Подпись — что происходит; `act` — что делает с этим модель. */
export const RACE_STEPS: RaceStep[] = [
  { label: 'начало: запросов нет', act: { kind: 'start' } },
  { label: "query.value = 'ко'", act: { kind: 'write', value: 'ко' } },
  { label: "query.value = 'кот' — читатель допечатал", act: { kind: 'write', value: 'кот' } },
  { label: 'сервер ответил на «кот»', act: { kind: 'answer', index: 1 } },
  { label: 'сервер ответил на «ко» — этот запрос был медленнее', act: { kind: 'answer', index: 0 } },
];

export const RACE_NOTE =
  'Ответы приходят в обратном порядке — так бывает всегда, когда короткий запрос тяжелее длинного. Без очистки последним пишет в `shown` тот, кто **ответил** последним, а не тот, кого **спросили** последним: на экране результаты по «ко» при строке «кот». С очисткой второй вызов колбэка сначала помечает первый устаревшим, и его ответ выбрасывается. Настоящий запрос отменяют так же, только очистка зовёт `controller.abort()` — и медленный ответ не приходит вовсе. `search` в демо — виртуальный сервер: возвращает промис и разрешает его, когда шаг демо говорит «сервер ответил», поэтому порядок ответов задан, а не случаен.';

// ---------------------------------------------------------------------------
// Раздел 3 · flush и watchEffect
// ---------------------------------------------------------------------------

export const FLUSH_LEAD =
  'Режим `flush` — одна строка при создании эффекта: какой `scheduler` ему дать. Сама очередь, дедупликация и `nextTick` устроены так же, как в [«Vue 3 изнутри», раздел «Планировщик»](/frameworks/vue-internals/#s6); здесь от неё оставлен минимум.';

/** Исполняется тестом как напечатано. */
export const FLUSH_CODE = `const n = ref(0)
watch(n, (v) => log('pre ' + v))
watch(n, (v) => log('post ' + v), { flush: 'post' })
watch(n, (v) => log('sync ' + v), { flush: 'sync' })
watchEffect(() => log('watchEffect ' + n.value))

n.value = 1
n.value = 2
log('синхронный код закончился')
nextTick(() => log('nextTick'))
await nextTick()`;

export const FLUSH_OUT = [
  'watchEffect 0',
  'sync 1',
  'sync 2',
  'синхронный код закончился',
  'pre 2',
  'watchEffect 2',
  'post 2',
  'nextTick',
];

export const FLUSH_NOTE =
  '`sync` — это задание без очереди: `scheduler` и есть `job`, и он выполняется внутри `endBatch` той самой записи — дважды, по разу на запись, с промежуточным `1`. `pre` и `post` видят только итог `2`: задание встало в очередь один раз. В компоненте `pre` значит «до перерисовки», а `post` — «после», и `id` задания берётся из номера компонента; вне компонента `id` нет, и задания идут в порядке записи.';

export const SSR_NOTE =
  'На сервере ждать микрозадачу некому: страница отрисовывается один раз. Поэтому `doWatch` (по исходнику `runtime-core` 3.5.42, не запуском) там `watch` без `immediate` не создаёт вовсе, `sync`-watcher’ы складывает в контекст рендера, чтобы остановить после, а остальные останавливает сразу после первого прогона.';

export const EFFECT_VS_WATCH_HEAD = ['что', '`watchEffect(fn)`', '`watch(source, cb)`'];

export const EFFECT_VS_WATCH_ROWS: string[][] = [
  ['зависимости', 'всё, что `fn` прочитала в последний прогон', 'только то, что прочитал геттер источника; чтения в `cb` не записываются'],
  ['первый прогон', 'сразу (`pre`, `sync`) или в очереди (`post`)', 'только сбор зависимостей; `cb` — лишь с `immediate`'],
  ['сравнение значений', 'нет — прогон на каждое пробуждение', '`Object.is` со старым значением; у `reactive` и `deep` — не сравнивает'],
  ['очистка', 'перед каждым прогоном `fn`, внутри её же геттера', 'перед каждым колбэком — но только если колбэк правда будет'],
  ['`await` внутри', 'чтения после `await` не записаны', 'на зависимости не влияет: их собирает геттер, а не колбэк'],
];

// ---------------------------------------------------------------------------
// Раздел 4 · effectScope
// ---------------------------------------------------------------------------

export const PLAIN_SCOPE =
  'Область — коробка для проводов. Всё, что включили, пока коробка открыта, само ложится в неё. Выдернули коробку из розетки — погасло всё, что в ней. Отсоединённая область — отдельный удлинитель, который просто лежит рядом: его выдёргивают отдельно.';

/** Исполняется тестом как напечатано. */
export const SCOPE_CODE = `const n = ref(0)
const scope = effectScope()
let nested, detached

scope.run(() => {
  effect(() => log('внешний видит ' + n.value))
  onScopeDispose(() => log('dispose: внешняя'))
  nested = effectScope()
  nested.run(() => effect(() => log('вложенный видит ' + n.value)))
  detached = effectScope(true)
  detached.run(() => effect(() => log('отсоединённый видит ' + n.value)))
})

scope.stop()
n.value = 1
log([scope.active, nested.active, detached.active].join(', '))`;

export const SCOPE_OUT = [
  'внешний видит 0',
  'вложенный видит 0',
  'отсоединённый видит 0',
  'dispose: внешняя',
  'отсоединённый видит 1',
  'false, false, true',
];

export const SCOPE_NOTE =
  'Вся привязка — одна переменная `activeScope` и одна строка в `createEffect`: эффект кладёт себя в текущую область. Вложенная область так же кладёт себя в `scopes` родителя, отсоединённая — нет, и родительский `stop` о ней не знает. Порядок остановки: эффекты, потом очистки `onScopeDispose`, потом дети. Остановленная область `run` не выполняет вовсе и возвращает `undefined`.';

export const COMPONENT_NOTE =
  'Компонент владеет областью так же: у экземпляра своё поле `scope`, и `setup()` выполняется внутри его `run` — поэтому `watch` и `computed`, созданные синхронно в `setup`, попадают туда сами. При размонтировании Vue зовёт `scope.stop()`. Как это выглядит снаружи и почему после `await` привязка теряется — в [«Реактивности Vue», раздел «Жизнь эффекта»](/frameworks/vue-reactivity/#s5).';

/** Исполняется тестом на Vue обеих сборок; мини-версия паузы не знает — это закреплено отдельно. */
export const PAUSE_CODE = `const n = ref(0)
const scope = effectScope()
scope.run(() => effect(() => log('эффект видит ' + n.value)))

scope.pause()
n.value = 1
n.value = 2
log('на паузе')
scope.resume()`;

export const PAUSE_OUT = ['эффект видит 0', 'на паузе', 'эффект видит 2'];

export const PAUSE_NOTE =
  'С 3.5 область можно не только остановить, но и приостановить. `pause` ставит каждому эффекту флаг `PAUSED`: пробуждение не выполняет его, а кладёт в `WeakSet` отложенных. `resume` снимает флаг и запускает отложенные по разу — две записи на паузе дали один прогон с последним значением. Подписки при этом не рвутся, в отличие от `stop`. Сверено с Vue; у мини-версии паузы нет.';

/** Так демо создаёт каждый узел дерева. Исполняется демо и тестом. */
export const SCOPE_NODE_CODE = `// n = ref(0) на всё дерево; parent — область-родитель или null;
// detached — какая кнопка нажата; name — S0, S1, …
const scope = parent ? parent.run(() => effectScope(detached)) : effectScope()
scope.run(() => {
  effect(() => log(name + ' видит n = ' + n.value))
  onScopeDispose(() => log(name + ': onScopeDispose'))
})
return scope`;

export const SCOPE_DEMO_NOTE =
  'Каждый узел создан строкой выше; отсоединённый создаётся **внутри** `run` родителя и всё равно ему не принадлежит — отступ в дереве показывает, где его создали, а не кто его остановит. Нажмите `n.value++`: откликаются только эффекты живых областей.';

/** Исполняется тестом как напечатано. */
export const SCOPE_COMPUTED_CODE = `const n = ref(1)
const scope = effectScope()
const double = scope.run(() => computed(() => n.value * 2))
scope.stop()
n.value = 5
log(double.value)`;

export const SCOPE_COMPUTED_OUT = [10];

export const SCOPE_COMPUTED_NOTE =
  '`computed` в 3.5 в область **не записывается** — в его конструкторе нет строки `activeScope.effects.push`. Останавливать его незачем: на источники он подписан, только пока его кто-то читает, и когда уходит последний читатель, уходит и подписка. Поэтому после `scope.stop()` он продолжает честно считать при чтении. Так ведут себя и мини-версия, и Vue.';

// ---------------------------------------------------------------------------
// Раздел 5 · computed 3.5
// ---------------------------------------------------------------------------

export const PLAIN_VERSIONS =
  'Бухгалтер, у которого на каждой папке с документами наклейка с номером. Сдавая отчёт, он записывает номера всех папок, по которым считал. Позвонили «что-то поменялось» — он не пересчитывает отчёт, а сверяет наклейки: номера те же — отчёт верен. Не те — пересчитывает, и если итог вышел прежним, свою наклейку не меняет, и тем, кто считал по его отчёту, сверять нечего.';

export const LINK_SHAPE = `цепочка n → parity → label → E из демо ниже: три узла Link

Dep n       ── subs ──►  Link { dep: n,      sub: parity }  ◄── deps ──  parity
Dep parity  ── subs ──►  Link { dep: parity, sub: label  }  ◄── deps ──  label
Dep label   ── subs ──►  Link { dep: label,  sub: E      }  ◄── deps ──  E

один Link — одна пара «Dep × подписчик». Он стоит сразу в двух списках:
подписчиков своего Dep (prevSub / nextSub) и источников своего подписчика
(prevDep / nextDep), и хранит version — какую версию Dep подписчик видел последней`;

export const LINK_NOTE =
  'В [«Vue 3 изнутри»](/frameworks/vue-internals/#s2) `Dep` — это `Set` подписчиков, а эффект держит массив своих `Dep` и карту увиденных версий. Здесь всё это один объект: `Link` хранит версию и стоит в списке источников подписчика (`nextDep`) и в списке подписчиков источника (`prevSub`). Перед прогоном `prepareDeps` метит все связи версией `-1`, чтение подтверждает связь **на месте**, `cleanupDeps` удаляет неподтверждённые. Эффект, читающий то же, что в прошлый раз, не создаёт ни одного объекта — там, где старая мини-версия на каждую зависимость делала `Set.delete`, `Set.add`, запись в массив `deps` и в карту версий.';

export const REFRESH_FACTS = [
  {
    t: 'Пометка вместо пересчёта',
    d: '`notify` у `computed` только ставит `dirty` и передаёт пометку своим читателям. Считает `refreshComputed` — в момент чтения или в момент проверки `isDirty` у читателя.',
  },
  {
    t: '`globalVersion` — самый дешёвый ответ',
    d: 'Счётчик всех изменений в системе. `computed` запоминает его при пересчёте; не сдвинулся — не менялось вообще ничего, и даже версии источников сверять не нужно. Главный выигрыш — у `computed`, который читают вне эффектов: подписки у него нет, и без этой строки он сверял бы источники на каждом чтении.',
  },
  {
    t: '`isDirty` — «не изменилось ли», без пересчёта',
    d: 'Проход по списку `Link`: версия источника та же, что в узле, — источник не менялся. У источника-`computed` сначала досчитать его — и сравнить ещё раз. Первый же несовпавший узел — ответ «да».',
  },
  {
    t: 'Версия растёт, только если значение другое',
    d: 'Пересчитанный `computed` сравнивает новое значение со старым через `Object.is`. Прежнее — версия не растёт, и для всех его читателей он «не изменился», хотя и пересчитан.',
  },
  {
    t: '`batchDepth` — один запуск на запись',
    d: 'Запись в `reactive` может тронуть два `Dep` (ключ и перебор ключей), а `computed` передаёт пометку дальше по цепочке. Каждый такой шаг открывает пакет; эффекты копятся в список с флагом `notified` и запускаются, когда закрылся самый внешний. Без счётчика эффект, читающий два `computed` от одного источника, проснулся бы от первого, пока второй ещё не помечен, и прочитал бы его старый кеш — несогласованная пара появляется, стоит убрать строку `if (--batchDepth > 0) return`.',
  },
];

/** Подмена, превращающая версионную схему в «только флаг». Та же, что исполняют демо и тест. */
export const DIRTY_ONLY_PATCH: CodePatch[] = [
  {
    find: '  if (c.evaluated && !isDirty(c)) return         // источники прежние — не пересчитывать\n',
    replace: '',
    why: 'помечен — пересчитать, не спрашивая источники',
  },
  {
    find: 'if (c.dep.version === 0 || !Object.is(value, c._value))',
    replace: 'if (true)',
    why: 'пересчитан — объявить новым, даже если значение прежнее',
  },
];

/** Та же подмена таблицей для страницы: строка из данных, а не пересказ. */
export const DIRTY_ONLY_HEAD = ['строка в `refreshComputed`', 'в варианте «только флаг»', 'что это меняет'];

export const DIRTY_ONLY_ROWS: string[][] = DIRTY_ONLY_PATCH.map((p) => [
  `\`${p.find.trim()}\``,
  p.replace ? `\`${p.replace}\`` : 'удалена',
  p.why,
]);

export const DIRTY_ONLY_NOTE =
  'У мини-версии из [«Vue 3 изнутри»](/frameworks/vue-internals/#s5) обе половины уже есть: флаг `dirty` и проверка версий в `isDirty`. Чтобы увидеть, что даёт каждая, здесь их разделили: вариант «только флаг» — это та же строка с двумя удалёнными проверками. Так вели себя `computed` до 3.4: пометка шла по цепочке до конца, и эффект в её конце запускался, даже когда итог не менялся.';

/** Цепочка для демо и теста: две подписи `computed`, один эффект. */
export const CHAIN: ChainScenario = {
  setup: `const n = ref(2)
const parity = computed(() => {
  count('parity')
  return n.value % 2
})
const label = computed(() => {
  count('label')
  return parity.value ? 'нечётное' : 'чётное'
})
const E = effect(() => {
  count('E')
  log('E: ' + label.value)
})`,
  actions: ['n.value += 2', 'n.value++', 'n.value = n.value'],
  note: '`n.value += 2` меняет `n`, но не чётность. Версионная схема пересчитывает `parity`, видит прежний `0` — и дальше не идёт: `label` и `E` не тронуты. «Только флаг» пересчитывает всю цепочку и запускает `E` с тем же текстом. `n.value = n.value` не будит никого в обеих: `ref` сравнивает значения до `trigger`.',
};

/**
 * Сквозной пример к `refreshComputed`. Добавлено по решению автора курса (2026-09-29):
 * `REFRESH_FACTS` перечисляли четыре проверки функции карточками, но не показывали, какая
 * из них срабатывает на настоящей записи и в каком порядке вызовы уходят вглубь цепочки.
 * Сцена — та же цепочка `CHAIN`, что исполняют демо и тест, и её первая кнопка. Итог
 * (`parity` пересчитан один раз, `label` и `E` — ноль; «только флаг» пересчитывает всё
 * и запускает `E`) сверяет тест по счётчикам `count(…)`. Порядок вызовов прочитан
 * по коду `STEP_LINK`, `STEP_EFFECT` и `STEP_COMPUTED`.
 */
export const REFRESH_SCENE_CODE = `${CHAIN.setup}

n.value += 2        // 2 → 4: число другое, чётность та же`;

export const REFRESH_SCENE_NOTE =
  'Что было бы **с одним флагом `dirty`** — так `computed` работали до 3.4. Запись в `n` помечает `parity`, тот — `label`, тот будит `E`. Помечен — значит пересчитать: `parity` считает `4 % 2` и получает прежний `0`, но «пересчитан» значит «новый», и `label` тоже пересчитывается — снова `\'чётное\'`. `E` запускается и печатает тот же текст. Три единицы работы, и ни одна не изменила ни одного значения. На длинной цепочке так пересчитывается всё до конца, а в конце — перерисовка компонента с тем же выводом. Версии останавливают эту волну на первом звене, чьё значение не изменилось.';

export const REFRESH_STEPS: { k: string; when: string; what: string; cost: string }[] = [
  {
    k: '1 · запись — только пометки',
    when: '`n.value += 2`, внутри сеттера `ref`',
    what: '`triggerDep` поднимает версию `n` и `globalVersion`. Пометка идёт по цепочке подписчиков: `parity.notify` ставит `dirty`, передаёт `label`, тот ставит `dirty` и кладёт `E` в пакет. **Никто ничего не считает.** Когда пакет закрывается, у `E` вызывается `trigger`.',
    cost: 'Проход пометкой по цепочке — без единого вызова геттера.',
  },
  {
    k: '2 · `E` спрашивает, а не запускается',
    when: '`E.trigger()` → `isDirty(E)`',
    what: 'Единственный источник `E` — `label`. Его версия в узле `Link` та же, что `E` видел, но `label` — `computed`, и его надо досчитать: `refreshComputed(label)`. Первые две проверки не останавливают: `label` помечен, и `globalVersion` сдвинулся. Третья — `isDirty(label)` — уходит на звено глубже, к `parity`.',
    cost: 'Вызовы уходят вглубь цепочки, но пока — только сравнения чисел.',
  },
  {
    k: '3 · пересчёт одного звена',
    when: '`refreshComputed(parity)` → `isDirty(parity)`',
    what: 'Источник `parity` — сам `n`, и его версия в узле **не совпала**: `n` правда изменился. `parity` пересчитывается — `4 % 2`, `0`. `Object.is(0, 0)` — значение прежнее, **версия `parity` не растёт**.',
    cost: 'Один вызов геттера — `count(\'parity\')` в демо.',
  },
  {
    k: '4 · обратный путь: «ничего не изменилось»',
    when: 'возврат из `isDirty(label)`, затем из `isDirty(E)`',
    what: '`label` сравнивает версию `parity` с той, что видел, — совпала. Значит, пересчитывать `label` незачем, и его версия тоже прежняя. `E` сравнивает версию `label` — совпала. `E` **не запускается**. С кнопкой `n.value++` в демо ниже на шаге 3 выйдет `1`, версия `parity` вырастет, и волна дойдёт до `E`.',
    cost: 'Ноль вызовов `label` и `E` вместо двух — и чем длиннее цепочка за неизменившимся звеном, тем больше сэкономлено.',
  },
];

/** «На пальцах»: продолжение бухгалтера из `PLAIN_VERSIONS` — цепочка из трёх отчётов. */
export const PLAIN_REFRESH =
  'Те же наклейки, но бухгалтеров трое по цепочке: первый считает остатки по папке, второй — налог по отчёту первого, третий печатает сводку. В папку доложили документ. Третий, прежде чем перепечатывать, спрашивает второго «твой отчёт менялся?», второй — первого. Первый пересчитывает — остаток вышел прежний, наклейку не меняет. Второй видит прежнюю наклейку первого и не считает вовсе. Третий видит прежнюю наклейку второго и ничего не печатает. Работал один человек из трёх.';

export const CHAIN_DEMO_NOTE =
  'Счётчики — это вызовы `count(…)` из кода цепочки, исполненного двумя вариантами мини-версии. Список `Link` и версии прочитаны из внутренних полей после каждого шага: у каждого подписчика — его источники по `nextDep`, у каждой связи — `увиденная / текущая` версия источника.';

// ---------------------------------------------------------------------------
// Раздел 6 · утечки
// ---------------------------------------------------------------------------

/** Исполняется тестом как напечатано. */
export const LEAK_CODE = `const n = ref(0)
const scope = effectScope()
scope.run(() => {
  effect(() => log('в области: ' + n.value))
})
effect(() => log('вне области: ' + n.value))

scope.stop()
n.value = 1`;

export const LEAK_OUT = ['в области: 0', 'вне области: 0', 'вне области: 1'];

export const LEAK_CHAIN =
  'Цепочка, которая держит память: **источник → `Dep` → `Link` → эффект → его функция → замыкание** со всем, что оно захватило. Пока источник жив (а стор, модульная переменная или `window` живут всегда), жив и эффект, и всё, до чего дотягивается его замыкание, — возможно, целый размонтированный компонент с DOM-узлами. Почему «дотягивается» значит «не собирается», — в [«Памяти и GC», раздел «Утечки»](/js/memory-gc/#s2); как замыкание держит больше, чем кажется, — в разделе [«Замыкания»](/js/memory-gc/#s3) той же темы.';

export const LEAK_FACTS = [
  {
    t: 'Эффект вне области',
    d: 'Создан после `await` в `setup`, в колбэке таймера, в модуле — `activeScope` пуст, и `createEffect` его никуда не записал. Компонент уйдёт, а эффект останется в списке подписчиков источника. Лечится сохранённым `stop` или своей областью.',
  },
  {
    t: 'Забытый `stop`',
    d: '`watch` вернул функцию остановки, её не вызвали. `stop` делает ровно две вещи, которые разрывают цепочку: `removeSub` у каждого `Link` — источник больше не ссылается на эффект — и `onStop` с очистками. Без вызова не случится ни то, ни другое.',
  },
  {
    t: '`computed` без читателей — не утечка',
    d: 'В 3.5 `computed` подписан на источники, только пока его самого кто-то читает: `addSub` подписывает его при первом читателе, `removeSub` отписывает при уходе последнего. Прочитанный вне эффекта `computed` не оставляет в источнике ни одного узла. Видно по внутреннему полю `dep.subs` — оно не публичное и может смениться.',
  },
];

// ---------------------------------------------------------------------------
// Раздел 7 · мини-версия против Vue
// ---------------------------------------------------------------------------

export const REAL_HEAD = ['что', 'мини-версия', 'Vue 3.5.42'];

export const REAL_ROWS: string[][] = [
  [
    'Поиск `Link` при чтении',
    'проход по списку источников подписчика',
    'поле `dep.activeLink`: связь с текущим подписчиком находится за одно сравнение',
  ],
  ['Опустевший `Dep`', 'остаётся в `Map`', 'удаляется по счётчику подписчиков `sc`'],
  ['Состояние эффекта', 'поля `active`, `running`, `notified`, `tracking`', 'битовая маска `flags`, плюс `PAUSED` и `ALLOW_RECURSE`'],
  ['`effectScope`', 'массивы и `remove` через `indexOf`; паузы нет', 'то же, плюс `pause`/`resume` и выписка из родителя за O(1) по сохранённому индексу'],
  ['`traverse`', 'только простые объекты', 'массивы, `Map`, `Set`, символьные ключи, `__v_skip`'],
  ['Реактивные массивы и коллекции', 'не поддержаны', 'свои ловушки и обёртки методов'],
  ['Порядок заданий `pre`', 'в порядке записи', 'в порядке записи вне компонента; внутри — по `id` компонента'],
];

export const REAL_NOTE =
  'Всё в таблице — цена и охват, а не поведение: на всех примерах темы вывод мини-версии совпадает с Vue в обеих сборках. Строки про `activeLink`, `sc` и `flags` — по исходнику `reactivity.cjs.prod.js` 3.5.42, не запуском. Про ядро 3.6 на alien-signals — в [«Vue 3 изнутри», раздел «Что в Vue 3.5 иначе»](/frameworks/vue-internals/#s8): здесь оно тоже не проверялось.';

// ---------------------------------------------------------------------------
// Раздел 8 · тонкие места
// ---------------------------------------------------------------------------

/** Исполняется тестом как напечатано. */
export const ONCE_CODE = `const n = ref(0)
watch(n, (v, _old, onCleanup) => {
  log('колбэк ' + v)
  onCleanup(() => log('очистка ' + v))
}, { once: true })
n.value = 1
await nextTick()
log('после первого колбэка')`;

export const ONCE_OUT = ['колбэк 1', 'очистка 1', 'после первого колбэка'];

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: '`once` и `onCleanup` вместе отменяют собственный запрос',
    code: ONCE_CODE,
    d: '`once` — это `stop` сразу после колбэка, а `stop` зовёт очистки. Асинхронный колбэк возвращается на первом `await`, и его же очистка срабатывает в ту же минуту: флаг `stale` поднят раньше, чем пришёл ответ, и ответ выброшен. В мини-версии и в Vue одинаково: `очистка 1` идёт сразу за `колбэк 1`. → с `once` отменять нечего и незачем: очистку не регистрировать.',
    tone: 'err',
  },
  {
    n: '02',
    t: '`watch(() => state.obj)` не видит изменений внутри',
    d: 'Геттер возвращает тот же объект, `Object.is` говорит «не изменилось», и колбэка нет — хотя эффект просыпался бы, прочитай он поле. Подписка здесь только на ключ `obj`. `watch(state.obj)` — наоборот, глубокий, потому что источник — реактивный объект. → `deep: true` или `deep: n` у геттера, или геттер, возвращающий примитив.',
    tone: 'warn',
  },
  {
    n: '03',
    t: 'У `watch(reactive)` колбэк зовётся на каждое изменение внутри',
    d: 'Реактивный источник включает `forceTrigger`: сравнение значений отключено, потому что объект всегда тот же. Любая запись в любое поле дерева — задание, полный `traverse` и колбэк. → смотреть на конкретное поле геттером.',
  },
  {
    n: '04',
    t: 'Очистка `watchEffect` видит новое значение, а не старое',
    code: 'watchEffect((onCleanup) => {\n  onCleanup(() => log(n.value))   // прочитает уже новое n\n})',
    d: 'Очистка вызывается в начале следующего прогона, когда запись уже случилась. Замыкание очистки читает текущее состояние, а не то, что было при регистрации. Проверено: после `n.value = 1` очистка прошлого прогона печатает `1`. → нужное значение запоминать в локальную переменную до регистрации.',
    tone: 'warn',
  },
  {
    n: '05',
    t: '`scope.stop()` не останавливает `computed`',
    d: 'В 3.5 `computed` не записывается в область вовсе. После `stop` он продолжает считать при чтении — и это правильно: он не держит подписку, пока его не читают. Сломается только ожидание «остановил область — всё внутри замерло».',
  },
  {
    n: '06',
    t: '`effectScope(true)` внутри `run` родителя всё равно ничей',
    d: 'Отсоединённость решается в конструкторе и не зависит от того, где его вызвали. Такая область переживёт и компонент, и родительскую область, и её `stop` — только ваш.',
    tone: 'err',
  },
];

// ---------------------------------------------------------------------------
// Раздел 9 · источники
// ---------------------------------------------------------------------------

export const SOURCES = [
  {
    title: '`@vue/reactivity` · `watch.ts`',
    href: 'https://github.com/vuejs/core/blob/main/packages/reactivity/src/watch.ts',
    what: '`watch`, `traverse` с глубиной, `onWatcherCleanup`, `cleanupMap` и `once` — оригинал шага про `watch`. В 3.5 переехал сюда из `runtime-core`.',
  },
  {
    title: '`runtime-core` · `apiWatch.ts`',
    href: 'https://github.com/vuejs/core/blob/main/packages/runtime-core/src/apiWatch.ts',
    what: '`doWatch`: как режим `flush` превращается в `scheduler`, и откуда у задания `id` компонента.',
  },
  {
    title: '`@vue/reactivity` · `effectScope.ts`',
    href: 'https://github.com/vuejs/core/blob/main/packages/reactivity/src/effectScope.ts',
    what: '`EffectScope`: `run`, `stop(fromParent)`, выписка из родителя по индексу, `pause`/`resume`.',
  },
  {
    title: '`@vue/reactivity` · `dep.ts` и `effect.ts`',
    href: 'https://github.com/vuejs/core/blob/main/packages/reactivity/src/dep.ts',
    what: '`Link`, `Dep.track`, `addSub` с ленивой подпиской `computed`, `globalVersion`, `startBatch`/`endBatch`, `refreshComputed`.',
  },
  {
    title: 'Vue · Watchers',
    href: 'https://vuejs.org/guide/essentials/watchers.html',
    what: 'Официальное описание источников, `deep` с числом, `once`, `onWatcherCleanup` и режимов `flush`.',
  },
  {
    title: 'Announcing Vue 3.5',
    href: 'https://blog.vuejs.org/posts/vue-3-5',
    what: 'Переписанное ядро реактивности на версиях и связях, `onWatcherCleanup`, `pause`/`resume`.',
  },
];

export const RELATED =
  'Смежное на сайте: [Vue 3 изнутри: своя реактивность](/frameworks/vue-internals/) — первая мини-версия: `reactive`, `track`/`trigger`, эффект и [планировщик](/frameworks/vue-internals/#s6), на который здесь опирается `flush`. [Реактивность Vue](/frameworks/vue-reactivity/#s5) — то же снаружи: что останавливает компонент, что остаётся ничьим после `await`, как стор Pinia живёт в своей области. [Память и GC](/js/memory-gc/#s2) — почему незабытый эффект держит память. [Промис изнутри](/js/promise-internals/) — где продолжается асинхронный колбэк после `await`.';
