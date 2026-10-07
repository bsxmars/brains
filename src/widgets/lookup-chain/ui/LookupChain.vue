<script setup lang="ts">
/**
 * Чтение свойства по цепочке — буквально то, что делает движок на `obj.key`.
 *
 * Демо существует ради двух вещей, которые словами не показать. Первая: промах — не ошибка,
 * цепочка спокойно доходит до `null` и возвращает `undefined`. Вторая: аксессор, найденный
 * в прототипе, вызывается с `this = Receiver`, то есть с тем объектом, **с которого начали**,
 * а не с тем, где свойство нашлось. Поэтому в цепочке есть ключ, который приводит именно туда.
 *
 * Логика шагов вынесена в `model/lookup.ts` и чистая: её можно прогнать тестом против
 * настоящего объекта, а не сверять глазами.
 */
import { computed, ref, watch } from 'vue';
import { usePlayer } from '@/shared/lib/usePlayer';
import { useStepper } from '@/shared/lib/useStepper';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import PlayerToolbar from '@/shared/ui/PlayerToolbar.vue';
import { SegmentedControl } from '@/shared/ui';
import { buildLookup } from '../model/lookup';
import type { ChainNode } from '../model/types';
import Md from '@/shared/ui/Md.vue';

const props = defineProps<{
  chain: ChainNode[];
  keys: string[];
  values: Record<string, string>;
}>();

const picked = ref(props.keys[0]);
const options = computed(() => props.keys.map((key) => ({ value: key, label: key })));

const steps = computed(() => buildLookup(props.chain, picked.value, props.values));
const total = computed(() => steps.value.length);

const stepper = useStepper(total);
const { index, counter, atStart, atEnd, next, prev, reset, go } = stepper;
const { playing, speed, speeds, available, toggle, setSpeed } = usePlayer(stepper);
watch(picked, reset);

const step = computed(() => steps.value[Math.min(index.value, total.value - 1)]);

/** Что сейчас с узлом: смотрим его, нашли в нём или уже прошли мимо. */
function nodeState(i: number): 'hit' | 'scan' | 'miss' | 'idle' {
  if (step.value.lvl === i) return step.value.found ? 'hit' : 'scan';
  return i < step.value.lvl ? 'miss' : 'idle';
}

/** Поиск дошёл до конца цепочки — подсвечивается коробка `null`. */
const atNull = computed(() => step.value.lvl === props.chain.length);
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="lc-bar">
        <span class="lc-bar__label">читаем dog.</span>
        <SegmentedControl v-model="picked" class="l-pills" label="Ключ для чтения" :options="options" />
      </div>
    </template>

    <div class="lc-split">
      <div class="lc-pane">
        <div class="t-label">цепочка прототипов</div>

        <div v-for="(node, i) in chain" :key="node.name" class="lc-link">
          <div class="lc-node" :data-state="nodeState(i)">
            <div class="lc-node__head">
              <span class="lc-node__name">{{ node.name }}</span>
              <span class="lc-node__tag">{{ node.tag }}</span>
            </div>

            <div class="lc-node__keys">
              <span
                v-for="key in node.keys"
                :key="key"
                class="lc-key"
                :data-on="key === picked && step.lvl === i ? 'yes' : 'no'"
              >{{ key }}</span>
            </div>

            <div v-if="step.lvl === i" class="lc-node__verdict" :data-found="step.found ? 'yes' : 'no'">
              {{ step.found ? '✓ найдено здесь' : '✗ нет — идём дальше' }}
            </div>
          </div>

          <div class="lc-arrow">↓ [[Prototype]]</div>
        </div>

        <div class="lc-null" :data-on="atNull ? 'yes' : 'no'">null — дальше идти некуда</div>
      </div>

      <div class="lc-pane lc-pane--right">
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

        <ol class="lc-steps">
          <li
            v-for="(item, i) in steps"
            :key="i"
            class="lc-step"
            :data-state="i === index ? 'active' : i < index ? 'done' : 'next'"
            :data-tone="i === index ? (item.tone ?? 'info') : undefined"
          >
            <span class="lc-step__n">{{ String(i + 1).padStart(2, '0') }}</span>
            <Md as="span" :text="item.msg" />
          </li>
        </ol>

        <div class="lc-result">
          <div class="t-label">результат</div>
          <div class="lc-result__box" :data-tone="step.res ? (step.tone ?? 'ok') : 'idle'">
            {{ step.res ?? '…' }}
          </div>
        </div>
      </div>
    </div>
  </DemoFrame>
</template>

