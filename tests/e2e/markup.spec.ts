import { expect, test } from '@playwright/test';
import { PAGES } from './pages';

/**
 * Исходной разметки на странице быть не должно.
 *
 * Тексты уроков наполовину состоят из имён — `Promise.resolve`, `[[Get]]`, `--max-old-space-size`, —
 * и в данных они размечены обратными кавычками. Разбирает эту разметку `inlineMd`, и вызывается
 * он только в строковых пропах компонентов. Отсюда два способа промахнуться, и оба тихие:
 *
 *  - строку из `data.ts` выводят напрямую (`{item.d}` в слоте, `{{ item.d }}` в острове) —
 *    разметка доезжает до читателя вместе со звёздочками и кавычками;
 *  - текст пишут прямо внутри компонента в MDX без пустых строк вокруг: MDX считает такой
 *    текст обычными символами, а не разметкой.
 *
 * Ни сборка, ни типы этого не замечают — страница собирается, текст читается, просто выглядит
 * как черновик. Поэтому проверка смотрит на то, что реально нарисовано.
 *
 * Внутри `<pre>` и `<code>` обратные кавычки законны: там показывают шаблонные строки.
 */
for (const path of PAGES) {
  test(`разметка разобрана: ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(200);

    const stray = await page.evaluate(() => {
      const SKIP = new Set(['PRE', 'CODE', 'SCRIPT', 'STYLE', 'NOSCRIPT']);
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const hits: string[] = [];

      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        let el: HTMLElement | null = node.parentElement;
        let inCode = false;
        while (el) {
          // `data-code` вешают на себя блоки, показывающие код не тегом `<code>`, — листинг
          // демо рисует строки обычными `div`, и кавычки в них принадлежат примеру.
          if (SKIP.has(el.tagName) || el.hasAttribute('data-code')) {
            inCode = true;
            break;
          }
          el = el.parentElement;
        }
        if (inCode) continue;

        const text = node.nodeValue ?? '';
        // Третий шаблон — ссылка на соседнюю тему. Её легко потерять тише остальных:
        // квадратные скобки в тексте выглядят уместнее, чем кавычки и звёздочки, и промах
        // читается как авторская пунктуация, а не как черновик.
        const found = text.match(
          /`[^`]{1,40}`|\*\*[^*]{1,40}\*\*|\[[^\]]{1,60}\]\((?:\/|#)[^)\s]{1,60}\)/,
        );
        if (found) hits.push(`${found[0]} ← «${text.trim().slice(0, 60)}»`);
      }

      return hits.slice(0, 8);
    });

    expect(stray, `на странице видна исходная разметка: ${JSON.stringify(stray, null, 1)}`).toEqual(
      [],
    );
  });
}
