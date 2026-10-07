import type { Pitfall } from '@/widgets/pitfalls/model/types';
import { stepLabel } from '@/widgets/next-cache-lab/model/run';
import type { Scenario, StandStep, Step } from '@/widgets/next-cache-lab/model/types';

/**
 * Данные темы «Слои кеша в Next.js: от fetch до роутера».
 *
 * Тема написана здесь, 2026-10-01.
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * `next` **16.3.8** (Turbopack), React 19.3.0 — из `node_modules` проекта; Node 24.11.0;
 * Chromium 153 (Playwright 1.63), октябрь 2026. Приложение — `APP_FILES` ниже (App Router,
 * четыре страницы и обработчик `/api/revalidate`), рядом — «бэкенд данных» на `node:http`,
 * который на `GET /data/<ключ>` отвечает `{ n }` — номер запроса по этому ключу — и пишет
 * журнал. `next build` и `next start` в чистом каталоге, `NEXT_TELEMETRY_DISABLED=1`.
 * Единственная настройка `next.config` — `turbopack.root: '/'` (и `outputFileTracingRoot`):
 * `node_modules` стенда — симлинк в проект, и Turbopack без этого падает «Symlink … points out
 * of the filesystem root». На кеш она не влияет.
 *
 * Сценарии `SCENARIO_STEPS`: запросы «как curl» (`get`) — на одной сборке, по очереди
 * (ключи у сценариев не пересекаются); вкладка (`router`) — Chromium на своей чистой сборке.
 * После каждого шага стенд ждёт, пока журнал бэкенда затихнет, и записывает: какие ключи
 * дошли до бэкенда (набор, без порядка — фоновый запрос идёт параллельно с рендером),
 * `x-nextjs-cache`, `Cache-Control`, что на странице (`ключ=n`), а во вкладке — запросы
 * к серверу (`document`, `rsc`, `prefetch`, `action`; префетч по сегментам свёрнут в один
 * адрес). Интервалы `revalidate` — 3 и 5 с, паузы — 5 и 6 с: это порядок событий, не замер.
 * Всё это, а также таблицы `next build` (`BUILD_TABLE`, `APP2_BUILD_TABLE`), повторную сборку
 * без очистки `.next` (`REBUILD_HITS`) и вариант с `cacheComponents` (`APP2_*`) пересобирает
 * настоящим Next `tests/unit/next-cache-stand.test.ts` (около двух минут, три сборки).
 *
 * Модель (`ROUTES_CODE`, `SERVER_MODEL_CODE`, `ROUTER_MODEL_CODE`) прогоняется
 * `tests/unit/next-cache.test.ts` по тем же сценариям и обязана дать журнал стенда шаг в шаг.
 *
 * Снято разово, тестом не пересобирается (скрипты в scratchpad агента):
 *   — префетч по сегменту (`Next-Router-Segment-Prefetch`) устаревшей ISR-страницы получает
 *     `STALE`, но перегенерацию не запускает: два таких запроса — бэкенд молчит, первый
 *     RSC-переход — запрос ушёл; модель следует этому;
 *   — `cacheLife({ stale: 30, revalidate: 3, expire: 60 })` без `<Suspense>` вокруг — `next build`
 *     падает с «encountered uncached or runtime data during prerendering»; с `expire: 600` — проходит.
 *
 * Только по документации (`node_modules/next/dist/docs` 16.3.8): история значений по умолчанию
 * (`fetch` кешировался до 15-й; `staleTimes.dynamic` 30 → 0 с в 15-й), сроки кеша роутера
 * 5 мин / 0 с как числа (на стенде видно только «статика без запроса, динамика — каждый раз»),
 * отсутствие кеша маршрута в `next dev`, мягкие теги `_N_T_`, склейка не работает в `route.js`,
 * правило коротких сроков `cacheLife`, `revalidateTag` с одним аргументом. Профили `cacheLife`
 * сверены тестом с `dist/server/config-shared.js` (у `'max'` `expire` — год; комментарий
 * в `next/cache.d.ts` пишет «never» — код с ним расходится).
 */

// ─── Стенд: приложение Next и сценарии ─────────────────────────────────────────────────────

/**
 * Файлы стенда. `tests/unit/next-cache-stand.test.ts` пишет их в чистый каталог, собирает
 * `next build` и запускает `next start` — то, что читатель видит здесь, и есть то, что
 * собирается. `next.config.mjs` стенда (только `turbopack.root`, см. шапку) — в самом тесте.
 */
export const APP_FILES: Record<string, string> = {
  'app/lib.js': `import http from 'node:http';

// Бэкенд стенда на каждый запрос отдаёт { n } — который это раз для ключа.
const B = process.env.BACKEND;

export const get = (key, init) =>
  fetch(\`\${B}/data/\${key}\`, init).then((r) => r.json());

// Не fetch — как запрос к базе: Next его не видит и сам не кеширует.
export const query = (key) =>
  new Promise((ok) => {
    http.get(\`\${B}/data/\${key}\`, (r) => {
      let s = '';
      r.on('data', (c) => (s += c)).on('end', () => ok(JSON.parse(s)));
    });
  });
`,
  'app/layout.jsx': `import Link from 'next/link';

export default function Layout({ children }) {
  return (
    <html lang="ru">
      <body>
        <nav>
          <Link href="/static">static</Link> <Link href="/isr">isr</Link>{' '}
          <Link href="/tagged">tagged</Link> <Link href="/dynamic">dynamic</Link>
        </nav>
        {children}
      </body>
    </html>
  );
}
`,
  'app/page.jsx': `export default function Home() {
  return <p>стенд</p>;
}
`,
  'app/static/page.jsx': `import { get } from '../lib';

async function Menu() {
  const { n } = await get('menu', { cache: 'force-cache' });
  return <li>menu: {n}</li>;
}

async function Banner() {
  const { n } = await get('banner');            // без опций
  return <li>banner: {n}</li>;
}

// Menu дважды: один и тот же fetch в одном рендере.
export default function Page() {
  return <ul><Menu /><Menu /><Banner /></ul>;
}
`,
  'app/isr/page.jsx': `import { get } from '../lib';

export default async function Page() {
  const { n } = await get('rates', { next: { revalidate: 3 } });
  return <ul><li>rates: {n}</li></ul>;
}
`,
  'app/tagged/page.jsx': `import { get } from '../lib';
import { publish } from './actions';

export default async function Page() {
  const { n } = await get('post', { cache: 'force-cache', next: { tags: ['post'] } });
  return (
    <>
      <ul><li>post: {n}</li></ul>
      <form action={publish}><button>Опубликовать</button></form>
    </>
  );
}
`,
  'app/tagged/actions.js': `'use server';
import { updateTag } from 'next/cache';

export async function publish() {
  // …запись в базу…
  updateTag('post');
}
`,
  'app/dynamic/page.jsx': `import { cookies } from 'next/headers';
import { unstable_cache } from 'next/cache';
import { get, query } from '../lib';

const getUser = unstable_cache(() => query('user'), ['user'], { tags: ['user'] });

async function Cart() {
  const { n } = await get('cart');              // тот же fetch, что в Page
  return <li>cart: {n}</li>;
}

async function Stock() {
  // Свой сигнал выключает мемоизацию: два одинаковых запроса.
  const a = await get('stock', { signal: new AbortController().signal });
  const b = await get('stock', { signal: new AbortController().signal });
  return <><li>stock: {a.n}</li><li>stock: {b.n}</li></>;
}

export default async function Page() {
  await cookies();                              // этого достаточно: маршрут динамический
  const cart = await get('cart');
  const catalog = await get('catalog', { cache: 'force-cache' });
  const user = await getUser();
  const news = await get('news', { next: { revalidate: 5 } });
  return (
    <ul>
      <li>cart: {cart.n}</li>
      <li>catalog: {catalog.n}</li>
      <li>user: {user.n}</li>
      <li>news: {news.n}</li>
      <Cart />
      <Stock />
    </ul>
  );
}
`,
  'app/api/revalidate/route.js': `import { revalidatePath, revalidateTag } from 'next/cache';

// Вебхук «данные изменились». Зовут его снаружи — не из вкладки.
export async function POST(req) {
  const q = new URL(req.url).searchParams;
  if (q.has('tag')) revalidateTag(q.get('tag'), q.get('expire') === '0' ? { expire: 0 } : 'max');
  if (q.has('path')) revalidatePath(q.get('path'));
  return Response.json({ ok: true });
}
`,
};

