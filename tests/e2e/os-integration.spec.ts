import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium, expect, firefox, test, webkit, type Browser, type BrowserContext } from '@playwright/test';
import {
  ACTIVATION_CODE,
  ACTIVATION_OUT,
  BADGE_CODE,
  BADGE_OUT,
  CONSUME_CODE,
  CONSUME_OUT,
  DETECT_CODE,
  GESTURE_ROWS,
  IFRAME_ROWS,
  PAY_CODE,
  PAY_OUT,
  SHARE_CODE,
  SHARE_OUT,
  SHARE_ROWS,
  SUPPORT_ROWS,
  UA_NOTE,
  VIS_CODE,
  VIS_OUT,
  WAKE_CODE,
  WAKE_OUT,
  WAKE_ROWS,
} from '../../src/content/lessons/os-integration/data';

/**
 * «Страница и система: экран, „Поделиться“, значок, оплата» — каждое утверждение запуском.
 *
 * Страница курса не нужна: код темы кладётся в страницу выдуманного источника
 * `http://localhost:5301` через `context.route` (localhost — безопасный контекст), для сравнения
 * — `http://os.test` (не безопасный). Движки запускаются прямо из теста, как в
 * `task-scheduling-engines.spec.ts`: важно сравнение, а проект `chromium` в конфиге один.
 *
 * Три особенности стенда, и все три — суть темы, а не неудобство:
 *   — **`page.evaluate` в Playwright — уже жест** (`isActive === true` внутри него). Поэтому
 *     код «без жеста» исполняется скриптом самой страницы, а жест даёт настоящий `page.click`;
 *   — **Playwright держит вкладки видимыми.** Снятие замка со скрытой вкладкой проверяется
 *     голым CDP поверх `chromium.launchServer`: к такому браузеру Playwright не подключается;
 *   — **headless shell — не полный Chromium**: в нём нет `share`, нет службы оплаты и не дают
 *     замок. Полный Chromium — `channel: 'chromium'`.
 *
 * Нужны бинари полного Chromium, Firefox и WebKit (`npx playwright install chromium firefox webkit`).
 */

const ORIGIN = 'http://localhost:5301';
const INSECURE = 'http://os.test';
const OTHER = 'http://127.0.0.1:5302';

const launchFull = () => chromium.launch({ channel: 'chromium' });
const launchShell = () => chromium.launch();

/** Страница из куска HTML; `classic` — обычный скрипт, иначе модульный (верхнеуровневый `await`). */
function page(body: string, script: string, classic = false) {
  return `<!doctype html><meta charset="utf-8">${body}<script${classic ? '' : ' type="module"'}>${script}</script>`;
}

