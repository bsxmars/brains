import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { BudgetPage, ChunkInfo } from '@/widgets/budget-lab/model/types';

/**
 * Данные темы «Бюджеты производительности: вес бандла и проверки в CI».
 *
 * Тема написана здесь, 2026-10-02. Сквозной пример — сам этот сайт и его сторож
 * `tests/e2e/weight.spec.ts`.
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * Astro 7.3.2 (сборка Vite 8.3.0 на rolldown), Vue 3.5.42, es-module-lexer 2.3.2, acorn 8.18.0,
 * esbuild 0.28.2 — всё из `node_modules` проекта. Node 24.11.0, Chromium 153 (Playwright 1.63).
 *
 * 1. **Собранный сайт.** `astro build` стенд НЕ запускал. Взят `dist/` сборки владельца от
 *    **2026-10-02 16:15** (174 файла `index.html`, из них 22 — переадресации со старых адресов; 313 чанков `_astro/*.js`) и скопирован в каталог стенда:
 *    пока стенд работал, `dist/` дважды пересобирали соседи, и одна копия вышла смешанной
 *    (HTML ссылался на CSS, которого уже не было) — отсюда правило «сначала копия, потом замер».
 *    Отпечаток сборки — `DIST_FINGERPRINT`: первые 16 знаков sha-256 от отсортированного списка
 *    имён `_astro/*.js`. Файлы, на которых сняты числа демо (HTML пяти страниц, их 53 чанка,
 *    `BaseLayout.css`, 7 шрифтов «Source maps»; 1 546 289 байт), лежат копией в
 *    `tests/fixtures/performance-budgets/dist/` — по ним тест сверяет снимок всегда. Числа,
 *    которым нужна вся сборка (число страниц у чанка, пороги «сейчас», медианы сжатия, воркер,
 *    19 файлов woff2), сверяются с `dist/`, только если отпечаток совпал, иначе пропускаются
 *    с пометкой. Логика (функции темы против weight.spec, es-module-lexer и acorn) проверяется
 *    на любой сборке.
 *
 *    `BUDGET_CHUNKS` и `BUDGET_PAGES` получены функциями из `GRAPH_CODE`: `buildGraph` по текстам
 *    всех 313 чанков, входы — имена `/_astro/*.js` из HTML страницы (тот же шаблон, что в
 *    weight.spec). `gzip` — `zlib.gzipSync` с уровнем по умолчанию (6), `br` — Brotli качества 11.
 *    `pages` — на скольких страницах (из 152 настоящих) чанк попадает в статическое замыкание.
 *
 * 2. **Chromium.** Свой `node:http`-сервер отдаёт копию `dist/` без сжатия (порты 5062–5063;
 *    5060 Chromium не открывает — `ERR_UNSAFE_PORT`), окно 1280×800. Страница грузится до
 *    `networkidle`, затем прокручивается шагом 800 px. Записаны ответы и их тела по типам.
 *    Это `CHROMIUM_TRACE` и `RESOURCE_ROWS`: при открытии `/tooling/source-maps/` скриптов
 *    0 байт, после прокрутки — ровно замыкание, 9 файлов и 124 249 байт; так же совпали
 *    `/frameworks/react-vs-vue/` (18 файлов, 354 054) и `/frameworks/ssr-hydration/`
 *    (11 файлов, 130 993). На последней нажата кнопка «2 · Гидратировать» в `SsrLab` —
 *    браузер докачал 3 файла, 219 241 байт: `react`, `react-dom`, `client` (React DOM).
 *    Шрифты — 7 файлов, 178 604 байта, одинаково на всех трёх страницах.
 *
 * 3. **Манифест и metafile.** Фикстура из трёх файлов (`FX_*`) собрана `vite build` с
 *    `build.manifest: true` (Vite 8.3.0) и `esbuild.build({ splitting, metafile })` 0.28.2.
 *    `VITE_MANIFEST_PRINT` и `ESBUILD_GRAPH_PRINT` — их вывод как есть; тест пересобирает обе.
 *
 * 4. **База для CI.** `CI_BASE_EVENT_LOOP` и `CI_BASE_REACT_VS_VUE` — граф тех же страниц из
 *    темы «Острова» (снят там с `dist/` от 2026-10-01 14:05); тест сверяет их с
 *    `frameworks/islands/data.ts`. Разница с сегодняшней сборкой — `CI_REPORT_*` — посчитана
 *    `CI_CODE` и сверяется тестом.
 *
 * **По документации, не запуском** (пакетов в проекте нет, ставить нельзя, сеть со стенда
 * закрыта): Lighthouse CI (`LHCI_CONFIG`), size-limit (`SIZE_LIMIT_CONFIG`), `gh pr comment`
 * и конвейер `WORKFLOW_YAML` — это схемы, их никто не исполнял. Утверждение «байт JS дороже
 * байта картинки» — по статье V8 «The cost of JavaScript» и теме «Движок V8»; время не мерялось.
 * Что Vite встраивает в CSS файлы меньше 4096 байт — из справки `vite build --help` в
 * `node_modules/vite/dist/node/cli.js` (`assetsInlineLimit`, default 4096).
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'бюджет производительности',
    d: 'Число и правило, как его считать: «скрипты страницы — не больше 190 КБ сырыми байтами». Проверка падает, если правка выводит страницу за число. Без правила подсчёта число ничего не значит.',
  },
  {
    k: 'чанк',
    d: 'Один выходной файл сборщика: `ui.DIEeBnsz.js`. Чанки импортируют друг друга, и страница получает не один файл, а цепочку.',
  },
  {
    k: 'статический и динамический импорт',
    d: 'Статический — строка `import … from "./x.js"` в начале модуля: браузер качает `x.js` до запуска модуля. Динамический — вызов `import("./x.js")`: файл качается, когда до вызова дошло дело, например по клику.',
  },
  {
    k: 'замыкание импортов',
    d: 'Все чанки, до которых можно дойти по статическим импортам от входов страницы. Это и есть то, что браузер скачает, чтобы оживить её код.',
  },
  {
    k: 'gzip и Brotli',
    d: 'Алгоритмы сжатия, которыми сервер ужимает текст перед отправкой. Браузер распаковывает его сам, и в памяти у него снова сырые байты.',
  },
  {
    k: 'синтетика и RUM',
    d: 'Синтетика — замер на своей машине по сценарию: Lighthouse, прогон в CI. RUM (real user monitoring) — числа, которые прислали браузеры настоящих посетителей.',
  },
  {
    k: 'базовая ветка',
    d: 'Ветка, в которую вливается пул-реквест, обычно `main`. Рост веса считают против неё: «стало на 69 байт больше, чем в `main`».',
  },
];

export const PLAIN_BUDGET =
  'Как норма багажа в авиакомпании. Сумку взвешивают на стойке, до вылета, а не по жалобам пассажиров после посадки. Весы показывают одно число, и оно не зависит от погоды. А в правилах заранее сказано, что взвешивают: ручную кладь отдельно, чемодан отдельно, коляску не считают. Бюджет в CI — та же стойка: правка, которая перегружает страницу, не улетает в прод.';

export const PREREQ_NOTE =
  'Тема опирается на четыре вещи из других тем. Если какая-то не на месте — ссылка ведёт туда, где она разобрана.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'Граф модулей и чанки',
    d: 'Сборщик обходит импорты от точки входа и раскладывает модули по файлам. Общий код уходит в отдельный чанк, и его импортируют все, кому он нужен. Имена файлов содержат хеш содержимого.',
    href: '/tooling/bundler-internals/#s4',
    hrefLabel: '«Бандлер изнутри», раздел «Чанки»',
    tone: 'info',
  },
  {
    t: 'Острова Astro',
    d: 'Этот сайт — HTML с островами: каждое демо оживает отдельно и качает свой код, когда доскроллили до него. Вес острова — это его модуль и всё, что тот импортирует.',
    href: '/frameworks/islands/#s5',
    hrefLabel: '«Острова и resumability», раздел «Что и когда скачивается»',
    tone: 'info',
  },
  {
    t: 'Сжатие при передаче',
    d: 'Сервер отдаёт текст сжатым, если браузер это умеет, и пишет алгоритм в `Content-Encoding`. Сжатие бывает заранее, при сборке, или на лету, на каждый запрос.',
    href: '/platform/compression/#s3',
    hrefLabel: '«Сжатие в вебе», раздел «Заранее или на лету»',
    tone: 'info',
  },
  {
    t: 'Конвейер CI',
    d: 'Проверки на каждый пул-реквест запускает конвейер. Джобы идут на разных машинах, и файлы между ними переносят артефактами.',
    href: '/delivery/github-actions/#s3',
    hrefLabel: '«GitHub Actions: конвейер», раздел «Что переживает границу»',
    tone: 'info',
  },
];

// ─── Раздел 1. Какие байты считать ─────────────────────────────────────────────────────────

/**
 * Запись Chromium (шапка, пункт 2): скрипты после прокрутки до конца страницы — число файлов
 * и байтов; `afterClick` — что докачалось по кнопке «2 · Гидратировать» в `SsrLab`.
 * Тест сверяет с замыканием, которое считают функции темы по снимку.
 */
