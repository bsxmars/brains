<script setup lang="ts">
/**
 * Цена обращения к свойству — замеренная на машине читателя, а не взятая из данных урока.
 *
 * Зачем так. Полоски с зашитыми миллисекундами говорят «поверьте»: числа сняты кем-то, когда-то,
 * на чужом железе. Здесь читатель нажимает кнопку, и те же пять случаев считаются у него —
 * вместе с суммой, доказывающей, что циклы не выброшены, и с параметрами, на которых число
 * получено. Кратность при этом устойчива, а миллисекунды у каждого свои: поэтому на первом
 * месте стоит `×`, а мс идут подписью помельче.
 *
 * ⚠️ **Чего здесь нет и быть не может.** Состояние inline cache из JS не наблюдаемо: ни
 * в браузере, ни в Node без `--allow-natives-syntax` у самого бинарника. Демо не спрашивает
 * движок «в каком состоянии площадка» и не показывает ответа на этот вопрос. Оно задаёт число
 * форм на входе и меряет **следствие** — время. Это единственное, что доступно со страницы,
 * и так об этом и написано в подвале.
 *
 * ⚠️ Автостарта нет намеренно. Остров гидратируется по `client:visible`, то есть в момент
 * прокрутки; замер занимает поток на секунду с лишним, и запуск без спроса выглядел бы
 * зависанием страницы ровно там, где читатель до неё долистал.
 *
 * Считает `model/bench.ts` — тот же модуль зовёт юнит-тест. Компонент только рисует и отпускает
 * поток между кругами: `runIcBench` синхронна, и вызвать её целиком значило бы заморозить
 * страницу вместе с надписью «идёт замер».
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button } from '@/shared/ui';
import { DEFAULTS, IC_CASES, benchRound, prepare, summarise, timerReady, unavailable } from '../model/bench';
import type { BenchOptions, IcBenchResult, RoundResult } from '../model/types';

const props = withDefaults(
  defineProps<{
    iterations?: number;
    ring?: number;
    runs?: number;
    warmups?: number;
    note?: string;
  }>(),
  {
    iterations: DEFAULTS.iterations,
    ring: DEFAULTS.ring,
    runs: DEFAULTS.runs,
    warmups: DEFAULTS.warmups,
    note: 'Состояние площадки inline cache из JS не видно — ни здесь, ни в Node без флага у самого бинарника. Замерить можно только следствие: сколько стоят одинаковые чтения, когда форм одна и когда двадцать. Слова «мономорфный» и «мегаморфный» тут про то, что мы **положили на вход**, а не про ответ движка.',
  },
);

const options = computed<BenchOptions>(() => ({
  iterations: props.iterations,
  ring: props.ring,
  runs: props.runs,
  warmups: props.warmups,
}));

const running = ref(false);
const phase = ref('');
const result = ref<IcBenchResult | null>(null);

/**
 * Отпустить поток так, чтобы браузер успел перерисоваться.
 *
 * Одного `requestAnimationFrame` мало: он зовёт обратно **перед** отрисовкой, и следующий
 * круг замера занял бы поток раньше, чем кадр доедет до экрана. Поэтому кадр, а следом ноль
 * таймера — тогда надпись «замер 2 из 5» действительно видно.
 */
const breathe = () =>
  new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(resolve, 0));
    else setTimeout(resolve, 0);
  });

const run = async () => {
  if (running.value) return;
  running.value = true;
  result.value = null;

  const opts = options.value;

  if (!timerReady()) {
    result.value = unavailable(opts);
    running.value = false;
    return;
  }

  phase.value = `прогрев: ${opts.warmups} холостых прогона`;
  await breathe();

  const prepared = prepare(opts);
  const rounds: RoundResult[] = [];

  for (let r = 0; r < opts.runs; r++) {
    phase.value = `замер ${r + 1} из ${opts.runs}`;
    await breathe();
    rounds.push(benchRound(prepared));
  }

  result.value = summarise(rounds, opts);
  phase.value = '';
  running.value = false;
};

