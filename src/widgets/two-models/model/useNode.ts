import { inject, onMounted, onScopeDispose, onUpdated, ref } from 'vue';
import { REPORT } from './report';

/**
 * Узел Vue-половины: отчитаться о прогоне и мигнуть.
 *
 * Считаются **и монтирование, и обновление**. Это не педантизм: у React новая строка списка
 * стоит вызова функции, и если у Vue не считать монтирование, то «добавить строку» выглядело
 * бы у Vue дешевле, чем есть. Мерить надо работу, а не её удобную половину.
 *
 * ⚠️ Подсветка ставится атрибутом напрямую, мимо реактивного состояния, и на то две причины
 * сразу. Реактивное поле, прочитанное шаблоном, дало бы запись из `onUpdated` → новое
 * обновление → новый `onUpdated`, то есть `Maximum recursive updates exceeded`. А наблюдатель
 * за документом посчитал бы саму подсветку правкой и показал бы работу, которой не было.
 * Атрибуты он не наблюдает — см. `domEdits.ts`.
 *
 * ⚠️ `onUpdated` выбран потому, что он есть в продакшен-сборке. `onRenderTracked`
 * и `onRenderTriggered` вырезаны из неё, а сайт статический — опираться на них нельзя.
 * Что `onUpdated` срабатывает ровно на прогон render-функции, проверено отдельным замером
 * в Node (см. отчёт к уроку).
 */
export function useNode(name: string) {
  const report = inject(REPORT, null);
  const root = ref<HTMLElement | null>(null);
  let timer: ReturnType<typeof setTimeout> | null = null;

  const tick = () => {
    report?.(name);
    const el = root.value;
    if (!el) return;
    el.dataset.flash = 'on';
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      if (root.value) root.value.dataset.flash = 'off';
    }, 420);
  };

  onMounted(tick);
  onUpdated(tick);
  onScopeDispose(() => {
    if (timer !== null) clearTimeout(timer);
  });

  return root;
}
