<script setup lang="ts">
/**
 * «Догрузить сверху»: настоящая прокручиваемая лента с липкими шапками дней.
 *
 * Прокручивает и якорит сам браузер. Рядом считают строки темы, собранные `new Function`
 * (`model/run.ts`): `ANCHOR_CODE` выбирает якорь по снимку ленты — его журнал и подсветка
 * видны на каждом кадре прокрутки, — а `STICKY_CODE` считает сдвиг каждой шапки, который
 * стоит рядом со сдвигом, измеренным у браузера. Те же строки сверяются с Chromium
 * в `tests/unit/scrolling.test.ts`.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button, SegmentedControl } from '@/shared/ui';
import { loadAnchor, loadSticky, snapshot } from '../model/run';
import type { AnchorLog, FeedGroup } from '../model/types';

const props = defineProps<{
  stickyCode: string;
  anchorCode: string;
  feed: FeedGroup[];
  older: FeedGroup[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const sticky = loadSticky(props.stickyCode);
const selectAnchor = loadAnchor(props.anchorCode);

const groups = ref<FeedGroup[]>([...props.feed]);
const olderLeft = ref<FeedGroup[]>([...props.older]);

const anchorMode = ref<'auto' | 'none'>('auto');
const padMode = ref<'0' | 'head'>('0');
const anchorOptions = [
  { value: 'auto', label: 'auto' },
  { value: 'none', label: 'none' },
];
const padOptions = [
  { value: '0', label: '0' },
  { value: 'head', label: 'высота шапки' },
];

/** Высота липкой шапки — она же `scroll-padding-top` во втором режиме. */
const HEAD = 34;
const frameStyle = computed(() => ({
  overflowAnchor: anchorMode.value,
  scrollPaddingTop: padMode.value === 'head' ? `${HEAD}px` : '0px',
}));

const frame = ref<HTMLElement | null>(null);
const log = ref<AnchorLog>([]);
/** `data-sid` элемента-якоря (у текстового якоря — его родителя). */
const anchorSid = ref<string | null>(null);
const report = ref('');

interface StickyRow {
  day: string;
  normal: number;
  model: number;
  real: number;
  /** Шапка сейчас в окне ленты и сдвинута — то есть прилипла. */
  stuck: boolean;
}
const stickyRows = ref<StickyRow[]>([]);

/** Места шапок в потоке, в координатах содержимого: от прокрутки не зависят. */
let normals: number[] = [];

/** Верх содержимого ленты в координатах окна: от него считаются все `top` снимка. */
function base(el: HTMLElement) {
  return el.getBoundingClientRect().top + el.clientTop - el.scrollTop;
}

function heads(el: HTMLElement) {
  return [...el.querySelectorAll<HTMLElement>('.sl-head')];
}

function measureNormals() {
  const el = frame.value;
  if (!el) return;
  const hs = heads(el);
  hs.forEach((h) => (h.style.position = 'static'));
  const b = base(el);
  normals = hs.map((h) => h.getBoundingClientRect().top - b);
  hs.forEach((h) => (h.style.position = ''));
}

function refresh() {
  const el = frame.value;
  if (!el) return;
  const refs: Record<string, Element> = {};
  const entries: AnchorLog = [];
  const a = selectAnchor(snapshot(el, refs), entries);
  log.value = entries;
  anchorSid.value = a ? (refs[a.id]?.getAttribute('data-sid') ?? null) : null;

  const b = base(el);
  const fcs = getComputedStyle(el);
  stickyRows.value = heads(el).map((h, i) => {
    const s = getComputedStyle(h);
    const sec = h.parentElement as HTMLElement;
    const ss = getComputedStyle(sec);
    const sr = sec.getBoundingClientRect();
    const hr = h.getBoundingClientRect();
    const px = (v: string) => parseFloat(v) || 0;
    const model = sticky({
      scrollTop: el.scrollTop,
      portHeight: el.clientHeight,
      padTop: px(fcs.paddingTop),
      padBottom: px(fcs.paddingBottom),
      top: s.top === 'auto' ? null : px(s.top),
      bottom: s.bottom === 'auto' ? null : px(s.bottom),
      elTop: normals[i] ?? 0,
      elHeight: hr.height,
      marginTop: px(s.marginTop),
      marginBottom: px(s.marginBottom),
      cbTop: sr.top - b + px(ss.borderTopWidth) + px(ss.paddingTop),
      cbBottom: sr.bottom - b - px(ss.borderBottomWidth) - px(ss.paddingBottom),
    });
    const real = Math.round(hr.top - b - (normals[i] ?? 0));
    const ft = el.getBoundingClientRect().top + el.clientTop;
    const visible = hr.bottom > ft && hr.top < ft + el.clientHeight;
    return { day: h.textContent ?? '', normal: Math.round(normals[i] ?? 0), model: Math.round(model), real, stuck: visible && real !== 0 };
  });
}

