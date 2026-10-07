<script setup lang="ts">
/**
 * «Четыре буфера»: сквозной пример из пяти правок на крошечном тексте — что лежит внутри
 * строки, gap buffer, rope и piece table после каждой правки и во что она обошлась, — и те же
 * модели «в масштабе»: сценарий из 1000 операций на документе в 1 000 – 100 000 символов.
 *
 * Считают строки `STRING_CODE`, `GAP_CODE`, `ROPE_CODE` и `PIECE_CODE` из темы, собранные
 * `new Function` (`model/run.ts`). Числа «в масштабе» считаются здесь же, живыми; литерал
 * `SCALE` в теме и `tests/unit/text-buffers.test.ts` пересчитывают их той же `measure`.
 */
import { computed, ref } from 'vue';
import { useStepper } from '@/shared/lib/useStepper';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import StepToolbar from '@/shared/ui/StepToolbar.vue';
import { SegmentedControl } from '@/shared/ui';
import { KINDS, loadAll, measureAll, playDemo } from '../model/run';
import type { Codes, DemoCase, Kind, Scenario, Step } from '../model/types';

const props = defineProps<{
  codes: Codes;
  demo: DemoCase;
  scenarios: { id: Scenario; label: string; d: string }[];
  sizes: number[];
  labels: Record<Kind, string>;
  /** Подписи под частями демо. Строчная разметка. */
  caption: string;
  scaleCaption: string;
}>();

const apis = loadAll(props.codes);
const states = playDemo(apis, props.demo);

const { index, counter, atStart, atEnd, next, prev, reset } = useStepper(states.length);
const state = computed(() => states[index.value]);

const show = (s: string) => s.replace(/\n/g, '⏎');
function describe(step: Step | null): string {
  if (!step) return 'исходный текст';
  if (step.op === 'ins') return `вставить «${show(step.str)}» в позицию ${step.pos}`;
  if (step.op === 'del') return `удалить ${step.len} с позиции ${step.pos}`;
  return `найти начало строки ${step.line}`;
}
const costText = (k: Kind) => {
  const c = state.value.cost[k];
  return `переписано ${c.copied} · просмотрено ${c.visited}`;
};

