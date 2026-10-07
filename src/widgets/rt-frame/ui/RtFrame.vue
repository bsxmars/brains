<script setup lang="ts">
/**
 * Кадр WebSocket по байтам: читатель пишет текст — демо собирает настоящий кадр.
 *
 * Байты считает `encodeFrame` из строки `FRAME_CODE`, которую тема печатает выше демо;
 * строка приходит пропом и собирается `loadFrameCode`. Строка «сервер разберёт» — обратный
 * путь через `decodeFrame` из той же строки. Так демо не пересказывает протокол, а исполняет
 * тот же код, что гоняет тест против клиента Node и Chromium.
 *
 * Случайная маска берётся только по кнопке: в `setup` её не выбирают, иначе разметка
 * с сервера и после гидратации разошлись бы. Стартовая маска — из примера RFC 6455.
 */
import { computed, ref } from 'vue';
import CodeInput from '@/shared/ui/CodeInput.vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button, SegmentedControl } from '@/shared/ui';
import { buildFrame, loadFrameCode, plainBytes, RFC_MASK, type FrameKind, type FrameSize } from '../model/frame';

const props = defineProps<{ code: string }>();
const api = loadFrameCode(props.code);

const text = ref('Hello');
const kind = ref<FrameKind>('text');
const side = ref<'client' | 'server'>('client');
const size = ref<FrameSize>('as-is');
const mask = ref<Uint8Array>(RFC_MASK);

const KINDS = [
  { value: 'text', label: 'текст' },
  { value: 'ping', label: 'ping' },
  { value: 'close', label: 'close 1000' },
];
const SIDES = [
  { value: 'client', label: 'клиент → сервер' },
  { value: 'server', label: 'сервер → клиент' },
];
const SIZES = [
  { value: 'as-is', label: 'как введено' },
  { value: '200', label: '200 байт' },
  { value: '70000', label: '70 000 байт' },
];

const view = computed(() =>
  buildFrame(api, {
    text: text.value,
    kind: kind.value,
    fromClient: side.value === 'client',
    size: size.value,
    mask: mask.value,
  }),
);
const plain = computed(() => plainBytes(view.value));
const maskHex = computed(() => [...mask.value].map((b) => b.toString(16).padStart(2, '0')).join(' '));

function newMask() {
  mask.value = crypto.getRandomValues(new Uint8Array(4));
}

const PART_LABEL: Record<string, string> = {
  head: 'FIN · опкод · маска · длина',
  len: 'длина дальше',
  mask: 'ключ маски',
  payload: 'данные',
};

const TEXTS = {
  xor: 'Каждый байт данных сложен по XOR с байтом ключа по кругу: 1-й с 1-м, 5-й снова с 1-м. Сервер складывает ещё раз с тем же ключом — и получает исходное.',
  noMask: 'От сервера маски нет: второй байт без старшего бита, данные идут как есть.',
  control:
    '⚠️ Управляющий кадр длиннее 125 байт. Получатель обязан его отвергнуть: на стенде Chromium и Node ответили серверу кодом 1002, а у себя показали 1006.',
};