let raf = 0;
function schedule() {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    refresh();
  });
}

const round = (n: number) => Math.round(n);

async function load() {
  const el = frame.value;
  const next = olderLeft.value[0];
  if (!el || !next) return;

  const refs: Record<string, Element> = {};
  const entries: AnchorLog = [];
  const a = selectAnchor(snapshot(el, refs), entries);
  const target = a ? (refs[a.id] as HTMLElement | undefined) : undefined;
  const frameTop = el.getBoundingClientRect().top;
  const y0 = target ? target.getBoundingClientRect().top - frameTop : 0;
  const st0 = el.scrollTop;
  // Высоту вставки меряем по тому, на сколько сдвинулся прежний первый день в раскладке.
  const first = el.querySelector<HTMLElement>('.sl-day');
  const f0 = first ? first.getBoundingClientRect().top - base(el) : 0;
  const why = entries[0]?.[0] === 'контейнер' ? entries[0][1] : '';

  olderLeft.value = olderLeft.value.slice(1);
  groups.value = [next, ...groups.value];
  await nextTick();

  // Чтение `scrollTop` заставляет посчитать раскладку — в ней браузер и сдвигает прокрутку.
  const st1 = el.scrollTop;
  const added = first ? first.getBoundingClientRect().top - base(el) - f0 : 0;
  const shift = st1 - st0;
  const name = target?.getAttribute('data-sid');

  if (a && target && target.isConnected) {
    const y1 = target.getBoundingClientRect().top - frameTop;
    report.value =
      `Сверху добавлено **${round(added)}px**. \`scrollTop\`: ${round(st0)} → ${round(st1)} (**${shift >= 0 ? '+' : ''}${round(shift)}**). ` +
      `Якорь \`${name}\` на экране был на ${round(y0)}px от верха ленты, стал на ${round(y1)}px` +
      (Math.abs(y1 - y0) < 1 ? ' — не сдвинулся.' : ` — уехал на ${round(y1 - y0)}px.`);
  } else {
    report.value =
      `Сверху добавлено **${round(added)}px**. Якоря не было${why ? ` (${why})` : ''}: \`scrollTop\` ${round(st0)} → ${round(st1)}, ` +
      `и всё видимое уехало вниз на ${round(added - shift)}px.`;
  }

  measureNormals();
  refresh();
}

function toTop() {
  if (frame.value) frame.value.scrollTop = 0;
}

async function reset() {
  groups.value = [...props.feed];
  olderLeft.value = [...props.older];
  report.value = '';
  await nextTick();
  if (frame.value) frame.value.scrollTop = frame.value.scrollHeight;
  measureNormals();
  refresh();
}

watch([anchorMode, padMode], async () => {
  await nextTick();
  refresh();
});

onMounted(() => {
  if (frame.value) frame.value.scrollTop = frame.value.scrollHeight;
  measureNormals();
  refresh();
});

