<script setup lang="ts">
/**
 * Панель пошагового демо с проигрывателем: играть, назад, шаг, сброс, скорость и шкала.
 *
 * Близнец `StepToolbar.vue` и его развитие. Ручной режим остаётся главным — кнопки те же
 * и на тех же местах, — но появляется два новых способа смотреть: пустить процесс самому
 * и промотать его в любую точку. Раньше демо показывали **состояния**, а объясняем мы
 * **процесс**: разница та же, что между раскадровкой и фильмом.
 *
 * Кнопка «играть» исчезает, если система просит не двигать картинку (`available: false`):
 * предлагать то, что по просьбе пользователя не сработает, — хуже, чем не предлагать.
 *
 * Шкала — обычный `input[type=range]`, но с полностью своим видом: у ползунка есть собственные
 * цвета браузера, а в курсе цвет приходит только из темы, и проверка палитры покраснеет
 * на первом же системном оттенке.
 */
import { computed } from 'vue';
import { Button } from '@/shared/ui';

const props = withDefaults(
  defineProps<{
    /** Счётчик вида «3 / 14». Из него же берётся длина сценария, если `total` не передан. */
    counter: string;
    index: number;
    /**
     * Число шагов. Необязателен: у разных демо сценарий лежит в по-разному названном массиве,
     * и заставлять каждое из них передавать длину значило бы править двенадцать файлов ради
     * числа, которое уже написано в счётчике.
     */
    total?: number;
    playing: boolean;
    speed: number;
    speeds?: number[];
    /** Автоплей доступен: система не просила гасить движение. */
    available?: boolean;
    atStart?: boolean;
    atEnd?: boolean;
    nextLabel?: string;
  }>(),
  { total: 0, speeds: () => [0.5, 1, 2], available: true, nextLabel: 'Шаг →' },
);

const emit = defineEmits<{
  toggle: [];
  prev: [];
  next: [];
  reset: [];
  scrub: [number];
  speed: [number];
}>();

const onScrub = (event: Event) => {
  emit('scrub', Number((event.target as HTMLInputElement).value));
};

/** «3 / 14» → 14. Если счётчик непривычной формы, шкала просто не появится. */
const steps = computed(() => {
  if (props.total) return props.total;
  const parsed = Number(props.counter.split('/')[1]?.trim());
  return Number.isFinite(parsed) ? parsed : 0;
});
</script>

<template>
  <div class="toolbar">
    <div class="row">
      <!--
        Видимость решает CSS, а не только `available`, и это не перестраховка. Остров
        гидратируется по появлению на экране, а до того в DOM висит серверная разметка, где
        предпочтение пользователя ещё неизвестно — там кнопка есть. Медиазапрос убирает её
        сразу, без участия JS; `available` доводит дело до конца уже в логике.
      -->
      <Button
        v-if="props.available"
        class="play is-icon"
        variant="primary"
        :aria-label="playing ? 'Пауза' : 'Играть'"
        @click="emit('toggle')"
      >
        {{ playing ? '❚❚' : '▶' }}
      </Button>
      <Button
        class="is-icon"
        variant="secondary"
        :disabled="atStart"
        aria-label="Шаг назад"
        @click="emit('prev')"
      >
        ←
      </Button>
      <Button variant="primary" :disabled="atEnd" @click="emit('next')">{{ nextLabel }}</Button>
      <Button variant="secondary" :disabled="atStart" @click="emit('reset')">сброс</Button>
      <span class="counter">{{ counter }}</span>
    </div>

    <div class="row">
      <input
        class="scrub"
        type="range"
        min="0"
        :max="Math.max(0, steps - 1)"
        :value="index"
        aria-label="Шаг демонстрации"
        @input="onScrub"
      />
      <div v-if="props.available" class="speeds">
        <button
          v-for="value in props.speeds"
          :key="value"
          class="speed"
          type="button"
          :aria-pressed="value === speed"
          @click="emit('speed', value)"
        >
          {{ value }}×
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}
.counter {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-faint);
}

/* Просили не двигать картинку — не предлагаем и кнопку. Остальное демо остаётся рабочим. */
@media (prefers-reduced-motion: reduce) {
  .play,
  .speeds {
    display: none;
  }
}

/* Ползунок целиком свой: системные цвета трека и бегунка в палитру курса не входят. */
.scrub {
  flex: 1;
  min-width: 0;
  height: 4px;
  margin: 0;
  appearance: none;
  border-radius: var(--r-full);
  background: var(--surface-3);
  font: inherit;
  color: inherit;
}
.scrub::-webkit-slider-thumb {
  appearance: none;
  width: 14px;
  height: 14px;
  border: 0;
  border-radius: var(--r-full);
  background: var(--accent);
  cursor: pointer;
}
.scrub::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border: 0;
  border-radius: var(--r-full);
  background: var(--accent);
  cursor: pointer;
}

.speeds {
  display: flex;
  gap: 4px;
}
.speed {
  padding: 4px 9px;
  border: 0;
  /* Скорости стоят в одной панели с кнопками — форма, вес и ступень у них общие.
     На ступень ниже они бы теперь заметно отставали от подписей кнопок. */
  border-radius: var(--r1);
  background: transparent;
  font-family: var(--mono);
  font-size: var(--fs-3);
  font-weight: 500;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.18s;
}
.speed[aria-pressed='true'] {
  background: var(--surface-3);
  color: var(--ink);
}
</style>
