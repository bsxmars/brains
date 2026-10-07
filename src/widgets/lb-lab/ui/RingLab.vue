<script setup lang="ts">
/**
 * «Ключи и бэкенды»: куда уходят ключи при `hash` (остаток) и `hash … consistent` (кольцо)
 * и сколько их переезжает, когда добавляется ещё один бэкенд.
 *
 * Расчёт — строка `RING_CODE` из темы (`model/run.ts`); она же воспроизводит выбор nginx
 * для всех 1000 ключей стенда в `tests/unit/load-balancing.test.ts`. Компонент только
 * раскладывает результат по клеткам и рисует точки кольца.
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { assign, letterOf, loadRing, standKeys, standServers } from '../model/run';

const props = defineProps<{
  code: string;
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const api = loadRing(props.code);
const KEYS = standKeys(1000);
const SHOWN = 48;

const mode = ref<'mod' | 'ring'>('ring');
const modeOptions = [
  { value: 'mod', label: 'остаток % N' },
  { value: 'ring', label: 'кольцо' },
];
const nStr = ref('3');
const nOptions = ['2', '3', '4'].map((v) => ({ value: v, label: `${v} → ${Number(v) + 1}` }));
const vStr = ref('160');
const vOptions = ['1', '10', '160'].map((v) => ({ value: v, label: `${v} точ.` }));

const n = computed(() => Number(nStr.value));
const vnodes = computed(() => Number(vStr.value));
const before = computed(() => assign(api, KEYS, n.value, mode.value, vnodes.value));
const after = computed(() => assign(api, KEYS, n.value + 1, mode.value, vnodes.value));
const moved = computed(() => before.value.filter((b, i) => b !== after.value[i]).length);
const expected = computed(() =>
  mode.value === 'ring' ? Math.round(1000 / (n.value + 1)) : Math.round((1000 * n.value) / (n.value + 1)),
);
const expectedLabel = computed(() => (mode.value === 'ring' ? `1/${n.value + 1}` : `${n.value}/${n.value + 1}`));

const cells = computed(() =>
  KEYS.slice(0, SHOWN).map((k, i) => ({ key: k, from: before.value[i], to: after.value[i] })),
);

const names = computed(() => standServers(n.value + 1).map(letterOf));
function loads(list: string[]) {
  const c: Record<string, number> = {};
  for (const x of list) c[x] = (c[x] ?? 0) + 1;
  return c;
}
const loadRows = computed(() => {
  const b = loads(before.value);
  const a = loads(after.value);
  return names.value.map((name) => ({ name, before: b[name] ?? 0, after: a[name] ?? 0 }));
});

/** Точки кольца после добавления бэкенда: угол — доля хеша от 2^32. */
const ticks = computed(() => {
  if (mode.value !== 'ring') return [];
  return api.buildRing(standServers(n.value + 1), vnodes.value).map((p) => {
    const a = (p.hash / 2 ** 32) * 2 * Math.PI - Math.PI / 2;
    return {
      x1: 120 + 92 * Math.cos(a),
      y1: 120 + 92 * Math.sin(a),
      x2: 120 + 112 * Math.cos(a),
      y2: 120 + 112 * Math.sin(a),
      name: letterOf(p.server),
    };
  });
});
const tone = (name: string) => `rg-tone-${name}`;
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="rg-tools">
        <SegmentedControl v-model="mode" class="l-pills" label="Способ" :options="modeOptions" />
        <SegmentedControl v-model="nStr" class="l-pills" label="Бэкендов" :options="nOptions" />
        <SegmentedControl
          v-if="mode === 'ring'"
          v-model="vStr"
          class="l-pills"
          label="Точек на бэкенд"
          :options="vOptions"
        />
      </div>
    </template>

    <div class="rg-body">
      <div class="rg-split">
        <div class="rg-pane">
          <span class="rg-label">первые {{ SHOWN }} ключей из 1000: было → станет</span>
          <div class="rg-grid">
            <span
              v-for="c in cells"
              :key="c.key"
              class="rg-cell"
              :class="tone(c.to)"
              :data-moved="c.from !== c.to ? 'yes' : 'no'"
              :title="c.key"
            >
              <span class="rg-key">{{ c.key.slice(5) }}</span>
              <span class="rg-to">{{ c.from === c.to ? c.to : `${c.from}→${c.to}` }}</span>
            </span>
          </div>
        </div>

        <div class="rg-pane">
          <span class="rg-label">итог по 1000 ключам</span>
          <p class="rg-big">
            переехало <b>{{ moved }}</b> из 1000
            <span class="rg-muted">· по расчёту {{ expectedLabel }} ≈ {{ expected }}</span>
          </p>
          <table class="rg-table">
            <thead>
              <tr>
                <th scope="col">бэкенд</th>
                <th scope="col">было</th>
                <th scope="col">станет</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in loadRows" :key="r.name">
                <th scope="row"><span class="rg-dot" :class="tone(r.name)">{{ r.name }}</span></th>
                <td>{{ r.before }}</td>
                <td>{{ r.after }}</td>
              </tr>
            </tbody>
          </table>
          <svg
            v-if="mode === 'ring'"
            class="rg-ring"
            viewBox="0 0 240 240"
            role="img"
            :aria-label="`Кольцо: ${ticks.length} точек у ${n + 1} бэкендов`"
          >
            <circle cx="120" cy="120" r="102" class="rg-circle" />
            <line
              v-for="(tk, i) in ticks"
              :key="i"
              :x1="tk.x1"
              :y1="tk.y1"
              :x2="tk.x2"
              :y2="tk.y2"
              :class="`rg-tick rg-tick-${tk.name}`"
            />
          </svg>
        </div>
      </div>

      <Md class="rg-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.rg-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
}
.rg-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.rg-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.rg-caption :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
.rg-split {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 760px) {
  .rg-split {
    grid-template-columns: minmax(0, 1fr);
  }
}
.rg-pane {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.rg-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.rg-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(3.6em, 1fr));
  gap: 4px;
}
.rg-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 3px 2px;
  border: 1px solid transparent;
  border-radius: var(--r1);
  font-family: var(--mono);
}
.rg-cell[data-moved='yes'] {
  border-color: var(--ink);
  box-shadow: var(--shadow-1);
}
.rg-key {
  font-size: var(--fs-2);
  opacity: 0.85;
}
.rg-to {
  font-size: var(--fs-3);
  font-weight: 600;
}
.rg-big {
  margin: 0;
  font-size: var(--fs-4);
  color: var(--ink);
}
.rg-muted {
  font-size: var(--fs-3);
  color: var(--text-muted);
}
.rg-table {
  border-collapse: collapse;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--prose);
}
.rg-table th,
.rg-table td {
  padding: 4px 10px;
  border-bottom: 1px solid var(--hairline);
  text-align: left;
}
.rg-table thead th {
  font-size: var(--fs-2);
  font-weight: 500;
  color: var(--text-muted);
}
.rg-dot {
  display: inline-block;
  min-width: 1.8em;
  padding: 1px 6px;
  border-radius: var(--r1);
  text-align: center;
}
.rg-tone-A {
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
}
.rg-tone-B {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.rg-tone-C {
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.rg-tone-D {
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}
.rg-tone-E {
  background: var(--surface-3);
  color: var(--ink);
}
.rg-ring {
  /* Без явной заливки корень SVG красится чёрным по умолчанию — цвет мимо theme.ts
     (ловит palette.spec). Фигуры красятся своими классами. */
  fill: var(--ink);
  width: 100%;
  max-width: 240px;
  align-self: center;
}
.rg-circle {
  fill: none;
  stroke: var(--hairline);
  stroke-width: 1;
}
.rg-tick {
  stroke-width: 1.5;
}
.rg-tick-A {
  stroke: var(--tone-info-strong);
}
.rg-tick-B {
  stroke: var(--tone-ok-strong);
}
.rg-tick-C {
  stroke: var(--tone-warn-strong);
}
.rg-tick-D {
  stroke: var(--tone-err-strong);
}
.rg-tick-E {
  stroke: var(--bar-violet);
}
</style>
