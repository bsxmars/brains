<script setup lang="ts">
/**
 * Калькулятор политики изоляции ресурсов: заголовки запроса → решение сервера.
 *
 * Решает **не** таблица и не копия логики в компоненте, а та самая строка кода, которую
 * тема печатает над демо: она приходит пропом `code` и компилируется `compilePolicy`.
 * Тот же модуль и та же строка исполняются в `tests/unit/xs-leaks.test.ts`, так что демо,
 * текст и тест не могут разойтись молча.
 *
 * Наборы-пресеты — не выдумка, а заголовки, которые Chromium 153 прислал на стенде темы.
 * Ручные переключатели дают собрать и то, чего браузер не пришлёт никогда (например,
 * `navigate` с `image`), — политика отвечает и на это, как ответил бы сервер.
 *
 * Компиляция — в `onMounted`: до гидратации остров показывает, что решать пока нечем,
 * а не выдуманный ответ. Ничего не отправляется в сеть.
 */
import { computed, onMounted, ref, shallowRef } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { buildRequest, compilePolicy } from '../model/policy';
import type { FetchSite, Policy } from '../model/policy';

interface Preset {
  label: string;
  site: FetchSite | undefined;
  mode: string;
  dest: string;
  method: string;
  path: string;
}

const props = defineProps<{
  code: string;
  presets: Preset[];
  /** Подпись ветки политики по её `rule`. */
  ruleNotes: Record<string, string>;
}>();

const ABSENT = 'absent';

const SITES = [
  { value: 'cross-site', label: 'cross-site' },
  { value: 'same-site', label: 'same-site' },
  { value: 'same-origin', label: 'same-origin' },
  { value: 'none', label: 'none' },
  { value: ABSENT, label: 'нет заголовков' },
];
const MODES = [
  { value: 'navigate', label: 'navigate' },
  { value: 'no-cors', label: 'no-cors' },
  { value: 'cors', label: 'cors' },
];
const DESTS = [
  { value: 'document', label: 'document' },
  { value: 'iframe', label: 'iframe' },
  { value: 'image', label: 'image' },
  { value: 'script', label: 'script' },
  { value: 'empty', label: 'empty' },
  { value: 'object', label: 'object' },
];
const METHODS = [
  { value: 'GET', label: 'GET' },
  { value: 'POST', label: 'POST' },
];
/** Адреса — из тех же наборов: отдельного списка, который мог бы разойтись с ними, нет. */
const PATHS = [...new Set(props.presets.map((p) => p.path))].map((value) => ({ value, label: value }));

const site = ref<string>('cross-site');
const mode = ref('no-cors');
const dest = ref('image');
const method = ref('GET');
const path = ref('/avatar.png');
const active = ref<number | null>(null);

const policy = shallowRef<Policy | null>(null);
const failure = ref('');

onMounted(() => {
  try {
    policy.value = compilePolicy(props.code);
  } catch (error) {
    failure.value = error instanceof Error ? error.message : String(error);
  }
});

function applyPreset(i: number) {
  const p = props.presets[i];
  site.value = p.site ?? ABSENT;
  mode.value = p.mode;
  dest.value = p.dest;
  method.value = p.method;
  path.value = p.path;
  active.value = i;
}

const request = computed(() =>
  buildRequest(
    site.value === ABSENT ? undefined : (site.value as FetchSite),
    mode.value,
    dest.value,
    method.value,
    path.value,
  ),
);

const decision = computed(() => (policy.value ? policy.value(request.value) : null));

/** Запрос так, как его увидит сервер. */
const wire = computed(() => {
  const lines = [`${method.value} ${path.value} HTTP/1.1`, 'Host: a.test', 'Cookie: session=…'];
  for (const [name, value] of Object.entries(request.value.headers)) {
    if (value !== undefined) lines.push(`${name.replace(/(^|-)([a-z])/g, (_, d: string, c: string) => d + c.toUpperCase())}: ${value}`);
  }
  return lines.join('\n');
});

