<script setup lang="ts">
/**
 * Реентерантность вживую: пять сценариев, в каждом колбэк ломает того, кто его вызвал.
 *
 * В теме эти пять ситуаций были набраны руками — две карточки с готовыми строками порядка
 * вызовов и три примера с дописанным ответом в комментарии. Здесь заранее написанных ответов
 * нет: каждый сценарий выполняется в браузере читателя, и на экран едет то, что получилось.
 *
 * Считает не компонент, а `model/run.ts`: тот же модуль читает юнит-тест, и страница
 * с тестом разойтись не могут. Здесь только показ.
 *
 * ⚠️ **Источник ответа подписан у каждого сценария, и это не вежливость.** `EventTarget`
 * и `forEach` — настоящие и нормативные; эмиттер в стиле Node — **модель**, потому что
 * `node:events` в браузере нет; `sort` с мутирующим компаратором и глубина рекурсии — это
 * «что вышло в этом движке», а не «как устроен язык». Читатель обязан видеть разницу,
 * иначе демо выдало бы модель за Node, а случайность — за правило.
 *
 * Прогон идёт в `onMounted` и на каждую смену сценария: `EventTarget` и `Event` в Node тоже
 * есть, но остров сперва рендерится на сервере, и трогать среду до гидратации незачем.
 */
import { computed, onMounted, ref, watch } from 'vue';
import CodeListing from '@/shared/ui/CodeListing.vue';
import ConsoleView from '@/shared/ui/ConsoleView.vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { runScenario, SCENARIOS } from '../model/run';
import type { DispatchKey, DispatchRun } from '../model/types';

// Подпись по желанию темы. Умолчание «Общее правило: синхронный колбэк не должен менять
// структуру…» снято 2026-09-30: в «Колбэках» то же правило стоит плашкой прямо над демо.
defineProps<{ note?: string }>();

const OPTIONS = SCENARIOS.map((item) => ({ value: item.key, label: item.label }));

const key = ref<DispatchKey>('target');
const scenario = computed(() => SCENARIOS.find((item) => item.key === key.value) ?? SCENARIOS[0]);

const run = ref<DispatchRun | null>(null);
const refresh = () => {
  run.value = runScenario(key.value);
};

onMounted(refresh);
watch(key, refresh);

/** Снятый, но всё равно вызванный слушатель — янтарный: ради этой фишки демо и сделано. */
const chipsOf = (order: string[], stale: string[]) =>
  order.map((text) => ({ text, tone: stale.includes(text) ? ('warn' as const) : ('ok' as const) }));

const SOURCE_LABEL: Record<string, string> = {
  spec: 'настоящий механизм браузера',
  model: 'модель Node, а не Node',
  engine: 'ответ этого движка, не спецификации',
};
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="bar">
        <span class="bar__label">сценарий:</span>
        <SegmentedControl v-model="key" class="l-pills" label="Сценарий реентерантности" :options="OPTIONS" />
      </div>
    </template>

    <div class="split">
      <div class="pane">
        <Md class="title" :text="scenario.title" />
        <Md class="lead" :text="scenario.lead" />
        <CodeListing :lines="scenario.code" label="что исполнилось" />
      </div>

      <div class="pane pane--right">
        <p v-if="!run" class="wait">сценарий выполняется в вашем браузере…</p>

        <template v-else>
          <div v-if="run.rounds.length" class="rounds">
            <div v-for="round in run.rounds" :key="round.label" class="round">
              <ConsoleView :label="round.label" :chips="chipsOf(round.order, round.stale)" :min-height="40" />
              <Md class="round__note" :text="round.note" />
            </div>
          </div>

          <ConsoleView v-else-if="run.log.length" :lines="run.log" label="вывод" :min-height="96" />

          <div class="values">
            <div v-for="item in run.values" :key="item.label" class="value">
              <span class="t-label">{{ item.label }}</span>
              <!-- `data-code` помечает поддерево как код: скобки и кавычки внутри принадлежат
                   значению, а не разметке. -->
              <span class="value__box" data-code>{{ item.value }}</span>
            </div>
          </div>

          <div v-if="run.errorName" class="err">
            <span class="err__name">{{ run.errorName }}</span>
            <span class="err__text">{{ run.error }}</span>
          </div>

          <div class="verdict" :data-tone="run.tone"><Md :text="run.verdict" /></div>
        </template>
      </div>
    </div>

    <template #footer>
      <div class="dispatch-lab-foot">
        <div class="source" :data-source="scenario.source">
          <span class="source__tag">{{ SOURCE_LABEL[scenario.source] }}</span>
          <Md class="source__text" :text="scenario.caveat" />
        </div>
        <Md v-if="note" class="dispatch-lab-foot__rule" :text="note" />
      </div>
    </template>
  </DemoFrame>
</template>

<style scoped>
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
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
}
.pane {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
  border-right: 1px solid var(--divider);
  min-width: 0;
}
.pane--right {
  border-right: 0;
  background: var(--surface-2);
  gap: 16px;
}

.title {
  font-size: var(--fs-6);
  font-weight: 600;
  line-height: 1.35;
  color: var(--ink);
}
.lead {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--prose);
}
.wait {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--dim);
}

.rounds {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.round {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.round__note {
  font-size: var(--fs-4);
  line-height: 1.5;
  color: var(--text-muted);
}

.values {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.value {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.value__box {
  padding: 9px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--surface);
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.5;
  color: var(--ink);
  overflow-wrap: anywhere;
}

.err {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 12px 14px;
  border-radius: var(--r2);
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
}
.err__name {
  font-family: var(--mono);
  font-size: var(--fs-3);
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--tone-err-strong);
}
/* Текст ошибки — дословный от движка, поэтому моно и с переносом в любом месте. */
.err__text {
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.5;
  color: var(--tone-err-text);
  overflow-wrap: anywhere;
}

.verdict {
  padding: 13px 15px;
  border-radius: var(--r2);
  font-size: var(--fs-5);
  line-height: 1.55;
}
.verdict[data-tone='ok'] {
  border: 1px solid var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.verdict[data-tone='warn'] {
  border: 1px solid var(--tone-warn-line);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.verdict[data-tone='err'] {
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}

.dispatch-lab-foot {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
/* Подпись источника стоит раньше вывода по важности: от неё зависит, чем этот вывод является. */
.source {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  border-radius: var(--r2);
  border: 1px solid var(--border);
  background: var(--surface);
}
.source__tag {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-faint);
}
.source__text {
  font-size: var(--fs-4);
  line-height: 1.55;
  color: var(--text-muted);
}
.source[data-source='model'] {
  border-color: var(--tone-warn-line);
  background: var(--tone-warn-bg);
}
.source[data-source='model'] .source__tag {
  color: var(--tone-warn-strong);
}
.source[data-source='model'] .source__text {
  color: var(--tone-warn-text);
}
.source[data-source='engine'] {
  border-color: var(--tone-info-line);
  background: var(--tone-info-bg);
}
.source[data-source='engine'] .source__tag {
  color: var(--tone-info-strong);
}
.source[data-source='engine'] .source__text {
  color: var(--tone-info-text);
}

.dispatch-lab-foot__rule {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
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