const scen = ref<Scenario>(props.scenarios[0].id);
const scenOptions = props.scenarios.map((s) => ({ value: s.id, label: s.label }));
const scenDesc = computed(() => props.scenarios.find((s) => s.id === scen.value)?.d ?? '');
const size = ref(String(props.sizes[props.sizes.length - 1]));
const sizeOptions = props.sizes.map((n) => ({ value: String(n), label: n.toLocaleString('ru-RU') }));
const scale = computed(() => measureAll(apis, Number(size.value), scen.value));
const fmt = (x: number | undefined) => (x === undefined ? '—' : x.toLocaleString('ru-RU', { maximumFractionDigits: 1 }));
const extra = (k: Kind) => {
  const c = scale.value[k];
  if (c.pieces !== undefined) return `кусков: ${fmt(c.pieces)}`;
  if (c.h !== undefined) return `высота: ${c.h}`;
  return '';
};
// Полоса — вся работа операции (переписано + просмотрено) в логарифмической шкале:
// иначе rope и piece table на фоне строки не видны вовсе.
const work = (k: Kind) => scale.value[k].copied + scale.value[k].visited;
const maxWork = computed(() => Math.max(1, ...KINDS.map(work)));
const bar = (k: Kind) => `${Math.max(1, (100 * Math.log10(1 + work(k))) / Math.log10(1 + maxWork.value))}%`;
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <StepToolbar :counter="counter" :at-start="atStart" :at-end="atEnd" @prev="prev" @next="next" @reset="reset" />
    </template>

    <div class="tb-body">
      <div class="tb-head">
        <span class="tb-title">{{ describe(state.step) }}</span>
        <span class="tb-text">«{{ show(state.text) }}»</span>
        <span v-if="state.found !== null" class="tb-note">начало строки — позиция {{ state.found }} у всех четырёх</span>
      </div>

      <div class="tb-grid">
        <div class="tb-panel">
          <span class="tb-title">{{ labels.string }}</span>
          <span class="tb-mono">«{{ show(state.text) }}»</span>
          <span class="tb-cost">{{ costText('string') }}</span>
        </div>

        <div class="tb-panel">
          <span class="tb-title">{{ labels.gap }} · дырка {{ state.gap.start }}…{{ state.gap.end }}</span>
          <div class="tb-cells">
            <span
              v-for="(c, i) in state.gap.cells"
              :key="i"
              class="tb-cell"
              :data-gap="c === null ? 'yes' : 'no'"
            >{{ c === null ? '' : show(c) }}</span>
          </div>
          <span class="tb-cost">{{ costText('gap') }}</span>
        </div>

        <div class="tb-panel">
          <span class="tb-title">{{ labels.rope }} · лист до {{ demo.leaf }}</span>
          <ul class="tb-tree">
            <li
              v-for="(r, i) in state.rope"
              :key="i"
              class="tb-mono"
              :style="{ paddingLeft: `${r.depth * 1.1}em` }"
              :data-leaf="r.leaf ? 'yes' : 'no'"
            >
              <template v-if="r.leaf">«{{ show(r.s) }}»</template>
              <template v-else>узел · len {{ r.len }} · lines {{ r.lines }}</template>
            </li>
          </ul>
          <span class="tb-cost">{{ costText('rope') }}</span>
        </div>

        <div class="tb-panel">
          <span class="tb-title">{{ labels.piece }}</span>
          <span class="tb-mono">orig: «{{ show(state.piece.orig) }}»</span>
          <span class="tb-mono">add: «{{ show(state.piece.add) }}»</span>
          <div class="tb-pieces">
            <span v-for="(p, i) in state.piece.pieces" :key="i" class="tb-piece" :data-buf="p.buf">
              <span class="tb-mono">{{ p.buf }} {{ p.start }}+{{ p.len }}</span>
              <span class="tb-mono tb-ink">«{{ show(p.text) }}»</span>
            </span>
          </div>
          <span class="tb-cost">{{ costText('piece') }}</span>
        </div>
      </div>

      <Md class="tb-caption" :text="caption" />

      <div class="tb-scale">
        <div class="tb-tools">
          <SegmentedControl v-model="scen" class="l-pills" label="Сценарий" :options="scenOptions" />
          <SegmentedControl v-model="size" class="l-pills" label="Символов в документе" :options="sizeOptions" />
        </div>
        <Md class="tb-caption" :text="scenDesc" />
        <div class="tb-rows">
          <div v-for="k in KINDS" :key="k" class="tb-row">
            <span class="tb-title">{{ labels[k] }}</span>
            <span class="tb-bar"><span :style="{ width: bar(k) }" /></span>
            <span class="tb-mono">
              <template v-if="scale[k].first !== undefined">первая: {{ fmt(scale[k].first) }} · </template>
              переписано: {{ fmt(scale[k].copied) }} · просмотрено: {{ fmt(scale[k].visited) }}
              <template v-if="extra(k)"> · {{ extra(k) }}</template>
            </span>
          </div>
        </div>
        <Md class="tb-caption" :text="scaleCaption" />
      </div>
    </div>
  </DemoFrame>
</template>

<style scoped>
.tb-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.tb-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px 14px;
}
.tb-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 12px;
}
.tb-panel,
.tb-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
  min-width: 0;
}
.tb-title {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.tb-text {
  font-family: var(--mono);
  font-size: var(--fs-4);
  color: var(--ink);
  overflow-wrap: anywhere;
}
.tb-mono {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--prose);
  overflow-wrap: anywhere;
}
.tb-ink {
  color: var(--ink);
}
.tb-note {
  font-size: var(--fs-3);
  color: var(--tone-ok-text);
}
.tb-cost {
  margin-top: auto;
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--tone-info-text);
}
.tb-cells {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
}
.tb-cell {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.7em;
  height: 1.9em;
  border: 1px solid var(--border);
  border-radius: var(--r1);
  background: var(--surface);
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
}
.tb-cell[data-gap='yes'] {
  background: var(--tone-warn-bg);
  border-color: var(--tone-warn-line);
}
.tb-tree {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.tb-tree li[data-leaf='yes'] {
  color: var(--ink);
}
.tb-pieces {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.tb-piece {
  display: inline-flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--surface);
}
.tb-piece[data-buf='add'] {
  background: var(--tone-ok-bg);
  border-color: var(--tone-ok-line);
}
.tb-scale {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 16px;
  border-top: 1px solid var(--divider);
}
.tb-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
}
.tb-rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.tb-bar {
  display: block;
  height: 8px;
  border-radius: var(--r1);
  background: var(--surface-3);
  overflow: hidden;
}
.tb-bar > span {
  display: block;
  height: 100%;
  background: var(--tone-info-line);
}
.tb-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.tb-caption :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
</style>
