import { describe, expect, it } from 'vitest';
import { inlineMd, plainMd, splitLinkWordsInHtml, topics } from '@/shared/lib/format';

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
      'см. <a class="words" href="/js/event-loop/"><span>event</span> <span>loop</span></a>',
    );
  });

  it('внутри текста ссылки работают обе остальные метки', () => {
    expect(inlineMd('[тема про `Promise`](/js/promise-internals/)')).toBe(
      '<a class="words" href="/js/promise-internals/"><span>тема</span> <span>про</span> <span><code>Promise</code></span></a>',
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

describe('splitLinkWordsInHtml: ссылки прозы на готовой странице', () => {
  it('режет ссылку без класса по словам, вместе с переводом строки из MDX', () => {
    expect(splitLinkWordsInHtml('в <a href="/js/x/#s3">«Промис изнутри»,\n раздел</a>.')).toBe(
      'в <a class="words" href="/js/x/#s3"><span>«Промис</span> <span>изнутри»,</span> <span>раздел</span></a>.',
    );
  });

  it('не трогает ссылки с классом, из одного слова и внутри острова', () => {
    const html =
      '<a class="nav" href="/a">два слова</a><a href="/b">одно</a>' +
      '<astro-island uid="1"><a href="/c">в острове</a></astro-island>';
    expect(splitLinkWordsInHtml(html)).toBe(html);
  });
});
