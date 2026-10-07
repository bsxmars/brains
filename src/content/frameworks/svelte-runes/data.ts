import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { RunesScenario } from '@/widgets/svelte-lab/model/types';

/**
 * Данные темы «Svelte 5 изнутри: руны и компилятор».
 *
 * Тема написана 2026-10-02. Пересекается с тремя темами направления, и граница проведена так:
 * общий алгоритм push-pull и ромб — в «Сигналах» (`/frameworks/signals/#s2`), здесь — только то,
 * как его записал Svelte (биты флагов, один счётчик записей, обход дерева эффектов); первое
 * знакомство с выводом компилятора Svelte (`$.state`, `template_effect`, делегирование) —
 * в «Компиляторах фреймворков» (`#s5`), здесь — проп, `{#each}` с ключом, Proxy, пакет и режим
 * совместимости; «эффект на узел без VDOM» у Vue — в «Vapor Mode».
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * svelte **5.57.1** из `node_modules` проекта (`svelte/compiler` — `compile`,
 * `svelte/internal/client` — рантайм, `mount`/`flushSync` — из `src/index-client.js` по пути:
 * в Node условие `default` отдаёт серверную сборку). Node 24.11.0, happy-dom 20.14.5,
 * Chromium 153.0.8010.12 (Playwright 1.63), октябрь 2026.
 *
 *   1. **Вывод компилятора** (`*_OUT`) — `compile(src, { generate: 'client', dev: false })`,
 *      строка в строку. Нормализовано одно: имя файла задано (`Todos.svelte`, `Cart.svelte`…),
 *      от него зависит только имя функции. Хешей и путей в выводе без `dev` и без `<style>`
 *      нет, поэтому больше нормализовать нечего.
 *   2. **Сценарии** (`SCENARIOS`) — строки кода на вызовах `$.state`/`$.derived`/`$.get`/`$.set`/
 *      `$.user_effect`/`$.template_effect`/`$.proxy`/`$.flush`/`$.effect_root`/`$.tag` — тех же,
 *      что в выводе компилятора. Каждая исполнена на настоящем `svelte/internal/client`
 *      и на мини-рунах `MINI_RUNES_CODE`; поле `svelte` — журнал настоящего Svelte, и мини
 *      даёт его же, строка в строку, включая порядок и число пересчётов `derived`.
 *   3. **Компоненты** (`TODOS_SRC`, `CART_SRC`, `PARENT_SRC`, `LEGACY_SRC`, `RUNES_SRC`)
 *      скомпилированы, вывод исполнен через `new Function` (импорты → параметры) и смонтирован
 *      `mount` в happy-dom. Вызовы функции компонента, `template_effect`, `user_effect`
 *      и `derived` посчитаны обёртками вокруг рантайма (сам рантайм не тронут), записи DOM —
 *      `MutationObserver`. Числа записей `{#each}` с ключом и без (`EACH_RECORDS`) повторены
 *      в Chromium на сборке esbuild — совпали с happy-dom.
 *
 * Всё перечисленное пересобирается и сверяется `tests/unit/svelte-runes.test.ts`.
 *
 * По исходникам рантайма, не запуском (⚠️): что `template_effect` и `$effect` различаются битами
 * `RENDER_EFFECT` и `EFFECT` и что первые выполняются при обходе дерева, а вторые собираются
 * и выполняются после (`reactivity/batch.js`, `#traverse`) — запуском проверен только
 * наблюдаемый порядок. По документации, не запуском: что `$effect` не выполняется на сервере;
 * что `$state.raw` выгоднее на больших данных, которые не мутируют; что руны работают
 * в файлах `.svelte.js`; устройство вывода Svelte 4 (`$$invalidate`, битовая маска `dirty`) —
 * Svelte 4 в проекте нет, и ставить его ради темы не стали.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const INTRO_NOTE =
  'Компонент Svelte 5 выполняется один раз. Он клонирует готовый HTML и вешает на каждое изменчивое место маленький эффект. Дальше работают только эффекты: запись в `$state` помечает их «грязными», а в ближайшей микрозадаче рантайм выполняет помеченные. Ни повторного вызова компонента, ни сравнения деревьев — всё, что можно узнать заранее, компилятор узнал при сборке.';

export const PLAIN_INTRO =
  'Как кондуктор, который заранее знает, кому на какой остановке выходить. Он не будит весь вагон на каждой станции — то есть не перерисовывает компонент целиком, — а трогает за плечо только тех, кому сюда: один текстовый узел, один атрибут.';

export const GLOSSARY = [
  {
    k: 'руна',
    d: 'Имя со знаком доллара: `$state`, `$derived`, `$effect`, `$props`. Выглядит как вызов функции, но такой функции нет: компилятор узнаёт руну и переписывает код вокруг неё.',
  },
  {
    k: 'источник (`source`)',
    d: 'Ячейка значения в рантайме Svelte — во что превращается `$state`. Поля: `v` — значение, `wv` — номер последней записи, `reactions` — кто его читал.',
  },
  {
    k: 'реакция',
    d: 'Общее имя для того, что читает источники и должно уметь выполниться заново: `derived` и эффекта. У реакции есть список зависимостей `deps` и флаг состояния.',
  },
  {
    k: '`CLEAN`, `DIRTY`, `MAYBE_DIRTY`',
    d: 'Состояние реакции. Свежая; точно устарела — изменился источник, который она читает сама; может быть, устарела — изменилось что-то выше, за `derived`, и это ещё надо проверить.',
  },
  {
    k: 'номер записи (`wv`)',
    d: 'Write version. Один счётчик на всё приложение растёт на каждую запись. Источник помнит номер своей последней записи, эффект — номер на момент своего прогона. Сравнить два числа — значит узнать, новее ли источник.',
  },
  {
    k: 'шаблонный эффект и `$effect`',
    d: 'Оба — эффекты. `$.template_effect` компилятор ставит на разметку, он пишет в DOM. `$effect` пишете вы, и выполняется он после всех шаблонных.',
  },
  {
    k: 'пакет и сброс',
    d: 'Пакет (batch) копит записи, сброс (flush) выполняет всё помеченное за раз. Сброс случается в микрозадаче после первой записи — или сразу, если вызвать `flushSync`.',
  },
  {
    k: 'ключ `{#each}`',
    d: 'Выражение в скобках после имени элемента: `{#each todos as todo (todo.id)}`. По нему Svelte узнаёт тот же элемент после перестановки и переносит его узлы, а не переписывает в них текст.',
  },
];

export const PREREQ: { t: string; d: string; href: string; hrefLabel: string; tone: 'info' }[] = [
  {
    t: 'Сигналы: пометка вниз, пересчёт вверх',
    d: 'Запись помечает зависимых «грязными» и ничего не считает; читатель досчитывает устаревшее, когда оно ему понадобилось. Здесь не пересказывается — только то, как это сделал Svelte.',
    href: '/frameworks/signals/#s2',
    hrefLabel: '«Сигналы», раздел «Push и pull»',
    tone: 'info',
  },
  {
    t: 'Руны превращаются в вызовы рантайма',
    d: '`$state(0)` становится `$.state(0)`, чтение — `$.get`, запись — `$.set`, а разметка — строкой HTML и `template_effect`. Первое знакомство с этим выводом и сравнение с React Compiler и Solid — там.',
    href: '/frameworks/framework-compilers/#s5',
    hrefLabel: '«Компиляторы фреймворков», раздел «Svelte 5»',
    tone: 'info',
  },
  {
    t: 'Proxy',
    d: 'Обёртка над объектом, которая перехватывает чтение, запись и проверку свойства ловушками `get`, `set`, `has`. На ней Svelte делает глубокое отслеживание `$state`.',
    href: '/js/proxy-reflect/#s6',
    hrefLabel: '«Proxy и Reflect», раздел «Реактивность»',
    tone: 'info',
  },
  {
    t: 'Микрозадача',
    d: 'Работа, которую движок выполнит сразу после текущего кода, до следующей задачи и до отрисовки. В микрозадаче Svelte сбрасывает пакет записей.',
    href: '/js/event-loop/#s3',
    hrefLabel: '«Event Loop», раздел «Checkpoint»',
    tone: 'info',
  },
];

// ─── Раздел 1. Что выдал компилятор ────────────────────────────────────────────────────────

/** Сквозной пример темы. Тест компилирует его, монтирует и кликает. */
export const TODOS_SRC = `<script>
  let { title } = $props();
  let todos = $state([
    { id: 1, text: 'Купить чай', done: false },
    { id: 2, text: 'Позвонить маме', done: true },
    { id: 3, text: 'Полить цветы', done: false },
  ]);
  let left = $derived(todos.filter((t) => !t.done).length);

  $effect(() => {
    document.title = \`\${title}: \${left}\`;
  });
</script>

<h2>{title} — осталось {left}</h2>
<button onclick={() => todos.reverse()}>перевернуть</button>
<ul>
  {#each todos as todo (todo.id)}
    <li>
      <button onclick={() => (todo.done = !todo.done)}>{todo.done ? '✓' : '○'}</button>
      {todo.text}
    </li>
  {/each}
</ul>`;

