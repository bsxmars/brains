<script setup lang="ts">
/**
 * Дерево `effectScope`: узлы создаются строкой `SCOPE_NODE_CODE` из темы на мини-версии,
 * останавливаются её `scope.stop()`, а жив ли эффект — видно по счётчику прогонов
 * после `n.value++`, а не по нарисованному флажку.
 *
 * Логика — в `model/scopes.ts`; тот же модуль тест прогоняет и на настоящем Vue.
 *
 * ⚠️ Лаборатория лежит в обычной переменной, а не в `ref`: внутри неё прокси мини-версии,
 * и `ref` Vue завернул бы их в свои. На экран попадает снимок — обычный массив.
 */
import { computed, onMounted, shallowRef } from 'vue';
import CodeListing from '@/shared/ui/CodeListing.vue';
import ConsoleView from '@/shared/ui/ConsoleView.vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button } from '@/shared/ui';
import { loadMiniWatch } from '../model/load';
import { ScopeLab } from '../model/scopes';
import type { ScopeNodeView } from '../model/types';

const props = defineProps<{ code: string; nodeCode: string; note: string }>();

/** Больше узлов дерево не наглядит: восемь хватает на три уровня с отсоединённой веткой. */
const MAX_NODES = 8;

let lab: ScopeLab | null = null;
const nodes = shallowRef<ScopeNodeView[]>([]);
const log = shallowRef<string[]>([]);

function refresh() {
  if (!lab) return;
  nodes.value = lab.snapshot();
  log.value = lab.log.slice(-12);
}

function boot() {
  lab = new ScopeLab(loadMiniWatch(props.code), props.nodeCode);
  lab.add(null);
  refresh();
}

function add(parent: number, detached: boolean) {
  lab?.add(parent, detached);
  refresh();
}

function stop(id: number) {
  lab?.stop(id);
  refresh();
}

function bump() {
  lab?.bump();
  refresh();
}

onMounted(boot);

const lines = computed(() => props.nodeCode.split('\n'));
const full = computed(() => nodes.value.length >= MAX_NODES);
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="mw-actions">
        <Button variant="primary" :disabled="!nodes.length" @click="bump">n.value++</Button>
        <Button variant="secondary" :disabled="!nodes.length" @click="boot">сброс</Button>
      </div>
    </template>

    <div class="mw-split">
      <div class="mw-pane">
        <CodeListing :lines="lines" label="так создаётся каждый узел" />
        <Md class="mw-note" :text="note" />
      </div>

      <div class="mw-pane">
        <span class="t-label">области · эффекты · прогоны</span>
        <div v-if="!nodes.length" class="mw-empty">дерево ещё не создано</div>
        <div
          v-for="node in nodes"
          :key="node.id"
          class="mw-node"
          :data-active="node.active ? 'yes' : 'no'"
          :style="{ marginLeft: `${node.depth * 22}px` }"
        >
          <div class="mw-node__head">
            <span class="mw-node__name">{{ node.name }}</span>
            <span v-if="node.detached" class="mw-chip mw-chip--warn">detached</span>
            <span class="mw-chip" :class="node.active ? 'mw-chip--ok' : 'mw-chip--off'">
              {{ node.active ? 'активна' : 'остановлена' }}
            </span>
            <span class="mw-node__runs">эффект выполнился {{ node.runs }}×</span>
          </div>
          <div v-if="node.active" class="mw-node__buttons">
            <Button variant="secondary" :disabled="full" @click="add(node.id, false)">+ вложенная</Button>
            <Button variant="secondary" :disabled="full" @click="add(node.id, true)">+ detached</Button>
            <Button variant="secondary" @click="stop(node.id)">stop()</Button>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <ConsoleView :lines="log" label="log(…) эффектов и onScopeDispose · последние строки" :min-height="72" />
    </template>
  </DemoFrame>
</template>

<style scoped>
.mw-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.mw-split {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr));
  gap: 20px;
  padding: 20px;
}
.mw-pane {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.mw-note {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--prose);
}
.mw-empty {
  font-family: var(--mono);
  font-size: var(--fs-2);
  font-style: italic;
  color: var(--ghost);
}

/* Узел дерева: засечка слева — жива ли область. Отступ — где создан, не кто владеет. */
.mw-node {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border-radius: var(--r2);
  background: var(--surface-2);
  box-shadow: inset 2px 0 0 var(--tone-ok-strong);
  min-width: 0;
}
.mw-node[data-active='no'] {
  box-shadow: inset 2px 0 0 var(--tone-err-line-muted);
}
.mw-node__head {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
}
.mw-node__name {
  font-family: var(--mono);
  font-size: var(--fs-3);
  font-weight: 600;
  color: var(--ink);
}
.mw-node__runs {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}
.mw-node__buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.mw-chip {
  padding: 1px 7px;
  border-radius: var(--r-full);
  font-family: var(--mono);
  font-size: var(--fs-3);
}
.mw-chip--ok {
  background: var(--tone-ok-chip);
  color: var(--tone-ok-text);
}
.mw-chip--off {
  background: var(--tone-err-chip);
  color: var(--tone-err-text);
}
.mw-chip--warn {
  background: var(--tone-warn-chip);
  color: var(--tone-warn-text);
}
</style>
