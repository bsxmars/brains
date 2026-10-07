<script setup lang="ts">
/**
 * Протокол итерации по шагам — на настоящих итераторах, а не по описанию.
 *
 * Раздел объясняет словами то, что можно выполнить: `for…of` берёт `[Symbol.iterator]()`,
 * потом зовёт `next()`, а на выходе — `return()`. Здесь каждый из этих вызовов сделан
 * по-настоящему, и в журнале стоит то, что ответил движок. Счётчики ведёт сам итератор
 * (`model/protocol.ts`), поэтому «`next()` — 2, `return()` — 1» не подпись, а замер.
 *
 * Главное здесь — третий и четвёртый сценарии. `return()` в уроке заявлен как единственная
 * точка, где итератор освобождает ресурс, и до сих пор это было утверждением: в консоли
 * ничего не появлялось. Теперь `close(file)` печатает настоящий `finally` настоящего
 * генератора — внутри вызова `return()`, до того как вызов вернёт значение.
 *
 * Прогон идёт в `onMounted` и по `watch`, как у `widgets/clone-survival`: логика чистая
 * и в Node бы отработала, но состояние демо принадлежит читателю, а не серверной разметке.
 */
import { computed, onMounted, ref, shallowRef, watch } from 'vue';
import { usePlayer } from '@/shared/lib/usePlayer';
import { useStepper } from '@/shared/lib/useStepper';
import CodeListing from '@/shared/ui/CodeListing.vue';
import ConsoleView from '@/shared/ui/ConsoleView.vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import PlayerToolbar from '@/shared/ui/PlayerToolbar.vue';
import { SegmentedControl } from '@/shared/ui';
import { SCENARIOS, runScenario } from '../model/protocol';
import type { ProtocolRun } from '../model/types';

const props = withDefaults(defineProps<{ foot?: string }>(), { foot: '' });

const picked = ref<string>(SCENARIOS[0].key);
const options = SCENARIOS.map((s) => ({ value: s.key, label: s.label }));
const scenario = computed(() => SCENARIOS.find((s) => s.key === picked.value) ?? SCENARIOS[0]);

// Прогон целиком, одним куском: шаги уже посчитаны, менять внутри нечего — `shallowRef`.
const run = shallowRef<ProtocolRun | null>(null);
const load = () => {
  run.value = runScenario(scenario.value.key);
};

const steps = computed(() => run.value?.steps ?? []);
const total = computed(() => Math.max(1, steps.value.length));

const stepper = useStepper(total);
const { index, counter, atStart, atEnd, next, prev, reset, go } = stepper;
const { playing, speed, speeds, available, toggle, setSpeed } = usePlayer(stepper);

onMounted(load);
watch(picked, () => {
  load();
  reset();
});

const at = computed(() => Math.min(index.value, Math.max(0, steps.value.length - 1)));
const step = computed(() => steps.value[at.value] ?? null);
const finished = computed(() => steps.value.length > 0 && at.value === steps.value.length - 1);

const activeLine = computed(() => step.value?.line ?? -1);
const calledNext = computed(() => step.value?.next ?? 0);
const calledReturn = computed(() => step.value?.ret ?? 0);
const printed = computed(() => step.value?.out ?? []);

/**
 * Что собрал каждый заход. У текущего — то, что собрано **на этом шаге**: иначе прокрутка
 * ползунком показывала бы итог прогона рядом с его серединой.
 */
const passes = computed(() => {
  const current = step.value;
  return (run.value?.passes ?? []).map((pass, i) => {
    if (!current || i > current.pass) return { label: pass.label, got: '…', state: 'next' };
    if (i < current.pass) return { label: pass.label, got: pass.got, state: 'done' };
    return { label: pass.label, got: current.got, state: 'live' };
  });
});

const stepState = (i: number) => (i === at.value ? 'active' : i < at.value ? 'done' : 'next');
const num = (i: number) => String(i + 1).padStart(2, '0');
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="bar">
        <span class="bar__label">сценарий:</span>
        <SegmentedControl v-model="picked" class="l-pills" label="Сценарий итерации" :options="options" />
      </div>
    </template>

    <div class="split">
      <div class="pane">
        <CodeListing :lines="scenario.code" :active="activeLine" :label="scenario.label" />

        <div class="counters">
          <span class="counter">next() · {{ calledNext }}</span>
          <span class="counter" :data-live="calledReturn > 0 ? 'yes' : 'no'">return() · {{ calledReturn }}</span>
          <span class="counters__note">считает сам итератор</span>
        </div>

        <div class="passes">
          <div v-for="(pass, i) in passes" :key="i" class="pass" :data-state="pass.state">
            <span class="pass__label">{{ pass.label }}</span>
            <span class="pass__got">{{ pass.got }}</span>
          </div>
        </div>

        <ConsoleView
          v-if="scenario.prints"
          :lines="printed"
          label="консоль"
          :min-height="52"
          empty-label="ресурс ещё не освобождён"
        />
      </div>

      <div class="pane pane--right">
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
          @scrub="go"
          @speed="setSpeed"
          @prev="prev"
          @next="next"
          @reset="reset"
        />

        <p v-if="!steps.length" class="empty">Протокол выполняется в браузере — сейчас начнём.</p>

        <ol v-else class="steps">
          <li
            v-for="(item, i) in steps"
            :key="i"
            class="step"
            :data-state="stepState(i)"
            :data-tone="i === at ? (item.tone ?? 'plain') : 'plain'"
          >
            <div class="step__head">
              <span class="step__n">{{ num(i) }}</span>
              <span class="step__call">{{ item.call }}</span>
              <span class="step__res">{{ item.result }}</span>
            </div>
            <Md v-if="i === at && item.note" class="step__note" :text="item.note" />
          </li>
        </ol>

        <div class="result">
          <div class="t-label">итог</div>
          <Md
            class="result__box"
            :data-tone="finished && run ? run.tone : 'idle'"
            :text="finished && run ? run.verdict : '…'"
          />
        </div>
      </div>
    </div>

    <template v-if="props.foot" #footer>
      <Md class="iter-protocol-foot" :text="props.foot" />
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
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}

