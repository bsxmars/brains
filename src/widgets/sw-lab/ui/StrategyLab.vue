<script setup lang="ts">
/**
 * «Три стратегии на одном сценарии»: шаги (запрос страницы, новые данные на сервере, нет сети)
 * и что получила страница — по модели и в Chromium.
 *
 * Ответы считают строки темы: `STRATEGY_CODE` (сами стратегии) и `REPLAY_CODE` (сервер и кеш
 * в миниатюре), собранные `new Function` (`model/run.ts`). Прогон асинхронный — `Response`
 * читается промисом, — поэтому считается после монтирования, а ответ устаревшего прогона
 * отбрасывается по номеру. Столбец Chromium — литерал стенда; тест сверяет с ним модель.
 */
import { computed, onMounted, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { loadReplay, loadStrategies } from '../model/run';
import type { StrategyCase, StrategyLogEntry, StrategyStep } from '../model/types';

const props = defineProps<{
  strategyCode: string;
  replayCode: string;
  cases: StrategyCase[];
  steps: StrategyStep[];
  stepText: Record<StrategyStep, string>;
  /** Версия Chromium стенда — для подписи столбца. */
  chromium: string;
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const api = loadStrategies(props.strategyCode);
const replay = loadReplay(props.replayCode);

const picked = ref<string>(props.cases[0].id);
const options = props.cases.map((c) => ({ value: c.id, label: c.label }));
const current = computed(() => props.cases.find((c) => c.id === picked.value) ?? props.cases[0]);

const model = ref<StrategyLogEntry[] | null>(null);
const failed = ref('');
let ticket = 0;
async function compute() {
  const my = ++ticket;
  model.value = null;
  failed.value = '';
  try {
    const log = await replay(api[current.value.id], props.steps);
    if (my === ticket) model.value = log;
  } catch (e) {
    if (my === ticket) failed.value = `Прогон не удался: ${(e as Error).name}.`;
  }
}
onMounted(compute);
watch(picked, compute);

interface Row {
  key: number;
  text: string;
  get: boolean;
  model?: StrategyLogEntry;
  chromium?: StrategyLogEntry;
  same: boolean;
}

/** Строки таблицы: события сценария и запросы; у запроса — ответ модели и Chromium. */
const rows = computed<Row[]>(() => {
  let n = 0;
  return props.steps.map((s, key) => {
    if (s !== 'get') return { key, text: props.stepText[s], get: false, same: true };
    const m = model.value?.[n];
    const c = current.value.chromium[n];
    n += 1;
    return {
      key,
      text: `${props.stepText[s]} №${n}`,
      get: true,
      model: m,
      chromium: c,
      same: Boolean(m && c && m.got === c.got && m.hits === c.hits),
    };
  });
});

const allSame = computed(() => Boolean(model.value) && rows.value.every((r) => r.same));
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="picked" class="l-pills" label="Стратегия" :options="options" />
    </template>

    <div class="stl-body">
      <Md class="stl-note" :text="current.note" />

      <div class="stl-scroll">
        <table class="stl-table">
          <thead>
            <tr>
              <th scope="col">шаг</th>
              <th scope="col">модель: ответ</th>
              <th scope="col">запросов</th>
              <th scope="col">Chromium {{ chromium }}</th>
              <th scope="col">запросов</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.key" :data-get="r.get ? 'yes' : 'no'" :data-same="r.same ? 'yes' : 'no'">
              <th scope="row">{{ r.text }}</th>
              <template v-if="r.get">
                <td><code>{{ r.model?.got ?? '…' }}</code></td>
                <td>{{ r.model?.hits ?? '…' }}</td>
                <td><code>{{ r.chromium?.got }}</code></td>
                <td>{{ r.chromium?.hits }}</td>
              </template>
              <td v-else colspan="4" class="stl-event">—</td>
            </tr>
          </tbody>
        </table>
      </div>

      <span class="stl-verdict" :data-same="allSame ? 'yes' : 'no'">
        {{ failed || (model ? (allSame ? 'все ответы совпадают с Chromium' : 'есть расхождение с Chromium') : 'выполняется…') }}
      </span>

      <Md class="stl-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.stl-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
  min-width: 0;
}
.stl-note,
.stl-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.stl-note :deep(code),
.stl-caption :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
.stl-scroll {
  overflow-x: auto;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.stl-table {
  width: 100%;
  min-width: 560px;
  border-collapse: collapse;
  font-size: var(--fs-3);
  color: var(--prose);
}
.stl-table th,
.stl-table td {
  padding: 6px 12px;
  text-align: left;
  border-bottom: 1px solid var(--hairline);
}
.stl-table thead th {
  font-family: var(--mono);
  font-size: var(--fs-2);
  font-weight: 400;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.stl-table tbody th {
  font-weight: 400;
}
.stl-table tr[data-get='no'] th,
.stl-event {
  color: var(--text-muted);
}
.stl-table code {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
}
.stl-table tr[data-same='no'] {
  background: var(--tone-err-bg);
}
.stl-verdict {
  font-size: var(--fs-2);
  color: var(--tone-ok-text);
}
.stl-verdict[data-same='no'] {
  color: var(--text-muted);
}
</style>
