<script setup lang="ts">
/**
 * «Запрос через три сервиса»: заголовки `traceparent` на каждом переходе, водопад спанов
 * и поля выбранного спана, плюс логи того же запроса.
 *
 * Данные — сценарии стенда (см. шапку `data.ts` темы «Наблюдаемость»). Дерево строят
 * `buildTree`/`waterfall` из `TREE_CODE`, заголовок разбирает `parseTraceparent` из
 * `TRACEPARENT_CODE` — строки темы, собранные `new Function` (`model/run.ts`) и сверенные
 * `tests/unit/observability.test.ts` с OpenTelemetry SDK. Компонент только раскладывает.
 */
import { computed, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { loadTraceparent, loadTree } from '../model/run';
import type { SpanNode, TraceScenario } from '../model/types';

const props = defineProps<{
  traceparentCode: string;
  treeCode: string;
  scenarios: TraceScenario[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
  /** Что сказать, когда спанов нет. Строчная разметка. */
  emptyNote: string;
}>();

const tp = loadTraceparent(props.traceparentCode);
const tree = loadTree(props.treeCode);

const picked = ref(props.scenarios[0].id);
const options = props.scenarios.map((s) => ({ value: s.id, label: s.label }));
const scenario = computed(() => props.scenarios.find((s) => s.id === picked.value) ?? props.scenarios[0]);

const rows = computed(() => tree.waterfall(tree.buildTree(scenario.value.spans)));
const total = computed(() => Math.max(1, ...scenario.value.spans.map((s) => s.end)));

const selId = ref<string | null>(null);
watch(
  scenario,
  () => {
    // По умолчанию — самый глубокий спан с ошибкой, иначе SERVER-спан api.
    const err = rows.value.filter((r) => r.span.status === 'ERROR').at(-1);
    selId.value = (err ?? rows.value.find((r) => r.span.kind === 'SERVER') ?? rows.value[0])?.span.spanId ?? null;
  },
  { immediate: true },
);
const selected = computed<SpanNode | undefined>(() => rows.value.find((r) => r.span.spanId === selId.value)?.span);

const short = (id: string) => `${id.slice(0, 4)}…${id.slice(-4)}`;

/** Переходы: заголовок, разобранный учебной функцией, и спан-отправитель, если записан. */
const hops = computed(() =>
  scenario.value.hops.map((h) => {
    const p = tp.parseTraceparent(h.traceparent);
    const sender = p ? scenario.value.spans.find((s) => s.spanId === p.parentId) : undefined;
    const parts = h.traceparent.split('-');
    return { ...h, p, parts, sender };
  }),
);

const bar = (start: number, end: number) => ({
  left: `${(start / total.value) * 100}%`,
  width: `${Math.max(((end - start) / total.value) * 100, 0.6)}%`,
});

const fields = computed(() => {
  const s = selected.value;
  if (!s) return [];
  return [
    ['service', s.service],
    ['name', s.name],
    ['kind', s.kind],
    ['traceId', s.traceId],
    ['spanId', s.spanId],
    ['parentSpanId', s.parentSpanId ?? '— (корень)'],
    ['start → end', `${s.start} → ${s.end} мс (${s.end - s.start} мс)`],
    ['status', s.status],
    ...Object.entries(s.attributes).map(([k, v]) => [k, String(v)]),
    ...s.events.map((e) => [`событие ${e.name}`, `${e.time} мс · ${String(e.attributes['exception.message'] ?? '')}`]),
  ] as [string, string][];
});

/** Откуда родитель выбранного спана: из памяти процесса или из заголовка. */
const parentLine = computed(() => {
  const s = selected.value;
  if (!s) return '';
  if (!s.parentSpanId) return `Корень трассы: родителя нет, trace id \`${short(s.traceId)}\` выдал SDK этого процесса.`;
  const parent = scenario.value.spans.find((x) => x.spanId === s.parentSpanId);
  if (!parent) return 'Родителя в списке нет — спан-сирота.';
  if (parent.service === s.service) return `Родитель \`${parent.name}\` в том же процессе: передан в памяти.`;
  const hop = scenario.value.hops.find((h) => h.traceparent.includes(s.parentSpanId!));
  return `Родитель — \`${parent.name}\` сервиса ${parent.service}. Его номер приехал в заголовке \`${hop?.traceparent ?? ''}\`.`;
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="picked" class="l-pills" label="Сценарий" :options="options" />
    </template>

    <div class="tl-body">
      <Md class="tl-note" :text="scenario.note" />

      <div class="tl-hops">
        <div v-for="h in hops" :key="h.from + h.to" class="tl-hop">
          <span class="tl-label">{{ h.from }} → {{ h.to }}</span>
          <code class="tl-header"
            >traceparent: <span class="tl-part tl-part--ver">{{ h.parts[0] }}</span>-<span class="tl-part tl-part--trace">{{ h.parts[1] }}</span>-<span
              class="tl-part tl-part--parent"
              >{{ h.parts[2] }}</span
            >-<span class="tl-part" :class="h.p?.sampled ? 'tl-part--on' : 'tl-part--off'">{{ h.parts[3] }}</span></code
          >
          <span class="tl-hop__what">
            parent-id — {{ h.sender ? `${h.sender.kind}-спан «${h.sender.name}» сервиса ${h.sender.service}` : 'спан не записан' }};
            выборка: {{ h.p?.sampled ? 'да' : 'нет' }}
          </span>
        </div>
      </div>

      <div class="tl-split">
        <div class="tl-pane">
          <span class="tl-label">водопад · 0 – {{ total }} мс</span>
          <Md v-if="!rows.length" class="tl-empty" :text="emptyNote" />
          <div v-else class="tl-rows" role="list">
            <button
              v-for="r in rows"
              :key="r.span.spanId"
              type="button"
              role="listitem"
              class="tl-row"
              :data-on="r.span.spanId === selId ? 'yes' : 'no'"
              :data-err="r.span.status === 'ERROR' ? 'yes' : 'no'"
              :aria-pressed="r.span.spanId === selId"
              @click="selId = r.span.spanId"
            >
              <span class="tl-row__name" :style="{ paddingLeft: `${r.depth * 0.9}em` }">
                <span class="tl-svc" :data-svc="r.span.service">{{ r.span.service }}</span>
                <span class="tl-row__text">{{ r.span.name }}</span>
              </span>
              <span class="tl-track">
                <span class="tl-bar" :data-svc="r.span.service" :style="bar(r.span.start, r.span.end)" />
              </span>
            </button>
          </div>
        </div>

        <div class="tl-pane">
          <span class="tl-label">поля спана</span>
          <template v-if="selected">
            <dl class="tl-fields">
              <template v-for="[k, v] in fields" :key="k">
                <dt>{{ k }}</dt>
                <dd>{{ v }}</dd>
              </template>
            </dl>
            <Md class="tl-parent" :text="parentLine" />
          </template>
          <Md v-else class="tl-empty" :text="emptyNote" />
        </div>
      </div>

      <div class="tl-pane">
        <span class="tl-label">логи этого запроса</span>
        <pre class="tl-logs"><template v-for="(l, i) in scenario.logs" :key="i"><span
          class="tl-log"
          :data-err="l.level === 'error' ? 'yes' : 'no'"
          :data-on="l.span_id === selId ? 'yes' : 'no'"
        >{{ l.ts.slice(11, 23) }} {{ l.level.padEnd(5) }} {{ l.service.padEnd(5) }} {{ l.msg }}
             trace_id={{ short(l.trace_id) }} span_id={{ short(l.span_id) }}</span>{{ '\n' }}</template></pre>
      </div>

      <Md class="tl-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.tl-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.tl-note,
.tl-caption,
.tl-parent,
.tl-empty {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.tl-note :deep(code),
.tl-caption :deep(code),
.tl-parent :deep(code),
.tl-empty :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
  overflow-wrap: anywhere;
}
.tl-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.tl-hops {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.tl-hop {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 10px 12px;
  border-radius: var(--r2);
  background: var(--surface-2);
}
.tl-header {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
  overflow-wrap: anywhere;
}
.tl-part {
  border-radius: 3px;
  padding: 0 2px;
}
.tl-part--ver {
  color: var(--text-muted);
}
.tl-part--trace {
  background: var(--tone-info-chip);
  color: var(--tone-info-text);
}
.tl-part--parent {
  background: var(--tone-warn-chip);
  color: var(--tone-warn-text);
}
.tl-part--on {
  background: var(--tone-ok-chip);
  color: var(--tone-ok-text);
}
.tl-part--off {
  background: var(--tone-err-chip);
  color: var(--tone-err-text);
}
.tl-hop__what {
  font-size: var(--fs-2);
  color: var(--text-muted);
}

.tl-split {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 760px) {
  .tl-split {
    grid-template-columns: minmax(0, 1fr);
  }
}
.tl-pane {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
}

.tl-rows {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.tl-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 10px;
  align-items: center;
  width: 100%;
  padding: 6px 8px;
  border: 0;
  border-radius: var(--r1);
  background: var(--surface);
  font: inherit;
  font-size: var(--fs-3);
  color: var(--prose);
  text-align: left;
  cursor: pointer;
}
.tl-row:hover,
.tl-row:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 1px var(--border-strong);
}
.tl-row[data-on='yes'] {
  box-shadow: inset 0 0 0 1px var(--tone-info-strong);
  background: var(--tone-info-bg);
}
.tl-row[data-err='yes'] .tl-row__text {
  color: var(--tone-err-text);
  font-weight: 600;
}
.tl-row__name {
  display: flex;
  gap: 6px;
  align-items: baseline;
  min-width: 0;
}
.tl-row__text {
  overflow-wrap: anywhere;
}
.tl-svc {
  flex: none;
  padding: 0 5px;
  border-radius: 3px;
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--chip-text);
  background: var(--surface-3);
}
.tl-svc[data-svc='web'] {
  background: var(--tone-info-chip);
}
.tl-svc[data-svc='api'] {
  background: var(--tone-warn-chip);
}
.tl-svc[data-svc='stock'] {
  background: var(--tone-ok-chip);
}
.tl-track {
  position: relative;
  height: 12px;
  border-radius: 3px;
  background: var(--surface-3);
}
.tl-bar {
  position: absolute;
  top: 0;
  bottom: 0;
  border-radius: 3px;
  background: var(--bar-neutral);
}
.tl-bar[data-svc='web'] {
  background: var(--bar-violet);
}
.tl-bar[data-svc='api'] {
  background: var(--bar-amber);
}
.tl-bar[data-svc='stock'] {
  background: var(--bar-green);
}
.tl-row[data-err='yes'] .tl-bar {
  box-shadow: 0 0 0 2px var(--tone-err-strong);
}

.tl-fields {
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.4fr);
  gap: 4px 10px;
  margin: 0;
  font-size: var(--fs-3);
}
.tl-fields dt {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
  overflow-wrap: anywhere;
}
.tl-fields dd {
  margin: 0;
  font-family: var(--mono);
  color: var(--ink);
  overflow-wrap: anywhere;
}

.tl-logs {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.7;
  color: var(--code-fg);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.tl-log[data-err='yes'] {
  color: var(--tone-warn-on-ink);
}
.tl-log[data-on='yes'] {
  background: var(--ink-chip);
}
</style>
