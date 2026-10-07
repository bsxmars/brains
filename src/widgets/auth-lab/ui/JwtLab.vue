<script setup lang="ts">
/**
 * «Разбери JWT»: три части токена, разбор заголовка и нагрузки и проверка подписи ключом
 * из поля ввода.
 *
 * Проверяет не компонент, а строка `JWT_CODE` из темы, собранная `new Function`
 * (`model/run.ts`): `verifyJwt` и `signJwt` на Web Crypto. Та же строка напечатана на странице
 * и прогоняется `tests/unit/authentication.test.ts` против RFC 7515 A.1 и `node:crypto`;
 * там же закреплено, что каждый вариант отвечает так, как сказано в его подписи.
 *
 * Web Crypto асинхронный, поэтому вердикт считается после монтирования и на каждое изменение
 * варианта или ключа; ответ устаревшего вызова отбрасывается по номеру.
 */
import { computed, onMounted, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { loadAuth } from '../model/run';
import type { JwtVariant, VerifyResult } from '../model/types';

const props = defineProps<{
  jwtCode: string;
  pkceCode: string;
  variants: JwtVariant[];
  /** Ключ, которым подписан настоящий токен: значение поля при открытии. */
  secret: string;
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const auth = loadAuth(props.jwtCode, props.pkceCode);
const hasCrypto = ref(true);

const picked = ref(props.variants[0].id);
const options = props.variants.map((v) => ({ value: v.id, label: v.label }));
const variant = computed(() => props.variants.find((v) => v.id === picked.value) ?? props.variants[0]);
const key = ref(props.secret);

/** Переподписанный вариант считается асинхронно — до этого показываем исходный токен. */
const token = ref(props.variants[0].token ?? '');
const result = ref<VerifyResult | null>(null);
const original = (props.variants[0].token ?? '').split('.');

let ticket = 0;
async function update() {
  const my = ++ticket;
  if (!globalThis.crypto?.subtle) {
    hasCrypto.value = false;
    return;
  }
  const v = variant.value;
  const t = v.token ?? (await auth.signJwt(v.resign ?? {}, key.value));
  const r = await auth.verifyJwt(t, key.value, v.at);
  if (my !== ticket) return;
  token.value = t;
  result.value = r;
}

onMounted(update);
watch([picked, key], update);

const NAMES = ['заголовок', 'нагрузка', 'подпись'];
const parts = computed(() =>
  token.value.split('.').map((text, i) => ({ text, name: NAMES[i] ?? '', changed: text !== original[i] })),
);

function decode(i: number): Record<string, unknown> | null {
  const text = token.value.split('.')[i] ?? '';
  try {
    return JSON.parse(new TextDecoder().decode(auth.fromB64url(text))) as Record<string, unknown>;
  } catch {
    return null;
  }
}
const show = (o: Record<string, unknown> | null) => (o ? JSON.stringify(o, null, 2) : '— не разбирается —');
const header = computed(() => show(decode(0)));
const payload = computed(() => show(decode(1)));

const verdict = computed(() => {
  if (!hasCrypto.value) return { ok: false, text: 'В этом браузере нет `crypto.subtle` — страница открыта не по `https`.' };
  const r = result.value;
  if (!r) return { ok: false, text: 'Проверяем…' };
  if (r.ok) return { ok: true, text: `**Пустить.** \`sub\`: \`${String(r.payload.sub)}\`, \`scope\`: \`${String(r.payload.scope)}\`.` };
  return { ok: false, text: `**Отказ:** ${r.reason}.` };
});

const clock = computed(() => {
  const v = variant.value;
  const exp = Number(decode(1)?.exp ?? 0);
  return `часы проверки: \`${v.at}\` — ${exp && v.at >= exp ? 'после' : 'до'} \`exp\``;
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="picked" class="l-pills" label="Токен" :options="options" />
    </template>

    <div class="jl-body">
      <Md class="jl-note" :text="variant.note" />

      <div class="jl-token" aria-label="Токен по частям">
        <!-- eslint-disable vue/multiline-html-element-content-newline -- перенос строки внутри дал бы пробел между частями токена -->
        <template v-for="(p, i) in parts" :key="i"><span
          class="jl-part"
          :data-part="i"
          :data-changed="p.changed ? 'yes' : 'no'"
          :title="p.name"
        >{{ p.text || '(пусто)' }}</span><span v-if="i < parts.length - 1" class="jl-dot">.</span></template>
        <!-- eslint-enable vue/multiline-html-element-content-newline -->
      </div>

      <div class="jl-split">
        <div class="jl-pane">
          <span class="jl-label" data-part="0">заголовок</span>
          <pre class="jl-code">{{ header }}</pre>
        </div>
        <div class="jl-pane">
          <span class="jl-label" data-part="1">нагрузка</span>
          <pre class="jl-code">{{ payload }}</pre>
        </div>
      </div>

      <div class="jl-check">
        <label class="jl-field">
          <span class="jl-label">ключ сервера, HS256</span>
          <input v-model="key" class="jl-input" type="text" spellcheck="false" autocomplete="off" />
        </label>
        <div class="jl-verdict" :data-ok="verdict.ok ? 'yes' : 'no'" role="status" aria-live="polite">
          <Md :text="verdict.text" />
          <Md class="jl-clock" :text="clock" />
        </div>
      </div>

      <Md class="jl-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.jl-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.jl-note,
.jl-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.jl-note :deep(code),
.jl-caption :deep(code),
.jl-verdict :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}

.jl-token {
  padding: 12px 14px;
  border-radius: var(--r3);
  background: var(--surface-2);
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.7;
  color: var(--ink);
  word-break: break-all;
}
.jl-part[data-part='0'],
.jl-label[data-part='0'] {
  color: var(--tone-info-text);
}
.jl-part[data-part='1'],
.jl-label[data-part='1'] {
  color: var(--tone-ok-text);
}
.jl-part[data-part='2'] {
  color: var(--tone-warn-text);
}
.jl-part[data-changed='yes'] {
  border-radius: 3px;
  background: var(--tone-err-bg);
  box-shadow: inset 0 -2px 0 var(--tone-err-line);
}
.jl-dot {
  color: var(--text-muted);
  font-weight: 600;
}

.jl-split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 760px) {
  .jl-split {
    grid-template-columns: minmax(0, 1fr);
  }
}
.jl-pane {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.jl-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.jl-code {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.65;
  /* Подложка — общая для кода курса (`pre` в base.css, чернильная). */
  color: var(--code-fg);
  white-space: pre-wrap;
  word-break: break-all;
}

.jl-check {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
  gap: 16px;
  align-items: stretch;
}
@media (max-width: 760px) {
  .jl-check {
    grid-template-columns: minmax(0, 1fr);
  }
}
.jl-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.jl-input {
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
.jl-input:focus {
  outline: 2px solid var(--tone-info-line);
  outline-offset: 1px;
}
.jl-verdict {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  padding: 10px 14px;
  border-radius: var(--r2);
  font-size: var(--fs-3);
  line-height: 1.55;
}
.jl-verdict[data-ok='yes'] {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.jl-verdict[data-ok='no'] {
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}
.jl-clock {
  font-size: var(--fs-2);
  color: var(--text-muted);
}
</style>
