import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { AwFixture, LogLine } from '@/widgets/autowait-lab/model/types';

/**
 * Данные темы «Тесты в браузере изнутри: локаторы, авто-ожидание и мигание».
 *
 * Тема написана здесь, 2026-10-01, по списку кандидатов для направления «Сборка и инструменты».
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * `@playwright/test` и `playwright-core` **1.63.0** из `node_modules` проекта, Chromium
 * 153.0.8010.12 (chrome-headless-shell, сборка Playwright 1243), Node 24.11.0, macOS arm64,
 * октябрь 2026. Свой сервер на `node:http` (порт 52710) отдаёт четыре страницы:
 *   — `/fx` — кнопка `#buy` и функция `run(timeline)`, которая по таймерам применяет к кнопке
 *     снимки состояния: вставить/убрать узел, `display: none`, `left`, CSS-анимация
 *     `transform` (класс `moving`), оверлей `<div id="overlay" class="modal">` на весь экран,
 *     атрибут `disabled`. Снимки — те же, что `AW_FIXTURES` ниже;
 *   — `/list?delay=N` — кнопка «Загрузить», `fetch('/api/items?delay=N')`, сервер держит ответ
 *     N мс, потом статус «Готово» и три `<li>`;
 *   — `/replace` — через 300 мс кнопка заменяется новым узлом с тем же текстом;
 *   — `/cart` и `/api/cart` — корзина, которая живёт на сервере и общая для всех тестов.
 *
 * Сценарии запускались отдельным процессом со своим конфигом в каталоге стенда (`workers: 1`,
 * `trace: 'on'`), не тестами проекта.
 *
 * A. **Авто-ожидание** (`AW_FIXTURES`, `TIMEOUT_LOG`). Отдельный скрипт: `chromium.launch()`,
 *    `page.goto('/fx')`, `page.evaluate(run, timeline)`, сразу `page.click('#buy', { timeout })`;
 *    `DEBUG=pw:api`, время строк журнала пересчитано в мс от начала `page.click`. Каждая
 *    фикстура — три прогона: сообщения совпали во всех трёх дословно, момент клика разошёлся
 *    не больше чем на 9 мс (`standClicks`). Строки `"networkidle" event fired` (событие
 *    навигации, к клику не относится) из журналов убраны, больше ничего не тронуто.
 *    Таймауты — `timeout: 1500`, текст ошибки без ANSI-цветов.
 * B. **Протокол** (`CDP_ROWS`, `CDP_CLICK`). `DEBUG=pw:protocol,pw:browser` на коротком сценарии:
 *    `launch`, `newContext`, `newPage`, `goto('/list')`, `getByRole(…).click()`. Сообщения
 *    посчитаны по шагам; в `CDP_CLICK` — отправленные методы клика по порядку, параметры
 *    сокращены до значимых. Процессы — `ps` во время теста (`PROC_CHIPS`).
 * C. **Локаторы и ассерты** (`LOCATOR_CODE`, `ASSERT_CODE`, `RACE_CODE`, `STATE_CODE`) — строки
 *    ниже стенд записал в файлы `*.spec.mjs` как есть и прогнал `playwright test`; итоги и
 *    сообщения ошибок — в `*_RESULTS`. Селекторы — `String(locator)` и внутреннее `_selector`.
 *    Обходы проверок (`BYPASS_ROWS`) — та же `/fx` с оверлеем, слушатель `click` на документе
 *    в фазе захвата.
 * D. **Трасса** (`TRACE_FILES`, `TRACE_FACTS`) — `trace.zip` упавшего теста
 *    «`waitForTimeout(300)`, сервер 450 мс», распакован и разобран построчно (файлы — JSON Lines).
 *    `retries: 1` с `trace: 'on-first-retry'` — отдельный конфиг (`RETRY_FACTS`).
 *
 * Из исходника `playwright-core` 1.63 (`lib/coreBundle.js`, тест читает его же): паузы
 * `[0, 20, 100, 100, 500]` между повторами действия (`server/dom.ts`, `_retryAction`) и
 * `[20, 50, 100, 100, 500]` между поисками элемента (`server/frames.ts`,
 * `retryWithProgressAndBackoff`, урезается до пятой части таймаута); проверка стабильности —
 * одна и та же рамка `getBoundingClientRect` в двух кадрах `requestAnimationFrame` подряд
 * (`rafCountForStablePosition()` у Chromium — 1, у WebKit на Windows — 5); видимость —
 * ненулевая рамка и не `visibility: hidden`, `opacity: 0` видимым считается (проверено и
 * стендом). Порядок шагов клика — комментарий «Life of a pointer action» в injected-скрипте.
 *
 * Только по документации, стендом не проверялось: Selenium и «stale element reference»
 * (спецификация WebDriver); что для Firefox и WebKit Playwright ставит свои сборки браузеров
 * со своим протоколом; что один браузер переиспользуется всеми тестами воркера (мы видели один
 * процесс браузера на воркер, но не проверяли его жизнь между файлами); таймаут теста
 * 30 000 мс по умолчанию; рекомендованный порядок локаторов.
 *
 * Тест `tests/unit/e2e-testing.test.ts` исполняет `AUTOWAIT_CODE` (та же строка, что на
 * странице и в демо) на каждой фикстуре и сверяет журнал со стендом дословно, время строк —
 * с допуском; паузы и тексты сообщений сверяет с `playwright-core` из `node_modules`; строки
 * спецификаций разбирает esbuild. Браузер тест не поднимает: сменится Playwright — стенд
 * перезапускается руками.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'e2e-тест (сквозной)',
    d: 'Тест, который открывает настоящую страницу в настоящем браузере и действует как пользователь: нажимает, вводит, ждёт. Проверяет всё сразу — разметку, стили, скрипты, сервер.',
  },
  {
    k: 'Playwright',
    d: 'Библиотека от Microsoft, которая запускает браузер и управляет им из Node. `@playwright/test` — её тест-раннер со своими `test` и `expect`.',
  },
  {
    k: 'CDP (Chrome DevTools Protocol)',
    d: 'Протокол, через который DevTools разговаривает с Chromium: JSON-сообщения «сделай» и «случилось». Playwright управляет Chromium через него же.',
  },
  {
    k: 'контекст браузера',
    d: 'Отдельный профиль внутри одного запущенного браузера: свои cookie, `localStorage`, кеш. Как окно инкогнито, только их можно открыть сколько угодно.',
  },
  {
    k: 'локатор',
    d: 'Объект Playwright, который описывает, **как найти** элемент: «кнопка с именем «Купить»». Сам элемент он не хранит.',
  },
  {
    k: 'авто-ожидание (actionability)',
    d: 'Проверки перед действием: элемент в документе, видим, стоит на месте, включён и ничем не накрыт. Пока это не так, Playwright ждёт и проверяет снова.',
  },
  {
    k: 'веб-ассерт',
    d: '`expect(locator).toHaveText(…)` и родня: проверка, которая повторяется, пока не выполнится или не кончится таймаут.',
  },
  {
    k: 'мигающий тест (flaky)',
    d: 'Тест, который на одном и том же коде то проходит, то падает. Почти всегда это гонка: тест и страница делают что-то одновременно, и порядок каждый раз разный.',
  },
];

export const PLAIN_E2E =
  'Как диспетчер, который ведёт водителя по рации. Диспетчер — ваш тест в Node — машину не трогает, он говорит «поверни налево» и слушает, что произошло. Водитель — браузер — едет сам. Всё, что идёт не так в e2e-тестах, сводится к одному: диспетчер говорит слишком рано или проверяет то, что уже изменилось.';

export const PREREQ_NOTE =
  'Тема о том, что происходит между строкой теста и браузером. Сам тест-раннер, процессы браузера, дерево доступности и разница между настоящим кликом и `el.click()` разобраны в других темах — здесь на них опираются.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'Как раннер собирает и запускает тесты',
    d: 'Файлы ищутся по шаблону, `describe` и `test` собираются в дерево, хуки `beforeEach`/`afterEach` обходят каждый тест. `@playwright/test` устроен так же, только каждому тесту выдаёт ещё и страницу.',
    href: '/tooling/test-runners/#s1',
    hrefLabel: '«Тест-раннеры изнутри», раздел «Сбор и исполнение»',
    tone: 'info',
  },
  {
    t: 'Браузер — несколько процессов',
    d: 'Главный процесс браузера управляет окнами и сетью, а страницы живут в отдельных процессах рендерера. Команды снаружи принимает главный.',
    href: '/js/browser-architecture/#s2',
    hrefLabel: '«Архитектура браузера», раздел «Каталог процессов»',
    tone: 'info',
  },
  {
    t: 'Роль и имя элемента',
    d: 'Браузер строит рядом с DOM дерево доступности: у кнопки роль `button` и имя «Купить» — из текста, `aria-label` или подписи. `getByRole` ищет именно по нему.',
    href: '/render/accessibility-tree/#s3',
    hrefLabel: '«Дерево доступности», раздел «Роль»',
    tone: 'info',
  },
  {
    t: 'Настоящий клик и `el.click()`',
    d: 'Клик мышью — семь событий с `isTrusted: true`, от `pointerdown` до `click`. `el.click()` из кода — одно событие `click`, и браузер помечает его как созданное скриптом.',
    href: '/render/dom-events/#s7',
    hrefLabel: '«События DOM», раздел «Синхронно»',
    tone: 'info',
  },
];

// ─── Раздел 1. Кто кем управляет ───────────────────────────────────────────────────────────

/** Цепочка процессов во время теста: `ps` на стенде. */
export const PROC_CHIPS = [
  { label: 'playwright test (Node)' },
  { label: 'воркер (Node): тест + Playwright', tone: 'ok' as const },
  { label: 'труба: CDP' },
  { label: 'процесс браузера', tone: 'warn' as const },
  { label: 'рендерер страницы' },
];

