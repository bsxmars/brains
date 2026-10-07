import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { GuardRun, GuardScenario, RouterCodes, ShopLevel, Strategy } from '@/widgets/router-lab/model/types';

/**
 * Данные темы «Роутер изнутри: от адреса до экрана».
 *
 * Тема написана 2026-10-01 для направления «Фреймворки изнутри». Чего здесь нет намеренно,
 * потому что разобрано рядом: bfcache, предрендер и мягкие навигации в метриках
 * (`/platform/instant-navigation/#s6`), путь события и делегирование (`/render/dom-events/#s5`),
 * `startViewTransition` (`/render/view-transitions/#s1`), чанки и `__vitePreload`
 * (`/tooling/modules/#s5`), кеш данных по ключу (`/frameworks/data-cache/#s2`), запасной
 * `404.html` для клиентских маршрутов на статике (`/delivery/github-pages/#s3`).
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * vue-router **5.3.1** и vue **3.5.42** из `node_modules` проекта, happy-dom 20.14.5,
 * Node 24.11.0, Chromium **153.0.8010.12** (Playwright 1.63, headless shell), macOS.
 * Свой `node:http` на портах 51500–51599. Октябрь 2026.
 *
 * Node, детерминированно:
 * - регулярки, веса и ключи шаблонов (`PATTERN_ROWS`) — `createRouterMatcher` из vue-router;
 * - порядок сквозной таблицы (`RANKED`) — `router.getRoutes()`, разбор адресов
 *   (`RESOLVE_ROWS`) — `router.resolve()`;
 * - журналы guards (`GUARD_TRACES`) — `createRouter` + `createMemoryHistory`, приложение
 *   смонтировано во Vue в happy-dom (иначе `beforeRouteLeave`/`Update` не вызываются: им нужен
 *   экземпляр компонента);
 * - шкалы загрузки (`WATERFALL`) — тот же роутер с Vue, `import()` и загрузчики на виртуальных
 *   часах: время двигается только скриптом, между таймерами доигрываются микрозадачи.
 *   Миллисекунды — условные задержки стенда, а не замер.
 *
 * Chromium, свой сервер:
 * - события на `pushState`/`replaceState`/`back`/`location.hash` (`HISTORY_ROWS`, `CLONE_FACTS`);
 * - событие `navigate` для каждого способа перейти (`NAVIGATE_ROWS`) и прокрутка/фокус после
 *   `intercept()` (`NAVAPI_SCROLL`);
 * - настоящие клики Playwright по восьми ссылкам с модификаторами (`CLICK_STAND`): что сделал
 *   браузер и что решила `shouldIntercept`. ⚠️ macOS: Ctrl+клик там — контекстное меню, событий
 *   `click` нет вовсе; «Ctrl+клик открывает вкладку» на Windows и Linux взято из документации;
 * - vue-router, собранный esbuild, с `createWebHistory`: `history.state`, `scrollRestoration`,
 *   аргументы `scrollBehavior`, прокрутка после «назад» (`SCROLL_STAND`); то же без роутера.
 * - `typeof navigation` в Firefox 155 и WebKit 26.6 (`NAVAPI_ENGINES`) — тем же Playwright.
 *
 * Учебный роутер — строки `MATCH_CODE`, `RANK_CODE`, `MATCHER_CODE`, `NAVIGATE_CODE`,
 * `GUARDS_CODE`, `ROUTES_CODE`, `SHOP_CODE`, `LOADERS_CODE`, `INTERCEPT_CODE`, `HISTORY_CODE`,
 * `NAVAPI_CODE`, `SCROLL_CODE`. Демо (`widgets/router-lab`) исполняет их через `new Function`.
 * `tests/unit/router.test.ts` сверяет: регулярки и веса — с `createRouterMatcher` на всех
 * шаблонах темы; порядок и `resolve` — с vue-router на сотнях случайных таблиц маршрутов;
 * журналы guards и шкалы загрузки — с vue-router во Vue; `shouldIntercept`, `HISTORY_CODE`,
 * `NAVAPI_CODE` и `SCROLL_CODE` — исполнением в Chromium. Литералы стенда там же пересобираются.
 *
 * Не снято, взято из документации и исходников (`SOURCES`): поведение Ctrl+клика вне macOS;
 * пункт «Открыть в новой вкладке» контекстного меню и адрес в строке состояния (`LINK_ROWS`);
 * `loader` React Router (`WATERFALL_NOTE`); экспериментальные загрузчики данных
 * vue-router (`DataLoaderPlugin`, `defineBasicLoader` из `vue-router/experimental` — экспорт
 * в 5.3.1 есть, сами не запускались).
 *
 * Одно расхождение учебного роутера с настоящим известно и закреплено тестом: в гонке двух
 * навигаций (`race`) строки журнала те же и отменена та же навигация, но `afterEach` отменённой
 * у vue-router приходит на одну строку позже — у него больше промежуточных промисов.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'History API',
    d: '`history.pushState`, `history.replaceState` и событие `popstate`. Позволяет сменить адрес во вкладке без загрузки нового документа. Каждый переход добавляет **запись истории** — шаг, на который вернёт кнопка «назад».',
  },
  {
    k: '`popstate`',
    d: 'Событие окна: пользователь или код прошёл по истории — «назад», «вперёд», `history.go(n)`. На `pushState` оно **не** приходит.',
  },
  {
    k: 'Navigation API',
    d: 'Объект `navigation` и его событие `navigate`. Браузер сообщает в нём о любом переходе в этой вкладке и даёт перехватить его вызовом `intercept()`.',
  },
  {
    k: 'маршрут',
    d: 'Запись в таблице роутера: шаблон пути (`/users/:id`), компонент, имя и вложенные маршруты. Роутер ищет запись, чей шаблон подходит к адресу.',
  },
  {
    k: 'параметр пути',
    d: 'Часть шаблона с двоеточием: `:id` в `/users/:id`. Для адреса `/users/42` параметр `id` равен `\'42\'` — всегда строке.',
  },
  {
    k: 'вес маршрута',
    d: 'Числа, которые роутер считает по шаблону: текст весит больше параметра, параметр — больше «чего угодно». По весу маршруты сортируются, и побеждает первый подходящий.',
  },
  {
    k: '`matched`',
    d: 'Цепочка найденных записей: от внешнего макета до самого вложенного маршрута. Каждый `<RouterView>` рисует свой уровень этой цепочки.',
  },
  {
    k: 'navigation guard',
    d: 'Функция, которую роутер вызывает во время перехода. Может пропустить его, отменить (`false`) или перенаправить (вернуть другой адрес).',
  },
  {
    k: 'ленивый маршрут',
    d: 'Маршрут, чей компонент задан функцией `() => import(\'./Page.js\')`. Код страницы скачивается отдельным файлом при первом переходе на неё.',
  },
  {
    k: 'водопад запросов',
    d: 'Запросы, которые идут друг за другом, хотя могли бы параллельно: второй стартует, только когда пришёл первый. Время складывается, а не берётся наибольшее.',
  },
];

export const PLAIN_ROUTER =
  'Как администратор в большом офисе с одним входом. Посетитель называет кабинет — администратор не выпускает его на улицу искать другое здание, а сам открывает нужную дверь внутри. Если посетитель хочет уйти в соседнее здание или просит пропуск «на потом», администратор не мешает. А прежде чем пустить, сверяется со списком: можно ли сюда этому человеку.';

export const PREREQ_NOTE =
  'Роутер стоит на трёх вещах из браузера: событиях DOM, истории вкладки и динамическом `import()`. Ещё нужны промисы — каждый guard может быть асинхронным, и роутер ждёт их по очереди.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'Действие по умолчанию и делегирование',
    d: 'Клик по ссылке — событие, у которого есть действие браузера: переход. `preventDefault()` его отменяет. Один слушатель на `document` ловит клики по всем ссылкам — через всплытие и `closest`.',
    href: '/render/dom-events/#s4',
    hrefLabel: '«События DOM», разделы «Действие по умолчанию» и «Делегирование»',
    tone: 'info',
  },
  {
    t: 'Документ против экрана SPA',
    d: 'Настоящая навигация меняет документ: новый HTML, новые скрипты. Переход внутри SPA меняет только адрес и часть страницы — документ остаётся тем же.',
    href: '/platform/instant-navigation/#s6',
    hrefLabel: '«Навигации без ожидания», раздел «Подсказки, SPA и метрики»',
    tone: 'info',
  },
  {
    t: 'Динамический `import()` и чанки',
    d: '`import(\'./Page.js\')` возвращает промис модуля. Сборщик выносит такой модуль в отдельный файл, и браузер скачивает его, только когда функцию вызвали.',
    href: '/tooling/modules/#s5',
    hrefLabel: '«Модули и сборка», раздел «Чанки и кеш»',
    tone: 'info',
  },
  {
    t: '`Promise.all` и ожидание по очереди',
    d: '`await` в цикле ждёт промисы один за другим. `Promise.all` запускает всё сразу и ждёт самого долгого. Разница между ними — разница между водопадом и параллельной загрузкой.',
    href: '/js/promise-internals/#s4',
    hrefLabel: '«Промис изнутри», раздел «Комбинаторы»',
    tone: 'info',
  },
  {
    t: 'Регулярные выражения',
    d: 'Шаблон пути роутер превращает в регулярку. Нужно читать `^`, `$`, группы `( )`, `?` и `[^/]+?` — «один или больше символов, кроме косой черты».',
    tone: 'info',
  },
];

// ─── Раздел 1. История вкладки ─────────────────────────────────────────────────────────────

export const INTERCEPT_CODE = `// Забрать клик себе или отдать браузеру. here — текущий адрес (new URL(location.href)).
function shouldIntercept(event, here) {
  if (event.defaultPrevented) return false;          // клик уже кто-то обработал
  if (event.button !== 0) return false;              // не левая кнопка
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return false;                                    // вкладка, окно, загрузка — решает браузер
  }
  const link = event.target.closest('a[href]');
  if (!link) return false;                           // клик не по ссылке
  if (link.target && link.target !== '_self') return false; // просили другое окно
  if (link.hasAttribute('download')) return false;   // просили скачать
  const to = new URL(link.href);
  if (to.origin !== here.origin) return false;       // чужой сайт, mailto:, tel:
  if (to.pathname === here.pathname && to.search === here.search && to.hash) {
    return false;                                    // якорь на этой же странице
  }
  return true;
}`;

export const HISTORY_CODE = `// Роутер на History API в двадцать строк. render(path) рисует экран по адресу.
function startRouter(render) {
  function go(path, { replace = false } = {}) {
    if (replace) history.replaceState({ path }, '', path);
    else history.pushState({ path }, '', path);
    render(location.pathname);       // pushState не шлёт popstate — рисуем сами
  }
  // «Назад» и «вперёд»: адрес уже сменён браузером, осталось нарисовать.
  addEventListener('popstate', () => render(location.pathname));
  // Клик по ссылке внутри сайта — забрать себе, остальное отдать браузеру.
  document.addEventListener('click', (event) => {
    if (!shouldIntercept(event, new URL(location.href))) return;
    event.preventDefault();
    const to = new URL(event.target.closest('a').href);
    go(to.pathname + to.search + to.hash);
  });
  render(location.pathname);
  return go;
}`;

export const PLAIN_HISTORY =
  'История вкладки — стопка карточек с адресами. `pushState` кладёт новую карточку сверху и ничего не показывает: что нарисовать, решает ваш код. «Назад» снимает верхнюю карточку — и только тогда браузер звонит вам событием `popstate`: «адрес теперь такой, нарисуй».';

/**
 * Что пришло в окно на каждое действие с историей, по порядку. Chromium 153; тест пересобирает.
 * `navigate:push` — событие Navigation API, `popstate:{…}` — с `event.state`, `hashchange`.
 */
