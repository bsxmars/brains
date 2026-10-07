<script setup lang="ts">
/**
 * «Майерс по шагам»: граф правок двух строк, фронт самых дальних точек после каждого шага d
 * и итоговый путь — кратчайший скрипт правок.
 *
 * Считает не компонент, а строка `MYERS_CODE` из темы, собранная `new Function`
 * (`model/run.ts`). Фронт берётся прямо из снимков `trace`, которые возвращает `myers`,
 * путь — из её скрипта. Те же строки сверяет с jsdiff `tests/unit/diff.test.ts`.
 */
import { computed, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import StepToolbar from '@/shared/ui/StepToolbar.vue';
import { SegmentedControl } from '@/shared/ui';
import { frontier, loadMyers, scriptPath } from '../model/run';
import type { DiffPair } from '../model/types';

const props = defineProps<{
  myersCode: string;
  pairs: DiffPair[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const myers = loadMyers(props.myersCode);
const MAX = 12;

const picked = ref(props.pairs[0].id);
const options = props.pairs.map((p) => ({ value: p.id, label: p.label }));
const a = ref(props.pairs[0].a);
const b = ref(props.pairs[0].b);
watch(picked, (id) => {
  const p = props.pairs.find((x) => x.id === id);
  if (!p) return;
  a.value = p.a;
  b.value = p.b;
});

const A = computed(() => [...a.value].slice(0, MAX));
const B = computed(() => [...b.value].slice(0, MAX));
const n = computed(() => A.value.length);
const m = computed(() => B.value.length);
const res = computed(() => myers(A.value, B.value));

const step = ref(0);
watch(res, () => {
  step.value = 0;
});
const atEnd = computed(() => step.value >= res.value.d);

const minus = (k: number) => (k < 0 ? `−${-k}` : String(k));

const rounds = computed(() =>
  Array.from({ length: step.value + 1 }, (_, d) => ({
    d,
    points: frontier(res.value, d, n.value, m.value),
  })),
);
const current = computed(() => rounds.value[rounds.value.length - 1].points);

const roundText = (pts: { k: number; x: number; y: number; inside: boolean }[]) =>
  pts.map((p) => `k = ${minus(p.k)}: ${p.inside ? `(${p.x}, ${p.y})` : 'за краем'}`).join(' · ');

const status = computed(() => {
  const d = step.value;
  const D = res.value.d;
  const corner = `(${n.value}, ${m.value})`;
  if (d === 0 && D > 0) {
    return `Шаг 0: без единой правки, по одним совпадениям с начала, путь дошёл до ${roundText(current.value)}. До угла ${corner} далеко — нужны правки.`;
  }
  if (d < D) {
    const word = d === 1 ? 'одной правки' : `${d} правок`;
    return `Шаг ${d}: пути из ${word} дошли до точек ${roundText(current.value.filter((p) => p.inside)) || '—'}. До угла ${corner} не дошёл никто — нужна ещё правка.`;
  }
  return `Шаг ${D}: диагональ k = ${minus(n.value - m.value)} дошла до угла ${corner}. Кратчайший скрипт — **${D}** ${D === 1 ? 'правка' : D >= 2 && D <= 4 ? 'правки' : 'правок'}; путь восстановлен обратным ходом по снимкам \`v\`.`;
});

// ─── Геометрия сетки ───────────────────────────────────────────────────────────────────────

const CELL = 34;
const PAD = 30;
const width = computed(() => PAD + n.value * CELL + 14);
const height = computed(() => PAD + m.value * CELL + 14);
const px = (x: number) => PAD + x * CELL;
const py = (y: number) => PAD + y * CELL;

/** Бесплатные диагонали: из (x, y) в (x + 1, y + 1), где `a[x] === b[y]`. */
const diagonals = computed(() => {
  const out: { x: number; y: number }[] = [];
  A.value.forEach((ch, x) =>
    B.value.forEach((ch2, y) => {
      if (ch === ch2) out.push({ x, y });
    }),
  );
  return out;
});

const path = computed(() =>
  atEnd.value
    ? scriptPath(res.value)
        .map(([x, y]) => `${px(x)},${py(y)}`)
        .join(' ')
    : '',
);

const script = computed(() =>
  res.value.script.map(([op, v], i) => ({ i, op, v: String(v), sign: op === '=' ? '' : op === '-' ? '−' : '+' })),
);

function next() {
  if (!atEnd.value) step.value++;
}
function prev() {
  if (step.value > 0) step.value--;
}
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="picked" class="l-pills" label="Пара строк" :options="options" />
    </template>

    <div class="ml-body">
      <div class="ml-inputs">
        <label class="ml-field">
          <span class="ml-label">было</span>
          <input v-model="a" class="ml-input" :maxlength="MAX" spellcheck="false" autocomplete="off" />
        </label>
        <label class="ml-field">
          <span class="ml-label">стало</span>
          <input v-model="b" class="ml-input" :maxlength="MAX" spellcheck="false" autocomplete="off" />
        </label>
      </div>

      <StepToolbar
        :counter="`шаг d = ${step} из ${res.d}`"
        :at-start="step === 0"
        :at-end="atEnd"
        @prev="prev"
        @next="next"
        @reset="step = 0"
      />

      <div class="ml-split">
        <div class="ml-graph">
          <svg
            :width="width"
            :height="height"
            :viewBox="`0 0 ${width} ${height}`"
            role="img"
            :aria-label="`Граф правок ${n} на ${m}, шаг ${step}`"
          >
            <text v-for="(ch, x) in A" :key="`a${x}`" class="ml-axis" :x="px(x) + CELL / 2" :y="PAD - 12">{{ ch }}</text>
            <text v-for="(ch, y) in B" :key="`b${y}`" class="ml-axis" :x="PAD - 14" :y="py(y) + CELL / 2 + 5">{{ ch }}</text>

            <line v-for="x in n + 1" :key="`v${x}`" class="ml-grid" :x1="px(x - 1)" :y1="py(0)" :x2="px(x - 1)" :y2="py(m)" />
            <line v-for="y in m + 1" :key="`h${y}`" class="ml-grid" :x1="px(0)" :y1="py(y - 1)" :x2="px(n)" :y2="py(y - 1)" />
            <line
              v-for="g in diagonals"
              :key="`d${g.x}-${g.y}`"
              class="ml-diag"
              :x1="px(g.x)"
              :y1="py(g.y)"
              :x2="px(g.x + 1)"
              :y2="py(g.y + 1)"
            />

            <polyline v-if="path" class="ml-path" :points="path" />

            <template v-for="r in rounds" :key="`r${r.d}`">
              <circle
                v-for="p in r.points.filter((q) => q.inside)"
                :key="`p${r.d}-${p.k}`"
                :class="r.d === step ? 'ml-dot ml-dot--now' : 'ml-dot'"
                :cx="px(p.x)"
                :cy="py(p.y)"
                :r="r.d === step ? 6 : 3.5"
              />
            </template>
            <circle class="ml-end" :cx="px(n)" :cy="py(m)" r="8" />
          </svg>
        </div>

        <div class="ml-front">
          <span class="ml-label">фронт: самый дальний x на каждой диагонали</span>
          <div v-for="r in rounds" :key="r.d" class="ml-round" :data-now="r.d === step ? 'yes' : 'no'">
            <span class="ml-round__d">d = {{ r.d }}</span>
            <span class="ml-round__pts">{{ roundText(r.points) }}</span>
          </div>
        </div>
      </div>

      <Md class="ml-status" :text="status" />

      <div v-if="atEnd" class="ml-script" aria-label="Скрипт правок">
        <span v-for="s in script" :key="s.i" class="ml-op" :data-op="s.op">{{ s.sign }}{{ s.v }}</span>
      </div>

      <Md class="ml-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.ml-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.ml-inputs {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.ml-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1 1 160px;
  min-width: 0;
}
.ml-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.ml-input {
  font: inherit;
  color: inherit;
  font-family: var(--mono);
  font-size: var(--fs-4);
  padding: 8px 10px;
  border: 1px solid var(--border-strong);
  border-radius: var(--r2);
  background: var(--surface);
  min-width: 0;
}
.ml-input:focus-visible {
  outline: 2px solid var(--ink);
  outline-offset: 1px;
}

.ml-split {
  display: grid;
  grid-template-columns: minmax(0, auto) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 760px) {
  .ml-split {
    grid-template-columns: minmax(0, 1fr);
  }
}

.ml-graph {
  min-width: 0;
  overflow-x: auto;
  padding: 8px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.ml-graph svg {
  display: block;
  max-width: none;
  /* Без явной заливки корень SVG красится чёрным по умолчанию — цвет мимо theme.ts
     (ловит palette.spec). Фигуры красятся своими классами, остальное наследует чернила. */
  fill: var(--ink);
}
.ml-axis {
  font-family: var(--mono);
  font-size: var(--fs-3);
  fill: var(--ink);
  text-anchor: middle;
}
.ml-grid {
  stroke: var(--border);
  stroke-width: 1;
}
.ml-diag {
  stroke: var(--tone-ok-line);
  stroke-width: 2;
  stroke-dasharray: 4 3;
}
.ml-path {
  fill: none;
  stroke: var(--tone-info-strong);
  stroke-width: 3.5;
  stroke-linejoin: round;
  stroke-linecap: round;
}
.ml-dot {
  fill: var(--text-faint);
}
.ml-dot--now {
  fill: var(--tone-warn-strong);
  stroke: var(--surface);
  stroke-width: 2;
}
.ml-end {
  fill: none;
  stroke: var(--ink);
  stroke-width: 1.5;
  stroke-dasharray: 3 2;
}

.ml-front {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.ml-round {
  display: grid;
  grid-template-columns: 4.5em minmax(0, 1fr);
  gap: 8px;
  align-items: baseline;
  padding: 6px 10px;
  border-radius: var(--r2);
  background: var(--surface-2);
}
.ml-round[data-now='yes'] {
  background: var(--tone-warn-bg);
  box-shadow: inset 2px 0 0 var(--tone-warn-line);
}
.ml-round__d {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.ml-round__pts {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--ink);
  overflow-wrap: anywhere;
}

.ml-status,
.ml-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.ml-status :deep(code),
.ml-caption :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}

.ml-script {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.ml-op {
  padding: 3px 8px;
  border-radius: var(--r1);
  font-family: var(--mono);
  font-size: var(--fs-3);
  background: var(--surface-2);
  color: var(--prose);
  border: 1px solid var(--border);
}
.ml-op[data-op='-'] {
  background: var(--tone-err-bg);
  border-color: var(--tone-err-line);
  color: var(--tone-err-text);
}
.ml-op[data-op='+'] {
  background: var(--tone-ok-bg);
  border-color: var(--tone-ok-line);
  color: var(--tone-ok-text);
}
</style>
