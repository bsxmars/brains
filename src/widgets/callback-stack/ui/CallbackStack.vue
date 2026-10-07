<script setup lang="ts">
/**
 * Граница синхронного и асинхронного — на стеке, по шагам.
 *
 * В оригинале это был статичный разбор с картинкой стека. Движение здесь и есть объяснение:
 * весь тезис урока в том, **в какой момент** снимается фрейм вашего `try`, а увидеть момент
 * можно только пройдя по шагам. Поэтому под кадрами стоит отдельная строка-вердикт: жив ли
 * сейчас ваш обработчик ошибок.
 *
 * Стек, консоль и листинг — общие компоненты курса: те же самые стоят в «Event Loop»
 * и в «Промисе изнутри», и читатель узнаёт их без пояснений.
 */
import { computed, ref, watch } from 'vue';
import { usePlayer } from '@/shared/lib/usePlayer';
import { useStepper } from '@/shared/lib/useStepper';
import CodeListing from '@/shared/ui/CodeListing.vue';
import ConsoleView from '@/shared/ui/ConsoleView.vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import StackView from '@/shared/ui/StackView.vue';
import PlayerToolbar from '@/shared/ui/PlayerToolbar.vue';
import { SegmentedControl } from '@/shared/ui';
import type { StackMode } from '../model/types';

const props = defineProps<{ modes: StackMode[] }>();

const picked = ref(props.modes[0].key);
const mode = computed(() => props.modes.find((m) => m.key === picked.value) ?? props.modes[0]);
const options = computed(() => props.modes.map((m) => ({ value: m.key, label: m.label })));

const total = computed(() => mode.value.steps.length);
const stepper = useStepper(total);
const { index, counter, atStart, atEnd, next, prev, reset, go } = stepper;
const { playing, speed, speeds, available, toggle, setSpeed } = usePlayer(stepper);
watch(picked, reset);

const step = computed(() => mode.value.steps[Math.min(index.value, total.value - 1)]);
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="modes">
        <span class="modes__label">как передана функция:</span>
        <SegmentedControl v-model="picked" class="l-pills" label="Вид колбэка" :options="options" />
      </div>
    </template>

    <div class="split">
      <div class="pane">
        <CodeListing :lines="mode.code" :active="step.line" label="исходник" />
        <StackView
          :frames="step.frames"
          label="стек вызовов"
          empty-label="стек пуст"
          :empty-accent="!step.frames.length"
          :min-height="118"
        />
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

        <ol class="steps">
          <li
            v-for="(item, i) in mode.steps"
            :key="i"
            class="step"
            :data-state="i === index ? 'active' : i < index ? 'done' : 'next'"
            :data-tone="i === index ? (item.tone ?? 'info') : undefined"
          >
            <span class="step__n">{{ String(i + 1).padStart(2, '0') }}</span>
            <span>{{ item.message }}</span>
          </li>
        </ol>

        <ConsoleView :lines="step.out" :min-height="52" empty-label="пока пусто" />

        <div class="guard" :data-tone="step.tone ?? 'dim'">{{ step.guard }}</div>
      </div>
    </div>
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
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr);
}
.pane {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  border-right: 1px solid var(--divider);
  min-width: 0;
}
.pane--right {
  border-right: 0;
  background: var(--surface-2);
}

.steps {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.step {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 10px 12px;
  border: 1px solid transparent;
  border-radius: var(--r2);
  font-size: var(--fs-5);
  line-height: 1.5;
  transition: all 0.18s;
}
/* Пройденное приглушено, будущее — бледнее, но всё ещё читаемо: шаг вперёд читают глазами,
   чтобы понять, куда идёт разбор. На белой канве прежние `--text-faint` и `--ghost` гасли
   почти в бумагу, и список превращался в пустое место. */
.step[data-state='done'] {
  color: var(--text-muted);
}
.step[data-state='next'] {
  color: var(--dim);
}
.step[data-tone='info'] {
  background: var(--tone-info-bg);
  border-color: var(--tone-info-line);
  color: var(--tone-info-text);
}
.step[data-tone='ok'] {
  background: var(--tone-ok-bg);
  border-color: var(--tone-ok-line);
  color: var(--tone-ok-text);
}
.step[data-tone='warn'] {
  background: var(--tone-warn-bg);
  border-color: var(--tone-warn-line);
  color: var(--tone-warn-text);
}
.step[data-tone='err'] {
  background: var(--tone-err-bg);
  border-color: var(--tone-err-line);
  color: var(--tone-err-text);
}
/* Та же правка, что в `set-algorithm` и `lookup-chain`: гашение прозрачностью поверх
   приглушённого цвета опускало номер шага до 1.71:1 — ниже любого порога читаемости. */
.step__n {
  flex-shrink: 0;
  font-family: var(--mono);
  font-size: var(--fs-2);
  opacity: 0.8;
}

/* Строка «жив ли ваш try» — ради неё демо и существует. */
.guard {
  padding: 12px 14px;
  border-radius: var(--r2);
  font-size: var(--fs-6);
  line-height: 1.5;
  transition: all 0.2s;
}
.guard[data-tone='dim'] {
  background: var(--sunk-dim);
  border: 1px solid var(--divider);
  color: var(--dim);
}
.guard[data-tone='ok'] {
  background: var(--tone-ok-bg);
  border: 1px solid var(--tone-ok-line);
  color: var(--tone-ok-text);
}
.guard[data-tone='warn'] {
  background: var(--tone-warn-bg);
  border: 1px solid var(--tone-warn-line);
  color: var(--tone-warn-text);
}
.guard[data-tone='err'] {
  background: var(--tone-err-bg);
  border: 1px solid var(--tone-err-line);
  color: var(--tone-err-text);
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
