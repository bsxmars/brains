<script setup lang="ts">
/**
 * «Пирамида над городом» (`mode="tiles"`) и «Кластеры над Москвой» (`mode="cluster"`).
 *
 * Считает не компонент, а строки `*_CODE` темы «Карты в интерфейсе», собранные `new Function`
 * (`model/run.ts`): проекция, тайлы окна, набор мест, кластеры. Те же строки напечатаны на
 * странице и прогоняются `tests/unit/maps.test.ts` против `@math.gl/web-mercator` и
 * `supercluster`. Компонент только рисует сетку тайлов и метки. Настоящих тайлов из сети нет:
 * плитки нарисованы самим демо.
 *
 * В `setup` нет ни `window`, ни тяжёлой работы: он исполняется и на сборке. Кластеры
 * собираются по кнопке.
 */
import { computed, ref, shallowRef } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button, SegmentedControl } from '@/shared/ui';
import { freshTiles, loadMaps, marksInView, tileKey, uniqueRequests, viewBox } from '../model/run';
import type { MapCodes, Mark, ViewTile } from '../model/types';

interface City {
  city: string;
  lng: number;
  lat: number;
}

interface ClusterSetup {
  n: number;
  seed: number;
  radius: number;
  maxZoom: number;
  lng: number;
  lat: number;
  zooms: number[];
}

