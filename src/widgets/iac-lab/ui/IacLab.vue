<script setup lang="ts">
/**
 * «План своими руками»: сквозной пример темы, четыре переключателя — как размножен ресурс,
 * какая правка, убран ли `stage` из середины списка, правили ли `dev.txt` руками — и то, что
 * из этого выходит: `main.tf`, план с символами `+ ~ -/+ +/- -`, граф ресурсов и порядок шагов.
 *
 * План считает строка `PLAN_CODE` из темы, собранная `new Function` (`model/run.ts`); сценарий
 * собирает `model/scenario.ts`, HCL печатает `model/hcl.ts`, заголовки и итог — `model/render.ts`.
 * Все 48 сочетаний переключателей тест `tests/unit/infrastructure-as-code.test.ts` сверяет
 * с настоящим `tofu plan`. Компонент только раскладывает результат.
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { toHcl } from '../model/hcl';
import { planItems, summaryLine, type Tone } from '../model/render';
import { loadPlanner } from '../model/run';
import { buildScenario } from '../model/scenario';
import type { Action, Config, Schema, StateInstance, Toggles } from '../model/types';

const props = defineProps<{
  planCode: string;
  base: Config;
  stateCount: StateInstance[];
  stateForEach: StateInstance[];
  schema: Schema;
  /** Пояснения к положениям переключателей. Строчная разметка. */
  notes: {
    mode: Record<Toggles['mode'], string>;
    edit: Record<Toggles['edit'], string>;
    drop: string;
    drift: string;
  };
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const planner = loadPlanner(props.planCode);

const mode = ref<Toggles['mode']>('count');
const edit = ref<Toggles['edit']>('none');
const drop = ref<'all' | 'drop'>('drop');
const drift = ref<'clean' | 'drift'>('clean');

const modeOptions = [
  { value: 'count', label: 'count' },
  { value: 'for_each', label: 'for_each' },
  { value: 'migrate', label: 'count → for_each' },
  { value: 'moved', label: '… и moved' },
];
const editOptions = [
  { value: 'none', label: 'нет' },
  { value: 'input', label: 'input = v2' },
  { value: 'force', label: 'length = 3' },
];
const dropOptions = [
  { value: 'all', label: 'dev, stage, prod' },
  { value: 'drop', label: 'без stage' },
];
const driftOptions = [
  { value: 'clean', label: 'нет' },
  { value: 'drift', label: 'dev.txt правлен' },
];

const groups = [
  { label: 'экземпляры', model: mode, options: modeOptions },
  { label: 'правка', model: edit, options: editOptions },
  { label: 'окружения', model: drop, options: dropOptions },
  { label: 'дрейф', model: drift, options: driftOptions },
] as const;

const toggles = computed<Toggles>(() => ({
  mode: mode.value,
  edit: edit.value,
  drop: drop.value === 'drop',
  drift: drift.value === 'drift',
}));

const input = { base: props.base, stateCount: props.stateCount, stateForEach: props.stateForEach };
const scenario = computed(() => buildScenario(input, toggles.value));
const result = computed(() => planner.plan(scenario.value.config, scenario.value.state, props.schema, scenario.value.world));

const notes = computed(() =>
  [
    props.notes.mode[mode.value],
    props.notes.edit[edit.value],
    toggles.value.drop ? props.notes.drop : '',
    toggles.value.drift ? props.notes.drift : '',
  ].filter(Boolean),
);

// ─── main.tf: строки, которых не было в применённой конфигурации, подсвечены ──────────────
const applied = computed(() => {
  if (mode.value !== 'for_each') return props.base;
  return { resources: props.base.resources.map((r) => (r.count ? { ...r, count: undefined, forEach: r.count } : r)) };
});
const hclLines = computed(() => {
  const before = new Set(toHcl(applied.value).split('\n'));
  return toHcl(scenario.value.config)
    .trimEnd()
    .split('\n')
    .map((text) => ({ text, fresh: text.trim() !== '' && !before.has(text) }));
});

// ─── План ─────────────────────────────────────────────────────────────────────────────────
const countRes = computed(
  () => new Set(scenario.value.config.resources.filter((r) => r.count).map((r) => `${r.type}.${r.name}`)),
);
const items = computed(() => planItems(result.value, countRes.value));
const summary = computed(() => summaryLine(result.value));
const driftLines = computed(() =>
  result.value.drift.map((d) => `# ${d.addr} has been ${d.kind === 'deleted' ? 'deleted' : 'changed'}`),
);

