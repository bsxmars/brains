import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { PatchScenario } from '@/widgets/mini-patch/model/types';

/**
 * Данные темы «Vue 3 изнутри: рендерер и patch».
 *
 * Главное здесь — `MINI_PATCH_CODE`: мини-рендерер, разложенный на шаги `STEP_*`. Каждый шаг
 * печатается в теме `<CodeBlock code={STEP_…} />`, а склейка шагов — **та же самая строка** —
 * исполняется и демо (`widgets/mini-patch/model/run.ts` собирает её `new Function`), и тестом.
 * Копии нет: расхождение между напечатанным и исполняемым невозможно по построению.
 *
 * Рендерер пишет не в DOM, а в журналирующий хост `createLogHost` из той же строки. Хост
 * отдаёт ровно те имена операций, которые ждёт `createRenderer` из `@vue/runtime-core`,
 * поэтому тест кормит **один и тот же хост** настоящему рендереру Vue — и сравнивает
 * последовательности операций, а не пересказы.
 *
 * Что чем проверено (`tests/unit/vue-patch-internals.test.ts`, Node 26.8.2, Vue 3.5.42,
 * **обе** сборки `runtime-core` — продакшен и отладочная, выбранные подменой разрешения имён,
 * тем же приёмом, что `tests/unit/vue-internals.test.ts`):
 *
 *   - сценарии демо `PATCH_SCENARIOS` и 400 случайных пар списков дают **одинаковый журнал**
 *     хоста у мини-версии и у Vue — вплоть до порядка `insert`/`move`/`remove` и якорей;
 *   - таблица `MOVES_ROWS` пересчитывается тестом: число `move` у Vue, у мини-версии, «без LIS»
 *     и по правилу `lastPlacedIndex`;
 *   - `getSequence` сверен с переборной LIS на случайных массивах (длина и возрастание);
 *   - примеры `*_CODE` исполняются как напечатаны на обоих рендерерах, их журналы `*_LOG`
 *     сверены дословно;
 *   - `COMPILED_SAMPLE` — дословный вывод `@vue/compiler-dom` 3.5.42 на `TEMPLATE_SAMPLE`;
 *   - «без этой строки сломается» — сломанные варианты: подмена одной строки `MINI_PATCH_CODE`
 *     (LIS, обход справа налево, `patchFlag > 0`);
 *   - слоты подписывают эффект ребёнка, а не родителя — проверено **только на Vue**:
 *     мини-версия слотов не умеет;
 *   - дубликат ключа оставляет в хосте лишний узел в обеих сборках, предупреждение — только
 *     в отладочной.
 *
 * Намеренные отличия от Vue перечислены в `REAL_ROWS`; поведенчески видимое из них
 * (узлы без ключа в середине списка) закреплено тестом явно.
 */

// ---------------------------------------------------------------------------
// Мини-рендерер: шаги и склейка
// ---------------------------------------------------------------------------

/** Шаг 1: VNode, `h`, флаги формы и флаги патча, блоки. */
export const STEP_VNODE = `const Text = Symbol('Text')

// что за узел и что у него внутри — считается один раз, при создании
const ShapeFlags = { ELEMENT: 1, STATEFUL_COMPONENT: 4, TEXT_CHILDREN: 8, ARRAY_CHILDREN: 16 }

// что в узле может меняться — это знает только компилятор шаблона
const PatchFlags = {
  TEXT: 1, CLASS: 2, STYLE: 4, PROPS: 8, FULL_PROPS: 16,
  KEYED_FRAGMENT: 128, UNKEYED_FRAGMENT: 256,
  CACHED: -1,                      // отрицательный: «не сравнивать вовсе»
}

const blockStack = []
let currentBlock = null            // сюда складываются динамические узлы открытого блока

function createVNode(type, props = null, children = null, patchFlag = 0, dynamicProps = null, isBlock = false) {
  const vnode = {
    type,                          // 'li', Text или объект компонента
    props,
    children,                      // строка, массив VNode или null
    key: props && props.key != null ? props.key : null,
    shapeFlag: typeof type === 'string' ? ShapeFlags.ELEMENT
      : typeof type === 'object' ? ShapeFlags.STATEFUL_COMPONENT : 0,
    patchFlag,
    dynamicProps,                  // имена пропсов для PatchFlags.PROPS
    dynamicChildren: null,         // плоский список динамики, если узел — блок
    el: null,                      // узел хоста; появится при монтировании
    component: null,               // экземпляр, если type — компонент
  }
  if (Array.isArray(children)) {
    vnode.children = children.map((c) => (typeof c === 'object' ? c : createVNode(Text, null, String(c))))
    vnode.shapeFlag |= ShapeFlags.ARRAY_CHILDREN
  } else if (children != null) {
    vnode.children = String(children)
    vnode.shapeFlag |= ShapeFlags.TEXT_CHILDREN
  }
  // блок открыт, узел динамический — блок запомнит его в плоском списке
  const dynamic = patchFlag > 0 || vnode.shapeFlag & ShapeFlags.STATEFUL_COMPONENT
  if (currentBlock && dynamic && !isBlock) currentBlock.push(vnode)
  return vnode
}

function h(type, props, children) {
  return createVNode(type, props, children)
}

function openBlock() {
  blockStack.push((currentBlock = []))
}

// аргументы вычисляются раньше вызова: к этой строке все дети уже созданы
// и уже лежат в currentBlock
function createBlock(type, props, children, patchFlag, dynamicProps) {
  const vnode = createVNode(type, props, children, patchFlag, dynamicProps, true)
  vnode.dynamicChildren = currentBlock
  blockStack.pop()
  currentBlock = blockStack[blockStack.length - 1] || null
  if (currentBlock) currentBlock.push(vnode)   // для внешнего блока блок — динамический узел
  return vnode
}`;

/** Шаг 2а: хост, который пишет журнал вместо DOM. */
export const STEP_HOST = `function createLogHost() {
  const log = []
  let nextId = 0
  const node = (tag) => ({ id: nextId++, tag, text: '', props: {}, parent: null, children: [] })
  const name = (n) =>
    n.tag === '#text' ? JSON.stringify(n.text) : n.text ? n.tag + '(' + n.text + ')' : n.tag
  const write = (op, text) => log.push({ op, text: op + ' ' + text })
  const detach = (n) => {
    if (!n.parent) return
    n.parent.children.splice(n.parent.children.indexOf(n), 1)
    n.parent = null
  }

  const nodeOps = {
    createElement(tag) {
      write('createElement', tag)
      return node(tag)
    },
    createText(text) {
      const t = node('#text')
      t.text = text
      write('createText', JSON.stringify(text))
      return t
    },
    setText(t, text) {
      write('setText', name(t) + ' ← ' + JSON.stringify(text))
      t.text = text
    },
    setElementText(el, text) {
      write('setElementText', name(el) + ' ← ' + JSON.stringify(text))
      for (const c of el.children) c.parent = null   // как textContent: дети уходят
      el.children = []
      el.text = text
    },
    insert(child, parent, anchor = null) {
      // вставка узла, который уже стоит в документе, — это перемещение
      const op = child.parent ? 'move' : 'insert'
      write(op, name(child) + ' → ' + name(parent) + (anchor ? ', перед ' + name(anchor) : ', в конец'))
      detach(child)
      const at = anchor ? parent.children.indexOf(anchor) : parent.children.length
      parent.children.splice(at, 0, child)
      child.parent = parent
    },
    remove(child) {
      write('remove', name(child))
      detach(child)
    },
    patchProp(el, key, prev, next) {
      write('patchProp', name(el) + ' ' + key + ': ' + JSON.stringify(prev) + ' → ' + JSON.stringify(next))
      if (next == null) delete el.props[key]
      else el.props[key] = next
    },
    parentNode: (n) => n.parent,
    nextSibling: (n) => (n.parent ? n.parent.children[n.parent.children.indexOf(n) + 1] || null : null),
    createComment: () => node('#comment'),
  }

  const root = node('#root')
  const html = (n) =>
    n.tag === '#text' ? n.text
      : '<' + n.tag + '>' + (n.text || n.children.map(html).join('')) + '</' + n.tag + '>'
  return { nodeOps, root, log, html: () => root.children.map(html).join('') }
}`;