/** Те же маршруты для учебной модели: что каждый передаёт в `fetch`. Сверяется тестом с `APP_FILES`. */
export const ROUTES_CODE = `const routes = {
  '/static': { fetches: [
    { key: 'menu', cache: 'force-cache' },
    { key: 'menu', cache: 'force-cache' },      // второй <Menu />
    { key: 'banner' },
  ] },
  '/isr': { fetches: [{ key: 'rates', revalidate: 3 }] },
  '/tagged': { fetches: [{ key: 'post', cache: 'force-cache', tags: ['post'] }] },
  '/dynamic': { dynamic: true, fetches: [         // dynamic — из-за cookies()
    { key: 'cart' },
    { key: 'catalog', cache: 'force-cache' },
    { key: 'user', cache: 'force-cache', tags: ['user'] },   // unstable_cache
    { key: 'news', revalidate: 5 },
    { key: 'cart' },                            // <Cart />
    { key: 'stock', signal: true },
    { key: 'stock', signal: true },
  ] },
};`;

export const SERVER_MODEL_CODE = `// Слои 1–3: мемоизация в рендере, кеш данных, кеш маршрута. Время — секунды.
function createServer(routes) {
  const YEAR = 31536000;
  const counts = {};                 // бэкенд: ключ → сколько раз спросили
  const data = new Map();            // слой 2: кеш данных, ключ → запись
  const pages = new Map();           // слой 3: кеш маршрута, путь → снимок
  const s = { now: 0, step: null, later: [], inLater: false };

  const note = (layer, text) => s.step.trace.push({ layer, text, later: s.inLater });

  function backend(key) {
    counts[key] = (counts[key] ?? 0) + 1;
    s.step.backend.push(key + '#' + counts[key]);
    return counts[key];
  }

  function store(f, path) {
    const e = { n: backend(f.key), at: s.now, revalidate: f.revalidate || YEAR, tags: f.tags ?? [], path };
    data.set(f.key, e);
    return e;
  }

  // Слой 2. В кеш данных идут force-cache, revalidate > 0 и — пока рендерится
  // снимок маршрута — fetch без опций: его ответ всё равно застынет в HTML.
  function cachedFetch(f, ctx) {
    const keep = f.cache === 'force-cache' || f.revalidate > 0 || (ctx.snapshot && !f.cache);
    if (!keep) {
      note('данные', f.key + ': не кешируется → бэкенд');
      return backend(f.key);
    }
    const e = data.get(f.key);
    const old = e && (e.stale || s.now - e.at >= e.revalidate);
    if (e && !e.expired && !old) {
      note('данные', f.key + ': HIT');
      return e.n;
    }
    if (e && !e.expired && !ctx.snapshot) {
      // Динамический рендер: старое значение сейчас, свежее — фоном.
      note('данные', f.key + ': устарело → старое значение, запрос фоном');
      s.later.push(() => {
        note('данные', f.key + ': фоновый запрос → бэкенд');
        store(f, ctx.path);
      });
      return e.n;
    }
    note('данные', f.key + (e ? ': устарело → бэкенд' : ': записи нет → бэкенд'));
    return store(f, ctx.path).n;
  }

  // Слой 1. Мемоизация: одинаковый fetch в одном рендере уходит один раз.
  function render(path, snapshot) {
    const memo = new Map();
    const shown = [];
    for (const f of routes[path].fetches) {
      let n = f.signal ? undefined : memo.get(f.key);
      if (n !== undefined) note('рендер', f.key + ': уже запрошен в этом рендере');
      else n = cachedFetch(f, { path, snapshot });
      if (!f.signal) memo.set(f.key, n);
      shown.push(f.key + '=' + n);
    }
    return shown.join(' ');
  }

  // Слой 3. Снимок: HTML и RSC одного рендера. Срок — наименьший revalidate.
  function snapshot(path) {
    const fs = routes[path].fetches;
    const page = {
      shown: render(path, true),
      at: s.now,
      revalidate: Math.min(YEAR, ...fs.map((f) => f.revalidate || YEAR)),
      tags: fs.flatMap((f) => f.tags ?? []),
    };
    pages.set(path, page);
    return page;
  }

  function cacheControl(page) {
    if (!page) return 'private, no-cache, no-store, max-age=0, must-revalidate';
    if (page.revalidate === YEAR) return 's-maxage=' + YEAR;
    return 's-maxage=' + page.revalidate + ', stale-while-revalidate=' + (YEAR - page.revalidate);
  }

  // Запрос к серверу: kind — document, rsc (переход в роутере) или prefetch.
  function serve(path, kind) {
    if (routes[path].dynamic) {
      if (kind === 'prefetch') {
        note('маршрут', path + ': динамический — префетч без данных');
        return { xcache: null, cc: cacheControl(null), shown: null };
      }
      note('маршрут', path + ': динамический — рендер на каждый запрос');
      return { xcache: null, cc: cacheControl(null), shown: render(path, false) };
    }
    let page = pages.get(path);
    let xcache = 'HIT';
    if (!page || page.expired) {
      xcache = 'MISS';
      note('маршрут', path + ': MISS — рендер, ответ ждёт его');
      page = snapshot(path);
    } else if (page.stale || s.now - page.at >= page.revalidate) {
      xcache = 'STALE';
      if (kind === 'prefetch') note('маршрут', path + ': STALE — префетч перегенерацию не запускает');
      else {
        note('маршрут', path + ': STALE — отдан старый снимок, перегенерация фоном');
        s.later.push(() => {
          note('маршрут', path + ': перегенерация');
          snapshot(path);
        });
      }
    } else note('маршрут', path + ': HIT');
    return { xcache, cc: cacheControl(page), shown: page.shown };
  }

  // revalidateTag(tag, 'max') — «устарело»; { expire: 0 } и updateTag — «истекло».
  function expireTag(tag, mark) {
    for (const e of [...data.values(), ...pages.values()]) if (e.tags.includes(tag)) e[mark] = true;
  }

  // revalidatePath: снимок пути и данные, полученные при его рендере.
  function expirePath(path) {
    if (pages.has(path)) pages.get(path).expired = true;
    for (const e of data.values()) if (e.path === path) e.expired = true;
  }

  // После ответа: фоновые перегенерации и запросы.
  function drain() {
    s.inLater = true;
    while (s.later.length) s.later.shift()();
    s.inLater = false;
  }

  return { s, serve, snapshot, expireTag, expirePath, drain, routes };
}`;

