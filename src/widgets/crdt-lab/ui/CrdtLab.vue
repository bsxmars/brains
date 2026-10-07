<script setup lang="ts">
/**
 * «Правки разлетаются»: участники правят свои копии текста, не видя друг друга, потом
 * получают чужие правки — в разном порядке. Демо показывает, что получилось у каждого,
 * как правки приходили к новому участнику (с ожиданием соседа слева) и его внутренний список
 * с надгробиями.
 *
 * Считают строки `SEQ_CODE` и `NAIVE_CODE` из темы, собранные `new Function`
 * (`model/run.ts`). Перебор всех порядков доставки — здесь же, живой. Итог Yjs — литерал
 * сценария; `tests/unit/crdt.test.ts` пересобирает его настоящим Yjs 13.6.
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { allOrders, loadNaive, loadSeq, makeOrder, opLabel, play, prepare, type OrderKind } from '../model/run';
import type { SeqOp, SeqScenario, TaggedOp } from '../model/types';

const props = defineProps<{
  seqCode: string;
  naiveCode: string;
  scenarios: SeqScenario[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const api = loadSeq(props.seqCode);
const naive = loadNaive(props.naiveCode);

const picked = ref(props.scenarios[0].id);
const options = props.scenarios.map((s) => ({ value: s.id, label: s.label }));
const scenario = computed(() => props.scenarios.find((s) => s.id === picked.value) ?? props.scenarios[0]);

const orderKind = ref<OrderKind>('forward');
const orderOptions = [
  { value: 'forward', label: 'как сделаны' },
  { value: 'reverse', label: 'задом наперёд' },
  { value: 'shuffle', label: 'вразнобой' },
];

const prep = computed(() => prepare(api, scenario.value));
const order = computed(() => makeOrder(prep.value.ops.length, orderKind.value));
const result = computed(() => play(api, naive, scenario.value, order.value));

const names = computed(() => new Map(scenario.value.peers.map((p) => [p.client, p.name])));
const chars = computed(() => {
  const m = new Map<string, string>();
  for (const it of result.value.items) m.set(`${names.value.get(it.id[0]) ?? it.id[0]}·${it.id[1]}`, it.char);
  return m;
});
const label = (op: SeqOp) => opLabel(op, names.value, chars.value);
const idText = (id: [number, number]) => `${names.value.get(id[0]) ?? id[0]}·${id[1]}`;

const peerCards = computed(() =>
  scenario.value.peers.map((p, n) => ({
    ...p,
    local: prep.value.local[n],
    ops: prep.value.ops.filter((t) => t.peer === p.name).map((t) => label(t.op)),
  })),
);

function stepNote(applied: TaggedOp[], self: TaggedOp): string {
  if (!applied.length) return 'ждёт: опоры ещё нет';
  const others = applied.filter((a) => a !== self);
  if (!others.length) return 'применилась';
  const mine = applied.includes(self) ? 'применилась' : 'ждёт';
  return `${mine}; дождались: ${others.map((o) => label(o.op)).join(', ')}`;
}

const steps = computed(() =>
  result.value.steps.map((s) => ({
    label: label(s.op.op),
    peer: s.op.peer,
    note: stepNote(s.applied, s.op),
    text: s.text,
    waiting: s.waiting,
    state: s.applied.length ? 'ok' : 'wait',
  })),
);

const tombs = computed(() => result.value.items.filter((it) => it.deleted).length);
const finals = computed(() => result.value.peers.map((p) => p.final));
const converged = computed(() => finals.value.every((t) => t === finals.value[0]));
const naiveSame = computed(() => result.value.peers.every((p) => p.naive === result.value.peers[0].naive));
const naiveRight = computed(() => naiveSame.value && converged.value && result.value.peers[0].naive === finals.value[0]);
const naiveVerdict = computed(() =>
  !naiveSame.value ? 'копии разошлись' : naiveRight.value ? 'совпало с CRDT — на этих правках повезло' : 'копии совпали, но буквы встали не туда',
);

const orders = computed(() => [...allOrders(api, prep.value).entries()]);
const ordersTotal = computed(() => orders.value.reduce((s, [, n]) => s + n, 0));

const sameAsYjs = computed(() => finals.value[0] === scenario.value.yjs);
const show = (t: string) => (t ? `«${t}»` : '«»');
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="cr-tools">
        <SegmentedControl v-model="picked" class="l-pills" label="Сценарий" :options="options" />
        <SegmentedControl v-model="orderKind" class="l-pills" label="Порядок доставки" :options="orderOptions" />
      </div>
    </template>

    <div class="cr-body">
      <div class="cr-peers">
        <div v-for="p in peerCards" :key="p.name" class="cr-peer">
          <span class="cr-title">{{ p.name }} · client {{ p.client }}</span>
          <span class="cr-text">{{ show(scenario.base) }} → {{ show(p.local) }}</span>
          <ul class="cr-ops">
            <li v-for="(o, i) in p.ops" :key="i" class="cr-mono">{{ o }}</li>
          </ul>
        </div>
      </div>

      <div class="cr-block">
        <span class="cr-title">новый участник получает правки</span>
        <ol class="cr-steps">
          <li v-for="(s, i) in steps" :key="i" class="cr-step" :data-state="s.state">
            <span class="cr-mono">{{ s.label }}</span>
            <span class="cr-note">{{ s.note }}</span>
            <span class="cr-mono cr-after">{{ show(s.text) }}<template v-if="s.waiting"> · ждут: {{ s.waiting }}</template></span>
          </li>
        </ol>
      </div>

      <div class="cr-block">
        <span class="cr-title">его внутренний список: видно {{ result.items.length - tombs }}, надгробий {{ tombs }}</span>
        <div class="cr-items">
          <span v-for="it in result.items" :key="idText(it.id)" class="cr-chip" :data-state="it.deleted ? 'tomb' : 'live'">
            <span class="cr-char">{{ it.char }}</span>
            <span class="cr-id">{{ idText(it.id) }}</span>
          </span>
          <span v-if="!result.items.length" class="cr-note">пусто</span>
        </div>
      </div>

      <div class="cr-verdicts">
        <div class="cr-verdict" :data-tone="converged ? 'ok' : 'err'">
          <span class="cr-title">CRDT</span>
          <span v-for="p in result.peers" :key="p.name" class="cr-mono">{{ p.name }}: {{ show(p.final) }}</span>
          <span class="cr-note">
            перебраны все порядки доставки ({{ ordersTotal }}):
            {{ orders.length === 1 ? `итог один — ${show(orders[0][0])}` : `итогов ${orders.length}` }}
          </span>
        </div>
        <div class="cr-verdict" :data-tone="naiveRight ? 'ok' : naiveSame ? 'warn' : 'err'">
          <span class="cr-title">по индексам</span>
          <span v-for="p in result.peers" :key="p.name" class="cr-mono">{{ p.name }}: {{ show(p.naive) }}</span>
          <span class="cr-note">{{ naiveVerdict }}</span>
        </div>
        <div class="cr-verdict" :data-tone="sameAsYjs ? 'ok' : 'warn'">
          <span class="cr-title">Yjs 13.6</span>
          <span class="cr-mono">{{ show(scenario.yjs) }}</span>
          <span class="cr-note">{{ sameAsYjs ? 'то же, что у мини-реализации' : 'другое правило порядка — другой, но тоже общий итог' }}</span>
        </div>
      </div>

      <Md class="cr-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.cr-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
}
.cr-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.cr-peers,
.cr-verdicts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
}
.cr-peer,
.cr-block,
.cr-verdict {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
  min-width: 0;
}
.cr-verdict[data-tone='ok'] {
  background: var(--tone-ok-bg);
}
.cr-verdict[data-tone='warn'] {
  background: var(--tone-warn-bg);
}
.cr-verdict[data-tone='err'] {
  background: var(--tone-err-bg);
}
.cr-title {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.cr-text {
  font-family: var(--mono);
  font-size: var(--fs-4);
  color: var(--ink);
}
.cr-mono {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--prose);
  overflow-wrap: anywhere;
}
.cr-note {
  font-size: var(--fs-3);
  color: var(--prose);
}
.cr-ops,
.cr-steps {
  margin: 0;
  padding-left: 1.4em;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.cr-step {
  color: var(--prose);
}
.cr-step > span {
  margin-right: 10px;
}
.cr-step > .cr-mono:first-child {
  white-space: nowrap;
}
.cr-step[data-state='wait'] .cr-note {
  color: var(--tone-warn-text);
}
.cr-after {
  color: var(--ink);
}
.cr-items {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.cr-chip {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  min-width: 2.6em;
  padding: 4px 6px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--surface);
  color: var(--ink);
}
.cr-chip[data-state='tomb'] {
  background: var(--tone-err-bg);
  border-color: var(--tone-err-line);
  color: var(--tone-err-text);
}
.cr-chip[data-state='tomb'] .cr-char {
  text-decoration: line-through;
}
.cr-char {
  font-family: var(--mono);
  font-size: var(--fs-4);
  font-weight: 600;
}
.cr-id {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.cr-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.cr-caption :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
</style>
