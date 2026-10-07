<script setup lang="ts">
/**
 * Цена уступки — прибором, а не константой.
 *
 * Тема целиком про измеримые величины, и соседний калькулятор (`widgets/yield-cost`) честно
 * пишет в подвале: «числа модельные, меряйте на своём железе». Померить было нечем — теперь есть.
 * Считает не компонент, а `model/run.ts`: тот же модуль читает юнит-тест, поэтому страница
 * и проверка разойтись не могут. Здесь только показ.
 *
 * ⚠️ **Автостарта нет, и это не забывчивость.** Остров гидратируется по `client:visible`,
 * то есть в момент, когда читатель доскроллил, — а замер занимает главный поток почти
 * на две секунды. Запускать такое самому значит подвесить страницу под курсором. Отсюда же
 * половина требований `prefers-reduced-motion` выполняется по построению: сам собой здесь
 * не запускается ничего.
 *
 * ⚠️ **Перед замером отдаётся кадр.** Без него состояние «идёт замер» не успевает нарисоваться:
 * поток уходит в цикл сразу после клика, и читатель полторы секунды смотрит на кнопку, которая
 * с виду не нажалась.
 */
import { computed, ref } from 'vue';
import ConsoleView from '@/shared/ui/ConsoleView.vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button } from '@/shared/ui';
import {
  fmtCost,
  fmtRate,
  fmtRatio,
  fmtSpan,
  measureYields,
  WARMUP_MS,
  WINDOW_MS,
} from '../model/run';
import type { YieldMeasure, YieldReport } from '../model/types';

const props = withDefaults(
  defineProps<{
    /** Окно замера на один инструмент, мс. Четыре окна подряд — столько читатель и ждёт. */
    windowMs?: number;
    /** Холостой прогон перед замером, мс. Его результат отбрасывается. */
    warmupMs?: number;
    /** Подпись под демо. Разрешена строчная разметка. */
    note?: string;
  }>(),
  {
    windowMs: WINDOW_MS,
    warmupMs: WARMUP_MS,
    note: 'Абсолютные числа здесь про эту машину и эту минуту. Переживает смену железа только последняя колонка — кратность: во сколько раз один способ дороже другого.',
  },
);

/** Текст тревоги про скрытую вкладку. Строкой и через `Md`: в шаблоне разметка не разбирается. */
const HIDDEN_ALARM =
  'Вкладка была скрыта в момент замера. Браузер замедляет таймеры в фоне — до одного срабатывания в секунду, — так что строка `setTimeout` показывает не цену уступки, а это замедление.';

const report = ref<YieldReport | null>(null);
const busy = ref(false);