export const PROC_NOTE =
  'На стенде `ps` показал цепочку: процесс `playwright test` → воркер `node …/worker` → `chrome-headless-shell` с флагом `--remote-debugging-pipe`. Код теста и сама библиотека Playwright работают в одном процессе — воркере. Браузер — его дочерний процесс, и разговаривают они не через сеть, а через трубу (pipe) между процессами. Под браузером, как у любого Chromium, — процессы GPU, сети и по рендереру на страницу: на три страницы стенд насчитал три `--type=renderer`.';

export const PLAIN_CDP =
  'Как пульт с кнопками и лампочками. Кнопки — команды: «создай вкладку», «открой адрес», «нажми мышь в точке 46, 18». Лампочки — события, которые браузер шлёт сам: «пришёл ответ», «страница загрузилась». У каждой команды есть номер, и ответ приходит с тем же номером — так Playwright понимает, на что ему ответили.';

/** Сколько сообщений CDP ушло и пришло на каждом шаге короткого сценария. */
export const CDP_ROWS = [
  { k: '`chromium.launch()`', send: 2, events: 0, what: '`Browser.getVersion`, `Target.setAutoAttach` — «сообщай о каждой новой вкладке»' },
  { k: '`browser.newContext()`', send: 2, events: 0, what: '`Target.createBrowserContext` — и всё: новый профиль в памяти' },
  { k: '`context.newPage()`', send: 17, events: 10, what: '`Target.createTarget`, включение доменов `Page`, `Runtime`, `Network`, размер окна 1280×720, `Page.createIsolatedWorld`' },
  { k: '`page.goto(\'/list\')`', send: 1, events: 20, what: 'одна команда `Page.navigate` — и двадцать событий: запрос, ответ, `DOMContentLoaded`, `load`' },
  { k: '`getByRole(…).click()`', send: 19, events: 9, what: 'поиск и проверки скриптом в странице, `DOM.getContentQuads`, три `Input.dispatchMouseEvent`' },
];

/** Отправленные методы клика по порядку; комментарии — что делала каждая команда. */
export const CDP_CLICK = `// getByRole('button', { name: 'Загрузить' }).click() — 19 команд
Runtime.evaluate          // первый раз: свой скрипт в страницу, 321 149 символов
Runtime.evaluate          // и утилиты к нему, 11 035 символов
Runtime.callFunctionOn    // injected.querySelectorAll(internal:role=button[name="Загрузить"i])
Runtime.callFunctionOn    // → "locator resolved to <button id="load">Загрузить</button>"
Runtime.callFunctionOn    // взять сам узел
Runtime.callFunctionOn    // подпись узла для журнала
Runtime.releaseObject
Runtime.callFunctionOn    // checkElementStates: visible, enabled, stable
DOM.scrollIntoViewIfNeeded
DOM.getContentQuads       // → [[8,8, 84.875,8, 84.875,29, 8,29]]
Runtime.callFunctionOn    // размер окна: 1280×720
Runtime.callFunctionOn    // кто лежит в точке (46.43; 18.5)? ставим перехватчик
Input.dispatchMouseEvent  // mouseMoved    x: 46.43, y: 18.5
Input.dispatchMouseEvent  // mousePressed  button: left, clickCount: 1
Input.dispatchMouseEvent  // mouseReleased button: left, clickCount: 1
Runtime.callFunctionOn    // h.stop(): события дошли до кнопки? → "done"
Runtime.releaseObject
Page.enable
Runtime.releaseObject`;

export const CDP_NOTE =
  'Клик собирается из двух видов команд. Всё, что нужно **узнать** о странице, — найти элемент, проверить его состояние, кто лежит в точке клика, — делает скрипт Playwright внутри страницы (`Runtime.callFunctionOn`). А сам клик — три `Input.dispatchMouseEvent`: это ввод на уровне браузера, как от настоящей мыши. Поэтому страница получает полную цепочку событий с `isTrusted: true`, а не одно `click` из кода.';

