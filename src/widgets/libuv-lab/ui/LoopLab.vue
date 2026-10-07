<script setup lang="ts">
/**
 * «Оборот по шагам»: сценарий темы, выполненный учебной моделью `LOOP_CODE`.
 *
 * Считает не компонент, а строка `LOOP_CODE` из темы, собранная `new Function`
 * (`model/run.ts`). Та же строка напечатана на странице, а `tests/unit/node-event-loop.test.ts`
 * сверяет её вывод с настоящим Node на тех же сценариях. Компонент только раскладывает трассу
 * по кругам и фазам и ставит рядом выборку стенда (`scenario.real`).
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { allowedOrders, joinOut, loadLoop } from '../model/run';
import type { LoopScenario, LoopStep } from '../model/types';

const props = defineProps<{
  code: string;
  scenarios: LoopScenario[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const runLoop = loadLoop(props.code);

const picked = ref(props.scenarios[0].id);
const options = props.scenarios.map((s) => ({ value: s.id, label: s.label }));
const machine = ref<'fast' | 'slow'>('fast');
const machines = [
  { value: 'fast', label: 'быстрая машина' },
  { value: 'slow', label: 'медленная: +1 мс на оборот' },
];

const scenario = computed(() => props.scenarios.find((s) => s.id === picked.value) ?? props.scenarios[0]);
const result = computed(() => runLoop(scenario.value.code, machine.value === 'slow' ? 1 : 0));
const allowed = computed(() => allowedOrders(runLoop, scenario.value.code));
const printed = computed(() => joinOut(result.value.out));

const PHASES = ['timers', 'poll', 'check', 'close'] as const;
const PHASE_LABEL: Record<LoopStep['phase'], string> = {
  main: 'модуль',
  timers: 'timers',
  poll: 'poll',
  check: 'check',
  close: 'close callbacks',
};
const KIND_LABEL: Record<LoopStep['kind'], string> = {
  main: 'тело модуля',
  timeout: 'колбэк таймера',
  io: 'колбэк ввода-вывода',
  immediate: 'setImmediate',
  close: 'колбэк закрытия',
  sleep: 'сон',
};

/** Трасса по кругам: в каждом — шаги в порядке выполнения. */
const turns = computed(() => {
  const map = new Map<number, LoopStep[]>();
  for (const step of result.value.trace) {
    const list = map.get(step.turn) ?? [];
    list.push(step);
    map.set(step.turn, list);
  }
  return [...map.entries()].map(([turn, steps]) => ({
    turn,
    title: turn === 0 ? 'до первого круга' : `круг ${turn}`,
    steps,
    phases: new Set(steps.map((s) => s.phase)),
  }));
});

const stepText = (s: LoopStep) =>
  s.kind === 'sleep' ? `спит ${Number(s.ms?.toFixed(2))} мс` : KIND_LABEL[s.kind];

