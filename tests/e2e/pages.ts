import { existsSync, readdirSync } from 'node:fs';

/**
 * Все страницы сайта — один список на все проверки, и он собирается сам.
 *
 * Раньше список вёлся руками, и каждый новый урок нужно было вписать в три места: так урок
 * про строки едва не уехал мимо проверки палитры. Теперь список строится обходом контента,
 * и новый урок попадает под все проверки в тот момент, когда появляется его папка.
 *
 * Почему с диска, а не из `astro:content`: спеки Playwright читаются в обычном Node, где
 * виртуального модуля `astro:content` не существует. Диск с контентом доступен всегда.
 *
 * ⚠️ Главная опасность такого приёма — **молчаливый ноль**: если обход ничего не найдёт
 * (переименовали каталог, сменили структуру), Playwright отрапортует «0 failed», и все решат,
 * что всё зелёное. Поэтому пустой результат — это ошибка, а не пустой список; плюс рядом
 * стоит сторож `routes.spec.ts`, сверяющий этот список с тем, что реально собралось в `dist`.
 */
interface DirectionDir {
  /** Каталог коллекции в `src/content`. */
  dir: string;
  /** Префикс адреса урока; он же адрес списка уроков направления. */
  base: string;
}

const DIRECTIONS: DirectionDir[] = [
  { dir: 'lessons', base: '/js/' },
  { dir: 'render', base: '/render/' },
  { dir: 'frameworks', base: '/frameworks/' },
  { dir: 'platform', base: '/platform/' },
  { dir: 'tooling', base: '/tooling/' },
  { dir: 'delivery', base: '/delivery/' },
  { dir: 'algorithms', base: '/algorithms/' },
  { dir: 'data', base: '/data/' },
  { dir: 'patterns', base: '/patterns/' },
];

/** Урок — это папка с `index.mdx` внутри; так же его находит и загрузчик коллекции. */
function lessonSlugs(dir: string): string[] {
  const root = new URL(`../../src/content/${dir}/`, import.meta.url);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(new URL(`${entry.name}/index.mdx`, root)))
    .map((entry) => entry.name)
    .sort();
}

function collect(): string[] {
  // Главная и обе витрины стоят в списке всегда: они есть независимо от контента.
  //
  // ⚠️ Витрин две, и вторая сама сюда не попадёт: обход собирает только уроки, а страницы
  // автора перечислены руками. Забыть её — значит молча вывести из-под всех проверок сразу
  // шестнадцать вычисляющих демо; `routes.spec.ts` такое не поймает, он сверяет список
  // с `dist`, а не `dist` со списком.
  const pages = new Set<string>(['/', '/kit/', '/kit/labs/']);

  for (const direction of DIRECTIONS) {
    const slugs = lessonSlugs(direction.dir);
    if (!slugs.length) continue; // направление ещё пишется — страницы списка у него тоже нет
    pages.add(direction.base);
    for (const slug of slugs) pages.add(`${direction.base}${slug}/`);
  }

  return [...pages];
}

export const PAGES = collect();

if (PAGES.length < 5) {
  throw new Error(
    `Список страниц собрался подозрительно коротким (${PAGES.length}). ` +
      'Похоже, обход контента ничего не нашёл — проверьте структуру src/content.',
  );
}
