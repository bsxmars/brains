import { expect, test } from '@playwright/test';

for (const width of [375, 1280]) {
  test(`названия коротких этапов кадра читаются целиком на ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/render/render-pipeline/');
    const island = page.locator('astro-island').filter({ has: page.locator('.phase-key') });
    await island.locator('.body').scrollIntoViewIfNeeded();
    await expect(island).not.toHaveAttribute('ssr');
    await page.evaluate(() => document.fonts.ready);

    const names = island.locator('.phase-key__item');
    await expect(names).toHaveCount(13);
    await expect(names.filter({ hasText: 'микрозадачи' }).first()).toBeVisible();
    await expect(names.filter({ hasText: 'ResizeObserver → расчёт IntersectionObserver' })).toBeVisible();

    // Ширина отрезков остаётся пропорциональна времени; ни номера, ни блоки не перекрываются.
    const tracks = await island.locator('.lane__track').evaluateAll((elements) =>
      elements.map((track) => Array.from(track.querySelectorAll<HTMLElement>('.phase')).map((phase) => {
        const label = phase.querySelector<HTMLElement>('.phase__label')!;
        const box = phase.getBoundingClientRect();
        const text = label.getBoundingClientRect();
        return { left: box.left, right: box.right, labelLeft: text.left, labelRight: text.right };
      })),
    );
    for (const phases of tracks) {
      for (let i = 0; i < phases.length; i++) {
        const phase = phases[i];
        expect(phase.labelLeft).toBeGreaterThanOrEqual(phase.left - 1);
        expect(phase.labelRight).toBeLessThanOrEqual(phase.right + 1);
        if (i > 0) expect(phase.left).toBeGreaterThanOrEqual(phases[i - 1].right - 1);
      }
    }

    const clipped = await names.evaluateAll((items) => items.filter((item) =>
      item.scrollWidth > item.clientWidth + 1 || item.scrollHeight > item.clientHeight + 1,
    ).map((item) => item.textContent));
    expect(clipped, 'полные названия этапов не должны обрезаться').toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
