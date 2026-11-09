import type { GlossaryTerm, Pitfall, Prereq, Source } from '@/entities/lesson';
import type { LabSetup } from '@/widgets/iframe-lab/model/probe';

/**
 * Данные темы «iframe: чужой и свой документ внутри страницы».
 *
 * Тема написана 2026-11-05. Уже разобранное в других темах здесь дано фразой со ссылкой:
 * кликджекинг, `frame-ancestors` и `X-Frame-Options` — «Безопасность фронтенда», раздел
 * «CSRF и кликджекинг»; куки и хранилище во фрейме чужого сайта, Storage Access API —
 * «Встроенный контент без сторонних кук»; порты `MessageChannel` — «MessageChannel»;
 * сайт, процессы и OOPIF — «Устройство браузера»; утечки через число фреймов —
 * «XS-Leaks»; что именно копирует `postMessage` — «Копирование и сериализация»;
 * `allow` для Wake Lock, `share` и оплаты — «Интеграция с ОС», раздел «Жест и iframe».
 *
 * ── Стенд (ноябрь 2026) ──────────────────────────────────────────────────────────────────
 * Node 26.8.2, Playwright 1.63: Chromium 153.0.8010.12 (headless shell; для процессов —
 * полный `channel: 'chromium'`), Firefox 155.0, WebKit 26.6 (сборки Playwright, не Chrome,
 * не Firefox и не Safari). Сайты `https://shop.example`, `https://widget.example` и
 * `https://evil.example` — ответы подставлены перехватом запросов Playwright
 * (`context.route`), поэтому сертификаты и DNS не нужны. Каталог стенда —
 * `scratchpad/iframe/` (`stand.mjs` … `stand5.mjs`); всё, что в нём снято и попало в текст,
 * повторяет `tests/unit/iframe.test.ts`.
 *
 *   — доступ к чужому фрейму (`ACCESS_CODE`, `CROSS_ORIGIN_NAMES`): одинаково в трёх движках;
 *     список `Object.getOwnPropertyNames(чужое окно)` — 13 имён и `then`;
 *   — песочница (`SANDBOX_MATRIX`): та же проба, что в демо (`widgets/iframe-lab/model/probe.ts`).
 *     Единственное расхождение — `document.cookie` в непрозрачном источнике: Chromium и Firefox
 *     бросают `SecurityError`, WebKit отдаёт пустую строку;
 *   — `submit` без `allow-forms`: WebKit **запускает событие** `submit`, но форму не отправляет;
 *     Chromium и Firefox не запускают и события. Поэтому проба смотрит на переход, а не на событие;
 *   — `window.open` без `allow-popups`: Chromium и WebKit — `null`, Firefox бросает
 *     `InvalidAccessError`. Блокировщик окон Playwright выключен (`--disable-popup-blocking`
 *     у Chromium), поэтому окно с флагом открывается и без клика;
 *   — поток (`THREAD_ROWS`): родитель занят 500 мс, фрейм тикает таймером раз в 10 мс.
 *     Фрейм своего источника молчит ~500 мс во всех движках. Фрейм чужого сайта в полном
 *     Chromium тикает (самый длинный промежуток ~11 мс), в headless shell Chromium, Firefox и
 *     WebKit Playwright — молчит ~500 мс. Тест закрепляет отношение, а не миллисекунды;
 *   — `referrerpolicy="unsafe-url"`: полный адрес отдал только Chromium; Firefox и WebKit
 *     обрезали до источника и с этим значением.
 *
 * Только по документации, без запуска: что `title` объявляют программы чтения с экрана
 * (WCAG, техника H64), флаги `allow-popups-to-escape-sandbox`, `allow-downloads`,
 * `allow-top-navigation-by-user-activation`, `allow-storage-access-by-user-activation`,
 * что делает `credentialless` (снята только его поддержка), заголовок `Content-Security-Policy:
 * sandbox`. Поведение Safari, Chrome и Firefox у пользователя не снималось.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY: GlossaryTerm[] = [
  {
    k: 'фрейм, `<iframe>`',
    d: 'Тег, который показывает внутри страницы другой HTML-документ. У этого документа свой адрес, свой `window`, свой DOM, свои стили и скрипты. Страницу, в которую фрейм вставлен, называют родителем.',
  },
  {
    k: 'источник (origin)',
    d: 'Схема, хост и порт адреса: `https://shop.example:443`. Два документа одного источника видят друг друга целиком, разных — почти никак. Это правило одного источника (SOP).',
  },
  {
    k: '`contentWindow`, `contentDocument`',
    d: 'Свойства тега `<iframe>` в родителе. Первое — `window` документа внутри фрейма, второе — сам документ. Для фрейма чужого источника второе равно `null`.',
  },
  {
    k: '`postMessage`',
    d: 'Метод окна: отправить в другое окно копию данных. Там сработает событие `message`. Единственный обычный способ передать данные между документами разных источников.',
  },
  {
    k: 'песочница, `sandbox`',
    d: 'Атрибут `<iframe>`, который отнимает у документа внутри способности: выполнять скрипты, отправлять формы, открывать окна, иметь свой источник. Флаги `allow-*` возвращают их по одной.',
  },
  {
    k: 'непрозрачный источник (opaque origin)',
    d: 'Источник, который не равен никакому другому, даже такому же. Его получает документ в песочнице без `allow-same-origin`. В строку он превращается как `"null"`.',
  },
  {
    k: 'Permissions Policy',
    d: 'Правила, какие возможности браузера достаются фрейму: камера, геолокация, полноэкранный режим. Для одного фрейма их задаёт атрибут `allow`.',
  },
];

export const PLAIN_FRAME =
  'Фрейм — как телевизор в комнате. Он стоит у вас, вы выбираете, где он висит и какого он размера. Но что показывают, решает телеканал. Вы не можете зайти внутрь передачи и переставить там мебель. Можете только переключить канал — сменить адрес фрейма.';

export const PREREQ_NOTE =
  'Тема опирается на четыре вещи. Каждую хватит знать в общих чертах.';

export const PREREQ: Prereq[] = [
  {
    t: 'Источник и правило одного источника',
    d: 'Источник — схема, хост и порт. Скрипт может читать только документы своего источника. Всё, что во фрейме закрыто или открыто, — следствие этого правила.',
    href: '/platform/security/#s1',
    hrefLabel: '«Безопасность фронтенда», раздел «Origin и правило одного источника»',
    tone: 'info',
  },
  {
    t: 'Сайт — не то же, что источник',
    d: '`app.shop.example` и `cdn.shop.example` — разные источники, но один сайт. По сайту браузер решает, в какой процесс положить документ. Это понадобится в разделе о цене фрейма.',
    href: '/js/browser-architecture/#s1',
    hrefLabel: '«Устройство браузера», раздел «Site»',
    tone: 'info',
  },
  {
    t: 'События и всплытие',
    d: 'Событие клавиатуры или мыши поднимается от элемента вверх до `document` и `window`. Граница фрейма — граница документа: дальше событие не идёт.',
    href: '/render/dom-events/#s1',
    hrefLabel: '«События DOM», раздел «Путь и фазы»',
    tone: 'info',
  },
  {
    t: 'Структурное клонирование',
    d: '`postMessage` передаёт не объект, а его копию. Копируются данные, но не функции, не DOM-узлы и не прототипы классов.',
    href: '/js/serialization/#s4',
    hrefLabel: '«Копирование и сериализация», раздел «structuredClone»',
    tone: 'info',
  },
];

// ─── Раздел 1. Как встроить ───────────────────────────────────────────────────────────────

/** Сторож грузит эту разметку страницей `https://shop.example/` и проверяет оба фрейма. */
export const EMBED_CODE = `<!-- страница https://shop.example -->
<iframe
  src="https://widget.example/chat"
  title="Чат поддержки"
  width="360"
  height="480"
  loading="lazy"
></iframe>

<iframe
  srcdoc="<p>Документ прямо <b>из строки</b></p>"
  title="Документ из строки"
></iframe>`;

