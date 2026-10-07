<script setup lang="ts">
/**
 * Путь до первого пикселя — на одной шкале времени, двумя раскладами.
 *
 * Почему дорожка, а не список шагов. Критический путь — это не «что делает браузер», а «кто кого
 * ждёт»: сеть качает CSS, пока парсер стоит на синхронном скрипте, а скрипт, уже скачанный,
 * ждёт тот самый CSS. Из списка столбиком этого не видно вовсе — видно только из координат
 * на общей шкале, где отрезки лежат друг под другом.
 *
 * Почему два расклада на одной шкале. Урок утверждает, что порядок загрузки двигает метрику
 * сильнее скорости кода. Такое утверждение проверяется только сравнением, и сравнение обязано
 * быть честным: миллисекунда в обоих раскладах одной длины, ресурсы одни и те же.
 *
 * ⚠️ Длительности отрезков модельные — это порядки величин, чтобы картинка читалась. Проверено
 * запуском (Chromium 153) другое, и оно здесь главное: **что за чем ждёт** и во сколько это
 * обходится на порядок. Числа замеров стоят в тексте урока рядом.
 */
import { computed, ref, watch } from 'vue';
import { usePlayer } from '@/shared/lib/usePlayer';
import { useStepper } from '@/shared/lib/useStepper';
import CodeListing from '@/shared/ui/CodeListing.vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import PlayerToolbar from '@/shared/ui/PlayerToolbar.vue';
import { SegmentedControl } from '@/shared/ui';
import type { CrpCase, CrpLane, CrpPhase } from '../model/types';

const props = defineProps<{
  cases: CrpCase[];
  lanes: CrpLane[];
  /** Длина шкалы, мс. Одна на оба расклада. */
  scale: number;
}>();

const caseKey = ref(props.cases[0].key);
const options = computed(() => props.cases.map((c) => ({ value: c.key, label: c.label })));
const current = computed(() => props.cases.find((c) => c.key === caseKey.value) ?? props.cases[0]);

const total = computed(() => current.value.steps.length);
const stepper = useStepper(total);
const { index, counter, atStart, atEnd, next, prev, reset, go } = stepper;
const { playing, speed, speeds, available, toggle, setSpeed, pause } = usePlayer(stepper, {
  interval: 1600,
});

// Смена расклада — это другой разбор, а не другая картинка к тому же тексту: продолжать
// проигрывание с середины чужого сценария значило бы показывать подпись не от того шага.
watch(caseKey, () => {
  pause();
  reset();
});

const step = computed(() => current.value.steps[index.value]);
const active = computed(() => new Set(step.value.phases));

const passed = computed(() => {
  const seen = new Set<string>();
  for (let i = 0; i < index.value; i += 1) {
    for (const id of current.value.steps[i].phases) seen.add(id);
  }
  return seen;
});

function state(phase: CrpPhase): 'active' | 'done' | 'idle' {
  if (active.value.has(phase.id)) return 'active';
  return passed.value.has(phase.id) ? 'done' : 'idle';
}

const pct = (ms: number) => (ms / props.scale) * 100;

/**
 * Подпись помещается только в достаточно широкий отрезок.
 *
 * На дорожке есть фазы по 4–8 мс при шкале в сотни: это меньше процента ширины, то есть
 * около десяти пикселей. В такую полосу не влезает даже многоточие — остаётся обрывок вроде
 * «п» или «1 s.», и он читается как брак вёрстки, а не как «не поместилось». Поэтому короткие
 * отрезки остаются цветными полосами без надписи: что это за фаза, читатель узнаёт из панели
 * шага под дорожкой, где текст стоит целиком.
 *
 * Порог в процентах шкалы, а не в пикселях: демо тянется по ширине экрана, и пиксельный
 * порог врал бы на телефоне.
 *
 * Само значение выбрано по двум границам, а не на глаз. Снизу — фазы главного потока по 4–8 мс
 * (0.6–1.2 % шкалы), подпись в них невозможна. Сверху — метки `FCP 424` и `LCP 572` шириной
 * 30 мс (4.7 %): это те самые две отметки, ради которых дорожка «экран» и нарисована, и терять
 * их нельзя. Порог стоит между этими числами.
 */
