<script setup lang="ts">
/**
 * Конкурентный мини-React по шагам: полосы корня битами, планировщик, дерево в работе,
 * шкала виртуального времени и то, что на экране.
 *
 * Заготовленного здесь нет. Код приходит пропом — это `MINI_LANES_CODE`, та же строка, что
 * напечатана в теме и исполняется тестом, — и `model/session.ts` гоняет его в браузере
 * читателя. Шаг за последним кадром выполняет следующий колбэк хоста: одну микрозадачу
 * или одну макрозадачу планировщика. Кнопки действий вызывают настоящий `setState`
 * в тот момент, где читатель остановился, — поэтому срочный ввод можно нажать между двумя
 * квантами перехода и увидеть, как начатое дерево выбрасывается.
 *
 * Сессия и её массивы живут **вне реактивности**: запись идёт из глубины кода темы, и держать
 * её в `ref` значило бы писать в реактивное состояние из кода, который Vue не контролирует.
 * На экран протокол переносится одним присваиванием в `shallowRef` после шага.
 *
 * Прогон — в `onMounted`, а не в `setup`: остров сперва рендерится на сервере, и исполнять
 * там реализацию незачем.
 */
import { computed, onMounted, ref, shallowRef, watch } from 'vue';
import CodeListing from '@/shared/ui/CodeListing.vue';
import ConsoleView from '@/shared/ui/ConsoleView.vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import PlayerToolbar from '@/shared/ui/PlayerToolbar.vue';
import { Button, SegmentedControl } from '@/shared/ui';
import { usePlayer } from '@/shared/lib/usePlayer';
import { useStepper } from '@/shared/lib/useStepper';
import { createSession, laneName, type LanesSession } from '../model/session';
import type { LaneFrame, LaneFrameKind, LanesAction, LanesScenario, TimelineSegment } from '../model/types';

const props = defineProps<{ code: string; scenarios: LanesScenario[] }>();

/** Сколько последних строк лога держать на экране: остальное — счётчиком сверху. */
const TAIL = 8;

const KIND_LABEL: Record<LaneFrameKind, string> = {
  event: 'событие',
  schedule: 'заказ',
  task: 'задача',
  unit: 'render',
  yield: 'уступка',
  restart: 'выброшено',
  commit: 'commit',
  suspend: 'suspense',
  ping: 'пинг',
  idle: 'покой',
};

const LANES = [
  { bit: 2, name: 'SyncLane', shift: '1 << 1', tone: 'sync' },
  { bit: 8, name: 'InputContinuousLane', shift: '1 << 3', tone: 'input' },
  { bit: 32, name: 'DefaultLane', shift: '1 << 5', tone: 'default' },
  { bit: 256, name: 'TransitionLane', shift: '1 << 8', tone: 'transition' },
  { bit: 4194304, name: 'RetryLane', shift: '1 << 22', tone: 'retry' },
] as const;

const toneOf = (lane: number) => LANES.find((item) => lane & item.bit)?.tone ?? 'default';

const picked = ref(props.scenarios[0]?.key ?? '');
const options = computed(() => props.scenarios.map((item) => ({ value: item.key, label: item.label })));
const scenario = computed(() => props.scenarios.find((item) => item.key === picked.value) ?? props.scenarios[0]);

let session: LanesSession | null = null;
const frames = shallowRef<LaneFrame[]>([]);
const logs = shallowRef<string[]>([]);
const canRun = ref(false);
const failure = ref('');

const total = computed(() => Math.max(1, frames.value.length));
const stepper = useStepper(total);
const { index, counter, atStart, prev, reset, go } = stepper;

/** Шаг за последним кадром — выполнить следующий колбэк хоста и дописать протокол. */
const liveNext = () => {
  if (index.value < frames.value.length - 1) {
    stepper.next();
    return;
  }
  if (!session) return;
  try {
    const from = session.step();
    publish();
    if (from >= 0) go(from);
  } catch (error) {
    fail(error);
  }
};
const liveAtEnd = computed(() => index.value >= frames.value.length - 1 && !canRun.value);
const { playing, speed, speeds, available, toggle, setSpeed, pause } = usePlayer(
  { ...stepper, next: liveNext, atEnd: liveAtEnd },
  { interval: 650 },
);

