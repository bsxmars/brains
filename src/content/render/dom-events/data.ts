import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { Scenario } from '@/widgets/event-path-lab/model/types';

/**
 * Данные темы «События DOM: захват, всплытие и делегирование».
 *
 * Тема написана здесь, 2026-10-01, для направления «Браузер и рендеринг».
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * Chromium **153.0.8010.12** (headless shell из Playwright 1.63, `chromium.launch()`),
 * happy-dom **20.14.5**, esbuild 0.28.2, Node 24.11.0, macOS, октябрь 2026. Скрипты стенда —
 * вне проекта, в рабочем каталоге автора темы (`stand1-scenarios.mjs` … `stand5-delegate.mjs`),
 * страницы отдаёт свой `node:http` на localhost.
 *
 * Сквозной пример — `FIXTURE_HTML` и `SHADOW_HTML` ниже. Сценарии (`SCENARIOS`) описаны
 * данными: где висит слушатель, в какой фазе и что делает. Одно и то же описание исполняют
 * три стороны:
 *   — Chromium: модуль `widgets/event-path-lab/model/dom.ts`, собранный esbuild и вставленный
 *     в страницу, — `dispatchEvent` синтетического события; каждый сценарий в новой вкладке.
 *     Итог — `STAND_LOGS` (журнал строками: `прогон:слушатель currentTarget eventPhase target
 *     | composedPath()`);
 *   — Chromium, настоящий клик: те же слушатели, событие — `page.mouse.click` по центру цели.
 *     Для всех девяти сценариев с `click` журнал совпал с синтетическим строка в строку
 *     (`REAL_CLICK_SAME`), `isTrusted` — `true` у каждой записи;
 *   — учебная модель `DISPATCH_CODE` (`model/run.ts`) и happy-dom — в тесте.
 *
 * Отдельные пробы Chromium (`stand2-extra.mjs` … `stand5-delegate.mjs`): микрозадачи при
 * настоящем клике, `el.click()` и `dispatchEvent` (`MICRO_ROWS`); какие события приходят при
 * настоящем клике и при `el.click()` (`CLICK_SEQUENCE`); `focus`/`focusin`; действия по
 * умолчанию у флажка и ссылки (`DEFAULT_TIMELINE`); отправка формы пятью способами
 * (`SUBMIT_ROWS`); состояние события после отправки и повторная отправка (`AFTER_FACTS`);
 * список слушателей во время отправки (`LIST_STAND`); колесо и касания — пассивные слушатели
 * (`PASSIVE_ROWS`, сообщения консоли `PASSIVE_CONSOLE` — сняты подпиской Playwright на
 * `console` и CDP `Log.entryAdded`); делегирование (`DELEGATE_STAND`). Касания — CDP
 * `Input.dispatchTouchEvent` в контексте с `hasTouch: true`.
 *
 * Не снято: предупреждение `[Violation] Added non-passive event listener to a scroll-blocking …`
 * в консоль стенда не пришло ни через `console`, ни через `Log.startViolationsReport` — оно
 * показывается в DevTools с уровнем Verbose; в тексте о нём не говорится. Firefox и Safari
 * стенд не снимал. Что в Chromium до версии 89 слушатели на самой цели шли в порядке
 * добавления, без деления на захват и всплытие, — по документации (Chrome Platform Status),
 * в тексте сказано без номера версии. Что браузерные клики, клавиши, ввод и фокус создаются с
 * `composed: true`, — по спецификации UI Events; стенд проверил это только для `click`.
 * React и Solid в `DELEGATE_FACTS` — по темам «React изнутри» и «Компиляторы фреймворков»
 * этого сайта, стендом здесь не проверялись.
 *
 * Тест `tests/unit/dom-events.test.ts` прогоняет `DISPATCH_CODE` (та же строка, что на
 * странице и в демо) по всем сценариям и сверяет журналы с `STAND_LOGS`; тот же модуль
 * `dom.ts` исполняет сценарии в happy-dom и сверяет совпадения и расхождения (`HAPPY_ROWS`);
 * `DELEGATE_CODE` и `CANCEL_CODE` исполняются в happy-dom. Сам браузер в тесте не поднимается:
 * стенд перезапускается руками, если сменится Chromium.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'событие и слушатель',
    d: 'Событие — объект, который браузер (или ваш код) отправляет узлу: «по тебе кликнули», «нажата клавиша». Слушатель — функция, которую повесили на узел через `addEventListener` и которую вызовут, когда событие пройдёт через этот узел.',
  },
  {
    k: '`target` и `currentTarget`',
    d: '`target` — узел, на котором событие случилось: самый глубокий элемент под курсором. `currentTarget` — узел, чей слушатель вызван прямо сейчас. Пока событие идёт по дереву, первый стоит на месте, а второй меняется.',
  },
  {
    k: 'захват и всплытие',
    d: 'Два прохода события по дереву. Захват (capture) — сверху вниз, от окна к цели. Всплытие (bubbling) — обратно, от цели к окну. Слушатель сам выбирает проход: по умолчанию — всплытие, с `{ capture: true }` — захват.',
  },
  {
    k: 'действие по умолчанию',
    d: 'То, что браузер делает сам после события: переходит по ссылке, ставит галочку, отправляет форму, печатает букву в поле. `preventDefault()` его отменяет — если событие это разрешает.',
  },
  {
    k: 'синтетическое событие',
    d: 'Событие, созданное кодом: `new MouseEvent(\'click\')` + `dispatchEvent`, или `el.click()`. У него `isTrusted === false`, а у события от пользователя — `true`.',
  },
  {
    k: 'Shadow DOM, хозяин',
    d: 'Теневое дерево — кусок DOM, спрятанный внутри элемента-хозяина (host). Снаружи его узлы не видны селекторам, и события, выходя наружу, тоже их прячут.',
  },
];

export const PLAIN_EVENT =
  'Как письмо в многоэтажном доме с вахтёрами. Письмо адресовано квартире на седьмом этаже. Сначала его несут сверху вниз мимо вахтёра у подъезда, потом мимо консьержа на этаже — каждый может прочитать адрес и даже задержать письмо. Потом его вручают жильцу. А дальше по той же лестнице проходит уведомление «вручено» — обратно вверх, мимо тех же людей. Захват — дорога вниз, всплытие — обратно.';

export const PREREQ_NOTE =
  'Тема опирается на три вещи из других тем и на одну, которая объяснена прямо на карточке.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'DOM — дерево узлов',
    d: 'У каждого элемента один родитель: `b` лежит в `button`, тот в `li`, тот в `ul`, и так до `html`. Над `html` стоит `document`, а над ним, для событий, — `window`. Путь события — это цепочка родителей.',

    tone: 'info',
  },
  {
    t: 'Колбэк и его `this`',
    d: 'Слушатель — обычный колбэк: его вызывает браузер, а не вы. `this` внутри функции-слушателя равен `currentTarget`, у стрелочной — внешнему `this`.',
    href: '/js/callbacks/#s4',
    hrefLabel: '«Колбэки», раздел «this в колбэке»',
    tone: 'info',
  },
  {
    t: 'Задача и микрозадача',
    d: 'Нужно для раздела про синхронную отправку. Микрозадачи (`then`, `queueMicrotask`) выполняются, когда пустеет стек вызовов, — а не «после задачи».',
    href: '/js/event-loop/#s3',
    hrefLabel: '«Event Loop», раздел «Checkpoint»',
    tone: 'info',
  },
  {
    t: 'Теневое дерево',
    d: 'Нужно для раздела про Shadow DOM. Элемент может спрятать внутри себя отдельное дерево через `attachShadow`; селекторы страницы туда не проходят.',
    href: '/render/web-components-styles/#s1',
    hrefLabel: '«Стили веб-компонентов», раздел «Граница»',
    tone: 'info',
  },
];

// ─── Раздел 1. Путь и три фазы ─────────────────────────────────────────────────────────────

/** Сквозной пример. Демо, стенд и тест строят дерево ровно из этих строк. */
export const FIXTURE_HTML = `<ul class="todos">
  <li>
    <button class="del">Удалить <b>×</b></button>
  </li>
</ul>
<like-button></like-button>`;

