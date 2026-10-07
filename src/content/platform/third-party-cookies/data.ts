import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { CookieSpec, EngineId, MeasuredRow, Outcome, RequestSpec } from '@/widgets/tpc-cookie-verdict/model/verdict';

/**
 * Данные темы «Встроенный контент без сторонних кук: CHIPS, Storage Access API и разделённое
 * хранилище».
 *
 * Тема написана здесь. До неё предмет занимал строку «отдельная тема» в «за кадром»
 * «Безопасности фронтенда» и две фразы в её карточках про `SameSite=None`. Что такое кука,
 * `SameSite`, CSRF, где хранить токен — разобрано там и здесь не повторяется; источник и сайт —
 * в «Устройстве браузера»; разделение HTTP-кеша как защита от утечек — в «XS-Leaks».
 *
 * ── Стенд (сентябрь 2026) ────────────────────────────────────────────────────────────────
 * Свой `node:https` (самоподписанный сертификат) на портах 49617–49628, Node 26.8.2,
 * Playwright 1.63. Сайты `top.test`, `top2.test`, `embed.test`, `api.embed.test`,
 * `www.embed.test`: в Chromium — `--host-resolver-rules=MAP *.test 127.0.0.1` и доверие ключу
 * через `--ignore-certificate-errors-spki-list` (не `ignoreHTTPSErrors`); в Firefox —
 * `network.dns.localDomains`; в WebKit — свой CONNECT-прокси, который отправляет `*.test`
 * на 127.0.0.1. Два порта на `localhost` здесь не годятся: это разные источники, но **один
 * сайт**, и сторонней куки на таком стенде не бывает вовсе.
 *
 * Сервер пишет в журнал заголовок `Cookie` каждого запроса. Ни одного таймерного замера;
 * у отрицательных случаев с ожиданием (сообщение `BroadcastChannel`, ответ на
 * `requestStorageAccess`) — потолок ожидания, а не замер, и рядом положительный контроль.
 *
 * Движки и режимы — ровно столбцы таблиц темы:
 *   - **Chromium 153.0.8010.12**, настройки по умолчанию. ⚠️ Playwright запускает Chromium
 *     с `--disable-features=…ThirdPartyStoragePartitioning…` — с этой строкой разделения
 *     хранилища нет вовсе. Для столбца «как у пользователя» строка заменена своей, без этой фичи;
 *   - **Chromium 153, сторонние куки ограничены**: `Network.setCookieControls
 *     { enableThirdPartyCookieRestriction: true }` по протоколу отладки — тот же переключатель,
 *     что у DevTools. Флаг `--test-third-party-cookie-phaseout` и настройки профиля
 *     `profile.cookie_controls_mode` на этой сборке **ничего не изменили** (снято: кука
 *     продолжала уходить во фрейм), поэтому режим снят только так;
 *   - **Firefox 155.0** с `network.cookie.cookieBehavior = 5` (Total Cookie Protection)
 *     и `network.cookie.CHIPS.enabled = true`. ⚠️ Сборка Playwright по умолчанию ставит
 *     `cookieBehavior = 4` и `CHIPS.enabled = false` в своём `playwright.cfg`; прогон
 *     с её умолчаниями показал сторонние куки открытыми, а хранилище неразделённым.
 *     Что пятёрка — умолчание релизного Firefox, — по документации Mozilla (MDN,
 *     «State Partitioning»), а не замер: стенд не умеет снять это умолчание, потому что
 *     сборка Playwright его переопределяет;
 *   - **WebKit 26.6** — сборка Playwright под macOS, **не Safari**. Поведение Safari
 *     не снималось, и таблицы нигде его не называют.
 *
 * Скрипты стенда: `stand.mjs` (куки первой стороны, CHIPS под двумя сайтами, хранилище,
 * `BroadcastChannel`, Storage Access API), `probe-attrs.mjs` (`Secure`, `Partitioned`,
 * `Domain`, встраивание с того же сайта), `probe-gaps.mjs` (куки, поставленные из фрейма;
 * подресурс; переход), `probe-saa.mjs` (Storage Access API в свежем контексте на сценарий),
 * `probe-saa-code.mjs` (строка `SAA_CODE` этой темы, исполненная во фрейме).
 *
 * ── Что по документации, без запуска ─────────────────────────────────────────────────────
 * Related Website Sets и их статус, FedCM, поведение Safari, умолчания релизного Firefox,
 * режим инкогнито Chrome. Каждое такое место в тексте подписано.
 */

/* ──────────────────── Вводный раздел · словарь темы ──────────────────── */

export const GLOSSARY = [
  {
    k: 'сайт верхнего уровня',
    d: 'Сайт страницы в адресной строке. Для фрейма `embed.test` на странице `top.test` сайт верхнего уровня — `top.test`. От него зависит, какие куки и какое хранилище фрейм увидит.',
  },
  {
    k: 'сторонний контекст',
    d: 'Фрейм, картинка или `fetch`, чей сайт не совпадает с сайтом верхнего уровня. Кука в таком запросе — **сторонняя** (third-party). Та же кука на самом `embed.test` — своя, первой стороны (first-party).',
  },
  {
    k: 'раздел и ключ раздела',
    d: 'Разделённая (partitioned) кука или запись хранилища лежит не просто «у `embed.test`», а у пары «`embed.test` под `top.test`». Ключ раздела — сайт верхнего уровня: под `top2.test` у того же `embed.test` другой раздел, и в нём пусто.',
  },
  {
    k: 'CHIPS',
    d: 'Cookies Having Independent Partitioned State — атрибут `Partitioned` у куки. Кука с ним ложится в раздел сайта верхнего уровня, где её поставили, и только там уходит.',
  },
  {
    k: 'Storage Access API',
    d: '`document.hasStorageAccess()` и `document.requestStorageAccess()`: фрейм спрашивает доступ к своим **неразделённым** кукам. Ответ даёт браузер, часто после вопроса пользователю, и только в ответ на его жест.',
  },
  {
    k: 'жест пользователя',
    d: 'Transient activation — короткое окно после настоящего клика или нажатия клавиши. Его проверяет `requestStorageAccess()`: на стенде вызов сразу при загрузке фрейма отвергнут с `NotAllowedError` во всех трёх движках.',
  },
  {
    k: 'Total Cookie Protection',
    d: 'Режим Firefox, в котором **любая** кука из стороннего контекста ложится в раздел сайта верхнего уровня — с `Partitioned` или без. В WebKit неразделённая сторонняя кука не ставится и не уходит вовсе — по документации WebKit это часть ITP (Intelligent Tracking Prevention).',
  },
];

/* ──────────────────── Раздел 0 · перед началом ──────────────────── */

export const PREREQ_NOTE =
  'Что такое сторонний контекст, раздел и доступ к хранилищу, объясняется здесь с нуля. Известными считаются четыре вещи — у каждой есть свой разбор на сайте.';

