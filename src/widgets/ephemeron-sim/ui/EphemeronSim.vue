<script setup lang="ts">
/**
 * Симулятор эфемерона: что на самом деле происходит с записью WeakMap при сборке.
 *
 * Демо существует ради одной конкретной ошибки, которая кочует по статьям и была в оригинале
 * этого урока: «значение ссылается на ключ → цикл → запись не соберётся». Это неверно.
 * По ECMA-262 запись WeakMap — **эфемерон**: она жива тогда и только тогда, когда ключ
 * достижим **иначе**, чем через саму эту запись. Путь, который начинается внутри записи
 * и возвращается к её ключу, достижимости не создаёт.
 *
 * Поэтому правило здесь вычисляется, а не берётся из данных:
 *
 *   ключ достижим снаружи  ⇔  ключ держат напрямую
 *                             ИЛИ (значение держат снаружи И значение ссылается на ключ)
 *
 * Вторая половина и есть настоящая опасность: не цикл сам по себе, а значение, за которое
 * кто-то держится со стороны.
 */
import { computed, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import { Button, SegmentedControl } from '@/shared/ui';
import type { EphemeronScenario } from '../model/types';

const props = defineProps<{ scenarios: EphemeronScenario[]; probe?: string; probeOut?: string }>();

const picked = ref(props.scenarios[0].key);
const scenario = computed(() => props.scenarios.find((s) => s.key === picked.value) ?? props.scenarios[0]);
const options = computed(() => props.scenarios.map((s) => ({ value: s.key, label: s.label })));

/** Сборка ещё не запускалась — состояние «до» показывает граф как есть. */
const collected = ref(false);
watch(picked, () => {
  collected.value = false;
});

/** То самое правило спецификации. Всё демо держится на этих двух строках. */
const keyReachableOutside = computed(
  () => scenario.value.holder === 'key' || (scenario.value.holder === 'value' && scenario.value.valueToKey),
);
const entrySurvives = computed(() => keyReachableOutside.value);

const verdict = computed(() => {
  if (!collected.value) return { tone: 'dim', text: 'сборка ещё не запускалась' };
  return entrySurvives.value
    ? { tone: 'err', text: 'запись жива: ключ достижим снаружи записи' }
    : { tone: 'ok', text: 'запись удалена целиком — и ключ, и значение собраны' };
});

/** Погашенным рисуем то, чего после сборки не осталось. */
const gone = computed(() => collected.value && !entrySurvives.value);
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="bar">
        <SegmentedControl v-model="picked" class="l-pills" label="Расклад ссылок" :options="options" />
        <Button variant="primary" @click="collected = true">прогнать GC</Button>
      </div>
    </template>

    <div class="split">
      <div class="pane">
        <pre class="code">{{ scenario.code }}</pre>

        <div class="graph">
          <div class="holder" :data-on="scenario.holder === 'none' ? 'no' : 'yes'">
            <span class="holder__label">{{ scenario.holderLabel }}</span>
            <span class="holder__edge">
              {{ scenario.holder === 'none' ? 'ссылок снаружи нет' : scenario.holder === 'key' ? '→ ключ' : '→ значение' }}
            </span>
          </div>

          <div class="entry" :data-gone="gone ? 'yes' : 'no'">
            <div class="entry__head">WeakMap · запись</div>
            <div class="entry__cells">
              <div class="cell" data-role="key" :data-gone="gone ? 'yes' : 'no'">
                <span class="cell__role">ключ</span>
                <span class="cell__value">el</span>
              </div>
              <div class="cell" data-role="value" :data-gone="gone ? 'yes' : 'no'">
                <span class="cell__role">значение</span>
                <span class="cell__value">{{ scenario.valueToKey ? '{ el, size }' : '{ size }' }}</span>
              </div>
            </div>
            <div v-if="scenario.valueToKey" class="entry__back">↺ значение → ключ (внутри записи)</div>
          </div>
        </div>

        <div class="rule">
          <span class="rule__head">правило спецификации</span>
          Запись жива ⇔ ключ достижим <b>иначе</b>, чем через саму эту запись.
          Здесь ключ {{ keyReachableOutside ? 'достижим' : 'не достижим' }} снаружи —
          значит запись {{ entrySurvives ? 'сохраняется' : 'удаляется' }}.
        </div>
      </div>

      <div class="pane pane--right">
        <div class="verdict" :data-tone="verdict.tone">{{ verdict.text }}</div>
        <div class="why">{{ scenario.why }}</div>

        <div v-if="probe" class="probe">
          <div class="t-label">то же в Node</div>
          <pre class="code code--small">{{ probe }}</pre>
          <pre v-if="probeOut" class="code code--out">{{ probeOut }}</pre>
        </div>
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
  gap: 10px;
}

