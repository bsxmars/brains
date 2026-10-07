<script setup lang="ts">
/**
 * Мини-«Solid»: рендерер из `STEP_DOM` поверх записывающего «DOM». Показывает, какие операции
 * понадобились на каждый шаг и сколько раз вызвана функция компонента.
 *
 * Логика — в `model/dom.ts` (`DomLab`); тот же модуль тест сверяет с литералом операций.
 * Лаборатория — обычная переменная, сборка — в `onMounted` (см. `SignalGraph.vue`).
 */
import { computed, onMounted, ref, shallowRef } from 'vue';
import CodeListing from '@/shared/ui/CodeListing.vue';
import ConsoleView from '@/shared/ui/ConsoleView.vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button } from '@/shared/ui';
import { DomLab } from '../model/dom';
import { loadSignals } from '../model/load';
import type { DomScenario, DomStep } from '../model/types';

const props = defineProps<{ code: string; scenario: DomScenario }>();

let lab: DomLab | null = null;
const step = shallowRef<DomStep | null>(null);
const heading = ref('установка: render(Counter, root)');

function boot() {
  lab = new DomLab(loadSignals(props.code), props.scenario);
  heading.value = 'установка: render(Counter, root)';
  step.value = lab.start();
}

function act(i: number) {
  if (!lab) return;
  heading.value = props.scenario.actions[i];
  step.value = lab.step(i);
}

onMounted(boot);

const lines = computed(() => props.scenario.setup.split('\n'));
const ops = computed(() => {
  const s = step.value;
  if (!s) return [];
  return [`> ${heading.value}`, ...(s.ops.length ? s.ops.map((op) => `  ${op}`) : ['  операций DOM нет'])];
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="ms2-actions">
        <Button v-for="(action, i) in scenario.actions" :key="action" variant="secondary" :disabled="!step" @click="act(i)">
          {{ action }}
        </Button>
        <Button variant="secondary" :disabled="!step" @click="boot">сброс</Button>
      </div>
    </template>

    <div class="ms2-split">
      <div class="ms2-pane">
        <CodeListing :lines="lines" label="компонент · исполняется мини-рендерером" />
        <Md class="ms2-note" :text="scenario.note" />
      </div>

      <div class="ms2-pane">
        <span class="t-label">разметка корня после шага</span>
        <div class="ms2-html" data-code>{{ step?.html ?? '—' }}</div>
        <span v-if="step" class="ms2-calls">Counter вызван: {{ step.counts.Counter ?? 0 }} раз</span>
        <ConsoleView :lines="ops" label="операции DOM за шаг" empty-label="ещё не смонтировано" :min-height="150" />
      </div>
    </div>
  </DemoFrame>
</template>

<style scoped>
.ms2-split {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr));
  gap: 20px;
  padding: 20px;
}
.ms2-pane {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.ms2-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.ms2-note {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--prose);
}
.ms2-html {
  padding: 10px 12px;
  border-radius: var(--r2);
  background: var(--surface-2);
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
  overflow-wrap: anywhere;
}
.ms2-calls {
  align-self: flex-start;
  padding: 3px 8px;
  border-radius: var(--r-full);
  background: var(--tone-ok-chip);
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--tone-ok-text);
}
</style>
