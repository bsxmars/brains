<script setup lang="ts">
/**
 * «Канарейка по шагам»: доля новой версии, сценарий и поток виртуальных пользователей.
 *
 * Ничего не считает сам. Кто в какой версии, накопленные числа и решение анализа даёт
 * модель темы — строки `MODEL_PARTS`, собранные `new Function` (`model/run.ts`). Те же
 * строки исполняет тест, поэтому демо не знает больше проверенного кода.
 *
 * Поток синтетический и с сидом: список накопленных минут однозначно задаёт числа,
 * поэтому состояние компонента — только этот список, а поток проигрывается заново.
 * В `setup` дорогого нет: до первого нажатия минут ноль, а план считается по кнопке.
 */
import { computed, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button, SegmentedControl } from '@/shared/ui';
import { loadModel, replay, router } from '../model/run';
import type { Minute, Mode, PlanResult, PlanRow, Step, Verdict } from '../model/types';

interface ScenarioProp {
  id: string;
  label: string;
  baseErr: number;
  nextErr: number;
  nextSlow: number;
}

const props = defineProps<{
  parts: string[];
  scenarios: ScenarioProp[];
  steps: Step[];
  salt: string;
  flagKey: string;
  labels: Record<Verdict | 'hold', string>;
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const model = loadModel(props.parts);
const keys = { salt: props.salt, flag: props.flagKey };

const MAX_MINUTES = 30;
const GRID = Array.from({ length: 400 }, (_, i) => `u${i}`);

const scenarioId = ref(props.scenarios[1]?.id ?? props.scenarios[0].id);
const mode = ref<Mode>('canary');
const weight = ref(5);
const prevWeight = ref(5);
const killed = ref(false);
const minutes = ref<Minute[]>([]);
const plan = ref<PlanResult | null>(null);

const MODES = [
  { value: 'canary', label: 'канарейка' },
  { value: 'flag', label: 'флаг функции' },
];
const scenarioOptions = computed(() => props.scenarios.map((s) => ({ value: s.id, label: s.label })));
const scenario = computed(() => props.scenarios.find((s) => s.id === scenarioId.value) ?? props.scenarios[0]);

// Смена сценария или режима начинает поток заново: числа прошлого потока к новому не относятся.
watch([scenarioId, mode], () => {
  minutes.value = [];
  plan.value = null;
  killed.value = false;
  prevWeight.value = weight.value;
  committed = weight.value;
});
// «Добавились при последнем повышении» считается от прошлой зафиксированной доли:
// во время перетаскивания ползунок шлёт `input` на каждый процент, а `change` — один раз.
let committed = weight.value;
function commit() {
  prevWeight.value = committed;
  committed = weight.value;
}

const route = computed(() => router(model, mode.value, keys, weight.value, killed.value));
const prevRoute = computed(() => router(model, mode.value, keys, prevWeight.value, killed.value));

const dots = computed(() =>
  GRID.map((id) => {
    const inNext = route.value(id) === 'next';
    return { id, inNext, joined: inNext && prevRoute.value(id) !== 'next' };
  }),
);
const inCount = computed(() => dots.value.filter((d) => d.inNext).length);
const joinedCount = computed(() => dots.value.filter((d) => d.joined).length);

const run = computed(() => replay(model, scenario.value, mode.value, keys, minutes.value));
const last = computed(() => run.value.log.at(-1)?.decision ?? null);

function add(count: number) {
  const room = MAX_MINUTES - minutes.value.length;
  const next = Array.from({ length: Math.min(count, room) }, () => ({ weight: weight.value, killed: killed.value }));
  minutes.value = [...minutes.value, ...next];
}
function reset() {
  minutes.value = [];
}
function toggleKill() {
  killed.value = !killed.value;
  prevWeight.value = weight.value;
}
const planLabel = model
  .stagesOf(props.steps)
  .map((s) => `${s.weight}%`)
  .join(' → ');

function runPlan() {
  plan.value = model.runPlan(props.steps, scenario.value, { salt: props.salt });
}

const names = computed(() =>
  mode.value === 'flag' ? { base: 'функция выключена', next: 'функция включена' } : { base: 'v1 · база', next: 'v2 · канарейка' },
);

const pct = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(2)}%` : '—');
const ms = (x: number) => (Number.isFinite(x) ? `${Math.round(x)} мс` : '—');
const range = (lo: number, hi: number, f: (x: number) => string) => `${f(lo)} … ${f(hi)}`;

interface Row {
  k: string;
  base: string;
  next: string;
}

const rows = computed<Row[]>(() => {
  const { base, next } = run.value.stats;
  const d = last.value;
  const baseRate = base.n ? base.errors / base.n : NaN;
  return [
    { k: 'запросов', base: String(base.n), next: String(next.n) },
    { k: 'ошибок', base: String(base.errors), next: String(next.errors) },
    { k: 'доля ошибок', base: pct(baseRate), next: pct(next.n ? next.errors / next.n : NaN) },
    {
      k: 'интервал Уилсона',
      base: '—',
      next: d && next.n ? range(d.errors.ci.lo, d.errors.ci.hi, pct) : '—',
    },
    { k: 'p95', base: d ? ms(d.latency.base) : '—', next: d ? ms(d.latency.ci.v) : '—' },
    { k: 'интервал p95', base: '—', next: d ? range(d.latency.ci.lo, d.latency.ci.hi, ms) : '—' },
  ];
});

const verdicts = computed(() => {
  const d = last.value;
  if (!d) return [];
  return [
    {
      k: 'доля ошибок',
      verdict: d.errors.verdict,
      note: `предел ${pct(d.errors.limit)}${d.errors.why ? ` · ${d.errors.why}` : ''}`,
    },
    {
      k: 'p95',
      verdict: d.latency.verdict,
      note: `предел ${ms(d.latency.limit)}${d.latency.why ? ` · ${d.latency.why}` : ''}`,
    },
  ];
});

const logTail = computed(() => run.value.log.slice(-8).reverse());

function planWhy(row: PlanRow): string {
  const d = row.decision;
  if (!d) return row.why ?? '';
  if (row.verdict === 'rollback') {
    return [d.errors.verdict === 'rollback' ? 'доля ошибок' : '', d.latency.verdict === 'rollback' ? 'p95' : '']
      .filter(Boolean)
      .join(' и ') + ' хуже базы';
  }
  if (row.verdict === 'hold') return d.errors.why || d.latency.why;
  return 'обе метрики не хуже базы';
}

const outcomeLabel = computed(() => {
  const o = plan.value?.outcome;
  if (o === 'promoted') return 'выкачена целиком';
  if (o === 'rolledBack') return 'откачена';
  if (o === 'hold') return 'остановлена: данных не хватило';
  return '';
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="pd-controls">
        <SegmentedControl v-model="scenarioId" class="l-pills" label="Сценарий" :options="scenarioOptions" />
        <SegmentedControl v-model="mode" class="l-pills" label="Чем управляем" :options="MODES" />
        <div class="pd-slider">
          <label class="pd-label" for="pd-weight">{{ mode === 'flag' ? 'раскатка флага' : 'доля канарейки' }}</label>
          <input
            id="pd-weight"
            v-model.number="weight"
            class="pd-range"
            type="range"
            min="0"
            max="100"
            step="1"
            @change="commit()"
          />
          <output class="pd-value" for="pd-weight">{{ weight }}%</output>
        </div>
      </div>
    </template>

    <div class="pd-body">
      <div class="pd-split">
        <div class="pd-col">
          <span class="pd-label">
            первые 400 пользователей · в {{ mode === 'flag' ? 'функции' : 'v2' }}: {{ inCount }}
            <template v-if="joinedCount"> · только что добавились: {{ joinedCount }}</template>
          </span>
          <div class="pd-grid" role="img" :aria-label="`${inCount} из 400 пользователей в новой версии`">
            <span
              v-for="d in dots"
              :key="d.id"
              class="pd-dot"
              :class="{ 'pd-dot--in': d.inNext, 'pd-dot--joined': d.joined }"
              :title="d.id"
            />
          </div>
          <div class="pd-legend">
            <span><span class="pd-dot" /> {{ names.base }}</span>
            <span><span class="pd-dot pd-dot--in" /> {{ names.next }}</span>
            <span><span class="pd-dot pd-dot--in pd-dot--joined" /> добавились при последнем повышении</span>
          </div>

          <div v-if="mode === 'flag'" class="pd-kill" :data-killed="killed">
            <Button :variant="killed ? 'primary' : 'secondary'" @click="toggleKill()">
              {{ killed ? 'включить обратно' : 'выключатель: погасить функцию' }}
            </Button>
            <span class="pd-kill__text">
              {{
                killed
                  ? `функция погашена у всех; раскатка ${weight}% сохранена и вернёт её тем же людям`
                  : `код v2 у всех; функция включена по ключу «${flagKey}» у ${weight}%`
              }}
            </span>
          </div>
        </div>

        <div class="pd-col">
          <div class="pd-actions">
            <Button variant="primary" :disabled="minutes.length >= MAX_MINUTES" @click="add(1)">+1 минута</Button>
            <Button variant="secondary" :disabled="minutes.length >= MAX_MINUTES" @click="add(5)">+5 минут</Button>
            <Button v-if="minutes.length" variant="secondary" @click="reset()">сначала</Button>
            <span class="pd-label">минута {{ minutes.length }} из {{ MAX_MINUTES }} · 2000 запросов в минуту</span>
          </div>

          <div class="pd-scroll">
            <table class="pd-table">
              <thead>
                <tr>
                  <th />
                  <th>{{ names.base }}</th>
                  <th>{{ names.next }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in rows" :key="row.k">
                  <th scope="row">{{ row.k }}</th>
                  <td>{{ row.base }}</td>
                  <td>{{ row.next }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div v-if="last" class="pd-verdicts">
            <div class="pd-verdict pd-verdict--main" :data-verdict="last.verdict">
              решение: {{ labels[last.verdict] }}
            </div>
            <div v-for="v in verdicts" :key="v.k" class="pd-verdict" :data-verdict="v.verdict">
              {{ v.k }}: {{ labels[v.verdict] }} <span>· {{ v.note }}</span>
            </div>
          </div>
          <span v-else class="pd-label">данных пока нет — добавьте минуту</span>

          <ol v-if="logTail.length" class="pd-log">
            <li v-for="entry in logTail" :key="entry.minute" :data-verdict="entry.decision.verdict">
              мин {{ entry.minute }} · {{ entry.weight }}%{{ entry.killed ? ' · выключено' : '' }} ·
              {{ labels[entry.decision.verdict] }}
            </li>
          </ol>
        </div>
      </div>

      <div class="pd-plan">
        <div class="pd-actions">
          <Button variant="secondary" @click="runPlan()">прогнать план канарейки: {{ planLabel }}</Button>
          <span v-if="plan" class="pd-verdict" :data-verdict="plan.outcome === 'promoted' ? 'continue' : plan.outcome === 'rolledBack' ? 'rollback' : 'wait'">
            итог: {{ outcomeLabel }}
          </span>
        </div>
        <div v-if="plan" class="pd-scroll">
          <table class="pd-table">
            <thead>
              <tr>
                <th>доля</th>
                <th>минута</th>
                <th>сверх паузы</th>
                <th>запросов канарейке</th>
                <th>ошибок</th>
                <th>решение</th>
                <th>почему</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, i) in plan.rows" :key="i">
                <td>{{ row.weight }}%</td>
                <td>{{ row.minute }}</td>
                <td>{{ row.extra ?? '—' }}</td>
                <td>{{ row.canary?.n ?? '—' }}</td>
                <td>{{ row.canary?.errors ?? '—' }}</td>
                <td>
                  <span class="pd-verdict" :data-verdict="row.verdict === 'hold' ? 'wait' : row.verdict">{{ labels[row.verdict] }}</span>
                </td>
                <td>{{ planWhy(row) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <template #footer>
      <Md class="pd-caption" :text="caption" />
    </template>
  </DemoFrame>
</template>

<style scoped>
.pd-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 14px;
  align-items: center;
}
.pd-slider {
  display: flex;
  flex: 1 1 260px;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.pd-range {
  flex: 1 1 140px;
  min-width: 0;
  height: 4px;
  margin: 0;
  appearance: none;
  border-radius: var(--r-full);
  background: var(--surface-3);
  font: inherit;
  color: inherit;
}
.pd-range::-webkit-slider-thumb {
  appearance: none;
  width: 14px;
  height: 14px;
  border: 0;
  border-radius: var(--r-full);
  background: var(--accent);
  cursor: pointer;
}
.pd-range::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border: 0;
  border-radius: var(--r-full);
  background: var(--accent);
  cursor: pointer;
}
.pd-value {
  min-width: 5ch;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
}

.pd-body {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 20px;
  min-width: 0;
}
.pd-split {
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
  gap: 20px;
  align-items: start;
}
@media (max-width: 760px) {
  .pd-split {
    grid-template-columns: minmax(0, 1fr);
  }
}
.pd-col {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.pd-label {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}

.pd-grid {
  display: grid;
  grid-template-columns: repeat(20, minmax(0, 1fr));
  gap: 3px;
  max-width: 360px;
}
.pd-dot {
  display: inline-block;
  width: 100%;
  aspect-ratio: 1;
  border-radius: var(--r-full);
  background: var(--surface-3);
}
.pd-legend .pd-dot {
  width: 10px;
  height: 10px;
  vertical-align: -1px;
}
.pd-dot--in {
  background: var(--accent);
}
.pd-dot--joined {
  box-shadow: 0 0 0 2px var(--ink);
}
.pd-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  font-size: var(--fs-3);
  color: var(--text-muted);
}

.pd-kill {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  padding: 12px 14px;
  border-radius: var(--r2);
  background: var(--surface-2);
}
.pd-kill[data-killed='true'] {
  background: var(--tone-warn-bg);
}
.pd-kill__text {
  font-size: var(--fs-2);
  line-height: 1.5;
  color: var(--text-muted);
}

.pd-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 10px;
}

.pd-scroll {
  overflow-x: auto;
}
.pd-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--fs-2);
}
.pd-table th,
.pd-table td {
  padding: 6px 10px;
  border-bottom: 1px solid var(--divider);
  text-align: start;
  white-space: nowrap;
  color: var(--text);
}
.pd-table thead th,
.pd-table tbody th {
  font-weight: 500;
  color: var(--text-muted);
}
.pd-table td {
  font-family: var(--mono);
}

.pd-verdicts {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.pd-verdict {
  display: inline-block;
  align-self: flex-start;
  padding: 4px 10px;
  border-radius: var(--r-full);
  font-family: var(--mono);
  font-size: var(--fs-3);
  background: var(--surface-3);
  color: var(--chip-text);
}
.pd-verdict--main {
  font-size: var(--fs-2);
  font-weight: 600;
}
.pd-verdict[data-verdict='continue'] {
  background: var(--tone-ok-chip);
  color: var(--tone-ok-text);
}
.pd-verdict[data-verdict='wait'] {
  background: var(--tone-warn-chip);
  color: var(--tone-warn-text);
}
.pd-verdict[data-verdict='rollback'] {
  background: var(--tone-err-chip);
  color: var(--tone-err-text);
}

.pd-log {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-muted);
}
.pd-log li[data-verdict='rollback'] {
  color: var(--tone-err-text);
}
.pd-log li[data-verdict='continue'] {
  color: var(--tone-ok-text);
}

.pd-plan {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 16px;
  border-top: 1px solid var(--divider);
}

.pd-caption {
  font-size: var(--fs-2);
  line-height: 1.55;
  color: var(--text-muted);
}
.pd-caption :deep(code) {
  font-family: var(--mono);
  /* Не ниже ступени `--fs-2`: в подписи на `--fs-2` доля .92em давала 10.9px. */
  font-size: max(0.92em, var(--fs-2));
}
</style>
