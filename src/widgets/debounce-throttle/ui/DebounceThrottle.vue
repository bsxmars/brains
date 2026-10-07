<script setup lang="ts">
/**
 * Debounce против throttle на одной шкале времени.
 *
 * В оригинале здесь была картинка с фиксированной последовательностью. Смысл появляется,
 * когда последовательность и опции можно менять: разницу между «гарантирует тишину»
 * и «гарантирует регулярность» видно не из определения, а из того, как две дорожки
 * расходятся на одном и том же потоке событий.
 *
 * `leading` и `trailing` — независимые флаги, поэтому это две кнопки-переключателя
 * с `aria-pressed`, а не радиогруппа: выбрать можно оба, ни одного или любой один.
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import { Button } from '@/shared/ui';
import { simulateDebounce, simulateThrottle } from '../model/simulate';
import type { EventSequence } from '../model/types';

const props = withDefaults(defineProps<{ sequences: EventSequence[]; wait?: number }>(), {
  wait: 100,
});

const picked = ref(0);
const leading = ref(true);
const trailing = ref(true);

const sequence = computed(() => props.sequences[picked.value] ?? props.sequences[0]);
const debounce = computed(() =>
  simulateDebounce(sequence.value.times, props.wait, leading.value, trailing.value),
);
const throttle = computed(() =>
  simulateThrottle(sequence.value.times, props.wait, leading.value, trailing.value),
);

/** Позиция отметки на шкале. 98% — потолок, чтобы подпись последней отметки не срезалась. */
const at = (t: number) => `left:${Math.min(98, (t / sequence.value.max) * 100)}%`;

