import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { IslandSpec, LabMode, StandPage } from '@/widgets/islands-lab/model/types';

/**
 * Данные темы «Острова и resumability: Astro против гидратации».
 *
 * Тема написана здесь, 2026-10-01. Стенд — сам этот сайт: он собран на островах Astro.
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * Astro **7.3.2**, `@astrojs/vue` 7.0.2, Vue 3.5.42, React 19.3.0 (`@astrojs/react` 6.0.5) — из
 * `node_modules` проекта. Node 24.11.0, Chromium 153.0.8010.12 (Playwright 1.63), октябрь 2026.
 *
 * 1. **Собранный сайт.** Снимок `dist/` сборки владельца (2026-10-01 14:05) скопирован в каталог
 *    стенда; `astro build` стенд не запускал. Скрипт прошёл все `index.html`: 108 страниц,
 *    77 с островами, 190 островов — **все** `client:visible`. Для каждой страницы разобраны
 *    атрибуты `<astro-island>` и пропсы, а граф чанков собран чтением статических `import … from`
 *    в `dist/_astro/*.js`. Встроенные в страницу скрипты Astro — 372 байта директивы `visible`
 *    и 4 380 байт самого `<astro-island>` — совпадают посимвольно с `*.prebuilt.js` из пакета.
 *    Пропсы: на `/frameworks/react-hooks-internals/` атрибуты `props` трёх островов — 94 118 байт
 *    из 268 473 байт HTML, и в каждом лежит одна и та же строка `code` в 26 893 байта.
 *
 * 2. **Прокрутка в Chromium.** Свой `node:http`-сервер раздаёт снимок `dist/` (порты 50800–50826),
 *    окно 1280×800. Страница грузится до `networkidle`, затем прокручивается шагом 800 px до
 *    конца; после каждого шага пауза до `networkidle`. Записано: какие `.js` запросил браузер
 *    и у каких островов пропал атрибут `ssr`. Верх и высота острова — `getBoundingClientRect`
 *    его дочерних элементов до прокрутки и после того, как ожили все. Это `STAND_PAGES`:
 *    `/js/event-loop/` и `/frameworks/react-vs-vue/`. Вторая запись (`traceLoad`) — та же
 *    страница, где сервер на лету заменил `client="visible"` на `client="load"` и вставил
 *    встроенный скрипт директивы `load` из пакета; `traceIdle` — то же для
 *    `client:idle`. Запись «как собрано» снята двумя разными скриптами — совпала.
 *    Нормализовано: из адресов убран префикс `/_astro/`, списки файлов отсортированы (порядок
 *    параллельных запросов не детерминирован).
 *
 * 3. **Директивы.** Отдельная страница собрана из настоящих встроенных скриптов Astro
 *    (`astro/dist/runtime/server/astro-island.prebuilt.js`, `runtime/client/*.prebuilt.js`)
 *    и разметки в формате сборки: пропсы записаны настоящим `serializeProps`, у острова
 *    с детьми — `await-children` и `<!--astro:end-->`. Компоненты — пустые модули, рендерер
 *    записывает, когда его позвали и какие пропсы пришли. Окно 1280×800 и 500×800. Это
 *    `DIRECTIVE_STAND`. Без `await-children` на первом прогоне не ожил **ни один**
 *    `client:visible`: элемент создаётся парсером раньше своих детей, и наблюдать было не за чем.
 *    Время запросов относительно `DOMContentLoaded` — `performance.getEntriesByType`, три прогона:
 *    `load`, `only` и совпавший `media` запрошены до него, `visible` в первом экране и `idle` —
 *    после `load`. Это порядок, а не миллисекунды: они в текст не идут.
 *
 * 4. **Пропсы в браузере.** Тот же стенд передал острову `client:load` значения всех типов
 *    из `PROP_ROWS`; что пришло в рендерер, совпало с таблицей (флаги RegExp потеряны, функция
 *    и Symbol стали `null`, экземпляр класса — обычным объектом).
 *
 * **Не запуском, а по документации и исходникам:**
 *   — Qwik на стенде не установлен (пакеты ставить нельзя). Всё о Qwik в теме — по документации
 *     qwik.dev и помечено в тексте; `RESUME_CODE` — учебная модель идеи, не код Qwik;
 *   — что `setup(app)` из `appEntrypoint` у Vue-островов вызывается для каждого острова —
 *     по `@astrojs/vue/dist/client.js` (тест держит это место в исходнике);
 *   — `server:defer` (серверные острова) — по документации Astro, на сайте не используется.
 *
 * Что пересобирается тестом `tests/unit/islands.test.ts` без `dist/`: `PLAN_CODE` против
 * записи Chromium на обеих страницах и на стенде директив; `REVIVE_CODE` против настоящих
 * `serializeProps` и восстановителя из `astro-island.js`; `VISIBLE_SOURCE` и размеры встроенных
 * скриптов против пакета; `RESUME_CODE` и `LATE_CODE` — в happy-dom и Node. Если `dist/` есть,
 * отдельный блок проверяет инварианты сборки (а не числа, которые меняются с каждой темой).
 *
 * Найдено попутно и передано владельцу (в тексте — как общие тонкие места, без имён файлов
 * курса): сторож `tests/e2e/weight.spec.ts` считает только файлы, на которые ссылается HTML,
 * и видит у `/frameworks/react-vs-vue/` 16 КБ вместо 354 КБ; остров `MicroProbe` на
 * `/js/event-loop/` при гидратации вырастает с 700 до 2 606 px и сдвигает всё ниже.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'остров',
    d: 'Интерактивный кусок страницы, у которого своё маленькое приложение и своё время оживания. Всё вокруг острова — обычный HTML без кода.',
  },
  {
    k: 'полная гидратация',
    d: 'Страница — одно приложение. В браузер едет код всех компонентов, и каждый ещё раз выполняется, чтобы фреймворк забрал готовую разметку себе.',
  },
  {
    k: '`<astro-island>`',
    d: 'Пользовательский элемент, которым Astro оборачивает каждый остров. В его атрибутах записано, где взять код, чем оживлять, с какими пропсами и когда.',
  },
  {
    k: 'рендерер',
    d: 'Модуль интеграции фреймворка, который умеет оживить компонент в элементе. У Vue это несколько строк вокруг `createSSRApp(…).mount(элемент, true)`.',
  },
  {
    k: 'директива `client:*`',
    d: 'Пометка у компонента в шаблоне Astro: `client:load`, `client:idle`, `client:visible`, `client:media`, `client:only`. Решает, **когда** браузер скачает код острова.',
  },
  {
    k: 'resumability',
    d: 'Возобновляемость: браузер не повторяет рендер, а продолжает с состояния, которое сервер записал в HTML. Код обработчика скачивается, когда случилось событие. Так устроен Qwik.',
  },
];

export const PLAIN_ISLANDS =
  'Как музей с интерактивными стендами. Залы с табличками — это HTML: их читают, и никого для этого не нужно. Возле стенда стоит смотритель, и вызывают его, когда к стенду подошёл посетитель. Полная гидратация — это когда в каждый зал с утра отправляют экскурсовода, и он сначала молча перечитывает все таблички, чтобы знать, что где висит.';

export const PREREQ_NOTE =
  'Тема опирается на три вещи из других тем и на одну, которой на сайте нет, — она объяснена прямо на карточке.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'Гидратация',
    d: 'Сервер прислал HTML, а фреймворк в браузере ещё раз рендерит те же компоненты и забирает готовые узлы себе, навешивая обработчики. До конца гидратации кнопки выглядят живыми, но не работают.',
    href: '/frameworks/ssr-hydration/#s2',
    hrefLabel: '«SSR и гидратация», раздел «Гидратация»',
    tone: 'info',
  },
  {
    t: 'Чанки и `import()`',
    d: 'Сборщик режет код на файлы-чанки. Общий код двух модулей уходит в отдельный чанк, и оба импортируют его. `import()` загружает модуль по требованию, а браузер скачивает каждый адрес один раз на страницу.',
    href: '/tooling/bundler-internals/#s4',
    hrefLabel: '«Бандлер изнутри», раздел «Чанки»',
    tone: 'info',
  },
  {
    t: '`IntersectionObserver` и `requestIdleCallback`',
    d: 'Первый сообщает, что элемент пересёк окно, — проверка идёт шагом кадра, после раскладки. Второй зовёт функцию, когда у главного потока выдалась свободная минута.',
    href: '/render/render-pipeline/#s1',
    hrefLabel: '«Кадр браузера», раздел «Кадр по шагам»',
    tone: 'info',
  },
  {
    t: 'Пользовательский элемент',
    d: 'Свой тег, которому скрипт дал поведение: `customElements.define(\'astro-island\', класс)`. Когда такой тег попадает в документ, браузер вызывает у него `connectedCallback`. Парсер делает это сразу после открывающего тега — **до** того, как разобрал детей.',
    tone: 'info',
  },
];

// ─── Раздел 1. Целиком или кусками ─────────────────────────────────────────────────────────

export const COMPARE = {
  head: ['', 'полная гидратация', 'острова Astro'],
  rows: [
    ['какой код едет в браузер', 'всех компонентов страницы, включая статичный текст', 'только интерактивных кусков; текст вокруг — HTML без кода'],
    ['что выполняется на старте', 'рендер всего дерева заново — чтобы найти, к чему привязать обработчики', 'ничего, пока директива острова не скажет «пора»'],
    ['сколько приложений', 'одно на страницу', 'по одному на остров, даже если фреймворк тот же'],
    ['контекст, `provide`, общий стор фреймворка', 'видны во всём дереве', 'не переходят границу острова'],
    ['где ломается гидратация', 'в любом месте — и чинить приходится корень', 'внутри одного острова; соседи не замечают'],
  ],
  cols: 'minmax(170px,.8fr) minmax(220px,1fr) minmax(220px,1fr)',
  kinds: ['prose', 'muted', 'prose'] as ('prose' | 'muted')[],
  minWidth: 640,
};

/** Сайт как стенд: снято скриптом по снимку `dist/` (см. шапку). */
export const SITE = {
  pages: 108,
  islandPages: 77,
  islands: 190,
  /** Встроенные в каждую страницу с островами скрипты Astro, байты. */
  inlineVisible: 372,
  inlineIsland: 4380,
};

