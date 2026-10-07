/**
 * Путь внутри сайта с учётом базы: `withBase('/js/event-loop/')`.
 *
 * Сайт живёт не только в корне домена: на GitHub Pages проекта он открывается по адресу
 * `user.github.io/brains/`, и ссылка `/js/…`, написанная от корня, ведёт мимо сайта. Базу знает
 * сборщик (`base` в `astro.config.mjs`), здесь она приходит как `import.meta.env.BASE_URL`.
 * Подробно — в уроке «GitHub Pages», раздел про базовый путь.
 *
 * Трогаем только пути от корня: якорь `#s3`, протокол-относительный `//cdn…` и полные адреса
 * остаются как есть.
 */
export function withBase(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//')) return path;
  const base = (import.meta.env.BASE_URL ?? '/').replace(/\/+$/, '');
  return base + path;
}
