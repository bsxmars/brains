<script setup lang="ts">
/**
 * Бюджет памяти контейнера: rss по долям против лимита пода и против потолка кучи.
 *
 * Ради одного наблюдения, которое в тексте тонет, а на полосе видно сразу: **потолок кучи
 * и лимит контейнера — независимые числа, и потолок бывает больше лимита.** Тогда V8 считает,
 * что всё в порядке, ровно до момента, когда процесс убивает ядро.
 *
 * Полоса рисуется от лимита контейнера, а не от rss: масштаб задаёт тот, кто убивает.
 * Если rss перерос лимит, полоса упирается в край и хвост показан отдельной меткой —
 * рисовать «110 % ширины» нельзя, это ровно та картинка, которой в проде не бывает.
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import { SegmentedControl } from '@/shared/ui';
import type { Budget } from '../model/types';

const props = defineProps<{
  budgets: Budget[];
  /** Оговорка про происхождение чисел. */
  note: string;
}>();

const picked = ref('0');
const current = computed(() => props.budgets[Number(picked.value)]);
const options = computed(() => props.budgets.map((b, i) => ({ value: String(i), label: b.label })));

const rss = computed(() => current.value.parts.reduce((sum, p) => sum + p.mb, 0));
const limit = computed(() => current.value.limitMb);

/** Доля от лимита в процентах — то самое «84 %, то есть за шаг до». */
const pct = (mb: number) => (mb / limit.value) * 100;
const clamp = (v: number) => Math.max(0, Math.min(100, v));

const parts = computed(() =>
  current.value.parts.map((part) => ({ ...part, width: clamp(pct(part.mb)) })),
);

const overflow = computed(() => Math.max(0, rss.value - limit.value));
const headroom = computed(() => Math.max(0, limit.value - rss.value));
/** Метка потолка кучи на той же шкале: видно, помещается ли он в лимит вообще. */
const heapMark = computed(() => clamp(pct(current.value.heapLimitMb)));
const heapOverLimit = computed(() => current.value.heapLimitMb > limit.value);
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="bar">
        <span class="bar__label">конфигурация пода:</span>
        <SegmentedControl v-model="picked" class="l-pills" label="Конфигурация" :options="options" />
      </div>
    </template>

    <div class="body">
      <div class="heads">
        <div class="head">
          <span class="t-label">лимит контейнера · его видит ядро</span>
          <span class="head__value">{{ limit }} МБ</span>
        </div>
        <div class="head">
          <span class="t-label">heap_size_limit · его видит V8</span>
          <span class="head__value" :data-over="heapOverLimit ? 'yes' : 'no'">
            {{ current.heapLimitMb }} МБ
          </span>
          <span class="head__from">{{ current.heapLimitFrom }}</span>
        </div>
        <div class="head">
          <span class="t-label">rss · сумма долей ниже</span>
          <span class="head__value" :data-tone="current.tone">
            {{ rss }} МБ · {{ Math.round(pct(rss)) }} % лимита
          </span>
        </div>
      </div>

      <div class="scroll">
        <div class="track-wrap">
          <div class="track" role="img" :aria-label="`rss ${rss} МБ при лимите ${limit} МБ`">
            <span
              v-for="part in parts"
              :key="part.label"
              class="seg"
              :data-kind="part.kind"
              :style="{ width: `${part.width}%` }"
            />
            <span v-if="headroom > 0" class="seg seg--free" :style="{ width: `${clamp(pct(headroom))}%` }" />
            <span
              class="heap-mark"
              :data-over="heapOverLimit ? 'yes' : 'no'"
              :style="{ left: `${heapMark}%` }"
              aria-hidden="true"
            />
          </div>

          <div class="axis">
            <span class="axis__end">0</span>
            <span class="axis__mark" :style="{ left: `${heapMark}%` }">
              потолок heap {{ current.heapLimitMb }}
            </span>
            <span class="axis__end axis__end--right">{{ limit }} МБ · лимит</span>
          </div>
        </div>
      </div>

      <dl class="legend">
        <div v-for="part in parts" :key="part.label" class="legend__item">
          <span class="legend__swatch" :data-kind="part.kind" aria-hidden="true" />
          <dt>{{ part.label }}</dt>
          <dd>{{ part.mb }} МБ</dd>
        </div>
        <div class="legend__item">
          <span class="legend__swatch" data-kind="free" aria-hidden="true" />
          <dt>{{ overflow > 0 ? 'за лимитом' : 'свободно до лимита' }}</dt>
          <dd>{{ overflow > 0 ? `+${overflow}` : headroom }} МБ</dd>
        </div>
      </dl>

      <div class="verdict" :data-tone="current.tone">{{ current.verdict }}</div>
      <div v-if="current.outcome" class="outcome" :data-tone="current.tone">{{ current.outcome }}</div>
    </div>

    <template #footer>
      <div class="memory-budget-foot">{{ note }}</div>
    </template>
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