export const SITE_FACTS: { t: string; d: string; tone?: 'ok' | 'warn' | 'info' }[] = [
  {
    t: '190 островов, все `client:visible`',
    d: 'На 108 страницах сайта 77 с островами. Каждое демо — остров, который ждёт, пока его прокрутят до окна. Остальное — заголовки, текст, таблицы, листинги кода — пришло готовым HTML, и кода у него нет.',
  },
  {
    t: 'На старте — ноль запросов за скриптами',
    d: 'Открыли `/js/event-loop/` — браузер не запросил ни одного `.js`. Работает только встроенное в HTML: 372 байта директивы `visible` и 4 380 байт определения `<astro-island>`. Демо далеко внизу, и их код ещё не нужен.',
    tone: 'ok',
  },
  {
    t: 'Первый остров платит за всех',
    d: 'Когда первое демо показалось в окне, браузер скачал 15 файлов, 127 577 байт. Из них 109 839 — рантайм Vue. Следующие четыре острова той же страницы стоили 3 079, 28 559, 16 702 и 2 819 байт: рантайм уже скачан.',
    tone: 'info',
  },
];

// ─── Раздел 2. <astro-island> ──────────────────────────────────────────────────────────────

/** Настоящий остров со страницы `/frameworks/react-vs-vue/`; переносы между атрибутами и сокращение разметки — для печати. */
export const ISLAND_HTML = `<astro-island
  uid="Z1gqlY1"
  prefix="s1"
  component-url="/_astro/VuePane.55zLwSc6.js"
  component-export="default"
  renderer-url="/_astro/client.CCGqtgYw.js"
  props="{&quot;data-astro-cid-kkvr322g&quot;:[0,true]}"
  ssr
  client="visible"
  opts="{&quot;name&quot;:&quot;VuePane&quot;,&quot;value&quot;:true}"
  await-children>
  <section class="tm-pane" data-astro-cid-kkvr322g="true">…серверная разметка…</section>
  <!--astro:end-->
</astro-island>`;

export const ISLAND_ATTRS: { k: string; d: string }[] = [
  { k: 'component-url', d: 'Чанк компонента. Браузер загрузит его через `import()` — когда скажет директива.' },
  { k: 'component-export', d: 'Имя экспорта в этом чанке. Обычно `default`.' },
  { k: 'renderer-url', d: 'Рендерер фреймворка: у Vue-островов один, у React — другой. Два фреймворка на странице — два рендерера и два рантайма.' },
  { k: 'props', d: 'Пропсы компонента, записанные строкой JSON с тегами типов. У этого острова единственный «пропс» — служебный атрибут, которым Astro помечает стили родителя.' },
  { k: 'ssr', d: 'Признак «внутри серверная разметка, остров ещё не ожил». Рендерер снимет его после гидратации — по нему стенд и узнавал ожившие острова.' },
  { k: 'client', d: 'Директива: `load`, `idle`, `visible`, `media` или `only`.' },
  { k: 'opts', d: 'Имя компонента и значение директивы. У голого `client:visible` значение — `true`, у `client:media` — строка запроса.' },
  { k: 'await-children', d: 'У острова есть дети, и их нужно дождаться. Сигнал «дети на месте» — комментарий `<!--astro:end-->` последним узлом.' },
  { k: 'uid, prefix', d: 'Метка острова и префикс для `useId` во Vue и React: два острова не выдадут одинаковых `id`.' },
];

export const LIFECYCLE: { k: string; d: string }[] = [
  {
    k: 'Элемент подключён',
    d: 'Встроенный скрипт уже определил `<astro-island>`, поэтому парсер создаёт его по открывающему тегу и сразу зовёт `connectedCallback`. Детей ещё нет. С `await-children` остров ждёт `<!--astro:end-->` или `DOMContentLoaded`.',
  },
  {
    k: 'Директива решает',
    d: 'Остров читает `client` и ищет функцию `Astro.visible` (или `load`, `idle`…). Её определил другой встроенный скрипт. Если его ещё нет — остров ждёт событие `astro:visible`. Директиве передаются три вещи: функция `load`, `opts` и сам элемент.',
  },
  {
    k: 'Загрузка',
    d: '`load` — это два `import()` разом: чанк компонента и рендерер. Неудачная загрузка повторяется один раз через секунду с меткой `astro-retry` в адресе.',
  },
  {
    k: 'Пропсы',
    d: 'Атрибут `props` разбирается `JSON.parse`, потом теги превращаются обратно в `Date`, `Map`, `Set` и остальное — функцией из следующего раздела.',
  },
  {
    k: 'Гидратация',
    d: 'Рендерер оживляет компонент в элементе. Vue: `createSSRApp` и `mount(элемент, true)` — гидратация только внутри этого элемента. Остров вложен в ещё не оживший остров — ждёт, пока оживёт внешний.',
  },
  {
    k: 'Готово',
    d: 'Атрибут `ssr` снят, на элементе событие `astro:hydrate`. Стили `astro-island{display:contents}` всё это время держат элемент невидимым для раскладки: коробки у него нет, есть только у детей.',
  },
];

export const AWAIT_NOTE =
  'Почему `await-children` важен, видно на стенде. Пока атрибута не было, ни один `client:visible` не ожил — даже в первом экране. Директива следит за **дочерними элементами** острова, а в момент `connectedCallback` их ещё нет: парсер до них не дошёл. Наблюдать было не за чем, и `IntersectionObserver` молчал. Сборка Astro ставит атрибут сама, а вот у разметки, собранной вручную, его легко потерять.';

