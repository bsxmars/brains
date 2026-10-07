<script setup lang="ts">
/**
 * Круговой импорт, выполненный по-настоящему: два модуля грузятся `import()` прямо здесь.
 *
 * Ради чего демо вообще есть. «Работало в dev, упало в проде» перестаёт быть мистикой ровно
 * в тот момент, когда видно две вещи разом: какое тело пошло первым и что именно сказал движок.
 * Пересказ ошибки этого не даёт — читатель запоминает слова, а не механику.
 *
 * ⚠️ Прогон ровно один на загрузку страницы, и кнопки «ещё раз» здесь нет намеренно. Модуль
 * исполняется один раз на URL, а результат — успех он или исключение — остаётся в карте модулей
 * навсегда. Кнопка «прогнать заново» либо врала бы (показывала бы старый результат), либо
 * требовала бы менять URL — то есть грузить уже другие модули. Вместо кнопки демо показывает
 * вторую попытку честно: тот же `import()`, тот же ответ, ни одной новой строки в журнале.
 */
import { computed, onMounted, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import { SegmentedControl } from '@/shared/ui';
import { runCycle } from '../model/run';
import type { CycleRun, CycleVariant } from '../model/types';

const OPTIONS = [
  { value: 'fn' as const, label: 'function' },
  { value: 'const' as const, label: 'const' },
];

const variant = ref<CycleVariant>('fn');
const runs = ref<Partial<Record<CycleVariant, CycleRun>>>({});

/**
 * Варианты гоняются строго по очереди: журнал у них общий (один URL — один модуль),
 * и параллельный запуск перемешал бы строки двух прогонов.
 */
onMounted(async () => {
  runs.value = { ...runs.value, fn: await runCycle('fn') };
  runs.value = { ...runs.value, const: await runCycle('const') };
});

const current = computed<CycleRun | undefined>(() => runs.value[variant.value]);
const broken = computed(() => Boolean(current.value?.error));
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="bar">
        <span class="t-label">как объявлено то, что модули берут друг у друга</span>
        <SegmentedControl v-model="variant" class="l-pills" label="Форма объявления" :options="OPTIONS" />
      </div>
    </template>

    <div class="body">
      <div v-if="!current" class="empty">грузим модули настоящим import()…</div>

      <template v-else>
        <div class="split">
          <div v-for="file in current.sources" :key="file.name" class="pane">
            <div class="t-label">{{ file.name }}</div>
            <pre class="code" data-code>{{ file.code }}</pre>
          </div>
        </div>

        <div class="out">
          <div class="t-label">журнал: что тела модулей успели записать</div>
          <div class="screen" data-code>
            <div v-for="(line, i) in current.trace" :key="i" class="line">{{ line }}</div>
            <span v-if="!current.trace.length" class="none">ни одной строки</span>
          </div>
        </div>

        <div class="verdict" :data-tone="broken ? 'err' : 'ok'">
          <template v-if="broken">
            <div class="verdict__title">Цикл не прошёл. Вот дословно то, что сказал движок:</div>
            <div class="engine" data-code>{{ current.error }}</div>
            <p class="verdict__text">
              Обратите внимание, кто упал. Обход идёт вглубь, поэтому первым выполняется тело
              второго модуля — того, который вы, скорее всего, считали нижним. Его первая же
              строка читает значение из первого, а ячейка там ещё пуста: объявлена, но не
              инициализирована.
            </p>
          </template>
          <template v-else>
            <div class="verdict__title">Цикл прошёл целиком, и в журнале видно почему.</div>
            <p class="verdict__text">
              Первым выполнилось тело второго модуля — порядок тот же самый. Но объявление
              функции инициализируется ещё на фазе связывания, до любого исполнения, поэтому
              вызов из чужого тела застаёт готовую функцию, а не пустую ячейку.
            </p>
          </template>
        </div>

        <div class="again">
          <span class="t-label">вторая попытка того же import()</span>
          <div class="again__row">
            <span class="again__value" data-code>{{ current.again }}</span>
            <span class="again__note">
              новых строк в журнале:
              <b>{{ current.addedOnSecondTry }}</b>
              — тело не выполнялось заново
            </span>
          </div>
        </div>
      </template>
    </div>

    <template #footer>
      <div class="disclaimer">
        Оба модуля — обычные файлы в <code>public/demo/modules/</code>, их можно открыть по адресу
        и сверить. Загружает их настоящий <code>import()</code> в вашем браузере, текст ошибки
        приходит от движка. Blob-URL здесь не годится принципиально: адрес блоба появляется
        только после создания блоба, а в цикле адрес каждого модуля обязан стоять внутри
        другого. Те же файлы выполняет <code>tests/unit/modules.test.ts</code> в Node.
      </div>
    </template>
  </DemoFrame>
</template>

<style scoped>
.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}

.body {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 22px 20px;
  min-width: 0;
}

.empty {
  font-family: var(--mono);
  font-size: var(--fs-3);
  font-style: italic;
  color: var(--ghost);
}

.split {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr));
  gap: 14px;
}
.pane {
  display: flex;
  flex-direction: column;
  gap: 9px;
  min-width: 0;
}
.code {
  margin: 0;
  padding: 13px 15px;
  border-radius: var(--r2);
  font-size: var(--fs-3);
  line-height: 1.7;
  overflow-x: auto;
}

.out {
  display: flex;
  flex-direction: column;
  gap: 9px;
  min-width: 0;
}
.screen {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  border-radius: var(--r2);
  background: var(--ink);
}
.line {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--tone-ok-on-ink);
  overflow-wrap: anywhere;
}
.none {
  font-family: var(--mono);
  font-size: var(--fs-2);
  font-style: italic;
  color: var(--ink-faint);
}

.verdict {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 15px 17px;
  border-radius: var(--r2);
}
.verdict[data-tone='ok'] {
  border: 1px solid var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.verdict[data-tone='err'] {
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}
.verdict__title {
  font-size: var(--fs-6);
  line-height: 1.45;
}
.verdict__text {
  margin: 0;
  font-size: var(--fs-5);
  line-height: 1.6;
}
/* Текст ошибки — единственное место демо, ради которого оно и написано: он обязан читаться
   как вывод консоли, а не как слова автора. */
.engine {
  padding: 10px 12px;
  border-radius: var(--r1);
  background: var(--ink);
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.55;
  color: var(--tone-warn-on-ink);
  overflow-wrap: anywhere;
}

.again {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.again__row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px 14px;
}
.again__value {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--chip-text);
  overflow-wrap: anywhere;
}
.again__note {
  font-size: var(--fs-5);
  line-height: 1.5;
  color: var(--text-muted);
}
.again__note b {
  color: var(--ink);
}

.disclaimer {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}
</style>