async function serve(ctx: BrowserContext, html: string | ((path: string) => string), headers: Record<string, string> = {}) {
  await ctx.route(`${ORIGIN}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ contentType: 'text/html', headers, body: typeof html === 'string' ? html : html(path) });
  });
}

async function withBrowser<T>(launch: () => Promise<Browser>, fn: (ctx: BrowserContext) => Promise<T>): Promise<T> {
  const browser = await launch();
  try {
    return await fn(await browser.newContext());
  } finally {
    await browser.close();
  }
}

/** Консоль страницы строками — то, что печатают примеры темы. */
function collect(p: import('@playwright/test').Page) {
  const lines: string[] = [];
  // Только `console.log` примера: Chromium сам пишет в консоль предупреждения Permissions Policy.
  p.on('console', (m) => m.type() === 'log' && lines.push(m.text()));
  p.on('pageerror', (e) => lines.push(`pageerror: ${e.message}`));
  return lines;
}

const BUTTONS = '<button id="awake">a</button><button id="share">s</button><button id="pay">p</button><button id="probe">b</button>';

/** Код, который исполняется при загрузке, без жеста, и кладёт исход в `window.R`. */
const SETTLE = `window.settle = (p, t = 1500) => Promise.race([
  p.then(() => 'ok', (e) => e.name),
  new Promise((r) => setTimeout(() => r('pending'), t)),
]);`;

// ─── Раздел «Wake Lock» ────────────────────────────────────────────────────────────────────

test('Wake Lock: замок по клику и отпускание вторым кликом — WAKE_OUT', async () => {
  await withBrowser(launchFull, async (ctx) => {
    await serve(ctx, page(BUTTONS, WAKE_CODE, true));
    const p = await ctx.newPage();
    const lines = collect(p);
    await p.goto(`${ORIGIN}/`);
    await p.click('#awake');
    await expect.poll(() => lines.length).toBe(1);
    await p.click('#awake');
    await expect.poll(() => lines.length).toBe(2);
    expect(lines).toEqual(WAKE_OUT.split('\n'));
  });
});

test('Wake Lock: таблица «Когда замок не дают» — без жеста, при загрузке', async () => {
  const probe = page('', `${SETTLE}
    window.R = 'wakeLock' in navigator ? settle(navigator.wakeLock.request('screen')) : Promise.resolve('no api');`, true);
  const atLoad = async (launch: () => Promise<Browser>, origin = ORIGIN) =>
    withBrowser(launch, async (ctx) => {
      await ctx.route('**/*', (r) => r.fulfill({ contentType: 'text/html', body: probe }));
      const p = await ctx.newPage();
      await p.goto(`${origin}/`);
      return p.evaluate(() => (window as unknown as { R: Promise<string> }).R);
    });

  const row = (start: string) => {
    const r = WAKE_ROWS.find((x) => x.k.startsWith(start));
    if (!r) throw new Error(`строки «${start}…» в WAKE_ROWS нет`);
    return r.got;
  };
  expect(await atLoad(launchFull)).toBe(row('полный Chromium'));
  expect(await atLoad(() => firefox.launch())).toBe(row('полный Chromium'));
  expect(await atLoad(() => webkit.launch())).toBe(row('WebKit'));
  expect(await atLoad(launchShell)).toBe(row('headless shell'));
  expect(await atLoad(launchFull, INSECURE)).toBe(row('страница на'));

  // WebKit по клику — замок; headless shell — отказ и по клику.
  const byClick = async (launch: () => Promise<Browser>) =>
    withBrowser(launch, async (ctx) => {
      await serve(ctx, page(BUTTONS, WAKE_CODE, true));
      const p = await ctx.newPage();
      const lines = collect(p);
      await p.goto(`${ORIGIN}/`);
      await p.click('#awake');
      await expect.poll(() => lines.length).toBe(1);
      return lines[0];
    });
  expect(await byClick(() => webkit.launch())).toBe('держим: screen false');
  expect(await byClick(launchShell)).toBe('отказ: NotAllowedError');
});

test('Wake Lock: скрытая вкладка снимает замок раньше visibilitychange, возврат берёт новый — VIS_OUT', async () => {
  test.setTimeout(60_000);
  // Настоящий сервер: к браузеру ниже Playwright не подключён, `route` там не работает.
  const server = createServer((_, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(page(BUTTONS, VIS_CODE, true));
  }).listen(0);
  await new Promise((r) => server.once('listening', r));
  const port = (server.address() as AddressInfo).port;
  const debugPort = 9300 + Math.floor(Math.random() * 500);
  const browserServer = await chromium.launchServer({ channel: 'chromium', args: [`--remote-debugging-port=${debugPort}`] });
  try {
    let version: { webSocketDebuggerUrl: string } | undefined;
    for (let i = 0; i < 40 && !version; i++) {
      version = await fetch(`http://127.0.0.1:${debugPort}/json/version`).then((r) => r.json(), () => undefined);
      if (!version) await new Promise((r) => setTimeout(r, 250));
    }
    if (!version) throw new Error('порт отладки Chromium не ответил');

    const ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));
    let id = 0;
    const pending = new Map<number, (v: { result?: Record<string, unknown> }) => void>();
    const lines: string[] = [];
    ws.onmessage = (m) => {
      const d = JSON.parse(String(m.data));
      if (d.id && pending.has(d.id)) {
        pending.get(d.id)!(d);
        pending.delete(d.id);
      }
      if (d.method === 'Runtime.consoleAPICalled') {
        lines.push(d.params.args.map((a: { value?: unknown }) => String(a.value)).join(' '));
      }
    };
    const send = <T = Record<string, unknown>>(method: string, params = {}, sessionId?: string) =>
      new Promise<T>((resolve) => {
        const n = ++id;
        pending.set(n, (v) => resolve(v.result as T));
        ws.send(JSON.stringify({ id: n, method, params, sessionId }));
      });

    const { targetId } = await send<{ targetId: string }>('Target.createTarget', { url: `http://localhost:${port}/` });
    const { sessionId } = await send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true });
    await send('Runtime.enable', {}, sessionId);
    await expect.poll(async () => {
      const r = await send<{ result: { value: string } }>('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true }, sessionId);
      return r.result.value;
    }).toBe('complete');

    // Клик человека: `userGesture: true` — то же, что `page.click`.
    await send('Runtime.evaluate', { expression: "document.querySelector('#awake').click()", userGesture: true }, sessionId);
    await expect.poll(() => lines.length).toBe(1);
    await send('Target.createTarget', { url: 'about:blank' });          // соседняя вкладка
    await expect.poll(() => lines.length).toBe(3);
    await send('Target.activateTarget', { targetId });                   // вернулись
    await expect.poll(() => lines.length).toBe(5);
    expect(lines).toEqual(VIS_OUT.split('\n'));
    ws.close();
  } finally {
    await browserServer.close();
    server.close();
  }
});

