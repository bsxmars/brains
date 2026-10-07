<script setup lang="ts">
/**
 * Сколько ждал отклик: четыре расклада одного клика на одной оси.
 *
 * Почему с осью, а не полосками. Разница между «одна задача» и «нарезка» — это 424 мс против 16,
 * то есть больше двух порядков; полоска без шкалы сказала бы «левая длиннее», и читатель ушёл бы
 * с ощущением «немного лучше». Ось с делениями и порогом метрики превращает картинку в измерение.
 *
 * Столбик разрезан на три слагаемых метрики — ожидание потока, работу обработчиков и сборку
 * кадра, — потому что лечатся они тремя разными способами. Видно и то, ради чего демо вообще
 * построено: у варианта с микрозадачей `processing` ровно тот же, что у исходного. Микрозадача
 * не отдаёт поток, и метрика это честно показывает.
 *
 * Числа — замер в Chromium 153 (Playwright, headless), а не модель.
 */
import { computed, ref } from 'vue';
import { linear, niceTicks } from '@/shared/lib/chart';
import ChartFrame from '@/shared/ui/ChartFrame.vue';
import CodeListing from '@/shared/ui/CodeListing.vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import type { InpMode } from '../model/types';

const props = withDefaults(
  defineProps<{
    modes: InpMode[];
    /** Порог «хорошо» у метрики, мс. */
    good?: number;
  }>(),
  { good: 200 },
);

const WIDTH = 720;
const HEIGHT = 236;
const PAD = { top: 14, right: 22, bottom: 34, left: 132 };
const PLOT_W = WIDTH - PAD.left - PAD.right;
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;

const modeKey = ref(props.modes[0].key);
const options = computed(() => props.modes.map((m) => ({ value: m.key, label: m.label })));
const current = computed(() => props.modes.find((m) => m.key === modeKey.value) ?? props.modes[0]);

/** Верх шкалы — круглое число над максимумом: столбик не должен упираться в рамку. */
const maxMs = computed(() => Math.max(...props.modes.map((m) => m.total)) * 1.06);
const x = computed(() => linear([0, maxMs.value], [0, PLOT_W]));

const xTicks = computed(() =>
  niceTicks([0, maxMs.value], 5)
    .filter((t) => t <= maxMs.value)
    .map((t) => ({ at: x.value(t), label: String(t) })),
);

const rowHeight = computed(() => PLOT_H / props.modes.length);
const rowCenter = (i: number) => rowHeight.value * i + rowHeight.value / 2;
const BAR = 26;

const yTicks = computed(() =>
  props.modes.map((mode, i) => ({ at: rowCenter(i), label: mode.label })),
);

/** Три слагаемых метрики подряд — столбик и есть сумма. */
const segmentsOf = (mode: InpMode) => {
  const parts = [
    { key: 'delay', ms: mode.inputDelay },
    { key: 'processing', ms: mode.processing },
    { key: 'presentation', ms: mode.presentation },
  ];
  let at = 0;
  return parts.map((part) => {
    const from = at;
    at += part.ms;
    return { ...part, x: x.value(from), width: Math.max(1, x.value(at) - x.value(from)) };
  });
};

