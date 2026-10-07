<script setup lang="ts">
/**
 * «Контроллер по шагам»: StatefulSet `db` из сквозного листинга темы, его поды и их заявки.
 *
 * Считает не этот компонент, а строка `SIM_CODE` из темы, собранная `new Function`
 * (`model/run.ts`). Та же строка напечатана в теме и прогоняется тестом по случаям из
 * документации, поэтому демо не может «знать» больше, чем показанный код. Компонент только
 * хранит состояние набора, зовёт функции модели на кнопках и рисует, что они вернули.
 *
 * Сборка функции и установление трёх реплик — дешёвые (десяток проходов на объекте из трёх
 * подов), поэтому живут в `setup`: двойная цена сервера и гидратации здесь ничтожна.
 *
 * Состояние меняют только обработчики кликов — ни одна функция, вызываемая из шаблона,
 * не пишет в реактивное (см. AGENTS.md о записи из функции-`ref`).
 */
import { computed, ref, shallowRef } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button, SegmentedControl } from '@/shared/ui';
import { loadSim, settled } from '../model/run';
import type { ClaimPolicy, LogEntry, LogKind, PodPolicy, SetSpec, SetState } from '../model/types';

const props = defineProps<{
  code: string;
  /** Набор из сквозного листинга темы; согласованность с листингом сверяет тест. */
  spec: SetSpec;
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const sim = loadSim(props.code);

/** Сколько мест под поды рисовать: номера 0…MAX−1. */
const MAX = 6;

const POLICIES = [
  { value: 'OrderedReady', label: 'OrderedReady' },
  { value: 'Parallel', label: 'Parallel' },
];
const CLAIM_POLICIES = [
  { value: 'Retain', label: 'Retain' },
  { value: 'Delete', label: 'Delete' },
];
const REPLICAS = Array.from({ length: MAX }, (_, i) => ({ value: String(i), label: String(i) }));

interface Group {
  id: number;
  who: 'вы' | 'контроллер' | 'кластер';
  entries: LogEntry[];
}

const policy = ref<PodPolicy>('OrderedReady');
const whenScaled = ref<ClaimPolicy>('Retain');
const whenDeleted = ref<ClaimPolicy>('Retain');
const set = shallowRef<SetState>(fresh());
const history = ref<Group[]>([]);
let seq = 0;

function fresh(): SetState {
  return settled(sim, {
    ...props.spec,
    podManagementPolicy: policy.value,
    retention: { whenScaled: whenScaled.value, whenDeleted: whenDeleted.value },
  });
}

function record(who: Group['who'], entries: LogEntry[]) {
  if (!entries.length) return;
  history.value = [{ id: ++seq, who, entries }, ...history.value].slice(0, 16);
}

function note(text: string): LogEntry {
  return { kind: 'idle', ord: -1, text };
}

// ── Правки объекта: как `kubectl apply` ───────────────────────────────────────────────

const replicas = computed({
  get: () => String(set.value.replicas),
  set: (v: string) => {
    const n = Number(v);
    if (n === set.value.replicas || set.value.deleted) return;
    record('вы', [note(`replicas: ${set.value.replicas} → ${n}`)]);
    set.value = sim.scale(set.value, n);
  },
});

const partition = computed({
  get: () => set.value.partition,
  set: (n: number) => {
    if (n === set.value.partition || set.value.deleted) return;
    record('вы', [note(`partition: ${set.value.partition} → ${n}`)]);
    set.value = sim.setPartition(set.value, n);
  },
});

const policyModel = computed({
  get: () => policy.value,
  set: (v: string) => {
    if (v === policy.value) return;
    policy.value = v as PodPolicy;
    reset(`podManagementPolicy: ${v} — поле неизменяемо, набор создан заново`);
  },
});

function retentionModel(which: 'whenScaled' | 'whenDeleted') {
  const target = which === 'whenScaled' ? whenScaled : whenDeleted;
  return computed({
    get: () => target.value,
    set: (v: string) => {
      if (v === target.value || set.value.deleted) return;
      target.value = v as ClaimPolicy;
      record('вы', [note(`persistentVolumeClaimRetentionPolicy.${which}: ${v}`)]);
      set.value = sim.setRetention(set.value, { whenScaled: whenScaled.value, whenDeleted: whenDeleted.value });
    },
  });
}
const scaledModel = retentionModel('whenScaled');
const deletedModel = retentionModel('whenDeleted');

function updateImage() {
  const next = sim.updateImage(set.value);
  record('вы', [note(`образ сменён: шаблон v${set.value.updateRevision} → v${next.updateRevision}`)]);
  set.value = next;
}

function removeSet() {
  record('вы', [note('kubectl delete statefulset db')]);
  set.value = sim.remove(set.value);
}

function reset(why = 'набор создан заново: три реплики на v1, все готовы') {
  set.value = fresh();
  history.value = [];
  record('вы', [note(why)]);
}

// ── Проход контроллера и события кластера ─────────────────────────────────────────────

function step() {
  const r = sim.step(set.value);
  set.value = r.set;
  record('контроллер', r.log);
}

function markReady(ord: number) {
  const r = sim.ready(set.value, ord);
  set.value = r.set;
  record('кластер', r.log);
}

function killPod(ord: number) {
  const r = sim.kill(set.value, ord);
  set.value = r.set;
  record('кластер', r.log);
}

// ── Вид ───────────────────────────────────────────────────────────────────────────────

type PodView = 'none' | 'pending' | 'ready' | 'terminating';
type ClaimView = 'none' | 'bound' | 'orphan' | 'doomed';

interface Slot {
  ord: number;
  pod: string;
  claim: string;
  state: PodView;
  rev: number | null;
  stale: boolean;
  claimState: ClaimView;
  wanted: boolean;
}

const POD_LABEL: Record<PodView, string> = {
  none: 'пода нет',
  pending: 'создан, не Ready',
  ready: 'Ready',
  terminating: 'завершается',
};
const CLAIM_LABEL: Record<ClaimView, string> = {
  none: 'заявки нет',
  bound: 'подключена',
  orphan: 'без пода — диск цел',
  doomed: 'удалится вслед за подом',
};

const slots = computed<Slot[]>(() => {
  const s = set.value;
  return Array.from({ length: MAX }, (_, ord) => {
    const p = s.pods.find((x) => x.ord === ord);
    const c = s.claims.find((x) => x.ord === ord);
    const state: PodView = !p ? 'none' : p.terminating ? 'terminating' : p.ready ? 'ready' : 'pending';
    const claimState: ClaimView = !c ? 'none' : c.owner === 'pod' ? 'doomed' : p ? 'bound' : 'orphan';
    return {
      ord,
      pod: sim.podName(s, ord),
      claim: sim.claimName(s, ord),
      state,
      rev: p ? p.rev : null,
      stale: Boolean(p && p.rev !== s.updateRevision),
      claimState,
      wanted: !s.deleted && ord < s.replicas,
    };
  });
});

/** Чего контроллер ждёт после последнего прохода — из его же журнала. */
const waiting = computed(() => {
  const last = history.value.find((g) => g.who === 'контроллер');
  const wait = last?.entries.find((e) => e.kind === 'wait');
  return wait ? wait.text : '';
});

const TONE: Partial<Record<LogKind, string>> = {
  create: 'ok',
  claim: 'ok',
  reuse: 'info',
  ready: 'ok',
  wait: 'warn',
  delete: 'err',
  update: 'warn',
  doom: 'err',
  'claim-gone': 'err',
  kill: 'err',
  keep: 'info',
  done: 'ok',
};
const toneOf = (kind: LogKind) => TONE[kind] ?? 'muted';
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="sts-toolbar">
        <div class="sts-control">
          <span class="sts-label">podManagementPolicy</span>
          <SegmentedControl v-model="policyModel" class="l-pills" label="Политика подов" :options="POLICIES" />
        </div>
        <div class="sts-control">
          <span class="sts-label">whenScaled</span>
          <SegmentedControl v-model="scaledModel" class="l-pills" label="Заявки при уменьшении" :options="CLAIM_POLICIES" />
        </div>
        <div class="sts-control">
          <span class="sts-label">whenDeleted</span>
          <SegmentedControl v-model="deletedModel" class="l-pills" label="Заявки при удалении набора" :options="CLAIM_POLICIES" />
        </div>
      </div>
    </template>

    <div class="sts-body">
      <div class="sts-controls">
        <div class="sts-control">
          <span class="sts-label">масштабировать до</span>
          <SegmentedControl v-model="replicas" class="l-pills" label="Число реплик" :options="REPLICAS" />
        </div>
        <div class="sts-control sts-control--range">
          <label class="sts-label" for="sts-partition">partition</label>
          <input
            id="sts-partition"
            v-model.number="partition"
            class="sts-range"
            type="range"
            min="0"
            :max="MAX - 1"
            step="1"
            :disabled="set.deleted"
          />
          <output class="sts-value" for="sts-partition">{{ set.partition }}</output>
        </div>
      </div>

      <div class="sts-actions">
        <Button variant="primary" @click="step()">проход контроллера</Button>
        <Button variant="secondary" :disabled="set.deleted" @click="updateImage()">обновить образ</Button>
        <Button variant="secondary" :disabled="set.deleted" @click="removeSet()">удалить StatefulSet</Button>
        <Button variant="secondary" @click="reset()">сначала</Button>
      </div>

      <div class="sts-status">
        <span>replicas <b>{{ set.deleted ? '—' : set.replicas }}</b></span>
        <span>шаблон <b>v{{ set.updateRevision }}</b></span>
        <span>текущая ревизия <b>v{{ set.currentRevision }}</b></span>
        <span>partition <b>{{ set.partition }}</b></span>
        <span v-if="set.deleted" class="sts-status__alert">StatefulSet удалён</span>
        <span v-else-if="waiting" class="sts-status__wait">{{ waiting }}</span>
      </div>

      <ul class="sts-slots">
        <li
          v-for="slot in slots"
          :key="slot.ord"
          class="sts-slot"
          :data-state="slot.state"
          :data-wanted="slot.wanted ? 'yes' : 'no'"
        >
          <div class="sts-slot__head">
            <code class="sts-slot__name">{{ slot.pod }}</code>
            <span v-if="slot.rev !== null" class="sts-rev" :data-stale="slot.stale ? 'yes' : 'no'">v{{ slot.rev }}</span>
          </div>
          <span class="sts-slot__state">{{ POD_LABEL[slot.state] }}</span>
          <div class="sts-slot__buttons">
            <button v-if="slot.state === 'pending'" type="button" class="sts-mini" @click="markReady(slot.ord)">готов</button>
            <button
              v-if="slot.state === 'pending' || slot.state === 'ready'"
              type="button"
              class="sts-mini"
              @click="killPod(slot.ord)"
            >
              уронить
            </button>
          </div>
          <div class="sts-claim" :data-claim="slot.claimState">
            <code class="sts-claim__name">{{ slot.claimState === 'none' ? '—' : slot.claim }}</code>
            <span class="sts-claim__state">{{ CLAIM_LABEL[slot.claimState] }}</span>
          </div>
        </li>
      </ul>

      <div class="sts-log">
        <span class="sts-label">журнал — новое сверху</span>
        <ol class="sts-log__list">
          <li v-for="g in history" :key="g.id" class="sts-group">
            <span class="sts-group__who" :data-who="g.who">{{ g.who }}</span>
            <ul class="sts-group__entries">
              <li v-for="(e, i) in g.entries" :key="i" class="sts-entry" :data-tone="toneOf(e.kind)">{{ e.text }}</li>
            </ul>
          </li>
        </ol>
      </div>
    </div>

    <template #footer>
      <Md class="sts-caption" :text="caption" />
    </template>
  </DemoFrame>
</template>

<style scoped>
.sts-toolbar,
.sts-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 22px;
}
.sts-control {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.sts-control--range {
  flex: 1 1 220px;
}
.sts-label {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}

.sts-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}

