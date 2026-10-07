<script setup lang="ts">
/**
 * «Кто победил»: шесть `.env`-файлов фикстуры, режим сборки, переменная оболочки и набор
 * префиксов — и итоговые переменные с тем, откуда каждая взята и кого перебила.
 *
 * Считает не компонент, а строка `LOAD_ENV_CODE` из темы, собранная `new Function`
 * (`model/run.ts`). Та же строка напечатана на странице и сверяется
 * `tests/unit/secrets-config.test.ts` с `loadEnv` настоящего Vite на всех 768 сочетаниях
 * того, что здесь можно переключить.
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { loadEnvApi } from '../model/run';
import type { EnvFiles } from '../model/types';

const props = defineProps<{
  loadEnvCode: string;
  files: EnvFiles;
  modes: string[];
  shellVar: Record<string, string>;
  prefixSets: { id: string; label: string; prefixes: string[] }[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const api = loadEnvApi(props.loadEnvCode);
const names = Object.keys(props.files);

const mode = ref(props.modes.includes('production') ? 'production' : props.modes[0]);
const modeOptions = props.modes.map((m) => ({ value: m, label: m }));
const prefixId = ref(props.prefixSets[0].id);
const prefixOptions = props.prefixSets.map((p) => ({ value: p.id, label: `envPrefix: ${p.label}` }));
const prefixes = computed(() => (props.prefixSets.find((p) => p.id === prefixId.value) ?? props.prefixSets[0]).prefixes);

const present = ref<Record<string, boolean>>(Object.fromEntries(names.map((n) => [n, true])));
const shellOn = ref(false);
const shellText = Object.entries(props.shellVar)
  .map(([k, v]) => `${k}=${v}`)
  .join(' ');

const readable = computed(() => api.envFilesFor(mode.value));

const result = computed(() => {
  const files: EnvFiles = {};
  for (const n of names) if (present.value[n]) files[n] = props.files[n];
  return api.loadEnvFiles(mode.value, files, shellOn.value ? props.shellVar : {}, prefixes.value);
});

/** Секрет — то, что Vite по умолчанию в бандл не пустил бы: имя без первого набора префиксов. */
const safePrefixes = props.prefixSets[0].prefixes;
const rows = computed(() => {
  const all = result.value.all;
  const secrets = Object.keys(all)
    .filter((k) => !safePrefixes.some((p) => k.startsWith(p)))
    .map((k) => all[k]);
  return Object.keys(all).map((key) => {
    const bundled = key in result.value.env;
    const secret = !safePrefixes.some((p) => key.startsWith(p)) || secrets.includes(all[key]);
    return {
      key,
      value: all[key],
      from: result.value.from[key],
      lost: result.value.lost[key] ?? [],
      bundled,
      tone: !bundled ? 'ok' : secret ? 'err' : 'warn',
      tag: !bundled ? 'не в бандл' : secret ? 'секрет в бандле' : 'в бандл',
    };
  });
});

function fileState(name: string): 'off' | 'skip' | 'on' {
  if (!present.value[name]) return 'off';
  return readable.value.includes(name) ? 'on' : 'skip';
}

