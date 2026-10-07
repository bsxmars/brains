<script setup lang="ts">
/**
 * «Отправка по шагам»: сквозной пример темы как дерево, слушатели на узлах и журнал вызовов,
 * который можно пройти по одному.
 *
 * Журнал считает не компонент, а строка `DISPATCH_CODE` из темы, собранная `new Function`
 * (`model/run.ts`). Та же строка напечатана на странице и прогоняется
 * `tests/unit/dom-events.test.ts` против журналов Chromium со стенда. Рядом тот же сценарий
 * исполняет браузер читателя — модулем `model/dom.ts` (тем же, что исполнял стенд) в скрытом
 * `iframe`: настоящий `dispatchEvent`, без заготовленных ответов. Каждый прогон — в новом
 * `iframe`, чтобы слушатели прошлого сценария на `window` и `document` не мешали.
 */
import { computed, onMounted, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import StepToolbar from '@/shared/ui/StepToolbar.vue';
import { SegmentedControl } from '@/shared/ui';
import { runInDom, type Fixture } from '../model/dom';
import { buildModelTree, formatLog, loadDispatch, runInModel } from '../model/run';
import type { DispatchResult, ListenerSpec, ModelNode, Scenario } from '../model/types';

const props = defineProps<{
  dispatchCode: string;
  fixture: Fixture;
  scenarios: Scenario[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const api = loadDispatch(props.dispatchCode);

const picked = ref(props.scenarios[0].id);
const options = props.scenarios.map((s) => ({ value: s.id, label: s.label }));
const scenario = computed(() => props.scenarios.find((s) => s.id === picked.value) ?? props.scenarios[0]);

const model = computed<DispatchResult>(() => runInModel(api, scenario.value));
const step = ref(0);
watch(picked, () => (step.value = 0));

const PHASE = ['0 — NONE', '1 — захват', '2 — цель', '3 — всплытие'];

/** Дерево для показа: узлы модели с глубиной. Порядок — как в `buildModelTree`. */
const tree = computed(() => {
  const nodes = [...buildModelTree(api, scenario.value.shadow).values()];
  const depth = (n: ModelNode): number =>
    n.kind === 'window' ? 0 : n.kind === 'document' ? 1 : depth((n.parent ?? n.host) as ModelNode) + 1;
  return nodes.map((n) => ({ name: n.name, depth: depth(n), mode: n.kind === 'shadow-root' ? n.mode : undefined }));
});

const current = computed(() => model.value.log[step.value]);
const total = computed(() => model.value.log.length);

/** Слушатель вызван до текущего шага включительно (в любом прогоне), вызывается сейчас или не вызывался. */
function listenerState(l: ListenerSpec): 'now' | 'done' | 'wait' | 'never' {
  const log = model.value.log;
  if (current.value && current.value.id === l.id && current.value.currentTarget === l.at) return 'now';
  const idx = log.findIndex((e) => e.id === l.id);
  if (idx < 0) return 'never';
  return idx <= step.value ? 'done' : 'wait';
}

const listenersAt = (name: string) => scenario.value.listeners.filter((l) => l.at === name);

const ACT: Record<string, string> = {
  stop: 'stopPropagation',
  stopImmediate: 'stopImmediate…',
  prevent: 'preventDefault',
  detachLi: 'li.remove()',
  removeL3: 'снять L3',
};

const onPath = computed(() => new Set(current.value?.path ?? []));

const summary = computed(() => {
  const r = model.value;
  return r.returned
    .map((ret, i) => {
      const run = r.returned.length > 1 ? `Отправка ${i + 1}: ` : '';
      const after = r.targetAfter[i] === null ? '`null`' : `\`${r.targetAfter[i]}\``;
      return `${run}\`dispatchEvent\` вернул \`${ret}\`, \`defaultPrevented\` — \`${r.defaultPrevented[i]}\`, \`target\` после отправки — ${after}.`;
    })
    .join(' ');
});

const browser = ref<DispatchResult | null>(null);
const browserError = ref('');

function runInBrowser() {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden';
  document.body.append(frame);
  try {
    browser.value = runInDom(frame.contentWindow as Window, props.fixture, scenario.value);
    browserError.value = '';
  } catch (e) {
    browser.value = null;
    browserError.value = String((e as Error).message ?? e);
  } finally {
    frame.remove();
  }
}

onMounted(runInBrowser);
watch(picked, runInBrowser);

const same = computed(() => {
  const b = browser.value;
  if (!b) return null;
  const m = model.value;
  return (
    JSON.stringify([formatLog(b), b.returned, b.defaultPrevented, b.targetAfter]) ===
    JSON.stringify([formatLog(m), m.returned, m.defaultPrevented, m.targetAfter])
  );
});

const browserLines = computed(() => (browser.value ? formatLog(browser.value) : []));
const modelLines = computed(() => formatLog(model.value));

const verdict = computed(() => {
  if (browserError.value) return `Ваш браузер не смог исполнить сценарий: ${browserError.value}`;
  if (same.value === null) return 'Ваш браузер ещё не ответил.';
  return same.value
    ? 'Ваш браузер: настоящий `dispatchEvent` с той же разметкой и теми же слушателями дал **тот же журнал**, тот же результат и тот же `target` после отправки.'
    : 'Ваш браузер ответил **иначе**, чем модель и Chromium на стенде. Его журнал — ниже; расхождение стоит сверить со спецификацией DOM.';
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="picked" class="l-pills ep-pills" label="Сценарий" :options="options" />
    </template>

    <div class="ep-body">
      <Md class="ep-note" :text="scenario.note" />

      <div class="ep-split">
        <div class="ep-pane">
          <span class="ep-label">дерево и слушатели</span>
          <ul class="ep-tree" aria-label="Дерево узлов">
            <li
              v-for="n in tree"
              :key="n.name"
              class="ep-node"
              :data-path="onPath.has(n.name) ? 'yes' : 'no'"
              :data-now="current && current.currentTarget === n.name ? 'yes' : 'no'"
              :style="{ paddingLeft: `${n.depth * 0.9 + 0.5}em` }"
            >
              <code class="ep-node__name">{{ n.name }}<template v-if="n.mode"> ({{ n.mode }})</template></code>
              <span v-if="n.name === scenario.target" class="ep-target">цель</span>
              <span
                v-for="l in listenersAt(n.name)"
                :key="l.id"
                class="ep-chip"
                :data-state="listenerState(l)"
                :title="l.capture ? 'захват' : 'всплытие'"
              >{{ l.id }} {{ l.capture ? '↓' : '↑' }}<template v-if="l.once"> once</template><template v-if="l.passive"> passive</template><template v-if="l.act"> · {{ ACT[l.act] }}</template></span>
            </li>
          </ul>
        </div>

        <div class="ep-pane ep-pane--step">
          <StepToolbar
            :counter="total ? `вызов ${step + 1} из ${total}` : 'ни одного вызова'"
            :at-start="step === 0"
            :at-end="step >= total - 1"
            next-label="Следующий слушатель →"
            @prev="step = Math.max(0, step - 1)"
            @next="step = Math.min(total - 1, step + 1)"
            @reset="step = 0"
          />
          <dl v-if="current" class="ep-facts">
            <dt>слушатель</dt>
            <dd><code>{{ current.id }}</code><template v-if="model.returned.length > 1"> · отправка {{ current.run + 1 }}</template></dd>
            <dt>currentTarget</dt>
            <dd><code>{{ current.currentTarget }}</code></dd>
            <dt>eventPhase</dt>
            <dd><code>{{ PHASE[current.eventPhase] }}</code></dd>
            <dt>target</dt>
            <dd><code>{{ current.target }}</code></dd>
            <dt>defaultPrevented</dt>
            <dd><code>{{ current.prevented }}</code></dd>
            <dt>composedPath()</dt>
            <dd class="ep-path">
              <code v-for="p in current.path" :key="p" class="ep-path__node">{{ p }}</code>
            </dd>
          </dl>
          <p v-else class="ep-empty">Ни один слушатель не вызван.</p>
          <Md class="ep-summary" :text="summary" />
        </div>
      </div>

      <div class="ep-logs">
        <div class="ep-log">
          <span class="ep-label">журнал модели: слушатель, currentTarget, eventPhase, target | composedPath()</span>
          <pre class="ep-code"><template v-for="(line, i) in modelLines" :key="i"><span
            class="ep-line"
            :data-on="i === step ? 'yes' : 'no'"
          >{{ line }}</span>{{ '\n' }}</template></pre>
        </div>
        <div class="ep-verdict" :data-tone="same === false || browserError ? 'warn' : same ? 'ok' : 'wait'">
          <Md :text="verdict" />
        </div>
        <div v-if="same === false" class="ep-log">
          <span class="ep-label">журнал вашего браузера</span>
          <pre class="ep-code"><template v-for="(line, i) in browserLines" :key="i"><span
            class="ep-line"
            :data-diff="line !== modelLines[i] ? 'yes' : 'no'"
          >{{ line }}</span>{{ '\n' }}</template></pre>
        </div>
      </div>

      <Md class="ep-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.ep-pills :deep(.aura-segmented),
.ep-pills.aura-segmented {
  flex-wrap: wrap;
}
.ep-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.ep-note,
.ep-caption,
.ep-summary,
.ep-verdict {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.ep-note :deep(code),
.ep-caption :deep(code),
.ep-summary :deep(code),
.ep-verdict :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}

.ep-split {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 760px) {
  .ep-split {
    grid-template-columns: minmax(0, 1fr);
  }
}

.ep-pane {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.ep-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.ep-tree {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.ep-node {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
  padding-top: 3px;
  padding-bottom: 3px;
  padding-right: 6px;
  border-radius: var(--r2);
  font-size: var(--fs-3);
  color: var(--text-muted);
}
.ep-node[data-path='yes'] {
  color: var(--ink);
}
.ep-node[data-now='yes'] {
  background: var(--tone-warn-bg);
  box-shadow: inset 0 0 0 1px var(--tone-warn-line);
}
.ep-node__name {
  font-family: var(--mono);
  font-size: var(--fs-3);
}
.ep-node[data-path='yes'] .ep-node__name {
  font-weight: 600;
}
.ep-target {
  padding: 0 6px;
  border-radius: var(--r1);
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
  font-family: var(--mono);
  font-size: var(--fs-2);
}
.ep-chip {
  padding: 1px 6px;
  border-radius: var(--r1);
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--prose);
  font-family: var(--mono);
  font-size: var(--fs-2);
  white-space: nowrap;
}
.ep-chip[data-state='done'] {
  border-color: var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.ep-chip[data-state='now'] {
  border-color: var(--tone-warn-line);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
  font-weight: 600;
}
.ep-chip[data-state='never'] {
  border-style: dashed;
  color: var(--text-muted);
  text-decoration: line-through;
}

.ep-facts {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 6px 12px;
  margin: 0;
  font-size: var(--fs-3);
  color: var(--prose);
}
.ep-facts dt {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
  padding-top: 2px;
}
.ep-facts dd {
  margin: 0;
  min-width: 0;
}
.ep-facts code {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
}
.ep-path {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.ep-path__node {
  padding: 0 5px;
  border-radius: var(--r1);
  background: var(--surface-3);
  font-size: var(--fs-2) !important;
}
.ep-empty {
  margin: 0;
  font-size: var(--fs-3);
  color: var(--prose);
}

.ep-logs {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.ep-log {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.ep-code {
  margin: 0;
  overflow-x: auto;
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.7;
  /* Подложка — общая для кода курса (`pre` в base.css, чернильная): цвета ниже — «на чернилах». */
  color: var(--code-fg);
  white-space: pre;
}
.ep-line[data-on='yes'] {
  background: var(--warn-wash-on-ink);
  color: var(--tone-warn-on-ink);
}
.ep-line[data-diff='yes'] {
  background: var(--warn-wash-on-ink);
  color: var(--tone-warn-on-ink);
}
.ep-verdict {
  padding: 10px 14px;
  border-radius: var(--r2);
  background: var(--surface-2);
}
.ep-verdict[data-tone='ok'] {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.ep-verdict[data-tone='warn'] {
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
</style>
