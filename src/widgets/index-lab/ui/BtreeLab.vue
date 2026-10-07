<script setup lang="ts">
/**
 * «B-дерево по шагам»: дерево с ёмкостью страницы в четыре ключа строится вставка за вставкой,
 * поиск ключа и диапазона подсвечивают прочитанные страницы.
 *
 * Дерево строит и обходит не компонент, а строка `BTREE_CODE` из темы, собранная `new Function`
 * (`model/run.ts`). Та же строка напечатана на странице и сверяется `tests/unit/indexes.test.ts`
 * с `pageinspect` и SQL на настоящем Postgres. Компонент только раскладывает страницы по уровням.
 */
import { computed, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { loadBtree } from '../model/run';
import type { BtPage, BtTree, BtreeScenario } from '../model/types';

const props = defineProps<{
  btreeCode: string;
  scenarios: BtreeScenario[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const api = loadBtree(props.btreeCode);

const picked = ref(props.scenarios[0].id);
const options = props.scenarios.map((s) => ({ value: s.id, label: s.label }));
const scenario = computed(() => props.scenarios.find((s) => s.id === picked.value) ?? props.scenarios[0]);

const step = ref(props.scenarios[0].keys.length);
const mode = ref<'search' | 'range'>('search');
const modeOptions = [
  { value: 'search', label: 'найти ключ' },
  { value: 'range', label: 'диапазон' },
];
const key = ref(props.scenarios[0].search);
const from = ref(props.scenarios[0].range[0]);
const to = ref(props.scenarios[0].range[1]);

watch(scenario, (s) => {
  step.value = s.keys.length;
  key.value = s.search;
  [from.value, to.value] = s.range;
});

function build(count: number): BtTree {
  const s = scenario.value;
  const tree = api.createTree(s.capacity, s.rightFill);
  for (const k of s.keys.slice(0, count)) api.insert(tree, k);
  return tree;
}

const tree = computed(() => build(step.value));
const before = computed(() => build(Math.max(0, step.value - 1)));

/** Страницы по уровням: от корня к листьям, слева направо. */
const levels = computed<BtPage[][]>(() => {
  const out: BtPage[][] = [];
  let row: BtPage[] = [tree.value.root];
  while (row.length) {
    out.push(row);
    row = row.flatMap((p) => p.children ?? []);
  }
  return out;
});

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

const result = computed(() => {
  if (mode.value === 'search') {
    const r = api.search(tree.value, num(key.value));
    return { pages: r.pages, keys: r.found ? [num(key.value)] : [], found: r.found };
  }
  const lo = Math.min(num(from.value), num(to.value));
  const hi = Math.max(num(from.value), num(to.value));
  const r = api.range(tree.value, lo, hi);
  return { pages: r.pages, keys: r.keys.map(Number), found: r.keys.length > 0 };
});

const visited = computed(() => new Set(result.value.pages));
const hitKeys = computed(() => new Set(result.value.keys));

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};

const resultLine = computed(() => {
  const n = result.value.pages.length;
  const pages = `${n} ${plural(n, 'страница', 'страницы', 'страниц')}`;
  const lv = tree.value.levels;
  if (mode.value === 'search') {
    return result.value.found
      ? `Ключ \`${num(key.value)}\` найден. Прочитано: ${pages} — по одной на каждый из ${lv} ${plural(lv, 'уровня', 'уровней', 'уровней')}.`
      : `Ключа \`${num(key.value)}\` нет. Чтобы это узнать, всё равно пришлось спуститься до листа: ${pages}.`;
  }
  const k = result.value.keys.length;
  const extra = n - lv;
  return `${k} ${plural(k, 'ключ', 'ключа', 'ключей')} в диапазоне. Прочитано: ${pages} — спуск на ${lv} ${plural(lv, 'уровень', 'уровня', 'уровней')}${extra > 0 ? ` и ещё ${extra} ${plural(extra, 'лист', 'листа', 'листьев')} вправо по ссылкам` : ''}.`;
});

const insertLine = computed(() => {
  if (step.value === 0) return 'Дерево пустое: один лист без ключей.';
  const k = scenario.value.keys[step.value - 1];
  const grew = tree.value.levels > before.value.levels;
  const split = tree.value.pages - before.value.pages;
  const head = `Вставлен ключ \`${k}\`.`;
  if (grew) return `${head} Разделился корень — у дерева теперь ${tree.value.levels} ${plural(tree.value.levels, 'уровень', 'уровня', 'уровней')}.`;
  if (split > 1) return `${head} Разделились лист и страница над ним — на ${split} ${plural(split, 'страницу', 'страницы', 'страниц')} больше.`;
  if (split === 1) return `${head} Лист переполнился и разделился на два, разделитель ушёл в родителя.`;
  return `${head} В листе было место — дерево не изменилось.`;
});

const summary = computed(
  () =>
    `Ключей: ${step.value} · страниц: ${tree.value.pages} · уровней: ${tree.value.levels}`,
);
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="bt-toolbar">
        <SegmentedControl v-model="picked" class="l-pills" label="Порядок ключей" :options="options" />
        <div class="bt-range">
          <label class="bt-range__label" for="bt-step">вставлено</label>
          <input
            id="bt-step"
            v-model.number="step"
            class="bt-range__input"
            type="range"
            min="0"
            :max="scenario.keys.length"
            step="1"
          />
          <output class="bt-range__value" for="bt-step">{{ step }} из {{ scenario.keys.length }}</output>
        </div>
      </div>
    </template>

    <div class="bt-body">
      <Md class="bt-note" :text="scenario.note" />

      <div class="bt-query">
        <SegmentedControl v-model="mode" class="l-pills" label="Запрос" :options="modeOptions" />
        <div v-if="mode === 'search'" class="bt-fields">
          <label class="bt-field">
            <span class="bt-field__label">ключ</span>
            <input v-model.number="key" class="bt-input" type="number" min="0" max="40" />
          </label>
        </div>
        <div v-else class="bt-fields">
          <label class="bt-field">
            <span class="bt-field__label">от</span>
            <input v-model.number="from" class="bt-input" type="number" min="0" max="40" />
          </label>
          <label class="bt-field">
            <span class="bt-field__label">до</span>
            <input v-model.number="to" class="bt-input" type="number" min="0" max="40" />
          </label>
        </div>
      </div>

      <div class="bt-tree" role="group" aria-label="Страницы B-дерева по уровням">
        <div v-for="(row, li) in levels" :key="li" class="bt-level">
          <span class="bt-level__name">{{ li === 0 ? 'корень' : li === levels.length - 1 ? 'листья' : 'внутр.' }}</span>
          <div class="bt-level__pages">
            <template v-for="(page, pi) in row" :key="pi">
              <div
                class="bt-page"
                :data-leaf="page.leaf ? 'yes' : 'no'"
                :data-on="visited.has(page) ? 'yes' : 'no'"
              >
                <span
                  v-for="(k, ki) in page.keys"
                  :key="ki"
                  class="bt-key"
                  :data-hit="page.leaf && hitKeys.has(Number(k)) ? 'yes' : 'no'"
                >{{ k }}</span>
                <span v-if="!page.keys.length" class="bt-key bt-key--empty">пусто</span>
              </div>
              <span v-if="page.leaf && pi < row.length - 1" class="bt-link" aria-hidden="true">→</span>
            </template>
          </div>
        </div>
      </div>

      <div class="bt-out">
        <span class="bt-summary">{{ summary }}</span>
        <Md class="bt-line" :text="insertLine" />
        <Md class="bt-line bt-line--result" :text="resultLine" />
      </div>

      <Md class="bt-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.bt-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 20px;
}
.bt-range {
  display: flex;
  flex: 1 1 240px;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  min-width: 0;
}
.bt-range__label,
.bt-field__label {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-muted);
}
/* Ползунок целиком свой: у системного контрола свои цвета и шрифт. */
.bt-range__input {
  flex: 1 1 140px;
  min-width: 0;
  height: 4px;
  margin: 0;
  appearance: none;
  border-radius: var(--r-full);
  background: var(--surface-3);
  font: inherit;
  color: inherit;
}
.bt-range__input::-webkit-slider-thumb {
  appearance: none;
  width: 14px;
  height: 14px;
  border: 0;
  border-radius: var(--r-full);
  background: var(--ink);
  cursor: pointer;
}
.bt-range__input::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border: 0;
  border-radius: var(--r-full);
  background: var(--ink);
  cursor: pointer;
}
.bt-range__value {
  min-width: 7ch;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
}

