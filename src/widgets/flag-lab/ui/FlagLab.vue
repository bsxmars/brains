<script setup lang="ts">
/**
 * «Кто включился и кто выпал»: двести пользователей, флаг `new-cart` из темы, доля ползунком.
 *
 * Ответ для каждой точки считает строка `FLAG_CODE` темы (`evaluate`, `bucketOf`), собранная
 * `new Function` в `model/run.ts`; режим «монетка» — строка `COIN_CODE`. Те же строки
 * напечатаны на странице и прогоняются `tests/unit/feature-flags.test.ts`. Компонент только
 * помнит прошлый ответ, чтобы показать, кто включился и кто выпал при последнем изменении.
 */
import { computed, ref, shallowRef, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { demoFlag, loadFlagApi, loadFlags, resolveAll } from '../model/run';
import type { Decider, DemoUser, Resolution } from '../model/types';

const props = defineProps<{
  flagCode: string;
  flagsCode: string;
  coinCode: string;
  users: DemoUser[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const api = loadFlagApi(props.flagCode, props.coinCode);
const base = loadFlags(props.flagsCode)['new-cart'];

const percent = ref(20);
const decider = ref<Decider>('hash');
const flagKey = ref('new-cart');
const rules = ref<'on' | 'off'>('on');
const killed = ref<'live' | 'killed'>('live');
/** Номер броска для монетки: растёт с каждым изменением, чтобы бросок был новый. */
const roll = ref(1);

const DECIDERS = [
  { value: 'hash', label: 'хеш ключа и id' },
  { value: 'coin', label: 'монетка' },
];
const KEYS = [
  { value: 'new-cart', label: 'new-cart' },
  { value: 'new-cart-v2', label: 'new-cart-v2' },
];
const RULES = [
  { value: 'on', label: 'с правилами' },
  { value: 'off', label: 'без правил' },
];
const KILL = [
  { value: 'live', label: 'работает' },
  { value: 'killed', label: 'выключен' },
];

const flag = computed(() => demoFlag(base, percent.value, rules.value === 'on', killed.value === 'killed'));
const results = computed<Resolution[]>(() =>
  resolveAll(api, flagKey.value, flag.value, props.users, decider.value, roll.value),
);

/** Прошлый ответ — чтобы отметить, кто включился и кто выпал. */
const before = shallowRef<boolean[]>(results.value.map((r) => r.value === true));
const after = shallowRef<boolean[]>(before.value);
watch(results, (next, prev) => {
  before.value = prev.map((r) => r.value === true);
  after.value = next.map((r) => r.value === true);
});
// Синхронно: новый бросок должен попасть в тот же пересчёт, что и само изменение,
// иначе `results` сменится дважды и отметки «включился/выпал» сотрутся.
watch(
  [percent, decider, flagKey, rules, killed],
  () => {
    roll.value += 1;
  },
  { flush: 'sync' },
);

const dots = computed(() =>
  results.value.map((r, i) => ({
    id: props.users[i].targetingKey,
    on: r.value === true,
    rule: r.reason === 'TARGETING_MATCH',
    joined: !before.value[i] && after.value[i],
    left: before.value[i] && !after.value[i],
  })),
);
const onCount = computed(() => dots.value.filter((d) => d.on).length);
const joinedCount = computed(() => dots.value.filter((d) => d.joined).length);
const leftCount = computed(() => dots.value.filter((d) => d.left).length);

const picked = ref(9);
const pickedUser = computed(() => props.users[picked.value]);
const pickedResult = computed(() => results.value[picked.value]);
const pickedBucket = computed(() => api.bucketOf(flagKey.value, pickedUser.value.targetingKey, 100));

const contextLine = computed(() => {
  const u = pickedUser.value;
  return Object.entries(u)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: '${v}'`)
    .join(', ');
});

const detailsLine = computed(() => {
  const r = pickedResult.value;
  const parts = [`value: ${String(r.value)}`];
  if (r.variant) parts.push(`variant: '${r.variant}'`);
  parts.push(`reason: '${r.reason}'`);
  if (r.errorCode) parts.push(`errorCode: '${r.errorCode}'`);
  return `{ ${parts.join(', ')} }`;
});

const whyLine = computed(() => {
  const r = pickedResult.value;
  if (r.reason === 'DISABLED') return 'Флаг выключен: ответ — значение по умолчанию, `false`. Доля сохранена и вернёт функцию тем же людям.';
  if (r.reason === 'TARGETING_MATCH') {
    return pickedUser.value.email
      ? 'Совпало первое правило — почта сотрудника. Корзина не смотрится.'
      : 'Совпало правило про страну `DE`. Корзина не смотрится.';
  }
  if (decider.value === 'coin') return 'Монетка: ответ брошен заново при этом изменении, корзины нет.';
  const b = pickedBucket.value;
  return `Корзина \`${b}\` для строки \`${flagKey.value}${pickedUser.value.targetingKey}\`: ${b < percent.value ? 'меньше' : 'не меньше'} доли ${percent.value}, вариант \`${r.variant}\`.`;
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="fl-controls">
        <div class="fl-slider">
          <label class="fl-label" for="fl-percent">доля on</label>
          <input id="fl-percent" v-model.number="percent" class="fl-range" type="range" min="0" max="100" step="1" />
          <output class="fl-value" for="fl-percent">{{ percent }}%</output>
        </div>
        <SegmentedControl v-model="decider" class="l-pills" label="Кто решает" :options="DECIDERS" />
        <SegmentedControl v-model="flagKey" class="l-pills" label="Ключ флага" :options="KEYS" />
        <SegmentedControl v-model="rules" class="l-pills" label="Правила" :options="RULES" />
        <SegmentedControl v-model="killed" class="l-pills" label="Выключатель" :options="KILL" />
      </div>
    </template>

    <div class="fl-body">
      <div class="fl-split">
        <div class="fl-col">
          <span class="fl-label">
            включено {{ onCount }} из {{ users.length }} · включились {{ joinedCount }} ·
            <span :class="{ 'fl-bad': leftCount > 0 }">выпали {{ leftCount }}</span>
          </span>
          <div class="fl-grid" role="group" :aria-label="`${onCount} из ${users.length} пользователей с новой корзиной`">
            <button
              v-for="(d, i) in dots"
              :key="d.id"
              type="button"
              class="fl-dot"
              :data-on="d.on ? 'yes' : 'no'"
              :data-rule="d.rule ? 'yes' : 'no'"
              :data-mark="d.joined ? 'joined' : d.left ? 'left' : 'none'"
              :data-picked="i === picked ? 'yes' : 'no'"
              :aria-label="`${d.id}: ${d.on ? 'включено' : 'выключено'}`"
              :aria-pressed="i === picked"
              @click="picked = i"
            />
          </div>
          <div class="fl-legend">
            <span><span class="fl-dot fl-dot--key" data-on="yes" /> включено</span>
            <span><span class="fl-dot fl-dot--key" data-on="no" /> выключено</span>
            <span><span class="fl-dot fl-dot--key" data-on="yes" data-rule="yes" /> решило правило</span>
            <span><span class="fl-dot fl-dot--key" data-on="yes" data-mark="joined" /> включился</span>
            <span><span class="fl-dot fl-dot--key" data-on="no" data-mark="left" /> выпал</span>
          </div>
        </div>

        <div class="fl-col">
          <span class="fl-label">выбран {{ pickedUser.targetingKey }}</span>
          <pre class="fl-code"><span class="fl-faint">// контекст</span>
{ {{ contextLine }} }
<span class="fl-faint">// evaluate('{{ flagKey }}', flag, context, false)</span>
<span class="fl-hit">{{ detailsLine }}</span></pre>
          <Md class="fl-why" :text="whyLine" />
        </div>
      </div>

      <Md class="fl-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.fl-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 14px;
  align-items: center;
}
.fl-slider {
  display: flex;
  flex: 1 1 240px;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.fl-range {
  flex: 1 1 120px;
  min-width: 0;
  margin: 0;
  accent-color: var(--tone-ok-strong);
  font: inherit;
  color: inherit;
}
.fl-value {
  min-width: 4.5ch;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
}
.fl-label {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-muted);
}
.fl-bad {
  color: var(--tone-err-text);
  font-weight: 600;
}

.fl-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.fl-split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}
@media (max-width: 760px) {
  .fl-split {
    grid-template-columns: minmax(0, 1fr);
  }
}
.fl-col {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.fl-grid {
  display: grid;
  grid-template-columns: repeat(20, minmax(0, 1fr));
  gap: 4px;
  max-width: 400px;
}
.fl-dot {
  display: inline-block;
  width: 100%;
  aspect-ratio: 1;
  padding: 0;
  border: 0;
  border-radius: var(--r-full);
  background: var(--surface-3);
  cursor: pointer;
  font: inherit;
  color: inherit;
}
.fl-dot[data-on='yes'] {
  background: var(--tone-ok-strong);
}
.fl-dot[data-rule='yes'] {
  border-radius: 2px;
}
.fl-dot[data-mark='joined'] {
  box-shadow: 0 0 0 2px var(--tone-ok-line);
}
.fl-dot[data-mark='left'] {
  box-shadow: 0 0 0 2px var(--tone-err-strong);
}
.fl-dot[data-picked='yes'] {
  outline: 2px solid var(--ink);
  outline-offset: 1px;
}
.fl-dot:focus-visible {
  outline: 2px solid var(--ink);
  outline-offset: 1px;
}
.fl-dot--key {
  width: 10px;
  height: 10px;
  vertical-align: -1px;
  cursor: default;
}
.fl-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  font-size: var(--fs-3);
  color: var(--text-muted);
}

.fl-code {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.7;
  color: var(--code-fg);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.fl-faint {
  color: var(--ink-faint);
}
.fl-hit {
  color: var(--tone-warn-on-ink);
}
.fl-why,
.fl-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.fl-why :deep(code),
.fl-caption :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
</style>