.body {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 22px 20px;
  min-width: 0;
}

.heads {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(180px, 100%), 1fr));
  gap: 12px;
}
.head {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}
.head__value {
  font-family: var(--mono);
  font-size: var(--fs-6);
  color: var(--ink);
}
.head__value[data-over='yes'] {
  color: var(--tone-err-strong);
  font-weight: 600;
}
.head__value[data-tone='ok'] {
  color: var(--tone-ok-strong);
}
.head__value[data-tone='warn'] {
  color: var(--tone-warn-strong);
}
.head__value[data-tone='err'] {
  color: var(--tone-err-strong);
}
.head__from {
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.5;
  color: var(--text-faint);
}

/* `min-width: 0` рядом с прокруткой: иначе полоса растянет страницу на узком экране. */
.scroll {
  min-width: 0;
  overflow-x: auto;
}
.track-wrap {
  min-width: 260px;
}
.track {
  position: relative;
  display: flex;
  height: 30px;
  border-radius: var(--r1);
  overflow: hidden;
  background: var(--surface-3);
}
.seg {
  height: 100%;
  transition: width 0.25s;
}
.seg[data-kind='heap'] {
  background: var(--bar-violet);
}
.seg[data-kind='off-heap'] {
  background: var(--bar-amber);
}
.seg[data-kind='other'] {
  background: var(--bar-neutral);
}
.seg--free {
  background: var(--surface-3);
}

/* Метка потолка кучи: вертикальная черта поверх полосы. Красная, когда потолок больше лимита, —
   то есть V8 разрешено занять больше, чем весь под. */
.heap-mark {
  position: absolute;
  top: -3px;
  bottom: -3px;
  width: 2px;
  background: var(--ink);
}
.heap-mark[data-over='yes'] {
  background: var(--tone-err-strong);
}

.axis {
  position: relative;
  height: 18px;
  margin-top: 7px;
}
.axis__end,
.axis__mark {
  position: absolute;
  top: 0;
  font-family: var(--mono);
  font-size: var(--fs-3);
  white-space: nowrap;
  color: var(--dim);
}
.axis__end {
  left: 0;
}
.axis__end--right {
  left: auto;
  right: 0;
}
.axis__mark {
  transform: translateX(-50%);
  color: var(--text-muted);
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin: 0;
}
.legend__item {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.legend__swatch {
  width: 12px;
  height: 3px;
  border-radius: var(--r1);
  transform: translateY(-2px);
}
.legend__swatch[data-kind='heap'] {
  background: var(--bar-violet);
}
.legend__swatch[data-kind='off-heap'] {
  background: var(--bar-amber);
}
.legend__swatch[data-kind='other'] {
  background: var(--bar-neutral);
}
.legend__swatch[data-kind='free'] {
  background: var(--surface-3);
}
.legend__item dt {
  font-size: var(--fs-5);
  color: var(--text-muted);
}
.legend__item dd {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--ink);
}

.verdict {
  padding: 14px 16px;
  border-radius: var(--r2);
  font-size: var(--fs-6);
  line-height: 1.6;
  transition: all 0.2s;
}
.verdict[data-tone='ok'] {
  border: 1px solid var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.verdict[data-tone='warn'] {
  border: 1px solid var(--tone-warn-line);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.verdict[data-tone='err'] {
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}

.outcome {
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--text-muted);
}
.outcome[data-tone='err'] {
  color: var(--tone-err-strong);
}

.memory-budget-foot {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}
</style>