// ─── Раздел 3. Пропсы ──────────────────────────────────────────────────────────────────────

export const PLAIN_PROPS =
  'Как опись к посылке с разобранной мебелью. В коробке — доски и винты, то есть JSON. В описи — «это шкаф», и по ней на месте собирают шкаф обратно. Что в опись не попало, собрать нельзя: инструкцию к шкафу, то есть методы класса, в коробку не положить.';

/** Восстановление пропсов — то же, что делает `<astro-island>` в браузере. Тест сверяет его с настоящим. */
export const REVIVE_CODE = `// Каждое значение едет парой [тег, данные]. Тег — во что собрать обратно.
const REVIVERS = {
  0: (v) => reviveObject(v),          // обычное значение или объект
  1: (v) => reviveArray(v),           // массив
  2: (v) => new RegExp(v),            // только source: флагов здесь нет
  3: (v) => new Date(v),
  4: (v) => new Map(reviveArray(v)),
  5: (v) => new Set(reviveArray(v)),
  6: (v) => BigInt(v),
  7: (v) => new URL(v),
  8: (v) => new Uint8Array(v),
  9: (v) => new Uint16Array(v),
  10: (v) => new Uint32Array(v),
  11: (v) => Infinity * v,            // 1 или -1
};

function revive([tag, value]) {
  return tag in REVIVERS ? REVIVERS[tag](value) : undefined;
}

function reviveArray(raw) {
  return raw.map(revive);
}

function reviveObject(raw) {
  if (typeof raw !== 'object' || raw === null) return raw;
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, revive(v)]));
}

// Значение атрибута props — уже без &quot;: их снял парсер HTML.
function reviveProps(attr) {
  return reviveObject(JSON.parse(attr));
}`;

/**
 * Что переживает дорогу от сборки до компонента. `expr` исполняется тестом: сериализуется
 * настоящим `serializeProps` и восстанавливается и `REVIVE_CODE`, и восстановителем из
 * `astro-island.js`. `wire` — то, что лежит в атрибуте (без экранирования HTML).
 */
export const PROP_ROWS: { id: string; expr: string; wire: string; got: string; tone?: 'warn' | 'err' }[] = [
  { id: 'plain', expr: "'текст'", wire: '[0,"текст"]', got: 'как есть; так же числа, `true`/`false`, `null`' },
  { id: 'undef', expr: 'undefined', wire: '[0]', got: '`undefined`, ключ на месте' },
  { id: 'nan', expr: 'NaN', wire: '[0,null]', got: '`null`', tone: 'warn' },
  { id: 'inf', expr: 'Infinity', wire: '[11,1]', got: '`Infinity`' },
  { id: 'big', expr: '10n', wire: '[6,"10"]', got: '`10n`' },
  { id: 'date', expr: "new Date('2026-10-01T12:00:00Z')", wire: '[3,"2026-10-01T12:00:00.000Z"]', got: '`Date`' },
  { id: 're', expr: '/ab+c/gi', wire: '[2,"ab+c"]', got: '`/ab+c/` — **флаги потеряны**', tone: 'err' },
  { id: 'map', expr: "new Map([['k', 1]])", wire: '[4,[[1,[[0,"k"],[0,1]]]]]', got: '`Map`' },
  { id: 'set', expr: 'new Set([1, 2])', wire: '[5,[[0,1],[0,2]]]', got: '`Set`' },
  { id: 'url', expr: "new URL('https://example.com/a')", wire: '[7,"https://example.com/a"]', got: '`URL`' },
  { id: 'u8', expr: 'new Uint8Array([1, 255])', wire: '[8,[1,255]]', got: '`Uint8Array`' },
  { id: 'f64', expr: 'new Float64Array([1.5])', wire: '[0,{"0":[0,1.5]}]', got: 'обычный объект `{ 0: 1.5 }`', tone: 'warn' },
  { id: 'nested', expr: '{ when: new Date(0) }', wire: '[0,{"when":[3,"1970-01-01T00:00:00.000Z"]}]', got: 'объект, внутри `Date`: теги ставятся на любой глубине' },
  { id: 'fn', expr: '() => 1', wire: '[0,null]', got: '`null`', tone: 'err' },
  { id: 'sym', expr: "Symbol('s')", wire: '[0,null]', got: '`null`', tone: 'err' },
  { id: 'class', expr: 'new Point(1, 2)', wire: '[0,{"x":[0,1],"y":[0,2]}]', got: 'обычный объект: поля есть, методов нет, `instanceof Point` — `false`', tone: 'err' },
  { id: 'cycle', expr: 'loop', wire: '—', got: 'сборка падает: `Cyclic reference detected`', tone: 'warn' },
];

/** Класс и цикл для строк `class` и `cycle`: тест объявляет их так же. */
export const PROP_SETUP_CODE = `class Point {
  constructor(x, y) { this.x = x; this.y = y; }
  length() { return Math.hypot(this.x, this.y); }
}
const loop = {};
loop.self = loop;`;

export const PROPS_NOTE =
  'Пропсы — **вторая копия** данных. Серверная разметка острова уже нарисована из тех же данных, а пропсы едут рядом, чтобы компонент в браузере нарисовал то же самое и не разошёлся с HTML. На `/frameworks/react-hooks-internals/` три острова получают одну и ту же строку кода в 26 893 байта, и в HTML она лежит трижды: атрибуты `props` там — 94 118 байт из 268 473, больше трети страницы.';

// ─── Раздел 4. Директивы ───────────────────────────────────────────────────────────────────

export const DIRECTIVE_ROWS: { k: string; when: string; how: string; stand: string }[] = [
  {
    k: '`client:load`',
    when: 'сразу, как разобран остров',
    how: '`load()` без условий',
    stand: 'запрос ушёл ещё до `DOMContentLoaded`',
  },
  {
    k: '`client:idle`',
    when: 'когда у потока свободное время',
    how: '`requestIdleCallback`; если его нет — `setTimeout` на 200 мс. `client:idle={{ timeout: 500 }}` — не позже чем через 500 мс',
    stand: 'после события `load`',
  },
  {
    k: '`client:visible`',
    when: 'когда дочерний элемент острова пересёк окно',
    how: '`IntersectionObserver` на **каждого ребёнка**, после первого пересечения отключается. `client:visible={{ rootMargin: \'400px\' }}` — раньше на 400 px',
    stand: 'в первом экране — после первой отрисовки; ниже — при прокрутке; с `rootMargin` — на 400 px раньше',
  },
  {
    k: '`client:media`',
    when: 'когда совпал медиазапрос',
    how: '`matchMedia(запрос)`: совпал — сразу, нет — ждёт одного события `change`',
    stand: 'при ширине 500 — до `DOMContentLoaded`; при 1280 — только после сужения окна',
  },
  {
    k: '`client:only`',
    when: 'сразу, как `load`',
    how: 'на сборке компонент не рендерится вовсе; в браузере рендерер **монтирует**, а не гидратирует: у Vue `createApp` вместо `createSSRApp`',
    stand: 'запрос до `DOMContentLoaded`; до него на месте острова пусто',
  },
];

/** Директива `client:visible` целиком — `astro/dist/runtime/client/visible.js` 7.3.2 без строк экспорта. */
export const VISIBLE_SOURCE = `const visibleDirective = (load, options, el) => {
  const cb = async () => {
    const hydrate = await load();
    await hydrate();
  };
  const rawOptions = typeof options.value === "object" ? options.value : void 0;
  const ioOptions = {
    rootMargin: rawOptions?.rootMargin
  };
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      io.disconnect();
      cb();
      break;
    }
  }, ioOptions);
  for (const child of el.children) {
    io.observe(child);
  }
};`;

export const VISIBLE_NOTE =
  'Последний цикл — главное в этой директиве. Наблюдают не за `<astro-island>`: у него `display: contents`, своей коробки нет, и пересекать окно ему нечем. Наблюдают за его **детьми-элементами**. Отсюда два острова на стенде, которые не ожили никогда: у одного внутри только текст — `el.children` пуст; у другого единственный ребёнок скрыт `display: none` — его прямоугольник нулевой и окно он не пересекает.';

