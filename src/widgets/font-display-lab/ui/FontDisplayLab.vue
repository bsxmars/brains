<script setup lang="ts">
/**
 * «font-display по времени»: что видно на месте текста, пока шрифт едет, — по модели темы
 * и по тому, что Chromium показал на стенде при той же задержке.
 *
 * Полосу модели считает не компонент, а строка `FONT_DISPLAY_CODE` из темы, собранная
 * `new Function` (`model/run.ts`). Та же строка напечатана на странице и сверяется
 * `tests/unit/fonts-text.test.ts` со всеми прогонами стенда. Полоса Chromium — литерал
 * `STAND_RUNS` как есть.
 *
 * Шрифты превью — Newsreader (`--serif`) и Georgia: та же пара, что на стенде и на самом сайте.
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { loadFontDisplay } from '../model/run';
import type { Display, Phase, Segment, StandRun } from '../model/types';

const props = defineProps<{
  code: string;
  runs: StandRun[];
  /** Образец текста — латиница: у Newsreader нет кириллицы. */
  text: string;
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const api = loadFontDisplay(props.code);
const AXIS = 6000;

const display = ref<Display>('fallback');
const delay = ref('1500');
const preload = ref('no');
const moment = ref(1000);

const displayOptions = (['auto', 'block', 'swap', 'fallback', 'optional'] as const).map((v) => ({ value: v, label: v }));
const delays = [...new Set(props.runs.map((r) => r.delay))].sort((a, b) => a - b);
const delayOptions = delays.map((d) => ({ value: String(d), label: `${d} мс` }));
const preloadOptions = [
  { value: 'no', label: 'без preload' },
  { value: 'yes', label: 'с preload' },
];

const loadMs = computed(() => Number(delay.value));
const preloaded = computed(() => preload.value === 'yes');

/** Полоса модели: состояние раз в 10 мс, склеенное в отрезки. */
const modelSegs = computed<Segment[]>(() => {
  const out: Segment[] = [];
  for (let x = 0; x <= AXIS; x += 10) {
    const st = api.fontPhase(display.value, loadMs.value, x, preloaded.value);
    const last = out.at(-1);
    if (last && last[0] === st) last[2] = x;
    else out.push([st, x, x]);
  }
  return out;
});

const run = computed(() =>
  props.runs.find((r) => r.display === display.value && r.delay === loadMs.value && r.preload === preloaded.value),
);

const modelNow = computed<Phase>(() => api.fontPhase(display.value, loadMs.value, moment.value, preloaded.value));
const standNow = computed<Phase | null>(() => {
  const r = run.value;
  if (!r) return null;
  const hit = r.segs.find(([, a, b]) => moment.value >= a && moment.value <= b);
  return (hit ?? r.segs.reduce((best, s) => (Math.abs(s[1] - moment.value) < Math.abs(best[1] - moment.value) ? s : best)))[0];
});

const LABEL: Record<Phase, string> = { invisible: 'пусто', fallback: 'Georgia', font: 'Newsreader' };
const pct = (x: number) => `${(x / AXIS) * 100}%`;
const ticks = [0, 1000, 2000, 3000, 4000, 5000, 6000];

const verdict = computed(() => {
  const m = LABEL[modelNow.value];
  const s = standNow.value;
  const at = `В момент **${moment.value} мс**`;
  if (!s) return `${at} модель показывает: **${m}**. Такой прогон стенд не снимал.`;
  return s === modelNow.value
    ? `${at} и модель, и Chromium показывают: **${m}**.`
    : `${at} модель говорит **${m}**, Chromium — **${LABEL[s]}**: точка у самой границы, где точность стенда ~30 мс.`;
});

