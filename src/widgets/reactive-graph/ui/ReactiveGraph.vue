<script setup lang="ts">
/**
 * Живой граф зависимостей — ядро урока.
 *
 * Здесь нет ни модели реактивности, ни её имитации: `reactive`, `computed`, `effect` и `stop`
 * импортированы из `@vue/reactivity` и работают в браузере читателя. Числа на карточках —
 * настоящие счётчики прогонов, а не заготовленные ответы.
 *
 * **Откуда берутся рёбра.** У Vue есть готовый ответ на этот вопрос — опции `onTrack`
 * и `onTrigger`. Пользоваться ими нельзя: они существуют только в dev-сборке
 * (`__DEV__`-условия в исходниках), а курс собирается статически, то есть в прод. Тот же
 * запрет действует на `onRenderTracked` / `onRenderTriggered`. Поэтому ребро отмечается
 * рядом с настоящим чтением: `readKey` и `readDep` сначала записывают ребро, потом читают
 * свойство через прокси — то самое чтение, на котором срабатывает `track`. Это не пересказ
 * графа, а его отпечаток, снятый тем же событием и в тот же момент.
 *
 * **Почему список зависимостей чистится в начале каждого прогона.** Потому что так устроен
 * оригинал: перед запуском подписчика связи помечаются неподтверждёнными, после запуска
 * неподтверждённые выбрасываются. Отсюда видно главное свойство системы — зависимости
 * задаются **фактом выполнения**, а не текстом кода: эффект `E5` держит ребро к `qty`
 * только пока ветка `if` действительно выполняется.
 *
 * **Почему счётчики, рёбра и лог — обычные объекты, а не реактивные.** Писать в реактивное
 * состояние из геттера `computed` нельзя — урок сам об этом говорит, и демо не имеет права
 * нарушать то, чему учит. Поэтому подписчики пишут в простые объекты, а на экран это
 * переносится одним вызовом `publish()` — уже снаружи, после того как всё отработало.
 *
 * **Почему значения показываются из зеркала `view`.** Если бы шаблон читал `state.price`,
 * подписчиком стал бы render-эффект самого демо — и в графе появился бы шестой эффект,
 * которого читатель не создавал.
 *
 * Все переходы проверены запуском в Node 24.11 на `@vue/reactivity` 3.5.42: гранулярность
 * по ключу, молчание на записи тем же значением, ленивость `computed` и то, что `computed`,
 * выдавший прежнее значение, своих подписчиков не будит.
 */
import { onUnmounted, ref } from 'vue';
import { computed, effect, reactive, stop } from '@vue/reactivity';
import ConsoleView from '@/shared/ui/ConsoleView.vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button } from '@/shared/ui';
import type { GraphNode, GraphWrite } from '../model/types';

const props = defineProps<{ writes: GraphWrite[]; nodes: GraphNode[]; hint: string }>();

type SourceKey = 'price' | 'qty' | 'note' | 'detailed';
type OwnerId = GraphNode['id'];

const SOURCES: SourceKey[] = ['price', 'qty', 'note', 'detailed'];
const OWNERS: OwnerId[] = ['total', 'pricey', 'e1', 'e2', 'e3', 'e4', 'e5'];
const INITIAL = { price: 100, qty: 2, note: 'к оплате', detailed: false };

/** Настоящее реактивное состояние демо. Всё остальное на экране — следствие чтений из него. */
const state = reactive({ ...INITIAL });

const emptyDeps = () => Object.fromEntries(OWNERS.map((id) => [id, [] as string[]])) as Record<OwnerId, string[]>;
const zeroRuns = () => Object.fromEntries(OWNERS.map((id) => [id, 0])) as Record<OwnerId, number>;

// Обычные объекты: в них пишут подписчики, в том числе `computed`.
let depsRaw = emptyDeps();
let runsRaw = zeroRuns();
let linesRaw: string[] = [];

// Их снимки для показа — обновляются снаружи, вызовом `publish()`.
const deps = ref(emptyDeps());
const runs = ref(zeroRuns());
const lines = ref<string[]>([]);
const view = reactive({ ...INITIAL });

const started = ref(false);
/** Кто проснулся на последней записи. Остальные, следовательно, промолчали. */
const awake = ref<OwnerId[]>([]);
const touched = ref<SourceKey | null>(null);
const lastNote = ref('');

let handles: ReturnType<typeof effect>[] = [];

/** Начало прогона подписчика: старые связи сброшены, как `prepareDeps` в оригинале. */
function begin(owner: OwnerId) {
  runsRaw[owner] += 1;
  depsRaw[owner] = [];
}