/** `compile(TODOS_SRC, { filename: 'Todos.svelte', generate: 'client', dev: false })` — целиком. */
export const TODOS_OUT = `import 'svelte/internal/disclose-version';
import * as $ from 'svelte/internal/client';

var root = $.from_html(\`<li><button> </button> </li>\`);
var root_1 = $.from_html(\`<h2> </h2> <button>перевернуть</button> <ul></ul>\`, 1);

export default function Todos($$anchor, $$props) {
	$.push($$props, true);

	let todos = $.proxy([
		{ id: 1, text: 'Купить чай', done: false },
		{ id: 2, text: 'Позвонить маме', done: true },
		{ id: 3, text: 'Полить цветы', done: false }
	]);

	let left = $.derived(() => todos.filter((t) => !t.done).length);

	$.user_effect(() => {
		document.title = \`\${$$props.title}: \${$.get(left)}\`;
	});

	var fragment = root_1();
	var h2 = $.first_child(fragment);
	var text = $.only_child(h2);
	var button = $.sibling(h2, 2);
	var ul = $.sibling(button, 2);

	$.each(ul, 21, () => todos, (todo) => todo.id, ($$anchor, todo, $$index) => {
		var li = root();
		var button_1 = $.child(li);
		var text_1 = $.only_child(button_1, true);
		var text_2 = $.sibling(button_1);

		$.reset(li);

		$.template_effect(() => {
			$.set_text(text_1, $.get(todo).done ? '✓' : '○');
			$.set_text(text_2, \` \${$.get(todo).text ?? ''}\`);
		});

		$.delegated('click', button_1, () => ($.get(todo).done = !$.get(todo).done));
		$.append($$anchor, li);
	});

	$.reset(ul);
	$.template_effect(() => $.set_text(text, \`\${$$props.title ?? ''} — осталось \${$.get(left) ?? ''}\`));
	$.delegated('click', button, () => todos.reverse());
	$.append($$anchor, fragment);
	$.pop();
}

$.delegate(['click']);`;

export const OUT_NOTES = [
  {
    t: 'Разметка — два шаблона HTML',
    d: '`$.from_html` разбирает строку один раз: кладёт её в `<template>` и запоминает содержимое. Вызов `root_1()` отдаёт копию — `cloneNode(true)` (в Firefox `importNode`). Шаблонов два: вся разметка и отдельно `<li>`, который клонируется на каждый элемент списка. Пробел в `<h2> </h2>` — заготовка текстового узла.',
  },
  {
    t: 'Дорога к узлам — арифметика',
    d: '`$.first_child`, `$.sibling(h2, 2)`, `$.child(li)` — это `firstChild` и `nextSibling` с заранее посчитанным шагом. Двойка — потому что между `<h2>` и кнопкой лежит текстовый узел с пробелом. Ни поиска по селектору, ни сравнения деревьев.',
  },
  {
    t: '`$props()` — не сигнал',
    d: '`title` нигде не объявлен: каждое чтение компилятор заменил на `$$props.title`. Реактивность приходит от родителя — он передаёт проп **геттером**, который читает его `$state` (вывод родителя ниже). Чтение геттера внутри эффекта подписывает эффект на состояние родителя напрямую.',
  },
  {
    t: '`$state` без `$.state`',
    d: '`todos` нигде не переприсваивается, поэтому источник вокруг переменной не нужен: компилятор оставил только `$.proxy([...])`. Отслеживаются свойства внутри — `todos[0].done`, `todos.length`, а не сама переменная.',
  },
  {
    t: '`$derived` — функция, а не значение',
    d: '`$.derived(() => …)` ничего не считает при создании. Считать будет первый, кто прочтёт `$.get(left)`, — здесь шаблонный эффект `<h2>`.',
  },
  {
    t: '`{#each}` — свой блок',
    d: '`$.each(ul, 21, () => todos, (todo) => todo.id, …)`: откуда брать массив, как получить ключ и как отрисовать один элемент. `todo` внутри — источник, отсюда `$.get(todo)`. Число 21 — набор флагов блока: элемент реактивен (1), блок единственный в родителе (4), элементы неизменяемы (16).',
  },
];

/** Родитель сквозного примера: как проп становится геттером. */
export const PARENT_SRC = `<script>
  import Todos from './Todos.svelte';
  let name = $state('Дела');
</script>

<button onclick={() => (name = 'Покупки')}>переименовать</button>
<Todos title={name} />`;

export const PARENT_OUT = `import 'svelte/internal/disclose-version';
import * as $ from 'svelte/internal/client';
import Todos from './Todos.svelte';

var root = $.from_html(\`<button>переименовать</button> <!>\`, 1);

export default function App($$anchor) {
	let name = $.state('Дела');
	var fragment = root();
	var button = $.first_child(fragment);
	var node = $.sibling(button, 2);

	Todos(node, {
		get title() {
			return $.get(name);
		}
	});

	$.delegated('click', button, () => $.set(name, 'Покупки'));
	$.append($$anchor, fragment);
}

$.delegate(['click']);`;

/** Сколько раз что выполнилось — снято обёртками вокруг рантайма (см. шапку). */
export const TODO_COUNTS = {
  mount: { Todos: 1, template_effect: 4, derived: 1, user_effect: 1 },
  toggle: { template_effect: 2, derived: 1, user_effect: 1 },
  reverse: { derived: 1 },
  rename: { template_effect: 1, user_effect: 1 },
};

export const COST_HEAD = ['действие', 'функция `Todos`', 'шаблонные эффекты', '`derived` `left`', '`$effect`', 'записи DOM'];

