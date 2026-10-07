import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { DemoVariant, HmrGraph, HmrJournal, HmrNode, NodePos } from '@/widgets/hmr-boundary/model/types';

/**
 * Данные темы «HMR изнутри: как правка доезжает до страницы без перезагрузки».
 *
 * Тема написана здесь. До неё предмет висел строкой «HMR изнутри — Отдельная тема — готовится»
 * в «Что осталось за кадром» у «Модулей и сборки». Как dev-сервер отдаёт модули по одному
 * и зачем предбандл зависимостей — разобрано там же, в разделе «Dev не равен prod», и здесь
 * не повторяется: тема начинается с момента, когда файл на диске изменился.
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * Vite **8.3.0** из `node_modules` проекта, поднятый программно (`createServer`, без Astro),
 * по серверу на сценарий, порты 49310–49328; `@vitejs/plugin-vue` 6.0.8 и Vue 3.5.42 для SFC.
 * Chromium 153.0.8010.12 из Playwright 1.63, Node 26.8.2, сентябрь 2026.
 * Фикстура: `index.html` → `main.js` → `App.js` → `Button.js` → `utils.js`, плюс `style.css`
 * из `main.js` и `global.css` через `<link>`. Кнопка в `Button.js` считает клики в модульной
 * переменной — это и есть «состояние», которое переживает или не переживает правку.
 *
 * Как снято, по каждому сценарию:
 *   — страница открывается, по кнопке кликают (счётчик 2–3), в `window` ставится маркер;
 *   — скрипт правит файл на диске и ждёт 1.5 с;
 *   — пишутся: сообщения по WebSocket (`page.on('websocket')`, кадры `framereceived`
 *     и `framesent`), все запросы после правки, журнал dev-сервера (`customLogger`), текст
 *     кнопки и вычисленный стиль. Перезагрузка опознаётся по `window.__boot` — случайному
 *     числу из инлайн-скрипта в `<head>`: после `location.reload()` оно другое.
 *
 * Метка времени в сообщениях заменена на `T`, абсолютный путь в `triggeredBy` — на адрес
 * модуля. Больше ничего в сообщениях не тронуто.
 *
 * ⚠️ Кеш зависимостей стенда (`cacheDir`) вынесен в каталог сценария: по умолчанию Vite пишет
 * его в `node_modules/.vite`, и прогон стенда затёр бы кеш дев-сервера проекта — ровно тот
 * случай «504 Outdated Optimize Dep» из `AGENTS.md`.
 *
 * Не снято, а прочитано в исходнике: алгоритм `propagateUpdate` и `invalidateModule`
 * (`vite/dist/node/chunks/node.js`), код, который `@vitejs/plugin-vue` дописывает в SFC,
 * и обёртка `@vitejs/plugin-react` 5.2.0. Поведение React Fast Refresh со стороны состояния
 * хуков — по документации, в этом проекте рефреш выключен (см. раздел про React).
 *
 * Прод: `vite build` (8.3.0, `minify: false`) той же фикстуры с `hot.data` и `dispose` —
 * в бандле нет `import.meta.hot`, `accept`, `dispose`, `.data`, `/@vite/`; строка
 * `let count = import.meta.hot?.data.count ?? 0` стала `var count = 0`. Отдельная фикстура
 * с голым `import.meta.hot.accept()` собралась в `(void 0).accept();`, исполнение бандла —
 * `TypeError: Cannot read properties of undefined (reading 'accept')`.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'граф модулей',
    d: 'Запись dev-сервера о том, кто кого импортирует. Vite заполняет её, когда браузер запрашивает модули и сервер их переводит: модуль, который никто ещё не запросил, в графе не разобран.',
  },
  {
    k: 'импортёр',
    d: 'Модуль, в котором стоит `import` данного. Если `App.js` импортирует `Button.js`, то `App.js` — импортёр `Button.js`. Поиск границы идёт по импортёрам, то есть от листьев к корню.',
  },
  {
    k: 'граница (boundary)',
    d: 'Модуль, который обещал принять обновление: себя — `import.meta.hot.accept()`, или свою зависимость — `accept(\'./Button.js\', cb)`. На нём подъём от изменённого модуля останавливается.',
  },
  {
    k: '`import.meta.hot`',
    d: 'Объект HMR API, который Vite даёт каждому модулю в разработке: `accept`, `dispose`, `data`, `invalidate`. В продакшен-сборке его нет — выражение заменяется на `undefined`.',
  },
  {
    k: 'полная перезагрузка',
    d: '`location.reload()`: документ загружается заново, вся память страницы — переменные, открытые формы, состояние компонентов — теряется. Запасной выход, когда граница не нашлась.',
  },
  {
    k: 'payload',
    d: 'JSON, который сервер шлёт клиенту Vite по WebSocket: `update` со списком пар «кого уведомить — что импортировать заново» или `full-reload`.',
  },
];

export const PLAIN_HMR =
  'Представьте, что в собранной машине поменяли одну деталь. Можно разобрать и собрать всю машину заново — это перезагрузка страницы. А можно найти ближайший узел, который умеет снимать и ставить эту деталь на ходу, и заменить только его. HMR — это поиск такого узла: сервер знает, какая деталь в какой узел входит, и идёт вверх, пока не найдёт узел с пометкой «меня можно менять на ходу». Не нашёл — машину собирают заново.';

export const PREREQ_NOTE =
  'Тема начинается с момента, когда файл на диске изменился. Как браузер грузит модуль и почему разработка устроена иначе, чем рабочая сборка, здесь считается известным.';

export const PREREQ = [
  {
    t: 'Три фазы модуля и module map',
    d: 'Браузер кеширует модуль по адресу: второй `import` того же адреса вернёт уже исполненный экземпляр и в сеть не пойдёт. Отсюда вся механика `?t=` в этой теме.',
    href: '/tooling/modules/#s1',
    hrefLabel: '«Модули и сборка», раздел «Три фазы»',
    tone: 'info' as const,
  },
  {
    t: 'Dev-сервер отдаёт модули по одному',
    d: 'Vite в разработке не собирает бандл: браузер просит каждый модуль отдельно, сервер переводит его на лету, а зависимости из `node_modules` склеены заранее в кеш предбандла.',
    href: '/tooling/modules/#s6',
    hrefLabel: '«Модули и сборка», раздел «Dev не равен prod»',
    tone: 'info' as const,
  },
  {
    t: 'WebSocket',
    d: 'Долгое двустороннее соединение поверх HTTP-рукопожатия. Здесь по нему сервер сообщает о правке, а клиент — о своём `invalidate()`.',
    href: '/platform/realtime/',
    hrefLabel: '«Долгие соединения»',
    tone: 'info' as const,
  },
  {
    t: 'Хуки находят состояние по порядку вызова',
    d: 'Нужно для раздела про React Fast Refresh: почему смена порядка хуков стирает состояние компонента.',
    href: '/frameworks/react-internals/#s5',
    hrefLabel: '«React изнутри: свой рендерер и хуки», раздел «Хуки»',
    tone: 'info' as const,
  },
];

// ─── Раздел 1. Граф на сервере и метка в адресе ────────────────────────────────────────────

export const PIPELINE_CHIPS = [
  { label: 'файл сохранён' },
  { label: 'вотчер: событие change', tone: 'dashed' as const },
  { label: 'модули этого файла в графе', tone: 'info' as const },
  { label: 'инвалидация вверх по импортёрам', tone: 'info' as const },
  { label: 'поиск границы', tone: 'warn' as const },
  { label: 'сообщение по WebSocket', tone: 'ink' as const },
  { label: 'клиент: dispose → import(…?t=) → accept', tone: 'ok' as const },
];

export const SERVER_FACTS = [
  {
    t: 'Граф знает только сервер',
    d: 'Браузер про связи между модулями серверу ничего не сообщает. Vite собирает граф сам, пока переводит модули: разбирает `import` каждого файла и записывает, кто кого импортирует. Правка ищет границу **по этой записи**, а не по тому, что сейчас исполняется на странице.',
  },
  {
    t: 'Инвалидация идёт дальше границы',
    d: 'Сбросив перевод изменённого модуля, Vite помечает меткой времени и всех его импортёров вверх — останавливается только на том, кто принял эту зависимость явно. Метка нужна, чтобы при следующем переводе импорт этого модуля получил в адрес `?t=`.',
  },
  {
    t: 'Журнал сервера говорит, что случилось',
    d: 'В терминале dev-сервера на каждую правку одна строка: `hmr update /Button.js` — граница найдена, или `page reload utils.js` — не найдена. Это самый дешёвый способ понять, почему страница перезагрузилась.',
  },
];

export const T_PARAM_NOTE =
  'Браузер не умеет «забыть» модуль: запись в module map по адресу `/Button.js` живёт до конца страницы, и повторный `import(\'/Button.js\')` вернёт старый экземпляр, не сходив в сеть. Поэтому клиент Vite импортирует границу по **новому адресу** — `/Button.js?t=1790607857601`. Для браузера это другой модуль. Сервер, переводя его, дописывает ту же метку в импорты помеченных модулей: `Button.js?t=…` импортирует `utils.js?t=…`, и цепочка доходит до изменённого файла. Поэтому при правке `utils.js` с границей в `Button.js` браузер перезапрашивает ровно два адреса — `/Button.js?t=…` и `/utils.js?t=…`; `App.js` и `main.js` остаются прежними.';

export const OLD_COPY_NOTE =
  'Следствие, которое легко пропустить: **старый экземпляр никуда не делся**. `App.js` импортировал `renderButton` из старого `/Button.js`, и его привязка ведёт туда же. После правки новая кнопка показывает `v2:0`, а вызов `renderButton` через `App.js` рисует `v1:3` — старую метку и старый счётчик. Два экземпляра модуля живут одновременно; какой из них сработает, зависит от того, кто позвал. Практический вывод: модуль, принявший себя, обязан сам перерисовать то, что нарисовал, — импортёры по-прежнему держат его старые функции.';

// ─── Раздел 2. Поиск границы ──────────────────────────────────────────────────────────────

export const PLAIN_BOUNDARY =
  'Как заявка в большой конторе. Исполнитель не может сам поменять регламент и несёт бумагу начальнику. Тот либо говорит «беру на себя» — и дальше заявка не идёт, — либо несёт выше. Если бумага дошла до директора, а он тоже не подписал, контору закрывают и открывают заново. И важная деталь: если у исполнителя **два** начальника, согласие одного ничего не решает — бумага идёт и по второй линии, и тупик там закрывает всю контору.';

/**
 * Учебная функция поиска границы. Печатается на странице, исполняется демо и тестом —
 * одна и та же строка. Пересказ `propagateUpdate` и `updateModules` из Vite 8.3.0 без двух
 * веток: частичного принятия экспортов (`acceptExports`) и проверки импорта по кругу.
 */
