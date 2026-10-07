<script setup lang="ts">
/**
 * Vue-половина задачи: три поля состояния, производное значение и четыре узла под ними.
 *
 * Устройство повторяет React-половину узел в узел — иначе сравнивать числа было бы нельзя.
 * Разница ровно одна и она и есть предмет урока: здесь нет ни одного места, где автор
 * объявляет, что именно должно пересчитаться.
 */
import { computed, onScopeDispose, ref } from 'vue';
import { onAction } from '../model/bus';
import { FILTER_QUERY, TASK_ITEMS, makeItem, type TaskItem } from '../model/task';
import { useNode } from '../model/useNode';
import VCounter from './VCounter.vue';
import VFilter from './VFilter.vue';
import VList from './VList.vue';
import VStatus from './VStatus.vue';

const root = useNode('App');

const query = ref('');
const items = ref<TaskItem[]>([...TASK_ITEMS]);
const tick = ref(0);

const filtered = computed(() => items.value.filter((item) => item.name.includes(query.value)));

let next = TASK_ITEMS.length + 1;

const stop = onAction((action) => {
  if (action === 'tick') tick.value += 1;
  else if (action === 'query') query.value = query.value ? '' : FILTER_QUERY;
  else if (action === 'add') items.value = [...items.value, makeItem(next++)];
});
onScopeDispose(stop);
</script>

<template>
  <div ref="root" class="tm-node" data-flash="off">
    <div class="tm-node-head"><span class="tm-node-name">&lt;App/&gt;</span></div>
    <div class="tm-node-note">держит три поля: строку фильтра, список и счётчик нажатий</div>

    <div class="tm-children">
      <VFilter :query="query" />
      <VCounter :shown="filtered.length" :total="items.length" />
      <VList :items="filtered" />
      <VStatus :tick="tick" />
    </div>
  </div>
</template>
