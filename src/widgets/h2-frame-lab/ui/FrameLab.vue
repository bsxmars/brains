<script setup lang="ts">
/**
 * «Соединение по кадрам»: запись прокси стенда (Node или Chromium), разрезанная на кадры HTTP/2,
 * и разбор выбранного кадра — 9 байт заголовка, полезная нагрузка, поля HPACK и динамическая
 * таблица своей стороны после этого блока.
 *
 * Считает не компонент, а строки `FRAME_CODE` и `HPACK_*_CODE` из темы, собранные `new Function`
 * (`model/run.ts`). Те же строки напечатаны на странице и сверяются `tests/unit/http2-http3.test.ts`
 * с nghttp2 и векторами RFC 7541. Байты — `stand.ts` темы как есть.
 */
import { computed, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { buildTimeline, bytesToHex, ERROR_CODES, flagNames, loadH2 } from '../model/run';
import type { Capture, HeaderField, TimelineFrame } from '../model/types';

const props = defineProps<{
  frameCode: string;
  intCode: string;
  tableCode: string;
  decodeCode: string;
  captures: Capture[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const api = loadH2(props.frameCode, props.intCode, props.tableCode, props.decodeCode);

const picked = ref(props.captures[0].id);
const options = props.captures.map((c) => ({ value: c.id, label: c.label }));
const capture = computed(() => props.captures.find((c) => c.id === picked.value) ?? props.captures[0]);
const timeline = computed(() => buildTimeline(api, capture.value.chunks));

/** Открывается второй запрос: в нём видно, как поля превратились в номера. */
function defaultFrame(tl: TimelineFrame[]) {
  const reqs = tl.filter((f) => f.dir === 'c2s' && f.type === 'HEADERS');
  return (reqs[1] ?? reqs[0] ?? tl[0]).n;
}
const sel = ref(defaultFrame(timeline.value));
watch(timeline, (tl) => {
  sel.value = defaultFrame(tl);
});
const frame = computed(() => timeline.value.find((f) => f.n === sel.value) ?? timeline.value[0]);

const who = (dir: 'c2s' | 's2c') => (dir === 'c2s' ? capture.value.client : capture.value.server);

/** Девять байт заголовка выбранного кадра, как они пришли, и их разбор `readFrameHeader`. */
const headParts = computed(() => {
  const b = frame.value.head;
  const h = api.readFrameHeader(b, 0);
  const flags = flagNames(h.type, h.flags);
  return [
    { k: 'длина', hex: bytesToHex(b.slice(0, 3)), v: `${h.length} байт` },
    { k: 'тип', hex: bytesToHex(b.slice(3, 4)), v: h.type },
    { k: 'флаги', hex: bytesToHex(b.slice(4, 5)), v: flags.length ? flags.join(' + ') : 'нет' },
    { k: 'поток', hex: bytesToHex(b.slice(5, 9)), v: h.stream === 0 ? '0 — соединение' : String(h.stream) },
  ];
});

const payloadText = computed(() => {
  const f = frame.value;
  const p = api.readPayload(f);
  if (f.type === 'SETTINGS') {
    if (p.ack) return 'Подтверждение: «ваши SETTINGS принял». Тела нет.';
    if (!p.settings?.length) return 'Пустой SETTINGS: все параметры — по умолчанию.';
    return p.settings.map(([k, v]) => `\`${k}\` = ${v.toLocaleString('ru-RU')}`).join(' · ');
  }
  if (f.type === 'WINDOW_UPDATE') {
    return `Окно ${f.stream === 0 ? 'всего соединения' : `потока ${f.stream}`} пополнено на ${p.increment?.toLocaleString('ru-RU')} байт.`;
  }
  if (f.type === 'RST_STREAM') return `Поток ${f.stream} оборван, код ${p.error} — \`${ERROR_CODES[p.error ?? 0] ?? '?'}\`.`;
  if (f.type === 'GOAWAY') return `Последний обработанный поток — ${p.lastStream}, код ${p.error} — \`${ERROR_CODES[p.error ?? 0] ?? '?'}\`.`;
  if (f.type === 'PING') return `Восемь байт: \`${String.fromCharCode(...f.payload)}\`${f.flags & 1 ? ' — эхо с флагом ACK' : ''}.`;
  if (f.type === 'DATA') {
    if (!f.length) return 'Пустой DATA — только флаг END_STREAM: «тело кончилось».';
    const text = String.fromCharCode(...f.payload.slice(0, 60)).replace(/[^\x20-\x7e]/g, '·');
    return `Тело, ${f.length} байт: \`${text}${f.length > 60 ? '…' : ''}\``;
  }
  if (f.type === 'PUSH_PROMISE') {
    const off = f.flags & 0x08 ? 1 : 0;
    const promised = f.payload.slice(off, off + 4).reduce((acc, x) => acc * 256 + x, 0) % 2 ** 31;
    return `Обещан поток **${promised}**. Блок HPACK — ${f.blockLength} байт, с ${f.blockOffset}-го байта тела.`;
  }
  if (f.type === 'HEADERS') {
    const pre = f.blockOffset ? `перед ним ${f.blockOffset} байт приоритета` : 'перед ним ничего';
    return `Блок HPACK — ${f.blockLength} байт из ${f.length}, ${pre}.`;
  }
  return '';
});

const KIND: Record<HeaderField['kind'], string> = {
  indexed: 'номер',
  incremental: 'литерал → в таблицу',
  literal: 'литерал',
  never: 'никогда не запоминать',
  size: 'размер таблицы',
};

function where(index?: number) {
  if (!index) return 'имя строкой';
  return index <= 61 ? `статическая ${index}` : `динамическая ${index}`;
}

const fields = computed(() => {
  const f = frame.value;
  if (!f.fields) return [];
  const block = api.headerBlockOf(f);
  return f.fields.map((x, i) => {
    const raw = block.slice(x.bytes[0], x.bytes[1]);
    const hex = bytesToHex(raw.slice(0, 6)) + (raw.length > 6 ? ' …' : '');
    const huff = x.nameHuffman || x.valueHuffman ? ' · Хаффман' : '';
    return {
      key: `${f.n}-${i}`,
      hex,
      len: raw.length,
      kind: KIND[x.kind],
      tone: x.kind === 'indexed' ? 'ok' : x.kind === 'size' ? 'info' : x.kind === 'incremental' ? 'warn' : 'dim',
      where: x.kind === 'size' ? `${x.size} байт` : where(x.index) + huff,
      name: x.kind === 'size' ? '' : x.name,
      value: x.kind === 'size' ? '' : x.value,
    };
  });
});

const table = computed(() => frame.value.tableAfter);

function pick(n: number) {
  sel.value = n;
}
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="picked" class="l-pills" label="Запись" :options="options" />
    </template>

    <div class="fl-body">
      <Md class="fl-note" :text="capture.note" />

      <div class="fl-split">
        <div class="fl-pane">
          <span class="fl-label">кадры по порядку прихода</span>
          <div class="fl-list" role="listbox" :aria-label="`Кадры: ${capture.label}`">
            <button
              v-for="f in timeline"
              :key="f.n"
              type="button"
              class="fl-row"
              role="option"
              :aria-selected="f.n === sel"
              :data-on="f.n === sel ? 'yes' : 'no'"
              :data-dir="f.dir"
              @click="pick(f.n)"
            >
              <span class="fl-dir">{{ f.dir === 'c2s' ? '→' : '←' }}</span>
              <span class="fl-type">{{ f.type }}</span>
              <span class="fl-stream">{{ f.stream }}</span>
              <span class="fl-len">{{ f.length }}</span>
            </button>
          </div>
          <span class="fl-legend">→ {{ capture.client }} · ← {{ capture.server }} · поток · длина</span>
        </div>

        <div class="fl-detail">
          <span class="fl-label">кадр {{ frame.n }}: {{ who(frame.dir) }} → {{ who(frame.dir === 'c2s' ? 's2c' : 'c2s') }}</span>
          <div class="fl-head">
            <div v-for="p in headParts" :key="p.k" class="fl-head__cell" :data-wide="p.k === 'флаги' ? 'yes' : 'no'">
              <code class="fl-hex">{{ p.hex }}</code>
              <span class="fl-head__k">{{ p.k }}</span>
              <span class="fl-head__v">{{ p.v }}</span>
            </div>
          </div>
          <Md class="fl-payload" :text="payloadText" />

          <div v-if="fields.length" class="fl-fields" role="table" aria-label="Поля HPACK">
            <div v-for="x in fields" :key="x.key" class="fl-field" role="row" :data-tone="x.tone">
              <code class="fl-hex" role="cell">{{ x.hex }}</code>
              <span class="fl-field__kind" role="cell">{{ x.kind }}<br /><span class="fl-field__where">{{ x.where }} · {{ x.len }} б</span></span>
              <code class="fl-field__nv" role="cell"><template v-if="x.name">{{ x.name }}: {{ x.value }}</template></code>
            </div>
          </div>

          <div v-if="table" class="fl-table">
            <span class="fl-label">динамическая таблица после блока: {{ table.size }} из {{ table.maxSize }} байт</span>
            <ol v-if="table.entries.length" class="fl-table__list">
              <li v-for="(e, i) in table.entries" :key="i">
                <code class="fl-table__idx">{{ 62 + i }}</code>
                <code class="fl-table__nv">{{ e[0] }}: {{ e[1] }}</code>
              </li>
            </ol>
            <span v-else class="fl-table__empty">пусто</span>
          </div>
        </div>
      </div>

      <Md class="fl-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.fl-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.fl-note,
.fl-caption,
.fl-payload {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.fl-note :deep(code),
.fl-caption :deep(code),
.fl-payload :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
.fl-label,
.fl-legend {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.fl-legend {
  text-transform: none;
  letter-spacing: 0;
}

.fl-split {
  display: grid;
  grid-template-columns: minmax(0, 0.75fr) minmax(0, 1.6fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 760px) {
  .fl-split {
    grid-template-columns: minmax(0, 1fr);
  }
}

.fl-pane {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.fl-list {
  display: flex;
  flex-direction: column;
  max-height: 26rem;
  overflow-y: auto;
  padding: 6px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.fl-row {
  font: inherit;
  color: inherit;
  display: grid;
  grid-template-columns: 1.4em minmax(0, 1fr) 2.6em 3.6em;
  gap: 6px;
  align-items: baseline;
  padding: 4px 8px;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  text-align: left;
  cursor: pointer;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
}
.fl-row:hover,
.fl-row:focus-visible {
  background: var(--surface-3);
  outline: none;
}
.fl-row[data-dir='s2c'] .fl-dir {
  color: var(--tone-info-text);
}
.fl-row[data-on='yes'] {
  background: var(--tone-warn-bg);
  box-shadow: inset 0 0 0 1px var(--tone-warn-line);
}
.fl-stream,
.fl-len {
  text-align: right;
  color: var(--text-muted);
}
.fl-type {
  overflow-wrap: anywhere;
}

.fl-detail {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.fl-head {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, auto));
  gap: 8px;
  justify-content: start;
}
@media (max-width: 520px) {
  .fl-head {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .fl-head__cell[data-wide='yes'] {
    grid-column: span 2;
  }
}
.fl-head__cell {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 8px 10px;
  border-radius: var(--r2);
  background: var(--surface-2);
  min-width: 0;
}
.fl-hex {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
  white-space: nowrap;
}
.fl-head__k {
  font-family: var(--mono);
  font-size: var(--fs-2);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}
.fl-head__v {
  font-size: var(--fs-3);
  color: var(--prose);
  overflow-wrap: break-word;
}

.fl-fields {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.fl-field {
  display: grid;
  grid-template-columns: minmax(0, 9.5em) minmax(0, 11em) minmax(0, 1fr);
  gap: 10px;
  align-items: baseline;
  padding: 6px 10px;
  border-radius: var(--r2);
  border-left: 3px solid var(--tone-ok-line);
  background: var(--surface-2);
  font-size: var(--fs-3);
  color: var(--prose);
}
@media (max-width: 620px) {
  .fl-field {
    grid-template-columns: minmax(0, 1fr);
    gap: 2px;
  }
}
.fl-field[data-tone='warn'] {
  border-left-color: var(--tone-warn-line);
}
.fl-field[data-tone='info'] {
  border-left-color: var(--tone-info-line);
}
.fl-field[data-tone='dim'] {
  border-left-color: var(--border-strong);
}
.fl-field .fl-hex {
  white-space: normal;
  overflow-wrap: anywhere;
}
.fl-field__kind {
  font-size: var(--fs-3);
  color: var(--ink);
}
.fl-field__where {
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.fl-field__nv {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
  overflow-wrap: anywhere;
}

.fl-table {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.fl-table__list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: 14rem;
  overflow-y: auto;
}
.fl-table__list li {
  display: grid;
  grid-template-columns: 2.6em minmax(0, 1fr);
  gap: 8px;
  align-items: baseline;
}
.fl-table__idx {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-muted);
}
.fl-table__nv {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
  overflow-wrap: anywhere;
}
.fl-table__empty {
  font-size: var(--fs-3);
  color: var(--text-muted);
}
</style>