export const EMBED_FACTS = [
  {
    t: '`src` — документ по адресу',
    d: 'Браузер загружает адрес, как отдельную страницу. Источник документа — источник этого адреса. Здесь это `https://widget.example`, а не магазин.',
  },
  {
    t: '`srcdoc` — документ из строки',
    d: 'HTML лежит прямо в атрибуте, запроса в сеть нет. Адрес документа — `about:srcdoc`, а **источник — родителя**: проверено во всех трёх движках. Значит, скрипт из `srcdoc` видит и меняет вашу страницу. Чужой HTML туда кладут только вместе с `sandbox`.',
    tone: 'warn' as const,
  },
  {
    t: '`title` — имя для чтения с экрана',
    d: 'Программа чтения с экрана объявляет фрейм по атрибуту `title`. Без него человек слышит «фрейм» и не знает, что внутри. Так требует WCAG (техника H64).',
  },
  {
    t: 'Размер по умолчанию — 300 × 150',
    d: 'Без `width` и `height` фрейм занимает 300 на 150 пикселей. К ним браузер добавляет рамку `2px inset`, и снаружи выходит 304 на 154. Содержимое на размер не влияет. Как подогнать высоту, разобрано в разделе «Высота по содержимому».',
  },
  {
    t: '`loading="lazy"` — грузить, когда понадобится',
    d: 'Фрейм ниже первого экрана не загружается, пока до него не доскроллят. На стенде запрос за таким фреймом ушёл только после прокрутки — в Chromium, Firefox и WebKit. Для фреймов на первом экране атрибут не нужен: они нужны сразу.',
    tone: 'ok' as const,
  },
];

/** Размер фрейма без атрибутов — `clientWidth × clientHeight` и `offsetWidth × offsetHeight`. */
export const DEFAULT_SIZE = { client: [300, 150], offset: [304, 154], border: '2px inset' };

// ─── Раздел 2. Свой и чужой ───────────────────────────────────────────────────────────────
// Строки с комментарием-значением (`// null`, `// SecurityError`, `// 'Помощь'`) сторож
// исполняет по одной в странице https://shop.example и сравнивает с комментарием.

export const ACCESS_CODE = `// страница https://shop.example
const own = document.querySelector('#own');   // <iframe id="own" src="/help">
const chat = document.querySelector('#chat'); // <iframe id="chat" src="https://widget.example/chat">

own.contentDocument.title;          // 'Помощь' — свой источник: документ открыт
own.contentWindow.Array === Array;  // false — у фрейма свои встроенные объекты

chat.contentDocument;               // null
chat.contentWindow.document;        // SecurityError
chat.contentWindow.location.href;   // SecurityError — адрес не прочитать
chat.contentWindow.frames.length;   // 0 — а число фреймов внутри видно
chat.contentWindow.location = 'https://widget.example/faq'; // ок — и увести фрейм можно`;

export const PLAIN_WALL =
  'Чужой фрейм — квартира соседа за стеклянной дверью. Вы видите, что дверь есть и горит ли свет. Можете постучать — отправить сообщение. Можете даже повесить на дверь табличку «переезд» — увести фрейм на другой адрес. Но войти и посмотреть, что лежит на столе, нельзя.';

