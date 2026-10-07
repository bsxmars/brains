import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { MiniPreset } from '@/widgets/fc-mini-compiler';

/**
 * Данные темы «Компиляторы фреймворков».
 *
 * Здесь три рода строк, и у каждого свой сторож — `tests/unit/framework-compilers.test.ts`:
 *
 *   1. **Учебный компилятор** `MINI_COMPILER_CODE` (шаги `STEP_*`). Печатается в теме по шагам,
 *      исполняется демо (`widgets/fc-mini-compiler/model/lab.ts`) и тестом — **той же строкой**,
 *      через `new Function`. Копии нет.
 *   2. **Исходники для настоящих компиляторов** (`*_SRC`). Тест прогоняет их через
 *      `babel-plugin-react-compiler` 1.0.0 (на `@babel/core` 7.29.7), `svelte/compiler` 5.57.1
 *      и `babel-preset-solid` 1.9.15 — и сверяет результат с литералами `*_OUT` **целиком**,
 *      строка в строку. Литерал снят с этих версий: обновление компилятора покраснит тест,
 *      и это правильно — на странице напечатан вывод, а не пересказ вывода.
 *   3. **Числа** (`UPDATE_COUNTS`, счётчики в тонких местах). Тест исполняет скомпилированное
 *      в happy-dom 20.14.5 (React 19.3.0 через `react-dom/client`, Svelte через `mount`
 *      клиентской сборки, Solid через `solid-js/web` браузерной сборки) и считает вызовы функций
 *      компонентов и записи `MutationObserver`.
 *
 * ⚠️ **Числа записей DOM сняты в happy-dom, а не в браузере.** Все записи, на которые здесь
 * опирается тема, — `characterData` (смена текста узла), и тест требует, чтобы других не было:
 * это единственный вид записи, который по спецификации DOM даёт ровно одну запись на одно
 * присваивание. Vue в сравнение не включён по этой причине: его обновление текста через
 * `textContent` happy-dom записывает двумя записями `childList`, и число зависело бы от
 * реализации DOM, а не от Vue.
 *
 * По документации, не запуском (⚠️): что React Compiler 1.0 — стабильный релиз и включается
 * плагином сборки (react.dev, «React Compiler»); что `panicThreshold` управляет тем, падает ли
 * сборка на ошибке (README пакета); что в Svelte 5 компонент без рун компилируется в режиме
 * совместимости (документация Svelte, «Legacy APIs») — тест видит это как лишний импорт
 * `svelte/internal/flags/legacy`, но смысл режима не проверяет.
 */

// ---------------------------------------------------------------------------
// Вводный раздел
// ---------------------------------------------------------------------------

export const INTRO_NOTE =
  'Узнать, что изменилось, можно в браузере — вызвать компонент заново и сравнить результат с прошлым, — а можно при сборке: прочитать код и выписать, какое место от чего зависит. React без компилятора целиком на первой стороне, Svelte и Solid — на второй, React Compiler и компилятор шаблонов Vue — между ними. Цена переноса в сборку — ограничения на то, как писать компонент: компилятор оптимизирует только то, что сумел понять.';

export const PLAIN_INTRO =
  'Представьте два способа проверять квартиру после ремонта. Первый: каждый раз обходить все комнаты и сравнивать с фотографией «как было». Второй: ещё при ремонте записать, что в комнате 3 от выключателя зависит только лампа, — и после щелчка смотреть только на неё. Первый способ ничего не знает заранее и потому надёжен для любой квартиры; второй быстрее, но работает, только пока записи верны. Компилятор фреймворка — это тот, кто делает записи.';

export const GLOSSARY = [
  {
    k: 'Компилятор фреймворка',
    d: 'Программа, которая при сборке переписывает ваш компонент в другой JS. Результат делает то же самое, но рантайму остаётся меньше работы: часть решений принята заранее.',
  },
  {
    k: 'Сборка и рантайм',
    d: 'Сборка — то, что происходит на машине разработчика или на сервере сборки (CI) до публикации: Babel, Vite, компиляторы. Рантайм — то, что исполняется в браузере у читателя. Работа, перенесённая в сборку, у читателя не стоит ничего.',
  },
  {
    k: 'Виртуальный DOM',
    d: 'Дерево обычных JS-объектов, описывающих разметку. Рендер строит новое дерево, сравнение с прошлым находит разницу, и только она уходит в настоящий DOM.',
  },
  {
    k: 'Мемоизация',
    d: 'Запомнить результат вычисления и вернуть запомненное, пока входы те же. В React это `useMemo`, `useCallback` и `memo`, которые обычно расставляют руками.',
  },
  {
    k: 'Шаблон и клонирование',
    d: 'Статическая часть разметки один раз разбирается браузером в DOM-фрагмент, а каждый новый экземпляр компонента получает его копию через `cloneNode(true)` — без повторного разбора HTML.',
  },
  {
    k: 'Точечное обновление',
    d: 'Изменение одного значения трогает только те узлы DOM, которые от него зависят: один текстовый узел, один атрибут. Ни функция компонента, ни сравнение деревьев при этом не нужны.',
  },
  {
    k: 'Руны',
    d: 'В Svelte 5 — особые имена вида `$state`, `$derived`, `$effect`. Выглядят как вызовы функций, но функций с такими именами нет: компилятор узнаёт их и переписывает код вокруг них.',
  },
  {
    k: 'Отказ от компиляции (bailout)',
    d: 'Компилятор не смог доказать, что оптимизация безопасна, и оставил функцию как есть. У React Compiler так бывает при нарушении правил React — и по умолчанию без ошибки сборки.',
  },
];

export const PREREQ = [
  {
    t: 'Как React перерисовывает компонент и что такое ручная мемоизация',
    d: 'Изменение состояния вызывает функцию компонента заново вместе со всеми детьми; `memo`, `useMemo` и `useCallback` позволяют пропустить часть работы. React Compiler расставляет их за вас — и понять его вывод без этого нельзя.',
    href: '/frameworks/react-rerender/#s5',
    hrefLabel: 'Ре-рендеринг в React · Мемоизация',
    tone: 'warn' as const,
  },
  {
    t: 'Что делает виртуальный DOM',
    d: 'Рендер строит дерево описаний, сравнение находит разницу с прошлым деревом. Svelte и Solid убирают именно этот шаг, а Vue оставляет его, но облегчает подсказками компилятора.',
    href: '/frameworks/vue-patch-internals/#s2',
    hrefLabel: 'Vue 3 изнутри: рендерер и patch · mount и patch',
    tone: 'info' as const,
  },
  {
    t: 'Как сигнал запоминает своих читателей',
    d: 'Чтение внутри эффекта подписывает эффект, запись будит подписанных. Svelte 5 и Solid строят точечные обновления DOM ровно на этом механизме — здесь он не пересказывается.',
    href: '/frameworks/signals/#s5',
    hrefLabel: 'Сигналы · DOM без VDOM',
    tone: 'info' as const,
  },
];

