<script setup lang="ts">
/**
 * Планировщик: почему несколько записей подряд дают один прогон, и где в этом ряду `nextTick`.
 *
 * Всё настоящее: `ref` из `@vue/reactivity`, три живых `watch` с разными `flush`, настоящий
 * дочерний компонент со своим `onUpdated` и настоящий `nextTick`. Лента событий — не сценарий,
 * а протокол: виджет прогоняет записи, записывает то, что случилось, и в каком порядке,
 * а читатель потом листает результат по шагам.
 *
 * Порядок, который получается, проверен запуском в Node 24.11 (Vue 3.5.42) и совпадает
 * с тем, что демо показывает в браузере:
 *
 *   запись → sync-колбэк → (синхронный код кончился) → pre-колбэк → рендер → post-колбэк
 *   → onUpdated → nextTick
 *
 * Два места, за которые стоит зацепиться. `sync` успевает **до** конца синхронного кода —
 * то есть до строки, следующей за присваиванием. А `nextTick` идёт **после** post-колбэка,
 * потому что post-очередь сливается внутри `flushJobs`, а `nextTick` цепляется за промис
 * этого самого слива.
 *
 * **Почему лог — обычный массив.** Отметку о рендере ставит дочерний компонент прямо из
 * шаблона. Пиши он в реактивное состояние — рендер менял бы то, от чего зависит рендер,
 * и демо про лишние обновления само стало бы источником лишних обновлений. Поэтому события
 * копятся в простом массиве, а на экран переносятся одним присваиванием, когда всё улеглось.
 *
 * **Откуда берётся содержимое очереди.** Наблюдать настоящую `queue` из прикладного кода
 * нечем — она внутренняя. Но её содержимое однозначно восстанавливается из ленты: задание,
 * поставленное записью и ещё не выполненное на текущем шаге, — это событие, которое в ленте
 * стоит дальше. Ровно это и показано. Дедупликация видна тем же способом: три записи, а в
 * ленте один pre, один рендер, один post.
 */
import { nextTick, watch } from 'vue';
import { computed, ref, shallowRef } from '@vue/reactivity';
import CodeListing from '@/shared/ui/CodeListing.vue';
import ConsoleView from '@/shared/ui/ConsoleView.vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import QueueView from '@/shared/ui/QueueView.vue';
import PlayerToolbar from '@/shared/ui/PlayerToolbar.vue';
import { Button, SegmentedControl } from '@/shared/ui';
import { usePlayer } from '@/shared/lib/usePlayer';
import { useStepper } from '@/shared/lib/useStepper';
import type { QueuePhase, QueuePhaseCopy, QueueScenario } from '../model/types';
import QueueCounter from './QueueCounter.vue';

const props = defineProps<{ scenarios: QueueScenario[]; phases: QueuePhaseCopy[] }>();

interface Entry {
  phase: QueuePhase;
  text: string;
}

/** Состояние демо. Один `ref` — и три watcher'а на него. */
const n = ref(0);

const picked = ref('0');
const busy = ref(false);
const timeline = shallowRef<Entry[]>([]);

/** Сюда пишут watcher'ы и компонент. Обычный массив — см. шапку файла. */
let raw: Entry[] = [];

function push(phase: QueuePhase, text: string) {
  raw.push({ phase, text });
}

const options = computed(() => props.scenarios.map((item, i) => ({ value: String(i), label: item.label })));
const scenario = computed(() => props.scenarios[Number(picked.value)] ?? props.scenarios[0]);

// Три watcher'а живут всё время жизни виджета. Созданы синхронно в setup — значит
// принадлежат области видимости компонента и остановятся сами при размонтировании.
watch(n, (value) => push('sync', `flush: 'sync' · колбэк видит n = ${value}`), { flush: 'sync' });
watch(n, (value) => push('pre', `flush: 'pre' · колбэк до рендера, n = ${value}`));
watch(n, (value) => push('post', `flush: 'post' · DOM уже обновлён, n = ${value}`), { flush: 'post' });

const steps = computed(() => Math.max(1, timeline.value.length));
const stepper = useStepper(steps);
const { index, counter, atStart, atEnd, next, prev, reset, go } = stepper;
const { playing, speed, speeds, available, toggle, setSpeed } = usePlayer(stepper);

const shown = computed(() => timeline.value.slice(0, index.value + 1));
const lines = computed(() => shown.value.map((entry) => entry.text));

/** Короткое имя задания для очереди. */
const JOB_LABEL: Partial<Record<QueuePhase, string>> = {
  pre: 'pre-watcher',
  render: 'render компонента',
  post: 'post-watcher',
  updated: 'onUpdated',
};

