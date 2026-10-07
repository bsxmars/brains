<script setup lang="ts">
/**
 * «Сервер отдал → гидратация»: настоящий React и настоящий Vue поверх серверной разметки.
 *
 * Ничего заранее написанного про судьбу узлов здесь нет. Серверная разметка — строка из
 * `data.ts`, которую тест сверяет с `renderToString` обеих библиотек; гидратирует её
 * `model/lab.ts` — тот же модуль, что тест гоняет в Chromium. Судьба каждого узла выясняется
 * сравнением ссылок на объекты до и после, а не разметки: по разметке «забрал» и «выбросил
 * и создал такой же» неотличимы.
 *
 * ⚠️ Вся работа — по кнопке, а не в `setup`: остров рендерится ещё и в Node, где нет DOM,
 * а React весит больше, чем вся остальная страница, — он подгружается `import()` при первом
 * «Гидратировать», и до этого на странице его нет.
 *
 * ⚠️ Узлы, созданные React и Vue внутри рамок, стилями `scoped` не достаются: у них нет
 * атрибута владельца. Поэтому вид сцены задан через `:deep()` от своего класса.
 */
import { computed, createApp, createSSRApp, h, reactive, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button, SegmentedControl } from '@/shared/ui';
import { VARIANTS, hydrateReact, hydrateVue, serve, type ReactLibs } from '../model/lab';
import type { Fate, HydrationRun, Variant } from '../model/types';

const props = withDefaults(
  defineProps<{
    reactCode: string;
    vueCode: string;
    serverHtml: { react: string; reactBoundary: string; vue: string };
    foot?: string;
  }>(),
  { foot: '' },
);

type Pane = 'react' | 'vue';
type Stage = 'empty' | 'served' | 'busy' | 'hydrated';

const variant = ref<string>('text');
const boundary = ref<string>('no');
const stage = ref<Stage>('empty');
const failure = ref('');
const runs = reactive<Record<Pane, HydrationRun | null>>({ react: null, vue: null });
const deadClicks = reactive<Record<Pane, number>>({ react: 0, vue: 0 });

/**
 * Рамки, в которые кладётся серверная разметка. Нереактивно: функция-`ref` вызывается
 * на каждом рендере, и запись в реактивное из неё зациклила бы рендер (AGENTS.md).
 */
const boxes: Record<Pane, HTMLElement | null> = { react: null, vue: null };
function setBox(pane: Pane, el: unknown) {
  boxes[pane] = (el as HTMLElement | null) ?? null;
}

/** Живые корни. Не реактивные: наружу светит отчёт, а не сами приложения. */
const unmounts: (() => void)[] = [];
let reactLibs: ReactLibs | null = null;

const VARIANT_OPTIONS = [
  { value: 'match', label: 'ничего' },
  { value: 'text', label: 'текст' },
  { value: 'attr', label: 'атрибут' },
  { value: 'extension', label: 'чужой узел' },
];
const BOUNDARY_OPTIONS = [
  { value: 'no', label: 'без границы' },
  { value: 'yes', label: 'Suspense вокруг <p>' },
];

const VARIANT_NOTE: Record<Variant, string> = {
  match: 'Сервер и браузер рисуют одно и то же.',
  text: 'Сервер отрисовал время `12:00:00`, браузер ждёт `12:00:03` — как `new Date()`, вызванный в двух местах.',
  attr: 'Сервер отрисовал класс `day`, браузер ждёт `night` — как тема, прочитанная из `localStorage`.',
  extension: 'До гидратации «расширение браузера» вставило `<span data-ext>` после заголовка.',
};

const FATE_LABEL: Record<Fate, string> = {
  kept: 'тот же узел',
  patched: 'тот же, текст переписан',
  dropped: 'выброшен',
};

const picked = computed(() => variant.value as Variant);
const note = computed(() => VARIANT_NOTE[picked.value]);

function clear() {
  while (unmounts.length) unmounts.pop()!();
  for (const box of [boxes.react, boxes.vue]) if (box) box.innerHTML = '';
  runs.react = null;
  runs.vue = null;
  deadClicks.react = 0;
  deadClicks.vue = 0;
  failure.value = '';
  stage.value = 'empty';
}

function onPick() {
  clear();
}

function serveBoth() {
  clear();
  const spec = VARIANTS[picked.value];
  if (!boxes.react || !boxes.vue) return;
  serve(boxes.react, boundary.value === 'yes' ? props.serverHtml.reactBoundary : props.serverHtml.react, spec);
  serve(boxes.vue, props.serverHtml.vue, spec);
  stage.value = 'served';
}

