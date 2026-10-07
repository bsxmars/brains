<script setup lang="ts">
/**
 * «Учебная отмена против настоящей»: один сценарий исполняется на учебных классах из строки
 * `MINI_CODE` и на настоящих `AbortController`/`AbortSignal` браузера; выводы рядом и вердикт.
 *
 * Считает не компонент: `model/run.ts` собирает строки темы `new Function` и исполняет их.
 * Сценарии асинхронные (таймаут), поэтому прогон идёт после монтирования; до него консоли
 * пусты. Та же сверка на настоящих классах Node закреплена в `tests/unit/abort-controller.test.ts`.
 */
import { computed, onMounted, ref } from 'vue';
import CodeListing from '@/shared/ui/CodeListing.vue';
import ConsoleView from '@/shared/ui/ConsoleView.vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { compareScenario, type ScenarioRun } from '../model/run';
import type { AbortScenario } from '../model/types';

const props = defineProps<{
  miniCode: string;
  trackCode: string;
  scenarios: AbortScenario[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const picked = ref(props.scenarios[0].id);
const options = props.scenarios.map((s) => ({ value: s.id, label: s.label }));
const scenario = computed(() => props.scenarios.find((s) => s.id === picked.value) ?? props.scenarios[0]);
const lines = computed(() => scenario.value.code.split('\n'));

const runs = ref<Record<string, ScenarioRun>>({});
const run = computed(() => runs.value[scenario.value.id]);

onMounted(async () => {
  // По одному: сценарий с таймаутом не должен пересекаться по времени с соседним.
  for (const s of props.scenarios) {
    const r = await compareScenario(s, props.miniCode, props.trackCode);
    runs.value = { ...runs.value, [s.id]: r };
  }
});

const VERDICT = {
  wait: 'Сценарий исполнится в браузере.',
  ok: 'Учебные классы и настоящий `AbortController` этого браузера напечатали одно и то же.',
  bad: 'Выводы разошлись: учебная модель ведёт себя не так, как движок этого браузера.',
};
const tone = computed(() => (!run.value ? 'wait' : run.value.same ? 'ok' : 'bad'));
const verdictText = computed(() => VERDICT[tone.value]);
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="picked" class="l-pills" label="Сценарий" :options="options" />
    </template>

    <div class="al-body">
      <Md class="al-note" :text="scenario.note" />

      <div class="al-pane">
        <CodeListing :lines="lines" tone="dark" label="сценарий" />
      </div>

      <div class="al-side">
        <ConsoleView :lines="run?.mini ?? []" label="учебные классы" :min-height="96" empty-label="ещё не исполнено" />
        <ConsoleView :lines="run?.native ?? []" label="настоящий AbortController" :min-height="96" empty-label="ещё не исполнено" />
      </div>

      <Md class="al-caption" :text="caption" />
    </div>

    <template #footer>
      <Md class="al-verdict" :data-tone="tone" :text="verdictText" />
    </template>
  </DemoFrame>
</template>

<style scoped>
.al-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.al-note,
.al-caption {
  font-size: var(--fs-5);
  line-height: 1.6;
  color: var(--prose);
}
.al-note :deep(code),
.al-caption :deep(code),
.al-verdict :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
/* Листинг на чернилах, как код по всей теме. */
.al-pane {
  min-width: 0;
  padding: 14px 6px;
  border-radius: var(--r3);
  background: var(--ink);
}
/* Активной строки здесь нет: сценарий читают целиком, поэтому полный цвет кода на чернилах,
   а не приглушённый «неактивный». */
.al-pane :deep(.listing[data-tone] .line) {
  color: var(--code-fg);
}
.al-pane :deep(.t-label) {
  padding: 0 12px;
  color: var(--ink-faint);
}
.al-side {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 760px) {
  .al-side {
    grid-template-columns: minmax(0, 1fr);
  }
}
.al-side :deep(.cv-line) {
  overflow-wrap: anywhere;
}
.al-verdict {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--text-muted);
}
.al-verdict[data-tone='ok'] {
  color: var(--tone-ok-text);
}
.al-verdict[data-tone='bad'] {
  color: var(--tone-err-text);
}
</style>
