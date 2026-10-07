<script setup lang="ts">
/**
 * «Кого двигать»: один и тот же список с ключами, переставленный по-новому, — каких узлов
 * коснётся Vue (края + LIS) и каких React (`lastPlacedIndex`).
 *
 * Ответ считают строки `LIS_CODE`, `VUE_MOVES_CODE` и `REACT_MOVES_CODE` из темы, собранные
 * `new Function` (`model/run.ts`). `tests/unit/diff.test.ts` сверяет их с настоящими Vue 3.5
 * и React 19.3 в happy-dom — по набору узлов и по порядку вызовов DOM.
 */
import { computed, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { loadReactMoves, loadVueMoves } from '../model/run';
import type { MoveScenario, Moves } from '../model/types';

const props = defineProps<{
  lisCode: string;
  vueCode: string;
  reactCode: string;
  scenarios: MoveScenario[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const vueMoves = loadVueMoves(props.lisCode, props.vueCode);
const reactMoves = loadReactMoves(props.reactCode);

const picked = ref(props.scenarios[0].id);
const options = props.scenarios.map((s) => ({ value: s.id, label: s.label }));
const scenario = computed(() => props.scenarios.find((s) => s.id === picked.value) ?? props.scenarios[0]);

const typed = ref(scenario.value.to);
watch(scenario, (s) => {
  typed.value = s.to;
});

const from = computed(() => [...scenario.value.from]);
/** Свой порядок: только латинские заглавные, без повторов, не длиннее 12. */
const problem = computed(() => {
  const s = typed.value.toUpperCase();
  if (!/^[A-Z]*$/.test(s)) return 'Только латинские буквы A–Z.';
  if (new Set(s).size !== s.length) return 'Ключи должны быть уникальны: буква повторяется.';
  if (s.length > 12) return 'Не длиннее 12 ключей.';
  return '';
});
const to = computed(() => (problem.value ? [...scenario.value.to] : [...typed.value.toUpperCase()]));

interface Row {
  key: string;
  old: number;
  state: 'stay' | 'move' | 'new';
}

function rowOf(m: Moves): Row[] {
  return to.value.map((key) => {
    const old = from.value.indexOf(key);
    return { key, old, state: m.mounted.includes(key) ? 'new' : m.moved.includes(key) ? 'move' : 'stay' };
  });
}

const vue = computed(() => vueMoves(from.value, to.value));
const react = computed(() => reactMoves(from.value, to.value));
const removed = computed(() => from.value.filter((k) => !to.value.includes(k)));

const plural = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'узел' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'узла' : 'узлов');
const summary = (m: Moves) =>
  m.moved.length
    ? `переставит ${m.moved.length} ${plural(m.moved.length)}: ${m.moved.join(', ')}`
    : 'ничего не переставит';

const lanes = computed(() => [
  { id: 'vue', title: 'Vue', rows: rowOf(vue.value), text: summary(vue.value), count: vue.value.moved.length },
  { id: 'react', title: 'React', rows: rowOf(react.value), text: summary(react.value), count: react.value.moved.length },
]);
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="picked" class="l-pills" label="Перестановка" :options="options" />
    </template>

    <div class="mv-body">
      <div class="mv-lane">
        <span class="mv-title">было</span>
        <div class="mv-row">
          <span v-for="(k, i) in from" :key="k" class="mv-chip" data-state="stay">
            <span class="mv-key">{{ k }}</span>
            <span class="mv-idx">{{ i }}</span>
          </span>
        </div>
      </div>

      <label class="mv-field">
        <span class="mv-label">стало — можно набрать свой порядок</span>
        <input v-model="typed" class="mv-input" maxlength="12" spellcheck="false" autocomplete="off" />
        <span v-if="problem" class="mv-problem">{{ problem }}</span>
      </label>

      <div v-for="lane in lanes" :key="lane.id" class="mv-lane">
        <span class="mv-title">{{ lane.title }} <b class="mv-count">{{ lane.count }}</b></span>
        <div class="mv-row">
          <span v-for="r in lane.rows" :key="r.key" class="mv-chip" :data-state="r.state">
            <span class="mv-key">{{ r.key }}</span>
            <span class="mv-idx">{{ r.old < 0 ? 'нов' : r.old }}</span>
          </span>
        </div>
        <span class="mv-sum">{{ lane.title }} {{ lane.text }}</span>
      </div>

      <div class="mv-legend">
        <span class="mv-chip mv-chip--legend" data-state="stay"><span class="mv-key">A</span></span>
        <span>остаётся на месте</span>
        <span class="mv-chip mv-chip--legend" data-state="move"><span class="mv-key">A</span></span>
        <span>переставляется</span>
        <span class="mv-chip mv-chip--legend" data-state="new"><span class="mv-key">A</span></span>
        <span>новый узел</span>
        <span v-if="removed.length">удалены: {{ removed.join(', ') }}</span>
      </div>

      <Md class="mv-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.mv-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.mv-lane {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
  min-width: 0;
}
.mv-title,
.mv-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.mv-count {
  margin-left: 6px;
  color: var(--ink);
}
.mv-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.mv-chip {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  min-width: 2.4em;
  padding: 4px 6px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--surface);
  color: var(--prose);
}
.mv-chip[data-state='move'] {
  background: var(--tone-warn-bg);
  border-color: var(--tone-warn-line);
  color: var(--tone-warn-text);
}
.mv-chip[data-state='new'] {
  background: var(--tone-info-bg);
  border-color: var(--tone-info-line);
  color: var(--tone-info-text);
}
.mv-key {
  font-family: var(--mono);
  font-size: var(--fs-4);
  font-weight: 600;
}
.mv-idx {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.mv-chip--legend {
  min-width: 2em;
  padding: 2px 6px;
}
.mv-sum {
  font-size: var(--fs-3);
  color: var(--prose);
}

.mv-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.mv-input {
  font: inherit;
  color: inherit;
  font-family: var(--mono);
  font-size: var(--fs-4);
  letter-spacing: 0.12em;
  padding: 8px 10px;
  border: 1px solid var(--border-strong);
  border-radius: var(--r2);
  background: var(--surface);
  max-width: 22em;
  min-width: 0;
}
.mv-input:focus-visible {
  outline: 2px solid var(--ink);
  outline-offset: 1px;
}
.mv-problem {
  font-size: var(--fs-2);
  color: var(--tone-err-text);
}

.mv-legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: var(--fs-3);
  color: var(--prose);
}
.mv-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.mv-caption :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
</style>
