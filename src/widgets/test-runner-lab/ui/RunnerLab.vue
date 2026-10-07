<script setup lang="ts">
/**
 * «Сбор и исполнение»: одна фикстура, два раннера. Журнал `log(…)` и итог каждого теста
 * у Vitest и у Jest, строки, где они разошлись, выделены.
 *
 * Считает не компонент, а строка `RUNNER_CODE` из темы, собранная `new Function`
 * (`model/run.ts`), с переключателями `FLAVORS.vitest` и `FLAVORS.jest`. Отметка под колонкой
 * сравнивает ответ с журналом настоящего раннера на той же фикстуре (`real`, снят стендом).
 * `tests/unit/test-runners.test.ts` делает то же сравнение на всех фикстурах и пересобирает
 * `real` настоящими Vitest и Jest.
 *
 * До гидратации (и если учебный раннер не успел) колонки показывают журнал настоящего
 * раннера: тест держит их равными, так что подмены смысла нет.
 */
import { computed, onMounted, ref, shallowRef, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { loadRunner, play } from '../model/run';
import type { RealRun, RunnerName, Scenario, TestState } from '../model/types';

const props = defineProps<{
  runnerCode: string;
  scenarios: Scenario[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const RUNNERS: { id: RunnerName; label: string }[] = [
  { id: 'vitest', label: 'Vitest' },
  { id: 'jest', label: 'Jest' },
];

const picked = ref(props.scenarios[0].id);
const options = props.scenarios.map((s) => ({ value: s.id, label: s.label }));
const scenario = computed(() => props.scenarios.find((s) => s.id === picked.value) ?? props.scenarios[0]);

/** Ответ учебного раннера; `null` — ещё не посчитан, показываем журнал настоящего. */
const mini = shallowRef<Record<RunnerName, RealRun> | null>(null);
let generation = 0;

async function compute() {
  const mine = ++generation;
  const api = loadRunner(props.runnerCode);
  const out = {} as Record<RunnerName, RealRun>;
  for (const r of RUNNERS) {
    const res = await play(api, scenario.value.code, r.id);
    out[r.id] = { log: res.log, results: res.results.map(({ name, state }) => ({ name, state })) };
  }
  if (mine === generation) mini.value = out;
}

watch(picked, () => {
  mini.value = null;
  void compute();
});
onMounted(() => void compute());

const shown = computed(() => mini.value ?? scenario.value.real);

function kind(line: string): 'collect' | 'hook' | 'test' {
  if (line.startsWith('сбор')) return 'collect';
  if (line.startsWith('тест')) return 'test';
  return 'hook';
}

/**
 * Какие строки журнала есть только у этого раннера: всё, что не вошло в наибольшую общую
 * подпоследовательность двух журналов. Сравнение по номеру строки не годится — одна лишняя
 * строка сдвинула бы и пометила весь хвост.
 */
function onlyHere(mine: string[], theirs: string[]): boolean[] {
  const m = mine.length;
  const n = theirs.length;
  const len: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      len[i][j] = mine[i] === theirs[j] ? len[i + 1][j + 1] + 1 : Math.max(len[i + 1][j], len[i][j + 1]);
    }
  }
  const out = new Array<boolean>(m).fill(true);
  for (let i = 0, j = 0; i < m && j < n; ) {
    if (mine[i] === theirs[j]) {
      out[i] = false;
      i++;
      j++;
    } else if (len[i + 1][j] >= len[i][j + 1]) i++;
    else j++;
  }
  return out;
}

const columns = computed(() =>
  RUNNERS.map((r) => {
    const other = r.id === 'vitest' ? 'jest' : 'vitest';
    const run = shown.value[r.id];
    const diff = onlyHere(run.log, shown.value[other].log);
    const real = scenario.value.real[r.id];
    const same = JSON.stringify(run) === JSON.stringify(real);
    return {
      ...r,
      lines: run.log.map((text, i) => ({ text, kind: kind(text), differs: diff[i] })),
      results: run.results,
      verdict: mini.value
        ? same
          ? `учебный раннер = настоящий ${r.label}`
          : `учебный раннер расходится с настоящим ${r.label}`
        : `журнал настоящего ${r.label}`,
      ok: same,
    };
  }),
);

const STATE: Record<TestState, string> = { pass: 'прошёл', fail: 'провален', skip: 'пропущен' };
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="picked" class="l-pills" label="Фикстура" :options="options" />
    </template>

    <div class="trl-body">
      <Md class="trl-note" :text="scenario.note" />

      <div class="trl-split">
        <div class="trl-pane">
          <span class="trl-label">тестовый файл</span>
          <pre class="trl-code">{{ scenario.code }}</pre>
        </div>

        <div class="trl-runs">
          <section v-for="c in columns" :key="c.id" class="trl-run" :aria-label="`Журнал ${c.label}`">
            <span class="trl-label">{{ c.label }}</span>
            <ol class="trl-log">
              <li v-for="(l, i) in c.lines" :key="i" class="trl-line" :data-kind="l.kind" :data-diff="l.differs ? 'yes' : 'no'">
                {{ l.text }}
              </li>
            </ol>
            <ul class="trl-results">
              <li v-for="r in c.results" :key="r.name" class="trl-result" :data-state="r.state">
                {{ r.name }}: {{ STATE[r.state] }}
              </li>
            </ul>
            <span class="trl-verdict" :data-ok="c.ok ? 'yes' : 'no'">{{ c.verdict }}</span>
          </section>
        </div>
      </div>

      <Md class="trl-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.trl-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.trl-note,
.trl-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.trl-note :deep(code),
.trl-caption :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}

.trl-split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 860px) {
  .trl-split {
    grid-template-columns: minmax(0, 1fr);
  }
}

.trl-pane {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.trl-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.trl-code {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.65;
  /* Подложка — общая для кода курса (`pre` в base.css, чернильная). */
  color: var(--code-fg);
  white-space: pre;
  overflow-x: auto;
}

.trl-runs {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
  min-width: 0;
}
@media (max-width: 520px) {
  .trl-runs {
    grid-template-columns: minmax(0, 1fr);
  }
}
.trl-run {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
}

.trl-log {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
  counter-reset: trl;
}
.trl-line {
  counter-increment: trl;
  padding: 2px 6px;
  border-radius: var(--r1);
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.55;
  color: var(--prose);
  overflow-wrap: anywhere;
}
.trl-line::before {
  content: counter(trl) '. ';
  color: var(--text-muted);
}
.trl-line[data-kind='collect'] {
  color: var(--tone-info-text);
}
.trl-line[data-kind='test'] {
  font-weight: 600;
  color: var(--ink);
}
.trl-line[data-diff='yes'] {
  background: var(--tone-warn-bg);
  box-shadow: inset 2px 0 0 var(--tone-warn-line);
}

.trl-results {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.trl-result {
  padding: 2px 8px;
  border-radius: var(--r-full);
  font-size: var(--fs-2);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.trl-result[data-state='fail'] {
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}
.trl-result[data-state='skip'] {
  background: var(--surface-3);
  color: var(--text-muted);
}
.trl-verdict {
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.trl-verdict[data-ok='no'] {
  color: var(--tone-err-text);
}
</style>