// ─── Граф ресурсов ────────────────────────────────────────────────────────────────────────
const RANK: Record<Action, number> = { 'no-op': 0, update: 1, create: 2, delete: 3, replace: 3 };
const TONE: Record<Action, Tone> = { 'no-op': 'dim', update: 'warn', create: 'ok', delete: 'err', replace: 'err' };
const SYMBOL: Record<Action, string> = { 'no-op': '·', update: '~', create: '+', delete: '-', replace: '-/+' };
const resOf = (addr: string) => addr.replace(/\[.*\]$/, '');
const keyOf = (addr: string) => /(\[.*\])$/.exec(addr)?.[1] ?? '';

const NODE_W = 290;
const NODE_H = 46;
const COL = 350;
const ROW = 60;
const PAD = 14;

const graph = computed(() => {
  const order = result.value.order;
  const deps = new Map<string, Set<string>>(order.map((k) => [k, new Set()]));
  for (const c of result.value.changes) for (const d of c.deps) if (deps.has(d)) deps.get(resOf(c.addr))?.add(d);
  const layer = new Map<string, number>();
  for (const k of order) layer.set(k, Math.max(-1, ...[...(deps.get(k) ?? [])].map((d) => layer.get(d) ?? 0)) + 1);
  const rows = new Map<number, number>();
  const nodes = order.map((k) => {
    const col = layer.get(k) ?? 0;
    const row = rows.get(col) ?? 0;
    rows.set(col, row + 1);
    const mine = result.value.changes.filter((c) => resOf(c.addr) === k);
    const worst = mine.reduce<Action>((a, c) => (RANK[c.action] > RANK[a] ? c.action : a), 'no-op');
    const moved = mine.some((c) => c.movedFrom);
    const marks = mine
      .filter((c) => c.action !== 'no-op' || c.movedFrom)
      .map((c) => `${keyOf(c.addr)} ${c.action === 'replace' && c.cbd ? '+/-' : c.action === 'no-op' ? '→' : SYMBOL[c.action]}`)
      .join('  ');
    return {
      key: k,
      x: PAD + col * COL,
      y: PAD + row * ROW,
      tone: worst === 'no-op' && moved ? ('info' as Tone) : TONE[worst],
      marks: marks || 'без изменений',
    };
  });
  const at = new Map(nodes.map((n) => [n.key, n]));
  const edges = nodes.flatMap((n) =>
    [...(deps.get(n.key) ?? [])].map((d) => {
      const to = at.get(d)!;
      return { key: `${n.key}>${d}`, x1: n.x, y1: n.y + NODE_H / 2, x2: to.x + NODE_W, y2: to.y + NODE_H / 2 };
    }),
  );
  const cols = Math.max(...nodes.map((n) => n.x)) + NODE_W + PAD;
  const height = Math.max(...nodes.map((n) => n.y)) + NODE_H + PAD;
  return { nodes, edges, width: cols, height };
});

const STEP_TONE: Record<string, Tone> = { create: 'ok', update: 'warn', destroy: 'err' };
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="ia-tools">
        <div v-for="g in groups" :key="g.label" class="ia-group">
          <span class="ia-group-label">{{ g.label }}</span>
          <SegmentedControl v-model="g.model.value" class="l-pills" :label="g.label" :options="g.options" />
        </div>
      </div>
    </template>

    <div class="ia-body">
      <div class="ia-notes">
        <Md v-for="(n, i) in notes" :key="i" class="ia-note" :text="n" />
      </div>

      <div class="ia-split">
        <div class="ia-pane">
          <span class="ia-label">main.tf</span>
          <pre class="ia-code"><template v-for="(l, i) in hclLines" :key="i"><span :class="{ 'ia-fresh': l.fresh }">{{ l.text }}</span>{{ '\n' }}</template></pre>
        </div>

        <div class="ia-pane">
          <span class="ia-label">tofu plan</span>
          <div class="ia-plan" role="list">
            <div v-for="(d, i) in driftLines" :key="`d${i}`" class="ia-item" role="listitem">
              <span class="ia-head ia-tone-info">{{ d }}</span>
            </div>
            <div v-for="it in items" :key="it.addr" class="ia-item" role="listitem">
              <span v-for="(h, i) in it.headers" :key="i" class="ia-head">{{ h }}</span>
              <span class="ia-line">
                <span class="ia-sym" :class="`ia-tone-${it.tone}`">{{ it.symbol || '→' }}</span>
                {{ it.addr }}
              </span>
              <span v-if="it.forces.length" class="ia-force">{{ it.forces.join(', ') }} # forces replacement</span>
            </div>
            <span class="ia-summary">{{ summary }}</span>
          </div>
        </div>
      </div>

      <div class="ia-split ia-split--graph">
        <div class="ia-pane">
          <span class="ia-label">граф ресурсов: стрелка — «зависит от»</span>
          <div class="ia-scroll">
            <svg
              class="ia-svg"
              :width="graph.width"
              :height="graph.height"
              :viewBox="`0 0 ${graph.width} ${graph.height}`"
              role="img"
              aria-label="Граф зависимостей ресурсов"
            >
              <defs>
                <marker id="ia-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                  <path class="ia-arrow" d="M0,0 L8,4 L0,8 z" />
                </marker>
              </defs>
              <path
                v-for="e in graph.edges"
                :key="e.key"
                class="ia-edge"
                :d="`M${e.x1},${e.y1} C${e.x1 - 40},${e.y1} ${e.x2 + 40},${e.y2} ${e.x2},${e.y2}`"
                marker-end="url(#ia-arrow)"
              />
              <g v-for="n in graph.nodes" :key="n.key" :transform="`translate(${n.x},${n.y})`">
                <rect class="ia-node" :class="`ia-node--${n.tone}`" :width="NODE_W" :height="NODE_H" rx="5" />
                <text class="ia-node-name" x="10" y="19">{{ n.key }}</text>
                <text class="ia-node-marks" x="10" y="37">{{ n.marks }}</text>
              </g>
            </svg>
          </div>
        </div>

        <div class="ia-pane">
          <span class="ia-label">порядок apply</span>
          <ol v-if="result.steps.length" class="ia-steps">
            <li v-for="(s, i) in result.steps" :key="i">
              <span class="ia-step"><span :class="`ia-tone-${STEP_TONE[s.step]}`">{{ s.step }}</span> {{ s.addr }}</span>
            </li>
          </ol>
          <span v-else class="ia-head">—</span>
        </div>
      </div>

      <Md class="ia-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.ia-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 18px;
}
.ia-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.ia-notes {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ia-note,
.ia-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.ia-note :deep(code),
.ia-caption :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}