export const PREREQ = [
  {
    t: '`SameSite`: какие куки уходят с чужого сайта',
    d: 'Три значения, умолчание `Lax` в Chromium и его отсутствие в Firefox. Здесь `SameSite` — первый фильтр: всё, что он отсёк, дальше не рассматривается.',
    href: '/platform/security/#s5',
    hrefLabel: '«Безопасность фронтенда», раздел «CSRF и кликджекинг»',
    tone: 'warn' as const,
  },
  {
    t: 'Источник и сайт',
    d: 'Почему `api.embed.test` и `www.embed.test` — один сайт, а `top.test` — другой. Куки, разделы и хранилище считают сайтами, а не источниками.',
    href: '/js/browser-architecture/#s1',
    hrefLabel: '«Устройство браузера», раздел «Site»',
    tone: 'info' as const,
  },
  {
    t: '`fetch` с куками на чужой адрес',
    d: '`credentials: "include"`, `Access-Control-Allow-Credentials` и отказ от `*` в `Allow-Origin`. Без этого ответ с кукой не прочитать, даже если кука ушла.',
    href: '/platform/security/#s2',
    hrefLabel: '«Безопасность фронтенда», раздел «CORS и preflight»',
    tone: 'info' as const,
  },
  {
    t: 'Куки сессии и токены на фронте',
    d: '`HttpOnly`, почему токен в `localStorage` хуже куки и как сессия переживает несколько вкладок. Здесь от этого зависит, чем заменить стороннюю куку.',
    href: '/platform/security/#s6',
    hrefLabel: '«Безопасность фронтенда», раздел «Куки и JWT для фронта»',
    tone: 'ok' as const,
  },
];

/* ──────────────────── На пальцах ──────────────────── */

export const PLAIN_THIRD_PARTY =
  'Виджет чата на сайте магазина — это окно другой компании, врезанное в стену магазина. Своя кука виджета — его пропуск. Раньше один пропуск открывал окно в стене любого магазина, и по нему было видно, в каких магазинах вы бывали. Теперь браузеры либо не пускают пропуск в чужие стены вовсе, либо выдают **отдельный пропуск на каждую стену**.';

export const PLAIN_PARTITION =
  'Камера хранения на вокзале: у каждого вокзала своя. Сдали сумку на вокзале `top.test` — забрать её можно только там. На вокзале `top2.test` ячейка с тем же номером пустая, хотя фирма камер одна и та же. Ключ раздела — название вокзала, а не фирмы.';

export const PLAIN_SAA =
  'Охранник на входе в чужое здание не пропустит ваш общий пропуск сам. Но можно **лично попросить**: подойти, показать пропуск, получить отметку. Просьба засчитывается, только если вы подошли сами, — записка, подброшенная охраннику (вызов без клика), не считается.';

/* ──────────────────── Раздел 1 · что такое сторонняя кука ──────────────────── */

export const SETUP_CHIPS = [
  { label: 'top.test — страница', tone: 'ink' as const },
  { label: 'iframe embed.test', tone: 'warn' as const },
  { label: 'запрос на embed.test', tone: 'ink' as const },
  { label: 'кука embed.test — сторонняя', tone: 'warn' as const },
];

export const SAME_SITE_NOTE =
  '⚠️ Сторонней кука бывает **только** в контексте чужого сайта. Фрейм `embed.test` на странице `www.embed.test` — тот же сайт: на стенде во всех трёх движках туда ушли все куки, включая `Strict`. Поэтому сторонний контекст нельзя проверить на одном сайте: учебный фрейм на любой странице этого курса — тот же сайт, и браузер читателя отдаст ему всё.';

export const STATE_NOTE =
  'Chromium 153 по умолчанию стороннюю куку отдаёт. Firefox с Total Cookie Protection и WebKit не отдают, и граница проходит не по `SameSite`: кука `SameSite=None; Secure`, поставленная самим `embed.test`, в чужой фрейм не ушла ни в одном из них. Режим «сторонние ограничены» в Chromium включается настройкой пользователя; по документации Chrome он же действует в инкогнито.';

/*
 * Одна кука, два фильтра, четыре браузера — добавлено проходом «трудные места подробно»:
 * лид раздела 1 и таблица `state` вводят два фильтра и четыре режима разом, а таблица из
 * семи строк не показывает, что из этого следует для одного виджета. Каждый исход ниже —
 * строка `VERDICT_MEASURED` группы `state` (снято на стенде, см. шапку): `none-iframe`,
 * `lax-iframe`, `none-navigation` и три строки «поставлена из фрейма». Код — иллюстрация.
 */
export const TWO_FILTERS_SCENE_CODE = `# (1) пользователь заходил на сам embed.test — кука первой стороны:
Set-Cookie: uid=42; SameSite=None; Secure

# (2) потом открыл top.test, где стоит фрейм embed.test, и фрейм поставил свою:
Set-Cookie: seen=top; SameSite=None; Secure

# (3) потом открыл top2.test — там тот же фрейм embed.test`;

export const TWO_FILTERS_SCENE_NOTE =
  '**Первый фильтр — `SameSite`.** Фрейм под `top.test` — запрос с чужого сайта. Будь у куки ' +
  '`uid` значение `Lax`, она не ушла бы во фрейм ни в одном из движков: её отсёк бы первый фильтр, ' +
  'и второй бы её уже не рассматривал. У `None` первый фильтр пройден — дальше решает второй, ' +
  'политика сторонних кук. **Что было бы без второго фильтра:** фрейм под `top.test` получает ' +
  '`uid=42`, ставит `seen=top`, а на шаге (3) фрейм под `top2.test` получает и `uid=42`, и `seen=top`. ' +
  'Сервер `embed.test` видит один и тот же `uid` на двух разных магазинах — то есть знает, что ' +
  'это один человек и где он бывал. Именно эту связь браузеры и режут, и режут по-разному.';

export const TWO_FILTERS_STEPS: { k: string; when: string; what: string; cost: string }[] = [
  {
    k: 'Chromium 153 по умолчанию',
    when: 'второго фильтра по умолчанию нет — сторонняя кука уходит, пока пользователь не запретил',
    what: '`uid=42` уходит во фрейм под обоими сайтами. `seen`, поставленная фреймом под `top.test`, сохраняется и уходит и под `top2.test`, и при переходе на сам `embed.test`. Картина «без второго фильтра» — один в один.',
    cost: 'ложным спокойствием разработчика: отлаженный в таком браузере виджет у части пользователей сломан. Проверять надо в режиме ограничения — тонкое место про Chromium по умолчанию.',
  },
  {
    k: 'Chromium, сторонние ограничены',
    when: 'неразделённая кука не уходит в чужой контекст и не ставится из него',
    what: '`uid=42` во фрейм не уходит ни под одним сайтом. `seen` браузер **отвергает** при установке — её нет нигде. Переход по ссылке на сам `embed.test` уносит `uid` как обычно: там кука своя.',
    cost: 'всем, что держалось на общей куке во фрейме: вход, состояние, история. Режим включается настройкой пользователя, а по документации Chrome — и в инкогнито.',
  },
  {
    k: 'Firefox 155 (Total Cookie Protection)',
    when: 'любая кука, поставленная из чужого контекста, молча ложится в раздел сайта верхнего уровня',
    what: '`uid=42` во фрейм не уходит. `seen` **сохраняется**, но в раздел `top.test`: под `top.test` фрейм её видит, под `top2.test` и на самом `embed.test` — нет.',
    cost: 'путаницей при отладке: во фрейме под одним сайтом всё выглядит правильно, и диагноз «кука не сохранилась» неверен — она сохранилась, но не там.',
  },
  {
    k: 'WebKit 26.6',
    when: 'неразделённая сторонняя кука не ставится и не уходит',
    what: '`uid=42` во фрейм не уходит, `seen` отвергнута при установке — как в Chromium с ограничением. Переход на сам `embed.test` уносит `uid`.',
    cost: 'тем же, что и ограниченный Chromium. Расходятся они в атрибутах: кука без `SameSite` и `None` без `Secure` — их разбирает раздел «Уйдёт ли кука».',
  },
];

