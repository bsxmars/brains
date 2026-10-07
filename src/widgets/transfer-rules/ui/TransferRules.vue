<script setup lang="ts">
/**
 * Правила transfer-списка — прогоном, а не списком вердиктов.
 *
 * Раньше компонент был листалкой: `cases.find(…)` доставал из `data.ts` готовые `result`,
 * `why` и строку про владение буфером. Все шесть случаев — это три строки `postMessage`,
 * и в браузере они выполняются целиком: `MessageChannel` есть всегда. Держать при этом
 * записанные ответы значило показывать читателю не поведение движка, а чужой конспект.
 *
 * Считает `model/run.ts`: свежий канал, свежий буфер, `postMessage` в `try`/`catch` и замеры
 * после — имя ошибки отдельно от текста, `byteLength` у отправителя, и то, что действительно
 * доехало до второго порта. Здесь только показ.
 *
 * Прогон идёт в `onMounted` и на каждую смену переключателя. Кнопка «прогнать заново» есть
 * намеренно, и она же проверка честности: объекты каждый раз новые, поэтому повторное нажатие
 * обязано дать тот же ответ. Отсоединённый буфер обратно не присоединяется — одолжи демо один
 * экземпляр между прогонами, и второе нажатие соврало бы.
 */
import { computed, onMounted, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button, SegmentedControl } from '@/shared/ui';
import { SCENARIOS, runTransfer } from '../model/run';
import type { TransferCase, TransferKey, TransferRun } from '../model/types';

/**
 * ⚠️ `cases` и `initial` остались ради темы: MDX всё ещё передаёт `cases={TRANSFER}`.
 * Готовые вердикты не используются — их место занял прогон; `initial` по-прежнему выбирает
 * случай, потому что ключи у сценариев те же самые.
 */
const props = defineProps<{ cases?: TransferCase[]; initial?: string }>();

const KEYS = SCENARIOS.map((item) => item.key);
const start = KEYS.includes(props.initial as TransferKey) ? (props.initial as TransferKey) : SCENARIOS[0].key;

const picked = ref<TransferKey>(start);
const options = SCENARIOS.map((item) => ({ value: item.key, label: item.label }));
const active = computed(() => SCENARIOS.find((item) => item.key === picked.value) ?? SCENARIOS[0]);

const run = ref<TransferRun | null>(null);
const busy = ref(false);

async function refresh() {
  busy.value = true;
  run.value = null;
  try {
    run.value = await runTransfer(picked.value);
  } finally {
    busy.value = false;
  }
}

onMounted(() => {
  void refresh();
});

watch(picked, () => {
  void refresh();
});

