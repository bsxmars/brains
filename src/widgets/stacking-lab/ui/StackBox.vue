<script setup lang="ts">
/**
 * Один блок сцены и его дети — настоящие элементы со стилями из дерева.
 *
 * Геометрию (размер, сдвиг, отрицательные отступы) даёт `layoutTree`, свойства — сам узел.
 * Подпись — `::before` нулевого размера: без высоты она не сдвигает детей, а нулевой шрифт
 * самого блока не даёт строкам с `inline-block` занимать место (см. `layoutTree`).
 */
import type { Css, StackNode } from '../model/types';

defineOptions({ name: 'StackBox' });

defineProps<{
  node: StackNode;
  styles: Record<string, Css>;
  tones: Record<string, string>;
}>();
</script>

<template>
  <div
    class="sk-box"
    :data-node="node.id"
    :data-label="node.id"
    :data-tone="tones[node.id]"
    :style="{ ...styles[node.id], ...node.css }"
  >
    <StackBox v-for="k in node.kids ?? []" :key="k.id" :node="k" :styles="styles" :tones="tones" />
  </div>
</template>

<style scoped>
.sk-box {
  border-color: var(--tone-info-line);
  background: var(--tone-info-bg);
}
.sk-box::before {
  content: attr(data-label);
  display: block;
  width: 0;
  height: 0;
  white-space: nowrap;
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.5;
  text-indent: 4px;
  color: var(--tone-info-text);
}
.sk-box[data-tone='ok'] {
  border-color: var(--tone-ok-line);
  background: var(--tone-ok-bg);
}
.sk-box[data-tone='ok']::before {
  color: var(--tone-ok-text);
}
.sk-box[data-tone='warn'] {
  border-color: var(--tone-warn-line);
  background: var(--tone-warn-bg);
}
.sk-box[data-tone='warn']::before {
  color: var(--tone-warn-text);
}
.sk-box[data-tone='err'] {
  border-color: var(--tone-err-line);
  background: var(--tone-err-bg);
}
.sk-box[data-tone='err']::before {
  color: var(--tone-err-text);
}
</style>