const note = computed(() => {
  if (!leading.value && !trailing.value) {
    /*
     * ⚠️ Отсюда убраны числа чужого прогона: в футере стояло «throttle(fn, 50, …) на событиях
     * 0 / 120 / 260 мс», тогда как демо рядом идёт на wait = 100 и на своих последовательностях.
     * Читатель видел одни числа на дорожках и другие в подписи под ними. Утверждение осталось
     * тем же — но теперь его подтверждают сами дорожки, на которые читатель смотрит.
     */
    return 'Вырожденная конфигурация: обёртка не вызовет функцию ни разу — ни debounce, ни throttle, сколько бы событий ни пришло и какими бы ни были разрывы между ними. Вызов делают только ветка leading (в начале окна) и ветка trailing (в конце), а обе выключены; третьей ветки нет ни у одной из обёрток. Дорожки выше пустые при любом потоке событий — в этом и весь ответ. Практический вывод: такую пару опций стоит запрещать в своём коде явной проверкой — молчащая обёртка выглядит как «событие не пришло», и искать причину будут в источнике событий.';
  }
  if (sequence.value.times.length === 1 && leading.value && trailing.value) {
    return 'Одиночный вызов при leading + trailing: срабатывание ровно одно, а не два. invoke() обнуляет lastArgs, и таймер, увидев lastArgs === null, ничего не делает.';
  }
  return 'Debounce гарантирует тишину — вызов только после паузы. Throttle гарантирует регулярность — что-то происходит не реже, чем раз в wait.';
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="controls">
        <div class="row">
          <span class="t-label">поток событий</span>
          <Button
            v-for="(seq, i) in sequences"
            :key="seq.label"
            :variant="i === picked ? 'primary' : 'secondary'"
            :aria-pressed="i === picked"
            @click="picked = i"
          >
            {{ seq.label }}
          </Button>
        </div>
        <div class="row">
          <span class="t-label">опции</span>
          <Button
            :variant="leading ? 'primary' : 'secondary'"
            :aria-pressed="leading"
            @click="leading = !leading"
          >
            leading
          </Button>
          <Button
            :variant="trailing ? 'primary' : 'secondary'"
            :aria-pressed="trailing"
            @click="trailing = !trailing"
          >
            trailing
          </Button>
          <span class="wait">wait = {{ wait }} мс</span>
        </div>
      </div>
    </template>

    <div class="dt-scroll">
    <div class="chart">
      <div class="lane">
        <div class="lane__label" data-tone="ink">события</div>
        <div class="track">
          <div v-for="t in sequence.times" :key="t" class="mark" :style="at(t)">
            <span class="mark__text" data-tone="ink">{{ t }}мс</span>
            <span class="tick" data-tone="ink"></span>
          </div>
        </div>
      </div>

      <div class="lane">
        <div class="lane__label" data-tone="info">debounce</div>
        <div class="track">
          <div v-for="fire in debounce" :key="`d-${fire.t}`" class="mark" :style="at(fire.t)">
            <span class="mark__text" data-tone="info">{{ fire.t }}мс · arg {{ fire.arg }}</span>
            <span class="dot" data-tone="info"></span>
            <span class="tick" data-tone="info"></span>
          </div>
          <div v-if="!debounce.length" class="empty">не вызовется ни разу</div>
        </div>
      </div>

      <div class="lane">
        <div class="lane__label" data-tone="warn">throttle</div>
        <div class="track">
          <div v-for="fire in throttle" :key="`t-${fire.t}`" class="mark" :style="at(fire.t)">
            <span class="mark__text" data-tone="warn">{{ fire.t }}мс · arg {{ fire.arg }}</span>
            <span class="dot" data-tone="warn"></span>
            <span class="tick" data-tone="warn"></span>
          </div>
          <div v-if="!throttle.length" class="empty">не вызовется ни разу</div>
        </div>
      </div>

      <div class="lane">
        <div></div>
        <div class="axis"><span>0</span><span>{{ sequence.max }}мс</span></div>
      </div>
    </div>
    </div>

    <template #footer>
      <div class="note">{{ note }}</div>
    </template>
  </DemoFrame>
</template>

<style scoped>
.controls {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.wait {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}

/*
 * Подписи отметок стоят по времени, а не по месту: на узкой дорожке «0мс», «40мс» и «80мс»
 * налезали друг на друга (замер на 375px, 2026-09-29). Поэтому у дорожек есть наименьшая
 * ширина, при которой подписи не сталкиваются, а на телефоне они прокручиваются в рамке.
 */
.dt-scroll {
  overflow-x: auto;
}
.chart {
  min-width: 600px;
  display: flex;
  flex-direction: column;
  gap: 22px;
  padding: 24px 18px 20px;
}
.lane {
  display: grid;
  grid-template-columns: minmax(78px, 90px) minmax(0, 1fr);
  gap: 14px;
  align-items: center;
}
.lane__label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  text-align: end;
}
.lane__label[data-tone='ink'] {
  color: var(--ink);
}
.lane__label[data-tone='info'] {
  color: var(--tone-info-strong);
}
.lane__label[data-tone='warn'] {
  color: var(--tone-warn-strong);
}

.track {
  position: relative;
  height: 38px;
  border-bottom: 1px solid var(--hairline);
}
.mark {
  position: absolute;
  bottom: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  transform: translateX(-50%);
}
.mark__text {
  font-family: var(--mono);
  font-size: var(--fs-3);
  white-space: nowrap;
}
.mark__text[data-tone='ink'] {
  color: var(--text-faint);
}
.mark__text[data-tone='info'] {
  color: var(--tone-info-strong);
}
.mark__text[data-tone='warn'] {
  color: var(--tone-warn-strong);
}

.dot {
  width: 9px;
  height: 9px;
  border-radius: var(--r-full);
}
.tick {
  width: 2px;
  height: 12px;
}
.dot[data-tone='info'],
.tick[data-tone='info'] {
  background: var(--accent);
}
.dot[data-tone='warn'],
.tick[data-tone='warn'] {
  background: var(--bar-amber);
}
.tick[data-tone='ink'] {
  height: 16px;
  background: var(--ink);
}

.empty {
  position: absolute;
  left: 0;
  bottom: 4px;
  font-size: var(--fs-5);
  font-style: italic;
  color: var(--ghost);
}

.axis {
  display: flex;
  justify-content: space-between;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--dim);
}

.note {
  font-size: var(--fs-6);
  line-height: 1.6;
  color: var(--prose);
}

@media (max-width: 560px) {
  /* Без колонки подписей дорожка начинается у края прокрутки, и подпись отметки на нуле
     (она центрирована над отметкой) срезалась. Поля — на половину самой длинной подписи. */
  .chart {
    padding-inline: 64px;
  }
  .lane {
    grid-template-columns: 1fr;
    gap: 6px;
  }
  .lane__label {
    text-align: start;
  }
}
</style>
