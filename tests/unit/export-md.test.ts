import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import { toMarkdown } from '@/features/export-md/lib/to-markdown';

/** Тема в Markdown: то, что видит читатель, — заголовки, проза, таблицы, примеры с языком. */
function md(html: string): string {
  const win = new Window({ url: 'https://example.test/lesson/js/closures/' });
  win.document.body.innerHTML = `<div class="container">${html}</div>`;
  return toMarkdown(win.document.querySelector('.container') as unknown as Element, 'https://example.test/lesson/js/closures/');
}

describe('toMarkdown', () => {
  it('заголовки, проза со строчной разметкой и полные адреса ссылок', () => {
    const out = md(`
      <h1>Замыкания</h1>
      <section><div class="t-eyebrow">Раздел 1</div><h2>Окружение</h2>
        <p>Функция <code>makeCounter</code> держит <b>своё</b> окружение — <a href="/js/memory-gc/#s2"><span>Память</span> <span>и</span> <span>GC</span></a>.</p>
      </section>`);
    expect(out).toContain('# Замыкания\n\n## Окружение');
    expect(out).toContain('Функция `makeCounter` держит **своё** окружение — [Память и GC](https://example.test/js/memory-gc/#s2).');
    expect(out, 'надзаголовок «Раздел N» — устройство страницы, не текст').not.toContain('Раздел 1');
  });

  it('пример кода — fenced-блок с языком, вывод — без языка', () => {
    const out = md(`<pre data-lang="js"><span style="color:var(--code-keyword)">let</span> x = 1;\n</pre><pre data-lang="text">1</pre><pre data-lang="yaml">a: 1</pre>`);
    expect(out).toContain('```js\nlet x = 1;\n```');
    expect(out).toContain('```\n1\n```');
    expect(out).toContain('```yaml\na: 1\n```');
  });

  it('таблица и списки', () => {
    const out = md(`<table><tr><th>движок</th><th>текст</th></tr><tr><td>V8</td><td><code>a|b</code></td></tr></table>
      <ul><li>раз<ul><li>вложенный</li></ul></li><li>два</li></ul><ol><li>первый</li><li>второй</li></ol>`);
    expect(out).toContain('| движок | текст |\n| --- | --- |\n| V8 | `a\\|b` |');
    expect(out).toContain('- раз\n  - вложенный\n- два');
    expect(out).toContain('1. первый\n2. второй');
  });

  it('острова, кнопки и навигация в файл не попадают', () => {
    const out = md(`<nav>1 · Окружение</nav><p>текст</p><astro-island><pre>демо</pre></astro-island><button>Шаг →</button>`);
    expect(out).toContain('текст');
    expect(out).not.toMatch(/демо|Шаг|Окружение/);
  });
});