.bt-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.bt-note,
.bt-caption,
.bt-line {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.bt-note :deep(code),
.bt-caption :deep(code),
.bt-line :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}

.bt-query {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 20px;
}
.bt-fields {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.bt-field {
  display: flex;
  align-items: center;
  gap: 8px;
}
.bt-input {
  width: 5.5em;
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--surface);
  font: inherit;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: inherit;
}

/* Страницы уровня переносятся на новую строку: подсвеченный лист всегда на виду. */
.bt-tree {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 14px;
  border-radius: var(--r3);
  background: var(--surface-2);
  min-width: 0;
}
.bt-level {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  min-width: 0;
}
.bt-level__name {
  flex: 0 0 5.5em;
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.bt-level__pages {
  display: flex;
  flex: 1 1 0;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.bt-page {
  display: flex;
  gap: 2px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--surface);
}
.bt-page[data-leaf='no'] {
  background: var(--surface-3);
}
.bt-page[data-on='yes'] {
  border-color: var(--tone-warn-line);
  background: var(--tone-warn-bg);
  box-shadow: inset 0 0 0 1px var(--tone-warn-line);
}
.bt-key {
  min-width: 2em;
  padding: 2px 4px;
  border-radius: var(--r1);
  font-family: var(--mono);
  font-size: var(--fs-3);
  text-align: center;
  color: var(--ink);
}
.bt-key--empty {
  color: var(--text-muted);
}
.bt-key[data-hit='yes'] {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
  box-shadow: inset 0 0 0 1px var(--tone-ok-line);
  font-weight: 600;
}
.bt-link {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-muted);
}

.bt-out {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.bt-summary {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
}
.bt-line--result {
  font-weight: 500;
}
</style>
