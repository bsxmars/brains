import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as data from '@/content/render/browser-extensions/data';
import {
  alignByTag,
  diffTrees,
  extraAttributes,
  isExtensionUrl,
  type AuditNode,
} from '@/widgets/ext-dom-audit/model/tree';

/**
 * «Расширения браузера и изолированные миры».
 *
 * Изолированный мир в Node не воспроизвести: его создаёт браузер для установленного
 * расширения. Поэтому тест делится на три части по тому, что здесь вообще проверяемо.
 *
 * 1. **Код, который тема печатает, исполняется.** Манифест разбирается как JSON и обязан
 *    описывать то, о чём говорит текст; функция приёма сообщений исполняется ровно той
 *    строкой, которую видит читатель (`new Function`), на поддельных событиях.
 * 2. **Логика живого демо.** Сверка деревьев `widgets/ext-dom-audit/model/tree.ts` — та же,
 *    что работает во вкладке читателя; здесь она гоняется на деревьях из объектов.
 *    Сторона с DOM (`model/dom.ts`) проверена стендом в Chromium: ноль находок на шести
 *    собранных темах без расширения, четыре узла, атрибут и адрес — с учебным расширением.
 * 3. **Снятые на стенде таблицы — структура и согласованность с прозой.** Сами значения
 *    сняты в Chromium 153 (шапка `data.ts`), и повторить их можно только там. Тест держит
 *    то, что ломается молча при правке: число проб против «из шести проб» в тексте, «тот же /
 *    новый» `bootId` против вывода о сне, адреса ссылок против существующих разделов.
 */

const el = (tag: string, children: AuditNode[] = [], extra: Partial<AuditNode> = {}): AuditNode => ({
  tag,
  children,
  label: tag,
  ...extra,
});

describe('манифест из темы', () => {
  const manifest = JSON.parse(data.MANIFEST_CODE) as {
    manifest_version: number;
    background: { service_worker: string };
    permissions: string[];
    host_permissions: string[];
    content_scripts: { matches: string[]; js: string[]; world?: string; run_at?: string }[];
  };

  it('это MV3 с воркером фона', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.background.service_worker).toMatch(/\.js$/);
  });

  it('два контент-скрипта: изолированный и в мире страницы', () => {
    const worlds = manifest.content_scripts.map((cs) => cs.world ?? 'ISOLATED');
    expect(worlds).toContain('ISOLATED');
    expect(worlds).toContain('MAIN');
    // MAIN-скрипт темы — тот, что исполняется раньше страницы (раздел про world: 'MAIN').
    expect(manifest.content_scripts.find((cs) => cs.world === 'MAIN')?.run_at).toBe('document_start');
  });

  it('в примере нет webRequestBlocking — тема показывает, что в MV3 его молча выбрасывают', () => {
    expect(manifest.permissions).not.toContain('webRequestBlocking');
    expect(manifest.permissions).toContain('declarativeNetRequest');
  });
});

describe('приём сообщений страницы — та самая строка из темы', () => {
  const accept = new Function(`${data.LISTEN_CODE}; return accept;`)() as (
    event: { source: unknown; data: unknown },
    win: unknown,
  ) => { text: string } | null;
  const win = { name: 'top' };
  const frame = { name: 'frame' };

  it('своё окно, ожидаемый тип — проходит только с ожидаемыми полями', () => {
    const got = accept({ source: win, data: { type: 'lesson-probe:v1', text: 'hi', extra: 'drop me' } }, win);
    expect(got).toEqual({ text: 'hi' });
  });

  it('фрейм и чужое окно отсекаются по source', () => {
    expect(accept({ source: frame, data: { type: 'lesson-probe:v1', text: 'hi' } }, win)).toBeNull();
    expect(accept({ source: null, data: { type: 'lesson-probe:v1', text: 'hi' } }, win)).toBeNull();
  });

  it('чужой тип, не строка и слишком длинное — отсекаются по форме', () => {
    expect(accept({ source: win, data: { type: 'other', text: 'hi' } }, win)).toBeNull();
    expect(accept({ source: win, data: { type: 'lesson-probe:v1', text: 42 } }, win)).toBeNull();
    expect(accept({ source: win, data: { type: 'lesson-probe:v1', text: 'x'.repeat(2001) } }, win)).toBeNull();
    expect(accept({ source: win, data: null }, win)).toBeNull();
  });
});

