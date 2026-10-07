<script setup lang="ts">
/**
 * «Три копии одного значения»: пример (его можно править), три способа копирования рядом,
 * печать каждой копии и список того, что потерялось по дороге.
 *
 * Копии считает не компонент: строки `STRINGIFY_CODE` и `CLONE_CODE` темы собираются
 * `new Function` в воркере (`model/worker.ts` → `model/run.ts`), там же сверяются с настоящими
 * `JSON.stringify` и `structuredClone` этого браузера. Код примера тоже исполняется в воркере:
 * зацикленный пример снимается по таймауту и не вешает вкладку. Те же функции `run.ts`
 * и `shape.ts` прогоняет `tests/unit/serialization.test.ts`.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import CodeInput from '@/shared/ui/CodeInput.vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button, SegmentedControl } from '@/shared/ui';
import type { CloneReply } from '../model/worker';
import type { CloneSample, MethodResult } from '../model/types';

const props = defineProps<{
  stringifyCode: string;
  cloneCode: string;
  samples: CloneSample[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const TIMEOUT_MS = 2000;

const picked = ref(props.samples[0].id);
const options = props.samples.map((s) => ({ value: s.id, label: s.label }));
const sample = computed(() => props.samples.find((s) => s.id === picked.value) ?? props.samples[0]);

const code = ref(sample.value.code);
const results = ref<MethodResult[]>([]);
const failure = ref('');
const running = ref(false);
const edited = computed(() => code.value !== sample.value.code);

let worker: Worker | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

function stop() {
  clearTimeout(timer);
  worker?.terminate();
  worker = null;
}

function run() {
  stop();
  running.value = true;
  failure.value = '';
  const w = new Worker(new URL('../model/worker.ts', import.meta.url), { type: 'module' });
  worker = w;
  timer = setTimeout(() => {
    if (worker !== w) return;
    stop();
    running.value = false;
    results.value = [];
    failure.value = `Пример не вернул значение за ${TIMEOUT_MS / 1000} с — похоже на бесконечный цикл. Воркер остановлен.`;
  }, TIMEOUT_MS);
  w.onmessage = (event: MessageEvent<CloneReply>) => {
    if (worker !== w) return;
    stop();
    running.value = false;
    if (event.data.ok) {
      results.value = event.data.results;
    } else {
      results.value = [];
      failure.value = `Ошибка в самом примере: \`${event.data.error}\``;
    }
  };
  w.postMessage({ stringifyCode: props.stringifyCode, cloneCode: props.cloneCode, code: code.value });
}

watch(sample, (next) => {
  code.value = next.code;
  run();
});

onMounted(run);
onBeforeUnmount(stop);

const restore = () => {
  code.value = sample.value.code;
  run();
};

const TITLES: Record<MethodResult['id'], string> = {
  spread: 'спред — один уровень',
  json: 'JSON туда и обратно',
  clone: 'structured clone',
};

const nativeText = (r: MethodResult) =>
  r.native === null
    ? ''
    : r.native === 'same'
      ? `совпало с ${r.id === 'json' ? '`JSON.stringify`' : '`structuredClone`'} браузера`
      : `расходится с ${r.id === 'json' ? '`JSON.stringify`' : '`structuredClone`'} браузера`;
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="picked" class="l-pills" label="Пример" :options="options" />
    </template>

    <div class="cl-body">
      <Md class="cl-note" :text="sample.note" />

      <CodeInput v-model="code" label="значение (тело функции)" :rows="8" />

      <div class="cl-row">
        <Button variant="primary" :disabled="running" @click="run">
          {{ running ? 'копируется…' : 'скопировать' }}
        </Button>
        <Button v-if="edited" variant="secondary" @click="restore">вернуть пример</Button>
      </div>

      <Md v-if="failure" class="cl-failure" :text="failure" />

      <div v-else class="cl-grid">
        <section v-for="r in results" :key="r.id" class="cl-col" :aria-label="TITLES[r.id]">
          <div class="cl-head">
            <span class="cl-title">{{ TITLES[r.id] }}</span>
            <code class="cl-expr">{{ r.label }}</code>
            <Md v-if="r.native" class="cl-native" :data-state="r.native" :text="nativeText(r)" />
          </div>

          <pre v-if="r.shown !== null" class="cl-code">{{ r.shown }}</pre>
          <pre v-else class="cl-code cl-code--err">{{ r.error }}</pre>

          <ul v-if="r.losses.length" class="cl-losses">
            <li v-for="(l, i) in r.losses" :key="i"><Md :text="l" /></li>
          </ul>
          <p v-else-if="r.shown !== null" class="cl-clean">Потерь нет.</p>
          <p v-else class="cl-clean cl-clean--err">Копии нет: способ бросил исключение.</p>
        </section>
      </div>

      <Md class="cl-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.cl-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.cl-note,
.cl-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.cl-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}
.cl-failure {
  padding: 12px 14px;
  border-radius: var(--r2);
  background: var(--tone-err-bg);
  font-size: var(--fs-3);
  line-height: 1.5;
  color: var(--tone-err-text);
}

.cl-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  align-items: start;
}
@media (max-width: 980px) {
  .cl-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

.cl-col {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.cl-head {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.cl-title {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.cl-expr {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
  overflow-wrap: anywhere;
}
.cl-native {
  align-self: flex-start;
  padding: 2px 8px;
  border-radius: var(--r2);
  font-size: var(--fs-2);
  line-height: 1.5;
}
.cl-native[data-state='same'] {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.cl-native[data-state='differs'] {
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}

.cl-code {
  margin: 0;
  max-height: 22em;
  overflow: auto;
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.6;
  /* Подложка — общая для кода курса (`pre` в base.css, чернильная): цвета — «на чернилах». */
  color: var(--code-fg);
  white-space: pre;
}
.cl-code--err {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--tone-warn-on-ink);
}

.cl-losses {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.cl-losses li {
  padding: 6px 10px;
  border-radius: var(--r2);
  border-left: 3px solid var(--tone-warn-line);
  background: var(--tone-warn-bg);
  font-size: var(--fs-3);
  line-height: 1.5;
  color: var(--tone-warn-text);
  overflow-wrap: anywhere;
}
.cl-clean {
  margin: 0;
  padding: 6px 10px;
  border-radius: var(--r2);
  background: var(--tone-ok-bg);
  font-size: var(--fs-3);
  color: var(--tone-ok-text);
}
.cl-clean--err {
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}
.cl-note :deep(code),
.cl-caption :deep(code),
.cl-losses :deep(code),
.cl-native :deep(code),
.cl-failure :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
</style>