export const HISTORY_STAND: { action: string; events: string[] }[] = [
  {
    "action": "`history.pushState({ n: 1 }, '', '/a')`",
    "events": [
      "navigate:push"
    ]
  },
  {
    "action": "`history.pushState({ n: 2 }, '', '/b')`",
    "events": [
      "navigate:push"
    ]
  },
  {
    "action": "`history.replaceState({ n: 3 }, '', '/c')`",
    "events": [
      "navigate:replace"
    ]
  },
  {
    "action": "`history.back()`",
    "events": [
      "navigate:traverse",
      "popstate:{\"n\":1}"
    ]
  },
  {
    "action": "`history.forward()`",
    "events": [
      "navigate:traverse",
      "popstate:{\"n\":3}"
    ]
  },
  {
    "action": "`location.hash = '#top'`",
    "events": [
      "navigate:push",
      "popstate:null",
      "hashchange"
    ]
  },
  {
    "action": "`history.back() с якоря`",
    "events": [
      "navigate:traverse",
      "popstate:{\"n\":3}",
      "hashchange"
    ]
  }
];

/** Таблица для текста — из `HISTORY_STAND`. */
export const HISTORY_ROWS = HISTORY_STAND.map(({ action, events }) => {
  const pop = events.find((e) => e.startsWith('popstate:'));
  const rest = events.filter((e) => !e.startsWith('popstate:') && !e.startsWith('navigate:'));
  return {
    action,
    popstate: pop ? `да, \`state\`: \`${pop.slice('popstate:'.length)}\`` : '**нет**',
    other: rest.length ? rest.map((e) => `\`${e}\``).join(', ') : '—',
    tone: pop ? ('ok' as const) : ('warn' as const),
  };
});

export const HISTORY_NOTE =
  '`pushState` и `replaceState` меняют адрес и запись истории **синхронно и молча**: событий окна нет, экран прежний. Поэтому роутер после `pushState` рисует сам. `popstate` приходит, когда браузер прошёл по истории: «назад», «вперёд», `history.go(n)` — и когда сменился якорь в адресе. Отсюда два обработчика в любом роутере: на клик и на `popstate`.';

/** `history.state` — копия, а не ссылка. Chromium 153. */
export const CLONE_FACTS: { what: string; result: string }[] = [
  {
    "what": "`Date` в состоянии",
    "result": "`history.state.d instanceof Date` — true, `=== d` — false"
  },
  {
    "what": "`Map` в состоянии",
    "result": "`instanceof Map` — true, `get(1)` — 2"
  },
  {
    "what": "функция в состоянии",
    "result": "`DataCloneError`"
  },
  {
    "what": "адрес другого сайта",
    "result": "`SecurityError`"
  }
];

export const STATE_NOTE =
  'Первый аргумент `pushState` браузер кладёт в запись истории структурным клонированием — тем же алгоритмом, что `structuredClone`. `history.state` возвращает копию: `Date` и `Map` переживают путь, функция — нет. Адрес другого сайта подставить нельзя: `pushState` меняет адрес только в пределах своего источника.';

export const HASH_NOTE =
  'До History API роутеры жили в якоре: `/#/users/42`. Сервер такой адрес не видит — всё после `#` остаётся в браузере, — поэтому на любой «страницу» он отдаёт один `index.html`. С `pushState` адрес настоящий: `/users/42` уходит на сервер при перезагрузке, и сервер обязан ответить тем же `index.html`, а не 404. На статическом хостинге это решают запасной страницей — как в теме [«GitHub Pages», раздел «Маршрутизация без сервера»](/delivery/github-pages/#s3).';

// ─── Раздел 2. Navigation API ──────────────────────────────────────────────────────────────

export const NAVAPI_CODE = `// Тот же роутер на Navigation API: одно событие на все способы перейти.
function startRouter(render) {
  navigation.addEventListener('navigate', (event) => {
    // Чужой сайт, загрузка файла, якорь на странице — не наше дело.
    if (!event.canIntercept || event.hashChange || event.downloadRequest !== null) return;
    const to = new URL(event.destination.url);
    event.intercept({
      async handler() {
        await render(to.pathname);   // адрес уже сменён, экран дорисуется здесь
      },
    });
  });
  render(location.pathname);
}`;

export interface NavigateSeen {
  type: string;
  canIntercept: boolean;
  userInitiated: boolean;
  hashChange: boolean;
  download: string | null;
}

/** Событие `navigate` на разные способы перейти; `null` — события не было. Chromium 153; тест пересобирает. */
export const NAVIGATE_STAND: { how: string; seen: NavigateSeen | null }[] = [
  {
    "how": "`history.pushState(…)`",
    "seen": {
      "type": "push",
      "canIntercept": true,
      "userInitiated": false,
      "hashChange": false,
      "download": null
    }
  },
  {
    "how": "`history.back()`",
    "seen": {
      "type": "traverse",
      "canIntercept": true,
      "userInitiated": false,
      "hashChange": false,
      "download": null
    }
  },
  {
    "how": "клик по своей ссылке",
    "seen": {
      "type": "push",
      "canIntercept": true,
      "userInitiated": true,
      "hashChange": false,
      "download": null
    }
  },
  {
    "how": "клик по ссылке на другой сайт",
    "seen": {
      "type": "push",
      "canIntercept": false,
      "userInitiated": true,
      "hashChange": false,
      "download": null
    }
  },
  {
    "how": "клик по `download`",
    "seen": {
      "type": "push",
      "canIntercept": true,
      "userInitiated": true,
      "hashChange": false,
      "download": ""
    }
  },
  {
    "how": "клик по `mailto:`",
    "seen": {
      "type": "push",
      "canIntercept": false,
      "userInitiated": true,
      "hashChange": false,
      "download": null
    }
  },
  {
    "how": "клик по якорю",
    "seen": {
      "type": "push",
      "canIntercept": true,
      "userInitiated": true,
      "hashChange": true,
      "download": null
    }
  },
  {
    "how": "⌘ + клик по своей ссылке",
    "seen": null
  },
  {
    "how": "клик по `target=\"_blank\"`",
    "seen": null
  }
];

/** Таблица для текста — из `NAVIGATE_STAND`. */
export const NAVIGATE_ROWS = NAVIGATE_STAND.map(({ how, seen }) => {
  if (!seen) return { how, type: 'события нет', canIntercept: '—', extra: 'открылась другая вкладка', tone: 'info' as const };
  const extra = [
    seen.userInitiated ? '`userInitiated`' : '',
    seen.hashChange ? '`hashChange`' : '',
    seen.download !== null ? `\`downloadRequest: "${seen.download}"\`` : '',
  ].filter(Boolean);
  return {
    how,
    type: `\`${seen.type}\``,
    canIntercept: seen.canIntercept ? 'да' : '**нет**',
    extra: extra.join(', ') || '—',
    tone: !seen.canIntercept || seen.download !== null || seen.hashChange ? ('warn' as const) : ('ok' as const),
  };
});

export const NAVIGATE_NOTE =
  'Одно событие на все пути: клик по ссылке, `pushState`, «назад», `navigation.navigate()`. Браузер сам заполняет то, что роутер на History API вычисляет руками: чужой ли адрес (`canIntercept: false`), просили ли скачать (`downloadRequest`), меняется ли только якорь (`hashChange`). Клики с модификаторами и ссылки с `target="_blank"` события не дают вовсе: они открывают другую вкладку, а не меняют эту.';

/** Порядок событий у перехваченного `navigation.navigate('/nav')`. */
export const NAVAPI_ORDER: string[] = [
  "navigate",
  "currententrychange",
  "handler",
  "committed",
  "handler done",
  "navigatesuccess",
  "finished"
];

export const NAVAPI_ORDER_NOTE =
  'После `intercept()` адрес меняется сразу, ещё до обработчика. `navigatesuccess` и промис `finished` ждут, пока обработчик закончит. `preventDefault()` в `navigate` отменяет переход: адрес не меняется, оба промиса отклоняются с `AbortError`.';

/** Есть ли `navigation` и `NavigateEvent.prototype.intercept` в трёх движках. */
export const NAVAPI_ENGINES: { engine: string; has: boolean }[] = [
  {
    "engine": "Chromium 153",
    "has": true
  },
  {
    "engine": "Firefox 155",
    "has": true
  },
  {
    "engine": "WebKit 26.6",
    "has": true
  }
];

// ─── Раздел 3. Перехват клика ──────────────────────────────────────────────────────────────