const FITS_LABEL_PCT = 4;
const fits = (ms: number) => pct(ms) >= FITS_LABEL_PCT;

const lanes = computed(() =>
  props.lanes.map((lane) => ({
    ...lane,
    items: current.value.phases.filter((p) => p.lane === lane.key),
  })),
);

/** Деления шкалы — четверти общей длины, одинаковые у обоих раскладов. */
const ticks = computed(() => [0, 1, 2, 3, 4].map((i) => Math.round((props.scale * i) / 4)));

const codeLines = computed(() => current.value.code.split('\n'));
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="bar">
        <PlayerToolbar
          :counter="counter"
          :index="index"
          :playing="playing"
          :speed="speed"
          :speeds="speeds"
          :available="available"
          :at-start="atStart"
          :at-end="atEnd"
          @toggle="toggle"
          @scrub="go"
          @speed="setSpeed"
          @prev="prev"
          @next="next"
          @reset="reset"
        />
        <SegmentedControl
          v-model="caseKey"
          class="l-pills"
          label="Расклад загрузки"
          :options="options"
        />
      </div>
    </template>

    <div class="body">
      <CodeListing :lines="codeLines" label="разметка документа" />

      <div class="scroll">
        <div class="chart">
          <div v-for="lane in lanes" :key="lane.key" class="lane">
            <div class="lane__name t-label">{{ lane.label }}</div>
            <div class="lane__track" :data-lane="lane.key">
              <span
                v-for="phase in lane.items"
                :key="phase.id"
                class="phase"
                :data-tone="phase.tone"
                :data-state="state(phase)"
                :style="`left:${pct(phase.at)}%;width:${pct(phase.ms)}%`"
              >
                <span v-if="fits(phase.ms)" class="phase__label">{{ phase.label }}</span>
              </span>
            </div>
          </div>

          <div class="axis">
            <span v-for="tick in ticks" :key="tick">{{ tick }}</span>
          </div>
        </div>
      </div>

      <div class="info">
        <div class="where">{{ step.where }}</div>
        <Md class="title" :text="step.title" />
        <Md class="message" :data-tone="step.tone ?? 'neutral'" :text="step.message" />
      </div>

      <Md class="verdict" :data-tone="current.tone" :text="current.verdict" />
    </div>

    <template #footer>
      <div class="disclaimer">
        Длительности отрезков модельные — порядки величин, чтобы дорожка читалась. Проверено
        запуском в Chromium 153 (Playwright, headless, localhost) другое, и оно здесь главное:
        кто кого ждёт. Медианы трёх прогонов — FCP 328 мс с синхронным скриптом против 12 мс
        с <code>defer</code>, 424 мс с блокирующим CSS; LCP 428 мс у <code>&lt;img&gt;</code>
        против 572 мс у CSS-фона.
        Задержки ресурсов выставлены руками, настоящей сети здесь нет.
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
  gap: 18px;
  padding: 22px 20px;
}

/* Дорожка длиннее телефона, и прокручиваться должна она, а не страница. */
.scroll {
  min-width: 0;
  overflow-x: auto;
}
.chart {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 620px;
}

.lane {
  display: grid;
  grid-template-columns: 118px minmax(0, 1fr);
  gap: 12px;
  align-items: center;
}
.lane__name {
  text-align: end;
}

.lane__track {
  position: relative;
  height: 30px;
  border-radius: var(--r1);
  background: var(--surface-2);
  background-image: repeating-linear-gradient(to right, var(--rule) 0 1px, transparent 1px 25%);
}
/* Дорожка экрана — не про длительность, а про момент: отрезки на ней короткие и стоят метками. */
.lane__track[data-lane='screen'] {
  height: 26px;
}

