<script setup lang="ts">
/**
 * Потеря и восстановление контекста — по-настоящему, расширением `WEBGL_lose_context`.
 *
 * Это единственное событие темы, которое в проде случается само: драйвер перезапустили, вкладка
 * ушла в фон и видеопамять отобрали, ноутбук переключился с дискретной карты на встроенную,
 * соседняя страница уронила GPU-процесс. Обрабатывают его почти всегда неверно — и неверность
 * молчит: картинка просто исчезает навсегда, без единой ошибки в консоли.
 *
 * Демо показывает три вещи, и каждую спрашивает у движка, а не рассказывает за него:
 *
 *  1. после потери **не выживает ни один ресурс** — `gl.isTexture()`, `gl.isBuffer()`,
 *     `gl.isProgram()`, `gl.isVertexArray()` отвечают `false` на всё;
 *  2. `gl.getError()` возвращает 37442 — это `CONTEXT_LOST_WEBGL`, и он «залипает»: контекст
 *     остаётся потерянным, сколько ни спрашивай;
 *  3. без `preventDefault()` на событии `webglcontextlost` восстановления **не будет вовсе**.
 *     Даже явный `restoreContext()` ничего не сделает и ничего не бросит — тишина.
 *
 * ⚠️ Коварная деталь, которую демо показывает отдельно: `gl.createTexture()` на потерянном
 * контексте **возвращает объект, а не `null`**. Проверка «создалось — значит работает» здесь
 * не работает: объект есть, он мёртв, и рисование им молча ничего не даёт.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button, SegmentedControl } from '@/shared/ui';
import {
  aliveCount,
  glErrorName,
  resourceReport,
  type ResourceRow,
  type ResourceSlot,
} from '../lib/resources';
import type { LossEvent, LossStrategy, StrategyOption } from '../model/types';

const props = defineProps<{ strategies: StrategyOption[] }>();

const VERTEX = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_tex;
out vec4 fragColor;
void main() {
  fragColor = texture(u_tex, v_uv);
}`;

const strategy = ref<LossStrategy>('naive');
const options = computed(() => props.strategies.map((s) => ({ value: s.key, label: s.label })));
const current = computed(
  () => props.strategies.find((s) => s.key === strategy.value) ?? props.strategies[0],
);

const canvasEl = ref<HTMLCanvasElement | null>(null);
const rows = ref<ResourceRow[]>([]);
const lost = ref(false);
const errorName = ref('NO_ERROR');
const createdAfterLoss = ref('');
const events = ref<LossEvent[]>([]);
const unsupported = ref('');
const hasExtension = ref(true);

/**
 * Своё описание расширения вместо глобального типа `WEBGL_lose_context`.
 *
 * Имя такого типа существует только в объявлениях TypeScript, а ESLint видит в нём неизвестную
 * глобальную переменную и краснеет (`no-undef`). Выключать правило ради одной строки — плохой
 * размен: оно ловит настоящие опечатки в именах API. Структурного описания здесь достаточно.
 */
interface LoseContextExt {
  loseContext(): void;
  restoreContext(): void;
}

let gl: WebGL2RenderingContext | null = null;
let ext: LoseContextExt | null = null;
let slots: ResourceSlot[] = [];
let program: WebGLProgram | null = null;
let texture: WebGLTexture | null = null;
let buffer: WebGLBuffer | null = null;
let vao: WebGLVertexArrayObject | null = null;

function log(text: string, tone: LossEvent['tone'] = 'info') {
  const at = new Date().toLocaleTimeString('ru-RU', { hour12: false });
  events.value = [...events.value.slice(-7), { at, text, tone }];
}

function shader(type: number, source: string): WebGLShader {
  const context = gl as WebGL2RenderingContext;
  const item = context.createShader(type) as WebGLShader;
  context.shaderSource(item, source);
  context.compileShader(item);
  return item;
}