export const CHROMIUM_TRACE: { route: string; atLoad: number; files: number; bytes: number; afterClick?: string[] }[] = [
  { route: '/tooling/source-maps/', atLoad: 0, files: 9, bytes: 124249 },
  { route: '/frameworks/react-vs-vue/', atLoad: 0, files: 18, bytes: 354054 },
  { route: '/frameworks/ssr-hydration/', atLoad: 0, files: 11, bytes: 130993, afterClick: ['react.iDfmHsyG.js', 'react-dom.C-Lc9Vse.js', 'client.CXQRFzvJ.js'] },
];

/** Что Chromium скачал для `/tooling/source-maps/` (см. шапку, пункт 2). gzip/br — пересчёт тех же байтов. */
export const RESOURCE_ROWS: { k: string; files: string; raw: string; gzip: string; when: string; tone?: 'warn' | 'info' }[] = [
  { k: 'HTML', files: '1', raw: '111 045', gzip: '23 582', when: 'сразу. Внутри — 5 905 байт встроенных скриптов Astro, которых нет среди файлов' },
  { k: 'CSS', files: '1', raw: '64 312', gzip: '19 948', when: 'сразу; пока не пришёл, страница не рисуется', tone: 'warn' },
  { k: 'шрифты', files: '7', raw: '178 604', gzip: '178 661', when: 'сразу, как только на экране есть текст этим начертанием. gzip их только раздувает: woff2 уже сжат' },
  { k: 'JS', files: '9', raw: '124 249', gzip: '49 292', when: 'при открытии — **0**. Всё приезжает, когда до острова доскроллили (`client:visible`)', tone: 'info' },
];

export const PLAIN_COMPRESSED =
  'Как вакуумный пакет для одежды. В чемодане он занимает мало места, но, открыв его, вы получаете ту же гору свитеров, и раскладывать по полкам придётся всю. Сжатый размер — это место в чемодане, то есть время в сети. Сырой — сколько разбирать: столько байтов браузер распакует, разберёт и выполнит.';

export const MEASURE_FACTS: { t: string; d: string; tone?: 'warn' | 'err' | 'info' | 'ok' }[] = [
  {
    t: 'Сырые байты — стабильное число',
    d: 'Сторож этого сайта считает несжатые файлы. Число не зависит от сервера, уровня сжатия и заголовков, а в одной и той же сборке оно одинаковое на любой машине. Для вопроса «не утёк ли второй фреймворк» этого хватает: разница там в разы.',
    tone: 'ok',
  },
  {
    t: 'Сжатые — ближе к сети, но плывут',
    d: 'gzip уровня 6 и Brotli 11 дают для одного файла разные числа, а сервер может отдать и то и другое — смотря что попросил браузер. Скрипты обычной страницы сайта жмутся до 40% по gzip и до 36% по Brotli (медианы по 141 странице со скриптами).',
  },
  {
    t: 'Сжатие меняет пропорции',
    d: 'Страница «React против Vue» тяжелее «Source maps» в 2,85 раза сырыми байтами (354 054 против 124 249) и в 2,48 раза — по gzip (122 322 против 49 292). React DOM жмётся лучше, чем рантайм Vue. Порог, переведённый из сырых в сжатые «по среднему коэффициенту», для таких страниц окажется не тем.',
    tone: 'warn',
  },
  {
    t: 'Каждый файл жмётся отдельно',
    d: 'Вес в gzip — сумма сжатых файлов, а не сжатие склеенного бандла: по сети идёт каждый файл своим ответом. Девять файлов «Source maps» по отдельности — 49 292 байта gzip.',
  },
];

export const CRITICAL_NOTE =
  'Вторая развилка — какие файлы считать. **Критический путь** здесь — входы из HTML и всё, что они импортируют статически: без этого остров не оживёт. Динамический `import()` качается позже, по событию. У «SSR и гидратации» статическое замыкание — 11 файлов, 130 993 байта. Когда читатель нажимает «Гидратировать» в демо, браузер докачивает ещё три файла, 219 241 байт: React и React DOM. Бюджет «всех чанков» назвал бы эту страницу трёхсотпятидесятикилобайтной, хотя большинство читателей кнопку не нажмут. Обратная ошибка тоже бывает: тяжёлый `import()`, который зовут сразу при открытии, — критический путь, хотя записан динамическим.';

export const JS_COST_NOTE =
  'Картинка и скрипт одного веса стоят одинаково только по сети. Картинку браузер декодирует, и эта работа может идти вне главного потока: от размера JPEG кнопки не перестают нажиматься. Скрипт после скачивания нужно разобрать, скомпилировать и выполнить, а выполнение идёт в главном потоке — там же, где обработка кликов и отрисовка. Поэтому JS считают отдельной строкой бюджета, а не в общей сумме байтов. Как V8 откладывает разбор тел функций, пока их не вызвали, — в [«Движке V8», раздел «Ярусы»](/js/v8-engine/#s1).';

export const CSS_FONT_NOTE =
  'CSS и шрифты — своя строка бюджета, и считать их надо по-своему. CSS блокирует отрисовку: весь `BaseLayout.css` (64 312 байт) приходит раньше первого пикселя на каждой странице сайта. Шрифт с `unicode-range` браузер качает, только если на странице есть его символы: из 19 файлов `woff2` на диске (606 732 байта) на страницу темы пришло 7. А файлы меньше 4096 байт Vite встраивает прямо в CSS как `data:`. Так в `BaseLayout.css` оказались два вьетнамских начертания IBM Plex Mono — 10 766 знаков base64, которые качает каждый читатель, хотя вьетнамского текста на сайте нет.';

// ─── Раздел 2. Живой бюджет этого сайта ────────────────────────────────────────────────────

/** Пороги — константы `tests/e2e/weight.spec.ts`; «сейчас» — замыкание по сборке 2026-10-02 16:15, КБ = round(байты / 1024). */
export const WEIGHT_TIERS: { name: string; kb: number; pages: string; now: string; tone?: 'warn' | 'info' }[] = [
  { name: 'LEAN_BUDGET_KB', kb: 190, pages: 'все остальные', now: 'самая тяжёлая — `/js/callbacks/`, 174' },
  { name: 'INTERACTIVE_BUDGET_KB', kb: 230, pages: '`/js/object-model/`, `/js/event-loop/`', now: '201 и 175' },
  { name: 'SHOWCASE_BUDGET_KB', kb: 200, pages: '`/kit/`', now: '133' },
  { name: 'LABS_BUDGET_KB', kb: 360, pages: '`/kit/labs/`', now: '355 — запас 5 КБ', tone: 'warn' },
  { name: 'HEAVY_BUDGET_KB', kb: 400, pages: '`/frameworks/react-rerender/`, `/frameworks/react-vs-vue/`', now: '234 и 346', tone: 'info' },
];

/** Дословно из `tests/e2e/weight.spec.ts` — тест требует, чтобы этот текст там был. */
export const WEIGHT_SPEC_EXCERPT = `function staticImports(file: string): string[] {
  const source = readFileSync(fileURLToPath(new URL(\`./_astro/\${file}\`, DIST)), 'utf8');
  return [...source.matchAll(/(?:import|export)\\s*(?:[\\w*{}\\s,$]*?from\\s*)?["']\\.\\/([^"']+\\.js)["']/g)].map((m) => m[1]);
}`;

export const WEIGHT_SPEC_WALK = `function pageChunks(page: string): string[] | null {
  const html = new URL(\`.\${page}index.html\`, DIST);
  if (!existsSync(html)) return null;

  const source = readFileSync(html, 'utf8');
  const queue = [...new Set([...source.matchAll(/\\/_astro\\/([^"'&]+?\\.js)/g)].map((m) => m[1]))];
  const seen = new Set<string>();
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file) || !existsSync(new URL(\`./_astro/\${file}\`, DIST))) continue;
    seen.add(file);
    queue.push(...staticImports(file));
  }
  return [...seen];
}`;

export const WEIGHT_FACTS: { t: string; d: string; tone?: 'warn' | 'err' | 'info' | 'ok' }[] = [
  {
    t: 'Порог — по имени страницы, а не по адресу',
    d: 'Раньше бюджет в 320 КБ выдавался всему `/render/`. Тогда утечка React в общий компонент подняла бы `/render/render-pipeline/` с 14 КБ до двухсот, а тест остался бы зелёным. Теперь тяжёлые страницы перечислены поимённо, а остальным достаётся строгий общий порог.',
    tone: 'warn',
  },
  {
    t: 'Вес — замыкание, а не ссылки из HTML',
    d: 'Первая версия сторожа складывала только файлы, названные в HTML, и видела у «React против Vue» 16 КБ вместо 346: рантайм React тянет рендерер своим `import`, HTML на него не ссылается. Это нашёл стенд [«Островов»](/frameworks/islands/#s5); с тех пор вес — обход графа.',
    tone: 'err',
  },
  {
    t: 'Второе правило — не про байты',
    d: 'Отдельная проверка ищет в графе страницы признак рантайма React — строку `__REACT_DEVTOOLS_GLOBAL_HOOK__`. Не подстроку `react`: её дают `reactive` из Vue и тексты демо. React разрешён только двум страницам, где он предмет темы.',
    tone: 'info',
  },
  {
    t: 'Порог сработал — витрину разделили',
    d: 'Витрина `/kit/` выросла до 233 КБ при пороге 200. Число не подвинули: демо уехали на `/kit/labs/`, витрина стала весить 16 КБ (сегодня 133). Ради такого разговора порог и стоит. Следующий такой разговор близко: `/kit/labs/` весит 355 КБ из 360.',
    tone: 'ok',
  },
];

