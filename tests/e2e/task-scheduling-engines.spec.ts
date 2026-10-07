import { readFileSync } from 'node:fs';
import { chromium, expect, firefox, test, webkit, type BrowserType } from '@playwright/test';
import { LONGTASK_FACTS } from '../../src/content/lessons/task-scheduling/data';

/**
 * «Планирование задач»: что из планировщика есть в каком движке.
 *
 * Тема утверждает снятое 2026-10-01 в трёх движках Playwright (Chromium 153, Firefox 155,
 * WebKit 26.6): `scheduler.postTask`, `scheduler.yield` и `TaskController` есть в Chromium
 * и Firefox, в WebKit нет ни их, ни `requestIdleCallback`; тип `longtask` есть только
 * в Chromium, а `observe` с неизвестным типом не бросает нигде. До этого тема писала
 * «в Safari наблюдателя нет» (а его нет и в Firefox) и «`observe` бросит исключение».
 *
 * Движки запускаются прямо из теста: проект `chromium` в конфиге один, а здесь важно сравнение.
 * Нужны бинарники всех трёх (`npx playwright install firefox webkit`). Страница курса не нужна.
 */
const ENGINES: [string, BrowserType, Record<string, boolean>][] = [
  ['chromium', chromium, { postTask: true, yield: true, taskController: true, idle: true, longtask: true }],
  ['firefox', firefox, { postTask: true, yield: true, taskController: true, idle: true, longtask: false }],
  ['webkit', webkit, { postTask: false, yield: false, taskController: false, idle: false, longtask: false }],
];

for (const [name, type, expected] of ENGINES) {
  test(`планировщик в ${name}: поддержка и молчание observe`, async () => {
    const browser = await type.launch();
    try {
      const page = await browser.newPage();
      await page.setContent('<p>стенд</p>');
      const got = await page.evaluate(() => {
        const s = (globalThis as { scheduler?: { postTask?: unknown; yield?: unknown } }).scheduler;
        let observeThrew = false;
        try {
          new PerformanceObserver(() => {}).observe({ type: 'нет-такого-типа' });
        } catch {
          observeThrew = true;
        }
        return {
          postTask: typeof s?.postTask === 'function',
          yield: typeof s?.yield === 'function',
          taskController: typeof (globalThis as { TaskController?: unknown }).TaskController === 'function',
          idle: typeof (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback === 'function',
          longtask: PerformanceObserver.supportedEntryTypes.includes('longtask'),
          observeThrew,
        };
      });
      expect({ ...got, observeThrew: undefined }).toEqual({ ...expected, observeThrew: undefined });
      expect(got.observeThrew, '`observe` с неизвестным типом проходит молча').toBe(false);
    } finally {
      await browser.close();
    }
  });
}

test('текст темы называет те же движки', () => {
  const mdx = readFileSync('src/content/lessons/task-scheduling/index.mdx', 'utf8');
  expect(mdx).toContain('Оба метода есть в Chromium 153 и Firefox 155, а в WebKit 26.6');
  const longtask = LONGTASK_FACTS.find((f) => f.t.includes('наблюдателя нет'));
  if (!longtask) throw new Error('карточки «… наблюдателя нет» в LONGTASK_FACTS нет — проверка осталась без предмета');
  expect(longtask.t).toContain('Firefox');
  expect(longtask.d).toContain('**не бросает**');
});
