<script setup lang="ts">
/**
 * Таблица «что проходит через границу теневого дерева»: три движка из стенда и браузер читателя.
 *
 * Колонки движков — литерал из данных темы, снятый стендом. Последнюю колонку считает
 * `model/boundary.ts` здесь и сейчас, тем же кодом, который стенд гонял в трёх движках. Если
 * браузер читателя разойдётся со своим движком — это видно в строке, а не спрятано.
 *
 * Считается в `onMounted`: на сервере острова документа нет, а до гидратации колонка честно
 * пустая.
 */
import { onMounted, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { runBoundary, type BoundaryResult } from '../model/boundary';
import type { BoundaryRow } from '../model/types';

defineProps<{
  rows: BoundaryRow[];
  /** Подвал: как считается последняя колонка. */
  note: string;
}>();

const mine = ref<BoundaryResult | null>(null);
const failed = ref('');

onMounted(() => {
  try {
    mine.value = runBoundary(document);
  } catch (e) {
    failed.value = e instanceof Error ? e.message : String(e);
  }
});

const word = (v: boolean | null | undefined) => (v === true ? 'да' : v === false ? 'нет' : v === null ? '?' : '…');
const tone = (v: boolean | null | undefined) => (v === true ? 'yes' : v === false ? 'no' : 'none');
</script>

<template>
  <DemoFrame>
    <div class="sd-bd">
      <div class="sd-bd__scroll">
        <table class="sd-bd__table">
          <thead>
            <tr>
              <th>что проверяется</th>
              <th>Chromium 153</th>
              <th>Firefox 155</th>
              <th>WebKit 26.6</th>
              <th class="sd-bd__mine">ваш браузер</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.key">
              <td class="sd-bd__what"><Md as="span" :text="row.what" /></td>
              <td :data-v="tone(row.chromium)">{{ word(row.chromium) }}</td>
              <td :data-v="tone(row.firefox)">{{ word(row.firefox) }}</td>
              <td :data-v="tone(row.webkit)">{{ word(row.webkit) }}</td>
              <td class="sd-bd__mine" :data-v="tone(mine?.[row.key])">{{ mine ? word(mine[row.key]) : '…' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="failed" class="sd-bd__failed">{{ failed }}</p>
    </div>

    <template #footer>
      <Md class="sd-bd__note" :text="note" />
    </template>
  </DemoFrame>
</template>

<style scoped>
.sd-bd {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 18px 20px;
}
.sd-bd__scroll {
  min-width: 0;
  overflow-x: auto;
}
.sd-bd__table {
  width: 100%;
  min-width: 680px;
  border-collapse: collapse;
  font-size: var(--fs-4);
  color: var(--prose);
}
.sd-bd__table th {
  padding: 7px 8px;
  border-bottom: 1px solid var(--border);
  font-family: var(--mono);
  font-size: var(--fs-2);
  font-weight: normal;
  text-align: start;
  color: var(--text-faint);
  white-space: nowrap;
}
.sd-bd__table td {
  padding: 7px 8px;
  border-bottom: 1px solid var(--rule);
  text-align: start;
  vertical-align: top;
  font-family: var(--mono);
  font-size: var(--fs-3);
  white-space: nowrap;
}
.sd-bd__table td.sd-bd__what {
  font-family: inherit;
  font-size: var(--fs-4);
  line-height: 1.5;
  white-space: normal;
  min-width: 280px;
}
.sd-bd__table td[data-v='yes'] {
  color: var(--tone-ok-text);
}
.sd-bd__table td[data-v='no'] {
  color: var(--tone-err-text);
}
.sd-bd__table td[data-v='none'] {
  color: var(--dim);
}
.sd-bd__table .sd-bd__mine {
  background: var(--surface-2);
}
.sd-bd__failed {
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--r1);
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
  font-size: var(--fs-4);
}
.sd-bd__note {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}
</style>
