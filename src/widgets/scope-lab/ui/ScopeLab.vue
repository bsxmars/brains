<script setup lang="ts">
/**
 * «Окружения по шагам»: программа, текущая строка, окружения на этом шаге — цепочка от
 * текущего наружу и те, что живы только благодаря замыканиям, — и вывод.
 *
 * Шаги и окружения считает не компонент, а строки `ENV_CODE` … `EVAL_CODE` из темы,
 * собранные `new Function` (`model/run.ts`). Те же строки напечатаны на странице и сверены
 * `tests/unit/closures.test.ts` с V8. Вторую колонку вывода даёт движок браузера читателя:
 * та же программа через `new Function` в строгом режиме (`runReal`).
 */
import { computed, onMounted, ref, shallowRef, watch } from 'vue';
import { useStepper } from '@/shared/lib/useStepper';
import CodeInput from '@/shared/ui/CodeInput.vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import StepToolbar from '@/shared/ui/StepToolbar.vue';
import { SegmentedControl } from '@/shared/ui';
import { parseError, runReal, traceProgram } from '../model/run';
import type { EnvView, EsNode, OutLine, ScopeProgram, Trace } from '../model/types';

const props = defineProps<{
  /** Пять строк интерпретатора из темы, по порядку. */
  codes: string[];
  programs: ScopeProgram[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

/** Парсер приезжает отдельным чанком при монтировании (см. `model/parser.ts`). */
const parse = shallowRef<((t: string) => EsNode) | null>(null);
onMounted(async () => {
  parse.value = (await import('../model/parser')).parse;
});

const picked = ref(props.programs[0].id);
const options = props.programs.map((p) => ({ value: p.id, label: p.label }));
const program = computed(() => props.programs.find((p) => p.id === picked.value) ?? props.programs[0]);

const text = ref(program.value.code);
watch(program, (p) => {
  text.value = p.code;
});
const edited = computed(() => text.value !== program.value.code);

const syntax = computed(() => (parse.value ? parseError(text.value, parse.value) : null));

const trace = computed<Trace | null>(() => {
  if (!parse.value || syntax.value) return null;
  return traceProgram(props.codes, parse.value(text.value));
});

const problem = computed(() => syntax.value ?? trace.value?.problem ?? null);

const total = computed(() => Math.max(1, trace.value?.steps.length ?? 1));
const { index, counter, atStart, atEnd, next, prev, reset } = useStepper(total);
watch(trace, () => reset());

const current = computed(() => trace.value?.steps[index.value]);
const lines = computed(() => text.value.split('\n'));

const ROLE: Record<EnvView['role'], string> = {
  current: 'текущее',
  chain: 'снаружи',
  held: 'держит замыкание',
};

const stats = computed(() => {
  const s = current.value;
  return s ? `создано ${s.created} · достижимо ${s.alive}` : '';
});

/** Вывод той же программы движком браузера. Только если интерпретатор прошёл её до конца. */
const real = ref<OutLine[] | null>(null);
let runId = 0;
watch(
  trace,
  async (tr) => {
    const id = ++runId;
    real.value = null;
    if (!tr || tr.problem) return;
    const out = await runReal(text.value);
    if (id === runId) real.value = out;
  },
  { immediate: true },
);

const verdict = computed(() => {
  const tr = trace.value;
  if (!tr || tr.problem || !real.value) return '';
  const mine = tr.out.map((l) => l.text);
  const theirs = real.value.map((l) => l.text);
  if (mine.join('\n') === theirs.join('\n')) return 'Вывод интерпретатора и движка совпал строка в строку.';
  const kind = (s: string) => s.split(':')[0];
  if (mine.length === theirs.length && mine.every((s, i) => kind(s) === kind(theirs[i])))
    return 'Совпало всё, кроме текста ошибки: тип тот же, а слова у движка вашего браузера свои. Интерпретатор пишет тексты V8.';
  return 'Вывод разошёлся. Если программа не выходит за подмножество интерпретатора, это ошибка темы.';
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="picked" class="l-pills" label="Программа" :options="options" />
    </template>

    <div class="cl-body">
      <Md class="cl-note" :text="program.note" />

      <div class="cl-split">
        <div class="cl-pane">
          <span class="cl-label">{{ edited ? 'программа — изменена' : 'программа' }}</span>
          <pre class="cl-code"><template v-for="(line, i) in lines" :key="i"><span
            class="cl-line"
            :data-on="current && current.line === i + 1 ? 'yes' : 'no'"
          ><span class="cl-ln">{{ String(i + 1).padStart(2, ' ') }}</span>{{ line }}</span>{{ '\n' }}</template></pre>
          <details class="cl-edit">
            <summary>Изменить программу</summary>
            <CodeInput v-model="text" label="программа" :rows="9" />
          </details>
        </div>

        <div class="cl-pane">
          <span class="cl-label">окружения<template v-if="stats"> · {{ stats }}</template></span>
          <p v-if="!parse" class="cl-msg">Загружаю парсер…</p>
          <Md v-else-if="problem" class="cl-msg cl-msg--err" :text="problem" />
          <div v-else-if="current" class="cl-envs">
            <div v-for="env in current.envs" :key="env.id" class="cl-env" :data-role="env.role">
              <div class="cl-env__head">
                <span class="cl-env__id">#{{ env.id }}</span>
                <span class="cl-env__title">{{ env.title }}</span>
                <span class="cl-env__role">{{ ROLE[env.role] }}</span>
              </div>
              <div class="cl-env__outer">outer → {{ env.outer === null ? 'нет' : `#${env.outer}` }}</div>
              <div v-if="env.vars.length === 0" class="cl-var cl-var--empty">имён нет</div>
              <div v-for="v in env.vars" :key="v.name" class="cl-var">
                <span class="cl-var__name">{{ v.name }}</span>
                <span class="cl-var__kind">{{ v.kind }}</span>
                <span v-if="v.tdz" class="cl-var__tdz">мёртвая зона</span>
                <span v-else class="cl-var__value">{{ v.value }}<template v-if="v.fnEnv !== null"> · создана в #{{ v.fnEnv }}</template></span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-if="trace && !problem" class="cl-steps">
        <StepToolbar :counter="counter" :at-start="atStart" :at-end="atEnd" @prev="prev" @next="next" @reset="reset" />
        <Md v-if="current" class="cl-step-note" :text="current.note" />
      </div>

      <div class="cl-outs">
        <div class="cl-pane">
          <span class="cl-label">вывод интерпретатора — к этому шагу</span>
          <pre class="cl-out"><template v-if="current"><span
            v-for="(l, i) in current.out"
            :key="i"
            :class="{ 'cl-out__err': l.error }"
          >{{ l.text }}{{ '\n' }}</span></template></pre>
        </div>
        <div class="cl-pane">
          <span class="cl-label">движок вашего браузера — вся программа</span>
          <pre class="cl-out"><template v-if="real"><span
            v-for="(l, i) in real"
            :key="i"
            :class="{ 'cl-out__err': l.error }"
          >{{ l.text }}{{ '\n' }}</span></template></pre>
          <Md v-if="verdict" class="cl-verdict" :text="verdict" />
        </div>
      </div>

      <Md class="cl-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.cl-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.cl-note,
.cl-caption,
.cl-step-note,
.cl-verdict {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.cl-note :deep(code),
.cl-caption :deep(code),
.cl-step-note :deep(code),
.cl-verdict :deep(code),
.cl-msg :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}

.cl-split,
.cl-outs {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 760px) {
  .cl-split,
  .cl-outs {
    grid-template-columns: minmax(0, 1fr);
  }
}

.cl-pane {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.cl-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}

/* Подложка `pre` — общая чернильная (base.css): цвета ниже — «на чернилах». */
.cl-code,
.cl-out {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.75;
  color: var(--code-fg);
  white-space: pre;
  overflow-x: auto;
}
.cl-out {
  min-height: 3.5em;
}
.cl-line {
  display: inline-block;
  min-width: 100%;
  border-radius: 3px;
}
.cl-line[data-on='yes'] {
  background: var(--warn-wash-on-ink);
  color: var(--tone-warn-on-ink);
  box-shadow: inset 2px 0 0 var(--tone-warn-accent);
}
.cl-ln {
  display: inline-block;
  width: 2.6em;
  color: var(--ink-faint);
  user-select: none;
}
.cl-out__err {
  color: var(--tone-warn-on-ink);
}

.cl-edit summary {
  cursor: pointer;
  font-size: var(--fs-3);
  color: var(--prose);
}
.cl-edit[open] summary {
  margin-bottom: 8px;
}

.cl-msg {
  margin: 0;
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.cl-msg--err {
  padding: 10px 12px;
  border-radius: var(--r2);
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}

.cl-envs {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.cl-env {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 9px 11px;
  border-radius: var(--r2);
  background: var(--surface);
  box-shadow: inset 3px 0 0 var(--border-strong);
  font-size: var(--fs-3);
  color: var(--prose);
}
.cl-env[data-role='current'] {
  background: var(--tone-info-bg);
  box-shadow: inset 3px 0 0 var(--tone-info-line);
}
.cl-env[data-role='held'] {
  background: var(--tone-warn-bg);
  box-shadow: inset 3px 0 0 var(--tone-warn-line);
}
.cl-env__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
}
.cl-env__id {
  font-family: var(--mono);
  font-weight: 600;
  color: var(--ink);
}
.cl-env__title {
  font-weight: 600;
  color: var(--ink);
}
.cl-env__role {
  margin-left: auto;
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.cl-env__outer {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.cl-var {
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) 4.6em minmax(0, 1.4fr);
  gap: 8px;
  align-items: baseline;
  padding-top: 4px;
  border-top: 1px solid var(--hairline);
}
.cl-var--empty {
  display: block;
  color: var(--text-muted);
}
.cl-var__name,
.cl-var__value {
  font-family: var(--mono);
  overflow-wrap: anywhere;
  color: var(--ink);
}
.cl-var__name {
  font-weight: 600;
}
.cl-var__kind {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.cl-var__tdz {
  font-size: var(--fs-2);
  font-weight: 600;
  color: var(--tone-err-text);
}

.cl-steps {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
</style>