/* Ползунок целиком свой: у системного контрола свои цвета и свой шрифт, а в курсе
   ни того, ни другого нет. */
.sts-range {
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
.sts-range::-webkit-slider-thumb {
  appearance: none;
  width: 14px;
  height: 14px;
  border: 0;
  border-radius: var(--r-full);
  background: var(--accent);
  cursor: pointer;
}
.sts-range::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border: 0;
  border-radius: var(--r-full);
  background: var(--accent);
  cursor: pointer;
}
.sts-value {
  min-width: 2ch;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
}

.sts-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.sts-status {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.sts-status b {
  color: var(--ink);
  font-weight: 600;
}
.sts-status__wait {
  color: var(--tone-warn-text);
}
.sts-status__alert {
  color: var(--tone-err-text);
}

.sts-slots {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.sts-slot {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--surface);
  font-size: var(--fs-2);
}
.sts-slot[data-wanted='no'] {
  border-style: dashed;
  background: var(--surface-2);
}
.sts-slot[data-state='ready'] {
  border-color: var(--tone-ok-line);
}
.sts-slot[data-state='pending'] {
  border-color: var(--tone-warn-line);
  background: var(--tone-warn-bg);
}
.sts-slot[data-state='terminating'] {
  border-color: var(--tone-err-line);
  background: var(--tone-err-bg);
}
.sts-slot__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.sts-slot__name {
  font-family: var(--mono);
  font-size: var(--fs-3);
  font-weight: 600;
  color: var(--ink);
}
.sts-slot[data-state='none'] .sts-slot__name {
  color: var(--text-faint);
}
.sts-rev {
  padding: 1px 7px;
  border-radius: var(--r-full);
  font-family: var(--mono);
  font-size: var(--fs-3);
}
.sts-rev[data-stale='no'] {
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
}
.sts-rev[data-stale='yes'] {
  background: var(--tone-warn-chip);
  color: var(--tone-warn-text);
}
.sts-slot__state {
  color: var(--text-muted);
}
.sts-slot[data-state='ready'] .sts-slot__state {
  color: var(--tone-ok-text);
}
.sts-slot[data-state='pending'] .sts-slot__state {
  color: var(--tone-warn-text);
}
.sts-slot[data-state='terminating'] .sts-slot__state {
  color: var(--tone-err-text);
}
.sts-slot__buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-height: 24px;
}
.sts-mini {
  font: inherit;
  color: inherit;
  padding: 2px 9px;
  border: 1px solid var(--border-strong);
  border-radius: var(--r-full);
  background: var(--surface);
  color: var(--chip-text);
  font-family: var(--mono);
  font-size: var(--fs-3);
  cursor: pointer;
}
.sts-mini:hover {
  border-color: var(--ink);
  color: var(--ink);
}
.sts-mini:focus-visible {
  outline: 2px solid var(--tone-info-line);
  outline-offset: 1px;
}
.sts-claim {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-top: 8px;
  border-top: 1px solid var(--rule);
}
.sts-claim__name {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
  overflow-wrap: anywhere;
}
.sts-claim__state {
  font-size: var(--fs-3);
  color: var(--text-muted);
}
.sts-claim[data-claim='none'] .sts-claim__name {
  color: var(--text-faint);
}
.sts-claim[data-claim='orphan'] .sts-claim__state {
  color: var(--tone-info-text);
}
.sts-claim[data-claim='doomed'] .sts-claim__state {
  color: var(--tone-err-text);
}