/** Что остаётся доступным у окна чужого источника — по спецификации HTML (CrossOriginProperties). */
export const CROSS_ORIGIN_ROWS = [
  { k: '`postMessage()`', d: 'Отправить сообщение. Главный и почти единственный способ договориться.' },
  { k: '`location`', d: 'Только записать (`location = url`) и вызвать `location.replace(url)`. Прочитать адрес нельзя.' },
  { k: '`frames`, `length`, `window`, `self`', d: 'Ссылки на само окно и число фреймов внутри. Число фреймов — уже утечка: так чужой сайт узнаёт, вошёл ли человек.' },
  { k: '`parent`, `top`, `opener`', d: 'Ссылки на соседние окна. Это такие же чужие окна с тем же урезанным набором.' },
  { k: '`closed`, `close()`, `focus()`, `blur()`', d: 'Закрыто ли окно и управление фокусом. `close()` работает только для окон, открытых скриптом.' },
];

/** Те же имена, что `Object.getOwnPropertyNames(чужое окно)` во всех трёх движках (без числовых индексов). */
export const CROSS_ORIGIN_NAMES = [
  'blur', 'close', 'closed', 'focus', 'frames', 'length', 'location', 'opener', 'parent',
  'postMessage', 'self', 'then', 'top', 'window',
];

export const ACCESS_NOTE =
  'Список одинаков в Chromium, Firefox и WebKit: `Object.getOwnPropertyNames` у чужого окна вернул эти 13 имён и ещё `then`. `then` там нарочно: спецификация заводит его пустым, чтобы `await` чужого окна не бросал исключение. Остальное — `document`, `name`, даже `origin` — бросает `SecurityError`. Своему фрейму открыто всё, но его объекты созданы в другом глобальном окружении. Поэтому `arr instanceof Array` для массива из фрейма — `false`, и проверять надо через `Array.isArray`. Почему так, разобрано в [«Объектной модели», раздел «Наследование и `instanceof`»](/js/object-model/#s3). Число фреймов как источник утечки — в [«XS-Leaks», раздел «Классы утечек»](/platform/xs-leaks/#s2).';

// ─── Раздел 3. postMessage ────────────────────────────────────────────────────────────────
// Сторож исполняет обе строки: родителя на https://shop.example, фрейма на https://widget.example,
// и рядом третий фрейм https://evil.example с тем же сообщением `ready`.

export const MESSAGE_PARENT_CODE = `// https://shop.example — страница с чатом
const WIDGET = 'https://widget.example';
const chat = document.querySelector('#chat');

window.addEventListener('message', (event) => {
  if (event.origin !== WIDGET) return;             // писал не виджет
  if (event.source !== chat.contentWindow) return; // виджет, но из другого фрейма
  if (event.data?.type === 'ready') {
    chat.contentWindow.postMessage({ type: 'theme', value: 'dark' }, WIDGET);
  }
});`;

export const MESSAGE_CHILD_CODE = `// https://widget.example/chat — внутри фрейма
const SHOP = 'https://shop.example';

window.addEventListener('message', (event) => {
  if (event.origin !== SHOP) return;
  if (event.data?.type === 'theme') document.body.dataset.theme = event.data.value;
});

parent.postMessage({ type: 'ready' }, SHOP);`;

export const MESSAGE_RULES = [
  {
    t: 'Проверять `event.origin` — строгим равенством',
    d: 'Сообщение в ваше окно может прислать любая страница, у которой есть на него ссылка: фрейм, вкладка, открывшая вас, всплывающее окно. `event.origin` — источник отправителя, его подделать нельзя. Сравнивать только `===`. Проверка `origin.includes(\'shop.example\')` пропустит `https://shop.example.evil.example`.',
    tone: 'err' as const,
  },
  {
    t: 'Проверять `event.source`',
    d: '`event.source` — окно отправителя. Если на странице два фрейма одного виджета, источник у них один, а окна разные. Сравнение с `chat.contentWindow` отвечает «это мой фрейм».',
  },
  {
    t: 'Указывать адресата вторым аргументом',
    d: 'Второй аргумент `postMessage` — источник, которому можно доставить сообщение. Если во фрейме сейчас другой документ, браузер молча выбросит сообщение. Строка `\'*\'` значит «кому угодно».',
  },
  {
    t: 'Ждать «готов», а не `load`',
    d: 'Сообщение, пришедшее раньше подписки, не ждёт в очереди: событие `message` уже случилось, слушателя не было. Надёжнее, чтобы фрейм сам сказал `ready`, а родитель подписался до вставки фрейма.',
    tone: 'warn' as const,
  },
];

export const MESSAGE_NOTE =
  'Данные доходят копией: `postMessage` прогоняет их через структурное клонирование. Функция в данных бросает `DataCloneError` у отправителя, класс приходит простым объектом. Что переживает копию, разобрано в [«Копировании и сериализации», раздел «structuredClone»](/js/serialization/#s4). Для долгого разговора удобнее отдать фрейму порт `MessageChannel`: у порта свой канал, и чужие сообщения в него не попадают. Это — в [«MessageChannel», раздел «Основа»](/js/message-channel/#basics).';

export const TARGET_CODE = `// фрейм ушёл с widget.example на https://evil.example
const token = 'секрет';

chat.contentWindow.postMessage({ token }, '*');                      // доставлено evil.example
chat.contentWindow.postMessage({ token }, 'https://widget.example'); // выброшено молча
chat.contentWindow.postMessage({ token }, 'widget.example');         // SyntaxError: нет схемы`;