/** Полосы рисуются по кратности, а не по миллисекундам: сравнение — это и есть предмет. */
const bars = computed(() => {
  const measured = result.value;
  const top = measured?.ok ? Math.max(...measured.rows.map((row) => row.ratio)) : 1;

  return IC_CASES.map((item, i) => {
    const row = measured?.ok ? measured.rows[i] : null;
    return {
      key: item.key,
      label: item.label,
      what: item.what,
      tone: item.tone,
      width: row && top > 0 ? Math.max(2, Math.round((row.ratio / top) * 100)) : 0,
      ratio: row ? `×${row.ratio.toFixed(2)}` : '—',
      ms: row ? `${row.ms.toFixed(1)} мс` : '',
    };
  });
});

const headline = computed(() => {
  const measured = result.value;
  if (!measured?.ok) return '';
  return measured.headline.toFixed(2);
});

const params = computed(() => {
  const o = options.value;
  return [
    { label: 'чтений в одном замере', value: o.iterations.toLocaleString('ru-RU') },
    { label: 'объектов в кольце', value: String(o.ring) },
    { label: 'кругов, берётся медиана', value: String(o.runs) },
    { label: 'холостых прогонов до замера', value: String(o.warmups) },
  ];
});

/**
 * Подпись под полосами.
 *
 * ⚠️ Живёт строкой и печатается через `Md`, а не текстом в шаблоне: строчную разметку разбирает
 * только `inlineMd`, и звать его обязан тот, кто выводит строку. Написанное прямо в шаблоне
 * `**машинозависимы**` доехало бы до читателя звёздочками — и доехало: это поймал
 * `tests/e2e/markup.spec.ts` сразу на двух страницах.
 */
const axisNote =
  'Полосы — кратность. Миллисекунды рядом **машинозависимы**: на другом железе они будут другими, а кратность — примерно той же.';
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="ib-bar">
        <Button variant="primary" :disabled="running" @click="run">
          {{ running ? 'меряю…' : result ? 'замерить ещё раз' : 'замерить' }}
        </Button>
        <span v-if="phase" class="ib-phase">{{ phase }}</span>
        <span v-else-if="!result" class="ib-phase">числа появятся после запуска — их считает ваш браузер</span>
      </div>
    </template>

    <div class="ib-split">
      <div class="ib-pane">
        <div class="t-label">во сколько раз дороже мономорфного</div>

        <div class="ib-chart">
          <div v-for="row in bars" :key="row.key" class="ib-row">
            <span class="ib-row__label">{{ row.label }}</span>
            <div class="ib-track">
              <div class="ib-fill" :data-tone="row.tone" :style="`width:${row.width}%`"></div>
            </div>
            <span class="ib-row__ratio" :class="{ 'ib-row__ratio--empty': !result }">{{ row.ratio }}</span>
            <span class="ib-row__ms">{{ row.ms }}</span>
          </div>
        </div>

        <Md class="ib-axis" :text="axisNote" />

        <div v-if="result?.ok" class="ib-verdict" data-tone="err">
          Двадцать форм против одной: <b>×{{ headline }}</b>
        </div>
        <div v-else-if="result" class="ib-verdict" data-tone="warn">
          <Md :text="result.note" />
        </div>
      </div>

      <div class="ib-pane ib-pane--right">
        <div class="ib-block">
          <div class="t-label">на чём получено</div>
          <dl class="ib-params">
            <template v-for="item in params" :key="item.label">
              <dt class="ib-params__key">{{ item.label }}</dt>
              <dd class="ib-params__value">{{ item.value }}</dd>
            </template>
          </dl>
        </div>

        <div class="ib-block">
          <div class="t-label">цикл не выброшен</div>
          <div v-if="result?.ok" class="ib-sum" :data-agree="result.sumsAgree">
            <span class="ib-sum__value">{{ result.sum.toLocaleString('ru-RU') }}</span>
            <Md class="ib-sum__why" :text="result.note" />
          </div>
          <div v-else class="ib-empty">сумма появится вместе с замером</div>
        </div>

        <div class="ib-block">
          <div class="t-label">что лежало в кольце</div>
          <ul class="ib-cases">
            <li v-for="item in IC_CASES" :key="item.key" class="ib-case">
              <b class="ib-case__label">{{ item.label }}</b>
              <span class="ib-case__what">{{ item.what }}</span>
            </li>
          </ul>
        </div>
      </div>
    </div>

    <template #footer>
      <Md class="ib-foot" :text="note" />
    </template>
  </DemoFrame>
