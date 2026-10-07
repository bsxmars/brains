<script setup lang="ts">
/**
 * «Сломайте цепочку»: какой лист, что прислал сервер, доверяет ли клиент корню и какое имя
 * в адресе. Показывает построенную цепочку, шаги проверки с накопленными ошибками, код в
 * отчёте и то, что на том же наборе ответил `tls.connect` Node на стенде.
 *
 * Решение принимает не компонент, а строка `VERIFY_CODE` из темы, собранная `new Function`
 * (`model/run.ts`); сертификаты — заменители `X509Certificate` из фактов стенда
 * (`toCertLike`). Тест `tests/unit/tls-certificates.test.ts` сверяет эту же строку с Node.
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { loadVerify, toCertLike } from '../model/run';
import type { CertFact, CertLike, StepInfo, VerifyError } from '../model/types';

const props = defineProps<{
  verifyCode: string;
  certs: CertFact[];
  verdicts: Record<string, string | null>;
  leaves: { id: string; label: string }[];
  sends: { id: string; label: string }[];
  hosts: string[];
  steps: StepInfo[];
  codeNotes: Record<string, string>;
  now: string;
  /** Подпись под демо. Строчная разметка. */
  caption: string;
  /** Откуда ответ Node. Строчная разметка. */
  standNote: string;
  /** Пояснение, когда Node и учебная проверка расходятся. Строчная разметка. */
  diffNote: string;
}>();

const verify = loadVerify(props.verifyCode);
const now = new Date(props.now);

/** Один заменитель на сертификат: проверка сравнивает их по ссылке (`chain.includes`). */
const like = new Map<string, CertLike>(props.certs.map((c) => [c.id, toCertLike(c)]));
const factOf = new Map<CertLike, CertFact>(props.certs.map((c) => [like.get(c.id)!, c]));
const cert = (id: string) => like.get(id)!;

const leaf = ref('shop');
const send = ref('leaf+int');
const trust = ref('trust');
const host = ref('shop.test');

const leafOptions = props.leaves.map((l) => ({ value: l.id, label: l.label }));
const sendOptions = props.sends.map((s) => ({ value: s.id, label: s.label }));
const trustOptions = [
  { value: 'trust', label: 'корень в хранилище' },
  { value: 'notrust', label: 'корня нет' },
];
const hostOptions = props.hosts.map((h) => ({ value: h, label: h }));

const presented = computed(() => [
  cert(leaf.value),
  ...(send.value.includes('int') ? [cert('int')] : []),
  ...(send.value.includes('root') ? [cert('root')] : []),
]);
const roots = computed(() => (trust.value === 'trust' ? [cert('root')] : []));

const result = computed(() =>
  verify({ presented: presented.value, roots: roots.value, host: host.value, now }),
);

const nodeCode = computed(() => props.verdicts[`${leaf.value}|${send.value}|${trust.value}|${host.value}`]);
const agree = computed(() => nodeCode.value === result.value.code);

interface ChainCard {
  key: string;
  fact: CertFact;
  from: string;
  bad: boolean;
}

const chainCards = computed<ChainCard[]>(() =>
  result.value.chain.map((c, i) => {
    const fact = factOf.get(c)!;
    const fromStore = roots.value.includes(c);
    return {
      key: `${i}-${fact.id}`,
      fact,
      from: i === 0 ? 'лист, прислал сервер' : fromStore ? 'из хранилища клиента' : 'прислал сервер',
      bad: result.value.errors.some((e) => e.depth === i && e.step !== 'chain'),
    };
  }),
);

/** Обрыв цепочки: кого искали и не нашли. */
const missing = computed(() => {
  const e = result.value.errors.find((x) => x.step === 'chain');
  if (!e) return null;
  const top = factOf.get(result.value.chain[e.depth])!;
  return top.subject === top.issuer ? `«${cn(top.subject)}» подписан сам собой и в хранилище не найден` : `издатель «${cn(top.issuer)}» не найден`;
});

function cn(dn: string): string {
  return dn.match(/CN=([^,]+)/)?.[1] ?? dn;
}

const day = (iso: string) => iso.slice(0, 10);

type StepState = 'ok' | 'err' | 'skip';

const stepRows = computed(() =>
  props.steps.map((s) => {
    const errs: VerifyError[] = result.value.errors.filter((e) => e.step === s.id);
    // Имя не сверяют при ошибках цепочки; подпись одинокого листа проверить нечем
    const skipped =
      (s.id === 'name' && result.value.errors.some((e) => e.step !== 'name')) ||
      (s.id === 'signature' && result.value.chain.length === 1);
    const state: StepState = errs.length ? 'err' : skipped ? 'skip' : 'ok';
    return { ...s, state, errs };
  }),
);

