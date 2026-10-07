<script setup lang="ts">
/**
 * Мини-рендерер Vue изнутри: `patchKeyedChildren` по шагам — на рендерере, собранном из той
 * самой строки, что напечатана в теме.
 *
 * Кадры не нарисованы заранее. `model/run.ts` прогоняет обновление списка через мини-рендерер
 * на журналирующем хосте и собирает кадры из событий окна `trace`: указатели, массив
 * `newIndexToOldIndex` и LIS приходят из алгоритма, строка «хост сейчас» — из хоста. Тот же
 * модуль исполняет `tests/unit/vue-patch-internals.test.ts` и сверяет журнал с настоящим Vue.
 * Компонент только переносит кадры на экран.
 *
 * ⚠️ **Прогон — в `onMounted` и по действию, не в `setup`.** `setup` острова исполняется
 * и на сборке страницы; `new Function` и прогон рендерера там не нужны никому.
 *
 * ⚠️ **Результат прогона — в `shallowRef`.** Внутри кадров только готовые массивы и строки;
 * глубокая обёртка Vue над ними ничего бы не дала, кроме лишних прокси.
 */
import { computed, effect, onMounted, ref, shallowReactive, shallowRef, watch } from 'vue';
import { usePlayer } from '@/shared/lib/usePlayer';
import { useStepper } from '@/shared/lib/useStepper';
import ConsoleView from '@/shared/ui/ConsoleView.vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import PlayerToolbar from '@/shared/ui/PlayerToolbar.vue';
import { Button, SegmentedControl } from '@/shared/ui';
import { loadMiniPatch, runKeyed, shuffleKeys } from '../model/run';
import type { KeyedRun, MiniPatch, NewCell, OldCell, PatchScenario } from '../model/types';

const props = defineProps<{ code: string; scenarios: PatchScenario[] }>();

const picked = ref(props.scenarios[0]?.id ?? '');
const options = computed(() => props.scenarios.map((s) => ({ value: s.id, label: s.label })));
const scenario = computed(() => props.scenarios.find((s) => s.id === picked.value) ?? props.scenarios[0]);
const seed = ref(1);

const from = computed(() => scenario.value.from);
const to = computed(() => (scenario.value.shuffle ? shuffleKeys(scenario.value.from, seed.value) : scenario.value.to));

let mini: MiniPatch | null = null;
const run = shallowRef<KeyedRun | null>(null);

const total = computed(() => run.value?.steps.length ?? 1);
const stepper = useStepper(total);
const { index, counter, atStart, atEnd, next, prev, reset, go } = stepper;
const { playing, speed, speeds, available, toggle, setSpeed, pause } = usePlayer(stepper, { interval: 1100 });

function compute() {
  if (!mini) mini = loadMiniPatch(props.code, { effect, shallowReactive });
  pause();
  run.value = runKeyed(mini, from.value, to.value);
  reset();
}

function reshuffle() {
  seed.value += 1;
}

watch([picked, seed], compute);
onMounted(compute);

const step = computed(() => run.value?.steps[Math.min(index.value, total.value - 1)] ?? null);

/** Подпись указателей под ячейкой: `i`, `e1`, `e2` — ровно там, где они стоят в кадре. */
function marks(side: 'old' | 'new', i: number): string {
  const s = step.value;
  if (!s || s.phase === 'done') return '';
  const out: string[] = [];
  if (s.i === i) out.push('i');
  if (side === 'old' && s.e1 === i) out.push('e1');
  if (side === 'new' && s.e2 === i) out.push('e2');
  return out.join(' ');
}

const isFocus = (side: 'old' | 'new', i: number) => step.value?.focus?.side === side && step.value.focus.index === i;

/** Значение `newIndexToOldIndex` под позицией нового списка, если позиция в середине. */
function mapAt(i: number): string {
  const s = step.value;
  if (!s?.map) return '';
  const k = i - s.s;
  return k >= 0 && k < s.map.length ? String(s.map[k]) : '';
}

function inLis(i: number): boolean {
  const s = step.value;
  return Boolean(s?.seq && s.seq.includes(i - s.s));
}

const OLD_LABEL: Record<OldCell, string> = {
  idle: '',
  head: 'с начала',
  tail: 'с конца',
  kept: 'найден',
  removed: 'удалён',
};
const NEW_LABEL: Record<NewCell, string> = {
  idle: '',
  head: 'с начала',
  tail: 'с конца',
  pending: 'ждёт',
  mounted: 'новый',
  moved: 'move',
  stay: 'на месте',
};

