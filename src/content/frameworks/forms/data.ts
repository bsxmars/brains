import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { RenderSetup } from '@/widgets/form-lab/model/types';

/**
 * Данные темы «Формы во фреймворках: где живёт значение поля».
 *
 * Тема написана здесь, 2026-10-01, для направления «Фреймворки изнутри».
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * React **19.3.0** и react-dom 19.3.0, Vue **3.5.42** (`@vue/compiler-dom`, `@vue/compiler-sfc`,
 * `@vue/runtime-dom` той же версии), happy-dom 20.14.5, esbuild 0.28.2, Vite 8.3.0,
 * Chromium **153.0.8010.12** (headless shell из Playwright 1.63), Node 24.11.0, macOS,
 * октябрь 2026. Скрипты стенда — вне проекта, в рабочем каталоге автора темы
 * (`s1-compile.mjs` … `s7-happy.mjs`); страницы отдавал свой `node:http` на 127.0.0.1,
 * фикстура собиралась Vite в режиме `development` (иначе React не пишет предупреждений).
 *
 * Что снято и где перепроверяется (`tests/unit/forms.test.ts`):
 *   — вывод компилятора Vue для `v-model` (`VMODEL_COMPILED`, `VMODEL_ROWS`, `VMODEL_COMPONENT`) —
 *     тест компилирует те же шаблоны и сверяет текст;
 *   — `MODEL_CODE` (мини-`v-model`) — тест гоняет его и настоящие `vModelText`/`vModelCheckbox`/
 *     `vModelRadio`/`vModelSelect` в happy-dom по одним и тем же сценариям ввода и сверяет модель
 *     и DOM после каждого шага;
 *   — `RENDER_CODE` (кто перерисуется) — тест монтирует все варианты `RENDER_SETUPS` (их код —
 *     те самые строки, что видит читатель) в настоящих React и Vue в happy-dom, печатает символ
 *     в каждое поле и сверяет счётчики с моделью; `RENDER_TABLE` пересчитывается оттуда же;
 *   — механика контролируемого поля React (`CONTROL_FACTS`): happy-dom, ввод — запись через
 *     сеттер прототипа и событие `input`, как это делает testing-library;
 *   — каретка (`CARET_ROWS`), IME (`IME_TRACE`, `IME_COUNTS`, `IME_UPPER`), встроенная проверка
 *     (`VALID_STEPS`), `FormData` (`FORMDATA_ROWS`) и действия React 19 (`ACTION_STEPS`) —
 *     настоящий Chromium: тест сам собирает фикстуру esbuild'ом, поднимает её на 127.0.0.1:52010
 *     и печатает клавиатурой Playwright. Код `REACT_CARET_FIX_CODE`, `VUE_CARET_FIX_CODE` и
 *     `ACTION_CODE` исполняется там как есть.
 *
 * Что взято без стенда:
 *   — IME на стенде **имитирован** командами CDP `Input.imeSetComposition` и `Input.insertText`,
 *     настоящий метод ввода операционной системы не запускался. Порядок «последний `input` —
 *     потом `compositionend`» снят только в Chromium; что в других браузерах он бывает иным,
 *     и что Enter, подтверждающий набор, приходит как `keydown` с `isComposing: true`, —
 *     по спецификации UI Events и MDN;
 *   — react-hook-form в проекте не установлен: всё о нём (`register` отдаёт `ref` и слушатели,
 *     значения читаются из DOM, `useWatch` изолирует рендер) — по его документации;
 *   — текст `validationMessage` зависит от языка браузера (на стенде `en-US`) — в тексте его нет;
 *   — Firefox и Safari стенд не снимал; `:user-invalid` есть во всех трёх движках по MDN.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'контролируемое поле',
    d: 'Поле, значение которого задаёт фреймворк: в React — `value` из состояния плюс `onChange`, который это состояние меняет. Поле показывает то, что лежит в состоянии, а не то, что набрал человек.',
  },
  {
    k: 'неконтролируемое поле',
    d: 'Поле, которое хранит значение само, в DOM. Фреймворк задаёт только начальное (`defaultValue`) и читает итог, когда нужно: через `ref` или `FormData` при отправке.',
  },
  {
    k: '`value` и `defaultValue`',
    d: 'Свойство `input.value` — то, что сейчас в поле. Атрибут `value` в разметке — только начальное значение; из JS он виден как `defaultValue`. Набор текста меняет первое и не трогает второе.',
  },
  {
    k: 'каретка',
    d: 'Мигающий курсор ввода в поле. Его место — `selectionStart` и `selectionEnd`. Когда код записывает в `value` новую строку, браузер переносит каретку в конец.',
  },
  {
    k: 'IME и composition',
    d: 'IME — метод ввода, который собирает символ из нескольких нажатий: японская кана, китайский пиньинь, корейский хангыль. Пока слово собирается, поле в состоянии composition: текст уже виден, но ещё не окончательный.',
  },
  {
    k: 'встроенная проверка (constraint validation)',
    d: 'Проверка формы самим браузером по атрибутам `required`, `pattern`, `type`, `min`, `max`. Результат лежит в `input.validity`, а селекторы `:invalid` и `:user-invalid` подсвечивают поле.',
  },
  {
    k: '`FormData`',
    d: 'Объект с парами «имя — значение», который браузер собирает из полей формы по тем же правилам, что и при обычной отправке. Его отдают в `fetch` или читают через `get` и `getAll`.',
  },
];

export const PLAIN_TWO_COPIES =
  'Как черновик и чистовик. Человек пишет в черновике — это поле в DOM. Фреймворк переписывает каждое слово в чистовик — своё состояние — и иногда правит черновик по чистовику. Пока правка совпадает с написанным, её никто не замечает. Стоит исправить хоть одну букву — и черновик переписывается целиком, а ручка человека оказывается в конце строки.';

export const PREREQ_NOTE =
  'Форма соединяет три вещи, которые на сайте разобраны отдельно: как фреймворк решает, кого перерисовать, и как браузер отправляет события.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'Ре-рендер в React — вызов функции компонента',
    d: '`setState` помечает компонент устаревшим, и React вызывает его функцию заново. Вместе с ним вызываются все дети, если их не обернули в `memo`. Правка DOM после этого — отдельный шаг, и он бывает пустым.',
    href: '/frameworks/react-rerender/#s2',
    hrefLabel: '«Ре-рендеринг в React», раздел «Какое поддерево перерисовалось»',
    tone: 'info',
  },
  {
    t: 'Рендер Vue помнит, что прочитал',
    d: 'Пока функция рендера работает, Vue записывает, какие поля реактивного объекта она прочла. Запись в одно из них перерисует именно этот компонент — а не родителя и не соседей.',
    href: '/frameworks/vue-reactivity/#s2',
    hrefLabel: '«Реактивность Vue», раздел «Живой граф»',
    tone: 'info',
  },
  {
    t: 'Событие, слушатель и действие по умолчанию',
    d: 'Браузер отправляет полю события, слушатели их получают, а потом браузер делает своё: печатает символ, ставит галочку, отправляет форму. Событие из кода (`dispatchEvent`) символ не напечатает.',
    href: '/render/dom-events/#s4',
    hrefLabel: '«События DOM», раздел «Действие по умолчанию»',
    tone: 'info',
  },
];

// ─── Раздел 1. Две копии значения ──────────────────────────────────────────────────────────

/**
 * Сквозной пример — форма заказа: четыре поля и строка-превью. Исполняется тестом в React
 * (happy-dom): `FIELDS` и `track` (счётчик рендеров) тест передаёт снаружи.
 */
