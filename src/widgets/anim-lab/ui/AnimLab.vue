<script setup lang="ts">
/**
 * «Кадр анимации»: что одна анимация требует на каждый кадр и переживёт ли она занятый поток.
 *
 * Шаги кадра считает не компонент, а строка `FRAME_PLAN_CODE` из темы, собранная `new Function`
 * (`model/run.ts`). Рядом — литерал стенда: счётчики Chromium на том же сценарии. Совпадение
 * модели и замера проверяет та же функция `agrees`, что и `tests/unit/animations.test.ts`.
 *
 * Живой блок запускается только по кнопке и только без `prefers-reduced-motion: reduce`:
 * `element.animate` и `requestAnimationFrame` глобальное правило `.001ms` не гасит
 * (это и есть одно из утверждений темы), так что уважать настройку приходится здесь.
 * Цвета ключевых кадров берутся из токенов темы в момент запуска.
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button, SegmentedControl } from '@/shared/ui';
import { useReducedMotion } from '@/shared/lib/useReducedMotion';
import { agrees, loadPlan, standStages } from '../model/run';
import type { AnimCase } from '../model/types';

const props = defineProps<{
  planCode: string;
  cases: AnimCase[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
  /** Подпись при `prefers-reduced-motion: reduce`. */
  reducedNote: string;
}>();

const api = loadPlan(props.planCode);
const reduced = useReducedMotion();

const picked = ref(props.cases[0].id);
const options = props.cases.map((c) => ({ value: c.id, label: c.label }));
const current = computed(() => props.cases.find((c) => c.id === picked.value) ?? props.cases[0]);

const plan = computed(() => api.framePlan(current.value.animations));
const stand = computed(() => standStages(current.value));
const same = computed(() => agrees(plan.value, current.value));

const STAGES = [
  { key: 'style', label: 'style' },
  { key: 'layout', label: 'layout' },
  { key: 'paint', label: 'paint' },
  { key: 'composite', label: 'composite' },
] as const;

const stageRows = computed(() =>
  STAGES.map((s) => {
    if (s.key === 'composite') {
      return { ...s, tone: 'ok', text: 'композитор, каждый кадр' };
    }
    const on = plan.value[s.key];
    return { ...s, tone: on ? (s.key === 'style' ? 'warn' : 'err') : 'off', text: on ? 'главный поток, каждый кадр' : 'не нужен' };
  }),
);

const threadRows = computed(() =>
  plan.value.plans.map((p, i) => ({
    key: i,
    props: p.props.join(', ') || '—',
    onCompositor: p.thread === 'compositor',
    blockers: p.blockers.join(', '),
  })),
);

const failText = computed(() => {
  const c = current.value.chromium;
  if (!c.compositeFailed) return current.value.animations[0].by === 'raf' ? 'анимации нет — есть запись стиля' : 'нет отказа';
  return `${c.compositeFailed}: ${c.unsupported.join(', ') || 'фильтр двигает пиксели'}`;
});

// ── Живой блок ──────────────────────────────────────────────────────────────────────────────

const track = ref<HTMLElement | null>(null);
const box = ref<HTMLElement | null>(null);
const running = ref(false);
const blocking = ref(false);
let anims: Animation[] = [];
let rafId = 0;

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Ключевые кадры для живого блока: цвета — токенами темы, сдвиг — по ширине дорожки. */
function liveValue(prop: string, value: string, travel: number): string {
  const colored = value.replace(/\bred\b/g, token('--tone-err-strong')).replace(/\bblue\b/g, token('--tone-info-strong'));
  if (prop === 'transform' || prop === 'left') return colored.replace(/300px/, `${travel}px`);
  // Блок в демо меньше стендового: обрезаем до трети, а не целиком.
  if (prop === 'clip-path') return colored.replace(/30px/, '18px');
  return colored;
}

function stop() {
  for (const a of anims) a.cancel();
  anims = [];
  cancelAnimationFrame(rafId);
  if (box.value) box.value.removeAttribute('style');
  running.value = false;
}

function start() {
  if (reduced.value || !box.value || !track.value) return;
  stop();
  const el = box.value;
  const travel = Math.max(0, track.value.clientWidth - el.offsetWidth - 16);
  for (const spec of current.value.animations) {
    if (spec.by === 'raf') {
      const t0 = performance.now();
      const step = (t: number) => {
        const p = ((t - t0) % 2000) / 1000;
        el.style.transform = `translateX(${(p <= 1 ? p : 2 - p) * travel}px)`;
        rafId = requestAnimationFrame(step);
      };
      rafId = requestAnimationFrame(step);
      continue;
    }
    const from: Record<string, string> = {};
    const to: Record<string, string> = {};
    for (const [prop, [a, b]] of Object.entries(spec.keyframes)) {
      const key = prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
      from[key] = liveValue(prop, a, travel);
      to[key] = liveValue(prop, b, travel);
    }
    anims.push(el.animate([from, to], { duration: 1000, iterations: Infinity, direction: 'alternate', easing: 'linear' }));
  }
  running.value = true;
}

/** Цикл на секунду в этой вкладке — тот же опыт, что на стенде. */
function block() {
  blocking.value = true;
  // Кадр — чтобы кнопка успела показать «поток занят», потом цикл.
  requestAnimationFrame(() =>
    setTimeout(() => {
      const t = performance.now();
      while (performance.now() - t < 1000) {
        /* главный поток занят */
      }
      blocking.value = false;
    }, 0),
  );
}