describe('состояние фона — та самая строка из темы', () => {
  // Перезапуск воркера здесь — повторное исполнение модуля с новыми переменными и тем же
  // хранилищем: ровно это стенд увидел после 45 с тишины (новый bootId, kept-session).
  type Listener = (msg: unknown, sender: unknown, reply: (v: unknown) => void) => unknown;
  const session = new Map<string, unknown>();
  const boot = () => {
    const listeners: Listener[] = [];
    const chrome = {
      runtime: { onMessage: { addListener: (fn: Listener) => listeners.push(fn) } },
      storage: {
        session: {
          get: async (key: string) => (session.has(key) ? { [key]: session.get(key) } : {}),
          set: async (items: Record<string, unknown>) => {
            for (const [k, v] of Object.entries(items)) session.set(k, v);
          },
        },
      },
    };
    const readGlobal = new Function('chrome', `${data.STATE_CODE}\nreturn () => seen;`)(chrome) as () => number;
    const send = () =>
      new Promise<unknown[]>((resolve) => {
        const replies: unknown[] = [];
        for (const fn of listeners) fn({}, {}, (v) => replies.push(v));
        setTimeout(() => resolve(replies), 0);
      });
    return { readGlobal, send };
  };

  it('переменная обнуляется при перезапуске, storage.session — нет', async () => {
    const first = boot();
    await first.send();
    await first.send();
    expect(first.readGlobal()).toBe(2);
    expect(await first.send()).toEqual([3]);

    const restarted = boot();
    expect(restarted.readGlobal(), 'глобальная переменная начинается с нуля').toBe(0);
    expect(await restarted.send(), 'счётчик в хранилище продолжается').toEqual([4]);
  });
});

describe('сверка деревьев живого демо', () => {
  const page = () =>
    el('html', [
      el('head', [el('meta'), el('link', [], { sameOriginUrl: true })]),
      el('body', [el('header'), el('main', [el('section'), el('astro-island', [], { opaque: true }), el('section')]), el('footer')]),
    ]);

  it('совпадающие деревья — ни одной находки', () => {
    expect(diffTrees(page(), page())).toEqual([]);
  });

  it('узел в конце body — одна находка «вставлен»', () => {
    const live = page();
    live.children[1].children.push(el('div', [], { label: 'div.probe-ext-badge' }));
    expect(diffTrees(page(), live)).toEqual([{ kind: 'inserted', where: 'html > body', what: 'div.probe-ext-badge' }]);
  });

  it('узел в середине не сдвигает хвост: находка одна, соседи на месте', () => {
    // Позиционная сверка (так сверяет гидратация Vue) сочла бы разошедшимися всех соседей справа.
    const live = page();
    live.children[1].children[1].children.splice(1, 0, el('grammarly-extension'));
    expect(diffTrees(page(), live)).toEqual([
      { kind: 'inserted', where: 'html > body > main', what: 'grammarly-extension' },
    ]);
  });

  it('смена атрибутов и классов не находка: сверка идёт по тегам', () => {
    const live = page();
    live.children[1].children[0].label = 'header.is-sticky';
    expect(diffTrees(page(), live)).toEqual([]);
  });

  it('внутрь острова сверка не спускается — там хозяйничает гидратация', () => {
    const live = page();
    live.children[1].children[1].children[1].children.push(el('div'), el('span'));
    expect(diffTrees(page(), live)).toEqual([]);
  });

  it('в head свой адрес прощается (чанки сборщика), чужой и встроенный — нет', () => {
    const live = page();
    live.children[0].children.push(
      el('link', [], { sameOriginUrl: true, label: 'link' }),
      el('style', [], { label: 'style' }),
      el('link', [], { sameOriginUrl: false, label: 'link.ext' }),
    );
    expect(diffTrees(page(), live).map((f) => f.what)).toEqual(['style', 'link.ext']);
  });

  it('удалённый узел — находка «удалён»', () => {
    const live = page();
    live.children[1].children.pop();
    expect(diffTrees(page(), live)).toEqual([{ kind: 'removed', where: 'html > body', what: 'footer' }]);
  });

  it('выравнивание — наибольшая общая подпоследовательность, а не жадный проход', () => {
    const a = ['p', 'div', 'p'].map((t) => el(t));
    const b = ['div', 'p', 'div', 'p'].map((t) => el(t));
    expect(alignByTag(a, b)).toHaveLength(3);
  });

  it('лишние атрибуты html/body и адреса расширений', () => {
    expect(extraAttributes(['<html> lang', '<html> style'], ['<html> lang', '<html> style', '<html> data-cs'])).toEqual([
      '<html> data-cs',
    ]);
    expect(isExtensionUrl('chrome-extension://abc/ext.css')).toBe(true);
    expect(isExtensionUrl(' MOZ-EXTENSION://x/y')).toBe(true);
    expect(isExtensionUrl('https://example.com/chrome-extension://')).toBe(false);
  });
});

