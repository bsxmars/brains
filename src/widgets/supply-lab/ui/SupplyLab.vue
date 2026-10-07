<script setup lang="ts">
/**
 * «Один байт»: байты файла пакета или CDN-скрипта, запись с его хешем и ответ того, кто
 * сверяет. Нажатие на байт меняет его младший бит.
 *
 * Хеши и решение считает не компонент, а строка `SRI_CODE` из темы, собранная `new Function`
 * (`model/run.ts`): та же строка напечатана на странице и сверяется
 * `tests/unit/supply-chain.test.ts` с `ssri` и с Chromium. На чём остановится npm — распаковка
 * или хеш — решает `npmOutcome` (сверен тестом с настоящим `npm ci`). Тексты сообщений —
 * шаблоны, снятые стендом; компонент только подставляет в них хеши.
 */
import { computed, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button, SegmentedControl } from '@/shared/ui';
import { fill, fromBase64, loadSri, npmOutcome, upperAlg } from '../model/run';
import type { IntegrityCheck, SupplyDemo } from '../model/types';

const props = defineProps<{
  sriCode: string;
  demo: SupplyDemo;
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const sri = loadSri(props.sriCode);

type Artifact = 'tgz' | 'js';
const artifact = ref<Artifact>('tgz');
const artifactOptions = [
  { value: 'tgz', label: 'greeter-1.0.0.tgz' },
  { value: 'js', label: 'lib.js на CDN' },
];
const variantId = ref(props.demo.variants[0].id);
const variantOptions = props.demo.variants.map((v) => ({ value: v.id, label: v.label }));
const variant = computed(() => props.demo.variants.find((v) => v.id === variantId.value) ?? props.demo.variants[0]);

const ORIGINAL: Record<Artifact, Uint8Array> = {
  tgz: fromBase64(props.demo.tarball),
  js: new TextEncoder().encode(props.demo.libJs),
};

/** Номера изменённых байтов — отдельно для каждого файла. */
const flips = ref<Record<Artifact, number[]>>({ tgz: [], js: [] });
const flipped = computed(() => new Set(flips.value[artifact.value]));

const bytes = computed(() => {
  const b = ORIGINAL[artifact.value].slice();
  for (const i of flips.value[artifact.value]) b[i] ^= 1;
  return b;
});

function toggle(i: number) {
  const list = flips.value[artifact.value];
  flips.value[artifact.value] = list.includes(i) ? list.filter((x) => x !== i) : [...list, i];
}
function reset() {
  flips.value[artifact.value] = [];
}

const hex = (n: number) => n.toString(16).padStart(2, '0');
const PER_ROW = 16;
const rows = computed(() => {
  const b = bytes.value;
  const out: { offset: string; cells: { i: number; hex: string; ch: string }[] }[] = [];
  for (let start = 0; start < b.length; start += PER_ROW) {
    const cells = [];
    for (let i = start; i < Math.min(start + PER_ROW, b.length); i++) {
      const c = b[i];
      cells.push({ i, hex: hex(c), ch: c === 10 ? '↵' : c >= 32 && c < 127 ? String.fromCharCode(c) : '·' });
    }
    out.push({ offset: start.toString(16).padStart(4, '0'), cells });
  }
  return out;
});

/** Области gzip: заголовок 10 байт, сжатые данные, хвост — CRC32 и длина, 8 байт. */
function region(i: number): 'head' | 'data' | 'tail' | 'text' {
  if (artifact.value === 'js') return 'text';
  const n = ORIGINAL.tgz.length;
  if (i < 10) return 'head';
  if (i >= n - 8) return 'tail';
  return 'data';
}

const record = computed(() =>
  artifact.value === 'tgz'
    ? `"integrity": "${props.demo.lockIntegrity}"`
    : `<script src="${props.demo.libUrl}"\n  integrity="${variant.value.integrity}"\n  crossorigin="anonymous">`,
);

interface Result {
  /** Что пересчитано: алгоритм и хеш сейчас — для каждого, кто сверяет (без повторов). */
  hashes: { who: string; alg: string | null; got: string | null; match: boolean }[];
  /** Тон: `ok` — файл принят, `err` — отказ, `warn` — принят без проверки. */
  lines: { who: string; tone: 'ok' | 'err' | 'warn'; text: string; code: string }[];
}
const result = ref<Result | null>(null);

function browserLine(check: IntegrityCheck) {
  const pass = sri.verdict(check, 'browser') === 'pass';
  if (check.result === 'none') {
    return { who: 'Chromium', tone: 'warn' as const, text: 'выполнен **без проверки**: в атрибуте нет ни одного годного хеша', code: '' };
  }
  if (pass) return { who: 'Chromium', tone: 'ok' as const, text: 'выполнен: хеш совпал', code: '' };
  return {
    who: 'Chromium',
    tone: 'err' as const,
    text: 'заблокирован, сработал `onerror`',
    code: fill(props.demo.chromiumBlocked, { url: props.demo.libUrl, ALG: upperAlg(check.alg ?? ''), got: check.got ?? '' }),
  };
}

function ssriLine(check: IntegrityCheck) {
  if (sri.verdict(check, 'npm') === 'pass') return { who: 'ssri (npm)', tone: 'ok' as const, text: 'проверка пройдена', code: '' };
  return {
    who: 'ssri (npm)',
    tone: 'err' as const,
    text: check.result === 'none' ? 'отказ: годных хешей нет, проверять не с чем' : `отказ: ${check.alg} не совпал`,
    code: '',
  };
}

let seq = 0;
async function recompute() {
  const my = ++seq;
  const b = bytes.value;
  let next: Result;
  if (artifact.value === 'tgz') {
    const check = await sri.checkIntegrity(b, props.demo.lockIntegrity, 'npm');
    const pass = sri.verdict(check, 'npm') === 'pass';
    let line: Result['lines'][number];
    if (pass) {
      line = { who: 'npm ci', tone: 'ok', text: 'архив принят, пакет ставится', code: '' };
    } else if ((await npmOutcome(b)) === 'zlib') {
      line = { who: 'npm ci', tone: 'err', text: 'gzip не распаковывается — npm падает на распаковке раньше, чем досчитан хеш', code: props.demo.npmZlibError };
    } else {
      line = {
        who: 'npm ci',
        tone: 'err',
        text: 'архив распаковался бы, но хеш другой',
        code: fill(props.demo.npmIntegrityError, { wanted: props.demo.lockIntegrity, alg: check.alg ?? '', got: `${check.alg}-${check.got}`, size: b.length }),
      };
    }
    next = { hashes: [{ who: 'npm', alg: check.alg, got: check.got, match: pass }], lines: [line] };
  } else {
    const text = variant.value.integrity;
    const [cb, cn] = await Promise.all([sri.checkIntegrity(b, text, 'browser'), sri.checkIntegrity(b, text, 'npm')]);
    const hashes = [{ who: 'Chromium', alg: cb.alg, got: cb.got, match: cb.result === 'match' }];
    if (cn.alg !== cb.alg) hashes.push({ who: 'ssri', alg: cn.alg, got: cn.got, match: cn.result === 'match' });
    next = { hashes, lines: [browserLine(cb), ssriLine(cn)] };
  }
  if (my === seq) result.value = next;
}

watch([bytes, variantId, artifact], recompute, { immediate: true });

const note = computed(() =>
  artifact.value === 'tgz'
    ? 'Тарбол пакета `greeter` из первого раздела, 602 байта. Первые 10 — заголовок gzip, последние 8 — контрольная сумма и длина, между ними сжатые файлы. Сверяет `npm ci` с записью lock-файла.'
    : variant.value.note,
);

const hashText = (h: Result['hashes'][number]) => (h.alg ? `${h.alg}-${h.got}` : '—');

const hashLine = computed(() => {
  const r = result.value;
  if (!r) return '';
  return r.hashes
    .map((h) => {
      const who = r.hashes.length > 1 ? `${h.who}: ` : '';
      return h.alg
        ? `${who}пересчитан только \`${h.alg}\` — сильнейший из тех, что он знает.`
        : `${who}в записи нет хеша, который он умеет разобрать, — пересчитывать нечего.`;
    })
    .join(' ');
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="sl-tools">
        <SegmentedControl v-model="artifact" class="l-pills" label="Файл" :options="artifactOptions" />
        <SegmentedControl v-if="artifact === 'js'" v-model="variantId" class="l-pills" label="integrity" :options="variantOptions" />
      </div>
    </template>

    <div class="sl-body">
      <Md class="sl-note" :text="note" />

      <div class="sl-pane">
        <div class="sl-pane__head">
          <span class="sl-label">байты · изменено {{ flipped.size }}</span>
          <Button variant="secondary" :disabled="flipped.size === 0" @click="reset">Вернуть исходные</Button>
        </div>
        <div class="sl-scroll">
          <div class="sl-grid" role="group" :aria-label="`Байты файла ${artifact === 'tgz' ? 'greeter-1.0.0.tgz' : 'lib.js'}`">
            <div v-for="row in rows" :key="row.offset" class="sl-row">
              <span class="sl-offset">{{ row.offset }}</span>
              <button
                v-for="c in row.cells"
                :key="c.i"
                type="button"
                class="sl-byte"
                :data-region="region(c.i)"
                :data-on="flipped.has(c.i) ? 'yes' : 'no'"
                :aria-pressed="flipped.has(c.i)"
                :aria-label="`Байт ${c.i}: ${c.hex}`"
                @click="toggle(c.i)"
              >
                <span class="sl-hex">{{ c.hex }}</span>
                <span v-if="artifact === 'js'" class="sl-ch">{{ c.ch }}</span>
              </button>
            </div>
          </div>
        </div>
        <div v-if="artifact === 'tgz'" class="sl-legend">
          <span class="sl-key" data-region="head">заголовок gzip</span>
          <span class="sl-key" data-region="data">сжатые данные</span>
          <span class="sl-key" data-region="tail">CRC32 и длина</span>
        </div>
      </div>

      <div class="sl-split">
        <div class="sl-pane">
          <span class="sl-label">{{ artifact === 'tgz' ? 'запись в package-lock.json' : 'тег на странице' }}</span>
          <pre class="sl-code">{{ record }}</pre>
        </div>
        <div class="sl-pane">
          <span class="sl-label">хеш байтов сейчас</span>
          <pre v-for="h in result?.hashes ?? []" :key="h.who" class="sl-code" :data-match="h.match ? 'yes' : 'no'">{{ hashText(h) }}</pre>
          <Md class="sl-small" :text="hashLine" />
        </div>
      </div>

      <div v-if="result" class="sl-verdicts">
        <div v-for="line in result.lines" :key="line.who" class="sl-verdict" :data-tone="line.tone">
          <span class="sl-who">{{ line.who }}</span>
          <Md class="sl-what" :text="line.text" />
          <pre v-if="line.code" class="sl-code sl-code--msg">{{ line.code }}</pre>
        </div>
      </div>

      <Md class="sl-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.sl-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
}
.sl-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.sl-note,
.sl-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.sl-note :deep(code),
.sl-caption :deep(code),
.sl-what :deep(code),
.sl-small :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}

.sl-pane {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.sl-pane__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.sl-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.sl-scroll {
  max-height: 290px;
  overflow: auto;
  border-radius: var(--r2);
  background: var(--surface);
}
.sl-grid {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px;
  width: max-content;
}
.sl-row {
  display: flex;
  align-items: stretch;
  gap: 2px;
}
.sl-offset {
  width: 3.6em;
  align-self: center;
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-faint);
}
.sl-byte {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 2.2em;
  padding: 2px 0;
  border: 1px solid transparent;
  border-radius: 3px;
  background: none;
  font: inherit;
  color: inherit;
  cursor: pointer;
}
.sl-hex,
.sl-ch {
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.4;
}
.sl-ch {
  color: var(--text-muted);
}
.sl-byte[data-region='head'] .sl-hex {
  color: var(--tone-info-text);
}
.sl-byte[data-region='data'] .sl-hex,
.sl-byte[data-region='text'] .sl-hex {
  color: var(--ink);
}
.sl-byte[data-region='tail'] .sl-hex {
  color: var(--tone-ok-text);
}
.sl-byte:hover,
.sl-byte:focus-visible {
  background: var(--surface-3);
  outline: none;
  border-color: var(--border);
}
.sl-byte[data-on='yes'] {
  background: var(--tone-warn-bg);
  border-color: var(--tone-warn-line);
}
.sl-byte[data-on='yes'] .sl-hex,
.sl-byte[data-on='yes'] .sl-ch {
  color: var(--tone-warn-text);
  font-weight: 600;
}

.sl-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
}
.sl-key {
  font-family: var(--mono);
  font-size: var(--fs-2);
}
.sl-key[data-region='head'] {
  color: var(--tone-info-text);
}
.sl-key[data-region='data'] {
  color: var(--ink);
}
.sl-key[data-region='tail'] {
  color: var(--tone-ok-text);
}

.sl-split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 760px) {
  .sl-split {
    grid-template-columns: minmax(0, 1fr);
  }
}

.sl-code {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.6;
  /* Подложка — общая для кода курса (`pre` в base.css, чернильная): цвета ниже — «на чернилах». */
  color: var(--code-fg);
  white-space: pre-wrap;
  word-break: break-all;
}
.sl-code[data-match='no'] {
  color: var(--tone-warn-on-ink);
}
.sl-code--msg {
  color: var(--tone-warn-on-ink);
}
.sl-small {
  font-size: var(--fs-2);
  line-height: 1.5;
  color: var(--text-muted);
}

.sl-verdicts {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.sl-verdict {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  border-radius: var(--r3);
  border-left: 3px solid var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.sl-verdict[data-tone='err'] {
  border-left-color: var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}
.sl-verdict[data-tone='warn'] {
  border-left-color: var(--tone-warn-line);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.sl-who {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.sl-what {
  font-size: var(--fs-3);
  line-height: 1.5;
}
</style>
