<script setup lang="ts">
/**
 * Конвейер, разложенный тремя способами: пятью шагами, пятью джобами и матрицей.
 *
 * ⚠️ **Это не живой GitHub Actions.** В браузере конвейер не запустить, и притворяться, будто
 * демо что-то выполняет, было бы враньём. Здесь перематывается **снятая запись**: отметки
 * времени печатали сами шаги (`date +%s%3N`), прогон делал `act` на Docker, логи лежат
 * в `tests/fixtures/actions/` и сверяются тестом. Подпись под демо говорит об этом прямо.
 *
 * Почему демо вообще нужно. Границу между шагами и границу между джобами нельзя увидеть
 * в YAML — обе выглядят как отступ в файле. Видно их только во времени: одна стоит около
 * ста семидесяти миллисекунд и пропускает файлы, другая стоит секунды и не пропускает ничего,
 * кроме объявленных `outputs`. Переключатель показывает три раскладки одной и той же работы.
 */
import { computed, ref, watch } from 'vue';
import { linear } from '@/shared/lib/chart';
import { usePlayer } from '@/shared/lib/usePlayer';
import { useStepper } from '@/shared/lib/useStepper';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import PlayerToolbar from '@/shared/ui/PlayerToolbar.vue';
import { SegmentedControl } from '@/shared/ui';
import { lanes, span } from '../model/timeline';
import type { Boundary, Scenario } from '../model/types';

const props = defineProps<{ scenarios: Scenario[]; versions: string }>();

const mode = ref(props.scenarios[0].id);
const options = props.scenarios.map((s) => ({ value: s.id, label: s.label }));

const scenario = computed<Scenario>(
  () => props.scenarios.find((s) => s.id === mode.value) ?? props.scenarios[0],
);

/** Шагов на один больше, чем в записи: нулевой — событие пришло, но ничего ещё не запущено. */
const total = computed(() => scenario.value.steps.length + 1);

const stepper = useStepper(total);
const { index, counter, atStart, atEnd, next, prev, reset, go } = stepper;
const { playing, speed, speeds, available, toggle, setSpeed, pause } = usePlayer(stepper, {
  interval: 900,
});

// Другая раскладка — другая запись: продолжать с середины значило бы смешать два прогона.
watch(mode, () => {
  pause();
  reset();
});

/** Текущий шаг записи; `null` — нулевой кадр, до первого шага. */
const current = computed(() => (index.value === 0 ? null : scenario.value.steps[index.value - 1]));

/** Модельное «сейчас» — конец последнего случившегося шага. */
const now = computed(() => current.value?.end ?? 0);

const duration = computed(() => Math.max(span(scenario.value.steps), 1));

/** Шкала времени в процентах ширины: демо обязано жить и на телефоне. */
const x = computed(() => linear([0, duration.value], [0, 100]));

const rows = computed(() =>
  lanes(scenario.value.steps).map((job) => ({
    job,
    blocks: scenario.value.steps
      .map((step, i) => ({ ...step, i }))
      .filter((step) => step.job === job),
  })),
);

/** Замеры, уже напечатанные к этому кадру: раньше времени их показывать нечестно. */
const probes = computed(() =>
  scenario.value.steps
    .slice(0, index.value)
    .flatMap((step) => (step.probes ?? []).map((probe) => ({ ...probe, step: step.step }))),
);

const BOUNDARY_LABEL: Record<Boundary, string> = {
  start: 'начало прогона',
  step: 'граница шага',
  job: 'граница джоба',
};

