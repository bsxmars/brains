<script setup lang="ts">
/**
 * «Стадо после сбоя»: 50 клиентов, сервер лежит 2 с и поднимается с лимитом 10 в секунду.
 *
 * Считает не компонент, а строки темы (`RETRY_CODE`: `parseRetryAfter`, `backoff`,
 * `createRetryPolicy`, `simulate`), собранные `new Function` в `model/run.ts`. Те же строки
 * напечатаны на странице и прогоняются `tests/unit/rate-limits.test.ts` — средние по зёрнам
 * в таблице темы и картина в демо получаются одним кодом.
 *
 * Симуляция маленькая (50 клиентов, сотни событий), поэтому — в `computed`, без кнопки.
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { binLog, loadRetry, runHerd } from '../model/run';
import type { HerdPreset, RetryAfterMode, RetryCode, Strategy } from '../model/types';

const props = defineProps<{
  code: RetryCode;
  preset: HerdPreset;
  strategies: { k: Strategy; label: string }[];
  modes: { k: RetryAfterMode; label: string }[];
  /** Пояснение к стратегии под графиком. Строчная разметка. */
  notes: Record<Strategy, string>;
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const api = loadRetry(props.code);

const strategy = ref<Strategy>('none');
const mode = ref<RetryAfterMode>('ignore');
const seed = ref('1');

const STRATEGY_OPTIONS = props.strategies.map((s) => ({ value: s.k, label: s.label }));
const MODE_OPTIONS = props.modes.map((m) => ({ value: m.k, label: m.label }));
const SEED_OPTIONS = ['1', '2', '3', '4'].map((v) => ({ value: v, label: v }));

const result = computed(() => runHerd(api, props.preset, strategy.value, mode.value, Number(seed.value)));
const bins = computed(() => binLog(result.value.log, props.preset.bin));

/**
 * Шкала времени — до ближайшего деления за последним событием (деление 5 с, на длинных
 * прогонах 10 с), чтобы крайняя метка стояла ровно на правом краю; высота — не меньше числа клиентов.
 */
const tickStep = computed(() => (bins.value.length * props.preset.bin > 30_000 ? 10_000 : 5000));
const span = computed(() => Math.max(10_000, Math.ceil((bins.value.length * props.preset.bin) / tickStep.value) * tickStep.value));
const slots = computed(() => span.value / props.preset.bin);
const peak = computed(() => Math.max(props.preset.clients, ...bins.value.map((b) => b.ok + b.s429 + b.s503)));

const bars = computed(() =>
  Array.from({ length: slots.value }, (_, i) => {
    const b = bins.value[i] ?? { ok: 0, s429: 0, s503: 0 };
    const from = (i * props.preset.bin) / 1000;
    const to = ((i + 1) * props.preset.bin) / 1000;
    return {
      ok: (b.ok / peak.value) * 100,
      s429: (b.s429 / peak.value) * 100,
      s503: (b.s503 / peak.value) * 100,
      title: `${fmt(from)}–${fmt(to)} с: 200 — ${b.ok}, 429 — ${b.s429}, 503 — ${b.s503}`,
    };
  }),
);

const ticks = computed(() => Array.from({ length: span.value / tickStep.value + 1 }, (_, i) => (i * tickStep.value) / 1000));
const upAt = computed(() => (props.preset.downUntil / span.value) * 100);

