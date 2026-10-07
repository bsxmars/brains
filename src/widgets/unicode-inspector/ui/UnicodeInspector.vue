<script setup lang="ts">
/**
 * Инспектор Юникода: одна строка на четырёх уровнях сразу.
 *
 * Числа здесь не записаны в данные, а считаются на месте — `.length`, спред, `Intl.Segmenter`
 * и `TextEncoder`. Это принципиально: таблица не может разойтись с движком, потому что она
 * и есть движок. Заодно видно, что «символ» — это четыре разных ответа, а не один.
 *
 * Ползунок режет строку по кодовым единицам, как это делает `slice`. На суррогатной паре
 * разрез виден сразу: остаётся одинокий верхний суррогат — валидная JS-строка и невалидный
 * текст. Ровно отсюда берётся квадратик на границе обрезанного превью.
 *
 * Здесь только показ. Всё, что считает, — в `../model/unicode.ts`, и ровно те же функции
 * зовёт юнит-тест: демо и тест обязаны спрашивать движок одним и тем же кодом.
 *
 * ⚠️ Строка «хранение в V8» — **вывод из кодов символов**, а не ответ движка: внутреннее
 * представление строки из JS не наблюдаемо. Так об этом и написано в подвале.
 */
import { computed, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import { SegmentedControl } from '@/shared/ui';
import {
  codePoints,
  codeUnits,
  graphemes,
  isTwoByte,
  sliceUnits,
  storageBytes,
  utf8Bytes,
} from '../model/unicode';
import type { UnicodeSample } from '../model/types';

const props = defineProps<{ samples: UnicodeSample[] }>();

const picked = ref('0');
const sample = computed(() => props.samples[Number(picked.value)]);
const options = computed(() => props.samples.map((s, i) => ({ value: String(i), label: s.label })));

const cut = ref(props.samples[0].value.length);
watch(sample, (s) => {
  cut.value = s.value.length;
});

const units = computed(() => codeUnits(sample.value.value));
const points = computed(() => codePoints(sample.value.value));
const parts = computed(() => graphemes(sample.value.value));

/** `null` — только там, где в среде нет `TextEncoder`: придуманных чисел здесь не будет. */
const utf8 = computed(() => utf8Bytes(sample.value.value));

const twoByte = computed(() => isTwoByte(sample.value.value));
const storage = computed(() => storageBytes(sample.value.value));

const slice = computed(() => sliceUnits(sample.value.value, cut.value));
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="ui-bar">
        <span class="ui-bar__label">строка:</span>
        <SegmentedControl v-model="picked" class="l-pills" label="Строка для разбора" :options="options" />
      </div>
    </template>

    <div class="ui-split">
      <div class="ui-pane">
        <div class="ui-sample">
          <span class="ui-sample__glyph">{{ sample.value }}</span>
          <span class="ui-sample__note">{{ sample.note }}</span>
        </div>

        <div class="ui-levels">
          <div class="ui-level" data-tone="info">
            <span class="ui-level__name">кодовые единицы</span>
            <span class="ui-level__how">.length · s[i] · charCodeAt</span>
            <span class="ui-level__n">{{ units.length }}</span>
          </div>
          <div class="ui-level" data-tone="warn">
            <span class="ui-level__name">кодовые точки</span>
            <span class="ui-level__how">[...s] · for…of · codePointAt</span>
            <span class="ui-level__n">{{ points.length }}</span>
          </div>
          <div class="ui-level" data-tone="ok">
            <span class="ui-level__name">графемы</span>
            <span class="ui-level__how">Intl.Segmenter</span>
            <span class="ui-level__n">{{ parts.length }}</span>
          </div>
          <div class="ui-level" data-tone="dim">
            <span class="ui-level__name">байт в UTF-8</span>
            <span class="ui-level__how">TextEncoder · сеть и файлы</span>
            <span class="ui-level__n">{{ utf8 ?? '—' }}</span>
          </div>
          <div class="ui-level" :data-tone="twoByte ? 'err' : 'ok'">
            <span class="ui-level__name">хранение в V8</span>
            <span class="ui-level__how">
              {{ twoByte ? 'SeqTwoByteString · 2 байта/единицу' : 'SeqOneByteString · 1 байт/единицу' }}
            </span>
            <span class="ui-level__n">{{ storage }}</span>
          </div>
        </div>
      </div>

      <div class="ui-pane ui-pane--right">
        <div class="t-label">кодовые единицы utf-16</div>

        <div class="ui-scroll">
          <div class="ui-units">
            <span
              v-for="u in units"
              :key="u.i"
              class="ui-unit"
              :data-kind="u.kind"
              :data-cut="u.i >= cut ? 'yes' : 'no'"
            >
              <i class="ui-unit__hex">{{ u.hex }}</i>
              <b class="ui-unit__char">{{ u.char || (u.kind === 'high' ? '◖' : '◗') }}</b>
            </span>
          </div>
        </div>

        <div class="ui-slicer">
          <label class="ui-slicer__label" :for="`cut-${picked}`">
            s.slice(0, <b>{{ cut }}</b>)
          </label>
          <input
            :id="`cut-${picked}`"
            v-model.number="cut"
            class="ui-slicer__range"
            type="range"
            min="0"
            :max="sample.value.length"
            step="1"
          />
        </div>

        <div class="ui-result" :data-tone="slice.broken ? 'err' : 'ok'">
          <div class="ui-result__head">
            <span class="ui-result__glyph">{{ slice.text || '␀' }}</span>
            <span class="ui-result__meta">
              length {{ slice.units }} · точек {{ slice.points }} · графем {{ slice.graphemes }}
            </span>
          </div>
          <div class="ui-result__verdict">
            {{
              slice.broken
                ? 'Разрез прошёл внутри суррогатной пары: остался одинокий верхний суррогат. Строка валидна для JS и невалидна как текст — при рендере квадратик, в UTF-8 replacement character.'
                : 'Границы кодовых точек целы. Но графему это ещё не защищает: составной эмодзи и флаг разваливаются на части, оставаясь валидным текстом.'
            }}
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="ui-footer">
        Числа считает ваш движок прямо сейчас, а не берёт из таблицы: <code>.length</code>, спред,
        <code>Intl.Segmenter</code> и <code>TextEncoder</code>. Строка «хранение в V8» — вывод
        из кодовых единиц: граница проходит по <code>U+00FF</code>, а не по <code>U+007F</code>,
        и заголовок объекта в неё не входит.
      </div>
    </template>
  </DemoFrame>
</template>

<style scoped>
.ui-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.ui-bar__label {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}

.ui-split {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(290px, 100%), 1fr));
}
.ui-pane {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
  padding: 20px;
  border-right: 1px solid var(--divider);
}
.ui-pane--right {
  border-right: 0;
  background: var(--surface-2);
}

