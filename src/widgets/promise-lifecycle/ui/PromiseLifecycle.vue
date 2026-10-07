<script setup lang="ts">
/**
 * Живой объект промиса: подписка кладёт реакцию в список, резолв выкидывает список в очередь.
 *
 * Раздел объяснял это словами — «подписка ничего не стоит, тики тратит резолв», — и рядом
 * стояла статичная картинка объекта, на которой ничего никогда не происходило. Тезис урока
 * проверяется здесь руками: жмёшь `.then` сколько угодно раз, счётчик тиков стоит на нуле;
 * жмёшь `resolve()` — весь список разом уезжает в очередь, и вот тогда начинают тратиться тики.
 *
 * Механика не своя: те же три операции спеки, что и у линейки (`shared/lib/promise-sim`).
 * Одна модель на оба демо — иначе они начнут рассказывать разное на одной странице.
 */
import { ref, shallowRef } from 'vue';
import { createRuntime, type SimPromise } from '@/shared/lib/promise-sim';
import { Button } from '@/shared/ui';

const runtime = shallowRef(createRuntime());
const target = shallowRef<SimPromise>(runtime.value.pending());

const state = ref<'pending' | 'fulfilled'>('pending');
const reactions = ref<string[]>([]);
const queue = ref<{ job: string; note: string }[]>([]);
const output = ref<string[]>([]);
const spent = ref(0);
const hint = ref('Промис в ожидании. Всё, что происходит дальше, — ваши решения.');

let subscriptions = 0;

function sync() {
  state.value = target.value.state;
  reactions.value = target.value.reactions.map((reaction) => reaction.note);
  queue.value = runtime.value.queue.map((job) => ({ job: job.job, note: job.note }));
}

function subscribe() {
  subscriptions += 1;
  const label = `r${subscriptions}`;
  const wasPending = target.value.state === 'pending';

  runtime.value.performPromiseThen(target.value, label, {
    then: () => output.value.push(`${label} выполнилась`),
  });

  hint.value = wasPending
    ? `.then(${label}) на pending — запись в список. Потрачено тиков: 0`
    : `.then(${label}) на settled — job сразу в очередь, это будет +1 тик`;
  sync();
}

function resolve() {
  const moved = target.value.reactions.length;
  runtime.value.resolvePromise(target.value, 'value');
  hint.value = moved
    ? `resolve() — состояние зафиксировано навсегда, список из ${moved} реакц${moved === 1 ? 'ии' : 'ий'} уехал в очередь`
    : 'resolve() — состояние зафиксировано навсегда. Список пуст, в очередь ничего не ушло';
  sync();
}

function step() {
  const done = runtime.value.step();
  if (!done) {
    hint.value = 'Очередь пуста — тратить нечего.';
    return;
  }
  spent.value += 1;
  hint.value = `тик ${done.tick}: ${done.job} — ${done.note}`;
  sync();
}

function reset() {
  runtime.value = createRuntime();
  target.value = runtime.value.pending();
  subscriptions = 0;
  spent.value = 0;
  output.value = [];
  hint.value = 'Промис в ожидании. Всё, что происходит дальше, — ваши решения.';
  sync();
}

sync();
</script>

<template>
  <div class="frame">
    <div class="toolbar">
      <Button variant="secondary" @click="subscribe">.then(r{{ subscriptions + 1 }})</Button>
      <Button variant="secondary" :disabled="state === 'fulfilled'" @click="resolve">resolve()</Button>
      <Button variant="primary" :disabled="queue.length === 0" @click="step">шаг очереди →</Button>
      <Button variant="secondary" @click="reset">сброс</Button>
      <span class="spent">потрачено тиков: {{ spent }}</span>
    </div>

    <div class="split">
      <div class="pane">
        <div class="t-label">объект промиса</div>

        <div class="slot-row">
          <span class="slot">[[PromiseState]]</span>
          <span class="state" :data-state="state">{{ state }}</span>
        </div>

        <div class="slot-row slot-row--column">
          <span class="slot">[[PromiseFulfillReactions]]</span>
          <TransitionGroup name="chip" tag="div" class="chips">
            <span v-for="label in reactions" :key="label" class="chip chip--reaction">{{ label }}</span>
            <span v-if="!reactions.length" key="empty" class="empty">список пуст</span>
          </TransitionGroup>
        </div>

        <div class="note">
          Подписка на pending — запись в массив. Ноль микрозадач, сколько бы их ни было.
        </div>
      </div>

      <div class="pane pane--queue">
        <div class="t-label">очередь микрозадач</div>

        <TransitionGroup name="chip" tag="div" class="chips chips--column">
          <span v-for="(job, i) in queue" :key="`${job.note}-${i}`" class="chip chip--job">
            {{ job.job }} · {{ job.note }}
          </span>
          <span v-if="!queue.length" key="empty" class="empty">очередь пуста</span>
        </TransitionGroup>

        <div class="console">
          <div v-if="!output.length" class="console__empty">консоль молчит</div>
          <div v-for="(line, i) in output" :key="i" class="console__line">{{ line }}</div>
        </div>
      </div>
    </div>

    <div class="hint">{{ hint }}</div>
  </div>
</template>

<style scoped>
.frame {
  background: var(--surface);
  box-shadow: var(--shadow-2);
  border-radius: var(--r4);
  overflow: hidden;
}

.toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--divider);
}
.spent {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-faint);
}

.split {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr));
}
.pane {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px;
}
.pane--queue {
  background: var(--surface-2);
  border-left: 1px solid var(--divider);
}

.slot-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}
.slot-row--column {
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
}
.slot {
  font-family: var(--mono);
  font-size: var(--fs-3);
  font-weight: 600;
}

.state {
  padding: 3px 9px;
  border-radius: var(--r-full);
  font-family: var(--mono);
  font-size: var(--fs-2);
}
.state[data-state='pending'] {
  background: var(--surface-3);
  color: var(--text-muted);
}
.state[data-state='fulfilled'] {
  background: var(--tone-ok-chip);
  color: var(--tone-ok-strong);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.chips--column {
  flex-direction: column;
  align-items: flex-start;
}
.chip {
  padding: 4px 10px;
  border-radius: var(--r1);
  font-family: var(--mono);
  font-size: var(--fs-2);
  overflow-wrap: anywhere;
}
.chip--reaction {
  border: 1px solid var(--tone-info-line);
  background: var(--surface);
  color: var(--tone-info-strong);
}
.chip--job {
  border: 1px solid var(--tone-warn-line);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.empty {
  font-family: var(--mono);
  font-size: var(--fs-2);
  font-style: italic;
  color: var(--ghost);
}

/* Переезд реакции из списка в очередь — тот же 0.18s, что у остальных переходов урока. */
.chip-enter-active,
.chip-leave-active {
  transition: all 0.18s;
}
.chip-enter-from,
.chip-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.note {
  font-size: var(--fs-5);
  line-height: 1.5;
  color: var(--prose);
}

.console {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 11px 13px;
  border-radius: var(--r2);
  background: var(--ink);
}
.console__line {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--tone-ok-on-ink);
}
.console__empty {
  font-family: var(--mono);
  font-size: var(--fs-2);
  font-style: italic;
  color: var(--ink-faint);
}

.hint {
  padding: 13px 18px;
  border-top: 1px solid var(--divider);
  background: var(--tone-info-bg);
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.5;
  color: var(--tone-info-text);
}
</style>
