/* eslint-disable vue/one-component-per-file -- тест монтирует в vue-router несколько крошечных компонентов-заглушек; отдельный файл на каждый ничего не прояснит */
import { writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { type Browser, chromium, firefox, webkit } from 'playwright';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as t from '@/content/frameworks/router/data';
import {
  createClock,
  describePattern,
  hookLog,
  loadRouter,
  loadStrategies,
  makeApp,
  makeShop,
  matchPath,
  play,
  plainRoutes,
  runGuards,
  runWaterfall,
  scoreText,
  summarize,
} from '@/widgets/router-lab/model/run';
import type { GuardRun, RouteRaw, RouterCodes, Strategy, TimelineEvent } from '@/widgets/router-lab/model/types';

/**
 * Тема «Роутер изнутри: от адреса до экрана».
 *
 * Учебный роутер (строки темы, собранные тем же `model/run.ts`, что крутит демо) сверяется
 * с vue-router 5.3.1: регулярки, веса и ключи — с `createRouterMatcher`; порядок списка
 * и `resolve` — с `router.getRoutes()`/`router.resolve()` на сквозной таблице и на сотнях
 * случайных; журналы guards и шкалы загрузки — с роутером, смонтированным во Vue 3.5 в happy-dom.
 * Браузерная часть (`HISTORY_STAND`, `NAVIGATE_STAND`, `CLICK_STAND`, `SCROLL_STAND`,
 * `NAVAPI_SCROLL`, `NAVAPI_ENGINES`) пересобирается в Chromium 153 через Playwright на своём
 * `node:http` (порт 51550); там же исполняются `INTERCEPT_CODE`, `HISTORY_CODE`, `NAVAPI_CODE`
 * и `SCROLL_CODE` (с vue-router, собранным esbuild).
 *
 * Глобалы happy-dom ставятся до загрузки `vue` и `vue-router`: оба смотрят на `document` при
 * импорте. `DUMP=1` пишет снятое в `DUMP_TO` — так литералы и заполнялись.
 */

const win = new Window({ url: 'http://localhost/' });
const GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'SVGElement', 'Text', 'Comment', 'history', 'location'] as const;
const saved = new Map<string, PropertyDescriptor | undefined>();
for (const key of GLOBALS) {
  saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  const value = key === 'window' ? win : (win as unknown as Record<string, unknown>)[key];
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}
const { createApp, h, ref } = await import('vue');
const VR = await import('vue-router');
const { createRouter, createMemoryHistory, createRouterMatcher, RouterView } = VR;

const dump: Record<string, unknown> = {};
afterAll(() => {
  if (process.env.DUMP) writeFileSync(process.env.DUMP_TO ?? 'router-dump.json', JSON.stringify(dump, null, 1));
  for (const [key, desc] of saved) {
    if (desc) Object.defineProperty(globalThis, key, desc);
    else delete (globalThis as Record<string, unknown>)[key];
  }
});

const CODES: RouterCodes = {
  match: t.MATCH_CODE,
  rank: t.RANK_CODE,
  matcher: t.MATCHER_CODE,
  navigate: t.NAVIGATE_CODE,
  guards: t.GUARDS_CODE,
  routes: t.ROUTES_CODE,
  shop: t.SHOP_CODE,
  loaders: t.LOADERS_CODE,
};
const api = loadRouter(CODES);

/** Молчание диагностики vue-router в режиме разработки: «нет совпадения» на каждом промахе фаззинга. */
function quiet<T>(fn: () => T): T {
  const w = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const e = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    return fn();
  } finally {
    w.mockRestore();
    e.mockRestore();
  }
}

const C = { render: () => null };
/** Таблица для vue-router: компоненты с `render`, ленивый `Settings` — функцией. */
const vrRoutes = () => makeApp(CODES, () => {}, (c) => ({ ...c, render: () => null })).routes;

// ─── Шаблон пути ───────────────────────────────────────────────────────────────────────────

describe('шаблон пути → регулярка и вес: мини-версия против createRouterMatcher', () => {
  const EXTRA = ['/', '/users/', '/users/:id-:slug', '/:path(.*)', '/files/:p(.*)', '/a\\:b', '/users/:id/posts/:pid', '/users/:id(\\d+)?'];
  const patterns = [...new Set([...t.PATTERN_ROWS.map((r) => r.pattern), ...t.PATTERN_PRESETS, ...EXTRA])];

  it.each(patterns)('%s', (pattern) => {
    const real = createRouterMatcher([{ path: pattern, component: C }], {}).getRoutes()[0];
    const mine = api.compile(api.tokenize(pattern));
    expect(mine.re.source).toBe(real.re.source);
    expect(mine.re.flags).toBe(real.re.flags);
    expect(mine.score).toEqual(real.score);
    expect(mine.keys).toEqual(real.keys);
  });

  it('PATTERN_ROWS — из vue-router', () => {
    const rows = t.PATTERN_ROWS.map((r) => r.pattern).map((pattern) => {
      const m = createRouterMatcher([{ path: pattern, component: C }], {}).getRoutes()[0];
      return { pattern, re: m.re.source, score: scoreText(m.score) };
    });
    dump.PATTERN_ROWS = (dump.PATTERN_ROWS as unknown) ?? null;
    expect(rows).toEqual(t.PATTERN_ROWS);
    expect(rows.length).toBeGreaterThanOrEqual(8);
  });

  it('WEIGHT_ROWS: веса токенов', () => {
    const w = (p: string) => api.compile(api.tokenize(p)).score.at(-1)!.at(-1);
    expect([w('/users'), w('/:id'), w('/:id(\\d+)'), w('/:id?'), w('/:ids+'), w('/:ids*'), w('/:path(.*)*')]).toEqual([80, 60, 70, 52, 40, 32, -8]);
    expect(api.compile(api.tokenize('/users/')).score).toEqual([[80], [90]]);
    expect(t.WEIGHT_ROWS.map((r) => r.weight)).toEqual(['80', '60', '70', '−8', '−20', '−50', '90']);
  });

  it('describePattern демо: ошибка без ведущей косой', () => {
    expect(describePattern(api, 'users')).toHaveProperty('error');
    expect(describePattern(api, '/users/:id')).toHaveProperty('compiled');
  });
});

