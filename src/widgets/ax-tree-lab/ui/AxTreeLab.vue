<script setup lang="ts">
/**
 * «Дерево доступности сцены»: разметка, дерево, которое из неё строят функции темы, порядок Tab
 * и то, что спряталось мимо дерева.
 *
 * Считает не компонент, а строки `HIDDEN_CODE` … `TREE_CODE` из темы, собранные `new Function`
 * (`model/run.ts`). Работают они в браузере читателя: сцена вставляется в скрытый `iframe`, так
 * что `getComputedStyle`, `hidden`, `inert` — настоящие. Те же строки напечатаны на странице и
 * прогоняются `tests/unit/accessibility-tree.test.ts` против литералов Chromium 153 со стенда.
 * Компонент только раскладывает ответ по строкам и сравнивает его с литералом стенда.
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { elementRow, loadAx, sceneElements } from '../model/run';
import type { AxNode, AxScene, AxStates, NameFrom } from '../model/types';

const props = defineProps<{
  /** Строки кода темы в порядке `HIDDEN_CODE`, `ROLE_CODE`, `NAME_CODE`, `FOCUS_CODE`, `TREE_CODE`. */
  codes: string[];
  scenes: AxScene[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const api = loadAx(props.codes);

const picked = ref(props.scenes[0].id);
const options = props.scenes.map((s) => ({ value: s.id, label: s.label }));
const scene = computed(() => props.scenes.find((s) => s.id === picked.value) ?? props.scenes[0]);

interface Line {
  key: string;
  depth: number;
  role: string;
  name: string;
  from: NameFrom;
  states: AxStates;
  focusable: boolean;
}

interface Result {
  lines: Line[];
  tabs: { key: string; label: string; ghost: boolean }[];
  hidden: string[];
  sameRows: number;
  totalRows: number;
  sameTabs: boolean;
}

const result = shallowRef<Result | null>(null);
const error = ref('');
const selected = ref('');
let frame: HTMLIFrameElement | null = null;

function flatten(nodes: AxNode[], depth: number, prefix: string, out: Line[]) {
  nodes.forEach((n, i) => {
    const key = `${prefix}${i}`;
    out.push({
      key,
      depth,
      role: n.role,
      name: n.name,
      from: n.from ?? '',
      states: n.states ?? {},
      focusable: !!n.focusable,
    });
    flatten(n.children, depth + 1, `${key}.`, out);
  });
}

/** Начальный тег элемента — так он записан в разметке сцены. */
const openTag = (el: Element) => el.outerHTML.slice(0, el.outerHTML.indexOf('>') + 1).replace(/\s+/g, ' ');

function label(el: Element): string {
  const role = api.roleOf(el);
  // Скрытому от дерева имени не вычислить — для подписи берём его текст.
  if (api.isHidden(el)) return `${role} «${(el.textContent ?? '').trim()}» — в дереве его нет`;
  const { name } = api.accName(el);
  return name ? `${role} «${name}»` : role;
}

function compute() {
  if (!frame?.contentDocument) return;
  const doc = frame.contentDocument;
  try {
    doc.body.innerHTML = scene.value.html;
    const els = sceneElements(doc.body);
    const lines: Line[] = [];
    flatten(api.axTree(doc.body), 0, '', lines);
    const rows = els.map((el) => elementRow(api, el));
    const tabEls = api.tabOrder(doc.body);
    const tabIdx = tabEls.map((el) => els.indexOf(el));
    const hidden = els
      .filter((el) => api.isHidden(el) && !(el.parentElement && el.parentElement !== doc.body && api.isHidden(el.parentElement)))
      .map(openTag);
    result.value = {
      lines,
      tabs: tabEls.map((el, i) => ({ key: `${tabIdx[i]}`, label: label(el), ghost: api.isHidden(el) })),
      hidden,
      sameRows: rows.filter((r, i) => r === scene.value.elements[i]).length,
      totalRows: scene.value.elements.length,
      sameTabs: JSON.stringify(tabIdx) === JSON.stringify(scene.value.tabs),
    };
    selected.value = lines.find((l) => l.role !== 'text')?.key ?? '';
    error.value = '';
  } catch (e) {
    result.value = null;
    error.value = String((e as Error).message ?? e);
  }
}

onMounted(() => {
  frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden';
  document.body.append(frame);
  const doc = frame.contentDocument;
  if (doc) {
    doc.open();
    doc.write('<!doctype html><html lang="ru"><head><meta charset="utf-8"></head><body></body></html>');
    doc.close();
  }
  compute();
});
onBeforeUnmount(() => frame?.remove());
watch(picked, compute);

const current = computed(() => result.value?.lines.find((l) => l.key === selected.value) ?? null);

/** Роли, которым без имени нельзя: скринридер скажет «кнопка» — и всё. Для подсветки, не для расчёта. */
const NEEDS_NAME = new Set(['button', 'link', 'img', 'textbox', 'checkbox', 'combobox']);

const FROM: Record<NameFrom, string> = {
  'aria-labelledby': 'шаг 2B — `aria-labelledby`',
  'aria-label': 'шаг 2C — `aria-label`',
  label: 'шаг 2D — `<label>`',
  alt: 'шаг 2D — `alt`',
  legend: 'шаг 2D — `<legend>`',
  caption: 'шаг 2D — `<caption>`',
  value: 'шаг 2D — `value`',
  content: 'шаг 2F — из содержимого',
  title: 'шаг 2I — `title`',
  placeholder: '`placeholder`, после `title`',
  '': '',
};

function chips(l: Line): string[] {
  const out: string[] = [];
  const s = l.states;
  if (s.level) out.push(`level ${s.level}`);
  if (s.disabled) out.push('disabled');
  if (s.checked) out.push(`checked ${s.checked}`);
  if (s.pressed) out.push(`pressed ${s.pressed}`);
  if (s.expanded) out.push(`expanded ${s.expanded}`);
  if (s.live) out.push(`live ${s.live}`);
  return out;
}

const detail = computed(() => {
  const l = current.value;
  if (!l) return '';
  const name = l.name ? `имя «${l.name}», ${FROM[l.from]}` : 'имени нет, ни один шаг его не дал';
  const focus = l.focusable ? 'фокус есть' : 'фокуса нет';
  return `\`${l.role}\` — ${name}; ${focus}.`;
});

const verdict = computed(() => {
  const r = result.value;
  if (error.value) return `Ваш браузер не смог посчитать сцену: ${error.value}`;
  if (!r) return 'Ваш браузер ещё считает сцену.';
  const rows =
    r.sameRows === r.totalRows
      ? `роль и имя совпали у всех ${r.totalRows} элементов`
      : `роль и имя совпали у ${r.sameRows} из ${r.totalRows} элементов`;
  return `Chromium 153 на стенде: ${rows}; порядок Tab ${r.sameTabs ? 'тот же' : '**другой**'}.`;
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="picked" class="l-pills" label="Сцена" :options="options" />
    </template>

    <div class="ax-body">
      <Md class="ax-note" :text="scene.note" />

      <div class="ax-split">
        <div class="ax-pane">
          <span class="ax-label">разметка</span>
          <pre class="ax-code">{{ scene.html }}</pre>
        </div>

        <div class="ax-pane">
          <span class="ax-label">дерево доступности</span>
          <ul v-if="result" class="ax-tree" aria-label="Дерево доступности сцены">
            <li v-for="l in result.lines" :key="l.key" :style="{ paddingLeft: `${l.depth * 1.1}em` }">
              <span v-if="l.role === 'text'" class="ax-text">{{ l.name }}</span>
              <button
                v-else
                type="button"
                class="ax-node"
                :aria-pressed="l.key === selected"
                @click="selected = l.key"
              >
                <code class="ax-role">{{ l.role }}</code>
                <span v-if="l.name" class="ax-name">«{{ l.name }}»</span>
                <span v-else class="ax-noname" :data-need="NEEDS_NAME.has(l.role) ? 'yes' : 'no'">без имени</span>
                <span v-for="c in chips(l)" :key="c" class="ax-chip">{{ c }}</span>
                <span v-if="l.focusable" class="ax-chip ax-chip--focus">Tab</span>
              </button>
            </li>
          </ul>
          <Md v-if="detail" class="ax-detail" :text="detail" />
        </div>
      </div>

      <div v-if="result" class="ax-split">
        <div class="ax-pane">
          <span class="ax-label">порядок Tab</span>
          <ol class="ax-tabs">
            <li v-for="tab in result.tabs" :key="tab.key" :class="{ 'ax-ghost': tab.ghost }">{{ tab.label }}</li>
          </ol>
        </div>
        <div class="ax-pane">
          <span class="ax-label">мимо дерева</span>
          <ul v-if="result.hidden.length" class="ax-hidden">
            <li v-for="(h, i) in result.hidden" :key="i"><code>{{ h }}</code></li>
          </ul>
          <span v-else class="ax-empty">ничего не спрятано</span>
        </div>
      </div>

      <Md class="ax-verdict" :text="verdict" />
      <Md class="ax-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.ax-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.ax-note,
.ax-caption,
.ax-verdict,
.ax-detail {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.ax-note :deep(code),
.ax-caption :deep(code),
.ax-verdict :deep(code),
.ax-detail :deep(code),
.ax-hidden code {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
.ax-verdict {
  padding: 10px 12px;
  border-radius: var(--r2);
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
}

.ax-split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 760px) {
  .ax-split {
    grid-template-columns: minmax(0, 1fr);
  }
}

.ax-pane {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.ax-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.ax-code {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.7;
  /* Подложка — общая для кода курса (`pre` в base.css, чернильная). */
  color: var(--code-fg);
  white-space: pre;
  overflow-x: auto;
}

.ax-tree,
.ax-tabs,
.ax-hidden {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: var(--fs-3);
  color: var(--prose);
}
.ax-tabs {
  list-style: decimal inside;
}
.ax-node {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
  max-width: 100%;
  padding: 3px 8px;
  border: 1px solid transparent;
  border-radius: var(--r2);
  background: transparent;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.ax-node:hover {
  background: var(--surface-3);
}
.ax-node:focus-visible {
  outline: 2px solid var(--tone-info-line);
  outline-offset: 1px;
}
.ax-node[aria-pressed='true'] {
  border-color: var(--tone-info-line);
  background: var(--tone-info-bg);
}
.ax-role {
  font-family: var(--mono);
  font-size: var(--fs-3);
  font-weight: 600;
  color: var(--ink);
}
.ax-name {
  overflow-wrap: anywhere;
}
.ax-noname {
  color: var(--text-muted);
}
.ax-noname[data-need='yes'] {
  color: var(--tone-err-text);
}
.ax-text {
  display: inline-block;
  padding: 3px 8px;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}
.ax-chip {
  padding: 0 6px;
  border-radius: var(--r1);
  background: var(--surface-3);
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.ax-chip--focus {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.ax-hidden code {
  overflow-wrap: anywhere;
  color: var(--ink);
}
.ax-ghost {
  color: var(--tone-err-text);
}
.ax-empty {
  font-size: var(--fs-3);
  color: var(--text-muted);
}
</style>
