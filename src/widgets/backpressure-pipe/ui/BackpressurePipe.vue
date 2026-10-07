<script setup lang="ts">
/**
 * Обратное давление, снятое с настоящих объектов платформы.
 *
 * Почему это не рисунок. Про backpressure обычно рисуют трубу со стрелками, и после такой
 * картинки остаётся ощущение, что где-то бежит сигнал «притормози». Никакого сигнала нет:
 * механизм состоит из трёх чисел и одного бездействия. Поэтому здесь настоящие
 * `ReadableStream` и `WritableStream`, а на экран выводится то, что у них действительно
 * лежит в очереди и что возвращает `controller.desiredSize` — на каждом шаге, без пересказа.
 *
 * Ползунков три, потому что величин ровно три: скорость производителя, скорость потребителя
 * и `highWaterMark`. Всё остальное поведение из них выводится, и читатель может это проверить,
 * а не принять на веру.
 *
 * Переключатель источника — главное противопоставление темы. Pull-источник платформа зовёт
 * сама и перестаёт звать, когда место кончилось; push-источник кладёт всегда, потому что
 * событие уже случилось. В первом случае очередь упирается в HWM, во втором `desiredSize`
 * уходит в минус и растёт по модулю — и это не поломка демо, а то, как оно есть.
 *
 * Время модельное (см. `model/pipe.ts`): иначе демо нельзя было бы ни листать по шагам,
 * ни отматывать назад. Стримы при этом настоящие, и история шагов — протокол, а не сценарий.
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { linear, linePath, niceTicks } from '@/shared/lib/chart';
import { usePlayer } from '@/shared/lib/usePlayer';
import { useStepper } from '@/shared/lib/useStepper';
import ChartFrame from '@/shared/ui/ChartFrame.vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import PlayerToolbar from '@/shared/ui/PlayerToolbar.vue';
import QueueView from '@/shared/ui/QueueView.vue';
import { SegmentedControl } from '@/shared/ui';
import { BackpressurePipe, TICKS, TICK_MS } from '../model/pipe';
import type { PipeOptions, Snapshot, SourceMode } from '../model/types';

const props = defineProps<{ defaults: PipeOptions }>();

const MODES = [
  { value: 'pull', label: 'источник по запросу' },
  { value: 'push', label: 'источник-события' },
];

const produceMs = ref(props.defaults.produceMs);
const consumeMs = ref(props.defaults.consumeMs);
const highWaterMark = ref(props.defaults.highWaterMark);
const mode = ref<SourceMode>(props.defaults.mode);

/** До гидратации острова снимков нет: на сервере стримы не заводим. */
const history = ref<Snapshot[]>([]);
let pipe: BackpressurePipe | null = null;

const stepper = useStepper(TICKS + 1);
const { index, counter, atStart, atEnd, next, prev, reset, go } = stepper;
const { playing, speed, speeds, available, toggle, setSpeed, pause } = usePlayer(stepper, {
  interval: 240,
});

/**
 * Шаги считаются по требованию и запоминаются.
 *
 * Отмотать настоящий стрим назад нельзя, поэтому «назад» показывает записанное, а «вперёд»
 * доводит конвейер до нужного шага. Цель держится в переменной, а не в параметре: пока идёт
 * догон, автоплей успевает попросить ещё, и без общей цели эти просьбы терялись бы.
 */
let target = 0;
let catching = false;

async function ensure(upTo: number): Promise<void> {
  target = Math.max(target, upTo);
  if (catching) return;
  catching = true;
  while (pipe && history.value.length <= target && history.value.length <= TICKS) {
    const snapshot = await pipe.tick();
    history.value = [...history.value, snapshot];
  }
  catching = false;
}

async function rebuild(): Promise<void> {
  pause();
  pipe?.stop();
  target = 0;
  catching = false;
  pipe = new BackpressurePipe({
    produceMs: produceMs.value,
    consumeMs: consumeMs.value,
    highWaterMark: highWaterMark.value,
    mode: mode.value,
  });
  history.value = [await pipe.begin()];
  reset();
}

onMounted(rebuild);
onUnmounted(() => pipe?.stop());

// Любая из трёх величин — это другой конвейер, а не другой вид того же: продолжать с середины
// значило бы показывать очередь, набранную при прежних настройках.
watch([produceMs, consumeMs, highWaterMark, mode], () => void rebuild());
watch(index, (i) => void ensure(i));

const EMPTY: Snapshot = {
  t: 0,
  queue: [],
  desired: null,
  writerDesired: null,
  produced: 0,
  delivered: 0,
  source: 'спит: pull не зовут',
  pump: 'ждёт ready',
  sink: 'простаивает',
};

const step = computed<Snapshot>(
  () => history.value[Math.min(index.value, history.value.length - 1)] ?? EMPTY,
);

const onRange = (target_: EventTarget | null) => Number((target_ as HTMLInputElement).value);

// ---- График ----

const WIDTH = 720;
const HEIGHT = 240;
const PAD = { top: 14, right: 18, bottom: 32, left: 46 };
const PLOT_W = WIDTH - PAD.left - PAD.right;
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;

