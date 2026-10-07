import type { AutoWaitFn, AwFixture, Snapshot } from './types';

/**
 * Демо и тест спрашивают одну и ту же функцию — строку `AUTOWAIT_CODE` из темы.
 *
 * Строка напечатана на странице, собрана здесь `new Function` и прогоняется
 * `tests/unit/e2e-testing.test.ts` против журналов настоящего Playwright 1.63 на фикстурах
 * стенда; паузы в ней сверяются с исходником `playwright-core` из `node_modules`. Копии нет.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadAutoWait(code: string): AutoWaitFn {
  return new Function(`${code}\nreturn autoWait;`)() as AutoWaitFn;
}

/** Готовая кнопка: та же база, что у стенда (`fixtures.mjs`). */
export const READY: Omit<Snapshot, 't'> = {
  attached: true,
  visible: true,
  x: 40,
  moving: false,
  coveredBy: null,
  disabled: false,
};

/** Снимки фикстуры: «до» с нуля и готовая кнопка с `changeAt`; `null` — не станет готовой никогда. */
export function timelineOf(fx: Pick<AwFixture, 'before'>, changeAt: number | null): Snapshot[] {
  const first: Snapshot = { t: 0, ...READY, ...fx.before };
  return changeAt === null ? [first] : [first, { t: changeAt, ...READY }];
}
