<script setup lang="ts">
/**
 * Песочница урока: выбрать пример, переписать его и увидеть настоящий вывод.
 *
 * Курс с самого начала стоял на том, что заявленный вывод должен быть проверяемым: линейка
 * тиков исполняет код прямо в браузере читателя, потому что числа, вписанные руками, дважды
 * оказывались неверными. Здесь тот же принцип доводится до конца — проверить можно не только
 * авторский пример, но и своё возражение к нему. «А если наоборот?» перестаёт быть риторикой.
 *
 * Код читателя уходит в воркер: опечатка `while (true)` не должна убивать вкладку вместе
 * с уроком (см. `features/run-snippet/lib/worker.ts`).
 */
import { computed, ref, watch } from 'vue';
import { runInWorker } from '@/features/run-snippet/lib/worker';
import CodeInput from '@/shared/ui/CodeInput.vue';
import ConsoleView from '@/shared/ui/ConsoleView.vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button, SegmentedControl } from '@/shared/ui';
import type { Snippet } from '../model/types';

const props = defineProps<{ snippets: Snippet[] }>();

const picked = ref('0');
const snippet = computed(() => props.snippets[Number(picked.value)] ?? props.snippets[0]);
const options = computed(() => props.snippets.map((s, i) => ({ value: String(i), label: s.label })));

const code = ref(snippet.value.code);
const lines = ref<string[]>([]);
const error = ref('');
const running = ref(false);

/** Смена примера возвращает поле к авторскому коду: иначе правки перетекают из примера в пример. */
watch(snippet, (next) => {
  code.value = next.code;
  lines.value = [];
  error.value = '';
});

const edited = computed(() => code.value !== snippet.value.code);

const run = async () => {
  running.value = true;
  error.value = '';
  const result = await runInWorker(code.value);
  lines.value = result.lines;
  error.value = result.error ?? '';
  running.value = false;
};

const restore = () => {
  code.value = snippet.value.code;
};
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="picked" class="l-pills" label="Пример" :options="options" />
    </template>

    <div class="body">
      <CodeInput v-model="code" label="пример" :rows="9" />

      <div class="row">
        <Button variant="primary" :disabled="running" @click="run">
          {{ running ? 'выполняется…' : 'запустить' }}
        </Button>
        <Button v-if="edited" variant="secondary" @click="restore">вернуть пример</Button>
        <span v-if="edited" class="edited">код изменён</span>
      </div>

      <div v-if="error" class="error">{{ error }}</div>
      <ConsoleView :lines="lines" empty-label="запустите — здесь появится вывод" />

      <Md v-if="snippet.note" class="note" :text="snippet.note" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
  min-width: 0;
}
.row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}
.edited {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--tone-warn-strong-2);
}

.error {
  padding: 12px 14px;
  border-radius: var(--r2);
  background: var(--tone-err-bg);
  font-family: var(--mono);
  font-size: var(--fs-4);
  line-height: 1.5;
  color: var(--tone-err-text);
}

.note {
  font-size: var(--fs-6);
  line-height: 1.55;
  color: var(--prose);
}
</style>
