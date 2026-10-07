<script setup lang="ts">
/**
 * График heap во времени: пила Scavenge и Major GC, нижняя огибающая, маркеры событий.
 *
 * Главное здесь — не линия, а **огибающая**: диагноз ставится по минимумам после сборок,
 * а не по пикам. Поэтому огибающая считается из тех же точек, что и линия, и её значения
 * выписаны числами рядом. Разойтись с картинкой они не могут: в оригинале текст обещал
 * ускоряющийся рост, а нарисована была ровная линейная пила — здесь такое невозможно
 * по устройству.
 *
 * Виджет ничего не знает про конкретный сценарий: пресеты приходят пропом и переиспользуются
 * соседними уроками.
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import { SegmentedControl } from '@/shared/ui';
import type { HeapPreset } from '../model/types';

const props = defineProps<{ presets: HeapPreset[]; unit?: string }>();

const W = 720;
const H = 210;
const PAD_TOP = 12;
const PAD_BOTTOM = 26;

const picked = ref(props.presets[0].key);
const preset = computed(() => props.presets.find((p) => p.key === picked.value) ?? props.presets[0]);
const options = computed(() => props.presets.map((p) => ({ value: p.key, label: p.label })));

const unitLabel = computed(() => props.unit ?? 'МБ');

const scale = computed(() => {
  const values = preset.value.points;
  const max = Math.max(...values);
  const min = Math.min(...values);
  // Немного воздуха сверху и снизу, иначе линия липнет к рамке.
  const top = max + (max - min) * 0.08;
  const bottom = Math.max(0, min - (max - min) * 0.18);
  return {
    max,
    min,
    x: (i: number) => (i / (values.length - 1)) * W,
    y: (v: number) => PAD_TOP + (1 - (v - bottom) / (top - bottom)) * (H - PAD_TOP - PAD_BOTTOM),
  };
});

const line = computed(() =>
  preset.value.points.map((v, i) => `${scale.value.x(i).toFixed(1)},${scale.value.y(v).toFixed(1)}`).join(' '),
);

/** Точки Major GC — это и есть нижняя огибающая: сколько осталось, когда собрали всё. */
const envelope = computed(() =>
  preset.value.gc
    .filter((g) => g.kind === 'major')
    .map((g) => ({ at: g.at, value: preset.value.points[g.at] })),
);

const envelopeLine = computed(() =>
  envelope.value.map((p) => `${scale.value.x(p.at).toFixed(1)},${scale.value.y(p.value).toFixed(1)}`).join(' '),
);

const minorGc = computed(() =>
  preset.value.gc
    .filter((g) => g.kind === 'minor')
    .map((g) => ({ x: scale.value.x(g.at), y: scale.value.y(preset.value.points[g.at]) })),
);

const majorGc = computed(() =>
  envelope.value.map((p) => ({ x: scale.value.x(p.at), y: scale.value.y(p.value) })),
);

const markers = computed(() =>
  (preset.value.markers ?? []).map((m) => ({ ...m, x: scale.value.x(m.at) })),
);

