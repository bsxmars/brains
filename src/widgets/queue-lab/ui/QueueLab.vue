<script setup lang="ts">
/**
 * «Сценарий по шагам»: журнал команд Redis и запросов к базе и состояние после каждой строки —
 * поток, список ожидания, очередь мёртвых писем и таблицы базы.
 *
 * Считает не компонент, а учебная модель — строки `*_CODE` из темы «Очереди и идемпотентность»,
 * собранные `new Function` (`model/run.ts`). Состояние снимается хуком `env.onLine`, который
 * `runSchedule` зовёт после каждой строки журнала. Те же строки напечатаны в теме, а
 * `tests/unit/queues.test.ts` сверяет журнал каждого сценария с настоящими Redis и Postgres.
 */
import { computed, ref, shallowRef, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import StepToolbar from '@/shared/ui/StepToolbar.vue';
import { SegmentedControl } from '@/shared/ui';
import { loadModel, modelEnv } from '../model/run';
import type { BrokerDump, DbDump, Final, QueueScenario } from '../model/types';

const props = defineProps<{
  parts: string[];
  scenarios: QueueScenario[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const model = loadModel(props.parts);

const picked = ref(props.scenarios[0].id);
const options = props.scenarios.map((s) => ({ value: s.id, label: s.label }));
const scenario = computed(() => props.scenarios.find((s) => s.id === picked.value) ?? props.scenarios[0]);

interface Snap {
  broker: BrokerDump;
  db: DbDump;
}

const log = shallowRef<string[]>([]);
const snaps = shallowRef<Snap[]>([]);
const final = shallowRef<Final | null>(null);
const index = ref(0);

/** Прогон целиком: журнал и снимок состояния после каждой строки. Номер защищает от устаревшего ответа. */
let ticket = 0;
watch(
  scenario,
  async (sc) => {
    const my = ++ticket;
    const { env, redis, db } = modelEnv(model);
    const first: Snap = { broker: redis.dump(), db: db.dump() };
    const taken: Snap[] = [first];
    env.onLine = () => taken.push({ broker: redis.dump(), db: db.dump() });
    const r = await model.runSchedule(env, sc.schedule, sc.variant, sc.crash);
    if (my !== ticket) return;
    log.value = r.log;
    snaps.value = taken;
    final.value = r.final;
    index.value = 0;
  },
  { immediate: true },
);

const total = computed(() => log.value.length);
const counter = computed(() => `шаг ${index.value} из ${total.value}`);
const atStart = computed(() => index.value === 0);
const atEnd = computed(() => total.value > 0 && index.value === total.value);
const now = computed<Snap | undefined>(() => snaps.value[index.value]);

const ROLE: Record<string, string> = { P: 'издатель', R: 'ретранслятор', w1: 'обработчик', w2: 'обработчик' };

/** Тон строки журнала — по смыслу ответа: падение, ошибка, дубль, откат. */
function toneOf(text: string) {
  if (text.startsWith('✕')) return 'err';
  if (text.includes('ошибка')) return 'err';
  if (text.startsWith('ROLLBACK')) return 'warn';
  if (text.includes('SQL.markProcessed') && text.endsWith('строк: 0')) return 'ok';
  if (text.endsWith('→ (integer) 0') || text.includes('забрал ничего')) return 'warn';
  return 'none';
}

const steps = computed(() =>
  log.value.map((line, i) => {
    const wait = !line.includes(': ') || line.startsWith('прошло');
    const who = wait ? '' : line.slice(0, line.indexOf(': '));
    const text = wait ? line : line.slice(line.indexOf(': ') + 2);
    const [cmd, reply = ''] = text.split(' → ');
    return {
      i,
      who,
      role: ROLE[who] ?? '',
      cmd,
      reply,
      done: i < index.value,
      next: i === index.value,
      tone: i < index.value ? toneOf(text) : 'none',
    };
  }),
);

const mainStream = computed(() => now.value?.broker.entries.events ?? []);
const deadStream = computed(() => now.value?.broker.entries['events:dead'] ?? []);
const pending = computed(() => now.value?.broker.pending ?? []);
const showFields = (f: string[]) => f.join(' ');
const usesOrders = computed(() => scenario.value.schedule.some((s) => s[1] === 'place'));
const points = computed(() => now.value?.db.wallets['7'] ?? 0);

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
    <template v-if="options.length > 1" #toolbar>
      <SegmentedControl v-model="picked" class="l-pills" label="Сценарий" :options="options" />
    </template>

    <div class="ql-body">
      <Md class="ql-note" :text="scenario.note" />

      <StepToolbar :counter="counter" :at-start="atStart" :at-end="atEnd" @prev="prev" @next="next" @reset="reset" />

      <div class="ql-scroll">
        <ol class="ql-steps" aria-label="Журнал команд">
          <li
            v-for="s in steps"
            :key="s.i"
            class="ql-step"
            :data-done="s.done ? 'yes' : 'no'"
            :data-next="s.next ? 'yes' : 'no'"
            :data-tone="s.tone"
          >
            <span class="ql-step__n">{{ s.i + 1 }}</span>
            <span class="ql-who">
              <b v-if="s.who">{{ s.who }}</b>
              {{ s.role }}
            </span>
            <code class="ql-cmd">{{ s.cmd }}</code>
            <code v-if="s.done && s.reply" class="ql-reply">{{ s.reply }}</code>
          </li>
        </ol>
      </div>

      <div class="ql-state">
        <div class="ql-box">
          <span class="ql-label">поток events</span>
          <div v-if="!mainStream.length" class="ql-empty">пусто</div>
          <div v-for="[id, f] in mainStream" :key="id" class="ql-kv">
            <code>{{ id }}</code>
            <code class="ql-kv__v">{{ showFields(f) }}</code>
          </div>
          <span class="ql-label">список ожидания</span>
          <div v-if="!pending.length" class="ql-empty">пусто</div>
          <div v-for="p in pending" :key="p.id" class="ql-kv ql-kv--pending">
            <code>{{ p.id }}</code>
            <span class="ql-kv__v">у {{ p.consumer }}, доставок {{ p.deliveries }}</span>
          </div>
          <template v-if="deadStream.length">
            <span class="ql-label">events:dead</span>
            <div v-for="[id, f] in deadStream" :key="id" class="ql-kv ql-kv--dead">
              <code>{{ id }}</code>
              <code class="ql-kv__v">{{ showFields(f) }}</code>
            </div>
          </template>
        </div>

        <div class="ql-box">
          <span class="ql-label">база</span>
          <div class="ql-kv ql-kv--wallet">
            <code>wallets[7].points</code>
            <code class="ql-kv__v">{{ points }}</code>
          </div>
          <div class="ql-kv">
            <code>processed</code>
            <code class="ql-kv__v">{{ now?.db.processed.join(', ') || '—' }}</code>
          </div>
          <template v-if="usesOrders">
            <div class="ql-kv">
              <code>orders</code>
              <code class="ql-kv__v">{{ now?.db.orders.map((o) => o.id).join(', ') || '—' }}</code>
            </div>
            <div v-for="o in now?.db.outbox ?? []" :key="o.id" class="ql-kv">
              <code>outbox[{{ o.id }}]</code>
              <code class="ql-kv__v">{{ o.event_id }}, {{ o.sent_at === null ? 'не опубликовано' : 'опубликовано' }}</code>
            </div>
            <div v-if="!now?.db.outbox.length" class="ql-kv">
              <code>outbox</code>
              <code class="ql-kv__v">—</code>
            </div>
          </template>
        </div>
      </div>

      <div v-if="atEnd && final" class="ql-verdict" :data-tone="scenario.tone">
        <span class="ql-label">
          итог · бонусов {{ final.points }}<template v-if="usesOrders">, заказов {{ final.orders }}</template>, без XACK {{ final.pending }}<template v-if="final.dead">, в events:dead {{ final.dead }}</template>
        </span>
        <Md class="ql-note" :text="scenario.verdict" />
      </div>

      <Md class="ql-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.ql-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.ql-note,
.ql-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.ql-body :deep(code),
.ql-body code {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
.ql-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.ql-scroll {
  max-width: 100%;
  overflow-x: auto;
}
.ql-steps {
  margin: 0;
  padding: 0;
  list-style: none;
  min-width: 620px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ql-step {
  display: grid;
  grid-template-columns: 2em 8.5em minmax(0, 1fr) auto;
  gap: 10px;
  align-items: baseline;
  padding: 6px 10px;
  border-radius: var(--r2);
  background: var(--surface-2);
  color: var(--text-muted);
  font-size: var(--fs-3);
}
.ql-step[data-done='yes'] {
  color: var(--prose);
}
.ql-step[data-next='yes'] {
  box-shadow: inset 0 0 0 1px var(--tone-info-line);
  background: var(--tone-info-bg);
}
.ql-step[data-tone='err'] {
  background: var(--tone-err-bg);
}
.ql-step[data-tone='warn'] {
  background: var(--tone-warn-bg);
}
.ql-step[data-tone='ok'] {
  background: var(--tone-ok-bg);
}
.ql-step__n {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.ql-who {
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.ql-who b {
  font-family: var(--mono);
  color: var(--ink);
}
.ql-cmd {
  justify-self: start;
  color: var(--ink);
  overflow-wrap: anywhere;
}
.ql-step[data-done='no'] .ql-cmd {
  color: var(--text-muted);
}
.ql-reply {
  max-width: 22em;
  padding: 2px 6px;
  border-radius: var(--r1);
  background: var(--surface-3);
  color: var(--ink);
  overflow-wrap: anywhere;
}
.ql-step[data-tone='err'] .ql-reply,
.ql-step[data-tone='err'] .ql-cmd {
  color: var(--tone-err-text);
}
.ql-step[data-tone='warn'] .ql-reply {
  color: var(--tone-warn-text);
}
.ql-step[data-tone='ok'] .ql-reply {
  color: var(--tone-ok-text);
}

.ql-state {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;
}
.ql-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
  min-width: 0;
}
.ql-box .ql-label + .ql-kv,
.ql-box .ql-label + .ql-empty {
  margin-top: -2px;
}
.ql-empty {
  font-size: var(--fs-3);
  color: var(--text-muted);
}
.ql-kv {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 4px 12px;
  font-size: var(--fs-3);
  color: var(--prose);
}
.ql-kv__v {
  color: var(--ink);
  overflow-wrap: anywhere;
}
.ql-kv--pending .ql-kv__v {
  color: var(--tone-warn-text);
}
.ql-kv--dead .ql-kv__v {
  color: var(--tone-err-text);
}
.ql-kv--wallet .ql-kv__v {
  font-weight: 600;
}

.ql-verdict {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 16px;
  border-radius: var(--r3);
  background: var(--tone-ok-bg);
  box-shadow: inset 0 0 0 1px var(--tone-ok-line);
}
.ql-verdict[data-tone='err'] {
  background: var(--tone-err-bg);
  box-shadow: inset 0 0 0 1px var(--tone-err-line);
}
.ql-verdict[data-tone='warn'] {
  background: var(--tone-warn-bg);
  box-shadow: inset 0 0 0 1px var(--tone-warn-line);
}
</style>
