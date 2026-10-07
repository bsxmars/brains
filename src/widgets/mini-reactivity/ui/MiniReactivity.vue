<script setup lang="ts">
/**
 * Мини-Vue изнутри: таблица зависимостей, очередь и журнал — для реализации, собранной
 * из той самой строки, что напечатана в теме.
 *
 * Чем отличается от `widgets/reactive-graph`. Тот показывает **настоящий** Vue снаружи —
 * рёбра он отмечает рядом с чтением, потому что внутренности Vue закрыты, а отладочные
 * хуки вырезаны из продакшен-сборки. Здесь внутренности открыты по построению: мини-версия
 * отдаёт свой `targetMap` и свою очередь, и граф — это прочитанное из них, а не отпечаток.
 *
 * Вся логика — в `model/session.ts`, её же исполняет `tests/unit/vue-internals.test.ts`.
 * Компонент только переносит снимки на экран.
 *
 * ⚠️ **Сеанс лежит в обычной переменной, а не в `ref`.** Внутри него свои прокси мини-Vue;
 * `ref` Vue завернул бы их в свои, и чтения из шаблона пошли бы через две реактивности
 * сразу. На экран попадают только снимки — обычные объекты, которые модель уже собрала.
 *
 * ⚠️ **Сборка — в `onMounted`, не в `setup`.** `setup` острова исполняется и на сборке
 * страницы; `new Function` и прогон сценария там не нужны никому.
 */
import { computed, onMounted, ref, shallowRef, watch } from 'vue';
import CodeListing from '@/shared/ui/CodeListing.vue';
import ConsoleView from '@/shared/ui/ConsoleView.vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button, SegmentedControl } from '@/shared/ui';
import { MiniSession } from '../model/session';
import type { LogEntry, MiniScenario, StepResult, SubKind } from '../model/types';

const props = defineProps<{ code: string; scenarios: MiniScenario[] }>();

const picked = ref(props.scenarios[0]?.id ?? '');
const options = computed(() => props.scenarios.map((s) => ({ value: s.id, label: s.label })));
const scenario = computed(() => props.scenarios.find((s) => s.id === picked.value) ?? props.scenarios[0]);

let session: MiniSession | null = null;
const step = shallowRef<StepResult | null>(null);
const heading = ref('');
const busy = ref(false);

async function boot() {
  busy.value = true;
  session = new MiniSession(props.code, scenario.value);
  heading.value = 'установка сценария';
  step.value = await session.start();
  busy.value = false;
}

async function act(index: number) {
  if (!session || busy.value) return;
  busy.value = true;
  heading.value = scenario.value.actions[index];
  step.value = await session.act(index);
  busy.value = false;
}

watch(picked, boot);
onMounted(boot);

const setupLines = computed(() => scenario.value.setup.split('\n'));

const entry = (e: LogEntry) => `  [${e.active ?? '—'}] ${e.text}`;
const list = (names: string[]) => (names.length ? names.join(', ') : 'пусто');

/** Журнал шага строками консоли: синхронная часть, снимок очереди, слив. */
const journal = computed(() => {
  const s = step.value;
  if (!s) return [];
  const lines = [`> ${heading.value}`, ...s.sync.map(entry)];
  if (!s.sync.length) lines.push('  синхронно не выполнилось ничего');
  lines.push(`— синхронный код закончился · очередь pre: ${list(s.queued.pre)} · post: ${list(s.queued.post)}`);
  if (s.flush.length) lines.push('— микрозадача: flush', ...s.flush.map(entry));
  else lines.push('— микрозадача: сливать нечего');
  return lines;
});

