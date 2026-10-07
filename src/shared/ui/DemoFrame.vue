<script setup lang="ts">
/**
 * Рамка интерактивного демо: приподнятая панель, шапка сверху, подвал снизу.
 *
 * В уроках демо обязано отличаться от карточки с текстом — «с этим можно взаимодействовать».
 * Раньше сигналом был контур цвета чернил вокруг всего блока: на тёплом сером фоне он выглядел
 * как рамка прибора. На белой канве тот же контур стал просто чёрным прямоугольником, а внутри
 * всё слилось — светлая шапка на светлой панели на белой странице.
 *
 * Теперь сигнал другой и работает без линии по кругу: демо поднято над страницей заметной тенью,
 * а его шапка утоплена в свою подложку, отделяя органы управления от самого демо.
 */
defineSlots<{
  toolbar?: () => unknown;
  default: () => unknown;
  footer?: () => unknown;
}>();
</script>

<template>
  <div class="frame">
    <div v-if="$slots.toolbar" class="toolbar"><slot name="toolbar" /></div>
    <slot />
    <div v-if="$slots.footer" class="footer"><slot name="footer" /></div>
  </div>
</template>

<style scoped>
.frame {
  background: var(--surface);
  border-radius: var(--r4);
  box-shadow: var(--shadow-2);
  overflow: hidden;
}
.toolbar {
  padding: 14px 18px;
  background: var(--surface-2);
  border-bottom: 1px solid var(--divider);
}
.footer {
  padding: 16px 18px;
  background: var(--surface-2);
  border-top: 1px solid var(--divider);
}
</style>
