import { execFileSync } from 'node:child_process';
import { chromium, expect, firefox, test, webkit, type BrowserType } from '@playwright/test';
import { DEPTH_ROWS, ENGINE_SNAPSHOT, TIMER_ROWS, UA_ROWS } from '../../src/content/render/browser-engines/data';
import type { EngineKey } from '../../src/widgets/engine-probe/model/types';

/**
 * «Три движка» (`/render/browser-engines/`): снимок темы против трёх настоящих движков.
 *
 * Главная проверка — демо и снимок спрашивают движок одним кодом: страница темы открывается
 * в Chromium, Firefox и WebKit, демо (`widgets/engine-probe/model/probes.ts`) отвечает,
 * и ответ каждой строки обязан совпасть с `ENGINE_SNAPSHOT` для этого движка. Разошлось —
 * значит, движок сменил поведение или снимок устарел, и это видно здесь, а не у читателя.
 *
 * Остальное — таблицы темы, которые демо не показывает: шаг таймера с изоляцией источника
 * и без, порядок глубины рекурсии, строки `userAgent`.
 *
 * Движки запускаются прямо из теста: проект `chromium` в конфиге один. Нужны бинарники
 * Firefox и WebKit (`npx playwright install firefox webkit`).
 */
const ENGINES: [EngineKey, BrowserType][] = [
  ['chromium', chromium],
  ['firefox', firefox],
  ['webkit', webkit],
];
const COLUMN: Record<EngineKey, number> = { chromium: 1, firefox: 2, webkit: 3 };



for (const [engine, type] of ENGINES) {
  test(`демо в ${engine} отвечает так же, как снимок темы`, async ({ baseURL }) => {
    const browser = await type.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await page.goto(`${baseURL}/render/browser-engines/`);
      const island = page.locator('astro-island:has(.ep-table)');
      // Прокручивать к потомку острова: у самого `astro-island` нет бокса (см. AGENTS.md).
      await island.locator(':scope > *').first().scrollIntoViewIfNeeded();
      await page.waitForFunction(() => {
        const el = document.querySelector('astro-island:has(.ep-table)');
        return el !== null && !el.hasAttribute('ssr');
      });
      await island.getByText('все вопросы').click();
      await page.waitForFunction(
        (n) => document.querySelectorAll('tr[data-probe] [data-answer]').length >= n,
        Object.keys(ENGINE_SNAPSHOT).length,
      );
      const answers = await page.evaluate(() =>
        Object.fromEntries(
          [...document.querySelectorAll<HTMLElement>('tr[data-probe]')].map((tr) => [
            tr.dataset.probe,
            tr.querySelector('[data-answer]')?.getAttribute('data-answer'),
          ]),
        ),
      );
      const expected = Object.fromEntries(Object.entries(ENGINE_SNAPSHOT).map(([key, row]) => [key, row[engine]]));
      expect(answers).toEqual(expected);
    } finally {
      await browser.close();
    }
  });
}

/** Шаг `performance.now()` на обычной странице и на странице с изоляцией источника. */
const step = () => {
  let best = Infinity;
  let last = performance.now();
  for (let i = 0, seen = 0; i < 300_000 && seen < 30; i++) {
    const now = performance.now();
    if (now !== last) {
      best = Math.min(best, now - last);
      last = now;
      seen++;
    }
  }
  return best;
};
const asText = (ms: number) => `${Number(ms.toFixed(3))} мс`;

