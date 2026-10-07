<script setup lang="ts">
/**
 * «Разбор PNG»: байты настоящего файла, раскрашенные по полям, и значение выбранного поля.
 *
 * Разбор делает строка `PNG_CODE` из темы (`parsePng` и `crc32`), собранная `new Function`
 * (`model/run.ts`); раскладку по полям строит `pngFields` из ответа `parsePng` — без своего
 * чтения байтов. Та же строка напечатана на странице и сверена `tests/unit/binary-data.test.ts`
 * с `zlib.crc32` и размерами, которые вернул Chromium.
 */
import { computed, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { fallbackFields, loadPng, pngFields } from '../model/run';
import type { PngField, PngInfo, PngVariant } from '../model/types';

const props = defineProps<{
  pngCode: string;
  bytes: number[];
  variants: PngVariant[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const api = loadPng(props.pngCode);

const picked = ref(props.variants[0].id);
const options = props.variants.map((v) => ({ value: v.id, label: v.label }));
const variant = computed(() => props.variants.find((v) => v.id === picked.value) ?? props.variants[0]);

const file = computed(() => {
  const b = Uint8Array.from(props.bytes.slice(0, variant.value.cut ?? props.bytes.length));
  for (const [at, val] of variant.value.patch) b[at] = val;
  return b;
});

const parsed = computed<{ info: PngInfo | null; error: string }>(() => {
  try {
    return { info: api.parsePng(file.value), error: '' };
  } catch (e) {
    return { info: null, error: (e as Error).message };
  }
});

const fields = computed<PngField[]>(() =>
  parsed.value.info ? pngFields(parsed.value.info, file.value.length) : fallbackFields(file.value.length),
);

/** Номер поля для каждого байта. */
const fieldOf = computed(() => {
  const out = new Array<number>(file.value.length);
  fields.value.forEach((f, i) => out.fill(i, f.start, f.end));
  return out;
});

const ROW = 8;
const rows = computed(() => {
  const out: { at: number; cells: { i: number; hex: string }[] }[] = [];
  for (let at = 0; at < file.value.length; at += ROW) {
    out.push({
      at,
      cells: Array.from(file.value.subarray(at, at + ROW), (b, j) => ({ i: at + j, hex: b.toString(16).padStart(2, '0') })),
    });
  }
  return out;
});

/** Выбрано поле ширины: самое интересное место файла. */
const selected = ref(0);
function defaultField() {
  const i = fields.value.findIndex((f) => f.name === 'ширина');
  return i >= 0 ? i : 0;
}
selected.value = defaultField();
watch(fields, () => {
  selected.value = defaultField();
});

const field = computed(() => fields.value[selected.value] ?? fields.value[0]);
const fieldBytes = computed(() =>
  Array.from(file.value.subarray(field.value.start, field.value.end), (b) => b.toString(16).padStart(2, '0')).join(' '),
);
const fieldRange = computed(() =>
  field.value.end - field.value.start === 1 ? `байт ${field.value.start}` : `байты ${field.value.start}–${field.value.end - 1}`,
);
const shownBytes = computed(() => (fieldBytes.value.length > 60 ? `${fieldBytes.value.slice(0, 60)} …` : fieldBytes.value));

const summary = computed(() => {
  const { info, error } = parsed.value;
  if (!info) return `\`parsePng\` бросил ошибку: «${error}». Картинки нет.`;
  const bad = info.chunks.filter((c) => !c.crcOk).map((c) => `\`${c.type}\``);
  const blocks = info.chunks.map((c) => `\`${c.type}\``).join(', ');
  const crc = bad.length ? `CRC не сходится у ${bad.join(', ')}` : 'CRC сходится у всех';
  return `Разбор: ${info.width} × ${info.height}, ${file.value.length} байт, блоки ${blocks}. ${crc}.`;
});

function badCrc(i: number) {
  const f = fields.value[fieldOf.value[i]];
  return f?.kind === 'crc' && f.value.includes('не сходится');
}

function pick(i: number) {
  selected.value = fieldOf.value[i];
}
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="picked" class="l-pills" label="Файл" :options="options" />
    </template>

    <div class="pl-body">
      <Md class="pl-note" :text="variant.note" />

      <div class="pl-split">
        <div class="pl-dump" role="table" aria-label="Байты файла по полям">
          <div v-for="r in rows" :key="r.at" class="pl-row" role="row">
            <span class="pl-at" role="rowheader">{{ String(r.at).padStart(3, ' ') }}</span>
            <span
              v-for="c in r.cells"
              :key="c.i"
              class="pl-byte"
              role="cell"
              :data-kind="fields[fieldOf[c.i]]?.kind"
              :data-bad="badCrc(c.i) ? 'yes' : 'no'"
              :data-on="fieldOf[c.i] === selected ? 'yes' : 'no'"
              :tabindex="fields[fieldOf[c.i]]?.start === c.i ? 0 : -1"
              :aria-label="`Байт ${c.i}: ${fields[fieldOf[c.i]]?.name}`"
              @click="pick(c.i)"
              @keydown.enter.prevent="pick(c.i)"
              @keydown.space.prevent="pick(c.i)"
            >{{ c.hex }}</span>
          </div>
        </div>

        <div class="pl-side">
          <div class="pl-field">
            <span class="pl-label">{{ fieldRange }}</span>
            <span class="pl-field__name">{{ field.name }}</span>
            <code class="pl-field__bytes">{{ shownBytes }}</code>
            <Md class="pl-field__value" :text="field.value" />
          </div>

          <div class="pl-legend">
            <span class="pl-chip" data-kind="sig">сигнатура</span>
            <span class="pl-chip" data-kind="len">длина</span>
            <span class="pl-chip" data-kind="type">тип</span>
            <span class="pl-chip" data-kind="data">данные</span>
            <span class="pl-chip" data-kind="crc">CRC</span>
          </div>

          <Md class="pl-summary" :data-ok="parsed.info && parsed.info.chunks.every((c) => c.crcOk) ? 'yes' : 'no'" :text="summary" />
        </div>
      </div>

      <Md class="pl-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.pl-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.pl-note,
.pl-caption,
.pl-summary,
.pl-field__value {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.pl-note :deep(code),
.pl-caption :deep(code),
.pl-summary :deep(code),
.pl-field__value :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}

.pl-split {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 640px) {
  .pl-split {
    grid-template-columns: minmax(0, 1fr);
  }
}

.pl-dump {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
  overflow-x: auto;
}
.pl-row {
  display: flex;
  gap: 3px;
  align-items: center;
}
.pl-at {
  min-width: 3.2em;
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
  white-space: pre;
}
.pl-byte {
  padding: 2px 4px;
  border-radius: 3px;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
  cursor: pointer;
}
.pl-byte[data-kind='sig'],
.pl-chip[data-kind='sig'] {
  background: var(--tone-info-chip);
  color: var(--tone-info-text);
}
.pl-byte[data-kind='len'],
.pl-chip[data-kind='len'] {
  background: var(--tone-warn-chip);
  color: var(--tone-warn-text);
}
.pl-byte[data-kind='type'],
.pl-chip[data-kind='type'] {
  background: var(--tone-ok-chip);
  color: var(--tone-ok-text);
}
.pl-byte[data-kind='data'],
.pl-chip[data-kind='data'] {
  background: var(--surface);
  color: var(--ink);
}
.pl-byte[data-kind='crc'],
.pl-chip[data-kind='crc'] {
  background: var(--surface-3);
  color: var(--ink);
}
.pl-byte[data-bad='yes'] {
  background: var(--tone-err-chip);
  color: var(--tone-err-text);
}
.pl-byte[data-on='yes'] {
  box-shadow: inset 0 0 0 1px var(--ink);
  font-weight: 600;
}
.pl-byte:focus-visible {
  outline: 2px solid var(--ink);
  outline-offset: 1px;
}

.pl-side {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}
.pl-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.pl-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.pl-field__name {
  font-size: var(--fs-4);
  font-weight: 600;
  color: var(--ink);
}
.pl-field__bytes {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
  overflow-wrap: anywhere;
}

.pl-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.pl-chip {
  padding: 2px 8px;
  box-shadow: inset 0 0 0 1px var(--hairline);
  border-radius: var(--r1);
  font-family: var(--mono);
  font-size: var(--fs-2);
}

.pl-summary {
  padding: 10px 12px;
  border-radius: var(--r2);
  background: var(--tone-ok-bg);
}
.pl-summary[data-ok='no'] {
  background: var(--tone-err-bg);
}
@media (max-width: 480px) {
  .pl-body {
    padding: 14px 12px;
  }
  .pl-dump {
    padding: 8px;
    gap: 2px;
  }
  .pl-row {
    gap: 2px;
  }
  .pl-at {
    min-width: 2.4em;
  }
  .pl-byte {
    padding: 2px 3px;
  }
}
</style>