// ─── Раздел 3. Граф чанков ─────────────────────────────────────────────────────────────────

export const PLAIN_GRAPH =
  'Как список «что взять в поход», где у каждого пункта своя приписка. «Палатка» — а к ней «колышки» и «тент». «Горелка» — а к ней «газ». Чтобы узнать вес рюкзака, мало сложить верхнюю строку: нужно пройти по всем припискам до конца и не положить колышки дважды, если их просят и палатка, и тент.';

export const GRAPH_CODE = `// Статический импорт в минифицированном чанке — пять видов записи:
// import{a as b}from"./x.js"  import x from"./x.js"  import"./x.js"
// export{a}from"./x.js"  export*from"./x.js"
const STATIC_RE = /(?:import|export)\\s*(?:[\\w*{}\\s,$]*?from\\s*)?["']\\.\\/([^"']+\\.js)["']/g;
// Динамический — только с адресом-литералом: import("./x.js") или import(\`./x.js\`).
const DYNAMIC_RE = /\\bimport\\(\\s*(["'\`])\\.\\/([^"'\`$]+?\\.js)\\1\\s*\\)/g;

function parseImports(code) {
  const unique = (re, group) => [...new Set([...code.matchAll(re)].map((m) => m[group]))];
  return { imports: unique(STATIC_RE, 1), dynamic: unique(DYNAMIC_RE, 2) };
}

// files: { 'имя.js': 'текст чанка' } → { 'имя.js': { imports, dynamic } }
function buildGraph(files) {
  const graph = {};
  for (const [name, code] of Object.entries(files)) graph[name] = parseImports(code);
  return graph;
}

// Обход в ширину от входов страницы. parent: модуль → кто первым к нему привёл.
// Раз обход в ширину, цепочка по parent — самая короткая из возможных.
function walk(graph, entries, withDynamic = false) {
  const parent = new Map(entries.filter((e) => graph[e]).map((e) => [e, null]));
  const queue = [...parent.keys()];
  for (let i = 0; i < queue.length; i++) {
    const node = graph[queue[i]];
    const next = withDynamic ? [...node.imports, ...node.dynamic] : node.imports;
    for (const dep of next) {
      if (parent.has(dep) || !graph[dep]) continue;
      parent.set(dep, queue[i]);
      queue.push(dep);
    }
  }
  return parent;
}

// Что скачает страница: входы из HTML и всё, до чего они дотягиваются.
function pageChunks(graph, entries, withDynamic = false) {
  return [...walk(graph, entries, withDynamic).keys()];
}

// «Почему этот модуль на странице»: цепочка импортов от входа до target.
function whyIncluded(graph, entries, target, withDynamic = false) {
  const parent = walk(graph, entries, withDynamic);
  if (!parent.has(target)) return null;
  const chain = [];
  for (let f = target; f !== null; f = parent.get(f)) chain.unshift(f);
  return chain;
}

// Вес — сумма по файлам: каждый файл сжимается и качается отдельно.
// size(имя) отдаёт то, что меряем: сырые байты, gzip или brotli.
function weigh(chunks, size) {
  return chunks.reduce((sum, file) => sum + size(file), 0);
}`;

export const GRAPH_NOTE =
  'Шаблон статического импорта — тот же, что в weight.spec, символ в символ. Обход другой: в ширину, с запоминанием, кто к кому привёл. Набор файлов выходит тот же — тест сравнивает оба обхода на всех страницах сайта, — а заодно появляется ответ на вопрос «почему этот модуль здесь».';

export const PARSE_SAMPLE = `import{a as b}from"./x.js";import c from"./y.js";import"./z.js";
export{d}from"./w.js";export*from"./v.js";
const chart = () => import(\`./chart.js\`);
const page = (n) => import(\`./pages/\${n}.js\`);
const demo = \`import a from "./fake.js"\`;`;

export const PARSE_RESULT = `parseImports(PARSE_SAMPLE)
// { imports: ['x.js', 'y.js', 'z.js', 'w.js', 'v.js', 'fake.js'],
//   dynamic: ['chart.js'] }

// es-module-lexer и acorn: те же пять статических, без fake.js —
// это текст внутри строки. import(\`./pages/\${n}.js\`) не знает никто:
// адрес появится только при выполнении.`;

export const PARSE_FACTS: { t: string; d: string; tone?: 'warn' | 'err' | 'info' | 'ok' }[] = [
  {
    t: 'На этом сайте регулярке можно верить',
    d: 'На всех 313 чанках сборки статические импорты регулярного выражения совпали с разбором `es-module-lexer` и `acorn` до файла, динамические с адресом-литералом — тоже. Но это свойство сегодняшних чанков, а не регулярки: пример выше ломает её одной строкой.',
    tone: 'ok',
  },
  {
    t: '`grep "import("` врёт',
    d: 'Подстроку `import(` в сборке находят семь чанков, а настоящий `import()` с адресом есть в трёх. В `espree` и `RouterLab` это текст внутри строк и регулярных выражений, в `CycleLab` и `LiveBinding` адрес собирается на ходу — из переменной или `Blob`.',
    tone: 'warn',
  },
  {
    t: 'Третий вид ссылки — воркер',
    d: '`CloneLab` запускает `new Worker(new URL("/_astro/worker-vzrt-GLW.js", import.meta.url))`. Ни импортом, ни `import()` это не считается, и файл в 9 894 байта не попадает в замыкание ни одной страницы. Лексер видит здесь только `import.meta`.',
    tone: 'info',
  },
];

export const FX_MAIN = `import { format } from './format.js';
document.querySelector('#out').textContent = format(42);
document.querySelector('#open').addEventListener('click', async () => {
  const { drawChart } = await import('./chart.js');
  drawChart(document.querySelector('#chart'));
});
`;

export const FX_FORMAT = `export const format = (n) => \`\${n} ₽\`;
`;

export const FX_CHART = `import { format } from './format.js';
export function drawChart(el) {
  el.textContent = Array.from({ length: 5 }, (_, i) => format(i * 10)).join(' | ');
}
`;

export const FX_HTML = `<!doctype html><p id="out"></p><button id="open">График</button><div id="chart"></div>
<script type="module" src="/src/main.js"></script>
`;

/** `dist/.vite/manifest.json` фикстуры, как его записал Vite 8.3.0. */
export const VITE_MANIFEST_PRINT = `{
  "index.html": {
    "file": "assets/index-B3Z2VeDg.js",
    "name": "index",
    "src": "index.html",
    "isEntry": true,
    "dynamicImports": [
      "src/chart.js"
    ]
  },
  "src/chart.js": {
    "file": "assets/chart-CMBafmS4.js",
    "name": "chart",
    "src": "src/chart.js",
    "isDynamicEntry": true,
    "imports": [
      "index.html"
    ]
  }
}`;

export const MANIFEST_CODE = `// Vite: build.manifest: true → dist/.vite/manifest.json. Ключи — исходники,
// file — выходной файл, imports и dynamicImports — ключи других записей.
function fromViteManifest(manifest) {
  const graph = {};
  for (const item of Object.values(manifest)) {
    graph[item.file] = {
      imports: (item.imports ?? []).map((key) => manifest[key].file),
      dynamic: (item.dynamicImports ?? []).map((key) => manifest[key].file),
    };
  }
  return graph;
}

// esbuild: metafile: true → result.metafile. Ключи outputs — выходные файлы,
// у каждого импорта есть kind: статический или import().
function fromMetafile(meta) {
  const graph = {};
  for (const [file, out] of Object.entries(meta.outputs)) {
    if (!file.endsWith('.js')) continue;
    const of = (kind) => out.imports.filter((i) => i.kind === kind).map((i) => i.path);
    graph[file] = { imports: of('import-statement'), dynamic: of('dynamic-import') };
  }
  return graph;
}`;

/** `fromMetafile(result.metafile)` для той же фикстуры у esbuild 0.28.2 (`splitting: true`). */
export const ESBUILD_GRAPH_PRINT = `{
  "dist-esb/main.js": {
    "imports": ["dist-esb/chunk-YUQMC27Y.js"],
    "dynamic": ["dist-esb/chunk-6WOFW72W.js"]
  },
  "dist-esb/chunk-6WOFW72W.js": {
    "imports": ["dist-esb/chunk-YUQMC27Y.js"],
    "dynamic": []
  },
  "dist-esb/chunk-YUQMC27Y.js": {
    "imports": [],
    "dynamic": []
  }
}`;