// ─── Раздел «Поделиться» ───────────────────────────────────────────────────────────────────

test('Web Share: первый клик открывает меню, второй — InvalidStateError (SHARE_OUT)', async () => {
  await withBrowser(launchFull, async (ctx) => {
    await serve(ctx, page(BUTTONS, SHARE_CODE));
    const p = await ctx.newPage();
    const lines = collect(p);
    await p.goto(`${ORIGIN}/`);
    await p.click('#share');
    await p.waitForTimeout(1000);
    expect(lines, 'меню открыто и ждёт выбора — печатать нечего').toEqual([]);
    await p.click('#share');
    await expect.poll(() => lines.length).toBe(1);
    expect(lines).toEqual(SHARE_OUT.split('\n').filter((l) => !l.startsWith('//')));
  });
});

test('Web Share: таблица share и canShare в Chromium и WebKit', async () => {
  const probe = page(BUTTONS, `${SETTLE}
    const share = (d) => { try { return settle(navigator.share(d)) } catch (e) { return Promise.resolve(e.name) } };
    const atLoad = share({ url: location.href });
    window.R = [
      String(navigator.canShare({ url: location.href })),
      String(navigator.canShare({ title: 't' })),
      String(navigator.canShare({})),
      String(navigator.canShare({ url: 'http://[' })),
    ];
    const byClick = [{}, { url: 'http://[' }];
    window.C = [];
    document.querySelector('#share').onclick = () => { C.push(share(byClick[C.length])) };
    window.L = atLoad;`, true);
  for (const [engine, launch] of [['chromium', launchFull], ['webkit', () => webkit.launch()]] as const) {
    const got = await withBrowser(launch, async (ctx) => {
      await serve(ctx, probe);
      const p = await ctx.newPage();
      await p.goto(`${ORIGIN}/`);
      await p.click('#share');
      await p.click('#share');
      return p.evaluate(async () => {
        const w = window as unknown as { L: Promise<string>; C: Promise<string>[]; R: string[] };
        return [await w.L, ...(await Promise.all(w.C)), ...w.R];
      });
    });
    expect(got, engine).toEqual(SHARE_ROWS.map((r) => r[engine]));
  }
});

test('тонкое место: canShare с .exe — true, share с ним по клику — NotAllowedError (Chromium)', async () => {
  await withBrowser(launchFull, async (ctx) => {
    await serve(ctx, page(BUTTONS, `${SETTLE}
      const files = [new File(['x'], 'a.exe', { type: 'application/x-msdownload' })];
      console.log(navigator.canShare({ files }));
      document.querySelector('#share').onclick = () => settle(navigator.share({ files })).then(console.log);`));
    const p = await ctx.newPage();
    const lines = collect(p);
    await p.goto(`${ORIGIN}/`);
    await expect.poll(() => lines.length).toBe(1);
    await p.click('#share');
    await expect.poll(() => lines.length).toBe(2);
    expect(lines).toEqual(['true', 'NotAllowedError']);
  });
});

