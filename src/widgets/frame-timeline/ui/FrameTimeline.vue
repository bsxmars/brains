<script setup lang="ts">
/**
 * Кадр по шагам — на одной дорожке времени.
 *
 * Урок объясняет кадр как **последовательность во времени**, поэтому и картинка здесь одна:
 * шкала от vsync до vsync, а фазы — отрезки на ней. Список фаз столбиком этого не показал бы:
 * из него не видно ни того, что `requestIdleCallback` и растеризация идут одновременно,
 * ни того, сколько от бюджета уже съела задача, когда рендер-фаза только начинается.
 *
 * Последний шаг сценария — кадр, которого не было: rendering opportunity наступила, а рисовать
 * нечего. Дорожка гаснет пунктиром, и это единственный способ показать «не случилось» на шкале,
 * где всё остальное случается.
 *
 * ⚠️ Длительности отрезков модельные — порядок величин, а не замер. Настоящее число здесь одно:
 * сам бюджет, 1000 / 60 ≈ 16.7 мс.
 */
import { computed } from 'vue';
import { usePlayer } from '@/shared/lib/usePlayer';
import { useStepper } from '@/shared/lib/useStepper';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import PlayerToolbar from '@/shared/ui/PlayerToolbar.vue';
import type { FramePhase, FrameStep } from '../model/types';

const props = defineProps<{
  phases: FramePhase[];
  steps: FrameStep[];
  /** Длина шкалы, мс. */
  budget: number;
}>();

const stepper = useStepper(props.steps.length);
const { index, counter, atStart, atEnd, next, prev, reset, go } = stepper;
const { playing, speed, speeds, available, toggle, setSpeed } = usePlayer(stepper);
const step = computed(() => props.steps[index.value]);

const lanes = computed(() => [
  { key: 'main', label: 'main thread', items: props.phases.filter((p) => p.lane === 'main') },
  {
    key: 'compositor',
    label: 'compositor · raster · GPU',
    items: props.phases.filter((p) => p.lane === 'compositor'),
  },
]);

/** Фазы, о которых шаг говорит прямо сейчас. */
const active = computed(() => new Set(step.value.phases));

/** Всё, что уже прошло: фазы предыдущих шагов. */
const passed = computed(() => {
  const seen = new Set<string>();
  for (let i = 0; i < index.value; i += 1) {
    for (const id of props.steps[i].phases) seen.add(id);
  }
  return seen;
});

function state(phase: FramePhase): 'active' | 'done' | 'idle' | 'skipped' {
  if (active.value.has(phase.id)) return 'active';
  if (step.value.skipped) return 'skipped';
  return passed.value.has(phase.id) ? 'done' : 'idle';
}

const pct = (ms: number) => (ms / props.budget) * 100;

/** Деления шкалы — те же четверти, что рисует сетка дорожки. */
const ticks = computed(() =>
  [0, 1, 2, 3, 4].map((i) => ((props.budget * i) / 4).toFixed(1).replace('.0', '')),
);
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
          @toggle="toggle"
          @scrub="go"
          @speed="setSpeed"
          @prev="prev"
          @next="next"
          @reset="reset"
        />
        <span class="t-label">один кадр · {{ budget }} мс при 60 Гц</span>
      </div>
    </template>

    <div class="body">
      <div class="scroll">
        <div class="chart">
          <div class="vsync">
            <span class="vsync__mark">▼ vsync</span>
            <span class="vsync__mark">▼ vsync</span>
          </div>

          <div v-for="lane in lanes" :key="lane.key" class="lane">
            <div class="lane__name t-label">{{ lane.label }}</div>
            <div class="lane__track">
              <span
                v-for="phase in lane.items"
                :key="phase.id"
                class="phase"
                :data-tone="phase.tone"
                :data-state="state(phase)"
                :style="`left:${pct(phase.at)}%;width:${pct(phase.ms)}%`"
              >
                <span class="phase__label">{{ phase.label }}</span>
              </span>
            </div>
          </div>

          <div class="axis">
            <span v-for="tick in ticks" :key="tick">{{ tick }}</span>
          </div>
        </div>
      </div>

      <div class="info">
        <div class="where">{{ step.where }}</div>
        <Md class="title" :text="step.title" />
        <Md class="message" :data-tone="step.tone ?? 'neutral'" :text="step.message" />
      </div>
    </div>

    <template #footer>
      <div class="disclaimer">
        Длительности отрезков модельные: это порядки величин, чтобы картинка читалась, а не замер
        конкретной страницы. Не выдумано здесь одно число — бюджет кадра, 1000 / 60 ≈ {{ budget }} мс.
        Порядок шагов — из HTML Standard, §8.6 «update the rendering»; сверяйте его со спекой
        на день чтения, а не с этой дорожкой.
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
  gap: 20px;
  padding: 22px 20px;
}