/** Что получил фрейм, ушедший на evil.example. Снято в трёх движках, одинаково. */
export const TARGET_ROWS = [
  { k: "`'*'`", got: 'получил', why: 'адресат не проверяется вовсе', tone: 'err' as const },
  { k: "`'https://widget.example'`", got: 'не получил', why: 'источник документа во фрейме другой — браузер выбросил сообщение без ошибки', tone: 'ok' as const },
  { k: "`'https://evil.example/any/path'`", got: 'получил', why: 'от адреса берётся только источник, путь отбрасывается', tone: 'warn' as const },
  { k: "`'widget.example'`", got: 'SyntaxError', why: 'не адрес: без схемы источник не разобрать, ошибка у отправителя', tone: 'warn' as const },
];

export const TARGET_NOTE =
  'Фрейм уводят чаще, чем кажется. Его адрес может сменить сам виджет, редирект при входе, реклама внутри или чужой скрипт через `location`. Строка `\'*\'` уместна только для данных, которые не жалко показать любому. Отдельный случай — фрейм в песочнице без `allow-same-origin`. Его источник `"null"`, а строку `\'null\'` вторым аргументом браузер не принимает: во всех трёх движках это `SyntaxError`. Остаётся только `\'*\'`. Значит, секретов такому фрейму не шлют.';

// ─── Раздел 4. Песочница ──────────────────────────────────────────────────────────────────

export const PLAIN_SANDBOX =
  'Песочница — гостевая комната с закрытыми дверями. Гость внутри может читать книгу, но не может звонить, выходить в коридор и брать ключи. Каждый флаг `allow-*` — одна разрешённая вещь. Пара `allow-scripts allow-same-origin` для документа вашего же источника — это ключ от всей квартиры: гость откроет дверь комнаты сам.';

export const SANDBOX_CODE = `<!-- письмо или Markdown пользователя: пусть рисует, но не исполняет -->
<iframe sandbox srcdoc="…HTML письма…" title="Письмо"></iframe>

<!-- песочница кода: скрипты можно, источник — непрозрачный -->
<iframe
  sandbox="allow-scripts"
  src="https://run.shop-usercontent.example/preview"
  title="Результат кода"
></iframe>`;

export const SANDBOX_NOTE =
  'Без `allow-same-origin` документ получает непрозрачный источник. Он не равен ничьему, даже вашему, и `self.origin` у него — строка `"null"`. Поэтому `localStorage`, `indexedDB` и `document.cookie` бросают `SecurityError`, а родитель видит `contentDocument === null`, как у чужого сайта. Одно расхождение: `document.cookie` в WebKit не бросает, а возвращает пустую строку.';

/**
 * Песочница в трёх движках. Ячейки — `cellsOf` из модели демо: сторож гоняет ту же пробу
 * (`buildProbeDoc`) в Chromium, Firefox и WebKit и сравнивает ответ с этими строками.
 * `webkitCookie` — где WebKit ответил иначе; в таблицу оно идёт припиской к ячейке.
 */
export const SANDBOX_MATRIX: { attr: string; setup: LabSetup; cells: string[]; webkitCookie?: string }[] = [
  {
    attr: 'без `sandbox`',
    setup: { sandbox: false, flags: [] },
    cells: ['да', 'как у родителя', 'читает', 'пишет', 'читает', 'уходит', 'документ'],
  },
  {
    attr: '`sandbox`',
    setup: { sandbox: true, flags: [] },
    cells: ['нет', '—', '—', '—', '—', '—', 'null'],
  },
  {
    attr: '`sandbox="allow-scripts"`',
    setup: { sandbox: true, flags: ['allow-scripts'] },
    cells: ['да', '"null"', 'SecurityError', 'SecurityError', 'SecurityError', 'не уходит', 'null'],
    webkitCookie: 'читает',
  },
  {
    attr: '`sandbox="allow-scripts allow-forms"`',
    setup: { sandbox: true, flags: ['allow-scripts', 'allow-forms'] },
    cells: ['да', '"null"', 'SecurityError', 'SecurityError', 'SecurityError', 'уходит', 'null'],
    webkitCookie: 'читает',
  },
  {
    attr: '`sandbox="allow-same-origin"`',
    setup: { sandbox: true, flags: ['allow-same-origin'] },
    cells: ['нет', '—', '—', '—', '—', '—', 'документ'],
  },
  {
    attr: '`sandbox="allow-scripts allow-same-origin"`',
    setup: { sandbox: true, flags: ['allow-scripts', 'allow-same-origin'] },
    cells: ['да', 'как у родителя', 'читает', 'пишет', 'читает', 'не уходит', 'документ'],
  },
];

export const MATRIX_HEAD = [
  'атрибут',
  'скрипт',
  '`self.origin`',
  '`parent.document`',
  '`localStorage`',
  '`document.cookie`',
  'форма',
  '`contentDocument` снаружи',
];

/** Строки таблицы: значения кодом, расхождение WebKit — припиской. */
export function matrixRows(): string[][] {
  const code = (v: string) => (v === 'null' || v === '"null"' || /Error$/.test(v) ? `\`${v}\`` : v);
  return SANDBOX_MATRIX.map((row) => [
    row.attr,
    ...row.cells.map((cell, i) =>
      i === 4 && row.webkitCookie ? `${code(cell)}; WebKit — пустая строка без ошибки` : code(cell),
    ),
  ]);
}

export const LAB_CAPTION =
  'Посмотрите, как один флаг `allow-same-origin` возвращает фрейму всё сразу: источник, хранилище, доступ к странице курса и к собственному тегу. А `allow-forms` без него даёт отправить форму, но не даёт прочитать ничего.';

export const ESCAPE_CODE = `// внутри <iframe sandbox="allow-scripts allow-same-origin" srcdoc="…">
// источник как у родителя: фрейму открыт DOM родителя и свой тег
const me = frameElement;
me.removeAttribute('sandbox');
me.srcdoc = me.srcdoc + ' '; // перезагрузка — уже без песочницы`;

