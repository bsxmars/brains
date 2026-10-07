<script setup lang="ts">
/**
 * Режим Comparison с настоящей сортировкой.
 *
 * В оригинале таблица нарисована статикой, хотя приём, которому учит раздел, — это ровно
 * сортировка: по `#Delta` наверх всплывает подпись утечки (число, кратное количеству
 * прогонов), а по `Size Delta` — «мало объектов, но тяжёлые», которую счётчик пропускает.
 * Пока порядок строк не меняется, обе эти мысли остаются словами.
 *
 * Поэтому сортировка здесь работает, а её результат подписан: под таблицей видно, какая
 * строка оказалась наверху и почему это не одна и та же строка для двух колонок.
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import { SegmentedControl } from '@/shared/ui';
import type { CmpRow, SortKey } from '../model/types';

const props = defineProps<{
  rows: CmpRow[];
  runs: number;
  /** Что означает результат каждой сортировки. Текст авторский: см. комментарий ниже. */
  notes: Record<SortKey, string>;
  initial?: number;
}>();

const sort = ref<SortKey>('none');
const picked = ref(String(props.initial ?? 2));

const SORT_OPTIONS = [
  { value: 'none', label: 'как в снимке' },
  { value: 'delta', label: '#Delta' },
  { value: 'size', label: 'Size Delta' },
];

/** Строки в текущем порядке. Индекс исходной строки нужен, чтобы выбор её не терял. */
const ordered = computed(() => {
  const list = props.rows.map((row, i) => ({ row, i }));
  if (sort.value === 'delta') list.sort((a, b) => b.row.deltaN - a.row.deltaN);
  if (sort.value === 'size') list.sort((a, b) => b.row.sizeDeltaN - a.row.sizeDeltaN);
  return list;
});

const current = computed(() => props.rows[Number(picked.value)]);

/**
 * Пояснение к сортировке — готовый текст из данных, а не шаблон вида «наверху та строка,
 * и это ответ». Шаблон здесь соврал бы: по `#Delta` наверх всплывает `(string)` с приростом
 * +184, который как раз НЕ утечка, а шум от оборота в четыреста тысяч объектов. Смысл у
 * каждой сортировки свой, и написан он словами.
 */
const sortNote = computed(() => props.notes[sort.value]);

const ariaSort = (key: SortKey) => (sort.value === key ? 'descending' : 'none');
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="bar">
        <span class="bar__label">сортировка:</span>
        <SegmentedControl v-model="sort" class="l-pills" label="Сортировка таблицы" :options="SORT_OPTIONS" />
      </div>
    </template>

    <div class="head">Snapshot 3 ↔ Snapshot 2 · после {{ runs }} прогонов · кликните строку</div>

    <div class="scroll">
      <table>
        <thead>
          <tr>
            <th>Constructor</th>
            <th class="num"># New</th>
            <th class="num"># Deleted</th>
            <th class="num hero" :aria-sort="ariaSort('delta')"># Delta</th>
            <th class="num">Alloc</th>
            <th class="num">Freed</th>
            <th class="num hero" :aria-sort="ariaSort('size')">Size Δ</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="entry in ordered"
            :key="entry.row.c"
            :data-on="String(entry.i) === picked ? 'yes' : 'no'"
            :data-tone="entry.row.tone"
            @click="picked = String(entry.i)"
          >
            <td class="c">
              <button type="button" class="pick" @click.stop="picked = String(entry.i)">{{ entry.row.c }}</button>
            </td>
            <td class="num dim">{{ entry.row.nw }}</td>
            <td class="num dim">{{ entry.row.del }}</td>
            <td class="num strong">{{ entry.row.delta }}</td>
            <td class="num dim">{{ entry.row.alloc }}</td>
            <td class="num dim">{{ entry.row.freed }}</td>
            <td class="num strong">{{ entry.row.sizeDelta }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="sort-note">{{ sortNote }}</div>

    <div class="comparison-table-foot">
      <div class="field">
        <div class="t-label">диагноз</div>
        <div class="verdict" :data-tone="current.tone">{{ current.verdict }}</div>
      </div>
      <div class="field">
        <div class="t-label">что делать</div>
        <div class="next">{{ current.next }}</div>
      </div>
      <div class="why" :data-tone="current.tone">{{ current.why }}</div>
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
.bar__label {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}

.head {
  padding: 12px 18px;
  border-bottom: 1px solid var(--divider);
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-faint);
}

