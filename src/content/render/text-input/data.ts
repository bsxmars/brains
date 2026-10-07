import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { FieldRun, InputScenario } from '@/widgets/input-lab/model/types';

/**
 * Данные темы «Ввод текста в браузере: события, IME и автозаполнение».
 *
 * Тема написана здесь, 2026-10-01, для направления «Браузер и рендеринг».
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * Chromium **153.0.8010.12** из Playwright 1.63: headless shell — для событий клавиатуры, IME,
 * вставки и `contenteditable`; полный Chromium (`channel: 'chromium'`, новый headless) — для
 * автозаполнения: в headless shell домена DevTools `Autofill` нет. Node 24.11.0, macOS,
 * октябрь 2026. Страницы отдавал свой `node:http` на 127.0.0.1 (порты 52400–52406); скрипты
 * стенда — вне проекта, в рабочем каталоге автора темы (`s1.mjs` … `s6-facts.mjs`).
 *
 * Как набирали:
 *   — латиница, Backspace, Delete, Enter, Ctrl/Cmd-сочетания — клавиатура Playwright
 *     (`page.keyboard.press`): это CDP `Input.dispatchKeyEvent`, браузер видит их как
 *     настоящие нажатия (`isTrusted: true`);
 *   — **русская раскладка имитирована**: CDP `Input.dispatchKeyEvent` с `key: 'ф'`,
 *     `code: 'KeyA'`, `text: 'ф'`. `key`, `code` и `keyCode` у `keydown` задал стенд; `keyCode`
 *     у `keypress` (1092) и правку поля посчитал Chromium;
 *   — **IME имитирован**: CDP `Input.imeSetComposition` (недописанное слово) и `Input.insertText`
 *     (выбор слова). Настоящий метод ввода ОС не запускался. Enter посреди набора — CDP
 *     `rawKeyDown` без текста; что настоящий IME шлёт у такого `keydown` `keyCode` 229 —
 *     по спецификации UI Events и MDN, не снято. `compositionend` после `Input.insertText` пришёл
 *     с `isTrusted: false` — особенность пути DevTools, в тексте не используется;
 *   — вставка — `navigator.clipboard.writeText` / `write` с `ClipboardItem`, затем
 *     `ControlOrMeta+v` клавиатурой Playwright (разрешения `clipboard-read`/`clipboard-write`);
 *   — **автозаполнение** — CDP `Autofill.trigger` (адрес и карта): DevTools имитирует выбор
 *     пользователя в подсказке. Список сохранённых адресов и сама подсказка не показывались;
 *     что делает менеджер паролей (`current-password`, `new-password`) и SMS-код
 *     (`one-time-code`) — по документации.
 *
 * Нормализация: из журналов убраны нажатия модификаторов (`Meta`/`Control`) — модель их не
 * знает, а на Linux вместо `Meta` пришёл бы `Control`; убрано нестандартное событие
 * `textInput` (оно приходит, это отдельный факт `FACTS.withTextInput`).
 *
 * Что пересобирается `tests/unit/text-input.test.ts`:
 *   — `STAND_RUNS` — тест снова прогоняет все сценарии в Chromium тем же `WATCH_CODE` и сверяет
 *     журналы дословно; `SIM_CODE` (учебная модель) сверяется с ними же на каждом сценарии;
 *   — `FACTS` (запись из кода, история правок, вставка, `contenteditable`) и `AUTOFILL` — тест
 *     снимает их в Chromium заново;
 *   — примеры кода (`SHORTCUT_CODE`, `ENTER_CODE`, `PASTE_PLAIN_CODE`, `INSERT_CODE`,
 *     `NO_FORMAT_CODE`, `AUTOFILL_CODE`) исполняются в Chromium как есть.
 *
 * Только по документации: `keyCode` 229 у настоящего IME и порядок событий Enter в Safari,
 * `insertFromDrop`, поведение менеджера паролей и `one-time-code`, `autocomplete="webauthn"`
 * (снят в теме «Passkeys»). Firefox и Safari стенд не снимал.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: '`beforeinput` и `input`',
    d: 'Два события вокруг каждой правки поля. `beforeinput` приходит до неё: значение ещё старое, правку можно отменить. `input` — после: значение уже новое, отменять поздно.',
  },
  {
    k: '`inputType`',
    d: 'Поле событий `beforeinput` и `input`, которое называет правку: `insertText` — символ, `deleteContentBackward` — Backspace, `insertFromPaste` — вставка, `historyUndo` — Ctrl+Z.',
  },
  {
    k: '`key` и `code`',
    d: 'Два поля события клавиатуры. `key` — что напечатано на клавише в текущей раскладке («a» или «ф»). `code` — где клавиша лежит на клавиатуре (`KeyA`), раскладка на него не влияет.',
  },
  {
    k: 'IME и composition',
    d: 'IME — метод ввода, который собирает слово из нескольких нажатий: японская кана, китайский пиньинь, голосовой ввод на телефоне. Пока слово не выбрано, поле в состоянии composition: текст виден, но ещё черновой.',
  },
  {
    k: 'каретка и выделение',
    d: 'Каретка — мигающий курсор в поле. Её место — `selectionStart` и `selectionEnd`: когда ничего не выделено, числа равны. Это номера символов, с нуля.',
  },
  {
    k: 'автозаполнение',
    d: 'Браузер сам вписывает в поля имя, адрес, карту или пароль, которые сохранил раньше. Какое поле чем заполнить, подсказывает атрибут `autocomplete`.',
  },
  {
    k: '`contenteditable`',
    d: 'Атрибут, который делает редактируемым любой элемент, не только `<input>`. Внутри — не строка, а HTML: жирный текст, абзацы, картинки.',
  },
];

export const PLAIN_INPUT =
  'Как секретарь, которому диктуют письмо. `keydown` — он услышал, что вы заговорили. `beforeinput` — занёс ручку над бумагой: «пишу „а“?» — и его ещё можно остановить. `input` — буква на бумаге, остановить уже нечего. Остальные события — разговоры вокруг: кто нажал какую клавишу, кто диктует по слогам.';

export const PREREQ_NOTE =
  'Тема спускается ниже фреймворков, к самому полю. Три вещи она берёт из других тем.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'Действие по умолчанию и `preventDefault()`',
    d: 'После слушателей браузер делает свою работу: печатает букву, вставляет текст. `preventDefault()` в слушателе отменяет этот шаг, если событие отменяемое (`cancelable: true`).',
    href: '/render/dom-events/#s4',
    hrefLabel: '«События DOM», раздел «Действие по умолчанию»',
    tone: 'info',
  },
  {
    t: 'Событие от человека и событие от кода',
    d: 'У события, которое породил браузер в ответ на действие человека, `isTrusted: true`. Событие из `dispatchEvent` — только сообщение слушателям: букву оно не напечатает.',
    href: '/render/dom-events/#s4',
    hrefLabel: '«События DOM», «Синтетические события и `isTrusted`»',
    tone: 'info',
  },
  {
    t: 'Поле во фреймворке',
    d: 'React и Vue держат вторую копию значения и пишут её обратно в `input.value`. Отсюда прыгающая каретка и сломанный японский ввод — их разбор на уровне фреймворков уже есть.',
    href: '/frameworks/forms/#s1',
    hrefLabel: '«Формы во фреймворках», раздел «Две копии»',
    tone: 'info',
  },
];

// ─── Журналы стенда ────────────────────────────────────────────────────────────────────────

/**
 * Chromium 153, `<input>` без фреймворка, журнал — `WATCH_CODE`. Сценарии — `SCENARIOS` ниже
 * (поле до начала, шаги, где слушатель зовёт `preventDefault()`). Модификаторы и `textInput`
 * убраны (см. шапку). Пересобирается тестом.
 */