const lastError = computed(() => result.value.errors.at(-1));
const verdictText = computed(() =>
  result.value.code ? `**${result.value.code}**` : '**принят** — ошибок нет',
);
const nodeText = computed(() => (nodeCode.value ? `\`${nodeCode.value}\`` : 'принял'));
const note = computed(() => (result.value.code ? props.codeNotes[result.value.code] ?? '' : ''));
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="tl-controls">
        <SegmentedControl v-model="leaf" class="l-pills" label="Лист" :options="leafOptions" />
        <SegmentedControl v-model="send" class="l-pills" label="Сервер отдаёт" :options="sendOptions" />
        <SegmentedControl v-model="trust" class="l-pills" label="Клиент" :options="trustOptions" />
        <SegmentedControl v-model="host" class="l-pills" label="Адрес" :options="hostOptions" />
      </div>
    </template>

    <div class="tl-body">
      <div class="tl-split">
        <div class="tl-pane">
          <span class="tl-label">цепочка, которую собрала проверка</span>
          <ol class="tl-chain">
            <li v-if="missing" class="tl-cert tl-cert--missing">
              <span class="tl-cert__from">обрыв</span>
              <span class="tl-cert__name">{{ missing }}</span>
            </li>
            <li
              v-for="c in [...chainCards].reverse()"
              :key="c.key"
              class="tl-cert"
              :data-bad="c.bad ? 'yes' : 'no'"
            >
              <span class="tl-cert__from">{{ c.from }}</span>
              <span class="tl-cert__name">{{ cn(c.fact.subject) }}</span>
              <span class="tl-cert__row">выдал: {{ cn(c.fact.issuer) }}</span>
              <span class="tl-cert__row">срок: {{ day(c.fact.from) }} — {{ day(c.fact.to) }}</span>
              <span class="tl-cert__row">{{ c.fact.ca ? 'CA:TRUE' : 'CA:FALSE' }} · SAN: {{ c.fact.san ?? 'нет' }}</span>
            </li>
          </ol>
        </div>

        <div class="tl-pane">
          <span class="tl-label">шаги проверки на {{ host }}</span>
          <ol class="tl-steps">
            <li v-for="s in stepRows" :key="s.id" class="tl-step" :data-state="s.state">
              <span class="tl-step__mark" aria-hidden="true">{{ s.state === 'ok' ? '✓' : s.state === 'err' ? '✕' : '–' }}</span>
              <span class="tl-step__label">{{ s.label }}</span>
              <span class="tl-step__codes">
                <template v-if="s.state === 'skip'">не проверялось</template>
                <template v-else-if="s.state === 'ok'">в порядке</template>
                <code v-for="(e, i) in s.errs" v-else :key="i" :data-last="e === lastError ? 'yes' : 'no'">{{ e.code }}</code>
              </span>
            </li>
          </ol>

          <div class="tl-verdict" :data-ok="result.code ? 'no' : 'yes'">
            <Md class="tl-verdict__main" :text="`Учебная проверка: ${verdictText}`" />
            <Md class="tl-verdict__node" :text="`Node 24 на стенде: ${nodeText}`" />
          </div>
          <Md v-if="note" class="tl-note" :text="note" />
          <Md v-if="!agree" class="tl-note tl-note--diff" :text="diffNote" />
        </div>
      </div>

      <Md class="tl-caption" :text="caption" />
      <Md class="tl-stand" :text="standNote" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.tl-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 14px;
  align-items: center;
}
.tl-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.tl-split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 760px) {
  .tl-split {
    grid-template-columns: minmax(0, 1fr);
  }
}
.tl-pane {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.tl-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.tl-chain,
.tl-steps {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.tl-cert {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 10px 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
  border-left: 3px solid var(--tone-ok-line);
  min-width: 0;
}
.tl-cert[data-bad='yes'] {
  background: var(--tone-err-bg);
  border-left-color: var(--tone-err-line);
}
.tl-cert--missing {
  background: var(--tone-warn-bg);
  border-left: 3px dashed var(--tone-warn-line);
}
.tl-cert__from {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.tl-cert__name {
  font-size: var(--fs-4);
  font-weight: 600;
  color: var(--ink);
  overflow-wrap: anywhere;
}
.tl-cert__row {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--prose);
  overflow-wrap: anywhere;
}

.tl-step {
  display: grid;
  grid-template-columns: 1.6em minmax(0, 0.9fr) minmax(0, 1.4fr);
  gap: 8px;
  align-items: baseline;
  padding: 7px 10px;
  border-radius: var(--r2);
  background: var(--surface-2);
  font-size: var(--fs-3);
  color: var(--prose);
}
.tl-step__mark {
  font-weight: 700;
  color: var(--tone-ok-text);
}
.tl-step[data-state='err'] {
  background: var(--tone-err-bg);
}
.tl-step[data-state='err'] .tl-step__mark {
  color: var(--tone-err-text);
}
.tl-step[data-state='skip'] .tl-step__mark,
.tl-step[data-state='skip'] .tl-step__codes {
  color: var(--text-muted);
}
.tl-step__codes {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  min-width: 0;
}
.tl-step__codes code {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--tone-err-text);
  overflow-wrap: anywhere;
}
.tl-step__codes code[data-last='yes'] {
  font-weight: 700;
  text-decoration: underline;
}

.tl-verdict {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border-radius: var(--r3);
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
  font-size: var(--fs-3);
  overflow-wrap: anywhere;
}
.tl-verdict[data-ok='yes'] {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.tl-verdict__node {
  color: var(--prose);
}
.tl-note,
.tl-caption,
.tl-stand {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.tl-note--diff {
  padding: 8px 12px;
  border-radius: var(--r2);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.tl-stand {
  color: var(--text-muted);
}
.tl-note :deep(code),
.tl-caption :deep(code),
.tl-stand :deep(code),
.tl-verdict :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
</style>
