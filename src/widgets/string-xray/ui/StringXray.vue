<script setup lang="ts">
/**
 * «Рентген строки»: что физически лежит в объекте каждого представления.
 *
 * В оригинале это демо показывало только тип из `%DebugPrint` и пару полей текстом. Но вопрос,
 * ради которого тема вообще существует, — не «какой тип», а «на какой буфер ведёт цепочка
 * ссылок». Поэтому здесь рисуется сам объект: заголовок с полями, ячейки содержимого шириной
 * в один или два байта, стрелка на чужой буфер и полоса удерживаемой памяти.
 *
 * Полоса и тип намеренно разведены и подписаны по отдельности: у `(' ' + s).slice(1)` тип
 * такой же, как у настоящего окна в родителя, а удержание — разное. Это и есть та ловушка,
 * из-за которой по `%DebugPrint` о копировании судить нельзя.
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import { SegmentedControl } from '@/shared/ui';
import type { StringRep } from '../model/types';

const props = defineProps<{ reps: StringRep[] }>();

const picked = ref('0');
const rep = computed(() => props.reps[Number(picked.value)]);
const options = computed(() => props.reps.map((r, i) => ({ value: String(i), label: r.label })));

/** Через какое поле узел смотрит на чужой буфер — подпись у стрелки. */
const ARROW: Record<StringRep['kind'], string> = {
  seq: '',
  cons: 'first / second',
  sliced: 'parent + offset',
  thin: 'actual',
  external: 'ptr',
};

const inWindow = (i: number) => {
  const w = rep.value.parent?.window;
  return Boolean(w && i >= w.from && i < w.to);
};
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="bar">
        <span class="bar__label">что выполнили:</span>
        <SegmentedControl v-model="picked" class="l-pills" label="Представление строки" :options="options" />
      </div>
    </template>

    <div class="split">
      <div class="pane">
        <pre class="code">{{ rep.code }}</pre>

        <div class="field">
          <div class="t-label">%DebugPrint → type</div>
          <div class="type" :data-tone="rep.tone">{{ rep.type }}</div>
        </div>

        <div class="why" :data-tone="rep.tone">{{ rep.why }}</div>
        <div class="cost">{{ rep.cost }}</div>
        <div class="verified">{{ rep.verified }}</div>
      </div>

      <div class="pane pane--right">
        <div class="t-label">объект строки в памяти</div>

        <div class="scroll">
          <div class="diagram">
            <div class="object" :data-tone="rep.tone">
              <div class="fields">
                <span v-for="f in rep.header" :key="f.name" class="chip">
                  <b>{{ f.name }}</b>{{ f.value }}
                </span>
              </div>

              <div v-if="rep.cells.length" class="content">
                <div class="cells" :data-bytes="rep.bytes">
                  <span v-for="(cell, i) in rep.cells" :key="i" class="cell">{{ cell }}</span>
                  <span class="ellipsis">…</span>
                </div>
                <div class="unit">{{ rep.bytes }} {{ rep.bytes === 1 ? 'байт' : 'байта' }} на ячейку</div>
              </div>

              <div v-else class="empty">байтов не хранит — только ссылки</div>
            </div>

            <template v-if="rep.parent">
              <div class="arrow">
                <span class="arrow__line" aria-hidden="true"></span>
                <span class="arrow__label">{{ ARROW[rep.kind] }}</span>
              </div>

              <div class="object object--parent">
                <div class="parent__label">{{ rep.parent.label }}</div>
                <div class="cells" :data-bytes="rep.bytes">
                  <span
                    v-for="(cell, i) in rep.parent.cells"
                    :key="i"
                    class="cell"
                    :class="{ 'cell--window': inWindow(i) }"
                  >{{ cell }}</span>
                  <span class="ellipsis">…</span>
                </div>
                <div class="parent__note">{{ rep.parent.note }}</div>
              </div>
            </template>
          </div>
        </div>

        <div class="holds">
          <div class="t-label">сколько памяти удерживается</div>
          <div class="track">
            <div class="fill" :data-tone="rep.tone" :style="`width:${Math.max(3, rep.holds.share * 100)}%`"></div>
          </div>
          <div class="holds__text" :data-tone="rep.tone">{{ rep.holds.text }}</div>
        </div>
      </div>
    </div>
  </DemoFrame>
</template>

<style scoped>
.bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.bar__label {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}

