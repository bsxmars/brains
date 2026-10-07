<script setup lang="ts">
/**
 * Путь объекта по кучe: два полупространства, указатель аллокации, копирование выживших,
 * remembered set, promotion и пространство больших объектов.
 *
 * Зачем это картинкой, а не текстом. Тезис урока — «мусор бесплатен, дорого выживание» —
 * пространственный: он про то, что сборщик **обходит только живое**, а мёртвое освобождается
 * одним движением указателя. Словами это звучит как лозунг; на дорожке видно, что при сборке
 * переезжает один блок из пяти, а вся старая половина гаснет целиком.
 *
 * Поэтому рядом стоят два счётчика — скопировано против освобождённого. Их отношение и есть
 * число под тезисом: цена Scavenge пропорциональна выжившим, а не мусору.
 */
import { computed } from 'vue';
import { usePlayer } from '@/shared/lib/usePlayer';
import { useStepper } from '@/shared/lib/useStepper';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import PlayerToolbar from '@/shared/ui/PlayerToolbar.vue';
import type { GcStep, HeapBlock } from '../model/types';

const props = withDefaults(defineProps<{ steps: GcStep[]; capacity?: number }>(), {
  capacity: 512,
});

const stepper = useStepper(props.steps.length);
const { index, counter, atStart, atEnd, next, prev, reset, go } = stepper;
const { playing, speed, speeds, available, toggle, setSpeed } = usePlayer(stepper);
const step = computed(() => props.steps[index.value]);

const used = (blocks: HeapBlock[]) => blocks.reduce((sum, b) => sum + b.size, 0);

/** Полупространства всегда рисуем парой: половина активна, половина ждёт своей очереди. */
const halves = computed(() => {
  const s = step.value;
  return (['a', 'b'] as const).map((key) => {
    const blocks = s[key];
    const busy = used(blocks);
    return {
      key,
      name: `полупространство ${key.toUpperCase()}`,
      role: s.active === key ? 'to-space · сюда идут аллокации' : 'from-space · пусто до сборки',
      active: s.active === key,
      blocks,
      busy,
      free: Math.max(0, props.capacity - busy),
      /** Указатель аллокации — это и есть граница занятой части. */
      pointer: Math.min(100, (busy / props.capacity) * 100),
    };
  });
});

const oldUsed = computed(() => used(step.value.old));
/** Во сколько раз освобождённое дешевле скопированного — число под тезисом. */
const ratio = computed(() =>
  step.value.copied > 0 ? (step.value.freed / step.value.copied).toFixed(1) : null,
);
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
        <div class="t-label">young generation · {{ capacity }} КБ на полупространство</div>

        <div class="scroll">
          <div class="halves">
            <div v-for="half in halves" :key="half.key" class="half" :data-active="half.active ? 'yes' : 'no'">
              <div class="half__head">
                <span class="half__name">{{ half.name }}</span>
                <span class="half__role">{{ half.role }}</span>
              </div>

              <div class="rail">
                <div class="track">
                  <div
                    v-for="block in half.blocks"
                    :key="block.id"
                    class="block"
                    :data-live="block.live ? 'yes' : 'no'"
                    :style="`flex:${block.size} 1 0`"
                  ></div>
                  <div v-if="half.free > 0" class="free" :style="`flex:${half.free} 1 0`"></div>
                </div>
                <span v-if="half.active" class="pointer" :style="`left:${half.pointer}%`"></span>
              </div>

              <div class="legend">
                <span v-for="block in half.blocks" :key="block.id" class="chip" :data-live="block.live ? 'yes' : 'no'">
                  {{ block.label }} · {{ block.size }} КБ
                </span>
                <span v-if="!half.blocks.length" class="chip chip--empty">половина пуста</span>
              </div>

              <div v-if="half.active" class="pointer-note">
                указатель аллокации: {{ half.busy }} / {{ capacity }} КБ
              </div>
            </div>
          </div>
        </div>

        <div v-if="step.remembered" class="remembered">
          <span class="remembered__arrow">old → young</span>
          <span class="remembered__text">remembered set: {{ step.remembered }}</span>
        </div>

        <div class="spaces">
          <div class="space">
            <div class="space__head">
              <span class="space__name">OLD · Old Space</span>
              <span class="space__tag">Mark-Compact · {{ oldUsed }} КБ</span>
            </div>
            <div class="legend">
              <span v-for="block in step.old" :key="block.id" class="chip" data-live="yes">
                {{ block.label }} · {{ block.size }} КБ
              </span>
              <span v-if="!step.old.length" class="chip chip--empty">пусто</span>
            </div>
          </div>

          <div class="space" :data-on="step.los.length ? 'yes' : 'no'">
            <div class="space__head">
              <span class="space__name">LARGE OBJECT SPACE</span>
              <span class="space__tag">страницами, без копирования</span>
            </div>
            <div class="legend">
              <span v-for="block in step.los" :key="block.id" class="chip" data-live="yes">{{ block.label }}</span>
              <span v-if="!step.los.length" class="chip chip--empty">пусто</span>
            </div>
          </div>
        </div>
      </div>

      <div class="pane pane--right">
        <div class="phase" :data-tone="step.tone">{{ step.phase }}</div>
        <div class="message" :data-tone="step.tone">{{ step.message }}</div>

        <div class="field">
          <div class="t-label">цена</div>
          <div class="cost" :data-tone="step.tone">{{ step.cost }}</div>
        </div>

        <div class="counters">
          <div class="counter" data-kind="copied">
            <span class="t-label">скопировано</span>
            <span class="counter__value">{{ step.copied }} КБ</span>
            <span class="counter__note">это и есть работа сборщика</span>
          </div>
          <div class="counter" data-kind="freed">
            <span class="t-label">освобождено</span>
            <span class="counter__value">{{ step.freed }} КБ</span>
            <span class="counter__note">одним сбросом указателя</span>
          </div>
        </div>

        <div v-if="ratio" class="ratio">
          Освобождено в {{ ratio }} раза больше, чем скопировано, — и обошлось это в одну
          операцию. Мусор не обходился и не считался.
        </div>
      </div>
    </div>
  </DemoFrame>