export const SHADOW_HTML = '<button class="heart">♥</button>';

/** Печатается под разметкой: так `like-button` получает теневое дерево. Тест сверяет с `SHADOW_HTML`. */
export const SHADOW_CODE = `const host = document.querySelector('like-button');
host.attachShadow({ mode: 'open' }).innerHTML = '${SHADOW_HTML}';`;

export const FIXTURE_NOTE =
  'Подписи узлов в журналах темы — тег и первый класс: `ul.todos`, `button.del`, `b`. Клик по крестику — это клик по `b`: он самый глубокий элемент под курсором, и он станет `target`.';

export const PLAIN_PATH =
  'Путь — это маршрут, проложенный до отправки. Курьер получил адрес и записал на листке все этажи от крыши до квартиры. Если по дороге кто-то снесёт этаж, курьер всё равно пройдёт по своему листку: маршрут не пересчитывается.';

export const PATH_STEPS = [
  {
    k: '1. Путь',
    d: 'Браузер берёт цель и поднимается по родителям: `b → button.del → li → ul.todos → body → html → document → window`. Список составляется один раз, до первого слушателя, — его и возвращает `event.composedPath()`.',
  },
  {
    k: '2. Захват',
    d: 'Проход по пути с конца: `window`, `document`, … `li`. Вызываются слушатели с `capture: true`. `eventPhase` равен `1` — `CAPTURING_PHASE`.',
  },
  {
    k: '3. Цель',
    d: 'На самой цели `eventPhase` равен `2` — `AT_TARGET`, и вызываются все её слушатели: сначала с `capture: true`, потом остальные.',
  },
  {
    k: '4. Всплытие',
    d: 'Проход в обратную сторону: `button.del`, `li`, … `window`. Вызываются слушатели без `capture`. `eventPhase` равен `3` — `BUBBLING_PHASE`. Если у события `bubbles: false`, этого прохода нет.',
  },
];

export const PHASE_NAMES: Record<number, string> = { 0: 'NONE', 1: 'захват', 2: 'цель', 3: 'всплытие' };

export const ORDER_FACTS = [
  {
    t: 'На цели захват идёт первым — даже если добавлен вторым',
    d: 'На `b` слушатель `L9` без `capture` добавлен раньше `L10` с `capture: true`. Chromium всё равно вызвал `L10` первым: на цели слушатели делятся на те же два прохода. Старые браузеры вызывали их на цели в порядке добавления; нынешний порядок — по спецификации DOM.',
  },
  {
    t: 'На одном узле — в порядке добавления',
    d: 'Внутри одного прохода слушатели узла вызываются в том порядке, в каком их добавили. Тот же колбэк с тем же `capture` второй раз не добавится — `addEventListener` молча пропустит дубль. С другим `capture` — это уже второй слушатель.',
  },
  {
    t: '`bubbles: false` — захват всё равно есть',
    d: 'Событие без всплытия не «стоит на месте». Слушатели захвата на предках его видят, а со всплытием не увидит никто, кроме самой цели. Так ведёт себя `focus`: на стенде слушатель `document` с захватом его получил, без захвата — нет. Всплывающий двойник — `focusin`.',
  },
];

/** Фокус на поле ввода в Chromium: какие слушатели `document` сработали. */
export const FOCUS_STAND = ['focus захват', 'focusin захват', 'focusin всплытие'];

// ─── Раздел 2. Отправка как код ────────────────────────────────────────────────────────────

export const DISPATCH_CODE = `const NONE = 0, CAPTURING_PHASE = 1, AT_TARGET = 2, BUBBLING_PHASE = 3;

// Узел дерева: окно, документ, элемент или теневой корень.
function node(name, parent, kind = 'element') {
  return { name, kind, parent, listeners: [] };
}

function attachShadow(host, mode) {
  const root = node('#shadow-root', null, 'shadow-root');
  root.host = host;
  root.mode = mode;
  return root;
}

function rootOf(n) {
  while (n.parent) n = n.parent;
  return n;
}

// a — предок b (или сам b), если считать теневой корень дочерним у хозяина.
function isAncestor(a, b) {
  for (let n = b; n; n = n.parent ?? n.host) if (n === a) return true;
  return false;
}

// Какую цель увидит слушатель на узле at: пока цель спрятана
// в теневом дереве, которого at не видит, её подменяет хозяин.
function retarget(target, at) {
  let root = rootOf(target);
  while (root.kind === 'shadow-root' && !isAncestor(root, at)) {
    target = root.host;
    root = rootOf(target);
  }
  return target;
}

// Узел спрятан от наблюдателя, если лежит в закрытом теневом дереве,
// внутри которого наблюдателя нет.
function hiddenFrom(n, from) {
  const root = rootOf(n);
  if (root.kind !== 'shadow-root' || isAncestor(root, from)) return false;
  return root.mode === 'closed' || hiddenFrom(root.host, from);
}

function getParent(n, event, start) {
  if (n.kind === 'shadow-root') {
    // composed: false — событие не выходит из того теневого дерева, где родилось.
    return !event.composed && n === rootOf(start) ? null : n.host;
  }
  if (n.kind === 'document') return n.window;
  return n.parent;
}

function createEvent(type, { bubbles = false, cancelable = false, composed = false } = {}) {
  return {
    type, bubbles, cancelable, composed, isTrusted: false,
    target: null, currentTarget: null, eventPhase: NONE,
    defaultPrevented: false, path: [],
    stop: false, stopImmediate: false, inPassive: false,
    stopPropagation() { this.stop = true; },
    stopImmediatePropagation() { this.stop = this.stopImmediate = true; },
    preventDefault() {
      // Без cancelable и внутри пассивного слушателя отмена молча не действует.
      if (this.cancelable && !this.inPassive) this.defaultPrevented = true;
    },
    composedPath() {
      if (!this.currentTarget) return [];
      return this.path.filter((n) => !hiddenFrom(n, this.currentTarget));
    },
  };
}

// Пассивность по умолчанию: колесо и касания на окне, документе, html и body.
function defaultPassive(n, type) {
  if (!['wheel', 'mousewheel', 'touchstart', 'touchmove'].includes(type)) return false;
  return n.kind === 'window' || n.kind === 'document' || n.name === 'html' || n.name === 'body';
}

function addEventListener(n, type, callback, options = {}) {
  const { capture = false, once = false, signal } = options;
  const passive = options.passive ?? defaultPassive(n, type);
  if (signal?.aborted) return;
  // Тот же колбэк с тем же capture второй раз не добавляется.
  if (n.listeners.some((l) => l.type === type && l.callback === callback && l.capture === capture)) return;
  const l = { type, callback, capture, once, passive, removed: false };
  n.listeners.push(l);
  signal?.addEventListener('abort', () => removeEventListener(n, type, callback, { capture }));
}

function removeEventListener(n, type, callback, { capture = false } = {}) {
  const l = n.listeners.find((x) => x.type === type && x.callback === callback && x.capture === capture);
  if (!l) return;
  l.removed = true;            // уже идущая отправка его пропустит
  n.listeners = n.listeners.filter((x) => x !== l);
}

function invoke(n, target, phase, event, pass) {
  event.target = target;
  if (event.stop) return;
  event.currentTarget = n;
  event.eventPhase = phase;
  // Копия списка: слушатель, добавленный во время отправки, в ней не участвует.
  for (const l of n.listeners.slice()) {
    if (l.removed || l.type !== event.type) continue;
    if (pass === 'capture' ? !l.capture : l.capture) continue;
    if (l.once) removeEventListener(n, l.type, l.callback, l);
    event.inPassive = l.passive;
    l.callback.call(n, event);
    event.inPassive = false;
    if (event.stopImmediate) return;
  }
}

function dispatch(target, event) {
  // 1. Путь считается один раз, до первого слушателя.
  event.path = [];
  for (let n = target; n; n = getParent(n, event, target)) event.path.push(n);

  // 2. Захват: от окна вниз. На самой цели — слушатели с capture: true.
  for (let i = event.path.length - 1; i >= 0; i--) {
    const at = event.path[i], t = retarget(target, at);
    invoke(at, t, t === at ? AT_TARGET : CAPTURING_PHASE, event, 'capture');
  }

  // 3. Всплытие: от цели вверх. На цели — остальные слушатели,
  //    выше — только если bubbles: true.
  for (const at of event.path) {
    const t = retarget(target, at);
    if (t === at) invoke(at, t, AT_TARGET, event, 'bubble');
    else if (event.bubbles) invoke(at, t, BUBBLING_PHASE, event, 'bubble');
  }

  // 4. Уборка. Цель из теневого дерева наружу не отдаётся.
  event.eventPhase = NONE;
  event.currentTarget = null;
  event.path = [];
  if (rootOf(event.target).kind === 'shadow-root') event.target = null;
  event.stop = event.stopImmediate = false;
  return !event.defaultPrevented;
}`;

