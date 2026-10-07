<script setup lang="ts">
/** Узел `<Status/>`: единственный, кто читает счётчик нажатий. */
import { useNode } from '../model/useNode';

defineProps<{ tick: number }>();

const root = useNode('Status');
</script>

<template>
  <div ref="root" class="tm-node" data-flash="off">
    <div class="tm-node-head"><span class="tm-node-name">&lt;Status/&gt;</span></div>
    <div class="tm-node-value">нажатий: {{ tick }}</div>
  </div>
</template>