// ---------------------------------------------------------------------------
// Спектр: где делается работа
// ---------------------------------------------------------------------------

export const SPECTRUM_HEAD = ['', 'что знает сборка', 'что делает рантайм при изменении', 'где разобрано'];

export const SPECTRUM_ROWS: string[][] = [
  [
    'React без компилятора',
    'ничего: JSX превращается в вызовы `jsx()`, и только',
    'вызывает функцию компонента и всех детей, сравнивает новые элементы с прошлыми',
    '[Ре-рендеринг в React](/frameworks/react-rerender/)',
  ],
  [
    'React Compiler',
    'какие значения от каких пропсов и состояния зависят',
    'вызывает функцию компонента, но внутри неё пропускает всё, у чего входы не изменились, — и детей, чей элемент остался тем же объектом',
    'здесь, ниже',
  ],
  [
    'Vue 3 (шаблоны)',
    'какие места шаблона статичны, а какие — и в каком смысле — изменчивы',
    'вызывает рендер-функцию компонента, но сравнивает только помеченные узлы',
    '[флаги и блоки](/frameworks/vue-patch-internals/#s6)',
  ],
  [
    'Svelte 5, Solid',
    'все изменчивые места шаблона и то, от чего каждое зависит',
    'функция компонента не вызывается вовсе: запись в состояние будит эффект одного узла',
    'здесь, ниже',
  ],
  [
    'Vue Vapor Mode',
    'то же, что у Svelte и Solid, но для шаблонов Vue',
    'без виртуального DOM, прямыми операциями (⚠️ здесь не запускалось)',
    '[Vue Vapor Mode](/frameworks/vue-vapor/)',
  ],
];

export const SPECTRUM_NOTE =
  'Чем правее по этой шкале, тем меньше работы в браузере и тем строже язык компонента. React Compiler принимает обычный JS и потому может лишь пропускать работу, которую вы и так написали. Svelte и Solid требуют писать изменчивое так, чтобы компилятор его увидел, — зато от компонента на время обновления не остаётся ничего, кроме эффектов на узлах.';

// ---------------------------------------------------------------------------
// Учебный компилятор
// ---------------------------------------------------------------------------

export const PLAIN_TEMPLATE =
  'Шаблон `<p>Нажато {count}</p>` — это бланк с одной пустой графой. Перерисовывать весь бланк ради новой цифры незачем: достаточно один раз напечатать стопку пустых бланков и потом вписывать число в графу. Компилятор делает ровно это: отделяет напечатанное (статику) от граф (изменчивых мест) и для каждой графы пишет, от чего она зависит.';

/** Шаг 1: строка шаблона → дерево. */
export const STEP_PARSE = String.raw`const VOID = new Set(['br', 'hr', 'img', 'input'])
const TOKEN = /<\/([a-z][a-z0-9]*)\s*>|<([a-z][a-z0-9]*)((?:\s+[a-z-]+="[^"]*")*)\s*\/?>|([^<]+)/giy

function parse(source) {
  const root = { children: [] }
  const stack = [root]
  TOKEN.lastIndex = 0
  while (TOKEN.lastIndex < source.length) {
    const at = TOKEN.lastIndex
    const m = TOKEN.exec(source)
    if (!m) throw new SyntaxError('не разобрать шаблон с позиции ' + at)
    const [, close, tag, attrs, text] = m
    const parent = stack[stack.length - 1]
    if (close) {
      if (stack.length === 1 || parent.tag !== close) throw new SyntaxError('лишний </' + close + '>')
      stack.pop()
    } else if (tag) {
      const el = { type: 'element', tag, attrs: [], children: [] }
      for (const [, name, value] of attrs.matchAll(/([a-z-]+)="([^"]*)"/g)) {
        const hole = /^\{(.+)\}$/.exec(value)
        el.attrs.push(hole ? { name, expr: hole[1].trim() } : { name, value })
      }
      parent.children.push(el)
      if (!VOID.has(tag)) stack.push(el)
    } else {
      // текст режется на статику и дыры: 'Нажато {count}' → 'Нажато ', {count}
      for (const part of text.split(/(\{[^}]+\})/)) {
        if (!part) continue
        const hole = /^\{(.+)\}$/.exec(part)
        parent.children.push(hole ? { type: 'hole', expr: hole[1].trim() } : { type: 'text', value: part })
      }
    }
  }
  if (stack.length > 1) throw new SyntaxError('не закрыт <' + stack[stack.length - 1].tag + '>')
  return root
}`;

/** Шаг 2: анализ — от каких имён зависит выражение. */
export const STEP_ANALYZE = String.raw`const NAME = /(^|[^.\w$])([A-Za-z_$][\w$]*)/g
const KEYWORDS = new Set(['true', 'false', 'null', 'undefined'])

function depsOf(expr) {
  if (!/^[\w$.\s+\-*/%()<>=!&|?:]*$/.test(expr)) throw new SyntaxError('в выражении {' + expr + '} есть недопустимый знак')
  return [...new Set([...expr.matchAll(NAME)].map((m) => m[2]).filter((n) => !KEYWORDS.has(n)))]
}

function toJs(expr) {                 // count * 2 → s.count * 2
  return expr.replace(NAME, (all, before, name) => KEYWORDS.has(name) ? all : before + 's.' + name)
}`;

/** Шаг 3: генерация — статика уходит в HTML, изменчивое — в `update`. */
export const STEP_GENERATE = String.raw`function compile(source) {
  const ast = parse(source)
  let html = ''
  const find = []                     // один раз при монтировании: найти узлы
  const update = []                   // при каждом изменении: только зависимые места
  const names = new Set()
  let id = 0

  function guard(expr) {
    const deps = depsOf(expr)
    if (!deps.length) throw new SyntaxError('в {' + expr + '} нет ни одного имени — меняться тут нечему')
    deps.forEach((d) => names.add(d))
    return deps.map((d) => 'changed.' + d).join(' || ')
  }

  function walk(children, path) {
    children.forEach((node, i) => {
      const at = path + '.childNodes[' + i + ']'
      if (node.type === 'text') {
        html += node.value.replace(/&/g, '&amp;')
      } else if (node.type === 'hole') {
        const v = 't' + id++
        html += '<!---->'             // метка на месте будущего текстового узла
        find.push('const ' + v + ' = rt.hole(' + at + ')')
        update.push('if (' + guard(node.expr) + ') rt.text(' + v + ', ' + toJs(node.expr) + ')')
      } else {
        const v = 'e' + id++
        html += '<' + node.tag
        let dynamic = false
        for (const a of node.attrs) {
          if ('value' in a) { html += ' ' + a.name + '="' + a.value + '"'; continue }
          dynamic = true
          update.push('if (' + guard(a.expr) + ') rt.attr(' + v + ", '" + a.name + "', " + toJs(a.expr) + ')')
        }
        html += '>'
        if (dynamic) find.push('const ' + v + ' = ' + at)
        walk(node.children, at)
        if (!VOID.has(node.tag)) html += '</' + node.tag + '>'
      }
    })
  }
  walk(parse(source).children, 'root')

  const all = [...names].map((n) => n + ': true').join(', ')
  const code = [
    'const tpl = rt.template(' + JSON.stringify(html) + ')',
    '',
    'return function mount(target, s) {',
    '  const root = rt.clone(tpl)',
    ...find.map((l) => '  ' + l),
    '  function update(s, changed) {',
    ...update.map((l) => '    ' + l),
    '  }',
    '  update(s, { ' + all + ' })   // первое заполнение: «изменилось всё»',
    '  target.append(root)',
    '  return update',
    '}',
  ].join('\n')
  return { html, code, names: [...names] }
}`;

