<script setup lang="ts">
/**
 * Граф объектов рядом с деревом доминаторов — центральное демо урока.
 *
 * В оригинале retained size и доминатор объяснены только словами, и из-за этого главное
 * свойство величины остаётся невидимым: retained size считается ПО ДОМИНАТОРАМ, а не «по
 * всему, до чего можно дойти». Стоит появиться второму пути к массиву — и байты перестают
 * принадлежать замыканию, хотя под ним висит ровно то же самое.
 *
 * Поэтому здесь один переключатель на два состояния графа. Слева видно ребро, которое
 * добавилось; справа — как от этого обрушился столбец Retained. Это же чинит арифметику
 * «лестницы»: разница между ступенями равна shallow вышестоящего только пока цепочка
 * не ветвится, а на развилке падает скачком.
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import { SegmentedControl } from '@/shared/ui';
import type { HeapNode, HeapVariant } from '../model/types';

const props = defineProps<{ nodes: HeapNode[]; variants: HeapVariant[] }>();

const picked = ref('0');
const current = computed(() => props.variants[Number(picked.value)]);
const options = computed(() => props.variants.map((v, i) => ({ value: String(i), label: v.label })));

/**
 * Геометрия — здесь, а не в данных: это раскладка картинки, а не содержание урока.
 * Цепочка идёт колонкой, второй путь уходит влево в обход середины.
 */
const LAYOUT = [
  { id: 'window', y: 10, edge: 'context' },
  { id: 'closure', y: 76, edge: 'context' },
  { id: 'context', y: 142, edge: 'слот rows' },
  { id: 'array', y: 208, edge: 'elements' },
  { id: 'elements', y: 274, edge: '× 500 000' },
  { id: 'objects', y: 340, edge: '' },
];
const BOX = { x: 120, w: 180, h: 44 };

const byId = computed(() => new Map(props.nodes.map((n) => [n.id, n])));

const boxes = computed(() =>
  LAYOUT.map((slot) => {
    const node = byId.value.get(slot.id);
    const owned = current.value.ownedByClosure.includes(slot.id);
    return {
      ...slot,
      label: node?.label ?? slot.id,
      shallow: node?.shallow ?? '',
      // Корень — чернилами; остальное красится тем, кто эти байты доминирует.
      own: slot.id === 'window' ? 'root' : owned ? 'closure' : 'loose',
    };
  }),
);

/** Рёбра цепочки: от низа одного узла к верху следующего. */
const wires = computed(() =>
  LAYOUT.slice(0, -1).map((slot, i) => ({
    key: slot.id,
    y1: slot.y + BOX.h,
    y2: LAYOUT[i + 1].y,
    label: slot.edge,
  })),
);
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="bar">
        <span class="bar__label">путей к массиву:</span>
        <SegmentedControl v-model="picked" class="l-pills" label="Число путей к массиву" :options="options" />
      </div>
    </template>

    <div class="split">
      <div class="pane">
        <div class="t-label">граф объектов · ссылки направлены вниз</div>

        <div class="scroll">
          <svg viewBox="0 0 380 400" role="img" :aria-label="`Граф объектов: ${current.label}`" class="graph">
            <title>{{ `Граф объектов: ${current.label}` }}</title>

            <!-- Рёбра цепочки. -->
            <template v-for="wire in wires" :key="wire.key">
              <line class="wire" x1="210" :y1="wire.y1" x2="210" :y2="wire.y2" />
              <text v-if="wire.label" class="wire-label" x="216" :y="(wire.y1 + wire.y2) / 2 + 3">
                {{ wire.label }}
              </text>
            </template>

            <!-- Второй путь: от корня прямо к массиву, в обход замыкания и контекста. -->
            <template v-if="current.secondPath">
              <path class="wire wire--second" d="M 150 54 C 56 84, 56 186, 116 226" />
              <text class="wire-label wire-label--second" x="20" y="146">rowsAlso</text>
            </template>

            <template v-for="box in boxes" :key="box.id">
              <rect class="box" :data-own="box.own" :x="BOX.x" :y="box.y" :width="BOX.w" :height="BOX.h" rx="5" />
              <text class="name" :data-own="box.own" :x="BOX.x + 13" :y="box.y + 19">{{ box.label }}</text>
              <text class="sub" :data-own="box.own" :x="BOX.x + 13" :y="box.y + 34">{{ box.shallow }}</text>
            </template>
          </svg>
        </div>

        <div class="legend">
          <span class="key key--closure"></span> держит замыкание
          <span class="key key--loose"></span> держит корень
        </div>
      </div>

      <div class="pane pane--right">
        <div class="t-label">панель Summary · столбец Retained</div>

        <div class="scroll">
          <table class="ladder">
            <thead>
              <tr>
                <th>Constructor</th>
                <th class="num">Dist</th>
                <th class="num">Shallow</th>
                <th class="num num--hero">Retained</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in current.rows" :key="row.c">
                <td class="c" :data-hot="row.hot ? 'yes' : 'no'">{{ '  '.repeat(row.depth) + row.c }}</td>
                <td class="num dim">{{ row.dist }}</td>
                <td class="num dim">{{ row.shallow }}</td>
                <td class="num ret" :data-hot="row.hot ? 'yes' : 'no'">{{ row.retained }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="field">
          <div class="t-label">кому приписаны байты массива</div>
          <div class="dominator" :data-tone="current.tone">{{ current.dominator }}</div>
        </div>

        <div class="verdict" :data-tone="current.tone">{{ current.verdict }}</div>
        <div class="note">{{ current.note }}</div>
      </div>
    </div>
  </DemoFrame>
</template>

<style scoped>
.bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.bar__label {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}

.split {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr));
}
.pane {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px;
  border-right: 1px solid var(--divider);
  /* Внутри флекс-колонки элемент не сжимается ниже содержимого: без этого широкая
     картинка и широкая таблица утаскивают вбок всю страницу. */
  min-width: 0;
}
.pane--right {
  gap: 14px;
  border-right: 0;
  background: var(--surface-2);
}

