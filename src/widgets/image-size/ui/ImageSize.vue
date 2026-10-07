<script setup lang="ts">
/**
 * Сколько весит образ — с осью, а не «на глаз».
 *
 * Полосы здесь линейные, а не логарифмические, и это выбор по содержанию. Вся мысль раздела
 * в том, что `node:22` рядом с `node:22-alpine` — это не «немного больше», а **в семь раз
 * больше**; логарифм это отношение бы и спрятал, сделав из семикратного разрыва одну ступеньку.
 * Там, где величины разъезжаются на порядки и важен сам рост, в курсе стоит `log-bars` —
 * здесь важен как раз масштаб разрыва.
 *
 * Числа приходят пропом и сняты `docker image inspect --format '{{.Size}}'` на живом демоне.
 * Компонент их не считает и не округляет: он их только показывает.
 */
import { computed } from 'vue';
import ChartFrame from '@/shared/ui/ChartFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { extent, linear, niceTicks } from '@/shared/lib/chart';
import type { SizeBar } from '../model/types';

const props = withDefaults(
  defineProps<{
    bars: SizeBar[];
    /** Единица оси — подпись под ней. */
    unit?: string;
    /** Подпись под диаграммой: чем и на чём снято. Разрешена строчная разметка. */
    caption?: string;
  }>(),
  { unit: 'МБ', caption: '' },
);

const WIDTH = 720;
const BAND = 46;
const BAR_H = 20;
const PAD = { top: 12, right: 18, bottom: 32, left: 172 };
const PLOT_W = WIDTH - PAD.left - PAD.right;

const height = computed(() => PAD.top + PAD.bottom + props.bars.length * BAND);

/**
 * Запас справа обязателен: подпись значения стоит за концом полосы, и без запаса у самой
 * длинной она уехала бы за рамку графика.
 */
const domain = computed(() =>
  extent(
    props.bars.map((b) => b.value),
    0.14,
  ),
);
const ticks = computed(() => niceTicks(domain.value, 5));
const hi = computed(() => Math.max(domain.value[1], ...ticks.value));
const x = computed(() => linear([0, hi.value], [0, PLOT_W]));

const xTicks = computed(() => ticks.value.map((t) => ({ at: x.value(t), label: String(t) })));

const rows = computed(() =>
  props.bars.map((bar, i) => ({
    ...bar,
    // Самая короткая полоса обязана остаться полосой, а не исчезнуть в оси.
    w: Math.max(2, x.value(bar.value)),
    y: i * BAND + (BAND - BAR_H) / 2,
    mid: i * BAND + BAND / 2,
  })),
);
</script>

<template>
  <figure class="chart">
    <ChartFrame :width="WIDTH" :height="height" :pad="PAD" :x-ticks="xTicks" :x-label="unit">
      <g v-for="row in rows" :key="row.label">
        <text
          class="cat"
          x="-12"
          :y="row.note ? row.mid - 7 : row.mid"
          text-anchor="end"
          dominant-baseline="middle"
        >
          {{ row.label }}
        </text>
        <text
          v-if="row.note"
          class="cat cat--note"
          x="-12"
          :y="row.mid + 8"
          text-anchor="end"
          dominant-baseline="middle"
        >
          {{ row.note }}
        </text>

        <rect
          class="bar"
          :data-tone="row.tone ?? 'neutral'"
          x="0"
          :y="row.y"
          :width="row.w"
          :height="BAR_H"
          rx="3"
        />

        <text class="value" :x="row.w + 9" :y="row.mid" dominant-baseline="middle">
          {{ row.text }}
        </text>
      </g>
    </ChartFrame>

    <Md v-if="caption" class="caption" :text="caption" />
  </figure>
</template>

<style scoped>
.chart {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 0;
}

.cat {
  fill: var(--prose);
  font-family: var(--mono);
  font-size: var(--fs-2);
}
.cat--note {
  fill: var(--text-faint);
  font-family: var(--font);
  font-size: var(--fs-1);
}

.value {
  fill: var(--ink);
  font-family: var(--mono);
  font-size: var(--fs-2);
}

.bar[data-tone='ok'] {
  fill: var(--bar-green);
}
.bar[data-tone='warn'] {
  fill: var(--bar-amber);
}
.bar[data-tone='err'] {
  fill: var(--bar-red);
}
.bar[data-tone='info'] {
  fill: var(--bar-violet);
}
.bar[data-tone='neutral'] {
  fill: var(--bar-neutral);
}

.caption {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}
</style>
