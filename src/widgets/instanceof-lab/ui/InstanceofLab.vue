<script setup lang="ts">
/**
 * `instanceof` по шагам — на трёх подопытных, и все три отвечает настоящий движок.
 *
 * Раздел утверждает, что оператор не проверяет тип, а вызывает метод. Проверить это на глаз
 * нельзя: «обычный» случай выглядит ровно так, как все и думают, — подъём по цепочке. Поэтому
 * случаи стоят рядом и переключаются одним движением. Во втором цепочки нет вовсе, и `true`
 * приходит **числу**; в третьем цепочка на месте, а звено разъехалось с конструктором.
 *
 * Считает не компонент, а `model/run.ts`: тот же модуль читает юнит-тест. Здесь только показ.
 *
 * Прогон идёт в `onMounted` — до гидратации острова показывается заглушка. Так надо не ради
 * аккуратности: остров сперва рендерится в Node, и выполнять там подопытные классы значило бы
 * считать результат дважды и в разных средах.
 */
import { computed, onMounted, ref, watch } from 'vue';
import { usePlayer } from '@/shared/lib/usePlayer';
import { useStepper } from '@/shared/lib/useStepper';
import CodeListing from '@/shared/ui/CodeListing.vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import PlayerToolbar from '@/shared/ui/PlayerToolbar.vue';
import { SegmentedControl } from '@/shared/ui';
import { CASES, runInstanceof } from '../model/run';
import type { InstanceofCaseKey, InstanceofRun } from '../model/types';

/*
 * ⚠️ Подписи по умолчанию больше нет (2026-10-05). Она говорила «шаг с чтением
 * `Symbol.hasInstance` срабатывает всегда…» — почти дословно `INSTANCEOF_NOTE`, который стоит
 * в теме прямо над демо, — и при выбранном `Even` рассказывала про «обычный класс».
 */
defineProps<{ note?: string }>();

const picked = ref<InstanceofCaseKey>('chain');
const runs = ref<Partial<Record<InstanceofCaseKey, InstanceofRun>>>({});
const run = computed(() => runs.value[picked.value] ?? null);

/** До прогона шагов нет: единица держит степпер в осмысленном состоянии, пока идёт заглушка. */
const total = computed(() => run.value?.steps.length ?? 1);
const stepper = useStepper(total);
const { index, counter, atStart, atEnd, next, prev, reset, go } = stepper;
const { playing, speed, speeds, available, toggle, setSpeed } = usePlayer(stepper);

onMounted(() => {
  const fresh: Partial<Record<InstanceofCaseKey, InstanceofRun>> = {};
  for (const item of CASES) fresh[item.value] = runInstanceof(item.value);
  runs.value = fresh;
  reset();
});

watch(picked, reset);

const at = computed(() => Math.min(index.value, total.value - 1));
const step = computed(() => run.value?.steps[at.value] ?? null);
const activeLine = computed(() => step.value?.line ?? -1);
const finished = computed(() => run.value !== null && at.value >= run.value.steps.length - 1);
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="bar">
        <span class="bar__label">случай:</span>
        <SegmentedControl v-model="picked" class="l-pills" label="Случай instanceof" :options="CASES" />
      </div>
    </template>

    <div class="split">
      <div class="pane">
        <CodeListing v-if="run" :lines="run.code" :active="activeLine" label="что исполнилось" />
        <p v-else class="wait">случай выполняется в вашем браузере…</p>

        <div v-if="run" class="verdict" :data-verdict="String(run.verdict)">
          <span class="verdict__expr">{{ run.expression }}</span>
          <span class="verdict__value">{{ String(run.verdict) }}</span>
        </div>

        <div v-if="run && run.before !== null" class="before">
          <span class="t-label">тот же объект секундой раньше</span>
          <div class="before__row">
            <span class="before__val" data-verdict="true">{{ String(run.before) }}</span>
            <span class="before__arrow">→</span>
            <span class="before__val" :data-verdict="String(run.verdict)">{{ String(run.verdict) }}</span>
          </div>
        </div>

        <div v-if="run" class="facts">
          <div class="fact">
            <span class="fact__k">собственный Symbol.hasInstance</span>
            <span class="fact__v" :data-on="String(run.ownHasInstance)">{{ run.ownHasInstance ? 'есть' : 'нет' }}</span>
          </div>
          <div class="fact">
            <span class="fact__k">обход цепочки</span>
            <span class="fact__v" :data-on="String(run.walked)">{{ run.walked ? 'был' : 'не запускался' }}</span>
          </div>
        </div>

        <div v-if="run && run.errorName" class="err">
          <span class="err__name">{{ run.errorName }}</span>
          <span class="err__text">{{ run.error }}</span>
          <Md class="err__why" text="Так ответила бы вторая строка, если объявить `Legacy` **классом** — `class Legacy {}`: у класса `prototype` защищён от записи, и в модуле это ошибка. Подменить его можно только у старой функции-конструктора, поэтому случай построен на ней." />
        </div>
      </div>

      <div class="pane pane--right">
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

        <div class="probe">
          <span class="t-label">в руках у алгоритма</span>
          <div class="probe__box" :data-match="step ? String(step.match) : 'null'">{{ step ? step.probe : '…' }}</div>
        </div>

        <ol v-if="run" class="steps">
          <li
            v-for="(item, i) in run.steps"
            :key="i"
            class="step"
            :data-state="i === at ? 'active' : i < at ? 'done' : 'next'"
            :data-tone="i === at ? item.tone : undefined"
          >
            <span class="step__n">{{ String(i + 1).padStart(2, '0') }}</span>
            <Md as="span" :text="item.text" />
          </li>
        </ol>

        <div v-if="run" class="result">
          <span class="t-label">итог</span>
          <Md class="result__box" :data-tone="finished ? run.tone : 'idle'" :text="finished ? run.result : '…'" />
        </div>
      </div>
    </div>

    <template v-if="note" #footer>
      <Md class="instanceof-lab-foot" :text="note" />
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