export const STAND_RUNS: Record<string, FieldRun> = {
  char: {
    value: 'a',
    sel: [1, 1],
    log: [
      { type: 'keydown', key: 'a', code: 'KeyA', keyCode: 65, composing: false, cancelable: true, value: '', sel: [0, 0] },
      { type: 'keypress', key: 'a', code: 'KeyA', keyCode: 97, composing: false, cancelable: true, value: '', sel: [0, 0] },
      { type: 'beforeinput', inputType: 'insertText', data: 'a', composing: false, cancelable: true, value: '', sel: [0, 0] },
      { type: 'input', inputType: 'insertText', data: 'a', composing: false, cancelable: false, value: 'a', sel: [1, 1] },
      { type: 'keyup', key: 'a', code: 'KeyA', keyCode: 65, composing: false, cancelable: true, value: 'a', sel: [1, 1] },
    ],
  },
  layout: {
    value: 'ф',
    sel: [1, 1],
    log: [
      { type: 'keydown', key: 'ф', code: 'KeyA', keyCode: 65, composing: false, cancelable: true, value: '', sel: [0, 0] },
      { type: 'keypress', key: 'ф', code: 'KeyA', keyCode: 1092, composing: false, cancelable: true, value: '', sel: [0, 0] },
      { type: 'beforeinput', inputType: 'insertText', data: 'ф', composing: false, cancelable: true, value: '', sel: [0, 0] },
      { type: 'input', inputType: 'insertText', data: 'ф', composing: false, cancelable: false, value: 'ф', sel: [1, 1] },
      { type: 'keyup', key: 'ф', code: 'KeyA', keyCode: 65, composing: false, cancelable: true, value: 'ф', sel: [1, 1] },
    ],
  },
  backspace: {
    value: 'ab',
    sel: [2, 2],
    log: [
      { type: 'keydown', key: 'Backspace', code: 'Backspace', keyCode: 8, composing: false, cancelable: true, value: 'abc', sel: [3, 3] },
      { type: 'beforeinput', inputType: 'deleteContentBackward', data: null, composing: false, cancelable: true, value: 'abc', sel: [3, 3] },
      { type: 'input', inputType: 'deleteContentBackward', data: null, composing: false, cancelable: false, value: 'ab', sel: [2, 2] },
      { type: 'keyup', key: 'Backspace', code: 'Backspace', keyCode: 8, composing: false, cancelable: true, value: 'ab', sel: [2, 2] },
    ],
  },
  backspace0: {
    value: 'abc',
    sel: [0, 0],
    log: [
      { type: 'keydown', key: 'Backspace', code: 'Backspace', keyCode: 8, composing: false, cancelable: true, value: 'abc', sel: [0, 0] },
      { type: 'beforeinput', inputType: 'deleteContentBackward', data: null, composing: false, cancelable: true, value: 'abc', sel: [0, 0] },
      { type: 'keyup', key: 'Backspace', code: 'Backspace', keyCode: 8, composing: false, cancelable: true, value: 'abc', sel: [0, 0] },
    ],
  },
  enter: {
    value: 'ab',
    sel: [2, 2],
    log: [
      { type: 'keydown', key: 'Enter', code: 'Enter', keyCode: 13, composing: false, cancelable: true, value: 'ab', sel: [2, 2] },
      { type: 'keypress', key: 'Enter', code: 'Enter', keyCode: 13, composing: false, cancelable: true, value: 'ab', sel: [2, 2] },
      { type: 'beforeinput', inputType: 'insertLineBreak', data: null, composing: false, cancelable: true, value: 'ab', sel: [2, 2] },
      { type: 'keyup', key: 'Enter', code: 'Enter', keyCode: 13, composing: false, cancelable: true, value: 'ab', sel: [2, 2] },
    ],
  },
  'cancel-keydown': {
    value: '',
    sel: [0, 0],
    log: [
      { type: 'keydown', key: 'a', code: 'KeyA', keyCode: 65, composing: false, cancelable: true, value: '', sel: [0, 0] },
      { type: 'keyup', key: 'a', code: 'KeyA', keyCode: 65, composing: false, cancelable: true, value: '', sel: [0, 0] },
    ],
  },
  'cancel-before': {
    value: 'abc',
    sel: [3, 3],
    log: [
      { type: 'keydown', key: 'x', code: 'KeyX', keyCode: 88, composing: false, cancelable: true, value: 'abc', sel: [3, 3] },
      { type: 'keypress', key: 'x', code: 'KeyX', keyCode: 120, composing: false, cancelable: true, value: 'abc', sel: [3, 3] },
      { type: 'beforeinput', inputType: 'insertText', data: 'x', composing: false, cancelable: true, value: 'abc', sel: [3, 3] },
      { type: 'keyup', key: 'x', code: 'KeyX', keyCode: 88, composing: false, cancelable: true, value: 'abc', sel: [3, 3] },
      { type: 'keydown', key: 'Backspace', code: 'Backspace', keyCode: 8, composing: false, cancelable: true, value: 'abc', sel: [3, 3] },
      { type: 'beforeinput', inputType: 'deleteContentBackward', data: null, composing: false, cancelable: true, value: 'abc', sel: [3, 3] },
      { type: 'keyup', key: 'Backspace', code: 'Backspace', keyCode: 8, composing: false, cancelable: true, value: 'abc', sel: [3, 3] },
    ],
  },
  paste: {
    value: 'aXYb',
    sel: [3, 3],
    log: [
      { type: 'keydown', key: 'v', code: 'KeyV', keyCode: 86, composing: false, cancelable: true, value: 'ab', sel: [1, 1] },
      { type: 'paste', cancelable: true, value: 'ab', sel: [1, 1] },
      { type: 'beforeinput', inputType: 'insertFromPaste', data: 'XY', composing: false, cancelable: true, value: 'ab', sel: [1, 1] },
      { type: 'input', inputType: 'insertFromPaste', data: 'XY', composing: false, cancelable: false, value: 'aXYb', sel: [3, 3] },
      { type: 'keyup', key: 'v', code: 'KeyV', keyCode: 86, composing: false, cancelable: true, value: 'aXYb', sel: [3, 3] },
    ],
  },
  'cancel-paste': {
    value: 'ab',
    sel: [1, 1],
    log: [
      { type: 'keydown', key: 'v', code: 'KeyV', keyCode: 86, composing: false, cancelable: true, value: 'ab', sel: [1, 1] },
      { type: 'paste', cancelable: true, value: 'ab', sel: [1, 1] },
      { type: 'keyup', key: 'v', code: 'KeyV', keyCode: 86, composing: false, cancelable: true, value: 'ab', sel: [1, 1] },
    ],
  },
  ime: {
    value: 'ab漢',
    sel: [3, 3],
    log: [
      { type: 'compositionstart', data: '', cancelable: true, value: 'ab', sel: [2, 2] },
      { type: 'compositionupdate', data: 'k', cancelable: true, value: 'ab', sel: [2, 2] },
      { type: 'beforeinput', inputType: 'insertCompositionText', data: 'k', composing: true, cancelable: false, value: 'ab', sel: [2, 2] },
      { type: 'input', inputType: 'insertCompositionText', data: 'k', composing: true, cancelable: false, value: 'abk', sel: [3, 3] },
      { type: 'compositionupdate', data: 'か', cancelable: true, value: 'abk', sel: [2, 3] },
      { type: 'beforeinput', inputType: 'insertCompositionText', data: 'か', composing: true, cancelable: false, value: 'abk', sel: [2, 3] },
      { type: 'input', inputType: 'insertCompositionText', data: 'か', composing: true, cancelable: false, value: 'abか', sel: [3, 3] },
      { type: 'compositionupdate', data: 'かん', cancelable: true, value: 'abか', sel: [2, 3] },
      { type: 'beforeinput', inputType: 'insertCompositionText', data: 'かん', composing: true, cancelable: false, value: 'abか', sel: [2, 3] },
      { type: 'input', inputType: 'insertCompositionText', data: 'かん', composing: true, cancelable: false, value: 'abかん', sel: [4, 4] },
      { type: 'keydown', key: 'Enter', code: 'Enter', keyCode: 13, composing: true, cancelable: true, value: 'abかん', sel: [4, 4] },
      { type: 'keyup', key: 'Enter', code: 'Enter', keyCode: 13, composing: true, cancelable: true, value: 'abかん', sel: [4, 4] },
      { type: 'compositionupdate', data: '漢', cancelable: true, value: 'abかん', sel: [2, 4] },
      { type: 'beforeinput', inputType: 'insertCompositionText', data: '漢', composing: true, cancelable: false, value: 'abかん', sel: [2, 4] },
      { type: 'input', inputType: 'insertCompositionText', data: '漢', composing: true, cancelable: false, value: 'ab漢', sel: [3, 3] },
      { type: 'compositionend', data: '漢', cancelable: true, value: 'ab漢', sel: [3, 3] },
    ],
  },
  'ime-cancel': {
    value: 'か',
    sel: [1, 1],
    log: [
      { type: 'compositionstart', data: '', cancelable: true, value: '', sel: [0, 0] },
      { type: 'compositionupdate', data: 'k', cancelable: true, value: '', sel: [0, 0] },
      { type: 'beforeinput', inputType: 'insertCompositionText', data: 'k', composing: true, cancelable: false, value: '', sel: [0, 0] },
      { type: 'input', inputType: 'insertCompositionText', data: 'k', composing: true, cancelable: false, value: 'k', sel: [1, 1] },
      { type: 'compositionupdate', data: 'か', cancelable: true, value: 'k', sel: [0, 1] },
      { type: 'beforeinput', inputType: 'insertCompositionText', data: 'か', composing: true, cancelable: false, value: 'k', sel: [0, 1] },
      { type: 'input', inputType: 'insertCompositionText', data: 'か', composing: true, cancelable: false, value: 'か', sel: [1, 1] },
      { type: 'compositionend', data: 'か', cancelable: true, value: 'か', sel: [1, 1] },
    ],
  },
  set: {
    value: 'ABCDEFx',
    sel: [7, 7],
    log: [
      { type: 'keydown', key: 'x', code: 'KeyX', keyCode: 88, composing: false, cancelable: true, value: 'ABCDEF', sel: [6, 6] },
      { type: 'keypress', key: 'x', code: 'KeyX', keyCode: 120, composing: false, cancelable: true, value: 'ABCDEF', sel: [6, 6] },
      { type: 'beforeinput', inputType: 'insertText', data: 'x', composing: false, cancelable: true, value: 'ABCDEF', sel: [6, 6] },
      { type: 'input', inputType: 'insertText', data: 'x', composing: false, cancelable: false, value: 'ABCDEFx', sel: [7, 7] },
      { type: 'keyup', key: 'x', code: 'KeyX', keyCode: 88, composing: false, cancelable: true, value: 'ABCDEFx', sel: [7, 7] },
    ],
  },
  'cancel-keypress': {
    value: '',
    sel: [0, 0],
    log: [
      { type: 'keydown', key: 'a', code: 'KeyA', keyCode: 65, composing: false, cancelable: true, value: '', sel: [0, 0] },
      { type: 'keypress', key: 'a', code: 'KeyA', keyCode: 97, composing: false, cancelable: true, value: '', sel: [0, 0] },
      { type: 'keyup', key: 'a', code: 'KeyA', keyCode: 65, composing: false, cancelable: true, value: '', sel: [0, 0] },
    ],
  },
  'paste-keydown': {
    value: 'ab',
    sel: [1, 1],
    log: [
      { type: 'keydown', key: 'v', code: 'KeyV', keyCode: 86, composing: false, cancelable: true, value: 'ab', sel: [1, 1] },
      { type: 'keyup', key: 'v', code: 'KeyV', keyCode: 86, composing: false, cancelable: true, value: 'ab', sel: [1, 1] },
    ],
  },
  'set-same': {
    value: 'abxcdef',
    sel: [3, 3],
    log: [
      { type: 'keydown', key: 'x', code: 'KeyX', keyCode: 88, composing: false, cancelable: true, value: 'abcdef', sel: [2, 2] },
      { type: 'keypress', key: 'x', code: 'KeyX', keyCode: 120, composing: false, cancelable: true, value: 'abcdef', sel: [2, 2] },
      { type: 'beforeinput', inputType: 'insertText', data: 'x', composing: false, cancelable: true, value: 'abcdef', sel: [2, 2] },
      { type: 'input', inputType: 'insertText', data: 'x', composing: false, cancelable: false, value: 'abxcdef', sel: [3, 3] },
      { type: 'keyup', key: 'x', code: 'KeyX', keyCode: 88, composing: false, cancelable: true, value: 'abxcdef', sel: [3, 3] },
    ],
  },
};

