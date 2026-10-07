<script setup lang="ts">
/**
 * Цепочка `computed` на двух вариантах одной строки: версионная схема 3.5 и «только флаг» —
 * та же строка с подменой `DIRTY_ONLY_PATCH`. Счётчики — вызовы `count(…)` из кода цепочки,
 * списки `Link` и версии — внутренние поля, прочитанные после шага.
 *
 * Логика — в `model/chain.ts`; тот же модуль тест прогоняет на Vue и сверяет и счётчики,
 * и списки связей.
 *
 * ⚠️ Обе лаборатории — обычные переменные, не `ref` (внутри прокси мини-версии). Экран
 * получает снимки. Сборка — в `onMounted`: на сборке страницы `new Function` не нужен.
 */
import { computed, onMounted, ref, shallowRef } from 'vue';
import CodeListing from '@/shared/ui/CodeListing.vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button, SegmentedControl } from '@/shared/ui';
import { loadMiniWatch, patchCode } from '../model/load';
import { ChainLab } from '../model/chain';
import type { ChainScenario, ChainSnapshot, CodePatch } from '../model/types';

const props = defineProps<{ code: string; patch: CodePatch[]; scenario: ChainScenario }>();

type Variant = 'versioned' | 'dirty';
const OPTIONS = [
  { value: 'versioned', label: 'версии 3.5' },
  { value: 'dirty', label: 'только флаг' },
];

const shown = ref<Variant>('versioned');
let labs: Record<Variant, ChainLab> | null = null;
const snaps = shallowRef<Record<Variant, ChainSnapshot> | null>(null);
const last = ref('установка');

function refresh() {
  if (!labs) return;
  snaps.value = { versioned: labs.versioned.snapshot(), dirty: labs.dirty.snapshot() };
}

function boot() {
  labs = {
    versioned: new ChainLab(loadMiniWatch(props.code), props.scenario),
    dirty: new ChainLab(loadMiniWatch(patchCode(props.code, props.patch)), props.scenario),
  };
  last.value = 'установка';
  refresh();
}

function act(i: number) {
  if (!labs) return;
  labs.versioned.act(i);
  labs.dirty.act(i);
  last.value = props.scenario.actions[i];
  refresh();
}

onMounted(boot);

const lines = computed(() => props.scenario.setup.split('\n'));
const NAMES = ['parity', 'label', 'E'] as const;
const rows = computed(() =>
  NAMES.map((name) => ({
    name,
    versioned: snaps.value?.versioned.counts[name] ?? 0,
    dirty: snaps.value?.dirty.counts[name] ?? 0,
  })),
);
const graph = computed(() => snaps.value?.[shown.value] ?? null);
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="mw-actions">
        <Button v-for="(action, i) in scenario.actions" :key="action" variant="secondary" :disabled="!snaps" @click="act(i)">
          {{ action }}
        </Button>
        <Button variant="secondary" :disabled="!snaps" @click="boot">сброс</Button>
      </div>
    </template>

    <div class="mw-split">
      <div class="mw-pane">
        <CodeListing :lines="lines" label="цепочка · исполняется обоими вариантами" />
        <Md class="mw-note" :text="scenario.note" />
      </div>

      <div class="mw-pane">
        <div class="mw-head">
          <span class="t-label">сколько раз выполнилось · после «{{ last }}»</span>
        </div>
        <table class="mw-table">
          <thead>
            <tr>
              <th scope="col">функция</th>
              <th scope="col">версии 3.5</th>
              <th scope="col">только флаг</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.name" :data-diff="row.versioned !== row.dirty ? 'yes' : 'no'">
              <td>{{ row.name }}</td>
              <td>{{ row.versioned }}</td>
              <td>{{ row.dirty }}</td>
            </tr>
          </tbody>
        </table>

        <SegmentedControl v-model="shown" class="l-pills" label="Чьи связи показать" :options="OPTIONS" />

        <div v-if="!graph" class="mw-empty">цепочка ещё не собрана</div>
        <template v-else>
          <span v-if="graph.globalVersion !== null" class="mw-global">globalVersion = {{ graph.globalVersion }}</span>
          <div v-for="sub in graph.subs" :key="sub.name" class="mw-sub" :data-kind="sub.kind">
            <div class="mw-sub__head">
              <span class="mw-sub__name">{{ sub.name }}</span>
              <span class="mw-sub__meta">
                <span v-if="sub.dirty !== undefined" class="mw-chip" :class="sub.dirty ? 'mw-chip--warn' : 'mw-chip--ok'">
                  {{ sub.dirty ? 'dirty' : 'свежий' }}
                </span>
                <span v-if="sub.version !== undefined">Dep.version {{ sub.version }}</span>
              </span>
            </div>
            <div class="mw-links">
              <span class="mw-links__label">deps →</span>
              <span v-if="!sub.links.length" class="mw-empty">нет связей</span>
              <span
                v-for="link in sub.links"
                :key="link.dep"
                class="mw-link"
                :data-fresh="link.seen === link.current ? 'yes' : 'no'"
              >
                Link({{ link.dep }}) · видел {{ link.seen }} / сейчас {{ link.current }}
              </span>
            </div>
            <div v-if="sub.readers" class="mw-links">
              <span class="mw-links__label">subs ←</span>
              <span v-if="!sub.readers.length" class="mw-empty">читателей нет</span>
              <span v-for="reader in sub.readers" :key="reader" class="mw-link">{{ reader }}</span>
            </div>
          </div>
        </template>
      </div>
    </div>
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
.mw-head {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.mw-empty {
  font-family: var(--mono);
  font-size: var(--fs-2);
  font-style: italic;
  color: var(--ghost);
}

.mw-table {
  border-collapse: collapse;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
}
.mw-table th {
  padding: 4px 10px;
  border-bottom: 1px solid var(--divider);
  font-size: var(--fs-3);
  font-weight: 500;
  text-align: start;
  color: var(--text-faint);
}
.mw-table td {
  padding: 5px 10px;
  text-align: start;
}
.mw-table tr[data-diff='yes'] td {
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}

.mw-global {
  align-self: flex-start;
  padding: 3px 8px;
  border-radius: var(--r-full);
  background: var(--surface-3);
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--chip-text);
}

/* Подписчик и его список Link. Засечка — род: эффект или computed. */
.mw-sub {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 10px 12px;
  border-radius: var(--r2);
  background: var(--surface-2);
  box-shadow: inset 2px 0 0 var(--tone-info-line);
}
.mw-sub[data-kind='computed'] {
  box-shadow: inset 2px 0 0 var(--tone-warn-accent);
}
.mw-sub__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 6px;
}
.mw-sub__name {
  font-family: var(--mono);
  font-size: var(--fs-3);
  font-weight: 600;
  color: var(--ink);
}
.mw-sub__meta {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}
.mw-links {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 5px;
}
.mw-links__label {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}
.mw-link {
  padding: 3px 8px;
  border-radius: var(--r-full);
  background: var(--tone-info-chip);
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--tone-info-text);
}
.mw-link[data-fresh='no'] {
  background: var(--tone-warn-chip);
  color: var(--tone-warn-text);
}
.mw-chip {
  padding: 1px 6px;
  border-radius: var(--r-full);
}
.mw-chip--ok {
  background: var(--tone-ok-chip);
  color: var(--tone-ok-text);
}
.mw-chip--warn {
  background: var(--tone-warn-chip);
  color: var(--tone-warn-text);
}
</style>