/**
 * Стенд директив (см. шапку, п. 3). Верх и высота — первый дочерний элемент острова, окно 800.
 * `files` — корневой модуль компонента; рендерер у всех один и в расчёте не нужен.
 */
export const DIRECTIVE_STAND: {
  islands: IslandSpec[];
  scrolls: number[];
  runs: { width: number; matches: boolean; steps: { y: number; islands: string[] }[] }[];
} = {
  islands: [
    { id: 'load', client: 'load', value: '', top: 8, ssrHeight: 100, liveHeight: 100, files: ['load.js'] },
    { id: 'idle', client: 'idle', value: '', top: 108, ssrHeight: 100, liveHeight: 100, files: ['idle.js'] },
    { id: 'media', client: 'media', value: '(max-width: 600px)', top: 208, ssrHeight: 100, liveHeight: 100, files: ['media.js'] },
    { id: 'only', client: 'only', value: '', top: 0, ssrHeight: 0, liveHeight: 0, files: ['only.js'] },
    { id: 'visible-top', client: 'visible', value: true, top: 308, ssrHeight: 100, liveHeight: 100, files: ['visible-top.js'] },
    { id: 'visible-text', client: 'visible', value: true, top: 0, ssrHeight: 0, liveHeight: 0, files: ['visible-text.js'] },
    { id: 'visible-hidden', client: 'visible', value: true, top: 0, ssrHeight: 0, liveHeight: 0, files: ['visible-hidden.js'] },
    { id: 'visible-far', client: 'visible', value: true, top: 2426, ssrHeight: 100, liveHeight: 100, files: ['visible-far.js'] },
    { id: 'visible-margin', client: 'visible', value: { rootMargin: '400px' }, top: 2526, ssrHeight: 100, liveHeight: 100, files: ['visible-margin.js'] },
  ],
  scrolls: [1400, 1700],
  runs: [
    {
      width: 1280,
      matches: false,
      steps: [
        { y: 0, islands: ['load', 'only', 'visible-top', 'idle'] },
        { y: 1400, islands: ['visible-margin'] },
        { y: 1700, islands: ['visible-far'] },
      ],
    },
    {
      width: 500,
      matches: true,
      steps: [
        { y: 0, islands: ['load', 'media', 'only', 'visible-top', 'idle'] },
        { y: 1400, islands: ['visible-margin'] },
        { y: 1700, islands: ['visible-far'] },
      ],
    },
  ],
};

export const DIRECTIVE_STAND_ROWS: { k: string; d: string; tone?: 'ok' | 'warn' | 'err' }[] = [
  { k: 'в первом экране, 1280 px', d: '`load`, `only`, `visible` у верхнего края, `idle`. `media` с запросом `(max-width: 600px)` — нет', tone: 'ok' },
  { k: 'прокрутка до 1 400', d: 'остров с `rootMargin: 400px`: его верх на 2 526, низ окна — на 2 200, запас дотянулся', tone: 'ok' },
  { k: 'прокрутка до 1 700', d: 'обычный `visible` на 2 426: низ окна — 2 500', tone: 'ok' },
  { k: 'сужение окна до 500 px', d: '`media`: пришло событие `change`', tone: 'ok' },
  { k: 'никогда', d: '`visible` с текстом без элемента и `visible` со скрытым ребёнком', tone: 'err' },
];

// ─── Раздел 5. Что и когда скачивается ────────────────────────────────────────────────────

/** Расчёт загрузки. Исполняется демо и тестом; тест сверяет его с записью Chromium. */
export const PLAN_CODE = `// Что и когда скачает страница с островами Astro.
// islands: [{ id, client, value, top, ssrHeight, liveHeight, files }]
//   top и высоты — пиксели страницы; files — модуль компонента и рендерер.
// graph:   { 'файл.js': { bytes, imports: ['файл.js', …] } } — статические импорты.
// env:     { viewport, scrolls: [y, …], matches(query) }
function planLoads(islands, graph, env) {
  const fetched = new Set();   // модуль скачивается один раз на страницу
  const live = new Set();      // острова, которые уже ожили
  const steps = [];

  // Модуль тянет за собой всё, что импортирует, — кроме уже скачанного.
  function fetchAll(roots) {
    const out = [];
    const visit = (file) => {
      if (fetched.has(file)) return;
      fetched.add(file);
      out.push(file);
      graph[file].imports.forEach(visit);
    };
    roots.forEach(visit);
    return out;
  }

  function wake(island, step) {
    live.add(island.id);
    const files = fetchAll(island.files);
    step.islands.push(island.id);
    step.files.push(...files);
    step.bytes += files.reduce((sum, f) => sum + graph[f].bytes, 0);
  }

  // Оживший остров меняет высоту — всё, что ниже, съезжает.
  function topOf(island) {
    let shift = 0;
    for (const other of islands) {
      if (live.has(other.id) && other.top < island.top) {
        shift += other.liveHeight - other.ssrHeight;
      }
    }
    return island.top + shift;
  }

  // client:visible следит за дочерними элементами острова.
  // Нулевая высота — следить не за чем: остров не оживёт никогда.
  function inView(island, y) {
    if (island.ssrHeight === 0) return false;
    const margin = parseInt(island.value?.rootMargin ?? '0', 10) || 0;
    const top = topOf(island);
    return top < y + env.viewport + margin && top + island.ssrHeight > y - margin;
  }

  for (const y of [0, ...env.scrolls]) {
    const step = { y, islands: [], files: [], bytes: 0 };
    if (y === 0) {
      // Разбор HTML: load, only и совпавший media — сразу, idle — когда поток свободен.
      for (const i of islands) {
        if (i.client === 'load' || i.client === 'only') wake(i, step);
        if (i.client === 'media' && env.matches(i.value)) wake(i, step);
      }
      for (const i of islands) if (i.client === 'idle') wake(i, step);
    }
    // Ожившие острова двигают соседей — проверяем, пока что-то меняется.
    let changed = true;
    while (changed) {
      changed = false;
      for (const i of islands) {
        if (i.client === 'visible' && !live.has(i.id) && inView(i, y)) {
          wake(i, step);
          changed = true;
        }
      }
    }
    steps.push(step);
  }
  return steps;
}`;

