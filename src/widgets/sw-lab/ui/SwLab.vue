<script setup lang="ts">
/**
 * «Жизненный цикл по шагам»: сценарий из шагов (выложили версию, открыли, перезагрузили,
 * закрыли вкладку, `update()`, `skip-waiting`), состояние регистрации и вкладок после шага
 * и два журнала шага — модели и Chromium.
 *
 * Журнал и состояние считает не компонент, а строка `LIFECYCLE_CODE` из темы, собранная
 * `new Function` (`model/run.ts`). Журнал Chromium — литерал стенда; тест
 * `tests/unit/service-worker.test.ts` сверяет их на каждом шаге каждого сценария.
 * В режиме «свой порядок» шаги собирает читатель, и журнал считает только модель.
 */
import { computed, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import StepToolbar from '@/shared/ui/StepToolbar.vue';
import { Button, SegmentedControl } from '@/shared/ui';
import { loadLifecycle, sameSnapshot } from '../model/run';
import type { SwScenario, SwScript, SwSnapshot, SwStep } from '../model/types';

const props = defineProps<{
  lifecycleCode: string;
  scenarios: SwScenario[];
  /** Версия Chromium стенда — для подписи журнала. */
  chromium: string;
  /** Подпись под демо. Строчная разметка. */
  caption: string;
  /** Подпись над режимом «свой порядок». Строчная разметка. */
  ownNote: string;
}>();

const run = loadLifecycle(props.lifecycleCode);

const OWN = 'own';
const picked = ref(props.scenarios[0].id);
const options = [...props.scenarios.map((s) => ({ value: s.id, label: s.label })), { value: OWN, label: 'свой порядок' }];
const scenario = computed(() => props.scenarios.find((s) => s.id === picked.value));
const own = computed(() => picked.value === OWN);

const ownSteps = ref<SwStep[]>([]);
const steps = computed<SwStep[]>(() => (own.value ? ownSteps.value : (scenario.value?.steps ?? [])));
const snaps = computed<SwSnapshot[]>(() => run(steps.value));

const at = ref(0);
watch(picked, () => {
  at.value = 0;
});
const total = computed(() => steps.value.length);
const snap = computed(() => snaps.value[at.value]);
const chromiumSnap = computed(() => (own.value ? undefined : scenario.value?.chromium[at.value]));
const same = computed(() => sameSnapshot(snap.value, chromiumSnap.value));

/** Какой sw.js лежит на сервере к этому шагу. */
const server = computed<SwScript | null>(() => {
  let s: SwScript | null = null;
  for (const st of steps.value.slice(0, at.value + 1)) if (st.do === 'deploy') s = st.script;
  return s;
});

function flags(s: SwScript): string {
  const f: string[] = [];
  if (s.skipWaiting) f.push('skipWaiting');
  if (s.claim) f.push('claim');
  if (s.missing) f.push('404 в PRECACHE');
  return f.length ? ` + ${f.join(' + ')}` : '';
}

function stepText(s: SwStep): string {
  switch (s.do) {
    case 'deploy':
      return `на сервере sw.js ${s.script.v}${flags(s.script)}`;
    case 'open':
      return `открыть вкладку ${s.tab}`;
    case 'reload':
      return `перезагрузить ${s.tab}`;
    case 'close':
      return `закрыть ${s.tab}`;
    case 'update':
      return 'reg.update()';
    case 'skip':
      return 'страница → ждущему: skip-waiting';
  }
}

function journal(s: SwSnapshot | undefined): string[] {
  if (!s) return [];
  const lines = [...s.workers, ...s.controllerchange.map((t) => `${t}: controllerchange`)];
  return lines.length ? lines : ['— событий нет'];
}

const tabs = computed(() => Object.entries(snap.value?.tabs ?? {}));

// ─── Свой порядок ───────────────────────────────────────────────────────────────────────

const nextV = ref(1);
const optSkip = ref(false);
const optClaim = ref(false);
const optMissing = ref(false);
const last = computed(() => snaps.value.at(-1));
const hasReg = computed(() => Boolean(last.value && (last.value.active || last.value.waiting)));
const openTabs = computed(() => Object.keys(last.value?.tabs ?? {}));
const deployed = computed(() => ownSteps.value.some((s) => s.do === 'deploy'));
let tabNo = 0;

function push(step: SwStep) {
  ownSteps.value = [...ownSteps.value, step];
  at.value = ownSteps.value.length - 1;
}
function deploy() {
  const script: SwScript = { v: `v${nextV.value}` };
  if (optSkip.value) script.skipWaiting = true;
  if (optClaim.value) script.claim = true;
  if (optMissing.value) script.missing = true;
  nextV.value += 1;
  push({ do: 'deploy', script });
}
function openTab() {
  const name = String.fromCharCode(65 + (tabNo % 26));
  tabNo += 1;
  push({ do: 'open', tab: name });
}
function resetOwn() {
  ownSteps.value = [];
  nextV.value = 1;
  tabNo = 0;
  at.value = 0;
}
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="picked" class="l-pills" label="Сценарий" :options="options" />
    </template>

    <div class="swl-body">
      <Md class="swl-note" :text="own ? ownNote : (scenario?.note ?? '')" />

      <div v-if="own" class="swl-actions">
        <div class="swl-row">
          <Button variant="primary" @click="deploy">выложить sw.js v{{ nextV }}</Button>
          <label class="swl-check"><input v-model="optSkip" type="checkbox" /> <code>skipWaiting</code></label>
          <label class="swl-check"><input v-model="optClaim" type="checkbox" /> <code>claim</code></label>
          <label class="swl-check"><input v-model="optMissing" type="checkbox" /> 404 в PRECACHE</label>
        </div>
        <div class="swl-row">
          <Button variant="secondary" :disabled="!deployed" @click="openTab">открыть вкладку</Button>
          <Button variant="secondary" :disabled="!hasReg || !openTabs.length" @click="push({ do: 'update' })">reg.update()</Button>
          <Button variant="secondary" :disabled="!last?.waiting || !openTabs.length" @click="push({ do: 'skip' })">skip-waiting</Button>
          <Button variant="secondary" :disabled="!ownSteps.length" @click="resetOwn">сброс</Button>
        </div>
        <div v-if="openTabs.length" class="swl-row">
          <template v-for="t in openTabs" :key="t">
            <Button variant="secondary" @click="push({ do: 'reload', tab: t })">F5 {{ t }}</Button>
            <Button variant="secondary" @click="push({ do: 'close', tab: t })">закрыть {{ t }}</Button>
          </template>
        </div>
      </div>

      <div class="swl-split">
        <div class="swl-pane">
          <span class="swl-label">шаги</span>
          <ol v-if="steps.length" class="swl-steps">
            <li v-for="(s, i) in steps" :key="i">
              <button type="button" class="swl-step" :data-on="i === at ? 'yes' : 'no'" :data-past="i < at ? 'yes' : 'no'" @click="at = i">
                {{ stepText(s) }}
              </button>
            </li>
          </ol>
          <span v-else class="swl-empty">шагов пока нет</span>
        </div>

        <div class="swl-pane" aria-live="polite">
          <span class="swl-label">на сервере</span>
          <code class="swl-server">{{ server ? `sw.js ${server.v}${flags(server)}` : '—' }}</code>

          <span class="swl-label">регистрация</span>
          <div class="swl-slots">
            <div class="swl-slot" :data-filled="snap?.waiting ? 'yes' : 'no'" data-kind="waiting">
              <span class="swl-slot__k">waiting</span>
              <code>{{ snap?.waiting ?? '—' }}</code>
            </div>
            <div class="swl-slot" :data-filled="snap?.active ? 'yes' : 'no'" data-kind="active">
              <span class="swl-slot__k">active</span>
              <code>{{ snap?.active ?? '—' }}</code>
            </div>
          </div>

          <span class="swl-label">вкладки и контроллер</span>
          <div class="swl-tabs">
            <span v-if="!tabs.length" class="swl-empty">открытых вкладок нет</span>
            <div
              v-for="[name, ctrl] in tabs"
              :key="name"
              class="swl-tab"
              :data-ctrl="ctrl ? 'yes' : 'no'"
              :data-changed="snap?.controllerchange.includes(name) ? 'yes' : 'no'"
            >
              <span class="swl-tab__name">{{ name }}</span>
              <code>{{ ctrl ?? 'null' }}</code>
            </div>
          </div>
        </div>
      </div>

      <StepToolbar
        v-if="!own"
        :counter="`шаг ${at + 1} / ${total}`"
        :at-start="at === 0"
        :at-end="at >= total - 1"
        @prev="at = Math.max(0, at - 1)"
        @next="at = Math.min(total - 1, at + 1)"
        @reset="at = 0"
      />

      <div class="swl-logs">
        <div class="swl-log">
          <span class="swl-label">модель: события шага</span>
          <ol class="swl-lines">
            <li v-for="(line, i) in journal(snap)" :key="i">{{ line }}</li>
          </ol>
        </div>
        <div v-if="!own" class="swl-log" :data-same="same ? 'yes' : 'no'">
          <span class="swl-label">Chromium {{ chromium }}</span>
          <ol class="swl-lines">
            <li v-for="(line, i) in journal(chromiumSnap)" :key="i">{{ line }}</li>
          </ol>
          <span class="swl-verdict">{{ same ? 'шаг совпадает с моделью: события, места и вкладки' : 'расходится с моделью' }}</span>
        </div>
      </div>

      <Md class="swl-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.swl-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.swl-note,
.swl-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.swl-note :deep(code),
.swl-caption :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}