export const DISPATCH_NOTE =
  'Сто сорок строк вместо спецификации — и всё же это тот самый алгоритм: путь до вызовов, два прохода, копия списка слушателей, флаги остановки, проверка `cancelable` и пассивности, подмена цели на границе теневого дерева. Не смоделированы `relatedTarget`, слоты и действия по умолчанию.';

const CLICK = { type: 'click', bubbles: true, cancelable: true, composed: true };
const PING = { type: 'ping', bubbles: true, cancelable: false, composed: false };

export const SCENARIOS: Scenario[] = [
  {
    id: 'phases',
    label: 'Три фазы',
    target: 'b',
    event: CLICK,
    shadow: 'open',
    listeners: [
      { id: 'L1', at: 'window', capture: true },
      { id: 'L2', at: 'window' },
      { id: 'L3', at: 'document', capture: true },
      { id: 'L4', at: 'document' },
      { id: 'L5', at: 'ul.todos', capture: true },
      { id: 'L6', at: 'ul.todos' },
      { id: 'L7', at: 'li', capture: true },
      { id: 'L8', at: 'li' },
      { id: 'L9', at: 'b' },
      { id: 'L10', at: 'b', capture: true },
    ],
    note: 'Клик по `b`. Захват идёт сверху вниз, на цели первым вызывается `L10`, хотя добавлен последним, потом всплытие снизу вверх. `target` всё время `b`, меняется только `currentTarget`.',
  },
  {
    id: 'no-bubble',
    label: 'bubbles: false',
    target: 'b',
    event: { ...PING, bubbles: false },
    shadow: 'open',
    listeners: [
      { id: 'L1', at: 'document', capture: true },
      { id: 'L2', at: 'li', capture: true },
      { id: 'L3', at: 'b' },
      { id: 'L4', at: 'li' },
      { id: 'L5', at: 'document' },
    ],
    note: 'Своё событие `ping` без всплытия. Захват дошёл до цели, а обратно событие не пошло: `L4` и `L5` на всплытии не вызваны.',
  },
  {
    id: 'stop',
    label: 'stopPropagation',
    target: 'b',
    event: CLICK,
    shadow: 'open',
    listeners: [
      { id: 'L1', at: 'li', act: 'stop' },
      { id: 'L2', at: 'li' },
      { id: 'L3', at: 'ul.todos' },
      { id: 'L4', at: 'document' },
    ],
    note: '`L1` на `li` остановил распространение. Сосед по узлу `L2` всё равно вызван, а до `ul.todos` и `document` событие не дошло.',
  },
  {
    id: 'stop-immediate',
    label: 'stopImmediatePropagation',
    target: 'b',
    event: CLICK,
    shadow: 'open',
    listeners: [
      { id: 'L1', at: 'li', act: 'stopImmediate' },
      { id: 'L2', at: 'li' },
      { id: 'L3', at: 'ul.todos' },
      { id: 'L4', at: 'document' },
    ],
    note: 'То же место, другой вызов: `stopImmediatePropagation` не пускает событие и к соседям по узлу. После `L1` не вызван никто.',
  },
  {
    id: 'stop-capture',
    label: 'Стоп на захвате',
    target: 'b',
    event: CLICK,
    shadow: 'open',
    listeners: [
      { id: 'L1', at: 'document', capture: true, act: 'stop' },
      { id: 'L2', at: 'document', capture: true },
      { id: 'L3', at: 'b' },
      { id: 'L4', at: 'document' },
    ],
    note: 'Остановка на захвате у `document`: цель не узнала о клике вовсе. Так работают «глушилки» кликов — и так же легко сломать чужой код.',
  },
  {
    id: 'prevent',
    label: 'preventDefault',
    target: 'b',
    event: CLICK,
    shadow: 'open',
    listeners: [
      { id: 'L1', at: 'li', act: 'prevent' },
      { id: 'L2', at: 'document' },
    ],
    note: '`preventDefault` не останавливает распространение: `L2` вызван и видит `defaultPrevented: true`. `dispatchEvent` вернул `false` — «кто-то отменил».',
  },
  {
    id: 'not-cancelable',
    label: 'cancelable: false',
    target: 'b',
    event: PING,
    shadow: 'open',
    listeners: [
      { id: 'L1', at: 'li', act: 'prevent' },
      { id: 'L2', at: 'document' },
    ],
    note: 'Своё событие без `cancelable`. `preventDefault` вызван, но ничего не изменил: `defaultPrevented` остался `false`, ошибки нет.',
  },
  {
    id: 'passive',
    label: 'passive',
    target: 'b',
    event: { type: 'wheel', bubbles: true, cancelable: true, composed: true },
    shadow: 'open',
    listeners: [
      { id: 'L1', at: 'li', passive: true, act: 'prevent' },
      { id: 'L2', at: 'body', act: 'prevent' },
      { id: 'L3', at: 'document' },
    ],
    note: 'Событие `wheel`. `L1` объявлен пассивным, `L2` на `body` — без опций, но для колеса на `body` пассивность включена по умолчанию. Оба `preventDefault` проигнорированы.',
  },
  {
    id: 'once',
    label: 'once',
    target: 'b',
    event: CLICK,
    shadow: 'open',
    times: 2,
    listeners: [
      { id: 'L1', at: 'li', once: true },
      { id: 'L2', at: 'li' },
    ],
    note: 'Два клика подряд. `L1` с `once: true` снят перед своим первым вызовом и во второй отправке не участвует.',
  },
  {
    id: 'mutate',
    label: 'Правка во время отправки',
    target: 'b',
    event: CLICK,
    shadow: 'open',
    listeners: [
      { id: 'L1', at: 'b', act: 'detachLi' },
      { id: 'L2', at: 'b', act: 'removeL3' },
      { id: 'L3', at: 'ul.todos' },
      { id: 'L4', at: 'document' },
    ],
    note: '`L1` удаляет `li` из документа, `L2` снимает слушателя `L3`. Путь посчитан заранее, поэтому `document` клик получил, а `composedPath()` по-прежнему содержит `li` и `ul.todos`. `L3` не вызван: снятый слушатель пропускается и в идущей отправке.',
  },
  {
    id: 'shadow-open',
    label: 'Shadow DOM',
    target: 'button.heart',
    event: CLICK,
    shadow: 'open',
    listeners: [
      { id: 'L1', at: 'button.heart' },
      { id: 'L2', at: '#shadow-root' },
      { id: 'L3', at: 'like-button' },
      { id: 'L4', at: 'document' },
    ],
    note: 'Клик по сердечку внутри `like-button`. Внутри теневого дерева `target` — `button.heart`, снаружи — сам хозяин. Для хозяина это фаза «цель», `eventPhase` 2.',
  },
  {
    id: 'shadow-closed',
    label: 'Закрытый корень',
    target: 'button.heart',
    event: CLICK,
    shadow: 'closed',
    listeners: [
      { id: 'L1', at: 'button.heart' },
      { id: 'L2', at: '#shadow-root' },
      { id: 'L3', at: 'like-button' },
      { id: 'L4', at: 'document' },
    ],
    note: 'То же с `mode: \'closed\'`. Порядок вызовов прежний, но `composedPath()` снаружи начинается с `like-button`: внутренние узлы закрытого дерева из него вырезаны.',
  },
  {
    id: 'uncomposed',
    label: 'composed: false',
    target: 'button.heart',
    event: PING,
    shadow: 'open',
    listeners: [
      { id: 'L1', at: 'button.heart' },
      { id: 'L2', at: '#shadow-root' },
      { id: 'L3', at: 'like-button' },
      { id: 'L4', at: 'document' },
    ],
    note: 'Своё событие без `composed`. Путь кончается на теневом корне: хозяин и `document` его не слышат. После отправки `event.target` — `null`, чтобы ссылка на внутренний узел не утекла наружу.',
  },
];

