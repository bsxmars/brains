import type { TwoModelsAction } from './types';

/**
 * Общая шина трёх островов демо.
 *
 * Зачем она вообще. Демо обязано показать **одно нажатие на две модели сразу**, иначе сравнивать
 * нечего: две кнопки — это два разных нажатия, и читатель вправе заподозрить, что действия
 * были не одинаковые. Но React-остров и Vue-остров — разные рантаймы в разных бандлах, общего
 * состояния у них нет и быть не может.
 *
 * Поэтому общее — событие на `window`, а не модуль с подпиской. Разница принципиальная:
 * модульная переменная требует, чтобы оба острова получили **один и тот же экземпляр модуля**,
 * а это зависит от того, как сборщик разложил чанки, — то есть от обстоятельств, которые
 * в коде не видны и однажды изменятся. Строка с именем события совпадает всегда.
 */
const EVENT = 'two-models:run';

interface RunDetail {
  action: TwoModelsAction;
}

/** Объявить действие. Кто слушает — дело слушающих. */
export function runAction(action: TwoModelsAction): void {
  window.dispatchEvent(new CustomEvent<RunDetail>(EVENT, { detail: { action } }));
}

/**
 * Подписаться на действия. Возвращает отписку — её обязан вызвать и React (`useEffect`),
 * и Vue (`onScopeDispose`): остров живёт меньше, чем страница.
 */
export function onAction(handler: (action: TwoModelsAction) => void): () => void {
  // На сервере окна нет, а подписываться просят и там: острова сначала рендерятся в разметку,
  // и `setup` Vue-компонента выполняется в Node. Без этой проверки сборка падает
  // на `window is not defined` — и падает вся страница, а не остров.
  if (typeof window === 'undefined') return () => {};

  const listener = (event: Event) => {
    handler((event as CustomEvent<RunDetail>).detail.action);
  };
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