/** Сценарии стенда. Восемь первых — пресеты демо. */
export const SCENARIOS: InputScenario[] = [
  {
    id: 'char',
    label: 'буква «a»',
    note: 'Одна клавиша — пять событий. Значение меняется между `beforeinput` и `input`: до него поле пустое, после — с буквой.',
    start: { value: '', caret: 0 },
    cancel: [],
    actions: [{ do: 'key', key: 'a', code: 'KeyA' }],
  },
  {
    id: 'layout',
    label: '«ф» на месте «a»',
    note: 'Русская раскладка, та же клавиша. `code` остался `KeyA`, `keyCode` у `keydown` — 65, как у латинской «a». Букву называют только `key` и `data`.',
    start: { value: '', caret: 0 },
    cancel: [],
    actions: [{ do: 'key', key: 'ф', code: 'KeyA' }],
  },
  {
    id: 'cancel-before',
    label: 'отмена в beforeinput',
    note: 'Слушатель `beforeinput` зовёт `preventDefault()`. Ни буква, ни Backspace поле не меняют, `input` не приходит — а `keydown` и `keyup` приходят как обычно.',
    start: { value: 'abc', caret: 3 },
    cancel: ['beforeinput'],
    actions: [
      { do: 'key', key: 'x', code: 'KeyX' },
      { do: 'key', key: 'Backspace', code: 'Backspace' },
    ],
  },
  {
    id: 'enter',
    label: 'Enter в <input>',
    note: 'Поле однострочное, перевода строки в нём нет. Но `beforeinput` с `insertLineBreak` всё равно приходит — правки нет, и `input` за ним не следует.',
    start: { value: 'ab', caret: 2 },
    cancel: [],
    actions: [{ do: 'key', key: 'Enter', code: 'Enter' }],
  },
  {
    id: 'paste',
    label: 'вставка',
    note: 'Ctrl+V или Cmd+V: `keydown` буквы «v», потом `paste` с буфером, потом обычная пара `beforeinput` → `input` с `insertFromPaste`. `keypress` нет: с зажатым модификатором символ не печатается.',
    start: { value: 'ab', caret: 1 },
    cancel: [],
    actions: [{ do: 'paste', text: 'XY' }],
  },
  {
    id: 'ime',
    label: 'IME: かん → 漢',
    note: 'Три шага набора и выбор слова. Каждый шаг заменяет черновое слово целиком; перед заменой браузер выделяет его — видно по `sel`. Enter посреди набора дал только `keydown` и `keyup` с `isComposing: true`.',
    start: { value: 'ab', caret: 2 },
    cancel: [],
    actions: [
      { do: 'compose', text: 'k' },
      { do: 'compose', text: 'か' },
      { do: 'compose', text: 'かん' },
      { do: 'key', key: 'Enter', code: 'Enter' },
      { do: 'commit', text: '漢' },
    ],
  },
  {
    id: 'ime-cancel',
    label: 'IME и отмена',
    note: 'Тот же `preventDefault()` в `beforeinput`, что выше остановил букву. Во время набора `beforeinput` неотменяемый (`cancelable: false`) — слово всё равно попало в поле.',
    start: { value: '', caret: 0 },
    cancel: ['beforeinput'],
    actions: [
      { do: 'compose', text: 'k' },
      { do: 'commit', text: 'か' },
    ],
  },
  {
    id: 'set',
    label: 'el.value = …',
    note: 'Код записал в поле `ABCDEF`, пока каретка стояла после «ab». Событий нет ни одного, а каретка уехала в конец — следующая буква встала туда же.',
    start: { value: 'abcdef', caret: 2 },
    cancel: [],
    actions: [
      { do: 'set', value: 'ABCDEF' },
      { do: 'key', key: 'x', code: 'KeyX' },
    ],
  },
  {
    id: 'backspace',
    label: 'Backspace',
    note: '',
    start: { value: 'abc', caret: 3 },
    cancel: [],
    actions: [{ do: 'key', key: 'Backspace', code: 'Backspace' }],
  },
  {
    id: 'backspace0',
    label: 'Backspace в начале',
    note: '',
    start: { value: 'abc', caret: 0 },
    cancel: [],
    actions: [{ do: 'key', key: 'Backspace', code: 'Backspace' }],
  },
  {
    id: 'cancel-keydown',
    label: 'отмена в keydown',
    note: '',
    start: { value: '', caret: 0 },
    cancel: ['keydown'],
    actions: [{ do: 'key', key: 'a', code: 'KeyA' }],
  },
  {
    id: 'cancel-paste',
    label: 'отмена в paste',
    note: '',
    start: { value: 'ab', caret: 1 },
    cancel: ['paste'],
    actions: [{ do: 'paste', text: 'XY' }],
  },
  {
    id: 'cancel-keypress',
    label: 'отмена в keypress',
    note: '',
    start: { value: '', caret: 0 },
    cancel: ['keypress'],
    actions: [{ do: 'key', key: 'a', code: 'KeyA' }],
  },
  {
    id: 'paste-keydown',
    label: 'отмена keydown у Ctrl+V',
    note: '',
    start: { value: 'ab', caret: 1 },
    cancel: ['keydown'],
    actions: [{ do: 'paste', text: 'XY' }],
  },
  {
    id: 'set-same',
    label: 'el.value = та же строка',
    note: '',
    start: { value: 'abcdef', caret: 2 },
    cancel: [],
    actions: [
      { do: 'set', value: 'abcdef' },
      { do: 'key', key: 'x', code: 'KeyX' },
    ],
  },
];

