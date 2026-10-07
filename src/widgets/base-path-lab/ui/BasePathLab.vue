<script setup lang="ts">
/**
 * Что делает с путями сайта базовый путь.
 *
 * ⚠️ **Это не симуляция хостинга.** Все строки описи сняты с двух настоящих сборок этого
 * самого сайта — обычной и собранной командой `astro build --base /repo/`, — вместе
 * с количеством: сколько таких путей нашлось обходом `dist`. Переключатель не «пересобирает»
 * ничего, он показывает два снятых состояния рядом.
 *
 * Почему демо вообще нужно. Разницу между «путь написал сборщик» и «путь написали вы»
 * в исходнике не видно: обе записи выглядят одинаково (`/_astro/x.css` и `/js/event-loop/`),
 * обе работают на `localhost`, и сборка с другой базой проходит успешно в обоих случаях.
 * Разница появляется только в собранном файле — и вот она.
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { normalizeBase, originOf, tally, verdicts } from '../model/paths';
import type { BaseOption, PathRow } from '../model/types';

const props = defineProps<{
  rows: PathRow[];
  bases: BaseOption[];
  /** Подпись под демо: на какой сборке сняты числа. Разрешена строчная разметка. */
  caption: string;
}>();

const base = ref(props.bases[0].value);
const options = props.bases.map((b) => ({ value: b.value, label: b.label }));

const root = computed(() => normalizeBase(base.value));
const origin = computed(() => originOf(props.bases, base.value));

const list = computed(() => verdicts(props.rows, base.value));
const counts = computed(() => tally(props.rows, base.value));

/** Доля уцелевшего — для полосы над таблицей. Она же ответ на вопрос «насколько всё плохо». */
const okShare = computed(() =>
  counts.value.total === 0 ? 0 : Math.round((counts.value.ok / counts.value.total) * 100),
);

const AUTHOR: Record<string, string> = {
  builder: 'сборщик',
  hand: 'человек',
};
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="bar">
        <SegmentedControl v-model="base" class="l-pills" label="Базовый путь сайта" :options="options" />
        <span class="origin">сайт живёт на <code>{{ origin }}</code></span>
      </div>
    </template>

    <div class="body">
      <div class="score">
        <div class="score__line">
          <span class="score__fill" :style="`width:${okShare}%`" />
        </div>
        <div class="score__nums">
          <span class="num num--ok"><b>{{ counts.ok }}</b> откроются</span>
          <span class="num num--err"><b>{{ counts.broken }}</b> дадут 404</span>
          <span class="num num--dim">из {{ counts.total }} путей в собранном сайте</span>
        </div>
      </div>

      <div class="wrap">
        <table>
          <thead>
            <tr>
              <th>путь в собранном файле</th>
              <th>где стоит</th>
              <th>кто написал</th>
              <th>что будет</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in list" :key="item.row.id" :data-ok="item.ok ? 'yes' : 'no'">
              <td>
                <code class="path">{{ item.emitted }}</code>
                <span class="count">× {{ item.row.count }}</span>
              </td>
              <!-- Через `Md`, а не `{{ }}`: в описании места почти всегда стоит имя
                   в обратных кавычках (`url()` в CSS, `<link rel=stylesheet>`), и без
                   разбора кавычки доезжают до читателя вместе с именем. -->
              <td class="where"><Md :text="item.row.where" /></td>
              <td>
                <span class="who" :data-who="item.row.author">{{ AUTHOR[item.row.author] }}</span>
              </td>
              <td>
                <span class="mark" :data-ok="item.ok ? 'yes' : 'no'">{{ item.ok ? 'открыт' : '404' }}</span>
                <span class="why">{{ item.why }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="rule" :data-tone="root === '/' ? 'info' : 'err'">
        <template v-if="root === '/'">
          В корне разницы не видно: путь от корня и путь с базой — одна и та же строка.
          Ровно поэтому ошибку не ловят ни сборка, ни предпросмотр, ни ревью.
        </template>
        <template v-else>
          Переписаны только те пути, которые написал сборщик. Всё, что написал человек
          (ссылка в тексте, адрес в скрипте, путь к файлу из <code>public/</code>), осталось
          вести в корень домена — то есть мимо сайта.
        </template>
      </div>
    </div>

    <template #footer>
      <Md class="disclaimer" :text="caption" />
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
.origin {
  font-size: var(--fs-2);
  color: var(--text-faint);
}
.origin code {
  font-family: var(--mono);
  color: var(--ink);
}

.body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 22px 20px;
  min-width: 0;
}

.score {
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.score__line {
  height: 10px;
  border-radius: var(--r-full);
  background: var(--tone-err-bg);
  overflow: hidden;
}
.score__fill {
  display: block;
  height: 100%;
  border-radius: var(--r-full);
  background: var(--bar-green);
  transition: width 0.3s;
}
.score__nums {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  font-size: var(--fs-3);
}
.num b {
  font-family: var(--mono);
  font-weight: 600;
}
.num--ok {
  color: var(--tone-ok-text);
}
.num--err {
  color: var(--tone-err-text);
}
.num--dim {
  color: var(--text-faint);
}

.wrap {
  border: 1px solid var(--border);
  border-radius: var(--r3);
  background: var(--surface);
  overflow-x: auto;
}
table {
  width: 100%;
  min-width: 660px;
  border-collapse: collapse;
}
tr {
  display: grid;
  grid-template-columns: minmax(230px, 1.4fr) minmax(150px, 1fr) minmax(96px, 0.5fr) minmax(200px, 1.3fr);
}
thead tr {
  background: var(--ink);
  color: var(--on-ink);
}
th {
  padding: 9px 13px;
  text-align: left;
  font-family: var(--mono);
  font-size: var(--fs-3);
  font-weight: 400;
}
td {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 13px;
  min-width: 0;
  font-size: var(--fs-2);
  color: var(--prose);
}
tbody tr + tr {
  border-top: 1px solid var(--rule);
}
tbody tr[data-ok='no'] {
  background: var(--tone-err-bg);
}

.path {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--ink);
  overflow-wrap: anywhere;
}
.count {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}
.where {
  color: var(--text-muted);
}

.who {
  align-self: start;
  padding: 3px 9px;
  border-radius: var(--r-full);
  font-family: var(--mono);
  font-size: var(--fs-3);
}
.who[data-who='builder'] {
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
}
.who[data-who='hand'] {
  background: var(--surface-2);
  color: var(--chip-text);
}

.mark {
  align-self: start;
  padding: 3px 9px;
  border-radius: var(--r-full);
  font-family: var(--mono);
  font-size: var(--fs-3);
  transition: all 0.25s;
}
.mark[data-ok='yes'] {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.mark[data-ok='no'] {
  background: var(--tone-err-chip);
  color: var(--tone-err-text);
}
.why {
  font-size: var(--fs-3);
  line-height: 1.5;
  color: var(--text-faint);
}

.rule {
  padding: 11px 13px;
  border-radius: var(--r2);
  font-size: var(--fs-3);
  line-height: 1.55;
}
.rule code {
  font-family: var(--mono);
  /* Не ниже ступени `--fs-2`: в подписи на `--fs-2` доля .92em давала 10.9px. */
  font-size: max(0.92em, var(--fs-2));
}
.rule[data-tone='info'] {
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
}
.rule[data-tone='err'] {
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}

.disclaimer {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}

/* Код внутри мелкой подписи: базовое `code { font-size: .86em }` уводило его ниже 11px.
   Пол — ступень `--fs-2`. */
.origin :deep(code),
.where :deep(code) {
  font-size: max(0.86em, var(--fs-2));
}
</style>
