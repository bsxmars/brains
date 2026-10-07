import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { MeasuredRow, Scenario } from '@/widgets/vapor-lab/model/types';

/**
 * Данные темы «Vapor Mode во Vue».
 *
 * ⚠️ **Предмет темы — релиз-кандидат.** Всё, что снято запуском, снято на `vue@3.6.0-rc.9`
 * (пакет стоит отдельно, алиасом `vue-vapor`; сайт живёт на 3.5.42 и его не трогает).
 * Имена помощников (`setClassName`, `setInsertionState`), числовые флаги `createFor`/`createIf`
 * и сам текст вывода компилятора — внутренности RC и могут смениться к релизу. Когда это
 * случится, покраснеет `tests/unit/vue-vapor.test.ts`: он сверяет литералы здесь с живым выводом.
 *
 * Главное здесь — `MINI_VAPOR_CODE`: учебный Vapor одной строкой, разложенной на шаги `STEP_*`.
 * Шаги печатаются в теме, склейку **той же строки** исполняют демо (`widgets/vapor-lab/model/lab.ts`
 * собирает её `new Function`) и тест. Копии нет.
 *
 * Что чем проверено (`tests/unit/vue-vapor.test.ts`, Node 26.8.2, happy-dom 20.14.5):
 *
 *   - `VAPOR_CODE` и `VDOM_CODE` — вывод `compileScript` для `CART_SFC` у `@vue/compiler-sfc`
 *     3.6.0-rc.9 (`vapor: true`) и 3.5.42; сверяются дословно после схлопывания пустых строк;
 *     VDOM-вывод 3.6.0-rc.9 совпадает с 3.5.42 символ в символ — это тоже закреплено;
 *   - `MEASURED` — последовательность `SEQUENCE` на настоящем Vapor 3.6.0-rc.9 (обе сборки
 *     `vue.runtime-with-vapor.esm-browser*.js`), на VDOM 3.5.42 и 3.6.0-rc.9 (обе сборки) и на
 *     мини-vapor: прогоны эффектов, вызовы render, созданные VNode и DOM-операции одним щупом;
 *     у мини-vapor и настоящего Vapor совпадают и число эффектов, и виды DOM-операций, и HTML;
 *   - `MINI_OUT` — вывод мини-компилятора для шаблона `CART_SFC`;
 *   - включение и смешивание (`APPS_ROWS`), ограничения (`LIMITS`) и вес (`WEIGHT_ROWS`,
 *     `BUNDLE_ROWS`) — запуском; где не запуском, стоит ⚠️ и источник.
 */

// ---------------------------------------------------------------------------
// Сквозной пример: один компонент на всю тему
// ---------------------------------------------------------------------------

/** Компонент, который компилируют, меряют и исполняют все разделы. */
export const CART_SFC = `<script setup vapor>
import { ref } from 'vue'
const title = ref('Корзина')
const count = ref(0)
const items = ref([{ id: 1, name: 'чай' }, { id: 2, name: 'сыр' }])
</script>

<template>
  <section class="cart">
    <h2>{{ title }}</h2>
    <p :class="{ empty: count === 0 }">Товаров: {{ count }}</p>
    <ul>
      <li v-for="item in items" :key="item.id">{{ item.name }}</li>
    </ul>
    <p v-if="count > 3">Бесплатная доставка</p>
    <button @click="count++">+1</button>
  </section>
</template>`;

/** Шаблон того же компонента — вход мини-компилятора. */
export const CART_TEMPLATE = CART_SFC.slice(CART_SFC.indexOf('<template>') + '<template>'.length, CART_SFC.lastIndexOf('</template>')).trim();

/** Начальные значения ячеек — те же, что в `<script setup>` выше (тест сверяет HTML после монтирования). */
export const CART_INITIAL = {
  title: 'Корзина',
  count: 0,
  items: [
    { id: 1, name: 'чай' },
    { id: 2, name: 'сыр' },
  ],
};

/**
 * Вывод `compileScript(…, { vapor: true, inlineTemplate: true })`, `@vue/compiler-sfc` 3.6.0-rc.9.
 * Пустые строки схлопнуты — единственная правка; тест делает то же с живым выводом.
 */
export const VAPOR_CODE = `import { child as _child, next as _next, txt as _txt, toDisplayString as _toDisplayString, setText as _setText, setClassName as _setClassName, renderEffect as _renderEffect, setInsertionState as _setInsertionState, createFor as _createFor, createIf as _createIf, on as _on, template as _template } from 'vue';
const t0 = _template("<li> ")
const t1 = _template("<p>Бесплатная доставка", 2)
const t2 = _template("<section class=cart><h2> </h2><p> </p><ul></ul><!><button>+1", 1)
import { ref } from 'vue'

export default {
  __name: 'Cart',
  __vapor: true,
  setup(__props) {

const title = ref('Корзина')
const count = ref(0)
const items = ref([{ id: 1, name: 'чай' }, { id: 2, name: 'сыр' }])

  const n11 = t2()
  const n0 = _child(n11)
  const n1 = _next(n0)
  const n5 = _next(n1)
  const n10 = _next(n5)
  const n9 = _next(n10)
  const x0 = _txt(n0)
  const x1 = _txt(n1)
  _renderEffect(() => {
    const _count = count.value
    _setText(x0, _toDisplayString(title.value))
    _setClassName(n1, (_count === 0 ? 1 : 0), "empty")
    _setText(x1, "Товаров: " + _toDisplayString(_count))
  })
  _setInsertionState(n5)
  const n2 = _createFor(() => (items.value), (_for_item0) => {
    const n4 = t0()
    const x4 = _txt(n4)
    _renderEffect(() => _setText(x4, _toDisplayString(_for_item0.value.name)))
    return n4
  }, (item) => (item.id), 9 /* FAST_REMOVE, IS_SINGLE_NODE */)
  _setInsertionState(n11, n10)
  const n6 = _createIf(() => (count.value > 3), () => {
    const n8 = t1()
    return n8
  }, null, 33 /* TRUE_SINGLE_ROOT, TRUE_NO_SCOPE */)
  _on(n9, "click", () => (count.value++))
  return n11

}

}`;

/** Тот же компонент без `vapor`: `@vue/compiler-sfc` 3.5.42 (и 3.6.0-rc.9 — вывод тот же). */
export const VDOM_CODE = `import { toDisplayString as _toDisplayString, createElementVNode as _createElementVNode, normalizeClass as _normalizeClass, renderList as _renderList, Fragment as _Fragment, openBlock as _openBlock, createElementBlock as _createElementBlock, createCommentVNode as _createCommentVNode } from "vue"

const _hoisted_1 = { class: "cart" }
const _hoisted_2 = { key: 0 }

import { ref } from 'vue'

export default {
  __name: 'Cart',
  setup(__props) {

const title = ref('Корзина')
const count = ref(0)
const items = ref([{ id: 1, name: 'чай' }, { id: 2, name: 'сыр' }])

return (_ctx, _cache) => {
  return (_openBlock(), _createElementBlock("section", _hoisted_1, [
    _createElementVNode("h2", null, _toDisplayString(title.value), 1 /* TEXT */),
    _createElementVNode("p", {
      class: _normalizeClass({ empty: count.value === 0 })
    }, "Товаров: " + _toDisplayString(count.value), 3 /* TEXT, CLASS */),
    _createElementVNode("ul", null, [
      (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(items.value, (item) => {
        return (_openBlock(), _createElementBlock("li", {
          key: item.id
        }, _toDisplayString(item.name), 1 /* TEXT */))
      }), 128 /* KEYED_FRAGMENT */))
    ]),
    (count.value > 3)
      ? (_openBlock(), _createElementBlock("p", _hoisted_2, "Бесплатная доставка"))
      : _createCommentVNode("v-if", true),
    _createElementVNode("button", {
      onClick: _cache[0] || (_cache[0] = $event => (count.value++))
    }, "+1")
  ]))
}
}

}`;

