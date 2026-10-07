<script setup lang="ts">
/**
 * «Кого вытеснит Redis»: нагрузка `WORKLOAD_CODE` (50 ключей без срока, 50 горячих, 600 холодных)
 * на память в 298 ключей при выбранной политике и выборке; какие ключи остались.
 *
 * Считает учебная модель — `EVICT_CODE` из темы (`runEviction` в `model/run.ts`), «случайность» —
 * с зерном. Рядом — что осталось после той же нагрузки на настоящем Redis (`STAND_EVICT`, три
 * прогона). Тест сверяет среднее модели по 200 зёрнам с этими прогонами.
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button, SegmentedControl } from '@/shared/ui';
import { loadModel, runEviction } from '../model/run';

interface StandRun {
  s: number;
  h: number;
  c: number;
  evicted: number;
  fails: number;
  firstFail: number | null;
}

const props = defineProps<{
  parts: string[];
  capacity: number;
  stand: Record<string, StandRun[]>;
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const model = loadModel(props.parts);

const POLICIES = ['allkeys-lru', 'volatile-lru', 'volatile-ttl', 'allkeys-random', 'noeviction'];
const policy = ref('allkeys-lru');
const samples = ref('5');
const seed = ref(1);
const policyOptions = POLICIES.map((p) => ({ value: p, label: p }));
const sampleOptions = ['1', '5', '10'].map((s) => ({ value: s, label: `выборка ${s}` }));
const usesSamples = computed(() => policy.value.endsWith('-lru'));

const run = computed(() => runEviction(model, policy.value, usesSamples.value ? Number(samples.value) : 5, seed.value, props.capacity));

const GROUPS = [
  { p: 's:', k: 's', label: 'без срока: сессии, флаги' },
  { p: 'h:', k: 'h', label: 'горячие, читаются каждую секунду' },
  { p: 'c:', k: 'c', label: 'холодные, записаны и забыты' },
] as const;

const standKey = computed(() => `${policy.value}/${usesSamples.value ? samples.value : '5'}`);
const standRuns = computed(() => props.stand[standKey.value] ?? []);

const groups = computed(() =>
  GROUPS.map((g) => {
    const keys = run.value.all.filter((k) => k.startsWith(g.p));
    const kept = keys.filter((k) => run.value.kept.has(k)).length;
    return {
      ...g,
      total: keys.length,
      kept,
      cells: keys.map((k) => ({ k, on: run.value.kept.has(k) })),
      stand: standRuns.value.map((r) => r[g.k]).join(' / '),
    };
  }),
);

const summary = computed(() => {
  const r = run.value;
  if (r.fails) return `Модель: ${r.fails} записей отклонено с OOM, первая — ${r.firstFail}-я.`;
  return `Модель: вытеснено ${r.evicted} ключей.`;
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="ev-bar">
        <SegmentedControl v-model="policy" class="l-pills" label="Политика" :options="policyOptions" />
        <SegmentedControl v-if="usesSamples" v-model="samples" class="l-pills" label="maxmemory-samples" :options="sampleOptions" />
      </div>
    </template>

    <div class="ev-body">
      <div v-for="g in groups" :key="g.k" class="ev-group">
        <div class="ev-group__head">
          <span class="ev-label">{{ g.label }}</span>
          <span class="ev-count">
            <b>{{ g.kept }}</b>
            из {{ g.total }} · Redis: {{ g.stand || '—' }}
          </span>
        </div>
        <div class="ev-cells" role="img" :aria-label="`${g.label}: осталось ${g.kept} из ${g.total}`">
          <span v-for="c in g.cells" :key="c.k" class="ev-cell" :data-on="c.on ? 'yes' : 'no'" :data-group="g.k" />
        </div>
      </div>

      <div class="ev-foot">
        <span class="ev-summary">{{ summary }}</span>
        <Button v-if="policy !== 'noeviction'" variant="secondary" @click="seed += 1">другая выборка</Button>
      </div>

      <Md class="ev-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.ev-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 16px;
}
.ev-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.ev-caption,
.ev-summary {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.ev-caption :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
.ev-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.ev-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ev-group__head {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 4px 12px;
}
.ev-count {
  font-size: var(--fs-3);
  color: var(--text-muted);
}
.ev-count b {
  font-family: var(--mono);
  color: var(--ink);
}
.ev-cells {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
}
.ev-cell {
  width: 9px;
  height: 9px;
  border-radius: 2px;
  background: var(--surface-3);
}
.ev-cell[data-on='yes'] {
  background: var(--tone-ok-strong);
}
.ev-cell[data-on='yes'][data-group='s'] {
  background: var(--tone-info-strong);
}
.ev-cell[data-on='yes'][data-group='h'] {
  background: var(--tone-warn-strong);
}
.ev-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px 14px;
}
</style>