const stepOps = computed(() => (step.value?.ops ?? []).map((o) => o.text));
const allOps = computed(() => {
  const r = run.value;
  if (!r) return [];
  return r.steps.slice(0, index.value + 1).flatMap((s) => s.ops.map((o) => o.text));
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="picked" class="l-pills" label="Сценарий" :options="options" />
    </template>

    <div class="mp2-split">
      <div class="mp2-pane">
        <div class="mp2-lists">
          <div class="mp2-row">
            <span class="mp2-row__label">старый</span>
            <div class="mp2-cells">
              <div v-for="(key, i) in from" :key="`o-${key}`" class="mp2-cell">
                <span class="mp2-idx">{{ i }}</span>
                <span
                  class="mp2-key"
                  :data-state="step?.old[i] ?? 'idle'"
                  :data-focus="isFocus('old', i) ? 'yes' : undefined"
                >{{ key }}</span>
                <span class="mp2-tag">{{ OLD_LABEL[step?.old[i] ?? 'idle'] }}</span>
                <span class="mp2-mark">{{ marks('old', i) }}</span>
              </div>
            </div>
          </div>

          <div class="mp2-row">
            <span class="mp2-row__label">новый</span>
            <div class="mp2-cells">
              <div v-for="(key, i) in to" :key="`n-${key}`" class="mp2-cell">
                <span class="mp2-idx">{{ i }}</span>
                <span
                  class="mp2-key"
                  :data-state="step?.next[i] ?? 'idle'"
                  :data-lis="inLis(i) ? 'yes' : undefined"
                  :data-focus="isFocus('new', i) ? 'yes' : undefined"
                >{{ key }}</span>
                <span class="mp2-tag">{{ NEW_LABEL[step?.next[i] ?? 'idle'] }}</span>
                <span class="mp2-mark">{{ marks('new', i) }}</span>
              </div>
            </div>
          </div>

          <div class="mp2-row">
            <span class="mp2-row__label">newIndex→ oldIndex</span>
            <div class="mp2-cells">
              <div v-for="(key, i) in to" :key="`m-${key}`" class="mp2-cell">
                <span class="mp2-map" :data-lis="inLis(i) ? 'yes' : undefined" :data-empty="mapAt(i) ? undefined : 'yes'">
                  {{ mapAt(i) || '·' }}
                </span>
              </div>
            </div>
          </div>

          <div class="mp2-row">
            <span class="mp2-row__label">хост сейчас</span>
            <div class="mp2-cells">
              <span v-for="key in step?.order ?? from" :key="`h-${key}`" class="mp2-host">{{ key }}</span>
            </div>
          </div>
        </div>

        <div class="mp2-legend">
          <span class="mp2-legend__item" data-kind="lis">в LIS — не двигается</span>
          <span class="mp2-legend__item" data-kind="moved">перемещён</span>
          <span class="mp2-legend__item" data-kind="mounted">смонтирован</span>
          <span class="mp2-legend__item" data-kind="removed">удалён</span>
        </div>

        <Md class="mp2-note" :text="scenario.note" />

        <div v-if="scenario.shuffle" class="mp2-shuffle">
          <Button variant="secondary" @click="reshuffle">перетасовать ещё</Button>
          <span class="mp2-shuffle__seed">перетасовка № {{ seed }}</span>
        </div>
      </div>

      <div class="mp2-pane mp2-pane--side">
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

        <div class="mp2-message" :data-phase="step?.phase ?? 'start'">
          {{ step?.message ?? 'сценарий ещё не запущен' }}
        </div>

        <ConsoleView :lines="stepOps" label="операции хоста на этом шаге" empty-label="ни одной" :min-height="64" />

        <div class="mp2-counters">
          <div class="mp2-counter" data-kind="vue">
            <span class="mp2-counter__n">{{ step?.moves ?? 0 }} / {{ run?.moves ?? 0 }}</span>
            <span class="mp2-counter__label">перемещений: с LIS, как в Vue</span>
          </div>
          <div class="mp2-counter">
            <span class="mp2-counter__n">{{ run?.movesWithoutLis ?? 0 }}</span>
            <span class="mp2-counter__label">без LIS: двигать всех сохранённых</span>
          </div>
          <div class="mp2-counter">
            <span class="mp2-counter__n">{{ run?.movesReactRule ?? 0 }}</span>
            <span class="mp2-counter__label">по правилу lastPlacedIndex из React</span>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <ConsoleView
        :lines="allOps"
        label="журнал хоста · обновление с начала до этого шага"
        empty-label="операций пока не было"
        :min-height="96"
      />
    </template>
  </DemoFrame>
</template>

<style scoped>
.mp2-split {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(320px, 100%), 1fr));
  gap: 20px;
  padding: 20px;
}
.mp2-pane {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}
.mp2-pane--side {
  gap: 12px;
}

