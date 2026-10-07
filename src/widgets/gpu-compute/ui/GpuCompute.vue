<script setup lang="ts">
/**
 * Вычисление на GPU читателя — по этапам, с проверкой против эталона на JS.
 *
 * Считает `model/run.ts`: настоящий `navigator.gpu`, настоящий шейдер из данных темы,
 * настоящее чтение через `mapAsync`. Компонент только рисует этапы по мере прохождения.
 *
 * ⚠️ Запуск — только по кнопке. На `client:visible` остров гидратируется при прокрутке,
 * а просить у системы видеокарту ради прокрутки нельзя: это и работа, и, на ноутбуке
 * с двумя картами, переключение на дискретную.
 *
 * ⚠️ Если WebGPU нет, этапы проходит модель на JS (`runModel`) — и каждый её этап подписан
 * как модель. Она не исполняет шейдер и не делает вид, что исполняет.
 */
import { computed, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import CodeListing from '@/shared/ui/CodeListing.vue';
import { Button, SegmentedControl } from '@/shared/ui';
import { absenceNote, detect, emptyStages, runModel, runOnGpu } from '../model/run';
import type { Absence } from '../model/run';
import type { GpuPreset, RunResult, Stage } from '../model/types';

const props = defineProps<{
  presets: GpuPreset[];
  /** Подпись под демо. Разрешена строчная разметка. */
  note: string;
}>();

const key = ref(props.presets[0].key);
const options = props.presets.map((p) => ({ value: p.key, label: p.label }));
const preset = computed(() => props.presets.find((p) => p.key === key.value) ?? props.presets[0]);
const lines = computed(() => preset.value.wgsl.split('\n'));

const stages = ref<Stage[]>(emptyStages());
const result = ref<RunResult | null>(null);
const running = ref(false);
const failure = ref('');

watch(key, () => {
  stages.value = emptyStages();
  result.value = null;
  failure.value = '';
});

const STATE_LABEL: Record<Stage['state'], string> = {
  idle: '·',
  run: '…',
  ok: 'ok',
  err: 'ошибка',
  warn: 'модель',
};

const run = async () => {
  if (running.value) return;
  running.value = true;
  result.value = null;
  failure.value = '';
  stages.value = emptyStages();
  const report = (next: Stage[]) => {
    stages.value = next;
  };

  const absent: Absence | null = detect();
  try {
    if (absent) {
      result.value = runModel(preset.value, absent, report);
    } else {
      try {
        result.value = await runOnGpu(preset.value, report);
      } catch (e) {
        if ((e as Error).message === 'no-adapter') result.value = runModel(preset.value, 'no-adapter', report);
        else throw e;
      }
    }
  } catch (e) {
    failure.value = `Прогон оборвался исключением: ${(e as Error).name}: ${(e as Error).message}`;
  } finally {
    running.value = false;
  }
};

const verdict = computed(() => {
  const r = result.value;
  if (!r) return null;
  if (r.mode === 'model') return { tone: 'warn', text: absenceNote(r.absence ?? 'no-api') };
  if (r.mismatches === null) return { tone: 'err', text: 'шейдер не собрался — до GPU дело не дошло' };
  if (r.mismatches === 0) return { tone: 'ok', text: `совпало **${r.total.toLocaleString('ru-RU')} из ${r.total.toLocaleString('ru-RU')}**` };
  const silent = r.stages.some((s) => (s.key === 'pipeline' || s.key === 'submit') && s.state === 'err');
  return {
    tone: 'err',
    text:
      `не совпало **${r.mismatches.toLocaleString('ru-RU')} из ${r.total.toLocaleString('ru-RU')}**` +
      (silent ? '. Исключений при этом не было ни одного: об ошибке сказала только область ошибок' : ''),
  };
});

/** Для гистограмм сумма корзин — это число учтённых значений: видно, сколько потерялось. */
const sumLine = computed(() => {
  const r = result.value;
  if (!r || r.mode !== 'gpu' || !preset.value.bins) return '';
  const lost = r.sumExpected - r.sum;
  return (
    `сумма по корзинам: **${r.sum.toLocaleString('ru-RU')}** из ${r.sumExpected.toLocaleString('ru-RU')}` +
    (lost > 0 ? ` — потеряно ${lost.toLocaleString('ru-RU')}` : '')
  );
});

const hex = (v: number) => v.toLocaleString('ru-RU');
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="gpu-bar">
        <SegmentedControl v-model="key" class="l-pills" label="Что посчитать" :options="options" />
        <Button variant="primary" :disabled="running" @click="run">
          {{ running ? 'считаю…' : result ? 'запустить ещё раз' : 'запустить на GPU' }}
        </Button>
      </div>
    </template>

    <div class="gpu-split">
      <div class="gpu-pane">
        <div class="t-label">этапы</div>
        <ol class="gpu-stages">
          <li v-for="(s, i) in stages" :key="s.key" class="gpu-stage" :data-state="s.state">
            <span class="gpu-stage__num">{{ i + 1 }}</span>
            <div class="gpu-stage__body">
              <code class="gpu-stage__call">{{ s.call }}</code>
              <Md v-if="s.detail" class="gpu-stage__detail" :text="s.detail" />
            </div>
            <span class="gpu-stage__state">{{ STATE_LABEL[s.state] }}</span>
          </li>
        </ol>

        <div v-if="failure" class="gpu-verdict" data-tone="err">{{ failure }}</div>
        <div v-else-if="verdict" class="gpu-verdict" :data-tone="verdict.tone">
          <Md :text="verdict.text" />
          <Md v-if="sumLine" class="gpu-verdict__sum" :text="sumLine" />
        </div>
        <div v-else class="gpu-empty">этапы заполнятся после запуска — их проходит ваш браузер</div>
      </div>

      <div class="gpu-pane gpu-pane--right">
        <CodeListing :lines="lines" label="шейдер (WGSL)" />

        <div v-if="result && result.sample.length" class="gpu-sample">
          <div class="t-label">{{ result.mode === 'gpu' ? (result.mismatches ? 'первые расхождения' : 'первые элементы') : 'эталон на JS' }}</div>
          <table class="gpu-table">
            <thead>
              <tr>
                <th>i</th>
                <th v-if="result.mode === 'gpu'">GPU</th>
                <th>эталон JS</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in result.sample" :key="row.i" :data-bad="result.mode === 'gpu' && row.gpu !== row.js">
                <td>{{ row.i }}</td>
                <td v-if="result.mode === 'gpu'">{{ hex(row.gpu) }}</td>
                <td>{{ hex(row.js) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <Md class="gpu-note" :text="preset.note" />
      </div>
    </div>

    <template #footer>
      <Md class="gpu-foot" :text="note" />
    </template>
  </DemoFrame>
</template>

<style scoped>
.gpu-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px 14px;
}

.gpu-split {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
}
.gpu-pane {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
  border-right: 1px solid var(--divider);
  min-width: 0;
}
.gpu-pane--right {
  border-right: 0;
  background: var(--surface-2);
  gap: 16px;
}

.gpu-stages {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.gpu-stage {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) auto;
  gap: 10px;
  align-items: start;
  padding: 9px 11px;
  border: 1px solid var(--border);
  border-radius: var(--r1);
  background: var(--surface);
}
.gpu-stage[data-state='ok'] {
  border-color: var(--tone-ok-line);
  background: var(--tone-ok-bg);
}
.gpu-stage[data-state='err'] {
  border-color: var(--tone-err-line);
  background: var(--tone-err-bg);
}
.gpu-stage[data-state='warn'] {
  border-color: var(--tone-warn-line);
  background: var(--tone-warn-bg);
}
.gpu-stage[data-state='run'] {
  border-color: var(--tone-info-line);
  background: var(--tone-info-bg);
}
.gpu-stage__num {
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--dim);
}
.gpu-stage__body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.gpu-stage__call {
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.5;
  color: var(--ink);
  overflow-wrap: anywhere;
}
.gpu-stage__detail {
  font-size: var(--fs-4);
  line-height: 1.5;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}
.gpu-stage__state {
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.6;
  white-space: nowrap;
  color: var(--dim);
}
.gpu-stage[data-state='ok'] .gpu-stage__state {
  color: var(--tone-ok-text);
}
.gpu-stage[data-state='err'] .gpu-stage__state {
  color: var(--tone-err-text);
}
.gpu-stage[data-state='warn'] .gpu-stage__state {
  color: var(--tone-warn-text);
}

.gpu-verdict {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  border-radius: var(--r2);
  font-size: var(--fs-5);
  line-height: 1.55;
}
.gpu-verdict[data-tone='ok'] {
  border: 1px solid var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.gpu-verdict[data-tone='err'] {
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}
.gpu-verdict[data-tone='warn'] {
  border: 1px solid var(--tone-warn-line);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.gpu-verdict__sum {
  font-size: var(--fs-4);
}

.gpu-empty {
  font-family: var(--mono);
  font-size: var(--fs-2);
  font-style: italic;
  color: var(--ghost);
}

.gpu-sample {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.gpu-table {
  width: 100%;
  border-collapse: collapse;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
}
.gpu-table th,
.gpu-table td {
  padding: 5px 8px;
  border-bottom: 1px solid var(--divider);
  text-align: end;
}
.gpu-table th {
  font-weight: 400;
  color: var(--text-faint);
}
.gpu-table tr[data-bad='true'] td {
  color: var(--tone-err-text);
}

.gpu-note {
  font-size: var(--fs-4);
  line-height: 1.55;
  color: var(--text-muted);
}
.gpu-foot {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}

@media (max-width: 760px) {
  .gpu-split {
    grid-template-columns: 1fr;
  }
  .gpu-pane {
    border-right: 0;
    border-bottom: 1px solid var(--divider);
  }
}
</style>
