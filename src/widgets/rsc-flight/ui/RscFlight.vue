<script setup lang="ts">
/**
 * «Поток Flight у вас в браузере»: переключатели сквозного примера, кнопка «отрисовать на
 * сервере», строки потока по кускам и дерево, которое учебный клиент соберёт из пришедшего.
 *
 * Считает не компонент, а строки темы: `FLIGHT_SERVER_CODE`, `FLIGHT_CLIENT_CODE` и `PAGE_CODE`,
 * собранные `new Function` в `model/run.ts`. Те же строки `tests/unit/server-components.test.ts`
 * прогоняет против настоящего `react-server-dom-webpack` 19.3.0 на всех 48 сочетаниях.
 *
 * Сборка функций дешёвая и живёт в `setup`; сам рендер — только по кнопке: у него задержки
 * «базы», и до нажатия считать нечего.
 */
import { computed, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button, SegmentedControl } from '@/shared/ui';
import { loadClient, loadPage, loadServer, makeQuery, pageApi } from '../model/run';
import type { ManifestEntry, PageOptions, PropKind } from '../model/types';
import { splitRows, viewTree } from '../model/view';

const props = defineProps<{
  serverCode: string;
  clientCode: string;
  pageCode: string;
  manifest: Record<string, ManifestEntry>;
  data: Record<string, unknown>;
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const renderToFlight = loadServer(props.serverCode);
const createFromFlight = loadClient(props.clientCode);
const page = loadPage(props.pageCode);

/** Задержки «базы»: порядок ответов тот же, что в тесте (`DEMO_ORDER`). */
const DELAYS: Record<string, number> = { likes: 400, related: 900, comments: 1600 };
/** Что клиент «загрузил» по I-строке: имя экспорта, больше ничего не нужно. */
const MODULES = { like: { Like: function Like() {} } };

const like = ref<PageOptions['like']>('client');
const comments = ref<PageOptions['comments']>('async');
const suspense = ref<'yes' | 'no'>('yes');
const prop = ref<PropKind>('number');

const LIKE_OPTIONS = [
  { value: 'client', label: 'клиентский' },
  { value: 'server', label: 'серверный' },
];
const COMMENTS_OPTIONS = [
  { value: 'sync', label: 'сразу' },
  { value: 'async', label: 'async' },
];
const SUSPENSE_OPTIONS = [
  { value: 'yes', label: 'есть' },
  { value: 'no', label: 'нет' },
];
const PROP_OPTIONS = [
  { value: 'number', label: '7' },
  { value: 'date', label: 'Date' },
  { value: 'promise', label: 'промис' },
  { value: 'action', label: 'серверная функция' },
  { value: 'class', label: 'экземпляр класса' },
  { value: 'function', label: 'функция' },
];

const opts = computed<PageOptions>(() => ({
  like: like.value,
  comments: comments.value,
  suspense: suspense.value === 'yes',
  prop: prop.value,
}));

const chunks = ref<string[]>([]);
const errors = ref<string[]>([]);
const running = ref(false);
const started = ref(false);
/** Сколько кусков «дошло» до клиента в правой колонке. `null` — следить за последним. */
const pinned = ref<number | null>(null);
let runId = 0;

watch(opts, () => {
  runId++;
  chunks.value = [];
  errors.value = [];
  running.value = false;
  started.value = false;
  pinned.value = null;
});

async function run() {
  const id = ++runId;
  chunks.value = [];
  errors.value = [];
  pinned.value = null;
  running.value = true;
  started.value = true;
  const tree = page(opts.value, pageApi(makeQuery(props.data, DELAYS)));
  await renderToFlight(tree, props.manifest, {
    onChunk: (c) => {
      if (id === runId) chunks.value = [...chunks.value, c];
    },
    onError: (e) => {
      if (id === runId) errors.value = [...errors.value, e.message];
    },
  });
  if (id === runId) running.value = false;
}

const shown = computed(() => pinned.value ?? chunks.value.length);

function step(delta: number) {
  const next = Math.min(Math.max(shown.value + delta, 1), chunks.value.length);
  pinned.value = next === chunks.value.length && !running.value ? null : next;
}

const views = computed(() =>
  chunks.value.map((c, i) => ({ n: i + 1, rows: splitRows(c), arrived: i < shown.value })),
);

const tree = computed(() =>
  shown.value ? viewTree(createFromFlight(chunks.value.slice(0, shown.value).join(''), MODULES)) : null,
);
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="rsc-bar">
        <div class="rsc-control">
          <span class="rsc-label">Like</span>
          <SegmentedControl v-model="like" class="l-pills" label="Лайк" :options="LIKE_OPTIONS" />
        </div>
        <div class="rsc-control">
          <span class="rsc-label">комментарии</span>
          <SegmentedControl v-model="comments" class="l-pills" label="Комментарии" :options="COMMENTS_OPTIONS" />
        </div>
        <div class="rsc-control">
          <span class="rsc-label">Suspense</span>
          <SegmentedControl v-model="suspense" class="l-pills" label="Suspense" :options="SUSPENSE_OPTIONS" />
        </div>
        <div class="rsc-control">
          <span class="rsc-label">проп value</span>
          <SegmentedControl v-model="prop" class="l-pills" label="Что в пропе value" :options="PROP_OPTIONS" />
        </div>
        <Button variant="primary" :disabled="running" @click="run">
          {{ running ? 'сервер отвечает…' : started ? 'отрисовать ещё раз' : 'отрисовать на сервере' }}
        </Button>
      </div>
    </template>

    <div class="rsc-split">
      <div class="rsc-pane">
        <div class="rsc-head">
          <span class="t-label">поток · учебный renderToFlight</span>
          <span v-if="chunks.length" class="rsc-count">кусков: {{ chunks.length }}{{ running ? '…' : '' }}</span>
        </div>

        <div v-if="!started" class="rsc-empty">Поток появится после нажатия: его выдаст напечатанный выше сериализатор — у вас в браузере.</div>

        <ol v-else class="rsc-chunks">
          <li v-for="c in views" :key="c.n" class="rsc-chunk" :data-arrived="c.arrived ? 'yes' : 'no'">
            <span class="rsc-chunk__n">кусок {{ c.n }}</span>
            <code v-for="r in c.rows" :key="r.id" class="rsc-row" :data-kind="r.kind">{{ r.text }}</code>
          </li>
          <li v-if="running" class="rsc-wait">ждём «базу»…</li>
        </ol>

        <div v-if="errors.length" class="rsc-errors">
          <span class="t-label">сервер · onError</span>
          <code v-for="(e, i) in errors" :key="i" class="rsc-error">{{ e }}</code>
        </div>
      </div>

      <div class="rsc-pane rsc-pane--tree">
        <div class="rsc-head">
          <span class="t-label">что соберёт клиент · учебный createFromFlight</span>
        </div>

        <div v-if="chunks.length > 1" class="rsc-steps">
          <Button variant="secondary" :disabled="shown <= 1" @click="step(-1)">← меньше</Button>
          <span class="rsc-count">пришло кусков: {{ shown }} из {{ chunks.length }}</span>
          <Button variant="secondary" :disabled="shown >= chunks.length" @click="step(1)">больше →</Button>
        </div>

        <div v-if="!tree" class="rsc-empty">Пока ни одного куска.</div>
        <div v-else-if="tree.blank" class="rsc-blank">
          Экран пуст: в дереве есть дыра без Suspense над ней — показать заглушку негде, ждёт вся страница.
        </div>
        <ul v-else class="rsc-tree">
          <li
            v-for="(l, i) in tree.lines"
            :key="i"
            class="rsc-node"
            :data-kind="l.kind"
            :style="{ marginLeft: `${l.depth * 16}px` }"
          >
            {{ l.text }}
          </li>
        </ul>
      </div>
    </div>

    <template #footer>
      <Md class="rsc-caption" :text="caption" />
    </template>
  </DemoFrame>
</template>

<style scoped>
.rsc-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 12px 18px;
}
.rsc-control {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.rsc-label {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}

.rsc-split {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
}
@media (max-width: 820px) {
  .rsc-split {
    grid-template-columns: minmax(0, 1fr);
  }
}
.rsc-pane {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px;
  min-width: 0;
  border-right: 1px solid var(--divider);
}
.rsc-pane--tree {
  border-right: 0;
  background: var(--surface-2);
}
.rsc-head {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 6px 12px;
}
.rsc-count {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.rsc-empty,
.rsc-blank,
.rsc-wait {
  font-size: var(--fs-3);
  line-height: 1.55;
  color: var(--text-muted);
}
.rsc-blank {
  padding: 12px 14px;
  border-radius: var(--r2);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}

.rsc-chunks {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.rsc-chunk {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border-radius: var(--r2);
  border: 1px solid var(--border);
  background: var(--surface);
}
.rsc-chunk[data-arrived='no'] {
  border-style: dashed;
  background: var(--surface-2);
}
.rsc-chunk[data-arrived='no'] .rsc-row {
  color: var(--text-muted);
}
.rsc-chunk__n {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}
.rsc-row {
  display: block;
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.55;
  color: var(--ink);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.rsc-row[data-kind='module'] {
  color: var(--tone-info-text);
}
.rsc-row[data-kind='symbol'] {
  color: var(--tone-ok-text);
}
.rsc-row[data-kind='error'] {
  color: var(--tone-err-text);
}

.rsc-errors {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-radius: var(--r2);
  background: var(--tone-err-bg);
}
.rsc-error {
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.5;
  color: var(--tone-err-text);
  overflow-wrap: anywhere;
}

.rsc-steps {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
}

.rsc-tree {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.rsc-node {
  padding: 4px 8px;
  border-radius: var(--r1);
  border: 1px solid var(--border);
  background: var(--surface);
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.5;
  color: var(--ink);
  overflow-wrap: anywhere;
}
.rsc-node[data-kind='client'] {
  border-style: dashed;
  border-color: var(--tone-info-line);
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
}
.rsc-node[data-kind='fallback'] {
  border-color: var(--tone-warn-line);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.rsc-node[data-kind='hole'] {
  border-style: dotted;
  color: var(--text-muted);
}
.rsc-node[data-kind='error'] {
  border-color: var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}
.rsc-node[data-kind='text'] {
  border: 0;
  background: none;
  color: var(--prose);
}

.rsc-caption {
  font-size: var(--fs-2);
  line-height: 1.55;
  color: var(--text-muted);
}
.rsc-caption :deep(code) {
  font-family: var(--mono);
  /* Не ниже ступени `--fs-2`: в подписи на `--fs-2` доля .92em давала 10.9px. */
  font-size: max(0.92em, var(--fs-2));
}
</style>