export const ESCAPE_NOTE =
  'Флаги песочницы читаются в момент загрузки документа. Скрипт, которому открыт родитель, снимает атрибут и перезагружает фрейм — и следующий документ живёт без ограничений. На стенде так вышло во всех трёх движках: до перезагрузки `window.open` не работал, после — открыл окно. Для документа **чужого** источника пара безопасна: `frameElement` ему не виден, родителя он не читает. Опасна она только там, где содержимое фрейма с вашего же источника: `srcdoc`, `about:blank` или ваш адрес.';

/** Остальные флаги. «Снято» — проверено на стенде в трёх движках, остальное — по спецификации. */
export const SANDBOX_FLAGS = [
  { k: '`allow-scripts`', d: 'Выполнять скрипты.', without: 'Ни один `<script>` и ни один обработчик не выполнится. Снято.' },
  { k: '`allow-same-origin`', d: 'Оставить документу его настоящий источник.', without: 'Источник `"null"`: нет хранилищ и кук, родителю документ закрыт. Снято.' },
  { k: '`allow-forms`', d: 'Отправлять формы.', without: 'Форма не уходит. Снято; WebKit при этом всё же запускает событие `submit`.' },
  { k: '`allow-popups`', d: 'Открывать окна и вкладки.', without: '`window.open` возвращает `null` (Chromium, WebKit) или бросает `InvalidAccessError` (Firefox). Снято.' },
  { k: '`allow-popups-to-escape-sandbox`', d: 'Открытое окно живёт без песочницы. Нужен платёжным и OAuth-окнам.', without: 'Окно наследует все ограничения фрейма. По спецификации.' },
  { k: '`allow-modals`', d: '`alert`, `confirm`, `prompt`, `print`.', without: '`alert()` молча возвращается, окна нет. Снято.' },
  { k: '`allow-top-navigation`', d: 'Увести всю вкладку: `top.location = …`.', without: '`SecurityError`. Снято; с флагом вкладка ушла и без клика.' },
  { k: '`allow-top-navigation-by-user-activation`', d: 'То же, но только в ответ на клик внутри фрейма.', without: 'Как без `allow-top-navigation`. По спецификации.' },
  { k: '`allow-downloads`', d: 'Скачивать файлы.', without: 'Скачивание отменяется. По спецификации.' },
  { k: '`allow-storage-access-by-user-activation`', d: 'Просить доступ к своим кукам через Storage Access API.', without: '`requestStorageAccess()` отклоняется. По спецификации; сам API — в [«Встроенном контенте без сторонних кук»](/platform/third-party-cookies/#s5).' },
];

export const FLAGS_NOTE =
  'Есть ли флаг в этом браузере, отвечает `iframe.sandbox.supports(\'allow-…\')`. На стенде Chromium 153 не знает `allow-top-navigation-to-custom-protocols`, а WebKit 26.6 — `allow-presentation` и `allow-orientation-lock`. Неизвестный флаг просто не действует, и способность остаётся запрещённой. Тот же набор флагов сервер может навязать документу сам, заголовком `Content-Security-Policy: sandbox allow-scripts`. Тогда песочница действует, даже если документ открыли не во фрейме.';

/** Что `supports()` ответил «нет» в каждом движке. Остальные флаги из `SUPPORTS_ASKED` — «да». */
export const SUPPORTS_ASKED = [
  'allow-scripts', 'allow-same-origin', 'allow-forms', 'allow-popups', 'allow-popups-to-escape-sandbox',
  'allow-modals', 'allow-top-navigation', 'allow-top-navigation-by-user-activation',
  'allow-top-navigation-to-custom-protocols', 'allow-downloads', 'allow-pointer-lock', 'allow-presentation',
  'allow-orientation-lock', 'allow-storage-access-by-user-activation',
];
export const SUPPORTS_MISSING = {
  chromium: ['allow-top-navigation-to-custom-protocols'],
  firefox: [] as string[],
  webkit: ['allow-presentation', 'allow-orientation-lock'],
};

// ─── Раздел 5. Права фрейма ───────────────────────────────────────────────────────────────

export const PLAIN_ALLOW =
  'Песочница отбирает, а `allow` выдаёт. Это как пропуск в офис: гость без пропуска сидит в переговорной, с пропуском «камера» может включить проектор. Пропуск выдаёт хозяин страницы. Но даже с пропуском браузер всё равно спросит человека, можно ли включить камеру.';

export const ALLOW_CODE = `<!-- видео: полный экран и автозапуск -->
<iframe src="https://video.example/embed/42" allow="fullscreen; autoplay" title="Видео"></iframe>

<!-- карта: геолокация только для источника из src -->
<iframe src="https://maps.example/" allow="geolocation 'src'" title="Карта"></iframe>

<!-- свой фрейм, у которого полный экран отнят -->
<iframe src="/help" allow="fullscreen 'none'" title="Справка"></iframe>`;

/** `document.fullscreenEnabled` внутри фрейма. Снято в трёх движках, одинаково. */
export const FULLSCREEN_ROWS = [
  { k: 'чужой источник, без атрибутов', v: 'false', tone: 'err' as const },
  { k: 'чужой источник, `allow="fullscreen"`', v: 'true', tone: 'ok' as const },
  { k: 'чужой источник, старый `allowfullscreen`', v: 'true', tone: 'ok' as const },
  { k: 'свой источник, без атрибутов', v: 'true', tone: 'ok' as const },
  { k: "свой источник, `allow=\"fullscreen 'none'\"`", v: 'false', tone: 'err' as const },
];

