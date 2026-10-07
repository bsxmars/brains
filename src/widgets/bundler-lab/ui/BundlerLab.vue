<script setup lang="ts">
/**
 * «Сборка целиком»: граф, отбор операторов, имена после склейки и итоговый бандл
 * на пяти сценариях магазина.
 *
 * Считает не компонент, а строки `GRAPH_CODE`, `SHAKE_CODE` и `HOIST_CODE` из темы, собранные
 * `new Function` (`model/run.ts`). Те же строки напечатаны на странице и сверяются
 * `tests/unit/bundler-internals.test.ts` с настоящим rolldown посимвольно. Строка «совпадает
 * с rolldown» сравнивает результат с выводом rolldown, снятым на стенде (`scenario.rolldown`).
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { loadBundler } from '../model/run';
import type { BundleScenario, Statement } from '../model/types';

const props = defineProps<{
  graphCode: string;
  shakeCode: string;
  hoistCode: string;
  scenarios: BundleScenario[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const api = loadBundler(props.graphCode, props.shakeCode, props.hoistCode);

const picked = ref(props.scenarios[0].id);
const options = props.scenarios.map((s) => ({ value: s.id, label: s.label }));
const scenario = computed(() => props.scenarios.find((s) => s.id === picked.value) ?? props.scenarios[0]);

const result = computed(() => api.bundle(scenario.value.files, scenario.value.entry));
const matches = computed(() => result.value.code === scenario.value.rolldown);

type Tone = 'effect' | 'ref' | 'drop';

interface Row {
  key: string;
  text: string;
  tone: Tone;
  status: string;
  rename: string | null;
  callOnly: boolean;
}

/** Короткая подпись оператора: имя, если оно есть, иначе начало первой строки. */
function short(st: Statement): string {
  if (st.name) return st.name;
  const line = st.code.split('\n')[0];
  return line.length > 28 ? `${line.slice(0, 27)}…` : line;
}