export const CLICK_LINKS: { id: string; html: string }[] = [
  { id: 'in', html: '<a href="/users/7">' },
  { id: 'query', html: '<a href="/users?page=2">' },
  { id: 'inner', html: '<a href="/users/8"><span>…</span></a>' },
  { id: 'hash', html: '<a href="#top">' },
  { id: 'out', html: '<a href="http://localhost:…/users/7">' },
  { id: 'blank', html: '<a href="/users/7" target="_blank">' },
  { id: 'dl', html: '<a href="/users/7" download>' },
  { id: 'mail', html: '<a href="mailto:a@b.c">' },
];

export const CLICK_ACTIONS: { id: string; label: string }[] = [
  { id: 'plain', label: 'клик' },
  { id: 'meta', label: '⌘ + клик' },
  { id: 'shift', label: 'Shift + клик' },
  { id: 'alt', label: 'Alt + клик' },
  { id: 'middle', label: 'средняя кнопка' },
  { id: 'enter', label: 'Tab, Enter' },
  { id: 'ctrl', label: 'Ctrl + клик (macOS)' },
];

export interface ClickRow {
  link: string;
  action: string;
  /** Какое событие пришло на `document`: `click`, `auxclick` или никакое. */
  event: 'click' | 'auxclick' | null;
  /** `navigate` в этой вкладке: `same` — перехватываемый переход, `hash`, `leave` — чужой документ, `download`. */
  navigate: 'same' | 'hash' | 'leave' | 'download' | null;
  popup: boolean;
  download: boolean;
  /** Что ответила `shouldIntercept`; `null` — `click` не пришёл. */
  decision: boolean | null;
}

/** Настоящие клики в Chromium 153 (macOS). Тест пересобирает. */
export const CLICK_STAND: ClickRow[] = [
  {
    "link": "in",
    "action": "plain",
    "event": "click",
    "navigate": "same",
    "popup": false,
    "download": false,
    "decision": true
  },
  {
    "link": "in",
    "action": "meta",
    "event": "click",
    "navigate": null,
    "popup": true,
    "download": false,
    "decision": false
  },
  {
    "link": "in",
    "action": "shift",
    "event": "click",
    "navigate": null,
    "popup": true,
    "download": false,
    "decision": false
  },
  {
    "link": "in",
    "action": "alt",
    "event": "click",
    "navigate": null,
    "popup": false,
    "download": false,
    "decision": false
  },
  {
    "link": "in",
    "action": "middle",
    "event": "auxclick",
    "navigate": null,
    "popup": true,
    "download": true,
    "decision": null
  },
  {
    "link": "in",
    "action": "enter",
    "event": "click",
    "navigate": "same",
    "popup": false,
    "download": false,
    "decision": true
  },
  {
    "link": "in",
    "action": "ctrl",
    "event": null,
    "navigate": null,
    "popup": false,
    "download": false,
    "decision": null
  },
  {
    "link": "query",
    "action": "plain",
    "event": "click",
    "navigate": "same",
    "popup": false,
    "download": false,
    "decision": true
  },
  {
    "link": "query",
    "action": "meta",
    "event": "click",
    "navigate": null,
    "popup": true,
    "download": false,
    "decision": false
  },
  {
    "link": "query",
    "action": "shift",
    "event": "click",
    "navigate": null,
    "popup": true,
    "download": false,
    "decision": false
  },
  {
    "link": "query",
    "action": "alt",
    "event": "click",
    "navigate": null,
    "popup": false,
    "download": false,
    "decision": false
  },
  {
    "link": "query",
    "action": "middle",
    "event": "auxclick",
    "navigate": null,
    "popup": true,
    "download": true,
    "decision": null
  },
  {
    "link": "query",
    "action": "enter",
    "event": "click",
    "navigate": "same",
    "popup": false,
    "download": false,
    "decision": true
  },
  {
    "link": "query",
    "action": "ctrl",
    "event": null,
    "navigate": null,
    "popup": false,
    "download": false,
    "decision": null
  },
  {
    "link": "inner",
    "action": "plain",
    "event": "click",
    "navigate": "same",
    "popup": false,
    "download": false,
    "decision": true
  },
  {
    "link": "inner",
    "action": "meta",
    "event": "click",
    "navigate": null,
    "popup": true,
    "download": false,
    "decision": false
  },
  {
    "link": "inner",
    "action": "shift",
    "event": "click",
    "navigate": null,
    "popup": true,
    "download": false,
    "decision": false
  },
  {
    "link": "inner",
    "action": "alt",
    "event": "click",
    "navigate": null,
    "popup": false,
    "download": false,
    "decision": false
  },
  {
    "link": "inner",
    "action": "middle",
    "event": "auxclick",
    "navigate": null,
    "popup": true,
    "download": true,
    "decision": null
  },
  {
    "link": "inner",
    "action": "enter",
    "event": "click",
    "navigate": "same",
    "popup": false,
    "download": false,
    "decision": true
  },
  {
    "link": "inner",
    "action": "ctrl",
    "event": null,
    "navigate": null,
    "popup": false,
    "download": false,
    "decision": null
  },
  {
    "link": "hash",
    "action": "plain",
    "event": "click",
    "navigate": "hash",
    "popup": false,
    "download": false,
    "decision": false
  },
  {
    "link": "hash",
    "action": "meta",
    "event": "click",
    "navigate": null,
    "popup": true,
    "download": false,
    "decision": false
  },
  {
    "link": "hash",
    "action": "shift",
    "event": "click",
    "navigate": null,
    "popup": true,
    "download": false,
    "decision": false
  },
  {
    "link": "hash",
    "action": "alt",
    "event": "click",
    "navigate": null,
    "popup": false,
    "download": false,
    "decision": false
  },
  {
    "link": "hash",
    "action": "middle",
    "event": "auxclick",
    "navigate": null,
    "popup": true,
    "download": true,
    "decision": null
  },
  {
    "link": "hash",
    "action": "enter",
    "event": "click",
    "navigate": "hash",
    "popup": false,
    "download": false,
    "decision": false
  },
  {
    "link": "hash",
    "action": "ctrl",
    "event": null,
    "navigate": null,
    "popup": false,
    "download": false,
    "decision": null
  },
  {
    "link": "out",
    "action": "plain",
    "event": "click",
    "navigate": "leave",
    "popup": false,
    "download": false,
    "decision": false
  },
  {
    "link": "out",
    "action": "meta",
    "event": "click",
    "navigate": null,
    "popup": true,
    "download": false,
    "decision": false
  },
  {
    "link": "out",
    "action": "shift",
    "event": "click",
    "navigate": null,
    "popup": true,
    "download": false,
    "decision": false
  },
  {
    "link": "out",
    "action": "alt",
    "event": "click",
    "navigate": null,
    "popup": false,
    "download": false,
    "decision": false
  },
  {
    "link": "out",
    "action": "middle",
    "event": "auxclick",
    "navigate": null,
    "popup": true,
    "download": true,
    "decision": null
  },
  {
    "link": "out",
    "action": "enter",
    "event": "click",
    "navigate": "leave",
    "popup": false,
    "download": false,
    "decision": false
  },
  {
    "link": "out",
    "action": "ctrl",
    "event": null,
    "navigate": null,
    "popup": false,
    "download": false,
    "decision": null
  },
  {
    "link": "blank",
    "action": "plain",
    "event": "click",
    "navigate": null,
    "popup": true,
    "download": false,
    "decision": false
  },
  {
    "link": "blank",
    "action": "meta",
    "event": "click",
    "navigate": null,
    "popup": true,
    "download": false,
    "decision": false
  },
  {
    "link": "blank",
    "action": "shift",
    "event": "click",
    "navigate": null,
    "popup": true,
    "download": false,
    "decision": false
  },
  {
    "link": "blank",
    "action": "alt",
    "event": "click",
    "navigate": null,
    "popup": false,
    "download": false,
    "decision": false
  },
  {
    "link": "blank",
    "action": "middle",
    "event": "auxclick",
    "navigate": null,
    "popup": true,
    "download": true,
    "decision": null
  },
  {
    "link": "blank",
    "action": "enter",
    "event": "click",
    "navigate": null,
    "popup": true,
    "download": false,
    "decision": false
  },
  {
    "link": "blank",
    "action": "ctrl",
    "event": null,
    "navigate": null,
    "popup": false,
    "download": false,
    "decision": null
  },
  {
    "link": "dl",
    "action": "plain",
    "event": "click",
    "navigate": "download",
    "popup": false,
    "download": false,
    "decision": false
  },
  {
    "link": "dl",
    "action": "meta",
    "event": "click",
    "navigate": "download",
    "popup": false,
    "download": false,
    "decision": false
  },
  {
    "link": "dl",
    "action": "shift",
    "event": "click",
    "navigate": "download",
    "popup": false,
    "download": false,
    "decision": false
  },
  {
    "link": "dl",
    "action": "alt",
    "event": "click",
    "navigate": null,
    "popup": false,
    "download": false,
    "decision": false
  },
  {
    "link": "dl",
    "action": "middle",
    "event": "auxclick",
    "navigate": "download",
    "popup": false,
    "download": true,
    "decision": null
  },
  {
    "link": "dl",
    "action": "enter",
    "event": "click",
    "navigate": "download",
    "popup": false,
    "download": false,
    "decision": false
  },
  {
    "link": "dl",
    "action": "ctrl",
    "event": null,
    "navigate": null,
    "popup": false,
    "download": false,
    "decision": null
  },
  {
    "link": "mail",
    "action": "plain",
    "event": "click",
    "navigate": "leave",
    "popup": false,
    "download": false,
    "decision": false
  },
  {
    "link": "mail",
    "action": "meta",
    "event": "click",
    "navigate": null,
    "popup": true,
    "download": false,
    "decision": false
  },
  {
    "link": "mail",
    "action": "shift",
    "event": "click",
    "navigate": null,
    "popup": true,
    "download": false,
    "decision": false
  },
  {
    "link": "mail",
    "action": "alt",
    "event": "click",
    "navigate": null,
    "popup": false,
    "download": false,
    "decision": false
  },
  {
    "link": "mail",
    "action": "middle",
    "event": "auxclick",
    "navigate": null,
    "popup": true,
    "download": false,
    "decision": null
  },
  {
    "link": "mail",
    "action": "enter",
    "event": "click",
    "navigate": "leave",
    "popup": false,
    "download": false,
    "decision": false
  },
  {
    "link": "mail",
    "action": "ctrl",
    "event": null,
    "navigate": null,
    "popup": false,
    "download": false,
    "decision": null
  }
];

