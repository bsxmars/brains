<script setup lang="ts">
/**
 * Цена вызова отрисовки: одна и та же тысяча квадратов — тысячей вызовов, одним
 * инстансированным и одним батчем.
 *
 * Демо устроено вокруг главного ограничения темы: **время здесь мерить почти нечем, а структуру
 * можно**. Поэтому основное число — счётчик вызовов, снятый обёрткой над контекстом
 * (`lib/counter.ts`), и он одинаков на любой машине. Рядом стоят два времени, и оба подписаны
 * тем, что они на самом деле значат:
 *
 *  - «ваш JS на вызовы» — сколько миллисекунд заняли сами обращения к драйверу на главном
 *    потоке читателя. Это честный замер, и это **не время рисования**: команды уходят в очередь,
 *    а GPU исполняет их потом;
 *  - «время GPU» — только если у читателя есть `EXT_disjoint_timer_query_webgl2`, и только после
 *    проверки флага `GPU_DISJOINT_EXT`. Флаг означает «пока вы мерили, у GPU сменился режим,
 *    и результат — мусор». Без этой проверки замер врёт молча.
 *
 * В проверках проекта расширения нет вовсе (headless-Chromium, ANGLE/SwiftShader), и демо честно
 * говорит об этом словами вместо числа. Правильное поведение здесь — сказать «нечем», а не
 * показать красивую цифру от программного растеризатора.
 *
 * Отдельная кнопка сверяет картинки попиксельно: варианты обязаны давать **побитово одинаковый
 * результат**, иначе разговор о цене бессмыслен — сравнивали бы разное. Сверка идёт через
 * `readPixels`, а это точка синхронизации: она же и демонстрирует, чего стоит такой вопрос.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button, SegmentedControl } from '@/shared/ui';
import { countingContext, emptyCounters, type GlCounters } from '../lib/counter';
import type { DrawMode, DrawModeKey } from '../model/types';

const props = withDefaults(defineProps<{ modes: DrawMode[]; count?: number; frames?: number }>(), {
  count: 1000,
  frames: 60,
});

const VERTEX = `#version 300 es
in vec2 a_pos;
in vec2 a_off;
uniform float u_scale;
out vec3 v_color;
void main() {
  vec2 p = a_pos * u_scale + a_off;
  v_color = vec3(0.55 + 0.35 * p.x, 0.35 + 0.3 * p.y, 0.92);
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision mediump float;
in vec3 v_color;
out vec4 fragColor;
void main() {
  fragColor = vec4(v_color, 1.0);
}`;

const modeKey = ref<DrawModeKey>(props.modes[0].key);
const options = computed(() => props.modes.map((m) => ({ value: m.key, label: m.label })));
const current = computed(() => props.modes.find((m) => m.key === modeKey.value) ?? props.modes[0]);

const canvasEl = ref<HTMLCanvasElement | null>(null);
const counters = ref<GlCounters>(emptyCounters());
const cpuMs = ref<number | null>(null);
const gpuMs = ref<number | null>(null);
const gpuNote = ref('');
const bytes = ref(0);
const diff = ref<number | null>(null);
const diffNote = ref('');
const unsupported = ref('');
const measuring = ref(false);

/**
 * Своё описание таймера GPU вместо глобального типа `EXT_disjoint_timer_query_webgl2`.
 *
 * Имя такого типа живёт только в объявлениях TypeScript, а ESLint видит неизвестную глобальную
 * переменную и краснеет (`no-undef`). Выключать правило ради одной строки не стоит: оно ловит
 * настоящие опечатки в именах API. Нужны отсюда ровно две константы — и обе по делу:
 * `TIME_ELAPSED_EXT` открывает и закрывает замер, `GPU_DISJOINT_EXT` говорит, можно ли ему верить.
 */
