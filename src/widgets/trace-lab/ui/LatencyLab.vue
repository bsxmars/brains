<script setup lang="ts">
/**
 * «Одно среднее — разные хвосты»: два набора задержек с одинаковым средним, их гистограмма
 * по корзинам и перцентили — точные и оценённые по корзинам.
 *
 * Считает не компонент, а строка `STATS_CODE` темы «Наблюдаемость», собранная `new Function`
 * (`model/run.ts`); та же строка напечатана на странице и проверена
 * `tests/unit/observability.test.ts`. Наборы — синтетика из `data.ts`.
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { loadStats } from '../model/run';
import type { LatencySet } from '../model/types';

const props = defineProps<{
  statsCode: string;
  sets: LatencySet[];
  bounds: number[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const stats = loadStats(props.statsCode);

const picked = ref(props.sets[0].id);
const options = props.sets.map((s) => ({ value: s.id, label: s.label }));
const set = computed(() => props.sets.find((s) => s.id === picked.value) ?? props.sets[0]);

const counts = computed(() => stats.bucketCounts(set.value.values, props.bounds));
const peak = computed(() => Math.max(...counts.value));

const QS = [0.5, 0.95, 0.99] as const;
const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');

const tiles = computed(() => [
  { k: 'среднее', v: fmt(stats.mean(set.value.values)), est: '' },
  ...QS.map((q) => ({
    k: `p${Math.round(q * 100)}`,
    v: fmt(stats.percentile(set.value.values, q)),
    est: `по корзинам ≈ ${fmt(stats.percentileFromBuckets(props.bounds, counts.value, q))}`,
  })),
]);

/** Номер корзины, в которую попал точный перцентиль, — для пометки на строке. */
const bucketOf = (v: number) => {
  const i = props.bounds.findIndex((b) => v <= b);
  return i < 0 ? props.bounds.length : i;
};
const marks = computed(() => {
  const m = new Map<number, string[]>();
  for (const q of QS) {
    const i = bucketOf(stats.percentile(set.value.values, q));
    m.set(i, [...(m.get(i) ?? []), `p${Math.round(q * 100)}`]);
  }
  return m;
});

const label = (i: number) => {
  if (i === 0) return `≤ ${props.bounds[0]}`;
  if (i === props.bounds.length) return `> ${props.bounds[i - 1]}`;
  return `${props.bounds[i - 1]} – ${props.bounds[i]}`;
};
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="picked" class="l-pills" label="Набор" :options="options" />
    </template>

    <div class="ll-body">
      <Md class="ll-note" :text="set.note" />

      <div class="ll-tiles">
        <div v-for="tile in tiles" :key="tile.k" class="ll-tile">
          <span class="ll-label">{{ tile.k }}</span>
          <span class="ll-value">{{ tile.v }} <small>мс</small></span>
          <span v-if="tile.est" class="ll-est">{{ tile.est }}</span>
        </div>
      </div>

      <div class="ll-pane">
        <span class="ll-label">корзины гистограммы, мс · запросов в корзине</span>
        <div class="ll-rows" role="table" aria-label="Корзины гистограммы">
          <div
            v-for="(c, i) in counts"
            :key="i"
            class="ll-row"
            role="row"
            :data-empty="c === 0 ? 'yes' : 'no'"
          >
            <span class="ll-row__k" role="cell">{{ label(i) }}</span>
            <span class="ll-track" role="cell">
              <span class="ll-bar" :style="{ width: `${(c / peak) * 100}%` }" />
            </span>
            <span class="ll-row__n" role="cell">{{ c }}</span>
            <span class="ll-row__m" role="cell">{{ (marks.get(i) ?? []).join(' · ') }}</span>
          </div>
        </div>
      </div>

      <Md class="ll-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.ll-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.ll-note,
.ll-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.ll-note :deep(code),
.ll-caption :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
.ll-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.ll-tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 10px;
}
.ll-tile {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
  border-radius: var(--r2);
  background: var(--surface-2);
}
.ll-value {
  font-family: var(--mono);
  font-size: var(--fs-8);
  font-weight: 600;
  color: var(--ink);
}
.ll-value small {
  font-size: var(--fs-3);
  font-weight: 400;
  color: var(--text-muted);
}
.ll-est {
  font-size: var(--fs-2);
  color: var(--text-muted);
}

.ll-pane {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.ll-rows {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.ll-row {
  display: grid;
  grid-template-columns: 7.5em minmax(0, 1fr) 3em 6.5em;
  gap: 8px;
  align-items: center;
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--ink);
}
@media (max-width: 480px) {
  .ll-row {
    grid-template-columns: 6.5em minmax(0, 1fr) 2.6em;
  }
  .ll-row__m {
    grid-column: 2 / -1;
  }
  .ll-row__m:empty {
    display: none;
  }
}
.ll-row[data-empty='yes'] {
  color: var(--dim);
}
.ll-row__n {
  text-align: right;
}
.ll-row__m {
  color: var(--tone-warn-text);
  font-weight: 600;
}
.ll-track {
  height: 10px;
  border-radius: 3px;
  background: var(--surface-3);
  overflow: hidden;
}
.ll-bar {
  display: block;
  height: 100%;
  border-radius: 3px;
  background: var(--bar-violet);
}
</style>
