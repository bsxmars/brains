<script setup lang="ts">
/**
 * Демо темы «Наблюдатели». Два режима — две вставки на странице.
 *
 * `io` — «Порог, кадр и задача»: прокручиваемая рамка с целью, нижний `rootMargin` ползунком,
 * набор порогов. Каждый кадр (`requestAnimationFrame`) модель `IO_CODE` из темы считает запись
 * по прямоугольникам рамки и цели и, если ступенька поменялась, пишет в журнал предсказание.
 * Рядом работает настоящий `IntersectionObserver` с теми же опциями; его вызовы идут в тот же
 * журнал с номером кадра — видно, что он приходит после `rAF`, отдельной задачей. Каждая
 * настоящая запись сверяется с моделью, посчитанной по её же `boundingClientRect`.
 *
 * `ro` — «Глубина»: вложенные `<div>` под настоящим `ResizeObserver`, колбэк растягивает
 * тех, кого велит сцена. Круги за четыре кадра записываются из браузера и сравниваются
 * с `RO_CODE` (`resizeFrame`) для тех же кадров. Та же сверка закреплена
 * `tests/unit/observers.test.ts` в headless Chromium.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button, SegmentedControl } from '@/shared/ui';
import { depthMap, loadIo, loadResizeFrame } from '../model/run';
import type { IoEntry, Rect, RoScene, ThresholdOption } from '../model/types';

const props = defineProps<{
  mode: 'io' | 'ro';
  ioCode?: string;
  roCode?: string;
  thresholdOptions?: ThresholdOption[];
  scenes?: RoScene[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const root = ref<HTMLElement | null>(null);

/* ── общий счётчик кадров: идёт, пока демо на экране ── */
const frame = ref(0);
let rafId = 0;
let visible = false;
const perFrame: (() => void)[] = [];
function loop() {
  rafId = requestAnimationFrame(() => {
    frame.value++;
    for (const f of perFrame) f();
    loop();
  });
}
let seen: IntersectionObserver | null = null;

/* ═════════════════════════════ режим io ═════════════════════════════ */

const io = props.ioCode ? loadIo(props.ioCode) : null;
const thOptions = props.thresholdOptions ?? [];
const thPicked = ref(thOptions[1]?.value ?? thOptions[0]?.value ?? '');
const thOptionsUi = thOptions.map((o) => ({ value: o.value, label: o.label }));
const thresholds = computed(() => thOptions.find((o) => o.value === thPicked.value)?.thresholds ?? [0]);
const margin = ref(0);
const rootMargin = computed(() => `0px 0px ${margin.value}px 0px`);

const SCROLLER_H = 200;
const scroller = ref<HTMLElement | null>(null);
const target = ref<HTMLElement | null>(null);
const current = ref<IoEntry | null>(null);
/** Положение цели относительно верха рамки, в пикселях окна, — для «призрака» в зоне. */
const ghostTop = ref(0);
const ghostH = ref(0);

interface LogRow {
  key: number;
  frame: number;
  phase: 'rAF' | 'задача' | 'ввод';
  text: string;
  ok?: boolean;
}
const ioLog = ref<LogRow[]>([]);
let logKey = 0;
function push(row: Omit<LogRow, 'key'>) {
  ioLog.value = [{ ...row, key: logKey++ }, ...ioLog.value].slice(0, 9);
}

function rootRect(): Rect | null {
  const s = scroller.value;
  if (!s) return null;
  const r = s.getBoundingClientRect();
  return { x: r.left + s.clientLeft, y: r.top + s.clientTop, width: s.clientWidth, height: s.clientHeight };
}
const plain = (r: DOMRectReadOnly): Rect => ({ x: r.x, y: r.y, width: r.width, height: r.height });

const pct = (n: number) => `${Math.round(n * 1000) / 10} %`;
let prevStep = -1;

function modelTick() {
  if (!io || !target.value) return;
  const rr = rootRect();
  if (!rr) return;
  const tr = plain(target.value.getBoundingClientRect());
  const e = io.computeEntry(tr, rr, rootMargin.value, thresholds.value);
  current.value = e;
  ghostTop.value = tr.y - (rr.y + rr.height);
  ghostH.value = tr.height;
  const cmp = io.compareFrames({ thresholdIndex: prevStep }, e, thresholds.value);
  if (cmp.fires) {
    const what =
      prevStep < 0
        ? 'после observe() — первая запись будет'
        : `ступенька ${prevStep} → ${e.thresholdIndex}, пройдены [${cmp.crossed.join(', ')}] — будет вызов`;
    push({ frame: frame.value, phase: 'rAF', text: `модель: ${what}` });
  }
  prevStep = e.thresholdIndex;
}

