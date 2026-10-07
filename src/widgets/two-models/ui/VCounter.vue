<script setup lang="ts">
/** Узел `<Counter/>`: сколько строк показано из скольких. Зависит от списка, не от фильтра. */
import { useNode } from '../model/useNode';

defineProps<{ shown: number; total: number }>();

const root = useNode('Counter');
</script>

<template>
  <div ref="root" class="tm-node" data-flash="off">
    <div class="tm-node-head"><span class="tm-node-name">&lt;Counter/&gt;</span></div>
    <div class="tm-node-value">{{ shown }} из {{ total }}</div>
  </div>
</template>