export const CLICK_NOTE =
  'Правило одно: роутер забирает клик, только если без него браузер **сменил бы документ в этой же вкладке на страницу этого же сайта**. Во всех остальных случаях пользователь чего-то хотел от браузера — новую вкладку, окно, файл, письмо, — и `preventDefault()` у него это отнимет. Средняя кнопка шлёт не `click`, а `auxclick`, поэтому роутер её не видит вовсе. Enter на ссылке в фокусе — обычный `click`: клавиатура работает без единой строки кода.';

export const ROUTERLINK_NOTE =
  '`<RouterLink to="/users/2">` во Vue рисует настоящий `<a href="/users/2">` и вешает на него свой обработчик. Его проверка короче `shouldIntercept`: модификаторы, `defaultPrevented`, кнопка мыши и `target="_blank"`. Происхождение и `download` ей проверять не нужно — адрес она строит сама из таблицы маршрутов.';

export const LINK_ROWS: { k: string; a: string; div: string; tone?: 'warn' | 'err' }[] = [
  { k: 'Tab доходит', a: 'да — ссылка в порядке фокуса', div: 'нет — `div` не фокусируется', tone: 'err' },
  { k: 'роль для скринридера', a: '«ссылка»', div: 'нет роли — «текст»', tone: 'err' },
  { k: '⌘/Ctrl + клик, средняя кнопка', a: 'новая вкладка', div: 'ничего или переход в этой же', tone: 'warn' },
  { k: 'адрес при наведении', a: 'в строке состояния', div: 'нет' },
  { k: '«Открыть в новой вкладке» в меню', a: 'есть', div: 'нет', tone: 'warn' },
];

export const LINK_NOTE =
  'Переход — это ссылка. `@click="router.push(…)"` на `div` или `button` делает переход, но отбирает у пользователя всё, что браузер даёт ссылке даром. `router.push` в коде нужен там, где перехода нет в разметке: после отправки формы, по таймеру, из guard.';

// ─── Раздел 4. Шаблон пути ─────────────────────────────────────────────────────────────────

export const MATCH_CODE = `// Шаблон пути → сегменты. Сегмент — список токенов: текст или параметр.
function tokenize(path) {
  if (path === '/') return [[{ type: 'text', value: '' }]];
  const segments = [];
  let segment = null;
  let i = 0;
  while (i < path.length) {
    const ch = path[i];
    if (ch === '/') {                                // новый сегмент
      if (segment) segments.push(segment);
      segment = [];
      i++;
    } else if (ch === ':') {                         // параметр :name(regexp)?
      const name = /^\\w*/.exec(path.slice(i + 1))[0];
      i += 1 + name.length;
      let regexp = '';
      if (path[i] === '(') {                         // своя регулярка до первой «)» без «\\»
        i++;
        while (i < path.length && !(path[i] === ')' && path[i - 1] !== '\\\\')) regexp += path[i++];
        regexp = regexp.replaceAll('\\\\)', ')');
        i++;
      }
      const mod = '?*+'.includes(path[i]) && path[i] ? path[i++] : '';
      segment.push({
        type: 'param', value: name, regexp,
        optional: mod === '?' || mod === '*',
        repeatable: mod === '*' || mod === '+',
      });
    } else {                                         // текст до «/» или «:»
      let text = '';
      while (i < path.length && path[i] !== '/' && path[i] !== ':') {
        if (path[i] === '\\\\') i++;                   // «\\:» — буквальное двоеточие
        text += path[i++];
      }
      segment.push({ type: 'text', value: text });
    }
  }
  if (segment) segments.push(segment);
  return segments;
}

const ANY = '[^/]+?';                                // параметр без своей регулярки
const escape = (s) => s.replace(/[.+*?^\${}()[\\]/\\\\]/g, '\\\\$&');

// Сегменты → регулярное выражение, имена параметров и вес.
function compile(segments) {
  let pattern = '^';
  const keys = [];
  const score = [];
  for (const segment of segments) {
    const weights = segment.length ? [] : [90];      // пустой сегмент: хвостовой «/»
    segment.forEach((token, index) => {
      let weight = 40;
      if (token.type === 'text') {
        pattern += (index ? '' : '/') + escape(token.value);
        weight += 40;                                // текст: 80
      } else {
        const re = token.regexp || ANY;
        keys.push({ name: token.value, repeatable: token.repeatable, optional: token.optional });
        let sub = token.repeatable ? \`((?:\${re})(?:/(?:\${re}))*)\` : \`(\${re})\`;
        if (!index) sub = token.optional && segment.length < 2 ? \`(?:/\${sub})\` : '/' + sub;
        if (token.optional) sub += '?';
        pattern += sub;
        weight += 20;                                // параметр: 60
        if (re !== ANY) weight += 10;                //   со своей регуляркой: 70
        if (token.optional) weight -= 8;             //   необязательный: −8
        if (token.repeatable) weight -= 20;          //   повторяемый: −20
        if (re === '.*') weight -= 50;               //   «всё что угодно»: −50
      }
      weights.push(weight);
    });
    score.push(weights);
  }
  return { re: new RegExp(pattern + '/?$', 'i'), keys, score };
}`;

export const PLAIN_SCORE =
  'Как сортировка писем на почте. Письмо с точным адресом «ул. Ленина, 5, кв. 12» кладут в ячейку квартиры, письмо «ул. Ленина, 5» — в ячейку дома, а «кому-нибудь в городе» — в общий ящик. Чем точнее адрес, тем раньше письмо находит своё место. Вес маршрута — мера этой точности.';

/** Шаблоны: регулярка и вес — `createRouterMatcher` vue-router 5.3.1; тест сверяет мини-версию. */
export const PATTERN_ROWS: { pattern: string; re: string; score: string }[] = [
  {
    "pattern": "/users",
    "re": "^\\/users\\/?$",
    "score": "80"
  },
  {
    "pattern": "/users/new",
    "re": "^\\/users\\/new\\/?$",
    "score": "80 · 80"
  },
  {
    "pattern": "/users/:id",
    "re": "^\\/users\\/([^/]+?)\\/?$",
    "score": "80 · 60"
  },
  {
    "pattern": "/users/:id(\\d+)",
    "re": "^\\/users\\/(\\d+)\\/?$",
    "score": "80 · 70"
  },
  {
    "pattern": "/users/:id?",
    "re": "^\\/users(?:\\/([^/]+?))?\\/?$",
    "score": "80 · 52"
  },
  {
    "pattern": "/users/:ids+",
    "re": "^\\/users\\/((?:[^/]+?)(?:\\/(?:[^/]+?))*)\\/?$",
    "score": "80 · 40"
  },
  {
    "pattern": "/users/:ids*",
    "re": "^\\/users(?:\\/((?:[^/]+?)(?:\\/(?:[^/]+?))*))?\\/?$",
    "score": "80 · 32"
  },
  {
    "pattern": "/users-:id",
    "re": "^\\/users-([^/]+?)\\/?$",
    "score": "80, 60"
  },
  {
    "pattern": "/users/",
    "re": "^\\/users\\/?$",
    "score": "80 · 90"
  },
  {
    "pattern": "/:path(.*)*",
    "re": "^(?:\\/((?:.*)(?:\\/(?:.*))*))?\\/?$",
    "score": "-8"
  }
];

export const WEIGHT_ROWS: { token: string; weight: string; example: string }[] = [
  { token: 'текст', weight: '80', example: '`users`, `new`' },
  { token: 'параметр', weight: '60', example: '`:id`' },
  { token: 'параметр со своей регуляркой', weight: '70', example: '`:id(\\d+)`' },
  { token: 'необязательный `?`', weight: '−8', example: '`:id?` → 52' },
  { token: 'повторяемый `+`, `*`', weight: '−20', example: '`:ids+` → 40, `:ids*` → 32' },
  { token: 'регулярка `.*`', weight: '−50', example: '`:path(.*)*` → −8' },
  { token: 'пустой сегмент', weight: '90', example: 'хвостовой `/` в `/users/`' },
];

export const MATCH_NOTE =
  'Шаблон режется на сегменты по `/`, сегмент — на токены: текст и параметры. Текст попадает в регулярку как есть, с экранированием, параметр — группой `([^/]+?)`: «хотя бы один символ, кроме косой черты». Своя регулярка в скобках заменяет эту группу. В конце всегда `/?$` — хвостовая косая черта разрешена, — и флаг `i`: `/USERS/NEW` тоже подходит. Каждый токен получает вес, и вес маршрута — массив весов по сегментам.';

// ─── Раздел 5. Ранжирование ────────────────────────────────────────────────────────────────

export const RANK_CODE = `// Сравнить два сегмента: < 0 — первый сильнее.
function compareSegment(a, b) {
  for (let i = 0; i < a.length && i < b.length; i++) {
    if (a[i] !== b[i]) return b[i] - a[i];
  }
  if (a.length === b.length) return 0;
  // Короче — слабее, кроме сегмента из одного текста: «/users» сильнее «/users-:id».
  if (a.length < b.length) return a.length === 1 && a[0] === 80 ? -1 : 1;
  return b.length === 1 && b[0] === 80 ? 1 : -1;
}

const endsWithSplat = (score) => score.length > 0 && score.at(-1).at(-1) < 0;

// Сравнить два маршрута посегментно: < 0 — первый сильнее.
function compareRoutes(a, b) {
  for (let i = 0; i < a.score.length && i < b.score.length; i++) {
    const diff = compareSegment(a.score[i], b.score[i]);
    if (diff) return diff;
  }
  if (Math.abs(a.score.length - b.score.length) === 1) {
    if (endsWithSplat(a.score)) return 1;            // «/:rest(.*)*» уступает и короткому
    if (endsWithSplat(b.score)) return -1;
  }
  return b.score.length - a.score.length;            // длиннее — сильнее
}`;