export const WORLD_FACTS = [
  {
    t: 'Изолированный мир',
    d: 'Скрипт Playwright живёт в отдельном мире JavaScript той же страницы (`Page.createIsolatedWorld`, имя `__playwright_utility_world_…`). DOM у миров общий, а глобальные переменные разные: код страницы не видит Playwright и не может случайно сломать его, переопределив, например, `Array.prototype.map`.',
  },
  {
    t: 'Контекст — две команды',
    d: '`newContext()` на стенде — `Target.createBrowserContext` и настройка загрузок, браузер не перезапускается. Поэтому раннер даёт каждому тесту новый контекст: он почти ничего не стоит.',
  },
  {
    t: 'Контексты не делят хранилище',
    d: 'Страница первого контекста записала `localStorage.setItem(\'k\', \'1\')`. Страница второго контекста на том же адресе прочитала `null`, а вторая страница первого — `\'1\'`. Граница проходит по контексту, а не по вкладке.',
    tone: 'ok' as const,
  },
  {
    t: 'Не только Chromium',
    d: 'Для Firefox и WebKit Playwright ставит свои сборки этих браузеров с доработанным протоколом, у Chromium берёт CDP как есть. API для теста одинаковый — различается то, что идёт по трубе.',
  },
];

// ─── Раздел 2. Локатор — это запрос ────────────────────────────────────────────────────────

export const PLAIN_LOCATOR =
  'Как встретить человека на вокзале. Можно запомнить «стоит у третьей колонны» — а он отошёл за кофе, и вы ждёте у пустой колонны. А можно помнить «высокий, в красном шарфе» и каждый раз искать заново. `ElementHandle` — это колонна, локатор — это шарф.';

export const LOCATOR_CODE = `import { test, expect } from '@playwright/test';

// /replace: через 300 мс страница заменяет кнопку новой — тот же текст, другой узел.
test('ElementHandle после перерисовки', async ({ page }) => {
  await page.goto('/replace');
  const handle = await page.$('button');       // ссылка на конкретный узел
  await page.waitForTimeout(400);              // только чтобы дождаться перерисовки
  await handle.click({ timeout: 1000 });
});

test('Locator после перерисовки', async ({ page }) => {
  await page.goto('/replace');
  const buy = page.getByRole('button', { name: 'Купить' });  // описание, а не узел
  await page.waitForTimeout(400);
  await buy.click();
  expect(await page.evaluate(() => window.clicks)).toBe(1);
});
`;

export const LOCATOR_RESULTS = [
  { k: 'ElementHandle после перерисовки', ok: false, v: '`elementHandle.click: Element is not attached to the DOM` — сразу, без ожидания: узла в документе больше нет, и найти его снова не по чему.' },
  { k: 'Locator после перерисовки', ok: true, v: 'Прошёл: клик пришёл в новую кнопку, `window.clicks === 1`. Локатор искал элемент в момент клика, а не в момент создания.' },
];

export const LOCATOR_NOTE =
  'В Selenium тот же случай знаком как `StaleElementReferenceException`: найденный элемент — ссылка на узел, а фреймворк интерфейса заменил узел новым. В Playwright так ведёт себя только `ElementHandle` (`page.$`), а локатор каждое действие начинает с поиска. Если узел заменили между поиском и кликом, Playwright пишет в журнал `element was detached from the DOM, retrying` и ищет ещё раз.';

/** Во что превращаются локаторы: `String(locator)` и внутренний селектор. Снято стендом. */
export const SELECTOR_ROWS = [
  { k: "getByRole('button', { name: 'Купить' })", sel: 'internal:role=button[name="Купить"i]', d: 'Роль и имя из дерева доступности. `i` — без учёта регистра и **по подстроке**.' },
  { k: "getByRole('button', { name: 'Купить', exact: true })", sel: 'internal:role=button[name="Купить"s]', d: '`s` — точное совпадение.' },
  { k: "getByLabel('Email')", sel: 'internal:label="Email"i', d: 'Поле по тексту его `<label>` или `aria-label`.' },
  { k: "getByText('Оплатить')", sel: 'internal:text="Оплатить"i', d: 'По видимому тексту.' },
  { k: "getByTestId('pay')", sel: 'internal:testid=[data-testid="pay"s]', d: 'По атрибуту `data-testid`, точно.' },
  { k: "locator('#buy')", sel: '#buy', d: 'Обычный CSS: привязан к разметке, а не к тому, что видит человек.' },
];

export const STRICT_ERROR = `locator.click: Error: strict mode violation:
getByRole('button', { name: 'Купить' }) resolved to 2 elements:
    1) <button>Купить</button> aka getByRole('button', { name: 'Купить', exact: true })
    2) <button>Купить сейчас</button> aka getByRole('button', { name: 'Купить сейчас' })`;

export const STRICT_NOTE =
  'Действие требует ровно один элемент. Имя сравнивается по подстроке, поэтому «Купить» нашло и «Купить сейчас» — и Playwright отказался выбирать сам. В ошибке он сразу подсказывает локаторы, которые различают кандидатов. `count()` и `all()` строгости не требуют: там нужно как раз «сколько».';

export const ROLE_FACTS = [
  {
    t: 'Почему сначала роль',
    d: 'Документация Playwright советует искать по тому, что видит и слышит пользователь: `getByRole`, потом `getByLabel`, `getByText`, и только в конце `getByTestId` и CSS. Тест с `getByRole(\'button\', { name: \'Купить\' })` переживёт смену классов и вложенности, а заодно упадёт, если у кнопки пропадёт имя для скринридера.',
  },
  {
    t: 'Роль считает Playwright, а не браузер',
    d: 'Роль и имя `getByRole` вычисляет сам — скриптом в странице, по ARIA и HTML-AAM. Обычно ответ совпадает с деревом доступности Chromium, но на границах расходится: [«Дерево доступности», раздел «Кто считает»](/render/accessibility-tree/#s8) показывает четыре таких случая.',
    tone: 'warn' as const,
  },
];

// ─── Раздел 3. Авто-ожидание ───────────────────────────────────────────────────────────────

export const PLAIN_ACTIONABILITY =
  'Как вежливый курьер у двери. Он не жмёт на звонок, пока не убедится: дверь та, она не заколочена, перед ней не стоят строительные леса, и звонок не прикрыт табличкой. Если что-то не так — отходит, ждёт и смотрит снова, сначала часто, потом реже. А если хозяин так и не появился за отведённое время — уезжает и пишет, что именно мешало.';

