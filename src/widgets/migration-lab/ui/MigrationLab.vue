<script setup lang="ts">
/**
 * «План миграции по шагам»: на каждом шаге — операторы с их ценой, схема после шага и ответ
 * каждого запроса трёх версий кода.
 *
 * Ответы считает не компонент, а строка `COMPAT_CODE` из темы, собранная `new Function`
 * (`model/run.ts`): `check` по каждому запросу и `stepVerdict` по шагу. Та же строка напечатана
 * на странице, а `tests/unit/db-migrations.test.ts` сверяет её ответы с настоящим Postgres
 * (PGlite) на каждом шаге обоих планов. Цена операторов (блокировка, перезапись, проходы) —
 * литерал стенда из `data.ts`, его пересобирает тот же тест.
 */
import { computed, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import StepToolbar from '@/shared/ui/StepToolbar.vue';
import { SegmentedControl } from '@/shared/ui';
import { loadCompat } from '../model/run';
import type { CheckResult, MigrationPlan, PlanStatement, VersionId } from '../model/types';

const props = defineProps<{
  compatCode: string;
  plans: MigrationPlan[];
  versions: Record<VersionId, string[]>;
  table: string;
  /** Имя режима из `pg_locks` → имя в документации. */
  lockNames: Record<string, string>;
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const compat = loadCompat(props.compatCode);

const picked = ref(props.plans[0].id);
const options = props.plans.map((p) => ({ value: p.id, label: p.label }));
const plan = computed(() => props.plans.find((p) => p.id === picked.value) ?? props.plans[0]);

const index = ref(0);
watch(plan, () => {
  index.value = 0;
});
const step = computed(() => plan.value.steps[index.value]);
const prevStep = computed(() => (index.value > 0 ? plan.value.steps[index.value - 1] : null));

const counter = computed(() => `шаг ${index.value} из ${plan.value.steps.length - 1}`);
const atStart = computed(() => index.value === 0);
const atEnd = computed(() => index.value === plan.value.steps.length - 1);
const prev = () => {
  if (!atStart.value) index.value -= 1;
};
const next = () => {
  if (!atEnd.value) index.value += 1;
};
const reset = () => {
  index.value = 0;
};

const VERSION_IDS: VersionId[] = ['v1', 'v2', 'v3'];
type Role = 'live' | 'fallback' | 'idle';
const KIND = (sql: string) => sql.trim().split(/\s+/)[0].toUpperCase();

function errorText(r: NonNullable<CheckResult>): string {
  return r.code === '42703'
    ? `\`42703\` нет столбца \`${r.column}\``
    : `\`23502\` пуст обязательный \`${r.column}\``;
}

const rows = computed(() =>
  VERSION_IDS.map((v) => {
    const role: Role = step.value.live.includes(v) ? 'live' : step.value.fallback === v ? 'fallback' : 'idle';
    const results = props.versions[v].map((sql) => {
      const r = compat.check(step.value.schema, props.table, sql);
      return { kind: KIND(sql), ok: r === null, text: r ? errorText(r) : 'выполнится' };
    });
    return { v, role, results, ok: results.every((r) => r.ok) };
  }),
);

const ROLE_LABEL: Record<Role, string> = { live: 'работает', fallback: 'для отката', idle: 'не запущена' };

const verdict = computed(() => {
  const broken = compat.stepVerdict(step.value.schema, props.table, props.versions, step.value.live, step.value.fallback);
  if (!broken.length) {
    return step.value.fallback
      ? `Все работающие версии исправны, откат на \`${step.value.fallback}\` возможен.`
      : 'Все работающие версии исправны.';
  }
  return broken
    .map((b) =>
      b.fallback
        ? `Откат на \`${b.version}\` больше не спасёт: ${errorText(b.error)}.`
        : `\`${b.version}\` обслуживает запросы — и падает: ${errorText(b.error)}.`,
    )
    .join(' ');
});
const verdictTone = computed(() => {
  const broken = compat.stepVerdict(step.value.schema, props.table, props.versions, step.value.live, step.value.fallback);
  if (!broken.length) return 'ok';
  return broken.some((b) => !b.fallback) ? 'err' : 'warn';
});

/** Столбцы схемы с пометкой, что изменилось против прошлого шага. */
const columns = computed(() => {
  const now = step.value.schema;
  const before = prevStep.value?.schema ?? now;
  const out = Object.entries(now).map(([name, c]) => {
    const was = before[name];
    const change = !was ? 'added' : was.notNull !== c.notNull ? 'changed' : 'same';
    const flags = c.notNull ? (c.hasDefault ? 'NOT NULL, есть DEFAULT' : 'NOT NULL') : 'может быть NULL';
    return { name, flags, change };
  });
  for (const name of Object.keys(before)) {
    if (!(name in now)) out.push({ name, flags: 'удалён', change: 'removed' });
  }
  return out;
});

function costChips(st: PlanStatement) {
  const strong = st.cost.lock === 'AccessExclusiveLock';
  return [
    { text: props.lockNames[st.cost.lock] ?? st.cost.lock, tone: strong ? 'warn' : 'ok' },
    { text: st.cost.rewrite ? 'переписывает таблицу' : 'без перезаписи', tone: st.cost.rewrite ? 'err' : 'ok' },
    {
      text: st.cost.scans ? `проходов по таблице: ${st.cost.scans}` : 'таблицу не читает',
      tone: st.cost.scans && strong ? 'err' : st.cost.scans ? 'warn' : 'ok',
    },
  ];
}

const liveLine = computed(() => {
  const live = step.value.live.map((v) => `\`${v}\``).join(' и ');
  return step.value.fallback ? `Работают: ${live}. Откат — на \`${step.value.fallback}\`.` : `Работают: ${live}.`;
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="mg-bar">
        <SegmentedControl v-model="picked" class="l-pills" label="План" :options="options" />
        <StepToolbar :counter="counter" :at-start="atStart" :at-end="atEnd" @prev="prev" @next="next" @reset="reset" />
      </div>
    </template>

    <div class="mg-body">
      <Md class="mg-note" :text="plan.note" />

      <ol class="mg-steps" aria-label="Шаги плана">
        <li v-for="(s, i) in plan.steps" :key="s.id">
          <button
            type="button"
            class="mg-step"
            :data-on="i === index ? 'yes' : 'no'"
            :data-past="i < index ? 'yes' : 'no'"
            :aria-current="i === index ? 'step' : undefined"
            @click="index = i"
          >
            {{ s.label }}
          </button>
        </li>
      </ol>

      <div class="mg-step-card">
        <div class="mg-step-head">
          <span class="mg-step-title">{{ step.label }}</span>
          <Md class="mg-live" as="span" :text="liveLine" />
        </div>
        <Md class="mg-text" :text="step.text" />

        <div v-if="step.statements.length" class="mg-statements">
          <div v-for="(st, i) in step.statements" :key="i" class="mg-statement">
            <pre class="mg-sql">{{ st.sql }};</pre>
            <div class="mg-chips">
              <span v-for="(c, j) in costChips(st)" :key="j" class="mg-chip" :data-tone="c.tone">{{ c.text }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="mg-grid">
        <div class="mg-schema">
          <span class="mg-label">таблица {{ table }} после шага</span>
          <div v-for="c in columns" :key="c.name" class="mg-col" :data-change="c.change">
            <code class="mg-col__name">{{ c.name }}</code>
            <span class="mg-col__flags">{{ c.flags }}</span>
          </div>
        </div>

        <div class="mg-matrix" role="table" aria-label="Ответ каждого запроса на схеме после шага">
          <span class="mg-label">что ответит Postgres</span>
          <div v-for="r in rows" :key="r.v" class="mg-version" role="row" :data-role="r.role" :data-ok="r.ok ? 'yes' : 'no'">
            <div class="mg-version__head" role="rowheader">
              <code class="mg-version__id">{{ r.v }}</code>
              <span class="mg-version__role">{{ ROLE_LABEL[r.role] }}</span>
            </div>
            <div class="mg-results">
              <div v-for="(q, i) in r.results" :key="i" class="mg-result" role="cell" :data-ok="q.ok ? 'yes' : 'no'">
                <span class="mg-result__kind">{{ q.kind }}</span>
                <Md class="mg-result__text" as="span" :text="q.text" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <Md class="mg-verdict" :data-tone="verdictTone" :text="verdict" />

      <Md class="mg-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.mg-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.mg-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.mg-note,
.mg-caption,
.mg-text {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.mg-body :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}

.mg-steps {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.mg-step {
  font: inherit;
  font-size: var(--fs-2);
  color: var(--prose);
  padding: 5px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-full);
  background: var(--surface);
  cursor: pointer;
}
.mg-step[data-past='yes'] {
  background: var(--surface-2);
  color: var(--text-muted);
}
.mg-step[data-on='yes'] {
  background: var(--tone-info-bg);
  border-color: var(--tone-info-line);
  color: var(--tone-info-text);
  font-weight: 600;
}
.mg-step:focus-visible {
  outline: 2px solid var(--tone-info-line);
  outline-offset: 2px;
}

.mg-step-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.mg-step-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px 14px;
}
.mg-step-title {
  font-size: var(--fs-5);
  font-weight: 600;
  color: var(--ink);
}
.mg-live {
  font-size: var(--fs-3);
  color: var(--text-muted);
}

.mg-statements {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.mg-statement {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.mg-sql {
  margin: 0;
  padding: 10px 12px;
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.6;
  /* Подложка — общая для кода курса (`pre` чернильный): цвет «на чернилах». */
  color: var(--code-fg);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.mg-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.mg-chip {
  padding: 2px 9px;
  border-radius: var(--r-full);
  font-size: var(--fs-2);
  border: 1px solid transparent;
}
.mg-chip[data-tone='ok'] {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
  border-color: var(--tone-ok-line);
}
.mg-chip[data-tone='warn'] {
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
  border-color: var(--tone-warn-line);
}
.mg-chip[data-tone='err'] {
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
  border-color: var(--tone-err-line);
}

.mg-grid {
  display: grid;
  grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.6fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 760px) {
  .mg-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
.mg-label {
  display: block;
  margin-bottom: 4px;
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.mg-schema,
.mg-matrix {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.mg-col {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 4px 10px;
  padding: 6px 10px;
  border-radius: var(--r2);
  background: var(--surface-2);
  font-size: var(--fs-3);
  color: var(--prose);
  border-left: 3px solid transparent;
}
.mg-col__name {
  color: var(--ink);
  font-weight: 600;
}
.mg-col__flags {
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.mg-col[data-change='added'] {
  background: var(--tone-ok-bg);
  border-left-color: var(--tone-ok-line);
}
.mg-col[data-change='changed'] {
  background: var(--tone-warn-bg);
  border-left-color: var(--tone-warn-line);
}
.mg-col[data-change='removed'] {
  background: var(--tone-err-bg);
  border-left-color: var(--tone-err-line);
}
.mg-col[data-change='removed'] .mg-col__name {
  text-decoration: line-through;
}

.mg-version {
  display: grid;
  grid-template-columns: 7.5em minmax(0, 1fr);
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--r2);
  background: var(--surface-2);
}
@media (max-width: 520px) {
  .mg-version {
    grid-template-columns: minmax(0, 1fr);
  }
}
.mg-version[data-role='idle'] {
  background: var(--surface);
  box-shadow: inset 0 0 0 1px var(--hairline);
}
.mg-version__head {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.mg-version__id {
  align-self: flex-start;
  font-weight: 600;
  color: var(--ink);
}
.mg-version__role {
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.mg-version[data-role='live'] .mg-version__role {
  color: var(--tone-info-text);
  font-weight: 600;
}
.mg-results {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.mg-result {
  display: grid;
  grid-template-columns: 4.6em minmax(0, 1fr);
  gap: 8px;
  align-items: baseline;
  font-size: var(--fs-3);
  color: var(--prose);
}
.mg-result__kind {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.mg-result__text {
  overflow-wrap: anywhere;
}
.mg-result[data-ok='yes'] .mg-result__text {
  color: var(--tone-ok-text);
}
.mg-result[data-ok='no'] .mg-result__text {
  color: var(--tone-err-text);
}
.mg-version[data-role='idle'] .mg-result__text {
  color: var(--text-muted);
}

.mg-verdict {
  padding: 10px 14px;
  border-radius: var(--r2);
  font-size: var(--fs-3);
  line-height: 1.6;
  border-left: 3px solid transparent;
}
.mg-verdict[data-tone='ok'] {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
  border-left-color: var(--tone-ok-line);
}
.mg-verdict[data-tone='warn'] {
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
  border-left-color: var(--tone-warn-line);
}
.mg-verdict[data-tone='err'] {
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
  border-left-color: var(--tone-err-line);
}
</style>
