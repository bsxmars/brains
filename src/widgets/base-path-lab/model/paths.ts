import type { BaseOption, PathRow, PathShape, PathVerdict } from './types';

/**
 * Разбор путей и правило «поедет или не поедет при базе X».
 *
 * ── Откуда правило ───────────────────────────────────────────────────────────────────
 *
 * Оно не выведено из документации, а снято с двух сборок этого сайта: одной обычной
 * и одной с `--base /repo/` (Astro 7.3.2, 15 сентября 2026). Обход `dist` показал ровно
 * две группы путей:
 *
 *   • 75 путей сборщик переписал сам — 56 `<link rel="stylesheet">` и 19 адресов шрифтов
 *     внутри `url()` в CSS. Они получили префикс базы и остались рабочими;
 *   • 167 путей остались как были — все до одного `<a href="/…">`, то есть написанные
 *     человеком. Ни один из них после переезда сайта в подкаталог не открывается.
 *
 * Отсюда и вся логика этого файла: судьбу пути решает не его вид и не тип файла, а **кто
 * его написал**. Сборщик знает про базу, автор текста — нет.
 *
 * Функции здесь чистые и сайт не собирают: их сверяет `tests/unit/github-pages.test.ts`.
 */

/**
 * База в канонической форме: со слешем спереди и сзади.
 *
 * Слеши тут не педантизм. `'/repo'` и `'/repo/'` — это разные строки, и склейка через
 * `base + path` даёт то `//` в середине, то слипшееся `/repoassets`. Одно место, где
 * это решается, избавляет от обоих исходов.
 */
export function normalizeBase(base: string): string {
  const trimmed = base.trim();
  if (!trimmed || trimmed === '/') return '/';
  const withLead = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLead.endsWith('/') ? withLead : `${withLead}/`;
}

/** Форма записи пути — то единственное, что решает его судьбу при смене базы. */
export function shapeOf(url: string): PathShape {
  if (url.startsWith('#')) return 'anchor';
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//')) return 'external';
  if (url.startsWith('/')) return 'absolute';
  return 'relative';
}

/** База плюс путь от корня — без `//` в середине и без слипшихся имён. */
export function joinBase(base: string, path: string): string {
  const root = normalizeBase(base);
  if (shapeOf(path) !== 'absolute') return path;
  return `${root}${path.replace(/^\/+/, '')}`;
}

/**
 * Что окажется в файле после сборки с такой базой.
 *
 * Сборщик переписывает только свои пути; чужие доезжают до страницы буквально — и именно
 * это ломает сайт молча, потому что сборка при этом проходит успешно.
 */
export function emittedPath(row: PathRow, base: string): string {
  if (!row.rewritten) return row.path;
  return joinBase(base, row.path);
}

/**
 * Отдаст ли хостинг файл по такому пути, если сайт живёт под базой.
 *
 * Под базой лежат все файлы сайта и больше ничего: путь от корня, не начинающийся с базы,
 * попадает мимо сайта целиком. Относительный путь считается от адреса документа, а документ
 * лежит под базой — поэтому он переезд переживает. Якорь и внешний адрес к базе отношения
 * не имеют вовсе.
 */
export function servedUnder(url: string, base: string): boolean {
  if (shapeOf(url) !== 'absolute') return true;
  return url.startsWith(normalizeBase(base));
}

/** Вердикт по одной строке описи: что окажется в файле и откроется ли оно. */
export function verdict(row: PathRow, base: string): PathVerdict {
  const root = normalizeBase(base);
  const emitted = emittedPath(row, base);
  const ok = servedUnder(emitted, root);
  const shape = shapeOf(row.path);

  let why: string;
  if (shape === 'anchor') why = 'якорь внутри страницы — база его не касается';
  else if (shape === 'external') why = 'адрес за пределами сайта — база его не касается';
  else if (shape === 'relative') why = 'считается от адреса документа, а документ лежит под базой';
  else if (row.rewritten) why = `сборщик подставил базу: ${root}`;
  else if (ok) why = 'путь от корня совпал с корнем сайта — но только пока база равна «/»';
  else why = `путь ведёт мимо сайта: сайт живёт под ${root}, а адрес начинается с «/»`;

  return { row, emitted, ok, why };
}

/** Опись целиком при выбранной базе — в том же порядке, в каком она снята. */
export function verdicts(rows: PathRow[], base: string): PathVerdict[] {
  return rows.map((row) => verdict(row, base));
}

/** Сколько путей уцелело и сколько уехало в 404 — считая каждое вхождение, а не строку описи. */
export function tally(rows: PathRow[], base: string): { ok: number; broken: number; total: number } {
  let ok = 0;
  let broken = 0;
  for (const row of rows) {
    if (verdict(row, base).ok) ok += row.count;
    else broken += row.count;
  }
  return { ok, broken, total: ok + broken };
}

/**
 * Пропустит ли Jekyll этот путь мимо опубликованного сайта.
 *
 * Правило дословно из документации GitHub: Jekyll не собирает файлы и папки, которые лежат
 * в `/node_modules` или `/vendor` либо начинаются с `_`, `.` или `#`. Для сборщика, который
 * складывает ассеты в `_astro/`, это означает ровно одно: без `.nojekyll` опубликованного
 * сайта не будет — будет HTML без единого стиля и скрипта.
 *
 * ⚠️ Сам файл `.nojekyll` тоже начинается с точки — и это не противоречие: он не содержимое
 * сайта, а выключатель, который Pages ищет отдельно.
 */
export function jekyllSkips(path: string): boolean {
  const segments = path.split('/').filter(Boolean);
  if (segments.some((s) => s === 'node_modules' || s === 'vendor')) return true;
  return segments.some((s) => s.startsWith('_') || s.startsWith('.') || s.startsWith('#'));
}

/**
 * Откроется ли файл, если в ссылке ошиблись регистром.
 *
 * Два ответа на один вопрос — в этом вся ловушка: на машине разработчика (APFS, NTFS)
 * файловая система регистр прощает, на сервере Pages (Linux) — нет. Ошибка не видна ровно
 * до публикации, и «у меня работает» здесь означает буквально «у меня другая файловая система».
 */
export function resolvesOn(requested: string, onDisk: string, fs: 'sensitive' | 'insensitive'): boolean {
  return fs === 'sensitive' ? requested === onDisk : requested.toLowerCase() === onDisk.toLowerCase();
}

/** Подпись варианта базы: адрес, по которому сайт при этом открывается. */
export function originOf(bases: BaseOption[], base: string): string {
  return bases.find((b) => normalizeBase(b.value) === normalizeBase(base))?.origin ?? '';
}