/** Шаги одной попытки клика — по комментарию «Life of a pointer action» в injected-скрипте 1.63. */
export const ACT_STEPS = [
  { k: '1. Найти', d: 'Выполнить локатор в странице. Ничего не нашлось — подождать и искать снова: 0, 20, 50, 100, 100, 500, 500… мс.' },
  { k: '2. Стабилен', d: 'Взять `getBoundingClientRect` в двух кадрах `requestAnimationFrame` подряд. Рамка сдвинулась — `element is not stable`.' },
  { k: '3. Видим', d: 'Рамка ненулевая и нет `visibility: hidden`. `display: none` даёт нулевую рамку. `opacity: 0` — видим.' },
  { k: '4. Включён', d: 'Нет `disabled` у кнопки или поля, у предка-`fieldset` или `aria-disabled="true"` по цепочке.' },
  { k: '5. Прокрутить', d: 'Доскроллить до элемента и взять точку клика — середину его рамки на экране (`DOM.getContentQuads`).' },
  { k: '6. Не перекрыт', d: '`elementsFromPoint` в этой точке. Сверху не сама кнопка и не её потомок — `<…> intercepts pointer events`.' },
  { k: '7. Клик', d: '`mouseMoved`, `mousePressed`, `mouseReleased`. Перехватчик проверяет, что события дошли до кнопки.' },
];

export const AUTOWAIT_CODE = `// Паузы — из исходников Playwright 1.63 (server/frames.ts и server/dom.ts).
const FIND_PAUSES = [0, 20, 50, 100, 100, 500]; // перед каждым поиском элемента
const RETRY_PAUSES = [0, 20, 100, 100, 500];     // перед каждым повтором действия
// Сколько занимает одна проверка — оценка по журналам стенда, а не константа Playwright.
const FIND_MS = 5;    // найти элемент по локатору
const CHECK_MS = 25;  // проверить состояние: два кадра requestAnimationFrame

// Снимок, который действует в момент t: последний, чьё время не позже t.
function stateAt(timeline, t) {
  let state = timeline[0];
  for (const snap of timeline) if (snap.t <= t) state = snap;
  return state;
}

function preview(s) {
  return '<button id="buy"' + (s.moving ? ' class="moving"' : '') +
    (s.disabled ? ' disabled' : '') + '>Купить</button>';
}

function autoWait(timeline, timeout) {
  const log = [];
  const say = (t, msg) => log.push([t, msg]);
  const fail = () => ({ log, clickAt: null, error: 'Timeout ' + timeout + 'ms exceeded.' });
  // Маленький таймаут укорачивает лестницу: пауза не длиннее пятой части таймаута.
  const pauses = FIND_PAUSES.slice();
  while (pauses.length > 2 && pauses[pauses.length - 1] > timeout / 5) pauses.pop();

  let t = 0, find = 0;
  say(t, "waiting for locator('#buy')");
  while (true) {
    // 1. Найти элемент заново. Не нашёлся — пауза по лестнице и снова.
    t += pauses[Math.min(find++, pauses.length - 1)];
    if (t + FIND_MS > timeout) return fail();
    t += FIND_MS;
    if (!stateAt(timeline, t).attached) continue;
    say(t, '  locator resolved to ' + preview(stateAt(timeline, t)));

    // 2. Попытки действия над найденным элементом.
    for (let retry = 0; ; retry++) {
      if (retry === 0) say(t, 'attempting click action');
      else {
        say(t, 'retrying click action');
        const pause = RETRY_PAUSES[Math.min(retry - 1, RETRY_PAUSES.length - 1)];
        if (pause) { say(t, '  waiting ' + pause + 'ms'); t += pause; }
      }
      if (t + CHECK_MS > timeout) return fail();
      say(t, '  waiting for element to be visible, enabled and stable');
      const first = stateAt(timeline, t);              // первый кадр
      const s = stateAt(timeline, t + CHECK_MS);       // второй кадр
      t += CHECK_MS;
      if (!s.attached) { say(t, 'element was detached from the DOM, retrying'); break; }
      // Стабилен: в двух кадрах подряд одна и та же рамка.
      if (first.moving || s.moving || first.x !== s.x) { say(t, '  element is not stable'); continue; }
      if (!s.visible) { say(t, '  element is not visible'); continue; }
      if (s.disabled) { say(t, '  element is not enabled'); continue; }
      say(t, '  element is visible, enabled and stable');
      say(t, '  scrolling into view if needed');
      say(t, '  done scrolling');
      // В точке клика сверху должна оказаться сама кнопка, а не то, что её накрыло.
      if (s.coveredBy) { say(t, '  ' + s.coveredBy + ' intercepts pointer events'); continue; }
      say(t, '  performing click action');
      return { log, clickAt: t, error: null };
    }
  }
}`;

export const AUTOWAIT_NOTE =
  'Два цикла, и у каждого своя лестница пауз. Внешний ищет элемент: пока локатор ничего не находит, журнал молчит — в нём одна строка `waiting for locator`. Внутренний повторяет действие над найденным элементом и на каждой неудаче пишет причину. Обе лестницы упираются в 500 мс: если кнопка стала готова через 600 мс, клик случится около 870-й, а не сразу. `FIND_MS` и `CHECK_MS` — не настройки Playwright, а время, которое проверки заняли на стенде.';

/** Оверлей так, как Playwright печатает узел в журнале. */
export const OVERLAY = '<div id="overlay" class="modal"></div>';

