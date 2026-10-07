<script setup lang="ts">
/**
 * Performance monitor: три линии, которые надо читать вместе.
 *
 * В оригинале комбинации перечислены текстом — «все три растут ступеньками», «растут только
 * listeners», — и чтобы их различить, читателю приходится воображать графики. А различаются
 * они именно формой: важен не пик, а НИЖНЯЯ ОГИБАЮЩАЯ, то есть куда линия возвращается после
 * сборки. Поэтому здесь три синхронных мини-графика и пунктир огибающей на каждом: пила
 * нормальна, ползущий вверх пунктир — нет.
 *
 * Линии рисуются по пресету, а не по замеру: это иллюстрация формы, а не данные конкретной
 * страницы.
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import { SegmentedControl } from '@/shared/ui';
import type { Metric, MonitorCombo, Trend } from '../model/types';

const props = defineProps<{ combos: MonitorCombo[]; metrics: Metric[]; cycles?: number }>();

const picked = ref('0');
const current = computed(() => props.combos[Number(picked.value)]);
const options = computed(() => props.combos.map((c, i) => ({ value: String(i), label: c.label })));

const W = 240;
const H = 72;
const PAD = 6;
const AMP = 0.15;

/** Сколько из подъёма остаётся после сборки: ничего, почти половина или всё. */
const KEEP: Record<Trend, number> = { flat: 0, rise: 0.55, 'rise-nofall': 1 };

const y = (v: number) => H - PAD - v * (H - PAD * 2);
const x = (t: number) => PAD + t * (W - PAD * 2);

/**
 * Линия за N серий: в каждой серии подъём во время работы и спад после сборки.
 * Возвращает и саму линию, и нижнюю огибающую — ту, по которой ставится диагноз.
 */
function build(trend: Trend) {
  const n = props.cycles ?? 5;
  const keep = KEEP[trend];
  const line: string[] = [];
  const floor: string[] = [];
  let base = 0;

  for (let c = 0; c < n; c++) {
    const t0 = c / n;
    const t1 = (c + 1) / n;
    line.push(`${x(t0).toFixed(1)},${y(base).toFixed(1)}`);
    floor.push(`${x(t0).toFixed(1)},${y(base).toFixed(1)}`);
    // Подъём во время серии.
    line.push(`${x(t0 + (t1 - t0) * 0.7).toFixed(1)},${y(base + AMP).toFixed(1)}`);
    base += AMP * keep;
    line.push(`${x(t1).toFixed(1)},${y(base).toFixed(1)}`);
  }
  floor.push(`${x(1).toFixed(1)},${y(base).toFixed(1)}`);

  return { line: line.join(' '), floor: floor.join(' '), leaks: keep > 0 };
}

const charts = computed(() =>
  props.metrics.map((metric) => {
    const trend = current.value[metric.key];
    return { ...metric, ...build(trend), trend };
  }),
);

const VERDICT: Record<Trend, string> = {
  flat: 'возвращается на место',
  rise: 'огибающая ползёт вверх',
  'rise-nofall': 'растёт и не падает',
};
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="bar">
        <span class="bar__label">что вы видите на графике:</span>
        <SegmentedControl v-model="picked" class="l-pills" label="Комбинация линий" :options="options" />
      </div>
    </template>

    <div class="charts">
      <figure v-for="chart in charts" :key="chart.key" class="chart">
        <figcaption class="chart__head">
          <span class="chart__name" :data-key="chart.key">{{ chart.label }}</span>
          <span class="chart__verdict" :data-leaks="chart.leaks ? 'yes' : 'no'">{{ VERDICT[chart.trend] }}</span>
        </figcaption>

        <div class="scroll">
          <svg
            :viewBox="`0 0 ${W} ${H}`"
            role="img"
            :aria-label="`${chart.label}: ${VERDICT[chart.trend]}`"
            class="plot"
          >
            <title>{{ `${chart.label}: ${VERDICT[chart.trend]}` }}</title>
            <line class="axis" :x1="PAD" :y1="H - PAD" :x2="W - PAD" :y2="H - PAD" />
            <polyline class="floor" :points="chart.floor" />
            <polyline class="line" :data-key="chart.key" :points="chart.line" />
          </svg>
        </div>

        <div class="chart__what">{{ chart.what }}</div>
      </figure>
    </div>

    <template #footer>
      <div class="memory-monitor-foot">
        <div class="legend">пунктир — нижняя огибающая: куда линия возвращается после сборки</div>
        <div class="dx" :data-tone="current.tone">{{ current.dx }}</div>
      </div>
    </template>
  </DemoFrame>
</template>

<style scoped>
.bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.bar__label {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}

.charts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr));
}
.chart {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  padding: 20px;
  border-right: 1px solid var(--divider);
  min-width: 0;
}
.chart:last-child {
  border-right: 0;
}

.chart__head {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
}
.chart__name {
  font-family: var(--mono);
  font-size: var(--fs-4);
  font-weight: 600;
}
.chart__name[data-key='heap'] {
  color: var(--accent);
}
.chart__name[data-key='dom'] {
  color: var(--warning);
}
.chart__name[data-key='listeners'] {
  color: var(--success);
}
.chart__verdict {
  font-family: var(--mono);
  font-size: var(--fs-3);
}
.chart__verdict[data-leaks='no'] {
  color: var(--text-faint);
}
.chart__verdict[data-leaks='yes'] {
  color: var(--tone-err-strong);
}

.scroll {
  min-width: 0;
  overflow-x: auto;
}
.plot {
  display: block;
  width: 100%;
  min-width: 200px;
  height: auto;
  fill: none;
}
.axis {
  stroke: var(--hairline);
  stroke-width: 1;
}
.line {
  stroke-width: 1.5;
  stroke-linejoin: round;
}
.line[data-key='heap'] {
  stroke: var(--bar-violet);
}
.line[data-key='dom'] {
  stroke: var(--bar-amber);
}
.line[data-key='listeners'] {
  stroke: var(--bar-green);
}
.floor {
  stroke: var(--dim);
  stroke-width: 1;
  stroke-dasharray: 3 3;
}

.chart__what {
  font-size: var(--fs-6);
  line-height: 1.55;
  color: var(--prose);
}

.memory-monitor-foot {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.legend {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-faint);
}
.dx {
  padding: 14px 16px;
  border-radius: var(--r2);
  font-size: var(--fs-6);
  line-height: 1.6;
  transition: all 0.2s;
}
.dx[data-tone='warn'] {
  border: 1px solid var(--tone-warn-line);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.dx[data-tone='err'] {
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}
</style>
