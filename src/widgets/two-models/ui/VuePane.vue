<script setup lang="ts">
/**
 * Vue-половина демо: наблюдаемое поддерево и приборы рядом с ним.
 *
 * ⚠️ Приборы стоят **вне** поддерева, и это обязательное условие, а не вёрстка. Счётчик —
 * это текст на странице; окажись он внутри, наблюдатель считал бы правкой документа
 * собственные показания, а число прогонов росло бы от их отрисовки.
 *
 * Показания снимаются так: в обработчике события счётчики обнуляются (обработчик события DOM
 * выполняется раньше, чем планировщик Vue сольёт очередь — то есть до единого прогона),
 * а читаются после двух `nextTick`. Двух, а не одного: post-watcher вправе породить второй
 * проход, и на первом `nextTick` картина может быть ещё неполной.
 */
import { nextTick, onScopeDispose, provide, ref, shallowRef } from 'vue';
import { onAction } from '../model/bus';
import { REPORT } from '../model/report';
import { NODE_ORDER } from '../model/task';
import { useDomEdits } from '../model/useDomEdits';
import VApp from './VApp.vue';

/**
 * Счётчик работы — обычный объект, а не реактивный. Реактивный означал бы, что запись
 * из `onUpdated` узла будит панель, панель перерисовывается, и прибор снова мерит себя.
 */
const work = { total: 0, byNode: {} as Record<string, number> };
provide(REPORT, (node: string) => {
  work.total += 1;
  work.byNode[node] = (work.byNode[node] ?? 0) + 1;
});

const tree = ref<HTMLElement | null>(null);
const edits = useDomEdits(tree);

const generation = ref(0);
const ran = ref(false);
const lastWork = ref(0);
const lastDom = ref(0);
const byNode = shallowRef<{ name: string; n: number }[]>([]);

const clear = () => {
  work.total = 0;
  work.byNode = {};
  edits.reset();
};

const stop = onAction(async (action) => {
  if (action === 'reset') {
    generation.value += 1;
    ran.value = false;
    clear();
    await nextTick();
    clear();
    return;
  }

  clear();
  await nextTick();
  await nextTick();

  lastWork.value = work.total;
  lastDom.value = edits.read();
  byNode.value = NODE_ORDER.map((name) => ({ name, n: work.byNode[name] ?? 0 }));
  ran.value = true;
});
onScopeDispose(stop);
</script>

<template>
  <section class="tm-pane">
    <header class="tm-pane-head">
      <span class="tm-pane-title">Vue 3.5</span>
      <span class="tm-pane-tag">прогонов render-функций</span>
      <!-- Подпись занимает место переключателя из левой половины: без неё шапки разной
           высоты, и обе панели начинают дерево на разных уровнях — сравнивать числа глазами
           становится неудобно. Заодно она отвечает на вопрос, которого иначе не избежать:
           почему тумблера здесь нет. -->
      <span class="tm-pane-note">тумблера нет: сравнение пропсов встроено</span>
    </header>

    <div ref="tree" class="tm-tree"><VApp :key="generation" /></div>

    <div class="tm-meters" data-meter>
      <div class="tm-stats">
        <div class="tm-stat">
          <div class="tm-stat-label">прогонов render</div>
          <div class="tm-stat-value">{{ ran ? lastWork : '—' }}</div>
          <div class="tm-stat-note">за последнее нажатие, вместе с монтированием</div>
        </div>
        <div class="tm-stat">
          <div class="tm-stat-label">правок DOM</div>
          <div class="tm-stat-value" :data-tone="ran && lastDom === 0 ? 'ok' : undefined">
            {{ ran ? lastDom : '—' }}
          </div>
          <div class="tm-stat-note">вставки, удаления и правки текста</div>
        </div>
      </div>

      <div v-if="ran" class="tm-chips">
        <span
          v-for="node in byNode"
          :key="node.name"
          class="tm-chip"
          :data-zero="node.n === 0 ? 'yes' : 'no'"
        >
          {{ node.name }}<span class="tm-chip-num">{{ node.n }}</span>
        </span>
      </div>
      <div v-else class="tm-empty">нажмите кнопку наверху</div>
    </div>
  </section>
</template>
