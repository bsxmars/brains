<script setup lang="ts">
/**
 * «Резолвер в работе»: карта `exports` (готовые фикстуры стенда или своя правка), набор
 * условий и спецификатор — и ответ: какой файл выбран и по каким шагам, или какая ошибка.
 *
 * Файл выбирает не компонент, а строка `RESOLVE_CODE` из темы, собранная `new Function`
 * (`model/run.ts`). Та же строка напечатана на странице и сверяется
 * `tests/unit/package-publishing.test.ts` с Node 24 на всех фикстурах в четырёх режимах.
 * Компонент только проверяет, есть ли выбранный файл в списке файлов фикстуры, — так
 * поступает загрузка, когда резолвер уже ответил.
 */
import { computed, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { loadResolver } from '../model/run';
import type { ConditionEnv, ExportsPreset, ExportsValue, ResolveResult } from '../model/types';

const props = defineProps<{
  resolveCode: string;
  presets: ExportsPreset[];
  envs: ConditionEnv[];
  /** Условия, которые можно включать поштучно. `default` включён всегда и в списке не нужен. */
  conditionKeys: string[];
  /** Пояснения к ответам: ключ — код ошибки, `ok`, `MISSING_FILE` и т. п. Строчная разметка. */
  texts: Record<string, string>;
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const api = loadResolver(props.resolveCode);

const presetId = ref(props.presets[0].id);
const presetOptions = props.presets.map((p) => ({ value: p.id, label: p.label }));
const preset = computed(() => props.presets.find((p) => p.id === presetId.value) ?? props.presets[0]);

const print = (v: ExportsValue | null) => JSON.stringify(v, null, 2);
const source = ref(print(preset.value.exports));
const spec = ref(preset.value.specifiers[0]);
watch(preset, (p) => {
  source.value = print(p.exports);
  spec.value = p.specifiers[0];
});

/** Высота поля — по числу строк карты, чтобы она читалась без прокрутки. */
const rows = computed(() => Math.min(Math.max(source.value.split('\n').length + 1, 6), 24));

const envId = ref(props.envs[0].id);
const envOptions = props.envs.map((e) => ({ value: e.id, label: e.label }));
const env = computed(() => props.envs.find((e) => e.id === envId.value) ?? props.envs[0]);
const conditions = ref<string[]>([...props.envs[0].conditions]);
watch(env, (e) => {
  conditions.value = [...e.conditions];
});
/** Все условия, которые стоит показать: из списка и из выбранной среды (там бывают свои). */
const chips = computed(() => [...new Set([...props.conditionKeys, ...env.value.conditions])]);
const edited = computed(() => {
  const a = [...conditions.value].sort().join();
  return a !== [...env.value.conditions].sort().join();
});
function toggle(c: string) {
  conditions.value = conditions.value.includes(c) ? conditions.value.filter((x) => x !== c) : [...conditions.value, c];
}

const parsed = computed<{ ok: true; value: ExportsValue } | { ok: false }>(() => {
  try {
    return { ok: true, value: JSON.parse(source.value) as ExportsValue };
  } catch {
    return { ok: false };
  }
});

const fill = (text: string, vars: Record<string, string>) => text.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');

interface View {
  tone: 'ok' | 'warn' | 'err';
  head: string;
  text: string;
  log: string[];
  hint: string | null;
}

const view = computed<View>(() => {
  if (!parsed.value.ok) return { tone: 'err', head: 'JSON', text: props.texts.BAD_JSON, log: [], hint: null };
  const exp = parsed.value.value;
  if (exp === null || (typeof exp !== 'object' && typeof exp !== 'string')) {
    return { tone: 'err', head: 'JSON', text: props.texts.BAD_JSON, log: [], hint: null };
  }
  const [name, subpath] = api.splitSpecifier(spec.value.trim());
  if (name !== preset.value.name) {
    return { tone: 'warn', head: name || '—', text: fill(props.texts.OTHER_PACKAGE, { name: preset.value.name }), log: [], hint: null };
  }
  const r: ResolveResult = api.resolveExports(exp, subpath, conditions.value);
  if (r.error) return { tone: 'err', head: r.error, text: props.texts[r.error] ?? '', log: r.log, hint: null };
  const file = r.file ?? '';
  const exists = preset.value.files.includes(file.slice(2));
  const dts = /\.(m|c)?js$/.test(file) ? file.replace(/\.(m|c)?js$/, (_, m: string | undefined) => `.d.${m ?? ''}ts`) : null;
  return {
    tone: exists ? 'ok' : 'warn',
    head: file,
    text: fill(exists ? props.texts.ok : props.texts.MISSING_FILE, { file }),
    log: r.log,
    hint: dts && conditions.value.includes('types') ? fill(props.texts.TS_HINT, { file: dts }) : null,
  };
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="presetId" class="l-pills" label="Пакет" :options="presetOptions" />
    </template>

    <div class="xl-body">
      <Md class="xl-note" :text="preset.note" />

      <div class="xl-split">
        <div class="xl-pane">
          <label class="xl-label" :for="`xl-map-${preset.id}`">"exports" пакета {{ preset.name }}</label>
          <textarea
            :id="`xl-map-${preset.id}`"
            v-model="source"
            class="xl-map"
            :rows="rows"
            spellcheck="false"
            autocomplete="off"
          />
        </div>

        <div class="xl-pane xl-pane--side">
          <span class="xl-label">среда</span>
          <SegmentedControl v-model="envId" class="l-pills" label="Среда" :options="envOptions" />
          <div class="xl-chips" role="group" aria-label="Включённые условия">
            <button
              v-for="c in chips"
              :key="c"
              type="button"
              class="xl-chip"
              :aria-pressed="conditions.includes(c)"
              :data-on="conditions.includes(c) ? 'yes' : 'no'"
              @click="toggle(c)"
            >
              {{ c }}
            </button>
            <span class="xl-chip" data-on="always">default</span>
          </div>
          <Md class="xl-env" :text="env.note" />
          <span v-if="edited" class="xl-edited">набор изменён вручную</span>

          <label class="xl-label" :for="`xl-spec-${preset.id}`">спецификатор</label>
          <input :id="`xl-spec-${preset.id}`" v-model="spec" class="xl-spec" spellcheck="false" autocomplete="off" />
          <div class="xl-tries">
            <button
              v-for="s in preset.specifiers"
              :key="s"
              type="button"
              class="xl-try"
              :data-on="s === spec ? 'yes' : 'no'"
              @click="spec = s"
            >
              {{ s }}
            </button>
          </div>
        </div>
      </div>

      <div class="xl-result" :data-tone="view.tone" aria-live="polite">
        <code class="xl-head">{{ view.head }}</code>
        <Md class="xl-text" :text="view.text" />
        <ol v-if="view.log.length" class="xl-log">
          <li v-for="(line, i) in view.log" :key="i">{{ line }}</li>
        </ol>
        <Md v-if="view.hint" class="xl-text" :text="view.hint" />
      </div>

      <Md class="xl-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.xl-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.xl-note,
.xl-caption,
.xl-env,
.xl-text {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.xl-note :deep(code),
.xl-caption :deep(code),
.xl-env :deep(code),
.xl-text :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
  overflow-wrap: anywhere;
}

.xl-split {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 760px) {
  .xl-split {
    grid-template-columns: minmax(0, 1fr);
  }
}
.xl-pane {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.xl-pane--side {
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.xl-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

.xl-map {
  font: inherit;
  color: inherit;
  width: 100%;
  box-sizing: border-box;
  margin: 0;
  padding: 12px 14px;
  border: 1px solid var(--ink-line);
  border-radius: var(--r3);
  background: var(--ink);
  color: var(--code-fg);
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.6;
  resize: vertical;
  white-space: pre;
  overflow: auto;
}
.xl-spec {
  font: inherit;
  color: inherit;
  width: 100%;
  box-sizing: border-box;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--surface);
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
}

.xl-chips,
.xl-tries {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.xl-chip,
.xl-try {
  font: inherit;
  padding: 3px 10px;
  border: 1px solid var(--border-strong);
  border-radius: var(--r2);
  background: var(--surface);
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
  cursor: pointer;
}
.xl-chip[data-on='yes'] {
  border-color: var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.xl-chip[data-on='always'] {
  border-color: var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
  cursor: default;
}
.xl-try {
  max-width: 100%;
  overflow-wrap: anywhere;
  text-align: left;
}
.xl-try[data-on='yes'] {
  border-color: var(--tone-info-line);
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
}
.xl-chip:focus-visible,
.xl-try:focus-visible {
  outline: 2px solid var(--tone-info-strong);
  outline-offset: 1px;
}
.xl-edited {
  font-size: var(--fs-2);
  color: var(--tone-warn-text);
}

.xl-result {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 16px;
  border-radius: var(--r3);
  border: 1px solid var(--tone-ok-line);
  background: var(--tone-ok-bg);
  min-width: 0;
}
.xl-result[data-tone='warn'] {
  border-color: var(--tone-warn-line);
  background: var(--tone-warn-bg);
}
.xl-result[data-tone='err'] {
  border-color: var(--tone-err-line);
  background: var(--tone-err-bg);
}
.xl-head {
  padding: 0;
  background: none;
  font-family: var(--mono);
  font-size: var(--fs-5);
  font-weight: 600;
  color: var(--tone-ok-text);
  overflow-wrap: anywhere;
}
.xl-result[data-tone='warn'] .xl-head {
  color: var(--tone-warn-text);
}
.xl-result[data-tone='err'] .xl-head {
  color: var(--tone-err-text);
}
.xl-log {
  margin: 0;
  padding-left: 1.6em;
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.7;
  color: var(--prose);
  overflow-wrap: anywhere;
}
</style>