.scroll {
  min-width: 0;
  overflow-x: auto;
}
table {
  width: 100%;
  min-width: 740px;
  border-collapse: collapse;
}
thead tr {
  background: var(--ink);
}
th {
  padding: 10px 8px;
  font-family: var(--mono);
  font-size: var(--fs-3);
  font-weight: 400;
  letter-spacing: 0.08em;
  text-align: end;
  color: var(--on-ink);
}
th:first-child {
  padding-left: 12px;
  text-transform: uppercase;
  text-align: start;
}
th.hero {
  color: var(--tone-info-on-ink);
}

tbody tr {
  border-bottom: 1px solid var(--rule);
  cursor: pointer;
  transition: all 0.15s;
}
tbody tr[data-on='yes'][data-tone='ok'] {
  background: var(--tone-ok-bg);
}
tbody tr[data-on='yes'][data-tone='warn'] {
  background: var(--tone-warn-bg);
}
tbody tr[data-on='yes'][data-tone='err'] {
  background: var(--tone-err-bg);
}

td {
  padding: 13px 8px;
  font-family: var(--mono);
  font-size: var(--fs-3);
  text-align: end;
  color: var(--ink);
}
td.c {
  padding-left: 12px;
  text-align: start;
}
td.dim {
  color: var(--text-faint);
}
td.strong {
  font-weight: 600;
}

/* Кнопка в первой ячейке: по строке можно попасть и с клавиатуры, а не только мышью. */
.pick {
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  color: inherit;
  cursor: pointer;
}
tr[data-on='yes'] .pick {
  font-weight: 600;
}
tr[data-on='yes'][data-tone='ok'] .pick {
  color: var(--tone-ok-strong);
}
tr[data-on='yes'][data-tone='warn'] .pick {
  color: var(--tone-warn-strong);
}
tr[data-on='yes'][data-tone='err'] .pick {
  color: var(--tone-err-strong);
}

.sort-note {
  padding: 14px 18px;
  border-top: 1px solid var(--divider);
  border-bottom: 1px solid var(--divider);
  font-size: var(--fs-6);
  line-height: 1.6;
  color: var(--prose);
}

.comparison-table-foot {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr));
  gap: 16px;
  padding: 20px;
  background: var(--surface-2);
}
.field {
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-width: 0;
}
.verdict {
  padding: 12px 14px;
  border-radius: var(--r2);
  font-family: var(--mono);
  font-size: var(--fs-5);
  transition: all 0.2s;
}
.verdict[data-tone='ok'] {
  border: 1px solid var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-strong);
}
.verdict[data-tone='warn'] {
  border: 1px solid var(--tone-warn-line);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-strong);
}
.verdict[data-tone='err'] {
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-strong);
}
.next {
  font-size: var(--fs-6);
  line-height: 1.6;
  color: var(--prose);
}
.why {
  grid-column: 1 / -1;
  padding: 14px 16px;
  border-radius: var(--r2);
  font-size: var(--fs-6);
  line-height: 1.6;
  color: var(--prose);
  transition: all 0.2s;
}
.why[data-tone='ok'] {
  border: 1px solid var(--tone-ok-line);
  background: var(--tone-ok-bg);
}
.why[data-tone='warn'] {
  border: 1px solid var(--tone-warn-line);
  background: var(--tone-warn-bg);
}
.why[data-tone='err'] {
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
}
</style>
