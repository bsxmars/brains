<script setup lang="ts">
/**
 * Общая память WebAssembly в вкладке читателя: создаётся ли она и можно ли её отправить.
 *
 * Спрашивает функция `probeShared` из `../model/run` — та же, что исполняет тест в Node.
 * Здесь не рисуется «потоки на общей памяти»: на этом сайте их нет, и демо показывает
 * почему — на каком шаге именно всё останавливается.
 */
import { onMounted, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { probeShared, type SharedProbe } from '../model/run';

const props = withDefaults(defineProps<{ foot?: string }>(), { foot: '' });

const report = ref<SharedProbe | null>(null);

onMounted(() => {
  report.value = probeShared();
});

interface Line {
  key: string;
  label: string;
  value: string;
  tone: 'ok' | 'warn' | 'err' | 'dim';
}

function lines(r: SharedProbe): Line[] {
  return [
    {
      key: 'iso',
      label: 'crossOriginIsolated',
      value: String(r.isolated),
      tone: r.isolated ? 'ok' : 'err',
    },
    {
      key: 'name',
      label: 'typeof SharedArrayBuffer',
      value: r.globalName,
      tone: r.globalName === 'function' ? 'ok' : 'warn',
    },
    {
      key: 'mem',
      label: 'new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true })',
      value: r.bufferTag ? `${r.memory}, буфер ${r.bufferTag}` : r.memory,
      tone: r.memory === 'создана' ? 'ok' : 'err',
    },
    {
      key: 'clone',
      label: 'structuredClone(memory) — шаг postMessage',
      value: r.clone || '—',
      tone: r.clone === 'клонирована' ? 'ok' : r.clone ? 'err' : 'dim',
    },
  ];
}
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="wasm-probe-bar">
        <span class="wasm-probe-bar__label">общая память в этой вкладке</span>
        <span v-if="!report" class="wasm-probe-bar__wait">проверяется…</span>
      </div>
    </template>

    <div class="wasm-probe">
      <div v-for="line in report ? lines(report) : []" :key="line.key" class="wasm-probe__line" :data-tone="line.tone">
        <span class="wasm-probe__label">{{ line.label }}</span>
        <span class="wasm-probe__value">{{ line.value }}</span>
      </div>
    </div>

    <template v-if="props.foot" #footer>
      <Md class="wasm-probe-foot" :text="props.foot" />
    </template>
  </DemoFrame>
</template>

<style scoped>
.wasm-probe-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: baseline;
}
.wasm-probe-bar__label {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
}
.wasm-probe-bar__wait {
  font-family: var(--mono);
  font-size: var(--fs-2);
  font-style: italic;
  color: var(--dim);
}
.wasm-probe {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 20px;
}
.wasm-probe__line {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
  gap: 4px 12px;
  padding: 10px 12px;
  border-radius: var(--r2);
  border: 1px solid var(--border);
  background: var(--surface);
}
.wasm-probe__label,
.wasm-probe__value {
  font-family: var(--mono);
  font-size: var(--fs-3);
  overflow-wrap: anywhere;
}
.wasm-probe__label {
  color: var(--ink);
}
.wasm-probe__value {
  text-align: end;
}
.wasm-probe__line[data-tone='ok'] {
  border-color: var(--tone-ok-line);
  background: var(--tone-ok-bg);
}
.wasm-probe__line[data-tone='ok'] .wasm-probe__value {
  color: var(--tone-ok-strong);
}
.wasm-probe__line[data-tone='warn'] {
  border-color: var(--tone-warn-line);
  background: var(--tone-warn-bg);
}
.wasm-probe__line[data-tone='warn'] .wasm-probe__value {
  color: var(--tone-warn-strong);
}
.wasm-probe__line[data-tone='err'] {
  border-color: var(--tone-err-line);
  background: var(--tone-err-bg);
}
.wasm-probe__line[data-tone='err'] .wasm-probe__value {
  color: var(--tone-err-strong);
}
.wasm-probe__line[data-tone='dim'] {
  border-color: var(--divider);
  background: var(--sunk-dim);
}
.wasm-probe__line[data-tone='dim'] .wasm-probe__value {
  color: var(--dim);
}
.wasm-probe-foot {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}
@media (max-width: 560px) {
  .wasm-probe__line {
    grid-template-columns: minmax(0, 1fr);
  }
  .wasm-probe__value {
    text-align: start;
  }
}
</style>
