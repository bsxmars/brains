import { getCollection, type CollectionEntry } from 'astro:content';
import type { Direction } from '@/entities/direction';

/**
 * Уроки направления по порядку из frontmatter.
 *
 * Направление — это коллекция контента, поэтому выбирать уроки можно только зная, о каком
 * направлении речь. Параметр обязателен намеренно: с необязательным легко забыть его в новом
 * месте и молча получить список чужих уроков, а так забывчивость становится ошибкой типов.
 */
export type LessonCollection = 'lessons' | 'render' | 'frameworks' | 'platform' | 'tooling' | 'delivery' | 'algorithms' | 'data' | 'patterns';
export type Lesson =
  | CollectionEntry<'lessons'>
  | CollectionEntry<'render'>
  | CollectionEntry<'frameworks'>
  | CollectionEntry<'platform'>
  | CollectionEntry<'tooling'>
  | CollectionEntry<'delivery'>
  | CollectionEntry<'algorithms'>
  | CollectionEntry<'data'>
  | CollectionEntry<'patterns'>;

export async function getLessons(collection: LessonCollection): Promise<Lesson[]> {
  const lessons = await getCollection(collection);
  return [...lessons].sort((a, b) => a.data.order - b.data.order);
}

/** То же, но по описанию направления — так вызывающему не нужно помнить имя коллекции. */
export function getDirectionLessons(direction: Direction): Promise<Lesson[]> {
  return getLessons(direction.collection);
}

/**
 * Соседи урока лежат в отдельном файле: там чистая функция без `astro:content`, и потому
 * её можно закрыть юнит-тестом. Порядок задаётся полем `order` и правится во frontmatter.
 */
export { neighbours } from './neighbours';
export type { Neighbours } from './neighbours';
