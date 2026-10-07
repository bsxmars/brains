<script setup lang="ts">
/**
 * «Что и когда скачивается»: карта настоящей страницы сайта, окно прокрутки и журнал
 * загрузок — какие острова ожили и какие чанки браузер скачал на каждом шаге.
 *
 * Считает не компонент, а строка `PLAN_CODE` из темы, собранная `new Function`
 * (`model/run.ts`). Та же строка напечатана на странице и в `tests/unit/islands.test.ts`
 * сверяется с тем, что Chromium запросил при прокрутке этих страниц. Компонент только
 * рисует: положение островов на карте — подпись к расчёту, а не расчёт.
 */
import { computed, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { htmlRefBytes, loadPlan, planPage } from '../model/run';
import type { LabMode, StandPage } from '../model/types';

const props = defineProps<{
  planCode: string;
  pages: StandPage[];
  modes: LabMode[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const plan = loadPlan(props.planCode);
const VIEWPORT = 800;
const MAP_HEIGHT = 340;

const pageKey = ref(props.pages[0].key);
const modeKey = ref(props.modes[0].value);
const pageOptions = props.pages.map((p) => ({ value: p.key, label: p.route }));
const modeOptions = props.modes.map((m) => ({ value: m.value, label: m.label }));

const page = computed(() => props.pages.find((p) => p.key === pageKey.value) ?? props.pages[0]);
const mode = computed(() => props.modes.find((m) => m.value === modeKey.value) ?? props.modes[0]);
const steps = computed(() => planPage(plan, page.value, mode.value.client));

const index = ref(0);
watch([pageKey, modeKey], () => {
  index.value = 0;
});

const y = computed(() => steps.value[index.value]?.y ?? 0);
const done = computed(() => steps.value.slice(0, index.value + 1));
const events = computed(() => done.value.filter((s) => s.files.length));
const live = computed(() => new Set(done.value.flatMap((s) => s.islands)));
const fetchedBytes = computed(() => done.value.reduce((n, s) => n + s.bytes, 0));
const fetchedFiles = computed(() => done.value.reduce((n, s) => n + s.files.length, 0));
const totalBytes = computed(() => Object.values(page.value.graph).reduce((n, g) => n + g.bytes, 0));
const totalFiles = computed(() => Object.keys(page.value.graph).length);
const refBytes = computed(() => htmlRefBytes(page.value));

const fmt = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
/** Имя чанка без хеша — для подписи; полное имя в подсказке. `client.*` разных фреймворков различаются только хешем. */
const short = (file: string) => (file.startsWith('client.') ? file : file.replace(/\.[\w-]{8}\.js$/, '.js'));
const files = (n: number) => {
  const d = n % 10;
  const dd = n % 100;
  if (d === 1 && dd !== 11) return `${n} файл`;
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return `${n} файла`;
  return `${n} файлов`;
};

/** Карта: острова на своих местах с учётом выросших выше. */
const scale = computed(() => MAP_HEIGHT / page.value.pageHeight);
const boxes = computed(() =>
  page.value.islands.map((island) => {
    let shift = 0;
    for (const other of page.value.islands) {
      if (live.value.has(other.id) && other.top < island.top) shift += other.liveHeight - other.ssrHeight;
    }
    const isLive = live.value.has(island.id);
    const height = isLive ? island.liveHeight : island.ssrHeight;
    return {
      id: island.id,
      live: isLive,
      top: (island.top + shift) * scale.value,
      height: Math.max(3, height * scale.value),
      /** Острова, стоящие рядом в одной строке, — половинами ширины. */
      side: page.value.islands.filter((o) => o.top === island.top).indexOf(island),
      pair: page.value.islands.filter((o) => o.top === island.top).length,
    };
  }),
);
const windowBox = computed(() => ({ top: y.value * scale.value, height: VIEWPORT * scale.value }));
const status = computed(() => {
  const s = steps.value[index.value];
  if (!s) return '';
  const at = s.y === 0 ? 'Первый экран' : `Прокрутка до ${fmt(s.y)} px`;
  if (!s.files.length) return `${at}: ничего не скачано.`;
  return `${at}: ${s.islands.length > 1 ? "ожили" : "ожил"} ${s.islands.map((i) => `\`${i}\``).join(', ')} — ${files(s.files.length)}, ${fmt(s.bytes)} байт.`;
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="il-toolbar">
        <SegmentedControl v-model="pageKey" class="l-pills" label="Страница" :options="pageOptions" />
        <SegmentedControl v-model="modeKey" class="l-pills" label="Директивы" :options="modeOptions" />
      </div>
    </template>

    <div class="il-body">
      <label class="il-range">
        <span class="il-label">прокрутка: {{ fmt(y) }} px из {{ fmt(page.pageHeight) }}</span>
        <input
          v-model.number="index"
          type="range"
          min="0"
          :max="steps.length - 1"
          step="1"
          :aria-valuetext="`${y} пикселей`"
        />
      </label>

      <div class="il-split">
        <div class="il-map" :style="{ height: `${MAP_HEIGHT}px` }" role="img" :aria-label="`Карта страницы ${page.route}: окно на ${y} px`">
          <div
            v-for="b in boxes"
            :key="b.id"
            class="il-island"
            :data-live="b.live ? 'yes' : 'no'"
            :title="b.id"
            :style="{
              top: `${b.top}px`,
              height: `${b.height}px`,
              left: `calc(${(b.side / b.pair) * 100}% + 4px)`,
              width: `calc(${100 / b.pair}% - 8px)`,
            }"
          />
          <div class="il-window" :style="{ top: `${windowBox.top}px`, height: `${windowBox.height}px` }" />
        </div>

        <div class="il-side">
          <Md class="il-status" :text="status" />

          <div class="il-stats">
            <div class="il-stat">
              <span class="il-label">скачано к этому шагу</span>
              <span class="il-stat__value">{{ fmt(fetchedBytes) }} байт</span>
              <span class="il-stat__note">{{ fetchedFiles }} из {{ files(totalFiles) }}, всего {{ fmt(totalBytes) }} байт</span>
            </div>
            <div class="il-stat">
              <span class="il-label">ссылки из HTML</span>
              <span class="il-stat__value">{{ fmt(refBytes) }} байт</span>
              <span class="il-stat__note">только component-url и renderer-url</span>
            </div>
          </div>

          <ol class="il-log" aria-label="Журнал загрузок">
            <li v-if="!events.length" class="il-log__empty">ни одного запроса за скриптами</li>
            <li v-for="s in events" :key="s.y" class="il-log__item">
              <span class="il-log__head">
                <code>{{ s.y === 0 ? 'старт' : `${fmt(s.y)} px` }}</code>
                <span>{{ s.islands.join(', ') }}</span>
                <span class="il-log__bytes">{{ fmt(s.bytes) }} байт</span>
              </span>
              <span class="il-log__files">
                <code v-for="f in s.files" :key="f" class="il-chip" :title="`${f} — ${page.graph[f].bytes} байт`">{{ short(f) }}</code>
              </span>
            </li>
          </ol>
        </div>
      </div>

      <Md class="il-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.il-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 18px;
}
.il-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.il-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.il-range {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.il-range input {
  width: 100%;
  font: inherit;
  color: inherit;
  accent-color: var(--ink);
}

.il-split {
  display: grid;
  grid-template-columns: 120px minmax(0, 1fr);
  gap: 18px;
  align-items: start;
}
@media (max-width: 560px) {
  .il-split {
    grid-template-columns: 84px minmax(0, 1fr);
    gap: 12px;
  }
}

.il-map {
  position: relative;
  overflow: hidden;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.il-island {
  position: absolute;
  border-radius: var(--r1);
  background: var(--surface-3);
  box-shadow: inset 0 0 0 1px var(--border);
  transition: top 0.25s ease, height 0.25s ease, background-color 0.25s ease;
}
.il-island[data-live='yes'] {
  background: var(--tone-ok-bg);
  box-shadow: inset 0 0 0 1px var(--tone-ok-line);
}
.il-window {
  position: absolute;
  left: 0;
  right: 0;
  border-radius: var(--r1);
  box-shadow: inset 0 0 0 2px var(--tone-warn-accent);
  transition: top 0.25s ease;
}
@media (prefers-reduced-motion: reduce) {
  .il-island,
  .il-window {
    transition: none;
  }
}

.il-side {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}
.il-status,
.il-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.il-status :deep(code),
.il-caption :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}

.il-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 10px;
}
.il-stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.il-stat__value {
  font-family: var(--mono);
  font-size: var(--fs-5);
  color: var(--ink);
}
.il-stat__note {
  font-size: var(--fs-2);
  color: var(--text-muted);
}

.il-log {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.il-log__empty {
  font-size: var(--fs-3);
  color: var(--text-muted);
}
.il-log__item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
  font-size: var(--fs-3);
  color: var(--prose);
}
.il-log__head {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  align-items: baseline;
}
.il-log__head code {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
}
.il-log__bytes {
  margin-left: auto;
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.il-log__files {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.il-chip {
  padding: 1px 6px;
  border-radius: var(--r1);
  background: var(--surface-3);
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--prose);
  overflow-wrap: anywhere;
}
</style>
