<script setup lang="ts">
/**
 * Стек вызовов: кадры растут снизу вверх, под ними — жирная черта «дно стека».
 *
 * Верхний кадр выделен акцентом, потому что именно он сейчас исполняется, а пустой стек
 * подписан словами: в уроке про event loop «пусто» — это не отсутствие данных, а событие,
 * ради которого всё и затевалось (стек опустел → checkpoint).
 */
interface Props {
  frames: string[];
  label?: string;
  emptyLabel?: string;
  /** Подсветить подпись пустого стека акцентом — когда пустота и есть новость. */
  emptyAccent?: boolean;
  minHeight?: number;
}

withDefaults(defineProps<Props>(), {
  label: 'call stack',
  emptyLabel: 'пусто',
  emptyAccent: false,
  minHeight: 92,
});
</script>

<template>
  <div class="stack">
    <div v-if="label" class="t-label">{{ label }}</div>
    <div class="frames" :style="`min-height:${minHeight}px`">
      <div
        v-for="(frame, i) in frames"
        :key="`${frame}-${i}`"
        class="frame"
        :class="{ top: i === frames.length - 1 }"
      >
        {{ frame }}
      </div>
      <div v-if="!frames.length" class="empty" :class="{ accent: emptyAccent }">{{ emptyLabel }}</div>
    </div>
  </div>
</template>

<style scoped>
.stack {
  display: flex;
  flex-direction: column;
  gap: 9px;
}
/* column-reverse: первый кадр массива лежит внизу, как на настоящем стеке. */
.frames {
  display: flex;
  flex-direction: column-reverse;
  justify-content: flex-end;
  gap: 4px;
  padding-bottom: 5px;
  border-bottom: 2px solid var(--ink);
}
.frame {
  padding: 7px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r1);
  background: var(--surface-2);
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--chip-text);
  transition: all 0.2s;
}
.frame.top {
  border: 1.5px solid var(--accent);
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
}
.empty {
  padding: 7px 0;
  font-family: var(--mono);
  font-size: var(--fs-2);
  font-style: italic;
  color: var(--ghost);
}
.empty.accent {
  color: var(--accent);
}
</style>
