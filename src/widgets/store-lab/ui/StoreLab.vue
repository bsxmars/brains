<script setup lang="ts">
/**
 * «Один стор — четыре способа подписки»: три компонента-подписчика на одном сторе, счётчики их
 * рендеров и проверок (вызовов селектора) после каждого действия.
 *
 * Считает не компонент, а строки темы `STORE_CODE`, `SELECTOR_CODE` и `PINIA_CODE`, собранные
 * `new Function` в `model/run.ts`. Режим Pinia работает на настоящей реактивности Vue — той же,
 * на которой стоит этот остров. `tests/unit/state-managers.test.ts` прогоняет тот же `createLab`
 * и сверяет счёт с React 19.3 на zustand и с Vue 3.5 на pinia.
 *
 * Стенд — не реактивный объект: эффекты режима Pinia пишут счётчики в обычные поля, а наружу
 * компонент выносит готовый снимок `rows()` после каждого действия.
 */
import { computed, effect, effectScope, onBeforeUnmount, reactive, ref, shallowRef, toRefs, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button, SegmentedControl } from '@/shared/ui';
import { createLab, initialState, LAB_COMPONENTS, snapshotIsStable, type LabCodes } from '../model/run';
import type { Effects, Lab, LabAction, LabComponentId, LabMode, LabRow, Reactivity } from '../model/types';

const props = defineProps<{
  codes: LabCodes;
  modes: { value: LabMode; label: string; note: string }[];
  actions: { value: LabAction; label: string; store: string; pinia: string }[];
  components: { id: LabComponentId; label: string; code: Record<LabMode, string> }[];
  /** Строчная разметка: предупреждение у неустойчивого селектора. */
  loopNote: string;
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const vue = { reactive, computed, toRefs, effect, effectScope } as unknown as Reactivity & Effects;

const mode = ref<LabMode>(props.modes[0].value);
const modeOptions = props.modes.map((m) => ({ value: m.value, label: m.label }));
const modeNote = computed(() => props.modes.find((m) => m.value === mode.value)?.note ?? '');

let lab: Lab = createLab(mode.value, props.codes, vue);
const rows = shallowRef<LabRow[]>(lab.rows());
const last = ref<LabAction | null>(null);

function rebuild() {
  lab.stop();
  lab = createLab(mode.value, props.codes, vue);
  rows.value = lab.rows();
  last.value = null;
}
watch(mode, rebuild);
onBeforeUnmount(() => lab.stop());

function act(a: LabAction) {
  lab.act(a);
  rows.value = lab.rows();
  last.value = a;
}

const lastAction = computed(() => props.actions.find((a) => a.value === last.value) ?? null);
const lastCode = computed(() => {
  const a = lastAction.value;
  if (!a) return '';
  return mode.value === 'tracking' ? a.pinia : a.store;
});
const totals = computed(() => ({
  renders: rows.value.reduce((n, r) => n + r.lastRenders, 0),
  checks: rows.value.reduce((n, r) => n + r.lastChecks, 0),
}));

/** Селектор, который на одном состоянии отвечает разными объектами, — только в режиме `selector`. */
const unstable = computed(() => {
  if (mode.value !== 'selector') return new Set<LabComponentId>();
  const s = initialState();
  return new Set(LAB_COMPONENTS.filter((c) => !snapshotIsStable(c.selector, s)).map((c) => c.id));
});

const cards = computed(() =>
  props.components.map((c) => {
    const row = rows.value.find((r) => r.id === c.id)!;
    return { ...c, row, code: c.code[mode.value], loops: unstable.value.has(c.id) };
  }),
);

const plus = (n: number) => (n > 0 ? `+${n}` : '0');
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="mode" class="l-pills" label="Способ подписки" :options="modeOptions" />
    </template>

    <div class="stl-body">
      <Md class="stl-note" :text="modeNote" />

      <div class="stl-actions" role="group" aria-label="Действия над стором">
        <Button v-for="a in actions" :key="a.value" variant="secondary" @click="act(a.value)">{{ a.label }}</Button>
        <Button variant="secondary" @click="rebuild">сначала</Button>
      </div>

      <div class="stl-log" aria-live="polite">
        <template v-if="lastAction">
          <code class="stl-log__code">{{ lastCode }}</code>
          <span class="stl-log__sum">
            рендеров: <b>{{ totals.renders }}</b> · вызовов селектора: <b>{{ totals.checks }}</b>
          </span>
        </template>
        <span v-else class="stl-log__sum">Все три компонента отрисованы по разу — при монтировании.</span>
      </div>

      <div class="stl-grid">
        <section
          v-for="c in cards"
          :key="c.id"
          class="stl-card"
          :data-hit="c.row.lastRenders > 0 ? 'yes' : 'no'"
          :aria-label="`Компонент ${c.label}`"
        >
          <div class="stl-card__head">
            <span class="stl-card__name">{{ c.label }}</span>
            <span class="stl-card__value">{{ c.row.value }}</span>
          </div>
          <code class="stl-card__code">{{ c.code }}</code>
          <dl class="stl-card__stats">
            <div>
              <dt>рендеров</dt>
              <dd>
                {{ c.row.renders }} <span class="stl-delta" :data-on="c.row.lastRenders > 0 ? 'yes' : 'no'">{{ plus(c.row.lastRenders) }}</span>
              </dd>
            </div>
            <div>
              <dt>вызовов селектора</dt>
              <dd v-if="mode === 'tracking' || mode === 'all'">нет</dd>
              <dd v-else>
                {{ c.row.checks }} <span class="stl-delta" :data-on="c.row.lastChecks > 0 ? 'yes' : 'no'">{{ plus(c.row.lastChecks) }}</span>
              </dd>
            </div>
          </dl>
          <Md v-if="c.loops" class="stl-card__warn" :text="loopNote" />
        </section>
      </div>

      <Md class="stl-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.stl-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.stl-note,
.stl-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.stl-note :deep(code),
.stl-caption :deep(code),
.stl-card__warn :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}

