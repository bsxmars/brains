<script setup lang="ts">
/**
 * Живая рамка с собственной политикой — **не таблица, а настоящий браузерный прогон.**
 *
 * Внутри `<iframe srcdoc>` лежит отдельный документ со своим
 * `<meta http-equiv="Content-Security-Policy">` и шестью пробами: инлайн-скрипт, скрипт
 * с nonce, обработчик в атрибуте, `eval`, внешний скрипт и скрипт, созданный из JS.
 * Читатель переключает набор директив — документ пересобирается, и **решение принимает
 * сам браузер**, а страница показывает его результат: что выполнилось и какая директива
 * что заблокировала (из событий `securitypolicyviolation` внутри рамки).
 *
 * Ценность именно в этом: таблица «что разрешает `unsafe-inline`» может устареть или
 * оказаться враньём, а рамка показывает то, что ваш браузер делает прямо сейчас.
 *
 * ⚠️ Демо ничего не отправляет в сеть. Внешний скрипт указывает на хост, которого нет ни
 * в одном наборе, поэтому он блокируется **до** сетевого запроса; динамический скрипт
 * собирается из `blob:` прямо в рамке. Почему репортёр и стили стоят выше мета-тега —
 * в `model/sandbox.ts` и в подвале демо.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button, SegmentedControl } from '@/shared/ui';
import { CSP_OPTIONS, CSP_PROBES, buildSandboxDoc } from '../model/sandbox';
import type { CspViolation } from '../model/types';

interface SandboxMessage {
  __csp?: unknown;
  ran?: unknown;
  violations?: unknown;
}

const optionKey = ref(CSP_OPTIONS[0].key);
const option = computed(() => CSP_OPTIONS.find((o) => o.key === optionKey.value) ?? CSP_OPTIONS[0]);
const options = CSP_OPTIONS.map((o) => ({ value: o.key, label: o.label }));

const nonce = ref('');
const runId = ref(0);
const status = ref<'idle' | 'running' | 'done'>('idle');
const ran = ref<string[]>([]);
const violations = ref<CspViolation[]>([]);
const frame = ref<HTMLIFrameElement | null>(null);

let timer = 0;

/**
 * Новый nonce на каждый прогон — как и обязан работать nonce: статичное значение защиты
 * не даёт вовсе, атакующий просто читает его со страницы.
 */
function makeNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let raw = '';
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/[^A-Za-z0-9]/g, '').slice(0, 22);
}

/** Пока остров не гидратирован, nonce неизвестен: в разметке с сервера его быть не должно. */
const appliedPolicy = computed(() =>
  option.value.policy.replace(/\{NONCE\}/g, nonce.value || 'СЛУЧАЙНОЕ-ЗНАЧЕНИЕ'),
);

const doc = computed(() => (nonce.value ? buildSandboxDoc(option.value.policy, nonce.value) : ''));

function run() {
  nonce.value = makeNonce();
  ran.value = [];
  violations.value = [];
  status.value = 'running';
  runId.value += 1;

  // Страховка: если рамка почему-то не отчиталась, демо не должно навсегда зависнуть
  // на «идёт прогон» — пустой результат честнее бесконечного ожидания.
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    if (status.value === 'running') status.value = 'done';
  }, 2500);
}

function onMessage(event: MessageEvent) {
  const data = event.data as SandboxMessage | null;
  if (!data || data.__csp !== true) return;
  // Сообщение принимается только от своей рамки.
  if (frame.value && event.source !== frame.value.contentWindow) return;

  ran.value = Array.isArray(data.ran) ? (data.ran as string[]) : [];
  violations.value = Array.isArray(data.violations) ? (data.violations as CspViolation[]) : [];
  status.value = 'done';
}

function stateOf(id: string): 'ran' | 'blocked' | 'pending' {
  if (status.value !== 'done') return 'pending';
  return ran.value.includes(id) ? 'ran' : 'blocked';
}

const LABEL: Record<'ran' | 'blocked' | 'pending', string> = {
  ran: 'выполнился',
  blocked: 'не выполнился',
  pending: 'идёт прогон',
};

onMounted(() => {
  window.addEventListener('message', onMessage);
  run();
});

onBeforeUnmount(() => {
  window.removeEventListener('message', onMessage);
  window.clearTimeout(timer);
});