.sts-log {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.sts-log__list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 320px;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}
.sts-group {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  gap: 10px;
  font-size: var(--fs-2);
  line-height: 1.5;
}
@media (max-width: 560px) {
  .sts-group {
    grid-template-columns: minmax(0, 1fr);
    gap: 2px;
  }
}
.sts-group__who {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}
.sts-group__who[data-who='контроллер'] {
  color: var(--tone-info-text);
}
.sts-group__entries {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.sts-entry {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--prose);
  overflow-wrap: anywhere;
}
.sts-entry[data-tone='ok'] {
  color: var(--tone-ok-text);
}
.sts-entry[data-tone='warn'] {
  color: var(--tone-warn-text);
}
.sts-entry[data-tone='err'] {
  color: var(--tone-err-text);
}
.sts-entry[data-tone='info'] {
  color: var(--tone-info-text);
}
.sts-entry[data-tone='muted'] {
  color: var(--text-muted);
}

.sts-caption {
  font-size: var(--fs-2);
  line-height: 1.55;
  color: var(--text-muted);
}
.sts-caption :deep(code) {
  font-family: var(--mono);
  /* Не ниже ступени `--fs-2`: в подписи на `--fs-2` доля .92em давала 10.9px. */
  font-size: max(0.92em, var(--fs-2));
}
</style>
