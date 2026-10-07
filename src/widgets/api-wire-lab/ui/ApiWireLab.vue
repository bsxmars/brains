<script setup lang="ts">
/**
 * «Один экран — три способа»: какие запросы уходят, сколько байт в телах и что внутри.
 *
 * Числа считает не компонент, а строки кода темы, собранные `new Function` (`model/run.ts`):
 * клиент `loadScreenRest` с маршрутами `ROUTES`, исполнитель `execute`, кодировщик `encode`.
 * Те же функции прогоняет `tests/unit/api-styles.test.ts` против graphql 17 и сервера на сырых
 * сокетах. Компонент только раскладывает результат по строкам.
 */
import { computed, onMounted, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { annotateProto, loadApi, selectedFields, wireGraphql, wireGrpc, wireRest } from '../model/run';
import type { ApiCodes, ByteSpan, Tables, WireRequest } from '../model/types';

const props = defineProps<{
  codes: ApiCodes;
  tables: Tables;
  query: string;
  modes: { rest: string; graphql: string; grpc: string };
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

type Mode = 'rest' | 'graphql' | 'grpc';
const mode = ref<Mode>('rest');
const options = [
  { value: 'rest', label: 'REST' },
  { value: 'graphql', label: 'GraphQL' },
  { value: 'grpc', label: 'gRPC-web' },
];

const api = loadApi(props.codes);

interface Wire {
  requests: WireRequest[];
}
const rest = ref<Wire | null>(null);
const graphql = ref<(Wire & { body: string }) | null>(null);
const grpc = ref<(Wire & { spans: ByteSpan[]; orderBytes: number }) | null>(null);

onMounted(async () => {
  const r = await wireRest(api, props.tables);
  rest.value = { requests: r.requests };
  const g = await wireGraphql(api, props.tables, props.query);
  graphql.value = { requests: g.requests, body: g.body };
  const w = wireGrpc(api, r.screen);
  const spans = annotateProto(api, w.message, 'ListOrdersResponse');
  const first = api.decodeRaw(w.message)[0];
  grpc.value = { requests: w.requests, spans: spans.slice(first.at, first.end), orderBytes: first.end - first.at };
});

const current = computed<Wire | null>(() =>
  mode.value === 'rest' ? rest.value : mode.value === 'graphql' ? graphql.value : grpc.value,
);

const stats = computed(() => {
  const reqs = current.value?.requests ?? [];
  return [
    { k: 'запросов', v: reqs.length },
    { k: 'шагов подряд', v: reqs.length ? Math.max(...reqs.map((r) => r.step)) : 0 },
    { k: 'тело вверх, байт', v: reqs.reduce((s, r) => s + r.up, 0) },
    { k: 'тело вниз, байт', v: reqs.reduce((s, r) => s + r.down, 0) },
  ];
});

/** Записи REST, как их отдаёт сервер, с пометкой полей, выбранных запросом экрана. */
const restRecords = computed(() =>
  (
    [
      ['/api/users/u1', 'User'],
      ['/api/products/p1', 'Product'],
    ] as const
  ).map(([path, type]) => {
    const used = new Set(selectedFields(api, props.query, type));
    const row = api.route(props.tables, path) as Record<string, unknown>;
    const keys = Object.keys(row);
    return {
      path,
      used: keys.filter((k) => used.has(k)).length,
      total: keys.length,
      lines: keys.map((k, i) => ({
        k,
        text: `  "${k}": ${JSON.stringify(row[k])}${i < keys.length - 1 ? ',' : ''}`,
        used: used.has(k),
      })),
    };
  }),
);

const ROLE = { key: 'ключ поля', len: 'длина', data: 'данные' };
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="mode" class="l-pills" label="Способ" :options="options" />
    </template>

    <div class="aw-body">
      <Md class="aw-note" :text="modes[mode]" />

      <div class="aw-stats">
        <div v-for="s in stats" :key="s.k" class="aw-stat">
          <span class="aw-stat__v">{{ s.v }}</span>
          <span class="aw-stat__k">{{ s.k }}</span>
        </div>
      </div>

      <div class="aw-reqs" role="table" aria-label="Запросы экрана">
        <div v-for="(r, i) in current?.requests ?? []" :key="i" class="aw-req" role="row" :data-step="r.step">
          <span class="aw-req__step" role="cell">шаг {{ r.step }}</span>
          <code class="aw-req__line" role="cell">{{ r.method }} {{ r.path }}</code>
          <span class="aw-req__bytes" role="cell">↑ {{ r.up }} · ↓ {{ r.down }}</span>
        </div>
      </div>

      <template v-if="mode === 'rest'">
        <div class="aw-pair">
          <div v-for="rec in restRecords" :key="rec.path" class="aw-pane">
            <span class="aw-label">{{ rec.path }} — на экран {{ rec.used }} из {{ rec.total }} полей</span>
            <pre class="aw-code">{{ '{' }}
<template v-for="l in rec.lines" :key="l.k"><span :class="l.used ? 'aw-used' : 'aw-unused'">{{ l.text }}</span>
</template>{{ '}' }}</pre>
          </div>
        </div>
      </template>

      <div v-else-if="mode === 'graphql' && graphql" class="aw-pane">
        <span class="aw-label">тело POST /graphql — {{ graphql.requests[0].up }} байт</span>
        <pre class="aw-code aw-code--wrap">{{ graphql.body }}</pre>
      </div>

      <div v-else-if="mode === 'grpc' && grpc" class="aw-pane">
        <span class="aw-label">orders[0] в ответе — {{ grpc.orderBytes }} байт</span>
        <pre class="aw-code aw-code--wrap aw-hex"><template v-for="(b, i) in grpc.spans" :key="i"><span
          :class="`aw-b aw-b--${b.role}`"
          :title="`${b.field}: ${ROLE[b.role]}`"
        >{{ b.hex }}</span>{{ ' ' }}</template></pre>
        <div class="aw-legend">
          <span class="aw-legend__item aw-b--key">ключ: номер поля и тип</span>
          <span class="aw-legend__item aw-b--len">длина</span>
          <span class="aw-legend__item aw-b--data">данные</span>
        </div>
      </div>

      <Md class="aw-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.aw-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.aw-note,
.aw-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.aw-note :deep(code),
.aw-caption :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}

.aw-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 10px;
}
.aw-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.aw-stat__v {
  font-family: var(--mono);
  font-size: var(--fs-6);
  font-weight: 600;
  color: var(--ink);
}
.aw-stat__k {
  font-size: var(--fs-2);
  color: var(--text-muted);
}

