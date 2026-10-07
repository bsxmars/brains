<script setup lang="ts">
/**
 * Стенд достижимости: единственное в теме про сборщик, что выполняется у читателя по-настоящему.
 *
 * Зачем он. Пять остальных островов темы листают записанные данные — и это законно там, где
 * наблюдать нечего: ни момент сборки, ни поколение объекта, ни содержимое полусфер из JS
 * не видны. Но **один** факт со страницы наблюдаем по-настоящему: что объект **уже собран**.
 * `WeakRef.deref()` вернул `undefined`, финализатор сработал. Тема подробно обсуждает оба
 * инструмента — и только как то, чего брать не надо; здесь они в своей единственной честной
 * роли: не механизм освобождения, а сигнализация.
 *
 * ⚠️ **Запуск по кнопке, автостарта нет.** Остров гидратируется по `client:visible`, то есть
 * в момент прокрутки; цикл давления занимает поток на доли секунды, и запуск без спроса
 * выглядел бы зависанием страницы ровно там, где читатель до неё долистал. Тот же довод,
 * что у `widgets/ic-bench`.
 *
 * ⚠️ **Компонент только показывает.** Граф ссылок строит `model/cases.ts`, давление гоняет
 * `model/run.ts`; тот же модуль зовёт юнит-тест — в Node, где есть `--expose-gc` и где те же
 * семь случаев проверяются детерминированно. Заранее написанных ответов в данных нет.
 *
 * ⚠️ **Разметка — только через `Md`.** Строка, набранная прямо в шаблоне, `inlineMd` не проходит:
 * вчера на этом попался `ic-bench` — `**жирное**` уехало читателю звёздочками.
 */
import { computed, ref } from 'vue';
import ConsoleView from '@/shared/ui/ConsoleView.vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button, SegmentedControl } from '@/shared/ui';
import { REACH_CASES } from '../model/cases';
import { DEFAULTS, runReachCase } from '../model/run';
import type { ReachCaseKey, ReachResult } from '../model/types';

const props = withDefaults(
  defineProps<{
    /** Предел по числу попыток — это же число попадает в формулировку «не собрался за N». */
    attempts?: number;
    /** Предел по времени, мс. */
    budgetMs?: number;
    /** Блоков мусора за попытку; блок — крупный массив плюс россыпь мелких объектов. */
    junkBlocks?: number;
    foot?: string;
  }>(),
  {
    attempts: DEFAULTS.attempts,
    budgetMs: DEFAULTS.budgetMs,
    junkBlocks: DEFAULTS.junkBlocks,
    foot: 'Со страницы сборку **вызвать нельзя**: `gc()` в браузере появляется, только если сам браузер запущен с `--js-flags=--expose-gc`, а у читателя так не бывает. Стенд давит на аллокатор, уступает поток и спрашивает `deref()` — и только. Поэтому «собрался» здесь доказывает недостижимость, а «не собрался за N попыток» **не доказывает ничего**: ни живости, ни утечки. `FinalizationRegistry` может не сработать никогда — это его штатное поведение, а не сбой стенда.',
  },
);

const picked = ref<ReachCaseKey>('none');
const options = computed(() => REACH_CASES.map((item) => ({ value: item.key, label: item.label })));
const spec = computed(() => REACH_CASES.find((item) => item.key === picked.value) ?? REACH_CASES[0]);

const running = ref(false);
const results = ref<Partial<Record<ReachCaseKey, ReachResult>>>({});
const result = computed(() => results.value[picked.value] ?? null);

const run = async () => {
  if (running.value) return;
  running.value = true;

  const key = picked.value;
  const next = { ...results.value };
  delete next[key];
  results.value = next;

  const measured = await runReachCase(key, {
    attempts: props.attempts,
    budgetMs: props.budgetMs,
    junkBlocks: props.junkBlocks,
  });

  results.value = { ...results.value, [key]: measured };
  running.value = false;
};

/** Подпись под вердиктом: короткая, без разметки — её читают первой. */
const AGREEMENT_LABEL: Record<string, string> = {
  proved: 'доказано',
  'as-expected': 'согласуется, но не доказано',
  inconclusive: 'вывод не получен',
  contradicts: 'опровергает утверждение случая',
  unavailable: 'среда не поддерживает',
};

const EXPECT_LABEL: Record<string, string> = {
  collected: 'объект должен исчезнуть',
  held: 'объект должен остаться',
};

