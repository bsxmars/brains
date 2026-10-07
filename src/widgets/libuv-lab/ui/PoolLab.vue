<script setup lang="ts">
/**
 * «Пул на N потоков»: шесть задач на пул выбранного размера — дорожка на каждый поток
 * и порядок, в котором придут колбэки.
 *
 * Считает строка `POOL_CODE` из темы (`model/run.ts`), её же печатает страница и проверяет
 * `tests/unit/node-event-loop.test.ts` против настоящего Node с `UV_THREADPOOL_SIZE`.
 * Рядом — позиция `fs.stat` в прогонах стенда (`stand`).
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { loadPool } from '../model/run';
import type { PoolStand, PoolTask } from '../model/types';

const props = defineProps<{
  code: string;
  tasks: PoolTask[];
  stand: PoolStand[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const poolOrder = loadPool(props.code);

const size = ref(String(props.stand.find((s) => s.size === 4)?.size ?? props.stand[0].size));
const options = props.stand.map((s) => ({ value: String(s.size), label: `${s.size} ${s.size === 1 ? 'поток' : s.size < 5 ? 'потока' : 'потоков'}` }));

const done = computed(() => poolOrder(Number(size.value), props.tasks));
const total = computed(() => Math.max(...done.value.map((d) => d.end)));
const lanes = computed(() =>
  Array.from({ length: Number(size.value) }, (_, i) => done.value.filter((d) => d.thread === i)),
);
const bar = (start: number, end: number) => ({
  left: `${(start / total.value) * 100}%`,
  width: `max(4px, ${((end - start) / total.value) * 100}%)`,
});

const statPos = computed(() => done.value.findIndex((d) => d.name === 'fs.stat') + 1);
const standRow = computed(() => props.stand.find((s) => String(s.size) === size.value)!);
const standText = computed(() =>
  Object.entries(standRow.value.statPositions)
    .map(([pos, n]) => `${pos}-м — ${n} из ${standRow.value.runs}`)
    .join(', '),
);
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="size" class="l-pills" label="Размер пула" :options="options" />
    </template>

    <div class="pl-body">
      <div class="pl-lanes">
        <div v-for="(lane, i) in lanes" :key="i" class="pl-lane">
          <span class="pl-lane-name">поток {{ i + 1 }}</span>
          <div class="pl-track">
            <span
              v-for="d in lane"
              :key="d.name"
              class="pl-bar"
              :data-kind="d.name === 'fs.stat' ? 'stat' : 'hash'"
              :style="bar(d.start, d.end)"
              :title="d.name"
            >{{ d.name === 'fs.stat' ? '' : d.name.replace('hash ', '#') }}</span>
          </div>
        </div>
      </div>

      <div class="pl-order">
        <span class="pl-label">порядок колбэков</span>
        <div class="pl-chips">
          <code v-for="(d, i) in done" :key="d.name" class="pl-chip" :data-kind="d.name === 'fs.stat' ? 'stat' : 'hash'">{{ i + 1 }}. {{ d.name }}</code>
        </div>
      </div>

      <div class="pl-stand">
        В модели <code>fs.stat</code> приходит {{ statPos }}-м. Node 24.11 с этим размером пула:
        {{ standText }}.
      </div>

      <Md class="pl-note" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.pl-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
  min-width: 0;
}
.pl-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.pl-lanes {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.pl-lane {
  display: grid;
  grid-template-columns: 5.5em minmax(0, 1fr);
  gap: 10px;
  align-items: center;
}
.pl-lane-name {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.pl-track {
  position: relative;
  height: 1.9em;
  border-radius: var(--r1);
  background: var(--surface-2);
}
.pl-bar {
  position: absolute;
  top: 3px;
  bottom: 3px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 1px solid var(--tone-info-line);
  border-radius: var(--r1);
  background: var(--tone-info-bg);
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--tone-info-text);
}
.pl-bar[data-kind='stat'] {
  border-color: var(--tone-warn-strong);
  background: var(--tone-warn-strong);
}
.pl-order {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.pl-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.pl-chip {
  padding: 3px 9px;
  border-radius: var(--r1);
  background: var(--surface-3);
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
}
.pl-chip[data-kind='stat'] {
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.pl-stand,
.pl-note {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
  overflow-wrap: anywhere;
}
.pl-stand code,
.pl-note :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
</style>
