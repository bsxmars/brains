import type { Browser, BrowserType } from '@playwright/test';

/**
 * Запустить отдельный браузер, отдать его `fn` и закрыть — даже если `fn` бросил.
 *
 * Нужен там, где фикстуры Playwright не хватает: другой движок в одном тесте, флаги запуска
 * (`args`, полный Chromium через `channel: 'chromium'`), несколько браузеров подряд.
 */
export async function withBrowser<T>(
  type: BrowserType,
  opts: Parameters<BrowserType['launch']>[0],
  fn: (browser: Browser) => Promise<T>,
): Promise<T> {
  const browser = await type.launch(opts);
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}
