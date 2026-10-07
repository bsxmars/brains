<script setup lang="ts">
/** Узел `<Filter/>`: показывает строку фильтра. Зависит от одного поля состояния. */
import { useNode } from '../model/useNode';

defineProps<{ query: string }>();

const root = useNode('Filter');
</script>

<template>
  <div ref="root" class="tm-node" data-flash="off">
    <div class="tm-node-head"><span class="tm-node-name">&lt;Filter/&gt;</span></div>
    <div class="tm-node-value">фильтр: {{ query || 'выключен' }}</div>
  </div>
</template>
