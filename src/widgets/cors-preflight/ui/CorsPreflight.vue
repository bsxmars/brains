<script setup lang="ts">
/**
 * Конструктор запроса: что сделает браузер — отправит сразу или сначала спросит.
 *
 * Демо отвечает на вопрос, который в CORS путают чаще всего: **preflight защищает не сервер.**
 * Он существует только для того, чтобы у сервера спросили согласия на то, чего раньше
 * сделать было **нельзя**. Всё, что умела форма в 2005 году, уходит без спроса до сих пор —
 * и отсюда же растёт дыра с `POST` и `text/plain`, которую демо показывает отдельно.
 *
 * ⚠️ Это **модель по спецификации** (WHATWG Fetch, «CORS protocol»), а не замер: показано то,
 * что браузер обязан сделать, а не то, что сделал конкретный браузер конкретной версии.
 * Сама логика живёт в `model/preflight.ts` и закрыта тестом — иначе демо и текст темы
 * разошлись бы молча.
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { classify, contentTypeValue, headerName } from '../model/preflight';
import type { CorsContentType, CorsCredentials, CorsHeader, CorsMethod } from '../model/types';

const method = ref<CorsMethod>('GET');
const contentType = ref<CorsContentType>('none');
const header = ref<CorsHeader>('none');
const credentials = ref<CorsCredentials>('omit');

const METHODS = [
  { value: 'GET', label: 'GET' },
  { value: 'POST', label: 'POST' },
  { value: 'PATCH', label: 'PATCH' },
  { value: 'DELETE', label: 'DELETE' },
];

const CONTENT_TYPES = [
  { value: 'none', label: 'не выставлен' },
  { value: 'urlencoded', label: 'urlencoded' },
  { value: 'multipart', label: 'multipart' },
  { value: 'text', label: 'text/plain' },
  { value: 'json', label: 'application/json' },
];

const HEADERS = [
  { value: 'none', label: 'нет' },
  { value: 'accept-language', label: 'Accept-Language' },
  { value: 'x-csrf-token', label: 'X-CSRF-Token' },
  { value: 'authorization', label: 'Authorization' },
];

const CREDENTIALS = [
  { value: 'omit', label: 'omit' },
  { value: 'include', label: 'include' },
];

const request = computed(() => ({
  method: method.value,
  contentType: contentType.value,
  header: header.value,
  credentials: credentials.value,
}));

const verdict = computed(() => classify(request.value));

/** Тот же запрос кодом — так его и увидят в проекте. */
const snippet = computed(() => {
  const lines: string[] = ["await fetch('https://api.example.com/v1/orders/42', {"];
  lines.push(`  method: '${method.value}',`);

  const headers: string[] = [];
  if (contentType.value !== 'none') {
    headers.push(`'Content-Type': '${contentTypeValue(contentType.value)}'`);
  }
  if (header.value !== 'none') headers.push(`'${headerName(header.value)}': '…'`);
  if (headers.length) lines.push(`  headers: { ${headers.join(', ')} },`);

  lines.push(`  credentials: '${credentials.value}',`);
  if (method.value !== 'GET') lines.push("  body: '{\"status\":\"paid\"}',");
  lines.push('})');
  return lines.join('\n');
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="controls">
        <div class="control">
          <span class="t-label">метод</span>
          <SegmentedControl v-model="method" class="l-pills" label="Метод запроса" :options="METHODS" />
        </div>
        <div class="control">
          <span class="t-label">content-type</span>
          <SegmentedControl
            v-model="contentType"
            class="l-pills"
            label="Заголовок Content-Type"
            :options="CONTENT_TYPES"
          />
        </div>
        <div class="control">
          <span class="t-label">свой заголовок</span>
          <SegmentedControl
            v-model="header"
            class="l-pills"
            label="Дополнительный заголовок"
            :options="HEADERS"
          />
        </div>
        <div class="control">
          <span class="t-label">credentials</span>
          <SegmentedControl
            v-model="credentials"
            class="l-pills"
            label="Режим credentials"
            :options="CREDENTIALS"
          />
        </div>
      </div>
    </template>

    <div class="body">
      <pre class="snippet">{{ snippet }}</pre>

      <div class="verdict" :data-tone="verdict.simple ? 'warn' : 'info'">
        <span class="verdict__head">{{
          verdict.simple ? 'Простой запрос — уходит немедленно' : 'Непростой запрос — сначала preflight'
        }}</span>
        <span class="verdict__sub">{{
          verdict.simple
            ? 'Разрешения никто не спрашивает: ровно это умела форма ещё до CORS'
            : 'Браузер сам отправит OPTIONS и дождётся явного «да»'
        }}</span>
      </div>

      <div v-if="verdict.reasons.length" class="block">
        <span class="t-label">почему не простой</span>
        <div class="reasons">
          <div v-for="reason in verdict.reasons" :key="reason.what" class="reason">
            <Md class="reason__what" :text="reason.what" />
            <Md class="reason__why" :text="reason.why" />
          </div>
        </div>
      </div>

      <div v-if="verdict.optionsRequest.length" class="block">
        <span class="t-label">что уйдёт до настоящего запроса</span>
        <pre class="options">{{ verdict.optionsRequest.join('\n') }}</pre>
      </div>

      <div class="block">
        <span class="t-label">чем сервер обязан ответить</span>
        <div class="headers">
          <div v-for="item in verdict.responseHeaders" :key="item.name" class="header-row">
            <div class="header-row__line" data-code>{{ item.name }}: {{ item.value }}</div>
            <Md class="header-row__why" :text="item.why" />
          </div>
        </div>
      </div>

      <div class="block">
        <span class="t-label">что из этого следует</span>
        <Md v-for="note in verdict.notes" :key="note" class="note" :text="note" />
      </div>
    </div>

    <template #footer>
      <div class="disclaimer">
        Это <b>модель по спецификации</b> (WHATWG Fetch, раздел «CORS protocol»), а не замер:
        показано, что браузер обязан сделать, а не то, что сделал конкретный браузер. Логика
        вынесена в отдельный модуль и закрыта юнит-тестом, поэтому демо и текст темы разойтись
        не могут. Соседнее демо с политикой — наоборот, настоящий браузерный прогон.
      </div>
    </template>
  </DemoFrame>
</template>

<style scoped>
.controls {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.control {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.body {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 22px 20px;
}

.block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.snippet,
.options {
  font-size: var(--fs-3);
  line-height: 1.7;
  padding: 14px 16px;
}

.verdict {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 14px 16px;
  border-radius: var(--r2);
  transition: all 0.2s;
}
.verdict__head {
  font-family: var(--mono);
  font-size: var(--fs-5);
}
.verdict__sub {
  font-size: var(--fs-4);
  line-height: 1.5;
}
.verdict[data-tone='warn'] {
  border: 1px solid var(--tone-warn-line);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.verdict[data-tone='warn'] .verdict__head {
  color: var(--tone-warn-strong);
}
.verdict[data-tone='info'] {
  border: 1px solid var(--tone-info-line);
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
}
.verdict[data-tone='info'] .verdict__head {
  color: var(--tone-info-strong);
}

.reasons {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.reason {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding-left: 12px;
  border-left: 2px solid var(--tone-info-line);
}
.reason__what {
  font-size: var(--fs-5);
  color: var(--ink);
}
.reason__why {
  font-size: var(--fs-4);
  line-height: 1.55;
  color: var(--text-muted);
}

.headers {
  display: flex;
  flex-direction: column;
  gap: 11px;
}
.header-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.header-row__line {
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.5;
  color: var(--tone-ok-text);
  overflow-wrap: anywhere;
}
.header-row__why {
  font-size: var(--fs-4);
  line-height: 1.55;
  color: var(--text-muted);
}

.note {
  font-size: var(--fs-5);
  line-height: 1.6;
  color: var(--prose);
}

.disclaimer {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}
</style>
