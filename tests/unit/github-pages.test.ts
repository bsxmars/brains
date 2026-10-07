import { describe, expect, it } from 'vitest';
import {
  BASES,
  PATH_ROWS,
  PATH_TOTALS,
} from '@/content/delivery/github-pages/data';
import {
  emittedPath,
  jekyllSkips,
  joinBase,
  normalizeBase,
  originOf,
  resolvesOn,
  servedUnder,
  shapeOf,
  tally,
  verdict,
} from '@/widgets/base-path-lab/model/paths';

/**
 * Разбор путей и правило «поедет или не поедет при базе X».
 *
 * Сайт здесь не собирается: две опытные сборки сделаны один раз (Astro 7.3.2, 15 сентября
 * 2026 — обычная и `--base /repo/`), их итоги лежат в `data.ts` темы, а тест сторожит две
 * разные вещи, и обе ломались бы молча:
 *
 *   1) **правила разбора путей** — что считается путём от корня, как склеивается база,
 *      что переживает переезд, а что нет;
 *   2) **согласие описи со снятыми числами** — если завтра кто-нибудь поправит `count`
 *      «на глаз», расхождение всплывёт здесь, а не на странице, где демо молча покажет
 *      неверный итог.
 *
 * Числа сверяются дословно, и это осознанно: в отличие от миллисекунд, количество путей
 * в собранном дереве от железа не зависит. Оно зависит от контента — и когда контент
 * изменится, тест обязан покраснеть, чтобы числа на странице пересняли, а не досочинили.
 */

describe('база в канонической форме', () => {
  it('добавляет слеши с обеих сторон', () => {
    expect(normalizeBase('/repo')).toBe('/repo/');
    expect(normalizeBase('repo')).toBe('/repo/');
    expect(normalizeBase('repo/')).toBe('/repo/');
    expect(normalizeBase('/repo/')).toBe('/repo/');
  });

  it('пустая база и корень — это корень', () => {
    expect(normalizeBase('')).toBe('/');
    expect(normalizeBase('  ')).toBe('/');
    expect(normalizeBase('/')).toBe('/');
  });
});

describe('форма записи пути', () => {
  it('различает четыре вида', () => {
    expect(shapeOf('/_astro/x.css')).toBe('absolute');
    expect(shapeOf('./x.css')).toBe('relative');
    expect(shapeOf('x.css')).toBe('relative');
    expect(shapeOf('#s2')).toBe('anchor');
    expect(shapeOf('https://example.com/x')).toBe('external');
    expect(shapeOf('data:font/woff2;base64,AA')).toBe('external');
  });

  it('адрес без протокола считает внешним', () => {
    // `//cdn.example.com/x` — это другой хост, а вовсе не путь от корня с лишним слешем.
    expect(shapeOf('//cdn.example.com/x')).toBe('external');
  });
});

describe('склейка базы с путём', () => {
  it('не оставляет двойного слеша и не слепляет имена', () => {
    expect(joinBase('/repo/', '/_astro/x.css')).toBe('/repo/_astro/x.css');
    expect(joinBase('/repo', '/_astro/x.css')).toBe('/repo/_astro/x.css');
    expect(joinBase('/', '/_astro/x.css')).toBe('/_astro/x.css');
  });

  it('оставляет в покое всё, что не начинается со слеша', () => {
    expect(joinBase('/repo/', './x.css')).toBe('./x.css');
    expect(joinBase('/repo/', '#s2')).toBe('#s2');
    expect(joinBase('/repo/', 'https://example.com/')).toBe('https://example.com/');
  });
});

describe('отдаст ли хостинг файл по такому пути', () => {
  it('под базой лежит только то, что с неё начинается', () => {
    expect(servedUnder('/repo/_astro/x.css', '/repo/')).toBe(true);
    expect(servedUnder('/_astro/x.css', '/repo/')).toBe(false);
    expect(servedUnder('/js/event-loop/', '/repo/')).toBe(false);
  });

  it('похожее имя каталога за базу не считается', () => {
    // `/repo2/` начинается с «/repo», но сайтом не является.
    expect(servedUnder('/repo2/x.css', '/repo/')).toBe(false);
  });

  it('относительное, якорь и внешнее переезд переживают', () => {
    expect(servedUnder('./x.css', '/repo/')).toBe(true);
    expect(servedUnder('#s2', '/repo/')).toBe(true);
    expect(servedUnder('https://example.com/x', '/repo/')).toBe(true);
  });

  it('в корне от корня ведёт куда надо', () => {
    expect(servedUnder('/js/event-loop/', '/')).toBe(true);
  });
});

