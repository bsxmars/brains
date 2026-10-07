<script setup lang="ts">
/**
 * «Кванты на шкале»: сценарий работ разных приоритетов, прогнанный мини-планировщиком темы
 * на виртуальных часах, — полосы кусков, начала квантов и журнал.
 *
 * Считают строки `HEAP_CODE`, `SCHED_CODE`, `HOST_CODE`, `JOB_CODE` и `SCENARIO_CODE`
 * из темы, собранные `new Function` (`model/run.ts`). `tests/unit/schedulers.test.ts`
 * прогоняет тот же `SCENARIO_CODE` настоящим пакетом `scheduler` 0.28 на тех же часах и
 * сверяет журналы дословно. Компонент только рисует журнал.
 */
import { computed, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { loadMiniScheduler, loadRunner, toSlices } from '../model/run';
import type { Job, Priority, SchedScenario, SliceEntry } from '../model/types';

const props = defineProps<{
  heapCode: string;
  schedCode: string;
  hostCode: string;
  jobCode: string;
  scenarioCode: string;
  scenarios: SchedScenario[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const runScenario = loadRunner(
  props.hostCode,
  props.jobCode,
  props.scenarioCode,
  loadMiniScheduler(props.heapCode, props.schedCode),
);

const PRIORITY_NAME: Record<Priority, string> = { 1: 'Immediate', 2: 'UserBlocking', 3: 'Normal', 4: 'Low', 5: 'Idle' };
const TONES = ['info', 'warn', 'ok', 'err'] as const;

const picked = ref(props.scenarios[0].id);
const options = props.scenarios.map((s) => ({ value: s.id, label: s.label }));
const scenario = computed(() => props.scenarios.find((s) => s.id === picked.value) ?? props.scenarios[0]);

const initialPick = (s: SchedScenario) => String(s.jobs.find((j) => j.name === s.pickPriorityOf)?.priority ?? 2);
const pickedPriority = ref(initialPick(props.scenarios[0]));
const priorityOptions = ([1, 2, 3, 4, 5] as Priority[]).map((p) => ({ value: String(p), label: PRIORITY_NAME[p] }));
watch(scenario, (s) => {
  pickedPriority.value = initialPick(s);
});

const jobs = computed<Job[]>(() =>
  scenario.value.jobs.map((j) =>
    j.name === scenario.value.pickPriorityOf ? { ...j, priority: Number(pickedPriority.value) as Priority } : j,
  ),
);
const log = computed<SliceEntry[]>(() => toSlices(runScenario(jobs.value)));

/** Длина куска: у работы сценария с этим именем. Одноимённые работы одинаковы по кускам. */
const unitOf = (e: SliceEntry) => jobs.value.find((j) => j.name === e.name)?.units[e.part] ?? 0;

const lanes = computed(() => {
  const names: string[] = [];
  for (const j of jobs.value) if (!names.includes(j.name)) names.push(j.name);
  return names.map((name, i) => {
    const job = jobs.value.find((j) => j.name === name)!;
    return { name, tone: TONES[i % TONES.length], priority: PRIORITY_NAME[job.priority] };
  });
});

const end = computed(() => Math.max(1, ...log.value.map((e) => e.t + unitOf(e))));
const PLOT = 600;
const LEFT = 160;
const LANE = 30;
const scale = computed(() => Math.min(30, PLOT / end.value));
const width = computed(() => LEFT + end.value * scale.value + 20);
const height = computed(() => 16 + lanes.value.length * LANE + 30);
const x = (t: number) => LEFT + t * scale.value;
const laneY = (name: string) => 16 + lanes.value.findIndex((l) => l.name === name) * LANE;
const toneOf = (name: string) => lanes.value.find((l) => l.name === name)?.tone ?? 'info';

/** Моменты появления работ (`at`) — пока их немного. */
const arrivals = computed(() =>
  jobs.value.length > 12 ? [] : jobs.value.filter((j) => (j.at ?? 0) > 0).map((j, key) => ({ key, name: j.name, t: j.at ?? 0 })),
);

const slices = computed(() => {
  const starts: { slice: number; t: number }[] = [];
  for (const e of log.value) if (!starts.some((s) => s.slice === e.slice)) starts.push({ slice: e.slice, t: e.t });
  return starts;
});
/** Черты квантов рисуются, пока их можно различить глазом. */
const showSliceLines = computed(() => slices.value.length <= 80);

const ticks = computed(() => {
  const raw = end.value / 6;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const stepMs = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let t = 0; t <= end.value; t += stepMs) out.push(t);
  return out;
});

const summary = computed(() =>
  lanes.value.map((l) => {
    const own = log.value.filter((e) => e.name === l.name);
    const last = own.at(-1);
    return {
      ...l,
      start: own[0]?.t ?? '—',
      finish: last ? last.t + unitOf(last) : '—',
      parts: own.length,
      slices: new Set(own.map((e) => e.slice)).size,
      late: own.filter((e) => e.didTimeout).length,
    };
  }),
);

/** Журнал: короткий — целиком, длинный — начало и окрестности редких работ. */
interface LogRow {
  gap: boolean;
  e: SliceEntry;
  skipped?: number;
}

const rows = computed<LogRow[]>(() => {
  const all = log.value;
  if (all.length <= 40) return all.map((e) => ({ gap: false, e }));
  const counts = new Map<string, number>();
  for (const e of all) counts.set(e.name, (counts.get(e.name) ?? 0) + 1);
  const keep = new Set<number>();
  for (let i = 0; i < 8; i++) keep.add(i);
  all.forEach((e, i) => {
    if ((counts.get(e.name) ?? 0) <= 5) for (let k = i - 3; k <= i + 3; k++) if (k >= 0 && k < all.length) keep.add(k);
  });
  keep.add(all.length - 1);
  const out: LogRow[] = [];
  let prevIdx = -1;
  [...keep]
    .sort((a, b) => a - b)
    .forEach((i) => {
      if (i - prevIdx > 1) out.push({ gap: true, e: all[i], skipped: i - prevIdx - 1 });
      out.push({ gap: false, e: all[i] });
      prevIdx = i;
    });
  return out;
});

const totals = computed(
  () => `Всего ${log.value.length} кусков в ${slices.value.length} квантах, работа кончилась на ${end.value}-й мс.`,
);
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="picked" class="l-pills" label="Сценарий" :options="options" />
    </template>

    <div class="sl-body">
      <Md class="sl-note" :text="scenario.note" />

      <div v-if="scenario.pickPriorityOf" class="sl-pick">
        <span class="sl-label">приоритет {{ scenario.pickPriorityOf }}</span>
        <SegmentedControl v-model="pickedPriority" class="l-pills" :label="`Приоритет ${scenario.pickPriorityOf}`" :options="priorityOptions" />
      </div>

      <div class="sl-chart">
        <svg :width="width" :height="height" :viewBox="`0 0 ${width} ${height}`" role="img" :aria-label="`Шкала: ${totals}`">
          <g v-for="l in lanes" :key="l.name">
            <text class="sl-lane" :x="8" :y="laneY(l.name) + 18">{{ l.name }} · {{ l.priority }}</text>
            <line class="sl-track" :x1="LEFT" :x2="width - 10" :y1="laneY(l.name) + LANE / 2" :y2="laneY(l.name) + LANE / 2" />
          </g>
          <template v-if="showSliceLines">
            <line
              v-for="s in slices"
              :key="`s${s.slice}`"
              class="sl-slice"
              :x1="x(s.t)"
              :x2="x(s.t)"
              :y1="8"
              :y2="height - 26"
            />
          </template>
          <rect
            v-for="(e, i) in log"
            :key="i"
            :class="['sl-bar', `sl-bar--${toneOf(e.name)}`, e.didTimeout ? 'sl-bar--late' : '']"
            :x="x(e.t)"
            :y="laneY(e.name) + 5"
            :width="Math.max(2, unitOf(e) * scale - (scale > 3 ? 1 : 0))"
            :height="LANE - 10"
          />
          <circle v-for="a in arrivals" :key="`a${a.key}`" class="sl-arrive" :cx="x(a.t)" :cy="laneY(a.name) + 3" r="3.5" />
          <g v-for="tk in ticks" :key="`t${tk}`">
            <line class="sl-tick" :x1="x(tk)" :x2="x(tk)" :y1="height - 26" :y2="height - 20" />
            <text class="sl-ticklabel" :x="x(tk)" :y="height - 6">{{ tk }}</text>
          </g>
        </svg>
      </div>

      <Md class="sl-status" :text="totals" />

      <div class="sl-table-wrap">
        <table class="sl-table">
          <thead>
            <tr>
              <th>работа</th>
              <th>приоритет</th>
              <th>начало, мс</th>
              <th>конец, мс</th>
              <th>кусков</th>
              <th>квантов</th>
              <th>с didTimeout</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in summary" :key="s.name">
              <td><span class="sl-chip" :class="`sl-chip--${s.tone}`">{{ s.name }}</span></td>
              <td>{{ s.priority }}</td>
              <td>{{ s.start }}</td>
              <td>{{ s.finish }}</td>
              <td>{{ s.parts }}</td>
              <td>{{ s.slices }}</td>
              <td>{{ s.late }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="sl-log" aria-label="Журнал кусков">
        <span class="sl-label">журнал: квант · время · кусок</span>
        <template v-for="(r, i) in rows" :key="i">
          <span v-if="r.gap" class="sl-log__gap">… ещё {{ r.skipped }}</span>
          <span v-else class="sl-log__row" :data-late="r.e.didTimeout ? 'yes' : 'no'">
            <span class="sl-log__slice">#{{ r.e.slice }}</span>
            <span>t = {{ r.e.t }}</span>
            <span>{{ r.e.name }}{{ r.e.part }}</span>
            <span v-if="r.e.didTimeout" class="sl-log__late">didTimeout</span>
          </span>
        </template>
      </div>

      <Md class="sl-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.sl-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.sl-note,
.sl-caption,
.sl-status {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.sl-note :deep(code),
.sl-caption :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
.sl-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.sl-pick {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.sl-chart {
  min-width: 0;
  overflow-x: auto;
  padding: 8px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.sl-chart svg {
  display: block;
  max-width: none;
  /* Без явной заливки корень SVG красится чёрным по умолчанию — цвет мимо theme.ts. */
  fill: var(--ink);
}
.sl-lane {
  font-family: var(--mono);
  font-size: var(--fs-2);
  fill: var(--ink);
}
.sl-track {
  stroke: var(--hairline);
  stroke-width: 1;
}
.sl-slice {
  stroke: var(--border-strong);
  stroke-width: 1;
  stroke-dasharray: 3 3;
}
.sl-tick {
  stroke: var(--border-strong);
}
.sl-ticklabel {
  font-family: var(--mono);
  font-size: var(--fs-2);
  fill: var(--text-muted);
  text-anchor: middle;
}
.sl-bar {
  stroke-width: 1;
}
.sl-arrive {
  fill: var(--ink);
}
.sl-bar--info {
  fill: var(--tone-info-bg);
  stroke: var(--tone-info-line);
}
.sl-bar--warn {
  fill: var(--tone-warn-bg);
  stroke: var(--tone-warn-line);
}
.sl-bar--ok {
  fill: var(--tone-ok-bg);
  stroke: var(--tone-ok-line);
}
.sl-bar--err {
  fill: var(--tone-err-bg);
  stroke: var(--tone-err-line);
}
.sl-bar--late {
  stroke: var(--tone-err-strong);
  stroke-width: 2;
}

.sl-table-wrap {
  min-width: 0;
  overflow-x: auto;
}
.sl-table {
  width: 100%;
  min-width: 560px;
  border-collapse: collapse;
  font-size: var(--fs-3);
  color: var(--prose);
}
.sl-table th {
  font-family: var(--mono);
  font-size: var(--fs-2);
  font-weight: 400;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
  text-align: left;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
}
.sl-table td {
  font-family: var(--mono);
  padding: 6px 8px;
  border-bottom: 1px solid var(--hairline);
}
.sl-chip {
  display: inline-block;
  padding: 1px 8px;
  border-radius: var(--r2);
  font-weight: 600;
}
.sl-chip--info {
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
}
.sl-chip--warn {
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.sl-chip--ok {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.sl-chip--err {
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}

.sl-log {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 320px;
  overflow-y: auto;
  padding: 10px 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.sl-log__row,
.sl-log__gap {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
}
.sl-log__gap {
  color: var(--text-muted);
}
.sl-log__slice {
  min-width: 3.5em;
  color: var(--text-muted);
}
.sl-log__late {
  color: var(--tone-err-text);
}
</style>
