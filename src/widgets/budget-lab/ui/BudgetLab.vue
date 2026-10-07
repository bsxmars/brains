<script setup lang="ts">
/**
 * «Граф страницы и порог»: чанки выбранной страницы сайта деревом обхода в ширину, сумма
 * против порога из weight.spec (порог можно двигать) и цепочка «кто тянет» для выбранного чанка.
 *
 * Считает не компонент, а строка `GRAPH_CODE` из темы (`walk`, `pageChunks`, `whyIncluded`,
 * `weigh`), собранная `new Function` (`model/run.ts`). Та же строка напечатана на странице
 * и сверена `tests/unit/performance-budgets.test.ts` с weight.spec, es-module-lexer и acorn.
 * Размеры чанков — снимок `dist/` (см. шапку `data.ts` темы): тексты чанков сюда не едут.
 */
import { computed, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { loadGraph } from '../model/run';
import type { BudgetPage, ChunkInfo, Graph } from '../model/types';

const props = defineProps<{
  graphCode: string;
  pages: BudgetPage[];
  chunks: Record<string, ChunkInfo>;
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const api = loadGraph(props.graphCode);
const graph = props.chunks as unknown as Graph;

const route = ref(props.pages[0].route);
const pageOptions = props.pages.map((p) => ({ value: p.route, label: p.label }));
const page = computed(() => props.pages.find((p) => p.route === route.value) ?? props.pages[0]);

type Measure = 'bytes' | 'gzip';
const measure = ref<Measure>('bytes');
const measureOptions = [
  { value: 'bytes', label: 'сырые байты' },
  { value: 'gzip', label: 'gzip' },
];

const scope = ref<'static' | 'all'>('static');
const scopeOptions = [
  { value: 'static', label: 'статические' },
  { value: 'all', label: '+ import()' },
];
const withDynamic = computed(() => scope.value === 'all');

const budgetKb = ref(props.pages[0].budgetKb);
watch(page, (p) => {
  budgetKb.value = p.budgetKb;
});

const size = (f: string) => props.chunks[f][measure.value];

const parent = computed(() => api.walk(graph, page.value.entries, withDynamic.value));
const files = computed(() => api.pageChunks(graph, page.value.entries, withDynamic.value));
const total = computed(() => api.weigh(files.value, size));
const budget = computed(() => budgetKb.value * 1024);
const over = computed(() => total.value > budget.value);

const nbsp = ' ';
function fmt(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, nbsp);
}
const kb = (n: number) => (n / 1024).toFixed(1);

/** Ребро parent → child динамическое, если его нет среди статических импортов родителя. */
const isDynamicEdge = (from: string | null, to: string) => from !== null && !props.chunks[from].imports.includes(to);

interface Row {
  file: string;
  depth: number;
  dynamic: boolean;
}

/** Дерево обхода: каждый чанк под тем, кто первым к нему привёл; братья — по убыванию веса. */
const rows = computed<Row[]>(() => {
  const children = new Map<string, string[]>();
  for (const [file, from] of parent.value) {
    if (from === null) continue;
    children.set(from, [...(children.get(from) ?? []), file]);
  }
  const out: Row[] = [];
  const visit = (file: string, depth: number) => {
    out.push({ file, depth, dynamic: isDynamicEdge(parent.value.get(file) ?? null, file) });
    const kids = [...(children.get(file) ?? [])].sort((a, b) => size(b) - size(a));
    for (const k of kids) visit(k, depth + 1);
  };
  for (const e of page.value.entries) if (parent.value.get(e) === null) visit(e, 0);
  return out;
});

const heaviest = (list: string[]) => [...list].sort((a, b) => props.chunks[b].bytes - props.chunks[a].bytes)[0];
const selected = ref(heaviest(files.value));
watch([files], () => {
  if (!files.value.includes(selected.value)) selected.value = heaviest(files.value);
});

const chain = computed(() => api.whyIncluded(graph, page.value.entries, selected.value, withDynamic.value) ?? []);
const importers = computed(() =>
  files.value.filter((f) => {
    const c = props.chunks[f];
    return c.imports.includes(selected.value) || (withDynamic.value && c.dynamic.includes(selected.value));
  }),
);

const verdict = computed(() => {
  const unit = measure.value === 'bytes' ? 'сырыми байтами' : 'по gzip';
  const head = `**${kb(total.value)} КБ** ${unit} из ${budgetKb.value} — ${files.value.length} файлов`;
  const diff = Math.abs(budget.value - total.value);
  return over.value ? `${head}. Порог превышен на ${kb(diff)} КБ.` : `${head}. Запас ${kb(diff)} КБ.`;
});

const budgetNote = computed(
  () => `Порог страницы в weight.spec — \`${page.value.budgetName}\`, ${page.value.budgetKb} КБ сырыми байтами.`,
);

const selectedInfo = computed(() => {
  const c = props.chunks[selected.value];
  const shared = c.pages > 1 ? `Этот же файл получают **${c.pages}** страниц сайта.` : 'Других страниц с этим файлом нет.';
  return `\`${selected.value}\`: ${fmt(c.bytes)} Б сырыми, ${fmt(c.gzip)} Б gzip, ${fmt(c.br)} Б Brotli. ${shared}`;
});

const importersNote = computed(() => {
  const n = importers.value.length;
  if (n === 0) return 'Это вход: на него ссылается HTML страницы.';
  if (n === 1) return `Импортёр один — \`${importers.value[0]}\`. Убрать этот импорт — и файл уйдёт со страницы.`;
  return `Импортёров ${n}: ${importers.value.map((f) => `\`${f}\``).join(', ')}. Цепочка выше — самая короткая; чтобы файл ушёл со страницы, разорвать нужно все пути.`;
});

const scale = computed(() => Math.max(total.value, budget.value) * 1.08);
const fillPct = computed(() => `${((total.value / scale.value) * 100).toFixed(2)}%`);
const markPct = computed(() => `${((budget.value / scale.value) * 100).toFixed(2)}%`);

function pick(file: string) {
  selected.value = file;
}
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="bl-toolbar">
        <SegmentedControl v-model="route" class="l-pills" label="Страница" :options="pageOptions" />
        <div class="bl-toolbar__row">
          <SegmentedControl v-model="measure" class="l-pills" label="Единица" :options="measureOptions" />
          <SegmentedControl v-model="scope" class="l-pills" label="Импорты" :options="scopeOptions" />
        </div>
        <label class="bl-range">
          <span class="bl-label">порог = {{ budgetKb }} КБ</span>
          <input v-model.number="budgetKb" type="range" min="50" max="450" step="5" :aria-valuetext="`порог ${budgetKb} КБ`" />
        </label>
      </div>
    </template>

    <div class="bl-body">
      <Md class="bl-note" :text="page.note" />

      <div class="bl-meter" :data-over="over ? 'yes' : 'no'">
        <div class="bl-meter__track" role="img" :aria-label="`${kb(total)} КБ из ${budgetKb}`">
          <div class="bl-meter__fill" :style="{ width: fillPct }" />
          <div class="bl-meter__mark" :style="{ left: markPct }" />
        </div>
        <Md class="bl-verdict" :text="verdict" />
        <Md class="bl-small" :text="budgetNote" />
      </div>

      <div class="bl-split">
        <div class="bl-pane">
          <span class="bl-label">чанки страницы — нажмите на файл</span>
          <div class="bl-tree" role="group" aria-label="Дерево чанков страницы">
            <div class="bl-tree__list">
            <button
              v-for="r in rows"
              :key="r.file"
              type="button"
              class="bl-row"
              :data-on="r.file === selected ? 'yes' : 'no'"
              :data-dyn="r.dynamic ? 'yes' : 'no'"
              :aria-pressed="r.file === selected"
              @click="pick(r.file)"
            >
              <span class="bl-row__size">{{ fmt(size(r.file)) }}</span>
              <span class="bl-row__name" :style="{ paddingLeft: `${r.depth * 1.1}em` }">{{ r.depth ? '└ ' : '' }}{{ r.file }}</span>
              <span v-if="r.dynamic" class="bl-tag bl-tag--dyn">import()</span>
              <span v-if="chunks[r.file].pages > 1" class="bl-tag">на {{ chunks[r.file].pages }} стр.</span>
            </button>
            </div>
          </div>
        </div>

        <div class="bl-pane bl-pane--why">
          <span class="bl-label">кто тянет этот файл</span>
          <Md class="bl-text" :text="selectedInfo" />
          <ol class="bl-chain" aria-label="Цепочка от входа страницы">
            <li v-for="(f, i) in chain" :key="f" class="bl-chain__item">
              <span v-if="i > 0" class="bl-chain__edge">{{ isDynamicEdge(chain[i - 1], f) ? 'import()' : 'import' }}</span>
              <code class="bl-chain__file" :data-on="f === selected ? 'yes' : 'no'">{{ f }}</code>
            </li>
          </ol>
          <Md class="bl-text" :text="importersNote" />
        </div>
      </div>

      <Md class="bl-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.bl-toolbar {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.bl-toolbar__row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
}
.bl-range {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
  align-items: center;
  min-width: 0;
}
.bl-range input {
  font: inherit;
  color: inherit;
  width: min(320px, 100%);
  accent-color: var(--ink);
}
.bl-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.bl-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.bl-note,
.bl-caption,
.bl-text,
.bl-verdict {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
  overflow-wrap: anywhere;
}
.bl-small {
  font-size: var(--fs-2);
  line-height: 1.5;
  color: var(--text-muted);
}
.bl-body :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}

.bl-meter {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--tone-ok-bg);
  box-shadow: inset 0 0 0 1px var(--tone-ok-line);
}
.bl-meter[data-over='yes'] {
  background: var(--tone-err-bg);
  box-shadow: inset 0 0 0 1px var(--tone-err-line);
}
.bl-meter__track {
  position: relative;
  height: 14px;
  border-radius: var(--r2);
  background: var(--surface);
  box-shadow: inset 0 0 0 1px var(--border);
}
.bl-meter__fill {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: var(--r2);
  background: var(--tone-ok-strong);
}
.bl-meter[data-over='yes'] .bl-meter__fill {
  background: var(--tone-err-strong);
}
.bl-meter__mark {
  position: absolute;
  top: -4px;
  bottom: -4px;
  width: 2px;
  margin-left: -1px;
  background: var(--ink);
}

.bl-split {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 860px) {
  .bl-split {
    grid-template-columns: minmax(0, 1fr);
  }
}

.bl-pane {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
}

.bl-tree {
  max-height: 460px;
  overflow: auto;
  border-radius: var(--r2);
  background: var(--surface);
  box-shadow: inset 0 0 0 1px var(--border);
}
.bl-tree__list {
  display: grid;
  width: max-content;
  min-width: 100%;
}
.bl-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 5px 8px;
  border: 0;
  border-bottom: 1px solid var(--hairline);
  background: transparent;
  font: inherit;
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--ink);
  text-align: left;
  cursor: pointer;
}
.bl-row:hover,
.bl-row:focus-visible {
  background: var(--surface-3);
  outline: none;
}
.bl-row[data-on='yes'] {
  background: var(--tone-warn-bg);
  box-shadow: inset 2px 0 0 var(--tone-warn-accent);
}
.bl-row[data-dyn='yes'] .bl-row__name {
  color: var(--text-muted);
}
.bl-row__name {
  white-space: nowrap;
}
.bl-row__size {
  flex: none;
  min-width: 6.5ch;
  text-align: right;
  color: var(--text-muted);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.bl-tag {
  padding: 0 6px;
  border-radius: var(--r-full);
  background: var(--surface-3);
  color: var(--text-muted);
  white-space: nowrap;
}
.bl-tag--dyn {
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
}

.bl-chain {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.bl-chain__item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.bl-chain__edge {
  padding-left: 12px;
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.bl-chain__edge::before {
  content: '↓ ';
}
.bl-chain__file {
  padding: 4px 8px;
  border-radius: var(--r2);
  background: var(--surface);
  box-shadow: inset 0 0 0 1px var(--border);
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--ink);
  overflow-wrap: anywhere;
}
.bl-chain__file[data-on='yes'] {
  background: var(--tone-warn-bg);
  box-shadow: inset 0 0 0 1px var(--tone-warn-line);
}
</style>