export const FIND_BOUNDARY_CODE = `// graph: { '/App.js': { imports: ['/Button.js'], accept?: 'self' | ['/Button.js'] }, … }
// changed: адрес изменённого модуля
// opts.invalidated: модуль сам позвал import.meta.hot.invalidate() —
//                   его accept больше не в счёт, подъём идёт к импортёрам
function findBoundary(graph, changed, opts = {}) {
  // Граф хранит, кого модуль импортирует; идти надо в обратную сторону.
  const importers = {};
  for (const [url, mod] of Object.entries(graph)) {
    for (const dep of mod.imports) (importers[dep] ??= []).push(url);
  }

  const boundaries = [];
  const trace = [];
  const seen = new Set();

  // Возвращает ветку-тупик или null, если все ветки кончились границей.
  function walk(url, chain) {
    if (seen.has(url)) return null;
    seen.add(url);
    const mod = graph[url];

    if (mod.accept === 'self' && !(opts.invalidated && url === changed)) {
      trace.push({ url, step: 'self' });
      boundaries.push({ path: url, acceptedPath: url, chain });
      return null;
    }

    const ups = importers[url] ?? [];
    if (ups.length === 0) {
      trace.push({ url, step: 'dead-end' });
      return chain;
    }
    trace.push({ url, step: 'up', to: ups });

    for (const up of ups) {
      const accept = graph[up].accept;
      if (Array.isArray(accept) && accept.includes(url)) {
        trace.push({ url: up, step: 'accepts-dep', dep: url });
        boundaries.push({ path: up, acceptedPath: url, chain: [...chain, up] });
        continue;
      }
      if (chain.includes(up)) continue; // импорт по кругу
      const dead = walk(up, [...chain, up]);
      if (dead) return dead; // один тупик — и всё остальное неважно
    }
    return null;
  }

  const deadEnd = walk(changed, [changed]);
  if (deadEnd) {
    return {
      reload: true, deadEnd, trace, refetch: [],
      payload: { type: 'full-reload', triggeredBy: changed, path: '*' },
    };
  }

  // Заново браузер запросит всё от изменённого модуля до того, что импортируют
  // по новому адресу: саму границу или принятую ею зависимость.
  const refetch = [];
  for (const b of boundaries) {
    const upTo = b.path === b.acceptedPath ? b.chain : b.chain.slice(0, -1);
    for (const url of upTo) if (!refetch.includes(url)) refetch.push(url);
  }

  return {
    reload: false, deadEnd: null, trace, refetch,
    payload: {
      type: 'update',
      updates: boundaries.map((b) => ({
        type: (graph[b.path].type ?? 'js') + '-update',
        timestamp: 'T',
        path: b.path,
        acceptedPath: b.acceptedPath,
      })),
    },
  };
}`;

