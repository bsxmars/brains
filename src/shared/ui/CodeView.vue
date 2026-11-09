<script setup lang="ts">
/**
 * `<pre>` с кодом, подсвеченным в острове (`useHighlight`). Для листингов демо, которые
 * меняются на лету; статический код темы — `CodeBlock.astro`, он красится при сборке.
 *
 * Классы и стили вызывающего виджета ложатся на сам `<pre>`: это корень компонента.
 * `tone="light"` — для `<pre>` на светлой подложке: те же роли светлыми токенами.
 */
import { useHighlight, type IslandLang } from '@/shared/lib/useHighlight';

const props = withDefaults(defineProps<{ code: string; lang?: IslandLang; tone?: 'dark' | 'light' }>(), {
  lang: 'js',
  tone: 'dark',
});
const html = useHighlight(() => props.code, () => props.lang);
</script>

<template>
  <!-- `data-code`: обратные кавычки внутри — настоящие, проверка разметки их пропускает. -->
  <!-- eslint-disable-next-line vue/no-v-html -- tokensToLines экранирует текст, свои только <span class="c-…"> -->
  <pre v-if="html" data-code :data-lang="lang" :data-code-tone="tone" v-html="html.join('\n')" />
  <pre v-else data-code :data-lang="lang">{{ code }}</pre>
</template>
