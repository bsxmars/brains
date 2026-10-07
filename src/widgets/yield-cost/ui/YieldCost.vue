<script setup lang="ts">
/**
 * Калькулятор «сколько стоит сама уступка».
 *
 * Два решения — как часто уступать и чем — перемножаются, и именно произведение объясняет
 * случаи вроде «работы на две секунды, а цикл идёт сорок». По отдельности ни одно из решений
 * катастрофы не даёт: уступка на каждом элементе дешёвым инструментом терпима, `setTimeout`
 * по бюджету тоже. Убивает сочетание.
 *
 * ⚠️ Числа модельные, и демо говорит об этом вслух в подвале: цена элемента и цена уступки
 * заданы константами, а не замерены. Единственная величина здесь, взятая не с потолка, —
 * 4 мс у вложенного `setTimeout`: это кламп из HTML Standard (nesting level > 5 и timeout < 4
 * → timeout = 4), а цепочка таймеров в чанкере доходит до шестого уровня на шестой уступке.
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import { SegmentedControl } from '@/shared/ui';
import type { YieldSize, YieldStrategy, YieldTool } from '../model/types';

const props = defineProps<{
  sizes: YieldSize[];
  strategies: YieldStrategy[];
  tools: YieldTool[];
  /** Модельная цена обработки одного элемента, мс. */
  perItem: number;
  /** Бюджет между уступками, мс. Он же порог long task. */
  budget: number;
}>();

// Стартовое состояние — то же, что в оригинале: десять тысяч элементов, уступка на каждом,
// setTimeout. Демо открывается на самом частом сочетании ошибок, а не на правильном ответе.
const sizeKey = ref(props.sizes[Math.min(1, props.sizes.length - 1)].key);
const strategyKey = ref(props.strategies[0].key);
const toolKey = ref(props.tools[0].key);

const sizeOptions = computed(() => props.sizes.map((s) => ({ value: s.key, label: s.label })));
const strategyOptions = computed(() => props.strategies.map((s) => ({ value: s.key, label: s.label })));
const toolOptions = computed(() => props.tools.map((t) => ({ value: t.key, label: t.label })));

const size = computed(() => props.sizes.find((s) => s.key === sizeKey.value) ?? props.sizes[0]);
const strategy = computed(
  () => props.strategies.find((s) => s.key === strategyKey.value) ?? props.strategies[0],
);
const tool = computed(() => props.tools.find((t) => t.key === toolKey.value) ?? props.tools[0]);

const work = computed(() => size.value.items * props.perItem);
/** Сколько уступок было бы по бюджету времени — с ним и сравнивается «на каждом элементе». */
const byBudget = computed(() => Math.max(1, Math.floor(work.value / props.budget)));
const yields = computed(() => {
  if (tool.value.key === 'no') return 0;
  return strategy.value.key === 'each' ? size.value.items : byBudget.value;
});
const over = computed(() => yields.value * tool.value.cost);
const total = computed(() => work.value + over.value);
/** Минимум 1.5% — иначе при накладных в двадцать раз больше работы её полоска исчезает. */
const workPct = computed(() => Math.max(1.5, (work.value / total.value) * 100));

