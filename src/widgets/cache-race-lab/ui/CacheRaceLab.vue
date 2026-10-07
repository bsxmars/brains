<script setup lang="ts">
/**
 * «Гонка по шагам»: клиенты cache-aside и писатель, шаг за шагом, состояние кеша, основной
 * базы, реплики и незафиксированной транзакции после каждого шага.
 *
 * Считает не компонент, а учебная модель — строки `REDIS_CODE`, `DB_CODE`, `SCHEDULE_CODE`,
 * `CLIENT_CODE`, `FIX_CODE` из темы, собранные `new Function` (`model/run.ts`). Состояние на шаге k —
 * прогон планировщика с нуля до шага k. Те же строки напечатаны в теме, а
 * `tests/unit/redis-cache.test.ts` сверяет полный журнал каждого сценария с журналом настоящего Redis.
 */
import { computed, ref, shallowRef, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import StepToolbar from '@/shared/ui/StepToolbar.vue';
import { SegmentedControl } from '@/shared/ui';
import { loadModel, runRace, stepsOf } from '../model/run';
import type { RaceScenario, Row } from '../model/types';

const props = defineProps<{
  parts: string[];
  scenarios: RaceScenario[];
  rows: Row[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const model = loadModel(props.parts);

const picked = ref(props.scenarios[0].id);
const options = props.scenarios.map((s) => ({ value: s.id, label: s.label }));
const scenario = computed(() => props.scenarios.find((s) => s.id === picked.value) ?? props.scenarios[0]);

const index = ref(0);
watch(scenario, () => {
  index.value = 0;
});
const total = computed(() => stepsOf(scenario.value.order).length);
const counter = computed(() => `шаг ${index.value} из ${total.value}`);
const atStart = computed(() => index.value === 0);
const atEnd = computed(() => index.value === total.value);

type Snap = Awaited<ReturnType<typeof runRace>>['db'];
const full = shallowRef<string[]>([]);
const now = shallowRef<{ log: string[]; cache: Record<string, string>; db: Snap | null; cached: string | null; primary: string }>({
  log: [],
  cache: {},
  db: null,
  cached: null,
  primary: '',
});

/** Прогоны асинхронные (кеш может быть и настоящим); номер защищает от устаревшего ответа. */
let ticket = 0;
watch(
  [scenario, index],
  async ([sc, upto]) => {
    const my = ++ticket;
    const whole = await runRace(model, sc, props.rows);
    const cache = model.createRedis();
    const part = await runRace(model, sc, props.rows, upto, cache);
    if (my !== ticket) return;
    full.value = whole.log;
    now.value = { log: part.log, cache: cache.dump(), db: part.db, cached: part.cached, primary: part.primary };
  },
  { immediate: true },
);

const ROLE: Record<string, string> = { R: 'реплика' };
const roleOf = (who: string) => {
  if (ROLE[who]) return ROLE[who];
  const fn = scenario.value.clients[who]?.[0] ?? '';
  return fn.startsWith('read') ? 'читатель' : 'писатель';
};

/** Ответ шага: что после стрелки. Тон — по смыслу: промах, отказ функции, старое из кеша. */
function toneOf(line: string, reply: string) {
  if (reply === '(nil)' || reply === '(integer) 0') return 'warn';
  if (line.includes(': GET ') && reply.startsWith('"')) {
    const v = Number(reply.slice(1).split(':')[0]);
    const latest = Math.max(...(now.value.db?.primary.map((r) => r.v) ?? [v]));
    return v < latest ? 'err' : 'ok';
  }
  return 'none';
}

const steps = computed(() =>
  full.value.map((line, i) => {
    const done = i < index.value;
    const shown = done ? now.value.log[i] ?? line : line;
    const [who, rest] = [shown.slice(0, shown.indexOf(': ')), shown.slice(shown.indexOf(': ') + 2)];
    const [cmd, reply = ''] = rest.split(' → ');
    return { i, who, role: roleOf(who), cmd, reply: done ? reply : '', done, next: i === index.value, tone: done ? toneOf(shown, reply) : 'none' };
  }),
);

const rowText = (r: Row) => `${r.v}:${r.name}`;
const cacheRows = computed(() => Object.entries(now.value.cache));
const db = computed(() => now.value.db);
const stale = computed(() => atEnd.value && now.value.cached !== null && now.value.cached !== now.value.primary);

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
      <SegmentedControl v-model="picked" class="l-pills" label="Сценарий" :options="options" />
    </template>

    <div class="crl-body">
      <Md class="crl-note" :text="scenario.note" />

      <StepToolbar :counter="counter" :at-start="atStart" :at-end="atEnd" @prev="prev" @next="next" @reset="reset" />

      <div class="crl-scroll">
        <ol class="crl-steps" aria-label="Шаги клиентов">
          <li v-for="s in steps" :key="s.i" class="crl-step" :data-done="s.done ? 'yes' : 'no'" :data-next="s.next ? 'yes' : 'no'">
            <span class="crl-step__n">{{ s.i + 1 }}</span>
            <span class="crl-who" :data-who="s.who">
              <b>{{ s.who }}</b>
              {{ s.role }}
            </span>
            <code class="crl-cmd">{{ s.cmd }}</code>
            <span v-if="s.done && s.reply" class="crl-reply" :data-tone="s.tone">{{ s.reply }}</span>
          </li>
        </ol>
      </div>

      <div class="crl-state">
        <div class="crl-box">
          <span class="crl-label">кеш (Redis)</span>
          <div v-if="!cacheRows.length" class="crl-empty">пусто</div>
          <div v-for="[k, v] in cacheRows" :key="k" class="crl-kv">
            <code>{{ k }}</code>
            <code class="crl-kv__v">{{ v }}</code>
          </div>
        </div>
        <div class="crl-box">
          <span class="crl-label">основная база</span>
          <div v-for="r in db?.primary ?? []" :key="r.id" class="crl-kv">
            <code>users[{{ r.id }}]</code>
            <code class="crl-kv__v">{{ rowText(r) }}</code>
          </div>
          <template v-if="db?.tx">
            <span class="crl-label">транзакция, ещё без COMMIT</span>
            <div v-for="r in db.tx" :key="r.id" class="crl-kv crl-kv--tx">
              <code>users[{{ r.id }}]</code>
              <code class="crl-kv__v">{{ rowText(r) }}</code>
            </div>
          </template>
        </div>
        <div v-if="db?.replica" class="crl-box">
          <span class="crl-label">реплика</span>
          <div v-for="r in db.replica" :key="r.id" class="crl-kv">
            <code>users[{{ r.id }}]</code>
            <code class="crl-kv__v">{{ rowText(r) }}</code>
          </div>
        </div>
      </div>

      <div v-if="atEnd" class="crl-verdict" :data-tone="stale ? 'err' : 'ok'">
        <span class="crl-label">итог · кеш {{ now.cached ?? '(nil)' }}, база {{ now.primary }}</span>
        <Md class="crl-note" :text="scenario.verdict" />
      </div>

      <Md class="crl-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.crl-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.crl-note,
.crl-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.crl-body :deep(code),
.crl-body code {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
.crl-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.crl-scroll {
  max-width: 100%;
  overflow-x: auto;
}
.crl-steps {
  margin: 0;
  padding: 0;
  list-style: none;
  min-width: 560px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.crl-step {
  display: grid;
  grid-template-columns: 2em 7.5em minmax(0, 1fr) auto;
  gap: 10px;
  align-items: baseline;
  padding: 6px 10px;
  border-radius: var(--r2);
  background: var(--surface-2);
  color: var(--text-muted);
  font-size: var(--fs-3);
}
.crl-step[data-done='yes'] {
  color: var(--prose);
}
.crl-step[data-next='yes'] {
  box-shadow: inset 0 0 0 1px var(--tone-info-line);
  background: var(--tone-info-bg);
}
.crl-step__n {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.crl-who {
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.crl-who b {
  font-family: var(--mono);
  color: var(--ink);
}
.crl-cmd {
  justify-self: start;
  color: var(--ink);
  overflow-wrap: anywhere;
}
.crl-step[data-done='no'] .crl-cmd {
  color: var(--text-muted);
}
.crl-reply {
  font-family: var(--mono);
  font-size: var(--fs-2);
  padding: 2px 6px;
  border-radius: var(--r1);
  background: var(--surface-3);
  color: var(--ink);
  white-space: nowrap;
}
.crl-reply[data-tone='ok'] {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.crl-reply[data-tone='warn'] {
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.crl-reply[data-tone='err'] {
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}

.crl-state {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
}
.crl-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
  min-width: 0;
}
.crl-empty {
  font-size: var(--fs-3);
  color: var(--text-muted);
}
.crl-kv {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 4px 12px;
  font-size: var(--fs-3);
  color: var(--prose);
}
.crl-kv__v {
  color: var(--ink);
  font-weight: 600;
}
.crl-kv--tx .crl-kv__v {
  color: var(--tone-warn-text);
}

.crl-verdict {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 16px;
  border-radius: var(--r3);
  background: var(--tone-ok-bg);
  box-shadow: inset 0 0 0 1px var(--tone-ok-line);
}
.crl-verdict[data-tone='err'] {
  background: var(--tone-err-bg);
  box-shadow: inset 0 0 0 1px var(--tone-err-line);
}
</style>
