<script setup lang="ts">
/**
 * Минута трафика на одну страницу через учебный общий кеш — на виртуальных часах.
 *
 * Кеш — `createCache` из строк темы (`rules` и `cache` пропами, собирает `loadCache`), поток —
 * `runStream`: те же функции прогоняет `tests/unit/cdn-cache.test.ts`, и числа, на которые
 * опирается текст темы, сверяются там. Демо ничего не пересказывает: каждый квадратик —
 * ответ, который кеш на самом деле вернул, с настоящими `Age` и `Cache-Status`.
 *
 * Поток асинхронный (кеш работает на промисах), поэтому считается после монтирования и при
 * каждом переключении; до первого счёта остров честно пишет, что считать ещё нечего.
 */
import { computed, onMounted, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button, SegmentedControl } from '@/shared/ui';
import { loadCache } from '../model/load';
import { STREAM, originHeaders, runStream, type Outcome, type StreamInput, type StreamResult, type VaryMode } from '../model/stream';

const props = defineProps<{ rules: string; cache: string; caption: string }>();

const ttl = ref('10');
const swr = ref('0');
const form = ref<'s-maxage' | 'cdn'>('s-maxage');
const coalesce = ref('on');
const vary = ref<VaryMode>('none');
const purge = ref(false);

const TTLS = [
  { value: '10', label: '10 с' },
  { value: '30', label: '30 с' },
];
const SWRS = [
  { value: '0', label: 'нет' },
  { value: '20', label: '20 с' },
];
const FORMS = [
  { value: 's-maxage', label: 's-maxage' },
  { value: 'cdn', label: 'CDN-Cache-Control' },
];
const COALESCE = [
  { value: 'on', label: 'вкл' },
  { value: 'off', label: 'выкл' },
];
const VARIES = [
  { value: 'none', label: 'нет' },
  { value: 'lang', label: 'Accept-Language' },
  { value: 'ua', label: 'User-Agent' },
];

const input = computed<StreamInput>(() => ({
  ttl: Number(ttl.value),
  swr: Number(swr.value),
  form: form.value,
  coalesce: coalesce.value === 'on',
  vary: vary.value,
  purge: purge.value,
}));

/** Имена заголовков — как их пишут в HTTP, а не в нижнем регистре, в котором их читает кеш. */
const NAMES: Record<string, string> = {
  'cache-control': 'Cache-Control',
  'cdn-cache-control': 'CDN-Cache-Control',
  vary: 'Vary',
  'surrogate-key': 'Surrogate-Key',
};
const headerLines = computed(() =>
  Object.entries(originHeaders(input.value)).map(([k, v]) => `${NAMES[k] ?? k}: ${v}`),
);

const result = ref<StreamResult | null>(null);
const selected = ref(0);
let api: ReturnType<typeof loadCache> | null = null;
let run = 0;

async function recompute() {
  api ??= loadCache(props.rules, props.cache);
  const mine = ++run;
  const next = await runStream(api, input.value);
  if (mine !== run) return; // пока считали, переключили ещё раз
  result.value = next;
  const firstMiss = next.rows.find((r) => r.t >= 10_000 && r.outcome !== 'hit');
  selected.value = firstMiss?.i ?? 0;
}

onMounted(recompute);
watch(input, recompute);

const LABELS: Record<Outcome, string> = {
  hit: 'из кеша',
  stale: 'устаревшее, обновление в фоне',
  collapsed: 'дождался чужого похода',
  revalidate: 'проверка у origin',
  miss: 'промах',
};
const LEGEND: Outcome[] = ['hit', 'stale', 'collapsed', 'revalidate', 'miss'];

const SECONDS = STREAM.duration / 1000;
const TICKS = [0, 10, 20, 30, 40, 50, 60];
const LANE = 7;

const lanes = computed(() => (result.value ? Math.max(1, ...result.value.calls.map((c) => c.lane + 1)) : 1));

const row = computed(() => result.value?.rows[selected.value] ?? null);

const sec = (ms: number) => `${(ms / 1000).toFixed(2).replace('.', ',')} с`;

const stats = computed(() => {
  const r = result.value;
  if (!r) return null;
  const waited = r.rows.filter((x) => x.wait > 0);
  const fromCache = r.rows.filter((x) => x.outcome === 'hit' || x.outcome === 'stale').length;
  return {
    origin: r.calls.length,
    peak: r.peak,
    fromCache: `${Math.round((fromCache / r.rows.length) * 100)} %`,
    waited: waited.length,
    maxWait: waited.length ? sec(Math.max(...waited.map((x) => x.wait))) : '0 с',
    old: r.oldUntil === null ? 'никто' : `до ${sec(r.oldUntil)}`,
  };
});

function step(delta: number) {
  const r = result.value;
  if (!r) return;
  selected.value = Math.min(r.rows.length - 1, Math.max(0, selected.value + delta));
}

function nextNotHit() {
  const r = result.value;
  if (!r) return;
  const found = r.rows.find((x) => x.i > selected.value && x.outcome !== 'hit') ?? r.rows.find((x) => x.outcome !== 'hit');
  if (found) selected.value = found.i;
}