.wait {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--dim);
}

/* Вердикт настоящего оператора — не пересказ шагов, а второй, независимый ответ. */
.verdict {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  padding: 13px 15px;
  border-radius: var(--r2);
  border: 1px solid var(--border);
  background: var(--surface);
}
.verdict__expr {
  font-family: var(--mono);
  font-size: var(--fs-4);
  color: var(--ink);
}
.verdict__value {
  padding: 3px 11px;
  border-radius: var(--r-full);
  font-family: var(--mono);
  font-size: var(--fs-4);
  font-weight: 600;
}
.verdict[data-verdict='true'] {
  border-color: var(--tone-ok-line);
  background: var(--tone-ok-bg);
}
.verdict[data-verdict='true'] .verdict__value {
  background: var(--tone-ok-chip);
  color: var(--tone-ok-strong);
}
.verdict[data-verdict='false'] {
  border-color: var(--tone-err-line);
  background: var(--tone-err-bg);
}
.verdict[data-verdict='false'] .verdict__value {
  background: var(--tone-err-chip);
  color: var(--tone-err-strong);
}

.before {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.before__row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.before__val {
  padding: 4px 12px;
  border-radius: var(--r1);
  font-family: var(--mono);
  font-size: var(--fs-4);
  font-weight: 600;
}
.before__val[data-verdict='true'] {
  background: var(--tone-ok-chip);
  color: var(--tone-ok-strong);
}
.before__val[data-verdict='false'] {
  background: var(--tone-err-chip);
  color: var(--tone-err-strong);
}
.before__arrow {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}

.facts {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.fact {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  padding: 9px 12px;
  border-radius: var(--r2);
  background: var(--sunk-dim);
}
.fact__k {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.fact__v {
  font-family: var(--mono);
  font-size: var(--fs-3);
  font-weight: 600;
  color: var(--ink);
}
/* «Нет собственного метода» и «обход был» — обычный ход дел; обратное и есть находка. */
.fact__v[data-on='true'] {
  color: var(--tone-warn-strong);
}

.err {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 12px 14px;
  border-radius: var(--r2);
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
}
.err__name {
  font-family: var(--mono);
  font-size: var(--fs-3);
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--tone-err-strong);
}
/* Текст исключения дословный: моно и перенос где угодно — он длинный. */
.err__text {
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.5;
  color: var(--tone-err-text);
  overflow-wrap: anywhere;
}
.err__why {
  font-size: var(--fs-4);
  line-height: 1.55;
  color: var(--tone-err-text);
}

.probe {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.probe__box {
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--surface);
  font-family: var(--mono);
  font-size: var(--fs-4);
  color: var(--ink);
  overflow-wrap: anywhere;
  transition: all 0.2s;
}
.probe__box[data-match='true'] {
  border-color: var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.probe__box[data-match='false'] {
  border-color: var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}

.steps {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.step {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 10px 12px;
  border: 1px solid transparent;
  border-radius: var(--r2);
  font-size: var(--fs-5);
  line-height: 1.5;
  transition: all 0.18s;
}
.step[data-state='done'] {
  color: var(--text-muted);
}
.step[data-state='next'] {
  color: var(--dim);
}
.step[data-tone='info'] {
  background: var(--tone-info-bg);
  border-color: var(--tone-info-line);
  color: var(--tone-info-text);
}
.step[data-tone='ok'] {
  background: var(--tone-ok-bg);
  border-color: var(--tone-ok-line);
  color: var(--tone-ok-text);
}
.step[data-tone='warn'] {
  background: var(--tone-warn-bg);
  border-color: var(--tone-warn-line);
  color: var(--tone-warn-text);
}
.step[data-tone='err'] {
  background: var(--tone-err-bg);
  border-color: var(--tone-err-line);
  color: var(--tone-err-text);
}
/* Номер тише текста, но читаемый: два гашения подряд делают его неразличимым. */
.step__n {
  flex-shrink: 0;
  font-family: var(--mono);
  font-size: var(--fs-2);
  opacity: 0.8;
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

.instanceof-lab-foot {
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
