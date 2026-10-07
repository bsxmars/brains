<script setup lang="ts">
/**
 * Конвейер ярусов: код поднимается от интерпретатора к оптимизирующему компилятору
 * и срывается обратно.
 *
 * Главное, ради чего демо существует: конвейер — это **петля**, а не прямая. Поэтому
 * подсветка яруса на последних шагах уезжает вниз, а feedback vector продолжает копить
 * формы: профиль расширяется монотонно и сам не «остывает». Лог `--trace-opt` рядом —
 * чтобы в реальном проекте эти строки узнавались.
 */
import { computed } from 'vue';
import { usePlayer } from '@/shared/lib/usePlayer';
import { useStepper } from '@/shared/lib/useStepper';
import ConsoleView from '@/shared/ui/ConsoleView.vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import PlayerToolbar from '@/shared/ui/PlayerToolbar.vue';
import type { Tier, TierStep } from '../model/types';

const props = defineProps<{ tiers: Tier[]; steps: TierStep[] }>();

const stepper = useStepper(props.steps.length);
const { index, counter, atStart, atEnd, next, prev, reset, go } = stepper;
const { playing, speed, speeds, available, toggle, setSpeed } = usePlayer(stepper);
const step = computed(() => props.steps[index.value]);
</script>

<template>
  <DemoFrame>
    <template #toolbar>
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
    </template>

    <div class="split">
      <div class="tiers">
        <div class="t-label">ярусы</div>

        <div
          v-for="(tier, i) in tiers"
          :key="tier.name"
          class="tier"
          :class="{ active: i === step.tier }"
          :data-tone="i === step.tier ? step.tone ?? 'info' : undefined"
        >
          <div class="tier__head">
            <span class="tier__name">{{ tier.name }}</span>
            <span class="tier__tag">{{ tier.tag }}</span>
          </div>
          <div class="tier__what">{{ tier.what }}</div>
        </div>

        <div class="feedback">
          <div class="feedback__label">FEEDBACK VECTOR</div>
          <div class="feedback__value">{{ step.feedback }}</div>
        </div>
      </div>

      <div class="pane">
        <Md class="message" :data-tone="step.tone ?? 'info'" :text="step.message" />
        <ConsoleView
          :lines="step.log"
          label="--trace-opt / --trace-deopt"
          :min-height="80"
          empty-label="движок молчит — компилировать нечего"
        />
      </div>
    </div>
  </DemoFrame>
</template>

<style scoped>
.split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
}

.tiers {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 20px;
  border-right: 1px solid var(--divider);
}

.tier {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 13px 15px;
  border: 1px solid var(--border);
  border-radius: var(--r3);
  background: var(--surface-2);
  transition: all 0.2s;
}
/* Активный ярус — тот, на котором код исполняется сейчас; тон показывает, всё ли хорошо. */
.tier.active[data-tone='info'] {
  border: 1.5px solid var(--accent);
  background: var(--tone-info-bg);
}
.tier.active[data-tone='warn'] {
  border: 1.5px solid var(--bar-amber);
  background: var(--tone-warn-bg);
}
.tier.active[data-tone='err'] {
  border: 1.5px solid var(--tone-err-strong);
  background: var(--tone-err-bg);
}

.tier__head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 10px;
}
.tier__name {
  font-family: var(--mono);
  font-size: var(--fs-4);
  font-weight: 600;
}
.tier__tag {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}
.tier__what {
  font-size: var(--fs-5);
  line-height: 1.45;
  color: var(--text-muted);
}

/* Профиль стоит отдельно от ярусов: он не ярус, а то, что все ярусы читают и пишут. */
.feedback {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-top: 10px;
  padding: 12px 14px;
  border: 1px dashed var(--tone-info-line);
  border-radius: var(--r3);
  background: var(--tone-info-bg);
}
.feedback__label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--tone-info-strong);
}
.feedback__value {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}

.pane {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  background: var(--surface-2);
}

.message {
  padding: 14px 16px;
  border-radius: var(--r2);
  font-size: var(--fs-6);
  line-height: 1.55;
  transition: all 0.2s;
}
.message[data-tone='info'] {
  background: var(--tone-info-bg);
  border: 1px solid var(--tone-info-line);
  color: var(--tone-info-text);
}
.message[data-tone='warn'] {
  background: var(--tone-warn-bg);
  border: 1px solid var(--tone-warn-line);
  color: var(--tone-warn-text);
}
.message[data-tone='err'] {
  background: var(--tone-err-bg);
  border: 1px solid var(--tone-err-line);
  color: var(--tone-err-text);
}

@media (max-width: 720px) {
  .split {
    grid-template-columns: 1fr;
  }
  .tiers {
    border-right: 0;
    border-bottom: 1px solid var(--divider);
  }
}
</style>
