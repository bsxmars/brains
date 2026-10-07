import { expect, test } from '@playwright/test';
import { PITFALLS } from '../../src/content/lessons/callbacks/data';

/**
 * «Колбэки», тонкое место 02: `setTimeout(fn(), 100)` в браузере.
 *
 * До 2026-09-30 тема писала «браузер, по описанию источника, молча ничего не делает (в этой
 * теме не проверялось)». Замер (Chromium 153, Firefox 155, WebKit 26.6 — одинаково): не-функция
 * принимается без исключения и без записи в консоли, таймер заводится, а строка через задержку
 * **исполняется как код** — так велит стандарт HTML. Здесь закреплён Chromium; Node ведёт себя
 * иначе (`ERR_INVALID_ARG_TYPE`) — это держит `tests/unit/callbacks.test.ts`.
 */
test('setTimeout с не-функцией: без ошибки, без консоли, строка исполняется как код', async ({ page }) => {
  const logged: string[] = [];
  page.on('console', (m) => logged.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => logged.push(`pageerror: ${e.message}`));
  await page.setContent('<p>стенд</p>');

  const result = await page.evaluate(async () => {
    const out: { id?: string; threw?: string; ran?: boolean } = {};
    try {
      out.id = typeof setTimeout(undefined as unknown as () => void, 10);
    } catch (error) {
      out.threw = (error as Error).name;
    }
    (window as unknown as { ran: boolean }).ran = false;
    setTimeout('window.ran = true' as unknown as () => void, 10);
    await new Promise((resolve) => setTimeout(resolve, 60));
    out.ran = (window as unknown as { ran: boolean }).ran;
    return out;
  });

  expect(result.threw, 'не-функция не бросает').toBeUndefined();
  expect(result.id, 'таймер заведён — вернулся его номер').toBe('number');
  expect(result.ran, 'строка исполнена как код').toBe(true);
  expect(logged, 'в консоли ни строчки').toEqual([]);

  const text = PITFALLS.find((p) => p.n === '02')!.d;
  expect(text, 'тема называет механизм').toContain('**исполняет как код**');
});