/** Шаг 4: рантайм — всё, что остаётся делать в браузере. */
export const STEP_RUNTIME = String.raw`function createRuntime(document, log) {
  return {
    template(html) {                  // разбор HTML — один раз на компонент
      const t = document.createElement('template')
      t.innerHTML = html
      return t
    },
    clone: (tpl) => tpl.content.cloneNode(true),
    hole(mark) {                      // метку-комментарий заменить пустым текстом
      const node = document.createTextNode('')
      mark.replaceWith(node)
      return node
    },
    text(node, value) {
      const next = String(value)
      if (node.data === next) return  // то же значение — DOM не трогаем
      node.data = next
      log('text ' + JSON.stringify(next))
    },
    attr(el, name, value) {
      const next = String(value)
      if (el.getAttribute(name) === next) return
      el.setAttribute(name, next)
      log('attr ' + name + '=' + JSON.stringify(next))
    },
  }
}

function instantiate(code, rt) {
  return new Function('rt', code)(rt)   // сгенерированный код → функция mount
}`;

/** Шаг 5: для сравнения — интерпретатор, который при каждом изменении делает всё заново. */
export const STEP_INTERPRET = String.raw`function interpret(source, s) {
  const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
  const value = (expr) => new Function('s', 'return ' + toJs(expr))(s)
  const out = (children) => children.map((n) => {
    if (n.type === 'text') return esc(n.value)
    if (n.type === 'hole') return esc(value(n.expr))
    const attrs = n.attrs.map((a) => ' ' + a.name + '="' + esc('value' in a ? a.value : value(a.expr)) + '"').join('')
    return '<' + n.tag + attrs + '>' + (VOID.has(n.tag) ? '' : out(n.children) + '</' + n.tag + '>')
  }).join('')
  return out(parse(source).children)   // разбор шаблона — на каждое изменение
}`;

/** То, что исполняют демо и тест: шаги подряд плюс экспорт. */
export const MINI_COMPILER_CODE =
  [STEP_PARSE, STEP_ANALYZE, STEP_GENERATE, STEP_RUNTIME, STEP_INTERPRET].join('\n\n') +
  '\n\nreturn { parse, compile, createRuntime, instantiate, interpret }';

export const PARSE_NOTE =
  'Разбор нужен, чтобы узнать две вещи: где кончается статика и где начинаются «дыры» в фигурных скобках. Текст `Нажато {count}, вдвое — {count * 2}` становится четырьмя узлами: два куска текста и две дыры. Язык нарочно крошечный — ни событий, ни условий, ни циклов: чтобы показать приём, их не нужно.';

export const ANALYZE_NOTE =
  'Анализ отвечает на вопрос, ради которого компилятор существует: **от чего зависит каждое изменчивое место**. Здесь это просто имена в выражении: `price * qty` зависит от `price` и `qty`, и больше ни от чего. Настоящие компиляторы выясняют то же самое, только по всему JS, а не по выражению из одной строки.';

export const GENERATE_NOTE =
  'Генерация раскладывает шаблон на три части. Статическая разметка уходит в одну строку HTML, где на месте каждой дыры стоит комментарий-метка. Код поиска узлов выполнится один раз при монтировании. А `update` — это список «если изменилось вот это, обнови вот этот узел», и в нём нет ни одного сравнения деревьев.';

export const RUNTIME_NOTE =
  'Рантайм у скомпилированного шаблона почти пуст: разобрать HTML один раз, копировать разобранное, записать текст или атрибут. Проверка «то же значение — не трогать» стоит здесь, а не в компиляторе: компилятор знает, **что** может измениться, но не знает, **изменилось ли** оно на самом деле. У Svelte ровно так же устроен `$.set_text`.';

/** Вывод учебного компилятора на первом пресете — снят тестом, строка в строку. */
export const MINI_COUNTER_OUT = `const tpl = rt.template("<p>Нажато <!---->, вдвое — <!----></p>\\n<p>Подсказка не зависит от count</p>")

return function mount(target, s) {
  const root = rt.clone(tpl)
  const t1 = rt.hole(root.childNodes[0].childNodes[1])
  const t2 = rt.hole(root.childNodes[0].childNodes[3])
  function update(s, changed) {
    if (changed.count) rt.text(t1, s.count)
    if (changed.count) rt.text(t2, s.count * 2)
  }
  update(s, { count: true })   // первое заполнение: «изменилось всё»
  target.append(root)
  return update
}`;

export const MINI_OUT_NOTE =
  'Сгенерированный код не знает, что такое шаблон: в нём остались строка HTML, пути к узлам и два условия. Компилятор отработал один раз и больше не нужен — в браузер уезжает только это. Интерпретатор выше делает ту же работу без компиляции — и потому при каждом изменении заново разбирает шаблон и пересоздаёт все узлы.';

export const MINI_PRESETS: MiniPreset[] = [
  {
    id: 'counter',
    label: 'счётчик',
    source: '<p>Нажато {count}, вдвое — {count * 2}</p>\n<p>Подсказка не зависит от count</p>',
    state: { count: 0 },
  },
  {
    id: 'price',
    label: 'цена',
    source: '<p data-currency="{currency}">Итого: {price * qty} {currency}</p>\n<p>Товар: {title}</p>',
    state: { price: 120, qty: 2, currency: '₽', title: 'чай' },
  },
  {
    id: 'profile',
    label: 'профиль',
    source: '<p><strong>{name}</strong>, заказов: {orders}</p>\n<p data-level="{level}">Статус: {level}</p>',
    state: { name: 'Аня', orders: 3, level: 'обычный' },
  },
];

export const DEMO_NOTE =
  'Правьте шаблон и нажмите «собрать»: справа появится сгенерированный код и живой результат. Меняйте значения в полях — журнал покажет, какие записи в DOM понадобились, а рядом — сколько узлов пересоздал бы интерпретатор на то же изменение. Поле с тем же значением, что было, не даёт ни одной записи.';