// ─── Ранжирование и resolve ────────────────────────────────────────────────────────────────

describe('ранжирование и resolve: мини-версия против vue-router', () => {
  it('сквозная таблица: порядок getRoutes() = список createMatcher = RANKED', () => {
    const router = createRouter({ history: createMemoryHistory(), routes: vrRoutes() as never });
    const real = router.getRoutes().map((r) => ({ path: r.path, name: String(r.name ?? ''), score: '' }));
    const mine = api.createMatcher(plainRoutes(CODES)).list.map((r) => ({ path: r.path, name: r.name ?? '', score: scoreText(r.score) }));
    expect(mine.map(({ path, name }) => ({ path, name }))).toEqual(real.map(({ path, name }) => ({ path, name })));
    dump.RANKED = mine;
    expect(mine).toEqual(t.RANKED);
    // RANK_NOTE: в таблице :id объявлен раньше new, в списке — позже
    expect(t.ROUTES_CODE.indexOf("path: ':id'")).toBeLessThan(t.ROUTES_CODE.indexOf("path: 'new'"));
    const names = mine.map((r) => r.name);
    expect(names.indexOf('user-new')).toBeLessThan(names.indexOf('user'));
    expect(names.indexOf('file')).toBeLessThan(names.indexOf('home'));
    expect(names.at(-1)).toBe('not-found');
  });

  it('RESOLVE_ROWS — router.resolve() и мини resolve', () => {
    const router = createRouter({ history: createMemoryHistory(), routes: vrRoutes() as never });
    const matcher = api.createMatcher(plainRoutes(CODES));
    const rows = t.RESOLVE_ROWS.map((r) => r.path).map((path) => {
      const real = router.resolve(path);
      const mine = matcher.resolve(path)!;
      const row = { path, name: String(real.name), params: JSON.stringify(real.params), matched: real.matched.map((m) => m.path).join(' → ') };
      expect({ path, name: mine.name, params: JSON.stringify(mine.params), matched: mine.matched.map((m) => m.path).join(' → ') }).toEqual(row);
      return row;
    });
    dump.RESOLVE_ROWS = rows;
    expect(rows).toEqual(t.RESOLVE_ROWS);
  });

  it('пресеты демо: победитель matchPath = имя из router.resolve()', () => {
    const router = createRouter({ history: createMemoryHistory(), routes: vrRoutes() as never });
    const routes = plainRoutes(CODES);
    for (const path of t.MATCH_PRESETS) {
      const view = matchPath(api, routes, path);
      expect(view.rows[view.winner].name, path).toBe(String(router.resolve(path).name));
    }
    // MATCH_CAPTION: на /users/new подходят три записи, побеждает user-new
    const v = matchPath(api, routes, '/users/new');
    expect(v.rows.filter((r) => r.fits).map((r) => r.name)).toEqual(['user-new', 'user', 'not-found']);
  });

  it('SAME_SCORE_NOTE: :id и :slug одного веса — второй не получает ничего; :id(\\d+) весит 70', () => {
    const routes = [
      { path: '/users/:id', name: 'id', component: C },
      { path: '/users/:slug', name: 'slug', component: C },
    ];
    const router = createRouter({ history: createMemoryHistory(), routes });
    expect(['/users/1', '/users/ann'].map((p) => router.resolve(p).name)).toEqual(['id', 'id']);
    const typed = createRouter({ history: createMemoryHistory(), routes: [{ path: '/users/:slug', name: 'slug', component: C }, { path: '/users/:id(\\d+)', name: 'id', component: C }] });
    expect(['/users/1', '/users/ann'].map((p) => typed.resolve(p).name)).toEqual(['id', 'slug']);
  });

  it('случайные таблицы: порядок и resolve совпадают с vue-router', () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
    const SEG = ['users', 'new', ':id', ':id(\\d+)', ':id?', ':slug+', ':rest*', 'posts', ':pid', 'settings', ':lang(en|ru)?', 'u-:id', ':a-:b', ':path(.*)*', ':path(.*)', 'files', ''];
    const CHILD = ['', ':id', 'new', 'edit', ':id(\\d+)', 'posts', ':pid?', ':tail(.*)*'];
    const PATHS = ['/', '/users', '/users/', '/users/new', '/users/42', '/users/abc', '/users/42/posts', '/users/42/posts/7', '/settings', '/en/docs', '/ru', '/u-5', '/x-y', '/files/a/b/c', '/a/b/c/d', '/users/42/edit', '/users/new/edit', '/posts/1', '/USERS/NEW', '/en', '/zz', '/users/1/2/3'];
    const fullPath = (path: string, base: string) => (path.startsWith('/') ? path : base + (path && (base.endsWith('/') ? '' : '/') + path));
    const dup = (r: RouteRaw, base = ''): boolean => {
      const full = fullPath(r.path, base);
      const keys = api.compile(api.tokenize(full)).keys.map((k) => k.name);
      return new Set(keys).size !== keys.length || (r.children ?? []).some((c) => dup(c, full));
    };
    let tables = 0;
    let resolved = 0;
    quiet(() => {
      for (let n = 0; n < 900; n++) {
        const routes: RouteRaw[] = [];
        let k = 0;
        const count = 2 + Math.floor(rnd() * 7);
        for (let i = 0; i < count; i++) {
          const depth = 1 + Math.floor(rnd() * 3);
          const r: RouteRaw = { path: '/' + Array.from({ length: depth }, () => pick(SEG)).join('/'), name: `r${k++}`, component: C };
          if (rnd() < 0.35) r.children = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => ({ path: pick(CHILD), name: `r${k++}`, component: C }));
          if (rnd() < 0.15) {
            delete r.name;
            delete r.component;
          }
          routes.push(r);
        }
        if (routes.some((r) => dup(r))) continue;
        const router = createRouter({ history: createMemoryHistory(), routes: routes as never });
        const matcher = api.createMatcher(routes);
        expect(matcher.list.map((r) => r.name), JSON.stringify(routes)).toEqual(router.getRoutes().map((r) => r.name));
        for (const p of PATHS) {
          const a = router.resolve(p);
          const b = matcher.resolve(p);
          const av = a.matched.length ? { name: a.name, params: a.params, matched: a.matched.map((r) => r.path) } : null;
          const bv = b ? { name: b.name, params: b.params, matched: b.matched.map((r) => r.path) } : null;
          expect(bv, `${p} в ${JSON.stringify(routes)}`).toEqual(av);
          resolved++;
        }
        tables++;
      }
    });
    expect(tables).toBeGreaterThan(300);
    expect(resolved).toBeGreaterThan(6000);
  });
});

