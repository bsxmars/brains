<script setup lang="ts">
/**
 * Чередование чтения и записи против «сначала всё прочитали, потом всё записали».
 *
 * Суть темы — одно число, и оно здесь считается, а не заявляется. Правило счёта ровно то же,
 * по которому работает браузер: **запись помечает дерево грязным и ничего не считает; чтение
 * при грязном дереве требует пересчитать немедленно**, после чего дерево снова чистое.
 * Отсюда и разница: в цикле «прочитал — записал» грязь встаёт между чтениями, в двух фазах — нет.
 *
 * ⚠️ Демо считает **операции**, а не миллисекунды: сколько стоит один пересчёт, зависит от
 * страницы, и выдумывать это число нельзя. Проверить счёт можно только в браузере — в Node
 * нет ни DOM, ни лейаута.
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import type { ThrashMode, ThrashOp, ThrashSize } from '../model/types';

const props = defineProps<{
  modes: ThrashMode[];
  sizes: ThrashSize[];
  /** Сколько операций демо рисует фишками. */
  visibleOps: number;
}>();

const modeKey = ref(props.modes[0].key);
const sizeKey = ref(props.sizes[1]?.key ?? props.sizes[0].key);

const modeOptions = computed(() => props.modes.map((m) => ({ value: m.key, label: m.label })));
const sizeOptions = computed(() => props.sizes.map((s) => ({ value: s.key, label: s.label })));

const mode = computed(() => props.modes.find((m) => m.key === modeKey.value) ?? props.modes[0]);
const size = computed(() => props.sizes.find((s) => s.key === sizeKey.value) ?? props.sizes[0]);

/** Последовательность операций цикла: она полностью определяется режимом и числом элементов. */
function build(key: string, items: number): { kind: 'read' | 'write'; n: number }[] {
  const ops: { kind: 'read' | 'write'; n: number }[] = [];
  if (key === 'split') {
    for (let i = 1; i <= items; i += 1) ops.push({ kind: 'read', n: i });
    for (let i = 1; i <= items; i += 1) ops.push({ kind: 'write', n: i });
    return ops;
  }
  for (let i = 1; i <= items; i += 1) {
    ops.push({ kind: 'read', n: i });
    ops.push({ kind: 'write', n: i });
  }
  return ops;
}

/**
 * Счёт по правилу браузера. Возвращает те же операции, но с пометкой, какое чтение
 * оказалось принудительным пересчётом, и сколько их вышло всего.
 */
function simulate(ops: { kind: 'read' | 'write'; n: number }[]): { marks: ThrashOp[]; forced: number; planned: number } {
  let dirty = false;
  let forced = 0;
  const marks = ops.map((op) => {
    if (op.kind === 'write') {
      dirty = true;
      return { ...op, forced: false };
    }
    if (dirty) {
      forced += 1;
      dirty = false;
      return { ...op, forced: true };
    }
    return { ...op, forced: false };
  });
  return { marks, forced, planned: dirty ? 1 : 0 };
}

const full = computed(() => simulate(build(mode.value.key, size.value.items)));

/** Первые несколько операций — фишками, чтобы правило было видно глазами. */
const shownElements = computed(() => Math.max(2, Math.floor(props.visibleOps / 2)));
const preview = computed(() => simulate(build(mode.value.key, shownElements.value)).marks);
const truncated = computed(() => shownElements.value < size.value.items);

const forcedTone = computed(() => {
  if (full.value.forced === 0) return 'ok';
  return full.value.forced > 10 ? 'err' : 'warn';
});

