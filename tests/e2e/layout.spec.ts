import { expect, test } from '@playwright/test';
import { PAGES } from './pages';

/**
 * Страницу нельзя утащить вбок ни на какой ширине.
 *
 * В оригиналах медиазапросов нет вовсе, и на телефоне это местами видно: сплит демо не
 * складывается, широкие сетки держат `min-width`. Здесь проверка стоит с самого начала, чтобы
 * каждый новый блок сразу проверялся на 320px, а не «потом, когда дойдут руки».
 *
 * 320 — самый узкий телефон, который ещё в ходу; 1440 — где макет перестаёт расти.
 */
const WIDTHS = [320, 768, 1024, 1440];

for (const width of WIDTHS) {
  for (const path of PAGES) {
    test(`нет горизонтальной прокрутки: ${path} при ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(200);

      const overflow = await page.evaluate(() => {
        const docWidth = document.documentElement.clientWidth;
        const guilty: string[] = [];
        for (const el of Array.from(document.querySelectorAll('*'))) {
          const rect = el.getBoundingClientRect();
          // Элементы со своей горизонтальной прокруткой вылезать не могут — их дело
          // прокручиваться внутри, и они здесь ни при чём.
          if (rect.right > docWidth + 1 && getComputedStyle(el).overflowX !== 'auto') {
            guilty.push(`${el.tagName.toLowerCase()}.${el.className?.toString().slice(0, 40)}`);
          }
        }
        return { scrollWidth: document.documentElement.scrollWidth, docWidth, guilty: guilty.slice(0, 5) };
      });

      expect(
        overflow.scrollWidth,
        `страница шире окна, виноваты: ${overflow.guilty.join(', ')}`,
      ).toBeLessThanOrEqual(overflow.docWidth + 1);
    });
  }
}
