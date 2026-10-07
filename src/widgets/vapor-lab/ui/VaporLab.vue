<script setup lang="ts">
/**
 * Один компонент `Cart` дважды: слева — вывод VDOM-компилятора на Vue 3.5 сайта, справа —
 * тот же шаблон, скомпилированный мини-vapor из темы. Кнопка применяет одно действие к обеим
 * сторонам, щуп `DomProbe` считает DOM-операции одинаково с обеих, узлы, которых коснулись,
 * подсвечиваются.
 *
 * Логика — в `model/lab.ts`; тот же модуль тест гоняет в happy-dom и сверяет мини-vapor
 * с настоящим Vapor 3.6.0-rc.9. Vue 3.6 в браузер не грузится.
 *
 * ⚠️ Обе стороны монтируются в `onMounted`, не в `setup`: `setup` острова исполняется и на
 * сборке страницы, а там нет DOM. Стороны лежат в обычных переменных, а не в `ref`: внутри
 * них живые приложения и DOM-узлы, реактивными им быть незачем — на экран идут числа.
 */
import * as Vue from 'vue';
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import ConsoleView from '@/shared/ui/ConsoleView.vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button } from '@/shared/ui';
import { loadMiniVapor, MiniSide, VdomSide, type VueLike } from '../model/lab';
import type { DomOp, Scenario, VaporStep, VdomStep } from '../model/types';

const props = defineProps<{
  vdomCode: string;
  template: string;
  initial: Record<'title' | 'count' | 'items', unknown>;
  miniCode: string;
  scenarios: Scenario[];
  note: string;
}>();

const vdomEl = ref<HTMLElement | null>(null);
const miniEl = ref<HTMLElement | null>(null);

let vdom: VdomSide | null = null;
let mini: MiniSide | null = null;

const ready = ref(false);
const busy = ref(false);
const last = shallowRef<{ label: string; vdom: VdomStep; vapor: VaporStep } | null>(null);
const total = shallowRef({ render: 0, vnodes: 0, vdomOps: 0, effects: 0, vaporOps: 0 });
const vdomLog = shallowRef<string[]>([]);
const miniLog = shallowRef<string[]>([]);

const HIT = 'data-vl-hit';

function clearHits() {
  for (const el of [vdomEl.value, miniEl.value]) el?.querySelectorAll(`[${HIT}]`).forEach((n) => n.removeAttribute(HIT));
}

/** Подсветить тронутые узлы: у текстового узла — его элемент. Снятые узлы уже не в DOM. */
function markHits(root: HTMLElement | null, ops: DomOp[]) {
  for (const op of ops) {
    const el = op.node.nodeType === 1 ? (op.node as Element) : op.node.parentElement;
    if (el && root?.contains(el) && el !== root) el.setAttribute(HIT, op.kind);
  }
}

function describe(op: DomOp): string {
  const n = op.node;
  const name = n.nodeType === 3 ? (n.parentElement ? `текст в <${n.parentElement.tagName.toLowerCase()}>` : 'текстовый узел')
    : n.nodeType === 8 ? 'комментарий' : `<${(n as Element).tagName.toLowerCase()}>`;
  return `${op.kind.padEnd(6)} ${name}${op.api ? ` · ${op.api}` : ''}`;
}

function mount() {
  if (!vdomEl.value || !miniEl.value) return;
  vdom?.destroy();
  mini?.destroy();
  vdomEl.value.textContent = '';
  miniEl.value.textContent = '';
  vdom = new VdomSide(Vue as unknown as VueLike, props.vdomCode, vdomEl.value);
  mini = new MiniSide(loadMiniVapor(props.miniCode), props.template, props.initial, miniEl.value);
  last.value = null;
  total.value = { render: 0, vnodes: 0, vdomOps: 0, effects: 0, vaporOps: 0 };
  vdomLog.value = [];
  miniLog.value = [];
  ready.value = true;
}

async function apply(s: Scenario) {
  if (!vdom || !mini || busy.value) return;
  busy.value = true;
  try {
    clearHits();
    const a = await vdom.run(s);
    const b = await mini.run(s);
    markHits(vdomEl.value, a.ops);
    markHits(miniEl.value, b.ops);
    last.value = { label: s.code, vdom: a.step, vapor: b.step };
    const t = total.value;
    total.value = {
      render: t.render + a.step.render,
      vnodes: t.vnodes + a.step.vnodes,
      vdomOps: t.vdomOps + a.step.ops,
      effects: t.effects + b.step.effects,
      vaporOps: t.vaporOps + b.step.ops,
    };
    vdomLog.value = a.ops.map(describe);
    miniLog.value = b.ops.map(describe);
  } finally {
    busy.value = false;
  }
}