let realIo: IntersectionObserver | null = null;
function connectIo() {
  realIo?.disconnect();
  if (!io || !scroller.value || !target.value) return;
  prevStep = -1;
  realIo = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        const rr = rootRect();
        const m = rr ? io.computeEntry(plain(en.boundingClientRect), rr, rootMargin.value, thresholds.value) : null;
        const ok = !!m && Math.abs(m.intersectionRatio - en.intersectionRatio) < 1e-3 && m.isIntersecting === en.isIntersecting;
        push({
          frame: frame.value,
          phase: 'задача',
          text: `IntersectionObserver: ratio ${pct(en.intersectionRatio)}, isIntersecting ${en.isIntersecting}`,
          ok,
        });
      }
    },
    { root: scroller.value, rootMargin: rootMargin.value, threshold: thresholds.value },
  );
  realIo.observe(target.value);
}
if (props.mode === 'io') {
  watch([thPicked, margin], () => {
    push({ frame: frame.value, phase: 'ввод', text: `новые опции: rootMargin «${rootMargin.value}», пороги [${thresholds.value.join(', ')}]` });
    connectIo();
  });
}

const stageH = computed(() => SCROLLER_H + Math.max(0, margin.value));

/* ═════════════════════════════ режим ro ═════════════════════════════ */

const resizeFrame = props.roCode ? loadResizeFrame(props.roCode) : null;
const scenes = props.scenes ?? [];
const scenePicked = ref(scenes[0]?.id ?? '');
const sceneOptions = scenes.map((s) => ({ value: s.id, label: s.label }));
const scene = computed(() => scenes.find((s) => s.id === scenePicked.value) ?? scenes[0]);
const depthOf = computed(() => (scene.value ? depthMap(scene.value) : {}));

const FRAMES = 4;
const BASE = [220, 170, 124, 84];

interface TreeNode {
  id: string;
  depth: number;
  children: TreeNode[];
}
const tree = computed<TreeNode[]>(() => {
  const s = scene.value;
  if (!s) return [];
  const by: Record<string, TreeNode> = {};
  const top: TreeNode[] = [];
  for (const n of s.nodes) {
    by[n.id] = { id: n.id, depth: depthOf.value[n.id], children: [] };
    (n.parent ? by[n.parent].children : top).push(by[n.id]);
  }
  return top;
});

const boxes = ref<HTMLElement | null>(null);
const hits = ref<Record<string, number>>({});
const running = ref(false);
interface FrameRow {
  real: string[][];
  realError: boolean;
  model: string[][];
  modelError: boolean;
}
const roRows = ref<FrameRow[]>([]);

let ro: ResizeObserver | null = null;
let armed = false;
let roFrame = -1;
let realFrames: { rounds: string[][]; error: boolean }[] = [];

function el(id: string): HTMLElement | null {
  return boxes.value?.querySelector<HTMLElement>(`[data-node="${id}"]`) ?? null;
}
function grow(id: string) {
  const e = el(id);
  if (e) e.style.width = `${parseFloat(e.style.width) + 1}px`;
}

function connectRo() {
  ro?.disconnect();
  armed = false;
  hits.value = {};
  roRows.value = [];
  const s = scene.value;
  if (!s || !boxes.value) return;
  for (const n of s.nodes) {
    const e = el(n.id);
    if (e) e.style.width = `${BASE[Math.min(depthOf.value[n.id] - 1, BASE.length - 1)]}px`;
  }
  ro = new ResizeObserver((entries) => {
    if (!armed || roFrame < 0 || roFrame >= FRAMES) return;
    const ids = entries.map((en) => (en.target as HTMLElement).dataset.node ?? '');
    const round = realFrames[roFrame].rounds.push(ids);
    for (const id of ids) hits.value = { ...hits.value, [id]: round };
    for (const id of ids) for (const r of s.reactions[id] ?? []) grow(r);
  });
  for (const id of s.observed) {
    const e = el(id);
    if (e) ro.observe(e);
  }
}

function onError(e: ErrorEvent) {
  if (!e.message.startsWith('ResizeObserver loop')) return;
  if (armed && roFrame >= 0 && roFrame < FRAMES) realFrames[roFrame].error = true;
  e.preventDefault();
}

