import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { MiniScenario } from '@/widgets/mini-reactivity/model/types';

/**
 * Данные темы «Vue 3 изнутри: своя реактивность».
 *
 * Главное здесь — `MINI_VUE_CODE`: мини-реализация реактивности, разложенная на шесть шагов
 * `STEP_*`. Каждый шаг печатается в теме `<CodeBlock code={STEP_…} />`, а склейка шагов
 * **та же самая строка** исполняется и демо (`widgets/mini-reactivity/model/session.ts`
 * собирает её `new Function`), и тестом. Копии нет: расхождение между напечатанным
 * и исполняемым невозможно по построению, а расхождение с настоящим Vue — красный тест.
 *
 * Что чем проверено (`tests/unit/vue-internals.test.ts`, Node 26.8.2, `@vue/runtime-core`
 * 3.5.42, **обе** сборки — `NODE_ENV=production` и отладочная, потому что `index.js`
 * пакета — переключатель по окружению):
 *
 *   - сценарии демо `MINI_SCENARIOS` дают одинаковый журнал на мини-версии и на Vue;
 *   - примеры `RECEIVER_CODE`, `BRANCH_CODE` исполняются как напечатаны, на обеих;
 *   - условная зависимость отписывается; `computed` ленив, кеширует и не будит читателей
 *     при прежнем значении; три записи — один прогон задания; `sync → pre → post → nextTick`;
 *     добавление и удаление ключа будят перебор, запись существующего — нет; `NaN` не будит;
 *     `ref` глубокий, `shallowRef` нет; вложенные эффекты копятся одинаково;
 *   - каждое «без этой строки сломается» в тексте проверено **сломанным вариантом**:
 *     тест подменяет одну строку в `MINI_VUE_CODE` и показывает поломку (receiver, кеш
 *     прокси, очистка, копия `Set`, два прохода `notify`, `Object.is`);
 *   - намеренные отличия закреплены явно: порядок заданий `pre` вне компонента (Vue — по
 *     порядку записи, мини — по `id`), порядок подписчиков внутри одной записи, подписка
 *     `computed` без читателей (Vue отписывается, мини — нет; проверено по полю `dep.subs`
 *     внутреннего `Link` — поле внутреннее и может смениться).
 *
 * По исходнику `reactivity.cjs.prod.js` 3.5.42 (не запуском): удаление опустевшего `Dep`
 * из `depsMap` (`removeSub` → `dep.map.delete`), `globalVersion`, `startBatch`/`endBatch`,
 * `prepareDeps`/`cleanupDeps` с версией `-1`, битовые флаги эффекта, флаг `QUEUED`
 * и двоичный поиск в `runtime-core` (`getId`, `findInsertionIndex`).
 *
 * ⚠️ **Не проверено ничем, подписано источником:** переход ядра на alien-signals в линии
 * 3.6. Другой версии Vue в проекте нет.
 *
 * ── Проход «за кадром» ─────────────────────────────────────────────────────────────────
 *
 *   — «Массивы и коллекции» раскрыты в разделе «Что в Vue 3.5 иначе» (`COLLECTIONS_CODE`):
 *     пример исполняется тестом на Vue в обеих сборках, вывод — `COLLECTIONS_LOG`. Отдельным
 *     прогоном (Node 26.8.2, `@vue/reactivity` 3.5.42): `reactive(map).get !== Map.prototype.get`
 *     (метод подменён обёрткой), смена значения существующего ключа будит `forEach`, `values()`
 *     и `entries()`, но не `keys()`;
 *   — «Компонент как эффект» — одна фраза со ссылкой в «Сортировке по `id`»: разобран в
 *     «Vue 3 изнутри: рендерер и patch»;
 *   — «Отладочные хуки» — фраза в `DEMO_NOTE` со ссылкой на «Реактивность Vue», где это уже сказано;
 *   — «alien-signals и Vapor Mode» — alien-signals остаётся в `ALIEN_NOTE`; Vapor Mode и сигналы
 *     как модель — отдельная тема «Vapor Mode во Vue», ссылка в «Смежном».
 *
 * Ссылки на соседние темы: `WATCH_NOTE` сокращён до выжимки со ссылкой на раздел `flush`
 * в «Vue 3 изнутри: watch, effectScope и computed 3.5»; строка `effectScope` в `REAL_ROWS` —
 * туда же, раздел `effectScope`; «Сортировка по `id`» — на раздел «Компонент» в
 * «Vue 3 изнутри: рендерер и patch».
 */

// ---------------------------------------------------------------------------
// Мини-реализация: шесть шагов и склейка
// ---------------------------------------------------------------------------

/** Шаг 1: `reactive` на `Proxy`. */
export const STEP_REACTIVE = `const RAW = Symbol('raw')
const reactiveMap = new WeakMap()   // исходный объект → его прокси

const isObject = (v) => v !== null && typeof v === 'object'
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k)
const toRaw = (v) => (isObject(v) && v[RAW]) || v

const handlers = {
  get(target, key, receiver) {
    if (key === RAW) return target
    const value = Reflect.get(target, key, receiver)
    track(target, key)
    // вложенный объект становится прокси только сейчас, при первом чтении
    return isObject(value) ? reactive(value) : value
  },
  set(target, key, value, receiver) {
    value = toRaw(value)
    const had = hasOwn(target, key)
    const old = target[key]
    const ok = Reflect.set(target, key, value, receiver)
    if (!had) trigger(target, key, 'add')
    else if (!Object.is(old, value)) trigger(target, key, 'set')
    return ok
  },
  deleteProperty(target, key) {
    const had = hasOwn(target, key)
    const ok = Reflect.deleteProperty(target, key)
    if (had && ok) trigger(target, key, 'delete')
    return ok
  },
  has(target, key) {
    track(target, key)
    return Reflect.has(target, key)
  },
  ownKeys(target) {
    track(target, ITERATE_KEY)   // зависим не от ключа, а от набора ключей
    return Reflect.ownKeys(target)
  },
}

function reactive(target) {
  if (!isObject(target) || target[RAW]) return target   // примитив или уже прокси
  let proxy = reactiveMap.get(target)
  if (!proxy) reactiveMap.set(target, (proxy = new Proxy(target, handlers)))
  return proxy
}`;