/** Шаг 2б: `patch` — развилка «тот же узел или другой», монтирование, `render`. */
export const STEP_PATCH = `const {
  insert: hostInsert, remove: hostRemove, patchProp: hostPatchProp,
  createElement: hostCreateElement, createText: hostCreateText,
  setText: hostSetText, setElementText: hostSetElementText,
  parentNode: hostParentNode, nextSibling: hostNextSibling,
} = options
const trace = options.trace || (() => {})   // окно для демо; в Vue такого нет

const isSameVNodeType = (n1, n2) => n1.type === n2.type && n1.key === n2.key

function patch(n1, n2, container, anchor = null, optimized = !!n2.dynamicChildren) {
  if (n1 === n2) return                   // тот же объект: закешированная статика
  if (n1 && !isSameVNodeType(n1, n2)) {   // другой тип или ключ — не сравниваем, а меняем
    anchor = getNextHostNode(n1)
    unmount(n1, true)
    n1 = null
  }
  const { type, shapeFlag } = n2
  if (type === Text) processText(n1, n2, container, anchor)
  else if (shapeFlag & ShapeFlags.ELEMENT) {
    if (n1 == null) mountElement(n2, container, anchor)
    else patchElement(n1, n2, optimized)
  } else if (shapeFlag & ShapeFlags.STATEFUL_COMPONENT) {
    if (n1 == null) mountComponent(n2, container, anchor)
    else updateComponent(n1, n2)
  }
}

function processText(n1, n2, container, anchor) {
  if (n1 == null) hostInsert((n2.el = hostCreateText(n2.children)), container, anchor)
  else {
    const el = (n2.el = n1.el)            // узел хоста переходит к новому VNode
    if (n2.children !== n1.children) hostSetText(el, n2.children)
  }
}

function mountElement(vnode, container, anchor) {
  const el = (vnode.el = hostCreateElement(vnode.type))
  if (vnode.shapeFlag & ShapeFlags.TEXT_CHILDREN) hostSetElementText(el, vnode.children)
  else if (vnode.shapeFlag & ShapeFlags.ARRAY_CHILDREN) mountChildren(vnode.children, el, null)
  if (vnode.props) {
    for (const key in vnode.props) if (key !== 'key') hostPatchProp(el, key, null, vnode.props[key])
  }
  hostInsert(el, container, anchor)       // в документ — последним, уже собранным
}

function mountChildren(children, container, anchor, start = 0) {
  for (let i = start; i < children.length; i++) patch(null, children[i], container, anchor)
}

function unmount(vnode, doRemove = false) {
  if (vnode.shapeFlag & ShapeFlags.STATEFUL_COMPONENT) return unmountComponent(vnode.component, doRemove)
  // дети уходят вместе с родителем: снимать каждого с хоста незачем
  if (vnode.shapeFlag & ShapeFlags.ARRAY_CHILDREN) unmountChildren(vnode.children)
  if (doRemove) hostRemove(vnode.el)
}

function unmountChildren(children, doRemove = false, start = 0) {
  for (let i = start; i < children.length; i++) unmount(children[i], doRemove)
}

function getNextHostNode(vnode) {
  if (vnode.shapeFlag & ShapeFlags.STATEFUL_COMPONENT) return getNextHostNode(vnode.component.subTree)
  return hostNextSibling(vnode.el)
}

function move(vnode, container, anchor) {
  if (vnode.shapeFlag & ShapeFlags.STATEFUL_COMPONENT) return move(vnode.component.subTree, container, anchor)
  hostInsert(vnode.el, container, anchor)
}

function render(vnode, container) {
  if (vnode == null) {
    if (container._vnode) unmount(container._vnode, true)
  } else patch(container._vnode || null, vnode, container)
  container._vnode = vnode                // следующий render сравнит с этим деревом
}`;

/** Шаг 3: дети — текст, массив без ключей, выбор алгоритма. */
export const STEP_CHILDREN = `function patchChildren(n1, n2, container, anchor) {
  const c1 = n1.children
  const c2 = n2.children
  const prevShape = n1.shapeFlag
  const { patchFlag, shapeFlag } = n2
  if (patchFlag > 0) {                    // > 0 обязательно: у CACHED (-1) все биты взведены
    if (patchFlag & PatchFlags.KEYED_FRAGMENT) return patchKeyedChildren(c1, c2, container, anchor)
    if (patchFlag & PatchFlags.UNKEYED_FRAGMENT) return patchUnkeyedChildren(c1, c2, container, anchor)
  }
  if (shapeFlag & ShapeFlags.TEXT_CHILDREN) {
    if (prevShape & ShapeFlags.ARRAY_CHILDREN) unmountChildren(c1)
    if (c2 !== c1) hostSetElementText(container, c2)
  } else if (prevShape & ShapeFlags.ARRAY_CHILDREN) {
    // массив на массив без подсказки компилятора — всегда алгоритм с ключами,
    // даже если ключей нет: тогда у всех key === null, и они «совпадают»
    if (shapeFlag & ShapeFlags.ARRAY_CHILDREN) patchKeyedChildren(c1, c2, container, anchor)
    else unmountChildren(c1, true)
  } else {
    if (prevShape & ShapeFlags.TEXT_CHILDREN) hostSetElementText(container, '')
    if (shapeFlag & ShapeFlags.ARRAY_CHILDREN) mountChildren(c2, container, anchor)
  }
}

// v-for без :key — сверка по позиции
function patchUnkeyedChildren(c1, c2, container, anchor) {
  const common = Math.min(c1.length, c2.length)
  for (let i = 0; i < common; i++) patch(c1[i], c2[i], container, null)
  if (c1.length > c2.length) unmountChildren(c1, true, common)   // лишние старые — удалить
  else mountChildren(c2, container, anchor, common)              // лишние новые — добавить
}`;

/** Шаг 4а: дети с ключами — полный алгоритм. */
export const STEP_KEYED = `function patchKeyedChildren(c1, c2, container, parentAnchor) {
  let i = 0
  let e1 = c1.length - 1                  // конец старого списка
  let e2 = c2.length - 1                  // конец нового

  // 1. с начала: пока ключи совпадают, патчим на месте
  while (i <= e1 && i <= e2 && isSameVNodeType(c1[i], c2[i])) {
    patch(c1[i], c2[i], container, null)
    trace('head', { i })
    i++
  }
  // 2. с конца — так же
  while (i <= e1 && i <= e2 && isSameVNodeType(c1[e1], c2[e2])) {
    patch(c1[e1], c2[e2], container, null)
    trace('tail', { e1, e2 })
    e1--
    e2--
  }

  if (i > e1) {
    // 3. старый кончился: остаток нового — смонтировать перед первым сохранённым хвостом
    const anchor = e2 + 1 < c2.length ? c2[e2 + 1].el : parentAnchor
    for (; i <= e2; i++) {
      patch(null, c2[i], container, anchor)
      trace('mount', { index: i })
    }
  } else if (i > e2) {
    // 4. новый кончился: остаток старого — удалить
    for (; i <= e1; i++) {
      unmount(c1[i], true)
      trace('unmount', { index: i })
    }
  } else {
    // 5. середина — неизвестная перестановка
    const s = i
    const keyToNewIndex = new Map()
    for (let k = s; k <= e2; k++) if (c2[k].key != null) keyToNewIndex.set(c2[k].key, k)

    const toBePatched = e2 - s + 1
    const newIndexToOldIndex = new Array(toBePatched).fill(0)   // 0 — узла в старом не было
    let moved = false
    let maxNewIndexSoFar = 0
    let patched = 0

    for (let k = s; k <= e1; k++) {
      const prev = c1[k]
      const newIndex = patched < toBePatched ? keyToNewIndex.get(prev.key) : undefined
      if (newIndex === undefined) {       // в новом списке его нет
        unmount(prev, true)
        trace('unmount', { index: k })
        continue
      }
      newIndexToOldIndex[newIndex - s] = k + 1   // +1: ноль уже занят под «новый»
      if (newIndex >= maxNewIndexSoFar) maxNewIndexSoFar = newIndex
      else moved = true                   // пошли назад — порядок нарушен
      patch(prev, c2[newIndex], container, null)
      patched++
      trace('match', { index: k, newIndex })
    }

    // кто входит в наибольшую возрастающую подпоследовательность — стоит правильно
    const seq = moved ? getSequence(newIndexToOldIndex) : []
    trace('lis', { s, map: newIndexToOldIndex.slice(), seq: seq.slice(), moved })

    let j = seq.length - 1
    // справа налево: якорь — правый сосед, который уже стоит на своём месте
    for (let k = toBePatched - 1; k >= 0; k--) {
      const index = s + k
      const anchor = index + 1 < c2.length ? c2[index + 1].el : parentAnchor
      if (newIndexToOldIndex[k] === 0) {
        patch(null, c2[index], container, anchor)
        trace('mount', { index })
      } else if (moved) {
        if (j < 0 || k !== seq[j]) {
          move(c2[index], container, anchor)
          trace('move', { index })
        } else {
          j--
          trace('stay', { index })
        }
      }
    }
  }
}`;

