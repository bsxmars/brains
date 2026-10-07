<script setup lang="ts">
/**
 * «Где остановится правка»: граф фикстуры стенда, переключатель «где стоит accept» и клик
 * по модулю как правка файла.
 *
 * Ответ считает не компонент, а строка `FIND_BOUNDARY_CODE` из темы, собранная `new Function`
 * (`model/run.ts`). Та же строка напечатана на странице и прогоняется `tests/unit/hmr.test.ts`
 * против журналов настоящего Vite 8.3.0. Где сочетание «вариант + правка» было на стенде,
 * рядом с вычисленным показан снятый журнал — как есть, из данных темы.
 *
 * Сборка функции дешёвая (одна строка в полсотни строк), поэтому живёт в `setup`.
 */
import { computed, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { loadFindBoundary } from '../model/run';
import type { DemoVariant, HmrJournal, NodePos, TraceStep, VariantId } from '../model/types';

const props = defineProps<{
  code: string;
  variants: DemoVariant[];
  pos: Record<string, NodePos>;
  journals: HmrJournal[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const findBoundary = loadFindBoundary(props.code);

const W = 150;
const H = 44;

const picked = ref<VariantId>(props.variants[0].id);
const options = props.variants.map((v) => ({ value: v.id, label: v.label }));
const variant = computed(() => props.variants.find((v) => v.id === picked.value) ?? props.variants[0]);
const graph = computed(() => variant.value.graph);

const changed = ref('/utils.js');
watch(graph, (g) => {
  if (!g[changed.value]) changed.value = '/utils.js';
});

const result = computed(() => findBoundary(graph.value, changed.value));

const journal = computed(() =>
  props.journals.find((j) => j.variant === picked.value && j.changed === changed.value),
);

const short = (url: string) => url.replace(/^\//, '');

function acceptLabel(url: string): string {
  const a = graph.value[url]?.accept;
  if (!a) return '';
  if (a === 'self') return url.endsWith('.css') ? 'accept() от Vite' : 'accept()';
  return a.map((d) => `accept('./${short(d)}')`).join(' ');
}

type Role = 'changed' | 'boundary' | 'accepted' | 'dead' | 'path' | 'idle';

const roles = computed<Record<string, Role>>(() => {
  const r = result.value;
  const out: Record<string, Role> = {};
  for (const url of Object.keys(graph.value)) out[url] = 'idle';
  // Роли — из хода подъёма: граница остаётся границей и тогда, когда тупик на соседней
  // ветке всё равно привёл к перезагрузке.
  for (const s of r.trace) {
    if (s.step === 'self') out[s.url] = 'boundary';
    else if (s.step === 'accepts-dep') {
      out[s.url] = 'boundary';
      out[s.dep] = 'accepted';
    } else if (out[s.url] === 'idle') out[s.url] = 'path';
  }
  if (r.reload && r.deadEnd) for (const url of r.deadEnd) out[url] = 'dead';
  if (out[changed.value] !== 'boundary' && out[changed.value] !== 'accepted') out[changed.value] = 'changed';
  return out;
});

const refetchSet = computed(() => new Set(result.value.refetch));

interface Edge {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  hot: boolean;
}

/** Точка на краю прямоугольника узла по направлению к другой точке. */
function clip(c: NodePos, to: NodePos): NodePos {
  const dx = to.x - c.x;
  const dy = to.y - c.y;
  const k = Math.min(dx === 0 ? Infinity : W / 2 / Math.abs(dx), dy === 0 ? Infinity : H / 2 / Math.abs(dy));
  return { x: c.x + dx * k, y: c.y + dy * k };
}

const onPath = computed(() => new Set(result.value.trace.map((s) => s.url)));

const edges = computed<Edge[]>(() => {
  const out: Edge[] = [];
  for (const [from, mod] of Object.entries(graph.value)) {
    for (const to of mod.imports) {
      const a = props.pos[from];
      const b = props.pos[to];
      if (!a || !b) continue;
      const p = clip(a, b);
      const q = clip(b, a);
      // Подсвечено ребро, по которому подъём прошёл: зависимость на пути, импортёр тоже.
      const hot = onPath.value.has(to) && (onPath.value.has(from) || roles.value[from] !== 'idle');
      out.push({ key: `${from}>${to}`, x1: p.x, y1: p.y, x2: q.x, y2: q.y, hot });
    }
  }
  return out;
});

const nodes = computed(() =>
  Object.keys(graph.value).map((url) => ({
    url,
    ...props.pos[url],
    name: short(url),
    accept: acceptLabel(url),
    role: roles.value[url],
    refetch: refetchSet.value.has(url),
  })),
);

const tick = (u: string) => `\`${short(u)}\``;

function stepText(s: TraceStep): string {
  switch (s.step) {
    case 'self':
      return `${tick(s.url)} принимает себя — **граница**, выше по этой ветке не идём`;
    case 'accepts-dep':
      return `${tick(s.url)} принимает ${tick(s.dep)} — **граница**`;
    case 'up':
      return `${tick(s.url)} себя не принимает; импортёры: ${s.to.map(tick).join(', ')}`;
    case 'dead-end':
      return `${tick(s.url)} — импортёров нет, никто не принял: **тупик**`;
  }
}

const verdict = computed(() => {
  const r = result.value;
  if (r.reload) {
    return {
      tone: 'err',
      title: 'Полная перезагрузка',
      sub: `тупик: ${(r.deadEnd ?? []).map(tick).join(' → ')}`,
    };
  }
  const ups = r.payload.type === 'update' ? r.payload.updates : [];
  return {
    tone: 'ok',
    title: 'Обновление без перезагрузки',
    sub: ups
      .map((u) => (u.path === u.acceptedPath ? `${tick(u.path)} исполнится заново` : `${tick(u.path)} получит новый ${tick(u.acceptedPath)}`))
      .join('; '),
  };
});

const refetchText = computed(() =>
  result.value.refetch.length
    ? `Браузер запросит заново: ${result.value.refetch.map((u) => `\`${u}?t=…\``).join(', ')}`
    : 'Модули по новым адресам не запрашиваются: страница загрузится целиком.',
);

const payloadJson = computed(() => JSON.stringify(result.value.payload, null, 2));
const journalJson = computed(() =>
  journal.value ? journal.value.messages.map((m) => JSON.stringify(m)).join('\n') : '',
);

function pick(url: string) {
  changed.value = url;
}
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="picked" class="l-pills" label="Где стоит accept" :options="options" />
    </template>

    <div class="hmr-body">
      <Md class="hmr-note" :text="variant.note" />

      <div class="hmr-split">
        <div class="hmr-graph">
          <span class="hmr-label">кликните модуль — это правка файла</span>
          <div class="hmr-scroll">
          <svg class="hmr-svg" viewBox="105 6 420 318" role="group" aria-label="Граф модулей фикстуры">
            <defs>
              <marker id="hmr-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path class="hmr-arrowhead" d="M 0 0 L 10 5 L 0 10 z" />
              </marker>
              <marker id="hmr-arrow-hot" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path class="hmr-arrowhead hmr-arrowhead--hot" d="M 0 0 L 10 5 L 0 10 z" />
              </marker>
            </defs>
            <line
              v-for="e in edges"
              :key="e.key"
              class="hmr-edge"
              :data-hot="e.hot ? 'yes' : 'no'"
              :x1="e.x1"
              :y1="e.y1"
              :x2="e.x2"
              :y2="e.y2"
              :marker-end="e.hot ? 'url(#hmr-arrow-hot)' : 'url(#hmr-arrow)'"
            />
            <g
              v-for="n in nodes"
              :key="n.url"
              class="hmr-node"
              :data-role="n.role"
              role="button"
              tabindex="0"
              :aria-pressed="n.url === changed"
              :aria-label="`Править ${n.name}`"
              @click="pick(n.url)"
              @keydown.enter.prevent="pick(n.url)"
              @keydown.space.prevent="pick(n.url)"
            >
              <rect class="hmr-node__box" :x="n.x - W / 2" :y="n.y - H / 2" :width="W" :height="H" rx="8" />
              <text class="hmr-node__name" :x="n.x" :y="n.accept ? n.y - 3 : n.y + 5" text-anchor="middle">{{ n.name }}</text>
              <text v-if="n.accept" class="hmr-node__accept" :x="n.x" :y="n.y + 13" text-anchor="middle">{{ n.accept }}</text>
              <text v-if="n.refetch" class="hmr-node__t" :x="n.x + W / 2 + 4" :y="n.y - 10">?t=</text>
            </g>
          </svg>
          </div>
          <div class="hmr-legend">
            <span class="hmr-chip" data-role="changed">правка</span>
            <span class="hmr-chip" data-role="path">путь вверх</span>
            <span class="hmr-chip" data-role="boundary">граница</span>
            <span class="hmr-chip" data-role="dead">тупик</span>
            <span class="hmr-chip hmr-chip--t">?t= перезапрос</span>
          </div>
        </div>

        <div class="hmr-side">
          <div class="hmr-verdict" :data-tone="verdict.tone">
            <span class="hmr-verdict__title">{{ verdict.title }}</span>
            <Md class="hmr-verdict__sub" :text="verdict.sub" />
          </div>

          <ol class="hmr-steps">
            <li v-for="(s, i) in result.trace" :key="i"><Md as="span" :text="stepText(s)" /></li>
          </ol>

          <Md class="hmr-refetch" :text="refetchText" />

          <span class="hmr-label">что вернула функция</span>
          <pre class="hmr-pre">{{ payloadJson }}</pre>

          <div v-if="journal" class="hmr-journal">
            <span class="hmr-label">снято стендом · Vite 8.3.0</span>
            <pre class="hmr-pre">{{ journalJson }}</pre>
            <span class="hmr-journal__line">терминал: <code>{{ journal.log.join(' · ') }}</code></span>
            <span class="hmr-journal__line">кнопка: <code>{{ journal.before }}</code> → <code>{{ journal.after }}</code></span>
          </div>
          <span v-else class="hmr-label">это сочетание на стенде не прогонялось</span>
        </div>
      </div>
    </div>

    <template #footer>
      <Md class="hmr-caption" :text="caption" />
    </template>
  </DemoFrame>
</template>

<style scoped>
.hmr-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.hmr-note {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.hmr-note :deep(code),
.hmr-verdict :deep(code),
.hmr-steps :deep(code),
.hmr-refetch :deep(code),
.hmr-caption :deep(code),
.hmr-journal__line code {
  font-family: var(--mono);
  /* Не ниже ступени `--fs-2`: в подписи на `--fs-2` доля .92em давала 10.9px. */
  font-size: max(0.92em, var(--fs-2));
}

.hmr-split {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
  gap: 18px;
  align-items: start;
}
@media (max-width: 760px) {
  .hmr-split {
    grid-template-columns: minmax(0, 1fr);
  }
}

.hmr-graph {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.hmr-scroll {
  overflow-x: auto;
}
/* На телефоне схема не сжимается мельче читаемого: ниже 360px её прокручивают. */
.hmr-svg {
  display: block;
  width: 100%;
  min-width: 360px;
  height: auto;
  /* Без явной заливки корень SVG получает чёрный по умолчанию — цвет мимо theme.ts
     (ловит palette.spec). Фигуры красятся своими классами, остальное наследует чернила. */
  fill: var(--ink);
}
.hmr-label {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}

.hmr-edge {
  stroke: var(--border-strong);
  stroke-width: 1.5;
}
.hmr-edge[data-hot='yes'] {
  stroke: var(--tone-info-strong);
  stroke-width: 2.5;
}
.hmr-arrowhead {
  fill: var(--border-strong);
}
.hmr-arrowhead--hot {
  fill: var(--tone-info-strong);
}

.hmr-node {
  cursor: pointer;
}
.hmr-node:focus {
  outline: none;
}
.hmr-node:focus-visible .hmr-node__box {
  stroke: var(--ink);
  stroke-width: 2.5;
}
.hmr-node__box {
  fill: var(--surface);
  stroke: var(--border-strong);
  stroke-width: 1;
}
.hmr-node__name {
  font-family: var(--mono);
  font-size: var(--fs-4);
  fill: var(--ink);
}
.hmr-node__accept {
  font-family: var(--mono);
  font-size: var(--fs-1);
  fill: var(--text-muted);
}
.hmr-node__t {
  font-family: var(--mono);
  font-size: var(--fs-2);
  font-weight: 600;
  fill: var(--tone-info-text);
}
.hmr-node[data-role='path'] .hmr-node__box {
  fill: var(--tone-info-bg);
  stroke: var(--tone-info-line);
}
.hmr-node[data-role='changed'] .hmr-node__box {
  fill: var(--tone-warn-bg);
  stroke: var(--tone-warn-line);
  stroke-width: 2;
}
.hmr-node[data-role='boundary'] .hmr-node__box,
.hmr-node[data-role='accepted'] .hmr-node__box {
  fill: var(--tone-ok-bg);
  stroke: var(--tone-ok-line);
  stroke-width: 2;
}
.hmr-node[data-role='dead'] .hmr-node__box {
  fill: var(--tone-err-bg);
  stroke: var(--tone-err-line);
  stroke-width: 2;
}

.hmr-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.hmr-chip {
  padding: 2px 8px;
  border-radius: var(--r-full);
  font-family: var(--mono);
  font-size: var(--fs-3);
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--chip-text);
}
.hmr-chip[data-role='changed'] {
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.hmr-chip[data-role='path'] {
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
}
.hmr-chip[data-role='boundary'] {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.hmr-chip[data-role='dead'] {
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}
.hmr-chip--t {
  color: var(--tone-info-text);
}

.hmr-side {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.hmr-verdict {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  border-radius: var(--r2);
  font-size: var(--fs-3);
  line-height: 1.5;
}
.hmr-verdict__title {
  font-family: var(--mono);
  font-size: var(--fs-5);
  font-weight: 600;
}
.hmr-verdict__sub {
  font-size: var(--fs-2);
  overflow-wrap: anywhere;
}
.hmr-verdict[data-tone='ok'] {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.hmr-verdict[data-tone='err'] {
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}

.hmr-steps {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin: 0;
  padding-left: 20px;
  font-size: var(--fs-2);
  line-height: 1.55;
  color: var(--prose);
}
.hmr-refetch {
  font-size: var(--fs-2);
  line-height: 1.55;
  color: var(--prose);
  overflow-wrap: anywhere;
}
.hmr-pre {
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--r2);
  background: var(--surface-2);
  color: var(--ink);
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.hmr-journal {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  border-radius: var(--r3);
  border: 1px dashed var(--tone-ok-line);
}
.hmr-journal__line {
  font-size: var(--fs-2);
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

.hmr-caption {
  font-size: var(--fs-2);
  line-height: 1.55;
  color: var(--text-muted);
}

/* Код внутри мелкой подписи: базовое `code { font-size: .86em }` уводило его ниже 11px.
   Пол — ступень `--fs-2`. */
.hmr-verdict__sub :deep(code),
.hmr-steps :deep(code) {
  font-size: max(0.86em, var(--fs-2));
}
</style>
