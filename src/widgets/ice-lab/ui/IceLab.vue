<script setup lang="ts">
/**
 * «Кандидаты и проверки»: прогон стенда WebRTC — кандидаты обеих сторон с разобранным
 * приоритетом, список проверок звонящего и то, что из него вышло, по `getStats`.
 *
 * Считает не компонент, а строки `SDP_CODE` и `STATS_CODE` из темы, собранные `new Function`
 * (`model/run.ts`). Те же строки напечатаны на странице и сверяются `tests/unit/webrtc.test.ts`
 * с разбором и приоритетами самого Chromium. Состояния пар, журнал и выбранная пара — журнал
 * стенда как есть.
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { callerStats, checkRows, loadIce, localCandidates, remoteCandidates, shortAddress } from '../model/run';
import type { Candidate, IceScenario } from '../model/types';

const props = defineProps<{
  sdpCode: string;
  statsCode: string;
  scenarios: IceScenario[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const api = loadIce(props.sdpCode, props.statsCode);

const picked = ref(props.scenarios[0].id);
const options = props.scenarios.map((s) => ({ value: s.id, label: s.label }));
const scenario = computed(() => props.scenarios.find((s) => s.id === picked.value) ?? props.scenarios[0]);

function describe(c: Candidate) {
  const p = api.splitPriority(c.priority);
  return {
    key: `${c.type}-${c.address}-${c.port}`,
    type: c.type,
    where: `${shortAddress(c.address)}:${c.port}`,
    priority: c.priority,
    parts: `${p.typePref}·2²⁴ + ${p.localPref}·2⁸ + ${256 - p.component}`,
  };
}

const sides = computed(() => [
  { k: 'звонящий — свои', items: localCandidates(api, scenario.value.run).map(describe) },
  { k: 'отвечающий — как доставил сервер', items: remoteCandidates(api, scenario.value.run).map(describe) },
]);

const STATE_TEXT: Record<string, string> = {
  succeeded: 'сработала',
  'in-progress': 'проверка без ответа',
  waiting: 'ждёт очереди',
  failed: 'отказ',
  frozen: 'заморожена',
};
const rows = computed(() =>
  checkRows(api, scenario.value.run).map((r, i) => ({
    ...r,
    key: `${r.localLabel}-${r.remoteLabel}-${i}`,
    priorityText: r.priority.toString(),
    stateText: r.state ? (STATE_TEXT[r.state] ?? r.state) : 'нет в getStats',
    tone: r.selected ? 'ok' : r.state === 'succeeded' ? 'ok' : r.state ? 'warn' : 'dim',
  })),
);

/** Журнал звонящего без строк кандидатов: они показаны выше. */
const timeline = computed(() =>
  scenario.value.run.caller.log
    .filter((e) => e.k !== 'icecandidate')
    .map((e, i) => ({ key: `${e.k}-${i}`, ms: e.ms, k: e.k, v: e.v ?? '' })),
);

const summary = computed(() => api.summarize(callerStats(scenario.value.run)));
const states = computed(() => scenario.value.run.caller.states);
const verdict = computed(() => {
  const s = summary.value;
  const conn = states.value.conn;
  if (conn === 'connected') {
    return { tone: 'ok', text: `**Соединились:** \`${s.path}\`${s.viaTurn ? ', через TURN' : ', напрямую'}. ICE \`${s.ice}\`, DTLS \`${s.dtls}\`.` };
  }
  return { tone: 'err', text: `**Нет соединения:** \`connectionState\` — \`${conn}\`, ICE \`${s.ice}\`, DTLS \`${s.dtls}\`.` };
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="picked" class="l-pills" label="Сценарий" :options="options" />
    </template>

    <div class="il-body">
      <Md class="il-note" :text="scenario.note" />

      <div class="il-split">
        <div v-for="side in sides" :key="side.k" class="il-pane">
          <span class="il-label">{{ side.k }}</span>
          <p v-if="!side.items.length" class="il-empty">кандидатов нет</p>
          <ul v-else class="il-cands">
            <li v-for="c in side.items" :key="c.key" class="il-cand">
              <span class="il-type" :data-type="c.type">{{ c.type }}</span>
              <code class="il-where">{{ c.where }}</code>
              <span class="il-prio">
                <code>{{ c.priority }}</code>
                <span class="il-parts">= {{ c.parts }}</span>
              </span>
            </li>
          </ul>
        </div>
      </div>

      <div class="il-checks" role="table" aria-label="Список проверок звонящего">
        <div class="il-checks__head" role="row">
          <span role="columnheader">пара: мой → чужой</span>
          <span role="columnheader">приоритет пары</span>
          <span role="columnheader">в getStats</span>
        </div>
        <p v-if="!rows.length" class="il-empty">пар нет — проверять нечего</p>
        <div v-for="r in rows" :key="r.key" class="il-checks__row" role="row" :data-tone="r.tone">
          <span role="cell" class="il-pair">
            <code>{{ r.localLabel }}</code> → <code>{{ r.remoteLabel }}</code>
            <span v-if="r.learned" class="il-tag">узнан из проверки</span>
          </span>
          <code role="cell" class="il-num">{{ r.priorityText }}</code>
          <span role="cell">
            {{ r.stateText }}<template v-if="r.selected"> · выбрана</template>
          </span>
        </div>
      </div>

      <div class="il-pane">
        <span class="il-label">журнал звонящего, мс от загрузки страницы</span>
        <ol class="il-log">
          <li v-for="e in timeline" :key="e.key">
            <span class="il-ms">{{ e.ms }}</span>
            <code>{{ e.k }}</code>
            <span class="il-v">{{ e.v }}</span>
          </li>
        </ol>
      </div>

      <div class="il-verdict" :data-tone="verdict.tone" role="status" aria-live="polite">
        <Md :text="verdict.text" />
      </div>

      <Md class="il-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.il-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.il-note,
.il-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.il-note :deep(code),
.il-caption :deep(code),
.il-verdict :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}

.il-split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 760px) {
  .il-split {
    grid-template-columns: minmax(0, 1fr);
  }
}