/** Шаг 4б: наибольшая возрастающая подпоследовательность — как в Vue. */
export const STEP_LIS = `// индексы элементов arr, образующих наибольшую возрастающую подпоследовательность;
// нули («узел новый») пропускаются. O(n log n): жадный хвост плюс двоичный поиск
function getSequence(arr) {
  const p = arr.slice()                   // p[i] — предшественник i в лучшей цепочке
  const result = [0]                      // result[len] — индекс наименьшего хвоста длины len+1
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i]
    if (v === 0) continue
    const last = result[result.length - 1]
    if (arr[last] < v) {                  // продлевает самую длинную цепочку
      p[i] = last
      result.push(i)
      continue
    }
    let lo = 0
    let hi = result.length - 1
    while (lo < hi) {                     // первый хвост, который не меньше v
      const mid = (lo + hi) >> 1
      if (arr[result[mid]] < v) lo = mid + 1
      else hi = mid
    }
    if (v < arr[result[lo]]) {
      if (lo > 0) p[i] = result[lo - 1]
      result[lo] = i                      // хвост той же длины, но меньше — лучше
    }
  }
  // result хранит хвосты, а не цепочку: восстановить её по предшественникам
  let n = result.length
  let last = result[n - 1]
  while (n-- > 0) {
    result[n] = last
    last = p[last]
  }
  return result
}`;

/** Шаг 5: флаги патча и блоки. */
export const STEP_FLAGS = `function patchElement(n1, n2, optimized) {
  const el = (n2.el = n1.el)
  const oldProps = n1.props || {}
  const newProps = n2.props || {}
  const { patchFlag, dynamicChildren } = n2

  if (dynamicChildren) patchBlockChildren(n1.dynamicChildren, dynamicChildren)   // только динамика
  else if (!optimized) patchChildren(n1, n2, el, null)                            // полный обход

  if (patchFlag > 0) {
    // компилятор назвал, что здесь может меняться, — проверяем только это
    if (patchFlag & PatchFlags.FULL_PROPS) patchProps(el, oldProps, newProps)
    else {
      if (patchFlag & PatchFlags.CLASS && oldProps.class !== newProps.class) {
        hostPatchProp(el, 'class', null, newProps.class)
      }
      if (patchFlag & PatchFlags.STYLE) hostPatchProp(el, 'style', oldProps.style, newProps.style)
      if (patchFlag & PatchFlags.PROPS) {
        for (const key of n2.dynamicProps) {
          if (newProps[key] !== oldProps[key]) hostPatchProp(el, key, oldProps[key], newProps[key])
        }
      }
    }
    if (patchFlag & PatchFlags.TEXT && n1.children !== n2.children) hostSetElementText(el, n2.children)
  } else if (!optimized && dynamicChildren == null) {
    patchProps(el, oldProps, newProps)    // флага нет — сравнить все пропсы
  }
}

function patchProps(el, oldProps, newProps) {
  if (oldProps === newProps) return
  for (const key in oldProps) {
    if (key !== 'key' && !(key in newProps)) hostPatchProp(el, key, oldProps[key], null)
  }
  for (const key in newProps) {
    if (key !== 'key' && newProps[key] !== oldProps[key]) hostPatchProp(el, key, oldProps[key], newProps[key])
  }
}

// статики в списке нет: он собран при создании дерева, пара к паре по индексу
function patchBlockChildren(oldChildren, newChildren) {
  for (let i = 0; i < newChildren.length; i++) {
    const o = oldChildren[i]
    patch(o, newChildren[i], hostParentNode(o.el), null, true)
  }
}`;

/** Шаг 6а: очередь заданий — самая короткая, подробно она разобрана в другой теме. */
export const STEP_QUEUE = `const queue = new Set()
let flushing = null

function queueJob(job) {
  queue.add(job)                          // Set: второй раз то же задание не встанет
  flushing ||= Promise.resolve().then(flushJobs)
}

function flushJobs() {
  const jobs = [...queue].sort((a, b) => a.id - b.id)   // родитель раньше ребёнка
  queue.clear()
  flushing = null
  for (const job of jobs) job()
}

function nextTick() {
  return flushing || Promise.resolve()
}`;

/** Шаг 6б: компонент — эффект, который перерисовывает своё поддерево. */
export const STEP_COMPONENT = `let uid = 0

function mountComponent(vnode, container, anchor) {
  const { type } = vnode
  const instance = (vnode.component = {
    uid: uid++, vnode, next: null, subTree: null, isMounted: false,
    props: shallowReactive(pickProps(type, vnode.props)),
  })
  const renderFn = type.setup(instance.props)   // setup — один раз; рендер — сколько угодно

  const componentUpdate = () => {
    if (instance.next) {                  // родитель прислал новый VNode: обновить props
      instance.vnode = instance.next
      instance.next = null
      Object.assign(instance.props, pickProps(type, instance.vnode.props))
    }
    const prevTree = instance.subTree
    const nextTree = (instance.subTree = renderFn())   // чтения здесь — подписки эффекта
    if (!instance.isMounted) {
      patch(null, nextTree, container, anchor)
      instance.isMounted = true
    } else patch(prevTree, nextTree, hostParentNode(prevTree.el), getNextHostNode(prevTree))
    instance.vnode.el = nextTree.el
  }

  // запись в прочитанное не рисует сразу, а ставит задание в очередь
  const runner = effect(componentUpdate, { scheduler: () => queueJob(job) })
  const job = () => runner.effect.dirty && runner()   // Vue: effect.runIfDirty
  job.id = instance.uid
  instance.update = runner
}

function updateComponent(n1, n2) {
  const instance = (n2.component = n1.component)
  if (propsChanged(n1.props, n2.props)) {
    instance.next = n2
    instance.update()                     // сразу, внутри patch родителя
  } else {
    n2.el = n1.el                         // пропсы те же — поддерево не трогаем
    instance.vnode = n2
  }
}

function unmountComponent(instance, doRemove) {
  instance.update.effect.stop()           // эффект больше не подписан ни на что
  unmount(instance.subTree, doRemove)
}

function pickProps(type, raw) {
  const props = {}
  for (const key of type.props || []) props[key] = raw ? raw[key] : undefined
  return props
}

function propsChanged(prev, next) {
  prev = prev || {}
  next = next || {}
  const keys = Object.keys(next)
  if (keys.length !== Object.keys(prev).length) return true
  return keys.some((key) => next[key] !== prev[key])
}`;

export const STEP_EXPORT = `return {
  createRenderer, createLogHost, h, createVNode, openBlock, createBlock, nextTick,
  Text, ShapeFlags, PatchFlags, getSequence,
}`;

export const MINI_PATCH_CODE = [
  STEP_VNODE,
  STEP_HOST,
  STEP_LIS,
  STEP_QUEUE,
  'function createRenderer(options) {',
  STEP_PATCH,
  STEP_CHILDREN,
  STEP_KEYED,
  STEP_FLAGS,
  STEP_COMPONENT,
  'return { render }',
  '}',
  STEP_EXPORT,
].join('\n\n');

/** Каркас склейки: шаги рендерера живут внутри `createRenderer` и видят хост через замыкание. */
export const RENDERER_SHAPE = `function createRenderer(options) {
  // STEP_PATCH     patch, mountElement, unmount, move, render
  // STEP_CHILDREN  patchChildren, patchUnkeyedChildren
  // STEP_KEYED     patchKeyedChildren
  // STEP_FLAGS     patchElement, patchProps, patchBlockChildren
  // STEP_COMPONENT mountComponent, updateComponent
  return { render }
}`;

// ---------------------------------------------------------------------------
// Вводный раздел · словарь
// ---------------------------------------------------------------------------

export const INTRO_NOTE =
  'Шаблон Vue каждый раз строит новое дерево обычных объектов, а в DOM попадает только разница между новым деревом и прошлым. Разницу ищет `patch`: тот же тип и ключ — сверить пропсы и детей, иначе — снять и поставить заново. Для списков с ключами он ищет наибольшую возрастающую подпоследовательность, чтобы переставить как можно меньше узлов, а подсказки компилятора позволяют не сравнивать то, что измениться не может. Ниже всё это написано руками и сверено с настоящим рендерером Vue 3.5 по журналу операций.';

export const PLAIN_INTRO =
  'Ремонт по чертежу. Прораб не сносит квартиру, когда заказчик приносит новый план, — он кладёт старый чертёж рядом с новым и составляет список работ: эту стену не трогать, эту дверь перенести, здесь добавить розетку. Виртуальное дерево — чертёж, `patch` — сравнение чертежей, а журнал операций хоста — тот самый список работ. Чем короче список, тем дешевле ремонт.';

