<script setup lang="ts">
/**
 * «Соберите дерево сами»: дерево блоков, свойства каждого, контексты наложения и порядок
 * отрисовки — и что об этом говорит браузер читателя.
 *
 * Контексты и порядок считает не компонент, а строка `STACKING_CODE` из темы, собранная
 * `new Function` (`model/run.ts`). Сцена — настоящие элементы с теми же стилями, разложенные
 * `layoutTree` так, что все накрывают одну точку; строка «ваш браузер» — это
 * `document.elementsFromPoint` в этой точке. Тот же приём на тех же сценах и на 300
 * случайных деревьях повторяет `tests/unit/stacking.test.ts` в Chromium.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { countNodes, cssText, GEOMETRY, layoutTree, loadStacking, STAGE_STYLE } from '../model/run';
import type { Css, PropOption, StackNode, StackScene } from '../model/types';
import StackBox from './StackBox.vue';

const props = defineProps<{
  code: string;
  scenes: StackScene[];
  options: { position: PropOption[]; z: PropOption[]; kind: PropOption[]; effect: PropOption[] };
  stepLabels: Record<number, string>;
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const api = loadStacking(props.code);
const MAX_NODES = 7;
const NAMES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const TONES = ['info', 'ok', 'warn', 'err'];

const picked = ref(props.scenes[0].id);
const sceneOptions = props.scenes.map((s) => ({ value: s.id, label: s.label }));
const scene = computed(() => props.scenes.find((s) => s.id === picked.value) ?? props.scenes[0]);

const clone = (list: StackNode[]): StackNode[] => list.map((n) => ({ id: n.id, css: { ...n.css }, kids: clone(n.kids ?? []) }));
const tree = ref<StackNode[]>(clone(scene.value.tree));
watch(scene, (s) => {
  tree.value = clone(s.tree);
});

interface Row {
  node: StackNode;
  depth: number;
  parent: StackNode | null;
}
const rows = computed<Row[]>(() => {
  const out: Row[] = [];
  const walk = (list: StackNode[], depth: number, parent: StackNode | null) =>
    list.forEach((n) => {
      out.push({ node: n, depth, parent });
      walk(n.kids ?? [], depth + 1, n);
    });
  walk(tree.value, 0, null);
  return out;
});
const total = computed(() => countNodes(tree.value));
const tones = computed(() => Object.fromEntries(rows.value.map((r, i) => [r.node.id, TONES[i % TONES.length]])));

const result = computed(() => api.paintOrder(tree.value));
const info = computed(() => Object.fromEntries(result.value.contexts.map((c) => [c.id, c])));
const modelOrder = computed(() => result.value.order.map((e) => e.id));
const topId = computed(() => modelOrder.value.at(-1) ?? '');

/** Порядок сверху вниз — так его удобнее читать: первая строка и есть «кто сверху». */
const orderRows = computed(() => {
  const depthOf = (ctx: string | null): number => (ctx === null ? 0 : 1 + depthOf(info.value[ctx]?.ctx ?? null));
  return [...result.value.order].reverse().map((e) => ({
    ...e,
    depth: depthOf(e.ctx),
    reason: info.value[e.id]?.reason ?? null,
    z: info.value[e.id]?.z ?? 0,
  }));
});

const layout = computed(() => layoutTree(tree.value));
const stageSize = computed(() => GEOMETRY.size + Math.max(0, total.value - 1) * GEOMETRY.step);
const stageStyle = computed(() => ({ ...STAGE_STYLE, width: `${stageSize.value}px`, height: `${stageSize.value}px` }));

// ── Значения редактора: из CSS узла в четыре списка и обратно ──
type Field = 'position' | 'z' | 'kind' | 'effect';
const FIELDS: { key: Field; label: string }[] = [
  { key: 'position', label: 'position' },
  { key: 'z', label: 'z-index' },
  { key: 'kind', label: 'вид' },
  { key: 'effect', label: 'свойство' },
];
const matches = (css: Css, opt: PropOption) => Object.entries(opt.css).every(([k, v]) => css[k] === v);
function valueOf(css: Css, field: Field): string {
  const opts = props.options[field];
  return (opts.find((o) => Object.keys(o.css).length && matches(css, o)) ?? opts.find((o) => !Object.keys(o.css).length) ?? opts[0]).value;
}
function setValue(node: StackNode, field: Field, value: string) {
  const css: Css = {};
  for (const f of FIELDS) {
    const v = f.key === field ? value : valueOf(node.css, f.key);
    Object.assign(css, props.options[f.key].find((o) => o.value === v)?.css ?? {});
  }
  node.css = css;
}