function onRange(e: Event) {
  moment.value = Number((e.target as HTMLInputElement).value);
}
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="fd-tools">
        <SegmentedControl v-model="display" class="l-pills" label="font-display" :options="displayOptions" />
        <SegmentedControl v-model="delay" class="l-pills" label="Задержка шрифта" :options="delayOptions" />
        <SegmentedControl v-model="preload" class="l-pills" label="preload" :options="preloadOptions" />
      </div>
    </template>

    <div class="fd-body">
      <div class="fd-lanes">
        <div class="fd-lane">
          <span class="fd-label">модель · fontPhase</span>
          <div class="fd-bar">
            <span
              v-for="(s, i) in modelSegs"
              :key="i"
              class="fd-seg"
              :data-phase="s[0]"
              :style="{ left: pct(s[1]), width: pct(Math.max(s[2] - s[1], 10)) }"
              :title="`${LABEL[s[0]]}: ${s[1]}–${s[2]} мс`"
            ><span v-if="s[2] - s[1] > 700" class="fd-seg__t">{{ LABEL[s[0]] }}</span></span>
            <span class="fd-now" :style="{ left: pct(moment) }" />
            <span class="fd-load" :style="{ left: pct(Math.min(loadMs, AXIS)) }" />
          </div>
        </div>

        <div class="fd-lane">
          <span class="fd-label">Chromium 153 на стенде</span>
          <div v-if="run" class="fd-bar">
            <span
              v-for="(s, i) in run.segs"
              :key="i"
              class="fd-seg"
              :data-phase="s[0]"
              :style="{ left: pct(s[1]), width: pct(Math.max(s[2] - s[1], 10)) }"
              :title="`${LABEL[s[0]]}: ${s[1]}–${s[2]} мс`"
            ><span v-if="s[2] - s[1] > 700" class="fd-seg__t">{{ LABEL[s[0]] }}</span></span>
            <span class="fd-now" :style="{ left: pct(moment) }" />
            <span class="fd-load" :style="{ left: pct(Math.min(run.loaded, AXIS)) }" />
          </div>
          <div v-else class="fd-bar fd-bar--empty">стенд этот случай не снимал</div>
        </div>

        <div class="fd-axis" aria-hidden="true">
          <span v-for="x in ticks" :key="x" class="fd-tick" :style="{ left: pct(x) }">{{ x === AXIS ? `${x / 1000} с` : x / 1000 }}</span>
        </div>

        <label class="fd-knob">
          <span class="fd-label">момент · {{ moment }} мс</span>
          <input
            class="fd-range"
            type="range"
            min="0"
            :max="AXIS"
            step="10"
            :value="moment"
            aria-label="Момент времени от начала загрузки шрифта, мс"
            @input="onRange"
          />
        </label>
      </div>

      <div class="fd-preview">
        <div class="fd-frame">
          <span class="fd-label">модель</span>
          <p class="fd-sample" :data-phase="modelNow">{{ text }}</p>
        </div>
        <div class="fd-frame">
          <span class="fd-label">Chromium</span>
          <p v-if="standNow" class="fd-sample" :data-phase="standNow">{{ text }}</p>
          <p v-else class="fd-sample fd-sample--none">—</p>
        </div>
      </div>

      <Md class="fd-verdict" :text="verdict" />

      <div class="fd-legend">
        <span class="fd-key" data-phase="invisible">пусто — место занято, букв нет</span>
        <span class="fd-key" data-phase="fallback">запасной шрифт</span>
        <span class="fd-key" data-phase="font">веб-шрифт</span>
        <span class="fd-key fd-key--load">файл пришёл</span>
      </div>

      <Md class="fd-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.fd-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
  min-width: 0;
}
.fd-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.fd-lanes {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.fd-lane {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.fd-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.fd-bar {
  position: relative;
  height: 30px;
  border-radius: var(--r2);
  background: var(--surface-2);
  overflow: hidden;
}
.fd-bar--empty {
  display: flex;
  align-items: center;
  padding: 0 10px;
  font-size: var(--fs-3);
  color: var(--text-muted);
}
.fd-seg {
  position: absolute;
  top: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  padding-left: 8px;
  overflow: hidden;
  white-space: nowrap;
  font-size: var(--fs-2);
}
.fd-seg[data-phase='invisible'],
.fd-key[data-phase='invisible']::before {
  background: var(--surface-3);
  color: var(--text-muted);
}
.fd-seg[data-phase='fallback'],
.fd-key[data-phase='fallback']::before {
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
  box-shadow: inset 0 -2px 0 var(--tone-warn-line);
}
.fd-seg[data-phase='font'],
.fd-key[data-phase='font']::before {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
  box-shadow: inset 0 -2px 0 var(--tone-ok-line);
}
.fd-now {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  margin-left: -1px;
  background: var(--ink);
}
.fd-load,
.fd-key--load::before {
  background: repeating-linear-gradient(to bottom, var(--tone-info-line) 0 4px, transparent 4px 7px);
}
.fd-load {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  margin-left: -1px;
}
.fd-axis {
  position: relative;
  height: 1.6em;
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.fd-tick {
  position: absolute;
  top: 0;
  white-space: nowrap;
  transform: translateX(-50%);
}
.fd-tick:first-child {
  transform: none;
}
.fd-tick:last-child {
  transform: translateX(-100%);
}
.fd-knob {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.fd-range {
  width: 100%;
  min-width: 0;
  height: 4px;
  margin: 0;
  appearance: none;
  border-radius: var(--r-full);
  background: var(--surface-3);
  font: inherit;
  color: inherit;
}
.fd-range::-webkit-slider-thumb {
  appearance: none;
  width: 14px;
  height: 14px;
  border: 0;
  border-radius: var(--r-full);
  background: var(--accent);
  cursor: pointer;
}
.fd-range::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border: 0;
  border-radius: var(--r-full);
  background: var(--accent);
  cursor: pointer;
}

.fd-preview {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
}
@media (max-width: 640px) {
  .fd-preview {
    grid-template-columns: minmax(0, 1fr);
  }
}
.fd-frame {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 12px 14px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.fd-sample {
  margin: 0;
  overflow-wrap: anywhere;
  font-size: var(--fs-8);
  line-height: 1.4;
  color: var(--ink);
}
.fd-sample[data-phase='font'] {
  font-family: var(--serif);
}
.fd-sample[data-phase='fallback'] {
  font-family: Georgia, serif;
}
.fd-sample[data-phase='invisible'] {
  font-family: Georgia, serif;
  color: transparent;
  outline: 1px dashed var(--hairline);
}
.fd-sample--none {
  color: var(--text-muted);
}

.fd-verdict,
.fd-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.fd-verdict :deep(code),
.fd-caption :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
.fd-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 18px;
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.fd-key {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.fd-key::before {
  content: '';
  display: inline-block;
  width: 14px;
  height: 10px;
  border-radius: 2px;
}
.fd-key--load::before {
  width: 2px;
}
</style>
