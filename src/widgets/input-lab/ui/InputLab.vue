<script setup lang="ts">
/**
 * «Поле и его журнал»: сценарий из шагов (клавиша, вставка, IME, запись `el.value`), отмена
 * `preventDefault()` в выбранных событиях — и журнал событий с `value` и выделением в момент
 * каждого из них.
 *
 * Журнал считает не компонент, а строка `SIM_CODE` из темы, собранная `new Function`
 * (`model/run.ts`). Пока пресет не тронут, рядом — совпал ли он с журналом Chromium стенда
 * (`STAND_RUNS`). Живое поле внизу пишет журнал строкой `WATCH_CODE` — тем же кодом, которым
 * тест `tests/unit/text-input.test.ts` снимает журналы в Chromium.
 */
import { computed, onMounted, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button, SegmentedControl } from '@/shared/ui';
import { loadSimulate, loadWatch, sameRun } from '../model/run';
import type { FieldEvent, FieldRun, InputAction, InputScenario } from '../model/types';

const props = defineProps<{
  simCode: string;
  watchCode: string;
  scenarios: InputScenario[];
  standRuns: Record<string, FieldRun>;
  /** Версия Chromium стенда — для подписи сверки. */
  chromium: string;
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const simulate = loadSimulate(props.simCode);
const watchField = loadWatch(props.watchCode);

const picked = ref(props.scenarios[0].id);
const options = props.scenarios.map((s) => ({ value: s.id, label: s.label }));
const scenario = computed(() => props.scenarios.find((s) => s.id === picked.value) ?? props.scenarios[0]);

const actions = ref<InputAction[]>([]);
const cancel = ref<string[]>([]);
const touched = ref(false);

function load() {
  actions.value = scenario.value.actions.map((a) => ({ ...a }));
  cancel.value = [...scenario.value.cancel];
  touched.value = false;
}
load();
watch(picked, load);

const run = computed(() => simulate(scenario.value.start, actions.value, cancel.value));
const stand = computed(() => props.standRuns[scenario.value.id]);
const matches = computed(() => !touched.value && !!stand.value && sameRun(run.value, stand.value));

/** Идёт ли набор IME после последнего шага и какой по счёту. */
const ime = computed(() => {
  let step = 0;
  for (const a of actions.value) {
    if (a.do === 'compose') step++;
    else if (a.do === 'commit') step = 0;
  }
  return step;
});
const composing = computed(() => ime.value > 0);
const IME_WORDS = ['k', 'か', 'かん'];
const nextWord = computed(() => IME_WORDS[Math.min(ime.value, IME_WORDS.length - 1)]);

const MAX_STEPS = 14;
function add(a: InputAction) {
  if (actions.value.length >= MAX_STEPS) return;
  actions.value = [...actions.value, a];
  touched.value = true;
}
function restart() {
  actions.value = [];
  touched.value = true;
}
const full = computed(() => actions.value.length >= MAX_STEPS);

const CANCELLABLE = ['keydown', 'keypress', 'beforeinput', 'paste'];
function toggle(type: string) {
  cancel.value = cancel.value.includes(type) ? cancel.value.filter((x) => x !== type) : [...cancel.value, type];
  touched.value = true;
}

function stepLabel(a: InputAction): string {
  if (a.do === 'key') return a.code === 'KeyA' && a.key !== 'a' ? `${a.key} (KeyA)` : a.key;
  if (a.do === 'paste') return `Ctrl+V «${a.text}»`;
  if (a.do === 'compose') return `IME: ${a.text}`;
  if (a.do === 'commit') return `IME → ${a.text}`;
  return `value = '${a.value}'`;
}

/** Поле после последнего шага: текст до выделения, выделенное, после. */
const field = computed(() => {
  const { value, sel } = run.value;
  return { before: value.slice(0, sel[0]), picked: value.slice(sel[0], sel[1]), after: value.slice(sel[1]) };
});

function keyCell(e: FieldEvent) {
  return e.key === undefined ? '' : `${e.key} · ${e.code} · ${e.keyCode}`;
}
function editCell(e: FieldEvent) {
  if (e.inputType) return `${e.inputType} · ${JSON.stringify(e.data)}`;
  return e.data === undefined ? '' : `data ${JSON.stringify(e.data)}`;
}
/** Что сделал с событием `preventDefault()` слушателя. */
function verdict(e: FieldEvent, list: string[]) {
  if (!list.includes(e.type)) return '';
  return e.cancelable ? 'отменено' : 'не отменить';
}

// ─── Живое поле ─────────────────────────────────────────────────────────────────────────

const liveEl = ref<HTMLInputElement | null>(null);
const live = ref<FieldEvent[]>([]);
/** Один и тот же массив отдан `watchField`: флажки меняют его содержимое, а не ссылку. */
const liveCancel: string[] = [];
watch(
  cancel,
  (list) => {
    liveCancel.splice(0, liveCancel.length, ...list);
  },
  { immediate: true },
);
const LIVE_MAX = 16;
onMounted(() => {
  if (!liveEl.value) return;
  watchField(liveEl.value, (e) => {
    live.value = [...live.value, e].slice(-LIVE_MAX);
  }, liveCancel);
});
function clearLive() {
  live.value = [];
  if (liveEl.value) liveEl.value.value = '';
}
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="picked" class="l-pills" label="Сценарий" :options="options" />
    </template>

    <div class="il-body">
      <Md class="il-note" :text="scenario.note" />

      <div class="il-controls">
        <div class="il-buttons" role="group" aria-label="Добавить шаг">
          <Button variant="secondary" :disabled="composing || full" @click="add({ do: 'key', key: 'a', code: 'KeyA' })">a</Button>
          <Button variant="secondary" :disabled="composing || full" @click="add({ do: 'key', key: 'ф', code: 'KeyA' })">ф (KeyA)</Button>
          <Button variant="secondary" :disabled="composing || full" @click="add({ do: 'key', key: 'Backspace', code: 'Backspace' })">Backspace</Button>
          <Button variant="secondary" :disabled="full" @click="add({ do: 'key', key: 'Enter', code: 'Enter' })">Enter</Button>
          <Button variant="secondary" :disabled="composing || full" @click="add({ do: 'paste', text: 'XY' })">Ctrl+V «XY»</Button>
          <Button variant="secondary" :disabled="full" @click="add({ do: 'compose', text: nextWord })">IME: {{ nextWord }}</Button>
          <Button variant="secondary" :disabled="!composing || full" @click="add({ do: 'commit', text: '漢' })">IME → 漢</Button>
          <Button
            variant="secondary"
            :disabled="composing || full"
            @click="add({ do: 'set', value: run.value.toUpperCase() })"
          >
el.value = toUpperCase()
</Button>
          <Button variant="secondary" :disabled="!actions.length" @click="restart">сначала</Button>
        </div>

        <fieldset class="il-cancel">
          <legend class="il-label">preventDefault() в слушателе</legend>
          <label v-for="type in CANCELLABLE" :key="type" class="il-check">
            <input type="checkbox" :checked="cancel.includes(type)" @change="toggle(type)" />
            <code>{{ type }}</code>
          </label>
        </fieldset>
      </div>

      <div class="il-state">
        <div class="il-steps">
          <span class="il-label">шаги</span>
          <span v-if="!actions.length" class="il-muted">пока ни одного</span>
          <code v-for="(a, i) in actions" :key="i" class="il-step">{{ stepLabel(a) }}</code>
        </div>
        <div class="il-field" aria-label="Поле после последнего шага">
          <span class="il-label">поле: «{{ scenario.start.value }}», каретка {{ scenario.start.caret }} → </span>
          <code class="il-value"><span>{{ field.before }}</span><mark v-if="field.picked" class="il-sel">{{ field.picked }}</mark><span v-else class="il-caret" aria-hidden="true"></span><span>{{ field.after }}</span></code>
          <span class="il-muted">sel {{ run.sel[0] }}–{{ run.sel[1] }}</span>
        </div>
        <div class="il-verdict" :data-tone="matches ? 'ok' : 'none'">
          <template v-if="matches">журнал модели совпал с журналом Chromium {{ chromium }}</template>
          <template v-else-if="touched">свой сценарий: журнал модели, Chromium его не снимал</template>
          <template v-else>журнал модели</template>
        </div>
      </div>

      <div class="il-scroll">
        <table class="il-log">
          <thead>
            <tr>
              <th>событие</th>
              <th>key · code · keyCode</th>
              <th>inputType · data</th>
              <th>isComposing</th>
              <th>value</th>
              <th>sel</th>
              <th>отмена</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!run.log.length">
              <td colspan="7" class="il-muted">событий нет</td>
            </tr>
            <tr v-for="(e, i) in run.log" :key="i" :data-type="e.type">
              <td><code>{{ e.type }}</code></td>
              <td><code v-if="keyCell(e)">{{ keyCell(e) }}</code></td>
              <td><code v-if="editCell(e)">{{ editCell(e) }}</code></td>
              <td><code v-if="e.composing !== undefined">{{ e.composing }}</code></td>
              <td><code>{{ JSON.stringify(e.value) }}</code></td>
              <td><code>{{ e.sel[0] }}–{{ e.sel[1] }}</code></td>
              <td>
                <span v-if="verdict(e, cancel)" class="il-chip" :data-tone="e.cancelable ? 'warn' : 'err'">{{ verdict(e, cancel) }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="il-live">
        <label class="il-label" for="il-live-field">живое поле — журнал пишет watchField в вашем браузере</label>
        <div class="il-live__row">
          <input id="il-live-field" ref="liveEl" class="il-input" type="text" autocomplete="off" spellcheck="false" />
          <Button variant="secondary" @click="clearLive">очистить</Button>
        </div>
        <div class="il-scroll">
          <table class="il-log">
            <thead>
              <tr>
                <th>событие</th>
                <th>key · code · keyCode</th>
                <th>inputType · data</th>
                <th>isComposing</th>
                <th>value</th>
                <th>sel</th>
                <th>отмена</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!live.length">
                <td colspan="7" class="il-muted">напечатайте что-нибудь в поле</td>
              </tr>
              <tr v-for="(e, i) in live" :key="i" :data-type="e.type">
                <td><code>{{ e.type }}</code></td>
                <td><code v-if="keyCell(e)">{{ keyCell(e) }}</code></td>
                <td><code v-if="editCell(e)">{{ editCell(e) }}</code></td>
                <td><code v-if="e.composing !== undefined">{{ e.composing }}</code></td>
                <td><code>{{ JSON.stringify(e.value) }}</code></td>
                <td><code>{{ e.sel[0] }}–{{ e.sel[1] }}</code></td>
                <td>
                  <span v-if="verdict(e, cancel)" class="il-chip" :data-tone="e.cancelable ? 'warn' : 'err'">{{ verdict(e, cancel) }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <Md class="il-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.il-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.il-note,
.il-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.il-note :deep(code),
.il-caption :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}

.il-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 20px;
  align-items: flex-start;
}
.il-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  flex: 1 1 360px;
  min-width: 0;
}
.il-cancel {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  margin: 0;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  flex: 0 1 auto;
}
.il-check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-3);
  color: var(--prose);
  cursor: pointer;
}
.il-check input {
  font: inherit;
  color: inherit;
  margin: 0;
}
.il-check code,
.il-step,
.il-log code {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--ink);
}