const summary = computed(() => {
  const v = view.value;
  return [
    `опкод **${v.opcode}** (${v.opcodeName}), FIN = ${v.fin ? 1 : 0}, маска — ${v.masked ? 'есть' : 'нет'}`,
    `${v.lengthNote}`,
    `заголовок **${v.headerBytes} байт**, данные **${v.payload.length}**, всего **${v.frame.length}**`,
  ];
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="rt-controls">
        <CodeInput v-model="text" label="текст сообщения" :rows="2" />
        <div class="rt-row">
          <div class="rt-control">
            <span class="t-label">кадр</span>
            <SegmentedControl v-model="kind" class="l-pills" label="Тип кадра" :options="KINDS" />
          </div>
          <div class="rt-control">
            <span class="t-label">кто отправляет</span>
            <SegmentedControl v-model="side" class="l-pills" label="Направление" :options="SIDES" />
          </div>
          <div class="rt-control">
            <span class="t-label">размер данных</span>
            <SegmentedControl v-model="size" class="l-pills" label="Размер данных" :options="SIZES" />
          </div>
        </div>
      </div>
    </template>

    <div class="rt-body">
      <div class="rt-block">
        <span class="t-label">байты кадра</span>
        <div class="rt-bytes" data-code>
          <span
            v-for="(cell, i) in view.cells"
            :key="i"
            class="rt-byte"
            :data-part="cell.part"
            :title="PART_LABEL[cell.part]"
          >{{ cell.hex }}</span>
          <span v-if="view.hidden > 0" class="rt-more">… ещё {{ view.hidden.toLocaleString('ru-RU') }} байт данных</span>
        </div>
        <div class="rt-legend">
          <span v-for="part in ['head', 'len', 'mask', 'payload']" :key="part" class="rt-legend__item" :data-part="part">
            {{ PART_LABEL[part] }}
          </span>
        </div>
      </div>

      <ul class="rt-facts">
        <li v-for="line in summary" :key="line"><Md :text="line" /></li>
      </ul>

      <div v-if="view.masked" class="rt-block">
        <span class="t-label">данные до маски</span>
        <div class="rt-bytes" data-code>
          <span v-for="(b, i) in plain" :key="i" class="rt-byte" data-part="plain">{{ b }}</span>
        </div>
        <div class="rt-maskline">
          <span class="rt-maskline__key" data-code>маска {{ maskHex }}</span>
          <Button variant="secondary" @click="newMask">новая маска</Button>
        </div>
        <Md class="rt-note" :text="TEXTS.xor" />
      </div>
      <Md v-else class="rt-note" :text="TEXTS.noMask" />

      <div v-if="view.tooLongControl" class="rt-warn">
        <Md :text="TEXTS.control" />
      </div>

      <div class="rt-block">
        <span class="t-label">сервер разберёт</span>
        <div class="rt-roundtrip" data-code>{{ view.roundTrip }}</div>
      </div>
    </div>
  </DemoFrame>
</template>

<style scoped>
.rt-controls {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.rt-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 20px;
}
.rt-control {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.rt-body {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 22px 20px;
}
.rt-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.rt-bytes {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.rt-byte {
  font-family: var(--mono);
  font-size: var(--fs-4);
  line-height: 1;
  padding: 7px 7px;
  border-radius: var(--r1);
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--ink);
}
.rt-byte[data-part='head'],
.rt-legend__item[data-part='head'] {
  background: var(--tone-info-bg);
  border-color: var(--tone-info-line);
  color: var(--tone-info-text);
}
.rt-byte[data-part='len'],
.rt-legend__item[data-part='len'] {
  background: var(--tone-ok-bg);
  border-color: var(--tone-ok-line);
  color: var(--tone-ok-text);
}
.rt-byte[data-part='mask'],
.rt-legend__item[data-part='mask'] {
  background: var(--tone-warn-bg);
  border-color: var(--tone-warn-line);
  color: var(--tone-warn-text);
}
.rt-more {
  align-self: center;
  font-size: var(--fs-4);
  color: var(--text-muted);
}

.rt-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
}
.rt-legend__item {
  font-size: var(--fs-3);
  padding: 3px 8px;
  border-radius: var(--r-full);
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--chip-text);
}

.rt-facts {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--prose);
}

.rt-maskline {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 14px;
}
.rt-maskline__key {
  font-family: var(--mono);
  font-size: var(--fs-4);
  color: var(--tone-warn-text);
}

.rt-note {
  font-size: var(--fs-5);
  line-height: 1.6;
  color: var(--text-muted);
}

.rt-warn {
  padding: 12px 14px;
  border-radius: var(--r2);
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
  font-size: var(--fs-5);
  line-height: 1.55;
}

.rt-roundtrip {
  font-family: var(--mono);
  font-size: var(--fs-4);
  line-height: 1.5;
  padding: 10px 12px;
  border-radius: var(--r1);
  background: var(--ink);
  color: var(--code-fg);
  overflow-wrap: anywhere;
}
</style>
