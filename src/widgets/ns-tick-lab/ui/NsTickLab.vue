<script setup lang="ts">
/**
 * «Readable по тикам»: источник с порогом, медленный потребитель и четыре способа читать.
 *
 * Считает не этот компонент. Модель `node:stream` и сценарий — две строки из темы
 * (`NS_MODEL_CODE`, `NS_SCENARIO_CODE`), собранные `new Function` (`model/run.ts`). Те же
 * строки исполняет `tests/unit/node-streams.test.ts` — сценарий дважды: на модели и на
 * настоящем `node:stream`, — и требует совпадения каждого кадра. Поэтому демо не может
 * показать того, чего не делает Node.
 *
 * Время модельное: тик — это «источник ответил, потребитель поработал, отложенное
 * на `process.nextTick` доиграло». Прогон дешёвый (три десятка тиков), но живёт
 * в `onMounted`: модели нужна макрозадача, а на сервере считать незачем.
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { usePlayer } from '@/shared/lib/usePlayer';
import { useStepper } from '@/shared/lib/useStepper';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import PlayerToolbar from '@/shared/ui/PlayerToolbar.vue';
import { SegmentedControl } from '@/shared/ui';
import { simulate, trimFrames } from '../model/run';
import type { NsFrame, NsMode, NsModeInfo, NsParams } from '../model/types';

const props = defineProps<{
  model: string;
  scenario: string;
  modes: NsModeInfo[];
  defaults: NsParams;
  /** Варианты переключателей: порог чтения, порог записи, задержка потребителя. */
  options: { hwm: number[]; whwm: number[]; delay: number[] };
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const mode = ref<NsMode>(props.defaults.mode);
const hwm = ref(String(props.defaults.hwm));
const whwm = ref(String(props.defaults.whwm));
const delay = ref(String(props.defaults.delay));

const MODE_OPTIONS = props.modes.map((m) => ({ value: m.value, label: m.label }));
const asOptions = (values: number[]) => values.map((v) => ({ value: String(v), label: String(v) }));
const modeInfo = computed(() => props.modes.find((m) => m.value === mode.value) ?? props.modes[0]);

const frames = ref<NsFrame[]>([]);
const failed = ref(false);

const stepper = useStepper(computed(() => Math.max(1, frames.value.length)));
const { index, counter, atStart, atEnd, next, prev, reset, go } = stepper;
const { playing, speed, speeds, available, toggle, setSpeed, pause } = usePlayer(stepper, { interval: 700 });

// Макрозадача без таймеров: сообщение самому себе через MessageChannel. Заводится в браузере.
let channel: MessageChannel | null = null;
const waiting: (() => void)[] = [];
const macrotask = () =>
  new Promise<void>((resolve) => {
    waiting.push(resolve);
    channel?.port2.postMessage(0);
  });

/** Номер прогона: если переключатель сдвинули, пока считался прошлый, его результат выбрасывается. */
let runId = 0;

async function compute() {
  const id = ++runId;
  pause();
  const params: NsParams = {
    ...props.defaults,
    mode: mode.value,
    hwm: Number(hwm.value),
    whwm: Number(whwm.value),
    delay: Number(delay.value),
  };
  try {
    const result = trimFrames(await simulate(props.model, props.scenario, params, { macrotask }));
    if (id !== runId) return;
    frames.value = result;
    failed.value = false;
  } catch {
    if (id !== runId) return;
    frames.value = [];
    failed.value = true;
  }
  reset();
}

onMounted(() => {
  channel = new MessageChannel();
  channel.port1.onmessage = () => waiting.shift()?.();
  void compute();
});
onUnmounted(() => {
  runId++;
  channel?.port1.close();
  channel = null;
});

watch([mode, hwm, whwm, delay], () => void compute());

const frame = computed<NsFrame | null>(() => frames.value[Math.min(index.value, frames.value.length - 1)] ?? null);
const isPipe = computed(() => mode.value === 'pipe');
const outsideQueue = computed(() => mode.value === 'data' || mode.value === 'readable');

const EMPTY_NOTE = 'Модель запускается в браузере: кадров пока нет.';
const FAILED_NOTE = 'Модель не отработала — обновите страницу.';