function push1() {
  const s = scene.value;
  if (!s || !resizeFrame || running.value) return;
  running.value = true;
  hits.value = {};
  realFrames = Array.from({ length: FRAMES }, () => ({ rounds: [], error: false }));
  const dirty = new Set([s.start]);
  const model = Array.from({ length: FRAMES }, () => resizeFrame(depthOf.value, s.observed, dirty, s.reactions));
  window.addEventListener('error', onError);
  requestAnimationFrame(() => {
    roFrame = 0;
    armed = true;
    grow(s.start);
    const tick = () =>
      requestAnimationFrame(() => {
        roFrame++;
        if (roFrame < FRAMES) return tick();
        armed = false;
        roFrame = -1;
        window.removeEventListener('error', onError);
        roRows.value = realFrames.map((f, i) => ({
          real: f.rounds,
          realError: f.error,
          model: model[i].rounds,
          modelError: model[i].error,
        }));
        running.value = false;
      });
    tick();
  });
}

if (props.mode === 'ro') watch(scenePicked, () => nextTick(connectRo));

const same = (r: FrameRow) => JSON.stringify(r.real) === JSON.stringify(r.model) && r.realError === r.modelError;
const roundsText = (rs: string[][]) => (rs.length ? rs.map((r, i) => `${i + 1}: ${r.join(' ')}`).join(' → ') : '—');

/* ═════════════════════════════ жизненный цикл ═════════════════════════════ */

onMounted(() => {
  if (props.mode === 'io') {
    perFrame.push(modelTick);
  } else {
    connectRo();
  }
  if (root.value) {
    seen = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !visible) {
        visible = true;
        // Настоящий наблюдатель заводится вместе со счётчиком кадров: тогда и первая его
        // запись, и предсказание модели получают номер кадра.
        if (props.mode === 'io' && !realIo) connectIo();
        loop();
      } else if (!e.isIntersecting && visible) {
        visible = false;
        cancelAnimationFrame(rafId);
      }
    });
    seen.observe(root.value);
  }
});

onBeforeUnmount(() => {
  cancelAnimationFrame(rafId);
  seen?.disconnect();
  realIo?.disconnect();
  ro?.disconnect();
  window.removeEventListener('error', onError);
});
</script>

