<script setup lang="ts">
/**
 * «Мини-v-model на живом поле»: настоящее `<input>`, связанное с моделью строкой `MODEL_CODE`
 * из темы (`bindModel`, собрана `new Function` в `model/run.ts`). Тот же код тест сверяет
 * с директивами Vue 3.5 в happy-dom.
 *
 * Компонент изображает только реактивность: модель — переменная с сеттером, «рендер» —
 * вызов `update()`, который `bindModel` вернул, и он случается, лишь когда значение модели
 * изменилось (`Object.is`) — так делает и Vue. Запись в `el.value` считается обёрткой над
 * свойством самого поля, чтобы было видно, когда код трогает DOM.
 *
 * Кнопка IME шлёт полю те же события, что Chromium при наборе «にほん» → «日本»
 * (`IME_TRACE` темы). Символы при этом вставляет сам компонент: событие из кода текста
 * не печатает.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { loadModel } from '../model/run';
import type { ModelMods } from '../model/types';

const props = defineProps<{
  modelCode: string;
  setters: { id: string; label: string; initial: string }[];
  ime: { steps: string[]; commit: string };
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const bindModel = loadModel(props.modelCode);

const MODS = [
  { value: 'none', label: 'без модификатора' },
  { value: 'lazy', label: '.lazy' },
  { value: 'trim', label: '.trim' },
  { value: 'number', label: '.number' },
];
const mod = ref('none');
const setter = ref(props.setters[0].id);
const setterOptions = props.setters.map((s) => ({ value: s.id, label: s.label }));

const TRANSFORM: Record<string, (v: unknown) => unknown> = {
  none: (v) => v,
  upper: (v) => String(v).toUpperCase(),
  digits: (v) => String(v).replace(/\D/g, ''),
};

const field = ref<HTMLInputElement | null>(null);
const shown = ref<unknown>('');
const domValue = ref('');
const sets = ref(0);
const renders = ref(0);
const writes = ref(0);
const log = ref<{ id: number; kind: 'event' | 'model' | 'dom'; text: string }[]>([]);
let seq = 0;
let stop: (() => void) | null = null;

function push(kind: 'event' | 'model' | 'dom', text: string) {
  log.value = [...log.value, { id: ++seq, kind, text }].slice(-12);
}

const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!;
const q = (v: unknown) => JSON.stringify(v);

function bind() {
  stop?.();
  const el = field.value;
  if (!el) return;
  const s = props.setters.find((x) => x.id === setter.value) ?? props.setters[0];
  const transform = TRANSFORM[s.id] ?? TRANSFORM.none;
  let raw: unknown = s.initial;
  let counting = false;

  // Запись в el.value из кода — через обёртку на самом поле, чтобы её увидеть.
  Object.defineProperty(el, 'value', {
    configurable: true,
    get() {
      return proto.get!.call(this);
    },
    set(v: unknown) {
      proto.set!.call(this, v);
      if (!counting) return;
      writes.value++;
      push('dom', `update() записал ${q(String(v))} в el.value`);
    },
  });

  const onEvent = (e: Event) => {
    const ie = e as InputEvent;
    const composing = 'isComposing' in ie && ie.isComposing ? ', isComposing' : '';
    push('event', `${e.type}${composing} — в поле ${q(proto.get!.call(el))}`);
    queueMicrotask(() => (domValue.value = proto.get!.call(el)));
  };
  const types = ['compositionstart', 'compositionend', 'input', 'change'];
  for (const type of types) el.addEventListener(type, onEvent);

  const mods: ModelMods = { lazy: mod.value === 'lazy', trim: mod.value === 'trim', number: mod.value === 'number' };
  let update: () => void = () => {};
  update = bindModel(el, {
    get: () => raw,
    set(v) {
      sets.value++;
      const next = transform(v);
      if (Object.is(next, raw)) {
        push('model', `model.set(${q(v)}) — значение то же, рендера нет`);
        return;
      }
      raw = next;
      shown.value = raw;
      push('model', `model.set(${q(v)}) → ${q(raw)}`);
      // Рендер Vue — в микрозадаче после обработчика; там же директива зовёт update.
      queueMicrotask(() => {
        renders.value++;
        update();
        domValue.value = proto.get!.call(el);
      });
    },
  }, mods);

  shown.value = raw;
  domValue.value = proto.get!.call(el);
  sets.value = 0;
  renders.value = 0;
  writes.value = 0;
  log.value = [];
  counting = true;
  stop = () => {
    for (const type of types) el.removeEventListener(type, onEvent);
  };
}

const fieldKey = ref(0);
/** Новое поле на каждую смену режима: слушатели старой привязки уходят вместе с ним. */
function rebuild() {
  fieldKey.value++;
  nextTick(bind);
}
watch([mod, setter], rebuild);
onMounted(bind);
onBeforeUnmount(() => stop?.());

