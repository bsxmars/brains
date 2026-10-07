<script setup lang="ts">
/**
 * Настоящий компонент внутри демо планировщика.
 *
 * Он здесь ради одной строки — `onUpdated`. «Компонент обновился» в уроке обязано означать
 * обновление настоящего компонента, а не слово в подписи: иначе демо показывает не Vue,
 * а рассказ о Vue.
 *
 * Почему `onUpdated`, а не `onRenderTriggered`: второй существует только в dev-сборке
 * (`__DEV__`-условия в исходниках), а курс собирается статически, то есть в прод. На странице
 * он бы просто молчал.
 *
 * Отдельный файл, а не `defineComponent` внутри соседнего виджета: SFC — один компонент
 * на файл, и это правило линтера, а не вкус.
 *
 * **Про отметку о рендере.** `trace` зовётся из шаблона, то есть буквально во время рендера —
 * это и есть нужный момент. Побочный эффект в рендере здесь законен ровно потому, что
 * предмет демо — сам рендер; пишет `trace` в обычный массив родителя, не в реактивное
 * состояние, поэтому обратной связи «лог → рендер → лог» не возникает.
 */
import { onUpdated } from 'vue';

const props = defineProps<{
  value: number;
  report: (phase: 'render' | 'updated', text: string) => void;
}>();

onUpdated(() => props.report('updated', 'onUpdated · компонент обновлён'));

function trace(value: number) {
  props.report('render', `render · компонент рисует n = ${value}`);
  return value;
}
</script>

<template>
  <div class="counter">
    <span class="t-label">настоящий компонент</span>
    <span class="counter__value">n = {{ trace(value) }}</span>
  </div>
</template>

<style scoped>
.counter {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 14px 16px;
  border-radius: var(--r2);
  background: var(--surface-2);
}
.counter__value {
  font-family: var(--mono);
  font-size: var(--fs-8);
  color: var(--tone-info-strong);
}
</style>