export const REACT_LIFT_CODE = `// FIELDS = ['name', 'phone', 'email', 'comment']; track — счётчик рендеров
function Form() {
  track('Form');
  const [form, setForm] = useState({ name: '', phone: '', email: '', comment: '' });
  return (
    <form>
      {FIELDS.map((key) => (
        <Field
          key={key}
          label={key}
          value={form[key]}
          onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        />
      ))}
      <Preview name={form.name} />
    </form>
  );
}

function Field({ label, value, onChange }) {
  track('Field ' + label);
  return (
    <label>
      {label} <input name={label} value={value} onChange={onChange} />
    </label>
  );
}

function Preview({ name }) {
  track('Preview');
  return <p>Заказ на имя {name || '…'}</p>;
}`;

export const CONTROL_STEPS = [
  { k: '1. Браузер', d: 'Человек нажал «к». Браузер сам вставил символ: `input.value` уже `"к"`. Фреймворк ещё ничего не знает.' },
  { k: '2. Событие', d: 'Приходит `input`. React вызывает `onChange`, Vue — слушатель `v-model`. Обработчик читает `e.target.value` и пишет в состояние.' },
  { k: '3. Рендер', d: 'Состояние изменилось — компонент перерисовывается и снова отдаёт полю `value`.' },
  { k: '4. Сверка', d: 'Фреймворк сравнивает новое значение с тем, что в DOM. Совпало — ничего не пишет. Не совпало — пишет `input.value = …`, и браузер переносит каретку в конец.' },
];

export const CONTROL_FACTS = [
  {
    t: '`onChange` в React — это `input`',
    d: 'Обработчик вызывается на каждый символ, а не при уходе из поля, как родное событие `change`. React слушает оба события, но второй вызов с тем же значением отбрасывает: у каждого поля есть «трекер», который помнит последнее увиденное значение.',
  },
  {
    t: 'Поле без `onChange` замерзает',
    d: '`<input value="abcdef">` без обработчика: браузер вставляет символ, а React сразу после события возвращает в DOM значение из пропа. На экране не меняется ничего. В режиме разработки консоль пишет: «You provided a `value` prop to a form field without an `onChange` handler».',
    tone: 'warn' as const,
  },
  {
    t: 'React переписывает атрибут `value`',
    d: 'У контролируемого поля React держит атрибут `value` равным текущему значению: после ввода «XY» в поле «abc» атрибут стал `abcXY`. Поэтому `form.reset()` такое поле не сбрасывает — сбрасывать некуда. Неконтролируемое поле сбрасывается к `abc`. Во Vue так же ведёт себя связка `:value`, а `v-model` атрибут не трогает: директива пишет только свойство.',
    tone: 'warn' as const,
  },
  {
    t: '`undefined` в `value` — это неконтролируемое поле',
    d: '`useState()` без начального значения даёт `value={undefined}`, и React считает поле неконтролируемым. Первый символ превращает его в контролируемое — с ошибкой в консоли: «A component is changing an uncontrolled input to be controlled». Начальное значение формы — пустая строка, а не `undefined`.',
  },
];

export const CONTROL_ROWS = [
  { k: 'React, `value` + `onChange`', who: 'состояние React', write: 'после каждого рендера, если строка в DOM другая', read: 'из состояния' },
  { k: 'React, `defaultValue` + `ref`', who: 'DOM', write: 'один раз, при монтировании', read: '`ref.current.value` или `FormData`' },
  { k: 'Vue, `v-model`', who: 'реактивное состояние', write: 'перед каждым рендером компонента, если строка в DOM другая', read: 'из состояния' },
  { k: 'Vue, `:value` + `@input`', who: 'реактивное состояние', write: 'при рендере, если строка в DOM другая; атрибут `value` — тоже', read: 'из состояния' },
];

// ─── Раздел 2. v-model изнутри ─────────────────────────────────────────────────────────────

export const VMODEL_SFC = `<script setup>
import { ref } from 'vue';
const name = ref('');
</script>

<template>
  <input v-model.trim="name">
</template>`;

/** Вывод `compileScript(…, { inlineTemplate: true })` для `VMODEL_SFC`, без пустых строк. */
export const VMODEL_COMPILED = `return (_ctx, _cache) => {
  return _withDirectives((_openBlock(), _createElementBlock("input", {
    "onUpdate:modelValue": _cache[0] || (_cache[0] = $event => ((name).value = $event))
  }, null, 512 /* NEED_PATCH */)), [
    [
      _vModelText,
      name.value,
      void 0,
      { trim: true }
    ]
  ])
}`;

export const VMODEL_NOTE =
  'Ни `:value`, ни `@input` в выводе нет. Компилятор оставил два куска: проп `onUpdate:modelValue` — функцию, которая пишет в `name`, — и директиву `vModelText` со значением и модификаторами. Слушатели на поле вешает директива, когда элемент создан, а значение в DOM пишет перед каждым рендером. Проп `onUpdate:modelValue` у обычного элемента не становится слушателем: runtime-dom пропускает такие имена и отдаёт функцию директиве.';

export const PLAIN_DIRECTIVE =
  'Директива — как инструкция, приклеенная к прибору: «при включении сделай то-то, перед каждым обновлением проверь это». Компонент не знает, что в ней написано, он только вызывает её в нужные моменты. У `v-model` таких инструкций четыре набора — для текста, флажка, переключателя и списка.';

/** Какую директиву компилятор выбирает для `v-model` по тегу и типу. Сверяется тестом. */
export const VMODEL_ROWS = [
  { tpl: '<input v-model="x">', dir: 'vModelText', ev: '`input`; `compositionstart`/`compositionend`; `change`', value: 'строка из `el.value`' },
  { tpl: '<input v-model.lazy="x">', dir: 'vModelText', ev: '`change` — когда поле отпустили', value: 'строка' },
  { tpl: '<input type="number" v-model="x">', dir: 'vModelText', ev: 'как у текста', value: 'число через `parseFloat`, если получилось' },
  { tpl: '<textarea v-model="x">', dir: 'vModelText', ev: 'как у текста', value: 'строка' },
  { tpl: '<input type="checkbox" v-model="x">', dir: 'vModelCheckbox', ev: '`change`', value: '`true`/`false`, а для массива — добавить или убрать `value`' },
  { tpl: '<input type="radio" v-model="x">', dir: 'vModelRadio', ev: '`change`', value: '`value` выбранного' },
  { tpl: '<select v-model="x">', dir: 'vModelSelect', ev: '`change`', value: 'значение выбранного `<option>`, у `multiple` — массив' },
  { tpl: '<input :type="t" v-model="x">', dir: 'vModelDynamic', ev: 'выбирает одну из четырёх при каждом вызове', value: 'по типу' },
];

/** Шаблоны строк `VMODEL_ROWS`, которые тест компилирует (`textarea` и `select` — с закрытием). */
export const VMODEL_ROW_TEMPLATES: Record<string, string> = {
  '<textarea v-model="x">': '<textarea v-model="x"></textarea>',
  '<select v-model="x">': '<select v-model="x"><option>a</option></select>',
};

