<script setup lang="ts">
/**
 * Старт стека: две записи одного и того же прогона, отличающиеся одной строкой конфигурации.
 *
 * ⚠️ **Это не живой докер.** В браузере контейнер не поднять, и притворяться, будто демо
 * что-то запускает, было бы враньём. Здесь перематывается **снятая запись**: события взяты
 * из `docker events`, отметки времени — миллисекунды от команды `up`, фикстуры лежат
 * в `tests/fixtures/compose/` и сверяются тестом. Подпись под демо говорит об этом прямо.
 *
 * Почему демо вообще нужно. Разницу между «сервис запущен» и «сервис готов» нельзя увидеть
 * в конфигурации — она видна только во времени: в одном прогоне приложение стартует раньше,
 * чем база дочитала свои файлы, в другом ждёт ответа пробы. Одна и та же строка `depends_on`
 * даёт оба исхода, и переключатель показывает их рядом.
 */
import { computed, ref, watch } from 'vue';
import { linear } from '@/shared/lib/chart';
import { usePlayer } from '@/shared/lib/usePlayer';
import { useStepper } from '@/shared/lib/useStepper';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import PlayerToolbar from '@/shared/ui/PlayerToolbar.vue';
import { SegmentedControl } from '@/shared/ui';
import { conditionMet, span, stateAt } from '../model/states';
import type { Scenario, ServiceRow, ServiceState, StartupEvent } from '../model/types';

const props = defineProps<{ services: ServiceRow[]; scenarios: Scenario[] }>();

const mode = ref(props.scenarios[0].id);
const options = props.scenarios.map((s) => ({ value: s.id, label: s.label }));

const scenario = computed<Scenario>(
  () => props.scenarios.find((s) => s.id === mode.value) ?? props.scenarios[0],
);

/** Шагов на один больше, чем событий: нулевой — стек ещё не создан. */
const total = computed(() => scenario.value.events.length + 1);

const stepper = useStepper(total);
const { index, counter, atStart, atEnd, next, prev, reset, go } = stepper;
const { playing, speed, speeds, available, toggle, setSpeed, pause } = usePlayer(stepper, {
  interval: 700,
});

// Другой сценарий — другая запись: продолжать с середины значило бы смешать два прогона.
watch(mode, () => {
  pause();
  reset();
});

/** Модельное «сейчас» — отметка последнего случившегося события. */
const now = computed(() => (index.value === 0 ? 0 : scenario.value.events[index.value - 1].at));

const duration = computed(() => Math.max(span(scenario.value.events), 1));

/** Шкала времени в процентах ширины: демо обязано жить и на телефоне. */
const x = computed(() => linear([0, duration.value], [0, 100]));

const current = computed<StartupEvent | null>(() =>
  index.value === 0 ? null : scenario.value.events[index.value - 1],
);

const rows = computed(() =>
  props.services.map((service) => ({
    ...service,
    state: stateAt(scenario.value.events, service.name, now.value),
    marks: scenario.value.events.filter((e) => e.service === service.name),
  })),
);

/**
 * Тон дорожки по состоянию. Он здесь не украшение: «стартует» — это жёлтый, потому что
 * именно в этом состоянии сервис уже считается зависимостью выполненной, но работать
 * ещё не умеет.
 */
const TONE: Record<ServiceState, string> = {
  'нет': 'none',
  'создан': 'none',
  'стартует': 'warn',
  'принимает соединения': 'info',
  healthy: 'ok',
  'вышел': 'ok',
  'упал': 'err',
};

/** Что Compose знает про базу в этот момент — два ответа на два разных условия. */
const knowledge = computed(() => [
  {
    k: 'service_started',
    v: conditionMet(scenario.value.events, 'db', 'service_started', now.value) ? 'да' : 'нет',
    ok: conditionMet(scenario.value.events, 'db', 'service_started', now.value),
  },
  {
    k: 'service_healthy',
    v: conditionMet(scenario.value.events, 'db', 'service_healthy', now.value) ? 'да' : 'нет',
    ok: conditionMet(scenario.value.events, 'db', 'service_healthy', now.value),
  },
]);

