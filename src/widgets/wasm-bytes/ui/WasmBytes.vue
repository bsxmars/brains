<script setup lang="ts">
/**
 * «Разбор модуля по байтам»: учебный модуль темы, раскрашенный по секциям, и его исполнение
 * в браузере читателя.
 *
 * Байты приходят пропом из `data.ts` темы — те же, что исполняет `tests/unit/wasm-threads.test.ts`.
 * Секции размечает не описание из `data.ts`, а декодер `../model/decode`, который читает сами
 * байты; тест сверяет его вывод с описанием и с текстом WAT.
 *
 * Разбор байтов дешёв и детерминирован, поэтому идёт сразу (и на сборке тоже). Исполнение —
 * только по кнопке: до нажатия демо честно говорит, что ещё ничего не запускалось.
 * Общей памяти здесь нет: сайт не изолирован, и отправить её в воркер нельзя.
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button } from '@/shared/ui';
import { decodeModule, hex } from '../model/decode';
import { STRING_PTR, WINDOW, ascii, runModule, type ModuleRun } from '../model/run';

const props = withDefaults(
  defineProps<{
    bytes: number[];
    defaultText?: string;
    foot?: string;
  }>(),
  { defaultText: 'Hello, мир!', foot: '' },
);

const decoded = decodeModule(props.bytes);

/** Тон секции по её порядковому номеру: соседние секции всегда разного цвета. */
const TONES = ['info', 'warn', 'ok', 'err'] as const;

interface Cell {
  at: number;
  text: string;
  /** `head` — номер секции и длина, `body` — содержимое. */
  part: 'head' | 'body';
}

interface Row {
  key: string;
  label: string;
  note: string;
  tone: (typeof TONES)[number] | 'ink';
  cells: Cell[];
  items: string[];
  code: { index: number; lines: string[] }[];
}

function cells(from: number, headEnd: number, to: number): Cell[] {
  const out: Cell[] = [];
  for (let at = from; at < to; at++) {
    out.push({ at, text: hex(props.bytes[at]), part: at < headEnd ? 'head' : 'body' });
  }
  return out;
}

const rows: Row[] = [
  {
    key: 'magic',
    label: 'магия и версия',
    note: '8 Б',
    tone: 'ink',
    cells: cells(0, 0, 8),
    items: ['00 61 73 6d — «\\0asm»', `версия ${decoded.version}, четыре байта little-endian`],
    code: [],
  },
  ...decoded.sections.map((s, i) => ({
    key: `s${s.id}`,
    label: `${s.id} · ${s.name}`,
    note: `${s.size} Б`,
    tone: TONES[i % TONES.length],
    cells: cells(s.start, s.contentStart, s.end),
    items: s.items,
    code: s.id === 10 ? decoded.functions.map((f) => ({ index: f.index, lines: f.code })) : [],
  })),
];

const selected = ref('s10');
const current = computed(() => rows.find((r) => r.key === selected.value) ?? rows[0]);

const text = ref(props.defaultText);
const a = ref(2147483647);
const b = ref(1);
const run = ref<ModuleRun | null>(null);
const busy = ref(false);
const failed = ref('');

async function execute() {
  busy.value = true;
  failed.value = '';
  try {
    run.value = await runModule(props.bytes, text.value, Number(a.value), Number(b.value));
  } catch (failure) {
    run.value = null;
    failed.value = failure instanceof Error ? `${failure.name}: ${failure.message}` : String(failure);
  } finally {
    busy.value = false;
  }
}

/** Память по 16 байт в строке — как в любом шестнадцатеричном просмотрщике. */
const memoryRows = computed(() => {
  const r = run.value;
  if (!r) return [];
  const out: { addr: string; cells: { text: string; changed: boolean; inString: boolean }[]; ascii: string }[] = [];
  for (let off = 0; off < WINDOW; off += 16) {
    const slice = r.after.slice(off, off + 16);
    out.push({
      addr: `0x${hex(off)}`,
      cells: slice.map((v, i) => ({
        text: hex(v),
        changed: v !== r.before[off + i],
        inString: off + i >= STRING_PTR && off + i < STRING_PTR + r.bytes,
      })),
      ascii: ascii(slice),
    });
  }
  return out;
});