export const MANIFEST_NOTE =
  'Граф не обязательно вытаскивать из текста: сборщик его знает и может отдать файлом. Два сборщика по-разному порезали одни и те же три файла. esbuild вынес общий `format.js` в отдельный чанк на 39 байт. Vite оставил его во входном файле, и `chart` импортирует вход. Манифест Vite нужен прежде всего серверу, который сам пишет HTML со ссылками на чанки. Для бюджета это готовый граф — без регулярок и без риска спутать импорт со строкой.';

// ─── Раздел 4. Кто тянет модуль ────────────────────────────────────────────────────────────

/** Цепочки `whyIncluded` на снимке. Тест пересчитывает их и проверяет, что короче не бывает. */
export const WHY_ROWS: { page: string; target: string; chain: string[]; dynamic?: boolean }[] = [
  { page: '/frameworks/react-vs-vue/', target: 'client.CXQRFzvJ.js', chain: ['client.vyypPQp4.js', 'client.CXQRFzvJ.js'] },
  { page: '/frameworks/ssr-hydration/', target: 'client.CXQRFzvJ.js', chain: ['SsrLab.Bj3JpSIw.js', 'client.CXQRFzvJ.js'], dynamic: true },
  { page: '/js/event-loop/', target: 'useReducedMotion.C8P7bAX7.js', chain: ['EventLoopTurn.BLKtg61H.js', 'usePlayer.fRwnifbH.js', 'useReducedMotion.C8P7bAX7.js'] },
];

export const WHY_NOTE =
  'У рантайма React DOM на «React против Vue» цепочка из двух звеньев: HTML называет рендерер `client.vyypPQp4.js`, а тот импортирует `client.CXQRFzvJ.js` на 207 465 байт. На «SSR и гидратации» тот же файл стоит за `import()` в `SsrLab` и в статическое замыкание не входит. Цепочка — одна из возможных: у `ui.DIEeBnsz.js` на «Цикле событий» пять импортёров, и обход в ширину показывает самый короткий путь. Чтобы убрать модуль со страницы, нужно разорвать все пути, а не один показанный.';

export const PLAIN_WHY =
  'Как вопрос «откуда в квартире этот шкаф». Ответ «его заказал Петя» — одна дорожка. Если шкаф заодно числится в заказе Маши, а Петя от своего откажется, шкаф всё равно приедет. Чтобы шкафа не было, отменить нужно оба заказа.';

export const BUDGET_PAGES: BudgetPage[] = [
  {
    route: '/tooling/source-maps/',
    label: 'Source maps',
    entries: ['SourceMapLab.Cq0Jx8pJ.js', 'client.CCGqtgYw.js'],
    budgetKb: 190,
    budgetName: 'LEAN_BUDGET_KB',
    note: 'Обычная тема с одним островом. Из 124 249 байт 110 853 — общий рантайм Vue: `runtime-core`, `runtime-dom` и рендерер `client`. Их получают 140 страниц сайта. Свой код темы — 13 396 байт.',
  },
  {
    route: '/js/event-loop/',
    label: 'Цикл событий',
    entries: ['EventLoopTurn.BLKtg61H.js', 'client.CCGqtgYw.js', 'CheckpointDemo.DjtOzcyS.js', 'MicroProbe.Dtmj0LIb.js', 'TimerClamp.BTZfcacA.js', 'NodeLoop.BrsjGe-k.js'],
    budgetKb: 230,
    budgetName: 'INTERACTIVE_BUDGET_KB',
    note: 'Пять островов делят общие кирпичи: `ui`, `DemoFrame`, `ConsoleView`. Каждый скачивается один раз, поэтому пятый остров добавляет к весу только себя.',
  },
  {
    route: '/frameworks/ssr-hydration/',
    label: 'SSR',
    entries: ['SsrLab.Bj3JpSIw.js', 'client.CCGqtgYw.js'],
    budgetKb: 190,
    budgetName: 'LEAN_BUDGET_KB',
    note: 'Статически — обычная тема. С учётом `import()` вес почти утраивается: демо подгружает настоящий React, когда читатель просит гидратацию.',
  },
  {
    route: '/frameworks/react-vs-vue/',
    label: 'React и Vue',
    entries: ['Controls.D7ZT1qfF.js', 'client.CCGqtgYw.js', 'ReactPane.niBPb5DR.js', 'client.vyypPQp4.js', 'VuePane.55zLwSc6.js'],
    budgetKb: 400,
    budgetName: 'HEAVY_BUDGET_KB',
    note: 'Два рантайма на одной странице. Самый тяжёлый файл — `client.CXQRFzvJ.js`, React DOM: его нет в HTML, его приводит рендерер.',
  },
  {
    route: '/kit/labs/',
    label: 'Лаборатории',
    entries: ['LockLab.DuqOTwG1.js', 'client.CCGqtgYw.js', 'EnumProbe.xj9UIWyt.js', 'KeyOrder.DuoqwOts.js', 'IterProtocol.C5TFJb3Y.js', 'InstanceofLab.DfOJzjfr.js', 'PollutionLab.BJOcMBuA.js', 'DispatchLab.CTP5bcqt.js', 'TransferRules.BWEVUUBu.js', 'MicroProbe.Dtmj0LIb.js', 'TimerClamp.BTZfcacA.js', 'ResolveCost.Chnp4kML.js', 'YieldMeter.CpKfbiyg.js', 'ThreadProbe.CNKEYAHd.js', 'IcBench.9uZsFsZx.js', 'StringWeight.Ivkvh_m3.js', 'ReachabilityLab.BRwaDfJB.js', 'RetainGraph.CLPkSz7z.js'],
    budgetKb: 360,
    budgetName: 'LABS_BUDGET_KB',
    note: 'Семнадцать островов-лабораторий — 355 КБ при пороге 360. Ещё один стенд средней руки, и сторож покраснеет.',
  },
];

/** Отпечаток сборки, с которой снят снимок: sha-256 (16 знаков) от отсортированных имён `_astro/*.js`. */
export const DIST_FINGERPRINT = '58fcb8c487829230';

