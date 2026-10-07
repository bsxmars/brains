<script setup lang="ts">
/**
 * Тысяча клиентов переподключается к упавшему серверу — на виртуальных часах.
 *
 * Задержку считает `nextDelay` из строки `CLIENT_CODE` (пропом, собирается `loadBackoff`);
 * стратегии отличаются параметрами, а не кодом. Симуляция детерминирована — зерно
 * фиксировано, поэтому разметка с сервера и после гидратации совпадает, а тест
 * (`tests/unit/realtime.test.ts`) проверяет те же числа, что видит читатель.
 *
 * Считается быстро (1000 клиентов, минута виртуального времени), поэтому — в `computed`,
 * без кнопки «посчитать».
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { loadBackoff, simulateHerd, type Strategy } from '../model/herd';

const props = defineProps<{ code: string }>();
const nextDelay = loadBackoff(props.code);

const CLIENTS = 1000;
const CAPACITY = 100;
const BUCKET = 500;
const HORIZON = 60_000;

const strategy = ref<Strategy>('jitter');
const outage = ref('5000');
const cap = ref('30000');

const STRATEGIES = [
  { value: 'fixed', label: 'раз в секунду' },
  { value: 'exp', label: 'экспонента' },
  { value: 'jitter', label: 'экспонента + джиттер' },
];
const OUTAGES = [
  { value: '5000', label: '5 с' },
  { value: '20000', label: '20 с' },
];
const CAPS = [
  { value: '8000', label: '8 с' },
  { value: '30000', label: '30 с' },
];

const result = computed(() =>
  simulateHerd(nextDelay, {
    clients: CLIENTS,
    outage: Number(outage.value),
    capacity: CAPACITY,
    bucket: BUCKET,
    horizon: HORIZON,
    strategy: strategy.value,
    cap: Number(cap.value),
    seed: 7,
  }),
);

const bars = computed(() =>
  result.value.attempts.map((n, i) => ({
    ok: (result.value.accepted[i] / CLIENTS) * 100,
    fail: ((n - result.value.accepted[i]) / CLIENTS) * 100,
    title: `${(i * BUCKET) / 1000}–${((i + 1) * BUCKET) / 1000} с: попыток ${n}, принято ${result.value.accepted[i]}`,
  })),
);
const upAt = computed(() => (Number(outage.value) / HORIZON) * 100);
const TICKS = [0, 10, 20, 30, 40, 50, 60];

const doneText = computed(() => {
  const r = result.value;
  return r.doneAt === null
    ? `за минуту — **${r.connected}** из ${CLIENTS}`
    : `все ${CLIENTS} — через **${(r.doneAt / 1000).toFixed(1).replace('.', ',')} с**`;
});

const NOTES: Record<Strategy, string> = {
  fixed:
    'Каждый клиент стучится ровно раз в секунду, и все — в одну и ту же секунду: пока сервер лежит, он получает стену из тысячи попыток, поднявшись — снова тысячу. Подключаются быстро, но ценой тысяч лишних рукопожатий: каждое отвергнутое сервер начал и бросил.',
  exp: 'Удвоение без случайной части сохраняет строй: волны реже, но каждая — все клиенты разом. Поднявшийся сервер принимает сотню из тысячи, остальные девятьсот уходят ждать ещё дольше — и возвращаются тоже вместе.',
  jitter:
    'Та же экспонента, но каждая задержка — случайное число от нуля до потолка. Волна размазывается по времени: после подъёма сервер почти не получает лишнего, а подключаются все.',
};
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="rt-controls">
        <div class="rt-control">
          <span class="t-label">стратегия</span>
          <SegmentedControl v-model="strategy" class="l-pills" label="Стратегия переподключения" :options="STRATEGIES" />
        </div>
        <div class="rt-control">
          <span class="t-label">сервер лежит</span>
          <SegmentedControl v-model="outage" class="l-pills" label="Сколько лежит сервер" :options="OUTAGES" />
        </div>
        <div class="rt-control">
          <span class="t-label">потолок задержки</span>
          <SegmentedControl v-model="cap" class="l-pills" label="Потолок задержки" :options="CAPS" />
        </div>
      </div>
    </template>

    <div class="rt-body">
      <div class="rt-chart" role="img" :aria-label="`Попытки подключения по полусекундам: пик после подъёма ${result.peakAfterUp}`">
        <div class="rt-plot">
          <div class="rt-up" :style="{ left: `${upAt}%` }"><span class="rt-up__label">сервер поднялся</span></div>
          <div v-for="(bar, i) in bars" :key="i" class="rt-col" :title="bar.title">
            <div class="rt-col__fail" :style="{ height: `${bar.fail}%` }" />
            <div class="rt-col__ok" :style="{ height: `${bar.ok}%` }" />
          </div>
        </div>
        <div class="rt-axis">
          <span v-for="t in TICKS" :key="t" class="rt-axis__tick" :style="{ left: `${(t / 60) * 100}%` }">{{ t }} с</span>
        </div>
        <div class="rt-legend">
          <span class="rt-legend__item" data-kind="fail">попытка отвергнута</span>
          <span class="rt-legend__item" data-kind="ok">подключился</span>
          <span class="rt-legend__scale">высота столбика — доля от {{ CLIENTS }} клиентов за полсекунды</span>
        </div>
      </div>

      <div class="rt-stats">
        <div class="rt-stat">
          <span class="t-label">пик после подъёма</span>
          <span class="rt-stat__value">{{ result.peakAfterUp }}</span>
          <span class="rt-stat__hint">попыток за полсекунды при ёмкости {{ CAPACITY }}</span>
        </div>
        <div class="rt-stat">
          <span class="t-label">отказов после подъёма</span>
          <span class="rt-stat__value">{{ result.rejectedAfterUp.toLocaleString('ru-RU') }}</span>
          <span class="rt-stat__hint">рукопожатий, которые сервер начал и бросил</span>
        </div>
        <div class="rt-stat">
          <span class="t-label">всего попыток</span>
          <span class="rt-stat__value">{{ result.total.toLocaleString('ru-RU') }}</span>
          <span class="rt-stat__hint">за минуту виртуального времени</span>
        </div>
        <div class="rt-stat">
          <span class="t-label">подключились</span>
          <Md class="rt-stat__text" :text="doneText" />
        </div>
      </div>

      <Md class="rt-note" :text="NOTES[strategy]" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.rt-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 20px;
}
.rt-control {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.rt-body {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 22px 20px;
}

.rt-chart {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.rt-plot {
  position: relative;
  display: flex;
  align-items: flex-end;
  gap: 1px;
  height: 180px;
  border-bottom: 1px solid var(--border-strong);
}
.rt-col {
  flex: 1 1 0;
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}
.rt-col__fail {
  background: var(--bar-red);
}
.rt-col__ok {
  background: var(--bar-green);
}
.rt-up {
  position: absolute;
  top: 0;
  bottom: 0;
  border-left: 1px dashed var(--tone-info-strong);
  pointer-events: none;
}
.rt-up__label {
  position: absolute;
  top: 2px;
  left: 5px;
  white-space: nowrap;
  font-size: var(--fs-3);
  color: var(--tone-info-text);
}

.rt-axis {
  position: relative;
  height: 16px;
}
.rt-axis__tick {
  position: absolute;
  transform: translateX(-50%);
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--dim);
  white-space: nowrap;
}
.rt-axis__tick:first-child {
  transform: none;
}
.rt-axis__tick:last-child {
  transform: translateX(-100%);
}

.rt-legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 14px;
  font-size: var(--fs-3);
  color: var(--text-muted);
}
.rt-legend__item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.rt-legend__item::before {
  content: '';
  width: 10px;
  height: 10px;
  border-radius: 2px;
}
.rt-legend__item[data-kind='fail']::before {
  background: var(--bar-red);
}
.rt-legend__item[data-kind='ok']::before {
  background: var(--bar-green);
}

.rt-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px;
}
.rt-stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  border-radius: var(--r2);
  background: var(--surface-2);
  min-width: 0;
}
.rt-stat__value {
  font-family: var(--mono);
  font-size: var(--fs-7);
  color: var(--ink);
}
.rt-stat__text {
  font-size: var(--fs-5);
  line-height: 1.5;
  color: var(--ink);
}
.rt-stat__hint {
  font-size: var(--fs-3);
  line-height: 1.45;
  color: var(--text-muted);
}

.rt-note {
  font-size: var(--fs-5);
  line-height: 1.6;
  color: var(--prose);
}
</style>
