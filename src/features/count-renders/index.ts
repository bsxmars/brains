/**
 * Приборы урока про ре-рендеринг: чем мерить вызовы функций компонентов и правки DOM.
 *
 * Это фича, а не часть виджета: демо в уроке четыре, и мерить они обязаны одинаково —
 * иначе числа в соседних блоках нельзя сравнивать. Виджет виджету не сосед, общее у них
 * живёт уровнем ниже.
 */
export { useRenderCount } from './model/useRenderCount';
export { useFlash } from './model/useFlash';
export { useDomMutations } from './model/useDomMutations';