export const PLAIN_TWO_FILTERS =
  'Продолжим с окном в чужой стене. Сначала пропуск смотрит сам владелец: `SameSite=Lax` — «в чужие стены не носить», и дальше разговора нет. Если владелец разрешил, решает хозяин стены — браузер. Chromium по умолчанию пропускает общий пропуск в любую стену. Ограниченный Chromium и WebKit не пускают его вовсе и не выдают новых пропусков в чужих стенах. Firefox новый пропуск выдаёт, но только на эту стену: в соседнем магазине он недействителен. Во всех четырёх случаях дверь с улицы — переход на сам `embed.test` — открывается общим пропуском как прежде.';

/* ──────────────────── Таблица, снятая на стенде: 27 случаев × 4 движка ──────────────────── */

const NONE: CookieSpec = { sameSite: 'None', secure: true, partitioned: false, domain: 'host', setIn: 'first-party' };
const IFRAME_TOP: RequestSpec = { top: 'top.test', target: 'embed.test', kind: 'iframe', storageAccess: false };
const all = (o: Outcome): Record<EngineId, Outcome> => ({ chromium: o, 'chromium-restricted': o, firefox: o, webkit: o });

export const VERDICT_MEASURED: MeasuredRow[] = [
  {
    id: 'none-iframe',
    group: 'state',
    cookieLabel: '`SameSite=None; Secure`, поставлена на `embed.test`',
    requestLabel: 'фрейм `embed.test` под `top.test`',
    cookie: NONE,
    request: IFRAME_TOP,
    got: { chromium: 'sent', 'chromium-restricted': 'blocked', firefox: 'blocked', webkit: 'blocked' },
    source: 'stand.mjs: iframe-doc, iframe-fetch',
  },
  {
    id: 'none-subresource',
    group: 'state',
    cookieLabel: '`SameSite=None; Secure`, поставлена на `embed.test`',
    requestLabel: '`<img>` и `fetch` со страницы `top.test`',
    cookie: NONE,
    request: { ...IFRAME_TOP, kind: 'subresource' },
    got: { chromium: 'sent', 'chromium-restricted': 'blocked', firefox: 'blocked', webkit: 'blocked' },
    source: 'stand.mjs: top-img, top-fetch',
  },
  {
    id: 'none-navigation',
    group: 'state',
    cookieLabel: '`SameSite=None; Secure`, поставлена на `embed.test`',
    requestLabel: 'переход по ссылке `top.test` → `embed.test`',
    cookie: NONE,
    request: { ...IFRAME_TOP, kind: 'navigation' },
    got: all('sent'),
    source: 'stand.mjs: top-nav',
  },
  {
    id: 'unset-iframe',
    group: 'state',
    cookieLabel: 'без `SameSite`, `Secure`, поставлена на `embed.test`',
    requestLabel: 'фрейм `embed.test` под `top.test`',
    cookie: { ...NONE, sameSite: 'unset' },
    request: IFRAME_TOP,
    got: all('blocked'),
    source: 'stand.mjs: iframe-doc',
  },
  {
    id: 'lax-iframe',
    group: 'state',
    cookieLabel: '`SameSite=Lax; Secure`, поставлена на `embed.test`',
    requestLabel: 'фрейм `embed.test` под `top.test`',
    cookie: { ...NONE, sameSite: 'Lax' },
    request: IFRAME_TOP,
    got: all('blocked'),
    source: 'stand.mjs: iframe-doc',
  },
  {
    id: 'lax-navigation',
    group: 'state',
    cookieLabel: '`SameSite=Lax; Secure`, поставлена на `embed.test`',
    requestLabel: 'переход по ссылке `top.test` → `embed.test`',
    cookie: { ...NONE, sameSite: 'Lax' },
    request: { ...IFRAME_TOP, kind: 'navigation' },
    got: all('sent'),
    source: 'stand.mjs: top-nav',
  },
  {
    id: 'strict-navigation',
    group: 'state',
    cookieLabel: '`SameSite=Strict; Secure`, поставлена на `embed.test`',
    requestLabel: 'переход по ссылке `top.test` → `embed.test`',
    cookie: { ...NONE, sameSite: 'Strict' },
    request: { ...IFRAME_TOP, kind: 'navigation' },
    got: all('blocked'),
    source: 'stand.mjs: top-nav',
  },
  {
    id: 'strict-same-site-frame',
    group: 'state',
    cookieLabel: '`SameSite=Strict; Secure`, поставлена на `embed.test`',
    requestLabel: 'фрейм `embed.test` под `www.embed.test` — тот же сайт',
    cookie: { ...NONE, sameSite: 'Strict' },
    request: { ...IFRAME_TOP, top: 'www.embed.test' },
    got: all('sent'),
    source: 'probe-attrs.mjs: samesite-embed-doc',
  },
  {
    id: 'u3p-iframe',
    group: 'state',
    cookieLabel: '`SameSite=None; Secure`, поставлена **из фрейма** под `top.test`',
    requestLabel: 'фрейм `embed.test` под `top.test`',
    cookie: { ...NONE, setIn: 'top.test' },
    request: IFRAME_TOP,
    got: { chromium: 'sent', 'chromium-restricted': 'rejected', firefox: 'sent', webkit: 'rejected' },
    source: 'stand.mjs: chips-read-top; probe-gaps.mjs: r-doc',
  },
  {
    id: 'u3p-other-top',
    group: 'state',
    cookieLabel: '`SameSite=None; Secure`, поставлена **из фрейма** под `top.test`',
    requestLabel: 'фрейм `embed.test` под `top2.test`',
    cookie: { ...NONE, setIn: 'top.test' },
    request: { ...IFRAME_TOP, top: 'top2.test' },
    got: { chromium: 'sent', 'chromium-restricted': 'rejected', firefox: 'blocked', webkit: 'rejected' },
    source: 'stand.mjs: chips-read-top2 (под top2.test виден u3p=top2 только в Firefox)',
  },
  {
    id: 'u3p-first-party',
    group: 'state',
    cookieLabel: '`SameSite=None; Secure`, поставлена **из фрейма** под `top.test`',
    requestLabel: 'переход по ссылке `top.test` → `embed.test`',
    cookie: { ...NONE, setIn: 'top.test' },
    request: { ...IFRAME_TOP, kind: 'navigation' },
    got: { chromium: 'sent', 'chromium-restricted': 'rejected', firefox: 'blocked', webkit: 'rejected' },
    source: 'probe-gaps.mjs: nav',
  },
  {
    id: 'chip-same-top',
    group: 'chips',
    cookieLabel: '`Partitioned`, поставлена из фрейма под `top.test`',
    requestLabel: 'фрейм `embed.test` под `top.test`',
    cookie: { ...NONE, partitioned: true, setIn: 'top.test' },
    request: IFRAME_TOP,
    got: all('sent'),
    source: 'stand.mjs: chips-read-top',
  },
  {
    id: 'chip-other-top',
    group: 'chips',
    cookieLabel: '`Partitioned`, поставлена из фрейма под `top.test`',
    requestLabel: 'фрейм `embed.test` под `top2.test`',
    cookie: { ...NONE, partitioned: true, setIn: 'top.test' },
    request: { ...IFRAME_TOP, top: 'top2.test' },
    got: all('blocked'),
    source: 'stand.mjs: chips-read-top2',
  },
  {
    id: 'chip-subresource',
    group: 'chips',
    cookieLabel: '`Partitioned`, поставлена из фрейма под `top.test`',
    requestLabel: '`<img>` со страницы `top.test`',
    cookie: { ...NONE, partitioned: true, setIn: 'top.test' },
    request: { ...IFRAME_TOP, kind: 'subresource' },
    got: all('sent'),
    source: 'probe-gaps.mjs: img',
  },
  {
    id: 'chip-navigation',
    group: 'chips',
    cookieLabel: '`Partitioned`, поставлена из фрейма под `top.test`',
    requestLabel: 'переход по ссылке `top.test` → `embed.test`',
    cookie: { ...NONE, partitioned: true, setIn: 'top.test' },
    request: { ...IFRAME_TOP, kind: 'navigation' },
    got: all('blocked'),
    source: 'probe-gaps.mjs: nav',
  },
  {
    id: 'pfirst-iframe',
    group: 'chips',
    cookieLabel: '`Partitioned`, поставлена на самом `embed.test`',
    requestLabel: 'фрейм `embed.test` под `top.test`',
    cookie: { ...NONE, partitioned: true },
    request: IFRAME_TOP,
    got: all('blocked'),
    source: 'probe-attrs.mjs: cross-embed-doc',
  },
  {
    id: 'pfirst-navigation',
    group: 'chips',
    cookieLabel: '`Partitioned`, поставлена на самом `embed.test`',
    requestLabel: 'переход по ссылке `top.test` → `embed.test`',
    cookie: { ...NONE, partitioned: true },
    request: { ...IFRAME_TOP, kind: 'navigation' },
    got: all('sent'),
    source: 'probe-gaps.mjs: nav',
  },
  {
    id: 'pfirst-same-site-frame',
    group: 'chips',
    cookieLabel: '`Partitioned`, поставлена на самом `embed.test`',
    requestLabel: 'фрейм `embed.test` под `www.embed.test` — тот же сайт',
    cookie: { ...NONE, partitioned: true },
    request: { ...IFRAME_TOP, top: 'www.embed.test' },
    got: all('sent'),
    source: 'probe-attrs.mjs: samesite-embed-doc',
  },
  {
    id: 'lax-from-frame',
    group: 'attrs',
    cookieLabel: '`SameSite=Lax; Secure`, поставлена из фрейма под `top.test`',
    requestLabel: 'фрейм `embed.test` под `top.test`',
    cookie: { ...NONE, sameSite: 'Lax', setIn: 'top.test' },
    request: IFRAME_TOP,
    got: all('rejected'),
    source: 'probe-gaps.mjs: l3p',
  },
  {
    id: 'unset-from-frame',
    group: 'attrs',
    cookieLabel: 'без `SameSite`, `Secure`, поставлена из фрейма под `top.test`',
    requestLabel: 'фрейм `embed.test` под `top.test`',
    cookie: { ...NONE, sameSite: 'unset', setIn: 'top.test' },
    request: IFRAME_TOP,
    got: { chromium: 'rejected', 'chromium-restricted': 'rejected', firefox: 'sent', webkit: 'rejected' },
    source: 'probe-gaps.mjs: d3p',
  },
  {
    id: 'unset-partitioned-from-frame',
    group: 'attrs',
    cookieLabel: 'без `SameSite`, `Secure; Partitioned`, из фрейма под `top.test`',
    requestLabel: 'фрейм `embed.test` под `top.test`',
    cookie: { ...NONE, sameSite: 'unset', partitioned: true, setIn: 'top.test' },
    request: IFRAME_TOP,
    got: { chromium: 'rejected', 'chromium-restricted': 'rejected', firefox: 'sent', webkit: 'sent' },
    source: 'probe-gaps.mjs: pd3p',
  },
  {
    id: 'none-no-secure',
    group: 'attrs',
    cookieLabel: '`SameSite=None` без `Secure`, поставлена на `embed.test`',
    requestLabel: 'переход по ссылке `top.test` → `embed.test`',
    cookie: { ...NONE, secure: false },
    request: { ...IFRAME_TOP, kind: 'navigation' },
    got: { chromium: 'rejected', 'chromium-restricted': 'rejected', firefox: 'rejected', webkit: 'sent' },
    source: 'probe-attrs.mjs: stored (nosec); probe-gaps.mjs: nav',
  },
  {
    id: 'partitioned-no-secure',
    group: 'attrs',
    cookieLabel: '`SameSite=None; Partitioned` без `Secure`',
    requestLabel: 'переход по ссылке `top.test` → `embed.test`',
    cookie: { ...NONE, secure: false, partitioned: true },
    request: { ...IFRAME_TOP, kind: 'navigation' },
    got: all('rejected'),
    source: 'probe-attrs.mjs: stored (pnosec)',
  },
  {
    id: 'domain-api',
    group: 'attrs',
    cookieLabel: '`Domain=embed.test; SameSite=None; Secure`',
    requestLabel: 'фрейм `api.embed.test` под `top.test`',
    cookie: { ...NONE, domain: 'site' },
    request: { ...IFRAME_TOP, target: 'api.embed.test' },
    got: { chromium: 'sent', 'chromium-restricted': 'blocked', firefox: 'blocked', webkit: 'blocked' },
    source: 'probe-attrs.mjs: cross-api-doc',
  },
  {
    id: 'host-api',
    group: 'attrs',
    cookieLabel: 'без `Domain`, `SameSite=None; Secure`',
    requestLabel: 'фрейм `api.embed.test` под `top.test`',
    cookie: NONE,
    request: { ...IFRAME_TOP, target: 'api.embed.test' },
    got: all('blocked'),
    source: 'probe-attrs.mjs: cross-api-doc',
  },
  {
    id: 'none-storage-access',
    group: 'saa',
    cookieLabel: '`SameSite=None; Secure`, поставлена на `embed.test`',
    requestLabel: '`fetch` фрейма под `top.test` после `requestStorageAccess()`',
    cookie: NONE,
    request: { ...IFRAME_TOP, storageAccess: true },
    got: all('sent'),
    source: 'probe-saa.mjs: afterFetch; stand.mjs: saa-fetch',
  },
  {
    id: 'unset-storage-access',
    group: 'saa',
    cookieLabel: 'без `SameSite`, `Secure`, поставлена на `embed.test`',
    requestLabel: '`fetch` фрейма под `top.test` после `requestStorageAccess()`',
    cookie: { ...NONE, sameSite: 'unset' },
    request: { ...IFRAME_TOP, storageAccess: true },
    got: { chromium: 'blocked', 'chromium-restricted': 'blocked', firefox: 'sent', webkit: 'sent' },
    source: 'stand.mjs: saa-fetch (def=1)',
  },
];

