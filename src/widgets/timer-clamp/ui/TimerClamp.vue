<script setup lang="ts">
/**
 * Клампинг вложенных таймеров — прибором, а не иллюстрацией.
 *
 * До этого на месте демо стояла статичная лесенка: девять плашек, миллисекунды в которых
 * выводились формулой `level > 5 ? '4 мс' : '0 мс'`. Формула повторяла алгоритм HTML Standard
 * правильно — и ровно этим была опасна: читатель видел картинку, неотличимую от замера,
 * а под ней не было ни одного настоящего таймера. Всё здесь измеримо, поэтому теперь измеряется.
 *
 * Считает не компонент, а `model/run.ts`: тот же модуль читает юнит-тест, и страница с тестом
 * разойтись не могут. Здесь только показ.
 *
 * ⚠️ **Числа машинозависимы, и демо это признаёт вслух.** Нормативен факт — задержка перестаёт
 * быть нулевой, когда вложенность больше пяти; величина зависит от браузера, нагрузки и цены
 * деления часов. Поэтому у каждого сценария есть подпись о том, что здесь из спецификации,
 * а что снято только что в этой вкладке, а кнопка «замерить заново» существует именно затем,
 * чтобы разброс между прогонами был виден, а не спрятан.
 *
 * Замер идёт в `onMounted` и на каждую смену сценария. Он асинхронный и занимает сотни
 * миллисекунд, поэтому у прогонов есть номер: читатель успевает переключить сценарий раньше,
 * чем предыдущий замер закончится, и чужой результат не имеет права попасть на экран.
 */
import { computed, onMounted, ref, watch } from 'vue';
import CodeListing from '@/shared/ui/CodeListing.vue';
import ConsoleView from '@/shared/ui/ConsoleView.vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button, SegmentedControl } from '@/shared/ui';
import { CLAMP_AFTER_LEVEL, FIRST_CLAMPED_LEVEL, runScenario, SCENARIOS } from '../model/run';
import type { TimerKey, TimerRun } from '../model/types';

const props = withDefaults(
  defineProps<{
    /** Длина цепочки вложенных таймеров. */
    depth?: number;
    /** Заказанная задержка в сценарии с занятым потоком, мс. */
    requested?: number;
    /** Сколько миллисекунд поток будет занят синхронной работой. */
    busyMs?: number;
    /** Период `setInterval`, мс. */
    period?: number;
    /** Длина окна наблюдения за интервалом, мс. */
    spanMs?: number;
    /** Подпись под демо. Разрешена строчная разметка. */
    note?: string;
  }>(),
  {
    depth: 10,
    requested: 50,
    busyMs: 120,
    period: 10,
    spanMs: 300,
    note: 'Второй аргумент таймера — это «не раньше чем», а не «ровно через». Всё остальное в этом демо — следствия одной этой строчки спецификации.',
  },
);

const OPTIONS = SCENARIOS.map((item) => ({ value: item.key, label: item.label }));

const key = ref<TimerKey>('nesting');
const scenario = computed(() => SCENARIOS.find((item) => item.key === key.value) ?? SCENARIOS[0]);

const run = ref<TimerRun | null>(null);
const busy = ref(false);

/** Номер прогона: результат опоздавшего замера на экран не попадает. */
let seq = 0;

async function refresh() {
  const mine = (seq += 1);
  busy.value = true;
  run.value = null;

  const result = await runScenario(key.value, {
    depth: props.depth,
    requested: props.requested,
    busyMs: props.busyMs,
    period: props.period,
    spanMs: props.spanMs,
  });

  if (mine !== seq) return;
  run.value = result;
  busy.value = false;
}

onMounted(refresh);
watch(key, refresh);

const chips = computed(() =>
  (run.value?.marks ?? []).map((mark) => ({ text: mark.text, tone: mark.late ? ('warn' as const) : ('ok' as const) })),
);

/**
 * Миллисекунды к показу — тем же правилом, что в модели: ниже цены деления часов пишем
 * «< 0.1», а не выдуманный ноль. Функцией, а не выражением в шаблоне: `<` внутри `{{ }}`
 * разбирается парсером разметки и ломается молча.
 */