function addChild(node: StackNode) {
  if (total.value >= MAX_NODES) return;
  const used = new Set(rows.value.map((r) => r.node.id));
  const id = NAMES.find((n) => !used.has(n));
  if (!id) return;
  node.kids = [...(node.kids ?? []), { id, css: {}, kids: [] }];
}
function addRoot() {
  if (total.value >= MAX_NODES) return;
  const used = new Set(rows.value.map((r) => r.node.id));
  const id = NAMES.find((n) => !used.has(n));
  if (id) tree.value = [...tree.value, { id, css: {}, kids: [] }];
}
function remove(row: Row) {
  if (total.value <= 1) return;
  if (row.parent) row.parent.kids = (row.parent.kids ?? []).filter((k) => k !== row.node);
  else tree.value = tree.value.filter((k) => k !== row.node);
}
function reset() {
  tree.value = clone(scene.value.tree);
}

// ── Что говорит браузер читателя ──
const stage = ref<HTMLElement | null>(null);
const browserOrder = ref<string[] | null>(null);
function probe() {
  const el = stage.value;
  if (!el || typeof document.elementsFromPoint !== 'function') return;
  const r = el.getBoundingClientRect();
  const x = r.left + layout.value.probe;
  const y = r.top + layout.value.probe;
  if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) {
    browserOrder.value = null;
    return;
  }
  browserOrder.value = document
    .elementsFromPoint(x, y)
    .filter((e) => el.contains(e) && e instanceof HTMLElement && e.dataset.node)
    .map((e) => (e as HTMLElement).dataset.node!)
    .reverse();
}
const same = computed(() => browserOrder.value !== null && browserOrder.value.join() === modelOrder.value.join());
const browserTop = computed(() => browserOrder.value?.at(-1) ?? '');

watch(tree, () => nextTick(probe), { deep: true });

let io: IntersectionObserver | null = null;
let raf = 0;
const onScroll = () => {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(probe);
};
onMounted(() => {
  probe();
  io = new IntersectionObserver(() => probe(), { threshold: [0, 0.5, 1] });
  if (stage.value) io.observe(stage.value);
  window.addEventListener('scroll', onScroll, { passive: true });
});
onBeforeUnmount(() => {
  io?.disconnect();
  window.removeEventListener('scroll', onScroll);
  cancelAnimationFrame(raf);
});

const cssLine = (css: Css) => cssText(css).replaceAll(':', ': ').replaceAll(';', '; ') || 'без свойств';
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="picked" class="l-pills" label="Сцена" :options="sceneOptions" />
    </template>

    <div class="sk-body">
      <Md class="sk-note" :text="scene.note" />

      <div class="sk-split">
        <div class="sk-pane">
          <span class="sk-label">дерево и свойства</span>
          <div v-for="r in rows" :key="r.node.id" class="sk-row" :style="{ paddingLeft: `${8 + r.depth * 16}px` }">
            <div class="sk-row__head">
              <code class="sk-name" :data-tone="tones[r.node.id]">{{ r.node.id }}</code>
              <span v-if="info[r.node.id]?.reason" class="sk-chip">контекст</span>
              <span class="sk-row__btns">
                <button
                  type="button"
                  class="sk-btn"
                  :disabled="total >= MAX_NODES"
                  :aria-label="`Добавить ребёнка в ${r.node.id}`"
                  @click="addChild(r.node)"
                >
                  + ребёнок
                </button>
                <button type="button" class="sk-btn" :disabled="total <= 1" :aria-label="`Удалить ${r.node.id}`" @click="remove(r)">×</button>
              </span>
            </div>
            <div class="sk-fields">
              <label v-for="f in FIELDS" :key="f.key" class="sk-field">
                <span class="sk-field__name">{{ f.label }}</span>
                <select
                  class="sk-select"
                  :value="valueOf(r.node.css, f.key)"
                  :aria-label="`${r.node.id}: ${f.label}`"
                  @change="setValue(r.node, f.key, ($event.target as HTMLSelectElement).value)"
                >
                  <option v-for="o in options[f.key]" :key="o.value" :value="o.value">{{ o.label }}</option>
                </select>
              </label>
            </div>
          </div>
          <div class="sk-actions">
            <button type="button" class="sk-btn" :disabled="total >= MAX_NODES" @click="addRoot">+ блок в корень</button>
            <button type="button" class="sk-btn" @click="reset">вернуть сцену</button>
          </div>
        </div>

        <div class="sk-pane">
          <span class="sk-label">сцена в вашем браузере</span>
          <div class="sk-scroll">
            <div class="sk-wrap" :style="{ width: `${stageSize}px`, height: `${stageSize}px` }">
              <div ref="stage" class="sk-stage" :style="stageStyle">
                <StackBox v-for="n in tree" :key="n.id" :node="n" :styles="layout.styles" :tones="tones" />
              </div>
              <span class="sk-probe" :style="{ left: `${layout.probe}px`, top: `${layout.probe}px` }" aria-hidden="true" />
            </div>
          </div>
        </div>
      </div>

      <div class="sk-split">
        <div class="sk-pane">
          <span class="sk-label">порядок отрисовки, сверху вниз — paintOrder</span>
          <ol class="sk-order">
            <li
              v-for="(e, i) in orderRows"
              :key="e.id"
              class="sk-order__row"
              :data-top="i === 0 ? 'yes' : 'no'"
              :style="{ paddingLeft: `${8 + e.depth * 16}px` }"
            >
              <code class="sk-name" :data-tone="tones[e.id]">{{ e.id }}</code>
              <span class="sk-step">{{ e.step }} · {{ stepLabels[e.step] }}</span>
              <span v-if="e.reason" class="sk-reason">контекст: {{ e.reason }}<template v-if="e.z !== 0">, z {{ e.z }}</template></span>
              <span v-else-if="e.ctx" class="sk-reason sk-reason--dim">в контексте {{ e.ctx }}</span>
            </li>
          </ol>
        </div>

        <div class="sk-pane">
          <span class="sk-label">кто сверху в общей точке</span>
          <div class="sk-verdict">
            <span>модель: <code class="sk-name" :data-tone="tones[topId]">{{ topId }}</code></span>
            <span v-if="browserOrder">
              ваш браузер: <code class="sk-name" :data-tone="tones[browserTop]">{{ browserTop || '—' }}</code>
            </span>
            <span v-else class="sk-reason--dim">ваш браузер: сцена вне экрана</span>
            <span v-if="browserOrder" class="sk-same" :data-tone="same ? 'ok' : 'err'">
              {{ same ? 'весь порядок совпал' : 'порядок разошёлся: ' + browserOrder.join(' → ') }}
            </span>
          </div>
          <span class="sk-label">свойства блоков</span>
          <code v-for="r in rows" :key="r.node.id" class="sk-css">{{ r.node.id }} — {{ cssLine(r.node.css) }}</code>
        </div>
      </div>

      <Md class="sk-note" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.sk-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
