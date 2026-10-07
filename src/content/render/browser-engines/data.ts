import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { EngineKey, EngineSnapshot } from '@/widgets/engine-probe/model/types';

/**
 * Данные темы «Три движка: чем браузеры отличаются на самом деле».
 *
 * Тема написана 2026-10-01 по просьбе автора курса. Почти всё в ней снято, а не пересказано:
 * один и тот же зонд исполнялся в трёх движках Playwright 1.63 — Chromium 153.0.8010.12,
 * Firefox 155.0, WebKit 26.6 — на macOS 26.6 (arm64), страница отдавалась по https через
 * перехват запросов (безопасный контекст). Где утверждение взято из документации, а не
 * снято, — так и сказано рядом.
 *
 * ⚠️ WebKit из Playwright — это движок WebKit, а не Safari: собственных частей Safari в нём
 * нет. Цифры «WebKit 26.6» — про движок, на котором стоит Safari 26, а не про сам Safari.
 *
 * Сторожа:
 *   - `ENGINE_SNAPSHOT` сверяет `tests/e2e/browser-engines.spec.ts`: открывает собранную
 *     страницу темы в трёх движках, читает ответы демо (тот же `model/probes.ts`)
 *     и требует совпадения со снимком;
 *   - там же — `TIMER_ROWS` (шаг таймера с изоляцией источника и без), порядок `DEPTH_ROWS`
 *     и строки `UA_ROWS`;
 *   - `DETECT_CODE` исполняется в `tests/unit/browser-engines.test.ts`.
 */

export const ENGINE_LABELS: Record<EngineKey, string> = {
  chromium: 'Chromium 153',
  firefox: 'Firefox 155',
  webkit: 'WebKit 26.6',
};

/* ──────────────────── Вводный раздел ──────────────────── */

export const PLAIN_ENGINES =
  'Как с машинами: марок много, а моторов на рынке единицы, и одна и та же коробка передач стоит под капотами у пяти марок. Поэтому «работает в Chrome» обычно значит «работает в Edge, Opera и Яндекс Браузере», а «работает в Safari» — «работает в любом браузере на iPhone».';

export const GLOSSARY = [
  {
    k: 'движок отрисовки',
    d: 'Часть браузера, которая превращает HTML и CSS в пиксели: разбор, стили, раскладка, отрисовка. Их три — **Blink**, **Gecko** и **WebKit**. Что он делает по шагам — в [«Кадре браузера»](/render/render-pipeline/).',
  },
  {
    k: 'JS-движок',
    d: 'Отдельная часть, которая исполняет JavaScript: **V8** (в Blink), **SpiderMonkey** (в Gecko), **JavaScriptCore** (в WebKit). Язык у них один — по стандарту ECMAScript, — а тексты ошибок, формат стека и пределы свои.',
  },
  {
    k: 'Chromium',
    d: 'Открытый проект, из которого собирают Chrome, Edge, Opera, Яндекс Браузер и другие. Chrome — это Chromium плюс закрытые части Google: обновления, кодеки, вход в аккаунт. Движок у всех один — Blink и V8.',
  },
  {
    k: 'проверка возможности',
    d: 'Вопрос к браузеру «есть ли у тебя вот это»: `\'postTask\' in scheduler`, `CSS.supports(…)`, `@supports` в CSS. Противоположность — проверка имени браузера по `navigator.userAgent`, которая врёт по построению (см. «Как с этим жить»).',
  },
  {
    k: 'на усмотрение реализации',
    d: 'Так спецификация помечает места, где ответ выбирает движок: текст сообщения об ошибке, разбор даты не в формате ISO, глубина стека. Код, который на такое опирается, работает в одном движке и тихо ломается в другом.',
  },
  {
    k: 'Baseline',
    d: 'Отметка на MDN и web.dev: возможность есть **во всех трёх движках** — «доступна недавно», а через 30 месяцев после этого — «доступна широко». Самый короткий ответ на вопрос «можно ли это уже использовать».',
  },
];

/* ──────────────────── Перед началом ──────────────────── */