const fmt = (value: number): string => (value < 0.05 ? '< 0.1' : value.toFixed(1));
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="bar">
        <span class="bar__label">сценарий:</span>
        <SegmentedControl v-model="key" class="l-pills" label="Что меряем у таймеров" :options="OPTIONS" />
        <Button variant="secondary" :disabled="busy" @click="refresh()">замерить заново</Button>
        <span v-if="busy" class="bar__state">замер идёт…</span>
      </div>
    </template>

    <div class="split">
      <div class="pane">
        <Md class="title" :text="scenario.title" />
        <Md class="lead" :text="scenario.lead" />
        <CodeListing :lines="scenario.code" label="что исполняется" />
      </div>

      <div class="pane pane--right">
        <p v-if="!run" class="wait">замер идёт в вашем браузере…</p>

        <template v-else>
          <div v-if="run.levels.length" class="scroll">
            <table class="grid">
              <thead>
                <tr>
                  <th>уровень</th>
                  <th>запрошено</th>
                  <th>получилось</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in run.levels" :key="row.level" :data-clamped="row.clamped ? 'yes' : 'no'">
                  <td class="num">ур. {{ row.level }}</td>
                  <td class="num dim">{{ row.requested }} мс</td>
                  <td class="num strong">{{ fmt(row.actual) }} мс</td>
                </tr>
              </tbody>
            </table>
          </div>

          <p v-if="run.levels.length" class="hint">
            Граница проходит между уровнями {{ FIRST_CLAMPED_LEVEL - 1 }} и {{ FIRST_CLAMPED_LEVEL }}: клампится не тот
            колбэк, у которого вложенность больше {{ CLAMP_AFTER_LEVEL }}, а тот таймер, который он ставит.
          </p>

          <ConsoleView
            v-if="chips.length"
            label="промежутки между срабатываниями"
            :chips="chips"
            :min-height="56"
            empty-label="ни одного срабатывания"
          />

          <div v-if="run.values.length" class="values">
            <div v-for="item in run.values" :key="item.label" class="value">
              <span class="t-label">{{ item.label }}</span>
              <!-- `data-code` помечает поддерево как код: число со своей единицей — это значение,
                   а не текст страницы. -->
              <span class="value__box" :data-tone="item.tone ?? 'ok'" data-code>{{ item.value }}</span>
            </div>
          </div>

          <div class="verdict" :data-tone="run.tone"><Md :text="run.verdict" /></div>
        </template>
      </div>
    </div>

    <template #footer>
      <div class="timer-clamp-foot">
        <div class="source">
          <span class="source__tag">снято на вашей машине · величина зависит от браузера и нагрузки</span>
          <Md class="source__text" :text="scenario.caveat" />
        </div>

        <div class="notes">
          <Md v-for="(item, i) in scenario.notes" :key="i" class="note" :text="item" />
        </div>

        <Md class="timer-clamp-foot__rule" :text="props.note" />
      </div>
    </template>
  </DemoFrame>
</template>

<style scoped>
.bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.bar__label {
  min-width: 78px;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}
.bar__state {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--tone-warn-strong-2);
}

.split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
}
.pane {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
  border-right: 1px solid var(--divider);
  min-width: 0;
}
.pane--right {
  border-right: 0;
  background: var(--surface-2);
  gap: 16px;
}

.title {
  font-size: var(--fs-6);
  font-weight: 600;
  line-height: 1.35;
  color: var(--ink);
}
.lead {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--prose);
}
.wait {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--dim);
}

/* Таблица прокручивается сама и не имеет права утащить вбок страницу. */
.scroll {
  min-width: 0;
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: var(--r2);
}
.grid {
  width: 100%;
  min-width: 260px;
  border-collapse: collapse;
  background: var(--surface);
}
.grid th {
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
.grid td {
  padding: 7px 12px;
  border-bottom: 1px solid var(--rule);
  color: var(--ink);
}
.grid tbody tr:last-child td {
  border-bottom: 0;
}
/* Уровни, которым спецификация разрешает подорожать, — янтарём: сравнивать их глазом надо
   не с соседней строкой, а с верхней половиной таблицы. */
.grid tbody tr[data-clamped='yes'] {
  background: var(--tone-warn-bg);
}
.num {
  font-family: var(--mono);
  font-size: var(--fs-3);
}
.num.dim {
  color: var(--dim);
}
.num.strong {
  font-weight: 600;
}
.grid tbody tr[data-clamped='yes'] .num.strong {
  color: var(--tone-warn-text);
}
.grid tbody tr[data-clamped='no'] .num.strong {
  color: var(--tone-ok-strong);
}

.hint {
  margin: 0;
  font-size: var(--fs-4);
  line-height: 1.5;
  color: var(--text-muted);
}

.values {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.value {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.value__box {
  padding: 9px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--surface);
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.5;
  color: var(--ink);
  overflow-wrap: anywhere;
}
.value__box[data-tone='warn'] {
  border-color: var(--tone-warn-line);
  color: var(--tone-warn-text);
}
.value__box[data-tone='err'] {
  border-color: var(--tone-err-line);
  color: var(--tone-err-text);
}

.verdict {
  padding: 13px 15px;
  border-radius: var(--r2);
  font-size: var(--fs-5);
  line-height: 1.55;
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

.timer-clamp-foot {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
/* Подпись источника стоит раньше выводов: от неё зависит, чем эти числа являются. */
.source {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  border-radius: var(--r2);
  border: 1px solid var(--tone-info-line);
  background: var(--tone-info-bg);
}
.source__tag {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--tone-info-strong);
}
.source__text {
  font-size: var(--fs-4);
  line-height: 1.55;
  color: var(--tone-info-text);
}

.notes {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr));
  gap: 12px;
}
.note {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}

.timer-clamp-foot__rule {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-faint);
}

@media (max-width: 720px) {
  .split {
    grid-template-columns: 1fr;
  }
  .pane {
    border-right: 0;
    border-bottom: 1px solid var(--divider);
  }
}
</style>
