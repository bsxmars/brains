<script setup lang="ts">
/**
 * Два потока и одна работа — замером в этой вкладке, а не рассказом о ней.
 *
 * Тема объясняет, из чего состоит браузер, и почти всё в этом объяснении со страницы
 * не наблюдаемо. Наблюдаемо ровно одно, зато главное: **что происходит со страницей, пока
 * кто-то считает.** Одна и та же функция (`model/work.ts`, в воркер уезжает буквально она же
 * через `toString()`) крутится сперва в выделенном воркере, потом на главном потоке, а прибор
 * всё это время считает кадры. В первом случае кадры идут, во втором их нет — и это не число
 * из чужого замера, а пауза, которую видно глазом прямо здесь.
 *
 * Почему кадры, а не миллисекунды. Микротайминг здесь мерить нечем: без изоляции по источнику
 * `performance.now()` загрублён до сотен микросекунд — и соседняя колонка это показывает
 * не словами, а ответом платформы. Пауза между кадрами живёт на шкале в сотни миллисекунд,
 * где загрубление роли не играет.
 *
 * ⚠️ **Чего здесь нет и быть не может.** Число процессов браузера, память рендерера,
 * запасной процесс наготове, границы изолятов, содержимое чужой вкладки — из JS не видно
 * ни одним способом. Это граница безопасности, а не недоделка прибора, и подменять её
 * «примерными» числами нельзя: демо обязано показывать то, что спросило.
 *
 * ⚠️ Автостарта нет намеренно. Прогон на главном потоке **заедает страницу**, и делать это
 * без спроса в момент, когда читатель до демо долистал, выглядело бы поломкой сайта.
 */
import { computed, onBeforeUnmount, ref, useTemplateRef } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button, SegmentedControl } from '@/shared/ui';
import { probeEnvironment, probeFrameIsolation } from '../model/env';
import { DEFAULT_WORK_MS, measureMain, measureWorker, startBurnWorker, type BurnWorker } from '../model/run';
import type { EnvRow, ThreadMode, ThreadRun } from '../model/types';

const props = withDefaults(
  defineProps<{
    /** Сколько миллисекунд считать в каждом прогоне. */
    workMs?: number;
    /** Подпись под демо. Разрешена строчная разметка. */
    note?: string;
  }>(),
  {
    workMs: DEFAULT_WORK_MS,
    note: 'Со страницы видно ровно это. **Сколько у браузера процессов, сколько памяти у рендерера, держит ли он запасной процесс наготове, где проходят границы изолятов** — из JS не наблюдаемо ни одним способом, и это граница безопасности, а не недоделка демо. Наблюдаемо следствие: отдаёт ли **эта** вкладка кадры, пока идёт работа, и что она отвечает на прямые вопросы о себе.',
  },
);

const LOADS = [
  { value: '400', label: '400 мс' },
  { value: '700', label: '700 мс' },
  { value: '1200', label: '1200 мс' },
];

const load = ref(String(props.workMs));
const workMs = computed(() => Number(load.value) || props.workMs);

const runs = ref<Partial<Record<ThreadMode, ThreadRun>>>({});
const env = ref<EnvRow[]>([]);
const busy = ref(false);
const phase = ref('');
const failure = ref('');

/** Кадры, пришедшие с начала текущего прогона. Двигают полоску — ту самую, что встанет. */
const pulse = ref(0);

const frameHost = useTemplateRef<HTMLDivElement>('frameHost');

/**
 * Воркер один на всё демо и переживает прогоны: создание агента стоит единиц-десятков
 * миллисекунд, и поднимать его на каждый замер значило бы мерить старт, а не работу.
 */
let worker: BurnWorker | null = null;
let workerTried = false;

async function ensureWorker(): Promise<BurnWorker | null> {
  if (!workerTried) {
    workerTried = true;
    worker = await startBurnWorker();
  }
  return worker;
}

