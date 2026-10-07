<script setup lang="ts">
/**
 * Граф сигналов на двух реализациях сразу: наивный push и push-pull — строки, напечатанные
 * в теме. Каждая кнопка исполняется обеими; переключатель выбирает, чей журнал показать,
 * а таблица счётчиков стоит рядом всегда — разница видна без переключения.
 *
 * Логика — в `model/load.ts` (`GraphLab`); тот же модуль тест гоняет ещё и на
 * `@vue/reactivity` и alien-signals.
 *
 * ⚠️ Лаборатории — обычные переменные, не `ref`: внутри них чужая реактивность, а экрану
 * нужны только снимки. Сборка — в `onMounted`: на сборке страницы `new Function` не нужен.
 */
import { computed, onMounted, ref, shallowRef, watch } from 'vue';
import CodeListing from '@/shared/ui/CodeListing.vue';
import ConsoleView from '@/shared/ui/ConsoleView.vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button, SegmentedControl } from '@/shared/ui';
import { GraphLab, loadSignals } from '../model/load';
import type { GraphScenario, GraphStep, TraceEntry } from '../model/types';

const props = defineProps<{ code: string; naiveCode: string; scenarios: GraphScenario[] }>();

type Mode = 'pushpull' | 'naive';
const MODES = [
  { value: 'pushpull', label: 'push-pull' },
  { value: 'naive', label: 'наивный push' },
];

const picked = ref(props.scenarios[0]?.id ?? '');
const mode = ref<Mode>('pushpull');
const options = computed(() => props.scenarios.map((s) => ({ value: s.id, label: s.label })));
const scenario = computed(() => props.scenarios.find((s) => s.id === picked.value) ?? props.scenarios[0]);

let labs: Record<Mode, GraphLab> | null = null;
const steps = shallowRef<Record<Mode, GraphStep> | null>(null);
const heading = ref('установка');

function boot() {
  labs = {
    pushpull: new GraphLab(loadSignals(props.code), scenario.value),
    naive: new GraphLab(loadSignals(props.naiveCode), scenario.value),
  };
  heading.value = 'установка';
  steps.value = { pushpull: labs.pushpull.start(), naive: labs.naive.start() };
}

function act(i: number) {
  if (!labs) return;
  heading.value = scenario.value.actions[i];
  steps.value = { pushpull: labs.pushpull.step(i), naive: labs.naive.step(i) };
}

watch(picked, boot);
onMounted(boot);

const lines = computed(() => scenario.value.setup.split('\n'));

const entry = (t: TraceEntry) =>
  t.kind === 'run' ? `  ↻ ${t.name}` : `  ${t.text}${t.consistent === false ? '   ⚠ глитч: такой пары в данных не было' : ''}`;

const journal = computed(() => {
  const s = steps.value?.[mode.value];
  if (!s) return [];
  const out = [`> ${heading.value}`, ...s.trace.map(entry)];
  if (!s.trace.length) out.push('  не выполнилось ничего');
  return out;
});

/** Узлы по рядам и счётчики прогонов в обоих режимах. Источники не считаются — у них нет функции. */
const graph = computed(() =>
  scenario.value.rows.map((row) =>
    row.map((name) => {
      const pp = steps.value?.pushpull.counts[name] ?? 0;
      const nv = steps.value?.naive.counts[name] ?? 0;
      return { name, source: !isComputedOrEffect(name), pp, nv };
    }),
  ),
);

/** Узел считается вычислением, если сценарий зовёт для него `count`. */
function isComputedOrEffect(name: string) {
  return scenario.value.setup.includes(`count('${name}')`);
}

const glitches = computed(() => {
  const s = steps.value?.[mode.value];
  return s ? s.trace.filter((t) => t.kind === 'log' && t.consistent === false).length : 0;
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="picked" class="l-pills" label="Сценарий" :options="options" />
      <SegmentedControl v-model="mode" class="l-pills" label="Реализация" :options="MODES" />
    </template>

    <div class="ms2-split">
      <div class="ms2-pane">
        <CodeListing :lines="lines" label="сценарий · исполняется обеими реализациями" />
        <div class="ms2-actions">
          <Button v-for="(action, i) in scenario.actions" :key="action" variant="secondary" :disabled="!steps" @click="act(i)">
            {{ action }}
          </Button>
          <Button variant="secondary" :disabled="!steps" @click="boot">сброс</Button>
        </div>
        <Md class="ms2-note" :text="scenario.note" />
      </div>

      <div class="ms2-pane">
        <span class="t-label">граф · сколько раз пересчитан узел: push-pull / наивный</span>
        <div class="ms2-graph">
          <div v-for="(row, r) in graph" :key="r" class="ms2-row">
            <div v-for="node in row" :key="node.name" class="ms2-node" :data-source="node.source ? 'yes' : 'no'">
              <span class="ms2-node__name">{{ node.name }}</span>
              <span v-if="node.source" class="ms2-node__meta">сигнал</span>
              <span v-else class="ms2-node__meta" :data-diff="node.pp !== node.nv ? 'yes' : 'no'">{{ node.pp }} / {{ node.nv }}</span>
            </div>
          </div>
        </div>
        <span v-if="steps" class="ms2-glitch" :data-on="glitches ? 'yes' : 'no'">
          {{ glitches ? `глитчей за шаг: ${glitches}` : 'глитчей за шаг: 0' }}
        </span>
      </div>
    </div>

    <template #footer>
      <ConsoleView
        :lines="journal"
        :label="`журнал шага · ${mode === 'naive' ? 'наивный push' : 'push-pull'} · ↻ — пересчёт узла`"
        empty-label="сценарий ещё не запущен"
        :min-height="110"
      />
    </template>
  </DemoFrame>
</template>

<style scoped>
.ms2-split {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr));
  gap: 20px;
  padding: 20px;
}
.ms2-pane {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.ms2-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.ms2-note {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--prose);
}

/* Граф рядами сверху вниз: источники, производные, эффект. */
.ms2-graph {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 14px;
  border-radius: var(--r2);
  background: var(--surface-2);
}
.ms2-row {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 14px;
}
.ms2-node {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  min-width: 72px;
  padding: 8px 12px;
  border-radius: var(--r2);
  background: var(--surface);
  box-shadow: var(--shadow-1);
}
.ms2-node[data-source='yes'] {
  box-shadow: inset 0 2px 0 var(--tone-info-line), var(--shadow-1);
}
.ms2-node__name {
  font-family: var(--mono);
  font-size: var(--fs-3);
  font-weight: 600;
  color: var(--ink);
}
.ms2-node__meta {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}
.ms2-node__meta[data-diff='yes'] {
  padding: 1px 6px;
  border-radius: var(--r-full);
  background: var(--tone-warn-chip);
  color: var(--tone-warn-text);
}

.ms2-glitch {
  align-self: flex-start;
  padding: 3px 8px;
  border-radius: var(--r-full);
  background: var(--tone-ok-chip);
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--tone-ok-text);
}
.ms2-glitch[data-on='yes'] {
  background: var(--tone-err-chip);
  color: var(--tone-err-text);
}
</style>
