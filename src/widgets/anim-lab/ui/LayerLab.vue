<script setup lang="ts">
/**
 * «Слои»: сколько слоёв получит страница и по каким причинам.
 *
 * Счёт ведёт строка `LAYER_CODE` из темы (вместе с `FRAME_PLAN_CODE`, на который она
 * опирается), собранная `new Function` в `model/run.ts`. Рядом — то, что `LayerTree` снял
 * в Chromium 153 на такой же странице. Сверку тех же сцен делает `tests/unit/animations.test.ts`.
 * Сцены рисуются схемой (сто клеток), настоящих слоёв компонент не создаёт.
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { loadLayers } from '../model/run';
import type { LayerScene } from '../model/types';

const props = defineProps<{
  planCode: string;
  layerCode: string;
  scenes: LayerScene[];
  caption: string;
}>();

const api = loadLayers(props.planCode, props.layerCode);

const picked = ref(props.scenes[0].id);
const options = props.scenes.map((s) => ({ value: s.id, label: s.label }));
const scene = computed(() => props.scenes.find((s) => s.id === picked.value) ?? props.scenes[0]);

const model = computed(() => api.countLayers(scene.value.elements));
const verdicts = computed(() => scene.value.elements.map((el) => api.ownLayer(el)));
const same = computed(
  () =>
    model.value.count === scene.value.chromium.count &&
    JSON.stringify(sortKeys(model.value.reasons)) === JSON.stringify(sortKeys(scene.value.chromium.reasons)),
);

function sortKeys(o: Record<string, number>) {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
}

const reasonRows = (r: Record<string, number>) =>
  Object.entries(r)
    .filter(([k]) => k !== 'RootScroller' && k !== 'OverflowScrolling')
    .map(([k, n]) => `${k} × ${n}`);

/** Клетки схемы: у каждой — своя ли у неё плёнка, общая склеенная или нет никакой. */
const cells = computed(() =>
  scene.value.elements.map((el, i) => {
    const v = verdicts.value[i];
    let kind: 'none' | 'own' | 'squash' | 'anim' = 'none';
    if (v.layer && el.overLayer && v.reason === 'Overlap') kind = 'squash';
    else if (v.layer) kind = el.animations?.length ? 'anim' : 'own';
    return { i, kind, reason: v.reason ?? (v.layer ? '(пусто)' : '') };
  }),
);

const fmt = (n: number) => n.toLocaleString('ru-RU');
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="picked" class="l-pills" label="Сцена" :options="options" />
    </template>

    <div class="ll-body">
      <Md class="ll-note" :text="scene.note" />

      <div class="ll-grid" role="img" :aria-label="`Элементов: ${cells.length}, слоёв по модели: ${model.count}`">
        <span v-for="c in cells" :key="c.i" class="ll-cell" :data-kind="c.kind" :title="c.reason" />
      </div>
      <div class="ll-legend">
        <span><i class="ll-cell" data-kind="none" /> в корневом слое</span>
        <span><i class="ll-cell" data-kind="own" /> свой слой</span>
        <span><i class="ll-cell" data-kind="squash" /> общий склеенный слой</span>
        <span><i class="ll-cell" data-kind="anim" /> слой анимации</span>
      </div>

      <div class="ll-split">
        <div class="ll-pane">
          <span class="ll-label">countLayers</span>
          <b class="ll-num">{{ model.count }}</b>
          <span v-for="r in reasonRows(model.reasons)" :key="r" class="ll-reason">{{ r }}</span>
        </div>
        <div class="ll-pane">
          <span class="ll-label">Chromium 153, LayerTree</span>
          <b class="ll-num">{{ scene.chromium.count }}</b>
          <span v-for="r in reasonRows(scene.chromium.reasons)" :key="r" class="ll-reason">{{ r }}</span>
          <span class="ll-reason">{{ fmt(scene.chromium.bytes) }} байт по арифметике</span>
        </div>
      </div>
      <span class="ll-verdict" :data-tone="same ? 'ok' : 'err'">
        {{ same ? 'Модель совпала с Chromium: слоёв и причин столько же.' : 'Модель разошлась с Chromium.' }}
      </span>

      <Md class="ll-note" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.ll-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
  min-width: 0;
}
.ll-note {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.ll-note :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
.ll-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.ll-cell {
  display: inline-block;
  width: 18px;
  height: 12px;
  border-radius: 2px;
  background: var(--surface);
  box-shadow: inset 0 0 0 1px var(--border);
}
.ll-cell[data-kind='own'] {
  background: var(--tone-err-bg);
  box-shadow: inset 0 0 0 2px var(--tone-err-line);
}
.ll-cell[data-kind='squash'] {
  background: var(--tone-warn-bg);
  box-shadow: inset 0 0 0 1px var(--tone-warn-line);
}
.ll-cell[data-kind='anim'] {
  width: 60px;
  background: var(--tone-info-bg);
  box-shadow: inset 0 0 0 2px var(--tone-info-line);
}
.ll-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.ll-legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.ll-legend .ll-cell[data-kind='anim'] {
  width: 18px;
}
.ll-split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
}
@media (max-width: 560px) {
  .ll-split {
    grid-template-columns: minmax(0, 1fr);
  }
}
.ll-pane {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
  min-width: 0;
}
.ll-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.ll-num {
  font-family: var(--mono);
  font-size: var(--fs-7);
  font-weight: 600;
  color: var(--ink);
}
.ll-reason {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--prose);
  overflow-wrap: anywhere;
}
.ll-verdict {
  font-size: var(--fs-3);
}
.ll-verdict[data-tone='ok'] {
  color: var(--tone-ok-text);
}
.ll-verdict[data-tone='err'] {
  color: var(--tone-err-text);
}
</style>