onBeforeUnmount(() => {
  worker?.dispose();
  worker = null;
});

const onFrame = (frames: number) => {
  pulse.value = frames;
};

async function run() {
  if (busy.value) return;
  busy.value = true;
  failure.value = '';
  runs.value = {};
  pulse.value = 0;

  try {
    env.value = probeEnvironment();

    phase.value = 'поднимаю воркер';
    const agent = await ensureWorker();

    phase.value = `считаю ${workMs.value} мс в воркере`;
    const inWorker = await measureWorker(agent, workMs.value, onFrame);
    runs.value = { worker: inWorker };

    phase.value = `считаю те же ${workMs.value} мс на главном потоке — сейчас страница встанет`;
    // Кадр перед прогоном: надпись выше обязана доехать до экрана раньше, чем поток встанет.
    await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

    const onMain = await measureMain(workMs.value, onFrame);
    runs.value = { worker: inWorker, main: onMain };

    phase.value = 'спрашиваю про изоляцию кадра';
    env.value = [...env.value, await probeFrameIsolation(frameHost.value)];
  } catch (error) {
    failure.value = error instanceof Error ? error.message : String(error);
  } finally {
    phase.value = '';
    busy.value = false;
  }
}

interface Card {
  mode: ThreadMode;
  title: string;
  what: string;
  run: ThreadRun | undefined;
}

const cards = computed<Card[]>(() => [
  {
    mode: 'worker',
    title: 'в воркере',
    what: 'работа уехала в отдельный поток, главный всё это время ждал сообщения',
    run: runs.value.worker,
  },
  {
    mode: 'main',
    title: 'на главном потоке',
    what: 'та же функция в том же потоке, который рисует кадры и обрабатывает клики',
    run: runs.value.main,
  },
]);

const verdict = computed(() => {
  const inWorker = runs.value.worker;
  const onMain = runs.value.main;
  if (!inWorker?.ok || !onMain?.ok || inWorker.longestGapMs <= 0) return '';

  const times = onMain.longestGapMs / inWorker.longestGapMs;
  return `Работа одинаковая, поток разный: самая длинная пауза между кадрами выросла в **${times.toFixed(1)}** раза — с **${inWorker.longestGapMs.toFixed(0)} мс** до **${onMain.longestGapMs.toFixed(0)} мс**. Ровно столько страница не отвечала ни на что.`;
});

const sums = computed(() => {
  const inWorker = runs.value.worker;
  const onMain = runs.value.main;
  if (!inWorker?.ok || !onMain?.ok) return '';
  return `Суммы разные (${inWorker.checksum.toLocaleString('ru-RU')} и ${onMain.checksum.toLocaleString('ru-RU')}), и так и должно быть: работа отмерена **временем, а не числом оборотов**. Важно, что они есть, — значит цикл выполнялся, а не был выброшен.`;
});

/** Полоска кадров: доля от секунды при 60 Гц. Длиннее — значит паузу видно и без чисел. */
const gapWidth = (ms: number) => Math.min(100, Math.round((ms / 1000) * 100));

/**
 * «1 кадр» / «3 кадра» / «45 кадров» — счётная форма по образцу `topics()` из `shared/lib/format`.
 *
 * Своя, а не общая: там счётная форма живёт в `shared`, потому что одно и то же число печатают
 * два места курса. Здесь место одно, и заводить общее правило ради него значит расширять
 * нижний слой под единственного потребителя. Правило русское, а не `n === 1`: у 11–14 форма
 * своя, и без этой ветки прибор показал бы «11 кадра».
 */
