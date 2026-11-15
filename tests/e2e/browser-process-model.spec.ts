import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium, expect, firefox, test, webkit } from '@playwright/test';
import { probeWait } from '../../src/widgets/thread-probe/model/env';
import { FRAME_ACCESS_CODE, NAVIGATION_PROBE_HTML, NAVIGATION_OUTCOMES } from '../../src/content/lessons/browser-architecture/data';

/** Self-contained fixtures: native SOP/cookies, no lesson server or PID prediction. */
for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
  test(`${name}: напечатанный пример различает same-site и same-origin`, async () => {
    const browser = await engine.launch();
    try {
      const context = await browser.newContext();
      await context.route('https://**/*', route => route.fulfill({
        contentType: 'text/html', body: '<!doctype html><body>document</body>',
      }));
      const page = await context.newPage();
      await page.goto('https://app.shop.com/');
      const rows = await page.evaluate(async code => {
        const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
        return await new AsyncFunction(`${code}\nreturn probes;`)();
      }, FRAME_ACCESS_CODE);
      expect(rows).toEqual([
        { url: 'https://app.shop.com/', canReadDOM: true },
        { url: 'https://cdn.shop.com/widget', canReadDOM: false },
        { url: 'https://api.shop.com:8443/status', canReadDOM: false },
      ]);
      expect(await page.locator('iframe').count()).toBe(0);
    } finally {
      await browser.close();
    }
  });

  test(`${name}: wait проверяется на общей памяти, а не на неподходящем ArrayBuffer`, async () => {
    const browser = await engine.launch();
    try {
      const context = await browser.newContext();
      await context.route('https://app.shop.com/**', route => route.fulfill({
        contentType: 'text/html', body: '<!doctype html><body>document</body>',
        headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' },
      }));
      const page = await context.newPage();
      await page.goto('https://app.shop.com/');
      expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
      const result = await page.evaluate(async source => {
        const main = new Function(`return (${source})();`)();
        const url = URL.createObjectURL(new Blob([`postMessage((${source})())`], { type: 'text/javascript' }));
        const worker = new Worker(url);
        try {
          const allowed = await new Promise<{ value: string }>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('worker probe timeout')), 5000);
            worker.onmessage = event => { clearTimeout(timer); resolve(event.data); };
            worker.onerror = event => { clearTimeout(timer); reject(new Error(event.message)); };
          });
          return { main, allowed };
        } finally {
          worker.terminate();
          URL.revokeObjectURL(url);
        }
      }, probeWait.toString());
      expect(result.main.value, result.main.note).toBe('TypeError');
      expect(result.main.tone).toBe('ok');
      // Positive control: the SAME source must accept this buffer in a worker.
      // An ordinary ArrayBuffer would throw TypeError here too and fail this assertion.
      expect(result.allowed.value).toBe("вернул 'not-equal'");
    } finally {
      await browser.close();
    }
  });

  test(`${name}: рендерер видит доступные cookie, но не HttpOnly`, async () => {
    const browser = await engine.launch();
    try {
      const context = await browser.newContext();
      await context.addCookies([
        { name: 'visible', value: 'yes', domain: 'app.shop.com', path: '/', secure: true },
        { name: 'session', value: 'secret', domain: 'app.shop.com', path: '/', secure: true, httpOnly: true },
      ]);
      await context.route('https://app.shop.com/**', async route => {
        await route.fulfill({ contentType: 'text/html', body: '<!doctype html><body>document</body>' });
      });
      const page = await context.newPage();
      await page.goto('https://app.shop.com/');
      const visible = await page.evaluate(() => document.cookie);
      expect(visible).toContain('visible=yes');
      expect(visible).not.toContain('session=');
      const jar = await context.cookies('https://app.shop.com/');
      expect(jar.find(cookie => cookie.name === 'session')).toMatchObject({ value: 'secret', httpOnly: true });
      expect(jar.find(cookie => cookie.name === 'visible')).toMatchObject({ value: 'yes', httpOnly: false });
    } finally {
      await browser.close();
    }
  });
}


/** Только локальный HTTP: redirect намеренно реальный, Playwright route не вызывается
 * повторно для продолжения перенаправленной навигации во всех движках. */
