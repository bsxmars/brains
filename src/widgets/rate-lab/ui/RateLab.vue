<script setup lang="ts">
/**
 * «Бюджет событий»: одна лента событий на оси времени и под ней — что сделал с ней каждый
 * алгоритм темы. Режим `wrappers` — обёртки (debounce, debounce с leading и maxWait, throttle,
 * rAF-throttle): метка на дорожке — вызов функции и номер события, чей аргумент дошёл. Режим
 * `limiters` — ограничители (ведро жетонов с уровнем жетонов, дырявое ведро, окна): метка —
 * решение по событию.
 *
 * Считает не компонент, а строки кода темы, собранные `new Function` (`model/run.ts`), на
 * виртуальных часах `CLOCK_CODE`. Те же строки прогоняет `tests/unit/rate-limiting.test.ts`
 * против `lodash-es` под `vi.useFakeTimers`. Настоящих таймеров в демо нет.
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button, SegmentedControl } from '@/shared/ui';
import { loadLimiters, loadWrappers, runLimiters, runWrappers, seededTape, WINDOW } from '../model/run';
import type { RateCode, TapePreset } from '../model/types';

const props = defineProps<{
  code: RateCode;
  tapes: TapePreset[];
  mode: 'wrappers' | 'limiters';
  /** Подпись под демо. Строчная разметка. */
  caption: string;
  /** Какая лента открыта первой. */
  start?: string;
}>();

const wrappers = loadWrappers(props.code);
const limiters = loadLimiters(props.code);

const RANDOM = 'random';
const picked = ref(props.start ?? props.tapes[0].id);
const seed = ref(1);
const options = [...props.tapes.map((t) => ({ value: t.id, label: t.label })), { value: RANDOM, label: 'Случайная' }];

const tape = computed<TapePreset>(() => {
  if (picked.value === RANDOM) {
    return {
      id: RANDOM,
      label: 'Случайная',
      times: seededTape(seed.value),
      note: `Случайная лента, зерно ${seed.value}: серии плотных событий с паузами разной длины. Одно и то же зерно всегда даёт одну и ту же ленту.`,
    };
  }
  return props.tapes.find((t) => t.id === picked.value) ?? props.tapes[0];
});

// ─── Параметры ───
const wait = ref(200);
const maxWait = ref(0);
const rate = ref(5);
const burst = ref(3);

const last = computed(() => tape.value.times.at(-1) ?? 0);

/** Конец оси: обёрткам — последнее событие плюс самое долгое ожидание, ограничителям — плюс выход ведра. */
const wrapEnd = computed(() => last.value + Math.max(wait.value, maxWait.value, 16) + 40);
const wrapLanes = computed(() =>
  props.mode === 'wrappers'
    ? runWrappers(wrappers, tape.value.times, { wait: wait.value, maxWait: maxWait.value }, wrapEnd.value)
    : [],
);

const limitRun = computed(() => {
  if (props.mode !== 'limiters') return null;
  const draft = runLimiters(limiters, tape.value.times, { rate: rate.value, burst: burst.value }, last.value);
  const outs = draft.lanes.flatMap((l) => l.verdicts.map((v) => v.out ?? v.t));
  const end = Math.max(last.value, ...outs) + 120;
  // Второй прогон — только чтобы уровень жетонов дотянулся до конца оси.
  return runLimiters(limiters, tape.value.times, { rate: rate.value, burst: burst.value }, end);
});

const axisMax = computed(() => {
  const end =
    props.mode === 'wrappers'
      ? wrapEnd.value
      : Math.max(...(limitRun.value?.level.map((p) => p[0]) ?? [0]), last.value + 120);
  return Math.max(200, Math.ceil(end / 100) * 100);
});

const pct = (t: number) => `${(t / axisMax.value) * 100}%`;

const axisTicks = computed(() => {
  const step = axisMax.value > 2400 ? 500 : axisMax.value > 900 ? 200 : 100;
  const out: number[] = [];
  for (let t = 0; t <= axisMax.value; t += step) out.push(t);
  return out;
});

/** Границы окон по 1000 мс — для дорожек ограничителей. */
const windowLines = computed(() => {
  const out: number[] = [];
  for (let t = WINDOW; t < axisMax.value; t += WINDOW) out.push(t);
  return out;
});