/** Ширина блока в процентах: у шага в несколько миллисекунд она всё равно должна быть видна. */
const width = (start: number, end: number) => Math.max(x.value(end) - x.value(start), 0.9);
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
          next-label="Шаг →"
          @toggle="toggle"
          @scrub="go"
          @speed="setSpeed"
          @prev="prev"
          @next="next"
          @reset="reset"
        />
        <SegmentedControl v-model="mode" class="l-pills" label="Как разложена работа" :options="options" />
      </div>
    </template>

    <div class="body">
      <div class="head">
        <code class="file">{{ scenario.workflow }}</code>
        <span class="clock">{{ now }} мс от первого шага</span>
      </div>

      <p class="note">{{ scenario.note }}</p>

      <div class="lanes">
        <div v-for="row in rows" :key="row.job" class="lane">
          <code class="job">{{ row.job }}</code>

          <div class="track">
            <span
              v-for="block in row.blocks"
              :key="block.step"
              class="block"
              :data-state="block.i < index ? 'done' : block.i === index - 1 ? 'now' : 'ahead'"
              :style="`left:${x(block.start)}%;width:${width(block.start, block.end)}%`"
              :title="`${block.step}: ${block.start}–${block.end} мс`"
            >
              <span class="block__name">{{ block.step }}</span>
            </span>
          </div>
        </div>

        <div class="axis">
          <span>0 мс</span>
          <span>{{ duration }} мс</span>
        </div>
      </div>

      <div class="say" :data-boundary="current?.boundary ?? 'none'">
        <template v-if="current">
          <span class="say__where">
            <code>{{ current.job }}</code> · <code>{{ current.step }}</code>
          </span>
          <span class="say__cross">
            {{ BOUNDARY_LABEL[current.boundary] }}<template v-if="current.boundary !== 'start'">
              · {{ current.cost }} мс ожидания</template>
          </span>
          <span class="say__text">{{ current.say }}</span>
          <span v-if="current.note" class="say__note">{{ current.note }}</span>
        </template>
        <template v-else>
          Событие пришло, прогон создан. Ни одной машины ещё не поднято.
        </template>
      </div>

      <div v-if="probes.length" class="probes">
        <div class="probes__t">Что шаги напечатали про доехавшее состояние</div>
        <div v-for="probe in probes" :key="`${probe.step}-${probe.k}`" class="probe" :data-ok="probe.ok ? 'yes' : 'no'">
          <code class="probe__k">{{ probe.k }}</code>
          <code class="probe__v">{{ probe.v }}</code>
        </div>
      </div>

      <p v-if="atEnd" class="verdict" :data-tone="scenario.verdictTone">{{ scenario.verdict }}</p>
    </div>

    <template #footer>
      <div class="disclaimer">
        Демо <b>перематывает записанный прогон</b>, а не запускает конвейер: GitHub Actions
        в браузере не поднять. Отметки времени печатали сами шаги (<code>date +%s%3N</code>),
        прогон делал <code>act</code> на Docker — {{ versions }}. Запись лежит
        в <code>tests/fixtures/actions/</code> и сверяется тестом, поэтому числа на шкале нельзя
        поправить, не уронив сборку. Локальный прогон — не настоящий раннер GitHub: чего он
        не воспроизводит, перечислено в разделе ниже.
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
  gap: 16px;
  padding: 22px 20px;
  min-width: 0;
}

.head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
}
.file {
  padding: 6px 10px;
  border-radius: var(--r2);
  background: var(--surface-2);
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--ink);
}
.clock {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-faint);
}

.note {
  margin: 0;
  font-size: var(--fs-3);
  line-height: 1.5;
  color: var(--text-muted);
}

.lanes {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.lane {
  display: grid;
  grid-template-columns: minmax(96px, 0.42fr) minmax(0, 3fr);
  align-items: center;
  gap: 12px;
}
.job {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--ink);
  overflow-wrap: anywhere;
}

.track {
  position: relative;
  height: 26px;
  border-radius: var(--r-full);
  background: var(--surface-2);
  min-width: 0;
}
.block {
  position: absolute;
  top: 3px;
  height: 20px;
  min-width: 3px;
  border-radius: var(--r-full);
  background: var(--surface-3);
  transition: all 0.25s;
}
.block[data-state='ahead'] {
  opacity: 0.4;
}
.block[data-state='done'] {
  background: var(--bar-violet);
}
.block[data-state='now'] {
  background: var(--bar-amber);
  box-shadow: var(--shadow-1);
}
.block__name {
  position: absolute;
  left: 0;
  top: 22px;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
  white-space: nowrap;
}

.axis {
  display: flex;
  justify-content: space-between;
  margin-top: 14px;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}

.say {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 12px 14px;
  border-radius: var(--r2);
  background: var(--surface-2);
  font-size: var(--fs-3);
  line-height: 1.5;
  color: var(--prose);
  transition: all 0.25s;
}
.say[data-boundary='job'] {
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.say[data-boundary='step'] {
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
}
.say__where {
  font-family: var(--mono);
  font-size: var(--fs-2);
}
.say__cross {
  font-family: var(--mono);
  font-size: var(--fs-3);
  opacity: 0.85;
}
.say__note {
  font-size: var(--fs-2);
  opacity: 0.85;
}

.probes {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.probes__t {
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.probe {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px 10px;
  padding: 6px 10px;
  border-radius: var(--r2);
  border: 1px solid var(--border);
  min-width: 0;
}
.probe[data-ok='yes'] {
  border-color: var(--tone-ok-line);
  background: var(--tone-ok-bg);
}
.probe[data-ok='no'] {
  border-color: var(--tone-err-line);
  background: var(--tone-err-bg);
}
.probe__k {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--prose);
  overflow-wrap: anywhere;
}
.probe__v {
  font-family: var(--mono);
  font-size: var(--fs-3);
  overflow-wrap: anywhere;
}
.probe[data-ok='yes'] .probe__v {
  color: var(--tone-ok-text);
}
.probe[data-ok='no'] .probe__v {
  color: var(--tone-err-text);
}

.verdict {
  margin: 0;
  padding: 11px 13px;
  border-radius: var(--r2);
  font-size: var(--fs-3);
  line-height: 1.5;
}
.verdict[data-tone='ok'] {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.verdict[data-tone='err'] {
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}

.disclaimer {
  font-size: var(--fs-2);
  line-height: 1.55;
  color: var(--text-muted);
}

/* Код внутри мелкой подписи: базовое `code { font-size: .86em }` уводило его ниже 11px.
   Пол — ступень `--fs-2`. */
.disclaimer :deep(code) {
  font-size: max(0.86em, var(--fs-2));
}
</style>