export const PREREQ = [
  {
    t: 'Что движок отрисовки делает с кадром',
    d: 'Стили, раскладка, отрисовка, композиция — шаги одни во всех трёх движках, различается их реализация. Где в кадре что происходит и что из этого дорого, разобрано отдельно.',
    href: '/render/render-pipeline/',
    hrefLabel: 'Кадр браузера',
    tone: 'info' as const,
  },
  {
    t: 'Что такое изоляция источника',
    d: 'Заголовки `Cross-Origin-Opener-Policy` и `Cross-Origin-Embedder-Policy` переводят страницу в отдельную группу процессов. От этого зависит, насколько точный таймер получит ваш код, — в разделе «Одно API — разное поведение» это видно в цифрах.',
    href: '/js/browser-architecture/',
    hrefLabel: 'Устройство браузера',
    tone: 'warn' as const,
  },
  {
    t: 'Как устроен JS-движок изнутри',
    d: 'Формы объектов, ярусы компиляции, inline-кеши — на примере V8. У SpiderMonkey и JavaScriptCore идеи те же, а имена и пороги свои; эта тема про то, что из этого видно снаружи.',
    href: '/js/v8-engine/',
    hrefLabel: 'Движок V8',
    tone: 'info' as const,
  },
];

/* ──────────────────── Раздел 1 · кто есть кто ──────────────────── */

/** По документации проектов — не снималось: это вопрос устройства, а не поведения. */
export const WHO_ROWS = {
  head: ['что', 'движок отрисовки', 'JS-движок'],
  rows: [
    ['Chrome, Edge, Opera, Brave, Vivaldi, Яндекс Браузер, Samsung Internet', 'Blink', 'V8'],
    ['Firefox', 'Gecko', 'SpiderMonkey'],
    ['Safari', 'WebKit', 'JavaScriptCore'],
    ['**любой** браузер на iPhone и iPad — Chrome и Firefox тоже', 'WebKit', 'JavaScriptCore'],
    ['Electron: VS Code, Slack, Discord', 'Blink', 'V8'],
    ['Node.js и Deno', '—', 'V8'],
    ['Bun', '—', 'JavaScriptCore'],
  ],
  cols: 'minmax(260px,1.6fr) minmax(140px,.7fr) minmax(140px,.7fr)',
  kinds: ['prose', 'mono', 'mono'] as ('mono' | 'prose' | 'muted' | 'ok' | 'warn')[],
  minWidth: 600,
};

export const IOS_NOTE =
  'Строка про iPhone — правило App Store, а не выбор браузеров: приложение, которое показывает веб, обязано делать это через WebKit. Исключение одно — Евросоюз, где с iOS 17.4 браузер может принести свой движок (так пишет Apple в документации для разработчиков). Отсюда практическое: «Chrome на iPhone» — это WebKit с интерфейсом Chrome, и проверка в Chrome на компьютере про айфон не говорит ничего.';

export const PLAYWRIGHT_NOTE =
  'Все числа темы сняты на сборках Playwright: Chromium 153, Firefox 155 и WebKit 26.6. Это движки, а не готовые браузеры: в Chromium нет закрытых частей Chrome, а WebKit — не Safari, у Safari есть свои надстройки. Для вопросов этой темы — что умеет движок и как он отвечает — разница несущественна; для «как это выглядит у пользователя» её стоит помнить.';

/* ──────────────────── Раздел 2 · язык ──────────────────── */

/** Сняты дословно; имя ошибки нормативно (`TypeError` у всех), текст — нет. */
export const ERROR_ROWS = {
  head: ['что бросило', 'Chromium 153 (V8)', 'Firefox 155 (SpiderMonkey)', 'WebKit 26.6 (JavaScriptCore)'],
  rows: [
    ['`o.x`, где `o === undefined`', "Cannot read properties of undefined (reading 'x')", 'can\'t access property "x", o is undefined', "undefined is not an object (evaluating 'o.x')"],
    ['`o.f()`, где `o.f` нет', 'o.f is not a function', 'o.f is not a function', "o.f is not a function. (In 'o.f()', 'o.f' is undefined)"],
  ],
  cols: 'minmax(170px,.9fr) minmax(170px,1fr) minmax(170px,1fr) minmax(170px,1fr)',
  kinds: ['prose', 'mono', 'mono', 'mono'] as ('mono' | 'prose' | 'muted' | 'ok' | 'warn')[],
  minWidth: 760,
};

export const ERROR_NOTE =
  'Во всех трёх случаях бросается `TypeError` — имя ошибки задаёт стандарт. А текст сообщения стандарт оставляет движку, и движки им пользуются: V8 называет свойство, SpiderMonkey — переменную, JavaScriptCore цитирует выражение целиком. Поэтому сравнивать в коде можно имя и класс ошибки (`e instanceof TypeError`), а текст — только читать глазами.';

