import { expect, test } from '@playwright/test';
import { HELLO_MAIN_CODE, HELLO_OUT, HELLO_WORKER_CODE } from '../../src/content/lessons/workers/data';

/**
 * «Воркеры и параллелизм», раздел «Агент и его изоляция», «Самый простой воркер».
 *
 * Страница и `worker.js` отдаются ровно теми строками, что напечатаны в теме, с одного
 * выдуманного источника — `new Worker('worker.js')` требует того же источника, что у страницы.
 * Консоль страницы сверяется с `HELLO_OUT`: порядок «отправил → ответ» и есть утверждение темы.
 */
test('самый простой воркер: «отправил» раньше ответа, ответ — 55', async ({ page }) => {
  const origin = 'http://workers-hello.test';
  await page.route(`${origin}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/worker.js') {
      return route.fulfill({ contentType: 'text/javascript', body: HELLO_WORKER_CODE });
    }
    return route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><meta charset="utf-8"><script>${HELLO_MAIN_CODE}</script>`,
    });
  });

  const logged: string[] = [];
  page.on('console', (m) => logged.push(m.text()));
  page.on('pageerror', (e) => logged.push(`pageerror: ${e.message}`));

  await page.goto(`${origin}/`);
  await expect.poll(() => logged.length).toBeGreaterThanOrEqual(2);

  expect(logged).toEqual(HELLO_OUT.split('\n'));
});
