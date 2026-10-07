<script setup lang="ts">
/**
 * Один и тот же конвейер двумя способами: лестницей стадий и графом зависимостей.
 *
 * Переключатель меняет не картинку, а правило, по которому джобу разрешено начаться:
 * «дождись всей предыдущей стадии» против «дождись тех, кого назвал». Длительности джобов
 * одинаковы в обоих режимах и сняты прогоном — меняется только расстановка.
 *
 * ⚠️ Шкала обоих режимов считается моделью (`model/schedule.ts`), а не записью. Почему так —
 * подробно в самом модуле: инструмент, которым снята тема, старт по `needs` не реализует,
 * и брать его шкалу за истину было бы враньём. Подпись под демо говорит об этом прямо.
 */
import { computed, ref } from 'vue';
import { linear } from '@/shared/lib/chart';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import { SegmentedControl } from '@/shared/ui';
import { byNeeds, byStages } from '../model/schedule';
import type { JobSpec } from '../model/types';

const props = defineProps<{
  jobs: JobSpec[];
  stages: string[];
  /** Джоб, по которому считается выигрыш, — обычно последний в конвейере. */
  target: string;
}>();

// Строка, а не литеральный тип: `v-model` переключателя из шва работает со строкой.
const mode = ref('stages');
const MODES = [
  { value: 'stages', label: 'по стадиям' },
  { value: 'needs', label: 'с needs' },
];

const stages = computed(() => byStages(props.jobs, props.stages));
const needs = computed(() => byNeeds(props.jobs, props.stages));
const current = computed(() => (mode.value === 'stages' ? stages.value : needs.value));

/** Домен шкалы общий для обоих режимов: иначе при переключении «быстрее» не видно. */
const span = computed(() => Math.max(stages.value.total, needs.value.total));
const x = computed(() => linear([0, span.value], [0, 100]));

const seconds = (ms: number) => (ms / 1000).toFixed(2).replace('.', ',');

const targetEnd = (schedule: { jobs: { name: string; end: number }[] }) =>
  schedule.jobs.find((job) => job.name === props.target)?.end ?? 0;

const saved = computed(() => targetEnd(stages.value) - targetEnd(needs.value));

const rows = computed(() =>
  current.value.jobs.map((job) => ({
    ...job,
    waitLabel:
      job.waitedFor.length === 0
        ? 'ничего не ждёт'
        : job.stageGated
          ? `ждёт всю стадию перед ${job.stage}`
          : `ждёт: ${job.waitedFor.join(', ')}`,
  })),
);
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="bar">
        <SegmentedControl v-model="mode" label="Чем связаны джобы" :options="MODES" />
        <span class="total">
          конвейер целиком — <b>{{ seconds(current.total) }} с</b>
        </span>
      </div>
    </template>

    <div class="body">
      <div class="lanes">
        <div v-for="job in rows" :key="job.name" class="lane">
          <div class="who">
            <code class="name">{{ job.name }}</code>
            <span class="stage">стадия {{ job.stage }}</span>
          </div>

          <div class="track">
            <span
              class="run"
              :data-gated="job.stageGated ? 'yes' : 'no'"
              :style="`left:${x(job.start)}%;width:${Math.max(x(job.ms), 2)}%`"
            />
            <span v-if="job.start > 0" class="idle" :style="`width:${x(job.start)}%`" />
          </div>

          <span class="wait">{{ job.waitLabel }}</span>
        </div>
      </div>

      <div class="axis">
        <span>0 с</span>
        <span>{{ seconds(span) }} с</span>
      </div>

      <p class="say" :data-tone="mode === 'needs' ? 'ok' : 'warn'">
        <template v-if="mode === 'stages'">
          Каждая стадия начинается по самому долгому джобу предыдущей. Джоб
          <code>{{ props.target }}</code> заканчивается на {{ seconds(targetEnd(stages)) }} с —
          и ждёт он при этом тех, чей результат ему не нужен.
        </template>
        <template v-else>
          Джоб ждёт только названных в <code>needs</code>. Тот же
          <code>{{ props.target }}</code> заканчивается на {{ seconds(targetEnd(needs)) }} с,
          то есть на {{ seconds(saved) }} с раньше, — а долгий сосед всё ещё работает рядом.
        </template>
      </p>
    </div>

    <template #footer>
      <div class="disclaimer">
        Длительности джобов <b>сняты прогоном</b> (<code>gitlab-ci-local</code> 4.75.1, образ
        <code>alpine:3</code>), расстановка по времени — <b>расчёт по правилам GitLab</b>, а не
        запись. Так сделано намеренно: инструмент, которым снята тема, джоб с непустым
        <code>needs</code> всё равно откладывает до конца стадии (в замере джоб с
        <code>needs: [fast]</code> прождал соседа 21 с), поэтому его шкала показала бы не
        поведение GitLab, а собственное ограничение. Расчёт закреплён
        <code>tests/unit/gitlab-ci.test.ts</code>.
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
.total {
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.total b {
  font-family: var(--mono);
  color: var(--ink);
}

.body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 22px 20px;
  min-width: 0;
}

.lanes {
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.lane {
  display: grid;
  grid-template-columns: minmax(120px, 0.6fr) minmax(0, 2fr) minmax(130px, 0.7fr);
  align-items: center;
  gap: 12px;
}
@media (max-width: 720px) {
  .lane {
    grid-template-columns: minmax(0, 1fr);
    gap: 4px;
  }
}

.who {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.name {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
}
.stage {
  font-size: var(--fs-3);
  color: var(--text-faint);
}

.track {
  position: relative;
  height: 22px;
  border-radius: var(--r-full);
  background: var(--surface-2);
  min-width: 0;
}
.idle {
  position: absolute;
  top: 50%;
  left: 0;
  height: 2px;
  background: var(--border);
  transform: translateY(-50%);
  transition: width 0.25s;
}
.run {
  position: absolute;
  top: 0;
  height: 100%;
  border-radius: var(--r-full);
  background: var(--bar-violet);
  transition: all 0.25s;
}
.run[data-gated='yes'] {
  background: var(--bar-amber);
}

.axis {
  display: flex;
  justify-content: space-between;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}

.wait {
  font-size: var(--fs-3);
  color: var(--text-muted);
}

.say {
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--r2);
  font-size: var(--fs-2);
  line-height: 1.55;
}
.say code {
  font-family: var(--mono);
}
.say[data-tone='warn'] {
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.say[data-tone='ok'] {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}

.disclaimer {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}

/* Код внутри мелкой подписи: базовое `code { font-size: .86em }` уводило его ниже 11px.
   Пол — ступень `--fs-2`. */
.say :deep(code) {
  font-size: max(0.86em, var(--fs-2));
}
</style>