.swl-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.swl-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
}
.swl-check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-3);
  color: var(--prose);
  cursor: pointer;
}
.swl-check input {
  font: inherit;
  color: inherit;
  margin: 0;
}
.swl-check code {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--ink);
}

.swl-split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 760px) {
  .swl-split {
    grid-template-columns: minmax(0, 1fr);
  }
}
.swl-pane,
.swl-log {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.swl-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.swl-empty {
  font-size: var(--fs-3);
  color: var(--text-muted);
}

.swl-steps {
  margin: 0;
  padding-left: 1.8em;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: var(--fs-3);
  color: var(--text-muted);
}
.swl-step {
  font: inherit;
  color: var(--prose);
  text-align: left;
  width: 100%;
  padding: 3px 8px;
  border: 0;
  border-radius: var(--r1);
  background: transparent;
  cursor: pointer;
  font-family: var(--mono);
  font-size: var(--fs-3);
  overflow-wrap: anywhere;
}
.swl-step[data-past='yes'] {
  color: var(--text-muted);
}
.swl-step:hover,
.swl-step:focus-visible {
  background: var(--surface-3);
  outline: none;
}
.swl-step[data-on='yes'] {
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
}

.swl-server {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
  overflow-wrap: anywhere;
}
.swl-slots,
.swl-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.swl-slot,
.swl-tab {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  padding: 4px 10px;
  border-radius: var(--r2);
  background: var(--surface-3);
  font-size: var(--fs-3);
  color: var(--text-muted);
}
.swl-slot code,
.swl-tab code {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
}
.swl-slot__k,
.swl-tab__name {
  font-family: var(--mono);
  font-size: var(--fs-2);
}
.swl-slot[data-kind='waiting'][data-filled='yes'] {
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.swl-slot[data-kind='active'][data-filled='yes'] {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.swl-tab[data-ctrl='no'] {
  background: var(--surface-3);
}
.swl-tab[data-ctrl='yes'] {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.swl-tab[data-changed='yes'] {
  box-shadow: inset 0 0 0 1px var(--tone-info-line);
}

.swl-logs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
@media (max-width: 760px) {
  .swl-logs {
    grid-template-columns: minmax(0, 1fr);
  }
}
.swl-lines {
  margin: 0;
  padding-left: 1.6em;
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
  overflow-wrap: anywhere;
}
.swl-log[data-same='no'] {
  background: var(--tone-err-bg);
}
.swl-verdict {
  font-size: var(--fs-2);
  color: var(--tone-ok-text);
}
.swl-log[data-same='no'] .swl-verdict {
  color: var(--tone-err-text);
}
</style>
