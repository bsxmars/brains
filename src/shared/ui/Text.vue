<script setup lang="ts">
/**
 * Тот же `Text`, что и в `.astro`, — для островов.
 *
 * Классы общие (`shared/styles/type.css`), поэтому scoped-стилей здесь нет и быть не должно:
 * размер задаётся ступенью шкалы, а не этим компонентом. Пропы совпадают с `Text.astro`
 * намеренно — один и тот же блок должен выглядеть одинаково, на какой бы стороне он ни рисовался.
 */
import { computed } from 'vue';

export type TextVariant =
  | 'h1'
  | 'h2'
  | 'h3'
  | 'lead'
  | 'body'
  | 'ui'
  | 'note'
  | 'display'
  | 'eyebrow'
  | 'label'
  | 'chip'
  | 'micro';

type Tone = 'ink' | 'prose' | 'muted' | 'faint' | 'accent' | 'on-ink';

const props = withDefaults(
  defineProps<{
    variant?: TextVariant;
    as?: string;
    tone?: Tone;
    mono?: boolean;
    weight?: 400 | 500 | 600;
    maxWidth?: number;
  }>(),
  { variant: 'body', as: undefined, tone: undefined, mono: false, weight: undefined, maxWidth: undefined },
);

const TAGS: Record<TextVariant, string> = {
  h1: 'h1',
  h2: 'h2',
  h3: 'h3',
  lead: 'p',
  body: 'p',
  ui: 'div',
  note: 'div',
  display: 'div',
  eyebrow: 'div',
  label: 'div',
  chip: 'span',
  micro: 'span',
};

const tag = computed(() => props.as ?? TAGS[props.variant]);

const classes = computed(() => [
  `t-${props.variant}`,
  props.tone ? `t-${props.tone}` : null,
  props.mono ? 't-mono' : null,
]);

const style = computed(() => ({
  fontWeight: props.weight,
}));
</script>

<template>
  <component :is="tag" :class="classes" :style="style">
    <slot />
  </component>
</template>