/** Ячейки полки: занятые — чанки буфера, пустые — до порога. За порогом полка растёт вправо. */
const slots = computed(() => {
  const f = frame.value;
  const limit = Number(hwm.value);
  const items = (f?.buffer ?? []).map((c) => ({ label: String(c), over: false, empty: false }));
  items.forEach((item, i) => {
    item.over = i >= limit;
  });
  for (let i = items.length; i < limit; i++) items.push({ label: '·', over: false, empty: true });
  return items;
});

const flowingText = (v: boolean | null | undefined) => (v === null || v === undefined ? 'null' : String(v));

const stats = computed(() => {
  const f = frame.value;
  if (!f) return [];
  const list = [
    { k: 'readableLength', v: `${f.length} / ${hwm.value}`, tone: f.length >= Number(hwm.value) && f.length > 0 ? 'warn' : 'info' },
    { k: 'readableFlowing', v: flowingText(f.flowing), tone: f.flowing === true ? 'ok' : f.flowing === false ? 'warn' : 'neutral' },
    { k: 'reading', v: String(f.reading), tone: f.reading ? 'info' : 'neutral' },
    { k: 'readableEnded', v: String(f.ended), tone: f.ended ? 'ok' : 'neutral' },
  ];
  if (isPipe.value) {
    list.push(
      { k: 'writableLength', v: `${f.wlength ?? 0} / ${whwm.value}`, tone: (f.wlength ?? 0) >= Number(whwm.value) ? 'warn' : 'info' },
      { k: 'writableNeedDrain', v: String(f.needDrain), tone: f.needDrain ? 'warn' : 'neutral' },
    );
  }
  return list;
});

/** Тон строки журнала: что это — запрос к источнику, торможение, отпуск или конец. */
function toneOf(line: string): string {
  if (line.includes('слушателей нет')) return 'deaf';
  if (line.includes('_read()')) return 'info';
  if (line.includes('→ false') || line.includes("'pause'")) return 'warn';
  if (line.includes("'drain'") || line.includes("'resume'")) return 'ok';
  if (/'(end|finish|close)'/.test(line)) return 'end';
  if (line.startsWith('готов')) return 'muted';
  return 'plain';
}

const log = computed(() => (frame.value?.log ?? []).map((line) => ({ line, tone: toneOf(line) })));