const finished = computed(() => atEnd.value);
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
          next-label="Событие →"
          @toggle="toggle"
          @scrub="go"
          @speed="setSpeed"
          @prev="prev"
          @next="next"
          @reset="reset"
        />
        <SegmentedControl v-model="mode" class="l-pills" label="Что стоит в depends_on" :options="options" />
      </div>
    </template>

    <div class="body">
      <div class="head">
        <code class="depends">{{ scenario.depends }}</code>
        <span class="clock">{{ now }} мс от <code>up</code></span>
      </div>

      <div class="lanes">
        <div v-for="row in rows" :key="row.name" class="lane">
          <div class="who">
            <code class="name">{{ row.name }}</code>
            <span class="role">{{ row.role }}</span>
          </div>

          <div class="track">
            <!-- Полоса прожитого времени: до неё сервис ещё ничего не сделал. -->
            <span class="past" :style="`width:${x(now)}%`" />
            <span
              v-for="mark in row.marks"
              :key="`${mark.kind}-${mark.at}`"
              class="mark"
              :data-kind="mark.kind"
              :data-done="mark.at <= now ? 'yes' : 'no'"
              :style="`left:${x(mark.at)}%`"
              :title="`${mark.at} мс · ${mark.label}`"
            />
          </div>

          <span class="state" :data-tone="TONE[row.state]">{{ row.state }}</span>
        </div>

        <div class="axis">
          <span>0 мс</span>
          <span>{{ duration }} мс</span>
        </div>
      </div>

      <div class="know">
        <span class="know__t">Что Compose знает про <code>db</code>:</span>
        <span v-for="item in knowledge" :key="item.k" class="cond" :data-ok="item.ok ? 'yes' : 'no'">
          <code>{{ item.k }}</code>
          <span>{{ item.v }}</span>
        </span>
      </div>

      <p class="say" :data-tone="current?.tone ?? 'none'">
        <template v-if="current">
          <code>{{ current.service }}</code> · {{ current.at }} мс — {{ current.label }}
        </template>
        <template v-else>
          Команда <code>up</code> введена; ни одного контейнера ещё нет.
        </template>
      </p>

      <p v-if="finished" class="verdict" :data-tone="scenario.verdictTone">{{ scenario.verdict }}</p>
    </div>

    <template #footer>
      <div class="disclaimer">
        Демо <b>перематывает записанный прогон</b>, а не запускает докер: в браузере контейнер
        поднять нельзя. Все отметки — события демона (<code>docker events</code>) и строки
        логов самих процессов, снятые на Docker 27.4 и Compose v2.31 на проектах
        <code>{{ scenario.project }}</code>. Запись лежит в <code>tests/fixtures/compose/</code>
        и сверяется тестом, поэтому числа на шкале нельзя поправить, не уронив сборку.
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
.depends {
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

.lanes {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.lane {
  display: grid;
  grid-template-columns: minmax(118px, 0.5fr) minmax(0, 2fr) minmax(112px, 0.6fr);
  align-items: center;
  gap: 12px;
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
.role {
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
.past {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  border-radius: var(--r-full);
  background: var(--surface-3);
  transition: width 0.25s;
}
.mark {
  position: absolute;
  top: 50%;
  width: 10px;
  height: 10px;
  margin-left: -5px;
  border-radius: var(--r-full);
  background: var(--border-strong);
  transform: translateY(-50%);
  transition: all 0.25s;
}
.mark[data-done='no'] {
  opacity: 0.35;
}
.mark[data-kind='start'] {
  background: var(--bar-amber);
}
.mark[data-kind='healthy'] {
  background: var(--bar-green);
}
.mark[data-kind='ready'] {
  background: var(--bar-violet);
}
.mark[data-kind='die'] {
  background: var(--tone-err-strong);
}
.mark[data-kind='connect'] {
  width: 12px;
  height: 12px;
  margin-left: -6px;
  background: var(--tone-err-strong);
}

.state {
  justify-self: start;
  padding: 4px 10px;
  border-radius: var(--r-full);
  font-family: var(--mono);
  font-size: var(--fs-3);
  transition: all 0.25s;
}
.state[data-tone='none'] {
  background: var(--surface-2);
  color: var(--text-faint);
}
.state[data-tone='warn'] {
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.state[data-tone='info'] {
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
}
.state[data-tone='ok'] {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.state[data-tone='err'] {
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}

.axis {
  display: flex;
  justify-content: space-between;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}

.know {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  font-size: var(--fs-3);
  color: var(--text-muted);
}
.know__t {
  color: var(--text-muted);
}
.cond {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 4px 10px;
  border-radius: var(--r-full);
  border: 1px solid var(--border);
  font-family: var(--mono);
  font-size: var(--fs-3);
  transition: all 0.25s;
}
.cond[data-ok='yes'] {
  border-color: var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.cond[data-ok='no'] {
  border-color: var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}

.say {
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--r2);
  background: var(--surface-2);
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.5;
  color: var(--prose);
}
.say[data-tone='ok'] {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.say[data-tone='warn'] {
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.say[data-tone='err'] {
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}

.verdict {
  margin: 0;
  font-size: var(--fs-4);
  line-height: 1.55;
}
.verdict[data-tone='ok'] {
  color: var(--tone-ok-text);
}
.verdict[data-tone='err'] {
  color: var(--tone-err-text);
}

.disclaimer {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}

/* Код внутри мелкой подписи: базовое `code { font-size: .86em }` уводило его ниже 11px.
   Пол — ступень `--fs-2`. */
.say :deep(code),
.clock :deep(code),
.know__t :deep(code),
.cond :deep(code) {
  font-size: max(0.86em, var(--fs-2));
}
</style>
