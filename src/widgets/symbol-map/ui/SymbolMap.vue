<script setup lang="ts">
/**
 * Карта точек расширения: какая обычная операция кого вызывает.
 *
 * Раньше здесь стояла таблица из двух колонок, и в ней тонуло главное. Про well-known symbols
 * важно не то, как они называются, — имена и так есть в спецификации, — а то, что **обычный
 * код вроде `for…of` или `instanceof` под капотом ищет символ на объекте**. Пока это лежит
 * во второй колонке списком через запятую, связь не читается.
 *
 * Поэтому здесь две стороны и связь между ними: слева имена, справа — код, который их вызывает.
 * Выбранный символ подсвечивает свои операции; операция подсвечивает свой символ. Перебором
 * туда и обратно и запоминается, что `using` — это не синтаксис сам по себе, а вызов
 * `Symbol.dispose`.
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import type { SymbolHook } from '../model/types';

const props = defineProps<{ items: SymbolHook[] }>();

const picked = ref(0);
const current = computed(() => props.items[picked.value] ?? props.items[0]);

/** Все операции разом — правая колонка. Клик по операции ведёт к её символу. */
const allCalls = computed(() =>
  props.items.flatMap((item, i) => (item.calls ?? []).map((call) => ({ call, owner: i }))),
);
</script>

<template>
  <DemoFrame>
    <div class="split">
      <div class="pane">
        <div class="t-eyebrow t-eyebrow--panel">символы</div>

        <!-- `data-code`: внутри имена и код, обратные кавычки там принадлежат примеру
             (`` `${obj}` `` — это шаблонная строка, а не разметка). -->
        <button
          v-for="(item, i) in items"
          :key="item.symbol"
          class="symbol"
          data-code
          type="button"
          :aria-pressed="i === picked"
          @click="picked = i"
        >
          {{ item.symbol }}
        </button>
      </div>

      <div class="pane pane--right">
        <div class="t-eyebrow t-eyebrow--panel">кто его вызывает</div>

        <div class="calls">
          <button
            v-for="(entry, i) in allCalls"
            :key="`${entry.call}-${i}`"
            class="call"
            data-code
            type="button"
            :data-state="entry.owner === picked ? 'on' : 'off'"
            @click="picked = entry.owner"
          >
            {{ entry.call }}
          </button>
        </div>

        <div class="detail">
          <div class="detail__symbol">{{ current.symbol }}</div>

          <Md v-if="current.note" class="detail__note" :text="current.note" />

          <p v-else class="detail__note">
            Определите его на объекте — и операции языка, которые его вызывают, начнут
            спрашивать ваш объект, что делать.
          </p>
        </div>
      </div>
    </div>
  </DemoFrame>
</template>

<style scoped>
.split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
}
.pane {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 20px;
  border-right: 1px solid var(--divider);
  min-width: 0;
}
.pane--right {
  border-right: 0;
  gap: 14px;
  background: var(--surface-2);
}

.symbol {
  padding: 9px 12px;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  font-family: var(--mono);
  font-size: var(--fs-4);
  line-height: 1.4;
  text-align: start;
  color: var(--text-muted);
  cursor: pointer;
  overflow-wrap: anywhere;
  transition: all 0.18s;
}
.symbol:hover {
  background: var(--surface-3);
  color: var(--ink);
}
.symbol[aria-pressed='true'] {
  background: var(--accent);
  color: var(--on-ink);
}

.calls {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}
.call {
  padding: 5px 11px;
  border: 1px solid var(--border);
  border-radius: var(--r-full);
  background: var(--surface);
  font-family: var(--mono);
  font-size: var(--fs-3);
  cursor: pointer;
  transition: all 0.18s;
}
/* Операции выбранного символа — акцентом: связь «код → символ» и есть содержание демо. */
.call[data-state='on'] {
  border-color: var(--tone-info-line);
  background: var(--tone-info-chip);
  color: var(--tone-info-text);
}
.call[data-state='off'] {
  color: var(--dim);
}

.detail {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 15px 17px;
  border-radius: var(--r2);
  background: var(--surface);
  box-shadow: var(--shadow-card);
}
.detail__symbol {
  font-family: var(--mono);
  font-size: var(--fs-4);
  font-weight: 600;
  color: var(--accent);
  overflow-wrap: anywhere;
}
.detail__note {
  margin: 0;
  font-size: var(--fs-6);
  line-height: 1.55;
  color: var(--prose);
}

@media (max-width: 720px) {
  .split {
    grid-template-columns: minmax(0, 1fr);
  }
  .pane {
    border-right: 0;
    border-bottom: 1px solid var(--divider);
  }
}
</style>
