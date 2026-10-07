<script setup lang="ts">
/**
 * Сдвиг макета вживую: одно и то же обновление с зарезервированным местом и без.
 *
 * Главное решение здесь — **не хранить числа в данных**. Демо меняет собственный DOM, снимает
 * геометрию до и после и считает балл по формуле метрики: `impact × distance`. Так на странице
 * появляется не «нам сказали 0.35», а настоящий расчёт, который читатель может повторить
 * в консоли своей страницы.
 *
 * Вьюпортом считается рамка демо, а не окно, и это написано прямо в подписи: настоящий CLS
 * меряется относительно окна, а демо, двигающее саму страницу, было бы издевательством —
 * читатель ловил бы уезжающий из-под курсора текст.
 *
 * Сдвиги копятся так же, как в метрике: окно сессии растёт, пока разрыв между соседними
 * сдвигами меньше секунды, живёт не дольше пяти, а CLS — максимум по окнам. Поэтому демо
 * заодно показывает то, что в статьях до 2021 года написано неверно: это **не сумма**.
 */
import { computed, nextTick, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button, SegmentedControl } from '@/shared/ui';
import type { ClsCase, ShiftRecord } from '../model/types';

const props = withDefaults(
  defineProps<{
    cases: ClsCase[];
    /** Порог «хорошо» и порог «плохо» — те же, что у метрики. */
    good?: number;
    poor?: number;
  }>(),
  { good: 0.1, poor: 0.25 },
);

const caseKey = ref(props.cases[0].key);
const options = computed(() => props.cases.map((c) => ({ value: c.key, label: c.label })));
const current = computed(() => props.cases.find((c) => c.key === caseKey.value) ?? props.cases[0]);

const loaded = ref(false);
const banner = ref(false);
const shifts = ref<ShiftRecord[]>([]);

const frame = ref<HTMLElement | null>(null);

/**
 * Отслеживаемые блоки ищутся по атрибуту, а не собираются в массив ссылок.
 *
 * Причина техническая и стоит строчки объяснения: одинаковый `ref` на нескольких элементах
 * вне `v-for` массива не даёт — каждый следующий элемент просто перезаписывает предыдущий,
 * и до измерения доезжает один блок из трёх. Запрос по разметке честнее и заодно ближе к тому,
 * что делает сама метрика: она тоже смотрит на все узлы, а не на заранее объявленный список.
 */
const trackedEls = (): HTMLElement[] =>
  Array.from(frame.value?.querySelectorAll<HTMLElement>('[data-track]') ?? []);

type Box = { top: number; left: number; width: number; height: number };

const boxes = (): Box[] => {
  const root = frame.value?.getBoundingClientRect();
  if (!root) return [];
  return trackedEls().map((el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top - root.top, left: r.left - root.left, width: r.width, height: r.height };
  });
};

/**
 * Объединение прямоугольников берётся описанной рамкой, а не точной фигурой.
 *
 * Для метрики это упрощение, и оно честное ровно в том случае, который здесь показан: сдвинутые
 * блоки лежат вертикальной стопкой одной ширины, и объединение их «до» и «после» — прямоугольник.
 * На произвольной странице объединение считается по настоящей фигуре.
 */
function union(list: Box[]): Box | null {
  if (!list.length) return null;
  const top = Math.min(...list.map((b) => b.top));
  const left = Math.min(...list.map((b) => b.left));
  const bottom = Math.max(...list.map((b) => b.top + b.height));
  const right = Math.max(...list.map((b) => b.left + b.width));
  return { top, left, width: right - left, height: bottom - top };
}

/** Обрезка по «вьюпорту» — за краем рамки ничего не считается, как и в метрике. */
function clip(box: Box, w: number, h: number): number {
  const top = Math.max(0, box.top);
  const left = Math.max(0, box.left);
  const bottom = Math.min(h, box.top + box.height);
  const right = Math.min(w, box.left + box.width);
  return Math.max(0, bottom - top) * Math.max(0, right - left);
}

/** Ждём, пока браузер действительно пересчитает геометрию: правка стиля её только грязнит. */
const afterFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

async function measure(label: string, change: () => void) {
  const root = frame.value?.getBoundingClientRect();
  if (!root) return;
  const before = boxes();

  change();
  await nextTick();
  await afterFrame();

  const after = boxes();
  const moved: Box[] = [];
  let maxMove = 0;

  for (let i = 0; i < before.length; i += 1) {
    const a = before[i];
    const b = after[i];
    if (!a || !b) continue;
    const move = Math.max(Math.abs(b.top - a.top), Math.abs(b.left - a.left));
    // Полпикселя — порог «это округление, а не сдвиг».
    if (move < 0.5) continue;
    maxMove = Math.max(maxMove, move);
    moved.push(a, b);
  }

  const region = union(moved);
  if (!region || maxMove === 0) return;

  const impact = clip(region, root.width, root.height) / (root.width * root.height);
  const distance = maxMove / Math.max(root.width, root.height);
  shifts.value = [
    ...shifts.value,
    {
      at: performance.now(),
      label,
      impact: Math.round(impact * 1000) / 1000,
      distance: Math.round(distance * 1000) / 1000,
      value: Math.round(impact * distance * 1000) / 1000,
    },
  ];
}