describe('снятые таблицы: структура и согласие с текстом', () => {
  it('матрица миров: четыре колонки на каждую строку, тоны из словаря', () => {
    expect(data.WORLD_HEAD).toHaveLength(5);
    for (const row of data.WORLD_ROWS) {
      expect(row.cells, row.q).toHaveLength(4);
      for (const cell of row.cells) expect(['ok', 'err', 'warn', 'dim']).toContain(cell.tone);
    }
  });

  it('ядро темы в матрице: подмену прототипа видит MAIN, не видит изолированный мир', () => {
    const push = data.WORLD_ROWS.find((r) => r.q.includes('Array.prototype.push'));
    expect(push?.cells[1].tone).toBe('err');
    expect(push?.cells[2].tone).toBe('ok');
    const attr = data.WORLD_ROWS.find((r) => r.q.includes('data-page-attr'));
    expect(attr?.cells[1].tone, 'атрибут — часть узла, DOM общий').toBe('ok');
  });

  it('сон фона: после 20 с bootId тот же, после 45 с — новый; хранилища пережили оба', () => {
    const ids = (cell: string) => [...cell.matchAll(/`([a-z0-9]{6})`/g)].map((m) => m[1]);
    const [short, long] = data.SLEEP_ROWS;
    const [a, b] = ids(short[1]);
    const [c, d] = ids(long[1]);
    expect(a).toBe(b);
    expect(c).not.toBe(d);
    expect(long[3]).toContain('null');
    for (const row of data.SLEEP_ROWS) {
      expect(row[4]).toContain('kept-session');
      expect(row[5]).toContain('kept-local');
    }
    expect(data.SLEEP_NOTE).toContain('30 секунд');
  });

  it('«из шести проб» в выводе про CSP — ровно столько строк в таблице', () => {
    // Подстрока смысловая: вывод говорит, сколько проб страница не заметила. Добавили пробу —
    // поправьте и число в CSP_NOTE.
    const words: Record<number, string> = { 5: 'пяти', 6: 'шести', 7: 'семи' };
    expect(data.CSP_NOTE).toContain(`из ${words[data.CSP_ROWS.length]} проб`);
  });

  it('тонкие места пронумерованы подряд', () => {
    expect(data.PITFALLS.map((p) => p.n)).toEqual(
      data.PITFALLS.map((_, i) => String(i + 1).padStart(2, '0')),
    );
  });

  it('каждая ссылка на сайт ведёт в существующий раздел существующей темы', () => {
    const collections: Record<string, string> = { js: 'lessons', render: 'render', frameworks: 'frameworks', platform: 'platform', tooling: 'tooling', delivery: 'delivery', algorithms: 'algorithms', data: 'data', patterns: 'patterns' };
    const text = JSON.stringify(data) + readFileSync(new URL('../../src/content/render/browser-extensions/index.mdx', import.meta.url), 'utf8');
    const links = [...text.matchAll(/\]\((\/(js|render|frameworks|platform|tooling|delivery|algorithms|data|patterns)\/([a-z0-9-]+)\/(?:#(s\d+))?)\)/g)];
    expect(links.length).toBeGreaterThan(5);
    for (const [, href, dir, slug, anchor] of links) {
      const mdx = new URL(`../../src/content/${collections[dir]}/${slug}/index.mdx`, import.meta.url);
      expect(existsSync(mdx), `${href}: темы нет`).toBe(true);
      if (anchor) expect(readFileSync(mdx, 'utf8'), `${href}: раздела нет`).toMatch(new RegExp(`id="${anchor}"`));
    }
  });

  it('тема не ссылается на себя номером раздела', () => {
    const text = JSON.stringify(data);
    expect(text).not.toMatch(/[Рр]аздел[а-я]*\s+\d/);
  });
});
