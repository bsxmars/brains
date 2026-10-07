import { rulerLines, runWithRuler } from '@/features/run-snippet';
import { simulate } from '@/shared/lib/promise-sim';
import type { CaseReport, LaneMeasure, LaneReport, OrderMeasure, ResolveCase, ResolveLane } from './types';

/**
 * Прогнать случай `ResolvePromise(v)` двумя независимыми способами и свести ответы.
 *
 * Отдельным модулем, а не внутри компонента, по той же причине, что у `widgets/clone-survival`
 * и `widgets/lock-lab`: ровно эти функции зовёт юнит-тест. Демо и тест обязаны спрашивать
 * движок одинаково — иначе «проверено тестом» означало бы «проверено что-то похожее».
 *
 * Два способа — не перестраховка, а устройство раздела. Движок отвечает «сколько»: пример
 * по-настоящему выполняется рядом с линейкой `.then`, и видно, между какими её ступенями
 * выпал результат. Модель отвечает «из чего»: те же строки, записанные операциями спеки,
 * дают ленту микрозадач с их именами. Ответы сверяются здесь же (`verdict`), и расхождение
 * виджет показывает, а не прячет.
 *
 * ⚠️ Здесь нет ни `window`, ни `document`: остров сперва рендерится в Node, и обращение
 * к браузерному API уронило бы сборку всей страницы.
 */

/** Метка, которую печатает пример там, где результат становится виден. */
export const HIT = '<-- здесь';

/** Длина линейки: ступеней должно хватать на самый дорогой случай раздела (4 тика). */
export const RULER_STEPS = 6;

/** Сколько ступеней линейки прошло до метки. `fallback` — если метки в выводе нет вовсе. */
export function priceOf(lines: string[], fallback: number): number {
  const at = lines.findIndex((line) => line.startsWith(HIT));
  if (at < 0) return fallback;
  return lines.slice(0, at).filter((line) => line.startsWith('tick')).length;
}

/**
 * Настоящий прогон дорожки в браузере читателя.
 *
 * Ветка «среды нет» честная: `new Function` может быть запрещён политикой безопасности, и тогда
 * `runWithRuler` возвращает `ok: false`. В этом случае показывается заранее посчитанный вывод
 * и `measured: false` — подпись под консолью меняется, и читатель видит разницу между
 * «замерено сейчас» и «записано заранее».
 */
export async function measureLane(lane: ResolveLane, steps = RULER_STEPS): Promise<LaneMeasure> {
  const result = await runWithRuler(lane.code, steps);
  if (!result.ok) return plannedLane(lane, steps);
  return { lines: result.lines, price: priceOf(result.lines, lane.n), measured: true };
}

/** Тот же вывод, собранный из заранее известной цены, — для серверной разметки и для `ok: false`. */
export function plannedLane(lane: ResolveLane, steps = RULER_STEPS): LaneMeasure {
  return { lines: rulerLines(lane.n, HIT, steps), price: lane.n, measured: false };
}

/** Лента микрозадач по модели спеки. `null` — модели для этой дорожки нет. */
export function modelLane(lane: ResolveLane) {
  return lane.program ? simulate(lane.program) : null;
}

function reportLane(lane: ResolveLane, measure: LaneMeasure): LaneReport {
  const model = modelLane(lane);
  return {
    lane,
    measure,
    model,
    verdict: !model ? 'none' : model.price === measure.price ? 'match' : 'clash',
    drift: measure.measured && measure.price !== lane.n,
  };
}

/** Порядок вывода двух-трёх цепочек, запущенных вместе. `null` — у случая такого прогона нет. */
export async function measureOrder(item: ResolveCase): Promise<OrderMeasure | null> {
  if (!item.order) return null;
  // Линейка здесь не нужна: важен порядок строк между собой, а не номер тика.
  const result = await runWithRuler(item.order.code, 0);
  return result.ok ? { lines: result.lines, measured: true } : plannedOrder(item);
}

export function plannedOrder(item: ResolveCase): OrderMeasure | null {
  return item.order ? { lines: item.order.expected, measured: false } : null;
}

/** Полный отчёт по случаю: движок, модель и их приговор по каждой дорожке. */
export async function measureCase(item: ResolveCase, steps = RULER_STEPS): Promise<CaseReport> {
  const measures = await Promise.all(item.lanes.map((lane) => measureLane(lane, steps)));
  return {
    key: item.key,
    lanes: item.lanes.map((lane, i) => reportLane(lane, measures[i])),
    order: await measureOrder(item),
  };
}

/**
 * Тот же отчёт без запуска примеров — синхронный.
 *
 * Нужен серверной разметке острова: до гидратации выполнять код негде, а показать пустоту
 * вместо демо нельзя. Модель считается и здесь — она чистая и работает в Node.
 */
export function plannedCase(item: ResolveCase, steps = RULER_STEPS): CaseReport {
  return {
    key: item.key,
    lanes: item.lanes.map((lane) => reportLane(lane, plannedLane(lane, steps))),
    order: plannedOrder(item),
  };
}