const ahead = computed(() => timeline.value.slice(index.value + 1));
const pendingMain = computed(() =>
  ahead.value.filter((e) => e.phase === 'pre' || e.phase === 'render').map((e) => JOB_LABEL[e.phase] ?? e.phase),
);
const pendingPost = computed(() =>
  ahead.value.filter((e) => e.phase === 'post' || e.phase === 'updated').map((e) => JOB_LABEL[e.phase] ?? e.phase),
);

/** Счётчики — по всей ленте, а не по показанной части: это итог прогона. */
const stats = computed(() => {
  const count = (phase: QueuePhase) => timeline.value.filter((e) => e.phase === phase).length;
  return [
    { k: 'записей', v: count('write') },
    { k: 'sync-колбэков', v: count('sync') },
    { k: 'pre-колбэков', v: count('pre') },
    { k: 'рендеров', v: count('render') },
    { k: 'post-колбэков', v: count('post') },
    { k: 'onUpdated', v: count('updated') },
  ];
});

const phaseNote = computed(() => {
  const current = shown.value[shown.value.length - 1];
  return props.phases.find((item) => item.phase === current?.phase)?.note ?? '';
});

async function run() {
  if (busy.value) return;
  busy.value = true;

  // Вернуть демо в исходное и дождаться, пока уляжется: всё, что произойдёт при сбросе,
  // к сценарию отношения не имеет и в ленту попасть не должно.
  n.value = 0;
  await nextTick();
  await nextTick();
  raw = [];

  switch (scenario.value.id) {
    case 'once':
      push('write', 'запись: n.value++');
      n.value += 1;
      break;
    case 'thrice':
      for (let i = 1; i <= 3; i += 1) {
        push('write', `запись ${i}: n.value++`);
        n.value += 1;
      }
      break;
    case 'same': {
      push('write', 'запись: n.value = n.value — то же значение');
      const same = n.value;
      n.value = same;
      break;
    }
    case 'sync-storm':
      for (let i = 1; i <= 5; i += 1) {
        push('write', `запись ${i}: n.value++`);
        n.value += 1;
      }
      break;
  }

  push('write', '— синхронный код кончился, дальше микрозадача —');
  nextTick(() => push('tick', 'nextTick · колбэк после слива очереди'));

  await nextTick();
  await nextTick();
  await nextTick();

  timeline.value = [...raw];
  reset();
  busy.value = false;
}
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="bar">
        <SegmentedControl v-model="picked" class="l-pills" label="Сценарий записи" :options="options" />
        <Button variant="primary" :disabled="busy" @click="run">прогнать</Button>
      </div>
    </template>

    <div class="split">
      <div class="pane">
        <CodeListing :lines="scenario.code" label="что выполняется" />
        <QueueCounter :value="n" :report="push" />
      </div>

      <div class="pane pane--right">
        <QueueView
          :items="pendingMain"
          label="очередь заданий · queue"
          tone="info"
          :min-height="64"
          empty-label="пусто"
        />
        <QueueView
          :items="pendingPost"
          label="post-очередь · после патча DOM"
          tone="warn"
          :min-height="48"
          empty-label="пусто"
        />
        <ConsoleView
          :lines="lines"
          label="что уже выполнилось"
          empty-label="нажмите «прогнать»"
          :min-height="120"
        />
      </div>
    </div>

    <template #footer>
      <div class="scheduler-queue-foot">
        <PlayerToolbar
          :counter="timeline.length ? counter : '0 / 0'"
          :index="index"
          :playing="playing"
          :speed="speed"
          :speeds="speeds"
          :available="available"
          :at-start="atStart"
          :at-end="atEnd"
          next-label="следующее событие →"
          @toggle="toggle"
          @scrub="go"
          @speed="setSpeed"
          @prev="prev"
          @next="next"
          @reset="reset"
        />

        <div class="stats">
          <span v-for="item in stats" :key="item.k" class="stat">
            <span class="stat__k">{{ item.k }}</span>
            <span class="stat__v">{{ item.v }}</span>
          </span>
        </div>

        <Md v-if="phaseNote" class="scheduler-queue-foot__note" :text="phaseNote" />
        <Md class="scheduler-queue-foot__note" :text="scenario.note" />
      </div>
    </template>
  </DemoFrame>
</template>

<style scoped>
.bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
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
}

.scheduler-queue-foot {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.stats {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}
.stat {
  display: inline-flex;
  align-items: baseline;
  gap: 7px;
  padding: 5px 10px;
  border-radius: var(--r-full);
  background: var(--surface-3);
}
.stat__k {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-muted);
}
.stat__v {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
}

.scheduler-queue-foot__note {
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
</style>