export const COST_ROWS = [
  ['монтирование', '1', '4 из 4', '1', '1', 'весь HTML'],
  ['клик по «○» у первого дела', '0', '2 из 4: его `<li>` и `<h2>`', '1', '1', '2 текста'],
  ['«перевернуть»', '0', '0', '1 — значение то же', '0', '4: переносы узлов'],
  ['родитель переименовал список', '0', '1: `<h2>`', '0', '1', '1 текст'],
];

export const COST_NOTE =
  'Самая показательная строка — «перевернуть». `left` пересчитался: `filter` читает все элементы, а они переставлены. Но количество невыполненных дел то же — значение `2`, — и дальше пересчёт не пошёл: ни `<h2>`, ни `document.title` не тронуты. Эффекты трёх `<li>` тоже не выполнялись: каждый элемент остался тем же объектом, сменилось только его место, и узлы просто переставлены.';

// ─── Раздел 2. Руны как сигналы ────────────────────────────────────────────────────────────

export const GRAPH_LEAD =
  'За `$.state`, `$.derived` и эффектами стоит граф. Идея та же, что у всех сигналов: запись толкает вниз пометку, читатель тянет пересчёт вверх. Своё у Svelte — запись этой идеи: флаги в битовом поле и один счётчик записей на всё приложение. Мини-руны ниже повторяют рантайм 5.57.1 с теми же именами функций, полей и битов.';

export const PLAIN_FLAGS =
  'Как пометки на папках в архиве. Красная — «точно устарело, переделать». Жёлтая — «возможно, устарело: сверь даты». Даты — номера записей: если документ-источник новее вашей копии, копию переделывают; если нет — снимают жёлтую пометку и ничего не делают.';

export const STEP_FLAGS = `// Биты — те же, что в svelte/src/internal/client/constants.js
const DERIVED = 1 << 1
const EFFECT = 1 << 2          // $effect: выполняется после шаблона
const RENDER_EFFECT = 1 << 3   // template_effect: выполняется при обходе
const CLEAN = 1 << 10
const DIRTY = 1 << 11
const MAYBE_DIRTY = 1 << 12
const STATUS = CLEAN | DIRTY | MAYBE_DIRTY
const UNINITIALIZED = Symbol('uninitialized')

let active_reaction = null     // derived или эффект, который сейчас выполняется
let new_deps = null            // что он успел прочитать за этот прогон
let own_writes = null          // что он успел записать за этот прогон
let write_version = 1          // один счётчик записей на всё приложение
let batch = null               // пакет: записи, которые ещё не сброшены
let flushing = false
const effects = []             // у Svelte — дерево эффектов; здесь один корень
const trace = { on: null }     // подписка демо на шаги; к механизму не относится

function set_status(signal, status) {
  signal.f = (signal.f & ~STATUS) | status
  trace.on?.('status', signal)
}`;

export const STEP_SOURCE = `// $state(v) → $.state(v)
function state(v) {
  const s = { f: 0, v, wv: 0, reactions: null }
  trace.on?.('create', s)
  return s
}

// Каждое чтение в шаблоне и в $derived компилятор заменил на $.get(x)
function get(signal) {
  if (active_reaction !== null && !new_deps.includes(signal)) {
    new_deps.push(signal)                     // чтение = подписка
  }
  if ((signal.f & DERIVED) !== 0 && is_dirty(signal)) {
    update_derived(signal)                    // pull: досчитать только сейчас
  }
  return signal.v
}

// x = v → $.set(x, v); x++ → $.update(x)
function set(source, value, should_proxy = false) {
  if (should_proxy) value = proxy(value)
  if (value === source.v) return value        // то же значение — тишина
  source.v = value
  source.wv = ++write_version                 // запись получает номер
  trace.on?.('write', source)
  if (active_reaction !== null) own_writes.push(source)
  mark_reactions(source, DIRTY)
  ensure_batch()                              // сброс — потом, в микрозадаче
  return value
}

// push: прямые читатели — DIRTY, всё, что за derived, — MAYBE_DIRTY
function mark_reactions(signal, status) {
  for (const reaction of signal.reactions ?? []) {
    const not_dirty = (reaction.f & DIRTY) === 0
    if (not_dirty) set_status(reaction, status)
    if ((reaction.f & DERIVED) !== 0) mark_reactions(reaction, MAYBE_DIRTY)
    else if (not_dirty) schedule()
  }
}`;

export const SOURCE_NOTE =
  '`set` не вызывает ни одной пользовательской функции. Он меняет значение, выдаёт записи номер, раскрашивает граф и заводит пакет — всё. Раскраска двухцветная: тот, кто читал источник сам, получает `DIRTY`, а тот, кто читал его через `derived`, — `MAYBE_DIRTY`. Значение `derived` может и не измениться, и тогда его читателям делать нечего; узнать это можно только пересчитав `derived`, а пересчёт — дело читателя, не записи.';

export const STEP_DERIVED = `// $derived(expr) → $.derived(() => expr)
function derived(fn) {
  const d = { f: DERIVED | DIRTY, fn, v: UNINITIALIZED, wv: 0, deps: null, reactions: null }
  trace.on?.('create', d)
  return d
}

function update_derived(d) {
  const value = update_reaction(d)
  if (value !== d.v) {
    d.v = value
    d.wv = ++write_version                    // новый номер — только если значение другое
  }
  set_status(d, CLEAN)
}

// «Грязный» ли узел. MAYBE_DIRTY проверяется по номерам записей зависимостей.
function is_dirty(reaction) {
  if ((reaction.f & DIRTY) !== 0) return true
  if ((reaction.f & MAYBE_DIRTY) !== 0) {
    for (const dep of reaction.deps) {
      if ((dep.f & DERIVED) !== 0 && is_dirty(dep)) update_derived(dep)
      if (dep.wv > reaction.wv) return true   // зависимость новее читателя
    }
    set_status(reaction, CLEAN)               // все номера старые — пересчёт не нужен
  }
  return false
}

// Выполнить fn и собрать зависимости заново: ветка if могла смениться
function update_reaction(reaction) {
  const prev = [active_reaction, new_deps, own_writes]
  active_reaction = reaction
  new_deps = []
  own_writes = []
  trace.on?.('run', reaction)
  try {
    const result = reaction.fn()
    for (const dep of reaction.deps ?? []) {
      dep.reactions = dep.reactions.filter((r) => r !== reaction)
    }
    for (const dep of new_deps) (dep.reactions ??= []).push(reaction)
    reaction.deps = new_deps
    // эффект записал то, что сам же прочёл, — он снова устарел
    if ((reaction.f & (DERIVED | DIRTY | MAYBE_DIRTY)) === 0 && own_writes.some((s) => new_deps.includes(s))) {
      set_status(reaction, DIRTY)
      schedule()
    }
    return result
  } finally {
    [active_reaction, new_deps, own_writes] = prev
  }
}`;

export const DERIVED_NOTE =
  '`is_dirty` — весь pull. `DIRTY` — пересчитать без вопросов. `MAYBE_DIRTY` — пройти по зависимостям в том порядке, в каком их читали прошлый раз: `derived` среди них досчитать, а потом сравнить его номер записи со своим. Нашлась зависимость новее — пересчитать; не нашлась — снять пометку. Отсечка «значение то же — дальше не идём» стоит в `update_derived`: новый номер `derived` получает, только если значение изменилось. Без нового номера его читатели при сверке увидят старое число и не выполнятся.';

export const COMPARE_HEAD = ['', 'мини-версия «Сигналов»', 'Svelte 5.57.1 и мини-руны'];

