<script setup lang="ts">
/**
 * Один оборот цикла по шагам: код слева, состояние машины справа и снизу.
 *
 * Сценарий тот же, что в оригинале: пользователь кликнул по кнопке во время выполнения
 * скрипта. Смысл демо — показать, что «асинхронно» это не про порядок строк в файле,
 * а про то, в какую из очередей попал коллбэк и когда цикл до неё дошёл.
 *
 * Все четыре панели внизу — общие компоненты курса: тот же стек, та же очередь и та же
 * консоль стоят в «Колбэках» и в «Промисе изнутри», и читатель узнаёт их без пояснений.
 */
import { computed } from 'vue';
import { usePlayer } from '@/shared/lib/usePlayer';
import { useStepper } from '@/shared/lib/useStepper';
import CodeListing from '@/shared/ui/CodeListing.vue';
import ConsoleView from '@/shared/ui/ConsoleView.vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import PlayerToolbar from '@/shared/ui/PlayerToolbar.vue';
import QueueView from '@/shared/ui/QueueView.vue';
import StackView from '@/shared/ui/StackView.vue';
import type { TurnStep } from '../model/types';

const props = defineProps<{ code: string[]; steps: TurnStep[] }>();

const stepper = useStepper(props.steps.length);
const { index, counter, atStart, atEnd, next, prev, reset, go } = stepper;

/**
 * Оборот цикла — процесс, а не набор поз: шаг за шагом видно, как задача доходит до стека.
 * Пауза чуть длиннее обычной: на каждом шаге меняются сразу четыре панели, и глазу нужно
 * время их обойти.
 */
const { playing, speed, speeds, available, toggle, setSpeed } = usePlayer(stepper, {
  interval: 1200,
});
const step = computed(() => props.steps[index.value]);

/** Тон фазы: чекпоинт фиолетовый, рендер янтарный, обычная задача нейтральная. */
const phaseTone = computed(() => {
  const phase = step.value.phase;
  if (phase.includes('checkpoint')) return 'info';
  if (phase.includes('рендер')) return 'warn';
  return 'neutral';
});

const taskQueues = computed(() => [
  { name: 'timer', value: step.value.tasks.timer },
  { name: 'user interaction', value: step.value.tasks.input },
  { name: 'rAF list (не очередь)', value: step.value.tasks.raf },
]);
</script>

<template>
  <DemoFrame>
    <div class="top">
      <div class="code">
        <CodeListing :lines="code" :active="step.line" label="исходник" />
      </div>

      <div class="panel">
        <PlayerToolbar
          :counter="counter"
          :index="index"
          :total="steps.length"
          :playing="playing"
          :speed="speed"
          :speeds="speeds"
          :available="available"
          :at-start="atStart"
          :at-end="atEnd"
          @toggle="toggle"
          @prev="prev"
          @next="next"
          @reset="reset"
          @scrub="go"
          @speed="setSpeed"
        />
        <div class="phase" :data-tone="phaseTone">{{ step.phase }}</div>
        <div class="message" :data-tone="step.tone ?? 'info'">{{ step.message }}</div>
      </div>
    </div>

    <div class="bottom">
      <div class="cell">
        <StackView
          :frames="step.stack"
          empty-label="пусто → checkpoint"
          :empty-accent="step.phase.includes('checkpoint')"
        />
      </div>
      <div class="cell">
        <QueueView :items="step.micro" label="microtask queue" tone="info" :min-height="92" />
      </div>
      <div class="cell cell--tasks">
        <div class="t-label" data-tone="warn">task queues</div>
        <div v-for="queue in taskQueues" :key="queue.name" class="task">
          <div class="task__name">{{ queue.name }}</div>
          <QueueView :items="[queue.value]" tone="warn" :dashed="queue.value === '—'" />
        </div>
      </div>
      <div class="cell">
        <ConsoleView :lines="step.out" :min-height="92" empty-label="пока пусто" />
      </div>
    </div>
  </DemoFrame>
</template>

<style scoped>
.top {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr);
}
.code {
  padding: 20px;
  border-right: 1px solid var(--divider);
  overflow-x: auto;
}
.panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  background: var(--surface-2);
}

/* «Фаза» — это ответ на вопрос «где мы сейчас», поэтому она пилюлей и цветом, а не текстом. */
.phase {
  align-self: flex-start;
  padding: 7px 11px;
  border-radius: var(--r-full);
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  transition: all 0.2s;
}
.phase[data-tone='neutral'] {
  background: var(--surface-3);
  color: var(--text-muted);
}
.phase[data-tone='info'] {
  background: var(--tone-info-bg);
  color: var(--tone-info-strong);
}
.phase[data-tone='warn'] {
  background: var(--tone-warn-bg);
  color: var(--tone-warn-strong);
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

.bottom {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr));
  border-top: 1px solid var(--divider);
}
.cell {
  padding: 18px;
  border-right: 1px solid var(--divider);
}
.cell:last-child {
  border-right: 0;
}
.cell--tasks {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.task {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.task__name {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--dim);
}

@media (max-width: 720px) {
  .top {
    grid-template-columns: 1fr;
  }
  .code {
    border-right: 0;
    border-bottom: 1px solid var(--divider);
  }
}
</style>
