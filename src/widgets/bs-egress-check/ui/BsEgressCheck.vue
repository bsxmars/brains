<script setup lang="ts">
/**
 * «Можно ли серверу сходить по этому адресу»: адрес от читателя и ответ DNS, выбранный вручную, —
 * и решения двух проверок рядом: защитной (`EGRESS_CODE`) и чёрного списка строк
 * (`NAIVE_EGRESS_CODE`).
 *
 * Считает не компонент, а строки темы, собранные `new Function` (`model/run.ts`). Те же строки
 * напечатаны на странице и прогоняются тестом по таблице `EGRESS_CASES`. Хост разбирает
 * `new URL` браузера — тот же парсер, что у `fetch`, поэтому подстановки вроде `2130706433`
 * демо показывает такими, какими их увидит настоящий запрос.
 *
 * В сеть демо не ходит: DNS заменён выбором ответа. Сборка функций дешёвая, живёт в `setup`.
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { answerOf, decide, loadEgress, loadNaive } from '../model/run';
import type { DnsChoice, EgressCase } from '../model/types';

const props = defineProps<{
  code: string;
  naiveCode: string;
  cases: EgressCase[];
  choices: DnsChoice[];
  allowHosts: string[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const egress = loadEgress(props.code);
const naive = loadNaive(props.naiveCode);

const MODES = [
  { value: 'any', label: 'любой публичный' },
  { value: 'allow', label: 'только партнёр' },
];
const mode = ref('any');

const url = ref(props.cases[0].url);
const dnsId = ref(props.cases[0].dns);
const picked = ref(0);

function useCase(i: number) {
  picked.value = i;
  url.value = props.cases[i].url;
  dnsId.value = props.cases[i].dns;
}

function onInput() {
  picked.value = -1;
}

const STAGE: Record<string, string> = {
  url: 'шаг 1 · строка адреса',
  ip: 'шаг 2 · адрес-литерал',
  dns: 'шаг 2 · ответ DNS',
};

const result = computed(() =>
  decide(egress, naive, url.value.trim(), answerOf(props.choices, dnsId.value), mode.value === 'allow' ? props.allowHosts : undefined),
);

const safeView = computed(() => {
  const s = result.value.safe;
  if (s.ok) return { tone: 'ok', title: 'можно', sub: `соединение — на ${s.addresses.map((a) => `\`${a}\``).join(', ')}` };
  return { tone: 'err', title: 'нельзя', sub: `${STAGE[s.stage]}: ${s.reason}` };
});

const naiveView = computed(() => {
  const n = result.value.naive;
  return n.ok ? { tone: 'ok', title: 'можно', sub: n.reason } : { tone: 'err', title: 'нельзя', sub: n.reason };
});

const verdict = computed(() => {
  const { safe, naive: n } = result.value;
  if (!safe.ok && n.ok) return { tone: 'err', text: '**Чёрный список пропустит этот адрес**, хотя сервер попадёт туда, куда снаружи хода нет.' };
  if (safe.ok && !n.ok) return { tone: 'warn', text: 'Чёрный список строже защитной проверки — здесь он отказал бы публичному адресу.' };
  return { tone: 'dim', text: 'Здесь обе проверки согласны.' };
});

const hostLine = computed(() => {
  const r = result.value;
  if (r.host === null) return 'парсер не разобрал адрес';
  const raw = url.value.trim();
  const shown = r.host === '' ? '(пусто)' : `\`${r.host}\``;
  const rewritten = r.host !== '' && !raw.toLowerCase().includes(r.host) ? ' — парсер переписал хост' : '';
  return `\`hostname\` после разбора: ${shown}${rewritten}`;
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="mode" class="l-pills" label="Куда серверу можно ходить" :options="MODES" />
    </template>

    <div class="bs-eg-body">
      <div class="bs-eg-cases" role="group" aria-label="Готовые адреса">
        <button
          v-for="(c, i) in cases"
          :key="c.label"
          type="button"
          class="bs-eg-chip"
          :aria-pressed="picked === i"
          @click="useCase(i)"
        >
          {{ c.label }}
        </button>
      </div>

      <label class="bs-eg-field">
        <span class="bs-eg-label">
          адрес от пользователя<template v-if="mode === 'allow'"> · разрешены только {{ allowHosts.join(', ') }}</template>
        </span>
        <input v-model="url" class="bs-eg-input" type="text" spellcheck="false" autocomplete="off" @input="onInput" />
      </label>
      <Md class="bs-eg-host" :text="hostLine" />

      <div class="bs-eg-field">
        <span class="bs-eg-label">
          что ответит DNS на это имя<template v-if="result.literal"> — не спросят: хост уже IP-адрес</template>
        </span>
        <div class="bs-eg-cases" role="group" aria-label="Ответ DNS">
          <button
            v-for="d in choices"
            :key="d.id"
            type="button"
            class="bs-eg-chip bs-eg-chip--mono"
            :aria-pressed="dnsId === d.id"
            @click="dnsId = d.id"
          >
            {{ d.label }}
          </button>
        </div>
      </div>

      <div class="bs-eg-split">
        <div class="bs-eg-verdict" :data-tone="safeView.tone">
          <span class="bs-eg-label">защитная проверка · <code>checkOutgoing</code></span>
          <span class="bs-eg-title">{{ safeView.title }}</span>
          <Md class="bs-eg-sub" :text="safeView.sub" />
        </div>
        <div class="bs-eg-verdict" :data-tone="naiveView.tone">
          <span class="bs-eg-label">чёрный список · <code>naiveCheck</code></span>
          <span class="bs-eg-title">{{ naiveView.title }}</span>
          <Md class="bs-eg-sub" :text="naiveView.sub" />
        </div>
      </div>

      <div class="bs-eg-diff" :data-tone="verdict.tone">
        <Md :text="verdict.text" />
      </div>
    </div>

    <template #footer>
      <Md class="bs-eg-caption" :text="caption" />
    </template>
  </DemoFrame>
</template>

<style scoped>
.bs-eg-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
  min-width: 0;
}
.bs-eg-body :deep(code),
.bs-eg-caption :deep(code) {
  font-family: var(--mono);
  /* Не ниже ступени `--fs-2`: в подписи на `--fs-2` доля .92em давала 10.9px. */
  font-size: max(0.92em, var(--fs-2));
}

