<script setup lang="ts">
/**
 * Микрозонд: четыре опыта, которыми тема «Цикл событий» проверяет собственные таблицы.
 *
 * В уроке это место было двумя наборами строк, набранными руками: «кто микрозадача, а кто нет»
 * и «`queueMicrotask` против `.then`». Здесь заранее написанных ответов нет — каждый сценарий
 * выполняется в браузере читателя, и на экран едет то, что получилось.
 *
 * Считает не компонент, а `model/run.ts`: тот же модуль импортирует юнит-тест, и страница
 * с тестом разойтись не могут. Здесь только показ.
 *
 * ⚠️ **Рядом с каждым измерением стоит то, что утверждает урок.** Это единственное, что
 * компонент не измерил, и оно подписано словами «тема говорит»: расхождение обязано быть
 * видно на экране, а не остаться между строк.
 *
 * Прогон идёт в `onMounted`, на смену сценария и по кнопке. Результат предыдущего прогона
 * стирается до начала нового: показывать старый ответ на новый вопрос нельзя. Ответ
 * опоздавшего прогона на экран не попадает — его отсекает счётчик `token`.
 */
import { computed, onMounted, ref, watch } from 'vue';
import CodeListing from '@/shared/ui/CodeListing.vue';
import ConsoleView from '@/shared/ui/ConsoleView.vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button, SegmentedControl } from '@/shared/ui';
import {
  CHANNEL_LABEL,
  probeErrorChannels,
  probeQueueOrder,
  probeStarvation,
  probeWho,
  STARVATION_STEPS,
  VERDICT_LABEL,
} from '../model/run';
import { SCENARIOS } from '../model/scenarios';
import type { ErrorRun, MechanismRow, OrderRun, ProbeKey, StarvationRun, WhoRun } from '../model/types';

const props = withDefaults(defineProps<{ note?: string; steps?: number }>(), {
  note: 'Формулировка, которую стоит выучить дословно: микрозадача откладывает код, но не отпускает поток; задача отпускает поток.',
  steps: STARVATION_STEPS,
});

const OPTIONS = SCENARIOS.map((item) => ({ value: item.key, label: item.label }));

const key = ref<ProbeKey>('who');
const scenario = computed(() => SCENARIOS.find((item) => item.key === key.value) ?? SCENARIOS[0]);

const busy = ref(false);
const whoRun = ref<WhoRun | null>(null);
const orderRun = ref<OrderRun | null>(null);
const errorRun = ref<ErrorRun | null>(null);
const starveRun = ref<StarvationRun | null>(null);

/** Номер прогона: ответ, опоздавший к смене сценария, на экран не попадает. */
let token = 0;

async function refresh() {
  const mine = ++token;
  busy.value = true;

  whoRun.value = null;
  orderRun.value = null;
  errorRun.value = null;
  starveRun.value = null;

  try {
    switch (key.value) {
      case 'who': {
        const result = await probeWho();
        if (mine === token) whoRun.value = result;
        break;
      }
      case 'order': {
        const result = await probeQueueOrder();
        if (mine === token) orderRun.value = result;
        break;
      }
      case 'error': {
        const result = await probeErrorChannels();
        if (mine === token) errorRun.value = result;
        break;
      }
      case 'starvation': {
        const result = await probeStarvation(props.steps);
        if (mine === token) starveRun.value = result;
        break;
      }
    }
  } finally {
    if (mine === token) busy.value = false;
  }
}

onMounted(refresh);
watch(key, refresh);

const whoRows = computed(() => whoRun.value?.rows ?? []);
const errorRows = computed(() => errorRun.value?.rows ?? []);

/** Механизм, оказавшийся не микрозадачей, — янтарный: ради этой фишки строка и собрана. */
const chipsOf = (row: MechanismRow) =>
  row.order.map((text) => ({
    text,
    tone: text === row.label && row.verdict !== 'micro' ? ('warn' as const) : ('ok' as const),
  }));

const orderChips = computed(() =>
  (orderRun.value?.executed ?? []).map((text) => ({
    text,
    tone: text === 'задача' ? ('warn' as const) : ('ok' as const),
  })),
);

/** Сверять нечего там, где механизма нет или он не сработал: «расходится» было бы наветом. */
const matchLabel = (row: MechanismRow) =>
  !row.comparable ? 'сверить не с чем' : row.agrees ? 'сходится' : 'расходится';

