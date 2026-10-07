<script setup lang="ts">
/**
 * «Шаги от длины строки»: плохой шаблон против исправленного на строке `a…a!`.
 *
 * Точки графика — не литералы: каждую считает учебный движок темы (`PARSE_CODE` +
 * `MATCH_CODE`, `model/run.ts`) на строке нужной длины. Время не меряется — машина и нагрузка
 * на него влияют, а число шагов одно и то же везде. Тест темы проверяет форму кривых:
 * удвоение на букву у плохих шаблонов и несколько шагов на букву у исправленных.
 */
import { computed, ref } from 'vue';
import ChartFrame from '@/shared/ui/ChartFrame.vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { linePath, linear, log } from '@/shared/lib/chart';
import { GROWTH_LENGTHS, growth, loadEngine } from '../model/run';
import type { GrowthSet } from '../model/types';

const props = defineProps<{
  parseCode: string;
  matchCode: string;
  sets: GrowthSet[];
  /** Подпись под графиком. Строчная разметка. */
  caption: string;
}>();

const engine = loadEngine(props.parseCode, props.matchCode);

const picked = ref(props.sets[0].id);
const options = props.sets.map((s) => ({ value: s.id, label: s.label }));
const set = computed(() => props.sets.find((s) => s.id === picked.value) ?? props.sets[0]);

const WIDTH = 720;
const HEIGHT = 280;
const PAD = { top: 30, right: 18, bottom: 34, left: 64 };
const plotWidth = WIDTH - PAD.left - PAD.right;
const plotHeight = HEIGHT - PAD.top - PAD.bottom;

const lines = computed(() => growth(engine, set.value));

const maxN = GROWTH_LENGTHS[GROWTH_LENGTHS.length - 1];
const x = linear([GROWTH_LENGTHS[0], maxN], [0, plotWidth]);
const Y_MAX = 1e7;
const y = log([1, Y_MAX], [plotHeight, 0]);

const xTicks = [1, 3, 6, 9, 12, 15, 18].map((n) => ({ at: x(n), label: String(n) }));
const Y_LABELS: [number, string][] = [
  [1, '1'],
  [10, '10'],
  [100, '100'],
  [1e3, '1 тыс'],
  [1e4, '10 тыс'],
  [1e5, '100 тыс'],
  [1e6, '1 млн'],
  [1e7, '10 млн'],
];
const yTicks = Y_LABELS.map(([v, label]) => ({ at: y(v), label }));

const TONES = ['bad', 'fix', 'fix2'];
const series = computed(() =>
  set.value.series.map((s, i) => {
    const pts = lines.value[i];
    const tone = s.bad ? 'bad' : TONES[Math.min(2, i)];
    return {
      key: s.pattern,
      label: s.label,
      tone,
      path: linePath(pts.map((p) => [x(p.n), y(p.steps)])),
      dots: pts.map((p) => ({ cx: x(p.n), cy: y(p.steps), n: p.n, steps: p.steps })),
      last: pts[pts.length - 1].steps,
    };
  }),
);

const readout = computed(() =>
  series.value.map((s) => `\`${s.label}\` — ${s.last.toLocaleString('ru-RU')}`).join(', '),
);
const readoutText = computed(() => `Строка из ${maxN} букв и \`!\`: ${readout.value} шагов.`);
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="picked" class="l-pills" label="Шаблон" :options="options" />
    </template>

    <div class="gc-body">
      <Md class="gc-note" :text="set.note" />

      <figure class="gc-figure">
        <ChartFrame
          :width="WIDTH"
          :height="HEIGHT"
          :pad="PAD"
          :x-ticks="xTicks"
          :y-ticks="yTicks"
          x-label="длина строки, букв"
          y-label="шагов"
        >
          <g v-for="s in series" :key="s.key" :data-tone="s.tone">
            <path class="gc-line" :d="s.path" />
            <circle v-for="dot in s.dots" :key="dot.n" class="gc-dot" :cx="dot.cx" :cy="dot.cy" r="3">
              <title>{{ dot.n }} букв: {{ dot.steps.toLocaleString('ru-RU') }} шагов</title>
            </circle>
          </g>
        </ChartFrame>

        <figcaption class="gc-legend">
          <span v-for="s in series" :key="s.key" class="gc-item" :data-tone="s.tone">
            <span class="gc-swatch" />{{ s.label }}
          </span>
        </figcaption>
      </figure>

      <Md class="gc-readout" :text="readoutText" />
      <Md class="gc-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.gc-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
  min-width: 0;
}
.gc-note,
.gc-caption,
.gc-readout {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.gc-note :deep(code),
.gc-caption :deep(code),
.gc-readout :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
.gc-figure {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 0;
  min-width: 0;
}

.gc-line {
  fill: none;
  stroke-width: 2;
}
.gc-dot {
  stroke: var(--surface);
  stroke-width: 1.5;
}
[data-tone='bad'] .gc-line,
[data-tone='bad'] .gc-dot {
  stroke: var(--bar-red);
}
[data-tone='bad'] .gc-dot {
  fill: var(--bar-red);
}
[data-tone='fix'] .gc-line,
[data-tone='fix'] .gc-dot {
  stroke: var(--bar-green);
}
[data-tone='fix'] .gc-dot {
  fill: var(--bar-green);
}
[data-tone='fix2'] .gc-line,
[data-tone='fix2'] .gc-dot {
  stroke: var(--bar-violet);
}
[data-tone='fix2'] .gc-dot {
  fill: var(--bar-violet);
}
.gc-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-muted);
}
.gc-item {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}
.gc-swatch {
  width: 14px;
  height: 3px;
  border-radius: var(--r-full);
}
.gc-item[data-tone='bad'] .gc-swatch {
  background: var(--bar-red);
}
.gc-item[data-tone='fix'] .gc-swatch {
  background: var(--bar-green);
}
.gc-item[data-tone='fix2'] .gc-swatch {
  background: var(--bar-violet);
}
</style>
