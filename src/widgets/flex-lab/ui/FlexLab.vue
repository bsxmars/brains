<script setup lang="ts">
/**
 * «Проход за проходом»: флекс-строка, посчитанная дважды — функцией темы и настоящим браузером.
 *
 * Полосы «по функции» и журнал проходов считает строка `FLEX_CODE` из темы, собранная
 * `new Function` (`model/run.ts`). Та же строка напечатана на странице и сверяется
 * `tests/unit/layout-internals.test.ts` с замерами Chromium.
 *
 * Полосы «в браузере» — настоящий `display: flex` с теми же `flex`, `min-width` и `max-width`.
 * Ширины читаются `getBoundingClientRect` после каждой правки: это сверка в браузере читателя,
 * а не картинка. Ряд рисуется в натуральную ширину и сжимается `scaleX` под ширину демо;
 * раскладка от трансформа не зависит, поэтому делить замер на масштаб честно.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { loadFlex } from '../model/run';
import type { FlexItem, FlexScenario } from '../model/types';

const props = withDefaults(
  defineProps<{
    code: string;
    scenarios: FlexScenario[];
    /** Подпись под демо. Строчная разметка. */
    caption: string;
    minWidth?: number;
    maxWidth?: number;
  }>(),
  { minWidth: 100, maxWidth: 700 },
);

const resolveFlex = loadFlex(props.code);
/** Допуск сверки: Chromium хранит координаты в 1/64 px. */
const UNIT = 1 / 64;

const picked = ref(props.scenarios[0].id);
const options = props.scenarios.map((s) => ({ value: s.id, label: s.label }));
const scenario = computed(() => props.scenarios.find((s) => s.id === picked.value) ?? props.scenarios[0]);

const container = ref(scenario.value.container);
const items = ref<FlexItem[]>(scenario.value.items.map((it) => ({ ...it })));
watch(scenario, (s) => {
  container.value = s.container;
  items.value = s.items.map((it) => ({ ...it }));
});

/** Пустое или отрицательное поле ввода — это 0, а не NaN в расчёте. */
const clean = computed<FlexItem[]>(() =>
  items.value.map((it) => ({
    ...it,
    grow: Number.isFinite(+it.grow) ? Math.max(0, +it.grow) : 0,
    shrink: Number.isFinite(+it.shrink) ? Math.max(0, +it.shrink) : 0,
  })),
);

const result = computed(() => resolveFlex(container.value, clean.value));
const used = computed(() => result.value.sizes.reduce((s, v) => s + v, 0));

const fmt = (n: number) => String(Math.round(n * 100) / 100);

/* ── масштаб: вся строка (с переполнением) влезает в ширину демо ── */
const stage = ref<HTMLElement | null>(null);
const stageWidth = ref(600);
const base = computed(() => Math.max(props.maxWidth, used.value, container.value));
const k = computed(() => stageWidth.value / base.value);
let observer: ResizeObserver | null = null;

/* ── настоящий флекс-ряд и его замер ── */
const realRow = ref<HTMLElement | null>(null);
const measured = ref<number[] | null>(null);

function measure() {
  // Дети ряда — по порядку DOM: массив ref из v-for порядка не гарантирует.
  const els = Array.from(realRow.value?.children ?? []);
  if (!els.length || !k.value) return;
  measured.value = els.map((el) => el.getBoundingClientRect().width / k.value);
}

onMounted(() => {
  const el = stage.value;
  if (el && typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(([entry]) => {
      stageWidth.value = entry.contentRect.width;
    });
    observer.observe(el);
    stageWidth.value = el.clientWidth;
  }
  void nextTick(measure);
});
onBeforeUnmount(() => observer?.disconnect());
watch([container, clean, k], () => void nextTick(measure), { deep: true, flush: 'post' });

const realStyle = (it: FlexItem) => ({
  flex: `${it.grow} ${it.shrink} ${it.basis}px`,
  minWidth: `${it.min}px`,
  maxWidth: it.max == null ? 'none' : `${it.max}px`,
});

/** Полосы по функции: левый край и ширина в масштабе демо. */
const bars = computed(() => {
  let x = 0;
  return result.value.sizes.map((w, i) => {
    const bar = { name: items.value[i].name, left: x * k.value, width: w * k.value };
    x += w;
    return bar;
  });
});

/* ── подписи: строки собираются здесь и печатаются через Md ── */
const modeLine = computed(() => {
  const hypo = clean.value.reduce((s, it) => s + Math.max(it.min, Math.min(it.max ?? Infinity, it.basis)), 0);
  return result.value.mode === 'grow'
    ? `Базовые размеры, зажатые в min и max, вместе — ${fmt(hypo)} px, контейнер — ${container.value} px. Места больше — элементы **растут** по \`flex-grow\`.`
    : `Базовые размеры, зажатые в min и max, вместе — ${fmt(hypo)} px, контейнер — ${container.value} px. Места не хватает — элементы **сжимаются** по \`flex-shrink\` × базовый размер.`;
});

