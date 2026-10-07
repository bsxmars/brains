import type { BindModel, RenderApi } from './types';

/**
 * Демо и тест спрашивают одни и те же строки темы «Формы во фреймворках»: `MODEL_CODE`
 * (мини-`v-model`) и `RENDER_CODE` (кто перерисуется от одного символа).
 *
 * Строки напечатаны на странице и собраны здесь `new Function`. `tests/unit/forms.test.ts`
 * сверяет `bindModel` с директивами `v-model` из Vue 3.5 в happy-dom, а `whoRenders` —
 * со счётчиками рендеров настоящих React 19.3 и Vue 3.5 на вариантах формы из темы. Копии нет.
 *
 * Ни DOM, ни Vue: модуль импортирует юнит-тест.
 */
export function loadModel(code: string): BindModel {
  return new Function(`${code}\nreturn bindModel;`)() as BindModel;
}

export function loadRender(code: string): RenderApi {
  return new Function(`${code}\nreturn { whoRenders, buildTree };`)() as RenderApi;
}
