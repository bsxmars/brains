<script setup lang="ts">
/**
 * Три уровня запирания вживую: выбрать замок, операцию и режим — и увидеть, что вышло.
 *
 * В теме это место было булевой таблицей: строка — уровень, колонка — операция, клетка — «да»
 * или «нет». Таблица верна, но отвечает не на тот вопрос, который задают. Спрашивают не
 * «разрешено ли», а «что будет, если всё-таки написать» — и вот здесь ответ раздваивается:
 * в strict прилетает `TypeError`, в sloppy не прилетает ничего. Молчаливый отказ и есть
 * причина, по которой замки ловят людей: код выглядит работающим.
 *
 * Поэтому у демо три переключателя, а не два, и правая колонка показывает объект после
 * операции. Пустое место исключения рядом с неизменившимся объектом — это и есть весь урок.
 *
 * Считает не компонент, а `model/run.ts`: тот же модуль читает тест, и матрица на странице
 * с матрицей в тесте разойтись не может. Здесь только показ.
 *
 * Прогон идёт в `onMounted` и на каждую смену переключателя — всегда на свежем объекте.
 * Кнопки «повторить» нет намеренно: она подразумевает, что второй раз может выйти иначе,
 * а выйти иначе оно не может — замороженный объект не размораживается.
 */
import { computed, onMounted, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { LEVELS, MODES, OPS, runLock } from '../model/run';
import type { LockLevel, LockMode, LockOp, LockRun } from '../model/types';

withDefaults(defineProps<{ note?: string }>(), {
  note: 'Все три замка поверхностны и ни один не трогает аксессоры: `freeze` снимает `writable` у данных, а `set` у accessor-свойства продолжит вызываться.',
});

const level = ref<LockLevel>('plain');
const op = ref<LockOp>('add');
const mode = ref<LockMode>('strict');

const run = ref<LockRun | null>(null);
const refresh = () => {
  run.value = runLock(level.value, op.value, mode.value);
};

onMounted(refresh);
watch([level, op, mode], refresh);

/** Молчаливый отказ — единственное сочетание, ради которого демо и сделано: называем его. */
const silent = computed(() => run.value !== null && !run.value.threw && !run.value.changed);
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="bars">
        <div class="bar">
          <span class="bar__label">уровень:</span>
          <SegmentedControl v-model="level" class="l-pills" label="Уровень запирания" :options="LEVELS" />
        </div>
        <div class="bar">
          <span class="bar__label">операция:</span>
          <SegmentedControl v-model="op" class="l-pills" label="Операция над объектом" :options="OPS" />
        </div>
        <div class="bar">
          <span class="bar__label">режим:</span>
          <SegmentedControl v-model="mode" class="l-pills" label="Режим исполнения" :options="MODES" />
        </div>
      </div>
    </template>

    <div class="split">
      <div class="pane">
        <div class="t-label">что исполнилось</div>
        <!-- `data-code` помечает поддерево как код: кавычки и скобки внутри принадлежат примеру. -->
        <pre v-if="run" class="code" data-code>{{ run.code.join('\n') }}</pre>
        <p v-else class="wait">операция выполняется в вашем браузере…</p>

        <div v-if="run" class="verdict" :data-tone="run.tone">
          <span class="verdict__head">
            {{ run.threw ? 'бросило исключение' : silent ? 'отказ без исключения' : 'получилось' }}
          </span>
          <span v-if="run.error" class="verdict__error">{{ run.error }}</span>
          <span class="verdict__text">{{ run.verdict }}</span>
        </div>
      </div>

      <div class="pane pane--right">
        <div class="block">
          <span class="t-label">объект после операции</span>
          <div class="value" :data-changed="run && run.changed ? 'yes' : 'no'">{{ run ? run.after : '…' }}</div>
        </div>

        <div class="block">
          <span class="t-label">дескриптор свойства a</span>
          <div class="value value--small">{{ run ? run.descriptor : '…' }}</div>
        </div>

        <div class="block">
          <span class="t-label">что вернула операция</span>
          <div class="value value--small">
            {{ run ? (run.threw ? 'ничего: управление ушло в исключение' : run.returned) : '…' }}
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="lock-lab-foot">
        <Md :text="note" />
        <Md
          class="lock-lab-foot__rule"
          text="Каждый показ собирает **новый** объект: замороженный разморозить нельзя, и одолженный между прогонами экземпляр заставил бы демо врать со второго клика."
        />
      </div>
    </template>
  </DemoFrame>
</template>

<style scoped>
.bars {
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.bar__label {
  min-width: 78px;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}

.split {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
}
.pane {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px;
  border-right: 1px solid var(--divider);
  min-width: 0;
}
.pane--right {
  border-right: 0;
  background: var(--surface-2);
  gap: 16px;
}

.code {
  margin: 0;
  padding: 15px 17px;
  font-size: var(--fs-3);
  line-height: 1.75;
  overflow-x: auto;
}
.wait {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--dim);
}

.verdict {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 13px 15px;
  border-radius: var(--r2);
  transition: all 0.2s;
}
.verdict[data-tone='ok'] {
  border: 1px solid var(--tone-ok-line);
  background: var(--tone-ok-bg);
}
.verdict[data-tone='warn'] {
  border: 1px solid var(--tone-warn-line);
  background: var(--tone-warn-bg);
}
.verdict[data-tone='err'] {
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
}
.verdict__head {
  font-family: var(--mono);
  font-size: var(--fs-3);
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.verdict[data-tone='ok'] .verdict__head {
  color: var(--tone-ok-strong);
}
.verdict[data-tone='warn'] .verdict__head {
  color: var(--tone-warn-strong);
}
.verdict[data-tone='err'] .verdict__head {
  color: var(--tone-err-strong);
}
/* Текст исключения — дословный, поэтому моно и с переносом в любом месте: он длинный. */
.verdict__error {
  font-family: var(--mono);
  font-size: var(--fs-4);
  line-height: 1.5;
  color: var(--tone-err-text);
  overflow-wrap: anywhere;
}
.verdict__text {
  font-size: var(--fs-6);
  line-height: 1.55;
}
.verdict[data-tone='ok'] .verdict__text {
  color: var(--tone-ok-text);
}
.verdict[data-tone='warn'] .verdict__text {
  color: var(--tone-warn-text);
}
.verdict[data-tone='err'] .verdict__text {
  color: var(--tone-err-text);
}

.block {
  display: flex;
  flex-direction: column;
  gap: 9px;
  min-width: 0;
}
.value {
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--surface);
  font-family: var(--mono);
  font-size: var(--fs-4);
  line-height: 1.55;
  color: var(--ink);
  overflow-wrap: anywhere;
  transition: all 0.2s;
}
.value--small {
  font-size: var(--fs-2);
  color: var(--text-muted);
}
/* Объект, который не изменился, — сам по себе ответ: гасим его, чтобы это было видно сразу. */
.value[data-changed='no'] {
  border-color: var(--divider);
  background: var(--sunk-dim);
  color: var(--dim);
}

.lock-lab-foot {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}
.lock-lab-foot__rule {
  color: var(--text-faint);
}

@media (max-width: 720px) {
  .split {
    grid-template-columns: 1fr;
  }
  .pane {
    border-right: 0;
    border-bottom: 1px solid var(--divider);
  }
}
</style>