export const ROUTER_MODEL_CODE = `// Слой 4: кеш роутера во вкладке. И шаги сценария поверх всех четырёх слоёв.
function createNext(routes) {
  const server = createServer(routes);
  const { s } = server;
  const STATIC_STALE = 300;          // staleTimes.static: 5 минут
  let client = new Map();            // путь → { shown, at }
  let history = [];                  // что показывала вкладка: для «назад»

  const note = (layer, text) => s.step.trace.push({ layer, text });

  function request(path, kind) {
    s.step.requests.push(kind + ' ' + path);
    return server.serve(path, kind);
  }

  function show(path, shown) {
    history.push({ path, shown });
    Object.assign(s.step, { url: path, shown });
  }

  // Ссылки, попавшие в окно, префетчатся сразу после загрузки.
  function prefetchLinks() {
    note('роутер', 'префетч ссылок: статические — целиком, динамические — без данных');
    for (const path of Object.keys(routes)) {
      const r = request(path, 'prefetch');
      if (!routes[path].dynamic) client.set(path, { shown: r.shown, at: s.now });
    }
  }

  function open(path) {
    client = new Map();
    history = [];                    // прошлые страницы роутер больше не помнит
    note('роутер', 'новая загрузка: кеш роутера пуст');
    const r = request(path, 'document');
    Object.assign(s.step, r);
    show(path, r.shown);
    prefetchLinks();
  }

  const steps = {
    get({ path }) {                  // запрос «как curl»: без вкладки
      const r = request(path, 'document');
      Object.assign(s.step, r, { url: path });
    },
    open({ path }) { open(path); },
    reload() { open(history.at(-1).path); },
    click({ path }) {
      const c = client.get(path);
      if (c && s.now - c.at < STATIC_STALE) {
        note('роутер', path + ': есть в кеше роутера — без запроса');
        return show(path, c.shown);
      }
      note('роутер', path + ': нет в кеше роутера → запрос RSC');
      const r = request(path, 'rsc');
      Object.assign(s.step, r);
      show(path, r.shown);
    },
    back() {
      if (history.length < 2) return note('роутер', 'прошлой страницы в памяти роутера нет — модель этот случай не разбирает');
      history.pop();
      const prev = history.pop();
      note('роутер', 'назад: страница из кеша роутера, без запроса');
      show(prev.path, prev.shown);
    },
    action({ tag }) {                // server action с updateTag на текущей странице
      const path = history.at(-1).path;
      s.step.requests.push('action ' + path);
      server.expireTag(tag, 'expired');
      note('маршрут', 'updateTag: «' + tag + '» истекла, ответ действия несёт свежую страницу');
      show(path, server.snapshot(path).shown);
      client = new Map();
      note('роутер', 'после действия кеш роутера сброшен');
      prefetchLinks();
    },
    revalidateTag({ tag, expire0 }) { // вебхук: вкладка о нём не знает
      server.expireTag(tag, expire0 ? 'expired' : 'stale');
      note('маршрут', 'revalidateTag: «' + tag + '» ' + (expire0 ? 'истекла' : 'устарела'));
      if (history.length) note('роутер', 'открытая вкладка об этом не знает');
    },
    revalidatePath({ path }) {
      server.expirePath(path);
      note('маршрут', 'revalidatePath: снимок ' + path + ' и его данные истекли');
    },
    wait({ s: sec }) {
      s.now += sec;
      note('роутер', 'прошло ' + sec + ' с');
    },
  };

  function begin() {
    const cur = history.at(-1);      // вкладка показывает то же, пока шаг её не сменит
    s.step = { requests: [], backend: [], xcache: null, cc: null, url: cur?.path ?? null,
      shown: cur?.shown ?? null, trace: [], now: s.now };
    return s.step;
  }

  return {
    // next build: снимки всех статических маршрутов.
    build() {
      const step = begin();
      for (const path of Object.keys(routes)) {
        if (routes[path].dynamic) continue;
        note('маршрут', path + ': снимок при сборке');
        server.snapshot(path);
      }
      return step;
    },
    run(action) {
      const step = begin();
      steps[action.do](action);
      server.drain();
      return step;
    },
  };
}`;

/** Вариант стенда с новой моделью: `cacheComponents: true`, `'use cache'`, `cacheLife`, `cacheTag`. */
export const APP2_FILES: Record<string, string> = {
  'app/lib.js': APP_FILES['app/lib.js'],
  'app/layout.jsx': `export default function Layout({ children }) {
  return <html lang="ru"><body>{children}</body></html>;
}
`,
  'app/page.jsx': APP_FILES['app/page.jsx'],
  'app/api/revalidate/route.js': APP_FILES['app/api/revalidate/route.js'],
  'app/cached/page.jsx': `import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { cacheLife, cacheTag } from 'next/cache';
import { get } from '../lib';

async function getPrice() {
  'use cache';
  cacheLife({ stale: 300, revalidate: 3, expire: 600 });
  cacheTag('price');
  return get('price');
}

async function Price() {
  const { n } = await getPrice();
  return <li>price: {n}</li>;
}

async function Live() {
  await cookies();
  const { n } = await get('live');
  return <li>live: {n}</li>;
}

export default function Page() {
  return (
    <ul>
      <Price />
      <Suspense fallback={<li>…</li>}><Live /></Suspense>
    </ul>
  );
}
`,
};

/** Шаги сценариев без журнала: журнал стенда к ним — `STAND` ниже. Порядок на стенде — как здесь. */
export const SCENARIO_STEPS: { id: string; mode: 'http' | 'browser'; steps: Step[] }[] = [
  { id: 'memo', mode: 'http', steps: [{ do: 'get', path: '/static' }, { do: 'get', path: '/static' }] },
  {
    id: 'path',
    mode: 'http',
    steps: [{ do: 'get', path: '/static' }, { do: 'revalidatePath', path: '/static' }, { do: 'get', path: '/static' }, { do: 'get', path: '/static' }],
  },
  {
    id: 'isr',
    mode: 'http',
    steps: [
      { do: 'wait', s: 5 },
      { do: 'get', path: '/isr' },
      { do: 'get', path: '/isr' },
      { do: 'get', path: '/isr' },
      { do: 'wait', s: 5 },
      { do: 'get', path: '/isr' },
      { do: 'get', path: '/isr' },
    ],
  },
  {
    id: 'tag',
    mode: 'http',
    steps: [
      { do: 'get', path: '/tagged' },
      { do: 'revalidateTag', tag: 'post' },
      { do: 'get', path: '/tagged' },
      { do: 'get', path: '/tagged' },
      { do: 'revalidateTag', tag: 'post', expire0: true },
      { do: 'get', path: '/tagged' },
      { do: 'get', path: '/tagged' },
    ],
  },
  {
    id: 'dynamic',
    mode: 'http',
    steps: [
      { do: 'get', path: '/dynamic' },
      { do: 'get', path: '/dynamic' },
      { do: 'wait', s: 6 },
      { do: 'revalidateTag', tag: 'user', expire0: true },
      { do: 'get', path: '/dynamic' },
      { do: 'get', path: '/dynamic' },
    ],
  },
  {
    id: 'router',
    mode: 'browser',
    steps: [
      { do: 'open', path: '/static' },
      { do: 'click', path: '/tagged' },
      { do: 'click', path: '/dynamic' },
      { do: 'click', path: '/static' },
      { do: 'click', path: '/dynamic' },
      { do: 'back' },
      { do: 'click', path: '/tagged' },
      { do: 'action', tag: 'post' },
      { do: 'click', path: '/static' },
      { do: 'click', path: '/tagged' },
      { do: 'revalidateTag', tag: 'post', expire0: true },
      { do: 'click', path: '/static' },
      { do: 'click', path: '/tagged' },
      { do: 'reload' },
    ],
  },
];

