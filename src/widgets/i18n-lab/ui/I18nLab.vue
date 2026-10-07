<script setup lang="ts">
/**
 * «Сообщение, дерево, строка»: редактор сообщения ICU, значения аргументов и локаль —
 * разобранное дерево с выбранными ветками, категория числа и итоговая строка.
 *
 * Дерево строит `parse`, ветку выбирает `pick`, строку собирает `format` — это строка `ICU_CODE`
 * из темы, собранная `new Function` (`model/run.ts`). Направление вывода — `direction` из
 * `DIRECTION_CODE`. Те же строки напечатаны на странице и сверяются `tests/unit/i18n.test.ts`
 * с `intl-messageformat` и `@messageformat/core`. Компонент только раскладывает дерево по
 * строкам и спрашивает `Intl.PluralRules` о списке категорий локали — для подписи.
 */
import { computed, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { argsOf, flatten, isBranch, loadDirection, loadIcu } from '../model/run';
import type { IcuBranchNode, IcuNode, IcuPreset, IcuValues } from '../model/types';

const props = defineProps<{
  icuCode: string;
  directionCode: string;
  presets: IcuPreset[];
  locales: string[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const api = loadIcu(props.icuCode);
const direction = loadDirection(props.directionCode);

const presetId = ref(props.presets[0].id);
const presetOptions = props.presets.map((p) => ({ value: p.id, label: p.label }));
const preset = computed(() => props.presets.find((p) => p.id === presetId.value) ?? props.presets[0]);

const message = ref(props.presets[0].message);
const locale = ref(props.presets[0].locale);
const values = ref<IcuValues>({ ...props.presets[0].values });
const localeOptions = props.locales.map((l) => ({ value: l, label: l }));

watch(preset, (p) => {
  message.value = p.message;
  locale.value = p.locale;
  values.value = { ...p.values };
});

const parsed = computed<{ tree: IcuNode[] | null; error: string }>(() => {
  try {
    return { tree: api.parse(message.value), error: '' };
  } catch (e) {
    return { tree: null, error: e instanceof Error ? e.message : String(e) };
  }
});

const args = computed(() => (parsed.value.tree ? argsOf(parsed.value.tree) : { numbers: [], selects: [], texts: [] }));

/** Значения для `format`: недостающие аргументы получают безобидные значения по умолчанию. */
const filled = computed<IcuValues>(() => {
  const v: IcuValues = { ...values.value };
  for (const name of args.value.numbers) if (typeof v[name] !== 'number') v[name] = Number(v[name] ?? 0) || 0;
  for (const s of args.value.selects) if (v[s.name] === undefined) v[s.name] = 'other';
  for (const name of args.value.texts) if (v[name] === undefined) v[name] = name;
  return v;
});

const output = computed(() => {
  const tree = parsed.value.tree;
  if (!tree) return { text: '', error: parsed.value.error };
  try {
    return { text: api.format(tree, filled.value, locale.value), error: '' };
  } catch (e) {
    return { text: '', error: e instanceof Error ? e.message : String(e) };
  }
});

const rows = computed(() => {
  const tree = parsed.value.tree;
  if (!tree) return [];
  try {
    return flatten(api, tree, filled.value, locale.value);
  } catch {
    return [];
  }
});

const dir = computed(() => {
  try {
    return direction(locale.value);
  } catch {
    return 'ltr';
  }
});

/** Первый узел plural или selectordinal — для строки «категории локали». */
const firstPlural = computed<IcuBranchNode | null>(() => {
  const walk = (list: IcuNode[]): IcuBranchNode | null => {
    for (const n of list) {
      if (!isBranch(n)) continue;
      if (n.type !== 'select') return n;
      for (const b of Object.values(n.options)) {
        const found = walk(b);
        if (found) return found;
      }
    }
    return null;
  };
  return parsed.value.tree ? walk(parsed.value.tree) : null;
});

const categories = computed(() => {
  const node = firstPlural.value;
  if (!node) return null;
  const type = node.type === 'plural' ? 'cardinal' : 'ordinal';
  let list: string[];
  try {
    list = new Intl.PluralRules(locale.value, { type }).resolvedOptions().pluralCategories as string[];
  } catch {
    return null;
  }
  const picked = api.pick(node, filled.value, locale.value);
  return {
    name: node.name,
    type: node.type,
    current: picked.category ?? '',
    key: picked.key,
    items: list.map((c) => ({ c, has: Object.hasOwn(node.options, c), on: c === picked.category })),
  };
});

const categoryNote = computed(() => {
  const c = categories.value;
  if (!c) return '';
  const exact = c.key.startsWith('=');
  if (exact) return `Сработало точное \`${c.key}\` — категория \`${c.current}\` даже не понадобилась.`;
  if (c.key === c.current) return `\`Intl.PluralRules('${locale.value}')\` ответил \`${c.current}\`, и такая ветка в сообщении есть.`;
  return `\`Intl.PluralRules('${locale.value}')\` ответил \`${c.current}\`, но ветки \`${c.current}\` в сообщении нет — взята \`other\`.`;
});

function setNumber(name: string, raw: string) {
  const n = Number(raw.replace(',', '.'));
  if (Number.isFinite(n) && Math.abs(n) <= 1e9) values.value = { ...values.value, [name]: n };
}
function setValue(name: string, v: string) {
  values.value = { ...values.value, [name]: v };
}
function onMessage(e: Event) {
  message.value = (e.target as HTMLTextAreaElement).value.slice(0, 600);
}
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="presetId" class="l-pills" label="Сообщение" :options="presetOptions" />
    </template>

    <div class="il-body">
      <Md class="il-note" :text="preset.note" />

      <div class="il-field">
        <label class="il-label" for="il-message">сообщение ICU</label>
        <textarea
          id="il-message"
          class="il-message"
          :value="message"
          rows="4"
          spellcheck="false"
          autocomplete="off"
          @input="onMessage"
        />
      </div>

      <div class="il-controls">
        <div class="il-field">
          <span class="il-label">локаль</span>
          <SegmentedControl v-model="locale" label="Локаль" :options="localeOptions" />
        </div>

        <div v-for="name in args.numbers" :key="`n-${name}`" class="il-field">
          <label class="il-label" :for="`il-num-${name}`">{{ name }} = {{ filled[name] }}</label>
          <div class="il-num">
            <input
              :id="`il-num-${name}`"
              class="il-range"
              type="range"
              min="0"
              max="200"
              step="1"
              :value="Math.floor(Number(filled[name]))"
              @input="setNumber(name, ($event.target as HTMLInputElement).value)"
            />
            <input
              class="il-input il-input--num"
              :aria-label="`Значение ${name}, можно дробное`"
              inputmode="decimal"
              :value="String(filled[name])"
              @change="setNumber(name, ($event.target as HTMLInputElement).value)"
            />
          </div>
        </div>

        <div v-for="s in args.selects" :key="`s-${s.name}`" class="il-field">
          <span class="il-label">{{ s.name }}</span>
          <SegmentedControl
            :model-value="String(filled[s.name])"
            :label="`Значение ${s.name}`"
            :options="s.keys.map((k) => ({ value: k, label: k }))"
            @update:model-value="setValue(s.name, String($event))"
          />
        </div>

        <div v-for="name in args.texts" :key="`t-${name}`" class="il-field">
          <label class="il-label" :for="`il-text-${name}`">{{ name }}</label>
          <input
            :id="`il-text-${name}`"
            class="il-input"
            :value="String(filled[name])"
            spellcheck="false"
            autocomplete="off"
            @input="setValue(name, ($event.target as HTMLInputElement).value.slice(0, 40))"
          />
        </div>
      </div>

      <div class="il-result" :data-error="output.error ? 'yes' : 'no'">
        <span class="il-label">{{ output.error ? 'ошибка разбора' : 'format(…)' }}</span>
        <p v-if="output.error" class="il-result__v">{{ output.error }}</p>
        <p v-else class="il-result__v" :dir="dir" :lang="locale">{{ output.text }}</p>
      </div>

      <div v-if="categories" class="il-cats">
        <span class="il-label">категории {{ categories.type === 'plural' ? 'числа' : 'порядковые' }} в локали {{ locale }}</span>
        <div class="il-chips">
          <span
            v-for="item in categories.items"
            :key="item.c"
            class="il-chip"
            :data-on="item.on ? 'yes' : 'no'"
            :data-has="item.has ? 'yes' : 'no'"
          >{{ item.c }}<span v-if="!item.has" class="il-chip__miss"> · нет ветки</span></span>
        </div>
        <Md class="il-cats__note" :text="categoryNote" />
      </div>

      <div v-if="rows.length" class="il-tree" role="list" aria-label="Дерево сообщения">
        <span class="il-label">parse(…) — дерево</span>
        <div
          v-for="r in rows"
          :key="r.key"
          class="il-row"
          role="listitem"
          :data-kind="r.kind"
          :data-live="r.live ? 'yes' : 'no'"
          :style="{ paddingInlineStart: `${10 + r.depth * 14}px` }"
        >
          <code class="il-row__label">{{ r.label }}</code>
          <span class="il-row__note">{{ r.note }}</span>
        </div>
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
.il-caption,
.il-cats__note {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.il-note :deep(code),
.il-caption :deep(code),
.il-cats__note :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
.il-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.il-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.il-message {
  font: inherit;
  color: inherit;
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.6;
  width: 100%;
  box-sizing: border-box;
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--surface);
  resize: vertical;
}
.il-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 14px 24px;
  align-items: flex-end;
  min-width: 0;
}
.il-controls > .il-field {
  max-width: 100%;
  overflow-x: auto;
}
.il-num {
  display: flex;
  gap: 10px;
  align-items: center;
}
.il-range {
  width: min(220px, 50vw);
  font: inherit;
  color: inherit;
  accent-color: var(--ink);
}
.il-input {
  font: inherit;
  color: inherit;
  font-family: var(--mono);
  min-width: 0;
  max-width: 12em;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--surface);
}
.il-input--num {
  max-width: 6em;
}

.il-result {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  border-radius: var(--r2);
  background: var(--tone-ok-bg);
  box-shadow: inset 3px 0 0 var(--tone-ok-line);
}
.il-result[data-error='yes'] {
  background: var(--tone-err-bg);
  box-shadow: inset 3px 0 0 var(--tone-err-line);
}
.il-result__v {
  margin: 0;
  font-size: var(--fs-6);
  line-height: 1.5;
  color: var(--ink);
  overflow-wrap: anywhere;
}
.il-result[data-error='yes'] .il-result__v {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--tone-err-text);
}