/** Заголовок вердикта: исключение, молчаливая потеря или состоявшийся перенос. */
const head = computed(() => {
  const value = run.value;
  if (!value) return '';
  if (!value.supported) return 'выполнить нечем';
  if (value.threw) return 'бросило исключение';
  return value.tone === 'ok' ? 'перенос состоялся' : 'ошибки нет';
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="tr-bar">
        <SegmentedControl
          v-model="picked"
          class="l-pills"
          label="Случай из transfer-списка"
          :options="options"
        />
        <Button variant="secondary" :disabled="busy" @click="refresh">прогнать заново</Button>
      </div>
    </template>

    <div class="tr-split" :aria-busy="busy">
      <div class="tr-pane">
        <div class="t-label">что исполняется</div>
        <!-- `data-code` помечает поддерево как код: кавычки и скобки внутри принадлежат примеру. -->
        <pre class="tr-code" data-code>{{ active.code.join('\n') }}</pre>

        <div v-if="run" class="tr-verdict" :data-tone="run.tone">
          <span class="tr-verdict__head">{{ head }}</span>
          <span v-if="run.errorName" class="tr-verdict__name">{{ run.errorName }}</span>
          <span v-if="run.error" class="tr-verdict__error">{{ run.error }}</span>
          <Md class="tr-verdict__text" :text="run.verdict" />
        </div>
        <p v-else class="tr-wait">случай выполняется в вашем браузере…</p>
      </div>

      <div class="tr-pane tr-pane--right">
        <div class="tr-block">
          <div class="t-label">что замерено после вызова</div>
          <dl v-if="run && run.values.length" class="tr-values">
            <template v-for="value in run.values" :key="value.label">
              <dt class="tr-values__key">{{ value.label }}</dt>
              <dd class="tr-values__val">{{ value.value }}</dd>
            </template>
          </dl>
          <p v-else class="tr-wait">…</p>
        </div>

        <div v-if="run && run.owner" class="tr-block">
          <div class="t-label">кто владеет буфером после вызова</div>
          <div class="tr-owner">
            <div class="tr-owner__box" :data-tone="run.owner.senderTone">
              <span class="tr-owner__who">отправитель</span>
              <span class="tr-owner__val">{{ run.owner.sender }}</span>
            </div>
            <span class="tr-owner__arrow">→</span>
            <div class="tr-owner__box" :data-tone="run.owner.receiverTone">
              <span class="tr-owner__who">получатель</span>
              <span class="tr-owner__val">{{ run.owner.receiver }}</span>
            </div>
          </div>
        </div>

        <Md class="tr-why" :text="active.why" />
      </div>
    </div>

    <template #footer>
      <div class="tr-foot">
        <Md :text="active.lead" />
        <Md
          class="tr-foot__rule"
          text="Отсоединённый буфер обратно не присоединяется ничем — поэтому каждый прогон идёт на **новом** канале и **новом** буфере."
        />
      </div>
    </template>
  </DemoFrame>
</template>

<style scoped>
.tr-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.tr-split {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
}
.tr-pane {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px;
  border-right: 1px solid var(--divider);
  min-width: 0;
}
.tr-pane--right {
  border-right: 0;
  background: var(--surface-2);
  gap: 16px;
}

.tr-code {
  font-size: var(--fs-3);
  line-height: 1.75;
  padding: 15px 17px;
  overflow-x: auto;
}
.tr-wait {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--dim);
}

.tr-verdict {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 13px 15px;
  border-radius: var(--r2);
  transition: all 0.2s;
}
.tr-verdict[data-tone='ok'] {
  border: 1px solid var(--tone-ok-line);
  background: var(--tone-ok-bg);
}
.tr-verdict[data-tone='warn'] {
  border: 1px solid var(--tone-warn-line);
  background: var(--tone-warn-bg);
}
.tr-verdict[data-tone='err'] {
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
}
.tr-verdict__head {
  font-family: var(--mono);
  font-size: var(--fs-3);
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.tr-verdict[data-tone='ok'] .tr-verdict__head {
  color: var(--tone-ok-strong);
}
.tr-verdict[data-tone='warn'] .tr-verdict__head {
  color: var(--tone-warn-strong);
}
.tr-verdict[data-tone='err'] .tr-verdict__head {
  color: var(--tone-err-strong);
}
/* Имя ошибки — нормативная часть ответа, поэтому оно отдельной строкой и крупнее текста. */
.tr-verdict__name {
  align-self: flex-start;
  padding: 3px 9px;
  border-radius: var(--r-full);
  background: var(--tone-err-chip);
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--tone-err-strong);
}
/* Текст исключения — дословный от движка: моно и с переносом в любом месте, он длинный. */
.tr-verdict__error {
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.5;
  color: var(--tone-err-text);
  overflow-wrap: anywhere;
}
.tr-verdict__text {
  font-size: var(--fs-5);
  line-height: 1.55;
}
.tr-verdict[data-tone='ok'] .tr-verdict__text {
  color: var(--tone-ok-text);
}
.tr-verdict[data-tone='warn'] .tr-verdict__text {
  color: var(--tone-warn-text);
}
.tr-verdict[data-tone='err'] .tr-verdict__text {
  color: var(--tone-err-text);
}

.tr-block {
  display: flex;
  flex-direction: column;
  gap: 9px;
  min-width: 0;
}

.tr-values {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 6px;
  margin: 0;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--surface);
}
.tr-values__key {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-faint);
}
.tr-values__val {
  margin: 0 0 6px;
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.5;
  color: var(--ink);
  overflow-wrap: anywhere;
}
.tr-values__val:last-child {
  margin-bottom: 0;
}

.tr-owner {
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
  gap: 8px;
}
.tr-owner__box {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1 1 130px;
  padding: 10px 12px;
  border-radius: var(--r2);
  transition: all 0.2s;
}
.tr-owner__who {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  opacity: 0.75;
}
.tr-owner__val {
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.45;
}
.tr-owner__arrow {
  align-self: center;
  color: var(--text-faint);
}
.tr-owner__box[data-tone='ok'] {
  border: 1px solid var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.tr-owner__box[data-tone='warn'] {
  border: 1px solid var(--tone-warn-line);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.tr-owner__box[data-tone='err'] {
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}
.tr-owner__box[data-tone='dim'] {
  border: 1px dashed var(--hairline);
  background: var(--sunk-dim);
  color: var(--dim);
}

.tr-why {
  font-size: var(--fs-5);
  line-height: 1.6;
  color: var(--prose);
}

.tr-foot {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}
.tr-foot__rule {
  color: var(--text-faint);
}

@media (max-width: 720px) {
  .tr-split {
    grid-template-columns: 1fr;
  }
  .tr-pane {
    border-right: 0;
    border-bottom: 1px solid var(--divider);
  }
}
</style>
