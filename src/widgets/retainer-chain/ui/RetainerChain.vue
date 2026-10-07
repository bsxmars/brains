<script setup lang="ts">
/**
 * Панель Retainers: от строки в снимке до строки в коде.
 *
 * Цепочка читается сверху вниз — от объекта к корню (так её и подписывает панель над списком; до
 * 2026-10-01 стояло «снизу вверх», что расходилось с порядком строк), — и работа состоит в одном: найти
 * ближайшее к корню звено, которое принадлежит вам. Поэтому у каждого звена подписано
 * не только «чем является эта ссылка», но и «чинить здесь или нет»: именно этот вопрос
 * и задаёт читатель, глядя на семь одинаковых строк с отступами.
 */
import { computed, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import { SegmentedControl } from '@/shared/ui';
import type { RetainerChain } from '../model/types';

const props = defineProps<{ chains: RetainerChain[] }>();

const pickedChain = ref('0');
const chain = computed(() => props.chains[Number(pickedChain.value)]);

const node = ref(props.chains[0].initial ?? 0);
watch(pickedChain, () => {
  node.value = chain.value.initial ?? 0;
});

const current = computed(() => chain.value.nodes[Math.min(node.value, chain.value.nodes.length - 1)]);
const options = computed(() => props.chains.map((c, i) => ({ value: String(i), label: c.label })));
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="bar">
        <span class="bar__label">цепочка:</span>
        <SegmentedControl v-model="pickedChain" class="l-pills" label="Цепочка retainers" :options="options" />
      </div>
    </template>

    <div class="split">
      <div class="pane">
        <div class="t-label">Retainers · от объекта к корню</div>

        <div class="scroll">
          <div class="chain">
            <button
              v-for="(item, i) in chain.nodes"
              :key="item.t"
              type="button"
              class="node"
              :data-on="i === node ? 'yes' : 'no'"
              :data-tone="item.tone ?? 'none'"
              :aria-pressed="i === node"
              @click="node = i"
            >
              {{ item.t }}
            </button>
          </div>
        </div>
      </div>

      <div class="pane pane--right">
        <div class="field">
          <div class="t-label">чем является эта ссылка</div>
          <div class="kind" :data-tone="current.tone ?? 'none'">{{ current.kind }}</div>
        </div>

        <div class="what">{{ current.what }}</div>

        <div class="fix" :data-tone="current.tone ?? 'none'">{{ current.fix }}</div>
      </div>
    </div>

    <template #footer>
      <div class="summary">{{ chain.summary }}</div>
    </template>
  </DemoFrame>
</template>

<style scoped>
.bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.bar__label {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}

.split {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
}
.pane {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px;
  border-right: 1px solid var(--divider);
  min-width: 0;
}
.pane--right {
  gap: 16px;
  border-right: 0;
  background: var(--surface-2);
}

.scroll {
  min-width: 0;
  overflow-x: auto;
}
.chain {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.node {
  padding: 10px 13px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--surface-2);
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.4;
  text-align: start;
  white-space: nowrap;
  color: var(--chip-text);
  cursor: pointer;
  transition: all 0.15s;
}
/* Ваше звено видно ещё до клика: это точка приложения силы во всей цепочке. */
.node[data-tone='ok'] {
  border-color: var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-strong);
}
.node[data-on='yes'] {
  border-width: 1.5px;
  border-color: var(--accent);
  background: var(--tone-info-bg);
  color: var(--tone-info-strong);
  font-weight: 600;
}
.node[data-on='yes'][data-tone='ok'] {
  border-color: var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-strong);
}
.node[data-on='yes'][data-tone='warn'] {
  border-color: var(--tone-warn-line);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-strong);
}
.node[data-on='yes'][data-tone='err'] {
  border-color: var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-strong);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.kind {
  padding: 12px 14px;
  border-radius: var(--r2);
  font-family: var(--mono);
  font-size: var(--fs-4);
  transition: all 0.2s;
}
.kind[data-tone='none'] {
  border: 1px solid var(--tone-info-line);
  background: var(--tone-info-bg);
  color: var(--tone-info-strong);
}
.kind[data-tone='ok'] {
  border: 1px solid var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-strong);
}
.kind[data-tone='warn'] {
  border: 1px solid var(--tone-warn-line);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-strong);
}
.kind[data-tone='err'] {
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-strong);
}

.what {
  font-size: var(--fs-6);
  line-height: 1.6;
  color: var(--prose);
}

.fix {
  padding: 13px 15px;
  border-radius: var(--r2);
  font-size: var(--fs-6);
  line-height: 1.6;
  transition: all 0.2s;
}
.fix[data-tone='none'] {
  border: 1px solid var(--divider);
  background: var(--sunk-dim);
  color: var(--dim);
}
.fix[data-tone='ok'] {
  border: 1px solid var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.fix[data-tone='warn'] {
  border: 1px solid var(--tone-warn-line);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.fix[data-tone='err'] {
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}

.summary {
  font-size: var(--fs-6);
  line-height: 1.6;
  color: var(--prose);
}
</style>
