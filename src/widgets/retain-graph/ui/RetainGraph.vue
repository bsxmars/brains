<script setup lang="ts">
/**
 * Удержание и путь удержания, посчитанные на настоящем графе объектов.
 *
 * Зачем так. Столбец Retained, набранный в таблице руками, доказывает ровно одно: автор умеет
 * складывать. Читателю же обещано другое — что байты принадлежат доминатору, а не тому, до кого
 * можно дойти, — и проверить это обещание можно только пересчётом. Здесь в памяти строится
 * настоящая структура (массив настоящих объектов, `Map`, функции с замыканиями), обход
 * спрашивает о ней движок отражением, а переключатель «путей к массиву» добавляет настоящее
 * поле настоящему объекту. Столбец после этого не выбирается из второй таблицы — он считается
 * заново, и обрушение retained size у замыкания становится результатом, а не иллюстрацией.
 *
 * ⚠️ **Чего здесь нет и быть не может.**
 *
 *   `sizeof` в JS нет            собственный размер объекта из кода не узнать никогда. Все байты
 *                                на этой панели ОБЪЯВЛЕНЫ числами из замера урока (Node 24.11,
 *                                без сжатия указателей). Посчитано здесь не «сколько байт»,
 *                                а «кому они принадлежат» — и вот это посчитано честно;
 *   слоты замыкания              из JS не интроспектируются ничем. `system / Context` — объект
 *                                модели, и в графе он помечен как объявленный, а не найденный;
 *   `(object elements)`          служебный узел V8: в снимке кучи он есть, из JS не виден;
 *   содержимое `WeakMap`         неперечислимо по определению — ни ключей, ни `size`,
 *                                ни итератора. Путь удержания через слабую коллекцию не строит
 *                                ни этот обход, ни любой другой код на странице. Доказательство
 *                                посчитано и лежит в подвале.
 *
 * ⚠️ **Сцена строится по нажатию, а не сама.** Полмиллиона настоящих объектов — это примерно
 * 20 МБ, и создаются они только тогда, когда читатель об этом попросил. Почему не в `setup` —
 * у самой переменной ниже. Это тот самый пример урока: сняв снимок кучи после построения,
 * его видно целиком. Нужно легче — проп `rows`; структура графа от числа не зависит,
 * зависят только байты.
 *
 * Считают `model/graph.ts`, `model/retain.ts` и `model/path.ts` — те же модули зовёт юнит-тест.
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button, SegmentedControl } from '@/shared/ui';
import { buildGraph, edgeBetween } from '../model/graph';
import { allPaths, repairProbe, shortestPath } from '../model/path';
import { ladder, reachable, retainedBy, weigh } from '../model/retain';
import { DEFAULT_ROWS, applyVariant, makeScene, weakProbe } from '../model/scene';
import type { Scene } from '../model/scene';
import type { ObjectGraph, ProbeCut } from '../model/types';

const props = withDefaults(
  defineProps<{
    /** Сколько настоящих объектов создать в массиве. */
    rows?: number;
    note?: string;
  }>(),
  {
    rows: DEFAULT_ROWS,
    note: 'Посчитано на этой странице: кому принадлежат байты, сколько путей ведёт к объекту и что освободит каждый разрыв. Объявлено, а не измерено: сами байты — `sizeof` в JS нет, собственный вес объекта из кода не узнать никогда. Числа весов взяты из замера урока на Node 24.11 без сжатия указателей; в Chrome те же структуры примерно вдвое легче.',
  },
);

/**
 * Сцена лежит обычной переменной и строится по явному действию читателя.
 *
 * ⚠️ **Почему не в теле `setup`.** Всё, что исполняется в теле компонента острова, исполняется
 * и в Node: остров сперва рендерится в разметку. Полмиллиона объектов в `setup` означали бы, что
 * за виджет платит каждая сборка — двадцатью мегабайтами и временем, ради разметки, в которой
 * этих объектов даже не видно. Вторая половина той же беды на стороне читателя: остров
 * гидратируется по `client:visible`, то есть в момент прокрутки, и память уходила бы до того,
 * как он что-нибудь нажал. Так же и по той же причине устроены `widgets/ic-bench`
 * и `widgets/yield-meter`: тяжёлое начинается с кнопки.
 *
 * ⚠️ **И не `ref`.** Реактивная обёртка над полумиллионом объектов — это не «медленно», это
 * не запустится вовсе: `ref` обернул бы каждый из них в прокси. Поэтому реактивен только
 * счётчик построений — он же флаг «сцена есть», он же ключ пересчёта графа.
 */
