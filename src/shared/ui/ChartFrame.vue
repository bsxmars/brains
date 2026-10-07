<script setup lang="ts">
/**
 * Рамка графика: поле, оси, засечки и подписи. Сами данные рисует тот, кто её использует.
 *
 * До сих пор «диаграммы» курса были полосками `div`: видно, что один столбик длиннее другого,
 * и не видно, во сколько раз. Ось с числами превращает картинку в измерение — а измерение
 * и есть то, ради чего урок приводит цифры.
 *
 * Компонент намеренно ничего не знает о данных: он принимает уже посчитанные засечки
 * (`shared/lib/chart.ts` даёт шкалы и круглые деления) и отдаёт слоту систему координат.
 * Так одна рамка обслуживает и столбики, и линии, и точки — а вид осей остаётся общим.
 *
 * Масштабируется через `viewBox`, но не ниже натуральной ширины: на телефоне график раньше
 * ужимался целиком, и подписи осей выходили в 4–5px (замер на 375px, 2026-09-29) — цифры
 * были, прочесть их было нельзя. Теперь уже натуральной ширины график не становится, а
 * прокручивается внутри рамки, как широкая таблица; страница вбок не уезжает.
 */
interface Tick {
  /** Координата в пикселях внутри поля. */
  at: number;
  label: string;
}

const props = withDefaults(
  defineProps<{
    width?: number;
    height?: number;
    /** Поля под подписи осей: слева шире — там числа. */
    pad?: { top: number; right: number; bottom: number; left: number };
    xTicks?: Tick[];
    yTicks?: Tick[];
    /** Единицы измерения — подпись у оси, а не в каждой засечке. */
    xLabel?: string;
    yLabel?: string;
  }>(),
  {
    width: 720,
    height: 260,
    pad: () => ({ top: 14, right: 16, bottom: 30, left: 52 }),
    xTicks: () => [],
    yTicks: () => [],
    xLabel: '',
    yLabel: '',
  },
);

const plotWidth = props.width - props.pad.left - props.pad.right;
const plotHeight = props.height - props.pad.top - props.pad.bottom;
</script>

<template>
  <div class="frame" :style="{ '--chart-w': `${width}px` }">
    <svg :viewBox="`0 0 ${width} ${height}`" role="img" preserveAspectRatio="xMidYMid meet">
      <g :transform="`translate(${pad.left}, ${pad.top})`">
        <!-- Сетка идёт под данными и нарочно бледная: она помогает свериться, а не смотрится. -->
        <line
          v-for="tick in yTicks"
          :key="`gy-${tick.at}`"
          class="grid"
          x1="0"
          :x2="plotWidth"
          :y1="tick.at"
          :y2="tick.at"
        />

        <line class="axis" x1="0" :y1="plotHeight" :x2="plotWidth" :y2="plotHeight" />
        <line class="axis" x1="0" y1="0" x2="0" :y2="plotHeight" />

        <text
          v-for="tick in yTicks"
          :key="`ty-${tick.at}`"
          class="tick"
          x="-8"
          :y="tick.at"
          text-anchor="end"
          dominant-baseline="middle"
        >
          {{ tick.label }}
        </text>

        <text
          v-for="tick in xTicks"
          :key="`tx-${tick.at}`"
          class="tick"
          :x="tick.at"
          :y="plotHeight + 18"
          text-anchor="middle"
        >
          {{ tick.label }}
        </text>

        <slot :width="plotWidth" :height="plotHeight" />
      </g>

      <text v-if="xLabel" class="label" :x="width - pad.right" :y="height - 4" text-anchor="end">
        {{ xLabel }}
      </text>
      <text v-if="yLabel" class="label" x="4" y="10">{{ yLabel }}</text>
    </svg>
  </div>
</template>

<style scoped>
.frame {
  min-width: 0;
  overflow-x: auto;
}
svg {
  display: block;
  width: 100%;
  min-width: var(--chart-w);
  height: auto;
  /* У корневого `svg` свой цвет заливки по умолчанию — в палитре курса его нет. */
  fill: none;
}

.grid {
  stroke: var(--rule);
  stroke-width: 1;
}
.axis {
  stroke: var(--border-strong);
  stroke-width: 1;
}
.tick {
  fill: var(--text-faint);
  font-family: var(--mono);
  font-size: var(--fs-1);
}
.label {
  fill: var(--dim);
  font-family: var(--mono);
  font-size: var(--fs-1);
}
</style>