/** Сценарии, которые демо показывает пресетами. */
export const DEMO_SCENARIOS = SCENARIOS.slice(0, 8);

// ─── Раздел 1. Одно нажатие ────────────────────────────────────────────────────────────────

const ORDER_WHAT: Record<string, string> = {
  keydown: 'Клавиша опустилась. Поле ещё не тронуто.',
  keypress: 'Клавиша даёт символ. Устаревшее событие, но Chromium его шлёт.',
  beforeinput: 'Браузер собирается править поле: что именно — в `inputType` и `data`.',
  input: 'Правка сделана, `value` уже новое.',
  keyup: 'Клавиша поднялась.',
};

/** Таблица порядка — из журнала стенда `STAND_RUNS.char`, а не набрана руками. */
export const ORDER_ROWS = STAND_RUNS.char.log.map((e) => ({
  ev: e.type,
  what: ORDER_WHAT[e.type],
  value: JSON.stringify(e.value),
  cancelable: e.cancelable ? 'да' : '**нет**',
}));

export const ORDER_NOTE =
  'Между `beforeinput` и `input` Chromium 153 шлёт ещё `textInput` — старое событие WebKit, которого нет ни в одной действующей спецификации. В журналах темы оно убрано; полагаться на него не стоит. Важнее другое: `input` неотменяемый. Остановить правку можно только раньше — в `beforeinput` или ещё до него.';

/** `inputType`, которые пришли на стенде, и что их вызвало. Пересобирается тестом (`FACTS`). */
export const INPUT_TYPE_ROWS = [
  { t: '`insertText`', how: 'символ с клавиатуры; `execCommand(\'insertText\')`', where: 'везде' },
  { t: '`deleteContentBackward`', how: 'Backspace', where: 'везде' },
  { t: '`deleteContentForward`', how: 'Delete', where: 'везде' },
  { t: '`deleteWordBackward`', how: 'Alt+Backspace на Mac, Ctrl+Backspace на Windows и Linux', where: 'везде' },
  { t: '`deleteByCut`', how: 'Ctrl+X / Cmd+X; перед ним — событие `cut`', where: 'везде' },
  { t: '`insertFromPaste`', how: 'Ctrl+V / Cmd+V; перед ним — событие `paste`', where: 'везде' },
  { t: '`insertLineBreak`', how: 'Enter в `<textarea>`; Shift+Enter в `contenteditable`', where: 'в `<input>` — только `beforeinput`' },
  { t: '`insertParagraph`', how: 'Enter в `contenteditable`', where: '`contenteditable`' },
  { t: '`insertCompositionText`', how: 'каждый шаг набора через IME', where: 'везде' },
  { t: '`historyUndo`, `historyRedo`', how: 'Ctrl+Z / Cmd+Z и Ctrl+Shift+Z / Cmd+Shift+Z', where: 'везде' },
  { t: '`formatBold`', how: 'Ctrl+B / Cmd+B', where: '`contenteditable`' },
];

export const INPUT_TYPE_NOTE =
  'Спецификация Input Events перечисляет больше сорока значений: перетаскивание (`insertFromDrop`), правки орфографии (`insertReplacementText`), курсив, списки. Слушатель, который реагирует только на `insertText`, пропустит вставку, удаление и отмену — а `value` изменится во всех этих случаях.';

// ─── Раздел 2. Что можно отменить ──────────────────────────────────────────────────────────

/** Кто отменяет и что пропадает. Каждая строка — сценарий из `STAND_RUNS`. */
export const CANCEL_ROWS = [
  { where: '`keydown`', gone: '`keypress`, `beforeinput`, `input` и сама правка; `keyup` приходит', run: 'cancel-keydown', tone: 'ok' as const },
  { where: '`keypress`', gone: '`beforeinput`, `input` и правка', run: 'cancel-keypress', tone: 'ok' as const },
  { where: '`beforeinput`', gone: 'правка и `input`', run: 'cancel-before', tone: 'ok' as const },
  { where: '`keydown` у Ctrl+V', gone: '`paste` и вставка целиком', run: 'paste-keydown', tone: 'ok' as const },
  { where: '`paste`', gone: '`beforeinput`, `input` и вставка', run: 'cancel-paste', tone: 'ok' as const },
  { where: '`beforeinput` во время IME', gone: 'ничего: `cancelable: false`, слово попадает в поле', run: 'ime-cancel', tone: 'err' as const },
  { where: '`input`', gone: 'ничего: правка уже сделана, `cancelable: false`', run: 'char', tone: 'err' as const },
];

export const PLAIN_CANCEL =
  'Как шлагбаум и камера. `beforeinput` — шлагбаум: машина ещё перед ним, его можно не поднять. `input` — камера за шлагбаумом: она видит, кто проехал, но вернуть машину не может. Пока человек набирает слово через IME, шлагбаум поднят намертво — проедет всё.';

export const SIM_CODE = `// Учебная модель однострочного <input>: какие события придут и что станет со значением.
// start — { value, caret }; cancel — события, в которых слушатель зовёт preventDefault().
function simulateField(start, actions, cancel = []) {
  let value = start.value;
  let sel = [start.caret, start.caret];   // selectionStart, selectionEnd
  let comp = null;                        // слово, которое набирает IME: { at, len }
  const log = [];

  // Событие в журнал. Вернёт true, если слушатель его отменил.
  function fire(type, fields = {}, cancelable = true) {
    log.push({ type, ...fields, cancelable, value, sel: [...sel] });
    return cancelable && cancel.includes(type);
  }
  // Заменить кусок строки; каретка встаёт за вставленный текст.
  function replace(from, to, text) {
    value = value.slice(0, from) + text + value.slice(to);
    sel = [from + text.length, from + text.length];
    return true;
  }
  // beforeinput → правка → input. Отменили beforeinput или править нечего — input не придёт.
  function edit(inputType, data, apply, composing = false) {
    const fields = { inputType, data, composing };
    if (fire('beforeinput', fields, !composing)) return;   // во время IME отменить нельзя
    if (apply()) fire('input', fields, false);
  }
  // Что клавиша делает с однострочным полем.
  function keyEdit(key) {
    const [s, e] = sel;
    if (key.length === 1) edit('insertText', key, () => replace(s, e, key));
    else if (key === 'Backspace')
      edit('deleteContentBackward', null, () => (s !== e ? replace(s, e, '') : s > 0 && replace(s - 1, s, '')));
    else if (key === 'Enter') edit('insertLineBreak', null, () => false);  // в <input> строка одна
  }
  function keyFields(key, code) {
    const keyCode = code.startsWith('Key') ? code.charCodeAt(3) : { Backspace: 8, Enter: 13 }[code];
    return { key, code, keyCode, composing: comp !== null };
  }
  function compose(text, end) {
    if (!comp) {
      fire('compositionstart', { data: '' });
      comp = { at: sel[0], len: 0 };
    }
    sel = [comp.at, comp.at + comp.len];  // браузер выделяет черновое слово
    fire('compositionupdate', { data: text });
    edit('insertCompositionText', text, () => {
      replace(comp.at, comp.at + comp.len, text);
      comp.len = text.length;
      return true;
    }, true);
    if (end) {
      comp = null;
      fire('compositionend', { data: text });
    }
  }

  for (const a of actions) {
    if (a.do === 'key') {
      const k = keyFields(a.key, a.code);
      // Во время IME клавиши забирает метод ввода: полю достаются только keydown и keyup.
      if (!fire('keydown', k) && !comp) {
        const printable = a.key.length === 1 || a.key === 'Enter';
        const charCode = a.key === 'Enter' ? 13 : a.key.codePointAt(0);
        if (!(printable && fire('keypress', { ...k, keyCode: charCode }))) keyEdit(a.key);
      }
      fire('keyup', k);
    } else if (a.do === 'paste') {        // Ctrl+V / Cmd+V; нажатие модификатора не пишем
      const k = keyFields('v', 'KeyV');
      if (!fire('keydown', k) && !fire('paste'))
        edit('insertFromPaste', a.text, () => replace(sel[0], sel[1], a.text));
      fire('keyup', k);
    } else if (a.do === 'compose') compose(a.text, false);
    else if (a.do === 'commit') compose(a.text, true);
    else if (a.do === 'set' && a.value !== value) {   // el.value = …: ни одного события
      value = a.value;
      sel = [value.length, value.length];             // новая строка — каретка в конец
    }
  }
  return { value, sel, log };
}`;