@media (max-width: 480px) {
  .sk-body {
    padding: 14px;
  }
}
.sk-note {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.sk-note :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}

.sk-split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 760px) {
  .sk-split {
    grid-template-columns: minmax(0, 1fr);
  }
}

.sk-pane {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.sk-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.sk-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border-radius: var(--r2);
  background: var(--surface);
}
.sk-row__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.sk-row__btns {
  display: inline-flex;
  gap: 6px;
  margin-left: auto;
}
.sk-fields {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
}
.sk-field {
  display: inline-flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.sk-field__name {
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.sk-select,
.sk-btn {
  font: inherit;
  color: inherit;
  font-size: var(--fs-2);
  max-width: 100%;
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--surface);
}
.sk-btn {
  cursor: pointer;
  color: var(--prose);
}
.sk-btn:disabled {
  cursor: default;
  color: var(--text-muted);
}
.sk-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.sk-name {
  font-family: var(--mono);
  font-size: var(--fs-3);
  font-weight: 600;
  padding: 1px 6px;
  border-radius: var(--r2);
  color: var(--tone-info-text);
  background: var(--tone-info-bg);
}
.sk-name[data-tone='ok'] {
  color: var(--tone-ok-text);
  background: var(--tone-ok-bg);
}
.sk-name[data-tone='warn'] {
  color: var(--tone-warn-text);
  background: var(--tone-warn-bg);
}
.sk-name[data-tone='err'] {
  color: var(--tone-err-text);
  background: var(--tone-err-bg);
}
.sk-chip {
  font-size: var(--fs-2);
  padding: 1px 6px;
  border-radius: var(--r-full);
  color: var(--ink);
  background: var(--surface-3);
}

.sk-scroll {
  overflow-x: auto;
}
.sk-wrap {
  position: relative;
  margin: 4px auto;
}
.sk-stage {
  position: relative;
  /* Сцена — корень своего контекста и точка отсчёта для `fixed` внутри: иначе блок
     с `position: fixed` при прокрутке страницы уезжал бы из сцены. */
  contain: layout paint;
  isolation: isolate;
}
.sk-probe {
  position: absolute;
  z-index: 1;
  width: 10px;
  height: 10px;
  margin: -5px 0 0 -5px;
  border-radius: var(--r-full);
  box-shadow:
    0 0 0 2px var(--surface),
    0 0 0 4px var(--ink);
  pointer-events: none;
}

.sk-order {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.sk-order__row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
  padding-top: 5px;
  padding-bottom: 5px;
  padding-right: 8px;
  border-radius: var(--r2);
  background: var(--surface);
  font-size: var(--fs-3);
  color: var(--prose);
}
.sk-order__row[data-top='yes'] {
  box-shadow: inset 0 0 0 1px var(--tone-ok-line);
}
.sk-step {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.sk-reason {
  font-size: var(--fs-2);
  color: var(--prose);
  overflow-wrap: anywhere;
}
.sk-reason--dim {
  font-size: var(--fs-2);
  color: var(--text-muted);
}

.sk-verdict {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: var(--fs-3);
  color: var(--prose);
}
.sk-same {
  font-size: var(--fs-3);
}
.sk-same[data-tone='ok'] {
  color: var(--tone-ok-text);
}
.sk-same[data-tone='err'] {
  color: var(--tone-err-text);
}
.sk-css {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--prose);
  overflow-wrap: anywhere;
}
</style>
