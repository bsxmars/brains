<script setup lang="ts">
/**
 * «Сегмент за сегментом»: сгенерированный код, разрезанный по сегментам карты, разбор
 * выбранного сегмента по буквам VLQ и место в исходнике, куда он ведёт.
 *
 * Числа считает не компонент, а строки `VLQ_CODE` и `LOOKUP_CODE` из темы, собранные
 * `new Function` (`model/run.ts`). Те же строки напечатаны на странице и прогоняются
 * `tests/unit/source-maps.test.ts` против `@jridgewell/sourcemap-codec` и `trace-mapping`.
 * Компонент только раскладывает буквы сегмента по битам — это подпись, а не расчёт.
 */
import { computed, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { loadLookup, loadVlq } from '../model/run';
import type { MapExample, Segment } from '../model/types';

const props = defineProps<{
  vlqCode: string;
  lookupCode: string;
  examples: MapExample[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const vlq = loadVlq(props.vlqCode);
const lookup = loadLookup(props.lookupCode);

const picked = ref(props.examples[0].id);
const options = props.examples.map((e) => ({ value: e.id, label: e.label }));
const example = computed(() => props.examples.find((e) => e.id === picked.value) ?? props.examples[0]);

const lines = computed<Segment[][]>(() => vlq.decodeMappings(example.value.map.mappings));
/** Сегменты буквами — в том же порядке, что и после разбора: пустые пропускаются так же. */
const rawLines = computed(() =>
  example.value.map.mappings.split(';').map((l) => l.split(',').filter(Boolean)),
);
const genLines = computed(() => example.value.generated.split('\n'));

const sel = ref<[number, number]>([...props.examples[0].start] as [number, number]);
watch(example, (e) => {
  sel.value = [...e.start] as [number, number];
});

interface Chunk {
  key: string;
  text: string;
  /** Номер сегмента в строке; `-1` — код левее первого сегмента. */
  seg: number;
  mapped: boolean;
}

/** Строки сгенерированного кода, разрезанные по началам сегментов. */
const chunks = computed<Chunk[][]>(() =>
  genLines.value.map((text, li) => {
    const segs = lines.value[li] ?? [];
    const out: Chunk[] = [];
    if (!segs.length || segs[0][0] > 0) {
      out.push({ key: `${li}:pre`, text: text.slice(0, segs[0]?.[0] ?? text.length), seg: -1, mapped: false });
    }
    segs.forEach((s, si) => {
      const end = segs[si + 1]?.[0] ?? text.length;
      out.push({ key: `${li}:${si}`, text: text.slice(s[0], end), seg: si, mapped: s.length > 1 });
    });
    return out;
  }),
);

const segment = computed<Segment | undefined>(() => lines.value[sel.value[0]]?.[sel.value[1]]);
const raw = computed(() => rawLines.value[sel.value[0]]?.[sel.value[1]] ?? '');

/** Буквы сегмента по битам: символ, шесть бит, бит продолжения, пять бит данных. */
const letters = computed(() =>
  [...raw.value].map((ch) => {
    const digit = vlq.B64.indexOf(ch);
    return {
      ch,
      bits: digit.toString(2).padStart(6, '0'),
      more: (digit & 32) !== 0,
      data: (digit & 31).toString(2).padStart(5, '0'),
    };
  }),
);

/** Разницы, как они записаны в сегменте, — тем же `readVlq`. */
const deltas = computed(() => {
  const out: number[] = [];
  for (let pos = 0; pos < raw.value.length; ) {
    const [v, next] = vlq.readVlq(raw.value, pos);
    out.push(v);
    pos = next;
  }
  return out;
});

const FIELD = ['колонка в бандле', 'номер файла', 'строка исходника', 'колонка исходника', 'номер имени'];

const fields = computed(() =>
  (segment.value ?? []).map((abs, i) => ({
    name: FIELD[i],
    delta: deltas.value[i] ?? 0,
    abs,
    note:
      i === 1
        ? example.value.map.sources[abs]
        : i === 4
          ? example.value.map.names[abs]
          : i === 2
            ? `${abs + 1}-я с единицы`
            : '',
  })),
);

const sign = (n: number) => (n > 0 ? `+${n}` : String(n));

const position = computed(() => {
  const s = segment.value;
  if (!s) return null;
  return lookup(example.value.map, lines.value, sel.value[0] + 1, s[0]);
});

const sourceIndex = computed(() => (segment.value && segment.value.length > 1 ? segment.value[1] : 0));
const sourceName = computed(() => example.value.map.sources[sourceIndex.value].replace(/^(\.\.\/)+/, ''));
const sourceLines = computed(() => example.value.map.sourcesContent[sourceIndex.value].replace(/\n$/, '').split('\n'));

/** Подсветка в исходнике: от колонки сегмента до конца слова или одного знака. */
function mark(text: string, col: number) {
  const rest = text.slice(col);
  const len = /^[\p{L}\p{N}_$]+/u.exec(rest)?.[0].length ?? 1;
  return { before: text.slice(0, col), hit: text.slice(col, col + len), after: text.slice(col + len) };
}

const stackLine = computed(() => {
  const s = segment.value;
  const p = position.value;
  if (!s) return '';
  const gen = `строка ${sel.value[0] + 1}, колонка ${s[0] + 1}`;
  if (!p) return `Позиция бандла ${gen} никуда не ведёт: у сегмента нет источника.`;
  const file = p.source.replace(/^(\.\.\/)+/, '');
  return `Стек с позицией бандла \`${gen}\` отладчик покажет как \`${file}:${p.line}:${p.column + 1}\`${p.name ? `, имя \`${p.name}\`` : ''}.`;
});

function pick(li: number, si: number) {
  sel.value = [li, si];
}
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="picked" class="l-pills" label="Пример" :options="options" />
    </template>

    <div class="sm-body">
      <Md class="sm-note" :text="example.note" />

      <div class="sm-split">
        <div class="sm-pane">
          <span class="sm-label">сгенерированный код — нажмите на кусок</span>
          <pre class="sm-code"><template v-for="(line, li) in chunks" :key="li"><template v-for="c in line" :key="c.key"><span
            v-if="c.seg < 0"
            class="sm-chunk sm-chunk--pre"
          >{{ c.text }}</span><span
            v-else
            class="sm-chunk"
            :data-mapped="c.mapped ? 'yes' : 'no'"
            :data-on="li === sel[0] && c.seg === sel[1] ? 'yes' : 'no'"
            role="button"
            tabindex="0"
            :aria-pressed="li === sel[0] && c.seg === sel[1]"
            :aria-label="`Сегмент ${c.seg + 1} строки ${li + 1}`"
            @click="pick(li, c.seg)"
            @keydown.enter.prevent="pick(li, c.seg)"
            @keydown.space.prevent="pick(li, c.seg)"
          >{{ c.text }}</span></template>{{ li < chunks.length - 1 ? '\n' : '' }}</template></pre>
        </div>

        <div class="sm-pane">
          <span class="sm-label">исходник: {{ sourceName }}</span>
          <pre class="sm-code sm-code--src"><template v-for="(text, i) in sourceLines" :key="i"><span class="sm-ln">{{ String(i + 1).padStart(2, ' ') }}</span><template
            v-if="position && segment && segment[2] === i"
          ><span class="sm-line-on">{{ mark(text, segment[3]).before }}<mark class="sm-hit">{{ mark(text, segment[3]).hit }}</mark>{{ mark(text, segment[3]).after }}</span></template><template v-else>{{ text }}</template>{{ '\n' }}</template></pre>
        </div>
      </div>

      <div class="sm-decode">
        <div class="sm-letters" role="table" aria-label="Буквы сегмента по битам">
          <div class="sm-letters__head" role="row">
            <span role="columnheader">буква</span>
            <span role="columnheader">6 бит</span>
            <span role="columnheader">дальше</span>
            <span role="columnheader">данные</span>
          </div>
          <div v-for="(l, i) in letters" :key="i" class="sm-letters__row" role="row">
            <code role="cell" class="sm-letter">{{ l.ch }}</code>
            <code role="cell"><span class="sm-bit-more" :data-on="l.more ? 'yes' : 'no'">{{ l.bits[0] }}</span>{{ l.bits.slice(1) }}</code>
            <span role="cell">{{ l.more ? 'да' : 'нет' }}</span>
            <code role="cell">{{ l.data }}</code>
          </div>
        </div>

        <div class="sm-fields">
          <span class="sm-label">сегмент <code>{{ raw }}</code>: разница → итог</span>
          <div v-for="f in fields" :key="f.name" class="sm-field">
            <span class="sm-field__name">{{ f.name }}</span>
            <code class="sm-field__delta">{{ sign(f.delta) }}</code>
            <code class="sm-field__abs">{{ f.abs }}</code>
            <span class="sm-field__note">{{ f.note }}</span>
          </div>
          <Md class="sm-stack" :text="stackLine" />
        </div>
      </div>

      <Md class="sm-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.sm-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.sm-note,
.sm-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.sm-note :deep(code),
.sm-caption :deep(code),
.sm-stack :deep(code),
.sm-label code {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}

.sm-split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 760px) {
  .sm-split {
    grid-template-columns: minmax(0, 1fr);
  }
}

.sm-pane {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.sm-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.sm-code {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.75;
  /* Подложка — общая для кода курса (`pre` в base.css, чернильная): цвета ниже — «на чернилах». */
  color: var(--code-fg);
  white-space: pre-wrap;
  word-break: break-all;
}
.sm-code--src {
  white-space: pre;
  word-break: normal;
  overflow-x: auto;
}

.sm-chunk {
  border-radius: 3px;
  cursor: pointer;
  /* Граница сегмента видна тонкой чертой слева: куски идут вплотную. */
  box-shadow: inset 1px 0 0 var(--ink-line);
}
.sm-chunk--pre {
  cursor: default;
  box-shadow: none;
  color: var(--ink-faint);
}
.sm-chunk[data-mapped='no'] {
  color: var(--ink-faint);
}
.sm-chunk:hover,
.sm-chunk:focus-visible {
  background: var(--ink-chip);
  outline: none;
}
.sm-chunk[data-on='yes'] {
  background: var(--warn-wash-on-ink);
  color: var(--tone-warn-on-ink);
  box-shadow: inset 0 0 0 1px var(--tone-warn-accent);
}

.sm-ln {
  display: inline-block;
  width: 2.6em;
  color: var(--ink-faint);
  user-select: none;
}
.sm-line-on {
  background: var(--ink-chip);
}
.sm-hit {
  border-radius: 3px;
  background: var(--warn-wash-on-ink);
  color: var(--tone-warn-on-ink);
  box-shadow: inset 0 0 0 1px var(--tone-warn-accent);
}

.sm-decode {
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 760px) {
  .sm-decode {
    grid-template-columns: minmax(0, 1fr);
  }
}

.sm-letters {
  display: flex;
  flex-direction: column;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
  font-size: var(--fs-3);
  color: var(--prose);
}
.sm-letters__head,
.sm-letters__row {
  display: grid;
  grid-template-columns: 3.5em 5.5em 4em 1fr;
  gap: 8px;
  padding: 5px 0;
  align-items: baseline;
}
.sm-letters__head {
  font-family: var(--mono);
  font-size: var(--fs-2);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}
.sm-letters__row + .sm-letters__row,
.sm-letters__head + .sm-letters__row {
  border-top: 1px solid var(--hairline);
}
.sm-letters code,
.sm-fields code {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
}
.sm-letter {
  font-weight: 600;
}
.sm-bit-more[data-on='yes'] {
  color: var(--tone-warn-text);
  font-weight: 600;
}

.sm-fields {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.sm-field {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) 3.5em 3em minmax(0, 1.2fr);
  gap: 8px;
  align-items: baseline;
  padding: 6px 10px;
  border-radius: var(--r2);
  background: var(--surface-2);
  font-size: var(--fs-3);
  color: var(--prose);
}
.sm-field__delta {
  color: var(--text-muted) !important;
}
.sm-field__abs {
  font-weight: 600;
}
.sm-field__note {
  overflow-wrap: anywhere;
  color: var(--text-muted);
  font-size: var(--fs-2);
}
.sm-stack {
  margin-top: 6px;
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
</style>