/** Снято в файле скрипта (не в `eval`): `inner` зовётся из `outer`, тот — с верхнего уровня. */
export const STACK_ROWS = {
  head: ['', 'Chromium 153', 'Firefox 155', 'WebKit 26.6'],
  rows: [
    ['первая строка', '`Error: x` — сообщение', 'сразу кадр', 'сразу кадр'],
    ['кадр `inner`', '`at inner (…/app.js:1:27)`', '`inner@…/app.js:1:27`', '`inner@…/app.js:1:36`'],
    ['кадр верхнего уровня', '`at …/app.js:3:16`', '`@…/app.js:3:16`', '`global code@…/app.js:3:21`'],
    ['`Error.stackTraceLimit`', '10', '128', '100'],
  ],
  cols: 'minmax(150px,.8fr) minmax(170px,1fr) minmax(170px,1fr) minmax(170px,1fr)',
  kinds: ['prose', 'mono', 'mono', 'mono'] as ('mono' | 'prose' | 'muted' | 'ok' | 'warn')[],
  minWidth: 720,
};

export const STACK_NOTE =
  'Свойства `stack` в стандарте ECMAScript нет вовсе — его придумал каждый движок сам, и форматы разошлись. Колонка у JavaScriptCore указывает на другое место той же строки: V8 и SpiderMonkey ставят её на начало выражения (`new` в строке с ошибкой, имя функции в строке вызова), JavaScriptCore — на открывающую скобку вызова. Сервис сбора ошибок, который разбирает стек одной регулярной строкой, в остальных движках получает кашу или пустоту. А `Error.stackTraceLimit` сегодня есть у всех трёх — но по умолчанию V8 хранит в стеке всего 10 кадров.';

/** `Date.parse(строка)`, результат — местная дата. Часовой пояс стенда — Москва (UTC+3). */
export const DATE_ROWS = {
  head: ['строка', 'Chromium 153', 'Firefox 155', 'WebKit 26.6'],
  rows: [
    ["`'01.10.2026'`", '**10 января** 2026', '**10 января** 2026', '`NaN`'],
    ["`'1/10/2026'`", '10 января 2026', '10 января 2026', '10 января 2026'],
    ["`'1 октября 2026'`", '`NaN`', '`NaN`', '`NaN`'],
    ["`'2026-10-01'`", 'полночь **UTC**', 'полночь **UTC**', 'полночь **UTC**'],
    ["`'2026-10-01T10:00'`", '10:00 **местного** времени', '10:00 **местного** времени', '10:00 **местного** времени'],
  ],
  cols: 'minmax(170px,.9fr) minmax(150px,1fr) minmax(150px,1fr) minmax(150px,1fr)',
  kinds: ['mono', 'prose', 'prose', 'prose'] as ('mono' | 'prose' | 'muted' | 'ok' | 'warn')[],
  minWidth: 680,
};

export const DATE_NOTE =
  'Стандарт гарантирует разбор ровно одного формата — ISO, `2026-10-01T10:00:00Z` и его укороченных вариантов. Всё остальное движок разбирает как умеет, и `01.10.2026` — 1 октября для русского читателя — Chromium и Firefox читают как американскую запись «месяц, день»: 10 января. WebKit такую строку не понимает вовсе. Две нижние строки одинаковы везде, потому что это уже стандарт, и в нём своя ловушка: дата без времени — это полночь по UTC, а дата со временем без пояса — местное время.';

/** Одна пустая стрелка `f = () => { n++; f(); }`, считаем вызовы до `RangeError`. */
export const DEPTH_ROWS = {
  head: ['', 'Chromium 153', 'Firefox 155', 'WebKit 26.6'],
  rows: [['вызовов до переполнения стека', '10 314', '19 408', '53 233']],
  cols: 'minmax(200px,1fr) minmax(120px,.6fr) minmax(120px,.6fr) minmax(120px,.6fr)',
  kinds: ['prose', 'mono', 'mono', 'mono'] as ('mono' | 'prose' | 'muted' | 'ok' | 'warn')[],
  minWidth: 600,
};

