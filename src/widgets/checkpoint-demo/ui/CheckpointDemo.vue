<script setup lang="ts">
/**
 * Два способа позвать одного и того же слушателя — и разный порядок вывода.
 *
 * Настоящий клик цикл доставляет сам: между слушателями стек пустеет, и микрозадача каждого
 * успевает выполниться. `btn.click()` из кода — это синхронный вызов на вашем же стеке:
 * пустым он не станет до конца вашей функции, поэтому обе микрозадачи ждут до самого конца.
 *
 * Отсюда практический вывод, ради которого демо и существует: тест, который кликает
 * программно, проверяет не тот порядок, что увидит пользователь.
 */
import { computed, ref, watch } from 'vue';
import { usePlayer } from '@/shared/lib/usePlayer';
import { useStepper } from '@/shared/lib/useStepper';
import ConsoleView from '@/shared/ui/ConsoleView.vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import QueueView from '@/shared/ui/QueueView.vue';
import StackView from '@/shared/ui/StackView.vue';
import PlayerToolbar from '@/shared/ui/PlayerToolbar.vue';
import { SegmentedControl } from '@/shared/ui';
import type { CheckpointMode } from '../model/types';

const props = defineProps<{ modes: CheckpointMode[] }>();

const picked = ref(props.modes[0].key);
const mode = computed(() => props.modes.find((m) => m.key === picked.value) ?? props.modes[0]);
const options = computed(() => props.modes.map((m) => ({ value: m.key, label: m.label })));

const total = computed(() => mode.value.steps.length);
const stepper = useStepper(total);
const { index, counter, atStart, atEnd, next, prev, reset, go } = stepper;
const { playing, speed, speeds, available, toggle, setSpeed } = usePlayer(stepper);
watch(picked, reset);

const step = computed(() => mode.value.steps[Math.min(index.value, total.value - 1)]);
const finished = computed(() => index.value >= total.value - 1);
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="modes">
        <span class="modes__label">кнопка с двумя слушателями:</span>
        <SegmentedControl v-model="picked" class="l-pills" label="Как вызван слушатель" :options="options" />
      </div>
    </template>

    <div class="split">
      <div class="pane">
        <StackView :frames="step.stack" label="стек в этот момент" :min-height="110" />
        <div class="checkpoint" :data-tone="step.tone ?? 'dim'">{{ step.checkpoint }}</div>
      </div>

      <div class="pane pane--right">
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
        <div class="message" :data-tone="step.tone ?? 'info'">{{ step.message }}</div>
        <QueueView :items="step.micro" label="микроочередь" tone="info" layout="row" :min-height="28" />
        <ConsoleView :lines="step.out" :min-height="58" empty-label="пока пусто" />
      </div>
    </div>

    <template #footer>
      <div class="result" :data-state="finished ? mode.tone : 'pending'">
        {{ finished ? mode.result : 'пройдите все шаги' }}
      </div>
    </template>
  </DemoFrame>
</template>

<style scoped>
.modes {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.modes__label {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}

.split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr);
}
.pane {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
  border-right: 1px solid var(--divider);
}
.pane--right {
  gap: 16px;
  border-right: 0;
  background: var(--surface-2);
}

/* Строка «есть ли сейчас чекпоинт» — главный индикатор демо. */
.checkpoint {
  padding: 12px 14px;
  border-radius: var(--r2);
  font-size: var(--fs-6);
  line-height: 1.5;
  transition: all 0.2s;
}
.checkpoint[data-tone='dim'] {
  background: var(--sunk-dim);
  border: 1px solid var(--divider);
  color: var(--dim);
}
.checkpoint[data-tone='ok'] {
  background: var(--tone-ok-bg);
  border: 1px solid var(--tone-ok-line);
  color: var(--tone-ok-text);
}
.checkpoint[data-tone='warn'] {
  background: var(--tone-warn-bg);
  border: 1px solid var(--tone-warn-line);
  color: var(--tone-warn-text);
}
.checkpoint[data-tone='err'] {
  background: var(--tone-err-bg);
  border: 1px solid var(--tone-err-line);
  color: var(--tone-err-text);
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
.message[data-tone='err'] {
  background: var(--tone-err-bg);
  border: 1px solid var(--tone-err-line);
  color: var(--tone-err-text);
}

.result {
  font-size: var(--fs-6);
  line-height: 1.6;
  transition: all 0.2s;
}
.result[data-state='pending'] {
  color: var(--dim);
}
.result[data-state='ok'] {
  color: var(--tone-ok-text);
}
.result[data-state='warn'] {
  color: var(--tone-warn-text);
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