const frame = computed<LaneFrame | null>(() => frames.value[index.value] ?? null);

/** Копии массивов сессии: сама сессия нереактивна, экран получает снимок. */
function publish() {
  if (!session) return;
  frames.value = [...session.frames];
  logs.value = [...session.logs];
  canRun.value = session.hasWork();
}

function fail(error: unknown) {
  pause();
  session = null;
  canRun.value = false;
  failure.value = error instanceof Error ? error.message : String(error);
}

const start = () => {
  pause();
  failure.value = '';
  try {
    session = createSession(props.code, scenario.value);
    publish();
    go(frames.value.length - 1);
  } catch (error) {
    frames.value = [];
    fail(error);
  }
};

const fire = (action: LanesAction) => {
  if (!session) return;
  pause();
  try {
    const from = session.fire(action);
    publish();
    go(from);
  } catch (error) {
    fail(error);
  }
};

onMounted(start);
watch(picked, start);

const logShown = computed(() => {
  const lines = logs.value.slice(0, frame.value?.logs ?? 0);
  const hidden = Math.max(0, lines.length - TAIL);
  return hidden ? [`… выше ещё ${hidden}`, ...lines.slice(-TAIL)] : lines;
});

const laneRows = computed(() => {
  const f = frame.value;
  return LANES.map((lane) => {
    const expires = f?.expirationTimes[String(lane.bit)];
    return {
      ...lane,
      pending: Boolean(f && f.pending & lane.bit),
      suspended: Boolean(f && f.suspended & lane.bit),
      expired: Boolean(f && f.expired & lane.bit),
      rendering: Boolean(f && f.renderLane & lane.bit),
      expires: expires === undefined ? '' : expires === -1 ? 'не просрочится' : `срок t=${expires}`,
    };
  });
});

/** `258` → `0b1_0000_0010`: биты по четыре, чтобы глаз находил нужный. */
const binary = (value: number) => {
  const bits = value.toString(2);
  const groups: string[] = [];
  for (let end = bits.length; end > 0; end -= 4) groups.unshift(bits.slice(Math.max(0, end - 4), end));
  return `0b${groups.join('_')}`;
};

const timeline = computed(() => {
  const segments = frame.value?.segments ?? [];
  if (!segments.length) return { items: [], from: 0, to: 0 };
  const from = segments[0].from;
  const to = Math.max(from + 1, ...segments.map((segment) => segment.to));
  const span = to - from;
  const items = segments.map((segment: TimelineSegment, i) => ({
    key: i,
    tone: toneOf(segment.lane),
    outcome: segment.outcome,
    left: ((segment.from - from) / span) * 100,
    width: Math.max(((segment.to - segment.from) / span) * 100, 0.8),
    title: `${laneName(segment.lane)} · t=${segment.from}…${segment.to} · ${OUTCOME[segment.outcome]}`,
  }));
  return { items, from, to };
});

const OUTCOME: Record<TimelineSegment['outcome'], string> = {
  running: 'идёт',
  yield: 'уступил',
  commit: 'закоммичен',
  thrown: 'выброшен',
  suspended: 'отложен',
};

const stats = computed(() => [
  { k: 'время', v: `${frame.value?.time ?? 0} мс` },
  { k: 'вызовов компонентов', v: frame.value?.calls ?? 0 },
  { k: 'выброшено деревьев', v: frame.value?.restarts ?? 0 },
  { k: 'коммитов', v: frame.value?.commits ?? 0 },
]);