/** Лента: на каждый тик столбик «в буфере стрима» и сверху «у потребителя вне стрима». */
const strip = computed(() => {
  const all = frames.value;
  const top = Math.max(1, Number(hwm.value), ...all.map((f) => f.length + f.backlog.length + (f.wlength ?? 0)));
  return all.map((f, i) => ({
    i,
    buffer: (100 * f.length) / top,
    backlog: (100 * f.backlog.length) / top,
    wqueue: (100 * (f.wlength ?? 0)) / top,
    read: f.log.includes('rs._read()'),
    label: `тик ${f.t}: в буфере ${f.length}${f.backlog.length ? `, у потребителя ${f.backlog.length}` : ''}`,
  }));
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="ns-bar">
        <PlayerToolbar
          :counter="counter"
          :index="index"
          :playing="playing"
          :speed="speed"
          :speeds="speeds"
          :available="available"
          :at-start="atStart"
          :at-end="atEnd"
          next-label="Тик →"
          @toggle="toggle"
          @scrub="go"
          @speed="setSpeed"
          @prev="prev"
          @next="next"
          @reset="reset"
        />
        <SegmentedControl v-model="mode" class="l-pills" label="Как потребитель читает" :options="MODE_OPTIONS" />
        <div class="ns-knobs">
          <div class="ns-knob">
            <span class="ns-knob__label">highWaterMark</span>
            <SegmentedControl v-model="hwm" class="l-pills" label="Порог читаемого стрима" :options="asOptions(options.hwm)" />
          </div>
          <div class="ns-knob">
            <span class="ns-knob__label">тиков на чанк</span>
            <SegmentedControl v-model="delay" class="l-pills" label="Сколько тиков потребитель тратит на чанк" :options="asOptions(options.delay)" />
          </div>
          <div v-if="isPipe" class="ns-knob">
            <span class="ns-knob__label">порог записи</span>
            <SegmentedControl v-model="whwm" class="l-pills" label="Порог записываемого стрима" :options="asOptions(options.whwm)" />
          </div>
        </div>
      </div>
    </template>

    <div class="ns-body">
      <Md class="ns-note" :text="modeInfo.note" />

      <Md v-if="!frame" class="ns-empty" :text="failed ? FAILED_NOTE : EMPTY_NOTE" />

      <template v-else>
        <div class="ns-stats">
          <span v-for="s in stats" :key="s.k" class="ns-stat" :data-tone="s.tone">
            <span class="ns-stat__k">{{ s.k }}</span>
            <span class="ns-stat__v">{{ s.v }}</span>
          </span>
        </div>

        <div class="ns-grid">
          <div class="ns-panel">
            <span class="ns-panel__label">буфер rs · тик {{ frame.t }}</span>
            <div class="ns-shelf">
              <span
                v-for="(slot, i) in slots"
                :key="i"
                class="ns-slot"
                :data-empty="slot.empty ? 'yes' : 'no'"
                :data-over="slot.over ? 'yes' : 'no'"
              >{{ slot.label }}</span>
              <span v-if="!slots.length" class="ns-slot" data-empty="yes">порог 0</span>
            </div>
          </div>

          <div class="ns-panel">
            <span class="ns-panel__label">{{ isPipe ? 'сток ws · в _write' : 'потребитель · в работе' }}</span>
            <div class="ns-shelf">
              <span v-if="frame.current !== null" class="ns-slot" data-busy="yes">{{ String(frame.current) }}</span>
              <span v-else class="ns-idle">свободен</span>
            </div>
            <template v-if="outsideQueue">
              <span class="ns-panel__label">взято, но не обработано — вне стрима</span>
              <div class="ns-shelf">
                <span v-for="(c, i) in frame.backlog" :key="i" class="ns-slot" data-backlog="yes">{{ String(c) }}</span>
                <span v-if="!frame.backlog.length" class="ns-idle">пусто</span>
              </div>
            </template>
          </div>
        </div>

        <div class="ns-log" data-code>
          <span class="ns-panel__label">что случилось за тик</span>
          <ol v-if="log.length" class="ns-log__list">
            <li v-for="(item, i) in log" :key="i" class="ns-log__line" :data-tone="item.tone">{{ item.line }}</li>
          </ol>
          <span v-else class="ns-idle">ничего: все ждут</span>
        </div>

        <div class="ns-strip" aria-label="Лента тиков: столбик — сколько чанков лежит в буфере и у потребителя">
          <button
            v-for="col in strip"
            :key="col.i"
            type="button"
            class="ns-col"
            :data-current="col.i === index ? 'yes' : 'no'"
            :data-future="col.i > index ? 'yes' : 'no'"
            :title="col.label"
            :aria-label="col.label"
            @click="go(col.i)"
          >
            <span class="ns-col__bar" data-part="backlog" :style="`height:${col.backlog}%`" />
            <span class="ns-col__bar" data-part="wqueue" :style="`height:${col.wqueue}%`" />
            <span class="ns-col__bar" data-part="buffer" :style="`height:${col.buffer}%`" />
            <span class="ns-col__read" :data-on="col.read ? 'yes' : 'no'" />
          </button>
        </div>
        <div class="ns-legend">
          <span class="ns-legend__item" data-part="buffer"><span class="ns-legend__swatch" />буфер rs</span>
          <span v-if="isPipe" class="ns-legend__item" data-part="wqueue"><span class="ns-legend__swatch" />очередь ws</span>
          <span v-if="outsideQueue" class="ns-legend__item" data-part="backlog"><span class="ns-legend__swatch" />у потребителя</span>
          <span class="ns-legend__item" data-part="read"><span class="ns-legend__swatch" />в этот тик звали _read()</span>
        </div>
      </template>
    </div>

    <template #footer>
      <Md class="ns-caption" :text="caption" />
    </template>
  </DemoFrame>
</template>

<style scoped>
.ns-bar {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.ns-knobs {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 18px;
}
.ns-knob {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.ns-knob__label,
.ns-panel__label {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}

.ns-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.ns-note,
.ns-empty {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.ns-note :deep(code),
.ns-empty :deep(code),
.ns-caption :deep(code) {
  font-family: var(--mono);
  /* Не ниже ступени `--fs-2`: в подписи на `--fs-2` доля .92em давала 10.9px. */
  font-size: max(0.92em, var(--fs-2));
}

.ns-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.ns-stat {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  padding: 6px 10px;
  border-radius: var(--r2);
  font-family: var(--mono);
}
.ns-stat__k {
  font-size: var(--fs-3);
}
.ns-stat__v {
  font-size: var(--fs-4);
  font-weight: 600;
}
.ns-stat[data-tone='neutral'] {
  background: var(--surface-2);
  color: var(--chip-text);
}
.ns-stat[data-tone='info'] {
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
}
.ns-stat[data-tone='ok'] {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.ns-stat[data-tone='warn'] {
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}

.ns-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 14px;
}
@media (max-width: 640px) {
  .ns-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
.ns-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border-radius: var(--r3);
  background: var(--surface-2);
  min-width: 0;
}
.ns-shelf {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  min-height: 32px;
  align-items: center;
}
.ns-slot {
  min-width: 30px;
  padding: 6px 8px;
  border: 1px solid var(--tone-info-line);
  border-radius: var(--r1);
  background: var(--tone-info-bg);
  color: var(--tone-info-strong);
  font-family: var(--mono);
  font-size: var(--fs-2);
  text-align: center;
  box-sizing: border-box;
}
.ns-slot[data-empty='yes'] {
  border-style: dashed;
  border-color: var(--border-strong);
  background: none;
  color: var(--text-faint);
}
.ns-slot[data-over='yes'] {
  border-color: var(--tone-warn-line);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-strong);
}
.ns-slot[data-busy='yes'] {
  border-color: var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-strong);
}
.ns-slot[data-backlog='yes'] {
  border-color: var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-strong);
}
.ns-idle {
  font-family: var(--mono);
  font-size: var(--fs-2);
  font-style: italic;
  color: var(--text-faint);
}

.ns-log {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--r3);
  background: var(--surface);
  min-height: 96px;
}
.ns-log__list {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin: 0;
  padding-left: 22px;
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.5;
}
.ns-log__line {
  overflow-wrap: anywhere;
}
.ns-log__line[data-tone='plain'] {
  color: var(--ink);
}
.ns-log__line[data-tone='info'] {
  color: var(--tone-info-text);
}
.ns-log__line[data-tone='warn'] {
  color: var(--tone-warn-text);
}
.ns-log__line[data-tone='ok'] {
  color: var(--tone-ok-text);
}
.ns-log__line[data-tone='end'] {
  color: var(--ink);
  font-weight: 600;
}
.ns-log__line[data-tone='muted'] {
  color: var(--text-muted);
}
.ns-log__line[data-tone='deaf'] {
  color: var(--text-faint);
}

.ns-strip {
  display: flex;
  align-items: flex-end;
  gap: 3px;
  height: 84px;
  padding: 8px 10px 6px;
  border-radius: var(--r3);
  background: var(--surface-2);
  overflow-x: auto;
}
.ns-col {
  position: relative;
  display: flex;
  flex-direction: column-reverse;
  flex: 1 0 12px;
  max-width: 26px;
  height: 100%;
  padding: 0 0 8px;
  border: 0;
  border-radius: var(--r1);
  background: none;
  font: inherit;
  color: inherit;
  cursor: pointer;
}
.ns-col[data-current='yes'] {
  background: var(--surface-3);
}
.ns-col[data-future='yes'] .ns-col__bar {
  opacity: 0.3;
}
.ns-col__bar {
  display: block;
  width: 100%;
  border-radius: 2px;
}
.ns-col__bar[data-part='buffer'] {
  order: 1;
  background: var(--bar-violet);
}
.ns-col__bar[data-part='wqueue'] {
  order: 2;
  background: var(--bar-amber);
}
.ns-col__bar[data-part='backlog'] {
  order: 3;
  background: var(--bar-red);
}
.ns-col__read {
  position: absolute;
  bottom: 1px;
  left: 50%;
  width: 5px;
  height: 5px;
  margin-left: -2.5px;
  border-radius: var(--r-full);
}
.ns-col__read[data-on='yes'] {
  background: var(--tone-info-strong);
}

.ns-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-muted);
}
.ns-legend__item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.ns-legend__swatch {
  width: 10px;
  height: 10px;
  border-radius: 2px;
}
.ns-legend__item[data-part='buffer'] .ns-legend__swatch {
  background: var(--bar-violet);
}
.ns-legend__item[data-part='wqueue'] .ns-legend__swatch {
  background: var(--bar-amber);
}
.ns-legend__item[data-part='backlog'] .ns-legend__swatch {
  background: var(--bar-red);
}
.ns-legend__item[data-part='read'] .ns-legend__swatch {
  width: 5px;
  height: 5px;
  border-radius: var(--r-full);
  background: var(--tone-info-strong);
}

.ns-caption {
  font-size: var(--fs-2);
  line-height: 1.55;
  color: var(--text-muted);
}
</style>
