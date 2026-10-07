<script setup lang="ts">
/**
 * «Один манифест на три окружения»: окружение и способ — и итоговые манифесты,
 * в которых подсвечено всё, чего нет в базе.
 *
 * Ответ считает не компонент, а модель из темы — строки `MODEL_PARTS`, собранные
 * `new Function` (`model/run.ts`). Те же строки исполняет тест на таблицах случаев из
 * документации, поэтому демо не может «знать» больше, чем проверенный код.
 *
 * Сборка модели и одного окружения дешёвая (несколько сотен строк текста, без замеров),
 * поэтому живёт в `setup`: двойная цена сервера и гидратации здесь ничтожна.
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { inputsOf, loadModel } from '../model/run';
import type { Env, ListMode, Tool, View } from '../model/types';

const props = defineProps<{
  parts: string[];
  files: Record<string, string>;
  commands: Record<string, string>;
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const model = loadModel(props.parts);

const env = ref<Env>('prod');
const tool = ref<Tool>('kustomize');
const mode = ref<ListMode>('strategic');

const ENVS = [
  { value: 'dev', label: 'dev' },
  { value: 'stage', label: 'stage' },
  { value: 'prod', label: 'prod' },
];
const TOOLS = [
  { value: 'kustomize', label: 'Kustomize' },
  { value: 'helm', label: 'Helm' },
];
const MODES = [
  { value: 'strategic', label: 'слияние по name' },
  { value: 'replace', label: 'замена списка' },
];

const HELM_LISTS =
  'В Helm выбора нет: список из файла окружения всегда заменяет список из `values.yaml` целиком.';

const result = computed<{ view: View | null; error: string }>(() => {
  try {
    return { view: model.buildView(props.files, props.commands, env.value, tool.value, mode.value), error: '' };
  } catch (e) {
    return { view: null, error: e instanceof Error ? e.message : String(e) };
  }
});

const inputs = computed(() => inputsOf(props.files, props.commands, env.value, tool.value));
const outLines = computed(() => result.value.view?.lines ?? []);
const changedCount = computed(() => result.value.view?.lines.filter((l) => l.changed).length ?? 0);

interface Chip {
  text: string;
  tone: 'plain' | 'err';
}

const chips = computed<Chip[]>(() => {
  const f = result.value.view?.facts;
  if (!f) return [];
  const out: Chip[] = [{ text: `реплик: ${f.replicas ?? '—'}`, tone: 'plain' }];
  for (const c of f.containers) {
    if (!c.name) {
      out.push({ text: 'элемент списка без name — это не контейнер', tone: 'err' });
    } else if (!c.image) {
      out.push({ text: `${c.name}: без образа`, tone: 'err' });
    } else {
      const env = c.env.length ? ` · env: ${c.env.join(', ')}` : '';
      out.push({ text: `${c.name}: ${c.image.split('/').pop()}${env}`, tone: 'plain' });
    }
  }
  if (f.host) out.push({ text: `домен: ${f.host}`, tone: 'plain' });
  if (f.config) out.push({ text: `ConfigMap: ${f.config.name}`, tone: 'plain' });
  return out;
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="kz-controls">
        <SegmentedControl v-model="env" class="l-pills" label="Окружение" :options="ENVS" />
        <SegmentedControl v-model="tool" class="l-pills" label="Способ" :options="TOOLS" />
        <SegmentedControl
          v-if="tool === 'kustomize'"
          v-model="mode"
          class="l-pills"
          label="Как сливать список контейнеров"
          :options="MODES"
        />
      </div>
    </template>

    <div class="kz-body">
      <Md v-if="tool === 'helm'" class="kz-note" :text="HELM_LISTS" />

      <div v-if="chips.length" class="kz-chips">
        <span v-for="(chip, i) in chips" :key="i" class="kz-chip" :data-tone="chip.tone">{{ chip.text }}</span>
      </div>

      <div class="kz-split">
        <div class="kz-col">
          <span class="kz-label">написано для {{ env }}</span>
          <div v-for="file in inputs" :key="file.title" class="kz-file" data-code>
            <span class="kz-file__title">{{ file.title }}</span>
            <div class="kz-lines">
              <div v-for="(line, i) in file.text.split('\n')" :key="i" class="kz-line">{{ line || ' ' }}</div>
            </div>
          </div>
        </div>

        <div class="kz-col">
          <span class="kz-label">
            итог · {{ tool === 'kustomize' ? 'kustomize build' : 'helm template' }} · не как в базе: {{ changedCount }}
          </span>
          <div v-if="result.error" class="kz-error">
            <Md :text="`Модель не собрала итог: \`${result.error}\``" />
          </div>
          <div v-else class="kz-file kz-file--out" data-code>
            <div class="kz-lines">
              <div v-for="(line, i) in outLines" :key="i" class="kz-line" :class="{ 'kz-line--changed': line.changed }">{{ line.text || ' ' }}</div>
            </div>
          </div>
        </div>
      </div>

      <div v-if="result.view && result.view.gone.length" class="kz-gone">
        <span class="kz-label">строки базы, которых нет в итоге: {{ result.view.gone.length }}</span>
        <div class="kz-lines" data-code>
          <div v-for="(line, i) in result.view.gone" :key="i" class="kz-line kz-line--gone">{{ line }}</div>
        </div>
      </div>
    </div>

    <template #footer>
      <Md class="kz-caption" :text="caption" />
    </template>
  </DemoFrame>
</template>

<style scoped>
.kz-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 14px;
  align-items: center;
}
.kz-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
  min-width: 0;
}
.kz-note,
.kz-caption {
  font-size: var(--fs-2);
  line-height: 1.55;
  color: var(--text-muted);
}
.kz-note :deep(code),
.kz-caption :deep(code),
.kz-error :deep(code) {
  font-family: var(--mono);
  /* Не ниже ступени `--fs-2`: в подписи на `--fs-2` доля .92em давала 10.9px. */
  font-size: max(0.92em, var(--fs-2));
}

.kz-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.kz-chip {
  padding: 4px 10px;
  border-radius: var(--r-full);
  font-family: var(--mono);
  font-size: var(--fs-3);
  overflow-wrap: anywhere;
}
.kz-chip[data-tone='plain'] {
  background: var(--surface-3);
  color: var(--chip-text);
}
.kz-chip[data-tone='err'] {
  background: var(--tone-err-chip);
  color: var(--tone-err-text);
}

.kz-split {
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 760px) {
  .kz-split {
    grid-template-columns: minmax(0, 1fr);
  }
}
.kz-col {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.kz-label {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}

.kz-file {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 4px;
  border-radius: var(--r3);
  background: var(--surface-2);
  overflow-x: auto;
}
.kz-file--out {
  max-height: 560px;
  overflow-y: auto;
}
.kz-file__title {
  padding: 0 10px;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}
.kz-lines {
  display: flex;
  flex-direction: column;
  min-width: max-content;
}
.kz-line {
  padding: 0 10px;
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.6;
  white-space: pre;
  color: var(--text-muted);
}
.kz-line--changed {
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
  box-shadow: inset 2px 0 0 var(--accent);
}
.kz-line--gone {
  color: var(--tone-err-text);
}

.kz-gone {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 6px;
  border-radius: var(--r3);
  background: var(--tone-err-bg);
  overflow-x: auto;
}
.kz-gone > .kz-label {
  padding: 0 10px;
  color: var(--tone-err-text);
}

.kz-error {
  padding: 12px 14px;
  border-radius: var(--r2);
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
  font-size: var(--fs-2);
}
</style>
