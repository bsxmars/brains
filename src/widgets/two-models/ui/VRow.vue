<script setup lang="ts">
/** Строка списка. Отдельный компонент, а не `<li>` в шаблоне родителя: у React она тоже
    компонент, и работа должна считаться по одним правилам с обеих сторон. */
import type { TaskItem } from '../model/task';
import { useNode } from '../model/useNode';

defineProps<{ item: TaskItem }>();

const root = useNode('Row');
</script>

<template>
  <li ref="root" class="tm-row" data-flash="off">{{ item.name }}</li>
</template>
