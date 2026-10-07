<script setup lang="ts">
/**
 * «Что пересобрать»: правка из стенда → изменённые пакеты → их зависимые, разложенные
 * по уровням графа. Отметка внизу сравнивает ответ с выборкой настоящего
 * `pnpm --filter "...[origin/main]"` на той же правке (`preset.pnpm`, снят стендом).
 *
 * Считает не компонент, а строка `GRAPH_CODE` из темы, собранная `new Function`
 * (`model/run.ts`). Те же функции `tests/unit/monorepo.test.ts` сверяет со всеми правками стенда.
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { loadGraph } from '../model/run';
import type { FilterPreset, WsPackage } from '../model/types';

const props = defineProps<{
  graphCode: string;
  packages: WsPackage[];
  presets: FilterPreset[];
  /** Имя корневого проекта: ему достаются файлы вне пакетов. */
  rootName: string;
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const graph = loadGraph(props.graphCode);
const levels = graph.topoLevels(props.packages);

const picked = ref(props.presets[0].id);
const options = props.presets.map((p) => ({ value: p.id, label: p.label }));
const preset = computed(() => props.presets.find((p) => p.id === picked.value) ?? props.presets[0]);

const result = computed(() => graph.affected(props.packages, preset.value.files, props.rootName));

type State = 'changed' | 'dependent' | 'skip';
const STATE_LABEL: Record<State, string> = { changed: 'изменён', dependent: 'зависимый', skip: 'не нужен' };

function stateOf(name: string): State {
  if (result.value.changed.includes(name)) return 'changed';
  if (result.value.withDependents.includes(name)) return 'dependent';
  return 'skip';
}

const short = (name: string) => name.replace('@shop/', '');
const depsOf = (name: string) => props.packages.find((p) => p.name === name)?.deps.map(short) ?? [];

/** Порядок сборки выборки: уровни графа, из которых убрано лишнее. */
const order = computed(() =>
  levels.map((l) => l.filter((n) => result.value.withDependents.includes(n))).filter((l) => l.length > 0),
);
const rootOnly = computed(() => result.value.withDependents.length === 1 && result.value.withDependents[0] === props.rootName);

const same = computed(() => JSON.stringify(result.value.withDependents) === JSON.stringify(preset.value.pnpm));
const pnpmLine = computed(() => `pnpm выбрал: ${preset.value.pnpm.map((n) => '`' + n + '`').join(', ')}`);
const orderLine = computed(() =>
  rootOnly.value
    ? 'Собирать нечего: ни один пакет не изменён, корневой проект своей сборки не имеет.'
    : 'Порядок сборки: ' + order.value.map((l) => l.map((n) => '`' + short(n) + '`').join(' и ')).join(' → '),
);
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="picked" class="l-pills" label="Где правка" :options="options" />
    </template>

    <div class="mra-body">
      <Md class="mra-note" :text="preset.note" />

      <div class="mra-files">
        <span class="mra-label">изменённые файлы</span>
        <code v-for="f in preset.files" :key="f" class="mra-file">{{ f }}</code>
      </div>

      <div class="mra-scroll">
        <div class="mra-levels" :style="{ '--mra-cols': levels.length }">
          <section v-for="(level, i) in levels" :key="i" class="mra-level" :aria-label="`Уровень ${i}`">
            <span class="mra-label">уровень {{ i }}</span>
            <div v-for="name in level" :key="name" class="mra-pkg" :data-state="stateOf(name)">
              <span class="mra-pkg__name">{{ short(name) }}</span>
              <span class="mra-pkg__deps">{{ depsOf(name).length ? '← ' + depsOf(name).join(', ') : 'без соседей' }}</span>
              <span class="mra-pkg__state">{{ STATE_LABEL[stateOf(name)] }}</span>
            </div>
          </section>
        </div>
      </div>

      <div class="mra-verdict-row">
        <Md class="mra-order" :text="orderLine" />
        <Md class="mra-pnpm" :text="pnpmLine" />
        <span class="mra-verdict" :data-ok="same ? 'yes' : 'no'">
          {{ same ? 'affected из темы = pnpm --filter' : 'affected из темы расходится с pnpm' }}
        </span>
      </div>

      <Md class="mra-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.mra-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.mra-note,
.mra-caption,
.mra-order,
.mra-pnpm {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.mra-note :deep(code),
.mra-caption :deep(code),
.mra-order :deep(code),
.mra-pnpm :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
.mra-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.mra-files {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px 12px;
}
.mra-file {
  font-family: var(--mono);
  font-size: var(--fs-3);
  padding: 2px 8px;
  border-radius: var(--r2);
  background: var(--surface-3);
  color: var(--ink);
  overflow-wrap: anywhere;
}

.mra-scroll {
  overflow-x: auto;
  min-width: 0;
}
.mra-levels {
  display: grid;
  grid-template-columns: repeat(var(--mra-cols), minmax(170px, 1fr));
  gap: 12px;
  min-width: 540px;
}
@media (max-width: 640px) {
  .mra-levels {
    grid-template-columns: minmax(0, 1fr);
    min-width: 0;
  }
}
.mra-level {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.mra-pkg {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border-radius: var(--r2);
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--prose);
}
.mra-pkg__name {
  font-family: var(--mono);
  font-size: var(--fs-4);
  font-weight: 600;
  color: var(--ink);
}
.mra-pkg__deps {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.mra-pkg__state {
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.mra-pkg[data-state='changed'] {
  background: var(--tone-warn-bg);
  border-color: var(--tone-warn-line);
}
.mra-pkg[data-state='changed'] .mra-pkg__state {
  color: var(--tone-warn-text);
  font-weight: 600;
}
.mra-pkg[data-state='dependent'] {
  background: var(--tone-info-bg);
  border-color: var(--tone-info-line);
}
.mra-pkg[data-state='dependent'] .mra-pkg__state {
  color: var(--tone-info-text);
  font-weight: 600;
}
.mra-pkg[data-state='skip'] .mra-pkg__name {
  color: var(--text-muted);
}

.mra-verdict-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.mra-verdict {
  align-self: flex-start;
  font-family: var(--mono);
  font-size: var(--fs-2);
  padding: 3px 8px;
  border-radius: var(--r2);
}
.mra-verdict[data-ok='yes'] {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.mra-verdict[data-ok='no'] {
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}
</style>
