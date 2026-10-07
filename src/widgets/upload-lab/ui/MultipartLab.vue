<script setup lang="ts">
/**
 * «Тело multipart»: два поля формы — текст и файл — и тело запроса, которое из них выходит.
 *
 * Тело собирает строка `MULTIPART_CODE` из темы (`encodeMultipart`), обратно его разбирает
 * та же строка (`parseMultipart`). Обе сверены `tests/unit/uploads.test.ts` с байтами
 * `fetch(FormData)` из Node и Chromium и с `Response.formData()`. Компонент только печатает
 * байты (`printBytes`) и раскрашивает строки: граница, заголовок части, данные.
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { loadMultipart, printBytes } from '../model/run';
import type { MultipartEntry } from '../model/types';

const props = defineProps<{
  code: string;
  boundary: string;
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const api = loadMultipart(props.code);
const enc = new TextEncoder();

const title = ref('Отчёт за май');
const filename = ref('май.csv');
const content = ref('id;sum\n1;500\n');

const body = computed(() => {
  const entries: MultipartEntry[] = [
    ['title', title.value],
    ['report', { filename: filename.value, type: 'text/csv', bytes: enc.encode(content.value) }],
  ];
  return api.encodeMultipart(entries, props.boundary);
});

type Kind = 'boundary' | 'head' | 'data';
const lines = computed(() => {
  let inHead = false;
  return printBytes(body.value)
    .split('\n')
    .map((text, i) => {
      let kind: Kind = 'data';
      if (text.startsWith('--' + props.boundary)) {
        kind = 'boundary';
        inHead = !text.startsWith('--' + props.boundary + '--');
      } else if (inHead) {
        if (text === '␍␊') inHead = false;
        kind = 'head';
      }
      return { key: i, text, kind };
    });
});

const parsed = computed(() =>
  api.parseMultipart(body.value, props.boundary).map((p) =>
    'value' in p
      ? { name: p.name, what: `текст: ${JSON.stringify(p.value)}` }
      : { name: p.name, what: `файл ${JSON.stringify(p.filename)}, ${p.type}, ${p.bytes.length} байт` },
  ),
);

const summary = computed(
  () => `Тело — **${body.value.length} байт**, граница встречается ${lines.value.filter((l) => l.kind === 'boundary').length} раза. После разбора:`,
);
</script>

<template>
  <DemoFrame>
    <div class="mpl-body">
      <div class="mpl-fields">
        <label class="mpl-field">
          <span class="mpl-label">поле title</span>
          <textarea v-model="title" class="mpl-input" rows="2" spellcheck="false" />
        </label>
        <label class="mpl-field">
          <span class="mpl-label">имя файла</span>
          <input v-model="filename" class="mpl-input" type="text" spellcheck="false" />
        </label>
        <label class="mpl-field">
          <span class="mpl-label">содержимое файла</span>
          <textarea v-model="content" class="mpl-input" rows="2" spellcheck="false" />
        </label>
      </div>

      <div class="mpl-pane">
        <span class="mpl-label">тело запроса</span>
        <pre class="mpl-code"><span
          v-for="l in lines"
          :key="l.key"
          class="mpl-line"
          :data-kind="l.kind"
        >{{ l.text }}{{ '\n' }}</span></pre>
      </div>

      <div class="mpl-parsed">
        <Md class="mpl-text" :text="summary" />
        <div v-for="(p, i) in parsed" :key="i" class="mpl-part">
          <code class="mpl-name">{{ p.name }}</code>
          <span class="mpl-what">{{ p.what }}</span>
        </div>
      </div>

      <Md class="mpl-text" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.mpl-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.mpl-fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
}
.mpl-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.mpl-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.mpl-input {
  font: inherit;
  color: inherit;
  font-family: var(--mono);
  font-size: var(--fs-3);
  padding: 8px 10px;
  border: 1px solid var(--hairline);
  border-radius: var(--r2);
  background: var(--surface);
  resize: vertical;
  min-width: 0;
}
.mpl-pane {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.mpl-code {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.7;
  color: var(--code-fg);
  white-space: pre-wrap;
  word-break: break-all;
}
.mpl-line[data-kind='boundary'] {
  color: var(--tone-warn-on-ink);
  background: var(--warn-wash-on-ink);
}
.mpl-line[data-kind='head'] {
  color: var(--ink-faint);
}
.mpl-parsed {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.mpl-part {
  display: grid;
  grid-template-columns: minmax(70px, 0.3fr) minmax(0, 1fr);
  gap: 10px;
  align-items: baseline;
  padding: 6px 10px;
  border-radius: var(--r2);
  background: var(--surface-2);
  font-size: var(--fs-3);
  color: var(--prose);
}
.mpl-name {
  background: none;
  padding: 0;
  font-family: var(--mono);
  font-weight: 600;
  color: var(--ink);
}
.mpl-what {
  overflow-wrap: anywhere;
}
.mpl-text {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.mpl-text :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
</style>
