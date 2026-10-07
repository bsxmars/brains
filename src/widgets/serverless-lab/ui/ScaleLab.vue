<script setup lang="ts">
/**
 * «Три профиля трафика, две платформы, одна база»: сколько экземпляров поднимется, сколько
 * из них холодных и сколько соединений они попросят у Postgres.
 *
 * Считает не компонент, а строка `SCALE_CODE` из темы, собранная `new Function`
 * (`model/run.ts`). Рядом — вывод эмулятора платформы на настоящем Postgres (`STAND_RUNS`);
 * демо сравнивает их по каждой точке, и то же сравнение требует
 * `tests/unit/serverless-edge.test.ts`. Компонент только рисует.
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { loadSimulate, standTimeline } from '../model/run';
import type { ScalePlatform, ScaleProfile, StandRun } from '../model/types';

const props = defineProps<{
  code: string;
  profiles: ScaleProfile[];
  platforms: ScalePlatform[];
  /** Вывод эмулятора, ключ — `профиль/платформа`. */
  stand: Record<string, StandRun>;
  keepWarm: number;
  dbLimit: number;
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const simulate = loadSimulate(props.code);

const profileId = ref(props.profiles[1]?.id ?? props.profiles[0].id);
const platformId = ref(props.platforms[0].id);
const profileOptions = props.profiles.map((p) => ({ value: p.id, label: p.label }));
const platformOptions = props.platforms.map((p) => ({ value: p.id, label: p.label }));

const profile = computed(() => props.profiles.find((p) => p.id === profileId.value) ?? props.profiles[0]);
const platform = computed(() => props.platforms.find((p) => p.id === platformId.value) ?? props.platforms[0]);

const result = computed(() =>
  simulate(profile.value.requests, {
    concurrency: platform.value.concurrency,
    poolMax: platform.value.poolMax,
    keepWarm: props.keepWarm,
    dbLimit: props.dbLimit,
  }),
);
const standRun = computed(() => props.stand[`${profile.value.id}/${platform.value.id}`]);
const agree = computed(() => {
  const s = standRun.value;
  if (!s) return null;
  return JSON.stringify(standTimeline(s)) === JSON.stringify(result.value.timeline);
});

const stats = computed(() => [
  { k: 'запросов', v: String(profile.value.requests.length), tone: '' },
  { k: 'холодных стартов', v: String(result.value.coldStarts), tone: result.value.coldStarts > 3 ? 'warn' : '' },
  { k: 'экземпляров в пик', v: String(result.value.peakInstances), tone: '' },
  { k: `соединений в пик (лимит ${props.dbLimit})`, v: String(result.value.peakConns), tone: result.value.peakConns >= props.dbLimit ? 'err' : '' },
  { k: 'отказов базы', v: String(result.value.refused), tone: result.value.refused > 0 ? 'err' : 'ok' },
  { k: 'дольше всех ждал пула', v: `${result.value.maxWait} мс`, tone: result.value.maxWait > 0 ? 'warn' : '' },
]);

// ── График: ступеньки экземпляров и соединений во времени ──────────────────────────────────
const W = 860;
const H = 280;
const PAD = { l: 34, r: 12, t: 12, b: 30 };

const tMax = computed(() => Math.max(...result.value.timeline.map((p) => p.t), 1));
const yMax = computed(() => Math.max(props.dbLimit + 2, result.value.peakInstances, result.value.peakConns));
const x = (t: number) => PAD.l + (t / tMax.value) * (W - PAD.l - PAD.r);
const y = (v: number) => H - PAD.b - (v / yMax.value) * (H - PAD.t - PAD.b);

function steps(key: 'instances' | 'conns') {
  const pts = result.value.timeline;
  if (!pts.length) return '';
  let d = `M ${x(0)} ${y(0)} L ${x(pts[0].t)} ${y(0)}`;
  let prev = 0;
  for (const p of pts) {
    d += ` L ${x(p.t)} ${y(prev)} L ${x(p.t)} ${y(p[key])}`;
    prev = p[key];
  }
  return d;
}
const instPath = computed(() => steps('instances'));
const connPath = computed(() => steps('conns'));
/** Точки стенда: соединения, которые Postgres видел у эмулятора в каждый момент. */
const standDots = computed(() => (standRun.value ? standTimeline(standRun.value) : []));

const xTicks = computed(() => {
  const step = tMax.value > 3000 ? 1000 : 500;
  const out: number[] = [];
  for (let t = 0; t <= tMax.value; t += step) out.push(t);
  return out;
});
const yTicks = computed(() => {
  const step = yMax.value > 12 ? 5 : 1;
  const out: number[] = [];
  for (let v = 0; v <= yMax.value; v += step) out.push(v);
  return out;
});