export const ALLOW_NOTE =
  'У большинства возможностей умолчание — «только свой источник». Свой фрейм получает их без атрибута, чужой — только по `allow`. Что именно ответят Wake Lock, `navigator.share` и оплата во фрейме без `allow` и почему WebKit всё равно ждёт клика, разобрано в [«Интеграции с ОС», раздел «Жест и iframe»](/js/os-integration/#s5). Тот же список для всей страницы задаёт заголовок `Permissions-Policy`, о нём — в [«Безопасности фронтенда», раздел «CSRF и кликджекинг»](/platform/security/#s5).';

export const TOPNAV_NOTE =
  'Отдельно о вкладке целиком. Фрейм чужого источника без песочницы тоже не может увести страницу без клика: `top.location = …` из скрипта при загрузке дал `SecurityError` в Chromium, Firefox и WebKit. Это защита от рекламы, которая перебрасывает человека на свой сайт. Зато в песочнице с `allow-top-navigation` вкладка ушла и без клика. Поэтому этот флаг чужому коду не дают, а дают `allow-top-navigation-by-user-activation`.';

/** `document.referrer` внутри фрейма `https://widget.example` на странице `https://shop.example/cart?id=42`. */
export const REFERRER_ROWS = [
  { k: 'без атрибута', chromium: '`https://shop.example/`', firefox: '`https://shop.example/`', webkit: '`https://shop.example/`' },
  { k: '`referrerpolicy="no-referrer"`', chromium: 'пустая строка', firefox: 'пустая строка', webkit: 'пустая строка' },
  { k: '`referrerpolicy="unsafe-url"`', chromium: '`https://shop.example/cart?id=42`', firefox: '`https://shop.example/`', webkit: '`https://shop.example/`' },
];

export const REFERRER_NOTE =
  'По умолчанию чужой фрейм узнаёт только источник родителя: путь и параметры отрезаны. `referrerpolicy` у фрейма меняет это для одного фрейма. Попросить полный адрес (`unsafe-url`) можно, но Firefox и WebKit на стенде всё равно отдали только источник.';

export const CREDENTIALLESS_NOTE =
  '`<iframe credentialless>` загружает чужой документ без кук и с чистым хранилищем, которое живёт до закрытия вкладки. Нужен страницам с заголовком `Cross-Origin-Embedder-Policy`: обычный чужой фрейм туда не встроить, а такой — можно. Зачем странице эти заголовки, разобрано в [«Безопасности фронтенда», раздел «Изоляция страницы»](/platform/security/#s7). На стенде атрибут есть только в Chromium: `\'credentialless\' in HTMLIFrameElement.prototype` — `true` в Chromium 153 и `false` в Firefox 155 и WebKit 26.6. Остальные браузеры атрибут молча пропустят и загрузят фрейм с куками.';

// ─── Раздел 6. Высота ─────────────────────────────────────────────────────────────────────
// Обе строки сторож исполняет как есть и проверяет: высота растёт, когда содержимого больше,
// и уменьшается обратно.

export const RESIZE_CHILD_CODE = `// https://widget.example/chat — внутри фрейма
const SHOP = 'https://shop.example';
const root = document.documentElement;

new ResizeObserver(() => {
  // высота самого содержимого: scrollHeight не меньше окна фрейма и не даст ему сжаться
  const height = Math.ceil(root.getBoundingClientRect().height);
  parent.postMessage({ type: 'resize', height }, SHOP);
}).observe(root);`;

export const RESIZE_PARENT_CODE = `// https://shop.example
const WIDGET = 'https://widget.example';
const chat = document.querySelector('#chat');

window.addEventListener('message', (event) => {
  if (event.origin !== WIDGET || event.source !== chat.contentWindow) return;
  if (event.data?.type === 'resize') chat.style.height = \`\${event.data.height}px\`;
});`;

export const PLAIN_RESIZE =
  'Родитель не видит, сколько текста внутри чужого фрейма, — как хозяин зала не видит, сколько гостей придёт к соседу. Поэтому сосед звонит сам: «нас стало двенадцать, нужен стол побольше». `ResizeObserver` внутри фрейма замечает перемену, `postMessage` сообщает её наружу, родитель меняет высоту тега.';

export const RESIZE_NOTE =
  'Считать надо высоту содержимого, а не окна. `document.documentElement.scrollHeight` никогда не меньше высоты самого фрейма. Фрейм с ним растёт, но не сжимается: на стенде пустой виджет так и остался 150 пикселей. С `getBoundingClientRect()` у корня — около 50 пикселей с одной строкой, около 400 с одиннадцатью и снова около 50, когда строки убрали. Сообщение доходит до родителя асинхронно, поэтому новая высота применяется на кадр позже, а между процессами — ещё позже. Почему, разобрано в [«Устройстве браузера», раздел «Цепочка»](/js/browser-architecture/#s4). Сам `ResizeObserver` — в [«Наблюдателях», раздел «Размеры»](/render/observers/#s3).';

export const GROW_NOTE =
  'Если высота содержимого зависит от высоты окна, получается петля. Типичный случай — `body { min-height: 100vh }` и обычный отступ у `body`. Фрейм стал выше — `100vh` выросло — содержимое снова выше окна на ширину отступов. На стенде такой фрейм за пару секунд вырос со 150 пикселей до тысячи с лишним во всех трёх движках и продолжал расти, пока страница была открыта. Во фрейме с этим протоколом не используют `vh` и `height: 100%` для высоты страницы.';

// ─── Раздел 7. История и клавиатура ───────────────────────────────────────────────────────

