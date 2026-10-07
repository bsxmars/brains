<script setup lang="ts">
/**
 * Что дешевле двигать: одно движение — четыре способа его получить.
 *
 * Стадии кадра показаны не списком «дороже / дешевле», а состоянием: где стадия выполняется
 * на главном потоке, где пропускается целиком, а где её берёт на себя композитор. Отдельной
 * строкой — **кто считает промежуточные значения**: именно в ней разница между `transform`
 * в `rAF` и композитной анимацией, а вовсе не в наборе стадий.
 *
 * ⚠️ Всё это проверяется только в браузере: DevTools → Animations, поле Composited, либо
 * операционная проверка «заблокировать поток и посмотреть, идёт ли анимация».
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import type { MoveCase, StageState } from '../model/types';

const props = defineProps<{
  cases: MoveCase[];
  stages: { key: 'style' | 'layout' | 'paint' | 'composite'; label: string }[];
}>();

const caseKey = ref(props.cases[0].key);
const caseOptions = computed(() => props.cases.map((c) => ({ value: c.key, label: c.label })));
const current = computed(() => props.cases.find((c) => c.key === caseKey.value) ?? props.cases[0]);

const CAPTION: Record<StageState, string> = {
  main: 'на main thread',
  skip: 'пропускается',
  compositor: 'на композиторе',
};

const stageList = computed(() =>
  props.stages.map((stage) => {
    const state = current.value.stages[stage.key];
    return { ...stage, state, caption: CAPTION[state] };
  }),
);

/** Сколько стадий кадра осталось на главном потоке — это и есть цена движения. */
const onMain = computed(() => stageList.value.filter((s) => s.state === 'main').length);
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="bar">
        <span class="t-label">двигаем одно и то же</span>
        <SegmentedControl v-model="caseKey" class="l-pills" label="Чем двигать" :options="caseOptions" />
      </div>
    </template>

    <div class="body">
      <pre class="code">{{ current.code }}</pre>

      <div class="stages">
        <div
          v-for="stage in stageList"
          :key="stage.key"
          class="stage"
          :data-state="stage.state"
        >
          <span class="stage__name">{{ stage.label }}</span>
          <span class="stage__caption">{{ stage.caption }}</span>
        </div>
      </div>

      <div class="driver">
        <span class="t-label">значение на каждый кадр считает</span>
        <Md class="driver__text" :text="current.driver" />
      </div>

      <div class="totals">
        <div class="total">
          <span class="t-label">стадий на главном потоке</span>
          <span class="total__value" :data-tone="current.tone">{{ onMain }} из {{ stages.length }}</span>
        </div>
      </div>

      <Md class="verdict" :data-tone="current.tone" :text="current.verdict" />
    </div>

    <template #footer>
      <div class="disclaimer">
        Всё это — браузерное поведение, запуском в Node не проверяется. Проверять надо там, где оно
        происходит: DevTools → Animations показывает у анимации поле Composited и причину отказа,
        а самая честная проверка — заблокировать главный поток на несколько секунд и посмотреть,
        продолжается ли движение. Отдельное условие для двух нижних вариантов: у элемента должен
        быть свой композитный слой — для объявленных заранее анимаций браузер создаёт его сам.
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
  gap: 18px;
  padding: 22px 20px;
}

.code {
  font-size: var(--fs-3);
  line-height: 1.7;
}

.stages {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(150px, 100%), 1fr));
  gap: 10px;
}
.stage {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 13px 14px;
  border-radius: var(--r2);
  transition: all 0.2s;
}
.stage__name {
  font-family: var(--mono);
  font-size: var(--fs-3);
}
.stage__caption {
  font-family: var(--mono);
  font-size: var(--fs-3);
}

/* Стадия на главном потоке — это и есть цена: она красная, сколько бы раз её ни называли дешёвой. */
.stage[data-state='main'] {
  background: var(--tone-err-bg);
  box-shadow: inset 0 0 0 1px var(--tone-err-line);
  color: var(--tone-err-text);
}
.stage[data-state='skip'] {
  background: transparent;
  box-shadow: inset 0 0 0 1px var(--border);
  color: var(--ghost);
}
.stage[data-state='compositor'] {
  background: var(--tone-ok-bg);
  box-shadow: inset 0 0 0 1px var(--tone-ok-line);
  color: var(--tone-ok-text);
}

.driver {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.driver__text {
  font-size: var(--fs-6);
  line-height: 1.55;
  color: var(--prose);
}

.totals {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(180px, 100%), 1fr));
  gap: 12px;
  padding-top: 16px;
  border-top: 1px solid var(--rule);
}
.total {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.total__value {
  font-family: var(--mono);
  font-size: var(--fs-8);
  transition: color 0.2s;
}
.total__value[data-tone='ok'] {
  color: var(--tone-ok-strong);
}
.total__value[data-tone='warn'] {
  color: var(--tone-warn-strong-2);
}
.total__value[data-tone='err'] {
  color: var(--tone-err-strong);
}

.verdict {
  padding: 14px 16px;
  border-radius: var(--r2);
  font-size: var(--fs-6);
  line-height: 1.6;
  transition: all 0.2s;
}
.verdict[data-tone='ok'] {
  border: 1px solid var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.verdict[data-tone='warn'] {
  border: 1px solid var(--tone-warn-line);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.verdict[data-tone='err'] {
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}

.disclaimer {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}
</style>
