<script setup lang="ts">
/**
 * Цена резолва: блок-схема `ResolvePromise(v)`, приведённая в исполнение.
 *
 * Рядом со схемой в теме нарисованы цены каждой развилки — `+0`, `+1`. Здесь те же развилки
 * проходятся по-настоящему, и ни одно число на экране не написано руками.
 *
 * Два независимых источника правды на каждую дорожку, как в `widgets/tick-ruler`:
 *   консоль — настоящий прогон в браузере читателя (`features/run-snippet`), по линейке `.then`
 *             видно, между какими ступенями выпал результат;
 *   лента   — модель трёх операций спеки (`shared/lib/promise-sim`), она говорит, из чего эта
 *             цена сложилась и как каждая job называется.
 *
 * Их приговор виджет сверяет и показывает вслух: «сошлись» — это утверждение, а не украшение,
 * и если однажды движок или модель поедут, читатель увидит «расхождение», а не гладкую картинку.
 *
 * ⚠️ Случаи берутся из модели, а не приходят пропом: у дорожки есть поле `program` — функция,
 * а пропы острова Astro сериализует. Подробный разбор той же ошибки — в `widgets/tick-ruler`.
 *
 * Здесь только показ. Всё, что считает, — в `../model/run.ts`, ровно те же функции зовёт
 * юнит-тест.
 */
import { computed, onMounted, ref, watch } from 'vue';
import { ticks } from '@/shared/lib/format';
import { SegmentedControl } from '@/shared/ui';
import CodeListing from '@/shared/ui/CodeListing.vue';
import ConsoleView from '@/shared/ui/ConsoleView.vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { RESOLVE_CASES } from '../model/cases';
import { RULER_STEPS, measureCase, plannedCase } from '../model/run';
import type { CaseReport, LaneReport } from '../model/types';

const props = withDefaults(defineProps<{ initial?: number; steps?: number }>(), {
  initial: 3,
  steps: RULER_STEPS,
});

const cases = RESOLVE_CASES;
const start = Math.min(Math.max(props.initial, 0), cases.length - 1);

const picked = ref(String(start));
const item = computed(() => cases[Number(picked.value)] ?? cases[0]);
const options = computed(() => cases.map((c, i) => ({ value: String(i), label: c.label })));

/**
 * До гидратации показываем заранее посчитанный отчёт: остров сперва рендерится в Node,
 * выполнять там примеры негде, а пустое демо в разметке — худший из вариантов.
 */
const report = ref<CaseReport>(plannedCase(cases[start], props.steps));
const measured = computed(() => report.value.lanes.some((lane) => lane.measure.measured));

async function measure() {
  const next = await measureCase(item.value, props.steps);
  // Пока шёл прогон, читатель мог переключить случай: между запуском и ответом лежит
  // макрозадача. Чужой отчёт показывать нельзя — он рассказывал бы про другой код.
  if (next.key === item.value.key) report.value = next;
}

onMounted(measure);
watch(picked, () => {
  report.value = plannedCase(item.value, props.steps);
  measure();
});

const orderChips = computed(() =>
  (report.value.order?.lines ?? []).map((text) => ({ text, tone: 'ok' as const })),
);

/** Сошлись ли два источника — и если нет, то на чём именно. */
function verdictOf(lane: LaneReport): string {
  if (lane.verdict === 'match') return `движок и модель сошлись: ${ticks(lane.measure.price)}`;
  if (lane.verdict === 'clash') {
    return `расхождение: движок дал ${ticks(lane.measure.price)}, модель — ${ticks(lane.model?.price ?? 0)}`;
  }
  return `модели нет: цену сказал только движок — ${ticks(lane.measure.price)}`;
}

const NO_MODEL =
  'Модели для этой дорожки нет, и это не пропуск: `promise-sim` намеренно не знает отказов — так записано в её докстринге. Тащить их туда ради одного случая значило бы переписать её семантику.';
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="rc-toolbar">
        <span class="rc-toolbar__label">ResolvePromise(v) — чем резолвим:</span>
        <SegmentedControl v-model="picked" class="l-pills" label="Случай резолва" :options="options" />
      </div>
    </template>

    <div class="rc-body">
      <div class="rc-head">
        <Md class="rc-head__title" :text="item.title" />
        <Md class="rc-head__why" :text="item.why" />
      </div>

      <div class="rc-lanes" :data-many="report.lanes.length > 1 ? 'yes' : 'no'">
        <section v-for="lane in report.lanes" :key="lane.lane.key" class="rc-lane" :data-tone="lane.lane.tone">
          <header class="rc-lane__head">
            <Md class="rc-lane__name" as="span" :text="lane.lane.label" />
            <span class="rc-lane__price">{{ ticks(lane.measure.price) }}</span>
          </header>

          <CodeListing :lines="lane.lane.code.split('\n')" />

          <ConsoleView
            :lines="lane.measure.lines"
            :label="lane.measure.measured ? 'движок · выполнено в вашем браузере' : 'движок · заранее посчитанный вывод'"
            :min-height="0"
          />

          <div class="rc-model">
            <div class="t-label">модель спеки · из чего сложилась цена</div>
            <div v-if="lane.model" class="rc-tape">
              <div
                v-for="step in lane.model.steps"
                :key="step.tick"
                class="rc-step"
                :class="{ 'rc-step--hit': step.hit }"
                :data-kind="step.kind"
                :data-tone="lane.lane.tone"
              >
                <span class="rc-step__tick">тик {{ step.tick }}</span>
                <span class="rc-step__job">{{ step.job }}</span>
                <span class="rc-step__note">{{ step.note }}</span>
              </div>
            </div>
            <Md v-else class="rc-none" :text="NO_MODEL" />
          </div>

          <div class="rc-verdict" :data-state="lane.verdict">{{ verdictOf(lane) }}</div>
          <div v-if="lane.drift" class="rc-drift">
            Записано было {{ ticks(lane.lane.n) }} — ваш движок считает иначе. Число на странице
            снято сейчас, а не вспомнено.
          </div>

          <Md class="rc-lane__note" :text="lane.lane.note" />
        </section>
      </div>

      <div class="rc-source">
        {{
          measured
            ? 'Оба столбца получены прямо сейчас: левый — вашим движком, правый — моделью спеки.'
            : 'Выполнить примеры не удалось — показаны заранее посчитанные числа.'
        }}
      </div>
    </div>

    <template v-if="report.order && item.order" #footer>
      <div class="rc-order">
        <div class="t-label">те же цепочки, запущенные вместе — порядок вывода</div>
        <ConsoleView :chips="orderChips" label="" :min-height="44" />
        <Md class="rc-order__note" :text="item.order.note" />
      </div>
    </template>
  </DemoFrame>