/** Шаг 2: таблица зависимостей, `track` и `trigger`. */
export const STEP_TRACK = `const targetMap = new WeakMap()     // target → Map(key → Dep)
const ITERATE_KEY = Symbol('iterate')
let activeEffect = null             // кто выполняется прямо сейчас

function createDep() {
  const dep = new Set()             // подписчики
  dep.version = 0                   // растёт на каждое изменение
  return dep
}

function track(target, key) {
  if (!activeEffect) return         // читают вне эффекта — записывать некого
  let depsMap = targetMap.get(target)
  if (!depsMap) targetMap.set(target, (depsMap = new Map()))
  let dep = depsMap.get(key)
  if (!dep) depsMap.set(key, (dep = createDep()))
  trackDep(dep)
}

function trackDep(dep) {
  if (!activeEffect) return
  if (!dep.has(activeEffect)) {
    dep.add(activeEffect)
    activeEffect.deps.push(dep)     // обратная ссылка: чтобы потом отписаться
  }
  activeEffect.seen.set(dep, dep.version)
}

function trigger(target, key, type) {
  const depsMap = targetMap.get(target)
  if (!depsMap) return
  const deps = [depsMap.get(key)]
  if (type === 'add' || type === 'delete') deps.push(depsMap.get(ITERATE_KEY))
  const subs = new Set()            // эффект, читавший и ключ, и перебор, — один раз
  for (const dep of deps) {
    if (!dep) continue
    dep.version++
    dep.forEach((sub) => subs.add(sub))
  }
  notify(subs)
}

function triggerDep(dep) {
  dep.version++
  notify(dep)
}

function notify(subs) {
  const list = [...subs]            // копия: прогон эффекта перестраивает dep на ходу
  for (const e of list) if (e.computed) wake(e)    // сперва пометить computed
  for (const e of list) if (!e.computed) wake(e)   // потом будить эффекты
}

function wake(e) {
  if (e.running) return             // эффект сам себя не перезапускает
  if (e.scheduler) e.scheduler()
  else if (isDirty(e)) e.run()
}`;

/** Шаг 3: эффект — запуск, очистка, вложенность, защита от рекурсии. */
export const STEP_EFFECT = `let nextId = 0

function createEffect(fn, scheduler) {
  const e = {
    id: nextId++, fn, scheduler, deps: [], seen: new Map(),
    active: true, running: false, computed: null,
    run() {
      if (!e.active) return fn()
      cleanup(e)                    // старые связи — долой, соберём заново
      const prev = activeEffect     // вложенный эффект вернёт место внешнему
      activeEffect = e
      e.running = true
      try {
        return fn()
      } finally {
        e.running = false
        activeEffect = prev
      }
    },
  }
  return e
}

function cleanup(e) {
  for (const dep of e.deps) dep.delete(e)
  e.deps.length = 0
  e.seen.clear()
}

function effect(fn, options = {}) {
  const e = createEffect(fn, options.scheduler)
  e.run()
  const runner = () => e.run()
  runner.effect = e
  return runner
}

function stop(runner) {
  cleanup(runner.effect)
  runner.effect.active = false   // отписан; прямой вызов просто выполнит fn
}`;

/** Шаг 4: `ref` и `shallowRef`. */
export const STEP_REF = `function ref(value) {
  return createRef(value, false)
}

function shallowRef(value) {
  return createRef(value, true)
}

function createRef(value, shallow) {
  let raw = shallow ? value : toRaw(value)
  let current = shallow ? value : reactive(value)
  const dep = createDep()
  return {
    __v_isRef: true,
    dep,
    get value() {
      trackDep(dep)
      return current
    },
    set value(next) {
      const nextRaw = shallow ? next : toRaw(next)
      if (Object.is(nextRaw, raw)) return
      raw = nextRaw
      current = shallow ? next : reactive(next)
      triggerDep(dep)
    },
  }
}`;

/** Шаг 5: `computed` и проверка версий. */
export const STEP_COMPUTED = `function computed(getter) {
  const c = {
    __v_isRef: true,
    dep: createDep(),
    dirty: true,
    ran: false,
    cached: undefined,
    effect: null,
    refresh() {
      if (!c.dirty) return
      c.dirty = false
      if (c.ran && !isDirty(c.effect)) return   // источники не изменились
      const next = c.effect.run()
      c.ran = true
      if (!Object.is(next, c.cached)) {
        c.cached = next
        c.dep.version++                // подписчики увидят: значение другое
      }
    },
    get value() {
      c.refresh()                      // лениво: считаем только при чтении
      trackDep(c.dep)                  // computed — сам источник для читающего
      return c.cached
    },
  }
  c.dep.computed = c
  // computed — подписчик своих источников: при их изменении он не считает,
  // а только помечает себя и будит своих читателей
  c.effect = createEffect(getter, () => {
    if (c.dirty) return
    c.dirty = true
    notify(c.dep)
  })
  c.effect.computed = c
  return c
}

// изменилось ли хоть что-то из прочитанного в прошлый раз
function isDirty(e) {
  for (const dep of e.deps) {
    if (dep.computed) dep.computed.refresh()   // досчитать computed, если он помечен
    if (dep.version !== e.seen.get(dep)) return true
  }
  return false
}`;

/** Шаг 6: очередь, микрозадача, `nextTick`, `watch`. */
export const STEP_SCHEDULER = `const queue = []
const postQueue = []
const resolved = Promise.resolve()
let currentFlush = null
let flushPending = false
let flushing = false
let flushIndex = -1

function queueJob(job) {
  if (queue.indexOf(job, flushIndex + 1) !== -1) return   // уже ждёт — второй раз не ставим
  let i = flushIndex + 1
  while (i < queue.length && queue[i].id <= job.id) i++   // по возрастанию id
  queue.splice(i, 0, job)
  queueFlush()
}

function queuePostJob(job) {
  if (!postQueue.includes(job)) postQueue.push(job)
  queueFlush()
}

function queueFlush() {
  if (flushPending || flushing) return
  flushPending = true
  currentFlush = resolved.then(flushJobs)   // одна микрозадача на все записи
}

function flushJobs() {
  flushPending = false
  flushing = true
  for (flushIndex = 0; flushIndex < queue.length; flushIndex++) queue[flushIndex]()
  queue.length = 0
  flushIndex = -1
  for (const job of postQueue.splice(0)) job()
  flushing = false
  if (queue.length || postQueue.length) return flushJobs()   // post-задание снова что-то записало
  currentFlush = null
}

function nextTick(fn) {
  const p = currentFlush || resolved
  return fn ? p.then(fn) : p
}

function watch(source, cb, { flush = 'pre' } = {}) {
  const getter = typeof source === 'function' ? source : () => source.value
  let oldValue
  let ran = false
  const job = () => {
    if (!e.active || (ran && !isDirty(e))) return
    ran = true
    const value = e.run()
    if (!cb) return
    if (Object.is(value, oldValue)) return
    cb(value, oldValue)
    oldValue = value
  }
  const e = createEffect(getter, () => {
    if (flush === 'sync') job()
    else if (flush === 'post') queuePostJob(job)
    else queueJob(job)
  })
  job.id = e.id
  job.effect = e
  if (cb) {
    oldValue = e.run()                 // стартовое значение для первого cb
    ran = true
  } else if (flush === 'post') queuePostJob(job)   // и первый прогон — после
  else job()
  return () => stop({ effect: e })
}

function watchEffect(fn, options) {
  return watch(fn, null, options)
}`;

/**
 * Что реализация отдаёт наружу. Первая строка — публичные имена Vue, вторая — внутренности,
 * которые демо читает напрямую, вместо отладочных хуков `onTrack`/`onTrigger`.
 */
export const STEP_EXPORT = `return {
  reactive, toRaw, ref, shallowRef, computed, effect, stop, watch, watchEffect, nextTick,
  targetMap, ITERATE_KEY, queue, postQueue, getActiveEffect: () => activeEffect,
}`;

