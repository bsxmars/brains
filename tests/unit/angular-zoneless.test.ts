import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as ng from '@angular/core';
import { build, transform, type Plugin } from 'esbuild';
import { type Browser, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as t from '@/content/frameworks/angular-zoneless/data';
import { loadMini, runScenario } from '@/widgets/zone-lab/model/run';
import type { ConfigKey, ScenarioId, StandRun } from '@/widgets/zone-lab/model/types';

/**
 * Тема «Angular без zone.js».
 *
 * Здесь пересобирается весь стенд из шапки `data.ts`:
 *   — `ANGULAR_APP_CODE` с `BOOT_ZONE_CODE` / `BOOT_ZONELESS_CODE` собирается esbuild'ом (JIT,
 *     декораторы TypeScript) и запускается в Chromium на всех сценариях в четырёх
 *     конфигурациях; результат сверяется со `STAND` целиком;
 *   — мини-версия (`ZONE_CODE`, `SCHEDULER_CODE`, `TREE_CODE`) прогоняется на тех же
 *     сценариях и сверяется со `STAND`: тики, запуски шаблонов, текст на экране;
 *   — zone.js на пустой странице: что подменено (`PATCH_ROWS`, `PATCH_FACTS`), где теряется
 *     зона (`CONTEXT_CODE` родной и пониженный);
 *   — `ASYNC_LOWERED_CODE` — вывод esbuild дословно; `SIGNAL_CODE` — на `@angular/core` в Node;
 *   — места исходников Angular, на которые опирается текст, — на месте.
 *
 * Сценарии запускаются на свежей странице и параллельно: страниц около пятидесяти, по одной
 * они шли бы полминуты.
 */

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(root);
const realPlatformBrowser = require.resolve('@angular/platform-browser');
const nm = (p: string) => readFileSync(`${root}node_modules/${p}`, 'utf8');
const zoneUmd = nm('zone.js/bundles/zone.umd.js');

const STAND_MODULE = `
import { ChangeDetectionStrategy } from '@angular/core';
export const hits = (window.__hits = {});
export const effects = (window.__effects = []);
export const hit = (name) => { hits[name] = (hits[name] ?? 0) + 1; return ''; };
export const strategy = window.__CFG.onPush ? ChangeDetectionStrategy.OnPush : ChangeDetectionStrategy.Default;`;

/** Обёртка `@angular/platform-browser`: JIT-компилятор, режим, счётчик тиков, доступ к приложению. */
const SHIM_MODULE = `
import '@angular/compiler';
import { ApplicationRef, NgZone, enableProdMode, ɵZONELESS_ENABLED as ZONELESS_ENABLED } from '@angular/core';
import { bootstrapApplication as real } from ${JSON.stringify(realPlatformBrowser)};
export * from ${JSON.stringify(realPlatformBrowser)};
if (!window.__CFG.dev) enableProdMode();
export function bootstrapApplication(...args) {
  return real(...args).then((ref) => {
    const appRef = ref.injector.get(ApplicationRef);
    window.__ticks = 0;
    const orig = appRef._tick.bind(appRef);
    appRef._tick = () => { window.__ticks++; return orig(); };
    window.__ng = {
      app: appRef.components[0].instance,
      run: (fn) => ref.injector.get(NgZone).run(fn),
      zoneless: ref.injector.get(ZONELESS_ENABLED),
      ngZone: ref.injector.get(NgZone).constructor.name,
    };
    window.__ready = true;
    return ref;
  }, (e) => { window.__errors.push(String(e.message ?? e).split('\\n')[0]); window.__ready = true; });
}`;

function standPlugin(app: string): Plugin {
  return {
    name: 'stand',
    setup(b) {
      b.onResolve({ filter: /^@angular\/platform-browser$/ }, (a) => (a.importer === 'shim' ? undefined : { path: 'shim', namespace: 'stand' }));
      b.onResolve({ filter: /^\.\/(stand|app)$/ }, (a) => ({ path: a.path.slice(2), namespace: 'stand' }));
      b.onLoad({ filter: /.*/, namespace: 'stand' }, (a) => ({
        contents: a.path === 'shim' ? SHIM_MODULE : a.path === 'stand' ? STAND_MODULE : app,
        loader: a.path === 'app' ? 'ts' : 'js',
        resolveDir: root,
      }));
    },
  };
}

async function bundle(boot: string, { lower = false, app = t.ANGULAR_APP_CODE } = {}): Promise<string> {
  const r = await build({
    stdin: { contents: boot, loader: 'ts', resolveDir: root },
    bundle: true,
    write: false,
    format: 'iife',
    target: 'es2022',
    plugins: [standPlugin(app)],
    tsconfigRaw: { compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false } },
    supported: lower ? { 'async-await': false } : {},
    logLevel: 'silent',
  });
  return r.outputFiles![0].text;
}

