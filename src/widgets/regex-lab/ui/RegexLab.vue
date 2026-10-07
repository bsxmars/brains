<script setup lang="ts">
/**
 * «Журнал перебора»: учебный движок шаг за шагом — какой кусок шаблона он проверяет, в какой
 * позиции строки, где возвращается к развилке. Рядом ответ `RegExp` браузера на той же строке.
 *
 * Шаги считает не компонент, а строки `PARSE_CODE` + `MATCH_CODE` из темы, собранные
 * `new Function` (`model/run.ts`). Те же строки напечатаны на странице и сверяются с V8
 * в `tests/unit/regex.test.ts`. Строку можно править; длина ограничена, чтобы плохой шаблон
 * не повесил вкладку настоящим `RegExp` — ровно тем, о чём тема.
 */
import { computed, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import StepToolbar from '@/shared/ui/StepToolbar.vue';
import { SegmentedControl } from '@/shared/ui';
import { loadEngine } from '../model/run';
import type { JournalEntry, TraceExample } from '../model/types';

const props = defineProps<{
  parseCode: string;
  matchCode: string;
  examples: TraceExample[];
  /** Предел шагов учебного движка. */
  limit: number;
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const engine = loadEngine(props.parseCode, props.matchCode);
const MAX_INPUT = 16;
const LOG = 2000;

const picked = ref(props.examples[0].id);
const options = props.examples.map((e) => ({ value: e.id, label: e.label }));
const example = computed(() => props.examples.find((e) => e.id === picked.value) ?? props.examples[0]);

const input = ref(example.value.input);
watch(example, (e) => {
  input.value = e.input;
});
const text = computed(() => input.value.slice(0, MAX_INPUT));

const result = computed(() => engine.match(example.value.pattern, text.value, { limit: props.limit, log: LOG }));
const journal = computed(() => result.value.journal);

const index = ref(0);
watch(result, () => {
  index.value = 0;
});
const total = computed(() => journal.value.length);
const atStart = computed(() => index.value === 0);
const atEnd = computed(() => index.value >= total.value - 1);
const counter = computed(() => `запись ${index.value + 1} / ${total.value}`);
const go = (i: number) => {
  index.value = Math.min(total.value - 1, Math.max(0, i));
};

const entry = computed<JournalEntry | undefined>(() => journal.value[index.value]);

/** Шаблон, разрезанный на «до — текущий кусок — после». */
const patternParts = computed(() => {
  const p = example.value.pattern;
  const [a, b] = entry.value?.at ?? [0, 0];
  return { before: p.slice(0, a), hit: p.slice(a, b), after: p.slice(b) };
});

/** Строка по знакам; позиция за последним знаком — пустая клетка «конец». */
const cells = computed(() => [...text.value, ''].map((ch, i) => ({ i, ch: ch === ' ' ? '␣' : ch === '' ? '⊣' : ch })));

const show = (ch: string | undefined) => (ch === undefined ? 'конец строки' : ch === ' ' ? '«␣»' : `«${ch}»`);

function describe(e: JournalEntry) {
  const piece = example.value.pattern.slice(e.at[0], e.at[1]);
  if (e.kind === 'check') {
    const ch = text.value[e.pos];
    const what = e.text === 'знак' || e.text === 'обратная ссылка' ? ` против ${show(ch)}` : '';
    return `${piece}${what} в позиции ${e.pos}: ${e.ok ? 'да' : 'нет'}`;
  }
  if (e.kind === 'back') return `откат к ${piece}, позиция ${e.pos}: ${e.text}`;
  return e.text;
}

/** Окно журнала вокруг текущей записи. */
const windowRows = computed(() => {
  const from = Math.max(0, index.value - 5);
  return journal.value.slice(from, from + 9).map((e, k) => ({ e, i: from + k, line: describe(e) }));
});

function format(m: { index: number; groups: (string | undefined)[] } | null) {
  if (!m) return 'совпадения нет';
  const groups = m.groups.slice(1).map((g, i) => `$${i + 1} = ${g === undefined ? 'undefined' : JSON.stringify(g)}`);
  return [`${JSON.stringify(m.groups[0])} с позиции ${m.index}`, ...groups].join(', ');
}

const ours = computed(() => (result.value.stopped ? `сдался после ${props.limit.toLocaleString('ru-RU')} шагов` : format(result.value.match)));
const native = computed(() => {
  const m = new RegExp(example.value.pattern).exec(text.value);
  return format(m ? { index: m.index, groups: [...m] } : null);
});
const same = computed(() => !result.value.stopped && ours.value === native.value);

const summary = computed(() => {
  const r = result.value;
  const cut = r.journal.length < r.steps + r.backtracks ? ` Журнал показывает первые ${LOG.toLocaleString('ru-RU')} записей.` : '';
  return `Шагов: **${r.steps.toLocaleString('ru-RU')}**, откатов: **${r.backtracks.toLocaleString('ru-RU')}**.${cut}`;
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="picked" class="l-pills" label="Пример" :options="options" />
    </template>

    <div class="rx-body">
      <Md class="rx-note" :text="example.note" />

      <div class="rx-inputs">
        <span class="rx-label">шаблон</span>
        <code class="rx-pattern-src">/{{ example.pattern }}/</code>
        <label class="rx-label" for="rx-input">строка</label>
        <input id="rx-input" v-model="input" class="rx-input" :maxlength="MAX_INPUT" spellcheck="false" autocomplete="off" />
      </div>

      <div class="rx-screens">
        <pre class="rx-code" aria-label="Шаблон, текущий кусок выделен">{{ patternParts.before }}<mark class="rx-hit" :data-kind="entry?.kind" :data-ok="entry?.ok ? 'yes' : 'no'">{{ patternParts.hit }}</mark>{{ patternParts.after }}</pre>
        <div class="rx-cells" aria-label="Строка, текущая позиция выделена">
          <span
            v-for="c in cells"
            :key="c.i"
            class="rx-cell"
            :data-on="entry && entry.pos === c.i ? (entry.kind === 'check' ? (entry.ok ? 'ok' : 'fail') : 'back') : 'no'"
          >
            <span class="rx-cell__ch">{{ c.ch }}</span>
            <span class="rx-cell__i">{{ c.i }}</span>
          </span>
        </div>
      </div>

      <StepToolbar
        :counter="counter"
        :at-start="atStart"
        :at-end="atEnd"
        @prev="go(index - 1)"
        @next="go(index + 1)"
        @reset="go(0)"
      />
      <input
        v-model.number="index"
        class="rx-range"
        type="range"
        min="0"
        :max="Math.max(0, total - 1)"
        aria-label="Запись журнала"
      />

      <ol class="rx-journal">
        <li v-for="row in windowRows" :key="row.i" class="rx-row" :data-kind="row.e.kind" :data-ok="row.e.ok ? 'yes' : 'no'" :data-on="row.i === index ? 'yes' : 'no'">
          <span class="rx-row__step">{{ row.e.step }}</span>
          <span class="rx-row__text">{{ row.line }}</span>
        </li>
      </ol>

      <div class="rx-verdict">
        <Md class="rx-summary" :text="summary" />
        <div class="rx-answer">
          <span class="rx-label">учебный движок</span>
          <code>{{ ours }}</code>
        </div>
        <div class="rx-answer">
          <span class="rx-label">RegExp браузера</span>
          <code>{{ native }}</code>
        </div>
        <span class="rx-same" :data-same="same ? 'yes' : 'no'">{{ same ? 'ответы совпали' : 'ответы разошлись' }}</span>
      </div>

      <Md class="rx-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.rx-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
  min-width: 0;
}
.rx-note,
.rx-caption,
.rx-summary {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.rx-note :deep(code),
.rx-caption :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}

.rx-inputs {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 8px 12px;
  align-items: center;
}
.rx-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.rx-pattern-src {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
  overflow-wrap: anywhere;
}
.rx-input {
  font: inherit;
  color: inherit;
  font-family: var(--mono);
  min-width: 0;
  max-width: 22em;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--surface);
}

.rx-screens {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.rx-code {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--fs-5);
  line-height: 1.6;
  /* Подложка — общая для кода курса (`pre` в base.css, чернильная): цвета ниже — «на чернилах». */
  color: var(--code-fg);
  white-space: pre-wrap;
  word-break: break-all;
}
.rx-hit {
  border-radius: 3px;
  background: var(--ink-chip);
  color: var(--tone-info-on-ink);
  box-shadow: inset 0 0 0 1px var(--ink-line);
}
.rx-hit[data-kind='check'][data-ok='yes'] {
  color: var(--tone-ok-on-ink);
}
.rx-hit[data-kind='check'][data-ok='no'],
.rx-hit[data-kind='back'] {
  background: var(--warn-wash-on-ink);
  color: var(--tone-warn-on-ink);
  box-shadow: inset 0 0 0 1px var(--tone-warn-accent);
}

.rx-cells {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.rx-cell {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  min-width: 2.1em;
  padding: 4px 2px;
  border-radius: var(--r2);
  background: var(--surface-2);
}
.rx-cell__ch {
  font-family: var(--mono);
  font-size: var(--fs-4);
  color: var(--ink);
}
.rx-cell__i {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-faint);
}
.rx-cell[data-on='ok'] {
  background: var(--tone-ok-bg);
  box-shadow: inset 0 0 0 1px var(--tone-ok-line);
}
.rx-cell[data-on='fail'] {
  background: var(--tone-err-bg);
  box-shadow: inset 0 0 0 1px var(--tone-err-line);
}
.rx-cell[data-on='back'] {
  background: var(--tone-warn-bg);
  box-shadow: inset 0 0 0 1px var(--tone-warn-line);
}

.rx-range {
  font: inherit;
  color: inherit;
  width: 100%;
}

.rx-journal {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.rx-row {
  display: grid;
  grid-template-columns: 3em minmax(0, 1fr);
  gap: 8px;
  padding: 4px 10px;
  border-radius: var(--r2);
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--prose);
}
.rx-row__step {
  color: var(--text-faint);
  text-align: right;
}
.rx-row__text {
  overflow-wrap: anywhere;
}
.rx-row[data-kind='back'] .rx-row__text {
  color: var(--tone-warn-text);
}
.rx-row[data-kind='start'] .rx-row__text {
  color: var(--text-muted);
}
.rx-row[data-kind='check'][data-ok='yes'] .rx-row__text {
  color: var(--tone-ok-text);
}
.rx-row[data-on='yes'] {
  background: var(--surface-2);
  box-shadow: inset 3px 0 0 var(--tone-info-line);
}

.rx-verdict {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.rx-answer {
  display: grid;
  grid-template-columns: 11em minmax(0, 1fr);
  gap: 10px;
  align-items: baseline;
}
@media (max-width: 560px) {
  .rx-answer {
    grid-template-columns: minmax(0, 1fr);
    gap: 2px;
  }
}
.rx-answer code {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
  overflow-wrap: anywhere;
}
.rx-same {
  align-self: flex-start;
  padding: 3px 10px;
  border-radius: var(--r-full);
  font-family: var(--mono);
  font-size: var(--fs-2);
}
.rx-same[data-same='yes'] {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.rx-same[data-same='no'] {
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}
</style>
