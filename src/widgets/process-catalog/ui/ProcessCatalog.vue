<script setup lang="ts">
/**
 * Каталог процессов: за что отвечает, с какими правами и что будет, когда упадёт.
 *
 * Последняя колонка здесь главная. Устройство браузера запоминается не списком процессов,
 * а последствиями: падение рендерера — это «Aw, Snap!» на одной вкладке, падение browser
 * process — это закрывшийся браузер. Цвет песочницы говорит то же самое одним взглядом.
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import { SegmentedControl } from '@/shared/ui';
import type { ProcessInfo } from '../model/types';

const props = defineProps<{ processes: ProcessInfo[]; initial?: number }>();

const picked = ref(String(props.initial ?? 1));
const current = computed(() => props.processes[Number(picked.value)]);
const options = computed(() => props.processes.map((p, i) => ({ value: String(i), label: p.label })));

/** Цвет «пилюли» песочницы: без песочницы — красный, ослабленная — янтарный, полная — зелёный. */
const sandboxTone = computed(() => {
  const text = current.value.sandbox;
  if (text.includes('БЕЗ')) return 'err';
  if (text.includes('ослаб')) return 'warn';
  return 'ok';
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="picked" class="l-pills" label="Процесс браузера" :options="options" />
    </template>

    <div class="split">
      <div class="pane">
        <div class="pills">
          <span class="pill pill--count">{{ current.count }}</span>
          <span class="pill" :data-tone="sandboxTone">{{ current.sandbox }}</span>
        </div>

        <div class="field">
          <div class="t-label">за что отвечает</div>
          <div class="text">{{ current.what }}</div>
        </div>
      </div>

      <div class="pane pane--right">
        <div class="field">
          <div class="t-label">когда упадёт</div>
          <div class="crash" :data-tone="current.tone ?? 'warn'">{{ current.crash }}</div>
        </div>
        <div class="text">{{ current.note }}</div>
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
  gap: 14px;
  padding: 20px;
  border-right: 1px solid var(--divider);
}
.pane--right {
  border-right: 0;
  background: var(--surface-2);
}

.pills {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}
.pill {
  padding: 6px 11px;
  border-radius: var(--r-full);
  font-family: var(--mono);
  font-size: var(--fs-2);
}
.pill--count {
  background: var(--surface-3);
  color: var(--text-muted);
}
.pill[data-tone='err'] {
  background: var(--tone-err-chip);
  color: var(--tone-err-strong);
  font-weight: 600;
}
.pill[data-tone='warn'] {
  background: var(--tone-warn-chip);
  color: var(--tone-warn-strong);
}
.pill[data-tone='ok'] {
  background: var(--tone-ok-chip);
  color: var(--tone-ok-strong);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.text {
  font-size: var(--fs-6);
  line-height: 1.6;
  color: var(--prose);
}

.crash {
  padding: 13px 15px;
  border-radius: var(--r2);
  font-size: var(--fs-6);
  line-height: 1.6;
  transition: all 0.2s;
}
.crash[data-tone='err'] {
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}
.crash[data-tone='warn'] {
  border: 1px solid var(--tone-warn-line);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.crash[data-tone='ok'] {
  border: 1px solid var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
</style>