const KIND_LABEL: Record<SubKind, string> = { effect: 'effect', computed: 'computed', job: 'в очередь' };
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="picked" class="l-pills" label="Сценарий" :options="options" />
    </template>

    <div class="mr-split">
      <div class="mr-pane">
        <CodeListing :lines="setupLines" label="код сценария · исполняется как написан" />

        <div class="mr-actions">
          <Button
            v-for="(action, i) in scenario.actions"
            :key="action"
            variant="secondary"
            :disabled="busy || !step"
            @click="act(i)"
          >
            {{ action }}
          </Button>
          <Button variant="secondary" :disabled="busy" @click="boot">сброс</Button>
        </div>

        <Md class="mr-note" :text="scenario.note" />
      </div>

      <div class="mr-pane mr-pane--side">
        <div class="mr-head">
          <span class="t-label">targetMap · Dep · подписчики</span>
          <span v-if="step" class="mr-active">activeEffect после шага: {{ step.active ?? 'null' }}</span>
        </div>

        <div v-if="!step" class="mr-empty">сценарий ещё не запущен</div>
        <div v-else-if="!step.graph.length" class="mr-empty">таблица пуста — под эффектом никто ничего не читал</div>

        <div v-for="row in step?.graph ?? []" :key="row.label" class="mr-dep" :data-kind="row.kind">
          <div class="mr-dep__head">
            <span class="mr-dep__label">{{ row.label }}</span>
            <span class="mr-dep__meta">
              <span v-if="row.dirty !== undefined" class="mr-dirty" :data-dirty="row.dirty ? 'yes' : 'no'">
                {{ row.dirty ? 'dirty' : 'свежий' }}
              </span>
              version {{ row.version }}
            </span>
          </div>
          <div class="mr-subs">
            <span v-if="!row.subs.length" class="mr-subs__none">подписчиков нет</span>
            <span v-for="sub in row.subs" :key="sub.name" class="mr-sub" :data-kind="sub.kind">
              {{ sub.name }}<span> · {{ KIND_LABEL[sub.kind] }}</span>
            </span>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <ConsoleView
        :lines="journal"
        label="журнал шага · [activeEffect] вывод"
        empty-label="сценарий ещё не запущен"
        :min-height="120"
      />
    </template>
  </DemoFrame>
</template>

<style scoped>
.mr-split {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr));
  gap: 20px;
  padding: 20px;
}
.mr-pane {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}
.mr-pane--side {
  gap: 10px;
}

.mr-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.mr-note {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--prose);
}

.mr-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}
/* Между шагами `activeEffect` всегда пуст — это и есть его главное свойство. */
.mr-active {
  padding: 3px 8px;
  border-radius: var(--r-full);
  background: var(--surface-3);
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--chip-text);
}

.mr-empty,
.mr-subs__none {
  font-family: var(--mono);
  font-size: var(--fs-2);
  font-style: italic;
  color: var(--ghost);
}

/* Строка таблицы: один Dep. Засечка слева — род ключа: обычный, перебор, computed. */
.mr-dep {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 10px 12px;
  border-radius: var(--r2);
  background: var(--surface-2);
  box-shadow: inset 2px 0 0 var(--tone-info-line);
}
.mr-dep[data-kind='iterate'] {
  box-shadow: inset 2px 0 0 var(--tone-ok-strong);
}
.mr-dep[data-kind='computed'] {
  box-shadow: inset 2px 0 0 var(--tone-warn-accent);
}
.mr-dep__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 6px;
}
.mr-dep__label {
  font-family: var(--mono);
  font-size: var(--fs-3);
  font-weight: 600;
  color: var(--ink);
  overflow-wrap: anywhere;
}
.mr-dep__meta {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
  white-space: nowrap;
}
.mr-dirty {
  padding: 1px 6px;
  border-radius: var(--r-full);
  background: var(--tone-ok-chip);
  color: var(--tone-ok-text);
}
.mr-dirty[data-dirty='yes'] {
  background: var(--tone-warn-chip);
  color: var(--tone-warn-text);
}

.mr-subs {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.mr-sub {
  padding: 3px 8px;
  border-radius: var(--r-full);
  background: var(--tone-info-chip);
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--tone-info-text);
}
.mr-sub[data-kind='computed'] {
  background: var(--tone-warn-chip);
  color: var(--tone-warn-text);
}
.mr-sub[data-kind='job'] {
  background: var(--tone-ok-chip);
  color: var(--tone-ok-text);
}
</style>