/**
 * Вся мини-реализация одной строкой — тело функции. Функции объявлены через `function`,
 * поэтому порядок шагов в склейке не важен: объявления всплывают.
 */
export const MINI_VUE_CODE = [
  STEP_REACTIVE,
  STEP_TRACK,
  STEP_EFFECT,
  STEP_REF,
  STEP_COMPUTED,
  STEP_SCHEDULER,
  STEP_EXPORT,
].join('\n\n');

// ---------------------------------------------------------------------------
// Вводный раздел · словарь
// ---------------------------------------------------------------------------

export const INTRO_NOTE =
  'У каждой странности реактивности Vue есть строка, которая её вызывает. Эффект отписывается от невыполненной ветки `if`, потому что перед каждым запуском стирает свои связи. `computed` не будит читателей, если значение не изменилось, потому что у каждого `Dep` есть номер версии. Три записи дают одну перерисовку, потому что задание не встаёт в очередь второй раз. Ниже эти строки написаны руками и сверены тестом с настоящим Vue 3.5.';

/** «На пальцах» для всей темы: зачем собирать своё, если есть настоящее. */
export const PLAIN_INTRO =
  'Как разобрать будильник, чтобы понять, почему он звенит в семь, а не в шесть. Снаружи видно только поведение, а причина — конкретная шестерёнка. Мини-Vue — тот же будильник со снятой крышкой: шестерёнок меньше, чем в настоящем, но каждая на своём месте, и можно вынуть любую и посмотреть, что перестанет работать.';

export const GLOSSARY = [
  {
    k: 'ловушка прокси · `Reflect` · receiver',
    d: 'Ловушка — функция в `new Proxy(target, handler)`, перехватывающая одну операцию (`get`, `set`, `has`, `ownKeys`, `deleteProperty`); `Reflect` выполняет ту же операцию «как обычно»; receiver — объект, от имени которого идёт обращение, он станет `this` в геттере. Подробно — в теме [«Proxy и Reflect»](/js/proxy-reflect/).',
  },
  {
    k: '`WeakMap`',
    d: 'Словарь, ключи которого — объекты, причём запись не мешает сборщику мусора убрать объект-ключ. Обойти `WeakMap` нельзя: только спросить по ключу.',
  },
  {
    k: 'эффект · подписчик',
    d: 'Функция, которую надо перезапускать, когда меняется прочитанное ею. В мини-версии — объект с полями `fn`, `deps`, `running`; в Vue — класс `ReactiveEffect`. `computed` тоже подписчик — своих источников.',
  },
  {
    k: '`Dep`',
    d: 'Набор подписчиков одного ключа одного объекта, одного `ref` или одного `computed` — плюс номер версии, который растёт с каждым изменением.',
  },
  {
    k: 'задание (job)',
    d: 'Функция в очереди планировщика. Реактивность будит эффект сразу, а эффект со `scheduler` вместо работы ставит в очередь задание; очередь выполняется позже, одной пачкой.',
  },
  {
    k: 'микрозадача',
    d: 'Работа, которую движок выполняет сразу после текущего синхронного кода и до отрисовки кадра. В ней сливается очередь Vue. Подробно — [«Event Loop», раздел «Checkpoint»](/js/event-loop/#s3).',
  },
];

// ---------------------------------------------------------------------------
// Перед началом
// ---------------------------------------------------------------------------

export const PREREQ_NOTE =
  'Мини-Vue стоит на двух механизмах языка — `Proxy` замечает операцию, микрозадача откладывает реакцию — и воспроизводит поведение, которое снаружи уже описано в «Реактивности Vue».';

export const PREREQ = [
  {
    t: 'Как реактивность Vue ведёт себя снаружи',
    d: 'Эффект перезапускается от прочитанного, `computed` ленив и кеширует, три записи дают одну перерисовку, режимы `flush` различаются моментом. Здесь каждое из этих правил получает свою строку кода.',
    href: '/frameworks/vue-reactivity/',
    hrefLabel: 'Реактивность Vue',
    tone: 'info' as const,
  },
  {
    t: 'Что `Proxy` перехватывает операции, а `Reflect` их выполняет',
    d: 'Ловушка получает `target`, ключ и `receiver`, а честное выполнение операции делегирует в `Reflect`. Почему `receiver` решает, чем будет `this` в геттере, — там же.',
    href: '/js/proxy-reflect/',
    hrefLabel: 'Proxy и Reflect',
    tone: 'warn' as const,
  },
  {
    t: 'Что микрозадача выполняется до кадра',
    d: 'Очередь мини-Vue сливается в `Promise.resolve().then(…)`. Все промежуточные состояния между записями никто не увидит, потому что все микрозадачи выполняются до ближайшей отрисовки.',
    href: '/js/event-loop/#s3',
    hrefLabel: 'Event Loop · Checkpoint',
    tone: 'err' as const,
  },
];

// ---------------------------------------------------------------------------
// Раздел 1 · reactive
// ---------------------------------------------------------------------------

export const PLAIN_PROXY =
  'Прокси — секретарь у двери кабинета. Каждое «дай посмотреть» и «положи сюда» проходит через него. Сам он ничего не решает: просьбу выполняет хозяин кабинета (`Reflect`), а секретарь только записывает в журнал, кто о чём просил, — и звонит тем, кто просил посмотреть, когда что-то положили.';

/** Исполняется тестом как напечатано — и мини-версией, и Vue. */
export const RECEIVER_CODE = `const state = reactive({
  first: 'Ада',
  last: 'Лавлейс',
  get full() { return this.first + ' ' + this.last },
})
effect(() => log(state.full))   // 'Ада Лавлейс'
state.first = 'Августа'         // 'Августа Лавлейс' — эффект перезапустился`;

export const RECEIVER_NOTE =
  'Геттер `full` читает `this.first`. `Reflect.get(target, key, receiver)` вызывает его с `this`, равным прокси, и оба чтения внутри проходят через ловушку. Напишите вместо этого `target[key]` — и `this` станет исходным объектом: `full` прочитает `first` мимо прокси, зависимость не запишется, и запись в `first` эффект не разбудит. Сам механизм `receiver` — в [«Proxy и Reflect», раздел «Receiver и ответ set»](/js/proxy-reflect/#s3).';

export const CACHE_NOTE =
  '`reactiveMap` — `WeakMap` от исходного объекта к его прокси. Без неё каждое чтение `state.user` создавало бы новый прокси, и `state.user === state.user` было бы `false`. `WeakMap`, а не `Map`, чтобы запись о прокси не держала объект в памяти, когда он больше никому не нужен. Вложенный объект заворачивается **в момент чтения**: `reactive` над деревом в миллион узлов стоит одну обёртку, пока никто не пошёл вглубь.';