/** Журнал стенда по сценариям: `[0]` — сборка, дальше шаги. ЗАПОЛНЯЕТСЯ стендом. */
export const STAND: Record<string, StandStep[]> = {
  memo: [
    { backend: ['banner#1', 'menu#1', 'post#1', 'rates#1'] },
    { backend: [], xcache: 'HIT', cc: 's-maxage=31536000', shown: 'menu=1 menu=1 banner=1' },
    { backend: [], xcache: 'HIT', cc: 's-maxage=31536000', shown: 'menu=1 menu=1 banner=1' },
  ],
  path: [
    { backend: ['banner#1', 'menu#1', 'post#1', 'rates#1'] },
    { backend: [], xcache: 'HIT', cc: 's-maxage=31536000', shown: 'menu=1 menu=1 banner=1' },
    { backend: [] },
    { backend: ['banner#2', 'menu#2'], xcache: 'MISS', cc: 's-maxage=31536000', shown: 'menu=2 menu=2 banner=2' },
    { backend: [], xcache: 'HIT', cc: 's-maxage=31536000', shown: 'menu=2 menu=2 banner=2' },
  ],
  isr: [
    { backend: ['banner#1', 'menu#1', 'post#1', 'rates#1'] },
    { backend: [] },
    { backend: ['rates#2'], xcache: 'STALE', cc: 's-maxage=3, stale-while-revalidate=31535997', shown: 'rates=1' },
    { backend: [], xcache: 'HIT', cc: 's-maxage=3, stale-while-revalidate=31535997', shown: 'rates=2' },
    { backend: [], xcache: 'HIT', cc: 's-maxage=3, stale-while-revalidate=31535997', shown: 'rates=2' },
    { backend: [] },
    { backend: ['rates#3'], xcache: 'STALE', cc: 's-maxage=3, stale-while-revalidate=31535997', shown: 'rates=2' },
    { backend: [], xcache: 'HIT', cc: 's-maxage=3, stale-while-revalidate=31535997', shown: 'rates=3' },
  ],
  tag: [
    { backend: ['banner#1', 'menu#1', 'post#1', 'rates#1'] },
    { backend: [], xcache: 'HIT', cc: 's-maxage=31536000', shown: 'post=1' },
    { backend: [] },
    { backend: ['post#2'], xcache: 'STALE', cc: 's-maxage=31536000', shown: 'post=1' },
    { backend: [], xcache: 'HIT', cc: 's-maxage=31536000', shown: 'post=2' },
    { backend: [] },
    { backend: ['post#3'], xcache: 'MISS', cc: 's-maxage=31536000', shown: 'post=3' },
    { backend: [], xcache: 'HIT', cc: 's-maxage=31536000', shown: 'post=3' },
  ],
  dynamic: [
    { backend: ['banner#1', 'menu#1', 'post#1', 'rates#1'] },
    { backend: ['cart#1', 'catalog#1', 'news#1', 'stock#1', 'stock#2', 'user#1'], xcache: null, cc: 'private, no-cache, no-store, max-age=0, must-revalidate', shown: 'cart=1 catalog=1 user=1 news=1 cart=1 stock=1 stock=2' },
    { backend: ['cart#2', 'stock#3', 'stock#4'], xcache: null, cc: 'private, no-cache, no-store, max-age=0, must-revalidate', shown: 'cart=2 catalog=1 user=1 news=1 cart=2 stock=3 stock=4' },
    { backend: [] },
    { backend: [] },
    { backend: ['cart#3', 'news#2', 'stock#5', 'stock#6', 'user#2'], xcache: null, cc: 'private, no-cache, no-store, max-age=0, must-revalidate', shown: 'cart=3 catalog=1 user=2 news=1 cart=3 stock=5 stock=6' },
    { backend: ['cart#4', 'stock#7', 'stock#8'], xcache: null, cc: 'private, no-cache, no-store, max-age=0, must-revalidate', shown: 'cart=4 catalog=1 user=2 news=2 cart=4 stock=7 stock=8' },
  ],
  router: [
    { backend: ['banner#1', 'menu#1', 'post#1', 'rates#1'] },
    { backend: [], shown: 'menu=1 menu=1 banner=1', requests: ['document /static', 'prefetch /dynamic', 'prefetch /isr', 'prefetch /static', 'prefetch /tagged'] },
    { backend: [], shown: 'post=1', requests: [] },
    { backend: ['cart#1', 'catalog#1', 'news#1', 'stock#1', 'stock#2', 'user#1'], shown: 'cart=1 catalog=1 user=1 news=1 cart=1 stock=1 stock=2', requests: ['rsc /dynamic'] },
    { backend: [], shown: 'menu=1 menu=1 banner=1', requests: [] },
    { backend: ['cart#2', 'stock#3', 'stock#4'], shown: 'cart=2 catalog=1 user=1 news=1 cart=2 stock=3 stock=4', requests: ['rsc /dynamic'] },
    { backend: [], shown: 'menu=1 menu=1 banner=1', requests: [] },
    { backend: [], shown: 'post=1', requests: [] },
    { backend: ['post#2'], shown: 'post=2', requests: ['action /tagged', 'prefetch /dynamic', 'prefetch /isr', 'prefetch /static', 'prefetch /tagged'] },
    { backend: [], shown: 'menu=1 menu=1 banner=1', requests: [] },
    { backend: [], shown: 'post=2', requests: [] },
    { backend: [], shown: 'post=2', requests: [] },
    { backend: [], shown: 'menu=1 menu=1 banner=1', requests: [] },
    { backend: [], shown: 'post=2', requests: [] },
    { backend: ['post#3'], shown: 'post=3', requests: ['document /tagged', 'prefetch /dynamic', 'prefetch /isr', 'prefetch /static', 'prefetch /tagged'] },
  ],
};

export const BUILD_TABLE = `Route (app)          Revalidate  Expire
┌ ○ /
├ ○ /_not-found
├ ƒ /api/revalidate
├ ƒ /dynamic
├ ○ /isr                     3s      1y
├ ○ /static
└ ○ /tagged`;
export const REBUILD_HITS: string[] = ['rates#2'];
export const APP2_STEPS: Step[] = [
  { do: 'get', path: '/cached' },
  { do: 'get', path: '/cached' },
  { do: 'wait', s: 5 },
  { do: 'get', path: '/cached' },
  { do: 'get', path: '/cached' },
  { do: 'revalidateTag', tag: 'price' },
  { do: 'get', path: '/cached' },
  { do: 'get', path: '/cached' },
];
export const APP2_BUILD_TABLE = `Route (app)          Revalidate  Expire
┌ ○ /
├ ○ /_not-found
├ ƒ /api/revalidate
└ ◐ /cached                  3s     10m`;
export const APP2_STAND: StandStep[] = [
  { backend: ['price#1'] },
  { backend: ['live#1'], xcache: null, cc: 'private, no-cache, no-store, max-age=0, must-revalidate', shown: 'price=1 live=1' },
  { backend: ['live#2'], xcache: null, cc: 'private, no-cache, no-store, max-age=0, must-revalidate', shown: 'price=1 live=2' },
  { backend: [] },
  { backend: ['live#3', 'price#2'], xcache: null, cc: 'private, no-cache, no-store, max-age=0, must-revalidate', shown: 'price=1 live=3' },
  { backend: ['live#4'], xcache: null, cc: 'private, no-cache, no-store, max-age=0, must-revalidate', shown: 'price=2 live=4' },
  { backend: [] },
  { backend: ['live#5', 'price#3'], xcache: null, cc: 'private, no-cache, no-store, max-age=0, must-revalidate', shown: 'price=2 live=5' },
  { backend: ['live#6'], xcache: null, cc: 'private, no-cache, no-store, max-age=0, must-revalidate', shown: 'price=3 live=6' },
];

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'App Router',
    d: 'Нынешний способ писать приложение на Next.js: каталог `app/`, в нём папка на каждый адрес и файл `page.jsx`. Компоненты в нём по умолчанию серверные — выполняются на сервере, а в браузер уходит результат.',
  },
  {
    k: 'RSC-ответ',
    d: 'То, что сервер отдаёт роутеру при переходе внутри приложения: не HTML, а описание дерева серверных компонентов. Из него браузер перерисовывает часть страницы без перезагрузки.',
  },
  {
    k: 'статический и динамический маршрут',
    d: 'Статический Next рендерит заранее — при сборке — и потом раздаёт готовое. Динамический рендерит заново на каждый запрос, потому что ответ зависит от запроса: куки, заголовки, параметры адреса.',
  },
  {
    k: 'ISR',
    d: 'Incremental Static Regeneration: статическая страница со сроком. Срок вышел — следующий посетитель получает старую версию, а сервер в это время рендерит новую.',
  },
  {
    k: 'тег кеша',
    d: 'Метка на записи кеша, например `post`. По ней можно разом сбросить все записи с этой меткой — где бы они ни лежали.',
  },
  {
    k: 'server action',
    d: 'Функция с `\'use server\'`, которую страница вызывает из формы или кнопки. Браузер отправляет `POST` на тот же адрес, сервер выполняет функцию и присылает обновлённую страницу.',
  },
  {
    k: 'префетч',
    d: 'Загрузка заранее: роутер видит ссылку на экране и тихо скачивает то, что понадобится при переходе по ней, — чтобы клик сработал без ожидания сети.',
  },
];

