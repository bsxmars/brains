<script setup lang="ts">
/**
 * Калькулятор «сколько стоит интервал выборки»: частота сэмплов против точности.
 *
 * Считает `model/interval.ts` — тот же модуль импортирует юнит-тест, который сверяет закон
 * `1/√n` с разбросом настоящих профилей V8. Здесь только ввод и показ.
 *
 * ⚠️ Миллисекунд здесь нет: цена одного сэмпла зависит от машины и глубины стека. Цена
 * выражена отношением — «во сколько раз больше сэмплов, чем при умолчании Node», — а таблица
 * накладных расходов рядом в теме показывает, как с числом сэмплов растёт время на стенде.
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { fmtCount, fmtPct, intervalReport, INTERVALS, SAMPLES_FOR_20PCT } from '../model/interval';

const props = defineProps<{
  /** Подпись под калькулятором. Разрешена строчная разметка. */
  note: string;
}>();

const intervalPick = ref(String(32 * 1024));
const rate = ref(20);
const sharePct = ref(5);
const windowS = ref(60);
const objectB = ref(64);

const options = INTERVALS.map((i) => ({ value: String(i.value), label: i.label }));

const report = computed(() =>
  intervalReport({
    rateMBs: rate.value,
    intervalB: Number(intervalPick.value),
    share: sharePct.value / 100,
    windowS: windowS.value,
    objectB: objectB.value,
  }),
);

/** Точность хуже ±20% — предупреждение, хуже ±50% — оценка ничего не значит. */
const errTone = computed(() => (report.value.err95 > 0.5 ? 'err' : report.value.err95 > 0.2 ? 'warn' : 'ok'));
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="pi-bar">
        <span class="pi-bar__label">интервал выборки:</span>
        <SegmentedControl v-model="intervalPick" class="l-pills" label="Интервал выборки" :options="options" />
      </div>
    </template>

    <div class="pi-body">
      <div class="pi-inputs">
        <label class="pi-field">
          <span class="pi-field__label">скорость выделения, МБ/с</span>
          <span class="pi-field__row">
            <input v-model.number="rate" class="pi-range" type="range" min="1" max="500" step="1" />
            <span class="pi-value">{{ rate }}</span>
          </span>
        </label>
        <label class="pi-field">
          <span class="pi-field__label">доля искомой функции, %</span>
          <span class="pi-field__row">
            <input v-model.number="sharePct" class="pi-range" type="range" min="0.1" max="50" step="0.1" />
            <span class="pi-value">{{ sharePct }}</span>
          </span>
        </label>
        <label class="pi-field">
          <span class="pi-field__label">окно записи, с</span>
          <span class="pi-field__row">
            <input v-model.number="windowS" class="pi-range" type="range" min="1" max="600" step="1" />
            <span class="pi-value">{{ windowS }}</span>
          </span>
        </label>
        <label class="pi-field">
          <span class="pi-field__label">размер объекта, байт</span>
          <span class="pi-field__row">
            <input v-model.number="objectB" class="pi-range" type="range" min="16" max="65536" step="16" />
            <span class="pi-value">{{ objectB }}</span>
          </span>
        </label>
      </div>

      <dl class="pi-out">
        <div class="pi-cell">
          <dt>сэмплов в секунду</dt>
          <dd>{{ fmtCount(report.samplesPerSec) }}</dd>
        </div>
        <div class="pi-cell">
          <dt>сэмплов против 512 КБ</dt>
          <dd>×{{ fmtCount(report.vsReference) }}</dd>
        </div>
        <div class="pi-cell">
          <dt>сэмплов у функции за окно</dt>
          <dd>{{ fmtCount(report.fnSamples) }}</dd>
        </div>
        <div class="pi-cell" :data-tone="errTone">
          <dt>погрешность её байт, 95%</dt>
          <dd>±{{ fmtPct(Math.min(report.err95, 9.99)) }}</dd>
        </div>
        <div class="pi-cell">
          <dt>объект попадёт в выборку</dt>
          <dd>{{ fmtPct(report.pObject) }}</dd>
        </div>
        <div class="pi-cell">
          <dt>самая малая доля с точностью ±20%</dt>
          <dd>{{ fmtPct(report.minShare) }}</dd>
        </div>
      </dl>

      <Md
        class="pi-formula"
        :text="`Формулы: сэмплов в секунду = скорость / интервал; погрешность = 1.96 / √n; объект размера s попадает в выборку с вероятностью 1 − e^(−s/интервал); для ±20% нужно n ≥ ${SAMPLES_FOR_20PCT}.`"
      />
    </div>

    <template #footer>
      <Md class="pi-foot" :text="props.note" />
    </template>
  </DemoFrame>
</template>

<style scoped>
.pi-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}
.pi-bar__label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}

.pi-body {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 20px;
  min-width: 0;
}

.pi-inputs {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr));
  gap: 12px 20px;
}
.pi-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.pi-field__label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.pi-field__row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.pi-range {
  flex: 1 1 120px;
  min-width: 0;
  height: 4px;
  margin: 0;
  appearance: none;
  border-radius: var(--r-full);
  background: var(--surface-3);
  font: inherit;
  color: inherit;
}
.pi-range::-webkit-slider-thumb {
  appearance: none;
  width: 14px;
  height: 14px;
  border: 0;
  border-radius: var(--r-full);
  background: var(--bar-violet);
  cursor: pointer;
}
.pi-range::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border: 0;
  border-radius: var(--r-full);
  background: var(--bar-violet);
  cursor: pointer;
}
.pi-value {
  min-width: 6ch;
  font-family: var(--mono);
  font-size: var(--fs-3);
  text-align: end;
  color: var(--ink);
}

.pi-out {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(190px, 100%), 1fr));
  gap: 10px;
  margin: 0;
}
.pi-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 11px 13px;
  border: 1px solid var(--divider);
  border-radius: var(--r2);
  background: var(--surface-2);
}
.pi-cell dt {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.pi-cell dd {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--fs-6);
  color: var(--ink);
}
.pi-cell[data-tone='ok'] {
  border-color: var(--tone-ok-line);
  background: var(--tone-ok-bg);
}
.pi-cell[data-tone='ok'] dd {
  color: var(--tone-ok-strong);
}
.pi-cell[data-tone='warn'] {
  border-color: var(--tone-warn-line);
  background: var(--tone-warn-bg);
}
.pi-cell[data-tone='warn'] dd {
  color: var(--tone-warn-strong-2);
}
.pi-cell[data-tone='err'] {
  border-color: var(--tone-err-line);
  background: var(--tone-err-bg);
}
.pi-cell[data-tone='err'] dd {
  color: var(--tone-err-strong);
}

.pi-formula {
  font-size: var(--fs-4);
  line-height: 1.55;
  color: var(--text-muted);
}
.pi-foot {
  font-size: var(--fs-4);
  line-height: 1.55;
  color: var(--text-faint);
}
</style>