/** Отдать браузеру кадр, чтобы «идёт замер» успело нарисоваться до того, как поток займётся. */
function paint(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') {
    return new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

async function measure() {
  if (busy.value) return;
  busy.value = true;
  report.value = null;

  try {
    await paint();
    report.value = await measureYields({ windowMs: props.windowMs, warmupMs: props.warmupMs });
  } finally {
    busy.value = false;
  }
}

/** От чего считаются кратности. Подписать базу обязательно: без неё «×1600» ничего не значит. */
const baseLabel = computed(() => {
  const data = report.value;
  return data?.rows.find((row) => row.key === data.base)?.label ?? '';
});

/** Самая дорогая уступка задаёт длину полосы: остальные — доли от неё. */
const worst = computed(() =>
  (report.value?.rows ?? []).reduce((max, row) => (row.available ? Math.max(max, row.perYieldMs) : max), 0),
);

/** Минимум 1.5%: у микрозадачи доля в тысячные, и без пола её полоска исчезает вовсе. */
function barPct(row: YieldMeasure): number {
  if (!row.available || worst.value <= 0) return 0;
  return Math.max(1.5, (row.perYieldMs / worst.value) * 100);
}

/**
 * Условия замера строками — это и есть ответ на «на чём получено число».
 *
 * Итераций и окна тут больше, чем в таблице: там среднее, а здесь сырьё, из которого оно
 * посчитано. Читатель, который не верит средним, может поделить сам.
 */
const log = computed<string[]>(() => {
  const data = report.value;
  if (!data) return [];

  const lines = [
    `окно на инструмент: ${data.conditions.windowMs} мс · прогрев ${data.conditions.warmupMs} мс (отброшен)`,
    `весь прогон занял: ${fmtSpan(data.conditions.totalMs)}`,
    `вкладка: ${data.conditions.hidden ? 'СКРЫТА — таймеры задушены, числам верить нельзя' : 'видима'}`,
    '',
  ];

  for (const row of data.rows) {
    lines.push(
      row.available
        ? `${row.label.padEnd(18)} ${String(row.iterations).padStart(9)} уступок за ${fmtSpan(row.spanMs)}`
        : `${row.label.padEnd(18)} — не меряли`,
    );
  }

  return lines;
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="ym-bar">
        <Button :disabled="busy" @click="measure()">
          {{ report ? 'замерить заново' : 'замерить' }}
        </Button>
        <span v-if="busy" class="ym-bar__state">
          замер идёт — поток занят примерно на {{ Math.round((props.windowMs + props.warmupMs) * 4) }} мс…
        </span>
        <span v-else class="ym-bar__hint">
          четыре окна по {{ props.windowMs }} мс подряд, в вашем браузере
        </span>
      </div>
    </template>

    <div class="ym-body">
      <p v-if="!report && !busy" class="ym-idle">
        Замер не запускается сам: он займёт главный поток примерно на полторы секунды,
        и всё это время страница не будет отвечать. Нажмите кнопку, когда будете готовы.
      </p>

      <p v-else-if="busy" class="ym-idle">поток занят замером…</p>

      <template v-else-if="report">
        <div v-if="report.conditions.hidden" class="ym-alarm"><Md :text="HIDDEN_ALARM" /></div>

        <div class="ym-scroll">
          <table class="ym-grid">
            <thead>
              <tr>
                <th>чем уступаем</th>
                <th>уступок в секунду</th>
                <th>цена одной</th>
                <th>кратность</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in report.rows" :key="row.key" :data-tone="row.tone">
                <td>
                  <span class="ym-name" data-code>{{ row.label }}</span>
                  <span v-if="!row.yields" class="ym-flag">не уступка</span>
                </td>
                <template v-if="row.available">
                  <td class="ym-num ym-num--lead">{{ fmtRate(row.perSecond) }}</td>
                  <td class="ym-num">{{ fmtCost(row.perYieldMs) }}</td>
                  <td class="ym-num ym-num--ratio">×{{ fmtRatio(row.ratio) }}</td>
                </template>
                <td v-else class="ym-absent" colspan="3">{{ row.unavailable }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p class="ym-hint">
          Кратность отсчитывается от самого дешёвого способа, который поток действительно
          отпускает<template v-if="baseLabel"> — здесь это <span class="ym-name" data-code>{{ baseLabel }}</span></template>.
          У микрозадачи она поэтому меньше единицы: дешевле любой уступки она ровно потому,
          что уступкой не является.
        </p>

        <div class="ym-chart">
          <div class="ym-chart__title t-label">цена одной уступки, доля от самой дорогой</div>
          <div v-for="row in report.rows" :key="row.key" class="ym-track">
            <span class="ym-track__name">{{ row.label }}</span>
            <span class="ym-track__rail">
              <span class="ym-track__fill" :data-tone="row.tone" :style="`width:${barPct(row)}%`"></span>
            </span>
            <span class="ym-track__value">{{ row.available ? fmtCost(row.perYieldMs) : '—' }}</span>
          </div>
        </div>

        <ConsoleView label="на чём получены числа" :lines="log" :min-height="128" />

        <div class="ym-verdict" :data-tone="report.tone"><Md :text="report.verdict" /></div>

        <div class="ym-notes">
          <div v-for="row in report.rows" :key="row.key" class="ym-note" :data-tone="row.tone">
            <span class="ym-note__name" data-code>{{ row.label }}</span>
            <Md class="ym-note__text" :text="row.note" />
          </div>
        </div>
      </template>
    </div>

    <template #footer>
      <div class="ym-foot">
        <div class="ym-source">
          <span class="ym-source__tag">снято на вашей машине · величина зависит от браузера и нагрузки</span>
          <Md
            class="ym-source__text"
            text="Обвязка замера — один промис и одно чтение часов на оборот — входит в каждую строку **одинаково**, поэтому строки сравнимы между собой. Строка `queueMicrotask` этой обвязкой почти и исчерпывается: она показывает пол измерения, а не способ уступить."
          />
        </div>

        <Md
          class="ym-foot__rule"
          text="Прогрев не только разогревает код: он ещё и насыщает вложенность таймеров. Без него в окно попали бы первые пять «бесплатных» уровней, и `setTimeout` вышел бы дешевле, чем платит настоящий чанкер."
        />
        <Md class="ym-foot__rule" :text="props.note" />
      </div>
    </template>
  </DemoFrame>
</template>

<style scoped>
.ym-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}
.ym-bar__state {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--tone-warn-strong-2);
}
.ym-bar__hint {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-faint);
}

.ym-body {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 22px 20px;
}

.ym-idle {
  margin: 0;
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}

.ym-alarm {
  padding: 12px 14px;
  border: 1px solid var(--tone-err-line);
  border-radius: var(--r2);
  background: var(--tone-err-bg);
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--tone-err-text);
}