export const ROUTES_CODE = `const routes = [
  { path: '/', name: 'home', component: Home },
  {
    path: '/users', component: UsersLayout, beforeEnter: requireLogin,
    children: [
      { path: '', name: 'users', component: UsersList },
      {
        path: ':id', name: 'user', component: User,
        children: [{ path: 'posts', name: 'user-posts', component: UserPosts }],
      },
      { path: 'new', name: 'user-new', component: UserNew },
    ],
  },
  { path: '/settings', name: 'settings', component: () => import('./Settings.js'), beforeEnter: requireLogin },
  { path: '/login', name: 'login', component: Login },
  { path: '/files/:path+', name: 'file', component: FileView },
  { path: '/:path(.*)*', name: 'not-found', component: NotFound },
];`;

/** Порядок сквозной таблицы — `router.getRoutes()`; тест сверяет мини-версию. */
export const RANKED: { path: string; name: string; score: string }[] = [
  {
    "path": "/users/new",
    "name": "user-new",
    "score": "80 · 80"
  },
  {
    "path": "/users/:id/posts",
    "name": "user-posts",
    "score": "80 · 60 · 80"
  },
  {
    "path": "/users/:id",
    "name": "user",
    "score": "80 · 60"
  },
  {
    "path": "/files/:path+",
    "name": "file",
    "score": "80 · 40"
  },
  {
    "path": "/",
    "name": "home",
    "score": "80"
  },
  {
    "path": "/users",
    "name": "users",
    "score": "80"
  },
  {
    "path": "/users",
    "name": "",
    "score": "80"
  },
  {
    "path": "/settings",
    "name": "settings",
    "score": "80"
  },
  {
    "path": "/login",
    "name": "login",
    "score": "80"
  },
  {
    "path": "/:path(.*)*",
    "name": "not-found",
    "score": "-8"
  }
];

export const RANK_NOTE =
  'В таблице `:id` стоит **раньше** `new`, а в списке роутера — позже. Порядок в массиве не значит ничего: роутер сортирует записи по весу при добавлении, и `/users/new` (80, 80) обгоняет `/users/:id` (80, 60) на втором сегменте. Сравнение идёт посегментно слева направо; при равенстве длиннее — сильнее, поэтому `/files/:path+` стоит раньше `/`. «Всё что угодно» `/:path(.*)*` весит −8 и оказывается последним, где бы его ни объявили.';

export const SAME_SCORE_NOTE =
  'При равном весе остаётся порядок объявления: кто добавлен раньше, тот и стоит раньше. `/users/:id` и `/users/:slug` — один и тот же вес (80, 60), и второй не получит ни одного адреса. Различить их может только своя регулярка: `:id(\\d+)` весит 70 и забирает цифры, остальное достаётся `:slug`.';

// ─── Раздел 6. Вложенные маршруты ──────────────────────────────────────────────────────────

export const MATCHER_CODE = `// Дерево маршрутов → плоский список, от сильного к слабому.
function createMatcher(routes) {
  const list = [];
  const isAncestor = (a, b) => { for (let p = b.parent; p; p = p.parent) if (p === a) return true; return false; };
  function insert(record) {
    let i = 0;
    for (; i < list.length; i++) {
      const diff = compareRoutes(record, list[i]);
      if (diff < 0 || (diff === 0 && isAncestor(list[i], record))) break; // ребёнок встаёт перед родителем
    }
    list.splice(i, 0, record);
  }
  function add(route, parent) {
    let path = route.path;
    if (parent && !path.startsWith('/')) {             // путь ребёнка дописывается к родителю
      path = parent.path + (path && (parent.path.endsWith('/') ? '' : '/') + path);
    }
    const record = { ...route, path, parent, ...compile(tokenize(path)) };
    if (route.component || route.name || route.redirect) insert(record); // группа без них — не маршрут
    for (const child of route.children ?? []) add(child, record);
  }
  routes.forEach((route) => add(route, null));

  function resolve(path) {
    const record = list.find((r) => r.re.test(path));  // первый подходящий — победитель
    if (!record) return null;
    const values = record.re.exec(path).slice(1);
    const params = {};
    record.keys.forEach((key, i) => {
      const value = values[i] || '';
      if (value || !key.optional) params[key.name] = value && key.repeatable ? value.split('/') : value;
    });
    const matched = [];                                // вся цепочка: родители и сам маршрут
    for (let r = record; r; r = r.parent) matched.unshift(r);
    return { name: record.name, record, params, matched };
  }
  return { list, resolve };
}`;

/** Разбор адресов сквозной таблицей — `router.resolve()`; тест сверяет мини-версию. */
export const RESOLVE_ROWS: { path: string; name: string; params: string; matched: string }[] = [
  {
    "path": "/users",
    "name": "users",
    "params": "{}",
    "matched": "/users → /users"
  },
  {
    "path": "/users/new",
    "name": "user-new",
    "params": "{}",
    "matched": "/users → /users/new"
  },
  {
    "path": "/users/42",
    "name": "user",
    "params": "{\"id\":\"42\"}",
    "matched": "/users → /users/:id"
  },
  {
    "path": "/users/42/posts",
    "name": "user-posts",
    "params": "{\"id\":\"42\"}",
    "matched": "/users → /users/:id → /users/:id/posts"
  },
  {
    "path": "/files/docs/2026/plan.pdf",
    "name": "file",
    "params": "{\"path\":[\"docs\",\"2026\",\"plan.pdf\"]}",
    "matched": "/files/:path+"
  },
  {
    "path": "/users/42/edit",
    "name": "not-found",
    "params": "{\"path\":[\"users\",\"42\",\"edit\"]}",
    "matched": "/:path(.*)*"
  }
];

export const NESTED_NOTE =
  'Найден один маршрут, а `matched` — вся цепочка родителей до него. По ней рисуется экран: корневой `<RouterView>` показывает `matched[0]` — макет `UsersLayout`, `<RouterView>` внутри макета — `matched[1]` и так далее. Путь ребёнка без `/` в начале дописывается к пути родителя. Ребёнок с пустым путём получает тот же адрес, что родитель, и при равном весе встаёт **перед** ним — иначе `/users` всегда доставался бы одному макету без списка внутри.';

export const GROUP_NOTE =
  'Запись без компонента, имени и перенаправления — просто группа: её дети получают общий префикс, а сама она в список не попадает и адрес не забирает.';

// ─── Раздел 7. Guards ──────────────────────────────────────────────────────────────────────

export const GUARDS_CODE = `const session = { user: 'ann', admin: false, dirty: false };

// beforeEnter у записи маршрута: строка — перенаправление.
function requireLogin() {
  if (!session.user) return '/login';
}

// Глобальный guard: false — отмена, адрес не меняется.
function installGuards(router) {
  router.beforeEach((to) => {
    if (to.name === 'user-new' && !session.admin) return false;
  });
}

// Компонент настроек: не уходить с несохранёнными правками.
const Settings = {
  name: 'Settings',
  beforeRouteLeave() {
    if (session.dirty) return false;
  },
};`;

export const NAVIGATE_CODE = `// Причины, по которым навигация не состоялась (числа — как у vue-router).
const ABORTED = 4, CANCELLED = 8, DUPLICATED = 16;

function createRouter(matcher) {
  const START = { path: null, matched: [], params: {} };
  const hooks = { beforeEach: [], beforeResolve: [], afterEach: [] };
  const router = {
    current: START, pending: null, entries: [], push,
    beforeEach: (fn) => hooks.beforeEach.push(fn),
    beforeResolve: (fn) => hooks.beforeResolve.push(fn),
    afterEach: (fn) => hooks.afterEach.push(fn),
  };

  // Один guard: undefined/true — дальше, false — отмена, строка — перенаправление.
  async function run(guard, to, from) {
    await null;                                      // guards всегда асинхронны
    const result = await guard(to, from);
    if (result === false) throw { type: ABORTED, to };
    if (typeof result === 'string') throw { redirect: result };
  }

  // Этап — список guards по очереди; в конце проверка, не началась ли новая навигация.
  async function stage(guards, to, from) {
    for (const guard of guards) await run(guard, to, from);
    if (router.pending !== to) throw { type: CANCELLED, to };
  }

  async function navigate(to, from) {
    const leaving = from.matched.filter((r) => !to.matched.includes(r)).reverse();
    const updating = from.matched.filter((r) => to.matched.includes(r));
    const entering = to.matched.filter((r) => !from.matched.includes(r));
    const own = (records, name) => records.map((r) => r.component?.[name]).filter(Boolean);

    await stage(own(leaving, 'beforeRouteLeave'), to, from);           // 1. уходящие компоненты
    await stage(hooks.beforeEach, to, from);                           // 2. глобальные
    await stage(own(updating, 'beforeRouteUpdate'), to, from);         // 3. остающиеся компоненты
    await stage(entering.map((r) => r.beforeEnter).filter(Boolean), to, from); // 4. записи маршрутов
    // 5. ленивые компоненты: все import() разом, потом их beforeRouteEnter
    const loading = entering.map(async (r) => {
      if (typeof r.component === 'function') r.component = (await r.component()).default;
    });
    await stage(entering.map((r, i) => async () => {
      await loading[i];
      return r.component?.beforeRouteEnter?.(to, from);
    }), to, from);
    await stage(hooks.beforeResolve, to, from);                        // 6. последний шанс
  }

  async function push(path) {
    const to = matcher.resolve(path) ?? { path, matched: [], params: {} };
    to.path = path;
    const from = router.current;
    router.pending = to;
    let failure = null;
    if (to.path === from.path) failure = { type: DUPLICATED, to };
    else {
      try {
        await navigate(to, from);
      } catch (error) {
        if (error.redirect) return push(error.redirect);  // всё заново, к новому адресу
        if (!error.type) throw error;                    // исключение в guard — ошибка
        failure = error;
      }
    }
    if (!failure && router.pending !== to) failure = { type: CANCELLED, to };
    if (!failure) {                                      // 7. подтверждение
      router.entries.push(path);                         //    history.pushState
      router.current = to;                               //    RouterView рисует новый экран
    }
    for (const hook of hooks.afterEach) hook(to, from, failure); // 8. после — всегда
    return failure ?? undefined;
  }
  return router;
}`;

