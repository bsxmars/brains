<script setup lang="ts">
/**
 * Перекатывание версии по шагам: кто из подов жив, кто в сервисе и кто действительно отвечает.
 *
 * Почему три ряда, а не один список подов. Тема держится на том, что «под работает» — это
 * три разных факта: контейнер запущен, под числится в EndpointSlice сервиса и процесс внутри
 * умеет отвечать. Пока они совпадают, разницы не видно; вся авария живёт в моменте, когда
 * второй факт наступил, а третий нет. Списком подов такое не показать — только двумя полосами
 * друг под другом.
 *
 * ⚠️ Кластера в браузере нет, и демо его не изображает. Оно **перематывает** процесс
 * на числах, снятых прогоном в kind, — об этом сказано в подписи под шкалой.
 */
import { computed, watch } from 'vue';
import { usePlayer } from '@/shared/lib/usePlayer';
import { useStepper } from '@/shared/lib/useStepper';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import PlayerToolbar from '@/shared/ui/PlayerToolbar.vue';
import { SegmentedControl } from '@/shared/ui';
import { buildFrames, limits, summarize } from '../model/rollout';
import type { RolloutParams, StrategyPreset } from '../model/types';

const props = defineProps<{
  presets: StrategyPreset[];
  replicas: number;
  /** Часы демо — все три сняты прогоном. */
  clock: Pick<RolloutParams, 'bootSeconds' | 'syncSeconds' | 'terminateSeconds'>;
  foot: string;
}>();

const strategyKey = defineModel<string>('strategy', { default: '' });
const readinessKey = defineModel<string>('readiness', { default: 'yes' });
strategyKey.value ||= props.presets[0].key;

const strategyOptions = computed(() =>
  props.presets.map((preset) => ({ value: preset.key, label: preset.label })),
);
const READINESS_OPTIONS = [
  { value: 'yes', label: 'readiness есть' },
  { value: 'no', label: 'readiness нет' },
];

const preset = computed(
  () => props.presets.find((p) => p.key === strategyKey.value) ?? props.presets[0],
);

const params = computed<RolloutParams>(() => ({
  replicas: props.replicas,
  maxSurge: preset.value.maxSurge,
  maxUnavailable: preset.value.maxUnavailable,
  readiness: readinessKey.value === 'yes',
  ...props.clock,
}));

const frames = computed(() => buildFrames(params.value));
const bounds = computed(() => limits(params.value));
const total = computed(() => summarize(frames.value));

const count = computed(() => frames.value.length);
const stepper = useStepper(count);
const { index, counter, atStart, atEnd, next, prev, reset, go } = stepper;
const { playing, speed, speeds, available, toggle, setSpeed, pause } = usePlayer(stepper, {
  interval: 1300,
});

// Смена стратегии — это другой процесс, а не другая картинка к тому же: продолжать
// проигрывание с середины чужого сценария значило бы показывать подпись не от того шага.
watch([strategyKey, readinessKey], () => {
  pause();
  reset();
});

const frame = computed(() => frames.value[Math.min(index.value, frames.value.length - 1)]);

/** Доля запросов, уходящих в под, который не умеет отвечать. */
const lossPercent = computed(() => {
  const f = frame.value;
  if (!f.endpoints) return 100;
  return Math.round(((f.endpoints - f.serving) / f.endpoints) * 100);
});

const PHASE_LABEL: Record<string, string> = {
  creating: 'ContainerCreating',
  starting: 'Running, не отвечает',
  ready: 'Running · Ready',
  terminating: 'Terminating',
};