.bs-eg-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.bs-eg-label {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}
.bs-eg-label code {
  font-family: var(--mono);
}
.bs-eg-input {
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
.bs-eg-input:focus {
  outline: 2px solid var(--tone-info-line);
  outline-offset: 1px;
}
.bs-eg-host {
  font-size: var(--fs-2);
  line-height: 1.5;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

.bs-eg-cases {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.bs-eg-chip {
  font: inherit;
  color: inherit;
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-full);
  background: var(--surface);
  color: var(--chip-text);
  font-size: var(--fs-3);
  cursor: pointer;
  overflow-wrap: anywhere;
  text-align: start;
}
.bs-eg-chip--mono {
  font-family: var(--mono);
}
.bs-eg-chip:hover {
  border-color: var(--ink);
  color: var(--ink);
}
.bs-eg-chip[aria-pressed='true'] {
  border-color: var(--ink);
  background: var(--ink);
  color: var(--surface);
}

.bs-eg-split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
}
@media (max-width: 640px) {
  .bs-eg-split {
    grid-template-columns: minmax(0, 1fr);
  }
}
.bs-eg-verdict {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  border-radius: var(--r2);
  font-size: var(--fs-3);
  line-height: 1.5;
  min-width: 0;
}
.bs-eg-verdict .bs-eg-label {
  color: inherit;
}
.bs-eg-title {
  font-family: var(--mono);
  font-size: var(--fs-5);
  font-weight: 600;
}
.bs-eg-sub {
  font-size: var(--fs-2);
  overflow-wrap: anywhere;
}
.bs-eg-verdict[data-tone='ok'] {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.bs-eg-verdict[data-tone='err'] {
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}

.bs-eg-diff {
  padding: 10px 14px;
  border-radius: var(--r2);
  font-size: var(--fs-3);
  line-height: 1.55;
}
.bs-eg-diff[data-tone='err'] {
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}
.bs-eg-diff[data-tone='warn'] {
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.bs-eg-diff[data-tone='dim'] {
  background: var(--surface-2);
  color: var(--text-muted);
}

.bs-eg-caption {
  font-size: var(--fs-2);
  line-height: 1.55;
  color: var(--text-muted);
}

/* Код внутри мелкой подписи: базовое `code { font-size: .86em }` уводило его ниже 11px.
   Пол — ступень `--fs-2`. */
.bs-eg-host :deep(code),
.bs-eg-sub :deep(code) {
  font-size: max(0.86em, var(--fs-2));
}
</style>
