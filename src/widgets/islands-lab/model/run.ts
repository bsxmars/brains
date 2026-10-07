import type { IslandSpec, PlanEnv, PlanFn, PlanStep, StandPage } from './types';

/**
 * Демо и тест спрашивают одну и ту же функцию — строку `PLAN_CODE` из темы.
 *
 * Строка напечатана на странице, собрана здесь `new Function` и в
 * `tests/unit/islands.test.ts` сверяется с тем, что Chromium на самом деле запросил при прокрутке
 * собранных страниц этого сайта. Копии нет: если показанный код разойдётся с браузером,
 * покраснеет тест.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadPlan(code: string): PlanFn {
  return new Function(`${code}\nreturn planLoads;`)() as PlanFn;
}

/** Прокрутки шагом в один экран — так же, как шагал стенд. */
export function scrollsFor(pageHeight: number, viewport: number): number[] {
  const out: number[] = [];
  for (let y = viewport; y < pageHeight; y += viewport) out.push(y);
  return out;
}

/** Острова страницы с одной директивой на всех — или как собрано, если `client` пуст. */
export function withDirective(islands: IslandSpec[], client: IslandSpec['client'] | null): IslandSpec[] {
  return client ? islands.map((i) => ({ ...i, client })) : islands;
}

/** Расчёт для страницы стенда: окно 800, без медиазапросов (на сайте их нет). */
export function planPage(plan: PlanFn, page: StandPage, client: IslandSpec['client'] | null): PlanStep[] {
  const env: PlanEnv = { viewport: 800, scrolls: scrollsFor(page.pageHeight, 800), matches: () => false };
  return plan(withDirective(page.islands, client), page.graph, env);
}

/** Вес по ссылкам из HTML: только `component-url` и `renderer-url`, без того, что они импортируют. */
export function htmlRefBytes(page: StandPage): number {
  const roots = new Set(page.islands.flatMap((i) => i.files));
  return [...roots].reduce((sum, f) => sum + page.graph[f].bytes, 0);
}
