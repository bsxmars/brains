import { expect, test } from '@playwright/test';
import { PAGES } from './pages';

const MIN_TOPICS = { render: 20, frameworks: 20, platform: 20, tooling: 17, delivery: 20, algorithms: 10, data: 4, patterns: 5 };
const DIRECTIONS = Object.keys(MIN_TOPICS) as (keyof typeof MIN_TOPICS)[];
const EXTRA_TOPICS = ['/js/browser-architecture/', '/js/wasm-threads/'];
const TOPICS = PAGES.filter((path) => EXTRA_TOPICS.includes(path)
  || DIRECTIONS.some((direction) => path.startsWith(`/${direction}/`) && path.split('/').filter(Boolean).length === 2));
for (const path of EXTRA_TOPICS) {
  if (!TOPICS.includes(path)) throw new Error(`Обход не нашёл тему ${path}`);
}

for (const direction of DIRECTIONS) {
  if (TOPICS.filter((path) => path.startsWith(`/${direction}/`)).length < MIN_TOPICS[direction]) {
    throw new Error(`Обход не нашёл темы направления ${direction}`);
  }
}

/**
 * Размеры узлов ConceptDiagram заданы в данных: сборка видит координаты, но не знает,
 * сколько строк займёт русский текст после загрузки шрифта. Проверяем готовую картинку,
 * включая раскрываемые подробности: длинная подпись не должна обрезаться внутри узла,
 * а SVG-подпись — выходить за полотно. Узкий экран прокручивает схему, сохраняя её кегль.
 */
for (const width of [1280, 375]) {
  for (const path of TOPICS) {
    test(`инфографика: ${path} при ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path);
      await page.evaluate(async () => {
        for (const details of document.querySelectorAll('details')) details.open = true;
        await document.fonts.ready;
      });

      const figures = page.locator('[data-concept-diagram], [data-render-illustration]');
      expect(await figures.count(), `${path}: предметная иллюстрация не отрисована`).toBeGreaterThan(0);
      for (const picture of await figures.locator('img').all()) {
        await picture.scrollIntoViewIfNeeded();
        await expect.poll(() => picture.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0),
          { message: `${path}: файл иллюстрации не загрузился` }).toBe(true);
        await expect(picture).toHaveAttribute('alt', /\S/);
      }

      const clipped = await figures.evaluateAll((items) => {
        const problems: string[] = [];
        for (const figure of items) {
          const name = figure.getAttribute('data-concept-diagram')
            ?? figure.getAttribute('data-render-illustration');

          for (const node of figure.querySelectorAll<HTMLElement>('.cd-node')) {
            if (node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1) {
              problems.push(`${name}: обрезан узел «${node.textContent?.trim()}»`);
            }
          }

          for (const svg of figure.querySelectorAll<SVGSVGElement>('svg')) {
            if (svg.getAttribute('aria-hidden') === 'true') continue;
            const labelledBy = svg.getAttribute('aria-labelledby')?.split(/\s+/) ?? [];
            const accessibleName = svg.getAttribute('aria-label')
              || labelledBy.map((id) => document.getElementById(id)?.textContent).join(' ').trim()
              || svg.querySelector('title')?.textContent;
            if (svg.getAttribute('role') === 'img' && !accessibleName) {
              problems.push(`${name}: у SVG нет доступного названия`);
            }
            const canvas = svg.getBoundingClientRect();
            for (const label of svg.querySelectorAll('text')) {
              const box = label.getBoundingClientRect();
              if (box.width === 0 || box.height === 0) continue;
              if (box.left < canvas.left - 1 || box.right > canvas.right + 1
                || box.top < canvas.top - 1 || box.bottom > canvas.bottom + 1) {
                problems.push(`${name}: подпись за полотном «${label.textContent?.trim()}»`);
              }
              if (label.classList.contains('cd-edge-label')) {
                for (const node of svg.querySelectorAll('.cd-node')) {
                  const bounds = node.getBoundingClientRect();
                  if (box.right > bounds.left + 1 && box.left < bounds.right - 1
                    && box.bottom > bounds.top + 1 && box.top < bounds.bottom - 1) {
                    problems.push(`${name}: подпись стрелки «${label.textContent?.trim()}» скрыта узлом «${node.querySelector('.cd-node-label')?.textContent?.trim()}»`);
                  }
                }
              }
            }
          }
        }
        return problems;
      });

      expect(clipped, `${path}: текст картинки не помещается`).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth),
        `${path}: картинка растянула страницу`).toBeLessThanOrEqual(width + 1);
    });
  }
}