const CONFIGS: { key: ConfigKey; zone: boolean; onPush: boolean }[] = [
  { key: 'zone', zone: true, onPush: false },
  { key: 'zone/onpush', zone: true, onPush: true },
  { key: 'zoneless', zone: false, onPush: false },
  { key: 'zoneless/onpush', zone: false, onPush: true },
];
const IDS = t.SCENARIOS.map((s) => s.id);

const RESET = 'window.__ticks = 0; window.__effects.length = 0; for (const k in window.__hits) window.__hits[k] = 0;';
const settle = (p: Page) =>
  p.evaluate(() => new Promise<void>((r) => setTimeout(() => requestAnimationFrame(() => setTimeout(r, 30)), 30)));
const inRun = (body: string) => (p: Page) =>
  p.evaluate(`window.__ng.run(() => { const app = window.__ng.app; ${body} }); ${RESET}`);
const clickOn = (sel: string) => async (p: Page) => {
  const box = (await p.locator(sel).boundingBox())!;
  await p.mouse.move(box.x + 2, box.y + 2);
  await settle(p);
  await p.evaluate(RESET);
  await p.mouse.down();
  await p.mouse.up();
};

/** Действия стенда. `awaitFieldLowered` — тот же клик, что `awaitField`, на пониженном бандле. */
const ACTIONS: Record<ScenarioId, (p: Page) => Promise<unknown>> = {
  click: clickOn('#inc'),
  timerNoop: inRun('setTimeout(() => {}, 0);'),
  timerField: inRun("setTimeout(() => { app.clock.label = 'новое'; }, 0);"),
  threeSignals: inRun('setTimeout(() => { app.counter.count.set(1); app.counter.count.set(2); app.list.items.set([1]); }, 0);'),
  microtask: inRun('Promise.resolve().then(() => {});'),
  mousemove: async (p) => {
    await p.mouse.move(0, 300);
    await settle(p);
    await p.evaluate(RESET);
    for (let i = 1; i <= 10; i++) await p.mouse.move(i * 5, 300);
  },
  markForCheck: inRun("setTimeout(() => { const c = app.clock; c.label = 'отмечено'; c.cdr.markForCheck(); }, 0);"),
  awaitField: clickOn('#load'),
  awaitFieldLowered: clickOn('#load'),
  awaitSignal: clickOn('#load2'),
};

let browser: Browser;

async function openApp(code: string, cfg: { onPush?: boolean; dev?: boolean }) {
  const page = await browser.newPage();
  const logs: string[] = [];
  page.on('console', (m) => logs.push(m.text().split('\n')[0]));
  await page.setContent('<app-root></app-root>');
  await page.evaluate((c) => {
    (window as unknown as { __CFG: unknown; __errors: string[] }).__CFG = c;
    (window as unknown as { __errors: string[] }).__errors = [];
  }, cfg);
  await page.addScriptTag({ content: code });
  await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready);
  await settle(page);
  return { page, logs };
}

