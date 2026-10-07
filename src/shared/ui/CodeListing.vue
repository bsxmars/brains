<script setup lang="ts">
/**
 * Листинг кода с подсвеченной строкой — та, на которой сейчас стоит демо.
 *
 * Подсветка сделана тем же приёмом, что в оригиналах: заливка тона и засечка слева
 * (`inset 2px 0 0`), а не рамка — рамка сдвинула бы текст на пиксель и строки бы «дышали»
 * при переходе между шагами.
 *
 * Тёмный вариант нужен там, где листинг лежит внутри чернильной панели.
 */
interface Props {
  lines: string[];
  /** Индекс активной строки; `-1` — активной нет. */
  active?: number;
  tone?: 'light' | 'dark';
  label?: string;
}

withDefaults(defineProps<Props>(), { active: -1, tone: 'light', label: '' });
</script>

<template>
  <!-- `data-code` помечает поддерево как код: обратные кавычки внутри листинга настоящие
       (шаблонные строки в примерах), и проверка разметки обязана их пропускать. -->
  <div class="listing" data-code :data-tone="tone">
    <div v-if="label" class="t-label">{{ label }}</div>
    <div class="lines">
      <div v-for="(line, i) in lines" :key="i" class="line" :class="{ active: i === active }">{{ line || ' ' }}</div>
    </div>
  </div>
</template>

<style scoped>
.listing {
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-x: auto;
}
.lines {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.line {
  padding: 2px 12px;
  border-radius: var(--r1);
  font-family: var(--mono);
  /* Ступенью крупнее подписей: это код, его читают, а не проглядывают. */
  font-size: var(--fs-3);
  line-height: 1.7;
  white-space: pre;
  /* Цветом прозы, а не `--text-muted` (решение автора 2026-09-30): код в листинге читают,
     и приглушённый он выглядел неактивным. Активную строку выделяют подложка и черта слева. */
  color: var(--prose);
  transition: all 0.18s;
}
.line.active {
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
  box-shadow: inset 2px 0 0 var(--accent);
}

.listing[data-tone='dark'] .line {
  color: var(--ink-faint);
}
.listing[data-tone='dark'] .line.active {
  background: var(--warn-wash-on-ink);
  color: var(--tone-warn-on-ink);
  box-shadow: inset 2px 0 0 var(--tone-warn-accent);
}
</style>
