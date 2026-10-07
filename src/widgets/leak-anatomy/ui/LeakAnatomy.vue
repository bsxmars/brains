<script setup lang="ts">
/**
 * Шесть классов утечек: код, цепочка удержания, разбор и починка.
 *
 * Цепочка нарисована сверху вниз от корня, и это не украшение: корень выделен, потому что
 * именно он объясняет, почему `chart = null` не помогает — путь идёт не через вашу переменную.
 * Последний узел выделен тоже: это то, что физически не освобождается.
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import { SegmentedControl } from '@/shared/ui';
import type { LeakCase } from '../model/types';

const props = defineProps<{ cases: LeakCase[] }>();

const picked = ref('0');
const current = computed(() => props.cases[Number(picked.value)]);
const options = computed(() => props.cases.map((c, i) => ({ value: String(i), label: c.label })));

/** Роль узла в цепочке: корень, промежуточное звено или то, что удерживается. */
const nodes = computed(() =>
  current.value.chain.map((text, i) => ({
    text,
    role: i === 0 ? 'root' : i === current.value.chain.length - 1 ? 'held' : 'link',
    arrow: i < current.value.chain.length - 1,
  })),
);
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="picked" class="l-pills" label="Класс утечки" :options="options" />
    </template>

    <div class="body">
      <pre class="code">{{ current.code }}</pre>

      <div class="field">
        <div class="t-label t-label--err">цепочка удержания</div>
        <div class="chain">
          <div v-for="(node, i) in nodes" :key="i" class="chain__item">
            <div class="node" :data-role="node.role">{{ node.text }}</div>
            <span v-if="node.arrow" class="chain__link"></span>
          </div>
        </div>
      </div>

      <div class="cols">
        <div class="why">{{ current.why }}</div>

        <div class="fix">
          <div class="t-label t-label--ok">как чинится</div>
          <div class="fix__text">{{ current.fix }}</div>
          <pre class="code code--ok">{{ current.fixCode }}</pre>
        </div>
      </div>
    </div>
  </DemoFrame>
</template>

<style scoped>
.body {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 22px 20px;
  min-width: 0;
}

/* `min-width: 0` рядом с прокруткой: во флекс-колонке элемент иначе не сжимается ниже
   своего содержимого и утаскивает вбок всю страницу на узком экране. */
.code {
  padding: 15px 17px;
  min-width: 0;
  overflow-x: auto;
}
.code--ok {
  color: var(--tone-ok-on-ink);
  font-size: var(--fs-3);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.t-label--err {
  color: var(--tone-err-strong);
}
.t-label--ok {
  color: var(--tone-ok-strong);
}

.chain {
  display: flex;
  flex-direction: column;
}
.chain__item {
  display: flex;
  flex-direction: column;
}
.node {
  padding: 11px 14px;
  border-radius: var(--r2);
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.45;
  overflow-wrap: anywhere;
}
/* Корень не умрёт никогда — с него и начинается вся беда. */
.node[data-role='root'] {
  border: 1.5px solid var(--tone-err-strong);
  background: var(--tone-err-bg);
  color: var(--tone-err-strong);
  font-weight: 600;
}
.node[data-role='link'] {
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--chip-text);
}
.node[data-role='held'] {
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}
.chain__link {
  align-self: flex-start;
  width: 1px;
  height: 14px;
  margin: 5px 0 5px 22px;
  background: var(--ghost);
}

.cols {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr));
  gap: 16px;
  align-items: start;
}
.why {
  padding: 14px 16px;
  border: 1px solid var(--tone-err-line);
  border-radius: var(--r2);
  background: var(--tone-err-bg);
  font-size: var(--fs-6);
  line-height: 1.6;
  color: var(--tone-err-text);
}
.fix {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  border: 1px solid var(--tone-ok-line);
  border-radius: var(--r2);
  background: var(--tone-ok-bg);
  min-width: 0;
}
.fix__text {
  font-size: var(--fs-6);
  line-height: 1.6;
  color: var(--tone-ok-text);
}
</style>