/** Чтение свойства. Ребро отмечается ровно там, где срабатывает настоящий `track`. */
function readKey<K extends SourceKey>(owner: OwnerId, key: K): (typeof INITIAL)[K] {
  if (!depsRaw[owner].includes(`state.${key}`)) depsRaw[owner].push(`state.${key}`);
  return state[key];
}

/** Чтение `computed` — подписка идёт на сам `computed`, а не на его источники. */
function readDep<T>(owner: OwnerId, name: string, dep: { value: T }): T {
  if (!depsRaw[owner].includes(name)) depsRaw[owner].push(name);
  return dep.value;
}

/** Цепочка: `pricey` зависит от `total`, а `total` — от двух ключей. */
const total = computed(() => {
  begin('total');
  return readKey('total', 'price') * readKey('total', 'qty');
});

const pricey = computed(() => {
  begin('pricey');
  return readDep('pricey', 'total', total) > 150;
});

/** Перенести снятое подписчиками на экран. Вызывается только снаружи эффектов. */
function publish() {
  deps.value = { ...depsRaw };
  runs.value = { ...runsRaw };
  lines.value = [...linesRaw];
  Object.assign(view, {
    price: state.price,
    qty: state.qty,
    note: state.note,
    detailed: state.detailed,
  });
}

function start() {
  linesRaw = [];
  handles = [
    effect(() => {
      begin('e1');
      linesRaw.push(`E1 · цена ${readKey('e1', 'price')}`);
    }),
    effect(() => {
      begin('e2');
      linesRaw.push(`E2 · итог ${readDep('e2', 'total', total)}`);
    }),
    effect(() => {
      begin('e3');
      linesRaw.push(`E3 · ${readDep('e3', 'pricey', pricey) ? 'дорого' : 'дёшево'}`);
    }),
    effect(() => {
      begin('e4');
      linesRaw.push(`E4 · подпись «${readKey('e4', 'note')}»`);
    }),
    effect(() => {
      begin('e5');
      // Ветка решает, появится ли ребро к `qty`. Это и есть «зависимости по факту выполнения».
      if (readKey('e5', 'detailed')) linesRaw.push(`E5 · подробно: ${readKey('e5', 'qty')} шт.`);
      else linesRaw.push('E5 · кратко');
    }),
  ];
  started.value = true;
  lastNote.value = props.hint;
  publish();
}

/**
 * Остановить эффекты и отцепить их от всех `Dep`.
 *
 * Эффекты созданы в обработчике клика, а не в `setup()`, поэтому область видимости
 * компонента их не подобрала: `activeEffectScope` в момент клика уже снят. Не остановить
 * их руками — и они переживут сам виджет. Это ровно та утечка, о которой урок говорит
 * в разделе про `effectScope`.
 */
function dispose() {
  handles.forEach((handle) => stop(handle));
  handles = [];
}

function reset() {
  dispose();
  Object.assign(state, INITIAL);
  depsRaw = emptyDeps();
  runsRaw = zeroRuns();
  linesRaw = [];
  started.value = false;
  awake.value = [];
  touched.value = null;
  lastNote.value = '';
  publish();
}

const WRITE_KEY: Record<GraphWrite['id'], SourceKey> = {
  'price-up': 'price',
  'qty-up': 'qty',
  'price-cheap': 'price',
  note: 'note',
  detailed: 'detailed',
  'price-same': 'price',
};

function applyWrite(write: GraphWrite) {
  if (!started.value) return;
  const before = { ...runsRaw };
  linesRaw = [];

  switch (write.id) {
    case 'price-up':
      state.price += 10;
      break;
    case 'qty-up':
      state.qty += 1;
      break;
    case 'price-cheap':
      state.price = 30;
      break;
    case 'note':
      state.note = state.note === 'к оплате' ? 'итого' : 'к оплате';
      break;
    case 'detailed':
      state.detailed = !state.detailed;
      break;
    case 'price-same': {
      // Присвоение того же значения: `hasChanged` не пропустит его дальше `set`.
      const same = state.price;
      state.price = same;
      break;
    }
  }

  awake.value = OWNERS.filter((id) => runsRaw[id] !== before[id]);
  touched.value = WRITE_KEY[write.id];
  lastNote.value = write.note;
  if (!linesRaw.length) linesRaw.push('ни один эффект не выполнился');
  publish();
}

function nodeState(id: OwnerId) {
  if (!started.value) return 'off';
  if (!touched.value) return 'idle';
  return awake.value.includes(id) ? 'woke' : 'silent';
}