// ---------------------------------------------------------------------------
// Мини-vapor: шаги и склейка
// ---------------------------------------------------------------------------

/** Шаг 1: ячейки, очередь, `renderEffect` и блок. */
export const STEP_SIGNALS = `let activeEffect = null   // кто сейчас читает
let activeScope = null    // блок, в который записываются новые эффекты
const queue = new Set()   // эффекты, ждущие перезапуска
let flushing = null       // промис текущего слива очереди
const stats = { effects: 0 }

function ref(value) {
  const subs = new Set()
  return {
    get value() {
      if (activeEffect) {
        subs.add(activeEffect)
        activeEffect.deps.push(subs)
      }
      return value
    },
    set value(next) {
      if (Object.is(next, value)) return       // то же значение — никого не будим
      value = next
      for (const e of subs) queue.add(e)
      flushing ||= Promise.resolve().then(flush)
    },
  }
}

function flush() {
  for (const e of queue) {      // Set обходит и то, что добавилось по ходу
    queue.delete(e)
    e.run()
  }
  flushing = null
}

function nextTick() {
  return flushing || Promise.resolve()
}

// renderEffect: функция, которая перезапускается, когда меняется прочитанное ею
function renderEffect(fn) {
  const e = {
    deps: [],
    active: true,
    run() {
      if (!e.active) return
      for (const subs of e.deps) subs.delete(e)   // забыть прошлые подписки
      e.deps.length = 0
      stats.effects++
      const prev = activeEffect
      activeEffect = e
      try {
        fn()
      } finally {
        activeEffect = prev
      }
    },
    stop() {
      e.active = false
      for (const subs of e.deps) subs.delete(e)
    },
  }
  if (activeScope) activeScope.effects.push(e)
  e.run()
  return e
}

// блок: DOM-узел плюс эффекты и уборки, созданные, пока он строился
function block(render) {
  const scope = { effects: [], cleanups: [], node: null }
  const prevScope = activeScope
  const prevEffect = activeEffect
  activeScope = scope
  activeEffect = null           // постройка блока — не чтение для внешнего эффекта
  try {
    scope.node = render()
  } finally {
    activeScope = prevScope
    activeEffect = prevEffect
  }
  return scope
}

// detach = false: узел уйдёт вместе с родителем, снимать его отдельно незачем
function dispose(scope, detach = true) {
  for (const e of scope.effects) e.stop()
  for (const fn of scope.cleanups) fn()
  if (detach) remove(scope.node)
}`;

/** Шаг 2: DOM — шаблон, навигация, запись с памятью. */
export const STEP_DOM = `const hooks = { touch: null }   // демо подсвечивает тронутые узлы
let parser = null              // один <template> на все шаблоны, как в Vapor

function touch(node, op) {
  if (hooks.touch) hooks.touch(node, op)
}

// template(html): разобрать HTML один раз, дальше только клонировать
function template(html) {
  let proto = null
  return () => {
    if (!proto) {
      parser ||= document.createElement('template')
      parser.innerHTML = html
      proto = parser.content.firstChild
    }
    const node = proto.cloneNode(true)
    touch(node, 'create')
    return node
  }
}

const child = (node) => node.firstChild
const next = (node) => node.nextSibling
const txt = (node) => node.firstChild

function str(v) {
  return v == null ? '' : String(v)
}

// setText и setClass помнят, что записали, и не трогают DOM, если значение то же
function setText(node, value) {
  if (node.$txt === value) return
  node.nodeValue = node.$txt = value
  touch(node, 'text')
}

function setClass(el, value) {
  const cls = typeof value === 'string' ? value
    : Object.keys(value).filter((k) => value[k]).join(' ')
  if (el.$cls === cls) return
  el.className = el.$cls = cls
  touch(el, 'class')
}

function setAttr(el, name, value) {
  const key = '$' + name
  if (el[key] === value) return
  el[key] = value
  if (value == null) el.removeAttribute(name)
  else el.setAttribute(name, value)
  touch(el, 'attr')
}

function on(el, event, handler) {
  el.addEventListener(event, handler)
}

function insert(node, parent, anchor = null) {
  parent.insertBefore(node, anchor)
  touch(node, 'insert')
}

function remove(node) {
  touch(node, 'remove')
  node.parentNode.removeChild(node)
}`;

/** Шаг 3: `createIf` и `createFor`. */
export const STEP_BLOCKS = `// v-if: эффект следит только за условием; ветка строится и сносится целиком
function createIf(cond, render, parent, anchor) {
  let branch = null
  renderEffect(() => {
    const ok = !!cond()
    if (ok && !branch) {
      branch = block(render)
      insert(branch.node, parent, anchor)
    } else if (!ok && branch) {
      dispose(branch)
      branch = null
    }
  })
  activeScope.cleanups.push(() => branch && dispose(branch, false))
}

// v-for: эффект следит за массивом, у каждой строки — свой блок и своя ячейка item.
// only: список — единственное содержимое родителя (это знает компилятор)
function createFor(source, render, getKey, parent, only = false) {
  const anchor = document.createTextNode('')   // конец списка
  touch(anchor, 'create')
  insert(anchor, parent)
  let rows = new Map()                         // ключ → { item, scope }
  renderEffect(() => {
    const fresh = new Map()
    for (const raw of source()) {
      const key = getKey(raw)
      let row = rows.get(key)
      if (row) row.item.value = raw            // знакомый ключ: только обновить ячейку
      else {
        const item = ref(raw)
        row = { item, scope: block(() => render(item)) }
      }
      fresh.set(key, row)
    }
    if (only && !fresh.size && rows.size) {       // всё удалено: одна запись вместо N снятий
      for (const row of rows.values()) dispose(row.scope, false)
      parent.textContent = ''
      touch(parent, 'text')
      insert(anchor, parent)
      rows = fresh
      return
    }
    for (const [key, row] of rows) if (!fresh.has(key)) dispose(row.scope)
    let after = anchor                         // расставить с конца: каждый перед следующим
    for (const row of [...fresh.values()].reverse()) {
      const node = row.scope.node
      if (!node.parentNode || node.nextSibling !== after) insert(node, parent, after)
      after = node
    }
    rows = fresh
  })
  activeScope.cleanups.push(() => {
    for (const row of rows.values()) dispose(row.scope, false)
  })
}`;