export const FIND_BOUNDARY_NOTE =
  'Чего в функции нет по сравнению с Vite. Во-первых, `acceptExports` — принятия части экспортов, когда импортёр, взявший только принятые имена, подъём не продолжает. Во-вторых, проверки импорта по кругу: граница внутри цикла помечается `isWithinCircularImport`, и если её повторный импорт упадёт, клиент перезагрузит страницу. В-третьих, модуль, который сервер ещё ни разу не переводил, Vite считает неразобранным и на нём подъём тихо обрывает — без границы и без перезагрузки.';

// ── Граф фикстуры ──

type Accept = HmrNode['accept'];

/** Граф фикстуры стенда в вариантах. Порядок импортов — как в файлах фикстуры. */
function fixture(o: { button?: Accept; app?: Accept; header?: boolean; cssModule?: boolean } = {}): HmrGraph {
  const g: HmrGraph = {
    '/main.js': { imports: ['/style.css', '/App.js'] },
    '/style.css': { imports: [], accept: 'self' },
    '/App.js': { imports: o.header ? ['/Button.js', '/Header.js'] : ['/Button.js'] },
    '/Button.js': { imports: o.cssModule ? ['/utils.js', '/button.module.css'] : ['/utils.js'] },
    '/utils.js': { imports: [] },
  };
  if (o.app) g['/App.js'].accept = o.app;
  if (o.button) g['/Button.js'].accept = o.button;
  if (o.header) g['/Header.js'] = { imports: ['/utils.js'] };
  if (o.cssModule) g['/button.module.css'] = { imports: [] };
  return g;
}

const VUE_STYLE = '/Counter.vue?vue&type=style&index=0&lang.css';
const vueGraph = (): HmrGraph => ({
  '/main.js': { imports: ['/Counter.vue'] },
  '/Counter.vue': { imports: [VUE_STYLE], accept: 'self' },
  [VUE_STYLE]: { imports: [], accept: 'self' },
});

// ─── Демо ──

export const DEMO_VARIANTS: DemoVariant[] = [
  {
    id: 'none',
    label: 'accept нигде',
    note: 'Ни один JS-модуль не принимает обновлений. Граница есть только у `style.css`: импортированный CSS Vite оборачивает в JS-модуль и сам дописывает ему `accept()`.',
    graph: fixture(),
  },
  {
    id: 'button-self',
    label: 'Button: accept()',
    note: '`Button.js` принимает себя и после повторного исполнения сам перерисовывает кнопку.',
    graph: fixture({ button: 'self' }),
  },
  {
    id: 'app-dep',
    label: "App: accept('./Button.js')",
    note: '`App.js` принимает свою зависимость: в колбэк приходит новый модуль `Button.js`, и `App.js` перерисовывает кнопку его функцией.',
    graph: fixture({ app: ['/Button.js'] }),
  },
  {
    id: 'two-paths',
    label: 'Button: accept() + Header',
    note: '`Button.js` принимает себя, но `utils.js` импортирует ещё и `Header.js`, который не принимает ничего.',
    graph: fixture({ button: 'self', header: true }),
  },
];

/** Раскладка узлов на схеме демо: центры прямоугольников 150×44, viewBox `105 6 420 318`. */
export const DEMO_POS: Record<string, NodePos> = {
  '/main.js': { x: 190, y: 32 },
  '/style.css': { x: 400, y: 32 },
  '/App.js': { x: 190, y: 118 },
  '/Header.js': { x: 400, y: 190 },
  '/Button.js': { x: 190, y: 210 },
  '/utils.js': { x: 190, y: 298 },
};

export const DEMO_CAPTION =
  'Попробуйте «Button: accept() + Header» и правку `utils.js`: граница на `Button.js` есть, а страница всё равно перезагружается — вторая ветка через `Header.js` дошла до `main.js` без границы. Ответ считает функция `findBoundary` из раздела выше; где сочетание прогонялось на настоящем Vite 8.3.0, рядом показано, что он прислал и что стало с кнопкой.';

// ─── Журналы стенда ──

const upd = (path: string, acceptedPath = path, extra: { firstInvalidatedBy?: string; type?: 'css-update' } = {}) => ({
  type: 'update' as const,
  updates: [
    {
      type: extra.type ?? ('js-update' as const),
      timestamp: 'T' as const,
      path,
      acceptedPath,
      explicitImportRequired: false,
      isWithinCircularImport: false,
      ...(extra.firstInvalidatedBy ? { firstInvalidatedBy: extra.firstInvalidatedBy } : {}),
    },
  ],
});
const reload = (triggeredBy: string) => ({ type: 'full-reload' as const, triggeredBy, path: '*' });
const fileChanged = { type: 'custom' as const, event: 'file-changed', data: { file: '/Counter.vue' } };

/**
 * Что сделал настоящий Vite 8.3.0. Сообщения — как пришли (метка времени → `T`), запросы —
 * адреса, пришедшие с `?t=`. При перезагрузке список запросов не сверяется: после
 * `location.reload()` браузер тянет всё заново.
 */