.ui-sample {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: var(--r3);
  background: var(--surface);
}
.ui-sample__glyph {
  font-size: var(--fs-h3);
  line-height: 1.2;
}
.ui-sample__note {
  font-size: var(--fs-6);
  line-height: 1.55;
  color: var(--prose);
}

.ui-levels {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ui-level {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 4px 10px;
  align-items: baseline;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--surface);
  transition: all 0.2s;
}
.ui-level__name {
  font-family: var(--mono);
  font-size: var(--fs-3);
  font-weight: 600;
}
.ui-level__how {
  grid-column: 1;
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.45;
  overflow-wrap: anywhere;
  color: var(--text-faint);
}
.ui-level__n {
  grid-row: 1 / span 2;
  grid-column: 2;
  font-family: var(--mono);
  font-size: var(--fs-8);
}
.ui-level[data-tone='info'] {
  border-color: var(--tone-info-line);
  background: var(--tone-info-bg);
}
.ui-level[data-tone='info'] .ui-level__name,
.ui-level[data-tone='info'] .ui-level__n {
  color: var(--tone-info-strong);
}
.ui-level[data-tone='warn'] {
  border-color: var(--tone-warn-line);
  background: var(--tone-warn-bg);
}
.ui-level[data-tone='warn'] .ui-level__name,
.ui-level[data-tone='warn'] .ui-level__n {
  color: var(--tone-warn-strong);
}
.ui-level[data-tone='ok'] {
  border-color: var(--tone-ok-line);
  background: var(--tone-ok-bg);
}
.ui-level[data-tone='ok'] .ui-level__name,
.ui-level[data-tone='ok'] .ui-level__n {
  color: var(--tone-ok-strong);
}
.ui-level[data-tone='err'] {
  border-color: var(--tone-err-line);
  background: var(--tone-err-bg);
}
.ui-level[data-tone='err'] .ui-level__name,
.ui-level[data-tone='err'] .ui-level__n {
  color: var(--tone-err-strong);
}
.ui-level[data-tone='dim'] {
  border-color: var(--divider);
  background: var(--sunk-dim);
}
.ui-level[data-tone='dim'] .ui-level__name,
.ui-level[data-tone='dim'] .ui-level__n {
  color: var(--text-muted);
}

