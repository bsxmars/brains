<script setup lang="ts">
/**
 * «Журнал секретаря»: учебная реактивность на прокси рядом с настоящим Vue.
 *
 * Мини-версию исполняет строка `REACTIVE_CODE` из темы (`model/run.ts`): её журнал —
 * строки `track`/`trigger` и вывод эффектов — считает браузер читателя. Второй переключатель
 * подменяет в той же строке `Reflect.get(target, key, receiver)` на `target[key]`. Рядом тот же
 * сценарий исполняет Vue, который и так стоит на странице (`reactive`, `effect` из `vue`), —
 * не литерал. Совпадение мини-версии с `@vue/reactivity` сторожит
 * `tests/unit/proxy-reflect.test.ts` тем же модулем.
 */
import { effect, effectScope, reactive, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { journal, outputOf, replaceOnce } from '../model/run';
import type { JournalLine, ReactiveApi, ReactiveScenario } from '../model/types';

const props = defineProps<{
  code: string;
  scenarios: ReactiveScenario[];
  /** Строка, которую подменяет режим «receiver потерян», и на что. */
  receiverLine: string;
  receiverLost: string;
}>();

const picked = ref(props.scenarios[0].id);
const options = props.scenarios.map((s) => ({ value: s.id, label: s.label }));
const mode = ref<'kept' | 'lost'>('kept');
const modes = [
  { value: 'kept', label: 'Reflect.get(…, receiver)' },
  { value: 'lost', label: 'target[key]' },
];

const scenario = ref<ReactiveScenario>(props.scenarios[0]);
const lines = ref<JournalLine[]>([]);
const vueOut = ref<string[]>([]);

// `Reactive<T>` у Vue — тот же объект для кода сценария; тип сужен до общего интерфейса двух реализаций.
const vueApi = { reactive, effect } as unknown as ReactiveApi;

/** Вывод сценария или имя ошибки, если он бросил наружу. */
function safely<T>(run: () => T, fallback: (e: unknown) => T): T {
  try {
    return run();
  } catch (e) {
    return fallback(e);
  }
}

watch(
  [picked, mode],
  () => {
    const s = props.scenarios.find((x) => x.id === picked.value) ?? props.scenarios[0];
    scenario.value = s;
    const code = mode.value === 'kept' ? props.code : replaceOnce(props.code, props.receiverLine, props.receiverLost);
    lines.value = safely(
      () => journal(code, s.code),
      (e) => [{ kind: 'out', text: String(e) }],
    );
    // Эффекты Vue живут в своей области и гасятся сразу после прогона — чтобы не копились.
    const scope = effectScope(true);
    vueOut.value = safely(
      () => scope.run(() => outputOf(vueApi, s.code)) ?? [],
      (e) => [String(e)],
    );
    scope.stop();
  },
  { immediate: true },
);

const miniOut = (all: JournalLine[]) => all.filter((l) => l.kind === 'out').map((l) => l.text);
const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="picked" class="l-pills" label="Сценарий" :options="options" />
      <SegmentedControl v-model="mode" class="l-pills" label="Как ловушка get читает значение" :options="modes" />
    </template>

    <div class="pr-body">
      <pre class="pr-code">{{ scenario.code }}</pre>

      <div class="pr-split">
        <div class="pr-pane">
          <span class="pr-label">мини-версия: журнал</span>
          <ol class="pr-journal">
            <li v-for="(line, i) in lines" :key="i" class="pr-line" :data-kind="line.kind">
              <span class="pr-mark">{{ line.kind === 'out' ? 'log' : '···' }}</span>{{ line.text }}
            </li>
          </ol>
        </div>

        <div class="pr-pane">
          <span class="pr-label">настоящий Vue: вывод</span>
          <ol class="pr-journal">
            <li v-for="(text, i) in vueOut" :key="i" class="pr-line" data-kind="out">
              <span class="pr-mark">log</span>{{ text }}
            </li>
          </ol>
          <span class="pr-verdict" :data-same="same(miniOut(lines), vueOut) ? 'yes' : 'no'">
            {{ same(miniOut(lines), vueOut) ? 'вывод совпадает' : 'вывод расходится' }}
          </span>
        </div>
      </div>

      <Md class="pr-note" :text="scenario.note" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.pr-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}

.pr-code {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.7;
  /* Подложка — общая для кода курса (`pre` в base.css, чернильная): цвет — «на чернилах». */
  color: var(--code-fg);
  white-space: pre;
  overflow-x: auto;
}

.pr-split {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 760px) {
  .pr-split {
    grid-template-columns: minmax(0, 1fr);
  }
}

.pr-pane {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.pr-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.pr-journal {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.pr-line {
  display: flex;
  gap: 10px;
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.55;
  overflow-wrap: anywhere;
}
.pr-line[data-kind='trace'] {
  color: var(--text-muted);
}
.pr-line[data-kind='out'] {
  color: var(--ink);
  font-weight: 600;
}
.pr-mark {
  flex: none;
  width: 2.6em;
  font-weight: 400;
  color: var(--text-muted);
}

.pr-verdict {
  align-self: flex-start;
  padding: 3px 10px;
  border-radius: var(--r-full);
  font-family: var(--mono);
  font-size: var(--fs-2);
}
.pr-verdict[data-same='yes'] {
  border: 1px solid var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.pr-verdict[data-same='no'] {
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}

.pr-note {
  font-size: var(--fs-5);
  line-height: 1.6;
  color: var(--prose);
}
.pr-note :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
</style>
