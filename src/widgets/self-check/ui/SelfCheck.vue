<script setup lang="ts">
/**
 * Самопроверка: задача → своя попытка → разбор.
 *
 * Раздел «Проверь себя» вернулся в курс, но в другом виде. В исходных бандлах это были квизы
 * с вариантами ответа, и их не переносили: выбрать из четырёх — не то же самое, что понять.
 * В конспектах автора на их месте задачи с развёрнутыми разборами, и здесь важен сам порядок:
 * **разбор закрыт, пока читатель не решил открыть**. Открытый ответ рядом с вопросом отменяет
 * задачу — глаз забирает готовое решение раньше, чем голова успевает подумать.
 *
 * Отметка «угадал / не угадал» ничего не отправляет и никуда не сохраняется: это счётчик
 * для себя, а не оценка. Поэтому он живёт в памяти страницы и исчезает при перезагрузке.
 */
import { computed, ref } from 'vue';
import Md from '@/shared/ui/Md.vue';
import { Button } from '@/shared/ui';
import type { SelfCheckItem } from '../model/types';

const props = defineProps<{ items: SelfCheckItem[] }>();

const opened = ref(new Set<number>());
const hinted = ref(new Set<number>());
/** `true` — «понял», `false` — «нет»; отсутствие ключа значит «ещё не отвечал». */
const verdicts = ref(new Map<number, boolean>());

/*
 * Шаблон разворачивает ссылки: `toggle(hinted, i)` из шаблона передавал сам `Set`, а не `Ref`,
 * `set.value` оказывался `undefined`, и кнопки «подсказка» и «показать разбор» молча ничего
 * не делали (найдено `vue-tsc`, та же ошибка, что в `widgets/procedure` — см. AGENTS.md).
 * Поэтому шаблон передаёт имя, а ссылку разворачивает скрипт.
 */
const sets = { opened, hinted };
const toggle = (which: keyof typeof sets, i: number) => {
  const set = sets[which];
  const next = new Set(set.value);
  if (next.has(i)) next.delete(i);
  else next.add(i);
  set.value = next;
};

const mark = (i: number, ok: boolean) => {
  const next = new Map(verdicts.value);
  next.set(i, ok);
  verdicts.value = next;
};

const answered = computed(() => verdicts.value.size);
const right = computed(() => [...verdicts.value.values()].filter(Boolean).length);
const score = computed(() =>
  answered.value === 0
    ? `${props.items.length} задач`
    : `${right.value} из ${answered.value} · всего ${props.items.length}`,
);
</script>

<template>
  <section class="check">
    <header class="head">
      <span class="t-eyebrow t-eyebrow--panel">проверь себя</span>
      <span class="score">{{ score }}</span>
    </header>

    <ol class="list">
      <li v-for="(item, i) in items" :key="i" class="item" :data-state="verdicts.get(i) === undefined ? 'open' : verdicts.get(i) ? 'ok' : 'miss'">
        <div class="row">
          <span class="num">{{ String(i + 1).padStart(2, '0') }}</span>
          <Md class="question" :text="item.question" />
        </div>

        <Md v-if="item.hint && hinted.has(i)" class="hint" :text="item.hint" />

        <div class="actions">
          <Button v-if="item.hint && !hinted.has(i)" variant="secondary" @click="toggle('hinted', i)">
            подсказка
          </Button>
          <Button variant="secondary" @click="toggle('opened', i)">
            {{ opened.has(i) ? 'скрыть разбор' : 'показать разбор' }}
          </Button>
        </div>

        <div v-if="opened.has(i)" class="answer">
          <Md :text="item.answer" />
          <div class="verdict">
            <span class="verdict__label">сошлось?</span>
            <button class="mark" type="button" :aria-pressed="verdicts.get(i) === true" @click="mark(i, true)">
              да
            </button>
            <button class="mark" type="button" :aria-pressed="verdicts.get(i) === false" @click="mark(i, false)">
              нет
            </button>
          </div>
        </div>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.check {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}
.score {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}

.list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.item {
  display: flex;
  flex-direction: column;
  gap: 11px;
  padding: 18px 20px;
  border-radius: var(--r2);
  background: var(--surface);
  box-shadow: var(--shadow-card);
  transition: all 0.18s;
}
/* Отметка видна краем: по колонке слева понятно, что уже разобрано. */
.item[data-state='ok'] {
  box-shadow: inset 3px 0 0 var(--tone-ok-strong), var(--shadow-card);
}
.item[data-state='miss'] {
  box-shadow: inset 3px 0 0 var(--tone-warn-strong-2), var(--shadow-card);
}

.row {
  display: flex;
  align-items: baseline;
  gap: 12px;
  min-width: 0;
}
.num {
  flex-shrink: 0;
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--accent);
}
.question {
  font-size: var(--fs-6);
  line-height: 1.55;
  color: var(--ink);
}

.hint {
  padding: 12px 14px;
  border-radius: var(--r1);
  background: var(--tone-warn-bg);
  font-size: var(--fs-5);
  line-height: 1.5;
  color: var(--tone-warn-text);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.answer {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 16px;
  border-radius: var(--r1);
  background: var(--tone-info-bg);
  font-size: var(--fs-6);
  line-height: 1.6;
  color: var(--tone-info-text);
}

.verdict {
  display: flex;
  align-items: center;
  gap: 8px;
}
.verdict__label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--tone-info-strong);
}
.mark {
  padding: 4px 12px;
  border: 1px solid var(--tone-info-line);
  border-radius: var(--r-full);
  background: transparent;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--tone-info-strong);
  cursor: pointer;
  transition: all 0.18s;
}
.mark[aria-pressed='true'] {
  background: var(--tone-info-strong);
  color: var(--on-ink);
}
</style>