onUnmounted(dispose);
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="bar">
        <Button v-if="!started" variant="primary" @click="start">создать эффекты</Button>
        <template v-else>
          <Button v-for="write in writes" :key="write.id" variant="secondary" @click="applyWrite(write)">
            {{ write.label }}
          </Button>
          <Button variant="secondary" @click="reset">сброс</Button>
        </template>
      </div>
    </template>

    <div class="cols">
      <div class="col">
        <div class="t-label">источники · reactive</div>
        <div
          v-for="key in SOURCES"
          :key="key"
          class="src"
          :data-hit="started && touched === key ? 'yes' : 'no'"
        >
          <span class="src__key">state.{{ key }}</span>
          <span class="src__val">{{ String(view[key]) }}</span>
        </div>
      </div>

      <div class="col">
        <div class="t-label">computed · и подписчик, и источник</div>
        <div
          v-for="node in nodes.filter((item) => item.id === 'total' || item.id === 'pricey')"
          :key="node.id"
          class="node"
          :data-state="nodeState(node.id)"
        >
          <div class="node__head">
            <span class="node__title">{{ node.title }}</span>
            <span class="node__runs">пересчётов: {{ runs[node.id] }}</span>
          </div>
          <div class="node__src">{{ node.source }}</div>
          <div class="chips">
            <span v-if="!deps[node.id].length" class="chips__none">зависимостей нет — ещё не вычислялся</span>
            <span v-for="dep in deps[node.id]" :key="dep" class="chip">{{ dep }}</span>
          </div>
        </div>
      </div>

      <div class="col">
        <div class="t-label">эффекты · подписчики</div>
        <div
          v-for="node in nodes.filter((item) => item.id.startsWith('e'))"
          :key="node.id"
          class="node"
          :data-state="nodeState(node.id)"
        >
          <div class="node__head">
            <span class="node__title">{{ node.title }}</span>
            <span class="node__runs">прогонов: {{ runs[node.id] }}</span>
          </div>
          <div class="node__src">{{ node.source }}</div>
          <div class="chips">
            <span v-if="!deps[node.id].length" class="chips__none">зависимостей нет — не выполнялся</span>
            <span v-for="dep in deps[node.id]" :key="dep" class="chip">{{ dep }}</span>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="reactive-graph-foot">
        <ConsoleView
          :lines="lines"
          label="что выполнилось на последней записи"
          empty-label="эффекты ещё не созданы"
          :min-height="86"
        />
        <Md v-if="lastNote" class="reactive-graph-foot__note" :text="lastNote" />
      </div>
    </template>
  </DemoFrame>
</template>

<style scoped>
.bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.cols {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(250px, 100%), 1fr));
  gap: 18px;
  padding: 20px;
}
.col {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

/* Источник: ключ и его текущее значение. Подсвечивается тот, в который только что писали. */
.src {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--r2);
  background: var(--surface-2);
  transition: all 0.2s;
}
.src[data-hit='yes'] {
  background: var(--tone-warn-bg);
  box-shadow: inset 2px 0 0 var(--tone-warn-accent);
}
.src__key {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--chip-text);
  overflow-wrap: anywhere;
}
.src__val {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--tone-info-strong);
  white-space: nowrap;
}

.node {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 13px;
  border-radius: var(--r2);
  background: var(--surface);
  box-shadow: var(--shadow-card);
  transition: all 0.2s;
}
/* Три состояния узла — это и есть ответ демо: сработал, промолчал, ещё не жил. */
.node[data-state='woke'] {
  background: var(--tone-ok-bg);
  box-shadow: inset 2px 0 0 var(--tone-ok-strong), var(--shadow-card);
}
.node[data-state='silent'] {
  background: var(--sunk-dim);
  box-shadow: none;
}
.node[data-state='off'] {
  background: var(--sunk-dim);
  box-shadow: none;
}

.node__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 6px;
}
.node__title {
  font-family: var(--mono);
  font-size: var(--fs-3);
  font-weight: 600;
  color: var(--ink);
}
.node__runs {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
  white-space: nowrap;
}
.node__src {
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.5;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

/* Рёбра графа — чипами, а не линиями: на телефоне линии между колонками не живут. */
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.chip {
  padding: 3px 8px;
  border-radius: var(--r-full);
  background: var(--tone-info-chip);
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--tone-info-strong);
}
.chips__none {
  font-family: var(--mono);
  font-size: var(--fs-3);
  font-style: italic;
  color: var(--ghost);
}

.reactive-graph-foot {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.reactive-graph-foot__note {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--prose);
}
</style>
