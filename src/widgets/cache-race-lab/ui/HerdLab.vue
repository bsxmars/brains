<script setup lang="ts">
/**
 * «Толпа у пустого ключа»: читатели одной горячей записи, способ защиты и что досталось каждому —
 * свежее из кеша, старое, ожидание или поход в базу.
 *
 * Считает учебная модель — `HERD_CODE` и `SIM_CODE` из темы в виртуальном времени (`runHerd`
 * из `model/run.ts`). Тест сверяет её числа на 50 одновременных читателях с настоящим Redis,
 * а на потоке — с формулами `plainExpected` и `xfetchExpected`.
 */
import { computed, ref, shallowRef, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button, SegmentedControl } from '@/shared/ui';
import { loadModel, runHerd } from '../model/run';
import type { HerdParams, HerdPattern, HerdResult, Strategy } from '../model/types';

const props = defineProps<{
  parts: string[];
  params: HerdParams;
  strategies: { value: Strategy; label: string }[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const model = loadModel(props.parts);

const strategy = ref<Strategy>('plain');
const pattern = ref<HerdPattern>('stream');
const seed = ref(1);
const patterns = [
  { value: 'stream', label: `поток: ${props.params.streamN} чтений через истечение` },
  { value: 'miss', label: `${props.params.n} разом на пустой ключ` },
];

const result = shallowRef<HerdResult | null>(null);
let ticket = 0;
watch(
  [strategy, pattern, seed],
  async ([s, p, sd]) => {
    const my = ++ticket;
    const r = await runHerd(model, s, p, props.params, sd);
    if (my === ticket) result.value = r;
  },
  { immediate: true },
);

type Kind = 'db' | 'wait' | 'stale' | 'hit';
const kindOf = (r: HerdResult['readers'][number]): Kind => {
  if (r.db) return 'db';
  if (r.slept) return 'wait';
  if (pattern.value === 'stream' && r.at >= props.params.expiryMs && r.result === 'v0') return 'stale';
  return 'hit';
};
const LEGEND: { k: Kind; label: string }[] = [
  { k: 'hit', label: 'взял из кеша' },
  { k: 'stale', label: 'получил старое сразу' },
  { k: 'wait', label: 'ждал чужой поход в базу' },
  { k: 'db', label: 'сам ходил в базу' },
];

const cells = computed(() =>
  (result.value?.readers ?? []).map((r, i) => ({
    i,
    kind: kindOf(r),
    expiry: pattern.value === 'stream' && r.at >= props.params.expiryMs && (result.value!.readers[i - 1]?.at ?? 0) < props.params.expiryMs,
    title: `читатель ${i + 1}: пришёл на ${r.at} мс, ответ через ${r.wait} мс`,
  })),
);

const stats = computed(() => {
  const r = result.value;
  if (!r) return [];
  const counts = (k: Kind) => cells.value.filter((c) => c.kind === k).length;
  return [
    { k: 'походов в базу', v: String(r.dbCalls), tone: r.dbCalls > 1 ? 'err' : 'ok' },
    { k: 'ждали', v: String(counts('db') + counts('wait')), tone: counts('db') + counts('wait') > 1 ? 'warn' : 'ok' },
    { k: 'дольше всех ждал', v: `${Math.max(0, ...r.readers.map((x) => x.wait))} мс`, tone: 'none' },
  ];
});

const showSeed = computed(() => strategy.value === 'xfetch' && pattern.value === 'stream');
const seedNote = computed(() => {
  const first = result.value?.readers.find((r) => r.db);
  if (!first) return '';
  return `Монетка выпала у читателя, пришедшего на ${first.at} мс — за ${props.params.expiryMs - first.at} мс до срока. Зерно ${seed.value}.`;
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="hl-bar">
        <SegmentedControl v-model="strategy" class="l-pills" label="Защита" :options="strategies" />
        <SegmentedControl v-model="pattern" class="l-pills" label="Нагрузка" :options="patterns" />
      </div>
    </template>

    <div class="hl-body">
      <div class="hl-stats">
        <div v-for="s in stats" :key="s.k" class="hl-stat" :data-tone="s.tone">
          <span class="hl-label">{{ s.k }}</span>
          <b class="hl-stat__v">{{ s.v }}</b>
        </div>
      </div>

      <div class="hl-strip" role="img" :aria-label="`Читатели по порядку прихода: ${cells.length}`">
        <template v-for="c in cells" :key="c.i">
          <span v-if="c.expiry" class="hl-expiry" aria-hidden="true" />
          <span class="hl-cell" :data-kind="c.kind" :title="c.title" />
        </template>
      </div>

      <ul class="hl-legend">
        <li v-for="l in LEGEND" :key="l.k">
          <span class="hl-cell" :data-kind="l.k" aria-hidden="true" />
          {{ l.label }}
        </li>
        <li v-if="pattern === 'stream'">
          <span class="hl-expiry" aria-hidden="true" />
          ключ истёк ({{ params.expiryMs }} мс)
        </li>
      </ul>

      <div v-if="showSeed" class="hl-seed">
        <Button variant="secondary" @click="seed += 1">бросить монетки заново</Button>
        <span class="hl-seed__note">{{ seedNote }}</span>
      </div>

      <Md class="hl-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.hl-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 16px;
}
.hl-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.hl-caption,
.hl-seed__note {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.hl-caption :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
.hl-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.hl-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px;
}
.hl-stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.hl-stat__v {
  font-family: var(--mono);
  font-size: var(--fs-7);
  color: var(--ink);
}
.hl-stat[data-tone='ok'] .hl-stat__v {
  color: var(--tone-ok-strong);
}
.hl-stat[data-tone='warn'] .hl-stat__v {
  color: var(--tone-warn-strong);
}
.hl-stat[data-tone='err'] .hl-stat__v {
  color: var(--tone-err-strong);
}

.hl-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  align-items: center;
}
.hl-cell {
  display: inline-block;
  width: 12px;
  height: 18px;
  border-radius: 2px;
  background: var(--tone-ok-chip);
  box-shadow: inset 0 0 0 1px var(--tone-ok-line);
}
.hl-cell[data-kind='stale'] {
  background: var(--tone-info-chip);
  box-shadow: inset 0 0 0 1px var(--tone-info-line);
}
.hl-cell[data-kind='wait'] {
  background: var(--tone-warn-chip);
  box-shadow: inset 0 0 0 1px var(--tone-warn-line);
}
.hl-cell[data-kind='db'] {
  background: var(--tone-err-strong);
  box-shadow: none;
}
.hl-expiry {
  display: inline-block;
  width: 2px;
  height: 24px;
  margin: 0 3px;
  background: var(--ink);
}

.hl-legend {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 8px 18px;
  font-size: var(--fs-3);
  color: var(--prose);
}
.hl-legend li {
  display: flex;
  align-items: center;
  gap: 8px;
}

.hl-seed {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 14px;
}
</style>
