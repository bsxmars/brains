<script setup lang="ts">
/**
 * «Кеш в работе»: одна запись `['todos']`, два компонента-наблюдателя, сервер с задержкой
 * и виртуальные часы. Сценарий из темы проигрывается шагами, дальше можно продолжать руками.
 *
 * Считает не компонент, а строки мини-кеша из темы, собранные `new Function` в `model/run.ts`.
 * `tests/unit/data-cache.test.ts` прогоняет тот же `createLab` по тем же сценариям и сверяет
 * запросы и состояния наблюдателей с `@tanstack/query-core`.
 */
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button, SegmentedControl } from '@/shared/ui';
import { createLab, describe } from '../model/run';
import type { Lab, LabView, MiniCodes, Scenario, Step, Who } from '../model/types';

const props = defineProps<{
  codes: MiniCodes;
  scenarios: Scenario[];
  staleOptions: { value: string; label: string; ms: number }[];
  latency: number;
  todos: string[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const scenarioId = ref(props.scenarios[0].id);
const staleValue = ref(props.staleOptions[0].value);
const scenarioOptions = props.scenarios.map((s) => ({ value: s.id, label: s.label }));
const staleOptionsList = props.staleOptions.map((o) => ({ value: o.value, label: o.label }));

const scenario = computed(() => props.scenarios.find((s) => s.id === scenarioId.value) ?? props.scenarios[0]);
const staleMs = computed(() => props.staleOptions.find((o) => o.value === staleValue.value)?.ms ?? 0);

let lab: Lab | null = null;
const view = shallowRef<LabView | null>(null);
const busy = ref(false);
let generation = 0;
let added = 0;

async function replay() {
  const mine = ++generation;
  lab?.stop();
  added = 0;
  lab = createLab(props.codes, { staleTime: staleMs.value, latency: props.latency, todos: props.todos });
  view.value = lab.view();
  busy.value = true;
  for (const step of scenario.value.steps) {
    if (mine !== generation) return;
    if (step.do === 'add') added++;
    await lab.run(step);
    view.value = lab.view();
  }
  if (mine === generation) busy.value = false;
}

watch([scenarioId, staleValue], replay);
void replay();
onBeforeUnmount(() => {
  generation++;
  lab?.stop();
});

async function act(step: Step) {
  if (!lab || busy.value) return;
  busy.value = true;
  await lab.run(step);
  view.value = lab.view();
  busy.value = false;
}

function nextTitle() {
  added++;
  return added === 1 ? 'хлеб' : `дело ${added}`;
}

const NAMES: Record<Who, string> = { A: 'A — шапка', B: 'B — список' };

/** `1300` → «1,3 с», `301000` → «5 мин 1,0 с». */
function time(ms: number): string {
  const min = Math.floor(ms / 60_000);
  const s = ((ms % 60_000) / 1000).toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return min ? `${min} мин ${s} с` : `${s} с`;
}

const log = computed(() => (view.value?.log ?? []).slice(-60));
const logBox = ref<HTMLElement | null>(null);
watch(log, () => {
  requestAnimationFrame(() => {
    if (logBox.value) logBox.value.scrollTop = logBox.value.scrollHeight;
  });
});

const entryRows = computed(() => {
  const e = view.value?.entry;
  if (!e) return [];
  return [
    { k: 'status', v: e.status },
    { k: 'fetchStatus', v: e.fetchStatus },
    { k: 'data', v: e.data },
    { k: 'updatedAt', v: e.updatedAt ? time(e.updatedAt) : '—' },
    { k: 'устарели', v: e.stale ? 'да' : 'нет' },
    { k: 'наблюдателей', v: String(e.observers) },
    { k: 'promise', v: e.inFlight ? 'запрос в пути' : 'null' },
    { k: 'failures', v: String(e.failures) },
  ];
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="qcl-controls">
        <div class="qcl-control">
          <span class="t-label">сценарий</span>
          <SegmentedControl v-model="scenarioId" class="l-pills" label="Сценарий" :options="scenarioOptions" />
        </div>
        <div class="qcl-control">
          <span class="t-label">staleTime</span>
          <SegmentedControl v-model="staleValue" class="l-pills" label="staleTime" :options="staleOptionsList" />
        </div>
      </div>
    </template>

    <div class="qcl-body">
      <Md class="qcl-note" :text="scenario.note" />

      <div class="qcl-actions" role="group" aria-label="Действия">
        <div class="qcl-row">
          <span class="qcl-row__label">компоненты</span>
          <template v-for="c in view?.components ?? []" :key="c.id">
            <Button variant="secondary" :disabled="busy" @click="act({ do: c.mounted ? 'unmount' : 'mount', who: c.id })">
              {{ c.mounted ? 'убрать' : 'показать' }} {{ c.id }}
            </Button>
          </template>
        </div>
        <div class="qcl-row">
          <span class="qcl-row__label">события</span>
          <Button variant="secondary" :disabled="busy" @click="act({ do: 'focus' })">окно в фокусе</Button>
          <Button variant="secondary" :disabled="busy" @click="act({ do: 'add', title: nextTitle() })">добавить дело</Button>
          <Button variant="secondary" :disabled="busy" @click="act({ do: 'add', title: nextTitle(), fail: true })">добавить, сервер откажет</Button>
          <Button variant="secondary" :disabled="busy" @click="act({ do: 'serverFails', n: 3 })">сервер: 3 ошибки</Button>
        </div>
        <div class="qcl-row">
          <span class="qcl-row__label">время</span>
          <Button variant="secondary" :disabled="busy" @click="act({ do: 'wait', ms: 100 })">+0,1 с</Button>
          <Button variant="secondary" :disabled="busy" @click="act({ do: 'wait', ms: 1000 })">+1 с</Button>
          <Button variant="secondary" :disabled="busy" @click="act({ do: 'wait', ms: 5000 })">+5 с</Button>
          <Button variant="secondary" :disabled="busy" @click="act({ do: 'wait', ms: 300_000 })">+5 мин</Button>
          <Button variant="secondary" :disabled="busy" @click="replay">заново</Button>
        </div>
      </div>

      <div class="qcl-status" aria-live="polite">
        <span>сейчас <b>{{ time(view?.now ?? 0) }}</b></span>
        <span>запросов к серверу: <b>{{ view?.calls.length ?? 0 }}</b></span>
      </div>

      <div class="qcl-grid">
        <section
          v-for="c in view?.components ?? []"
          :key="c.id"
          class="qcl-card"
          :data-mounted="c.mounted ? 'yes' : 'no'"
          :aria-label="`Компонент ${NAMES[c.id]}`"
        >
          <div class="qcl-card__head">
            <span class="qcl-card__name">{{ NAMES[c.id] }}</span>
            <span class="qcl-card__badge">{{ c.mounted ? 'на странице' : 'не на странице' }}</span>
          </div>
          <code class="qcl-card__state">{{ c.last ? describe(c.last) : '—' }}</code>
          <span class="qcl-card__meta">новых состояний: {{ c.seen }}</span>
        </section>

        <section class="qcl-card qcl-card--entry" aria-label="Запись кеша">
          <div class="qcl-card__head">
            <span class="qcl-card__name">кеш: {{ view?.entry?.hash ?? '["todos"]' }}</span>
          </div>
          <dl v-if="view?.entry" class="qcl-entry">
            <div v-for="r in entryRows" :key="r.k">
              <dt>{{ r.k }}</dt>
              <dd>{{ r.v }}</dd>
            </div>
          </dl>
          <span v-else class="qcl-card__meta">записи нет — удалена или ещё не создана</span>
        </section>
      </div>

      <div ref="logBox" class="qcl-log" role="log" aria-label="Журнал событий">
        <div v-for="(l, i) in log" :key="i" class="qcl-log__line" :data-tone="l.tone ?? 'none'">
          <span class="qcl-log__t">{{ time(l.t) }}</span>
          <span class="qcl-log__who">{{ l.who }}</span>
          <span class="qcl-log__text">{{ l.text }}</span>
        </div>
      </div>

      <Md class="qcl-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.qcl-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 20px;
}
.qcl-control {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  max-width: 100%;
}

.qcl-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.qcl-note,
.qcl-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.qcl-note :deep(code),
.qcl-caption :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}

.qcl-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.qcl-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.qcl-row__label {
  min-width: 7.5em;
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.qcl-status {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 18px;
  padding: 10px 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
  font-size: var(--fs-3);
  color: var(--text-muted);
}
.qcl-status b {
  font-family: var(--mono);
  color: var(--ink);
}

.qcl-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
  gap: 12px;
}
.qcl-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  padding: 14px;
  border-radius: var(--r3);
  background: var(--tone-info-bg);
  box-shadow: inset 0 0 0 1px var(--tone-info-line);
}
.qcl-card[data-mounted='no'] {
  background: var(--surface-2);
  box-shadow: none;
}
.qcl-card--entry {
  background: var(--surface-2);
  box-shadow: none;
}
.qcl-card__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px 10px;
}
.qcl-card__name {
  font-family: var(--mono);
  font-size: var(--fs-3);
  font-weight: 600;
  color: var(--ink);
  overflow-wrap: anywhere;
}
.qcl-card__badge,
.qcl-card__meta {
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.qcl-card__state {
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.5;
  color: var(--ink);
  overflow-wrap: anywhere;
}

.qcl-entry {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin: 0;
}
.qcl-entry > div {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  font-size: var(--fs-3);
}
.qcl-entry dt {
  font-family: var(--mono);
  color: var(--text-muted);
}
.qcl-entry dd {
  margin: 0;
  font-family: var(--mono);
  color: var(--ink);
  text-align: right;
  overflow-wrap: anywhere;
}

.qcl-log {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 260px;
  overflow-y: auto;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--ink);
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.6;
  color: var(--code-fg);
}
.qcl-log__line {
  display: grid;
  grid-template-columns: 8.5em 3.5em minmax(0, 1fr);
  gap: 8px;
}
.qcl-log__t,
.qcl-log__who {
  color: var(--ink-faint);
}
.qcl-log__text {
  overflow-wrap: anywhere;
}
.qcl-log__line[data-tone='ok'] .qcl-log__text {
  color: var(--tone-ok-on-ink);
}
.qcl-log__line[data-tone='err'] .qcl-log__text,
.qcl-log__line[data-tone='warn'] .qcl-log__text {
  color: var(--tone-warn-on-ink);
}
.qcl-log__line[data-tone='info'] .qcl-log__text {
  color: var(--tone-info-on-ink);
}
@media (max-width: 520px) {
  .qcl-log__line {
    display: flex;
    flex-wrap: wrap;
    gap: 0 8px;
  }
}
</style>