const verdict = computed(() => {
  if (agree.value === null) return '';
  const n = result.value.timeline.length;
  return agree.value
    ? `Модель совпала с эмулятором на Postgres 16.6 во всех ${n} точках временной линии.`
    : 'Модель расходится с эмулятором.';
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="svl-controls">
        <div class="svl-control">
          <span class="t-label">трафик</span>
          <SegmentedControl v-model="profileId" class="l-pills" label="Профиль трафика" :options="profileOptions" />
        </div>
        <div class="svl-control">
          <span class="t-label">платформа</span>
          <SegmentedControl v-model="platformId" class="l-pills" label="Платформа" :options="platformOptions" />
        </div>
      </div>
    </template>

    <div class="svl-body">
      <Md class="svl-note" :text="profile.note" />

      <div class="svl-stats">
        <div v-for="s in stats" :key="s.k" class="svl-stat" :data-tone="s.tone || 'none'">
          <span class="svl-stat__k">{{ s.k }}</span>
          <span class="svl-stat__v">{{ s.v }}</span>
        </div>
      </div>

      <div class="svl-chart-wrap">
        <svg
          class="svl-chart"
          :viewBox="`0 0 ${W} ${H}`"
          role="img"
          :aria-label="`Экземпляры и соединения во времени: пик ${result.peakInstances} экземпляров и ${result.peakConns} соединений при лимите ${dbLimit}`"
        >
          <g class="svl-grid">
            <line v-for="v in yTicks" :key="`y${v}`" :x1="PAD.l" :x2="W - PAD.r" :y1="y(v)" :y2="y(v)" />
          </g>
          <g class="svl-axis">
            <text v-for="v in yTicks" :key="`yl${v}`" :x="PAD.l - 6" :y="y(v) + 4" text-anchor="end">{{ v }}</text>
            <text v-for="tk in xTicks" :key="`xl${tk}`" :x="x(tk)" :y="H - 10" text-anchor="middle">{{ tk / 1000 }} с</text>
          </g>
          <line class="svl-limit" :x1="PAD.l" :x2="W - PAD.r" :y1="y(dbLimit)" :y2="y(dbLimit)" />
          <text class="svl-limit-label" :x="W - PAD.r" :y="y(dbLimit) - 5" text-anchor="end">лимит базы {{ dbLimit }}</text>
          <path class="svl-line svl-line--conn" :d="connPath" />
          <path class="svl-line svl-line--inst" :d="instPath" />
          <circle v-for="(p, i) in standDots" :key="`d${i}`" class="svl-dot" :cx="x(p.t)" :cy="y(p.conns)" r="2.5" />
        </svg>
      </div>

      <div class="svl-legend">
        <span class="svl-key svl-key--inst">экземпляры</span>
        <span class="svl-key svl-key--conn">соединения с базой</span>
        <span class="svl-key svl-key--dot">соединения на стенде (pg_stat_activity)</span>
      </div>

      <p class="svl-verdict" :data-ok="agree === false ? 'no' : 'yes'">{{ verdict }}</p>

      <Md class="svl-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.svl-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 20px;
}
.svl-control {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.svl-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.svl-note,
.svl-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.svl-note :deep(code),
.svl-caption :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}

.svl-stats {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 8px;
}
.svl-stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
  min-width: 0;
}
.svl-stat__k {
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.svl-stat__v {
  font-family: var(--mono);
  font-size: var(--fs-5);
  font-weight: 600;
  color: var(--ink);
}
.svl-stat[data-tone='warn'] {
  background: var(--tone-warn-bg);
}
.svl-stat[data-tone='warn'] .svl-stat__v {
  color: var(--tone-warn-text);
}
.svl-stat[data-tone='err'] {
  background: var(--tone-err-bg);
}
.svl-stat[data-tone='err'] .svl-stat__v {
  color: var(--tone-err-text);
}
.svl-stat[data-tone='ok'] .svl-stat__v {
  color: var(--tone-ok-text);
}

.svl-chart-wrap {
  overflow-x: auto;
  min-width: 0;
  padding: 8px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.svl-chart {
  /* Без явной заливки корень SVG красится чёрным по умолчанию — цвет мимо theme.ts
     (ловит palette.spec). Фигуры красятся своими классами. */
  fill: var(--ink);
  display: block;
  width: 100%;
  min-width: 860px;
  height: auto;
}
.svl-grid line {
  stroke: var(--hairline);
  stroke-width: 1;
}
.svl-axis text,
.svl-limit-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  fill: var(--text-muted);
}
.svl-limit {
  stroke: var(--tone-err-line);
  stroke-width: 1.5;
  stroke-dasharray: 5 4;
}
.svl-limit-label {
  fill: var(--tone-err-text);
}
.svl-line {
  fill: none;
  stroke-width: 2;
  stroke-linejoin: round;
}
.svl-line--inst {
  stroke: var(--bar-violet);
}
.svl-line--conn {
  stroke: var(--bar-amber);
  stroke-width: 3;
}

.svl-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 18px;
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.svl-key {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.svl-key::before {
  content: '';
  display: inline-block;
  width: 18px;
  height: 3px;
  border-radius: 2px;
}
.svl-key--inst::before {
  background: var(--bar-violet);
}
.svl-key--conn::before {
  background: var(--bar-amber);
}
.svl-key--dot::before {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ink);
}
.svl-dot {
  fill: var(--ink);
}
.svl-verdict {
  margin: 0;
  font-size: var(--fs-3);
  color: var(--tone-ok-text);
}
.svl-verdict[data-ok='no'] {
  color: var(--tone-err-text);
}
</style>