export const DEMO_CAPTION =
  'Журнал считает функция `dispatch` из этого раздела — та же строка, что напечатана на странице. Рядом тот же сценарий исполняет ваш браузер: настоящий `dispatchEvent` в скрытом `iframe` с той же разметкой. Тест темы сверяет модель с журналами Chromium по всем тринадцати сценариям.';

// ─── Литералы стенда ───────────────────────────────────────────────────────────────────────

export interface StandLog {
  log: string[];
  returned: boolean[];
  defaultPrevented: boolean[];
  targetAfter: (string | null)[];
}

export const STAND_LOGS: Record<string, StandLog> = {
  'phases': {
    log: [
      '0:L1 window 1 b | b button.del li ul.todos body html document window',
      '0:L3 document 1 b | b button.del li ul.todos body html document window',
      '0:L5 ul.todos 1 b | b button.del li ul.todos body html document window',
      '0:L7 li 1 b | b button.del li ul.todos body html document window',
      '0:L10 b 2 b | b button.del li ul.todos body html document window',
      '0:L9 b 2 b | b button.del li ul.todos body html document window',
      '0:L8 li 3 b | b button.del li ul.todos body html document window',
      '0:L6 ul.todos 3 b | b button.del li ul.todos body html document window',
      '0:L4 document 3 b | b button.del li ul.todos body html document window',
      '0:L2 window 3 b | b button.del li ul.todos body html document window',
    ],
    returned: [true],
    defaultPrevented: [false],
    targetAfter: ['b'],
  },
  'no-bubble': {
    log: [
      '0:L1 document 1 b | b button.del li ul.todos body html document window',
      '0:L2 li 1 b | b button.del li ul.todos body html document window',
      '0:L3 b 2 b | b button.del li ul.todos body html document window',
    ],
    returned: [true],
    defaultPrevented: [false],
    targetAfter: ['b'],
  },
  'stop': {
    log: [
      '0:L1 li 3 b | b button.del li ul.todos body html document window',
      '0:L2 li 3 b | b button.del li ul.todos body html document window',
    ],
    returned: [true],
    defaultPrevented: [false],
    targetAfter: ['b'],
  },
  'stop-immediate': {
    log: [
      '0:L1 li 3 b | b button.del li ul.todos body html document window',
    ],
    returned: [true],
    defaultPrevented: [false],
    targetAfter: ['b'],
  },
  'stop-capture': {
    log: [
      '0:L1 document 1 b | b button.del li ul.todos body html document window',
      '0:L2 document 1 b | b button.del li ul.todos body html document window',
    ],
    returned: [true],
    defaultPrevented: [false],
    targetAfter: ['b'],
  },
  'prevent': {
    log: [
      '0:L1 li 3 b prevented | b button.del li ul.todos body html document window',
      '0:L2 document 3 b prevented | b button.del li ul.todos body html document window',
    ],
    returned: [false],
    defaultPrevented: [true],
    targetAfter: ['b'],
  },
  'not-cancelable': {
    log: [
      '0:L1 li 3 b | b button.del li ul.todos body html document window',
      '0:L2 document 3 b | b button.del li ul.todos body html document window',
    ],
    returned: [true],
    defaultPrevented: [false],
    targetAfter: ['b'],
  },
  'passive': {
    log: [
      '0:L1 li 3 b | b button.del li ul.todos body html document window',
      '0:L2 body 3 b | b button.del li ul.todos body html document window',
      '0:L3 document 3 b | b button.del li ul.todos body html document window',
    ],
    returned: [true],
    defaultPrevented: [false],
    targetAfter: ['b'],
  },
  'once': {
    log: [
      '0:L1 li 3 b | b button.del li ul.todos body html document window',
      '0:L2 li 3 b | b button.del li ul.todos body html document window',
      '1:L2 li 3 b | b button.del li ul.todos body html document window',
    ],
    returned: [true,true],
    defaultPrevented: [false,false],
    targetAfter: ['b','b'],
  },
  'mutate': {
    log: [
      '0:L1 b 2 b | b button.del li ul.todos body html document window',
      '0:L2 b 2 b | b button.del li ul.todos body html document window',
      '0:L4 document 3 b | b button.del li ul.todos body html document window',
    ],
    returned: [true],
    defaultPrevented: [false],
    targetAfter: ['b'],
  },
  'shadow-open': {
    log: [
      '0:L1 button.heart 2 button.heart | button.heart #shadow-root like-button body html document window',
      '0:L2 #shadow-root 3 button.heart | button.heart #shadow-root like-button body html document window',
      '0:L3 like-button 2 like-button | button.heart #shadow-root like-button body html document window',
      '0:L4 document 3 like-button | button.heart #shadow-root like-button body html document window',
    ],
    returned: [true],
    defaultPrevented: [false],
    targetAfter: ['like-button'],
  },
  'shadow-closed': {
    log: [
      '0:L1 button.heart 2 button.heart | button.heart #shadow-root like-button body html document window',
      '0:L2 #shadow-root 3 button.heart | button.heart #shadow-root like-button body html document window',
      '0:L3 like-button 2 like-button | like-button body html document window',
      '0:L4 document 3 like-button | like-button body html document window',
    ],
    returned: [true],
    defaultPrevented: [false],
    targetAfter: ['like-button'],
  },
  'uncomposed': {
    log: [
      '0:L1 button.heart 2 button.heart | button.heart #shadow-root',
      '0:L2 #shadow-root 3 button.heart | button.heart #shadow-root',
    ],
    returned: [true],
    defaultPrevented: [false],
    targetAfter: [null],
  },
};