async function measure(code: string, onPush: boolean, act: (p: Page) => Promise<unknown>): Promise<StandRun> {
  const { page } = await openApp(code, { onPush });
  await act(page);
  await settle(page);
  const r = await page.evaluate(() => {
    const w = window as unknown as { __ticks: number; __hits: Record<string, number>; __effects: number[] };
    const text = (s: string) => document.querySelector(s)!.textContent!;
    return {
      ticks: w.__ticks,
      hits: { App: 0, Counter: 0, Clock: 0, List: 0, ...w.__hits },
      label: text('#label'),
      status: text('#status'),
      count: text('app-counter').replace('+', ''),
      effects: [...w.__effects],
    };
  });
  await page.close();
  return r as StandRun;
}

const bundles: Record<string, string> = {};
const real = {} as Record<ConfigKey, Record<ScenarioId, StandRun>>;
const info: Record<string, { zoneless: boolean; ngZone: string }> = {};

beforeAll(async () => {
  browser = await chromium.launch();
  const [zone, zoneless, zoneLowered, zonelessLowered] = await Promise.all([
    bundle(t.BOOT_ZONE_CODE),
    bundle(t.BOOT_ZONELESS_CODE),
    bundle(t.BOOT_ZONE_CODE, { lower: true }),
    bundle(t.BOOT_ZONELESS_CODE, { lower: true }),
  ]);
  Object.assign(bundles, { zone, zoneless, zoneLowered, zonelessLowered });

  const jobs: Promise<void>[] = [];
  for (const c of CONFIGS) {
    real[c.key] = {} as Record<ScenarioId, StandRun>;
    for (const id of IDS) {
      const base = c.zone ? 'zone' : 'zoneless';
      const code = id === 'awaitFieldLowered' ? bundles[`${base}Lowered`] : bundles[base];
      jobs.push(measure(code, c.onPush, ACTIONS[id]).then((r) => void (real[c.key][id] = r)));
    }
  }
  for (const [k, code] of [['zone', zone], ['zoneless', zoneless]] as const) {
    jobs.push(
      openApp(code, {}).then(async ({ page }) => {
        info[k] = await page.evaluate(() => (window as unknown as { __ng: { zoneless: boolean; ngZone: string } }).__ng);
        info[k] = { zoneless: info[k].zoneless, ngZone: info[k].ngZone };
        await page.close();
      }),
    );
  }
  await Promise.all(jobs);
}, 180_000);

afterAll(async () => {
  await browser?.close();
});

