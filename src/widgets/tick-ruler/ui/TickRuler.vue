<script setup lang="ts">
/**
 * Линейка тиков: рядом с примером стоит цепочка `.then` известной длины, и видно, между
 * какими ступенями выпадает измеряемое.
 *
 * Два независимых источника правды на одном экране:
 *   вывод в консоль — настоящий, пример выполняется в браузере читателя (`run-snippet`);
 *   лента очереди   — модель трёх операций спеки (`promise-sim`), она объясняет, из чего
 *                     эта цена сложилась.
 *
 * Совпадение их ответов — не совпадение: оно проверяется тестом
 * `tests/unit/promise-sim.test.ts`. Разойдутся — сборка не пройдёт.
 */
import { computed, onMounted, ref, watch } from 'vue';
import { runWithRuler, rulerLines } from '@/features/run-snippet';
import { ticks } from '@/shared/lib/format';
import { simulate } from '@/shared/lib/promise-sim';
import { SegmentedControl } from '@/shared/ui';
import { RULER_PRESETS } from '../model/presets';

/*
 * ⚠️ Пресеты берутся из модели, а НЕ приходят пропом — и это не вкусовщина.
 *
 * Пропы острова Astro сериализует, чтобы передать их в браузер. Функция сериализацию
 * не переживает, а у пресета поле `program` — функция (прогон по модели спеки). Поэтому
 * при передаче пропом в браузер приезжал объект без `program`, `simulate()` падал с
 * «program is not a function», и остров **не гидратировался вовсе**: демо стояло мёртвым
 * на двух страницах сразу — здесь и в «Промисе изнутри».
 *
 * Дефект не ловился ничем: юнит-тесты зовут `simulate` напрямую в Node, где сериализации
 * нет, и оба прогона зелёные. Нашлось только чтением консоли живой страницы.
 */
const props = withDefaults(defineProps<{ steps?: number; initial?: number }>(), {
  steps: 6,
  initial: 2,
});

const presetList = RULER_PRESETS;

const HIT = '<-- здесь';

const picked = ref(String(props.initial));
const index = computed(() => Number(picked.value));
const preset = computed(() => presetList[index.value]);
const options = computed(() => presetList.map((p, i) => ({ value: String(i), label: p.label })));

const lines = ref<string[]>(rulerLines(presetList[props.initial].n, HIT, props.steps));
const measured = ref(false);

const hitAt = computed(() => lines.value.findIndex((line) => line.startsWith(HIT)));
const price = computed(() =>
  hitAt.value < 0
    ? preset.value.n
    : lines.value.slice(0, hitAt.value).filter((line) => line.startsWith('tick')).length,
);

/** Лента: что именно исполняется на каждом тике. */
const trace = computed(() => simulate(preset.value.program));

/** Дороже двух тиков — янтарный, два — бледно-фиолетовый, один — акцент. */
const dotColor = computed(() =>
  price.value >= 3 ? 'var(--tone-warn-accent)' : price.value === 2 ? 'var(--bar-violet)' : 'var(--accent)',
);
const heavy = computed(() => price.value >= 3);

const ladder = computed(
  () =>
    `// линейка: каждая ступень — ровно одна микрозадача\n` +
    `let p = Promise.resolve();\n` +
    `for (let i = 1; i <= ${props.steps}; i++) { const n = i; p = p.then(() => console.log('tick', n)); }\n\n` +
    `// измеряемое:\n${preset.value.code}`,
);

async function measure() {
  const result = await runWithRuler(preset.value.code, props.steps);
  measured.value = result.ok;
  lines.value = result.ok ? result.lines : rulerLines(preset.value.n, HIT, props.steps);
}

onMounted(measure);
watch(picked, measure);
</script>

