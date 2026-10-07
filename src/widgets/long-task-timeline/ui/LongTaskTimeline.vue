<script setup lang="ts">
/**
 * Одна длинная задача против нарезанной — на одной шкале и с кликами пользователя.
 *
 * Тезис «разрезание не ускоряет» проверяется прямо на картинке: полоса работы одной и той же
 * длины в любом режиме. Меняется только то, сколько ждёт ввод, и это здесь посчитано, а не
 * заявлено: клик, пришедший в середине куска, обрабатывается не раньше, чем кусок кончится.
 *
 * Отсюда и формула ожидания: `ceil(момент клика / длина куска) × длина куска`. Без уступок
 * знаменателя нет — ждать приходится до конца всей работы.
 *
 * ⚠️ Модель: накладные на сами уступки не учтены (их считает соседнее демо), а просветы между
 * кусками нарисованы схематично — браузеру между вашими кусками нужно куда меньше времени,
 * чем занимает просвет на этой картинке.
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import { SegmentedControl } from '@/shared/ui';
import type { TimelineClick, TimelineMode } from '../model/types';

const props = defineProps<{
  /** Сколько всего работы, мс. */
  work: number;
  modes: TimelineMode[];
  clicks: TimelineClick[];
}>();

const modeKey = ref(props.modes[0].key);
const modeOptions = computed(() => props.modes.map((m) => ({ value: m.key, label: m.label })));
const mode = computed(() => props.modes.find((m) => m.key === modeKey.value) ?? props.modes[0]);

/** Куски работы: без уступок — один на всю ширину. */
const chunks = computed(() => {
  const size = mode.value.chunk;
  if (size === null) return [props.work];
  const count = Math.ceil(props.work / size);
  return Array.from({ length: count }, (_, i) => Math.min(size, props.work - i * size));
});

/** Когда обработается клик: не раньше, чем закончится кусок, внутри которого он пришёл. */
function handledAt(at: number): number {
  const size = mode.value.chunk;
  if (size === null) return props.work;
  return Math.min(props.work, Math.ceil(at / size) * size);
}

const waits = computed(() =>
  props.clicks.map((click) => {
    const handled = handledAt(click.at);
    const wait = handled - click.at;
    const tone = wait >= 200 ? 'err' : wait >= 50 ? 'warn' : 'ok';
    return { ...click, handled, wait, tone };
  }),
);

const worst = computed(() => Math.max(...waits.value.map((w) => w.wait)));
const worstTone = computed(() => (worst.value >= 200 ? 'err' : worst.value >= 50 ? 'warn' : 'ok'));
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="bar">
        <span class="t-label">те же {{ work }} мс работы, разные расклады</span>
        <SegmentedControl v-model="modeKey" class="l-pills" label="Как нарезана работа" :options="modeOptions" />
      </div>
    </template>

    <div class="body">
      <div class="lane">
        <div class="marks">
          <span
            v-for="click in clicks"
            :key="click.at"
            class="mark"
            :style="`left:${(click.at / work) * 100}%`"
          >
            <span class="mark__glyph">▲</span>
            <span class="mark__text">{{ click.label }}</span>
          </span>
        </div>

        <div class="track">
          <div
            v-for="(ms, i) in chunks"
            :key="i"
            class="chunk"
            :data-tone="mode.chunk === null ? 'err' : 'ok'"
            :style="`flex:${ms} 1 0`"
          ></div>
        </div>

        <div class="axis">
          <span>0</span>
          <span>{{ work }} мс</span>
        </div>
      </div>

      <div class="legend">
        <span class="legend__item" data-tone="ok"><i data-tone="ok"></i>ваша работа</span>
        <span class="legend__item" data-tone="warn">
          <i data-tone="warn"></i>зазоры: ввод, рендер, чужие таймеры
        </span>
      </div>

      <div class="waits">
        <div class="t-label">сколько ждал каждый клик</div>
        <div v-for="w in waits" :key="w.at" class="wait" :data-tone="w.tone">
          <span class="wait__k">{{ w.label }} на {{ w.at }} мс</span>
          <span class="wait__arrow">→</span>
          <span class="wait__k">обработан на {{ w.handled }} мс</span>
          <span class="wait__value">ждал {{ w.wait }} мс</span>
        </div>
      </div>

      <div class="totals">
        <div class="total">
          <span class="t-label">поток занят</span>
          <span class="total__value" data-tone="ink">{{ work }} мс</span>
        </div>
        <div class="total">
          <span class="t-label">худший input delay</span>
          <span class="total__value" :data-tone="worstTone">{{ worst }} мс</span>
        </div>
      </div>

      <div class="note" :data-tone="mode.tone">{{ mode.note }}</div>
    </div>

    <template #footer>
      <div class="disclaimer">
        Модель: {{ work }} мс работы, накладные на сами уступки не учтены — их считает демо
        «Сколько стоит сама уступка». Просветы между кусками нарисованы схематично: браузеру там нужно несколько
        миллисекунд, а не столько, сколько занимает просвет.
      </div>
    </template>
  </DemoFrame>