/** Прирост огибающей за цикл — то самое число, ради которого график и смотрят. */
const drift = computed(() => {
  const points = envelope.value;
  if (points.length < 2) return 0;
  return Math.round((points[points.length - 1].value - points[0].value) / (points.length - 1));
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="bar">
        <span class="bar__label">один и тот же сценарий, две разных программы:</span>
        <SegmentedControl v-model="picked" class="l-pills" label="Что за график" :options="options" />
      </div>
    </template>

    <div class="body">
      <div class="scroll">
        <svg :viewBox="`0 0 ${W} ${H}`" class="chart" role="img" :aria-label="`График занятой памяти: ${preset.label}`">
          <title>{{ `График занятой памяти: ${preset.label}` }}</title>

          <!-- Огибающая: пунктир по минимумам после Major GC. Диагноз читают по ней. -->
          <polyline class="envelope" :points="envelopeLine" />

          <polyline class="line" :data-tone="preset.tone" :points="line" />

          <circle v-for="(p, i) in minorGc" :key="`minor-${i}`" class="dot dot--minor" :cx="p.x" :cy="p.y" r="2.5" />
          <circle
            v-for="(p, i) in majorGc"
            :key="`major-${i}`"
            class="dot dot--major"
            :data-tone="preset.tone"
            :cx="p.x"
            :cy="p.y"
            r="4"
          />

          <template v-for="(m, i) in markers" :key="`mark-${i}`">
            <line class="marker" :x1="m.x" :y1="PAD_TOP" :x2="m.x" :y2="H - PAD_BOTTOM" />
            <text class="marker-label" :x="m.x + 5" :y="PAD_TOP + 11">{{ m.label }}</text>
          </template>

          <text class="axis" x="0" :y="H - 8">время</text>
          <text class="axis axis--end" :x="W" :y="H - 8">
            пик {{ scale.max }} {{ unitLabel }} · минимум {{ scale.min }} {{ unitLabel }}
          </text>
        </svg>
      </div>

      <div class="legend">
        <span class="legend__item" data-kind="minor"><i data-kind="minor"></i>Scavenge</span>
        <span class="legend__item" data-kind="major" :data-tone="preset.tone"><i data-kind="major" :data-tone="preset.tone"></i>Major GC</span>
        <span class="legend__item" data-kind="envelope"><i data-kind="envelope"></i>нижняя огибающая</span>
      </div>

      <div class="field">
        <div class="t-label">нижняя огибающая · {{ unitLabel }} после каждой полной сборки</div>
        <div class="envelope-row">
          <template v-for="(p, i) in envelope" :key="p.at">
            <span v-if="i > 0" class="envelope-row__arrow">→</span>
            <span class="envelope-row__value" :data-tone="preset.tone">{{ p.value }}</span>
          </template>
          <span class="envelope-row__drift" :data-tone="preset.tone">
            {{ drift === 0 ? 'прирост 0 — минимум стоит на месте' : `+${drift} ${unitLabel} за цикл` }}
          </span>
        </div>
      </div>

      <div class="verdict" :data-tone="preset.tone">{{ preset.verdict }}</div>
    </div>

    <template #footer>
      <div class="disclaimer">
        Пики зависят от того, в какой момент вы посмотрели, поэтому минимум меряют сразу после
        полной сборки: в браузере — кнопкой сборки мусора на вкладке Memory, в Node — по числу
        после стрелки у строк <code>Mark-Compact</code> в <code>--trace-gc</code>.
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
.bar__label {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}

.body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 22px 20px;
  min-width: 0;
}

.scroll {
  min-width: 0;
  overflow-x: auto;
}
.chart {
  display: block;
  width: 100%;
  min-width: 520px;
  height: auto;
  /* У корневого svg заливка иначе браузерная чёрная — цвета, которого в курсе нет. */
  fill: none;
}

.line {
  fill: none;
  stroke-width: 1.5;
}
.line[data-tone='ok'] {
  stroke: var(--tone-ok-strong);
}
.line[data-tone='err'] {
  stroke: var(--tone-err-strong);
}

.envelope {
  fill: none;
  stroke: var(--dim);
  stroke-width: 1;
  stroke-dasharray: 5 4;
}

.dot--minor {
  fill: var(--bar-neutral);
  stroke: none;
}
.dot--major[data-tone='ok'] {
  fill: var(--tone-ok-strong);
}
.dot--major[data-tone='err'] {
  fill: var(--tone-err-strong);
}

.marker {
  stroke: var(--hairline);
  stroke-width: 1;
  stroke-dasharray: 2 3;
}
.marker-label {
  font-family: var(--mono);
  font-size: var(--fs-1);
  fill: var(--text-faint);
}

.axis {
  font-family: var(--mono);
  font-size: var(--fs-1);
  fill: var(--dim);
}
.axis--end {
  text-anchor: end;
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
  width: 12px;
  height: 3px;
  border-radius: 2px;
}
.legend__item i[data-kind='minor'] {
  background: var(--bar-neutral);
}
.legend__item i[data-kind='major'][data-tone='ok'] {
  background: var(--tone-ok-strong);
}
.legend__item i[data-kind='major'][data-tone='err'] {
  background: var(--tone-err-strong);
}
.legend__item i[data-kind='envelope'] {
  background: var(--dim);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.envelope-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.envelope-row__arrow {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-faint);
}
.envelope-row__value {
  font-family: var(--mono);
  font-size: var(--fs-6);
  transition: color 0.2s;
}
.envelope-row__value[data-tone='ok'] {
  color: var(--tone-ok-strong);
}
.envelope-row__value[data-tone='err'] {
  color: var(--tone-err-strong);
}
.envelope-row__drift {
  margin-left: 4px;
  padding: 4px 9px;
  border-radius: var(--r-full);
  font-family: var(--mono);
  font-size: var(--fs-2);
}
.envelope-row__drift[data-tone='ok'] {
  background: var(--tone-ok-chip);
  color: var(--tone-ok-strong);
}
.envelope-row__drift[data-tone='err'] {
  background: var(--tone-err-chip);
  color: var(--tone-err-strong);
}

.verdict {
  padding: 14px 16px;
  border-radius: var(--r2);
  font-size: var(--fs-6);
  line-height: 1.6;
  transition: all 0.2s;
}
.verdict[data-tone='ok'] {
  border: 1px solid var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.verdict[data-tone='err'] {
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}

.disclaimer {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}
</style>