/** Шаг 4: компилятор шаблона в `template` + эффекты. */
export const STEP_COMPILER = `// Разбор: теги, атрибуты, текст. Без самозакрывающихся тегов и смешанного содержимого.
function parse(source) {
  const root = { tag: null, attrs: [], children: [] }
  const stack = [root]
  for (const [, close, tag, attrs, text] of source.matchAll(/<(\\/?)([a-z][\\w-]*)((?:"[^"]*"|[^>"])*)>|([^<]+)/g)) {
    const parent = stack[stack.length - 1]
    if (text !== undefined) {
      if (text.trim()) parent.children.push({ text: text.trim() })
    } else if (close) stack.pop()
    else {
      const el = { tag, attrs: [...attrs.matchAll(/([:@\\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]), children: [] }
      parent.children.push(el)
      stack.push(el)
    }
  }
  return root.children[0]
}

const attr = (el, name) => el.attrs.find(([k]) => k === name)?.[1]
const without = (el, name) => ({ ...el, attrs: el.attrs.filter(([k]) => k !== name) })
const isText = (el) => el.children.length === 1 && 'text' in el.children[0]
const hasMustache = (el) => isText(el) && el.children[0].text.includes('{{')

// count → count.value: ссылки компонента и item из v-for — ячейки
function exp(code, refs) {
  return code.replace(/(?<![.\\w$])[A-Za-z_$][\\w$]*/g, (id) => (refs.includes(id) ? id + '.value' : id))
}

// «Товаров: {{ count }}» → "Товаров: " + str(count.value)
function textExp(text, refs) {
  return text.split(/\\{\\{(.*?)\\}\\}/).map((part, i) =>
    i % 2 ? 'str(' + exp(part.trim(), refs) + ')' : JSON.stringify(part)).filter((p) => p !== '""').join(' + ')
}

// Статический HTML шаблона: динамический текст — пробел-заглушка, v-if — комментарий, v-for — ничего
function html(el) {
  const attrs = el.attrs.filter(([k]) => !/^[:@]|^v-/.test(k)).map(([k, v]) => \` \${k}="\${v}"\`).join('')
  const inner = hasMustache(el) ? ' ' : el.children.map((c) =>
    'text' in c ? c.text : attr(c, 'v-if') ? '<!---->' : attr(c, 'v-for') ? '' : html(c)).join('')
  return \`<\${el.tag}\${attrs}>\${inner}</\${el.tag}>\`
}

function compile(source, bindings) {
  const templates = []
  let uid = 0

  function genBlock(el, refs) {
    const lines = []
    const effects = []
    const after = []
    const root = 'n' + uid++
    lines.push(\`const \${root} = t\${templates.push(html(el)) - 1}()\`)

    function walk(el, v) {
      for (const [k, value] of el.attrs) {
        if (k === ':class') effects.push(\`setClass(\${v}, \${exp(value, refs)})\`)
        else if (k[0] === ':' && k !== ':key') effects.push(\`setAttr(\${v}, '\${k.slice(1)}', \${exp(value, refs)})\`)
        else if (k[0] === '@') after.push(\`on(\${v}, '\${k.slice(1)}', () => (\${exp(value, refs)}))\`)
      }
      if (hasMustache(el)) {
        const x = 'x' + uid++
        lines.push(\`const \${x} = txt(\${v})\`)
        effects.push(\`setText(\${x}, \${textExp(el.children[0].text, refs)})\`)
        return
      }
      let prev = null
      for (const c of el.children) {
        if ('text' in c) continue
        if (attr(c, 'v-for')) {                  // строк нет в шаблоне — их вставит createFor
          after.push(genFor(c, v, refs, el.children.length === 1))
          continue
        }
        const n = 'n' + uid++
        lines.push(\`const \${n} = \${prev ? \`next(\${prev})\` : \`child(\${v})\`}\`)
        prev = n
        if (attr(c, 'v-if')) after.push(genIf(c, v, n, refs))   // n — комментарий-якорь
        else walk(c, n)
      }
    }

    walk(el, root)
    if (effects.length) lines.push(\`renderEffect(() => {\\n  \${effects.join('\\n  ')}\\n})\`)
    return [...lines, ...after, \`return \${root}\`].join('\\n')
  }

  const indent = (code) => code.replace(/^/gm, '  ')

  function genIf(el, parent, anchor, refs) {
    const body = genBlock(without(el, 'v-if'), refs)
    return \`createIf(() => (\${exp(attr(el, 'v-if'), refs)}), () => {\\n\${indent(body)}\\n}, \${parent}, \${anchor})\`
  }

  function genFor(el, parent, refs, only) {
    const [alias, list] = attr(el, 'v-for').split(' in ').map((s) => s.trim())
    const body = genBlock(without(without(el, 'v-for'), ':key'), [...refs, alias])
    return \`createFor(() => (\${exp(list, refs)}), (\${alias}) => {\\n\${indent(body)}\\n}, \` +
      \`(\${alias}) => (\${exp(attr(el, ':key'), refs)}), \${parent}\${only ? ', true' : ''})\`
  }

  const body = genBlock(parse(source), bindings)
  return [
    ...templates.map((h, i) => \`const t\${i} = template(\${JSON.stringify(h)})\`),
    \`return function render({ \${bindings.join(', ')} }) {\`,
    indent(body),
    '}',
  ].join('\\n')
}

// Код компилятора → функция render. Имена рантайма — параметры, как импорты у Vapor
const RUNTIME = { template, child, next, txt, str, setText, setClass, setAttr, on, renderEffect, createIf, createFor }

function build(code) {
  return new Function(...Object.keys(RUNTIME), code)(...Object.values(RUNTIME))
}

function mount(render, state, container) {
  const root = block(() => render(state))
  insert(root.node, container)
  return root
}`;

export const STEP_EXPORT = `return { ref, nextTick, compile, build, mount, dispose, hooks, stats }`;

/** Весь мини-vapor одной строкой — тело функции. */
export const MINI_VAPOR_CODE = [STEP_SIGNALS, STEP_DOM, STEP_BLOCKS, STEP_COMPILER, STEP_EXPORT].join('\n\n');

/** Вывод мини-компилятора для `CART_TEMPLATE` с ячейками `title`, `count`, `items`. */
export const MINI_OUT = `const t0 = template("<section class=\\"cart\\"><h2> </h2><p> </p><ul></ul><!----><button>+1</button></section>")
const t1 = template("<li> </li>")
const t2 = template("<p>Бесплатная доставка</p>")
return function render({ title, count, items }) {
  const n0 = t0()
  const n1 = child(n0)
  const x2 = txt(n1)
  const n3 = next(n1)
  const x4 = txt(n3)
  const n5 = next(n3)
  const n8 = next(n5)
  const n10 = next(n8)
  renderEffect(() => {
    setText(x2, str(title.value))
    setClass(n3, { empty: count.value === 0 })
    setText(x4, "Товаров: " + str(count.value))
  })
  createFor(() => (items.value), (item) => {
    const n6 = t1()
    const x7 = txt(n6)
    renderEffect(() => {
      setText(x7, str(item.value.name))
    })
    return n6
  }, (item) => (item.id), n5, true)
  createIf(() => (count.value > 3), () => {
    const n9 = t2()
    return n9
  }, n0, n8)
  on(n10, 'click', () => (count.value++))
  return n0
}`;

// ---------------------------------------------------------------------------
// Вводный раздел · словарь
// ---------------------------------------------------------------------------

export const INTRO_NOTE =
  'Vapor Mode — второй способ скомпилировать тот же однофайловый компонент. Обычный Vue превращает шаблон в render-функцию: при каждом изменении она заново строит дерево VNode, а рендерер сравнивает его с прошлым. Vapor превращает шаблон в HTML-строку, которую достаточно клонировать, и несколько эффектов, которые пишут прямо в нужные узлы. Механизм небольшой: учебный Vapor вместе с компилятором умещается примерно на трёхстах строках. Всё снято на `vue@3.6.0-rc.9` — это релиз-кандидат, и внутренние имена могут измениться.';