</template>

<style scoped>
.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}

.body {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 22px 20px;
}

.lane {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* Метки кликов стоят над полосой в тех же долях, что и на шкале времени. */
.marks {
  position: relative;
  height: 26px;
}
.mark {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--tone-err-text);
  white-space: nowrap;
}
.mark__glyph {
  font-size: var(--fs-1);
  color: var(--tone-err-strong);
}

/* Амбровая подложка видна в зазорах между кусками — это и есть время браузера. */
.track {
  display: flex;
  gap: 3px;
  height: 22px;
  border-radius: var(--r1);
  background: var(--bar-amber);
  overflow: hidden;
}
.chunk {
  min-width: 2px;
  transition: flex 0.25s;
}
.chunk[data-tone='ok'] {
  background: var(--tone-ok-strong);
}
.chunk[data-tone='err'] {
  background: var(--tone-err-strong);
}

.axis {
  display: flex;
  justify-content: space-between;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--dim);
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
}
.legend__item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: var(--mono);
  font-size: var(--fs-2);
}
.legend__item[data-tone='ok'] {
  color: var(--tone-ok-text);
}
.legend__item[data-tone='warn'] {
  color: var(--tone-warn-strong);
}
.legend__item i {
  width: 14px;
  height: 10px;
  border-radius: 2px;
}
.legend__item i[data-tone='ok'] {
  background: var(--tone-ok-strong);
}
.legend__item i[data-tone='warn'] {
  background: var(--bar-amber);
}

.waits {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.wait {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 9px;
  padding: 9px 12px;
  border-radius: var(--r2);
  transition: all 0.2s;
}
.wait[data-tone='ok'] {
  border: 1px solid var(--tone-ok-line);
  background: var(--tone-ok-bg);
}
.wait[data-tone='warn'] {
  border: 1px solid var(--tone-warn-line);
  background: var(--tone-warn-bg);
}
.wait[data-tone='err'] {
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
}
.wait__k {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--chip-text);
}
.wait__arrow {
  font-size: var(--fs-2);
  color: var(--text-faint);
}
.wait__value {
  margin-left: auto;
  font-family: var(--mono);
  font-size: var(--fs-3);
  font-weight: 600;
}
.wait[data-tone='ok'] .wait__value {
  color: var(--tone-ok-strong);
}
.wait[data-tone='warn'] .wait__value {
  color: var(--tone-warn-strong);
}
.wait[data-tone='err'] .wait__value {
  color: var(--tone-err-strong);
}

.totals {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(170px, 100%), 1fr));
  gap: 12px;
  padding-top: 16px;
  border-top: 1px solid var(--rule);
}
.total {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.total__value {
  font-family: var(--mono);
  font-size: var(--fs-8);
  transition: color 0.2s;
}
.total__value[data-tone='ink'] {
  color: var(--ink);
}
.total__value[data-tone='ok'] {
  color: var(--tone-ok-strong);
}
.total__value[data-tone='warn'] {
  color: var(--tone-warn-strong-2);
}
.total__value[data-tone='err'] {
  color: var(--tone-err-strong);
}

.note {
  padding: 14px 16px;
  border-radius: var(--r2);
  font-size: var(--fs-6);
  line-height: 1.6;
  transition: all 0.2s;
}
.note[data-tone='ok'] {
  border: 1px solid var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.note[data-tone='warn'] {
  border: 1px solid var(--tone-warn-line);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.note[data-tone='err'] {
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}

.disclaimer {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}
</style>