/** Сборка всех ресурсов с нуля. Именно её и надо позвать заново после восстановления. */
function buildResources() {
  if (!gl) return;

  program = gl.createProgram();
  gl.attachShader(program, shader(gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);

  // Текстура — шахматка 8×8: её видно, и по ней сразу понятно, жива ли она.
  const size = 8;
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const on = (x + y) % 2 === 0;
      pixels[i] = on ? 124 : 36;
      pixels[i + 1] = on ? 58 : 31;
      pixels[i + 2] = on ? 237 : 62;
      pixels[i + 3] = 255;
    }
  }
  texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

  vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const location = gl.getAttribLocation(program, 'a_pos');
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);

  slots = [
    { kind: 'texture', label: 'текстура 8×8', handle: texture },
    { kind: 'buffer', label: 'буфер вершин', handle: buffer },
    { kind: 'program', label: 'программа', handle: program },
    { kind: 'vao', label: 'VAO', handle: vao },
  ];
}

function draw() {
  if (!gl || !program) return;
  const canvas = canvasEl.value;
  if (!canvas) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
  canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
  gl.viewport(0, 0, canvas.width, canvas.height);

  gl.clearColor(0.09, 0.082, 0.121, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(program);
  gl.bindVertexArray(vao);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

/** Снимок состояния: что отвечает движок прямо сейчас. */
function refresh() {
  if (!gl) return;
  rows.value = resourceReport(gl as unknown as Record<string, unknown>, slots);
  lost.value = gl.isContextLost();
  errorName.value = glErrorName(gl.getError());
}

function onLost(event: Event) {
  log('событие webglcontextlost', 'err');

  if (strategy.value === 'correct') {
    // ⚠️ Вот эта строка и решает всё. Без неё браузер считает, что страница сдалась,
    // и контекст не вернётся ни сам, ни по явной просьбе.
    event.preventDefault();
    log('вызван preventDefault() — просим контекст обратно', 'ok');
  } else {
    log('preventDefault() не вызван — браузер считает, что возвращать контекст некому', 'err');
  }

  // Ресурсы уже мертвы: спрашиваем движок, а не предполагаем.
  refresh();
  if (gl) createdAfterLoss.value = String(gl.createTexture());
}

function onRestored() {
  log('событие webglcontextrestored', 'ok');
  // Всё, что было, — мусор. Единственный правильный ответ: собрать заново.
  buildResources();
  draw();
  refresh();
  createdAfterLoss.value = '';
  log('ресурсы созданы заново, кадр нарисован', 'ok');
}

const lose = () => {
  if (!ext) return;
  ext.loseContext();
};

const restore = () => {
  if (!ext) return;
  log('вызван restoreContext()');
  ext.restoreContext();
  // Событие придёт не сразу — снимок обновится по нему; а пока покажем состояние как есть.
  window.setTimeout(refresh, 300);
};

const alive = computed(() => aliveCount(rows.value));

onMounted(() => {
  const canvas = canvasEl.value;
  if (!canvas) return;

  gl = canvas.getContext('webgl2');
  if (!gl) {
    unsupported.value = 'Браузер не отдал контекст WebGL 2 — демо не на чем показать.';
    return;
  }

  ext = gl.getExtension('WEBGL_lose_context');
  if (!ext) {
    hasExtension.value = false;
    unsupported.value =
      'Расширения WEBGL_lose_context здесь нет: потерять контекст по кнопке не выйдет. В проде это случается само и без всякого расширения.';
  }

  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);

  buildResources();
  draw();
  refresh();
  log('контекст создан, ресурсы на месте');
});

onBeforeUnmount(() => {
  const canvas = canvasEl.value;
  canvas?.removeEventListener('webglcontextlost', onLost);
  canvas?.removeEventListener('webglcontextrestored', onRestored);
  gl = null;
  ext = null;
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="bar">
        <span class="t-label">webglcontextlost · как его обработать</span>
        <SegmentedControl
          v-model="strategy"
          class="l-pills"
          label="Стратегия обработки"
          :options="options"
        />
      </div>
    </template>

    <div class="body">
      <div v-if="unsupported" class="state state--err">{{ unsupported }}</div>

      <div class="split">
        <div class="pane">
          <canvas ref="canvasEl" class="canvas"></canvas>

          <div class="row">
            <Button variant="primary" :disabled="!hasExtension || lost" @click="lose">
              потерять контекст
            </Button>
            <Button variant="secondary" :disabled="!hasExtension || !lost" @click="restore">
              восстановить
            </Button>
          </div>

          <div class="status">
            <span class="status__item" :data-tone="lost ? 'err' : 'ok'">
              isContextLost() → {{ lost }}
            </span>
            <span class="status__item" :data-tone="errorName === 'NO_ERROR' ? 'ok' : 'err'">
              getError() → {{ errorName }}
            </span>
          </div>
        </div>

        <div class="pane">
          <span class="t-label">живых ресурсов: {{ alive }} из {{ rows.length }}</span>

          <ul class="ledger">
            <li v-for="row in rows" :key="row.label" class="slot" :data-alive="row.alive">
              <span class="slot__name">{{ row.label }}</span>
              <span class="slot__probe">{{ row.probe }}</span>
              <span class="slot__value">{{ row.alive }}</span>
            </li>
          </ul>

          <div v-if="createdAfterLoss" class="trap">
            <span class="t-label">и главная ловушка</span>
            <span class="trap__value">gl.createTexture() → {{ createdAfterLoss }}</span>
            <span class="trap__note">
              Не <code>null</code>. Объект создался, он мёртв, рисование им молча ничего не даст —
              проверка «создалось, значит работает» здесь не работает.
            </span>
          </div>
        </div>
      </div>

      <Md class="verdict" :data-tone="current.tone" :text="current.note" />
      <pre class="code">{{ current.code }}</pre>

      <div class="journal">
        <span class="t-label">журнал событий</span>
        <ol class="events">
          <li v-for="(item, i) in events" :key="i" class="event" :data-tone="item.tone">
            <span class="event__at">{{ item.at }}</span>
            <span class="event__text">{{ item.text }}</span>
          </li>
        </ol>
      </div>
    </div>

    <template #footer>
      <div class="disclaimer">
        Потеря настоящая: её делает расширение <code>WEBGL_lose_context</code>, а не имитация
        в коде демо. Поэтому и ответы в таблице — от движка: каждая строка спрашивает
        <code>gl.isTexture()</code>, <code>gl.isBuffer()</code> и соседей. В проде расширение
        не нужно — контекст теряется сам, и приходит то же самое событие.
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

.row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.status {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
}
.status__item {
  font-family: var(--mono);
  font-size: var(--fs-2);
}
.status__item[data-tone='ok'] {
  color: var(--tone-ok-strong);
}
.status__item[data-tone='err'] {
  color: var(--tone-err-strong);
}

.ledger {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}
.slot {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1.3fr) 60px;
  align-items: baseline;
  gap: 10px;
  padding: 9px 0;
  font-family: var(--mono);
  font-size: var(--fs-2);
}
.slot + .slot {
  border-top: 1px solid var(--rule);
}
.slot__name {
  color: var(--ink);
}
.slot__probe {
  color: var(--text-faint);
}
.slot__value {
  text-align: end;
}
.slot[data-alive='true'] .slot__value {
  color: var(--tone-ok-strong);
}
.slot[data-alive='false'] .slot__value {
  color: var(--tone-err-strong);
}

.trap {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 13px 15px;
  border-radius: var(--r2);
  background: var(--tone-err-bg);
}
.trap__value {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--tone-err-strong);
}
.trap__note {
  font-size: var(--fs-4);
  line-height: 1.5;
  color: var(--tone-err-text);
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
.verdict[data-tone='err'] {
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}

.code {
  font-size: var(--fs-2);
  line-height: 1.7;
}

.journal {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.events {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 11px 13px;
  border-radius: var(--r2);
  background: var(--ink);
  list-style: none;
}
.event {
  display: flex;
  gap: 10px;
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.5;
}
.event__at {
  color: var(--ink-faint);
}
.event[data-tone='info'] .event__text {
  color: var(--ink-secondary);
}
.event[data-tone='ok'] .event__text {
  color: var(--tone-ok-on-ink);
}
.event[data-tone='err'] .event__text {
  color: var(--tone-warn-on-ink);
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