.il-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.il-muted {
  font-size: var(--fs-2);
  color: var(--text-muted);
}

.il-state {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
  min-width: 0;
}
.il-steps,
.il-field {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 8px;
  align-items: baseline;
  min-width: 0;
}
.il-step {
  padding: 2px 7px;
  border-radius: var(--r1);
  background: var(--surface-3);
}
.il-value {
  display: inline-block;
  min-width: 6em;
  padding: 3px 8px;
  border: 1px solid var(--border-strong);
  border-radius: var(--r1);
  background: var(--surface);
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
  white-space: pre;
  overflow-wrap: anywhere;
}
.il-caret {
  display: inline-block;
  width: 0;
  height: 1.1em;
  margin: 0 -1px;
  vertical-align: text-bottom;
  border-left: 2px solid var(--tone-warn-accent);
}
.il-sel {
  border-radius: 2px;
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
  box-shadow: inset 0 0 0 1px var(--tone-warn-line);
}
.il-verdict {
  align-self: flex-start;
  padding: 4px 10px;
  border-radius: var(--r1);
  font-size: var(--fs-2);
  background: var(--surface-3);
  color: var(--text-muted);
}
.il-verdict[data-tone='ok'] {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
  box-shadow: inset 0 0 0 1px var(--tone-ok-line);
}