export const JOURNALS: HmrJournal[] = [
  {
    id: 'no-accept/utils',
    title: 'accept нигде, правка `utils.js`',
    variant: 'none',
    graph: fixture(),
    changed: '/utils.js',
    messages: [reload('/utils.js')],
    reload: true,
    refetched: [],
    before: 'v1:0',
    after: 'v2:0',
    log: ['page reload utils.js'],
  },
  {
    id: 'css-import/style.css',
    title: 'accept нигде, правка `style.css`',
    variant: 'none',
    graph: fixture(),
    changed: '/style.css',
    messages: [upd('/style.css')],
    reload: false,
    refetched: ['/style.css'],
    before: 'rgb(0, 0, 0)',
    after: 'rgb(255, 0, 0)',
    log: ['hmr update /style.css'],
  },
  {
    id: 'button-self/utils',
    title: '`Button.js` принимает себя, правка `utils.js`',
    variant: 'button-self',
    graph: fixture({ button: 'self' }),
    changed: '/utils.js',
    messages: [upd('/Button.js')],
    reload: false,
    refetched: ['/Button.js', '/utils.js'],
    before: 'v1:3',
    after: 'v2:0',
    log: ['hmr update /Button.js'],
  },
  {
    id: 'button-self/Button',
    title: '`Button.js` принимает себя, правка его самого',
    variant: 'button-self',
    graph: fixture({ button: 'self' }),
    changed: '/Button.js',
    messages: [upd('/Button.js')],
    reload: false,
    refetched: ['/Button.js'],
    before: 'v1:3',
    after: 'v1:0',
    log: ['hmr update /Button.js'],
  },
  {
    id: 'button-self/main',
    title: '`Button.js` принимает себя, правка `main.js`',
    variant: 'button-self',
    graph: fixture({ button: 'self' }),
    changed: '/main.js',
    messages: [reload('/main.js')],
    reload: true,
    refetched: [],
    before: 'v1:0',
    after: 'v1:0',
    log: ['page reload main.js'],
  },
  {
    id: 'button-self-data/utils',
    title: '`Button.js` принимает себя и переносит счётчик через `hot.data`',
    graph: fixture({ button: 'self' }),
    changed: '/utils.js',
    messages: [upd('/Button.js')],
    reload: false,
    refetched: ['/Button.js', '/utils.js'],
    before: 'v1:3',
    after: 'v2:3',
    log: ['hmr update /Button.js'],
  },
  {
    id: 'app-dep/utils',
    title: "`App.js` принимает `./Button.js`, правка `utils.js`",
    variant: 'app-dep',
    graph: fixture({ app: ['/Button.js'] }),
    changed: '/utils.js',
    messages: [upd('/App.js', '/Button.js')],
    reload: false,
    refetched: ['/Button.js', '/utils.js'],
    before: 'v1:3',
    after: 'v2:0',
    log: ['hmr update /App.js'],
  },
  {
    id: 'app-dep/App',
    title: "`App.js` принимает `./Button.js`, правка самого `App.js`",
    variant: 'app-dep',
    graph: fixture({ app: ['/Button.js'] }),
    changed: '/App.js',
    messages: [reload('/App.js')],
    reload: true,
    refetched: [],
    before: 'v1:0',
    after: 'v1:0',
    log: ['page reload App.js'],
  },
  {
    id: 'two-paths/utils',
    title: '`Button.js` принимает себя, но `utils.js` импортирует ещё `Header.js`',
    variant: 'two-paths',
    graph: fixture({ button: 'self', header: true }),
    changed: '/utils.js',
    messages: [reload('/utils.js')],
    reload: true,
    refetched: [],
    before: 'v1:0',
    after: 'v2:0',
    log: ['page reload utils.js'],
  },
  {
    id: 'alias-hot/utils',
    title: '`Button.js` зовёт `accept` через `const hot = import.meta.hot`',
    // Для сервера это модуль без accept: см. ALIAS_CODE.
    graph: fixture(),
    changed: '/utils.js',
    messages: [reload('/utils.js')],
    reload: true,
    refetched: [],
    before: 'v1:0',
    after: 'v2:0',
    log: ['page reload utils.js'],
  },
  {
    id: 'invalidate/Button',
    title: '`Button.js` зовёт `invalidate()`, `App.js` принимает себя',
    graph: fixture({ button: 'self', app: 'self' }),
    changed: '/Button.js',
    invalidates: true,
    messages: [upd('/Button.js'), upd('/App.js', '/App.js', { firstInvalidatedBy: '/Button.js' })],
    reload: false,
    refetched: ['/Button.js', '/App.js'],
    before: 'v1:0',
    after: 'v1:0',
    log: ['hmr update /Button.js', 'hmr invalidate /Button.js VERSION сменился', 'hmr update /App.js'],
  },
  {
    id: 'invalidate-dead/Button',
    title: '`Button.js` зовёт `invalidate()`, выше никто не принимает',
    graph: fixture({ button: 'self' }),
    changed: '/Button.js',
    invalidates: true,
    messages: [upd('/Button.js'), reload('/Button.js')],
    reload: true,
    refetched: [],
    before: 'v1:0',
    after: 'v1:0',
    log: ['hmr update /Button.js', 'hmr invalidate /Button.js VERSION сменился', 'page reload Button.js'],
  },
  {
    id: 'css-link/global.css',
    title: 'CSS через `<link>` в `index.html`',
    graph: { ...fixture(), '/global.css?direct': { imports: [], accept: 'self', type: 'css' } },
    changed: '/global.css?direct',
    messages: [upd('/global.css?direct', '/global.css?direct', { type: 'css-update' })],
    reload: false,
    // Клиент срезает `?direct` и перезапрашивает `<link>` по чистому адресу.
    refetched: ['/global.css'],
    before: '0px',
    after: '7px',
    log: ['hmr update /global.css?direct'],
  },
  {
    id: 'css-module-noaccept/button.module.css',
    title: 'CSS-модуль, accept нигде',
    graph: fixture({ cssModule: true }),
    changed: '/button.module.css',
    messages: [reload('/button.module.css')],
    reload: true,
    refetched: [],
    before: 'rgb(0, 0, 255)',
    after: 'rgb(0, 128, 0)',
    log: ['page reload button.module.css'],
  },
  {
    id: 'css-module-self/button.module.css',
    title: 'CSS-модуль, `Button.js` принимает себя',
    graph: fixture({ cssModule: true, button: 'self' }),
    changed: '/button.module.css',
    messages: [upd('/Button.js')],
    reload: false,
    refetched: ['/Button.js', '/button.module.css'],
    before: 'v1:2',
    after: 'v1:0',
    log: ['hmr update /Button.js'],
  },
  {
    id: 'vue/template',
    title: 'Vue SFC: правка `<template>`',
    graph: vueGraph(),
    changed: '/Counter.vue',
    messages: [fileChanged, upd('/Counter.vue')],
    reload: false,
    refetched: ['/Counter.vue'],
    before: 'счёт: 3',
    after: 'счёт (новый): 3',
    log: ['hmr update /Counter.vue'],
  },
  {
    id: 'vue/script',
    title: 'Vue SFC: правка `<script setup>`',
    graph: vueGraph(),
    changed: '/Counter.vue',
    messages: [fileChanged, upd('/Counter.vue')],
    reload: false,
    refetched: ['/Counter.vue'],
    before: 'счёт: 3',
    after: 'счёт: 0',
    log: ['hmr update /Counter.vue'],
  },
  {
    id: 'vue/style',
    title: 'Vue SFC: правка `<style>`',
    graph: vueGraph(),
    changed: VUE_STYLE,
    messages: [fileChanged, upd(VUE_STYLE)],
    reload: false,
    refetched: [VUE_STYLE],
    before: 'rgb(0, 0, 0)',
    after: 'rgb(255, 0, 0)',
    log: [`hmr update ${VUE_STYLE}`],
  },
];

