<script setup lang="ts">
/**
 * «Какая форма слова при числе»: операнды CLDR для введённого числа, категория по учебной
 * функции `pluralRu` и ответ `Intl.PluralRules('ru')` браузера рядом.
 *
 * Категорию и операнды считает строка `PLURAL_CODE` из темы (`model/run.ts`); та же строка
 * напечатана на странице и сверяется `tests/unit/unicode-intl.test.ts` с `Intl.PluralRules`.
 * Компонент берёт остаток от деления только для подписи — правило выбирает функция.
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { intlPlural, loadPlural } from '../model/run';
import type { NumberSample } from '../model/types';

const props = defineProps<{
  pluralCode: string;
  samples: NumberSample[];
  /** Форма слова для каждой категории: `one` → `файл`. */
  forms: Record<string, string>;
  /** Правило CLDR словами для каждой категории. */
  rules: Record<string, string>;
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const api = loadPlural(props.pluralCode);
const options = props.samples.map((s) => ({ value: s.value, label: s.label }));

const picked = ref(props.samples[0].value);
const text = ref(props.samples[0].label);

function pick(v: string) {
  picked.value = v;
  text.value = props.samples.find((s) => s.value === v)?.label ?? v;
}

function onInput(e: Event) {
  text.value = (e.target as HTMLInputElement).value.slice(0, 18);
}

/** Запись числа с точкой, как её понимает JS; запятую читателя принимаем тоже. */
const value = computed(() => {
  const v = text.value.trim().replace(',', '.');
  return /^-?\d{1,15}(\.\d{1,6})?$/.test(v) ? v : null;
});

const result = computed(() => {
  const v = value.value;
  if (v === null) return null;
  const { i, v: vis } = api.operands(v);
  const ours = api.pluralRu(v);
  const native = intlPlural(v);
  const shown = v.replace('.', ',');
  const naive = Number(v) === 1 ? 'файл' : 'файлов';
  return {
    rows: [
      { k: 'i', d: 'целая часть', v: String(i) },
      { k: 'v', d: 'цифр после запятой', v: String(vis) },
      { k: 'i % 10', d: 'последняя цифра', v: String(i % 10) },
      { k: 'i % 100', d: 'две последние', v: String(i % 100) },
    ],
    ours,
    native,
    same: ours === native,
    rule: props.rules[ours] ?? '',
    phrase: `${shown} ${props.forms[native] ?? '?'}`,
    naive: `${shown} ${naive}`,
    naiveOk: naive === props.forms[native],
  };
});

const verdict = computed(() => {
  const r = result.value;
  if (!r) return 'Введите число: цифры, по желанию минус и дробная часть через точку или запятую.';
  return r.same
    ? `\`pluralRu\` и \`Intl.PluralRules\` вашего браузера ответили одинаково: **${r.native}**.`
    : `**Расхождение:** \`pluralRu\` — ${r.ours}, \`Intl.PluralRules\` — ${r.native}.`;
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl :model-value="picked" class="l-pills" label="Число" :options="options" @update:model-value="pick(String($event))" />
    </template>

    <div class="pl-body">
      <div class="pl-inputs">
        <label class="pl-label" for="pl-input">число</label>
        <input id="pl-input" class="pl-input" :value="text" inputmode="decimal" spellcheck="false" autocomplete="off" @input="onInput" />
      </div>

      <div v-if="result" class="pl-grid">
        <div class="pl-ops">
          <div v-for="r in result.rows" :key="r.k" class="pl-op">
            <span class="pl-op__k">{{ r.k }}</span>
            <span class="pl-op__v">{{ r.v }}</span>
            <span class="pl-op__d">{{ r.d }}</span>
          </div>
        </div>

        <div class="pl-out">
          <div class="pl-cat">
            <span class="pl-label">категория</span>
            <span class="pl-cat__v">{{ result.ours }}</span>
            <span class="pl-cat__rule">{{ result.rule }}</span>
          </div>
          <div class="pl-phrase" data-ok="yes">
            <span class="pl-label">по правилам</span>
            <span class="pl-phrase__v">{{ result.phrase }}</span>
          </div>
          <div class="pl-phrase" :data-ok="result.naiveOk ? 'yes' : 'no'">
            <span class="pl-label">английская логика</span>
            <span class="pl-phrase__v">{{ result.naive }}</span>
          </div>
        </div>
      </div>

      <Md class="pl-verdict" :data-same="!result || result.same ? 'yes' : 'no'" :text="verdict" />
      <Md class="pl-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.pl-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.pl-caption,
.pl-verdict {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.pl-caption :deep(code),
.pl-verdict :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
.pl-verdict[data-same='no'] {
  color: var(--tone-warn-text);
}
.pl-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.pl-inputs {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 8px 12px;
  align-items: center;
}
.pl-input {
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

.pl-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 760px) {
  .pl-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

.pl-ops {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.pl-op {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border-radius: var(--r2);
  background: var(--surface-2);
  min-width: 0;
}
.pl-op__k {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.pl-op__v {
  font-family: var(--mono);
  font-size: var(--fs-6);
  font-weight: 600;
  color: var(--ink);
  overflow-wrap: anywhere;
}
.pl-op__d {
  font-size: var(--fs-2);
  color: var(--text-muted);
}

.pl-out {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.pl-cat,
.pl-phrase {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border-radius: var(--r2);
  background: var(--surface-2);
}
.pl-cat__v {
  font-family: var(--mono);
  font-size: var(--fs-6);
  font-weight: 600;
  color: var(--ink);
}
.pl-cat__rule {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--prose);
}
.pl-phrase__v {
  font-size: var(--fs-6);
  color: var(--ink);
  overflow-wrap: anywhere;
}
.pl-phrase[data-ok='yes'] {
  background: var(--tone-ok-bg);
  box-shadow: inset 3px 0 0 var(--tone-ok-line);
}
.pl-phrase[data-ok='no'] {
  background: var(--tone-err-bg);
  box-shadow: inset 3px 0 0 var(--tone-err-line);
}
</style>