export const OUTCOME_LABEL: Record<Outcome, string> = {
  sent: 'уходит',
  blocked: 'не уходит',
  rejected: 'не сохранена',
};

export const ENGINE_HEAD = ['Chromium 153', 'Chromium, сторонние ограничены', 'Firefox 155 (TCP)', 'WebKit 26.6'];

export const MEASURED_HEAD = ['кука', 'запрос', ...ENGINE_HEAD];

export const MEASURED_COLS =
  'minmax(210px,1.5fr) minmax(190px,1.3fr) minmax(90px,.6fr) minmax(110px,.7fr) minmax(100px,.65fr) minmax(90px,.6fr)';

/** Строки таблицы стенда для одного раздела темы: кука, запрос и четыре ответа. */
export function measuredRows(group: MeasuredRow['group']): string[][] {
  return VERDICT_MEASURED.filter((r) => r.group === group).map((r) => [
    r.cookieLabel,
    r.requestLabel,
    OUTCOME_LABEL[r.got.chromium],
    OUTCOME_LABEL[r.got['chromium-restricted']],
    OUTCOME_LABEL[r.got.firefox],
    OUTCOME_LABEL[r.got.webkit],
  ]);
}

export const MEASURED_NOTE =
  '«Не сохранена» — браузер отверг куку при установке, и в `document.cookie` первой стороны её нет. «Не уходит» — кука лежит в хранилище браузера, но в этот запрос не попала. Разница важна для отладки: в первом случае смотреть надо ответ с `Set-Cookie`, во втором — контекст запроса.';