interface TimerQueryExt {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

/** Счётчики набегают в этот объект — обёртка пишет в него, а демо показывает. */
const live = emptyCounters();

let raw: WebGL2RenderingContext | null = null;
let gl: WebGL2RenderingContext | null = null;
let program: WebGLProgram | null = null;
let uScale: WebGLUniformLocation | null = null;
let geo: WebGLBuffer | null = null;
let offsets: WebGLBuffer | null = null;
let baked: WebGLBuffer | null = null;
let vaoCalls: WebGLVertexArrayObject | null = null;
let vaoInstanced: WebGLVertexArrayObject | null = null;
let vaoBatch: WebGLVertexArrayObject | null = null;
let aPos = 0;
let aOff = 1;
let timer: TimerQueryExt | null = null;
let baseline: Uint8Array | null = null;
let observer: ResizeObserver | null = null;

/** Квадрат из двух треугольников в единичных координатах. */
const SQUARE = new Float32Array([-1, -1, 1, -1, -1, 1, 1, -1, 1, 1, -1, 1]);
const SCALE = 0.016;

function grid(n: number): Float32Array {
  const out = new Float32Array(n * 2);
  const cols = Math.ceil(Math.sqrt(n * 1.6));
  const rows = Math.ceil(n / cols);
  for (let i = 0; i < n; i++) {
    out[i * 2] = ((i % cols) + 0.5) / cols * 1.9 - 0.95;
    out[i * 2 + 1] = (Math.floor(i / cols) + 0.5) / rows * 1.9 - 0.95;
  }
  return out;
}

function shader(type: number, source: string): WebGLShader {
  const context = gl as WebGL2RenderingContext;
  const item = context.createShader(type) as WebGLShader;
  context.shaderSource(item, source);
  context.compileShader(item);
  return item;
}

function fit() {
  const canvas = canvasEl.value;
  if (!canvas || !raw) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width === width && canvas.height === height) return;
  canvas.width = width;
  canvas.height = height;
  raw.viewport(0, 0, width, height);
  renderOnce();
}

/** Один кадр выбранного варианта. Возвращает время, занятое вызовами на главном потоке. */
function renderFrame(): number {
  const context = gl;
  if (!context || !program) return 0;

  Object.assign(live, emptyCounters());

  context.clearColor(0.09, 0.082, 0.121, 1);
  context.clear(context.COLOR_BUFFER_BIT);
  context.useProgram(program);

  const started = performance.now();

  if (modeKey.value === 'calls') {
    context.bindVertexArray(vaoCalls);
    context.uniform1f(uScale, SCALE);
    const data = gridData;
    for (let i = 0; i < props.count; i++) {
      // Смещение едет константным атрибутом — по одному разговору с драйвером на квадрат.
      context.vertexAttrib2f(aOff, data[i * 2], data[i * 2 + 1]);
      context.drawArrays(context.TRIANGLES, 0, 6);
    }
  } else if (modeKey.value === 'instanced') {
    context.bindVertexArray(vaoInstanced);
    context.uniform1f(uScale, SCALE);
    context.drawArraysInstanced(context.TRIANGLES, 0, 6, props.count);
  } else {
    context.bindVertexArray(vaoBatch);
    // Геометрия уже в мировых координатах: масштаб и смещение запечены в буфер.
    context.uniform1f(uScale, 1);
    context.drawArrays(context.TRIANGLES, 0, props.count * 6);
  }

  const elapsed = performance.now() - started;
  counters.value = { ...live };
  return elapsed;
}

function renderOnce() {
  cpuMs.value = null;
  gpuMs.value = null;
  diff.value = null;
  diffNote.value = '';
  bytes.value = BYTES[modeKey.value];
  renderFrame();
}

/**
 * Замер: `frames` кадров подряд, медиана времени вызовов.
 *
 * Медиана, а не среднее: один кадр из шестидесяти почти всегда выпадает — сборщик мусора,
 * чужая вкладка, миграция потока между ядрами. Среднее такой выброс размажет по всем.
 */
async function measure() {
  if (!gl || measuring.value) return;
  measuring.value = true;
  gpuMs.value = null;
  gpuNote.value = '';

  const samples: number[] = [];
  const query = timer ? (gl.createQuery() as WebGLQuery) : null;

  for (let i = 0; i < props.frames; i++) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    if (!gl) break;
    // Запрос ставим на один кадр из середины: вложенные запросы времени запрещены.
    const measured = timer && query && i === Math.floor(props.frames / 2);
    if (measured && timer && query) gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
    samples.push(renderFrame());
    if (measured && timer) gl.endQuery(timer.TIME_ELAPSED_EXT);
  }

  samples.sort((a, b) => a - b);
  cpuMs.value = samples[Math.floor(samples.length / 2)] ?? null;

  if (!timer || !query) {
    gpuNote.value =
      'Расширения `EXT_disjoint_timer_query_webgl2` в этом браузере нет — времени GPU не будет. Это не поломка демо: расширение выдают не всем, и чаще не выдают.';
    measuring.value = false;
    return;
  }

  await readTimer(query);
  measuring.value = false;
}