export const PAYLOAD_UPDATE_CODE = `// правка utils.js, App.js принимает './Button.js' — снято со стенда
{
  "type": "update",
  "updates": [{
    "type": "js-update",
    "timestamp": 1790607866367,
    "path": "/App.js",            // чей колбэк accept вызвать
    "acceptedPath": "/Button.js", // что импортировать заново: /Button.js?t=1790607866367
    "explicitImportRequired": false,
    "isWithinCircularImport": false
  }]
}`;

export const PAYLOAD_RELOAD_CODE = `// правка utils.js, границы нет
{ "type": "full-reload", "triggeredBy": "/…/utils.js", "path": "*" }

// правка index.html
{ "type": "full-reload", "path": "/index.html" }`;

export const PAYLOAD_FACTS = [
  {
    t: '`path` и `acceptedPath` — разные вопросы',
    d: '`path` — модуль, у которого клиент ищет колбэк `accept`. `acceptedPath` — модуль, который он импортирует заново по новому адресу. При `accept()` на себя они совпадают; при принятии зависимости `path` — принимающий, `acceptedPath` — зависимость.',
  },
  {
    t: 'Одна правка — одно сообщение со списком',
    d: 'Если у изменённого модуля несколько веток и каждая кончилась своей границей, в `updates` будет несколько пар. Клиент ставит их в очередь и применяет в порядке прихода, даже если ответы сервера пришли вразнобой.',
  },
  {
    t: '`full-reload` с `path` — только для HTML',
    d: 'При правке `index.html` сервер присылает путь страницы, и клиент перезагружается, только если открыт именно этот документ. Для перезагрузки из-за тупика в графе путь — `*`: перезагружается любая страница.',
    tone: 'warn' as const,
  },
];

// ─── Раздел 3. API модуля ─────────────────────────────────────────────────────────────────

export const ACCEPT_FORMS_CODE = `// 1. Модуль принимает себя: после правки его исполнят заново
if (import.meta.hot) {
  import.meta.hot.accept();            // или accept((newModule) => { … })
}

// 2. Модуль принимает свою зависимость: исполнят её, а он получит новый модуль
if (import.meta.hot) {
  import.meta.hot.accept('./Button.js', (mod) => {
    mod.renderButton(document.getElementById('app-root'));
  });
}

// 3. Несколько зависимостей разом
import.meta.hot?.accept(['./a.js', './b.js'], ([a, b]) => { /* undefined у той, что не менялась */ });`;

export const ACCEPT_ROWS = [
  {
    k: '`Button.js`: `accept()`',
    edit: '`utils.js`',
    refetch: '`Button.js?t=…`, `utils.js?t=…`',
    state: '`v1:3` → `v2:0`: модуль исполнен заново, счётчик обнулился',
  },
  {
    k: "`App.js`: `accept('./Button.js')`",
    edit: '`utils.js`',
    refetch: '`Button.js?t=…`, `utils.js?t=…` — сам `App.js` нет',
    state: '`v1:3` → `v2:0`: `App.js` не исполнялся, выполнен только его колбэк',
  },
  {
    k: "`App.js`: `accept('./Button.js')`",
    edit: '`App.js`',
    refetch: 'перезагрузка',
    state: 'принимать зависимость — не значит принимать себя',
  },
  {
    k: '`Button.js`: `accept()` + `dispose`/`data`',
    edit: '`utils.js`',
    refetch: '`Button.js?t=…`, `utils.js?t=…`',
    state: '`v1:3` → `v2:3`: счётчик перенесён',
  },
];

/**
 * Одна правка `utils.js` под разными обещаниями модулей. Автор курса (2026-09-29): трудное не
 * сокращать, а объяснять подробно и просто. Таблица `ACCEPT_ROWS` давала итог — что
 * перезапрошено и что стало со счётчиком, — но не объясняла, почему. Здесь каждая строка
 * разобрана по шагам на фикстуре стенда (`JOURNALS`: `no-accept/utils`, `button-self/utils`,
 * `app-dep/utils`, `button-self-data/utils`; Vite 8.3.0, Chromium 153). Код фикстуры в
 * `ACCEPT_SCENE_CODE` — пересказ её устройства из шапки файла, а не дословный исходник.
 */
export const ACCEPT_SCENE_CODE = `// Граф фикстуры: main.js → App.js → Button.js → utils.js

// utils.js — метка версии; правка меняет её с v1 на v2
// Button.js — рисует кнопку «метка:счётчик» и считает клики
//             в переменной модуля: let count = 0
// App.js    — импортирует renderButton из Button.js и зовёт его

// Пользователь кликнул три раза — на кнопке «v1:3».
// Правим utils.js: метка становится v2.`;

export const ACCEPT_SCENE_NOTE =
  'Что происходит, если **никто ничего не обещал**. Сервер поднимается от `utils.js`: его импортирует `Button.js` — не граница, его импортирует `App.js` — не граница, дальше `main.js`, у которого импортёров нет. Тупик. Сервер шлёт `full-reload`, в терминале — `page reload utils.js`. Страница загружается заново: кнопка показывает `v2:0`. Новая метка приехала, но три клика потеряны — а вместе с ними всё, что было в памяти страницы: введённое в форму, открытый диалог, прокрутка. Ради того, чтобы этого не было, модули и дают обещания.';