export const COMPARE_ROWS = [
  ['пометка вниз', 'один булев флаг `stale`', 'два цвета: `DIRTY` у прямых читателей, `MAYBE_DIRTY` за `derived` — биты в поле `f`'],
  ['чем сверяют', 'у каждой связи запомнена версия источника: `Map` источник → версия', 'одно число у реакции: `dep.wv > reaction.wv`'],
  ['откуда номера', 'у каждого сигнала свой счётчик', 'один `write_version` на всё приложение'],
  ['зависимости', '`Map` и `Set`', 'массивы `deps` и `reactions`'],
  ['кто выполняет эффекты', 'очередь помеченных эффектов', 'обход дерева эффектов: шаблонные — по пути, `$effect` — после'],
];

export const COMPARE_NOTE =
  'Один глобальный счётчик — главная экономия Svelte. Чтобы понять, видел ли эффект запись, не нужно хранить версию каждого источника на каждой связи: эффект запоминает одно число — номер последней записи на момент своего прогона, — и любой источник с номером больше записан позже. Общий алгоритм с версиями на связях и ромбом — в [«Сигналах», раздел «Push и pull»](/frameworks/signals/#s2).';

// ─── Раздел 3. Пакет и сброс ───────────────────────────────────────────────────────────────

export const PLAIN_BATCH =
  'Как почтовый ящик с выемкой по расписанию. Сколько писем вы ни бросите, пока почтальон не пришёл, он заберёт их одним рейсом. `flushSync` — вызвать курьера прямо сейчас: он увезёт то, что накопилось, не дожидаясь выемки.';

export const STEP_EFFECT = `function create_effect(type, fn) {
  const effect = { f: type | DIRTY, fn, deps: null, wv: 0, teardown: null }
  effects.push(effect)
  trace.on?.('create', effect)
  if ((type & EFFECT) !== 0) schedule()       // $effect — при ближайшем сбросе
  else update_effect(effect)                  // шаблонный — сразу, при монтировании
  return effect
}

function update_effect(effect) {
  set_status(effect, CLEAN)
  effect.teardown?.()                         // функция очистки прошлого прогона
  const teardown = update_reaction(effect)
  effect.teardown = typeof teardown === 'function' ? teardown : null
  effect.wv = write_version                   // эффект видел все записи до этой
}

// $effect(fn) → $.user_effect(fn); {выражение} в разметке → $.template_effect(...)
const user_effect = (fn) => create_effect(EFFECT, fn)
const template_effect = (fn) => create_effect(RENDER_EFFECT, fn)`;

export const STEP_BATCH = `function ensure_batch() {
  if (batch !== null) return batch
  const b = (batch = { scheduled: false, started: false })
  if (!flushing) queueMicrotask(() => { if (!b.started) flush() })
  return b
}

function schedule() {
  ensure_batch().scheduled = true
}

// flushSync() → flush()
function flush() {
  if (flushing) return
  flushing = true
  let count = 0
  try {
    while (batch !== null) {
      if (count++ > 1000) throw new Error('effect_update_depth_exceeded')
      batch.started = true
      trace.on?.('flush', null)
      const user = []
      do {
        batch.scheduled = false
        for (const effect of effects) {       // обход в порядке дерева
          if ((effect.f & EFFECT) !== 0) user.push(effect)
          else if (is_dirty(effect)) update_effect(effect)
        }
      } while (batch.scheduled)               // шаблон мог что-то записать
      batch = null                            // новые записи — в новый пакет
      for (const effect of user) {
        if (is_dirty(effect)) update_effect(effect)
      }
    }
  } finally {
    flushing = false
  }
}`;

export const BATCH_NOTE =
  'Пакет заводит первая же запись, и в этот момент в очередь микрозадач ставится его сброс. Все записи до этой микрозадачи попадают в тот же пакет: обработчик клика может поменять десять источников, а эффекты выполнятся по разу. Явного `batch(fn)` в Svelte нет — пакетом служит сам синхронный код до ближайшей микрозадачи.';

export const ORDER_NOTE =
  'Сброс обходит дерево эффектов сверху вниз. Шаблонный эффект, если он грязный, выполняется прямо по пути, а `$effect` только откладывается в список и выполняется, когда обход закончен. Поэтому `$effect` всегда видит уже обновлённый DOM — порядок не зависит от того, в каком порядке эффекты объявлены. В мини-рунах дерево сплющено в один список, а порядок выполнения тот же.';

export const FLUSHSYNC_NOTE =
  '`flushSync()` сбрасывает пакет сразу, не дожидаясь микрозадачи. Нужен он там, где следующей строкой вы читаете DOM: прокрутить к только что добавленному элементу, измерить его, поставить фокус. В тестах — чтобы проверить разметку сразу после клика. Асинхронная замена — `await tick()`: дождаться микрозадачи, в которой пакет и сбросится.';

export const DEMO_CAPTION =
  'Каждый сценарий — строка на тех же вызовах, что в выводе компилятора. Здесь она исполнена мини-рунами, и таблица показывает флаги и номера записей узлов после каждого шага. Тот же код, исполненный настоящим `svelte/internal/client` 5.57.1, дал журнал во второй колонке — и мини-руны повторяют его строка в строку.';