async function loadReact(): Promise<ReactLibs> {
  if (!reactLibs) {
    const [React, client] = await Promise.all([import('react'), import('react-dom/client')]);
    reactLibs = { React, client };
  }
  return reactLibs;
}

async function hydrateBoth() {
  if (stage.value !== 'served') serveBoth();
  const reactBox = boxes.react;
  const vueBox = boxes.vue;
  if (!reactBox || !vueBox) return;
  stage.value = 'busy';
  const spec = VARIANTS[picked.value];
  try {
    const libs = await loadReact();
    const react = await hydrateReact(reactBox, props.reactCode, { ...spec.client, boundary: boundary.value === 'yes' }, libs);
    unmounts.push(react.unmount);
    runs.react = react.run;
    const vue = await hydrateVue(vueBox, props.vueCode, spec.client, { createApp, createSSRApp, h, ref });
    unmounts.push(vue.unmount);
    runs.vue = vue.run;
    stage.value = 'hydrated';
  } catch (error) {
    failure.value = `Не вышло: ${(error as Error)?.message ?? String(error)}`;
    stage.value = 'served';
  }
}

/** Клик по кнопке до гидратации: браузер его доставил, а обработчика нет. */
function onStageClick(pane: Pane, event: MouseEvent) {
  if (stage.value !== 'served') return;
  if ((event.target as Element | null)?.closest('button')) deadClicks[pane]++;
}

const PANES: { key: Pane; title: string }[] = [
  { key: 'react', title: 'React 19 · hydrateRoot' },
  { key: 'vue', title: 'Vue 3.5 · createSSRApp().mount()' },
];

function counts(run: HydrationRun) {
  const kept = run.nodes.filter((n) => n.fate === 'kept').length;
  return `узлов с сервера: ${run.nodes.length} · тех же: ${kept} · создано заново: ${run.created.length}`;
}
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="sh-controls">
        <div class="sh-control">
          <span class="sh-caption">что разошлось</span>
          <SegmentedControl v-model="variant" class="l-pills" label="Что разошлось между сервером и браузером" :options="VARIANT_OPTIONS" @update:model-value="onPick" />
        </div>
        <div class="sh-control">
          <span class="sh-caption">React</span>
          <SegmentedControl v-model="boundary" class="l-pills" label="Граница Suspense у React" :options="BOUNDARY_OPTIONS" @update:model-value="onPick" />
        </div>
        <div class="sh-actions">
          <Button variant="secondary" :disabled="stage === 'busy'" @click="serveBoth">1 · Отдать HTML</Button>
          <Button variant="primary" :disabled="stage === 'busy' || stage === 'hydrated'" @click="hydrateBoth">2 · Гидратировать</Button>
          <Button variant="secondary" :disabled="stage === 'empty' || stage === 'busy'" @click="clear">сброс</Button>
        </div>
        <Md class="sh-note" :text="note" />
      </div>
    </template>

    <div class="sh-panes">
      <section v-for="pane in PANES" :key="pane.key" class="sh-pane" :aria-label="pane.title">
        <div class="sh-title">{{ pane.title }}</div>

        <div :ref="(el) => setBox(pane.key, el)" class="sh-stage" :data-stage="stage" @click="onStageClick(pane.key, $event)"></div>

        <p v-if="stage === 'empty'" class="sh-empty">Сцена пуста: нажмите «Отдать HTML».</p>
        <p v-else-if="stage === 'served'" class="sh-empty">
          Разметка с сервера на месте, обработчиков нет. Кликов по кнопке: {{ deadClicks[pane.key] }} — а на ней всё ещё 0.
        </p>
        <p v-else-if="stage === 'busy'" class="sh-empty">Гидратирую…</p>

        <template v-if="runs[pane.key]">
          <div class="sh-summary">{{ counts(runs[pane.key]!) }}</div>
          <span class="sh-caption">узлы с сервера — что с ними стало</span>
          <ol class="sh-nodes">
            <li v-for="(row, i) in runs[pane.key]!.nodes" :key="'n' + i" class="sh-node" :style="{ paddingLeft: `${row.depth * 14}px` }">
              <span class="sh-label">{{ row.label }}</span>
              <span class="sh-chip" :data-fate="row.fate">{{ FATE_LABEL[row.fate] }}{{ row.now ? ` → ${row.now}` : '' }}</span>
            </li>
          </ol>

          <div v-if="runs[pane.key]!.created.length" class="sh-block">
            <span class="sh-caption">создано заново, в порядке итогового дерева</span>
            <ol class="sh-nodes">
              <li v-for="(row, i) in runs[pane.key]!.created" :key="'c' + i" class="sh-node" :style="{ paddingLeft: `${row.depth * 14}px` }">
                <span class="sh-label">{{ row.label }}</span>
                <span class="sh-chip" data-fate="created">создан</span>
              </li>
            </ol>
          </div>

          <div class="sh-block">
            <span class="sh-caption">сообщил</span>
            <p v-if="runs[pane.key]!.messages.length === 0" class="sh-quiet">ничего</p>
            <pre v-for="(m, i) in runs[pane.key]!.messages" :key="'m' + i" class="sh-message">{{ m }}</pre>
          </div>

          <div class="sh-block">
            <span class="sh-caption">итог против клиентского рендера с нуля</span>
            <p v-if="runs[pane.key]!.matchesClient" class="sh-verdict" data-ok="yes">совпадает</p>
            <template v-else>
              <p class="sh-verdict" data-ok="no">не совпадает — в документе осталось серверное</p>
              <pre class="sh-message">{{ runs[pane.key]!.clientHtml }}</pre>
            </template>
          </div>
        </template>
      </section>
    </div>

    <p v-if="failure" class="sh-failure">{{ failure }}</p>

    <template v-if="props.foot" #footer>
      <Md class="sh-foot" :text="props.foot" />
    </template>
  </DemoFrame>
