<script setup lang="ts">
/**
 * «Решение по таблице»: запрос browserslist → список версий → цели → что переписать,
 * что дописать и что оставить в сквозном примере темы.
 *
 * Решение считает не компонент, а строка `DECIDE_CODE` из темы, собранная `new Function`
 * (`model/run.ts`), по двум таблицам: строкам `@babel/compat-data` и `core-js-compat`.
 * Та же строка напечатана на странице и сверяется `tests/unit/transpilation.test.ts`
 * с решением `@babel/preset-env`. Код после Babel и байты — литералы стенда для каждого
 * запроса; для «своей цели» их нет, и демо говорит об этом прямо.
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { loadDecide } from '../model/run';
import type { CompatTable, CustomRange, FeatureRow, TranspilePreset } from '../model/types';

const props = defineProps<{
  decideCode: string;
  presets: TranspilePreset[];
  compat: CompatTable;
  core: CompatTable;
  features: FeatureRow[];
  custom: CustomRange[];
  /** Байты сквозного примера после минификации — база для «×». */
  sourceMin: number;
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const api = loadDecide(props.decideCode);

const CUSTOM_ID = 'custom';
const picked = ref(props.presets[1]?.id ?? props.presets[0].id);
const options = [
  ...props.presets.map((p) => ({ value: p.id, label: p.query })),
  { value: CUSTOM_ID, label: 'своя цель' },
];
const preset = computed(() => props.presets.find((p) => p.id === picked.value) ?? null);

const browser = ref(props.custom[0].name);
const browserOptions = props.custom.map((c) => ({ value: c.name, label: c.label }));
const range = computed(() => props.custom.find((c) => c.name === browser.value) ?? props.custom[0]);
/** Позиция ползунка для каждого браузера своя: переключение браузера её не сбрасывает. */
const positions = ref<Record<string, number>>(
  Object.fromEntries(props.custom.map((c) => [c.name, Math.floor(c.versions.length / 2)])),
);
const position = computed({
  get: () => Math.min(positions.value[browser.value] ?? 0, range.value.versions.length - 1),
  set: (v: number) => {
    positions.value = { ...positions.value, [browser.value]: v };
  },
});
const customVersion = computed(() => range.value.versions[position.value]);

const browsers = computed<string[]>(() =>
  preset.value ? preset.value.browsers : [`${browser.value} ${customVersion.value}`],
);
const targets = computed(() => api.lowestVersions(browsers.value));
const targetList = computed(() => Object.entries(targets.value));

/** Строка списка, которую Babel пропустил: браузера нет в его словаре. */
const chips = computed(() =>
  browsers.value.map((line) => ({ line, ignored: Object.keys(api.lowestVersions([line])).length === 0 })),
);
const ignoredCount = computed(() => chips.value.filter((c) => c.ignored).length);

interface Row {
  key: string;
  code: string;
  kind: FeatureRow['kind'];
  item: string;
  verdict: 'rewrite' | 'add' | 'keep';
  label: string;
  why: string;
}

const rows = computed<Row[]>(() =>
  props.features.map((f) => {
    const table = f.kind === 'syntax' ? props.compat : props.core;
    const support = table[f.item] ?? {};
    const needed = api.required({ [f.item]: support }, targets.value).length > 0;
    const older: string[] = [];
    const absent: string[] = [];
    for (const env of api.blockers(support, targets.value)) {
      const since = support[env] ?? (env === 'android' ? support.chrome : undefined);
      if (since) older.push(`${env} ${targets.value[env]} < ${since}`);
      else absent.push(env);
    }
    const who = [...older, ...(absent.length ? [`нет в таблице: ${absent.join(', ')}`] : [])];
    const verdict = !needed ? 'keep' : f.kind === 'syntax' ? 'rewrite' : 'add';
    return {
      key: `${f.kind}:${f.item}`,
      code: f.code,
      kind: f.kind,
      item: f.item,
      verdict,
      label: verdict === 'rewrite' ? 'переписать' : verdict === 'add' ? 'дописать' : f.kind === 'syntax' ? 'оставить' : 'не нужен',
      why: !needed ? '' : who.length ? who.join('; ') : 'целей нет — всё',
    };
  }),
);

/** «1 версия», «2 версии», «35 версий». */
function plural(n: number): string {
  const d = n % 10;
  const dd = n % 100;
  if (d === 1 && dd !== 11) return 'версия';
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return 'версии';
  return 'версий';
}

const counts = computed(() => ({
  syntax: props.features.filter((f) => f.kind === 'syntax').length,
  api: props.features.filter((f) => f.kind === 'api').length,
  rewrite: rows.value.filter((r) => r.verdict === 'rewrite').length,
  add: rows.value.filter((r) => r.verdict === 'add').length,
}));

