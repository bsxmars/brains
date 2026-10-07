<script setup lang="ts">
/**
 * «Доля попаданий по ходу трассы»: четыре политики на одной длинной трассе (20 000 запросов,
 * зерно 1), точка — доля попаданий в окне из 500 запросов.
 *
 * Трассу строит `TRACE_CODE`, кеши — классы из темы, прогон — `simulate` оттуда же; всё
 * собрано `model/run.ts` и считается в браузере читателя. `tests/unit/eviction.test.ts`
 * прогоняет тот же `curves` и сверяет итоговые доли с `HIT_TABLE`.
 */
import { computed, ref } from 'vue';
import ChartFrame from '@/shared/ui/ChartFrame.vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { linePath, linear } from '@/shared/lib/chart';
import { ALGOS, curves, loadEviction } from '../model/run';
import type { ChartTrace, EvictionCodes, TraceKind } from '../model/types';

const props = defineProps<{
  codes: EvictionCodes;
  traces: ChartTrace[];
  capacities: number[];
  /** Подпись под графиком. Строчная разметка. */
  caption: string;
}>();

const api = loadEviction(props.codes);

const picked = ref<string>(props.traces[0].id);
const traceOptions = props.traces.map((t) => ({ value: t.id, label: t.label }));
const trace = computed(() => props.traces.find((t) => t.id === picked.value) ?? props.traces[0]);

const cap = ref(String(props.capacities[1] ?? props.capacities[0]));
const capOptions = props.capacities.map((c) => ({ value: String(c), label: `кеш ${c}` }));

/** Прогоны не пересчитываются при возврате к уже виденной паре «трасса × размер». */
const memo = new Map<string, ReturnType<typeof curves>>();
const result = computed(() => {
  const key = `${trace.value.id}/${cap.value}`;
  if (!memo.has(key)) memo.set(key, curves(api, trace.value.id as TraceKind, Number(cap.value)));
  return memo.get(key)!;
});

const WIDTH = 720;
const HEIGHT = 280;
const PAD = { top: 20, right: 34, bottom: 34, left: 52 };
const plotWidth = WIDTH - PAD.left - PAD.right;
const plotHeight = HEIGHT - PAD.top - PAD.bottom;
const TOTAL = 20000;

const x = linear([0, TOTAL], [0, plotWidth]);
const y = linear([0, 1], [plotHeight, 0]);
const xTicks = [0, 5000, 10000, 15000, 20000].map((n) => ({ at: x(n), label: n.toLocaleString('ru-RU') }));
const yTicks = [0, 0.25, 0.5, 0.75, 1].map((v) => ({ at: y(v), label: `${v * 100} %` }));

const share = (v: number) => `${(v * 100).toFixed(1).replace('.', ',')} %`;

const series = computed(() =>
  ALGOS.map((a) => {
    const r = result.value[a.id];
    const step = TOTAL / r.curve.length;
    return {
      id: a.id,
      label: a.label,
      total: share(r.hitRate),
      path: linePath(r.curve.map((v, i) => [x((i + 1) * step), y(v)])),
    };
  }),
);
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="ec-tools">
        <SegmentedControl v-model="picked" class="l-pills" label="Трасса" :options="traceOptions" />
        <SegmentedControl v-model="cap" class="l-pills" label="Размер кеша" :options="capOptions" />
      </div>
    </template>

    <div class="ec-body">
      <Md class="ec-note" :text="trace.note" />

      <figure class="ec-figure">
        <ChartFrame
          :width="WIDTH"
          :height="HEIGHT"
          :pad="PAD"
          :x-ticks="xTicks"
          :y-ticks="yTicks"
          x-label="запрос"
          y-label="попаданий в окне"
        >
          <path v-for="s in series" :key="s.id" class="ec-line" :data-algo="s.id" :d="s.path" />
        </ChartFrame>

        <figcaption class="ec-legend">
          <span v-for="s in series" :key="s.id" class="ec-item" :data-algo="s.id">
            <span class="ec-swatch" />{{ s.label }} — {{ s.total }}
          </span>
        </figcaption>
      </figure>

      <Md class="ec-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.ec-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 18px;
}
.ec-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
  min-width: 0;
}
.ec-note,
.ec-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.ec-note :deep(code),
.ec-caption :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
.ec-figure {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 0;
  min-width: 0;
}
.ec-line {
  fill: none;
  stroke-width: 2;
  stroke-linejoin: round;
}
.ec-line[data-algo='lru'],
.ec-item[data-algo='lru'] .ec-swatch {
  stroke: var(--bar-red);
  background: var(--bar-red);
}
.ec-line[data-algo='lfu'],
.ec-item[data-algo='lfu'] .ec-swatch {
  stroke: var(--bar-amber);
  background: var(--bar-amber);
}
.ec-line[data-algo='tinylfu'],
.ec-item[data-algo='tinylfu'] .ec-swatch {
  stroke: var(--bar-green);
  background: var(--bar-green);
}
.ec-line[data-algo='sieve'],
.ec-item[data-algo='sieve'] .ec-swatch {
  stroke: var(--bar-violet);
  background: var(--bar-violet);
}
.ec-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 18px;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-muted);
}
.ec-item {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}
.ec-swatch {
  width: 14px;
  height: 3px;
  border-radius: var(--r-full);
}
</style>
