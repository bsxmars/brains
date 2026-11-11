import { chromium, expect, firefox, test, webkit } from '@playwright/test';
import { probeWait } from '../../src/widgets/thread-probe/model/env';
import { FRAME_ACCESS_CODE } from '../../src/content/lessons/browser-architecture/data';

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