/** Набор через IME: события Chromium из темы; текст вставляет сам компонент. */
async function typeIme() {
  const el = field.value;
  if (!el) return;
  el.focus();
  const base = proto.get!.call(el);
  el.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }));
  for (const text of [...props.ime.steps, props.ime.commit]) {
    el.dispatchEvent(new CompositionEvent('compositionupdate', { data: text }));
    proto.set!.call(el, base + text);
    el.dispatchEvent(new InputEvent('input', { data: text, inputType: 'insertCompositionText', isComposing: true }));
    await new Promise((r) => setTimeout(r, 120));
  }
  el.dispatchEvent(new CompositionEvent('compositionend', { data: props.ime.commit }));
}

const modelText = computed(() => `${q(shown.value)} · ${typeof shown.value}`);
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="vm-tools">
        <SegmentedControl v-model="mod" class="l-pills" label="Модификатор" :options="MODS" />
        <SegmentedControl v-model="setter" class="l-pills" label="Сеттер модели" :options="setterOptions" />
      </div>
    </template>

    <div class="vm-body">
      <div class="vm-row">
        <label class="vm-field">
          <span class="vm-label">поле</span>
          <input :key="fieldKey" ref="field" class="vm-input" type="text" spellcheck="false" autocomplete="off" />
        </label>
        <button type="button" class="vm-btn" @click="typeIme">Набрать «{{ ime.commit }}» как IME</button>
        <button type="button" class="vm-btn" @click="rebuild">Сначала</button>
      </div>

      <div class="vm-stats">
        <div class="vm-stat">
          <span class="vm-label">в DOM</span>
          <code>{{ JSON.stringify(domValue) }}</code>
        </div>
        <div class="vm-stat">
          <span class="vm-label">в модели</span>
          <code>{{ modelText }}</code>
        </div>
        <div class="vm-stat">
          <span class="vm-label">model.set</span>
          <code>{{ sets }}</code>
        </div>
        <div class="vm-stat">
          <span class="vm-label">рендеров</span>
          <code>{{ renders }}</code>
        </div>
        <div class="vm-stat">
          <span class="vm-label">записей в el.value</span>
          <code>{{ writes }}</code>
        </div>
      </div>

      <ol class="vm-log" aria-live="polite">
        <li v-if="!log.length" class="vm-log__empty">Напечатайте что-нибудь в поле.</li>
        <li v-for="entry in log" :key="entry.id" class="vm-log__line" :data-kind="entry.kind">{{ entry.text }}</li>
      </ol>

      <div class="vm-caption"><Md :text="caption" /></div>
    </div>
  </DemoFrame>
</template>

<style scoped>
.vm-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 18px;
}
.vm-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.vm-row {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 10px;
}
.vm-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1 1 220px;
  min-width: 0;
}
.vm-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.vm-input {
  font: inherit;
  color: inherit;
  box-sizing: border-box;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--border-strong);
  border-radius: var(--r1);
  background: var(--surface);
  font-family: var(--mono);
  font-size: var(--fs-4);
}
.vm-btn {
  font: inherit;
  color: var(--chip-text);
  padding: 8px 12px;
  border: 1px solid var(--border-strong);
  border-radius: var(--r1);
  background: var(--surface);
  font-family: var(--mono);
  font-size: var(--fs-3);
  cursor: pointer;
}
.vm-btn:hover,
.vm-btn:focus-visible {
  background: var(--surface-2);
}

.vm-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 8px;
}
.vm-stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 8px 10px;
  border-radius: var(--r2);
  background: var(--surface-2);
}
.vm-stat code {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
  overflow-wrap: anywhere;
}

.vm-log {
  margin: 0;
  padding: 12px 14px;
  list-style: none;
  border-radius: var(--r3);
  background: var(--ink-deep);
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.7;
  color: var(--code-fg);
  min-height: 7em;
}
.vm-log__line {
  overflow-wrap: anywhere;
}
.vm-log__line[data-kind='event'] {
  color: var(--ink-faint);
}
.vm-log__line[data-kind='dom'] {
  color: var(--tone-warn-on-ink);
}
.vm-log__empty {
  color: var(--ink-faint);
}
.vm-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.vm-caption :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
</style>