/** Наблюдения в две колонки: слева что спрашивали, справа что ответил движок. */
const facts = computed(() => {
  const measured = result.value;
  if (!measured?.ok) return [];

  const rows = [
    { k: 'deref() до давления', v: measured.before ? 'объект' : 'undefined' },
    { k: 'deref() после', v: measured.collected ? 'undefined' : 'объект' },
    { k: 'попыток', v: `${measured.attempts} из ${props.attempts}` },
    { k: 'заняло', v: `${Math.round(measured.ms)} мс` },
    {
      k: 'финализатор',
      v: !measured.finalizerSupported
        ? 'в этой среде нет'
        : measured.finalized
          ? 'сработал'
          : 'не сработал — он и не обязан',
    },
    { k: 'рычаг gc()', v: measured.lever ? 'есть (Node --expose-gc)' : 'нет — обычный браузер' },
  ];

  if (measured.extraCollected !== null) {
    rows.splice(2, 0, {
      k: 'значение записи',
      v: measured.extraCollected ? 'собрано' : 'на месте',
    });
  }

  return rows;
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="rl-bar">
        <SegmentedControl v-model="picked" class="l-pills" label="Кто держит объект" :options="options" />
        <div class="rl-bar__side">
          <Button variant="primary" :disabled="running" @click="run">
            {{ running ? 'давлю…' : result ? 'проверить ещё раз' : 'проверить' }}
          </Button>
          <span v-if="running" class="rl-phase">выделяю мусор и уступаю поток</span>
          <span v-else-if="!result" class="rl-phase">ответ появится после запуска — его даёт ваш браузер</span>
        </div>
      </div>
    </template>

    <div class="rl-split">
      <div class="rl-pane">
        <div class="rl-head">
          <Md class="rl-title" :text="spec.title" />
          <span class="rl-expect" :data-expect="spec.expects">{{ EXPECT_LABEL[spec.expects] }}</span>
        </div>

        <div class="rl-holder">
          <span class="t-label">кто держит</span>
          <Md as="span" class="rl-holder__value" :text="spec.holder" />
        </div>

        <pre class="rl-code" data-code>{{ spec.code }}</pre>

        <ConsoleView
          label="протокол попыток"
          :lines="result?.log ?? []"
          :min-height="118"
          empty-label="прогон ещё не запускался"
        />
      </div>

      <div class="rl-pane rl-pane--right">
        <div class="rl-verdict" :data-agreement="result?.agreement ?? 'wait'">
          <span class="rl-verdict__head">{{ result ? AGREEMENT_LABEL[result.agreement] : 'ещё не проверяли' }}</span>
          <span class="rl-verdict__value">{{ result ? result.verdict : '—' }}</span>
        </div>

        <Md v-if="result" class="rl-note" :text="result.note" />

        <dl v-if="facts.length" class="rl-facts">
          <template v-for="fact in facts" :key="fact.k">
            <dt class="rl-facts__key">{{ fact.k }}</dt>
            <dd class="rl-facts__value">{{ fact.v }}</dd>
          </template>
        </dl>

        <Md class="rl-why" :text="spec.why" />
      </div>
    </div>

    <template #footer>
      <Md class="rl-foot" :text="foot" />
    </template>
  </DemoFrame>
</template>

<style scoped>
.rl-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}
.rl-bar__side {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}
.rl-phase {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}

.rl-split {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
}
.rl-pane {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
  border-right: 1px solid var(--divider);
  min-width: 0;
}
.rl-pane--right {
  border-right: 0;
  background: var(--surface-2);
  gap: 16px;
}

.rl-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 9px;
}
.rl-title {
  font-family: var(--mono);
  font-size: var(--fs-6);
  font-weight: 600;
  color: var(--ink);
}
/* Ожидание темы — это утверждение урока, а не ответ движка. Поэтому «пилюля» нейтральная. */
.rl-expect {
  padding: 3px 9px;
  border-radius: var(--r-full);
  background: var(--surface-3);
  font-family: var(--mono);
  font-size: var(--fs-2);
  white-space: nowrap;
  color: var(--chip-text);
}

.rl-holder {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 9px;
}
.rl-holder__value {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-muted);
}

/* `min-width: 0` рядом с прокруткой: во флекс-колонке блок иначе не сжимается ниже своего
   содержимого и утаскивает вбок всю страницу на узком экране. */
.rl-code {
  padding: 13px 15px;
  min-width: 0;
  font-size: var(--fs-2);
  line-height: 1.6;
  overflow-x: auto;
}

.rl-verdict {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 13px 15px;
  border-radius: var(--r2);
  transition: all 0.2s;
}
.rl-verdict__head {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.rl-verdict__value {
  font-family: var(--mono);
  font-size: var(--fs-6);
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.rl-verdict[data-agreement='wait'],
.rl-verdict[data-agreement='unavailable'] {
  border: 1px solid var(--divider);
  background: var(--sunk-dim);
  color: var(--dim);
}
/* Собрался там, где и ожидалось: единственный исход, который что-то доказывает. */
.rl-verdict[data-agreement='proved'] {
  border: 1px solid var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
/* Не собрался там, где держат: согласуется — но доказательством не является. */
.rl-verdict[data-agreement='as-expected'] {
  border: 1px solid var(--tone-info-line);
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
}
/* Ждали сборки, не дождались: вывод не получен. Это янтарь, а не зелёное и не красное. */
.rl-verdict[data-agreement='inconclusive'] {
  border: 1px solid var(--tone-warn-line);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
/* Собрался там, где держат: утверждение случая опровергнуто. */
.rl-verdict[data-agreement='contradicts'] {
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}

.rl-note {
  font-size: var(--fs-5);
  line-height: 1.6;
  color: var(--prose);
}

.rl-facts {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 6px 12px;
  margin: 0;
  padding-top: 14px;
  border-top: 1px solid var(--rule);
}
.rl-facts__key {
  font-size: var(--fs-4);
  line-height: 1.45;
  color: var(--text-muted);
}
.rl-facts__value {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--fs-4);
  text-align: end;
  color: var(--ink);
}

.rl-why {
  padding-top: 14px;
  border-top: 1px solid var(--rule);
  font-size: var(--fs-5);
  line-height: 1.6;
  color: var(--text-muted);
}

.rl-foot {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}

@media (max-width: 760px) {
  .rl-split {
    grid-template-columns: 1fr;
  }
  .rl-pane {
    border-right: 0;
    border-bottom: 1px solid var(--divider);
  }
  .rl-facts__value {
    white-space: normal;
  }
}
</style>
