<script setup lang="ts">
/**
 * Мини-рендерер темы «React изнутри» по шагам: два дерева файберов, текущая единица работы,
 * хуки каждого файбера, журнал операций хоста и лог компонентов.
 *
 * Ничего заготовленного здесь нет. Код рендерера приходит пропом — это `MINI_REACT_CODE`,
 * та же строка, что напечатана в теме и исполняется тестом, — и `model/session.ts` гоняет его
 * в браузере читателя на выбранном сценарии, записывая протокол. Кнопка действия выполняет
 * настоящий `setState` и дописывает протокол; «шаг» листает то, что записано.
 *
 * Сессия и её массивы живут **вне реактивности**: запись идёт из глубины рендерера, и держать
 * её в `ref` значило бы писать в реактивное состояние из кода, который Vue не контролирует.
 * На экран протокол переносится одним присваиванием в `shallowRef` после прогона.
 *
 * Прогон — в `onMounted`, а не в `setup`: остров сперва рендерится на сервере, и исполнять
 * там рендерер незачем — читатель всё равно увидит только результат гидратации.
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
import { createSession, type Session } from '../model/session';
import type { FramePhase, MiniFrame, MiniScenario } from '../model/types';

const props = defineProps<{ code: string; scenarios: MiniScenario[] }>();

/** Сколько последних строк журнала держать на экране: остальное — счётчиком сверху. */
const TAIL = 9;

const PHASE_LABEL: Record<FramePhase, string> = {
  event: 'вне рендера',
  render: 'render-фаза',
  commit: 'commit',
  passive: 'useEffect',
};

const picked = ref(props.scenarios[0]?.key ?? '');
const options = computed(() => props.scenarios.map((item) => ({ value: item.key, label: item.label })));
const scenario = computed(() => props.scenarios.find((item) => item.key === picked.value) ?? props.scenarios[0]);

let session: Session | null = null;
const frames = shallowRef<MiniFrame[]>([]);
const ops = shallowRef<string[]>([]);
const logs = shallowRef<string[]>([]);
const failure = ref('');

const total = computed(() => Math.max(1, frames.value.length));
const stepper = useStepper(total);
const { index, counter, atStart, atEnd, next, prev, reset, go } = stepper;
const { playing, speed, speeds, available, toggle, setSpeed, pause } = usePlayer(stepper, { interval: 700 });

const frame = computed<MiniFrame | null>(() => frames.value[index.value] ?? null);

/** Копии массивов сессии: сама сессия нереактивна, экран получает снимок. */
const publish = () => {
  if (!session) return;
  frames.value = [...session.frames];
  ops.value = [...session.ops];
  logs.value = [...session.logs];
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
  reset();
};

const fire = () => {
  const action = scenario.value.action;
  if (!session || !action) return;
  pause();
  const from = session.act(action.name);
  publish();
  go(from);
};

onMounted(start);
watch(picked, start);

const journalShown = computed(() => {
  const count = frame.value?.ops ?? 0;
  const lines = ops.value.slice(0, count);
  const hidden = Math.max(0, lines.length - TAIL);
  return hidden ? [`… выше ещё ${hidden}`, ...lines.slice(-TAIL)] : lines;
});
const logShown = computed(() => {
  const count = frame.value?.logs ?? 0;
  const lines = logs.value.slice(0, count);
  const hidden = Math.max(0, lines.length - TAIL);
  return hidden ? [`… выше ещё ${hidden}`, ...lines.slice(-TAIL)] : lines;
});

const stats = computed(() => [
  { k: 'вызовов компонентов', v: frame.value?.calls ?? 0 },
  { k: 'коммитов', v: frame.value?.commits ?? 0 },
  { k: 'операций хоста', v: frame.value?.ops ?? 0 },
]);