/** `v-model` на компоненте: компилятор раскрывает его в проп и событие. Вывод `compile`. */
export const VMODEL_COMPONENT = `// <Field v-model.trim="name" />
_createBlock(_component_Field, {
  modelValue: _ctx.name,
  "onUpdate:modelValue": $event => ((_ctx.name) = $event),
  modelModifiers: { trim: true }
}, null, 8 /* PROPS */, ["modelValue", "onUpdate:modelValue"])`;

export const VMODEL_COMPONENT_NOTE =
  'На компоненте `v-model` — действительно проп и событие: `modelValue` и `update:modelValue`. Модификаторы приезжают отдельным пропом `modelModifiers`, и применять их компонент обязан сам: `.trim` на `<Field>` ничего не обрежет, пока `Field` не прочитает этот проп.';

/**
 * Мини-`v-model`. Повторяет директивы `vModelText`, `vModelCheckbox`, `vModelRadio`
 * и `vModelSelect` из `@vue/runtime-dom` 3.5.42 — без рендера и реактивности.
 * Тест сверяет его с настоящими директивами; демо вешает его на живое поле.
 */
export const MODEL_CODE = `// model — { get(), set(value) }; mods — { lazy, trim, number }.
// Возвращает update(): её зовут после каждого рендера — «модель → DOM».
function bindModel(el, model, mods = {}) {
  if (el.tagName === 'SELECT') return bindSelect(el, model, mods);
  if (el.type === 'checkbox') return bindCheckbox(el, model);
  if (el.type === 'radio') return bindRadio(el, model);
  return bindText(el, model, mods);
}

function toNumber(value) {
  const n = parseFloat(value);
  return isNaN(n) ? value : n;          // «12abc» → 12, «abc» остаётся строкой
}

function bindText(el, model, { lazy, trim, number }) {
  const asNumber = number || el.type === 'number';
  const cast = (v) => {
    if (trim) v = v.trim();
    return asNumber ? toNumber(v) : v;
  };
  let composing = false;

  // DOM → модель: на каждый input (с .lazy — на change), но не посреди набора IME.
  el.addEventListener(lazy ? 'change' : 'input', () => {
    if (!composing) model.set(cast(el.value));
  });
  // .trim и .number правят и текст в самом поле — только когда поле отпустили.
  if (trim || asNumber) {
    el.addEventListener('change', () => { el.value = cast(el.value); });
  }
  if (!lazy) {
    const end = () => {
      if (!composing) return;
      composing = false;
      el.dispatchEvent(new Event('input'));  // слово набрано — один input за всё
    };
    el.addEventListener('compositionstart', () => { composing = true; });
    el.addEventListener('compositionend', end);
    el.addEventListener('change', end);
  }

  // Модель → DOM: писать в el.value, только если там другое.
  let last = model.get();
  function update() {
    const raw = model.get();
    const value = raw ?? '';
    const old = last;
    last = raw;
    if (composing) return;
    const current = asNumber && !/^0\\d/.test(el.value) ? toNumber(el.value) : el.value;
    if (current === value) return;
    if (el.ownerDocument.activeElement === el) {
      if (lazy && raw === old) return;
      if (trim && el.value.trim() === value) return;
    }
    el.value = value;                        // ← эта запись и уносит каретку в конец
  }
  el.value = model.get() ?? '';
  return update;
}

// Vue умеет ещё Set, true-value/false-value и сравнивает «мягко»: 1 и '1' для него
// равны. Здесь — только булево значение и массив строк.
function bindCheckbox(el, model) {
  el.addEventListener('change', () => {
    const value = model.get();
    if (!Array.isArray(value)) return model.set(el.checked);
    const i = value.indexOf(el.value);
    if (el.checked && i === -1) model.set(value.concat(el.value));
    else if (!el.checked && i !== -1) model.set(value.filter((_, j) => j !== i));
  });
  function update() {
    const value = model.get();
    el.checked = Array.isArray(value) ? value.includes(el.value) : value === true;
  }
  update();
  return update;
}

function bindRadio(el, model) {
  el.addEventListener('change', () => model.set(el.value));
  function update() { el.checked = model.get() === el.value; }
  update();
  return update;
}

function bindSelect(el, model, { number }) {
  el.addEventListener('change', () => {
    const picked = [...el.options].filter((o) => o.selected)
      .map((o) => (number ? toNumber(o.value) : o.value));
    model.set(el.multiple ? picked : picked[0]);
  });
  function update() {
    const value = model.get();
    if (el.multiple) {
      for (const o of el.options) o.selected = value.some((v) => String(v) === o.value);
    } else {
      el.selectedIndex = [...el.options].findIndex((o) => String(value) === o.value);
    }
  }
  update();
  return update;
}`;

export const MODEL_NOTE =
  'Самое важное — в `update`. Директива пишет в `el.value`, только если там **другая** строка. Пока человек печатает без преобразований, строки совпадают, и DOM никто не трогает. Ещё две поблажки работают, пока поле в фокусе: с `.trim` пробел в конце не стирается на лету, а с `.number` «1.» не превращается в «1» — иначе точку было бы не напечатать.';

export const MODIFIER_ROWS = [
  { k: '`.lazy`', d: 'Слушает `change` вместо `input`: модель меняется, когда поле отпустили или нажали Enter. Защиты от IME нет — она и не нужна, `change` посреди набора не приходит.' },
  { k: '`.trim`', d: 'В модель идёт строка без пробелов по краям. В самом поле пробелы остаются, пока оно в фокусе, и пропадают на `change`.' },
  { k: '`.number`', d: '`parseFloat` от строки. Не получилось — в модель уходит строка как есть: `"abc"` останется `"abc"`, а `"12abc"` станет `12`. `type="number"` включает то же самое без модификатора.' },
];

export const PLAIN_CAST =
  '`.number` — не валидатор, а переводчик, который переводит, что смог. «12 яблок» он прочитает как 12 и промолчит про яблоки, а «яблоки» вернёт как есть — строкой. Проверить, что пришло число, — по-прежнему ваша работа: `typeof value === \'number\'`.';

export const MODEL_DEMO_CAPTION =
  'Поле связано с моделью строкой `bindModel` с этой страницы. С сеттером «в верхний регистр» символ, напечатанный в середине слова, уносит каретку в конец: сеттер поменял строку, и `update` записал её в поле. С фильтром «только цифры» буква остаётся в поле: значение модели не изменилось, рендера нет, `update` не вызывался. Набор «日本» через IME — те же события, что Chromium прислал на стенде, — даёт пять `input` с `isComposing` и одну запись в модель.';

/** Начальные значения и преобразования демо: что делает «сеттер» модели. */
export const MODEL_DEMO_SETTERS = [
  { id: 'none', label: 'как есть', initial: 'привет' },
  { id: 'upper', label: 'в верхний регистр', initial: 'ПРИВЕТ' },
  { id: 'digits', label: 'только цифры', initial: '2026' },
];

/** Набор через IME, как его отправил Chromium (`IME_TRACE`): промежуточные строки и итог. */
export const MODEL_DEMO_IME = { steps: ['n', 'に', 'にほ', 'にほん'], commit: '日本' };

// ─── Раздел 3. Цена нажатия ────────────────────────────────────────────────────────────────

export const FIELDS = ['name', 'phone', 'email', 'comment'];

/**
 * Учебная модель «кто перерисуется». Тест сверяет её с React 19.3 и Vue 3.5.42 на всех
 * вариантах `RENDER_SETUPS` и каждом поле. Демо считает ею счётчики.
 */
