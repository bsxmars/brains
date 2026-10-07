<script setup lang="ts">
/**
 * Схема авторасстановки: одна и та же четвёрка элементов без `dense` и с ним.
 *
 * Позиции считает строка `PLACE_CODE` из темы (`model/run.ts`), та же, что напечатана на
 * странице и сверена `tests/unit/layout-internals.test.ts` с координатами из Chromium.
 * Компонент рисуется на сервере, без гидратации: интерактива в нём нет.
 */
import { computed } from 'vue';
import { loadPlace } from '../model/run';

const props = defineProps<{
  code: string;
  columns: number;
  spans: number[];
  names: string[];
}>();

const autoPlace = loadPlace(props.code);

const variants = computed(() =>
  (['row', 'row dense'] as const).map((flow) => {
    const placed = autoPlace(props.columns, props.spans, flow === 'row dense');
    const rows = Math.max(...placed.map((p) => p.row));
    return { flow, placed, rows };
  }),
);
</script>

<template>
  <div class="pg-wrap">
    <figure v-for="v in variants" :key="v.flow" class="pg-fig">
      <figcaption class="pg-cap">grid-auto-flow: {{ v.flow }}</figcaption>
      <div
        class="pg-grid"
        :style="{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${v.rows}, 44px)` }"
      >
        <template v-for="r in v.rows" :key="`r${r}`">
          <div
            v-for="c in columns"
            :key="`c${r}-${c}`"
            class="pg-cell"
            :style="{ gridRow: String(r), gridColumn: String(c) }"
          />
        </template>
        <div
          v-for="(p, i) in v.placed"
          :key="names[i]"
          class="pg-item"
          :data-wide="p.span > 1 ? 'yes' : 'no'"
          :style="{ gridRow: String(p.row), gridColumn: `${p.col} / span ${p.span}` }"
        >
          {{ names[i] }}
        </div>
      </div>
    </figure>
  </div>
</template>

<style scoped>
.pg-wrap {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr));
  gap: 16px;
}
.pg-fig {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  margin: 0;
  padding: 14px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.pg-cap {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.pg-grid {
  display: grid;
  gap: 6px;
}
.pg-cell {
  border: 1px dashed var(--border-strong);
  border-radius: var(--r1);
}
.pg-item {
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--r1);
  background: var(--tone-ok-chip);
  color: var(--tone-ok-text);
  font-family: var(--mono);
  font-size: var(--fs-3);
  font-weight: 600;
}
.pg-item[data-wide='yes'] {
  background: var(--tone-info-chip);
  color: var(--tone-info-text);
}
</style>