</template>

<style scoped>
.ib-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}
.ib-phase {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}

.ib-split {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
}
.ib-pane {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
  border-right: 1px solid var(--divider);
  min-width: 0;
}
.ib-pane--right {
  border-right: 0;
  background: var(--surface-2);
  gap: 18px;
}

.ib-chart {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ib-row {
  display: grid;
  grid-template-columns: minmax(66px, 78px) minmax(0, 1fr) auto auto;
  gap: 10px;
  align-items: center;
}
.ib-row__label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  text-align: end;
  color: var(--text-faint);
}
.ib-track {
  min-width: 0;
  height: 18px;
  border-radius: var(--r1);
  background: var(--sunk-dim);
}
.ib-fill {
  height: 100%;
  border-radius: var(--r1);
  background: var(--bar-neutral);
  transition: width 0.25s;
}
.ib-fill[data-tone='ok'] {
  background: var(--bar-green);
}
.ib-fill[data-tone='err'] {
  background: var(--bar-red);
}
.ib-row__ratio {
  min-width: 52px;
  font-family: var(--mono);
  font-size: var(--fs-5);
  font-weight: 600;
  text-align: end;
  white-space: nowrap;
  color: var(--ink);
}
.ib-row__ratio--empty {
  font-weight: 400;
  color: var(--ghost);
}
.ib-row__ms {
  min-width: 62px;
  font-family: var(--mono);
  font-size: var(--fs-3);
  text-align: end;
  white-space: nowrap;
  color: var(--dim);
}

.ib-axis {
  margin: 0;
  font-size: var(--fs-4);
  line-height: 1.55;
  color: var(--text-muted);
}

.ib-verdict {
  padding: 12px 14px;
  border-radius: var(--r2);
  font-family: var(--mono);
  font-size: var(--fs-6);
  line-height: 1.55;
}
.ib-verdict[data-tone='err'] {
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}
.ib-verdict[data-tone='warn'] {
  border: 1px solid var(--tone-warn-line);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}

.ib-block {
  display: flex;
  flex-direction: column;
  gap: 9px;
  min-width: 0;
}

.ib-params {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 6px 12px;
  margin: 0;
}
.ib-params__key {
  font-size: var(--fs-4);
  line-height: 1.45;
  color: var(--text-muted);
}
.ib-params__value {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--fs-4);
  text-align: end;
  white-space: nowrap;
  color: var(--ink);
}

.ib-sum {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 11px 13px;
  border: 1px solid var(--tone-ok-line);
  border-radius: var(--r2);
  background: var(--tone-ok-bg);
}
.ib-sum[data-agree='false'] {
  border-color: var(--tone-err-line);
  background: var(--tone-err-bg);
}
.ib-sum__value {
  font-family: var(--mono);
  font-size: var(--fs-6);
  font-weight: 600;
  color: var(--tone-ok-text);
  overflow-wrap: anywhere;
}
.ib-sum[data-agree='false'] .ib-sum__value {
  color: var(--tone-err-text);
}
.ib-sum__why {
  font-size: var(--fs-4);
  line-height: 1.5;
  color: var(--tone-ok-text);
}
.ib-sum[data-agree='false'] .ib-sum__why {
  color: var(--tone-err-text);
}

.ib-empty {
  font-family: var(--mono);
  font-size: var(--fs-2);
  font-style: italic;
  color: var(--ghost);
}

.ib-cases {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.ib-case {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 11px;
  border: 1px solid var(--border);
  border-radius: var(--r1);
  background: var(--surface);
}
.ib-case__label {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
}
.ib-case__what {
  font-size: var(--fs-4);
  line-height: 1.45;
  color: var(--text-muted);
}

.ib-foot {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}

@media (max-width: 760px) {
  .ib-split {
    grid-template-columns: 1fr;
  }
  .ib-pane {
    border-right: 0;
    border-bottom: 1px solid var(--divider);
  }
  .ib-row {
    grid-template-columns: minmax(60px, 72px) minmax(0, 1fr) auto;
  }
  .ib-row__ms {
    display: none;
  }
}
</style>