// ---------------------------------------------------------------------------
// React Compiler
// ---------------------------------------------------------------------------

export const PLAIN_MEMO_CACHE =
  'Представьте, что у компонента есть блокнот с пронумерованными строками. Перед тем как посчитать что-то, он смотрит в блокнот: «в прошлый раз `count` был 3, и я получил вот это». Если `count` снова 3 — берёт готовое из блокнота. Ручной `useMemo` — это одна такая строка, которую вы завели сами; React Compiler заводит блокнот на весь компонент и нумерует строки сам.';

export const REACT_COUNTER_SRC = `import { useState } from 'react';

function Hint() {
  track('Hint');
  return <p>Подсказка не зависит от count</p>;
}

export function Counter() {
  track('Counter');
  const [count, setCount] = useState(0);
  const double = count * 2;
  return (
    <div>
      <button onClick={() => setCount(count + 1)}>+1</button>
      <p>Нажато {count}, вдвое — {double}</p>
      <Hint />
    </div>
  );
}`;

export const REACT_COUNTER_OUT = `import { c as _c } from "react/compiler-runtime";
import { useState } from 'react';
function Hint() {
  const $ = _c(1);
  track("Hint");
  let t0;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t0 = <p>Подсказка не зависит от count</p>;
    $[0] = t0;
  } else {
    t0 = $[0];
  }
  return t0;
}
export function Counter() {
  const $ = _c(9);
  track("Counter");
  const [count, setCount] = useState(0);
  const double = count * 2;
  let t0;
  if ($[0] !== count) {
    t0 = <button onClick={() => setCount(count + 1)}>+1</button>;
    $[0] = count;
    $[1] = t0;
  } else {
    t0 = $[1];
  }
  let t1;
  if ($[2] !== count || $[3] !== double) {
    t1 = <p>Нажато {count}, вдвое — {double}</p>;
    $[2] = count;
    $[3] = double;
    $[4] = t1;
  } else {
    t1 = $[4];
  }
  let t2;
  if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = <Hint />;
    $[5] = t2;
  } else {
    t2 = $[5];
  }
  let t3;
  if ($[6] !== t0 || $[7] !== t1) {
    t3 = <div>{t0}{t1}{t2}</div>;
    $[6] = t0;
    $[7] = t1;
    $[8] = t3;
  } else {
    t3 = $[8];
  }
  return t3;
}`;

export const TRACK_NOTE =
  '`track(имя)` — счётчик вызовов: по нему в разделе «Одно изменение — пять ответов» посчитано, сколько раз выполнилась функция компонента. Компилятор видит в нём вызов неизвестной функции и оставляет на месте, так что счёт честный.';

export const REACT_OUT_NOTES = [
  {
    t: '`_c(9)` — блокнот на девять ячеек',
    d: '`_c` из `react/compiler-runtime` — это хук `useMemoCache`: массив, который живёт на файбере компонента (внутреннем объекте, которым React представляет экземпляр компонента в дереве) между рендерами (в `updateQueue.memoCache` — по исходнику `react-dom` 19.3.0, и там же пустые ячейки заполняются меткой из следующей карточки). Размер компилятор посчитал сам: по ячейке на каждый вход и на каждый запомненный результат.',
  },
  {
    t: '`$[0] !== count` — сравнение входов',
    d: 'Каждый запомненный кусок окружён проверкой: если хоть один вход изменился по `!==`, кусок вычисляется заново и входы переписываются; иначе берётся ячейка. Это `useMemo` с массивом зависимостей, только зависимости выписал компилятор.',
  },
  {
    t: '`Symbol.for("react.memo_cache_sentinel")` — «ещё не считали»',
    d: '`<Hint />` не зависит ни от чего, поэтому его ячейка проверяется не на изменение входа, а на пустоту. Элемент создаётся один раз за жизнь компонента — и дальше это тот же объект.',
  },
  {
    t: 'Тот же объект элемента — пропуск ребёнка',
    d: 'Когда React видит в дереве тот же объект элемента, что и в прошлый раз, он не вызывает функцию ребёнка вовсе. Поэтому `Hint` после компиляции не вызывается при клике — без `memo` вокруг него.',
  },
];

/**
 * Вывод компилятора, пройденный на двух вызовах. Автор курса (2026-09-29): трудное не сокращать,
 * а объяснять подробно. Карточки `REACT_OUT_NOTES` объясняли приёмы по одному; здесь четыре блока
 * `REACT_COUNTER_OUT` пройдены на монтировании и на клике «+1». Ход проверок — чтение напечатанного
 * вывода (сверен тестом строка в строку); итог «`Counter` вызван, `Hint` — нет» — `UPDATE_COUNTS`,
 * снятый тестом в happy-dom.
 */
export const REACT_CACHE_SCENE_NOTE =
  'Что было бы **без компилятора**. На клике `Counter` вызывается заново и создаёт все четыре элемента заново: кнопку с новой стрелкой, абзац, `<Hint />` и `div`. Раз `<Hint />` — новый объект, React вызывает и функцию `Hint` — хотя в ней ничего не может измениться. Счётчик из раздела «Одно изменение — пять ответов» так и показывает: без компилятора `Hint` вызван один раз на клик, с компилятором — ни разу. Ниже — почему, по четырём блокам вывода.';

export const REACT_CACHE_STEPS: { k: string; mount: string; click: string }[] = [
  {
    k: '`t0` — кнопка, ячейки 0–1',
    mount: 'в `$[0]` метка «ещё не считали», она не равна `0` — кнопка создана, `$[0] = 0`, элемент в `$[1]`.',
    click: '`count` стал `1`, а в `$[0]` лежит `0` — кнопка создаётся заново. Иначе нельзя: стрелка `onClick` замкнула `count`, и старая прибавила бы единицу к нулю.',
  },
  {
    k: '`t1` — абзац, ячейки 2–4',
    mount: 'пусто — абзац создан, входы `count` и `double` записаны.',
    click: 'изменились оба входа — абзац создаётся заново. Это и есть работа, ради которой был клик.',
  },
  {
    k: '`t2` — `<Hint />`, ячейка 5',
    mount: 'пусто — элемент создан и положен в `$[5]`.',
    click: 'ячейка не пуста, входов нет — берётся **тот же объект**, что на монтировании. React видит прежний элемент и не вызывает `Hint`.',
  },
  {
    k: '`t3` — `div`, ячейки 6–8',
    mount: 'пусто — `div` собран из `t0`, `t1`, `t2`.',
    click: '`t0` и `t1` — новые объекты, значит, и `div` новый. Компилятор сравнивает не `count`, а результаты блоков: изменился вход — поменялся блок — поменялся и тот, кто его содержит.',
  },
];

