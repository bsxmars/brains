import { expect, test } from '@playwright/test';
import { PITFALLS, REJECTION_RUNS } from '../../src/content/lessons/promise-internals/data';

/**
 * «Промис изнутри», раздел «Отказ»: в браузере граница не такая, как в Node.
 *
 * До 2026-10-29 тема писала, что обработчик из следующей задачи опоздал везде. Так ведёт себя
 * Node (держит `tests/unit/promise-internals.test.ts`). Браузер по стандарту HTML отправляет
 * `unhandledrejection` отдельной задачей и перед отправкой снова смотрит на флаг
 * `[[PromiseIsHandled]]`. Замер в Chromium: `setTimeout(…, 0)` успевает — события нет;
 * `setTimeout(…, 1)` опаздывает — событие, а за ним `rejectionhandled`.
 */
test('Chromium: catch из setTimeout(0) успевает, из setTimeout(1) — уже нет', async ({ page }) => {
  await page.setContent('<p>стенд</p>');

  const runs = await page.evaluate(async () => {
    const once = (delay: number | null) =>
      new Promise<string[]>((done) => {
        const log: string[] = [];
        const fired = (e: PromiseRejectionEvent) => {
          e.preventDefault();
          log.push('unhandledrejection');
        };
        const handled = () => log.push('rejectionhandled');
        addEventListener('unhandledrejection', fired);
        addEventListener('rejectionhandled', handled);
        const p = Promise.reject(new Error('x'));
        if (delay !== null) setTimeout(() => p.catch(() => {}), delay);
        setTimeout(() => {
          removeEventListener('unhandledrejection', fired);
          removeEventListener('rejectionhandled', handled);
          done(log);
        }, 150);
      });
    return { none: await once(null), zero: await once(0), one: await once(1) };
  });

  expect(runs.none).toEqual(['unhandledrejection']);
  expect(runs.zero, 'задача таймера пришла раньше задачи с событием').toEqual([]);
  expect(runs.one).toEqual(['unhandledrejection', 'rejectionhandled']);

  expect(REJECTION_RUNS.rows[1][2]).toContain('зависит от браузера');
  expect(PITFALLS.find((p) => p.n === '07')!.d).toContain('в Chromium `setTimeout(…, 0)` успевает');
});