const props = defineProps<{
  codes: MapCodes;
  /** `tiles` — тайлы окна над городом; `cluster` — кластеры над Москвой. */
  mode: 'tiles' | 'cluster';
  /** Города для `tiles`. */
  cities?: City[];
  /** Набор и окно для `cluster`. */
  setup?: ClusterSetup;
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const api = loadMaps(props.codes);
const TILE = api.TILE;
const W = 640;
const H = 400;
const STEP = 300;
const TEMPLATE = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

const fmt = (v: number, digits = 2) => v.toLocaleString('ru-RU', { maximumFractionDigits: digits });

// ─── Тайлы ──────────────────────────────────────────────────────────────────────────────────

const cityList = props.cities ?? [];
const cityName = ref(cityList[0]?.city ?? '');
const cityOptions = cityList.map((c) => ({ value: c.city, label: c.city }));
const city = computed(() => cityList.find((c) => c.city === cityName.value) ?? cityList[0]);

const z = ref(12);
/** Центр окна в долях мира: не зависит от уровня, поэтому смена `z` его не сдвигает. */
const center = ref({ x: 0.5, y: 0.5 });
const prevTiles = shallowRef<ViewTile[]>([]);
/** Все адреса, которые уже запрашивались: «память» карты за сессию. */
const seen = shallowRef(new Set<string>());
const withoutMemory = ref(0);
const lastAction = ref('открыли карту');

const size = computed(() => TILE * 2 ** z.value);
const cx = computed(() => center.value.x * size.value);
const cy = computed(() => center.value.y * size.value);
const tiles = computed(() => api.tilesInView(cx.value, cy.value, z.value, W, H));

/** Записать в «память» то, что видно сейчас. Вызывается из обработчиков, не из шаблона. */
function commit(before: ViewTile[]) {
  const now = api.tilesInView(cx.value, cy.value, z.value, W, H);
  const next = new Set(seen.value);
  for (const t of now) next.add(tileKey(t));
  seen.value = next;
  withoutMemory.value += uniqueRequests(now);
  prevTiles.value = before;
}

function openCity() {
  const c = city.value;
  if (!c) return;
  const p = api.project(c.lng, c.lat, 0);
  center.value = { x: p.x / TILE, y: p.y / TILE };
  seen.value = new Set();
  withoutMemory.value = 0;
  lastAction.value = 'открыли карту';
  commit([]);
}
openCity();

function pickCity(name: string) {
  cityName.value = name;
  openCity();
}

function zoomBy(d: number) {
  const next = Math.max(0, Math.min(18, z.value + d));
  if (next === z.value) return;
  const before = tiles.value;
  z.value = next;
  lastAction.value = d > 0 ? 'приблизили' : 'отдалили';
  commit(before);
}

function pan(d: number) {
  const before = tiles.value;
  center.value = { x: center.value.x + d / size.value, y: center.value.y };
  lastAction.value = d > 0 ? `сдвинули на ${STEP} px вправо` : `сдвинули на ${STEP} px влево`;
  commit(before);
}

const fresh = computed(() => new Set(freshTiles(prevTiles.value, tiles.value)));
const hit = computed(() => (city.value ? api.tileOf(city.value.lng, city.value.lat, z.value) : null));
const cityOnScreen = computed(() => {
  const c = city.value;
  if (!c) return null;
  const p = api.project(c.lng, c.lat, z.value);
  // Мир повторяется по долготе: берём копию города, ближайшую к центру окна.
  const dx = ((((p.x - cx.value) % size.value) + size.value * 1.5) % size.value) - size.value / 2;
  return { x: W / 2 + dx, y: p.y - cy.value + H / 2 };
});
const mpp = computed(() => (city.value ? api.metersPerPixel(city.value.lat, z.value) : 0));
const url = computed(() => (hit.value ? api.tileUrl(TEMPLATE, hit.value) : ''));

/**
 * Подпись плитки — в видимой части тайла, иначе у краёв окна она уезжает за рамку. У тайла,
 * от которого видна узкая полоса, подписи нет: она налезла бы на подпись соседа.
 */
const LABEL_W = 100;
const LABEL_H = 30;
const drawn = computed(() =>
  tiles.value.map((t) => ({
    ...t,
    key: `${t.left}:${t.top}`,
    isNew: fresh.value.has(tileKey(t)),
    lx: Math.max(t.left, 0) + 8,
    ly: Math.max(t.top, 0) + 20,
    labeled:
      Math.min(t.left + TILE, W) - Math.max(t.left, 0) >= LABEL_W &&
      Math.min(t.top + TILE, H) - Math.max(t.top, 0) >= LABEL_H,
  })),
);
const worldTop = computed(() => -cy.value + H / 2);

const tilesLabel = computed(
  () =>
    `Окно ${W} на ${H} над городом ${city.value?.city ?? ''}, уровень ${z.value}: ${tiles.value.length} мест под тайлы, ${uniqueRequests(tiles.value)} разных адресов, новых после шага ${fresh.value.size}.`,
);

// ─── Кластеры ───────────────────────────────────────────────────────────────────────────────

const setup = props.setup;
const zoomOptions = (setup?.zooms ?? []).map((v) => ({ value: String(v), label: String(v) }));
const cz = ref(String(setup?.zooms[2] ?? 11));
const levels = shallowRef<Record<number, Mark[]> | null>(null);

function build() {
  if (!setup) return;
  const places = api.makePlaces(setup.n, setup.seed);
  levels.value = api.buildClusters(places, setup.radius, setup.maxZoom);
}

const clusterView = computed(() => {
  if (!setup || !levels.value) return null;
  const zz = Number(cz.value);
  const c = api.project(setup.lng, setup.lat, zz);
  const box = viewBox(TILE, c.x, c.y, zz, W, H);
  const s = TILE * 2 ** zz;
  const toScreen = (m: Mark) => ({ sx: m.x * s - c.x + W / 2, sy: m.y * s - c.y + H / 2 });
  const marks = marksInView(levels.value, zz, box).map((m, i) => ({ ...m, ...toScreen(m), key: i }));
  const raw = marksInView(levels.value, setup.maxZoom + 1, box).length;
  const clusters = marks.filter((m) => m.count > 1);
  return {
    marks,
    raw,
    clusters: clusters.length,
    biggest: clusters.reduce((a, m) => Math.max(a, m.count), 0),
  };
});

const markR = (count: number) => (count > 1 ? 9 + 3 * Math.log2(count) : 4);

const clusterLabel = computed(() => {
  const v = clusterView.value;
  if (!v) return 'Кластеры ещё не собраны.';
  return `Окно ${W} на ${H} над центром Москвы, уровень ${cz.value}: точек в окне ${v.raw}, меток ${v.marks.length}, из них кластеров ${v.clusters}.`;
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div v-if="mode === 'tiles'" class="ml-tools">
        <SegmentedControl :model-value="cityName" class="l-pills" label="Город" :options="cityOptions" @update:model-value="pickCity" />
        <div class="ml-actions">
          <Button variant="secondary" :disabled="z <= 0" @click="zoomBy(-1)">отдалить</Button>
          <Button variant="secondary" :disabled="z >= 18" @click="zoomBy(1)">приблизить</Button>
          <Button variant="secondary" @click="pan(-STEP)">← {{ STEP }} px</Button>
          <Button variant="secondary" @click="pan(STEP)">{{ STEP }} px →</Button>
        </div>
      </div>
      <div v-else class="ml-tools">
        <Button variant="primary" :disabled="!!levels" @click="build">собрать кластеры</Button>
        <SegmentedControl v-if="levels" v-model="cz" class="l-pills" label="Уровень" :options="zoomOptions" />
      </div>
    </template>

    <div class="ml-body">
      <template v-if="mode === 'tiles'">
        <div class="ml-scroll">
          <svg class="ml-view" :viewBox="`0 0 ${W} ${H}`" role="img" :aria-label="tilesLabel">
            <rect class="ml-void" x="0" y="0" :width="W" :height="H" />
            <rect class="ml-world" x="0" :y="Math.max(0, worldTop)" :width="W" :height="Math.max(0, Math.min(H, worldTop + size) - Math.max(0, worldTop))" />
            <g v-for="t in drawn" :key="t.key">
              <rect class="ml-tile" :class="{ 'ml-tile--new': t.isNew }" :x="t.left" :y="t.top" :width="TILE" :height="TILE" />
              <text v-if="t.labeled" class="ml-tile-label" :x="t.lx" :y="t.ly">{{ t.z }}/{{ t.x }}/{{ t.y }}</text>
            </g>
            <circle v-if="cityOnScreen" class="ml-city" :cx="cityOnScreen.x" :cy="cityOnScreen.y" r="7" />
          </svg>
        </div>

        <div class="ml-facts">
          <div class="ml-fact"><span>уровень</span><b>{{ z }}</b></div>
          <div class="ml-fact"><span>тайл города</span><b>{{ hit ? `${hit.z}/${hit.x}/${hit.y}` : '—' }}</b></div>
          <div class="ml-fact"><span>пиксель в тайле</span><b>{{ hit ? `${hit.px}, ${hit.py}` : '—' }}</b></div>
          <div class="ml-fact"><span>метров в пикселе</span><b>{{ fmt(mpp) }}</b></div>
          <div class="ml-fact"><span>мест под тайлы в окне</span><b>{{ tiles.length }}</b></div>
          <div class="ml-fact"><span>разных адресов</span><b>{{ uniqueRequests(tiles) }}</b></div>
          <div class="ml-fact" data-tone="info"><span>новых: {{ lastAction }}</span><b>{{ fresh.size }}</b></div>
          <div class="ml-fact" data-tone="ok"><span>запросов с памятью</span><b>{{ seen.size }}</b></div>
          <div class="ml-fact" data-tone="warn"><span>без памяти</span><b>{{ withoutMemory }}</b></div>
        </div>
        <p class="ml-url"><span>адрес тайла города</span><code>{{ url }}</code></p>
      </template>

      <template v-else>
        <div class="ml-scroll">
          <svg class="ml-view" :viewBox="`0 0 ${W} ${H}`" role="img" :aria-label="clusterLabel">
            <rect class="ml-world" x="0" y="0" :width="W" :height="H" />
            <template v-if="clusterView">
              <g v-for="m in clusterView.marks" :key="m.key">
                <circle class="ml-mark" :class="{ 'ml-mark--cluster': m.count > 1 }" :cx="m.sx" :cy="m.sy" :r="markR(m.count)" />
                <text v-if="m.count > 1" class="ml-mark-label" :x="m.sx" :y="m.sy" text-anchor="middle" dominant-baseline="central">{{ m.count }}</text>
              </g>
            </template>
            <text v-else class="ml-empty" :x="W / 2" :y="H / 2" text-anchor="middle">кластеры собираются по кнопке</text>
          </svg>
        </div>

        <div v-if="clusterView" class="ml-facts">
          <div class="ml-fact"><span>уровень</span><b>{{ cz }}</b></div>
          <div class="ml-fact"><span>точек в окне</span><b>{{ clusterView.raw }}</b></div>
          <div class="ml-fact" data-tone="ok"><span>меток на экране</span><b>{{ clusterView.marks.length }}</b></div>
          <div class="ml-fact"><span>из них кластеров</span><b>{{ clusterView.clusters }}</b></div>
          <div class="ml-fact"><span>самый крупный</span><b>{{ clusterView.biggest || '—' }}</b></div>
        </div>
      </template>

      <Md class="ml-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.ml-tools {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 16px;
}
.ml-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.ml-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
/* Окно не ужимается ниже ширины viewBox: подписи плиток иначе мельчают в два раза. На узком
   экране оно прокручивается в своей рамке, как широкая таблица. */
.ml-scroll {
  overflow-x: auto;
  border-radius: var(--r3);
}
.ml-view {
  /* Без явной заливки корень SVG красится чёрным по умолчанию — цвет мимо theme.ts. */
  fill: var(--ink);
  display: block;
  width: 100%;
  min-width: 640px;
  height: auto;
  aspect-ratio: 640 / 400;
}
.ml-void {
  fill: var(--surface-3);
}
.ml-world {
  fill: var(--surface-2);
}
.ml-tile {
  fill: none;
  stroke: var(--border-strong);
  stroke-width: 1;
}
.ml-tile--new {
  fill: var(--tone-info-bg);
  stroke: var(--tone-info-strong);
}
.ml-tile-label {
  font-family: var(--mono);
  font-size: var(--fs-3);
  fill: var(--text-muted);
}
.ml-city {
  fill: var(--tone-err-strong);
  stroke: var(--surface);
  stroke-width: 2;
}
.ml-mark {
  fill: var(--text-muted);
}
.ml-mark--cluster {
  fill: var(--tone-info-bg);
  stroke: var(--tone-info-strong);
  stroke-width: 1.5;
}
.ml-mark-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  fill: var(--ink);
}
.ml-empty {
  font-family: var(--mono);
  font-size: var(--fs-3);
  fill: var(--text-muted);
}

.ml-facts {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 8px;
}
.ml-fact {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border-radius: var(--r2);
  background: var(--surface-2);
  color: var(--prose);
  font-size: var(--fs-3);
}
.ml-fact span {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.ml-fact b {
  font-family: var(--mono);
  font-size: var(--fs-4);
  font-weight: 500;
  color: var(--ink);
}
.ml-fact[data-tone='info'] {
  background: var(--tone-info-bg);
}
.ml-fact[data-tone='ok'] {
  background: var(--tone-ok-bg);
}
.ml-fact[data-tone='warn'] {
  background: var(--tone-warn-bg);
}
.ml-url {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
  align-items: baseline;
  margin: 0;
  font-size: var(--fs-3);
  color: var(--prose);
}
.ml-url span {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.ml-url code {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
  overflow-wrap: anywhere;
  color: var(--ink);
}
.ml-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.ml-caption :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
</style>