export const STAGE_ROWS: { n: string; who: string; when: string }[] = [
  { n: '1', who: '`beforeRouteLeave` уходящих компонентов', when: 'изнутри наружу: сначала самый вложенный' },
  { n: '2', who: 'глобальный `beforeEach`', when: 'на каждый переход' },
  { n: '3', who: '`beforeRouteUpdate` остающихся компонентов', when: 'компонент тот же, сменились параметры' },
  { n: '4', who: '`beforeEnter` записей маршрутов', when: 'только для **входящих** записей' },
  { n: '5', who: 'загрузка ленивых компонентов, их `beforeRouteEnter`', when: 'все `import()` разом, потом guards по порядку' },
  { n: '6', who: 'глобальный `beforeResolve`', when: 'всё проверено, компоненты загружены' },
  { n: '7', who: 'подтверждение: `pushState`, новый экран', when: 'если никто не отменил' },
  { n: '8', who: 'глобальный `afterEach`', when: 'всегда, с причиной неудачи третьим аргументом' },
];

export const PLAIN_GUARD =
  'Как проходная с несколькими постами. Сначала отпускает кабинет, из которого вы уходите (вдруг там несохранённые бумаги). Потом общий пост на входе в здание, потом пост этажа, потом сам кабинет. Любой пост может развернуть вас (`false`) или отправить в другой кабинет (новый адрес) — и тогда весь путь начинается заново, от первого поста.';

export const GUARD_SCENARIOS: GuardScenario[] = [
  {
    id: 'enter',
    label: 'вход в раздел',
    note: 'С главной в профиль `/users/1`. Входят две записи — макет `UsersLayout` и профиль `User`, — и `beforeEnter` у `/users` срабатывает. `Home` уходит первым.',
    session: {},
    setup: [],
    go: ['/users/1'],
  },
  {
    id: 'update',
    label: 'сменился :id',
    note: 'С `/users/1` на `/users/2`. Записи те же, сменился параметр: никто не входит и не уходит. Вместо `beforeRouteEnter` — `beforeRouteUpdate`, а `beforeEnter` у `/users` **не** вызывается.',
    session: {},
    setup: ['/users/1'],
    go: ['/users/2'],
  },
  {
    id: 'child',
    label: 'вложенный уровень',
    note: 'С `/users/2` на `/users/2/posts`. Макет и профиль остаются — для них `beforeRouteUpdate`, — а входит только `UserPosts`.',
    session: {},
    setup: ['/users/2'],
    go: ['/users/2/posts'],
  },
  {
    id: 'redirect',
    label: 'не вошёл',
    note: 'Пользователь не вошёл и идёт в `/settings`. `requireLogin` возвращает `\'/login\'`, и навигация начинается заново к новому адресу: `beforeRouteLeave` и `beforeEach` срабатывают второй раз. Ленивый `Settings` так и не скачивается.',
    session: { user: null },
    setup: [],
    go: ['/settings'],
  },
  {
    id: 'lazy',
    label: 'ленивый компонент',
    note: 'Вошёл и идёт в `/settings`. `import()` вызывается после `beforeEnter` — код страницы не качается, пока guards записи не пропустили переход.',
    session: {},
    setup: [],
    go: ['/settings'],
  },
  {
    id: 'cancel',
    label: 'отмена в beforeEach',
    note: 'Без прав админа в `/users/new`. Глобальный guard возвращает `false`: дальше никто не вызывается, адрес не меняется, `afterEach` получает причину `4` — отменено guard-ом.',
    session: {},
    setup: ['/users'],
    go: ['/users/new'],
  },
  {
    id: 'dirty',
    label: 'несохранённые правки',
    note: 'В настройках есть несохранённые правки, пользователь уходит на главную. `beforeRouteLeave` компонента возвращает `false` — это первый же этап, и даже `beforeEach` не успевает сработать.',
    session: { dirty: true },
    setup: ['/settings'],
    go: ['/'],
  },
  {
    id: 'race',
    label: 'два перехода сразу',
    note: 'Второй `push` случился, пока первый ещё в пути. После каждого этапа роутер проверяет, не устарел ли его переход, — первый узнаёт об этом и сходит с дистанции с причиной `8`: отменён новой навигацией.',
    session: {},
    setup: [],
    go: ['/users/5', '/settings'],
  },
];

/** Журналы vue-router 5.3.1 по сценариям `GUARD_SCENARIOS`; тест пересобирает и сверяет мини-версию. */
export const GUARD_TRACES: Record<string, GuardRun> = {
  "enter": {
    "from": "/",
    "to": "/users/1",
    "failures": [
      null
    ],
    "log": [
      "beforeRouteLeave Home",
      "beforeEach /users/1",
      "beforeEnter /users",
      "beforeRouteEnter UsersLayout",
      "beforeRouteEnter User",
      "beforeResolve /users/1",
      "afterEach /users/1"
    ]
  },
  "update": {
    "from": "/users/1",
    "to": "/users/2",
    "failures": [
      null
    ],
    "log": [
      "beforeEach /users/2",
      "beforeRouteUpdate UsersLayout",
      "beforeRouteUpdate User",
      "beforeResolve /users/2",
      "afterEach /users/2"
    ]
  },
  "child": {
    "from": "/users/2",
    "to": "/users/2/posts",
    "failures": [
      null
    ],
    "log": [
      "beforeEach /users/2/posts",
      "beforeRouteUpdate UsersLayout",
      "beforeRouteUpdate User",
      "beforeRouteEnter UserPosts",
      "beforeResolve /users/2/posts",
      "afterEach /users/2/posts"
    ]
  },
  "redirect": {
    "from": "/",
    "to": "/login",
    "failures": [
      null
    ],
    "log": [
      "beforeRouteLeave Home",
      "beforeEach /settings",
      "beforeEnter /settings",
      "beforeRouteLeave Home",
      "beforeEach /login",
      "beforeRouteEnter Login",
      "beforeResolve /login",
      "afterEach /login"
    ]
  },
  "lazy": {
    "from": "/",
    "to": "/settings",
    "failures": [
      null
    ],
    "log": [
      "beforeRouteLeave Home",
      "beforeEach /settings",
      "beforeEnter /settings",
      "import() ./Settings.js",
      "beforeRouteEnter Settings",
      "beforeResolve /settings",
      "afterEach /settings"
    ]
  },
  "cancel": {
    "from": "/users",
    "to": "/users",
    "failures": [
      4
    ],
    "log": [
      "beforeRouteLeave UsersList",
      "beforeEach /users/new",
      "afterEach /users/new failure=4"
    ]
  },
  "dirty": {
    "from": "/settings",
    "to": "/settings",
    "failures": [
      4
    ],
    "log": [
      "beforeRouteLeave Settings",
      "afterEach / failure=4"
    ]
  },
  "race": {
    "from": "/",
    "to": "/settings",
    "failures": [
      8,
      null
    ],
    "log": [
      "beforeRouteLeave Home",
      "beforeRouteLeave Home",
      "beforeEach /settings",
      "afterEach /users/5 failure=8",
      "beforeEnter /settings",
      "import() ./Settings.js",
      "beforeRouteEnter Settings",
      "beforeResolve /settings",
      "afterEach /settings"
    ]
  }
};

export const FAILURE_ROWS: { type: string; name: string; when: string }[] = [
  { type: '`4`', name: '`aborted`', when: 'guard вернул `false`' },
  { type: '`8`', name: '`cancelled`', when: 'началась новая навигация, пока шла эта' },
  { type: '`16`', name: '`duplicated`', when: 'переход на тот адрес, где уже стоим' },
];

export const FAILURE_NOTE =
  'Неудавшийся переход — не исключение. `router.push` **выполняется** с объектом-причиной, и `try/catch` вокруг него ничего не поймает; проверять надо результат: `isNavigationFailure(result, NavigationFailureType.aborted)`. Отклоняется промис только тогда, когда guard бросил ошибку.';

export const NEXT_NOTE =
  'Третий аргумент `next` в vue-router 5 объявлен устаревшим: в режиме разработки вызов `next()` печатает предупреждение `VUE_ROUTER_R0025` с подсказкой «верните значение». `next()` → `return`, `next(false)` → `return false`, `next(\'/login\')` → `return \'/login\'`. Возврат значения ещё и защищает от ошибки «вызвал `next` дважды».';

// ─── Раздел 8. Данные ──────────────────────────────────────────────────────────────────────

export const SHOP_CODE = `// Три уровня вложенности, у каждого свой чанк и свои данные.
const shopRoutes = [{
  path: '/shop', component: () => import('./Shop.js'), meta: { load: loadShop },
  children: [{
    path: ':cat', component: () => import('./Category.js'), meta: { load: loadCategory },
    children: [{
      path: ':id', component: () => import('./Product.js'), meta: { load: loadProduct },
    }],
  }],
}];`;

export const LOADERS_CODE = `// А. Данные грузит сам компонент, после перехода. Ребёнок появляется,
//    когда родитель получил свои данные и нарисовал <RouterView>.
function inComponent(router) {
  router.afterEach(async (to, from, failure) => {
    if (failure) return;
    for (const r of to.matched) await r.meta.load?.(to.params);
  });
}

// Б. Все уровни разом в beforeResolve: переход ждёт самого долгого.
function parallel(router) {
  router.beforeResolve(async (to) => {
    await Promise.all(to.matched.map((r) => r.meta.load?.(to.params)));
  });
}

// В. То же, но await в цикле: снова водопад, только до перехода.
function serial(router) {
  router.beforeResolve(async (to) => {
    for (const r of to.matched) await r.meta.load?.(to.params);
  });
}

// Г. Запустить в beforeEach, дождаться в beforeResolve: данные едут вместе с чанками.
function early(router) {
  let pending;
  router.beforeEach((to) => {
    pending = Promise.all(to.matched.map((r) => r.meta.load?.(to.params)));
  });
  router.beforeResolve(async () => {
    await pending;
  });
}`;

export const SHOP_LEVELS: ShopLevel[] = [
  { name: 'Shop', chunk: 100, data: 300 },
  { name: 'Category', chunk: 80, data: 200 },
  { name: 'Product', chunk: 60, data: 250 },
];

export const SHOP_TARGET = '/shop/phones/7';

