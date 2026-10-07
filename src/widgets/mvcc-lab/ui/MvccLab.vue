<script setup lang="ts">
/**
 * «Два сеанса по шагам»: сценарий аномалии, уровень изоляции, шаги сеансов A и B, состояние
 * каждого сеанса (номер транзакции, снимок) и все версии строк с `xmin`/`xmax` — кому какая видна.
 *
 * Считает не компонент, а учебная модель — строки `ENGINE_CODE`, `SNAPSHOT_CODE`, `WRITE_CODE`,
 * `SSI_CODE` из темы, собранные `new Function` (`model/run.ts`). Состояние на шаге k — прогон
 * модели с нуля до шага k. Те же строки напечатаны в теме, а `tests/unit/transactions.test.ts`
 * сверяет каждый их шаг с выводом двух настоящих сеансов Postgres.
 */
import { computed, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import StepToolbar from '@/shared/ui/StepToolbar.vue';
import { SegmentedControl } from '@/shared/ui';
import { finalOf, formatStep, loadModel } from '../model/run';
import type { Level, Scenario, SessionName, StepRecord, Tx, Version } from '../model/types';

const props = defineProps<{
  parts: string[];
  scenarios: Scenario[];
  levels: { value: Level; label: string; sql: string }[];
  groups: { value: Scenario['group']; label: string }[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const model = loadModel(props.parts);

const group = ref(props.groups[0].value);
const groupOptions = props.groups.map((g) => ({ value: g.value, label: g.label }));
const inGroup = computed(() => props.scenarios.filter((s) => s.group === group.value));
const picked = ref(props.scenarios[0].id);
watch(group, () => {
  picked.value = inGroup.value[0].id;
});
const scenarioOptions = computed(() => inGroup.value.map((s) => ({ value: s.id, label: s.label })));
const scenario = computed(() => props.scenarios.find((s) => s.id === picked.value) ?? props.scenarios[0]);

const level = ref<Level>(props.levels[0].value);
const levelOptions = props.levels.map((l) => ({ value: l.value, label: l.label }));
const levelSql = computed(() => props.levels.find((l) => l.value === level.value)?.sql ?? '');

/** Сколько шагов выполнено: 0 — ничего, `steps.length` — всё. */
const index = ref(0);
watch([scenario, level], () => {
  index.value = 0;
});
const total = computed(() => scenario.value.steps.length);
const counter = computed(() => `шаг ${index.value} из ${total.value}`);
const atStart = computed(() => index.value === 0);
const atEnd = computed(() => index.value === total.value);

const run = computed(() => model.runSchedule(structuredClone(scenario.value.rows), scenario.value.steps, level.value, index.value));
const final = computed(() => (atEnd.value ? finalOf(model, scenario.value, level.value) : ''));

const sqlOf = (sql: string) => sql.replace('{level}', levelSql.value);

/** Ответ шага так, как его видно сейчас: шаг, который ещё стоит на блокировке, — «ждёт». */
function answer(rec: StepRecord | undefined) {
  if (!rec) return { text: '', tone: 'none' };
  if (rec.waited && rec.until === null) return { text: 'ждёт блокировку…', tone: 'warn' };
  return { text: formatStep(rec), tone: rec.error ? 'err' : rec.waited ? 'warn' : 'ok' };
}

const rows = computed(() =>
  scenario.value.steps.map((s, i) => ({
    i,
    s: s.s,
    sql: sqlOf(s.sql),
    done: i < index.value,
    next: i === index.value,
    ...answer(run.value.out[i]),
  })),
);

const owner = (xid: number | null) => {
  if (xid === null) return '';
  if (xid === 100) return '100 · начальная';
  const tx = run.value.db.txs.find((t) => t.xid === xid);
  return tx ? `${xid} · ${tx.name}` : String(xid);
};

const STATE: Record<Tx['state'], string> = {
  active: 'идёт',
  committed: 'закоммичена',
  aborted: 'сломана ошибкой, ждёт ROLLBACK',
};

/** Транзакция сеанса, а если её нет — пустая: так видит строки новый запрос вне BEGIN. */
function viewer(name: SessionName): { tx: Tx; fresh: boolean } {
  const tx = run.value.sessions[name].tx;
  if (tx && tx.snap) return { tx, fresh: false };
  const blank: Tx = { name, level: 'read committed', state: 'active', xid: tx?.xid ?? null, snap: null, snapAt: null, doneAt: null, reads: [], writes: [] };
  blank.snap = model.takeSnapshot(run.value.db);
  return { tx: blank, fresh: true };
}

const snapText = (tx: Tx) => (tx.snap ? `${tx.snap.xmin}:${tx.snap.xmax}:${tx.snap.xip.join(',')}` : '—');

const sessions = computed(() =>
  (['A', 'B'] as SessionName[]).map((name) => {
    const tx = run.value.sessions[name].tx;
    const v = viewer(name);
    return {
      name,
      state: tx ? STATE[tx.state] : 'вне транзакции',
      level: tx ? tx.level : '—',
      xid: tx ? (tx.xid === null ? 'ещё нет' : String(tx.xid)) : '—',
      snap: snapText(v.tx),
      snapLabel: v.fresh ? 'снимок нового запроса' : tx?.level === 'read committed' ? 'снимок последнего оператора' : 'снимок транзакции',
    };
  }),
);

const lockText = (v: Version) =>
  v.locks.length ? v.locks.map((l) => `FOR ${l.mode.toUpperCase()} · ${owner(l.xid)}`).join(', ') : '';

const versions = computed(() => {
  const db = run.value.db;
  const va = viewer('A');
  const vb = viewer('B');
  return db.versions.map((v, i) => ({
    i,
    key: String(v.row[scenario.value.key]),
    data: scenario.value.show.map((c) => `${c} = ${String(v.row[c])}`).join(', '),
    xmin: owner(v.xmin),
    xmax: v.xmax === null ? '—' : owner(v.xmax),
    locks: lockText(v),
    a: model.visible(db, va.tx, va.tx.snap!, v),
    b: model.visible(db, vb.tx, vb.tx.snap!, v),
  }));
});

const prev = () => {
  if (!atStart.value) index.value -= 1;
};
const next = () => {
  if (!atEnd.value) index.value += 1;
};
const reset = () => {
  index.value = 0;
};
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="mv-bar">
        <SegmentedControl v-model="group" class="l-pills" label="Группа" :options="groupOptions" />
        <SegmentedControl v-model="picked" class="l-pills" label="Сценарий" :options="scenarioOptions" />
        <SegmentedControl v-model="level" class="l-pills" label="Уровень" :options="levelOptions" />
      </div>
    </template>

    <div class="mv-body">
      <Md class="mv-note" :text="scenario.note" />

      <StepToolbar :counter="counter" :at-start="atStart" :at-end="atEnd" @prev="prev" @next="next" @reset="reset" />

      <div class="mv-scroll">
        <ol class="mv-steps" aria-label="Шаги двух сеансов">
          <li class="mv-steps__head" aria-hidden="true">
            <span />
            <span>сеанс A</span>
            <span>сеанс B</span>
          </li>
          <li v-for="r in rows" :key="r.i" class="mv-step" :data-done="r.done ? 'yes' : 'no'" :data-next="r.next ? 'yes' : 'no'">
            <span class="mv-step__n">{{ r.i + 1 }}</span>
            <div v-for="col in ['A', 'B']" :key="col" class="mv-step__cell">
              <template v-if="r.s === col">
                <code class="mv-sql">{{ r.sql }}</code>
                <span v-if="r.done" class="mv-answer" :data-tone="r.tone">{{ r.text }}</span>
              </template>
            </div>
          </li>
        </ol>
      </div>

      <div class="mv-sessions">
        <div v-for="s in sessions" :key="s.name" class="mv-session">
          <span class="mv-label">сеанс {{ s.name }}</span>
          <dl class="mv-dl">
            <dt>транзакция</dt>
            <dd>{{ s.state }}</dd>
            <dt>уровень</dt>
            <dd>{{ s.level }}</dd>
            <dt>номер (xid)</dt>
            <dd>
              <code>{{ s.xid }}</code>
            </dd>
            <dt>{{ s.snapLabel }}</dt>
            <dd>
              <code>{{ s.snap }}</code>
            </dd>
          </dl>
        </div>
      </div>

      <div class="mv-scroll">
        <table class="mv-table">
          <caption class="mv-label">
            версии строк таблицы {{ scenario.table }}
          </caption>
          <thead>
            <tr>
              <th>{{ scenario.key }}</th>
              <th>данные</th>
              <th>xmin</th>
              <th>xmax</th>
              <th>блокировки</th>
              <th>видит A</th>
              <th>видит B</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="v in versions" :key="v.i" :data-live="v.a || v.b ? 'yes' : 'no'">
              <td><code>{{ v.key }}</code></td>
              <td><code>{{ v.data }}</code></td>
              <td><code>{{ v.xmin }}</code></td>
              <td><code>{{ v.xmax }}</code></td>
              <td class="mv-locks">{{ v.locks }}</td>
              <td :data-yes="v.a ? 'yes' : 'no'">{{ v.a ? 'да' : 'нет' }}</td>
              <td :data-yes="v.b ? 'yes' : 'no'">{{ v.b ? 'да' : 'нет' }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="atEnd" class="mv-verdict">
        <span class="mv-label">итог · {{ scenario.check.sql }} → {{ final }}</span>
        <Md class="mv-note" :text="scenario.verdict[level]" />
      </div>

      <Md class="mv-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.mv-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 16px;
}
.mv-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.mv-note,
.mv-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.mv-body :deep(code),
.mv-body code {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
.mv-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
  text-align: left;
}

.mv-scroll {
  max-width: 100%;
  overflow-x: auto;
}

.mv-steps {
  margin: 0;
  padding: 0;
  list-style: none;
  min-width: 620px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.mv-steps__head,
.mv-step {
  display: grid;
  grid-template-columns: 2.2em minmax(0, 1fr) minmax(0, 1fr);
  gap: 8px;
  align-items: start;
}
.mv-steps__head {
  font-family: var(--mono);
  font-size: var(--fs-2);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}
.mv-step {
  padding: 6px 8px;
  border-radius: var(--r2);
  background: var(--surface-2);
  color: var(--text-muted);
}
.mv-step[data-done='yes'] {
  color: var(--prose);
}
.mv-step[data-next='yes'] {
  box-shadow: inset 0 0 0 1px var(--tone-info-line);
  background: var(--tone-info-bg);
}
.mv-step__n {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
  padding-top: 2px;
}
.mv-step__cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.mv-sql {
  color: var(--ink);
  overflow-wrap: anywhere;
}
.mv-answer {
  font-family: var(--mono);
  font-size: var(--fs-2);
  overflow-wrap: anywhere;
  padding: 2px 6px;
  border-radius: var(--r1);
  align-self: flex-start;
}
.mv-answer[data-tone='ok'] {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.mv-answer[data-tone='warn'] {
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.mv-answer[data-tone='err'] {
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}

.mv-sessions {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;
}
.mv-session {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.mv-dl {
  margin: 0;
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
  gap: 4px 12px;
  font-size: var(--fs-3);
  color: var(--prose);
}
.mv-dl dt {
  color: var(--text-muted);
}
.mv-dl dd {
  margin: 0;
}
.mv-dl dd code {
  white-space: nowrap;
}

.mv-table {
  width: 100%;
  min-width: 640px;
  border-collapse: collapse;
  font-size: var(--fs-3);
  color: var(--prose);
}
.mv-table caption {
  padding-bottom: 8px;
}
.mv-table th {
  font-family: var(--mono);
  font-size: var(--fs-2);
  font-weight: 500;
  text-align: left;
  color: var(--text-muted);
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
}
.mv-table td {
  padding: 6px 8px;
  border-bottom: 1px solid var(--hairline);
  vertical-align: top;
}
.mv-table tr[data-live='no'] td {
  background: var(--surface-2);
}
.mv-table td[data-yes='yes'] {
  color: var(--tone-ok-text);
  font-weight: 600;
}
.mv-table td[data-yes='no'] {
  color: var(--text-muted);
}
.mv-locks {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--tone-warn-text);
}

.mv-verdict {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 16px;
  border-radius: var(--r3);
  background: var(--tone-info-bg);
  box-shadow: inset 0 0 0 1px var(--tone-info-line);
}
</style>
