<script setup lang="ts">
/**
 * Разбор строки `--trace-gc` по кускам: кликаешь поле — читаешь, что оно значит.
 *
 * Строка приведена ровно в том виде, в каком её печатает сборка из шапки урока, включая поле
 * `pooled`, которого в оригинале урока нет вовсе: формат лога меняется от версии к версии,
 * и урок, обещающий «семь полей», разойдётся с первым же настоящим логом.
 *
 * Куски — настоящие `<button>`: это выбор из набора, и работать он обязан с клавиатуры.
 * Роль `radio` здесь честнее, чем `tab`: панель под строкой одна, меняется её содержимое.
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import type { GcToken } from '../model/types';

const props = defineProps<{
  tokens: GcToken[];
  /** Подпись над строкой: откуда она взята. */
  source: string;
}>();

/** Индексы кликабельных кусков: пунктуация в выбор не попадает. */
const pickable = computed(() => props.tokens.map((t, i) => (t.name ? i : -1)).filter((i) => i >= 0));
const picked = ref(props.tokens.findIndex((t) => t.star) >= 0 ? props.tokens.findIndex((t) => t.star) : pickable.value[0]);
const current = computed(() => props.tokens[picked.value]);

/** Стрелки ходят по кликабельным кускам, а не по всем подряд. */
function move(step: number) {
  const order = pickable.value;
  const at = order.indexOf(picked.value);
  picked.value = order[(at + step + order.length) % order.length];
}
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="bar">
        <span class="bar__label">{{ source }}</span>
        <span class="bar__hint">кликните поле строки</span>
      </div>
    </template>

    <div class="line-wrap">
      <div class="line" role="radiogroup" aria-label="Поля строки --trace-gc">
        <template v-for="(token, i) in tokens" :key="i">
          <button
            v-if="token.name"
            class="token"
            type="button"
            role="radio"
            :aria-checked="picked === i"
            :data-on="picked === i ? 'yes' : 'no'"
            :data-star="token.star ? 'yes' : 'no'"
            :tabindex="picked === i ? 0 : -1"
            @click="picked = i"
            @keydown.right.prevent="move(1)"
            @keydown.left.prevent="move(-1)"
          >
            {{ token.t }}
          </button>
          <span v-else class="token token--plain">{{ token.t }}</span>
        </template>
      </div>
    </div>

    <div class="cols">
      <div class="col">
        <div class="t-label">поле</div>
        <div class="name" :data-star="current.star ? 'yes' : 'no'">{{ current.name }}</div>
        <div class="what">{{ current.what }}</div>
        <div v-if="current.fresh" class="fresh">
          Этого поля нет в старых разборах --trace-gc: Node 20 (V8 11.3) его не печатает, Node 24 (V8 13.6) уже печатает.
        </div>
      </div>

      <div class="col col--use">
        <div class="t-label">зачем смотреть при разборе утечки</div>
        <div class="use" :data-star="current.star ? 'yes' : 'no'">{{ current.use }}</div>
      </div>
    </div>
  </DemoFrame>
</template>

<style scoped>
.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}
.bar__label,
.bar__hint {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}

/* Строка лога длиннее телефона — прокручивается она, а не страница. */
.line-wrap {
  min-width: 0;
  overflow-x: auto;
  padding: 18px 20px;
  background: var(--ink);
}
.line {
  display: flex;
  flex-wrap: nowrap;
  align-items: baseline;
  gap: 5px;
  min-width: 620px;
}

.token {
  padding: 5px 7px;
  border: 0;
  border-radius: var(--r1);
  background: none;
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.5;
  white-space: nowrap;
  color: var(--ink-secondary);
  cursor: pointer;
  transition: all 0.15s;
}
.token[data-star='yes'] {
  color: var(--tone-warn-on-ink);
}
.token:hover {
  background: var(--ink-chip);
}
.token[data-on='yes'] {
  background: var(--tone-info-strong);
  color: var(--on-ink);
  font-weight: 600;
}
.token[data-star='yes'][data-on='yes'] {
  background: var(--tone-warn-on-ink);
  color: var(--ink);
}
.token--plain {
  padding: 5px 0;
  color: var(--ink-faint);
  cursor: default;
}

.cols {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr));
  min-width: 0;
}
.col {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 20px;
  border-right: 1px solid var(--divider);
  min-width: 0;
}
.col--use {
  border-right: 0;
  background: var(--surface-2);
}

.name {
  padding: 12px 14px;
  border-radius: var(--r2);
  font-family: var(--mono);
  font-size: var(--fs-4);
  line-height: 1.45;
  border: 1px solid var(--tone-info-line);
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
  transition: all 0.2s;
}
.name[data-star='yes'] {
  border-color: var(--tone-warn-line);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.what {
  font-size: var(--fs-6);
  line-height: 1.6;
  color: var(--prose);
}
.fresh {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}

.use {
  padding: 13px 15px;
  border-radius: var(--r2);
  font-size: var(--fs-6);
  line-height: 1.6;
  background: var(--sunk-dim);
  color: var(--prose);
  transition: all 0.2s;
}
.use[data-star='yes'] {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
</style>