export const PLAIN_LAYERS =
  'Как кофейня с четырьмя местами, где может лежать вчерашний круассан. Бариста запомнил, что вы уже спросили (на один заказ). Холодильник за стойкой (данные). Витрина с готовыми подносами (страница целиком). И пакет у вас в руках (вкладка). Свежая выпечка на кухне не поможет, если вы смотрите в свой пакет: спрашивать надо, на каком из четырёх мест лежит старое.';

export const PREREQ_NOTE =
  'Тема опирается на то, как устроены серверные компоненты и HTTP-кеш. Сами они разобраны в других темах.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'Серверные компоненты',
    d: 'Компонент выполняется на сервере, может быть `async` и сам ходить за данными. В браузер уходит не его код, а результат — поток RSC.',
    href: '/frameworks/server-components/#s1',
    hrefLabel: '«Server Components изнутри», раздел «Не другой SSR»',
    tone: 'info',
  },
  {
    t: 'SSR: HTML с сервера',
    d: 'Сервер отдаёт готовый HTML, браузер показывает его сразу, а потом скрипты «оживляют» страницу. Кеш маршрута хранит именно этот HTML вместе с RSC-ответом.',
    href: '/frameworks/ssr-hydration/#s1',
    hrefLabel: '«SSR и гидратация», раздел «Что отдаёт сервер»',
    tone: 'info',
  },
  {
    t: '`stale-while-revalidate`',
    d: 'Правило кеша: устаревшую копию отдать сразу, а свежую получить фоном. Next применяет его у себя на сервере и пишет то же слово в `Cache-Control` для CDN.',
    href: '/platform/cdn-cache/#s3',
    hrefLabel: '«CDN и серверный кеш», раздел «Устаревшее и толпа»',
    tone: 'info',
  },
  {
    t: 'Переход без перезагрузки',
    d: 'Роутер перехватывает клик по ссылке, меняет адрес через History API и перерисовывает часть страницы сам.',
    href: '/frameworks/router/#s3',
    hrefLabel: '«Роутер изнутри», раздел «Перехват клика»',
    tone: 'info',
  },
];

// ─── Раздел «Четыре слоя» ───────────────────────────────────────────────────────────────────

export const LAYERS = [
  {
    k: '1. Запрос в рендере',
    where: 'память сервера, один рендер',
    life: 'до конца рендера',
    reset: 'сам — следующий запрос начинает с нуля',
  },
  {
    k: '2. Кеш данных',
    where: 'сервер: `.next/cache/fetch-cache`',
    life: '`revalidate` у `fetch`; без него — год',
    reset: '`revalidateTag`, `updateTag`, `revalidatePath`, срок',
  },
  {
    k: '3. Кеш маршрута',
    where: 'сервер: HTML и RSC страницы',
    life: 'наименьший `revalidate` среди `fetch` страницы',
    reset: 'те же три функции, срок, новая сборка',
  },
  {
    k: '4. Кеш роутера',
    where: 'вкладка браузера, память',
    life: 'статическая страница — 5 минут, динамическая — 0',
    reset: 'перезагрузка, server action, `router.refresh()`',
  },
];

export const LAYERS_NOTE =
  'Слои стоят друг за другом. Запрос из вкладки сначала спрашивает кеш роутера; не нашёл — идёт на сервер, к кешу маршрута; тот рендерит страницу заново — и каждый `fetch` внутри рендера спрашивает кеш данных; а повторный одинаковый `fetch` в том же рендере не уходит даже туда. Свежие данные доходят до экрана, только если промахнулись все слои выше.';

export const STAND_INTRO =
  'Пример на всю тему — маленькое приложение из четырёх страниц и «бэкенда данных», который на каждый запрос отвечает номером: `{ n: 1 }`, `{ n: 2 }`… По номеру на экране видно, сколько раз данные спрашивали на самом деле. Страницы отличаются только тем, что передают в `fetch`.';

export const BUILD_NOTE =
  'Так `next build` подписывает маршруты. `○` — статический: отрендерен при сборке. `ƒ` — динамический: рендер на каждый запрос. У `/isr` срок 3 секунды — его задал `revalidate: 3` у единственного `fetch`. Во время сборки бэкенд получил четыре запроса: `menu`, `banner`, `rates`, `post` — по одному на ключ. `/dynamic` при сборке не рендерился вовсе.';

// ─── Раздел «Запрос в рендере» ──────────────────────────────────────────────────────────────

export const PLAIN_MEMO =
  'Официант принимает заказ у большого стола. Трое попросили воды — на кухню он идёт один раз и приносит три стакана. Следующий стол он обслуживает с чистого листа: память о заказе живёт ровно один заказ.';

export const MEMO_FACTS = [
  {
    t: 'Два `<Menu />` — один запрос',
    d: 'На `/static` компонент `Menu` стоит дважды, и оба зовут `get(\'menu\')`. При сборке бэкенд получил `menu` один раз, на странице — `menu: 1` дважды. Так же на `/dynamic`: `cart` спрашивают `Page` и `Cart`, а до бэкенда доходит один запрос на каждый рендер.',
  },
  {
    t: 'Свой сигнал выключает склейку',
    d: '`Stock` дважды зовёт `get(\'stock\')` со своим `AbortController`. Бэкенд получает два запроса: `stock: 1` и `stock: 2` на одной странице. Next склеивает только `GET` с одинаковыми адресом и опциями, а сигнал у каждого вызова свой.',
    tone: 'warn' as const,
  },
  {
    t: 'Не fetch — не склеивается',
    d: 'Запрос к базе (`query` в стенде) Next не видит. Чтобы два компонента не спросили базу дважды за рендер, функцию оборачивают в `cache()` из React — тот же механизм для любой функции.',
  },
];

export const MEMO_LINK =
  'Как `cache()` устроен и почему он живёт ровно один запрос — в теме [«Server Components изнутри», раздел «Async, Suspense и cache()»](/frameworks/server-components/#s6). По документации Next склейка не работает в обработчиках маршрутов (`route.js`): они вне дерева компонентов.';

// ─── Раздел «Кеш данных» ────────────────────────────────────────────────────────────────────

export const PLAIN_DATA =
  'Холодильник за стойкой. Бариста кладёт туда то, что пометили «хранить»: круассаны на неделю, сэндвичи до вечера. Что не пометили, он каждый раз заказывает с кухни заново. Холодильник общий для всех посетителей и переживает закрытие кофейни на ночь.';