export const GLOSSARY = [
  {
    k: 'VNode · виртуальный узел',
    d: 'Обычный объект, описывающий один узел будущего дерева: тип, пропсы, дети, ключ. Дёшев в создании и выбрасывается после сравнения; ссылку на настоящий узел держит его поле `el`.',
  },
  {
    k: 'хост',
    d: 'То, во что рендерер в итоге пишет: DOM в браузере, холст, терминал — или, как здесь, журнал. Рендерер обращается к хосту только через десяток функций: создать, вставить, удалить, поменять текст, поменять свойство.',
  },
  {
    k: '`patch`',
    d: 'Функция, которая получает старый и новый VNode и приводит хост от первого ко второму. Старого нет — монтирует, нового нет — снимает, оба есть — сравнивает.',
  },
  {
    k: 'ключ (`key`)',
    d: 'Метка, по которой рендерер узнаёт «тот же» узел в новом списке. Без ключа узлы сопоставляются по позиции, с ключом — по имени, где бы он ни оказался.',
  },
  {
    k: 'возрастающая подпоследовательность',
    d: 'Числа, выбранные из последовательности с сохранением порядка так, что каждое следующее больше предыдущего. В `[5, 3, 4, 0]` это, например, `3, 4`. Наибольшая — самая длинная из возможных; по-английски LIS.',
  },
  {
    k: 'битовый флаг',
    d: 'Число, в котором каждый двоичный разряд — отдельный признак: `1` — текст, `2` — класс, `8` — пропсы. Несколько признаков складываются через `|`, проверяются через `&`. Одна проверка — одна машинная операция.',
  },
  {
    k: 'компилятор шаблона',
    d: 'Часть Vue, превращающая `<template>` в функцию рендера. Он видит, какие места шаблона зависят от данных, и оставляет рендереру подсказки — флаги патча.',
  },
  {
    k: 'эффект',
    d: 'Функция, которую реактивность перезапускает, когда меняется прочитанное ею. Рендер компонента — один такой эффект; устройство разобрано в [«Vue 3 изнутри: своя реактивность»](/frameworks/vue-internals/#s3).',
  },
];

// ---------------------------------------------------------------------------
// Перед началом
// ---------------------------------------------------------------------------

export const PREREQ_NOTE =
  'Тема начинается там, где реактивность заканчивается: эффект компонента проснулся и вызвал рендер. Как он проснулся и почему один раз на три записи — известно; здесь — что рендер делает с деревом.';

export const PREREQ = [
  {
    t: 'Что рендер компонента — это эффект, а обновление идёт через очередь',
    d: 'Эффект записывает прочитанное и перезапускается от записи; `scheduler` ставит задание в очередь, которая разбирается в микрозадаче.',
    href: '/frameworks/vue-internals/',
    hrefLabel: 'Vue 3 изнутри: своя реактивность',
    tone: 'info' as const,
  },
  {
    t: 'Как реактивность Vue выглядит снаружи',
    d: '`ref`, `reactive`, `computed`, режимы `flush` — и почему компонент перерисовывается не от каждой записи.',
    href: '/frameworks/vue-reactivity/',
    hrefLabel: 'Реактивность Vue',
    tone: 'warn' as const,
  },
  {
    t: 'Что React решает ту же задачу сверкой списков',
    d: 'У React тоже есть ключи и перестановка детей, но по другому правилу — `lastPlacedIndex`. Сравнение двух правил стоит в разделе про ключи.',
    href: '/frameworks/react-internals/#s4',
    hrefLabel: 'React изнутри · Сверка',
    tone: 'err' as const,
  },
];

// ---------------------------------------------------------------------------
// Раздел 1 · VNode
// ---------------------------------------------------------------------------

export const PLAIN_VNODE =
  'VNode — карточка из каталога вместо самой мебели. На карточке написано «стул, дуб, место 3». Переписать карточку ничего не стоит; двигать настоящий стул — стоит. Поэтому рендерер сначала сравнивает карточки и только потом, по списку отличий, трогает мебель.';

/** Исполняется тестом как напечатано — и мини-версией, и Vue. */
export const VNODE_CODE = `const v = h('li', { key: 'a', class: 'item' }, 'A')
log(v.key, v.shapeFlag, v.patchFlag, v.el)`;

/** Что печатает `VNODE_CODE`: у мини-версии и у Vue — одно и то же. */
export const VNODE_LOG = `a 9 0 null`;

export const SHAPE_NOTE =
  '`shapeFlag` — «что это за узел и что у него внутри», сложенное в одно число при создании. У `li` с текстом это `9`: `ELEMENT` (1) плюс `TEXT_CHILDREN` (8). Дальше `patch` не выясняет каждый раз, строка ли `children` и массив ли, а проверяет бит: `shapeFlag & ShapeFlags.ARRAY_CHILDREN`. Значения — те же, что в Vue.';

export const KEY_NOTE =
  '`key` вынимается из пропсов при создании и в хост не попадает никогда: `mountElement` пропускает его, а сравнение узлов идёт по паре `type` + `key`. Ключ — служебная метка для рендерера, а не атрибут элемента.';

export const EL_NOTE =
  '`el` пуст, пока узел не смонтирован. При сравнении новый VNode забирает `el` у старого — `n2.el = n1.el`, — и старое дерево можно выбросить. Так виртуальные узлы живут один рендер, а настоящие — сколько угодно.';

export const BLOCK_TEASER =
  '`openBlock`, `createBlock` и `patchFlag` в том же шаге нужны компилятору шаблона; до раздела «Флаги и блоки» они не используются — `h` создаёт узлы без флагов.';

// ---------------------------------------------------------------------------
// Раздел 2 · mount и patch
// ---------------------------------------------------------------------------

export const PLAIN_HOST =
  'Рендерер — повар, хост — кухня. Повар знает рецепт, но не знает, газовая плита или индукция: он говорит «нагреть», «положить», «убрать», а кухня выполняет. Поставь другую кухню — рецепт тот же. Здесь кухня вместо того, чтобы готовить, записывает каждую команду в тетрадь.';

export const HOST_NOTE =
  'Это полный набор, который нужен рендереру: DOM-версия в Vue (`runtime-dom`, файл `nodeOps.ts`) — те же функции поверх `document.createElement` и `insertBefore`. Одна деталь переносит смысл DOM в журнал: `insert` уже вставленного узла пишется как `move`. В DOM это одна и та же функция `insertBefore`, и различить вставку и перестановку можно только так. Подмени эти функции — и тот же `createRenderer` рисует на холсте, в терминале или в нативных виджетах: рендерер не знает, куда пишет.';

/** Исполняется тестом как напечатано — и мини-версией, и Vue. */
export const MOUNT_CODE = `const host = createLogHost()
const { render } = createRenderer(host.nodeOps)

render(h('div', null, [h('p', null, 'раз'), h('span', null, 'два')]), host.root)
host.log.length = 0

render(h('div', null, [h('p', null, 'раз!'), h('b', null, 'два')]), host.root)
log(host.log.map((e) => e.text).join('\\n'))`;

/** Журнал второго `render` из `MOUNT_CODE`. */
export const MOUNT_LOG = `setElementText p(раз) ← "раз!"
remove span(два)
createElement b
setElementText b ← "два"
insert b(два) → div, в конец`;

export const SAME_TYPE_NOTE =
  '`p` остался `p` — сверяются пропсы и текст, и в хост уходит одна операция. `span` стал `b` — сравнивать нечего: разные теги не превращаются друг в друга, поэтому старый узел снимается, а новый монтируется **на его место**. Место запоминается заранее: `getNextHostNode(n1)` берёт правого соседа старого узла до того, как тот исчезнет.';

export const INSERT_LAST_NOTE =
  '`mountElement` вставляет элемент в хост **последней** операцией: сначала создать, заполнить текстом или детьми, выставить пропсы — и только потом `insert`. Для DOM это значит, что поддерево собирается вне документа и попадает в него целиком, одной вставкой.';

export const UNMOUNT_NOTE =
  'Снятие поддерева — одна операция `remove`, сколько бы детей в нём ни было: дети уходят вместе с родителем. Но обход `unmount` по детям всё равно идёт — с `doRemove = false`: в хосте делать нечего, а компоненту внутри надо остановить свой эффект.';

// ---------------------------------------------------------------------------
// Раздел 3 · дети без ключей
// ---------------------------------------------------------------------------

export const PLAIN_KEY =
  'Гардероб с номерками против гардероба «по порядку». С номерками пальто находится, как бы ни перемешали вешалки. Без номерков гардеробщик выдаёт с первой вешалки первому в очереди — и если очередь встала иначе, пальто достанется не тому, хотя все вешалки на месте.';

/** Исполняется тестом как напечатано — и мини-версией, и Vue. `256` — `UNKEYED_FRAGMENT`. */
export const UNKEYED_CODE = `const host = createLogHost()
const { render } = createRenderer(host.nodeOps)
const list = (keys) =>
  createVNode('ul', null, keys.map((k) => h('li', null, k)), 256 /* UNKEYED_FRAGMENT */)

render(list(['A', 'B', 'C']), host.root)
const first = host.root.children[0].children[0]
host.log.length = 0

render(list(['C', 'A', 'B']), host.root)
log(host.log.map((e) => e.text).join('\\n'))
log('первый узел хоста тот же:', host.root.children[0].children[0] === first)`;

export const UNKEYED_LOG = `setElementText li(A) ← "C"
setElementText li(B) ← "A"
setElementText li(C) ← "B"
первый узел хоста тот же: true`;

