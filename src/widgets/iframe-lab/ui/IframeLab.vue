<script setup lang="ts">
/**
 * «Песочница в вашем браузере»: настоящий `<iframe srcdoc>` с выбранными флагами `sandbox`.
 *
 * Решает не компонент, а браузер читателя. Документ пробы (`model/probe.ts`) пробует изнутри
 * пять вещей и присылает ответ через `postMessage`; шестую — виден ли документ снаружи —
 * родитель снимает сам по `iframe.contentDocument`. Молчание фрейма — тоже ответ: значит,
 * скрипты в нём запрещены. Тот же документ и тот же разбор (`cellsOf`) гоняет
 * `tests/unit/iframe.test.ts` в трёх движках и сверяет с таблицей темы.
 *
 * Фрейм собирается только по нажатию: до первого клика считать нечего. Элемент создаётся
 * руками, а не шаблоном, потому что порядок важен: атрибут `sandbox` обязан стоять до
 * `srcdoc` — флаги читаются в момент, когда фрейм начинает загрузку.
 */
import { computed, onBeforeUnmount, ref } from 'vue';
import CodeView from '@/shared/ui/CodeView.vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button, LESSON_VARS } from '@/shared/ui';
import {
  LAB_FLAGS,
  PROBE_COLUMNS,
  buildProbeDoc,
  cellsOf,
  iframeTag,
  isAllowed,
  readReport,
  sandboxValue,
  type LabFlag,
  type LabSetup,
  type ProbeReport,
} from '../model/probe';

defineProps<{
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const sandboxOn = ref(true);
const flags = ref<LabFlag[]>(['allow-scripts']);
const setup = computed<LabSetup>(() => ({ sandbox: sandboxOn.value, flags: flags.value }));
const tag = computed(() => iframeTag(setup.value));

const status = ref<'idle' | 'running' | 'done'>('idle');
const cells = ref<string[]>([]);
const slot = ref<HTMLDivElement | null>(null);

let frame: HTMLIFrameElement | null = null;
let report: ProbeReport | null = null;
let timer = 0;
let listening = false;

function onMessage(event: MessageEvent) {
  if (!frame || event.source !== frame.contentWindow) return;
  const r = readReport(event.data);
  if (r) report = r;
}

function finish(target: HTMLIFrameElement) {
  if (target !== frame) return;
  cells.value = cellsOf({ report, outside: target.contentDocument ? 'document' : 'null' });
  status.value = 'done';
}

function run() {
  if (!slot.value) return;
  if (!listening) {
    window.addEventListener('message', onMessage);
    listening = true;
  }
  window.clearTimeout(timer);
  frame?.remove();
  report = null;
  status.value = 'running';

  const f = document.createElement('iframe');
  const value = sandboxValue(setup.value);
  if (value !== null) f.setAttribute('sandbox', value);
  f.title = 'Документ-проба в песочнице';
  f.className = 'if-frame';
  f.srcdoc = buildProbeDoc({
    bg: LESSON_VARS['--surface-2'],
    text: LESSON_VARS['--text-muted'],
    mono: LESSON_VARS['--mono'],
  });
  // Проба отвечает через 300 мс после загрузки; 800 мс — с запасом на медленную машину.
  f.addEventListener('load', () => {
    timer = window.setTimeout(() => finish(f), 800);
  });
  frame = f;
  slot.value.append(f);
}

function toggleSandbox() {
  sandboxOn.value = !sandboxOn.value;
  if (status.value !== 'idle') run();
}

function toggleFlag(flag: LabFlag) {
  flags.value = flags.value.includes(flag) ? flags.value.filter((f) => f !== flag) : [...flags.value, flag];
  if (status.value !== 'idle') run();
}

onBeforeUnmount(() => {
  if (listening) window.removeEventListener('message', onMessage);
  window.clearTimeout(timer);
  frame?.remove();
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="if-bar">
        <fieldset class="if-flags">
          <legend class="if-legend">атрибут фрейма</legend>
          <label class="if-check">
            <input type="checkbox" :checked="sandboxOn" @change="toggleSandbox" />
            <code>sandbox</code>
          </label>
          <label v-for="flag in LAB_FLAGS" :key="flag" class="if-check" :data-off="!sandboxOn || undefined">
            <input type="checkbox" :checked="flags.includes(flag)" :disabled="!sandboxOn" @change="toggleFlag(flag)" />
            <code>{{ flag }}</code>
          </label>
        </fieldset>
        <Button variant="primary" @click="run">{{ status === 'idle' ? 'Собрать фрейм' : 'Собрать заново' }}</Button>
      </div>
    </template>

    <div class="if-body">
      <CodeView class="if-code" lang="html" :code="tag" />

      <div ref="slot" class="if-slot">
        <p v-if="status === 'idle'" class="if-empty">
          Фрейма пока нет. Выберите флаги и нажмите «Собрать фрейм» — его соберёт ваш браузер.
        </p>
      </div>

      <div class="if-results" aria-live="polite">
        <div v-for="(col, i) in PROBE_COLUMNS" :key="col" class="if-row" :data-state="status !== 'done' ? 'wait' : isAllowed(cells[i]) ? 'can' : 'cannot'">
          <span class="if-name">{{ col }}</span>
          <span class="if-value">{{ status === 'done' ? cells[i] : status === 'running' ? 'идёт проба…' : '—' }}</span>
        </div>
      </div>
    </div>

    <template #footer>
      <Md class="if-caption" :text="caption" />
    </template>
  </DemoFrame>
</template>

<style scoped>
.if-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}

.if-flags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  margin: 0;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  min-width: 0;
}
.if-legend {
  padding: 0 4px;
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.if-check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-3);
  color: var(--prose);
  cursor: pointer;
}
.if-check[data-off] {
  color: var(--text-faint);
  cursor: default;
}
.if-check input {
  font: inherit;
  color: inherit;
  margin: 0;
}
.if-check code {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: inherit;
  background: transparent;
}

.if-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
  min-width: 0;
}

.if-code {
  margin: 0;
  font-size: var(--fs-2);
  line-height: 1.7;
  overflow-x: auto;
}

.if-slot {
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  overflow: hidden;
  background: var(--surface-2);
}
.if-slot :deep(.if-frame) {
  display: block;
  width: 100%;
  height: 64px;
  border: 0;
}
.if-empty {
  margin: 0;
  padding: 14px 16px;
  font-size: var(--fs-4);
  line-height: 1.5;
  color: var(--text-muted);
}

.if-results {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr));
  gap: 8px;
}
.if-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border-radius: var(--r2);
  border: 1px solid var(--border);
  background: var(--surface-2);
  min-width: 0;
}
.if-row[data-state='can'] {
  border-color: var(--tone-warn-line);
  background: var(--tone-warn-bg);
}
.if-row[data-state='cannot'] {
  border-color: var(--tone-ok-line);
  background: var(--tone-ok-bg);
}
.if-name {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.if-value {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
  overflow-wrap: anywhere;
}
.if-row[data-state='can'] .if-value {
  color: var(--tone-warn-strong);
}
.if-row[data-state='cannot'] .if-value {
  color: var(--tone-ok-strong);
}

.if-caption {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}
</style>
