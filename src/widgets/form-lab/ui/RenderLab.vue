<script setup lang="ts">
/**
 * «Цена одного символа»: форма из темы в шести устройствах состояния. Каждый символ в поле
 * спрашивает `whoRenders` из строки `RENDER_CODE` (собрана `new Function` в `model/run.ts`),
 * кто перерисуется, и прибавляет счётчики. Дерево компонентов строит `buildTree` той же
 * строки по описанию варианта из `RENDER_SETUPS`.
 *
 * React и Vue на страницу не едут: тест `tests/unit/forms.test.ts` монтирует код каждого
 * варианта в настоящих React 19.3 и Vue 3.5 и сверяет их счётчики с этой моделью.
 */
import { computed, reactive, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { loadRender } from '../model/run';
import type { RenderSetup, TreeNode } from '../model/types';

const props = defineProps<{
  renderCode: string;
  setups: RenderSetup[];
  /** Ключи сквозной формы: `name`, `phone`, `email`, `comment`. */
  fields: string[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const api = loadRender(props.renderCode);

const FW_LABEL = { react: 'React', vue: 'Vue' } as const;
const picked = ref(props.setups[0].id);
const options = props.setups.map((s) => ({ value: s.id, label: `${FW_LABEL[s.framework]}: ${s.label}` }));
const setup = computed(() => props.setups.find((s) => s.id === picked.value) ?? props.setups[0]);

const size = ref('4');
const SIZES = [
  { value: '4', label: '4 поля' },
  { value: '20', label: '20 полей' },
];
const fieldList = computed(() =>
  size.value === '4' ? props.fields : [...props.fields, ...Array.from({ length: 16 }, (_, i) => `f${i + 5}`)],
);
const tree = computed(() => api.buildTree(setup.value, fieldList.value));
const names = computed(() => {
  const out: string[] = [];
  const walk = (n: TreeNode) => {
    out.push(n.name);
    for (const c of n.children) walk(c);
  };
  walk(tree.value);
  return out;
});

const counts = reactive(new Map<string, number>());
const last = ref<string[]>([]);
const typed = ref(0);
const values = reactive<Record<string, string>>({});

function reset() {
  counts.clear();
  last.value = [];
  typed.value = 0;
  for (const k of Object.keys(values)) delete values[k];
}
watch([picked, size], reset);

function onInput(key: string, e: Event) {
  values[key] = (e.target as HTMLInputElement).value;
  const rendered = api.whoRenders(setup.value.framework, tree.value, key);
  for (const n of rendered) counts.set(n, (counts.get(n) ?? 0) + 1);
  last.value = rendered;
  typed.value++;
}

const total = computed(() => [...counts.values()].reduce((a, b) => a + b, 0));
const summary = computed(() =>
  typed.value === 0
    ? 'Напечатайте символ в любое поле.'
    : `Последний символ перерисовал **${last.value.length}** из ${names.value.length} компонентов. Всего рендеров: **${total.value}** за ${typed.value} ${plural(typed.value)}.`,
);
function plural(n: number) {
  const d = n % 10;
  const h = n % 100;
  if (d === 1 && h !== 11) return 'символ';
  if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return 'символа';
  return 'символов';
}
const hit = (name: string) => last.value.includes(name);
const previewText = computed(() => values.name || '…');
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="rl-tools">
        <SegmentedControl v-model="picked" class="l-pills" label="Где состояние" :options="options" />
        <SegmentedControl v-model="size" class="l-pills" label="Размер формы" :options="SIZES" />
      </div>
    </template>

    <div class="rl-body">
      <div class="rl-note"><Md :text="setup.note" /></div>

      <div class="rl-form" :data-hit="hit('Form') ? 'yes' : 'no'">
        <div class="rl-head">
          <code>Form</code>
          <span class="rl-count">{{ counts.get('Form') ?? 0 }}</span>
        </div>
        <div class="rl-fields">
          <label
            v-for="key in fieldList"
            :key="`${picked}-${size}-${key}`"
            class="rl-field"
            :data-hit="hit('Field ' + key) ? 'yes' : 'no'"
          >
            <span class="rl-head">
              <code>Field {{ key }}</code>
              <span class="rl-count">{{ counts.get('Field ' + key) ?? 0 }}</span>
            </span>
            <input class="rl-input" :name="key" type="text" autocomplete="off" @input="onInput(key, $event)" />
          </label>
        </div>
        <div v-if="setup.preview" class="rl-field rl-preview" :data-hit="hit('Preview') ? 'yes' : 'no'">
          <span class="rl-head">
            <code>Preview</code>
            <span class="rl-count">{{ counts.get('Preview') ?? 0 }}</span>
          </span>
          <span class="rl-preview__text">Заказ на имя {{ previewText }}</span>
        </div>
      </div>

      <div class="rl-summary"><Md :text="summary" /></div>

      <div class="rl-code">
        <span class="rl-label">код варианта</span>
        <pre class="rl-pre">{{ setup.code }}</pre>
      </div>

      <div class="rl-caption"><Md :text="caption" /></div>
    </div>
  </DemoFrame>
</template>

<style scoped>
.rl-tools {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.rl-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.rl-note,
.rl-caption,
.rl-summary {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.rl-note :deep(code),
.rl-caption :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}

.rl-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
  box-shadow: inset 0 0 0 1px var(--hairline);
  transition: background 0.15s;
}
.rl-fields {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 8px;
}
.rl-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  padding: 8px 10px;
  border-radius: var(--r2);
  background: var(--surface);
  box-shadow: inset 0 0 0 1px var(--hairline);
  transition: background 0.15s;
}
.rl-form[data-hit='yes'],
.rl-field[data-hit='yes'] {
  background: var(--tone-warn-bg);
  box-shadow: inset 0 0 0 1px var(--tone-warn-line);
}
.rl-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
}
.rl-head code {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--ink);
  overflow-wrap: anywhere;
}
.rl-count {
  font-family: var(--mono);
  font-size: var(--fs-3);
  font-weight: 600;
  color: var(--tone-warn-text);
}
.rl-input {
  font: inherit;
  color: inherit;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  padding: 5px 8px;
  border: 1px solid var(--border-strong);
  border-radius: var(--r1);
  background: var(--surface);
  font-size: var(--fs-3);
}
.rl-preview__text {
  font-size: var(--fs-3);
  color: var(--prose);
}

.rl-code {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.rl-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.rl-pre {
  margin: 0;
  max-height: 26em;
  overflow: auto;
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.65;
  color: var(--code-fg);
}
</style>
