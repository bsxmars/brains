<script setup lang="ts">
/**
 * Развилка инцидента: пять полей `memoryUsage()` во времени и диагноз по форме их роста.
 *
 * Главное в демо — что растущие строки видно глазом, а не вычитывается из чисел: в оригинале
 * все пять строк были одного цвета, и «какой контур растёт быстрее остальных» читателю
 * приходилось считать в уме. Здесь растущий контур и покрашен, и нарисован столбиками.
 *
 * Вывод «годится ли снимок» вынесен в отдельное поле данных, а не спрятан в начало строки
 * галочкой: в оригинале тон блока вычислялся по первому символу текста (`text.indexOf('✓')`),
 * и правка формулировки молча меняла цвет.
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import { SegmentedControl } from '@/shared/ui';
import type { TriageCase } from '../model/types';

const props = defineProps<{
  cases: TriageCase[];
  /** Подписи замеров под столбиками: «0 ч · 2 ч · 4 ч». */
  stamps: string[];
}>();

const picked = ref('0');
const current = computed(() => props.cases[Number(picked.value)]);
const options = computed(() => props.cases.map((c, i) => ({ value: String(i), label: c.label })));

/** Высота столбика: самый маленький замер обязан остаться видимым столбиком, а не исчезнуть. */
const height = (v: number) => `${6 + (v / 100) * 20}px`;
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="bar">
        <span class="bar__label">что показывает мониторинг:</span>
        <SegmentedControl v-model="picked" class="l-pills" label="Случай" :options="options" />
      </div>
    </template>

    <div class="body">
      <div class="left">
        <div class="t-label">process.memoryUsage() во времени</div>

        <div class="rows">
          <div v-for="row in current.rows" :key="row.k" class="row">
            <span class="row__key" :data-hot="row.hot ? 'yes' : 'no'">{{ row.k }}</span>
            <div class="bars">
              <span
                v-for="(b, i) in row.bars"
                :key="i"
                class="bar-col"
                :data-hot="row.hot ? 'yes' : 'no'"
                :style="{ height: height(b) }"
              />
            </div>
            <span class="row__value" :data-hot="row.hot ? 'yes' : 'no'">{{ row.v }}</span>
          </div>

          <div class="row row--axis">
            <span class="row__key" aria-hidden="true"></span>
            <div class="stamps">
              <span v-for="stamp in stamps" :key="stamp" class="stamp">{{ stamp }}</span>
            </div>
            <span class="row__value" aria-hidden="true"></span>
          </div>
        </div>
      </div>

      <div class="right">
        <div class="field">
          <div class="t-label">диагноз</div>
          <div class="dx" :data-tone="current.tone">{{ current.dx }}</div>
        </div>

        <div class="why">{{ current.why }}</div>

        <div class="field">
          <div class="t-label">инструмент</div>
          <div class="tool" :data-works="current.tool.works ? 'yes' : 'no'">{{ current.tool.text }}</div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="note">{{ current.note }}</div>
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
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr));
  min-width: 0;
}
.left {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
  border-right: 1px solid var(--divider);
  min-width: 0;
}
.right {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  background: var(--surface-2);
  min-width: 0;
}

.rows {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.row {
  display: grid;
  grid-template-columns: minmax(88px, 104px) minmax(0, 1fr) auto;
  gap: 11px;
  align-items: center;
}
.row__key {
  font-family: var(--mono);
  font-size: var(--fs-2);
  text-align: right;
  color: var(--text-muted);
}
.row__key[data-hot='yes'] {
  font-weight: 600;
  color: var(--tone-err-strong);
}
.row__value {
  font-family: var(--mono);
  font-size: var(--fs-2);
  white-space: nowrap;
  color: var(--text-muted);
}
.row__value[data-hot='yes'] {
  color: var(--tone-err-strong);
}

/* `min-width: 0` — иначе колонка со столбиками не сожмётся ниже своего содержимого. */
.bars {
  display: flex;
  align-items: flex-end;
  gap: 3px;
  min-width: 0;
  height: 26px;
}
.bar-col {
  flex: 1;
  border-radius: var(--r1);
  background: var(--bar-neutral);
  transition: all 0.2s;
}
.bar-col[data-hot='yes'] {
  background: var(--bar-red);
}

.row--axis {
  align-items: start;
}
.stamps {
  display: flex;
  justify-content: space-between;
  min-width: 0;
}
.stamp {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--dim);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.dx {
  padding: 12px 14px;
  border-radius: var(--r2);
  font-family: var(--mono);
  font-size: var(--fs-4);
  line-height: 1.5;
  transition: all 0.2s;
}
.dx[data-tone='warn'] {
  border: 1px solid var(--tone-warn-line);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-strong);
}
.dx[data-tone='err'] {
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-strong);
}

.why {
  font-size: var(--fs-6);
  line-height: 1.6;
  color: var(--prose);
}

.tool {
  padding: 12px 14px;
  border-radius: var(--r2);
  font-size: var(--fs-6);
  line-height: 1.6;
  transition: all 0.2s;
}
.tool[data-works='yes'] {
  border: 1px solid var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.tool[data-works='no'] {
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}

.note {
  font-size: var(--fs-6);
  line-height: 1.6;
  color: var(--tone-warn-text);
}
</style>
