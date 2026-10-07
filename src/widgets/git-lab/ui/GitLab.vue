<script setup lang="ts">
/**
 * «Граф коммитов руками»: commit, переключение веток, merge, rebase и reset на учебном
 * репозитории из сквозного примера темы. Видно, какие объекты пишет каждая команда, какие
 * хеши появляются, какие коммиты остаются только в reflog.
 *
 * Хеши, деревья, общий предок и слияние по файлам считает строка `GIT_CODE` из темы,
 * собранная `new Function` (`model/run.ts`); команды раскладывает `model/repo.ts`. Тест
 * `tests/unit/git-internals.test.ts` повторяет шаги в настоящем git и сверяет ссылки, число
 * объектов и reflog после каждого. Компонент только рисует состояние.
 */
import { computed, nextTick, onMounted, ref, shallowRef, triggerRef } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button } from '@/shared/ui';
import { apply, createRepo, objects, reachable, type Op } from '../model/repo';
import { loadGit } from '../model/run';
import { sha1 } from '../model/sha1';
import type { CommitNode, StepResult } from '../model/types';

const props = defineProps<{
  gitCode: string;
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const ctx = { api: loadGit(props.gitCode), sha1 };

const START_NOTE =
  'Сквозной пример: `init` на main, `add cart` на feature, `docs` на main — 12 объектов, те же хеши, что у git. Сейчас `HEAD` указывает на main.';

const repo = shallowRef(createRepo(ctx).repo);
const last = ref<StepResult | null>(null);
const graph = ref<HTMLElement | null>(null);
const selected = ref<string>(repo.value.refs.main);

function run(op: Op) {
  const step = apply(ctx, repo.value, op);
  last.value = step;
  selected.value = repo.value.refs[repo.value.head];
  triggerRef(repo);
  // Новая вершина — справа: подтянуть к ней прокрутку графа.
  void nextTick(() => graph.value?.scrollTo({ left: graph.value.scrollWidth }));
}

// На узком экране граф шире рамки: показать сразу правый край, где вершины веток.
onMounted(() => graph.value?.scrollTo({ left: graph.value.scrollWidth }));

function restart() {
  repo.value = createRepo(ctx).repo;
  last.value = null;
  selected.value = repo.value.refs.main;
}

const other = computed(() => (repo.value.head === 'main' ? 'feature' : 'main'));
const short = (h: string) => h.slice(0, 7);

const live = computed(() => reachable(ctx, repo.value));
const commits = computed(() => [...repo.value.commits.values()].sort((a, b) => a.seq - b.seq));
const fresh = computed(() => new Set((last.value?.created ?? []).map((o) => o.hash)));

// ─── Граф ─────────────────────────────────────────────────────────────────────────────────
const STEP = 84;
const LEFT = 96;
const LANE_Y = [44, 120];
// Справа — запас под ярлык «HEAD → main, feature», он шире шага между вершинами.
const width = computed(() => LEFT + Math.max(commits.value.length - 1, 4) * STEP + 110);
const HEIGHT = 176;

const pos = (c: CommitNode) => ({ x: LEFT + c.seq * STEP, y: LANE_Y[c.lane] });

const edges = computed(() =>
  commits.value.flatMap((c) =>
    c.parents
      .map((p) => repo.value.commits.get(p))
      .filter((p): p is CommitNode => Boolean(p))
      .map((p) => {
        const a = pos(p);
        const b = pos(c);
        const mid = (a.x + b.x) / 2;
        return {
          key: `${p.hash}-${c.hash}`,
          d: a.y === b.y ? `M${a.x},${a.y} L${b.x},${b.y}` : `M${a.x},${a.y} C${mid},${a.y} ${mid},${b.y} ${b.x},${b.y}`,
          dead: !live.value.has(c.hash),
        };
      }),
  ),
);

/** Ярлыки веток у вершин; `HEAD` — у текущей. Две ветки на одном коммите — одним ярлыком. */
const labels = computed(() => {
  const at = new Map<string, string[]>();
  for (const b of ['main', 'feature'] as const) {
    const h = repo.value.refs[b];
    if (!h) continue;
    at.set(h, [...(at.get(h) ?? []), repo.value.head === b ? `HEAD → ${b}` : b]);
  }
  return [...at].map(([h, names]) => {
    const c = repo.value.commits.get(h) as CommitNode;
    const p = pos(c);
    return { key: h, x: p.x, y: c.lane === 0 ? p.y - 22 : p.y + 34, text: names.join(', '), head: names.some((n) => n.startsWith('HEAD')) };
  });
});

const picked = computed(() => repo.value.commits.get(selected.value) ?? null);

/** Как `git reflog`: свежие строки сверху, `HEAD@{n}`. */
const reflog = computed(() =>
  repo.value.reflog
    .map((e, i, all) => `${short(e.to)} HEAD@{${all.length - 1 - i}}: ${e.what}`)
    .reverse()
    .slice(0, 7)
    .join('\n'),
);

const note = computed(() => last.value?.note ?? START_NOTE);
const total = computed(() => `В хранилище ${objects(repo.value.objects.size)}.`);

function pick(c: CommitNode) {
  selected.value = c.hash;
}
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="gl-tools" role="group" aria-label="Команды git">
        <Button variant="primary" @click="run('commit')">commit</Button>
        <Button variant="secondary" @click="run('switch')">switch {{ other }}</Button>
        <Button variant="secondary" @click="run('merge')">merge {{ other }}</Button>
        <Button variant="secondary" @click="run('rebase')">rebase {{ other }}</Button>
        <Button variant="secondary" @click="run('reset')">reset HEAD~1</Button>
        <Button variant="secondary" @click="restart">сначала</Button>
      </div>
    </template>

    <div class="gl-body">
      <div ref="graph" class="gl-graph" tabindex="0" aria-label="Граф коммитов, прокручивается по горизонтали">
        <svg
          class="gl-svg"
          :width="width"
          :height="HEIGHT"
          :viewBox="`0 0 ${width} ${HEIGHT}`"
          role="img"
          :aria-label="`Граф: ${commits.length} коммитов, HEAD на ${repo.head}`"
        >
          <text class="gl-lane" x="4" :y="LANE_Y[0] + 4">main</text>
          <text class="gl-lane" x="4" :y="LANE_Y[1] + 4">feature</text>
          <path v-for="e in edges" :key="e.key" :d="e.d" class="gl-edge" :data-dead="e.dead ? 'yes' : 'no'" />
          <g
            v-for="c in commits"
            :key="c.hash"
            class="gl-node"
            :data-dead="live.has(c.hash) ? 'no' : 'yes'"
            :data-new="fresh.has(c.hash) ? 'yes' : 'no'"
            :data-on="c.hash === selected ? 'yes' : 'no'"
            role="button"
            tabindex="0"
            :aria-label="`Коммит ${short(c.hash)} ${c.message}`"
            @click="pick(c)"
            @keydown.enter.prevent="pick(c)"
            @keydown.space.prevent="pick(c)"
          >
            <title>{{ short(c.hash) }} {{ c.message }}</title>
            <circle :cx="pos(c).x" :cy="pos(c).y" :r="c.parents.length > 1 ? 11 : 9" class="gl-dot" />
            <text :x="pos(c).x" :y="pos(c).y + (c.lane === 0 ? 26 : -18)" class="gl-hash" text-anchor="middle">{{ short(c.hash) }}</text>
          </g>
          <text v-for="l in labels" :key="l.key" :x="l.x" :y="l.y" class="gl-ref" :data-head="l.head ? 'yes' : 'no'" text-anchor="middle">{{ l.text }}</text>
        </svg>
      </div>

      <div class="gl-split">
        <div class="gl-pane">
          <span class="gl-label">последняя команда</span>
          <code class="gl-cmd">$ {{ last?.command ?? 'git log --graph --all' }}</code>
          <Md class="gl-note" :text="note" />
          <ul v-if="last && last.created.length" class="gl-objs" aria-label="Новые объекты">
            <li v-for="o in last.created" :key="o.hash" class="gl-obj">
              <span class="gl-type" :data-type="o.type">{{ o.type }}</span>
              <code>{{ short(o.hash) }}</code>
              <span class="gl-obj-label">{{ o.label }}</span>
              <span class="gl-size">{{ o.size }} Б</span>
            </li>
          </ul>
          <Md class="gl-note gl-total" :text="total" />
        </div>

        <div class="gl-pane">
          <span class="gl-label">git cat-file -p {{ picked ? short(picked.hash) : '' }}</span>
          <pre class="gl-code">{{ picked?.text ?? '' }}</pre>
          <span class="gl-label">git reflog</span>
          <pre class="gl-code">{{ reflog }}</pre>
        </div>
      </div>

      <Md class="gl-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.gl-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.gl-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.gl-caption,
.gl-note {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.gl-caption :deep(code),
.gl-note :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
.gl-total {
  color: var(--text-muted);
}

.gl-graph {
  overflow-x: auto;
  padding: 4px 0;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.gl-graph:focus-visible {
  outline: 2px solid var(--tone-info-line);
}
.gl-svg {
  display: block;
  fill: var(--ink);
}
.gl-lane {
  font-family: var(--mono);
  font-size: var(--fs-2);
  fill: var(--text-muted);
}
.gl-edge {
  fill: none;
  stroke: var(--border-strong);
  stroke-width: 2;
}
.gl-edge[data-dead='yes'] {
  stroke-dasharray: 4 4;
}
.gl-node {
  cursor: pointer;
}
.gl-node:focus-visible {
  outline: none;
}
.gl-dot {
  fill: var(--surface);
  stroke: var(--ink);
  stroke-width: 2;
}
.gl-node[data-new='yes'] .gl-dot {
  fill: var(--tone-ok-chip);
  stroke: var(--tone-ok-strong);
}
.gl-node[data-dead='yes'] .gl-dot {
  fill: var(--surface-2);
  stroke: var(--ghost);
  stroke-dasharray: 3 3;
}
.gl-node[data-on='yes'] .gl-dot,
.gl-node:focus-visible .gl-dot {
  stroke: var(--tone-warn-accent);
  stroke-width: 3;
}
.gl-hash {
  font-family: var(--mono);
  font-size: var(--fs-2);
  fill: var(--prose);
}
.gl-node[data-dead='yes'] .gl-hash {
  fill: var(--dim);
}
.gl-ref {
  font-family: var(--mono);
  font-size: var(--fs-2);
  font-weight: 600;
  fill: var(--tone-info-strong);
}
.gl-ref[data-head='yes'] {
  fill: var(--tone-warn-strong);
}

.gl-split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 760px) {
  .gl-split {
    grid-template-columns: minmax(0, 1fr);
  }
}
.gl-pane {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.gl-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.gl-cmd {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
  overflow-wrap: anywhere;
}
.gl-objs {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.gl-obj {
  display: grid;
  grid-template-columns: 4.6em 5.2em minmax(0, 1fr) auto;
  gap: 8px;
  align-items: baseline;
  padding: 4px 8px;
  border-radius: var(--r1);
  background: var(--surface);
  font-size: var(--fs-3);
  color: var(--prose);
}
.gl-obj code {
  font-family: var(--mono);
  color: var(--ink);
}
.gl-type {
  font-family: var(--mono);
  font-size: var(--fs-2);
  padding: 1px 6px;
  border-radius: var(--r1);
  text-align: center;
}
.gl-type[data-type='blob'] {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.gl-type[data-type='tree'] {
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
}
.gl-type[data-type='commit'] {
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.gl-obj-label {
  overflow-wrap: anywhere;
}
.gl-size {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.gl-code {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--code-fg);
  white-space: pre;
  overflow-x: auto;
}
</style>