// ─── Раздел «Значок» ───────────────────────────────────────────────────────────────────────

test('значок: во вкладке промисы выполняются, -1 — TypeError (BADGE_OUT); display-mode — browser', async () => {
  await withBrowser(launchShell, async (ctx) => {
    await serve(ctx, page('', `${BADGE_CODE}
      console.log(matchMedia('(display-mode: standalone)').matches, matchMedia('(display-mode: browser)').matches);`));
    const p = await ctx.newPage();
    const lines = collect(p);
    await p.goto(`${ORIGIN}/`);
    await expect.poll(() => lines.length).toBe(4);
    expect(lines.slice(0, 3)).toEqual(BADGE_OUT.split('\n'));
    expect(lines[3], 'вкладка — не установленное приложение').toBe('false true');
  });
});

// ─── Раздел «Оплата» ───────────────────────────────────────────────────────────────────────

test('оплата: без платёжных приложений — false и NotSupportedError (PAY_OUT); shell — UnknownError', async () => {
  const run = (launch: () => Promise<Browser>) =>
    withBrowser(launch, async (ctx) => {
      await ctx.route('https://pay.example/**', (r) => r.fulfill({ status: 404, body: '' }));
      await serve(ctx, page(BUTTONS, PAY_CODE));
      const p = await ctx.newPage();
      const lines = collect(p);
      await p.goto(`${ORIGIN}/`);
      await expect.poll(() => lines.length, { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
      await p.click('#pay');
      await expect.poll(() => lines.length, { timeout: 10_000 }).toBe(2);
      return lines;
    });
  expect(await run(launchFull)).toEqual(PAY_OUT.split('\n'));
  const shell = await run(launchShell);
  expect(shell[1]).toBe('оплата не началась: UnknownError');
});

test('оплата: PAY_FLOW — неверная сумма и пустой список в конструкторе, второй show()', async () => {
  await withBrowser(launchShell, async (ctx) => {
    await serve(ctx, page('', `
      const total = (value) => ({ total: { label: 'x', amount: { currency: 'RUB', value } } });
      const m = [{ supportedMethods: 'https://pay.example/' }];
      const ctor = (methods, details) => { try { new PaymentRequest(methods, details); return 'ok' } catch (e) { return e.name } };
      const r = new PaymentRequest(m, total('1.00'));
      r.show().catch(() => {});
      const second = await r.show().then(() => 'ok', (e) => e.name);
      console.log([ctor(m, total('990.00')), ctor(m, total('1,00')), ctor(m, total('-1')), ctor([], total('1')), second].join(' '));`));
    const p = await ctx.newPage();
    const lines = collect(p);
    await p.goto(`${ORIGIN}/`);
    await expect.poll(() => lines.length).toBe(1);
    expect(lines[0]).toBe('ok TypeError TypeError TypeError InvalidStateError');
  });
});

// ─── Раздел «Жест и iframe» ────────────────────────────────────────────────────────────────

for (const [engine, launch] of [
  ['chromium', launchFull],
  ['firefox', () => firefox.launch()],
  ['webkit', () => webkit.launch()],
] as const) {
  test(`жест в ${engine}: окно ~5 с, hasBeenActive не гаснет (ACTIVATION_OUT)`, async () => {
    test.setTimeout(30_000);
    await withBrowser(launch, async (ctx) => {
      await serve(ctx, page(BUTTONS, ACTIVATION_CODE));
      const p = await ctx.newPage();
      const lines = collect(p);
      await p.goto(`${ORIGIN}/`);
      await p.click('#probe');
      await expect.poll(() => lines.length, { timeout: 10_000 }).toBe(1);
      expect(lines[0]).toBe(ACTIVATION_OUT);
    });
  });

  test(`жест в ${engine}: GESTURE_ROWS — без жеста, при загрузке`, async () => {
    await withBrowser(launch, async (ctx) => {
      await serve(ctx, page('', `${SETTLE}
        const call = (name, f) => name in navigator ? settle(f()) : Promise.resolve('no api');
        window.R = (async () => [
          await call('wakeLock', () => navigator.wakeLock.request('screen')),
          await call('share', () => navigator.share({ url: location.href })),
          await call('setAppBadge', () => navigator.setAppBadge(3)),
        ])();`, true));
      const p = await ctx.newPage();
      await p.goto(`${ORIGIN}/`);
      const got = await p.evaluate(() => (window as unknown as { R: Promise<string[]> }).R);
      expect(got).toEqual(GESTURE_ROWS.map((r) => r[engine]));
    });
  });

  test(`iframe в ${engine}: IFRAME_ROWS без allow и с allow`, async () => {
    await withBrowser(launch, async (ctx) => {
      const frame = page('<button id="b">b</button>', `${SETTLE}
        window.R = (async () => ({
          wake: 'wakeLock' in navigator ? await settle(navigator.wakeLock.request('screen')) : 'no api',
          pay: 'PaymentRequest' in window ? (() => {
            try { new PaymentRequest([{ supportedMethods: 'https://pay.example/' }], { total: { label: 'x', amount: { currency: 'RUB', value: '1' } } }); return 'ok' }
            catch (e) { return e.name }
          })() : 'no api',
        }))();
        document.getElementById('b').onclick = () => {
          window.S = 'share' in navigator ? settle(navigator.share({ url: 'https://example.com' })) : Promise.resolve('no api');
        };`, true);
      await ctx.route(`${OTHER}/**`, (r) => r.fulfill({ contentType: 'text/html', body: frame }));
      const allow = IFRAME_ROWS.map((r) => r.feature).join('; ');
      await serve(ctx, `<!doctype html><iframe name="without" src="${OTHER}/f"></iframe><iframe name="with" allow="${allow}" src="${OTHER}/f"></iframe>`);
      const p = await ctx.newPage();
      await p.goto(`${ORIGIN}/`);
      for (const mode of ['without', 'with'] as const) {
        const f = p.frame({ name: mode })!;
        await f.waitForLoadState();
        const r = await f.evaluate(() => (window as unknown as { R: Promise<{ wake: string; pay: string }> }).R);
        await f.click('#b');
        const share = await f.evaluate(() => (window as unknown as { S: Promise<string> }).S);
        const byFeature: Record<string, string> = { 'screen-wake-lock': r.wake, 'web-share': share, payment: r.pay };
        for (const row of IFRAME_ROWS) expect(byFeature[row.feature], `${mode} ${row.feature}`).toBe(row[mode][engine]);
      }
    });
  });

  test(`заголовок Permissions-Policy в ${engine}: соблюдает только Chromium`, async () => {
    await withBrowser(launch, async (ctx) => {
      await serve(ctx, page(BUTTONS, `${SETTLE}
        document.querySelector('#awake').onclick = () => settle(navigator.wakeLock.request('screen')).then(console.log);`, true),
      { 'Permissions-Policy': 'screen-wake-lock=()' });
      const p = await ctx.newPage();
      const lines = collect(p);
      await p.goto(`${ORIGIN}/`);
      await p.click('#awake');
      await expect.poll(() => lines.length).toBe(1);
      expect(lines[0]).toBe(engine === 'chromium' ? 'NotAllowedError' : 'ok');
    });
  });
}

for (const [engine, launch] of [['chromium', launchFull], ['webkit', () => webkit.launch()]] as const) {
  test(`share забирает жест в ${engine} (CONSUME_OUT)`, async () => {
    await withBrowser(launch, async (ctx) => {
      await serve(ctx, page(BUTTONS, CONSUME_CODE));
      const p = await ctx.newPage();
      const lines = collect(p);
      await p.goto(`${ORIGIN}/`);
      await p.click('#share');
      await expect.poll(() => lines.length).toBe(2);
      expect(lines).toEqual(CONSUME_OUT.split('\n'));
    });
  });
}

test('тонкое место: share через 6 с после клика — NotAllowedError (Chromium)', async () => {
  test.setTimeout(30_000);
  await withBrowser(launchFull, async (ctx) => {
    await serve(ctx, page(BUTTONS, `${SETTLE}
      document.querySelector('#share').onclick = async () => {
        await new Promise((r) => setTimeout(r, 6000));
        console.log(await settle(navigator.share({ url: location.href })));
      };`));
    const p = await ctx.newPage();
    const lines = collect(p);
    await p.goto(`${ORIGIN}/`);
    await p.click('#share');
    await expect.poll(() => lines.length, { timeout: 12_000 }).toBe(1);
    expect(lines[0]).toBe('NotAllowedError');
  });
});

test('тонкое место: page.evaluate в Playwright — уже жест', async () => {
  await withBrowser(launchFull, async (ctx) => {
    await serve(ctx, page('', 'window.atLoad = navigator.userActivation.isActive;', true));
    const p = await ctx.newPage();
    await p.goto(`${ORIGIN}/`);
    expect(await p.evaluate(() => (window as unknown as { atLoad: boolean }).atLoad)).toBe(false);
    expect(await p.evaluate(() => navigator.userActivation.isActive)).toBe(true);
  });
});

// ─── Раздел «Есть ли API» ──────────────────────────────────────────────────────────────────

test('SUPPORT_ROWS: имена в четырёх сборках; на http: — ни одного', async () => {
  const probe = page('', DETECT_CODE, true);
  const builds = [
    ['full', launchFull],
    ['shell', launchShell],
    ['firefox', () => firefox.launch()],
    ['webkit', () => webkit.launch()],
  ] as const;
  for (const [build, launch] of builds) {
    await withBrowser(launch, async (ctx) => {
      await ctx.route('**/*', (r) => r.fulfill({ contentType: 'text/html', body: probe }));
      for (const origin of [ORIGIN, INSECURE]) {
        const p = await ctx.newPage();
        const lines: string[] = [];
        p.on('console', async (m) => {
          const [secure, can] = await Promise.all(m.args().map((a) => a.jsonValue()));
          lines.push(JSON.stringify({ secure, can }));
        });
        await p.goto(`${origin}/`);
        await expect.poll(() => lines.length).toBe(1);
        const { secure, can } = JSON.parse(lines[0]) as { secure: boolean; can: Record<string, boolean> };
        expect(secure, `${build} ${origin}`).toBe(origin === ORIGIN);
        for (const row of SUPPORT_ROWS) {
          expect(can[row.key], `${build} ${origin} ${row.key}`).toBe(origin === ORIGIN ? row[build] : false);
        }
        await p.close();
      }
    });
  }
});

/**
 * ⚠️ Юзер-агент — в отдельном процессе, вне раннера: раннер подставляет строку профиля
 * «Desktop Chrome» из конфига во все контексты, даже в WebKit (см. `browser-engines.spec.ts`).
 */
test('UA_NOTE: у полного Chromium и headless shell одна строка HeadlessChrome/153, WebKit — Safari', () => {
  const code = `
    import { chromium, webkit } from '@playwright/test';
    const out = {};
    for (const [name, launch] of [
      ['full', () => chromium.launch({ channel: 'chromium' })],
      ['shell', () => chromium.launch()],
      ['webkit', () => webkit.launch()],
    ]) {
      const browser = await launch();
      const p = await browser.newPage();
      await p.route('**/*', (r) => r.fulfill({ contentType: 'text/html', body: '<p>стенд</p>' }));
      await p.goto('${ORIGIN}/');   // безопасный контекст: на about:blank share нет
      out[name] = await p.evaluate(() => [navigator.userAgent, 'share' in navigator]);
      await browser.close();
    }
    console.log(JSON.stringify(out));`;
  const ua = JSON.parse(
    execFileSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', cwd: process.cwd() }),
  ) as Record<'full' | 'shell' | 'webkit', [string, boolean]>;
  const major = (s: string) => s.match(/HeadlessChrome\/(\d+)/)?.[1];
  expect(major(ua.full[0])).toBe('153');
  expect(major(ua.shell[0])).toBe('153');
  expect([ua.full[1], ua.shell[1]], 'строка одна, а navigator.share — только у полного').toEqual([true, false]);
  expect(ua.webkit[0]).toContain('Safari/');
  expect(UA_NOTE).toContain('`HeadlessChrome/153`');
});