.stl-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.stl-log {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px 14px;
  min-width: 0;
  padding: 10px 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
  font-size: var(--fs-3);
  color: var(--prose);
}
.stl-log__code {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
  overflow-wrap: anywhere;
}
.stl-log__sum {
  color: var(--text-muted);
}
.stl-log__sum b {
  color: var(--ink);
}

.stl-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
  gap: 12px;
}

.stl-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  padding: 14px;
  border-radius: var(--r3);
  background: var(--surface-2);
  transition: box-shadow 0.2s ease, background 0.2s ease;
}
.stl-card[data-hit='yes'] {
  background: var(--tone-warn-bg);
  box-shadow: inset 0 0 0 1px var(--tone-warn-line);
}
@media (prefers-reduced-motion: reduce) {
  .stl-card {
    transition: none;
  }
}
.stl-card__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}
.stl-card__name {
  font-family: var(--mono);
  font-size: var(--fs-3);
  font-weight: 600;
  color: var(--ink);
}
.stl-card__value {
  font-family: var(--mono);
  font-size: var(--fs-5);
  color: var(--ink);
  overflow-wrap: anywhere;
}
.stl-card__code {
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.5;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}
.stl-card__stats {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
}
.stl-card__stats > div {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: var(--fs-3);
  color: var(--prose);
}
.stl-card__stats dt {
  color: var(--text-muted);
}
.stl-card__stats dd {
  margin: 0;
  font-family: var(--mono);
  color: var(--ink);
}
.stl-delta {
  color: var(--text-muted);
}
.stl-delta[data-on='yes'] {
  color: var(--tone-warn-text);
  font-weight: 600;
}
.stl-card__warn {
  font-size: var(--fs-2);
  line-height: 1.5;
  color: var(--tone-err-text);
}
</style>
