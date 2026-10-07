<script setup lang="ts">
/**
 * «Где проходят границы графем»: строка, разложенная на кодовые точки, решение между каждой
 * парой соседних точек и ответ `Intl.Segmenter` браузера для сверки.
 *
 * Решения считает не компонент, а строка `GRAPHEME_CODE` из темы, собранная `new Function`
 * (`model/run.ts`). Та же строка напечатана на странице и сверяется
 * `tests/unit/unicode-intl.test.ts` с `Intl.Segmenter`. Компонент только подписывает точки:
 * номер, видимый значок для невидимых знаков, число кодовых единиц — это подписи, а не расчёт.
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { hex, loadGraphemes } from '../model/run';
import type { PointKind, StringSample } from '../model/types';

const props = defineProps<{
  graphemeCode: string;
  samples: StringSample[];
  /** Короткая расшифровка правил: `GB9` → `× Extend или ZWJ`. */
  ruleNotes: Record<string, string>;
  /** Подпись под демо. Строчная разметка. */
  caption: string;
  /** Образец, открытый первым. */
  start?: string;
}>();

const api = loadGraphemes(props.graphemeCode);
const MAX_INPUT = 64;

const first = props.samples.find((s) => s.id === props.start) ?? props.samples[0];
const picked = ref(first.id);
const text = ref(first.value);
const options = props.samples.map((s) => ({ value: s.id, label: s.label }));

function pick(id: string) {
  picked.value = id;
  const s = props.samples.find((x) => x.id === id);
  if (s) text.value = s.value;
}

const sample = computed(() => props.samples.find((s) => s.id === picked.value && s.value === text.value));

function onInput(e: Event) {
  text.value = (e.target as HTMLInputElement).value.slice(0, MAX_INPUT);
}

/** Видимый значок для точки: невидимые и «прилипающие» знаки подписываются, а не рисуются голыми. */
function glyph(c: string, k: PointKind): string {
  const cp = c.codePointAt(0) ?? 0;
  if (c === '\r') return '␍';
  if (c === '\n') return '␊';
  if (k === 'ZWJ') return 'ZWJ';
  if (cp === 0xfe0f) return 'VS16';
  if (cp === 0xfe0e) return 'VS15';
  if (cp >= 0xe0020 && cp <= 0xe007e) return String.fromCharCode(cp - 0xe0000);
  if (cp === 0xe007f) return 'конец';
  if (cp >= 0xd800 && cp <= 0xdfff) return '½';
  if (k === 'Extend' && /\p{M}/u.test(c)) return '◌' + c;
  if (k === 'Control') return '·';
  return c;
}

interface Cell {
  key: number;
  glyph: string;
  hex: string;
  kind: PointKind;
  units: number;
}
interface Group {
  key: number;
  cells: Cell[];
  /** Правила склейки внутри графемы: между `cells[j]` и `cells[j + 1]`. */
  joins: string[];
  /** Правило разрыва перед этой графемой; у первой — нет. */
  before?: string;
}

const parsed = computed(() => api.graphemeBreaks(text.value));

const groups = computed<Group[]>(() => {
  const { cps, steps } = parsed.value;
  const out: Group[] = [];
  cps.forEach((c, i) => {
    const kind = api.kind(c);
    const cell: Cell = { key: i, glyph: glyph(c, kind), hex: hex(c), kind, units: c.length };
    const step = i > 0 ? steps[i - 1] : undefined;
    if (!step || !step.join) out.push({ key: i, cells: [cell], joins: [], before: step?.rule });
    else {
      const g = out[out.length - 1];
      g.joins.push(step.rule);
      g.cells.push(cell);
    }
  });
  return out;
});

const ours = computed(() => api.splitGraphemes(text.value));
const native = computed(() => {
  const seg = new Intl.Segmenter('ru', { granularity: 'grapheme' });
  return [...seg.segment(text.value)].map((s) => s.segment);
});
const same = computed(() => ours.value.length === native.value.length && ours.value.every((g, i) => g === native.value[i]));

const counts = computed(() => [
  { k: 'length', v: text.value.length, d: 'кодовые единицы' },
  { k: '[...s].length', v: parsed.value.cps.length, d: 'кодовые точки' },
  { k: 'splitGraphemes', v: ours.value.length, d: 'графемы, учебная функция' },
  { k: 'Intl.Segmenter', v: native.value.length, d: 'графемы, ваш браузер' },
  { k: 'UTF-8', v: new TextEncoder().encode(text.value).length, d: 'байт' },
]);

const verdict = computed(() =>
  !text.value
    ? 'Строка пуста.'
    : same.value
      ? `Учебная функция и \`Intl.Segmenter\` вашего браузера разрезали строку одинаково: графем — **${native.value.length}**.`
      : `**Расхождение:** учебная функция насчитала ${ours.value.length}, \`Intl.Segmenter\` — ${native.value.length}. В строке есть знак из правил, которых нет в подмножестве: хангыль, SpacingMark, Prepend или индийская связка.`,
);