/** Результат таймера GPU — и обязательная проверка флага, без которой он врёт молча. */
async function readTimer(query: WebGLQuery) {
  const context = gl;
  if (!context || !timer) return;

  for (let i = 0; i < 120; i++) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    if (!gl) return;
    if (context.getQueryParameter(query, context.QUERY_RESULT_AVAILABLE)) break;
  }

  // ⚠️ `GPU_DISJOINT_EXT` означает: пока шёл замер, GPU сменил режим (частоту, контекст,
  // питание), и число получилось про что угодно, только не про вашу работу. Читать результат
  // без этой проверки — это ровно то враньё, от которого тема предостерегает.
  const disjoint = context.getParameter(timer.GPU_DISJOINT_EXT);
  const available = context.getQueryParameter(query, context.QUERY_RESULT_AVAILABLE);

  if (disjoint) {
    gpuNote.value =
      'Флаг `GPU_DISJOINT_EXT` поднят: во время замера у GPU сменился режим, и результат — мусор. Правильный ответ здесь — выбросить замер, а не показать число.';
  } else if (!available) {
    gpuNote.value = 'Результат запроса так и не приехал за две секунды — замер выброшен.';
  } else {
    gpuMs.value = context.getQueryParameter(query, context.QUERY_RESULT) / 1e6;
  }
  context.deleteQuery(query);
}

/**
 * Сверка картинок: варианты обязаны давать одинаковые пиксели.
 *
 * `readPixels` при этом — точка синхронизации: вызов возвращается только тогда, когда GPU
 * действительно дорисовал. Ровно поэтому его и нельзя звать каждый кадр.
 */
function compare() {
  const context = raw;
  if (!context) return;

  renderFrame();
  const width = context.drawingBufferWidth;
  const height = context.drawingBufferHeight;
  const pixels = new Uint8Array(width * height * 4);
  const started = performance.now();
  context.readPixels(0, 0, width, height, context.RGBA, context.UNSIGNED_BYTE, pixels);
  const waited = performance.now() - started;

  if (!baseline || baseline.length !== pixels.length) {
    baseline = pixels;
    diff.value = 0;
    diffNote.value = `Снят эталон: вариант «${current.value.label}», ${width}×${height}. Переключите вариант и сверьте снова.`;
    return;
  }

  let changed = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (
      pixels[i] !== baseline[i] ||
      pixels[i + 1] !== baseline[i + 1] ||
      pixels[i + 2] !== baseline[i + 2]
    ) {
      changed++;
    }
  }
  diff.value = changed;
  diffNote.value = `Сверено с эталоном, ${width}×${height}. Сам вызов \`readPixels\` ждал GPU ${waited.toFixed(1)} мс — это время вашей машины и точка синхронизации, а не цена рисования.`;
}

const gridData = grid(props.count);
/** Сколько байт геометрии лежит в видеопамяти в каждом варианте. */
const BYTES: Record<DrawModeKey, number> = {
  calls: SQUARE.byteLength,
  instanced: SQUARE.byteLength + props.count * 2 * 4,
  batch: props.count * 6 * 2 * 4,
};

