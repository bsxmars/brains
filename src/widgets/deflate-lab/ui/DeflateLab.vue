<script setup lang="ts">
/**
 * «Весь путь на своём тексте»: токены LZ77 поверх текста, коды Хаффмана для них и разбор
 * настоящего gzip того же текста по битам.
 *
 * Считает не компонент, а строки кода из темы, собранные `new Function` (`model/run.ts`):
 * `lz77`, `blockBits`, `fixedBits`, `canonicalCodes`, `gunzip` и `inflateRaw`. Те же строки
 * напечатаны на странице и прогоняются `tests/unit/deflate.test.ts` против zlib, fflate и pako.
 * Сжатый поток для разбора делает `CompressionStream('gzip')` среды — в Chromium это zlib.
 * Компонент только раскладывает результат: подписи, подсветка, полосы.
 */
import { computed, onMounted, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { charStarts, describeReads, gzipText, litLenLabel, loadDeflate, tokenStarts, type ReadRow } from '../model/run';
import type { DeflateCodes, DeflatePreset, LabTab, ReadEvent, Token } from '../model/types';

const props = defineProps<{
  codes: DeflateCodes;
  presets: DeflatePreset[];
  start: LabTab;
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const api = loadDeflate(props.codes);
const enc = new TextEncoder();
const MAX_ROWS = 400;

const tab = ref<LabTab>(props.start);
const tabs = [
  { value: 'tokens', label: 'Токены LZ77' },
  { value: 'huffman', label: 'Коды Хаффмана' },
  { value: 'gzip', label: 'Настоящий gzip' },
];

const preset = ref(props.presets[0].id);
const presetOptions = props.presets.map((p) => ({ value: p.id, label: p.label }));
const text = ref(props.presets[0].text);
watch(preset, (id) => {
  const p = props.presets.find((x) => x.id === id);
  if (p) text.value = p.text;
});

const mode = ref<'lazy' | 'greedy'>('lazy');
const modes = [
  { value: 'lazy', label: 'лениво' },
  { value: 'greedy', label: 'жадно' },
];

const n = (x: number) => x.toLocaleString('ru-RU');
/** «1 пара», «3 пары», «5 пар». */
function plural(x: number, one: string, few: string, many: string) {
  const d = x % 10;
  const dd = x % 100;
  if (d === 1 && dd !== 11) return `${n(x)} ${one}`;
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return `${n(x)} ${few}`;
  return `${n(x)} ${many}`;
}

const bytes = computed(() => enc.encode(text.value));
const tokens = computed<Token[]>(() => api.lz77(bytes.value, { lazy: mode.value === 'lazy' ? 16 : 0 }));
const starts = computed(() => tokenStarts(tokens.value));
const pairs = computed(() => tokens.value.filter((t) => 'len' in t).length);

// ─── Токены поверх текста ───────────────────────────────────────────────────────────────────

const sel = ref(-1);
watch(tokens, (list) => {
  sel.value = list.findIndex((t) => 'len' in t);
}, { immediate: true });

const selected = computed(() => {
  const t = tokens.value[sel.value];
  return t && 'len' in t ? { ...t, at: starts.value[sel.value] } : null;
});

interface Seg {
  key: string;
  text: string;
  tok: number;
  match: boolean;
  src: boolean;
}

/** Текст, разрезанный по токенам; буква принадлежит токену, где лежит её первый байт. */
const segs = computed<Seg[]>(() => {
  const out: Seg[] = [];
  const st = starts.value;
  const s = selected.value;
  let ti = 0;
  for (const { ch, at } of charStarts(text.value)) {
    while (ti + 1 < st.length && st[ti + 1] <= at) ti++;
    const match = 'len' in (tokens.value[ti] ?? { lit: 0 });
    const src = !!s && at >= s.at - s.dist && at < s.at - s.dist + s.len;
    const last = out[out.length - 1];
    if (last && last.tok === ti && last.src === src) last.text += ch;
    else out.push({ key: `${ti}:${at}`, text: ch, tok: ti, match, src });
  }
  return out;
});

const dec = new TextDecoder();
const selectedNote = computed(() => {
  const s = selected.value;
  if (!s) return 'Ссылок нет: ни одна тройка байт не повторилась.';
  const copied = dec.decode(bytes.value.subarray(s.at, s.at + s.len));
  const overlap = s.dist < s.len ? ' Расстояние меньше длины: копия перекрывает сама себя и дочитывает только что записанное.' : '';
  // Байты ссылки могут начаться или кончиться посреди двухбайтовой буквы — декодер ставит там «�».
  const cut = copied.includes('\uFFFD') ? ' Граница ссылки режет букву пополам: она в UTF-8 из двух байт, половинка показана как «·».' : '';
  return `Пара \`(${s.dist}, ${s.len})\`: назад на ${s.dist} байт, скопировать ${s.len} — «${copied.replace(/\n/g, '⏎').replace(/\uFFFD/g, '·')}».${overlap}${cut}`;
});

function pick(i: number) {
  if ('len' in tokens.value[i]) sel.value = i;
}

// ─── Хаффман ────────────────────────────────────────────────────────────────────────────────

const stats = computed(() => api.blockBits(tokens.value));
const litCodes = computed(() => api.canonicalCodes(stats.value.litL));
const distCodes = computed(() => api.canonicalCodes(stats.value.distL));
const bin = (code: number, len: number) => code.toString(2).padStart(len, '0');

const litRows = computed(() => {
  const st = stats.value;
  const max = Math.max(...st.litF);
  return st.litF
    .map((f, s) => ({ s, f }))
    .filter((r) => r.f > 0)
    .sort((a, b) => b.f - a.f || a.s - b.s)
    .map((r) => ({
      key: r.s,
      label: litLenLabel(r.s, api),
      freq: r.f,
      width: `${(r.f / max) * 100}%`,
      len: st.litL[r.s],
      code: bin(litCodes.value[r.s], st.litL[r.s]),
    }));
});

const distRows = computed(() => {
  const st = stats.value;
  return st.distF
    .map((f, d) => ({ d, f }))
    .filter((r) => r.f > 0)
    .map((r) => {
      const lo = api.DIST_BASE[r.d];
      const hi = lo + 2 ** api.DIST_EXTRA[r.d] - 1;
      return { key: r.d, label: lo === hi ? `${lo}` : `${lo}–${hi}`, code: r.d, freq: r.f, len: st.distL[r.d], bits: bin(distCodes.value[r.d], st.distL[r.d]) };
    });
});

const totals = computed(() => {
  const raw = bytes.value.length * 8;
  const fixed = api.fixedBits(stats.value);
  const dyn = stats.value.bits;
  const max = Math.max(raw, fixed, dyn, 1);
  return [
    { k: 'без сжатия', v: raw, note: `${n(bytes.value.length)} байт по 8 бит`, w: raw / max, tone: 'neutral' },
    { k: 'fixed-коды', v: fixed, note: 'коды из RFC, заголовка нет', w: fixed / max, tone: 'info' },
    { k: 'свои коды', v: dyn, note: 'только данные: заголовок с длинами кодов сверху', w: dyn / max, tone: 'ok' },
  ];
});

// ─── Настоящий gzip ─────────────────────────────────────────────────────────────────────────

const gz = ref<Uint8Array | null>(null);
const gzError = ref('');
let ticket = 0;

async function compress() {
  const my = ++ticket;
  if (typeof CompressionStream === 'undefined') {
    gzError.value = 'В этом браузере нет CompressionStream — сжать текст нечем.';
    return;
  }
  try {
    const out = await gzipText(text.value);
    if (my === ticket) {
      gz.value = out;
      gzError.value = '';
    }
  } catch (e) {
    if (my === ticket) gzError.value = String(e);
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;
watch(text, () => {
  clearTimeout(timer);
  timer = setTimeout(compress, 250);
});
onMounted(compress);

const parsed = computed(() => {
  const g = gz.value;
  if (!g) return null;
  const events: ReadEvent[] = [];
  try {
    const res = api.gunzip(g, (what, value, from, to) => events.push({ what, value, from, to }));
    const rows: ReadRow[] = describeReads(events, g.subarray(res.at), api);
    return { res, rows, error: '' };
  } catch (e) {
    return { res: null, rows: [] as ReadRow[], error: String(e) };
  }
});

const hex = (b: number) => b.toString(16).padStart(2, '0');
const headRows = computed(() => {
  const g = gz.value;
  const p = parsed.value?.res;
  if (!g || !p) return [];
  return [
    { at: '0–1', k: 'ID1 ID2', v: `${hex(g[0])} ${hex(g[1])}`, d: 'метка gzip' },
    { at: '2', k: 'CM', v: hex(g[2]), d: 'метод 8 — DEFLATE' },
    { at: '3', k: 'FLG', v: hex(g[3]), d: p.flags ? `флаги ${p.flags}` : 'флагов нет' },
    { at: '4–7', k: 'MTIME', v: [...g.subarray(4, 8)].map(hex).join(' '), d: p.mtime ? `время ${p.mtime}` : 'время не указано' },
    { at: '8', k: 'XFL', v: hex(g[8]), d: g[8] === 2 ? 'сжато сильнее всего' : g[8] === 4 ? 'сжато быстрее всего' : 'уровень по умолчанию' },
    { at: '9', k: 'OS', v: hex(g[9]), d: `система ${g[9]}` },
  ];
});

const tailRows = computed(() => {
  const g = gz.value;
  const p = parsed.value?.res;
  if (!g || !p) return [];
  return [
    { at: `${p.end}–${p.end + 3}`, k: 'CRC32', v: [...g.subarray(p.end, p.end + 4)].map(hex).join(' '), d: `0x${p.crc.toString(16).padStart(8, '0')}, little-endian` },
    { at: `${p.end + 4}–${p.end + 7}`, k: 'ISIZE', v: [...g.subarray(p.end + 4, p.end + 8)].map(hex).join(' '), d: `${p.isize} байт исходника — сходится` },
  ];
});

const shownRows = computed(() => (parsed.value?.rows ?? []).slice(0, MAX_ROWS));
const hiddenRows = computed(() => Math.max(0, (parsed.value?.rows.length ?? 0) - MAX_ROWS));
const gzSummary = computed(() => {
  const g = gz.value;
  const p = parsed.value?.res;
  if (!g || !p) return '';
  const blocks = (parsed.value?.rows ?? []).filter((r) => r.field === 'BTYPE').length;
  return `gzip — **${n(g.length)} байт**: заголовок ${p.at}, поток DEFLATE ${p.end - p.at} (${blocks === 1 ? 'один блок' : `блоков: ${blocks}`}), хвост 8. Исходник — ${n(bytes.value.length)} байт.`;
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="dl-tools">
        <SegmentedControl v-model="tab" class="l-pills" label="Что показать" :options="tabs" />
        <SegmentedControl v-model="preset" class="l-pills" label="Текст" :options="presetOptions" />
      </div>
    </template>

    <div class="dl-body">
      <label class="dl-field">
        <span class="dl-label">текст — можно править, до 2000 знаков</span>
        <textarea v-model="text" class="dl-input" rows="5" maxlength="2000" spellcheck="false" />
      </label>

      <template v-if="tab === 'tokens'">
        <div class="dl-row">
          <SegmentedControl v-model="mode" class="l-pills" label="Поиск" :options="modes" />
          <span class="dl-stat">
            {{ plural(bytes.length, 'байт', 'байта', 'байт') }} → <b>{{ plural(tokens.length, 'токен', 'токена', 'токенов') }}</b>:
            {{ plural(tokens.length - pairs, 'литерал', 'литерала', 'литералов') }} и {{ plural(pairs, 'пара', 'пары', 'пар') }}
          </span>
        </div>

        <div class="dl-text" aria-label="Текст, разрезанный на токены">
          <template v-for="s in segs" :key="s.key">
            <span
              v-if="s.match"
              class="dl-tok dl-tok--match"
              :data-on="s.tok === sel ? 'yes' : 'no'"
              :data-src="s.src ? 'yes' : 'no'"
              role="button"
              tabindex="0"
              :aria-pressed="s.tok === sel"
              @click="pick(s.tok)"
              @keydown.enter.prevent="pick(s.tok)"
              @keydown.space.prevent="pick(s.tok)"
            >{{ s.text }}</span>
            <span v-else class="dl-tok" :data-src="s.src ? 'yes' : 'no'">{{ s.text }}</span>
          </template>
        </div>

        <div class="dl-legend">
          <span class="dl-tok dl-tok--match dl-chip">ссылка</span>
          <span class="dl-tok dl-tok--match dl-chip" data-on="yes">выбранная</span>
          <span class="dl-tok dl-chip" data-src="yes">откуда она копирует</span>
          <span>остальное — литералы</span>
        </div>

        <Md class="dl-note" :text="selectedNote" />
      </template>

      <template v-else-if="tab === 'huffman'">
        <div class="dl-totals">
          <div v-for="r in totals" :key="r.k" class="dl-total">
            <span class="dl-total__k">{{ r.k }}</span>
            <span class="dl-total__bar"><span class="dl-total__fill" :data-tone="r.tone" :style="{ width: `${r.w * 100}%` }" /></span>
            <b class="dl-total__v">{{ n(r.v) }} бит</b>
            <span class="dl-total__note">{{ r.note }}</span>
          </div>
        </div>

        <div class="dl-scroll">
          <table class="dl-table">
            <caption class="dl-label">литералы и длины: {{ litRows.length }} символов</caption>
            <thead>
              <tr><th>символ</th><th>сколько раз</th><th>бит</th><th>код</th></tr>
            </thead>
            <tbody>
              <tr v-for="r in litRows" :key="r.key">
                <td>{{ r.label }}</td>
                <td class="dl-freq"><span class="dl-freq__bar" :style="{ width: r.width }" /><span class="dl-freq__n">{{ r.freq }}</span></td>
                <td>{{ r.len }}</td>
                <td><code>{{ r.code }}</code></td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="distRows.length" class="dl-scroll dl-scroll--short">
          <table class="dl-table">
            <caption class="dl-label">расстояния</caption>
            <thead>
              <tr><th>код</th><th>расстояние</th><th>сколько раз</th><th>бит</th><th>код Хаффмана</th></tr>
            </thead>
            <tbody>
              <tr v-for="r in distRows" :key="r.key">
                <td>{{ r.code }}</td>
                <td>{{ r.label }}</td>
                <td>{{ r.freq }}</td>
                <td>{{ r.len }}</td>
                <td><code>{{ r.bits || '—' }}</code></td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <template v-else>
        <p v-if="gzError" class="dl-problem">{{ gzError }}</p>
        <p v-else-if="!parsed" class="dl-note">Сжимаю…</p>
        <p v-else-if="parsed.error" class="dl-problem">{{ parsed.error }}</p>
        <template v-else>
          <Md class="dl-note" :text="gzSummary" />

          <div class="dl-scroll dl-scroll--short">
            <table class="dl-table">
              <caption class="dl-label">заголовок gzip, байты</caption>
              <tbody>
                <tr v-for="r in headRows" :key="r.k">
                  <td>{{ r.at }}</td><td>{{ r.k }}</td><td><code>{{ r.v }}</code></td><td>{{ r.d }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="dl-scroll dl-scroll--tall">
            <table class="dl-table dl-table--reads">
              <caption class="dl-label">поток DEFLATE: каждое чтение распаковщика</caption>
              <thead>
                <tr><th>биты №</th><th>биты</th><th>поле</th><th>значение</th><th>что значит</th></tr>
              </thead>
              <tbody>
                <tr v-for="r in shownRows" :key="r.key" :data-kind="r.kind">
                  <td class="dl-num">{{ r.from }}–{{ r.to - 1 }}</td>
                  <td><code>{{ r.bits }}</code></td>
                  <td>{{ r.field }}</td>
                  <td class="dl-num">{{ r.value }}</td>
                  <td>{{ r.meaning }}</td>
                </tr>
              </tbody>
            </table>
            <p v-if="hiddenRows" class="dl-note">… и ещё {{ n(hiddenRows) }} чтений.</p>
          </div>

          <div class="dl-scroll dl-scroll--short">
            <table class="dl-table">
              <caption class="dl-label">хвост gzip, байты</caption>
              <tbody>
                <tr v-for="r in tailRows" :key="r.k">
                  <td>{{ r.at }}</td><td>{{ r.k }}</td><td><code>{{ r.v }}</code></td><td>{{ r.d }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </template>

      <Md class="dl-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.dl-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
  align-items: center;
}
.dl-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.dl-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.dl-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
  text-align: left;
  padding-bottom: 6px;
}
.dl-input {
  font: inherit;
  color: inherit;
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.6;
  padding: 8px 10px;
  border: 1px solid var(--border-strong);
  border-radius: var(--r2);
  background: var(--surface);
  resize: vertical;
  min-width: 0;
}
.dl-input:focus-visible {
  outline: 2px solid var(--ink);
  outline-offset: 1px;
}
.dl-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
  align-items: center;
}
.dl-stat,
.dl-note,
.dl-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
  margin: 0;
}
.dl-note :deep(code),
.dl-caption :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
.dl-problem {
  margin: 0;
  font-size: var(--fs-3);
  color: var(--tone-err-text);
}

.dl-text {
  padding: 14px 16px;
  border-radius: var(--r3);
  background: var(--surface-2);
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.9;
  color: var(--ink);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.dl-tok--match {
  border-radius: 3px;
  background: var(--tone-info-bg);
  box-shadow: inset 0 0 0 1px var(--tone-info-line);
  color: var(--tone-info-text);
  cursor: pointer;
}
.dl-tok--match:hover,
.dl-tok--match:focus-visible {
  outline: 2px solid var(--tone-info-line);
  outline-offset: 0;
}
.dl-tok[data-src='yes'] {
  background: var(--tone-ok-bg);
  box-shadow: inset 0 -2px 0 var(--tone-ok-line);
  color: var(--tone-ok-text);
}
.dl-tok--match[data-on='yes'] {
  background: var(--tone-warn-bg);
  box-shadow: inset 0 0 0 1px var(--tone-warn-line);
  color: var(--tone-warn-text);
}
.dl-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  align-items: center;
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.dl-chip {
  padding: 1px 6px;
  font-family: var(--mono);
  font-size: var(--fs-2);
}

.dl-totals {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dl-total {
  display: grid;
  grid-template-columns: minmax(90px, 0.6fr) minmax(80px, 1.4fr) minmax(80px, 0.5fr);
  gap: 4px 12px;
  align-items: center;
  font-size: var(--fs-3);
  color: var(--prose);
}
.dl-total__bar {
  height: 10px;
  border-radius: var(--r1);
  background: var(--surface-3);
  overflow: hidden;
}
.dl-total__fill {
  display: block;
  height: 100%;
  background: var(--bar-neutral);
}
.dl-total__fill[data-tone='info'] {
  background: var(--tone-info-line);
}
.dl-total__fill[data-tone='ok'] {
  background: var(--tone-ok-line);
}
.dl-total__v {
  font-family: var(--mono);
  color: var(--ink);
  text-align: right;
}
.dl-total__note {
  grid-column: 1 / -1;
  font-size: var(--fs-2);
  color: var(--text-muted);
}

.dl-scroll {
  max-height: 360px;
  overflow: auto;
  border-radius: var(--r3);
  background: var(--surface-2);
  padding: 10px 12px;
}
.dl-scroll--short {
  max-height: none;
}
.dl-scroll--tall {
  max-height: 460px;
}
.dl-table {
  width: 100%;
  min-width: 340px;
  border-collapse: collapse;
  font-size: var(--fs-3);
  color: var(--prose);
}
.dl-table--reads {
  min-width: 620px;
}
.dl-table th {
  font-family: var(--mono);
  font-size: var(--fs-2);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
  text-align: left;
  padding: 4px 8px 6px 0;
}
.dl-table td {
  padding: 4px 8px 4px 0;
  border-top: 1px solid var(--hairline);
  vertical-align: baseline;
}
.dl-table code {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
  white-space: nowrap;
}
.dl-num {
  font-family: var(--mono);
  white-space: nowrap;
}
.dl-table--reads tr[data-kind='block'] td:first-child {
  box-shadow: inset 3px 0 0 var(--tone-warn-line);
  padding-left: 8px;
}
.dl-table--reads tr[data-kind='table'] td:first-child {
  box-shadow: inset 3px 0 0 var(--tone-info-line);
  padding-left: 8px;
}
.dl-table--reads tr[data-kind='data'] td:first-child {
  box-shadow: inset 3px 0 0 var(--tone-ok-line);
  padding-left: 8px;
}
.dl-freq {
  position: relative;
  min-width: 90px;
}
.dl-freq__bar {
  position: absolute;
  left: 0;
  top: 25%;
  height: 50%;
  border-radius: var(--r1);
  background: var(--tone-info-bg);
}
.dl-freq__n {
  position: relative;
  font-family: var(--mono);
  padding-left: 4px;
}
</style>