for (const [engine, type] of ENGINES) {
  test(`таймер в ${engine} — как в таблице темы`, async () => {
    const browser = await type.launch();
    try {
      const measured: string[] = [];
      for (const isolated of [false, true]) {
        const context = await browser.newContext();
        const page = await context.newPage();
        const headers: Record<string, string> = isolated
          ? { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' }
          : {};
        await page.route('https://stand.test/**', (route) =>
          route.fulfill({ contentType: 'text/html', body: '<!doctype html><p>стенд</p>', headers }),
        );
        await page.goto('https://stand.test/');
        expect(await page.evaluate(() => crossOriginIsolated)).toBe(isolated);
        measured.push(asText(await page.evaluate(step)));
        await context.close();
      }
      expect(measured).toEqual(TIMER_ROWS.rows.map((row) => row[COLUMN[engine]]));

    } finally {
      await browser.close();
    }
  });
}

/**
 * Глубина рекурсии: закреплён порядок, а не числа. Само число зависит от того, кто зовёт
 * функцию, — в этом прогоне WebKit дал 66 920 при 53 233 в таблице, — а порядок движков
 * держится. Так же и в тексте темы.
 */
test('порядок глубины рекурсии: WebKit > Firefox > Chromium — и так же в таблице', async () => {
  const measured: Record<EngineKey, number> = { chromium: 0, firefox: 0, webkit: 0 };
  for (const [engine, type] of ENGINES) {
    const browser = await type.launch();
    try {
      const page = await browser.newPage();
      await page.setContent('<p>стенд</p>');
      measured[engine] = await page.evaluate(() => {
        let n = 0;
        const f = (): void => {
          n++;
          f();
        };
        try {
          f();
        } catch {
          /* RangeError — его и ждали */
        }
        return n;
      });
    } finally {
      await browser.close();
    }
  }
  expect(measured.webkit).toBeGreaterThan(measured.firefox);
  expect(measured.firefox).toBeGreaterThan(measured.chromium);

  const [chromiumDepth, firefoxDepth, webkitDepth] = DEPTH_ROWS.rows[0].slice(1).map((v) => Number(v.replace(/\s/g, '')));
  expect(webkitDepth).toBeGreaterThan(firefoxDepth);
  expect(firefoxDepth).toBeGreaterThan(chromiumDepth);
});

/**
 * ⚠️ `userAgent` снимается В ОТДЕЛЬНОМ ПРОЦЕССЕ, вне раннера. Раннер подставляет строку из
 * профиля устройства в конфиге («Desktop Chrome») во все контексты — даже в Firefox и WebKit,
 * запущенные вручную, и `test.use({ userAgent: undefined })` этого не снимает: проверка видела
 * «Windows NT 10.0» у Firefox. Сверять таблицу с эмуляцией бессмысленно.
 */
test('userAgent трёх движков — как в таблице темы', () => {
  const code = `
    import { chromium, firefox, webkit } from '@playwright/test';
    const out = {};
    for (const [name, type] of [['chromium', chromium], ['firefox', firefox], ['webkit', webkit]]) {
      const browser = await type.launch();
      const page = await browser.newPage();
      out[name] = await page.evaluate(() => navigator.userAgent);
      await browser.close();
    }
    console.log(JSON.stringify(out));`;
  const ua = JSON.parse(
    execFileSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', cwd: process.cwd() }),
  ) as Record<EngineKey, string>;

  expect(ua.chromium, 'Chromium называет себя и AppleWebKit, и Safari').toMatch(/AppleWebKit\/.*Safari\//);
  expect(ua.webkit).toContain('Safari/');
  expect(ua.firefox).toContain('Gecko/');
  for (const engine of ['chromium', 'firefox', 'webkit'] as EngineKey[]) {
    const row = UA_ROWS.rows.find((r) => r[0].toLowerCase().startsWith(engine))!;
    if (process.platform === 'darwin') {
      // Стенд — macOS 26 на процессоре Apple, а строка у всех трёх — «Intel Mac OS X 10.15».
      expect(ua[engine], `${engine}: версия системы в строке заморожена`).toMatch(/Intel Mac OS X 10[._]15/);
      // Строка таблицы — та же, с точностью до сборки Chromium без окна («HeadlessChrome»).
      expect(row[1].replace('HeadlessChrome', 'Chrome')).toBe(ua[engine].replace('HeadlessChrome', 'Chrome'));
    }
  }
});
