<script setup lang="ts">
/**
 * Мини-реализация хуков темы «React изнутри: хуки и контекст» по шагам: дерево файберов,
 * список ячеек хуков у каждого компонента, что случилось с файбером в этом рендере
 * (вызван, пропущен, пропущен со спуском), лог компонентов и экран после каждого коммита.
 *
 * Ничего заготовленного здесь нет. Код приходит пропом — это `MINI_HOOKS_CODE`, та же строка,
 * что напечатана в теме и исполняется тестом, — и `model/session.ts` гоняет его в браузере
 * читателя на выбранном сценарии, записывая протокол. Кнопки выполняют настоящие `setState`,
 * запись в `ref` и `store.set`; «шаг» листает записанное.
 *
 * Сессия и её массивы живут **вне реактивности**: запись идёт из глубины реализации, и держать
 * её в `ref` значило бы писать в реактивное состояние из кода, который Vue не контролирует.
 * На экран протокол переносится одним присваиванием в `shallowRef` после прогона.
 *
 * Прогон — в `onMounted`, а не в `setup`: остров сперва рендерится на сервере, и исполнять там
 * реализацию незачем.
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
import { createSession, type HooksSession } from '../model/session';
import { isTorn } from '../model/screen';
import type { FiberStatus, HooksAction, HooksFrame, HooksPhase, HooksScenario } from '../model/types';

const props = defineProps<{ code: string; scenarios: HooksScenario[] }>();

/** Сколько последних строк лога держать на экране: остальное — счётчиком сверху. */
const TAIL = 9;

const PHASE_LABEL: Record<HooksPhase, string> = {
  event: 'вне рендера',
  render: 'render-фаза',
  commit: 'commit',
  passive: 'useEffect',
};

const STATUS_LABEL: Record<FiberStatus, string> = {
  mount: 'монтирование',
  render: 'вызван',
  same: 'вызван, дети пропущены',
  skip: 'пропущен',
  descend: 'пропущен, спуск ниже',
  host: '',
  idle: '',
};

const picked = ref(props.scenarios[0]?.key ?? '');
const options = computed(() => props.scenarios.map((item) => ({ value: item.key, label: item.label })));
const scenario = computed(() => props.scenarios.find((item) => item.key === picked.value) ?? props.scenarios[0]);

let session: HooksSession | null = null;
const frames = shallowRef<HooksFrame[]>([]);
const logs = shallowRef<string[]>([]);
const screens = shallowRef<string[]>([]);
const failure = ref('');

const total = computed(() => Math.max(1, frames.value.length));
const stepper = useStepper(total);
const { index, counter, atStart, atEnd, next, prev, reset, go } = stepper;
const { playing, speed, speeds, available, toggle, setSpeed, pause } = usePlayer(stepper, { interval: 700 });

const frame = computed<HooksFrame | null>(() => frames.value[index.value] ?? null);

/** Копии массивов сессии: сама сессия нереактивна, экран получает снимок. */
const publish = () => {
  if (!session) return;
  frames.value = [...session.frames];
  logs.value = [...session.logs];
  screens.value = [...session.screens];
};

const start = () => {
  pause();
  failure.value = '';
  try {
    session = createSession(props.code, scenario.value);
    publish();
  } catch (error) {
    session = null;
    frames.value = [];
    failure.value = error instanceof Error ? error.message : String(error);
  }
  go(Math.max(0, frames.value.length - 1));
};

const fire = (action: HooksAction) => {
  if (!session) return;
  pause();
  try {
    const from = session.act(action);
    publish();
    go(from);
  } catch (error) {
    failure.value = error instanceof Error ? error.message : String(error);
  }
};

onMounted(start);
watch(picked, start);

const logShown = computed(() => {
  const lines = logs.value.slice(0, frame.value?.logs ?? 0);
  const hidden = Math.max(0, lines.length - TAIL);
  return hidden ? [`… выше ещё ${hidden}`, ...lines.slice(-TAIL)] : lines;
});

/** Экраны после коммитов — последние четыре к этому кадру. */
const screensShown = computed(() => {
  const count = frame.value?.screens ?? 0;
  const list = screens.value.slice(0, count).map((html, i) => ({ n: i + 1, html, torn: !!scenario.value.tearCheck && isTorn(html) }));
  return list.slice(-4);
});

const stats = computed(() => [
  { k: 'вызовов компонентов', v: frame.value?.calls ?? 0 },
  { k: 'коммитов', v: frame.value?.commits ?? 0 },
]);

