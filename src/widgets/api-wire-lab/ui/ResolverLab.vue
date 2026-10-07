<script setup lang="ts">
/**
 * «Резолверы и база»: один запрос GraphQL, журнал обращений к «базе» без загрузчика и с ним,
 * глубокий запрос, предел глубины и сбой сервиса.
 *
 * Считает учебный исполнитель `execute` с резолверами и загрузчиком из темы (`model/run.ts`).
 * `tests/unit/api-styles.test.ts` сверяет его с graphql 17 на тех же сценариях: ответ, порядок
 * вызовов резолверов и журнал «базы» совпадают.
 */
import { computed, onMounted, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { loadApi, runResolvers } from '../model/run';
import type { ApiCodes, ResolverRun, ResolverScenario, Tables } from '../model/types';

const props = defineProps<{
  codes: ApiCodes;
  tables: Tables;
  scenarios: ResolverScenario[];
  /** Тело функции от `db`, ломающее сервис пользователей, — `FAIL_CODE` темы. */
  failCode: string;
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const api = loadApi(props.codes);

const picked = ref(props.scenarios[0].id);
const scenarioOptions = props.scenarios.map((s) => ({ value: s.id, label: s.label }));
const loader = ref<'off' | 'on'>('off');
const loaderOptions = [
  { value: 'off', label: 'Без загрузчика' },
  { value: 'on', label: 'DataLoader' },
];

const scenario = computed(() => props.scenarios.find((s) => s.id === picked.value) ?? props.scenarios[0]);
const run = ref<ResolverRun | null>(null);
let ticket = 0;

async function recompute() {
  const my = ++ticket;
  const s = scenario.value;
  const out = await runResolvers(api, props.tables, {
    query: s.query,
    batch: loader.value === 'on',
    failCode: s.fail ? props.failCode : undefined,
    maxDepth: s.maxDepth,
  });
  if (my === ticket) run.value = out;
}

onMounted(recompute);
watch([picked, loader], recompute);

const stats = computed(() => [
  { k: 'вызовов резолверов', v: run.value?.calls.length ?? 0 },
  { k: 'обращений к базе', v: run.value?.journal.length ?? 0 },
  { k: 'ошибок в ответе', v: run.value?.result.errors?.length ?? 0 },
]);

const MAX_LINES = 16;
function clip(text: string) {
  const lines = text.split('\n');
  return lines.length > MAX_LINES ? `${lines.slice(0, MAX_LINES).join('\n')}\n… ещё ${lines.length - MAX_LINES} строк` : text;
}
const journal = computed(() => clip((run.value?.journal ?? []).join('\n') || '— ни одного обращения'));
const response = computed(() => clip(JSON.stringify(run.value?.result ?? {}, null, 2)));
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="rl-tools">
        <SegmentedControl v-model="picked" class="l-pills" label="Сценарий" :options="scenarioOptions" />
        <SegmentedControl v-model="loader" class="l-pills" label="Загрузка" :options="loaderOptions" />
      </div>
    </template>

    <div class="rl-body">
      <Md class="rl-note" :text="scenario.note" />

      <div class="rl-stats">
        <div v-for="s in stats" :key="s.k" class="rl-stat">
          <span class="rl-stat__v">{{ s.v }}</span>
          <span class="rl-stat__k">{{ s.k }}</span>
        </div>
      </div>

      <div class="rl-pane">
        <span class="rl-label">запрос</span>
        <pre class="rl-code rl-code--wrap">{{ scenario.query }}</pre>
      </div>

      <div class="rl-pair">
        <div class="rl-pane">
          <span class="rl-label">журнал базы</span>
          <pre class="rl-code">{{ journal }}</pre>
        </div>
        <div class="rl-pane">
          <span class="rl-label">ответ</span>
          <pre class="rl-code">{{ response }}</pre>
        </div>
      </div>

      <Md class="rl-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.rl-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 18px;
}
.rl-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.rl-note,
.rl-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.rl-note :deep(code),
.rl-caption :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
.rl-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px;
}
.rl-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.rl-stat__v {
  font-family: var(--mono);
  font-size: var(--fs-6);
  font-weight: 600;
  color: var(--ink);
}
.rl-stat__k {
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.rl-pair {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 760px) {
  .rl-pair {
    grid-template-columns: minmax(0, 1fr);
  }
}
.rl-pane {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.rl-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.rl-code {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.7;
  /* Подложка — общая для кода курса (`pre` в base.css, чернильная): цвет — «на чернилах». */
  color: var(--code-fg);
  white-space: pre;
  overflow-x: auto;
}
.rl-code--wrap {
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
