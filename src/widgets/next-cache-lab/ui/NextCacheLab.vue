<script setup lang="ts">
/**
 * «Четыре слоя в работе»: сценарий стенда, проигранный учебной моделью, шаг за шагом —
 * что ответил каждый слой, что дошло до бэкенда, что увидел посетитель. Дальше сценарий
 * можно продолжить руками.
 *
 * Считает не компонент, а строки `ROUTES_CODE`, `SERVER_MODEL_CODE`, `ROUTER_MODEL_CODE`
 * из темы, собранные `new Function` в `model/run.ts`. Отметка «как на стенде» сравнивает шаг
 * модели с журналом настоящего Next (`STAND` в `data.ts` темы); `tests/unit/next-cache.test.ts`
 * требует, чтобы на всех шагах всех сценариев она была зелёной.
 */
import { computed, nextTick, ref, shallowRef, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button, SegmentedControl } from '@/shared/ui';
import { asStand, createModel, sameAsStand, stepLabel } from '../model/run';
import type { Layer, ModelCodes, NextModel, Scenario, Step, StepResult } from '../model/types';

const props = defineProps<{
  codes: ModelCodes;
  scenarios: Scenario[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

interface Row {
  n: number;
  label: string;
  result: StepResult;
  /** `true` / `false` — сравнение со стендом; `null` — шаг добавлен руками, стенда к нему нет. */
  stand: boolean | null;
  browser: boolean;
}

const scenarioId = ref(props.scenarios[0].id);
const options = props.scenarios.map((s) => ({ value: s.id, label: s.label }));
const scenario = computed(() => props.scenarios.find((s) => s.id === scenarioId.value) ?? props.scenarios[0]);

let model: NextModel;
const rows = shallowRef<Row[]>([]);
const tab = ref<string | null>(null);
const TAB_STEPS: Step['do'][] = ['open', 'click', 'back', 'reload', 'action'];

function replay() {
  const sc = scenario.value;
  model = createModel(props.codes);
  const build = model.build();
  const out: Row[] = [{ n: 0, label: 'next build', result: build, stand: sameAsStand(asStand(build, sc.mode, null), sc.stand[0]), browser: false }];
  sc.steps.forEach((step, i) => {
    const r = model.run(step);
    out.push({ n: i + 1, label: stepLabel(step), result: r, stand: sameAsStand(asStand(r, sc.mode, step), sc.stand[i + 1]), browser: sc.mode === 'browser' });
  });
  rows.value = out;
  tab.value = sc.mode === 'browser' ? (out.at(-1)?.result.url ?? null) : null;
}

watch(scenarioId, replay);
replay();

const logBox = ref<HTMLElement | null>(null);

async function act(step: Step) {
  // Вкладки ещё нет — первый переход открывает страницу целиком.
  let s = step;
  if (!tab.value && s.do === 'click') s = { do: 'open', path: s.path };
  const r = model.run(s);
  const inTab = TAB_STEPS.includes(s.do);
  if (inTab && r.url) tab.value = r.url;
  const browser = inTab || (Boolean(tab.value) && s.do !== 'get');
  rows.value = [...rows.value, { n: rows.value.length, label: stepLabel(s), result: r, stand: null, browser }];
  await nextTick();
  if (logBox.value) logBox.value.scrollTop = logBox.value.scrollHeight;
}

const LINKS = ['/static', '/isr', '/tagged', '/dynamic'];

const LAYER_TONE: Record<Layer, string> = { роутер: 'info', маршрут: 'warn', данные: 'ok', рендер: 'none' };

const shown = (s: string | null) => (s ? s.replaceAll('=', ': ') : '—');
const requestsOf = (r: StepResult) => {
  const pf = new Set(r.requests.filter((q) => q.startsWith('prefetch')).map((q) => q.slice(9)));
  const other = r.requests.filter((q) => !q.startsWith('prefetch'));
  return [...new Set(other), pf.size ? `prefetch ×${pf.size}` : ''].filter(Boolean).join(', ') || 'нет';
};
const time = (s: number) => `${s} с`;
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="scenarioId" class="l-pills" label="Сценарий" :options="options" />
    </template>

    <div class="ncl-body">
      <Md class="ncl-note" :text="scenario.note" />

      <div ref="logBox" class="ncl-log" role="log" aria-label="Журнал шагов">
        <article v-for="row in rows" :key="row.n" class="ncl-step">
          <header class="ncl-step__head">
            <span class="ncl-step__n">{{ String(row.n).padStart(2, '0') }}</span>
            <code class="ncl-step__label">{{ row.label }}</code>
            <span class="ncl-step__t">t = {{ time(row.result.now) }}</span>
            <span v-if="row.result.xcache" class="ncl-badge" :data-x="row.result.xcache">x-nextjs-cache: {{ row.result.xcache }}</span>
            <span v-if="row.stand !== null" class="ncl-badge" :data-stand="row.stand ? 'yes' : 'no'">{{ row.stand ? 'как на стенде' : 'не как на стенде' }}</span>
          </header>

          <ul v-if="row.result.trace.length" class="ncl-trace">
            <li v-for="(l, i) in row.result.trace" :key="i" class="ncl-trace__line">
              <span class="ncl-layer" :data-tone="LAYER_TONE[l.layer]">{{ l.layer }}</span>
              <span class="ncl-trace__text">{{ l.text }}<em v-if="l.later" class="ncl-later"> — фоном</em></span>
            </li>
          </ul>

          <dl class="ncl-facts">
            <div>
              <dt>до бэкенда</dt>
              <dd><code>{{ row.result.backend.length ? row.result.backend.join(' ') : '—' }}</code></dd>
            </div>
            <div v-if="row.browser">
              <dt>запросы вкладки</dt>
              <dd><code>{{ requestsOf(row.result) }}</code></dd>
            </div>
            <div v-if="row.result.shown && row.n > 0">
              <dt>на экране</dt>
              <dd><code>{{ shown(row.result.shown) }}</code></dd>
            </div>
          </dl>
        </article>
      </div>

      <div class="ncl-actions" role="group" aria-label="Продолжить сценарий">
        <div class="ncl-row">
          <span class="ncl-row__label">вкладка</span>
          <Button v-for="p in LINKS" :key="p" variant="secondary" @click="act({ do: 'click', path: p })">{{ p }}</Button>
          <Button variant="secondary" :disabled="!tab" @click="act({ do: 'back' })">назад</Button>
          <Button variant="secondary" :disabled="!tab" @click="act({ do: 'reload' })">перезагрузить</Button>
          <Button variant="secondary" :disabled="tab !== '/tagged'" @click="act({ do: 'action', tag: 'post' })">Опубликовать</Button>
        </div>
        <div class="ncl-row">
          <span class="ncl-row__label">сервер</span>
          <Button v-for="p in LINKS" :key="p" variant="secondary" @click="act({ do: 'get', path: p })">GET {{ p }}</Button>
        </div>
        <div class="ncl-row">
          <span class="ncl-row__label">сброс</span>
          <Button variant="secondary" @click="act({ do: 'revalidateTag', tag: 'post' })">post, 'max'</Button>
          <Button variant="secondary" @click="act({ do: 'revalidateTag', tag: 'post', expire0: true })">post, expire: 0</Button>
          <Button variant="secondary" @click="act({ do: 'revalidatePath', path: '/static' })">путь /static</Button>
          <Button variant="secondary" @click="act({ do: 'wait', s: 4 })">+4 с</Button>
          <Button variant="secondary" @click="replay">заново</Button>
        </div>
      </div>

      <Md class="ncl-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.ncl-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.ncl-note,
.ncl-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.ncl-note :deep(code),
.ncl-caption :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}

.ncl-log {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 560px;
  overflow-y: auto;
  padding: 2px;
  min-width: 0;
}
.ncl-step {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border-radius: var(--r3);
  background: var(--surface-2);
  min-width: 0;
}
.ncl-step__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px 10px;
}
.ncl-step__n,
.ncl-step__t {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.ncl-step__label {
  font-family: var(--mono);
  font-size: var(--fs-3);
  font-weight: 600;
  color: var(--ink);
  overflow-wrap: anywhere;
}
.ncl-badge {
  padding: 1px 8px;
  border-radius: var(--r-full);
  font-family: var(--mono);
  font-size: var(--fs-2);
  background: var(--surface-3);
  color: var(--text-muted);
}
.ncl-badge[data-x='HIT'],
.ncl-badge[data-stand='yes'] {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.ncl-badge[data-x='STALE'] {
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.ncl-badge[data-x='MISS'],
.ncl-badge[data-stand='no'] {
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}

.ncl-trace {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.ncl-trace__line {
  display: grid;
  grid-template-columns: 6.5em minmax(0, 1fr);
  gap: 8px;
  align-items: baseline;
  font-size: var(--fs-3);
  line-height: 1.5;
  color: var(--prose);
}
.ncl-layer {
  justify-self: start;
  padding: 0 6px;
  border-radius: var(--r1);
  font-family: var(--mono);
  font-size: var(--fs-2);
  background: var(--surface-3);
  color: var(--text-muted);
}
.ncl-layer[data-tone='info'] {
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
}
.ncl-layer[data-tone='warn'] {
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.ncl-layer[data-tone='ok'] {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.ncl-trace__text {
  overflow-wrap: anywhere;
}
.ncl-later {
  font-style: normal;
  color: var(--text-muted);
}

.ncl-facts {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 20px;
  margin: 0;
  font-size: var(--fs-3);
}
.ncl-facts div {
  display: flex;
  gap: 6px;
  align-items: baseline;
  min-width: 0;
}
.ncl-facts dt {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.ncl-facts dd {
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
}
.ncl-facts code {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
}

.ncl-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ncl-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.ncl-row__label {
  min-width: 5.5em;
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
</style>