</template>

<style scoped>
.split {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
}
.pane {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
  border-right: 1px solid var(--divider);
  /* Во флекс-колонке элемент не сжимается ниже содержимого: без этого дорожки утаскивают
     страницу вбок на узком экране вместо того, чтобы прокручиваться внутри себя. */
  min-width: 0;
}
.pane--right {
  gap: 16px;
  border-right: 0;
  background: var(--surface-2);
}

.scroll {
  min-width: 0;
  overflow-x: auto;
}
.halves {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 280px;
}

.half {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 13px 15px;
  border: 1px solid var(--border);
  border-radius: var(--r3);
  background: var(--surface-2);
  transition: all 0.2s;
}
/* Активная половина — та, в которую сейчас идут аллокации. */
.half[data-active='yes'] {
  border: 1.5px solid var(--accent);
  background: var(--tone-info-bg);
}

.half__head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
}
.half__name {
  font-family: var(--mono);
  font-size: var(--fs-3);
  font-weight: 600;
  color: var(--ink);
}
.half__role {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}

/* Дорожка: ширина блока пропорциональна его размеру, свободный хвост — остаток половины. */
.rail {
  position: relative;
}
.track {
  display: flex;
  gap: 2px;
  height: 20px;
  border-radius: var(--r1);
  overflow: hidden;
  background: var(--surface);
}
.block {
  min-width: 2px;
  transition: all 0.25s;
}
.block[data-live='yes'] {
  background: var(--tone-ok-strong);
}
.block[data-live='no'] {
  background: var(--bar-neutral);
}
.free {
  background: var(--sunk-dim);
}

/* Указатель аллокации: граница занятой части, она же место следующего объекта. */
.pointer {
  position: absolute;
  top: -3px;
  bottom: -3px;
  width: 2px;
  background: var(--accent);
  transition: left 0.25s;
}
.pointer-note {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--tone-info-strong);
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.chip {
  padding: 4px 8px;
  border-radius: var(--r1);
  font-family: var(--mono);
  font-size: var(--fs-2);
}
.chip[data-live='yes'] {
  border: 1px solid var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-strong);
}
.chip[data-live='no'] {
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--dim);
}
.chip--empty {
  border: 1px dashed var(--hairline);
  background: none;
  color: var(--ghost);
  font-style: italic;
}

/* Ребро old → young: то самое, которое Scavenge сам бы не нашёл. */
.remembered {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 9px;
  padding: 10px 13px;
  border: 1px dashed var(--tone-warn-line);
  border-radius: var(--r2);
  background: var(--tone-warn-bg);
}
.remembered__arrow {
  font-family: var(--mono);
  font-size: var(--fs-2);
  font-weight: 600;
  color: var(--tone-warn-strong);
  white-space: nowrap;
}
.remembered__text {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--tone-warn-text);
}

.spaces {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.space {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 13px 15px;
  border: 1px solid var(--border);
  border-radius: var(--r3);
  background: var(--surface-2);
  transition: all 0.2s;
}
.space[data-on='yes'] {
  border-color: var(--tone-warn-line);
  background: var(--tone-warn-bg);
}
.space__head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
}
.space__name {
  font-family: var(--mono);
  font-size: var(--fs-3);
  font-weight: 600;
  color: var(--ink);
}
.space__tag {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}

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
.phase[data-tone='ok'] {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-strong);
}
.phase[data-tone='info'] {
  background: var(--tone-info-bg);
  color: var(--tone-info-strong);
}
.phase[data-tone='warn'] {
  background: var(--tone-warn-bg);
  color: var(--tone-warn-strong);
}
.phase[data-tone='err'] {
  background: var(--tone-err-bg);
  color: var(--tone-err-strong);
}

.message {
  padding: 14px 16px;
  border-radius: var(--r2);
  font-size: var(--fs-6);
  line-height: 1.6;
  transition: all 0.2s;
}
.message[data-tone='ok'] {
  border: 1px solid var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
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
.message[data-tone='err'] {
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.cost {
  font-size: var(--fs-6);
  line-height: 1.6;
}
.cost[data-tone='ok'] {
  color: var(--tone-ok-strong);
}
.cost[data-tone='info'] {
  color: var(--tone-info-strong);
}
.cost[data-tone='warn'] {
  color: var(--tone-warn-strong);
}
.cost[data-tone='err'] {
  color: var(--tone-err-strong);
}

.counters {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(150px, 100%), 1fr));
  gap: 10px;
  padding-top: 14px;
  border-top: 1px solid var(--rule);
}
.counter {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.counter__value {
  font-family: var(--mono);
  font-size: var(--fs-8);
  transition: color 0.2s;
}
.counter[data-kind='copied'] .counter__value {
  color: var(--tone-warn-strong-2);
}
.counter[data-kind='freed'] .counter__value {
  color: var(--tone-ok-strong);
}
.counter__note {
  font-size: var(--fs-4);
  line-height: 1.45;
  color: var(--text-muted);
}

.ratio {
  padding: 13px 15px;
  border: 1px solid var(--tone-ok-line);
  border-radius: var(--r2);
  background: var(--tone-ok-bg);
  font-size: var(--fs-6);
  line-height: 1.6;
  color: var(--tone-ok-text);
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