let scene: Scene | null = null;
const built = ref(0);
const building = ref(false);

/**
 * Отдать браузеру кадр, чтобы надпись «строю сцену» успела нарисоваться.
 *
 * Одного `requestAnimationFrame` мало: он зовёт обратно ПЕРЕД отрисовкой, и выделение памяти
 * заняло бы поток раньше, чем кадр доедет до экрана. Поэтому кадр, а следом ноль таймера.
 */
const paint = () =>
  new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(resolve, 0));
    else setTimeout(resolve, 0);
  });

/**
 * Построить сцену заново.
 *
 * Именно заново, а не поверх прежней: повторное нажатие обязано давать тот же ответ, а не ответ,
 * накопленный предыдущими прогонами. Прежняя сцена отпускается до выделения новой — иначе
 * в пике в куче лежали бы обе.
 */
const build = async () => {
  if (building.value) return;
  building.value = true;
  scene = null;
  built.value = 0;
  await paint();
  scene = makeScene({ rows: props.rows });
  built.value += 1;
  building.value = false;
};

const VARIANTS = [
  { value: '0', label: 'один путь' },
  { value: '1', label: 'есть второй путь' },
];
const VIEWS = [
  { value: 'retain', label: 'удержание' },
  { value: 'path', label: 'путь удержания' },
  { value: 'repair', label: 'критерий починки' },
];

const variant = ref('0');
const view = ref('retain');
const target = ref('canvas');

const second = computed(() => variant.value === '1');
/** Пока сцены нет, графа нет тоже — и ни одного числа на панели не появляется. */
const graph = computed(() => (built.value && scene ? buildGraph(applyVariant(scene, second.value)) : null));

const ladderRows = computed(() => (graph.value ? ladder(graph.value) : []));
const total = computed(() => (graph.value ? weigh(graph.value, reachable(graph.value)) : null));

const held = computed(() => (graph.value ? retainedBy(graph.value, 'held') : null));
const array = computed(() => (graph.value ? retainedBy(graph.value, 'rows') : null));
const arrayRow = computed(() => ladderRows.value.find((row) => row.id === 'rows') ?? null);

const num = (value: number) => value.toLocaleString('ru-RU');

/** Подпись столбца Shallow: у группы — вес одного объекта на их число. */
const shallowOf = (per: number, count: number, shallow: number) =>
  count > 1 ? `${num(per)} × ${num(count)}` : num(shallow);

/** Рёбра как их назвал обход — левая колонка демо. */
const wires = computed(() => {
  const item = graph.value;
  if (!item) return [];
  return item.edges.map((edge) => ({
    id: edge.id,
    label: edge.label,
    origin: edge.origin,
    to: item.nodes.find((node) => node.id === edge.to)?.label ?? edge.to,
  }));
});

const TARGETS = [
  { id: 'canvas', label: 'оторванный узел' },
  { id: 'rows', label: 'массив' },
  { id: 'chart', label: 'Chart' },
];

const path = computed(() => (graph.value ? shortestPath(graph.value, target.value) : []));
const routes = computed(() => (graph.value ? allPaths(graph.value, target.value) : []));

/** Разрывы, названные по концам ребра: в графе имя ссылки собирает обход, а не автор. */
const cutsFor = (item: ObjectGraph, pairs: [string, string, string][]): ProbeCut[] =>
  pairs
    .map(([from, to, what]) => {
      const edge = edgeBetween(item, from, to);
      return edge ? { edge: edge.id, what } : null;
    })
    .filter((cut): cut is ProbeCut => cut !== null);