export const REAL_CLICK_SAME = ['phases','stop','stop-immediate','stop-capture','prevent','once','mutate','shadow-open','shadow-closed'];

/** Строки таблицы «три фазы» — из журнала Chromium для сценария `phases`. */
export const PHASE_ROWS = STAND_LOGS.phases.log.map((line) => {
  const [head] = line.split(' | ');
  const [, id, node, phase] = /^\d+:(\S+) (\S+) (\d) /.exec(head) ?? [];
  const spec = SCENARIOS[0].listeners.find((l) => l.id === id);
  return {
    id,
    node,
    capture: spec?.capture ? '`capture: true`' : '—',
    phase: `${phase} — ${PHASE_NAMES[Number(phase)]}`,
  };
});

// ─── Раздел 3. Остановки и список слушателей ───────────────────────────────────────────────

export const STOP_ROWS = [
  {
    k: '`stopPropagation()`',
    v: 'Дальше по пути не идти. Остальные слушатели **этого же узла** ещё вызываются.',
    tone: 'warn' as const,
  },
  {
    k: '`stopImmediatePropagation()`',
    v: 'Не идти дальше и не вызывать оставшихся слушателей узла. Кто добавлен раньше — уже отработал.',
    tone: 'err' as const,
  },
  {
    k: '`preventDefault()`',
    v: 'Не трогает путь вовсе: событие идёт дальше, все слушатели его видят. Отменяет только действие браузера.',
    tone: 'ok' as const,
  },
  {
    k: '`return false`',
    v: 'В `addEventListener` не значит ничего. Отменяет действие только в свойстве-обработчике вроде `onclick = …` — пережиток старого API.',
    tone: undefined,
  },
];

export const PLAIN_STOP =
  'Остановка — это не «отменить клик», а «никому выше не рассказывать». Как сотрудник, который принял звонок и не стал переводить его на начальника. Клик при этом уже случился, и браузер выполнит своё действие, если его не отменили отдельно.';

/**
 * Chromium: один колбэк добавлен дважды и третий раз с `capture: true`; слушатель `A` с `once`
 * при первом вызове добавляет ещё по слушателю на ту же кнопку и на `body`.
 */
export const LIST_STAND = {
  first: ['same', 'same', 'A', 'добавлен на body'],
  second: ['same', 'same', 'добавлен на btn', 'добавлен на body'],
};

export const LIST_CODE = `const same = () => log.push('same');
btn.addEventListener('click', same);
btn.addEventListener('click', same);                     // дубль — пропущен
btn.addEventListener('click', same, { capture: true });  // другой capture — второй слушатель

btn.addEventListener('click', () => {
  log.push('A');
  btn.addEventListener('click', () => log.push('добавлен на btn'));
  document.body.addEventListener('click', () => log.push('добавлен на body'));
}, { once: true });

btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
// ['same', 'same', 'A', 'добавлен на body']
btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
// ['same', 'same', 'добавлен на btn', 'добавлен на body']`;

export const LIST_NOTE =
  'Список слушателей узла копируется, когда событие до узла дошло. Добавленный на `btn` во время своей же отправки опоздал: копия уже снята. А `body` событие ещё не прошло — новый слушатель попал в его копию и сработал сразу. Снятый слушатель, наоборот, пропускается немедленно: у него стоит пометка «удалён», и копия её видит.';

export const ONCE_SIGNAL_NOTE =
  '`once: true` снимает слушателя **перед** его первым вызовом. `signal` снимает всех слушателей, добавленных с этим сигналом, одним `controller.abort()`; если сигнал уже отменён, `addEventListener` ничего не добавит. Как устроена отмена через `AbortController` и почему её понимает не каждый API — [«Колбэки», раздел «Отмена»](/js/callbacks/#s8).';

// ─── Раздел 4. Действие по умолчанию ───────────────────────────────────────────────────────

export const DEFAULT_TIMELINE = {
  plain: [
    'в слушателе checked=true',
    'после: checked=true',
    'в слушателе hash=',
    'document, всплытие: hash=""',
    'после: hash="#done"',
  ],
  prevent: [
    'в слушателе checked=true',
    'после: checked=false',
    'в слушателе hash=',
    'document, всплытие: hash=""',
    'после: hash=""',
  ],
};

export const DEFAULT_ROWS = [
  {
    k: 'ссылка `href="#done"`',
    v: 'Во время всплытия до `document` адрес ещё старый, `#done` появляется **после** отправки. Отменили — не появляется.',
  },
  {
    k: 'флажок',
    v: 'Исключение: галочка ставится **до** слушателей — внутри них `checked` уже `true`. Если кто-то вызвал `preventDefault`, после отправки браузер возвращает её назад.',
  },
];

export const DEFAULT_NOTE =
  'Отсюда правило: действие по умолчанию — отдельный шаг после того, как событие обошло весь путь. Отменить его может любой слушатель на любом узле и в любой фазе, пока отправка не кончилась. Отменить из `setTimeout` или после `await` уже нельзя — действие выполнено.';

export const SUBMIT_ROWS = [
  { k: 'настоящий клик по кнопке', ev: '`submit`, `isTrusted: true`, `submitter` — кнопка', go: 'да', tone: 'ok' as const },
  { k: '`button.click()`', ev: '`submit`, `isTrusted: true`, `submitter` — кнопка', go: 'да', tone: 'ok' as const },
  { k: '`form.requestSubmit()`', ev: '`submit`, `isTrusted: true`', go: 'да', tone: 'ok' as const },
  { k: '`form.submit()`', ev: 'события нет вовсе', go: 'да, мимо слушателей и проверки полей', tone: 'warn' as const },
  { k: '`dispatchEvent(new Event(\'submit\'))`', ev: '`submit`, `isTrusted: false`', go: '**нет**', tone: 'err' as const },
];