const goodAt = computed(() => x.value(props.good));
const codeLines = computed(() => current.value.code.split('\n'));
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="bar">
        <span class="t-label">один и тот же клик · работы всюду на 400 мс</span>
        <SegmentedControl v-model="modeKey" class="l-pills" label="Расклад обработчика" :options="options" />
      </div>
    </template>

    <div class="body">
      <ChartFrame
        :width="WIDTH"
        :height="HEIGHT"
        :pad="PAD"
        :x-ticks="xTicks"
        :y-ticks="yTicks"
        x-label="мс до следующей отрисовки"
      >
        <!-- Порог метрики — линия, а не подпись в легенде: столбик либо левее неё, либо нет. -->
        <line class="threshold" :x1="goodAt" :x2="goodAt" y1="0" :y2="PLOT_H" />
        <text class="threshold__label" :x="goodAt + 5" y="10">good ≤ {{ good }}</text>

        <g
          v-for="(mode, i) in modes"
          :key="mode.key"
          :data-active="mode.key === modeKey ? 'yes' : 'no'"
          class="row"
        >
          <rect
            v-for="segment in segmentsOf(mode)"
            :key="segment.key"
            class="segment"
            :data-part="segment.key"
            :x="segment.x"
            :y="rowCenter(i) - BAR / 2"
            :width="segment.width"
            :height="BAR"
          />
          <text class="total" :x="x(mode.total) + 8" :y="rowCenter(i)" dominant-baseline="middle">
            {{ mode.total }} мс
          </text>
        </g>
      </ChartFrame>

      <div class="legend">
        <span class="legend__item"><i data-part="delay"></i>input delay</span>
        <span class="legend__item"><i data-part="processing"></i>processing time</span>
        <span class="legend__item"><i data-part="presentation"></i>presentation delay</span>
      </div>

      <div class="detail">
        <CodeListing :lines="codeLines" :label="current.label" />

        <div class="numbers">
          <div class="num">
            <span class="t-label">взаимодействие</span>
            <span class="num__value" :data-tone="current.tone">{{ current.total }} мс</span>
          </div>
          <div class="num">
            <span class="t-label">самая длинная задача</span>
            <span class="num__value" :data-tone="current.longTask ? 'err' : 'ok'">
              {{ current.longTask ? `${current.longTask} мс` : 'нет' }}
            </span>
          </div>
          <div class="num">
            <span class="t-label">из них обработчик</span>
            <span class="num__value" data-tone="ink">{{ current.processing }} мс</span>
          </div>
        </div>
      </div>

      <Md class="note" :data-tone="current.tone" :text="current.note" />
    </div>

    <template #footer>
      <div class="disclaimer">
        Замер: Chromium 153 (Playwright, headless), обработчик занимает поток ровно на 400 мс,
        нарезка — кусками по 8 мс через <code>scheduler.yield()</code>. Значения
        <code>duration</code> кратны 8 мс —
        Event Timing огрубляет их намеренно, это защита от тайминговых сайд-каналов. Работы
        во всех четырёх раскладах поровну: меняется не объём, а то, успевает ли браузер
        нарисовать кадр.
      </div>
    </template>
  </DemoFrame>
</template>

<style scoped>
.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}

.body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 22px 20px;
}

.threshold {
  stroke: var(--tone-ok-strong);
  stroke-width: 1;
  stroke-dasharray: 4 3;
}
.threshold__label {
  fill: var(--tone-ok-strong);
  font-family: var(--mono);
  font-size: var(--fs-1);
}

.row[data-active='no'] {
  opacity: 0.42;
}
.segment {
  transition: opacity 0.2s;
}
.segment[data-part='delay'] {
  fill: var(--bar-neutral);
}
.segment[data-part='processing'] {
  fill: var(--bar-violet);
}
.segment[data-part='presentation'] {
  fill: var(--bar-amber);
}
.total {
  fill: var(--ink);
  font-family: var(--mono);
  font-size: var(--fs-2);
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
}
.legend__item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.legend__item i {
  width: 14px;
  height: 10px;
  border-radius: 2px;
}
.legend__item i[data-part='delay'] {
  background: var(--bar-neutral);
}
.legend__item i[data-part='processing'] {
  background: var(--bar-violet);
}
.legend__item i[data-part='presentation'] {
  background: var(--bar-amber);
}

.detail {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
  gap: 18px;
  align-items: start;
}
.numbers {
  display: flex;
  flex-direction: column;
  gap: 11px;
  min-width: 0;
}
.num {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.num__value {
  font-family: var(--mono);
  font-size: var(--fs-7);
  transition: color 0.2s;
}
.num__value[data-tone='ink'] {
  color: var(--ink);
}
.num__value[data-tone='ok'] {
  color: var(--tone-ok-strong);
}
.num__value[data-tone='warn'] {
  color: var(--tone-warn-strong);
}
.num__value[data-tone='err'] {
  color: var(--tone-err-strong);
}

.note {
  padding: 14px 16px;
  border-radius: var(--r2);
  font-size: var(--fs-6);
  line-height: 1.6;
}
.note[data-tone='ok'] {
  border: 1px solid var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.note[data-tone='warn'] {
  border: 1px solid var(--tone-warn-line);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.note[data-tone='err'] {
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}

.disclaimer {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}

@media (max-width: 640px) {
  .detail {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