const codeLines = computed(() => scenario.value.code.split('\n'));
const indent = (depth: number) => `padding-left:${8 + depth * 14}px`;
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="mh-bar">
        <SegmentedControl v-if="options.length > 1" v-model="picked" class="l-pills" label="Сценарий" :options="options" />
        <div class="mh-actions">
          <Button
            v-for="action in scenario.actions"
            :key="action.name + action.label"
            variant="primary"
            :disabled="!session"
            @click="fire(action)"
          >
            {{ action.label }}
          </Button>
        </div>
      </div>
    </template>

    <div class="mh-split">
      <div class="mh-pane">
        <CodeListing :lines="codeLines" label="сценарий — исполняется как есть" />
      </div>

      <div class="mh-pane mh-pane--right">
        <p v-if="failure" class="mh-wait">реализация упала: {{ failure }}</p>
        <p v-else-if="!frame" class="mh-wait">сценарий запускается…</p>
        <template v-else>
          <div class="mh-now" :data-phase="frame.phase" :data-kind="frame.kind">
            <span class="mh-now__phase">{{ PHASE_LABEL[frame.phase] }}</span>
            <span class="mh-now__text">{{ frame.text }}</span>
          </div>

          <div class="mh-tree">
            <div class="t-label">файберы и их ячейки</div>
            <div
              v-for="row in frame.rows"
              :key="row.id"
              class="mh-row"
              :class="{ 'mh-row--next': row.next }"
              :data-status="row.status"
              :style="indent(row.depth)"
            >
              <span class="mh-row__head">
                <span class="mh-row__label">{{ row.label }}</span>
                <span v-if="STATUS_LABEL[row.status]" class="mh-status" :data-status="row.status">
                  {{ STATUS_LABEL[row.status] }}
                </span>
                <span v-if="row.renders" class="mh-row__count">×{{ row.renders }}</span>
                <span v-if="row.lanes" class="mh-lane">lanes</span>
                <span v-if="row.childLanes" class="mh-lane mh-lane--child">childLanes</span>
              </span>
              <span v-if="row.detail" class="mh-row__detail">{{ row.detail }}</span>
              <span v-for="cell in row.cells" :key="cell.index" class="mh-cell">
                <span class="mh-cell__i">#{{ cell.index }}</span>
                <span class="mh-cell__type">{{ cell.type }}</span>
                <span class="mh-cell__value">{{ cell.value }}</span>
                <span v-if="cell.note" class="mh-cell__note" :data-note="cell.note">{{ cell.note }}</span>
              </span>
              <span v-if="row.contexts.length" class="mh-row__deps">
                dependencies: {{ row.contexts.join(', ') }} — ячейки нет
              </span>
            </div>
          </div>
        </template>
      </div>
    </div>

    <div class="mh-split mh-split--bottom">
      <div class="mh-pane">
        <ConsoleView :lines="logShown" label="лог компонентов" empty-label="пока тихо" :min-height="120" />
      </div>
      <div class="mh-pane mh-pane--right">
        <div class="mh-screens">
          <span class="t-label">экран после коммитов</span>
          <span v-if="!screensShown.length" class="mh-wait">коммитов ещё не было</span>
          <span
            v-for="item in screensShown"
            :key="item.n"
            class="mh-screen"
            :class="{ 'mh-screen--torn': item.torn }"
            data-code
          >
            <span class="mh-screen__n">№{{ item.n }}</span>
            <span class="mh-screen__html">{{ item.html }}</span>
            <span v-if="item.torn" class="mh-screen__flag">разрыв</span>
          </span>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="mh-foot">
        <PlayerToolbar
          :counter="frames.length ? counter : '0 / 0'"
          :index="index"
          :playing="playing"
          :speed="speed"
          :speeds="speeds"
          :available="available"
          :at-start="atStart"
          :at-end="atEnd"
          next-label="шаг →"
          @toggle="toggle"
          @scrub="go"
          @speed="setSpeed"
          @prev="prev"
          @next="next"
          @reset="reset"
        />

        <div class="mh-stats">
          <span v-for="item in stats" :key="item.k" class="mh-stat">
            <span class="mh-stat__k">{{ item.k }}</span>
            <span class="mh-stat__v">{{ item.v }}</span>
          </span>
        </div>

        <Md class="mh-note" :text="scenario.note" />
      </div>
    </template>
  </DemoFrame>
</template>

<style scoped>
.mh-bar {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
}
.mh-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.mh-split {
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
}
.mh-split--bottom {
  border-top: 1px solid var(--divider);
}
.mh-pane {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
  border-right: 1px solid var(--divider);
  min-width: 0;
}
.mh-pane--right {
  border-right: 0;
  background: var(--surface-2);
}

.mh-wait {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--dim);
}

