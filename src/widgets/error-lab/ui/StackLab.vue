<script setup lang="ts">
/**
 * «Что осталось от стека»: асинхронный сценарий, его `error.stack` из Node или Chromium и кадры,
 * на которые стек разбит.
 *
 * Стеки — литералы стенда (`ASYNC_CASES` в `data.ts` темы), их пересобирает
 * `tests/unit/errors.test.ts` в Node и Chromium. Кадры считает не компонент, а строка
 * `PARSE_CODE` из темы, собранная `new Function` (`model/run.ts`); она же сверена тестом
 * с CallSite API V8. Компонент только раскладывает результат: какие строки кода стоят
 * в стеке и каких функций файла там нет.
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { loadParse } from '../model/run';
import type { AsyncCase, Frame } from '../model/types';

const props = defineProps<{
  parseCode: string;
  cases: AsyncCase[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const parse = loadParse(props.parseCode);

const picked = ref(props.cases[0].id);
const caseOptions = props.cases.map((c) => ({ value: c.id, label: c.label }));
const current = computed(() => props.cases.find((c) => c.id === picked.value) ?? props.cases[0]);

const engine = ref<'node' | 'chromium'>('node');
const engineOptions = [
  { value: 'node', label: 'Node 24.11' },
  { value: 'chromium', label: 'Chromium 153' },
];

const stack = computed(() => current.value[engine.value]);
const frames = computed<Frame[]>(() => parse(stack.value));

/** Кадр указывает в файл сценария (а не во внутренности Node). */
const inFile = (f: Frame) => Boolean(f.file && f.file.endsWith(`/${current.value.file}`));

/** Строки кода, на которые указывают кадры: номер строки → обычный кадр или `async`. */
const marks = computed(() => {
  const m = new Map<number, 'sync' | 'async'>();
  for (const f of frames.value) {
    if (!inFile(f) || f.line === null) continue;
    if (!m.has(f.line)) m.set(f.line, f.async ? 'async' : 'sync');
  }
  return m;
});

const codeLines = computed(() => current.value.code.split('\n'));

/** Имя функции из кадра: `Timeout._onTimeout` → `_onTimeout`, `new Order` → `Order`. */
const bare = (fn: string | null) => (fn ? fn.replace(/^new /, '').split('.').pop() ?? fn : null);

const declared = computed(() => [...current.value.code.matchAll(/function\s+(\w+)/g)].map((m) => m[1]));
const missing = computed(() => {
  const seen = new Set(frames.value.map((f) => bare(f.fn)));
  return declared.value.filter((name) => !seen.has(name));
});

function place(f: Frame) {
  if (f.file === null) return '—';
  const file = inFile(f) ? current.value.file : f.file;
  return f.line === null ? file : `${file}:${f.line}:${f.col}`;
}
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="el-tools">
        <SegmentedControl v-model="picked" class="l-pills" label="Сценарий" :options="caseOptions" />
        <SegmentedControl v-model="engine" class="l-pills" label="Где снят стек" :options="engineOptions" />
      </div>
    </template>

    <div class="el-body">
      <Md class="el-note" :text="current.note" />

      <div class="el-split">
        <div class="el-pane">
          <span class="el-label">{{ current.file }}</span>
          <pre class="el-code"><template v-for="(text, i) in codeLines" :key="i"><span
            class="el-line"
            :data-mark="marks.get(i + 1) ?? 'none'"
          ><span class="el-ln">{{ String(i + 1).padStart(2, ' ') }}</span>{{ text }}</span>{{ '\n' }}</template></pre>
        </div>

        <div class="el-pane">
          <span class="el-label">кадры — parseStack</span>
          <ol class="el-frames">
            <li v-for="(f, i) in frames" :key="i" class="el-frame" :data-kind="f.async ? 'async' : inFile(f) ? 'sync' : 'other'">
              <span class="el-kind">{{ f.async ? 'async' : 'кадр' }}</span>
              <code class="el-fn">{{ f.fn ?? '(без имени)' }}</code>
              <code class="el-place">{{ place(f) }}</code>
            </li>
          </ol>
          <p class="el-missing">
            <template v-if="missing.length">
              Нет в стеке: <code v-for="(name, i) in missing" :key="name">{{ name }}{{ i < missing.length - 1 ? ', ' : '' }}</code>
            </template>
            <template v-else>Все функции файла есть в стеке.</template>
          </p>
        </div>
      </div>

      <div class="el-pane">
        <span class="el-label">error.stack</span>
        <pre class="el-code el-code--raw">{{ stack }}</pre>
      </div>

      <Md class="el-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.el-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 18px;
  align-items: center;
}
.el-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.el-note,
.el-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.el-note :deep(code),
.el-caption :deep(code),
.el-missing code {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}

.el-split {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 760px) {
  .el-split {
    grid-template-columns: minmax(0, 1fr);
  }
}

.el-pane {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.el-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.el-code {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.7;
  /* Подложка — общая для кода курса (`pre` в base.css, чернильная): цвета ниже — «на чернилах». */
  color: var(--code-fg);
  white-space: pre;
  overflow-x: auto;
}
.el-code--raw {
  white-space: pre-wrap;
  word-break: break-all;
}
.el-line {
  display: inline-block;
  min-width: 100%;
  border-radius: 3px;
}
.el-line[data-mark='sync'] {
  background: var(--warn-wash-on-ink);
  color: var(--tone-warn-on-ink);
  box-shadow: inset 2px 0 0 var(--tone-warn-accent);
}
.el-line[data-mark='async'] {
  background: var(--ink-chip);
  color: var(--tone-info-on-ink);
  box-shadow: inset 2px 0 0 var(--tone-info-on-ink);
}
.el-ln {
  display: inline-block;
  width: 2.6em;
  color: var(--ink-faint);
  user-select: none;
}

.el-frames {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.el-frame {
  display: grid;
  grid-template-columns: 4.2em minmax(0, 1fr);
  gap: 2px 10px;
  align-items: baseline;
  padding: 7px 10px;
  border-radius: var(--r2);
  background: var(--surface);
  font-size: var(--fs-3);
  color: var(--prose);
}
.el-frame[data-kind='sync'] {
  box-shadow: inset 3px 0 0 var(--tone-warn-line);
}
.el-frame[data-kind='async'] {
  box-shadow: inset 3px 0 0 var(--tone-info-line);
}
.el-frame[data-kind='other'] {
  background: var(--surface-3);
}
.el-kind {
  grid-row: span 2;
  font-family: var(--mono);
  font-size: var(--fs-2);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}
.el-fn,
.el-place {
  padding: 0;
  background: none;
}
.el-fn {
  font-family: var(--mono);
  font-weight: 600;
  color: var(--ink);
  overflow-wrap: anywhere;
}
.el-place {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
  overflow-wrap: anywhere;
}
.el-missing {
  margin: 0;
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
</style>
