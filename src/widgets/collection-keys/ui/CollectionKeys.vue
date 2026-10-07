<script setup lang="ts">
/**
 * Один ключ — три хранилища. Читатель выбирает ключ, и тот же код с ним исполняется
 * над `{}`, `Object.create(null)` и `Map` — прямо в браузере, через `model/run.ts`.
 *
 * Две строки результата и есть урок: что хранилище отдало **до** записи (у обычного объекта
 * иногда уже что-то есть) и что нашлось по «похожему» ключу (у объекта ключи склеиваются).
 * Пояснение под колонками — из `data.ts`, его сверяет тест с тем же прогоном модели.
 *
 * Классы с префиксом `ck-`: на дев-сервере стили островов живут голыми селекторами
 * (`docs/agents/lesson-structure.md`).
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { KEYS, runKey } from '../model/run';

const props = defineProps<{ notes: Record<string, string>; caption: string }>();

const picked = ref(KEYS[0].value);
const choice = computed(() => KEYS.find((k) => k.value === picked.value) ?? KEYS[0]);
const runs = computed(() => runKey(choice.value));
const options = KEYS.map((k) => ({ value: k.value, label: k.label }));
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="ck-bar">
        <span class="ck-bar__label">ключ:</span>
        <SegmentedControl v-model="picked" class="l-pills" label="Ключ для записи" :options="options" />
      </div>
    </template>

    <div class="ck-grid">
      <div v-for="r in runs" :key="r.kind" class="ck-store">
        <div class="ck-store__title">{{ r.title }}</div>
        <pre class="ck-code" data-code>{{ r.code.join('\n') }}</pre>

        <div class="ck-row" :data-tone="r.leaked ? 'warn' : undefined">
          <span class="ck-row__k">до записи</span>
          <span class="ck-row__v">{{ r.before }}</span>
        </div>
        <div class="ck-row">
          <span class="ck-row__k">ключи после записи</span>
          <span class="ck-row__v">{{ r.keys }}</span>
        </div>
        <div class="ck-row">
          <span class="ck-row__k">похожим ключом {{ choice.alike }}</span>
          <span class="ck-row__v">{{ r.alike }}</span>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="ck-foot">
        <Md :text="props.notes[choice.value]" />
        <Md class="ck-foot__caption" :text="props.caption" />
      </div>
    </template>
  </DemoFrame>
</template>

<style scoped>
.ck-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.ck-bar__label {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}

.ck-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 14px;
  padding: 20px;
  background: var(--surface-2);
}
.ck-store {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--surface);
}
.ck-store__title {
  font-family: var(--mono);
  font-size: var(--fs-4);
  font-weight: 600;
  color: var(--ink);
}
.ck-code {
  margin: 0;
  padding: 12px 14px;
  font-size: var(--fs-2);
  line-height: 1.7;
  overflow-x: auto;
}
.ck-row {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: var(--r1);
}
/* Хранилище ответило до записи — это и есть «в пустом словаре уже что-то есть». */
.ck-row[data-tone='warn'] {
  border-color: var(--tone-warn-line);
  background: var(--tone-warn-bg);
}
.ck-row__k {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-faint);
}
.ck-row__v {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
  overflow-wrap: anywhere;
}
.ck-row[data-tone='warn'] .ck-row__v {
  color: var(--tone-warn-text);
}

.ck-foot {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--prose);
}
.ck-foot__caption {
  color: var(--text-muted);
}
</style>