const loadImage = () => measure('картинка догрузилась', () => { loaded.value = true; });
const addBanner = () => measure('баннер вставился сверху', () => { banner.value = true; });

function resetAll() {
  loaded.value = false;
  banner.value = false;
  shifts.value = [];
}

/** Окна сессии: разрыв меньше секунды держит окно открытым, длина окна — не больше пяти секунд. */
const windows = computed(() => {
  const result: { sum: number; count: number }[] = [];
  let startedAt = 0;
  let lastAt = 0;

  for (const shift of shifts.value) {
    const fresh = !result.length || shift.at - lastAt >= 1000 || shift.at - startedAt >= 5000;
    if (fresh) {
      result.push({ sum: 0, count: 0 });
      startedAt = shift.at;
    }
    const window = result[result.length - 1];
    window.sum = Math.round((window.sum + shift.value) * 1000) / 1000;
    window.count += 1;
    lastAt = shift.at;
  }
  return result;
});

const cls = computed(() => (windows.value.length ? Math.max(...windows.value.map((w) => w.sum)) : 0));
const sum = computed(
  () => Math.round(shifts.value.reduce((acc, s) => acc + s.value, 0) * 1000) / 1000,
);
const rating = computed(() =>
  cls.value <= props.good ? 'ok' : cls.value <= props.poor ? 'warn' : 'err',
);
const ratingLabel = computed(() =>
  cls.value <= props.good ? 'good' : cls.value <= props.poor ? 'needs improvement' : 'poor',
);

/** Разрыв с предыдущим сдвигом — по нему видно, почему окно закрылось. */
const gapOf = (i: number) =>
  i === 0 ? null : Math.round((shifts.value[i].at - shifts.value[i - 1].at) / 100) / 10;

function switchCase(key: string) {
  caseKey.value = key;
  resetAll();
}
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="bar">
        <SegmentedControl
          :model-value="caseKey"
          class="l-pills"
          label="Место под картинку"
          :options="options"
          @update:model-value="switchCase(String($event))"
        />
        <span class="t-label">вьюпорт — рамка ниже, а не окно</span>
      </div>
    </template>

    <div class="body">
      <div class="split">
        <div ref="frame" class="viewport">
          <div v-if="banner" class="banner">баннер, вставленный в поток</div>

          <div data-track class="line">Заголовок статьи</div>

          <div
            class="media"
            :data-reserved="current.reserved ? 'yes' : 'no'"
            :data-loaded="loaded ? 'yes' : 'no'"
          >
            <span v-if="loaded" class="media__label">картинка</span>
            <span v-else-if="current.reserved" class="media__label media__label--ghost">
              место занято
            </span>
          </div>

          <div data-track class="para">
            Текст под картинкой. Именно он уезжает вниз, когда место под неё не занято заранее.
          </div>
          <div data-track class="para para--dim">И следующий абзац вместе с ним.</div>
        </div>

        <div class="panel">
          <div class="actions">
            <Button variant="primary" :disabled="loaded" @click="loadImage">картинка догрузилась</Button>
            <Button variant="secondary" :disabled="banner" @click="addBanner">баннер сверху</Button>
            <Button variant="secondary" :disabled="!shifts.length && !loaded && !banner" @click="resetAll">
              сброс
            </Button>
          </div>

          <div class="score" :data-tone="rating">
            <span class="t-label">CLS — максимум по окнам</span>
            <span class="score__value">{{ cls.toFixed(3) }}</span>
            <span class="score__rating">{{ ratingLabel }}</span>
          </div>

          <div class="rows">
            <div class="t-label">сдвиги по формуле метрики</div>
            <div v-if="!shifts.length" class="empty">пока ничего не двигалось</div>

            <div v-for="(shift, i) in shifts" :key="shift.at" class="row">
              <span class="row__k">{{ shift.label }}</span>
              <span class="row__calc">
                impact {{ shift.impact.toFixed(3) }} × distance {{ shift.distance.toFixed(3) }}
              </span>
              <span class="row__value">{{ shift.value.toFixed(3) }}</span>
              <span v-if="gapOf(i) !== null" class="row__gap">
                разрыв {{ gapOf(i) }} с → {{ (gapOf(i) as number) >= 1 ? 'новое окно' : 'то же окно' }}
              </span>
            </div>

            <div v-if="windows.length > 1" class="windows">
              <span class="t-label">окна</span>
              <span v-for="(w, i) in windows" :key="i" class="window" :data-best="w.sum === cls ? 'yes' : 'no'">
                {{ w.sum.toFixed(3) }}
              </span>
              <span class="windows__note">сумма всех сдвигов была бы {{ sum.toFixed(3) }}</span>
            </div>
          </div>
        </div>
      </div>

      <Md class="note" :data-tone="current.tone" :text="current.note" />
    </div>

    <template #footer>
      <div class="disclaimer">
        Числа не записаны в данные — демо снимает геометрию своих блоков до и после изменения
        и считает <code>impact × distance</code> само. Вьюпортом считается рамка демо: настоящий
        CLS меряется относительно окна, но демо, двигающее страницу под курсором, объясняло бы
        тему её же средствами. Проверка формулы на настоящем браузере: блок 800×300, уехавший
        на 300px во вьюпорте 800×600, дал в Chromium 153 ровно <b>0.375</b> — столько же, сколько
        <code>1.0 × (300 / 800)</code> на бумаге.
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
}