onBeforeUnmount(() => {
  if (raf) cancelAnimationFrame(raf);
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="sl-tools">
        <div class="sl-control">
          <span class="sl-label">overflow-anchor</span>
          <SegmentedControl v-model="anchorMode" class="l-pills" label="overflow-anchor" :options="anchorOptions" />
        </div>
        <div class="sl-control">
          <span class="sl-label">scroll-padding-top</span>
          <SegmentedControl v-model="padMode" class="l-pills" label="scroll-padding-top" :options="padOptions" />
        </div>
        <div class="sl-buttons">
          <Button variant="primary" :disabled="!olderLeft.length" @click="load">догрузить день сверху</Button>
          <Button variant="secondary" @click="toTop">в самый верх</Button>
          <Button variant="secondary" @click="reset">сначала</Button>
        </div>
      </div>
    </template>

    <div class="sl-body">
      <div class="sl-split">
        <div
          ref="frame"
          class="sl-feed"
          :style="frameStyle"
          tabindex="0"
          aria-label="Лента сообщений с липкими шапками дней"
          @scroll.passive="schedule"
        >
          <section v-for="g in groups" :key="g.id" class="sl-day" :data-sid="g.id">
            <div class="sl-head" :data-sid="`${g.id}-шапка`">{{ g.day }}</div>
            <div
              v-for="(m, i) in g.msgs"
              :key="i"
              class="sl-msg"
              :data-sid="`${g.id}-${i + 1}`"
              :data-anchor="anchorSid === `${g.id}-${i + 1}` ? 'yes' : 'no'"
            >
              {{ m }}
            </div>
          </section>
        </div>

        <div class="sl-side">
          <span class="sl-label">selectAnchor — журнал выбора</span>
          <ol class="sl-log">
            <li v-for="(e, i) in log" :key="i" :data-last="i === log.length - 1 ? 'yes' : 'no'">
              <code>{{ e[0] }}</code> <span>{{ e[1] }}</span>
            </li>
          </ol>
          <Md v-if="report" class="sl-report" :text="report" />
        </div>
      </div>

      <div class="sl-sticky" role="table" aria-label="Сдвиг липких шапок: модель и браузер">
        <div class="sl-sticky__row sl-sticky__row--head" role="row">
          <span role="columnheader">шапка</span>
          <span role="columnheader">в потоке</span>
          <span role="columnheader">stickyOffset</span>
          <span role="columnheader">браузер</span>
        </div>
        <div
          v-for="r in stickyRows"
          :key="r.day"
          class="sl-sticky__row"
          role="row"
          :data-on="r.stuck ? 'yes' : 'no'"
        >
          <span role="cell">{{ r.day }}</span>
          <code role="cell">{{ r.normal }}</code>
          <code role="cell">{{ r.model > 0 ? '+' : '' }}{{ r.model }}</code>
          <code role="cell">{{ r.real > 0 ? '+' : '' }}{{ r.real }}</code>
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
  gap: 12px 18px;
  align-items: end;
}
.sl-control {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sl-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.sl-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}

.sl-split {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 760px) {
  .sl-split {
    grid-template-columns: minmax(0, 1fr);
  }
}

.sl-feed {
  height: 300px;
  overflow: auto;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.sl-feed:focus-visible {
  outline: 2px solid var(--tone-info-line);
  outline-offset: 2px;
}
.sl-head {
  position: sticky;
  top: 0;
  height: 34px;
  box-sizing: border-box;
  padding: 7px 12px;
  background: var(--surface-3);
  border-bottom: 1px solid var(--hairline);
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.sl-msg {
  margin: 8px 12px;
  padding: 8px 12px;
  border-radius: var(--r2);
  background: var(--surface);
  font-size: var(--fs-3);
  line-height: 1.5;
  color: var(--prose);
}
.sl-msg[data-anchor='yes'] {
  background: var(--tone-warn-bg);
  box-shadow: inset 0 0 0 1px var(--tone-warn-line);
  color: var(--tone-warn-text);
}

.sl-side {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.sl-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.sl-log {
  margin: 0;
  padding: 10px 12px 10px 34px;
  max-height: 200px;
  overflow: auto;
  border-radius: var(--r3);
  background: var(--surface-2);
  font-size: var(--fs-3);
  line-height: 1.55;
  color: var(--prose);
}
.sl-log code,
.sl-sticky code {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
  color: var(--ink);
}
.sl-log li[data-last='yes'] {
  font-weight: 600;
}
.sl-report,
.sl-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.sl-report :deep(code),
.sl-caption :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}

.sl-sticky {
  display: flex;
  flex-direction: column;
  padding: 10px 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
  font-size: var(--fs-3);
  color: var(--prose);
  overflow-x: auto;
}
.sl-sticky__row {
  display: grid;
  grid-template-columns: minmax(110px, 1.4fr) minmax(70px, 1fr) minmax(90px, 1fr) minmax(70px, 1fr);
  gap: 8px;
  padding: 5px 0;
  align-items: baseline;
  min-width: 380px;
}
.sl-sticky__row + .sl-sticky__row {
  border-top: 1px solid var(--hairline);
}
.sl-sticky__row--head {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.sl-sticky__row[data-on='yes'] {
  color: var(--tone-warn-text);
  font-weight: 600;
}
</style>