/* ──────────────────── Раздел 2 · CHIPS ──────────────────── */

export const CHIPS_CODE = `// Ответ embed.test внутри фрейма на странице top.test:
Set-Cookie: chat_session=abc; Secure; SameSite=None; Partitioned; Path=/

// Или из скрипта того же фрейма — атрибут тот же:
document.cookie = 'chat_draft=1; Secure; SameSite=None; Partitioned; Path=/';`;

/**
 * Одна и та же пара имён — `chip` (заголовком) и `jschip` (из `document.cookie`) — поставлена
 * фреймом `embed.test` сначала под `top.test` со значением `top`, потом под `top2.test`
 * со значением `top2`. Затем каждый фрейм загружен заново и прочитан.
 */
export const CHIPS_READBACK: { k: string; top: string; top2: string; first: string }[] = [
  { k: 'Chromium 153', top: '`chip=top; jschip=top`', top2: '`chip=top2; jschip=top2`', first: 'нет ни одной' },
  { k: 'Chromium, сторонние ограничены', top: '`chip=top; jschip=top`', top2: '`chip=top2; jschip=top2`', first: 'нет ни одной' },
  { k: 'Firefox 155 (TCP)', top: '`chip=top; jschip=top`', top2: '`chip=top2; jschip=top2`', first: 'нет ни одной' },
  { k: 'WebKit 26.6', top: '`chip=top; jschip=top`', top2: '`chip=top2; jschip=top2`', first: 'нет ни одной' },
];

export const CHIPS_PARTITION_KEYS =
  'Все четыре строки одинаковы: у одного `embed.test` теперь **две** куки с одним именем `chip` — одна под ключом `https://top.test`, другая под `https://top2.test`. Фрейм под каждым сайтом видит только свою, а сам `embed.test` без фрейма — ни одной: его собственный раздел пуст.';

export const CHIPS_FACTS: { t: string; d: string; tone?: 'ok' | 'warn' | 'err' | 'info' }[] = [
  {
    t: 'Ключ — сайт, а не источник',
    d: 'Раздел `https://top.test` один на `top.test`, `shop.top.test` и `blog.top.test`: ключ считается по регистрируемому домену. Снято во всех трёх движках: кука, поставленная фреймом под `shop.top.test`, ушла во фрейм под `blog.top.test` и не ушла под `top2.test`.',
    tone: 'info',
  },
  {
    t: 'Раздел касается и подресурсов',
    d: '`<img>` со страницы `top.test` на `embed.test` унёс разделённую куку раздела `top.test` во всех трёх движках. Раздел — свойство запроса «под этим верхним уровнем», а не только фрейма.',
    tone: 'ok',
  },
  {
    t: 'На своём сайте разделённая кука — чужая',
    d: 'Переход по ссылке на сам `embed.test` куку раздела `top.test` не унёс нигде: наверху теперь `embed.test`, и раздел у него свой. Сессию, начатую во фрейме, первая сторона не видит — и это задумано.',
    tone: 'warn',
  },
  {
    t: '`Partitioned` без `Secure` отвергается',
    d: 'Во всех трёх движках — даже на https-странице. `SameSite=None` рядом с `Partitioned` формально не обязателен, но без него Chromium считает куку `Lax`, а `Lax` из стороннего фрейма не принимается вовсе — это видно в таблице атрибутов раздела «Уйдёт ли кука».',
    tone: 'err',
  },
];

/* ──────────────────── Раздел 3 · демо: уйдёт ли кука ──────────────────── */

export const VERDICT_NOTE =
  'Задайте признаки куки и запроса — калькулятор ответит за каждый движок и режим. Правила у него те же, по которым собрана таблица из 27 проверенных случаев, и с ней он совпадает в каждой клетке.';

/* ──────────────────── Раздел 4 · разделённое хранилище ──────────────────── */

/**
 * Фрейм `embed.test` под `top.test` пишет строку `written-under-top` в `localStorage`,
 * IndexedDB и Cache Storage. Потом читают: фрейм под `top2.test`, сам `embed.test` верхним
 * уровнем и — контроль — снова фрейм под `top.test`. `BroadcastChannel('tpc')`: отправитель —
 * фрейм под `top.test`; слушатели — второй фрейм под `top.test` (контроль), фрейм под
 * `top2.test` и `embed.test` верхним уровнем; потолок ожидания 0.8 с после того, как контроль
 * сообщение получил.
 */