</template>

<style scoped>
.rc-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.rc-toolbar__label {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}

.rc-body {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 22px 20px;
}

.rc-head {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.rc-head__title {
  font-family: var(--mono);
  font-size: var(--fs-7);
  font-weight: 600;
  color: var(--ink);
}
.rc-head__why {
  font-size: var(--fs-6);
  line-height: 1.6;
  color: var(--prose);
}

/* Одна дорожка — во всю ширину; три — рядом, иначе разницу в цене не увидеть глазом. */
.rc-lanes {
  display: grid;
  gap: 16px;
}
.rc-lanes[data-many='yes'] {
  grid-template-columns: repeat(auto-fit, minmax(min(320px, 100%), 1fr));
}

.rc-lane {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border-radius: var(--r3);
  background: var(--surface-2);
  min-width: 0;
}

.rc-lane__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.rc-lane__name {
  font-family: var(--mono);
  font-size: var(--fs-4);
  color: var(--ink);
  overflow-wrap: anywhere;
}
/* Цена — крупно и тоном дорожки: дешёвое зелёное, дорогое янтарное. */
.rc-lane__price {
  padding: 3px 10px;
  border-radius: var(--r-full);
  font-family: var(--mono);
  font-size: var(--fs-3);
  font-weight: 600;
  white-space: nowrap;
}
.rc-lane[data-tone='ok'] .rc-lane__price {
  background: var(--tone-ok-chip);
  color: var(--tone-ok-text);
}
.rc-lane[data-tone='info'] .rc-lane__price {
  background: var(--tone-info-chip);
  color: var(--tone-info-text);
}
.rc-lane[data-tone='warn'] .rc-lane__price {
  background: var(--tone-warn-chip);
  color: var(--tone-warn-text);
}

.rc-model {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* Лента очереди: строка на тик, имя job из спеки и что она делает. */
.rc-tape {
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--surface);
  overflow: hidden;
}
.rc-step {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 3px 10px;
  padding: 9px 12px;
  border-bottom: 1px solid var(--rule);
}
.rc-step:last-child {
  border-bottom: 0;
}
.rc-step__tick {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
  white-space: nowrap;
}
.rc-step__job {
  font-family: var(--mono);
  font-size: var(--fs-3);
  overflow-wrap: anywhere;
}
.rc-step[data-kind='reaction'] .rc-step__job {
  color: var(--tone-info-strong);
}
.rc-step[data-kind='thenable-job'] .rc-step__job,
.rc-step[data-kind='then-reaction'] .rc-step__job {
  color: var(--tone-warn-strong);
}
.rc-step[data-kind='plain'] .rc-step__job {
  color: var(--chip-text);
}
.rc-step__note {
  flex: 1 1 200px;
  font-size: var(--fs-4);
  line-height: 1.45;
  color: var(--prose);
}

/* Тик, на котором результат становится виден, — заливка тона и засечка слева. */
.rc-step--hit[data-tone='ok'] {
  background: var(--tone-ok-bg);
  box-shadow: inset 2px 0 0 var(--tone-ok-strong);
}
.rc-step--hit[data-tone='info'] {
  background: var(--tone-info-bg);
  box-shadow: inset 2px 0 0 var(--accent);
}
.rc-step--hit[data-tone='warn'] {
  background: var(--tone-warn-bg);
  box-shadow: inset 2px 0 0 var(--tone-warn-accent);
}

.rc-none {
  padding: 11px 13px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--r2);
  font-size: var(--fs-4);
  line-height: 1.5;
  color: var(--text-muted);
}

.rc-verdict {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
}
.rc-verdict[data-state='match'] {
  color: var(--tone-ok-strong);
}
.rc-verdict[data-state='clash'] {
  color: var(--tone-err-strong);
}
.rc-verdict[data-state='none'] {
  color: var(--dim);
}

.rc-drift {
  padding: 10px 12px;
  border: 1px solid var(--tone-err-line);
  border-radius: var(--r2);
  background: var(--tone-err-bg);
  font-size: var(--fs-4);
  line-height: 1.5;
  color: var(--tone-err-text);
}

.rc-lane__note {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}

.rc-source {
  font-size: var(--fs-4);
  line-height: 1.5;
  color: var(--dim);
}

.rc-order {
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.rc-order__note {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--prose);
}
</style>
