/**
 * Публичный API сущности «урок»: схема frontmatter и порядок уроков внутри направления.
 *
 * Только модель. Карточка урока в списке — это виджет: у сущности здесь нет своего UI,
 * а тащить `.astro` через тот же вход, что и схему, нельзя — схему читает `content.config.ts`.
 */
export { lessonSchema } from './model/schema';
export type { LessonFrontmatter } from './model/schema';
export { getDirectionLessons } from './model/lessons';
export type { Lesson, LessonCollection } from './model/lessons';
/** Соседи — чистая функция без `astro:content`, поэтому в своём файле и под юнит-тестом. */
export { neighbours } from './model/neighbours';
export type { Neighbours } from './model/neighbours';
export { getAnswerKey, parseAnswerKey } from './model/summary';
export type { GlossaryTerm, Pitfall, Prereq, Source, SourceGroup } from './model/topic';
export type { AnswerKey, AnswerKeyBlock, AnswerKeyItem } from './model/summary';
