<script setup lang="ts">
/**
 * «Поле с фигурами»: тысяча точек или четыреста прямоугольников, курсор или рамка, и какие
 * узлы индекса запрос открыл. Во втором режиме (`mode="knn"`) — пять ближайших к указателю
 * по R-дереву.
 *
 * Считает не компонент, а строки `*_CODE` из темы, собранные `new Function` (`model/run.ts`).
 * Те же строки напечатаны на странице и прогоняются `tests/unit/spatial-index.test.ts` против
 * `rbush`, `flatbush` и перебора. Компонент только рисует узлы, фигуры и счётчики.
 */
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { around, buildQuad, buildRTree, emptyStats, loadShapes, loadSpatial, quadNodes, rNodes } from '../model/run';
import type { Box, Layout, Neighbor, Shape, SpatialCodes, SpatialSetup, Stats } from '../model/types';

const props = defineProps<{
  codes: SpatialCodes;
  shapesCode: string;
  setup: SpatialSetup;
  /** `search` — поиск рамкой четырьмя способами; `knn` — пять ближайших по R-дереву. */
  mode: 'search' | 'knn';
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const api = loadSpatial(props.codes);
const gen = loadShapes(props.shapesCode);

const POINTS = 1000;
const RECTS = 400;
const RECT_SIZE = 24;
const CURSOR = 8;
const K = 5;

type Index = 'brute' | 'grid' | 'quad' | 'rtree';
type Query = 'cursor' | 'frame';

const layout = ref<Layout>('clusters');
const layoutOptions = [
  { value: 'uniform', label: 'равномерно' },
  { value: 'clusters', label: 'сгустки' },
  { value: 'pile', label: 'стопка' },
];
const kind = ref<'points' | 'rects'>('points');
const kindOptions = [
  { value: 'points', label: 'точки' },
  { value: 'rects', label: 'прямоугольники' },
];
const index = ref<Index>(props.mode === 'knn' ? 'rtree' : 'quad');
const indexOptions = computed(() =>
  [
    { value: 'brute', label: 'перебор' },
    { value: 'grid', label: 'сетка' },
    { value: 'quad', label: 'квадродерево' },
    { value: 'rtree', label: 'R-дерево' },
  ].filter((o) => kind.value === 'points' || o.value !== 'quad'),
);
watch(kind, (k) => {
  if (k === 'rects' && index.value === 'quad') index.value = 'rtree';
});
const query = ref<Query>('cursor');
const queryOptions = [
  { value: 'cursor', label: 'курсор' },
  { value: 'frame', label: 'рамка' },
];

const shapes = computed<Shape[]>(() =>
  kind.value === 'points'
    ? gen.makeShapes(POINTS, props.setup.seed, layout.value, 0)
    : gen.makeShapes(RECTS, props.setup.seed, layout.value, RECT_SIZE),
);
const grid = computed(() => api.buildGrid(shapes.value, props.setup.cell));
const quad = computed(() => (kind.value === 'points' ? buildQuad(api, shapes.value, props.setup.cap, props.setup.maxDepth) : null));
const tree = computed(() => buildRTree(api, shapes.value));

/** Указатель и рамка — в координатах поля. */
const cursor = ref({ x: 430, y: 380 });
const frame = ref<Box>({ minX: 330, minY: 300, maxX: 560, maxY: 470 });
/** Новый набор — указатель встаёт на первую фигуру: у «стопки» это сама стопка. */
watch(
  shapes,
  (list) => {
    const s = list[0];
    cursor.value = { x: (s.minX + s.maxX) / 2, y: (s.minY + s.maxY) / 2 };
  },
  { immediate: true },
);

const qbox = computed<Box>(() =>
  props.mode === 'search' && query.value === 'frame' ? frame.value : around(cursor.value.x, cursor.value.y, CURSOR),
);

interface Result {
  stats: Stats;
  found: Set<number>;
  near: Neighbor[];
}
const result = shallowRef<Result>({ stats: emptyStats(), found: new Set(), near: [] });

function run() {
  const stats = emptyStats();
  let ids: number[];
  let near: Neighbor[] = [];
  if (props.mode === 'knn') {
    near = api.rKnn(tree.value, cursor.value.x, cursor.value.y, K, stats);
    ids = near.map((n) => n.id);
  } else if (index.value === 'brute') ids = api.bruteSearch(shapes.value, qbox.value, stats);
  else if (index.value === 'grid') ids = api.gridSearch(grid.value, qbox.value, stats);
  else if (index.value === 'quad' && quad.value) ids = api.quadSearch(quad.value, qbox.value, [], stats);
  else ids = api.rSearch(tree.value.root, qbox.value, [], stats);
  result.value = { stats, found: new Set(ids), near };
}
watch([shapes, index, query, qbox], run, { immediate: true });

const visited = computed(() => new Set<object>(result.value.stats.nodes));

/** Узлы для рисования: у квадродерева — все квадраты, у R-дерева — все узлы с глубиной. */
const drawn = computed(() => {
  const idx = props.mode === 'knn' ? 'rtree' : index.value;
  if (idx === 'quad' && quad.value) {
    return quadNodes(quad.value)
      .filter((n) => n.depth > 0)
      .map((n) => ({ box: n as Box, leaf: !n.kids, on: visited.value.has(n) }));
  }
  if (idx === 'rtree') {
    return rNodes(tree.value.root).map(({ node }) => ({ box: node as Box, leaf: node.leaf, on: visited.value.has(node) }));
  }
  return [];
});
const gridCells = computed(() => (props.mode === 'search' && index.value === 'grid' ? result.value.stats.nodes : []));
const gridLines = computed(() => {
  if (props.mode !== 'search' || index.value !== 'grid') return [];
  const out: number[] = [];
  for (let v = props.setup.cell; v < 1000; v += props.setup.cell) out.push(v);
  return out;
});

const treeInfo = computed(() => {
  const idx = props.mode === 'knn' ? 'rtree' : index.value;
  if (idx === 'quad' && quad.value) {
    const nodes = quadNodes(quad.value);
    return { total: nodes.length, label: `узлов в дереве ${nodes.length}, глубина ${Math.max(...nodes.map((n) => n.depth))}` };
  }
  if (idx === 'rtree') {
    const nodes = rNodes(tree.value.root);
    return { total: nodes.length, label: `узлов в дереве ${nodes.length}, уровней ${Math.max(...nodes.map((n) => n.depth)) + 1}` };
  }
  if (idx === 'grid') return { total: grid.value.buckets.length, label: `клеток ${grid.value.buckets.length}, в самой полной ${Math.max(...grid.value.buckets.map((b) => b.length))}` };
  return { total: 0, label: 'индекса нет: каждая фигура проверяется' };
});

const ratio = computed(() => {
  const c = result.value.stats.checks;
  if (!c) return '';
  const r = shapes.value.length / c;
  return r >= 1.05 ? `в ${r >= 10 ? Math.round(r) : r.toFixed(1).replace('.', ',')} раза меньше перебора` : 'столько же, сколько перебор';
});

/** Ближайшая к указателю точка прямоугольника — конец линии до соседа. */
function nearestOn(b: Box) {
  const { x, y } = cursor.value;
  return { x: Math.min(Math.max(x, b.minX), b.maxX), y: Math.min(Math.max(y, b.minY), b.maxY) };
}
const nearLines = computed(() =>
  result.value.near.map((n) => {
    const p = nearestOn(shapes.value[n.id]);
    return { id: n.id, x2: p.x, y2: p.y, d: Math.sqrt(n.dist) };
  }),
);

// ─── Указатель ──────────────────────────────────────────────────────────────────────────────
const svg = ref<SVGSVGElement | null>(null);
let raf = 0;
let pending: { x: number; y: number } | null = null;
let dragFrom: { x: number; y: number } | null = null;

function toField(e: PointerEvent) {
  const r = svg.value!.getBoundingClientRect();
  return {
    x: Math.min(1000, Math.max(0, ((e.clientX - r.left) / r.width) * 1000)),
    y: Math.min(1000, Math.max(0, ((e.clientY - r.top) / r.height) * 1000)),
  };
}
function apply(p: { x: number; y: number }) {
  if (props.mode === 'search' && query.value === 'frame') {
    if (!dragFrom) return;
    frame.value = {
      minX: Math.min(dragFrom.x, p.x),
      minY: Math.min(dragFrom.y, p.y),
      maxX: Math.max(dragFrom.x, p.x),
      maxY: Math.max(dragFrom.y, p.y),
    };
  } else cursor.value = p;
}
function schedule(p: { x: number; y: number }) {
  pending = p;
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    if (pending) apply(pending);
    pending = null;
  });
}
function onDown(e: PointerEvent) {
  const p = toField(e);
  if (props.mode === 'search' && query.value === 'frame') {
    dragFrom = p;
    svg.value?.setPointerCapture(e.pointerId);
    apply(p);
  } else schedule(p);
}
function onMove(e: PointerEvent) {
  if (props.mode === 'search' && query.value === 'frame' && !dragFrom) return;
  schedule(toField(e));
}
function onUp() {
  dragFrom = null;
}
function onKey(e: KeyboardEvent) {
  const step = e.shiftKey ? 100 : 20;
  const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
  if (!d) return;
  e.preventDefault();
  if (props.mode === 'search' && query.value === 'frame') {
    const f = frame.value;
    const dx = Math.min(1000 - f.maxX, Math.max(-f.minX, d[0]));
    const dy = Math.min(1000 - f.maxY, Math.max(-f.minY, d[1]));
    frame.value = { minX: f.minX + dx, minY: f.minY + dy, maxX: f.maxX + dx, maxY: f.maxY + dy };
  } else {
    cursor.value = {
      x: Math.min(1000, Math.max(0, cursor.value.x + d[0])),
      y: Math.min(1000, Math.max(0, cursor.value.y + d[1])),
    };
  }
}
onBeforeUnmount(() => cancelAnimationFrame(raf));

