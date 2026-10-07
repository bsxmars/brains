import type {
  AppParts,
  Compiled,
  GuardRun,
  GuardScenario,
  MatchView,
  RouteRaw,
  RouterApi,
  RouterCodes,
  Session,
  ShopLevel,
  Span,
  Strategy,
  TimelineEvent,
  Token,
  WaterfallRun,
} from './types';

/**
 * Демо и тест спрашивают одни и те же функции — строки учебного роутера из темы «Роутер
 * изнутри» (`MATCH_CODE`, `RANK_CODE`, `MATCHER_CODE`, `NAVIGATE_CODE`, `GUARDS_CODE`,
 * `ROUTES_CODE`, `SHOP_CODE`, `LOADERS_CODE`).
 *
 * Строки напечатаны на странице, собраны здесь `new Function` и прогоняются
 * `tests/unit/router.test.ts` рядом с настоящим vue-router 5.3.1: регулярки и веса —
 * с `createRouterMatcher`, порядок списка и `resolve` — с `router.getRoutes()` и
 * `router.resolve()`, журналы guards и шкалы загрузки — с роутером, смонтированным во Vue.
 *
 * `import()` в строках маршрутов подменяется на `__import(…)`: модулей `./Settings.js` и
 * `./Shop.js` нет, вместо них загрузчик с журналом и виртуальной задержкой. Больше строки
 * ничем не правятся. Ни DOM, ни Vue: модуль импортирует юнит-тест.
 */
export function loadRouter(codes: Pick<RouterCodes, 'match' | 'rank' | 'matcher' | 'navigate'>): RouterApi {
  const body = [codes.match, codes.rank, codes.matcher, codes.navigate].join('\n');
  return new Function(`${body}\nreturn { tokenize, compile, compareRoutes, createMatcher, createRouter };`)() as RouterApi;
}

