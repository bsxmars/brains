<script setup lang="ts">
/**
 * Процедура, которую проходят, а не читают.
 *
 * Такие вещи в курсе до сих пор показывались таблицей: семь строк, у каждой «шаг» и «зачем».
 * Таблицу читают по диагонали — а порядок шагов здесь не рекомендация, а условие
 * работоспособности: каждый отсекает свой класс ложных находок, и пропущенный шаг превращает
 * следующий в гадание. Поэтому «зачем» раскрыто только у текущего шага: чтобы узнать, зачем
 * следующий, нужно закрыть этот.
 *
 * Подготовка стоит отдельным блоком перед шагами и блокирует их намеренно. Половина проблем
 * с шумом в снимке — от самого браузера: расширения, консоль, выбранный узел в Elements.
 * Пока это не сделано, проходить процедуру бессмысленно, и лучше сказать об этом до, а не после.
 *
 * Автоплея здесь нет и быть не должно: шаги выполняет человек в своём инструменте, а не демо.
 */
import { computed, ref, type Ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button } from '@/shared/ui';
import type { ProcedureStep } from '../model/types';

const props = withDefaults(
  defineProps<{
    steps: ProcedureStep[];
    /** Что сделать до первого шага. Разрешена строчная разметка. */
    prep?: string[];
    prepTitle?: string;
  }>(),
  { prep: () => [], prepTitle: 'перед началом' },
);

const doneSteps = ref(new Set<number>());
const donePrep = ref(new Set<number>());

const prepReady = computed(() => donePrep.value.size === props.prep.length);
const current = computed(() => props.steps.findIndex((_, i) => !doneSteps.value.has(i)));
const finished = computed(() => current.value === -1);

/**
 * ⚠️ Разворачивание ссылки живёт здесь, а не в шаблоне, и это не стиль, а условие
 * работоспособности. Прежняя версия звала из шаблона `toggle(donePrep, i)`, принимая
 * `Ref<Set>`, — но в шаблоне Vue ссылки разворачиваются автоматически, и внутрь приезжал
 * сам `Set`. Дальше `new Set(set.value)` получал `undefined`, а присваивание уходило
 * в несуществующее поле: чекбоксы подготовки не отмечались, `prepReady` оставался ложью,
 * и кнопка «шаг выполнен» была `disabled` навсегда. Ни сборка, ни `astro check` этого
 * не видели — шаблон `.vue` не проверяет ни один из них, поймал `vue-tsc`.
 */
const flip = (target: Ref<Set<number>>, i: number) => {
  const next = new Set(target.value);
  if (next.has(i)) next.delete(i);
  else next.add(i);
  target.value = next;
};

const togglePrep = (i: number) => flip(donePrep, i);

const advance = () => {
  if (current.value >= 0) flip(doneSteps, current.value);
};

const reset = () => {
  doneSteps.value = new Set();
  donePrep.value = new Set();
};

const state = (i: number) => {
  if (doneSteps.value.has(i)) return 'done';
  return i === current.value ? 'current' : 'next';
};
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="bar">
        <span class="counter">{{ doneSteps.size }} из {{ steps.length }}</span>
        <Button variant="primary" :disabled="!prepReady || finished" @click="advance">
          {{ finished ? 'процедура пройдена' : 'шаг выполнен →' }}
        </Button>
        <Button v-if="doneSteps.size || donePrep.size" variant="secondary" @click="reset">
          сброс
        </Button>
      </div>
    </template>

    <div class="body">
      <section v-if="prep.length" class="prep" :data-state="prepReady ? 'ready' : 'blocking'">
        <div class="t-eyebrow t-eyebrow--panel">{{ prepTitle }}</div>

        <label v-for="(item, i) in prep" :key="i" class="check">
          <input type="checkbox" :checked="donePrep.has(i)" @change="togglePrep(i)" />
          <Md as="span" class="check__text" :text="item" />
        </label>

        <p v-if="!prepReady" class="warn">
          Пока это не сделано, проходить процедуру незачем: половина шума в снимке — от самого
          браузера, а не от вашего кода.
        </p>
      </section>

      <ol class="steps" :data-blocked="prepReady ? 'no' : 'yes'">
        <li v-for="(step, i) in steps" :key="step.n" class="step" :data-state="state(i)">
          <span class="step__n">{{ step.n }}</span>

          <div class="step__body">
            <span class="step__title">{{ step.t }}</span>
            <!-- «Зачем» — только у текущего: иначе список снова читается по диагонали. -->
            <Md v-if="state(i) === 'current'" class="step__why" :text="step.why" />
          </div>
        </li>
      </ol>
    </div>
  </DemoFrame>
</template>

<style scoped>
.bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}
.counter {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}

.body {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 20px;
  min-width: 0;
}

.prep {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px 18px;
  border-radius: var(--r2);
  transition: background 0.2s;
}
.prep[data-state='blocking'] {
  background: var(--tone-warn-bg);
}
.prep[data-state='ready'] {
  background: var(--tone-ok-bg);
}

.check {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  cursor: pointer;
}
/* У флажка свои системные цвета и шрифт — в палитре курса их нет, и проверка на них краснеет.
   `accent-color` красит галочку, но собственный цвет текста у элемента остаётся браузерным
   (чёрный), поэтому его тоже задаём явно. */
.check input {
  margin: 3px 0 0;
  accent-color: var(--accent);
  font: inherit;
  color: inherit;
}
.check__text {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--prose);
}

.warn {
  margin: 0;
  font-size: var(--fs-4);
  line-height: 1.5;
  color: var(--tone-warn-text);
}

.steps {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
  transition: opacity 0.2s;
}
.steps[data-blocked='yes'] {
  opacity: 0.45;
}

.step {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 13px 15px;
  border-radius: var(--r2);
  transition: all 0.18s;
}
.step[data-state='current'] {
  background: var(--tone-info-bg);
  box-shadow: inset 3px 0 0 var(--accent);
}
.step[data-state='done'] {
  background: var(--sunk-dim);
}

.step__n {
  flex-shrink: 0;
  width: 22px;
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.5;
  color: var(--accent);
}
.step[data-state='done'] .step__n {
  color: var(--tone-ok-strong);
}

.step__body {
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-width: 0;
}
.step__title {
  font-size: var(--fs-6);
  line-height: 1.45;
  color: var(--ink);
}
.step[data-state='next'] .step__title {
  color: var(--text-muted);
}
.step[data-state='done'] .step__title {
  color: var(--text-muted);
}
.step__why {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--tone-info-text);
}
</style>