export const DEPTH_NOTE =
  'Пятикратная разница в глубине рекурсии. Число зависит и от размера кадра: чем больше у функции локальных переменных, тем меньше вызовов поместится (в Node 26.8 с тем же V8 десять переменных сокращают 10 379 вызовов до 5 661). Поэтому закреплён порядок, а не цифры: в WebKit глубже всего, в Chromium мельче всего. Рекурсивный обход дерева, проверенный в Safari на больших данных, в Chrome может упасть с `RangeError`.';

export const LANGUAGE_SAME =
  'Зато новое в самом языке приходит во все три движка быстро. На этих версиях везде есть `Temporal`, помощники итераторов (`Iterator.prototype.map`), `using`, `Float16Array`, `Promise.try`, `RegExp.escape`, `Math.sumPrecise`, `Error.isError` и `Uint8Array.fromBase64`. Расходятся не новые возможности языка, а всё, что стандарт оставил на усмотрение движка.';

/* ──────────────────── Раздел 3 · платформа ──────────────────── */

/**
 * Снимок ответов трёх движков на вопросы демо (`model/probes.ts`).
 *
 * Снят тем же кодом, что исполняет демо: собранная страница темы на `localhost` (это тоже
 * безопасный контекст), три движка Playwright 1.63, переключатель «все вопросы», ответы
 * прочитаны из `data-answer`. Совпадает с прямым замером тех же вопросов по https.
 * Сторож — `tests/e2e/browser-engines.spec.ts`: он делает то же и требует совпадения.
 */
export const ENGINE_SNAPSHOT: EngineSnapshot = {
  'err-undefined': { chromium: 'TypeError: Cannot read properties of undefined (reading \'x\')', firefox: 'TypeError: can\'t access property "x", o is undefined', webkit: 'TypeError: undefined is not an object (evaluating \'o.x\')' },
  'err-not-fn': { chromium: 'TypeError: o.f is not a function', firefox: 'TypeError: o.f is not a function', webkit: 'TypeError: o.f is not a function. (In \'o.f()\', \'o.f\' is undefined)' },
  'stack': { chromium: 'первая строка — «Error: x»; кадр «at inner (адрес:строка:колонка)»', firefox: 'сообщения в стеке нет; кадр «inner@адрес:строка:колонка»', webkit: 'сообщения в стеке нет; кадр «inner@адрес:строка:колонка»' },
  'stack-limit': { chromium: '10', firefox: '128', webkit: '100' },
  'date-dots': { chromium: '2026-01-10', firefox: '2026-01-10', webkit: 'NaN' },
  'date-slash': { chromium: '2026-01-10', firefox: '2026-01-10', webkit: '2026-01-10' },
  'date-russian': { chromium: 'NaN', firefox: 'NaN', webkit: 'NaN' },
  'temporal': { chromium: 'есть', firefox: 'есть', webkit: 'есть' },
  'iterator-helpers': { chromium: 'есть', firefox: 'есть', webkit: 'есть' },
  'using': { chromium: 'есть', firefox: 'есть', webkit: 'есть' },
  'css-scroll-timeline': { chromium: 'есть', firefox: 'нет', webkit: 'есть' },
  'css-interpolate-size': { chromium: 'есть', firefox: 'нет', webkit: 'нет' },
  'css-if': { chromium: 'есть', firefox: 'нет', webkit: 'есть' },
  'css-grid-lanes': { chromium: 'нет', firefox: 'нет', webkit: 'есть' },
  'css-reading-flow': { chromium: 'есть', firefox: 'нет', webkit: 'нет' },
  'css-anchor': { chromium: 'есть', firefox: 'есть', webkit: 'есть' },
  'css-has': { chromium: 'есть', firefox: 'есть', webkit: 'есть' },
  'scheduler': { chromium: 'есть', firefox: 'есть', webkit: 'нет' },
  'idle': { chromium: 'есть', firefox: 'есть', webkit: 'нет' },
  'set-html': { chromium: 'есть', firefox: 'есть', webkit: 'нет' },
  'move-before': { chromium: 'есть', firefox: 'есть', webkit: 'нет' },
  'file-picker': { chromium: 'есть', firefox: 'нет', webkit: 'нет' },
  'eye-dropper': { chromium: 'есть', firefox: 'нет', webkit: 'нет' },
  'view-transition': { chromium: 'есть', firefox: 'есть', webkit: 'есть' },
  'navigation': { chromium: 'есть', firefox: 'есть', webkit: 'есть' },
  'po-longtask': { chromium: 'есть', firefox: 'нет', webkit: 'нет' },
  'po-loaf': { chromium: 'есть', firefox: 'нет', webkit: 'нет' },
  'po-layout-shift': { chromium: 'есть', firefox: 'нет', webkit: 'нет' },
  'po-event': { chromium: 'есть', firefox: 'есть', webkit: 'есть' },
  'now-step': { chromium: '0.1 мс', firefox: '1 мс', webkit: '1 мс' },
};

