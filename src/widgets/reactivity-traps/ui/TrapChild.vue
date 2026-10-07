<script setup lang="ts">
/**
 * Дочерний компонент для сценария «деструктуризация `props`».
 *
 * Настоящий компонент с настоящими `props` — иначе показывать было бы нечего: `props` это
 * `shallowReactive`-объект, который создаёт рантайм при монтировании, и подделать его
 * обычным `reactive` значит показать не ту вещь.
 *
 * Ошибка внутри — намеренная и является предметом демо: `const { count } = props`
 * деструктурирует **переменную**, в которую положили результат `defineProps`, а не сам
 * вызов. Компиляторная трансформация «Reactive Props Destructure» (стабильна с 3.5)
 * переписывает обращения обратно в `props.count` только при прямой деструктуризации
 * вызова — `const { count } = defineProps(...)`. Здесь её нет, поэтому в переменной остаётся
 * снимок на момент чтения, а рядом видно живое `props.count`.
 *
 * Отдельный файл, а не `defineComponent` в соседнем виджете: SFC — один компонент на файл.
 */
import { watchEffect } from 'vue';

const props = defineProps<{ count: number; report: (text: string) => void }>();

// Снимок: обычное чтение свойства, значение скопировано и больше ни с чем не связано.
const { count } = props;

props.report(`setup: деструктурировали count = ${count}`);

watchEffect(() => props.report(`эффект: из переменной ${count} · из props ${props.count}`));
</script>

<template>
  <div class="child">
    <span class="t-label">дочерний компонент · props</span>
    <div class="child__row">
      <span class="child__k">из переменной</span>
      <span class="child__v child__v--stale">{{ count }}</span>
    </div>
    <div class="child__row">
      <span class="child__k">из props</span>
      <span class="child__v">{{ props.count }}</span>
    </div>
  </div>
</template>

<style scoped>
.child {
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 14px 16px;
  border-radius: var(--r2);
  background: var(--surface-2);
}
.child__row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}
.child__k {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.child__v {
  font-family: var(--mono);
  font-size: var(--fs-7);
  color: var(--tone-ok-strong);
}
/* Застрявшее значение — янтарным: это не ошибка рантайма, это снимок. */
.child__v--stale {
  color: var(--tone-warn-strong);
}
</style>