export const STORAGE_ROWS: {
  k: string;
  chromium: string;
  firefox: string;
  webkit: string;
  control: string;
  tone: 'ok' | 'warn';
}[] = [
  {
    k: '`localStorage`',
    chromium: 'разделено',
    firefox: 'разделено',
    webkit: '**общее**: фрейм под `top2.test` и сам `embed.test` прочли запись',
    control: 'везде прочитано',
    tone: 'warn',
  },
  {
    k: 'IndexedDB',
    chromium: 'разделено',
    firefox: 'разделено',
    webkit: 'разделено',
    control: 'везде прочитано',
    tone: 'ok',
  },
  {
    k: 'Cache Storage',
    chromium: 'разделено',
    firefox: 'разделено',
    webkit: 'не наблюдаемо: запись видна в том же фрейме и пропадает после его перезагрузки',
    control: 'Chromium и Firefox — прочитано, WebKit — пусто',
    tone: 'warn',
  },
  {
    k: '`BroadcastChannel`',
    chromium: 'разделён',
    firefox: 'разделён',
    webkit: 'разделён',
    control: 'сообщение пришло во всех трёх',
    tone: 'ok',
  },
];

export const STORAGE_NOTE =
  'Разделение хранилища в Chromium от режима кук не зависит: и с разрешёнными, и с ограниченными сторонними куками результат один. Это два разных механизма. Ограничение кук не даёт узнать человека по куке, а разделение хранилища не даёт пронести ту же метку через `localStorage` фрейма.';

export const PLAYWRIGHT_NOTE =
  '⚠️ **Автотест по умолчанию этого не увидит.** С настройками Playwright по умолчанию оба движка показывают общее хранилище и стороннюю куку во фрейме — веб пятилетней давности. Какие две настройки вернуть, чтобы тест виджета что-то доказывал, — в «Тонких местах», пункт 01.';

export const STORAGE_FACTS: { t: string; d: string; tone?: 'ok' | 'warn' | 'err' | 'info' }[] = [
  {
    t: 'Разделено всё, что может связать два сайта',
    d: '`localStorage`, IndexedDB, Cache Storage, `BroadcastChannel`, а по документации Chrome ещё Service Worker, `SharedWorker` и Web Locks. Под `top2.test` у фрейма пустое хранилище, как в первый раз.',
    tone: 'info',
  },
  {
    t: 'Сам виджет обмениваться может',
    d: 'Два фрейма `embed.test` на одной странице `top.test` — в одном разделе: контрольный `BroadcastChannel` на стенде дошёл. Синхронизировать вкладки одного магазина виджет может; узнать, что тот же человек открыт на другом сайте, — нет.',
    tone: 'ok',
  },
  {
    t: 'Доступ к хранилищу — отдельный вызов',
    d: 'Разрешение Storage Access API открывает **куки**. Неразделённое хранилище по спецификации открывается вызовом `requestStorageAccess({ all: true })` или с перечислением типов; стенд проверял только куки.',
    tone: 'warn',
  },
];

/* ──────────────────── Раздел 5 · Storage Access API ──────────────────── */

/**
 * Код, который тема показывает, — **та же строка**, что исполнял стенд: `probe-saa-code.mjs`
 * читает `SAA_CODE` из этого файла и вставляет его во фрейм `embed.test` под `top.test`.
 * Кнопку нажимал Playwright настоящим кликом; `status` показывал ответ сервера `/me` —
 * заголовок `Cookie`, с которым пришёл запрос.
 */
export const SAA_CODE = `const button = document.querySelector('#open-chat');
const status = document.querySelector('#status');

async function loadMe() {
  const res = await fetch('/me', { credentials: 'include' });
  status.textContent = await res.text();
}

// При загрузке: доступ уже есть — кнопка не нужна.
document.hasStorageAccess().then((has) => {
  if (has) loadMe();
});

button.addEventListener('click', () => {
  // Первой строкой обработчика: await до этого вызова WebKit считает потерей жеста.
  document.requestStorageAccess().then(loadMe, () => {
    status.textContent = 'нужен вход во всплывающем окне';
  });
});`;

/** Что показал `status` после клика по кнопке — `probe-saa-code.mjs`. */
export const SAA_CODE_RUN: { k: string; status: string; tone: 'ok' | 'err' | 'warn' }[] = [
  { k: 'Chromium 153, сторонние ограничены', status: '`нужен вход во всплывающем окне`', tone: 'err' },
  { k: 'Chromium 153, сторонние ограничены, разрешение `storage-access` выдано заранее', status: '`none=1`', tone: 'ok' },
  { k: 'Firefox 155 (TCP), до этого был клик на самом `embed.test`', status: '`def=1; none=1`', tone: 'ok' },
  { k: 'Firefox 155 (TCP), на самом `embed.test` не кликали', status: 'пусто за 3 с: вопрос показан, ответа нет', tone: 'warn' },
  { k: 'WebKit 26.6', status: '`def=1; none=1`', tone: 'ok' },
];

export const SAA_ROWS: { k: string; chromium: string; firefox: string; webkit: string }[] = [
  {
    k: '`hasStorageAccess()` до вызова',
    chromium: '`true` при разрешённых сторонних куках, `false` при ограниченных',
    firefox: '`false`',
    webkit: '`false`',
  },
  {
    k: '`requestStorageAccess()` при загрузке, без жеста',
    chromium: '`NotAllowedError`',
    firefox: '`NotAllowedError`',
    webkit: '`NotAllowedError`',
  },
  {
    k: 'то же из обработчика клика',
    chromium: '`NotAllowedError` — в headless вопрос пользователю не показывается',
    firefox: 'не решился за 3 с (вопрос показан, отвечать некому); после клика на самом `embed.test` — выполнен',
    webkit: 'выполнен',
  },
  {
    k: 'разрешение `storage-access` выдано заранее',
    chromium: 'выполнен **и без жеста**; до вызова куки не уходили — `hasStorageAccess()` был `false`',
    firefox: '—',
    webkit: '—',
  },
  {
    k: '`requestStorageAccessFor` на верхнем уровне',
    chromium: 'есть; с жестом — `NotAllowedError` (набора нет)',
    firefox: 'нет (`undefined`)',
    webkit: 'нет (`undefined`)',
  },
];

export const SAA_NOTE =
  'Разрешение не действует само: даже выданное заранее, оно не прикладывает куки, пока документ фрейма не вызвал `requestStorageAccess()`. На стенде Chromium с выданным разрешением загрузил фрейм без кук, `hasStorageAccess()` вернул `false`, и только после вызова `fetch` фрейма унёс `none=1`.';

/*
 * Жизнь фрейма от загрузки до куки — добавлено проходом «трудные места подробно»:
 * `SAA_CODE`, две таблицы и `SAA_NOTE` описывают одно и то же время жизни фрейма кусками,
 * и порядок «загрузка → отказ без жеста → клик → решение браузера → куки → новая загрузка»
 * нигде не собран. Каждый шаг — из `SAA_ROWS`, `SAA_CODE_RUN`, `SAA_NOTE`, `SAA_RULES`
 * и тонких мест 05 и 08 этой темы.
 */