// ─── Guards ────────────────────────────────────────────────────────────────────────────────

/** Сценарий на настоящем vue-router: тот же `makeApp`, компоненты смонтированы во Vue. */
async function runVueGuards(scenario: (typeof t.GUARD_SCENARIOS)[number]): Promise<GuardRun> {
  const log: string[] = [];
  const recording = { on: false };
  const say = (line: string) => {
    if (recording.on) log.push(line);
  };
  const NESTED = new Set(['UsersLayout', 'User']);
  const app = makeApp(CODES, say, (c, name) => ({ ...c, render: () => (NESTED.has(name) ? h('div', [name, h(RouterView)]) : h('div', name)) }));
  const router = createRouter({ history: createMemoryHistory(), routes: app.routes as never });
  hookLog(router as never, app, say, (to) => to.fullPath ?? to.path);
  const el = document.createElement('div');
  document.body.appendChild(el);
  const vue = createApp({ render: () => h(RouterView) }).use(router);
  vue.mount(el);
  await router.push('/');
  await router.isReady();
  const run = await play({ push: (p) => router.push(p), current: () => router.currentRoute.value.fullPath }, app, scenario, recording, log);
  vue.unmount();
  el.remove();
  return run;
}

describe('guards: учебный роутер против vue-router во Vue', () => {
  it.each(t.GUARD_SCENARIOS.map((s) => [s.id, s] as const))('%s', async (id, scenario) => {
    const real = await runVueGuards(scenario);
    const mine = await runGuards(api, CODES, scenario);
    (dump.GUARD_TRACES ??= {}) as Record<string, GuardRun>;
    (dump.GUARD_TRACES as Record<string, GuardRun>)[id] = real;
    expect(real, `GUARD_TRACES.${id} разошёлся с vue-router`).toEqual(t.GUARD_TRACES[id]);
    if (id === 'race') {
      // Известное расхождение: afterEach отменённой навигации у vue-router на строку позже.
      expect({ ...mine, log: [...mine.log].sort() }).toEqual({ ...real, log: [...real.log].sort() });
      expect(mine.failures).toEqual([8, null]);
    } else {
      expect(mine).toEqual(real);
    }
  });

  it('утверждения сценариев видны в журналах', () => {
    const tr = t.GUARD_TRACES;
    expect(tr.update.log.some((l) => l.startsWith('beforeEnter'))).toBe(false);
    expect(tr.update.log.filter((l) => l.startsWith('beforeRouteUpdate'))).toEqual(['beforeRouteUpdate UsersLayout', 'beforeRouteUpdate User']);
    expect(tr.enter.log).toContain('beforeEnter /users');
    expect(tr.redirect.to).toBe('/login');
    expect(tr.redirect.log.filter((l) => l.startsWith('beforeEach'))).toHaveLength(2);
    expect(tr.redirect.log.some((l) => l.startsWith('import()'))).toBe(false);
    const lazy = tr.lazy.log;
    expect(lazy.indexOf('import() ./Settings.js')).toBeGreaterThan(lazy.indexOf('beforeEnter /settings'));
    expect(lazy.indexOf('import() ./Settings.js')).toBeLessThan(lazy.indexOf('beforeRouteEnter Settings'));
    expect(tr.cancel.failures).toEqual([4]);
    expect(tr.cancel.to).toBe('/users');
    expect(tr.dirty.log).toEqual(['beforeRouteLeave Settings', 'afterEach / failure=4']);
    expect(tr.race.failures).toEqual([8, null]);
  });

  it('ARRAY_FAILURE: beforeResolve с return Promise.all(…) превращает переход в «уже здесь»', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', component: C }, { path: '/a', component: C, meta: { load: () => Promise.resolve('A') } }],
    });
    let armed = false;
    let calls = 0;
    router.beforeResolve((to) => {
      if (!armed || ++calls > 3) return;
      return Promise.all(to.matched.map((r) => (r.meta.load as (() => Promise<string>) | undefined)?.())) as never;
    });
    await router.push('/');
    armed = true;
    const r = await quiet(() => router.push('/a'));
    expect(r?.type).toBe(t.ARRAY_FAILURE);
    expect(router.currentRoute.value.fullPath).toBe('/');
  });

  it('push не бросает при отмене: FAILURE_ROWS', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: C }, { path: '/a', component: C }] });
    await router.push('/');
    router.beforeEach((to) => (to.path === '/a' ? false : undefined));
    const r = await router.push('/a');
    expect(VR.isNavigationFailure(r, VR.NavigationFailureType.aborted)).toBe(true);
    expect([VR.NavigationFailureType.aborted, VR.NavigationFailureType.cancelled, VR.NavigationFailureType.duplicated]).toEqual([4, 8, 16]);
    expect(t.FAILURE_ROWS.map((r) => r.type)).toEqual(['`4`', '`8`', '`16`']);
    // …а исключение в guard — отклонённый промис
    const throwing = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: C }, { path: '/b', component: C }] });
    await throwing.push('/');
    throwing.beforeEach((to) => {
      if (to.path === '/b') throw new Error('сломался');
    });
    throwing.onError(() => {});
    await expect(throwing.push('/b')).rejects.toThrow('сломался');
  });

  it('NEXT_NOTE: next() в vue-router 5 помечен устаревшим (R0025)', async () => {
    const { readFileSync } = await import('node:fs');
    const { createRequire } = await import('node:module');
    const dir = createRequire(import.meta.url).resolve('vue-router/package.json').replace(/package\.json$/, 'dist/');
    const { readdirSync } = await import('node:fs');
    const text = readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => readFileSync(dir + f, 'utf8')).join('\n');
    expect(text).toContain('VUE_ROUTER_R0025');
    expect(text).toContain('The `next()` callback in navigation guards is deprecated.');
    expect(VR).toHaveProperty('createRouterMatcher');
  });
});