/** Сценарии демо и теста. Код исполняется и мини-рунами, и `svelte/internal/client`. */
export const SCENARIOS: RunesScenario[] = [
  {
    id: 'diamond',
    label: 'ромб',
    code: `const a = $.tag($.state(1), 'a')
const b = $.tag($.derived(() => (log('b считает'), $.get(a) * 2)), 'b')
const c = $.tag($.derived(() => (log('c считает'), $.get(a) + 1)), 'c')

$.effect_root(() => {
  $.user_effect(() => log(\`эффект: b = \${$.get(b)}, c = \${$.get(c)}\`))
})
$.flush()

log('— запись a = 2')
$.set(a, 2)
$.flush()`,
    note: 'Запись `a` красит `b` и `c` в `DIRTY`, а эффект — в `MAYBE_DIRTY`: сам он `a` не читал. При сбросе эффект сверяет зависимости по порядку: досчитывает `b`, видит, что её номер новее его собственного, и выполняется. `c` досчитывается уже его чтением. Каждый `derived` — ровно по разу, глитча нет.',
    svelte: [
      'b считает',
      'c считает',
      'эффект: b = 2, c = 2',
      '— запись a = 2',
      'b считает',
      'c считает',
      'эффект: b = 4, c = 3',
    ],
  },
  {
    id: 'cutoff',
    label: 'отсечка',
    code: `const n = $.tag($.state(1), 'n')
const odd = $.tag($.derived(() => (log('odd считает'), $.get(n) % 2 === 1)), 'odd')

$.effect_root(() => {
  $.user_effect(() => log(\`эффект: odd = \${$.get(odd)}\`))
})
$.flush()

log('— запись n = 3')
$.set(n, 3)
$.flush()

log('— запись n = 4')
$.set(n, 4)
$.flush()`,
    note: 'После `n = 3` `odd` пересчитан, но значение то же — `true`, и номер записи у него старый. Эффект в `MAYBE_DIRTY` сверяет номера, не находит ничего новее себя и не выполняется. После `n = 4` значение сменилось — эффект выполнен.',
    svelte: [
      'odd считает',
      'эффект: odd = true',
      '— запись n = 3',
      'odd считает',
      '— запись n = 4',
      'odd считает',
      'эффект: odd = false',
    ],
  },
  {
    id: 'lazy',
    label: 'ленивость',
    code: `const a = $.tag($.state(1), 'a')
const square = $.tag($.derived(() => (log('square считает'), $.get(a) ** 2)), 'square')

log('— derived создан и не прочитан')
$.set(a, 2)
$.set(a, 3)
log(\`прочитали: \${$.get(square)}\`)
log(\`прочитали ещё раз: \${$.get(square)}\`)`,
    note: 'Две записи — ни одного пересчёта: `square` никто не читает. Первое чтение считает его один раз, второе отдаёт запомненное. Чтение вне эффекта не подписывает, но и не пересчитывает зря: номер `a` не новее номера `square`.',
    svelte: ['— derived создан и не прочитан', 'square считает', 'прочитали: 9', 'прочитали ещё раз: 9'],
  },
  {
    id: 'batch',
    label: 'пакет',
    code: `const price = $.tag($.state(100), 'price')
const qty = $.tag($.state(2), 'qty')

$.effect_root(() => {
  $.user_effect(() => log(\`эффект: итого \${$.get(price) * $.get(qty)}\`))
})
$.flush()

log('— две записи подряд')
$.set(price, 120)
$.set(qty, 3)
log('— записи сделаны, эффект ещё не запускался')
await Promise.resolve()
log('— микрозадача прошла')

log('— две записи, flush после каждой')
$.set(price, 150)
$.flush()
$.set(qty, 4)
$.flush()`,
    note: 'Две записи подряд — один прогон эффекта, и не сразу, а в микрозадаче: промежуточного «итого 240» не видел никто. С `flush` после каждой записи эффект выполнен дважды.',
    svelte: [
      'эффект: итого 200',
      '— две записи подряд',
      '— записи сделаны, эффект ещё не запускался',
      'эффект: итого 360',
      '— микрозадача прошла',
      '— две записи, flush после каждой',
      'эффект: итого 450',
      'эффект: итого 600',
    ],
  },
  {
    id: 'order',
    label: 'шаблон и $effect',
    code: `const count = $.tag($.state(0), 'count')

$.effect_root(() => {
  $.user_effect(() => log(\`$effect видит \${$.get(count)}\`))
  $.template_effect(() => log(\`шаблон видит \${$.get(count)}\`))
})
log('— компонент создан')
$.flush()

log('— запись count = 1')
$.set(count, 1)
$.flush()`,
    note: '`$effect` объявлен первым, а выполняется вторым — и при создании, и после записи. Шаблонный эффект выполнен сразу при создании, `$effect` — только при сбросе, после обхода.',
    svelte: ['шаблон видит 0', '— компонент создан', '$effect видит 0', '— запись count = 1', 'шаблон видит 1', '$effect видит 1'],
  },
  {
    id: 'branch',
    label: 'ветка if',
    code: `const full = $.tag($.state(false), 'full')
const first = $.tag($.state('Ада'), 'first')
const last = $.tag($.state('Лавлейс'), 'last')

$.effect_root(() => {
  $.template_effect(() =>
    log($.get(full) ? \`шаблон: \${$.get(first)} \${$.get(last)}\` : \`шаблон: \${$.get(first)}\`))
})

log('— запись last: шаблон её не читал')
$.set(last, 'Байрон')
$.flush()

log('— запись full = true')
$.set(full, true)
$.flush()

log('— запись last снова')
$.set(last, 'Кинг')
$.flush()`,
    note: 'Зависимости собираются заново на каждом прогоне. Пока `full` ложно, `last` не прочитан — и запись в него никого не будит. После `full = true` эффект прочёл `last` и подписался.',
    svelte: [
      'шаблон: Ада',
      '— запись last: шаблон её не читал',
      '— запись full = true',
      'шаблон: Ада Байрон',
      '— запись last снова',
      'шаблон: Ада Кинг',
    ],
  },
  {
    id: 'sync',
    label: '$effect вместо $derived',
    code: `const count = $.tag($.state(1), 'count')
const viaEffect = $.tag($.state(0), 'viaEffect')
const viaDerived = $.tag($.derived(() => $.get(count) * 2), 'viaDerived')

$.effect_root(() => {
  $.user_effect(() => {
    $.set(viaEffect, $.get(count) * 2)
  })
  $.template_effect(() =>
    log(\`шаблон: count = \${$.get(count)}, $effect → \${$.get(viaEffect)}, $derived → \${$.get(viaDerived)}\`))
})
$.flush()

log('— запись count = 2')
$.set(count, 2)
$.flush()`,
    note: 'Двойное значение посчитано двумя способами. Через `$derived` шаблон сразу видит согласованную пару. Через `$effect` — сначала старое значение: `$effect` выполняется после шаблона, его запись заводит новый пакет, и шаблон выполняется второй раз.',
    svelte: [
      'шаблон: count = 1, $effect → 0, $derived → 2',
      'шаблон: count = 1, $effect → 2, $derived → 2',
      '— запись count = 2',
      'шаблон: count = 2, $effect → 2, $derived → 4',
      'шаблон: count = 2, $effect → 4, $derived → 4',
    ],
  },
  {
    id: 'proxy',
    label: 'Proxy и raw',
    code: `const deep = $.proxy({ items: ['чай'] })                // $state({ … })
const raw = $.tag($.state({ items: ['чай'] }), 'raw')  // $state.raw({ … })

$.effect_root(() => {
  $.template_effect(() => log(\`шаблон deep: \${deep.items.length}\`))
  $.template_effect(() => log(\`шаблон raw: \${$.get(raw).items.length}\`))
})

log('— push в оба массива')
deep.items.push('кофе')
$.get(raw).items.push('кофе')
$.flush()

log('— raw получает новый объект')
$.set(raw, { items: [...$.get(raw).items] })
$.flush()`,
    note: 'У прокси свой источник на каждое прочитанное свойство: `items`, `length`, новый индекс `1`. `push` записывает индекс и `length` — шаблон `deep` выполнен. У `raw` источник один, на всё значение: `push` в массив мимо него, и шаблон молчит, пока `raw` не получит новый объект.',
    svelte: ['шаблон deep: 1', 'шаблон raw: 1', '— push в оба массива', 'шаблон deep: 2', '— raw получает новый объект', 'шаблон raw: 2'],
  },
  {
    id: 'cleanup',
    label: 'очистка',
    code: `const room = $.tag($.state('общий'), 'room')

$.effect_root(() => {
  $.user_effect(() => {
    const name = $.get(room)
    log(\`подключились к «\${name}»\`)
    return () => log(\`отключились от «\${name}»\`)
  })
})
$.flush()

log('— запись room')
$.set(room, 'кухня')
$.flush()`,
    note: 'Функция, которую вернул эффект, — очистка. Перед следующим прогоном она выполняется первой и видит значения своего прогона: «отключились от „общий“», а не от «кухня».',
    svelte: ['подключились к «общий»', '— запись room', 'отключились от «общий»', 'подключились к «кухня»'],
  },
];

const pick = (id: string): RunesScenario => {
  const s = SCENARIOS.find((x) => x.id === id);
  if (!s) throw new Error(`нет сценария ${id}`);
  return s;
};

/** Сценарии, напечатанные в разделе «$effect против $derived» вместе с журналом Svelte. */
export const SYNC_SCENARIO = pick('sync');
export const CLEANUP_SCENARIO = pick('cleanup');

// ─── Раздел 4. $state и Proxy ──────────────────────────────────────────────────────────────