export const RENDER_CODE = `// Узел дерева: { name, owns, reads, memo, props, children }.
// owns — ключи состояния, которые компонент держит сам (useState);
// reads — ключи, которые читает его рендер (так видит Vue);
// props — откуда берётся каждый проп: ключ состояния, 'new-fn' (новая функция
// на каждый рендер родителя) или 'same' (одна и та же: useCallback, кеш Vue).
function whoRenders(framework, node, key, parentRendered = false, propsChanged = false, out = []) {
  const renders = framework === 'react'
    // React: свой setState или рендер родителя. memo пропускает, если пропы те же.
    ? node.owns.includes(key) || (parentRendered && !(node.memo && !propsChanged))
    // Vue: прочитал изменённое или родитель передал другие пропы.
    : node.reads.includes(key) || (parentRendered && propsChanged);
  if (renders) out.push(node.name);
  for (const child of node.children) {
    const changed = Object.values(child.props)
      .some((from) => from === key || from === 'new-fn');
    whoRenders(framework, child, key, renders, changed, out);
  }
  return out;
}

// Форма из спецификации: Form → Field на каждый ключ (+ Preview).
// '*' — все ключи формы, '$key' — ключ своего поля.
function buildTree(spec, fields) {
  const expand = (list = [], key) =>
    list.flatMap((x) => (x === '*' ? fields : x === '$key' ? [key] : [x]));
  const node = (name, part, key) => ({
    name,
    owns: expand(part.owns, key),
    reads: expand(part.reads, key),
    memo: !!part.memo,
    props: Object.fromEntries(Object.entries(part.props ?? {})
      .map(([p, from]) => [p, from === '$key' ? key : from])),
    children: [],
  });
  const root = node('Form', spec.form);
  for (const key of fields) root.children.push(node('Field ' + key, spec.field, key));
  if (spec.preview) root.children.push(node('Preview', spec.preview));
  return root;
}`;

export const REACT_MEMO_CODE = `function Form() {
  track('Form');
  const [form, setForm] = useState({ name: '', phone: '', email: '', comment: '' });
  // Одна функция на все поля и все рендеры: setForm с колбэком не читает form.
  const onField = useCallback((key, value) => setForm((f) => ({ ...f, [key]: value })), []);
  return (
    <form>
      {FIELDS.map((key) => (
        <Field key={key} label={key} value={form[key]} onField={onField} />
      ))}
      <Preview name={form.name} />
    </form>
  );
}

const Field = memo(function Field({ label, value, onField }) {
  track('Field ' + label);
  return (
    <label>
      {label} <input name={label} value={value} onChange={(e) => onField(label, e.target.value)} />
    </label>
  );
});

function Preview({ name }) {
  track('Preview');
  return <p>Заказ на имя {name || '…'}</p>;
}`;

export const REACT_LOCAL_CODE = `function Form() {
  track('Form');
  return <form>{FIELDS.map((key) => <Field key={key} label={key} />)}</form>;
}

function Field({ label }) {
  track('Field ' + label);
  const [value, setValue] = useState('');
  return (
    <label>
      {label} <input name={label} value={value} onChange={(e) => setValue(e.target.value)} />
    </label>
  );
}`;

export const REACT_DOM_CODE = `function Form() {
  track('Form');
  const onSubmit = (e) => {
    e.preventDefault();
    send(Object.fromEntries(new FormData(e.currentTarget)));  // значения — из DOM
  };
  return <form onSubmit={onSubmit}>{FIELDS.map((key) => <Field key={key} label={key} />)}</form>;
}

function Field({ label }) {
  track('Field ' + label);
  return (
    <label>
      {label} <input name={label} defaultValue="" />
    </label>
  );
}`;

export const VUE_PROPS_CODE = `const Field = {
  props: ['label', 'modelValue'],
  emits: ['update:modelValue'],
  setup(props) {
    onBeforeUpdate(() => track('Field ' + props.label));
  },
  template: \`
    <label>{{ label }}
      <input :name="label" :value="modelValue"
        @input="$emit('update:modelValue', $event.target.value)">
    </label>\`,
};

const Preview = {
  props: ['name'],
  setup() {
    onBeforeUpdate(() => track('Preview'));
  },
  template: \`<p>Заказ на имя {{ name || '…' }}</p>\`,
};

const Form = {
  components: { Field, Preview },
  setup() {
    onBeforeUpdate(() => track('Form'));
    const form = reactive({ name: '', phone: '', email: '', comment: '' });
    return { form, FIELDS };
  },
  template: \`
    <form>
      <Field v-for="key in FIELDS" :key="key" :label="key" v-model="form[key]" />
      <Preview :name="form.name" />
    </form>\`,
};`;

export const VUE_STORE_CODE = `// Состояние формы — общий reactive вне компонентов, как стор Pinia.
const form = reactive({ name: '', phone: '', email: '', comment: '' });

const Field = {
  props: ['label'],
  setup(props) {
    onBeforeUpdate(() => track('Field ' + props.label));
    return { form };
  },
  template: \`<label>{{ label }} <input :name="label" v-model="form[label]"></label>\`,
};

const Preview = {
  setup() {
    onBeforeUpdate(() => track('Preview'));
    return { form };
  },
  template: \`<p>Заказ на имя {{ form.name || '…' }}</p>\`,
};

const Form = {
  components: { Field, Preview },
  setup() {
    onBeforeUpdate(() => track('Form'));
    return { FIELDS };
  },
  template: \`<form><Field v-for="key in FIELDS" :key="key" :label="key" /><Preview /></form>\`,
};`;

/**
 * Варианты устройства состояния. `code` — то, что видит читатель и что тест монтирует;
 * `form`/`field`/`preview` — то же дерево словами `RENDER_CODE`.
 */
export const RENDER_SETUPS: RenderSetup[] = [
  {
    id: 'react-lift',
    framework: 'react',
    label: 'состояние в форме',
    code: REACT_LIFT_CODE,
    note: 'Всё состояние в `Form`. Символ в любом поле вызывает `setForm`, и React зовёт `Form` и всех её детей: пропы не сравниваются, пока ребёнок не обёрнут в `memo`.',
    form: { owns: ['*'] },
    field: { props: { value: '$key', onChange: 'new-fn' } },
    preview: { props: { name: 'name' } },
  },
  {
    id: 'react-memo',
    framework: 'react',
    label: 'memo + useCallback',
    code: REACT_MEMO_CODE,
    note: '`memo` сравнивает пропы каждого поля. У трёх полей из четырёх `value` прежний, а `onField` — одна и та же функция, поэтому они пропускаются. `Preview` без `memo` вызывается всегда.',
    form: { owns: ['*'] },
    field: { memo: true, props: { value: '$key', onField: 'same' } },
    preview: { props: { name: 'name' } },
  },
  {
    id: 'react-local',
    framework: 'react',
    label: 'состояние в поле',
    code: REACT_LOCAL_CODE,
    note: 'Каждое поле держит своё значение. Перерисовывается одно поле, но превью показать нечего: `Form` не знает, что набрано.',
    form: {},
    field: { owns: ['$key'] },
    preview: null,
  },
  {
    id: 'react-dom',
    framework: 'react',
    label: 'значение в DOM',
    code: REACT_DOM_CODE,
    note: 'Неконтролируемые поля: React не держит значений вовсе. Ввод не меняет ни одного состояния, рендеров ноль. Значения собирает `FormData` при отправке. Так устроен react-hook-form.',
    form: {},
    field: {},
    preview: null,
  },
  {
    id: 'vue-props',
    framework: 'vue',
    label: 'v-model на компоненте',
    code: VUE_PROPS_CODE,
    note: '`Form` читает все поля, чтобы раздать их пропами, поэтому перерисовывается на каждый символ. Из детей — только те, чей проп изменился: Vue сравнивает пропы сам, `memo` не нужен.',
    form: { reads: ['*'] },
    field: { props: { modelValue: '$key', 'onUpdate:modelValue': 'same' } },
    preview: { props: { name: 'name' } },
  },
  {
    id: 'vue-store',
    framework: 'vue',
    label: 'общий reactive',
    code: VUE_STORE_CODE,
    note: 'Значение читает само поле, а `Form` не читает ничего. Символ будит только поле, в которое печатают, и `Preview` — если оно читает этот ключ.',
    form: {},
    field: { reads: ['$key'], props: { label: 'const' } },
    preview: { reads: ['name'] },
  },
];

