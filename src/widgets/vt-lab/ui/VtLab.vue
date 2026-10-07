<script setup lang="ts">
/**
 * Настоящий `document.startViewTransition` на сцене из трёх карточек.
 *
 * Журнал и список анимаций не заготовлены: их пишет `model/run.ts` по мере того, как приходят
 * колбэк и промисы, а список — это `document.getAnimations()` в момент `ready`. Тексты ошибок
 * у каждого движка свои, и демо показывает те, что выдал браузер читателя.
 *
 * Сцена меняется через состояние Vue, поэтому колбэк перехода ждёт `nextTick()`: переход снимает
 * новое состояние тогда, когда колбэк завершился, и изменение обязано к этому моменту быть в DOM.
 *
 * При `prefers-reduced-motion: reduce` переход всё равно запускается — правило из
 * `shared/styles/motion.css` сжимает его анимации до 0.001 мс, и список это честно показывает.
 */
import { computed, nextTick, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button, SegmentedControl } from '@/shared/ui';
import { useReducedMotion } from '@/shared/lib/useReducedMotion';
import { hasApi, runScenario } from '../model/run';
import type { VtAnimRow, VtLogEntry, VtScenario, VtScenarioKey } from '../model/types';

const props = defineProps<{
  scenarios: VtScenario[];
  /** Подпись при `prefers-reduced-motion: reduce`. */
  reducedNote: string;
  /** Подпись, если API в браузере нет. */
  missingNote: string;
  /** Подвал: что делает демо и чего не делает. */
  footer: string;
}>();

const reduced = useReducedMotion();

const scenarioKey = ref<VtScenarioKey>(props.scenarios[0].key);
const scenario = computed(() => props.scenarios.find((s) => s.key === scenarioKey.value) ?? props.scenarios[0]);
const options = computed(() => props.scenarios.map((s) => ({ value: s.key, label: s.label })));

/** Сцена: порядок карточек и то, какая из них широкая. */
const order = ref(['a', 'b', 'c']);
const wide = ref('b');

const scene = ref<HTMLElement | null>(null);
const log = ref<VtLogEntry[]>([]);
const anims = ref<VtAnimRow[]>([]);
const running = ref(false);
/** Узнаётся только в браузере: на сервере острова `document` нет. */
const missing = ref(false);

async function update() {
  order.value = [...order.value.slice(1), order.value[0]];
  wide.value = order.value[1];
  await nextTick();
}

async function run() {
  if (running.value || !scene.value) return;
  running.value = true;
  log.value = [];
  anims.value = [];
  missing.value = !hasApi(document);
  const root = scene.value;
  try {
    await runScenario(
      {
        doc: document,
        cards: () => Array.from(root.querySelectorAll<HTMLElement>('[data-vt-key]')),
        update,
      },
      scenarioKey.value,
      {
        log: (entry) => log.value.push(entry),
        anims: (rows) => {
          anims.value = rows;
        },
      },
    );
  } finally {
    running.value = false;
  }
}

function ms(value: number): string {
  return value < 1 ? `${value} мс` : `${Math.round(value)} мс`;
}
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="vt-bar">
        <SegmentedControl v-model="scenarioKey" class="l-pills" label="Сценарий перехода" :options="options" />
        <Button variant="primary" :disabled="running" @click="run">запустить переход</Button>
      </div>
    </template>

    <div class="vt-body">
      <div class="vt-split">
        <div class="vt-stage">
          <div class="t-label">сцена</div>
          <div ref="scene" class="vt-scene">
            <div
              v-for="key in order"
              :key="key"
              class="vt-card"
              :data-vt-key="key"
              :data-wide="wide === key ? 'yes' : 'no'"
            >
              <span class="vt-card__key">{{ key.toUpperCase() }}</span>
              <span class="vt-card__name">vt-card-{{ key }}</span>
            </div>
          </div>
          <Md v-if="reduced" class="vt-caption" data-tone="warn" :text="reducedNote" />
          <Md v-if="missing" class="vt-caption" data-tone="err" :text="missingNote" />
        </div>

        <div class="vt-log">
          <div class="t-label">журнал — в порядке прихода</div>
          <div v-if="!log.length" class="vt-empty">переход ещё не запускали</div>
          <ol v-else class="vt-log__list">
            <li v-for="(entry, i) in log" :key="i" class="vt-log__item" :data-tone="entry.tone">
              <span class="vt-log__frame">кадр {{ entry.frame }}</span>
              <Md as="span" class="vt-log__text" :text="entry.text" />
            </li>
          </ol>
        </div>
      </div>

      <div class="vt-anims">
        <div class="t-label">document.getAnimations() в момент ready — {{ anims.length }}</div>
        <div v-if="!anims.length" class="vt-empty">
          {{ log.length ? 'пусто: псевдоэлементов перехода нет' : 'появится после запуска' }}
        </div>
        <div v-else class="vt-anims__scroll">
          <table class="vt-anims__table">
            <thead>
              <tr>
                <th>псевдоэлемент</th>
                <th>animationName</th>
                <th>длительность</th>
                <th>playState</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, i) in anims" :key="i" :data-part="row.part">
                <td>::view-transition-{{ row.part }}({{ row.name }})</td>
                <td>{{ row.animation }}</td>
                <td>{{ ms(row.duration) }}</td>
                <td>{{ row.state }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <Md class="vt-note" :data-tone="scenario.tone" :text="scenario.note" />
    </div>

    <template #footer>
      <Md class="vt-disclaimer" :text="footer" />
    </template>
  </DemoFrame>
</template>

<style scoped>
.vt-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.vt-body {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 22px 20px;
}

.vt-split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr);
  gap: 18px;
  align-items: start;
}
@media (max-width: 720px) {
  .vt-split {
    grid-template-columns: minmax(0, 1fr);
  }
}