// ─── Водопад ───────────────────────────────────────────────────────────────────────────────

const immediate = async () => {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
};

/** Шкала на настоящем vue-router во Vue. Стратегия А — сами компоненты, без хука. */
async function realWaterfall(strategy: Strategy): Promise<TimelineEvent[]> {
  const clock = createClock(immediate);
  const events: TimelineEvent[] = [];
  const ev = (what: string) => events.push({ t: clock.now(), what });
  const ready = new Set<string>();
  const drawn = new Set<string>();
  let routes: RouteRaw[] = [];
  const loaderOf = (name: string) => {
    const walk = (list: RouteRaw[]): RouteRaw | undefined => list.map((r) => (r.component && String((r.meta as { level?: string })?.level) === name ? r : walk(r.children ?? []))).find(Boolean);
    return (walk(routes)?.meta as { load: () => Promise<string> }).load;
  };
  const component = (name: string) => ({
    name,
    setup() {
      const data = ref<string | null>(strategy === 'inComponent' ? null : 'есть');
      if (strategy === 'inComponent') void loaderOf(name)().then((d) => (data.value = d));
      return () => {
        if (!data.value || (strategy !== 'inComponent' && !ready.has(name))) return h('p', `загрузка ${name}`);
        if (!drawn.has(name)) {
          drawn.add(name);
          ev(`render ${name}`);
        }
        return h('div', [name, name === 'Product' ? null : h(RouterView)]);
      };
    },
  });
  routes = makeShop(t.SHOP_CODE, t.SHOP_LEVELS, clock, ev, (name) => ready.add(name), component);
  const tag = (list: RouteRaw[], depth = 0) => list.forEach((r) => ((r.meta = { ...r.meta, level: t.SHOP_LEVELS[depth].name }), tag(r.children ?? [], depth + 1)));
  tag(routes);
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => h('p', 'home') } }, ...routes] as never });
  const el = document.createElement('div');
  document.body.appendChild(el);
  const vue = createApp({ render: () => h(RouterView) }).use(router);
  vue.mount(el);
  await router.push('/');
  router.afterEach((to, _from, failure) => {
    if (!failure) ev(`commit ${to.fullPath}`);
  });
  if (strategy !== 'inComponent') loadStrategies(t.LOADERS_CODE)[strategy](router);
  const done = router.push(t.SHOP_TARGET);
  await clock.run();
  await done;
  await immediate();
  vue.unmount();
  el.remove();
  return events;
}

describe('водопад: учебный роутер против vue-router во Vue', () => {
  it.each(t.STRATEGIES.map((s) => s.id))('%s — те же события в те же моменты', async (id) => {
    const real = await realWaterfall(id);
    const mine = await runWaterfall(api, CODES, t.SHOP_LEVELS, id, t.SHOP_TARGET);
    expect(mine.events).toEqual(real);
    const { commit, ready } = summarize(real);
    (dump.WATERFALL ??= {}) as Record<string, unknown>;
    (dump.WATERFALL as Record<string, unknown>)[id] = { commit, ready };
    expect({ commit, ready }).toEqual(t.WATERFALL[id]);
  });

  it('LAZY_NOTE и тонкое место 07: чанки стартуют разом, водопад данных — 750 мс сверх кода', async () => {
    const run = await runWaterfall(api, CODES, t.SHOP_LEVELS, 'inComponent', t.SHOP_TARGET);
    expect(run.spans.filter((s) => s.kind === 'chunk').map((s) => s.from)).toEqual([0, 0, 0]);
    const sum = t.SHOP_LEVELS.reduce((n, l) => n + l.data, 0);
    expect(sum).toBe(750);
    expect(t.WATERFALL.inComponent.ready - t.WATERFALL.inComponent.commit).toBe(sum);
    expect(t.WATERFALL.serial.commit).toBe(t.WATERFALL.inComponent.ready);
    expect(t.DATA_CAPTION).toContain(`${t.WATERFALL.serial.commit} мс`);
    expect(t.WATERFALL.early.ready).toBe(Math.max(...t.SHOP_LEVELS.map((l) => l.data)));
    expect(t.PITFALLS.find((p) => p.n === '07')!.d).toContain('750 мс');
  });
});

// ─── Chromium ──────────────────────────────────────────────────────────────────────────────

const PORT = 51550;
let server: Server;
let browser: Browser;
let bundle = '';
const pages = new Map<string, string>();

