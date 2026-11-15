import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getAnswerKey, parseAnswerKey } from '@/entities/lesson/model/summary';

/** Каждая тема обязана иметь открытую короткую выжимку, без прежних скрытых разделов. */
const ROOT = new URL('../../src/content/', import.meta.url);
const topics = readdirSync(ROOT, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .flatMap((col) =>
    readdirSync(new URL(`${col.name}/`, ROOT), { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(new URL(`${col.name}/${d.name}/index.mdx`, ROOT)))
      .map((d) => ({ collection: col.name, id: d.name })),
  );

describe('минимум каждой темы', () => {
  it('обход включает все направления и не оказался пустым', () => {
    expect(topics.length).toBeGreaterThanOrEqual(166);
    expect(new Set(topics.map((topic) => topic.collection)).size).toBe(9);
  });

  for (const { collection, id } of topics) {
    it(`${collection}/${id}: 4–7 главных тезисов без старых разделов`, () => {
      const file = new URL(`${collection}/${id}/summary.md`, ROOT);
      expect(existsSync(file), 'у темы нет summary.md').toBe(true);
      const source = readFileSync(file, 'utf8');
      expect(source).toMatch(/^# \S[^\n]*\n/);
      expect(source).not.toMatch(/<\/?(?:details|summary)\b|^## |Где у нас в проекте|сверяйся|заполнить самому/m);
      const key = getAnswerKey(collection, id);
      expect(key, 'import.meta.glob не нашёл выжимку').toBeDefined();
      expect(key!.items.length).toBeGreaterThanOrEqual(4);
      expect(key!.items.length).toBeLessThanOrEqual(7);
      expect(key!.items.every((item) => item.text.trim().length > 0)).toBe(true);
    });
  }
});

describe('разбор открытой выжимки', () => {
  it('сохраняет строчную разметку и объединяет продолжения тезиса', () => {
    expect(parseAnswerKey('# Тема\n\n- **Механизм:** `value`.\n  Продолжение.\n\n- Граница.\n').items).toEqual([
      { text: '**Механизм:** `value`. Продолжение.', steps: [] },
      { text: 'Граница.', steps: [] },
    ]);
  });

  it('сохраняет последовательность шагов внутри тезиса', () => {
    const key = parseAnswerKey('# Тема\n\n- Порядок работы:\n  1. первый\n  2. второй\n');
    expect(key.items).toEqual([{ text: 'Порядок работы:', steps: ['первый', 'второй'] }]);
  });

  it('не выдаёт пустой заголовок за содержимое', () => {
    expect(parseAnswerKey('# Тема\n').items).toEqual([]);
    expect(getAnswerKey('lessons', 'missing-summary')).toBeUndefined();
  });
});