const dragging = computed(() => props.mode === 'search' && query.value === 'frame');
const fieldLabel = computed(
  () =>
    `Поле 1000 на 1000: ${shapes.value.length} фигур. Найдено ${result.value.found.size}, проверок ${result.value.stats.checks}. Стрелки двигают ${dragging.value ? 'рамку' : 'указатель'}.`,
);
const pointR = 5;
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="sl-tools">
        <SegmentedControl v-model="layout" class="l-pills" label="Набор" :options="layoutOptions" />
        <SegmentedControl v-model="kind" class="l-pills" label="Фигуры" :options="kindOptions" />
        <SegmentedControl v-if="mode === 'search'" v-model="index" class="l-pills" label="Индекс" :options="indexOptions" />
        <SegmentedControl v-if="mode === 'search'" v-model="query" class="l-pills" label="Запрос" :options="queryOptions" />
      </div>
    </template>

    <div class="sl-body">
      <div class="sl-split">
        <svg
          ref="svg"
          class="sl-field"
          :class="{ 'sl-field--drag': dragging }"
          viewBox="0 0 1000 1000"
          role="img"
          tabindex="0"
          :aria-label="fieldLabel"
          @pointerdown="onDown"
          @pointermove="onMove"
          @pointerup="onUp"
          @pointercancel="onUp"
          @keydown="onKey"
        >
          <rect class="sl-bg" x="0" y="0" width="1000" height="1000" />

          <rect
            v-for="(c, i) in gridCells"
            :key="`c${i}`"
            class="sl-node sl-node--on"
            :x="c.minX"
            :y="c.minY"
            :width="c.maxX - c.minX"
            :height="c.maxY - c.minY"
          />
          <template v-for="v in gridLines" :key="`g${v}`">
            <line class="sl-gridline" :x1="v" y1="0" :x2="v" y2="1000" />
            <line class="sl-gridline" x1="0" :y1="v" x2="1000" :y2="v" />
          </template>

          <rect
            v-for="(n, i) in drawn"
            :key="`n${i}`"
            class="sl-node"
            :class="{ 'sl-node--leaf': n.leaf, 'sl-node--on': n.on }"
            :x="n.box.minX"
            :y="n.box.minY"
            :width="Math.max(1, n.box.maxX - n.box.minX)"
            :height="Math.max(1, n.box.maxY - n.box.minY)"
          />

          <template v-if="kind === 'points'">
            <circle
              v-for="s in shapes"
              :key="s.id"
              class="sl-shape"
              :class="{ 'sl-shape--hit': result.found.has(s.id) }"
              :cx="s.minX"
              :cy="s.minY"
              :r="pointR"
            />
          </template>
          <template v-else>
            <rect
              v-for="s in shapes"
              :key="s.id"
              class="sl-shape sl-shape--rect"
              :class="{ 'sl-shape--hit': result.found.has(s.id) }"
              :x="s.minX"
              :y="s.minY"
              :width="s.maxX - s.minX"
              :height="s.maxY - s.minY"
            />
          </template>

          <line
            v-for="l in nearLines"
            :key="`k${l.id}`"
            class="sl-near"
            :x1="cursor.x"
            :y1="cursor.y"
            :x2="l.x2"
            :y2="l.y2"
          />

          <rect
            class="sl-query"
            :x="qbox.minX"
            :y="qbox.minY"
            :width="qbox.maxX - qbox.minX"
            :height="qbox.maxY - qbox.minY"
          />
          <circle v-if="!dragging" class="sl-cursor" :cx="cursor.x" :cy="cursor.y" r="7" />
        </svg>

        <div class="sl-pane">
          <span class="sl-label">{{ mode === 'knn' ? 'пять ближайших' : 'запрос' }}</span>
          <p class="sl-big">
            проверок <b>{{ result.stats.checks }}</b>{{ ' ' }}<span class="sl-muted">· перебор — {{ shapes.length }}</span>
          </p>
          <p v-if="ratio" class="sl-line">{{ ratio }}</p>
          <p class="sl-line">
            {{ index === 'grid' && mode === 'search' ? 'клеток открыто' : 'узлов открыто' }}:
            <b>{{ result.stats.nodes.length }}</b><template v-if="treeInfo.total && !(index === 'grid' && mode === 'search')"> из {{ treeInfo.total }}</template>
          </p>
          <p class="sl-line">найдено: <b>{{ result.found.size }}</b></p>
          <p class="sl-line sl-muted">{{ treeInfo.label }}</p>
          <ol v-if="mode === 'knn'" class="sl-near-list">
            <li v-for="l in nearLines" :key="l.id">
              <code>#{{ l.id }}</code> — {{ l.d.toFixed(1).replace('.', ',') }}
            </li>
          </ol>
          <div class="sl-legend" aria-hidden="true">
            <span><i class="sl-key sl-key--on" />открытый узел</span>
            <span><i class="sl-key sl-key--hit" />найдено</span>
            <span><i class="sl-key sl-key--query" />{{ mode === 'knn' ? 'указатель' : 'рамка запроса' }}</span>
          </div>
        </div>
      </div>

      <Md class="sl-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.sl-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
}
.sl-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.sl-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.sl-caption :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
.sl-split {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 760px) {
  .sl-split {
    grid-template-columns: minmax(0, 1fr);
  }
}