export const PLAIN_INTRO =
  'Обычный Vue на каждое изменение перерисовывает эскиз всей комнаты и сличает его с прошлым, чтобы найти, какую лампочку поменять. Vapor при сборке сразу записывает: «лампочка над столом зависит от выключателя `count`» — и при щелчке идёт прямо к ней. Сама комната собирается не по кирпичу, а копируется с готового трафарета.';

export const GLOSSARY = [
  {
    k: 'VNode и виртуальный DOM',
    d: 'Обычный JS-объект, описывающий элемент: тег, свойства, дети. Дерево VNode строит render-функция, а рендерер сравнивает новое дерево со старым и переносит разницу в DOM. Подробно — в [«Vue 3 изнутри: рендерер и patch»](/frameworks/vue-patch-internals/#s1).',
  },
  {
    k: 'render-функция',
    d: 'Функция, в которую компилятор превращает шаблон обычного компонента. Каждый её вызов возвращает **всё** дерево VNode компонента, даже если поменялась одна буква.',
  },
  {
    k: '`<script setup>` и SFC',
    d: 'SFC — файл `.vue` с блоками `<template>`, `<script>` и `<style>`. `<script setup>` — форма, где переменные верхнего уровня сразу видны шаблону. Vapor включается атрибутом на этом блоке.',
  },
  {
    k: 'эффект (`renderEffect`)',
    d: 'Функция, которая запоминает, какие `ref` прочитала, и перезапускается, когда любой из них меняется. В Vapor эффекты пишут в DOM напрямую. Как эффект узнаёт свои источники — в [«Vue 3 изнутри: своя реактивность»](/frameworks/vue-internals/#s3).',
  },
  {
    k: 'блок',
    d: 'Кусок DOM, который создаётся и удаляется целиком: корень компонента, одна строка `v-for`, ветка `v-if`. У блока свои эффекты — при удалении блока они останавливаются.',
  },
  {
    k: 'якорь',
    d: 'Невидимый узел — пустой текст или комментарий `<!---->`, — перед которым вставляется содержимое `v-if` или `v-for`. Нужен, чтобы знать, **куда** вставлять, когда самого содержимого ещё нет.',
  },
  {
    k: 'DOM-операция',
    d: 'Здесь — один вызов DOM API, меняющий страницу: запись `nodeValue`, `className`, `textContent`, атрибута, вставка, удаление или создание узла. Считается щупом, который подменяет эти методы на время замера.',
  },
  {
    k: 'dev и prod',
    d: 'Две сборки Vue. Отладочная (dev) печатает в консоль предупреждения и проверяет лишнее; продакшен-сборка (prod) — та, что уходит к пользователям, — из неё предупреждения вырезаны. Поэтому одна и та же ошибка в dev слышна, а в prod может пройти молча.',
  },
  {
    k: 'интероп',
    d: 'Смешивание Vapor- и VDOM-компонентов в одном приложении. В 3.6.0-rc.9 это отдельный плагин `vaporInteropPlugin`, без него смешанное дерево не рендерится.',
  },
];

// ---------------------------------------------------------------------------
// Перед началом
// ---------------------------------------------------------------------------

export const PREREQ = [
  {
    t: 'Как `ref` будит эффект',
    d: 'Чтение `ref` внутри эффекта записывает эффект в подписчики, запись будит подписчиков. Vapor стоит целиком на этом механизме и ничего к нему не добавляет.',
    href: '/frameworks/vue-internals/',
    hrefLabel: 'Vue 3 изнутри: своя реактивность',
    tone: 'info' as const,
  },
  {
    t: 'Как VDOM-патч находит изменения',
    d: 'Дерево VNode, `patch`, флаги патча вроде `1 /* TEXT */` и блоки, благодаря которым обычный Vue сравнивает только динамические узлы. Без этого непонятно, с чем сравнивается Vapor.',
    href: '/frameworks/vue-patch-internals/#s6',
    hrefLabel: 'Vue 3 изнутри: рендерер и patch · Флаги и блоки',
    tone: 'warn' as const,
  },
  {
    t: 'Что обновление DOM откладывается до `nextTick`',
    d: 'Запись в `ref` не трогает DOM сразу: эффект встаёт в очередь, очередь разбирается в микрозадаче. Замеры темы считают работу после `await nextTick()` — то есть одну запись целиком.',
    href: '/frameworks/vue-internals/#s6',
    hrefLabel: 'Vue 3 изнутри · Планировщик',
    tone: 'info' as const,
  },
  {
    t: 'Идея «эффект пишет в узел» сама по себе',
    d: 'Как сигналы позволяют обойтись без виртуального DOM и почему так устроены Solid и Svelte 5. Здесь — как это сделано именно во Vue.',
    href: '/frameworks/signals/#s5',
    hrefLabel: 'Сигналы · DOM без VDOM',
    tone: 'ok' as const,
  },
];

// ---------------------------------------------------------------------------
// Раздел 1 · один компонент — два вывода
// ---------------------------------------------------------------------------

export const PLAIN_TEMPLATE =
  'VDOM-вывод — инструкция «собери комнату по кирпичу и сравни с прошлой». Vapor-вывод — фотография готовой комнаты (строка HTML) и список проводов: «этот выключатель — к этой лампочке». Фотографию браузер разбирает один раз, дальше делает с неё копии.';

export const OUTPUT_NOTE =
  'Обычный вывод — то, что Vue выполняет **при каждом** изменении: вызов render-функции целиком, девять вызовов, создающих VNode (`_createElementVNode`, `_createElementBlock`, `_createCommentVNode`), сравнение с прошлым деревом. Vapor-вывод — то, что выполняется **один раз** при создании компонента: клон шаблона, поиск нужных узлов через `_child`/`_next`, подписка эффектов. Потом работают только эффекты.';

export const OUTPUT_FACTS = [
  {
    t: 'Шаблон — строка без закрывающих тегов',
    d: '`"<section class=cart><h2> </h2><p> </p><ul></ul><!><button>+1"` — компилятор выбрасывает кавычки и хвостовые `</…>`, которые парсер HTML восстановит сам. Пробел внутри `<h2> </h2>` — заготовка текстового узла, в который потом пишет `_setText`. `<!>` — комментарий-якорь для `v-if`.',
  },
  {
    t: 'Один эффект на блок, а не на узел',
    d: 'Заголовок зависит от `title`, абзац — от `count`, а эффект у них **один**: компилятор складывает все привязки блока в один `_renderEffect`. Отдельные эффекты получают только строка списка и условие.',
  },
  {
    t: 'Узлы находятся один раз',
    d: '`_child(n11)`, `_next(n0)` — прямой проход по `firstChild`/`nextSibling` в момент создания. Ссылки на узлы живут в замыкании эффекта, и при обновлении искать ничего не нужно.',
  },
  {
    t: 'Числа в комментариях — флаги рантайму',
    d: '`9 /* FAST_REMOVE, IS_SINGLE_NODE */` у `_createFor` и `33 /* TRUE_SINGLE_ROOT, TRUE_NO_SCOPE */` у `_createIf` — подсказки, как и `1 /* TEXT */` у VDOM. Их значения — внутренности 3.6.0-rc.9.',
  },
];

// ---------------------------------------------------------------------------
// Раздел 2 · рантайм
// ---------------------------------------------------------------------------

export const RUNTIME_HEAD = ['помощник', 'что делает в 3.6.0-rc.9', 'при обновлении'];