<template>
  <div class="frame">
    <div class="toolbar">
      <SegmentedControl v-model="picked" class="l-pills" label="Конструкция для замера" :options="options" />
    </div>

    <div class="body">
      <pre class="code">{{ ladder }}</pre>

      <div class="block">
        <div class="t-label">
          вывод в консоль{{ measured ? ' · замерено в вашем браузере' : '' }}
        </div>
        <div class="screen">
          <div
            v-for="(line, i) in lines"
            :key="i"
            class="line"
            :class="{ hit: line.startsWith(HIT) }"
            :style="line.startsWith(HIT) ? { color: heavy ? 'var(--tone-warn-on-ink)' : 'var(--tone-info-on-ink)' } : undefined"
          >
            {{ line.startsWith(HIT) ? `${HIT}  (${ticks(price)})` : line }}
          </div>
        </div>
      </div>

      <div class="block">
        <div class="t-label">что исполняется в очереди · модель трёх операций</div>
        <div class="tape">
          <div
            v-for="step in trace.steps"
            :key="step.tick"
            class="step"
            :class="{ hit: step.hit }"
            :data-kind="step.kind"
            :data-heavy="heavy ? 'yes' : 'no'"
          >
            <span class="step__tick">тик {{ step.tick }}</span>
            <span class="step__job">{{ step.job }}</span>
            <span class="step__note">{{ step.note }}</span>
          </div>
        </div>
      </div>

      <div class="tick-ruler-foot">
        <div class="price">
          <div class="t-label">цена</div>
          <div class="dots">
            <span v-for="d in price" :key="d" class="dot" :style="{ background: dotColor }"></span>
            <span class="count" :style="{ color: heavy ? 'var(--tone-warn-strong-2)' : 'var(--tone-info-strong)' }">
              {{ ticks(price) }}
            </span>
          </div>
        </div>

        <div class="why" :class="heavy ? 'why--warn' : 'why--info'">{{ preset.why }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Рамка демо — чернилами: так в уроках отмечено всё, с чем можно взаимодействовать. */
.frame {
  background: var(--surface);
  box-shadow: var(--shadow-2);
  border-radius: var(--r4);
  overflow: hidden;
}

.toolbar {
  padding: 14px 18px;
  border-bottom: 1px solid var(--divider);
}

.body {
  display: flex;
  flex-direction: column;
  gap: 22px;
  padding: 24px 20px;
}

.code {
  padding: 16px 18px;
  line-height: 1.75;
}

.block {
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.screen {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 16px 18px;
  border-radius: var(--r3);
  background: var(--ink);
}
.line {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink-faint);
  transition: all 0.18s;
}
.line.hit {
  font-weight: 600;
  padding-left: 14px;
}

/* Лента очереди: строка на тик, имя job из спеки и что она делает. */
.tape {
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--surface);
  overflow: hidden;
}
.step {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px 11px;
  padding: 10px 13px;
  border-bottom: 1px solid var(--rule);
  transition: all 0.18s;
}
.step:last-child {
  border-bottom: 0;
}
.step__tick {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-faint);
  white-space: nowrap;
}
.step__job {
  font-family: var(--mono);
  font-size: var(--fs-3);
  overflow-wrap: anywhere;
}
.step[data-kind='reaction'] .step__job {
  color: var(--tone-info-strong);
}
.step[data-kind='thenable-job'] .step__job,
.step[data-kind='then-reaction'] .step__job {
  color: var(--tone-warn-strong);
}
.step[data-kind='plain'] .step__job {
  color: var(--chip-text);
}
.step__note {
  flex: 1 1 240px;
  font-size: var(--fs-5);
  line-height: 1.5;
  color: var(--prose);
}

/* Тик, на котором результат становится виден, — тем же приёмом, что активная строка кода
   в оригиналах: заливка тона и засечка слева. */
.step.hit[data-heavy='no'] {
  background: var(--tone-info-bg);
  box-shadow: inset 2px 0 0 var(--accent);
}
.step.hit[data-heavy='yes'] {
  background: var(--tone-warn-bg);
  box-shadow: inset 2px 0 0 var(--tone-warn-accent);
}

.tick-ruler-foot {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr));
  gap: 16px;
  align-items: start;
}
.price {
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.dots {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.dot {
  width: 14px;
  height: 14px;
  border-radius: var(--r-full);
  flex-shrink: 0;
}
.count {
  font-family: var(--mono);
  font-size: var(--fs-8);
  margin-left: 4px;
}

.why {
  padding: 14px 16px;
  border-radius: var(--r2);
  font-size: var(--fs-6);
  line-height: 1.6;
}
.why--info {
  background: var(--tone-info-bg);
  border: 1px solid var(--tone-info-line);
  color: var(--tone-info-text);
}
.why--warn {
  background: var(--tone-warn-bg);
  border: 1px solid var(--tone-warn-line);
  color: var(--tone-warn-text);
}
</style>