const fmt = (n: number) => n.toLocaleString('ru-RU');
const ratio = (n: number) => `×${(n / props.sourceMin).toFixed(1).replace('.', ',')}`;
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="picked" class="l-pills" label="Запрос browserslist" :options="options" />
    </template>

    <div class="tp-body">
      <div v-if="!preset" class="tp-custom">
        <SegmentedControl v-model="browser" class="l-pills" label="Браузер" :options="browserOptions" />
        <label class="tp-range">
          <span class="tp-label">версия {{ customVersion }}</span>
          <input
            v-model.number="position"
            type="range"
            min="0"
            :max="range.versions.length - 1"
            step="1"
            :aria-valuetext="`${range.label} ${customVersion}`"
          />
        </label>
      </div>

      <div class="tp-step">
        <span class="tp-label">
          browserslist → {{ browsers.length }} {{ plural(browsers.length) }}<template v-if="ignoredCount">, из них {{ ignoredCount }} Babel не знает</template>
        </span>
        <div class="tp-chips">
          <code v-for="c in chips" :key="c.line" class="tp-chip" :data-ignored="c.ignored ? 'yes' : 'no'">{{ c.line }}</code>
        </div>
      </div>

      <div class="tp-step">
        <span class="tp-label">цели — самая старая версия каждого</span>
        <div class="tp-chips">
          <code v-for="[env, v] in targetList" :key="env" class="tp-chip tp-chip--target">{{ env }} {{ v }}</code>
          <span v-if="!targetList.length" class="tp-empty">целей нет — Babel переписывает всё</span>
        </div>
      </div>

      <div class="tp-table" role="table" aria-label="Решение по конструкциям корзины">
        <div class="tp-row tp-row--head" role="row">
          <span role="columnheader" class="tp-c-code">в коде</span>
          <span role="columnheader" class="tp-c-item">плагин или модуль</span>
          <span role="columnheader" class="tp-c-verdict">решение</span>
          <span role="columnheader" class="tp-c-why">кто мешает</span>
        </div>
        <div v-for="r in rows" :key="r.key" class="tp-row" role="row" :data-verdict="r.verdict">
          <code role="cell" class="tp-code-cell tp-c-code">{{ r.code }}</code>
          <code role="cell" class="tp-item tp-c-item">{{ r.item }}</code>
          <span role="cell" class="tp-verdict tp-c-verdict">{{ r.label }}</span>
          <span role="cell" class="tp-why tp-c-why">{{ r.why }}</span>
        </div>
      </div>

      <p class="tp-sum">
        Переписать: {{ counts.rewrite }} из {{ counts.syntax }} конструкций синтаксиса. Дописать: {{ counts.add }}
        из {{ counts.api }} модулей core-js.
      </p>

      <template v-if="preset">
        <div class="tp-bytes">
          <div class="tp-byte">
            <span class="tp-label">код после Babel</span>
            <strong>{{ fmt(preset.min) }} Б</strong>
            <span>{{ ratio(preset.min) }} к исходнику, gzip {{ fmt(preset.gzip) }} Б</span>
          </div>
          <div class="tp-byte">
            <span class="tp-label">полифилы, usage</span>
            <strong>{{ fmt(preset.usageBytes) }} Б</strong>
            <span>{{ preset.usage.length }} мод., gzip {{ fmt(preset.usageGzip) }} Б</span>
          </div>
          <div class="tp-byte">
            <span class="tp-label">полифилы, entry</span>
            <strong>{{ fmt(preset.entryBytes) }} Б</strong>
            <span>{{ preset.entry }} мод., gzip {{ fmt(preset.entryGzip) }} Б</span>
          </div>
        </div>

        <div class="tp-out">
          <span class="tp-label">cart.js после preset-env, без полифилов</span>
          <pre class="tp-pre">{{ preset.code }}</pre>
        </div>
      </template>

      <Md class="tp-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.tp-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.tp-caption,
.tp-sum {
  margin: 0;
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.tp-caption :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
.tp-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.tp-custom {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 20px;
  align-items: center;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.tp-range {
  display: flex;
  flex: 1 1 220px;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.tp-range input {
  width: 100%;
  font: inherit;
  color: inherit;
  accent-color: var(--ink);
}

.tp-step {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.tp-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 9.5em;
  overflow-y: auto;
}
.tp-chip {
  padding: 2px 7px;
  border-radius: var(--r1);
  background: var(--surface-3);
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--ink);
  white-space: nowrap;
}
.tp-chip[data-ignored='yes'] {
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
  text-decoration: line-through;
}
.tp-chip--target {
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
  font-weight: 600;
}
.tp-empty {
  font-size: var(--fs-3);
  color: var(--tone-err-text);
}

.tp-table {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow-x: auto;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.tp-row {
  display: grid;
  grid-template-columns: minmax(150px, 1.1fr) minmax(170px, 1.2fr) 90px minmax(150px, 1.2fr);
  gap: 10px;
  min-width: 600px;
  padding: 7px 12px;
  align-items: baseline;
  font-size: var(--fs-3);
  color: var(--prose);
}
@media (max-width: 640px) {
  .tp-row {
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas: 'code verdict' 'item item' 'why why';
    gap: 2px 10px;
    min-width: 0;
  }
  .tp-c-code { grid-area: code; }
  .tp-c-item { grid-area: item; }
  .tp-c-verdict { grid-area: verdict; }
  .tp-c-why { grid-area: why; }
  .tp-row--head { display: none; }
}
.tp-row + .tp-row {
  border-top: 1px solid var(--hairline);
}
.tp-row--head {
  font-family: var(--mono);
  font-size: var(--fs-2);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}
.tp-code-cell,
.tp-item {
  padding: 0;
  background: none;
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--ink);
  overflow-wrap: anywhere;
}
.tp-item {
  color: var(--text-muted);
}
.tp-verdict {
  font-weight: 600;
}
.tp-row[data-verdict='rewrite'] .tp-verdict {
  color: var(--tone-warn-text);
}
.tp-row[data-verdict='add'] .tp-verdict {
  color: var(--tone-err-text);
}
.tp-row[data-verdict='keep'] .tp-verdict {
  color: var(--tone-ok-text);
}
.tp-why {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

.tp-bytes {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 12px;
}
.tp-byte {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
  font-size: var(--fs-3);
  color: var(--prose);
}
.tp-byte strong {
  font-family: var(--mono);
  font-size: var(--fs-5);
  color: var(--ink);
}

.tp-out {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.tp-pre {
  margin: 0;
  max-height: 26em;
  overflow: auto;
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.6;
  /* Подложка — общая для кода курса (`pre` в base.css, чернильная): цвет — «на чернилах». */
  color: var(--code-fg);
  white-space: pre;
}
</style>