.il-cats {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.il-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.il-chip {
  padding: 3px 10px;
  border-radius: var(--r-full);
  background: var(--surface-2);
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--prose);
}
.il-chip[data-on='yes'] {
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
  box-shadow: inset 0 0 0 1px var(--tone-info-line);
  font-weight: 600;
}
.il-chip__miss {
  font-family: var(--font);
  font-size: var(--fs-2);
  color: var(--tone-warn-text);
}

.il-tree {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
  overflow-x: auto;
}
.il-tree > .il-label {
  margin-bottom: 6px;
}
.il-row {
  display: flex;
  gap: 12px;
  align-items: baseline;
  padding-block: 3px;
  padding-inline-end: 10px;
  border-radius: var(--r1);
  min-width: max-content;
}
.il-row__label {
  padding: 0;
  background: transparent;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--prose);
  white-space: pre;
}
.il-row[data-kind='branch'] .il-row__label,
.il-row[data-kind='option'] .il-row__label {
  font-weight: 600;
  color: var(--ink);
}
.il-row__note {
  font-size: var(--fs-2);
  color: var(--text-muted);
  white-space: nowrap;
}
.il-row[data-live='yes'] {
  background: var(--tone-ok-bg);
}
.il-row[data-live='yes'][data-kind='option'] {
  box-shadow: inset 3px 0 0 var(--tone-ok-line);
}
.il-row[data-live='yes'] .il-row__note {
  color: var(--tone-ok-text);
}
</style>