onMounted(() => {
  const canvas = canvasEl.value;
  if (!canvas) return;

  raw = canvas.getContext('webgl2', { antialias: false });
  if (!raw) {
    unsupported.value = 'Браузер не отдал контекст WebGL 2 — счётчики снять не на чем.';
    return;
  }
  gl = countingContext(raw, live);
  timer = raw.getExtension('EXT_disjoint_timer_query_webgl2');

  program = raw.createProgram();
  raw.attachShader(program, shader(raw.VERTEX_SHADER, VERTEX));
  raw.attachShader(program, shader(raw.FRAGMENT_SHADER, FRAGMENT));
  raw.linkProgram(program);
  if (!raw.getProgramParameter(program, raw.LINK_STATUS)) {
    unsupported.value = raw.getProgramInfoLog(program) ?? 'программа не слинковалась';
    return;
  }
  uScale = raw.getUniformLocation(program, 'u_scale');
  aPos = raw.getAttribLocation(program, 'a_pos');
  aOff = raw.getAttribLocation(program, 'a_off');

  const data = gridData;

  geo = raw.createBuffer();
  raw.bindBuffer(raw.ARRAY_BUFFER, geo);
  raw.bufferData(raw.ARRAY_BUFFER, SQUARE, raw.STATIC_DRAW);

  offsets = raw.createBuffer();
  raw.bindBuffer(raw.ARRAY_BUFFER, offsets);
  raw.bufferData(raw.ARRAY_BUFFER, data, raw.STATIC_DRAW);

  // Батч: та же тысяча квадратов, но геометрия развёрнута заранее — 12 000 вершин одним куском.
  const flat = new Float32Array(props.count * 6 * 2);
  for (let i = 0; i < props.count; i++) {
    for (let v = 0; v < 6; v++) {
      flat[(i * 6 + v) * 2] = SQUARE[v * 2] * SCALE + data[i * 2];
      flat[(i * 6 + v) * 2 + 1] = SQUARE[v * 2 + 1] * SCALE + data[i * 2 + 1];
    }
  }
  baked = raw.createBuffer();
  raw.bindBuffer(raw.ARRAY_BUFFER, baked);
  raw.bufferData(raw.ARRAY_BUFFER, flat, raw.STATIC_DRAW);

  vaoCalls = raw.createVertexArray();
  raw.bindVertexArray(vaoCalls);
  raw.bindBuffer(raw.ARRAY_BUFFER, geo);
  raw.enableVertexAttribArray(aPos);
  raw.vertexAttribPointer(aPos, 2, raw.FLOAT, false, 0, 0);
  raw.disableVertexAttribArray(aOff);

  vaoInstanced = raw.createVertexArray();
  raw.bindVertexArray(vaoInstanced);
  raw.bindBuffer(raw.ARRAY_BUFFER, geo);
  raw.enableVertexAttribArray(aPos);
  raw.vertexAttribPointer(aPos, 2, raw.FLOAT, false, 0, 0);
  raw.bindBuffer(raw.ARRAY_BUFFER, offsets);
  raw.enableVertexAttribArray(aOff);
  raw.vertexAttribPointer(aOff, 2, raw.FLOAT, false, 0, 0);
  // Делитель 1: следующее смещение берётся не на вершину, а на экземпляр.
  raw.vertexAttribDivisor(aOff, 1);

  vaoBatch = raw.createVertexArray();
  raw.bindVertexArray(vaoBatch);
  raw.bindBuffer(raw.ARRAY_BUFFER, baked);
  raw.enableVertexAttribArray(aPos);
  raw.vertexAttribPointer(aPos, 2, raw.FLOAT, false, 0, 0);
  raw.disableVertexAttribArray(aOff);
  raw.vertexAttrib2f(aOff, 0, 0);

  fit();
  renderOnce();

  observer = new ResizeObserver(() => fit());
  observer.observe(canvas);
});

onBeforeUnmount(() => {
  observer?.disconnect();
  if (raw) {
    if (program) raw.deleteProgram(program);
    for (const buffer of [geo, offsets, baked]) if (buffer) raw.deleteBuffer(buffer);
    for (const vao of [vaoCalls, vaoInstanced, vaoBatch]) if (vao) raw.deleteVertexArray(vao);
  }
  gl = null;
  raw = null;
});

const pick = (key: string) => {
  modeKey.value = key as DrawModeKey;
  renderOnce();
};