/* `min-width: 0` — длинная лента единиц прокручивается сама, а не растягивает страницу. */
.ui-scroll {
  min-width: 0;
  overflow-x: auto;
}
.ui-units {
  display: flex;
  gap: 4px;
  padding-bottom: 2px;
}
.ui-unit {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 6px 7px;
  border: 1px solid var(--border-strong);
  border-radius: var(--r1);
  background: var(--surface);
  transition: all 0.2s;
}
.ui-unit__hex {
  font-family: var(--mono);
  font-size: var(--fs-3);
  font-style: normal;
  color: var(--text-faint);
}
.ui-unit__char {
  font-family: var(--mono);
  font-size: var(--fs-5);
  font-weight: 400;
  line-height: 1.1;
}
/* Половинки суррогатной пары — то, что по отдельности не является текстом. */
.ui-unit[data-kind='high'],
.ui-unit[data-kind='low'] {
  border-color: var(--tone-warn-line);
  background: var(--tone-warn-bg);
}
.ui-unit[data-kind='high'] .ui-unit__char,
.ui-unit[data-kind='low'] .ui-unit__char {
  color: var(--tone-warn-strong);
}
/* Отрезанное ползунком — погашено. */
.ui-unit[data-cut='yes'] {
  border-color: var(--divider);
  background: var(--sunk-dim);
  opacity: 0.45;
}

.ui-slicer {
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-width: 0;
}
.ui-slicer__label {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--chip-text);
}
.ui-slicer__label b {
  color: var(--ink);
}
/* Цвет и фон заданы явно: у ползунка свои браузерные дефолты, а посторонних цветов в курсе нет. */
.ui-slicer__range {
  width: 100%;
  min-width: 0;
  height: 18px;
  margin: 0;
  background: var(--surface-3);
  border: 1px solid var(--border);
  border-radius: var(--r-full);
  /* И шрифт тоже: у `input` он свой, браузерный (Arial), а в курсе таких шрифтов нет. */
  font: inherit;
  color: inherit;
  accent-color: var(--ink);
}

.ui-result {
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 14px 16px;
  border-radius: var(--r2);
  transition: all 0.2s;
}
.ui-result[data-tone='ok'] {
  border: 1px solid var(--tone-ok-line);
  background: var(--tone-ok-bg);
}
.ui-result[data-tone='err'] {
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
}
.ui-result__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 10px;
}
.ui-result__glyph {
  font-size: var(--fs-8);
  line-height: 1.2;
  overflow-wrap: anywhere;
}
.ui-result__meta {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-faint);
}
.ui-result__verdict {
  font-size: var(--fs-6);
  line-height: 1.6;
}
.ui-result[data-tone='ok'] .ui-result__verdict {
  color: var(--tone-ok-text);
}
.ui-result[data-tone='err'] .ui-result__verdict {
  color: var(--tone-err-text);
}

.ui-footer {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}
</style>
