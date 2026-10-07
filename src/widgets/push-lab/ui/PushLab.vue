<script setup lang="ts">
/**
 * «Конверт push»: текст шифруется для подписки, тело разложено по полям aes128gcm — то, что
 * видит push-сервис, — и браузер расшифровывает его своим ключом. Режимы портят дорогу:
 * байт изменён в пути, отправитель не знает `auth`, тело зашифровано для другой подписки.
 *
 * Считает не компонент, а строки `PUSH_CODE` и `VAPID_CODE` из темы, собранные `new Function`
 * (`model/run.ts`). Те же строки напечатаны на странице и сверяются `tests/unit/web-push.test.ts`
 * с примером RFC 8291 и пакетом `web-push`; там же прогоняется `runDemo` во всех режимах.
 *
 * Ключи подписки создаются в браузере читателя при монтировании. Web Crypto асинхронный,
 * поэтому ответ устаревшего вызова отбрасывается по номеру. Без безопасного контекста
 * `crypto.subtle` нет — тогда демо так и говорит.
 */
import { computed, onMounted, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { hex, loadPush, makeSubscription, runDemo } from '../model/run';
import type { DemoRun, DemoSubscription, PushMode } from '../model/types';

const props = defineProps<{
  pushCode: string;
  vapidCode: string;
  modes: { id: PushMode; label: string; note: string }[];
  defaultText: string;
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const api = loadPush(props.pushCode, props.vapidCode);

const mode = ref<PushMode>(props.modes[0].id);
const options = props.modes.map((m) => ({ value: m.id, label: m.label }));
const note = computed(() => props.modes.find((m) => m.id === mode.value)?.note ?? '');
const text = ref(props.defaultText);

const hasCrypto = ref(true);
const sub = ref<DemoSubscription | null>(null);
let other: DemoSubscription | null = null;
const run = ref<DemoRun | null>(null);

let ticket = 0;
async function update() {
  const my = ++ticket;
  if (!sub.value || !other) return;
  const r = await runDemo(api, sub.value, other, text.value, mode.value);
  if (my !== ticket) return;
  run.value = r;
}

async function newSubscription() {
  if (!globalThis.crypto?.subtle) {
    hasCrypto.value = false;
    return;
  }
  sub.value = await makeSubscription(api);
  other = await makeSubscription(api);
  await update();
}

onMounted(newSubscription);
watch([mode, text], update);

const LIMIT = 4096;
const size = computed(() => {
  const r = run.value;
  if (!r) return '';
  const over = r.body.length > LIMIT;
  return `Текст — ${r.textBytes} байт UTF-8, тело — ${r.body.length} байт${over ? `: больше ${LIMIT}, push-сервис его не примет` : ` из ${LIMIT} допустимых`}.`;
});

/** Тело по полям — то, что push-сервис получает в POST и может разглядеть. */
const fields = computed(() => {
  const r = run.value;
  if (!r) return [];
  return r.parts.map((p) => {
    const bytes = r.body.slice(p.from, p.to);
    const at = r.flipped !== null && r.flipped >= p.from && r.flipped < p.to ? (r.flipped - p.from) * 2 : -1;
    const h = hex(bytes);
    return {
      ...p,
      len: p.to - p.from,
      before: at < 0 ? h : h.slice(0, at),
      hit: at < 0 ? '' : h.slice(at, at + 2),
      after: at < 0 ? '' : h.slice(at + 2),
    };
  });
});

/** Итог в браузере: `state` красит плашку, `text` — строчная разметка, `out` — текст сообщения как есть. */
const verdict = computed<{ state: 'ok' | 'err' | 'wait'; text: string; out?: string }>(() => {
  if (!hasCrypto.value) return { state: 'err', text: 'В этом браузере нет `crypto.subtle` — страница открыта не в безопасном контексте.' };
  const r = run.value;
  if (!r) return { state: 'wait', text: 'Создаём ключи подписки…' };
  if (r.result.ok) return { state: 'ok', text: '**Расшифровано** — Service Worker получит этот текст в `event.data`:', out: r.result.text };
  return { state: 'err', text: `**Отказ.** \`decryptPush\` бросил \`${r.result.error}\` — события с текстом не будет.` };
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="mode" class="l-pills" label="Дорога" :options="options" />
    </template>

    <div class="wp-body">
      <Md class="wp-note" :text="note" />

      <label class="wp-input">
        <span class="wp-label">текст сообщения — его знает только ваш сервер</span>
        <input v-model="text" type="text" spellcheck="false" autocomplete="off" />
      </label>

      <div v-if="sub" class="wp-sub">
        <span class="wp-label">подписка браузера</span>
        <code>p256dh: {{ sub.keys.p256dh }}</code>
        <code>auth: {{ sub.keys.auth }}</code>
        <button type="button" class="wp-btn" @click="newSubscription">Новая подписка</button>
      </div>

      <div class="wp-pane">
        <span class="wp-label">тело POST — так его видит push-сервис</span>
        <!-- eslint-disable vue/multiline-html-element-content-newline -- перенос строки дал бы пробел между полями -->
        <pre class="wp-code"><span
          v-for="f in fields"
          :key="f.k"
          class="wp-field"
          :data-tone="f.tone"
          :title="`${f.k}: ${f.len} байт`"
        >{{ f.before }}<mark v-if="f.hit" class="wp-hit">{{ f.hit }}</mark>{{ f.after }}</span></pre>
        <!-- eslint-enable vue/multiline-html-element-content-newline -->
        <ul class="wp-legend">
          <li v-for="f in fields" :key="f.k" :data-tone="f.tone"><span class="wp-swatch" />{{ f.k }} · {{ f.len }}</li>
        </ul>
        <span class="wp-size">{{ size }}</span>
      </div>

      <div class="wp-verdict" :data-state="verdict.state" role="status" aria-live="polite">
        <span class="wp-label">браузер расшифровывает</span>
        <Md :text="verdict.text" />
        <code v-if="verdict.out !== undefined" class="wp-out">{{ verdict.out }}</code>
      </div>

      <Md class="wp-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.wp-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.wp-note,
.wp-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.wp-note :deep(code),
.wp-caption :deep(code),
.wp-verdict :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
.wp-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.wp-input {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.wp-input input {
  font: inherit;
  color: inherit;
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r1);
  background: var(--surface);
  font-family: var(--mono);
  font-size: var(--fs-3);
}
.wp-input input:focus-visible {
  outline: 2px solid var(--tone-info-line);
  outline-offset: 1px;
}

.wp-sub {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px 14px;
  min-width: 0;
  font-size: var(--fs-3);
  color: var(--prose);
}
.wp-sub code {
  font-family: var(--mono);
  font-size: var(--fs-2);
  overflow-wrap: anywhere;
  min-width: 0;
}
.wp-btn {
  font: inherit;
  color: inherit;
  padding: 4px 12px;
  border: 1px solid var(--border-strong);
  border-radius: var(--r-full);
  background: var(--surface);
  font-family: var(--mono);
  font-size: var(--fs-2);
  cursor: pointer;
}
.wp-btn:focus-visible {
  outline: 2px solid var(--tone-info-line);
  outline-offset: 1px;
}

.wp-pane,
.wp-verdict {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.wp-code {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.7;
  /* Подложка — общая для кода курса (`pre` в base.css, чернильная): цвета ниже — «на чернилах». */
  color: var(--code-fg);
  white-space: pre-wrap;
  word-break: break-all;
}
.wp-field[data-tone='info'] {
  color: var(--tone-info-on-ink);
}
.wp-field[data-tone='ok'] {
  color: var(--tone-ok-on-ink);
}
.wp-field[data-tone='warn'] {
  color: var(--tone-warn-on-ink);
}
.wp-field[data-tone='dim'] {
  color: var(--ink-faint);
}
.wp-field + .wp-field {
  box-shadow: inset 1px 0 0 var(--ink-line);
}
.wp-hit {
  border-radius: 3px;
  background: var(--warn-wash-on-ink);
  color: var(--tone-warn-on-ink);
  box-shadow: inset 0 0 0 1px var(--tone-warn-accent);
}

.wp-legend {
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
.wp-legend li {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.wp-swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 3px;
  background: var(--ink);
}
.wp-legend li[data-tone='info'] .wp-swatch {
  box-shadow: inset 0 0 0 3px var(--tone-info-on-ink);
}
.wp-legend li[data-tone='ok'] .wp-swatch {
  box-shadow: inset 0 0 0 3px var(--tone-ok-on-ink);
}
.wp-legend li[data-tone='warn'] .wp-swatch {
  box-shadow: inset 0 0 0 3px var(--tone-warn-on-ink);
}
.wp-legend li[data-tone='dim'] .wp-swatch {
  box-shadow: inset 0 0 0 3px var(--ink-faint);
}
.wp-legend li[data-tone='plain'] .wp-swatch {
  box-shadow: inset 0 0 0 3px var(--code-fg);
}
.wp-size {
  font-size: var(--fs-3);
  color: var(--prose);
}

.wp-verdict {
  /* Значения моноширинные на цветной плашке: подложка строчного кода тут лишняя. */
  --inline-code-bg: transparent;
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
  overflow-wrap: anywhere;
}
.wp-verdict[data-state='ok'] {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.wp-verdict[data-state='err'] {
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}
.wp-out {
  font-family: var(--mono);
  font-size: var(--fs-3);
  white-space: pre-wrap;
  color: var(--ink);
}
</style>