export const PROXY_LEAD =
  '`$state` с простым объектом или массивом даёт не один источник, а Proxy: у каждого свойства свой источник, и заводится он при первом чтении. Вложенный объект оборачивается тоже — в момент, когда его прочли. `$state.raw` прокси не делает: следит только за тем, заменили ли значение целиком.';

export const PLAIN_PROXY =
  'Как вахтёр у двери склада. Сам склад — обычный объект, но всё, что выносят и заносят, проходит через вахтёра, и он записывает в журнал, кто что взял: «эффект `<h2>` брал полку `length`». Принесли на полку новое — вахтёр знает, кому сообщить. У `$state.raw` вахтёра нет: следят только за тем, не подменили ли склад целиком.';

export const STEP_PROXY = `const STATE = Symbol('$state')

// $state({ … }) → $.proxy({ … })
function proxy(value) {
  if (typeof value !== 'object' || value === null || STATE in value) return value
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== Array.prototype) return value  // класс, Map, Date — как есть
  const sources = new Map()
  const is_array = Array.isArray(value)
  if (is_array) sources.set('length', tag(state(value.length), 'length'))

  return new Proxy(value, {
    get(target, prop, receiver) {
      if (prop === STATE) return value
      let s = sources.get(prop)
      const exists = prop in target
      if (s === undefined && (!exists || Object.getOwnPropertyDescriptor(target, prop)?.writable)) {
        // вложенное — тоже прокси, но только сейчас, при первом чтении
        s = tag(state(proxy(exists ? target[prop] : UNINITIALIZED)), String(prop))
        sources.set(prop, s)
      }
      if (s === undefined) return Reflect.get(target, prop, receiver)        // метод прототипа: push, filter
      const v = get(s)
      return v === UNINITIALIZED ? undefined : v
    },
    has(target, prop) {
      if (prop === STATE) return true
      const s = sources.get(prop)
      return s !== undefined ? get(s) !== UNINITIALIZED : prop in target
    },
    set(target, prop, next) {
      let s = sources.get(prop)
      const had = s !== undefined ? s.v !== UNINITIALIZED : prop in target
      if (s === undefined) sources.set(prop, (s = tag(state(UNINITIALIZED), String(prop))))
      set(s, proxy(next))                     // в источник; исходный объект не трогается
      if (is_array && !had) {
        const n = Number(prop)
        const length = sources.get('length')
        if (Number.isInteger(n) && n >= length.v) set(length, n + 1)
      }
      return true
    },
  })
}`;

/** Хвост мини-рун: корень эффектов, подпись узла для демо и экспорт. */
export const STEP_EXPORT = `// $.effect_root: корень дерева эффектов; здесь корень один, и он — сам список effects
const effect_root = (fn) => fn()

// $.tag(signal, 'имя') — подпись узла; компилятор ставит её в режиме dev
function tag(signal, label) {
  signal.label = label
  return signal
}

return {
  $: { state, derived, get, set, proxy, user_effect, template_effect, effect_root, flush, tag },
  flags: { DERIVED, EFFECT, RENDER_EFFECT, CLEAN, DIRTY, MAYBE_DIRTY },
  trace,
}`;

/** Мини-руны целиком: то, что исполняют демо и тест. */
export const MINI_RUNES_CODE = [STEP_FLAGS, STEP_SOURCE, STEP_DERIVED, STEP_EFFECT, STEP_BATCH, STEP_PROXY, STEP_EXPORT].join(
  '\n\n',
);

export const CART_SRC = `<script>
  let cart = $state({ items: ['чай'] });
  let history = $state.raw({ items: ['чай'] });
</script>

<button onclick={() => cart.items.push('кофе')}>{cart.items.length}</button>
<button onclick={() => (cart = { items: [] })}>очистить</button>
<button onclick={() => history.items.push('кофе')}>{history.items.length}</button>
<button onclick={() => (history = { items: [...history.items, 'кофе'] })}>заменить</button>`;

export const CART_OUT = `import 'svelte/internal/disclose-version';
import * as $ from 'svelte/internal/client';

var root = $.from_html(\`<button> </button> <button>очистить</button> <button> </button> <button>заменить</button>\`, 1);

export default function Cart($$anchor) {
	let cart = $.state($.proxy({ items: ['чай'] }));
	let history = $.state({ items: ['чай'] });
	var fragment = root();
	var button = $.first_child(fragment);
	var text = $.only_child(button, true);
	var button_1 = $.sibling(button, 2);
	var button_2 = $.sibling(button_1, 2);
	var text_1 = $.only_child(button_2, true);
	var button_3 = $.sibling(button_2, 2);

	$.template_effect(() => {
		$.set_text(text, $.get(cart).items.length);
		$.set_text(text_1, $.get(history).items.length);
	});

	$.delegated('click', button, () => $.get(cart).items.push('кофе'));
	$.delegated('click', button_1, () => $.set(cart, { items: [] }, true));
	$.delegated('click', button_2, () => $.get(history).items.push('кофе'));
	$.delegated('click', button_3, () => $.set(history, { items: [...$.get(history).items, 'кофе'] }));
	$.append($$anchor, fragment);
}

$.delegate(['click']);`;

/** Тексты четырёх кнопок `Cart` после каждого клика — снято тестом. */
export const CART_CLICKS: { click: string; buttons: string[] }[] = [
  { click: 'монтирование', buttons: ['1', 'очистить', '1', 'заменить'] },
  { click: '`cart.items.push`', buttons: ['2', 'очистить', '1', 'заменить'] },
  { click: '`history.items.push`', buttons: ['2', 'очистить', '1', 'заменить'] },
  { click: '«заменить»', buttons: ['2', 'очистить', '3', 'заменить'] },
  { click: '«очистить»', buttons: ['0', 'очистить', '3', 'заменить'] },
];

export const PROXY_FACTS: { t: string; d: string; tone?: 'warn' | 'err' }[] = [
  {
    t: 'Переприсваивание — и источник, и прокси',
    d: '`cart` переприсваивается, поэтому вокруг прокси появился источник: `$.state($.proxy(…))`. Запись `cart = { items: [] }` стала `$.set(cart, …, true)` — третий аргумент просит обернуть новый объект в прокси. `history` — `$.state(…)` без прокси и `$.set` без третьего аргумента.',
  },
  {
    t: '`push` в `$state.raw` молчит, но меняет данные',
    d: 'После клика по третьей кнопке на ней по-прежнему «1»: массив изменился, а источник `history` — нет. Кнопка «заменить» копирует уже изменённый массив, и счётчик прыгает сразу на 3. Мутация не потерялась, она просто ждала чужой перерисовки.',
    tone: 'err',
  },
  {
    t: 'Только простые объекты и массивы',
    d: '`$.proxy` проверяет прототип: экземпляр класса, `Map`, `Set`, `Date` возвращаются как есть, без прокси. Для коллекций у Svelte есть `SvelteMap`, `SvelteSet` и `SvelteDate` в `svelte/reactivity`; в классе отслеживаемые поля объявляют рунами: `count = $state(0)`.',
    tone: 'warn',
  },
  {
    t: 'Исходный объект не меняется',
    d: 'Прокси пишет в свои источники, а не в объект, который ему дали: после `p.n = 2` у исходного `o.n` по-прежнему 1. У `reactive` во Vue наоборот — запись проходит в исходный объект. Ссылку на исходный объект после `$state(o)` лучше не держать вовсе.',
    tone: 'warn',
  },
];

