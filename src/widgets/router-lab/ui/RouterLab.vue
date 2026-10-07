<script setup lang="ts">
/**
 * Учебный роутер в работе — четыре вида одного стенда, по разделу темы на вид:
 * `pattern` — шаблон пути → токены, регулярка, вес; `match` — сквозная таблица маршрутов,
 * отсортированная по весу, и победитель для адреса; `guards` — журнал навигации по сценарию;
 * `data` — шкала загрузки чанков и данных при четырёх способах грузить данные.
 *
 * Считает не компонент, а строки учебного роутера из темы, собранные `new Function`
 * в `model/run.ts`. `tests/unit/router.test.ts` прогоняет те же функции рядом с vue-router 5.3.1
 * и требует совпадения регулярок, весов, порядка, журналов и шкал.
 */
import { computed, ref, shallowRef, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button, SegmentedControl } from '@/shared/ui';
import { describePattern, loadRouter, matchPath, plainRoutes, runGuards, runWaterfall, scoreText } from '../model/run';
import type { GuardRun, GuardScenario, RouterCodes, ShopLevel, Strategy, WaterfallRun } from '../model/types';

const props = defineProps<{
  view: 'pattern' | 'match' | 'guards' | 'data';
  codes: RouterCodes;
  presets?: string[];
  scenarios?: GuardScenario[];
  strategies?: { id: Strategy; label: string; note: string }[];
  levels?: ShopLevel[];
  target?: string;
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const api = loadRouter(props.codes);

// ─── pattern / match ───────────────────────────────────────────────────────────────────────
const input = ref(props.presets?.[0] ?? '/');
const pattern = computed(() => (props.view === 'pattern' ? describePattern(api, input.value) : null));
const routes = props.view === 'match' ? plainRoutes(props.codes) : [];
const match = computed(() => (props.view === 'match' ? matchPath(api, routes, input.value || '/') : null));

const tokenLabel = (tok: { type: string; value: string; regexp?: string; optional?: boolean; repeatable?: boolean }) => {
  if (tok.type === 'text') return tok.value || '(пусто)';
  const mod = tok.optional && tok.repeatable ? '*' : tok.optional ? '?' : tok.repeatable ? '+' : '';
  return `:${tok.value}${tok.regexp ? `(${tok.regexp})` : ''}${mod}`;
};

// ─── guards ────────────────────────────────────────────────────────────────────────────────
const scenarioId = ref(props.scenarios?.[0]?.id ?? '');
const scenarioOptions = (props.scenarios ?? []).map((s) => ({ value: s.id, label: s.label }));
const scenario = computed(() => props.scenarios?.find((s) => s.id === scenarioId.value));
const guardRun = shallowRef<GuardRun | null>(null);
let guardGen = 0;

const STAGES: [string, string][] = [
  ['beforeRouteLeave', '1'],
  ['beforeEach', '2'],
  ['beforeRouteUpdate', '3'],
  ['beforeEnter', '4'],
  ['import()', '5'],
  ['beforeRouteEnter', '5'],
  ['beforeResolve', '6'],
  ['afterEach', '8'],
];
const stageOf = (line: string) => STAGES.find(([p]) => line.startsWith(p))?.[1] ?? '';
const FAILURES: Record<number, string> = { 4: 'отменён guard-ом (4)', 8: 'отменён новым переходом (8)', 16: 'уже здесь (16)' };

// ─── data ──────────────────────────────────────────────────────────────────────────────────
const strategyId = ref<Strategy>(props.strategies?.[0]?.id ?? 'inComponent');
const strategyOptions = (props.strategies ?? []).map((s) => ({ value: s.id, label: s.label }));
const strategy = computed(() => props.strategies?.find((s) => s.id === strategyId.value));
const waterfall = shallowRef<WaterfallRun | null>(null);
let dataGen = 0;

const total = computed(() => {
  const w = waterfall.value;
  if (!w) return 1;
  const end = Math.max(w.ready, w.commit, ...w.spans.map((s) => s.to));
  return Math.ceil((end + 50) / 100) * 100;
});
const pct = (ms: number) => `${(ms / total.value) * 100}%`;
const ticks = computed(() => Array.from({ length: total.value / 100 + 1 }, (_, i) => i * 100));

async function refresh() {
  if (props.view === 'guards' && scenario.value) {
    const mine = ++guardGen;
    const run = await runGuards(api, props.codes, scenario.value);
    if (mine === guardGen) guardRun.value = run;
  }
  if (props.view === 'data' && props.levels && props.target) {
    const mine = ++dataGen;
    const run = await runWaterfall(api, props.codes, props.levels, strategyId.value, props.target);
    if (mine === dataGen) waterfall.value = run;
  }
}
watch([scenarioId, strategyId], refresh);
void refresh();
</script>

<template>
  <DemoFrame>
    <template v-if="view === 'pattern' || view === 'match'" #toolbar>
      <div class="rl-controls">
        <label class="rl-field">
          <span class="t-label">{{ view === 'pattern' ? 'шаблон пути' : 'адрес' }}</span>
          <input v-model.trim="input" class="rl-input" spellcheck="false" autocomplete="off" />
        </label>
        <div class="rl-presets" role="group" :aria-label="view === 'pattern' ? 'Примеры шаблонов' : 'Примеры адресов'">
          <Button v-for="p in presets ?? []" :key="p" variant="secondary" @click="input = p">{{ p }}</Button>
        </div>
      </div>
    </template>
    <template v-else-if="view === 'guards'" #toolbar>
      <div class="rl-control">
        <span class="t-label">сценарий</span>
        <SegmentedControl v-model="scenarioId" class="l-pills" label="Сценарий" :options="scenarioOptions" />
      </div>
    </template>
    <template v-else #toolbar>
      <div class="rl-control">
        <span class="t-label">где грузятся данные</span>
        <SegmentedControl v-model="strategyId" class="l-pills" label="Стратегия" :options="strategyOptions" />
      </div>
    </template>

    <div class="rl-body">
      <!-- Шаблон пути -->
      <template v-if="view === 'pattern' && pattern">
        <p v-if="'error' in pattern" class="rl-error">{{ pattern.error }}</p>
        <template v-else>
          <div class="rl-segments" aria-label="Сегменты и токены">
            <div v-for="(seg, i) in pattern.segments" :key="i" class="rl-segment">
              <span class="rl-segment__slash">/</span>
              <span v-if="!seg.length" class="rl-token" data-kind="empty">
                <code>(пусто)</code>
                <b>{{ pattern.compiled.score[i][0] }}</b>
              </span>
              <span v-for="(tok, j) in seg" :key="j" class="rl-token" :data-kind="tok.type">
                <code>{{ tokenLabel(tok) }}</code>
                <b>{{ pattern.compiled.score[i][j] }}</b>
              </span>
            </div>
          </div>
          <dl class="rl-facts">
            <div>
              <dt>регулярка</dt>
              <dd><code class="rl-ink">/{{ pattern.compiled.re.source }}/{{ pattern.compiled.re.flags }}</code></dd>
            </div>
            <div>
              <dt>вес</dt>
              <dd><code>{{ scoreText(pattern.compiled.score) }}</code></dd>
            </div>
            <div>
              <dt>параметры</dt>
              <dd>
                <code>{{ pattern.compiled.keys.map((k) => k.name + (k.optional ? ' (необяз.)' : '') + (k.repeatable ? ' (массив)' : '')).join(', ') || '—' }}</code>
              </dd>
            </div>
          </dl>
        </template>
      </template>

      <!-- Сопоставление -->
      <template v-if="view === 'match' && match">
        <div class="rl-scroll">
          <table class="rl-table">
            <thead>
              <tr>
                <th>#</th>
                <th>шаблон</th>
                <th>имя</th>
                <th>вес</th>
                <th>подходит</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in match.rows" :key="i" :data-state="i === match.winner ? 'win' : r.fits ? 'fits' : 'no'">
                <td>{{ i + 1 }}</td>
                <td><code>{{ r.path }}</code></td>
                <td><code>{{ r.name || '(макет)' }}</code></td>
                <td><code>{{ scoreText(r.score) }}</code></td>
                <td>{{ i === match.winner ? 'победитель' : r.fits ? 'да, но ниже' : '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <dl class="rl-facts" aria-live="polite">
          <div>
            <dt>params</dt>
            <dd><code>{{ JSON.stringify(match.params) }}</code></dd>
          </div>
          <div>
            <dt>matched</dt>
            <dd><code>{{ match.matched.join(' → ') || 'ничего' }}</code></dd>
          </div>
        </dl>
      </template>

      <!-- Guards -->
      <template v-if="view === 'guards' && scenario">
        <Md class="rl-note" :text="scenario.note" />
        <div v-if="guardRun" class="rl-status" aria-live="polite">
          <span>было <b>{{ guardRun.from }}</b></span>
          <span>стало <b>{{ guardRun.to }}</b></span>
          <span v-for="(f, i) in guardRun.failures" :key="i">
            {{ scenario.go[i] }}: <b>{{ f === null ? 'переход состоялся' : FAILURES[f] ?? f }}</b>
          </span>
        </div>
        <ol v-if="guardRun" class="rl-log" aria-label="Журнал навигации">
          <li v-for="(line, i) in guardRun.log" :key="i" :data-failed="line.includes('failure=') ? 'yes' : 'no'">
            <span class="rl-log__stage">{{ stageOf(line) ? `этап ${stageOf(line)}` : '' }}</span>
            <span class="rl-log__text">{{ line }}</span>
          </li>
        </ol>
      </template>

      <!-- Данные -->
      <template v-if="view === 'data' && strategy">
        <Md class="rl-note" :text="strategy.note" />
        <div v-if="waterfall" class="rl-status" aria-live="polite">
          <span>адрес сменился: <b>{{ waterfall.commit }} мс</b></span>
          <span>экран готов: <b>{{ waterfall.ready }} мс</b></span>
        </div>
        <div v-if="waterfall" class="rl-scroll">
          <div class="rl-gantt" role="img" :aria-label="`Шкала: переход в ${waterfall.commit} мс, экран в ${waterfall.ready} мс`">
            <div v-for="(s, i) in waterfall.spans" :key="i" class="rl-gantt__row">
              <span class="rl-gantt__label">{{ s.kind === 'chunk' ? 'чанк' : 'данные' }} {{ s.label }}</span>
              <span class="rl-gantt__track">
                <span class="rl-gantt__bar" :data-kind="s.kind" :style="{ left: pct(s.from), width: pct(s.to - s.from) }">{{ s.to - s.from }}</span>
              </span>
            </div>
            <span class="rl-gantt__line" data-kind="commit" :style="{ '--at': waterfall.commit / total }" aria-hidden="true" />
            <span class="rl-gantt__line" data-kind="ready" :style="{ '--at': waterfall.ready / total }" aria-hidden="true" />
            <div class="rl-gantt__row rl-gantt__axis">
              <span class="rl-gantt__label">мс</span>
              <span class="rl-gantt__track">
                <span v-for="(tk, i) in ticks" :key="tk" class="rl-gantt__tick" :data-edge="i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'mid'" :style="{ left: pct(tk) }">{{ tk }}</span>
                <span class="rl-gantt__mark" data-kind="commit" :style="{ left: pct(waterfall.commit) }">переход</span>
                <span class="rl-gantt__mark" data-kind="ready" :style="{ left: pct(waterfall.ready) }">экран</span>
              </span>
            </div>
          </div>
        </div>
      </template>

      <Md class="rl-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.rl-controls {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.rl-control,
.rl-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  max-width: 100%;
}
.rl-input {
  font: inherit;
  color: inherit;
  font-family: var(--mono);
  font-size: var(--fs-4);
  padding: 8px 10px;
  border: 1px solid var(--tone-info-line);
  border-radius: var(--r2);
  background: var(--surface);
  min-width: 0;
  width: 100%;
  box-sizing: border-box;
}
.rl-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
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
.rl-error {
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--r3);
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
  font-size: var(--fs-3);
}

.rl-segments {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.rl-segment {
  display: flex;
  align-items: stretch;
  gap: 4px;
  min-width: 0;
}
.rl-segment__slash {
  align-self: center;
  font-family: var(--mono);
  font-size: var(--fs-4);
  color: var(--text-muted);
}
.rl-token {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 6px 10px;
  border-radius: var(--r2);
  background: var(--surface-2);
  min-width: 0;
}
.rl-token code {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
  overflow-wrap: anywhere;
}
.rl-token b {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.rl-token[data-kind='param'] {
  background: var(--tone-info-bg);
  box-shadow: inset 0 0 0 1px var(--tone-info-line);
}
.rl-token[data-kind='empty'] {
  background: var(--tone-warn-bg);
}

.rl-facts {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
}
.rl-facts > div {
  display: grid;
  grid-template-columns: 7.5em minmax(0, 1fr);
  gap: 10px;
  align-items: baseline;
}
.rl-facts dt {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.rl-facts dd {
  margin: 0;
  min-width: 0;
}
.rl-facts code {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
  overflow-wrap: anywhere;
}
.rl-facts code.rl-ink {
  display: block;
  padding: 8px 10px;
  border-radius: var(--r2);
  background: var(--ink);
  color: var(--code-fg);
}

.rl-scroll {
  overflow-x: auto;
  min-width: 0;
}
.rl-table {
  width: 100%;
  min-width: 520px;
  border-collapse: collapse;
  font-size: var(--fs-3);
}
.rl-table th {
  text-align: left;
  font-family: var(--mono);
  font-size: var(--fs-2);
  font-weight: 500;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
  padding: 6px 8px;
  border-bottom: 1px solid var(--divider);
}
.rl-table td {
  padding: 6px 8px;
  border-bottom: 1px solid var(--divider);
  color: var(--prose);
}
.rl-table code {
  font-family: var(--mono);
  color: var(--ink);
}
.rl-table tr[data-state='win'] td {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.rl-table tr[data-state='fits'] td {
  background: var(--tone-info-bg);
}
.rl-table tr[data-state='no'] td {
  color: var(--text-muted);
}

.rl-status {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 18px;
  padding: 10px 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
  font-size: var(--fs-3);
  color: var(--text-muted);
}
.rl-status b {
  font-family: var(--mono);
  color: var(--ink);
}

.rl-log {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 12px;
  list-style: none;
  border-radius: var(--r3);
  background: var(--ink);
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.6;
  color: var(--code-fg);
}
.rl-log li {
  display: grid;
  grid-template-columns: 5em minmax(0, 1fr);
  gap: 8px;
}
.rl-log__stage {
  color: var(--ink-faint);
}
.rl-log__text {
  overflow-wrap: anywhere;
}
.rl-log li[data-failed='yes'] .rl-log__text {
  color: var(--tone-warn-on-ink);
}

.rl-gantt {
  --rl-label: 9.5em;
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 560px;
}
.rl-gantt__line {
  position: absolute;
  top: 0;
  bottom: 40px;
  left: calc(var(--rl-label) + 10px + (100% - var(--rl-label) - 10px) * var(--at));
  width: 0;
  border-left: 1px dashed var(--tone-info-line);
  pointer-events: none;
}
.rl-gantt__line[data-kind='ready'] {
  border-left-color: var(--tone-ok-text);
}
.rl-gantt__row {
  display: grid;
  grid-template-columns: var(--rl-label) minmax(0, 1fr);
  gap: 10px;
  align-items: center;
}
.rl-gantt__label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.rl-gantt__track {
  position: relative;
  height: 22px;
  background: var(--surface-2);
  border-radius: var(--r1);
}
.rl-gantt__bar {
  position: absolute;
  top: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--r1);
  font-family: var(--mono);
  font-size: var(--fs-2);
  overflow: hidden;
}
.rl-gantt__bar[data-kind='chunk'] {
  background: var(--tone-info-bg);
  box-shadow: inset 0 0 0 1px var(--tone-info-line);
  color: var(--tone-info-text);
}
.rl-gantt__bar[data-kind='data'] {
  background: var(--tone-warn-bg);
  box-shadow: inset 0 0 0 1px var(--tone-warn-line);
  color: var(--tone-warn-text);
}
.rl-gantt__axis .rl-gantt__track {
  height: 64px;
  background: none;
}
.rl-gantt__tick {
  position: absolute;
  top: 0;
  transform: translateX(-50%);
}
.rl-gantt__tick[data-edge='start'] {
  transform: none;
}
.rl-gantt__tick[data-edge='end'] {
  transform: translateX(-100%);
}
.rl-gantt__tick {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.rl-gantt__mark {
  position: absolute;
  bottom: 0;
  transform: translateX(-50%);
  padding: 1px 6px;
  border-radius: var(--r1);
  font-size: var(--fs-2);
  white-space: nowrap;
}
.rl-gantt__mark[data-kind='commit'] {
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
}
.rl-gantt__mark[data-kind='ready'] {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
  bottom: 22px;
}
</style>