const nativeShown = computed(() => native.value.map((g, i) => ({ key: i, text: g.replace(/\r\n|\r|\n/g, '↵') })));
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl :model-value="picked" class="l-pills" label="Образец" :options="options" @update:model-value="pick(String($event))" />
    </template>

    <div class="gl-body">
      <div class="gl-inputs">
        <label class="gl-label" for="gl-input">строка</label>
        <input id="gl-input" class="gl-input" :value="text" :maxlength="MAX_INPUT" spellcheck="false" autocomplete="off" @input="onInput" />
      </div>

      <Md v-if="sample" class="gl-note" :text="sample.note" />

      <div class="gl-counts">
        <div v-for="c in counts" :key="c.k" class="gl-count">
          <span class="gl-count__k">{{ c.k }}</span>
          <span class="gl-count__v">{{ c.v }}</span>
          <span class="gl-count__d">{{ c.d }}</span>
        </div>
      </div>

      <div class="gl-strip-wrap">
        <span class="gl-label">кодовые точки и решения между ними</span>
        <div class="gl-strip" role="list" aria-label="Графемы и кодовые точки">
          <template v-for="g in groups" :key="g.key">
            <span v-if="g.before" class="gl-joint" data-join="no" :title="ruleNotes[g.before]">
              <span class="gl-joint__sym">÷</span>
              <span class="gl-joint__rule">{{ g.before }}</span>
            </span>
            <span class="gl-group" role="listitem">
              <template v-for="(c, j) in g.cells" :key="c.key">
                <span v-if="j > 0" class="gl-joint" data-join="yes" :title="ruleNotes[g.joins[j - 1]]">
                  <span class="gl-joint__sym">×</span>
                  <span class="gl-joint__rule">{{ g.joins[j - 1] }}</span>
                </span>
                <span class="gl-cell" :data-kind="c.kind">
                  <span class="gl-cell__ch">{{ c.glyph }}</span>
                  <span class="gl-cell__hex">{{ c.hex }}</span>
                  <span class="gl-cell__kind">{{ c.kind }}<template v-if="c.units === 2"> · 2 ед.</template></span>
                </span>
              </template>
            </span>
          </template>
        </div>
      </div>

      <div class="gl-rules">
        <span v-for="(d, r) in ruleNotes" :key="r" class="gl-rule"><code>{{ r }}</code> {{ d }}</span>
      </div>

      <div class="gl-native">
        <span class="gl-label">Intl.Segmenter</span>
        <div class="gl-native__row">
          <span v-for="g in nativeShown" :key="g.key" class="gl-chip">{{ g.text }}</span>
        </div>
        <Md class="gl-verdict" :data-same="same ? 'yes' : 'no'" :text="verdict" />
      </div>

      <Md class="gl-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.gl-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.gl-note,
.gl-caption,
.gl-verdict {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.gl-note :deep(code),
.gl-caption :deep(code),
.gl-verdict :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
.gl-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.gl-inputs {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 8px 12px;
  align-items: center;
}
.gl-input {
  font: inherit;
  color: inherit;
  font-family: var(--mono);
  min-width: 0;
  max-width: 24em;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--surface);
}

.gl-counts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 8px;
}
.gl-count {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border-radius: var(--r2);
  background: var(--surface-2);
  min-width: 0;
}
.gl-count__k {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
  overflow-wrap: anywhere;
}
.gl-count__v {
  font-family: var(--mono);
  font-size: var(--fs-6);
  font-weight: 600;
  color: var(--ink);
}
.gl-count__d {
  font-size: var(--fs-2);
  color: var(--text-muted);
}

.gl-strip-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.gl-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
  gap: 6px;
  min-width: 0;
}
.gl-group {
  display: inline-flex;
  align-items: stretch;
  gap: 2px;
  padding: 4px;
  border-radius: var(--r3);
  background: var(--tone-info-bg);
  box-shadow: inset 0 0 0 1px var(--tone-info-line);
  max-width: 100%;
  flex-wrap: wrap;
}
.gl-cell {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  min-width: 4.6em;
  padding: 5px 6px;
  border-radius: var(--r2);
  background: var(--surface);
}
.gl-cell__ch {
  font-size: var(--fs-6);
  line-height: 1.3;
  color: var(--ink);
  white-space: nowrap;
}
.gl-cell__hex {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--prose);
}
.gl-cell__kind {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
  white-space: nowrap;
}
.gl-cell[data-kind='Extend'] .gl-cell__kind,
.gl-cell[data-kind='ZWJ'] .gl-cell__kind,
.gl-cell[data-kind='RI'] .gl-cell__kind {
  color: var(--tone-info-text);
}

.gl-joint {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-width: 2.4em;
  padding: 0 2px;
  font-family: var(--mono);
}
.gl-joint__sym {
  font-size: var(--fs-5);
  line-height: 1.2;
}
.gl-joint__rule {
  font-size: var(--fs-2);
  white-space: nowrap;
}
.gl-joint[data-join='yes'] {
  color: var(--tone-ok-text);
}
.gl-joint[data-join='no'] {
  color: var(--tone-err-text);
}

.gl-rules {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.gl-rule code {
  font-family: var(--mono);
  color: var(--ink);
}

.gl-native {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.gl-native__row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.gl-chip {
  padding: 3px 9px;
  border-radius: var(--r2);
  background: var(--surface);
  box-shadow: inset 0 0 0 1px var(--border);
  font-size: var(--fs-5);
  color: var(--ink);
  white-space: pre;
}
.gl-verdict[data-same='no'] {
  color: var(--tone-warn-text);
}
</style>