const ms = (value: number) => `${value.toFixed(1)} мс`;
const yesNo = (value: boolean) => (value ? 'да' : 'нет');
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="bar">
        <span class="bar__label">сценарий:</span>
        <SegmentedControl v-model="key" class="l-pills" label="Сценарий проверки микрозадач" :options="OPTIONS" />
        <Button variant="primary" :disabled="busy" @click="refresh">прогнать заново</Button>
      </div>
    </template>

    <div class="split">
      <div class="pane">
        <Md class="title" :text="scenario.title" />
        <Md class="lead" :text="scenario.lead" />
        <CodeListing :lines="scenario.code" label="что исполняется" />
      </div>

      <div class="pane pane--right">
        <p v-if="busy" class="wait">прогон идёт в вашем браузере…</p>

        <template v-else>
          <!-- 1. Кто микрозадача -->
          <div v-if="key === 'who'" class="mp-rows">
            <div v-for="row in whoRows" :key="row.key" class="mp-row" :data-tone="row.tone">
              <div class="mp-row__head">
                <Md class="mp-row__title" :text="row.title" />
                <span class="chip">{{ VERDICT_LABEL[row.verdict] }}</span>
              </div>
              <ConsoleView v-if="row.order.length" label="" :chips="chipsOf(row)" :min-height="30" />
              <Md class="mp-row__note" :text="row.note" />
              <Md class="mp-row__why" :text="row.why" />
              <div class="claim">
                <span class="claim__said">тема говорит: {{ VERDICT_LABEL[row.claimed] }}</span>
                <span class="claim__match">{{ matchLabel(row) }}</span>
              </div>
            </div>

            <Md
              v-if="whoRun && !whoRun.rendered"
              class="mp-row__note"
              text="Отрисованного узла в этой среде не нашлось, поэтому `ResizeObserver` и `IntersectionObserver` честно помечены как непроверенные: без CSS-бокса наблюдатель размера пропускает элемент молча, и «не сработал» означало бы не то, чем кажется."
            />
          </div>

          <!-- 2. Порядок -->
          <template v-else-if="key === 'order' && orderRun">
            <ConsoleView :chips="orderChips" label="порядок выполнения" :min-height="44" />

            <div class="values">
              <div class="value">
                <span class="t-label">поставлено</span>
                <span class="value__box" data-code>{{ orderRun.scheduled.join(' → ') }}</span>
              </div>
              <div class="value">
                <span class="t-label">выполнено</span>
                <span class="value__box" data-code>{{ orderRun.executed.join(' → ') }}</span>
              </div>
              <div class="value">
                <span class="t-label">порядок постановки сохранён</span>
                <span class="value__box">{{ yesNo(orderRun.fifo) }}</span>
              </div>
              <div class="value">
                <span class="t-label">задача ушла последней</span>
                <span class="value__box">{{ yesNo(orderRun.taskLast) }}</span>
              </div>
              <div class="value">
                <span class="t-label">вложенная микрозадача в том же сливе</span>
                <span class="value__box">{{ yesNo(orderRun.nestedInSameDrain) }}</span>
              </div>
            </div>

            <div class="verdict" :data-tone="orderRun.tone"><Md :text="orderRun.note" /></div>
          </template>

          <!-- 3. Канал ошибки -->
          <template v-else-if="key === 'error'">
            <div v-if="errorRun && !errorRun.supported" class="verdict" data-tone="warn">
              <Md :text="errorRun.note" />
            </div>

            <div class="mp-rows">
              <div v-for="row in errorRows" :key="row.key" class="mp-row" :data-tone="row.tone">
                <div class="mp-row__head">
                  <Md class="mp-row__title" :text="row.label" />
                  <span class="chip">{{ CHANNEL_LABEL[row.channel] }}</span>
                </div>
                <CodeListing :lines="row.code" />
                <div class="values">
                  <div class="value">
                    <span class="t-label">имя долетевшей ошибки</span>
                    <span class="value__box" data-code>{{ row.errorName || '—' }}</span>
                  </div>
                  <div class="value">
                    <span class="t-label">текст — для показа, не для проверки</span>
                    <span class="value__box value__box--small" data-code>{{ row.errorText || '—' }}</span>
                  </div>
                </div>
                <Md class="mp-row__note" :text="row.note" />
                <div class="claim">
                  <span class="claim__said">тема говорит: {{ CHANNEL_LABEL[row.claimed] }}</span>
                  <span class="claim__match">{{ row.agrees ? 'сходится' : 'расходится' }}</span>
                </div>
              </div>
            </div>

            <Md v-if="errorRun && errorRun.supported" class="mp-row__note" :text="errorRun.note" />
          </template>

          <!-- 4. Голодание -->
          <template v-else-if="key === 'starvation' && starveRun">
            <div class="values">
              <div class="value">
                <span class="t-label">микрозадач в цепочке</span>
                <span class="value__box">{{ starveRun.steps }}</span>
              </div>
              <div class="value">
                <span class="t-label">поток был занят подряд</span>
                <span class="value__box">{{ ms(starveRun.busyMs) }}</span>
              </div>
              <div class="value">
                <span class="t-label">таймер на 0 мс ждал</span>
                <span class="value__box">{{
                  starveRun.timerDelayMs < 0 ? 'так и не сработал' : ms(starveRun.timerDelayMs)
                }}</span>
              </div>
              <div class="value">
                <span class="t-label">первый кадр</span>
                <span class="value__box">{{
                  starveRun.frameDelayMs === null ? 'кадра не было' : ms(starveRun.frameDelayMs)
                }}</span>
              </div>
            </div>

            <ConsoleView :lines="starveRun.log" label="протокол прогона" :min-height="110" />

            <div class="verdict" :data-tone="starveRun.tone"><Md :text="starveRun.note" /></div>
          </template>
        </template>
      </div>
    </div>

    <template #footer>
      <div class="micro-probe-foot">
        <div class="source">
          <span class="source__tag">что доказывает этот прогон</span>
          <Md class="source__text" :text="scenario.caveat" />
        </div>
        <Md class="micro-probe-foot__rule" :text="props.note" />
      </div>
    </template>
  </DemoFrame>