/**
 * `history.length` родителя. Снято в трёх движках (сравнивается прирост, а не число: Firefox
 * не считает начальный `about:blank` вкладки). Первые три строки — одинаково; на замене тега
 * Firefox уменьшил длину истории на число записей удалённого фрейма.
 */
export const HISTORY_ROWS = [
  { k: 'фрейм перешёл по ссылке или `location = …`', d: '+1 запись', tone: 'warn' as const },
  { k: 'родитель сменил `iframe.src`', d: '+1 запись', tone: 'warn' as const },
  { k: 'фрейм вызвал `location.replace(…)`', d: 'без новой записи', tone: 'ok' as const },
  { k: 'родитель заменил тег `<iframe>` новым', d: 'без новой записи; Firefox ещё и убирает записи старого фрейма', tone: 'ok' as const },
];

export const HISTORY_NOTE =
  'У вкладки одна история на все документы в ней. Переход внутри фрейма добавляет запись туда же, куда и переход страницы. Человек жмёт «Назад» и ждёт, что уйдёт со страницы, а вместо этого назад шагает фрейм. На стенде так вышло во всех трёх движках: после `history.back()` адрес страницы остался прежним, а фрейм вернулся на предыдущий адрес. Если переход внутри фрейма — служебный (сменили вкладку виджета, обновили баннер), его делают через `location.replace` внутри фрейма. Снаружи — заменой тега целиком, а не сменой `src`.';

export const KEYS_NOTE =
  'Пока фокус внутри фрейма, клавиатура достаётся документу фрейма. В родителе `document.activeElement` — сам тег `<iframe>`, а слушатель `keydown` на `window` родителя не срабатывает ни разу: событие всплывает только до `window` фрейма. Снято в трёх движках на фрейме своего источника. У чужого граница та же: событие принадлежит документу фрейма. Отсюда частая жалоба: модалка закрывается по `Esc`, пока человек не щёлкнул во фрейм внутри неё. Лечится так же, как высота: фрейм ловит клавишу у себя и сообщает родителю через `postMessage`.';

// ─── Раздел 8. Цена ───────────────────────────────────────────────────────────────────────

/** Родитель занят 500 мс; самый длинный промежуток между тиками таймера фрейма (раз в 10 мс). */
export const THREAD_ROWS = [
  { k: 'фрейм своего источника', chromium: '≈ 500 мс — ждал', full: '≈ 500 мс — ждал', others: '≈ 500 мс — ждал' },
  { k: 'фрейм чужого сайта', chromium: '≈ 500 мс — ждал', full: '≈ 10 мс — не заметил', others: '≈ 500 мс — ждал' },
];

export const THREAD_NOTE =
  'Фрейм своего сайта живёт в том же процессе и на том же главном потоке, что и родитель. Тяжёлый скрипт в одном вешает другой. Фрейм чужого сайта в полном Chromium уезжает в свой процесс и тикает дальше. В headless-сборке Chromium, а также в Firefox и WebKit из Playwright он на стенде ждал так же, как свой. Как браузеры делят процессы по сайтам, разобрано в [«Устройстве браузера», раздел «Site»](/js/browser-architecture/#s1), а главный поток — там же, в разделе [«Потоки»](/js/browser-architecture/#s3).';

export const WHEN_CASES = [
  {
    t: 'Свой виджет — компонент, а не фрейм',
    d: 'Кнопка, форма, график своего приложения не нуждаются в границе источников. Фрейм отнимет у них общую тему, общий стейт и высоту по содержимому. Если нужна только изоляция стилей, есть Shadow DOM: [«Стили веб-компонентов», раздел «Граница»](/render/web-components-styles/#s1).',
    tone: 'ok' as const,
  },
  {
    t: 'Чужой HTML без скриптов — `sandbox` без флагов',
    d: 'Письмо, предпросмотр Markdown, HTML из CMS. Документ рисуется, но не выполняет ни строчки и не видит вашей страницы.',
  },
  {
    t: 'Чужой код — песочница на отдельном источнике',
    d: 'Песочница кода, плагины, пользовательские темы. `sandbox="allow-scripts"` и адрес на отдельном домене. Результат живёт на отдельном домене, и даже ошибка во флагах не отдаёт куки основного сайта.',
  },
  {
    t: 'Сторонний сервис — его фрейм',
    d: 'Оплата, видео, карта, чат. Ваш скрипт не видит номер карты, их скрипт не видит вашу страницу. Платите вы процессом, задержкой загрузки и протоколом сообщений.',
  },
  {
    t: 'Микрофронтенды — обычно не фреймы',
    d: 'Фреймы дают полную изоляцию, но рвут историю, фокус, высоту и общую тему. Чаще части приложения собирают в одну страницу: [«Микрофронтенды и Module Federation», раздел «Зачем и чем платят»](/tooling/module-federation/#s1).',
    tone: 'warn' as const,
  },
  {
    t: 'Чтобы вас не встроили — заголовок',
    d: 'Ваш сайт тоже могут показать во фрейме чужой страницы и обмануть клик пользователя. Запрещает это `frame-ancestors` в CSP: [«Безопасность фронтенда», раздел «CSRF и кликджекинг»](/platform/security/#s5).',
    tone: 'err' as const,
  },
];