function framesOf(n: number): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return `${n} кадров`;
  if (mod10 === 1) return `${n} кадр`;
  if (mod10 >= 2 && mod10 <= 4) return `${n} кадра`;
  return `${n} кадров`;
}
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="tp-bar">
        <Button variant="primary" :disabled="busy" @click="run">
          {{ busy ? 'иду…' : runs.main ? 'прогнать ещё раз' : 'прогнать оба потока' }}
        </Button>
        <SegmentedControl v-model="load" class="l-pills" label="Сколько считать" :options="LOADS" />
        <span v-if="phase" class="tp-phase">{{ phase }}</span>
        <span v-else-if="!runs.main" class="tp-phase">оба числа считает ваш браузер — здесь не записано ни одного</span>
      </div>
    </template>

    <div class="tp-split">
      <div class="tp-pane">
        <div class="t-label">кадры, пока идёт работа</div>

        <div class="tp-live">
          <div class="tp-live__track">
            <span class="tp-live__dot" :style="`left:${(pulse % 40) * 2.5}%`"></span>
          </div>
          <span class="tp-live__count">{{ framesOf(pulse) }} с начала прогона</span>
        </div>

        <div v-for="card in cards" :key="card.mode" class="tp-card" :data-mode="card.mode">
          <div class="tp-card__head">
            <b class="tp-card__title">{{ card.title }}</b>
            <span v-if="card.run?.ok" class="tp-card__took">работа шла {{ card.run.tookMs.toFixed(0) }} мс</span>
          </div>

          <template v-if="card.run?.ok">
            <div class="tp-metrics">
              <div class="tp-metric">
                <span class="tp-metric__value">{{ card.run.frames }}</span>
                <span class="tp-metric__key">кадров</span>
              </div>
              <div class="tp-metric">
                <span class="tp-metric__value">{{ card.run.fps.toFixed(0) }}</span>
                <span class="tp-metric__key">кадров в секунду</span>
              </div>
              <div class="tp-metric tp-metric--gap">
                <span class="tp-metric__value">{{ card.run.longestGapMs.toFixed(0) }} мс</span>
                <span class="tp-metric__key">самая длинная пауза</span>
              </div>
            </div>

            <div class="tp-track">
              <div class="tp-fill" :data-mode="card.mode" :style="`width:${gapWidth(card.run.longestGapMs)}%`"></div>
            </div>
          </template>

          <Md v-else-if="card.run" class="tp-card__miss" :text="card.run.note" />
          <span v-else class="tp-card__miss">числа появятся после запуска</span>

          <span class="tp-card__what">{{ card.what }}</span>
        </div>

        <Md v-if="verdict" class="tp-verdict" :text="verdict" />
        <Md v-if="sums" class="tp-sums" :text="sums" />
        <p v-if="failure" class="tp-failed">{{ failure }}</p>
      </div>

      <div class="tp-pane tp-pane--right">
        <div class="t-label">что вкладка говорит о себе</div>

        <div v-if="!env.length" class="tp-empty">опрос пойдёт вместе с прогоном</div>

        <div v-for="row in env" :key="row.key" class="tp-row" :data-tone="row.tone">
          <span class="tp-row__label">{{ row.label }}</span>
          <span class="tp-row__value">{{ row.value }}</span>
          <Md class="tp-row__note" :text="row.note" />
        </div>

        <div ref="frameHost" class="tp-host" aria-hidden="true"></div>
      </div>
    </div>

    <template #footer>
      <Md class="tp-foot" :text="props.note" />
    </template>
  </DemoFrame>
</template>

<style scoped>
.tp-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}
.tp-phase {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}

.tp-split {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
}
.tp-pane {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  padding: 20px;
  border-right: 1px solid var(--divider);
}
.tp-pane--right {
  gap: 8px;
  border-right: 0;
  background: var(--surface-2);
}

.tp-live {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}
.tp-live__track {
  position: relative;
  flex: 1 1 160px;
  height: 10px;
  border-radius: var(--r-full);
  background: var(--surface-3);
}
.tp-live__dot {
  position: absolute;
  top: 1px;
  width: 8px;
  height: 8px;
  border-radius: var(--r-full);
  background: var(--tone-info-strong);
}
.tp-live__count {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-faint);
}