.mh-now {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 11px 14px;
  border-radius: var(--r2);
  border: 1px solid var(--border);
  background: var(--surface);
}
.mh-now__phase {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-faint);
}
.mh-now__text {
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.5;
  color: var(--ink);
  overflow-wrap: anywhere;
}
.mh-now[data-phase='render'] {
  border-color: var(--tone-info-line);
  background: var(--tone-info-bg);
}
.mh-now[data-phase='render'] .mh-now__phase {
  color: var(--tone-info-strong);
}
.mh-now[data-phase='commit'] {
  border-color: var(--tone-warn-line);
  background: var(--tone-warn-bg);
}
.mh-now[data-phase='commit'] .mh-now__phase {
  color: var(--tone-warn-strong);
}
.mh-now[data-phase='passive'] {
  border-color: var(--tone-ok-line);
  background: var(--tone-ok-bg);
}
.mh-now[data-phase='passive'] .mh-now__phase {
  color: var(--tone-ok-strong);
}
.mh-now[data-kind='interleave'] {
  border-color: var(--tone-err-line);
  background: var(--tone-err-bg);
}
.mh-now[data-kind='interleave'] .mh-now__phase {
  color: var(--tone-err-strong);
}

.mh-tree {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.mh-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-top: 4px;
  padding-bottom: 4px;
  padding-right: 8px;
  border-radius: var(--r1);
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.45;
  color: var(--text-muted);
  min-width: 0;
}
.mh-row__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
}
.mh-row__label {
  color: var(--ink);
  overflow-wrap: anywhere;
}
.mh-row[data-status='host'] .mh-row__label,
.mh-row[data-status='idle'] .mh-row__label {
  color: var(--text-muted);
}
.mh-row__count {
  color: var(--text-faint);
}
.mh-row--next {
  background: var(--tone-info-bg);
  box-shadow: inset 2px 0 0 var(--accent);
}
.mh-row__detail,
.mh-row__deps {
  padding-left: 14px;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

.mh-status {
  padding: 0 6px;
  border-radius: var(--r-full);
  font-size: var(--fs-3);
  background: var(--surface-3);
  color: var(--text-muted);
}
.mh-status[data-status='render'],
.mh-status[data-status='mount'] {
  background: var(--tone-info-bg);
  color: var(--tone-info-strong);
}
.mh-status[data-status='same'] {
  background: var(--tone-warn-bg);
  color: var(--tone-warn-strong);
}
.mh-status[data-status='skip'],
.mh-status[data-status='descend'] {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-strong);
}

.mh-lane {
  padding: 0 6px;
  border-radius: var(--r-full);
  font-size: var(--fs-3);
  background: var(--tone-err-bg);
  color: var(--tone-err-strong);
}
.mh-lane--child {
  background: var(--surface-3);
  color: var(--text-muted);
}

.mh-cell {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
  padding-left: 14px;
  min-width: 0;
}
.mh-cell__i {
  color: var(--text-faint);
}
.mh-cell__type {
  color: var(--tone-info-text);
}
.mh-cell__value {
  color: var(--ink);
  overflow-wrap: anywhere;
}
.mh-cell__note {
  padding: 0 6px;
  border-radius: var(--r-full);
  font-size: var(--fs-3);
  background: var(--surface-3);
  color: var(--text-muted);
}
.mh-cell__note[data-note='из кеша'],
.mh-cell__note[data-note='та же функция'],
.mh-cell__note[data-note='deps те же'] {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-strong);
}
.mh-cell__note[data-note='пересчитан'],
.mh-cell__note[data-note='новая функция'],
.mh-cell__note[data-note='к запуску'] {
  background: var(--tone-warn-bg);
  color: var(--tone-warn-strong);
}

.mh-screens {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.mh-screen {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--surface);
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.5;
  color: var(--ink);
}
.mh-screen__n {
  color: var(--text-faint);
}
.mh-screen__html {
  overflow-wrap: anywhere;
  min-width: 0;
}
.mh-screen--torn {
  border-color: var(--tone-err-line);
  background: var(--tone-err-bg);
}
.mh-screen__flag {
  padding: 0 6px;
  border-radius: var(--r-full);
  font-size: var(--fs-3);
  background: var(--surface);
  color: var(--tone-err-strong);
}

.mh-foot {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.mh-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}
.mh-stat {
  display: inline-flex;
  align-items: baseline;
  gap: 7px;
  padding: 5px 10px;
  border-radius: var(--r-full);
  background: var(--surface-3);
}
.mh-stat__k {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-muted);
}
.mh-stat__v {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
}
.mh-note {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--prose);
}

@media (max-width: 860px) {
  .mh-split {
    grid-template-columns: 1fr;
  }
  .mh-pane {
    border-right: 0;
    border-bottom: 1px solid var(--divider);
  }
}
</style>