describe('настоящий Angular 21.2: STAND совпадает с запуском', () => {
  it('режимы включились те, что заявлены', () => {
    expect(info.zone).toEqual({ zoneless: false, ngZone: '_NgZone' });
    expect(info.zoneless).toEqual({ zoneless: true, ngZone: 'NoopNgZone' });
  });

  it.each(CONFIGS.map((c) => c.key))('%s — все сценарии', (key) => {
    expect(real[key]).toEqual(t.STAND[key]);
  });

  it('esbuild с отключённым async-await действительно переписал async приложения', () => {
    expect(bundles.zone).toMatch(/async load\(\)/);
    expect(bundles.zoneLowered).not.toMatch(/async load\(\)/);
    expect(bundles.zoneLowered).toMatch(/load\(\) \{\s*return __async\(this, null, function\* \(\) \{/);
  });
});

describe('мини-версия совпадает с Angular на тех же сценариях', () => {
  const mini = loadMini(t.ZONE_CODE, t.SCHEDULER_CODE, t.TREE_CODE);

  for (const c of CONFIGS) {
    it.each(IDS)(`${c.key} — %s`, (id) => {
      const r = runScenario(mini, id, c.zone ? 'zone' : 'zoneless', c.onPush);
      const { ticks, hits, label, status, count } = t.STAND[c.key][id];
      expect({ ticks: r.ticks, hits: r.hits, label: r.label, status: r.status, count: r.count }).toEqual({ ticks, hits, label, status, count });
    });
  }

  it('в мини-зоне таймер с then внутри — одна проверка, а не две', () => {
    // ZONE_STEPS: «Таймер, внутри которого then, даёт одну проверку».
    const ticks: number[] = [];
    const zone = mini.createZone(() => ticks.push(1));
    const queue: (() => void)[] = [];
    const micro: (() => void)[] = [];
    const api = {
      setTimeout: (fn: () => void) => void queue.push(fn),
      queueMicrotask: (fn: () => void) => void micro.push(fn),
      addEventListener: () => {},
    };
    zone.patch(api);
    zone.run(() => api.setTimeout(() => api.queueMicrotask(() => {})));
    ticks.length = 0;
    while (queue.length) {
      queue.shift()!();
      while (micro.length) micro.shift()!();
    }
    expect(ticks).toHaveLength(1);
    expect(zone.stats.tasks).toBe(2);
  });
});

describe('режим разработки', () => {
  /** Приложение для NG0100: ребёнок в ngAfterViewInit пишет в уже нарисованное поле родителя. */
  const EXPR_APP = `
import { Component, inject } from '@angular/core';
@Component({ selector: 'app-child', template: 'ребёнок' })
export class Child { parent = inject(App); ngAfterViewInit() { this.parent.title = 'после'; } }
@Component({ selector: 'app-root', imports: [Child], template: '<b>{{ title }}</b><app-child />' })
export class App { title = 'до'; }`;
  const withHandler = (boot: string) =>
    boot.replace('providers: [', "providers: [{ provide: ErrorHandler, useValue: { handleError: (e) => window.__errors.push(String(e.message).split('\\n')[0]) } }, ").replace(
      "import { bootstrapApplication }",
      "import { ErrorHandler } from '@angular/core';\nimport { bootstrapApplication }",
    );

  it.each([
    ['zone', t.BOOT_ZONE_CODE],
    ['zoneless', t.BOOT_ZONELESS_CODE],
  ])('NG0100 падает в режиме %s', async (_, boot) => {
    const code = await bundle(withHandler(boot), { app: EXPR_APP });
    const { page } = await openApp(code, { dev: true });
    const errors = await page.evaluate(() => (window as unknown as { __errors: string[] }).__errors);
    await page.close();
    expect(errors.join('\n')).toMatch(/^NG0100: ExpressionChangedAfterItHasBeenCheckedError: .*Previous value: 'до'\. Current value: 'после'\./);
    expect(t.DEV_FACTS[1].d).toContain("Previous value: 'до'. Current value: 'после'");
  }, 30_000);

  it('без enableProdMode шаблоны при клике выполняются дважды за тик', async () => {
    const { page } = await openApp(bundles.zone, { dev: true });
    await ACTIONS.click(page);
    await settle(page);
    const r = await page.evaluate(() => ({
      ticks: (window as unknown as { __ticks: number }).__ticks,
      hits: (window as unknown as { __hits: Record<string, number> }).__hits,
    }));
    await page.close();
    expect(r).toEqual({ ticks: 1, hits: { App: 2, Counter: 2, Clock: 2, List: 2 } });
  }, 30_000);

  it('без провайдера — без зоны, даже с zone.js на странице; zoneless при zone.js предупреждает NG0914', async () => {
    const plain = await bundle(t.BOOT_ZONE_CODE.replace('[provideZoneChangeDetection()]', '[]'));
    const { page } = await openApp(plain, {});
    const r = await page.evaluate(() => {
      const n = (window as unknown as { __ng: { zoneless: boolean; ngZone: string } }).__ng;
      return { zoneless: n.zoneless, ngZone: n.ngZone, zoneLoaded: typeof (window as unknown as { Zone?: unknown }).Zone };
    });
    await page.close();
    expect(r).toEqual({ zoneless: true, ngZone: 'NoopNgZone', zoneLoaded: 'function' });

    const both = await bundle(`import 'zone.js';\n${t.BOOT_ZONELESS_CODE}`);
    const opened = await openApp(both, { dev: true });
    await opened.page.close();
    expect(opened.logs.some((l) => l.startsWith('NG0914'))).toBe(true);
  }, 30_000);
});

describe('zone.js 0.16.3 на пустой странице Chromium', () => {
  let page: Page;
  beforeAll(async () => {
    page = await browser.newPage();
    await page.goto('about:blank');
    await page.addScriptTag({
      content: `window.исходныйSetTimeout = setTimeout; window.исходныйToString = Function.prototype.toString;
        window.__orig = { promise: Promise, ael: EventTarget.prototype.addEventListener, xhr: XMLHttpRequest.prototype.send,
          ws: WebSocket.prototype.send, ro: ResizeObserver.prototype.observe, ric: requestIdleCallback,
          post: scheduler.postTask, fetch: fetch, qm: queueMicrotask, raf: requestAnimationFrame,
          mo: MutationObserver, io: IntersectionObserver, fr: FileReader };`,
    });
    await page.addScriptTag({ content: zoneUmd });
  });
  afterAll(() => page?.close());

  it('что подменено и что нет — как в PATCH_ROWS', async () => {
    const r = await page.evaluate(() => {
      const o = (window as unknown as { __orig: Record<string, unknown> }).__orig;
      return {
        promise: Promise !== o.promise,
        ael: EventTarget.prototype.addEventListener !== o.ael,
        xhr: XMLHttpRequest.prototype.send !== o.xhr,
        fetch: fetch !== o.fetch,
        qm: queueMicrotask !== o.qm,
        raf: requestAnimationFrame !== o.raf,
        observers: MutationObserver !== o.mo && IntersectionObserver !== o.io && FileReader !== o.fr,
        toString: Function.prototype.toString !== (window as unknown as { исходныйToString: unknown }).исходныйToString,
        ws: WebSocket.prototype.send !== o.ws,
        ro: ResizeObserver.prototype.observe !== o.ro,
        ric: requestIdleCallback !== o.ric,
        post: (globalThis as unknown as { scheduler: { postTask: unknown } }).scheduler.postTask !== o.post,
        symbols: Object.getOwnPropertyNames(window).filter((k) => k.startsWith('__zone_symbol__')).length,
        onProps: Object.getOwnPropertyNames(window).filter((k) => /^__zone_symbol__onon\w+patched$/.test(k)).length,
      };
    });
    expect(r).toEqual({
      promise: true, ael: true, xhr: true, fetch: true, qm: true, raf: true, observers: true, toString: true,
      ws: false, ro: false, ric: false, post: false, symbols: 139, onProps: 121,
    });
    expect(t.PATCH_NOTE).toContain('на `window` после загрузки — 139');
    expect(t.PATCH_ROWS.find((row) => row.what.startsWith('свойства'))!.how).toContain('121');
  });

  it.each(t.PATCH_FACTS)('$expr', async ({ expr, result }) => {
    const value = await page.evaluate(expr);
    const shown = String(value).replace(/\s+/g, ' ');
    expect(result.startsWith(`\`${shown}\``), `${expr} → ${shown}`).toBe(true);
  });

  it('CONTEXT_CODE: родной await теряет зону, пониженный — нет', async () => {
    const lowered = (await transform(t.CONTEXT_CODE, { supported: { 'async-await': false }, charset: 'utf8' })).code;
    const runCtx = async (code: string) => {
      await page.evaluate(`(() => { ${code}\n window.__seen = seen; })()`);
      await page.waitForTimeout(50);
      return page.evaluate(() => (window as unknown as { __seen: Record<string, string> }).__seen);
    };
    const nat = await runCtx(t.CONTEXT_CODE);
    const low = await runCtx(lowered);
    const cell = (s: string) => s.match(/^`([^`]+)`/)![1];
    for (const row of t.CONTEXT_ROWS) {
      const key = cell(row.k);
      expect(nat[key], `${key} родной`).toBe(cell(row.native));
      expect(low[key], `${key} понижено`).toBe(cell(row.lowered));
    }
  });

  it('await промиса, созданного в зоне, тоже теряет её; async возвращает родной промис', async () => {
    const r = await page.evaluate(async () => {
      const Z = (window as unknown as { Zone: { current: { fork(s: object): { run(f: () => void): void }; name: string } } }).Zone;
      const seen: Record<string, string> = {};
      let isZoneAware = true;
      await new Promise<void>((done) => {
        Z.current.fork({ name: 'моя' }).run(() => {
          const p = new Promise((r) => setTimeout(r, 5));
          void (async () => {
            await p;
            seen.afterAwait = Z.current.name;
            done();
          })();
          isZoneAware = (async () => {})() instanceof Promise;
        });
      });
      return { ...seen, isZoneAware };
    });
    expect(r).toEqual({ afterAwait: '<root>', isZoneAware: false });
    expect(t.AWAIT_NOTE).toContain('`async`-функция возвращает родной промис');
  });
});

describe('понижение async: вывод esbuild дословно', () => {
  it('ASYNC_LOWERED_CODE', async () => {
    const r = await transform(t.ASYNC_SOURCE_CODE, { supported: { 'async-await': false }, charset: 'utf8' });
    expect(r.code).toBe(t.ASYNC_LOWERED_CODE);
  });
});

describe('SIGNAL_CODE на @angular/core 21.2 в Node', () => {
  it('значения в комментариях — то, что возвращает Angular', () => {
    const body = t.SIGNAL_CODE.split('\n').filter((l) => !l.startsWith('import '));
    const checks: string[] = [];
    const lines = body.map((line) => {
      const m = /^(.+?;)\s+\/\/ (\d[\d, ]*)/.exec(line);
      if (!m) return line;
      const exprs = m[1].split(';').map((s) => s.trim()).filter(Boolean);
      checks.push(m[2].trim());
      return `__out.push([${exprs.join(', ')}].join(', '));`;
    });
    const out: string[] = [];
    new Function('signal', 'computed', '__out', lines.join('\n'))(ng.signal, ng.computed, out);
    expect(out).toEqual(checks);
    expect(checks).toEqual(['0', '6, 6', '1', '6', '6', '10', '2']);
  });

  it('у сигнала Angular нет .value: это функция с set, update, asReadonly', () => {
    const s = ng.signal(1);
    expect(typeof s).toBe('function');
    expect(Object.keys(s).sort()).toEqual(['asReadonly', 'set', 'toString', 'update']);
  });
});

describe('места исходников, на которые опирается текст', () => {
  const core = (f: string) => nm(`@angular/core/fesm2022/${f}`);
  const debug = core('_debug_node-chunk.mjs');
  const effect2 = core('_effect-chunk2.mjs');
  const coreMain = core('core.mjs');

  it('с зоной: тик по onMicrotaskEmpty, стабильность — без вложенности и микрозадач', () => {
    expect(coreMain).toMatch(/this\.zone\.onMicrotaskEmpty\.subscribe\(\{\s*next: \(\) => \{[\s\S]{0,300}this\.applicationRef\._tick\(\);/);
    expect(effect2).toContain('if (zone._nesting == 0 && !zone.hasPendingMicrotasks && !zone.isStable)');
  });

  it('без зоны: по умолчанию включено, тик — гонкой setTimeout и requestAnimationFrame', () => {
    expect(effect2).toMatch(/const ZONELESS_ENABLED = new InjectionToken\([^)]*\{\s*factory: \(\) => true\s*\}\);/);
    expect(effect2).toMatch(/function scheduleCallbackWithRafRace\(callback\) \{[\s\S]{0,600}timeoutId = setTimeout\([\s\S]{0,200}animationFrameId = requestAnimationFrame\(/);
    expect(debug).toContain('const scheduleCallback = this.useMicrotaskScheduler ? scheduleCallbackWithMicrotask : scheduleCallbackWithRafRace;');
    expect(debug).toContain("`The application is using zoneless change detection, but is still loading Zone.js. `");
  });

  it('markViewDirty помечает вид и всех предков; точечный режим уважает только RefreshView', () => {
    expect(debug).toMatch(/function markViewDirty\(lView, source\) \{[\s\S]{0,300}while \(lView\) \{\s*lView\[FLAGS\] \|= dirtyBitsToUse;/);
    expect(debug).toContain('let shouldRefreshView = !!(mode === 0 && flags & 16);');
    expect(debug).toContain('shouldRefreshView ||= !!(flags & 64 && mode === 0 && !isInCheckNoChangesPass);');
    expect(debug).toContain('const mode = useGlobalCheck && !this.zonelessEnabled ? 0 : 1;');
  });

  it('AsyncPipe зовёт markForCheck', () => {
    const src = nm('@angular/common/fesm2022/_common_module-chunk.mjs');
    expect(src).toMatch(/_updateLatestValue\(async, value\) \{[\s\S]{0,200}this\._ref\?\.markForCheck\(\);/);
  });

  it('SetInput — источник уведомления в списке Angular', () => {
    const dts = nm('@angular/core/types/_discovery-chunk.d.ts');
    expect(dts).toMatch(/declare const enum NotificationSource \{[\s\S]*SetInput = 1,[\s\S]*MarkForCheck = 4,\s*Listener = 5,/);
  });
});

describe('числа в прозе взяты из STAND', () => {
  const S = t.STAND;

  it('OnPush не уменьшает число тиков, а пустой слушатель стоит тика', () => {
    expect(S['zone/onpush'].mousemove.ticks).toBe(10);
    expect(S.zone.mousemove.ticks).toBe(10);
    expect(S.zoneless.mousemove.ticks).toBe(0);
    expect(t.ONPUSH_NOTE).toContain('десять движений мыши — по-прежнему десять тиков');
    expect([S['zone/onpush'].timerField.label, S.zone.timerField.label]).toEqual(['старое', 'новое']);
  });

  it('точечная проверка: три сигнала — Counter и List, клик — все четыре', () => {
    expect(S.zoneless.threeSignals).toMatchObject({ ticks: 1, hits: { App: 0, Counter: 1, Clock: 0, List: 1 } });
    expect(S.zoneless.click.hits).toEqual({ App: 1, Counter: 1, Clock: 1, List: 1 });
    expect(t.TARGETED_NOTE).toContain('один тик, а шаблонов два — Counter и List');
  });

  it('родной await с зоной: два тика и «старое»; понижение — «загружено»; сигнал — три тика', () => {
    expect(S.zone.awaitField).toMatchObject({ ticks: 2, label: 'старое' });
    expect(S.zone.awaitFieldLowered).toMatchObject({ ticks: 2, label: 'загружено' });
    expect(S.zone.awaitSignal).toMatchObject({ ticks: 3, status: 'загружено' });
    expect(S['zone/onpush'].awaitFieldLowered.label).toBe('старое');
    expect(t.AWAIT_ANGULAR_NOTE).toContain('**два тика, а на экране «старое»**');
    expect(t.HYBRID_NOTE).toContain('три тика и «загружено» на экране, а клик по «поле» — два тика и «старое»');
  });

  it('effect: три записи — один запуск с последним значением, в обоих режимах', () => {
    expect(S.zone.threeSignals.effects).toEqual([2]);
    expect(S.zoneless.threeSignals.effects).toEqual([2]);
    expect(t.EFFECT_NOTE).toContain('дали массив `[2]`');
  });

  it('таблица цены собрана из STAND', () => {
    expect(t.COST_ROWS.map((r) => r.slice(1))).toEqual([
      ['1 · 4', '1 · 0', '0 · 0'],
      ['10 · 40', '10 · 0', '0 · 0'],
      ['1 · 4', '1 · 2', '1 · 2'],
      ['1 · 4', '1 · 0', '0 · 0'],
      ['1 · 4', '1 · 2', '1 · 4'],
    ]);
  });
});
