<script setup lang="ts">
/**
 * «Куча по шагам»: операции `push`/`pop` над кучей темы — дерево, тот же массив и цена шага
 * рядом с ценой отсортированного массива.
 *
 * Считают строки `HEAP_CODE`, `SORTED_CODE` и `LESS_NO_ID_CODE` из темы, собранные
 * `new Function` (`model/run.ts`). Те же строки сверяет `tests/unit/schedulers.test.ts`
 * с сортировкой и с кучей из исходника пакета `scheduler`. Компонент только раскладывает
 * массив по рядам дерева — это рисунок, а не расчёт.
 */
import { computed, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import StepToolbar from '@/shared/ui/StepToolbar.vue';
import { SegmentedControl } from '@/shared/ui';
import { loadHeap, traceHeap } from '../model/run';
import type { HeapNode, HeapScenario } from '../model/types';

const props = defineProps<{
  heapCode: string;
  sortedCode: string;
  lessNoIdCode: string;
  scenarios: HeapScenario[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const picked = ref(props.scenarios[0].id);
const options = props.scenarios.map((s) => ({ value: s.id, label: s.label }));
const scenario = computed(() => props.scenarios.find((s) => s.id === picked.value) ?? props.scenarios[0]);

const steps = computed(() =>
  traceHeap(
    () => loadHeap(props.heapCode, props.sortedCode, scenario.value.noId ? props.lessNoIdCode : ''),
    scenario.value.ops,
  ),
);

const step = ref(0);
watch(picked, () => {
  step.value = 0;
});

const current = computed(() => (step.value > 0 ? steps.value[step.value - 1] : null));
const heap = computed<HeapNode[]>(() => current.value?.after ?? []);
/** Индексы, где после шага лежит другой элемент, чем до него. */
const changed = computed(() => {
  const c = current.value;
  if (!c) return new Set<number>();
  return new Set(c.after.map((n, i) => (c.before[i]?.id === n.id ? -1 : i)).filter((i) => i >= 0));
});
const popped = computed(() =>
  steps.value
    .slice(0, step.value)
    .filter((s) => s.popped)
    .map((s) => s.popped as HeapNode),
);

const label = (n: HeapNode) => `${n.name}:${n.sortIndex}`;
const moves = (k: number) => (k % 10 === 1 && k % 100 !== 11 ? 'перемещение' : [2, 3, 4].includes(k % 10) && ![12, 13, 14].includes(k % 100) ? 'перемещения' : 'перемещений');
const cmp = (k: number) => (k % 10 === 1 && k % 100 !== 11 ? 'сравнение' : [2, 3, 4].includes(k % 10) && ![12, 13, 14].includes(k % 100) ? 'сравнения' : 'сравнений');

const status = computed(() => {
  const c = current.value;
  if (!c) return 'Куча пуста. Первый шаг — первая операция сценария.';
  const what =
    c.op.op === 'push'
      ? `\`push\` ${c.op.name} со сроком ${c.op.key}`
      : `\`pop\` достал **${c.popped ? label(c.popped) : '—'}**`;
  return `${what}: ${c.compares} ${cmp(c.compares)} и ${c.moves} ${moves(c.moves)} в куче. Отсортированному массиву тот же шаг стоил бы ${c.sortedMoves} ${moves(c.sortedMoves)}.`;
});

// Рисунок дерева: ряд d — индексы от 2^d − 1 до 2^(d+1) − 2.
const W = 560;
const ROW = 64;
const R = 22;
const depth = (i: number) => Math.floor(Math.log2(i + 1));
const pos = (i: number) => {
  const d = depth(i);
  const inRow = i - (2 ** d - 1);
  return { x: ((inRow + 0.5) * W) / 2 ** d, y: 34 + d * ROW };
};
const maxLen = computed(() => Math.max(1, ...steps.value.map((s) => s.after.length)));
const height = computed(() => 34 + depth(maxLen.value - 1) * ROW + 34);
const edges = computed(() => heap.value.slice(1).map((_, k) => ({ from: pos((k + 1 - 1) >> 1), to: pos(k + 1), key: k + 1 })));

function prev() {
  if (step.value > 0) step.value--;
}
function next() {
  if (step.value < steps.value.length) step.value++;
}
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="picked" class="l-pills" label="Сценарий" :options="options" />
    </template>

    <div class="hl-body">
      <Md class="hl-note" :text="scenario.note" />

      <StepToolbar
        :counter="`шаг ${step} из ${steps.length}`"
        :at-start="step === 0"
        :at-end="step === steps.length"
        @prev="prev"
        @next="next"
        @reset="step = 0"
      />

      <div class="hl-tree">
        <svg :width="W" :height="height" :viewBox="`0 0 ${W} ${height}`" role="img" :aria-label="`Куча из ${heap.length} элементов`">
          <line v-for="e in edges" :key="`e${e.key}`" class="hl-edge" :x1="e.from.x" :y1="e.from.y" :x2="e.to.x" :y2="e.to.y" />
          <g v-for="(n, i) in heap" :key="n.id" :class="changed.has(i) ? 'hl-node hl-node--moved' : 'hl-node'">
            <circle :cx="pos(i).x" :cy="pos(i).y" :r="R" />
            <text class="hl-name" :x="pos(i).x" :y="pos(i).y - 3">{{ n.name }}</text>
            <text class="hl-key" :x="pos(i).x" :y="pos(i).y + 12">{{ n.sortIndex }}</text>
            <text class="hl-idx" :x="pos(i).x + R + 4" :y="pos(i).y - R + 6">{{ i }}</text>
          </g>
        </svg>
      </div>

      <div class="hl-array" aria-label="Массив кучи">
        <span class="hl-label">массив</span>
        <div class="hl-cells">
          <span v-if="heap.length === 0" class="hl-empty">[ ]</span>
          <span v-for="(n, i) in heap" :key="n.id" class="hl-cell" :data-moved="changed.has(i) ? 'yes' : 'no'">
            <span class="hl-cell__i">{{ i }}</span>
            <code>{{ label(n) }}</code>
          </span>
        </div>
      </div>

      <Md class="hl-status" :text="status" />

      <div class="hl-totals">
        <div class="hl-total">
          <span class="hl-label">куча, всего</span>
          <span class="hl-num">{{ current?.total.compares ?? 0 }} {{ cmp(current?.total.compares ?? 0) }} · {{ current?.total.moves ?? 0 }} {{ moves(current?.total.moves ?? 0) }}</span>
        </div>
        <div class="hl-total">
          <span class="hl-label">отсортированный массив, всего</span>
          <span class="hl-num">{{ current?.total.sortedMoves ?? 0 }} {{ moves(current?.total.sortedMoves ?? 0) }}</span>
        </div>
        <div class="hl-total">
          <span class="hl-label">вышли по порядку</span>
          <span class="hl-num">{{ popped.length ? popped.map((n) => n.name).join(' → ') : '—' }}</span>
        </div>
      </div>

      <Md class="hl-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.hl-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.hl-note,
.hl-caption,
.hl-status {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.hl-note :deep(code),
.hl-caption :deep(code),
.hl-status :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
.hl-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.hl-tree {
  min-width: 0;
  overflow-x: auto;
  padding: 8px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.hl-tree svg {
  display: block;
  max-width: none;
  margin: 0 auto;
  /* Без явной заливки корень SVG красится чёрным по умолчанию — цвет мимо theme.ts. */
  fill: var(--ink);
}
.hl-edge {
  stroke: var(--border-strong);
  stroke-width: 1.5;
}
.hl-node circle {
  fill: var(--surface);
  stroke: var(--border-strong);
  stroke-width: 1.5;
}
.hl-node--moved circle {
  fill: var(--tone-warn-bg);
  stroke: var(--tone-warn-line);
  stroke-width: 2;
}
.hl-name {
  font-family: var(--mono);
  font-size: var(--fs-3);
  font-weight: 600;
  fill: var(--ink);
  text-anchor: middle;
}
.hl-key {
  font-family: var(--mono);
  font-size: var(--fs-2);
  fill: var(--text-muted);
  text-anchor: middle;
}
.hl-idx {
  font-family: var(--mono);
  font-size: var(--fs-2);
  fill: var(--text-muted);
}

.hl-array {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.hl-cells {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.hl-empty {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-muted);
}
.hl-cell {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 4px 8px;
  border-radius: var(--r2);
  background: var(--surface-2);
}
.hl-cell[data-moved='yes'] {
  background: var(--tone-warn-bg);
  box-shadow: inset 0 0 0 1px var(--tone-warn-line);
}
.hl-cell__i {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.hl-cell code {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
}

.hl-totals {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 10px;
}
.hl-total {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border-radius: var(--r2);
  background: var(--surface-2);
  min-width: 0;
}
.hl-num {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
  overflow-wrap: anywhere;
}
</style>