export const ACCEPT_STEPS: { k: string; when: string; what: string; cost: string }[] = [
  {
    k: '`Button.js` принимает себя',
    when: 'в `Button.js` стоит `import.meta.hot.accept()`',
    what: 'Подъём от `utils.js` останавливается на `Button.js`: граница найдена, в терминале `hmr update /Button.js`. Клиент импортирует `/Button.js?t=…`, тот тянет `/utils.js?t=…` — ровно два запроса. Новый `Button.js` исполняется с первой строки: метка `v2`, а `let count = 0` выполняется заново. На кнопке `v2:0`.',
    cost: 'Счётчик обнулился: новый экземпляр ничего не знает о старом. И старый экземпляр жив — `App.js` держит его `renderButton`, и вызов через `App.js` нарисует `v1:3` (карточка «Старый экземпляр остаётся»).',
  },
  {
    k: '`App.js` принимает `./Button.js`',
    when: "в `App.js` стоит `accept('./Button.js', (mod) => …)`",
    what: 'Подъём проходит `Button.js` и останавливается на `App.js`: он обещал принять именно эту зависимость. Перезапрошены те же `Button.js?t=…` и `utils.js?t=…`, а сам `App.js` — нет: его тело не исполняется, вызывается только колбэк, который получает новый модуль и рисует кнопку через `mod.renderButton`. На кнопке `v2:0`.',
    cost: 'Счётчик обнулился так же: `Button.js` всё равно исполнен заново. И обещание узкое: правка самого `App.js` даёт перезагрузку — принимать зависимость не значит принимать себя.',
  },
  {
    k: '`Button.js` принимает себя и передаёт счётчик',
    when: 'к `accept()` добавлены `dispose` и `import.meta.hot.data`',
    what: 'Перед импортом нового экземпляра клиент зовёт `dispose` старого — тот кладёт `count` в `data`. Новый `Button.js` начинает не с нуля, а с `import.meta.hot?.data.count ?? 0`. Запросы те же два, а на кнопке `v2:3`: метка новая, клики на месте.',
    cost: 'Переносить состояние приходится руками, и перенести можно только то, что вы положили в `data`. Всё, что старый экземпляр повесил на мир — обработчики, таймеры, — тоже снимаете вы, в том же `dispose`.',
  },
];

export const DATA_CODE = `let count = import.meta.hot?.data.count ?? 0;   // новый экземпляр читает

import.meta.hot?.dispose((data) => {           // старый экземпляр пишет
  data.count = count;
});`;

export const DATA_NOTE =
  '`dispose` клиент вызывает **до** того, как импортировать новый экземпляр, и передаёт ему объект, который потом станет `import.meta.hot.data` у нового. Объект привязан к адресу модуля без метки и переходит от экземпляра к экземпляру: всё, что в него положили, живёт, пока его не перезапишут. В `dispose` же снимают то, что старый экземпляр повесил на мир: обработчики, таймеры, подписки. Иначе после десяти правок на `window` висят десять обработчиков: старые экземпляры никто не выгружает.';

export const PLAIN_DISPOSE =
  'Как смена на посту. Уходящий сотрудник (`dispose`) выключает за собой приборы — обработчики, таймеры, подписки — и оставляет записку в общем ящике (`data`). Новый сотрудник первым делом читает записку и продолжает с того же места. Не выключил приборы — они работают дальше, и после десяти смен работают десять чайников сразу.';

export const INVALIDATE_CODE = `export const VERSION = 2;

if (import.meta.hot) {
  import.meta.hot.accept((mod) => {
    // Новый модуль приехал, но его интерфейс сменился:
    // перерисовать себя уже мало — пусть решают импортёры.
    if (mod.VERSION !== VERSION) import.meta.hot.invalidate('VERSION сменился');
  });
}`;

export const INVALIDATE_FACTS = [
  {
    t: 'Два сообщения на одну правку',
    d: 'Правка `Button.js`: сервер прислал `update` для `/Button.js`, клиент исполнил новый модуль и в колбэке позвал `invalidate()` — по WebSocket **от клиента** ушло `{ event: "vite:invalidate", data: { path: "/Button.js", message: "VERSION сменился", firstInvalidatedBy: "/Button.js" } }`. Сервер продолжил подъём от импортёров `Button.js` и прислал второе `update` — для `/App.js`, уже с полем `firstInvalidatedBy`.',
  },
  {
    t: 'Выше никто не принял — перезагрузка после обновления',
    d: 'Тот же сценарий без `accept` в `App.js`: первое `update` применилось, потом пришёл `full-reload`. Работа по первому обновлению выброшена, а в журнале сервера три строки: `hmr update`, `hmr invalidate`, `page reload`.',
    tone: 'warn' as const,
  },
  {
    t: 'Так устроен и React Fast Refresh',
    d: 'Плагин React проверяет в колбэке `accept`, остались ли экспорты модуля компонентами, и если нет — зовёт тот же `invalidate` с сообщением `Could not Fast Refresh (…)`. Механизм один; разница только в том, кто решает, что обновления мало.',
  },
];

export const ALIAS_CODE = `// Не граница: сервер ищет accept в тексте модуля буквально
const hot = import.meta.hot;
if (hot) hot.accept();

// Граница: этот текст сервер узнаёт
if (import.meta.hot) import.meta.hot.accept();
import.meta.hot?.accept();`;

export const ALIAS_NOTE =
  'Сервер не исполняет модуль, чтобы узнать, принимает ли тот обновления: он ищет в **тексте** цепочку `import.meta.hot.accept(` (или `import.meta.hot?.accept(`) и разбирает её аргументы. Вызов через переменную для него невидим: модуль с `hot.accept()` ведёт себя как модуль без `accept`, и правка `utils.js` даёт `page reload utils.js`. Аргументы тоже читаются из текста, поэтому зависимости в `accept` — только строковые литералы: на выражение Vite отвечает ошибкой «can only accept string literals or an Array of string literals».';

// ─── Раздел 4. CSS и Vue ──────────────────────────────────────────────────────────────────

export const CSS_ROWS = [
  {
    k: "`import './style.css'`",
    msg: '`js-update`, `path: "/style.css"`',
    how: 'CSS обёрнут в JS-модуль, который кладёт текст в `<style>` и сам себя принимает. Новый экземпляр заменяет текст того же `<style>`. Цвет `rgb(0, 0, 0)` → `rgb(255, 0, 0)` без перезагрузки',
    tone: 'ok' as const,
  },
  {
    k: '`<link rel="stylesheet">` в HTML',
    msg: '`css-update`, `path: "/global.css?direct"`',
    how: 'Клиент клонирует `<link>` с `?t=…` в адресе, ставит рядом и удаляет старый, когда новый загрузился — без мигания без стилей. Отступ `0px` → `7px`',
    tone: 'ok' as const,
  },
  {
    k: "`import cls from './b.module.css'`, выше нет `accept`",
    msg: '`full-reload`',
    how: 'CSS-модуль экспортирует имена классов, а их кто-то уже прочитал. Себя он не принимает, подъём идёт к импортёру — и дальше по обычным правилам',
    tone: 'err' as const,
  },
  {
    k: 'то же, `Button.js` принимает себя',
    msg: '`js-update`, `path: "/Button.js"`',
    how: 'Граница — импортёр. Перезапрошены `Button.js` и CSS-модуль, стиль применился, но `Button.js` исполнен заново — счётчик `2` → `0`',
    tone: 'warn' as const,
  },
];

