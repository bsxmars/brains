import { onScopeDispose, readonly, ref } from 'vue';

/**
 * Читатель просил систему не двигать картинку — значит, не двигаем.
 *
 * В курсе появляется автоплей, а это ровно тот случай, ради которого `prefers-reduced-motion`
 * и придуман: содержимое меняется само, без действия человека. Для части людей это не
 * «красиво», а физически плохо — от укачивания до приступа. Поэтому правило простое:
 * **автоплей не стартует сам**, переходы гасятся, но само демо остаётся полностью доступным
 * — шаги по-прежнему листаются кнопками.
 *
 * Значение живое: настройку меняют прямо во время чтения, и страница обязана это заметить.
 *
 * Работает и на сервере: Astro рендерит острова в Node, где `matchMedia` нет вовсе.
 * Там ответ «не просили» — на статической разметке движения всё равно не бывает.
 */
export function useReducedMotion() {
  const reduced = ref(false);

  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    reduced.value = query.matches;

    const update = (event: MediaQueryListEvent) => {
      reduced.value = event.matches;
    };
    query.addEventListener('change', update);
    onScopeDispose(() => query.removeEventListener('change', update));
  }

  return readonly(reduced);
}