export const BUDGET_CHUNKS: Record<string, ChunkInfo> = {
  'SourceMapLab.Cq0Jx8pJ.js': { bytes: 6617, gzip: 2981, br: 2649, pages: 1, imports: ['runtime-core.esm-bundler.CIbLXjQd.js', 'runtime-dom.esm-bundler.B73O2axo.js', '_plugin-vue_export-helper.BDNMzG2s.js', 'Md.BKOm_4qz.js', 'ui.DIEeBnsz.js', 'DemoFrame.Zq4TJu9A.js'], dynamic: [] },
  'client.CCGqtgYw.js': { bytes: 1014, gzip: 620, br: 566, pages: 140, imports: ['runtime-core.esm-bundler.CIbLXjQd.js', 'runtime-dom.esm-bundler.B73O2axo.js'], dynamic: [] },
  'runtime-core.esm-bundler.CIbLXjQd.js': { bytes: 85367, gzip: 32923, br: 29705, pages: 140, imports: [], dynamic: [] },
  'runtime-dom.esm-bundler.B73O2axo.js': { bytes: 24472, gzip: 9550, br: 8705, pages: 140, imports: ['runtime-core.esm-bundler.CIbLXjQd.js'], dynamic: [] },
  '_plugin-vue_export-helper.BDNMzG2s.js': { bytes: 84, gzip: 99, br: 88, pages: 140, imports: [], dynamic: [] },
  'Md.BKOm_4qz.js': { bytes: 764, gzip: 446, br: 383, pages: 135, imports: ['runtime-core.esm-bundler.CIbLXjQd.js', 'format.DnJ71hcm.js', '_plugin-vue_export-helper.BDNMzG2s.js'], dynamic: [] },
  'ui.DIEeBnsz.js': { bytes: 4873, gzip: 1970, br: 1728, pages: 140, imports: ['runtime-core.esm-bundler.CIbLXjQd.js'], dynamic: [] },
  'DemoFrame.Zq4TJu9A.js': { bytes: 673, gzip: 424, br: 372, pages: 139, imports: ['runtime-core.esm-bundler.CIbLXjQd.js', '_plugin-vue_export-helper.BDNMzG2s.js'], dynamic: [] },
  'format.DnJ71hcm.js': { bytes: 385, gzip: 279, br: 233, pages: 135, imports: [], dynamic: [] },
  'EventLoopTurn.BLKtg61H.js': { bytes: 3214, gzip: 1534, br: 1371, pages: 1, imports: ['runtime-core.esm-bundler.CIbLXjQd.js', '_plugin-vue_export-helper.BDNMzG2s.js', 'CodeListing.BnMaHEW6.js', 'ConsoleView.DUkpgC84.js', 'PlayerToolbar.1fX_4HOS.js', 'QueueView.BhIgeQCr.js', 'StackView.B9oiNPDY.js', 'DemoFrame.Zq4TJu9A.js', 'useStepper.QM_sOVEn.js', 'usePlayer.fRwnifbH.js'], dynamic: [] },
  'CheckpointDemo.DjtOzcyS.js': { bytes: 3079, gzip: 1555, br: 1368, pages: 1, imports: ['runtime-core.esm-bundler.CIbLXjQd.js', '_plugin-vue_export-helper.BDNMzG2s.js', 'ui.DIEeBnsz.js', 'ConsoleView.DUkpgC84.js', 'PlayerToolbar.1fX_4HOS.js', 'QueueView.BhIgeQCr.js', 'StackView.B9oiNPDY.js', 'DemoFrame.Zq4TJu9A.js', 'useStepper.QM_sOVEn.js', 'usePlayer.fRwnifbH.js'], dynamic: [] },
  'MicroProbe.Dtmj0LIb.js': { bytes: 27479, gzip: 9253, br: 7964, pages: 2, imports: ['runtime-core.esm-bundler.CIbLXjQd.js', '_plugin-vue_export-helper.BDNMzG2s.js', 'Md.BKOm_4qz.js', 'ui.DIEeBnsz.js', 'CodeListing.BnMaHEW6.js', 'ConsoleView.DUkpgC84.js', 'DemoFrame.Zq4TJu9A.js'], dynamic: [] },
  'TimerClamp.BTZfcacA.js': { bytes: 16702, gzip: 6424, br: 5567, pages: 2, imports: ['runtime-core.esm-bundler.CIbLXjQd.js', '_plugin-vue_export-helper.BDNMzG2s.js', 'Md.BKOm_4qz.js', 'ui.DIEeBnsz.js', 'CodeListing.BnMaHEW6.js', 'ConsoleView.DUkpgC84.js', 'DemoFrame.Zq4TJu9A.js'], dynamic: [] },
  'NodeLoop.BrsjGe-k.js': { bytes: 2819, gzip: 1523, br: 1333, pages: 1, imports: ['runtime-core.esm-bundler.CIbLXjQd.js', '_plugin-vue_export-helper.BDNMzG2s.js', 'ui.DIEeBnsz.js', 'ConsoleView.DUkpgC84.js', 'PlayerToolbar.1fX_4HOS.js', 'DemoFrame.Zq4TJu9A.js', 'useStepper.QM_sOVEn.js', 'usePlayer.fRwnifbH.js'], dynamic: [] },
  'CodeListing.BnMaHEW6.js': { bytes: 817, gzip: 530, br: 474, pages: 22, imports: ['runtime-core.esm-bundler.CIbLXjQd.js', '_plugin-vue_export-helper.BDNMzG2s.js'], dynamic: [] },
  'ConsoleView.DUkpgC84.js': { bytes: 1135, gzip: 674, br: 629, pages: 24, imports: ['runtime-core.esm-bundler.CIbLXjQd.js', '_plugin-vue_export-helper.BDNMzG2s.js'], dynamic: [] },
  'PlayerToolbar.1fX_4HOS.js': { bytes: 2328, gzip: 1208, br: 1055, pages: 22, imports: ['runtime-core.esm-bundler.CIbLXjQd.js', '_plugin-vue_export-helper.BDNMzG2s.js', 'ui.DIEeBnsz.js'], dynamic: [] },
  'QueueView.BhIgeQCr.js': { bytes: 1253, gzip: 727, br: 653, pages: 6, imports: ['runtime-core.esm-bundler.CIbLXjQd.js', 'runtime-dom.esm-bundler.B73O2axo.js', '_plugin-vue_export-helper.BDNMzG2s.js'], dynamic: [] },
  'StackView.B9oiNPDY.js': { bytes: 993, gzip: 623, br: 557, pages: 3, imports: ['runtime-core.esm-bundler.CIbLXjQd.js', '_plugin-vue_export-helper.BDNMzG2s.js'], dynamic: [] },
  'useStepper.QM_sOVEn.js': { bytes: 388, gzip: 269, br: 242, pages: 26, imports: ['runtime-core.esm-bundler.CIbLXjQd.js'], dynamic: [] },
  'usePlayer.fRwnifbH.js': { bytes: 599, gzip: 395, br: 347, pages: 21, imports: ['runtime-core.esm-bundler.CIbLXjQd.js', 'useReducedMotion.C8P7bAX7.js'], dynamic: [] },
  'useReducedMotion.C8P7bAX7.js': { bytes: 367, gzip: 252, br: 208, pages: 25, imports: ['runtime-core.esm-bundler.CIbLXjQd.js'], dynamic: [] },
  'SsrLab.Bj3JpSIw.js': { bytes: 11281, gzip: 4754, br: 4139, pages: 1, imports: ['rolldown-runtime.hePW80VL.js', 'runtime-core.esm-bundler.CIbLXjQd.js', 'runtime-dom.esm-bundler.B73O2axo.js', '_plugin-vue_export-helper.BDNMzG2s.js', 'Md.BKOm_4qz.js', 'ui.DIEeBnsz.js', 'DemoFrame.Zq4TJu9A.js', 'preload-helper.B3nfOi5I.js'], dynamic: ['react.iDfmHsyG.js', 'client.CXQRFzvJ.js'] },
  'rolldown-runtime.hePW80VL.js': { bytes: 716, gzip: 428, br: 381, pages: 4, imports: [], dynamic: [] },
  'preload-helper.B3nfOi5I.js': { bytes: 1364, gzip: 742, br: 630, pages: 4, imports: [], dynamic: [] },
  'react.iDfmHsyG.js': { bytes: 7876, gzip: 3007, br: 2694, pages: 2, imports: ['rolldown-runtime.hePW80VL.js'], dynamic: [] },
  'client.CXQRFzvJ.js': { bytes: 207465, gzip: 64283, br: 55563, pages: 2, imports: ['rolldown-runtime.hePW80VL.js', 'react.iDfmHsyG.js', 'react-dom.C-Lc9Vse.js'], dynamic: [] },
  'react-dom.C-Lc9Vse.js': { bytes: 3900, gzip: 1411, br: 1227, pages: 2, imports: ['rolldown-runtime.hePW80VL.js', 'react.iDfmHsyG.js'], dynamic: [] },
  'Controls.D7ZT1qfF.js': { bytes: 1522, gzip: 952, br: 808, pages: 1, imports: ['runtime-core.esm-bundler.CIbLXjQd.js', '_plugin-vue_export-helper.BDNMzG2s.js', 'Md.BKOm_4qz.js', 'ui.DIEeBnsz.js', 'bus.DvQz9C0S.js'], dynamic: [] },
  'ReactPane.niBPb5DR.js': { bytes: 5444, gzip: 1781, br: 1544, pages: 1, imports: ['bus.DvQz9C0S.js', 'react.iDfmHsyG.js', 'jsx-runtime.CymHavEb.js', 'task.a4k17DAS.js'], dynamic: [] },
  'client.vyypPQp4.js': { bytes: 1877, gzip: 948, br: 837, pages: 2, imports: ['react.iDfmHsyG.js', 'client.CXQRFzvJ.js'], dynamic: [] },
  'VuePane.55zLwSc6.js': { bytes: 6244, gzip: 2372, br: 2058, pages: 2, imports: ['runtime-core.esm-bundler.CIbLXjQd.js', '_plugin-vue_export-helper.BDNMzG2s.js', 'bus.DvQz9C0S.js', 'task.a4k17DAS.js'], dynamic: [] },
  'bus.DvQz9C0S.js': { bytes: 270, gzip: 193, br: 148, pages: 2, imports: [], dynamic: [] },
  'jsx-runtime.CymHavEb.js': { bytes: 1180, gzip: 632, br: 553, pages: 2, imports: ['rolldown-runtime.hePW80VL.js', 'react.iDfmHsyG.js'], dynamic: [] },
  'task.a4k17DAS.js': { bytes: 601, gzip: 428, br: 369, pages: 2, imports: [], dynamic: [] },
  'LockLab.DuqOTwG1.js': { bytes: 6593, gzip: 2919, br: 2507, pages: 2, imports: ['runtime-core.esm-bundler.CIbLXjQd.js', '_plugin-vue_export-helper.BDNMzG2s.js', 'Md.BKOm_4qz.js', 'ui.DIEeBnsz.js', 'DemoFrame.Zq4TJu9A.js'], dynamic: [] },
  'EnumProbe.xj9UIWyt.js': { bytes: 8229, gzip: 3296, br: 2898, pages: 2, imports: ['runtime-core.esm-bundler.CIbLXjQd.js', '_plugin-vue_export-helper.BDNMzG2s.js', 'Md.BKOm_4qz.js', 'ui.DIEeBnsz.js', 'DemoFrame.Zq4TJu9A.js'], dynamic: [] },
  'KeyOrder.DuoqwOts.js': { bytes: 6535, gzip: 3105, br: 2683, pages: 2, imports: ['runtime-core.esm-bundler.CIbLXjQd.js', '_plugin-vue_export-helper.BDNMzG2s.js', 'Md.BKOm_4qz.js', 'ui.DIEeBnsz.js', 'DemoFrame.Zq4TJu9A.js', 'CodeInput.hfwbZYnQ.js'], dynamic: [] },
  'IterProtocol.C5TFJb3Y.js': { bytes: 14498, gzip: 5785, br: 5075, pages: 2, imports: ['runtime-core.esm-bundler.CIbLXjQd.js', '_plugin-vue_export-helper.BDNMzG2s.js', 'Md.BKOm_4qz.js', 'ui.DIEeBnsz.js', 'CodeListing.BnMaHEW6.js', 'ConsoleView.DUkpgC84.js', 'PlayerToolbar.1fX_4HOS.js', 'DemoFrame.Zq4TJu9A.js', 'useStepper.QM_sOVEn.js', 'usePlayer.fRwnifbH.js'], dynamic: [] },
  'InstanceofLab.DfOJzjfr.js': { bytes: 11749, gzip: 4585, br: 4021, pages: 2, imports: ['runtime-core.esm-bundler.CIbLXjQd.js', '_plugin-vue_export-helper.BDNMzG2s.js', 'Md.BKOm_4qz.js', 'ui.DIEeBnsz.js', 'CodeListing.BnMaHEW6.js', 'PlayerToolbar.1fX_4HOS.js', 'DemoFrame.Zq4TJu9A.js', 'useStepper.QM_sOVEn.js', 'usePlayer.fRwnifbH.js'], dynamic: [] },
  'PollutionLab.BJOcMBuA.js': { bytes: 8304, gzip: 3409, br: 2969, pages: 2, imports: ['runtime-core.esm-bundler.CIbLXjQd.js', '_plugin-vue_export-helper.BDNMzG2s.js', 'Md.BKOm_4qz.js', 'ui.DIEeBnsz.js', 'CodeListing.BnMaHEW6.js', 'ConsoleView.DUkpgC84.js', 'DemoFrame.Zq4TJu9A.js'], dynamic: [] },
  'DispatchLab.CTP5bcqt.js': { bytes: 16326, gzip: 5995, br: 5240, pages: 2, imports: ['runtime-core.esm-bundler.CIbLXjQd.js', '_plugin-vue_export-helper.BDNMzG2s.js', 'Md.BKOm_4qz.js', 'ui.DIEeBnsz.js', 'CodeListing.BnMaHEW6.js', 'ConsoleView.DUkpgC84.js', 'DemoFrame.Zq4TJu9A.js'], dynamic: [] },
  'TransferRules.BWEVUUBu.js': { bytes: 22284, gzip: 6849, br: 5949, pages: 2, imports: ['runtime-core.esm-bundler.CIbLXjQd.js', '_plugin-vue_export-helper.BDNMzG2s.js', 'Md.BKOm_4qz.js', 'ui.DIEeBnsz.js', 'DemoFrame.Zq4TJu9A.js'], dynamic: [] },
  'ResolveCost.Chnp4kML.js': { bytes: 13572, gzip: 4959, br: 4306, pages: 2, imports: ['runtime-core.esm-bundler.CIbLXjQd.js', 'format.DnJ71hcm.js', '_plugin-vue_export-helper.BDNMzG2s.js', 'Md.BKOm_4qz.js', 'ui.DIEeBnsz.js', 'CodeListing.BnMaHEW6.js', 'ConsoleView.DUkpgC84.js', 'DemoFrame.Zq4TJu9A.js', 'promise-sim.DNAUw5qK.js', 'run.PTBqwN7o.js'], dynamic: [] },
  'YieldMeter.CpKfbiyg.js': { bytes: 14952, gzip: 5843, br: 5036, pages: 2, imports: ['runtime-core.esm-bundler.CIbLXjQd.js', '_plugin-vue_export-helper.BDNMzG2s.js', 'Md.BKOm_4qz.js', 'ui.DIEeBnsz.js', 'ConsoleView.DUkpgC84.js', 'DemoFrame.Zq4TJu9A.js'], dynamic: [] },
  'ThreadProbe.CNKEYAHd.js': { bytes: 15580, gzip: 6244, br: 5328, pages: 2, imports: ['runtime-core.esm-bundler.CIbLXjQd.js', '_plugin-vue_export-helper.BDNMzG2s.js', 'Md.BKOm_4qz.js', 'ui.DIEeBnsz.js', 'DemoFrame.Zq4TJu9A.js'], dynamic: [] },
  'IcBench.9uZsFsZx.js': { bytes: 8657, gzip: 3719, br: 3173, pages: 2, imports: ['runtime-core.esm-bundler.CIbLXjQd.js', '_plugin-vue_export-helper.BDNMzG2s.js', 'Md.BKOm_4qz.js', 'ui.DIEeBnsz.js', 'DemoFrame.Zq4TJu9A.js'], dynamic: [] },
  'StringWeight.Ivkvh_m3.js': { bytes: 7768, gzip: 3270, br: 2852, pages: 2, imports: ['runtime-core.esm-bundler.CIbLXjQd.js', '_plugin-vue_export-helper.BDNMzG2s.js', 'Md.BKOm_4qz.js', 'ui.DIEeBnsz.js', 'DemoFrame.Zq4TJu9A.js'], dynamic: [] },
  'ReachabilityLab.BRwaDfJB.js': { bytes: 17882, gzip: 6649, br: 5762, pages: 2, imports: ['runtime-core.esm-bundler.CIbLXjQd.js', '_plugin-vue_export-helper.BDNMzG2s.js', 'Md.BKOm_4qz.js', 'ui.DIEeBnsz.js', 'ConsoleView.DUkpgC84.js', 'DemoFrame.Zq4TJu9A.js'], dynamic: [] },
  'RetainGraph.CLPkSz7z.js': { bytes: 20435, gzip: 7944, br: 7000, pages: 2, imports: ['runtime-core.esm-bundler.CIbLXjQd.js', '_plugin-vue_export-helper.BDNMzG2s.js', 'Md.BKOm_4qz.js', 'ui.DIEeBnsz.js', 'DemoFrame.Zq4TJu9A.js'], dynamic: [] },
  'CodeInput.hfwbZYnQ.js': { bytes: 940, gzip: 611, br: 538, pages: 13, imports: ['runtime-core.esm-bundler.CIbLXjQd.js', 'runtime-dom.esm-bundler.B73O2axo.js', '_plugin-vue_export-helper.BDNMzG2s.js'], dynamic: [] },
  'promise-sim.DNAUw5qK.js': { bytes: 1342, gzip: 708, br: 616, pages: 2, imports: [], dynamic: [] },
  'run.PTBqwN7o.js': { bytes: 438, gzip: 306, br: 275, pages: 2, imports: [], dynamic: [] },
};