const canvasProbe = computed(() => {
  const item = graph.value;
  if (!item) return [];
  return repairProbe(
    item,
    'canvas',
    cutsFor(item, [
      ['registry', 'chart', 'убрать запись из Map'],
      ['listeners-elements', 'on-resize', 'снять подписку'],
    ]),
  );
});

const arrayProbe = computed(() => {
  const item = graph.value;
  if (!item) return [];
  return repairProbe(
    item,
    'rows',
    cutsFor(item, [
      ['held-context', 'rows', 'обнулить замыкание'],
      ['root', 'rows', 'убрать вторую ссылку'],
    ]),
  );
});

const weak = computed(() => (built.value && scene ? weakProbe(scene) : null));

const weakNote = computed(() => {
  const probe = weak.value;
  if (!probe) return '';
  return `Слабая коллекция в сцене есть, и в ней лежит тот же \`Chart\`. Обход её не прошёл — и не мог: \`Object.keys\` отдаёт ${probe.keys} ключей, \`size\` ${probe.hasSize ? 'есть' : 'нет'}, итератора ${probe.iterable ? 'есть' : 'нет'}. Спросить можно ровно одно — «этот ключ там есть?», и только держа ключ в руках: \`weak.has(chart)\` → ${probe.hasEntry}. Поэтому путь удержания через \`WeakMap\` невидим в принципе, а не в этом демо.`;
});

const verdict = computed(() => {
  const closure = held.value;
  const list = array.value;
  if (!closure || !list) return '';
  return second.value
    ? `У массива два держателя, и байты уехали к общему доминатору — ${arrayRow.value?.dominator ?? '—'}. Retained size замыкания: ${num(closure.bytes)} Б вместо ${num(closure.bytes + list.bytes)} Б, хотя под ним висят ровно те же объекты.`
    : `Замыкание — единственный путь ко всей цепочке: ${num(closure.bytes)} Б, ${num(closure.objects)} настоящих объектов. Уберите его — освободится всё это.`;
});