const detailText = computed(() => {
  const x = row.value;
  if (!x) return '';
  const variant = x.varyValue ? ` · \`${x.varyValue}\`` : '';
  return `**Запрос ${x.i + 1}** на ${sec(x.t)}${variant} — ${LABELS[x.outcome]}. Тело: \`${x.version}\`, ждал ответа ${x.wait ? sec(x.wait) : '0 с'}.`;
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="cdn-controls">
        <div class="cdn-control">
          <span class="t-label">срок в общем кеше</span>
          <SegmentedControl v-model="ttl" class="l-pills" label="Срок в общем кеше" :options="TTLS" />
        </div>
        <div class="cdn-control">
          <span class="t-label">stale-while-revalidate</span>
          <SegmentedControl v-model="swr" class="l-pills" label="stale-while-revalidate" :options="SWRS" />
        </div>
        <div class="cdn-control">
          <span class="t-label">куда записан срок</span>
          <SegmentedControl v-model="form" class="l-pills" label="Куда записан срок" :options="FORMS" />
        </div>
        <div class="cdn-control">
          <span class="t-label">коллапс запросов</span>
          <SegmentedControl v-model="coalesce" class="l-pills" label="Коллапс запросов" :options="COALESCE" />
        </div>
        <div class="cdn-control">
          <span class="t-label">Vary</span>
          <SegmentedControl v-model="vary" class="l-pills" label="Vary" :options="VARIES" />
        </div>
        <div class="cdn-control">
          <span class="t-label">сброс</span>
          <Button :variant="purge ? 'primary' : 'secondary'" :aria-pressed="purge" @click="purge = !purge">
            purge news при публикации
          </Button>
        </div>
      </div>
    </template>

    <div class="cdn-body">
      <Md class="cdn-caption" :text="caption" />

      <div class="cdn-headers" data-code>
        <span class="t-label">ответ origin</span>
        <div v-for="line in headerLines" :key="line" class="cdn-headers__line">{{ line }}</div>
      </div>

      <p v-if="!result" class="cdn-wait">Поток считается в браузере — прослойка ещё не запущена.</p>

      <template v-else>
        <div class="cdn-chart">
          <div class="cdn-grid" role="group" aria-label="Запросы по секундам: цвет — чем ответил кеш">
            <div class="cdn-mark" :style="{ left: `${(STREAM.publishAt / STREAM.duration) * 100}%` }">
              <span class="cdn-mark__label">{{ purge ? 'публикация + purge' : 'публикация' }}</span>
            </div>
            <button
              v-for="r in result.rows"
              :key="r.i"
              type="button"
              tabindex="-1"
              class="cdn-cell"
              :data-kind="r.outcome"
              :data-selected="r.i === selected || undefined"
              :aria-label="`Запрос ${r.i + 1}: ${LABELS[r.outcome]}`"
              :title="`${sec(r.t)} · ${LABELS[r.outcome]} · Age ${r.age}`"
              @click="selected = r.i"
            />
          </div>

          <div class="cdn-origin" :style="{ height: `${lanes * LANE}px` }" role="img" :aria-label="`Походы к origin: ${result.calls.length}, одновременно до ${result.peak}`">
            <div
              v-for="(c, k) in result.calls"
              :key="k"
              class="cdn-call"
              :data-status="c.status"
              :style="{
                left: `${(c.start / STREAM.duration) * 100}%`,
                width: `${((c.end - c.start) / STREAM.duration) * 100}%`,
                bottom: `${c.lane * LANE}px`,
              }"
            />
          </div>

          <div class="cdn-axis">
            <span v-for="t in TICKS" :key="t" class="cdn-axis__tick" :style="{ left: `${(t / SECONDS) * 100}%` }">{{ t }} с</span>
          </div>

          <div class="cdn-legend">
            <span v-for="o in LEGEND" :key="o" class="cdn-legend__item" :data-kind="o">{{ LABELS[o] }}</span>
            <span class="cdn-legend__item" data-kind="call-200">к origin за телом</span>
            <span class="cdn-legend__item" data-kind="call-304">к origin, ответ 304</span>
          </div>
        </div>

        <div v-if="stats" class="cdn-stats">
          <div class="cdn-stat">
            <span class="t-label">обращений к origin</span>
            <span class="cdn-stat__value">{{ stats.origin }}</span>
            <span class="cdn-stat__hint">за минуту, 240 запросов</span>
          </div>
          <div class="cdn-stat">
            <span class="t-label">одновременно, пик</span>
            <span class="cdn-stat__value">{{ stats.peak }}</span>
            <span class="cdn-stat__hint">высота стопки под лентой</span>
          </div>
          <div class="cdn-stat">
            <span class="t-label">ждали ответа</span>
            <span class="cdn-stat__value">{{ stats.waited }}</span>
            <span class="cdn-stat__hint">дольше всех — {{ stats.maxWait }}</span>
          </div>
          <div class="cdn-stat">
            <span class="t-label">старую версию после 20 с</span>
            <span class="cdn-stat__value">{{ stats.old }}</span>
            <span class="cdn-stat__hint">сразу из кеша — {{ stats.fromCache }} запросов</span>
          </div>
        </div>

        <div v-if="row" class="cdn-detail">
          <div class="cdn-detail__live" aria-live="polite">
            <Md class="cdn-detail__text" :text="detailText" />
            <div class="cdn-detail__headers" data-code>
              <div>Age: {{ row.age }}</div>
              <div>Cache-Status: {{ row.cacheStatus }}</div>
            </div>
          </div>
          <div class="cdn-detail__nav">
            <Button variant="secondary" :disabled="selected === 0" @click="step(-1)">← предыдущий</Button>
            <Button variant="secondary" :disabled="selected === result.rows.length - 1" @click="step(1)">следующий →</Button>
            <Button variant="secondary" @click="nextNotHit">к следующему не из кеша</Button>
          </div>
        </div>
      </template>
    </div>
  </DemoFrame>
</template>

<style scoped>
.cdn-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 20px;
}
.cdn-control {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.cdn-body {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 22px 20px;
  min-width: 0;
}
.cdn-caption {
  font-size: var(--fs-5);
  line-height: 1.6;
  color: var(--prose);
}
.cdn-wait {
  margin: 0;
  font-size: var(--fs-5);
  color: var(--text-muted);
}

.cdn-headers {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  border-radius: var(--r2);
  background: var(--surface-2);
  overflow-x: auto;
}
.cdn-headers__line {
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--text);
  white-space: pre;
}