export const RAW_NOTE =
  '`$state.raw` — для данных, которые не мутируют, а заменяют целиком: ответ сервера, большой список, который приходит новым массивом. Прокси на каждое прочитанное свойство заводит источник, и на большом массиве объектов это тысячи источников, которые никому не нужны. Документация Svelte советует `$state.raw` именно для этого — для крупных объектов и массивов, которые вы не собирались менять на месте.';

// ─── Раздел 5. $effect против $derived ─────────────────────────────────────────────────────

export const SYNC_NOTE =
  'Значение, вычисленное из другого, работает и через `$effect`, и через `$derived`. Но у `$effect` цена двойная: шаблон выполняется на каждое изменение **два** раза, и в первый раз показывает пару, которой в данных не было: `count = 2` рядом со старым удвоенным `2`. На экране это кадр с неверной суммой — если сброс не успел до отрисовки, его и правда увидят.';

export const EFFECT_VS_HEAD = ['', '`$derived`', '`$effect`'];

export const EFFECT_VS_ROWS = [
  ['когда выполняется', 'лениво: когда его прочли, и только если зависимость новее', 'при сбросе, после всех шаблонных эффектов'],
  ['что возвращает', 'значение', 'ничего или функцию очистки'],
  ['запись в `$state` внутри', 'ошибка `state_unsafe_mutation`', 'можно — но это новый пакет и ещё один проход'],
  ['на сервере', 'считается', 'не выполняется (по документации)'],
  ['для чего', 'всё, что вычисляется из состояния', 'выход наружу: DOM вне шаблона, таймеры, сеть, сторонние библиотеки'],
];

export const CLEANUP_NOTE =
  'Очистка выполняется перед каждым следующим прогоном и при уничтожении эффекта — когда компонент размонтирован или блок `{#if}` закрылся. Это и есть законная работа `$effect`: подписаться на что-то снаружи и отписаться, когда значение сменилось.';

// ─── Раздел 6. Списки с ключом ─────────────────────────────────────────────────────────────

export const PLAIN_KEY =
  'Как бейдж с именем у сотрудника. При переезде отдела бейдж показывает, что это тот же человек, — его переводят в новый кабинет вместе со столом. Без бейджей завхоз оставит столы на местах и перевесит таблички с именами: снаружи то же, а вещи в ящиках достались другим людям.';

/** Записи `MutationObserver` на кнопку «перевернуть» и клик по «○» — happy-dom и Chromium совпали. */
export const EACH_RECORDS = {
  keyed: { toggle: { characterData: 2 }, reverse: { childList: 4 } },
  unkeyed: { toggle: { characterData: 2 }, reverse: { characterData: 4 } },
};

export const EACH_HEAD = ['', 'с ключом `(todo.id)`', 'без ключа'];

export const EACH_ROWS = [
  ['записи DOM на «перевернуть»', '4 `childList`: два узла `<li>` сняты и вставлены', '4 `characterData`: текст в двух крайних `<li>`'],
  ['первый `<li>` после разворота', 'тот же узел, теперь последний', 'тот же узел на том же месте — с текстом третьего дела'],
  ['клик по «○»', '2 текста', '2 текста'],
];

export const EACH_NOTE =
  'По числу записей варианты равны — разница в том, что уехало вместе с узлом. С ключом `<li>` переносится целиком: фокус в поле ввода, выделение, идущая CSS-анимация, состояние вложенного компонента — всё остаётся у своего дела. Без ключа узлы стоят на месте, а меняются в них тексты, и фокус остаётся на третьей строке, где теперь другое дело. Так же устроен `createFor` во Vue Vapor — [«Vapor Mode во Vue», раздел «Списки и условия»](/frameworks/vue-vapor/#s3).';

// ─── Раздел 7. Против Svelte 4 ─────────────────────────────────────────────────────────────

export const LEGACY_SRC = `<script>
  export let log;
  let button;
  let count = 0;
  $: double = count * 2;
  $: log(\`$: count = \${count}, в DOM «\${button?.textContent}»\`);
</script>

<button bind:this={button} on:click={() => count++}>{count} × 2 = {double}</button>`;

export const RUNES_SRC = `<script>
  let { log } = $props();
  let button;
  let count = $state(0);
  let double = $derived(count * 2);

  $effect(() => {
    log(\`$effect: count = \${count}, в DOM «\${button.textContent}»\`);
  });
</script>

<button bind:this={button} onclick={() => count++}>{count} × 2 = {double}</button>`;

export const LEGACY_OUT = `import 'svelte/internal/disclose-version';
import 'svelte/internal/flags/legacy';
import * as $ from 'svelte/internal/client';

var root = $.from_html(\`<button> </button>\`);

export default function Counter($$anchor, $$props) {
	$.push($$props, false);

	const double = $.mutable_source();
	let log = $.prop($$props, 'log', 8);
	let button = $.mutable_source();
	let count = $.mutable_source(0);

	$.legacy_pre_effect(() => ($.get(count)), () => {
		$.set(double, $.get(count) * 2);
	});

	$.legacy_pre_effect(() => ($.deep_read_state(log()), $.get(count), $.get(button)), () => {
		log()(\`$: count = \${$.get(count)}, в DOM «\${$.get(button)?.textContent}»\`);
	});

	$.legacy_pre_effect_reset();
	$.init();

	var button_1 = root();
	var text = $.only_child(button_1);

	$.bind_this(button_1, ($$value) => $.set(button, $$value), () => $.get(button));
	$.template_effect(() => $.set_text(text, \`\${$.get(count) ?? ''} × 2 = \${$.get(double) ?? ''}\`));
	$.event('click', button_1, () => $.update(count));
	$.append($$anchor, button_1);
	$.pop();
}`;

/** Журналы `log` при монтировании и после одного клика — снято тестом. */
export const ORDER_LEGACY = [
  '$: count = 0, в DOM «undefined»',
  '$: count = 0, в DOM «0 × 2 = 0»',
  '— клик',
  '$: count = 1, в DOM «0 × 2 = 0»',
];

export const ORDER_RUNES = ['$effect: count = 0, в DOM «0 × 2 = 0»', '— клик', '$effect: count = 1, в DOM «1 × 2 = 2»'];

export const LEGACY_OUT_NOTES = [
  {
    t: '`$:` — эффект с зависимостями от компилятора',
    d: '`$.legacy_pre_effect(() => ($.get(count)), () => …)`: первым аргументом идут зависимости, которые компилятор **выписал из текста** выражения. Во второй функции чтения не отслеживаются. Зависимость, спрятанная в вызове функции, в список не попадёт.',
  },
  {
    t: '`let` — источник, который всегда «изменился»',
    d: 'Каждая переменная верхнего уровня стала `$.mutable_source`. Он сравнивает по старым правилам: объект или массив считается изменённым при **любой** записи, даже того же самого. Поэтому в Svelte 4 писали `items = items` после `push` — без присваивания компилятор не видел записи вовсе.',
  },
  {
    t: '`$:` выполняется до DOM',
    d: '`legacy_pre_effect` — шаблонный эффект, объявленный раньше разметки, поэтому он стоит в дереве первым. После клика он видит `count = 1`, а в DOM ещё «0 × 2 = 0». `$effect` в рунах видит DOM уже обновлённым.',
  },
];

export const LEGACY_HEAD = ['', '`let` и `$:` (Svelte 4 и режим совместимости)', 'руны'];