/** Что написано на панели до нажатия. Ни одного числа, которого мы ещё не считали. */
const emptyNote = computed(
  () =>
    `По нажатию в памяти этой вкладки появится настоящая структура — массив на ${num(props.rows)} объектов, \`Map\`, \`WeakMap\` и функции с замыканиями, — и все числа дальше посчитает обход по ней.`,
);
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="rg-bar">
        <Button variant="primary" :disabled="building" @click="build">
          {{ building ? 'строю…' : built ? 'построить заново' : 'построить сцену' }}
        </Button>
        <span v-if="building" class="rg-phase">выделяю объекты…</span>
        <span v-else-if="!built" class="rg-phase">числа появятся после построения — их считает эта вкладка</span>
        <template v-else>
          <span class="rg-bar__label">путей к массиву:</span>
          <SegmentedControl v-model="variant" class="l-pills" label="Число путей к массиву" :options="VARIANTS" />
          <span class="rg-bar__label">смотрим:</span>
          <SegmentedControl v-model="view" class="l-pills" label="Что показать" :options="VIEWS" />
        </template>
      </div>
    </template>

    <div v-if="graph" class="rg-split">
      <div class="rg-pane">
        <div class="t-label">ссылки, найденные обходом · имя ссылки собрано на месте</div>

        <div class="rg-scroll">
          <ul class="rg-wires">
            <li v-for="wire in wires" :key="wire.id" class="rg-wire">
              <span class="rg-wire__name" :data-origin="wire.origin">{{ wire.label }}</span>
              <span class="rg-wire__to">{{ wire.to }}</span>
            </li>
          </ul>
        </div>

        <div v-for="item in graph.opaque" :key="item.from" class="rg-opaque">
          <div class="rg-opaque__head">{{ item.ref }} — сквозь неё обход не идёт</div>
          <Md class="rg-opaque__why" :text="item.why" />
        </div>

        <div class="rg-legend">
          <span class="rg-dot rg-dot--engine"></span> спрошено у движка
          <span class="rg-dot rg-dot--declared"></span> объявлено моделью
        </div>
      </div>

      <div class="rg-pane rg-pane--right">
        <template v-if="view === 'retain'">
          <div class="t-label">дерево доминирования · столбец Retained посчитан</div>

          <div class="rg-scroll">
            <table class="rg-table">
              <thead>
                <tr>
                  <th>Узел</th>
                  <th class="rg-num">Dist</th>
                  <th class="rg-num">Shallow</th>
                  <th class="rg-num rg-num--hero">Retained</th>
                  <th class="rg-num">Ссылок</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in ladderRows" :key="row.id" :data-hot="row.id === 'held' ? 'yes' : 'no'">
                  <td class="rg-cell" :data-origin="row.origin">{{ '  '.repeat(row.depth) + row.label }}</td>
                  <td class="rg-num rg-dim">{{ row.distance }}</td>
                  <td class="rg-num rg-dim">{{ shallowOf(row.per, row.count, row.shallow) }}</td>
                  <td class="rg-num rg-ret">{{ num(row.retained.bytes) }}</td>
                  <td class="rg-num" :data-fork="row.retainers > 1 ? 'yes' : 'no'">{{ row.retainers }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="rg-field">
            <div class="t-label">правило «лестницы»: разница ступеней равна весу вышестоящего</div>
            <ul class="rg-rungs">
              <li v-for="row in ladderRows.filter((r) => r.depth > 0)" :key="row.id" class="rg-rung" :data-holds="row.ladderHolds">
                <span class="rg-rung__label">{{ row.label }}</span>
                <span class="rg-rung__gap">{{ num(row.gap) }}</span>
                <span class="rg-rung__verdict">{{ row.ladderHolds ? 'совпало' : 'развилка' }}</span>
              </li>
            </ul>
          </div>

          <div class="rg-verdict" :data-tone="second ? 'warn' : 'ok'">{{ verdict }}</div>
        </template>

        <template v-else-if="view === 'path'">
          <div class="rg-bar">
            <span class="rg-bar__label">до кого:</span>
            <SegmentedControl v-model="target" class="l-pills" label="Цель пути удержания" :options="TARGETS.map((t) => ({ value: t.id, label: t.label }))" />
          </div>

          <div class="t-label">кратчайший путь · так его показывает панель Retainers</div>

          <div class="rg-scroll">
            <div class="rg-chain">
              <div
                v-for="(step, i) in [...path].reverse()"
                :key="step.id"
                class="rg-link"
                :data-origin="step.origin"
                :style="`margin-left:${i * 14}px`"
              >
                <span v-if="i" class="rg-link__tree">└─</span>
                <!-- У корня входящего ребра нет: последняя строка цепочки — его собственное имя. -->
                <span class="rg-link__name">{{ i ? step.edge || step.label : step.label }}</span>
                <span v-if="i && step.edge" class="rg-link__what">{{ step.label }}</span>
              </div>
            </div>
          </div>

          <div class="rg-field">
            <div class="t-label">а всего путей — {{ routes.length }}</div>
            <ul class="rg-routes">
              <li v-for="(route, i) in routes" :key="i" class="rg-route">
                {{ route.map((step, n) => (n ? step.edge : step.label)).join('  ›  ') }}
              </li>
            </ul>
          </div>

          <div class="rg-verdict" :data-tone="routes.length > 1 ? 'warn' : 'ok'">
            {{
              routes.length > 1
                ? `Панель показывает один путь из ${routes.length}. Разорвать показанный — значит не освободить ничего: остальные держат объект по-прежнему.`
                : 'Путь один: этот разрыв освободит объект целиком.'
            }}
          </div>
        </template>

        <template v-else>
          <div class="t-label">критерий починки — ноль · рвём ссылки по одной</div>

          <div class="rg-probe">
            <div class="rg-probe__head">оторванный узел: его держат Map и список слушателей</div>
            <div v-for="(step, i) in canvasProbe" :key="i" class="rg-step" :data-tone="step.reachable ? 'warn' : 'ok'">
              <span class="rg-step__cut">{{ step.cutLabel }}</span>
              <span class="rg-step__what">{{ step.what }}</span>
              <span class="rg-step__freed">{{ num(step.freed.bytes) }} Б</span>
              <span class="rg-step__verdict">{{ step.reachable ? 'всё ещё достижим' : 'исчез' }}</span>
            </div>
          </div>

          <div class="rg-probe">
            <div class="rg-probe__head">массив: {{ second ? 'держателей двое' : 'держатель один' }}</div>
            <div v-for="(step, i) in arrayProbe" :key="i" class="rg-step" :data-tone="step.reachable ? 'warn' : 'ok'">
              <span class="rg-step__cut">{{ step.cutLabel }}</span>
              <span class="rg-step__what">{{ step.what }}</span>
              <span class="rg-step__freed">{{ num(step.freed.bytes) }} Б</span>
              <span class="rg-step__verdict">{{ step.reachable ? 'всё ещё достижим' : 'исчез' }}</span>
            </div>
          </div>

          <div class="rg-verdict" data-tone="warn">
            Живого в графе: {{ num(total?.bytes ?? 0) }} Б, {{ num(total?.objects ?? 0) }} настоящих объектов. Пока у объекта
            остаётся хоть один держатель, освобождается ровно ноль — «стало лучше» здесь не бывает.
          </div>
        </template>
      </div>
    </div>

    <!-- До нажатия — ни одного числа: считать пока нечего, и выдумывать демо не станет. -->
    <div v-else class="rg-empty">
      <div class="rg-empty__head">сцены ещё нет</div>
      <Md class="rg-empty__body" :text="emptyNote" />
    </div>

    <template #footer>
      <div class="rg-foot">
        <Md class="rg-foot__line" :text="note" />
        <Md v-if="weakNote" class="rg-foot__line" :text="weakNote" />
      </div>
    </template>
  </DemoFrame>
</template>

<style scoped>
.rg-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.rg-bar__label {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}

.rg-split {
  display: grid;
  grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.15fr);
}
.rg-pane {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px;
  border-right: 1px solid var(--divider);
  min-width: 0;
}
.rg-pane--right {
  gap: 14px;
  border-right: 0;
  background: var(--surface-2);
}

