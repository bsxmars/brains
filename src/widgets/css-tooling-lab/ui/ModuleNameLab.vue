<script setup lang="ts">
/**
 * «Имя из хеша»: CSS-модуль, который читатель может править, и имена, которые получат его классы.
 *
 * Имена считает не компонент, а строка `MODULE_NAME_CODE` из темы, собранная `new Function`
 * (`model/run.ts`). Та же строка напечатана на странице и сверяется
 * `tests/unit/css-tooling.test.ts` с именами, которые пишет Vite 8, — на фикстурах и на правках.
 * Компонент только раскладывает готовое имя на части для подписи.
 */
import { computed, ref, watch } from 'vue';
import CodeInput from '@/shared/ui/CodeInput.vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { loadModuleNamer } from '../model/run';
import type { ModuleFile } from '../model/types';

const props = defineProps<{
  code: string;
  files: ModuleFile[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const namer = loadModuleNamer(props.code);

const picked = ref(props.files[0].id);
const options = props.files.map((f) => ({ value: f.id, label: f.label }));
const file = computed(() => props.files.find((f) => f.id === picked.value) ?? props.files[0]);

const text = ref(props.files[0].css);
watch(file, (f) => {
  text.value = f.css;
});

const hash = computed(() => namer.stringHash(text.value));
const base36 = computed(() => hash.value.toString(36));

interface Row {
  name: string;
  hash: string;
  line: string;
  /** Имена из `composes`, которые модуль дописал через пробел. */
  extra: string[];
}

const rows = computed<Row[]>(() => {
  let out: Record<string, string>;
  try {
    out = namer.moduleExports(text.value);
  } catch {
    return [];
  }
  return Object.entries(out).map(([name, value]) => {
    const [own, ...extra] = value.split(' ');
    const parts = own.slice(name.length + 2).split('_');
    return { name, hash: parts[0], line: parts[1], extra };
  });
});

const edited = computed(() => text.value !== file.value.css);
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="picked" class="l-pills" label="Файл" :options="options" />
    </template>

    <div class="ml-body">
      <div class="ml-split">
        <CodeInput v-model="text" :label="file.path" :rows="14" />

        <div class="ml-out">
          <span class="ml-label">хеш текста файла</span>
          <p class="ml-hash">
            <code>stringHash</code> → <code>{{ hash }}</code> → по основанию 36
            <code><mark class="ml-mark">{{ base36.slice(0, 5) }}</mark>{{ base36.slice(5) }}</code>
            <span v-if="edited" class="ml-edited">файл изменён</span>
          </p>

          <span class="ml-label">что модуль отдаёт в JS</span>
          <div v-for="r in rows" :key="r.name" class="ml-row">
            <code class="ml-key">{{ r.name }}</code>
            <code class="ml-val"
              >_{{ r.name }}_<mark class="ml-mark">{{ r.hash }}</mark>_<span class="ml-line">{{ r.line }}</span
              ><template v-for="x in r.extra" :key="x">{{ ' ' + x }}</template></code
            >
            <span class="ml-note">строка {{ r.line }}{{ r.extra.length ? ' · composes' : '' }}</span>
          </div>
          <p v-if="!rows.length" class="ml-empty">Локальных классов не найдено.</p>
        </div>
      </div>

      <Md class="ml-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.ml-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.ml-split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 760px) {
  .ml-split {
    grid-template-columns: minmax(0, 1fr);
  }
}
.ml-out {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.ml-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.ml-hash {
  margin: 0 0 8px;
  font-size: var(--fs-3);
  line-height: 1.7;
  color: var(--prose);
  overflow-wrap: anywhere;
}
.ml-out code {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
}
.ml-mark {
  padding: 0 2px;
  border-radius: 3px;
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
  font-weight: 600;
}
.ml-edited {
  margin-left: 6px;
  padding: 1px 8px;
  border-radius: var(--r-full);
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
  font-size: var(--fs-2);
}
.ml-row {
  display: grid;
  grid-template-columns: minmax(0, 0.6fr) minmax(0, 1.6fr);
  gap: 4px 10px;
  align-items: baseline;
  padding: 8px 10px;
  border-radius: var(--r2);
  background: var(--surface-2);
}
.ml-key {
  font-weight: 600;
  overflow-wrap: anywhere;
}
.ml-val {
  overflow-wrap: anywhere;
}
.ml-line {
  color: var(--tone-info-text);
  font-weight: 600;
}
.ml-note {
  grid-column: 2;
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.ml-empty {
  margin: 0;
  font-size: var(--fs-3);
  color: var(--text-muted);
}
.ml-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.ml-caption :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
</style>