export const DEMO_NOTE =
  'Те же вопросы задаются вашему браузеру прямо сейчас. Если вы читаете в Chrome, Edge или Яндекс Браузере, ответы почти совпадут с колонкой Chromium; в Safari и любом браузере на iPhone — с колонкой WebKit. Расхождение с ближайшей колонкой — это разница версий: снимок сделан на конкретных сборках, а ваш браузер мог уйти вперёд.';

export const PLATFORM_FACTS = [
  {
    t: 'CSS: новое приходит в разном порядке',
    d: 'Анимации по прокрутке (`animation-timeline: scroll()`) есть в Chromium и WebKit, но не в Firefox 155. `if()` — в Chromium и WebKit. Раскладка «кирпичами» (`display: grid-lanes`) пока только в WebKit, а `interpolate-size` и `reading-flow` — только в Chromium. Зато `:has()`, контейнерные запросы и привязка к якорю (`anchor-name`) есть везде.',
  },
  {
    t: 'API: у WebKit своя линия',
    d: 'Планировщика (`scheduler.postTask`), `requestIdleCallback`, `setHTML` и `moveBefore` нет в WebKit 26.6 — при том что в Firefox они есть. Доступ к файлам (`showOpenFilePicker`) и пипетка (`EyeDropper`) есть только в Chromium.',
  },
  {
    t: 'Метрики: половину видно только в Chromium',
    d: 'Типов наблюдателя `layout-shift`, `longtask` и `long-animation-frame` нет ни в Firefox, ни в WebKit. Значит, сдвиг раскладки (CLS) и длинные задачи у пользователей Firefox и Safari не снять вовсе — мониторинг видит только Chromium-аудиторию и молчит про остальных. А тип `event` — задержки обработки событий — есть у всех трёх.',
  },
];

/* ──────────────────── Раздел 4 · поведение ──────────────────── */

/**
 * Наименьший ненулевой шаг `performance.now()`: 300 000 вызовов подряд.
 * Изоляция — ответ страницы с `COOP: same-origin` и `COEP: require-corp`.
 */
export const TIMER_ROWS = {
  head: ['страница', 'Chromium 153', 'Firefox 155', 'WebKit 26.6'],
  rows: [
    ['обычная', '0.1 мс', '1 мс', '1 мс'],
    ['с изоляцией источника (COOP + COEP)', '0.005 мс', '0.02 мс', '1 мс'],
  ],
  cols: 'minmax(220px,1.2fr) minmax(120px,.6fr) minmax(120px,.6fr) minmax(120px,.6fr)',
  kinds: ['prose', 'mono', 'mono', 'mono'] as ('mono' | 'prose' | 'muted' | 'ok' | 'warn')[],
  minWidth: 620,
};

export const TIMER_NOTE =
  'Таймер огрубляют нарочно: точное время — это способ подсмотреть чужие данные через задержки процессора (атаки семейства Spectre). Насколько огрубить, каждый движок решает сам, и разброс — в двадцать раз на обычной странице. Изоляция источника возвращает точность в Chromium и Firefox, а WebKit оставляет миллисекунду в любом случае. Отсюда следствие для замеров: короткую операцию в Safari и Firefox через `performance.now()` не измерить — её надо повторить тысячу раз и делить.';

export const BEHAVIOR_FACTS = [
  {
    t: 'Кадр после клика по якорю',
    d: 'Клик по ссылке `#раздел` прокручивает страницу. В Chromium и WebKit к ближайшему `requestAnimationFrame` прокрутка уже случилась, в Firefox — ещё нет: кадр приходит раньше. Код вида «клик → кадр → посмотреть, где мы» в Firefox видит старую позицию. Этот курс на этом сам спотыкался — полоса разделов подтягивалась не к тому пункту, — и с тех пор её сторож гоняется в двух движках.',
  },
  {
    t: 'WebGPU: API есть, видеокарты может не быть',
    d: '`navigator.gpu` есть во всех трёх движках, а адаптер — не всегда: в режиме без окна его даёт только WebKit, Chromium — только с флагом и программный, Firefox — только с окном. Проверять надо адаптер, а не имя API — подробно в [«WebGPU», раздел «Поддержка и выбор»](/render/webgpu/#s6).',
  },
];

