<script setup lang="ts">
/**
 * «Куда уйдёт запрос»: правила Ingress или HTTPRoute из сценария плюс адрес от читателя —
 * и выбранный бэкенд с объяснением.
 *
 * Ответ считает не этот компонент, а строка `ROUTER_CODE` из темы, собранная `new Function`
 * (`model/run.ts`). Та же строка напечатана в теме и прогоняется тестом по таблицам из
 * спецификаций, поэтому демо не может «знать» больше, чем показанный код.
 *
 * Сборка функции — дешёвая (одна строка в полторы сотни строк), поэтому живёт в `setup`:
 * ни сцены, ни замера здесь нет, двойная цена сервера и гидратации ничтожна.
 */
import { computed, ref, watch } from 'vue';
import CodeListing from '@/shared/ui/CodeListing.vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { flatPathIndex, loadRouter, ruleLines } from '../model/run';
import type { Request, RouteScenario, WeightedBackend } from '../model/types';

const props = defineProps<{
  code: string;
  scenarios: RouteScenario[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const router = loadRouter(props.code);

const picked = ref(props.scenarios[0].id);
const options = props.scenarios.map((s) => ({ value: s.id, label: s.label }));
const scenario = computed(() => props.scenarios.find((s) => s.id === picked.value) ?? props.scenarios[0]);

const url = ref(props.scenarios[0].probes[0].url);
const headers = ref(props.scenarios[0].probes[0].headers ?? '');

watch(picked, () => {
  const first = scenario.value.probes[0];
  url.value = first.url;
  headers.value = first.headers ?? '';
});

function useProbe(i: number) {
  const probe = scenario.value.probes[i];
  url.value = probe.url;
  headers.value = probe.headers ?? '';
}

const SIZES = [
  { value: '10', label: '10' },
  { value: '100', label: '100' },
  { value: '1000', label: '1000' },
];
const size = ref('100');

const BAD_URL = 'Адрес не разобран: нужен полный адрес вида `https://shop.example.com/путь`.';

const request = computed<Request | null>(() => {
  try {
    return router.parseRequest(url.value.trim(), headers.value);
  } catch {
    return null;
  }
});

interface Row {
  label: string;
  ok: boolean | null;
  note: string;
}

interface View {
  tone: 'ok' | 'warn' | 'err';
  title: string;
  sub: string;
  why: string[];
  rows: Row[];
  active: number;
  weighted: WeightedBackend[];
}

const view = computed<View | null>(() => {
  const req = request.value;
  if (!req) return null;
  const s = scenario.value;

  if (s.kind === 'ingress') {
    const r = router.routeIngress(s.spec, req);
    const rules = s.spec.rules ?? [];
    const rows: Row[] = r.checked.map((x) => ({
      label: `${rules[x.rule].host ?? 'любой хост'}  ${x.value}  ${x.type}`,
      ok: x.ok,
      note: x.ok === null ? 'решает контроллер' : `→ ${x.backend}`,
    }));
    const lines = ruleLines(s.yaml, 'ingress');
    const active = r.via ? (lines[flatPathIndex(s.spec, r.via.rule, r.via.path)] ?? -1) : -1;
    const title = r.backend ?? '404 от контроллера';
    const sub =
      r.kind === 'backend'
        ? `путь \`${r.via?.value}\` · ${r.via?.type}`
        : r.kind === 'default'
          ? '`defaultBackend`'
          : 'ни одно правило не подошло';
    return { tone: r.kind === 'backend' ? 'ok' : r.kind === 'default' ? 'warn' : 'err', title, sub, why: r.why, rows, active, weighted: [] };
  }

  const r = router.routeHTTP(s.spec, req);
  const rows: Row[] = r.checked.map((x) => {
    const extra = [x.headers ? `заголовков ${x.headers}` : '', x.query ? `параметров ${x.query}` : ''].filter(Boolean).join(', ');
    return {
      label: `правило ${x.rule + 1}  ${x.path.type} ${x.path.value}${extra ? `  + ${extra}` : ''}`,
      ok: x.miss.length === 0,
      note: x.miss[0] ?? 'совпало',
    };
  });
  const lines = ruleLines(s.yaml, 'httproute');
  const active = r.via ? (lines[r.via.rule] ?? -1) : -1;

  if (r.kind === 'redirect') {
    return { tone: 'warn', title: `${r.status} → ${r.location}`, sub: 'редирект, бэкенд не вызывается', why: r.why, rows, active, weighted: [] };
  }
  if (r.kind === 'none') {
    return { tone: 'err', title: '404', sub: 'ни одно правило маршрута не подошло', why: r.why, rows, active, weighted: [] };
  }
  const backends = r.backends ?? [];
  const rewritten = r.upstream && r.upstream.path !== req.path ? ` · бэкенд видит \`${r.upstream.path}\`` : '';
  return {
    tone: 'ok',
    title: backends.map((b) => b.name).join(' / '),
    sub: `правило ${(r.via?.rule ?? 0) + 1}${rewritten}`,
    why: r.why,
    rows,
    active,
    weighted: backends.length > 1 ? backends : [],
  };
});

const spread = computed(() => {
  const w = view.value?.weighted ?? [];
  if (w.length < 2) return null;
  const n = Number(size.value);
  const res = router.spread(w, n);
  const index = new Map(res.counts.map((c, i) => [c.name, i + 1]));
  return { n, counts: res.counts, head: res.order.slice(0, 20).map((name) => ({ name, k: index.get(name) ?? 0 })) };
});

const lines = computed(() => scenario.value.yaml.split('\n'));
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="picked" class="l-pills" label="Сценарий" :options="options" />
    </template>

    <div class="ing-body">
      <Md class="ing-note" :text="scenario.note" />

      <div class="ing-split">
        <div class="ing-code">
          <CodeListing :lines="lines" :active="view?.active ?? -1" :label="scenario.kind === 'ingress' ? 'Ingress' : 'HTTPRoute'" />
        </div>

        <div class="ing-side">
          <label class="ing-field">
            <span class="ing-field__label">адрес запроса</span>
            <input v-model="url" class="ing-input" type="text" spellcheck="false" autocomplete="off" />
          </label>
          <label v-if="scenario.kind === 'httproute'" class="ing-field">
            <span class="ing-field__label">заголовки: <code>имя: значение; …</code></span>
            <input v-model="headers" class="ing-input" type="text" spellcheck="false" autocomplete="off" placeholder="x-canary: always" />
          </label>

          <div class="ing-probes">
            <button
              v-for="(p, i) in scenario.probes"
              :key="`${scenario.id}-${i}`"
              type="button"
              class="ing-probe"
              @click="useProbe(i)"
            >
              {{ p.url.replace(/^https?:\/\//, '') }}<template v-if="p.headers"> · {{ p.headers }}</template>
            </button>
          </div>

          <div v-if="!view" class="ing-verdict" data-tone="err">
            <Md :text="BAD_URL" />
          </div>
          <template v-else>
            <div class="ing-verdict" :data-tone="view.tone">
              <span class="ing-verdict__title">{{ view.title }}</span>
              <Md class="ing-verdict__sub" :text="view.sub" />
            </div>

            <ol class="ing-why">
              <li v-for="(line, i) in view.why" :key="i"><Md as="span" :text="line" /></li>
            </ol>
          </template>
        </div>
      </div>

      <div v-if="view && view.rows.length" class="ing-rows">
        <div v-for="(row, i) in view.rows" :key="i" class="ing-row" :data-ok="row.ok === null ? 'na' : row.ok ? 'yes' : 'no'">
          <span class="ing-row__mark">{{ row.ok === null ? '?' : row.ok ? '✓' : '✗' }}</span>
          <code class="ing-row__label">{{ row.label }}</code>
          <Md as="span" class="ing-row__note" :text="row.note" />
        </div>
      </div>

      <div v-if="spread" class="ing-spread">
        <div class="ing-spread__head">
          <span class="ing-field__label">раздать запросов</span>
          <SegmentedControl v-model="size" class="l-pills" label="Сколько запросов раздать" :options="SIZES" />
        </div>
        <div v-for="(c, k) in spread.counts" :key="c.name" class="ing-bar">
          <code class="ing-bar__name">{{ k + 1 }} · {{ c.name }} · вес {{ c.weight }}</code>
          <div class="ing-bar__track">
            <span class="ing-bar__fill" :style="`width:${(100 * c.count) / spread.n}%`" />
          </div>
          <span class="ing-bar__count">{{ c.count }} из {{ spread.n }}</span>
        </div>
        <span class="ing-field__label">первые {{ spread.head.length }} запросов по порядку — номер бэкенда</span>
        <div class="ing-seq">
          <span
            v-for="(item, i) in spread.head"
            :key="i"
            class="ing-seq__dot"
            :data-first="item.k === 1 ? 'yes' : 'no'"
            :title="item.name"
          >{{ item.k }}</span>
        </div>
      </div>
    </div>

    <template #footer>
      <Md class="ing-caption" :text="caption" />
    </template>
  </DemoFrame>
</template>

<style scoped>
.ing-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.ing-note {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.ing-note :deep(code),
.ing-verdict :deep(code),
.ing-why :deep(code),
.ing-row__note :deep(code),
.ing-caption :deep(code) {
  font-family: var(--mono);
  /* Не ниже ступени `--fs-2`: в подписи на `--fs-2` доля .92em давала 10.9px. */
  font-size: max(0.92em, var(--fs-2));
}

.ing-split {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
  gap: 18px;
  align-items: start;
}
@media (max-width: 760px) {
  .ing-split {
    grid-template-columns: minmax(0, 1fr);
  }
}
.ing-code {
  min-width: 0;
  padding: 12px 4px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.ing-side {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.ing-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.ing-field__label {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}
.ing-field__label code {
  font-family: var(--mono);
}
.ing-input {
  /* У `input` шрифт и цвет свои, браузерные, — в курсе таких нет. */
  font: inherit;
  color: inherit;
  box-sizing: border-box;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--border-strong);
  border-radius: var(--r1);
  background: var(--surface);
  color: var(--ink);
  font-family: var(--mono);
  font-size: var(--fs-3);
}
.ing-input::placeholder {
  color: var(--text-faint);
}
.ing-input:focus {
  outline: 2px solid var(--tone-info-line);
  outline-offset: 1px;
}

.ing-probes {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.ing-probe {
  font: inherit;
  color: inherit;
  padding: 4px 9px;
  border: 1px solid var(--border);
  border-radius: var(--r-full);
  background: var(--surface);
  color: var(--chip-text);
  font-family: var(--mono);
  font-size: var(--fs-3);
  cursor: pointer;
  overflow-wrap: anywhere;
  text-align: start;
}
.ing-probe:hover {
  border-color: var(--ink);
  color: var(--ink);
}

.ing-verdict {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  border-radius: var(--r2);
  font-size: var(--fs-3);
  line-height: 1.5;
}
.ing-verdict__title {
  font-family: var(--mono);
  font-size: var(--fs-5);
  font-weight: 600;
  overflow-wrap: anywhere;
}
.ing-verdict__sub {
  font-size: var(--fs-2);
}
.ing-verdict[data-tone='ok'] {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.ing-verdict[data-tone='warn'] {
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.ing-verdict[data-tone='err'] {
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}

.ing-why {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin: 0;
  padding-left: 20px;
  font-size: var(--fs-2);
  line-height: 1.55;
  color: var(--prose);
}

.ing-rows {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: var(--r3);
  background: var(--surface);
  overflow: hidden;
}
.ing-row {
  display: grid;
  grid-template-columns: 22px minmax(0, 1.2fr) minmax(0, 1fr);
  gap: 10px;
  align-items: baseline;
  padding: 8px 12px;
  font-size: var(--fs-2);
}
.ing-row + .ing-row {
  border-top: 1px solid var(--rule);
}
@media (max-width: 560px) {
  .ing-row {
    grid-template-columns: 22px minmax(0, 1fr);
  }
  .ing-row__note {
    grid-column: 2;
  }
}
.ing-row__mark {
  font-family: var(--mono);
  font-weight: 600;
}
.ing-row[data-ok='yes'] .ing-row__mark {
  color: var(--tone-ok-text);
}
.ing-row[data-ok='no'] .ing-row__mark {
  color: var(--tone-err-text);
}
.ing-row[data-ok='na'] .ing-row__mark {
  color: var(--tone-warn-text);
}
.ing-row__label {
  font-family: var(--mono);
  /* Хост и путь правила — то, по чему читатель сверяет маршрут; от базовых .86em было 10.2px. */
  font-size: var(--fs-3);
  color: var(--ink);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.ing-row__note {
  color: var(--text-muted);
}

.ing-spread {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.ing-spread__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.ing-bar {
  display: grid;
  grid-template-columns: minmax(120px, 0.9fr) minmax(0, 2fr) minmax(90px, 0.6fr);
  gap: 10px;
  align-items: center;
  font-size: var(--fs-2);
}
.ing-bar__name {
  font-family: var(--mono);
  color: var(--ink);
  overflow-wrap: anywhere;
}
.ing-bar__track {
  height: 10px;
  border-radius: var(--r-full);
  background: var(--surface-3);
  overflow: hidden;
}
.ing-bar__fill {
  display: block;
  height: 100%;
  border-radius: var(--r-full);
  background: var(--bar-violet);
  transition: width 0.3s;
}
.ing-bar__count {
  font-family: var(--mono);
  color: var(--text-muted);
}
.ing-seq {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.ing-seq__dot {
  min-width: 24px;
  padding: 2px 0;
  border-radius: var(--r1);
  font-family: var(--mono);
  font-size: var(--fs-3);
  text-align: center;
}
.ing-seq__dot[data-first='yes'] {
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
}
.ing-seq__dot[data-first='no'] {
  background: var(--tone-warn-chip);
  color: var(--tone-warn-text);
}

.ing-caption {
  font-size: var(--fs-2);
  line-height: 1.55;
  color: var(--text-muted);
}

/* Код внутри мелкой подписи: базовое `code { font-size: .86em }` уводило его ниже 11px.
   Пол — ступень `--fs-2`. */
.ing-verdict__sub :deep(code) {
  font-size: max(0.86em, var(--fs-2));
}
</style>
