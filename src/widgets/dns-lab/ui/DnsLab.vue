<script setup lang="ts">
/**
 * Два демо темы про DNS на одном слайсе.
 *
 * `mode="query"` — вопросы к рекурсивному резолверу по виртуальному времени: цепочка серверов
 * последнего вопроса, ответ и кеш с остатком TTL на выбранный момент.
 * `mode="rollout"` — пять резолверов и смена адреса `shop.test` по сценарию.
 *
 * Считает не компонент: резолвер — строка `RESOLVER_CODE`, серверы — `AUTH_CODE` над `ZONES`,
 * обе собраны `new Function` (`model/run.ts`). Те же строки отвечают настоящими пакетами
 * на стенде `tests/unit/dns.test.ts`.
 */
import { computed, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button, SegmentedControl } from '@/shared/ui';
import { loadAnswer, loadResolver, memorySend, replay, rollout, ROLLOUT, showData } from '../model/run';
import type { CacheRow, QueryRun, RolloutResult } from '../model/run';
import type { AuthServer, DemoQuery, LogEntry, RolloutScenario, Zone } from '../model/types';

const props = defineProps<{
  mode: 'query' | 'rollout';
  authCode: string;
  resolverCode: string;
  zones: Zone[];
  servers: AuthServer[];
  roots: string[];
  queries: DemoQuery[];
  scenarios: RolloutScenario[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const answer = loadAnswer(props.authCode);
const createResolver = loadResolver(props.resolverCode);
const send = memorySend(answer, props.servers, () => props.zones);

// ─── Вопросы и кеш ──────────────────────────────────────────────────────────────────────

const picked = ref(props.queries[0].id);
const qOptions = props.queries.map((q) => ({ value: q.id, label: q.label }));
const now = ref(0);
const asked = ref<{ t: number; name: string; type: string }[]>([{ t: 0, name: props.queries[0].name, type: props.queries[0].type }]);

const runs = ref<QueryRun[]>([]);
const cache = ref<CacheRow[]>([]);
let token = 0;

async function recompute() {
  const my = ++token;
  const res = await replay(createResolver, send, props.roots, asked.value, now.value);
  if (my !== token) return;
  runs.value = res.runs;
  cache.value = res.cache.filter((r) => r.type !== 'NS' || r.name !== '.');
}

function ask() {
  const q = props.queries.find((x) => x.id === picked.value) ?? props.queries[0];
  asked.value = [...asked.value, { t: now.value, name: q.name, type: q.type }];
}
function reset() {
  now.value = 0;
  asked.value = [];
}

if (props.mode === 'query') {
  watch([asked, now], recompute, { immediate: true });
}

/** Последний заданный вопрос — тот, что ближе всего к текущему моменту и не позже него. */
const last = computed(() => {
  const before = runs.value.filter((r) => r.t <= now.value);
  return before.at(-1) ?? null;
});

const serverName = (ip?: string) => props.servers.find((s) => s.ip === ip)?.name ?? ip ?? '';

function stepText(e: LogEntry): string {
  const q = `\`${e.name} ${e.type}\``;
  if (e.cache) {
    return e.result === 'answer' ? `${q} — из кеша` : `${q} — из кеша: ${e.result}`;
  }
  if (e.result === 'referral') {
    const glue = e.noGlue ? `; glue нет — адрес \`${e.noGlue}\` ищется отдельно` : '';
    return `${q} — делегирование: спросите \`${e.to}.\`${glue}`;
  }
  if (e.result === 'answer') return `${q} — ответ из первых рук`;
  if (e.result === 'NXDOMAIN') return `${q} — NXDOMAIN: такого имени нет`;
  return `${q} — NODATA: имя есть, записи этого типа нет`;
}

const answerLines = computed(() => {
  const r = last.value;
  if (!r) return [];
  if (!r.result.answers.length) return [`${r.result.rcode === 'NXDOMAIN' ? 'NXDOMAIN' : 'NOERROR, записей нет'}`];
  return r.result.answers.map((a) => `${a.name}.  ${a.ttl}  ${a.type}  ${showData(a)}`);
});

const cacheRows = computed(() =>
  [...cache.value].sort((a, b) => a.left - b.left || a.key.localeCompare(b.key)),
);

const fmtLeft = (r: CacheRow) => (r.left > 0 ? `${r.left} с` : 'протухла');

// ─── Смена адреса ───────────────────────────────────────────────────────────────────────

const scId = ref(props.scenarios[0].id);
const scOptions = props.scenarios.map((s) => ({ value: s.id, label: s.label }));
const scenario = computed(() => props.scenarios.find((s) => s.id === scId.value) ?? props.scenarios[0]);
const result = ref<RolloutResult | null>(null);
let scToken = 0;

if (props.mode === 'rollout') {
  watch(
    scenario,
    async (sc) => {
      const my = ++scToken;
      const res = await rollout(createResolver, answer, props.servers, props.zones, props.roots, sc);
      if (my === scToken) result.value = res;
    },
    { immediate: true },
  );
}

const W = 720;
const LEFT = 92;
const ROW = 30;
const TOP = 14;
const x = (t: number) => LEFT + ((W - LEFT - 12) * t) / ROLLOUT.horizon;
const chartH = computed(() => TOP + (result.value?.rows.length ?? 5) * ROW + 30);
const ticks = [0, 1800, 3600, 5400, 7200];
const tickLabel = (t: number) => (t === 0 ? '0' : `${t / 60} мин`);
const barW = computed(() => Math.max(2, x(ROLLOUT.every) - x(0) - 1));

const summary = computed(() => {
  const r = result.value;
  if (!r) return '';
  const tail =
    r.lastOld === null
      ? 'После смены ни один клиент не получил старый адрес.'
      : `Последний ответ со старым адресом — через **${r.lastOld - scenario.value.switchAt} с** после смены.`;
  const up = r.rows.map((row) => row.upstream).join(', ');
  return `${tail} Запросов к \`ns1.shop.test\` за два часа по резолверам: ${up}.`;
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div v-if="mode === 'query'" class="dl-controls">
        <SegmentedControl v-model="picked" class="l-pills" label="Вопрос" :options="qOptions" />
        <label class="dl-range">
          <span class="dl-label">время резолвера: {{ now }} с</span>
          <input v-model.number="now" type="range" min="0" max="4000" step="5" :aria-valuetext="`${now} секунд`" />
        </label>
        <div class="dl-buttons">
          <Button variant="primary" @click="ask">Спросить в момент {{ now }} с</Button>
          <Button variant="secondary" @click="reset">Очистить</Button>
        </div>
      </div>
      <SegmentedControl v-else v-model="scId" class="l-pills" label="Сценарий" :options="scOptions" />
    </template>

    <div v-if="mode === 'query'" class="dl-body">
      <div class="dl-asked">
        <span class="dl-label">заданные вопросы</span>
        <div class="dl-chips">
          <span v-if="!asked.length" class="dl-empty">пока ни одного — кеш пуст</span>
          <span
            v-for="(r, i) in runs"
            :key="i"
            class="dl-chip"
            :data-on="r === last ? 'yes' : 'no'"
            :data-future="r.t > now ? 'yes' : 'no'"
          >{{ r.t }} с · {{ r.name }} {{ r.type }}</span>
        </div>
      </div>

      <div class="dl-split">
        <div class="dl-pane">
          <span class="dl-label">последний вопрос: кого спросил резолвер</span>
          <ol v-if="last" class="dl-steps">
            <li v-for="(e, i) in last.steps" :key="i" class="dl-step" :data-cache="e.cache ? 'yes' : 'no'" :style="{ '--depth': e.depth }">
              <span class="dl-server">{{ e.cache ? 'кеш' : `${serverName(e.ip)} · ${e.ip}` }}</span>
              <Md class="dl-step__text" :text="stepText(e)" />
            </li>
          </ol>
          <span v-else class="dl-empty">задайте вопрос</span>
          <pre v-if="last" class="dl-answer">{{ answerLines.join('\n') }}</pre>
        </div>

        <div class="dl-pane">
          <span class="dl-label">кеш резолвера на {{ now }} с</span>
          <div class="dl-cache" role="table" aria-label="Кеш резолвера">
            <div class="dl-cache__head" role="row">
              <span role="columnheader">имя и тип</span>
              <span role="columnheader">значение</span>
              <span role="columnheader">TTL → осталось</span>
            </div>
            <div
              v-for="r in cacheRows"
              :key="r.key"
              class="dl-cache__row"
              role="row"
              :data-expired="r.left > 0 ? 'no' : 'yes'"
              :data-negative="r.negative ? 'yes' : 'no'"
            >
              <code role="cell">{{ r.name }} {{ r.negative && r.type === 'NXDOMAIN' ? '*' : r.type }}</code>
              <code role="cell" class="dl-cache__val">{{ r.value }}</code>
              <code role="cell">{{ r.ttl }} → {{ fmtLeft(r) }}</code>
            </div>
          </div>
        </div>
      </div>

      <Md class="dl-caption" :text="caption" />
    </div>

    <div v-else class="dl-body">
      <Md class="dl-note" :text="scenario.note" />
      <div class="dl-scroll">
        <svg
          v-if="result"
          class="dl-chart"
          :viewBox="`0 0 ${W} ${chartH}`"
          :width="W"
          :height="chartH"
          role="img"
          :aria-label="`Ответы пяти резолверов во времени, сценарий ${scenario.label}`"
        >
          <g v-for="(row, i) in result.rows" :key="row.label">
            <text class="dl-chart__label" :x="0" :y="TOP + i * ROW + 15">{{ row.label }}</text>
            <rect
              v-for="a in row.answers"
              :key="a.t"
              :class="a.address === ROLLOUT.oldAddress ? 'dl-old' : 'dl-new'"
              :x="x(a.t)"
              :y="TOP + i * ROW + 4"
              :width="barW"
              :height="ROW - 10"
            />
          </g>
          <line
            v-if="scenario.lowerAt !== null"
            class="dl-chart__lower"
            :x1="x(scenario.lowerAt)"
            :x2="x(scenario.lowerAt)"
            :y1="4"
            :y2="TOP + result.rows.length * ROW"
          />
          <line class="dl-chart__switch" :x1="x(scenario.switchAt)" :x2="x(scenario.switchAt)" :y1="4" :y2="TOP + result.rows.length * ROW" />
          <g v-for="t in ticks" :key="t">
            <line class="dl-chart__tick" :x1="x(t)" :x2="x(t)" :y1="TOP + result.rows.length * ROW" :y2="TOP + result.rows.length * ROW + 5" />
            <text class="dl-chart__axis" :x="x(t)" :y="TOP + result.rows.length * ROW + 22" :text-anchor="t === 0 ? 'start' : t === 7200 ? 'end' : 'middle'">{{ tickLabel(t) }}</text>
          </g>
        </svg>
      </div>
      <div class="dl-legend">
        <span class="dl-key dl-key--old">старый адрес {{ ROLLOUT.oldAddress }}</span>
        <span class="dl-key dl-key--new">новый {{ ROLLOUT.newAddress }}</span>
        <span class="dl-key dl-key--switch">смена адреса</span>
        <span v-if="scenario.lowerAt !== null" class="dl-key dl-key--lower">понижение TTL</span>
      </div>
      <Md class="dl-note" :text="summary" />
      <Md class="dl-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.dl-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 12px 20px;
}
.dl-range {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1 1 220px;
  min-width: 0;
}
.dl-range input {
  width: 100%;
  font: inherit;
  color: inherit;
  accent-color: var(--ink);
}
.dl-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.dl-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.dl-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.dl-note,
.dl-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.dl-note :deep(code),
.dl-caption :deep(code),
.dl-step__text :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
.dl-empty {
  font-size: var(--fs-3);
  color: var(--text-muted);
}

.dl-asked {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dl-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.dl-chip {
  padding: 3px 9px;
  border-radius: var(--r-full);
  background: var(--surface-2);
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--prose);
}
.dl-chip[data-on='yes'] {
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
  box-shadow: inset 0 0 0 1px var(--tone-info-line);
}
.dl-chip[data-future='yes'] {
  background: var(--surface-3);
  color: var(--text-muted);
}

.dl-split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 860px) {
  .dl-split {
    grid-template-columns: minmax(0, 1fr);
  }
}
.dl-pane {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.dl-steps {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.dl-step {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-left: calc(var(--depth) * 18px);
  padding: 7px 10px;
  border-radius: var(--r2);
  background: var(--surface);
  box-shadow: inset 3px 0 0 var(--tone-warn-line);
}
.dl-step[data-cache='yes'] {
  box-shadow: inset 3px 0 0 var(--tone-ok-line);
}
.dl-server {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
  overflow-wrap: anywhere;
}
.dl-step__text {
  font-size: var(--fs-3);
  line-height: 1.5;
  color: var(--prose);
  overflow-wrap: anywhere;
}
.dl-answer {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.7;
  color: var(--code-fg);
  white-space: pre;
  overflow-x: auto;
}

.dl-cache {
  display: flex;
  flex-direction: column;
  font-size: var(--fs-3);
  color: var(--prose);
}
.dl-cache__head,
.dl-cache__row {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(0, 1.2fr) minmax(0, 1fr);
  gap: 8px;
  padding: 5px 0;
  align-items: baseline;
}
.dl-cache__head {
  font-family: var(--mono);
  font-size: var(--fs-2);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}
.dl-cache__row + .dl-cache__row,
.dl-cache__head + .dl-cache__row {
  border-top: 1px solid var(--hairline);
}
.dl-cache code {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--ink);
  background: none;
  padding: 0;
  overflow-wrap: anywhere;
}
.dl-cache__row[data-negative='yes'] code {
  color: var(--tone-warn-text);
}
.dl-cache__row[data-expired='yes'] {
  background: var(--surface-3);
}
.dl-cache__row[data-expired='yes'] code {
  color: var(--text-muted);
  text-decoration: line-through;
}

.dl-scroll {
  overflow-x: auto;
}
.dl-chart {
  display: block;
  min-width: 720px;
  fill: var(--ink);
}
.dl-chart__label,
.dl-chart__axis {
  font-family: var(--mono);
  font-size: var(--fs-2);
  fill: var(--text-muted);
}
.dl-old {
  fill: var(--tone-warn-line);
}
.dl-new {
  fill: var(--tone-ok-line);
}
.dl-chart__switch {
  stroke: var(--ink);
  stroke-width: 2;
}
.dl-chart__lower {
  stroke: var(--text-muted);
  stroke-width: 1.5;
  stroke-dasharray: 4 3;
}
.dl-chart__tick {
  stroke: var(--text-muted);
}

.dl-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.dl-key {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--mono);
}
.dl-key::before {
  content: '';
  display: inline-block;
  width: 14px;
  height: 10px;
  border-radius: 2px;
}
.dl-key--old::before {
  background: var(--tone-warn-line);
}
.dl-key--new::before {
  background: var(--tone-ok-line);
}
.dl-key--switch::before {
  width: 3px;
  background: var(--ink);
}
.dl-key--lower::before {
  width: 3px;
  background: var(--text-muted);
}
</style>