export const SAA_TIMELINE: string[] = [
  '**Фрейм чата загрузился под `top.test`.** Неразделённые куки `embed.test` в запрос документа не ушли — в Firefox, WebKit и ограниченном Chromium (Chromium по умолчанию их отдаёт, и там `hasStorageAccess()` сразу `true`). В остальных `hasStorageAccess()` отвечает `false`; код из примера поэтому ничего не загружает и ждёт кнопку.',
  '**Попытка попросить доступ сразу, без клика**, кончается `NotAllowedError` во всех трёх движках. Это не ошибка кода, а условие API: без жеста пользователя браузер просьбу не рассматривает.',
  '**Пользователь нажал «Открыть чат».** Обработчик первой же строкой зовёт `requestStorageAccess()`. Именно первой: `await` перед вызовом WebKit считает потерей жеста.',
  '**Решает браузер, и по-разному.** WebKit на стенде выдал доступ. Firefox выдал без вопроса, если пользователь раньше кликал на самом `embed.test`, и показал вопрос, если нет. Chromium в режиме без окна (headless) отказал; по документации в обычном окне он показывает вопрос. На отказ у кода есть запасной путь — всплывающее окно входа.',
  '**Доступ выдан — и только теперь `fetch` фрейма уносит неразделённые куки.** Выдан он для пары «`embed.test` под `top.test`»; под `top2.test` спрашивать заново. `SameSite` продолжает действовать: в Chromium кука без атрибута, то есть `Lax`, не ушла и после доступа.',
  '**Фрейм загрузили снова.** Разрешение запомнено, но само куки не прикладывает: документ фрейма обязан вызвать `requestStorageAccess()` ещё раз. Теперь вызов проходит без вопроса и без жеста — поэтому проверку делают при каждой загрузке.',
];

export const PLAIN_SAA_TIMELINE =
  'Продолжим с охранником. Отметка, полученная вчера, лежит у него в журнале, но дверь сама не откроется: сегодня тоже надо подойти и назваться — только теперь без объяснений, он просто сверится с журналом. И отметка действует у этого входа этого здания: у соседнего входа (другой сайт верхнего уровня) журнал свой.';

export const SAA_RULES: { t: string; d: string; tone?: 'ok' | 'warn' | 'err' | 'info' }[] = [
  {
    t: 'Вызов — только из жеста',
    d: 'Во всех трёх движках вызов при загрузке фрейма отвергнут с `NotAllowedError`. Кнопка «Войти», «Открыть чат» — не украшение, а условие API.',
    tone: 'err',
  },
  {
    t: 'Браузер решает сам, и по-разному',
    d: 'Firefox выдал доступ без вопроса, когда на самом `embed.test` до этого кликали, и повис на вопросе, когда не кликали. Chromium в headless отказал, а в обычном окне, по документации, показывает вопрос; по документации Chrome требует, чтобы пользователь раньше бывал на встроенном сайте как на первой стороне. Код обязан пережить отказ.',
    tone: 'warn',
  },
  {
    t: 'Доступ — к неразделённым кукам, и не ко всем',
    d: 'По спецификации разрешение привязано к паре «встроенный сайт под верхним сайтом»: `embed.test` под `top.test`, под `top2.test` спрашивать заново. И `SameSite` никуда не девается: в Chromium кука без `SameSite` (`Lax`) не ушла и после доступа, а в Firefox и WebKit ушла — там умолчание `None`.',
    tone: 'info',
  },
];

export const RWS_NOTE =
  '**Related Website Sets** (раньше First-Party Sets) — объявленный владельцем список своих сайтов разных доменов (`brand.com`, `brand-cdn.net`, `brand.ru`), внутри которого Chrome выдавал доступ к кукам без вопроса или по `requestStorageAccessFor` с верхнего уровня. Работало только в Chrome; Firefox и WebKit механизм отвергли. По объявлению Privacy Sandbox (октябрь 2025) Chrome выводит Related Website Sets и `requestStorageAccessFor` из употребления — это по документации, стенд не проверял. Снято одно: в Chromium 153 метод ещё есть и без набора отвечает `NotAllowedError`. Строить на нём новое не стоит.';

/* ──────────────────── Раздел 6 · встраиваемый виджет без сторонних кук ──────────────────── */

export const PLAIN_HANDOFF =
  'Своего общего пропуска у чата больше нет — зато магазин знает вас в лицо. Сервер магазина звонит в службу чата и получает на вас одноразовый бейдж, а страница передаёт его в окно чата из рук в руки (`postMessage`). Чату не нужно помнить вас между магазинами: за вас поручился тот, у кого вы сейчас в гостях.';

export const WIDGET_CASES: { t: string; d: string; tone?: 'ok' | 'warn' | 'err' | 'info' }[] = [
  {
    t: 'Чат поддержки',
    d: 'Черновик, открытое окно, история анонимного разговора — `Partitioned`-кука или разделённое хранилище: они и должны жить отдельно на каждом сайте. Если нужен вход — сессия приходит **от сайта-хозяина**: его сервер выдаёт виджету короткий токен, страница передаёт его во фрейм через `postMessage`.',
    tone: 'ok',
  },
  {
    t: 'Платёжная форма',
    d: 'Форме не нужна кука пользователя — ей нужна **сессия платежа**, созданная сервером магазина у платёжного сервиса. Идентификатор сессии идёт в адрес фрейма или через `postMessage`; куки, если они есть, — `Partitioned`. Сохранённые карты «с прошлого раза на другом сайте» — это ровно та связь сайтов, которую браузеры отрезают; для неё — вход по кнопке и Storage Access API.',
    tone: 'info',
  },
  {
    t: 'Вход через другой сайт (SSO)',
    d: 'Скрытый фрейм `idp.example` «проверить, вошёл ли пользователь» — главная жертва: без сторонних кук он всегда видит гостя. Работают переход верхнего уровня на провайдера и обратно (обычный OAuth-редирект — там кука первой стороны), всплывающее окно и FedCM. Молчаливое обновление токена через фрейм перестаёт работать — refresh-токен нужен на сервере сайта-хозяина.',
    tone: 'warn',
  },
];

export const POSTMESSAGE_CODE = `// Страница top.test: сервер сайта выдал короткий токен для виджета
const frame = document.querySelector('iframe[src^="https://embed.test/"]');
frame.addEventListener('load', () => {
  frame.contentWindow.postMessage({ type: 'auth', token }, 'https://embed.test');
});

// Фрейм embed.test
window.addEventListener('message', (event) => {
  if (!ALLOWED_PARENTS.has(event.origin)) return; // список сайтов-клиентов
  if (event.data?.type !== 'auth') return;
  session = event.data.token; // в памяти или в Partitioned-куке, не в общей
});`;