const codeLines = computed(() => scenario.value.code.split('\n'));
const indent = (depth: number) => `padding-left:${6 + depth * 14}px`;
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="ml-bar">
        <SegmentedControl v-model="picked" class="l-pills" label="Сценарий" :options="options" />
        <div class="ml-actions">
          <Button
            v-for="action in scenario.actions"
            :key="action.label"
            :variant="action.event === 'discrete' ? 'primary' : 'secondary'"
            :disabled="!session"
            @click="fire(action)"
          >
            {{ action.label }}
          </Button>
        </div>
      </div>
    </template>

    <div class="ml-split">
      <div class="ml-pane">
        <CodeListing :lines="codeLines" label="сценарий — исполняется как есть" />
      </div>

      <div class="ml-pane ml-pane--right">
        <p v-if="failure" class="ml-wait">мини-реализация упала: {{ failure }}</p>
        <p v-else-if="!frame" class="ml-wait">мини-реализация запускается в вашем браузере…</p>

        <template v-else>
          <div class="ml-now" :data-kind="frame.kind">
            <span class="ml-now__head">
              <span class="ml-now__kind">{{ KIND_LABEL[frame.kind] }}</span>
              <span class="ml-now__time">t = {{ frame.time }} мс</span>
            </span>
            <span class="ml-now__text">{{ frame.text }}</span>
          </div>

          <div class="ml-block">
            <div class="t-label">полосы корня</div>
            <div class="ml-bits" data-code>
              pendingLanes = {{ frame.pending }} · {{ binary(frame.pending) }}
            </div>
            <div class="ml-lanes">
              <div
                v-for="lane in laneRows"
                :key="lane.bit"
                class="ml-lane"
                :data-tone="lane.tone"
                :data-on="lane.pending || undefined"
                :data-render="lane.rendering || undefined"
              >
                <span class="ml-lane__bit">{{ lane.pending ? '1' : '0' }}</span>
                <span class="ml-lane__name">{{ lane.name }}</span>
                <span class="ml-lane__shift">{{ lane.shift }}</span>
                <span v-if="lane.rendering" class="ml-tag ml-tag--render">рендерится</span>
                <span v-if="lane.suspended" class="ml-tag ml-tag--sleep">спит на промисе</span>
                <span v-if="lane.expired" class="ml-tag ml-tag--late">просрочена</span>
                <span v-if="lane.expires" class="ml-lane__due">{{ lane.expires }}</span>
              </div>
            </div>
          </div>

          <div class="ml-cols">
            <div class="ml-block">
              <div class="t-label">
                дерево в работе{{ frame.renderLane ? ` · ${laneName(frame.renderLane)}` : '' }}
              </div>
              <div v-if="!frame.wip.length" class="ml-empty">нет: рендер не идёт</div>
              <div
                v-for="(row, i) in frame.wip"
                :key="i"
                class="ml-row"
                :data-state="row.state"
                :style="indent(row.depth)"
              >
                <span class="ml-row__mark">{{ row.state === 'done' ? '✓' : row.state === 'next' ? '→' : '·' }}</span>
                {{ row.label }}
              </div>
            </div>

            <div class="ml-block">
              <div class="t-label">очередь планировщика</div>
              <div v-if="!frame.tasks.length && !frame.micro" class="ml-empty">пусто</div>
              <div v-if="frame.micro" class="ml-task ml-task--micro">микрозадач: {{ frame.micro }}</div>
              <div v-for="task in frame.tasks" :key="task.id" class="ml-task">
                #{{ task.id }} {{ task.priority }} · дедлайн t={{ task.expires }}
                <span class="ml-task__what">{{ task.what }}</span>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>

    <div class="ml-timeline">
      <div class="t-label">главный поток на виртуальных часах</div>
      <div class="ml-track">
        <span v-if="!timeline.items.length" class="ml-empty">работы ещё не было</span>
        <span
          v-for="item in timeline.items"
          :key="item.key"
          class="ml-seg"
          :data-tone="item.tone"
          :data-outcome="item.outcome"
          :style="`left:${item.left}%;width:${item.width}%`"
          :title="item.title"
        ></span>
      </div>
      <div class="ml-axis">
        <span>t={{ timeline.from }}</span>
        <span>t={{ timeline.to }} мс</span>
      </div>
      <div class="ml-legend">
        <span class="ml-key" data-tone="sync">SyncLane</span>
        <span class="ml-key" data-tone="default">DefaultLane</span>
        <span class="ml-key" data-tone="transition">TransitionLane</span>
        <span class="ml-key" data-tone="retry">RetryLane</span>
        <span class="ml-key" data-outcome="thrown">выброшено</span>
      </div>
    </div>

    <div class="ml-split ml-split--bottom">
      <div class="ml-pane">
        <ConsoleView :lines="logShown" label="лог компонентов" empty-label="пока тихо" :min-height="96" />
      </div>
      <div class="ml-pane ml-pane--right">
        <div class="ml-screen">
          <span class="t-label">на экране — последний коммит</span>
          <span class="ml-screen__box" data-code>{{ frame?.html || '(пусто)' }}</span>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="ml-foot">
        <PlayerToolbar
          :counter="frames.length ? counter : '0 / 0'"
          :index="index"
          :playing="playing"
          :speed="speed"
          :speeds="speeds"
          :available="available"
          :at-start="atStart"
          :at-end="liveAtEnd"
          next-label="шаг →"
          @toggle="toggle"
          @scrub="go"
          @speed="setSpeed"
          @prev="prev"
          @next="liveNext"
          @reset="reset"
        />

        <div class="ml-stats">
          <span v-for="item in stats" :key="item.k" class="ml-stat">
            <span class="ml-stat__k">{{ item.k }}</span>
            <span class="ml-stat__v">{{ item.v }}</span>
          </span>
        </div>

        <Md class="ml-note" :text="scenario.note" />
      </div>
    </template>
  </DemoFrame>