/**
 * Тот же `VUE_PROPS_CODE`, но у `Field` нет `emits`. Обработчик `onUpdate:modelValue`
 * из `v-for` — новая функция на каждый рендер `Form`, и без `emits` Vue считает его
 * обычным пропом. Тест монтирует и это и сверяет с моделью.
 */
export const VUE_NO_EMITS_SPEC = {
  form: { reads: ['*'] },
  field: { props: { modelValue: '$key', 'onUpdate:modelValue': 'new-fn' } },
  preview: { props: { name: 'name' } },
};

/** Сколько компонентов перерисовано одним символом. Пересчитывается тестом на React и Vue. */
export const RENDER_TABLE = [
  { id: 'react-lift', k: 'React: состояние в форме', name: 6, phone: 6, n20: 22 },
  { id: 'react-memo', k: 'React: `memo` + `useCallback`', name: 3, phone: 3, n20: 3 },
  { id: 'react-local', k: 'React: состояние в поле', name: 1, phone: 1, n20: 1 },
  { id: 'react-dom', k: 'React: значение в DOM', name: 0, phone: 0, n20: 0 },
  { id: 'vue-props', k: 'Vue: `v-model` на компоненте', name: 3, phone: 2, n20: 2 },
  { id: 'vue-store', k: 'Vue: общий `reactive`', name: 2, phone: 1, n20: 1 },
];

export const RENDER_DEMO_CAPTION =
  'Счётчики считает `whoRenders` с этой страницы по дереву выбранного варианта. «Состояние в форме» на двадцати полях стоит 22 рендера на символ — цена растёт вместе с формой. Vue с `v-model` на компоненте платит два-три рендера при любом числе полей: форма, поле и превью, если оно читает это поле.';

/** Chromium: записи `MutationObserver` за один символ в поле `name` варианта «состояние в форме». */
export const RENDER_DOM = [
  'name name', 'value name', 'name name',
  'name phone', 'name phone', 'name email', 'name email', 'name comment', 'name comment',
  'characterData',
  'name name', 'name name',
];

/** То же для `VUE_PROPS_CODE`. */
export const RENDER_DOM_VUE = ['value name', 'childList'];

export const RENDER_NOTE =
  'Рендер — это вызов функции компонента и сравнение его вывода, а не перерисовка экрана. Правок DOM после него немного, но они есть. На один символ в варианте «состояние в форме» Chromium записал двенадцать изменений. Десять из них — атрибут `name`: React стирает и возвращает его у каждого перерисованного поля, чтобы на время обновления отцепить поле от группы переключателей. Ещё одно — атрибут `value` у набранного поля, последнее — текст превью. Vue в варианте «`v-model` на компоненте» сделал две правки: атрибут `value` и текст превью. Дорого становится, когда полей сотни или каждое поле само по себе тяжёлое: маска, подсказки, проверка на каждый символ.';

export const RHF_NOTE =
  'react-hook-form построен на варианте «значение в DOM». `register(\'name\')` возвращает `name`, `ref`, `onChange` и `onBlur`: через `ref` библиотека читает значение из самого поля, а слушатели обновляют её внутренний стор без `setState`. Рендер случается, только когда кто-то подписался: `watch` перерисует весь компонент с `useForm`, `useWatch` — только компонент, который его вызвал. Пакета в проекте нет — это по документации, счётчики выше его не проверяли.';

// ─── Раздел 4. Прыгающая каретка ───────────────────────────────────────────────────────────

/**
 * Chromium, клавиатура Playwright: каретку ставят на позицию `pos`, печатают один символ `typed`.
 * `value` и `caret` — сразу после символа (каретка — `selectionStart`). Пересобирается тестом.
 */
export const CARET_ROWS = [
  { id: 'react-plain', k: 'React: `setValue(e.target.value)`', start: 'abcdef', typed: 'x', value: 'abxcdef', caret: 3, tone: 'ok' as const },
  { id: 'react-upper', k: 'React: `setValue(v.toUpperCase())`', start: 'ABCDEF', typed: 'x', value: 'ABXCDEF', caret: 7, tone: 'err' as const },
  { id: 'react-digits', k: 'React: `setValue(v.replace(/\\D/g, \'\'))`', start: '123456', typed: 'a', value: '123456', caret: 6, tone: 'err' as const },
  { id: 'react-async', k: 'React: `setValue` в `setTimeout`', start: 'abcdef', typed: 'x', value: 'abxcdef', caret: 7, tone: 'err' as const },
  { id: 'react-unc', k: 'React: `defaultValue`, без состояния', start: 'abcdef', typed: 'x', value: 'abxcdef', caret: 3, tone: 'ok' as const },
  { id: 'react-fix', k: 'React: верхний регистр + `useLayoutEffect`', start: 'ABCDEF', typed: 'x', value: 'ABXCDEF', caret: 3, tone: 'ok' as const },
  { id: 'vue-plain', k: 'Vue: `v-model`', start: 'abcdef', typed: 'x', value: 'abxcdef', caret: 3, tone: 'ok' as const },
  { id: 'vue-upper', k: 'Vue: `v-model` + сеттер `toUpperCase`', start: 'ABCDEF', typed: 'x', value: 'ABXCDEF', caret: 7, tone: 'err' as const },
  { id: 'vue-digits', k: 'Vue: `v-model` + сеттер-фильтр цифр', start: '123456', typed: 'a', value: '12a3456', caret: 3, tone: 'err' as const },
  { id: 'vue-fix', k: 'Vue: верхний регистр + `nextTick`', start: 'ABCDEF', typed: 'x', value: 'ABXCDEF', caret: 3, tone: 'ok' as const },
];

/** Позиция, куда ставят каретку перед вводом в `CARET_ROWS`. */
export const CARET_POS = 2;

export const CARET_WHY =
  'Браузер не знает, что новая строка — это старая плюс одна буква. Запись в `input.value` для него — замена всего текста, и по спецификации HTML каретка после замены встаёт в конец. Запись той же строки ничего не двигает: React и Vue её и не делают. Поэтому каретка цела, пока состояние повторяет DOM, и прыгает, как только код вернул в поле что-то своё.';

export const CARET_ASYNC_NOTE =
  'Асинхронный вариант прыгает без всякого преобразования. Сразу после события React возвращает полю старое значение из состояния — состояние ещё не обновилось. Через задачу приходит новое, и это уже вторая запись другой строки. Отсюда правило: значение контролируемого поля обновляют синхронно, в самом обработчике, а запрос на сервер — отдельно.';