export const VUE_GENERATED_CODE = `// что @vitejs/plugin-vue дописывает в каждый .vue в разработке (сокращено)
_sfc_main.__hmrId = "<хеш пути файла>";
__VUE_HMR_RUNTIME__.createRecord(_sfc_main.__hmrId, _sfc_main);
import.meta.hot.on('file-changed', ({ file }) => {
  __VUE_HMR_RUNTIME__.CHANGED_FILE = file;
});
// только если по сравнению с прошлой версией изменился один <template>:
export const _rerender_only = __VUE_HMR_RUNTIME__.CHANGED_FILE === "/…/Counter.vue";

import.meta.hot.accept((mod) => {
  if (!mod) return;
  const { default: updated, _rerender_only } = mod;
  if (_rerender_only) {
    __VUE_HMR_RUNTIME__.rerender(updated.__hmrId, updated.render); // новая render-функция
  } else {
    __VUE_HMR_RUNTIME__.reload(updated.__hmrId, updated);          // компонент пересоздан
  }
});`;

export const VUE_ROWS = [
  {
    k: '`<template>`',
    msg: '`file-changed`, затем `update` для `/Counter.vue`',
    state: '`счёт: 3` → `счёт (новый): 3` — состояние на месте, `setup` не вызывался',
    tone: 'ok' as const,
  },
  {
    k: '`<script setup>`',
    msg: 'те же два сообщения',
    state: '`счёт: 3` → `счёт: 0` — `setup` вызван заново, `ref` создан с нуля',
    tone: 'warn' as const,
  },
  {
    k: '`<style>`',
    msg: '`update` только для `/Counter.vue?vue&type=style&index=0&lang.css`',
    state: '`счёт: 3` остался, цвет сменился: компонент не тронут вовсе',
    tone: 'ok' as const,
  },
];

export const PLAIN_RERENDER =
  'Поменяли только `<template>` — это как перевесить вывеску: магазин работает, товар на полках, покупатели внутри. Поменяли `<script setup>` — магазин закрывают и открывают заново, и склад (`ref`, `reactive`) пуст. Первое Vue называет `rerender`, второе — `reload`.';

export const VUE_NOTE =
  'Два сообщения при правке шаблона и скрипта **одинаковые** — различие не в протоколе, а в коде, который приехал. Плагин на сервере сравнивает новый разбор SFC с прошлым: если изменился только `<template>`, в модуль дописывается `_rerender_only`, и колбэк `accept` подменяет у живых экземпляров одну render-функцию. Иначе `reload` пересоздаёт экземпляры, и `setup` выполняется с нуля. Пользовательское событие `file-changed` плагин шлёт первым на **любую** правку, и признак сравнивается с ним: компонент переводится заново и тогда, когда изменился не он сам, а файл типов, импортированный его `<script setup>`, — и подменять в этом случае одну render-функцию было бы неверно.';

// ─── Раздел 5. React Fast Refresh и прод ──────────────────────────────────────────────────

export const REACT_FACTS = [
  {
    t: 'Граница — каждый модуль с компонентами',
    d: '`@vitejs/plugin-react` дописывает в модуль `accept` на себя и регистрирует его экспорты. Когда приехала новая версия, колбэк проверяет: все экспорты — по-прежнему компоненты, ни один не добавлен и не убран. Да — React перерисовывает затронутые компоненты новыми функциями. Нет — `invalidate` с сообщением `Could not Fast Refresh (…)`, и подъём идёт к импортёрам, как в разделе про `invalidate`.',
  },
  {
    t: 'Состояние хуков живёт, пока жив их порядок',
    d: 'По документации Fast Refresh: `useState` и `useRef` сохраняют значения, если порядок и число хуков в компоненте не изменились. Сменили — компонент монтируется заново. `useEffect`, `useMemo` и `useCallback` во время рефреша срабатывают заново **всегда**, списки зависимостей игнорируются. Классовые компоненты пересоздаются при каждой правке, а комментарий `// @refresh reset` в файле делает то же для функциональных.',
  },
  {
    t: 'Нужна преамбула на странице',
    d: 'Рефреш вставляет в каждый модуль вызовы `$RefreshReg$` и `$RefreshSig$`, а сами функции объявляет отдельный скрипт-преамбула в HTML. Без неё модуль падает на первой строке: плагин так и пишет — «can\'t detect preamble».',
    tone: 'warn' as const,
  },
];

export const THIS_SITE_NOTE =
  'На этом сайте Fast Refresh выключен — плагином `lesson:no-react-refresh` в `astro.config.mjs`. Причина — ровно преамбула: инструментация рефреша доставалась и скомпилированным Vue-компонентам, а преамбулу Astro вставляет только в страницы с React, и дев-сервер отдавал 500 с `$RefreshSig$ is not defined`. Цена записана там же: React-острова в разработке перезагружаются целиком.';

export const PROD_SOURCE_CODE = `// Button.js, исходник
let count = import.meta.hot?.data.count ?? 0;
import.meta.hot?.dispose((data) => { data.count = count; });
if (import.meta.hot) {
  import.meta.hot.accept();
  const root = document.getElementById('app-root');
  if (root) renderButton(root);
}`;

export const PROD_BUNDLE_CODE = `// vite build без минификации: всё, что осталось от этих восьми строк
var count = 0;`;

export const PROD_BARE_CODE = `// исходник без охраны
import.meta.hot.accept();

// в сборке
(void 0).accept();
// → TypeError: Cannot read properties of undefined (reading 'accept')`;

export const PROD_NOTE =
  'В сборке `import.meta.hot` заменяется на `undefined`, после чего `if (undefined) { … }` и `undefined?.dispose(…)` — мёртвый код, и сборка вырезает его сама, даже без `minify`: в бандле нет ни `import.meta.hot`, ни `accept`, ни `dispose`, ни клиента `/@vite/client`. Обязательна поэтому только сама проверка `if (import.meta.hot)` или `?.`: голый `import.meta.hot.accept()` превращается в `(void 0).accept()` и роняет модуль в продакшен-сборке на первой же строке.';