beforeAll(async () => {
  const out = await build({
    stdin: { contents: "export { createApp, h } from 'vue';\nexport * from 'vue-router';", resolveDir: process.cwd(), loader: 'js' },
    bundle: true,
    format: 'esm',
    write: false,
    platform: 'browser',
    define: { 'process.env.NODE_ENV': '"production"', __VUE_OPTIONS_API__: 'true', __VUE_PROD_DEVTOOLS__: 'false', __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false' },
    logLevel: 'silent',
  });
  bundle = out.outputFiles[0].text;
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
    if (url.pathname === '/rt.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      res.end(bundle);
      return;
    }
    const prefix = [...pages.keys()].find((k) => url.pathname.startsWith(k));
    res.writeHead(prefix ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' });
    res.end(prefix ? pages.get(prefix) : 'нет');
  });
  await new Promise<void>((r) => server.listen(PORT, '127.0.0.1', () => r()));
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await new Promise((r) => server?.close(r));
});

const BASE = `http://127.0.0.1:${PORT}`;

describe('Chromium: история вкладки и Navigation API', () => {
  pages.set('/h/', `<!doctype html><meta charset="utf-8"><title>h</title><body>
<script>
  window.log = [];
  addEventListener('popstate', (e) => log.push('popstate:' + JSON.stringify(e.state)));
  addEventListener('hashchange', () => log.push('hashchange'));
  navigation.addEventListener('navigate', (e) => log.push('navigate:' + e.navigationType));
</script>`);

  it('HISTORY_STAND и CLONE_FACTS', async () => {
    const page = await browser.newPage();
    await page.goto(`${BASE}/h/start`);
    const ACTIONS: [string, string][] = [
      ["history.pushState({ n: 1 }, '', '/h/a')", "history.pushState({ n: 1 }, '', '/h/a')"],
      ["history.pushState({ n: 2 }, '', '/h/b')", "history.pushState({ n: 2 }, '', '/h/b')"],
      ["history.replaceState({ n: 3 }, '', '/h/c')", "history.replaceState({ n: 3 }, '', '/h/c')"],
      ['history.back()', 'history.back()'],
      ['history.forward()', 'history.forward()'],
      ["location.hash = '#top'", "location.hash = '#top'"],
      ['history.back() с якоря', 'history.back()'],
    ];
    const stand: { action: string; events: string[] }[] = [];
    for (const [action, code] of ACTIONS) {
      await page.evaluate(() => ((window as unknown as { log: string[] }).log = []));
      await page.evaluate(code);
      await page.waitForTimeout(150);
      stand.push({ action: `\`${action.replace(/'\/h\//g, "'/")}\``, events: await page.evaluate(() => (window as unknown as { log: string[] }).log) });
    }
    dump.HISTORY_STAND = stand;
    expect(stand).toEqual(t.HISTORY_STAND);
    // На pushState и replaceState — ни одного popstate
    expect(stand.slice(0, 3).every((r) => !r.events.some((e) => e.startsWith('popstate')))).toBe(true);

    const clone = await page.evaluate(() => {
      const out: { what: string; result: string }[] = [];
      const d = new Date(0);
      history.pushState({ d, m: new Map([[1, 2]]) }, '', '/h/d');
      const s = history.state as { d: Date; m: Map<number, number> };
      out.push({ what: '`Date` в состоянии', result: `\`history.state.d instanceof Date\` — ${s.d instanceof Date}, \`=== d\` — ${s.d === d}` });
      out.push({ what: '`Map` в состоянии', result: `\`instanceof Map\` — ${s.m instanceof Map}, \`get(1)\` — ${s.m.get(1)}` });
      for (const [what, fn] of [
        ['функция в состоянии', () => history.pushState({ f() {} }, '', '/h/f')],
        ['адрес другого сайта', () => history.pushState(null, '', 'http://example.com/x')],
      ] as const) {
        try {
          fn();
          out.push({ what, result: 'без ошибки' });
        } catch (e) {
          out.push({ what, result: `\`${(e as Error).name}\`` });
        }
      }
      return out;
    });
    dump.CLONE_FACTS = clone;
    expect(clone).toEqual(t.CLONE_FACTS);
    await page.close();
  });

  it('NAVIGATE_STAND и NAVAPI_ORDER', async () => {
    pages.set('/n/', `<!doctype html><meta charset="utf-8"><title>n</title><body>
<a id="in" href="/n/users/7">a</a><a id="out" href="http://localhost:${PORT}/x">b</a><a id="dl" href="/n/file" download>c</a>
<a id="mail" href="mailto:a@b.c">d</a><a id="blank" href="/n/users/7" target="_blank">e</a><a id="hash" href="#top">f</a>
<script>
  window.seen = null;
  window.order = [];
  navigation.addEventListener('navigate', (e) => {
    window.seen = { type: e.navigationType, canIntercept: e.canIntercept, userInitiated: e.userInitiated, hashChange: e.hashChange, download: e.downloadRequest };
    if (window.intercepting) {
      order.push('navigate');
      e.intercept({ async handler() { order.push('handler'); await new Promise((r) => setTimeout(r, 30)); order.push('handler done'); } });
    } else if (!e.hashChange && e.userInitiated) e.preventDefault(); // клики не уводят со страницы
  });
  navigation.addEventListener('currententrychange', () => window.intercepting && order.push('currententrychange'));
  navigation.addEventListener('navigatesuccess', () => window.intercepting && order.push('navigatesuccess'));
</script>`);
    const page = await browser.newPage();
    await page.goto(`${BASE}/n/start`);
    const reset = () => page.evaluate(() => ((window as unknown as { seen: unknown }).seen = null));
    const seen = () => page.evaluate(() => (window as unknown as { seen: unknown }).seen);
    const stand: { how: string; seen: unknown }[] = [];
    const record = async (how: string, act: () => Promise<unknown>) => {
      await reset();
      await act();
      await page.waitForTimeout(200);
      stand.push({ how, seen: await seen() });
      if (page.url() !== `${BASE}/n/start`) await page.goto(`${BASE}/n/start`);
    };
    await record('`history.pushState(…)`', () => page.evaluate(() => history.pushState(null, '', '/n/p')));
    await record('`history.back()`', async () => {
      await page.evaluate(() => history.pushState(null, '', '/n/p'));
      await reset();
      await page.evaluate(() => history.back());
    });
    await record('клик по своей ссылке', () => page.click('#in'));
    await record('клик по ссылке на другой сайт', () => page.click('#out'));
    await record('клик по `download`', () => page.click('#dl'));
    await record('клик по `mailto:`', () => page.click('#mail'));
    await record('клик по якорю', () => page.click('#hash'));
    await record('⌘ + клик по своей ссылке', async () => {
      await page.click('#in', { modifiers: ['Meta'] });
      await page.waitForTimeout(150);
      for (const p of page.context().pages()) if (p !== page) await p.close();
    });
    await record('клик по `target="_blank"`', async () => {
      await page.click('#blank');
      await page.waitForTimeout(150);
      for (const p of page.context().pages()) if (p !== page) await p.close();
    });
    dump.NAVIGATE_STAND = stand;
    expect(stand).toEqual(t.NAVIGATE_STAND);

    await page.evaluate(() => ((window as unknown as { intercepting: boolean }).intercepting = true));
    const order = await page.evaluate(async () => {
      const w = window as unknown as { order: string[] };
      const r = navigation.navigate('/n/nav');
      void r.committed!.then(() => w.order.push('committed'));
      await r.finished;
      w.order.push('finished');
      await new Promise((res) => setTimeout(res, 20));
      return [...w.order];
    });
    dump.NAVAPI_ORDER = order;
    expect(order).toEqual(t.NAVAPI_ORDER);
    const prevented = await page.evaluate(async () => {
      navigation.addEventListener('navigate', (e) => e.preventDefault(), { once: true });
      const before = location.pathname;
      const r = navigation.navigate('/n/blocked');
      const errs = await Promise.all([r.committed!.then(() => 'ok', (e) => e.name), r.finished!.then(() => 'ok', (e) => e.name)]);
      return { errs, same: location.pathname === before };
    });
    expect(prevented).toEqual({ errs: ['AbortError', 'AbortError'], same: true });
    await page.close();
  });

  it('NAVAPI_ENGINES: navigation и intercept() в трёх движках', async () => {
    const engines: { engine: string; has: boolean }[] = [];
    for (const [name, type] of [['Chromium', chromium], ['Firefox', firefox], ['WebKit', webkit]] as const) {
      const b = name === 'Chromium' ? browser : await type.launch();
      const p = await b.newPage();
      await p.goto(`${BASE}/h/x`);
      const has = await p.evaluate(() => typeof window.navigation === 'object' && typeof NavigateEvent !== 'undefined' && 'intercept' in NavigateEvent.prototype);
      engines.push({ engine: `${name} ${b.version().split('.').slice(0, name === 'WebKit' ? 2 : 1).join('.')}`, has });
      await p.close();
      if (b !== browser) await b.close();
    }
    dump.NAVAPI_ENGINES = engines;
    expect(engines).toEqual(t.NAVAPI_ENGINES);
  }, 60_000);
});

