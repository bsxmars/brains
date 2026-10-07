<script setup lang="ts">
/**
 * Пульт ловушек: пятнадцать операций и то, что от них на самом деле доходит до handler'а.
 *
 * Демо построено вокруг одной мысли: **прокси перехватывает внутренние методы, а не
 * синтаксис**. Поэтому в списке рядом стоят операции, дающие шесть ловушек, и операции,
 * не дающие ни одной, — и последние важнее. `p === target`, `typeof p`, `structuredClone(p)`
 * и приватные поля не проходят ни через один внутренний метод, и никакой handler этого
 * не изменит.
 *
 * Журнал и результат считает браузер читателя: строка `TRACE_CODE` из темы собирается
 * `new Function` (`model/run.ts`), и каждая операция выполняется над настоящим прокси.
 * Из литерала берутся только подписи к ловушкам и тон; тот же модуль гоняет
 * `tests/unit/proxy-reflect.test.ts` и сверяет журнал с литералом.
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { loadTrace, runOp } from '../model/run';
import type { ProxyOp } from '../model/types';

const props = defineProps<{
  ops: ProxyOp[];
  /** Строка `TRACE_CODE` темы: функция `trace(target)` с журналом из тринадцати ловушек. */
  traceCode: string;
  /** Выражение общей цели — для операций без своей `target`. */
  target: string;
}>();

const trace = loadTrace(props.traceCode);

const picked = ref('0');
const options = computed(() => props.ops.map((op, i) => ({ value: String(i), label: op.op })));
const op = computed(() => props.ops[Number(picked.value)] ?? props.ops[0]);

/** Настоящий прогон: журнал ловушек, их число и результат. */
const run = computed(() => runOp(trace, op.value, props.target));
const total = computed(() => run.value.total);
/** Подпись к ловушке берётся из литерала, если на этом месте там та же ловушка. */
const noteOf = (i: number, name: string) => {
  const lit = op.value.traps[i];
  return lit && lit.name === name ? lit.note : undefined;
};
const tone = computed(() => op.value.tone ?? (run.value.threw ? 'err' : 'ok'));
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="picked" class="l-pills" label="Операция над прокси" :options="options" />
    </template>

    <div class="head">const p = new Proxy(target, handler) · target = {{ op.target ?? target }}</div>

    <div class="split">
      <div class="pane">
        <div class="row">
          <span class="t-label">какие ловушки вызваны</span>
          <span class="count" :data-zero="total === 0 ? 'yes' : 'no'">
            {{ total === 0 ? 'ни одной' : `ловушек: ${total}` }}
          </span>
        </div>

        <div v-if="!run.calls.length" class="none">
          Операция идёт мимо внутренних методов — перехватить нечем.
        </div>

        <div v-for="(trap, i) in run.calls" :key="i" class="trap">
          <span class="trap__name">
            {{ trap.name }}<span v-if="trap.times && trap.times > 1" class="trap__times"> × {{ trap.times }}</span>
          </span>
          <Md as="span" class="trap__note" :text="noteOf(i, trap.name) ?? 'вызвана один раз'" />
        </div>
      </div>

      <div class="pane pane--right">
        <div class="block">
          <span class="t-label">результат</span>
          <div class="res" :data-tone="tone">{{ run.res }}</div>
        </div>

        <Md as="p" class="note" :text="op.note" />
      </div>
    </div>
  </DemoFrame>
</template>

<style scoped>
.head {
  padding: 12px 18px;
  border-bottom: 1px solid var(--divider);
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.5;
  color: var(--text-faint);
  overflow-wrap: anywhere;
}

.split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
}
.pane {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 20px;
  border-right: 1px solid var(--divider);
  min-width: 0;
}
.pane--right {
  border-right: 0;
  background: var(--surface-2);
  gap: 16px;
}

.row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}
.count {
  padding: 3px 9px;
  border-radius: var(--r-full);
  background: var(--tone-info-chip);
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--tone-info-strong);
  white-space: nowrap;
}
/* Ноль ловушек — не пустота, а вывод. Гасим цвет, но оставляем «пилюлю» на месте. */
.count[data-zero='yes'] {
  background: var(--surface-3);
  color: var(--text-muted);
}

.none {
  padding: 12px 14px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--r2);
  font-size: var(--fs-5);
  line-height: 1.5;
  color: var(--text-muted);
}

.trap {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
}
.trap__name {
  font-family: var(--mono);
  font-size: var(--fs-3);
  font-weight: 600;
  color: var(--tone-info-strong);
}
.trap__times {
  font-weight: 400;
  color: var(--tone-warn-strong);
}
.trap__note {
  font-size: var(--fs-5);
  line-height: 1.45;
  color: var(--text-muted);
}

.block {
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.res {
  padding: 12px 14px;
  border-radius: var(--r2);
  font-family: var(--mono);
  font-size: var(--fs-5);
  line-height: 1.45;
  overflow-wrap: anywhere;
  transition: all 0.2s;
}
.res[data-tone='ok'] {
  border: 1px solid var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-strong);
}
.res[data-tone='warn'] {
  border: 1px solid var(--tone-warn-line);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-strong);
}
.res[data-tone='err'] {
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-strong);
}

.note {
  margin: 0;
  font-size: var(--fs-6);
  line-height: 1.6;
  color: var(--prose);
}

@media (max-width: 720px) {
  .split {
    grid-template-columns: 1fr;
  }
  .pane {
    border-right: 0;
    border-bottom: 1px solid var(--divider);
  }
}
</style>
