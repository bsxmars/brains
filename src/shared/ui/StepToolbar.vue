<script setup lang="ts">
/**
 * Панель пошагового демо: назад, шаг вперёд, сброс и счётчик.
 *
 * Кнопки — из библиотеки, а не свои: у неё есть состояние `disabled`, фокус и роль, которых
 * у восьми самодельных `<button>` в оригиналах не было. Вид задаёт скин `.aura-btn`
 * в `shared/styles/overrides.css`.
 */
import { Button } from '@/shared/ui';

defineProps<{
  counter: string;
  atStart?: boolean;
  atEnd?: boolean;
  /** Подпись основной кнопки: у разных демо свой шаг. */
  nextLabel?: string;
}>();

const emit = defineEmits<{ prev: []; next: []; reset: [] }>();
</script>

<template>
  <div class="toolbar">
    <Button class="is-icon" variant="secondary" :disabled="atStart" aria-label="Шаг назад" @click="emit('prev')">←</Button>
    <Button variant="primary" :disabled="atEnd" @click="emit('next')">{{ nextLabel ?? 'Шаг →' }}</Button>
    <Button variant="secondary" :disabled="atStart" @click="emit('reset')">сброс</Button>
    <span class="counter">{{ counter }}</span>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}
.counter {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-faint);
}
</style>