export const SET_NOTE =
  'Ловушка `set` сравнивает старое и новое значение через `Object.is` и молчит, если ничего не изменилось. Она же различает `\'add\'` — ключа не было — и `\'set\'`: от этого различия зависит, разбудит ли `trigger` тех, кто перебирал ключи. `toRaw(value)` на входе нужен, чтобы в исходный объект ложился исходный объект, а не прокси: иначе данные начали бы ссылаться на обёртки.';

// ---------------------------------------------------------------------------
// Раздел 2 · track / trigger
// ---------------------------------------------------------------------------

/** Форма таблицы — ровно то, что демо читает из `targetMap` в сценарии «ветка if». */
export const TABLE_SHAPE = `targetMap                              WeakMap: объект → его ключи
  { show: true, a: 1, b: 2 }  →  Map: ключ → Dep
      'show'       →  Dep { E }          version 0
      'a'          →  Dep { E }          version 0
      ITERATE_KEY  →  Dep { keys }       только если кто-то перебирал ключи`;

export const PLAIN_TABLE =
  'Картотека в библиотеке: ящик на каждую полку (объект), в ящике — карточка на каждую книгу (ключ), на карточке — список читателей (`Dep`). `track` вписывает в карточку того, кто сейчас сидит в читальном зале. `trigger` берёт карточку и обзванивает всех, кто в ней записан.';

export const ACTIVE_NOTE =
  '`activeEffect` — одна переменная на всю реализацию. Пуста — значит, чтение идёт не из эффекта, и `track` выходит на первой строке. Поэтому чтение в обработчике клика, в `setTimeout` и после `await` не создаёт зависимостей: не потому что это запрещено, а потому что в этот момент некого записать.';

export const BACKREF_NOTE =
  'Строка `activeEffect.deps.push(dep)` — вторая половина связи. Таблица отвечает на вопрос «кого будить по этому ключу», а список `deps` у эффекта — «откуда меня вычёркивать». Без обратной ссылки отписаться было бы нельзя: пришлось бы обходить всю таблицу, а `WeakMap` не обходится в принципе.';

export const ITERATE_NOTE =
  '`Object.keys`, `for…in` и спред не читают никакого конкретного ключа — ловушка `ownKeys` ключа не получает вовсе. Поэтому зависимость пишется на выдуманный ключ `ITERATE_KEY`, а `trigger` будит его подписчиков только при `\'add\'` и `\'delete\'`: смена значения существующего ключа набор ключей не меняет. Сверено тестом на мини-версии и на Vue: `state.a = 2` перебор не будит, `state.b = 1` и `delete state.a` — будят.';

export const NOTIFY_NOTE =
  '`notify` обходит **копию** подписчиков. Прогон эффекта вычёркивает его из того же `Set` и тут же вписывает обратно, а `Set` при обходе видит элементы, добавленные во время обхода, — и эффект попадает в обход второй раз. Здесь второй заход гасит `isDirty`: версии уже свежие. Без проверки версий, как в ранних реализациях, это вечный цикл — тест показывает его на варианте, где убраны и копия, и проверка. Два прохода — сначала `computed`, потом остальные — объяснены в разделе про `computed`.';

/**
 * Сквозной пример к `NOTIFY_NOTE`. Добавлено по решению автора курса (2026-09-29): абзац про
 * копию подписчиков сжимал в три фразы две страховки и цикл, который получается без обеих.
 * Здесь они разобраны на одной записи в `ref`. Все три исхода сняты тестом на сломанных
 * вариантах `MINI_VUE_CODE` (`tests/unit/vue-internals.test.ts`, «копия Set»): без копии —
 * два прохода обхода и один лишний заход, погашенный `isDirty`; без копии и без проверки
 * версий — обход не заканчивается (срабатывает предохранитель теста на 50 прогонах).
 */
export const NOTIFY_SCENE_CODE = `const r = ref(1)
effect(() => log(r.value))   // эффект E читает r → E в r.dep

r.value = 2                  // triggerDep(r.dep) → notify(r.dep)`;

export const NOTIFY_SCENE_NOTE =
  'Что будет, **если обходить живой `Set`** и будить каждого без вопросов. `notify` берёт `r.dep` — в нём один `E` — и запускает его. Запуск начинается с `cleanup(e)`: `E` вычеркнут из `r.dep`. Потом функция читает `r.value`, и `track` вписывает `E` обратно. Для `Set` это новый элемент, добавленный во время обхода, а такие обход обязан показать. Цикл снова встречает `E`, снова запускает — и снова вычёркивает и вписывает. Обход не кончается никогда: вкладка висит, и ни одной ошибки в консоли, потому что это не рекурсия, а обычный цикл.';

export const NOTIFY_STEPS: { k: string; when: string; what: string; cost: string }[] = [
  {
    k: 'Только проверка версий',
    when: 'второй заход обхода встречает `E` снова',
    what: '`wake` зовёт `isDirty(E)`. Версию `r.dep`, которую `E` видел, он запомнил на только что закончившемся прогоне — она совпадает с текущей. Вывод «ничего не изменилось», и `E` не запускается. Цикл остановлен, но второй заход был: тест на варианте без копии насчитывает у эффекта те же два прогона — на создании и на записи, — а лишний заход просто погашен.',
    cost: 'Проход по всем зависимостям `E` на каждом лишнем заходе — и полная зависимость от того, что проверка версий есть. Реализации без версий этой страховки не имеют.',
  },
  {
    k: 'Только копия',
    when: 'до обхода: `const list = [...subs]`',
    what: 'Обход идёт по массиву, снятому **до** первого запуска. Что `E` вычеркнул и вписал себя в `r.dep`, массиву всё равно: в нём `E` один раз, и второго захода нет вовсе.',
    cost: 'Новый массив на каждую запись, у которой есть подписчики. Для учебной версии — ничто, для фреймворка — лишняя память на каждом `trigger`; в 3.5 копий нет, связи живут в списках узлов `Link`.',
  },
  {
    k: 'Обе сразу — как в мини-версии',
    when: 'на каждой записи',
    what: 'Копия убирает повторный заход в обычном случае. Проверка версий страхует там, где эффект всё-таки встретился дважды, — например, когда до него дошли и через `computed`, и напрямую.',
    cost: 'Сумма двух цен выше. Настоящий Vue платит за ту же надёжность иначе — см. раздел «Что в Vue 3.5 иначе».',
  },
];

/** «На пальцах»: продолжение картотеки из `PLAIN_TABLE`. */
export const PLAIN_NOTIFY =
  'Та же картотека. Библиотекарь обзванивает читателей по карточке, а каждый, кому позвонили, сам вычёркивает себя из карточки и тут же вписывает в конец — «я всё ещё читаю». Если звонить по живой карточке, фамилия в конце никогда не кончится. Выхода два: переписать карточку на листок до первого звонка (копия) или перед звонком спрашивать «вы уже в курсе последнего издания?» (версия).';

// ---------------------------------------------------------------------------
// Раздел 3 · effect
// ---------------------------------------------------------------------------

export const PLAIN_CLEANUP =
  'Список покупок пишут заново перед каждым походом в магазин, а не дописывают к старому. Если на этой неделе торт не печём, яйца из списка пропадут сами — никому не придётся помнить, что их надо вычеркнуть.';