.scroll {
  min-width: 0;
  overflow-x: auto;
}

.graph {
  display: block;
  width: 100%;
  min-width: 340px;
  height: auto;
  /* У корневого svg заливка иначе браузерная чёрная — цвета, которого в курсе нет. */
  fill: none;
}

.box {
  fill: var(--surface);
  stroke: var(--border);
  stroke-width: 1;
  transition: all 0.2s;
}
.box[data-own='root'] {
  fill: var(--ink);
  stroke: var(--ink);
}
.box[data-own='closure'] {
  fill: var(--tone-info-bg);
  stroke: var(--tone-info-line);
}
.box[data-own='loose'] {
  fill: var(--tone-warn-bg);
  stroke: var(--tone-warn-line);
}

.name {
  font-family: var(--mono);
  font-size: var(--fs-2);
  font-weight: 600;
  fill: var(--ink);
}
.name[data-own='root'] {
  fill: var(--on-ink);
}
.name[data-own='closure'] {
  fill: var(--tone-info-strong);
}
.name[data-own='loose'] {
  fill: var(--tone-warn-strong);
}
.sub {
  font-family: var(--mono);
  font-size: var(--fs-1);
  fill: var(--text-faint);
}
.sub[data-own='root'] {
  fill: var(--ink-faint);
}

.wire {
  stroke: var(--hairline);
  stroke-width: 1;
}
.wire--second {
  stroke: var(--tone-warn-accent);
  stroke-width: 1.5;
  stroke-dasharray: 4 3;
}
.wire-label {
  font-family: var(--mono);
  font-size: var(--fs-1);
  fill: var(--dim);
}
.wire-label--second {
  fill: var(--tone-warn-strong);
}

.legend {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}
.key {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: var(--r1);
  margin-left: 6px;
}
.key--closure {
  border: 1px solid var(--tone-info-line);
  background: var(--tone-info-bg);
}
.key--loose {
  border: 1px solid var(--tone-warn-line);
  background: var(--tone-warn-bg);
}

.ladder {
  width: 100%;
  min-width: 330px;
  border-collapse: collapse;
  background: var(--surface);
}
.ladder thead tr {
  background: var(--ink);
}
.ladder th {
  padding: 8px 10px;
  font-family: var(--mono);
  font-size: var(--fs-2);
  font-weight: 400;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  text-align: start;
  color: var(--on-ink);
}
.ladder th.num {
  text-align: end;
}
.ladder th.num--hero {
  color: var(--tone-info-on-ink);
}
.ladder tbody tr {
  border-bottom: 1px solid var(--rule);
}
.ladder tbody tr:last-child {
  border-bottom: 0;
}
.ladder td {
  padding: 10px;
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--ink);
}
.ladder td.num {
  text-align: end;
}
.ladder td.dim {
  color: var(--text-muted);
}
.ladder .c {
  white-space: pre;
}
.ladder .ret {
  font-weight: 600;
  color: var(--tone-warn-strong);
}
.ladder [data-hot='yes'] {
  font-weight: 600;
  color: var(--tone-err-strong);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.dominator {
  padding: 11px 13px;
  border-radius: var(--r2);
  font-family: var(--mono);
  font-size: var(--fs-4);
  transition: all 0.2s;
}
.dominator[data-tone='ok'] {
  border: 1px solid var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-strong);
}
.dominator[data-tone='warn'] {
  border: 1px solid var(--tone-warn-line);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-strong);
}

.verdict {
  padding: 13px 15px;
  border-radius: var(--r2);
  font-size: var(--fs-6);
  line-height: 1.6;
  transition: all 0.2s;
}
.verdict[data-tone='ok'] {
  border: 1px solid var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.verdict[data-tone='warn'] {
  border: 1px solid var(--tone-warn-line);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}

.note {
  font-size: var(--fs-6);
  line-height: 1.6;
  color: var(--prose);
}
</style>