/* ──────────────────── Раздел 5 · как с этим жить ──────────────────── */

/** Исполняется в `tests/unit/browser-engines.test.ts`: в Node планировщика нет — работает запасной путь. */
export const DETECT_CODE = `// спросить возможность, а не имя браузера
const yieldToMain =
  globalThis.scheduler && 'yield' in globalThis.scheduler
    ? () => globalThis.scheduler.yield()
    : () => new Promise((resolve) => setTimeout(resolve, 0));

const scrollAnimations = typeof CSS !== 'undefined'
  && CSS.supports('animation-timeline: scroll()');`;

export const DETECT_NOTE =
  'Проверка возможности отвечает на тот вопрос, который вам на самом деле нужен: «могу ли я сделать вот это». В CSS то же самое пишут правилом `@supports (animation-timeline: scroll()) { … }`. Она переживает и новые версии, и новые браузеры: появится планировщик в WebKit — код начнёт им пользоваться без единой правки.';

/** `navigator.userAgent`, снятый на стенде — macOS 26.6 на процессоре Apple (arm64). */
export const UA_ROWS = {
  head: ['движок', 'что о себе пишет'],
  rows: [
    ['Chromium 153', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/153.0.8010.12 Safari/537.36'],
    ['Firefox 155', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:155.0) Gecko/20100101 Firefox/155.0'],
    ['WebKit 26.6', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Safari/605.1.15'],
  ],
  cols: 'minmax(130px,.4fr) minmax(320px,2fr)',
  kinds: ['prose', 'mono'] as ('mono' | 'prose' | 'muted' | 'ok' | 'warn')[],
  minWidth: 560,
};

export const UA_NOTE =
  'Строка `userAgent` врёт по построению, и все три — одинаково. Chromium называет себя и `AppleWebKit`, и `Safari` — наследие времён, когда сайты пускали только «известные» браузеры, и каждый новый притворялся предшественником. Все три пишут «Intel Mac OS X 10.15» — а стенд работает на macOS 26.6 и процессоре Apple: версию системы в строке браузеры заморозили, чтобы по ней нельзя было отличать пользователей. Проверка `userAgent.includes(\'Safari\')` срабатывает в Chrome; проверка версии macOS не видит ни одной версии новее 2019 года.';

export const TESTING_FACTS = [
  {
    t: 'Тестировать в трёх движках, а не в одном',
    d: 'Playwright ставит все три — `npx playwright install chromium firefox webkit` — и гоняет одни и те же проверки в каждом. Дешевле всего: вёрстку и палитру в одном движке, а поведение, где оно известно как разное, — во всех. Так устроены проверки этого курса: почти все идут в Chromium, сторож полосы разделов — ещё и в Firefox, а сторож этой темы — во всех трёх.',
  },
  {
    t: 'Айфон — отдельная проверка',
    d: 'WebKit из Playwright на компьютере ближе всего к Safari на iPhone, но это не он: другая система, другие шрифты, другое поведение клавиатуры и прокрутки. Для того, что зависит от устройства, нужен настоящий Safari на iOS или его симулятор.',
  },
  {
    t: 'Baseline вместо памяти',
    d: 'Вместо таблиц поддержки «по памяти» — отметка Baseline на MDN: возможность есть во всех трёх движках или нет. Для того, чего в Baseline ещё нет, — проверка возможности и запасной путь.',
  },
];

/* ──────────────────── Тонкие места ──────────────────── */

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: '`01.10.2026` — это 10 января или ничего',
    code: "Date.parse('01.10.2026')\n// Chromium, Firefox: 10 января 2026\n// WebKit: NaN",
    d: 'Любая строка не в формате ISO разбирается на усмотрение движка. Русскую запись даты Chromium и Firefox читают как американскую «месяц, день», WebKit не читает вовсе. → разбирать дату самому (по частям) или принимать только ISO: `2026-10-01`.',
    tone: 'err',
  },
  {
    n: '02',
    t: 'Сравнение текста ошибки работает в одном движке',
    code: "catch (e) {\n  if (e.message.includes('Cannot read properties')) { … }  // только V8\n  if (e instanceof TypeError) { … }                        // везде\n}",
    d: 'Текст сообщения у каждого движка свой — сравнение по нему тихо перестаёт срабатывать в Firefox и Safari. → сравнивать класс (`instanceof`) или имя (`e.name`).',
    tone: 'err',
  },
  {
    n: '03',
    t: 'Стек, разобранный под один формат',
    d: 'У V8 кадры начинаются с `at`, у SpiderMonkey и JavaScriptCore — с имени и `@`, первая строка с сообщением есть только у V8, а колонки JavaScriptCore указывают в другое место той же строки. → разбирать стек библиотекой, которая знает все три формата, и привязывать ошибки к исходникам через source map отдельно для каждого.',
    tone: 'warn',
  },
  {
    n: '04',
    t: 'Рекурсия, которая проходит в Safari и падает в Chrome',
    d: 'Глубина стека по умолчанию различается в пять раз: на пустой функции 10 тысяч вызовов в Chromium против 53 тысяч в WebKit. → глубокие обходы писать циклом со своим стеком, а не рекурсией, и проверять на самых глубоких данных в Chromium.',
    tone: 'warn',
  },
  {
    n: '05',
    t: '«Chrome на iPhone» — это WebKit',
    d: 'На iOS любой браузер обязан показывать веб через WebKit. Проверка в Chrome на компьютере ничего не говорит о Chrome на айфоне: у них разные движки. → айфонную аудиторию проверять в WebKit, а лучше — в настоящем Safari.',
    tone: 'warn',
  },
  {
    n: '06',
    t: 'Метрики из Chromium выдают за метрики всех',
    d: 'Сдвиг раскладки и длинные задачи снимаются только в Chromium: у Firefox и WebKit нужных типов наблюдателя нет. Дашборд, где CLS «в норме», показывает норму у части пользователей и молчит про остальных. → подписывать в мониторинге, по какой аудитории снята метрика.',
    tone: 'err',
  },
];

