<script setup lang="ts">
/**
 * «Пошагово, кеш на четыре»: одна короткая трасса — четыре политики рядом. После каждого
 * запроса видно, попал ли он, кто ушёл (вытеснен или не допущен на входе) и что лежит в кеше,
 * разложенное так, как это делает код класса: порядок LRU, корзины частот LFU, окно и части
 * основной памяти W-TinyLFU с оценками sketch, бит «спрашивали» и стрелка SIEVE.
 *
 * Считает не компонент, а классы из темы (`LRU_CODE`, `LFU_CODE`, `SKETCH_CODE`, `TINYLFU_CODE`,
 * `SIEVE_CODE`), собранные `model/run.ts`. Тот же `stepFrames` прогоняет
 * `tests/unit/eviction.test.ts` и сверяет число попаданий с `STEP_HITS`.
 */
import { computed, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import StepToolbar from '@/shared/ui/StepToolbar.vue';
import { SegmentedControl } from '@/shared/ui';
import { ALGOS, loadEviction, stepFrames } from '../model/run';
import type { EvictionCodes, StepTrace } from '../model/types';

const props = defineProps<{
  codes: EvictionCodes;
  traces: StepTrace[];
  capacity: number;
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const api = loadEviction(props.codes);

const picked = ref(props.traces[0].id);
const options = props.traces.map((t) => ({ value: t.id, label: t.label }));
const trace = computed(() => props.traces.find((t) => t.id === picked.value) ?? props.traces[0]);
const keys = computed(() => trace.value.keys.split(' '));

const runs = computed(() =>
  ALGOS.map((a) => ({ ...a, frames: stepFrames(api, a.id, keys.value, props.capacity) })),
);

const step = ref(0);
watch(picked, () => (step.value = 0));
const total = computed(() => keys.value.length);

const panels = computed(() =>
  runs.value.map((r) => {
    const frame = r.frames[step.value];
    const hits = r.frames.slice(0, step.value + 1).filter((f) => f.hit).length;
    return { id: r.id, label: r.label, frame, hits, marks: r.frames.slice(0, step.value + 1).map((f) => f.hit) };
  }),
);

const WHY = { evict: 'вытеснен', reject: 'не допущен' };
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="picked" class="l-pills" label="Трасса" :options="options" />
    </template>

    <div class="es-body">
      <Md class="es-note" :text="trace.note" />

      <div class="es-trace" aria-label="Трасса запросов">
        <span
          v-for="(k, i) in keys"
          :key="i"
          class="es-req"
          :data-state="i === step ? 'now' : i < step ? 'past' : 'next'"
        >{{ k }}</span>
      </div>

      <StepToolbar
        :counter="`запрос ${step + 1} / ${total}`"
        :at-start="step === 0"
        :at-end="step >= total - 1"
        next-label="Запрос →"
        @prev="step = Math.max(0, step - 1)"
        @next="step = Math.min(total - 1, step + 1)"
        @reset="step = 0"
      />

      <div class="es-grid" aria-live="polite">
        <section v-for="p in panels" :key="p.id" class="es-panel">
          <header class="es-head">
            <span class="es-name">{{ p.label }}</span>
            <span class="es-verdict" :data-hit="p.frame.hit ? 'yes' : 'no'">
              <code>{{ p.frame.key }}</code> — {{ p.frame.hit ? 'попадание' : 'промах' }}
            </span>
          </header>

          <div v-for="g in p.frame.groups" :key="g.label" class="es-group">
            <span class="es-label">{{ g.label }}</span>
            <div class="es-items">
              <span v-if="!g.items.length" class="es-empty">пусто</span>
              <span
                v-for="it in g.items"
                :key="it.key"
                class="es-key"
                :data-now="it.key === p.frame.key ? 'yes' : 'no'"
              ><span v-if="it.hand" class="es-hand" aria-label="стрелка">▸</span>{{ it.key }}<span v-if="it.badge" class="es-badge">{{ it.badge }}</span></span>
            </div>
          </div>

          <p class="es-gone">
            <template v-if="p.frame.gone.length">
              <span v-for="g in p.frame.gone" :key="g.key" class="es-out" :data-why="g.why"><code>{{ g.key }}</code> {{ WHY[g.why] }}</span>
            </template>
            <span v-else class="es-empty">никто не ушёл</span>
          </p>

          <footer class="es-foot">
            <span class="es-marks" aria-hidden="true"><span v-for="(m, i) in p.marks" :key="i" class="es-mark" :data-hit="m ? 'yes' : 'no'" /></span>
            <span class="es-count">попаданий: {{ p.hits }}</span>
          </footer>
        </section>
      </div>

      <Md class="es-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.es-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.es-note,
.es-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.es-note :deep(code),
.es-caption :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}

.es-trace {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.es-req {
  padding: 3px 8px;
  border-radius: var(--r2);
  font-family: var(--mono);
  font-size: var(--fs-3);
  background: var(--surface-2);
  color: var(--text-muted);
}
.es-req[data-state='past'] {
  color: var(--prose);
}
.es-req[data-state='now'] {
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
  box-shadow: inset 0 0 0 1px var(--tone-warn-line);
  font-weight: 600;
}

.es-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
@media (max-width: 760px) {
  .es-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

.es-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  padding: 14px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.es-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.es-name {
  font-family: var(--mono);
  font-size: var(--fs-4);
  font-weight: 600;
  color: var(--ink);
}
.es-verdict {
  font-size: var(--fs-3);
  color: var(--tone-err-text);
}
.es-verdict[data-hit='yes'] {
  color: var(--tone-ok-text);
}
.es-verdict code,
.es-out code {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}

.es-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.es-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.es-items {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-height: 1.9em;
}
.es-key {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  padding: 3px 8px;
  border-radius: var(--r2);
  font-family: var(--mono);
  font-size: var(--fs-3);
  background: var(--surface);
  color: var(--ink);
  box-shadow: inset 0 0 0 1px var(--border);
}
.es-key[data-now='yes'] {
  background: var(--tone-warn-bg);
  box-shadow: inset 0 0 0 1px var(--tone-warn-line);
}
.es-badge {
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.es-hand {
  color: var(--tone-info-text);
}
.es-empty {
  font-size: var(--fs-2);
  color: var(--text-muted);
}

.es-gone {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0;
  font-size: var(--fs-3);
  color: var(--prose);
}
.es-out {
  padding: 2px 8px;
  border-radius: var(--r2);
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}
.es-out[data-why='reject'] {
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
}

.es-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.es-marks {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
}
.es-mark {
  width: 8px;
  height: 8px;
  border-radius: var(--r-full);
  background: var(--bar-neutral);
}
.es-mark[data-hit='yes'] {
  background: var(--bar-green);
}
.es-count {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}
</style>
