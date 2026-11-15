<script setup lang="ts">
/**
 * Живая привязка против снимка значения — на настоящих модулях в `blob:`.
 *
 * Четыре чтения одного и того же счётчика: два останутся нулями, два станут единицами. Числа
 * не записаны в данные — их возвращает сам модуль, выполненный загрузчиком браузера. Здесь
 * Blob-URL работает, потому что цикла нет: счётчик создаётся первым, и его адрес известен
 * к моменту, когда собирается второй модуль.
 *
 * Прогон повторяемый — в отличие от соседнего демо с циклом: каждый раз создаётся новая пара
 * блобов, то есть новые URL, то есть новые экземпляры модулей.
 */
import { onMounted, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import { Button } from '@/shared/ui';
import { runLiveBinding, type LiveRun, type Readings } from '../model/run';

const ROWS: { key: keyof Readings; expr: string; what: string }[] = [
  { key: 'binding', expr: 'count', what: 'прямой импорт — привязка к чужой ячейке' },
  { key: 'destructured', expr: 'destructured', what: 'деструктуризация namespace — снимок' },
  { key: 'viaNs', expr: 'ns.count', what: 'чтение свойства namespace — привязка' },
  { key: 'viaDefault', expr: 'def.count', what: 'свойство обычного объекта — снимок' },
];

const run = ref<LiveRun | null>(null);
const busy = ref(false);

async function go(): Promise<void> {
  busy.value = true;
  run.value = await runLiveBinding();
  busy.value = false;
}

onMounted(go);
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="bar">
        <span class="t-label">count изменён через inc(): какие чтения увидят новое значение</span>
        <Button variant="primary" :disabled="busy" @click="go">прогнать заново</Button>
      </div>
    </template>

    <div class="body">
      <div v-if="!run" class="empty">грузим модули…</div>

      <!-- Обёртка с собственной прокруткой обязательна: на телефоне четыре колонки иначе
           утаскивают вбок всю страницу, и это ловит `layout.spec`, а не глаз. -->
      <div v-else class="wrap">
        <table class="grid">
          <thead>
            <tr>
              <th>что читаем</th>
              <th>до inc()</th>
              <th>после inc()</th>
              <th>чем оказалось</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in ROWS" :key="row.key" :data-live="run.after[row.key] > run.before[row.key] ? 'yes' : 'no'">
              <td class="expr" data-code>{{ row.expr }}</td>
              <td class="num" data-code>{{ run.before[row.key] }}</td>
              <td class="num" data-code>{{ run.after[row.key] }}</td>
              <td class="what">{{ row.what }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="run" class="verdict">
        Живость — свойство <b>имени</b>, а не значения. Ячейка в модуле-счётчике одна и та же,
        и два способа до неё дотянуться показывают новое значение. Два других способа успели
        прочитать число и отпустить связь: деструктуризация читает значение в момент
        выполнения строки, а объект из экспорта по умолчанию хранит копию, положенную туда
        при исполнении тела модуля.
      </div>
    </div>
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

.wrap {
  border: 1px solid var(--border);
  border-radius: var(--r2);
  overflow-x: auto;
}
.grid {
  width: 100%;
  min-width: 540px;
  border-collapse: collapse;
}
th {
  padding: 9px 12px;
  background: var(--ink);
  color: var(--on-ink);
  font-family: var(--mono);
  font-size: var(--fs-2);
  font-weight: 400;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  text-align: start;
}
td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--rule);
}
tbody tr:last-child td {
  border-bottom: 0;
}
/* Живое и мёртвое различаются не подписью, а цветом числа: строку читают по диагонали. */
tbody tr[data-live='yes'] .num {
  color: var(--tone-ok-strong);
}
tbody tr[data-live='no'] .num {
  color: var(--tone-err-strong);
}
.expr {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--tone-info-strong);
}
.num {
  font-family: var(--mono);
  font-size: var(--fs-5);
}
.what {
  font-size: var(--fs-5);
  line-height: 1.45;
  color: var(--text-muted);
}

.verdict {
  padding: 14px 16px;
  border: 1px solid var(--tone-ok-line);
  border-radius: var(--r2);
  background: var(--tone-ok-bg);
  font-size: var(--fs-6);
  line-height: 1.6;
  color: var(--tone-ok-text);
}
.verdict b {
  color: var(--tone-ok-text);
}

</style>