export const STRATEGIES: { id: Strategy; label: string; note: string }[] = [
  {
    id: 'inComponent',
    label: 'А. в компоненте',
    note: 'Адрес сменился, как только скачались чанки. Дальше уровни грузят данные по очереди: `Category` смонтируется, только когда `Shop` получит свои данные и нарисует `<RouterView>`. Три запроса — три ступеньки водопада.',
  },
  {
    id: 'parallel',
    label: 'Б. beforeResolve, разом',
    note: 'Все три загрузчика стартуют вместе после чанков. Переход ждёт самого долгого, зато экран появляется сразу целиком.',
  },
  {
    id: 'serial',
    label: 'В. beforeResolve, по очереди',
    note: '`await` в цикле: тот же водопад, что в компонентах, только пользователь всё это время смотрит на старый экран.',
  },
  {
    id: 'early',
    label: 'Г. старт в beforeEach',
    note: 'Загрузчики лежат в `meta` записи, а не в чанке, — их можно запустить ещё до загрузки кода. Данные и чанки едут одновременно.',
  },
];

/** Шкалы vue-router 5.3.1 + Vue на виртуальных часах: события по стратегиям. Тест сверяет мини-версию. */
export const WATERFALL: Record<Strategy, { commit: number; ready: number }> = {
  "inComponent": {
    "commit": 100,
    "ready": 850
  },
  "parallel": {
    "commit": 400,
    "ready": 400
  },
  "serial": {
    "commit": 850,
    "ready": 850
  },
  "early": {
    "commit": 300,
    "ready": 300
  }
};

export const LAZY_NOTE =
  'Ленивые компоненты vue-router начинает качать на пятом этапе, и **все разом**: на `/shop/phones/7` три `import()` стартуют в одну миллисекунду. Водопада кода нет. Водопад данных появляется, когда данные грузит сам компонент: ребёнок не существует, пока родитель не нарисовал для него `<RouterView>`.';

export const WATERFALL_NOTE =
  'Выбор — не только «быстрее или медленнее». Загрузка до перехода держит пользователя на старом экране: нужен индикатор, иначе клик выглядит сломанным. Загрузка после перехода сразу меняет адрес и показывает скелет, но каждый вложенный уровень добавляет свою ступеньку.';

export const ARRAY_NOTE =
  'Guard, который вернул массив, перенаправляет. `return Promise.all(…)` отдаёт роутеру массив результатов, а любой объект для vue-router — адрес. На стенде такой `beforeResolve` превращал переход в `/a` в переход на текущий адрес: `push` выполнялся с причиной `16`, и экран не менялся. Поэтому в стратегиях выше — `await Promise.all(…)` внутри `async`-функции без `return`.';

/** Что вернул `push('/a')`, когда `beforeResolve` вернул `Promise.all(…)`. vue-router 5.3.1. */
export const ARRAY_FAILURE = 16;

export const DATA_CACHE_NOTE =
  'Загрузчик не обязан ходить в сеть каждый раз. Если за ним стоит кеш данных, повторный переход на тот же экран отдаст копию сразу, а запрос уйдёт фоном — как это устроено, разобрано в теме [«Кеш данных на клиенте», раздел «Кеш по ключу»](/frameworks/data-cache/#s2). В `vue-router/experimental` версии 5.3.1 есть и свои загрузчики — `DataLoaderPlugin` и `defineBasicLoader`; по документации они работают внутри навигации, как вариант Б.';

// ─── Раздел 9. Прокрутка ───────────────────────────────────────────────────────────────────

export const SCROLL_CODE = `const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior(to, from, savedPosition) {
    if (savedPosition) return savedPosition;   // «назад» и «вперёд»: где был
    if (to.hash) return { el: to.hash };       // якорь в адресе
    return { top: 0 };                         // новый экран — сверху
  },
});`;

export interface ScrollStand {
  /** `history.state` записи после `router.push('/users/1')`. */
  stateAfterPush: Record<string, unknown>;
  /** `history.scrollRestoration` с `scrollBehavior` и без. */
  restorationWith: string;
  restorationWithout: string;
  /** Прокрутка на новом экране без `scrollBehavior`, если до перехода было 1200. */
  yAfterPushWithout: number;
  /** `savedPosition` на «назад» и итоговая прокрутка. */
  savedOnBack: unknown;
  yAfterBack: number;
  savedOnPush: unknown;
  /** Без роутера: pushState, прокрутка 1500 → 200, «назад». */
  plainAuto: number;
  plainManual: number;
  /** Что рисует `<RouterLink to="/users/2">`. */
  routerLinkHtml: string;
}

/** vue-router 5.3.1 в Chromium 153; тест пересобирает. */
export const SCROLL_STAND: ScrollStand = {
  "stateAfterPush": {
    "back": "/",
    "current": "/users/1",
    "forward": null,
    "replaced": false,
    "position": 2,
    "scroll": null
  },
  "restorationWith": "manual",
  "restorationWithout": "auto",
  "yAfterPushWithout": 1200,
  "savedOnBack": {
    "left": 0,
    "top": 1200
  },
  "yAfterBack": 1200,
  "savedOnPush": null,
  "plainAuto": 1500,
  "plainManual": 200,
  "routerLinkHtml": "<a href=\"/sw/users/2\" class=\"\" id=\"link\">к пользователю 2</a>"
};

/** Прокрутка и фокус после `intercept()`: до перехода → после. Chromium 153. */
export const NAVAPI_SCROLL: { k: string; before: number; after: number; focus: string }[] = [
  {
    "k": "`navigation.navigate('/b')`",
    "before": 1500,
    "after": 0,
    "focus": "BODY"
  },
  {
    "k": "«назад» на `/a`",
    "before": 700,
    "after": 1500,
    "focus": "BODY"
  },
  {
    "k": "«вперёд» на `/b`",
    "before": 0,
    "after": 700,
    "focus": "BODY"
  },
  {
    "k": "`scroll: 'manual'`",
    "before": 900,
    "after": 900,
    "focus": "BODY"
  },
  {
    "k": "`scroll: 'manual'` и `event.scroll()`",
    "before": 900,
    "after": 0,
    "focus": "BODY"
  }
];

export const PLAIN_SCROLL =
  'Как закладка в книге. Браузер сам кладёт закладку, когда вы листаете книгу целиком, — то есть при обычной смене документа. В SPA книга одна, а страницы в ней подменяет ваш код, и про закладки браузер догадывается не всегда. Роутер берёт их на себя: запоминает, где вы были на каждой записи истории, и возвращает туда по «назад».';

export const SCROLL_NOTE =
  'С `scrollBehavior` vue-router переключает `history.scrollRestoration` в `manual` и забирает прокрутку себе. Перед уходом он записывает позицию в `history.state` старой записи (поле `scroll`) и в свою таблицу, а на «назад» и «вперёд» отдаёт её третьим аргументом. На обычный переход `savedPosition` — `null`: позиция «где был» есть только у записи, в которую возвращаются.';

export const NO_SCROLL_NOTE =
  'Без `scrollBehavior` роутер прокрутку не трогает вовсе, и новый экран открывается там, где пользователь был на старом, — в середине страницы. Браузер в режиме `auto` восстанавливает позицию на «назад» и для записей `pushState`, но про переход вперёд ничего не знает: наверх страницу должен вернуть ваш код.';

export const NAVAPI_SCROLL_NOTE =
  'С Navigation API это поведение по умолчанию: после `intercept()` браузер ставит новый экран в начало, на «назад» возвращает прежнюю позицию и сбрасывает фокус на `body`, чтобы скринридер начал читать новый экран сначала. `intercept({ scroll: \'manual\' })` отключает прокрутку, `event.scroll()` вызывает её вручную — например, когда данные доехали. Анимацию между экранами добавляет `document.startViewTransition` вокруг смены DOM — см. [«View Transitions», раздел «Снимки и промисы»](/render/view-transitions/#s1).';

// ─── Демо ──────────────────────────────────────────────────────────────────────────────────

export const MATCH_PRESETS = ['/users/new', '/users/42', '/users/42/posts', '/users', '/USERS/NEW/', '/files/docs/plan.pdf', '/users/42/edit'];

export const PATTERN_PRESETS = ['/users/:id', '/users/:id(\\d+)?', '/users/:ids+', '/users-:id', '/:lang(en|ru)?/docs', '/:path(.*)*'];

export const MATCH_CAPTION =
  'Регулярка подходит к адресу у нескольких записей сразу — выигрывает верхняя. Наберите `/users/new`: подходят и `new`, и `:id`, и «всё что угодно», а побеждает самая точная. `/USERS/NEW/` тоже доходит до `new`: регистр не важен, хвостовая косая черта разрешена.';

export const PATTERN_CAPTION =
  'Каждый токен получает свой вес, а регулярка складывается из кусков в том же порядке. Сравните `/users/:id` и `/users-:id`: в первом два сегмента, во втором один, и это меняет и регулярку, и место в списке.';

export const GUARDS_CAPTION =
  'Журнал собран учебным роутером на сквозной таблице маршрутов. Сравните «сменился :id» и «вложенный уровень»: записи, которые остаются, получают `beforeRouteUpdate`, а `beforeEnter` у них молчит. В «не вошёл» путь проходится дважды.';