export const FETCH_ROWS = [
  {
    k: 'без опций',
    dyn: 'к бэкенду на каждый запрос: `cart` — 1, 2, 3, 4',
    snap: 'один раз, при сборке, — и ответ застыл в странице: `banner: 1` на каждом заходе',
    tone: 'warn' as const,
  },
  {
    k: "`cache: 'force-cache'`",
    dyn: 'один раз: `catalog: 1` на всех заходах',
    snap: 'один раз, при сборке',
    tone: undefined,
  },
  {
    k: '`next: { revalidate: 5 }`',
    dyn: 'срок вышел — на экране ещё старое `news: 1`, свежее уходит фоном и видно со следующего запроса',
    snap: 'обновляется вместе со страницей',
    tone: undefined,
  },
  {
    k: "`cache: 'no-store'`",
    dyn: 'к бэкенду на каждый запрос',
    snap: 'делает маршрут динамическим (по документации)',
    tone: undefined,
  },
  {
    k: '`unstable_cache(fn, keys, { tags })`',
    dyn: 'для не-`fetch`: `user: 1`, пока тег `user` не сброшен',
    snap: 'один раз, при сборке',
    tone: undefined,
  },
];

export const DEFAULT_HISTORY =
  'По документации (руководство по переходу на 15-ю версию): до Next 15 `fetch` без опций кешировался — как с `force-cache`; с 15-й — нет. На установленной 16.3.8 это видно на `/dynamic`: `cart` уходит к бэкенду на каждый запрос. Но «не кешируется» — правда только для динамического маршрута. На статическом тот же `fetch` без опций выполнился при сборке, и его ответ застыл в странице до следующей сборки или сброса.';

export const DATA_FACTS = [
  {
    t: 'Кеш данных живёт в `.next/cache`',
    d: 'Записи — файлы в `.next/cache/fetch-cache`, у каждой срок и теги. Даже `banner` без опций лёг туда при сборке со сроком в год. Пересборка без удаления `.next` их не трогает: на стенде повторный `next build` спросил бэкенд только про `rates` — у него срок 3 секунды. `menu`, `banner` и `post` пришли из старой записи.',
    tone: 'err' as const,
  },
  {
    t: 'Динамический маршрут — не значит «без кеша»',
    d: 'Куки делают динамическим рендер страницы, а не каждый `fetch` в ней. `catalog` с `force-cache` на `/dynamic` ушёл к бэкенду один раз за весь прогон.',
  },
  {
    t: 'Устаревшее — сразу, свежее — потом',
    d: 'Запись `news` с `revalidate: 5` через 6 секунд отдала старое `news: 1`, а запрос к бэкенду ушёл фоном. Следующий заход показал `news: 2`. Внутри кеша данных действует тот же `stale-while-revalidate`, что и для страниц.',
  },
];

// ─── Раздел «Кеш маршрута» ──────────────────────────────────────────────────────────────────

export const PLAIN_ROUTE =
  'Витрина с готовыми подносами. Утром собрали подносы на весь день — посетитель берёт готовое, кухня не работает. На некоторых подносах срок: истёк — посетителю отдают вчерашний, а кухня тем временем собирает новый для следующего.';

export const DYNAMIC_TRIGGERS =
  'Маршрут становится динамическим, если рендер читает то, что знает только запрос: `cookies()`, `headers()`, `searchParams` страницы, — или делает `fetch` с `cache: \'no-store\'`. На стенде хватило одной строки `await cookies()`, даже без использования результата. Это решение принимается при сборке, и его видно в таблице `next build`.';

export const XCACHE_ROWS = [
  { k: '`HIT`', d: 'Ответ из готового снимка, рендера не было.', tone: 'ok' as const },
  { k: '`STALE`', d: 'Срок снимка вышел или его пометили устаревшим. Отдан **старый** снимок, перегенерация запущена фоном — новое увидит следующий запрос.', tone: 'warn' as const },
  { k: '`MISS`', d: 'Снимка нет или он истёк совсем. Рендер прямо сейчас, ответ его ждёт.', tone: 'err' as const },
  { k: 'нет заголовка', d: 'Динамический маршрут: кеша маршрута нет вовсе. `Cache-Control: private, no-cache, no-store…`', tone: undefined },
];

export const ISR_NOTE =
  'Срок — не таймер. Через 3 секунды ничего не произошло: бэкенд молчал, пока не пришёл запрос. Первый запрос после срока получил старое `rates: 1` с `STALE` и запустил перегенерацию; уже следующий получил `rates: 2` с `HIT`. Пока к странице никто не ходит, она не обновляется никогда.';

export const CC_NOTE =
  'Тот же срок Next пишет и для внешних кешей: `s-maxage=3, stale-while-revalidate=31535997` — три секунды свежести и год, в течение которого CDN может отдавать устаревшее, обновляя фоном. Это ровно та пара директив, которую разбирает тема [«CDN и серверный кеш», раздел «Устаревшее и толпа»](/platform/cdn-cache/#s3). Статическая страница без срока получает `s-maxage=31536000` — год.';

// ─── Раздел «Инвалидация» ───────────────────────────────────────────────────────────────────

export const PLAIN_INVALIDATE =
  'Повар говорит «круассаны вчерашние». Можно сказать «продавайте, пока несу новые» — это `revalidateTag(…, \'max\')`. Можно «снимите с витрины немедленно» — `{ expire: 0 }` и `updateTag`. И можно «перепроверьте весь третий стеллаж» — `revalidatePath`.';

export const INVALIDATE_ROWS = [
  {
    k: "`revalidateTag(tag, 'max')`",
    where: 'server action, обработчик маршрута',
    next: '`STALE`: старое, перегенерация фоном. `post: 1`, потом `post: 2`',
    tone: 'warn' as const,
  },
  {
    k: '`revalidateTag(tag, { expire: 0 })`',
    where: 'server action, обработчик маршрута',
    next: '`MISS`: ждёт свежий рендер. Сразу `post: 3`',
    tone: 'ok' as const,
  },
  {
    k: '`updateTag(tag)`',
    where: 'только server action',
    next: 'как `expire: 0`; плюс ответ действия несёт свежую страницу и сбрасывает кеш роутера вкладки',
    tone: 'ok' as const,
  },
  {
    k: '`revalidatePath(path)`',
    where: 'server action, обработчик маршрута',
    next: '`MISS`; заново запрошены и данные этой страницы: `menu: 2`, `banner: 2`',
    tone: 'ok' as const,
  },
];

export const TAG_NOTE =
  'Вызов функции сам ничего не рендерит и бэкенд не спрашивает: журнал на шаге `revalidateTag` пуст. Работа начинается со следующего запроса к странице. Одиночный вызов `revalidateTag(\'post\')` без второго аргумента в 16-й версии устарел и, по документации, ведёт себя как `{ expire: 0 }`.';

export const PATH_NOTE =
  'У `revalidatePath` есть неочевидная сторона: он сбрасывает не только снимок страницы, но и записи кеша данных, полученные при её рендере. `menu` с `force-cache` и `banner` без опций пошли к бэкенду заново, хотя меток у них нет. По документации Next помечает каждую запись скрытыми «мягкими» тегами пути вида `_N_T_/static`, и `revalidatePath` сбрасывает их.';

// ─── Раздел «Кеш роутера» ───────────────────────────────────────────────────────────────────

export const PLAIN_ROUTER =
  'Пакет с выпечкой у вас в руках. Пока он с вами, в кофейню вы не ходите — даже если там уже испекли свежее. Звонок повара «круассаны вчерашние» до пакета не доходит. Новое вы увидите, только если вернётесь к прилавку: перезагрузите страницу.';

