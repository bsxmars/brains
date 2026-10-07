<script setup lang="ts">
/**
 * Состояния inline cache: во сколько раз дороже становится чтение поля.
 *
 * Отличие от оригинала — в шкале. Там стояли голые миллисекунды, и главное в них терялось:
 * что самый большой обрыв случается **на втором типе**, а переход в мегаморфизм добавляет
 * сравнительно немного. Поэтому рядом с миллисекундами стоит кратность к мономорфному
 * состоянию, а полоса выбранного состояния выделена — остальные приглушены.
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import { SegmentedControl } from '@/shared/ui';
import type { IcState } from '../model/types';

const props = defineProps<{ states: IcState[]; scaleLabel?: string }>();

const picked = ref('0');
const current = computed(() => props.states[Number(picked.value)]);
const options = computed(() => props.states.map((s, i) => ({ value: String(i), label: s.label })));

const base = computed(() => props.states[0].ms);
const max = computed(() => Math.max(...props.states.map((s) => s.ms)));

const bars = computed(() =>
  props.states.map((state, i) => ({
    label: state.label,
    width: Math.round((state.ms / max.value) * 100),
    value: `${state.ms} мс · ×${(state.ms / base.value).toFixed(1)}`,
    active: i === Number(picked.value),
    tone: state.tone,
  })),
);
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="bar">
        <span class="bar__label">сколько форм видела площадка o.v:</span>
        <SegmentedControl v-model="picked" class="l-pills" label="Число форм" :options="options" />
      </div>
    </template>

    <div class="split">
      <div class="pane">
        <div class="field">
          <div class="t-label">состояние площадки</div>
          <div class="state" :data-tone="current.tone">{{ current.state }}</div>
        </div>

        <div class="field">
          <div class="t-label">что происходит при обращении</div>
          <div class="text">{{ current.what }}</div>
        </div>

        <div class="field">
          <div class="t-label">что может компилятор</div>
          <div class="text text--verdict" :data-tone="current.tone">{{ current.opt }}</div>
        </div>
      </div>

      <div class="pane pane--right">
        <div class="t-label">{{ scaleLabel ?? '2·10⁷ чтений поля' }}</div>

        <div class="chart">
          <div v-for="row in bars" :key="row.label" class="row">
            <span class="row__label">{{ row.label }}</span>
            <div class="track">
              <div class="fill" :class="{ active: row.active }" :data-tone="row.tone" :style="`width:${row.width}%`"></div>
            </div>
            <span class="row__value" :class="{ active: row.active }">{{ row.value }}</span>
          </div>
        </div>

        <div class="note">{{ current.note }}</div>
      </div>
    </div>
  </DemoFrame>
</template>

<style scoped>
.bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.bar__label {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}

.split {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr));
}
.pane {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  border-right: 1px solid var(--divider);
}
.pane--right {
  border-right: 0;
  background: var(--surface-2);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.state {
  padding: 12px 14px;
  border-radius: var(--r2);
  font-family: var(--mono);
  font-size: var(--fs-6);
  transition: all 0.2s;
}
.state[data-tone='ok'] {
  border: 1px solid var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-strong);
}
.state[data-tone='err'] {
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-strong);
}

.text {
  font-size: var(--fs-6);
  line-height: 1.6;
  color: var(--prose);
}
.text--verdict[data-tone='ok'] {
  color: var(--tone-ok-text);
}
.text--verdict[data-tone='err'] {
  color: var(--tone-err-text);
}

.chart {
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.row {
  display: grid;
  grid-template-columns: minmax(84px, 96px) minmax(0, 1fr) auto;
  gap: 11px;
  align-items: center;
}
.row__label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  text-align: end;
  color: var(--text-faint);
}
.track {
  min-width: 0;
}
.fill {
  height: 16px;
  border-radius: var(--r1);
  background: var(--bar-neutral);
  transition: all 0.2s;
}
/* Выбранное состояние — цветом, остальные приглушены: сравнение важнее каждой полосы. */
.fill.active[data-tone='ok'] {
  background: var(--bar-green);
}
.fill.active[data-tone='err'] {
  background: var(--bar-red);
}
.row__value {
  font-family: var(--mono);
  font-size: var(--fs-2);
  white-space: nowrap;
  color: var(--text-faint);
}
.row__value.active {
  color: var(--ink);
}

.note {
  padding: 13px 15px;
  border: 1px solid var(--tone-info-line);
  border-radius: var(--r2);
  background: var(--tone-info-bg);
  font-size: var(--fs-6);
  line-height: 1.6;
  color: var(--tone-info-text);
}
</style>
