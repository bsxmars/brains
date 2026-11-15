import { expect, test } from '@playwright/test';

/** Таблица сравнивает настоящие острова, поэтому проверяется в собранном сайте. */
for (const memo of ['off', 'on']) {
  for (const action of ['счётчик +1', 'фильтр', 'добавить строку']) {
    test(`React/Vue: ${action}, memo ${memo} — /frameworks/react-vs-vue/`, async ({ page }) => {
      await page.goto('/frameworks/react-vs-vue/');
      const lab = page.locator('#s2 .lab');
      await lab.scrollIntoViewIfNeeded();
      await expect(lab.locator('astro-island[ssr]')).toHaveCount(0);
      const react = lab.locator('.tm-pane').nth(0);
      const vue = lab.locator('.tm-pane').nth(1);
      // У скрытого radio кликаем видимую подпись, как читатель.
      if (memo === 'on') await react.locator('.tm-pill').nth(1).click();
      await page.evaluate(() => new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }));
      await expect(react.locator('li')).toHaveCount(5);

      const table = page.locator('#s2 table').filter({
        has: page.getByRole('columnheader', { name: 'действие · меняется одно поле из трёх', exact: true }),
      });
      const cells = await table.locator('tbody tr').filter({ hasText: action }).locator('td').allTextContents();
      const read = async (pane: typeof react) => (await pane.locator('[data-meter] .tm-stat-value').allTextContents()).map(Number);
      await lab.getByRole('button', { name: action, exact: true }).click();
      // Ожидания взяты из видимой таблицы: её числа обязаны совпасть с исполнением.
      await expect.poll(() => read(react)).toEqual([Number(cells[memo === 'off' ? 1 : 2]), Number(cells[4])]);
      await expect.poll(() => read(vue)).toEqual([Number(cells[3]), Number(cells[5])]);
    });
  }
}
