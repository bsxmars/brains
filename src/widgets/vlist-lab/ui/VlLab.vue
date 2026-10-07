<script setup lang="ts">
/**
 * Длинный список тремя способами: окно, `content-visibility: auto` и «всё в DOM».
 *
 * Демо вычисляет, а не пересказывает. Окно считают функции из `WINDOW_CODE` — той же строки,
 * что напечатана в теме и проверена тестом (`loadWindow`). Число узлов — настоящий
 * `querySelectorAll('*')` по списку и по странице, поиск — настоящий `window.find`.
 *
 * Строки живут **вне Vue**: обёртка `box` пуста в шаблоне, и её детей ведёт код ниже. Причины
 * две. Сто тысяч строк через `v-for` — это сто тысяч vnode и секунды работы рендерера, а замер
 * должен показывать цену DOM, а не цену фреймворка. И окно обязано переиспользовать узлы
 * по номеру строки: пересозданный узел теряет фокус и якорь прокрутки (раздел «Разная высота»).
 *
 * ⚠️ Тяжёлые режимы строятся только по кнопке — ни в `setup`, ни в `onMounted`: остров
 * гидратируется при прокрутке к нему, и полмиллиона узлов посреди чтения никто не заказывал.
 * В `setup` нет ничего, кроме сборки функций окна: он исполняется и в Node при сборке.
 *
 * Реактивное здесь — только числа для панели. Узлы, смещения и наблюдатель нереактивны:
 * пишутся из обработчиков прокрутки и наблюдателя, а не из рендера.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button, SegmentedControl } from '@/shared/ui';
import { extraLines, groups, loadWindow } from '../model/window';
import type { VlMode, VlRange } from '../model/types';

const props = defineProps<{
  /** `WINDOW_CODE` из темы. */
  code: string;
  modes: VlMode[];
  /** Номер строки, которую ищет `window.find`. */
  target: number;
  /** Подвал демо. Строчная разметка. */
  footer: string;
}>();

const win = loadWindow(props.code);

/** Высота строки в режиме «одинаковая» и оценка до измерения в режиме «разная». */
const ROW_H = 36;
const MORE_TEXT = ['подробности заказа и адрес доставки', 'комментарий покупателя к заказу'];

const COUNTS = [
  { value: '10000', label: '10 000' },
  { value: '100000', label: '100 000' },
];
const HEIGHTS = [
  { value: 'fixed', label: 'одинаковая' },
  { value: 'variable', label: 'разная' },
];
const OVERSCANS = [
  { value: '0', label: '0' },
  { value: '3', label: '3' },
  { value: '10', label: '10' },
];
const FIXES = [
  { value: 'on', label: 'поправлять' },
  { value: 'off', label: 'не поправлять' },
];

const modeKey = ref<VlMode['key']>('virtual');
const countKey = ref('10000');
const heightKey = ref('fixed');
const overscanKey = ref('3');
const fixKey = ref('on');

const modeOptions = computed(() => props.modes.map((m) => ({ value: m.key, label: m.label })));
const mode = computed(() => props.modes.find((m) => m.key === modeKey.value) ?? props.modes[0]);
const count = computed(() => Number(countKey.value));
const variable = computed(() => heightKey.value === 'variable');
const overscan = computed(() => Number(overscanKey.value));

/* ── Панель: только числа ── */
const built = ref(false);
const building = ref(false);
const range = ref<VlRange | null>(null);
const visible = ref<VlRange | null>(null);
const listNodes = ref<number | null>(null);
const pageNodes = ref<number | null>(null);
const total = ref(0);
const measured = ref(0);
const corrected = ref(0);
const found = ref<{ ok: boolean; text: string } | null>(null);

/* ── Нереактивное: DOM и смещения ── */
const scroller = ref<HTMLDivElement | null>(null);
const box = ref<HTMLDivElement | null>(null);
const alive = new Map<number, HTMLElement>();
let offsets: Float64Array = new Float64Array(1);
let measuredFlags = new Uint8Array(0);
let observer: ResizeObserver | null = null;

function rowHtml(i: number, withAria: boolean, n: number): string {
  const aria = withAria ? ` aria-setsize="${n}" aria-posinset="${i + 1}"` : '';
  const k = variable.value ? extraLines(i) : 0;
  const more = k ? `<span class="vl-more">${MORE_TEXT.slice(0, k).join('<br>')}</span>` : '';
  return `<div class="vl-row" role="listitem" data-i="${i}"${aria}><span class="vl-num">${i}</span>строка №${i}${more}</div>`;
}

function makeRow(i: number): HTMLElement {
  const holder = document.createElement('div');
  holder.innerHTML = rowHtml(i, true, count.value);
  return holder.firstElementChild as HTMLElement;
}