/** Исполняется тестом как напечатано — и мини-версией, и Vue. */
export const BRANCH_CODE = `const state = reactive({ show: true, a: 1, b: 2 })
effect(() => log(state.show ? state.a : state.b))   // 1
state.show = false   // 2 — теперь читается b, а не a
state.a++            // тишина: связь с a стёрта перед прошлым запуском
state.b++            // 3`;

export const CLEANUP_NOTE =
  'Зависимости — это то, что функция прочитала **в этот раз**. После `show = false` ветка с `a` не выполняется, и связь с `a` должна исчезнуть. Мини-версия добивается этого прямолинейно: перед каждым запуском вычёркивает эффект из всех его `Dep`, а выполнение вписывает заново только то, что понадобилось. Уберите строку `cleanup(e)` — и `state.a++` даст лишний прогон: тест проверяет это на сломанном варианте. Vue 3.5 делает то же дешевле — о разнице в разделе «Что в Vue 3.5 иначе».';

export const NESTED_NOTE =
  '`const prev = activeEffect` — это стек, спрятанный в стек вызовов. Внутренний эффект, созданный во время внешнего, займёт `activeEffect`, а по выходе вернёт его внешнему: чтения после вложенного вызова запишутся на того, кто их делает. Сверено тестом: запись в ключ, который внешний эффект прочитал **после** внутреннего, будит внешний — у мини-версии и у Vue одинаково.';

export const RECURSE_NOTE =
  'Флаг `running` закрывает самый короткий цикл: `effect(() => state.n++)` читает `n` и тут же пишет в него. Запись будит подписчиков `n`, среди них — сам эффект, но он ещё выполняется, и `wake` его пропускает. Vue делает то же флагом `RUNNING`; итог сверен тестом — один прогон на создании и один на внешней записи. Обратная сторона — эффект молча пропускает собственное изменение; как это выглядит на массиве — в [«Реактивности Vue», раздел «Жизнь эффекта»](/frameworks/vue-reactivity/#s5).';

// ---------------------------------------------------------------------------
// Раздел 4 · ref
// ---------------------------------------------------------------------------

export const PLAIN_REF =
  '`ref` — коробка с одной ячейкой и звонком. Открыл коробку — тебя записали; положили в неё новое — звонок звенит у всех записанных. Следить за самим числом нельзя, а за коробкой, в которой оно лежит, — можно.';

export const REF_NOTE =
  'Почему не прокси: `new Proxy(0, {})` бросает `TypeError`, да и у числа нет «личности», за которой можно следить. Коробка даёт её искусственно. Когда брать `ref`, а когда `reactive`, — в [«Реактивности Vue», раздел «Модель»](/frameworks/vue-reactivity/#s1).';

export const SHALLOW_NOTE =
  'Разница между `ref` и `shallowRef` — одна развилка в `createRef`: `ref` пропускает значение через `reactive`, `shallowRef` кладёт как есть. Отсюда поведение, сверенное тестом с Vue: `r.value.x++` будит читателей `ref`, но не `shallowRef` — у объекта внутри `shallowRef` нет прокси, и чтение `x` никто не записал. Будит только замена целиком: `sr.value = {…}`.';

// ---------------------------------------------------------------------------
// Раздел 5 · computed
// ---------------------------------------------------------------------------

export const PLAIN_COMPUTED =
  'Табло курса валют, которое пересчитывают, только когда кто-то подошёл посмотреть. Пришли новые котировки — табло не пересчитывается, на нём просто загорается «устарело». А если после пересчёта цифра вышла прежней, тех, кто ждёт у табло, не дёргают.';

export const LAZY_NOTE =
  'Когда источник меняется, `computed` не считает, а только ставит себе `dirty = true` и будит читателей. Считать будет `refresh` — в момент, когда кто-то прочтёт `.value`. Никто не прочёл — геттер не выполнится ни разу. Прочли дважды без изменений — выполнится один раз. Тест сверяет счётчик вызовов геттера с Vue: 0 после создания, 1 после двух чтений, по-прежнему 1 после записи в источник и 2 — после следующего чтения.';

export const VERSION_NOTE =
  'Эффект, читая `Dep`, запоминает его версию (`seen`). Перед перезапуском `isDirty` проходит по прочитанному: `computed` сначала досчитывает, потом сравнивает версии. Версия `computed` растёт, **только если новое значение отличается от старого**. Цепочка `price → total → pricey → E`: `price` меняется со 100 на 110, `total` пересчитан, `pricey` пересчитан и снова `false` — его версия прежняя, и `E` не выполняется. Так ведёт себя Vue с 3.4; раньше `E` перезапускался бы.';

export const GLITCH_NOTE =
  'Зачем `notify` два прохода. Эффект, читающий и `state.a`, и `computed` от него, может стоять в `Dep` первым. Разбуди его раньше, чем `computed` пометит себя устаревшим, — и он прочтёт старый кеш: выполнится с несогласованной парой, `a = 2` при `double = 2`. Такое промежуточное несогласованное состояние называют **глитчем**. Тест с одним проходом вместо двух ловит лишний прогон с парой `2 2`. В Vue 3.5 тот же порядок обеспечивает пакет: `computed` помечаются сразу, эффекты запускаются после.';

/**
 * Сквозной пример к `GLITCH_NOTE`. Добавлено по решению автора курса (2026-09-29): абзац про
 * два прохода `notify` вводил «глитч» и порядок пробуждения одной фразой, без того, как
 * это выглядит по шагам. Журнал без двух проходов — `1 2`, `2 2`, `2 4` — снят тестом
 * «два прохода notify» в `tests/unit/vue-internals.test.ts`, на том же коде. Путь с двумя
 * проходами прочитан по `STEP_TRACK` и `STEP_COMPUTED`.
 */
export const GLITCH_SCENE_CODE = `const s = reactive({ a: 1 })
const double = computed(() => s.a * 2)
effect(() => log(s.a + ' ' + double.value))   // '1 2'

s.a = 2`;

export const GLITCH_SCENE_NOTE =
  'Порядок подписчиков в `Dep` ключа `a` задаётся порядком чтений. Эффект прочитал `s.a` первым — и первым записан. `double` впервые посчитан уже внутри эффекта, поэтому его внутренний эффект стоит в `Dep` вторым. **Один проход в порядке записи** будит сначала эффект. Тот видит, что версия `a` выросла, и запускается. Читает `s.a` — это `2`. Читает `double.value` — а `double` ещё не знает, что источник изменился: его очередь не дошла, флага `dirty` нет, и он отдаёт кеш `2`. В журнал уходит `2 2` — пара, которой в данных не было ни мгновения. Потом просыпается `double`, помечает себя и будит эффект второй раз: `2 4`. Тест на варианте с одним проходом получает ровно `1 2`, `2 2`, `2 4`.';

