<script setup lang="ts">
/**
 * «Докачка»: учебный tus-клиент (`TUS_CLIENT_CODE`) грузит файл в учебный tus-сервер
 * (`TUS_SERVER_CODE`), сеть между ними один раз рвётся посреди PATCH (`makeLossyFetch`).
 *
 * Журнал запросов — настоящий: его пишут клиент и сервер из темы. Тест
 * `tests/unit/uploads.test.ts` сверяет ту же пару с `@tus/server` и `tus-js-client`
 * и проверяет, что при обрыве на 150 000 байт демо даёт ту же последовательность, что стенд.
 */
import { ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { loadTusClient, loadTusServer, makeLossyFetch } from '../model/run';
import type { TusLogRow } from '../model/types';

const props = defineProps<{
  clientCode: string;
  serverCode: string;
  /** Размер файла, байт. */
  size: number;
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const tusUpload = loadTusClient(props.clientCode);
const createTusServer = loadTusServer(props.serverCode);

const chunkOptions = [
  { value: '50000', label: 'кусок 50 000' },
  { value: '100000', label: 'кусок 100 000' },
  { value: String(props.size), label: 'весь файл' },
];
const chunk = ref('100000');
const cutAt = ref(150_000);

const log = ref<TusLogRow[]>([]);
const result = ref('');
let runId = 0;

async function run() {
  const id = ++runId;
  const server = createTusServer();
  const rows: TusLogRow[] = [];
  const file = new Uint8Array(props.size);
  for (let i = 0; i < file.length; i++) file[i] = (i * 7) & 255;
  let text: string;
  try {
    await tusUpload(makeLossyFetch(server, cutAt.value, rows), 'https://example.test/files', file, Number(chunk.value));
    const stored = [...server.uploads.values()][0];
    const same = stored.data.every((b, i) => b === file[i]);
    const body = rows.reduce((n, r) => n + r.sent, 0);
    text = `Файл собран ${same ? 'без ошибок' : '**с ошибкой**'}: ${rows.length} запросов, байт тела дошло до сервера — **${fmt(body)}** при файле в ${fmt(props.size)}.`;
  } catch (e) {
    text = `Загрузка не удалась: ${(e as Error).message}.`;
  }
  if (id !== runId) return;
  log.value = rows;
  result.value = text;
}

const fmt = (n: number) => n.toLocaleString('ru-RU');
watch([chunk, cutAt], run, { immediate: true });

const cutLabel = () => (cutAt.value >= props.size ? 'без обрыва' : `обрыв после ${fmt(cutAt.value)} байт тела`);
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="rl-tools">
        <SegmentedControl v-model="chunk" label="Размер куска" :options="chunkOptions" />
        <label class="rl-range">
          <span class="rl-label">{{ cutLabel() }}</span>
          <input
            v-model.number="cutAt"
            class="rl-input"
            type="range"
            min="10000"
            :max="size"
            step="10000"
            :aria-valuetext="cutLabel()"
          />
        </label>
      </div>
    </template>

    <div class="rl-body">
      <div class="rl-scroll">
        <div class="rl-table" role="table" aria-label="Журнал запросов загрузки">
          <div class="rl-row rl-row--head" role="row">
            <span role="columnheader">запрос</span>
            <span role="columnheader">Upload-Offset</span>
            <span role="columnheader">тело дошло</span>
            <span role="columnheader">ответ</span>
            <span role="columnheader">Upload-Offset в ответе</span>
          </div>
          <div
            v-for="(r, i) in log"
            :key="i"
            class="rl-row"
            role="row"
            :data-tone="r.status === null ? 'err' : r.status >= 400 ? 'warn' : r.method === 'HEAD' ? 'info' : 'ok'"
          >
            <code role="cell">{{ r.method }}</code>
            <code role="cell">{{ r.offset || '—' }}</code>
            <code role="cell">{{ r.method === 'PATCH' ? fmt(r.sent) : '—' }}</code>
            <span role="cell">{{ r.status === null ? 'нет: связь оборвалась' : r.status }}</span>
            <code role="cell">{{ r.resOffset || '—' }}</code>
          </div>
        </div>
      </div>
      <Md class="rl-text" :text="result" />
      <Md class="rl-text" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.rl-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 20px;
  align-items: center;
}
.rl-range {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1 1 220px;
  min-width: 0;
}
.rl-label {
  font-size: var(--fs-3);
  color: var(--prose);
}
.rl-input {
  font: inherit;
  color: inherit;
  accent-color: var(--ink);
  width: 100%;
}
.rl-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
  min-width: 0;
}
.rl-scroll {
  overflow-x: auto;
}
.rl-table {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 600px;
}
.rl-row {
  display: grid;
  grid-template-columns: 0.7fr 1fr 1fr 1.4fr 1.2fr;
  gap: 10px;
  align-items: baseline;
  padding: 7px 10px;
  border-radius: var(--r2);
  font-size: var(--fs-3);
  color: var(--prose);
  background: var(--surface-2);
}
.rl-row code {
  font-family: var(--mono);
  color: var(--ink);
  background: none;
  padding: 0;
}
.rl-row--head {
  background: none;
  font-family: var(--mono);
  font-size: var(--fs-2);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}
.rl-row[data-tone='ok'] {
  background: var(--tone-ok-bg);
}
.rl-row[data-tone='info'] {
  background: var(--tone-info-bg);
}
.rl-row[data-tone='warn'] {
  background: var(--tone-warn-bg);
}
.rl-row[data-tone='err'] {
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}
.rl-text {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.rl-text :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
</style>