function countNodes() {
  listNodes.value = scroller.value ? scroller.value.querySelectorAll('*').length : null;
  pageNodes.value = document.querySelectorAll('*').length;
}

/** Окно в режиме виртуализации: диапазон — функциями темы, узлы — по номеру строки. */
function paint() {
  const sc = scroller.value;
  const el = box.value;
  if (!sc || !el || modeKey.value !== 'virtual') return;
  const st = sc.scrollTop;
  const vp = sc.clientHeight;
  const n = count.value;
  const r = variable.value
    ? win.variableRange(st, vp, offsets, overscan.value)
    : win.fixedRange(st, vp, ROW_H, n, overscan.value);
  el.style.paddingTop = `${r.padTop}px`;
  el.style.paddingBottom = `${r.padBottom}px`;

  for (const [i, row] of alive) {
    if (i >= r.start && i < r.end) continue;
    observer?.unobserve(row);
    row.remove();
    alive.delete(i);
  }
  let prev: Element | null = null;
  for (let i = r.start; i < r.end; i += 1) {
    let row = alive.get(i);
    if (!row) {
      row = makeRow(i);
      alive.set(i, row);
      observer?.observe(row);
    }
    const want: Node | null = prev ? prev.nextSibling : el.firstChild;
    if (want !== row) el.insertBefore(row, want);
    prev = row;
  }

  range.value = r;
  visible.value = variable.value ? win.variableRange(st, vp, offsets, 0) : win.fixedRange(st, vp, ROW_H, n, 0);
  total.value = variable.value ? offsets[n] : n * ROW_H;
  countNodes();
}

/**
 * Измерение после рендера. Высоты приходят пачкой после раскладки; строки обрабатываются
 * по возрастанию номера, и каждая следующая сравнивается с уже поправленной прокруткой.
 */
function onResize(entries: ResizeObserverEntry[]) {
  const sc = scroller.value;
  if (!sc || !variable.value) return;
  const st = sc.scrollTop;
  let shift = 0;
  const sorted = entries
    .map((e) => ({ i: Number((e.target as HTMLElement).dataset.i), h: e.borderBoxSize?.[0]?.blockSize ?? e.contentRect.height }))
    .filter((e) => Number.isFinite(e.i) && e.h > 0)
    .sort((a, b) => a.i - b.i);
  for (const { i, h } of sorted) {
    if (!measuredFlags[i]) {
      measuredFlags[i] = 1;
      measured.value += 1;
    }
    const fix = win.applyMeasured(offsets, i, h, st + shift);
    if (fixKey.value === 'on') shift += fix;
  }
  if (shift !== 0) {
    // Присваивание от сохранённого значения, а не `+=`: см. тонкое место про двойную поправку.
    sc.scrollTop = st + shift;
    corrected.value += Math.abs(shift);
  }
  paint();
}

/** Полный список — одной строкой разметки; только по кнопке. */
async function build() {
  const el = box.value;
  if (!el || building.value) return;
  building.value = true;
  await nextTick();
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  const n = count.value;
  const parts: string[] = [];
  for (let i = 0; i < n; i += 1) parts.push(rowHtml(i, false, n));
  el.innerHTML = parts.join('');
  building.value = false;
  built.value = true;
  total.value = scroller.value?.scrollHeight ?? 0;
  countNodes();
}

function reset() {
  const sc = scroller.value;
  const el = box.value;
  if (!sc || !el) return;
  observer?.disconnect();
  alive.clear();
  el.textContent = '';
  el.style.paddingTop = '';
  el.style.paddingBottom = '';
  sc.scrollTop = 0;
  built.value = false;
  range.value = null;
  visible.value = null;
  found.value = null;
  measured.value = 0;
  corrected.value = 0;
  total.value = 0;

  if (modeKey.value === 'virtual') {
    const n = count.value;
    offsets = win.prefixSums(new Array<number>(n).fill(ROW_H));
    measuredFlags = new Uint8Array(n);
    paint();
  } else {
    countNodes();
  }
}

function onScroll() {
  if (modeKey.value === 'virtual') paint();
}

/**
 * Поиск тем же способом, каким ищет пользователь: по тексту в DOM. `window.find` нестандартен,
 * но есть в Chromium, Firefox и WebKit; где его нет — так и сказано.
 */
