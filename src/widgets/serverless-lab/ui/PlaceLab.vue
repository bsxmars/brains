<script setup lang="ts">
/**
 * «Посчитать для своего случая»: один и тот же ответ функции на edge у пользователя и в
 * регионе у базы — из чего складывается время и когда приходят первые байты.
 *
 * Считает строка `LATENCY_CODE` из темы (`compare`), собранная `new Function` (`model/run.ts`);
 * её же сверяет с аналитической границей `tests/unit/serverless-edge.test.ts`. Компонент
 * только раскладывает три слагаемых по полосам.
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { loadLatency } from '../model/run';
import type { LatencyParts, PlacePreset } from '../model/types';

const props = defineProps<{
  code: string;
  presets: PlacePreset[];
  /** Круг до точки присутствия, мс. */
  near: number;
  /** Круг от функции до базы внутри региона, мс. */
  local: number;
  /** Кругов на новое соединение (снято стендом). */
  setupTrips: number;
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const { compare } = loadLatency(props.code);

const presetId = ref(props.presets[1]?.id ?? props.presets[0].id);
const queries = ref('1');
const conn = ref('warm');
const stream = ref('no');

const presetOptions = props.presets.map((p) => ({ value: p.id, label: `${p.label} · ${p.far} мс` }));
const queryOptions = ['0', '1', '2', '3', '5'].map((v) => ({ value: v, label: v }));
const connOptions = [
  { value: 'warm', label: 'из пула' },
  { value: 'new', label: 'новое' },
];
const streamOptions = [
  { value: 'no', label: 'целиком' },
  { value: 'yes', label: 'потоком' },
];

const preset = computed(() => props.presets.find((p) => p.id === presetId.value) ?? props.presets[0]);
const result = computed(() =>
  compare({
    near: props.near,
    far: preset.value.far,
    local: props.local,
    queries: Number(queries.value),
    setupTrips: conn.value === 'new' ? props.setupTrips : 0,
    stream: stream.value === 'yes',
  }),
);

const scale = computed(() => Math.max(result.value.edge.total, result.value.region.total, 1));
const pct = (ms: number) => `${(ms / scale.value) * 100}%`;

const rows = computed(() => {
  const r = result.value;
  const mk = (id: string, title: string, where: string, parts: LatencyParts) => ({
    id,
    title,
    where,
    parts,
    user: parts.total - parts.setup - parts.db,
  });
  return [
    mk('edge', 'edge', `точка присутствия в городе пользователя, база — во Франкфурте`, r.edge),
    mk('region', 'регион', `функция во Франкфурте, рядом с базой`, r.region),
  ];
});

const verdict = computed(() => {
  const { edge, region } = result.value;
  if (edge.total === region.total) return `Поровну: ${edge.total} мс.`;
  const win = edge.total < region.total ? 'edge' : 'регион';
  const a = Math.min(edge.total, region.total);
  const b = Math.max(edge.total, region.total);
  const ttfb = stream.value === 'yes' ? ` Первые байты: edge через ${edge.ttfb} мс, регион через ${region.ttfb} мс.` : '';
  return `Быстрее ${win}: ${a} мс против ${b} мс.${ttfb}`;
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="svp-controls">
        <div class="svp-control">
          <span class="t-label">пользователь · круг до Франкфурта</span>
          <SegmentedControl v-model="presetId" class="l-pills" label="Где пользователь" :options="presetOptions" />
        </div>
        <div class="svp-control">
          <span class="t-label">запросов к базе подряд</span>
          <SegmentedControl v-model="queries" class="l-pills" label="Запросов к базе" :options="queryOptions" />
        </div>
        <div class="svp-control">
          <span class="t-label">соединение</span>
          <SegmentedControl v-model="conn" class="l-pills" label="Соединение с базой" :options="connOptions" />
        </div>
        <div class="svp-control">
          <span class="t-label">ответ</span>
          <SegmentedControl v-model="stream" class="l-pills" label="Как отдаётся ответ" :options="streamOptions" />
        </div>
      </div>
    </template>

    <div class="svp-body">
      <div v-for="r in rows" :key="r.id" class="svp-row">
        <div class="svp-head">
          <span class="svp-title">{{ r.title }}</span>
          <span class="svp-where">{{ r.where }}</span>
          <span class="svp-total">{{ r.parts.total }} мс</span>
        </div>
        <div class="svp-track" role="img" :aria-label="`${r.title}: всего ${r.parts.total} мс, первые байты через ${r.parts.ttfb} мс`">
          <span class="svp-seg svp-seg--user" :style="{ width: pct(r.user) }" />
          <span class="svp-seg svp-seg--setup" :style="{ width: pct(r.parts.setup) }" />
          <span class="svp-seg svp-seg--db" :style="{ width: pct(r.parts.db) }" />
          <span class="svp-ttfb" :style="{ left: pct(r.parts.ttfb) }" />
        </div>
        <div class="svp-parts">
          <span>до функции {{ r.user }} мс</span>
          <span>соединение {{ r.parts.setup }} мс</span>
          <span>запросы {{ r.parts.db }} мс</span>
          <span>первые байты {{ r.parts.ttfb }} мс</span>
        </div>
      </div>

      <div class="svp-legend">
        <span class="svp-key svp-key--user">круг пользователь — функция</span>
        <span class="svp-key svp-key--setup">установка соединения</span>
        <span class="svp-key svp-key--db">запросы к базе</span>
        <span class="svp-key svp-key--ttfb">первые байты</span>
      </div>

      <p class="svp-verdict">{{ verdict }}</p>

      <Md class="svp-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.svp-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 20px;
}
.svp-control {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.svp-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.svp-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
  min-width: 0;
}
.svp-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 12px;
}
.svp-title {
  font-family: var(--mono);
  font-size: var(--fs-4);
  font-weight: 600;
  color: var(--ink);
}
.svp-where {
  flex: 1 1 200px;
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.svp-total {
  font-family: var(--mono);
  font-size: var(--fs-4);
  font-weight: 600;
  color: var(--ink);
}
.svp-track {
  position: relative;
  display: flex;
  height: 18px;
  border-radius: var(--r2);
  background: var(--surface-3);
  overflow: visible;
}
.svp-seg {
  display: block;
  height: 100%;
}
.svp-seg:first-child {
  border-radius: var(--r2) 0 0 var(--r2);
}
.svp-seg--user {
  background: var(--bar-violet);
}
.svp-seg--setup {
  background: var(--bar-red);
}
.svp-seg--db {
  background: var(--bar-amber);
}
.svp-ttfb {
  position: absolute;
  top: -4px;
  bottom: -4px;
  width: 3px;
  margin-left: -1.5px;
  border-radius: 2px;
  background: var(--ink);
}
.svp-parts {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.svp-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 18px;
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.svp-key {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.svp-key::before {
  content: '';
  display: inline-block;
  width: 14px;
  height: 10px;
  border-radius: 2px;
}
.svp-key--user::before {
  background: var(--bar-violet);
}
.svp-key--setup::before {
  background: var(--bar-red);
}
.svp-key--db::before {
  background: var(--bar-amber);
}
.svp-key--ttfb::before {
  width: 3px;
  height: 14px;
  background: var(--ink);
}
.svp-verdict {
  margin: 0;
  font-size: var(--fs-3);
  font-weight: 600;
  color: var(--ink);
}
.svp-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.svp-caption :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
</style>