export const SIM_NOTE =
  'Модель знает пять видов шагов: клавишу, вставку, шаг набора IME, выбор слова и запись `el.value`. Её журнал совпадает с журналом Chromium 153 на всех пятнадцати сценариях темы — до поля `cancelable` и номера символа в `sel`. Чего в ней нет: многострочного поля, выделения мышью, Delete и автоповтора зажатой клавиши.';

export const WATCH_CODE = `// Журнал событий поля: тип, клавиша, правка, значение и выделение в момент события.
function watchField(field, onEvent, cancel = []) {
  const TYPES = ['keydown', 'keypress', 'beforeinput', 'input', 'keyup',
    'compositionstart', 'compositionupdate', 'compositionend', 'paste'];
  for (const type of TYPES) {
    field.addEventListener(type, (e) => {
      const entry = { type };
      if (e instanceof KeyboardEvent) Object.assign(entry, { key: e.key, code: e.code, keyCode: e.keyCode });
      if (e instanceof InputEvent) Object.assign(entry, { inputType: e.inputType, data: e.data });
      if (e instanceof CompositionEvent) entry.data = e.data;
      if ('isComposing' in e) entry.composing = e.isComposing;
      entry.cancelable = e.cancelable;
      entry.value = field.value;
      entry.sel = [field.selectionStart, field.selectionEnd];
      if (cancel.includes(type)) e.preventDefault();
      onEvent(entry);
    });
  }
}`;

export const DEMO_CAPTION =
  'Журнал считает `simulateField` — строка выше; для каждого готового сценария он совпадает с журналом Chromium 153. Отмените `beforeinput` и наберите слово через IME: отмена не сработает, шаг набора неотменяемый. Отмените `keydown` у Ctrl+V — не придёт даже `paste`. Живое поле пишет журнал функцией `watchField` в вашем браузере: с вашей раскладкой, методом ввода и автозаполнением.';

// ─── Раздел 3. key, code и раскладка ───────────────────────────────────────────────────────

const pick = (id: string, type: string) => STAND_RUNS[id].log.find((e) => e.type === type)!;

/** Одна клавиша в двух раскладках — из журналов `char` и `layout`. */
export const KEY_ROWS = [
  { k: '`key`', en: pick('char', 'keydown').key, ru: pick('layout', 'keydown').key, d: 'символ на клавише в текущей раскладке' },
  { k: '`code`', en: pick('char', 'keydown').code, ru: pick('layout', 'keydown').code, d: 'место клавиши, раскладка не влияет' },
  { k: '`keyCode` у `keydown`', en: String(pick('char', 'keydown').keyCode), ru: String(pick('layout', 'keydown').keyCode), d: 'устарел; номер клавиши по латинской букве' },
  { k: '`keyCode` у `keypress`', en: String(pick('char', 'keypress').keyCode), ru: String(pick('layout', 'keypress').keyCode), d: 'устарел; код символа в Юникоде' },
  { k: '`data` у `beforeinput`', en: pick('char', 'beforeinput').data!, ru: pick('layout', 'beforeinput').data!, d: 'что попадёт в поле' },
];

export const PLAIN_KEY =
  'Как клавиатура, на которую наклеили русские буквы. `code` — место клавиши на плате: третья слева во втором ряду, что бы на ней ни было наклеено. `key` — что видно на наклейке сейчас. Сменили раскладку — наклейка другая, место то же.';

export const KEY_RULES = [
  {
    t: 'Нужна буква — `key` или `data`',
    d: 'Что человек напечатал, знает только `key`, а надёжнее всего — `data` у `beforeinput`: туда попадает и текст из IME, и вставка, у которых нажатия нет вовсе.',
    tone: 'ok' as const,
  },
  {
    t: 'Нужно место — `code`',
    d: 'Горячие клавиши вида Ctrl+K и управление WASD в игре. На русской раскладке `key` у той же клавиши — «л», и проверка `e.key === \'k\'` молча не сработает.',
    tone: 'ok' as const,
  },
  {
    t: 'Нужен символ, а не место — снова `key`',
    d: '«?» на американской раскладке — Shift+/, на русской — Shift+7. Подсказка по «?» проверяет `key`: место клавиши у этого символа разное.',
    tone: 'info' as const,
  },
  {
    t: '`keyCode`, `which`, `charCode` и `keypress` — устарели',
    d: 'Спецификация UI Events оставила их только ради старых сайтов. `keyCode` у `keydown` для «ф» — 65, как для «a»: он не различает раскладки. Chromium по-прежнему шлёт `keypress`, но только для клавиш, которые дают символ: у Backspace и Ctrl+V его нет.',
    tone: 'warn' as const,
  },
];

export const SHORTCUT_CODE = `document.addEventListener('keydown', (e) => {
  // Ctrl+K / Cmd+K — по месту клавиши: сработает и на русской раскладке.
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyK') {
    e.preventDefault();
    openSearch();
  }
  // «?» — по символу: на разных раскладках он на разных клавишах.
  if (e.key === '?' && !e.target.closest('input, textarea, [contenteditable]')) showHelp();
});`;

// ─── Раздел 4. IME ─────────────────────────────────────────────────────────────────────────

const ime = STAND_RUNS.ime.log;

/** Набор через IME — журнал `STAND_RUNS.ime` без `keydown`/`keyup` Enter. */
export const IME_ROWS = ime.map((e) => ({
  ev: e.type,
  extra: e.inputType ?? (e.type.startsWith('key') ? `key: ${e.key}` : ''),
  data: e.data === undefined ? '' : JSON.stringify(e.data),
  composing: e.composing === undefined ? '—' : String(e.composing),
  value: JSON.stringify(e.value),
  sel: `${e.sel[0]}–${e.sel[1]}`,
  cancel: e.cancelable ? 'да' : '**нет**',
}));

export const IME_FACTS = [
  {
    t: 'Каждый шаг — замена слова целиком',
    d: '`data` у `beforeinput` — не новая буква, а всё черновое слово: «k», потом «か», потом «かん». Перед заменой браузер выделяет старое слово (`sel` 2–3), поэтому код, который считает символы по `data`, насчитает лишнее.',
  },
  {
    t: '`inputType` — свой: `insertCompositionText`',
    d: 'Обычный символ приходит как `insertText`, шаг набора — как `insertCompositionText`. По этому полю и по `isComposing: true` черновой текст отличают от готового.',
  },
  {
    t: 'Отменить шаг набора нельзя',
    d: '`beforeinput` у `insertCompositionText` неотменяемый. Фильтр «только цифры» через `preventDefault()` пропустит иероглифы: их нужно убирать после `compositionend`.',
  },
  {
    t: 'Enter посреди набора — не отправка',
    d: 'Этим Enter человек выбирает слово в подсказке IME. Поле получает `keydown` с `isComposing: true` и ничего больше. Обработчик, который отправляет форму по любому Enter, отправит полслова.',
  },
];