export const LAB_CAPTION =
  'Дерево — это обход в ширину функцией `walk`: каждый чанк висит под тем, кто первым к нему привёл, и встречается один раз, хотя импортёров у него бывает много. Цепочку для выбранного чанка считает `whyIncluded`, сумму — `weigh`; размеры сняты с `dist/` сборки от 2 октября. Пометка «на N стр.» — сколько страниц сайта получают этот же файл: правка в чанке с отметкой 140 меняет вес 140 страниц сразу.';

// ─── Раздел 5. Байты против метрик ─────────────────────────────────────────────────────────

export const METRICS_LEAD =
  'Бюджет в байтах отвечает на вопрос «сколько мы отправляем». Пользователю важно другое: когда появилось главное и как быстро страница ответила на клик. Эти числа меряют синтетикой и RUM, и разница между ними разобрана в [«Критическом пути и Web Vitals», раздел «Чем это мерить»](/render/rendering-crp/#s5). Здесь — что из этого годится в проверку на пул-реквест.';

/** Схема конфига Lighthouse CI — по документации, на стенде не запускалась. */
export const LHCI_CONFIG = `{
  "ci": {
    "collect": { "staticDistDir": "./dist", "numberOfRuns": 5 },
    "assert": {
      "assertions": {
        "resource-summary:script:size": ["error", { "maxNumericValue": 194560 }],
        "total-blocking-time": ["warn", { "maxNumericValue": 200, "aggregationMethod": "median-run" }]
      }
    }
  }
}`;

/** Схема конфига size-limit — по документации, на стенде не запускалась. */
export const SIZE_LIMIT_CONFIG = `[
  { "path": "dist/_astro/runtime-core.*.js", "limit": "35 kB" },
  { "path": "dist/_astro/SourceMapLab.*.js", "limit": "4 kB" }
]`;