export const REACT_CARET_FIX_CODE = `function UpperInput() {
  const [value, setValue] = useState('ABCDEF');
  const ref = useRef(null);
  const caret = useRef(null);

  // React уже записал новую строку в DOM — вернуть каретку на место.
  useLayoutEffect(() => {
    if (caret.current === null) return;
    ref.current.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  });

  return (
    <input
      ref={ref}
      value={value}
      onChange={(e) => {
        caret.current = e.target.selectionStart;   // где каретка после ввода
        setValue(e.target.value.toUpperCase());
      }}
    />
  );
}`;

/** Тело `setup()` компонента с шаблоном `<input ref="input" v-model="upper">`. */
export const VUE_CARET_FIX_CODE = `// <input ref="input" v-model="upper">
const raw = ref('ABCDEF');
const input = ref(null);
const upper = computed({
  get: () => raw.value,
  set(v) {
    const caret = input.value.selectionStart;
    raw.value = v.toUpperCase();
    nextTick(() => input.value.setSelectionRange(caret, caret));
  },
});`;

export const CARET_FIX_NOTE =
  'Приём один: запомнить `selectionStart` в обработчике и вернуть его после записи в DOM. В React «после записи» — это `useLayoutEffect`: он выполняется до того, как браузер нарисует кадр. Во Vue — `nextTick`. Работает, пока преобразование не меняет длину текста перед кареткой. Маска телефона, которая вставляет скобки и дефисы, обязана пересчитать позицию сама — поэтому маски обычно берут из библиотеки.';

export const DIGITS_NOTE =
  'Фильтр через сеттер во Vue ломается иначе. Человек напечатал «a» — сеттер выкинул её, и в `raw` записалось то же `"123456"`. Значение не изменилось, компонент не перерисовался, директива не вызвалась — и буква осталась в поле, хотя в модели её нет. Следующая цифра изменит модель, рендер случится, и буква исчезнет вместе с кареткой. Лечение — писать в поле напрямую (`e.target.value = …`) или фильтровать ещё в `beforeinput`.';

// ─── Раздел 5. IME ─────────────────────────────────────────────────────────────────────────

/**
 * Chromium, поле без фреймворка: набор «にほん» → «日本» через CDP `Input.imeSetComposition`
 * (шаги `n`, `に`, `にほ`, `にほん`) и `Input.insertText('日本')`. Строка — событие, `data`,
 * `isComposing`, `value` в момент события. Пересобирается тестом.
 */
export const IME_TRACE = [
  { ev: 'compositionstart', data: '""', composing: '—', value: '""' },
  { ev: 'compositionupdate', data: '"n"', composing: '—', value: '""' },
  { ev: 'beforeinput', data: '"n"', composing: 'true', value: '""' },
  { ev: 'input', data: '"n"', composing: 'true', value: '"n"' },
  { ev: 'compositionupdate', data: '"に"', composing: '—', value: '"n"' },
  { ev: 'beforeinput', data: '"に"', composing: 'true', value: '"n"' },
  { ev: 'input', data: '"に"', composing: 'true', value: '"に"' },
  { ev: '… ещё два шага: «にほ» и «にほん»', data: '', composing: '', value: '' },
  { ev: 'compositionupdate', data: '"日本"', composing: '—', value: '"にほん"' },
  { ev: 'beforeinput', data: '"日本"', composing: 'true', value: '"にほん"' },
  { ev: 'input', data: '"日本"', composing: 'true', value: '"日本"' },
  { ev: 'compositionend', data: '"日本"', composing: '—', value: '"日本"' },
];

/** Тот же набор в контролируемом поле React и в `v-model`: сколько раз изменилось состояние. */
export const IME_COUNTS = { reactOnChange: 5, reactComposing: 5, vueModelSets: 1, vueOwnInput: 6 };

/** Набор «kan» → «かん» в конец поля `ABCDEF` с преобразованием в верхний регистр. */
export const IME_UPPER = {
  react: 'ABCDEFKKAKANかん',
  vue: 'ABCDEFかん',
  plain: 'かん',
};

export const IME_NOTE =
  'В React контролируемое поле получило пять `onChange`, и у каждого `e.nativeEvent.isComposing` — `true`: React зовёт обработчик на каждый `input`, недописанное слово тоже. Пока обработчик пишет в состояние строку как есть, вреда нет — она совпадает с DOM. С преобразованием React записывает в поле посреди набора «K» вместо «k», метод ввода теряет своё слово и начинает новое. На стенде вместо «かん» получилось «KKAKANかん». `v-model` ждёт `compositionend` и меняет модель один раз.';

export const IME_GUARD_CODE = `// Свой обработчик: пропустить недописанное слово.
input.addEventListener('input', (e) => {
  if (e.isComposing) return;               // дождёмся compositionend
  apply(e.target.value);
});
input.addEventListener('compositionend', (e) => apply(e.target.value));

// Enter, которым подтверждают слово в IME, — не отправка формы.
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.isComposing) submit();
});`;

export const IME_GUARD_NOTE =
  'В React нет флага «пропускать набор» — его пишут сами: проверка `e.nativeEvent.isComposing` в `onChange` и применение значения в `onCompositionEnd`. Порядок последнего `input` и `compositionend` в браузерах разный — в Chromium `input` приходит раньше, — поэтому значение применяют в обоих местах. Вторая частая ошибка — Enter: им подтверждают слово, и `keydown` с `isComposing: true` не должен отправлять форму.';

export const PLAIN_IME =
  'Как надиктовывать слово по буквам секретарю, который пишет его карандашом и стирает, пока не услышит «точка». Пока слово не закончено, на бумаге черновые буквы. Если в этот момент кто-то перепишет их ручкой, секретарь потеряет нить — и допишет сверху новое слово.';

// ─── Раздел 6. Валидация ───────────────────────────────────────────────────────────────────

/** Разметка формы, на которой сняты `VALID_STEPS` (Chromium). */
export const VALID_HTML = `<form id="order">
  <input id="req" name="req" required>
  <input id="pat" name="pat" pattern="[0-9]{3}" value="12">
  <input id="mail" name="mail" type="email">
  <input id="num" name="num" type="number" min="1" max="10">
  <button>Отправить</button>
</form>`;

/** Chromium: что показывают `validity`, `:invalid` и `:user-invalid` по ходу. Пересобирается тестом. */
export const VALID_STEPS = [
  { id: 'load', k: 'страница загрузилась, `req` пустое', field: 'req', flags: 'valueMissing', invalid: true, user: false },
  { id: 'load-pat', k: 'то же, `pat` со значением `12` из разметки', field: 'pat', flags: 'patternMismatch', invalid: true, user: false },
  { id: 'check', k: '`form.checkValidity()` — `false`, `invalid` на `req` и `pat`', field: 'req', flags: 'valueMissing', invalid: true, user: false },
  { id: 'typed', k: 'в `req` набрали «a»', field: 'req', flags: '', invalid: false, user: false },
  { id: 'cleared', k: 'стёрли, фокус ещё в поле', field: 'req', flags: 'valueMissing', invalid: true, user: false },
  { id: 'blurred', k: 'ушли из поля', field: 'req', flags: 'valueMissing', invalid: true, user: true },
  { id: 'mail-focus', k: 'в `mail` набрали «ivan», фокус в поле', field: 'mail', flags: 'typeMismatch', invalid: true, user: false },
  { id: 'mail-blur', k: 'ушли из `mail`', field: 'mail', flags: 'typeMismatch', invalid: true, user: true },
  { id: 'num-bad', k: 'в `num` набрали «1e»: `value` — пустая строка', field: 'num', flags: 'badInput', invalid: true, user: false },
  { id: 'submit', k: 'кнопка отправки: `invalid` на всех четырёх, `submit` нет', field: 'pat', flags: 'patternMismatch', invalid: true, user: true },
];

