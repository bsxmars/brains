<script setup lang="ts">
/**
 * «Один сценарий — два мира»: приложение из четырёх компонентов (`ANGULAR_APP_CODE` темы)
 * с зоной и без, `Default` и `OnPush`. Показывает, сколько раз запускалась проверка, чьи
 * шаблоны выполнились и что в итоге на экране по сравнению с данными.
 *
 * Считает не компонент, а строки темы `ZONE_CODE`, `SCHEDULER_CODE` и `TREE_CODE`, собранные
 * `new Function` в `model/run.ts`, на модели цикла событий. Строка «Angular 21.2» — литерал
 * `STAND` из темы: снят на настоящем Angular в Chromium, а `tests/unit/angular-zoneless.test.ts`
 * пересобирает его и сверяет с той же мини-версией на всех сценариях.
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button, SegmentedControl } from '@/shared/ui';
import { loadMini, runScenario } from '../model/run';
import type { ConfigKey, Scenario, ScenarioId, StandRun, ViewName, ZoneMode } from '../model/types';

const props = defineProps<{
  zoneCode: string;
  schedulerCode: string;
  treeCode: string;
  scenarios: Scenario[];
  stand: Record<ConfigKey, Record<ScenarioId, StandRun>>;
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const mini = loadMini(props.zoneCode, props.schedulerCode, props.treeCode);

const mode = ref<ZoneMode>('zone');
const strategy = ref<'default' | 'onpush'>('default');
const picked = ref<ScenarioId>('mousemove');

const modeOptions = [
  { value: 'zone', label: 'zone.js' },
  { value: 'zoneless', label: 'без зоны' },
];
const strategyOptions = [
  { value: 'default', label: 'Default' },
  { value: 'onpush', label: 'OnPush' },
];

const scenario = computed(() => props.scenarios.find((s) => s.id === picked.value) ?? props.scenarios[0]);
const run = computed(() => runScenario(mini, picked.value, mode.value, strategy.value === 'onpush'));
const configKey = computed<ConfigKey>(() => (strategy.value === 'onpush' ? `${mode.value}/onpush` : mode.value) as ConfigKey);
const angular = computed(() => props.stand[configKey.value][picked.value]);

const VIEWS: ViewName[] = ['App', 'Counter', 'Clock', 'List'];
const total = (h: Record<ViewName, number>) => VIEWS.reduce((n, v) => n + h[v], 0);

const same = computed(() => {
  const a = angular.value;
  const r = run.value;
  return (
    a.ticks === r.ticks &&
    VIEWS.every((v) => a.hits[v] === r.hits[v]) &&
    a.label === r.label &&
    a.status === r.status &&
    a.count === r.count
  );
});

const screenRows = computed(() => [
  { k: 'Counter · count', screen: run.value.count, data: run.value.state.count },
  { k: 'Clock · label', screen: run.value.label, data: run.value.state.label },
  { k: 'Clock · status', screen: run.value.status, data: run.value.state.status },
]);
const stale = computed(() => screenRows.value.some((r) => r.screen !== r.data));

const tickLines = computed(() =>
  run.value.log.map((names, i) => `${i + 1}: ${names.length ? names.join(', ') : 'ни одного шаблона'}`),
);

const angularLine = computed(() => {
  const a = angular.value;
  const hits = VIEWS.filter((v) => a.hits[v] > 0)
    .map((v) => `${v} ×${a.hits[v]}`)
    .join(', ');
  return `Angular 21.2 на том же сценарии: тиков **${a.ticks}**, шаблонов ${total(a.hits)}${hits ? ` (${hits})` : ''}, \`label\` на экране — «${a.label}».`;
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="zl-toolbar">
        <SegmentedControl v-model="mode" class="l-pills" label="Режим" :options="modeOptions" />
        <SegmentedControl v-model="strategy" class="l-pills" label="Стратегия компонентов" :options="strategyOptions" />
      </div>
    </template>

    <div class="zl-body">
      <div class="zl-scenarios" role="group" aria-label="Сценарий">
        <Button
          v-for="s in scenarios"
          :key="s.id"
          :variant="s.id === picked ? 'primary' : 'secondary'"
          :aria-pressed="s.id === picked"
          @click="picked = s.id"
        >
          {{ s.label }}
        </Button>
      </div>

      <Md class="zl-note" :text="scenario.what" />

      <div class="zl-grid">
        <section class="zl-panel" aria-label="Проверки">
          <div class="zl-stats">
            <div class="zl-stat">
              <span class="zl-label">тиков</span>
              <span class="zl-num" :data-zero="run.ticks === 0 ? 'yes' : 'no'">{{ run.ticks }}</span>
            </div>
            <div class="zl-stat">
              <span class="zl-label">шаблонов</span>
              <span class="zl-num" :data-zero="total(run.hits) === 0 ? 'yes' : 'no'">{{ total(run.hits) }}</span>
            </div>
            <div class="zl-stat">
              <span class="zl-label">колбэков зоны</span>
              <span class="zl-num" :data-zero="!run.zoneTasks ? 'yes' : 'no'">{{ run.zoneTasks ?? '—' }}</span>
            </div>
          </div>

          <div class="zl-tree" aria-label="Дерево компонентов">
            <div class="zl-node zl-node--root" :data-hit="run.hits.App > 0 ? 'yes' : 'no'">
              <span class="zl-node__name">App</span>
              <span class="zl-node__hits">×{{ run.hits.App }}</span>
            </div>
            <div class="zl-children">
              <div v-for="v in ['Counter', 'Clock', 'List'] as const" :key="v" class="zl-node" :data-hit="run.hits[v] > 0 ? 'yes' : 'no'">
                <span class="zl-node__name">{{ v }}</span>
                <span class="zl-node__hits">×{{ run.hits[v] }}</span>
              </div>
            </div>
          </div>

          <div class="zl-ticks">
            <span class="zl-label">тики: чьи шаблоны выполнились</span>
            <code v-for="line in tickLines" :key="line" class="zl-tick">{{ line }}</code>
            <span v-if="!tickLines.length" class="zl-empty">проверка не запускалась</span>
          </div>
        </section>

        <section class="zl-panel" aria-label="Экран и данные">
          <span class="zl-label">на экране и в данных</span>
          <div class="zl-screen" role="table" aria-label="Экран и данные">
            <div class="zl-screen__row zl-screen__head" role="row">
              <span role="columnheader">что</span>
              <span role="columnheader">экран</span>
              <span role="columnheader">данные</span>
            </div>
            <div v-for="r in screenRows" :key="r.k" class="zl-screen__row" role="row" :data-stale="r.screen !== r.data ? 'yes' : 'no'">
              <code role="cell">{{ r.k }}</code>
              <span role="cell">{{ r.screen }}</span>
              <span role="cell">{{ r.data }}</span>
            </div>
          </div>
          <p class="zl-verdict" :data-stale="stale ? 'yes' : 'no'">
            {{ stale ? 'Экран отстал от данных: проверка не дошла до изменённого компонента.' : 'Экран совпадает с данными.' }}
          </p>

          <div class="zl-angular" :data-same="same ? 'yes' : 'no'">
            <Md :text="angularLine" />
            <span class="zl-angular__mark">{{ same ? 'совпадает с мини-версией' : 'расходится с мини-версией' }}</span>
          </div>
        </section>
      </div>

      <Md class="zl-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.zl-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 18px;
}
.zl-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.zl-scenarios {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.zl-note,
.zl-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.zl-note :deep(code),
.zl-caption :deep(code),
.zl-angular :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}

.zl-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 760px) {
  .zl-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

.zl-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  padding: 14px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.zl-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.zl-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
.zl-stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.zl-num {
  font-family: var(--mono);
  font-size: var(--fs-7);
  font-weight: 600;
  color: var(--tone-warn-strong);
}
.zl-num[data-zero='yes'] {
  color: var(--tone-ok-strong);
}

.zl-tree {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.zl-children {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 112px), 1fr));
  gap: 8px;
  width: 100%;
}
.zl-node {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px;
  min-width: 0;
  padding: 8px 10px;
  border-radius: var(--r2);
  background: var(--surface);
  box-shadow: inset 0 0 0 1px var(--border);
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
}
.zl-node--root {
  min-width: 46%;
}
.zl-node[data-hit='yes'] {
  background: var(--tone-warn-bg);
  box-shadow: inset 0 0 0 1px var(--tone-warn-line);
}
.zl-node__name {
  min-width: 0;
}
.zl-node__hits {
  color: var(--text-muted);
}
.zl-node[data-hit='yes'] .zl-node__hits {
  color: var(--tone-warn-text);
  font-weight: 600;
}

.zl-ticks {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.zl-tick {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
  overflow-wrap: anywhere;
}
.zl-empty {
  font-size: var(--fs-3);
  color: var(--text-muted);
}

.zl-screen {
  display: flex;
  flex-direction: column;
  font-size: var(--fs-3);
  color: var(--prose);
}
.zl-screen__row {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 1fr);
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--r1);
  align-items: baseline;
  overflow-wrap: anywhere;
}
.zl-screen__head {
  font-family: var(--mono);
  font-size: var(--fs-2);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}
.zl-screen__row code {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
}
.zl-screen__row[data-stale='yes'] {
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}
.zl-verdict {
  margin: 0;
  padding: 8px 10px;
  border-radius: var(--r2);
  font-size: var(--fs-3);
  line-height: 1.5;
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.zl-verdict[data-stale='yes'] {
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}

.zl-angular {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-radius: var(--r2);
  background: var(--tone-info-bg);
  font-size: var(--fs-3);
  line-height: 1.55;
  color: var(--tone-info-text);
}
.zl-angular__mark {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--tone-ok-text);
}
.zl-angular[data-same='no'] .zl-angular__mark {
  color: var(--tone-err-text);
}
</style>
