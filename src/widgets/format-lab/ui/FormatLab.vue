<script setup lang="ts">
/**
 * «Ширина и группы»: Doc настоящего кода, ползунок `printWidth`, решение по каждой группе
 * и напечатанный текст под линейкой.
 *
 * Раскладку считает не компонент, а строка `PRINTER_CODE` из темы, собранная `new Function`
 * (`model/run.ts`). Та же строка напечатана на странице и сверяется
 * `tests/unit/formatter.test.ts` с `printDocToString` из `prettier/doc`. Doc примеров сняты
 * с Prettier 3.9.6 (`printToDoc`) и тем же тестом пересобираются.
 */
import { computed, ref, toRaw, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { loadPrinter, outline, ruler } from '../model/run';
import type { FormatSnippet } from '../model/types';

const props = defineProps<{
  printerCode: string;
  snippets: FormatSnippet[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const printDoc = loadPrinter(props.printerCode);

const picked = ref(props.snippets[0].id);
const options = props.snippets.map((s) => ({ value: s.id, label: s.label }));
const snippet = computed(() => toRaw(props.snippets.find((s) => s.id === picked.value) ?? props.snippets[0]));

const MIN = 10;
const MAX = 100;
const width = ref(props.snippets[0].start);
watch(snippet, (s) => {
  width.value = s.start;
});

const result = computed(() => printDoc(snippet.value.doc, width.value));
const rows = computed(() => outline(snippet.value.doc, result.value.decisions));
const lines = computed(() =>
  result.value.text
    .replace(/\n$/, '')
    .split('\n')
    .map((l) => ({ fit: l.slice(0, width.value), over: l.slice(width.value) })),
);
const rule = computed(() => ruler(width.value));

const stats = computed(() => {
  const groups = rows.value.filter((r) => r.mode);
  const broken = groups.filter((r) => r.mode === 'break').length;
  const longest = Math.max(...lines.value.map((l) => l.fit.length + l.over.length));
  return `групп в дереве: ${groups.length}, сломано: ${broken} · строк: ${lines.value.length} · самая длинная: ${longest} из ${width.value}`;
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="fl-toolbar">
        <SegmentedControl v-model="picked" class="l-pills" label="Пример" :options="options" />
        <label class="fl-range">
          <span class="fl-label fl-label--case">printWidth = {{ width }}</span>
          <input
            v-model.number="width"
            type="range"
            :min="MIN"
            :max="MAX"
            step="1"
            :aria-valuetext="`printWidth ${width}`"
          />
        </label>
      </div>
    </template>

    <div class="fl-body">
      <Md class="fl-note" :text="snippet.note" />

      <div class="fl-pane">
        <span class="fl-label">исходник</span>
        <pre class="fl-code fl-code--src">{{ snippet.code }}</pre>
      </div>

      <div class="fl-split">
        <div class="fl-pane">
          <span class="fl-label">дерево Doc и решения</span>
          <div class="fl-tree" role="list" aria-label="Дерево Doc">
            <div
              v-for="(r, i) in rows"
              :key="i"
              class="fl-row"
              role="listitem"
              :data-kind="r.mode ? 'group' : r.kind === 'text' ? 'text' : 'wrap'"
              :data-mode="r.mode ?? 'none'"
              :style="{ paddingLeft: `${r.depth * 14 + 8}px` }"
            >
              <template v-if="r.kind === 'text'">{{ r.text }}</template>
              <template v-else>
                <span class="fl-kind">{{ r.kind }}</span>
                <span v-if="r.text" class="fl-extra">{{ r.text }}</span>
                <span v-if="r.mode" class="fl-mode">{{ r.mode === 'break' ? 'ломается' : 'в строку' }}</span>
              </template>
            </div>
          </div>
        </div>

        <div class="fl-pane">
          <span class="fl-label">вывод</span>
          <div class="fl-out">
            <pre class="fl-code fl-code--out"><span class="fl-ruler" aria-hidden="true">{{ rule }}</span>{{ '\n' }}<template v-for="(l, i) in lines" :key="i">{{ l.fit }}<mark v-if="l.over" class="fl-over">{{ l.over }}</mark>{{ '\n' }}</template></pre>
          </div>
          <span class="fl-stats">{{ stats }}</span>
        </div>
      </div>

      <Md class="fl-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.fl-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 20px;
  align-items: center;
}
.fl-range {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
  align-items: center;
  min-width: 0;
}
.fl-range input {
  font: inherit;
  color: inherit;
  width: min(260px, 100%);
  accent-color: var(--ink);
}

.fl-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.fl-note,
.fl-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.fl-note :deep(code),
.fl-caption :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}

.fl-split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 860px) {
  .fl-split {
    grid-template-columns: minmax(0, 1fr);
  }
}

.fl-pane {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.fl-label,
.fl-stats {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  color: var(--text-muted);
}
.fl-label {
  text-transform: uppercase;
}
.fl-label--case {
  text-transform: none;
}

.fl-code {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.6;
  /* Подложка — общая для кода курса (`pre` в base.css, чернильная): цвета ниже — «на чернилах». */
  color: var(--code-fg);
  white-space: pre;
  overflow-x: auto;
}
.fl-out {
  min-width: 0;
}
.fl-ruler {
  color: var(--ink-faint);
}
.fl-over {
  border-radius: 2px;
  background: var(--warn-wash-on-ink);
  color: var(--tone-warn-on-ink);
}

.fl-tree {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 460px;
  overflow: auto;
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.5;
  color: var(--prose);
}
.fl-row {
  padding: 2px 8px;
  border-radius: var(--r1);
  white-space: nowrap;
}
.fl-row[data-kind='text'] {
  color: var(--text-muted);
}
.fl-row[data-kind='wrap'] .fl-kind {
  color: var(--ink);
}
.fl-row[data-mode='break'] {
  background: var(--tone-warn-bg);
  box-shadow: inset 2px 0 0 var(--tone-warn-line);
}
.fl-row[data-mode='flat'] {
  background: var(--tone-ok-bg);
  box-shadow: inset 2px 0 0 var(--tone-ok-line);
}
.fl-kind {
  font-weight: 600;
  color: var(--ink);
}
.fl-extra {
  margin-left: 8px;
  color: var(--text-muted);
}
.fl-mode {
  margin-left: 8px;
}
.fl-row[data-mode='break'] .fl-mode {
  color: var(--tone-warn-text);
}
.fl-row[data-mode='flat'] .fl-mode {
  color: var(--tone-ok-text);
}
</style>