</template>

<style scoped>
.sh-controls {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.sh-control {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}
.sh-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.sh-caption {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.sh-note {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--prose);
}

.sh-panes {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 18px;
  padding: 20px;
  min-width: 0;
}
.sh-pane {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.sh-title {
  font-family: var(--mono);
  font-size: var(--fs-4);
  font-weight: 600;
  color: var(--ink);
}

.sh-stage {
  min-height: 24px;
  padding: 14px 16px;
  border-radius: var(--r2);
  border: 1px dashed var(--border-strong);
  background: var(--surface-2);
}
.sh-stage[data-stage='empty'] {
  display: none;
}
.sh-stage :deep(section) {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  padding: 12px 14px;
  border-radius: var(--r1);
  background: var(--surface);
  color: var(--ink);
  font-size: var(--fs-5);
}
.sh-stage :deep(section.night) {
  background: var(--ink);
  color: var(--canvas);
}
.sh-stage :deep(h3) {
  margin: 0;
  font-size: var(--fs-6);
}
.sh-stage :deep(p) {
  margin: 0;
}
.sh-stage :deep(button) {
  font: inherit;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: var(--r1);
  padding: 5px 10px;
  cursor: pointer;
}
.sh-stage :deep([data-ext]) {
  font-family: var(--mono);
  font-size: var(--fs-2);
  padding: 2px 8px;
  border-radius: var(--r-full);
  background: var(--tone-warn-chip);
  color: var(--tone-warn-strong);
}

.sh-empty,
.sh-quiet {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.55;
  color: var(--text-muted);
}
.sh-summary {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}

.sh-nodes {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.sh-node {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px 10px;
}
.sh-label {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
  overflow-wrap: anywhere;
}
.sh-chip {
  padding: 1px 8px;
  border-radius: var(--r-full);
  font-family: var(--mono);
  font-size: var(--fs-3);
  white-space: nowrap;
}
.sh-chip[data-fate='kept'] {
  background: var(--tone-ok-chip);
  color: var(--tone-ok-strong);
}
.sh-chip[data-fate='patched'] {
  background: var(--tone-warn-chip);
  color: var(--tone-warn-strong);
}
.sh-chip[data-fate='dropped'] {
  background: var(--tone-err-chip);
  color: var(--tone-err-strong);
}
.sh-chip[data-fate='created'] {
  background: var(--tone-info-chip);
  color: var(--tone-info-strong);
}

.sh-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sh-message {
  margin: 0;
  font-size: var(--fs-2);
  line-height: 1.55;
  padding: 9px 11px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.sh-verdict {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--fs-3);
}
.sh-verdict[data-ok='yes'] {
  color: var(--tone-ok-strong);
}
.sh-verdict[data-ok='no'] {
  color: var(--tone-err-strong);
}
.sh-failure {
  margin: 0 20px 20px;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--tone-err-strong);
}
.sh-foot {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}
</style>