.sl-field {
  /* Без явной заливки корень SVG красится чёрным по умолчанию — цвет мимо theme.ts
     (ловит palette.spec). Фигуры красятся своими классами. */
  fill: var(--ink);
  display: block;
  width: 100%;
  height: auto;
  aspect-ratio: 1;
  border-radius: var(--r3);
  cursor: crosshair;
  touch-action: pan-y;
}
.sl-field--drag {
  touch-action: none;
}
.sl-field:focus-visible {
  outline: 2px solid var(--tone-info-strong);
  outline-offset: 2px;
}
.sl-bg {
  fill: var(--surface-2);
}
.sl-gridline {
  stroke: var(--border);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}
.sl-node {
  fill: none;
  stroke: var(--border-strong);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}
.sl-node--leaf {
  stroke: var(--border);
}
.sl-node--on {
  fill: var(--tone-warn-bg);
  fill-opacity: 0.55;
  stroke: var(--tone-warn-strong);
}
.sl-shape {
  fill: var(--text-muted);
}
.sl-shape--rect {
  fill: var(--surface-3);
  stroke: var(--text-muted);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}
.sl-shape--hit {
  fill: var(--tone-ok-strong);
}
.sl-shape--rect.sl-shape--hit {
  fill: var(--tone-ok-bg);
  stroke: var(--tone-ok-strong);
}
.sl-query {
  fill: none;
  stroke: var(--tone-info-strong);
  stroke-width: 2;
  stroke-dasharray: 6 4;
  vector-effect: non-scaling-stroke;
}
.sl-cursor {
  fill: none;
  stroke: var(--tone-info-strong);
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
}
.sl-near {
  stroke: var(--tone-info-strong);
  stroke-width: 1.5;
  vector-effect: non-scaling-stroke;
}

.sl-pane {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
  color: var(--prose);
  font-size: var(--fs-3);
}
.sl-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.sl-big {
  margin: 0;
  font-size: var(--fs-4);
  color: var(--ink);
}
.sl-line {
  margin: 0;
  line-height: 1.5;
}
.sl-muted {
  font-size: var(--fs-3);
  color: var(--text-muted);
}
.sl-near-list {
  margin: 0;
  padding-left: 1.4em;
  font-size: var(--fs-3);
}
.sl-near-list code {
  font-family: var(--mono);
  color: var(--ink);
}
.sl-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  margin-top: 4px;
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.sl-legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.sl-key {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: var(--r1);
}
.sl-key--on {
  background: var(--tone-warn-bg);
  box-shadow: inset 0 0 0 1px var(--tone-warn-strong);
}
.sl-key--hit {
  background: var(--tone-ok-strong);
}
.sl-key--query {
  box-shadow: inset 0 0 0 2px var(--tone-info-strong);
}
</style>
