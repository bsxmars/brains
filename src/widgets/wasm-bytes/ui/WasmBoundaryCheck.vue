<script setup lang="ts">
/**
 * Таблица границы, перепроверенная в браузере читателя.
 *
 * Таблица темы снята в Node 26.8.2 и Chromium 153; здесь те же вызовы (`BOUNDARY_CALLS` из
 * `../model/run`, их же гоняет тест) исполняются в вкладке читателя и сверяются построчно.
 * Firefox и Safari переводят значения по той же спецификации — если где-то разойдутся,
 * демо покажет строку, а не «всё совпало» заготовкой.
 */
import { ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import { Button } from '@/shared/ui';
import { runBoundary, type BoundaryRow } from '../model/run';

const props = defineProps<{
  bytes: number[];
  expected: { call: string; got: string }[];
}>();

const rows = ref<(BoundaryRow & { want: string; same: boolean })[]>([]);
const busy = ref(false);
const failed = ref('');

async function check() {
  busy.value = true;
  failed.value = '';
  try {
    const got = await runBoundary(props.bytes);
    rows.value = got.map((r) => {
      const want = props.expected.find((e) => e.call === r.call)?.got ?? '—';
      return { ...r, want, same: want === r.got };
    });
  } catch (failure) {
    failed.value = failure instanceof Error ? `${failure.name}: ${failure.message}` : String(failure);
  } finally {
    busy.value = false;
  }
}

const matched = () => rows.value.filter((r) => r.same).length;
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="wasm-check-bar">
        <Button variant="primary" :disabled="busy" @click="check">прогнать в этом браузере</Button>
        <span v-if="rows.length" class="wasm-check-bar__score" :data-ok="matched() === rows.length ? 'yes' : 'no'">
          совпало {{ matched() }} из {{ rows.length }}
        </span>
      </div>
    </template>

    <div class="wasm-check">
      <p v-if="failed" class="wasm-check__failed">{{ failed }}</p>
      <p v-else-if="!rows.length" class="wasm-check__idle">
        Ещё не запускалось. Кнопка создаст модуль-«зеркало» и позовёт его тринадцать раз.
      </p>
      <div v-for="r in rows" :key="r.call" class="wasm-check__row" :data-same="r.same ? 'yes' : 'no'">
        <span class="wasm-check__call">{{ r.call }}</span>
        <span class="wasm-check__got">{{ r.got }}</span>
        <span v-if="!r.same" class="wasm-check__want">в таблице: {{ r.want }}</span>
      </div>
    </div>
  </DemoFrame>
</template>

<style scoped>
.wasm-check-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 14px;
}
.wasm-check-bar__score {
  padding: 3px 9px;
  border-radius: var(--r-full);
  font-family: var(--mono);
  font-size: var(--fs-2);
}
.wasm-check-bar__score[data-ok='yes'] {
  background: var(--tone-ok-chip);
  color: var(--tone-ok-strong);
}
.wasm-check-bar__score[data-ok='no'] {
  background: var(--tone-err-chip);
  color: var(--tone-err-strong);
}
.wasm-check {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  padding: 18px 20px;
}
.wasm-check__idle,
.wasm-check__failed {
  margin: 0;
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}
.wasm-check__failed {
  font-family: var(--mono);
  color: var(--tone-err-strong);
}
.wasm-check__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 2px 12px;
  padding: 7px 10px;
  border-radius: var(--r1);
  background: var(--surface-2);
}
.wasm-check__row[data-same='no'] {
  background: var(--tone-err-bg);
}
.wasm-check__call,
.wasm-check__got,
.wasm-check__want {
  font-family: var(--mono);
  font-size: var(--fs-3);
  overflow-wrap: anywhere;
}
.wasm-check__call {
  color: var(--ink);
}
.wasm-check__got {
  color: var(--text);
  text-align: end;
}
.wasm-check__want {
  grid-column: 1 / -1;
  color: var(--tone-err-strong);
}
</style>