/* Дорожка длиннее телефона, и прокручиваться должна она, а не страница. */
.scroll {
  min-width: 0;
  overflow-x: auto;
}
.chart {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 620px;
}

.vsync {
  display: flex;
  justify-content: space-between;
  padding-left: 132px;
}
.vsync__mark {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--tone-warn-accent);
}

.lane {
  display: grid;
  grid-template-columns: 120px minmax(0, 1fr);
  gap: 12px;
  align-items: center;
}
.lane__name {
  text-align: end;
}

/* Сетка четвертями бюджета — та же, что подписана на оси. */
.lane__track {
  position: relative;
  height: 30px;
  border-radius: var(--r1);
  background: var(--surface-2);
  background-image: repeating-linear-gradient(
    to right,
    var(--rule) 0 1px,
    transparent 1px 25%
  );
}

.phase {
  position: absolute;
  top: 3px;
  bottom: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
  border-radius: var(--r1);
  overflow: hidden;
  transition: all 0.2s;
}
.phase__label {
  font-family: var(--mono);
  /* `--fs-2`, а не `--fs-3`: подпись живёт внутри отрезка фиксированной ширины (строки YAML — в колонке), и ступень крупнее обрезала бы её сильнее, чем мелкий кегль мешал читать. */
  font-size: var(--fs-2);
  white-space: nowrap;
}

.phase[data-tone='ink'] {
  --phase-bg: var(--ink);
  --phase-fg: var(--on-ink);
}
.phase[data-tone='info'] {
  --phase-bg: var(--tone-info-chip);
  --phase-fg: var(--tone-info-text);
}
.phase[data-tone='warn'] {
  --phase-bg: var(--tone-warn-chip);
  --phase-fg: var(--tone-warn-text);
}
.phase[data-tone='ok'] {
  --phase-bg: var(--tone-ok-chip);
  --phase-fg: var(--tone-ok-text);
}
.phase[data-tone='dim'] {
  --phase-bg: var(--surface-3);
  --phase-fg: var(--text-muted);
}

/* Ещё не дошли: место занято, но пустое. */
.phase[data-state='idle'] {
  background: var(--sunk-dim);
  color: var(--ghost);
}
.phase[data-state='done'] {
  background: var(--phase-bg);
  color: var(--phase-fg);
  opacity: 0.5;
}
.phase[data-state='active'] {
  background: var(--phase-bg);
  color: var(--phase-fg);
  box-shadow: var(--shadow-1);
}
/* Кадра не было: отрезок остаётся на месте пунктиром — «здесь ничего не случилось». */
.phase[data-state='skipped'] {
  background: transparent;
  border: 1px dashed var(--border-strong);
  color: var(--ghost);
}

.axis {
  display: flex;
  justify-content: space-between;
  padding-left: 132px;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--dim);
}

.info {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.where {
  align-self: flex-start;
  padding: 7px 11px;
  border-radius: var(--r-full);
  background: var(--surface-3);
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.title {
  font-size: var(--fs-7);
  line-height: 1.35;
  color: var(--ink);
}
.message {
  padding: 14px 16px;
  border-radius: var(--r2);
  font-size: var(--fs-6);
  line-height: 1.6;
  transition: all 0.2s;
}
.message[data-tone='neutral'] {
  background: var(--surface-2);
  color: var(--prose);
}
.message[data-tone='info'] {
  border: 1px solid var(--tone-info-line);
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
}
.message[data-tone='ok'] {
  border: 1px solid var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.message[data-tone='warn'] {
  border: 1px solid var(--tone-warn-line);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.message[data-tone='err'] {
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}

.disclaimer {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}

/* На узком экране подпись дорожки встаёт над ней: 120px слева там дороже, чем строка сверху. */
@media (max-width: 560px) {
  .lane {
    grid-template-columns: minmax(0, 1fr);
    gap: 4px;
  }
  .lane__name {
    text-align: start;
  }
  .vsync,
  .axis {
    padding-left: 0;
  }
}
</style>
