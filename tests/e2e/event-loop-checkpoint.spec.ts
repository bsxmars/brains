import { expect, test } from '@playwright/test';
import { CHECKPOINT, CHECKPOINT_CODE } from '../../src/content/lessons/event-loop/data';

/** Один исходник двух слушателей: браузерный ввод и синхронный .click() дают разные checkpoint. */
for (const mode of ['real', 'prog'] as const) {
  test(`checkpoint между слушателями: ${mode}`, async ({ page }) => {
    await page.setContent('<button id="target">Нажать</button>');
    await page.evaluate((source) => {
      const state = window as unknown as { checkpointOutput: string[] };
      state.checkpointOutput = [];
      new Function('btn', 'console', source)(document.querySelector('#target'), {
        log: (value: string) => state.checkpointOutput.push(value),
      });
    }, CHECKPOINT_CODE);

    if (mode === 'real') {
      // Playwright доставляет настоящий ввод; вызов .click() из evaluate был бы другим опытом.
      await page.locator('#target').click();
    } else {
      await page.evaluate(() => (document.querySelector('#target') as HTMLButtonElement).click());
    }

    const expected = CHECKPOINT.find((item) => item.key === mode)!.steps.at(-1)!.out;
    await expect.poll(() => page.evaluate(() =>
      (window as unknown as { checkpointOutput: string[] }).checkpointOutput,
    )).toEqual(expected);
  });
}
