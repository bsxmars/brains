<script setup lang="ts">
/**
 * Панель действий — третий остров демо и единственный источник событий для двух остальных.
 *
 * Кнопка одна на обе модели намеренно: две кнопки — это два разных нажатия, и сравнение
 * держалось бы на честном слове. Здесь событие ровно одно, а слушают его обе половины.
 */
import { ref } from 'vue';
import Md from '@/shared/ui/Md.vue';
import { Button } from '@/shared/ui';
import { runAction } from '../model/bus';
import type { ActionCopy } from '../model/types';

defineProps<{ actions: ActionCopy[] }>();

const last = ref<ActionCopy | null>(null);

const run = (action: ActionCopy) => {
  last.value = action;
  runAction(action.id);
};

const reset = () => {
  last.value = null;
  runAction('reset');
};
</script>

<template>
  <div class="controls">
    <div class="row">
      <span class="label">меняем одно поле из трёх:</span>
      <Button v-for="action in actions" :key="action.id" variant="primary" @click="run(action)">
        {{ action.label }}
      </Button>
      <Button variant="secondary" @click="reset">сброс</Button>
    </div>

    <div v-if="last" class="said">
      <Md class="said__field" :text="last.field" />
      <Md class="said__note" :text="last.note" />
    </div>
    <p v-else class="hint">
      Нажмите любую кнопку — обе половины получат одно и то же событие и покажут, сколько
      работы на него потратили.
    </p>
  </div>
</template>

<style scoped>
.controls {
  display: flex;
  flex-direction: column;
  gap: 11px;
  min-width: 0;
}
.row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.label {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}

.said {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}
.said__field {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--tone-info-strong);
}
.said__note {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--prose);
}
.hint {
  margin: 0;
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}
</style>