describe('Chromium: перехват клика', () => {
  pages.set('/c/', `<!doctype html><meta charset="utf-8"><title>c</title>
<style>a{display:block;margin:8px;padding:6px}</style><body>
<a id="in" href="/c/users/7">in</a><a id="query" href="/c/users?page=2">query</a>
<a id="inner" href="/c/users/8"><span id="span">span</span></a><a id="hash" href="#top">hash</a>
<a id="out" href="http://localhost:${PORT}/c/users/7">out</a><a id="blank" href="/c/users/7" target="_blank">blank</a>
<a id="dl" href="/c/users/7" download>dl</a><a id="mail" href="mailto:a@b.c">mail</a>
<script>
${t.INTERCEPT_CODE}
window.log = [];
document.addEventListener('click', (e) => log.push({ ev: 'click', decision: shouldIntercept(e, new URL(location.href)) }));
document.addEventListener('auxclick', () => log.push({ ev: 'auxclick' }));
navigation.addEventListener('navigate', (e) => {
  log.push({ ev: 'navigate', canIntercept: e.canIntercept, hashChange: e.hashChange, download: e.downloadRequest });
  if (!e.hashChange) e.preventDefault();
});
</script>`);

  it('CLICK_STAND: что сделал браузер и что решила shouldIntercept', async () => {
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    const start = `${BASE}/c/list`;
    await page.goto(start);
    let popups = 0;
    context.on('page', (p) => {
      popups++;
      void p.close();
    });
    let downloads = 0;
    page.on('download', () => downloads++);
    const ACT: Record<string, (sel: string) => Promise<void>> = {
      plain: (s) => page.click(s),
      meta: (s) => page.click(s, { modifiers: ['Meta'] }),
      shift: (s) => page.click(s, { modifiers: ['Shift'] }),
      alt: (s) => page.click(s, { modifiers: ['Alt'] }),
      middle: (s) => page.click(s, { button: 'middle' }),
      enter: async (s) => {
        await page.focus(s);
        await page.keyboard.press('Enter');
      },
      ctrl: (s) => page.click(s, { modifiers: ['Control'] }),
    };
    const rows: t.ClickRow[] = [];
    for (const link of t.CLICK_LINKS) {
      for (const action of t.CLICK_ACTIONS) {
        if (page.url() !== start) await page.goto(start);
        await page.evaluate(() => ((window as unknown as { log: unknown[] }).log = []));
        const p0 = popups;
        const d0 = downloads;
        const sel = link.id === 'inner' ? '#span' : `#${link.id}`;
        await ACT[action.id](action.id === 'enter' && link.id === 'inner' ? '#inner' : sel);
        await page.waitForTimeout(250);
        const log = await page.evaluate(() => (window as unknown as { log: { ev: string; decision?: boolean; canIntercept?: boolean; hashChange?: boolean; download?: string | null }[] }).log);
        const click = log.find((l) => l.ev === 'click' || l.ev === 'auxclick');
        const nav = log.find((l) => l.ev === 'navigate');
        rows.push({
          link: link.id,
          action: action.id,
          event: (click?.ev as ClickEv) ?? null,
          navigate: !nav ? null : nav.download !== null ? 'download' : nav.hashChange ? 'hash' : nav.canIntercept ? 'same' : 'leave',
          popup: popups > p0,
          download: downloads > d0,
          decision: click?.ev === 'click' ? Boolean(click.decision) : null,
        });
      }
    }
    dump.CLICK_STAND = rows;
    expect(rows).toEqual(t.CLICK_STAND);
    // Правило темы: забрать клик — ровно тогда, когда браузер сменил бы документ в этой же вкладке на свой адрес.
    for (const r of rows) expect(r.decision === true, `${r.link} ${r.action}`).toBe(r.navigate === 'same');
    await context.close();
  }, 120_000);

  it('LINK_ROWS: <a href> против <div @click>', async () => {
    pages.set('/l/', `<!doctype html><meta charset="utf-8"><title>l</title><body>
<a id="a" href="/l/users/7">ссылка</a><div id="d">div</div><button id="end">конец</button>
<script>document.getElementById('d').addEventListener('click', () => history.pushState(null, '', '/l/users/8'));</script>`);
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${BASE}/l/list`);
    let popups = 0;
    context.on('page', () => popups++);
    const tabs: string[] = [];
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Tab');
      tabs.push(await page.evaluate(() => document.activeElement?.id ?? ''));
    }
    expect(tabs).toEqual(['a', 'end', '']);
    expect(await page.getByRole('link').count()).toBe(1);
    await page.click('#d', { modifiers: ['Meta'] });
    await page.waitForTimeout(200);
    expect({ popups, path: new URL(page.url()).pathname }).toEqual({ popups: 0, path: '/l/users/8' });
    await page.click('#a', { modifiers: ['Meta'] });
    await page.waitForTimeout(300);
    expect(popups).toBe(1);
    await context.close();
    // ROUTERLINK_NOTE: <RouterLink> — настоящий <a href>, проверка клика — модификаторы, кнопка, _blank
    expect(t.SCROLL_STAND.routerLinkHtml).toMatch(/^<a href="[^"]+\/users\/2"/);
    const { readFileSync } = await import('node:fs');
    const { createRequire } = await import('node:module');
    const src = readFileSync(createRequire(import.meta.url).resolve('vue-router/package.json').replace(/package\.json$/, 'dist/vue-router.js'), 'utf8');
    const guard = src.slice(src.indexOf('function guardEvent'), src.indexOf('function includesParams'));
    for (const piece of ['e.metaKey || e.altKey || e.ctrlKey || e.shiftKey', 'e.defaultPrevented', 'e.button', '_blank']) expect(guard).toContain(piece);
    expect(guard).not.toContain('origin');
    expect(guard).not.toContain('download');
  });

  it('HISTORY_CODE: клик по своей ссылке рисует без перезагрузки, «назад» — тоже', async () => {
    pages.set('/r/', `<!doctype html><meta charset="utf-8"><title>r</title><body>
<a id="in" href="/r/users/7">in</a><a id="out" href="http://localhost:${PORT}/r/x">out</a>
<script>${t.INTERCEPT_CODE}\n${t.HISTORY_CODE}\nwindow.renders = []; window.marker = Math.random(); startRouter((p) => renders.push(p));</script>`);
    const page = await browser.newPage();
    await page.goto(`${BASE}/r/list`);
    const marker = await page.evaluate(() => (window as unknown as { marker: number }).marker);
    await page.click('#in');
    await page.evaluate(() => history.back());
    await page.waitForTimeout(150);
    const state = await page.evaluate(() => ({ renders: (window as unknown as { renders: string[] }).renders, marker: (window as unknown as { marker: number }).marker, path: location.pathname }));
    expect(state).toEqual({ renders: ['/r/list', '/r/users/7', '/r/list'], marker, path: '/r/list' });
    await page.close();
  });

  it('NAVAPI_CODE: тот же роутер на navigate', async () => {
    pages.set('/v/', `<!doctype html><meta charset="utf-8"><title>v</title><body>
<a id="in" href="/v/users/7">in</a><a id="hash" href="#top">hash</a>
<script>${t.NAVAPI_CODE}\nwindow.renders = []; window.marker = Math.random(); startRouter(async (p) => renders.push(p));</script>`);
    const page = await browser.newPage();
    await page.goto(`${BASE}/v/list`);
    const marker = await page.evaluate(() => (window as unknown as { marker: number }).marker);
    await page.click('#in');
    await page.click('#hash');
    await page.evaluate(() => history.pushState(null, '', '/v/pushed'));
    await page.evaluate(() => history.go(-2));
    await page.waitForTimeout(200);
    const state = await page.evaluate(() => ({ renders: (window as unknown as { renders: string[] }).renders, marker: (window as unknown as { marker: number }).marker }));
    // pushState тоже даёт navigate — перехваченный, он тоже рисует.
    expect(state).toEqual({ renders: ['/v/list', '/v/users/7', '/v/pushed', '/v/users/7'], marker });
    await page.close();
  });
});

type ClickEv = 'click' | 'auxclick';

describe('Chromium: прокрутка', () => {
  const app = (withScroll: boolean, base: string) => `<!doctype html><meta charset="utf-8"><title>s</title>
<style>body{margin:0} .tall{height:4000px}</style><div id="app"></div>
<script type="module">
import { createApp, h, createRouter, createWebHistory, RouterView, RouterLink } from '/rt.js';
window.log = [];
const Page = (name) => ({ name, render: () => h('div', { class: 'tall' }, [h('h1', name), h(RouterLink, { to: '/users/2', id: 'link' }, () => 'к пользователю 2')]) });
const routes = [{ path: '/', component: Page('home') }, { path: '/users/:id', component: Page('user') }];
const createWebHistoryBase = () => createWebHistory(${JSON.stringify(base)});
let router;
${withScroll ? `{ const createWebHistory = createWebHistoryBase; ${t.SCROLL_CODE.replace('scrollBehavior(to, from, savedPosition) {', 'scrollBehavior(to, from, savedPosition) {\n    log.push({ saved: savedPosition });')}\n window.router = router; }` : 'window.router = createRouter({ history: createWebHistoryBase(), routes });'}
createApp({ render: () => h(RouterView) }).use(window.router).mount('#app');
await window.router.isReady();
window.ready = true;
</script>`;

  it('SCROLL_STAND: vue-router в Chromium и браузер без роутера', async () => {
    pages.set('/sw/', app(true, '/sw/'));
    pages.set('/so/', app(false, '/so/'));
    pages.set('/plain', '<!doctype html><title>p</title><style>body{margin:0} .tall{height:4000px}</style><div class="tall"></div>');
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    type W = { router: { push(p: string): Promise<unknown> }; log: { saved: unknown }[]; ready: boolean };
    await page.goto(`${BASE}/sw/`);
    await page.waitForFunction(() => (window as unknown as W).ready);
    const restorationWith = await page.evaluate(() => history.scrollRestoration);
    await page.evaluate(() => scrollTo(0, 1200));
    await page.evaluate(() => (window as unknown as W).router.push('/users/1'));
    await page.waitForTimeout(100);
    const afterPush = await page.evaluate(() => ({ state: history.state, saved: (window as unknown as W).log.at(-1)!.saved }));
    await page.evaluate(() => scrollTo(0, 300));
    await page.evaluate(() => history.back());
    await page.waitForTimeout(300);
    const afterBack = await page.evaluate(() => ({ y: Math.round(scrollY), saved: (window as unknown as W).log.at(-1)!.saved }));
    const routerLinkHtml = await page.evaluate(() => document.getElementById('link')!.outerHTML);

    const p2 = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await p2.goto(`${BASE}/so/`);
    await p2.waitForFunction(() => (window as unknown as W).ready);
    const restorationWithout = await p2.evaluate(() => history.scrollRestoration);
    await p2.evaluate(() => scrollTo(0, 1200));
    await p2.evaluate(() => (window as unknown as W).router.push('/users/1'));
    await p2.waitForTimeout(100);
    const yAfterPushWithout = await p2.evaluate(() => Math.round(scrollY));

    const p3 = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await p3.goto(`${BASE}/plain`);
    const plain = async (mode: 'auto' | 'manual') => {
      await p3.evaluate((m) => {
        history.scrollRestoration = m;
        scrollTo(0, 1500);
        history.pushState(null, '', '/plain2');
        scrollTo(0, 200);
        history.back();
      }, mode);
      await p3.waitForTimeout(300);
      return p3.evaluate(() => Math.round(scrollY));
    };
    const plainAuto = await plain('auto');
    const plainManual = await plain('manual');

    const stand: t.ScrollStand = {
      stateAfterPush: afterPush.state,
      restorationWith,
      restorationWithout,
      yAfterPushWithout,
      savedOnBack: afterBack.saved,
      yAfterBack: afterBack.y,
      savedOnPush: afterPush.saved,
      plainAuto,
      plainManual,
      routerLinkHtml,
    };
    dump.SCROLL_STAND = stand;
    expect(stand).toEqual(t.SCROLL_STAND);
    for (const p of [page, p2, p3]) await p.close();
  });

  it('NAVAPI_SCROLL: прокрутка и фокус после intercept()', async () => {
    pages.set('/ns/', `<!doctype html><meta charset="utf-8"><title>ns</title>
<style>body{margin:0} .tall{height:5000px}</style><button id="btn">кнопка</button><div class="tall"></div>
<script>
window.mode = {};
navigation.addEventListener('navigate', (e) => {
  if (!e.canIntercept || e.hashChange) return;
  e.intercept({ ...(mode.scroll ? { scroll: mode.scroll } : {}), async handler() { await new Promise((r) => setTimeout(r, 30)); if (mode.call) e.scroll(); } });
});
</script>`);
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.goto(`${BASE}/ns/a`);
    type M = { mode: { scroll?: string; call?: boolean } };
    const rows: { k: string; before: number; after: number; focus: string }[] = [];
    const step = async (k: string, before: number, fn: () => Promise<unknown>) => {
      await page.evaluate((y) => {
        scrollTo(0, y);
        document.getElementById('btn')!.focus({ preventScroll: true });
      }, before);
      await page.evaluate(fn);
      await page.waitForTimeout(250);
      rows.push({ k, before, ...(await page.evaluate(() => ({ after: Math.round(scrollY), focus: document.activeElement?.tagName ?? '' }))) });
    };
    await step('`navigation.navigate(\'/b\')`', 1500, () => navigation.navigate('/ns/b').finished!);
    await step('«назад» на `/a`', 700, () => navigation.back().finished!);
    await step('«вперёд» на `/b`', 0, () => navigation.forward().finished!);
    await page.evaluate(() => ((window as unknown as M).mode = { scroll: 'manual' }));
    await step('`scroll: \'manual\'`', 900, () => navigation.navigate('/ns/c').finished!);
    await page.evaluate(() => ((window as unknown as M).mode = { scroll: 'manual', call: true }));
    await step('`scroll: \'manual\'` и `event.scroll()`', 900, () => navigation.navigate('/ns/d').finished!);
    dump.NAVAPI_SCROLL = rows;
    expect(rows).toEqual(t.NAVAPI_SCROLL);
    await page.close();
  });
});