export const RUNTIME_ROWS: string[][] = [
  ['`template(html, flags)`', 'возвращает функцию; первый вызов разбирает строку через `<template>.innerHTML`, каждый следующий — `cloneNode(true)` готового узла', 'не участвует'],
  ['`child`, `next`, `txt`', '`firstChild`, `nextSibling`, первый ребёнок-текст — только при создании блока', 'не участвуют'],
  ['`renderEffect(fn)`', 'эффект с планировщиком компонента: запись в `ref` ставит его в очередь, `nextTick` дожидается слива', 'перезапускается целиком'],
  ['`setText(node, value)`', 'пишет `nodeValue`, но только если значение отличается от записанного в прошлый раз (`node.$txt`)', 'одна запись или ноль'],
  ['`setClassName(el, flags, cls)`', 'класс из объекта `{ empty: … }` сведён компилятором к битовой маске (числу, где каждый класс — отдельный бит); пишет `className`, только если маска сменилась (`el.$clsFlags`)', 'одна запись или ноль'],
  ['`setProp(el, key, value)`', 'атрибут или DOM-свойство (для `:id="…"` и подобных)', 'одна запись или ноль'],
  ['`on(el, event, fn)`', '`addEventListener` один раз при создании', 'не участвует'],
];

/** Исходник `setText` из `runtime-vapor` 3.6.0-rc.9 — ветка без гидратации. Тест ищет эту строку в dist. */
export const SETTEXT_SOURCE = 'if (el.$txt !== value) el.nodeValue = el.$txt = value;';

export const BLOCK_EFFECT_NOTE =
  'Эффект у корня `Cart` читает и `title`, и `count`. Запись в `title` перезапускает его целиком: `_setText` для счётчика тоже вызывается — но видит в `$txt` ту же строку и в DOM не пишет. Точность до узла здесь даёт не граница эффекта, а память каждой записи. Замер ниже это показывает: смена заголовка — один прогон эффекта, два вызова `setText` и **одна** DOM-операция.';

export const PLAIN_MEMO =
  'Эффект — электрик, который обходит все лампочки своей комнаты, когда щёлкнул любой из её выключателей. Но у каждой лампочки на патроне бирка «сейчас горит вот так», и электрик трогает только те, где бирка не совпадает с нужным.';

// ---------------------------------------------------------------------------
// Раздел 3 · списки и условия
// ---------------------------------------------------------------------------

export const FOR_NOTE =
  '`_createFor` заводит свой эффект, который читает только массив. У каждой строки — свой блок и своя ячейка `_for_item0`: при новом массиве строки с тем же ключом не пересоздаются, а получают новое значение в ячейку, и перезапускается эффект **только этой строки**. Новые строки клонируются из `t0`, лишние снимаются вместе с их эффектами, переставленные двигаются `insertBefore`. Конец списка отмечен пустым текстовым узлом — туда вставляются новые строки.';

export const IF_NOTE =
  '`_createIf` заводит эффект, который читает только условие. Пока результат условия тот же, ветка не трогается: `count` с 4 на 5 — прогон эффекта условия и ноль DOM-операций. Сменился — старая ветка снимается целиком, новая клонируется и вставляется перед якорем `<!>` из шаблона.';

export const FAST_REMOVE_NOTE =
  'Флаг `FAST_REMOVE` компилятор ставит, когда список — единственное содержимое родителя (здесь `<ul>`). Тогда очистка списка — это `ul.textContent = ""` и возврат якоря: **две** DOM-операции при любой длине. VDOM 3.5 на том же шаблоне снимает строки по одной: на пяти строках замер дал 5 операций против 2, на двух — поровну.';

// ---------------------------------------------------------------------------
// Раздел 4 · мини-vapor
// ---------------------------------------------------------------------------

export const MINI_LEAD =
  'Учебный Vapor в четыре шага: ячейки и эффекты, запись в DOM с памятью, блоки для `v-if`/`v-for` и компилятор, который превращает шаблон `Cart` в строки `template` и эффекты. Реактивность здесь нарочно самая простая — `Set` подписчиков; как устроена настоящая, разобрано в [«Vue 3 изнутри: своя реактивность»](/frameworks/vue-internals/).';

export const PLAIN_COMPILE =
  'Компилятор — чертёжник: один раз смотрит на шаблон и пишет инструкцию «скопируй вот это, найди третий узел, повесь на него провод от `count`». Рантайм — монтажник, который по инструкции работает, не заглядывая в шаблон.';

export const MINI_NOTE =
  'Вывод мини-компилятора для шаблона `Cart` — сравните его с настоящим в разделе «Один компонент — два вывода». Те же `template`, `child`/`next`/`txt`, один `renderEffect` на блок и отдельные `createFor`/`createIf`. Отличия — в именах (`setClass` вместо `setClassName` с маской) и в том, что шаблон записан с закрывающими тегами.';

export const MINI_VS_REAL_HEAD = ['что', 'мини-vapor', 'Vue 3.6.0-rc.9'];

export const MINI_VS_REAL_ROWS: string[][] = [
  ['Реактивность', '`Set` подписчиков, очередь в микрозадаче', '`@vue/reactivity` 3.6: связи на alien-signals, планировщик компонентов'],
  ['Шаблон', 'полный HTML', 'минифицированный: без кавычек и хвостовых тегов'],
  ['Класс', 'строка из объекта, память — сама строка', 'битовая маска, собранная компилятором'],
  ['Перестановка строк', 'с конца: каждая перед следующей', 'по наибольшей возрастающей подпоследовательности — меньше переносов на сложных перестановках'],
  ['Шаблоны', '`{{ }}` как единственное содержимое элемента, `:class`, `:attr`, `@event`, `v-if` без `v-else`, `v-for` единственным ребёнком', 'всё, кроме перечисленного в разделе «Чего нет в rc.9»'],
  ['Гидратация, компоненты, слоты', 'нет', 'есть'],
];

export const MINI_VS_REAL_NOTE =
  'На всех действиях из раздела «Одна запись» мини-vapor и настоящий Vapor 3.6.0-rc.9 совпадают по числу прогонов эффектов, по видам DOM-операций и по итоговому HTML — в обеих сборках Vue. Перестановку проверяли только разворотом: там переносов поровну; на произвольной перестановке мини может перенести больше.';

// ---------------------------------------------------------------------------
// Раздел 5 · одна запись: VDOM против Vapor
// ---------------------------------------------------------------------------

/** Действия читателя. Код исполняется над ячейками `title`, `count`, `items` обеих сторон. */
export const SCENARIOS: Scenario[] = [
  { id: 'inc', label: 'count++', code: 'count.value++' },
  { id: 'title', label: 'новый заголовок', code: "title.value = title.value === 'Корзина' ? 'Заказ' : 'Корзина'" },
  { id: 'same', label: 'count = count', code: 'count.value = count.value' },
  { id: 'push', label: '+ строка', code: "items.value = [...items.value, { id: (items.value.at(-1)?.id ?? 0) + 1, name: 'хлеб' }]" },
  { id: 'rename', label: 'переименовать первую', code: "items.value = items.value.map((it, i) => (i === 0 ? { ...it, name: it.name + '!' } : it))" },
  { id: 'toggle', label: 'count > 3 ↔ 0', code: 'count.value = count.value > 3 ? 0 : 4' },
  { id: 'reverse', label: 'развернуть список', code: 'items.value = [...items.value].reverse()' },
  { id: 'pop', label: '− последняя', code: 'items.value = items.value.slice(0, -1)' },
  { id: 'clear', label: 'очистить список', code: 'items.value = []' },
];

