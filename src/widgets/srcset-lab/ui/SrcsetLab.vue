<script setup lang="ts">
/**
 * «Выбор из srcset»: какой файл возьмёт браузер при данной ширине окна и DPR — по модели
 * темы и по тому, что Chromium запросил на стенде.
 *
 * Выбор считает не компонент, а строка `SRCSET_CODE` из темы, собранная `new Function`
 * (`model/run.ts`). Та же строка напечатана на странице и сверяется
 * `tests/unit/images.test.ts` со всеми прогонами стенда. Колонка Chromium — литерал
 * `SCENARIOS[*].runs` как есть.
 */
import { computed, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { loadSrcset } from '../model/run';
import type { ImageFile, Scenario } from '../model/types';

const props = defineProps<{
  code: string;
  scenarios: Scenario[];
  files: Record<string, ImageFile>;
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const api = loadSrcset(props.code);

const scenarioId = ref(props.scenarios[0].id);
const scenario = computed(() => props.scenarios.find((s) => s.id === scenarioId.value) ?? props.scenarios[0]);
const scenarioOptions = props.scenarios.map((s) => ({ value: s.id, label: s.label }));

const uniq = (xs: number[]) => [...new Set(xs)].sort((a, b) => a - b);
const vwOptions = computed(() => uniq(scenario.value.runs.map((r) => r.vw)).map((v) => ({ value: String(v), label: `${v}` })));
const dprOptions = computed(() => uniq(scenario.value.runs.map((r) => r.dpr)).map((v) => ({ value: String(v), label: `×${v}` })));

const vw = ref('375');
const dpr = ref('1');
const cache = ref('none');

watch(
  scenario,
  (s) => {
    const vws = uniq(s.runs.map((r) => r.vw));
    const dprs = uniq(s.runs.map((r) => r.dpr));
    if (!vws.includes(Number(vw.value))) vw.value = String(vws.includes(375) ? 375 : vws[0]);
    if (!dprs.includes(Number(dpr.value))) dpr.value = String(dprs[0]);
  },
  { immediate: true },
);

const isX = computed(() => scenario.value.srcset.split(',').every((p) => !p.trim().endsWith('w')));
const cacheFile = computed(() => (isX.value ? 'a-3x.jpg' : 'p-1200.jpg'));
const cacheOptions = computed(() => [
  { value: 'none', label: 'кеш пуст' },
  { value: 'one', label: `в кеше ${cacheFile.value}` },
]);

const choice = computed(() =>
  api.pickCandidate(scenario.value.srcset, scenario.value.sizes, {
    vw: Number(vw.value),
    dpr: Number(dpr.value),
    cached: cache.value === 'one' ? [cacheFile.value] : [],
  }),
);

const axis = computed(() => Math.max(Number(dpr.value), ...choice.value.list.map((c) => c.density)) * 1.08);
const pct = (x: number) => `${Math.min(100, (x / axis.value) * 100)}%`;

const fmt = (n: number) => n.toLocaleString('ru-RU');
const mb = (n: number) => `${(n / 1e6).toFixed(2)} МБ`;

function state(url: string, density: number): 'pick' | 'shown' | 'short' | 'spare' {
  if (url === choice.value.shown) return choice.value.shown === choice.value.pick ? 'pick' : 'shown';
  if (url === choice.value.pick) return 'pick';
  return density < Number(dpr.value) ? 'short' : 'spare';
}
const STATE_LABEL = { pick: 'запрошен', shown: 'из кеша', short: 'мало точек', spare: 'лишнее' } as const;

const slotText = computed(() => {
  if (isX.value) return 'У `x`-дескрипторов слот не нужен: плотность записана в разметке.';
  const s = choice.value.slot;
  const where = s.rule ? `сработало \`${s.rule}\`` : '`sizes` нет — слот `100vw`';
  return `Слот: ${where} → **${+s.px.toFixed(2)} CSS px**. Плотность файла = его ширина / ${+s.px.toFixed(2)}.`;
});

const resultText = computed(() => {
  const c = choice.value;
  const f = props.files[c.pick];
  const base = `Модель запросит \`${c.pick}\`: ${fmt(f.bytes)} байт файла, битмап ${f.w}×${f.h}×4 = **${mb(f.w * f.h * 4)}**.`;
  if (c.shown === c.pick) return base;
  return `${base} Но элемент покажет \`${c.shown}\` из кеша: он плотнее.`;
});

const standText = computed(() => {
  if (cache.value === 'one') return 'Кеш стенд снимал отдельными сценариями, колонки Chromium для этого случая нет.';
  const run = scenario.value.runs.find((r) => r.vw === Number(vw.value) && r.dpr === Number(dpr.value));
  if (!run) return 'Этот случай стенд не снимал.';
  return run.got === choice.value.pick
    ? `Chromium 153 на стенде запросил тот же \`${run.got}\`.`
    : `Chromium 153 на стенде запросил \`${run.got}\`, модель — \`${choice.value.pick}\`: расхождение.`;
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="sl-tools">
        <SegmentedControl v-model="scenarioId" class="l-pills" label="Разметка" :options="scenarioOptions" />
        <SegmentedControl v-model="vw" class="l-pills" label="Ширина окна, CSS px" :options="vwOptions" />
        <SegmentedControl v-model="dpr" class="l-pills" label="DPR" :options="dprOptions" />
        <SegmentedControl v-model="cache" class="l-pills" label="Кеш" :options="cacheOptions" />
      </div>
    </template>

    <div class="sl-body">
      <div class="sl-markup">
        <span class="sl-label">srcset</span>
        <code class="sl-code">{{ scenario.srcset }}</code>
        <template v-if="scenario.sizes">
          <span class="sl-label">sizes</span>
          <code class="sl-code">{{ scenario.sizes }}</code>
        </template>
      </div>

      <Md class="sl-text" :text="slotText" />

      <div class="sl-scroll">
        <div class="sl-list">
          <div
            v-for="c in choice.list"
            :key="c.url"
            class="sl-row"
            :data-state="state(c.url, c.density)"
          >
            <span class="sl-url">{{ c.url }}</span>
            <span class="sl-bytes">{{ fmt(files[c.url]?.bytes ?? 0) }} Б</span>
            <div class="sl-track">
              <span class="sl-bar" :style="{ width: pct(c.density) }" />
              <span class="sl-dpr" :style="{ left: pct(Number(dpr)) }" />
            </div>
            <span class="sl-density">{{ c.density.toFixed(2) }}</span>
            <span class="sl-chip">{{ STATE_LABEL[state(c.url, c.density)] }}</span>
          </div>
        </div>
      </div>

      <Md class="sl-text" :text="resultText" />
      <Md class="sl-text sl-stand" :text="standText" />

      <div class="sl-legend">
        <span class="sl-key sl-key--dpr">DPR экрана</span>
        <span class="sl-key" data-state="pick">запрошен</span>
        <span class="sl-key" data-state="shown">показан из кеша</span>
        <span class="sl-key" data-state="short">плотность меньше DPR</span>
      </div>

      <Md class="sl-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.sl-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
  min-width: 0;
}
.sl-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
  min-width: 0;
}
.sl-markup {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 6px 12px;
  align-items: baseline;
  padding: 12px 14px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.sl-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.sl-code {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
  overflow-wrap: anywhere;
}
.sl-scroll {
  overflow-x: auto;
  min-width: 0;
}
.sl-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 520px;
}
.sl-row {
  display: grid;
  grid-template-columns: 108px 84px minmax(120px, 1fr) 48px 104px;
  grid-template-areas: 'url bytes track density chip';
  gap: 10px;
  align-items: center;
  padding: 6px 10px;
  border-radius: var(--r2);
  background: var(--surface-2);
  font-size: var(--fs-3);
}
.sl-url {
  grid-area: url;
}
.sl-bytes {
  grid-area: bytes;
}
.sl-track {
  grid-area: track;
}
.sl-density {
  grid-area: density;
}
.sl-chip {
  grid-area: chip;
}
@media (max-width: 640px) {
  .sl-list {
    min-width: 0;
  }
  .sl-row {
    grid-template-columns: minmax(0, 1fr) auto auto;
    grid-template-areas:
      'url density chip'
      'track track track'
      'bytes bytes bytes';
    row-gap: 6px;
  }
  .sl-bytes {
    text-align: left;
  }
}
.sl-url,
.sl-bytes,
.sl-density {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--prose);
}
.sl-bytes,
.sl-density {
  text-align: right;
  color: var(--text-muted);
}
.sl-track {
  position: relative;
  height: 14px;
  border-radius: var(--r1);
  background: var(--surface-3);
}
.sl-bar {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  border-radius: var(--r1);
  background: var(--tone-info-line);
}
.sl-dpr,
.sl-key--dpr::before {
  background: var(--ink);
}
.sl-dpr {
  position: absolute;
  top: -4px;
  bottom: -4px;
  width: 2px;
  margin-left: -1px;
}
.sl-chip {
  justify-self: start;
  padding: 2px 8px;
  border-radius: var(--r-full);
  font-size: var(--fs-2);
  background: var(--surface-3);
  color: var(--text-muted);
}
.sl-row[data-state='pick'] {
  background: var(--tone-ok-bg);
  box-shadow: inset 3px 0 0 var(--tone-ok-line);
}
.sl-row[data-state='pick'] .sl-bar,
.sl-key[data-state='pick']::before {
  background: var(--tone-ok-line);
}
.sl-row[data-state='pick'] .sl-chip {
  background: var(--tone-ok-line);
  color: var(--tone-ok-text);
}
.sl-row[data-state='shown'] {
  background: var(--tone-warn-bg);
  box-shadow: inset 3px 0 0 var(--tone-warn-line);
}
.sl-row[data-state='shown'] .sl-bar,
.sl-key[data-state='shown']::before {
  background: var(--tone-warn-line);
}
.sl-row[data-state='shown'] .sl-chip {
  background: var(--tone-warn-line);
  color: var(--tone-warn-text);
}
.sl-row[data-state='short'] .sl-bar,
.sl-key[data-state='short']::before {
  background: var(--tone-err-line);
}
.sl-text,
.sl-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.sl-stand {
  padding: 10px 12px;
  border-radius: var(--r2);
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
}
.sl-text :deep(code),
.sl-caption :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
.sl-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 18px;
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.sl-key {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.sl-key::before {
  content: '';
  display: inline-block;
  width: 14px;
  height: 10px;
  border-radius: 2px;
}
.sl-key--dpr::before {
  width: 2px;
}
</style>
