<script setup lang="ts">
/**
 * Во что обходится одно нажатие, когда список растёт.
 *
 * График, а не таблица, потому что вопрос здесь не «сколько», а «как меняется»: у React
 * без `memo` работа растёт вместе с длиной списка, у React с `memo` и у Vue — не растёт вовсе.
 * На линейной шкале 2 и 1005 в одном поле не уживаются, поэтому ось логарифмическая —
 * и это тот случай, когда она обязательна, а не для красоты.
 *
 * Остров не гидратируется: картинка считается на сборке и приезжает готовым SVG.
 */
import ChartFrame from '@/shared/ui/ChartFrame.vue';
import { linePath, log } from '@/shared/lib/chart';
import type { WorkPoint } from '../model/types';

const props = defineProps<{ points: WorkPoint[] }>();

const WIDTH = 720;
const HEIGHT = 250;
const PAD = { top: 16, right: 18, bottom: 34, left: 56 };
const plotWidth = WIDTH - PAD.left - PAD.right;
const plotHeight = HEIGHT - PAD.top - PAD.bottom;

const sizes = props.points.map((p) => p.size);
const values = props.points.flatMap((p) => [p.plain, p.memo, p.vue]);

const x = log([Math.min(...sizes), Math.max(...sizes)], [0, plotWidth]);
const y = log([1, Math.max(...values)], [plotHeight, 0]);

const xTicks = sizes.map((size) => ({ at: x(size), label: String(size) }));
const yTicks = [1, 10, 100, 1000]
  .filter((v) => v <= Math.max(...values) * 1.2)
  .map((v) => ({ at: y(v), label: String(v) }));

const series = [
  { key: 'plain', title: 'React без memo', tone: 'amber', get: (p: WorkPoint) => p.plain },
  { key: 'memo', title: 'React с memo', tone: 'violet', get: (p: WorkPoint) => p.memo },
  { key: 'vue', title: 'Vue', tone: 'green', get: (p: WorkPoint) => p.vue },
].map((s) => ({
  ...s,
  path: linePath(props.points.map((p) => [x(p.size), y(s.get(p))])),
  dots: props.points.map((p) => ({ cx: x(p.size), cy: y(s.get(p)), value: s.get(p) })),
}));
</script>

<template>
  <figure class="chart">
    <ChartFrame
      :width="WIDTH"
      :height="HEIGHT"
      :pad="PAD"
      :x-ticks="xTicks"
      :y-ticks="yTicks"
      x-label="строк в списке"
      y-label="работы на одно нажатие"
    >
      <g v-for="s in series" :key="s.key" :data-tone="s.tone">
        <path class="line" :d="s.path" />
        <circle v-for="(dot, i) in s.dots" :key="i" class="dot" :cx="dot.cx" :cy="dot.cy" r="3.5" />
      </g>
    </ChartFrame>

    <figcaption class="legend">
      <span v-for="s in series" :key="s.key" class="item" :data-tone="s.tone">
        <span class="swatch" />{{ s.title }}
      </span>
    </figcaption>
  </figure>
</template>

<style scoped>
.chart {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 0;
  min-width: 0;
}

.line {
  fill: none;
  stroke-width: 2;
}
.dot {
  stroke: var(--surface);
  stroke-width: 1.5;
}

[data-tone='amber'] .line,
[data-tone='amber'] .dot {
  stroke: var(--bar-amber);
}
[data-tone='amber'] .dot {
  fill: var(--bar-amber);
}
[data-tone='violet'] .line,
[data-tone='violet'] .dot {
  stroke: var(--bar-violet);
}
[data-tone='violet'] .dot {
  fill: var(--bar-violet);
}
[data-tone='green'] .line,
[data-tone='green'] .dot {
  stroke: var(--bar-green);
}
[data-tone='green'] .dot {
  fill: var(--bar-green);
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-muted);
}
.item {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}
.swatch {
  width: 14px;
  height: 3px;
  border-radius: var(--r-full);
}
.item[data-tone='amber'] .swatch {
  background: var(--bar-amber);
}
.item[data-tone='violet'] .swatch {
  background: var(--bar-violet);
}
.item[data-tone='green'] .swatch {
  background: var(--bar-green);
}
</style>
