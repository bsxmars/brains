<script setup lang="ts">
/**
 * «Мини-руны и Svelte 5.57.1 на одних сценариях»: сценарий исполняется строкой мини-рун
 * из темы, и демо листает его по шагам — пометки, записи, пересчёты, сбросы — с флагами
 * и номерами записей всех узлов после каждого шага.
 *
 * Считает не компонент, а `traceScenario` (`model/run.ts`) над `MINI_RUNES_CODE` — той же
 * строкой, что напечатана в теме. Журнал настоящего Svelte — литерал `svelte` у сценария;
 * `tests/unit/svelte-runes.test.ts` снимает его с `svelte/internal/client` и сверяет с мини-рунами.
 *
 * ⚠️ Прогон — в `onMounted`: на сборке страницы `new Function` не нужен.
 */
import { computed, onMounted, ref, shallowRef, watch } from 'vue';
import CodeListing from '@/shared/ui/CodeListing.vue';
import ConsoleView from '@/shared/ui/ConsoleView.vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import StepToolbar from '@/shared/ui/StepToolbar.vue';
import { Button, SegmentedControl } from '@/shared/ui';
import { traceScenario } from '../model/run';
import type { NodeKind, NodeStatus, RunesScenario, ScenarioRun } from '../model/types';

const props = defineProps<{
  miniCode: string;
  scenarios: RunesScenario[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const picked = ref(props.scenarios[0].id);
const options = props.scenarios.map((s) => ({ value: s.id, label: s.label }));
const scenario = computed(() => props.scenarios.find((s) => s.id === picked.value) ?? props.scenarios[0]);

const run = shallowRef<ScenarioRun | null>(null);
const at = ref(0);
const failed = ref('');

async function boot() {
  const id = picked.value;
  failed.value = '';
  try {
    const result = await traceScenario(props.miniCode, scenario.value.code);
    if (id !== picked.value) return;
    run.value = result;
    at.value = 0;
  } catch (e) {
    run.value = null;
    failed.value = String(e);
  }
}

watch(picked, boot);
onMounted(boot);

const lines = computed(() => scenario.value.code.split('\n'));
const total = computed(() => run.value?.steps.length ?? 0);
const step = computed(() => run.value?.steps[at.value] ?? null);

const KIND: Record<NodeKind, string> = { state: '$state', derived: '$derived', effect: '$effect', template: 'шаблон' };
const TONE: Record<NodeStatus, string> = { CLEAN: 'ok', DIRTY: 'err', MAYBE_DIRTY: 'warn', '—': 'none' };

/** Шаги вокруг текущего: журнал длинный, показываем окно. */
const WINDOW = 9;
const visible = computed(() => {
  const steps = run.value?.steps ?? [];
  const start = Math.max(0, Math.min(at.value - 4, steps.length - WINDOW));
  return steps.slice(start, start + WINDOW).map((s, i) => ({ ...s, index: start + i }));
});

const miniSoFar = computed(() =>
  (run.value?.steps ?? []).slice(0, at.value + 1).filter((s) => s.kind === 'log').map((s) => s.text),
);

const same = computed(
  () => run.value !== null && JSON.stringify(run.value.logs) === JSON.stringify(scenario.value.svelte),
);

function go(i: number) {
  at.value = Math.max(0, Math.min(total.value - 1, i));
}
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="picked" class="l-pills" label="Сценарий" :options="options" />
    </template>

    <div class="sl-split">
      <div class="sl-pane">
        <CodeListing :lines="lines" label="сценарий · одна строка для мини-рун и для Svelte" />
        <Md class="sl-note" :text="scenario.note" />
      </div>

      <div class="sl-pane">
        <div class="sl-controls">
          <StepToolbar
            :counter="total ? `шаг ${at + 1} из ${total}` : '…'"
            :at-start="at === 0"
            :at-end="at >= total - 1"
            @prev="go(at - 1)"
            @next="go(at + 1)"
            @reset="go(0)"
          />
          <Button variant="secondary" :disabled="at >= total - 1" @click="go(total - 1)">в конец</Button>
        </div>

        <ol v-if="run" class="sl-steps" aria-label="Шаги прогона">
          <li
            v-for="s in visible"
            :key="s.index"
            class="sl-step"
            :data-kind="s.kind"
            :data-on="s.index === at ? 'yes' : 'no'"
          >
            <button type="button" class="sl-step__btn" @click="go(s.index)">
              <span class="sl-step__n">{{ s.index + 1 }}</span>
              <span class="sl-step__text">{{ s.kind === 'log' ? `log: ${s.text}` : s.text }}</span>
            </button>
          </li>
        </ol>
        <p v-else-if="failed" class="sl-failed">{{ failed }}</p>

        <div v-if="step" class="sl-nodes" role="table" aria-label="Узлы графа после шага">
          <div class="sl-node sl-node--head" role="row">
            <span role="columnheader">узел</span>
            <span role="columnheader">флаг</span>
            <span role="columnheader">wv</span>
            <span role="columnheader">значение</span>
          </div>
          <div
            v-for="n in step.nodes"
            :key="n.id"
            class="sl-node"
            role="row"
            :data-on="n.id === step.node ? 'yes' : 'no'"
          >
            <span role="cell" class="sl-node__name">
              <code>{{ n.name }}</code>
              <span v-if="!n.name.startsWith(KIND[n.kind])" class="sl-node__kind">{{ KIND[n.kind] }}</span>
            </span>
            <span role="cell"><span class="sl-flag" :data-tone="TONE[n.status]">{{ n.status }}</span></span>
            <code role="cell" class="sl-node__wv">{{ n.wv }}</code>
            <code role="cell" class="sl-node__value">{{ n.value }}</code>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="sl-logs">
        <ConsoleView :lines="miniSoFar" label="мини-руны · журнал до этого шага" empty-label="пока пусто" :min-height="96" />
        <ConsoleView :lines="scenario.svelte" label="svelte 5.57.1 · весь журнал" :min-height="96" />
      </div>
      <span v-if="run" class="sl-same" :data-on="same ? 'yes' : 'no'">
        {{ same ? 'журналы совпадают строка в строку' : 'журналы расходятся' }}
      </span>
      <Md class="sl-caption" :text="caption" />
    </template>
  </DemoFrame>
</template>

<style scoped>
.sl-split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 20px;
  padding: 20px;
}
@media (max-width: 860px) {
  .sl-split {
    grid-template-columns: minmax(0, 1fr);
  }
}
.sl-pane {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.sl-note,
.sl-caption {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--prose);
}
.sl-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.sl-steps {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 8px;
  list-style: none;
  border-radius: var(--r2);
  background: var(--surface-2);
}
.sl-step__btn {
  display: grid;
  grid-template-columns: 2.6em minmax(0, 1fr);
  gap: 6px;
  width: 100%;
  padding: 3px 8px;
  border: 0;
  border-radius: var(--r1);
  background: none;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.sl-step__btn:hover,
.sl-step__btn:focus-visible {
  background: var(--surface-3);
  outline: none;
}
.sl-step__n {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-faint);
}
.sl-step__text {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--prose);
  overflow-wrap: anywhere;
}
.sl-step[data-kind='log'] .sl-step__text {
  color: var(--tone-ok-text);
}
.sl-step[data-kind='write'] .sl-step__text {
  color: var(--tone-info-text);
}
.sl-step[data-kind='flush'] .sl-step__text {
  color: var(--text-muted);
}
.sl-step[data-on='yes'] .sl-step__btn {
  background: var(--tone-warn-bg);
  box-shadow: inset 2px 0 0 var(--tone-warn-line);
}
.sl-failed {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--tone-err-text);
}

