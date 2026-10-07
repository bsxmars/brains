<script setup lang="ts">
/**
 * Как схлопывается дерево конкатенаций.
 *
 * Демо держится на одном факте, который в статьях обычно опускают: `String::Flatten`
 * **не создаёт новый объект и не меняет тип**. Он выделяет плоский буфер, сливает туда листья
 * по порядку, а потом переписывает `first` на этот буфер и `second` на пустую строку. Поэтому
 * тип показан на каждом шаге отдельной плашкой — и на всех шагах он один и тот же.
 *
 * Отсюда же практический вывод, ради которого всё это: «расплющена ли строка» по типу
 * не проверяется. Проверяется по времени — первый доступ дорогой, второй дешёвый.
 */
import { computed } from 'vue';
import { usePlayer } from '@/shared/lib/usePlayer';
import { useStepper } from '@/shared/lib/useStepper';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import PlayerToolbar from '@/shared/ui/PlayerToolbar.vue';
import type { FlattenStep } from '../model/types';

const props = defineProps<{
  /** Листья дерева слева направо — куски, из которых собиралась строка. */
  leaves: string[];
  steps: FlattenStep[];
}>();

const stepper = useStepper(props.steps.length);
const { index, counter, atStart, atEnd, next, prev, reset, go } = stepper;
const { playing, speed, speeds, available, toggle, setSpeed } = usePlayer(stepper);
const step = computed(() => props.steps[index.value]);

/** Что уже перенесено в плоский буфер. */
const buffer = computed(() => props.leaves.slice(0, step.value.copied).join(''));
const done = computed(() => step.value.copied >= props.leaves.length);
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
        next-label="Шаг →"
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
        <div class="t-label">дерево конкатенаций</div>

        <div class="scroll">
          <div class="tree">
            <div class="node">
              <span class="node__name">ConsString</span>
              <span class="node__len">length считается один раз и лежит в заголовке</span>
            </div>

            <div class="wires" aria-hidden="true">
              <span class="wire"></span>
              <span class="wire"></span>
            </div>

            <div class="slots">
              <div class="slot">
                <span class="slot__key">first</span>
                <span class="slot__value" :data-state="done ? 'flat' : 'tree'">{{ step.first }}</span>
              </div>
              <div class="slot">
                <span class="slot__key">second</span>
                <span class="slot__value" :data-state="done ? 'empty' : 'tree'">{{ step.second }}</span>
              </div>
            </div>

            <div class="leaves">
              <span
                v-for="(leaf, i) in leaves"
                :key="i"
                class="leaf"
                :data-state="i < step.copied ? 'copied' : 'pending'"
              >{{ leaf }}</span>
            </div>
            <div class="leaves__label">листья: исходные плоские куски</div>
          </div>
        </div>
      </div>

      <div class="pane pane--right">
        <div class="field">
          <div class="t-label">плоский буфер</div>
          <div class="buffer" :data-state="step.copied === 0 ? 'none' : done ? 'full' : 'filling'">
            <span v-if="step.copied === 0" class="buffer__empty">ещё не выделен</span>
            <span v-else class="buffer__text">{{ buffer }}</span>
          </div>
          <div class="buffer__meter">
            <div class="buffer__fill" :style="`width:${(step.copied / leaves.length) * 100}%`"></div>
          </div>
        </div>

        <div class="field">
          <div class="t-label">%DebugPrint → type</div>
          <div class="type">{{ step.type }}</div>
          <div class="type__note">тип не меняется ни на одном шаге — это всё тот же объект</div>
        </div>

        <div class="message" :data-tone="step.tone ?? 'info'">{{ step.message }}</div>
      </div>
    </div>
  </DemoFrame>
</template>

<style scoped>
.split {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(290px, 100%), 1fr));
}
.pane {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
  padding: 20px;
  border-right: 1px solid var(--divider);
}
.pane--right {
  border-right: 0;
  background: var(--surface-2);
}

/* `min-width: 0` — дерево шире колонки обязано прокручиваться внутри себя. */
.scroll {
  min-width: 0;
  overflow-x: auto;
}
.tree {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 250px;
}

.node {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 11px 13px;
  border: 1px solid var(--ink);
  border-radius: var(--r3);
  background: var(--surface);
}
.node__name {
  font-family: var(--mono);
  font-size: var(--fs-4);
  font-weight: 600;
}
.node__len {
  font-size: var(--fs-4);
  line-height: 1.4;
  color: var(--text-muted);
}

.wires {
  display: flex;
  justify-content: space-around;
  height: 14px;
}
.wire {
  width: 0;
  border-left: 2px solid var(--hairline);
}

.slots {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 7px;
}
.slot {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 9px 11px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--surface);
  transition: all 0.2s;
}
.slot__key {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}
.slot__value {
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.4;
  overflow-wrap: anywhere;
  color: var(--chip-text);
}
.slot__value[data-state='flat'] {
  color: var(--tone-ok-strong);
}
.slot__value[data-state='empty'] {
  color: var(--dim);
}

.leaves {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 6px;
}
.leaf {
  padding: 7px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r1);
  font-family: var(--mono);
  font-size: var(--fs-2);
  transition: all 0.2s;
}
.leaf[data-state='pending'] {
  background: var(--surface);
  color: var(--chip-text);
}
/* Скопированный лист гаснет: его содержимое теперь живёт в буфере, а не читается отсюда. */
.leaf[data-state='copied'] {
  border-color: var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-strong);
}
.leaves__label {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-width: 0;
}

.buffer {
  padding: 13px 15px;
  border-radius: var(--r2);
  border: 1px solid var(--border);
  background: var(--surface);
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.6;
  overflow-wrap: anywhere;
  transition: all 0.2s;
}
.buffer[data-state='none'] {
  border-style: dashed;
  border-color: var(--border-strong);
  background: var(--sunk-dim);
}
.buffer[data-state='full'] {
  border-color: var(--tone-ok-line);
  background: var(--tone-ok-bg);
}
.buffer__empty {
  font-style: italic;
  color: var(--ghost);
}
.buffer__text {
  color: var(--ink);
}
.buffer__meter {
  height: 6px;
  border-radius: var(--r1);
  background: var(--surface-3);
}
.buffer__fill {
  height: 6px;
  border-radius: var(--r1);
  background: var(--bar-green);
  transition: width 0.25s;
}

.type {
  padding: 11px 13px;
  border: 1px solid var(--tone-info-line);
  border-radius: var(--r2);
  background: var(--tone-info-bg);
  font-family: var(--mono);
  font-size: var(--fs-3);
  overflow-wrap: anywhere;
  color: var(--tone-info-strong);
}
.type__note {
  font-size: var(--fs-4);
  line-height: 1.5;
  color: var(--text-muted);
}

.message {
  padding: 14px 16px;
  border-radius: var(--r2);
  font-size: var(--fs-6);
  line-height: 1.6;
  transition: all 0.2s;
}
.message[data-tone='info'] {
  border: 1px solid var(--tone-info-line);
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
}
.message[data-tone='warn'] {
  border: 1px solid var(--tone-warn-line);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.message[data-tone='ok'] {
  border: 1px solid var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
</style>
