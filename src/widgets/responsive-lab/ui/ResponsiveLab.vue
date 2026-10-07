<script setup lang="ts">
/**
 * «Какое правило сработает»: окно и место под карточку меняются ползунками, карточка
 * перестраивается, рядом — какие `@media` и `@container` сработали, почему и что дал `clamp`.
 *
 * Считает не компонент, а строка `RESOLVE_CODE` из темы, собранная `new Function`
 * (`model/run.ts`); та же строка сверяется с Chromium в `tests/unit/responsive.test.ts`.
 * Карточка рисуется значениями, которые вернула модель (инлайн-стилями), а не настоящими
 * `@container`: иначе демо показывало бы браузер, а не код темы.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { fmt, loadResolve } from '../model/run';
import type { Check, Decl, Env, FontChoice, RuleReport } from '../model/types';

const props = defineProps<{
  code: string;
  css: string;
  fonts: FontChoice[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const resolve = loadResolve(props.code);

const fontId = ref(props.fonts[0].value);
const fontOptions = props.fonts.map((f) => ({ value: f.value, label: f.label }));
const font = computed(() => props.fonts.find((f) => f.value === fontId.value) ?? props.fonts[0]);

const winW = ref(1024);
const slotWant = ref(520);
/** Место под карточку не шире окна за вычетом полей по 16px. */
const slotW = computed(() => Math.min(slotWant.value, winW.value - 32));

const env = computed<Env>(() => ({
  viewport: { width: winW.value, height: 800 },
  initialFont: font.value.initial,
  rootFont: font.value.root,
  containers: [{ name: 'slot', width: slotW.value, font: font.value.root }],
}));

const result = computed(() => resolve(env.value, props.css));
const conditional = computed(() => result.value.rules.filter((r) => r.when));

const el = (sel: string) => result.value.elements[sel] ?? {};
const val = (d: Decl | undefined, fallback = '') => (d ? (d.px !== undefined ? `${d.px}px` : d.text) : fallback);

const cardStyle = computed(() => {
  const c = el('.card');
  return {
    display: val(c.display, 'block'),
    flexDirection: val(c['flex-direction'], 'row'),
    gap: val(c.gap, '0px'),
    padding: val(c.padding, '0px'),
    fontSize: `${font.value.root}px`,
  } as Record<string, string>;
});
const thumbStyle = computed(() => ({ width: val(el('.thumb').width, 'auto') }));
const titleStyle = computed(() => ({ fontSize: val(el('.title')['font-size'], `${font.value.root}px`) }));
const metaShown = computed(() => val(el('.meta').display, 'block') !== 'none');

/** Окно рисуется уменьшенным: `zoom` уменьшает и раскладку, и высоту рамки. */
const stage = ref<HTMLElement | null>(null);
const avail = ref(600);
let ro: ResizeObserver | null = null;
onMounted(() => {
  if (!stage.value) return;
  ro = new ResizeObserver(([e]) => {
    avail.value = e.contentRect.width;
  });
  ro.observe(stage.value);
});
onBeforeUnmount(() => ro?.disconnect());
const zoom = computed(() => Math.min(1, avail.value / winW.value));

const SYM: Record<Check['op'], string> = { '<': '<', '<=': '≤', '>': '>', '>=': '≥', '=': '=' };

function reason(r: RuleReport): string {
  if (r.kind === 'container' && !r.box) return `контейнера \`${r.name}\` среди предков нет`;
  const who = r.kind === 'media' ? 'окно' : `контейнер \`${r.box?.name}\``;
  const em = r.kind === 'media' ? `em = шрифт браузера ${font.value.initial}px` : `em = шрифт контейнера ${r.box?.font}px`;
  const parts = r.checks.map(
    (c) => `${who} ${typeof c.actual === 'number' ? fmt(c.actual) + 'px' : c.actual} ${SYM[c.op]} ${typeof c.limit === 'number' ? fmt(c.limit) + 'px' : c.limit} — ${c.ok ? 'да' : 'нет'}`,
  );
  return `${parts.join('; ')} (${em})`;
}

interface Row {
  key: string;
  sel: string;
  prop: string;
  text: string;
  out: string;
  from: string;
  clamp: string;
}

