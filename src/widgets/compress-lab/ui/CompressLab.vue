<script setup lang="ts">
/**
 * «Что выберет сервер»: заголовок `Accept-Encoding` (снятый стендом у Chromium, Node, curl или
 * свой), набор готовых вариантов файла на сервере — и ответ: вес каждого варианта, выбранная
 * кодировка, заголовки ответа и байты по сети.
 *
 * Решение считает не компонент, а строка `NEGOTIATE_CODE` из темы, собранная `new Function`
 * (`model/run.ts`). Та же строка напечатана на странице и сверяется
 * `tests/unit/compression.test.ts` с примерами RFC 9110 и с negotiator. Размеры файлов — литералы
 * стенда (настоящие файлы сайта); компонент только подписывает, откуда взялся вес.
 */
import { computed, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { loadNegotiate } from '../model/run';
import type { AePreset, LabFile } from '../model/types';

const props = defineProps<{
  negotiateCode: string;
  presets: AePreset[];
  tricky: { header: string; note: string }[];
  files: LabFile[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const api = loadNegotiate(props.negotiateCode);

const presetId = ref(props.presets[0].id);
const presetOptions = props.presets.map((p) => ({ value: p.id, label: p.label }));
const preset = computed(() => props.presets.find((p) => p.id === presetId.value) ?? props.presets[0]);

const header = ref(preset.value.header ?? '');
const absent = ref(preset.value.header === null);
const note = ref(preset.value.note);
watch(preset, (p) => {
  header.value = p.header ?? '';
  absent.value = p.header === null;
  note.value = p.note;
});

function pickTricky(e: Event) {
  const el = e.target as HTMLSelectElement;
  const t = props.tricky.find((x) => x.header === el.value);
  if (t) {
    header.value = t.header;
    absent.value = false;
    note.value = `Нарочно трудный заголовок: ${t.note}.`;
  }
  el.value = '__';
}

const fileId = ref(props.files[0].id);
const fileOptions = props.files.map((f) => ({ value: f.id, label: f.label }));
const file = computed(() => props.files.find((f) => f.id === fileId.value) ?? props.files[0]);

/** Порядок предпочтения сервера: самый маленький вариант первым. */
const SERVER_ORDER = ['br', 'zstd', 'gzip'] as const;
const has = ref<Record<string, boolean>>({ br: true, zstd: true, gzip: true });
const offers = computed(() => SERVER_ORDER.filter((c) => has.value[c]));

const value = computed<string | null>(() => (absent.value ? null : header.value));
const list = computed(() => (value.value === null ? [] : api.parseAcceptEncoding(value.value)));
const pick = computed(() => api.negotiate(value.value, offers.value));

const fmt = (x: number) => x.toLocaleString('ru-RU');
const sizeOf = (coding: string) =>
  coding === 'identity' ? file.value.raw : file.value.sizes[coding as 'br' | 'zstd' | 'gzip'];

const rows = computed(() =>
  [...offers.value, 'identity'].map((coding) => {
    const q = value.value === null ? null : api.weight(list.value, coding);
    const own = list.value.some((e) => e.coding === coding);
    const star = list.value.some((e) => e.coding === '*');
    const from = value.value === null ? 'заголовка нет' : own ? 'своя запись' : star ? 'по «*»' : 'не названа';
    const weightText =
      q === null ? '—' : q === 0 ? '0 — не годится' : q === Number.MIN_VALUE ? 'годится, последней' : String(q);
    return { coding, weightText, from, bytes: sizeOf(coding), win: coding === pick.value, banned: q === 0 };
  }),
);

const response = computed(() => {
  const p = pick.value;
  const lines: string[] = [];
  if (p === null) {
    lines.push('HTTP/1.1 406 Not Acceptable');
    lines.push('Content-Type: text/plain');
    return lines.join('\n');
  }
  lines.push('HTTP/1.1 200 OK');
  lines.push(`Content-Type: ${file.value.type}`);
  if (p !== 'identity') lines.push(`Content-Encoding: ${p}`);
  lines.push(`Content-Length: ${sizeOf(p)}`);
  if (offers.value.length) lines.push('Vary: Accept-Encoding');
  return lines.join('\n');
});

const verdict = computed(() => {
  const p = pick.value;
  const raw = file.value.raw;
  if (p === null) return 'Ни один вариант не годится, «без сжатия» тоже запрещено. Сервер вправе ответить `406` — или проигнорировать заголовок и отдать как есть.';
  const b = sizeOf(p);
  if (p === 'identity') return `Уходит исходный файл: **${fmt(raw)}** байт.`;
  const share = ((b / raw) * 100).toFixed(1).replace('.', ',');
  if (b >= raw) return `\`${p}\`: **${fmt(b)}** байт — на ${fmt(b - raw)} **больше** исходного. Файл уже сжат своим форматом, работа впустую.`;
  const tail = b / raw > 0.97 ? ' Почти ничего: файл уже сжат своим форматом.' : '';
  return `\`${p}\`: **${fmt(b)}** байт из ${fmt(raw)} — ${share}% исходного.${tail}`;
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="presetId" class="l-pills" label="Клиент" :options="presetOptions" />
    </template>

    <div class="cz-body">
      <div class="cz-head">
        <label class="cz-label" for="cz-ae">Accept-Encoding</label>
        <input id="cz-ae" v-model="header" class="cz-input" type="text" spellcheck="false" :disabled="absent" />
        <div class="cz-meta">
          <label class="cz-check">
            <input v-model="absent" type="checkbox" />
            <span>заголовка нет</span>
          </label>
          <select class="cz-select" aria-label="Трудные заголовки" @change="pickTricky">
            <option value="__">ещё {{ tricky.length }} трудных заголовков…</option>
            <option v-for="t in tricky" :key="t.header" :value="t.header">{{ t.header === '' ? '(пустой)' : t.header }}</option>
          </select>
        </div>
        <Md class="cz-note" :text="note" />
      </div>

      <div class="cz-server">
        <SegmentedControl v-model="fileId" class="l-pills" label="Файл" :options="fileOptions" />
        <div class="cz-offers" role="group" aria-label="Готовые варианты на сервере">
          <span class="cz-label">на сервере лежит</span>
          <label v-for="c in SERVER_ORDER" :key="c" class="cz-check">
            <input v-model="has[c]" type="checkbox" />
            <code>{{ c }}</code>
          </label>
        </div>
      </div>

      <div class="cz-table" role="table" aria-label="Вес каждого варианта">
        <div class="cz-row cz-row--head" role="row">
          <span role="columnheader">вариант</span>
          <span role="columnheader">вес</span>
          <span role="columnheader">откуда</span>
          <span role="columnheader">байт</span>
        </div>
        <div
          v-for="r in rows"
          :key="r.coding"
          class="cz-row"
          role="row"
          :data-win="r.win ? 'yes' : 'no'"
          :data-banned="r.banned ? 'yes' : 'no'"
        >
          <code role="cell" class="cz-coding">{{ r.coding }}</code>
          <span role="cell" class="cz-weight">{{ r.weightText }}</span>
          <span role="cell" class="cz-from">{{ r.from }}</span>
          <span role="cell" class="cz-bytes">{{ fmt(r.bytes) }}</span>
        </div>
      </div>

      <div class="cz-result">
        <span class="cz-label">ответ сервера</span>
        <pre class="cz-response">{{ response }}</pre>
        <Md class="cz-verdict" :text="verdict" />
      </div>

      <Md class="cz-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.cz-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.cz-head {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.cz-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.cz-input {
  font: inherit;
  color: inherit;
  width: 100%;
  box-sizing: border-box;
  padding: 9px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r3);
  background: var(--surface);
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
}
.cz-input:disabled {
  background: var(--surface-2);
  color: var(--text-muted);
}
.cz-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 16px;
}
.cz-check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-3);
  color: var(--prose);
  cursor: pointer;
}
.cz-check input {
  font: inherit;
  color: inherit;
  margin: 0;
}
.cz-check code {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
}
.cz-select {
  font: inherit;
  color: inherit;
  max-width: 100%;
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--surface);
  font-size: var(--fs-2);
}
.cz-note,
.cz-caption,
.cz-verdict {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.cz-note :deep(code),
.cz-caption :deep(code),
.cz-verdict :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}