// prettier-ignore
const STAND: Record<string, LogLine[]> = {
  ready: [
    [1, "waiting for locator('#buy')"],
    [16, '  locator resolved to <button id="buy">Купить</button>'],
    [17, 'attempting click action'],
    [17, '  waiting for element to be visible, enabled and stable'],
    [47, '  element is visible, enabled and stable'],
    [47, '  scrolling into view if needed'],
    [47, '  done scrolling'],
    [49, '  performing click action'],
  ],
  late: [
    [1, "waiting for locator('#buy')"],
    [795, '  locator resolved to <button id="buy">Купить</button>'],
    [797, 'attempting click action'],
    [797, '  waiting for element to be visible, enabled and stable'],
    [813, '  element is visible, enabled and stable'],
    [814, '  scrolling into view if needed'],
    [814, '  done scrolling'],
    [815, '  performing click action'],
  ],
  hidden: [
    [1, "waiting for locator('#buy')"],
    [15, '  locator resolved to <button id="buy">Купить</button>'],
    [15, 'attempting click action'],
    [16, '  waiting for element to be visible, enabled and stable'],
    [45, '  element is not visible'],
    [45, 'retrying click action'],
    [45, '  waiting for element to be visible, enabled and stable'],
    [78, '  element is not visible'],
    [78, 'retrying click action'],
    [78, '  waiting 20ms'],
    [99, '  waiting for element to be visible, enabled and stable'],
    [111, '  element is not visible'],
    [111, 'retrying click action'],
    [111, '  waiting 100ms'],
    [213, '  waiting for element to be visible, enabled and stable'],
    [228, '  element is not visible'],
    [228, 'retrying click action'],
    [228, '  waiting 100ms'],
    [330, '  waiting for element to be visible, enabled and stable'],
    [344, '  element is not visible'],
    [344, 'retrying click action'],
    [344, '  waiting 500ms'],
    [847, '  waiting for element to be visible, enabled and stable'],
    [862, '  element is visible, enabled and stable'],
    [863, '  scrolling into view if needed'],
    [866, '  done scrolling'],
    [870, '  performing click action'],
  ],
  disabled: [
    [1, "waiting for locator('#buy')"],
    [17, '  locator resolved to <button id="buy" disabled>Купить</button>'],
    [18, 'attempting click action'],
    [18, '  waiting for element to be visible, enabled and stable'],
    [46, '  element is not enabled'],
    [46, 'retrying click action'],
    [46, '  waiting for element to be visible, enabled and stable'],
    [79, '  element is not enabled'],
    [79, 'retrying click action'],
    [79, '  waiting 20ms'],
    [101, '  waiting for element to be visible, enabled and stable'],
    [113, '  element is not enabled'],
    [113, 'retrying click action'],
    [113, '  waiting 100ms'],
    [215, '  waiting for element to be visible, enabled and stable'],
    [230, '  element is not enabled'],
    [230, 'retrying click action'],
    [230, '  waiting 100ms'],
    [333, '  waiting for element to be visible, enabled and stable'],
    [346, '  element is not enabled'],
    [347, 'retrying click action'],
    [347, '  waiting 500ms'],
    [850, '  waiting for element to be visible, enabled and stable'],
    [863, '  element is not enabled'],
    [863, 'retrying click action'],
    [863, '  waiting 500ms'],
    [1367, '  waiting for element to be visible, enabled and stable'],
    [1379, '  element is visible, enabled and stable'],
    [1379, '  scrolling into view if needed'],
    [1379, '  done scrolling'],
    [1381, '  performing click action'],
  ],
  overlay: [
    [2, "waiting for locator('#buy')"],
    [30, '  locator resolved to <button id="buy">Купить</button>'],
    [31, 'attempting click action'],
    [31, '  waiting for element to be visible, enabled and stable'],
    [46, '  element is visible, enabled and stable'],
    [46, '  scrolling into view if needed'],
    [46, '  done scrolling'],
    [48, '  <div id="overlay" class="modal"></div> intercepts pointer events'],
    [48, 'retrying click action'],
    [48, '  waiting for element to be visible, enabled and stable'],
    [79, '  element is visible, enabled and stable'],
    [79, '  scrolling into view if needed'],
    [80, '  done scrolling'],
    [80, '  <div id="overlay" class="modal"></div> intercepts pointer events'],
    [80, 'retrying click action'],
    [80, '  waiting 20ms'],
    [102, '  waiting for element to be visible, enabled and stable'],
    [113, '  element is visible, enabled and stable'],
    [113, '  scrolling into view if needed'],
    [113, '  done scrolling'],
    [114, '  <div id="overlay" class="modal"></div> intercepts pointer events'],
    [114, 'retrying click action'],
    [114, '  waiting 100ms'],
    [216, '  waiting for element to be visible, enabled and stable'],
    [229, '  element is visible, enabled and stable'],
    [229, '  scrolling into view if needed'],
    [229, '  done scrolling'],
    [230, '  <div id="overlay" class="modal"></div> intercepts pointer events'],
    [230, 'retrying click action'],
    [230, '  waiting 100ms'],
    [332, '  waiting for element to be visible, enabled and stable'],
    [348, '  element is visible, enabled and stable'],
    [348, '  scrolling into view if needed'],
    [349, '  done scrolling'],
    [350, '  <div id="overlay" class="modal"></div> intercepts pointer events'],
    [350, 'retrying click action'],
    [350, '  waiting 500ms'],
    [853, '  waiting for element to be visible, enabled and stable'],
    [863, '  element is visible, enabled and stable'],
    [864, '  scrolling into view if needed'],
    [865, '  done scrolling'],
    [869, '  performing click action'],
  ],
  moving: [
    [1, "waiting for locator('#buy')"],
    [19, '  locator resolved to <button id="buy" class="moving">Купить</button>'],
    [20, 'attempting click action'],
    [20, '  waiting for element to be visible, enabled and stable'],
    [45, '  element is not stable'],
    [45, 'retrying click action'],
    [45, '  waiting for element to be visible, enabled and stable'],
    [79, '  element is not stable'],
    [79, 'retrying click action'],
    [79, '  waiting 20ms'],
    [101, '  waiting for element to be visible, enabled and stable'],
    [129, '  element is not stable'],
    [129, 'retrying click action'],
    [130, '  waiting 100ms'],
    [231, '  waiting for element to be visible, enabled and stable'],
    [263, '  element is not stable'],
    [263, 'retrying click action'],
    [263, '  waiting 100ms'],
    [366, '  waiting for element to be visible, enabled and stable'],
    [397, '  element is not stable'],
    [398, 'retrying click action'],
    [398, '  waiting 500ms'],
    [901, '  waiting for element to be visible, enabled and stable'],
    [913, '  element is visible, enabled and stable'],
    [913, '  scrolling into view if needed'],
    [913, '  done scrolling'],
    [915, '  performing click action'],
  ],
};

export const AW_FIXTURES: AwFixture[] = [
  {
    id: 'late',
    label: 'появится позже',
    before: { attached: false },
    changeAt: 600,
    note: 'Кнопки нет в документе — её вставят через 600 мс. Пока локатор ничего не находит, Playwright ищет снова и снова, а журнал молчит.',
    stand: STAND.late,
    standClicks: [815, 818, 816],
  },
  {
    id: 'hidden',
    label: 'скрыта',
    before: { visible: false },
    changeAt: 600,
    note: 'Кнопка в документе, но с `display: none` — рамка нулевая. Элемент найден сразу, и дальше каждая попытка кончается `element is not visible`.',
    stand: STAND.hidden,
    standClicks: [870, 872, 866],
  },
  {
    id: 'disabled',
    label: 'отключена',
    before: { disabled: true },
    changeAt: 1100,
    note: 'Кнопка видна, но с атрибутом `disabled` — как в форме, которая ждёт ответа сервера. Обычный клик мыши по ней ничего бы не сделал, и Playwright не кликает.',
    stand: STAND.disabled,
    standClicks: [1381, 1390, 1388],
  },
  {
    id: 'overlay',
    label: 'под оверлеем',
    before: { coveredBy: OVERLAY },
    changeAt: 700,
    note: 'Кнопка видна, включена и стоит на месте, но поверх неё полупрозрачный оверлей на весь экран. Все проверки состояния проходят — отказывает последняя, проверка точки клика.',
    stand: STAND.overlay,
    standClicks: [869, 868, 867],
  },
  {
    id: 'moving',
    label: 'движется',
    before: { moving: true },
    changeAt: 700,
    note: 'Кнопка едет: CSS-анимация `transform`, 400 мс туда и обратно. Рамка в двух соседних кадрах разная — `element is not stable`. Анимация `transform` идёт на композиторе, но `getBoundingClientRect` её всё равно видит.',
    stand: STAND.moving,
    standClicks: [915, 923, 920],
  },
];

/** Та же кнопка, готовая с первого кадра. Клик на 48–49 мс — цена одной попытки. */
export const READY_STAND: LogLine[] = STAND.ready;
export const READY_CLICKS = [49, 49, 48];