<template>
  <div ref="root">
    <DemoFrame v-if="mode === 'io'">
      <template #toolbar>
        <div class="ol-toolbar">
          <SegmentedControl v-model="thPicked" class="l-pills" label="Пороги" :options="thOptionsUi" />
          <div class="ol-range">
            <label class="ol-range__label" for="observer-lab-margin">rootMargin снизу</label>
            <input
              id="observer-lab-margin"
              v-model.number="margin"
              class="ol-range__input"
              type="range"
              min="-120"
              max="240"
              step="10"
            />
            <output class="ol-range__value" for="observer-lab-margin">{{ margin }} px</output>
          </div>
        </div>
      </template>

      <div class="ol-body ol-split">
        <div class="ol-stage" :style="{ height: `${stageH}px` }">
          <div ref="scroller" class="ol-scroller" :style="{ height: `${SCROLLER_H}px` }" tabindex="0" aria-label="Прокручиваемая рамка — корень наблюдателя">
            <div class="ol-content">
              <span class="ol-hint">прокрутите вниз</span>
              <div ref="target" class="ol-target" :data-on="current?.isIntersecting ? 'yes' : 'no'">цель</div>
            </div>
          </div>
          <div class="ol-zone" :style="{ height: `${Math.max(0, SCROLLER_H + margin)}px` }" aria-hidden="true" />
          <div v-if="margin > 0" class="ol-band" :style="{ top: `${SCROLLER_H}px`, height: `${margin}px` }" aria-hidden="true">
            <div class="ol-ghost" :style="{ top: `${ghostTop}px`, height: `${ghostH}px` }" />
          </div>
        </div>

        <div class="ol-side">
          <div v-if="current" class="ol-readout">
            <div class="ol-stat"><span class="ol-k">intersectionRatio</span><code>{{ pct(current.intersectionRatio) }}</code></div>
            <div class="ol-stat"><span class="ol-k">isIntersecting</span><code :data-tone="current.isIntersecting ? 'ok' : 'warn'">{{ current.isIntersecting }}</code></div>
            <div class="ol-stat"><span class="ol-k">ступенька</span><code>{{ current.thresholdIndex }} из {{ thresholds.length }}</code></div>
            <div class="ol-stat"><span class="ol-k">кадр</span><code>{{ frame }}</code></div>
          </div>
          <span class="ol-label">журнал, новое сверху</span>
          <ol class="ol-log" aria-live="polite">
            <li v-for="row in ioLog" :key="row.key" class="ol-log__row" :data-phase="row.phase">
              <span class="ol-log__frame">кадр {{ row.frame }}</span>
              <span class="ol-log__phase">{{ row.phase }}</span>
              <span class="ol-log__text">{{ row.text }}<template v-if="row.ok !== undefined"> · {{ row.ok ? 'модель совпала' : 'модель разошлась' }}</template></span>
            </li>
          </ol>
        </div>
      </div>
      <div class="ol-body ol-body--foot">
        <Md class="ol-caption" :text="caption" />
      </div>
    </DemoFrame>

    <DemoFrame v-else>
      <template #toolbar>
        <div class="ol-toolbar">
          <SegmentedControl v-model="scenePicked" class="l-pills" label="Сцена" :options="sceneOptions" />
          <Button variant="primary" :disabled="running" @click="push1">толкнуть {{ scene?.start }}</Button>
        </div>
      </template>

      <div class="ol-body">
        <Md v-if="scene" class="ol-note" :text="scene.note" />

        <div class="ol-split">
          <div ref="boxes" class="ol-boxes">
            <template v-for="a in tree" :key="a.id">
              <div class="ol-node" :data-node="a.id" :data-hit="hits[a.id] ?? 0">
                <span class="ol-node__name">{{ a.id }} · глубина {{ a.depth }}</span>
                <template v-for="b in a.children" :key="b.id">
                  <div class="ol-node" :data-node="b.id" :data-hit="hits[b.id] ?? 0">
                    <span class="ol-node__name">{{ b.id }} · глубина {{ b.depth }}</span>
                    <template v-for="c in b.children" :key="c.id">
                      <div class="ol-node" :data-node="c.id" :data-hit="hits[c.id] ?? 0">
                        <span class="ol-node__name">{{ c.id }} · глубина {{ c.depth }}</span>
                        <div v-for="d in c.children" :key="d.id" class="ol-node" :data-node="d.id" :data-hit="hits[d.id] ?? 0">
                          <span class="ol-node__name">{{ d.id }} · глубина {{ d.depth }}</span>
                        </div>
                      </div>
                    </template>
                  </div>
                </template>
              </div>
            </template>
          </div>

          <div class="ol-side">
            <span class="ol-label">круги по кадрам</span>
            <div class="ol-frames" role="table" aria-label="Круги ResizeObserver: браузер и модель">
              <div class="ol-frames__head" role="row">
                <span role="columnheader">кадр</span>
                <span role="columnheader">браузер</span>
                <span role="columnheader">RO_CODE</span>
              </div>
              <div v-if="!roRows.length" class="ol-frames__empty" role="row">
                <span role="cell">пока пусто — толкните первый блок</span>
              </div>
              <div v-for="(r, i) in roRows" :key="i" class="ol-frames__row" role="row" :data-same="same(r) ? 'yes' : 'no'">
                <span role="cell" class="ol-frames__n">{{ i + 1 }}</span>
                <span role="cell"><code>{{ roundsText(r.real) }}</code><span v-if="r.realError" class="ol-chip">ошибка</span></span>
                <span role="cell"><code>{{ roundsText(r.model) }}</code><span v-if="r.modelError" class="ol-chip">ошибка</span></span>
              </div>
            </div>
          </div>
        </div>

        <Md class="ol-caption" :text="caption" />
      </div>
    </DemoFrame>
  </div>
</template>

<style scoped>
.ol-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 20px;
}
.ol-range {
  display: flex;
  flex: 1 1 240px;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  min-width: 0;
}
.ol-range__label,
.ol-range__value {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}
.ol-range__input {
  flex: 1 1 120px;
  min-width: 0;
  height: 4px;
  margin: 0;
  appearance: none;
  border-radius: var(--r-full);
  background: var(--surface-3);
  font: inherit;
  color: inherit;
}
.ol-range__input::-webkit-slider-thumb {
  appearance: none;
  width: 14px;
  height: 14px;
  border: 0;
  border-radius: var(--r-full);
  background: var(--accent);
  cursor: pointer;
}
.ol-range__input::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border: 0;
  border-radius: var(--r-full);
  background: var(--accent);
  cursor: pointer;
}

.ol-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.ol-body--foot {
  padding-top: 0;
}
.ol-split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
  gap: 20px;
  align-items: start;
}
@media (max-width: 760px) {
  .ol-split {
    grid-template-columns: minmax(0, 1fr);
  }
}
.ol-note,
.ol-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.ol-note :deep(code),
.ol-caption :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
.ol-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}