/**
 * Кнопка «+1» внутри корзины. Своим обработчиком она изменила бы одну сторону в обход щупа,
 * а выключенная выглядела мёртвой — читатель жал и ничего не получал. Поэтому щелчок
 * перехватывается на фазе погружения, до обработчика самой кнопки, и превращается в то же
 * действие `count++`, что и кнопка панели, — для обеих сторон сразу.
 */
function onStageClick(e: MouseEvent) {
  if (!(e.target as Element | null)?.closest('button')) return;
  e.stopPropagation();
  e.preventDefault();
  const inc = props.scenarios.find((s) => s.id === 'inc');
  if (inc) void apply(inc);
}

onMounted(mount);
onBeforeUnmount(() => {
  vdom?.destroy();
  mini?.destroy();
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="vl-actions">
        <Button
          v-for="s in scenarios"
          :key="s.id"
          variant="secondary"
          :disabled="!ready || busy"
          @click="apply(s)"
        >
          {{ s.label }}
        </Button>
        <Button variant="primary" :disabled="!ready || busy" @click="mount">сброс</Button>
      </div>
    </template>

    <div class="vl-split">
      <div class="vl-pane">
        <span class="t-label">VDOM · Vue 3.5 сайта</span>
        <div ref="vdomEl" class="vl-stage" @click.capture="onStageClick" />
        <div class="vl-counts">
          <span>render: <b>{{ last?.vdom.render ?? '—' }}</b></span>
          <span>VNode: <b>{{ last?.vdom.vnodes ?? '—' }}</b></span>
          <span>DOM: <b>{{ last?.vdom.ops ?? '—' }}</b></span>
        </div>
        <div class="vl-total">всего: render {{ total.render }} · VNode {{ total.vnodes }} · DOM {{ total.vdomOps }}</div>
        <ConsoleView :lines="vdomLog" label="DOM-операции последнего действия" :min-height="60" empty-label="—" />
      </div>

      <div class="vl-pane">
        <span class="t-label">мини-vapor из темы</span>
        <div ref="miniEl" class="vl-stage" @click.capture="onStageClick" />
        <div class="vl-counts">
          <span>эффекты: <b>{{ last?.vapor.effects ?? '—' }}</b></span>
          <span>DOM: <b>{{ last?.vapor.ops ?? '—' }}</b></span>
        </div>
        <div class="vl-total">всего: эффекты {{ total.effects }} · DOM {{ total.vaporOps }}</div>
        <ConsoleView :lines="miniLog" label="DOM-операции последнего действия" :min-height="60" empty-label="—" />
      </div>
    </div>

    <template #footer>
      <div class="vl-foot">
        <div v-if="last" class="vl-last">последнее действие: <code>{{ last.label }}</code></div>
        <Md class="vl-note" :text="note" />
      </div>
    </template>
  </DemoFrame>
</template>

<style scoped>
.vl-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.vl-split {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr));
  gap: 20px;
  padding: 20px;
}
.vl-pane {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

/* Сцена: разметка внутри создана чужим приложением, поэтому стили — через :deep */
.vl-stage {
  min-height: 150px;
  padding: 12px 14px;
  border-radius: var(--r2);
  background: var(--surface-2);
  color: var(--text);
  font-family: var(--font);
  font-size: var(--fs-4);
  line-height: 1.5;
}
.vl-stage :deep(h2) {
  margin: 0 0 4px;
  font-size: var(--fs-6);
  font-weight: 600;
  color: var(--ink);
}
.vl-stage :deep(p) {
  margin: 0 0 4px;
  color: var(--prose);
}
.vl-stage :deep(p.empty) {
  color: var(--text-faint);
}
.vl-stage :deep(ul) {
  margin: 0 0 6px;
  padding-left: 18px;
}
.vl-stage :deep(button) {
  font: inherit;
  font-size: var(--fs-3);
  color: var(--text-muted);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r1);
  padding: 1px 8px;
  /* щелчок перехватывает onStageClick и применяет count++ к обеим сторонам */
  cursor: pointer;
}
.vl-stage :deep([data-vl-hit]) {
  border-radius: 4px;
  box-shadow: 0 0 0 2px var(--tone-warn-strong);
  background: var(--tone-warn-bg);
  transition: box-shadow 0.3s;
}
.vl-stage :deep([data-vl-hit='create']),
.vl-stage :deep([data-vl-hit='insert']) {
  box-shadow: 0 0 0 2px var(--tone-ok-strong);
  background: var(--tone-ok-bg);
}
.vl-counts {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-muted);
}
.vl-counts b {
  color: var(--ink);
  font-size: var(--fs-5);
}
.vl-total {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-faint);
}
.vl-foot {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.vl-last {
  font-size: var(--fs-3);
  color: var(--text-muted);
  overflow-wrap: anywhere;
}
.vl-last code {
  font-family: var(--mono);
  color: var(--ink);
}
.vl-note {
  font-size: var(--fs-4);
  line-height: 1.55;
  color: var(--prose);
}
</style>
