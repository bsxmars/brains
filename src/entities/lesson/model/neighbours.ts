/**
 * Соседи урока — для перехода «назад / вперёд».
 *
 * Живёт отдельным файлом от остальной модели по одной причине: `course.ts` импортирует
 * `astro:content`, а этого виртуального модуля вне сборки Astro не существует — значит,
 * юнит-тестом такой файл не покрыть. Здесь чистая функция без единой зависимости, и её
 * поведение на краях списка (первый урок, последний, неизвестный id) проверяется тестом.
 */
export interface Neighbours<T> {
  prev?: T;
  next?: T;
}

export function neighbours<T extends { id: string }>(lessons: T[], id: string): Neighbours<T> {
  const i = lessons.findIndex((lesson) => lesson.id === id);
  // Урока нет в списке — соседей у него тоже нет: пейджер просто не нарисуется.
  if (i === -1) return {};
  return {
    prev: i > 0 ? lessons[i - 1] : undefined,
    next: i < lessons.length - 1 ? lessons[i + 1] : undefined,
  };
}
