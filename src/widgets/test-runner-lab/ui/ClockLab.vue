<script setup lang="ts">
/**
 * «Часы под контролем»: расписание `CLOCK_SCENARIO_CODE` на учебных часах `CLOCK_CODE`.
 * Время идёт только по кнопке; видны очередь таймеров и журнал срабатываний.
 *
 * Часы и очередь считают строки темы, собранные `new Function` (`model/run.ts`).
 * `tests/unit/test-runners.test.ts` сверяет `createClock` с `@sinonjs/fake-timers`
 * на сотнях случайных расписаний, а прокрутку на 120 мс — с журналом настоящих Vitest и Jest.
 */
import { computed, ref, shallowRef } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button } from '@/shared/ui';
import { loadClock, startScenario } from '../model/run';
import type { Clock, PendingTimer } from '../model/types';

const props = defineProps<{
  clockCode: string;
  scenarioCode: string;
  /** Подписи таймеров по номеру, который выдают часы. */
  labels: Record<number, string>;
  /** Номер интервала в расписании — его можно снять. */
  intervalId: number;
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const createClock = loadClock(props.clockCode);

interface View {
  now: number;
  pending: PendingTimer[];
  log: { text: string; tone: 'fire' | 'info' | 'err' }[];
}

let clock: Clock;
let lines: View['log'] = [];
const view = shallowRef<View>({ now: 0, pending: [], log: [] });
const intervalOn = ref(true);

function snapshot() {
  view.value = { now: clock.now(), pending: clock.pending(), log: [...lines] };
}

function reset() {
  lines = [];
  clock = startScenario(createClock, props.scenarioCode, (s) => lines.push({ text: s, tone: 'fire' }));
  intervalOn.value = true;
  snapshot();
}
reset();

function advance(ms: number) {
  lines.push({ text: `— прокрутка на ${ms} мс`, tone: 'info' });
  clock.advance(ms);
  snapshot();
}

function runAll() {
  lines.push({ text: '— выполнить всё', tone: 'info' });
  try {
    clock.runAll();
  } catch (e) {
    lines.push({ text: `ошибка: ${(e as Error).message}`, tone: 'err' });
  }
  snapshot();
}

function stopInterval() {
  clock.clearInterval(props.intervalId);
  intervalOn.value = false;
  lines.push({ text: '— интервал C снят', tone: 'info' });
  snapshot();
}

/** Журнал длинный после «выполнить всё»: показываем хвост. */
const tail = computed(() => view.value.log.slice(-14));
const hidden = computed(() => Math.max(0, view.value.log.length - tail.value.length));
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="cl-actions" role="group" aria-label="Время">
        <Button variant="secondary" @click="advance(10)">+10 мс</Button>
        <Button variant="secondary" @click="advance(40)">+40 мс</Button>
        <Button variant="secondary" @click="advance(120)">+120 мс</Button>
        <Button variant="secondary" :disabled="!intervalOn" @click="stopInterval">снять интервал C</Button>
        <Button variant="secondary" @click="runAll">выполнить всё</Button>
        <Button variant="secondary" @click="reset">заново</Button>
      </div>
    </template>

    <div class="cl-body">
      <div class="cl-status" aria-live="polite">
        <span>часы: <b>{{ view.now }} мс</b></span>
        <span>таймеров в очереди: <b>{{ view.pending.length }}</b></span>
      </div>

      <div class="cl-split">
        <section class="cl-pane" aria-label="Очередь таймеров">
          <span class="cl-label">очередь — по времени, затем по порядку постановки</span>
          <ol v-if="view.pending.length" class="cl-queue">
            <li v-for="t in view.pending" :key="t.id" class="cl-timer" :data-every="t.every ? 'yes' : 'no'">
              <b>{{ labels[t.id] ?? `#${t.id}` }}</b>
              <span>в {{ t.at }} мс</span>
              <span class="cl-timer__meta">{{ t.every ? `интервал ${t.every} мс` : 'один раз' }}</span>
            </li>
          </ol>
          <span v-else class="cl-empty">очередь пуста</span>
        </section>

        <section class="cl-pane" aria-label="Журнал">
          <span class="cl-label">журнал</span>
          <div class="cl-log" role="log">
            <div v-if="!tail.length" class="cl-log__line" data-tone="info">пока ничего не сработало: время стоит</div>
            <div v-if="hidden" class="cl-log__line" data-tone="info">… ещё {{ hidden }} строк выше</div>
            <div v-for="(l, i) in tail" :key="i" class="cl-log__line" :data-tone="l.tone">{{ l.text }}</div>
          </div>
        </section>
      </div>

      <Md class="cl-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.cl-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.cl-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.cl-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.cl-caption :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
.cl-status {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 18px;
  padding: 10px 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
  font-size: var(--fs-3);
  color: var(--text-muted);
}
.cl-status b {
  font-family: var(--mono);
  color: var(--ink);
}
.cl-split {
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 760px) {
  .cl-split {
    grid-template-columns: minmax(0, 1fr);
  }
}
.cl-pane {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.cl-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.cl-queue {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.cl-timer {
  display: grid;
  grid-template-columns: 2em 6em minmax(0, 1fr);
  gap: 8px;
  align-items: baseline;
  padding: 6px 10px;
  border-radius: var(--r2);
  background: var(--tone-info-bg);
  font-size: var(--fs-3);
  color: var(--prose);
}
.cl-timer[data-every='yes'] {
  background: var(--tone-warn-bg);
}
.cl-timer b {
  font-family: var(--mono);
  color: var(--ink);
}
.cl-timer__meta,
.cl-empty {
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.cl-log {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--ink);
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.6;
  color: var(--code-fg);
}
.cl-log__line {
  overflow-wrap: anywhere;
}
.cl-log__line[data-tone='info'] {
  color: var(--ink-faint);
}
.cl-log__line[data-tone='err'] {
  color: var(--tone-warn-on-ink);
}
</style>