function fmt(n: number) {
  return String(n).replace('.', ',');
}
const seconds = (ms: number | null) => (ms === null ? '—' : `${(ms / 1000).toFixed(1).replace('.', ',')} с`);
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="rl-controls">
        <div class="rl-control">
          <span class="t-label">джиттер</span>
          <SegmentedControl v-model="strategy" class="l-pills" label="Стратегия паузы" :options="STRATEGY_OPTIONS" />
        </div>
        <div class="rl-control">
          <span class="t-label">Retry-After</span>
          <SegmentedControl v-model="mode" class="l-pills" label="Как ждать Retry-After" :options="MODE_OPTIONS" />
        </div>
        <div class="rl-control">
          <span class="t-label">зерно</span>
          <SegmentedControl v-model="seed" class="l-pills" label="Зерно случайности" :options="SEED_OPTIONS" />
        </div>
      </div>
    </template>

    <div class="rl-body">
      <div class="rl-chart" role="img" :aria-label="`Запросы к серверу по полусекундам: всего ${result.calls}, отказов 429 — ${result.s429}`">
        <div class="rl-scroll">
          <div class="rl-plot">
            <div class="rl-up" :style="{ left: `${upAt}%` }"><span class="rl-up__label">сервер поднялся</span></div>
            <div v-for="(bar, i) in bars" :key="i" class="rl-col" :title="bar.title">
              <div class="rl-col__s503" :style="{ height: `${bar.s503}%` }" />
              <div class="rl-col__s429" :style="{ height: `${bar.s429}%` }" />
              <div class="rl-col__ok" :style="{ height: `${bar.ok}%` }" />
            </div>
          </div>
          <div class="rl-axis">
            <span v-for="tk in ticks" :key="tk" class="rl-axis__tick" :style="{ left: `${((tk * 1000) / span) * 100}%` }">{{ tk }} с</span>
          </div>
        </div>
        <div class="rl-legend">
          <span class="rl-legend__item" data-kind="ok">200</span>
          <span class="rl-legend__item" data-kind="s429">429</span>
          <span class="rl-legend__item" data-kind="s503">503</span>
          <span class="rl-legend__scale">столбик — полсекунды, полная высота — {{ peak }} запросов</span>
        </div>
      </div>

      <div class="rl-stats">
        <div class="rl-stat">
          <span class="t-label">запросов к серверу</span>
          <span class="rl-stat__value">{{ result.calls }}</span>
          <span class="rl-stat__hint">на {{ preset.clients }} клиентов</span>
        </div>
        <div class="rl-stat">
          <span class="t-label">ответов 503</span>
          <span class="rl-stat__value">{{ result.s503 }}</span>
          <span class="rl-stat__hint">пока сервер лежал</span>
        </div>
        <div class="rl-stat">
          <span class="t-label">ответов 429</span>
          <span class="rl-stat__value">{{ result.s429 }}</span>
          <span class="rl-stat__hint">пришли, когда мест не было</span>
        </div>
        <div class="rl-stat">
          <span class="t-label">последний успех</span>
          <span class="rl-stat__value">{{ seconds(result.lastOk) }}</span>
          <span class="rl-stat__hint">сервер поднялся через {{ seconds(preset.downUntil) }}</span>
        </div>
      </div>

      <Md class="rl-note" :text="notes[strategy]" />
      <Md class="rl-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.rl-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 20px;
}
.rl-control {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.rl-body {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 22px 20px;
  min-width: 0;
}

.rl-chart {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.rl-scroll {
  overflow-x: auto;
  min-width: 0;
}
/* Столбиков бывает больше ста: уже 560px график не сжимается, а прокручивается в своей рамке. */
.rl-plot,
.rl-axis {
  min-width: 560px;
}
.rl-plot {
  position: relative;
  display: flex;
  align-items: flex-end;
  gap: 1px;
  height: 180px;
  border-bottom: 1px solid var(--border-strong);
}
.rl-col {
  flex: 1 1 0;
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}
.rl-col__ok {
  background: var(--bar-green);
}
.rl-col__s429 {
  background: var(--bar-amber);
}
.rl-col__s503 {
  background: var(--bar-red);
}
.rl-up {
  position: absolute;
  top: 0;
  bottom: 0;
  border-left: 1px dashed var(--tone-info-strong);
  pointer-events: none;
}
.rl-up__label {
  position: absolute;
  top: 2px;
  left: 5px;
  white-space: nowrap;
  font-size: var(--fs-3);
  color: var(--tone-info-text);
}

.rl-axis {
  position: relative;
  height: 16px;
}
.rl-axis__tick {
  position: absolute;
  transform: translateX(-50%);
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--dim);
  white-space: nowrap;
}
.rl-axis__tick:first-child {
  transform: none;
}
.rl-axis__tick:last-child {
  transform: translateX(-100%);
}

.rl-legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 14px;
  font-size: var(--fs-3);
  color: var(--text-muted);
}
.rl-legend__item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--mono);
}
.rl-legend__item::before {
  content: '';
  width: 10px;
  height: 10px;
  border-radius: 2px;
}
.rl-legend__item[data-kind='ok']::before {
  background: var(--bar-green);
}
.rl-legend__item[data-kind='s429']::before {
  background: var(--bar-amber);
}
.rl-legend__item[data-kind='s503']::before {
  background: var(--bar-red);
}

.rl-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 12px;
}
.rl-stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  border-radius: var(--r2);
  background: var(--surface-2);
  min-width: 0;
}
.rl-stat__value {
  font-family: var(--mono);
  font-size: var(--fs-7);
  color: var(--ink);
}
.rl-stat__hint {
  font-size: var(--fs-3);
  line-height: 1.45;
  color: var(--text-muted);
}

.rl-note {
  font-size: var(--fs-5);
  line-height: 1.6;
  color: var(--prose);
}
.rl-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--text-muted);
}
.rl-note :deep(code),
.rl-caption :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
</style>