.split {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(290px, 100%), 1fr));
}
.pane {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
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

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.type {
  padding: 12px 14px;
  border-radius: var(--r2);
  font-family: var(--mono);
  font-size: var(--fs-4);
  overflow-wrap: anywhere;
  transition: all 0.2s;
}
.type[data-tone='ok'] {
  border: 1px solid var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-strong);
}
.type[data-tone='warn'] {
  border: 1px solid var(--tone-warn-line);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-strong);
}
.type[data-tone='err'] {
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-strong);
}
.type[data-tone='info'] {
  border: 1px solid var(--tone-info-line);
  background: var(--tone-info-bg);
  color: var(--tone-info-strong);
}

.why {
  padding: 14px 16px;
  border-radius: var(--r2);
  border: 1px solid var(--tone-info-line);
  background: var(--tone-info-bg);
  font-size: var(--fs-6);
  line-height: 1.6;
  color: var(--tone-info-text);
}
.cost {
  font-size: var(--fs-6);
  line-height: 1.6;
  color: var(--prose);
}
.verified {
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.5;
  color: var(--text-faint);
}

/* `min-width: 0` — схема шире колонки прокручивается внутри себя, а не тащит страницу вбок. */
.scroll {
  min-width: 0;
  overflow-x: auto;
}
.diagram {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0;
  min-width: 260px;
}

.object {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 13px 14px;
  border: 1px solid var(--border);
  border-radius: var(--r3);
  background: var(--surface);
  transition: all 0.2s;
}
.object[data-tone='ok'] {
  border-color: var(--tone-ok-line);
}
.object[data-tone='warn'] {
  border-color: var(--tone-warn-line);
}
.object[data-tone='err'] {
  border-color: var(--tone-err-line);
}
.object[data-tone='info'] {
  border-color: var(--tone-info-line);
}
.object--parent {
  border-style: dashed;
  border-color: var(--border-strong);
  background: var(--sunk-dim);
}

.fields {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.chip {
  display: inline-flex;
  gap: 5px;
  padding: 5px 9px;
  border: 1px solid var(--border);
  border-radius: var(--r1);
  background: var(--surface-2);
  font-family: var(--mono);
  font-size: var(--fs-2);
  white-space: nowrap;
  color: var(--chip-text);
}
.chip b {
  font-weight: 600;
  color: var(--text-faint);
}

.content {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.cells {
  display: flex;
  align-items: center;
  gap: 3px;
}
.cell {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 26px;
  border: 1px solid var(--border-strong);
  border-radius: 2px;
  background: var(--surface-2);
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--chip-text);
}
/* Ширина ячейки — это и есть «сколько байт занимает кодовая единица». */
.cells[data-bytes='1'] .cell {
  min-width: 22px;
}
.cells[data-bytes='2'] .cell {
  min-width: 42px;
}
.cell--window {
  border-color: var(--tone-err-strong);
  background: var(--tone-err-chip);
  color: var(--tone-err-text);
}
.ellipsis {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--dim);
}
.unit {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}
.empty {
  font-family: var(--mono);
  font-size: var(--fs-2);
  font-style: italic;
  color: var(--ghost);
}

.arrow {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 4px 0;
}
.arrow__line {
  width: 0;
  height: 16px;
  border-left: 2px solid var(--tone-err-line-muted);
}
.arrow__label {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}

.parent__label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-faint);
}
.parent__note {
  font-size: var(--fs-4);
  line-height: 1.5;
  color: var(--text-muted);
}

.holds {
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-width: 0;
}
.track {
  min-width: 0;
  height: 16px;
  border-radius: var(--r1);
  background: var(--surface-3);
}
.fill {
  height: 16px;
  border-radius: var(--r1);
  transition: width 0.25s;
}
.fill[data-tone='ok'] {
  background: var(--bar-green);
}
.fill[data-tone='warn'] {
  background: var(--bar-amber);
}
.fill[data-tone='err'] {
  background: var(--bar-red);
}
.fill[data-tone='info'] {
  background: var(--bar-violet);
}
.holds__text {
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.5;
}
.holds__text[data-tone='ok'] {
  color: var(--tone-ok-strong);
}
.holds__text[data-tone='warn'] {
  color: var(--tone-warn-strong);
}
.holds__text[data-tone='err'] {
  color: var(--tone-err-strong);
}
.holds__text[data-tone='info'] {
  color: var(--tone-info-strong);
}
</style>