export const SYNTH_FACTS = [
  {
    t: 'Синтетический `click` делает то же, что настоящий',
    d: 'На стенде `el.click()` и `dispatchEvent(new MouseEvent(\'click\'))` поставили галочку и перешли по ссылке так же, как `page.mouse.click`. Клик — особый случай: у элементов есть «поведение активации», и спецификация запускает его для любого `MouseEvent` с типом `click`, кем бы он ни был создан. Простой `new Event(\'click\')` галочку не поставил.',
  },
  {
    t: 'Остальные синтетические события ничего не делают',
    d: 'Отправленный `submit` не отправил форму, `keydown` с `key: \'a\'` не напечатал букву в поле: значение осталось пустым. Настоящая клавиша — напечатала. Событие от кода — это сообщение слушателям, а не команда браузеру.',
    tone: 'warn' as const,
  },
  {
    t: '`isTrusted` нельзя подделать',
    d: 'Свойство только для чтения, и `new Event` всегда даёт `false`. Но браузер ставит `true` и событиям, которые сам породил из вызова кода: `submit` после `requestSubmit()` или после `button.click()` пришёл с `isTrusted: true`.',
  },
];

export const CANCEL_CODE = `// Своё отменяемое событие: «спросить разрешения» у всех, кто выше.
const ok = button.dispatchEvent(new CustomEvent('todo:remove', {
  bubbles: true,
  cancelable: true,   // без этого preventDefault молча не сработает
  detail: { title: 'Купить молоко' },
}));
if (ok) button.closest('li').remove();   // никто не отменил`;

export const CANCEL_NOTE =
  '`dispatchEvent` возвращает `!event.defaultPrevented`: `true`, если никто не отменил. На этом строятся свои «действия по умолчанию»: компонент отправляет событие, и любой предок может сказать «не надо». `cancelable` для `new Event` и `new CustomEvent` по умолчанию `false`.';

// ─── Раздел 5. Делегирование ───────────────────────────────────────────────────────────────

export const DELEGATE_CODE = `const list = document.querySelector('ul.todos');

// Один слушатель на весь список — в том числе для пунктов, которых ещё нет.
list.addEventListener('click', (event) => {
  const button = event.target.closest('button.del');
  if (!button || !list.contains(button)) return;   // клик мимо кнопки
  button.closest('li').remove();
});

// Пункт, добавленный позже, работает без своего слушателя.
list.insertAdjacentHTML('beforeend', '<li><button class="del">Удалить <b>×</b></button></li>');`;

export const PLAIN_DELEGATION =
  'Как один охранник у входа в здание вместо охранника у каждой двери. Он видит всех, кто проходит, и по пропуску понимает, куда человек идёт. Новые кабинеты открываются без новых охранников.';

/** Chromium, настоящие клики: мимо кнопки (по `li`), по `b` второго пункта, по тексту первой кнопки. */
export const DELEGATE_STAND = { before: 2, afterMiss: 2, afterSecond: 1, afterFirst: 0, targets: ['li', 'b', 'button.del'] };

export const DELEGATE_STEPS = [
  {
    k: '`event.target` — не кнопка',
    d: 'Клик по крестику дал `target` = `b`, по слову «Удалить» — `button.del`, мимо кнопки — `li`. Сравнивать `event.target` с кнопкой нельзя: попадание во вложенный элемент — обычное дело.',
  },
  {
    k: '`closest` поднимается к кнопке',
    d: '`closest(\'button.del\')` проверяет сам элемент и его предков и возвращает первый подходящий или `null`. Текст внутри кнопки целью не бывает: события мыши достаются элементам, и клик по слову дал саму кнопку.',
  },
  {
    k: '`list.contains` — граница',
    d: '`closest` не знает, где кончается список, и найдёт кнопку и за его пределами — например, если сам список лежит внутри другой `button.del`. Проверка `contains` отсекает чужое.',
  },
];

export const DELEGATE_FACTS = [
  {
    t: 'Где делегирование не работает напрямую',
    d: 'События без всплытия: `focus`, `blur`, `mouseenter`, `mouseleave`, `load` у картинок. Для фокуса есть всплывающие `focusin` и `focusout`; для остальных — слушатель с `capture: true` на предке.',
    tone: 'warn' as const,
  },
  {
    t: 'Цена — работа на каждом клике',
    d: 'Слушатель на списке вызывается на любой клик внутри, а `closest` поднимается по предкам. Это дёшево, пока сам обработчик лёгкий; долгую работу в нём заметит метрика отклика INP — [«Критический путь и Web Vitals», раздел «INP»](/render/rendering-crp/#s4).',
  },
  {
    t: 'Так устроены React и Solid',
    d: 'React вешает слушателей на корневой элемент приложения и сам ищет по пути события, какому компоненту отдать клик; Solid делегирует на `document`. Отсюда следствие всплытия: обычный слушатель на элементе внутри приложения срабатывает **раньше** обработчика React для того же клика.',
  },
];

// ─── Раздел 6. Пассивные слушатели ─────────────────────────────────────────────────────────

export const PLAIN_PASSIVE =
  'Прокрутка — как поезд, который ждёт отмашки дежурного. Если на станции дежурного нет, поезд едет сразу. Если он есть и может крикнуть «стой», поезд ждёт его на каждой станции, даже когда тот молчит. `passive: true` — это обещание дежурного заранее: «я никогда не остановлю».';

export const PASSIVE_ROWS = [
  { k: 'контейнер, без опций', cancelable: '`true`', dp: '`true`', scroll: 'не прокрутился', tone: 'ok' as const },
  { k: 'контейнер, `passive: false`', cancelable: '`true`', dp: '`true`', scroll: 'не прокрутился', tone: 'ok' as const },
  { k: 'контейнер, `passive: true`', cancelable: '`false`', dp: '`false`', scroll: 'прокрутился на 300px', tone: 'warn' as const },
  { k: '`window`, `document`, `html`, `body` без опций', cancelable: '`false`', dp: '`false`', scroll: 'прокрутился на 300px', tone: 'err' as const },
  { k: '`window`, `passive: false`', cancelable: '`true`', dp: '`true`', scroll: 'не прокрутился', tone: 'ok' as const },
];

/** Сообщения консоли Chromium 153, уровень `error`. Первое — `passive: true`, второе — пассивность по умолчанию. */
export const PASSIVE_CONSOLE = {
  explicit: 'Unable to preventDefault inside passive event listener invocation.',
  defaultWheel:
    'Unable to preventDefault inside passive event listener due to target being treated as passive. See https://www.chromestatus.com/feature/6662647093133312',
  defaultTouch:
    'Unable to preventDefault inside passive event listener due to target being treated as passive. See https://www.chromestatus.com/feature/5093566007214080',
};

export const PASSIVE_CODE = `// Так прокрутку отменить нельзя: на window колесо пассивно по умолчанию
window.addEventListener('wheel', (e) => e.preventDefault());

// Так можно — но прокрутка всей страницы теперь ждёт этого слушателя
window.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });

// Чаще всего нужно вот это: решение заранее, без JS
// .canvas { touch-action: none; overscroll-behavior: contain; }`;

