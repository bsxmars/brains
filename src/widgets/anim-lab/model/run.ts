import type { AnimApi, AnimCase, FramePlan, LayerApi } from './types';

/**
 * Демо и тест спрашивают одни и те же функции — строки `FRAME_PLAN_CODE` и `LAYER_CODE`
 * из темы «Анимации и композитор».
 *
 * Строки напечатаны на странице, собраны здесь `new Function` и прогоняются
 * `tests/unit/animations.test.ts` против литералов, снятых в Chromium (счётчики
 * `Performance.getMetrics`, трассировка, `LayerTree`, кадры скринкаста при занятом потоке).
 * `LAYER_CODE` опирается на `planAnimation`, поэтому собирается вместе с `FRAME_PLAN_CODE`.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadPlan(planCode: string): AnimApi {
  return new Function(`${planCode}\nreturn { framePlan, planAnimation };`)() as AnimApi;
}

export function loadLayers(planCode: string, layerCode: string): LayerApi {
  return new Function(`${planCode}\n${layerCode}\nreturn { ownLayer, countLayers };`)() as LayerApi;
}

/** Байты слоя по арифметике «ширина × высота × DPR² × 4». */
export function layerBytes(w: number, h: number, dpr: number): number {
  return w * h * dpr * dpr * 4;
}

/**
 * Что Chromium показал на сценарии, в тех же словах, что отвечает `framePlan`.
 * «На каждом кадре» — счётчик не меньше половины кадров за секунду (60 Гц на стенде),
 * отрисовка — событий `Paint` больше, чем кадров (у анимаций на главном потоке их ~2 на кадр,
 * у композитных — единицы за весь прогон).
 */
export function standStages(c: Pick<AnimCase, 'chromium' | 'movedWhileBlocked'>, fps = 60) {
  return {
    style: c.chromium.style >= fps / 2,
    layout: c.chromium.layout >= fps / 2,
    paint: c.chromium.paint > fps,
    /** Видимое движение несёт первая анимация сценария. */
    firstOnCompositor: c.movedWhileBlocked,
  };
}

/** Совпадает ли ответ `framePlan` со снятым в Chromium. */
export function agrees(plan: FramePlan, c: Pick<AnimCase, 'chromium' | 'movedWhileBlocked'>, fps = 60): boolean {
  const s = standStages(c, fps);
  return (
    plan.style === s.style &&
    plan.layout === s.layout &&
    plan.paint === s.paint &&
    (plan.plans[0]?.thread === 'compositor') === s.firstOnCompositor
  );
}