/* ──────────────────── Источники ──────────────────── */

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'ECMA-262 · Date.parse и формат строки даты',
    href: 'https://tc39.es/ecma262/#sec-date.parse',
    what: 'Почему гарантирован только ISO: всё остальное — «implementation-specific heuristics». Там же правило «дата без времени — UTC, дата со временем — местное время».',
  },
  {
    title: 'V8 · Stack trace API',
    href: 'https://v8.dev/docs/stack-trace-api',
    what: 'Откуда формат `at имя (адрес)`, `Error.stackTraceLimit` и `Error.captureStackTrace` — изобретение V8, которое остальные движки переняли частично.',
  },
  {
    title: 'MDN · Error.prototype.stack',
    href: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/stack',
    what: 'Свойство вне стандарта, примеры форматов в разных движках.',
  },
  {
    title: 'W3C · High Resolution Time, «Clock resolution»',
    href: 'https://w3c.github.io/hr-time/#clock-resolution',
    what: 'Почему таймер огрубляют и почему изоляция источника разрешает вернуть точность.',
  },
  {
    title: 'web.dev · Baseline',
    href: 'https://web.dev/baseline',
    what: 'Что значат «доступно недавно» и «доступно широко» и как читать отметку на MDN.',
  },
  {
    title: 'Apple · Alternative browser engines in the EU',
    href: 'https://developer.apple.com/support/alternative-browser-engines/',
    what: 'Где и с какой версии iOS браузер может принести свой движок вместо WebKit.',
  },
  {
    title: 'Playwright · Browsers',
    href: 'https://playwright.dev/docs/browsers',
    what: 'Какие сборки Chromium, Firefox и WebKit ставит Playwright и чем они отличаются от Chrome, Firefox и Safari.',
  },
];

export const RELATED =
  'Смежное на сайте: [Устройство браузера](/js/browser-architecture/) — процессы и изоляция, от которой зависит точность таймера. [Кадр браузера](/render/render-pipeline/) — что делает движок отрисовки на каждом кадре. [Движок V8](/js/v8-engine/) — один из трёх JS-движков изнутри. [WebGPU](/render/webgpu/) — поддержка по движкам на примере одного API. [Планирование задач](/js/task-scheduling/) — что делать, когда планировщика нет.';
