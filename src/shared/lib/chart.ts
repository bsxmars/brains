import { max, min } from 'd3-array';
import { scaleLinear, scaleLog } from 'd3-scale';
import { line } from 'd3-shape';

/**
 * Шов к d3 — по тому же правилу, что и шов к библиотеке компонентов: имя зависимости знает
 * один модуль.
 *
 * Зачем вообще шов. В курсе девять «диаграмм» нарисованы полосками `div` без единой оси, и это
 * не мелочь оформления: столбик без шкалы показывает «больше-меньше», но не даёт померить.
 * Разница между «прокси медленнее» и «прокси в двадцать раз медленнее» — это и есть содержание
 * урока. d3 в проекте стоял с самого начала и не использовался ни разу; здесь он наконец
 * включается — но только через этот файл, чтобы в компонентах не заводились свои шкалы
 * и свои представления о том, где у графика ноль.
 *
 * Наружу отдаются обычные функции, а не объекты d3: компонентам нужно `число → координата`,
 * остальное — детали библиотеки.
 */
export type Scale = (value: number) => number;

/** Линейная шкала: равные приращения значения дают равные приращения пикселей. */
export function linear(domain: [number, number], range: [number, number]): Scale {
  const scale = scaleLinear().domain(domain).range(range);
  return (value: number) => scale(value);
}

/**
 * Логарифмическая шкала — для величин, различающихся на порядки.
 *
 * Ровно этого не хватало двум диаграммам курса: время ReDoS и цена сравнения строк растут
 * кратно, и на линейной шкале всё, кроме максимума, вырождается в ноль.
 */
export function log(domain: [number, number], range: [number, number]): Scale {
  const scale = scaleLog().domain(domain).range(range);
  return (value: number) => scale(value);
}

/** Круглые засечки по диапазону — те, что человек и сам бы выбрал: 0, 5, 10, а не 3.7. */
export function niceTicks(domain: [number, number], count = 5): number[] {
  return scaleLinear().domain(domain).nice(count).ticks(count);
}

/** Засечки по степеням основания — спутник логарифмической шкалы. */
export function logTicks(domain: [number, number], count = 5): number[] {
  return scaleLog().domain(domain).ticks(count);
}

/** Ломаная по готовым координатам: путь для `<path d>`. */
export function linePath(points: [number, number][]): string {
  const path = line<[number, number]>()
    .x((p) => p[0])
    .y((p) => p[1]);
  return path(points) ?? '';
}

/** Диапазон значений с запасом сверху — чтобы верхняя точка не упиралась в рамку. */
export function extent(values: number[], headroom = 0.05): [number, number] {
  const lo = min(values) ?? 0;
  const hi = max(values) ?? 1;
  return [Math.min(0, lo), hi * (1 + headroom)];
}
