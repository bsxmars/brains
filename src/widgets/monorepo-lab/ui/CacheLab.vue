<script setup lang="ts">
/**
 * «Отравленный кеш»: два прогона сборки подряд с общим кешем — для стейджинга и для
 * продакшена — в трёх настройках кеша. По каждому пакету: начало ключа, попадание или промах;
 * под таблицей — что оказалось в бандле `web`.
 *
 * Считает не компонент, а строки `CACHE_CODE` (настоящий SHA-256 через `crypto.subtle`)
 * и `GRAPH_CODE` из темы, собранные `new Function` (`model/run.ts`). Тот же расчёт
 * `tests/unit/monorepo.test.ts` проверяет во всех трёх режимах.
 */
import { computed, onMounted, ref, shallowRef, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { loadCache, loadGraph, playRuns } from '../model/run';
import type { CacheLogEntry, CacheMode, CacheRun, WsPackage } from '../model/types';

const props = defineProps<{
  cacheCode: string;
  graphCode: string;
  packages: WsPackage[];
  files: Record<string, Record<string, string>>;
  runs: CacheRun[];
  modes: CacheMode[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const api = loadCache(props.cacheCode);
const levels = loadGraph(props.graphCode).topoLevels(props.packages);
const order = levels.flat();

const picked = ref(props.modes[0].id);
const options = props.modes.map((m) => ({ value: m.id, label: m.label }));
const mode = computed(() => props.modes.find((m) => m.id === picked.value) ?? props.modes[0]);

/** Журналы прогонов; `null` — ещё считаются (SHA-256 асинхронный). */
const logs = shallowRef<CacheLogEntry[][] | null>(null);
let generation = 0;

async function compute() {
  const mine = ++generation;
  const out = await playRuns(api, props.packages, levels, props.files, props.runs, mode.value);
  if (mine === generation) logs.value = out;
}
watch(picked, () => {
  logs.value = null;
  void compute();
});
onMounted(() => void compute());

const short = (name: string) => name.replace('@shop/', '');

const rows = computed(() =>
  order.map((name) => ({
    name,
    cells: props.runs.map((_, i) => logs.value?.[i].find((e) => e.name === name) ?? null),
  })),
);

const bundles = computed(() =>
  props.runs.map((run, i) => {
    const web = logs.value?.[i].find((e) => e.name === '@shop/web');
    const want = run.env.API_URL;
    const ok = web ? web.output.includes(want) : null;
    return { run, web, ok };
  }),
);
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="picked" class="l-pills" label="Настройка кеша" :options="options" />
    </template>

    <div class="mrc-body">
      <Md class="mrc-note" :text="mode.note" />

      <div class="mrc-scroll">
        <div class="mrc-table" role="table" :aria-label="`Ключи и попадания: ${mode.label}`">
          <div class="mrc-row mrc-row--head" role="row">
            <span role="columnheader">пакет</span>
            <span v-for="r in runs" :key="r.id" role="columnheader">{{ r.label }}</span>
          </div>
          <div v-for="row in rows" :key="row.name" class="mrc-row" role="row">
            <code role="cell" class="mrc-pkg">{{ short(row.name) }}</code>
            <span v-for="(c, i) in row.cells" :key="i" role="cell" class="mrc-cell">
              <template v-if="c">
                <code class="mrc-key">{{ c.key.slice(0, 8) }}</code>
                <span class="mrc-hit" :data-hit="c.hit ? 'yes' : 'no'">{{ c.hit ? 'из кеша' : 'собран' }}</span>
              </template>
              <span v-else class="mrc-wait">считается…</span>
            </span>
          </div>
        </div>
      </div>

      <div class="mrc-bundles">
        <div v-for="b in bundles" :key="b.run.id" class="mrc-bundle" :data-ok="b.ok === null ? 'wait' : b.ok ? 'yes' : 'no'">
          <span class="mrc-bundle__head">бандл web · {{ b.run.label }}</span>
          <code class="mrc-out">{{ b.web ? b.web.output : '…' }}</code>
          <span class="mrc-verdict">{{ b.ok === null ? '' : b.ok ? 'адрес верный' : 'адрес не тот' }}</span>
        </div>
      </div>

      <Md class="mrc-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.mrc-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.mrc-note,
.mrc-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.mrc-note :deep(code),
.mrc-caption :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
.mrc-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.mrc-scroll {
  overflow-x: auto;
  min-width: 0;
}
.mrc-table {
  display: flex;
  flex-direction: column;
  min-width: 520px;
  padding: 8px 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.mrc-row {
  display: grid;
  grid-template-columns: minmax(80px, 0.6fr) repeat(2, minmax(190px, 1fr));
  gap: 12px;
  align-items: baseline;
  padding: 7px 0;
  font-size: var(--fs-3);
  color: var(--prose);
}
@media (max-width: 640px) {
  .mrc-table {
    min-width: 0;
  }
  .mrc-row {
    grid-template-columns: minmax(56px, 0.5fr) minmax(0, 1fr) minmax(0, 1fr);
    gap: 8px;
  }
}
.mrc-row--head span {
  overflow-wrap: anywhere;
}
.mrc-row + .mrc-row {
  border-top: 1px solid var(--hairline);
}
.mrc-row--head {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  color: var(--text-muted);
}
.mrc-pkg,
.mrc-key {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
}
.mrc-pkg {
  font-weight: 600;
}
.mrc-cell {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}
.mrc-hit {
  font-size: var(--fs-2);
  padding: 1px 7px;
  border-radius: var(--r2);
}
.mrc-hit[data-hit='yes'] {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.mrc-hit[data-hit='no'] {
  background: var(--surface-3);
  color: var(--prose);
}
.mrc-wait {
  font-size: var(--fs-2);
  color: var(--text-muted);
}

.mrc-bundles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;
}
.mrc-bundle {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  padding: 12px;
  border-radius: var(--r3);
  border: 1px solid var(--border);
  background: var(--surface);
}
.mrc-bundle[data-ok='yes'] {
  border-color: var(--tone-ok-line);
  background: var(--tone-ok-bg);
}
.mrc-bundle[data-ok='no'] {
  border-color: var(--tone-err-line);
  background: var(--tone-err-bg);
}
.mrc-bundle__head {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
  overflow-wrap: anywhere;
}
.mrc-out {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
  overflow-wrap: anywhere;
}
.mrc-verdict {
  font-size: var(--fs-2);
  font-weight: 600;
  color: var(--prose);
}
.mrc-bundle[data-ok='yes'] .mrc-verdict {
  color: var(--tone-ok-text);
}
.mrc-bundle[data-ok='no'] .mrc-verdict {
  color: var(--tone-err-text);
}
</style>