.cdn-chart {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.cdn-grid {
  position: relative;
  display: grid;
  grid-auto-flow: column;
  grid-template-rows: repeat(4, 12px);
  grid-template-columns: repeat(60, minmax(0, 1fr));
  gap: 1px;
}
.cdn-cell {
  all: unset;
  display: block;
  min-width: 0;
  border-radius: 2px;
  background: var(--bar-green);
  cursor: pointer;
}
.cdn-cell[data-kind='stale'] {
  background: var(--bar-amber);
}
.cdn-cell[data-kind='collapsed'] {
  background: var(--bar-neutral);
}
.cdn-cell[data-kind='revalidate'] {
  background: var(--bar-violet);
}
.cdn-cell[data-kind='miss'] {
  background: var(--bar-red);
}
.cdn-cell[data-selected] {
  outline: 2px solid var(--ink);
  outline-offset: 1px;
  position: relative;
  z-index: 1;
}

.cdn-mark {
  position: absolute;
  top: -18px;
  bottom: -4px;
  border-left: 1px dashed var(--tone-info-strong);
  pointer-events: none;
  z-index: 2;
}
.cdn-mark__label {
  position: absolute;
  top: 0;
  left: 5px;
  white-space: nowrap;
  font-size: var(--fs-2);
  line-height: 1.2;
  color: var(--tone-info-text);
}
.cdn-grid {
  margin-top: 18px;
}

.cdn-origin {
  position: relative;
  min-height: 7px;
  border-bottom: 1px solid var(--border-strong);
}
.cdn-call {
  position: absolute;
  height: 5px;
  border-radius: 2px;
  background: var(--bar-red);
}
.cdn-call[data-status='304'] {
  background: var(--bar-violet);
}

.cdn-axis {
  position: relative;
  height: 16px;
}
.cdn-axis__tick {
  position: absolute;
  transform: translateX(-50%);
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--dim);
  white-space: nowrap;
}
.cdn-axis__tick:first-child {
  transform: none;
}
.cdn-axis__tick:last-child {
  transform: translateX(-100%);
}

.cdn-legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 14px;
  font-size: var(--fs-3);
  color: var(--text-muted);
}
.cdn-legend__item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.cdn-legend__item::before {
  content: '';
  width: 10px;
  height: 10px;
  border-radius: 2px;
  background: var(--bar-green);
}
.cdn-legend__item[data-kind='stale']::before {
  background: var(--bar-amber);
}
.cdn-legend__item[data-kind='collapsed']::before {
  background: var(--bar-neutral);
}
.cdn-legend__item[data-kind='revalidate']::before,
.cdn-legend__item[data-kind='call-304']::before {
  background: var(--bar-violet);
}
.cdn-legend__item[data-kind='miss']::before,
.cdn-legend__item[data-kind='call-200']::before {
  background: var(--bar-red);
}
.cdn-legend__item[data-kind^='call']::before {
  height: 5px;
}

.cdn-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px;
}
.cdn-stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  border-radius: var(--r2);
  background: var(--surface-2);
  min-width: 0;
}
.cdn-stat__value {
  font-family: var(--mono);
  font-size: var(--fs-7);
  color: var(--ink);
}
.cdn-stat__hint {
  font-size: var(--fs-3);
  line-height: 1.45;
  color: var(--text-muted);
}

.cdn-detail {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  border-radius: var(--r2);
  background: var(--surface-2);
  min-width: 0;
}
.cdn-detail__live {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.cdn-detail__text {
  font-size: var(--fs-5);
  line-height: 1.6;
  color: var(--prose);
}
.cdn-detail__headers {
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--text);
  overflow-x: auto;
  white-space: pre;
}
.cdn-detail__nav {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