watch(picked, () => {
  if (running.value) start();
});
watch(reduced, (r) => {
  if (r) stop();
});
onBeforeUnmount(stop);
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="picked" class="l-pills" label="Что анимируем" :options="options" />
    </template>

    <div class="al-body">
      <Md class="al-note" :text="current.note" />

      <div class="al-split">
        <div class="al-pane">
          <span class="al-label">код</span>
          <pre class="al-code">{{ current.code }}</pre>
        </div>

        <div class="al-pane">
          <span class="al-label">framePlan: шаги на каждый кадр</span>
          <div class="al-stages">
            <div v-for="s in stageRows" :key="s.key" class="al-stage" :data-tone="s.tone">
              <code>{{ s.label }}</code>
              <span>{{ s.text }}</span>
            </div>
          </div>
          <div v-for="t in threadRows" :key="t.key" class="al-thread" :data-on="t.onCompositor ? 'yes' : 'no'">
            <code>{{ t.props }}</code>{{ ' ' }}
            <span v-if="t.onCompositor">на композиторе</span>
            <span v-else>на главном потоке — из-за <code>{{ t.blockers }}</code></span>
          </div>
        </div>
      </div>

      <div class="al-pane">
        <span class="al-label">Chromium 153: за 1 с анимации</span>
        <div class="al-facts">
          <div class="al-fact">
            <span>пересчётов стиля</span><b>{{ current.chromium.style }}</b>
          </div>
          <div class="al-fact">
            <span>раскладок</span><b>{{ current.chromium.layout }}</b>
          </div>
          <div class="al-fact">
            <span>событий Paint</span><b>{{ current.chromium.paint }}</b>
          </div>
          <div class="al-fact">
            <span>отказ композитора</span><b>{{ failText }}</b>
          </div>
          <div class="al-fact" :data-tone="current.movedWhileBlocked ? 'ok' : 'err'">
            <span>поток занят на 1 с</span><b>{{ current.movedWhileBlocked ? 'двигался' : 'стоял' }}</b>
          </div>
        </div>
        <span class="al-verdict" :data-tone="same ? 'ok' : 'err'">
          {{ same ? 'framePlan совпал с Chromium' : 'framePlan разошёлся с Chromium' }}:
          style {{ stand.style ? 'да' : 'нет' }}, layout {{ stand.layout ? 'да' : 'нет' }}, paint {{ stand.paint ? 'да' : 'нет' }}
        </span>
      </div>

      <div class="al-pane">
        <span class="al-label">в вашем браузере</span>
        <div ref="track" class="al-track">
          <div ref="box" class="al-box">Aa</div>
        </div>
        <div class="al-actions">
          <Button variant="primary" :disabled="reduced" @click="running ? stop() : start()">
            {{ running ? 'остановить' : 'запустить' }}
          </Button>
          <Button variant="secondary" :disabled="reduced || !running || blocking" @click="block">
            {{ blocking ? 'поток занят…' : 'занять поток на 1 с' }}
          </Button>
        </div>
        <Md v-if="reduced" class="al-note" :text="reducedNote" />
      </div>

      <Md class="al-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.al-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.al-note,
.al-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.al-note :deep(code),
.al-caption :deep(code),
.al-thread code,
.al-stage code {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
.al-split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 760px) {
  .al-split {
    grid-template-columns: minmax(0, 1fr);
  }
}
.al-pane {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.al-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.al-code {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.7;
  color: var(--code-fg);
  white-space: pre;
  max-width: 100%;
  min-width: 0;
  overflow-x: auto;
}
.al-stages {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.al-stage {
  display: grid;
  grid-template-columns: 6.5em minmax(0, 1fr);
  gap: 8px;
  align-items: baseline;
  padding: 6px 10px;
  border-radius: var(--r2);
  border-left: 3px solid var(--border);
  background: var(--surface);
  font-size: var(--fs-3);
  color: var(--prose);
}
.al-stage[data-tone='ok'] {
  border-left-color: var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.al-stage[data-tone='warn'] {
  border-left-color: var(--tone-warn-line);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.al-stage[data-tone='err'] {
  border-left-color: var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}
.al-stage[data-tone='off'] {
  color: var(--text-muted);
}
.al-thread {
  padding: 6px 10px;
  border-radius: var(--r2);
  font-size: var(--fs-3);
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.al-thread[data-on='yes'] {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.al-thread[data-on='no'] {
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}
.al-facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 8px;
}
.al-fact {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border-radius: var(--r2);
  background: var(--surface);
  font-size: var(--fs-2);
  color: var(--text-muted);
  overflow-wrap: anywhere;
}
.al-fact b {
  font-family: var(--mono);
  font-size: var(--fs-4);
  font-weight: 600;
  color: var(--ink);
}
.al-fact[data-tone='ok'] {
  background: var(--tone-ok-bg);
}
.al-fact[data-tone='ok'] b {
  color: var(--tone-ok-text);
}
.al-fact[data-tone='err'] {
  background: var(--tone-err-bg);
}
.al-fact[data-tone='err'] b {
  color: var(--tone-err-text);
}
.al-verdict {
  font-size: var(--fs-3);
  line-height: 1.5;
}
.al-verdict[data-tone='ok'] {
  color: var(--tone-ok-text);
}
.al-verdict[data-tone='err'] {
  color: var(--tone-err-text);
}
.al-track {
  position: relative;
  overflow: hidden;
  padding: 16px 8px;
  border-radius: var(--r2);
  background: var(--surface);
}
.al-box {
  position: relative;
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  border-radius: var(--r2);
  background: var(--tone-info-strong);
  color: var(--on-ink);
  font-family: var(--mono);
  font-size: var(--fs-4);
}
.al-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