export const VALID_FACTS = [
  {
    t: '`:invalid` горит с загрузки',
    d: 'Пустое обязательное поле невалидно ещё до того, как человек его увидел. Красная рамка по `:invalid` встречает его ошибкой, которой он не совершал. `:user-invalid` срабатывает, только когда человек поменял значение и ушёл из поля — или попытался отправить форму.',
  },
  {
    t: '`checkValidity` молчит, `reportValidity` и отправка — нет',
    d: '`checkValidity()` возвращает `true`/`false` и шлёт `invalid` невалидным полям, но ничего не показывает и `:user-invalid` не включает. `reportValidity()`, кнопка отправки и `requestSubmit()` показывают подсказку и ставят фокус в первое плохое поле. `submit` при этом не приходит.',
  },
  {
    t: '`setCustomValidity` держит ошибку',
    d: '`setCustomValidity(\'Имя занято\')` делает поле невалидным с флагом `customError` — и оно остаётся невалидным после смены значения, пока не вызвать `setCustomValidity(\'\')`. Свою проверку поэтому сбрасывают первой строкой обработчика `input`.',
    tone: 'warn' as const,
  },
  {
    t: '`novalidate` выключает только проверку перед отправкой',
    d: 'С `novalidate` на форме `submit` приходит даже с пустым `required`. `validity`, `checkValidity()` и `:invalid` работают как прежде — их можно звать из своего кода.',
  },
];

export const OWN_VALIDATE_CODE = `// Своя проверка поверх встроенной: правило — своё, показ — браузерный.
function validateConfirm(password, confirm) {
  confirm.setCustomValidity('');                     // сначала снять старую ошибку
  if (confirm.value && confirm.value !== password.value) {
    confirm.setCustomValidity('Пароли не совпадают');
  }
  return confirm.validity.valid;
}`;

export const VALID_CHOICE = [
  { k: 'Встроенная', d: 'Правила — атрибутами, состояние — в `validity`, подсветка — `:user-invalid`. Работает без JS и с любым фреймворком. Подсказку рисует браузер, на его языке и в его стиле; поменять можно только текст — через `setCustomValidity`.' },
  { k: 'Своя', d: 'Правила — функцией или схемой, ошибки — в состоянии формы, показ — свой. Нужна для правил, которые зависят от нескольких полей или от сервера. Вопрос «когда показывать» придётся решать самим — и правильный ответ тот же, что у `:user-invalid`: после того как поле тронули и отпустили, или после попытки отправки.' },
];

// ─── Раздел 7. Отправка ────────────────────────────────────────────────────────────────────

export const FORMDATA_HTML = `<form>
  <input name="title" value="Кофе">
  <input name="note" value="x" disabled>
  <input type="checkbox" name="gift">
  <input type="checkbox" name="wrap" checked>
  <input type="checkbox" name="tag" value="a" checked>
  <input type="checkbox" name="tag" value="b" checked>
  <input type="radio" name="size" value="s">
  <input type="radio" name="size" value="m" checked>
  <select name="city" multiple>
    <option selected>Москва</option><option selected>Казань</option><option>Омск</option>
  </select>
  <input type="number" name="qty" value="2">
  <input value="без имени">
  <button name="act" value="buy">Купить</button>
  <button name="act" value="save">Сохранить</button>
</form>`;

/** Chromium: `[...new FormData(form)]` для `FORMDATA_HTML`. Пересобирается тестом. */
export const FORMDATA_ENTRIES: [string, string][] = [
  ['title', 'Кофе'],
  ['wrap', 'on'],
  ['tag', 'a'],
  ['tag', 'b'],
  ['size', 'm'],
  ['city', 'Москва'],
  ['city', 'Казань'],
  ['qty', '2'],
];

/** Те же пары, напечатанные столбиком. */
export const FORMDATA_PRINT = FORMDATA_ENTRIES.map(([k, v]) => k.padEnd(7) + v).join('\n');

export const FORMDATA_ROWS = [
  { k: 'поле с `disabled`', what: 'не попадает', tone: 'warn' as const },
  { k: 'поле без `name`', what: 'не попадает', tone: 'warn' as const },
  { k: 'флажок без галочки', what: 'не попадает — ключа нет вовсе, `get` вернёт `null`', tone: 'warn' as const },
  { k: 'флажок без `value`', what: '`"on"`', tone: 'info' as const },
  { k: 'два флажка с одним `name`, `<select multiple>`', what: 'две записи с одним ключом; `getAll` вернёт обе', tone: 'info' as const },
  { k: '`type="number"`', what: 'строка `"2"`, не число', tone: 'warn' as const },
  { k: 'кнопки отправки', what: 'нет, пока кнопку не передать вторым аргументом: `new FormData(form, button)` или при отправке', tone: 'info' as const },
  { k: '`Object.fromEntries(formData)`', what: 'из повторяющихся ключей остаётся последний: `tag: "b"`, `city: "Казань"`', tone: 'err' as const },
];

export const ACTION_CODE = `async function saveOrder(prev, formData) {
  const title = formData.get('title');
  await save(title);                            // запрос на сервер
  return { saved: title, count: prev.count + 1 };
}

function SubmitButton() {
  const { pending } = useFormStatus();          // статус ближайшей формы-родителя
  return <button disabled={pending}>{pending ? 'Сохраняю…' : 'Сохранить'}</button>;
}

function OrderForm() {
  const [state, formAction] = useActionState(saveOrder, { saved: null, count: 0 });
  const [comment, setComment] = useState('');
  return (
    <form action={formAction}>
      <input name="title" defaultValue="Кофе" />
      <input name="comment" value={comment} onChange={(e) => setComment(e.target.value)} />
      <SubmitButton />
      {state.saved && <p>Сохранено: {state.saved}, раз: {state.count}</p>}
    </form>
  );
}`;

/** Chromium: `ACTION_CODE` по шагам. Пересобирается тестом. */
export const ACTION_STEPS = [
  { k: 'набрали «Латте» и «без сахара»', title: 'Латте', comment: 'без сахара', button: 'Сохранить', text: '' },
  { k: 'нажали кнопку, `save` ещё думает', title: 'Латте', comment: 'без сахара', button: 'Сохраняю…', text: '' },
  { k: '`save` ответил', title: 'Кофе', comment: 'без сахара', button: 'Сохранить', text: 'Сохранено: Латте, раз: 1' },
];

