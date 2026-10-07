<script setup lang="ts">
/**
 * «Время на часах → момент»: лента времени вокруг перехода, кандидаты-смещения для выбранной
 * клетки и ответ при каждом из четырёх значений `disambiguation`.
 *
 * Считает не компонент, а строка `LOCAL_TO_UTC_CODE` из темы, собранная `new Function`
 * (`model/run.ts`): `candidates` раскрашивает ленту и даёт список проверок, `localToUtc` —
 * ответы. Та же строка напечатана на странице и прогоняется `tests/unit/time-dates.test.ts`
 * против `temporal-polyfill` и `Date` в процессах с `TZ`. Компонент только подписывает числа.
 */
import { computed, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { formatOffset, formatUtc, formatWall, formatZoned, loadTz } from '../model/run';
import type { Disambiguation, TzScenario } from '../model/types';

const props = defineProps<{
  code: string;
  scenarios: TzScenario[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const api = loadTz(props.code);
const MINUTE = 60_000;

const picked = ref(props.scenarios[0].id);
const options = props.scenarios.map((s) => ({ value: s.id, label: s.label }));
const scenario = computed(() => props.scenarios.find((s) => s.id === picked.value) ?? props.scenarios[0]);
const table = computed(() => scenario.value.table.transitions);

/** Границы разрыва или повтора на часах: время перехода по старому и по новому смещению. */
const edges = computed(() => {
  const tr = table.value[scenario.value.focus];
  const a = tr.at + tr.before * MINUTE;
  const b = tr.at + tr.after * MINUTE;
  return { lo: Math.min(a, b), hi: Math.max(a, b) };
});

const middle = () => {
  const { lo, hi } = edges.value;
  const step = scenario.value.step * MINUTE;
  return lo + Math.floor((hi - lo) / 2 / step) * step;
};

const selected = ref(middle());
watch(scenario, () => {
  selected.value = middle();
});

interface Cell {
  local: number;
  label: string;
  /** Сколько смещений подошло: 0 — разрыв, 2 — повтор. */
  fits: number;
}

const cells = computed<Cell[]>(() => {
  const { lo, hi } = edges.value;
  const step = scenario.value.step * MINUTE;
  const around = scenario.value.around * MINUTE;
  const out: Cell[] = [];
  for (let local = lo - around; local <= hi + around; local += step) {
    out.push({
      local,
      label: formatWall(local).slice(11),
      fits: api.candidates(table.value, local).filter((c) => c.fits).length,
    });
  }
  return out;
});

const kind = (fits: number) => (fits === 0 ? 'gap' : fits > 1 ? 'twice' : 'one');

const KIND_TEXT = {
  one: 'подошло одно смещение',
  twice: 'подошли два: время повторилось',
  gap: 'не подошло ни одно: такого времени не было',
} as const;

const zone = computed(() => scenario.value.table.zone);

const heading = computed(
  () => `\`${zone.value}\`, база ${scenario.value.table.tzdata}. На часах \`${formatWall(selected.value)}\` — ${KIND_TEXT[kind(api.candidates(table.value, selected.value).filter((c) => c.fits).length)]}.`,
);

/** Проверка каждого кандидата словами: какое смещение пробуем, что вышло и что было на деле. */
const checks = computed(() =>
  api.candidates(table.value, selected.value).map((c) => {
    const real = api.offsetAt(table.value, c.utc);
    return {
      key: c.offset,
      fits: c.fits,
      text: `\`${formatWall(selected.value).slice(11)}\` − \`${formatOffset(c.offset)}\` = \`${formatUtc(c.utc)}\`. В этот момент в зоне действовало \`${formatOffset(real)}\` — ${c.fits ? 'подходит' : 'не подходит'}.`,
    };
  }),
);

const MODES: { mode: Disambiguation; note: string }[] = [
  { mode: 'compatible', note: 'по умолчанию; так же поступает `Date`' },
  { mode: 'earlier', note: 'более ранний момент' },
  { mode: 'later', note: 'более поздний момент' },
  { mode: 'reject', note: 'отказ, если ответ не один' },
];

const answers = computed(() =>
  MODES.map(({ mode, note }) => {
    try {
      const utc = api.localToUtc(table.value, selected.value, mode);
      const shown = formatZoned(utc, api.offsetAt(table.value, utc));
      return { mode, note, ok: true, text: `\`${formatUtc(utc)}\` → на часах \`${shown}\`` };
    } catch (e) {
      return { mode, note, ok: false, text: `\`${(e as Error).name}\`: ${(e as Error).message}` };
    }
  }),
);

function pick(local: number) {
  selected.value = local;
}
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="picked" class="l-pills" label="Зона и переход" :options="options" />
    </template>

    <div class="tz-body">
      <Md class="tz-note" :text="scenario.note" />

      <div class="tz-strip" role="group" aria-label="Время на часах">
        <button
          v-for="c in cells"
          :key="c.local"
          type="button"
          class="tz-cell"
          :data-kind="kind(c.fits)"
          :aria-pressed="c.local === selected"
          :aria-label="`${c.label}: ${KIND_TEXT[kind(c.fits)]}`"
          @click="pick(c.local)"
        >
          {{ c.label }}
        </button>
      </div>

      <ul class="tz-legend">
        <li data-kind="one">{{ KIND_TEXT.one }}</li>
        <li data-kind="twice">{{ KIND_TEXT.twice }}</li>
        <li data-kind="gap">{{ KIND_TEXT.gap }}</li>
      </ul>

      <Md class="tz-heading" :text="heading" />

      <div class="tz-split">
        <div class="tz-pane">
          <span class="tz-label">candidates: каждое смещение зоны</span>
          <div v-for="c in checks" :key="c.key" class="tz-check" :data-fits="c.fits ? 'yes' : 'no'">
            <Md :text="c.text" />
          </div>
        </div>

        <div class="tz-pane">
          <span class="tz-label">localToUtc: четыре disambiguation</span>
          <div v-for="a in answers" :key="a.mode" class="tz-answer" :data-ok="a.ok ? 'yes' : 'no'">
            <code class="tz-mode">'{{ a.mode }}'</code>
            <Md class="tz-answer__text" :text="a.text" />
            <Md class="tz-answer__note" :text="a.note" />
          </div>
        </div>
      </div>

      <Md class="tz-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.tz-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.tz-note,
.tz-caption,
.tz-heading {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.tz-heading {
  font-size: var(--fs-4);
}
.tz-body :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}

.tz-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.tz-cell {
  min-width: 4.4em;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: var(--r1);
  background: var(--surface-2);
  font: inherit;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--prose);
  cursor: pointer;
}
.tz-cell[data-kind='twice'] {
  border-color: var(--tone-warn-line);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.tz-cell[data-kind='gap'] {
  border-color: var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}
.tz-cell[aria-pressed='true'] {
  border-color: var(--ink);
  box-shadow: inset 0 0 0 1px var(--ink);
  font-weight: 600;
}
.tz-cell:focus-visible {
  outline: 2px solid var(--tone-info-strong);
  outline-offset: 2px;
}

.tz-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 18px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.tz-legend li {
  display: flex;
  align-items: center;
  gap: 6px;
}
.tz-legend li::before {
  content: '';
  width: 12px;
  height: 12px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--surface-2);
}
.tz-legend li[data-kind='twice']::before {
  border-color: var(--tone-warn-line);
  background: var(--tone-warn-bg);
}
.tz-legend li[data-kind='gap']::before {
  border-color: var(--tone-err-line);
  background: var(--tone-err-bg);
}

.tz-split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 760px) {
  .tz-split {
    grid-template-columns: minmax(0, 1fr);
  }
}
.tz-pane {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.tz-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.tz-check,
.tz-answer {
  padding: 8px 10px;
  border-radius: var(--r2);
  background: var(--surface);
  font-size: var(--fs-3);
  line-height: 1.55;
  color: var(--prose);
  overflow-wrap: anywhere;
}
.tz-check[data-fits='yes'],
.tz-answer[data-ok='yes'] {
  box-shadow: inset 3px 0 0 var(--tone-ok-strong);
}
.tz-check[data-fits='no'] {
  box-shadow: inset 3px 0 0 var(--border-strong);
  color: var(--text-muted);
}
.tz-answer[data-ok='no'] {
  box-shadow: inset 3px 0 0 var(--tone-err-strong);
}
.tz-answer {
  display: grid;
  grid-template-columns: minmax(0, auto) minmax(0, 1fr);
  gap: 2px 10px;
  align-items: baseline;
}
.tz-mode {
  font-family: var(--mono);
  font-size: var(--fs-3);
  font-weight: 600;
  color: var(--ink);
}
.tz-answer__note {
  grid-column: 1 / -1;
  font-size: var(--fs-2);
  color: var(--text-muted);
}
</style>
