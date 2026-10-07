<script setup lang="ts">
/**
 * «Как смотреть на байты»: одни и те же байты под разными видами — тип элемента и порядок байт.
 *
 * Числа считает не компонент, а строка `READ_CODE` из темы (`readAs` через `DataView`), собранная
 * `new Function` (`model/run.ts`). Та же строка напечатана на странице и сверяется
 * `tests/unit/binary-data.test.ts` с настоящими типизированными массивами. Строка «как прочитает
 * типизированный массив» — ответ движка этого устройства: `new Int16Array(…)` и т. п.
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { loadRead } from '../model/run';
import type { LensPreset, LensType } from '../model/types';

const props = defineProps<{
  readCode: string;
  presets: LensPreset[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const api = loadRead(props.readCode);

const picked = ref(props.presets[0].id);
const presetOptions = props.presets.map((p) => ({ value: p.id, label: p.label }));
const preset = computed(() => props.presets.find((p) => p.id === picked.value) ?? props.presets[0]);

const TYPES: LensType[] = ['Uint8', 'Int16', 'Uint16', 'Uint32', 'Float32'];
const type = ref<LensType>('Uint32');
const typeOptions = TYPES.map((t) => ({ value: t, label: t }));

const order = ref<'le' | 'be'>('be');
const orderOptions = [
  { value: 'be', label: 'BE' },
  { value: 'le', label: 'LE' },
];

const MAX_INPUT = 16;
const text = ref('Привет');
const encoder = new TextEncoder();

const bytes = computed(() => (preset.value.bytes.length ? Uint8Array.from(preset.value.bytes) : encoder.encode(text.value)));
const size = computed(() => api.TYPES[type.value].size);
const values = computed(() => api.readAs(bytes.value, type.value, order.value === 'le'));

const hex = (b: number) => b.toString(16).padStart(2, '0');
const show = (v: number) => (Number.isInteger(v) ? v.toLocaleString('ru') : String(v));

/** Байты, разложенные по элементам; хвост, которому не хватило байт, — отдельно. */
const groups = computed(() =>
  values.value.map((v, i) => ({
    key: `${type.value}:${i}`,
    bytes: Array.from(bytes.value.subarray(i * size.value, (i + 1) * size.value), hex),
    value: show(v),
  })),
);
const tail = computed(() => Array.from(bytes.value.subarray(values.value.length * size.value), hex));

/** Что даст настоящий типизированный массив этого типа на этом устройстве. */
const native = computed(() => {
  if (size.value === 1) return 'У `Uint8` порядок ни на что не влияет: элемент — один байт.';
  const usable = bytes.value.slice(0, values.value.length * size.value);
  const Ctor = (globalThis as unknown as Record<string, new (b: ArrayBuffer) => ArrayLike<number>>)[`${type.value}Array`];
  const got = Array.from(new Ctor(usable.buffer));
  const le = api.readAs(usable, type.value, true);
  const sameLe = got.length === le.length && got.every((v, i) => Object.is(v, le[i]));
  const list = got.slice(0, 4).map(show).join(', ') + (got.length > 4 ? ', …' : '');
  const verdict = sameLe ? 'то же, что порядок **LE**' : 'то же, что порядок **BE**';
  return `\`new ${type.value}Array(buf)\` на этом устройстве: \`${list || 'пусто'}\` — ${verdict}.`;
});

function onInput(e: Event) {
  text.value = (e.target as HTMLInputElement).value.slice(0, MAX_INPUT);
}
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="picked" class="l-pills" label="Байты" :options="presetOptions" />
    </template>

    <div class="bl-body">
      <Md class="bl-note" :text="preset.note" />

      <div v-if="!preset.bytes.length" class="bl-inputs">
        <label class="bl-label" for="bl-text">строка</label>
        <input id="bl-text" class="bl-input" :value="text" :maxlength="MAX_INPUT" spellcheck="false" autocomplete="off" @input="onInput" />
      </div>

      <div class="bl-controls">
        <SegmentedControl v-model="type" class="l-pills" label="Тип элемента" :options="typeOptions" />
        <SegmentedControl v-model="order" class="l-pills" label="Порядок байт" :options="orderOptions" />
      </div>

      <div class="bl-grid" role="list" :aria-label="`Байты как ${type}`">
        <div v-for="g in groups" :key="g.key" class="bl-group" role="listitem">
          <span class="bl-bytes">
            <span v-for="(b, j) in g.bytes" :key="j" class="bl-byte">{{ b }}</span>
          </span>
          <span class="bl-value">{{ g.value }}</span>
        </div>
        <div v-if="tail.length" class="bl-group bl-group--tail" role="listitem">
          <span class="bl-bytes">
            <span v-for="(b, j) in tail" :key="j" class="bl-byte">{{ b }}</span>
          </span>
          <span class="bl-value">не хватило байт</span>
        </div>
        <span v-if="!groups.length && !tail.length" class="bl-empty">байтов нет</span>
      </div>

      <Md class="bl-native" :text="native" />

      <Md class="bl-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.bl-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.bl-note,
.bl-caption,
.bl-native {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.bl-note :deep(code),
.bl-caption :deep(code),
.bl-native :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}

.bl-inputs {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 8px 12px;
  align-items: center;
}
.bl-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.bl-input {
  font: inherit;
  color: inherit;
  font-family: var(--mono);
  min-width: 0;
  max-width: 20em;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--surface);
}
.bl-input:focus-visible {
  outline: 2px solid var(--ink);
  outline-offset: 1px;
}

.bl-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 20px;
  align-items: center;
}

.bl-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.bl-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 6px 8px;
  border-radius: var(--r2);
  background: var(--surface);
  box-shadow: var(--shadow-1);
}
.bl-group--tail {
  background: var(--surface-3);
  box-shadow: none;
}
.bl-bytes {
  display: flex;
  gap: 4px;
}
.bl-byte {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
}
.bl-group--tail .bl-byte {
  color: var(--text-muted);
}
.bl-value {
  max-width: 14em;
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--tone-info-text);
  overflow-wrap: anywhere;
}
.bl-group--tail .bl-value {
  color: var(--text-muted);
}
.bl-empty {
  font-size: var(--fs-3);
  color: var(--text-muted);
}

.bl-native {
  padding: 10px 12px;
  border-radius: var(--r2);
  background: var(--tone-info-bg);
}
</style>