function fmt(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)} с`;
  return `${Math.round(ms)} мс`;
}

/** Разряды пробелом. Своя функция, а не `toLocaleString`: формат не должен зависеть от ICU. */
function groups(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

const overTone = computed(() => {
  if (over.value > work.value) return 'err';
  return over.value > work.value / 4 ? 'warn' : 'ok';
});
const totalTone = computed(() => (total.value > work.value * 2 ? 'err' : 'ink'));

const verdict = computed<{ text: string; tone: 'ok' | 'warn' | 'err' }>(() => {
  if (tool.value.key === 'no') {
    return {
      tone: 'err',
      text:
        `Одна задача на ${fmt(work.value)}. Страница заморожена целиком: ни ввода, ни кадров, ` +
        'ни анимации. Это и есть тот самый long task, только очень длинный.',
    };
  }
  if (strategy.value.key === 'each' && tool.value.key === 'st') {
    return {
      tone: 'err',
      text:
        'Классическая катастрофа: уступка стоит дороже самой работы. Каждый шаг — таймер, ' +
        'поставленный из коллбэка предыдущего, то есть вложенный, а вложенность растёт: ' +
        'с шестой уступки срабатывает кламп и задержка становится 4 мс. ' +
        `${fmt(work.value)} полезной работы превращаются в ${fmt(total.value)}.`,
    };
  }
  if (strategy.value.key === 'each') {
    return {
      tone: 'warn',
      text:
        `Уступка на каждом элементе — всё ещё лишнее: ${groups(yields.value)} уступок вместо ` +
        `${groups(byBudget.value)}. Даже дешёвый инструмент не окупает такой частоты. ` +
        'Уступать надо по бюджету времени.',
    };
  }
  if (tool.value.key === 'st') {
    return {
      tone: 'warn',
      text:
        'Бюджет выставлен правильно, накладные приемлемы. Но setTimeout кладёт продолжение ' +
        'в ХВОСТ очереди: чужая аналитика и чужие таймеры пролезут раньше вашего следующего куска.',
    };
  }
  return {
    tone: 'ok',
    text:
      `Так и надо: ${groups(yields.value)} уступок по бюджету ${props.budget} мс, накладные ` +
      `${fmt(over.value)} на ${fmt(work.value)} работы. Long task не создаётся, а ${tool.value.note}.`,
  };
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="controls">
        <div class="control">
          <span class="t-label">элементов</span>
          <SegmentedControl v-model="sizeKey" class="l-pills" label="Сколько элементов" :options="sizeOptions" />
        </div>
        <div class="control">
          <span class="t-label">уступать</span>
          <SegmentedControl
            v-model="strategyKey"
            class="l-pills"
            label="Как часто уступать"
            :options="strategyOptions"
          />
        </div>
        <div class="control">
          <span class="t-label">чем</span>
          <SegmentedControl v-model="toolKey" class="l-pills" label="Чем уступать" :options="toolOptions" />
        </div>
      </div>
    </template>

    <div class="body">
      <div class="metrics">
        <div class="metric">
          <span class="t-label">полезная работа</span>
          <span class="metric__value" data-tone="ok">{{ fmt(work) }}</span>
        </div>
        <div class="metric">
          <span class="t-label">уступок</span>
          <span class="metric__value" data-tone="chip">{{ groups(yields) }}</span>
        </div>
        <div class="metric">
          <span class="t-label">накладные</span>
          <span class="metric__value" :data-tone="overTone">{{ fmt(over) }}</span>
        </div>
        <div class="metric">
          <span class="t-label">итого</span>
          <span class="metric__value metric__value--strong" :data-tone="totalTone">{{ fmt(total) }}</span>
        </div>
      </div>

      <div class="chart">
        <div class="bar">
          <div class="bar__work" :style="`width:${workPct}%`"></div>
          <div class="bar__over" :data-tone="overTone" :style="`width:${100 - workPct}%`"></div>
        </div>
        <div class="legend">
          <span class="legend__item" data-tone="ok"><i data-tone="ok"></i>работа</span>
          <span class="legend__item" data-tone="warn"><i data-tone="warn"></i>ожидание из-за уступок</span>
        </div>
      </div>

      <div class="verdict" :data-tone="verdict.tone">{{ verdict.text }}</div>
    </div>

    <template #footer>
      <div class="disclaimer">
        Числа модельные: {{ perItem }} мс на элемент и фиксированная цена уступки у каждого
        инструмента. Это порядки величин для иллюстрации, а не замер — кроме 4 мс у вложенного
        setTimeout, они из спецификации. Свою работу меряйте на своём железе.
      </div>
    </template>
  </DemoFrame>
</template>

<style scoped>
.controls {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.control {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.control .t-label {
  min-width: 86px;
}

.body {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 24px 20px;
}

.metrics {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(150px, 100%), 1fr));
  gap: 12px;
}
.metric {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.metric__value {
  font-family: var(--mono);
  font-size: var(--fs-8);
  transition: color 0.2s;
}
.metric__value--strong {
  font-weight: 600;
}
.metric__value[data-tone='ok'] {
  color: var(--tone-ok-strong);
}
.metric__value[data-tone='warn'] {
  color: var(--tone-warn-strong-2);
}
.metric__value[data-tone='err'] {
  color: var(--tone-err-strong);
}
.metric__value[data-tone='ink'] {
  color: var(--ink);
}
.metric__value[data-tone='chip'] {
  color: var(--chip-text);
}

.chart {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.bar {
  display: flex;
  height: 26px;
  border: 1px solid var(--divider);
  border-radius: var(--r1);
  overflow: hidden;
}
.bar__work {
  background: var(--tone-ok-strong);
  transition: width 0.25s;
}
.bar__over {
  transition: width 0.25s;
}
.bar__over[data-tone='err'] {
  background: var(--tone-err-strong);
}
.bar__over[data-tone='warn'],
.bar__over[data-tone='ok'] {
  background: var(--bar-amber);
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

.verdict {
  padding: 14px 16px;
  border-radius: var(--r2);
  font-size: var(--fs-6);
  line-height: 1.6;
  transition: all 0.2s;
}
.verdict[data-tone='ok'] {
  border: 1px solid var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.verdict[data-tone='warn'] {
  border: 1px solid var(--tone-warn-line);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.verdict[data-tone='err'] {
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