const rows = computed<Row[]>(() => {
  const out: Row[] = [];
  for (const [sel, decls] of Object.entries(result.value.elements)) {
    if (sel === '.slot') continue;
    for (const [prop, d] of Object.entries(decls)) {
      const rule = result.value.rules[d.from];
      const c = d.clamps?.[0];
      out.push({
        key: `${sel}:${prop}`,
        sel,
        prop,
        text: d.text,
        out: d.px !== undefined ? `${fmt(d.px)}px` : d.text,
        from: rule.when ?? 'без условия',
        clamp: c
          ? `пол ${fmt(c.min)} · середина ${fmt(c.val)} · потолок ${fmt(c.max)} → ${c.pinned === 'min' ? 'упёрлось в пол' : c.pinned === 'max' ? 'упёрлось в потолок' : 'между полом и потолком'}`
          : '',
      });
    }
  }
  return out;
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="rl-controls">
        <SegmentedControl v-model="fontId" class="l-pills" label="Шрифты" :options="fontOptions" />
        <label class="rl-range">
          <span class="rl-label">окно: {{ winW }}px</span>
          <input v-model.number="winW" type="range" min="320" max="1600" step="4" :aria-valuetext="`${winW} пикселей`" />
        </label>
        <label class="rl-range">
          <span class="rl-label">место под карточку: {{ slotW }}px</span>
          <input v-model.number="slotWant" type="range" min="160" max="1200" step="4" :aria-valuetext="`${slotW} пикселей`" />
        </label>
      </div>
    </template>

    <div class="rl-body">
      <div ref="stage" class="rl-stage">
        <div class="rl-window" :style="{ width: `${winW}px`, zoom }" aria-hidden="true">
          <div class="rl-slot" :style="{ width: `${slotW}px` }">
            <div class="rl-card" :style="cardStyle">
              <div class="rl-thumb" :style="thumbStyle" />
              <div class="rl-text">
                <div class="rl-title" :style="titleStyle">Как браузер выбирает правило</div>
                <div v-if="metaShown" class="rl-meta">12 минут · CSS</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="rl-rules">
        <span class="rl-label">условия</span>
        <div v-for="r in conditional" :key="r.index" class="rl-rule" :data-ok="r.ok ? 'yes' : 'no'">
          <code class="rl-when">{{ r.when }} → {{ r.selector }}</code>
          <span class="rl-verdict">{{ r.ok ? 'сработало' : 'нет' }}</span>
          <Md class="rl-why" :text="reason(r)" />
        </div>
      </div>

      <div class="rl-values">
        <span class="rl-label">итоговые значения</span>
        <div v-for="row in rows" :key="row.key" class="rl-value">
          <code class="rl-prop">{{ row.sel }} {{ row.prop }}</code>
          <code class="rl-out">{{ row.out }}</code>
          <span class="rl-src"><code>{{ row.text }}</code> — {{ row.from }}</span>
          <span v-if="row.clamp" class="rl-clamp">{{ row.clamp }}</span>
        </div>
      </div>

      <Md class="rl-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.rl-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 12px 20px;
}
.rl-range {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1 1 200px;
  min-width: 0;
}
.rl-range input {
  width: 100%;
  font: inherit;
  color: inherit;
  accent-color: var(--ink);
}
.rl-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.rl-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}

.rl-stage {
  min-width: 0;
  overflow: hidden;
}
.rl-window {
  box-sizing: border-box;
  min-height: 220px;
  padding: 16px;
  border-radius: var(--r3);
  background: var(--surface-2);
  box-shadow: inset 0 0 0 1px var(--border);
}
.rl-slot {
  box-sizing: content-box;
  outline: 2px dashed var(--tone-info-line);
  outline-offset: 2px;
  border-radius: var(--r1);
}
.rl-card {
  box-sizing: border-box;
  border-radius: var(--r2);
  background: var(--surface);
  box-shadow: var(--shadow-1);
  color: var(--ink);
}
.rl-thumb {
  flex: none;
  aspect-ratio: 4 / 3;
  border-radius: var(--r1);
  background: var(--tone-info-chip);
}
.rl-text {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.rl-title {
  font-family: var(--serif);
  line-height: 1.2;
}
.rl-meta {
  font-family: var(--mono);
  color: var(--text-muted);
}

.rl-rules,
.rl-values {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.rl-rule,
.rl-value {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 4px 12px;
  padding: 8px 12px;
  border-radius: var(--r2);
  background: var(--surface-2);
  font-size: var(--fs-3);
  color: var(--prose);
}
.rl-rule[data-ok='yes'] {
  background: var(--tone-ok-bg);
  box-shadow: inset 3px 0 0 var(--tone-ok-line);
}
.rl-when,
.rl-prop,
.rl-out,
.rl-src code {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
  color: var(--ink);
  overflow-wrap: anywhere;
}
.rl-verdict {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.rl-rule[data-ok='yes'] .rl-verdict {
  color: var(--tone-ok-text);
  font-weight: 600;
}
.rl-why,
.rl-src,
.rl-clamp {
  grid-column: 1 / -1;
  font-size: var(--fs-3);
  line-height: 1.5;
  color: var(--text-muted);
}
.rl-why :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
.rl-out {
  font-weight: 600;
}
.rl-clamp {
  color: var(--tone-warn-text);
}

.rl-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.rl-caption :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
</style>