.phase {
  position: absolute;
  top: 3px;
  bottom: 3px;
  display: flex;
  align-items: center;
  /* Подпись прижата к началу, а не центрирована: центрированная обрезается с обеих сторон
     и превращается в «зр» и «ipyoı» — обрывок посреди слова читается как брак вёрстки,
     а не как «не поместилось». */
  justify-content: flex-start;
  padding: 0 5px;
  border-radius: var(--r1);
  overflow: hidden;
  transition: all 0.2s;
}
.phase__label {
  /* `min-width: 0` обязателен: без него флекс-элемент не сжимается ниже своего текста
     и многоточие не появляется — обрезка снова уедет в середину слова. */
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: var(--mono);
  /* `--fs-2`, а не `--fs-3`: подпись живёт внутри отрезка фиксированной ширины (строки YAML — в колонке), и ступень крупнее обрезала бы её сильнее, чем мелкий кегль мешал читать. */
  font-size: var(--fs-2);
  white-space: nowrap;
}

.phase[data-tone='ink'] {
  --phase-bg: var(--ink);
  --phase-fg: var(--on-ink);
}
.phase[data-tone='info'] {
  --phase-bg: var(--tone-info-chip);
  --phase-fg: var(--tone-info-text);
}
.phase[data-tone='warn'] {
  --phase-bg: var(--tone-warn-chip);
  --phase-fg: var(--tone-warn-text);
}
.phase[data-tone='ok'] {
  --phase-bg: var(--tone-ok-chip);
  --phase-fg: var(--tone-ok-text);
}
.phase[data-tone='err'] {
  --phase-bg: var(--tone-err-chip);
  --phase-fg: var(--tone-err-text);
}
/* Ожидание — не работа: пунктир вместо заливки, потому что здесь ничего не происходит. */
.phase[data-tone='dim'] {
  --phase-bg: var(--sunk-dim);
  --phase-fg: var(--text-muted);
}

.phase[data-state='idle'] {
  background: var(--sunk-dim);
  color: var(--ghost);
}
.phase[data-state='done'] {
  background: var(--phase-bg);
  color: var(--phase-fg);
  opacity: 0.5;
}
.phase[data-state='active'] {
  background: var(--phase-bg);
  color: var(--phase-fg);
  box-shadow: var(--shadow-1);
}
.phase[data-tone='dim'][data-state='active'] {
  border: 1px dashed var(--border-strong);
}

.axis {
  display: flex;
  justify-content: space-between;
  padding-left: 130px;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--dim);
}

.info {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.where {
  align-self: flex-start;
  padding: 7px 11px;
  border-radius: var(--r-full);
  background: var(--surface-3);
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.title {
  font-size: var(--fs-7);
  line-height: 1.35;
  color: var(--ink);
}
.message {
  padding: 14px 16px;
  border-radius: var(--r2);
  font-size: var(--fs-6);
  line-height: 1.6;
  transition: all 0.2s;
}
.message[data-tone='neutral'] {
  background: var(--surface-2);
  color: var(--prose);
}
.message[data-tone='info'] {
  border: 1px solid var(--tone-info-line);
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
}
.message[data-tone='ok'] {
  border: 1px solid var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.message[data-tone='warn'] {
  border: 1px solid var(--tone-warn-line);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.message[data-tone='err'] {
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}

.verdict {
  padding-top: 16px;
  border-top: 1px solid var(--rule);
  font-size: var(--fs-6);
  line-height: 1.6;
}
.verdict[data-tone='ok'] {
  color: var(--tone-ok-text);
}
.verdict[data-tone='err'] {
  color: var(--tone-err-text);
}

.disclaimer {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}

/* На узком экране подпись дорожки встаёт над ней: 118px слева там дороже, чем строка сверху. */
@media (max-width: 560px) {
  .lane {
    grid-template-columns: minmax(0, 1fr);
    gap: 4px;
  }
  .lane__name {
    text-align: start;
  }
  .axis {
    padding-left: 0;
  }
}
</style>
