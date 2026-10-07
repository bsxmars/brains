<script setup lang="ts">
/**
 * «Что найдёт сканер»: образец текста, порог энтропии и требование цифры — и три исхода:
 * пойман, пропущен, ложная тревога.
 *
 * Ищет не компонент, а строка `SCAN_CODE` из темы, собранная `new Function` (`model/run.ts`).
 * Та же строка напечатана на странице; `tests/unit/secrets-config.test.ts` прогоняет её по
 * бандлам Vue, React и d3 и закрепляет исходы на каждом образце при каждом пороге.
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { judge, loadScan } from '../model/run';
import type { Finding, ScanSample } from '../model/types';

const props = defineProps<{
  scanCode: string;
  samples: ScanSample[];
  thresholds: number[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const scan = loadScan(props.scanCode);

const picked = ref(props.samples[0].id);
const sampleOptions = props.samples.map((s) => ({ value: s.id, label: s.label.replaceAll('`', '') }));
const sample = computed(() => props.samples.find((s) => s.id === picked.value) ?? props.samples[0]);

const fmt = (n: number) => n.toFixed(1).replace('.', ',');
const bits = ref(String(props.thresholds[1] ?? props.thresholds[0]));
const bitOptions = props.thresholds.map((b) => ({ value: String(b), label: `${fmt(b)} бит` }));
const digit = ref('yes');
const digitOptions = [
  { value: 'yes', label: 'нужна цифра' },
  { value: 'no', label: 'без условия' },
];

const found = computed(() =>
  scan.scanSecrets(sample.value.text, { minBits: Number(bits.value), needDigit: digit.value === 'yes' }),
);
const verdict = computed(() => judge(sample.value, found.value));
const isCaught = (f: Finding) => verdict.value.caught.includes(f);

interface Chunk {
  text: string;
  kind: 'plain' | 'caught' | 'noise';
}

/** Текст образца, разрезанный по находкам; пересекающиеся находки не рисуются дважды. */
const chunks = computed<Chunk[]>(() => {
  const out: Chunk[] = [];
  let pos = 0;
  for (const f of found.value) {
    if (f.at < pos) continue;
    if (f.at > pos) out.push({ text: sample.value.text.slice(pos, f.at), kind: 'plain' });
    out.push({ text: f.value, kind: isCaught(f) ? 'caught' : 'noise' });
    pos = f.at + f.value.length;
  }
  out.push({ text: sample.value.text.slice(pos), kind: 'plain' });
  return out;
});

/** Одинаковые находки (одна строка много раз) — одной строкой с числом. */
const list = computed(() => {
  const byValue = new Map<string, { f: Finding; n: number }>();
  for (const f of found.value) {
    const seen = byValue.get(f.value);
    if (seen) seen.n++;
    else byValue.set(f.value, { f, n: 1 });
  }
  return [...byValue.values()];
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="sl-tools">
        <SegmentedControl v-model="picked" class="l-pills" label="Образец" :options="sampleOptions" />
        <SegmentedControl v-model="bits" class="l-pills" label="Порог энтропии" :options="bitOptions" />
        <SegmentedControl v-model="digit" class="l-pills" label="Буквы и цифры" :options="digitOptions" />
      </div>
    </template>

    <div class="sl-body">
      <Md class="sl-note" :text="sample.note" />

      <pre class="sl-text"><template v-for="(c, i) in chunks" :key="i"><mark
        v-if="c.kind !== 'plain'"
        class="sl-hit"
        :data-kind="c.kind"
      >{{ c.text }}</mark><template v-else>{{ c.text }}</template></template></pre>

      <div class="sl-summary">
        <span class="sl-count" data-tone="ok">поймано: {{ verdict.caught.length }}</span>
        <span class="sl-count" data-tone="err">пропущено: {{ verdict.missed.length }}</span>
        <span class="sl-count" data-tone="warn">ложная тревога: {{ verdict.noise.length }}</span>
      </div>

      <ul class="sl-list">
        <li v-for="item in list" :key="item.f.value" class="sl-item" :data-kind="isCaught(item.f) ? 'caught' : 'noise'">
          <span class="sl-item__rule">{{ item.f.rule }}{{ item.n > 1 ? ` · ×${item.n}` : '' }}</span>
          <code class="sl-item__value">{{ item.f.value }}</code>
          <span class="sl-item__verdict">{{ isCaught(item.f) ? 'секрет' : 'не секрет' }}</span>
        </li>
        <li v-for="m in verdict.missed" :key="m" class="sl-item" data-kind="missed">
          <span class="sl-item__rule">не найден</span>
          <code class="sl-item__value">{{ m }}</code>
          <span class="sl-item__verdict">секрет</span>
        </li>
      </ul>

      <Md class="sl-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.sl-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 18px;
}
.sl-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
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
.sl-caption :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}

.sl-text {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.75;
  /* Подложка — общая для кода курса (`pre` в base.css, чернильная): цвета ниже — «на чернилах». */
  color: var(--code-fg);
  white-space: pre-wrap;
  word-break: break-all;
}
.sl-hit {
  border-radius: 3px;
  background: var(--ink-chip);
  color: var(--code-fg);
  box-shadow: inset 0 0 0 1px var(--ink-line);
}
.sl-hit[data-kind='caught'] {
  background: var(--warn-wash-on-ink);
  color: var(--tone-warn-on-ink);
  box-shadow: inset 0 0 0 1px var(--tone-warn-accent);
}

.sl-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.sl-count {
  padding: 2px 10px;
  border-radius: var(--r-full);
  font-size: var(--fs-3);
}
.sl-count[data-tone='ok'] {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.sl-count[data-tone='err'] {
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}
.sl-count[data-tone='warn'] {
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}

.sl-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.sl-item {
  display: grid;
  grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.8fr) minmax(0, 0.5fr);
  gap: 4px 12px;
  align-items: baseline;
  padding: 8px 12px;
  border-radius: var(--r2);
  font-size: var(--fs-3);
}
@media (max-width: 640px) {
  .sl-item {
    grid-template-columns: minmax(0, 1fr);
  }
}
.sl-item[data-kind='caught'] {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.sl-item[data-kind='noise'] {
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.sl-item[data-kind='missed'] {
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}
.sl-item__rule,
.sl-item__verdict {
  font-size: var(--fs-2);
}
.sl-item__value {
  font-family: var(--mono);
  overflow-wrap: anywhere;
  color: var(--ink);
}
</style>