/** Подпись у метки — только если до прошлой подписанной хватает места (в долях оси). */
function labelled<T extends { t: number }>(items: T[], gap = 0.035) {
  let prev = -Infinity;
  return items.map((it) => {
    const show = it.t / axisMax.value - prev >= gap;
    if (show) prev = it.t / axisMax.value;
    return { ...it, show };
  });
}

const wrapView = computed(() =>
  wrapLanes.value.map((lane) => ({
    ...lane,
    marks: labelled(lane.calls),
  })),
);

const limitView = computed(() =>
  (limitRun.value?.lanes ?? []).map((lane) => ({
    ...lane,
    passed: lane.verdicts.filter((v) => v.ok).length,
  })),
);

/** Уровень жетонов ломаной: x — время в долях оси (0…1000), y — от полного ведра вниз. */
const levelPath = computed(() => {
  const pts = limitRun.value?.level ?? [];
  if (!pts.length) return '';
  const h = 30;
  const xy = (t: number, v: number) => `${((t / axisMax.value) * 1000).toFixed(1)},${(h - (v / burst.value) * (h - 2) - 1).toFixed(1)}`;
  // Между событиями ведро наполняется линейно до потолка: точка, где оно наполнилось, нужна отдельно.
  const out: string[] = [];
  for (let i = 0; i < pts.length; i++) {
    const [t, v] = pts[i];
    if (i > 0) {
      const [pt, pv] = pts[i - 1];
      const full = pt + ((burst.value - pv) * 1000) / rate.value;
      if (pv < burst.value && full < t) out.push(xy(full, burst.value));
    }
    out.push(xy(t, v));
  }
  return `M${out.join(' L')}`;
});

const eventMarks = computed(() => labelled(tape.value.times.map((t, i) => ({ t, i }))));

function nextSeed() {
  seed.value += 1;
  picked.value = RANDOM;
}
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="rl-controls">
        <SegmentedControl v-model="picked" class="l-pills" label="Лента" :options="options" />
        <Button v-if="picked === RANDOM" variant="secondary" @click="nextSeed">другая лента</Button>
      </div>
      <div class="rl-ranges">
        <template v-if="mode === 'wrappers'">
          <label class="rl-range">
            <span class="rl-label">wait — {{ wait }} мс</span>
            <input v-model.number="wait" type="range" min="20" max="600" step="10" :aria-valuetext="`${wait} мс`" />
          </label>
          <label class="rl-range">
            <span class="rl-label">maxWait — {{ maxWait ? `${Math.max(maxWait, wait)} мс` : 'выключен' }}</span>
            <input v-model.number="maxWait" type="range" min="0" max="1500" step="50" :aria-valuetext="maxWait ? `${maxWait} мс` : 'выключен'" />
          </label>
        </template>
        <template v-else>
          <label class="rl-range">
            <span class="rl-label">rate — {{ rate }} в секунду</span>
            <input v-model.number="rate" type="range" min="1" max="20" step="1" :aria-valuetext="`${rate} в секунду`" />
          </label>
          <label class="rl-range">
            <span class="rl-label">burst — {{ burst }}</span>
            <input v-model.number="burst" type="range" min="1" max="10" step="1" :aria-valuetext="String(burst)" />
          </label>
        </template>
      </div>
    </template>

    <div class="rl-body">
      <Md class="rl-note" :text="tape.note" />

      <div class="rl-scroll">
        <div class="rl-chart">
          <div class="rl-lane">
            <span class="rl-lane__label">события · {{ tape.times.length }}</span>
            <div class="rl-track" role="img" :aria-label="`Лента: ${tape.times.length} событий от 0 до ${last} мс`">
              <span v-for="m in eventMarks" :key="`e${m.i}`" class="rl-tick" :style="{ left: pct(m.t) }">
                <span v-if="m.show" class="rl-tick__text">{{ m.i }}</span>
              </span>
            </div>
          </div>

          <template v-if="mode === 'wrappers'">
            <div v-for="lane in wrapView" :key="lane.id" class="rl-lane">
              <span class="rl-lane__label">{{ lane.label }} · {{ lane.calls.length }}</span>
              <div
                class="rl-track"
                role="img"
                :aria-label="`${lane.label}: ${lane.calls.length} вызовов` + (lane.calls.length ? `, в ${lane.calls.map((c) => c.t).join(', ')} мс` : '')"
              >
                <span v-for="(c, k) in lane.marks" :key="k" class="rl-call" :style="{ left: pct(c.t) }">
                  <span v-if="c.show" class="rl-call__text">{{ c.arg }}</span>
                  <span class="rl-dot" />
                </span>
                <span v-if="!lane.calls.length" class="rl-empty">ни одного вызова</span>
              </div>
            </div>
          </template>

          <template v-else>
            <div v-for="lane in limitView" :key="lane.id" class="rl-lane">
              <span class="rl-lane__label">{{ lane.label }} · {{ lane.passed }} из {{ lane.verdicts.length }} · худшая секунда {{ lane.worst }}</span>
              <div
                class="rl-track rl-track--limit"
                role="img"
                :aria-label="`${lane.label}: пропущено ${lane.passed} из ${lane.verdicts.length}, за худшие 1000 мс — ${lane.worst}`"
              >
                <span v-for="w in windowLines" :key="`w${w}`" class="rl-window" :style="{ left: pct(w) }" />
                <svg
                  v-if="lane.id === 'token'"
                  class="rl-level"
                  viewBox="0 0 1000 30"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <path :d="levelPath" />
                </svg>
                <template v-for="v in lane.verdicts" :key="v.i">
                  <span
                    v-if="v.out !== undefined && v.out > v.t"
                    class="rl-wait"
                    :style="{ left: pct(v.t), width: pct(v.out - v.t) }"
                  />
                  <span class="rl-verdict" :data-ok="v.ok ? 'yes' : 'no'" :style="{ left: pct(v.out ?? v.t) }" />
                </template>
              </div>
            </div>
          </template>

          <div class="rl-lane">
            <span />
            <div class="rl-axis">
              <span v-for="t in axisTicks" :key="t" class="rl-axis__tick" :style="{ left: pct(t) }">{{ t }}</span>
            </div>
          </div>
        </div>
      </div>

      <Md class="rl-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.rl-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 14px;
}
.rl-ranges {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px 20px;
  margin-top: 12px;
}
.rl-range {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.rl-range input {
  width: 100%;
  font: inherit;
  color: inherit;
  accent-color: var(--ink);
}
.rl-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  color: var(--text-muted);
}

