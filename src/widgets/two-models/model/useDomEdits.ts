import { onScopeDispose, watch, type Ref } from 'vue';
import { createEditCounter, type EditCounter } from './domEdits';

/**
 * Vue-обёртка над общим счётчиком правок (`domEdits.ts`). Всё содержательное — там;
 * здесь только привязка к жизни компонента.
 *
 * Число намеренно **не реактивное**: его читают в момент снятия показаний, разностью
 * с прошлым нажатием. Сделай его `ref` — и оно попало бы в шаблон панели, панель бы
 * перерисовывалась на каждую правку документа, а наблюдаемое поддерево стоит внутри неё.
 */
export function useDomEdits(target: Ref<HTMLElement | null>) {
  let counter: EditCounter | null = null;

  const stop = () => {
    counter?.stop();
    counter = null;
  };

  watch(
    target,
    (el) => {
      stop();
      if (el) counter = createEditCounter(el);
    },
    { immediate: true, flush: 'post' },
  );

  onScopeDispose(stop);

  return {
    read: () => counter?.read() ?? 0,
    reset: () => counter?.reset(),
  };
}