export const STAND_PAGES: StandPage[] = [
  {
    key: 'event-loop',
    route: '/js/event-loop/',
    label: '«Цикл событий»',
    pageHeight: 28740,
    htmlBytes: 190697,
    islands: [
      { id: 'EventLoopTurn', client: 'visible', value: true, top: 3614, ssrHeight: 877, liveHeight: 877, files: ['EventLoopTurn.BsR3SMkP.js', 'client.CCGqtgYw.js'] },
      { id: 'CheckpointDemo', client: 'visible', value: true, top: 8198, ssrHeight: 517, liveHeight: 517, files: ['CheckpointDemo.BzV6RXym.js', 'client.CCGqtgYw.js'] },
      { id: 'MicroProbe', client: 'visible', value: true, top: 10078, ssrHeight: 700, liveHeight: 2606, files: ['MicroProbe.D3lduHqX.js', 'client.CCGqtgYw.js'] },
      { id: 'TimerClamp', client: 'visible', value: true, top: 12758, ssrHeight: 953, liveHeight: 1367, files: ['TimerClamp.Dxk6-e3d.js', 'client.CCGqtgYw.js'] },
      { id: 'NodeLoop', client: 'visible', value: true, top: 16237, ssrHeight: 586, liveHeight: 586, files: ['NodeLoop.BqWfdoBv.js', 'client.CCGqtgYw.js'] },
    ],
    graph: {
      'EventLoopTurn.BsR3SMkP.js': { bytes: 3214, imports: ['runtime-core.esm-bundler.CIbLXjQd.js', '_plugin-vue_export-helper.BDNMzG2s.js', 'CodeListing.BnMaHEW6.js', 'ConsoleView.DUkpgC84.js', 'PlayerToolbar.1fX_4HOS.js', 'QueueView.BhIgeQCr.js', 'StackView.B9oiNPDY.js', 'DemoFrame.Zq4TJu9A.js', 'usePlayer.fRwnifbH.js', 'useStepper.QM_sOVEn.js'] },
      'runtime-core.esm-bundler.CIbLXjQd.js': { bytes: 85367, imports: [] },
      '_plugin-vue_export-helper.BDNMzG2s.js': { bytes: 84, imports: [] },
      'CodeListing.BnMaHEW6.js': { bytes: 817, imports: ['runtime-core.esm-bundler.CIbLXjQd.js', '_plugin-vue_export-helper.BDNMzG2s.js'] },
      'ConsoleView.DUkpgC84.js': { bytes: 1135, imports: ['runtime-core.esm-bundler.CIbLXjQd.js', '_plugin-vue_export-helper.BDNMzG2s.js'] },
      'PlayerToolbar.1fX_4HOS.js': { bytes: 2328, imports: ['runtime-core.esm-bundler.CIbLXjQd.js', '_plugin-vue_export-helper.BDNMzG2s.js', 'ui.DIEeBnsz.js'] },
      'ui.DIEeBnsz.js': { bytes: 4873, imports: ['runtime-core.esm-bundler.CIbLXjQd.js'] },
      'QueueView.BhIgeQCr.js': { bytes: 1253, imports: ['runtime-core.esm-bundler.CIbLXjQd.js', 'runtime-dom.esm-bundler.B73O2axo.js', '_plugin-vue_export-helper.BDNMzG2s.js'] },
      'runtime-dom.esm-bundler.B73O2axo.js': { bytes: 24472, imports: ['runtime-core.esm-bundler.CIbLXjQd.js'] },
      'StackView.B9oiNPDY.js': { bytes: 993, imports: ['runtime-core.esm-bundler.CIbLXjQd.js', '_plugin-vue_export-helper.BDNMzG2s.js'] },
      'DemoFrame.Zq4TJu9A.js': { bytes: 673, imports: ['runtime-core.esm-bundler.CIbLXjQd.js', '_plugin-vue_export-helper.BDNMzG2s.js'] },
      'usePlayer.fRwnifbH.js': { bytes: 599, imports: ['runtime-core.esm-bundler.CIbLXjQd.js', 'useReducedMotion.C8P7bAX7.js'] },
      'useReducedMotion.C8P7bAX7.js': { bytes: 367, imports: ['runtime-core.esm-bundler.CIbLXjQd.js'] },
      'useStepper.QM_sOVEn.js': { bytes: 388, imports: ['runtime-core.esm-bundler.CIbLXjQd.js'] },
      'client.CCGqtgYw.js': { bytes: 1014, imports: ['runtime-core.esm-bundler.CIbLXjQd.js', 'runtime-dom.esm-bundler.B73O2axo.js'] },
      'CheckpointDemo.BzV6RXym.js': { bytes: 3079, imports: ['runtime-core.esm-bundler.CIbLXjQd.js', '_plugin-vue_export-helper.BDNMzG2s.js', 'ui.DIEeBnsz.js', 'ConsoleView.DUkpgC84.js', 'PlayerToolbar.1fX_4HOS.js', 'QueueView.BhIgeQCr.js', 'StackView.B9oiNPDY.js', 'DemoFrame.Zq4TJu9A.js', 'usePlayer.fRwnifbH.js', 'useStepper.QM_sOVEn.js'] },
      'MicroProbe.D3lduHqX.js': { bytes: 27479, imports: ['runtime-core.esm-bundler.CIbLXjQd.js', '_plugin-vue_export-helper.BDNMzG2s.js', 'Md.Cwq0d9Ip.js', 'ui.DIEeBnsz.js', 'CodeListing.BnMaHEW6.js', 'ConsoleView.DUkpgC84.js', 'DemoFrame.Zq4TJu9A.js'] },
      'Md.Cwq0d9Ip.js': { bytes: 695, imports: ['runtime-core.esm-bundler.CIbLXjQd.js', 'format.DnJ71hcm.js', '_plugin-vue_export-helper.BDNMzG2s.js'] },
      'format.DnJ71hcm.js': { bytes: 385, imports: [] },
      'TimerClamp.Dxk6-e3d.js': { bytes: 16702, imports: ['runtime-core.esm-bundler.CIbLXjQd.js', '_plugin-vue_export-helper.BDNMzG2s.js', 'Md.Cwq0d9Ip.js', 'ui.DIEeBnsz.js', 'CodeListing.BnMaHEW6.js', 'ConsoleView.DUkpgC84.js', 'DemoFrame.Zq4TJu9A.js'] },
      'NodeLoop.BqWfdoBv.js': { bytes: 2819, imports: ['runtime-core.esm-bundler.CIbLXjQd.js', '_plugin-vue_export-helper.BDNMzG2s.js', 'ui.DIEeBnsz.js', 'ConsoleView.DUkpgC84.js', 'PlayerToolbar.1fX_4HOS.js', 'DemoFrame.Zq4TJu9A.js', 'usePlayer.fRwnifbH.js', 'useStepper.QM_sOVEn.js'] },
    },
    trace: [
      { y: 0, islands: [], files: [] },
      { y: 3200, islands: ['EventLoopTurn'], files: ['CodeListing.BnMaHEW6.js', 'ConsoleView.DUkpgC84.js', 'DemoFrame.Zq4TJu9A.js', 'EventLoopTurn.BsR3SMkP.js', 'PlayerToolbar.1fX_4HOS.js', 'QueueView.BhIgeQCr.js', 'StackView.B9oiNPDY.js', '_plugin-vue_export-helper.BDNMzG2s.js', 'client.CCGqtgYw.js', 'runtime-core.esm-bundler.CIbLXjQd.js', 'runtime-dom.esm-bundler.B73O2axo.js', 'ui.DIEeBnsz.js', 'usePlayer.fRwnifbH.js', 'useReducedMotion.C8P7bAX7.js', 'useStepper.QM_sOVEn.js'] },
      { y: 8000, islands: ['CheckpointDemo'], files: ['CheckpointDemo.BzV6RXym.js'] },
      { y: 9600, islands: ['MicroProbe'], files: ['Md.Cwq0d9Ip.js', 'MicroProbe.D3lduHqX.js', 'format.DnJ71hcm.js'] },
      { y: 14400, islands: ['TimerClamp'], files: ['TimerClamp.Dxk6-e3d.js'] },
      { y: 18400, islands: ['NodeLoop'], files: ['NodeLoop.BqWfdoBv.js'] },
    ],
    traceLoad: [
      { y: 0, islands: ['EventLoopTurn', 'CheckpointDemo', 'MicroProbe', 'TimerClamp', 'NodeLoop'], files: ['CheckpointDemo.BzV6RXym.js', 'CodeListing.BnMaHEW6.js', 'ConsoleView.DUkpgC84.js', 'DemoFrame.Zq4TJu9A.js', 'EventLoopTurn.BsR3SMkP.js', 'Md.Cwq0d9Ip.js', 'MicroProbe.D3lduHqX.js', 'NodeLoop.BqWfdoBv.js', 'PlayerToolbar.1fX_4HOS.js', 'QueueView.BhIgeQCr.js', 'StackView.B9oiNPDY.js', 'TimerClamp.Dxk6-e3d.js', '_plugin-vue_export-helper.BDNMzG2s.js', 'client.CCGqtgYw.js', 'format.DnJ71hcm.js', 'runtime-core.esm-bundler.CIbLXjQd.js', 'runtime-dom.esm-bundler.B73O2axo.js', 'ui.DIEeBnsz.js', 'usePlayer.fRwnifbH.js', 'useReducedMotion.C8P7bAX7.js', 'useStepper.QM_sOVEn.js'] },
    ],
    traceIdle: [
      { y: 0, islands: ['EventLoopTurn', 'CheckpointDemo', 'MicroProbe', 'TimerClamp', 'NodeLoop'], files: ['CheckpointDemo.BzV6RXym.js', 'CodeListing.BnMaHEW6.js', 'ConsoleView.DUkpgC84.js', 'DemoFrame.Zq4TJu9A.js', 'EventLoopTurn.BsR3SMkP.js', 'Md.Cwq0d9Ip.js', 'MicroProbe.D3lduHqX.js', 'NodeLoop.BqWfdoBv.js', 'PlayerToolbar.1fX_4HOS.js', 'QueueView.BhIgeQCr.js', 'StackView.B9oiNPDY.js', 'TimerClamp.Dxk6-e3d.js', '_plugin-vue_export-helper.BDNMzG2s.js', 'client.CCGqtgYw.js', 'format.DnJ71hcm.js', 'runtime-core.esm-bundler.CIbLXjQd.js', 'runtime-dom.esm-bundler.B73O2axo.js', 'ui.DIEeBnsz.js', 'usePlayer.fRwnifbH.js', 'useReducedMotion.C8P7bAX7.js', 'useStepper.QM_sOVEn.js'] },
    ],
  },
  {
    key: 'react-vs-vue',
    route: '/frameworks/react-vs-vue/',
    label: '«React против Vue»',
    pageHeight: 16208,
    htmlBytes: 118258,
    islands: [
      { id: 'Controls', client: 'visible', value: true, top: 4556, ssrHeight: 65, liveHeight: 65, files: ['Controls.VJtZrBdZ.js', 'client.CCGqtgYw.js'] },
      { id: 'ReactPane', client: 'visible', value: true, top: 4636, ssrHeight: 613, liveHeight: 613, files: ['ReactPane.niBPb5DR.js', 'client.vyypPQp4.js'] },
      { id: 'VuePane', client: 'visible', value: true, top: 4636, ssrHeight: 613, liveHeight: 613, files: ['VuePane.55zLwSc6.js', 'client.CCGqtgYw.js'] },
    ],
    graph: {
      'Controls.VJtZrBdZ.js': { bytes: 1522, imports: ['runtime-core.esm-bundler.CIbLXjQd.js', '_plugin-vue_export-helper.BDNMzG2s.js', 'Md.Cwq0d9Ip.js', 'ui.DIEeBnsz.js', 'bus.DvQz9C0S.js'] },
      'runtime-core.esm-bundler.CIbLXjQd.js': { bytes: 85367, imports: [] },
      '_plugin-vue_export-helper.BDNMzG2s.js': { bytes: 84, imports: [] },
      'Md.Cwq0d9Ip.js': { bytes: 695, imports: ['runtime-core.esm-bundler.CIbLXjQd.js', 'format.DnJ71hcm.js', '_plugin-vue_export-helper.BDNMzG2s.js'] },
      'format.DnJ71hcm.js': { bytes: 385, imports: [] },
      'ui.DIEeBnsz.js': { bytes: 4873, imports: ['runtime-core.esm-bundler.CIbLXjQd.js'] },
      'bus.DvQz9C0S.js': { bytes: 270, imports: [] },
      'client.CCGqtgYw.js': { bytes: 1014, imports: ['runtime-core.esm-bundler.CIbLXjQd.js', 'runtime-dom.esm-bundler.B73O2axo.js'] },
      'runtime-dom.esm-bundler.B73O2axo.js': { bytes: 24472, imports: ['runtime-core.esm-bundler.CIbLXjQd.js'] },
      'ReactPane.niBPb5DR.js': { bytes: 5444, imports: ['bus.DvQz9C0S.js', 'react.iDfmHsyG.js', 'jsx-runtime.CymHavEb.js', 'task.a4k17DAS.js'] },
      'react.iDfmHsyG.js': { bytes: 7876, imports: ['rolldown-runtime.hePW80VL.js'] },
      'rolldown-runtime.hePW80VL.js': { bytes: 716, imports: [] },
      'jsx-runtime.CymHavEb.js': { bytes: 1180, imports: ['rolldown-runtime.hePW80VL.js', 'react.iDfmHsyG.js'] },
      'task.a4k17DAS.js': { bytes: 601, imports: [] },
      'client.vyypPQp4.js': { bytes: 1877, imports: ['react.iDfmHsyG.js', 'client.CXQRFzvJ.js'] },
      'client.CXQRFzvJ.js': { bytes: 207465, imports: ['rolldown-runtime.hePW80VL.js', 'react.iDfmHsyG.js', 'react-dom.C-Lc9Vse.js'] },
      'react-dom.C-Lc9Vse.js': { bytes: 3900, imports: ['rolldown-runtime.hePW80VL.js', 'react.iDfmHsyG.js'] },
      'VuePane.55zLwSc6.js': { bytes: 6244, imports: ['runtime-core.esm-bundler.CIbLXjQd.js', '_plugin-vue_export-helper.BDNMzG2s.js', 'bus.DvQz9C0S.js', 'task.a4k17DAS.js'] },
    },
    trace: [
      { y: 0, islands: [], files: [] },
      { y: 4000, islands: ['Controls', 'ReactPane', 'VuePane'], files: ['Controls.VJtZrBdZ.js', 'Md.Cwq0d9Ip.js', 'ReactPane.niBPb5DR.js', 'VuePane.55zLwSc6.js', '_plugin-vue_export-helper.BDNMzG2s.js', 'bus.DvQz9C0S.js', 'client.CCGqtgYw.js', 'client.CXQRFzvJ.js', 'client.vyypPQp4.js', 'format.DnJ71hcm.js', 'jsx-runtime.CymHavEb.js', 'react-dom.C-Lc9Vse.js', 'react.iDfmHsyG.js', 'rolldown-runtime.hePW80VL.js', 'runtime-core.esm-bundler.CIbLXjQd.js', 'runtime-dom.esm-bundler.B73O2axo.js', 'task.a4k17DAS.js', 'ui.DIEeBnsz.js'] },
    ],
    traceLoad: [
      { y: 0, islands: ['Controls', 'ReactPane', 'VuePane'], files: ['Controls.VJtZrBdZ.js', 'Md.Cwq0d9Ip.js', 'ReactPane.niBPb5DR.js', 'VuePane.55zLwSc6.js', '_plugin-vue_export-helper.BDNMzG2s.js', 'bus.DvQz9C0S.js', 'client.CCGqtgYw.js', 'client.CXQRFzvJ.js', 'client.vyypPQp4.js', 'format.DnJ71hcm.js', 'jsx-runtime.CymHavEb.js', 'react-dom.C-Lc9Vse.js', 'react.iDfmHsyG.js', 'rolldown-runtime.hePW80VL.js', 'runtime-core.esm-bundler.CIbLXjQd.js', 'runtime-dom.esm-bundler.B73O2axo.js', 'task.a4k17DAS.js', 'ui.DIEeBnsz.js'] },
    ],
    traceIdle: [
      { y: 0, islands: ['Controls', 'ReactPane', 'VuePane'], files: ['Controls.VJtZrBdZ.js', 'Md.Cwq0d9Ip.js', 'ReactPane.niBPb5DR.js', 'VuePane.55zLwSc6.js', '_plugin-vue_export-helper.BDNMzG2s.js', 'bus.DvQz9C0S.js', 'client.CCGqtgYw.js', 'client.CXQRFzvJ.js', 'client.vyypPQp4.js', 'format.DnJ71hcm.js', 'jsx-runtime.CymHavEb.js', 'react-dom.C-Lc9Vse.js', 'react.iDfmHsyG.js', 'rolldown-runtime.hePW80VL.js', 'runtime-core.esm-bundler.CIbLXjQd.js', 'runtime-dom.esm-bundler.B73O2axo.js', 'task.a4k17DAS.js', 'ui.DIEeBnsz.js'] },
    ],
  },
];

