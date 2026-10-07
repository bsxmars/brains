<script setup lang="ts">
/**
 * «Проверка ответа»: ответ WebAuthn со стенда — `clientDataJSON`, байты `authenticatorData`
 * по полям, биты флагов — и все проверки сервера построчно.
 *
 * Считает не компонент, а строки `AUTHDATA_CODE` и `VERIFY_CODE` из темы, собранные
 * `new Function` (`model/run.ts`). Те же строки напечатаны на странице и прогоняются
 * `tests/unit/passkeys.test.ts` против `@simplewebauthn/server`; там же закреплено, что каждый
 * сценарий получает вердикт, названный в его подписи, и что любой переключённый бит флагов
 * ломает подпись и у функции темы, и у библиотеки.
 *
 * Web Crypto асинхронный, поэтому вердикт считается после монтирования и на каждое изменение;
 * ответ устаревшего вызова отбрасывается по номеру. Без безопасного контекста `crypto.subtle`
 * нет — тогда демо так и говорит.
 */
import { computed, onMounted, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { FLAG_BITS, loadWebAuthn, runScenario, withFlags } from '../model/run';
import type { Check, PasskeyScenario, VerifyResult } from '../model/types';

const props = defineProps<{
  authDataCode: string;
  verifyCode: string;
  scenarios: PasskeyScenario[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const api = loadWebAuthn(props.authDataCode, props.verifyCode);
const reg = props.scenarios.find((s) => s.kind === 'create') ?? props.scenarios[0];

const picked = ref(props.scenarios[0].id);
const options = props.scenarios.map((s) => ({ value: s.id, label: s.label }));
const base = computed(() => props.scenarios.find((s) => s.id === picked.value) ?? props.scenarios[0]);

/** Байт флагов, который сейчас стоит в ответе. Меняется только у входа: у регистрации он внутри CBOR. */
const original = computed(() => api.b64url(base.value.cred.response.authenticatorData)[32]);
const flags = ref(original.value);
watch(
  base,
  () => {
    flags.value = original.value;
  },
  { flush: 'sync' },
);
const scenario = computed(() => (base.value.kind === 'get' ? withFlags(api, base.value, flags.value) : base.value));
const editable = computed(() => base.value.kind === 'get');

const bytes = computed(() => api.b64url(scenario.value.cred.response.authenticatorData));
const parsed = computed(() => api.parseAuthData(bytes.value));

/** Байты по полям — в том порядке, в каком их читает `parseAuthData`. */
const fields = computed(() => {
  const b = bytes.value;
  const out: { k: string; tone: string; from: number; to: number }[] = [
    { k: 'rpIdHash', tone: 'info', from: 0, to: 32 },
    { k: 'флаги', tone: 'warn', from: 32, to: 33 },
    { k: 'signCount', tone: 'ok', from: 33, to: 37 },
  ];
  if (parsed.value.flags.AT) {
    const idLen = (b[53] << 8) | b[54];
    out.push(
      { k: 'AAGUID', tone: 'dim', from: 37, to: 53 },
      { k: 'длина ID', tone: 'plain', from: 53, to: 55 },
      { k: 'credential ID', tone: 'dim', from: 55, to: 55 + idLen },
      { k: 'ключ COSE', tone: 'plain', from: 55 + idLen, to: b.length },
    );
  }
  return out.map((f) => ({ ...f, hex: api.hex(b.slice(f.from, f.to)), len: f.to - f.from }));
});

const clientData = computed(() => {
  const text = new TextDecoder().decode(api.b64url(scenario.value.cred.response.clientDataJSON));
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
});

const bits = computed(() =>
  FLAG_BITS.map((f) => ({ ...f, on: (flags.value & (1 << f.bit)) !== 0, changed: ((flags.value ^ original.value) & (1 << f.bit)) !== 0 })),
);
function toggle(bit: number) {
  if (!editable.value) return;
  flags.value ^= 1 << bit;
}
const flagsHex = computed(() => `0x${flags.value.toString(16).padStart(2, '0')}`);

const hasCrypto = ref(true);
const result = ref<VerifyResult | null>(null);
let ticket = 0;
async function update() {
  const my = ++ticket;
  if (!globalThis.crypto?.subtle) {
    hasCrypto.value = false;
    return;
  }
  const r = await runScenario(api, scenario.value, reg);
  if (my !== ticket) return;
  result.value = r;
}
onMounted(update);
watch(scenario, update);

/** Длинные значения в отчёте укорачиваются: хеш — до 12 знаков, остальное переносится. */
function show(v: Check['got']) {
  const s = String(v);
  return /^[0-9a-f]{64}$/.test(s) ? `${s.slice(0, 12)}…` : s;
}
const rows = computed(() => (result.value?.checks ?? []).map((c) => ({ ...c, ok: c.got === c.want, gotText: show(c.got), wantText: show(c.want) })));

const verdict = computed(() => {
  if (!hasCrypto.value) return { ok: false, text: 'В этом браузере нет `crypto.subtle` — страница открыта не в безопасном контексте.' };
  const r = result.value;
  if (!r) return { ok: false, text: 'Проверяем…' };
  const failed = r.checks.filter((c) => c.got !== c.want).map((c) => `\`${c.k}\``);
  if (r.ok) {
    return {
      ok: true,
      text: base.value.kind === 'create' ? '**Ключ принят.** Сервер сохраняет номер ключа, открытый ключ и счётчик.' : '**Вход разрешён.** Дальше — обычная сессия.',
    };
  }
  return { ok: false, text: `**Отказ.** Не сошлось: ${failed.join(', ')}.` };
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="picked" class="l-pills" label="Ответ" :options="options" />
    </template>

    <div class="pk-body">
      <Md class="pk-note" :text="base.note" />

      <div class="pk-split">
        <div class="pk-pane">
          <span class="pk-label">clientDataJSON — собрал браузер</span>
          <pre class="pk-code">{{ clientData }}</pre>
        </div>

        <div class="pk-pane">
          <span class="pk-label">authenticatorData — {{ bytes.length }} байт</span>
          <!-- eslint-disable vue/multiline-html-element-content-newline -- перенос строки дал бы пробел между полями -->
          <pre class="pk-code pk-hex"><span
            v-for="f in fields"
            :key="f.k"
            class="pk-field"
            :data-tone="f.tone"
            :title="`${f.k}: ${f.len} байт`"
          >{{ f.hex }}</span></pre>
          <!-- eslint-enable vue/multiline-html-element-content-newline -->
          <ul class="pk-legend">
            <li v-for="f in fields" :key="f.k" :data-tone="f.tone">
              <span class="pk-swatch" />{{ f.k }} · {{ f.len }}
            </li>
          </ul>
        </div>
      </div>

      <div class="pk-flags">
        <span class="pk-label">байт флагов {{ flagsHex }} · счётчик {{ parsed.signCount }}</span>
        <div class="pk-bits" role="group" aria-label="Биты флагов, от старшего к младшему">
          <component
            :is="editable ? 'button' : 'span'"
            v-for="b in bits"
            :key="b.bit"
            class="pk-bit"
            :type="editable ? 'button' : undefined"
            :data-on="b.on ? 'yes' : 'no'"
            :data-changed="b.changed ? 'yes' : 'no'"
            :data-edit="editable ? 'yes' : 'no'"
            :aria-pressed="editable ? b.on : undefined"
            :aria-label="`бит ${b.bit} ${b.name}`"
            @click="toggle(b.bit)"
          >
            <span class="pk-bit__name">{{ b.name }}</span>
            <span class="pk-bit__val">{{ b.on ? 1 : 0 }}</span>
          </component>
        </div>
      </div>

      <div class="pk-checks" role="table" aria-label="Проверки сервера">
        <div class="pk-checks__head" role="row">
          <span role="columnheader">проверка</span>
          <span role="columnheader">пришло</span>
          <span role="columnheader">ожидалось</span>
        </div>
        <div v-for="c in rows" :key="c.k" class="pk-checks__row" role="row" :data-ok="c.ok ? 'yes' : 'no'">
          <span role="cell" class="pk-checks__k">{{ c.k }}</span>
          <code role="cell">{{ c.gotText }}</code>
          <code role="cell">{{ c.wantText }}</code>
        </div>
      </div>

      <div class="pk-verdict" :data-ok="verdict.ok ? 'yes' : 'no'" role="status" aria-live="polite">
        <Md :text="verdict.text" />
      </div>

      <Md class="pk-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.pk-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.pk-note,
.pk-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.pk-note :deep(code),
.pk-caption :deep(code),
.pk-verdict :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}

.pk-split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 760px) {
  .pk-split {
    grid-template-columns: minmax(0, 1fr);
  }
}

.pk-pane,
.pk-flags {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.pk-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.pk-code {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.7;
  /* Подложка — общая для кода курса (`pre` в base.css, чернильная): цвета ниже — «на чернилах». */
  color: var(--code-fg);
  white-space: pre-wrap;
  word-break: break-all;
}
.pk-hex {
  letter-spacing: 0.02em;
}
.pk-field[data-tone='info'] {
  color: var(--tone-info-on-ink);
}
.pk-field[data-tone='warn'] {
  color: var(--tone-warn-on-ink);
  background: var(--warn-wash-on-ink);
}
.pk-field[data-tone='ok'] {
  color: var(--tone-ok-on-ink);
}
.pk-field[data-tone='dim'] {
  color: var(--ink-faint);
}
.pk-field + .pk-field {
  box-shadow: inset 1px 0 0 var(--ink-line);
}

.pk-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.pk-legend li {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.pk-swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 3px;
  background: var(--ink);
}
.pk-legend li[data-tone='info'] .pk-swatch {
  box-shadow: inset 0 0 0 3px var(--tone-info-on-ink);
}
.pk-legend li[data-tone='warn'] .pk-swatch {
  box-shadow: inset 0 0 0 3px var(--tone-warn-on-ink);
}
.pk-legend li[data-tone='ok'] .pk-swatch {
  box-shadow: inset 0 0 0 3px var(--tone-ok-on-ink);
}
.pk-legend li[data-tone='dim'] .pk-swatch {
  box-shadow: inset 0 0 0 3px var(--ink-faint);
}
.pk-legend li[data-tone='plain'] .pk-swatch {
  box-shadow: inset 0 0 0 3px var(--code-fg);
}

.pk-bits {
  display: grid;
  grid-template-columns: repeat(8, minmax(0, 1fr));
  gap: 6px;
}
.pk-bit {
  /* У `button` шрифт и цвет свои, браузерные, — в курсе таких нет. */
  font: inherit;
  color: inherit;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  min-width: 0;
  padding: 6px 0;
  border: 1px solid var(--hairline);
  border-radius: var(--r1);
  background: var(--surface);
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-muted);
}
.pk-bit[data-edit='yes'] {
  cursor: pointer;
}
.pk-bit[data-edit='yes']:focus-visible {
  outline: 2px solid var(--tone-info-line);
  outline-offset: 1px;
}
.pk-bit[data-on='yes'] {
  background: var(--tone-info-bg);
  border-color: var(--tone-info-line);
  color: var(--tone-info-text);
}
.pk-bit[data-changed='yes'] {
  background: var(--tone-warn-bg);
  border-color: var(--tone-warn-line);
  color: var(--tone-warn-text);
}
.pk-bit__name {
  font-size: var(--fs-2);
}
.pk-bit__val {
  font-weight: 600;
}

.pk-checks {
  /* Значения уже моноширинные на цветной строке: подложка строчного кода тут лишняя. */
  --inline-code-bg: transparent;
  display: flex;
  flex-direction: column;
  min-width: 0;
  font-size: var(--fs-3);
  color: var(--prose);
}
.pk-checks__head,
.pk-checks__row {
  display: grid;
  grid-template-columns: minmax(80px, 0.6fr) minmax(0, 1.2fr) minmax(0, 1.2fr);
  gap: 10px;
  padding: 6px 10px;
  align-items: baseline;
}
.pk-checks__head {
  font-family: var(--mono);
  font-size: var(--fs-2);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}
.pk-checks__row {
  border-radius: var(--r1);
}
.pk-checks__row + .pk-checks__row {
  margin-top: 4px;
}
.pk-checks__row[data-ok='yes'] {
  background: var(--tone-ok-bg);
}
.pk-checks__row[data-ok='no'] {
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}
.pk-checks__k {
  font-weight: 600;
}
.pk-checks code {
  min-width: 0;
  overflow-wrap: anywhere;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: inherit;
}

.pk-verdict {
  padding: 10px 14px;
  border-radius: var(--r2);
  font-size: var(--fs-3);
  line-height: 1.55;
}
.pk-verdict[data-ok='yes'] {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.pk-verdict[data-ok='no'] {
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}
</style>