.split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
}
.pane {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  border-right: 1px solid var(--divider);
  min-width: 0;
}
.pane--right {
  border-right: 0;
  background: var(--surface-2);
}

/* Счётчики — замер, а не подпись: их ведёт обёртка итератора, а не этот компонент. */
.counters {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.counter {
  padding: 4px 10px;
  border-radius: var(--r-full);
  background: var(--surface-3);
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
  transition: all 0.2s;
}
/* Ненулевой `return()` — событие: до него ресурс не освобождался. */
.counter[data-live='yes'] {
  background: var(--tone-ok-chip);
  color: var(--tone-ok-strong);
}
.counters__note {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}

.passes {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.pass {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid var(--divider);
  border-radius: var(--r2);
  background: var(--surface);
  transition: all 0.2s;
}
.pass[data-state='next'] {
  opacity: 0.6;
}
.pass[data-state='live'] {
  border-color: var(--tone-info-line);
  background: var(--tone-info-bg);
}
.pass__label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.pass__got {
  margin-left: auto;
  font-family: var(--mono);
  font-size: var(--fs-3);
  font-weight: 600;
  color: var(--ink);
  overflow-wrap: anywhere;
}

.steps {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.step {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 9px 12px;
  border: 1px solid transparent;
  border-radius: var(--r2);
  transition: all 0.18s;
}
.step[data-state='done'] {
  color: var(--text-muted);
}
.step[data-state='next'] {
  color: var(--dim);
  opacity: 0.75;
}
.step[data-state='active'][data-tone='plain'] {
  border-color: var(--border);
  background: var(--surface);
}
.step[data-tone='info'] {
  background: var(--tone-info-bg);
  border-color: var(--tone-info-line);
}
.step[data-tone='ok'] {
  background: var(--tone-ok-bg);
  border-color: var(--tone-ok-line);
}
.step[data-tone='warn'] {
  background: var(--tone-warn-bg);
  border-color: var(--tone-warn-line);
}
.step[data-tone='err'] {
  background: var(--tone-err-bg);
  border-color: var(--tone-err-line);
}

.step__head {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 9px;
}
/* Номер шага гасится прозрачностью поверх приглушённого цвета — два гашения перемножаются,
   поэтому здесь `0.8`, а не `0.55`: ниже номера физически перестают читаться. */
.step__n {
  flex-shrink: 0;
  font-family: var(--mono);
  font-size: var(--fs-2);
  opacity: 0.8;
}
.step__call {
  font-family: var(--mono);
  font-size: var(--fs-3);
  font-weight: 600;
  color: inherit;
}
.step[data-state='active'] .step__call {
  color: var(--ink);
}
.step__res {
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.5;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}
.step[data-state='next'] .step__res {
  color: inherit;
}
.step__note {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--prose);
}
.step[data-tone='warn'] .step__note {
  color: var(--tone-warn-text);
}
.step[data-tone='err'] .step__note {
  color: var(--tone-err-text);
}
.step[data-tone='ok'] .step__note {
  color: var(--tone-ok-text);
}
.step[data-tone='info'] .step__note {
  color: var(--tone-info-text);
}

.empty {
  margin: 0;
  font-size: var(--fs-5);
  font-style: italic;
  color: var(--text-muted);
}

.result {
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.result__box {
  padding: 13px 15px;
  border-radius: var(--r2);
  font-size: var(--fs-5);
  line-height: 1.55;
  transition: all 0.2s;
}
.result__box[data-tone='idle'] {
  border: 1px solid var(--divider);
  background: var(--sunk-dim);
  color: var(--dim);
}
.result__box[data-tone='info'] {
  border: 1px solid var(--tone-info-line);
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
}
.result__box[data-tone='ok'] {
  border: 1px solid var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.result__box[data-tone='warn'] {
  border: 1px solid var(--tone-warn-line);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.result__box[data-tone='err'] {
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}

.iter-protocol-foot {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
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