.rg-scroll {
  min-width: 0;
  overflow-x: auto;
}

.rg-wires {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.rg-wire {
  display: flex;
  align-items: baseline;
  gap: 8px;
  white-space: nowrap;
}
.rg-wire__name {
  padding: 3px 8px;
  border: 1px solid var(--tone-info-line);
  border-radius: var(--r1);
  background: var(--tone-info-bg);
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--tone-info-strong);
}
.rg-wire__name[data-origin='declared'] {
  border-color: var(--tone-warn-line);
  border-style: dashed;
  background: var(--tone-warn-bg);
  color: var(--tone-warn-strong);
}
.rg-wire__to {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}

.rg-opaque {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 11px 13px;
  border: 1px solid var(--divider);
  border-radius: var(--r2);
  background: var(--sunk-dim);
}
.rg-opaque__head {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
}
.rg-opaque__why {
  font-size: var(--fs-4);
  line-height: 1.5;
  color: var(--text-muted);
}

.rg-legend {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}
.rg-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: var(--r1);
  margin-left: 6px;
}
.rg-dot--engine {
  border: 1px solid var(--tone-info-line);
  background: var(--tone-info-bg);
}
.rg-dot--declared {
  border: 1px dashed var(--tone-warn-line);
  background: var(--tone-warn-bg);
}

