<script setup lang="ts">
/**
 * «async/await по шагам»: одна и та же `load` как async-функция и как генератор под `spawn`.
 * Шаг — синхронная часть программы или одна микрозадача. Видно, где стоит генератор, что
 * лежит в очереди и что уже напечатано.
 *
 * Считает не компонент: `model/run.ts` исполняет строку `SPAWN_CODE` из темы на промисе
 * с видимой очередью (`model/mini-promise.ts`). Чтобы модель не врала, при монтировании та же
 * программа прогоняется на настоящем `Promise` — `async`-версия, — и подвал показывает,
 * совпал ли порядок. Та же сверка закреплена в `tests/unit/generators.test.ts`.
 */
import { computed, onMounted, ref, watch } from 'vue';
import { useStepper } from '@/shared/lib/useStepper';
import CodeListing from '@/shared/ui/CodeListing.vue';
import ConsoleView from '@/shared/ui/ConsoleView.vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import QueueView from '@/shared/ui/QueueView.vue';
import StepToolbar from '@/shared/ui/StepToolbar.vue';
import { SegmentedControl } from '@/shared/ui';
import { linesWith, runNative, traceScenario } from '../model/run';
import type { SpawnFixture, SpawnScenario } from '../model/types';

const props = defineProps<{
  fixture: SpawnFixture;
  scenarios: SpawnScenario[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const picked = ref(props.scenarios[0].id);
const options = props.scenarios.map((s) => ({ value: s.id, label: s.label }));
const scenario = computed(() => props.scenarios.find((s) => s.id === picked.value) ?? props.scenarios[0]);

const traces = Object.fromEntries(props.scenarios.map((s) => [s.id, traceScenario(props.fixture, s)]));
const trace = computed(() => traces[scenario.value.id]);

const total = computed(() => trace.value.steps.length);
const { index, counter, atStart, atEnd, next, prev, reset } = useStepper(total);
watch(picked, () => reset());

const step = computed(() => trace.value.steps[index.value]);

const asyncLines = computed(() => scenario.value.asyncCode.split('\n'));
const genLines = computed(() => scenario.value.genCode.split('\n'));
const awaitAt = computed(() => linesWith(scenario.value.asyncCode, 'await'));
const yieldAt = computed(() => linesWith(scenario.value.genCode, 'yield'));

/** Строка паузы: k-й `yield` и k-й `await` — одно и то же место программы. */
const activeAsync = computed(() => (step.value.done || !step.value.pause ? -1 : (awaitAt.value[step.value.pause - 1] ?? -1)));
const activeGen = computed(() => (step.value.done || !step.value.pause ? -1 : (yieldAt.value[step.value.pause - 1] ?? -1)));

/** Сверка с движком: только в браузере, после монтирования. */
const verdict = ref<Record<string, boolean>>({});
onMounted(async () => {
  for (const s of props.scenarios) {
    const native = await runNative(props.fixture, s.asyncCode);
    verdict.value = { ...verdict.value, [s.id]: native.join('\n') === traces[s.id].log.join('\n') };
  }
});

const VERDICT = {
  wait: 'Сверка с настоящим `async/await` выполнится в браузере.',
  ok: 'Настоящий `async/await` в этом браузере напечатал те же строки в том же порядке.',
  bad: 'Настоящий `async/await` в этом браузере напечатал строки в другом порядке, чем модель.',
};
const verdictText = computed(() => {
  const v = verdict.value[scenario.value.id];
  return v === undefined ? VERDICT.wait : v ? VERDICT.ok : VERDICT.bad;
});
const verdictTone = computed(() => {
  const v = verdict.value[scenario.value.id];
  return v === undefined ? 'wait' : v ? 'ok' : 'bad';
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="sp-bar">
        <SegmentedControl v-model="picked" class="l-pills" label="Сценарий" :options="options" />
        <StepToolbar :counter="counter" :at-start="atStart" :at-end="atEnd" @prev="prev" @next="next" @reset="reset" />
      </div>
    </template>

    <div class="sp-body">
      <Md class="sp-note" :text="scenario.note" />

      <div class="sp-code">
        <div class="sp-pane">
          <CodeListing :lines="asyncLines" :active="activeAsync" tone="dark" label="async-функция" />
        </div>
        <div class="sp-pane">
          <CodeListing :lines="genLines" :active="activeGen" tone="dark" label="генератор под spawn" />
        </div>
      </div>

      <div class="sp-step" aria-live="polite">
        <Md class="sp-step__title" :text="step.title" />
        <Md v-if="step.detail" class="sp-step__detail" :text="step.detail" />
        <span class="sp-state" :data-done="step.done ? 'yes' : 'no'">генератор: {{ step.state }}</span>
      </div>

      <div class="sp-side">
        <QueueView :items="step.queue" label="очередь микрозадач" tone="info" empty-label="пусто — программа закончилась" />
        <ConsoleView :lines="step.console" label="вывод log" :min-height="120" />
      </div>

      <Md class="sp-caption" :text="caption" />
    </div>

    <template #footer>
      <Md class="sp-verdict" :data-tone="verdictTone" :text="verdictText" />
    </template>
  </DemoFrame>
</template>

<style scoped>
.sp-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 18px;
}

.sp-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.sp-note,
.sp-caption,
.sp-step__detail {
  font-size: var(--fs-5);
  line-height: 1.6;
  color: var(--prose);
}
.sp-note :deep(code),
.sp-caption :deep(code),
.sp-step :deep(code),
.sp-verdict :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}

.sp-code {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
}
@media (max-width: 760px) {
  .sp-code {
    grid-template-columns: minmax(0, 1fr);
  }
}
/* Листинги на чернилах: код здесь не читают, а следят, где сейчас пауза. */
.sp-pane {
  min-width: 0;
  padding: 14px 6px;
  border-radius: var(--r3);
  background: var(--ink);
}
.sp-pane :deep(.t-label) {
  padding: 0 12px;
  color: var(--ink-faint);
}

.sp-step {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 16px;
  border-radius: var(--r2);
  background: var(--surface-2);
}
.sp-step__title {
  font-size: var(--fs-5);
  font-weight: 600;
  line-height: 1.5;
  color: var(--ink);
  overflow-wrap: anywhere;
}
.sp-step__detail {
  overflow-wrap: anywhere;
}
.sp-state {
  align-self: flex-start;
  padding: 4px 10px;
  border-radius: var(--r-full);
  font-family: var(--mono);
  font-size: var(--fs-2);
  background: var(--tone-info-chip);
  color: var(--tone-info-text);
}
.sp-state[data-done='yes'] {
  background: var(--surface-3);
  color: var(--text-muted);
}

.sp-side {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 760px) {
  .sp-side {
    grid-template-columns: minmax(0, 1fr);
  }
}
.sp-side :deep(.item),
.sp-side :deep(.cv-line) {
  overflow-wrap: anywhere;
}

.sp-verdict {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--text-muted);
}
.sp-verdict[data-tone='ok'] {
  color: var(--tone-ok-text);
}
.sp-verdict[data-tone='bad'] {
  color: var(--tone-err-text);
}
</style>
