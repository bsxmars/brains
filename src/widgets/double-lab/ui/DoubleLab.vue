<script setup lang="ts">
/**
 * «Число по битам»: 64 бита double, три поля, формула, точное десятичное значение
 * и шаг до соседнего числа. Бит можно переключить — число соберётся обратно.
 *
 * Считает не компонент, а строка `DOUBLE_CODE` из темы, собранная `new Function`
 * (`model/run.ts`): `decodeDouble`, `encodeDouble`, `fieldsToExact`, `exactDecimal`, `nextAway`.
 * Та же строка напечатана на странице и прогоняется `tests/unit/numbers.test.ts`
 * против `Float64Array`, `toFixed` и `BigInt`. Компонент только раскладывает биты по клеткам.
 */
import { computed, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { bitString, fieldsFromBits, fieldsFromHex, loadDouble, show } from '../model/run';
import type { DoublePreset } from '../model/types';

const props = defineProps<{
  code: string;
  presets: DoublePreset[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const api = loadDouble(props.code);

const picked = ref(props.presets[0].id);
const options = props.presets.map((p) => ({ value: p.id, label: p.label }));

const bits = ref(bitString(fieldsFromHex(props.presets[0].hex)));
const typed = ref('');
const typedError = ref(false);
/** Строка, из которой получены текущие биты. Опечатка в поле её не меняет — биты ведь тоже прежние. */
const applied = ref('');

watch(picked, (id) => {
  const preset = props.presets.find((p) => p.id === id);
  if (preset) {
    bits.value = bitString(fieldsFromHex(preset.hex));
    typed.value = '';
    typedError.value = false;
    applied.value = '';
  }
});

function applyTyped() {
  const text = typed.value.trim();
  if (!text) return;
  const x = Number(text);
  // `Number` молча делает NaN из любой опечатки: NaN принимаем, только если его и просили.
  typedError.value = Number.isNaN(x) && text !== 'NaN';
  if (typedError.value) return;
  applied.value = text;
  bits.value = bitString(api.decodeDouble(x));
}

function flip(i: number) {
  applied.value = '';
  const b = bits.value;
  bits.value = b.slice(0, i) + (b[i] === '1' ? '0' : '1') + b.slice(i + 1);
}

const fields = computed(() => fieldsFromBits(bits.value));
const x = computed(() => api.encodeDouble(fields.value));

/** Что это за число: имя готового примера, если биты совпали, иначе — «своё». */
const title = computed(() => {
  const hex = BigInt(`0b${bits.value}`).toString(16).padStart(16, '0');
  const preset = props.presets.find((p) => p.hex === hex);
  if (preset) return preset.label;
  return applied.value ? `Number('${applied.value}')` : 'своё число';
});

const hexDigits = computed(() => fields.value.mantissa.toString(16).padStart(13, '0'));

/** Мантисса по четыре бита — так её легче сверить с шестнадцатеричной записью. */
const nibbles = computed(() =>
  Array.from({ length: 13 }, (_, n) => ({
    hex: hexDigits.value[n],
    bits: Array.from({ length: 4 }, (_, k) => 12 + n * 4 + k),
  })),
);
const exponentBits = Array.from({ length: 11 }, (_, k) => 1 + k);

const kind = computed(() => {
  const f = fields.value;
  if (f.exponent === 0x7ff) return f.mantissa === 0n ? 'бесконечность' : 'NaN';
  if (f.exponent === 0) return f.mantissa === 0n ? 'ноль' : 'субнормальное число';
  return 'обычное число';
});

const fieldRows = computed(() => {
  const f = fields.value;
  const special = f.exponent === 0 || f.exponent === 0x7ff;
  return [
    { name: 'знак', value: String(f.sign), note: f.sign ? 'минус' : 'плюс', tone: 'warn' },
    {
      name: 'порядок',
      value: String(f.exponent),
      note: special ? (f.exponent === 0 ? 'служебный: без неявной единицы' : 'служебный: не число') : `${f.exponent} − 1023 = ${f.exponent - 1023}`,
      tone: 'info',
    },
    { name: 'мантисса', value: `0x${hexDigits.value}`, note: '52 бита', tone: 'ok' },
  ];
});

const formula = computed(() => {
  const f = fields.value;
  const s = f.sign ? '−' : '+';
  if (f.exponent === 0x7ff) {
    return f.mantissa === 0n
      ? `Порядок из одних единиц и пустая мантисса — это \`${s === '−' ? '-' : ''}Infinity\`.`
      : 'Порядок из одних единиц и непустая мантисса — это `NaN`. Какие именно биты в мантиссе, для JS неважно: все `NaN` ведут себя одинаково.';
  }
  const exact = api.fieldsToExact(f);
  const mant = `0x${hexDigits.value}`;
  const head =
    f.exponent === 0
      ? `\`${s}(${mant} / 2^52) · 2^-1022\``
      : `\`${s}(1 + ${mant} / 2^52) · 2^${f.exponent - 1023}\``;
  if (!exact) return head;
  return `${head} = \`${s}${exact.m} · 2^${exact.e}\``;
});

const exact = computed(() => api.exactDecimal(x.value));
const printed = computed(() => show(x.value));
const sameAsPrinted = computed(() => exact.value === printed.value);

const neighbour = computed(() => {
  const v = x.value;
  if (!Number.isFinite(v)) return null;
  const next = api.nextAway(v);
  return { next: show(next), step: show(Math.abs(next - v)) };
});

const neighbourText = computed(() => {
  const n = neighbour.value;
  if (!n) return 'У бесконечности и `NaN` соседей нет.';
  if (n.next === 'Infinity' || n.next === '-Infinity') {
    return `Следующего числа нет: дальше от нуля — сразу \`${n.next}\`.`;
  }
  return `Соседний double дальше от нуля — \`${n.next}\`, шаг сетки здесь \`${n.step}\`. Всё, что попадёт между ними, округлится к одному из двух.`;
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="dl-tools">
        <SegmentedControl v-model="picked" class="l-pills" label="Число" :options="options" />
        <label class="dl-own">
          <span class="dl-label">своё число</span>
          <input
            v-model="typed"
            class="dl-input"
            type="text"
            inputmode="decimal"
            spellcheck="false"
            placeholder="например, 0.7"
            aria-label="Своё число: строка, которую разберёт Number()"
            @keydown.enter.prevent="applyTyped"
            @change="applyTyped"
          />
        </label>
      </div>
    </template>

    <div class="dl-body">
      <div class="dl-head">
        <code class="dl-expr">{{ title }}</code>
        <span class="dl-kind">{{ kind }}</span>
        <span v-if="typedError" class="dl-error">Number() не разобрал эту строку — получился бы NaN.</span>
      </div>

      <div class="dl-bits" role="group" aria-label="64 бита числа; нажатие переключает бит">
        <div class="dl-field" data-tone="warn">
          <span class="dl-label">знак</span>
          <div class="dl-run">
            <button
              type="button"
              class="dl-bit"
              :data-on="bits[0] === '1' ? 'yes' : 'no'"
              :aria-pressed="bits[0] === '1'"
              aria-label="Бит 63, знак"
              @click="flip(0)"
            >
{{ bits[0] }}
</button>
          </div>
        </div>

        <div class="dl-field" data-tone="info">
          <span class="dl-label">порядок · 11 бит</span>
          <div class="dl-run">
            <button
              v-for="i in exponentBits"
              :key="i"
              type="button"
              class="dl-bit"
              :data-on="bits[i] === '1' ? 'yes' : 'no'"
              :aria-pressed="bits[i] === '1'"
              :aria-label="`Бит ${63 - i}, порядок`"
              @click="flip(i)"
            >
{{ bits[i] }}
</button>
          </div>
        </div>

        <div class="dl-field dl-field--wide" data-tone="ok">
          <span class="dl-label">мантисса · 52 бита</span>
          <div class="dl-run dl-run--wrap">
            <div v-for="(nib, n) in nibbles" :key="n" class="dl-nibble">
              <div class="dl-run">
                <button
                  v-for="i in nib.bits"
                  :key="i"
                  type="button"
                  class="dl-bit"
                  :data-on="bits[i] === '1' ? 'yes' : 'no'"
                  :aria-pressed="bits[i] === '1'"
                  :aria-label="`Бит ${63 - i}, мантисса`"
                  @click="flip(i)"
                >
{{ bits[i] }}
</button>
              </div>
              <code class="dl-hex">{{ nib.hex }}</code>
            </div>
          </div>
        </div>
      </div>

      <div class="dl-fields">
        <div v-for="f in fieldRows" :key="f.name" class="dl-row" :data-tone="f.tone">
          <span class="dl-row__name">{{ f.name }}</span>
          <code class="dl-row__value">{{ f.value }}</code>
          <span class="dl-row__note">{{ f.note }}</span>
        </div>
      </div>

      <Md class="dl-formula" :text="formula" />

      <div class="dl-values">
        <div class="dl-value">
          <span class="dl-label">печатается как</span>
          <code class="dl-printed">{{ printed }}</code>
        </div>
        <div class="dl-value dl-value--exact">
          <span class="dl-label">хранится точно{{ sameAsPrinted ? ' — то же самое' : '' }}</span>
          <pre class="dl-exact">{{ exact }}</pre>
        </div>
      </div>

      <Md class="dl-note" :text="neighbourText" />

      <Md class="dl-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.dl-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 16px;
  align-items: center;
}
.dl-own {
  display: flex;
  gap: 8px;
  align-items: center;
  min-width: 0;
}
.dl-input {
  box-sizing: border-box;
  width: 11em;
  max-width: 100%;
  padding: 6px 9px;
  border: 1px solid var(--border-strong);
  border-radius: var(--r1);
  background: var(--surface);
  font: inherit;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: inherit;
}
.dl-input:focus {
  outline: 2px solid var(--tone-info-strong);
  outline-offset: 1px;
}

.dl-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}

.dl-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.dl-head {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  align-items: baseline;
}
.dl-expr {
  font-family: var(--mono);
  font-size: var(--fs-5);
  font-weight: 600;
  color: var(--ink);
  overflow-wrap: anywhere;
}
.dl-kind {
  font-size: var(--fs-3);
  color: var(--text-muted);
}
.dl-error {
  font-size: var(--fs-3);
  color: var(--tone-err-text);
}

.dl-bits {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 16px;
  align-items: flex-start;
}
.dl-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.dl-field--wide {
  flex: 1 1 260px;
}
.dl-run {
  display: flex;
  gap: 2px;
}
.dl-run--wrap {
  flex-wrap: wrap;
  gap: 6px 8px;
}
.dl-nibble {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
}
.dl-hex {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--tone-ok-text);
}

.dl-bit {
  box-sizing: border-box;
  width: 1.55em;
  height: 1.9em;
  padding: 0;
  border: 1px solid var(--tone-line);
  border-radius: var(--r1);
  background: var(--tone-bg);
  font: inherit;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--tone-text);
  cursor: pointer;
}
.dl-bit[data-on='yes'] {
  border-color: var(--tone-strong);
  background: var(--tone-strong);
  color: var(--on-ink);
}
.dl-bit:focus-visible {
  outline: 2px solid var(--ink);
  outline-offset: 1px;
}
[data-tone='warn'] {
  --tone-bg: var(--tone-warn-bg);
  --tone-line: var(--tone-warn-line);
  --tone-text: var(--tone-warn-text);
  --tone-strong: var(--tone-warn-strong);
}
[data-tone='info'] {
  --tone-bg: var(--tone-info-bg);
  --tone-line: var(--tone-info-line);
  --tone-text: var(--tone-info-text);
  --tone-strong: var(--tone-info-strong);
}
[data-tone='ok'] {
  --tone-bg: var(--tone-ok-bg);
  --tone-line: var(--tone-ok-line);
  --tone-text: var(--tone-ok-text);
  --tone-strong: var(--tone-ok-strong);
}

.dl-fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 8px;
}
.dl-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  align-items: baseline;
  padding: 8px 12px;
  border-radius: var(--r2);
  background: var(--tone-bg);
  font-size: var(--fs-3);
  color: var(--prose);
}
.dl-row__name {
  color: var(--tone-text);
  font-weight: 600;
}
.dl-row__value {
  font-family: var(--mono);
  color: var(--ink);
  overflow-wrap: anywhere;
}
.dl-row__note {
  font-size: var(--fs-2);
  color: var(--text-muted);
}

.dl-formula,
.dl-note,
.dl-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
  overflow-wrap: anywhere;
}
.dl-formula :deep(code),
.dl-note :deep(code),
.dl-caption :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}

.dl-values {
  display: grid;
  grid-template-columns: minmax(0, 0.6fr) minmax(0, 1.4fr);
  gap: 12px;
  align-items: start;
}
@media (max-width: 760px) {
  .dl-values {
    grid-template-columns: minmax(0, 1fr);
  }
}
.dl-value {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.dl-printed {
  font-family: var(--mono);
  font-size: var(--fs-5);
  color: var(--ink);
  overflow-wrap: anywhere;
}
.dl-exact {
  margin: 0;
  max-height: 12em;
  overflow-y: auto;
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.6;
  /* Подложка — общая для кода курса (`pre` в base.css, чернильная): цвет — «на чернилах». */
  color: var(--code-fg);
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