/** Последовательность замера: с только что смонтированного `Cart`, по порядку. */
export const SEQUENCE = ['inc', 'title', 'same', 'push', 'rename', 'toggle', 'toggle', 'reverse', 'pop', 'clear'];

/**
 * Замер `SEQUENCE`. VDOM — Vue 3.5.42 и 3.6.0-rc.9 (числа совпали), Vapor — 3.6.0-rc.9
 * и мини-vapor (совпали). `render` — вызовы render-функции, `vnodes` — вызовы помощников,
 * создающих VNode, `effects` — прогоны `ReactiveEffect.run` (у мини — `renderEffect`),
 * `ops` — DOM-операции щупа `widgets/vapor-lab/model/probe.ts`. Детерминировано: не время.
 */
export const MEASURED: MeasuredRow[] = [
  { id: 'inc', vdom: { render: 1, vnodes: 9, ops: 2 }, vapor: { effects: 2, ops: 2 } },
  { id: 'title', vdom: { render: 1, vnodes: 9, ops: 1 }, vapor: { effects: 1, ops: 1 } },
  { id: 'same', vdom: { render: 0, vnodes: 0, ops: 0 }, vapor: { effects: 0, ops: 0 } },
  { id: 'push', vdom: { render: 1, vnodes: 10, ops: 3 }, vapor: { effects: 2, ops: 3 } },
  { id: 'rename', vdom: { render: 1, vnodes: 10, ops: 1 }, vapor: { effects: 2, ops: 1 } },
  { id: 'toggle', vdom: { render: 1, vnodes: 10, ops: 5 }, vapor: { effects: 2, ops: 3 } },
  { id: 'toggle', vdom: { render: 1, vnodes: 10, ops: 5 }, vapor: { effects: 2, ops: 3 } },
  { id: 'reverse', vdom: { render: 1, vnodes: 10, ops: 2 }, vapor: { effects: 1, ops: 2 } },
  { id: 'pop', vdom: { render: 1, vnodes: 9, ops: 1 }, vapor: { effects: 1, ops: 1 } },
  { id: 'clear', vdom: { render: 1, vnodes: 7, ops: 2 }, vapor: { effects: 1, ops: 2 } },
];

export const MEASURED_HEAD = ['действие', 'VDOM: render', 'VDOM: VNode', 'VDOM: DOM', 'Vapor: эффекты', 'Vapor: DOM'];

export const MEASURED_ROWS: string[][] = MEASURED.map((row) => [
  `\`${SCENARIOS.find((s) => s.id === row.id)!.code}\``,
  String(row.vdom.render),
  String(row.vdom.vnodes),
  String(row.vdom.ops),
  String(row.vapor.effects),
  String(row.vapor.ops),
]);

export const PLAIN_MEASURE =
  'Обе бригады в итоге меняют одинаковое число лампочек — и обычный Vue, и Vapor трогают в DOM только то, что изменилось. Разница в том, сколько бумаги исписано до этого: обычный Vue перерисовывает эскиз всей комнаты (9–10 VNode на каждое действие), Vapor только проверяет бирки на одной-двух линиях.';

export const MEASURE_NOTE =
  'Главное в таблице — не последний столбец. DOM-операций у двух сторон почти поровну: флаги патча уже приучили обычный Vue трогать только изменившееся. Разница в работе **до** DOM: VDOM на любое действие вызывает render целиком и создаёт 7–10 VNode, чтобы потом сравнить их с прошлыми, а Vapor прогоняет один-два маленьких эффекта. На `v-if` Vapor ещё и экономит DOM: ветка вставляется клоном шаблона, а не собирается по элементу, и якорь-комментарий не пересоздаётся.';

/**
 * Одно действие таблицы `MEASURED` — по шагам с обеих сторон. Добавлено по решению автора
 * курса (2026-09-29): таблица давала десять строк чисел, а откуда берётся каждое число,
 * читатель должен был собрать сам из трёх разделов. Здесь первое действие замера
 * (`count.value++` на только что смонтированном `Cart`, 0 → 1) разобрано по коду `VDOM_CODE`
 * и `VAPOR_CODE`. Итоговые числа — 1 render, 9 VNode, 2 DOM-операции против 2 эффектов
 * и 2 DOM-операций — из `MEASURED`, сверяемого тестом; кто именно пишет в DOM, выведено
 * из тех же выводов компилятора и из поведения `setText`/`setClassName` (`RUNTIME_ROWS`).
 */
export const INC_SCENE_CODE = `// Cart только что смонтирован: count = 0, title = 'Корзина', две строки
count.value++     // 0 → 1

// в DOM должно измениться ровно два места у <p>:
//   класс «empty» — снять;  текст «Товаров: 0» → «Товаров: 1»`;

export const INC_SCENE_NOTE =
  'Итог у обеих сторон один и тот же — две записи в DOM, и обе стороны его достигают. Разница в том, **как они узнают**, какие два места трогать. Обычный Vue не знает этого заранее: он заново описывает весь компонент и ищет отличия от прошлого описания. Vapor знает с момента компиляции: от `count` зависят эффект корня и эффект `v-if`, и больше никто.';

export const INC_STEPS: { k: string; when: string; what: string; cost: string }[] = [
  {
    k: 'VDOM · render',
    when: 'в микрозадаче, задание компонента `Cart`',
    what: 'Render-функция вызывается **целиком**, хотя изменился один `ref`. Она строит новое дерево: `section`, `h2`, `p`, `ul`, фрагмент списка, два `li`, комментарий на месте `v-if`, `button` — девять VNode. Строки списка и заголовок описаны заново, хотя с ними ничего не случилось.',
    cost: '1 вызов render и **9** новых объектов VNode на одно `count++`.',
  },
  {
    k: 'VDOM · patch',
    when: 'сразу после render, новое дерево против старого',
    what: 'Флаги патча сужают сравнение до помеченного: у `h2` флаг `TEXT` — текст сравнён, прежний; у `p` — `TEXT, CLASS`: оба изменились, **две записи**. Список идёт по ключам: ключи прежние, тексты строк прежние — записей нет. Условие `count > 3` по-прежнему ложно: комментарий на месте.',
    cost: '**2** DOM-операции. Их столько же, сколько у Vapor, — флаги уже научили VDOM не трогать лишнего.',
  },
  {
    k: 'Vapor · эффект корня',
    when: 'в микрозадаче: эффект читал `count` и проснулся',
    what: 'Выполняется тот `_renderEffect`, что компилятор собрал для блока `section`. Все три вызова внутри него: `_setText` заголовка видит в `$txt` то же «Корзина» и **не пишет**; `_setClassName` видит, что маска сменилась, и пишет `className`; `_setText` счётчика пишет «Товаров: 1».',
    cost: '1 прогон эффекта, три сравнения с памятью узла, **2** записи в DOM. Ни одного описания дерева.',
  },
  {
    k: 'Vapor · эффект `v-if`',
    when: 'в той же микрозадаче: он тоже читал `count`',
    what: '`_createIf` следит только за `count > 3`. Было `false`, стало `false` — ветку не трогает. Эффект строк списка `count` не читал вовсе и не просыпается.',
    cost: '1 прогон эффекта и ноль DOM-операций. Всего у Vapor — **2** прогона эффектов, как в таблице ниже.',
  },
];