function search() {
  const sc = scroller.value;
  const finder = (window as Window & { find?: (s: string, cs?: boolean, back?: boolean, wrap?: boolean) => boolean }).find;
  if (!sc || typeof finder !== 'function') {
    found.value = { ok: false, text: 'В этом браузере `window.find` нет — проверьте поиском по странице (Ctrl+F).' };
    return;
  }
  const query = `строка №${props.target}`;
  const selection = window.getSelection();
  selection?.removeAllRanges();
  // «строка №8765» — начало и у «строка №87650»: ищем, пока не попадём в нужную строку.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!finder.call(window, query, true, false, false)) break;
    const node = selection?.anchorNode;
    const row = (node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>('[data-i]');
    if (!row || !sc.contains(row)) continue;
    if (Number(row.dataset.i) !== props.target) continue;
    sc.scrollTop += row.getBoundingClientRect().top - sc.getBoundingClientRect().top - sc.clientHeight / 2;
    found.value = { ok: true, text: `Нашёл: строка есть в DOM (\`data-i="${props.target}"\`).` };
    return;
  }
  selection?.removeAllRanges();
  found.value = { ok: false, text: 'Не нашёл: этой строки нет в DOM. Ctrl+F ответит так же — «совпадений нет».' };
}

watch([modeKey, countKey, heightKey], () => reset());
watch(overscanKey, () => paint());

onMounted(() => {
  observer = typeof ResizeObserver === 'function' ? new ResizeObserver(onResize) : null;
  reset();
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
});

const needsBuild = computed(() => mode.value.heavy && !built.value);

/** Схема распорок: доли высоты списка, окно — не тоньше двух пикселей, чтобы его было видно. */
const map = computed(() => {
  const r = range.value;
  if (!r || total.value <= 0) return null;
  const windowPx = total.value - r.padTop - r.padBottom;
  return { top: r.padTop / total.value, win: windowPx / total.value, bottom: r.padBottom / total.value };
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="vl-controls">
        <div class="vl-control">
          <span class="t-label">список</span>
          <SegmentedControl v-model="modeKey" class="l-pills" label="Как список попадает в DOM" :options="modeOptions" />
        </div>
        <div class="vl-control">
          <span class="t-label">строк</span>
          <SegmentedControl v-model="countKey" class="l-pills" label="Сколько строк" :options="COUNTS" />
        </div>
        <div class="vl-control">
          <span class="t-label">высота</span>
          <SegmentedControl v-model="heightKey" class="l-pills" label="Высота строк" :options="HEIGHTS" />
        </div>
        <div v-if="modeKey === 'virtual'" class="vl-control">
          <span class="t-label">overscan</span>
          <SegmentedControl v-model="overscanKey" class="l-pills" label="Запас строк за окном" :options="OVERSCANS" />
        </div>
        <div v-if="modeKey === 'virtual' && variable" class="vl-control">
          <span class="t-label">прокрутка</span>
          <SegmentedControl v-model="fixKey" class="l-pills" label="Поправлять прокрутку при уточнении высот" :options="FIXES" />
        </div>
      </div>
    </template>

    <div class="vl-body">
      <div class="vl-stage">
        <div
          ref="scroller"
          class="vl-scroller"
          :class="{ 'vl-cv': modeKey === 'cv', 'vl-fixed': !variable }"
          tabindex="0"
          role="region"
          aria-label="Длинный список"
          @scroll.passive="onScroll"
        >
          <div ref="box" class="vl-box" role="list" aria-label="Строки списка"></div>
          <div v-if="needsBuild" class="vl-empty">
            <Button variant="primary" :disabled="building" @click="build">
              {{ building ? 'строю…' : `построить ${groups(count)} строк` }}
            </Button>
          </div>
        </div>

        <div v-if="modeKey === 'virtual' && map" class="vl-map" aria-hidden="true">
          <div class="vl-map__pad" :style="{ flexGrow: map.top }"></div>
          <div class="vl-map__win"></div>
          <div class="vl-map__pad" :style="{ flexGrow: map.bottom }"></div>
        </div>
      </div>

      <div class="vl-stats">
        <div class="vl-stat">
          <span class="t-label">узлов в списке</span>
          <span class="vl-stat__value" data-tone="ink">{{ listNodes === null ? '—' : groups(listNodes) }}</span>
        </div>
        <div class="vl-stat">
          <span class="t-label">узлов на странице</span>
          <span class="vl-stat__value" data-tone="chip">{{ pageNodes === null ? '—' : groups(pageNodes) }}</span>
        </div>
        <template v-if="modeKey === 'virtual'">
          <div class="vl-stat">
            <span class="t-label">окно [start, end)</span>
            <span class="vl-stat__value" data-tone="info">{{ range ? `[${groups(range.start)}, ${groups(range.end)})` : '—' }}</span>
          </div>
          <div class="vl-stat">
            <span class="t-label">видно</span>
            <span class="vl-stat__value" data-tone="chip">{{ visible ? `${groups(visible.start)}…${groups(visible.end - 1)}` : '—' }}</span>
          </div>
          <div class="vl-stat">
            <span class="t-label">распорка сверху / снизу</span>
            <span class="vl-stat__value" data-tone="chip">{{ range ? `${groups(range.padTop)} / ${groups(range.padBottom)} px` : '—' }}</span>
          </div>
          <div class="vl-stat">
            <span class="t-label">высота списка</span>
            <span class="vl-stat__value" data-tone="chip">{{ groups(total) }} px</span>
          </div>
          <template v-if="variable">
            <div class="vl-stat">
              <span class="t-label">измерено строк</span>
              <span class="vl-stat__value" data-tone="ok">{{ groups(measured) }} из {{ groups(count) }}</span>
            </div>
            <div class="vl-stat">
              <span class="t-label">поправлено прокрутки</span>
              <span class="vl-stat__value" :data-tone="fixKey === 'on' ? 'ok' : 'warn'">{{ fixKey === 'on' ? `${groups(corrected)} px` : 'выключено' }}</span>
            </div>
          </template>
        </template>
        <div v-else class="vl-stat">
          <span class="t-label">высота списка</span>
          <span class="vl-stat__value" data-tone="chip">{{ built ? `${groups(total)} px` : '—' }}</span>
        </div>
      </div>

      <div class="vl-find">
        <Button variant="secondary" @click="search">найти {{ target }} через window.find</Button>
        <Md v-if="found" class="vl-find__result" :data-tone="found.ok ? 'ok' : 'err'" :text="found.text" />
      </div>

      <Md class="vl-note" :text="mode.note" />
    </div>

    <template #footer>
      <Md class="vl-disclaimer" :text="footer" />
    </template>
  </DemoFrame>
</template>

<style scoped>
.vl-controls {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.vl-control {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.vl-control .t-label {
  min-width: 86px;
}

.vl-body {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 22px 20px;
}

.vl-stage {
  display: flex;
  gap: 10px;
  min-width: 0;
}
.vl-scroller {
  position: relative;
  flex: 1;
  min-width: 0;
  height: 320px;
  overflow-x: hidden;
  overflow-y: auto;
  /* Прокрутку при уточнении высот поправляет код; якорение браузера дало бы вторую поправку. */
  overflow-anchor: none;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--surface);
}
.vl-scroller:focus-visible {
  outline: 2px solid var(--tone-info-strong);
  outline-offset: 2px;
}
.vl-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}

.vl-map {
  display: flex;
  flex-direction: column;
  flex: 0 0 12px;
  height: 320px;
  border-radius: var(--r1);
  overflow: hidden;
}
.vl-map__pad {
  flex-basis: 0;
  background: var(--surface-3);
}
.vl-map__win {
  flex: 0 0 3px;
  background: var(--tone-info-strong);
}

.vl-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(170px, 100%), 1fr));
  gap: 12px;
  padding-top: 16px;
  border-top: 1px solid var(--rule);
}
.vl-stat {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}
.vl-stat__value {
  font-family: var(--mono);
  font-size: var(--fs-6);
  overflow-wrap: anywhere;
}
.vl-stat__value[data-tone='ink'] {
  color: var(--ink);
}
.vl-stat__value[data-tone='chip'] {
  color: var(--chip-text);
}
.vl-stat__value[data-tone='info'] {
  color: var(--tone-info-strong);
}
.vl-stat__value[data-tone='ok'] {
  color: var(--tone-ok-strong);
}
.vl-stat__value[data-tone='warn'] {
  color: var(--tone-warn-strong-2);
}