export const DEMO_CAPTION =
  'Журнал и момент клика считает функция `autoWait` выше — по снимкам состояния, как они меняются во времени. При значениях стенда рядом печатается журнал настоящего Playwright 1.63 на той же фикстуре: сообщения совпадают дословно, время — с точностью до нескольких десятков миллисекунд. Сдвиньте момент, когда кнопка станет готовой, — и видно, на какую ступень лестницы попадёт клик, а когда вместо него будет таймаут.';

/** Таблица фикстур: что мешало, первая причина в журнале, момент клика (три прогона). */
export const STAND_ROWS = [
  { k: 'готова сразу', why: '—', when: '48–49 мс', tone: 'ok' as const },
  { k: 'появится через 600 мс', why: 'нет строк: журнал молчит, пока элемент не найден', when: '815–818 мс' },
  { k: '`display: none` до 600 мс', why: '`element is not visible` × 5', when: '866–872 мс' },
  { k: '`disabled` до 1100 мс', why: '`element is not enabled` × 6', when: '1381–1390 мс' },
  { k: 'оверлей до 700 мс', why: '`<div id="overlay" class="modal"></div> intercepts pointer events` × 5', when: '867–869 мс' },
  { k: 'анимация до 700 мс', why: '`element is not stable` × 5', when: '915–923 мс' },
];

export const TIMEOUT_LOG = `page.click: Timeout 1500ms exceeded.
Call log:
  - waiting for locator('#buy')
    - locator resolved to <button id="buy" disabled>Купить</button>
  - attempting click action
    2 × waiting for element to be visible, enabled and stable
      - element is not enabled
    - retrying click action
    - waiting 20ms
    2 × waiting for element to be visible, enabled and stable
      - element is not enabled
    - retrying click action
      - waiting 100ms
    3 × waiting for element to be visible, enabled and stable
      - element is not enabled
    - retrying click action
      - waiting 500ms`;

export const TIMEOUT_NOTE =
  'Кнопка, которая так и не включилась, и `timeout: 1500`. Журнал в ошибке сжат: одинаковые строки подряд склеены в `N ×`. Попыток было 2 + 2 + 3 = 7 — столько же даёт и `autoWait`. Если кнопку не нашли вовсе, в журнале остаётся одна строка `waiting for locator(\'#buy\')`: повторные поиски Playwright не записывает.';

export const TIMEOUT_FACTS = [
  {
    t: 'У действия своего таймаута нет',
    d: 'По умолчанию `actionTimeout` не задан, и клик ждёт, пока не кончится время всего теста. На стенде клик по отключённой кнопке с `test.setTimeout(3000)` упал с `locator.click: Test timeout of 3000ms exceeded.` — по умолчанию это были бы 30 секунд на одну строку.',
    tone: 'warn' as const,
  },
  {
    t: 'Лестница пауз зависит от таймаута',
    d: 'Пауза между поисками элемента не длиннее пятой части таймаута: при `timeout: 1500` ступень 500 мс выпадает, и поиск повторяется каждые 100 мс. Повторы действия так не урезаются.',
  },
];

// ─── Раздел 4. Мимо проверок ───────────────────────────────────────────────────────────────

/** Кнопка под оверлеем, три способа «нажать» её в обход проверок. Снято стендом. */
export const BYPASS_ROWS = [
  { k: '`click()`', got: 'ждёт: `intercepts pointer events`, потом таймаут', trusted: '—', tone: 'ok' as const },
  { k: '`click({ force: true })`', got: '`click` получил **оверлей**, кнопка — ничего; тест зелёный', trusted: '`true`', tone: 'err' as const },
  { k: '`dispatchEvent(\'click\')`', got: '`click` получила кнопка — сквозь оверлей', trusted: '`false`', tone: 'warn' as const },
  { k: '`evaluate(b => b.click())`', got: 'то же: `click` у кнопки сквозь оверлей', trusted: '`false`', tone: 'warn' as const },
];

export const BYPASS_NOTE =
  '`force: true` отключает проверки, но не меняет того, как браузер доставляет мышь: события идут в точку на экране, а там лежит оверлей. Действие «успешно», кнопка не нажата. `dispatchEvent` и `el.click()` устроены наоборот: событие отправляется прямо узлу, минуя и проверки, и геометрию, — кнопка срабатывает там, где человек её нажать не смог бы. Разница настоящего клика и `el.click()` подробно — в [«События DOM», раздел «Синхронно»](/render/dom-events/#s7).';

// ─── Раздел 5. Веб-ассерты ─────────────────────────────────────────────────────────────────

export const ASSERT_CODE = `import { test, expect } from '@playwright/test';

// /list?delay=400: по кнопке страница идёт на сервер, ответ — через 400 мс,
// потом статус меняется с «Загрузка…» на «Готово» и появляются три <li>.
test('веб-ассерт повторяет проверку', async ({ page }) => {
  await page.goto('/list?delay=400');
  await page.getByRole('button', { name: 'Загрузить' }).click();
  await expect(page.locator('#status')).toHaveText('Готово');
});

test('одноразовая проверка читает один раз', async ({ page }) => {
  await page.goto('/list?delay=400');
  await page.getByRole('button', { name: 'Загрузить' }).click();
  expect(await page.locator('#status').textContent()).toBe('Готово');
});

test('count() против toHaveCount', async ({ page }) => {
  await page.goto('/list?delay=400');
  await page.getByRole('button', { name: 'Загрузить' }).click();
  expect(await page.locator('li').count()).toBe(0);
  await expect(page.locator('li')).toHaveCount(3);
});
`;

export const ASSERT_RESULTS = [
  { k: 'веб-ассерт повторяет проверку', ok: true, v: 'Прошёл. `toHaveText` перечитывал текст, пока не увидел «Готово».' },
  { k: 'одноразовая проверка читает один раз', ok: false, v: '`Expected: "Готово"`, `Received: "Загрузка…"`. `await` дождался текста **один раз** — сразу после клика, — и `toBe` сравнил уже готовую строку.' },
  { k: 'count() против toHaveCount', ok: true, v: 'Прошёл — и показал разницу: сразу после клика `count()` равно 0, а `toHaveCount(3)` дождался трёх элементов.' },
];

export const PLAIN_ASSERT =
  'Как спросить «уже готово?» один раз и уйти — или стоять у окошка и переспрашивать, пока не скажут «да» или не закроется смена. Обычный `expect` спрашивает один раз. Веб-ассерт — стоит у окошка.';

export const ASSERT_NOTE =
  'Скобки решают всё. В `expect(locator).toHaveText(…)` в `expect` передан **локатор** — описание, по которому Playwright может перечитать страницу сколько угодно раз. В `expect(await locator.textContent())` передана **строка** — снимок одного момента, перечитывать нечего. Обычный `expect` из Jest-совместимого набора не знает о странице вообще.';