export const GLITCH_STEPS: { k: string; when: string; what: string; cost: string }[] = [
  {
    k: 'Проход 1 — только `computed`',
    when: 'сразу после записи `s.a = 2`',
    what: 'Из списка берутся только эффекты, принадлежащие `computed`. У `double` срабатывает `scheduler`: он **не считает**, а ставит `dirty = true` и будит своих читателей. Эффект разбужен отсюда — но теперь, когда он прочтёт `double.value`, `refresh` увидит `dirty` и пересчитает: `4`. В журнал уходит `2 4`.',
    cost: 'Ничего лишнего: `double` посчитан один раз и ровно тогда, когда его прочли.',
  },
  {
    k: 'Проход 2 — остальные эффекты',
    when: 'после того, как все `computed` помечены',
    what: 'Обход доходит до того же эффекта, теперь уже как до прямого подписчика `a`. `isDirty` сравнивает версии: и `a`, и `double` эффект видел на прогоне, который только что закончился. Запуска нет.',
    cost: 'Второй проход по списку и одна проверка версий — вместо лишнего запуска с неверными данными.',
  },
];

/** «На пальцах»: продолжение табло из `PLAIN_COMPUTED`. */
export const PLAIN_GLITCH =
  'То же табло курса валют. Пришли новые котировки, и у стойки двое: кассир, который пересчитывает рубли по табло, и мастер, который вешает на табло «устарело». Позови первым кассира — он посчитает новую сумму по старой цифре на табло, и клиент получит чек, которого не должно было быть. Поэтому сначала мастер вешает табличку, и только потом зовут кассира: увидев «устарело», он дождётся свежей цифры.';

// ---------------------------------------------------------------------------
// Раздел 6 · планировщик
// ---------------------------------------------------------------------------

export const PLAIN_QUEUE =
  'Список дел на вечер: трижды за день вспомнил «вынести мусор» — в списке всё равно одна строка, и выносишь один раз. Разбирает список не тот, кто вписывал, а тот, кто придёт вечером, — микрозадача после текущего кода.';

export const QUEUE_FACTS = [
  {
    t: 'Дедупликация',
    d: '`queueJob` не ставит задание второй раз, пока оно ждёт. Три записи в `state.n` трижды будят эффект, трижды зовут `scheduler` — и оставляют в очереди одно задание. Поиск идёт с позиции `flushIndex + 1`: уже выполненное во время слива задание можно поставить снова, иначе запись из post-задания потерялась бы.',
  },
  {
    t: 'Сортировка по `id`',
    d: 'Задание встаёт по возрастанию `id`. В Vue `id` — номер компонента, а номера растут от родителя к детям: родитель обновляется раньше ребёнка, и ребёнок не рисуется дважды. В мини-версии компонентов нет, и `id` — порядок создания эффекта. Как компонент становится таким заданием — render-эффект экземпляра и патч виртуального DOM — в [«Vue 3 изнутри: рендерер и patch», раздел «Компонент»](/frameworks/vue-patch-internals/#s7).',
  },
  {
    t: 'Микрозадача',
    d: '`resolved.then(flushJobs)` — вся «асинхронность» Vue. Микрозадача выполняется после текущего синхронного кода и до отрисовки, поэтому промежуточные `n = 1` и `n = 2` не увидит никто.',
  },
  {
    t: '`nextTick`',
    d: 'Возвращает тот же промис, который сливает очередь, — `currentFlush`. Поэтому `await nextTick()` ждёт конца слива, а не «одного тика». Очереди нет — это просто уже выполненный промис.',
  },
];

export const SORT_WARN =
  '⚠️ **Вне компонента настоящий Vue заданий не сортирует.** У `watchEffect` без компонента `id` нет: `runtime-core` считает такие задания `id = -1`, и они идут в порядке записи. Мини-версия сортирует по порядку создания. Тест закрепляет это расхождение явно: записи `b`, потом `a` дают в Vue `B, A`, в мини-версии — `A, B`. Внутри компонентов, где `id` есть, оба сортируют.';

export const WATCH_NOTE =
  '`watch` собран из тех же частей: эффект с геттером и `scheduler`, который по режиму `flush` выполняет задание сразу (`\'sync\'`), ставит в основную очередь (`\'pre\'`) или в очередь после неё (`\'post\'`). Порядок `sync → pre → post → nextTick` сверен тестом с Vue. Разбор — в [«Vue 3 изнутри: watch, effectScope и computed 3.5», раздел о режимах flush](/frameworks/vue-watch-internals/#s3).';

// ---------------------------------------------------------------------------
// Раздел 7 · демо
// ---------------------------------------------------------------------------

export const DEMO_NOTE =
  'Подпись кнопки — это и есть выполняемая строка. Строка журнала помечена тем, кто был `activeEffect` в момент вызова `log`: `—` значит «вне эффектов». Пустой `Dep` в графе — не ошибка: мини-версия вычёркивает подписчиков, но не удаляет опустевшие ключи. Vue удаляет. Граф демо читает прямо из `targetMap` мини-версии — у настоящего Vue такого окна нет, а `onTrack` и `onTrigger` вырезаны из продакшен-сборки (подробнее — [«Реактивность Vue», раздел «Граф»](/frameworks/vue-reactivity/#s2)).';

export const MINI_SCENARIOS: MiniScenario[] = [
  {
    id: 'branch',
    label: 'ветка if',
    setup: `const state = reactive({ show: true, a: 1, b: 2 })
effect(function E() {
  log(state.show ? 'a = ' + state.a : 'b = ' + state.b)
})`,
    actions: ['state.a++', 'state.b++', 'state.show = !state.show'],
    note: 'Нажмите `state.show = !state.show` и посмотрите на `state.a`: подписчик `E` пропал, `Dep` остался пустым. Теперь `state.a++` не будит никого, хотя версия `Dep` всё равно растёт.',
  },
  {
    id: 'chain',
    label: 'цепочка computed',
    setup: `const state = reactive({ price: 100, qty: 1 })
const total = computed(function total() {
  log('total пересчитан')
  return state.price * state.qty
})
const pricey = computed(function pricey() {
  log('pricey пересчитан')
  return total.value > 150
})
effect(function E() {
  log(pricey.value ? 'дорого' : 'дёшево')
})`,
    actions: ['state.price += 10', 'state.qty++', 'state.price = 100'],
    note: '`state.price += 10` пересчитывает и `total`, и `pricey`, но `E` молчит: `pricey` снова `false`, его версия не выросла. `state.qty++` переводит `pricey` в `true` — и только тогда `E` выполняется. Пересчёт идёт в момент проверки `isDirty`, а не в момент записи.',
  },
  {
    id: 'batch',
    label: 'три записи — один flush',
    setup: `const state = reactive({ n: 0 })
watchEffect(function sync() { log('n = ' + state.n) }, { flush: 'sync' })
watchEffect(function render() { log('n = ' + state.n) })
watchEffect(function post() { log('n = ' + state.n) }, { flush: 'post' })`,
    actions: ['state.n++; state.n++; state.n++', 'state.n++', 'state.n = state.n'],
    note: 'Три записи подряд: `sync` выполняется трижды — прямо в строке записи, а `render` и `post` встают в очередь по одному разу и выполняются в микрозадаче, уже с последним значением. `state.n = state.n` не будит никого: `set` сравнивает значения.',
  },
  {
    id: 'keys',
    label: 'новый ключ',
    setup: `const state = reactive({ a: 1 })
effect(function keys() { log(Object.keys(state).join(', ')) })
effect(function readA() { log('a = ' + state.a) })`,
    actions: ['state.a++', 'state.b = 1', 'delete state.b'],
    note: '`keys` подписан на перебор, `readA` — на `state.a`. `state.a++` будит только `readA`: набор ключей не изменился. `state.b = 1` добавляет ключ и будит `keys`, но только в первый раз: повторное нажатие — запись того же значения.',
  },
];