/* ── режим io ── */
.ol-stage {
  position: relative;
  min-width: 0;
}
.ol-scroller {
  position: relative;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: var(--r3);
  background: var(--surface-2);
}
.ol-scroller:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.ol-content {
  position: relative;
  height: 760px;
}
.ol-hint {
  position: absolute;
  top: 12px;
  left: 14px;
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.ol-target {
  position: absolute;
  top: 380px;
  left: 20%;
  width: 60%;
  height: 120px;
  display: grid;
  place-items: center;
  border: 1px solid var(--tone-warn-line);
  border-radius: var(--r2);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
  font-family: var(--mono);
  font-size: var(--fs-3);
}
.ol-target[data-on='yes'] {
  border-color: var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.ol-zone {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  border: 1px dashed var(--tone-info-line);
  border-radius: var(--r3);
  pointer-events: none;
}
.ol-band {
  position: absolute;
  left: 0;
  right: 0;
  overflow: hidden;
  pointer-events: none;
}
.ol-ghost {
  position: absolute;
  left: 20%;
  width: 60%;
  border: 1px dashed var(--tone-warn-line);
  border-radius: var(--r2);
  background: var(--tone-info-bg);
}

.ol-side {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.ol-readout {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 8px;
}
.ol-stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border-radius: var(--r2);
  background: var(--surface-2);
}
.ol-k {
  overflow-wrap: anywhere;
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.ol-stat code {
  font-family: var(--mono);
  font-size: var(--fs-4);
  color: var(--ink);
}
.ol-stat code[data-tone='ok'] {
  color: var(--tone-ok-text);
}
.ol-stat code[data-tone='warn'] {
  color: var(--tone-warn-text);
}
.ol-log {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
  min-height: 120px;
}
.ol-log__row {
  display: grid;
  grid-template-columns: 5.5em 4.5em minmax(0, 1fr);
  gap: 8px;
  align-items: baseline;
  padding: 6px 10px;
  border-radius: var(--r2);
  background: var(--surface-2);
  font-size: var(--fs-3);
  color: var(--prose);
}
.ol-log__row[data-phase='задача'] {
  background: var(--tone-info-bg);
}
.ol-log__frame,
.ol-log__phase {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.ol-log__text {
  overflow-wrap: anywhere;
}
@media (max-width: 520px) {
  .ol-log__row {
    grid-template-columns: auto auto;
    justify-content: start;
  }
  .ol-log__text {
    grid-column: 1 / -1;
  }
}

/* ── режим ro ── */
.ol-boxes {
  min-width: 0;
  overflow-x: auto;
  padding-bottom: 4px;
}
.ol-node {
  box-sizing: border-box;
  margin-top: 8px;
  padding: 8px 10px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--surface-2);
  transition: background-color 0.3s;
}
.ol-boxes > .ol-node {
  margin-top: 0;
}
.ol-node[data-hit='1'] {
  border-color: var(--tone-info-line);
  background: var(--tone-info-bg);
}
.ol-node[data-hit='2'] {
  border-color: var(--tone-ok-line);
  background: var(--tone-ok-bg);
}
.ol-node[data-hit='3'],
.ol-node[data-hit='4'] {
  border-color: var(--tone-warn-line);
  background: var(--tone-warn-bg);
}
.ol-node__name {
  display: block;
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
  white-space: nowrap;
}
@media (prefers-reduced-motion: reduce) {
  .ol-node {
    transition: none;
  }
}

.ol-frames {
  display: flex;
  flex-direction: column;
  font-size: var(--fs-3);
  color: var(--prose);
}
.ol-frames__head,
.ol-frames__row {
  display: grid;
  grid-template-columns: 3em minmax(0, 1fr) minmax(0, 1fr);
  gap: 8px;
  padding: 6px 8px;
  align-items: baseline;
}
.ol-frames__head {
  font-family: var(--mono);
  font-size: var(--fs-2);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}
.ol-frames__row {
  border-top: 1px solid var(--hairline);
}
.ol-frames__row[data-same='no'] {
  background: var(--tone-err-bg);
}
.ol-frames__empty {
  padding: 10px 8px;
  border-top: 1px solid var(--hairline);
  color: var(--text-muted);
}
.ol-frames__n {
  font-family: var(--mono);
  color: var(--text-muted);
}
.ol-frames code {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
  overflow-wrap: anywhere;
}
.ol-chip {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: var(--r1);
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
  font-size: var(--fs-2);
}
</style>