/** «На пальцах»: продолжение двух бригад из `PLAIN_MEASURE` на одном щелчке. */
export const PLAIN_INC =
  'Те же две бригады, щёлкнули выключателем `count`. Первая перерисовывает эскиз всей комнаты — девять предметов, от заголовка до кнопки, — кладёт рядом с прошлым эскизом и сверяет: отличаются две детали абзаца. Вторая берёт журнал проводов: от этого выключателя идут две линии. По первой — три лампочки, у двух бирки не совпали, их и поменяли; по второй — табличка «доставка», её бирка совпала. Лампочек поменяли поровну; бумаги у второй бригады ушло в разы меньше.';

/**
 * Список по ключам в Vapor — действие «переименовать первую» из `SEQUENCE`. Добавлено тем же
 * проходом: `FOR_NOTE` говорил «перезапускается эффект только этой строки» одной фразой.
 * К этому шагу замера в списке три строки (после `push`). Числа — Vapor: 2 прогона
 * эффектов, 1 DOM-операция; VDOM: 1 render, 10 VNode, 1 DOM-операция — из `MEASURED`.
 * Какой эффект чем был разбужен — прочитано по `VAPOR_CODE` (`_createFor`, ячейка `_for_item0`).
 */
export const RENAME_SCENE_CODE = `// в списке три строки: чай, сыр, хлеб
items.value = items.value.map((it, i) =>
  i === 0 ? { ...it, name: it.name + '!' } : it    // новый объект — только у первой
)`;

export const RENAME_STEPS: { k: string; when: string; what: string; cost: string }[] = [
  {
    k: 'Эффект списка',
    when: '`items.value` получил новый массив',
    what: 'Эффект `_createFor` читал только `items.value` — он и просыпается. Сверяет ключи: `1, 2, 3` — те же, в том же порядке. Значит, ни одна строка не создаётся, не удаляется и не двигается. Каждой строке в её ячейку `_for_item0` кладётся элемент нового массива.',
    cost: '1 прогон эффекта и сверка ключей — без единой DOM-операции.',
  },
  {
    k: 'Эффект первой строки',
    when: 'в её ячейку лёг **новый** объект',
    what: 'Эффект строки читал `_for_item0.value.name` — ячейка сменилась, и он перезапускается: `_setText` видит «чай!» вместо «чай» и пишет `nodeValue`.',
    cost: '1 прогон эффекта и **1** запись в DOM.',
  },
  {
    k: 'Вторая и третья строки',
    when: 'в их ячейки лёг **тот же** объект',
    what: '`map` вернул для них прежние `it`, значение ячейки не изменилось — их эффекты не будятся вовсе. Всего за действие — два прогона эффектов, как в таблице ниже. У VDOM на том же действии — вызов render и десять VNode: все три строки описаны заново, чтобы выяснить, что поменялась одна.',
    cost: 'Ничего.',
  },
];

export const DEMO_NOTE =
  'Слева — обычная render-функция `Cart` из раздела «Один компонент — два вывода», исполненная на Vue 3.5.42 этого сайта; справа — тот же шаблон, скомпилированный мини-vapor из раздела «Мини-vapor: компилятор и рантайм». Кнопки применяют одно действие к обеим сторонам; щуп считает DOM-операции одинаково с обеих, а подсветка показывает, какие узлы тронуты. Настоящий Vapor 3.6 на страницу не загружается; его числа в таблице выше сняты отдельно и на всех этих действиях равны числам правой колонки.';

// ---------------------------------------------------------------------------
// Раздел 6 · как включить и смешать
// ---------------------------------------------------------------------------

export const ENABLE_CODE = `<!-- компонент целиком на Vapor -->
<script setup vapor>
import { ref } from 'vue'
const count = ref(0)
</script>

// приложение только из Vapor-компонентов
import { createVaporApp } from 'vue'
createVaporApp(App).mount('#app')

// обычное приложение, в котором есть Vapor-компоненты
import { createApp, vaporInteropPlugin } from 'vue'
createApp(App).use(vaporInteropPlugin).mount('#app')`;

export const ENABLE_FACTS = [
  {
    t: 'Переключатель — атрибут `vapor`',
    d: '`@vue/compiler-sfc` 3.6.0-rc.9 ставит `descriptor.vapor`, если атрибут есть у `<script>` или у `<template>`. Для компонента без скрипта хватает `<template vapor>`.',
  },
  {
    t: '`<script vapor>` — это `<script setup>`',
    d: 'Без `setup` блок с `vapor` всё равно разбирается как `<script setup>`. Поэтому `export default { data() {…} }` внутри него — ошибка компиляции «`<script setup>` cannot contain ES module exports».',
  },
  {
    t: 'Приложение: `createVaporApp` или `createApp` + плагин',
    d: '`createVaporApp` монтирует дерево из одних Vapor-компонентов. Если в дереве есть и VDOM-, и Vapor-компоненты, в любом направлении нужен `vaporInteropPlugin` — см. таблицу ниже.',
  },
];

export const APPS_HEAD = ['приложение', 'внутри', 'без плагина', 'с `vaporInteropPlugin`'];

export const APPS_ROWS: string[][] = [
  ['`createApp`', 'Vapor-компонент', 'предупреждение в dev и `TypeError` при монтировании в обеих сборках', 'рендерится'],
  ['`createVaporApp`', 'VDOM-компонент', 'пустое место на месте компонента; в dev — предупреждение, в prod — **ни слова**', 'рендерится'],
  ['`createVaporApp`', 'только Vapor', 'рендерится', 'не нужен'],
];

export const APPS_NOTE =
  'Вторая строка — самая опасная: продакшен-сборка молча оставляет пустоту на месте VDOM-компонента. Проверено монтированием обеих сборок 3.6.0-rc.9.';

// ---------------------------------------------------------------------------
// Раздел 7 · чего нет в rc.9
// ---------------------------------------------------------------------------

export const LIMITS = [
  {
    t: 'Options API',
    d: 'Проверено: в SFC его не записать (`<script vapor>` — это `<script setup>`), а у `defineVaporComponent({ data, mounted, setup })` опции `data` и `mounted` молча игнорируются — ни значения, ни вызова хука, ни предупреждения в dev.',
    tone: 'err' as const,
  },
  {
    t: '`getCurrentInstance()`',
    d: 'Проверено: внутри `setup` Vapor-компонента возвращает `null`, в VDOM-компоненте — объект. Библиотеки, которые берут через него `proxy`, `appContext` или провайдеры, в Vapor-компоненте ломаются.',
    tone: 'err' as const,
  },
  {
    t: '`app.config.globalProperties`',
    d: 'Проверено: `{{ $x }}` компилируется в голое `$x`, и в dev монтирование падает с `ReferenceError: $x is not defined`; в prod `mount` не бросает: та же `ReferenceError` уходит в `console.error`, а на месте компонента пусто. В VDOM-компоненте то же выражение печатает значение.',
    tone: 'warn' as const,
  },
  {
    t: '⚠️ `<Suspense>` и `@vue:mounted` на элементах',
    d: 'Не проверялось запуском и не сверялось с первоисточником: так пишут обзоры беты 3.6 (см. «Источники»). `<Suspense>` в дереве из одних Vapor-компонентов не поддержан, события жизненного цикла элемента (`@vue:mounted` и соседние) не работают. Перед тем как полагаться — проверить на своей версии.',
  },
];

// ---------------------------------------------------------------------------
// Раздел 8 · вес
// ---------------------------------------------------------------------------

export const WEIGHT_HEAD = ['файл `vue@3.6.0-rc.9/dist`', 'байт', 'что внутри'];