export const UNKEYED_NOTE =
  'Ни одного перемещения, три перезаписи текста — и все три узла хоста остались на своих местах. Для текста это даже дешевле. Но у узла хоста бывает своё состояние, которого нет в VNode: введённое в поле, фокус, прокрутка, запущенная анимация, состояние компонента. Оно остаётся на позиции, а данные уезжают: строка «C» теперь стоит там, где был набран текст для «A».';

export const NOKEY_NOTE =
  '**`patchUnkeyedChildren` вызывается только по флагу компилятора** — его ставит `v-for` без `:key`. Массив, собранный через `h` без флагов, всегда идёт в `patchKeyedChildren`, даже без ключей: у всех `key === null`, `isSameVNodeType` считает соседей одинаковыми, и синхронизация с начала сопоставит их по позиции. Журнал выходит тот же, что выше, — тест сверяет оба пути на обоих рендерерах.';

export const INDEX_KEY_NOTE =
  '⚠️ **`:key="index"` — это отсутствие ключа, записанное длиннее.** Индекс совпадает у старого и нового элемента на той же позиции, значит сопоставление снова идёт по позиции — с тем же переездом данных при сохранённом состоянии узла. Ключ обязан принадлежать данным: `id` записи, а не номер строки.';

// ---------------------------------------------------------------------------
// Раздел 4 · дети с ключами
// ---------------------------------------------------------------------------

export const SYNC_NOTE =
  'Синхронизация с краёв — ставка на то, как на самом деле меняются списки: добавили в конец, удалили из начала, отредактировали одну строку. В таких случаях общий префикс и суффикс съедают почти весь список, и до карты ключей дело не доходит. Если после краёв старый список кончился — остаток нового монтируется (шаг 3), кончился новый — остаток старого удаляется (шаг 4). Ни `Map`, ни LIS не создаются.';

export const MAP_NOTE =
  'В середине порядок неизвестен. `keyToNewIndex` отвечает «где ключ стоит в новом», и один проход по старому находит каждому узлу пару — или удаляет его. `newIndexToOldIndex` — обратное: для каждой позиции новой середины — откуда пришёл узел, со сдвигом на единицу, потому что ноль занят под «такого не было». `moved` взводится, как только старые узлы встретились не по возрастанию новых индексов: если ни разу — перемещать не нужно никого, и LIS не считается вовсе.';

/** Разбор канонического примера из исходников Vue — числа сверены тестом с трассой `patchKeyedChildren`. */
export const KEYED_WALK = `старый:  A B [C D E] F G          i = 2 — A, B совпали с начала
новый:   A B [E C D H] F G        e1 = 4, e2 = 5 — F, G совпали с конца

keyToNewIndex       { E: 2, C: 3, D: 4, H: 5 }
C: старый 2 → новый 3             newIndexToOldIndex[1] = 3
D: старый 3 → новый 4             newIndexToOldIndex[2] = 4
E: старый 4 → новый 2             newIndexToOldIndex[0] = 5, 2 < 4 — moved
                                  newIndexToOldIndex = [5, 3, 4, 0]

LIS по значениям 5, 3, 4 (нуль пропускается): 3, 4 → позиции C и D
справа налево:  H — 0, новый: смонтировать перед F
                D, C — в LIS: не трогать
                E — не в LIS: переставить перед C`;

/** Журнал того же примера — у мини-версии и у Vue дословно. */
export const KEYED_LOG = `createElement li
setElementText li ← "H"
insert li(H) → ul, перед li(F)
move li(E) → ul, перед li(C)`;

export const PLAIN_LIS =
  'Книги на полке стоят почти по порядку, но несколько перепутаны. Можно снять все и расставить заново, а можно найти самую длинную цепочку, которая уже идёт по порядку, оставить её стоять и переставить только остальные. LIS и есть эта цепочка: чем она длиннее, тем меньше книг придётся взять в руки.';

export const LIS_NOTE =
  'Узлы, чьи старые индексы образуют возрастающую подпоследовательность, **уже стоят друг относительно друга правильно** — достаточно подвинуть остальных вокруг них. Наибольшая такая подпоследовательность даёт наименьшее число перемещений. `getSequence` — классический алгоритм за `O(n log n)`: массив «наименьший хвост цепочки каждой длины», двоичный поиск места и восстановление цепочки по ссылкам на предшественника. Причуда, перенесённая из Vue как есть: `result` стартует с `[0]`, поэтому «новый узел» (ноль) на позиции 0 остаётся в цепочке. Вреда нет — до позиции 0 проход доходит последним и монтирует её, не глядя в LIS.';

export const BACKWARD_NOTE =
  '**Почему проход справа налево.** `insert` ставит узел **перед** якорем, а якорь — правый сосед по новому списку. Идя с конца, рендерер берёт в якоря узлы, которые уже стоят на своих местах: либо хвост, синхронизированный на шаге 2, либо только что поставленный узел. Пройди слева направо — и якорем окажется узел, до которого очередь ещё не дошла.';

/**
 * Сквозной пример к LIS — середина из `KEYED_WALK`. Добавлено по решению автора курса
 * (2026-09-29): `LIS_NOTE` вводил в одном абзаце «наибольшую возрастающую подпоследовательность»,
 * «наименьший хвост», двоичный поиск и предшественников, а разницу между стратегиями давала
 * только таблица чисел. Здесь три стратегии разобраны на одной середине, а `getSequence` —
 * по шагам. Что проверено чем: `newIndexToOldIndex = [5, 3, 4, 0]` и LIS «C и D» — тест
 * «разбор канонического примера KEYED_WALK»; числа перемещений 1 / 3 / 2 — строка
 * `ABCDEFG → ABECDHFG` в `MOVES_ROWS`, пересчитываемая тестом. Промежуточные состояния
 * `result` в `LIS_TRACE` прочитаны по коду `STEP_LIS` руками; их итог `[1, 2]` совпадает
 * с тем, что сверяет тест.
 */
export const LIS_SCENE_CODE = `старая середина:   C  D  E         старые индексы 2, 3, 4
новая середина:    E  C  D  H
newIndexToOldIndex = [5, 3, 4, 0]    // старый индекс + 1; 0 — узла не было`;

export const LIS_SCENE_NOTE =
  'После сверки ключей известно, кто куда должен встать, и остаётся решить, **кого двигать**. Самый простой ответ — всех: раз порядок нарушен, переставить каждый сохранённый узел середины на его новое место. Это три операции `insert` в DOM — `E`, `C` и `D` — там, где хватило бы одной. Узлы при этом не пересоздаются: состояние сохраняется, ключи для этого и нужны. Но каждая перестановка — работа браузера, и на длинном списке, где сдвинули одну строку, «двигать всех» значит двигать сотни узлов ради одного.';

export const LIS_STRATEGIES: { k: string; when: string; what: string; cost: string }[] = [
  {
    k: 'Двигать всех',
    when: 'флаг `moved` взведён — порядок где-то нарушен',
    what: 'Каждый узел, у которого в `newIndexToOldIndex` не ноль, переставляется: `E`, `C`, `D`. `H` монтируется. Ничего считать не надо.',
    cost: '**3** перемещения. Столько же, сколько сохранённых узлов в середине, — даже если сдвинут один.',
  },
  {
    k: 'Правило React',
    when: 'один проход слева направо по новому списку',
    what: 'Запоминается самый правый старый индекс среди оставленных на месте (`lastPlacedIndex`). `E` пришёл с индекса 4 — остаётся, `lastPlacedIndex = 4`. `C` пришёл с 2, левее четырёх — переставить. `D` с 3 — тоже левее — переставить. Правило жадное: оно оставило на месте первый встреченный узел и не проверило, выгодно ли это.',
    cost: '**2** перемещения. Ни `Map`, ни LIS — но и не наименьшее число операций.',
  },
  {
    k: 'LIS — как в Vue',
    when: 'только если `moved` взведён',
    what: 'В старых индексах `5, 3, 4` ищется самая длинная возрастающая цепочка: `3, 4` — это `C` и `D`. Они уже стоят друг относительно друга правильно, их не трогают. Двигается один `E` — перед `C`.',
    cost: '**1** перемещение. Платит расчётом: массив хвостов, двоичный поиск и восстановление цепочки на каждой сверке с нарушенным порядком.',
  },
];

/** Трасса `getSequence([5, 3, 4, 0])` по коду `STEP_LIS`; итог сверяет тест. */
export const LIS_TRACE = `arr = [5, 3, 4, 0]     result — позиции «хвостов» цепочек каждой длины
                       p      — у кого какой предшественник

i = 0   v = 5   result = [0]      старт: цепочка длины 1 кончается на 5
i = 1   v = 3   result = [1]      3 < 5 — цепочку длины 1 выгоднее кончать на 3
i = 2   v = 4   result = [1, 2]   4 > 3 — продлили до длины 2, p[2] = 1
i = 3   v = 0   —                 ноль — новый узел, пропуск

восстановление с конца: 2, потом p[2] = 1  →  [1, 2]  — позиции C и D`;