export const ROUTER_FACTS = [
  {
    t: 'Префетч — сразу после загрузки',
    d: 'Открыли `/static` — и роутер тут же запросил все четыре ссылки из меню. Статические страницы — целиком, вместе с данными. Динамическая — только каркас: бэкенд при префетче `/dynamic` не получил ни одного запроса.',
  },
  {
    t: 'Статика — без запроса, динамика — каждый раз',
    d: 'Переход на `/tagged` и обратно на `/static` — ни одного запроса к серверу. Каждый переход на `/dynamic` — новый RSC-запрос и новый рендер: `cart: 1`, потом `cart: 2`. По документации статические страницы живут в кеше роутера 5 минут (`staleTimes.static`), динамические — 0 секунд; до Next 15 динамические жили 30 секунд.',
  },
  {
    t: '«Назад» — всегда из памяти',
    d: 'Кнопка «назад» вернула `/static` без запроса. Возврат по истории не проверяет свежесть вовсе — так роутер сохраняет прокрутку и не дёргает вёрстку.',
  },
  {
    t: 'Действие сбрасывает кеш вкладки',
    d: 'После `updateTag` в server action страница сразу показала `post: 2`, а роутер выбросил всё, что помнил, и заново запросил все ссылки.',
    tone: 'ok' as const,
  },
  {
    t: 'Вебхук до вкладки не доходит',
    d: 'Тот же `post`, сброшенный снаружи через обработчик маршрута, сервер обновил. Но вкладка, где `/tagged` уже лежал в кеше роутера, показала старое `post: 2` без единого запроса. `post: 3` появилось только после перезагрузки.',
    tone: 'err' as const,
  },
];

export const ROUTER_LINKS =
  'Это не префетч браузера из [«Навигаций без ожидания»](/platform/instant-navigation/#s4): там браузер сам скачивает документ по правилам Speculation Rules, а здесь JavaScript роутера запрашивает RSC-ответы и держит их у себя в памяти. Кеш роутера похож на клиентский кеш данных из темы [«Кеш данных на клиенте»](/frameworks/data-cache/#s3) — с той разницей, что хранит он не ответы API, а готовые куски страниц, и свежесть у него задаётся не на запрос, а на тип страницы.';

// ─── Раздел «Модель четырёх слоёв» ──────────────────────────────────────────────────────────

export const MODEL_NOTE =
  'Модель держит четыре таблицы — по одной на слой — и часы в секундах. Правила взяты из журнала стенда: что считается «старым», кто ждёт рендера, а кто получает прошлую версию. Чего на стенде не было — нескольких серверов, CDN, `loading.js`, — в модели нет.';

export const DEMO_CAPTION =
  'Каждый шаг проходит слои сверху вниз: роутер, маршрут, данные, рендер. Строки с пометкой «фоном» случились уже после ответа — поэтому на экране старое значение, а бэкенд запрос получил. Отметка «как на стенде» сравнивает шаг модели с журналом настоящего Next 16.3.8. Попробуйте в своём сценарии сбросить `post` вебхуком и перейти на `/tagged`: сервер уже свежий, а вкладка — нет.';

// ─── Раздел «Новая модель: 'use cache'» ─────────────────────────────────────────────────────

export const USE_CACHE_NOTE =
  "В 16-й версии появилась вторая модель кеширования — флаг `cacheComponents: true` в `next.config`. В ней кешируют не `fetch`, а функцию или компонент целиком: директива `'use cache'` в начале тела, срок — `cacheLife`, метка — `cacheTag`. Всё, что не помечено, считается динамическим, и его нужно обернуть в `<Suspense>`. Обе модели в одном приложении не смешиваются: флаг переключает всё приложение.";

export const USE_CACHE_FACTS = [
  {
    t: 'Страница наполовину статическая',
    d: '`next build` подписал `/cached` знаком `◐` — частичный пререндер. Цена `price` посчитана при сборке и вошла в готовый HTML. Блок `live` за `<Suspense>` дорисовывается на каждый запрос: `live: 1, 2, 3…`.',
  },
  {
    t: 'Тот же stale-while-revalidate',
    d: 'Через 5 секунд при сроке 3 первый запрос показал старое `price: 1`, а `price` ушёл к бэкенду фоном. Следующий — `price: 2`. `revalidateTag(\'price\', \'max\')` дал то же самое.',
  },
  {
    t: 'Заголовка `x-nextjs-cache` нет',
    d: 'Ответ у страницы с динамической частью — всегда `private, no-cache, no-store`, и по заголовкам уже не понять, попал ли кеш. Видно только по журналу бэкенда.',
    tone: 'warn' as const,
  },
  {
    t: 'Короткий срок выпадает из сборки',
    d: 'По документации запись с `expire` меньше 5 минут или `stale` меньше 30 секунд в пререндер не попадает и становится динамической дырой. На стенде `cacheLife({ revalidate: 3, expire: 60 })` без `<Suspense>` вокруг уронил `next build`: «encountered uncached or runtime data during prerendering». С `expire: 600` сборка прошла.',
    tone: 'err' as const,
  },
];

export const CACHELIFE_ROWS = [
  { k: "'seconds'", stale: '30 с', rev: '1 с', exp: '1 мин' },
  { k: "'minutes'", stale: '5 мин', rev: '1 мин', exp: '1 ч' },
  { k: "'hours'", stale: '5 мин', rev: '1 ч', exp: '1 день' },
  { k: "'default'", stale: '5 мин', rev: '15 мин', exp: 'никогда' },
  { k: "'max'", stale: '5 мин', rev: '30 дней', exp: '1 год' },
];

export const CACHELIFE_NOTE =
  'Три числа `cacheLife` — три слоя из этой темы. `stale` — сколько вкладка держит ответ без запроса (кеш роутера), `revalidate` — когда сервер начнёт обновлять фоном, `expire` — когда старое отдавать уже нельзя и запрос будет ждать. Профили — из кода Next 16.3.8 (`dist/server/config-shared.js`). У `\'default\'` своего `stale` нет — берётся `staleTimes.static`, те же 5 минут.';

// ─── Журналы для таблиц темы ────────────────────────────────────────────────────────────────

const showCell = (s: string | null | undefined) => (s ? `\`${s.replaceAll('=', ': ')}\`` : '—');
const backendCell = (b: string[]) => (b.length ? b.map((x) => `\`${x}\``).join(' ') : '—');

/** Строки таблицы журнала: шаг, что дошло до бэкенда, `x-nextjs-cache`, что на экране. */
export function journalRows(id: string): string[][] {
  const sc = SCENARIO_STEPS.find((s) => s.id === id)!;
  const stand = STAND[id];
  const rows = [['`next build`', backendCell(stand[0].backend), '—', '—']];
  sc.steps.forEach((step, i) => {
    const r = stand[i + 1];
    const x = step.do === 'get' ? (r.xcache ?? 'нет') : '—';
    rows.push([`\`${stepLabel(step)}\``, backendCell(r.backend), x, showCell(r.shown)]);
  });
  return rows;
}

/** Журнал вкладки: шаг, запросы к серверу, что дошло до бэкенда, что на экране. */
export function routerRows(): string[][] {
  const sc = SCENARIO_STEPS.find((s) => s.id === 'router')!;
  return sc.steps.map((step, i) => {
    const r = STAND.router[i + 1];
    const reqs = r.requests ?? [];
    const pf = reqs.filter((q) => q.startsWith('prefetch')).length;
    const other = reqs.filter((q) => !q.startsWith('prefetch')).map((q) => `\`${q}\``);
    const cell = [...other, pf ? `префетч ×${pf}` : ''].filter(Boolean).join(', ') || 'нет';
    return [`\`${stepLabel(step)}\``, cell, backendCell(r.backend), showCell(r.shown)];
  });
}

