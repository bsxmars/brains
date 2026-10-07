<script setup lang="ts">
/**
 * «Занятый поток»: два одинаковых волчка, один рисует главный поток, другой — воркер
 * в `OffscreenCanvas`. По кнопке главный поток занимается циклом, и счётчики показывают,
 * чей `requestAnimationFrame` продолжал рисовать.
 *
 * Файл воркера — строка `SPINNER_WORKER_CODE` из темы как есть: собирается в `Blob`
 * и запускается `new Worker`. Волчок главного потока рисует `drawSpinner` из той же строки
 * (`loadSpinner` в `model/run.ts`). `tests/unit/canvas.test.ts` исполняет обе строки темы
 * в Chromium и проверяет тот же порядок: кадры воркера внутри окна блокировки есть, кадров
 * страницы — нет.
 *
 * Запуск — только по кнопке и не при `prefers-reduced-motion: reduce`: автоплея нет.
 * Цвет волчков берётся из токена темы в момент запуска — в воркере CSS-переменных нет.
 */
import { computed, nextTick, onBeforeUnmount, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button } from '@/shared/ui';
import { useReducedMotion } from '@/shared/lib/useReducedMotion';
import { loadSpinner } from '../model/run';

const props = defineProps<{
  workerCode: string;
  /** Подпись под демо. Строчная разметка. */
  caption: string;
  /** Подпись при `prefers-reduced-motion: reduce`. */
  reducedNote: string;
}>();

const BUSY_MS = 1500;
const SIZE = 96;

const reduced = useReducedMotion();
const root = ref<HTMLElement | null>(null);
const mainCanvas = ref<HTMLCanvasElement | null>(null);
const workerCanvas = ref<HTMLCanvasElement | null>(null);

/** Каждый запуск — новые элементы: отданный воркеру холст второй раз не отдать. */
const runId = ref(0);
const phase = ref<'idle' | 'warm' | 'blocked' | 'cool' | 'done' | 'failed'>('idle');
const result = ref<{ main: number; worker: number; late: boolean } | null>(null);

let worker: Worker | null = null;
let workerUrl = '';
let raf = 0;
let timers: number[] = [];

function cleanup() {
  cancelAnimationFrame(raf);
  timers.forEach((t) => clearTimeout(t));
  timers = [];
  worker?.terminate();
  worker = null;
  if (workerUrl) URL.revokeObjectURL(workerUrl);
  workerUrl = '';
}
onBeforeUnmount(cleanup);

const now = () => performance.timeOrigin + performance.now();
const later = (ms: number) => new Promise<void>((r) => timers.push(window.setTimeout(r, ms)));
const frames = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

async function run() {
  if (reduced.value) return;
  cleanup();
  result.value = null;
  runId.value++;
  phase.value = 'warm';
  await nextTick();
  const mc = mainCanvas.value;
  const wc = workerCanvas.value;
  if (!mc || !wc || typeof wc.transferControlToOffscreen !== 'function') {
    phase.value = 'failed';
    return;
  }

  const dpr = window.devicePixelRatio || 1;
  for (const c of [mc, wc]) c.width = c.height = Math.round(SIZE * dpr);
  const color = getComputedStyle(root.value ?? document.documentElement).getPropertyValue('--ink').trim() || 'black';

  const marks: { src: 'main' | 'worker'; at: number; got: number }[] = [];
  const draw = loadSpinner(props.workerCode);
  const ctx = mc.getContext('2d')!;
  let frame = 0;
  const tick = () => {
    frame++;
    draw(ctx, frame, color);
    const t = now();
    marks.push({ src: 'main', at: t, got: t });
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  try {
    workerUrl = URL.createObjectURL(new Blob([props.workerCode], { type: 'text/javascript' }));
    worker = new Worker(workerUrl);
    worker.onmessage = ({ data }: MessageEvent<{ frame: number; at: number }>) => {
      marks.push({ src: 'worker', at: data.at, got: now() });
    };
    const offscreen = wc.transferControlToOffscreen();
    worker.postMessage({ canvas: offscreen, color }, [offscreen]);
  } catch {
    cleanup();
    phase.value = 'failed';
    return;
  }

  await later(700);
  phase.value = 'blocked';
  await frames(); // надпись «поток занят» успевает нарисоваться
  const t0 = now();
  while (now() - t0 < BUSY_MS) {
    /* главный поток занят: ни таймеров, ни кадров, ни сообщений */
  }
  const t1 = now();
  phase.value = 'cool';
  await later(700);

  const inside = (src: 'main' | 'worker') => marks.filter((m) => m.src === src && m.at > t0 && m.at < t1);
  result.value = {
    main: inside('main').length,
    worker: inside('worker').length,
    late: inside('worker').every((m) => m.got >= t1),
  };
  cleanup();
  phase.value = 'done';
}

const STATUS: Record<typeof phase.value, string> = {
  idle: 'Волчки стоят. Запуск: 0,7 с свободного потока, 1,5 с занятого, 0,7 с снова свободного.',
  warm: 'Поток свободен: крутятся оба.',
  blocked: 'Главный поток занят циклом на 1,5 с.',
  cool: 'Поток снова свободен.',
  done: '',
  failed: 'В этом браузере нет `transferControlToOffscreen` или воркер не запустился — сравнить не на чем.',
};

const status = computed(() => {
  if (phase.value !== 'done' || !result.value) return STATUS[phase.value];
  const r = result.value;
  const late = r.late ? ' Отметки этих кадров страница получила после блокировки, все разом.' : '';
  return `За 1,5 с занятого потока: главный поток нарисовал **${r.main}** кадров, воркер — **${r.worker}**.${late}`;
});

const busy = computed(() => phase.value === 'warm' || phase.value === 'blocked' || phase.value === 'cool');
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div ref="root" class="bl-tools">
        <Button variant="primary" :disabled="reduced || busy" @click="run">
          {{ busy ? 'идёт…' : 'запустить и занять поток' }}
        </Button>
      </div>
    </template>

    <div class="bl-body">
      <div :key="runId" class="bl-pair">
        <figure class="bl-fig">
          <canvas ref="mainCanvas" class="bl-canvas" :width="SIZE" :height="SIZE" aria-hidden="true" />
          <figcaption class="bl-label">главный поток</figcaption>
        </figure>
        <figure class="bl-fig">
          <canvas ref="workerCanvas" class="bl-canvas" :width="SIZE" :height="SIZE" aria-hidden="true" />
          <figcaption class="bl-label">воркер · OffscreenCanvas</figcaption>
        </figure>
      </div>

      <Md v-if="reduced" class="bl-text" :text="reducedNote" />
      <Md v-else class="bl-text bl-status" :data-phase="phase" :text="status" role="status" />
      <Md class="bl-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.bl-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
}
.bl-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
  min-width: 0;
}
.bl-pair {
  display: flex;
  flex-wrap: wrap;
  gap: 16px 40px;
  justify-content: center;
}
.bl-fig {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  margin: 0;
}
.bl-canvas {
  display: block;
  width: 96px;
  height: 96px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.bl-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.bl-text,
.bl-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.bl-text :deep(code),
.bl-caption :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
.bl-status {
  padding: 10px 12px;
  border-radius: var(--r2);
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
}
.bl-status[data-phase='blocked'] {
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
</style>