.mp2-lists {
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-x: auto;
}
.mp2-row {
  display: grid;
  grid-template-columns: 76px minmax(0, 1fr);
  align-items: start;
  gap: 8px;
}
.mp2-row__label {
  padding-top: 18px;
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.3;
  color: var(--text-faint);
}
.mp2-cells {
  display: flex;
  gap: 5px;
}
.mp2-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  width: 36px;
  flex: none;
}
.mp2-idx,
.mp2-tag,
.mp2-mark {
  min-height: 14px;
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.2;
  color: var(--text-faint);
  white-space: nowrap;
}
.mp2-mark {
  font-weight: 600;
  color: var(--tone-info-text);
}

/* Ячейка ключа: заливка — что с узлом стало, засечка — фокус шага, контур — LIS. */
.mp2-key {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: var(--r1);
  background: var(--surface-2);
  font-family: var(--mono);
  font-size: var(--fs-4);
  font-weight: 600;
  color: var(--ink);
  transition: all 0.18s;
}
.mp2-key[data-state='head'],
.mp2-key[data-state='tail'],
.mp2-key[data-state='stay'],
.mp2-key[data-state='kept'],
.mp2-key[data-state='pending'] {
  background: var(--surface-3);
  color: var(--text-muted);
}
.mp2-key[data-state='moved'] {
  background: var(--tone-warn-chip);
  color: var(--tone-warn-text);
}
.mp2-key[data-state='mounted'] {
  background: var(--tone-ok-chip);
  color: var(--tone-ok-text);
}
.mp2-key[data-state='removed'] {
  background: var(--tone-err-chip);
  color: var(--tone-err-text);
  text-decoration: line-through;
}
.mp2-key[data-lis='yes'] {
  background: var(--tone-info-chip);
  color: var(--tone-info-text);
  box-shadow: inset 0 0 0 2px var(--tone-info-line);
}
.mp2-key[data-focus='yes'] {
  box-shadow: 0 0 0 2px var(--accent);
}

.mp2-map {
  display: grid;
  place-items: center;
  width: 32px;
  height: 24px;
  border-radius: var(--r1);
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
  background: var(--surface-2);
}
.mp2-map[data-empty='yes'] {
  background: transparent;
  color: var(--ghost);
}
.mp2-map[data-lis='yes'] {
  background: var(--tone-info-chip);
  color: var(--tone-info-text);
}

.mp2-host {
  display: grid;
  place-items: center;
  width: 32px;
  height: 28px;
  margin-top: 14px;
  border-radius: var(--r1);
  background: var(--ink);
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--on-ink);
}

.mp2-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.mp2-legend__item {
  padding: 3px 8px;
  border-radius: var(--r-full);
  font-family: var(--mono);
  font-size: var(--fs-3);
}
.mp2-legend__item[data-kind='lis'] {
  background: var(--tone-info-chip);
  color: var(--tone-info-text);
}
.mp2-legend__item[data-kind='moved'] {
  background: var(--tone-warn-chip);
  color: var(--tone-warn-text);
}
.mp2-legend__item[data-kind='mounted'] {
  background: var(--tone-ok-chip);
  color: var(--tone-ok-text);
}
.mp2-legend__item[data-kind='removed'] {
  background: var(--tone-err-chip);
  color: var(--tone-err-text);
}

.mp2-note {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--prose);
}
.mp2-shuffle {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}
.mp2-shuffle__seed {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-faint);
}

.mp2-message {
  min-height: 48px;
  padding: 10px 12px;
  border-radius: var(--r2);
  background: var(--tone-info-bg);
  font-size: var(--fs-5);
  line-height: 1.5;
  color: var(--tone-info-text);
  box-shadow: inset 2px 0 0 var(--accent);
}
.mp2-message[data-phase='move'] {
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
  box-shadow: inset 2px 0 0 var(--tone-warn-accent);
}
.mp2-message[data-phase='mount'] {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
  box-shadow: inset 2px 0 0 var(--tone-ok-strong);
}
.mp2-message[data-phase='unmount'] {
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
  box-shadow: inset 2px 0 0 var(--tone-err-strong);
}

.mp2-counters {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 8px;
}
.mp2-counter {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border-radius: var(--r2);
  background: var(--surface-2);
}
.mp2-counter[data-kind='vue'] {
  background: var(--tone-info-bg);
}
.mp2-counter__n {
  font-family: var(--mono);
  font-size: var(--fs-6);
  font-weight: 600;
  color: var(--ink);
}
.mp2-counter__label {
  font-size: var(--fs-2);
  line-height: 1.4;
  color: var(--text-muted);
}
</style>
