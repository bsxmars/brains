<script setup lang="ts">
/**
 * Схема памяти процесса Node: контуры `rss ⊃ heap ⊃ heapUsed` и `rss ⊃ external ⊃ arrayBuffers`,
 * плюс разбор выбранного поля.
 *
 * В оригинале схема была картинкой, а таблица полей — отдельным блоком в трёх экранах ниже.
 * Читателю приходилось держать в голове, какое поле какой прямоугольник меряет, — а это ровно
 * то знание, ради которого раздел написан. Здесь выбор поля подсвечивает его контур на схеме:
 * видно и что поле меряет, и во что оно вложено.
 *
 * Рамки у прямоугольников — сознательно: это диаграмма уровня чернил, где линия означает
 * границу области памяти, а не украшение карточки.
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import { SegmentedControl } from '@/shared/ui';
import type { MemoryField } from '../model/types';

const props = defineProps<{
  fields: MemoryField[];
  /** Что живёт в rss, но не показано ни одним полем. */
  outside: string;
  /** Приписка под схемой: что из этого мерит heap snapshot. */
  snapshotNote: string;
}>();

const picked = ref<MemoryField['key']>(props.fields[0].key);
const current = computed(() => props.fields.find((f) => f.key === picked.value) ?? props.fields[0]);
const options = computed(() => props.fields.map((f) => ({ value: f.key, label: f.key })));

const on = (key: MemoryField['key']) => (picked.value === key ? 'yes' : 'no');

const ZONE: Record<MemoryField['zone'], string> = {
  outer: 'внешний контур · всё, что резидентно',
  heap: 'внутри V8 heap',
  'off-heap': 'вне V8 heap',
};
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="bar">
        <span class="bar__label">поле process.memoryUsage():</span>
        <SegmentedControl v-model="picked" class="l-pills" label="Поле memoryUsage" :options="options" />
      </div>
    </template>

    <div class="body">
      <div class="scroll">
        <div class="map">
          <div class="box box--rss" :data-on="on('rss')">
            <div class="box__head">
              <span class="box__name">rss · resident set size</span>
              <span class="box__hint">это число видит OOM-killer и cgroup-лимит контейнера</span>
            </div>

            <div class="cols">
              <div class="zone" data-zone="heap">
                <div class="zone__name">V8 heap</div>
                <div class="box box--nested" :data-on="on('heapTotal')">
                  <span class="box__name">heapTotal — зарезервировано</span>
                  <div class="box box--inner" :data-on="on('heapUsed')">
                    <span class="box__name">heapUsed — живые объекты</span>
                    <span class="box__sub">new · old · large object · code · trusted</span>
                  </div>
                </div>
                <div class="zone__cap">потолок: heap_size_limit ← его задаёт --max-old-space-size</div>
              </div>

              <div class="zone" data-zone="off">
                <div class="zone__name">вне V8 heap</div>
                <div class="box box--nested" data-zone="off" :data-on="on('external')">
                  <span class="box__name">external</span>
                  <div class="box box--inner" data-zone="off" :data-on="on('arrayBuffers')">
                    <span class="box__name">arrayBuffers</span>
                    <span class="box__sub">Buffer, ArrayBuffer, TypedArray</span>
                  </div>
                  <span class="box__sub">нативные аддоны, C++-объекты, привязанные к JS</span>
                </div>
              </div>
            </div>

            <div class="rest">{{ outside }}</div>
          </div>
        </div>
      </div>

      <div class="detail">
        <div class="t-label">выбранное поле</div>
        <div class="detail__name" :data-tone="current.tone ?? 'none'">{{ current.key }}</div>
        <div class="detail__zone">{{ ZONE[current.zone] }}</div>

        <div class="detail__what">{{ current.what }}</div>

        <div class="field">
          <div class="t-label">на что указывает рост</div>
          <div class="detail__growth" :data-tone="current.tone ?? 'none'">{{ current.growth }}</div>
        </div>

        <dl class="facts">
          <div class="fact">
            <dt>ограничивает ли --max-old-space-size</dt>
            <dd>{{ current.capped }}</dd>
          </div>
          <div class="fact">
            <dt>поток или процесс</dt>
            <dd>{{ current.scope }}</dd>
          </div>
        </dl>
      </div>
    </div>

    <template #footer>
      <div class="memory-fields-foot">{{ snapshotNote }}</div>
    </template>
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

