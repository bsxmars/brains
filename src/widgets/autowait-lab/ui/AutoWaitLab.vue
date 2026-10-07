<script setup lang="ts">
/**
 * «Попытка за попыткой»: кнопка, которая готова не сразу, и то, как Playwright её дожидается.
 *
 * Журнал и момент клика считает не компонент, а строка `AUTOWAIT_CODE` из темы, собранная
 * `new Function` (`model/run.ts`). Та же строка напечатана на странице и прогоняется
 * `tests/unit/e2e-testing.test.ts` против журналов настоящего Playwright 1.63. Журнал стенда
 * показывается рядом только при значениях, на которых он снят.
 */
import { computed, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { loadAutoWait, timelineOf } from '../model/run';
import type { AwFixture, LogLine } from '../model/types';

const props = defineProps<{
  code: string;
  fixtures: AwFixture[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const autoWait = loadAutoWait(props.code);

/** Таймаут стенда: журналы `stand` сняты с ним. */
const STAND_TIMEOUT = 3000;
/** Значение ползунка за краем шкалы — «не станет готовой никогда». */
const NEVER = 2050;

const picked = ref(props.fixtures[0].id);
const options = props.fixtures.map((f) => ({ value: f.id, label: f.label }));
const fx = computed(() => props.fixtures.find((f) => f.id === picked.value) ?? props.fixtures[0]);

const changeAt = ref(fx.value.changeAt);
watch(fx, (f) => {
  changeAt.value = f.changeAt;
});

const timeoutKey = ref(String(STAND_TIMEOUT));
const timeoutOptions = ['1500', '3000', '5000'].map((v) => ({ value: v, label: `timeout ${v}` }));
const timeout = computed(() => Number(timeoutKey.value));

const never = computed(() => changeAt.value >= NEVER);
const result = computed(() => autoWait(timelineOf(fx.value, never.value ? null : changeAt.value), timeout.value));

const atStand = computed(() => !never.value && changeAt.value === fx.value.changeAt && timeout.value === STAND_TIMEOUT);

const pct = (ms: number) => `${Math.min(100, (ms / timeout.value) * 100)}%`;

/** Отметки на шкале: каждая проверка, которой кончилась попытка, и клик. */
const marks = computed(() =>
  result.value.log
    .filter(([, m]) => /element is not|intercepts|performing|locator resolved|detached/.test(m))
    .map(([tm, m]) => ({
      t: tm,
      kind: /performing/.test(m) ? 'ok' : /locator resolved/.test(m) ? 'info' : 'err',
    })),
);

const fmt = (log: LogLine[]) => log.map(([tm, m]) => `${String(tm).padStart(5, ' ')}  ${m}`).join('\n');

const changeLabel = computed(() => (never.value ? 'никогда' : `через ${changeAt.value} мс`));

const verdict = computed(() => {
  const r = result.value;
  if (r.clickAt === null) {
    return `Клика нет: \`${r.error}\` Кнопка ${never.value ? 'так и не стала готовой' : `стала готовой на ${changeAt.value} мс, но следующая проверка не успела до таймаута`}.`;
  }
  const late = never.value ? 0 : Math.max(0, r.clickAt - changeAt.value);
  return `Клик на **${r.clickAt} мс**. Кнопка готова ${changeLabel.value}, клик — на ${late} мс позже: столько оставалось до следующей проверки.`;
});

const standNote = computed(() =>
  atStand.value
    ? `Стенд, три прогона: клик на ${fx.value.standClicks.join(', ')} мс.`
    : `Журнал стенда снят при «готова через ${fx.value.changeAt} мс» и \`timeout ${STAND_TIMEOUT}\` — верните эти значения, чтобы сравнить.`,
);
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="aw-controls">
        <SegmentedControl v-model="picked" class="l-pills" label="Чем кнопка не готова" :options="options" />
        <SegmentedControl v-model="timeoutKey" class="l-pills" label="Таймаут клика" :options="timeoutOptions" />
      </div>
    </template>

    <div class="aw-body">
      <Md class="aw-note" :text="fx.note" />

      <label class="aw-range">
        <span class="aw-label">кнопка станет готовой: {{ changeLabel }}</span>
        <input
          v-model.number="changeAt"
          type="range"
          min="0"
          :max="NEVER"
          step="50"
          :aria-valuetext="changeLabel"
        />
      </label>

      <div class="aw-track" role="img" :aria-label="`Шкала от 0 до ${timeout} мс: проверки и ${result.clickAt === null ? 'таймаут' : 'клик'}`">
        <div class="aw-band aw-band--wait" :style="{ width: never ? '100%' : pct(changeAt) }" />
        <span
          v-for="(m, i) in marks"
          :key="i"
          class="aw-mark"
          :data-kind="m.kind"
          :style="{ left: pct(m.t) }"
        />
      </div>
      <div class="aw-axis">
        <span>0</span>
        <span>{{ timeout }} мс</span>
      </div>

      <Md class="aw-verdict" :text="verdict" />

      <div class="aw-split">
        <div class="aw-pane">
          <span class="aw-label">модель: autoWait</span>
          <pre class="aw-log">{{ fmt(result.log) }}</pre>
        </div>
        <div class="aw-pane">
          <span class="aw-label">Playwright 1.63, стенд</span>
          <pre v-if="atStand" class="aw-log">{{ fmt(fx.stand) }}</pre>
          <Md class="aw-stand-note" :text="standNote" />
        </div>
      </div>

      <Md class="aw-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.aw-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
}
.aw-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
  min-width: 0;
}
.aw-note,
.aw-caption,
.aw-verdict,
.aw-stand-note {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.aw-note :deep(code),
.aw-caption :deep(code),
.aw-verdict :deep(code),
.aw-stand-note :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
.aw-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.aw-range {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.aw-range input {
  width: 100%;
  font: inherit;
  color: inherit;
  accent-color: var(--ink);
}

.aw-track {
  position: relative;
  height: 34px;
  border-radius: var(--r2);
  background: var(--tone-ok-bg);
  box-shadow: inset 0 0 0 1px var(--tone-ok-line);
  overflow: hidden;
}
.aw-band--wait {
  position: absolute;
  inset: 0 auto 0 0;
  background: var(--tone-warn-bg);
  box-shadow: inset -2px 0 0 var(--tone-warn-line);
}
.aw-mark {
  position: absolute;
  top: 6px;
  bottom: 6px;
  width: 3px;
  margin-left: -1px;
  border-radius: 2px;
  background: var(--tone-err-text);
}
.aw-mark[data-kind='info'] {
  background: var(--tone-info-text);
}
.aw-mark[data-kind='ok'] {
  top: 2px;
  bottom: 2px;
  width: 5px;
  margin-left: -2px;
  background: var(--tone-ok-text);
}
.aw-axis {
  display: flex;
  justify-content: space-between;
  margin-top: -8px;
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}

.aw-split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 860px) {
  .aw-split {
    grid-template-columns: minmax(0, 1fr);
  }
}
.aw-pane {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.aw-log {
  margin: 0;
  max-height: 340px;
  overflow: auto;
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.6;
  /* Подложка — общая для кода курса (`pre`, чернильная): цвет «на чернилах». */
  color: var(--code-fg);
  white-space: pre;
}
</style>
