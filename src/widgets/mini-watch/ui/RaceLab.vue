<script setup lang="ts">
/**
 * Гонка ответов в `watch`: код из темы, исполненный мини-версией, и «виртуальный сервер»,
 * который отвечает по шагу демо, а не по таймеру.
 *
 * Кадры считает `model/race.ts` — тот же модуль, которым тест сверяет их с настоящим Vue.
 * Компонент только листает готовые кадры: проигрыватель двигает индекс, а не реактивность.
 *
 * ⚠️ **Прогон — в `onMounted`, не в `setup`.** `setup` острова исполняется и на сборке
 * страницы; `new Function` и промисы «сервера» там не нужны никому.
 */
import { computed, onMounted, ref, shallowRef } from 'vue';
import CodeListing from '@/shared/ui/CodeListing.vue';
import ConsoleView from '@/shared/ui/ConsoleView.vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import PlayerToolbar from '@/shared/ui/PlayerToolbar.vue';
import { SegmentedControl } from '@/shared/ui';
import { usePlayer } from '@/shared/lib/usePlayer';
import { useStepper } from '@/shared/lib/useStepper';
import { loadMiniWatch } from '../model/load';
import { runRace } from '../model/race';
import type { RaceFrame, RaceStep } from '../model/types';

const props = defineProps<{ code: string; naive: string; fixed: string; steps: RaceStep[]; note: string }>();

type Variant = 'naive' | 'fixed';
const OPTIONS = [
  { value: 'naive', label: 'без onCleanup' },
  { value: 'fixed', label: 'с onCleanup' },
];

const variant = ref<Variant>('naive');
const frames = shallowRef<Record<Variant, RaceFrame[]> | null>(null);

const stepper = useStepper(computed(() => props.steps.length));
const { index, counter, atStart, atEnd, next, prev, reset, go } = stepper;
const { playing, speed, speeds, available, toggle, setSpeed } = usePlayer(stepper, { interval: 1500 });

onMounted(async () => {
  const [naive, fixed] = await Promise.all([
    runRace(loadMiniWatch(props.code), props.naive, props.steps),
    runRace(loadMiniWatch(props.code), props.fixed, props.steps),
  ]);
  frames.value = { naive, fixed };
});

const lines = computed(() => (variant.value === 'naive' ? props.naive : props.fixed).split('\n'));
const frame = computed(() => frames.value?.[variant.value][index.value] ?? null);
const label = computed(() => props.steps[index.value]?.label ?? '');

/** Совпадает ли то, что на экране, с тем, что спросили последним. */
const verdict = computed(() => {
  const f = frame.value;
  if (!f || f.shown === '—') return 'empty';
  return f.shown === `результаты по «${f.query}»` ? 'ok' : 'stale';
});

const STATE_LABEL = { waiting: 'в пути', answered: 'ответ пришёл' } as const;
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="mw-bar">
        <SegmentedControl v-model="variant" class="l-pills" label="Вариант колбэка" :options="OPTIONS" />
        <PlayerToolbar
          :counter="counter"
          :index="index"
          :total="steps.length"
          :playing="playing"
          :speed="speed"
          :speeds="speeds"
          :available="available"
          :at-start="atStart"
          :at-end="atEnd"
          @toggle="toggle"
          @prev="prev"
          @next="next"
          @reset="reset"
          @scrub="go"
          @speed="setSpeed"
        />
      </div>
    </template>

    <div class="mw-split">
      <div class="mw-pane">
        <CodeListing :lines="lines" label="колбэк watch · исполняется как написан" />
        <Md class="mw-note" :text="note" />
      </div>

      <div class="mw-pane">
        <div class="mw-step">
          <span class="t-label">шаг</span>
          <span class="mw-step__text">{{ label }}</span>
        </div>

        <div v-if="!frame" class="mw-empty">демо ещё не запущено</div>
        <template v-else>
          <div class="mw-screen" :data-verdict="verdict">
            <div class="mw-screen__row">
              <span class="mw-screen__key">строка поиска</span>
              <span class="mw-screen__val">{{ frame.query || '—' }}</span>
            </div>
            <div class="mw-screen__row">
              <span class="mw-screen__key">на экране</span>
              <span class="mw-screen__val">{{ frame.shown }}</span>
            </div>
            <span v-if="verdict === 'stale'" class="mw-flag">ответ не на тот запрос</span>
            <span v-else-if="verdict === 'ok'" class="mw-flag mw-flag--ok">ответ на последний запрос</span>
          </div>

          <div class="mw-requests">
            <span class="t-label">запросы к серверу</span>
            <span v-if="!frame.requests.length" class="mw-empty">пока ни одного</span>
            <div v-for="r in frame.requests" :key="r.id" class="mw-request" :data-state="r.state">
              <span>#{{ r.id }} · «{{ r.query }}»</span>
              <span class="mw-request__state">{{ STATE_LABEL[r.state] }}</span>
            </div>
          </div>
        </template>
      </div>
    </div>

    <template #footer>
      <ConsoleView
        :lines="frame?.log ?? []"
        label="log(…) из колбэка"
        empty-label="колбэк ничего не печатал"
        :min-height="72"
      />
    </template>
  </DemoFrame>
</template>

<style scoped>
.mw-bar {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.mw-split {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr));
  gap: 20px;
  padding: 20px;
}
.mw-pane {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}
.mw-note {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--prose);
}
.mw-step {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.mw-step__text {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
}
.mw-empty {
  font-family: var(--mono);
  font-size: var(--fs-2);
  font-style: italic;
  color: var(--ghost);
}

/* «Экран» приложения: что видит пользователь. Засечка — совпал ли ответ с запросом. */
.mw-screen {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border-radius: var(--r2);
  background: var(--surface-2);
  box-shadow: inset 2px 0 0 var(--tone-info-line);
}
.mw-screen[data-verdict='stale'] {
  background: var(--tone-err-bg);
  box-shadow: inset 2px 0 0 var(--tone-err-line);
}
.mw-screen[data-verdict='ok'] {
  background: var(--tone-ok-bg);
  box-shadow: inset 2px 0 0 var(--tone-ok-line);
}
.mw-screen__row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}
.mw-screen__key {
  font-size: var(--fs-2);
  color: var(--text-faint);
}
.mw-screen__val {
  font-family: var(--mono);
  font-size: var(--fs-3);
  font-weight: 600;
  color: var(--ink);
  overflow-wrap: anywhere;
}
.mw-flag {
  align-self: flex-start;
  padding: 2px 8px;
  border-radius: var(--r-full);
  background: var(--tone-err-chip);
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--tone-err-text);
}
.mw-flag--ok {
  background: var(--tone-ok-chip);
  color: var(--tone-ok-text);
}

.mw-requests {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.mw-request {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  padding: 6px 10px;
  border-radius: var(--r1);
  background: var(--tone-warn-chip);
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--tone-warn-text);
}
.mw-request[data-state='answered'] {
  background: var(--surface-3);
  color: var(--text-muted);
}
.mw-request__state {
  font-size: var(--fs-3);
}
</style>
