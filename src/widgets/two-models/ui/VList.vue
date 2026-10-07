<script setup lang="ts">
/** Узел `<List/>`: строки по ключу `id`. */
import type { TaskItem } from '../model/task';
import { useNode } from '../model/useNode';
import VRow from './VRow.vue';

defineProps<{ items: TaskItem[] }>();

const root = useNode('List');
</script>

<template>
  <div ref="root" class="tm-node" data-flash="off">
    <div class="tm-node-head"><span class="tm-node-name">&lt;List/&gt;</span></div>
    <ul class="tm-list">
      <VRow v-for="item in items" :key="item.id" :item="item" />
    </ul>
  </div>
</template>