/** Поды рисуются в стабильном порядке: иначе кадр к кадру они прыгали бы местами. */
const slots = computed(() => {
  const list = [...frame.value.pods];
  list.sort((a, b) => (a.gen === b.gen ? a.id.localeCompare(b.id) : a.gen === 'old' ? -1 : 1));
  return list;
});
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
        <div class="switches">
          <SegmentedControl
            v-model="strategyKey"
            class="l-pills"
            label="Стратегия"
            :options="strategyOptions"
          />
          <SegmentedControl
            v-model="readinessKey"
            class="l-pills"
            label="Проба готовности"
            :options="READINESS_OPTIONS"
          />
        </div>
      </div>
    </template>

    <div class="body">
      <div class="head">
        <span class="clock">t = {{ frame.t.toFixed(2) }} с</span>
        <span class="strategy">
          maxSurge {{ preset.maxSurge }} · maxUnavailable {{ preset.maxUnavailable }} · живых
          не больше {{ bounds.maxLive }} · доступных не меньше {{ bounds.minAvailable }}
        </span>
      </div>

      <div class="scroll">
        <div class="pods">
          <div v-for="pod in slots" :key="pod.id" class="pod" :data-phase="pod.phase" :data-gen="pod.gen">
            <div class="pod__name">{{ pod.id }}</div>
            <div class="pod__phase">{{ PHASE_LABEL[pod.phase] }}</div>
            <div class="pod__flags">
              <span class="flag" :data-on="pod.inService">в сервисе</span>
              <span class="flag" :data-on="pod.serving">отвечает</span>
            </div>
          </div>
        </div>
      </div>

      <div class="meters">
        <div class="meter">
          <div class="meter__label t-label">в EndpointSlice</div>
          <div class="meter__value">{{ frame.endpoints }}</div>
        </div>
        <div class="meter" :data-alarm="frame.serving < frame.endpoints">
          <div class="meter__label t-label">реально отвечают</div>
          <div class="meter__value">{{ frame.serving }}</div>
        </div>
        <div class="meter">
          <div class="meter__label t-label">Kubernetes считает доступными</div>
          <div class="meter__value">{{ frame.available }}</div>
        </div>
        <div class="meter" :data-alarm="lossPercent > 0">
          <div class="meter__label t-label">запросов в никуда</div>
          <div class="meter__value">{{ lossPercent }}%</div>
        </div>
      </div>

      <Md class="note" :data-tone="frame.tone ?? 'neutral'" :text="frame.note" />

      <div class="verdict" :data-gap="total.trafficGap">
        <template v-if="total.trafficGap">
          Полная замена — {{ total.seconds.toFixed(1) }} с, и в худший момент
          {{ total.worstLossPercent }}% запросов уходило в под, который ещё не умел отвечать.
          Kubernetes при этом не считал ни один из них недоступным.
        </template>
        <template v-else>
          Полная замена — {{ total.seconds.toFixed(1) }} с, ни одного запроса мимо: под попадает
          в сервис только после того, как ответит на пробу.
        </template>
      </div>
    </div>

    <template #footer>
      <div class="disclaimer">{{ foot }}</div>
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

.head {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 12px;
}
.clock {
  padding: 5px 11px;
  border-radius: var(--r-full);
  background: var(--ink);
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--on-ink);
}
.strategy {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-muted);
}

/* Ряд подов шире телефона — прокручиваться должен он, а не страница. */
.scroll {
  min-width: 0;
  overflow-x: auto;
}
.pods {
  display: flex;
  gap: 10px;
  min-width: 520px;
}

.pod {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 12px 10px;
  border-radius: var(--r2);
  background: var(--surface-2);
  transition: all 0.2s;
}
.pod[data-gen='new'] {
  box-shadow: inset 3px 0 0 var(--accent);
}
.pod[data-phase='creating'] {
  background: var(--surface-3);
  color: var(--text-faint);
}
.pod[data-phase='starting'] {
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.pod[data-phase='ready'] {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.pod[data-phase='terminating'] {
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
  opacity: 0.7;
}

.pod__name {
  font-family: var(--mono);
  font-size: var(--fs-2);
}
.pod__phase {
  font-size: var(--fs-3);
  opacity: 0.85;
}
.pod__flags {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 2px;
}
.flag {
  padding: 2px 7px;
  border-radius: var(--r-full);
  background: var(--surface);
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ghost);
}
.flag[data-on='true'] {
  background: var(--ink);
  color: var(--on-ink);
}

.meters {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px;
}
.meter {
  padding: 11px 13px;
  border-radius: var(--r2);
  background: var(--surface-2);
}
.meter[data-alarm='true'] {
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}
.meter__value {
  margin-top: 3px;
  font-family: var(--mono);
  font-size: var(--fs-6);
}

.note {
  padding: 13px 15px;
  border-radius: var(--r2);
  font-size: var(--fs-5);
  line-height: 1.6;
  transition: all 0.2s;
}
.note[data-tone='neutral'] {
  background: var(--surface-2);
  color: var(--prose);
}
.note[data-tone='info'] {
  border: 1px solid var(--tone-info-line);
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
}
.note[data-tone='ok'] {
  border: 1px solid var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.note[data-tone='warn'] {
  border: 1px solid var(--tone-warn-line);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.note[data-tone='err'] {
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}

.verdict {
  padding-top: 14px;
  border-top: 1px solid var(--rule);
  font-size: var(--fs-5);
  line-height: 1.6;
  color: var(--tone-ok-text);
}
.verdict[data-gap='true'] {
  color: var(--tone-err-text);
}

.disclaimer {
  font-size: var(--fs-4);
  line-height: 1.55;
  color: var(--text-muted);
}

@media (max-width: 560px) {
  .pods {
    min-width: 440px;
  }
}
</style>
