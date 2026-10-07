<script setup lang="ts">
/**
 * Тот же набор вопросов, что задан трём движкам, — заданный вашему браузеру.
 *
 * Снимок трёх движков приходит пропом из `data.ts` темы, ответы вашего браузера считает
 * `model/probes.ts` в `onMounted`. Тот же модуль исполняет e2e в Chromium, Firefox и WebKit
 * и сверяет со снимком: таблица на странице и таблица в проверке разойтись не могут.
 *
 * Ответ каждой строки лежит в `data-answer` — его и читает проверка.
 */
import { computed, onMounted, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { PROBES, closest, runProbes } from '../model/probes';
import type { EngineKey, EngineSnapshot } from '../model/types';

const props = defineProps<{
  snapshot: EngineSnapshot;
  /** Подписи колонок снимка: «Chromium 153» и т. п. */
  engines: Record<EngineKey, string>;
}>();

const ENGINES: EngineKey[] = ['chromium', 'firefox', 'webkit'];

type Filter = 'diff' | 'all';
const OPTIONS: { value: Filter; label: string }[] = [
  { value: 'diff', label: 'где движки расходятся' },
  { value: 'all', label: 'все вопросы' },
];
const filter = ref<Filter>('diff');

const answers = ref<Record<string, string> | null>(null);
onMounted(() => {
  answers.value = runProbes();
});

/** Строка «расходится», если в снимке у трёх движков не один и тот же ответ. */
const differs = (key: string) => new Set(ENGINES.map((e) => props.snapshot[key]?.[e])).size > 1;

const rows = computed(() => PROBES.filter((probe) => filter.value === 'all' || differs(probe.key)));

const verdict = computed(() => {
  if (!answers.value) return null;
  const best = closest(answers.value, props.snapshot);
  return `Ваш браузер ответил как **${props.engines[best.engine]}** на ${best.same} вопросах из ${best.total}.`;
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="ep-bar">
        <span class="ep-bar__label">показать:</span>
        <SegmentedControl v-model="filter" class="l-pills" label="Какие вопросы показать" :options="OPTIONS" />
      </div>
    </template>

    <div class="ep-verdict">
      <Md v-if="verdict" :text="verdict" />
      <span v-else class="ep-wait">вопросы задаются вашему браузеру…</span>
    </div>

    <div class="ep-scroll">
      <table class="ep-table">
        <thead>
          <tr>
            <th>вопрос</th>
            <th class="ep-yours">ваш браузер</th>
            <th v-for="engine in ENGINES" :key="engine">{{ engines[engine] }}</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="(probe, i) in rows" :key="probe.key">
            <tr v-if="i === 0 || rows[i - 1].group !== probe.group" class="ep-group">
              <td :colspan="2 + ENGINES.length">{{ probe.group }}</td>
            </tr>
            <tr :data-probe="probe.key">
              <td class="ep-q" data-code>{{ probe.label }}</td>
              <td class="ep-yours" :data-answer="answers ? answers[probe.key] : undefined">
                {{ answers ? answers[probe.key] : '…' }}
              </td>
              <td
                v-for="engine in ENGINES"
                :key="engine"
                :data-same="answers && answers[probe.key] === snapshot[probe.key]?.[engine] ? 'yes' : 'no'"
              >
                {{ snapshot[probe.key]?.[engine] ?? '—' }}
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
  </DemoFrame>
</template>

<style scoped>
.ep-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.ep-bar__label {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-muted);
}

.ep-verdict {
  padding: 14px 18px;
  border-bottom: 1px solid var(--divider);
  font-size: var(--fs-6);
  line-height: 1.55;
  color: var(--prose);
}
.ep-wait {
  font-family: var(--mono);
  font-size: var(--fs-3);
  font-style: italic;
  color: var(--dim);
}

/* Широкая таблица прокручивается в своей рамке, а не тащит страницу вбок. */
.ep-scroll {
  overflow-x: auto;
}
.ep-table {
  width: 100%;
  min-width: 900px;
  border-collapse: collapse;
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.5;
}
.ep-table th {
  padding: 9px 12px;
  text-align: start;
  font-weight: 500;
  color: var(--text-muted);
  background: var(--surface-2);
  border-bottom: 1px solid var(--divider);
}
.ep-table td {
  padding: 8px 12px;
  text-align: start;
  vertical-align: top;
  color: var(--text-muted);
  border-bottom: 1px solid var(--rule);
  /* Переносить по границам слов: «anywhere» рвал имена вроде setHTML посреди слова. */
  overflow-wrap: break-word;
  min-width: 140px;
}
.ep-group td {
  padding-top: 14px;
  font-size: var(--fs-2);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-faint);
  background: var(--surface);
}
.ep-q {
  /* Вопрос виден и при прокрутке таблицы вбок на узком экране. */
  position: sticky;
  left: 0;
  z-index: 1;
  min-width: 210px;
  color: var(--ink);
  font-weight: 600;
  background: var(--surface);
}
.ep-yours {
  color: var(--ink);
  background: var(--tone-info-bg);
}
/* Совпало с вашим ответом — подсвечено; разошлось — обычным цветом. */
.ep-table td[data-same='yes'] {
  color: var(--tone-ok-strong);
  background: var(--tone-ok-bg);
}
</style>