export const REACT_WHAT_NOTE =
  'Что компилятор запоминает: JSX-элементы, функции (обработчик `onClick` живёт в одной ячейке с кнопкой и пересоздаётся, только когда меняется `count`), объекты и массивы — то есть всё, у чего важна **ссылка**. А `const double = count * 2` осталось как было: у числа ссылки нет, его сравнивают по значению там, где оно попадает в JSX, — в проверке `$[3] !== double`.';

/** Дорогой расчёт, который превращается в число: мемоизирован ли он? */
export const REACT_SUM_SRC = `export function Cart({ items, discount }) {
  const total = sum(items);
  return <p>{total * (1 - discount)}</p>;
}`;

export const REACT_SUM_OUT = `import { c as _c } from "react/compiler-runtime";
export function Cart(t0) {
  const $ = _c(2);
  const {
    items,
    discount
  } = t0;
  const total = sum(items);
  const t1 = total * (1 - discount);
  let t2;
  if ($[0] !== t1) {
    t2 = <p>{t1}</p>;
    $[0] = t1;
    $[1] = t2;
  } else {
    t2 = $[1];
  }
  return t2;
}`;

export const REACT_SUM_NOTE =
  'Здесь ячеек две — входной `t1` и готовый `<p>`, — а `sum(items)` стоит вне всяких проверок и вызывается на каждом рендере, даже если сменился только `discount`. Компилятор запоминает то, что должно сохранить ссылку или попасть в вывод, а цена вызова ему неизвестна. Ручной `useMemo` здесь не спасает — почему, разобрано в «Тонких местах».';

export const REACT_MEMO_SUM_SRC = `import { useMemo } from 'react';

export function Cart({ items, discount }) {
  const total = useMemo(() => sum(items), [items]);
  return <p>{total * (1 - discount)}</p>;
}`;

// ---------------------------------------------------------------------------
// Когда React Compiler отказывается
// ---------------------------------------------------------------------------

export interface BailoutCase {
  id: string;
  /** Что нарушено — словами. */
  what: string;
  src: string;
  /** `compiled` — функция переписана; `error` — отказ с диагностикой; `skip` — директива. */
  verdict: 'compiled' | 'error' | 'skip' | 'untouched';
  /** Категория и причина из логгера плагина — дословно, как их отдал плагин. */
  category?: string;
  reason?: string;
}

export const BAILOUTS: BailoutCase[] = [
  {
    id: 'hook-in-if',
    what: 'хук внутри `if`',
    src: `function Search({ enabled }) {
  if (enabled) {
    const [q, setQ] = useState('');
  }
  return <input />;
}`,
    verdict: 'error',
    category: 'Hooks',
    reason: 'Hooks must always be called in a consistent order, and may not be called conditionally. See the Rules of Hooks (https://react.dev/warnings/invalid-hook-call-warning)',
  },
  {
    id: 'assign-prop',
    what: 'запись в проп',
    src: `function Title(props) {
  props.title = props.title.trim();
  return <h1>{props.title}</h1>;
}`,
    verdict: 'error',
    category: 'Immutability',
    reason: 'This value cannot be modified',
  },
  {
    id: 'ref-in-render',
    what: '`ref.current` во время рендера',
    src: `function Box() {
  const ref = useRef(0);
  ref.current++;
  return <p>{ref.current}</p>;
}`,
    verdict: 'error',
    category: 'Refs',
    reason: 'Cannot access refs during render',
  },
  {
    id: 'set-state-in-render',
    what: '`setState` во время рендера',
    src: `function Loop() {
  const [n, setN] = useState(0);
  setN(n + 1);
  return <p>{n}</p>;
}`,
    verdict: 'error',
    category: 'RenderSetState',
    reason: 'Calling setState during render may trigger an infinite loop',
  },
  {
    id: 'global-reassign',
    what: 'запись во внешнюю переменную',
    src: `let renders = 0;
function Counter({ n }) {
  renders = renders + 1;
  return <p>{n}</p>;
}`,
    verdict: 'error',
    category: 'Globals',
    reason: 'Cannot reassign variables declared outside of the component/hook',
  },
  {
    id: 'sort-prop',
    what: 'мутация пропа методом: `items.sort()`',
    src: `function List({ items }) {
  items.sort((a, b) => a.price - b.price);
  return <ul>{items.map((i) => <li key={i.id}>{i.name}</li>)}</ul>;
}`,
    verdict: 'compiled',
  },
  {
    id: 'use-no-memo',
    what: "директива `'use no memo'`",
    src: `function Plain({ items }) {
  'use no memo';
  const sorted = [...items].sort();
  return <ul>{sorted.map((i) => <li key={i}>{i}</li>)}</ul>;
}`,
    verdict: 'skip',
  },
  {
    id: 'lowercase',
    what: 'имя с маленькой буквы',
    src: `function renderRow(item) {
  return <li>{item.name}</li>;
}`,
    verdict: 'untouched',
  },
];

export const BAILOUT_VERDICT: Record<BailoutCase['verdict'], string> = {
  compiled: 'скомпилирован',
  error: 'отказ, код оставлен как был',
  skip: 'пропущен по директиве',
  untouched: 'не тронут: не похож на компонент',
};

export const BAILOUT_HEAD = ['что в компоненте', 'итог', 'категория', 'причина — дословно из логгера плагина'];

export const BAILOUT_ROWS: string[][] = BAILOUTS.map((b) => [
  b.what,
  BAILOUT_VERDICT[b.verdict],
  b.category ? '`' + b.category + '`' : '—',
  b.reason ?? '—',
]);

export const BAILOUT_SILENT_NOTE =
  '**Отказ по умолчанию молчит.** Плагин не бросает исключение и не печатает предупреждение: функция остаётся нескомпилированной, а сборка — зелёной. Узнать об отказе можно через `logger` в настройках плагина (таблица выше снята им) или, по документации React, через правила ESLint из `eslint-plugin-react-hooks`. Превратить отказ в ошибку сборки, по README плагина, может настройка `panicThreshold`.';

export const BAILOUT_SORT_NOTE =
  'Строка с `items.sort()` — самая опасная в таблице. Компилятор ловит **присваивание** пропу, но не вызов метода, который меняет проп на месте, — и спокойно компилирует. Дальше мемоизация по `$[i] !== items` работает против вас: массив тот же, значит, и список тот же. Что из этого выходит на странице, посчитано в «Тонких местах».';

export const USE_NO_MEMO_NOTE =
  "`'use no memo'` в первой строке функции — аварийный выход: компилятор пропускает функцию и сообщает логгеру событие `CompileSkip`. Им выключают компилятор точечно, пока ищут, не он ли сломал компонент. Функция с маленькой буквы и хук без вызовов хуков не трогаются вовсе, и логгер о них не сообщает ничего: в режиме по умолчанию компилятор берёт только то, что опознал как компонент или хук.";