export function app2Rows(): string[][] {
  const rows = [['`next build`', backendCell(APP2_STAND[0].backend), '—']];
  APP2_STEPS.forEach((step, i) => rows.push([`\`${stepLabel(step)}\``, backendCell(APP2_STAND[i + 1].backend), showCell(APP2_STAND[i + 1].shown)]));
  return rows;
}

// ─── Демо ──────────────────────────────────────────────────────────────────────────────────

const SCENARIO_META: Record<string, { label: string; note: string }> = {
  memo: {
    label: 'Сборка',
    note: 'Сборка рендерит статические страницы и кладёт ответы в кеш данных. Два `<Menu />` на `/static` дали один запрос `menu`. Дальше `/static` отдаётся с `HIT` — бэкенд молчит.',
  },
  path: {
    label: 'revalidatePath',
    note: '`revalidatePath(\'/static\')` из обработчика маршрута. Следующий запрос — `MISS`: страница рендерится заново, и даже `menu` с `force-cache` идёт к бэкенду.',
  },
  isr: {
    label: 'ISR по времени',
    note: '`/isr` со сроком 3 секунды. Ждём 5 — и смотрим, кто первым увидит новое значение.',
  },
  tag: {
    label: 'revalidateTag',
    note: 'Сначала тег `post` помечен устаревшим (`\'max\'`), потом истёкшим (`{ expire: 0 }`). Сравните ответ сразу после каждого вызова.',
  },
  dynamic: {
    label: 'Динамический маршрут',
    note: '`/dynamic` рендерится на каждый запрос, но кеш данных под ним работает: `catalog` спрошен один раз, `news` обновляется фоном, `user` ждёт сброса тега.',
  },
  router: {
    label: 'Вкладка',
    note: 'То же приложение в браузере: префетч, переходы по ссылкам, «назад», кнопка с `updateTag` и вебхук, о котором вкладка не узнаёт.',
  },
};

export const SCENARIOS: Scenario[] = SCENARIO_STEPS.map((s) => ({ ...s, ...SCENARIO_META[s.id], stand: STAND[s.id] }));

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: '«Без опций» на статической странице — значит «навсегда»',
    d: 'С 15-й версии `fetch` без опций не кешируется — но только на динамическом маршруте. На статическом он выполнился при сборке, ответ застыл в HTML и в кеше данных со сроком в год. Если данные должны меняться, нужен `revalidate`, тег или динамический маршрут.',
    tone: 'err',
  },
  {
    n: '02',
    t: 'Пересборка не обновляет данные',
    d: 'Кеш данных лежит в `.next/cache`, и `next build` им пользуется. Повторная сборка на стенде не спросила бэкенд ни про `menu`, ни про `banner`, ни про `post`. CI, который сохраняет `.next/cache` между сборками ради скорости, сохраняет и данные.',
    tone: 'err',
  },
  {
    n: '03',
    t: 'Первый после срока видит старое',
    d: 'ISR и `revalidateTag(…, \'max\')` отдают `STALE` — прошлую версию, а обновление идёт фоном. Тому, кто только что сохранил форму, это выглядит как «не сохранилось». Для «прочитать своё» — `updateTag` в server action или `{ expire: 0 }`.',
    tone: 'warn',
  },
  {
    n: '04',
    t: 'Сброс на сервере не доходит до открытых вкладок',
    d: 'Вебхук с `revalidateTag` обновляет сервер, но вкладка, у которой страница лежит в кеше роутера, покажет старое без запроса — до 5 минут для статической страницы или до перезагрузки. Server action на этой же вкладке кеш роутера сбрасывает; чужой вызов — нет.',
    tone: 'err',
  },
  {
    n: '05',
    t: 'Одна строка `cookies()` делает страницу динамической',
    d: 'Даже если результат не используется. Чтение куки в общем `layout` делает динамическими все страницы под ним — и они пропадают из кеша маршрута и из полного префетча.',
    tone: 'warn',
  },
  {
    n: '06',
    t: '`revalidatePath` сбрасывает и данные',
    d: 'Записи кеша данных, полученные при рендере пути, тоже истекают — с тегами и без. Удобно, но дорого: `revalidatePath(\'/\', \'layout\')` пошлёт к бэкенду все запросы всех страниц.',
  },
  {
    n: '07',
    t: 'Свой `signal` выключает склейку запросов',
    d: 'Передали `AbortController` в `fetch` ради таймаута — и два компонента, которые раньше делили один запрос, теперь делают два. На стенде `stock: 1` и `stock: 2` на одной странице.',
    tone: 'warn',
  },
  {
    n: '08',
    t: '`x-nextjs-cache` есть не всегда',
    d: 'Динамический маршрут и страница с частичным пререндером его не присылают. Отсутствие заголовка не значит «кеш не работал»: `catalog` на `/dynamic` пришёл из кеша данных, а в заголовках об этом ни слова.',
  },
  {
    n: '09',
    t: 'В `next dev` кеша маршрута нет',
    d: 'По документации в режиме разработки страницы всегда рендерятся по запросу. Проверять «почему не обновилось» нужно на `next build` + `next start`, иначе ловится не та картина.',
    tone: 'warn',
  },
];

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'Next.js — Caching and Revalidating (Previous Model)',
    href: 'https://nextjs.org/docs/app/guides/caching-without-cache-components',
    what: '`fetch` с `force-cache`, `unstable_cache`, `dynamic`, `fetchCache`, `revalidate` маршрута',
  },
  {
    title: 'Next.js — fetch',
    href: 'https://nextjs.org/docs/app/api-reference/functions/fetch',
    what: 'значение по умолчанию, `next.revalidate`, `next.tags`, мемоизация и отказ от неё через `signal`',
  },
  {
    title: 'Next.js — revalidateTag, updateTag, revalidatePath',
    href: 'https://nextjs.org/docs/app/api-reference/functions/revalidateTag',
    what: "профиль `'max'`, `{ expire: 0 }`, где можно вызывать; соседние страницы — `updateTag` и `revalidatePath`",
  },
  {
    title: 'Next.js — How revalidation works',
    href: 'https://nextjs.org/docs/app/guides/how-revalidation-works',
    what: 'мягкие теги `_N_T_`, HTML и RSC в одной записи, несколько серверов',
  },
  {
    title: 'Next.js — Prefetching и staleTimes',
    href: 'https://nextjs.org/docs/app/guides/prefetching',
    what: 'что префетчится у статических и динамических страниц, кеш роутера; `staleTimes` — смена 30 → 0 с в 15-й версии',
  },
  {
    title: "Next.js — Caching (Cache Components), 'use cache', cacheLife",
    href: 'https://nextjs.org/docs/app/getting-started/caching',
    what: '`cacheComponents`, `\'use cache\'`, `cacheLife`, `cacheTag`, правила коротких сроков',
  },
  {
    title: 'Next.js — Upgrading to Version 15 и 16',
    href: 'https://nextjs.org/docs/app/guides/upgrading/version-15',
    what: '`fetch` и `GET`-обработчики перестали кешироваться по умолчанию; в 16 — второй аргумент `revalidateTag` и `updateTag`',
  },
];

export const RELATED =
  'Смежное на сайте: [Server Components изнутри](/frameworks/server-components/) — формат RSC и `cache()` из React. [SSR и гидратация](/frameworks/ssr-hydration/) — что делает браузер с HTML из кеша маршрута. [CDN и серверный кеш](/platform/cdn-cache/) — `s-maxage` и `stale-while-revalidate`, которые Next пишет в заголовок. [Кеш данных на клиенте](/frameworks/data-cache/) — та же идея устаревших данных в браузере. [Роутер изнутри](/frameworks/router/) — перехват клика и история. [Острова и resumability](/frameworks/islands/) — другой ответ на вопрос, сколько рендерить на сервере.';