const modules = computed(() => {
  const { graph, shaken, finalName } = result.value;
  return graph.order.map((mod, mi) => {
    const rows: Row[] = mod.body.map((st, si) => {
      const why = shaken.kept.get(st);
      const tone: Tone = why === undefined ? 'drop' : why === 'эффект' ? 'effect' : 'ref';
      const status = why === undefined ? 'выброшен' : why === 'эффект' ? 'эффект' : `нужен: ${short(why)}`;
      const final = finalName.get(st);
      return {
        key: `${mod.path}:${si}`,
        text: (st.exported ? 'export ' : '') + st.code,
        tone,
        status,
        rename: final && final !== st.name ? final : null,
        callOnly: Boolean(st.init) && why !== undefined && !shaken.needed.has(st),
      };
    });
    const imports = mod.imports.map((imp) => {
      const names = imp.names.map((n) => n.local).join(', ');
      return names ? `${names} ← ${imp.from}` : `${imp.from} (без имён)`;
    });
    return {
      n: mi + 1,
      path: mod.path,
      noSideEffects: mod.noSideEffects,
      empty: rows.every((r) => r.tone === 'drop'),
      imports,
      rows,
    };
  });
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="picked" class="l-pills" label="Сценарий" :options="options" />
    </template>

    <div class="bl-body">
      <Md class="bl-note" :text="scenario.note" />

      <div class="bl-order" aria-label="Порядок модулей после обхода графа">
        <span class="bl-label">порядок графа</span>
        <ol class="bl-order__list">
          <li v-for="m in modules" :key="m.path" class="bl-order__item" :data-empty="m.empty ? 'yes' : 'no'">
            <span class="bl-order__n">{{ m.n }}</span>
            <code>{{ m.path }}</code>
          </li>
        </ol>
      </div>

      <div class="bl-split">
        <div class="bl-modules">
          <section v-for="m in modules" :key="m.path" class="bl-mod" :aria-label="`Модуль ${m.path}`">
            <header class="bl-mod__head">
              <code class="bl-mod__path">{{ m.n }}. {{ m.path }}</code>
              <span v-if="m.noSideEffects" class="bl-tag" data-tone="info">sideEffects: false</span>
              <span v-if="m.empty" class="bl-tag" data-tone="drop">не попал в бандл</span>
            </header>
            <p v-for="imp in m.imports" :key="imp" class="bl-mod__import">
              <code>import {{ imp }}</code>
            </p>
            <div v-for="r in m.rows" :key="r.key" class="bl-st" :data-tone="r.tone">
              <div class="bl-st__tags">
                <span class="bl-tag" :data-tone="r.tone">{{ r.status }}</span>
                <span v-if="r.rename" class="bl-tag" data-tone="info">→ {{ r.rename }}</span>
                <span v-if="r.callOnly" class="bl-tag" data-tone="info">остался только вызов</span>
              </div>
              <pre class="bl-code bl-code--st">{{ r.text }}</pre>
            </div>
          </section>
        </div>

        <div class="bl-out">
          <span class="bl-label">бандл</span>
          <pre class="bl-code">{{ result.code }}</pre>
          <p class="bl-match" :data-ok="matches ? 'yes' : 'no'">
            {{ matches ? 'Совпадает с выводом rolldown 1.2.8 символ в символ.' : 'Расходится с выводом rolldown 1.2.8.' }}
          </p>
        </div>
      </div>

      <Md class="bl-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.bl-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.bl-note,
.bl-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.bl-note :deep(code),
.bl-caption :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}

.bl-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.bl-order {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.bl-order__list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.bl-order__item {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  padding: 4px 10px;
  border-radius: var(--r1);
  background: var(--surface-3);
  font-size: var(--fs-3);
  color: var(--chip-text);
  min-width: 0;
  overflow-wrap: anywhere;
}
.bl-order__item code {
  font-family: var(--mono);
}
.bl-order__item[data-empty='yes'] {
  background: var(--sunk-dim);
  color: var(--text-muted);
  text-decoration: line-through;
}
.bl-order__n {
  font-family: var(--mono);
  font-weight: 600;
}

.bl-split {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 960px) {
  .bl-split {
    grid-template-columns: minmax(0, 1fr);
  }
}

.bl-modules {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.bl-mod {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.bl-mod__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px 8px;
}
.bl-mod__path {
  font-family: var(--mono);
  font-size: var(--fs-3);
  font-weight: 600;
  color: var(--ink);
  overflow-wrap: anywhere;
}
.bl-mod__import {
  margin: 0;
  font-size: var(--fs-2);
  color: var(--text-muted);
  overflow-wrap: anywhere;
}
.bl-mod__import code {
  font-family: var(--mono);
}

.bl-st {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}
.bl-st__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.bl-tag {
  display: inline-block;
  padding: 2px 8px;
  border-radius: var(--r1);
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.bl-tag[data-tone='effect'] {
  background: var(--tone-warn-chip);
  color: var(--tone-warn-text);
}
.bl-tag[data-tone='ref'] {
  background: var(--tone-ok-chip);
  color: var(--tone-ok-text);
}
.bl-tag[data-tone='drop'] {
  background: var(--surface-3);
  color: var(--text-muted);
}
.bl-tag[data-tone='info'] {
  background: var(--tone-info-chip);
  color: var(--tone-info-text);
}

/* Подложка `pre` — общая для кода курса (base.css, чернильная): цвета ниже — «на чернилах». */
.bl-code {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.65;
  color: var(--code-fg);
  white-space: pre;
  overflow-x: auto;
}
.bl-code--st {
  padding: 9px 12px;
}
.bl-st[data-tone='drop'] .bl-code {
  color: var(--ink-faint);
}
.bl-st[data-tone='effect'] .bl-code {
  box-shadow: inset 3px 0 0 var(--tone-warn-on-ink);
}
.bl-st[data-tone='ref'] .bl-code {
  box-shadow: inset 3px 0 0 var(--tone-ok-on-ink);
}

.bl-out {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.bl-match {
  margin: 0;
  font-size: var(--fs-3);
  line-height: 1.5;
  color: var(--tone-ok-text);
}
.bl-match[data-ok='no'] {
  color: var(--tone-err-text);
}
</style>
