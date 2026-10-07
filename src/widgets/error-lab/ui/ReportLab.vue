<script setup lang="ts">
/**
 * «Сборщик отчёта»: случай из темы исполняется в браузере читателя, а то, что вылетело,
 * печатается двумя способами — `JSON.stringify` и `serializeError` из темы.
 *
 * Код случая исполняет `runCase` (`model/run.ts`) — непрямой `eval` с именем файла `case.js`,
 * поэтому стек настоящий, движка читателя. Отчёт собирает строка `SERIALIZE_CODE`, кадры
 * верхней ошибки разбирает `PARSE_CODE`: обе напечатаны на странице и сверены
 * `tests/unit/errors.test.ts` на тех же случаях. Исполнение — только в браузере (`onMounted`):
 * при сборке страницы случай не запускается.
 */
import { computed, onMounted, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { loadParse, loadSerialize, runCase } from '../model/run';
import type { CaseResult, Frame, ReportCase } from '../model/types';

const props = defineProps<{
  parseCode: string;
  serializeCode: string;
  cases: ReportCase[];
  frameOptions: { value: string; label: string }[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const parse = loadParse(props.parseCode);
const serialize = loadSerialize(props.serializeCode);

const picked = ref(props.cases[0].id);
const caseOptions = props.cases.map((c) => ({ value: c.id, label: c.label }));
const current = computed(() => props.cases.find((c) => c.id === picked.value) ?? props.cases[0]);

const maxFrames = ref(props.frameOptions[0].value);

const result = ref<CaseResult | null>(null);

async function run() {
  result.value = null;
  result.value = await runCase(current.value.code);
}
onMounted(run);
watch(picked, run);

const bytes = (s: string) => new TextEncoder().encode(s).length;

const json = computed(() => {
  if (!result.value) return null;
  try {
    const text = JSON.stringify(result.value.value);
    return { text: String(text), bytes: bytes(String(text)), failed: false };
  } catch (e) {
    const text = `${(e as Error).name}: ${String((e as Error).message).split('\n')[0]}`;
    return { text, bytes: 0, failed: true };
  }
});

const report = computed(() => {
  if (!result.value) return null;
  const limit = maxFrames.value === 'all' ? Infinity : Number(maxFrames.value);
  const text = JSON.stringify(serialize(result.value.value, { maxFrames: limit }), null, 2);
  return { text, bytes: bytes(JSON.stringify(serialize(result.value.value, { maxFrames: limit }))) };
});

const frames = computed<Frame[]>(() => {
  const v = result.value?.value;
  return v instanceof Error && typeof v.stack === 'string' ? parse(v.stack) : [];
});

const kind = computed(() => {
  const v = result.value?.value;
  if (!result.value) return '';
  if (v instanceof Error) return `вылетел объект ${v.name}`;
  return `вылетело значение типа ${v === null ? 'null' : typeof v}`;
});

/** Кадры самого случая; остальное — обёртка `runCase` и код виджета, их только считаем. */
const caseLines = computed(() => current.value.code.split('\n').length);
const caseFrames = computed(() => frames.value.filter((f) => f.file === 'case.js' && (f.line ?? 0) <= caseLines.value));
const otherFrames = computed(() => frames.value.length - caseFrames.value.length);

function place(f: Frame) {
  if (f.file === null) return '—';
  return f.line === null ? f.file : `${f.file}:${f.line}:${f.col}`;
}
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="rl-tools">
        <SegmentedControl v-model="picked" class="l-pills" label="Случай" :options="caseOptions" />
        <SegmentedControl v-model="maxFrames" class="l-pills" label="Кадров в отчёте" :options="frameOptions" />
      </div>
    </template>

    <div class="rl-body">
      <Md class="rl-note" :text="current.note" />

      <div class="rl-split">
        <div class="rl-pane">
          <span class="rl-label">case.js</span>
          <pre class="rl-code"><template v-for="(text, i) in current.code.split('\n')" :key="i"><span class="rl-ln">{{ String(i + 1).padStart(2, ' ') }}</span>{{ text }}{{ '\n' }}</template></pre>
        </div>

        <div class="rl-pane">
          <span class="rl-label">кадры верхней ошибки — parseStack</span>
          <p v-if="!result" class="rl-muted">исполняется…</p>
          <p v-else-if="!frames.length" class="rl-muted">{{ kind }}: кадров V8 в стеке нет.</p>
          <ol v-else class="rl-frames">
            <li v-for="(f, i) in caseFrames" :key="i" class="rl-frame">
              <code class="rl-fn">{{ f.async ? 'async ' : '' }}{{ f.fn ?? '(без имени)' }}</code>
              <code class="rl-place">{{ place(f) }}</code>
            </li>
          </ol>
          <p v-if="result && otherFrames > 0" class="rl-muted">И ещё кадров вне case.js: {{ otherFrames }} — обёртка, которая исполняет случай, и код страницы.</p>
        </div>
      </div>

      <div class="rl-split">
        <div class="rl-pane" :data-tone="json?.failed ? 'err' : 'warn'">
          <span class="rl-label">JSON.stringify(e)<template v-if="json && !json.failed"> · {{ json.bytes }} байт</template></span>
          <pre class="rl-code rl-code--wrap">{{ json ? (json.failed ? `бросил ${json.text}` : json.text) : '…' }}</pre>
        </div>

        <div class="rl-pane" data-tone="ok">
          <span class="rl-label">serializeError(e)<template v-if="report"> · {{ report.bytes }} байт</template></span>
          <pre class="rl-code rl-code--wrap rl-code--tall">{{ report ? report.text : '…' }}</pre>
        </div>
      </div>

      <Md class="rl-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.rl-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 18px;
  align-items: center;
}
.rl-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.rl-note,
.rl-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.rl-note :deep(code),
.rl-caption :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}

.rl-split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 760px) {
  .rl-split {
    grid-template-columns: minmax(0, 1fr);
  }
}

.rl-pane {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.rl-pane[data-tone='err'] {
  background: var(--tone-err-bg);
}
.rl-pane[data-tone='ok'] {
  background: var(--tone-ok-bg);
}
.rl-pane[data-tone='warn'] {
  background: var(--tone-warn-bg);
}
.rl-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.rl-muted {
  margin: 0;
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}

.rl-code {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.7;
  /* Подложка — общая для кода курса (`pre` в base.css, чернильная): цвета — «на чернилах». */
  color: var(--code-fg);
  white-space: pre;
  overflow-x: auto;
}
.rl-code--wrap {
  white-space: pre-wrap;
  word-break: break-all;
}
.rl-code--tall {
  max-height: 26em;
  overflow-y: auto;
}
.rl-ln {
  display: inline-block;
  width: 2.6em;
  color: var(--ink-faint);
  user-select: none;
}

.rl-frames {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.rl-frame {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 7px 10px;
  border-radius: var(--r2);
  background: var(--surface);
  box-shadow: inset 3px 0 0 var(--tone-warn-line);
  font-size: var(--fs-3);
}

.rl-fn,
.rl-place {
  padding: 0;
  background: none;
}
.rl-fn {
  font-family: var(--mono);
  font-weight: 600;
  color: var(--ink);
  overflow-wrap: anywhere;
}
.rl-place {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
  overflow-wrap: anywhere;
}
</style>
