<script setup lang="ts">
/**
 * Генератор — корутина, а не источник значений. Прогоните его руками.
 *
 * Демо отвечает на вопрос, который из кода не виден: `next(v)` не «берёт следующее значение»,
 * а **возобновляет функцию, подставив `v` результатом того `yield`, на котором она стоит**.
 * Отсюда и главный сюрприз: аргумент первого `next()` теряется, потому что стоять ещё негде.
 *
 * Кнопки не отключаются на completed намеренно: «исчерпанный генератор отвечает так навсегда» —
 * это факт, который надо увидеть, а не запрет, который надо обойти.
 *
 * Вся логика переходов — в `model/machine.ts`, чистая и сверенная с Node 24.11.
 */
import { computed, ref } from 'vue';
import CodeListing from '@/shared/ui/CodeListing.vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import { Button } from '@/shared/ui';
import { callNext, callReturn, callThrow, createMachine } from '../model/machine';
import Md from '@/shared/ui/Md.vue';

const props = defineProps<{
  code: string[];
  /** Подсвеченная строка для каждого состояния: индекс массива — фаза. */
  lineByPhase: number[];
  /** Подпись состояния для каждой фазы. */
  labels: string[];
}>();

const machine = ref(createMachine());

const phase = computed(() => machine.value.phase);
const activeLine = computed(() => props.lineByPhase[phase.value] ?? -1);
const stateLabel = computed(() => props.labels[phase.value] ?? '');

const next = (v: string | number | null) => { machine.value = callNext(machine.value, v); };
const doThrow = () => { machine.value = callThrow(machine.value); };
const doReturn = () => { machine.value = callReturn(machine.value); };
const reset = () => { machine.value = createMachine(); };
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="bar">
        <Button variant="primary" @click="next(null)">next()</Button>
        <Button variant="primary" @click="next('Аня')">next('Аня')</Button>
        <Button variant="primary" @click="next(30)">next(30)</Button>
        <Button variant="secondary" @click="doThrow">throw(Error)</Button>
        <Button variant="secondary" @click="doReturn">return('стоп')</Button>
        <Button variant="secondary" @click="reset">сброс</Button>
      </div>
    </template>

    <div class="split">
      <div class="pane pane--code">
        <CodeListing :lines="code" :active="activeLine" tone="dark" label="function* dialog()" />

        <div class="state">
          <span class="t-label">состояние</span>
          <span class="state__pill" :data-done="phase === 3 ? 'yes' : 'no'">{{ stateLabel }}</span>
        </div>
      </div>

      <div class="pane">
        <div class="t-label">журнал вызовов</div>

        <div v-if="!machine.log.length" class="empty">
          Генератор создан. Тело ещё не выполнялось — вызов <code>dialog()</code> не выполняет
          ни одной строки.
        </div>

        <div v-for="(entry, i) in machine.log" :key="i" class="entry" :data-tone="entry.tone ?? 'plain'">
          <span class="entry__call">{{ entry.call }}</span>
          <span class="entry__res">{{ entry.res }}</span>
          <Md as="span" class="entry__note" :text="entry.note" />
        </div>
      </div>
    </div>
  </DemoFrame>
</template>

<style scoped>
.bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
}
.pane {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
  min-width: 0;
}
/* Листинг на чернилах: код здесь не читают построчно, за ним следят — где сейчас пауза. */
.pane--code {
  background: var(--ink);
  border-right: 1px solid var(--ink-line);
}
.pane--code :deep(.t-label) {
  color: var(--ink-faint);
}

.state {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 9px;
}
.state__pill {
  padding: 5px 11px;
  border-radius: var(--r-full);
  font-family: var(--mono);
  font-size: var(--fs-2);
  background: var(--ink-chip);
  color: var(--tone-info-on-ink);
  transition: all 0.2s;
}
/* Закрытый генератор гаснет: это конец, а не очередное состояние. */
.state__pill[data-done='yes'] {
  color: var(--ink-faint);
}

.empty {
  font-size: var(--fs-6);
  font-style: italic;
  line-height: 1.55;
  color: var(--text-muted);
}

.entry {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 11px 13px;
  border-radius: var(--r2);
}
.entry[data-tone='plain'] {
  border: 1px solid var(--border);
  background: var(--surface);
}
.entry[data-tone='warn'] {
  border: 1px solid var(--tone-warn-line);
  background: var(--tone-warn-bg);
}
.entry[data-tone='err'] {
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
}

.entry__call {
  font-family: var(--mono);
  font-size: var(--fs-3);
  font-weight: 600;
  color: var(--ink);
}
.entry__res {
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.5;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}
.entry__note {
  font-size: var(--fs-5);
  line-height: 1.5;
  color: var(--prose);
}
.entry[data-tone='warn'] .entry__note {
  color: var(--tone-warn-text);
}
.entry[data-tone='err'] .entry__note {
  color: var(--tone-err-text);
}

@media (max-width: 720px) {
  .split {
    grid-template-columns: 1fr;
  }
  .pane--code {
    border-right: 0;
    border-bottom: 1px solid var(--ink-line);
  }
}
</style>
