<script setup lang="ts">
/**
 * «Цена трёх планов»: для запроса с растущей долей строк — цены Seq Scan, Index Scan и Bitmap
 * Heap Scan по модели `planCosts` и то, что выбрал Postgres на стенде.
 *
 * Цены считает строка `PLANNER_CODE` из темы, собранная `new Function` (`model/run.ts`). Выбор
 * Postgres и его цены вариантов — литералы стенда из `data.ts`; `tests/unit/indexes.test.ts`
 * пересобирает их `EXPLAIN` и проверяет, что модель выбирает то же самое.
 */
import { computed, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { loadPlanner } from '../model/run';
import type { PlanColumn, ScanNode } from '../model/types';

const props = defineProps<{
  plannerCode: string;
  columns: PlanColumn[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const planCosts = loadPlanner(props.plannerCode);

const picked = ref(props.columns[0].id);
const options = props.columns.map((c) => ({ value: c.id, label: c.label }));
const column = computed(() => props.columns.find((c) => c.id === picked.value) ?? props.columns[0]);

const index = ref(3);
watch(column, () => {
  index.value = 3;
});

const point = computed(() => column.value.points[Math.min(index.value, column.value.points.length - 1)]);
const sql = computed(() => column.value.sql.replace('{n}', String(point.value.n)));
const unit = computed(() => column.value.unit.replace('{n}', String(point.value.n)));
const model = computed(() => planCosts(column.value.stats, point.value.rows));

const NODES: ScanNode[] = ['Seq Scan', 'Index Scan', 'Bitmap Heap Scan'];

const bars = computed(() => {
  const max = Math.max(...NODES.map((n) => Math.max(model.value.costs[n], point.value.costs[n])));
  return NODES.map((n) => ({
    node: n,
    cost: model.value.costs[n],
    pg: point.value.costs[n],
    width: `${Math.max(1, (model.value.costs[n] / max) * 100)}%`,
    winner: n === model.value.winner,
  }));
});

const share = computed(() => {
  const p = (point.value.rows / column.value.stats.tuples) * 100;
  return p < 1 ? p.toFixed(2).replace('.', ',') : p.toFixed(p < 10 ? 1 : 0).replace('.', ',');
});

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};

const rowsLine = computed(
  () =>
    `Планировщик ждёт **${point.value.rows.toLocaleString('ru-RU')}** ${plural(point.value.rows, 'строку', 'строки', 'строк')} из ${column.value.stats.tuples.toLocaleString('ru-RU')} — ${share.value} % таблицы.`,
);

const verdict = computed(() => {
  const same = model.value.winner === point.value.chosen;
  return `Модель выбирает **${model.value.winner}**. Postgres на стенде выбрал **${point.value.chosen}**${same ? ' — то же самое.' : '.'}`;
});

const fmt = (n: number) => n.toFixed(2);
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="pl-toolbar">
        <SegmentedControl v-model="picked" class="l-pills" label="Столбец" :options="options" />
        <div class="pl-range">
          <label class="pl-range__label" for="pl-point">доля строк</label>
          <input
            id="pl-point"
            v-model.number="index"
            class="pl-range__input"
            type="range"
            min="0"
            :max="column.points.length - 1"
            step="1"
          />
          <output class="pl-range__value" for="pl-point">{{ unit }}</output>
        </div>
      </div>
    </template>

    <div class="pl-body">
      <Md class="pl-note" :text="column.note" />
      <pre class="pl-sql">{{ sql }}</pre>
      <Md class="pl-line" :text="rowsLine" />

      <div class="pl-bars" role="table" aria-label="Цены трёх вариантов плана">
        <div class="pl-bars__head" role="row">
          <span role="columnheader">узел</span>
          <span role="columnheader">цена по модели</span>
          <span role="columnheader">модель</span>
          <span role="columnheader">EXPLAIN</span>
        </div>
        <div v-for="b in bars" :key="b.node" class="pl-bar" role="row" :data-win="b.winner ? 'yes' : 'no'">
          <span role="cell" class="pl-bar__name">{{ b.node }}</span>
          <span role="cell" class="pl-bar__track">
            <span class="pl-bar__fill" :style="{ width: b.width }" />
          </span>
          <code role="cell" class="pl-bar__cost">{{ fmt(b.cost) }}</code>
          <code role="cell" class="pl-bar__pg">{{ fmt(b.pg) }}</code>
        </div>
      </div>

      <Md class="pl-line pl-line--verdict" :text="verdict" />
      <Md class="pl-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.pl-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 20px;
}
.pl-range {
  display: flex;
  flex: 1 1 240px;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  min-width: 0;
}
.pl-range__label {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-muted);
}
/* Ползунок целиком свой: у системного контрола свои цвета и шрифт. */
.pl-range__input {
  flex: 1 1 140px;
  min-width: 0;
  height: 4px;
  margin: 0;
  appearance: none;
  border-radius: var(--r-full);
  background: var(--surface-3);
  font: inherit;
  color: inherit;
}
.pl-range__input::-webkit-slider-thumb {
  appearance: none;
  width: 14px;
  height: 14px;
  border: 0;
  border-radius: var(--r-full);
  background: var(--ink);
  cursor: pointer;
}
.pl-range__input::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border: 0;
  border-radius: var(--r-full);
  background: var(--ink);
  cursor: pointer;
}
.pl-range__value {
  min-width: 12ch;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
}

.pl-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
  min-width: 0;
}
.pl-note,
.pl-caption,
.pl-line {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.pl-note :deep(code),
.pl-caption :deep(code),
.pl-line :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
/* Подложка — общая для кода курса (`pre` в base.css, чернильная). */
.pl-sql {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--code-fg);
  white-space: pre-wrap;
  word-break: break-word;
}

.pl-bars {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.pl-bars__head,
.pl-bar {
  display: grid;
  grid-template-columns: 10.5em minmax(80px, 1fr) 5.5em 5.5em;
  gap: 10px;
  align-items: center;
}
/* На узком экране полоса уходит на свою строку под названием и ценами. */
@media (max-width: 560px) {
  .pl-bars__head,
  .pl-bar {
    grid-template-columns: minmax(0, 1fr) 5.5em 5.5em;
    gap: 6px 10px;
  }
  .pl-bars__head > :nth-child(2) {
    display: none;
  }
  .pl-bar__track {
    grid-column: 1 / -1;
    grid-row: 2;
  }
}
.pl-bars__head {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.pl-bar {
  padding: 6px 8px;
  border-radius: var(--r2);
  font-size: var(--fs-3);
  color: var(--prose);
}
.pl-bar[data-win='yes'] {
  background: var(--tone-ok-bg);
  box-shadow: inset 0 0 0 1px var(--tone-ok-line);
}
.pl-bar__name {
  font-family: var(--mono);
  color: var(--ink);
}
.pl-bar[data-win='yes'] .pl-bar__name {
  color: var(--tone-ok-text);
  font-weight: 600;
}
.pl-bar__track {
  height: 10px;
  border-radius: var(--r-full);
  background: var(--surface-3);
  overflow: hidden;
}
.pl-bar__fill {
  display: block;
  height: 100%;
  border-radius: var(--r-full);
  background: var(--bar-neutral);
}
.pl-bar[data-win='yes'] .pl-bar__fill {
  background: var(--bar-green);
}
.pl-bar__cost,
.pl-bar__pg {
  font-family: var(--mono);
  font-size: var(--fs-3);
  text-align: right;
  color: var(--ink);
}
.pl-bar__pg {
  color: var(--text-muted);
}
.pl-line--verdict {
  font-weight: 500;
}
</style>
