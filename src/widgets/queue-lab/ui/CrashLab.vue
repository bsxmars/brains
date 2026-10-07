<script setup lang="ts">
/**
 * «Все точки падения»: выбранный издатель и обработчик, прогон всей цепочки по разу на каждую
 * метку `point` — и итог каждого прогона.
 *
 * Перебор делает `crashTable` (`model/run.ts`) над учебной моделью — строками `*_CODE` темы.
 * `tests/unit/queues.test.ts` сверяет тот же перебор с литералом `STAND_FULL`, снятым на настоящих
 * Redis 7.4 и PGlite, на всех двенадцати вариантах.
 */
import { computed, ref, shallowRef, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { crashTable, loadModel, outcomeOf, type CrashRow, type Outcome } from '../model/run';
import type { Final, Handler, Producer, Step } from '../model/types';

const props = defineProps<{
  parts: string[];
  schedule: Step[];
  producers: readonly { value: Producer; label: string }[];
  handlers: readonly { value: Handler; label: string }[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const model = loadModel(props.parts);

const producer = ref<Producer>('outbox');
const handler = ref<Handler>('idempotent');
const producerOptions = props.producers.map((o) => ({ value: o.value, label: o.label }));
const handlerOptions = props.handlers.map((o) => ({ value: o.value, label: o.label }));

const rows = shallowRef<CrashRow[]>([]);
const clean = shallowRef<Final | null>(null);

let ticket = 0;
watch(
  [producer, handler],
  async ([p, h]) => {
    const my = ++ticket;
    const r = await crashTable(model, props.schedule, { producer: p, handler: h });
    if (my !== ticket) return;
    rows.value = r.rows;
    clean.value = r.clean.final;
  },
  { immediate: true },
);

const LABEL: Record<Outcome, string> = { once: 'ровно один', lost: 'потеряно', extra: 'лишнее' };
const TONE: Record<Outcome, string> = { once: 'ok', lost: 'err', extra: 'err' };

const count = (o: Outcome) => rows.value.filter((r) => r.outcome === o).length;
const summary = computed(
  () =>
    `Меток: **${rows.value.length}**. Ровно один раз — ${count('once')}, потеряно — ${count('lost')}, лишнее — ${count('extra')}.`,
);
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="cl-bar">
        <SegmentedControl v-model="producer" class="l-pills" label="Издатель" :options="producerOptions" />
        <SegmentedControl v-model="handler" class="l-pills" label="Обработчик" :options="handlerOptions" />
      </div>
    </template>

    <div class="cl-body">
      <Md class="cl-note" :text="summary" />

      <div class="cl-scroll">
        <div class="cl-table" role="table" aria-label="Итог для каждой точки падения">
          <div class="cl-row cl-row--head" role="row">
            <span role="columnheader">где упал процесс</span>
            <span role="columnheader">заказов</span>
            <span role="columnheader">бонусов</span>
            <span role="columnheader">итог</span>
          </div>
          <div v-if="clean" class="cl-row" role="row" data-tone="ok">
            <span role="cell" class="cl-at">без падения</span>
            <code role="cell">{{ clean.orders }}</code>
            <code role="cell">{{ clean.points }}</code>
            <span role="cell" class="cl-out">{{ LABEL[outcomeOf(clean)] }}</span>
          </div>
          <div v-for="r in rows" :key="r.at" class="cl-row" role="row" :data-tone="TONE[r.outcome]">
            <code role="cell" class="cl-at">{{ r.at }}</code>
            <code role="cell">{{ r.final.orders }}</code>
            <code role="cell">{{ r.final.points }}</code>
            <span role="cell" class="cl-out">{{ LABEL[r.outcome] }}</span>
          </div>
        </div>
      </div>

      <Md class="cl-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.cl-bar {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.cl-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
  min-width: 0;
}
.cl-note,
.cl-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.cl-body :deep(code),
.cl-body code {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
.cl-scroll {
  max-width: 100%;
  overflow-x: auto;
}
.cl-table {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 520px;
}
.cl-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 5.5em 5.5em 8em;
  gap: 10px;
  align-items: baseline;
  padding: 6px 10px;
  border-radius: var(--r2);
  background: var(--surface-2);
  font-size: var(--fs-3);
  color: var(--prose);
}
.cl-row--head {
  background: none;
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.cl-row code {
  justify-self: start;
  color: var(--ink);
}
.cl-table {
  --inline-code-bg: transparent;
}
.cl-at {
  overflow-wrap: anywhere;
}
.cl-row[data-tone='ok'] .cl-out {
  color: var(--tone-ok-text);
}
.cl-row[data-tone='err'] {
  background: var(--tone-err-bg);
}
.cl-row[data-tone='err'] .cl-out {
  color: var(--tone-err-text);
  font-weight: 600;
}
</style>