export const POSTMESSAGE_NOTES: string[] = [
  '**Второй аргумент `postMessage` — всегда точный источник фрейма**, не `*`: иначе токен получит тот, кто успел подменить фрейм переходом.',
  '**Проверка `event.origin` во фрейме — по списку клиентов**, а не «любой, кто прислал сообщение». Этот список — то же, что `frame-ancestors` в заголовке ответа фрейма, только для сообщений.',
  '**Токен — короткий и узкий**: выдан на один виджет и одну сессию хозяина. Долгоживущий токен, переданный в чужой по происхождению код, становится той самой сторонней кукой, только без защиты `HttpOnly`.',
];

export const FEDCM_NOTE =
  '**FedCM** (Federated Credential Management) — вход через сервис входа (провайдера личности: «Войти через Google» и подобные), который проводит сам браузер: `navigator.credentials.get({ identity: { providers: [...] } })` показывает системный диалог «Войти как …», а браузер сам ходит к провайдеру с его куками первой стороны и отдаёт сайту токен. Сторонних кук провайдеру не нужно, и сайт не узнаёт, где ещё вы входили. На стенде `typeof IdentityCredential` — `function` в Chromium 153 и `undefined` в Firefox 155 и WebKit 26.6: сам вход через FedCM не снимался, снято только наличие API. Для библиотек входа это путь по умолчанию в Chromium, но запасной вариант с редиректом нужен всё равно.';

export const TAKEAWAY =
  'Порядок выбора для встраиваемого кода: **1)** нужна ли вообще связь между сайтами — если нет, `Partitioned` и разделённое хранилище решают всё; **2)** можно ли получить сессию от сайта-хозяина через сервер и `postMessage` — это работает везде; **3)** если нужен именно ваш общий вход — Storage Access API по кнопке с запасным всплывающим окном; **4)** для входа через провайдера — FedCM или редирект.';

/* ──────────────────── Раздел 7 · тонкие места ──────────────────── */

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'Тест в Playwright видит веб без ограничений',
    d: 'Chromium в Playwright запущен с выключенным разделением хранилища, Firefox — с `cookieBehavior = 4` и выключенным CHIPS. На стенде оба отдали стороннюю куку во фрейм и поделили `localStorage` между сайтами. Прежде чем верить зелёному прогону встраиваемого виджета, верните обе настройки — иначе проверено поведение, которого у пользователей нет.',
    tone: 'err',
  },
  {
    n: '02',
    t: 'Стенд на двух портах localhost не показывает ничего',
    d: '`localhost:3000` и `localhost:4000` — разные источники, но один сайт: кука там всегда первой стороны. Сторонний контекст начинается с разных регистрируемых доменов, и для проверки нужны два имени — через `--host-resolver-rules`, свой DNS или `hosts`.',
    tone: 'err',
  },
  {
    n: '03',
    t: '`Partitioned` без `SameSite=None` в Chromium не ставится из фрейма',
    d: 'Атрибут `SameSite` для разделённой куки кажется лишним — раздел же и так её защищает. Но Chromium сначала применяет умолчание `Lax`, а куку `Lax` из межсайтового контекста отвергает. Firefox и WebKit ту же строку приняли: ошибка видна только в одном движке.',
    tone: 'err',
  },
  {
    n: '04',
    t: 'Chromium по умолчанию всё ещё отдаёт стороннюю куку',
    d: 'Отладка в своём браузере с настройками по умолчанию покажет, что виджет работает. У пользователя Firefox, Chrome с выключенными сторонними куками, а по документации — Safari и инкогнито Chrome он же сломан. Проверяйте в режиме ограничения: в DevTools или командой протокола отладки `Network.setCookieControls`, которой снят столбец «сторонние ограничены».',
    tone: 'warn',
  },
  {
    n: '05',
    t: 'Разрешение Storage Access не прикладывает куки само',
    d: 'Разрешение, выданное заранее или в прошлый раз, срабатывает, только когда документ фрейма вызвал `requestStorageAccess()`. На стенде фрейм с выданным разрешением загрузился без кук. Вызов нужен на каждой загрузке фрейма — после разрешения он проходит без вопроса и без жеста.',
    tone: 'warn',
  },
  {
    n: '06',
    t: 'Firefox не отдаёт куку, но и не отвергает её',
    d: 'Кука без `Partitioned`, поставленная из фрейма, в Firefox молча ложится в раздел сайта верхнего уровня. Во фрейме под тем же сайтом всё выглядит правильно; на самом `embed.test` и под другим сайтом её нет. Диагноз «кука не сохранилась» здесь неверен — она сохранилась, но не там.',
    tone: 'warn',
  },
  {
    n: '07',
    t: '`localStorage` в WebKit-сборке общий между разделами',
    d: 'На стенде фрейм `embed.test` в сборке WebKit 26.6 прочёл под `top2.test` запись, сделанную под `top.test`, а IndexedDB — нет. Это сборка Playwright, не Safari, но вывод общий: разделение разных хранилищ внедряли разными версиями, и «хранилище разделено» без названия типа ничего не утверждает.',
    tone: 'warn',
  },
  {
    n: '08',
    t: '`await hasStorageAccess()` перед запросом съедает жест в WebKit',
    d: 'Связка «сначала `await document.hasStorageAccess()`, потом `requestStorageAccess()`» в WebKit 26.6 дала `NotAllowedError` два прогона из двух, а тот же вызов первой строкой обработчика — доступ. `await Promise.resolve()` жест не съел: теряет его настоящий асинхронный вызов. Firefox выдал доступ в обоих вариантах, поэтому в одном движке ошибка не видна. Проверку делайте при загрузке фрейма, а в обработчике клика — сразу `requestStorageAccess()`, как в коде раздела «Storage Access API».',
    tone: 'err',
  },
];

/* ──────────────────── Раздел 8 · источники ──────────────────── */

export const SOURCES: { t: string; items: string[] }[] = [
  {
    t: 'Спецификации',
    items: [
      '**RFC 6265bis** (IETF HTTP WG) — `SameSite`, контекст «same-site» и отказ ставить `Lax`/`Strict` из межсайтового контекста',
      '**CHIPS** (Privacy CG) — атрибут `Partitioned`, ключ раздела и обязательный `Secure`',
      '**Storage Access API** (Privacy CG, влит в HTML) — `hasStorageAccess`, `requestStorageAccess`, требование жеста пользователя',
      '**Client-Side Storage Partitioning** (Privacy CG) — какие хранилища разделяются и по какому ключу',
      '**FedCM** (W3C FedID CG) — `navigator.credentials.get({ identity })`',
    ],
  },
  {
    t: 'Документация движков',
    items: [
      '**Chrome for Developers** — «Cookies Having Independent Partitioned State (CHIPS)», «Storage partitioning», «Storage Access API», «Related Website Sets», «Test for third-party cookie restrictions»',
      '**Privacy Sandbox** — объявление об изменениях в планах (октябрь 2025) и статус Related Website Sets',
      '**MDN** — «Third-party cookies», «State Partitioning» (Total Cookie Protection), «Storage Access API», «FedCM API»',
      '**WebKit blog** — «Full Third-Party Cookie Blocking and More», «Updates to Storage Policy»',
    ],
  },
];