export const LEGACY_ROWS = [
  ['что реактивно', 'любая `let` верхнего уровня компонента', 'только объявленное рунами: `$state`, `$derived`, `$props`'],
  ['где работает', 'только в файле `.svelte`', 'и в `.svelte.js` / `.svelte.ts` (по документации)'],
  ['зависимости выражения', 'выписаны компилятором из текста', 'собираются при выполнении: что прочитано, от того и зависит'],
  ['`push` в массив', 'не виден без `items = items`', 'виден через Proxy'],
  ['запись того же объекта', 'считается изменением', 'тишина: сравнение `===`'],
  ['когда выполняется', '`$:` — до обновления DOM', '`$effect` — после; `$effect.pre` — до'],
];

export const SVELTE4_NOTE =
  'Сам Svelte 4 устроен иначе внутри: сигналов там нет. По его документации и исходникам, присваивание компилировалось в `$$invalidate(i, …)`, а обновление компонента сверяло битовую маску «грязных» переменных — реактивность заканчивалась на границе компонента. Режим совместимости Svelte 5 выполняет тот же код на сигналах, сохранив прежнее поведение. Смешать два синтаксиса в одном компоненте нельзя: с первой же руной компонент компилируется в режиме рун, и `$:` в нём — ошибка компиляции `legacy_reactive_statement_invalid`, а `export let` — `legacy_export_invalid`. Между компонентами — можно: старый и новый живут в одном приложении.';

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

/** Эффект, который читает и пишет одно и то же. Тест исполняет и на Svelte, и на мини-рунах. */
export const LOOP_CODE = `const n = $.state(0)

$.effect_root(() => {
  $.user_effect(() => {
    $.set(n, $.get(n) + 1)     // в компоненте: $effect(() => { n++ })
  })
})
$.flush()                      // Error: …/effect_update_depth_exceeded`;

/** Запись в `$state` из `$derived`. Тест исполняет на Svelte. */
export const UNSAFE_CODE = `const a = $.state(1)
const touched = $.state(false)
const double = $.derived(() => {
  $.set(touched, true)         // Error: …/state_unsafe_mutation
  return $.get(a) * 2
})

$.effect_root(() => {
  $.template_effect(() => log($.get(double)))
})`;

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: '`push` в `$state.raw` молчит — до чужой перерисовки',
    d: 'Мутация `$state.raw` не будит никого, но данные меняет. Первая же замена значения целиком покажет все накопленные изменения разом: в примере `Cart` счётчик прыгнул с 1 на 3. Если данные мутируют на месте — это `$state`, а не `$state.raw`.',
    tone: 'err',
  },
  {
    n: '02',
    t: 'Синхронизация через `$effect` даёт кадр с несогласованной парой',
    d: 'Значение, которое `$effect` записывает из другого состояния, отстаёт на один проход: шаблон выполняется дважды и в первый раз показывает новое `count` со старым удвоенным. Всё, что вычисляется из состояния, — `$derived`.',
    tone: 'err',
  },
  {
    n: '03',
    t: '`$effect`, который читает и пишет одно и то же, зацикливается',
    code: LOOP_CODE,
    d: 'Запись помечает сам эффект грязным, и сброс выполняет его снова — тысячу раз, после чего Svelte бросает `effect_update_depth_exceeded`. Чтение без подписки — `untrack(() => n)`; но чаще такой эффект просто должен быть `$derived` или обработчиком события.',
    tone: 'err',
  },
  {
    n: '04',
    t: 'В `$derived` писать нельзя',
    code: UNSAFE_CODE,
    d: '`$derived` выполняется лениво, в момент чтения, — запись из него поменяла бы граф посреди чтения. Svelte бросает `state_unsafe_mutation` при первом же вычислении.',
    tone: 'warn',
  },
  {
    n: '05',
    t: 'DOM обновляется в микрозадаче, а не на записи',
    d: 'Сразу после `count++` в обработчике `$.get(count)` и любой `$derived` уже новые — их досчитает чтение, — а текст кнопки ещё старый. Измерять, прокручивать, ставить фокус после изменения состояния — после `await tick()` или внутри `flushSync()`.',
    tone: 'warn',
  },
  {
    n: '06',
    t: 'Класс, `Map` и `Date` в `$state` не отслеживаются внутри',
    d: '`$.proxy` оборачивает только простые объекты и массивы. `$state(new Map())` следит лишь за заменой самой `Map`; `map.set(k, v)` никого не разбудит. Нужны `SvelteMap` из `svelte/reactivity` или поля-руны в классе.',
    tone: 'warn',
  },
  {
    n: '07',
    t: 'Без ключа перестановка отдаёт узлы чужим элементам',
    d: 'Без `(todo.id)` переставленный список переписывает текст в узлах, стоящих на местах. Фокус, выделение, анимация и состояние вложенного компонента остаются на позиции, а не у элемента.',
    tone: 'warn',
  },
  {
    n: '08',
    t: 'Исходный объект и прокси расходятся',
    d: 'После `const s = $state(obj)` запись `s.x = 1` попадает в источник прокси, а не в `obj`. Код, который продолжает читать `obj` напрямую, видит старое. У Vue `reactive` ведёт себя наоборот, и привычка оттуда здесь подводит.',
    tone: 'warn',
  },
];

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'Svelte · $state',
    href: 'https://svelte.dev/docs/svelte/$state',
    what: 'глубокие прокси, `$state.raw`, `$state.snapshot`, состояние в классах',
  },
  {
    title: 'Svelte · $derived',
    href: 'https://svelte.dev/docs/svelte/$derived',
    what: 'ленивость, отсечка по равенству, `$derived.by`',
  },
  {
    title: 'Svelte · $effect',
    href: 'https://svelte.dev/docs/svelte/$effect',
    what: 'когда выполняется, очистка, `$effect.pre`, «когда не нужен `$effect`»',
  },
  {
    title: 'Svelte · {#each}',
    href: 'https://svelte.dev/docs/svelte/each',
    what: 'списки с ключом',
  },
  {
    title: 'Svelte · svelte (flushSync, tick)',
    href: 'https://svelte.dev/docs/svelte/svelte',
    what: '`flushSync` и `tick`',
  },
  {
    title: 'Svelte 5 migration guide',
    href: 'https://svelte.dev/docs/svelte/v5-migration-guide',
    what: 'чем руны отличаются от `let` и `$:` Svelte 4',
  },
  {
    title: 'Исходники рантайма Svelte',
    href: 'https://github.com/sveltejs/svelte/tree/main/packages/svelte/src/internal/client',
    what: '`reactivity/sources.js`, `deriveds.js`, `batch.js`, `runtime.js` (`is_dirty`, `get`), `proxy.js`; на стенде — 5.57.1',
  },
];

export const RELATED =
  'Смежное на сайте: [Сигналы](/frameworks/signals/) — push-pull и ромб в общем виде, мини-версия, сверенная с Vue и alien-signals. [Компиляторы фреймворков](/frameworks/framework-compilers/#s5) — первый взгляд на вывод Svelte рядом с React Compiler и Solid. [Vapor Mode во Vue](/frameworks/vue-vapor/) — тот же подход без виртуального DOM в компиляторе Vue. [React против Vue](/frameworks/react-vs-vue/) — две модели рантайма, от которых Svelte уходит. [Vue 3 изнутри](/frameworks/vue-internals/#s2) — `track` и `trigger` на Proxy, который, в отличие от Svelte, пишет в исходный объект.';
