<script setup lang="ts">
/**
 * Поле, в котором читатель правит пример.
 *
 * До сих пор весь код в курсе был односторонним: автор показал — читатель прочитал. Между
 * «понял объяснение» и «проверил сам» лежит ровно одно действие — изменить пример и посмотреть,
 * что будет. Это поле и есть то место, где урок перестаёт быть текстом.
 *
 * `data-code` на обёртке — конвенция курса: внутри такого поддерева обратные кавычки
 * принадлежат коду, и проверка разметки их не трогает.
 *
 * ⚠️ У `textarea` собственные шрифт и цвета браузера. В курсе цвет приходит только из темы,
 * поэтому и то и другое задаётся явно — иначе проверка палитры краснеет на системном сером.
 */
const model = defineModel<string>({ required: true });

withDefaults(defineProps<{ label?: string; rows?: number }>(), { label: 'пример', rows: 8 });
</script>

<template>
  <div class="input" data-code>
    <label class="t-label" :for="label">{{ label }}</label>
    <textarea
      :id="label"
      v-model="model"
      class="area"
      :rows="rows"
      spellcheck="false"
      autocapitalize="off"
      autocorrect="off"
    />
  </div>
</template>

<style scoped>
.input {
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-width: 0;
}

.area {
  width: 100%;
  box-sizing: border-box;
  padding: 13px 15px;
  border: 1px solid var(--ink-line);
  border-radius: var(--r2);
  background: var(--ink);
  /* Шрифт и цвет — явные: у поля ввода они свои, браузерные, и в палитру курса не входят. */
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.7;
  color: var(--code-fg);
  resize: vertical;
}
.area:focus {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
</style>