.sl-nodes {
  display: flex;
  flex-direction: column;
  padding: 8px 10px;
  border-radius: var(--r2);
  background: var(--surface-2);
}
.sl-node {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(0, 1.2fr) 2.4em minmax(0, 1fr);
  gap: 8px;
  align-items: baseline;
  padding: 5px 4px;
  border-radius: var(--r1);
  font-size: var(--fs-3);
  color: var(--prose);
}
.sl-node + .sl-node {
  border-top: 1px solid var(--hairline);
}
.sl-node--head {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.sl-node[data-on='yes'] {
  background: var(--tone-warn-bg);
}
.sl-node__name {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 8px;
  align-items: baseline;
  min-width: 0;
}
.sl-node code {
  padding: 0;
  background: none;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
  overflow-wrap: anywhere;
}
.sl-node__kind {
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.sl-node__wv {
  color: var(--text-muted) !important;
}
.sl-flag {
  display: inline-block;
  max-width: 100%;
  padding: 1px 6px;
  border-radius: var(--r-full);
  font-family: var(--mono);
  font-size: var(--fs-2);
  overflow-wrap: anywhere;
}
.sl-flag[data-tone='ok'] {
  background: var(--tone-ok-chip);
  color: var(--tone-ok-text);
}
.sl-flag[data-tone='warn'] {
  background: var(--tone-warn-chip);
  color: var(--tone-warn-text);
}
.sl-flag[data-tone='err'] {
  background: var(--tone-err-chip);
  color: var(--tone-err-text);
}
.sl-flag[data-tone='none'] {
  color: var(--text-faint);
}

.sl-logs {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr));
  gap: 14px;
}
.sl-same {
  display: inline-block;
  margin-top: 12px;
  padding: 3px 8px;
  border-radius: var(--r-full);
  background: var(--tone-err-chip);
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--tone-err-text);
}
.sl-same[data-on='yes'] {
  background: var(--tone-ok-chip);
  color: var(--tone-ok-text);
}
.sl-caption {
  margin-top: 12px;
}
</style>
