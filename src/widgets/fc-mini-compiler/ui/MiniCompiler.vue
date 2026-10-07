<script setup lang="ts">
/**
 * Учебный компилятор вживую: шаблон → сгенерированный код → живой DOM → журнал записей.
 *
 * Компилятор — строка `MINI_COMPILER_CODE` из `data.ts`, собранная `new Function` тем же
 * модулем (`model/lab.ts`), которым её гоняет тест. Ни компилятора, ни рантайма в этом файле нет:
 * здесь только поля и вывод.
 *
 * Лаборатория и скомпилированный компонент — обычные переменные, не реактивные: они держат
 * DOM-узлы, и реактивная обёртка вокруг них не нужна. Наружу светит только отчёт.
 * Сборка — в `onMounted`: в `setup` нет `document`, а остров сперва рендерится в Node.
 */
import { computed, onMounted, reactive, ref, shallowRef } from 'vue';
import CodeInput from '@/shared/ui/CodeInput.vue';
import CodeListing from '@/shared/ui/CodeListing.vue';
import ConsoleView from '@/shared/ui/ConsoleView.vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button, SegmentedControl } from '@/shared/ui';
import { CompilerLab, loadMiniCompiler, parseValue } from '../model/lab';
import type { MiniCompiler, MiniPreset } from '../model/types';

const props = defineProps<{ code: string; presets: MiniPreset[]; note: string }>();

let api: MiniCompiler | null = null;
let lab: CompilerLab | null = null;

const pickedId = ref(props.presets[0]?.id ?? '');
const source = ref(props.presets[0]?.source ?? '');
const preview = ref<HTMLElement | null>(null);
const generated = shallowRef<string[]>([]);
const names = shallowRef<string[]>([]);
const drafts = reactive<Record<string, string>>({});
const log = ref<string[]>([]);
const error = ref('');
const last = shallowRef<{ ops: number; rebuilt: number } | null>(null);

const options = computed(() => props.presets.map((p) => ({ value: p.id, label: p.label })));
const preset = computed(() => props.presets.find((p) => p.id === pickedId.value) ?? props.presets[0]);

function build() {
  const el = preview.value;
  if (!el) return;
  el.replaceChildren();
  last.value = null;
  try {
    api ??= loadMiniCompiler(props.code);
    const initial = { ...preset.value.state };
    for (const [name, raw] of Object.entries(drafts)) initial[name] = parseValue(raw);
    lab = new CompilerLab(api, source.value, document, el, initial);
    generated.value = lab.compiled.code.split('\n');
    names.value = lab.compiled.names;
    for (const key of Object.keys(drafts)) delete drafts[key];
    for (const [name, value] of Object.entries(lab.values)) drafts[name] = String(value);
    log.value = ['> монтирование: первое заполнение', ...lab.mountOps.map((op) => `  ${op}`)];
    error.value = '';
  } catch (e) {
    lab = null;
    generated.value = [];
    names.value = [];
    log.value = [];
    error.value = e instanceof Error ? e.message : String(e);
  }
}

function pick(id: string) {
  pickedId.value = id;
  source.value = preset.value.source;
  for (const key of Object.keys(drafts)) delete drafts[key];
  build();
}

function apply(name: string) {
  if (!lab) return;
  const value = parseValue(drafts[name] ?? '');
  const report = lab.set(name, value);
  last.value = { ops: report.ops.length, rebuilt: report.rebuilt };
  const lines = [`> ${name} = ${JSON.stringify(value)}`, ...(report.ops.length ? report.ops.map((op) => `  ${op}`) : ['  записей в DOM нет'])];
  log.value = [...log.value, ...lines].slice(-40);
}

const picked = computed({
  get: () => pickedId.value,
  set: (id: string) => pick(id),
});

onMounted(build);
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="fcm-toolbar">
        <SegmentedControl v-model="picked" class="l-pills" label="Пример шаблона" :options="options" />
        <Button variant="secondary" @click="build">собрать</Button>
      </div>
    </template>

    <div class="fcm-split">
      <div class="fcm-pane">
        <CodeInput v-model="source" label="шаблон" :rows="4" />
        <Md class="fcm-note" :text="note" />

        <div v-if="names.length" class="fcm-fields">
          <span class="t-label">значения · Enter или уход с поля — изменение</span>
          <label v-for="name in names" :key="name" class="fcm-field">
            <span class="fcm-name">{{ name }}</span>
            <input v-model="drafts[name]" class="fcm-input" spellcheck="false" @change="apply(name)" />
          </label>
        </div>

        <div v-if="error" class="fcm-error">{{ error }}</div>
      </div>

      <div class="fcm-pane">
        <CodeListing v-if="generated.length" :lines="generated" label="сгенерированный код · его и исполняет демо" />

        <span class="t-label">живой результат</span>
        <div ref="preview" class="fcm-preview" />

        <div v-if="last" class="fcm-chips">
          <span class="fcm-chip" data-tone="ok">записей в DOM: {{ last.ops }}</span>
          <span class="fcm-chip" data-tone="warn">интерпретатор пересоздал бы узлов: {{ last.rebuilt }}</span>
        </div>

        <ConsoleView :lines="log" label="журнал записей в DOM" empty-label="соберите шаблон" :min-height="120" />
      </div>
    </div>
  </DemoFrame>
</template>

<style scoped>
.fcm-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.fcm-split {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr));
  gap: 20px;
  padding: 20px;
}
.fcm-pane {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.fcm-note {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--prose);
}
.fcm-fields {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.fcm-field {
  display: grid;
  grid-template-columns: minmax(70px, auto) 1fr;
  align-items: center;
  gap: 10px;
}
.fcm-name {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
}
.fcm-input {
  /* У `input` шрифт и цвет свои, браузерные, — в курсе таких нет. */
  font: inherit;
  color: inherit;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  padding: 7px 10px;
  border: 1px solid var(--border-strong);
  border-radius: var(--r1);
  background: var(--surface);
  color: var(--ink);
  font-family: var(--mono);
  font-size: var(--fs-3);
}
.fcm-input:focus {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.fcm-error {
  padding: 10px 12px;
  border-radius: var(--r2);
  background: var(--tone-err-bg);
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--tone-err-text);
  overflow-wrap: anywhere;
}
.fcm-preview {
  min-height: 48px;
  padding: 4px 14px;
  border-radius: var(--r2);
  background: var(--surface-2);
  font-size: var(--fs-5);
  line-height: 1.5;
  color: var(--ink);
  overflow-wrap: anywhere;
}
.fcm-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.fcm-chip {
  padding: 3px 8px;
  border-radius: var(--r-full);
  font-family: var(--mono);
  font-size: var(--fs-3);
}
.fcm-chip[data-tone='ok'] {
  background: var(--tone-ok-chip);
  color: var(--tone-ok-text);
}
.fcm-chip[data-tone='warn'] {
  background: var(--tone-warn-chip);
  color: var(--tone-warn-text);
}
</style>
