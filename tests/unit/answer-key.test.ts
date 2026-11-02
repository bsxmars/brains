import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getAnswerKey, parseAnswerKey } from '@/entities/lesson/model/summary';

/**
 * Саммари темы читается из `summary.md` своим разбором, а не markdown-процессором. Разбор держится
 * на шаблоне файла, и тихо он ломается одним способом: блок не нашёлся — и на странице
 * вместо четырёх разделов три, без ошибки сборки. Поэтому проверяем каждый файл курса.
 */
const ROOT = new URL('../../src/content/', import.meta.url);
const TITLES = ['Ядро', 'Карта', 'Подвох', 'Детали'];

const summaries = readdirSync(ROOT, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .flatMap((col) =>
    readdirSync(new URL(`${col.name}/`, ROOT), { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(new URL(`${col.name}/${d.name}/summary.md`, ROOT)))
      .map((d) => ({ collection: col.name, id: d.name })),
  );

describe('саммари тем', () => {
  it('файлы есть', () => {
    expect(summaries.length).toBeGreaterThan(0);
  });

  for (const { collection, id } of summaries) {
    it(`${collection}/${id}: четыре блока по шаблону, в каждом есть пункты`, () => {
      const key = getAnswerKey(collection, id);
      expect(key, 'import.meta.glob не нашёл файл').toBeDefined();
      expect(key!.blocks.map((b) => b.title)).toEqual(TITLES);
      for (const block of key!.blocks) expect(block.items.length, block.title).toBeGreaterThan(0);
    });
  }

  it('шаги «Как работает» уходят во вложенный список, заглушка проекта — в undefined', () => {
    const src = readFileSync(new URL('lessons/event-loop/summary.md', ROOT), 'utf8');
    const fake = [
      '<details>',
      '<summary><b>Ядро</b> — что нужно помнить</summary>',
      '',
      '- **Как работает:**',
      '  1. первый',
      '  2. второй',
      '',
      '</details>',
      '',
      '**Где у нас в проекте:** — *заполнить самому*',
    ].join('\n');
    const key = parseAnswerKey(fake);
    expect(key.blocks[0].items[0].steps).toEqual(['первый', 'второй']);
    expect(key.project).toBeUndefined();
    expect(parseAnswerKey(src).blocks).toHaveLength(4);
  });
});
