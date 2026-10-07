<script setup lang="ts">
/**
 * «Вход по шагам»: обмен authorization code + PKCE, снятый стендом в Chromium, и калькулятор
 * verifier → challenge.
 *
 * Шаги — литералы стенда (`FLOW_STEPS` в `data.ts` темы, собраны из сетевого журнала).
 * Challenge считает не компонент, а `pkceChallenge` из строки `PKCE_CODE` темы, собранной
 * `new Function` (`model/run.ts`), — та же строка напечатана на странице и сверяется
 * `tests/unit/authentication.test.ts` с вектором RFC 7636 и `node:crypto`. На шаге обмена
 * демо пересчитывает challenge от verifier из тела запроса и сравнивает с challenge из
 * запроса входа — ту же проверку делал сервер авторизации стенда.
 */
import { computed, onMounted, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import StepToolbar from '@/shared/ui/StepToolbar.vue';
import { Button } from '@/shared/ui';
import { loadAuth } from '../model/run';
import type { FlowStep } from '../model/types';

const props = defineProps<{
  jwtCode: string;
  pkceCode: string;
  steps: FlowStep[];
  /** Verifier стенда и challenge из его запроса входа. */
  stand: { verifier: string; challenge: string };
  /** Тестовый вектор RFC 7636: verifier, с которого открывается калькулятор. */
  rfcVerifier: string;
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const auth = loadAuth(props.jwtCode, props.pkceCode);
const hasCrypto = ref(true);

// ── Шаги ──
const at = ref(0);
const step = computed(() => props.steps[at.value]);
const counter = computed(() => `шаг ${at.value + 1} из ${props.steps.length}`);
const prev = () => (at.value = Math.max(0, at.value - 1));
const next = () => (at.value = Math.min(props.steps.length - 1, at.value + 1));
const reset = () => (at.value = 0);

/** Проверка провайдера на шаге обмена: SHA-256 от verifier стенда. */
const standCheck = ref('');

// ── Калькулятор ──
const verifier = ref(props.rfcVerifier);
const challenge = ref('');
const valid = computed(() => auth.isValidVerifier(verifier.value));

let ticket = 0;
async function recompute() {
  const my = ++ticket;
  if (!globalThis.crypto?.subtle) {
    hasCrypto.value = false;
    return;
  }
  const c = await auth.pkceChallenge(verifier.value);
  if (my === ticket) challenge.value = c;
}

onMounted(async () => {
  await recompute();
  if (globalThis.crypto?.subtle) standCheck.value = await auth.pkceChallenge(props.stand.verifier);
});
watch(verifier, recompute);

const fresh = () => {
  if (hasCrypto.value) verifier.value = auth.randomVerifier();
};
const useRfc = () => (verifier.value = props.rfcVerifier);

const calcLine = computed(() => {
  if (!hasCrypto.value) return 'В этом браузере нет `crypto.subtle` — страница открыта не по `https`.';
  const tail = verifier.value === props.rfcVerifier ? ' — это вектор из приложения B RFC 7636.' : '';
  const rule = valid.value
    ? `${verifier.value.length} знаков, алфавит допустимый`
    : `**не годится как verifier:** нужно 43–128 знаков из \`A–Z a–z 0–9 - . _ ~\`, а здесь ${verifier.value.length}`;
  return `${rule}${tail}`;
});

const checkLine = computed(() => {
  if (!standCheck.value) return '';
  const same = standCheck.value === props.stand.challenge;
  return `Провайдер считает \`BASE64URL(SHA256(code_verifier))\` = \`${standCheck.value}\` — ${
    same ? '**совпадает** с `code_challenge` из запроса входа. Код обменивается.' : '**не совпадает** с `code_challenge`.'
  }`;
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <StepToolbar :counter="counter" :at-start="at === 0" :at-end="at === steps.length - 1" @prev="prev" @next="next" @reset="reset" />
    </template>

    <div class="pf-body">
      <ol class="pf-map" aria-label="Шаги входа">
        <li v-for="(s, i) in steps" :key="s.id">
          <button type="button" class="pf-chip" :data-on="i === at ? 'yes' : i < at ? 'done' : 'no'" :aria-current="i === at ? 'step' : undefined" @click="at = i">
            {{ i + 1 }}. {{ s.title }}
          </button>
        </li>
      </ol>

      <section class="pf-step" :aria-label="step.title">
        <span class="pf-route">{{ step.route }}</span>
        <code class="pf-line">{{ step.line }}</code>
        <div class="pf-params">
          <div v-for="p in step.params" :key="p.k" class="pf-param" :data-hot="p.hot ? 'yes' : 'no'">
            <code class="pf-k">{{ p.k }}</code>
            <code class="pf-v">{{ p.v }}</code>
          </div>
        </div>
        <Md class="pf-note" :text="step.note" />
        <Md v-if="step.id === 'token' && checkLine" class="pf-check" :text="checkLine" />
      </section>

      <div class="pf-calc">
        <label class="pf-field">
          <span class="pf-label">code_verifier</span>
          <input v-model="verifier" class="pf-input" type="text" spellcheck="false" autocomplete="off" />
        </label>
        <div class="pf-actions">
          <Button variant="secondary" @click="fresh">новый случайный</Button>
          <Button variant="secondary" @click="useRfc">вектор RFC 7636</Button>
        </div>
        <div class="pf-out">
          <span class="pf-label">code_challenge = BASE64URL(SHA256(verifier))</span>
          <code class="pf-challenge">{{ challenge || '…' }}</code>
          <Md class="pf-rule" :data-ok="valid ? 'yes' : 'no'" :text="calcLine" />
        </div>
      </div>

      <Md class="pf-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.pf-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.pf-caption,
.pf-note,
.pf-check {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.pf-caption :deep(code),
.pf-note :deep(code),
.pf-check :deep(code),
.pf-rule :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
  overflow-wrap: anywhere;
}

.pf-map {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.pf-chip {
  font: inherit;
  color: inherit;
  padding: 4px 10px;
  border: 0;
  border-radius: var(--r-full);
  background: var(--surface-2);
  color: var(--text-muted);
  font-size: var(--fs-2);
  cursor: pointer;
}
.pf-chip[data-on='done'] {
  color: var(--prose);
}
.pf-chip[data-on='yes'] {
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
  box-shadow: inset 0 0 0 1px var(--tone-info-line);
}
.pf-chip:focus-visible {
  outline: 2px solid var(--tone-info-line);
  outline-offset: 1px;
}

.pf-step {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  padding: 14px 16px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.pf-route,
.pf-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.pf-line,
.pf-k,
.pf-v,
.pf-challenge {
  /* Подложка строчного кода из base.css здесь лишняя: строка и так на своей подложке. */
  padding: 0;
  background: none;
}
.pf-line {
  font-family: var(--mono);
  font-size: var(--fs-4);
  font-weight: 600;
  color: var(--ink);
  overflow-wrap: anywhere;
}
.pf-params {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.pf-param {
  display: grid;
  grid-template-columns: minmax(7em, 0.35fr) minmax(0, 1fr);
  gap: 10px;
  align-items: baseline;
  padding: 5px 10px;
  border-radius: var(--r2);
  background: var(--surface);
  font-size: var(--fs-3);
}
@media (max-width: 560px) {
  .pf-param {
    grid-template-columns: minmax(0, 1fr);
    gap: 2px;
  }
}
.pf-param[data-hot='yes'] {
  background: var(--tone-warn-bg);
}
.pf-k {
  font-family: var(--mono);
  color: var(--text-muted);
  overflow-wrap: anywhere;
}
.pf-param[data-hot='yes'] .pf-k {
  color: var(--tone-warn-text);
  font-weight: 600;
}
.pf-v {
  font-family: var(--mono);
  color: var(--ink);
  word-break: break-all;
}
.pf-check {
  padding: 8px 12px;
  border-radius: var(--r2);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}

.pf-calc {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px 16px;
  align-items: end;
  padding: 14px 16px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
@media (max-width: 760px) {
  .pf-calc {
    grid-template-columns: minmax(0, 1fr);
  }
}
.pf-field,
.pf-out {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.pf-out {
  grid-column: 1 / -1;
}
.pf-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.pf-input {
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
.pf-input:focus {
  outline: 2px solid var(--tone-info-line);
  outline-offset: 1px;
}
.pf-challenge {
  font-family: var(--mono);
  font-size: var(--fs-4);
  font-weight: 600;
  color: var(--tone-ok-text);
  word-break: break-all;
}
.pf-rule {
  font-size: var(--fs-2);
  line-height: 1.5;
  color: var(--text-muted);
}
.pf-rule[data-ok='no'] {
  color: var(--tone-err-text);
}
</style>
