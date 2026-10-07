<script setup lang="ts">
/**
 * «Очередь запросов»: какой бэкенд получает каждый запрос при круге, весах и `least_conn`,
 * и как меняется счёт плавного взвешенного круга на выбранном ходе.
 *
 * Выбор считает не компонент, а строка `PICK_CODE` из темы, собранная `new Function`
 * (`model/run.ts`). Под расчётом стоит последовательность, которую выдал настоящий nginx
 * на стенде; `tests/unit/load-balancing.test.ts` требует, чтобы они совпадали.
 */
import { computed, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { loadPick, simulate } from '../model/run';
import type { LbScenario } from '../model/types';

const props = defineProps<{
  code: string;
  scenarios: LbScenario[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const api = loadPick(props.code);

const picked = ref(props.scenarios[0].id);
const options = props.scenarios.map((s) => ({ value: s.id, label: s.label }));
const scenario = computed(() => props.scenarios.find((s) => s.id === picked.value) ?? props.scenarios[0]);
const steps = computed(() => simulate(api, scenario.value));
const sel = ref(0);
watch(scenario, () => (sel.value = 0));

const step = computed(() => steps.value[sel.value]);
const agree = computed(() => steps.value.every((s, i) => s.chosen === scenario.value.nginx[i]));

const rows = computed(() =>
  step.value.before.map((b, i) => {
    const a = step.value.after[i];
    return {
      name: b.name,
      weight: b.weight,
      conns: b.conns,
      before: b.current,
      after: a.current,
      moved: a.current !== b.current,
      chosen: b.name === step.value.chosen,
    };
  }),
);
const sign = (n: number) => (n > 0 ? `+${n}` : String(n));
const tone = (name: string) => `lb-tone-${name}`;
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="picked" class="l-pills" label="Сценарий" :options="options" />
    </template>

    <div class="lb-body">
      <Md class="lb-note" :text="scenario.note" />

      <div class="lb-seq">
        <span class="lb-label">расчёт <code>PICK_CODE</code> — нажмите на запрос</span>
        <div class="lb-chips">
          <button
            v-for="(s, i) in steps"
            :key="i"
            type="button"
            class="lb-chip"
            :class="tone(s.chosen)"
            :data-on="i === sel ? 'yes' : 'no'"
            :aria-pressed="i === sel"
            :aria-label="`Запрос ${i + 1}: ${s.chosen}`"
            @click="sel = i"
          >
            <span class="lb-chip__n">{{ i + 1 }}{{ s.event === 'long' ? ' · долгий' : '' }}</span>
            <span class="lb-chip__b">{{ s.chosen }}</span>
          </button>
        </div>
        <span class="lb-label">nginx 1.30 на стенде</span>
        <div class="lb-chips">
          <span
            v-for="(c, i) in scenario.nginx"
            :key="i"
            class="lb-chip lb-chip--static"
            :class="c === steps[i]?.chosen ? tone(c) : 'lb-miss'"
          >
            <span class="lb-chip__n">{{ i + 1 }}</span>
            <span class="lb-chip__b">{{ c }}</span>
          </span>
        </div>
        <span class="lb-verdict" :data-ok="agree ? 'yes' : 'no'">
          {{ agree ? 'совпадает с nginx на всех запросах' : 'расходится с nginx' }}
        </span>
      </div>

      <div class="lb-table-wrap">
        <table class="lb-table">
          <caption class="lb-label">ход {{ sel + 1 }}: выбран {{ step.chosen }}</caption>
          <thead>
            <tr>
              <th scope="col">бэкенд</th>
              <th scope="col">вес</th>
              <th scope="col">в работе</th>
              <th scope="col">счёт до</th>
              <th scope="col">счёт после</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.name" :data-on="r.chosen ? 'yes' : 'no'">
              <th scope="row"><span class="lb-dot" :class="tone(r.name)">{{ r.name }}</span></th>
              <td>{{ r.weight }}</td>
              <td>{{ r.conns }}</td>
              <td>{{ r.before }}</td>
              <td>
                {{ r.after }}
                <span v-if="r.moved" class="lb-delta">({{ sign(r.after - r.before) }})</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <Md class="lb-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.lb-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.lb-note,
.lb-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.lb-note :deep(code),
.lb-caption :deep(code),
.lb-label code {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
.lb-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
  text-align: left;
}
.lb-seq {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
  min-width: 0;
}
.lb-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.lb-chip {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  box-sizing: border-box;
  min-width: 2.6em;
  padding: 4px 8px;
  border: 1px solid transparent;
  border-radius: var(--r2);
  font: inherit;
  font-size: var(--fs-3);
  color: inherit;
  cursor: pointer;
}
.lb-chip--static {
  font-size: var(--fs-3);
  cursor: default;
}
.lb-chip[data-on='yes'] {
  border-color: var(--ink);
  box-shadow: var(--shadow-1);
}
.lb-chip:focus-visible {
  outline: 2px solid var(--ink);
  outline-offset: 1px;
}
.lb-chip__n {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.lb-chip__b {
  font-family: var(--mono);
  font-size: var(--fs-4);
  font-weight: 600;
}
.lb-tone-A {
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
}
.lb-tone-B {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.lb-tone-C {
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.lb-miss {
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
  border-color: var(--tone-err-line);
}
.lb-verdict {
  font-size: var(--fs-3);
  color: var(--tone-ok-text);
}
.lb-verdict[data-ok='no'] {
  color: var(--tone-err-text);
}

.lb-table-wrap {
  overflow-x: auto;
  min-width: 0;
}
.lb-table {
  width: 100%;
  min-width: 420px;
  border-collapse: collapse;
  font-size: var(--fs-3);
  color: var(--prose);
}
.lb-table caption {
  padding-bottom: 6px;
}
.lb-table th,
.lb-table td {
  padding: 6px 10px;
  border-bottom: 1px solid var(--hairline);
  text-align: left;
  font-family: var(--mono);
}
.lb-table thead th {
  font-size: var(--fs-2);
  font-weight: 500;
  color: var(--text-muted);
}
.lb-table tr[data-on='yes'] td,
.lb-table tr[data-on='yes'] th {
  background: var(--surface-2);
  font-weight: 600;
}
.lb-dot {
  display: inline-block;
  min-width: 1.8em;
  padding: 1px 6px;
  border-radius: var(--r1);
  text-align: center;
}
.lb-delta {
  color: var(--text-muted);
  font-weight: 400;
}
</style>
