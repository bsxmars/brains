<script setup lang="ts">
/**
 * «Дерево границ»: демо-дерево темы «Suspense и границы ошибок» с переключателями
 * «готов / ждёт / падает» у каждого компонента.
 *
 * Что видно на экране, какая граница сработала и ход рендера считает не компонент, а строка
 * `BOUNDARY_CODE` из темы, собранная `new Function` (`model/run.ts`): `renderRoot` для режима
 * «сейчас» и `loadWaves` для режима «волнами». Та же строка напечатана на странице и сверена
 * `tests/unit/suspense-errors.test.ts` с настоящими React 19.3 и Vue 3.5 на всех сочетаниях.
 * Компонент только раскладывает дерево в строки и красит то, что вернула модель.
 */
import { computed, reactive, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { loadBoundary } from '../model/run';
import type { Mode, Status, TreeNode } from '../model/types';

const props = defineProps<{
  code: string;
  tree: TreeNode;
  /** Компоненты, состояние которых переключает читатель. */
  names: string[];
  presets: { id: string; label: string; status: Record<string, Status> }[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const model = loadBoundary(props.code);

const mode = ref<Mode>('react');
const modeOptions = [
  { value: 'react', label: 'React' },
  { value: 'vue', label: 'Vue' },
];
const view = ref<'now' | 'waves'>('now');
const viewOptions = [
  { value: 'now', label: 'сейчас' },
  { value: 'waves', label: 'волнами' },
];
const preset = ref(props.presets[0]?.id ?? '');
const presetOptions = props.presets.map((p) => ({ value: p.id, label: p.label }));
const statusOptions = [
  { value: 'ok', label: 'готов' },
  { value: 'wait', label: 'ждёт' },
  { value: 'fail', label: 'падает' },
];

const status = reactive<Record<string, Status>>(Object.fromEntries(props.names.map((n) => [n, 'ok' as Status])));

function applyPreset(id: string) {
  preset.value = id;
  const p = props.presets.find((x) => x.id === id);
  if (!p) return;
  for (const n of props.names) status[n] = p.status[n] ?? 'ok';
}
applyPreset(preset.value);

function setStatus(name: string, value: Status) {
  status[name] = value;
  preset.value = '';
}

/** Снимок состояний — модель получает обычный объект, а не реактивный. */
const snapshot = computed(() => ({ ...status }));
const result = computed(() => model.renderRoot(props.tree, snapshot.value, mode.value));
const waves = computed(() => model.loadWaves(props.tree, snapshot.value, mode.value));

interface Row {
  key: string;
  depth: number;
  node: TreeNode;
}
const rows = computed<Row[]>(() => {
  const out: Row[] = [];
  const walk = (node: TreeNode, depth: number, key: string) => {
    out.push({ key, depth, node });
    node.children.forEach((c, i) => walk(c, depth + 1, `${key}.${i}`));
  };
  walk(props.tree, 0, '0');
  return out;
});

const fallbacks = computed(() => {
  const map = new Map<string, 'suspense' | 'boundary'>();
  for (const r of rows.value) if (r.node.type !== 'component') map.set(r.node.fallback, r.node.type);
  return map;
});

/** Подпись состояния узла в дереве — по тому, что модель показала на экране. */
function badge(node: TreeNode): { text: string; tone: 'ok' | 'warn' | 'err' | 'dim' } {
  const shown = result.value.shown;
  if (node.type === 'component') {
    if (shown.includes(node.name)) return { text: 'на экране', tone: 'ok' };
    return { text: 'не видно', tone: 'dim' };
  }
  if (shown.includes(node.fallback)) {
    return node.type === 'suspense' ? { text: 'заглушка', tone: 'warn' } : { text: 'поймала', tone: 'err' };
  }
  // Сработала, но сама спрятана за заглушкой выше: модель записала это в ход рендера.
  const fired = result.value.log.some((line) => line.endsWith(`→ «${node.fallback}»`));
  if (fired) return { text: 'сработала, но не видна', tone: 'dim' };
  return { text: 'не сработала', tone: 'dim' };
}

function screenTone(item: string) {
  const kind = fallbacks.value.get(item);
  return kind === 'suspense' ? 'warn' : kind === 'boundary' ? 'err' : 'ok';
}

const verdict = computed(() => {
  const r = result.value;
  if (r.shown.length === 0) {
    return r.uncaught.length
      ? `Ошибку \`${r.uncaught[0]}\` не поймала ни одна граница: React снял всё дерево.`
      : 'Над ждущим компонентом нет `<Suspense>`: корень ждёт, на экране пусто.';
  }
  if (mode.value === 'vue' && r.uncaught.length) {
    return `\`${r.uncaught.join('`, `')}\` — мимо всех границ: \`app.config.errorHandler\`, на месте компонента пусто, остальное живёт.`;
  }
  return '';
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="bl-toolbar">
        <SegmentedControl v-model="mode" class="l-pills" label="Фреймворк" :options="modeOptions" />
        <SegmentedControl v-model="view" class="l-pills" label="Вид" :options="viewOptions" />
        <SegmentedControl
          :model-value="preset"
          class="l-pills"
          label="Сценарий"
          :options="presetOptions"
          @update:model-value="(v: string) => applyPreset(v)"
        />
      </div>
    </template>

    <div class="bl-body">
      <div class="bl-split">
        <div class="bl-pane">
          <span class="bl-label">дерево</span>
          <ul class="bl-tree" role="list">
            <li
              v-for="r in rows"
              :key="r.key"
              class="bl-node"
              :data-kind="r.node.type"
              :style="{ '--bl-depth': r.depth }"
            >
              <div class="bl-node__head">
                <code v-if="r.node.type === 'component'" class="bl-node__name">&lt;{{ r.node.name }}&gt;</code>
                <code v-else class="bl-node__name">
                  &lt;{{ r.node.type === 'suspense' ? 'Suspense' : 'ErrorBoundary' }}&gt;
                </code>
                <span class="bl-badge" :data-tone="badge(r.node).tone">{{ badge(r.node).text }}</span>
              </div>
              <span v-if="r.node.type !== 'component'" class="bl-node__fallback">«{{ r.node.fallback }}»</span>
              <SegmentedControl
                v-if="r.node.type === 'component' && names.includes(r.node.name)"
                :model-value="status[r.node.name]"
                class="l-pills bl-status"
                :label="`Состояние ${r.node.name}`"
                :options="statusOptions"
                @update:model-value="(v: string) => setStatus(r.node.type === 'component' ? r.node.name : '', v as Status)"
              />
            </li>
          </ul>
        </div>

        <div class="bl-side">
          <div class="bl-pane">
            <span class="bl-label">экран ({{ mode === 'react' ? 'React' : 'Vue' }})</span>
            <div v-if="result.shown.length" class="bl-screen">
              <span v-for="(item, i) in result.shown" :key="i" class="bl-chip" :data-tone="screenTone(item)">{{ item }}</span>
            </div>
            <p v-else class="bl-empty">пусто</p>
            <Md v-if="verdict" class="bl-verdict" :text="verdict" />
          </div>

          <div v-if="view === 'now'" class="bl-pane">
            <span class="bl-label">ход рендера</span>
            <ol class="bl-log">
              <li v-for="(line, i) in result.log" :key="i">{{ line }}</li>
              <li v-if="!result.log.length">никто ничего не бросил</li>
            </ol>
          </div>

          <div v-else class="bl-pane">
            <span class="bl-label">волны загрузки</span>
            <ol class="bl-waves">
              <li v-for="(w, i) in waves" :key="i" class="bl-wave">
                <span class="bl-wave__head">
                  {{ i + 1 }}.
                  <template v-if="w.started.length">начали грузить: <code>{{ w.started.join(', ') }}</code></template>
                  <template v-else>новых загрузок нет</template>
                </span>
                <span class="bl-wave__screen">
                  <span v-for="(item, j) in w.shown" :key="j" class="bl-chip" :data-tone="screenTone(item)">{{ item }}</span>
                  <span v-if="!w.shown.length" class="bl-empty">пусто</span>
                </span>
              </li>
            </ol>
          </div>
        </div>
      </div>

      <Md class="bl-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.bl-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 18px;
}
.bl-toolbar :deep(.aura-segmented),
.bl-status {
  flex-wrap: wrap;
}
.bl-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.bl-split {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 820px) {
  .bl-split {
    grid-template-columns: minmax(0, 1fr);
  }
}
.bl-side {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}
.bl-pane {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.bl-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.bl-tree {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.bl-node {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-left: calc(var(--bl-depth) * 14px);
  padding: 8px 10px;
  border-radius: var(--r2);
  border: 1px solid var(--border);
  background: var(--surface);
  min-width: 0;
}
.bl-node[data-kind='suspense'] {
  border-color: var(--tone-warn-line);
}
.bl-node[data-kind='boundary'] {
  border-color: var(--tone-err-line);
}
.bl-node__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px 10px;
}
.bl-node__name {
  font-family: var(--mono);
  font-size: var(--fs-3);
  font-weight: 600;
  color: var(--ink);
}
.bl-node__fallback {
  font-size: var(--fs-3);
  color: var(--prose);
  overflow-wrap: anywhere;
}

.bl-badge,
.bl-chip {
  display: inline-block;
  padding: 2px 8px;
  border-radius: var(--r1);
  font-family: var(--mono);
  font-size: var(--fs-2);
  border: 1px solid transparent;
}
.bl-badge[data-tone='ok'],
.bl-chip[data-tone='ok'] {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
  border-color: var(--tone-ok-line);
}
.bl-badge[data-tone='warn'],
.bl-chip[data-tone='warn'] {
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
  border-color: var(--tone-warn-line);
}
.bl-badge[data-tone='err'],
.bl-chip[data-tone='err'] {
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
  border-color: var(--tone-err-line);
}
.bl-badge[data-tone='dim'] {
  background: var(--surface-3);
  color: var(--text-muted);
}
.bl-chip {
  font-size: var(--fs-3);
}

.bl-screen,
.bl-wave__screen {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.bl-empty {
  margin: 0;
  font-size: var(--fs-3);
  color: var(--text-muted);
}
.bl-verdict,
.bl-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.bl-verdict :deep(code),
.bl-caption :deep(code),
.bl-wave__head code {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}

.bl-log,
.bl-waves {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding-left: 1.4em;
  font-size: var(--fs-3);
  line-height: 1.5;
  color: var(--prose);
}
.bl-log li {
  font-family: var(--mono);
  font-size: var(--fs-2);
  overflow-wrap: anywhere;
}
.bl-waves {
  list-style: none;
  padding-left: 0;
  gap: 10px;
}
.bl-wave {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.bl-wave__head {
  color: var(--prose);
}
</style>
