import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { PAGES } from './pages';

/**
 * Сторож автосписка страниц.
 *
 * `pages.ts` больше не ведётся руками — он собирается обходом контента. У этого приёма есть
 * своя опасность, и она хуже забытой строчки: если обход однажды ничего не найдёт (переименовали
 * каталог, сменилась структура коллекций), Playwright честно отрапортует «0 failed», и все
 * решат, что курс проверен. Пустой прогон выглядит точно так же, как успешный.
 *
 * Поэтому здесь сверяются два множества: что собралось в `dist` и что попало в список проверок.
 * Урок, который построился, но в список не попал, — это и есть та самая страница, которая
 * уезжает мимо палитры, раскладки и разметки.
 *
 * Страницы-списки курсов сюда не входят: курс может существовать раньше своих уроков (папка
 * есть, уроки ещё пишутся), и требовать их совпадения значило бы краснеть на пустом месте.
 */
const DIST = new URL('../../dist/', import.meta.url);

/**
 * Куда ведёт страница-редирект, или `null`, если это обычная страница.
 *
 * Темы, переехавшие между направлениями, оставляют на старом адресе редирект (`redirects`
 * в `astro.config.mjs`). В `dist` он лежит так же, как урок, — `<курс>/<урок>/index.html`, —
 * но это не урок, и проверять его палитрой и раскладкой нечего.
 */
function redirectTarget(file: URL): string | null {
  const html = readFileSync(file, 'utf8');
  return html.match(/http-equiv="refresh"[^>]*url=([^"]+)"/)?.[1] ?? null;
}

/** Построенные страницы: `dist/<курс>/<урок>/index.html`, редиректы — отдельно. */
function builtPages(): { lessons: string[]; redirects: Map<string, string> } {
  const lessons: string[] = [];
  const redirects = new Map<string, string>();
  if (!existsSync(DIST)) return { lessons, redirects };

  for (const course of readdirSync(DIST, { withFileTypes: true })) {
    if (!course.isDirectory() || course.name === '_astro') continue;
    const courseDir = new URL(`${course.name}/`, DIST);

    for (const lesson of readdirSync(courseDir, { withFileTypes: true })) {
      if (!lesson.isDirectory()) continue;
      const file = new URL(`${lesson.name}/index.html`, courseDir);
      if (!existsSync(file)) continue;
      const page = `/${course.name}/${lesson.name}/`;
      const target = redirectTarget(file);
      if (target) redirects.set(page, target);
      else lessons.push(page);
    }
  }

  return { lessons: lessons.sort(), redirects };
}

const builtLessonPages = () => builtPages().lessons;

test('список проверяемых страниц не пуст', () => {
  // Нижняя граница намеренно грубая: она ловит не «мало уроков», а «обход сломался».
  expect(PAGES.length, `в списке всего ${PAGES.length} страниц — похоже, обход контента сломался`)
    .toBeGreaterThan(5);
});

test('каждый собранный урок попал в список проверок', () => {
  const built = builtLessonPages();
  expect(built.length, 'в dist нет ни одной страницы урока — сборка не выполнялась?').toBeGreaterThan(0);

  const missing = built.filter((page) => !PAGES.includes(page));
  expect(
    missing,
    `урок собрался, но не проверяется — он уедет мимо палитры, раскладки и разметки: ${missing.join(', ')}`,
  ).toEqual([]);
});

test('в списке нет страниц, которых не существует', () => {
  const built = new Set(builtLessonPages());
  const lessonPages = PAGES.filter((page) => page.split('/').filter(Boolean).length === 2);

  const stray = lessonPages.filter((page) => !built.has(page));
  expect(stray, `страница есть в списке, но не собралась: ${stray.join(', ')}`).toEqual([]);
});

test('старый адрес переехавшей темы ведёт на собранную тему', () => {
  const { lessons, redirects } = builtPages();
  const built = new Set(lessons);

  const dangling = [...redirects].filter(([, target]) => !built.has(target));
  expect(dangling, `редирект ведёт в никуда: ${dangling.map(([a, b]) => `${a} → ${b}`).join(', ')}`).toEqual([]);
});