.ia-split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
.ia-split--graph {
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
}
@media (max-width: 860px) {
  .ia-split,
  .ia-split--graph {
    grid-template-columns: minmax(0, 1fr);
  }
}

.ia-pane {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.ia-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.ia-code {
  margin: 0;
  max-height: 520px;
  overflow: auto;
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.6;
  /* Подложка — общая для кода курса (`pre` в base.css, чернильная): цвета ниже — «на чернилах». */
  color: var(--code-fg);
  white-space: pre;
}
.ia-fresh {
  background: var(--warn-wash-on-ink);
  color: var(--tone-warn-on-ink);
  box-shadow: inset 2px 0 0 var(--tone-warn-accent);
}

.ia-plan {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ia-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border-radius: var(--r2);
  background: var(--surface);
}
.ia-plan > *,
.ia-item > *,
.ia-step {
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.55;
  overflow-wrap: anywhere;
}
.ia-head {
  color: var(--text-muted);
}
.ia-line {
  color: var(--ink);
  font-weight: 600;
}
.ia-sym {
  display: inline-block;
  min-width: 2.6em;
}
.ia-force {
  color: var(--tone-err-text);
}
.ia-summary {
  padding: 4px 2px 0;
  color: var(--ink);
  font-weight: 600;
}
.ia-tone-ok {
  color: var(--tone-ok-text);
}
.ia-tone-warn {
  color: var(--tone-warn-text);
}
.ia-tone-err {
  color: var(--tone-err-text);
}
.ia-tone-info {
  color: var(--tone-info-text);
}
.ia-tone-dim {
  color: var(--text-muted);
}

.ia-scroll {
  overflow-x: auto;
}
.ia-svg {
  display: block;
  fill: var(--ink);
}
.ia-edge {
  fill: none;
  stroke: var(--text-muted);
  stroke-width: 1.4;
}
.ia-arrow {
  fill: var(--text-muted);
}
.ia-node {
  stroke-width: 1;
  fill: var(--surface);
  stroke: var(--border-strong);
}
.ia-node--ok {
  fill: var(--tone-ok-bg);
  stroke: var(--tone-ok-line);
}
.ia-node--warn {
  fill: var(--tone-warn-bg);
  stroke: var(--tone-warn-line);
}
.ia-node--err {
  fill: var(--tone-err-bg);
  stroke: var(--tone-err-line);
}
.ia-node--info {
  fill: var(--tone-info-bg);
  stroke: var(--tone-info-line);
}
.ia-node-name {
  font-family: var(--mono);
  font-size: var(--fs-2);
  font-weight: 600;
  fill: var(--ink);
}
.ia-node-marks {
  font-family: var(--mono);
  font-size: var(--fs-2);
  fill: var(--prose);
}

.ia-steps {
  margin: 0;
  padding-left: 1.8em;
  display: flex;
  flex-direction: column;
  gap: 3px;
  color: var(--text-muted);
  font-family: var(--mono);
  font-size: var(--fs-2);
}
.ia-step {
  color: var(--ink);
}
.ia-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.ia-group-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
</style>