const realRows = computed(() =>
  Object.entries(scenario.value.real)
    .sort((a, b) => b[1] - a[1])
    .map(([order, count]) => ({ order, count, current: order === printed.value })),
);
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="ll-tools">
        <SegmentedControl v-model="picked" class="l-pills" label="Сценарий" :options="options" />
        <SegmentedControl v-model="machine" class="l-pills" label="Машина" :options="machines" />
      </div>
    </template>

    <div class="ll-body">
      <div class="ll-cols">
        <div class="ll-col">
          <span class="ll-label">сценарий</span>
          <pre class="ll-code" data-code>{{ scenario.code }}</pre>
        </div>

        <div class="ll-col">
          <span class="ll-label">вывод модели</span>
          <div class="ll-out">
            <code v-for="(line, i) in result.out" :key="i" class="ll-chip">{{ line }}</code>
            <span v-if="!result.out.length" class="ll-muted">ничего</span>
          </div>

          <div class="ll-verdict" :data-tone="scenario.deterministic ? 'ok' : 'warn'">
            <template v-if="allowed.length === 1">Порядок не зависит от скорости машины: Node его обещает.</template>
            <template v-else>Быстрая и медленная машина печатают разное: Node этот порядок не обещает.</template>
          </div>

          <span class="ll-label">Node 24.11, {{ scenario.runs }} отдельных запусков</span>
          <div class="ll-real">
            <div v-for="row in realRows" :key="row.order" class="ll-real-row" :data-current="row.current ? 'yes' : 'no'">
              <code class="ll-real-order">{{ row.order }}</code>
              <span class="ll-real-count">{{ row.count }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="ll-turns">
        <div v-for="t in turns" :key="t.turn" class="ll-turn">
          <div class="ll-turn-head">
            <span class="ll-turn-title">{{ t.title }}</span>
            <span class="ll-strip" aria-hidden="true">
              <span v-for="p in PHASES" :key="p" class="ll-phase" :data-on="t.phases.has(p) ? 'yes' : 'no'">{{ p }}</span>
            </span>
          </div>
          <div v-for="(s, i) in t.steps" :key="i" class="ll-step" :data-kind="s.kind">
            <span class="ll-step-phase">{{ PHASE_LABEL[s.phase] }}</span>
            <span class="ll-step-kind">{{ stepText(s) }}</span>
            <span class="ll-step-out">
              <code v-for="(line, j) in s.out" :key="j" class="ll-chip ll-chip--small">{{ line }}</code>
            </span>
          </div>
        </div>
      </div>

      <Md class="ll-note" :text="scenario.note" />
      <Md class="ll-note" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.ll-tools {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.ll-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.ll-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.ll-cols {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
  gap: 16px;
}
@media (max-width: 760px) {
  .ll-cols {
    grid-template-columns: minmax(0, 1fr);
  }
}
.ll-col {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.ll-code {
  margin: 0;
  padding: 12px 14px;
  overflow-x: auto;
  border-radius: var(--r2);
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.6;
  /* Подложка — общая для кода курса (`pre` в base.css, чернильная): цвет — «на чернилах». */
  color: var(--code-fg);
  white-space: pre;
}
.ll-out {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.ll-chip {
  padding: 3px 9px;
  border-radius: var(--r1);
  background: var(--surface-3);
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
}
.ll-chip--small {
  padding: 1px 7px;
  font-size: var(--fs-2);
}
.ll-muted {
  font-size: var(--fs-3);
  color: var(--text-muted);
}
.ll-verdict {
  padding: 8px 12px;
  border-radius: var(--r2);
  font-size: var(--fs-3);
  line-height: 1.5;
}
.ll-verdict[data-tone='ok'] {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.ll-verdict[data-tone='warn'] {
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.ll-real {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ll-real-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 5px 10px;
  border-radius: var(--r1);
  background: var(--surface-2);
  font-size: var(--fs-3);
  color: var(--prose);
}
.ll-real-row[data-current='yes'] {
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
}
.ll-real-order {
  font-family: var(--mono);
  overflow-wrap: anywhere;
}
.ll-real-count {
  font-family: var(--mono);
  font-weight: 600;
}

.ll-turns {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ll-turn {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border-radius: var(--r2);
  background: var(--surface-2);
}
.ll-turn-head {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  align-items: center;
  justify-content: space-between;
}
.ll-turn-title {
  font-size: var(--fs-3);
  font-weight: 600;
  color: var(--ink);
}
.ll-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.ll-phase {
  padding: 1px 7px;
  border: 1px solid var(--border-strong);
  border-radius: var(--r1);
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.ll-phase[data-on='yes'] {
  border-color: var(--tone-info-line);
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
}
.ll-step {
  display: grid;
  grid-template-columns: minmax(70px, 0.6fr) minmax(120px, 1fr) minmax(0, 1.6fr);
  gap: 4px 10px;
  align-items: baseline;
  font-size: var(--fs-3);
  color: var(--prose);
}
@media (max-width: 560px) {
  .ll-step {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
  }
  .ll-step-out {
    grid-column: 1 / -1;
  }
}
.ll-step[data-kind='sleep'] {
  color: var(--text-muted);
}
.ll-step-phase {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--tone-info-text);
}
.ll-step-out {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.ll-note {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
  overflow-wrap: anywhere;
}
.ll-note :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
</style>
