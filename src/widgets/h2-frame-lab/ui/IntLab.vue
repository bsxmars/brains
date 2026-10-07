<script setup lang="ts">
/**
 * «Целое с префиксом»: число и ширина префикса → байты по RFC 7541 §5.1, с раскладкой по битам.
 *
 * Кодирует и раскодирует не компонент, а `encodeInt` и `decodeInt` — строка `HPACK_INT_CODE`
 * из темы, собранная `new Function` (`model/run.ts`) и сверенная тестом с RFC 7541, C.1.
 * Компонент только раскладывает готовые байты по битам — это подпись, а не расчёт.
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { loadH2 } from '../model/run';

const props = defineProps<{
  frameCode: string;
  intCode: string;
  tableCode: string;
  decodeCode: string;
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const api = loadH2(props.frameCode, props.intCode, props.tableCode, props.decodeCode);

const prefix = ref('5');
const prefixOptions = ['4', '5', '6', '7', '8'].map((v) => ({ value: v, label: `${v} бит` }));
const raw = ref('1337');

const value = computed(() => {
  const n = Number(raw.value.trim());
  return Number.isInteger(n) && n >= 0 && n <= 2 ** 31 - 1 ? n : null;
});
const n = computed(() => Number(prefix.value));
const bytes = computed(() => (value.value === null ? [] : api.encodeInt(value.value, n.value)));
const back = computed(() => (bytes.value.length ? api.decodeInt(bytes.value, 0, n.value)[0] : null));

const rows = computed(() =>
  bytes.value.map((b, i) => {
    const bits = b.toString(2).padStart(8, '0');
    if (i === 0) {
      const head = bits.slice(0, 8 - n.value);
      const data = bits.slice(8 - n.value);
      const full = (b & (2 ** n.value - 1)) === 2 ** n.value - 1;
      return {
        key: i,
        hex: b.toString(16).padStart(2, '0'),
        lead: head,
        data,
        say: full ? `префикс полон (${2 ** n.value - 1}) — дальше байты продолжения` : `число целиком: ${b & (2 ** n.value - 1)}`,
      };
    }
    const more = (b & 128) !== 0;
    return {
      key: i,
      hex: b.toString(16).padStart(2, '0'),
      lead: bits[0],
      data: bits.slice(1),
      say: `${b & 127} · 128^${i - 1}${more ? ', дальше ещё байт' : ', последний'}`,
    };
  }),
);

const verdict = computed(() => {
  if (value.value === null) return 'Нужно целое от 0 до 2 147 483 647.';
  return `\`encodeInt(${value.value}, ${n.value})\` → ${bytes.value.length} байт; \`decodeInt\` читает обратно **${back.value}**.`;
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="prefix" class="l-pills" label="Префикс" :options="prefixOptions" />
    </template>

    <div class="il-body">
      <label class="il-field">
        <span class="il-label">число</span>
        <input v-model="raw" class="il-input" type="text" inputmode="numeric" spellcheck="false" autocomplete="off" />
      </label>

      <div v-if="rows.length" class="il-rows" role="table" aria-label="Байты числа">
        <div v-for="r in rows" :key="r.key" class="il-row" role="row">
          <code class="il-hex" role="cell">{{ r.hex }}</code>
          <code class="il-bits" role="cell"><span class="il-lead">{{ r.lead }}</span>{{ r.data }}</code>
          <span class="il-say" role="cell">{{ r.say }}</span>
        </div>
      </div>

      <Md class="il-verdict" :text="verdict" />
      <Md class="il-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.il-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
  min-width: 0;
}
.il-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-width: 16rem;
}
.il-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.il-input {
  /* У `input` шрифт и цвет свои, браузерные, — в курсе таких нет. */
  font: inherit;
  color: inherit;
  box-sizing: border-box;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--border-strong);
  border-radius: var(--r1);
  background: var(--surface);
  color: var(--ink);
  font-family: var(--mono);
  font-size: var(--fs-3);
}
.il-rows {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.il-row {
  display: grid;
  grid-template-columns: 2.4em 6.5em minmax(0, 1fr);
  gap: 12px;
  align-items: baseline;
  padding: 6px 10px;
  border-radius: var(--r2);
  background: var(--surface-2);
  font-size: var(--fs-3);
  color: var(--prose);
}
.il-hex,
.il-bits {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
}
.il-lead {
  color: var(--tone-warn-text);
  font-weight: 600;
}
.il-say {
  overflow-wrap: anywhere;
}
.il-verdict,
.il-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.il-verdict :deep(code),
.il-caption :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
</style>
