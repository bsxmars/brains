<script setup lang="ts">
/**
 * Что кеш решит пересобрать — и во что это обошлось.
 *
 * Демо **перематывает уже случившуюся сборку**, а не изображает живую: Docker в браузере
 * не запустить, и притворяться, что запустили, было бы хуже, чем не делать демо вовсе.
 * Каждая секунда и каждый байт здесь сняты `docker build --progress=plain` и `docker history`
 * на настоящем демоне — это те же числа, что стоят в тексте темы.
 *
 * Два переключателя отвечают на два разных вопроса, и разделены они намеренно. Порядок
 * инструкций — то, что автор Dockerfile выбирает один раз и потом живёт с этим каждую сборку.
 * Изменение — то, что случается по десять раз на дню и от автора уже не зависит. Вся тема
 * про то, что первое решает цену второго.
 *
 * Шаг за шагом, а не сразу целиком: кеш — это цепочка, и её главное свойство в том, что
 * первый промах обрушивает всё, что за ним. Увидеть это можно, только двигаясь по ней подряд.
 */
import { computed, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import StepToolbar from '@/shared/ui/StepToolbar.vue';
import { SegmentedControl } from '@/shared/ui';
import { useStepper } from '@/shared/lib/useStepper';
import type { BuildVariant, ChangeOption } from '../model/types';

const props = defineProps<{
  variants: BuildVariant[];
  changes: ChangeOption[];
  /** Подпись под демо: чем и на чём сняты числа. Разрешена строчная разметка. */
  caption: string;
}>();

const variantKey = ref(props.variants[0].key);
const changeKey = ref(props.changes[0].key);

const variantOptions = computed(() => props.variants.map((v) => ({ value: v.key, label: v.label })));
const changeOptions = computed(() => props.changes.map((c) => ({ value: c.key, label: c.label })));

const variant = computed(
  () => props.variants.find((v) => v.key === variantKey.value) ?? props.variants[0],
);
const change = computed(
  () => props.changes.find((c) => c.key === changeKey.value) ?? props.changes[0],
);
const run = computed(
  () => variant.value.runs.find((r) => r.change === changeKey.value) ?? variant.value.runs[0],
);
const steps = computed(() => run.value.steps);

const { index, counter, atStart, atEnd, next, prev, reset } = useStepper(
  computed(() => steps.value.length),
);

/**
 * Смена сценария начинает сборку заново.
 *
 * Без сброса читатель, переключивший порядок на седьмом шаге, увидел бы седьмой шаг другого
 * прогона — то есть сравнил бы середину одной сборки с серединой другой и решил, что кеш
 * ведёт себя случайно.
 */
watch([variantKey, changeKey], () => reset());

/** Шаг уже случился: до него сборка дошла. */
const passed = (i: number) => i <= index.value;

/** Пройденные шаги — по ним и считается цена. */
const walked = computed(() => steps.value.slice(0, index.value + 1));

const spent = computed(() => walked.value.reduce((sum, s) => sum + s.seconds, 0));
const reused = computed(() => walked.value.filter((s) => s.state === 'cached').length);
const rebuilt = computed(() => walked.value.filter((s) => s.state === 'rebuilt').length);
/** Вес того, что сборка положила в образ поверх базового слоя. */
const weight = computed(() => walked.value.reduce((sum, s) => sum + s.bytes, 0));

const seconds = (value: number) => `${value.toFixed(1)} с`;

/**
 * Байты человеку. Ноль — это «слой без файлов», а не «очень мало»: `WORKDIR`, `ENV` и `CMD`
 * меняют только конфиг образа, и показывать их прочерком честнее, чем «0 Б».
 */
const bytes = (value: number) => {
  if (value === 0) return '—';
  if (value < 1000) return `${value} Б`;
  if (value < 1_000_000) return `${(value / 1000).toFixed(1)} кБ`;
  return `${(value / 1_000_000).toFixed(2)} МБ`;
};
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="bar">
        <span class="t-label">перемотка снятой сборки · не живой Docker</span>
        <div class="switches">
          <SegmentedControl
            v-model="variantKey"
            class="l-pills"
            label="Порядок инструкций"
            :options="variantOptions"
          />
          <SegmentedControl
            v-model="changeKey"
            class="l-pills"
            label="Что изменили перед сборкой"
            :options="changeOptions"
          />
        </div>
      </div>
    </template>

    <div class="body">
      <div class="intro">
        <Md class="intro__note" :text="variant.note" />
        <Md class="intro__note intro__note--change" :text="change.note" />
      </div>

      <div class="split">
        <div class="pane">
          <span class="t-label">Dockerfile</span>
          <ol class="file">
            <li
              v-for="(step, i) in steps"
              :key="`f-${i}`"
              class="line"
              :data-state="passed(i) ? step.state : 'pending'"
              :data-now="i === index"
            >
              <span class="line__text" data-code>{{ step.instruction }}</span>
            </li>
          </ol>
        </div>

        <div class="pane">
          <span class="t-label">слои</span>
          <ol class="layers">
            <li
              v-for="(step, i) in steps"
              :key="`l-${i}`"
              class="layer"
              :data-state="passed(i) ? step.state : 'pending'"
              :data-now="i === index"
            >
              <span class="layer__state">{{
                passed(i) ? (step.state === 'cached' ? 'из кеша' : 'пересобран') : '—'
              }}</span>
              <Md class="layer__what" :text="step.what" />
              <span class="layer__num">{{ passed(i) ? seconds(step.seconds) : '' }}</span>
              <span class="layer__num layer__num--dim">{{ passed(i) ? bytes(step.bytes) : '' }}</span>
            </li>
          </ol>
        </div>
      </div>

      <div class="totals">
        <div class="cell">
          <span class="t-label">потрачено времени</span>
          <span class="cell__value" data-tone="ink">{{ seconds(spent) }}</span>
        </div>
        <div class="cell">
          <span class="t-label">слоёв из кеша</span>
          <span class="cell__value" data-tone="ok">{{ reused }}</span>
        </div>
        <div class="cell">
          <span class="t-label">слоёв пересобрано</span>
          <span class="cell__value" :data-tone="rebuilt ? 'err' : 'ink'">{{ rebuilt }}</span>
        </div>
        <div class="cell">
          <span class="t-label">весит поверх базы</span>
          <span class="cell__value" data-tone="ink">{{ bytes(weight) }}</span>
        </div>
      </div>

      <div class="wall">
        <span class="t-label">вся сборка по часам снаружи</span>
        <span class="wall__value">{{ seconds(run.total) }}</span>
        <span class="wall__note">
          больше суммы шагов: сюда же входят передача контекста и экспорт образа
        </span>
      </div>

      <StepToolbar
        :counter="counter"
        :at-start="atStart"
        :at-end="atEnd"
        next-label="Следующий слой →"
        @prev="prev"
        @next="next"
        @reset="reset"
      />
    </div>

    <template #footer>
      <Md class="disclaimer" :text="caption" />
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
.switches {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 22px 20px;
}

.intro {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.intro__note {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--prose);
}
.intro__note--change {
  color: var(--text-muted);
}

/* Сплит складывается в колонку на узком экране: рядом две колонки моноширинного текста
   не помещаются и утащили бы страницу вбок. */
.split {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr));
  gap: 16px;
}
.pane {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.file,
.layers {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.line {
  padding: 8px 10px;
  border-radius: var(--r1);
  border-left: 3px solid transparent;
  background: var(--surface-2);
  transition:
    background 0.2s,
    border-color 0.2s;
}
.line__text {
  display: block;
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.5;
  overflow-x: auto;
  white-space: pre;
  color: var(--ink);
}

.layer {
  display: grid;
  grid-template-columns: minmax(74px, auto) minmax(0, 1fr) auto auto;
  align-items: baseline;
  gap: 10px;
  padding: 8px 10px;
  border-radius: var(--r1);
  border-left: 3px solid transparent;
  background: var(--surface-2);
  transition:
    background 0.2s,
    border-color 0.2s;
}
.layer__state {
  font-family: var(--mono);
  font-size: var(--fs-3);
  white-space: nowrap;
}
.layer__what {
  font-size: var(--fs-4);
  line-height: 1.45;
  color: var(--prose);
  min-width: 0;
}
.layer__num {
  font-family: var(--mono);
  font-size: var(--fs-2);
  white-space: nowrap;
  color: var(--ink);
}
.layer__num--dim {
  color: var(--text-faint);
}

/* Состояние — это и есть содержание демо, поэтому оно задаёт и цвет, и линию слева. */
.line[data-state='pending'],
.layer[data-state='pending'] {
  opacity: 0.45;
}
.line[data-state='cached'],
.layer[data-state='cached'] {
  border-left-color: var(--tone-ok-line);
  background: var(--tone-ok-bg);
}
.line[data-state='rebuilt'],
.layer[data-state='rebuilt'] {
  border-left-color: var(--tone-err-line);
  background: var(--tone-err-bg);
}
.layer[data-state='cached'] .layer__state {
  color: var(--tone-ok-strong);
}
.layer[data-state='rebuilt'] .layer__state {
  color: var(--tone-err-strong);
}
.layer[data-state='pending'] .layer__state {
  color: var(--text-faint);
}

.line[data-now='true'],
.layer[data-now='true'] {
  box-shadow: var(--shadow-1);
}

.totals {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(150px, 100%), 1fr));
  gap: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--divider);
}
.cell {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}
.cell__value {
  font-family: var(--mono);
  font-size: var(--fs-6);
  transition: color 0.2s;
}
.cell__value[data-tone='ink'] {
  color: var(--ink);
}
.cell__value[data-tone='ok'] {
  color: var(--tone-ok-strong);
}
.cell__value[data-tone='err'] {
  color: var(--tone-err-strong);
}

.wall {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 10px;
}
.wall__value {
  font-family: var(--mono);
  font-size: var(--fs-4);
  color: var(--ink);
}
.wall__note {
  font-size: var(--fs-4);
  line-height: 1.5;
  color: var(--text-muted);
}

.disclaimer {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}
</style>
