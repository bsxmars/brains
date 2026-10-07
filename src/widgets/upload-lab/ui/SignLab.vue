<script setup lang="ts">
/**
 * «Ссылка с подписью»: `presign` из `PRESIGN_CODE` подписывает пример из документации AWS,
 * `verifyPresigned` из той же строки проверяет запрос так, как это делает хранилище.
 *
 * Подпись примера совпадает с опубликованной AWS — это проверяет `tests/unit/uploads.test.ts`,
 * как и каждый вариант подмены ниже. Компонент только подменяет часть запроса и печатает итог.
 */
import { computed, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { loadPresign } from '../model/run';
import type { PresignInput, PresignResult } from '../model/types';

const props = defineProps<{
  code: string;
  example: PresignInput;
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const api = loadPresign(props.code);

type Variant = 'same' | 'path' | 'method' | 'expires' | 'late';
const options: { value: Variant; label: string }[] = [
  { value: 'same', label: 'как подписано' },
  { value: 'path', label: 'другой файл' },
  { value: 'method', label: 'PUT вместо GET' },
  { value: 'expires', label: 'срок продлён' },
  { value: 'late', label: 'через 25 часов' },
];
const variant = ref<Variant>('same');

const signed = ref<PresignResult | null>(null);
const verdict = ref<{ ok: boolean; reason: string } | null>(null);
const sent = ref({ method: '', url: '' });

/** Начало срока примера — `X-Amz-Date`; проверяем через час или через 25 часов. */
const start = Date.UTC(2013, 4, 24);

async function run() {
  const s = signed.value ?? (signed.value = await api.presign(props.example));
  let method = props.example.method;
  let url = s.url;
  if (variant.value === 'path') url = url.replace('/test.txt', '/salary.xlsx');
  if (variant.value === 'method') method = 'PUT';
  if (variant.value === 'expires') url = url.replace('X-Amz-Expires=86400', 'X-Amz-Expires=604800');
  const now = start + (variant.value === 'late' ? 25 : 1) * 3600_000;
  const v = await api.verifyPresigned(method, url, () => props.example.secret, now);
  sent.value = { method, url };
  verdict.value = v;
}
watch(variant, run, { immediate: true });

const verdictText = computed(() =>
  verdict.value
    ? `Хранилище получило \`${sent.value.method}\` ${variant.value === 'late' ? 'через 25 часов после подписи' : 'через час после подписи'}: **${verdict.value.reason}** → ${verdict.value.ok ? '`200`' : '`403`'}.`
    : '',
);
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="variant" label="Запрос в хранилище" :options="options" />
    </template>

    <div class="sl-body">
      <div class="sl-pane">
        <span class="sl-label">запрос</span>
        <pre class="sl-code">{{ sent.method }} {{ sent.url }}</pre>
      </div>

      <div v-if="signed" class="sl-grid">
        <div class="sl-pane">
          <span class="sl-label">канонический запрос</span>
          <pre class="sl-code">{{ signed.canonicalRequest }}</pre>
        </div>
        <div class="sl-pane">
          <span class="sl-label">строка для подписи</span>
          <pre class="sl-code">{{ signed.stringToSign }}</pre>
        </div>
      </div>

      <div class="sl-verdict" :data-ok="verdict?.ok ? 'yes' : 'no'">
        <Md :text="verdictText" />
      </div>

      <Md class="sl-text" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.sl-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
  min-width: 0;
}
.sl-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 14px;
}
@media (max-width: 760px) {
  .sl-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
.sl-pane {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.sl-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.sl-code {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.7;
  color: var(--code-fg);
  white-space: pre-wrap;
  word-break: break-all;
}
.sl-verdict {
  padding: 10px 14px;
  border-radius: var(--r2);
  font-size: var(--fs-3);
  line-height: 1.6;
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.sl-verdict[data-ok='no'] {
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}
.sl-verdict :deep(code),
.sl-text :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
.sl-text {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
</style>