.il-scroll {
  overflow-x: auto;
  min-width: 0;
}
.il-log {
  width: 100%;
  min-width: 760px;
  border-collapse: collapse;
  font-size: var(--fs-2);
  color: var(--prose);
}
.il-log th {
  padding: 6px 8px;
  text-align: left;
  font-family: var(--mono);
  font-size: var(--fs-2);
  font-weight: 500;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
  border-bottom: 1px solid var(--border);
}
.il-log td {
  padding: 5px 8px;
  border-bottom: 1px solid var(--hairline);
  vertical-align: baseline;
  white-space: nowrap;
}
.il-log tr[data-type='beforeinput'] td,
.il-log tr[data-type='input'] td {
  background: var(--surface-2);
}
.il-chip {
  padding: 1px 7px;
  border-radius: var(--r1);
  font-size: var(--fs-2);
}
.il-chip[data-tone='warn'] {
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.il-chip[data-tone='err'] {
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}

.il-live {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 14px;
  border-top: 1px solid var(--divider);
  min-width: 0;
}
.il-live__row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.il-input {
  flex: 1 1 auto;
  min-width: 0;
  padding: 7px 10px;
  border: 1px solid var(--border-strong);
  border-radius: var(--r2);
  background: var(--surface);
  font: inherit;
  font-family: var(--mono);
  font-size: var(--fs-4);
  color: inherit;
}
.il-input:focus-visible {
  outline: 2px solid var(--tone-info-line);
  outline-offset: 1px;
}
</style>