/** Конец лога упавшего веб-ассерта (тест B из STATE_CODE): что видно, когда повтор не помог. */
export const EXPECT_LOG = `Error: expect(locator).toHaveText(expected) failed

Locator:  locator('#count')
Expected: "0"
Received: "1"
Timeout:  5000ms

Call log:
  - Expect "toHaveText" locator('#count') with timeout 5000ms
  - waiting for locator('#count')
    14 × locator resolved to <p id="count">1</p>
       - unexpected value "1"`;

export const TIMEOUT_ROWS = [
  { k: 'действие (`click`, `fill`)', v: 'нет своего (`actionTimeout: 0`) — до конца теста', how: '`use: { actionTimeout }` или `{ timeout }` у вызова' },
  { k: 'веб-ассерт', v: '5000 мс', how: '`expect: { timeout }` или `{ timeout }` у вызова' },
  { k: 'тест целиком', v: '30 000 мс', how: '`timeout` в конфиге, `test.setTimeout()`' },
];

// ─── Раздел 6. Почему тесты мигают ─────────────────────────────────────────────────────────

export const RACE_CODE = `import { test, expect } from '@playwright/test';

// Один и тот же тест; меняется только, как долго сервер держит ответ.
for (const delay of [150, 450]) {
  test(\`waitForTimeout(300), сервер \${delay} мс\`, async ({ page }) => {
    await page.goto(\`/list?delay=\${delay}\`);
    await page.getByRole('button', { name: 'Загрузить' }).click();
    await page.waitForTimeout(300);
    expect(await page.locator('li').count()).toBe(3);
  });

  test(\`toHaveCount(3), сервер \${delay} мс\`, async ({ page }) => {
    await page.goto(\`/list?delay=\${delay}\`);
    await page.getByRole('button', { name: 'Загрузить' }).click();
    await expect(page.locator('li')).toHaveCount(3);
  });
}
`;

export const RACE_ROWS = [
  { k: '`waitForTimeout(300)`', fast: 'прошёл, но проспал все 300 мс, хотя ответ пришёл через 150', slow: '**упал**: `Expected: 3`, `Received: 0`', tone: 'err' as const },
  { k: '`toHaveCount(3)`', fast: 'прошёл, как только появились три `<li>`', slow: 'прошёл, как только появились три `<li>`', tone: 'ok' as const },
];

export const RACE_NOTE =
  '«Сон» проигрывает дважды. Когда сервер быстрый, тест всё равно спит свои 300 мс. Когда сервер медленный, 300 мс не хватает, и тест падает. На машине разработчика ответ приходит за 150 мс, в загруженном CI — за 450, и вот тест, который «мигает в CI». Веб-ассерт ждёт ровно столько, сколько нужно, и в обоих случаях проходит.';

export const STATE_CODE = `import { test, expect } from '@playwright/test';

test('A: кладёт в localStorage и в корзину на сервере', async ({ page, request }) => {
  await page.goto('/cart');
  await page.evaluate(() => localStorage.setItem('draft', 'Кофе'));
  await request.post('/api/cart');
});

test('B: ждёт пустой браузер и пустую корзину', async ({ page }) => {
  await page.goto('/cart');
  expect(await page.evaluate(() => localStorage.getItem('draft'))).toBe(null);
  await expect(page.locator('#count')).toHaveText('0');
});
`;

export const STATE_NOTE =
  'Тест B увидел пустой `localStorage` — новый контекст, новый профиль. А корзину — с одним товаром: `Received: "1"`. Контекст изолирует то, что лежит **в браузере**. Сервер, база данных, файлы и всё, что тесты меняют через API, общие для всех тестов, всех воркеров и всех прогонов. Порядок тестов в одном файле и утечки через общие модули разобраны в [«Тест-раннеры изнутри», раздел «Почему тесты текут»](/tooling/test-runners/#s6); в e2e к ним добавляется сервер.';

export const FLAKY_CAUSES = [
  {
    t: 'Гонка с сетью',
    d: 'Тест проверяет результат запроса, который ещё не вернулся. Признак — `waitForTimeout`, `count()`, `textContent()` или `isVisible()` сразу после действия. Лечится веб-ассертом на то, что должно появиться, или `page.waitForResponse` на сам запрос.',
    tone: 'err' as const,
  },
  {
    t: 'Анимации',
    d: 'Клик Playwright дождётся конца движения сам — проверка стабильности. Но одноразовые проверки этого не ждут: `boundingBox()` посреди анимации или скриншот на её середине каждый раз разные. Помогает отключить анимации в тестах: `reducedMotion: \'reduce\'` в контексте, если сайт его уважает.',
    tone: 'warn' as const,
  },
  {
    t: 'Общий стейт',
    d: 'Сервер и база общие для всех тестов. Тест, который полагается на «корзина пуста», упадёт, как только рядом или раньше пройдёт тест, который её наполняет. Каждому тесту — свои данные: уникальный пользователь, своя корзина, очистка в `beforeEach`.',
    tone: 'err' as const,
  },
  {
    t: 'Порядок и параллельность',
    d: 'Тесты, которые проходят только в заданном порядке, ломаются при `fullyParallel`, при другом числе воркеров и при запуске одного теста по имени. По умолчанию файлы делятся между воркерами, а тесты внутри файла идут по порядку — зависимость легко не заметить.',
    tone: 'warn' as const,
  },
];

export const RETRY_FACTS = [
  {
    t: 'Повтор помечает, а не чинит',
    d: 'С `retries: 1` тест, упавший с первой попытки и прошедший со второй, получает статус `flaky`: в отчёте стенда `"flaky": 1`, `"unexpected": 0`. Прогон зелёный, но гонка никуда не делась — повтор только прячет её от CI.',
    tone: 'warn' as const,
  },
  {
    t: '`--repeat-each` находит мигание',
    d: 'Тест, который подозревают в мигании, гоняют много раз подряд: `npx playwright test --repeat-each=20`. Гонка, которая срабатывает раз в двадцать запусков, при этом проявится.',
  },
];

// ─── Раздел 7. Трасса ──────────────────────────────────────────────────────────────────────

/** Что лежало в `trace.zip` упавшего теста «waitForTimeout(300), сервер 450 мс», 11,4 КБ. */
export const TRACE_FILES = [
  { k: 'test.trace', v: 'Шаги теста глазами раннера: хуки, фикстуры `context` и `page`, каждый вызов API (`Navigate`, `Click`, `Wait for timeout`, `Query count`), `expect "toBe"` и ошибка.' },
  { k: '1-trace.trace', v: 'Шаги глазами браузера: для каждого действия `before` и `after`, строки журнала (тот же `attempting click action`, 12 строк), снимки DOM, точка клика, кадры экрана.' },
  { k: '1-trace.network', v: 'Сеть: `GET /list?delay=450` — 200, 667 байт; `GET /api/items?delay=450` — ответа нет (`status: -1`): тест кончился раньше, чем сервер ответил.' },
  { k: 'resources/, screencast/', v: 'Тела ответов по хешу (`…sha1.html`) и кадры экрана (3 JPEG по 2–3 КБ).' },
  { k: 'src/, *.stacks', v: 'Исходник теста и стек вызова каждого действия — чтобы просмотрщик подсветил строку.' },
];