const withImport = (code: string) => code.replace(/\bimport\(/g, '__import(');

/** Компоненты, которые `ROUTES_CODE` называет по имени, — подставляются снаружи. */
export const COMPONENTS = ['Home', 'UsersLayout', 'UsersList', 'User', 'UserPosts', 'UserNew', 'Login', 'FileView', 'NotFound'] as const;

type Component = Record<string, unknown>;
type Say = (line: string) => void;

/**
 * Исполнить `GUARDS_CODE` + `ROUTES_CODE`. Компоненты — объекты с тремя guards, каждый пишет
 * строку в журнал; `decorate` даёт тесту дописать им `render`. `beforeEnter` записей тоже
 * обёрнуты журналом. `import('./Settings.js')` отдаёт `Settings` из `GUARDS_CODE`.
 */
export function makeApp(codes: Pick<RouterCodes, 'guards' | 'routes'>, say: Say, decorate: (c: Component, name: string) => Component = (c) => c): AppParts {
  const make = (name: string): Component =>
    decorate(
      {
        name,
        beforeRouteEnter() {
          say(`beforeRouteEnter ${name}`);
        },
        beforeRouteUpdate() {
          say(`beforeRouteUpdate ${name}`);
        },
        beforeRouteLeave() {
          say(`beforeRouteLeave ${name}`);
        },
      },
      name,
    );
  let app: AppParts | null = null;
  const importer = async (path: string) => {
    say(`import() ${path}`);
    const name = path.replace(/^.*\//, '').replace(/\.js$/, '');
    const own = (name === 'Settings' ? app!.Settings : {}) as { beforeRouteLeave?: (...args: unknown[]) => unknown };
    const base = make(name);
    return {
      default: {
        ...base,
        beforeRouteLeave(...args: unknown[]) {
          say(`beforeRouteLeave ${name}`);
          return own.beforeRouteLeave?.(...args);
        },
      },
    };
  };
  const body = `${codes.guards}\n${withImport(codes.routes)}\nreturn { routes, session, installGuards, Settings };`;
  app = new Function(...COMPONENTS, '__import', body)(...COMPONENTS.map(make), importer) as AppParts;
  const wrap = (list: RouteRaw[]) => {
    for (const r of list) {
      const own = r.beforeEnter;
      if (own) {
        r.beforeEnter = (to, from) => {
          say(`beforeEnter ${r.path}`);
          return own(to, from);
        };
      }
      if (r.children) wrap(r.children);
    }
  };
  wrap(app.routes);
  return app;
}

/** Сессия, с которой начинается каждый сценарий: пользователь вошёл, прав админа нет. */
export const START_SESSION: Session = { user: 'ann', admin: false, dirty: false };

/** Роутер, у которого сценарий умеет `push` и знает текущий адрес, — учебный или настоящий. */
export interface Pushable {
  push(path: string): Promise<unknown>;
  current(): string;
}

/** Прогнать сценарий: подготовка без журнала, потом переходы с журналом. */
export async function play(router: Pushable, app: AppParts, scenario: GuardScenario, recording: { on: boolean }, log: string[]): Promise<GuardRun> {
  Object.assign(app.session, START_SESSION);
  for (const path of scenario.setup) await router.push(path);
  Object.assign(app.session, scenario.session);
  const from = router.current();
  log.length = 0;
  recording.on = true;
  const results = await Promise.all(scenario.go.map((path) => router.push(path)));
  recording.on = false;
  const failures = results.map((r) => (r && typeof r === 'object' && 'type' in r ? (r as { type: number }).type : null));
  return { from, to: router.current(), failures, log: [...log] };
}

/** Журнал хуков вокруг `installGuards`: порядок регистрации тот же у учебного и настоящего роутера. */
export function hookLog(router: { beforeEach(fn: (to: { path: string }) => void): void; beforeResolve(fn: (to: { path: string }) => void): void; afterEach(fn: (to: { path: string }, from: unknown, f: { type: number } | null | undefined) => void): void }, app: AppParts, say: Say, path: (to: { path: string; fullPath?: string }) => string) {
  router.beforeEach((to) => {
    say(`beforeEach ${path(to)}`);
  });
  app.installGuards(router as never);
  router.beforeResolve((to) => {
    say(`beforeResolve ${path(to)}`);
  });
  router.afterEach((to, _from, failure) => {
    say(`afterEach ${path(to)}${failure ? ` failure=${failure.type}` : ''}`);
  });
}

/** Сценарий на учебном роутере. */
export async function runGuards(api: RouterApi, codes: RouterCodes, scenario: GuardScenario): Promise<GuardRun> {
  const log: string[] = [];
  const recording = { on: false };
  const say: Say = (line) => {
    if (recording.on) log.push(line);
  };
  const app = makeApp(codes, say);
  const router = api.createRouter(api.createMatcher(app.routes));
  hookLog(router as never, app, say, (to) => to.path);
  await router.push('/');
  return play({ push: (p) => router.push(p), current: () => router.current.path }, app, scenario, recording, log);
}

// ─── Сопоставление ─────────────────────────────────────────────────────────────────────────

/** Таблица маршрутов из `ROUTES_CODE` без журнала — для сопоставления. */
export function plainRoutes(codes: RouterCodes): RouteRaw[] {
  return makeApp(codes, () => {}).routes;
}

export function matchPath(api: RouterApi, routes: RouteRaw[], path: string): MatchView {
  const matcher = api.createMatcher(routes);
  const rows = matcher.list.map((r) => ({ path: r.path, name: r.name ?? '', score: r.score, re: r.re.source, fits: r.re.test(path) }));
  const resolved = matcher.resolve(path);
  return {
    rows,
    winner: rows.findIndex((r) => r.fits),
    params: resolved?.params ?? {},
    matched: resolved?.matched.map((r) => r.path) ?? [],
  };
}

export interface PatternView {
  segments: Token[][];
  compiled: Compiled;
}

export function describePattern(api: RouterApi, pattern: string): PatternView | { error: string } {
  try {
    if (!pattern.startsWith('/')) return { error: 'шаблон начинается с «/»' };
    const segments = api.tokenize(pattern);
    return { segments, compiled: api.compile(segments) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Вес одной строкой: `[[80],[60]]` → `80 · 60`, токены сегмента через запятую. */
export const scoreText = (score: number[][]) => score.map((s) => s.join(', ')).join(' · ');

// ─── Водопад ───────────────────────────────────────────────────────────────────────────────

/** Виртуальные часы: время идёт только по `run`, между таймерами доигрываются микрозадачи. */
export function createClock(flush: () => Promise<void> = microtasks) {
  let now = 0;
  let seq = 0;
  const timers: { at: number; seq: number; fn: () => void }[] = [];
  return {
    now: () => now,
    delay: (ms: number) => new Promise<void>((fn) => timers.push({ at: now + ms, seq: seq++, fn })),
    async run() {
      await flush();
      for (;;) {
        timers.sort((a, b) => a.at - b.at || a.seq - b.seq);
        const t = timers.shift();
        if (!t) break;
        now = t.at;
        t.fn();
        await flush();
      }
    },
  };
}

async function microtasks(): Promise<void> {
  for (let i = 0; i < 400; i++) await Promise.resolve();
}

export type Clock = ReturnType<typeof createClock>;

/**
 * Исполнить `SHOP_CODE`: чанки — `import()` с задержкой `chunk`, загрузчики — `meta.load`
 * с задержкой `data`; оба пишут начало и конец в журнал. `onData` зовётся, когда данные уровня
 * пришли.
 */
export function makeShop(code: string, levels: ShopLevel[], clock: Clock, ev: (what: string) => void, onData: (name: string) => void, component: (name: string) => unknown = (name) => ({ name })) {
  const level = (name: string) => levels.find((l) => l.name === name)!;
  const importer = async (path: string) => {
    const name = path.replace(/^.*\//, '').replace(/\.js$/, '');
    ev(`chunk ${name} start`);
    await clock.delay(level(name).chunk);
    ev(`chunk ${name} end`);
    return { default: component(name) };
  };
  const loader = (name: string) => async () => {
    ev(`data ${name} start`);
    await clock.delay(level(name).data);
    ev(`data ${name} end`);
    onData(name);
    return `${name} data`;
  };
  return new Function('__import', 'loadShop', 'loadCategory', 'loadProduct', `${withImport(code)}\nreturn shopRoutes;`)(
    importer,
    loader('Shop'),
    loader('Category'),
    loader('Product'),
  ) as RouteRaw[];
}

type Install = (router: unknown) => void;

export function loadStrategies(code: string): Record<Strategy, Install> {
  return new Function(`${code}\nreturn { inComponent, parallel, serial, early };`)() as Record<Strategy, Install>;
}

/** Отрезки «чанк» и «данные» по журналу событий. */
export function spansOf(events: TimelineEvent[]): Span[] {
  const spans: Span[] = [];
  for (const e of events) {
    const m = /^(chunk|data) (\w+) start$/.exec(e.what);
    if (!m) continue;
    const end = events.find((x) => x.what === `${m[1]} ${m[2]} end`);
    spans.push({ label: m[2], kind: m[1] as Span['kind'], from: e.t, to: end?.t ?? e.t });
  }
  return spans;
}

export function summarize(events: TimelineEvent[]): WaterfallRun {
  const commit = events.find((e) => e.what.startsWith('commit'))?.t ?? NaN;
  const renders = events.filter((e) => e.what.startsWith('render'));
  return { events, spans: spansOf(events), commit, ready: renders.at(-1)?.t ?? NaN };
}

/**
 * Переход `/` → `target` на учебном роутере. Экран рисуется как дерево `<RouterView>`:
 * уровень появляется, когда адрес сменился, его данные пришли и нарисован родитель.
 */
export async function runWaterfall(api: RouterApi, codes: RouterCodes, levels: ShopLevel[], strategy: Strategy, target: string): Promise<WaterfallRun> {
  const clock = createClock();
  const events: TimelineEvent[] = [];
  const ev = (what: string) => events.push({ t: clock.now(), what });
  const ready = new Set<string>();
  const drawn: string[] = [];
  let committed = false;
  const draw = () => {
    if (!committed) return;
    for (const l of levels) {
      if (drawn.includes(l.name)) continue;
      if (!ready.has(l.name)) break;
      drawn.push(l.name);
      ev(`render ${l.name}`);
    }
  };
  const shop = makeShop(codes.shop, levels, clock, ev, (name) => {
    ready.add(name);
    draw();
  });
  const router = api.createRouter(api.createMatcher([{ path: '/', component: {} }, ...shop]));
  await router.push('/');
  router.afterEach((to, _from, failure) => {
    if (failure) return;
    ev(`commit ${to.path}`);
    committed = true;
    draw();
  });
  loadStrategies(codes.loaders)[strategy](router);
  const done = router.push(target);
  await clock.run();
  await done;
  return summarize(events);
}
