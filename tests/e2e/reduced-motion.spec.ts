import { expect, test } from '@playwright/test';

/**
 * Просьбу системы не двигать картинку курс обязан выполнять.
 *
 * В демо появился автоплей — содержимое меняется само, без действия человека. Ровно для этого
 * случая и придуман `prefers-reduced-motion`: для части людей такое движение не «красиво»,
 * а физически плохо. Поэтому правило: **автоплей не предлагается и не стартует**, но демо
 * остаётся полностью рабочим — шаги листаются кнопками.
 *
 * Без этой проверки ветка кода просто никогда не выполнялась бы под тестами: настройка
 * системная, а в обычном прогоне она выключена.
 */
const DEMO_PAGE = '/js/event-loop/';

test.describe('система просит не двигать картинку', () => {
  test.use({ reducedMotion: 'reduce' });

  test('кнопки автоплея нет, а шаги листаются', async ({ page }) => {
    await page.goto(DEMO_PAGE);

    const play = page.getByRole('button', { name: 'Играть' }).first();
    const step = page.getByRole('button', { name: 'Шаг →' }).first();
    await step.waitFor({ state: 'visible' });

    // Проверяем видимость, а не наличие в DOM: до гидратации острова на странице лежит
    // серверная разметка, где предпочтение ещё неизвестно, — и прячет кнопку там медиазапрос.
    await expect(
      play,
      'при reduced-motion автоплей предлагать нельзя: кнопка должна быть скрыта',
    ).toBeHidden();

    // Ручной режим обязан работать: доступность демо не должна зависеть от настройки движения.
    await expect(step).toBeEnabled();
  });
});

test.describe('обычный режим', () => {
  test('автоплей доступен и сам не стартует', async ({ page }) => {
    await page.goto(DEMO_PAGE);

    const play = page.getByRole('button', { name: 'Играть' }).first();
    await play.waitFor({ state: 'visible' });

    // Демо не должно начинать играть само: читатель открыл урок, а не нажал «играть».
    const counter = page.locator('.counter').first();
    const before = await counter.textContent();
    await page.waitForTimeout(1500);
    expect(await counter.textContent(), 'демо запустилось само, без нажатия').toBe(before);
  });
});