const GROW_LINE =
  'после `memory.grow(1)`: прежний `memory.buffer` — `byteLength` {old}, `detached` {det}; у памяти новый буфер на {now} байт';
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="wasm-bar">
        <span class="wasm-bar__label">учебный модуль · {{ decoded.length }} байт · {{ decoded.sections.length }} секций</span>
        <span class="wasm-bar__hint">нажмите на строку, чтобы прочитать секцию</span>
      </div>
    </template>

    <div class="wasm-body">
      <div class="wasm-rows">
        <button
          v-for="row in rows"
          :key="row.key"
          type="button"
          class="wasm-row"
          :data-tone="row.tone"
          :aria-pressed="row.key === selected"
          @click="selected = row.key"
        >
          <span class="wasm-row__label">
            <span class="wasm-row__name">{{ row.label }}</span>
            <span class="wasm-row__size">{{ row.note }}</span>
          </span>
          <span class="wasm-row__bytes">
            <span v-for="c in row.cells" :key="c.at" class="wasm-byte" :data-part="c.part">{{ c.text }}</span>
          </span>
        </button>
      </div>

      <div class="wasm-detail" :data-tone="current.tone">
        <p class="wasm-detail__title">{{ current.label }}</p>
        <ul class="wasm-detail__items">
          <li v-for="item in current.items" :key="item">{{ item }}</li>
        </ul>
        <div v-for="fn in current.code" :key="fn.index" class="wasm-fn">
          <p class="wasm-fn__title">функция {{ fn.index }}</p>
          <pre class="wasm-fn__code">{{ fn.lines.join('\n') }}</pre>
        </div>
      </div>

      <div class="wasm-run">
        <label class="wasm-field">
          <span class="wasm-field__label">строка для upper</span>
          <input v-model="text" class="wasm-input" type="text" maxlength="24" aria-label="Строка, которую upper поднимет в верхний регистр" />
        </label>
        <label class="wasm-field wasm-field--num">
          <span class="wasm-field__label">add: a</span>
          <input v-model.number="a" class="wasm-input" type="number" aria-label="Первое слагаемое" />
        </label>
        <label class="wasm-field wasm-field--num">
          <span class="wasm-field__label">b</span>
          <input v-model.number="b" class="wasm-input" type="number" aria-label="Второе слагаемое" />
        </label>
        <Button variant="primary" :disabled="busy" @click="execute">исполнить в этой вкладке</Button>
      </div>

      <p v-if="failed" class="wasm-failed">{{ failed }}</p>
      <p v-else-if="!run" class="wasm-idle">Модуль ещё не создавался: разбор выше сделан декодером, исполнения не было.</p>

      <div v-if="run" class="wasm-out">
        <div class="wasm-facts">
          <span class="wasm-fact">
            add({{ run.add.a }}, {{ run.add.b }}) → <b>{{ run.add.result }}</b>
          </span>
          <span class="wasm-fact">
            строка: length {{ run.chars }}, байт UTF-8 <b>{{ run.bytes }}</b>, адрес {{ STRING_PTR }}
          </span>
          <span class="wasm-fact">env.report получил: <b>{{ run.reported.join(', ') || '—' }}</b></span>
          <span class="wasm-fact">table.get(0) === add: <b>{{ run.tableHoldsAdd }}</b></span>
        </div>

        <div class="wasm-mem" role="group" aria-label="Первые байты линейной памяти после upper">
          <div v-for="line in memoryRows" :key="line.addr" class="wasm-mem__row">
            <span class="wasm-mem__addr">{{ line.addr }}</span>
            <span class="wasm-mem__cells">
              <span
                v-for="(c, i) in line.cells"
                :key="i"
                class="wasm-mem__cell"
                :data-changed="c.changed ? 'yes' : 'no'"
                :data-string="c.inString ? 'yes' : 'no'"
              >{{ c.text }}</span>
            </span>
            <span class="wasm-mem__ascii">{{ line.ascii }}</span>
          </div>
        </div>
        <p class="wasm-legend">
          <span class="wasm-legend__swatch" data-kind="string" /> строка в памяти
          <span class="wasm-legend__swatch" data-kind="changed" /> байты, которые переписал upper
        </p>

        <p class="wasm-result">обратно из памяти: <b>{{ run.result }}</b></p>
        <Md
          class="wasm-grow"
          :text="
            GROW_LINE.replace('{old}', String(run.grow.oldByteLength))
              .replace('{det}', String(run.grow.oldDetached))
              .replace('{now}', String(run.grow.newByteLength))
          "
        />
      </div>
    </div>

    <template v-if="props.foot" #footer>
      <Md class="wasm-foot" :text="props.foot" />
    </template>
  </DemoFrame>
</template>

<style scoped>
.wasm-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px 14px;
}
.wasm-bar__label {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
}
.wasm-bar__hint {
  font-size: var(--fs-3);
  color: var(--text-faint);
}

.wasm-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
  padding: 20px;
}