</template>

<style scoped>
.ml-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}
.ml-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.ml-split {
  display: grid;
  grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr);
}
.ml-split--bottom {
  border-top: 1px solid var(--divider);
}
.ml-pane {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
  border-right: 1px solid var(--divider);
  min-width: 0;
}
.ml-pane--right {
  border-right: 0;
  background: var(--surface-2);
}

.ml-wait,
.ml-empty {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--dim);
}

.ml-now {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 11px 14px;
  border-radius: var(--r2);
  border: 1px solid var(--border);
  background: var(--surface);
}
.ml-now__head {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}
.ml-now__kind,
.ml-now__time {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-faint);
}
.ml-now__text {
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.5;
  color: var(--ink);
  overflow-wrap: anywhere;
}
.ml-now[data-kind='unit'] {
  border-color: var(--tone-info-line);
  background: var(--tone-info-bg);
}
.ml-now[data-kind='unit'] .ml-now__kind {
  color: var(--tone-info-strong);
}
.ml-now[data-kind='restart'],
.ml-now[data-kind='suspend'] {
  border-color: var(--tone-err-line);
  background: var(--tone-err-bg);
}
.ml-now[data-kind='restart'] .ml-now__kind,
.ml-now[data-kind='suspend'] .ml-now__kind {
  color: var(--tone-err-strong);
}
.ml-now[data-kind='commit'] {
  border-color: var(--tone-ok-line);
  background: var(--tone-ok-bg);
}
.ml-now[data-kind='commit'] .ml-now__kind {
  color: var(--tone-ok-strong);
}
.ml-now[data-kind='yield'],
.ml-now[data-kind='task'] {
  border-color: var(--tone-warn-line);
  background: var(--tone-warn-bg);
}
.ml-now[data-kind='yield'] .ml-now__kind,
.ml-now[data-kind='task'] .ml-now__kind {
  color: var(--tone-warn-strong);
}