.tp-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 13px 14px;
  border-radius: var(--r2);
  background: var(--surface-2);
}
.tp-card[data-mode='main'] {
  background: var(--tone-err-bg);
}
.tp-card[data-mode='worker'] {
  background: var(--tone-ok-bg);
}
.tp-card__head {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: space-between;
}
.tp-card__title {
  font-family: var(--mono);
  font-size: var(--fs-5);
  color: var(--ink);
}
.tp-card__took {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.tp-card__what {
  font-size: var(--fs-4);
  line-height: 1.5;
  color: var(--text-muted);
}
.tp-card__miss {
  font-family: var(--mono);
  font-size: var(--fs-3);
  font-style: italic;
  color: var(--dim);
}

.tp-metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}
.tp-metric {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.tp-metric__value {
  font-family: var(--mono);
  font-size: var(--fs-7);
  color: var(--ink);
}
.tp-metric--gap .tp-metric__value {
  color: var(--tone-err-strong);
}
.tp-metric__key {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.tp-track {
  height: 8px;
  border-radius: var(--r-full);
  background: var(--surface-3);
  overflow: hidden;
}
.tp-fill {
  height: 100%;
  border-radius: var(--r-full);
  background: var(--bar-red);
}
.tp-fill[data-mode='worker'] {
  background: var(--bar-green);
}

.tp-verdict {
  padding: 13px 14px;
  border-radius: var(--r2);
  font-size: var(--fs-5);
  line-height: 1.55;
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
}
.tp-sums {
  font-size: var(--fs-4);
  line-height: 1.5;
  color: var(--text-muted);
}
.tp-failed {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--tone-err-strong);
}

.tp-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 4px 12px;
  padding: 10px 12px;
  border-radius: var(--r2);
  border: 1px solid var(--border);
  background: var(--surface);
}
.tp-row__label {
  font-family: var(--mono);
  font-size: var(--fs-3);
  font-weight: 600;
  overflow-wrap: anywhere;
  color: var(--ink);
}
.tp-row__value {
  font-family: var(--mono);
  font-size: var(--fs-3);
  overflow-wrap: anywhere;
  text-align: end;
}
.tp-row__note {
  grid-column: 1 / -1;
  font-size: var(--fs-4);
  line-height: 1.5;
  color: var(--text-muted);
}
.tp-row[data-tone='ok'] {
  border-color: var(--tone-ok-line);
  background: var(--tone-ok-bg);
}
.tp-row[data-tone='ok'] .tp-row__value {
  color: var(--tone-ok-strong);
}
.tp-row[data-tone='warn'] {
  border-color: var(--tone-warn-line);
  background: var(--tone-warn-bg);
}
.tp-row[data-tone='warn'] .tp-row__value {
  color: var(--tone-warn-strong);
}
.tp-row[data-tone='err'] {
  border-color: var(--tone-err-line);
  background: var(--tone-err-bg);
}
.tp-row[data-tone='err'] .tp-row__value {
  color: var(--tone-err-strong);
}
.tp-row[data-tone='dim'] {
  border-color: var(--divider);
  background: var(--sunk-dim);
}
.tp-row[data-tone='dim'] .tp-row__value {
  color: var(--dim);
}

.tp-empty {
  font-family: var(--mono);
  font-size: var(--fs-3);
  font-style: italic;
  color: var(--ghost);
}

/* Хозяин служебного кадра: он обязан быть в дереве, но не обязан занимать место. */
.tp-host {
  position: relative;
  width: 0;
  height: 0;
  overflow: hidden;
}

.tp-foot {
  font-size: var(--fs-4);
  line-height: 1.55;
  color: var(--text-muted);
}

@media (max-width: 760px) {
  .tp-split {
    grid-template-columns: minmax(0, 1fr);
  }
  .tp-pane {
    border-right: 0;
    border-bottom: 1px solid var(--divider);
  }
}
</style>