.cz-server {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 20px;
}
.cz-offers {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 14px;
}

.cz-table {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.cz-row {
  display: grid;
  grid-template-columns: minmax(0, 0.7fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 0.7fr);
  gap: 6px 12px;
  align-items: baseline;
  padding: 7px 10px;
  border-radius: var(--r2);
  background: var(--surface-2);
  font-size: var(--fs-3);
  color: var(--prose);
}
.cz-row[data-banned='yes'] {
  background: var(--surface-3);
}
.cz-row[data-win='yes'] {
  background: var(--tone-ok-bg);
  box-shadow: inset 3px 0 0 var(--tone-ok-line);
}
.cz-row--head {
  background: none;
  padding-top: 0;
  padding-bottom: 0;
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
/* На узком экране строка складывается в две: «вариант — байты», «вес — откуда». */
@media (max-width: 560px) {
  .cz-row {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .cz-row--head {
    display: none;
  }
  .cz-coding {
    order: 1;
  }
  .cz-bytes {
    order: 2;
    text-align: right;
  }
  .cz-weight {
    order: 3;
  }
  .cz-from {
    order: 4;
    text-align: right;
  }
}
.cz-coding {
  padding: 0;
  background: none;
  font-family: var(--mono);
  font-size: var(--fs-3);
  font-weight: 600;
  color: var(--ink);
}
.cz-row[data-win='yes'] .cz-coding {
  color: var(--tone-ok-text);
}
.cz-weight,
.cz-bytes {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
}
.cz-from {
  font-size: var(--fs-2);
  color: var(--text-muted);
}

.cz-result {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.cz-response {
  margin: 0;
  padding: 12px 14px;
  border-radius: var(--r3);
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.7;
  /* Подложка — общая для кода курса (`pre` в base.css, чернильная): цвет — «на чернилах». */
  color: var(--code-fg);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
