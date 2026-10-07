/**
 * Публичный API сущности «направление»: объявление направлений и адреса внутри них.
 *
 * Только модель, как и у сущности «урок»: список направлений на главной и шапка направления —
 * это виджеты.
 */
export { DIRECTIONS, getDirection, lessonHref } from './model/directions';
export type { Direction, DirectionId } from './model/directions';
