import { describe, expect, it } from 'vitest';
import { inlineMd, plainMd, topics } from '@/shared/lib/format';

/**
 * Строчная разметка — шов, через который проходит почти весь текст курса: заголовки, лиды,
 * ячейки таблиц, подписи демо. Ошибка здесь не падает, а тихо доезжает до читателя.
 *
 * Отдельно проверяется, что ссылка ведёт только внутрь сайта: текст приходит из `data.ts`
 * и frontmatter, а вставляется как HTML.
 */
describe('inlineMd', () => {
  it('разбирает код и жирный', () => {
    expect(inlineMd('вызов `then` и **важное**')).toBe(
      'вызов <code>then</code> и <b>важное</b>',
    );
  });

  it('экранирует HTML раньше своей разметки', () => {
    expect(inlineMd('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
  });

  it('делает ссылку на соседнюю тему', () => {
    expect(inlineMd('см. [event loop](/js/event-loop/)')).toBe(
      'см. <a href="/js/event-loop/">event loop</a>',
    );
  });

  it('внутри текста ссылки работают обе остальные метки', () => {
    expect(inlineMd('[тема про `Promise`](/js/promise-internals/)')).toBe(
      '<a href="/js/promise-internals/">тема про <code>Promise</code></a>',
    );
  });

  it('не пускает наружу сайта и в опасные схемы', () => {
    for (const href of ['https://example.com', 'javascript:alert(1)', 'data:text/html,x']) {
      const out = inlineMd(`[текст](${href})`);
      expect(out, `адрес ${href} не должен становиться ссылкой`).not.toContain('<a ');
    }
  });
});

describe('plainMd', () => {
  it('снимает всю разметку, оставляя слова', () => {
    expect(plainMd('`then` и **важное** — см. [тему](/js/event-loop/)')).toBe(
      'then и важное — см. тему',
    );
  });
});

describe('topics', () => {
  it('склоняет по русскому правилу, включая одиннадцать-четырнадцать', () => {
    expect([1, 2, 4, 5, 11, 12, 14, 21, 22, 25].map(topics)).toEqual([
      '1 тема',
      '2 темы',
      '4 темы',
      '5 тем',
      '11 тем',
      '12 тем',
      '14 тем',
      '21 тема',
      '22 темы',
      '25 тем',
    ]);
  });
});