/* Таблица прокручивается сама и не имеет права утащить вбок страницу. */
.ym-scroll {
  min-width: 0;
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: var(--r2);
}
.ym-grid {
  width: 100%;
  min-width: 460px;
  border-collapse: collapse;
  background: var(--surface);
}
.ym-grid th {
  padding: 8px 12px;
  background: var(--ink);
  color: var(--on-ink);
  font-family: var(--mono);
  font-size: var(--fs-2);
  font-weight: 400;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  text-align: start;
}
.ym-grid td {
  padding: 9px 12px;
  border-bottom: 1px solid var(--rule);
  color: var(--ink);
  vertical-align: baseline;
}
.ym-grid tbody tr:last-child td {
  border-bottom: 0;
}
.ym-grid tbody tr[data-tone='err'] {
  background: var(--tone-err-bg);
}
.ym-grid tbody tr[data-tone='warn'] {
  background: var(--tone-warn-bg);
}
.ym-grid tbody tr[data-tone='info'] {
  background: var(--surface-2);
}

.ym-name {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
}
.ym-flag {
  display: inline-block;
  margin-inline-start: 8px;
  padding: 2px 7px;
  border-radius: var(--r1);
  background: var(--tone-info-chip);
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--tone-info-strong);
}

.ym-num {
  font-family: var(--mono);
  font-size: var(--fs-3);
  text-align: end;
  white-space: nowrap;
}
.ym-num--lead {
  font-size: var(--fs-5);
  font-weight: 600;
}
.ym-num--ratio {
  color: var(--text-muted);
}
tr[data-tone='err'] .ym-num--lead,
tr[data-tone='err'] .ym-num--ratio {
  color: var(--tone-err-strong);
}
tr[data-tone='warn'] .ym-num--lead,
tr[data-tone='warn'] .ym-num--ratio {
  color: var(--tone-warn-strong-2);
}
tr[data-tone='ok'] .ym-num--lead {
  color: var(--tone-ok-strong);
}

.ym-absent {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--dim);
}

.ym-hint {
  margin: 0;
  font-size: var(--fs-4);
  line-height: 1.5;
  color: var(--text-muted);
}

.ym-chart {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ym-chart__title {
  margin-bottom: 2px;
}
.ym-track {
  display: grid;
  grid-template-columns: minmax(96px, 22%) minmax(0, 1fr) minmax(64px, auto);
  align-items: center;
  gap: 10px;
}
.ym-track__name {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
  overflow-wrap: anywhere;
}
.ym-track__rail {
  display: block;
  height: 14px;
  border-radius: var(--r1);
  background: var(--sunk-dim);
  overflow: hidden;
}
.ym-track__fill {
  display: block;
  height: 100%;
  background: var(--bar-neutral);
  transition: width 0.25s;
}
.ym-track__fill[data-tone='err'] {
  background: var(--bar-red);
}
.ym-track__fill[data-tone='warn'] {
  background: var(--bar-amber);
}
.ym-track__fill[data-tone='ok'] {
  background: var(--bar-green);
}
.ym-track__fill[data-tone='info'] {
  background: var(--bar-violet);
}
.ym-track__value {
  font-family: var(--mono);
  font-size: var(--fs-2);
  text-align: end;
  white-space: nowrap;
  color: var(--text-faint);
}

.ym-verdict {
  padding: 13px 15px;
  border-radius: var(--r2);
  font-size: var(--fs-5);
  line-height: 1.55;
}
.ym-verdict[data-tone='ok'] {
  border: 1px solid var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.ym-verdict[data-tone='info'] {
  border: 1px solid var(--tone-info-line);
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
}
.ym-verdict[data-tone='warn'] {
  border: 1px solid var(--tone-warn-line);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.ym-verdict[data-tone='err'] {
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}

.ym-notes {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr));
  gap: 12px;
}
.ym-note {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 11px 13px;
  border: 1px solid var(--divider);
  border-radius: var(--r2);
  background: var(--surface-2);
}
.ym-note[data-tone='err'] {
  border-color: var(--tone-err-line-muted);
}
.ym-note[data-tone='info'] {
  border-color: var(--tone-info-line);
}
.ym-note__name {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--ink);
}
.ym-note__text {
  font-size: var(--fs-4);
  line-height: 1.55;
  color: var(--text-muted);
}

.ym-foot {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.ym-source {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  border-radius: var(--r2);
  border: 1px solid var(--tone-info-line);
  background: var(--tone-info-bg);
}
.ym-source__tag {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--tone-info-strong);
}
.ym-source__text {
  font-size: var(--fs-4);
  line-height: 1.55;
  color: var(--tone-info-text);
}

.ym-foot__rule {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-faint);
}

@media (max-width: 640px) {
  .ym-track {
    grid-template-columns: 1fr;
    gap: 4px;
  }
  .ym-track__value {
    text-align: start;
  }
}
</style>
