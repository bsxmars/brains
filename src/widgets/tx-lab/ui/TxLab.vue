<script setup lang="ts">
/**
 * «Жизнь транзакции»: сценарий построчно — в какой задаче выполняется строка, в каком состоянии
 * транзакция и что стоит в очереди запросов, — и три журнала одного сценария.
 *
 * Журнал и шаги считает не компонент, а строка `TX_MODEL_CODE` из темы, собранная `new Function`
 * (`model/run.ts`). Второй журнал — литерал стенда (Chromium). Третий снимается здесь же,
 * в браузере читателя, строкой `TX_HARNESS_CODE` — той же обвязкой, что исполняли стенд и тест;
 * вместо `/slow` стенда она получает `fetch` этой же страницы. Тест
 * `tests/unit/browser-storage.test.ts` сверяет модель с `fake-indexeddb` и с Chromium.
 *
 * Прогон в браузере асинхронный: ответ устаревшего прогона отбрасывается по номеру.
 */
import { computed, onMounted, ref, watch } from 'vue';
import CodeListing from '@/shared/ui/CodeListing.vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import StepToolbar from '@/shared/ui/StepToolbar.vue';
import { SegmentedControl } from '@/shared/ui';
import { loadHarness, loadModel, sameLog } from '../model/run';
import type { TxScenario } from '../model/types';

const props = defineProps<{
  modelCode: string;
  harnessCode: string;
  scenarios: TxScenario[];
  /** Версия Chromium стенда — для подписи журнала. */
  chromium: string;
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const simulate = loadModel(props.modelCode);
const runTx = loadHarness(props.harnessCode);

const picked = ref(props.scenarios[0].id);
const options = props.scenarios.map((s) => ({ value: s.id, label: s.label }));
const scenario = computed(() => props.scenarios.find((s) => s.id === picked.value) ?? props.scenarios[0]);

const result = computed(() => simulate(scenario.value.steps, scenario.value.initial));
const codeLines = computed(() => scenario.value.code.split('\n'));

const step = ref(0);
watch(picked, () => (step.value = 0));
const total = computed(() => result.value.trace.length);
const current = computed(() => result.value.trace[step.value]);

/** Подсвечена строка текущего шага; у событий базы строки нет — подсвечена последняя выполненная. */
const activeLine = computed(() => {
  for (let i = step.value; i >= 0; i--) {
    const line = result.value.trace[i].line;
    if (line !== null) return line;
  }
  return -1;
});

const STATE_TEXT: Record<string, string> = {
  active: 'активна',
  inactive: 'неактивна',
  committing: 'фиксируется',
  finished: 'завершена',
  '—': 'ещё нет',
};

const live = ref<string[] | null>(null);
const liveError = ref('');
let ticket = 0;
async function runLive() {
  const my = ++ticket;
  live.value = null;
  liveError.value = '';
  if (typeof indexedDB === 'undefined') {
    liveError.value = 'В этом окружении нет IndexedDB.';
    return;
  }
  const s = scenario.value;
  try {
    const log = await runTx(indexedDB, { id: s.id, initial: s.initial, code: s.code }, () =>
      fetch(location.href, { cache: 'no-store' }),
    );
    if (my === ticket) live.value = log;
  } catch (e) {
    if (my === ticket) liveError.value = `Прогон не удался: ${(e as Error).name}.`;
  }
}
onMounted(runLive);
watch(picked, runLive);

const logs = computed(() => {
  const m = result.value.log;
  const c = scenario.value.chromium;
  return [
    { k: 'модель', lines: m, same: true },
    { k: `Chromium ${props.chromium}`, lines: c, same: sameLog(c, m) },
    { k: 'ваш браузер', lines: live.value ?? [], same: live.value ? sameLog(live.value, m) : true, pending: !live.value },
  ];
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="picked" class="l-pills" label="Сценарий" :options="options" />
    </template>

    <div class="tx-body">
      <Md class="tx-note" :text="scenario.note" />

      <div class="tx-split">
        <CodeListing class="tx-code" :lines="codeLines" :active="activeLine" />

        <div class="tx-state" aria-live="polite">
          <span class="tx-label">{{ current?.where }}</span>
          <p class="tx-what">{{ current?.what }}</p>
          <div class="tx-row">
            <span class="tx-label">транзакция</span>
            <span class="tx-chip" :data-state="current?.state">{{ STATE_TEXT[current?.state ?? '—'] ?? current?.state }}</span>
          </div>
          <div class="tx-row">
            <span class="tx-label">ждут результата</span>
            <span v-if="!current?.queue.length" class="tx-empty">—</span>
            <code v-for="q in current?.queue ?? []" :key="q" class="tx-req">{{ q }}</code>
          </div>
        </div>
      </div>

      <StepToolbar
        :counter="`шаг ${step + 1} / ${total}`"
        :at-start="step === 0"
        :at-end="step >= total - 1"
        @prev="step = Math.max(0, step - 1)"
        @next="step = Math.min(total - 1, step + 1)"
        @reset="step = 0"
      />

      <div class="tx-logs">
        <div v-for="l in logs" :key="l.k" class="tx-log" :data-same="l.same ? 'yes' : 'no'">
          <span class="tx-label">{{ l.k }}</span>
          <ol v-if="!l.pending" class="tx-lines">
            <li v-for="(line, i) in l.lines" :key="i">{{ line }}</li>
          </ol>
          <span v-else class="tx-empty">{{ liveError || 'выполняется…' }}</span>
          <span v-if="!l.pending && l.k !== 'модель'" class="tx-verdict">{{ l.same ? 'совпадает с моделью' : 'расходится с моделью' }}</span>
        </div>
      </div>

      <Md class="tx-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.tx-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.tx-note,
.tx-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.tx-note :deep(code),
.tx-caption :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}

.tx-split {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 760px) {
  .tx-split {
    grid-template-columns: minmax(0, 1fr);
  }
}
.tx-code {
  min-width: 0;
  padding: 10px 0;
  border-radius: var(--r3);
  background: var(--surface-2);
}

.tx-state,
.tx-log {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.tx-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.tx-what {
  margin: 0;
  font-size: var(--fs-3);
  line-height: 1.55;
  color: var(--prose);
  min-height: 3.1em;
}
.tx-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
}
.tx-chip,
.tx-req {
  padding: 2px 8px;
  border-radius: var(--r1);
  font-family: var(--mono);
  font-size: var(--fs-3);
}
.tx-chip[data-state='active'] {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.tx-chip[data-state='inactive'] {
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.tx-chip[data-state='committing'] {
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
}
.tx-chip[data-state='finished'],
.tx-chip[data-state='—'] {
  background: var(--surface-3);
  color: var(--text-muted);
}
.tx-req {
  background: var(--surface-3);
  color: var(--prose);
}
.tx-empty {
  font-size: var(--fs-3);
  color: var(--text-muted);
}

.tx-logs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
@media (max-width: 760px) {
  .tx-logs {
    grid-template-columns: minmax(0, 1fr);
  }
}
.tx-lines {
  margin: 0;
  padding-left: 1.6em;
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
  overflow-wrap: anywhere;
}
.tx-log[data-same='no'] {
  background: var(--tone-err-bg);
}
.tx-verdict {
  font-size: var(--fs-2);
  color: var(--tone-ok-text);
}
.tx-log[data-same='no'] .tx-verdict {
  color: var(--tone-err-text);
}
</style>
