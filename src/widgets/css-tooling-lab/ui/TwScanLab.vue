<script setup lang="ts">
/**
 * «Что увидел сканер»: файл-фикстура с подсвеченными кандидатами, утилиты, которые из них
 * получились, и вес итогового CSS.
 *
 * Кандидатов ищет строка `TW_SCAN_CODE` из темы, собранная `new Function` (`model/run.ts`),
 * прямо в браузере. Какой CSS Tailwind написал для кандидата — снимок стенда (`TW_RULES`,
 * байты файлов): компилятор Tailwind в браузер не везём. Тест `tests/unit/css-tooling.test.ts`
 * сверяет оба конца: правила и байты — с Tailwind 4.3.3, набор утилит учебного сканера —
 * с тем, что даёт настоящий сканер oxide на тех же файлах.
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { loadScanner } from '../model/run';
import type { TwFile } from '../model/types';

const props = defineProps<{
  scanCode: string;
  files: TwFile[];
  /** Кандидат → CSS, который Tailwind для него написал. Кого здесь нет — тот не утилита. */
  rules: Record<string, string>;
  emptyBytes: number;
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const scan = loadScanner(props.scanCode);

const picked = ref(props.files[0].id);
const options = props.files.map((f) => ({ value: f.id, label: f.name.replace(/^src\//, '') }));
const file = computed(() => props.files.find((f) => f.id === picked.value) ?? props.files[0]);

const found = computed(() => scan(file.value.text));

interface Chunk {
  key: string;
  text: string;
  kind: 'plain' | 'cand' | 'util';
}

/** Текст файла, разрезанный по кандидатам. */
const chunks = computed<Chunk[]>(() => {
  const text = file.value.text;
  const out: Chunk[] = [];
  let at = 0;
  for (const c of found.value) {
    if (c.start > at) out.push({ key: `p${at}`, text: text.slice(at, c.start), kind: 'plain' });
    out.push({ key: `c${c.start}`, text: c.candidate, kind: c.candidate in props.rules ? 'util' : 'cand' });
    at = c.start + c.candidate.length;
  }
  if (at < text.length) out.push({ key: `p${at}`, text: text.slice(at), kind: 'plain' });
  return out;
});

const unique = computed(() => [...new Set(found.value.map((c) => c.candidate))]);
const utilities = computed(() => unique.value.filter((c) => c in props.rules));
const others = computed(() => unique.value.filter((c) => !(c in props.rules)));

const css = computed(() => utilities.value.map((u) => props.rules[u]).join('\n'));
const fmt = (n: number) => n.toLocaleString('ru-RU');
const plural = (n: number, [one, few, many]: [string, string, string]) => {
  const d = n % 10;
  const dd = n % 100;
  if (d === 1 && dd !== 11) return one;
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return few;
  return many;
};
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="picked" class="l-pills" label="Файл" :options="options" />
    </template>

    <div class="tw-body">
      <div class="tw-split">
        <div class="tw-pane">
          <span class="tw-label">{{ file.name }}</span>
          <pre class="tw-code tw-code--src"><template v-for="c in chunks" :key="c.key"><span :class="`tw-${c.kind}`">{{ c.text }}</span></template></pre>
          <p class="tw-legend">
            <span class="tw-swatch tw-swatch--util">утилита</span>
            <span class="tw-swatch tw-swatch--cand">кандидат, но не класс Tailwind</span>
          </p>
        </div>

        <div class="tw-pane">
          <span class="tw-label">@layer utilities — {{ utilities.length }} {{ plural(utilities.length, ['правило', 'правила', 'правил']) }}</span>
          <pre class="tw-code tw-code--css">{{ css || '/* пусто */' }}</pre>
          <span class="tw-label">отброшено молча — {{ others.length }}</span>
          <div class="tw-chips">
            <code v-for="o in others" :key="o" class="tw-chip">{{ o }}</code>
          </div>
          <p class="tw-bytes">
            CSS по этому файлу — <b>{{ fmt(file.bytes) }} байт</b>: {{ fmt(emptyBytes) }} — сброс стилей и тема, которые
            приходят всегда, и {{ fmt(file.bytes - emptyBytes) }} — утилиты и их переменные.
          </p>
        </div>
      </div>

      <Md class="tw-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.tw-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.tw-split {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 860px) {
  .tw-split {
    grid-template-columns: minmax(0, 1fr);
  }
}
.tw-pane {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.tw-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.tw-code {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.75;
  /* Подложка — общая для кода курса (`pre` в base.css, чернильная): цвета ниже — «на чернилах». */
  color: var(--code-fg);
  white-space: pre;
  overflow-x: auto;
}
.tw-code--src {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.tw-code--css {
  max-height: 22em;
  overflow-y: auto;
}
.tw-plain {
  color: var(--ink-faint);
}
.tw-cand {
  color: var(--code-fg);
  box-shadow: inset 0 -1px 0 var(--ink-faint);
}
.tw-util {
  border-radius: 3px;
  background: var(--ink-chip);
  color: var(--tone-ok-on-ink);
  box-shadow: inset 0 0 0 1px var(--ink-line);
}
.tw-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  margin: 0;
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.tw-swatch::before {
  content: '';
  display: inline-block;
  width: 0.9em;
  height: 0.9em;
  margin-right: 6px;
  border-radius: 3px;
  vertical-align: -0.1em;
}
.tw-swatch--util::before {
  background: var(--tone-ok-bg);
  box-shadow: inset 0 0 0 1px var(--tone-ok-line);
}
.tw-swatch--cand::before {
  box-shadow: inset 0 -2px 0 var(--text-muted);
}
.tw-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.tw-chip {
  padding: 2px 8px;
  border-radius: var(--r2);
  background: var(--surface-3);
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--ink);
}
.tw-bytes {
  margin: 4px 0 0;
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.tw-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.tw-caption :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
</style>