const codeLines = computed(() => scenario.value.code.split('\n'));
const indent = (depth: number) => `padding-left:${8 + depth * 14}px`;
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="mf-bar">
        <SegmentedControl v-model="picked" class="l-pills" label="Сценарий" :options="options" />
        <Button v-if="scenario.action" variant="primary" :disabled="!session" @click="fire">
          {{ scenario.action.label }}
        </Button>
      </div>
    </template>

    <div class="mf-split">
      <div class="mf-pane">
        <CodeListing :lines="codeLines" label="сценарий — исполняется как есть" />
      </div>

      <div class="mf-pane mf-pane--right">
        <p v-if="failure" class="mf-wait">рендерер упал: {{ failure }}</p>
        <p v-else-if="!frame" class="mf-wait">рендерер запускается в вашем браузере…</p>

        <template v-else>
          <div class="mf-now" :data-phase="frame.phase">
            <span class="mf-now__phase">{{ PHASE_LABEL[frame.phase] }}</span>
            <span class="mf-now__text">{{ frame.text }}</span>
          </div>

          <div class="mf-trees">
            <div class="mf-tree">
              <div class="t-label">current — на экране</div>
              <div v-if="!frame.current.length" class="mf-empty">пусто: ещё ничего не закоммичено</div>
              <div
                v-for="row in frame.current"
                :key="`c-${row.id}`"
                class="mf-row"
                :class="{ 'mf-row--gone': row.flags.includes('Deletion') }"
                :style="indent(row.depth)"
              >
                <span class="mf-row__head">
                  <span class="mf-row__id">#{{ row.id }}</span>
                  <span class="mf-row__label">{{ row.label }}</span>
                  <span v-if="row.alt" class="mf-row__alt">↔ #{{ row.alt }}</span>
                  <span v-for="flag in row.flags" :key="flag" class="mf-flag" :data-flag="flag">{{ flag }}</span>
                </span>
                <span v-for="(hook, i) in row.hooks" :key="i" class="mf-hook">{{ hook }}</span>
              </div>
            </div>

            <div class="mf-tree mf-tree--wip">
              <div class="t-label">work-in-progress</div>
              <div v-if="!frame.wip.length" class="mf-empty">нет: рендер не идёт</div>
              <div
                v-for="row in frame.wip"
                :key="`w-${row.id}`"
                class="mf-row"
                :class="{ 'mf-row--next': row.next }"
                :style="indent(row.depth)"
              >
                <span class="mf-row__head">
                  <span class="mf-row__id">#{{ row.id }}</span>
                  <span class="mf-row__label">{{ row.label }}</span>
                  <span v-if="row.alt" class="mf-row__alt">↔ #{{ row.alt }}</span>
                  <span v-for="flag in row.flags" :key="flag" class="mf-flag" :data-flag="flag">{{ flag }}</span>
                </span>
                <span v-for="(hook, i) in row.hooks" :key="i" class="mf-hook">{{ hook }}</span>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>

    <div class="mf-split mf-split--bottom">
      <div class="mf-pane">
        <ConsoleView :lines="journalShown" label="журнал хоста" empty-label="операций ещё не было" :min-height="120" />
      </div>
      <div class="mf-pane mf-pane--right">
        <ConsoleView :lines="logShown" label="лог компонентов" empty-label="пока тихо" :min-height="72" />
        <div class="mf-screen">
          <span class="t-label">хост сейчас</span>
          <span class="mf-screen__box" data-code>{{ frame?.html || '(пусто)' }}</span>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="mf-foot">
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

        <div class="mf-stats">
          <span v-for="item in stats" :key="item.k" class="mf-stat">
            <span class="mf-stat__k">{{ item.k }}</span>
            <span class="mf-stat__v">{{ item.v }}</span>
          </span>
        </div>

        <Md class="mf-note" :text="scenario.note" />
      </div>
    </template>
  </DemoFrame>
</template>

<style scoped>
.mf-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}

.mf-split {
  display: grid;
  grid-template-columns: minmax(0, 0.85fr) minmax(0, 1.15fr);
}
.mf-split--bottom {
  border-top: 1px solid var(--divider);
}
.mf-pane {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
  border-right: 1px solid var(--divider);
  min-width: 0;
}
.mf-pane--right {
  border-right: 0;
  background: var(--surface-2);
}

.mf-wait {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--dim);
}

.mf-now {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 11px 14px;
  border-radius: var(--r2);
  border: 1px solid var(--border);
  background: var(--surface);
}
.mf-now__phase {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-faint);
}
.mf-now__text {
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.5;
  color: var(--ink);
  overflow-wrap: anywhere;
}
.mf-now[data-phase='render'] {
  border-color: var(--tone-info-line);
  background: var(--tone-info-bg);
}
.mf-now[data-phase='render'] .mf-now__phase {
  color: var(--tone-info-strong);
}
.mf-now[data-phase='commit'] {
  border-color: var(--tone-warn-line);
  background: var(--tone-warn-bg);
}
.mf-now[data-phase='commit'] .mf-now__phase {
  color: var(--tone-warn-strong);
}
.mf-now[data-phase='passive'] {
  border-color: var(--tone-ok-line);
  background: var(--tone-ok-bg);
}
.mf-now[data-phase='passive'] .mf-now__phase {
  color: var(--tone-ok-strong);
}

.mf-trees {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
}
.mf-tree {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.mf-empty {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--dim);
}

.mf-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-top: 3px;
  padding-bottom: 3px;
  padding-right: 8px;
  border-radius: var(--r1);
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.45;
  color: var(--text-muted);
  min-width: 0;
}
.mf-row__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
}
.mf-row__id {
  color: var(--text-faint);
}
.mf-row__label {
  color: var(--ink);
  overflow-wrap: anywhere;
}
.mf-row__alt {
  color: var(--text-faint);
}
.mf-row--next {
  background: var(--tone-info-bg);
  box-shadow: inset 2px 0 0 var(--accent);
}
.mf-row--next .mf-row__label {
  color: var(--tone-info-text);
  font-weight: 600;
}
.mf-row--gone .mf-row__label {
  text-decoration: line-through;
  color: var(--tone-err-text);
}
.mf-hook {
  padding-left: 14px;
  color: var(--tone-info-text);
  overflow-wrap: anywhere;
}

.mf-flag {
  padding: 0 6px;
  border-radius: var(--r-full);
  font-size: var(--fs-3);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-strong);
}
.mf-flag[data-flag='Update'] {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-strong);
}
.mf-flag[data-flag='Deletion'] {
  background: var(--tone-err-bg);
  color: var(--tone-err-strong);
}

.mf-screen {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.mf-screen__box {
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

.mf-foot {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.mf-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}
.mf-stat {
  display: inline-flex;
  align-items: baseline;
  gap: 7px;
  padding: 5px 10px;
  border-radius: var(--r-full);
  background: var(--surface-3);
}
.mf-stat__k {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-muted);
}
.mf-stat__v {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
}
.mf-note {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--prose);
}

@media (max-width: 860px) {
  .mf-split {
    grid-template-columns: 1fr;
  }
  .mf-pane {
    border-right: 0;
    border-bottom: 1px solid var(--divider);
  }
}
@media (max-width: 520px) {
  .mf-trees {
    grid-template-columns: 1fr;
  }
}
</style>