// ─── Тонкие места ─────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'Одна тупиковая ветка перезагружает всю страницу',
    d: 'Граница на одной ветке ничего не гарантирует, если у модуля есть второй импортёр без `accept`. Стенд: `Button.js` принимает себя, но `utils.js` импортирует ещё `Header.js` — правка `utils.js` дала `full-reload`. Когда страница «почему-то» перезагружается, ищите не отсутствующий `accept`, а лишнего импортёра.',
    tone: 'err',
  },
  {
    n: '02',
    t: 'Старый экземпляр модуля остаётся жить',
    d: 'Новый `Button.js` приехал по адресу с `?t=`, но `App.js` держит привязку к старому. Вызов через `App.js` рисует `v1:3` — старую метку и старый счётчик, — хотя на экране уже была новая кнопка `v2:0`. Поэтому модуль, принимающий себя, обязан сам перерисовать всё, что нарисовал, и снять в `dispose` всё, что повесил.',
    tone: 'err',
  },
  {
    n: '03',
    t: 'Модульное состояние обнуляется, если его не перенести',
    d: 'Принять себя — значит быть исполненным заново: `let count = 0` снова ноль, и кнопка `v1:3` становится `v2:0`. С `hot.data` — `v2:3`. То же у модуля, который принимает зависимость: пересоздаётся зависимость, и её состояние теряется.',
    tone: 'warn',
  },
  {
    n: '04',
    t: '`accept` через переменную не считается',
    d: 'Сервер ищет `import.meta.hot.accept(` в тексте модуля. `const hot = import.meta.hot; hot.accept()` для него — модуль без границы, и правка перезагружает страницу. Никакой ошибки или предупреждения нет.',
    code: 'const hot = import.meta.hot;\nhot?.accept();          // сервер этого не видит',
    tone: 'err',
  },
  {
    n: '05',
    t: '`accept(\'./dep\')` не делает модуль границей для самого себя',
    d: '`App.js` принимает `./Button.js`, и правка `utils.js` доезжает без перезагрузки. Правка самого `App.js` — `page reload App.js`: себя он не принимал, а импортёр `main.js` — корень без `accept`.',
    tone: 'warn',
  },
  {
    n: '06',
    t: 'CSS-модуль — не граница',
    d: 'Обычный импортированный CSS принимает себя, и правка цвета никогда не перезагружает страницу. CSS-модуль экспортирует имена классов и себя не принимает: без `accept` выше правка стиля в `*.module.css` — перезагрузка, а с границей в компоненте — повторное исполнение компонента и потеря его состояния.',
    tone: 'warn',
  },
  {
    n: '07',
    t: 'В Vue правка скрипта и правка шаблона — разные события',
    d: 'Шаблон: подменяется render-функция, `ref` и `reactive` на месте. `<script setup>`: экземпляры пересоздаются, `setup` выполняется заново: `счёт: 3` → `счёт: 0`. Если при отладке состояние «иногда» сбрасывается, посмотрите, какой блок файла правили.',
  },
  {
    n: '08',
    t: '`invalidate` без границы выше — двойная работа',
    d: 'Первое обновление применяется, модуль исполняется, и только потом приходит `full-reload`. Если колбэк уже успел что-то нарисовать или отправить запрос, это произойдёт зря. У React то же случается при каждой правке файла, экспортирующего рядом с компонентом константу или функцию.',
  },
  {
    n: '09',
    t: 'Без охраны `if (import.meta.hot)` код падает в продакшен-сборке',
    d: 'В сборке `import.meta.hot` — `undefined`. Охраняемый код исчезает целиком, а голый вызов остаётся как `(void 0).accept()` и бросает `TypeError` при загрузке модуля. В разработке это не видно никогда.',
    tone: 'err',
  },
];

// ─── Источники ────────────────────────────────────────────────────────────────────────────

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'Vite — HMR API',
    href: 'https://vite.dev/guide/api-hmr',
    what: '`accept`, `dispose`, `data`, `invalidate`, `prune`, требование к охране `if (import.meta.hot)` и строковым литералам',
  },
  {
    title: 'Vite — исходник `server/hmr.ts`',
    href: 'https://github.com/vitejs/vite/blob/main/packages/vite/src/node/server/hmr.ts',
    what: '`propagateUpdate`, `updateModules`, форма сообщений `update` и `full-reload`; прочитано в сборке 8.3.0',
  },
  {
    title: 'Vite — исходник `client/client.ts` и `shared/hmr.ts`',
    href: 'https://github.com/vitejs/vite/tree/main/packages/vite/src/client',
    what: 'импорт по адресу с `?t=`, очередь обновлений, замена `<link>`, отправка `vite:invalidate`',
  },
  {
    title: '@vitejs/plugin-vue',
    href: 'https://github.com/vitejs/vite-plugin-vue/tree/main/packages/plugin-vue',
    what: 'код, дописываемый в SFC: `__hmrId`, `_rerender_only`, событие `file-changed`',
  },
  {
    title: 'React Native — Fast Refresh',
    href: 'https://reactnative.dev/docs/fast-refresh',
    what: 'что сохраняется при рефреше, поведение хуков с зависимостями, `// @refresh reset`',
  },
  {
    title: '@vitejs/plugin-react — consistent components exports',
    href: 'https://github.com/vitejs/vite-plugin-react/tree/main/packages/plugin-react#consistent-components-exports',
    what: 'когда модуль не может быть границей рефреша и уходит в `invalidate`',
  },
];

export const RELATED =
  'Смежное на сайте: [Модули и сборка](/tooling/modules/#s6) — как dev-сервер отдаёт модули по одному и почему в рабочей сборке всё иначе. [Модули и сборка, раздел «Три фазы»](/tooling/modules/#s1) — module map, из-за которой нужен `?t=`. [Долгие соединения](/platform/realtime/) — WebSocket, по которому приходят сообщения. [Vue 3 изнутри: рендерер и patch](/frameworks/vue-patch-internals/#s7) — компонент как эффект, чью render-функцию подменяет `rerender`. [React изнутри: свой рендерер и хуки](/frameworks/react-internals/#s5) — хуки по номеру вызова, из-за которых смена их порядка сбрасывает состояние при рефреше. [Тест-раннеры изнутри](/tooling/test-runners/) — свой реестр модулей на каждый тестовый файл, моки и их подъём.';