export const PASSIVE_FACTS = [
  {
    t: 'Событие приходит уже неотменяемым',
    d: 'Когда все слушатели колеса пассивны, Chromium отправляет `wheel` с `cancelable: false` — внутри слушателя это видно. Браузер не ждёт от слушателя ответа, чтобы начать прокрутку.',
  },
  {
    t: 'Ошибка только в консоли',
    d: '`preventDefault` в пассивном слушателе не бросает исключение. Chromium пишет в консоль сообщение уровня `error`, а код идёт дальше. Тесты, которые не смотрят в консоль, такую поломку не заметят.',
    tone: 'warn' as const,
  },
  {
    t: 'Касания — так же',
    d: 'С касаниями на стенде то же самое: `touchmove` на `document` без опций пришёл неотменяемым, контейнер прокрутился, в консоли — то же сообщение со ссылкой на другую запись Chrome Platform Status. На самом контейнере без опций `preventDefault` прокрутку остановил.',
  },
];

// ─── Раздел 7. Синхронная отправка ─────────────────────────────────────────────────────────

export const SYNC_CODE = `btn.addEventListener('click', () => {
  log.push('L1');
  queueMicrotask(() => log.push('L1-µ'));
});
btn.addEventListener('click', () => {
  log.push('L2');
  queueMicrotask(() => log.push('L2-µ'));
});

log.push('до');
btn.click();          // или btn.dispatchEvent(new MouseEvent('click'))
log.push('после');`;

export const MICRO_ROWS = [
  { k: 'настоящий клик', v: '`L1, L1-µ, L2, L2-µ`', why: 'Слушателей вызывает браузер. После каждого стек пуст — микрозадачи выполняются сразу.', tone: 'ok' as const },
  { k: '`btn.click()`', v: '`до, L1, L2, после, L1-µ, L2-µ`', why: 'Слушатели вызваны внутри вашего кода. Стек пустеет только после `после`.', tone: 'warn' as const },
  { k: '`dispatchEvent`', v: '`до, L1, L2, после, L1-µ, L2-µ`', why: 'То же самое: отправка синхронная, как вызов функции.', tone: 'warn' as const },
];

export const MICRO_NOTE =
  'Почему микрозадачи ждут пустого стека, а не конца задачи, разобрано в [«Event Loop», раздел «Checkpoint»](/js/event-loop/#s3). Для событий из этого следуют две вещи. `dispatchEvent` возвращается, только когда отработали все слушатели, — значит, его результат (отменил ли кто-то) известен сразу. И тест, который нажимает кнопку через `.click()`, видит другой порядок микрозадач, чем пользователь.';

export const CLICK_SEQUENCE = {
  real: ['pointerdown', 'mousedown', 'focus', 'focusin', 'pointerup', 'mouseup', 'click'],
  click: ['click'],
};

export const AFTER_FACTS = [
  {
    t: '`el.click()` — это только `click`',
    d: 'Настоящий клик на стенде дал семь событий: `pointerdown`, `mousedown`, `focus`, `focusin`, `pointerup`, `mouseup`, `click`. `el.click()` — одно. Фокус кнопка не получила, `mousedown` никто не услышал.',
  },
  {
    t: 'После отправки `currentTarget` — `null`',
    d: 'Объект события живёт и после отправки, но пустеет: в `setTimeout` у того же события `currentTarget` — `null`, `eventPhase` — `0`, `composedPath()` — пустой массив. `target` остаётся. Нужен элемент после `await` — сохраните его в переменную заранее.',
    tone: 'warn' as const,
  },
  {
    t: 'Одно событие — одна отправка за раз',
    d: 'Отправить то же событие из его же слушателя нельзя: Chromium бросил `InvalidStateError`. Когда отправка закончилась — можно снова, `dispatchEvent` вернул `true` оба раза.',
  },
];

// ─── Раздел 8. Shadow DOM ──────────────────────────────────────────────────────────────────

export const PLAIN_RETARGET =
  'Как звонок из офиса через общий номер. Внутри офиса видно, кто звонит: «Анна, бухгалтерия». Снаружи на определителе — только номер компании. Звонок тот же, но кто именно звонил, наружу не сообщается.';

export const SHADOW_ROWS = [
  { k: '`button.heart`', target: '`button.heart`', phase: '2 — цель', path: '7 узлов, с внутренними' },
  { k: '`#shadow-root`', target: '`button.heart`', phase: '3 — всплытие', path: '7 узлов, с внутренними' },
  { k: '`like-button` (хозяин)', target: '`like-button`', phase: '2 — цель', path: 'open: 7 узлов; closed: 5, с хозяина' },
  { k: '`document`', target: '`like-button`', phase: '3 — всплытие', path: 'open: 7 узлов; closed: 5, с хозяина' },
];

export const SHADOW_FACTS = [
  {
    t: 'Подмена цели (retargeting)',
    d: 'Цель подменяется для каждого слушателя отдельно: кто внутри теневого дерева — видит настоящую кнопку, кто снаружи — хозяина. Для хозяина клик выглядит так, будто кликнули по нему самому, — фаза «цель».',
  },
  {
    t: '`composed` решает, выйдет ли событие наружу',
    d: 'Клики, клавиши, ввод, фокус созданы браузером с `composed: true` и пересекают границу. `new Event` и `new CustomEvent` по умолчанию `composed: false`: событие компонента не дойдёт даже до хозяина. Нужно наружу — `{ bubbles: true, composed: true }`.',
    tone: 'warn' as const,
  },
  {
    t: '`composedPath()` у открытого дерева выдаёт внутренности',
    d: 'Снаружи `event.target` — хозяин, но `composedPath()[0]` у открытого корня — настоящая `button.heart`. Делегирование на `document`, которому нужен элемент внутри компонента, читает путь, а не `target`. У закрытого корня внутренние узлы из пути вырезаны.',
  },
  {
    t: 'После отправки цель прячется',
    d: 'Событие, родившееся в теневом дереве и не вышедшее наружу, после отправки отдаёт `target: null`. Если вышло — `target` остаётся хозяином. Ссылка на внутренний узел наружу не утекает и задним числом.',
  },
];

// ─── happy-dom ─────────────────────────────────────────────────────────────────────────────

/**
 * Где happy-dom 20.14.5 ответил иначе, чем Chromium. Каждая строка закрыта проверкой
 * в `tests/unit/dom-events.test.ts`: исправят в happy-dom — тест покраснеет и попросит
 * обновить таблицу.
 */
export const HAPPY_ROWS = [
  { k: 'захват на самой цели', chromium: '`eventPhase` 2', happy: '`eventPhase` 1' },
  { k: '`wheel` на `body` без опций', chromium: 'пассивный: `preventDefault` не действует', happy: 'отменяет: `defaultPrevented: true`' },
  { k: '`composedPath()` после удаления `li`', chromium: 'прежние 8 узлов', happy: 'пересчитан: `b button.del li`' },
  { k: '`target` снаружи теневого дерева', chromium: 'хозяин `like-button`', happy: '`button.heart` — без подмены' },
  { k: '`composedPath()` закрытого дерева снаружи', chromium: 'с хозяина, 5 узлов', happy: 'все 7 узлов' },
  { k: '`target` после отправки, `composed: false`', chromium: '`null`', happy: '`button.heart`' },
  { k: '`isTrusted` у `el.click()`', chromium: '`false`', happy: '`undefined`' },
  { k: '`signal` уже отменён', chromium: 'слушатель не добавлен', happy: 'добавлен и вызывается' },
  { k: 'та же отправка изнутри слушателя', chromium: '`InvalidStateError`', happy: 'рекурсия до переполнения стека' },
  { k: '`composedPath()` после отправки', chromium: '`[]`', happy: 'прежний путь' },
];

