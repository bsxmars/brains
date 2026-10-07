<script setup lang="ts">
/**
 * Оборот цикла в Node: фазы libuv слева, шаги сценария справа.
 *
 * Переключатель CommonJS / ESM — то, чего в оригинале не было, а зря: тот же файл печатает
 * разное. В CommonJS первой сливается очередь `process.nextTick` (`n p …`), а в ESM тело
 * модуля само исполняется как job, поэтому раньше идут реакции промисов (`p n …`).
 * Проверено запуском на Node 24.11 и закреплено в `tests/unit/node-order.test.ts`.
 */
import { computed, ref, watch } from 'vue';
import { usePlayer } from '@/shared/lib/usePlayer';
import { useStepper } from '@/shared/lib/useStepper';
import ConsoleView from '@/shared/ui/ConsoleView.vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import PlayerToolbar from '@/shared/ui/PlayerToolbar.vue';
import { SegmentedControl } from '@/shared/ui';
import type { NodePhase, NodeStep } from '../model/types';

const props = defineProps<{
  phases: NodePhase[];
  code: string;
  cjs: NodeStep[];
  esm: NodeStep[];
}>();

const picked = ref<'cjs' | 'esm'>('cjs');
const options = [
  { value: 'cjs', label: 'CommonJS' },
  { value: 'esm', label: 'ESM' },
];

const steps = computed(() => (picked.value === 'cjs' ? props.cjs : props.esm));
const total = computed(() => steps.value.length);
const stepper = useStepper(total);
const { index, counter, atStart, atEnd, next, prev, reset, go } = stepper;
const { playing, speed, speeds, available, toggle, setSpeed } = usePlayer(stepper);
watch(picked, reset);

const step = computed(() => steps.value[Math.min(index.value, total.value - 1)]);
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="bar">
        <PlayerToolbar
          :counter="counter"
          :index="index"
          :playing="playing"
          :speed="speed"
          :speeds="speeds"
          :available="available"
          :at-start="atStart"
          :at-end="atEnd"
          @toggle="toggle"
          @scrub="go"
          @speed="setSpeed"
          @prev="prev"
          @next="next"
          @reset="reset"
        />
        <SegmentedControl v-model="picked" class="l-pills" label="Тип модуля" :options="options" />
      </div>
    </template>

    <div class="split">
      <div class="phases">
        <div class="t-label">фазы одного оборота libuv</div>
        <div
          v-for="(phase, i) in phases"
          :key="phase.name"
          class="phase"
          :class="{ active: i === step.phase }"
        >
          <span class="phase__name">{{ phase.name }}</span>
          <span class="phase__what">{{ phase.what }}</span>
        </div>
        <div class="between">между КАЖДЫМИ двумя коллбэками:<br />nextTick queue → microtask queue</div>
      </div>

      <div class="pane">
        <pre class="code">{{ code }}</pre>
        <div class="message" :data-tone="step.tone ?? 'info'">{{ step.message }}</div>
        <ConsoleView :chips="step.out" label="вывод" :min-height="52" empty-label="пока пусто" />
      </div>
    </div>
  </DemoFrame>
</template>

<style scoped>
.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}

.split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
}

.phases {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 20px;
  border-right: 1px solid var(--divider);
}
.phase {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  padding: 10px 13px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--surface-2);
  transition: all 0.2s;
}
/* Активная фаза — та, в которой цикл находится на этом шаге. */
.phase.active {
  border-color: var(--accent);
  background: var(--tone-info-bg);
}
.phase__name {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--chip-text);
}
.phase__what {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-faint);
}
.between {
  margin-top: 10px;
  padding: 11px 13px;
  border: 1px dashed var(--tone-info-line);
  border-radius: var(--r2);
  background: var(--tone-info-bg);
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.6;
  color: var(--tone-info-strong);
}

.pane {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  background: var(--surface-2);
}
.code {
  padding: 14px 16px;
  font-size: var(--fs-3);
}

.message {
  padding: 14px 16px;
  border-radius: var(--r2);
  font-size: var(--fs-6);
  line-height: 1.55;
  transition: all 0.2s;
}
.message[data-tone='info'] {
  background: var(--tone-info-bg);
  border: 1px solid var(--tone-info-line);
  color: var(--tone-info-text);
}
.message[data-tone='ok'] {
  background: var(--tone-ok-bg);
  border: 1px solid var(--tone-ok-line);
  color: var(--tone-ok-text);
}
.message[data-tone='warn'] {
  background: var(--tone-warn-bg);
  border: 1px solid var(--tone-warn-line);
  color: var(--tone-warn-text);
}

@media (max-width: 720px) {
  .split {
    grid-template-columns: 1fr;
  }
  .phases {
    border-right: 0;
    border-bottom: 1px solid var(--divider);
  }
}
</style>