export const LAB_MODES: LabMode[] = [
  { value: 'built', label: 'как собрано: visible', client: null },
  { value: 'idle', label: 'все idle', client: 'idle' },
  { value: 'load', label: 'все load', client: 'load' },
];

export const LAB_CAPTION =
  'Все три режима сверены с Chromium: тест прогоняет `planLoads` на этих же данных и сравнивает файлы и острова каждого шага с тем, что браузер запросил при прокрутке. «Все idle» на стенде дал тот же список, что «все load», только позже события `load`: на быстрой машине у потока свободное время находится сразу.';

export const WEIGHT_FACTS: { t: string; d: string; tone?: 'warn' | 'err' | 'info' }[] = [
  {
    t: 'Ссылки из HTML — ещё не вес',
    d: 'В HTML `/frameworks/react-vs-vue/` три острова ссылаются на пять файлов общим весом 16 101 байт. Браузер скачал 18 файлов и 353 985 байт: рантайм React DOM — чанк в 207 465 байт, и на него HTML не ссылается вовсе — его импортирует рендерер. Вес острова — это замыкание его импортов, а не файл из `component-url`.',
    tone: 'err',
  },
  {
    t: 'Высота разметки — часть расписания',
    d: 'Остров `MicroProbe` на `/js/event-loop/` пришёл с сервера высотой 700 px, а ожив, стал 2 606 px. Всё ниже съехало на 1 906 px, и следующий остров ожил при прокрутке до 14 400 вместо 12 000. Без учёта сдвига расчёт ошибается на три экрана — проверено тестом.',
    tone: 'warn',
  },
  {
    t: 'Директива меняет не байты, а момент',
    d: '«Все load» и «как собрано» качают одни и те же 21 файл и 178 736 байт. Разница в том, что при `client:visible` на старте не скачано ничего, а при `load` — всё, ещё до `DOMContentLoaded`, и вся гидратация лежит на загрузке страницы.',
    tone: 'info',
  },
];