// ---------------------------------------------------------------------------
// Svelte 5
// ---------------------------------------------------------------------------

export const PLAIN_RUNES =
  '`$state(0)` похоже на вызов функции, но это метка для компилятора: «эту переменную отслеживай». Как если бы вы подчеркнули в черновике слово, а наборщик при печати заменил его на окошко, которое само меняет надпись. В готовом коде от `$state` не остаётся и следа — вместо него `$.state`, `$.get` и `$.set`.';

export const SVELTE_HINT_SRC = `<script>
  track('Hint');
</script>

<p>Подсказка не зависит от count</p>`;

export const SVELTE_COUNTER_SRC = `<script>
  import Hint from './Hint.svelte';
  track('Counter');
  let count = $state(0);
  let double = $derived(count * 2);
</script>

<div>
  <button onclick={() => count++}>+1</button>
  <p>Нажато {count}, вдвое — {double}</p>
  <Hint />
</div>`;

export const SVELTE_COUNTER_OUT = `import 'svelte/internal/disclose-version';
import * as $ from 'svelte/internal/client';
import Hint from './Hint.svelte';

var root = $.from_html(\`<div><button>+1</button> <p> </p> <!></div>\`);

export default function Counter($$anchor) {
	track('Counter');

	let count = $.state(0);
	let double = $.derived(() => $.get(count) * 2);
	var div = root();
	var button = $.child(div);
	var p = $.sibling(button, 2);
	var text = $.only_child(p);
	var node = $.sibling(p, 2);

	Hint(node, {});
	$.reset(div);
	$.template_effect(() => $.set_text(text, \`Нажато \${$.get(count) ?? ''}, вдвое — \${$.get(double) ?? ''}\`));
	$.delegated('click', button, () => $.update(count));
	$.append($$anchor, div);
}

$.delegate(['click']);`;

export const SVELTE_OUT_NOTES = [
  {
    t: 'Руны стали вызовами рантайма',
    d: '`$state(0)` → `$.state(0)`, `$derived(count * 2)` → `$.derived(() => $.get(count) * 2)`. Каждое чтение `count` компилятор переписал в `$.get(count)`, запись `count++` — в `$.update(count)`. Именно эти вызовы и подписывают и будят — механизм тот же, что у сигналов.',
  },
  {
    t: 'Статика — одна строка HTML',
    d: '`$.from_html(...)` разбирает разметку один раз на весь модуль, а `root()` отдаёт её копию. Пробел в `<p> </p>` — заготовка текстового узла, который потом найдёт `$.only_child`, а `<!>` — метка, перед которой встанет `Hint`: дочерний компонент здесь — просто вызов функции `Hint(node, {})`.',
  },
  {
    t: '`template_effect` — эффект на узел',
    d: 'Всё изменчивое в разметке собрано в один эффект, и он зовёт `$.set_text`. Функция `Counter` выполнилась один раз, при монтировании; при клике выполняется только этот эффект — и `$.derived`, который он читает.',
  },
  {
    t: 'Абзац — один текстовый узел',
    d: '`Нажато {count}, вдвое — {double}` Svelte склеил в одну шаблонную строку. Поэтому при клике меняется **один** текстовый узел, а у React и Solid — два: у них каждая дыра — отдельный узел.',
  },
];

export const SVELTE_PROXY_SRC = `<script>
  let cart = $state({ items: [] });
  $effect(() => {
    document.title = cart.items.length + ' в корзине';
  });
</script>

<button onclick={() => cart.items.push('чай')}>{cart.items.length}</button>`;

export const SVELTE_PROXY_OUT = `import 'svelte/internal/disclose-version';
import * as $ from 'svelte/internal/client';

var root = $.from_html(\`<button> </button>\`);

export default function Cart($$anchor, $$props) {
	$.push($$props, true);

	let cart = $.proxy({ items: [] });

	$.user_effect(() => {
		document.title = cart.items.length + ' в корзине';
	});

	var button = root();
	var text = $.only_child(button, true);

	$.template_effect(() => $.set_text(text, cart.items.length));
	$.delegated('click', button, () => cart.items.push('чай'));
	$.append($$anchor, button);
	$.pop();
}

$.delegate(['click']);`;

export const SVELTE_PROXY_NOTE =
  'Объект в `$state` компилятор оборачивает в `$.proxy` — глубокое отслеживание, как `reactive` у Vue. И раз переменная `cart` нигде не переприсваивается, `$.get` вокруг неё не нужен: `cart.items.length` читается напрямую, а `push` в массив будит эффекты через прокси. После клика и кнопка, и `document.title` показывают 1.\n\n`$effect` стал `$.user_effect`, а вокруг тела появились `$.push`/`$.pop` — в `Counter` без `$effect` их нет. По исходникам рантайма Svelte это контекст компонента, в котором живут его эффекты.';

// ---------------------------------------------------------------------------
// Solid
// ---------------------------------------------------------------------------

export const SOLID_COUNTER_SRC = `import { createSignal } from 'solid-js';

function Hint() {
  track('Hint');
  return <p>Подсказка не зависит от count</p>;
}

export function Counter() {
  track('Counter');
  const [count, setCount] = createSignal(0);
  const double = () => count() * 2;
  return (
    <div>
      <button onClick={() => setCount(count() + 1)}>+1</button>
      <p>Нажато {count()}, вдвое — {double()}</p>
      <Hint />
    </div>
  );
}`;

export const SOLID_COUNTER_OUT = `import { template as _$template } from "solid-js/web";
import { delegateEvents as _$delegateEvents } from "solid-js/web";
import { createComponent as _$createComponent } from "solid-js/web";
import { insert as _$insert } from "solid-js/web";
var _tmpl$ = /*#__PURE__*/_$template(\`<p>Подсказка не зависит от count\`),
  _tmpl$2 = /*#__PURE__*/_$template(\`<div><button>+1</button><p>Нажато <!>, вдвое — \`);
import { createSignal } from 'solid-js';
function Hint() {
  track('Hint');
  return _tmpl$();
}
export function Counter() {
  track('Counter');
  const [count, setCount] = createSignal(0);
  const double = () => count() * 2;
  return (() => {
    var _el$2 = _tmpl$2(),
      _el$3 = _el$2.firstChild,
      _el$4 = _el$3.nextSibling,
      _el$5 = _el$4.firstChild,
      _el$7 = _el$5.nextSibling,
      _el$6 = _el$7.nextSibling;
    _el$3.$$click = () => setCount(count() + 1);
    _$insert(_el$4, count, _el$7);
    _$insert(_el$4, double, null);
    _$insert(_el$2, _$createComponent(Hint, {}), null);
    return _el$2;
  })();
}
_$delegateEvents(["click"]);`;