export const PLAIN_IME =
  'Как писать слово карандашом, прежде чем обвести ручкой. Пока слово в карандаше, его стирают и пишут заново целиком — и выбирать, обводить ли, ещё рано. Enter здесь значит «обвести», а не «отправить письмо».';

export const ENTER_CODE = `input.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  // Enter, которым выбирают слово в IME. keyCode 229 — для браузеров,
  // где compositionend успевает раньше этого keydown.
  if (e.isComposing || e.keyCode === 229) return;
  e.preventDefault();
  send(input.value);
});`;

export const ENTER_NOTE =
  'Проверка `keyCode === 229` выглядит странно рядом со словом «устарел», но MDN советует именно её: настоящий IME помечает нажатия, которые забрал себе, кодом 229, а в Safari `compositionend` приходит раньше `keydown` того Enter, что выбрал слово, — и `isComposing` там уже `false`. Как фреймворки ждут конца набора и что ломает преобразование значения посреди него — в [«Формах во фреймворках», раздел «IME»](/frameworks/forms/#s5).';

// ─── Раздел 5. Вставка ─────────────────────────────────────────────────────────────────────

/** HTML, который стенд кладёт в буфер (`text/html`) вместе с `text/plain` «жирный». */
export const CLIP_HTML = `<b style="color:red">жирный</b><img src="https://example.com/pixel.png" onerror="window.hacked=1"><script>window.hacked=2</script>`;

/**
 * Chromium 153: вставка одного и того же буфера в разные поля, `ControlOrMeta+v`.
 * Пересобирается тестом.
 */
export const FACTS = {
  withTextInput: ['keydown', 'keypress', 'beforeinput:insertText', 'textInput', 'input:insertText', 'keyup'],
  program: {
    valueChanged: { value: 'abXcdef', sel: [7, 7] },
    valueSame: { value: 'abXcdef', sel: [2, 2] },
    preserve: { value: 'abXYcdef', sel: [2, 2] },
    start: { value: 'abXYcdef', sel: [2, 2] },
    end: { value: 'abXYcdef', sel: [4, 4] },
    select: { value: 'abXYcdef', sel: [2, 4] },
    default: { value: 'abXYcdef', sel: [2, 2] },
    before: { value: 'Qabcdef', sel: [3, 3] },
    events: 0,
    execOk: true,
    exec: { value: 'abXYcdef', sel: [4, 4], log: [['input', 'insertText', true]] },
  },
  undoAfterSet: { value: 'xyz', log: ['keydown', 'beforeinput:historyUndo', 'input:historyUndo', 'keyup'] },
  undoAfterExec: {
    afterUndo: '',
    afterRedo: 'abQ',
    log: ['keydown', 'beforeinput:historyUndo', 'input:historyUndo', 'keyup', 'keydown', 'beforeinput:historyRedo', 'input:historyRedo', 'keyup'],
  },
  undoCancelled: { value: 'ab' },
  wordBackward: { value: 'one ', log: ['keydown', 'beforeinput:deleteWordBackward', 'input:deleteWordBackward', 'keyup'] },
  cut: { value: 'c', log: ['keydown', 'cut', 'beforeinput:deleteByCut', 'input:deleteByCut', 'keyup'], clip: 'ab' },
  del: { value: 'ac', log: ['keydown', 'beforeinput:deleteContentForward', 'input:deleteContentForward', 'keyup'] },
  pastePlainOnly: { value: 'abcжирный', log: ['keydown', 'paste', 'beforeinput:insertFromPaste', 'textInput', 'input:insertFromPaste', 'keyup'] },
  textareaEnter: { value: 'ab\n', log: ['keydown', 'keypress', 'beforeinput:insertLineBreak', 'textInput', 'input:insertLineBreak', 'keyup'] },
  pasteInput: {
    value: 'жирный',
    types: ['text/plain', 'text/html'],
    html: '<html><head></head><body><b style="color:red">жирный</b><img src="https://example.com/pixel.png" onerror="window.hacked=1"><script>window.hacked=2</script></body></html>',
    beforeData: 'жирный',
  },
  pasteCe: {
    value: 'abc<b style="color:red">жирный</b><img src="https://example.com/pixel.png">',
    beforeData: null,
    beforeDt: 'жирный',
    hacked: null,
  },
  synthetic: { value: '', log: [['paste', false, 'фейк']] },
  ceEnter: { value: 'abc<div><br></div>', log: ['keydown', 'keypress', 'beforeinput:insertParagraph', 'textInput', 'input:insertParagraph', 'keyup'] },
  ceShiftEnter: { value: 'abc<div><br><br></div>', log: ['keydown', 'keypress', 'beforeinput:insertLineBreak', 'textInput', 'input:insertLineBreak', 'keyup'] },
  ceBold: { value: '<b>abc</b>', log: ['keydown', 'beforeinput:formatBold', 'input:formatBold', 'keyup'] },
  ceBoldCancelled: { value: 'abc' },
  ceExecBold: { ok: true, value: '<b>abc</b>', log: ['input:formatBold'] },
  autofillSelector: [true, true],
};

export const PASTE_ROWS = [
  {
    k: '`paste`: `clipboardData.types`',
    v: FACTS.pasteInput.types.map((t) => '`' + t + '`').join(', '),
    d: 'В буфере лежат два представления одного текста. Слушатель видит оба.',
  },
  {
    k: '`getData(\'text/html\')`',
    v: '`<html><head></head><body>…</body></html>`',
    d: 'Chromium обернул фрагмент в документ. Обработчики `onerror` и `<script>` в буфере на месте.',
  },
  {
    k: 'вставка в `<input>`',
    v: '`' + FACTS.pasteInput.value + '`',
    d: 'Поле — строка: браузер взял `text/plain`. `data` у `beforeinput` — тот же текст.',
  },
  {
    k: 'вставка в `contenteditable`',
    v: '`<b style="color:red">жирный</b><img src="…/pixel.png">`',
    d: 'Взят `text/html`. Скрипт и `onerror` вырезаны, а стиль и картинка с чужого адреса остались. `data` у `beforeinput` — `null`, текст лежит в `dataTransfer`.',
  },
  {
    k: 'вставка в `contenteditable="plaintext-only"`',
    v: '`' + FACTS.pastePlainOnly.value + '`',
    d: 'Тот же буфер — только текст, без разметки.',
  },
  {
    k: '`dispatchEvent(new ClipboardEvent(\'paste\', …))`',
    v: '`""`',
    d: 'Слушатель получил «фейк» в `clipboardData`, `isTrusted: false`. В поле не попало ничего.',
  },
];

export const PLAIN_CLIPBOARD =
  'Как посылка с двумя вложениями: открытка с картинкой и та же надпись на листке. Поле `<input>` умеет читать только листок. `contenteditable` берёт открытку — со всем, что на ней нарисовано, кроме того, что браузер сам сочтёт опасным.';

export const PASTE_PLAIN_CODE = `editor.addEventListener('paste', (e) => {
  e.preventDefault();                                  // браузерную вставку — отменить
  const text = e.clipboardData.getData('text/plain');  // взять только текст
  // Устаревший, но единственный вызов, который кладёт правку в историю Ctrl+Z.
  document.execCommand('insertText', false, text);
});`;

export const PASTE_NOTE =
  'Отменять вставку в `paste` и вставлять самому — обычный приём редакторов. Через `execCommand(\'insertText\')` правка попадает в историю: Ctrl+Z после неё работает. Если нужен только текст и свой код не нужен вовсе, хватит атрибута `contenteditable="plaintext-only"`.';

// ─── Раздел 6. Запись из кода и каретка ────────────────────────────────────────────────────