// ---------------------------------------------------------------------------
// Раздел 8 · настоящий Vue
// ---------------------------------------------------------------------------

export const REAL_HEAD = ['что', 'мини-версия', 'Vue 3.5.42'];

export const REAL_ROWS: string[][] = [
  [
    'Связь эффекта и `Dep`',
    '`Set` подписчиков плюс массив `deps` у эффекта',
    'двусвязные списки узлов `Link`: один узел — одна пара «`Dep` × подписчик», вставленная сразу в два списка. Ни `Set`, ни массивов',
  ],
  [
    'Очистка перед запуском',
    'вычеркнуть всё, вписать заново',
    '`prepareDeps` метит связи версией `-1`, чтение подтверждает связь на месте, `cleanupDeps` удаляет неподтверждённые. Узлы переиспользуются: эффект, читающий то же, что в прошлый раз, ничего не аллоцирует',
  ],
  [
    'Опустевший `Dep`',
    'остаётся в `Map`',
    'удаляется из `depsMap`, когда уходит последний подписчик',
  ],
  [
    '`computed` без читателей',
    'подписан на источники навсегда',
    'подписан, только пока его самого кто-то читает. Проверено: у источника `computed`, прочитанного вне эффекта, подписчиков нет; после `stop` последнего читателя — снова нет',
  ],
  [
    'Быстрый путь `computed`',
    'нет',
    '`globalVersion` — счётчик всех изменений в системе. Не сдвинулся с прошлого пересчёта — `computed` не проверяет даже версии источников',
  ],
  [
    'Порядок пробуждения',
    'два прохода внутри одного `notify`',
    'пакет `startBatch`/`endBatch` со счётчиком глубины: эффекты копятся в список и запускаются, когда закончилась самая внешняя запись. Порядок подписчиков внутри одной записи — деталь, не контракт: Vue будит подписчиков перебора раньше подписчиков ключа, мини-версия — наоборот',
  ],
  [
    'Массивы, `Map`, `Set`',
    'не поддержаны',
    'ловушки для `length` и индексов, обёртки методов массива (`push` не подписывает), отдельный набор обработчиков для коллекций — пример ниже',
  ],
  [
    'Состояние эффекта',
    'поля `active`, `running`, `dirty`',
    'битовая маска `flags`: `RUNNING`, `DIRTY`, `NOTIFIED`, `ALLOW_RECURSE`, `PAUSED` и другие',
  ],
  [
    'Очередь',
    '`indexOf` и линейная вставка',
    'флаг `QUEUED` на задании и двоичный поиск места; задания `pre` без компонента идут по порядку записи',
  ],
  [
    '`readonly`, `shallowReactive`, `markRaw`, `effectScope`',
    'нет',
    'есть; `effectScope` собран своими руками в [«Vue 3 изнутри: watch, effectScope и computed 3.5»](/frameworks/vue-watch-internals/#s4)',
  ],
];

export const REAL_NOTE =
  'Первые пять строк — одна и та же мысль: мини-версия платит за простоту памятью: каждый прогон эффекта создаёт новые объекты, а связи живут дольше, чем нужны. Для учебной реализации это верный размен, для фреймворка — нет: 3.5 ради этого переписал ядро, и в анонсе релиза заявлена экономия памяти около 56% (не перемерено здесь — рядом нет 3.4 для сравнения). Узлы `Link`, версии и быстрый путь `computed` собраны своими руками в [«Vue 3 изнутри: watch, effectScope и computed 3.5», раздел про computed 3.5](/frameworks/vue-watch-internals/#s5).';

export const ALIEN_NOTE =
  '**Граница проверки.** Всё выше сверено с `@vue/reactivity` 3.5.42 — версией, которая лежит в проекте. В линии 3.6 ядро реактивности переписано на основе библиотеки alien-signals. Здесь это **не проверено запуском**: другой версии Vue в проекте нет, и утверждение подписано источником.';

/**
 * Раздел 8 · массивы и коллекции в настоящем Vue. Мини-версия их не поддерживает, поэтому
 * тест исполняет пример только на Vue — в обеих сборках — и сверяет вывод с `COLLECTIONS_LOG`.
 */
export const COLLECTIONS_CODE = `const m = reactive(new Map([['a', 1]]))
effect(() => log('get a = ' + m.get('a')))     // get a = 1
effect(() => log('size = ' + m.size))          // size = 1
effect(() => log('keys = ' + [...m.keys()]))   // keys = a
m.set('a', 2)   // size = 1, get a = 2 — size проснулся, хотя не изменился
m.set('b', 1)   // keys = a,b и size = 2 — get a молчит

const arr = reactive([1, 2, 3])
effect(() => log('arr[0] = ' + arr[0]))        // arr[0] = 1
effect(() => log('arr[2] = ' + arr[2]))        // arr[2] = 3
arr.length = 1  // arr[2] = undefined — arr[0] молчит`;

export const COLLECTIONS_LOG = [
  'get a = 1',
  'size = 1',
  'keys = a',
  'size = 1',
  'get a = 2',
  'keys = a,b',
  'size = 2',
  'arr[0] = 1',
  'arr[2] = 3',
  'arr[2] = undefined',
];

export const PLAIN_COLLECTIONS =
  'Обычный объект — шкаф с подписанными ящиками: вахтёр видит, в какой ящик полезли. `Map` — сейф с кнопками: снаружи видно только, что нажали кнопку «достать», а что достали — нет. Поэтому Vue не караулит сейф, а меняет на нём кнопки на свои: каждая, прежде чем сработать, записывает, кто и что просил.';

export const COLLECTIONS_NOTE =
  'У `Map` и `Set` нет ключей-свойств: `m.get(\'a\')` — это чтение свойства `get` и вызов метода, а вызов прокси не перехватывает. Поэтому у коллекций свой набор обработчиков: ловушка `get` отдаёт вместо настоящего метода обёртку (`m.get !== Map.prototype.get` — проверено), и уже она зовёт `track` и `trigger`. `get(k)` и `has(k)` подписывают на ключ `k`. `size`, `values()`, `entries()` и `forEach` — на перебор, и смена значения существующего ключа его будит: `values()` ведь увидит новое значение. `size` делит с ними ту же зависимость, отсюда лишний прогон с прежним `size = 1`. `keys()` подписан на отдельный перебор — только ключей, — и на смену значения не просыпается.';