export const TRACE_FACTS = [
  {
    t: 'DOM, а не картинка',
    d: 'Снимок — сериализованный DOM: `["HTML",{"lang":"ru"},…,["P",{"id":"status"},"Загрузка…"]]`. Просмотрщик собирает из него живую страницу, в ней можно открыть DevTools. Повторяющиеся куски заменены ссылками вида `[[2,5]]` — «пятый узел из снимка двумя раньше», поэтому 9 снимков весят немного.',
  },
  {
    t: 'Три снимка на действие',
    d: 'У клика — `before`, `action` и `after`. В `action` у кнопки атрибут `__playwright_target__` и точка клика `{"x":46.43,"y":18.5}`; в `after` статус уже «Загрузка…». Видно, что клик прошёл, а ответ — нет.',
  },
  {
    t: '`on-first-retry` пишет не тот прогон',
    d: 'Режим из шаблона нового проекта: трасса только на первом повторе. На стенде тест упал с первой попытки (трассы нет) и прошёл со второй — трасса есть, но у прохода. Для мигающих тестов полезнее `retain-on-failure`: пишет всегда и хранит только упавшие.',
    tone: 'warn' as const,
  },
];

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: '`force: true` прячет перекрытый элемент',
    d: 'Проверки выключены, а мышь доставляется в точку на экране как обычно. На стенде клик с `force` по кнопке под оверлеем ушёл оверлею, кнопка ничего не получила, тест прошёл. Если `force` понадобился — почти всегда это баг страницы, который тест должен был поймать.',
    tone: 'err',
  },
  {
    n: '02',
    t: '`dispatchEvent` и `el.click()` — не пользователь',
    d: 'Событие отправляется узлу напрямую: сквозь оверлей, в отключённый вид, в невидимый элемент. `isTrusted: false`, нет `pointerdown` и `mousedown`, фокус не меняется. Тест проверяет то, чего человек сделать не может.',
    tone: 'err',
  },
  {
    n: '03',
    t: '`expect(await …)` проверяет один момент',
    d: '`expect(await locator.textContent()).toBe(…)`, `expect(await locator.count())`, `expect(await locator.isVisible())` — одноразовые. После действия, которое что-то загружает, они видят состояние «до». Нужны веб-ассерты: `toHaveText`, `toHaveCount`, `toBeVisible`.',
    tone: 'err',
  },
  {
    n: '04',
    t: '`waitForTimeout` всегда медленный и иногда короткий',
    d: 'Тест платит паузу целиком при быстром сервере и падает при медленном. Ждать нужно события: появления текста, ответа на запрос, смены адреса.',
    tone: 'warn',
  },
  {
    n: '05',
    t: '`ElementHandle` устаревает',
    d: '`page.$()` возвращает ссылку на узел. Фреймворк заменил узел — `Element is not attached to the DOM`, без ожидания и повтора. Локатор ищет заново на каждом действии.',
    tone: 'warn',
  },
  {
    n: '06',
    t: 'Имя в `getByRole` — подстрока без регистра',
    d: '`{ name: \'Купить\' }` находит и «Купить сейчас». Пока кнопка одна, тест зелёный; появилась вторая — `strict mode violation`. `exact: true` сравнивает имя целиком.',
  },
  {
    n: '07',
    t: 'Контекст не изолирует сервер',
    d: 'Новый контекст на каждый тест чистит cookie и `localStorage`, но не базу. Тест B на стенде увидел корзину, которую наполнил тест A. Данные теста создаются в самом тесте и не пересекаются с соседями.',
    tone: 'err',
  },
  {
    n: '08',
    t: 'Клик без таймаута ждёт весь тест',
    d: 'У действий нет своего таймаута: клик по навсегда отключённой кнопке висит до таймаута теста, 30 секунд по умолчанию, а ошибка говорит «Test timeout». `actionTimeout` в конфиге делает падение быстрым и понятным.',
    tone: 'warn',
  },
  {
    n: '09',
    t: '`opacity: 0` — видимый элемент',
    d: 'Видимость для Playwright — ненулевая рамка и не `visibility: hidden`. Прозрачная кнопка видима и кликабельна: на стенде клик по кнопке с `opacity: 0` прошёл сразу. `toBeVisible()` тоже вернёт успех.',
  },
];

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'Playwright — Auto-waiting (Actionability)',
    href: 'https://playwright.dev/docs/actionability',
    what: 'какие проверки перед какими действиями, `force`; версия 1.63 на стенде',
  },
  {
    title: 'Playwright — Locators',
    href: 'https://playwright.dev/docs/locators',
    what: '`getByRole` и остальные, строгость, рекомендуемый порядок',
  },
  {
    title: 'Playwright — Assertions',
    href: 'https://playwright.dev/docs/test-assertions',
    what: 'веб-ассерты с повтором против обычных `expect`',
  },
  {
    title: 'Playwright — Timeouts',
    href: 'https://playwright.dev/docs/test-timeouts',
    what: 'таймауты теста, `expect` и действий по умолчанию',
  },
  {
    title: 'Playwright — Trace viewer',
    href: 'https://playwright.dev/docs/trace-viewer',
    what: 'режимы `trace`, что показывает просмотрщик',
  },
  {
    title: 'Playwright — Browser contexts (Isolation)',
    href: 'https://playwright.dev/docs/browser-contexts',
    what: 'контекст как изолированный профиль',
  },
  {
    title: 'Исходники Playwright: `server/dom.ts`, `server/frames.ts`, `injected/src/injectedScript.ts`',
    href: 'https://github.com/microsoft/playwright/tree/main/packages',
    what: 'лестницы пауз, `checkElementStates`, `expectHitTarget`, «Life of a pointer action»',
  },
  {
    title: 'Chrome DevTools Protocol',
    href: 'https://chromedevtools.github.io/devtools-protocol/',
    what: '`Target.createBrowserContext`, `Runtime.callFunctionOn`, `DOM.getContentQuads`, `Input.dispatchMouseEvent`',
  },
  {
    title: 'W3C WebDriver',
    href: 'https://www.w3.org/TR/webdriver2/',
    what: 'ошибка `stale element reference` — с ней сравнивается локатор',
  },
];

export const RELATED =
  'Смежное на сайте: [Тест-раннеры изнутри](/tooling/test-runners/) — сбор, хуки, изоляция файлов и утечки между тестами. [Дерево доступности, раздел «Кто считает»](/render/accessibility-tree/#s8) — по какому дереву ищет `getByRole` и где оно расходится с браузером. [События DOM, раздел «Синхронно»](/render/dom-events/#s7) — семь событий настоящего клика против одного у `el.click()`. [Анимации, раздел «CSS, `element.animate`, `requestAnimationFrame`»](/render/animations/#s4) — кадры, по которым Playwright судит о стабильности. [Архитектура браузера, раздел «Каталог процессов»](/js/browser-architecture/#s2) — процесс браузера и рендереры, которыми управляет тест.';
