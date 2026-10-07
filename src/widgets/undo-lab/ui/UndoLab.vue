<script setup lang="ts">
/**
 * «История изнутри»: настоящее поле `<textarea>`, которое правит не браузер, а `createEditor`
 * из темы, и обе стопки рядом с ним. Режим переключает, что лежит в записи: правки с пересчётом,
 * правки без пересчёта или снимки. Кнопки Бориса — чужие правки, пришедшие «по сети».
 *
 * Считают строки `OPS_CODE`, `XFORM_CODE` и `HISTORY_CODE` из темы, собранные `new Function`
 * (`model/run.ts`); `tests/unit/undo-redo.test.ts` сверяет их с `Y.UndoManager` и с историей
 * `<textarea>` в Chromium. Поле подключено так же, как в `INTERCEPT_CODE`: `beforeinput`
 * отменяется, Ctrl+Z ловится в `keydown`. Компонент только склеивает правки записи в подпись.
 */
import { computed, onMounted, ref, shallowRef } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button, SegmentedControl } from '@/shared/ui';
import { loadEditor, play, runs } from '../model/run';
import type { DemoStep, Editor, Entry, Mode } from '../model/types';

const props = defineProps<{
  opsCode: string;
  xformCode: string;
  historyCode: string;
  /** Что набрано при открытии — на виртуальном времени в прошлом. */
  start: DemoStep[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const createEditor = loadEditor(props.opsCode, props.xformCode, props.historyCode);
const TIMEOUT = 500;

const mode = ref<Mode>('ops');
const modeOptions = [
  { value: 'ops', label: 'правки с пересчётом' },
  { value: 'naive', label: 'без пересчёта' },
  { value: 'snapshots', label: 'снимки' },
];

const ed = shallowRef<Editor>(createEditor());
/** Редактор — обычный объект; счётчик заставляет пересчитать подписи после каждого шага. */
const tick = ref(0);
const field = ref<HTMLTextAreaElement | null>(null);

function sync() {
  tick.value++;
  const f = field.value;
  if (!f) return;
  f.value = ed.value.text;
  f.setSelectionRange(ed.value.sel[0], ed.value.sel[1]);
}

function reset() {
  const e = createEditor({ mode: mode.value, timeout: TIMEOUT });
  // Стартовый набор — далеко в прошлом, чтобы первая же правка открыла новую запись.
  play(e, props.start, -1_000_000);
  e.stop();
  ed.value = e;
  sync();
}

function setMode(m: string) {
  mode.value = m as Mode;
  reset();
}

/** Каретку двигал человек — сообщить истории, это закрывает запись. */
function takeSelection() {
  const f = field.value;
  if (!f) return;
  if (f.selectionStart !== ed.value.sel[0] || f.selectionEnd !== ed.value.sel[1]) ed.value.select(f.selectionStart, f.selectionEnd);
}

function onBeforeInput(e: InputEvent) {
  if (e.isComposing || e.inputType === 'insertCompositionText') return;
  e.preventDefault();
  takeSelection();
  const now = e.timeStamp;
  const h = ed.value;
  if (e.inputType === 'historyUndo') h.undo();
  else if (e.inputType === 'historyRedo') h.redo();
  else if (e.inputType === 'deleteContentBackward') h.backspace(now);
  else if (e.inputType === 'insertLineBreak') h.insert('\n', now);
  else if (e.data != null) h.insert(e.data, now);
  else if (e.dataTransfer) h.insert(e.dataTransfer.getData('text/plain'), now);
  else if (e.inputType.startsWith('delete') && h.sel[0] !== h.sel[1]) h.backspace(now);
  sync();
}

function onKeydown(e: KeyboardEvent) {
  const key = e.key.toLowerCase();
  const undo = (e.ctrlKey || e.metaKey) && key === 'z';
  const redoY = e.ctrlKey && !e.metaKey && key === 'y';
  if (!undo && !redoY) return;
  e.preventDefault();
  if (redoY || e.shiftKey) ed.value.redo();
  else ed.value.undo();
  sync();
}

/** IME: шаг набора отменить нельзя — слово берётся целиком, когда набор закончен. */
let composeFrom: [number, number] = [0, 0];
function onCompositionStart() {
  takeSelection();
  composeFrom = [ed.value.sel[0], ed.value.sel[1]];
}
function onCompositionEnd(e: CompositionEvent) {
  ed.value.select(composeFrom[0], composeFrom[1]);
  if (e.data) ed.value.insert(e.data, e.timeStamp);
  sync();
}

function undo() {
  ed.value.undo();
  sync();
}
function redo() {
  ed.value.redo();
  sync();
}
function closeEntry() {
  ed.value.stop();
  sync();
}

const BOB = 'Борис: ';
function bobInserts() {
  [...BOB].forEach((ch, i) => ed.value.remote({ type: 'ins', pos: i, ch }));
  sync();
}
function bobDeletes() {
  const text = ed.value.text;
  const n = Math.min(3, text.length);
  for (let i = 0; i < n; i++) ed.value.remote({ type: 'del', pos: 0, ch: ed.value.text[0] });
  sync();
}

const show = (s: string) => `«${s.replaceAll('\n', '⏎')}»`;
const range = (sel: [number, number]) => (sel[0] === sel[1] ? `каретка ${sel[0]}` : `выделение ${sel[0]}–${sel[1]}`);

interface Card {
  key: string;
  lines: string[];
  eaten: number;
  sel: string;
}

function describe(entry: Entry, i: number): Card {
  if (entry.text !== null) {
    return { key: `s${i}`, lines: [`снимок ${show(entry.text)}, ${entry.text.length} симв.`], eaten: 0, sel: range(entry.sel) };
  }
  const r = runs(entry);
  return {
    key: `o${i}`,
    lines: r.runs.map((x) => (x.type === 'ins' ? `вставить ${show(x.text)} на ${x.pos}` : `удалить ${show(x.text)} с ${x.pos}`)),
    eaten: r.eaten,
    sel: range(entry.sel),
  };
}

const view = computed(() => {
  void tick.value;
  const h = ed.value;
  const undoCards = h.undoStack.map(describe).reverse();
  const redoCards = h.redoStack.map(describe).reverse();
  const all = [...h.undoStack, ...h.redoStack];
  const stored =
    mode.value === 'snapshots'
      ? `в стопках ${all.reduce((s, e) => s + (e.text?.length ?? 0), 0)} символов снимков`
      : `в стопках ${all.reduce((s, e) => s + e.ops.filter(Boolean).length, 0)} правок по символу`;
  return { undoCards, redoCards, stored, open: h.open && h.undoStack.length > 0, text: h.text };
});

onMounted(reset);
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl :model-value="mode" class="l-pills" label="Что в записи" :options="modeOptions" @update:model-value="setMode" />
    </template>

    <div class="ul-body">
      <label class="ul-label" for="ul-field">поле: Аня</label>
      <textarea
        id="ul-field"
        ref="field"
        class="ul-input"
        rows="3"
        spellcheck="false"
        autocomplete="off"
        @beforeinput="onBeforeInput"
        @keydown="onKeydown"
        @compositionstart="onCompositionStart"
        @compositionend="onCompositionEnd"
      />

      <div class="ul-buttons" role="group" aria-label="Действия">
        <Button variant="secondary" :disabled="!view.undoCards.length" @click="undo">Ctrl+Z</Button>
        <Button variant="secondary" :disabled="!view.redoCards.length" @click="redo">Ctrl+Shift+Z</Button>
        <Button variant="secondary" @click="closeEntry">закрыть запись</Button>
        <Button variant="secondary" @click="bobInserts">Борис: вставить «{{ BOB.trim() }}» в начало</Button>
        <Button variant="secondary" :disabled="!view.text.length" @click="bobDeletes">Борис: стереть 3 первых символа</Button>
        <Button variant="secondary" @click="reset">сначала</Button>
      </div>

      <div class="ul-stacks">
        <div class="ul-stack">
          <span class="ul-label">undo — что сделает Ctrl+Z</span>
          <ol class="ul-list">
            <li v-for="(c, i) in view.undoCards" :key="c.key" class="ul-entry" :data-top="i === 0 ? 'yes' : 'no'">
              <span v-for="(l, k) in c.lines" :key="k" class="ul-mono">{{ l }}</span>
              <span v-if="c.eaten" class="ul-eaten">съедено чужими удалениями: {{ c.eaten }}</span>
              <span class="ul-sel">потом {{ c.sel }}</span>
              <span v-if="i === 0 && view.open" class="ul-open">открыта: следующая правка допишется сюда</span>
            </li>
          </ol>
          <span v-if="!view.undoCards.length" class="ul-empty">пусто</span>
        </div>
        <div class="ul-stack">
          <span class="ul-label">redo — что сделает Ctrl+Shift+Z</span>
          <ol class="ul-list">
            <li v-for="(c, i) in view.redoCards" :key="c.key" class="ul-entry" :data-top="i === 0 ? 'yes' : 'no'">
              <span v-for="(l, k) in c.lines" :key="k" class="ul-mono">{{ l }}</span>
              <span v-if="c.eaten" class="ul-eaten">съедено чужими удалениями: {{ c.eaten }}</span>
              <span class="ul-sel">потом {{ c.sel }}</span>
            </li>
          </ol>
          <span v-if="!view.redoCards.length" class="ul-empty">пусто</span>
        </div>
      </div>

      <span class="ul-stored">{{ view.stored }}</span>

      <Md class="ul-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.ul-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
  min-width: 0;
}
.ul-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.ul-input {
  font: inherit;
  color: inherit;
  font-family: var(--mono);
  font-size: var(--fs-4);
  line-height: 1.6;
  padding: 8px 10px;
  border: 1px solid var(--border-strong);
  border-radius: var(--r2);
  background: var(--surface);
  resize: vertical;
  min-width: 0;
}
.ul-input:focus-visible {
  outline: 2px solid var(--ink);
  outline-offset: 1px;
}
.ul-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.ul-stacks {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
  align-items: start;
}
@media (max-width: 640px) {
  .ul-stacks {
    grid-template-columns: minmax(0, 1fr);
  }
}
.ul-stack {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.ul-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ul-entry {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--surface);
  min-width: 0;
}
.ul-entry[data-top='yes'] {
  border-color: var(--tone-info-line);
  background: var(--tone-info-bg);
}
.ul-mono {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
  overflow-wrap: anywhere;
}
.ul-sel,
.ul-empty,
.ul-stored {
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.ul-stored {
  font-family: var(--mono);
}
.ul-eaten {
  font-size: var(--fs-2);
  color: var(--tone-warn-text);
}
.ul-open {
  font-size: var(--fs-2);
  color: var(--tone-info-text);
}
.ul-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.ul-caption :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
</style>
