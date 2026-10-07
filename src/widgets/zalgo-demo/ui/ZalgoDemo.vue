<script setup lang="ts">
/**
 * Zalgo: один и тот же код, два состояния кеша, два разных порядка.
 *
 * Смысл демо — в переменной `spinner` слева: в горячей ветке колбэк читает её **до**
 * присваивания, потому что вызван синхронно, не дав `load` дойти до следующей строки.
 * Увидеть это на статичной картинке нельзя — видно только по шагам, поэтому значение
 * переменной вынесено в отдельное поле и меняется прямо на глазах.
 *
 * Вывод показан фишками, а не строками: тон отделяет корректный порядок от испорченного.
 */
import { computed, ref, watch } from 'vue';
import { usePlayer } from '@/shared/lib/usePlayer';
import { useStepper } from '@/shared/lib/useStepper';
import CodeListing from '@/shared/ui/CodeListing.vue';
import ConsoleView from '@/shared/ui/ConsoleView.vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import PlayerToolbar from '@/shared/ui/PlayerToolbar.vue';
import { SegmentedControl } from '@/shared/ui';
import type { ZalgoMode } from '../model/types';

const props = defineProps<{ code: string[]; modes: ZalgoMode[] }>();

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
        <span class="modes__label">getUser(id, cb) — кеш:</span>
        <SegmentedControl v-model="picked" class="l-pills" label="Состояние кеша" :options="options" />
      </div>
    </template>

    <div class="split">
      <div class="pane">
        <CodeListing :lines="code" :active="step.line" label="function load(id)" />
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

        <div class="state">
          <div class="cell">
            <div class="t-label">spinner</div>
            <div class="value" :data-tone="step.spinner === 'null' ? 'err' : 'ok'">{{ step.spinner }}</div>
          </div>
          <div class="cell">
            <div class="t-label">стек</div>
            <div class="value" data-tone="neutral">{{ step.stack }}</div>
          </div>
        </div>

        <ConsoleView :chips="step.out" :min-height="52" empty-label="пока пусто" />
      </div>
    </div>

    <template #footer>
      <div class="verdict" :data-state="finished ? mode.tone : 'pending'">
        {{ finished ? mode.verdict : 'пройдите все шаги' }}
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
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr);
}
.pane {
  padding: 20px;
  border-right: 1px solid var(--divider);
  min-width: 0;
}
.pane--right {
  display: flex;
  flex-direction: column;
  gap: 16px;
  border-right: 0;
  background: var(--surface-2);
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

.state {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(130px, 100%), 1fr));
  gap: 10px;
}
.cell {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}
.value {
  padding: 10px 12px;
  border-radius: var(--r2);
  font-family: var(--mono);
  font-size: var(--fs-4);
  transition: all 0.2s;
}
/* `spinner === null` — красный не «ошибка», а «вот сейчас проверка if провалится». */
.value[data-tone='err'] {
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-strong);
}
.value[data-tone='ok'] {
  border: 1px solid var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-strong);
}
.value[data-tone='neutral'] {
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--chip-text);
}

.verdict {
  font-size: var(--fs-6);
  line-height: 1.6;
  transition: all 0.2s;
}
.verdict[data-state='pending'] {
  color: var(--dim);
}
.verdict[data-state='ok'] {
  color: var(--tone-ok-text);
}
.verdict[data-state='err'] {
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