function touch() {
  active.value = null;
}
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="fmp-controls">
        <div class="fmp-control">
          <span class="t-label">Sec-Fetch-Site</span>
          <SegmentedControl v-model="site" class="l-pills" label="Sec-Fetch-Site" :options="SITES" @update:model-value="touch" />
        </div>
        <div class="fmp-control">
          <span class="t-label">Sec-Fetch-Mode</span>
          <SegmentedControl v-model="mode" class="l-pills" label="Sec-Fetch-Mode" :options="MODES" @update:model-value="touch" />
        </div>
        <div class="fmp-control">
          <span class="t-label">Sec-Fetch-Dest</span>
          <SegmentedControl v-model="dest" class="l-pills" label="Sec-Fetch-Dest" :options="DESTS" @update:model-value="touch" />
        </div>
        <div class="fmp-control fmp-control--row">
          <div class="fmp-control">
            <span class="t-label">метод</span>
            <SegmentedControl v-model="method" class="l-pills" label="Метод запроса" :options="METHODS" @update:model-value="touch" />
          </div>
          <div class="fmp-control">
            <span class="t-label">адрес</span>
            <SegmentedControl v-model="path" class="l-pills" label="Адрес запроса" :options="PATHS" @update:model-value="touch" />
          </div>
        </div>
      </div>
    </template>

    <div class="fmp-body">
      <div class="fmp-block">
        <span class="t-label">что прислал Chromium 153 на стенде — нажмите, чтобы подставить</span>
        <div class="fmp-presets">
          <button
            v-for="(preset, i) in presets"
            :key="preset.label"
            type="button"
            class="fmp-preset"
            :aria-pressed="active === i"
            @click="applyPreset(i)"
          >
            <Md as="span" :text="preset.label" />
          </button>
        </div>
      </div>

      <div class="fmp-split">
        <pre class="fmp-wire" data-code>{{ wire }}</pre>

        <div v-if="failure" class="fmp-verdict" data-tone="warn">
          <span class="fmp-verdict__head">Код политики не собрался</span>
          <span class="fmp-verdict__sub">{{ failure }}</span>
        </div>
        <div v-else-if="!decision" class="fmp-verdict" data-tone="idle">
          <span class="fmp-verdict__head">Политика ещё не загружена</span>
          <span class="fmp-verdict__sub">Решение появится, когда демо оживёт: считает код выше, а не заготовка.</span>
        </div>
        <div v-else class="fmp-verdict" :data-tone="decision.allow ? 'ok' : 'err'">
          <span class="fmp-verdict__head">{{ decision.allow ? 'Сервер отвечает как обычно' : 'Сервер отвечает 403' }}</span>
          <Md class="fmp-verdict__sub" :text="ruleNotes[decision.rule] ?? decision.rule" />
          <span class="fmp-verdict__rule" data-code>rule: '{{ decision.rule }}'</span>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="fmp-note">
        Решение принимает функция <code>isolationPolicy</code> из кода над демо — та же строка
        исполняется тестом темы и стояла перед сервером стенда. В сеть демо не ходит: запрос
        собран здесь и передан функции как объект.
      </div>
    </template>
  </DemoFrame>
</template>

<style scoped>
.fmp-controls {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.fmp-control {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.fmp-control--row {
  flex-direction: row;
  flex-wrap: wrap;
  gap: 12px 20px;
}

.fmp-body {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 22px 20px;
}
.fmp-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.fmp-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.fmp-preset {
  font: inherit;
  font-size: var(--fs-3);
  line-height: 1.4;
  color: var(--prose);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--r1);
  padding: 6px 10px;
  cursor: pointer;
  text-align: start;
}
.fmp-preset:hover {
  border-color: var(--tone-info-line);
}
.fmp-preset[aria-pressed='true'] {
  border-color: var(--tone-info-line);
  background: var(--tone-info-bg);
  color: var(--ink);
}

.fmp-split {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr));
  gap: 14px;
  align-items: stretch;
}

.fmp-wire {
  margin: 0;
  padding: 14px 16px;
  border-radius: var(--r2);
  background: var(--ink);
  color: var(--code-fg);
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.7;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  min-width: 0;
}

.fmp-verdict {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px 18px;
  border-radius: var(--r2);
  border: 1px solid var(--border);
  background: var(--surface-2);
  min-width: 0;
}
.fmp-verdict[data-tone='ok'] {
  border-color: var(--tone-ok-line);
  background: var(--tone-ok-bg);
}
.fmp-verdict[data-tone='err'] {
  border-color: var(--tone-err-line);
  background: var(--tone-err-bg);
}
.fmp-verdict[data-tone='warn'] {
  border-color: var(--tone-warn-line);
  background: var(--tone-warn-bg);
}
.fmp-verdict__head {
  font-size: var(--fs-6);
  font-weight: 600;
  color: var(--ink);
}
.fmp-verdict[data-tone='ok'] .fmp-verdict__head {
  color: var(--tone-ok-strong);
}
.fmp-verdict[data-tone='err'] .fmp-verdict__head {
  color: var(--tone-err-strong);
}
.fmp-verdict__sub {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--prose);
}
.fmp-verdict__rule {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}

.fmp-note {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}

/* Код внутри мелкой подписи: базовое `code { font-size: .86em }` уводило его ниже 11px.
   Пол — ступень `--fs-2`. */
.fmp-preset :deep(code) {
  font-size: max(0.86em, var(--fs-2));
}
</style>