export const LIS_TRACE_NOTE =
  'Главный ход — на `i = 1`. Цепочка длины 1 уже есть, она кончается на `5`. Пришло `3`: длиннее с ним не станет, но **кончать цепочку на меньшем выгоднее** — к ней сможет пристроиться больше следующих чисел. Хвост заменяется. Проверка на следующем шаге: `4` не пристраивается к `5`, а к `3` — пристраивается, и цепочка выросла до двух. Оставь алгоритм хвост `5` — вышла бы цепочка длины один, и двигать пришлось бы двоих. Двоичный поиск нужен, чтобы на длинном массиве быстро найти, **какой** хвост заменить: хвосты всегда отсортированы. А `result` в конце хранит не цепочку, а последние позиции хвостов, поэтому цепочку собирают назад — по ссылкам `p`.';

/** «На пальцах»: продолжение книжной полки из `PLAIN_LIS`. */
export const PLAIN_LIS_STRATEGIES =
  'Та же полка. Первый библиотекарь снимает все перепутанные книги и ставит заново. Второй идёт слева направо и оставляет каждую книгу, которая не левее последней оставленной, — быстро, но если первой попалась книга не на месте, он «привяжется» к ней и снимет лишние. Третий сперва смотрит на всю полку и находит самую длинную цепочку, которая уже стоит по порядку. Думает он дольше всех, а книг в руки берёт меньше всех.';

export const MOVES_HEAD = ['сценарий', 'Vue: LIS', 'без LIS', 'правило React'];

/** Пересчитывается тестом: `move` в журнале Vue и мини-версии, «без LIS», `lastPlacedIndex`. */
export const MOVES_ROWS: string[][] = [
  ['`ABCDEFG → ABECDHFG`', '1', '3', '2'],
  ['`ABCDEF → FABCDE` — последний в начало', '1', '6', '5'],
  ['`ABCDEF → BCDEFA` — первый в конец', '1', '6', '1'],
  ['`ABCDEF → FEDCBA` — разворот', '5', '6', '5'],
  ['`ABCDE → ABXCDE` — вставка', '0', '0', '0'],
];

export const MOVES_NOTE =
  '«Без LIS» — сколько переставил бы тот же алгоритм, если бы, заметив нарушенный порядок, двигал все сохранённые узлы середины. «Правило React» — сколько переставит `lastPlacedIndex` на тех же ключах. Разворот — худший случай для всех: возрастающая цепочка в нём длиной один.';

export const REACT_NOTE =
  '**Против React.** React сверяет детей одним проходом слева направо: узел, стоявший в старом списке левее последнего оставленного на месте (`lastPlacedIndex`), переставляется. Правило жадное и не ищет лучшую перестановку: перенос последнего элемента в начало стоит ему N−1 перемещений против одного у Vue, а перенос первого в конец — одно, как и у Vue. Зато у React нет ни `Map` на каждую сверку, ни LIS, и файбер-дерево идёт по списку детей однонаправленно. Само правило разобрано и проверено в [«React изнутри», раздел «Сверка»](/frameworks/react-internals/#s4); столбец таблицы — это правило на тех же ключах, а не прогон React.';

// ---------------------------------------------------------------------------
// Раздел 5 · демо
// ---------------------------------------------------------------------------

export const DEMO_NOTE =
  'Демо исполняет ту же строку, что напечатана выше по шагам, на журналирующем хосте. Кадр — одно событие окна `trace` внутри `patchKeyedChildren`: указатели `i`, `e1`, `e2`, массив `newIndexToOldIndex` и LIS приходят из самого алгоритма, а строка «хост сейчас» — это дети `ul` в хосте после шага. Окна `trace` в Vue нет; тест проверяет, что журнал с ним и без него одинаков.';

export const PATCH_SCENARIOS: PatchScenario[] = [
  {
    id: 'mixed',
    label: 'смешанный',
    from: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
    to: ['A', 'B', 'E', 'C', 'D', 'H', 'F', 'G'],
    note: 'Пример из исходников Vue: края снимают четыре узла из семи, середина `C D E → E C D H` даёт `newIndexToOldIndex = [5, 3, 4, 0]`. `C` и `D` образуют LIS и не двигаются, `E` переезжает, `H` монтируется.',
  },
  {
    id: 'move',
    label: 'перестановка',
    from: ['A', 'B', 'C', 'D', 'E', 'F'],
    to: ['F', 'A', 'B', 'C', 'D', 'E'],
    note: 'Последний элемент — в начало. Края не совпадают ни с одной стороны, вся середина идёт через карту. LIS — `A B C D E`, и перемещение одно. Правило React на этих ключах переставило бы пять.',
  },
  {
    id: 'insert',
    label: 'вставка в середину',
    from: ['A', 'B', 'C', 'D', 'E'],
    to: ['A', 'B', 'X', 'C', 'D', 'E'],
    note: 'Края съедают всё: `A B` с начала, `C D E` с конца. Старый список кончился — `X` монтируется перед первым узлом хвоста. Ни `Map`, ни LIS не создаются.',
  },
  {
    id: 'remove',
    label: 'удаление',
    from: ['A', 'B', 'C', 'D', 'E', 'F'],
    to: ['A', 'B', 'D', 'E', 'F'],
    note: 'Зеркало вставки: после краёв кончился новый список, и остаток старого — `C` — просто снимается.',
  },
  {
    id: 'reverse',
    label: 'разворот',
    from: ['A', 'B', 'C', 'D', 'E', 'F'],
    to: ['F', 'E', 'D', 'C', 'B', 'A'],
    note: 'Худший случай: `newIndexToOldIndex = [6, 5, 4, 3, 2, 1]` убывает, и LIS — один узел. Пять перемещений из шести — LIS здесь не экономит ничего.',
  },
  {
    id: 'shuffle',
    label: 'перетасовка',
    from: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
    to: [],
    shuffle: true,
    note: 'Порядок выводится из номера перетасовки — одинаковый у всех читателей и воспроизводимый. Сравните счётчики: разрыв между LIS и «без LIS» тем больше, чем длиннее уцелевшая цепочка.',
  },
];

// ---------------------------------------------------------------------------
// Раздел 6 · флаги патча и блоки
// ---------------------------------------------------------------------------

export const PLAIN_FLAGS =
  'Проверяющий получает не два сочинения целиком, а бланк с пометками составителя: «меняться может только фамилия в третьей строке». Сверять всё остальное незачем — составитель гарантирует, что оно одинаково. Флаги патча — такие пометки, их ставит компилятор шаблона, который видел, где в шаблоне данные, а где буквы.';

/** Шаблон, чей вывод печатается ниже. Тест компилирует его и сверяет вывод дословно. */
export const TEMPLATE_SAMPLE = `<div>
  <p class="note">статичный абзац</p>
  <p>{{ msg }}</p>
  <span :class="cls">x</span>
  <a :href="url" title="t">y</a>
  <ul>
    <li v-for="it in items" :key="it.id">{{ it.t }}</li>
  </ul>
</div>`;

/** Хвост вывода `compile(TEMPLATE_SAMPLE, { hoistStatic: true, mode: 'module' })`, 3.5.42, дословно. */
export const COMPILED_SAMPLE = `const _hoisted_1 = ["href"]

export function render(_ctx, _cache) {
  return (_openBlock(), _createElementBlock("div", null, [
    _cache[0] || (_cache[0] = _createElementVNode("p", { class: "note" }, "статичный абзац", -1 /* CACHED */)),
    _createElementVNode("p", null, _toDisplayString(_ctx.msg), 1 /* TEXT */),
    _createElementVNode("span", {
      class: _normalizeClass(_ctx.cls)
    }, "x", 2 /* CLASS */),
    _createElementVNode("a", {
      href: _ctx.url,
      title: "t"
    }, "y", 8 /* PROPS */, _hoisted_1),
    _createElementVNode("ul", null, [
      (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.items, (it) => {
        return (_openBlock(), _createElementBlock("li", {
          key: it.id
        }, _toDisplayString(it.t), 1 /* TEXT */))
      }), 128 /* KEYED_FRAGMENT */))
    ])
  ]))
}`;

export const COMPILED_NOTE =
  'Каждое динамическое место получило свой флаг: `{{ msg }}` — `1 /* TEXT */`, `:class` — `2 /* CLASS */`, `:href` — `8 /* PROPS */` и список имён `["href"]`, чтобы не проверять `title`. У `v-for` с ключом — `128 /* KEYED_FRAGMENT */`: рендерер сразу пойдёт в `patchKeyedChildren`. У статичного абзаца флага нет, есть `_cache[0]`.';