export const WEIGHT_ROWS: string[][] = [
  ['`vue.runtime.esm-browser.prod.js`', '117 666', 'VDOM-рантайм, как в 3.5'],
  ['`vue.runtime-with-vapor.esm-browser.prod.js`', '241 730', 'VDOM + Vapor + интероп: всё сразу'],
];

/** Приложение для замера сборки: один счётчик. Компилируется в обоих режимах. */
export const BUNDLE_APP = `<script setup vapor>
import { ref } from 'vue'
const count = ref(0)
</script>
<template><button @click="count++">{{ count }}</button></template>`;

export const BUNDLE_HEAD = ['точка входа', 'байт после минификации', 'gzip -9'];

export const BUNDLE_ROWS: string[][] = [
  ['`createApp(App)` — VDOM', '55 792', '21 483'],
  ['`createVaporApp(App)` — только Vapor', '41 603', '15 377'],
  ['`createApp(App).use(vaporInteropPlugin)` — Vapor внутри VDOM', '115 082', '41 198'],
];

export const BUNDLE_NOTE =
  'Устойчиво здесь отношение, а не байты: приложение только на Vapor легче VDOM-приложения примерно на четверть, смешанное — вдвое тяжелее. Отсюда практический вывод: переводить на Vapor один компонент ради веса бессмысленно — выигрыш появляется, только когда на `createVaporApp` переходит всё дерево. Условия: rolldown 1.2.8, ESM, минификация, продакшен-флаги Vue; каждая сборка проверена в работе — кнопка печатает `0`, после клика `1`.';

// ---------------------------------------------------------------------------
// Раздел 9 · тонкие места
// ---------------------------------------------------------------------------

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: '«В Vapor у каждого узла свой эффект»',
    d: 'В 3.6.0-rc.9 — нет: все привязки блока компилируются в **один** `renderEffect`. Смена `title` в `Cart` перезапускает и запись счётчика; DOM не трогается только потому, что `setText` помнит прошлое значение. Для подсчёта «сколько кода выполнится» границей служит блок, а не узел.',
    tone: 'warn',
  },
  {
    n: '02',
    t: '«Vapor пишет в DOM меньше»',
    d: 'На действиях темы DOM-операций у VDOM и Vapor поровну или почти поровну: флаги патча уже научили VDOM трогать только изменившееся. Выигрыш Vapor — в JS до DOM: нет вызова render и нет 7–10 VNode на каждое действие. Меньше DOM выходит на ветках `v-if` и на очистке списка (`FAST_REMOVE`).',
  },
  {
    n: '03',
    t: 'Один Vapor-компонент в VDOM-приложении делает сборку тяжелее',
    d: 'Чтобы смешать режимы, в сборку попадают оба рантайма и интероп: 115 КБ против 56 КБ у чистого VDOM на том же счётчике (rolldown 1.2.8). Вес уменьшается, только когда приложение целиком переходит на `createVaporApp`.',
    tone: 'warn',
  },
  {
    n: '04',
    t: 'VDOM-компонент в `createVaporApp` без плагина — пустота без ошибок',
    code: "createVaporApp(App).mount('#app')   // внутри App — обычный компонент\n// prod: <div></div>, в консоли ничего",
    d: 'Продакшен-сборка 3.6.0-rc.9 не предупреждает и не бросает — компонент просто не рендерится. В dev есть предупреждение «setup() returned non-block value». → в любом смешанном дереве ставить `vaporInteropPlugin`.',
    tone: 'err',
  },
  {
    n: '05',
    t: '`getCurrentInstance()` в Vapor-компоненте — `null`',
    d: 'Код, который писал `getCurrentInstance()!.proxy`, упадёт на `null`. Это касается и библиотек: проверять нужно не только свои компоненты, но и всё, что вызывается в их `setup`.',
    tone: 'err',
  },
  {
    n: '06',
    t: '`<script vapor>` без `setup` — всё равно `<script setup>`',
    d: 'Атрибут `vapor` сам включает режим `setup`. Попытка оставить в таком блоке `export default` с опциями — ошибка компиляции, а переписать компонент через `defineVaporComponent` с `data()` — тихая потеря данных: опция игнорируется.',
    tone: 'warn',
  },
  {
    n: '07',
    t: 'Вывод компилятора — не API',
    d: '`setClassName`, `setInsertionState`, числа флагов и форма строки шаблона — внутренности релиз-кандидата. Всё в теме, что опирается на них, подписано версией 3.6.0-rc.9 и может измениться к релизу.',
  },
];

// ---------------------------------------------------------------------------
// Раздел 10 · источники
// ---------------------------------------------------------------------------

export const SOURCES = [
  {
    title: '`runtime-vapor` · `apiTemplate.ts`, `dom/prop.ts`, `renderEffect.ts`',
    href: 'https://github.com/vuejs/core/tree/main/packages/runtime-vapor/src',
    what: '`template` с разбором через `<template>` и клонированием, `setText`/`setClassName` с памятью на узле, `RenderEffect` поверх `ReactiveEffect`. Здесь читались по `dist/runtime-vapor.esm-bundler.js` 3.6.0-rc.9.',
  },
  {
    title: '`runtime-vapor` · `apiCreateFor.ts`, `apiCreateIf.ts`',
    href: 'https://github.com/vuejs/core/tree/main/packages/runtime-vapor/src',
    what: 'Списки и условия: ячейки строк, флаг `FAST_REMOVE`, `DynamicFragment` для ветки `v-if`.',
  },
  {
    title: '`compiler-vapor` · `generators/block.ts`, `transform.ts`',
    href: 'https://github.com/vuejs/core/tree/main/packages/compiler-vapor/src',
    what: '`registerEffect` и `genEffects`: почему все привязки блока оказываются в одном `renderEffect`.',
  },
  {
    title: 'Release v3.6.0-beta.1 · vuejs/core',
    href: 'https://github.com/vuejs/core/releases/tag/v3.6.0-beta.1',
    what: 'Заметки к первой бете с Vapor Mode: как включать, `vaporInteropPlugin`, список неподдержанного. ⚠️ При подготовке темы страница не открывалась — ссылка для сверки пункта с ⚠️ в разделе «Чего нет в rc.9».',
  },
  {
    title: 'Vapor Mode in Practice · certificates.dev',
    href: 'https://certificates.dev/blog/vapor-mode-in-practice',
    what: 'Обзор ограничений беты: Options API, `getCurrentInstance`, `globalProperties`, события жизненного цикла элементов. Первые три здесь проверены запуском.',
  },
];

export const RELATED =
  'Смежное на сайте: [Компиляторы фреймворков](/frameworks/framework-compilers/) — как ту же задачу решают React Compiler, Svelte и Solid. [Сигналы](/frameworks/signals/#s5) — идея «эффект пишет в узел» без привязки к Vue. [Vue 3 изнутри: рендерер и patch](/frameworks/vue-patch-internals/#s6) — флаги патча и блоки, с которыми здесь сравнивается Vapor. [Vue 3 изнутри: своя реактивность](/frameworks/vue-internals/) — `ref`, эффект и [планировщик](/frameworks/vue-internals/#s6), на которых стоит Vapor. [Реактивность Vue](/frameworks/vue-reactivity/) — то же снаружи. [SSR и гидратация](/frameworks/ssr-hydration/) — что такое гидратация, которую поддерживает настоящий Vapor и не поддерживает мини. [Svelte 5 изнутри](/frameworks/svelte-runes/) — руны как сигналы, вывод компилятора и флаги графа.';