/** Ось времени фиксирована на всю длину сценария: иначе картинка ездила бы на каждом шаге. */
const x = linear([0, TICKS * TICK_MS], [0, PLOT_W]);

const domain = computed<[number, number]>(() => {
  const queues = history.value.map((s) => s.queue.length);
  const desired = history.value.map((s) => s.desired ?? 0);
  const hi = Math.max(highWaterMark.value + 1, ...queues, 1);
  const lo = Math.min(0, ...desired);
  return [lo, hi];
});

const y = computed(() => linear(domain.value, [PLOT_H, 0]));

const yTicks = computed(() =>
  niceTicks(domain.value, 5)
    .filter((t) => t >= domain.value[0] && t <= domain.value[1])
    .map((t) => ({ at: y.value(t), label: String(t) })),
);

const xTicks = computed(() =>
  [0, 0.25, 0.5, 0.75, 1].map((k) => {
    const ms = Math.round(TICKS * TICK_MS * k);
    return { at: x(ms), label: String(ms) };
  }),
);

/** Рисуем только то, что уже прогнали: график растёт вместе с демо. */
const shown = computed(() => history.value.slice(0, index.value + 1));

const queuePath = computed(() =>
  linePath(shown.value.map((s) => [x(s.t), y.value(s.queue.length)])),
);
const desiredPath = computed(() =>
  linePath(shown.value.map((s) => [x(s.t), y.value(s.desired ?? 0)])),
);

const zeroAt = computed(() => y.value(0));
const hwmAt = computed(() => y.value(highWaterMark.value));
const headAt = computed(() => (shown.value.length ? x(shown.value[shown.value.length - 1].t) : 0));

const stats = computed(() => [
  { k: 'произведено', v: String(step.value.produced), tone: 'neutral' },
  { k: 'доставлено', v: String(step.value.delivered), tone: 'ok' },
  { k: 'в очереди', v: String(step.value.queue.length), tone: 'info' },
  {
    k: 'desiredSize',
    v: step.value.desired === null ? 'null' : String(step.value.desired),
    tone: (step.value.desired ?? 0) > 0 ? 'ok' : 'err',
  },
  {
    k: 'writer.desiredSize',
    v: step.value.writerDesired === null ? 'null' : String(step.value.writerDesired),
    tone: (step.value.writerDesired ?? 0) > 0 ? 'ok' : 'warn',
  },
]);

const roles = computed(() => [
  { k: 'источник', v: step.value.source, tone: step.value.source === 'работает' ? 'ok' : 'warn' },
  { k: 'насос', v: step.value.pump, tone: step.value.pump === 'читает' ? 'ok' : 'warn' },
  { k: 'сток', v: step.value.sink, tone: step.value.sink === 'занят' ? 'ok' : 'neutral' },
]);
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="bar">
        <PlayerToolbar
          :counter="counter"
          :index="index"
          :playing="playing"
          :speed="speed"
          :speeds="speeds"
          :available="available"
          :at-start="atStart"
          :at-end="atEnd"
          @toggle="toggle"
          @scrub="go"
          @speed="setSpeed"
          @prev="prev"
          @next="next"
          @reset="reset"
        />
        <SegmentedControl v-model="mode" class="l-pills" label="Как устроен источник" :options="MODES" />
      </div>
    </template>

    <div class="body">
      <div class="knobs">
        <label class="knob">
          <span class="t-label">производитель · чанк за {{ produceMs }} мс</span>
          <input
            class="range"
            type="range"
            min="50"
            max="500"
            step="50"
            :value="produceMs"
            aria-label="Сколько миллисекунд источник тратит на один чанк"
            @input="produceMs = onRange($event.target)"
          />
        </label>
        <label class="knob">
          <span class="t-label">потребитель · чанк за {{ consumeMs }} мс</span>
          <input
            class="range"
            type="range"
            min="50"
            max="500"
            step="50"
            :value="consumeMs"
            aria-label="Сколько миллисекунд сток тратит на один чанк"
            @input="consumeMs = onRange($event.target)"
          />
        </label>
        <label class="knob">
          <span class="t-label">highWaterMark · {{ highWaterMark }}</span>
          <input
            class="range"
            type="range"
            min="1"
            max="8"
            step="1"
            :value="highWaterMark"
            aria-label="Лимит очереди читаемого стрима, в чанках"
            @input="highWaterMark = onRange($event.target)"
          />
        </label>
      </div>

      <div class="stats">
        <span v-for="s in stats" :key="s.k" class="stat" :data-tone="s.tone">
          <span class="stat__k">{{ s.k }}</span>
          <span class="stat__v">{{ s.v }}</span>
        </span>
      </div>

      <QueueView
        :items="step.queue"
        layout="row"
        tone="info"
        label="очередь читаемого стрима"
        empty-label="пусто"
        :min-height="34"
      />

      <div class="roles">
        <span v-for="r in roles" :key="r.k" class="role" :data-tone="r.tone">
          <span class="role__k">{{ r.k }}</span>
          <span class="role__v">{{ r.v }}</span>
        </span>
      </div>

      <ChartFrame
        :width="WIDTH"
        :height="HEIGHT"
        :pad="PAD"
        :x-ticks="xTicks"
        :y-ticks="yTicks"
        x-label="мс модельного времени"
        y-label="чанков"
      >
        <!-- Ноль — не деление шкалы, а граница решения: выше него наливают, ниже тормозят. -->
        <line class="zero" x1="0" :x2="PLOT_W" :y1="zeroAt" :y2="zeroAt" />
        <line class="hwm" x1="0" :x2="PLOT_W" :y1="hwmAt" :y2="hwmAt" />
        <text class="hwm__label" x="4" :y="hwmAt - 5">HWM {{ highWaterMark }}</text>

        <path class="line line--queue" :d="queuePath" />
        <path class="line line--desired" :d="desiredPath" />
        <line class="head" :x1="headAt" :x2="headAt" y1="0" :y2="PLOT_H" />
      </ChartFrame>

      <div class="legend">
        <span class="item" data-series="queue"><span class="swatch" />длина очереди</span>
        <span class="item" data-series="desired"><span class="swatch" />desiredSize</span>
        <span class="item" data-series="hwm"><span class="swatch" />highWaterMark</span>
      </div>
    </div>

    <template #footer>
      <div class="disclaimer">
        Стримы здесь настоящие: очередь, флаг обратного давления и порядок вызовов ведёт
        платформа. Числа <code>desiredSize</code> сняты с <code>ReadableStreamDefaultController</code>
        и <code>WritableStreamDefaultWriter</code> на каждом шаге, а не посчитаны нами.
        Модельное только время — иначе демо нельзя было бы ни листать, ни отматывать назад.
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
  min-width: 0;
}

