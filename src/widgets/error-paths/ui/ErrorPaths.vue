<script setup lang="ts">
/**
 * Куда улетит ошибка из асинхронного колбэка.
 *
 * Раньше три случая стояли рядом карточками: код, объяснение и починка — всё открыто сразу.
 * Глаз забирает ответ раньше, чем голова успевает предположить свой, и остаётся ощущение
 * «ну да, логично», а не понимание. Между тем весь раздел держится на одной мысли:
 * **`try/catch` привязан к живому фрейму на стеке, а не к строчкам исходника**, и под
 * асинхронным колбэком фрейма вашего вызова уже нет.
 *
 * Поэтому здесь показывается код и задаётся вопрос, а ответ ждёт нажатия. Починка появляется
 * после ответа — чтобы её читали как вывод, а не как рецепт в отрыве от причины.
 */
import { computed, ref, watch } from 'vue';
import CodeListing from '@/shared/ui/CodeListing.vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button, SegmentedControl } from '@/shared/ui';
import type { ErrorPath } from '../model/types';

const props = defineProps<{ cases: ErrorPath[] }>();

const picked = ref('0');
const shown = ref(false);

const current = computed(() => props.cases[Number(picked.value)] ?? props.cases[0]);
const options = computed(() => props.cases.map((item, i) => ({ value: String(i), label: item.n })));
const lines = computed(() => current.value.code.split('\n'));

// Смена случая закрывает ответ: иначе следующий вопрос читается уже с открытым предыдущим.
watch(picked, () => {
  shown.value = false;
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="bar">
        <span class="bar__label">случай:</span>
        <SegmentedControl v-model="picked" class="l-pills" label="Случай потери ошибки" :options="options" />
        <span class="bar__title">{{ current.t }}</span>
      </div>
    </template>

    <div class="body">
      <CodeListing :lines="lines" label="что написано" />

      <div v-if="!shown" class="ask">
        <Md as="p" class="ask__text" :text="current.q" />
        <Button variant="primary" @click="shown = true">показать, куда она ушла</Button>
      </div>

      <template v-else>
        <Md class="why" :text="current.why" />
        <Md class="fix" :text="current.fix" />
      </template>
    </div>
  </DemoFrame>
</template>

<style scoped>
.bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}
.bar__label {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}
.bar__title {
  font-size: var(--fs-5);
  color: var(--ink);
}

.body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
  min-width: 0;
}

.ask {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  padding: 15px 17px;
  border-radius: var(--r2);
  background: var(--surface-2);
}
.ask__text {
  margin: 0;
  font-size: var(--fs-6);
  line-height: 1.5;
  color: var(--prose);
}

.why {
  padding: 14px 16px;
  border-radius: var(--r2);
  background: var(--tone-err-bg);
  font-size: var(--fs-6);
  line-height: 1.6;
  color: var(--tone-err-text);
}
.fix {
  padding: 14px 16px;
  border-radius: var(--r2);
  background: var(--tone-ok-bg);
  font-size: var(--fs-6);
  line-height: 1.6;
  color: var(--tone-ok-text);
}
</style>