.wasm-rows {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.wasm-row {
  display: grid;
  grid-template-columns: minmax(130px, 160px) minmax(0, 1fr);
  gap: 10px;
  align-items: start;
  width: 100%;
  margin: 0;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: var(--r1);
  background: var(--surface-2);
  font: inherit;
  color: inherit;
  text-align: start;
  cursor: pointer;
}
.wasm-row[aria-pressed='true'] {
  border-color: var(--border-strong);
  background: var(--surface);
  box-shadow: var(--shadow-1);
}
.wasm-row:focus-visible {
  outline: 2px solid var(--info);
  outline-offset: 2px;
}
.wasm-row__label {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.wasm-row__name {
  font-family: var(--mono);
  font-size: var(--fs-3);
  font-weight: 600;
  color: var(--ink);
}
.wasm-row__size {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-faint);
}
.wasm-row__bytes {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  min-width: 0;
}
.wasm-byte {
  display: inline-block;
  min-width: 2.2ch;
  padding: 2px 4px;
  border-radius: 4px;
  font-family: var(--mono);
  font-size: var(--fs-2);
  text-align: center;
}

.wasm-row[data-tone='ink'] .wasm-byte {
  background: var(--ink);
  color: var(--on-ink);
}
.wasm-row[data-tone='info'] .wasm-byte {
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
}
.wasm-row[data-tone='warn'] .wasm-byte {
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.wasm-row[data-tone='ok'] .wasm-byte {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.wasm-row[data-tone='err'] .wasm-byte {
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}
.wasm-row[data-tone='info'] .wasm-byte[data-part='head'] {
  background: var(--tone-info-chip);
  color: var(--tone-info-strong);
  font-weight: 700;
}
.wasm-row[data-tone='warn'] .wasm-byte[data-part='head'] {
  background: var(--tone-warn-chip);
  color: var(--tone-warn-strong);
  font-weight: 700;
}
.wasm-row[data-tone='ok'] .wasm-byte[data-part='head'] {
  background: var(--tone-ok-chip);
  color: var(--tone-ok-strong);
  font-weight: 700;
}
.wasm-row[data-tone='err'] .wasm-byte[data-part='head'] {
  background: var(--tone-err-chip);
  color: var(--tone-err-strong);
  font-weight: 700;
}

.wasm-detail {
  padding: 14px 16px;
  border-radius: var(--r2);
  border: 1px solid var(--divider);
  background: var(--sunk-dim);
}
.wasm-detail__title {
  margin: 0 0 8px;
  font-family: var(--mono);
  font-size: var(--fs-4);
  font-weight: 600;
  color: var(--ink);
}
.wasm-detail__items {
  margin: 0;
  padding-left: 18px;
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--text);
  overflow-wrap: anywhere;
}
.wasm-fn {
  margin-top: 10px;
}
.wasm-fn__title {
  margin: 0 0 4px;
  font-size: var(--fs-3);
  color: var(--text-muted);
}
.wasm-fn__code {
  margin: 0;
  padding: 10px 12px;
  max-height: 260px;
  overflow: auto;
  border-radius: var(--r1);
  background: var(--ink);
  color: var(--code-fg);
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.55;
}

.wasm-run {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 10px 14px;
}
.wasm-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1 1 200px;
  min-width: 0;
}
.wasm-field--num {
  flex: 0 1 140px;
}
.wasm-field__label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-faint);
}
.wasm-input {
  box-sizing: border-box;
  width: 100%;
  padding: 7px 9px;
  border: 1px solid var(--border-strong);
  border-radius: var(--r1);
  background: var(--surface);
  font: inherit;
  font-family: var(--mono);
  font-size: var(--fs-4);
  color: var(--text);
}
.wasm-input:focus-visible {
  outline: 2px solid var(--info);
  outline-offset: 1px;
}

.wasm-idle,
.wasm-failed {
  margin: 0;
  font-size: var(--fs-5);
  line-height: 1.55;
}
.wasm-idle {
  color: var(--text-muted);
}
.wasm-failed {
  font-family: var(--mono);
  color: var(--tone-err-strong);
}

.wasm-out {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.wasm-facts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.wasm-fact {
  padding: 5px 10px;
  border-radius: var(--r-full);
  background: var(--surface-2);
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text);
}

.wasm-mem {
  display: flex;
  flex-direction: column;
  gap: 3px;
  overflow-x: auto;
  padding: 10px 12px;
  border-radius: var(--r2);
  border: 1px solid var(--divider);
  background: var(--surface);
}
.wasm-mem__row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: max-content;
}
.wasm-mem__addr,
.wasm-mem__ascii {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-faint);
  white-space: pre;
}
.wasm-mem__cells {
  display: flex;
  gap: 2px;
}
.wasm-mem__cell {
  min-width: 2.2ch;
  padding: 1px 3px;
  border-radius: 3px;
  font-family: var(--mono);
  font-size: var(--fs-2);
  text-align: center;
  color: var(--dim);
}
.wasm-mem__cell[data-string='yes'] {
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
}
.wasm-mem__cell[data-changed='yes'] {
  background: var(--tone-ok-chip);
  color: var(--tone-ok-strong);
  font-weight: 700;
}

.wasm-legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 8px;
  margin: 0;
  font-size: var(--fs-3);
  color: var(--text-muted);
}
.wasm-legend__swatch {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 3px;
}
.wasm-legend__swatch[data-kind='string'] {
  background: var(--tone-info-bg);
  border: 1px solid var(--tone-info-line);
}
.wasm-legend__swatch[data-kind='changed'] {
  margin-left: 10px;
  background: var(--tone-ok-chip);
  border: 1px solid var(--tone-ok-line);
}

.wasm-result {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--fs-4);
  color: var(--text);
}
.wasm-grow {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--tone-warn-text);
}
.wasm-foot {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}
</style>