export const ACTION_FACTS = [
  {
    t: 'Функция в `action` вместо адреса',
    d: 'React перехватывает отправку сам: `preventDefault` писать не нужно, адрес страницы не меняется. Функция получает `FormData` формы — значения неконтролируемых полей приходят без единого `useState`.',
  },
  {
    t: '`useFormStatus` — без пропов',
    d: 'Кнопка узнаёт о `pending` у ближайшей формы-родителя через контекст, который React ставит сам. Вызванный в том же компоненте, где `<form>`, хук формы не видит: он смотрит только вверх по дереву.',
  },
  {
    t: 'После действия форма сбрасывается',
    d: 'Когда действие закончилось, React зовёт для формы `reset()`. Неконтролируемое «Латте» вернулось к `defaultValue` «Кофе». Контролируемое поле осталось как было: его значение — состояние React, а не DOM. Если действие вернуло ошибки проверки, набранное всё равно стёрто — поэтому значения возвращают в состоянии и подставляют в `defaultValue`.',
    tone: 'warn' as const,
  },
];

// ─── Тонкие места, источники ───────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'Любое преобразование в `onChange` уносит каретку в конец',
    d: '`toUpperCase`, обрезка длины, маска — всё, после чего состояние не равно тому, что в поле. React и Vue записывают в `input.value` другую строку, а браузер после такой записи ставит каретку в конец. Чинится запоминанием `selectionStart` и возвратом после записи.',
    tone: 'err',
  },
  {
    n: '02',
    t: 'Фильтр в сеттере `v-model` пропускает запрещённый символ',
    d: 'Сеттер выкинул букву — значение модели не изменилось — рендера нет — директива не перезаписала поле. Буква остаётся на экране до следующего настоящего изменения. Фильтр пишут так, чтобы он правил само поле.',
    tone: 'err',
  },
  {
    n: '03',
    t: 'Асинхронный `setState` в обработчике поля',
    d: '`await` или `setTimeout` между событием и `setValue` — и React успевает вернуть полю старое значение. Новое приходит второй записью, каретка прыгает даже без преобразований.',
    tone: 'err',
  },
  {
    n: '04',
    t: 'React зовёт `onChange` посреди набора IME',
    d: 'Пять вызовов на одно японское слово, все с `isComposing: true`. Безвредно, пока значение пишется в состояние как есть. Преобразование или ограничение длины в этот момент ломают набор.',
    tone: 'warn',
  },
  {
    n: '05',
    t: '`.number` пропускает не-числа',
    d: '`"abc"` уходит в модель строкой, `"12abc"` — числом 12. А `type="number"` с набранным «1e» отдаёт `value === ""` и флаг `badInput`: фреймворк видит пустую строку, а человек — свой текст.',
    tone: 'warn',
  },
  {
    n: '06',
    t: '`FormData` молча теряет поля',
    d: 'Нет `name` — нет поля. `disabled` — нет поля. Флажок без галочки — нет ключа, а не `false`. `Object.fromEntries` оставляет из повторяющихся ключей последний. Числа приходят строками.',
    tone: 'warn',
  },
  {
    n: '07',
    t: '`form.reset()` не сбрасывает контролируемые поля React',
    d: 'React держит атрибут `value` равным текущему значению, и сбрасывать некуда. Сброс такой формы — запись начального состояния через `setState`.',
  },
  {
    n: '08',
    t: 'Действие React 19 стирает неконтролируемые поля',
    d: 'После `<form action={fn}>` форма сбрасывается к `defaultValue` — даже если действие вернуло ошибку. Значения, которые нужно сохранить, возвращают из действия и подставляют в `defaultValue`.',
    tone: 'warn',
  },
  {
    n: '09',
    t: 'Компонент поля без `emits` перерисовывается вместе с формой',
    d: 'Обработчик `v-model` внутри `v-for` — новая функция на каждый рендер. Объявленное в `emits` событие Vue при сравнении пропов пропускает. Не объявленное — считает обычным пропом, и все поля формы перерисовываются на каждый символ.',
    tone: 'warn',
  },
  {
    n: '10',
    t: '`:invalid` вместо `:user-invalid`',
    d: 'Подсветка по `:invalid` встречает пустую форму красными рамками. `:user-invalid` ждёт, пока человек тронет поле или нажмёт «Отправить».',
  },
];

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'Vue — исходник `vModel.ts`',
    href: 'https://github.com/vuejs/core/blob/main/packages/runtime-dom/src/directives/vModel.ts',
    what: '`vModelText`, `vModelCheckbox`, `vModelRadio`, `vModelSelect`: слушатели, `composing`, условия записи в DOM; на стенде — 3.5.42',
  },
  {
    title: 'Vue — Form Input Bindings и Component v-model',
    href: 'https://vuejs.org/guide/essentials/forms.html',
    what: 'модификаторы `.lazy`, `.number`, `.trim`; про IME; `v-model` на компоненте — https://vuejs.org/guide/components/v-model.html',
  },
  {
    title: 'React — `<input>`',
    href: 'https://react.dev/reference/react-dom/components/input',
    what: 'контролируемые и неконтролируемые поля, `value` без `onChange`, асинхронное обновление и каретка',
  },
  {
    title: 'React — исходники `ChangeEventPlugin` и `inputValueTracking`',
    href: 'https://github.com/facebook/react/tree/main/packages/react-dom-bindings/src/events/plugins',
    what: 'какие события становятся `onChange`, трекер значения, возврат контролируемого значения после события',
  },
  {
    title: 'React — `useActionState`, `useFormStatus`, `<form>`',
    href: 'https://react.dev/reference/react/useActionState',
    what: 'действия формы в React 19; `useFormStatus` — https://react.dev/reference/react-dom/hooks/useFormStatus',
  },
  {
    title: 'HTML Standard — Constraint validation',
    href: 'https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#constraints',
    what: '`validity`, `checkValidity`, `reportValidity`, `setCustomValidity`, `novalidate`',
  },
  {
    title: 'HTML Standard — Constructing the entry list',
    href: 'https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#constructing-the-form-data-set',
    what: 'какие поля попадают в `FormData` и при отправке',
  },
  {
    title: 'Selectors Level 4 — `:user-valid` и `:user-invalid`',
    href: 'https://drafts.csswg.org/selectors-4/#user-pseudos',
    what: 'когда поле считается тронутым пользователем',
  },
  {
    title: 'UI Events — Composition Events',
    href: 'https://w3c.github.io/uievents/#events-compositionevents',
    what: '`compositionstart`, `compositionupdate`, `compositionend`, `isComposing`',
  },
  {
    title: 'react-hook-form — `register` и `useWatch`',
    href: 'https://react-hook-form.com/docs/useform/register',
    what: 'неконтролируемая модель через `ref`; на стенде не проверялась — пакета в проекте нет',
  },
];

export const RELATED =
  'Смежное на сайте: [Ре-рендеринг в React](/frameworks/react-rerender/) — почему родитель тянет за собой детей и когда помогает `memo`. [Реактивность Vue](/frameworks/vue-reactivity/) — как рендер запоминает прочитанное. [Стейт-менеджеры изнутри, раздел «Селектор»](/frameworks/state-managers/#s3) — подписка на кусок состояния, тот же приём, что у `useWatch`. [Сигналы](/frameworks/signals/#s5) — модель, где ввод перерисовывает один текстовый узел. [События DOM](/render/dom-events/#s4) — отправка формы пятью способами и что из них проходит проверку. [Дерево доступности, раздел «Имя»](/render/accessibility-tree/#s4) — `<label>` даёт полю имя, которое слышит скринридер. [Ввод текста в браузере](/render/text-input/) — порядок событий клавиши, `inputType`, IME и автозаполнение без фреймворка. [Загрузка файлов](/platform/uploads/) — тело multipart по байтам, докачка по tus и ссылки с подписью.';