// ─── Раздел 6. Связь между островами ──────────────────────────────────────────────────────

export const BUS_ROWS = {
  head: ['способ', 'между фреймворками', 'остров, оживший позже'],
  rows: [
    ['событие на `window`: `dispatchEvent` и `addEventListener`', 'да — строка с именем события одинакова для всех', 'не узнает, что случилось до его подписки'],
    ['общий модуль-стор: переменная в модуле и подписчики', 'да, если оба импортируют **один и тот же** модуль', 'сразу получает текущее значение'],
    ['стор фреймворка: Pinia, контекст React', 'нет', 'у каждого острова своё приложение — и свой стор'],
    ['адрес и DOM: `?tab=2`, `data-*` на `<body>`', 'да', 'читает при старте, но об изменениях не узнает сам'],
  ],
  cols: 'minmax(200px,1.2fr) minmax(170px,1fr) minmax(200px,1fr)',
  kinds: ['prose', 'muted', 'muted'] as ('prose' | 'muted')[],
  minWidth: 620,
};

/** Сценарий «поздний остров». Тест исполняет его в Node с `window = new EventTarget()`. */
export const LATE_CODE = `// store.js — общий модуль: браузер вычисляет его один раз на адрес,
// поэтому все острова, которые его импортируют, видят одну переменную.
function createStore(initial) {
  let state = initial;
  const subs = new Set();
  return {
    get: () => state,
    set(next) { state = next; subs.forEach((fn) => fn(state)); },
    subscribe(fn) { subs.add(fn); fn(state); return () => subs.delete(fn); },
  };
}

const log = [];
const store = createStore({ pick: null });

// Остров A — в первом экране, ожил сразу и сообщил о выборе.
window.dispatchEvent(new CustomEvent('pick', { detail: 'vue' }));
store.set({ pick: 'vue' });

// Остров B — ниже, ожил при прокрутке и только теперь подписался.
window.addEventListener('pick', (e) => log.push('событие: ' + e.detail));
store.subscribe((s) => log.push('стор: ' + s.pick));`;

export const LATE_LOG = ['стор: vue'];

export const BUS_NOTE =
  'С `client:visible` острова оживают в разное время, и тот, что ниже, ещё не скачан, когда верхний уже что-то сообщает. Событие — это крик в пустую комнату: кто не слушал в ту секунду, не услышал. Стор хранит последнее значение и отдаёт его тому, кто подписался позже. На [«React против Vue»](/frameworks/react-vs-vue/#s2) три острова связаны событием на `window`, и это работает, потому что все трое в одном экране и оживают на одном шаге — стенд записал их вместе.';

export const SHARED_MODULE_NOTE =
  'Общий модуль — одна копия на страницу не по договорённости, а по устройству модулей: браузер держит карту «адрес → модуль» и второй `import` того же адреса отдаёт уже вычисленный. Там же на стенде чанк `bus.DvQz9C0S.js` импортируют и React-остров, и два Vue-острова, а запрошен он один раз. Условие одно: сборщик должен положить модуль в **один** чанк. Если он попадёт копией в два разных чанка, у островов будут две разные переменные — и ни одной ошибки.';

export const PINIA_NOTE =
  'Плагины фреймворка ставятся **на каждый остров отдельно**. У Vue-интеграции есть `appEntrypoint` — файл, где делают `app.use(pinia)`, — и рендерер вызывает его `setup(app)` для каждого острова: так написано в `@astrojs/vue/dist/client.js`. Два острова — два приложения — два экземпляра Pinia, и `useCart()` в них возвращает разные корзины. Документация Astro для общего состояния советует как раз модуль-стор (библиотеку nanostores), а не стор фреймворка.';

// ─── Раздел 7. Resumability ────────────────────────────────────────────────────────────────

export const PLAIN_RESUME =
  'Как сохранение в игре. Гидратация — это перепройти уровень с начала, чтобы оказаться там же, где вы были: все движения повторяются, только быстрее. Возобновление — загрузить сохранение: игра сразу стоит в нужной точке, а код противника подгружается, когда вы его встретили.';

export const QWIK_NOTE =
  'Qwik на стенде не установлен. Всё, что сказано о нём ниже, — по документации qwik.dev; код ниже — учебная модель идеи, а не код Qwik.';

/** Учебная модель: гидратация и возобновление на одной странице. Тест исполняет обе в happy-dom. */
export const RESUME_CODE = `// Страница с сервера. У кнопки записан адрес обработчика, состояние — JSON рядом:
//   <script type="app/state">{"count":5}</script>
//   <button data-component="counter" data-props='{"count":5}'
//           data-on-click="counter.js#inc">5</button>

// Гидратация: на старте выполнить код каждого компонента,
// чтобы найти, к чему привязать обработчики.
async function hydrate(doc, importModule) {
  for (const el of doc.querySelectorAll('[data-component]')) {
    const module = await importModule(el.dataset.component + '.js');
    module.setup(el, JSON.parse(el.dataset.props));   // рендер ещё раз, в браузере
  }
}

// Возобновление: на старте — один слушатель на весь документ, и всё.
function resume(doc, importModule) {
  const state = JSON.parse(doc.querySelector('script[type="app/state"]').textContent);
  doc.addEventListener('click', async (event) => {
    const el = event.target.closest('[data-on-click]');
    if (!el) return;
    const [url, name] = el.dataset.onClick.split('#');
    const module = await importModule(url);           // код приезжает по клику
    module[name](state, el);
  });
}`;

/** Счёт по модели на странице из трёх счётчиков; закреплён тестом. */
export const RESUME_ROWS = {
  head: ['', 'вызовов `setup` на старте', 'модулей до первого клика', 'что стоит первый клик'],
  rows: [
    ['гидратация', '3', '1 — компонент, общий для трёх кнопок', 'ничего: обработчик уже на месте'],
    ['возобновление', '0', '0', 'загрузка модуля обработчика; счёт продолжается с 5 — с числа из HTML'],
  ],
  cols: 'minmax(130px,.7fr) minmax(130px,.8fr) minmax(170px,1fr) minmax(220px,1.3fr)',
  kinds: ['prose', 'muted', 'muted', 'muted'] as ('prose' | 'muted')[],
  minWidth: 660,
};