// ─── Тонкие места ─────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: "Секрет в `postMessage(…, '*')`",
    d: 'Фрейм могли увести на другой сайт, и сообщение уйдёт ему. Ошибки не будет. Указывайте источник адресата вторым аргументом.',
    tone: 'err',
  },
  {
    n: '02',
    t: 'Проверка `event.origin` через `includes` или `startsWith`',
    d: '`https://shop.example.evil.example` содержит `shop.example` и начинается с `https://shop.example`. Сравнивайте строгим равенством со списком точных источников.',
    tone: 'err',
  },
  {
    n: '03',
    t: '`allow-scripts allow-same-origin` для своего содержимого',
    d: 'Документ из `srcdoc` или с вашего источника с этой парой снимает с себя `sandbox` тремя строками. Песочницы фактически нет.',
    tone: 'err',
  },
  {
    n: '04',
    t: 'Чужой HTML в `srcdoc` без `sandbox`',
    d: 'Источник `srcdoc` — ваш. Скрипт из такого HTML читает ваши куки и меняет вашу страницу: это обычный XSS, только через фрейм.',
    tone: 'err',
  },
  {
    n: '05',
    t: '«Назад» листает фрейм',
    d: 'Каждый переход внутри фрейма — запись в общей истории вкладки. Служебные переходы — через `location.replace` или заменой тега.',
    tone: 'warn',
  },
  {
    n: '06',
    t: 'Фрейм растёт без конца',
    d: 'Высота содержимого зависит от высоты окна (`100vh`, `height: 100%`) — и протокол «сообщи высоту» превращается в петлю. И мерить надо содержимое, а не `scrollHeight`, иначе фрейм не сжимается.',
    tone: 'warn',
  },
  {
    n: '07',
    t: 'Горячие клавиши родителя молчат',
    d: 'Пока фокус во фрейме, `keydown` на странице не срабатывает. `Esc` для модалки фрейм должен переслать сам.',
    tone: 'warn',
  },
  {
    n: '08',
    t: 'Сообщение пришло раньше подписки',
    d: 'Событие `message` не ждёт слушателя. Фрейм, который сказал `ready` до того, как родитель подписался, так и не будет замечен. Подписывайтесь до вставки фрейма.',
    tone: 'warn',
  },
  {
    n: '09',
    t: '`instanceof` для объекта из фрейма',
    d: 'Массив из своего фрейма — не `instanceof Array` родителя: у фрейма свои встроенные объекты. Проверяйте `Array.isArray`, а данные лучше передавать сообщением.',
  },
  {
    n: '10',
    t: 'Кука во фрейме чужого сайта не приходит',
    d: 'Вход в виджете работает на его сайте и ломается во фрейме магазина. Это не баг фрейма, а политика сторонних кук: [«Встроенный контент без сторонних кук»](/platform/third-party-cookies/#s1).',
  },
];

// ─── Источники ────────────────────────────────────────────────────────────────────────────

export const SOURCES: Source[] = [
  {
    title: 'HTML Standard — The iframe element',
    href: 'https://html.spec.whatwg.org/multipage/iframe-embed-object.html#the-iframe-element',
    what: '`src`, `srcdoc`, `sandbox`, `allow`, `loading`, `referrerpolicy`, размер по умолчанию',
  },
  {
    title: 'HTML Standard — Sandboxing',
    href: 'https://html.spec.whatwg.org/multipage/browsers.html#sandboxing',
    what: 'флаги песочницы и что отнимает каждый, непрозрачный источник',
  },
  {
    title: 'HTML Standard — Cross-origin objects',
    href: 'https://html.spec.whatwg.org/multipage/nav-history-apis.html#crossoriginproperties-(-o-)',
    what: 'список свойств чужого окна и `then`',
  },
  {
    title: 'HTML Standard — Cross-document messaging',
    href: 'https://html.spec.whatwg.org/multipage/web-messaging.html#web-messaging',
    what: '`postMessage`, `targetOrigin`, `SyntaxError` для строки без схемы',
  },
  {
    title: 'MDN — <iframe>: The Inline Frame element',
    href: 'https://developer.mozilla.org/en-US/docs/Web/HTML/Element/iframe',
    what: 'атрибуты, поддержка `credentialless` и флагов, доступность',
  },
  {
    title: 'MDN — Window: postMessage()',
    href: 'https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage',
    what: 'проверка `origin` и `source`, советы по безопасности',
  },
  {
    title: 'MDN — Permissions Policy',
    href: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Permissions_Policy',
    what: 'атрибут `allow`, значения `\'src\'`, `\'self\'`, `\'none\'`, умолчания',
  },
  {
    title: 'W3C — WCAG Technique H64: Using the title attribute of the iframe element',
    href: 'https://www.w3.org/WAI/WCAG22/Techniques/html/H64',
    what: 'зачем фрейму `title`',
  },
  {
    title: 'Chrome for Developers — Iframe credentialless',
    href: 'https://developer.chrome.com/blog/iframe-credentialless',
    what: 'что делает `credentialless` и зачем он страницам с COEP',
  },
  {
    title: 'web.dev — It\'s time to lazy-load offscreen iframes!',
    href: 'https://web.dev/articles/iframe-lazy-loading',
    what: '`loading="lazy"` у фреймов',
  },
];

export const RELATED =
  'Смежное на сайте: [Безопасность фронтенда, раздел «CSRF и кликджекинг»](/platform/security/#s5) — как запретить встраивать свой сайт: `frame-ancestors` и `X-Frame-Options`. [Встроенный контент без сторонних кук](/platform/third-party-cookies/) — куки и хранилище фрейма на чужом сайте, Storage Access API. [MessageChannel](/js/message-channel/) — порты для долгого разговора с фреймом. [Устройство браузера](/js/browser-architecture/#s1) — сайт, процессы и фреймы в своём процессе. [XS-Leaks](/platform/xs-leaks/#s2) — что чужая страница узнаёт по вашим фреймам. [CSP и Trusted Types, раздел «Trusted Types»](/platform/csp/#s6) — `iframe.srcdoc` среди мест, куда Trusted Types не пускают строку.';