/** Исполняется тестом как напечатано — и мини-версией, и Vue. `1` — `TEXT`. */
export const FLAGS_CODE = `const host = createLogHost()
const { render } = createRenderer(host.nodeOps)

const view = (cls, text) => (openBlock(), createBlock('div', null, [
  createVNode('p', { class: cls }, text, 1 /* TEXT */),
]))

render(view('old', 'раз'), host.root)
host.log.length = 0

// компилятор такого не выдаст: класс сменился, а флаг обещает «только текст»
render(view('new', 'два'), host.root)
log(host.log.map((e) => e.text).join('\\n'))
log('class в хосте:', host.root.children[0].children[0].props.class)`;

export const FLAGS_LOG = `setElementText p(раз) ← "два"
class в хосте: old`;

export const FLAGS_NOTE =
  'Флаг — не оптимизация «на всякий случай», а **обещание**: рендерер ему верит и остального не смотрит. Пример нарочно нарушает обещание — и класс в хосте остаётся старым, у мини-версии и у настоящего Vue одинаково. Компилятор ставит флаги только туда, где видел выражение, поэтому в шаблоне так не бывает; в рукописной функции рендера — бывает, и `h` флагов не ставит именно поэтому: без них `patch` сравнивает всё.';

export const FLAG_OUTSIDE_NOTE =
  '⚠️ **Флаги экономят только внутри блока.** Вне его — `optimized = false` — `patchElement` сначала идёт полным обходом детей и выставляет текст там, а потом ещё раз по биту `TEXT`: в журнале два одинаковых `setElementText` подряд. Пропсы по флагу проверяются и там, и там, но полного сравнения пропсов нет ни там, ни там. Так ведёт себя Vue в обеих сборках, мини-версия повторяет; компилятор ставит флаги только внутри блоков, поэтому в шаблонах двойной записи не бывает.';

export const PLAIN_BLOCK =
  'Опись ценного в квартире: вместо обхода всех комнат со сверкой каждой вещи — список из пяти пунктов, которые вообще могут пропасть. Блок — такая опись: при создании дерева динамические узлы сами записываются в плоский массив, и при обновлении обходится только он.';

/** Исполняется тестом как напечатано — и мини-версией, и Vue. */
export const BLOCK_CODE = `const host = createLogHost()
const { render } = createRenderer(host.nodeOps)
const view = (msg, note) => (openBlock(), createBlock('div', null, [
  createVNode('p', { class: note }, 'статика'),   // флага нет — блок его не запомнит
  createVNode('section', null, [
    createVNode('b', null, msg, 1 /* TEXT */),     // глубоко внутри — но в том же списке
  ]),
]))

const first = view('раз', 'a')
log('dynamicChildren:', first.dynamicChildren.map((v) => v.type).join(', '))
render(first, host.root)
host.log.length = 0

render(view('два', 'b'), host.root)
log(host.log.map((e) => e.text).join('\\n'))`;

export const BLOCK_LOG = `dynamicChildren: b
setElementText b(раз) ← "два"`;

export const BLOCK_NOTE =
  '`dynamicChildren` корня — `[b]`: `section` и оба `p` в список не попали. Обновление идёт по списку **пара к паре по индексу**, мимо `section` и мимо статичного `p`, даже если тот, как здесь, нарочно изменён. Это законно, пока структура внутри блока не меняется: индексы в списке совпадают только у деревьев одной формы. Поэтому `v-if` и `v-for` открывают собственные блоки: там, где форма может измениться, начинается новый список, а сам блок для внешнего — один динамический узел.';

export const CACHED_NOTE =
  '**В 3.5 статичные узлы не выносятся из функции рендера, а кешируются.** Вместо модульной константы `_hoisted_…` — `_cache[0] || (_cache[0] = …)` с флагом `-1 /* CACHED */`: узел создаётся при первом рендере экземпляра и дальше отдаётся тот же объект. Для `patch` это первая строка — `n1 === n2`, выйти, не заглядывая внутрь. Вынесенными (`_hoisted_1`) остались только неизменяемые пропсы и списки имён. Проверено выводом компилятора 3.5.42 выше; в прежних версиях здесь, по истории исходников, стоял `_hoisted_` и флаг `HOISTED` с тем же значением `-1`.';

export const FRAGMENT_NOTE =
  '**`_Fragment` у `v-for`** — узел без собственного элемента: список должен где-то начинаться и кончаться, а обёртки нет. Vue ставит на границы два пустых текстовых узла и монтирует детей **перед** правым: журнал монтирования `v-for` из двух `li` начинается с `createText ""` дважды. Флаг `128 /* KEYED_FRAGMENT */` отправляет детей фрагмента прямо в `patchKeyedChildren`, а правый пустой узел служит им `parentAnchor` — якорем «в конец». Проверено на Vue в обеих сборках; мини-версия фрагментов не умеет.';

export const STATIC_NOTE =
  '**Длинная статика — одной строкой.** Когда подряд идёт много статичных узлов, `compiler-dom` не создаёт VNode на каждый, а сворачивает цепочку в готовую строку HTML — `_createStaticVNode("<p>a</p><p>a</p>…", 10)` — и монтирует её одной вставкой. Порог в 3.5.42 снят компиляцией на краях: девять `<p>a</p>` подряд остаются узлами, десять сворачиваются — элемент и его текст считаются отдельно, итого двадцать узлов; элементов с атрибутами хватает пяти, четыре не сворачиваются.';

// ---------------------------------------------------------------------------
// Раздел 7 · компонент
// ---------------------------------------------------------------------------

export const COMPONENT_LEAD =
  'Компонент в дереве — VNode, у которого `type` — объект с `setup`. Сам по себе он ничего не рисует: при монтировании он заводит **эффект**, внутри которого вызывает свой рендер и патчит получившееся поддерево. Всё, что рендер прочитал, становится подпиской эффекта — как это устроено, разобрано в [«Vue 3 изнутри: своя реактивность», раздел «effect»](/frameworks/vue-internals/#s3). Запись не рисует сразу, а ставит задание в очередь — её устройство там же, в [разделе «Планировщик»](/frameworks/vue-internals/#s6); здесь очередь в пять строк.';

/** Исполняется тестом как напечатано — и мини-версией, и Vue. Реактивность в обоих — настоящая. */
export const COMPONENT_CODE = `const host = createLogHost()
const { render } = createRenderer(host.nodeOps)
const state = reactive({ n: 0, label: 'мало' })

const Child = {
  props: ['text'],
  setup(props) {
    return () => (log('рендер Child'), h('b', null, props.text))
  },
}
const Parent = {
  setup() {
    return () => (log('рендер Parent'), h('div', null, [h('span', null, state.n), h(Child, { text: state.label })]))
  },
}

render(h(Parent), host.root)
host.log.length = 0

state.n++; state.n++; state.n++          // три записи — одно задание
await nextTick()
state.label = 'много'                    // пропс ребёнка изменился
await nextTick()
log(host.log.map((e) => e.text).join('\\n'))`;

export const COMPONENT_LOG = `рендер Parent
рендер Child
рендер Parent
рендер Parent
рендер Child
setElementText span(0) ← "3"
setElementText b(мало) ← "много"`;

export const UPDATE_NOTE =
  'Три записи в `state.n` — один рендер `Parent`: эффект трижды будит `scheduler`, а `queueJob` кладёт в `Set` одно задание. `Child` при этом не рендерится вовсе: `updateComponent` сравнил пропсы, `text` прежний — и поддерево ребёнка не тронуто. Когда `label` меняется, ребёнок обновляется **сразу, внутри `patch` родителя** — `instance.update()` зовётся синхронно, а не через очередь.';

export const DIRTY_NOTE =
  'Отсюда строка `runner.effect.dirty && runner()`. Если ребёнок сам читал изменившееся, его задание уже стоит в очереди — и отработало бы второй раз после того, как родитель его обновил. Проверка `dirty` гасит такой повтор: эффект только что выполнился, его версии свежие. Vue делает то же методом `effect.runIfDirty`, а сортировка по `uid` гарантирует, что родитель — созданный раньше — идёт первым.';

export const PROPS_NOTE =
  '**Пропсы** — `shallowReactive` с объявленными ключами. Родитель присылает новый VNode, `componentUpdate` переписывает значения в тот же объект, и всё, что ребёнок читал из `props`, остаётся подпиской. Запись идёт внутри выполняющегося эффекта ребёнка, поэтому сама себя не будит. Необъявленные атрибуты Vue отдаёт в `attrs` и навешивает на корень ребёнка — мини-версия их просто отбрасывает.';

export const SLOTS_NOTE =
  '**Слоты** — функции, которые ребёнок вызывает внутри своего рендера. Значит, всё, что содержимое слота читает, — подписка эффекта **ребёнка**, а не родителя: данные родителя, использованные только в слоте, перерисовывают только ребёнка. Проверено на Vue 3.5.42 в обеих сборках: запись в такое поле даёт один рендер ребёнка и ноль рендеров родителя. Мини-версия слотов не умеет.';