export const TOOL_ROWS: { k: string; what: string; noise: string; page: string; tone?: 'ok' | 'warn' }[] = [
  {
    k: 'свой скрипт по графу',
    what: 'байты замыкания каждой страницы; цепочку «кто тянет»',
    noise: 'нет: одна сборка — одно число',
    page: 'да, по HTML — входы именно этой страницы',
    tone: 'ok',
  },
  {
    k: 'size-limit',
    what: 'сжатый размер заданных файлов или того, что соберётся из заданного импорта',
    noise: 'нет для байтов; у режима «время выполнения» — есть',
    page: 'нет: файлы перечисляет человек, о HTML и чанках страницы он не знает',
  },
  {
    k: 'Lighthouse CI',
    what: 'метрики загрузки (LCP, TBT, CLS) и сводку по ресурсам из прогона в браузере',
    noise: 'да, у метрик времени — заметный от прогона к прогону',
    page: 'да, но видит только то, что скачалось за время прогона',
    tone: 'warn',
  },
];

export const METRIC_FACTS: { t: string; d: string; tone?: 'warn' | 'err' | 'info' | 'ok' }[] = [
  {
    t: 'Время шумит, байты — нет',
    d: 'Прогон Lighthouse на машине CI делит процессор с соседями, и TBT с LCP от запуска к запуску гуляют. Поэтому Lighthouse CI берёт несколько прогонов и сравнивает медиану, а порог на время разумно делать предупреждением, не ошибкой. Байты одной сборки одинаковы при любом числе запусков.',
    tone: 'warn',
  },
  {
    t: 'Синтетика видит только то, что скачалось',
    d: 'Chromium, открывший «Source maps» без прокрутки, не скачал ни одного скрипта: острова ждут, пока их покажут. Сводка ресурсов такого прогона скажет «0 байт JS» — и будет права про первый экран, но не про страницу. Бюджет по графу считает то, что страница скачает за всю жизнь, без браузера.',
    tone: 'info',
  },
  {
    t: 'size-limit хорош для библиотек',
    d: 'Он отвечает на вопрос «сколько весит то, что получит пользователь моего пакета», и умеет собрать вход сам, чтобы учесть tree shaking. Вопрос «что скачает эта страница» ему не задать: о HTML и о том, какие чанки ему нужны, он не знает. Для сайта нужен граф.',
  },
  {
    t: 'RUM — после выката, не до',
    d: 'Полевые числа приходят от настоящих посетителей, то есть после того, как правка уехала в прод. Проверять ими пул-реквест нельзя. Их место — подтвердить, что бюджет в байтах вообще связан с тем, что чувствуют люди.',
  },
];

// ─── Раздел 6. Бюджет в CI ─────────────────────────────────────────────────────────────────

export const CI_CODE = `// Имя без хеша: client.CCGqtgYw.js → client.js. Хеш меняется от любой
// правки в графе, поэтому сравнивать базу и ветку по полному имени нельзя.
const stripHash = (file) => file.replace(/\\.[\\w-]{8}\\.js$/, '.js');

// Имя без хеша не уникально (у страницы бывает три client.js),
// поэтому одноимённые файлы складываются в одну строку отчёта.
function groupByName(files) {
  const groups = {};
  for (const [file, bytes] of Object.entries(files)) {
    const name = stripHash(file);
    groups[name] = (groups[name] ?? 0) + bytes;
  }
  return groups;
}

// base, head: { 'имя.хеш.js': байты } — замыкание страницы в main и в ветке.
// Порог решает, красный ли прогон; допуск — какие изменения не печатать.
function checkBudget({ base, head, budget, tolerance }) {
  const sum = (files) => Object.values(files).reduce((s, b) => s + b, 0);
  const before = groupByName(base), after = groupByName(head);
  const changes = [];
  for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const delta = (after[name] ?? 0) - (before[name] ?? 0);
    if (Math.abs(delta) > tolerance) changes.push({ name, before: before[name] ?? 0, after: after[name] ?? 0, delta });
  }
  const total = sum(head);
  return { total, delta: total - sum(base), budget, over: total > budget, changes };
}

// Строки для комментария в пул-реквесте.
function report(page, r) {
  const kb = (n) => (n / 1024).toFixed(1);
  const sign = (n) => (n > 0 ? '+' : '') + n;
  const verdict = r.over ? 'ПРЕВЫШЕН' : 'в бюджете';
  const lines = [\`\${verdict} · \${page}: \${kb(r.total)} КБ из \${kb(r.budget)} (\${sign(r.delta)} Б)\`];
  for (const c of r.changes) lines.push(\`  \${c.name}: \${c.before} → \${c.after} (\${sign(c.delta)} Б)\`);
  return lines.join('\\n');
}`;

/** Замыкание `/js/event-loop/` на 2026-10-01 14:05 — из `STAND_PAGES` темы «Острова»; тест сверяет. */
export const CI_BASE_EVENT_LOOP: Record<string, number> = {
  'EventLoopTurn.BsR3SMkP.js': 3214, 'runtime-core.esm-bundler.CIbLXjQd.js': 85367, '_plugin-vue_export-helper.BDNMzG2s.js': 84,
  'CodeListing.BnMaHEW6.js': 817, 'ConsoleView.DUkpgC84.js': 1135, 'PlayerToolbar.1fX_4HOS.js': 2328, 'ui.DIEeBnsz.js': 4873,
  'QueueView.BhIgeQCr.js': 1253, 'runtime-dom.esm-bundler.B73O2axo.js': 24472, 'StackView.B9oiNPDY.js': 993,
  'DemoFrame.Zq4TJu9A.js': 673, 'usePlayer.fRwnifbH.js': 599, 'useReducedMotion.C8P7bAX7.js': 367, 'useStepper.QM_sOVEn.js': 388,
  'client.CCGqtgYw.js': 1014, 'CheckpointDemo.BzV6RXym.js': 3079, 'MicroProbe.D3lduHqX.js': 27479, 'Md.Cwq0d9Ip.js': 695,
  'format.DnJ71hcm.js': 385, 'TimerClamp.Dxk6-e3d.js': 16702, 'NodeLoop.BqWfdoBv.js': 2819,
};

/** То же для `/frameworks/react-vs-vue/`. */
export const CI_BASE_REACT_VS_VUE: Record<string, number> = {
  'Controls.VJtZrBdZ.js': 1522, 'runtime-core.esm-bundler.CIbLXjQd.js': 85367, '_plugin-vue_export-helper.BDNMzG2s.js': 84,
  'Md.Cwq0d9Ip.js': 695, 'format.DnJ71hcm.js': 385, 'ui.DIEeBnsz.js': 4873, 'bus.DvQz9C0S.js': 270, 'client.CCGqtgYw.js': 1014,
  'runtime-dom.esm-bundler.B73O2axo.js': 24472, 'ReactPane.niBPb5DR.js': 5444, 'react.iDfmHsyG.js': 7876,
  'rolldown-runtime.hePW80VL.js': 716, 'jsx-runtime.CymHavEb.js': 1180, 'task.a4k17DAS.js': 601, 'client.vyypPQp4.js': 1877,
  'client.CXQRFzvJ.js': 207465, 'react-dom.C-Lc9Vse.js': 3900, 'VuePane.55zLwSc6.js': 6244,
};

/** `report(…, checkBudget({ base: CI_BASE_*, head: замыкание по снимку, budget, tolerance: 0 }))`. */
export const CI_REPORT_EVENT_LOOP = `в бюджете · /js/event-loop/: 174.6 КБ из 230.0 (+69 Б)
  Md.js: 695 → 764 (+69 Б)`;

export const CI_REPORT_REACT_VS_VUE = `в бюджете · /frameworks/react-vs-vue/: 345.8 КБ из 400.0 (+69 Б)
  Md.js: 695 → 764 (+69 Б)`;

/** Мысленный опыт на настоящих чанках: острову «Source maps» добавили рендерер React. Допуск 100 байт. */
export const CI_REPORT_LEAK = `ПРЕВЫШЕН · /tooling/source-maps/: 338.0 КБ из 190.0 (+221834 Б)
  client.js: 1014 → 210356 (+209342 Б)
  react.js: 0 → 7876 (+7876 Б)
  rolldown-runtime.js: 0 → 716 (+716 Б)
  react-dom.js: 0 → 3900 (+3900 Б)`;

export const CI_DIFF_NOTE =
  'Между двумя сборками сайта прошли сутки. У «Цикла событий» из 21 файла поменяли имя шесть, и сравнение по полному имени выдаёт двенадцать строк: шесть «удалено» и шесть «добавлено». По имени без хеша остаётся одна: `Md.js` вырос на 69 байт. Остальные пять файлов сменили хеш, не изменив размера. На «React против Vue» имя без хеша не уникально: там три разных `client.*.js` — рендерер Vue, рендерер React и React DOM, — поэтому одноимённые файлы складываются в одну строку.';

export const CI_LEAK_NOTE =
  'Обратная сторона той же склейки. Если острову обычной темы добавить рендерер React, отчёт покраснеет верно: 338 КБ при пороге 190. Но 207 465 байт React DOM спрячутся в строке `client.js` рядом с рендерером Vue. Сумма честная, имя сбивает с толку, поэтому к выросшей строке полезно приложить цепочку `whyIncluded` — она назовёт настоящий файл и того, кто его привёл.';

