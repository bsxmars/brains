import { computed, ref, type Ref } from 'vue';

/**
 * Состояние пошагового демо: индекс шага, счётчик «3 / 14» и границы.
 *
 * В оригиналах это было размазано по каждому уроку: своя пара кнопок, свой `Math.min`,
 * свой формат счётчика. Здесь один хук на все степперы курса — и, что важнее, одно место,
 * где чинится поведение на краях: на первом шаге «назад» не должно уводить в минус,
 * на последнем «вперёд» не должно выходить за пределы сценария.
 */
export function useStepper(total: Ref<number> | number) {
  const count = computed(() => (typeof total === 'number' ? total : total.value));
  const index = ref(0);

  const atStart = computed(() => index.value === 0);
  const atEnd = computed(() => index.value >= count.value - 1);
  const counter = computed(() => `${index.value + 1} / ${count.value}`);

  const go = (i: number) => {
    index.value = Math.min(count.value - 1, Math.max(0, i));
  };
  const next = () => go(index.value + 1);
  const prev = () => go(index.value - 1);
  const reset = () => go(0);

  return { index, counter, atStart, atEnd, go, next, prev, reset };
}