.rl-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
  min-width: 0;
}
.rl-note,
.rl-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.rl-note :deep(code),
.rl-caption :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}

/* Ось не сжимается ниже 640px: на телефоне дорожки прокручиваются в своей рамке. */
.rl-scroll {
  overflow-x: auto;
  min-width: 0;
}
.rl-chart {
  min-width: 640px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 12px 4px 4px;
}
.rl-lane {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.rl-lane__label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}

.rl-track {
  position: relative;
  height: 34px;
  border-radius: var(--r2);
  background: var(--surface-2);
}
.rl-track--limit {
  height: 30px;
}

.rl-tick {
  position: absolute;
  bottom: 0;
  width: 2px;
  height: 12px;
  margin-left: -1px;
  background: var(--ink);
}
.rl-tick__text {
  position: absolute;
  bottom: 14px;
  left: 50%;
  transform: translateX(-50%);
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
  white-space: nowrap;
}

.rl-call {
  position: absolute;
  bottom: 4px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  transform: translateX(-50%);
}
.rl-call__text {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--tone-info-text);
  white-space: nowrap;
}
.rl-dot {
  width: 9px;
  height: 9px;
  border-radius: var(--r-full);
  background: var(--tone-info-text);
}
.rl-empty {
  position: absolute;
  left: 8px;
  top: 50%;
  transform: translateY(-50%);
  font-size: var(--fs-3);
  font-style: italic;
  color: var(--text-muted);
}

.rl-window {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--border-strong);
}
.rl-level {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  fill: var(--ink);
}
.rl-level path {
  fill: none;
  stroke: var(--tone-info-line);
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
}
.rl-wait {
  position: absolute;
  top: 50%;
  height: 2px;
  margin-top: -1px;
  background: var(--tone-ok-line);
}
.rl-verdict {
  position: absolute;
  top: 7px;
  bottom: 7px;
  width: 4px;
  margin-left: -2px;
  border-radius: 2px;
}
.rl-verdict[data-ok='yes'] {
  background: var(--tone-ok-text);
}
.rl-verdict[data-ok='no'] {
  top: 11px;
  bottom: 11px;
  background: var(--tone-err-text);
}

.rl-axis {
  position: relative;
  height: 20px;
  border-top: 1px solid var(--border);
}
.rl-axis__tick {
  position: absolute;
  top: 3px;
  transform: translateX(-50%);
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.rl-axis__tick:first-child {
  transform: none;
}
.rl-axis__tick:last-child {
  transform: translateX(-100%);
}
</style>