.knobs {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(210px, 100%), 1fr));
  gap: 14px;
}
.knob {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

/*
  Ползунок целиком свой. У системного контрола собственные цвета трека и бегунка, а в курсе
  цвет приходит только из темы — проверка палитры краснеет на первом же системном оттенке.
  `font` и `color` наследуются по той же причине: у input свои браузерные дефолты.
*/
.range {
  width: 100%;
  min-width: 0;
  height: 4px;
  margin: 0;
  appearance: none;
  border-radius: var(--r-full);
  background: var(--surface-3);
  font: inherit;
  color: inherit;
}
.range::-webkit-slider-thumb {
  appearance: none;
  width: 14px;
  height: 14px;
  border: 0;
  border-radius: var(--r-full);
  background: var(--accent);
  cursor: pointer;
}
.range::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border: 0;
  border-radius: var(--r-full);
  background: var(--accent);
  cursor: pointer;
}

.stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.stat {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  padding: 7px 11px;
  border-radius: var(--r2);
  font-family: var(--mono);
  transition: all 0.2s;
}
.stat__k {
  font-size: var(--fs-2);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.stat__v {
  font-size: var(--fs-5);
}
.stat[data-tone='neutral'] {
  background: var(--surface-2);
  color: var(--chip-text);
}
.stat[data-tone='info'] {
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
}
.stat[data-tone='ok'] {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.stat[data-tone='warn'] {
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.stat[data-tone='err'] {
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}

.roles {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.role {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 11px;
  border-radius: var(--r-full);
  border: 1px solid var(--border);
  font-family: var(--mono);
  font-size: var(--fs-2);
  transition: all 0.2s;
}
.role__k {
  color: var(--text-faint);
}
.role[data-tone='ok'] {
  border-color: var(--tone-ok-line);
  background: var(--tone-ok-bg);
}
.role[data-tone='ok'] .role__v {
  color: var(--tone-ok-text);
}
.role[data-tone='warn'] {
  border-color: var(--tone-warn-line);
  background: var(--tone-warn-bg);
}
.role[data-tone='warn'] .role__v {
  color: var(--tone-warn-text);
}
.role[data-tone='neutral'] {
  background: var(--surface-2);
}
.role[data-tone='neutral'] .role__v {
  color: var(--chip-text);
}

.line {
  fill: none;
  stroke-width: 2;
}
.line--queue {
  stroke: var(--bar-violet);
}
.line--desired {
  stroke: var(--bar-amber);
}
.zero {
  stroke: var(--border-strong);
  stroke-width: 1;
}
.hwm {
  stroke: var(--bar-green);
  stroke-width: 1;
  stroke-dasharray: 4 4;
}
.hwm__label {
  fill: var(--tone-ok-strong);
  font-family: var(--mono);
  font-size: var(--fs-1);
}
.head {
  stroke: var(--rule);
  stroke-width: 1;
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-muted);
}
.item {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}
.swatch {
  width: 14px;
  height: 3px;
  border-radius: var(--r-full);
}
.item[data-series='queue'] .swatch {
  background: var(--bar-violet);
}
.item[data-series='desired'] .swatch {
  background: var(--bar-amber);
}
.item[data-series='hwm'] .swatch {
  background: var(--bar-green);
}

.disclaimer {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}
</style>
