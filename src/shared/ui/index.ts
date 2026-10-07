/**
 * Публичный API `shared/ui` для Vue и TS — его импортируют острова, виджеты и фичи.
 *
 * `.astro`-компоненты живут в соседнем входе `@/shared/ui/astro`: если затащить их сюда,
 * модуль `.astro` попадёт в клиентский граф острова, где ему делать нечего.
 */
export * from './aura';

export { LESSON_VARS, varsToStyle } from './theme';