export const PROGRAM_ROWS = [
  { k: '`el.value = \'abXcdef\'`', v: FACTS.program.valueChanged, d: 'строка другая — каретка в конец', tone: 'err' as const },
  { k: '`el.value = \'abXcdef\'` ещё раз', v: FACTS.program.valueSame, d: 'та же строка — каретка на месте', tone: 'ok' as const },
  { k: '`setRangeText(\'XY\')`', v: FACTS.program.default, d: 'режим по умолчанию `preserve`: каретка осталась **перед** вставкой', tone: 'warn' as const },
  { k: '`setRangeText(\'XY\', 2, 2, \'end\')`', v: FACTS.program.end, d: 'каретка за вставкой — как при наборе', tone: 'ok' as const },
  { k: '`setRangeText(\'XY\', 2, 2, \'select\')`', v: FACTS.program.select, d: 'вставка выделена', tone: 'info' as const },
  { k: '`setRangeText(\'Q\', 0, 0)`', v: FACTS.program.before, d: 'вставка до каретки — каретка сдвинулась на длину вставки', tone: 'info' as const },
  { k: '`execCommand(\'insertText\', false, \'XY\')`', v: FACTS.program.exec, d: 'как набор: каретка за вставкой, `input` пришёл', tone: 'ok' as const },
].map((r) => ({ ...r, value: '`' + r.v.value + '`', sel: `${r.v.sel[0]}–${r.v.sel[1]}` }));

export const PROGRAM_START = 'Поле `abcdef`, каретка после «ab» (позиция 2).';

export const PROGRAM_NOTE =
  'Ни запись `value`, ни `setRangeText` не порождают ни одного события: ни `beforeinput`, ни `input`. Слушатель, который проверяет поле на `input`, правку из кода не увидит. Пришёл `input` только у `execCommand` — и без `beforeinput` перед ним.';

export const PLAIN_VALUE =
  'Запись `el.value` — как заменить лист в пишущей машинке новым, уже напечатанным. Каретку машинка ставит в конец нового листа: где стояла на старом, она не знает. И отменить замену клавишей «забой» нельзя — для машинки это не правка, а другой лист.';

export const UNDO_ROWS = [
  {
    k: 'набрали «ab», код записал `value = \'xyz\'`, Ctrl+Z',
    v: '`' + FACTS.undoAfterSet.value + '`',
    d: '`beforeinput` и `input` с `historyUndo` пришли, а значение не изменилось: история набора стёрта записью.',
    tone: 'err' as const,
  },
  {
    k: 'набрали «ab», код вставил «Q» через `execCommand`, Ctrl+Z',
    v: FACTS.undoAfterExec.afterUndo === '' ? 'пусто' : '`' + FACTS.undoAfterExec.afterUndo + '`',
    d: 'Правка кода — в истории вместе с набором. Ctrl+Shift+Z вернул `' + FACTS.undoAfterExec.afterRedo + '`.',
    tone: 'ok' as const,
  },
  {
    k: 'набрали «ab», `preventDefault()` в `beforeinput`, Ctrl+Z',
    v: '`' + FACTS.undoCancelled.value + '`',
    d: 'Отмену можно отменить: `historyUndo` — обычный `inputType`.',
    tone: 'info' as const,
  },
];

export const INSERT_CODE = `// Вставить текст в место каретки так, будто его напечатали.
function insertAtCaret(field, text) {
  field.setRangeText(text, field.selectionStart, field.selectionEnd, 'end');
  // setRangeText событий не шлёт — сообщить слушателям самим.
  field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
}`;

export const INSERT_NOTE =
  'Своё событие доходит до слушателей, в том числе до `v-model` и React, но с `isTrusted: false`, и в историю Ctrl+Z правка не попадает. Почему каретка уезжает в контролируемых полях React и Vue и как её вернуть — в [«Формах во фреймворках», раздел «Каретка»](/frameworks/forms/#s4); здесь — то, на чём это стоит: запись `value` в браузере.';

// ─── Раздел 7. Автозаполнение ──────────────────────────────────────────────────────────────

export const AUTOCOMPLETE_ROWS = [
  { t: '`name`, `given-name`, `family-name`', d: 'имя целиком или по частям' },
  { t: '`email`, `tel`', d: 'почта и телефон' },
  { t: '`street-address`, `address-line1`, `address-level2`, `postal-code`, `country`', d: 'адрес: улица, город, индекс, страна' },
  { t: '`cc-name`, `cc-number`, `cc-exp`, `cc-csc`', d: 'карта: имя, номер, срок, код' },
  { t: '`username`', d: 'логин — пара для менеджера паролей' },
  { t: '`current-password`', d: 'пароль при входе: браузер подставит сохранённый' },
  { t: '`new-password`', d: 'пароль при регистрации и смене: браузер предложит сгенерировать и сохранит' },
  { t: '`one-time-code`', d: 'код из SMS или письма: телефоны предлагают его над клавиатурой' },
  { t: '`username webauthn`', d: 'логин с подсказкой passkey в том же списке — см. «Passkeys»' },
  { t: '`off`', d: 'просьба не подсказывать; для адресов браузеры её не всегда слушают' },
];

export const AUTOCOMPLETE_NOTE =
  'Значение атрибута — не произвольное слово, а токен из списка спецификации HTML. Без атрибута Chromium угадывает поле по `name`, `id` и подписи. Поле с выдуманным токеном (`autocomplete="nope-xyz"`) Chromium 153 не заполнил вовсе, а форму с `autocomplete="off"` — заполнил. Как passkey попадает в ту же подсказку, разобрано в [«Passkeys», раздел «Синхронизация и автозаполнение»](/platform/passkeys/#s5).';

/** Полный Chromium 153, адрес из подсказки: события на каждом поле формы. Пересобирается тестом. */
export const AUTOFILL = {
  fields: ['fn', 'email', 'city'],
  values: ['Ivan Petrov', 'ivan@example.com', 'Riga'],
  /** Одно поле: событие, класс объекта, `:autofill` в момент события. */
  perField: [
    { type: 'focus', cls: 'FocusEvent', autofill: false },
    { type: 'keydown', cls: 'Event', autofill: false },
    { type: 'input', cls: 'Event', autofill: true },
    { type: 'change', cls: 'Event', autofill: true },
    { type: 'keyup', cls: 'Event', autofill: true },
    { type: 'blur', cls: 'FocusEvent', autofill: true },
  ],
  /** `document.activeElement` во время событий — фокус на самом деле не двигался. */
  active: 'BODY',
  beforeinput: 0,
  afterEdit: { autofill: false },
  formOff: ['Ivan Petrov', 'ivan@example.com', 'Riga'],
  bogusToken: ['', '', ''],
};

export const AUTOFILL_ROWS = AUTOFILL.perField.map((e) => ({
  ev: e.type,
  cls: e.cls,
  autofill: e.autofill ? 'да' : 'нет',
  what:
    e.type === 'keydown' || e.type === 'keyup'
      ? 'не `KeyboardEvent`: `key` — `undefined`'
      : e.type === 'input'
        ? 'не `InputEvent`: нет `inputType` и `data`; `beforeinput` не было'
        : e.type === 'focus'
          ? 'фокус на самом деле не переходит'
          : '',
}));

export const PLAIN_AUTOFILL =
  'Как курьер, который сам вписал адрес в бланк, пока вы отвернулись. Бланк заполнен, но ручку никто не брал: ни нажатий, ни правок по букве. Об этом говорит только итог — поле с новым значением и пометка «заполнено автоматически».';

export const AUTOFILL_FACTS = [
  {
    t: 'Одна подсказка — вся форма',
    d: 'Человек выбрал адрес в одном поле — Chromium заполнил все поля формы, которые узнал. События идут по полям по очереди, у каждого — свой набор из шести.',
  },
  {
    t: 'Нажатий нет, события есть',
    d: '`keydown` и `keyup` приходят, но это голые `Event` без `key` и `code`. Код вида `e.key.length` в слушателе формы бросит `TypeError` на автозаполнении.',
  },
  {
    t: '`input` без `inputType`',
    d: 'Проверка «если `inputType === \'insertText\'`» автозаполнение пропустит. Надёжный признак — `:autofill`: в момент `input` поле уже ему соответствует.',
  },
  {
    t: '`:autofill` снимается при правке',
    d: 'Человек стёр один символ — поле перестало соответствовать `:autofill`. Подсветка заполненных полей через CSS сама исчезает там, где человек вмешался.',
  },
];

