<script setup lang="ts">
/**
 * Обход `Map` на ходу: сценарий исполняется настоящим `for…of` в браузере читателя
 * (`model/run.ts`), журнал показывает ключи в том порядке, в каком их выдал цикл.
 *
 * Вывод под журналом — из `data.ts`; тест сверяет его с тем же прогоном модели.
 * Бесконечный сценарий обрывает сам журнал после `LIMIT` посещений — это помечено.
 *
 * Классы с префиксом `mi-`: на дев-сервере стили островов живут голыми селекторами.
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { LIMIT, runIteration } from '../model/run';
import type { IterScenario } from '../model/types';

const props = defineProps<{ scenarios: IterScenario[]; caption: string }>();

const picked = ref(props.scenarios[0].key);
const options = computed(() => props.scenarios.map((s) => ({ value: s.key, label: s.label })));
const scenario = computed(() => props.scenarios.find((s) => s.key === picked.value) ?? props.scenarios[0]);
const run = computed(() => runIteration(scenario.value.code));
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="mi-bar">
        <span class="mi-bar__label">сценарий:</span>
        <SegmentedControl v-model="picked" class="l-pills" label="Что делать во время обхода" :options="options" />
      </div>
    </template>

    <div class="mi-split">
      <div class="mi-pane">
        <div class="t-label">код</div>
        <pre class="mi-code" data-code>{{ scenario.code }}</pre>
      </div>

      <div class="mi-pane mi-pane--right">
        <div class="mi-block">
          <span class="t-label">журнал visit(k)</span>
          <div class="mi-log">
            <span v-for="(k, i) in run.visited" :key="i" class="mi-chip">{{ k }}</span>
            <span v-if="run.looped" class="mi-chip mi-chip--stop">… оборвано на {{ LIMIT }}</span>
          </div>
        </div>

        <div class="mi-block">
          <span class="t-label">в таблице после цикла</span>
          <div class="mi-after">{{ run.looped ? 'цикл не закончился' : run.after.join(' · ') }}</div>
        </div>

        <Md class="mi-verdict" :data-tone="scenario.tone" :text="scenario.verdict" />
      </div>
    </div>

    <template #footer>
      <Md class="mi-foot" :text="props.caption" />
    </template>
  </DemoFrame>
</template>

<style scoped>
.mi-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.mi-bar__label {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}

.mi-split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
}
.mi-pane {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  padding: 20px;
  border-right: 1px solid var(--divider);
}
.mi-pane--right {
  gap: 16px;
  border-right: 0;
  background: var(--surface-2);
}
.mi-code {
  margin: 0;
  padding: 15px 17px;
  font-size: var(--fs-3);
  line-height: 1.75;
  overflow-x: auto;
}

.mi-block {
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.mi-log {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.mi-chip {
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r1);
  background: var(--surface);
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
}
.mi-chip--stop {
  border-color: var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}
.mi-after {
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--surface);
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
  overflow-wrap: anywhere;
}

.mi-verdict {
  padding: 13px 15px;
  border-radius: var(--r2);
  font-size: var(--fs-5);
  line-height: 1.55;
}
.mi-verdict[data-tone='ok'] {
  border: 1px solid var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.mi-verdict[data-tone='warn'] {
  border: 1px solid var(--tone-warn-line);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.mi-verdict[data-tone='err'] {
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}

.mi-foot {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}

@media (max-width: 720px) {
  .mi-split {
    grid-template-columns: 1fr;
  }
  .mi-pane {
    border-right: 0;
    border-bottom: 1px solid var(--divider);
  }
}
</style>