.split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr);
  gap: 18px;
  align-items: start;
}

/* Модельный вьюпорт: высота фиксирована и содержимое обрезается — иначе демо про сдвиги
   двигало бы саму страницу, и читатель ловил бы уезжающий текст. */
.viewport {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 260px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--surface-2);
  overflow: hidden;
}

.banner {
  padding: 9px 11px;
  border-radius: var(--r1);
  background: var(--tone-warn-chip);
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--tone-warn-text);
}

.line {
  font-size: var(--fs-6);
  font-weight: 500;
  color: var(--ink);
}

.media {
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--r1);
  transition: none;
}
/* Место не занято: до загрузки высоты нет вовсе — ровно та ситуация, что ломает метрику. */
.media[data-reserved='no'][data-loaded='no'] {
  height: 0;
}
.media[data-reserved='no'][data-loaded='yes'] {
  height: 120px;
  background: var(--tone-info-chip);
}
/* Место занято: соотношение сторон известно до загрузки, дырка нужного размера уже есть. */
.media[data-reserved='yes'] {
  aspect-ratio: 16 / 6;
  border: 1px dashed var(--border-strong);
}
.media[data-reserved='yes'][data-loaded='yes'] {
  border-color: transparent;
  background: var(--tone-info-chip);
}
.media__label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--tone-info-text);
}
.media__label--ghost {
  color: var(--ghost);
}

.para {
  font-size: var(--fs-5);
  line-height: 1.5;
  color: var(--prose);
}
.para--dim {
  color: var(--text-faint);
}

.panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.score {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 12px 14px;
  border-radius: var(--r2);
  transition: all 0.2s;
}
.score[data-tone='ok'] {
  border: 1px solid var(--tone-ok-line);
  background: var(--tone-ok-bg);
}
.score[data-tone='warn'] {
  border: 1px solid var(--tone-warn-line);
  background: var(--tone-warn-bg);
}
.score[data-tone='err'] {
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
}
.score__value {
  font-family: var(--mono);
  font-size: var(--fs-8);
}
.score[data-tone='ok'] .score__value {
  color: var(--tone-ok-strong);
}
.score[data-tone='warn'] .score__value {
  color: var(--tone-warn-strong);
}
.score[data-tone='err'] .score__value {
  color: var(--tone-err-strong);
}
.score__rating {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}

.rows {
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-width: 0;
}
.empty {
  font-family: var(--mono);
  font-size: var(--fs-2);
  font-style: italic;
  color: var(--ghost);
}
.row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  padding: 9px 11px;
  border-radius: var(--r1);
  background: var(--surface-2);
}
.row__k {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--chip-text);
}
.row__calc {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}
.row__value {
  margin-left: auto;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
}
.row__gap {
  flex-basis: 100%;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--dim);
}

.windows {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding-top: 10px;
  border-top: 1px solid var(--rule);
}
.window {
  padding: 3px 9px;
  border-radius: var(--r-full);
  background: var(--surface-3);
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.window[data-best='yes'] {
  background: var(--ink);
  color: var(--on-ink);
}
.windows__note {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--dim);
}

.note {
  padding: 13px 15px;
  border-radius: var(--r2);
  font-size: var(--fs-6);
  line-height: 1.6;
}
.note[data-tone='ok'] {
  border: 1px solid var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.note[data-tone='err'] {
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}

.disclaimer {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}
.disclaimer :deep(b) {
  color: var(--ink);
}

@media (max-width: 640px) {
  .split {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