/** Схема конвейера — по документации GitHub Actions и gh, не запускалась. */
export const WORKFLOW_YAML = `# .github/workflows/budget.yml
on: pull_request
permissions:
  contents: read
  pull-requests: write          # чтобы оставить комментарий
jobs:
  budget:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }  # базовая ветка тоже нужна
      - run: npm ci && npm run build && node scripts/weights.mjs > head.json
      - name: та же сборка в базовой ветке
        run: |
          git worktree add ../base "origin/\${{ github.base_ref }}"
          cd ../base && npm ci && npm run build
          node scripts/weights.mjs > "$GITHUB_WORKSPACE/base.json"
      - run: node scripts/budget.mjs base.json head.json > report.md  # код 1 — порог превышен
      - if: always()
        run: gh pr comment "$PR" --body-file report.md
        env:
          GH_TOKEN: \${{ github.token }}
          PR: \${{ github.event.pull_request.number }}`;

export const CI_STEPS: { k: string; d: string }[] = [
  { k: '1. Порог', d: 'Абсолютное число на страницу. Только оно делает прогон красным. Сравнение с базой красным не делает: рост на 2 КБ у страницы со стокилобайтным запасом — повод посмотреть, а не запрет.' },
  { k: '2. База', d: 'Вес той же страницы в `main`. Её либо собирают в том же прогоне, как в схеме, — вдвое дольше, — либо берут файлом `base.json`, который конвейер `main` сохранил артефактом.' },
  { k: '3. Допуск', d: 'Изменения меньше допуска в отчёт не попадают. Для сырых байтов шума нет, и допуск 0 честен. Для времени из Lighthouse без допуска отчёт будет пестрить ростом и падением на ровном месте.' },
  { k: '4. Комментарий', d: 'Отчёт идёт в пул-реквест, даже если шаг с порогом упал, — для этого `if: always()`. Права на комментарий даёт `pull-requests: write`; у пул-реквеста из форка токен только на чтение, и комментарий не пройдёт — см. [«GitHub Actions», раздел «Права и секреты»](/delivery/github-actions/#s7).' },
];

export const FALSE_ROWS: { k: string; how: string; fix: string; tone?: 'warn' | 'err' }[] = [
  { k: 'смена хеша', how: 'Пять файлов «Цикла событий» сменили имя за сутки без единого нового байта', fix: 'сравнивать по имени без хеша — `stripHash`', tone: 'warn' },
  { k: 'общий чанк', how: '`Md` вырос на 69 байт — и вырос вес 135 страниц сразу. Отчёт по страницам повторит одну правку 135 раз', fix: 'печатать общий чанк один раз со списком задетых страниц' },
  { k: 'одноимённые файлы', how: 'Три `client.*.js` на одной странице; склейка прячет React DOM в строке рендерера Vue', fix: 'группа плюс цепочка `whyIncluded` для выросших' },
  { k: 'разные сборки базы', how: 'База собрана другой версией сборщика или с другим lock-файлом — разница в чанках не от вашей правки', fix: 'база из того же конвейера и того же `npm ci`', tone: 'err' },
  { k: 'порог впритык', how: '`/kit/labs/` — 355 из 360. Любая правка общего слоя на 5 КБ покраснит чужую страницу', fix: 'запас в пороге и отдельная строка отчёта «близко к порогу»', tone: 'warn' },
];

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'Ссылки из HTML — ещё не вес',
    d: 'Самый тяжёлый файл страницы часто не назван в HTML: рантайм приводит рендерер своим `import`. Бюджет по ссылкам из разметки видел у «React против Vue» 16 КБ вместо 346. Считать нужно замыкание.',
    tone: 'err',
  },
  {
    n: '02',
    t: 'Сжатый бюджет и сырой — не одно число в другом масштабе',
    d: 'React DOM жмётся лучше рантайма Vue, поэтому отношение страниц в gzip другое, чем в сырых байтах: 2,48 против 2,85. А `woff2` от gzip только растёт. Порог задают в той единице, в которой он будет проверяться.',
    tone: 'warn',
  },
  {
    n: '03',
    t: '`import()` — не всегда «потом»',
    d: 'Динамический импорт, который зовут при открытии страницы, — часть критического пути, хотя статический обход его не видит. А `import()` по кнопке, как React в «SSR и гидратации», в бюджет первой загрузки честно не входит. Решает не синтаксис, а момент вызова.',
    tone: 'warn',
  },
  {
    n: '04',
    t: 'Регулярка не знает строк',
    d: 'Текст `import a from "./fake.js"` внутри строки регулярка примет за импорт, а лексер — нет. На сегодняшних чанках сайта ответы совпали, но код демо, где лежат примеры импортов, может это сломать. Если граф нужен надёжно — лексер или манифест сборщика.',
  },
  {
    n: '05',
    t: 'Воркеры и адреса из переменных выпадают из графа',
    d: '`new Worker(new URL(…))`, `import(base + "x.js")` и `Blob` статический анализ не видит. Файл воркера на этом сайте не входит в вес ни одной страницы. Такие файлы перечисляют в бюджете руками.',
  },
  {
    n: '06',
    t: 'Сравнение по полному имени шумит',
    d: 'Хеш в имени меняется вслед за импортами, даже если байты те же: пять из шести «новых» файлов «Цикла событий» были переименованием. Сравнивать с базой надо по имени без хеша — и помнить, что оно не уникально.',
    tone: 'warn',
  },
  {
    n: '07',
    t: 'Правка общего чанка красит чужие страницы',
    d: '`Md` получают 135 страниц, рантайм Vue — 140. Рост общего файла упрётся в порог той страницы, где запас меньше всего, — сегодня это `/kit/labs/`, а не та тема, которую вы правили.',
    tone: 'err',
  },
  {
    n: '08',
    t: 'Метрика времени на CI — предупреждение, не стоп',
    d: 'TBT и LCP с машины CI гуляют от прогона к прогону. Жёсткий порог на них даёт красные прогоны без правки. Жёсткий порог — на байты; время — медианой нескольких прогонов и мягко.',
  },
];

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'Vite — build.manifest',
    href: 'https://vite.dev/config/build-options#build-manifest',
    what: 'манифест сборки: `file`, `imports`, `dynamicImports`, `isEntry`; на стенде — Vite 8.3.0',
  },
  {
    title: 'Vite — Backend Integration',
    href: 'https://vite.dev/guide/backend-integration',
    what: 'зачем манифест серверу и как по нему обойти статические импорты входа',
  },
  {
    title: 'esbuild — Metafile',
    href: 'https://esbuild.github.io/api/#metafile',
    what: '`outputs`, `imports` с полем `kind`; на стенде — 0.28.2',
  },
  {
    title: 'es-module-lexer',
    href: 'https://github.com/guybedford/es-module-lexer',
    what: 'разбор импортов без полного парсера; типы импорта `Static`, `Dynamic`, `ImportMeta`; на стенде — 2.3.2',
  },
  {
    title: 'Lighthouse CI — Configuration',
    href: 'https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/configuration.md',
    what: '`collect.numberOfRuns`, `staticDistDir`, `assert.assertions`, `aggregationMethod`; по документации',
  },
  {
    title: 'Lighthouse — Score Variability',
    href: 'https://github.com/GoogleChrome/lighthouse/blob/main/docs/variability.md',
    what: 'откуда шум в метриках и почему берут медиану нескольких прогонов',
  },
  {
    title: 'size-limit',
    href: 'https://github.com/ai/size-limit',
    what: 'лимиты на сжатый размер файлов и входов библиотек; по документации',
  },
  {
    title: 'V8 — The cost of JavaScript in 2019',
    href: 'https://v8.dev/blog/cost-of-javascript-2019',
    what: 'разбор, компиляция и выполнение скрипта; что уходит с главного потока, а что нет',
  },
  {
    title: 'web.dev — Performance budgets 101',
    href: 'https://web.dev/articles/performance-budgets-101',
    what: 'бюджеты по количеству, по метрикам и по правилам',
  },
  {
    title: 'GitHub CLI — gh pr comment',
    href: 'https://cli.github.com/manual/gh_pr_comment',
    what: 'комментарий в пул-реквест из конвейера, `--body-file`, `--edit-last`',
  },
];

export const RELATED =
  'Смежное на сайте: [Острова и resumability, раздел «Что и когда скачивается»](/frameworks/islands/#s5) — когда браузер качает код острова и почему первый остров самый дорогой. [Бандлер изнутри, раздел «Хеши в именах»](/tooling/bundler-internals/#s5) — почему одна правка меняет имена многих файлов. [Модули и сборка, раздел «Чанки и кеш»](/tooling/modules/#s5) — как нарезка на чанки бережёт кеш. [Публикация npm-пакета](/tooling/package-publishing/) — `sideEffects` и то, сколько библиотека отдаст в чужой бандл. [Сжатие в вебе](/platform/compression/) — gzip, Brotli и zstd по сети. [Критический путь и Web Vitals](/render/rendering-crp/) — метрики, ради которых байты и считают. [GitHub Actions: конвейер](/delivery/github-actions/) — где живёт проверка.';