.rg-table {
  width: 100%;
  min-width: 340px;
  border-collapse: collapse;
  background: var(--surface);
}
.rg-table thead tr {
  background: var(--ink);
}
.rg-table th {
  padding: 8px 10px;
  font-family: var(--mono);
  font-size: var(--fs-2);
  font-weight: 400;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  text-align: start;
  color: var(--on-ink);
}
.rg-table th.rg-num {
  text-align: end;
}
.rg-table th.rg-num--hero {
  color: var(--tone-info-on-ink);
}
.rg-table tbody tr {
  border-bottom: 1px solid var(--rule);
}
.rg-table tbody tr:last-child {
  border-bottom: 0;
}
.rg-table td {
  padding: 9px 10px;
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--ink);
}
.rg-cell {
  white-space: pre;
}
.rg-cell[data-origin='declared'] {
  font-style: italic;
  color: var(--tone-warn-strong);
}
.rg-num {
  text-align: end;
  white-space: nowrap;
}
.rg-dim {
  color: var(--text-muted);
}
.rg-ret {
  font-weight: 600;
  color: var(--tone-info-strong);
}
.rg-table tr[data-hot='yes'] .rg-ret {
  color: var(--tone-err-strong);
}
.rg-num[data-fork='yes'] {
  font-weight: 600;
  color: var(--tone-warn-strong);
}

.rg-field {
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-width: 0;
}

.rg-rungs {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.rg-rung {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 10px;
  align-items: baseline;
  padding: 6px 10px;
  border-radius: var(--r1);
  background: var(--surface);
  font-family: var(--mono);
  font-size: var(--fs-2);
}
.rg-rung__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-muted);
}
.rg-rung__gap {
  color: var(--ink);
}
.rg-rung__verdict {
  color: var(--dim);
}
.rg-rung[data-holds='true'] .rg-rung__verdict {
  color: var(--tone-ok-strong);
}
.rg-rung[data-holds='false'] .rg-rung__verdict {
  color: var(--tone-warn-strong);
}

.rg-chain {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.rg-link {
  display: flex;
  align-items: baseline;
  gap: 7px;
  padding: 7px 11px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--surface);
  white-space: nowrap;
}
.rg-link[data-origin='declared'] {
  border-style: dashed;
  border-color: var(--tone-warn-line);
  background: var(--tone-warn-bg);
}
.rg-link__tree {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--ghost);
}
.rg-link__name {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
}
.rg-link__what {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}

.rg-routes {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.rg-route {
  padding: 7px 10px;
  border-radius: var(--r1);
  background: var(--surface);
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.5;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

.rg-probe {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}
.rg-probe__head {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-faint);
}
.rg-step {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr) auto auto;
  gap: 10px;
  align-items: baseline;
  padding: 8px 11px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--surface);
  font-family: var(--mono);
  font-size: var(--fs-2);
}
.rg-step[data-tone='warn'] {
  border-color: var(--tone-warn-line);
  background: var(--tone-warn-bg);
}
.rg-step[data-tone='ok'] {
  border-color: var(--tone-ok-line);
  background: var(--tone-ok-bg);
}
.rg-step__cut {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ink);
}
.rg-step__what {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-muted);
}
.rg-step__freed {
  font-weight: 600;
  white-space: nowrap;
  color: var(--ink);
}
.rg-step__verdict {
  white-space: nowrap;
}
.rg-step[data-tone='warn'] .rg-step__verdict {
  color: var(--tone-warn-strong);
}
.rg-step[data-tone='ok'] .rg-step__verdict {
  color: var(--tone-ok-strong);
}

.rg-verdict {
  padding: 12px 14px;
  border-radius: var(--r2);
  font-size: var(--fs-5);
  line-height: 1.6;
}
.rg-verdict[data-tone='ok'] {
  border: 1px solid var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.rg-verdict[data-tone='warn'] {
  border: 1px solid var(--tone-warn-line);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}

.rg-foot {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.rg-foot__line {
  font-size: var(--fs-4);
  line-height: 1.55;
  color: var(--text-muted);
}

.rg-phase {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}

.rg-empty {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 22px 20px;
}
.rg-empty__head {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}
.rg-empty__body {
  font-size: var(--fs-5);
  line-height: 1.6;
  color: var(--prose);
}

@media (max-width: 860px) {
  .rg-split {
    grid-template-columns: 1fr;
  }
  .rg-pane {
    border-right: 0;
    border-bottom: 1px solid var(--divider);
  }
  .rg-step {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .rg-step__what {
    display: none;
  }
}
</style>
