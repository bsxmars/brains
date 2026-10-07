import type { Css, StackingApi, StackNode } from './types';

/**
 * Демо и тест спрашивают одну и ту же функцию — строку `STACKING_CODE` из темы
 * «Контекст наложения, z-index и верхний слой».
 *
 * Строка напечатана на странице, собрана здесь `new Function` и сверяется
 * `tests/unit/stacking.test.ts` с настоящим Chromium: дерево раскладывается `layoutTree`
 * так, что все блоки накрывают одну точку, и `document.elementsFromPoint` в этой точке
 * отдаёт порядок отрисовки сверху вниз. Копии нет — разойдётся показанный код с браузером,
 * покраснеет тест.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadStacking(code: string): StackingApi {
  return new Function(`${code}\nreturn { contextReason, paintOrder };`)() as StackingApi;
}

/**
 * Стиль корня сцены — в демо это рамка сцены, в тесте `body`. `flow-root` не даёт отступу
 * первого блока схлопнуться с корнем, нулевой шрифт убирает высоту строки с `inline-block`
 * у самого корня: без него следующий блок уезжал вниз на высоту строки (поймано тестом на
 * случайном дереве «`inline-block`, затем grid»).
 */
export const STAGE_STYLE: Css = { display: 'flow-root', 'font-size': '0', 'line-height': '0' };

/** Размер блока, сдвиг соседа и рамка — в пикселях. */
export const GEOMETRY = { size: 150, step: 18, border: 2 };

/**
 * Геометрия, при которой все блоки дерева перекрывают одну точку, — одинаковая в демо и тесте.
 *
 * Каждый блок квадратный, а k-й по порядку в дереве сдвинут на `k × step` вправо и вниз
 * от угла сцены. Сдвиг даёт отступ слева и сверху, а отрицательный отступ справа и снизу
 * обнуляет место, которое блок занимает в потоке: следующий сосед начинается с того же
 * места, float — у того же края, `inline-block` — в той же строке. Поэтому сдвиг одинаков
 * для блока, float, строчного, flex-элемента и `absolute`/`fixed` без `top`/`left`
 * (они встают на своё место в потоке). Детей grid-контейнера `grid-area: 1 / 1` кладёт в одну
 * ячейку: без этого каждый встаёт в свою строку сетки и уезжает вниз. Рамка у каждого блока не даёт отступам родителя
 * и ребёнка схлопнуться; сам корень сцены — `display: flow-root` по той же причине.
 *
 * `font-size: 0` и `line-height: 0` убирают высоту строки: иначе строка с `inline-block`
 * сдвигала бы следующие блоки вниз. То же нужно корню сцены — `STAGE_STYLE`.
 */
export function layoutTree(tree: StackNode[], g = GEOMETRY): { styles: Record<string, Css>; probe: number } {
  const styles: Record<string, Css> = {};
  let k = 0;
  let last = 0;
  const walk = (list: StackNode[], origin: number) => {
    for (const n of list) {
      const offset = k++ * g.step;
      last = offset;
      const m = offset - origin;
      const back = -(g.size + m);
      styles[n.id] = {
        'box-sizing': 'border-box',
        width: `${g.size}px`,
        height: `${g.size}px`,
        'border-width': `${g.border}px`,
        'border-style': 'solid',
        margin: `${m}px ${back}px ${back}px ${m}px`,
        'vertical-align': 'top',
        flex: 'none',
        'align-self': 'flex-start',
        'grid-area': '1 / 1',
        'font-size': '0',
        'line-height': '0',
      };
      walk(n.kids ?? [], offset + g.border);
    }
  };
  walk(tree, 0);
  return { styles, probe: Math.min(last + 36, g.size - 6) };
}

/** `{ a: '1' }` → `a:1` — для атрибута `style` и HTML теста. */
export function cssText(css: Css): string {
  return Object.entries(css)
    .map(([k, v]) => `${k}:${v}`)
    .join(';');
}

export function countNodes(tree: StackNode[]): number {
  return tree.reduce((n, el) => n + 1 + countNodes(el.kids ?? []), 0);
}