.vl-find {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}
.vl-find__result {
  font-size: var(--fs-5);
  line-height: 1.5;
}
.vl-find__result[data-tone='ok'] {
  color: var(--tone-ok-text);
}
.vl-find__result[data-tone='err'] {
  color: var(--tone-err-text);
}

.vl-note {
  padding: 14px 16px;
  border: 1px solid var(--tone-info-line);
  border-radius: var(--r2);
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
  font-size: var(--fs-6);
  line-height: 1.6;
}

.vl-disclaimer {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}

/* Строки создаёт код, а не шаблон, поэтому селекторы — через :deep. */
.vl-box :deep(.vl-row) {
  box-sizing: border-box;
  padding: 8px 12px;
  border-bottom: 1px solid var(--rule);
  font-size: var(--fs-5);
  line-height: 19px;
  color: var(--text);
}
.vl-fixed .vl-box :deep(.vl-row) {
  height: 36px;
  overflow: hidden;
  white-space: nowrap;
}
.vl-cv .vl-box :deep(.vl-row) {
  content-visibility: auto;
  contain-intrinsic-size: auto 36px;
}
.vl-box :deep(.vl-num) {
  display: inline-block;
  min-width: 6ch;
  margin-right: 10px;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-muted);
}
.vl-box :deep(.vl-more) {
  display: block;
  padding-left: calc(6ch + 10px);
  color: var(--text-muted);
}
</style>