.body {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(320px, 100%), 1fr));
  gap: 18px;
  padding: 20px;
  min-width: 0;
}

/* Схема шире телефона — прокручиваться должна она, а не страница. */
.scroll {
  min-width: 0;
  overflow-x: auto;
}
.map {
  min-width: 300px;
}

.box {
  display: flex;
  flex-direction: column;
  gap: 9px;
  border-radius: var(--r2);
  transition: all 0.2s;
}
.box--rss {
  padding: 16px;
  border: 1.5px solid var(--tone-err-line);
  background: var(--surface);
}
.box--rss[data-on='yes'] {
  border-color: var(--tone-err-strong);
  background: var(--tone-err-bg);
}
.box__head {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
}
.box--rss > .box__head .box__name {
  color: var(--tone-err-strong);
  font-weight: 600;
}
.box__hint {
  font-size: var(--fs-5);
  line-height: 1.4;
  color: var(--tone-err-text);
}
.box__name {
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.4;
  color: var(--tone-info-text);
}
.box__sub {
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.5;
  color: var(--text-faint);
}

.cols {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(210px, 100%), 1fr));
  gap: 12px;
}

.zone {
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 14px;
  border-radius: var(--r2);
  border: 1px solid var(--tone-info-line);
  background: var(--tone-info-bg);
}
.zone[data-zone='off'] {
  border-color: var(--tone-warn-line);
  background: var(--tone-warn-bg);
}
.zone__name {
  font-family: var(--mono);
  font-size: var(--fs-3);
  font-weight: 600;
  color: var(--tone-info-strong);
}
.zone[data-zone='off'] .zone__name {
  color: var(--tone-warn-strong);
}
.zone__cap {
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.5;
  color: var(--tone-warn-strong);
}

/* Вложенный контур рисуется пунктиром: это не отдельная область памяти, а поле, которое
   меряет часть родительской. */
.box--nested {
  padding: 11px 13px;
  border: 1px dashed var(--tone-info-line);
}
.box--nested[data-zone='off'] {
  border-color: var(--tone-warn-line);
}
.box--nested[data-on='yes'] {
  border-style: solid;
  border-color: var(--tone-info-strong);
  background: var(--surface);
}
.box--nested[data-zone='off'][data-on='yes'] {
  border-color: var(--tone-warn-strong);
}
.box--inner {
  gap: 5px;
  padding: 9px 11px;
  border: 1px solid var(--tone-info-line);
  background: var(--surface);
}
.box--inner[data-zone='off'] {
  border-color: var(--tone-warn-line);
}
.box--inner[data-on='yes'] {
  border-color: var(--tone-info-strong);
  background: var(--tone-info-chip);
}
.box--inner[data-zone='off'][data-on='yes'] {
  border-color: var(--tone-warn-strong);
  background: var(--tone-warn-chip);
}
.box--nested[data-zone='off'] .box__name,
.box--inner[data-zone='off'] .box__name {
  color: var(--tone-warn-text);
}

.rest {
  padding: 11px 13px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--r2);
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.6;
  color: var(--text-muted);
}

.detail {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 18px;
  border-radius: var(--r2);
  background: var(--surface-2);
  min-width: 0;
}
.detail__name {
  font-family: var(--mono);
  font-size: var(--fs-7);
  font-weight: 600;
  color: var(--ink);
}
.detail__name[data-tone='warn'] {
  color: var(--tone-warn-strong);
}
.detail__name[data-tone='err'] {
  color: var(--tone-err-strong);
}
.detail__zone {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-faint);
}
.detail__what {
  font-size: var(--fs-6);
  line-height: 1.6;
  color: var(--prose);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.detail__growth {
  padding: 12px 14px;
  border-radius: var(--r2);
  font-size: var(--fs-6);
  line-height: 1.6;
  background: var(--sunk-dim);
  color: var(--prose);
  transition: all 0.2s;
}
.detail__growth[data-tone='warn'] {
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.detail__growth[data-tone='err'] {
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}

.facts {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
}
.fact {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.fact dt {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-faint);
}
.fact dd {
  margin: 0;
  font-size: var(--fs-5);
  line-height: 1.5;
  color: var(--prose);
}

.memory-fields-foot {
  font-size: var(--fs-6);
  line-height: 1.6;
  color: var(--text-muted);
}
</style>