export const SOLID_OUT_NOTES = [
  {
    t: 'JSX, но не React',
    d: 'Тот же синтаксис, что у React, компилируется в совершенно другой код: `_$template` со строкой HTML вместо дерева `jsx()`-вызовов. Функция компонента возвращает настоящий DOM-узел, а не описание. Закрывающих тегов в конце строки нет — `<p>Подсказка…` без `</p>`: браузер при разборе закроет их сам, и компилятор экономит байты.',
  },
  {
    t: '`<!>` — метка для вставки',
    d: 'Между «Нажато » и «, вдвое — » стоит комментарий: после разбора HTML два соседних куска текста слились бы, и вставлять стало бы некуда. `_$insert(_el$4, count, _el$7)` вставляет значение перед этой меткой.',
  },
  {
    t: '`{count()}` → `count`',
    d: 'Компилятор увидел, что выражение — вызов без аргументов, и передал в `insert` саму функцию-геттер. `insert` оборачивает её в эффект; всё, что сложнее, компилятор оборачивает в стрелку сам — как `() => props.text` в примере из «Тонких мест».',
  },
  {
    t: 'Обработчик — свойство узла',
    d: '`_el$3.$$click = …` и `_$delegateEvents(["click"])`: слушатель один на документ (`document.addEventListener` в `solid-js/web`), а обработчик лежит на самом узле. Svelte делает то же через `$.delegated`.',
  },
];

export const PLAIN_ONCE =
  'В React функция компонента — повар: на каждый заказ он готовит блюдо заново, пусть и берёт заготовки из холодильника. В Svelte и Solid — электрик: один раз собрал проводку, протянул провод от выключателя к лампе и ушёл. Дальше щёлкают выключатели, свет загорается, а электрика никто не зовёт.';

export const SOLID_ONCE_NOTE =
  'Как и у Svelte, функция `Counter` выполняется один раз. Отличие в том, где стоят эффекты: у Solid их расставил `insert` вокруг каждого выражения, у Svelte — `template_effect` вокруг всех выражений одного шаблона сразу.';

// ---------------------------------------------------------------------------
// Одно изменение — посчитано
// ---------------------------------------------------------------------------

export interface UpdateCount {
  id: string;
  label: string;
  /** Вызовы функций компонентов за один клик «+1» (для учебного компилятора — за `count = 1`). */
  counter: number | null;
  hint: number | null;
  /** Записи `MutationObserver` за то же изменение — все `characterData`. */
  mutations: number;
  /** Тексты изменённых узлов — в порядке записей. */
  texts: string[];
}

export const UPDATE_COUNTS: UpdateCount[] = [
  { id: 'react', label: 'React без компилятора', counter: 1, hint: 1, mutations: 2, texts: ['1', '2'] },
  { id: 'react-compiler', label: 'React + React Compiler', counter: 1, hint: 0, mutations: 2, texts: ['1', '2'] },
  { id: 'svelte', label: 'Svelte 5', counter: 0, hint: 0, mutations: 1, texts: ['Нажато 1, вдвое — 2'] },
  { id: 'solid', label: 'Solid', counter: 0, hint: 0, mutations: 2, texts: ['1', '2'] },
  { id: 'mini', label: 'учебный компилятор', counter: null, hint: null, mutations: 2, texts: ['1', '2'] },
];

export const UPDATE_HEAD = ['', 'вызовов `Counter`', 'вызовов `Hint`', 'записей в DOM', 'что записано'];

export const UPDATE_ROWS: string[][] = UPDATE_COUNTS.map((u) => [
  u.label,
  u.counter === null ? 'нет компонентов' : String(u.counter),
  u.hint === null ? '—' : String(u.hint),
  String(u.mutations),
  u.texts.map((t) => '`' + t + '`').join(', '),
]);

export const UPDATE_NOTE =
  'Как считали: исходники выше собраны настоящими компиляторами и смонтированы в happy-dom (DOM на JS, работающий в Node без браузера), затем нажата кнопка. Записи в DOM — это записи `MutationObserver`, и все они `characterData`: смена текста одного узла.';

export const UPDATE_TAKEAWAYS = [
  {
    t: 'Записей в DOM почти столько же',
    d: 'Даже React без компилятора пишет в DOM только два текстовых узла: сравнение деревьев для того и существует. Компиляторы экономят не записи в DOM, а **работу до них** — вызовы функций и сравнение.',
    tone: 'info' as const,
  },
  {
    t: 'React Compiler убирает детей, но не родителя',
    d: '`Counter` вызывается и с компилятором: состояние живёт в нём, и без вызова функции React не узнает новый `count`. Пропадает вызов `Hint` — его элемент из ячейки тот же объект.',
    tone: 'warn' as const,
  },
  {
    t: 'Svelte и Solid не вызывают ничего',
    d: 'Ноль вызовов функций компонентов: функция компонента — это конструктор, отработавший при монтировании. После него живут только эффекты, привязанные к узлам.',
    tone: 'ok' as const,
  },
];

// ---------------------------------------------------------------------------
// Тонкие места
// ---------------------------------------------------------------------------

/** Родитель мутирует массив на месте и просит перерисовку; ребёнок получает тот же массив. */
export const STALE_LIST_SRC = `import { useState } from 'react';

const store = [{ id: 1, name: 'чай' }];

function List({ items }) {
  return <ul>{items.map((i) => <li key={i.id}>{i.name}</li>)}</ul>;
}

export function Shop() {
  const [, setTick] = useState(0);
  const add = () => {
    store.push({ id: store.length + 1, name: 'кофе' });   // тот же массив
    setTick((t) => t + 1);
  };
  return (
    <div>
      <button onClick={add}>добавить</button>
      <List items={store} />
    </div>
  );
}`;

/** Сколько `<li>` после одного клика — снято тестом. */
export const STALE_LIST_COUNTS = { plain: 2, compiled: 1 };

/** Вызовы `sum` при смене одного `discount` — снято тестом. */
export const SUM_CALLS = { compiled: 1, compiledUseMemo: 1, plainUseMemo: 0 };

/** Строка, в которую компилятор превратил `useMemo(() => sum(items), [items])`. */
export const MEMO_DROPPED_LINE = 'const total = sum(items);';

export const SVELTE_STALE_SRC = `<script>
  let count = $state(0);
  let double = count * 2;
</script>

<button onclick={() => count++}>{count} × 2 = {double}</button>`;

/** Код предупреждения и текст кнопки после клика — снято тестом. */
export const SVELTE_STALE = { warning: 'state_referenced_locally', after: '1 × 2 = 0' };

export const SOLID_DESTRUCTURE_SRC = `import { createSignal } from 'solid-js';

function Label({ text }) {                 // деструктуризация в параметрах
  return <b>{text}</b>;
}

function LabelProps(props) {
  return <b>{props.text}</b>;
}

export function App() {
  const [name, setName] = createSignal('чай');
  return (
    <div>
      <button onClick={() => setName('кофе')}>сменить</button>
      <Label text={name()} />
      <LabelProps text={name()} />
    </div>
  );
}`;