export const AUTOFILL_CODE = `form.addEventListener('input', (e) => {
  const field = e.target;
  // Браузер подставил значение сам: нажатий не было, inputType нет.
  if (field.matches(':autofill')) markFilled(field);
  validate(field);
});`;

// ─── Раздел 8. contenteditable ─────────────────────────────────────────────────────────────

export const CE_ROWS = [
  { k: 'Enter в конце `abc`', t: '`insertParagraph`', html: FACTS.ceEnter.value },
  { k: 'Shift+Enter следом', t: '`insertLineBreak`', html: FACTS.ceShiftEnter.value },
  { k: 'Ctrl+B / Cmd+B по выделенному `abc`', t: '`formatBold`', html: FACTS.ceBold.value },
  { k: 'то же, `preventDefault()` в `beforeinput`', t: '`formatBold`', html: FACTS.ceBoldCancelled.value },
  { k: '`document.execCommand(\'bold\')`', t: '`formatBold` — только `input`', html: FACTS.ceExecBold.value },
].map((r) => ({ ...r, html: '`' + r.html + '`' }));

export const CE_NOTE =
  'Внутри `contenteditable` правка — это изменение дерева DOM, и каждую из них браузер описывает тем же `beforeinput` с `inputType`. Отменить можно любую: и абзац, и жирный. `document.execCommand` — старый способ сделать то же из кода. Спецификация его так и не стала стандартом, MDN помечает его устаревшим, но Chromium 153 его исполняет и шлёт `input` — а `beforeinput` перед ним нет.';

export const NO_FORMAT_CODE = `// Поле комментария: текст и переносы строк, без жирного и курсива.
editor.addEventListener('beforeinput', (e) => {
  if (e.inputType.startsWith('format')) e.preventDefault();
});`;

export const NO_FORMAT_NOTE =
  'Редакторы на `contenteditable` устроены так же, только шире: слушают `beforeinput`, отменяют браузерную правку и делают свою — над собственной моделью документа, а не над HTML, который собрал браузер. Где именно правка, говорит `e.getTargetRanges()`.';

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: '`beforeinput` — намерение, а не правка',
    d: 'Backspace в начале поля и Enter в `<input>` дают `beforeinput`, но поле не меняется и `input` не приходит. Код, который считает правки по `beforeinput`, насчитает лишние.',
    tone: 'warn',
  },
  {
    n: '02',
    t: '`el.value = …` молчит и стирает историю',
    d: 'Ни `input`, ни `beforeinput`. Каретка уезжает в конец, а Ctrl+Z после записи присылает `historyUndo` и ничего не возвращает. Если код правит текст, который человек может захотеть отменить, — `execCommand(\'insertText\')`.',
    tone: 'err',
  },
  {
    n: '03',
    t: 'Enter посреди набора IME',
    d: '`keydown` Enter с `isComposing: true` выбирает слово, а не отправляет форму. Проверка — `e.isComposing || e.keyCode === 229`; второе условие — для Safari, где `compositionend` приходит раньше.',
    tone: 'err',
  },
  {
    n: '04',
    t: 'Горячая клавиша по `key` не работает на русской раскладке',
    d: '`e.key === \'k\'` не сработает, когда у человека включена русская раскладка: там `key` — «л». Сочетания по месту клавиши проверяют по `code`.',
    tone: 'warn',
  },
  {
    n: '05',
    t: 'Фильтр в `beforeinput` пропускает IME',
    d: 'Во время набора `beforeinput` неотменяемый, и `preventDefault()` молча ничего не делает. Чистить значение приходится после `compositionend`.',
    tone: 'err',
  },
  {
    n: '06',
    t: 'Вставка в `contenteditable` приносит чужой HTML',
    d: 'Скрипты и обработчики браузер вырезает, а стили и картинки с чужих адресов оставляет. Картинка начнёт грузиться сразу после вставки. Нужен только текст — `plaintext-only` или своя вставка из `text/plain`.',
    tone: 'warn',
  },
  {
    n: '07',
    t: 'Автозаполнение — не набор',
    d: '`keydown` без `key`, `input` без `inputType`, `beforeinput` нет вовсе. Слушатель, который ждёт нажатий, автозаполнения не заметит или упадёт. Признак — `:autofill` на поле.',
    tone: 'err',
  },
  {
    n: '08',
    t: 'Событие из кода ничего не вставит',
    d: '`dispatchEvent` с `paste` или `keydown` дойдёт до слушателей, но поле не изменится. Чтобы изменить поле из кода, меняют поле — `setRangeText` или `execCommand` — и сообщают об этом сами.',
  },
  {
    n: '09',
    t: '`setRangeText` по умолчанию оставляет каретку перед вставкой',
    d: 'Режим по умолчанию — `preserve`: вставка в место каретки не сдвигает её. Чтобы каретка встала за текстом, как при наборе, — четвёртый аргумент `\'end\'`.',
    tone: 'warn',
  },
];

// ─── Источники ─────────────────────────────────────────────────────────────────────────────

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'W3C — UI Events',
    href: 'https://www.w3.org/TR/uievents/',
    what: 'порядок `keydown` → `beforeinput` → `input` → `keyup`, события composition, `isComposing`, устаревшие `keypress` и `keyCode`, код 229',
  },
  {
    title: 'W3C — UI Events KeyboardEvent code Values',
    href: 'https://www.w3.org/TR/uievents-code/',
    what: 'значения `code`: `KeyA`, `Backspace`, `Enter` — место клавиши без учёта раскладки',
  },
  {
    title: 'W3C — Input Events Level 2',
    href: 'https://www.w3.org/TR/input-events-2/',
    what: 'полный список `inputType`, какие `beforeinput` отменяемые, `getTargetRanges()`',
  },
  {
    title: 'W3C — Clipboard API and events',
    href: 'https://www.w3.org/TR/clipboard-apis/',
    what: 'события `paste`, `copy`, `cut` и `clipboardData`',
  },
  {
    title: 'HTML Standard — Autofill',
    href: 'https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#autofill',
    what: 'токены `autocomplete`: `email`, `new-password`, `one-time-code`, `webauthn`',
  },
  {
    title: 'HTML Standard — APIs for the text control selections',
    href: 'https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#textFieldSelection',
    what: '`selectionStart`, `setRangeText` и его режимы, каретка после записи `value`',
  },
  {
    title: 'execCommand — неофициальный черновик',
    href: 'https://w3c.github.io/editing/docs/execCommand/',
    what: 'команды `insertText`, `bold`; статус «не стандарт»',
  },
  {
    title: 'MDN — Element: keydown event',
    href: 'https://developer.mozilla.org/en-US/docs/Web/API/Element/keydown_event',
    what: 'проверка `isComposing || keyCode === 229` для нажатий во время IME',
  },
  {
    title: 'MDN — :autofill',
    href: 'https://developer.mozilla.org/en-US/docs/Web/CSS/:autofill',
    what: 'псевдокласс автозаполненного поля и его старое имя `:-webkit-autofill`',
  },
  {
    title: 'Chrome DevTools Protocol — Autofill',
    href: 'https://chromedevtools.github.io/devtools-protocol/tot/Autofill/',
    what: '`Autofill.trigger` — как подсказку автозаполнения выбирают из автотеста',
  },
];

export const RELATED =
  'Смежное на сайте: [Формы во фреймворках](/frameworks/forms/) — `v-model`, контролируемые поля, IME и каретка в React и Vue. [События DOM](/render/dom-events/) — фазы, `preventDefault`, `isTrusted`. [Дерево доступности, раздел «Имя»](/render/accessibility-tree/#s4) — как подпись поля доходит до скринридера. [Passkeys, раздел «Синхронизация и автозаполнение»](/platform/passkeys/#s5) — `autocomplete="webauthn"`. [Хранилища браузера, раздел «localStorage и sessionStorage»](/platform/browser-storage/#s2) — где хранить черновик поля. [Debounce, throttle и token bucket](/algorithms/rate-limiting/) — один бюджет событий во времени: обёртки и ограничители. [Отмена и повтор](/algorithms/undo-redo/) — две стопки, снимки и обратные правки, группировка и история `<textarea>`.';