export const HAPPY_NOTE =
  'Совпало с Chromium: порядок вызовов во всех сценариях без теневого дерева, остановки, `once`, `cancelable`, копия списка слушателей, галочка флажка до слушателей и её откат, переход по ссылке после отправки, порядок микрозадач у `el.click()`. Расходится всё, что касается Shadow DOM, пассивности и состояния события после отправки.';

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: '`event.target` — самый глубокий элемент, а не тот, где слушатель',
    d: 'Клик по иконке внутри кнопки даёт `target` = иконка. Код `if (event.target === button)` срабатывает через раз. Нужна кнопка — `event.currentTarget` (слушатель на ней) или `event.target.closest(\'button\')` (слушатель выше).',
    tone: 'err',
  },
  {
    n: '02',
    t: '`stopPropagation` ломает чужой код',
    d: 'Меню закрывается слушателем «клик где угодно» на `document`. Кнопка внутри остановила всплытие — и меню больше не закрывается от клика по ней. То же с аналитикой и библиотеками. Слушатель на `document` с `capture: true` срабатывает раньше и такой остановки не замечает.',
    tone: 'warn',
  },
  {
    n: '03',
    t: '`preventDefault` в пассивном слушателе молча не действует',
    d: 'Колесо и касания на `window`, `document`, `html` и `body` пассивны по умолчанию. Отменить прокрутку оттуда нельзя без `{ passive: false }`; исключения нет, только сообщение в консоли.',
    tone: 'err',
  },
  {
    n: '04',
    t: '`new Event` по умолчанию не всплывает, не отменяется и не выходит из Shadow DOM',
    d: 'Все три флага — `false`. Своё событие, которое должен услышать предок и которое можно отменить, создают с `{ bubbles: true, cancelable: true }`, а из веб-компонента — ещё и с `composed: true`.',
    tone: 'warn',
  },
  {
    n: '05',
    t: '`currentTarget` после `await` — `null`',
    d: 'Асинхронный обработчик читает `event.currentTarget` после `await fetch(…)` и получает `null`: отправка давно закончилась. И `preventDefault` после `await` опоздал — действие уже выполнено.',
    tone: 'err',
  },
  {
    n: '06',
    t: '`el.click()` в тесте — не клик пользователя',
    d: 'Одно событие вместо семи, без фокуса и `mousedown`; `isTrusted: false`; микрозадачи слушателей выполняются после всех слушателей, а не между ними. Логика, завязанная на порядок, в тесте ведёт себя иначе, чем в браузере.',
    tone: 'warn',
  },
  {
    n: '07',
    t: 'Синтетическое событие не делает работу браузера',
    d: '`dispatchEvent(new Event(\'submit\'))` не отправит форму, `keydown` не напечатает букву. Исключение — `click`: он ставит галочку и переходит по ссылке. Отправить форму со слушателями и проверкой — `form.requestSubmit()`.',
  },
  {
    n: '08',
    t: 'Путь не пересчитывается по ходу',
    d: 'Слушатель удалил элемент из DOM — событие всё равно дойдёт до его бывших предков и до `document`. Слушатель, добавленный на тот же узел во время отправки, сработает только в следующий раз, а на предка, до которого событие ещё не дошло, — уже в этот.',
  },
  {
    n: '09',
    t: 'Делегирование на `document` не видит внутрь веб-компонентов',
    d: 'Снаружи `event.target` — хозяин, и `closest` ищет только среди его предков. Для открытых корней настоящий элемент — `event.composedPath()[0]`; для закрытых — никак, и это задумано.',
    tone: 'warn',
  },
  {
    n: '10',
    t: 'happy-dom и jsdom — не браузер',
    d: 'Тестовое окружение повторяет основу, но не всё: happy-dom 20.14.5 не подменяет цель на границе Shadow DOM, не знает пассивности по умолчанию и добавляет слушателя с уже отменённым `signal`. Тест, проверяющий именно это, обязан идти в настоящем браузере.',
    tone: 'warn',
  },
];

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'DOM Standard — Events',
    href: 'https://dom.spec.whatwg.org/#events',
    what: 'путь, фазы, `dispatch`, `inner invoke`, флаги остановки, `composedPath()`, подмена цели — по ним написана функция `dispatch` темы',
  },
  {
    title: 'DOM Standard — default passive value',
    href: 'https://dom.spec.whatwg.org/#default-passive-value',
    what: 'для каких событий и узлов `passive` включён по умолчанию',
  },
  {
    title: 'HTML Standard — `requestSubmit()`',
    href: 'https://html.spec.whatwg.org/multipage/forms.html#dom-form-requestsubmit',
    what: 'отправка формы со слушателями и проверкой полей, в отличие от `submit()`',
  },
  {
    title: 'MDN — EventTarget.addEventListener()',
    href: 'https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener',
    what: '`capture`, `once`, `passive`, `signal`, правило про дубли',
  },
  {
    title: 'MDN — Event.composedPath()',
    href: 'https://developer.mozilla.org/en-US/docs/Web/API/Event/composedPath',
    what: 'путь с учётом открытых и закрытых теневых корней',
  },
  {
    title: 'MDN — touch-action',
    href: 'https://developer.mozilla.org/en-US/docs/Web/CSS/touch-action',
    what: 'отменить жест без JS-слушателя',
  },
  {
    title: 'Chrome Platform Status — пассивные слушатели колеса на уровне документа',
    href: 'https://www.chromestatus.com/feature/6662647093133312',
    what: 'ссылка из сообщения консоли Chromium 153',
  },
  {
    title: 'happy-dom',
    href: 'https://github.com/capricorn86/happy-dom',
    what: 'тестовое окружение; версия 20.14.5 на стенде',
  },
];

export const RELATED =
  'Смежное на сайте: [Event Loop, раздел «Checkpoint»](/js/event-loop/#s3) — почему микрозадачи ждут пустого стека. [Колбэки, раздел «this в колбэке»](/js/callbacks/#s4) и [раздел «Отмена»](/js/callbacks/#s8) — слушатель как колбэк и `AbortController`. [Кадр браузера, раздел «Что дешевле двигать»](/render/render-pipeline/#s4) — почему непассивный слушатель возвращает прокрутку на главный поток. [Критический путь и Web Vitals, раздел «INP»](/render/rendering-crp/#s4) — как долгий обработчик превращается в задержку отклика. [Стили веб-компонентов, раздел «Граница»](/render/web-components-styles/#s1) — граница теневого дерева для CSS. [Расширения браузера, раздел «Обмен»](/render/browser-extensions/#s3) — события как канал между страницей и контент-скриптом. [Дерево доступности](/render/accessibility-tree/) — что из DOM видит скринридер, роли, доступное имя и порядок Tab. [Debounce, throttle и token bucket](/algorithms/rate-limiting/) — один бюджет событий во времени: обёртки и ограничители. [Прокрутка изнутри](/render/scrolling/) — липкие шапки, якорь прокрутки при догрузке сверху, snap и `scroll-padding`.';