.vt-stage,
.vt-log,
.vt-anims {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.vt-scene {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--surface-2);
}

/* Класс перехода — на самом элементе: правило длительности ниже выбирает группы по нему. */
.vt-card {
  view-transition-class: vt-card;
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 72px;
  padding: 10px 12px;
  border-radius: var(--r1);
  background: var(--tone-info-chip);
  color: var(--tone-info-text);
}
.vt-card[data-vt-key='b'] {
  background: var(--tone-warn-chip);
  color: var(--tone-warn-text);
}
.vt-card[data-vt-key='c'] {
  background: var(--tone-ok-chip);
  color: var(--tone-ok-text);
}
.vt-card[data-wide='yes'] {
  width: 150px;
}
.vt-card__key {
  font-family: var(--mono);
  font-size: var(--fs-6);
}
.vt-card__name {
  font-family: var(--mono);
  font-size: var(--fs-3);
}

.vt-caption {
  padding: 10px 12px;
  border-radius: var(--r1);
  font-size: var(--fs-4);
  line-height: 1.5;
}
.vt-caption[data-tone='warn'] {
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.vt-caption[data-tone='err'] {
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}

.vt-empty {
  font-style: italic;
  font-size: var(--fs-4);
  color: var(--dim);
}

.vt-log__list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.vt-log__item {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  gap: 10px;
  padding: 6px 10px;
  border-radius: var(--r1);
  font-size: var(--fs-4);
  line-height: 1.45;
  background: var(--surface-2);
  color: var(--prose);
}
.vt-log__item[data-tone='sync'] {
  background: var(--surface-3);
  color: var(--chip-text);
}
.vt-log__item[data-tone='call'] {
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
}
.vt-log__item[data-tone='ok'] {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.vt-log__item[data-tone='err'] {
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}
.vt-log__item[data-tone='info'] {
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.vt-log__frame {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
  padding-top: 2px;
}
.vt-log__text {
  overflow-wrap: anywhere;
}

.vt-anims__scroll {
  min-width: 0;
  overflow-x: auto;
}
.vt-anims__table {
  width: 100%;
  min-width: 560px;
  border-collapse: collapse;
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--chip-text);
}
.vt-anims__table th {
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
  font-weight: normal;
  text-align: start;
  color: var(--text-faint);
}
.vt-anims__table td {
  padding: 5px 8px;
  border-bottom: 1px solid var(--rule);
  text-align: start;
  white-space: nowrap;
}
.vt-anims__table tr[data-part='group'] td {
  color: var(--tone-info-text);
}

.vt-note {
  padding: 14px 16px;
  border-radius: var(--r2);
  font-size: var(--fs-6);
  line-height: 1.6;
}
.vt-note[data-tone='info'] {
  border: 1px solid var(--tone-info-line);
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
}
.vt-note[data-tone='ok'] {
  border: 1px solid var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.vt-note[data-tone='warn'] {
  border: 1px solid var(--tone-warn-line);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.vt-note[data-tone='err'] {
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}

.vt-disclaimer {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}
</style>

<!--
  Псевдоэлементы перехода висят на `<html>`, до них scoped-стиль не дотягивается, поэтому
  правило глобальное — и в слое, как требует `shared/styles/layers.css`. Длительность 600 мс
  против встроенных 250: иначе глаз не успевает увидеть, что именно сдвинулось. Выбор по классу
  перехода, а не по именам: имена карточкам даются только на время прогона.
-->
<style>
@layer lesson-overrides {
  ::view-transition-group(*.vt-card) {
    animation-duration: 600ms;
  }
}
</style>
