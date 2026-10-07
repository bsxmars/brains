import { expect, test } from '@playwright/test';
import { PAGES } from './pages';

/**
 * Переход по пункту полосы разделов не должен прятать заголовок под липкими полосами.
 *
 * Полос две, и обе появились позже самих якорей: полоса разделов липнет к верху окна (60px),
 * а под ней — стрелка «все темы» (низ на 115.6px, измерено на 1280px). Якорь про них не знает:
 * браузер ставит верх раздела ровно в верх окна, и заголовок оказывался **на 42.6px выше
 * видимой области** — читатель кликал по разделу и попадал в его середину.
 *
 * Лечится это одним свойством — `scroll-margin-top` у `.section` в `shared/ui/Section.astro`.
 * Но число там связано с высотой двух чужих полос: подрастёт полоса разделов или отбивка
 * у стрелки — запас молча перестанет хватать, а вёрстка при этом останется «правильной».
 * Поэтому проверяется не число, а следствие: после клика заголовок ниже обеих полос.
 *
 * ⚠️ Внизу страницы прокрутке некуда идти: последний раздел физически не может опуститься.
 * Такой случай пропускается — иначе проверка требовала бы невозможного.
 */
for (const path of PAGES) {
  test(`якорь не прячет заголовок: ${path}`, async ({ page }) => {
    await page.goto(path);

    const pills = await page.$$('.nav .pill');
    // Полоса разделов есть только у страниц тем: на главной и в списках её нет.
    test.skip(pills.length === 0, 'на странице нет полосы разделов');

    // Четвёртый пункт, если он есть: он заведомо ниже первого экрана, значит переход настоящий.
    const target = pills[Math.min(3, pills.length - 1)];
    await target.click();
    await page.waitForTimeout(900);

    const seen = await page.evaluate(() => {
      const active = document.querySelector<HTMLElement>('.pill.is-active');
      const id = active?.dataset.nav;
      const section = id ? document.getElementById(id) : null;
      const heading = section?.querySelector('h2') ?? section;
      const rect = (el: Element | null) => (el ? el.getBoundingClientRect() : null);

      const nav = rect(document.querySelector('.nav'));
      const back = rect(document.querySelector('.row--sticky'));
      const head = rect(heading ?? null);

      return {
        id,
        atBottom: window.scrollY + window.innerHeight >= document.body.scrollHeight - 2,
        stackBottom: Math.max(nav?.bottom ?? 0, back?.bottom ?? 0),
        headingTop: head?.top ?? null,
        headingText: (heading?.textContent ?? '').trim().slice(0, 40),
      };
    });

    test.skip(seen.atBottom, 'страница докручена до конца: разделу некуда опускаться');
    expect(seen.headingTop, `раздел ${seen.id} не найден после перехода`).not.toBeNull();

    const gap = (seen.headingTop ?? 0) - seen.stackBottom;
    expect(
      gap,
      `заголовок «${seen.headingText}» ушёл под липкие полосы на ${-gap}px ` +
        `(низ полос ${seen.stackBottom}, верх заголовка ${seen.headingTop})`,
    ).toBeGreaterThanOrEqual(0);
  });
}
