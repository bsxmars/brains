<script setup lang="ts">
/**
 * Решётка видов элементов: куда переезжает массив после каждой операции.
 *
 * Смысл решётки в том, что движение по ней **одностороннее**: вправо (появились дыры)
 * и вниз (расширился тип) — можно, обратно — нет. Поэтому клетки подписаны, а не просто
 * подсвечены: плотная клетка зелёная, дырявая красная, и видно, в какую сторону уехали.
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import type { ElementsCase, ElementsRow } from '../model/types';

const props = defineProps<{ cases: ElementsCase[]; grid: ElementsRow[] }>();

const picked = ref('0');
const current = computed(() => props.cases[Number(picked.value)]);
const options = computed(() => props.cases.map((c, i) => ({ value: String(i), label: c.label })));

/** Тон пояснения: дыры — красный, плотные целые — зелёный, расширение типа — янтарный. */
const noteTone = computed(() => {
  if (current.value.col === 1) return 'err';
  return current.value.row === 0 ? 'ok' : 'warn';
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="picked" class="l-pills" label="Операция над массивом" :options="options" />
    </template>

    <div class="split">
      <div class="pane">
        <pre class="code">{{ current.code }}</pre>
        <Md class="note" :data-tone="noteTone" :text="current.note" />
      </div>

      <div class="pane pane--right">
        <div class="t-label">решётка видов · движение только вправо и вниз</div>

        <div class="grid">
          <div class="head"></div>
          <div class="head">PACKED</div>
          <div class="head">HOLEY</div>

          <template v-for="(row, r) in grid" :key="row.row">
            <div class="row-label">{{ row.row }}</div>
            <div class="cell" :class="{ active: r === current.row && current.col === 0 }" data-kind="packed">
              {{ row.packed }}
            </div>
            <div class="cell" :class="{ active: r === current.row && current.col === 1 }" data-kind="holey">
              {{ row.holey }}
            </div>
          </template>
        </div>
      </div>
    </div>
  </DemoFrame>
</template>

<style scoped>
.split {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr));
}
.pane {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
  border-right: 1px solid var(--divider);
}
.pane--right {
  border-right: 0;
  background: var(--surface-2);
}

.code {
  padding: 13px 15px;
}

.note {
  padding: 13px 15px;
  border-radius: var(--r2);
  font-size: var(--fs-6);
  line-height: 1.6;
  transition: all 0.2s;
}
.note[data-tone='ok'] {
  border: 1px solid var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.note[data-tone='warn'] {
  border: 1px solid var(--tone-warn-line);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.note[data-tone='err'] {
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}

.grid {
  display: grid;
  grid-template-columns: minmax(0, 0.8fr) minmax(0, 1fr) minmax(0, 1fr);
  gap: 6px;
}
.head {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  text-align: center;
  color: var(--text-faint);
}
.row-label {
  display: flex;
  align-items: center;
  font-size: var(--fs-4);
  color: var(--text-muted);
}
.cell {
  padding: 11px 13px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--surface-2);
  font-family: var(--mono);
  font-size: var(--fs-2);
  text-align: center;
  color: var(--text-faint);
  transition: all 0.2s;
}
.cell.active[data-kind='packed'] {
  border: 1.5px solid var(--tone-ok-strong);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-strong);
  font-weight: 600;
}
.cell.active[data-kind='holey'] {
  border: 1.5px solid var(--tone-err-strong);
  background: var(--tone-err-bg);
  color: var(--tone-err-strong);
  font-weight: 600;
}
</style>