export const DATA_CAPTION =
  'Каждая полоса — запрос; адрес сменился на отметке «переход», экран готов на отметке «экран». В А адрес меняется рано, а экран собирается ступеньками. В В пользователь ждёт те же 850 мс, глядя на старый экран. Г — самый короткий путь: данным не нужно ждать кода.';

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: '`pushState` не шлёт `popstate`',
    d: 'Подписаться на `popstate` и ждать, что он придёт после своего `pushState`, — частая ошибка самодельных роутеров. Событие приходит только на ход по истории. После `pushState` экран рисует тот же код, который его вызвал.',
    tone: 'err',
  },
  {
    n: '02',
    t: '`preventDefault` на каждый клик',
    d: 'Слушатель, который отменяет все клики по `a`, ломает ⌘/Ctrl+клик, Shift+клик, `target="_blank"`, `download` и ссылки на чужие сайты. Отменять можно только переход в этой же вкладке на свой же адрес.',
    tone: 'err',
  },
  {
    n: '03',
    t: 'Порядок маршрутов в массиве ничего не решает',
    d: 'vue-router сортирует записи по весу. Перестановка `/users/new` выше `/users/:id` ничего не даст — она и так выше. А два маршрута одного веса (`:id` и `:slug`) делят адреса по порядку объявления: второй не получит ничего.',
    tone: 'warn',
  },
  {
    n: '04',
    t: '`beforeEnter` молчит при смене параметра',
    d: 'С `/users/1` на `/users/2` запись не входит заново, поэтому её `beforeEnter` не вызывается. Компонент тоже не пересоздаётся: данные нового пользователя грузят в `beforeRouteUpdate` или в `watch` на `route.params.id`.',
    tone: 'warn',
  },
  {
    n: '05',
    t: '`push` не бросает при отмене',
    d: 'Переход, отменённый guard-ом, новой навигацией или на тот же адрес, выполняет промис `push` объектом-причиной. `await router.push(…)` в `try` пройдёт молча; результат проверяют `isNavigationFailure`.',
    tone: 'warn',
  },
  {
    n: '06',
    t: '`return Promise.all(…)` из guard',
    d: 'Массив — объект, а объект для vue-router — адрес перенаправления. Переход молча превращается в «уже здесь» (`16`). Ждите внутри `async`-функции и ничего не возвращайте.',
    tone: 'err',
  },
  {
    n: '07',
    t: 'Данные в компоненте — водопад',
    d: 'Каждый вложенный уровень, который грузит данные сам и рисует `<RouterView>` только после них, добавляет время своего запроса к общему. Три уровня по 300, 200 и 250 мс — это 750 мс сверх загрузки кода, а не 300.',
    tone: 'warn',
  },
  {
    n: '08',
    t: 'Без `scrollBehavior` новый экран открывается посередине',
    d: 'Роутер прокрутку не трогает, браузер — тоже: документ тот же. Пользователь пролистал список до середины, открыл карточку — и видит её середину. `scrollBehavior` с `return { top: 0 }` для новых экранов обязателен.',
    tone: 'warn',
  },
  {
    n: '09',
    t: 'Сервер не знает клиентских адресов',
    d: 'С History API адрес `/users/42` настоящий, и перезагрузка отправит его на сервер. Сервер, который знает только `/`, ответит 404. Нужна отдача `index.html` на любой неизвестный путь — и свой экран «не найдено» в роутере.',
  },
];

// ─── Источники ─────────────────────────────────────────────────────────────────────────────

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'HTML Standard — The History interface',
    href: 'https://html.spec.whatwg.org/multipage/nav-history-apis.html#the-history-interface',
    what: '`pushState`, `replaceState`, `scrollRestoration`, структурное клонирование состояния',
  },
  {
    title: 'HTML Standard — Navigation API',
    href: 'https://html.spec.whatwg.org/multipage/nav-history-apis.html#navigation-api',
    what: 'событие `navigate`, `canIntercept`, `intercept()`, прокрутка и фокус после перехвата',
  },
  {
    title: 'MDN — Window: popstate event',
    href: 'https://developer.mozilla.org/en-US/docs/Web/API/Window/popstate_event',
    what: 'когда приходит `popstate` и почему не на `pushState`',
  },
  {
    title: 'MDN — Navigation API',
    href: 'https://developer.mozilla.org/en-US/docs/Web/API/Navigation_API',
    what: 'обзор, перехват, таблица поддержки',
  },
  {
    title: 'Chrome for Developers — Modern client-side routing: the Navigation API',
    href: 'https://developer.chrome.com/docs/web-platform/navigation-api',
    what: 'зачем понадобился новый API и как на нём пишется роутер',
  },
  {
    title: 'Vue Router — Routes\' Matching Syntax',
    href: 'https://router.vuejs.org/guide/essentials/route-matching-syntax.html',
    what: 'параметры, свои регулярки, `?`, `+`, `*`; версия 5.3.1 на стенде',
  },
  {
    title: 'Path Ranker — инструмент автора vue-router',
    href: 'https://paths.esm.dev/',
    what: 'интерактивный разбор весов и порядка маршрутов',
  },
  {
    title: 'Vue Router — Nested Routes',
    href: 'https://router.vuejs.org/guide/essentials/nested-routes.html',
    what: '`children`, пустой путь ребёнка, `<RouterView>` на каждом уровне',
  },
  {
    title: 'Vue Router — Navigation Guards',
    href: 'https://router.vuejs.org/guide/advanced/navigation-guards.html',
    what: 'полный порядок навигации, `next` как устаревший',
  },
  {
    title: 'Vue Router — Waiting for the result of a Navigation',
    href: 'https://router.vuejs.org/guide/advanced/navigation-failures.html',
    what: '`isNavigationFailure`, `aborted`, `cancelled`, `duplicated`',
  },
  {
    title: 'Vue Router — Lazy Loading Routes',
    href: 'https://router.vuejs.org/guide/advanced/lazy-loading.html',
    what: '`() => import()` в `component`',
  },
  {
    title: 'Vue Router — Scroll Behavior',
    href: 'https://router.vuejs.org/guide/advanced/scroll-behavior.html',
    what: '`scrollBehavior`, `savedPosition`',
  },
  {
    title: 'vuejs/router — исходники матчера и навигации',
    href: 'https://github.com/vuejs/router/tree/main/packages/router/src',
    what: '`matcher/pathTokenizer.ts`, `matcher/pathParserRanker.ts`, `matcher/index.ts`, `navigationGuards.ts`, `router.ts`, `RouterLink.ts`',
  },
];

export const RELATED =
  'Смежное на сайте: [События DOM, раздел «Делегирование»](/render/dom-events/#s5) — как один слушатель на `document` ловит клики по всем ссылкам. [Навигации без ожидания, раздел «Подсказки, SPA и метрики»](/platform/instant-navigation/#s6) — мягкие навигации и почему bfcache к переходам SPA не относится. [View Transitions](/render/view-transitions/) — анимация между двумя экранами. [Модули и сборка, раздел «Чанки и кеш»](/tooling/modules/#s5) — во что сборщик превращает `import()` ленивого маршрута. [Кеш данных на клиенте](/frameworks/data-cache/) — загрузчики, которым не нужно ходить в сеть каждый раз. [SSR и гидратация](/frameworks/ssr-hydration/) — как первый экран приходит с сервера. [GitHub Pages, раздел «Маршрутизация без сервера»](/delivery/github-pages/#s3) — клиентские адреса на статическом хостинге. [Прокрутка изнутри](/render/scrolling/) — липкие шапки, якорь прокрутки при догрузке сверху, snap и `scroll-padding`. [Интернационализация во фронтенде](/frameworks/i18n/) — ICU MessageFormat, ленивые словари vue-i18n и выбор локали.';

// ─── Сводки для текста ─────────────────────────────────────────────────────────────────────

/** Все строки учебного роутера — пропом в демо. */
export const CODES: RouterCodes = {
  match: MATCH_CODE,
  rank: RANK_CODE,
  matcher: MATCHER_CODE,
  navigate: NAVIGATE_CODE,
  guards: GUARDS_CODE,
  routes: ROUTES_CODE,
  shop: SHOP_CODE,
  loaders: LOADERS_CODE,
};

const outcome = (r: ClickRow) =>
  r.download || r.navigate === 'download'
    ? 'скачивание'
    : r.popup
      ? 'новая вкладка'
      : r.navigate === 'same'
        ? 'переход здесь'
        : r.navigate === 'hash'
          ? 'к якорю'
          : r.navigate === 'leave'
            ? 'уход со страницы'
            : '—';

/** Таблица кликов: что сделал браузер; «забрать» — где `shouldIntercept` ответила `true`. */
export const CLICK_ROWS: string[][] = CLICK_LINKS.map((l) => [
  `\`${l.html}\``,
  ...CLICK_ACTIONS.map((a) => {
    const r = CLICK_STAND.find((x) => x.link === l.id && x.action === a.id);
    if (!r) return '—';
    if (r.event === null && !r.popup && !r.download && !r.navigate) return 'ничего';
    return `${outcome(r)}${r.decision ? ' · **забрать**' : ''}`;
  }),
]);

export const NAVAPI_ENGINES_NOTE = `Событие \`navigate\` и метод \`intercept()\` есть во всех трёх движках стенда: ${NAVAPI_ENGINES.map((e) => `${e.engine} — ${e.has ? 'да' : 'нет'}`).join(', ')}. vue-router 5.3.1 при этом стоит на History API, а Navigation API — основа для роутеров, которые пишутся сейчас.`;

export const SHOP_NOTE = `Чанки: ${SHOP_LEVELS.map((l) => `${l.name} — ${l.chunk} мс`).join(', ')}. Данные: ${SHOP_LEVELS.map((l) => `${l.name} — ${l.data} мс`).join(', ')}. Переход — на \`${SHOP_TARGET}\`. Миллисекунды условные: время на стенде виртуальное.`;

export const WATERFALL_ROWS: string[][] = STRATEGIES.map((s) => [s.label, `${WATERFALL[s.id].commit} мс`, `${WATERFALL[s.id].ready} мс`]);

export const SCROLL_ROWS: string[][] = [
  ['`history.scrollRestoration` с `scrollBehavior`', `\`${SCROLL_STAND.restorationWith}\``],
  ['`history.state` после `push(\'/users/1\')`', `\`${JSON.stringify(SCROLL_STAND.stateAfterPush)}\``],
  ['`savedPosition` на обычном переходе', `\`${JSON.stringify(SCROLL_STAND.savedOnPush)}\``],
  ['`savedPosition` на «назад», ушли с прокрутки 1200', `\`${JSON.stringify(SCROLL_STAND.savedOnBack)}\` → прокрутка ${SCROLL_STAND.yAfterBack}`],
  ['без `scrollBehavior`: прокрутка нового экрана, ушли с 1200', `${SCROLL_STAND.yAfterPushWithout}, \`scrollRestoration\`: \`${SCROLL_STAND.restorationWithout}\``],
  ['без роутера: `pushState` на 1500, прокрутили до 200, «назад»', `\`auto\` — ${SCROLL_STAND.plainAuto}, \`manual\` — ${SCROLL_STAND.plainManual}`],
];

export const NAVAPI_SCROLL_ROWS: string[][] = NAVAPI_SCROLL.map((r) => [r.k, String(r.before), String(r.after), `\`${r.focus.toLowerCase()}\``]);

export const NAVAPI_ORDER_TEXT = NAVAPI_ORDER.map((e, i) => `${i + 1}. ${e}`).join('\n');