.split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
}
.pane {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  border-right: 1px solid var(--divider);
  min-width: 0;
}
.pane--right {
  border-right: 0;
  background: var(--surface-2);
}

/* `min-width: 0` рядом с прокруткой: во флекс-колонке элемент иначе не сжимается ниже
   своего содержимого и утаскивает вбок всю страницу на узком экране. */
.code {
  padding: 13px 15px;
  min-width: 0;
  overflow-x: auto;
}
.code--small {
  font-size: var(--fs-2);
}
.code--out {
  background: var(--ink-deep);
  color: var(--tone-ok-on-ink);
  font-size: var(--fs-2);
}

.graph {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* Внешний держатель: единственное, что может сделать ключ достижимым. */
.holder {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
  padding: 11px 14px;
  border-radius: var(--r3);
  transition: all 0.2s;
}
.holder[data-on='yes'] {
  border: 1.5px solid var(--tone-err-strong);
  background: var(--tone-err-bg);
}
.holder[data-on='no'] {
  border: 1px dashed var(--hairline);
  background: none;
}
.holder__label {
  font-family: var(--mono);
  font-size: var(--fs-3);
  font-weight: 600;
}
.holder[data-on='yes'] .holder__label {
  color: var(--tone-err-strong);
}
.holder[data-on='no'] .holder__label {
  color: var(--ghost);
}
.holder__edge {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-faint);
}

.entry {
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 14px;
  border: 1px solid var(--ink);
  border-radius: var(--r3);
  background: var(--surface);
  transition: all 0.25s;
}
/* Собранная запись гаснет целиком — и ключ, и значение. */
.entry[data-gone='yes'] {
  border-style: dashed;
  border-color: var(--hairline);
  background: var(--sunk-dim);
}
.entry__head {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-faint);
}
.entry__cells {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(130px, 100%), 1fr));
  gap: 8px;
}
.cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border-radius: var(--r2);
  transition: all 0.25s;
}
.cell[data-role='key'][data-gone='no'] {
  border: 1px solid var(--tone-info-line);
  background: var(--tone-info-bg);
}
.cell[data-role='value'][data-gone='no'] {
  border: 1px solid var(--tone-warn-line);
  background: var(--tone-warn-bg);
}
.cell[data-gone='yes'] {
  border: 1px dashed var(--hairline);
  background: none;
}
.cell__role {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-faint);
}
.cell__value {
  font-family: var(--mono);
  font-size: var(--fs-3);
  transition: color 0.25s;
}
.cell[data-role='key'][data-gone='no'] .cell__value {
  color: var(--tone-info-strong);
}
.cell[data-role='value'][data-gone='no'] .cell__value {
  color: var(--tone-warn-strong);
}
.cell[data-gone='yes'] .cell__value {
  color: var(--ghost);
}

/* Ребро значение → ключ: оно внутри записи, и достижимости само по себе не даёт. */
.entry__back {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-faint);
}

.rule {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 13px 15px;
  border: 1px solid var(--tone-info-line);
  border-radius: var(--r2);
  background: var(--tone-info-bg);
  font-size: var(--fs-6);
  line-height: 1.6;
  color: var(--tone-info-text);
}
.rule__head {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--tone-info-strong);
}

.verdict {
  padding: 13px 15px;
  border-radius: var(--r2);
  font-size: var(--fs-6);
  line-height: 1.55;
  transition: all 0.2s;
}
.verdict[data-tone='dim'] {
  border: 1px solid var(--divider);
  background: var(--sunk-dim);
  color: var(--dim);
}
.verdict[data-tone='ok'] {
  border: 1px solid var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.verdict[data-tone='err'] {
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}

.why {
  font-size: var(--fs-6);
  line-height: 1.6;
  color: var(--prose);
}

.probe {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 14px;
  border-top: 1px solid var(--rule);
  min-width: 0;
}

@media (max-width: 720px) {
  .split {
    grid-template-columns: 1fr;
  }
  .pane {
    border-right: 0;
    border-bottom: 1px solid var(--divider);
  }
}
</style>