.aw-reqs {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.aw-req {
  display: grid;
  grid-template-columns: 4.5em minmax(0, 1fr) auto;
  gap: 10px;
  align-items: baseline;
  padding: 6px 10px;
  border-radius: var(--r2);
  background: var(--surface-2);
  font-size: var(--fs-3);
  color: var(--prose);
}
.aw-req[data-step='2'] {
  background: var(--tone-warn-bg);
}
.aw-req__step {
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.aw-req[data-step='2'] .aw-req__step {
  color: var(--tone-warn-text);
}
.aw-req__line {
  background: none;
  padding: 0;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
  overflow-wrap: anywhere;
}
.aw-req__bytes {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
  white-space: nowrap;
}

.aw-pair {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
}
@media (max-width: 760px) {
  .aw-pair {
    grid-template-columns: minmax(0, 1fr);
  }
}
.aw-pane {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.aw-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}
.aw-code {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.7;
  /* Подложка — общая для кода курса (`pre` в base.css, чернильная): цвета — «на чернилах». */
  color: var(--code-fg);
  white-space: pre;
  overflow-x: auto;
}
.aw-code--wrap {
  white-space: pre-wrap;
  word-break: break-all;
}
.aw-hex {
  word-break: normal;
}
.aw-b {
  white-space: nowrap;
}
.aw-used {
  color: var(--tone-warn-on-ink);
  background: var(--warn-wash-on-ink);
}
.aw-unused {
  color: var(--ink-faint);
}

.aw-b--key {
  color: var(--tone-warn-on-ink);
}
.aw-b--len {
  color: var(--tone-info-on-ink);
}
.aw-b--data {
  color: var(--code-fg);
}
.aw-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.aw-legend__item {
  padding: 3px 10px;
  border-radius: var(--r-full);
  background: var(--ink);
  font-family: var(--mono);
  font-size: var(--fs-2);
}
</style>