/** Разряды пробелом — как в соседних демо курса, без зависимости от ICU. */
function groups(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="controls">
        <div class="control">
          <span class="t-label">цикл</span>
          <SegmentedControl v-model="modeKey" class="l-pills" label="Как устроен цикл" :options="modeOptions" />
        </div>
        <div class="control">
          <span class="t-label">элементов</span>
          <SegmentedControl v-model="sizeKey" class="l-pills" label="Сколько элементов" :options="sizeOptions" />
        </div>
      </div>
    </template>

    <div class="body">
      <pre class="code">{{ mode.code }}</pre>

      <div class="ops">
        <div class="t-label">первые операции цикла</div>
        <div class="scroll">
          <div class="row">
            <span
              v-for="(op, i) in preview"
              :key="i"
              class="op"
              :data-kind="op.kind"
              :data-forced="op.forced ? 'yes' : 'no'"
            >
              {{ op.kind === 'read' ? 'read' : 'write' }} {{ op.n }}
              <i v-if="op.forced" class="op__flag">⟳ пересчёт</i>
            </span>
            <span v-if="truncated" class="op op--rest">… и так до {{ groups(size.items) }}</span>
          </div>
        </div>
      </div>

      <div class="totals">
        <div class="total">
          <span class="t-label">принудительных пересчётов</span>
          <span class="total__value" :data-tone="forcedTone">{{ groups(full.forced) }}</span>
        </div>
        <div class="total">
          <span class="t-label">плановых — в шаге layout</span>
          <span class="total__value" data-tone="ink">{{ full.planned }}</span>
        </div>
        <div class="total">
          <span class="t-label">операций всего</span>
          <span class="total__value" data-tone="chip">{{ groups(size.items * 2) }}</span>
        </div>
      </div>

      <Md class="note" :data-tone="mode.tone" :text="mode.note" />
    </div>

    <template #footer>
      <div class="disclaimer">
        Демо считает операции, а не миллисекунды: цена одного пересчёта зависит от страницы, и
        выдумывать это число нельзя. Правило счёта — браузерное: запись грязнит дерево и ничего
        не считает, чтение при грязном дереве требует пересчитать немедленно. Если в этой же задаче
        что-то меняли до цикла, первое чтение тоже форсирует — тогда пересчётов будет на один
        больше. Увидеть их вживую можно только в браузере: DevTools → Performance, предупреждение
        «Forced reflow while executing JavaScript».
      </div>
    </template>
  </DemoFrame>
</template>

<style scoped>
.controls {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.control {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.control .t-label {
  min-width: 86px;
}

.body {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 22px 20px;
}

.code {
  font-size: var(--fs-3);
  line-height: 1.7;
}

.ops {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.scroll {
  min-width: 0;
  overflow-x: auto;
}
.row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.op {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-radius: var(--r1);
  font-family: var(--mono);
  font-size: var(--fs-2);
  white-space: nowrap;
  transition: all 0.2s;
}
.op[data-kind='read'] {
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
}
.op[data-kind='write'] {
  background: var(--surface-3);
  color: var(--chip-text);
}
.op[data-forced='yes'] {
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
  box-shadow: inset 0 0 0 1px var(--tone-err-line);
}
.op__flag {
  font-style: normal;
  font-size: var(--fs-3);
  color: var(--tone-err-strong);
}
.op--rest {
  background: none;
  color: var(--dim);
}

.totals {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(170px, 100%), 1fr));
  gap: 12px;
  padding-top: 16px;
  border-top: 1px solid var(--rule);
}
.total {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.total__value {
  font-family: var(--mono);
  font-size: var(--fs-8);
  transition: color 0.2s;
}
.total__value[data-tone='ok'] {
  color: var(--tone-ok-strong);
}
.total__value[data-tone='warn'] {
  color: var(--tone-warn-strong-2);
}
.total__value[data-tone='err'] {
  color: var(--tone-err-strong);
}
.total__value[data-tone='ink'] {
  color: var(--ink);
}
.total__value[data-tone='chip'] {
  color: var(--chip-text);
}

.note {
  padding: 14px 16px;
  border-radius: var(--r2);
  font-size: var(--fs-6);
  line-height: 1.6;
  transition: all 0.2s;
}
.note[data-tone='ok'] {
  border: 1px solid var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.note[data-tone='warn'] {
  border: 1px solid var(--tone-warn-line);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.note[data-tone='err'] {
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}

.disclaimer {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}
</style>