const roundLines = computed(() =>
  result.value.rounds.map((r, n) => {
    const names = (ids: number[]) => ids.map((i) => items.value[i].name).join(', ');
    const sizes = r.sizes.map((s, i) => `${items.value[i].name} ${fmt(s)}`).join(' · ');
    const hits = r.hit.length
      ? ' ' + r.hit.map((h) => `${items.value[h.i].name} упёрся в ${h.by === 'min' ? 'минимум' : 'максимум'}.`).join(' ')
      : '';
    const share = r.free >= 0 ? `Раздаём ${fmt(r.free)} px` : `Снимаем ${fmt(-r.free)} px`;
    return `**Проход ${n + 1}.** ${share} → ${sizes}.${hits} Заморожены: ${names(r.frozen)}.`;
  }),
);

const presetFrozen = computed(() => {
  const first = result.value.rounds[0];
  const inRounds = new Set(result.value.rounds.flatMap((r) => r.frozen));
  const before = items.value.map((_, i) => i).filter((i) => !inRounds.has(i));
  if (!before.length) return '';
  const names = before.map((i) => items.value[i].name).join(', ');
  return first
    ? `До раздачи заморожены: ${names} — нужный фактор 0 или минимум больше базового размера.`
    : `Заморожены все сразу: ${names}. Раздавать нечего — каждый стоит на своём минимуме или фактор у него 0.`;
});

const overflowLine = computed(() =>
  result.value.overflow > 0
    ? `Сумма минимумов больше контейнера: строка вылезает на **${fmt(result.value.overflow)} px**.`
    : '',
);

const rows = computed(() =>
  clean.value.map((it, i) => {
    const fn = result.value.sizes[i];
    const real = measured.value?.[i];
    const delta = real == null ? null : real - fn;
    return { it, i, fn, real, ok: delta == null ? null : Math.abs(delta) <= UNIT + 1e-6, delta };
  }),
);

const limit = (n: number | null) => (n == null ? '—' : fmt(n));
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="fl-toolbar">
        <SegmentedControl v-model="picked" class="l-pills" label="Сценарий" :options="options" />
        <div class="fl-range">
          <label class="fl-range__label" for="flex-lab-width">ширина контейнера</label>
          <input
            id="flex-lab-width"
            v-model.number="container"
            class="fl-range__input"
            type="range"
            :min="props.minWidth"
            :max="props.maxWidth"
            step="5"
          />
          <output class="fl-range__value" for="flex-lab-width">{{ container }} px</output>
        </div>
      </div>
    </template>

    <div class="fl-body">
      <Md class="fl-note" :text="scenario.note" />

      <div ref="stage" class="fl-stage">
        <span class="fl-label">по функции resolveFlex</span>
        <div class="fl-track" :style="{ width: `${base * k}px` }">
          <div class="fl-box" :style="{ width: `${container * k}px` }" />
          <div
            v-if="result.overflow > 0"
            class="fl-over"
            :style="{ left: `${container * k}px`, width: `${result.overflow * k}px` }"
          />
          <div
            v-for="(b, i) in bars"
            :key="b.name"
            class="fl-bar"
            :data-i="i"
            :style="{ left: `${b.left}px`, width: `${b.width}px` }"
          >
            <span class="fl-bar__name">{{ b.name }}</span>
          </div>
        </div>

        <span class="fl-label">в браузере: display: flex</span>
        <div class="fl-clip">
          <div ref="realRow" class="fl-real" :style="{ width: `${container}px`, transform: `scaleX(${k})` }">
            <div
              v-for="(it, i) in clean"
              :key="it.name"
              class="fl-real__item"
              :data-i="i"
              :style="realStyle(it)"
            />
          </div>
        </div>
      </div>

      <div class="fl-scroll">
        <table class="fl-table">
          <thead>
            <tr>
              <th>элемент</th>
              <th>basis</th>
              <th>grow</th>
              <th>shrink</th>
              <th>min</th>
              <th>max</th>
              <th>функция</th>
              <th>браузер</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.it.name">
              <td class="fl-num">{{ r.it.name }}</td>
              <td class="fl-num">{{ r.it.basis }}</td>
              <td>
                <input
                  v-model.number="items[r.i].grow"
                  class="fl-input"
                  type="number"
                  min="0"
                  max="5"
                  step="0.25"
                  :aria-label="`flex-grow элемента ${r.it.name}`"
                />
              </td>
              <td>
                <input
                  v-model.number="items[r.i].shrink"
                  class="fl-input"
                  type="number"
                  min="0"
                  max="5"
                  step="0.25"
                  :aria-label="`flex-shrink элемента ${r.it.name}`"
                />
              </td>
              <td class="fl-num">{{ fmt(r.it.min) }}</td>
              <td class="fl-num">{{ limit(r.it.max) }}</td>
              <td class="fl-num fl-num--strong">{{ fmt(r.fn) }}</td>
              <td class="fl-num" :data-ok="r.ok == null ? 'wait' : r.ok ? 'yes' : 'no'">
                {{ r.real == null ? '…' : fmt(r.real) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="fl-log">
        <Md class="fl-line" :text="modeLine" />
        <Md v-if="presetFrozen" class="fl-line" :text="presetFrozen" />
        <Md v-for="(line, n) in roundLines" :key="n" class="fl-line" :text="line" />
        <Md v-if="overflowLine" class="fl-line fl-line--warn" :text="overflowLine" />
      </div>
    </div>

    <template #footer>
      <Md class="fl-foot" :text="caption" />
    </template>
  </DemoFrame>
</template>

<style scoped>
.fl-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 18px;
}
.fl-range {
  display: flex;
  flex: 1 1 260px;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  min-width: 0;
}
.fl-range__label {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}
/* Ползунок целиком свой: у системного контрола свои цвета и шрифт. */
.fl-range__input {
  flex: 1 1 140px;
  min-width: 0;
  height: 4px;
  margin: 0;
  appearance: none;
  border-radius: var(--r-full);
  background: var(--surface-3);
  font: inherit;
  color: inherit;
}
.fl-range__input::-webkit-slider-thumb {
  appearance: none;
  width: 14px;
  height: 14px;
  border: 0;
  border-radius: var(--r-full);
  background: var(--accent);
  cursor: pointer;
}
.fl-range__input::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border: 0;
  border-radius: var(--r-full);
  background: var(--accent);
  cursor: pointer;
}
.fl-range__value {
  min-width: 6ch;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
}