/** Тексты двух `<b>` после клика — снято тестом. */
export const SOLID_DESTRUCTURE = { destructured: 'чай', props: 'кофе' };

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'React Compiler отказывается молча',
    d: 'Нарушение правил React не роняет сборку: компонент остаётся нескомпилированным, а в консоли пусто. На всех пяти отказах из таблицы исключения нет, а вывод совпадает с тем, что даёт тот же Babel вовсе без компилятора. Узнать можно только логгером плагина или линтером — поэтому «включили компилятор, быстрее не стало» чаще значит «половина компонентов не скомпилирована», чем «компилятор не помог».',
    tone: 'err',
  },
  {
    n: '02',
    t: 'Мутация на месте прячет изменения от мемоизации',
    code: STALE_LIST_SRC,
    d: 'Родитель кладёт товар в тот же массив и просит перерисовку. Без компилятора `List` вызывается заново и показывает **2** пункта. С компилятором элемент `<List items={store} />` лежит в ячейке с проверкой `$[i] !== store` — ссылка та же, элемент тот же, `List` не вызывается, и на странице остаётся **1** пункт. Код, который «работал», сломался от включения оптимизации: он и раньше нарушал правило неизменяемости, просто это не было видно. Лечится новой ссылкой: `setItems([...items, x])`.',
    tone: 'err',
  },
  {
    n: '03',
    t: 'Дорогой расчёт, ушедший в арифметику, не запоминается — даже с `useMemo`',
    code: REACT_MEMO_SUM_SRC,
    d: '`total` дальше идёт только в `total * (1 - discount)`, и компилятор не заводит под `sum(items)` ячейку. Больше того: ручной `useMemo` вокруг него он **убирает** — в выводе остаётся `const total = sum(items);`. При смене одного `discount` и том же `items` насчитан 1 вызов `sum` с компилятором — и с `useMemo`, и без него, — а без компилятора с `useMemo` 0. Компилятор запоминает то, что должно сохранить **ссылку** или дойти до вывода, а цена вызова ему неизвестна. Если тот же `total` передать в JSX напрямую (`<p>{total}</p>`), ячейка появляется. Почему так — по исходникам плагина: проход `pruneNonEscapingScopes` убирает ячейки значений, которые не «уходят» наружу. Практический вывод: дорогой расчёт, который должен запоминаться, выносите туда, где его результат уходит в JSX или в проп, — или проверяйте вывод компилятора.',
    tone: 'err',
  },
  {
    n: '04',
    t: 'Svelte: без `$derived` значение снимается один раз',
    code: SVELTE_STALE_SRC,
    d: '`let double = count * 2` компилятор переписал в `$.get(count) * 2` на верхнем уровне компонента — то есть прочёл один раз, при монтировании. После клика кнопка показывает `1 × 2 = 0`. Svelte при этом **предупреждает**: `state_referenced_locally`. Предупреждение компилятора здесь — единственный сигнал, и его стоит считать ошибкой.',
    tone: 'warn',
  },
  {
    n: '05',
    t: 'Solid: деструктуризация пропсов обрывает реактивность',
    code: SOLID_DESTRUCTURE_SRC,
    d: 'Компилятор Solid превращает `text={name()}` в геттер на объекте пропсов — `get text() { return name(); }`: значение вычисляется, когда его читают. `{ text }` в параметрах читает геттер один раз, при вызове функции компонента, — а функция компонента в Solid больше не вызывается. После клика первый `<b>` показывает `чай`, второй — `кофе`. У React такой код работает, и при переносе это самая частая поломка.',
    tone: 'err',
  },
  {
    n: '06',
    t: 'Компилятор смотрит только на то, что похоже на компонент',
    d: 'Функция `renderRow` с маленькой буквы, возвращающая JSX, и хук `useTotal` без вызовов других хуков остались нетронутыми — и логгер про них молчит. Вспомогательная функция, которая строит JSX внутри цикла, не получит мемоизации, даже если выглядит как кусок компонента. Если это важно, из неё делают компонент с большой буквы.',
  },
];

// ---------------------------------------------------------------------------
// Источники
// ---------------------------------------------------------------------------

export const SOURCES = [
  {
    title: 'React · React Compiler',
    href: 'https://react.dev/learn/react-compiler',
    what: 'Что компилятор делает и как его подключить. ⚠️ Утверждения о стабильности 1.0 и о настройках — по этой странице, не запуском.',
  },
  {
    title: 'facebook/react · compiler',
    href: 'https://github.com/facebook/react/tree/main/compiler',
    what: 'Исходники `babel-plugin-react-compiler`: `useMemoCache`, диагностики, режимы компиляции.',
  },
  {
    title: 'React · Rules of React',
    href: 'https://react.dev/reference/rules',
    what: 'Правила, соблюдение которых компилятор проверяет перед тем, как взяться за компонент.',
  },
  {
    title: 'Svelte · What are runes?',
    href: 'https://svelte.dev/docs/svelte/what-are-runes',
    what: 'Руны как ключевые слова компилятора, а не функции.',
  },
  {
    title: 'Svelte · state_referenced_locally',
    href: 'https://svelte.dev/e/state_referenced_locally',
    what: 'Адрес, который печатает сам компилятор в предупреждении из «Тонких мест».',
  },
  {
    title: 'Solid · Props',
    href: 'https://docs.solidjs.com/concepts/components/props',
    what: 'Почему пропсы нельзя деструктурировать и что предлагают вместо — `splitProps`, `mergeProps`.',
  },
  {
    title: 'ryansolid/dom-expressions',
    href: 'https://github.com/ryansolid/dom-expressions',
    what: 'Компилятор JSX, на котором стоит `babel-preset-solid`: `template`, `insert`, делегирование событий.',
  },
];

export const RELATED =
  'Смежное на сайте: [Ре-рендеринг в React](/frameworks/react-rerender/#s5) — ручная мемоизация, которую React Compiler расставляет сам. [Vue 3 изнутри: рендерер и patch](/frameworks/vue-patch-internals/#s6) — подсказки компилятора шаблонов Vue: флаги патча, вынос статики и блоки. [Vue Vapor Mode](/frameworks/vue-vapor/) — компилятор Vue без виртуального DOM. [Сигналы](/frameworks/signals/#s5) — механизм, на котором стоят точечные обновления Svelte и Solid. [React против Vue](/frameworks/react-vs-vue/) — две модели рантайма на одной задаче. [Хуки React изнутри](/frameworks/react-hooks-internals/) — почему порядок вызова хуков — правило, а не пожелание. [Svelte 5 изнутри](/frameworks/svelte-runes/) — руны как сигналы, вывод компилятора и флаги графа.';