.il-pane {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.il-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.il-empty {
  margin: 0;
  font-size: var(--fs-3);
  color: var(--text-muted);
}

.il-cands {
  /* Значения уже моноширинные на своей подложке: подложка строчного кода тут лишняя. */
  --inline-code-bg: transparent;
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.il-cand {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 4px 10px;
  align-items: baseline;
  padding: 8px 10px;
  border-radius: var(--r1);
  background: var(--surface);
  font-size: var(--fs-3);
  color: var(--prose);
}
.il-cand code {
  font-family: var(--mono);
  font-size: var(--fs-3);
  overflow-wrap: anywhere;
}
.il-type {
  font-family: var(--mono);
  font-size: var(--fs-2);
  font-weight: 600;
  padding: 1px 8px;
  border-radius: var(--r1);
  background: var(--surface-3);
  color: var(--text-muted);
}
.il-type[data-type='host'] {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.il-type[data-type='srflx'],
.il-type[data-type='prflx'] {
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
}
.il-type[data-type='relay'] {
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.il-prio {
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  align-items: baseline;
}
.il-parts {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}

.il-checks {
  --inline-code-bg: transparent;
  display: flex;
  flex-direction: column;
  min-width: 0;
  font-size: var(--fs-3);
  color: var(--prose);
}
.il-checks__head,
.il-checks__row {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr) minmax(0, 0.9fr);
  gap: 10px;
  padding: 6px 10px;
  align-items: baseline;
}
@media (max-width: 560px) {
  .il-checks__head,
  .il-checks__row {
    grid-template-columns: minmax(0, 1fr);
    gap: 2px;
  }
  .il-checks__head span + span {
    display: none;
  }
}
.il-checks__head {
  font-family: var(--mono);
  font-size: var(--fs-2);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}
.il-checks__row {
  border-radius: var(--r1);
}
.il-checks__row + .il-checks__row {
  margin-top: 4px;
}
.il-checks__row[data-tone='ok'] {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.il-checks__row[data-tone='warn'] {
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.il-checks__row[data-tone='dim'] {
  background: var(--surface-2);
}
.il-checks code {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: inherit;
  overflow-wrap: anywhere;
}
.il-pair {
  min-width: 0;
}
.il-num {
  font-variant-numeric: tabular-nums;
}
.il-tag {
  margin-left: 6px;
  font-size: var(--fs-2);
  padding: 1px 6px;
  border-radius: var(--r1);
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
}

.il-log {
  --inline-code-bg: transparent;
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: var(--fs-3);
  color: var(--prose);
}
.il-log li {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 10px;
  align-items: baseline;
}
.il-log code {
  font-family: var(--mono);
  font-size: var(--fs-3);
  overflow-wrap: anywhere;
}
.il-ms {
  flex: 0 0 4.5em;
  font-family: var(--mono);
  font-size: var(--fs-2);
  text-align: right;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
.il-v {
  font-weight: 600;
  overflow-wrap: break-word;
}

.il-verdict {
  padding: 10px 14px;
  border-radius: var(--r2);
  font-size: var(--fs-3);
  line-height: 1.55;
}
.il-verdict[data-tone='ok'] {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.il-verdict[data-tone='err'] {
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}
</style>
