<script setup lang="ts">
/**
 * Консоль демо: чернильная плашка, зелёные строки вывода.
 *
 * Две раскладки. `lines` — обычный лог сверху вниз. `chips` — короткие метки в строку,
 * когда важен только порядок (вывод из шести букв в разборе Node). У фишки есть тон:
 * янтарная означает «здесь настоящая гонка, порядок не гарантирован».
 */
export interface ConsoleChip {
  text: string;
  tone?: 'ok' | 'warn';
}

interface Props {
  lines?: string[];
  chips?: ConsoleChip[];
  label?: string;
  minHeight?: number;
  emptyLabel?: string;
}

withDefaults(defineProps<Props>(), {
  lines: () => [],
  chips: () => [],
  label: 'консоль',
  minHeight: 92,
  emptyLabel: 'пусто',
});
</script>

<template>
  <div class="console">
    <div v-if="label" class="t-label">{{ label }}</div>
    <div class="screen" :class="{ 'screen--chips': chips.length }" :style="`min-height:${minHeight}px`">
      <div v-for="(line, i) in lines" :key="`l-${i}`" class="cv-line">{{ line }}</div>
      <span v-for="(chip, i) in chips" :key="`c-${i}`" class="chip" :data-tone="chip.tone ?? 'ok'">
        {{ chip.text }}
      </span>
      <span v-if="!lines.length && !chips.length" class="empty">{{ emptyLabel }}</span>
    </div>
  </div>
</template>

<style scoped>
.console {
  display: flex;
  flex-direction: column;
  gap: 9px;
}
/*
 * ⚠️ `position: relative` здесь — защита, а не украшение, и вот от чего.
 *
 * Заглушка `.empty` внутри экрана однажды уехала в самый верх страницы и легла поверх
 * вводного блока темы «Колбэки». Причина снаружи: `.empty { position: absolute }` объявлен
 * в scoped-стиле **чужого** виджета (`debounce-throttle`), а на дев-сервере стили всех
 * островов страницы приезжают общим набором до гидратации. Абсолютный элемент ищет
 * ближайшего позиционированного предка — у экрана консоли такого не было ни одного,
 * и отсчёт пошёл от начала документа. Замер: заглушка на y=862 при собственном месте
 * темы y=21761, в Chromium и Firefox одинаково.
 *
 * На собранном сайте стили разъезжаются по островам, и совпадение имён безвредно —
 * то есть ошибка видна только в разработке, но живёт в вёрстке, а не в сборке.
 * Своя точка отсчёта удерживает любое абсолютное содержимое внутри экрана.
 */
.screen {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 11px 13px;
  border-radius: var(--r2);
  background: var(--ink);
}
.screen--chips {
  flex-direction: row;
  flex-wrap: wrap;
  align-content: flex-start;
  gap: 6px;
}
/* ⚠️ Префикс `cv-`, а не `.line`: у `CodeListing` есть свой `.line { white-space: pre }`,
   и там, где оба стоят в одном острове (`pollution-lab`), длинная строка трассы переставала
   переноситься и вылезала за чернильный экран. */
.cv-line {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--tone-ok-on-ink);
  white-space: normal;
  overflow-wrap: anywhere;
}
.chip {
  padding: 3px 8px;
  border-radius: var(--r1);
  font-family: var(--mono);
  font-size: var(--fs-3);
}
.chip[data-tone='ok'] {
  background: var(--ink-chip);
  color: var(--tone-ok-on-ink);
}
.chip[data-tone='warn'] {
  background: var(--warn-chip-on-ink);
  color: var(--tone-warn-on-ink);
}
.empty {
  font-family: var(--mono);
  font-size: var(--fs-2);
  font-style: italic;
  color: var(--ink-faint);
}
</style>