.fl-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
  padding: 20px;
}
.fl-note,
.fl-foot,
.fl-line {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.fl-note :deep(code),
.fl-foot :deep(code),
.fl-line :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}

.fl-stage {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.fl-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.fl-track {
  position: relative;
  max-width: 100%;
  height: 40px;
}
/* Контейнер — пунктир, за которым начинается переполнение. */
.fl-box {
  position: absolute;
  inset: 0 auto 0 0;
  border: 1px dashed var(--border-strong);
  border-radius: var(--r1);
  background: var(--surface-2);
}
.fl-bar {
  position: absolute;
  top: 6px;
  bottom: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: var(--r1);
  box-shadow: inset -1px 0 0 var(--surface);
}
.fl-bar[data-i='0'] {
  background: var(--tone-info-chip);
  color: var(--tone-info-text);
}
.fl-bar[data-i='1'] {
  background: var(--tone-ok-chip);
  color: var(--tone-ok-text);
}
.fl-bar[data-i='2'] {
  background: var(--tone-warn-chip);
  color: var(--tone-warn-text);
}
.fl-bar__name {
  font-family: var(--mono);
  font-size: var(--fs-2);
  font-weight: 600;
}
.fl-over {
  position: absolute;
  top: 0;
  bottom: 0;
  border-radius: 0 var(--r1) var(--r1) 0;
  background: var(--tone-err-bg);
  box-shadow: inset 0 0 0 1px var(--tone-err-line);
}

/* Настоящий ряд шире демо до масштаба — обрезка не даёт ему утащить страницу вбок. */
.fl-clip {
  overflow: hidden;
  min-width: 0;
}
.fl-real {
  display: flex;
  height: 22px;
  transform-origin: 0 0;
  background: var(--surface-2);
  outline: 1px dashed var(--border-strong);
}
.fl-real__item {
  height: 100%;
  box-sizing: border-box;
}
.fl-real__item[data-i='0'] {
  background: var(--bar-violet);
}
.fl-real__item[data-i='1'] {
  background: var(--bar-green);
}
.fl-real__item[data-i='2'] {
  background: var(--bar-amber);
}

.fl-scroll {
  min-width: 0;
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: var(--r2);
}
.fl-table {
  width: 100%;
  min-width: 560px;
  border-collapse: collapse;
}
.fl-table th {
  padding: 8px 10px;
  background: var(--ink);
  color: var(--on-ink);
  font-family: var(--mono);
  font-size: var(--fs-2);
  font-weight: 400;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  text-align: start;
}
.fl-table td {
  padding: 6px 10px;
  border-bottom: 1px solid var(--rule);
  font-size: var(--fs-4);
  color: var(--ink);
}
.fl-table tbody tr:last-child td {
  border-bottom: 0;
}
.fl-num {
  font-family: var(--mono);
  font-size: var(--fs-3);
}
.fl-num--strong {
  font-weight: 600;
}
.fl-num[data-ok='yes'] {
  color: var(--tone-ok-text);
}
.fl-num[data-ok='no'] {
  color: var(--tone-err-strong);
  font-weight: 600;
}
.fl-input {
  width: 5em;
  padding: 3px 6px;
  border: 1px solid var(--border);
  border-radius: var(--r1);
  background: var(--surface);
  font: inherit;
  color: inherit;
  font-family: var(--mono);
  font-size: var(--fs-3);
}

.fl-log {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.fl-line--warn {
  color: var(--tone-err-text);
}
</style>