// ---------------------------------------------------------------------------
// Раздел 8 · настоящий Vue
// ---------------------------------------------------------------------------

export const REAL_HEAD = ['что', 'мини-версия', 'Vue 3.5.42'];

export const REAL_ROWS: string[][] = [
  [
    'Узел без ключа в середине списка',
    'не находит пары по `Map` — удаляется и монтируется заново',
    'ищет перебором первый неиспользованный узел того же типа: на `[p, A, b] → [b, A, p]` без ключей у `p` и `b` журналы расходятся',
  ],
  [
    'Нормализация детей',
    'строки превращаются в текстовые VNode сразу, в `createVNode`',
    'лениво, при монтировании и патче: `normalizeVNode` и `cloneIfMounted`, который копирует уже смонтированный VNode, чтобы один объект не стоял в двух местах',
  ],
  [
    'Пропсы при монтировании',
    'все, кроме `key`',
    'пропускаются зарезервированные (`key`, `ref`, `onVnode…`), а `value` ставится последним — чтобы `min`/`max` у поля ввода уже стояли',
  ],
  [
    'Блоки',
    '`dynamicChildren` и обход пара к паре',
    'плюс страховка: если длины списков у старого и нового блока разошлись, флаги сбрасываются и идёт полный обход (`BAIL`, `-2`); `FULL_PROPS` старого узла переносится на новый',
  ],
  [
    'Виды узлов',
    'элемент, текст, компонент',
    'ещё `Comment`, `Fragment` (два пустых текстовых узла-якоря вокруг детей), `Static` (готовая строка HTML), `Teleport`, `Suspense`, `KeepAlive`',
  ],
  [
    'Перемещение и удаление',
    '`insert` и `remove`',
    'через переходы: у узла с `<Transition>` удаление ждёт конца анимации ухода, а `move` различает вход, уход и перестановку',
  ],
  [
    'Компонент',
    '`setup` возвращает функцию рендера; пропсы — объявленные',
    '`attrs` и их проброс на корень, `emits`, слоты, хуки жизненного цикла, `expose`, область эффектов экземпляра, асинхронные компоненты',
  ],
  [
    'Очередь',
    '`Set`, сортировка по `uid`, одна микрозадача',
    'очереди `pre` и `post`, флаги заданий, двоичный поиск места, предохранитель от бесконечного цикла обновлений. Разобрана в [«Vue 3 изнутри: своя реактивность»](/frameworks/vue-internals/#s6)',
  ],
];

export const REAL_NOTE =
  'На всём, что мини-версия умеет, её журнал совпадает с журналом Vue дословно — на сценариях демо, на примерах из текста и на 400 случайных парах списков в обеих сборках. Отличия выше — это то, чего мини-версия не умеет, а не то, что она делает иначе. Исключение одно — первая строка: там мини-версия ведёт себя иначе, и это учебное упрощение, а не поведение Vue.';

// ---------------------------------------------------------------------------
// Раздел 9 · тонкие места
// ---------------------------------------------------------------------------

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'Дубликат ключа оставляет в DOM лишний узел — молча',
    code: "['A', 'A', 'B'] → ['B', 'A', 'A']   // в хосте: A B A A",
    d: '`keyToNewIndex` хранит для ключа одну позицию, и второй старый `A` перезаписывает первого в `newIndexToOldIndex`. Первый `A` сверен, но ни перемещён, ни удалён — он остаётся в хосте призраком, а для второй позиции монтируется новый. Итог: четыре узла вместо трёх. Так ведут себя и мини-версия, и Vue в обеих сборках; предупреждение `Duplicate keys` печатает только отладочная — в продакшене тишина.',
    tone: 'err',
  },
  {
    n: '02',
    t: '`:key="index"` и отсутствие ключа — одно и то же',
    d: 'Узлы сопоставляются по позиции, и состояние узла хоста — введённый текст, фокус, состояние дочернего компонента — остаётся на месте, когда данные уезжают. Перезапись текста вместо перемещения выглядит как экономия, пока в строке нет ничего, кроме текста.',
    tone: 'err',
  },
  {
    n: '03',
    t: 'Флаг патча — обещание, и рендерер ему верит',
    code: "createVNode('p', { class: cls }, text, 1 /* TEXT */)   // класс не обновится никогда",
    d: 'С флагом `TEXT` `patchElement` сверяет только текст. Шаблон такого не выдаст, а рукописная функция рендера с флагами — легко. Если флаги расставляет не компилятор, не расставляйте их: `h` без флагов сравнивает всё.',
    tone: 'warn',
  },
  {
    n: '04',
    t: '`patchFlag & X` без `patchFlag > 0` срабатывает на кешированной статике',
    code: '-1 & 128   // 128: у CACHED взведены все биты',
    d: 'Отрицательные флаги — `CACHED` (`-1`) и `BAIL` (`-2`) — в дополнительном коде состоят почти из одних единиц, и любая проверка бита на них истинна. Поэтому каждая ветка по флагам в Vue начинается с `patchFlag > 0`. Уберите эту проверку из `patchChildren` — и узел с флагом `-1` и текстом уходит в `patchKeyedChildren`, строка перебирается как массив букв, каждая буква «совпадает» с буквой — и текст молча остаётся старым. Ни исключения, ни предупреждения.',
    tone: 'warn',
  },
  {
    n: '05',
    t: 'LIS не спасает разворот',
    d: 'У развёрнутого списка возрастающая цепочка длиной один, и из шести узлов двигаются пять — ровно столько же, сколько по правилу React. LIS выигрывает там, где большая часть списка сохранила порядок: перенос одного элемента, вставка группы. Сортировку «по убыванию ↔ по возрастанию» он не удешевляет.',
  },
  {
    n: '06',
    t: 'Обход слева направо ставит узлы перед тем, что ещё не на месте',
    d: 'Якорь `insert` — правый сосед по новому списку. Справа налево он уже стоит правильно; слева направо — ещё нет, и узел встаёт перед соседом, которого потом переставят. Поменяйте направление одной строкой — и итоговый порядок в хосте разойдётся с новым списком.',
  },
];

// ---------------------------------------------------------------------------
// Раздел 10 · источники
// ---------------------------------------------------------------------------

export const SOURCES = [
  {
    title: '`runtime-core` · `renderer.ts`',
    href: 'https://github.com/vuejs/core/blob/main/packages/runtime-core/src/renderer.ts',
    what: '`patch`, `patchElement`, `patchKeyedChildren`, `getSequence`, `mountComponent` — оригинал почти всех шагов.',
  },
  {
    title: '`runtime-core` · `vnode.ts`',
    href: 'https://github.com/vuejs/core/blob/main/packages/runtime-core/src/vnode.ts',
    what: '`createVNode`, `openBlock`, `createBlock`, `isSameVNodeType`, нормализация детей.',
  },
  {
    title: '`shared` · `patchFlags.ts` и `shapeFlags.ts`',
    href: 'https://github.com/vuejs/core/blob/main/packages/shared/src/patchFlags.ts',
    what: 'Значения флагов с комментариями, в том числе про отрицательные `CACHED` и `BAIL`.',
  },
  {
    title: '`compiler-core` · `cacheStatic.ts`',
    href: 'https://github.com/vuejs/core/blob/main/packages/compiler-core/src/transforms/cacheStatic.ts',
    what: 'Какие узлы компилятор считает статичными и как кеширует их в 3.5.',
  },
  {
    title: '`runtime-dom` · `nodeOps.ts`',
    href: 'https://github.com/vuejs/core/blob/main/packages/runtime-dom/src/nodeOps.ts',
    what: 'Настоящий хост: те же функции поверх DOM.',
  },
  {
    title: 'Vue · Rendering Mechanism',
    href: 'https://vuejs.org/guide/extras/rendering-mechanism.html',
    what: 'Официальное объяснение виртуального DOM, флагов патча, блоков и деревьев блоков.',
  },
  {
    title: 'Longest increasing subsequence',
    href: 'https://en.wikipedia.org/wiki/Longest_increasing_subsequence',
    what: 'Алгоритм за `O(n log n)` с массивом хвостов и восстановлением по предшественникам.',
  },
];

export const RELATED =
  'Смежное на сайте: [Vue 3 изнутри: своя реактивность](/frameworks/vue-internals/) — вторая половина ядра: эффект, который здесь вызывает рендер, и очередь, в которую встаёт обновление. [React изнутри](/frameworks/react-internals/#s4) — та же задача сверки списков, решённая правилом `lastPlacedIndex`. [Реактивность Vue](/frameworks/vue-reactivity/) — поведение снаружи. [React против Vue](/frameworks/react-vs-vue/) — чем модель «перерисуй поддерево» отличается от «перезапусти прочитавших». [Diff](/algorithms/diff/) — алгоритм Майерса, patience в git и сколько перемещений делают Vue и React на одних перестановках.';