.ml-block {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}
.ml-bits {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--ink);
  overflow-wrap: anywhere;
}
.ml-lanes {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.ml-lane {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  padding: 3px 8px;
  border-radius: var(--r1);
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.45;
  color: var(--text-muted);
}
.ml-lane__bit {
  width: 1ch;
  color: var(--text-faint);
}
.ml-lane__name {
  color: var(--text-muted);
}
.ml-lane__shift,
.ml-lane__due {
  color: var(--text-faint);
}
.ml-lane[data-on] {
  background: var(--surface);
  box-shadow: inset 3px 0 0 var(--ml-lane);
}
.ml-lane[data-on] .ml-lane__bit,
.ml-lane[data-on] .ml-lane__name {
  color: var(--ink);
  font-weight: 600;
}
.ml-lane[data-render] {
  outline: 1px solid var(--ml-lane);
}
.ml-lane[data-tone='sync'],
.ml-seg[data-tone='sync'],
.ml-key[data-tone='sync'] {
  --ml-lane: var(--tone-err-strong);
  --ml-fill: var(--tone-err-chip);
}
.ml-lane[data-tone='input'] {
  --ml-lane: var(--tone-warn-strong);
  --ml-fill: var(--tone-warn-chip);
}
.ml-lane[data-tone='default'],
.ml-seg[data-tone='default'],
.ml-key[data-tone='default'] {
  --ml-lane: var(--tone-warn-strong);
  --ml-fill: var(--tone-warn-chip);
}
.ml-lane[data-tone='transition'],
.ml-seg[data-tone='transition'],
.ml-key[data-tone='transition'] {
  --ml-lane: var(--tone-info-strong);
  --ml-fill: var(--tone-info-chip);
}
.ml-lane[data-tone='retry'],
.ml-seg[data-tone='retry'],
.ml-key[data-tone='retry'] {
  --ml-lane: var(--tone-ok-strong);
  --ml-fill: var(--tone-ok-chip);
}

.ml-tag {
  padding: 0 6px;
  border-radius: var(--r-full);
  font-size: var(--fs-3);
}
.ml-tag--render {
  background: var(--tone-info-bg);
  color: var(--tone-info-strong);
}
.ml-tag--sleep {
  background: var(--tone-warn-bg);
  color: var(--tone-warn-strong);
}
.ml-tag--late {
  background: var(--tone-err-bg);
  color: var(--tone-err-strong);
}

.ml-cols {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 14px;
}
.ml-row {
  display: flex;
  gap: 6px;
  padding-top: 2px;
  padding-bottom: 2px;
  padding-right: 6px;
  border-radius: var(--r1);
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.45;
  color: var(--text-faint);
}
.ml-row[data-state='done'] {
  color: var(--ink);
}
.ml-row[data-state='done'] .ml-row__mark {
  color: var(--tone-ok-strong);
}
.ml-row[data-state='next'] {
  background: var(--tone-info-bg);
  box-shadow: inset 2px 0 0 var(--accent);
  color: var(--tone-info-text);
  font-weight: 600;
}
.ml-task {
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.45;
  color: var(--ink);
  overflow-wrap: anywhere;
}
.ml-task--micro {
  color: var(--tone-err-strong);
}
.ml-task__what {
  color: var(--text-faint);
}

.ml-timeline {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 16px 20px;
  border-top: 1px solid var(--divider);
}
.ml-track {
  position: relative;
  height: 26px;
  border-radius: var(--r1);
  background: var(--surface-3);
  overflow: hidden;
}
.ml-track .ml-empty {
  position: absolute;
  left: 8px;
  top: 5px;
}
.ml-seg {
  position: absolute;
  top: 3px;
  bottom: 3px;
  border-radius: 3px;
  background: var(--ml-fill);
  box-shadow: inset 0 0 0 1px var(--ml-lane);
}
.ml-seg[data-outcome='thrown'] {
  background: var(--surface);
  box-shadow: inset 0 0 0 1px var(--tone-err-line);
  opacity: 0.9;
}
.ml-seg[data-outcome='commit'] {
  box-shadow:
    inset 0 0 0 1px var(--ml-lane),
    inset -3px 0 0 var(--ml-lane);
}
.ml-axis {
  display: flex;
  justify-content: space-between;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}
.ml-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.ml-key {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-muted);
}
.ml-key::before {
  content: '';
  width: 14px;
  height: 10px;
  border-radius: 2px;
  background: var(--ml-fill);
  box-shadow: inset 0 0 0 1px var(--ml-lane);
}
.ml-key[data-outcome='thrown']::before {
  background: var(--surface);
  box-shadow: inset 0 0 0 1px var(--tone-err-line);
}

.ml-screen {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ml-screen__box {
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

.ml-foot {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.ml-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}
.ml-stat {
  display: inline-flex;
  align-items: baseline;
  gap: 7px;
  padding: 5px 10px;
  border-radius: var(--r-full);
  background: var(--surface-3);
}
.ml-stat__k {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-muted);
}
.ml-stat__v {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
}
.ml-note {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--prose);
}

@media (max-width: 860px) {
  .ml-split {
    grid-template-columns: 1fr;
  }
  .ml-pane {
    border-right: 0;
    border-bottom: 1px solid var(--divider);
  }
}
@media (max-width: 520px) {
  .ml-cols {
    grid-template-columns: 1fr;
  }
}
</style>