describe('что окажется в собранном файле', () => {
  const builder = PATH_ROWS.find((r) => r.id === 'css')!;
  const hand = PATH_ROWS.find((r) => r.id === 'link')!;

  it('свой путь сборщик переписывает', () => {
    expect(emittedPath(builder, '/repo/')).toBe(`/repo/${builder.path.slice(1)}`);
  });

  it('чужой путь доезжает дословно — в этом вся ошибка', () => {
    expect(emittedPath(hand, '/repo/')).toBe(hand.path);
    expect(verdict(hand, '/repo/').ok).toBe(false);
    expect(verdict(hand, '/').ok).toBe(true);
  });
});

describe('опись путей собранного сайта', () => {
  it('в корне не ломается ничего', () => {
    const counts = tally(PATH_ROWS, '/');
    expect(counts.broken).toBe(0);
    expect(counts.ok).toBe(counts.total);
  });

  it('в подкаталоге ломается ровно то, что написано человеком от корня', () => {
    for (const row of PATH_ROWS) {
      const broken = !verdict(row, '/repo/').ok;
      const written = row.author === 'hand' && shapeOf(row.path) === 'absolute';
      expect(broken).toBe(written);
    }
  });

  it('итоги совпадают со снятыми числами', () => {
    const counts = tally(PATH_ROWS, '/repo/');

    // 167 ссылок в разметке плюс один литерал внутри JS-чанка.
    expect(counts.broken).toBe(PATH_TOTALS.fromRoot + PATH_TOTALS.inBundle);
    expect(counts.total).toBe(PATH_TOTALS.markup + PATH_TOTALS.inBundle);

    const rewritten = PATH_ROWS.filter((r) => r.rewritten).reduce((s, r) => s + r.count, 0);
    expect(rewritten).toBe(PATH_TOTALS.rewritten);

    const inMarkup = PATH_ROWS.filter((r) => r.id !== 'bundle').reduce((s, r) => s + r.count, 0);
    expect(inMarkup).toBe(PATH_TOTALS.markup);
  });

  it('переписываемым может быть только путь от корня', () => {
    // Якорь или внешний адрес «переписать под базу» нельзя — такая строка описи была бы
    // ошибкой данных, а не фактом о сборке.
    for (const row of PATH_ROWS) {
      if (row.rewritten) expect(shapeOf(row.path)).toBe('absolute');
    }
  });

  it('у каждой строки описи положительное количество', () => {
    for (const row of PATH_ROWS) expect(row.count).toBeGreaterThan(0);
  });
});

describe('что Jekyll не копирует в опубликованный сайт', () => {
  it('пропускает подчёркивание, точку и решётку', () => {
    // Дословное правило из документации GitHub — и причина, по которой нужен `.nojekyll`.
    expect(jekyllSkips('/_astro/BaseLayout.css')).toBe(true);
    expect(jekyllSkips('/.well-known/x.txt')).toBe(true);
    expect(jekyllSkips('/#draft/x.html')).toBe(true);
    expect(jekyllSkips('/node_modules/a/index.js')).toBe(true);
    expect(jekyllSkips('/vendor/bundle/x')).toBe(true);
  });

  it('обычные страницы этого сайта пропускает мимо себя', () => {
    expect(jekyllSkips('/delivery/compose/index.html')).toBe(false);
    expect(jekyllSkips('/index.html')).toBe(false);
    expect(jekyllSkips('/demo/modules/a-fn.js')).toBe(false);
  });

  it('ловит подчёркивание на любой глубине, а не только в начале пути', () => {
    expect(jekyllSkips('/assets/_partials/x.css')).toBe(true);
  });
});

describe('регистр имени файла', () => {
  it('на машине разработчика прощается, на сервере — нет', () => {
    // Именно этим и опасна ошибка: локально она невидима.
    expect(resolvesOn('Logo.PNG', 'logo.png', 'insensitive')).toBe(true);
    expect(resolvesOn('Logo.PNG', 'logo.png', 'sensitive')).toBe(false);
  });

  it('точное имя работает везде', () => {
    expect(resolvesOn('logo.png', 'logo.png', 'sensitive')).toBe(true);
    expect(resolvesOn('logo.png', 'logo.png', 'insensitive')).toBe(true);
  });
});

describe('подписи вариантов базы', () => {
  it('находят адрес по базе независимо от слешей', () => {
    expect(originOf(BASES, '/repo')).toBe(originOf(BASES, '/repo/'));
    expect(originOf(BASES, '/')).toBeTruthy();
  });

  it('первый вариант — это та база, на которой сайт собран сейчас', () => {
    expect(normalizeBase(BASES[0].value)).toBe('/');
  });
});
