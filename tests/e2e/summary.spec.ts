import { expect, test } from '@playwright/test';
import { PAGES } from './pages';

const TOPICS = PAGES.filter((path) => path !== '/kit/labs/'
  && path.split('/').filter(Boolean).length === 2);
if (TOPICS.length < 166) throw new Error('Обход саммари потерял темы курса');

for (const path of TOPICS) {
  test(`саммари открыто и содержит только ядро: ${path}`, async ({ page }) => {
    await page.goto(path);
    const summary = page.getByRole('region', { name: 'Саммари', exact: true });
    const core = summary.locator('[data-summary-core]');
    await expect(summary.getByRole('heading', { name: 'Ядро', exact: true })).toBeVisible();
    await expect(core).toBeVisible();
    await expect(summary.locator('details, summary')).toHaveCount(0);
    const points = core.locator(':scope > ul > li');
    const count = await points.count();
    expect(count).toBeGreaterThanOrEqual(4);
    expect(count).toBeLessThanOrEqual(7);
    for (const point of await points.all()) await expect(point).toBeVisible();
    const insets = await core.evaluate((card) => {
      const box = card.getBoundingClientRect();
      const title = card.querySelector('h3')!.getBoundingClientRect();
      const list = card.querySelector('ul')!.getBoundingClientRect();
      return [title.top - box.top, title.left - box.left,
        box.right - list.right, box.bottom - list.bottom];
    });
    // Проверяем реальную геометрию: заголовок и список не касаются краёв карточки.
    for (const inset of insets) expect(inset).toBeGreaterThan(8);
    await expect(summary).not.toContainText('Сначала расскажи');
  });
}