<style scoped>
/*
 * ⚠️ Все классы слайса — с префиксом `lc-` (2026-10-03). Без него на дев-сервере, где стили
 * острова живут голыми селекторами, моноширинный `.result__box` отсюда накрывал итоги трёх
 * соседних демо «Объектной модели»: записи, протокола итерации и `instanceof`.
 */
.lc-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.lc-bar__label {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}

.lc-split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr);
}
.lc-pane {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px;
  border-right: 1px solid var(--divider);
  min-width: 0;
}
.lc-pane--right {
  border-right: 0;
  background: var(--surface-2);
  gap: 16px;
}

/* Узел цепочки — единственное место, где рамка в 1px осталась осмысленной: это граница
   настоящего объекта, а не украшение карточки. Состояние меняет её толщину и цвет. */
.lc-node {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--surface);
  transition: all 0.2s;
}
.lc-node[data-state='idle'] {
  opacity: 0.85;
}
.lc-node[data-state='miss'] {
  opacity: 0.5;
}
.lc-node[data-state='scan'] {
  border: 1.5px solid var(--accent);
  box-shadow: 0 0 0 3px var(--tone-info-chip);
}
.lc-node[data-state='hit'] {
  border: 1.5px solid var(--tone-ok-strong);
  box-shadow: 0 0 0 3px var(--tone-ok-chip);
}

.lc-node__head {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
}
.lc-node__name {
  font-family: var(--mono);
  font-size: var(--fs-4);
  font-weight: 600;
  color: var(--ink);
}
.lc-node__tag {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.lc-node__keys {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.lc-key {
  padding: 3px 8px;
  border-radius: var(--r-full);
  background: var(--surface-3);
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--chip-text);
  transition: all 0.18s;
}
/* Ключ, который сейчас ищут, и именно в том узле, где смотрят. */
.lc-key[data-on='yes'] {
  background: var(--tone-ok-chip);
  font-weight: 600;
  color: var(--tone-ok-strong);
}

.lc-node__verdict {
  font-family: var(--mono);
  font-size: var(--fs-2);
}
.lc-node__verdict[data-found='yes'] {
  color: var(--tone-ok-strong);
}
.lc-node__verdict[data-found='no'] {
  color: var(--text-muted);
}

.lc-arrow {
  padding: 5px 0 5px 2px;
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-faint);
}
/* У последнего узла стрелка ведёт в коробку `null`, которая стоит отдельным блоком. */
.lc-link:last-of-type .lc-arrow {
  color: var(--ghost);
}

/* Конец цепочки — пунктир: это не объект, а его отсутствие. */
.lc-null {
  padding: 9px 14px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--r2);
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--dim);
  transition: all 0.2s;
}
.lc-null[data-on='yes'] {
  border-color: var(--tone-warn-line);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-strong);
}

.lc-steps {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.lc-step {
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
.lc-step[data-state='done'] {
  color: var(--text-muted);
}
.lc-step[data-state='next'] {
  color: var(--dim);
}
.lc-step[data-tone='info'] {
  background: var(--tone-info-bg);
  border-color: var(--tone-info-line);
  color: var(--tone-info-text);
}
.lc-step[data-tone='ok'] {
  background: var(--tone-ok-bg);
  border-color: var(--tone-ok-line);
  color: var(--tone-ok-text);
}
.lc-step[data-tone='warn'] {
  background: var(--tone-warn-bg);
  border-color: var(--tone-warn-line);
  color: var(--tone-warn-text);
}
/* Прозрачность и приглушённый цвет перемножались: 1.71:1 на панели — номер шага не читался
   вовсе. Подробнее о счёте — в `widgets/set-algorithm`, правило там же общее по смыслу. */
.lc-step__n {
  flex-shrink: 0;
  font-family: var(--mono);
  font-size: var(--fs-2);
  opacity: 0.8;
}

.lc-result {
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.lc-result__box {
  padding: 13px 15px;
  border-radius: var(--r2);
  font-family: var(--mono);
  font-size: var(--fs-5);
  transition: all 0.2s;
}
.lc-result__box[data-tone='idle'] {
  border: 1px solid var(--divider);
  background: var(--sunk-dim);
  color: var(--dim);
}
.lc-result__box[data-tone='ok'] {
  border: 1px solid var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.lc-result__box[data-tone='warn'] {
  border: 1px solid var(--tone-warn-line);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}

@media (max-width: 720px) {
  .lc-split {
    grid-template-columns: 1fr;
  }
  .lc-pane {
    border-right: 0;
    border-bottom: 1px solid var(--divider);
  }
}
</style>
