<script setup lang="ts">
/**
 * Порядок инициализации экземпляра: десять шагов от `new Child()` до конца конструктора.
 *
 * Смотреть надо на две колонки одновременно — курсор прыгает между телом наследника и телом
 * родителя, и именно в этом прыжке прячется сюрприз: на шаге, где `Base` зовёт `this.init()`,
 * диспетчеризация динамическая, вызывается `Child.init`, а полей `Child` ещё нет. В консоли
 * появляется `undefined`, хотя в исходнике написано `items = []`.
 *
 * Колонка «состояние объекта» отвечает на вопрос, которого в оригинале не было: до `super()`
 * объекта не существует вовсе, поэтому там не `undefined`, а `ReferenceError`.
 *
 * Порядок шагов сверен запуском в Node 24.11 — вывод демо совпадает с выводом движка.
 */
import { computed } from 'vue';
import { usePlayer } from '@/shared/lib/usePlayer';
import { useStepper } from '@/shared/lib/useStepper';
import CodeListing from '@/shared/ui/CodeListing.vue';
import ConsoleView from '@/shared/ui/ConsoleView.vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import PlayerToolbar from '@/shared/ui/PlayerToolbar.vue';
import type { InitStep } from '../model/types';
import Md from '@/shared/ui/Md.vue';

const props = defineProps<{
  base: string[];
  child: string[];
  steps: InitStep[];
  /** Подписи над листингами. */
  baseLabel?: string;
  childLabel?: string;
}>();

const total = computed(() => props.steps.length);
const stepper = useStepper(total);
const { index, counter, atStart, atEnd, next, prev, reset, go } = stepper;
const { playing, speed, speeds, available, toggle, setSpeed } = usePlayer(stepper);

const step = computed(() => props.steps[Math.min(index.value, total.value - 1)]);

const baseLine = computed(() => (step.value.pane === 'base' ? step.value.line : -1));
const childLine = computed(() => (step.value.pane === 'child' ? step.value.line : -1));

/** Пока объекта нет — так и написано словами: это не пустой объект, а его отсутствие. */
const objText = computed(() => {
  const obj = step.value.obj;
  if (obj === null) return 'объекта ещё нет';
  return obj.length ? `{ ${obj.join(', ')} }` : '{ } — полей нет';
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
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
    </template>

    <div class="split">
      <div class="pane">
        <CodeListing :lines="base" :active="baseLine" :label="baseLabel ?? 'class Base'" />
        <CodeListing :lines="child" :active="childLine" :label="childLabel ?? 'class Child extends Base'" />
      </div>

      <div class="pane pane--right">
        <Md class="msg" :data-tone="step.tone ?? 'info'" :text="step.msg" />

        <div class="block">
          <div class="t-label">состояние объекта</div>
          <div class="obj" :data-empty="step.obj === null ? 'yes' : 'no'">{{ objText }}</div>
        </div>

        <ConsoleView :lines="step.out" :min-height="64" empty-label="консоль молчит" />
      </div>
    </div>
  </DemoFrame>
</template>

<style scoped>
.split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
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

.msg {
  padding: 14px 16px;
  border-radius: var(--r2);
  font-size: var(--fs-6);
  line-height: 1.55;
  transition: all 0.2s;
}
.msg[data-tone='info'] {
  border: 1px solid var(--tone-info-line);
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
}
.msg[data-tone='warn'] {
  border: 1px solid var(--tone-warn-line);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.msg[data-tone='err'] {
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}

.block {
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.obj {
  padding: 11px 13px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--surface);
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.5;
  color: var(--ink);
  overflow-wrap: anywhere;
  transition: all 0.2s;
}
.obj[data-empty='yes'] {
  font-style: italic;
  color: var(--dim);
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