async function listenNavigationServer(server: Server): Promise<string> {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** Навигация проверяется по жизни Document, а не по внутренним PID или миллисекундам. */
for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
  test(`${name}: навигация держит прежний Document до ответа, redirect принимает итоговый документ`, async () => {
    const browser = await engine.launch();
    let release = () => {};
    let sourceServer: Server | undefined;
    let finalServer: Server | undefined;
    try {
      const context = await browser.newContext();
      let arrived = () => {};
      const requested = new Promise<void>((resolve) => { arrived = resolve; });
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const urls: string[] = [];
      finalServer = createServer((request, response) => {
        if (request.url === '/final') {
          urls.push(destination);
          response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          response.end('<!doctype html><h1 id="destination">Новый документ</h1>');
        } else {
          response.writeHead(204);
          response.end();
        }
      });
      const destination = (await listenNavigationServer(finalServer)) + '/final';
      sourceServer = createServer(async (request, response) => {
        if (request.url === '/') {
          response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          response.end(NAVIGATION_PROBE_HTML);
        } else if (request.url === '/start') {
          urls.push(source + 'start');
          arrived();
          await gate;
          response.writeHead(302, { Location: destination });
          response.end();
        } else {
          response.writeHead(204);
          response.end();
        }
      });
      const source = (await listenNavigationServer(sourceServer)) + '/';
      const page = await context.newPage();
      await page.goto(source);
      const token = await page.evaluate(() => (window as unknown as { navigationProbe: { token: string } }).navigationProbe.token);
      const go = (await page.locator('#go').boundingBox())!;
      const count = (await page.locator('#count').boundingBox())!;
      // Locator/Frame.evaluate ждёт навигацию; raw mouse и заранее установленный обработчик
      // проверяют сам Document, не попадая в navigation auto-wait Playwright.
      await page.mouse.click(go.x + go.width / 2, go.y + go.height / 2);
      await requested;
      const clicked = page.waitForEvent('console', { predicate: (message) => message.text().startsWith('navigation-probe:') });
      await page.mouse.click(count.x + count.width / 2, count.y + count.height / 2);
      expect(JSON.parse((await clicked).text().slice('navigation-probe:'.length)))
        .toEqual({ token, clicks: 1 });
      expect(page.url()).toBe(source);
      const committed = page.waitForURL(destination, { waitUntil: 'commit' });
      release();
      await committed;
      await expect(page.locator('#destination')).toHaveText('Новый документ');
      expect(await page.evaluate(() => 'navigationProbe' in window)).toBe(false);
      expect(urls).toEqual([source + 'start', destination]);
      expect(NAVIGATION_OUTCOMES[0].means).toContain('не заменили активный Document');
      expect(NAVIGATION_OUTCOMES[1].means).toContain('не показывает PID');
    } finally {
      release();
      await browser.close();
      for (const server of [sourceServer, finalServer]) {
        if (!server) continue;
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      }
    }
  });

  test(`${name}: ответ 204 сохраняет текущий Document и его обработчик`, async () => {
    const browser = await engine.launch();
    let server: Server | undefined;
    try {
      let emptyRequests = 0;
      server = createServer((request, response) => {
        if (request.url === '/') {
          response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          response.end(NAVIGATION_PROBE_HTML);
        } else {
          if (request.url === '/empty') emptyRequests++;
          response.writeHead(204);
          response.end();
        }
      });
      const source = (await listenNavigationServer(server)) + '/';
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(source);
      const token = await page.evaluate(() => (window as unknown as { navigationProbe: { token: string } }).navigationProbe.token);
      const count = (await page.locator('#count').boundingBox())!;
      // 204 не создаёт Document. Некоторые движки сообщают Playwright об отмене навигации;
      // нормализуем только её, не сетевую ошибку произвольного вида.
      try {
        await page.goto(source + 'empty');
      } catch (error) {
        expect(String(error)).toMatch(/aborted|ERR_ABORTED|cancelled|NS_BINDING_ABORTED|interrupted|204/i);
      }
      expect(emptyRequests).toBe(1);
      const clicked = page.waitForEvent('console', { predicate: (message) => message.text().startsWith('navigation-probe:') });
      await page.mouse.click(count.x + count.width / 2, count.y + count.height / 2);
      expect(JSON.parse((await clicked).text().slice('navigation-probe:'.length)))
        .toEqual({ token, clicks: 1 });
      expect(page.url()).toBe(source);
      expect(NAVIGATION_OUTCOMES[2].means).toContain('без замены документа');
    } finally {
      await browser.close();
      if (server) {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
      }
    }
  });
}
