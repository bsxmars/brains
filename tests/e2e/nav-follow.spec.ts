import { expect, test } from '@playwright/test';

/**
 * Клик по пункту полосы обязан подтянуть ленту к этому пункту.
 *
 * Полоса разделов прокручивается горизонтально, и у длинных тем цель клика часто лежит
 * за видимой частью. Правило простое: **кликнул — увидел**. Нарушение этого выглядит так,
 * как его и описал читатель: «выбрал пункт, а полоса вернулась в конец».
 *
 * ⚠️ Проверка написана после настоящего бага, и баг был **только в Gecko**. Причина —
 * `requestAnimationFrame` после клика по якорю: в Chromium и WebKit к этому кадру страница
 * уже переместилась, в Firefox ещё нет, и код, вычислявший цель по положению страницы, брал
 * прежний пункт. Замер тогда: `scrollLeft` 170 при максимуме 784 и активный пункт за краем.
 *
 * ⚠️ Поэтому у проверки есть слабость, которую надо знать: прогон курса идёт в Chromium,
 * то есть ровно там, где этот класс ошибок невидим. Здесь она сторожит **инвариант** —
 * цель клика видна целиком, — а межбраузерную часть ловит разовый прогон в Firefox
 * (`npx playwright install firefox`), описанный в AGENTS.md.
 */

/** Тема с самым длинным оглавлением: двенадцать пунктов, лента заведомо прокручиваемая. */
const PATH = '/js/object-model/';

/** Виден ли активный пункт в ленте целиком, вместе с полями. */
async function activeIsVisible(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const row = document.querySelector<HTMLElement>('.nav .row');
    const active = document.querySelector<HTMLElement>('.pill.is-active');
    if (!row || !active) return { ok: false, reason: 'нет ленты или активного пункта' };

    const left = active.offsetLeft;
    const right = active.offsetLeft + active.offsetWidth;
    const ok = left >= row.scrollLeft - 1 && right <= row.scrollLeft + row.clientWidth + 1;
    return {
      ok,
      reason: `активный «${active.textContent?.trim()}» на ${left}…${right}, ` +
        `видимая часть ленты ${Math.round(row.scrollLeft)}…${Math.round(row.scrollLeft + row.clientWidth)}`,
    };
  });
}

test('клик по дальнему пункту подтягивает ленту к нему', async ({ page }) => {
  await page.goto(PATH);
  const pills = await page.$$('.nav .pill');
  expect(pills.length, 'у темы должно быть длинное оглавление').toBeGreaterThan(8);

  // Предпоследний пункт заведомо лежит правее видимой части при старте.
  await pills[pills.length - 2].click();
  await page.waitForTimeout(700);

  const seen = await activeIsVisible(page);
  expect(seen.ok, `цель клика осталась за краем ленты: ${seen.reason}`).toBe(true);
});

test('клик по ближнему пункту возвращает ленту к нему', async ({ page }) => {
  await page.goto(PATH);

  // Сначала уезжаем вправо — это состояние, в котором баг и был виден.
  let pills = await page.$$('.nav .pill');
  await pills[pills.length - 2].click();
  await page.waitForTimeout(700);

  // Теперь цель слева: лента обязана вернуться к ней, а не остаться в конце.
  pills = await page.$$('.nav .pill');
  await pills[1].click();
  await page.waitForTimeout(700);

  const seen = await activeIsVisible(page);
  expect(seen.ok, `лента не вернулась к цели клика: ${seen.reason}`).toBe(true);
});

test('прокрутка страницы ленту не двигает', async ({ page }) => {
  await page.goto(PATH);

  // Уводим ленту вправо кликом — это выбор читателя, и отменять его нельзя.
  const pills = await page.$$('.nav .pill');
  await pills[pills.length - 2].click();
  await page.waitForTimeout(700);
  const before = await page.evaluate(
    () => Math.round(document.querySelector<HTMLElement>('.nav .row')?.scrollLeft ?? -1),
  );

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(700);
  const after = await page.evaluate(
    () => Math.round(document.querySelector<HTMLElement>('.nav .row')?.scrollLeft ?? -1),
  );

  expect(
    after,
    'прокрутка страницы меняет только подсветку: место в ленте выбрал читатель',
  ).toBe(before);
});