const kb = (value: number) => `${(value / 1024).toFixed(1)} КБ`;
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="bar">
        <span class="t-label">одна и та же тысяча квадратов</span>
        <SegmentedControl
          :model-value="modeKey"
          class="l-pills"
          label="Как рисуем"
          :options="options"
          @update:model-value="pick"
        />
      </div>
    </template>

    <div class="body">
      <div v-if="unsupported" class="state state--err">{{ unsupported }}</div>

      <div class="split">
        <div class="pane">
          <canvas ref="canvasEl" class="canvas"></canvas>
        </div>

        <div class="pane">
          <pre class="code">{{ current.code }}</pre>

          <div class="metrics">
            <div class="metric">
              <span class="t-label">вызовов отрисовки за кадр</span>
              <span class="metric__value" :data-tone="current.tone">{{ counters.draw }}</span>
            </div>
            <div class="metric">
              <span class="t-label">экземпляров нарисовано</span>
              <span class="metric__value">{{ counters.instances }}</span>
            </div>
            <div class="metric">
              <span class="t-label">обновлений атрибутов и униформ</span>
              <span class="metric__value" :data-tone="current.tone">{{ counters.uniform }}</span>
            </div>
            <div class="metric">
              <span class="t-label">геометрии в видеопамяти</span>
              <span class="metric__value metric__value--calm">{{ kb(bytes) }}</span>
            </div>
          </div>
        </div>
      </div>

      <Md class="verdict" :data-tone="current.tone" :text="current.note" />

      <div class="row">
        <Button variant="primary" :disabled="measuring" @click="measure">
          {{ measuring ? 'меряем…' : `измерить ${frames} кадров` }}
        </Button>
        <Button variant="secondary" @click="compare">сверить пиксели</Button>
      </div>

      <div v-if="cpuMs !== null || gpuNote || diff !== null" class="results">
        <div v-if="cpuMs !== null" class="result">
          <span class="t-label">ваш JS на сами вызовы · медиана кадра</span>
          <span class="result__value">{{ cpuMs.toFixed(2) }} мс</span>
          <span class="result__note">
            Это время вашей машины и вашего браузера, и это не время рисования: команды уходят
            в очередь, а GPU исполняет их позже.
          </span>
        </div>

        <div v-if="gpuMs !== null" class="result">
          <span class="t-label">время GPU · таймер расширения, флаг disjoint чист</span>
          <span class="result__value">{{ gpuMs.toFixed(3) }} мс</span>
        </div>
        <Md v-else-if="gpuNote" class="result__warn" :text="gpuNote" />

        <div v-if="diff !== null" class="result">
          <span class="t-label">пикселей разошлось с эталоном</span>
          <span class="result__value" :data-ok="diff === 0 ? 'yes' : 'no'">{{ diff }}</span>
          <Md class="result__note" :text="diffNote" />
        </div>
      </div>
    </div>

    <template #footer>
      <div class="disclaimer">
        Счётчики сняты обёрткой над контекстом: она считает обращения к
        <code>drawArrays</code>, <code>drawArraysInstanced</code> и соседям, к переключателям
        состояния и к униформам. Эти числа — свойство вашего кода, они одинаковы на любой машине.
        Время — нет: в проверках этого проекта работает программный растеризатор, а расширение
        таймера GPU отсутствует вовсе, поэтому абсолютные секунды оттуда не значат ничего.
        Отсюда правило темы: сравнивайте варианты по вызовам, а время смотрите у себя —
        и с оговоркой, что оно ваше.
      </div>
    </template>
  </DemoFrame>
</template>

<style scoped>
.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}

.body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 22px 20px;
  min-width: 0;
}

.split {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr));
  gap: 16px;
  align-items: start;
}
.pane {
  display: flex;
  flex-direction: column;
  gap: 11px;
  min-width: 0;
}

.canvas {
  display: block;
  width: 100%;
  max-width: 100%;
  aspect-ratio: 16 / 10;
  border-radius: var(--r2);
  background: var(--ink);
}

.code {
  font-size: var(--fs-2);
  line-height: 1.7;
}

.metrics {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(150px, 100%), 1fr));
  gap: 12px;
}
.metric {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.metric__value {
  font-family: var(--mono);
  font-size: var(--fs-8);
  color: var(--ink);
}
.metric__value--calm {
  font-size: var(--fs-7);
  color: var(--text-muted);
}
.metric__value[data-tone='err'] {
  color: var(--tone-err-strong);
}
.metric__value[data-tone='warn'] {
  color: var(--tone-warn-strong-2);
}
.metric__value[data-tone='ok'] {
  color: var(--tone-ok-strong);
}

.verdict {
  padding: 14px 16px;
  border-radius: var(--r2);
  font-size: var(--fs-6);
  line-height: 1.6;
}
.verdict[data-tone='ok'] {
  border: 1px solid var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.verdict[data-tone='warn'] {
  border: 1px solid var(--tone-warn-line);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.verdict[data-tone='err'] {
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}

.row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.results {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding-top: 15px;
  border-top: 1px solid var(--rule);
}
.result {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.result__value {
  font-family: var(--mono);
  font-size: var(--fs-7);
  color: var(--ink);
}
.result__value[data-ok='yes'] {
  color: var(--tone-ok-strong);
}
.result__value[data-ok='no'] {
  color: var(--tone-err-strong);
}
.result__note {
  font-size: var(--fs-4);
  line-height: 1.5;
  color: var(--text-muted);
}
.result__warn {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--tone-warn-text);
}

.state--err {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--tone-err-strong);
}

.disclaimer {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}
</style>