watch(optionKey, run);
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="bar">
        <span class="t-label">политику применяет ваш браузер · это не таблица</span>
        <SegmentedControl
          v-model="optionKey"
          class="l-pills"
          label="Набор директив script-src"
          :options="options"
        />
      </div>
    </template>

    <div class="body">
      <div class="policy" data-code>Content-Security-Policy: {{ appliedPolicy }}</div>

      <Md class="about" :text="option.about" />

      <div class="frame-wrap">
        <iframe
          :key="runId"
          ref="frame"
          class="sandbox"
          title="Документ со своей политикой безопасности"
          :srcdoc="doc"
        ></iframe>
      </div>

      <div class="block">
        <span class="t-label">что произошло внутри рамки</span>
        <div class="probes">
          <div v-for="probe in CSP_PROBES" :key="probe.id" class="probe" :data-state="stateOf(probe.id)">
            <div class="probe__head">
              <span class="probe__name">{{ probe.label }}</span>
              <span class="probe__state">{{ LABEL[stateOf(probe.id)] }}</span>
            </div>
            <span class="probe__hint">{{ probe.hint }}</span>
          </div>
        </div>
      </div>

      <div class="block">
        <span class="t-label">о чём отчитался сам браузер</span>
        <div v-if="status !== 'done'" class="empty">идёт прогон…</div>
        <div v-else-if="!violations.length" class="empty">
          Ни одного нарушения: политика разрешила всё, что рамка попробовала сделать.
        </div>
        <div v-else class="violations">
          <div v-for="(violation, i) in violations" :key="i" class="violation" data-code>
            <span class="violation__directive">{{ violation.directive }}</span>
            <span class="violation__blocked">{{ violation.blocked }}</span>
          </div>
        </div>
      </div>

      <div class="rerun">
        <Button variant="secondary" @click="run">прогнать заново</Button>
        <span class="rerun__note">новый nonce на каждый прогон</span>
      </div>
    </div>

    <template #footer>
      <div class="disclaimer">
        Внутри рамки — отдельный документ со своей политикой; всё, что вы видите, решил
        <b>ваш браузер</b>, а не автор темы. Две вещи в нём стоят <b>выше</b> мета-тега
        намеренно: слушатель нарушений и стили. Политика из <code>&lt;meta&gt;</code> применяется
        только к тому, что идёт в документе <b>после</b> тега, — иначе под
        <code>default-src 'none'</code> замолчал бы и сам слушатель. Это тонкое место разобрано
        ниже отдельно. В сеть демо не ходит: чужой хост не разрешён ни одним набором, и запрос
        не отправляется вовсе.
      </div>
    </template>
  </DemoFrame>
</template>

<style scoped>
.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}

.body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 22px 20px;
}

.block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.policy {
  padding: 12px 15px;
  border-radius: var(--r2);
  background: var(--ink);
  color: var(--code-fg);
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.about {
  font-size: var(--fs-5);
  line-height: 1.6;
  color: var(--prose);
}

.frame-wrap {
  min-width: 0;
  border-radius: var(--r2);
  border: 1px solid var(--border);
  overflow: hidden;
}
.sandbox {
  display: block;
  width: 100%;
  max-width: 100%;
  height: 130px;
  border: 0;
  background: var(--surface-2);
}

.probes {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr));
  gap: 10px;
}
.probe {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 11px 13px;
  border-radius: var(--r2);
  border: 1px solid var(--border);
  background: var(--surface-2);
  min-width: 0;
  transition: all 0.2s;
}
.probe[data-state='ran'] {
  border-color: var(--tone-err-line);
  background: var(--tone-err-bg);
}
.probe[data-state='blocked'] {
  border-color: var(--tone-ok-line);
  background: var(--tone-ok-bg);
}
.probe__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.probe__name {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
}
.probe__state {
  font-family: var(--mono);
  font-size: var(--fs-2);
  white-space: nowrap;
  color: var(--text-faint);
}
.probe[data-state='ran'] .probe__state {
  color: var(--tone-err-strong);
}
.probe[data-state='blocked'] .probe__state {
  color: var(--tone-ok-strong);
}
.probe__hint {
  font-size: var(--fs-4);
  line-height: 1.5;
  color: var(--text-muted);
}

.violations {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.violation {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px 10px;
  padding: 9px 12px;
  border-radius: var(--r1);
  border: 1px solid var(--tone-warn-line);
  background: var(--tone-warn-bg);
  font-family: var(--mono);
  min-width: 0;
}
.violation__directive {
  font-size: var(--fs-3);
  color: var(--tone-warn-strong);
}
.violation__blocked {
  font-size: var(--fs-2);
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

.empty {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}

.rerun {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}
.rerun__note {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-faint);
}

.disclaimer {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}
</style>