export const COLLECTIONS_ARRAY_NOTE =
  'У массива ключи есть, это индексы, и работают обычные ловушки. Особый случай один — `length`: `arr.length = 1` будит подписчиков `length` и всех отрезанных индексов, поэтому `arr[2]` проснулся, а `arr[0]` нет. Почему `push` не подписывает эффект на `length` — в [«Реактивности Vue», раздел «Жизнь эффекта»](/frameworks/vue-reactivity/#s5).';

// ---------------------------------------------------------------------------
// Раздел 9 · тонкие места
// ---------------------------------------------------------------------------

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'Обход живого `Set` встречает эффект дважды',
    code: 'for (const e of dep) e.run()   // run вычёркивает e и вписывает снова',
    d: '`Set` при обходе видит элементы, добавленные во время обхода, — даже если их только что удалили. Эффект вычёркивается в `cleanup`, вписывается обратно при чтении, и цикл получает его снова. В мини-версии второй заход гасит проверка версий, но реализация без неё зацикливается: тест ставит эффекту предохранитель на 50 прогонов, и вариант без копии и без `isDirty` в него упирается. → обходить копию: `[...dep]`.',
    tone: 'err',
  },
  {
    n: '02',
    t: '`target[key]` вместо `Reflect.get(…, receiver)` ломает только геттеры',
    d: 'На обычных полях разницы нет, поэтому ошибка живёт, пока в состоянии не появится геттер. Тогда `this` внутри него — исходный объект, чтения идут мимо прокси, и эффект перестаёт реагировать на поля, от которых геттер зависит.',
    tone: 'warn',
  },
  {
    n: '03',
    t: 'Без кеша прокси `state.user !== state.user`',
    d: 'Зависимости при этом работают — они пишутся на исходный объект, — поэтому поломка не видна в эффектах. Ломается сравнение ссылок: `includes`, `indexOf`, ключ `Map` по объекту, `watch` на вложенный объект, который «меняется» на каждом чтении. Тест: без `reactiveMap` сравнение даёт `false`.',
    tone: 'err',
  },
  {
    n: '04',
    t: '`!==` вместо `Object.is` будит на каждом `NaN`',
    code: 'state.x = NaN\nstate.x = NaN   // NaN !== NaN — «изменилось»',
    d: 'Строгое неравенство считает `NaN` не равным самому себе, и запись того же `NaN` будит подписчиков каждый раз. `Object.is` это закрывает — и заодно различает `0` и `-0`. Сверено тестом: у мини-версии и у Vue повторный `NaN` тишина, сломанный вариант просыпается.',
  },
  {
    n: '05',
    t: 'Вложенный `effect` плодится на каждом прогоне внешнего',
    code: 'effect(() => {\n  state.a\n  effect(() => state.b)   // новый при каждом прогоне\n})',
    d: 'Прежний внутренний эффект никто не останавливает: он по-прежнему подписан на `b`. После одного перезапуска внешнего запись в `b` будит два внутренних, после двух — три. Так же и в Vue: тест сверяет число прогонов. В компоненте это закрывает область эффектов, вне компонента — только ваш `stop`.',
    tone: 'warn',
  },
  {
    n: '06',
    t: 'Сортировка по `id` без компонентов — не то, что делает Vue',
    d: 'Мини-версия сортирует задания по порядку создания эффекта; Vue вне компонента заданий `pre` не сортирует вовсе и выполняет их в порядке записи. Вывод про «родитель раньше ребёнка» верен только для компонентов, где `id` — номер экземпляра. Это учебное упрощение, а не поведение Vue.',
  },
];

// ---------------------------------------------------------------------------
// Раздел 10 · источники
// ---------------------------------------------------------------------------

export const SOURCES = [
  {
    title: '`@vue/reactivity` · `dep.ts`',
    href: 'https://github.com/vuejs/core/blob/main/packages/reactivity/src/dep.ts',
    what: '`Dep`, `Link`, `globalVersion`, `targetMap` и `trigger` — оригинал шагов про таблицу и версии.',
  },
  {
    title: '`@vue/reactivity` · `effect.ts`',
    href: 'https://github.com/vuejs/core/blob/main/packages/reactivity/src/effect.ts',
    what: '`prepareDeps`, `cleanupDeps`, `isDirty`, `refreshComputed`, `startBatch`/`endBatch` — то, что мини-версия делает проще.',
  },
  {
    title: '`@vue/reactivity` · `baseHandlers.ts`',
    href: 'https://github.com/vuejs/core/blob/main/packages/reactivity/src/baseHandlers.ts',
    what: 'Пять ловушек в полном виде: с массивами, `readonly`, `shallow` и проверкой `receiver`.',
  },
  {
    title: '`runtime-core` · `scheduler.ts`',
    href: 'https://github.com/vuejs/core/blob/main/packages/runtime-core/src/scheduler.ts',
    what: '`queueJob`, `getId`, двоичный поиск места, post-очередь и `nextTick`.',
  },
  {
    title: 'Vue · Reactivity in Depth',
    href: 'https://vuejs.org/guide/extras/reactivity-in-depth.html',
    what: 'Официальное объяснение с псевдокодом `track`/`trigger` — отправная точка мини-версии.',
  },
  {
    title: 'Announcing Vue 3.5',
    href: 'https://blog.vuejs.org/posts/vue-3-5',
    what: 'Переписанное ядро реактивности и заявленная экономия памяти — число подписано источником, не замером.',
  },
  {
    title: 'alien-signals',
    href: 'https://github.com/stackblitz/alien-signals',
    what: 'Библиотека, на основе которой переписано ядро в линии 3.6. Здесь не проверялась.',
  },
];

export const RELATED =
  'Смежное на сайте: [React изнутри](/frameworks/react-internals/) — вторая модель, тоже собранная своими руками: вместо таблицы зависимостей — сверка дерева и хуки как ячейки. [Реактивность Vue](/frameworks/vue-reactivity/) — то же поведение снаружи: живой граф на настоящем Vue, ловушки «почему не обновляется», режимы `flush` и `effectScope`. [Proxy и Reflect](/js/proxy-reflect/) — `Proxy`, `Reflect` и `receiver`, на которых стоит `reactive`. [Event Loop](/js/event-loop/#s3) — микрозадача, в которой сливается очередь. [Vue 3 изнутри: рендерер и patch](/frameworks/vue-patch-internals/) — что стоит после эффекта: виртуальный DOM, патч и компонент как задание. [Vue 3 изнутри: watch, effectScope и computed 3.5](/frameworks/vue-watch-internals/) — `watch` и области эффектов на той же реактивности, и узлы `Link` вместо `Set`. [React против Vue](/frameworks/react-vs-vue/) — чем модель «перезапусти прочитавших» отличается от модели React. [Vapor Mode во Vue](/frameworks/vue-vapor/) — во что компилируется шаблон, когда виртуального DOM нет, и как эффекты из этой темы пишут прямо в узлы. [Внедрение зависимостей](/frameworks/dependency-injection/) — `provide`/`inject` во Vue, контекст React и иерархия инжекторов Angular.';
