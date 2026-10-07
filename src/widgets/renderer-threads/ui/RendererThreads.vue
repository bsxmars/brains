<script setup lang="ts">
/**
 * Потоки рендерера: «JavaScript однопоточный» — это про main thread, а не про браузер.
 *
 * Демо отвечает на один вопрос: что переживёт занятый main thread, а что нет. Поэтому
 * у каждого потока выделена ключевая фраза — красная у main thread (он один на процесс)
 * и зелёная у compositor (он существует ровно затем, чтобы реагировать без main thread).
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import { SegmentedControl } from '@/shared/ui';
import type { ThreadInfo } from '../model/types';

const props = defineProps<{ threads: ThreadInfo[] }>();

const picked = ref('0');
const current = computed(() => props.threads[Number(picked.value)]);
const options = computed(() => props.threads.map((t, i) => ({ value: String(i), label: t.label })));
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="picked" class="l-pills" label="Поток рендерера" :options="options" />
    </template>

    <div class="split">
      <div class="pane">
        <div class="t-label">что делает</div>
        <ul class="does">
          <li v-for="item in current.does" :key="item">{{ item }}</li>
        </ul>
      </div>

      <div class="pane pane--right">
        <div class="key" :data-tone="current.tone ?? 'info'">{{ current.key }}</div>
        <div class="note">{{ current.note }}</div>
      </div>
    </div>
  </DemoFrame>
</template>

<style scoped>
.split {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr));
}
.pane {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px;
  border-right: 1px solid var(--divider);
}
.pane--right {
  gap: 14px;
  border-right: 0;
  background: var(--surface-2);
}

.does {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.does li {
  font-size: var(--fs-6);
  line-height: 1.55;
  color: var(--prose);
}
.does li::before {
  content: '• ';
  color: var(--text-faint);
}

.key {
  padding: 13px 15px;
  border-radius: var(--r2);
  font-size: var(--fs-6);
  line-height: 1.6;
  transition: all 0.2s;
}
.key[data-tone='info'] {
  border: 1px solid var(--tone-info-line);
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
}
.key[data-tone='ok'] {
  border: 1px solid var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.key[data-tone='err'] {
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}

.note {
  font-size: var(--fs-6);
  line-height: 1.6;
  color: var(--prose);
}
</style>