</template>

<style scoped>
.bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}
.bar__label {
  min-width: 78px;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}

.split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr);
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

.mp-rows {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
/* Строка результата — карточка, а не строка таблицы: у каждой свой порядок вывода. */
.mp-row {
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 13px 15px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--surface);
  min-width: 0;
}
.mp-row[data-tone='ok'] {
  border-color: var(--tone-ok-line);
  background: var(--tone-ok-bg);
}
.mp-row[data-tone='warn'] {
  border-color: var(--tone-warn-line);
  background: var(--tone-warn-bg);
}
.mp-row[data-tone='err'] {
  border-color: var(--tone-err-line);
  background: var(--tone-err-bg);
}
.mp-row[data-tone='dim'] {
  border-color: var(--divider);
  background: var(--sunk-dim);
}

.mp-row__head {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: space-between;
}
.mp-row__title {
  font-size: var(--fs-5);
  font-weight: 600;
  line-height: 1.4;
  color: var(--ink);
}
.chip {
  padding: 3px 9px;
  border-radius: var(--r-full);
  background: var(--surface-3);
  font-family: var(--mono);
  font-size: var(--fs-3);
  letter-spacing: 0.04em;
  color: var(--text-muted);
}
.mp-row[data-tone='ok'] .chip {
  background: var(--tone-ok-chip);
  color: var(--tone-ok-strong);
}
.mp-row[data-tone='warn'] .chip {
  background: var(--tone-warn-chip);
  color: var(--tone-warn-strong);
}
.mp-row[data-tone='err'] .chip {
  background: var(--tone-err-chip);
  color: var(--tone-err-strong);
}

.mp-row__note {
  font-size: var(--fs-4);
  line-height: 1.55;
  color: var(--text-muted);
}
/* Объяснение — не измерение, поэтому тише замера и отделено линией. */
.mp-row__why {
  padding-top: 8px;
  border-top: 1px solid var(--hairline);
  font-size: var(--fs-3);
  line-height: 1.5;
  color: var(--text-faint);
}

/* Единственная строка, которую компонент не измерил: она подписана прямым текстом. */
.claim {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: space-between;
  font-family: var(--mono);
  font-size: var(--fs-3);
  letter-spacing: 0.04em;
  color: var(--text-faint);
}
.claim__match {
  color: var(--text-muted);
}
.mp-row[data-tone='err'] .claim__match {
  color: var(--tone-err-strong);
}
.mp-row[data-tone='ok'] .claim__match {
  color: var(--tone-ok-strong);
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
.value__box--small {
  font-size: var(--fs-2);
  color: var(--text-muted);
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
.verdict[data-tone='dim'] {
  border: 1px solid var(--divider);
  background: var(--sunk-dim);
  color: var(--text-muted);
}

.micro-probe-foot {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.source {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--surface);
}
.source__tag {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-faint);
}
.source__text {
  font-size: var(--fs-4);
  line-height: 1.55;
  color: var(--text-muted);
}
.micro-probe-foot__rule {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--prose);
}

@media (max-width: 760px) {
  .split {
    grid-template-columns: 1fr;
  }
  .pane {
    border-right: 0;
    border-bottom: 1px solid var(--divider);
  }
}

/* Код внутри мелкой подписи: базовое `code { font-size: .86em }` уводило его ниже 11px.
   Пол — ступень `--fs-2`. */
.mp-row__why :deep(code) {
  font-size: max(0.86em, var(--fs-2));
}
</style>