const STATE_LABEL = { off: 'файла нет', skip: 'не читается в этом режиме', on: '' } as const;
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="el-tools">
        <SegmentedControl v-model="mode" class="l-pills" label="Режим сборки" :options="modeOptions" />
        <SegmentedControl v-model="prefixId" class="l-pills" label="Префиксы" :options="prefixOptions" />
      </div>
    </template>

    <div class="el-body">
      <div class="el-chips" role="group" aria-label="Какие файлы лежат в проекте">
        <button
          v-for="n in names"
          :key="n"
          type="button"
          class="el-chip el-chip--file"
          :aria-pressed="present[n]"
          @click="present[n] = !present[n]"
        >
          {{ n }}
        </button>
        <button type="button" class="el-chip el-chip--shell" :aria-pressed="shellOn" @click="shellOn = !shellOn">
          {{ shellText }} в оболочке
        </button>
      </div>

      <div class="el-split">
        <div class="el-files">
          <span class="el-label">файлы в порядке чтения</span>
          <div
            v-for="n in [...readable, ...names.filter((x) => !readable.includes(x))]"
            :key="n"
            class="el-file"
            :data-state="fileState(n)"
          >
            <span class="el-file__name">
              <code>{{ n }}</code>
              <span v-if="fileState(n) !== 'on'" class="el-file__why">{{ STATE_LABEL[fileState(n)] }}</span>
            </span>
            <pre v-if="fileState(n) === 'on'" class="el-code">{{ files[n].replace(/\n$/, '') }}</pre>
          </div>
        </div>

        <div class="el-result">
          <span class="el-label">итог: {{ Object.keys(result.env).length }} в бандл из {{ rows.length }}</span>
          <div v-for="r in rows" :key="r.key" class="el-row" :data-bundled="r.bundled ? 'yes' : 'no'">
            <div class="el-row__head">
              <code class="el-row__key">{{ r.key }}</code>
              <span class="el-tag" :data-tone="r.tone">{{ r.tag }}</span>
            </div>
            <code class="el-row__value">{{ r.value }}</code>
            <span class="el-row__from">из {{ r.from }}</span>
            <span v-for="(l, i) in r.lost" :key="i" class="el-row__lost">
              <s>{{ l[1] }}</s> — {{ l[0] }}
            </span>
          </div>
          <p v-if="!rows.length" class="el-empty">Ни одного файла — переменных нет.</p>
        </div>
      </div>

      <Md class="el-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.el-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 18px;
}
.el-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.el-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.el-chip {
  font: inherit;
  color: inherit;
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-full);
  background: var(--surface);
  color: var(--chip-text);
  font-family: var(--mono);
  font-size: var(--fs-3);
  cursor: pointer;
  overflow-wrap: anywhere;
  text-align: left;
}
.el-chip:hover {
  border-color: var(--ink);
  color: var(--ink);
}
.el-chip[aria-pressed='true'] {
  border-color: var(--ink);
  background: var(--ink);
  color: var(--surface);
}
.el-chip--file[aria-pressed='false'] {
  text-decoration: line-through;
}

.el-split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 760px) {
  .el-split {
    grid-template-columns: minmax(0, 1fr);
  }
}

.el-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.el-files,
.el-result {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.el-file {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.el-file[data-state='off'],
.el-file[data-state='skip'] {
  background: var(--surface-3);
}
.el-file__name {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
  font-size: var(--fs-3);
  color: var(--ink);
}
.el-file__name code {
  font-family: var(--mono);
  font-weight: 600;
}
.el-file[data-state='off'] .el-file__name code,
.el-file[data-state='skip'] .el-file__name code {
  font-weight: 400;
  color: var(--text-muted);
}
.el-file__why {
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.el-code {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--code-fg);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.el-row {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 10px 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
  font-size: var(--fs-3);
  color: var(--prose);
}
.el-row[data-bundled='no'] {
  background: var(--surface-3);
}
.el-row__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 4px 10px;
}
.el-row__key {
  font-family: var(--mono);
  font-weight: 600;
  color: var(--ink);
  overflow-wrap: anywhere;
}
.el-row__value {
  font-family: var(--mono);
  color: var(--ink);
  overflow-wrap: anywhere;
}
.el-row__from {
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.el-row__lost {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
  overflow-wrap: anywhere;
}
.el-tag {
  padding: 1px 8px;
  border-radius: var(--r-full);
  font-size: var(--fs-2);
  white-space: nowrap;
}
.el-tag[data-tone='ok'] {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.el-tag[data-tone='warn'] {
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.el-tag[data-tone='err'] {
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}
.el-empty {
  margin: 0;
  font-size: var(--fs-3);
  color: var(--text-muted);
}
.el-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.el-caption :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
</style>
