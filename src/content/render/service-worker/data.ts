import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { StrategyCase, StrategyStep, SwScenario, SwSnapshot, SwStep } from '@/widgets/sw-lab/model/types';

/**
 * Данные темы «Service Worker изнутри: жизненный цикл и работа без сети».
 *
 * Тема написана здесь, 2026-10-01. Смежное не пересказывается: зачем нужен Service Worker
 * и когда он не нужен, пять стратегий обзорно, схема «спросить пользователя и перезагрузить»
 * и «аварийная кнопка» — «Сеть и кеширование», раздел «Service Worker»; Cache API и квота —
 * «Хранилища браузера»; событие `push` — «Web Push»; другие воркеры — «Воркеры».
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * Node 24.11.0, Playwright 1.63.0, Chromium **153.0.8010.12** (`channel: 'chromium'`, новый
 * headless), 1 октября 2026. Сервер — `node:http` на `localhost:53800–53811` (localhost —
 * безопасный контекст). Скрипты лежали в каталоге scratchpad агента (`agent-sw/lifecycle.mjs`,
 * `update.mjs`, `fetch.mjs`, `strategies.mjs`, `stop.mjs`, `idle3.mjs`, `bfcache.mjs`,
 * `secure.mjs`), в репозиторий не входят. Ни одного таймерного замера: везде порядок событий,
 * число запросов к серверу, тексты ответов.
 *
 * Как снят жизненный цикл (`LIFECYCLE_SCENARIOS[].chromium`). Сервер отдаёт под `/sw.js`
 * `SW_CODE` дословно; версия и флаги сценария вставляются строками — так же, как их описывает
 * `VARIANT_NOTE` в теме (`skipWaiting` — первой строкой `install`, `claim` — после чистки кешей,
 * 404 — лишний адрес `/missing.js` в `PRECACHE`), плюс служебный обработчик `message`, который
 * отвечает версией. Версию воркера стенд узнаёт по `Last-Modified` скрипта (секунды = номер
 * версии) из CDP `ServiceWorker.workerVersionUpdated`; поле `workers` — смены `status` по порядку
 * событий CDP. Страница (`PAGE_CODE` + запись `controllerchange` в массив) — каждая вкладка.
 * После шага стенд ждёт 2,5 с тишины в событиях CDP (проверка обновления после навигации
 * приходит не сразу, см. ниже), затем снимает `controllerchange` из вкладок и спрашивает версию
 * у `navigator.serviceWorker.controller` через `MessageChannel`. Десять сценариев × три
 * прогона, журналы всех трёх прогонов совпали.
 *
 * Прочее снято (литералы `STAND`):
 *   — запросы сервера при первой установке, ключи `caches.keys()` по шагам, смесь версий после
 *     деплоя (`app.js` из кеша v1 при v2 на сервере), офлайн с `context.setOffline(true)`: заглушка
 *     из кеша, `fetch` мимо кеша — `TypeError: Failed to fetch`; без воркера навигация падает
 *     с `net::ERR_INTERNET_DISCONNECTED`;
 *   — риск `skipWaiting` + `claim`: старая страница просит `/report.v1.js`, которого нет
 *     ни в кеше v2, ни на сервере, — `TypeError: Failed to fetch dynamically imported module`;
 *   — проверка обновления: после навигации запрос за `sw.js` пришёл через ~1,5–2 с
 *     (четыре наблюдения, и на тихой странице, и на странице, которая всё время дёргала воркер);
 *     заголовки запроса `Service-Worker: script` и `Cache-Control: max-age=0`; `updateViaCache`
 *     при `Cache-Control: max-age=3600` на `sw.js`; смена только `importScripts`-файла даёт новую
 *     версию; воркер с «всё из кеша», положивший в кеш сам `/sw.js`, обновление не блокирует;
 *   — область: `/js/sw.js` → область `/js/`; область `/` — `SecurityError`, с заголовком
 *     `Service-Worker-Allowed: /` — регистрируется;
 *   — безопасный контекст: `localhost` и `127.0.0.1` — `navigator.serviceWorker` есть,
 *     `http://shop.test` (через `--host-resolver-rules`) — `undefined`, как и `caches`;
 *   — стратегии: `STRATEGY_CODE` и `ROUTER_CODE` дословно в `sw.js`, сценарий `STRATEGY_STEPS`,
 *     три прогона на стратегию, совпали;
 *   — navigation preload: заголовок `Service-Worker-Navigation-Preload: true`; без чтения
 *     `preloadResponse` сервер получил запрос за страницей дважды;
 *   — сон: CDP `ServiceWorker.stopWorker` → счётчик `STATE_CODE` начался заново. Сам по себе
 *     воркер под Playwright не уснул за 75 с ни с сессией CDP, ни без неё. Поэтому простой снят
 *     отдельно: бинарь Chromium запущен процессом (`--headless=new`, свежий профиль, без
 *     отладочного порта), страница сообщала серверу ответы маячком. Пауза 10 с и 25 с — счёт
 *     продолжился, 40 с и 70 с — начался с единицы. Один прогон — это наблюдение, не замер;
 *   — bfcache (`ignoreDefaultArgs: ['--disable-back-forward-cache']`): страница в кеше
 *     «назад-вперёд» не удержала v1 — после закрытия последней открытой вкладки v2 активировался,
 *     а при «назад» страница загрузилась заново под v2, CDP `Page.backForwardCacheNotUsed`:
 *     `ServiceWorkerVersionActivation`;
 *   — жёсткая перезагрузка (CDP `Page.reload` с `ignoreCache`) — `controller` `null`,
 *     `app.js` с сервера; `unregister()` — `true`, `getRegistration()` регистрации не находит,
 *     но `controller` до перезагрузки прежний и `fetch` всё ещё идёт через воркер.
 *
 * Только по документации, не запускалось: потолок 24 часа на HTTP-кеш `sw.js`; галочки DevTools
 * (Update on reload, Bypass for network) и страница `chrome://serviceworker-internals`;
 * поведение Firefox и Safari; заголовок `Clear-Site-Data`.
 *
 * ── Учебный код исполняется тестом ─────────────────────────────────────────────────────────
 * `LIFECYCLE_CODE` — модель регистрации; `tests/unit/service-worker.test.ts` сверяет её журнал
 * с журналом Chromium на каждом шаге каждого сценария и проверяет, что сценарии различают модели
 * (модель, где F5 освобождает ожидание, или где `skipWaiting` не переводит вкладки без `claim`,
 * краснеет). `STRATEGY_CODE` прогоняется `REPLAY_CODE` и сверяется с ответами стенда. `SW_CODE`
 * и `STATE_CODE` исполняются в поддельном глобальном объекте воркера: список предзагрузки,
 * чистка кешей, офлайн-заглушка.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'Service Worker',
    d: 'Ваш скрипт, который браузер запускает отдельно от страниц. Он получает событие `fetch` на каждый запрос страниц своей области и решает, чем ответить: сетью, кешем или собранным на месте ответом.',
  },
  {
    k: 'регистрация',
    d: 'Запись в браузере: «для этой области адресов работает вот этот скрипт». У регистрации три места под версии воркера — `installing`, `waiting`, `active`, — и в каждом может стоять своя.',
  },
  {
    k: 'область (scope)',
    d: 'Начало адреса, которое обслуживает регистрация. Область `/app/` — это все страницы, чей адрес начинается с `/app/`. По умолчанию — каталог, где лежит скрипт воркера.',
  },
  {
    k: 'клиент и контроллер',
    d: 'Клиент — вкладка (или воркер) из области. Контроллер — версия воркера, которая перехватывает запросы этой вкладки: `navigator.serviceWorker.controller`. `null` — запросы идут мимо воркера.',
  },
  {
    k: '`event.waitUntil(promise)`',
    d: 'Просьба к браузеру: «событие не закончено, пока не выполнится этот промис». Держит воркер живым и, для `install`, решает исход: отклонённый промис — установка провалилась.',
  },
  {
    k: 'Cache Storage (`caches`)',
    d: 'Хранилище пар «запрос → ответ», куда воркер сам кладёт ответы. Заголовки `Cache-Control` на него не действуют: запись лежит, пока её не удалят.',
  },
];

export const PLAIN_SW =
  'Service Worker похож на секретаря в приёмной. Все письма компании (запросы страниц) идут через него: что-то он отдаёт из своей папки (кеша), что-то отправляет дальше по почте (в сеть). Нового секретаря сначала оформляют и вводят в курс дела — это установка. Но пока старый ведёт хотя бы одного посетителя, новый сидит в соседней комнате и ждёт: менять секретаря посреди разговора нельзя.';

export const PREREQ_NOTE =
  'Тема углубляет то, что разобрано обзорно в других темах. Зачем нужен воркер и какие бывают стратегии кеширования, здесь повторяется одной фразой.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'Зачем нужен Service Worker',
    d: 'Скрипт-посредник между страницей и сетью: работа без сети, push-уведомления, своя логика кеша. Для простого «чтобы быстрее грузилось» обычно хватает заголовков кеширования.',
    href: '/platform/network/#s5',
    hrefLabel: '«Сеть и кеширование», раздел «Service Worker»',
    tone: 'info',
  },
  {
    t: 'HTTP-кеш и `Cache-Control`',
    d: 'Браузер хранит ответы сам и решает по заголовкам, можно ли отдать их без сервера. Воркер стоит **перед** этим кешем, а его собственный скрипт тоже проходит через HTTP-кеш.',
    href: '/platform/network/#s2',
    hrefLabel: '«Сеть и кеширование», раздел «Кеш и валидация»',
    tone: 'info',
  },
  {
    t: 'Cache API',
    d: '`caches.open(name)`, `cache.put`, `cache.match`, `caches.keys`, `caches.delete`. Чем это хранилище отличается от HTTP-кеша и сколько в него влезает.',
    href: '/platform/browser-storage/#s5',
    hrefLabel: '«Хранилища браузера», раздел «Cache API и OPFS»',
    tone: 'info',
  },
  {
    t: 'Воркер — отдельный поток',
    d: 'У воркера свой глобальный объект и свой цикл событий, DOM нет, общение — сообщениями. Service Worker — один из трёх видов воркеров.',
    href: '/js/workers/#s1',
    hrefLabel: '«Воркеры», раздел «Агент»',
    tone: 'info',
  },
];

// ─── Раздел 1. Регистрация и область ──────────────────────────────────────────────────────

export const PAGE_CODE = `<script src="/app.js"></script>
<script>
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    console.log('у вкладки сменился контроллер');
  });
  navigator.serviceWorker.register('/sw.js');
</script>`;

export const SW_CODE = `const VERSION = 'v1';
const CACHE = \`static-\${VERSION}\`;
const PRECACHE = ['/offline.html', '/app.js', \`/report.\${VERSION}.js\`];

self.addEventListener('install', (event) => {
  // Пока промис не выполнен, воркер остаётся в installing.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== CACHE) await caches.delete(key);   // кеши прошлых версий
    }
  })());
});

self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') {
    // Страница — из сети, без сети — заранее сохранённая заглушка.
    event.respondWith(fetch(event.request).catch(() => caches.match('/offline.html')));
    return;
  }
  // Остальное — сначала из своего кеша.
  event.respondWith(caches.match(event.request).then((hit) => hit ?? fetch(event.request)));
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});`;

export const FIRST_FACTS = [
  {
    t: 'Первая страница воркеру не принадлежит',
    d: 'Вкладка, которая вызвала `register()`, к моменту установки уже загружена — без воркера. На стенде v1 прошёл `installing → installed → activating → activated` за один шаг, а `controller` у вкладки остался `null`. После перезагрузки — `v1`.',
    tone: 'warn' as const,
  },
  {
    t: '`ready` — не «управляет»',
    d: '`navigator.serviceWorker.ready` выполняется, когда у регистрации есть активный воркер. На стенде в этот момент `controller` был `null`. Ждать управления — это событие `controllerchange` или перезагрузка.',
  },
  {
    t: 'Только безопасный контекст',
    d: 'На `http://localhost` и `http://127.0.0.1` `navigator.serviceWorker` есть. На `http://shop.test` — `undefined`, и `caches` тоже: проверка `\'serviceWorker\' in navigator` на таком адресе даёт `false`. В продакшене — только HTTPS.',
  },
];

export const SCOPE_ROWS = [
  { k: "`register('/js/sw.js')`", r: 'область `/js/`', d: 'По умолчанию область — каталог скрипта. Страница `/` под неё не попадает.', tone: undefined },
  { k: "`register('/js/sw.js', { scope: '/' })`", r: '`SecurityError`', d: 'Шире каталога скрипта нельзя: «The path of the provided scope (\'/\') is not under the max scope allowed (\'/js/\')».', tone: 'err' as const },
  { k: 'то же + заголовок `Service-Worker-Allowed: /` у скрипта', r: 'область `/`', d: 'Сервер разрешил воркеру из `/js/` обслуживать весь сайт.', tone: 'ok' as const },
];

export const SCOPE_NOTE =
  'Проще всего класть `sw.js` в корень сайта: тогда его область — весь сайт без всяких заголовков. Сборщики, которые кладут всё в `/assets/`, для воркера обычно делают исключение именно поэтому.';

// ─── Раздел 2. Установка и активация ─────────────────────────────────────────────────────

export const INSTALL_ROWS = [
  { k: 'страница', what: '`GET /`, `GET /app.js`', note: 'Обычная загрузка, воркера ещё нет.' },
  { k: '`register()`', what: '`GET /sw.js`', note: 'Браузер скачал скрипт и запустил его.' },
  { k: '`install`', what: '`GET /offline.html`, `GET /app.js`, `GET /report.v1.js`', note: '`cache.addAll(PRECACHE)` — по запросу на адрес. `app.js` пришёл второй раз: страница взяла его раньше, но в Cache Storage он попадает только так.' },
  { k: 'после `activate`', what: '`caches.keys()` → `[\'static-v1\']`', note: 'Чистить нечего — это первая версия.' },
];

export const CACHE_KEYS_ROWS = [
  { k: 'v1 активен', keys: "`['static-v1']`" },
  { k: 'v2 установлен и ждёт', keys: "`['static-v1', 'static-v2']`" },
  { k: 'v2 активировался', keys: "`['static-v2']`" },
];

export const WAITUNTIL_NOTE =
  'Пока промис из `waitUntil` не выполнен, воркер стоит в `installing`. Отклонился промис — установка провалилась целиком: на стенде в `PRECACHE` версии v2 добавили адрес, на который сервер отвечает 404, и v2 прошёл `installing → redundant`. `redundant` — «выброшен»: v1 остался активным, вкладка его не потеряла. Без `waitUntil` браузер не знал бы, что надо подождать, и счёл бы воркер установленным с неполным кешем.';

export const ACTIVATE_NOTE =
  'Новый кеш называется по версии: `static-v2` пишется рядом со `static-v1`, а не поверх него. Пока v2 ждёт, v1 продолжает отдавать файлы из своего кеша. Удалять старое можно только в `activate` — в момент, когда v1 уже никого не обслуживает.';

// ─── Раздел 3. Почему новая версия ждёт ──────────────────────────────────────────────────

export const PLAIN_WAITING =
  'Как смена программы в кинотеатре. Новый фильм уже привезли и проверили, но в зале идёт сеанс старого. Пока в зале есть хоть один зритель, ленту не меняют. Зритель, который вышел и сразу купил билет на следующий сеанс, попадает на тот же старый фильм: зал так и не опустел ни на минуту.';

export const LIFECYCLE_CODE = `// Модель одной регистрации: на сервере лежит sw.js (script), у регистрации
// три места — installing, waiting, active, у каждой вкладки — свой контроллер.
// script = { v: 'v2', skipWaiting?: true, claim?: true, missing?: true }

function createModel() {
  return { server: null, reg: null, tabs: new Map(), events: [], changed: [] };
}

function install(m, script) {
  const worker = { v: script.v, script, skip: Boolean(script.skipWaiting) };
  m.events.push(\`\${worker.v} installing\`);
  if (script.missing) {                         // cache.addAll получил 404
    m.events.push(\`\${worker.v} redundant\`);     // старый воркер работает дальше
    return;
  }
  m.events.push(\`\${worker.v} installed\`);
  m.reg.waiting = worker;
  tryActivate(m);
}

function tryActivate(m) {
  const { waiting, active } = m.reg;
  if (!waiting) return;
  const busy = active && [...m.tabs.values()].includes(active);
  if (busy && !waiting.skip) return;            // ждёт, пока у active есть вкладки
  if (active) m.events.push(\`\${active.v} redundant\`);
  m.reg.active = waiting;
  m.reg.waiting = null;
  m.events.push(\`\${waiting.v} activating\`);
  for (const [tab, worker] of m.tabs) {
    // Вкладки старого воркера переходят к новому сами — claim() для этого не нужен.
    const take = (active && worker === active) || (waiting.script.claim && worker !== waiting);
    if (take) {
      m.tabs.set(tab, waiting);
      m.changed.push(tab);                      // событие controllerchange во вкладке
    }
  }
  m.events.push(\`\${waiting.v} activated\`);
}

function update(m) {
  const newest = m.reg.installing ?? m.reg.waiting ?? m.reg.active;
  const same = JSON.stringify(newest.script) === JSON.stringify(m.server);
  if (!same) install(m, m.server);              // байт в байт тот же — ничего
}

function navigate(m, tab) {
  m.tabs.set(tab, m.reg?.active ?? null);       // контроллер выбран в момент навигации
  if (!m.reg) {                                 // первая страница зовёт register()
    m.reg = { installing: null, waiting: null, active: null };
    install(m, m.server);
  } else {
    update(m);                                  // после навигации — проверка обновления
  }
}

const ACTIONS = {
  deploy: (m, s) => { m.server = s.script; },
  open: (m, s) => navigate(m, s.tab),
  reload: (m, s) => navigate(m, s.tab),
  update: (m) => update(m),
  close: (m, s) => { m.tabs.delete(s.tab); tryActivate(m); },
  skip: (m) => { if (m.reg.waiting) { m.reg.waiting.skip = true; tryActivate(m); } },
};

function run(steps) {
  const m = createModel();
  return steps.map((step) => {
    m.events = [];
    m.changed = [];
    ACTIONS[step.do](m, step);
    const tabs = {};
    for (const [tab, worker] of m.tabs) tabs[tab] = worker ? worker.v : null;
    return {
      workers: m.events,
      controllerchange: [...m.changed].sort(),
      waiting: m.reg?.waiting?.v ?? null,
      active: m.reg?.active?.v ?? null,
      tabs,
    };
  });
}`;

export const WAIT_RULE =
  'Правило одно: **новая версия активируется, когда у старой не осталось ни одной вкладки, которой она управляет.** Перезагрузка вкладку не освобождает — новый документ выбирает контроллер в момент навигации, пока старый ещё на экране, и это снова v1. Закрыть вкладку, уйти с сайта или перейти на адрес вне области — освобождает.';

export const VARIANT_NOTE =
  'Версии в сценариях — это `SW_CODE` с правками. `VERSION` — номер версии. «+ skipWaiting» — строка `self.skipWaiting();` первой в обработчике `install`. «+ claim» — `await self.clients.claim();` после цикла чистки в `activate`. «404 в PRECACHE» — лишний адрес `/missing.js` в списке, на который сервер отвечает 404. Вкладка — страница с `PAGE_CODE`.';

export const OWN_NOTE =
  'Соберите порядок сами: выложите версию, откройте вкладки, перезагружайте и закрывайте их. Флажки задают, чем следующая версия отличается от `SW_CODE`. Журнал здесь считает только модель — стенд гонял сценарии из списка.';

export const DEMO_CAPTION =
  'Журнал модели считает `LIFECYCLE_CODE`, напечатанный выше. Рядом — журнал Chromium 153 на том же сценарии: смены состояния из протокола DevTools, `controllerchange` из вкладок и версия, которой ответил контроллер. Сценарии можно собрать и самому — тогда журнал считает только модель.';

export const WAIT_FACTS = [
  {
    t: 'Вкладка без контроллера не держит',
    d: 'Считаются только вкладки, которыми v1 управляет. Страница, которая когда-то регистрировала воркер и не перезагружалась, ему не принадлежит: на стенде v2 активировался, когда закрыли вторую вкладку, хотя первая оставалась открытой.',
  },
  {
    t: 'Страница в bfcache не держит',
    d: 'Ушли с сайта по ссылке — страница легла в кеш «назад-вперёд», но v1 не удержала: закрыли последнюю открытую вкладку — v2 активировался. Цена — страницу из кеша выбросили. CDP назвал причину `ServiceWorkerVersionActivation`, и «назад» загрузил её заново, уже под v2. Что такое этот кеш — в теме [«Навигации без ожидания»](/platform/instant-navigation/#s1).',
  },
  {
    t: 'Активироваться можно без вкладок',
    d: 'Закрыли все вкладки — v2 прошёл `activating → activated` сразу, без единого клиента. Следующая открытая вкладка получила v2 с первого запроса.',
  },
];

// ─── Раздел 4. skipWaiting и claim ───────────────────────────────────────────────────────

export const SKIP_ROWS = [
  {
    k: '`self.skipWaiting()`',
    what: 'Ждущая версия активируется сразу, не дожидаясь вкладок. **Вкладки, которыми управлял v1, переходят к v2 сами**, в каждой срабатывает `controllerchange`.',
    not: 'Вкладку без контроллера не трогает: на стенде она осталась `null`.',
  },
  {
    k: '`self.clients.claim()`',
    what: 'Активный воркер забирает все вкладки своей области, у которых другой контроллер или никакого. Вызывают в `activate`.',
    not: 'Ожидание не отменяет: из `waiting` не выводит. Нужен, чтобы управлять первой страницей без перезагрузки.',
  },
];

export const SKIP_NOTE =
  'Частое заблуждение — что без `claim()` после `skipWaiting()` вкладки останутся у старой версии. Стенд показывает обратное: вкладки v1 перешли к v2 сами, в момент активации. Это следует из спецификации: активация передаёт новой версии всех клиентов старой. `claim()` нужен для другого — для вкладок, которыми не управлял никто.';

export const RISK_CODE = `// app.js версии v1 — страница загружена с ним
window.APP = 'v1';
window.openReport = () => import('/report.v1.js');   // ленивый кусок

// v2 на сервере: report.v2.js, а report.v1.js уже нет (404)`;

export const RISK_ROWS = [
  {
    k: 'v2 ждёт (по умолчанию)',
    ctrl: '`v1`',
    keys: "`['static-v1', 'static-v2']`",
    got: '`отчёт v1` — из кеша v1, сервер не спрашивали',
    tone: 'ok' as const,
  },
  {
    k: 'v2: `skipWaiting` + `claim`',
    ctrl: '`v2`, `controllerchange`',
    keys: "`['static-v2']`",
    got: '`TypeError: Failed to fetch dynamically imported module` — в кеше v2 файла нет, сервер ответил 404',
    tone: 'err' as const,
  },
];

export const RISK_NOTE =
  'Страница загружена с v1: в её памяти `app.js` версии v1, и он знает только `/report.v1.js`. Воркер v2 с `skipWaiting` и `claim` забрал эту вкладку и в `activate` удалил `static-v1`. Пользователь нажал «Отчёт» — запрос ушёл через v2, кеш промахнулся, сервер нового релиза такого файла уже не держит. Страница не перезагружалась и об обновлении не знает.';

export const MIX_NOTE =
  'Вторая сторона того же: **кеш, который первым отдаёт файл без хеша в имени, держит старую версию дольше, чем кажется.** После деплоя v2 вкладку перезагрузили: HTML пришёл из сети, а `app.js` — из `static-v1`, и страница исполнила `APP = \'v1\'`, хотя сервер уже отдавал v2. Так будет, пока v2 не активируется. Схема «спросить пользователя и перезагрузить» разобрана в [«Сети и кешировании»](/platform/network/#s5).';

// ─── Раздел 5. Проверка обновления ───────────────────────────────────────────────────────

export const UPDATE_TRIGGERS = [
  {
    t: 'Навигация по области',
    d: 'Открыли или перезагрузили страницу — браузер проверит `sw.js`, но не сразу: на стенде запрос пришёл через полторы-две секунды после навигации. Поэтому сразу после F5 `reg.waiting` ещё пуст.',
  },
  {
    t: '`reg.update()`',
    d: 'Проверка по требованию: например, по таймеру во вкладке, которую держат открытой днями. На стенде после `update()` новая версия встала в `waiting` — тем же путём, что и после навигации.',
  },
  {
    t: 'Функциональные события',
    d: 'Браузер проверяет обновление и после событий вроде `push` и `sync`, если с прошлой проверки прошло больше суток. Это по спецификации, стендом не снималось.',
  },
];

export const BYTES_NOTE =
  'Новая версия — это **другие байты скрипта**. Браузер скачивает `sw.js`, сравнивает с установленным побайтно и, если совпало, не делает ничего: на стенде `update()` с тем же файлом не дал ни одного события. Сравниваются и файлы из `importScripts()`: поменяли только импорт — получили новую версию. Значит, поменять номер в `const VERSION` или хеш в имени импорта — достаточно; поменять файл, который воркер скачивает через `fetch`, — нет.';

export const VIA_CACHE_ROWS = [
  { k: "`'imports'` (по умолчанию)", main: 'мимо HTTP-кеша', imp: 'через HTTP-кеш', seen: 'да: 2 запроса на 2 вызова', tone: 'ok' as const },
  { k: "`'none'`", main: 'мимо HTTP-кеша', imp: 'мимо HTTP-кеша', seen: 'да: 2 запроса на 2 вызова', tone: 'ok' as const },
  { k: "`'all'`", main: 'через HTTP-кеш', imp: 'через HTTP-кеш', seen: '**нет**: 0 запросов, v2 не замечен', tone: 'err' as const },
];

export const VIA_CACHE_NOTE =
  'На стенде `sw.js` отдавался с `Cache-Control: max-age=3600`, после регистрации на сервере появлялся v2, и страница дважды звала `update()`. Запрос за скриптом приходит с заголовками `Service-Worker: script` и `Cache-Control: max-age=0`. Надёжнее всего отдавать `sw.js` с `Cache-Control: no-cache` и не трогать `updateViaCache`: тогда ни один кеш между браузером и сервером не спрячет новую версию.';

export const SELF_NOTE =
  'Запрос за обновлением своего скрипта воркер **не перехватывает**. На стенде воркер отдавал всё из кеша и положил туда сам `/sw.js`. Страничный `fetch(\'/sw.js\')` получил из кеша v1, а `update()` дошёл до сервера и поставил v2. Поэтому «аварийная кнопка» — новый `sw.js`, который удаляет себя, — доходит даже до воркера, который кеширует всё подряд, если сам скрипт не залип в HTTP-кеше.';

// ─── Раздел 6. Перехват fetch ─────────────────────────────────────────────────────────────

export const RESPOND_NOTE =
  'Обработчик `fetch` вызывается на каждый запрос вкладок своей области: на навигацию, скрипты, картинки, `fetch()` из кода. Ответить можно только синхронно — вызвать `event.respondWith(promise)` до выхода из обработчика. Не вызвал — запрос идёт в сеть так, будто воркера нет. На стенде `respondWith` из `setTimeout` бросил `InvalidStateError: … The event handler is already finished.`, а страница получила ответ сервера. Поэтому маршрутизатор ниже для чужих адресов просто выходит, а асинхронную работу заворачивает в промис, который отдаёт `respondWith` сразу.';

export const STRATEGY_CODE = `// request — запрос, cache — открытый Cache, network — функция вроде fetch.
// later(promise) — фоновая работа после ответа; в воркере это event.waitUntil.

async function cacheFirst(request, cache, network) {
  const hit = await cache.match(request);
  if (hit) return hit;                                  // сеть не трогаем вовсе
  const response = await network(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

async function networkFirst(request, cache, network) {
  try {
    const response = await network(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {                                     // сеть упала — берём кеш
    const hit = await cache.match(request);
    if (hit) return hit;
    throw error;
  }
}

async function staleWhileRevalidate(request, cache, network, later) {
  const hit = await cache.match(request);
  const refresh = network(request).then(async (response) => {
    if (response.ok) await cache.put(request, response.clone());
    return response;
  });
  if (!hit) return refresh;                             // кеш пуст — ждём сеть
  later(refresh.catch(() => {}));                       // обновим кеш после ответа
  return hit;                                           // а отдаём старое сразу
}`;

export const ROUTER_CODE = `const STRATEGIES = {
  '/data/cf': cacheFirst,
  '/data/nf': networkFirst,
  '/data/swr': staleWhileRevalidate,
};

self.addEventListener('fetch', (event) => {
  const strategy = STRATEGIES[new URL(event.request.url).pathname];
  if (!strategy) return;                    // остальное — мимо воркера
  event.respondWith(
    caches.open('data').then((cache) =>
      strategy(event.request, cache, fetch, (p) => event.waitUntil(p)),
    ),
  );
});`;

export const REPLAY_CODE = `// Сервер стенда в миниатюре: отвечает «данные N» и считает запросы,
// без сети бросает TypeError, как fetch. Кеш — Map по адресу.
async function replay(strategy, steps) {
  let content = 1, hits = 0, offline = false;
  const network = async () => {
    if (offline) throw new TypeError('Failed to fetch');
    hits++;
    return new Response(\`данные \${content}\`);
  };
  const store = new Map();
  const cache = {
    match: async (request) => store.get(request.url)?.clone(),
    put: async (request, response) => { store.set(request.url, response); },
  };
  const log = [];
  for (const step of steps) {
    if (step === 'bump') content++;
    if (step === 'offline') offline = true;
    if (step === 'online') offline = false;
    if (step !== 'get') continue;
    const before = hits;
    const background = [];
    const got = await strategy(new Request('https://site.test/data'), cache, network, (p) => background.push(p))
      .then((r) => r.text(), (e) => e.name);
    await Promise.all(background);                    // стенд ждал 500 мс
    log.push({ got, hits: hits - before });
  }
  return log;
}`;

export const STRATEGY_STEPS: StrategyStep[] = [ 'get', 'get', 'bump', 'get', 'get', 'offline', 'get', 'online', 'bump', 'get', 'get' ];

export const STRATEGY_STEP_TEXT: Record<StrategyStep, string> = {
  get: 'страница: fetch',
  bump: 'на сервере новые данные',
  offline: 'сеть пропала',
  online: 'сеть вернулась',
};

export const STRATEGY_CAPTION =
  'Ответы считает `STRATEGY_CODE`, прогнанный через `REPLAY_CODE`: сервер и кеш в миниатюре, как на стенде. Столбец Chromium — что получила страница стенда, когда те же функции работали в настоящем воркере. «Запросов» — сколько обращений к серверу случилось за шаг, вместе с фоновым обновлением.';

export const STRATEGY_FACTS = [
  {
    t: 'Cache-first не узнаёт о новых данных',
    d: 'После первого ответа сеть не спрашивается вовсе: на стенде семь запросов страницы — один запрос к серверу, и все семь раз `данные 1`. Годится для файлов с хешем в имени, которые не меняются по своему адресу.',
  },
  {
    t: 'Network-first ходит в сеть каждый раз',
    d: 'Шесть запросов из семи дошли до сервера. Кеш спас один раз — без сети. Пока сеть «вроде есть, но не отвечает», страница ждёт: таймаут на `fetch` разобран в «Сети и кешировании».',
  },
  {
    t: 'Stale-while-revalidate отстаёт на один шаг',
    d: 'После обновления на сервере страница получила `данные 1`, а свежие — только следующим запросом: фоновое обновление кладёт их в кеш уже после ответа. Без сети фоновый запрос падает молча, а страница получает кеш.',
  },
];

export const PRELOAD_CODE = `self.addEventListener('activate', (event) => {
  event.waitUntil(self.registration.navigationPreload.enable());
});

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith((async () => {
    const preloaded = await event.preloadResponse;   // ответ уже в пути
    return preloaded ?? fetch(event.request);
  })());
});`;

export const PLAIN_PRELOAD =
  'Как заказать такси, пока одеваетесь. Без предзагрузки браузер сначала будит воркер и ждёт, что тот решит, и только потом идёт за страницей. С ней запрос за страницей уходит сразу, параллельно с пробуждением, а воркер забирает уже приехавший ответ.';

export const PRELOAD_ROWS = [
  { k: 'читает `event.preloadResponse`', reqs: '1', head: '`Service-Worker-Navigation-Preload: true`', tone: 'ok' as const },
  { k: 'включил, но делает свой `fetch(event.request)`', reqs: '**2**', head: 'первый с заголовком, второй без', tone: 'err' as const },
];

export const PRELOAD_NOTE =
  'Включённая предзагрузка уходит при каждой навигации, читает её воркер или нет. Забыли `preloadResponse` — сервер получает каждую страницу дважды. Заголовок помогает серверу отличить такой запрос; значение меняется вызовом `navigationPreload.setHeaderValue()`.';

// ─── Раздел 7. Без сети ──────────────────────────────────────────────────────────────────

export const OFFLINE_ROWS = [
  { k: 'навигация, воркер есть', got: 'заглушка `/offline.html` из кеша: заголовок «Нет сети»', tone: 'ok' as const },
  { k: '`app.js` из `PRECACHE`', got: 'из кеша, как и с сетью', tone: 'ok' as const },
  { k: "`fetch('/data')` — нет в кеше", got: '`TypeError: Failed to fetch` — `caches.match` промахнулся, `fetch` упал', tone: 'warn' as const },
  { k: 'навигация, воркера нет', got: 'страница ошибки браузера `net::ERR_INTERNET_DISCONNECTED`', tone: 'err' as const },
];

export const OFFLINE_NOTE =
  'Работа без сети — это не режим, а ветка `catch` в каждом обработчике. Воркер не знает заранее, есть ли сеть: он пробует `fetch` и получает отказ. Чем ответить на отказ — решает код. В `SW_CODE` у навигации запасной ответ есть, а у прочих запросов нет: что не попало в кеш, без сети не отдаётся.';

export const ONLINE_NOTE =
  '`navigator.onLine` здесь не помощник: он говорит о наличии сетевого интерфейса, а не о том, что сервер ответит. Сеть «есть», а запрос висит — обычная картина в метро. Ориентир — исход самого `fetch`.';

// ─── Раздел 8. Сон и пробуждение ─────────────────────────────────────────────────────────

export const STATE_CODE = `let count = 0;                       // живёт, пока жив процесс воркера

self.addEventListener('fetch', (event) => {
  if (new URL(event.request.url).pathname === '/count') {
    event.respondWith(new Response(String(++count)));
  }
});`;

export const SLEEP_ROWS = [
  { k: 'три запроса подряд', got: '`1`, `2`, `3`' },
  { k: 'CDP `ServiceWorker.stopWorker`, ещё два', got: '`1`, `2` — новый запуск скрипта, `count` снова 0' },
  { k: 'без DevTools: пауза 10 с', got: 'счёт продолжился' },
  { k: 'без DevTools: пауза 25 с', got: 'счёт продолжился' },
  { k: 'без DevTools: пауза 40 с', got: '`1` — воркер успел уснуть' },
  { k: 'под Playwright: пауза 75 с', got: 'счёт продолжился — воркер не засыпал' },
];

export const SLEEP_NOTE =
  'Воркер живёт от события до события. Браузер останавливает его после простоя — в Chromium стенда где-то между 25 и 40 секундами, — а на следующее событие запускает скрипт заново, с верхней строки. Всё, что лежало в переменных, пропадает. То, что должно пережить сон, — в IndexedDB или Cache Storage. `event.waitUntil` продлевает жизнь на время своего промиса, но не навсегда.';

export const SLEEP_TRAP =
  'Под автотестами Playwright воркер не засыпал вовсе: Playwright подключается к нему по протоколу DevTools. Значит, ошибка «потерялась глобальная переменная» в таких тестах не воспроизводится. Проверять её — явной остановкой: кнопка stop на вкладке Application в DevTools или команда `ServiceWorker.stopWorker`.';

// ─── Раздел 9. Отладка и залипший воркер ─────────────────────────────────────────────────

export const DEBUG_ROWS = [
  {
    k: 'жёсткая перезагрузка (Ctrl+Shift+R)',
    what: 'Страница загружена мимо воркера: `controller` — `null`, `app.js` пришёл с сервера. Обычная перезагрузка после неё — снова v1.',
    tone: undefined,
  },
  {
    k: '`reg.unregister()`',
    what: 'Вернул `true`, и `getRegistration()` регистрации больше не находит. Но открытая вкладка **по-прежнему под v1**, и её `fetch` идёт через воркер. Без контроллера она будет только после перезагрузки.',
    tone: 'warn' as const,
  },
  {
    k: 'DevTools → Application → Service Workers',
    what: 'Видны версии и их состояния, кнопки Update, skipWaiting, Unregister, stop. Галочка Update on reload ставит новую версию при каждой перезагрузке, Bypass for network пускает запросы мимо воркера. По документации Chrome, стендом не проверялось.',
    tone: undefined,
  },
];

export const STUCK_NOTE =
  '«Залипший» воркер у пользователя чинится только новым `sw.js` — DevTools у пользователя нет. Отсюда три правила. `sw.js` отдаётся с `no-cache`, чтобы новая версия дошла. Имя скрипта не меняется: регистрация `/sw-v2.js` при живом `/sw.js` со «всё из кеша» не случится, потому что HTML с новым `register()` придёт из старого кеша. И заготовка «удалить всё и уйти» лежит наготове — она в [«Сети и кешировании»](/platform/network/#s5).';

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'F5 не активирует новую версию',
    d: 'Перезагрузка выбирает контроллер, пока старая страница ещё на экране, — и это снова старая версия. На стенде две перезагрузки подряд оставили v2 в `waiting`. Помогает закрыть все вкладки сайта, `skipWaiting()` или галочка Update on reload в DevTools.',
    tone: 'warn',
  },
  {
    n: '02',
    t: 'Первая страница не под воркером',
    d: 'Страница, которая зарегистрировала воркер, загрузилась без него: `controller` — `null`, `fetch`-обработчик её запросов не видит. «Офлайн не работает» на первом визите — это нормально. Нужно управление сразу — `clients.claim()` в `activate`.',
    tone: 'warn',
  },
  {
    n: '03',
    t: '`skipWaiting` меняет воркер под живой страницей',
    d: 'Вкладки старой версии переходят к новой без перезагрузки и без `claim()`. Страница со старым кодом теперь просит файлы у воркера, который их не знает: на стенде ленивый `report.v1.js` дал `TypeError: Failed to fetch dynamically imported module`. Безопасно — только вместе с перезагрузкой страницы.',
    tone: 'err',
  },
  {
    n: '04',
    t: 'Один адрес с 404 валит всю установку',
    d: '`cache.addAll` атомарен: не скачался один файл — промис отклонён, воркер `redundant`. Пользователи остаются на старой версии, ошибок в консоли страницы нет. Список предзагрузки собирают из того же манифеста сборки, что и HTML.',
    tone: 'err',
  },
  {
    n: '05',
    t: 'Глобальная переменная не переживает сон',
    d: 'Счётчик в `let` после остановки воркера начался с единицы. Под Playwright и при открытом DevTools воркер не засыпает, поэтому ошибка видна только у пользователей.',
    tone: 'err',
  },
  {
    n: '06',
    t: '`updateViaCache: \'all\'` прячет новые версии',
    d: 'С `max-age=3600` на `sw.js` два вызова `update()` не дошли до сервера ни разу. По умолчанию (`\'imports\'`) главный скрипт проверяется мимо HTTP-кеша — это значение лучше не трогать.',
    tone: 'warn',
  },
  {
    n: '07',
    t: 'Включённая предзагрузка без `preloadResponse` — двойной запрос',
    d: 'Сервер получает каждую навигацию два раза: предзагрузку и `fetch` воркера. На нагрузке это удвоение незаметно, пока не посмотреть в журнал сервера.',
    tone: 'warn',
  },
  {
    n: '08',
    t: '`unregister()` не отпускает открытые вкладки',
    d: 'Регистрация удалена, а вкладка до перезагрузки управляется тем же воркером и ходит через его кеш. Проверять результат удаления — после перезагрузки.',
  },
  {
    n: '09',
    t: 'Только безопасный контекст',
    d: 'На `http://` вне `localhost` нет ни `navigator.serviceWorker`, ни `caches`. Код, который зовёт их без проверки, падает с `TypeError` на тестовом стенде по IP или внутреннему домену.',
  },
];

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'W3C — Service Workers',
    href: 'https://w3c.github.io/ServiceWorker/',
    what: 'регистрация, Update, Install, Try Activate, Activate, `skipWaiting`, `clients.claim`, `updateViaCache`, navigation preload',
  },
  {
    title: 'web.dev — The service worker lifecycle',
    href: 'https://web.dev/articles/service-worker-lifecycle',
    what: 'ожидание, перезагрузка, `skipWaiting` и `claim` глазами разработчика',
  },
  {
    title: 'MDN — Using Service Workers',
    href: 'https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers',
    what: 'регистрация, установка, `respondWith`, кеширование',
  },
  {
    title: 'MDN — NavigationPreloadManager',
    href: 'https://developer.mozilla.org/en-US/docs/Web/API/NavigationPreloadManager',
    what: '`enable`, `setHeaderValue`, `getState`, заголовок `Service-Worker-Navigation-Preload`',
  },
  {
    title: 'Chrome DevTools — Debug Progressive Web Apps',
    href: 'https://developer.chrome.com/docs/devtools/progressive-web-apps',
    what: 'панель Application → Service Workers: Update on reload, Bypass for network, Unregister',
  },
  {
    title: 'Chrome DevTools Protocol — ServiceWorker domain',
    href: 'https://chromedevtools.github.io/devtools-protocol/tot/ServiceWorker/',
    what: '`workerVersionUpdated`, `stopWorker` — так снимались журналы стенда',
  },
];

export const RELATED =
  'Смежное на сайте: [Сеть и кеширование, раздел «Service Worker»](/platform/network/#s5) — зачем он нужен, пять стратегий обзорно, выкатка с вопросом пользователю и аварийная кнопка. [Хранилища браузера, раздел «Cache API и OPFS»](/platform/browser-storage/#s5) — само хранилище и квота. [Web Push, раздел «Событие push»](/platform/web-push/#s6) — ещё одно событие, ради которого воркер просыпается. [Навигации без ожидания](/platform/instant-navigation/#s1) — кеш «назад-вперёд». [Воркеры](/js/workers/#s1) — выделенный и общий воркеры. [Потоки](/platform/streams/) — ответ воркера, собранный из потока.';

// ─── Сценарии демо и литералы стенда ───────────────────────────────────────────────────────

export const STAND = {
  chromium: '153.0.8010.12',
  playwright: '1.63.0',
  node: '24.11.0',
  lifecycleRuns: 3,
  strategyRuns: 3,
  installRequests: [
    'GET /',
    'GET /app.js',
    'GET /favicon.ico',
    'GET /sw.js',
    'GET /offline.html',
    'GET /app.js',
    'GET /report.v1.js',
  ],
  keys: {
    v1: [
      'static-v1',
    ],
    v2Waiting: [
      'static-v1',
      'static-v2',
    ],
    v2Active: [
      'static-v2',
    ],
  },
  firstLoadController: null,
  afterDeploy: {
    controller: 'v1',
    app: 'v1',
    waiting: 'v2',
  },
  offline: {
    title: 'offline',
    data: 'TypeError: Failed to fetch',
    requests: 0,
  },
  noSwOffline: 'net::ERR_INTERNET_DISCONNECTED',
  risk: {
    wait: {
      controller: 'v1',
      report: 'отчёт v1',
      requests: [],
    },
    skipClaim: {
      controller: 'v2',
      controllerchange: 1,
      report: 'TypeError: Failed to fetch dynamically imported module',
      requests: [
        'GET /report.v1.js',
      ],
    },
  },
  hardReload: {
    controller: null,
    requests: [
      'GET /',
      'GET /app.js',
      'GET /favicon.ico',
    ],
    after: 'v1',
  },
  unregister: {
    result: true,
    registration: null,
    controller: 'v1',
    fetchHitServer: 0,
    afterReload: null,
  },
  scope: {
    defaultJs: '/js/',
    wider: 'SecurityError',
    widerMessage: "Failed to register a ServiceWorker for scope ('/') with script ('/js/sw.js'): The path of the provided scope ('/') is not under the max scope allowed ('/js/'). Adjust the scope, move the Service Worker script, or use the Service-Worker-Allowed HTTP header to allow the scope.",
    widerAllowed: '/',
  },
  secure: {
    localhost: 'object',
    '127.0.0.1': 'object',
    'shop.test': 'undefined',
  },
  viaCache: [
    {
      mode: '(по умолчанию)',
      value: 'imports',
      requestsAfterTwoUpdates: 2,
    },
    {
      mode: 'imports',
      value: 'imports',
      requestsAfterTwoUpdates: 2,
    },
    {
      mode: 'all',
      value: 'all',
      requestsAfterTwoUpdates: 0,
    },
    {
      mode: 'none',
      value: 'none',
      requestsAfterTwoUpdates: 2,
    },
  ],
  updateRequestHeaders: {
    'service-worker': 'script',
    'cache-control': 'max-age=0',
  },
  selfIntercept: {
    pageFetch: "const VERSION = 'v1';",
    afterUpdate: {
      slot: 'waiting',
      v: 'v2+i1',
    },
  },
  importOnly: {
    before: {
      slot: 'waiting',
      v: 'v2+i1',
    },
    after: {
      slot: 'waiting',
      v: 'v2+i2',
    },
  },
  navUpdateDelayMs: [
    1981,
    2018,
    1551,
    2019,
    1537,
  ],
  preload: {
    state: {
      enabled: true,
      headerValue: 'true',
    },
    requests: [
      {
        path: '/',
        preload: 'true',
      },
    ],
    ignoredRequests: [
      {
        path: '/',
        preload: 'true',
      },
      {
        path: '/',
        preload: null,
      },
    ],
  },
  sleep: {
    seq: [
      '1',
      '2',
      '3',
    ],
    afterStop: [
      '1',
      '2',
    ],
    idle: [
      {
        pauseS: 10,
        seq: [
          '1',
          '2',
          '3',
        ],
      },
      {
        pauseS: 25,
        seq: [
          '4',
          '5',
          '6',
        ],
      },
      {
        pauseS: 40,
        seq: [
          '7',
          '8',
          '1',
        ],
      },
      {
        pauseS: 70,
        seq: [
          '2',
          '3',
          '1',
        ],
      },
    ],
    playwright75s: [
      '1',
      '2',
      '3',
    ],
  },
  respond: {
    sync: 'из воркера',
    none: 'из сети',
    late: "InvalidStateError: Failed to execute 'respondWith' on 'FetchEvent': The event handler is already finished.",
  },
  bfcache: {
    notRestored: [
      'ServiceWorkerVersionActivation',
    ],
    controllerAfterBack: 'v2',
    whileAway: {
      installing: null,
      waiting: 'v2',
      active: 'v1',
    },
  },
};

export const LIFECYCLE_SCENARIOS: SwScenario[] = [
  {
    id: 'first',
    label: 'Первый визит',
    note: 'Вкладка A сама зарегистрировала воркер. v1 прошёл установку и активацию за один шаг, а `controller` у A — `null`: документ загрузился раньше воркера. Управлять вкладкой v1 начинает со следующей навигации.',
    steps: [
      { do: 'deploy', script: { v: 'v1' } },
      { do: 'open', tab: 'A' },
      { do: 'reload', tab: 'A' },
    ] as SwStep[],
    chromium: [
      { workers: [], controllerchange: [], waiting: null, active: null, tabs: {} },
      { workers: [ 'v1 installing', 'v1 installed', 'v1 activating', 'v1 activated' ], controllerchange: [], waiting: null, active: 'v1', tabs: { A: null } },
      { workers: [], controllerchange: [], waiting: null, active: 'v1', tabs: { A: 'v1' } },
    ] as SwSnapshot[],
  },
  {
    id: 'reload',
    label: 'F5 не помогает',
    note: 'На сервере v2. Перезагрузка A запускает проверку обновления: v2 ставится и уходит ждать. Вторая перезагрузка ничего не меняет — новый документ снова достаётся v1.',
    steps: [
      { do: 'deploy', script: { v: 'v1' } },
      { do: 'open', tab: 'A' },
      { do: 'reload', tab: 'A' },
      { do: 'deploy', script: { v: 'v2' } },
      { do: 'reload', tab: 'A' },
      { do: 'reload', tab: 'A' },
    ] as SwStep[],
    chromium: [
      { workers: [], controllerchange: [], waiting: null, active: null, tabs: {} },
      { workers: [ 'v1 installing', 'v1 installed', 'v1 activating', 'v1 activated' ], controllerchange: [], waiting: null, active: 'v1', tabs: { A: null } },
      { workers: [], controllerchange: [], waiting: null, active: 'v1', tabs: { A: 'v1' } },
      { workers: [], controllerchange: [], waiting: null, active: 'v1', tabs: { A: 'v1' } },
      { workers: [ 'v2 installing', 'v2 installed' ], controllerchange: [], waiting: 'v2', active: 'v1', tabs: { A: 'v1' } },
      { workers: [], controllerchange: [], waiting: 'v2', active: 'v1', tabs: { A: 'v1' } },
    ] as SwSnapshot[],
  },
  {
    id: 'close',
    label: 'Закрыть все вкладки',
    note: 'v2 ждёт, пока у v1 есть хоть одна вкладка. Закрыли B — ждёт дальше. Закрыли последнюю, A, — v2 активируется без единой вкладки, и новая вкладка C открывается уже под v2.',
    steps: [
      { do: 'deploy', script: { v: 'v1' } },
      { do: 'open', tab: 'A' },
      { do: 'reload', tab: 'A' },
      { do: 'open', tab: 'B' },
      { do: 'deploy', script: { v: 'v2' } },
      { do: 'update' },
      { do: 'close', tab: 'B' },
      { do: 'close', tab: 'A' },
      { do: 'open', tab: 'C' },
    ] as SwStep[],
    chromium: [
      { workers: [], controllerchange: [], waiting: null, active: null, tabs: {} },
      { workers: [ 'v1 installing', 'v1 installed', 'v1 activating', 'v1 activated' ], controllerchange: [], waiting: null, active: 'v1', tabs: { A: null } },
      { workers: [], controllerchange: [], waiting: null, active: 'v1', tabs: { A: 'v1' } },
      { workers: [], controllerchange: [], waiting: null, active: 'v1', tabs: { A: 'v1', B: 'v1' } },
      { workers: [], controllerchange: [], waiting: null, active: 'v1', tabs: { A: 'v1', B: 'v1' } },
      { workers: [ 'v2 installing', 'v2 installed' ], controllerchange: [], waiting: 'v2', active: 'v1', tabs: { A: 'v1', B: 'v1' } },
      { workers: [], controllerchange: [], waiting: 'v2', active: 'v1', tabs: { A: 'v1' } },
      { workers: [ 'v1 redundant', 'v2 activating', 'v2 activated' ], controllerchange: [], waiting: null, active: 'v2', tabs: {} },
      { workers: [], controllerchange: [], waiting: null, active: 'v2', tabs: { C: 'v2' } },
    ] as SwSnapshot[],
  },
  {
    id: 'uncontrolled',
    label: 'Вкладка без контроллера',
    note: 'A регистрировала воркер, и ею никто не управляет. Когда закрыли B, у v1 не осталось управляемых вкладок — v2 активировался, хотя A открыта.',
    steps: [
      { do: 'deploy', script: { v: 'v1' } },
      { do: 'open', tab: 'A' },
      { do: 'open', tab: 'B' },
      { do: 'deploy', script: { v: 'v2' } },
      { do: 'update' },
      { do: 'close', tab: 'B' },
    ] as SwStep[],
    chromium: [
      { workers: [], controllerchange: [], waiting: null, active: null, tabs: {} },
      { workers: [ 'v1 installing', 'v1 installed', 'v1 activating', 'v1 activated' ], controllerchange: [], waiting: null, active: 'v1', tabs: { A: null } },
      { workers: [], controllerchange: [], waiting: null, active: 'v1', tabs: { A: null, B: 'v1' } },
      { workers: [], controllerchange: [], waiting: null, active: 'v1', tabs: { A: null, B: 'v1' } },
      { workers: [ 'v2 installing', 'v2 installed' ], controllerchange: [], waiting: 'v2', active: 'v1', tabs: { A: null, B: 'v1' } },
      { workers: [ 'v1 redundant', 'v2 activating', 'v2 activated' ], controllerchange: [], waiting: null, active: 'v2', tabs: { A: null } },
    ] as SwSnapshot[],
  },
  {
    id: 'skip',
    label: 'skipWaiting по кнопке',
    note: 'Страница отправляет ждущему v2 сообщение `skip-waiting`, он зовёт `skipWaiting()`. Обе вкладки переходят к v2 сразу, в обеих срабатывает `controllerchange`, — без `clients.claim()`.',
    steps: [
      { do: 'deploy', script: { v: 'v1' } },
      { do: 'open', tab: 'A' },
      { do: 'reload', tab: 'A' },
      { do: 'open', tab: 'B' },
      { do: 'deploy', script: { v: 'v2' } },
      { do: 'update' },
      { do: 'skip' },
    ] as SwStep[],
    chromium: [
      { workers: [], controllerchange: [], waiting: null, active: null, tabs: {} },
      { workers: [ 'v1 installing', 'v1 installed', 'v1 activating', 'v1 activated' ], controllerchange: [], waiting: null, active: 'v1', tabs: { A: null } },
      { workers: [], controllerchange: [], waiting: null, active: 'v1', tabs: { A: 'v1' } },
      { workers: [], controllerchange: [], waiting: null, active: 'v1', tabs: { A: 'v1', B: 'v1' } },
      { workers: [], controllerchange: [], waiting: null, active: 'v1', tabs: { A: 'v1', B: 'v1' } },
      { workers: [ 'v2 installing', 'v2 installed' ], controllerchange: [], waiting: 'v2', active: 'v1', tabs: { A: 'v1', B: 'v1' } },
      { workers: [ 'v1 redundant', 'v2 activating', 'v2 activated' ], controllerchange: [ 'A', 'B' ], waiting: null, active: 'v2', tabs: { A: 'v2', B: 'v2' } },
    ] as SwSnapshot[],
  },
  {
    id: 'skipInstall',
    label: 'skipWaiting без claim',
    note: 'v2 зовёт `skipWaiting()` прямо в `install`, ожидания нет. B переходит к v2, а A, которой никто не управлял, так и остаётся без контроллера: забрать её может только `claim()`.',
    steps: [
      { do: 'deploy', script: { v: 'v1' } },
      { do: 'open', tab: 'A' },
      { do: 'open', tab: 'B' },
      { do: 'deploy', script: { v: 'v2', skipWaiting: true } },
      { do: 'update' },
    ] as SwStep[],
    chromium: [
      { workers: [], controllerchange: [], waiting: null, active: null, tabs: {} },
      { workers: [ 'v1 installing', 'v1 installed', 'v1 activating', 'v1 activated' ], controllerchange: [], waiting: null, active: 'v1', tabs: { A: null } },
      { workers: [], controllerchange: [], waiting: null, active: 'v1', tabs: { A: null, B: 'v1' } },
      { workers: [], controllerchange: [], waiting: null, active: 'v1', tabs: { A: null, B: 'v1' } },
      { workers: [ 'v2 installing', 'v2 installed', 'v1 redundant', 'v2 activating', 'v2 activated' ], controllerchange: [ 'B' ], waiting: null, active: 'v2', tabs: { A: null, B: 'v2' } },
    ] as SwSnapshot[],
  },
  {
    id: 'claim',
    label: 'claim с первого раза',
    note: '`clients.claim()` в `activate` забирает вкладку, которая регистрировала воркер: `controller` у A появляется без перезагрузки, и срабатывает `controllerchange`.',
    steps: [
      { do: 'deploy', script: { v: 'v1', claim: true } },
      { do: 'open', tab: 'A' },
      { do: 'open', tab: 'B' },
    ] as SwStep[],
    chromium: [
      { workers: [], controllerchange: [], waiting: null, active: null, tabs: {} },
      { workers: [ 'v1 installing', 'v1 installed', 'v1 activating', 'v1 activated' ], controllerchange: [ 'A' ], waiting: null, active: 'v1', tabs: { A: 'v1' } },
      { workers: [], controllerchange: [], waiting: null, active: 'v1', tabs: { A: 'v1', B: 'v1' } },
    ] as SwSnapshot[],
  },
  {
    id: 'both',
    label: 'skipWaiting + claim',
    note: 'Режим «обновлять сразу»: v2 ставится, вытесняет v1 и забирает вкладку. Сама страница не перезагружается и продолжает жить кодом v1.',
    steps: [
      { do: 'deploy', script: { v: 'v1' } },
      { do: 'open', tab: 'A' },
      { do: 'reload', tab: 'A' },
      { do: 'deploy', script: { v: 'v2', skipWaiting: true, claim: true } },
      { do: 'update' },
    ] as SwStep[],
    chromium: [
      { workers: [], controllerchange: [], waiting: null, active: null, tabs: {} },
      { workers: [ 'v1 installing', 'v1 installed', 'v1 activating', 'v1 activated' ], controllerchange: [], waiting: null, active: 'v1', tabs: { A: null } },
      { workers: [], controllerchange: [], waiting: null, active: 'v1', tabs: { A: 'v1' } },
      { workers: [], controllerchange: [], waiting: null, active: 'v1', tabs: { A: 'v1' } },
      { workers: [ 'v2 installing', 'v2 installed', 'v1 redundant', 'v2 activating', 'v2 activated' ], controllerchange: [ 'A' ], waiting: null, active: 'v2', tabs: { A: 'v2' } },
    ] as SwSnapshot[],
  },
  {
    id: 'fail',
    label: 'Установка упала',
    note: 'В `PRECACHE` версии v2 есть адрес с ответом 404. `cache.addAll` отклоняет промис, `waitUntil` проваливает установку: v2 сразу `redundant`, v1 работает как работал.',
    steps: [
      { do: 'deploy', script: { v: 'v1' } },
      { do: 'open', tab: 'A' },
      { do: 'reload', tab: 'A' },
      { do: 'deploy', script: { v: 'v2', missing: true } },
      { do: 'update' },
    ] as SwStep[],
    chromium: [
      { workers: [], controllerchange: [], waiting: null, active: null, tabs: {} },
      { workers: [ 'v1 installing', 'v1 installed', 'v1 activating', 'v1 activated' ], controllerchange: [], waiting: null, active: 'v1', tabs: { A: null } },
      { workers: [], controllerchange: [], waiting: null, active: 'v1', tabs: { A: 'v1' } },
      { workers: [], controllerchange: [], waiting: null, active: 'v1', tabs: { A: 'v1' } },
      { workers: [ 'v2 installing', 'v2 redundant' ], controllerchange: [], waiting: null, active: 'v1', tabs: { A: 'v1' } },
    ] as SwSnapshot[],
  },
  {
    id: 'same',
    label: 'Те же байты',
    note: 'На сервере тот же `sw.js`. `update()` скачал его, сравнил с установленным байт в байт и ничего не начал.',
    steps: [
      { do: 'deploy', script: { v: 'v1' } },
      { do: 'open', tab: 'A' },
      { do: 'reload', tab: 'A' },
      { do: 'deploy', script: { v: 'v1' } },
      { do: 'update' },
    ] as SwStep[],
    chromium: [
      { workers: [], controllerchange: [], waiting: null, active: null, tabs: {} },
      { workers: [ 'v1 installing', 'v1 installed', 'v1 activating', 'v1 activated' ], controllerchange: [], waiting: null, active: 'v1', tabs: { A: null } },
      { workers: [], controllerchange: [], waiting: null, active: 'v1', tabs: { A: 'v1' } },
      { workers: [], controllerchange: [], waiting: null, active: 'v1', tabs: { A: 'v1' } },
      { workers: [], controllerchange: [], waiting: null, active: 'v1', tabs: { A: 'v1' } },
    ] as SwSnapshot[],
  },
];

export const STRATEGY_CASES: StrategyCase[] = [
  {
    id: 'cacheFirst',
    label: 'cache-first',
    path: '/data/cf',
    note: 'Сначала кеш. Сеть — только при промахе.',
    chromium: [ { got: 'данные 1', hits: 1 }, { got: 'данные 1', hits: 0 }, { got: 'данные 1', hits: 0 }, { got: 'данные 1', hits: 0 }, { got: 'данные 1', hits: 0 }, { got: 'данные 1', hits: 0 }, { got: 'данные 1', hits: 0 } ],
  },
  {
    id: 'networkFirst',
    label: 'network-first',
    path: '/data/nf',
    note: 'Сначала сеть. Кеш — когда сеть упала.',
    chromium: [ { got: 'данные 1', hits: 1 }, { got: 'данные 1', hits: 1 }, { got: 'данные 2', hits: 1 }, { got: 'данные 2', hits: 1 }, { got: 'данные 2', hits: 0 }, { got: 'данные 3', hits: 1 }, { got: 'данные 3', hits: 1 } ],
  },
  {
    id: 'staleWhileRevalidate',
    label: 'stale-while-revalidate',
    path: '/data/swr',
    note: 'Кеш сразу, сеть — фоном, для следующего раза.',
    chromium: [ { got: 'данные 1', hits: 1 }, { got: 'данные 1', hits: 1 }, { got: 'данные 1', hits: 1 }, { got: 'данные 2', hits: 1 }, { got: 'данные 2', hits: 0 }, { got: 'данные 2', hits: 1 }, { got: 'данные 3', hits: 1 } ],
  },
];
