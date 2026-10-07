<script setup lang="ts">
/**
 * «Линия под лупой»: какие пиксели буфера закрасит вертикальная полоса и с какой альфой —
 * по модели покрытия, по Chromium со стенда и по холсту браузера читателя.
 *
 * Модель — строка `RASTER_CODE` из темы, собранная `new Function` (`model/run.ts`). Третий ряд
 * рисует строка `PROBE_CODE` — та же, которой снят `STAND_COLUMNS`, — прямо в браузере
 * читателя, после монтирования (на сервере холста нет). `tests/unit/canvas.test.ts` сверяет
 * модель со всеми 64 рядами стенда и исполняет `PROBE_CODE` в Chromium заново.
 */
import { computed, onMounted, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { columnsKey, loadProbe, loadRaster, sameColumns } from '../model/run';
import type { ColumnsStand, LineCase, LineKind, ProbeFn } from '../model/types';

const props = defineProps<{
  rasterCode: string;
  probeCode: string;
  cases: LineCase;
  stand: ColumnsStand;
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const raster = loadRaster(props.rasterCode);
const COLS = 18;

const kind = ref<LineKind>(props.cases.kinds[0].value);
const x = ref(String(props.cases.xs[0]));
const width = ref(String(props.cases.widths[0]));
const scale = ref(String(props.cases.scales[0]));

const kindOptions = props.cases.kinds;
const xOptions = props.cases.xs.map((v) => ({ value: String(v), label: `x=${v}` }));
const widthOptions = props.cases.widths.map((v) => ({ value: String(v), label: `${v}px` }));
const scaleOptions = props.cases.scales.map((v) => ({ value: String(v), label: `×${v}` }));

const args = computed(() => [kind.value, Number(x.value), Number(width.value), Number(scale.value)] as const);

const model = computed(() => {
  const [k, xv, w, s] = args.value;
  return raster.rasterColumns(k, xv, w, s, COLS);
});
const standRow = computed(() => {
  const [k, xv, w, s] = args.value;
  return props.stand[columnsKey(k, s, xv, w)] ?? null;
});

/** Холст читателя: появляется только после монтирования. */
const probe = ref<ProbeFn | null>(null);
onMounted(() => {
  probe.value = loadProbe(props.probeCode);
});
const liveRun = computed<{ values: number[] | null; failed: boolean }>(() => {
  if (!probe.value) return { values: null, failed: false };
  const [k, xv, w, s] = args.value;
  try {
    return { values: probe.value(k, xv, w, s, COLS), failed: false };
  } catch {
    return { values: null, failed: true };
  }
});
const live = computed(() => liveRun.value.values);

const rows = computed(() => [
  { id: 'model', label: 'модель', values: model.value },
  { id: 'stand', label: 'Chromium 153', values: standRow.value },
  { id: 'live', label: 'ваш браузер', values: live.value },
]);

/** Полоса фигуры в точках буфера — для рамки над рядами. */
const band = computed(() => {
  const [k, xv, w, s] = args.value;
  const [l, r] = raster.band(k, xv, w).map((v) => v * s);
  return { l, r, left: `${(l / COLS) * 100}%`, width: `${((r - l) / COLS) * 100}%` };
});

const fmt = (n: number) => String(+n.toFixed(3)).replace('.', ',');

const bandText = computed(() => {
  const [k, xv, w, s] = args.value;
  const what = k === 'fill' ? `\`fillRect(${xv}, 0, ${w}, 4)\`` : `обводка \`lineWidth = ${w}\` по \`x = ${xv}\``;
  const full = model.value.filter((v) => v === 255).length;
  const part = model.value.filter((v) => v > 0 && v < 255).length;
  return `${what} при масштабе ${s}: полоса от **${fmt(band.value.l)}** до **${fmt(band.value.r)}** точки буфера. Целиком закрыто пикселей: ${full}, частично: ${part}.`;
});

const crispText = computed(() => {
  const [k, xv, w, s] = args.value;
  if (k === 'fill') return 'У `fillRect` край — сама координата: целое число точек буфера даёт чёткий край.';
  const dots = w * s;
  if (!Number.isInteger(dots)) return `Толщина ${fmt(dots)} точки — не целая: чётко эта линия не ляжет ни на какой координате.`;
  const cx = raster.crispX(xv, w, s);
  if (Math.abs(cx - xv) < 1e-9) return `\`crispX(${xv}, ${w}, ${s})\` = ${fmt(cx)}: линия уже на целых точках.`;
  return `\`crispX(${xv}, ${w}, ${s})\` = **${fmt(cx)}**: сдвиг, после которого линия ляжет на целые точки.`;
});

const verdict = computed(() => {
  const parts: string[] = [];
  if (standRow.value) {
    parts.push(
      sameColumns(model.value, standRow.value)
        ? 'Модель и Chromium совпали с точностью до единицы.'
        : 'Модель и Chromium разошлись больше чем на единицу.',
    );
  }
  if (live.value && standRow.value) {
    const diff = live.value.filter((v, i) => v !== standRow.value![i]).length;
    parts.push(
      diff === 0
        ? 'Ваш браузер нарисовал ровно то же, что Chromium стенда.'
        : `Ваш браузер разошёлся с Chromium в ${diff} столбцах${sameColumns(live.value, standRow.value) ? ' — на единицу, округление' : ''}.`,
    );
  } else if (liveRun.value.failed) {
    parts.push('Холст в этом браузере прочитать не удалось.');
  }
  return parts.join(' ');
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="cl-tools">
        <SegmentedControl v-model="kind" class="l-pills" label="Фигура" :options="kindOptions" />
        <SegmentedControl v-model="x" class="l-pills" label="x, CSS px" :options="xOptions" />
        <SegmentedControl v-model="width" class="l-pills" label="Толщина" :options="widthOptions" />
        <SegmentedControl v-model="scale" class="l-pills" label="Масштаб (DPR)" :options="scaleOptions" />
      </div>
    </template>

    <div class="cl-body">
      <Md class="cl-text" :text="bandText" />

      <div class="cl-scroll">
        <div class="cl-grid" role="table" aria-label="Альфа пикселей одного ряда буфера">
          <div class="cl-row" role="row">
            <span class="cl-name" role="rowheader">столбец</span>
            <div class="cl-cells cl-cells--head">
              <span v-for="i in COLS" :key="i" class="cl-index" role="columnheader">{{ i - 1 }}</span>
              <span class="cl-band" :style="{ left: band.left, width: band.width }" aria-hidden="true" />
            </div>
          </div>
          <div v-for="row in rows" :key="row.id" class="cl-row" role="row" :data-row="row.id">
            <span class="cl-name" role="rowheader">{{ row.label }}</span>
            <div class="cl-cells">
              <template v-if="row.values">
                <span v-for="(a, i) in row.values" :key="i" class="cl-cell" role="cell" :data-full="a === 255 ? 'yes' : 'no'">
                  <span class="cl-ink" :style="{ opacity: a / 255 }" />
                  <span class="cl-num">{{ a }}</span>
                </span>
              </template>
              <span v-else class="cl-wait" role="cell">…</span>
            </div>
          </div>
        </div>
      </div>

      <Md class="cl-text" :text="crispText" />
      <Md class="cl-text cl-stand" :text="verdict" />
      <Md class="cl-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.cl-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
  min-width: 0;
}
.cl-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
  min-width: 0;
}
.cl-text,
.cl-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.cl-text :deep(code),
.cl-caption :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
.cl-stand {
  padding: 10px 12px;
  border-radius: var(--r2);
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
}
.cl-scroll {
  overflow-x: auto;
  min-width: 0;
}
.cl-grid {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 640px;
}
.cl-row {
  display: grid;
  grid-template-columns: 110px minmax(0, 1fr);
  gap: 10px;
  align-items: center;
}
.cl-name {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.cl-cells {
  position: relative;
  display: grid;
  grid-template-columns: repeat(18, minmax(0, 1fr));
}
.cl-cells--head {
  padding-bottom: 8px;
}
.cl-index {
  font-family: var(--mono);
  font-size: var(--fs-2);
  text-align: center;
  color: var(--text-muted);
}
.cl-band {
  position: absolute;
  bottom: 0;
  height: 4px;
  border-radius: var(--r1);
  background: var(--tone-warn-line);
}
.cl-cell {
  position: relative;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  height: 40px;
  background: var(--surface);
  box-shadow: inset 0 0 0 1px var(--hairline);
}
.cl-ink {
  position: absolute;
  inset: 0;
  background: var(--ink);
}
.cl-num {
  position: relative;
  margin-bottom: 2px;
  padding: 0 2px;
  border-radius: 2px;
  font-family: var(--mono);
  font-size: var(--fs-2);
  background: var(--surface);
  color: var(--prose);
}
.cl-cell[data-full='yes'] .cl-num {
  background: transparent;
  color: var(--on-ink);
}
.cl-wait {
  grid-column: 1 / -1;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-muted);
}
</style>
