<script setup lang="ts">
/**
 * Одна строка кода внутри своего листинга виджета (с номерами строк, активной строкой):
 * подсвеченный HTML из `useHighlight`, а пока его нет — текст как есть.
 */
defineProps<{ html?: string | null; text: string }>();
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -- tokensToLines экранирует текст, свои только <span class="c-…"> -->
  <span v-if="html != null" v-html="html" /><template v-else>{{ text }}</template>
</template>
