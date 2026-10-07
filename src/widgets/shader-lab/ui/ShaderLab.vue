<script setup lang="ts">
/**
 * Редактор фрагментного шейдера: правите код — видите либо картинку, либо настоящий текст
 * ошибки от компилятора GLSL.
 *
 * Ради этого демо тема и стоит в направлении. Весь остальной курс показывает, что делает
 * браузер; здесь читатель впервые пишет код, который исполняет **не движок JS, а видеокарта**,
 * и ошибку ему сообщает не V8, а компилятор драйвера — через `gl.getShaderInfoLog()`. Текст
 * лога не пересказан и не приглажен: он выводится как есть, вместе с номером строки, потому
 * что именно его читатель увидит в своём проекте.
 *
 * ⚠️ Код читателя начинается с `#version 300 es` — так задумано. Компилятор считает строки
 * от начала переданного текста, и если бы демо приписывало преамбулу сверху, номера в логе
 * разошлись бы с номерами в редакторе. Вершинный шейдер при этом свой и показан отдельно:
 * менять его в этом демо нечего, он рисует один треугольник на весь экран.
 *
 * ⚠️ Всё, что трогает WebGL, живёт в `onMounted`: остров сперва рендерится в Node, где нет
 * ни `document`, ни контекста, и обращение к ним уронило бы сборку всей страницы.
 *
 * ⚠️ Время здесь не движется само. Анимация — это движение содержимого без действия человека,
 * то есть ровно то, от чего защищает `prefers-reduced-motion`: кнопку прячет медиазапрос
 * (до гидратации предпочтение неизвестно), а `useReducedMotion` не даёт циклу стартовать.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useReducedMotion } from '@/shared/lib/useReducedMotion';
import CodeInput from '@/shared/ui/CodeInput.vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button, SegmentedControl } from '@/shared/ui';
import { badLines, firstError, parseShaderLog, type ShaderIssue } from '../lib/parse-log';
import type { ShaderPreset } from '../model/types';

const props = defineProps<{ presets: ShaderPreset[]; vertexNote: string }>();

/** Вершинный шейдер один на все примеры: треугольник, накрывающий экран целиком. */
const VERTEX = `#version 300 es
in vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const picked = ref('0');
const preset = computed(() => props.presets[Number(picked.value)] ?? props.presets[0]);
const options = computed(() => props.presets.map((p, i) => ({ value: String(i), label: p.label })));

const code = ref(preset.value.code);
const log = ref('');
const issues = ref<ShaderIssue[]>([]);
const ok = ref(false);
const stage = ref<'compile' | 'link' | 'draw'>('compile');
const unsupported = ref('');
const playing = ref(false);
const reduced = useReducedMotion();

const canvasEl = ref<HTMLCanvasElement | null>(null);
const codeLines = computed(() => code.value.split('\n'));
const marked = computed(() => badLines(issues.value));
const summary = computed(() => firstError(issues.value));
const edited = computed(() => code.value !== preset.value.code);

let gl: WebGL2RenderingContext | null = null;
let program: WebGLProgram | null = null;
let vao: WebGLVertexArrayObject | null = null;
let buffer: WebGLBuffer | null = null;
let uRes: WebGLUniformLocation | null = null;
let uTime: WebGLUniformLocation | null = null;
let frame = 0;
let started = 0;
let observer: ResizeObserver | null = null;

function compile(type: number, source: string): { shader: WebGLShader | null; log: string } {
  if (!gl) return { shader: null, log: '' };
  const shader = gl.createShader(type);
  if (!shader) return { shader: null, log: 'не удалось создать объект шейдера' };

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  // ⚠️ `getShaderParameter` — первая и единственная точка, где видно, что компиляция не удалась.
  // Молча продолжить можно: `useProgram` с битой программой не бросает, просто ничего не рисует.
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader) ?? '';
    gl.deleteShader(shader);
    return { shader: null, log: info };
  }
  return { shader, log: gl.getShaderInfoLog(shader) ?? '' };
}

/** Размер буфера рисования — в физических пикселях, а не в CSS. Это не мелочь, см. тонкие места. */
function fit() {
  const canvas = canvasEl.value;
  if (!canvas || !gl) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width === width && canvas.height === height) return;

  canvas.width = width;
  canvas.height = height;
  gl.viewport(0, 0, width, height);
  if (ok.value) draw(playing.value ? (performance.now() - started) / 1000 : 0);
}

function draw(time: number) {
  if (!gl || !program) return;
  gl.useProgram(program);
  if (uRes) gl.uniform2f(uRes, gl.drawingBufferWidth, gl.drawingBufferHeight);
  if (uTime) gl.uniform1f(uTime, time);
  gl.bindVertexArray(vao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function clear() {
  if (!gl) return;
  // Цвет фона — чернила курса: демо не имеет права принести на страницу свой оттенок.
  gl.clearColor(0.09, 0.082, 0.121, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
}

function build() {
  if (!gl) return;

  stop();
  if (program) gl.deleteProgram(program);
  program = null;
  ok.value = false;

  stage.value = 'compile';
  const vertex = compile(gl.VERTEX_SHADER, VERTEX);
  const fragment = compile(gl.FRAGMENT_SHADER, code.value);

  if (!vertex.shader || !fragment.shader) {
    log.value = (fragment.shader ? vertex.log : fragment.log).trimEnd();
    issues.value = parseShaderLog(log.value);
    if (vertex.shader) gl.deleteShader(vertex.shader);
    if (fragment.shader) gl.deleteShader(fragment.shader);
    clear();
    return;
  }

  stage.value = 'link';
  const next = gl.createProgram();
  gl.attachShader(next, vertex.shader);
  gl.attachShader(next, fragment.shader);
  gl.linkProgram(next);
  // Шейдеры после линковки не нужны: программа держит свою копию.
  gl.deleteShader(vertex.shader);
  gl.deleteShader(fragment.shader);

  if (!gl.getProgramParameter(next, gl.LINK_STATUS)) {
    log.value = (gl.getProgramInfoLog(next) ?? '').trimEnd();
    issues.value = parseShaderLog(log.value);
    gl.deleteProgram(next);
    clear();
    return;
  }

  program = next;
  uRes = gl.getUniformLocation(program, 'u_res');
  uTime = gl.getUniformLocation(program, 'u_time');

  const location = gl.getAttribLocation(program, 'a_pos');
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);

  stage.value = 'draw';
  log.value = '';
  issues.value = [];
  ok.value = true;
  clear();
  draw(0);
}

function tick() {
  draw((performance.now() - started) / 1000);
  frame = requestAnimationFrame(tick);
}

function play() {
  if (!ok.value || reduced.value || playing.value) return;
  playing.value = true;
  started = performance.now();
  frame = requestAnimationFrame(tick);
}

function stop() {
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  playing.value = false;
}

const restore = () => {
  code.value = preset.value.code;
};

watch(preset, (next) => {
  code.value = next.code;
  log.value = '';
  issues.value = [];
});

onMounted(() => {
  const canvas = canvasEl.value;
  if (!canvas) return;

  gl = canvas.getContext('webgl2');
  if (!gl) {
    unsupported.value =
      'Браузер не отдал контекст WebGL 2. Демо в нём не заработает, но текст темы от этого не меняется.';
    return;
  }

  vao = gl.createVertexArray();
  buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  // Один треугольник, вылезающий за экран, вместо двух: меньше вершин и нет шва по диагонали.
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

  fit();
  build();

  observer = new ResizeObserver(() => fit());
  observer.observe(canvas);
});

onBeforeUnmount(() => {
  stop();
  observer?.disconnect();
  if (gl) {
    if (program) gl.deleteProgram(program);
    if (buffer) gl.deleteBuffer(buffer);
    if (vao) gl.deleteVertexArray(vao);
  }
  gl = null;
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="bar">
        <span class="t-label">фрагментный шейдер · исполняет GPU</span>
        <SegmentedControl v-model="picked" class="l-pills" label="Пример" :options="options" />
      </div>
    </template>

    <div class="body">
      <div class="split">
        <div class="pane">
          <CodeInput v-model="code" label="фрагментный шейдер" :rows="14" />

          <div class="row">
            <Button variant="primary" @click="build">собрать</Button>
            <Button v-if="edited" variant="secondary" @click="restore">вернуть пример</Button>
            <Button v-if="ok" class="play" variant="secondary" @click="playing ? stop() : play()">
              {{ playing ? 'остановить время' : 'пустить время' }}
            </Button>
          </div>
        </div>

        <div class="pane">
          <span class="t-label">канвас · слой композитора</span>
          <canvas ref="canvasEl" class="canvas"></canvas>

          <div v-if="unsupported" class="state state--err">{{ unsupported }}</div>
          <div v-else-if="ok" class="state state--ok">
            собралось · компиляция и линковка прошли, кадр нарисован
          </div>
          <div v-else class="state state--err">
            {{ stage === 'link' ? 'ошибка линковки программы' : 'ошибка компиляции шейдера' }}
          </div>
        </div>
      </div>

      <div v-if="log" class="report">
        <div class="t-label">gl.getShaderInfoLog() — текст от компилятора, как есть</div>
        <pre class="log">{{ log }}</pre>

        <div v-if="summary" class="hint">
          <template v-if="summary.line !== null">
            Первая ошибка — в строке {{ summary.line }}. Число перед ней в логе
            (<code>0:{{ summary.line }}</code>) — это не колонка, а номер исходника в массиве,
            переданном в <code>shaderSource</code>.
          </template>
          <template v-else>
            Ошибка не привязана к строке: компилятор пишет координаты
            <code>-1:-1</code>, когда речь про текст целиком.
          </template>
        </div>

        <ol class="listing" data-code>
          <li
            v-for="(line, i) in codeLines"
            :key="i"
            class="line"
            :data-bad="marked.includes(i + 1) ? 'yes' : 'no'"
          >
            <span class="ln">{{ i + 1 }}</span>
            <span class="src">{{ line || ' ' }}</span>
          </li>
        </ol>
      </div>

      <Md v-if="preset.note" class="note" :text="preset.note" />
    </div>

    <template #footer>
      <div class="disclaimer">
        <Md :text="vertexNote" />
        <pre class="vertex">{{ VERTEX }}</pre>
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

/* Сплит складывается в колонку на узком экране — в оригиналах курса он там уезжал за край. */
.split {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr));
  gap: 16px;
  align-items: start;
}
.pane {
  display: flex;
  flex-direction: column;
  gap: 9px;
  min-width: 0;
}

.row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

/* Кнопку движения прячет медиазапрос, а не только логика: до гидратации острова
   в DOM лежит серверная разметка, где предпочтение читателя ещё неизвестно. */
@media (prefers-reduced-motion: reduce) {
  .play {
    display: none;
  }
}

.canvas {
  display: block;
  width: 100%;
  max-width: 100%;
  aspect-ratio: 16 / 10;
  border-radius: var(--r2);
  background: var(--ink);
}

.state {
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.5;
}
.state--ok {
  color: var(--tone-ok-strong);
}
.state--err {
  color: var(--tone-err-strong);
}

.report {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.log {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--tone-err-chip);
  white-space: pre-wrap;
}
.hint {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}

.listing {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 11px 0;
  border-radius: var(--r2);
  background: var(--ink);
  list-style: none;
  overflow-x: auto;
}
.line {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  gap: 10px;
  padding: 1px 13px;
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.7;
  color: var(--ink-secondary);
  white-space: pre;
}
.line[data-bad='yes'] {
  background: var(--warn-wash-on-ink);
  color: var(--tone-err-chip);
}
.ln {
  color: var(--ink-faint);
  text-align: end;
}
.line[data-bad='yes'] .ln {
  color: var(--tone-warn-on-ink);
}

.note {
  font-size: var(--fs-6);
  line-height: 1.55;
  color: var(--prose);
}

.disclaimer {
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}
.vertex {
  font-size: var(--fs-2);
  line-height: 1.7;
}
</style>
