/**
 * Публичный API сущности «урок»: схема frontmatter и порядок уроков внутри направления.
 *
 * Только модель. Карточка урока в списке — это виджет: у сущности здесь нет своего UI,
 * а тащить `.astro` через тот же вход, что и схему, нельзя — схему читает `content.config.ts`.
 */
export { lessonSchema } from './model/schema';
export type { LessonFrontmatter } from './model/schema';
export { getLessons, getDirectionLessons, neighbours } from './model/lessons';
export type { Lesson, LessonCollection } from './model/lessons';
