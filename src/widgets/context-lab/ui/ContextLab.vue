<script setup lang="ts">
/**
 * «Три запроса — три реализации»: один и тот же сценарий с тремя `ctx`, журнал построчно.
 *
 * Глобальная переменная (`GLOBAL_CODE`) и учебная обёртка (`MINI_CODE`) исполняются здесь,
 * в браузере, через `model/run.ts` — тем же кодом, что напечатан в теме и прогоняется
 * `tests/unit/async-context.test.ts`. Колонка `AsyncLocalStorage` — журнал из `LOGS`: в браузере
 * ALS нет, а тест сверяет литерал с настоящим ALS в Node 24 (в обоих режимах).
 *
 * Прогоны идут строго по одному: обёртка на время сценария подменяет `then` и `setTimeout`
 * глобально, и два перекрывшихся прогона сняли бы подмену друг у друга.
 */
import { computed, onMounted, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { loadGlobal, loadMini, runMini, runScenario } from '../model/run';
import type { LogEntry, ModeId, Scenario } from '../model/types';

const props = defineProps<{
  scenarios: Scenario[];
  /** Журналы ALS по сценариям — из Node, см. `LOGS` темы. */
  alsLogs: Record<string, LogEntry[]>;
  globalCode: string;
  miniCode: string;
  sleepCode: string;
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const mini = loadMini(props.miniCode);

const picked = ref(props.scenarios[0].id);
const options = props.scenarios.map((s) => ({ value: s.id, label: s.label }));
const scenario = computed(() => props.scenarios.find((s) => s.id === picked.value) ?? props.scenarios[0]);

const live = ref<{ id: string; global: LogEntry[]; mini: LogEntry[] } | null>(null);
const busy = ref(false);
const failed = ref('');

let queue: Promise<void> = Promise.resolve();

function rerun() {
  const s = scenario.value;
  busy.value = true;
  queue = queue.then(async () => {
    try {
      const global = await runScenario(s.code, props.sleepCode, loadGlobal(props.globalCode));
      const own = await runMini(s.code, props.sleepCode, mini);
      if (picked.value === s.id) live.value = { id: s.id, global, mini: own };
      failed.value = '';
    } catch (e) {
      failed.value = e instanceof Error ? e.message : String(e);
    } finally {
      if (picked.value === s.id) busy.value = false;
    }
  });
}

onMounted(rerun);
watch(picked, rerun);

const MODES: { id: ModeId; label: string }[] = [
  { id: 'global', label: 'глобальная переменная' },
  { id: 'als', label: 'ALS · Node 24' },
  { id: 'mini', label: 'учебная обёртка' },
];

const key = (e: LogEntry) => `${e.who}:${e.what}`;

interface Row {
  n: number;
  who: string;
  what: string;
  seen: Record<ModeId, string | null | undefined>;
}

/** Строки — в порядке журнала ALS; две другие колонки находятся по ключу «кто: что». */
const rows = computed<Row[]>(() => {
  const als = props.alsLogs[scenario.value.id] ?? [];
  const cur = live.value?.id === scenario.value.id ? live.value : null;
  const g = new Map(cur?.global.map((e) => [key(e), e.seen]));
  const m = new Map(cur?.mini.map((e) => [key(e), e.seen]));
  return als.map((e, i) => ({
    n: i + 1,
    who: e.who,
    what: e.what,
    seen: { als: e.seen, global: cur ? g.get(key(e)) : undefined, mini: cur ? m.get(key(e)) : undefined },
  }));
});

const totals = computed(() =>
  Object.fromEntries(
    MODES.map((mode) => {
      const ready = rows.value.filter((r) => r.seen[mode.id] !== undefined);
      const ok = ready.filter((r) => r.seen[mode.id] === r.who).length;
      return [mode.id, ready.length ? `${ok} из ${rows.value.length}` : '…'];
    }),
  ) as Record<ModeId, string>,
);

function tone(row: Row, mode: ModeId): 'ok' | 'err' | 'warn' | 'wait' {
  const v = row.seen[mode];
  if (v === undefined) return 'wait';
  if (v === null) return 'warn';
  return v === row.who ? 'ok' : 'err';
}

const shown = (v: string | null | undefined) => (v === undefined ? '…' : v === null ? 'пусто' : v);
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="picked" class="l-pills" label="Сценарий" :options="options" />
    </template>

    <div class="cx-body">
      <Md class="cx-note" :text="scenario.note" />

      <div class="cx-split">
        <div class="cx-pane">
          <span class="cx-label">сценарий</span>
          <pre class="cx-code">{{ scenario.code }}</pre>
        </div>

        <div class="cx-pane cx-pane--log">
          <span class="cx-label">какой id видит каждый log(){{ busy ? ' · идёт…' : '' }}</span>
          <div class="cx-scroll">
            <table class="cx-table">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">запрос · событие</th>
                  <th v-for="mode in MODES" :key="mode.id" scope="col">{{ mode.label }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in rows" :key="row.n">
                  <td class="cx-n">{{ row.n }}</td>
                  <td>
                    <span class="cx-who" :data-who="row.who">{{ row.who }}</span>
                    {{ row.what }}
                  </td>
                  <td v-for="mode in MODES" :key="mode.id">
                    <span class="cx-seen" :data-tone="tone(row, mode.id)">{{ shown(row.seen[mode.id]) }}</span>
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <td />
                  <td>свой id</td>
                  <td v-for="mode in MODES" :key="mode.id" class="cx-total">{{ totals[mode.id] }}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p v-if="failed" class="cx-fail">{{ failed }}</p>
        </div>
      </div>

      <Md class="cx-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.cx-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.cx-note,
.cx-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.cx-note :deep(code),
.cx-caption :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}

.cx-split {
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 860px) {
  .cx-split {
    grid-template-columns: minmax(0, 1fr);
  }
}

.cx-pane {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.cx-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.cx-code {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.7;
  /* Подложка — общая для кода курса (`pre` в base.css, чернильная): цвет — «на чернилах». */
  color: var(--code-fg);
  white-space: pre;
  overflow-x: auto;
}

.cx-scroll {
  overflow-x: auto;
  min-width: 0;
}
.cx-table {
  width: 100%;
  min-width: 460px;
  border-collapse: collapse;
  font-size: var(--fs-3);
  color: var(--prose);
}
.cx-table th {
  padding: 6px 8px;
  font-family: var(--mono);
  font-size: var(--fs-2);
  font-weight: 500;
  letter-spacing: 0.03em;
  text-align: left;
  text-transform: uppercase;
  color: var(--text-muted);
  vertical-align: bottom;
}
.cx-table td {
  padding: 6px 8px;
  border-top: 1px solid var(--divider);
  vertical-align: baseline;
}
.cx-n {
  font-family: var(--mono);
  color: var(--text-muted);
}
.cx-who {
  display: inline-block;
  min-width: 1.6em;
  margin-right: 4px;
  padding: 0 5px;
  border-radius: var(--r2);
  background: var(--surface-3);
  font-family: var(--mono);
  font-weight: 600;
  text-align: center;
  color: var(--ink);
}
.cx-seen {
  display: inline-block;
  min-width: 2.2em;
  padding: 1px 7px;
  border-radius: var(--r2);
  border: 1px solid transparent;
  font-family: var(--mono);
  text-align: center;
}
.cx-seen[data-tone='ok'] {
  background: var(--tone-ok-bg);
  border-color: var(--tone-ok-line);
  color: var(--tone-ok-text);
}
.cx-seen[data-tone='err'] {
  background: var(--tone-err-bg);
  border-color: var(--tone-err-line);
  color: var(--tone-err-text);
  font-weight: 600;
}
.cx-seen[data-tone='warn'] {
  background: var(--tone-warn-bg);
  border-color: var(--tone-warn-line);
  color: var(--tone-warn-text);
}
.cx-seen[data-tone='wait'] {
  color: var(--text-muted);
}
.cx-total {
  font-family: var(--mono);
  font-weight: 600;
  color: var(--ink);
}
.cx-table tfoot td {
  border-top: 2px solid var(--divider);
}
.cx-fail {
  margin: 0;
  font-size: var(--fs-3);
  color: var(--tone-err-text);
}
</style>
