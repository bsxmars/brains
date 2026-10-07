<script setup lang="ts">
/**
 * «Обход и исправления»: текст разбирает espree, по дереву идёт учебный `traverse`, правила
 * `noLooseEq` и `yoda` сообщают о проблемах, `verifyAndFix` вносит правки проход за проходом.
 *
 * Всё, что считается, считают строки `WALK_CODE`, `RULES_CODE` и `LINT_CODE` из темы, собранные
 * `new Function` (`model/run.ts`). Те же строки напечатаны на странице и прогоняются
 * `tests/unit/ast-linters.test.ts` против настоящего ESLint. Компонент только раскладывает
 * результат: подсвечивает `range` в тексте и подписывает шаги.
 */
import { computed, nextTick, onMounted, ref, shallowRef, watch } from 'vue';
import { useStepper } from '@/shared/lib/useStepper';
import CodeInput from '@/shared/ui/CodeInput.vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import StepToolbar from '@/shared/ui/StepToolbar.vue';
import { SegmentedControl } from '@/shared/ui';
import { loadLint, parseError, traceWalk, type Parser } from '../model/run';
import type { AstExample, EsNode, FixResult, LintMessage, WalkEvent } from '../model/types';

const props = defineProps<{
  walkCode: string;
  rulesCode: string;
  lintCode: string;
  examples: AstExample[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

/** Парсер приезжает отдельным чанком при монтировании (см. шапку `model/run.ts`). До этого — заглушка. */
const parser = shallowRef<Parser | null>(null);
onMounted(async () => {
  parser.value = await import('../model/parser');
});
const api = computed(() => (parser.value ? loadLint(props.walkCode, props.rulesCode, props.lintCode, parser.value) : null));

const picked = ref(props.examples[0].id);
const exampleOptions = props.examples.map((e) => ({ value: e.id, label: e.label }));
const example = computed(() => props.examples.find((e) => e.id === picked.value) ?? props.examples[0]);

const view = ref<'walk' | 'fix'>('walk');
const viewOptions = [
  { value: 'walk', label: 'Обход' },
  { value: 'fix', label: 'Исправления' },
];

const text = ref(example.value.code);
watch(example, (e) => {
  text.value = e.code;
});

const error = computed(() => (parser.value ? parseError(text.value, parser.value) : null));

// ─── Обход ─────────────────────────────────────────────────────────────────────────────

const events = computed<WalkEvent[]>(() => (error.value || !api.value || !parser.value ? [] : traceWalk(api.value, text.value, parser.value)));
const total = computed(() => Math.max(1, events.value.length));
const { index, counter, atStart, atEnd, next, prev, reset, go } = useStepper(total);

/** При смене текста — на первый шаг, где сработало правило: там видно самое интересное. */
watch(
  events,
  (list) => {
    const first = list.findIndex((e) => e.reports.length > 0);
    go(first < 0 ? 0 : first);
  },
  { immediate: true },
);

const current = computed<WalkEvent | undefined>(() => events.value[index.value]);

/** Текст, разрезанный на «до родителя / родитель / узел / родитель / после». */
const walkParts = computed(() => {
  const t = text.value;
  const node = current.value?.node;
  if (!node) return [{ text: t, kind: '' }];
  const [ns, ne] = node.range;
  const parent = node.parent ?? null;
  const [ps, pe] = parent ? parent.range : [ns, ne];
  return [
    { text: t.slice(0, ps), kind: '' },
    { text: t.slice(ps, ns), kind: 'parent' },
    { text: t.slice(ns, ne), kind: 'node' },
    { text: t.slice(ne, pe), kind: 'parent' },
    { text: t.slice(pe), kind: '' },
  ].filter((p) => p.text.length > 0);
});

/** Короткая подпись узла: тип и то, что его отличает от соседей того же типа. */
function label(node: EsNode): string {
  const extra = node.operator ?? node.name ?? node.raw ?? (node.type === 'TemplateElement' ? `«${(node.value as { raw: string }).raw}»` : '');
  return extra ? `${node.type} ${String(extra)}` : node.type;
}

const path = computed(() => {
  const out: string[] = [];
  for (let n = current.value?.node ?? null; n; n = n.parent ?? null) out.unshift(n.type);
  return out;
});

/** Поля текущего узла: простые значения как есть, дети — их типом. */
const fields = computed(() => {
  const node = current.value?.node;
  if (!node) return [];
  const skip = new Set(['type', 'start', 'end', 'loc', 'range', 'parent', 'tokens', 'comments']);
  const childKeys = new Set(parser.value?.KEYS[node.type] ?? []);
  const rows: { k: string; v: string; child: boolean }[] = [];
  for (const [k, v] of Object.entries(node)) {
    if (skip.has(k)) continue;
    if (childKeys.has(k)) {
      const list = Array.isArray(v) ? v : [v];
      const shown = list.map((c) => (c ? (c as EsNode).type : 'null'));
      rows.push({ k, v: Array.isArray(v) ? `[${shown.join(', ')}]` : shown[0], child: true });
    } else if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) {
      rows.push({ k, v: typeof v === 'string' ? JSON.stringify(v) : String(v), child: false });
    }
  }
  rows.push({ k: 'range', v: `[${node.range[0]}, ${node.range[1]}]`, child: false });
  return rows;
});

const logBox = ref<HTMLElement | null>(null);
async function scrollLog() {
  await nextTick();
  const box = logBox.value;
  const row = box?.querySelector<HTMLElement>(`[data-i="${index.value}"]`);
  if (!box || !row) return;
  // Прокручиваем только свою рамку, не страницу: scrollIntoView потянул бы и окно.
  box.scrollTop = row.offsetTop - box.clientHeight / 2 + row.clientHeight / 2;
}
watch([index, view], scrollLog);
onMounted(scrollLog);

// ─── Исправления ───────────────────────────────────────────────────────────────────────

const fixResult = computed<FixResult | null>(() => (error.value || !api.value ? null : api.value.verifyAndFix(text.value, api.value.rules)));

/** Текст прохода с подсветкой: отложенная правка поверх внесённой — она и есть пересечение. */
function paint(t: string, applied: LintMessage[], skipped: LintMessage[]) {
  const kind = (i: number) => {
    if (skipped.some((m) => m.fix && i >= m.fix.range[0] && i < m.fix.range[1])) return 'skip';
    if (applied.some((m) => m.fix && i >= m.fix.range[0] && i < m.fix.range[1])) return 'fix';
    return '';
  };
  const parts: { text: string; kind: string }[] = [];
  for (let i = 0; i < t.length; i++) {
    const k = kind(i);
    const last = parts.at(-1);
    if (last && last.kind === k) last.text += t[i];
    else parts.push({ text: t[i], kind: k });
  }
  return parts;
}

function status(m: LintMessage, applied: LintMessage[], skipped: LintMessage[]) {
  if (applied.includes(m)) return { text: 'внесена', tone: 'ok' };
  if (skipped.includes(m)) return { text: 'отложена', tone: 'warn' };
  return { text: 'без правки', tone: 'none' };
}

const short = (id: string) => id.replace(/^demo\//, '');
const fixText = (m: LintMessage) => (m.fix ? `[${m.fix.range[0]}, ${m.fix.range[1]}] → ${JSON.stringify(m.fix.text)}` : '');
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="al-bar">
        <SegmentedControl v-model="picked" class="l-pills" label="Пример" :options="exampleOptions" />
        <SegmentedControl v-model="view" class="l-pills" label="Режим" :options="viewOptions" />
      </div>
    </template>

    <div class="al-body">
      <Md class="al-note" :text="example.note" />

      <CodeInput v-model="text" label="код — можно править" :rows="8" />

      <p v-if="!parser" class="al-loading">Загружаю парсер espree…</p>
      <p v-else-if="error" class="al-error">{{ error }}</p>

      <template v-else-if="view === 'walk'">
        <StepToolbar :counter="counter" :at-start="atStart" :at-end="atEnd" @prev="prev" @next="next" @reset="reset" />

        <div class="al-split">
          <div class="al-pane">
            <span class="al-label">текст: узел и его родитель</span>
            <pre class="al-code"><span
              v-for="(p, i) in walkParts"
              :key="i"
              :class="p.kind ? `al-${p.kind}` : undefined"
            >{{ p.text }}</span></pre>
          </div>

          <div class="al-pane">
            <span class="al-label">вход → и выход ← по порядку</span>
            <div ref="logBox" class="al-log" role="list" aria-label="Шаги обхода">
              <div
                v-for="(e, i) in events"
                :key="i"
                :data-i="i"
                class="al-step"
                :data-on="i === index ? 'yes' : 'no'"
                role="listitem"
                :style="{ paddingLeft: `calc(${e.depth} * 1.1em + 8px)` }"
                @click="go(i)"
              >
                <span class="al-arrow">{{ e.kind === 'enter' ? '→' : '←' }}</span>
                {{ e.kind === 'enter' ? label(e.node) : e.node.type }}<span v-if="e.reports.length" class="al-hits"> · {{ e.reports.map((r) => short(r.ruleId)).join(', ') }}</span>
              </div>
            </div>
          </div>
        </div>

        <div v-if="current" class="al-detail">
          <div class="al-path">
            <span v-for="(t, i) in path" :key="i" class="al-crumb" :data-last="i === path.length - 1 ? 'yes' : 'no'">{{ t }}</span>
          </div>
          <div class="al-fields">
            <div v-for="f in fields" :key="f.k" class="al-field">
              <code class="al-field__k">{{ f.k }}</code>
              <code class="al-field__v" :data-child="f.child ? 'yes' : 'no'">{{ f.v }}</code>
            </div>
          </div>
          <div v-for="(r, i) in current.reports" :key="i" class="al-report">
            <code>{{ r.ruleId }}</code>
            <span>{{ r.message }}</span>
            <span class="al-tag" :data-tone="r.fixable ? 'ok' : 'none'">{{ r.fixable ? 'с правкой' : 'без правки' }}</span>
          </div>
        </div>
      </template>

      <template v-else-if="fixResult">
        <div v-for="(p, n) in fixResult.passes" :key="n" class="al-pass">
          <div class="al-pass__head">
            <span class="al-pass__n">проход {{ n + 1 }}</span>
            <span class="al-pass__sum">сообщений {{ p.messages.length }} · внесено {{ p.applied.length }} · отложено {{ p.skipped.length }}</span>
          </div>
          <pre class="al-code"><span
            v-for="(part, i) in paint(p.text, p.applied, p.skipped)"
            :key="i"
            :class="part.kind ? `al-${part.kind}` : undefined"
          >{{ part.text }}</span></pre>
          <div v-for="(m, i) in p.messages" :key="i" class="al-msg">
            <code class="al-msg__pos">{{ m.line }}:{{ m.column }}</code>
            <code class="al-msg__rule">{{ short(m.ruleId) }}</code>
            <span class="al-msg__text">{{ m.message }}</span>
            <span class="al-tag" :data-tone="status(m, p.applied, p.skipped).tone">{{ status(m, p.applied, p.skipped).text }}</span>
            <code v-if="m.fix" class="al-msg__fix">{{ fixText(m) }}</code>
          </div>
        </div>

        <div class="al-pass al-pass--final">
          <div class="al-pass__head">
            <span class="al-pass__n">итог</span>
            <span class="al-pass__sum">
              проходов {{ fixResult.passes.length }}{{ fixResult.recheck ? ' и ещё одна проверка' : '' }} · осталось сообщений {{ fixResult.messages.length }}
            </span>
          </div>
          <pre class="al-code">{{ fixResult.output }}</pre>
        </div>
      </template>

      <Md class="al-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.al-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 20px;
  align-items: center;
}
.al-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.al-note,
.al-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.al-note :deep(code),
.al-caption :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
.al-loading {
  margin: 0;
  font-size: var(--fs-3);
  color: var(--text-muted);
}
.al-error {
  margin: 0;
  padding: 10px 14px;
  border-radius: var(--r2);
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
  font-family: var(--mono);
  font-size: var(--fs-3);
}

.al-split {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 760px) {
  .al-split {
    grid-template-columns: minmax(0, 1fr);
  }
}
.al-pane {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.al-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.al-code {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.75;
  /* Подложка — общая для кода курса (`pre` в base.css, чернильная): цвета ниже — «на чернилах». */
  color: var(--code-fg);
  white-space: pre;
  overflow-x: auto;
}
.al-parent {
  background: var(--ink-chip);
}
.al-node,
.al-skip {
  border-radius: 3px;
  background: var(--warn-wash-on-ink);
  color: var(--tone-warn-on-ink);
  box-shadow: inset 0 0 0 1px var(--tone-warn-accent);
}
.al-fix {
  color: var(--tone-ok-on-ink);
  background: var(--ink-chip);
  box-shadow: inset 0 -2px 0 var(--tone-ok-on-ink);
}

.al-log {
  position: relative;
  max-height: 320px;
  overflow-y: auto;
  padding: 6px 0;
  border-radius: var(--r2);
  background: var(--surface);
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.6;
  color: var(--prose);
}
.al-step {
  padding-right: 8px;
  white-space: nowrap;
  cursor: pointer;
}
.al-step:hover {
  background: var(--surface-3);
}
.al-step[data-on='yes'] {
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.al-arrow {
  color: var(--text-muted);
}
.al-hits {
  color: var(--tone-err-text);
}

.al-detail {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.al-path {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 6px;
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.al-crumb + .al-crumb::before {
  content: '›';
  margin-right: 6px;
  color: var(--text-faint);
}
.al-crumb[data-last='yes'] {
  color: var(--ink);
  font-weight: 600;
}
.al-fields {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr));
  gap: 6px;
}
.al-field {
  display: flex;
  gap: 8px;
  align-items: baseline;
  min-width: 0;
  padding: 6px 10px;
  border-radius: var(--r2);
  background: var(--surface-2);
}
.al-field code {
  font-family: var(--mono);
  font-size: var(--fs-3);
  overflow-wrap: anywhere;
}
.al-field__k {
  color: var(--text-muted);
}
.al-field__v {
  color: var(--ink);
}
.al-field__v[data-child='yes'] {
  color: var(--tone-info-text);
}

.al-report,
.al-msg {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  align-items: baseline;
  padding: 8px 12px;
  border-radius: var(--r2);
  background: var(--surface-2);
  font-size: var(--fs-3);
  color: var(--prose);
}
.al-report code,
.al-msg code {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--ink);
}
.al-msg__pos {
  color: var(--text-muted) !important;
}
.al-msg__text {
  flex: 1 1 14em;
}
.al-msg__fix {
  flex-basis: 100%;
  overflow-wrap: anywhere;
  color: var(--text-muted) !important;
}
.al-tag {
  padding: 1px 8px;
  border-radius: var(--r-full);
  font-family: var(--mono);
  font-size: var(--fs-2);
  background: var(--surface-3);
  color: var(--text-muted);
}
.al-tag[data-tone='ok'] {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.al-tag[data-tone='warn'] {
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}

.al-pass {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.al-pass .al-msg {
  background: var(--surface);
}
.al-pass__head {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  align-items: baseline;
}
.al-pass__n {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--ink);
  font-weight: 600;
}
.al-pass__sum {
  font-size: var(--fs-3);
  color: var(--text-muted);
}
</style>
