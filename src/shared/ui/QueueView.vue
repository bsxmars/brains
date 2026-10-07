<script setup lang="ts">
/**
 * Очередь: список фишек сверху вниз или в строку.
 *
 * Тон здесь — это вид очереди, а не украшение: фиолетовая — микрозадачи, янтарная — задачи,
 * серая пунктирная — то, чего в очереди пока нет (таймер ещё не дозрел, кадр не подошёл).
 * Эти цвета одинаковы во всех уроках курса, поэтому очередь узнаётся с одного взгляда.
 */
interface Props {
  items: string[];
  label?: string;
  tone?: 'info' | 'warn' | 'neutral';
  layout?: 'column' | 'row';
  emptyLabel?: string;
  minHeight?: number;
  /** Пунктирная рамка: пустое место, а не элемент очереди. */
  dashed?: boolean;
}

withDefaults(defineProps<Props>(), {
  label: '',
  tone: 'info',
  layout: 'column',
  emptyLabel: 'пусто',
  minHeight: 0,
  dashed: false,
});
</script>

<template>
  <div class="queue">
    <div v-if="label" class="t-label" :data-tone="tone">{{ label }}</div>
    <div class="items" :data-layout="layout" :style="minHeight ? `min-height:${minHeight}px` : undefined">
      <TransitionGroup name="item">
        <span
          v-for="(item, i) in items"
          :key="`${item}-${i}`"
          class="item"
          :data-tone="tone"
          :data-dashed="dashed ? 'yes' : 'no'"
        >
          {{ item }}
        </span>
      </TransitionGroup>
      <span v-if="!items.length" class="empty">{{ emptyLabel }}</span>
    </div>
  </div>
</template>

<style scoped>
.queue {
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.t-label[data-tone='info'] {
  color: var(--accent);
}
.t-label[data-tone='warn'] {
  color: var(--tone-warn-strong);
}

.items {
  display: flex;
  gap: 4px;
}
.items[data-layout='column'] {
  flex-direction: column;
  align-items: stretch;
}
.items[data-layout='row'] {
  flex-wrap: wrap;
  align-items: center;
}

.item {
  padding: 7px 10px;
  border-radius: var(--r1);
  font-family: var(--mono);
  font-size: var(--fs-2);
  transition: all 0.2s;
}
.item[data-tone='info'] {
  border: 1px solid var(--tone-info-line);
  background: var(--tone-info-bg);
  color: var(--tone-info-strong);
}
.item[data-tone='warn'] {
  border: 1px solid var(--tone-warn-line);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-strong);
}
.item[data-tone='neutral'] {
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--chip-text);
}
.item[data-dashed='yes'] {
  border-style: dashed;
  border-color: var(--hairline);
  background: none;
  color: var(--ghost);
}

.empty {
  font-family: var(--mono);
  font-size: var(--fs-2);
  font-style: italic;
  color: var(--ghost);
}

.item-enter-active,
.item-leave-active {
  transition: all 0.18s;
}
.item-enter-from,
.item-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