export const QWIK_FACTS: { t: string; d: string; tone?: 'warn' | 'info' }[] = [
  {
    t: 'Один слушатель на документ',
    d: 'По документации Qwik, на старте работает только qwikloader — встроенный скрипт около килобайта. Он вешает глобальные слушатели событий и по атрибуту элемента узнаёт, какой чанк и какой экспорт загрузить. Компоненты при загрузке страницы не выполняются вовсе.',
  },
  {
    t: 'Обработчик — отдельный чанк',
    d: 'Оптимизатор Qwik режет код по знаку `$`: `onClick$`, `component$`. Каждый такой кусок становится отдельным модулем со своим адресом, и этот адрес сервер пишет прямо в разметку.',
  },
  {
    t: 'Состояние лежит в HTML',
    d: 'Всё, что обработчик захватил из замыкания, сервер сериализует в страницу. Отсюда те же ограничения, что у пропсов острова, только на всё приложение: в замыкание нельзя взять то, что не переживёт JSON.',
    tone: 'warn',
  },
  {
    t: 'Первый клик ждёт сети',
    d: 'Цена подхода — модуль обработчика ещё не скачан, когда по кнопке уже нажали. Qwik закрывает это предзагрузкой чанков в фоне. Без неё возобновление на медленной сети отвечает на клик заметно позже, чем гидратированная страница.',
    tone: 'warn',
  },
];

export const RESUME_SUMMARY =
  '**Острова уменьшают, что гидратировать; возобновление убирает сам повторный рендер.** Остров Astro внутри — обычная гидратация: когда директива сказала «пора», компонент выполняется целиком, а его рантайм скачивается весь. Qwik не выполняет компонент вовсе, пока тот не понадобится для изменения, и скачивает код по одному обработчику.';

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: '`client:visible` без элемента внутри не оживёт никогда',
    d: 'Директива следит за дочерними **элементами** острова. Компонент, который рендерит только текст, или единственный ребёнок с `display: none` (меню, скрытое на телефоне) — наблюдать не за чем, остров молча остаётся мёртвым. На стенде оба таких острова не ожили ни при какой прокрутке.',
    tone: 'err',
  },
  {
    n: '02',
    t: 'Разметка с сервера другой высоты — сдвиг и сбитое расписание',
    d: 'Остров вырос при гидратации на 1 906 px — всё ниже съехало, а соседи ожили на три экрана позже расчёта. Если сдвиг пришёлся на окно, это ещё и CLS. Серверная разметка обязана занимать столько же места, сколько живая: заглушка нужной высоты, а не пустой блок.',
    tone: 'warn',
  },
  {
    n: '03',
    t: 'Вес по `component-url` занижает в разы',
    d: 'HTML ссылается на чанк компонента и рендерер, а рантайм фреймворка они импортируют сами. Счёт по ссылкам дал 16 101 байт там, где браузер скачал 353 985. Мерить надо замыкание импортов — или запросы в браузере.',
    tone: 'err',
  },
  {
    n: '04',
    t: 'Пропсы: флаги RegExp, функции, классы',
    d: 'Регулярное выражение приезжает без флагов, функция и `Symbol` — `null`, `NaN` — `null`, экземпляр класса — голым объектом без методов, `Float64Array` — объектом с ключами `"0"`, `"1"`. Ошибки нет ни на сборке, ни в браузере. Падает сборка только на цикле.',
    tone: 'err',
  },
  {
    n: '05',
    t: 'Каждый остров получает свою копию пропсов',
    d: 'Один и тот же большой объект трём островам — три копии в HTML: в теме про хуки строка кода в 26 893 байта лежит в странице трижды. Данные, нужные нескольким островам, дешевле положить один раз — в общий модуль или в `<script type="application/json">`.',
    tone: 'warn',
  },
  {
    n: '06',
    t: 'Событие до подписки потеряно',
    d: 'Остров ниже ещё не скачан, когда верхний сообщает о выборе. Событие на `window` до него не дойдёт — ни ошибки, ни предупреждения. Нужно состояние, которое помнит последнее значение: модуль-стор.',
    tone: 'err',
  },
  {
    n: '07',
    t: 'Стор фреймворка — свой у каждого острова',
    d: '`app.use(pinia)` в `appEntrypoint` выполняется для каждого Vue-острова: две корзины вместо одной. Контекст React и `provide` во Vue тоже не переходят границу острова. Общее состояние — в модуле вне фреймворка.',
    tone: 'warn',
  },
  {
    n: '08',
    t: '`client:only` — пустое место до загрузки',
    d: 'Без серверной разметки на месте острова ничего нет, пока не скачан код: контента нет у поисковика и у читателя с медленной сетью, а появление сдвигает страницу. `client:only` нужен там, где компонент не может отрендериться на сервере, — а не для того, чтобы «сэкономить».',
    tone: 'warn',
  },
];

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'Astro — Islands architecture',
    href: 'https://docs.astro.build/en/concepts/islands/',
    what: 'острова, клиентские и серверные (`server:defer`)',
  },
  {
    title: 'Astro — Template directives reference',
    href: 'https://docs.astro.build/en/reference/directives-reference/',
    what: '`client:load`, `idle`, `visible`, `media`, `only`, опции `timeout` и `rootMargin`',
  },
  {
    title: 'Astro — Front-end frameworks',
    href: 'https://docs.astro.build/en/guides/framework-components/',
    what: 'какие типы пропсов можно передать острову',
  },
  {
    title: 'Astro — Share state between islands',
    href: 'https://docs.astro.build/en/recipes/sharing-state-islands/',
    what: 'общий стор вне фреймворка (nanostores) вместо стора фреймворка',
  },
  {
    title: 'Исходник: `astro-island.ts` и `serialize.ts`',
    href: 'https://github.com/withastro/astro/tree/main/packages/astro/src/runtime/server',
    what: 'элемент `<astro-island>`, теги пропсов; на стенде — Astro 7.3.2 из `node_modules`',
  },
  {
    title: 'Jason Miller — Islands Architecture',
    href: 'https://jasonformat.com/islands-architecture/',
    what: 'статья 2020 года, откуда идёт термин',
  },
  {
    title: 'Qwik — Resumable vs. Hydration',
    href: 'https://qwik.dev/docs/concepts/resumable/',
    what: 'идея возобновления; по ней написан раздел о Qwik (не запуском)',
  },
  {
    title: 'Intersection Observer (W3C)',
    href: 'https://w3c.github.io/IntersectionObserver/',
    what: '`rootMargin`, `isIntersecting`, когда приходит уведомление',
  },
  {
    title: 'requestIdleCallback (W3C)',
    href: 'https://w3c.github.io/requestidlecallback/',
    what: 'когда у потока «свободное время» и что делает `timeout`',
  },
];

export const RELATED =
  'Смежное на сайте: [SSR и гидратация, раздел «Ленивая гидратация»](/frameworks/ssr-hydration/#s5) — `hydrateOnVisible` во Vue откладывает оживление, но не загрузку кода. [Server Components изнутри](/frameworks/server-components/) — компонент, который не гидратируется никогда. [React против Vue, раздел «Одна задача»](/frameworks/react-vs-vue/#s2) — три острова на двух фреймворках и общая шина. [Бандлер изнутри, раздел «Чанки»](/tooling/bundler-internals/#s4) — откуда берутся общие чанки. [Критический путь, раздел «CLS»](/render/rendering-crp/#s3) — чем платят за сдвиг при гидратации. [Наблюдатели](/render/observers/) — когда срабатывают Intersection-, Resize- и MutationObserver и где браузеры расходятся со спецификацией. [Бюджеты производительности](/tooling/performance-budgets/) — вес страницы по графу чанков и проверка бюджета в CI на примере этого курса.';
