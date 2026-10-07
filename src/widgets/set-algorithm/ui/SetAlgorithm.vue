<script setup lang="ts">
/**
 * Запись свойства по шагам — четыре сценария, три из которых не создают своего свойства.
 *
 * Рядом с шагами стоят два узла, `o` и `proto`, и видно, **где** сейчас смотрит алгоритм.
 * Это и есть ответ на ходовое «запись по цепочке не идёт»: идёт, и подсветка это показывает —
 * просто ищет она там причину не создавать собственное свойство, а не значение.
 *
 * Нижняя строка «собственные свойства o» меняется ровно в одном сценарии из четырёх — так
 * разница между «сеттер отработал» и «свойство появилось» становится видимой, а не словесной.
 */
import { computed, ref, watch } from 'vue';
import { usePlayer } from '@/shared/lib/usePlayer';
import { useStepper } from '@/shared/lib/useStepper';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import PlayerToolbar from '@/shared/ui/PlayerToolbar.vue';
import { SegmentedControl } from '@/shared/ui';
import { runSet, type SetMode } from '../model/run';
import type { SetScenario } from '../model/types';

/*
 * ⚠️ Имена узлов приходят пропами, а не зашиты в разметку. Раньше в шаблоне стояли `o`
 * и `proto` — имена объектов, которые демо заводило само. Демо переехало на `dog`
 * из сквозного примера темы, и зашитые имена стали показывать не те объекты, о которых
 * говорят шаги.
 */
const props = withDefaults(
  defineProps<{ scenarios: SetScenario[]; sample: string; objectName?: string; protoName?: string }>(),
  { objectName: 'o', protoName: 'proto' },
);

const picked = ref(props.scenarios[0].key);
const options = computed(() => props.scenarios.map((s) => ({ value: s.key, label: s.label })));
const scenario = computed(() => props.scenarios.find((s) => s.key === picked.value) ?? props.scenarios[0]);

const total = computed(() => scenario.value.steps.length);
const stepper = useStepper(total);
const { index, counter, atStart, atEnd, next, prev, reset, go } = stepper;
const { playing, speed, speeds, available, toggle, setSpeed } = usePlayer(stepper);
watch(picked, reset);

const at = computed(() => Math.min(index.value, total.value - 1));
const highlight = computed(() => scenario.value.highlight[at.value]);
const finished = computed(() => at.value >= total.value - 1);

/** Узел подсвечен, пока алгоритм смотрит именно в него. */
const nodeState = (i: number) => (highlight.value === i ? 'scan' : 'idle');

/*
 * Всё, что демо говорит о результате, снято с живых объектов: код сценария исполняется
 * над свежим `dog` в обоих режимах (`model/run.ts`). Прогоны дешёвые и детерминированные,
 * поэтому делаются один раз на все сценарии — и на сервере, и в браузере ответ тот же.
 */
const runs = Object.fromEntries(props.scenarios.map((s) => [s.key, runSet(props.sample, s.code, s.prop)]));
const run = computed(() => runs[scenario.value.key]);

/** Пока сценарий не дошёл до конца, узлы показаны такими, какими были до записи. */
const nodes = computed(() => (finished.value ? run.value.strict : run.value.before));

const MODES: { mode: SetMode; label: string }[] = [
  { mode: 'sloppy', label: 'обычный код' },
  { mode: 'strict', label: 'строгий режим' },
];
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="sa-bar">
        <span class="sa-bar__label">сценарий:</span>
        <SegmentedControl v-model="picked" class="l-pills" label="Сценарий записи" :options="options" />
      </div>
    </template>

    <div class="sa-split">
      <div class="sa-pane">
        <pre class="sa-code">{{ scenario.code }}</pre>

        <div class="sa-node" :data-state="nodeState(0)">
          <span class="sa-node__name">{{ props.objectName }}</span>
          <span class="sa-node__row"><span class="sa-node__k">свои ключи</span>{{ nodes.object.keys }}</span>
          <span class="sa-node__row" :data-on="nodes.object.desc ? 'yes' : 'no'">
            <span class="sa-node__k">{{ scenario.prop }}</span>{{ nodes.object.desc ?? 'своего нет' }}
          </span>
          <span class="sa-node__row" :data-on="nodes.object.extensible ? 'no' : 'yes'">
            <span class="sa-node__k">новые ключи</span>{{ nodes.object.extensible ? 'можно' : 'нельзя (isExtensible: false)' }}
          </span>
        </div>

        <!-- Между ними стоит Dog.prototype: ключей сценариев там нет, и узел для него только
             удлинил бы картинку. Но молча его пропускать нельзя — подпись называет его. -->
        <div class="sa-arrow">↓ [[Prototype]] через Dog.prototype — там «{{ scenario.prop }}» нет</div>

        <div class="sa-node" :data-state="nodeState(1)">
          <span class="sa-node__name">{{ props.protoName }}</span>
          <span class="sa-node__row"><span class="sa-node__k">свои ключи</span>{{ nodes.proto.keys }}</span>
          <span class="sa-node__row" :data-on="nodes.proto.desc ? 'yes' : 'no'">
            <span class="sa-node__k">{{ scenario.prop }}</span>{{ nodes.proto.desc ?? 'нет' }}
          </span>
        </div>
      </div>

      <div class="sa-pane sa-pane--right">
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

        <ol class="sa-steps">
          <li
            v-for="(item, i) in scenario.steps"
            :key="i"
            class="sa-step"
            :data-state="i === at ? 'active' : i < at ? 'done' : 'next'"
            :data-tone="i === at ? (i === scenario.steps.length - 1 ? scenario.tone : 'info') : undefined"
          >
            <span class="sa-step__n">{{ String(i + 1).padStart(2, '0') }}</span>
            <Md as="span" :text="item" />
          </li>
        </ol>

        <!--
          Вывод запуска — ответ на «что в итоге произошло». Три вопроса, которые читатель задаёт
          после присваивания: бросило ли оно, что теперь читается и появилось ли своё свойство.
          Режимы рядом, потому что в трёх сценариях из четырёх они расходятся именно здесь:
          обычный код молчит, строгий бросает, а объект после обоих одинаковый.
        -->
        <div class="sa-result">
          <div class="t-label">вывод запуска</div>
          <div class="sa-out" :data-on="finished ? 'yes' : 'no'">
            <div v-for="m in MODES" :key="m.mode" class="sa-out__mode">
              <div class="sa-out__head">{{ m.label }}</div>
              <div class="sa-out__k">{{ scenario.code.split('\n').at(-1) }}</div>
              <div class="sa-out__v" :data-err="finished && run[m.mode].error ? 'yes' : 'no'">
                {{ finished ? (run[m.mode].error ?? 'ошибки нет') : '…' }}
              </div>
              <div class="sa-out__k">{{ props.objectName }}.{{ scenario.prop }}</div>
              <div class="sa-out__v">{{ finished ? run[m.mode].read : '…' }}</div>
              <div class="sa-out__k">своё «{{ scenario.prop }}» у {{ props.objectName }}</div>
              <div class="sa-out__v">{{ finished ? (run[m.mode].object.desc ? 'есть' : 'нет') : '…' }}</div>
            </div>
          </div>
        </div>

        <div class="sa-result">
          <div class="t-label">итог</div>
          <Md
            class="sa-result__box"
            :data-tone="finished ? scenario.tone : 'idle'"
            :text="finished ? scenario.result : '…'"
          />
        </div>
      </div>
    </div>
  </DemoFrame>
</template>

<style scoped>
.sa-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.sa-bar__label {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}

/*
 * Соотношение колонок прежнее: справа идёт обычный текст шагов, и места ему нужно больше.
 *
 * ⚠️ Я успел расширить левую колонку до `1.35fr`, когда комментарии в блоке кода стояли
 * справа от строк и хвост уходил под край. Это было лечение следствия: вёрстка
 * подгонялась под длину текста и всё равно не догоняла (66 знаков против нужных 71).
 * Комментарии переехали **над** строками, строки стали короткими — и подгонка отпала.
 */
.sa-split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr);
}

/*
 * Страховка на случай узкого окна: если ширины всё-таки не хватит, строка обязана
 * уехать в прокрутку, а не исчезнуть. Пропавший текст хуже полосы прокрутки —
 * о первом читатель не догадывается вовсе.
 */
.sa-code {
  overflow-x: auto;
}
.sa-pane {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px;
  border-right: 1px solid var(--divider);
  min-width: 0;
}
.sa-pane--right {
  border-right: 0;
  background: var(--surface-2);
  gap: 16px;
}

.sa-code {
  padding: 15px 17px;
  font-size: var(--fs-3);
  line-height: 1.75;
}

/* Узел цепочки: рамка — его настоящая граница, подсветка — «алгоритм сейчас здесь». */
.sa-node {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--surface);
  transition: all 0.2s;
}
.sa-node[data-state='idle'] {
  opacity: 0.85;
}
.sa-node[data-state='scan'] {
  border: 1.5px solid var(--accent);
  box-shadow: 0 0 0 3px var(--tone-info-chip);
}
.sa-node__name {
  font-family: var(--mono);
  font-size: var(--fs-4);
  font-weight: 600;
  color: var(--ink);
}
.sa-node__row {
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.5;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}
/* Строка ключа сценария: есть дескриптор — она главная в узле, нет — гаснет до подписи. */
.sa-node__row[data-on='yes'] {
  color: var(--ink);
}
.sa-node__k {
  margin-right: 8px;
  color: var(--text-faint);
}

.sa-arrow {
  padding-left: 2px;
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-faint);
}

.sa-steps {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.sa-step {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 10px 12px;
  border: 1px solid transparent;
  border-radius: var(--r2);
  font-size: var(--fs-5);
  line-height: 1.5;
  transition: all 0.18s;
}
.sa-step[data-state='done'] {
  color: var(--text-muted);
}
.sa-step[data-state='next'] {
  color: var(--dim);
}
.sa-step[data-tone='info'] {
  background: var(--tone-info-bg);
  border-color: var(--tone-info-line);
  color: var(--tone-info-text);
}
.sa-step[data-tone='ok'] {
  background: var(--tone-ok-bg);
  border-color: var(--tone-ok-line);
  color: var(--tone-ok-text);
}
.sa-step[data-tone='warn'] {
  background: var(--tone-warn-bg);
  border-color: var(--tone-warn-line);
  color: var(--tone-warn-text);
}
.sa-step[data-tone='err'] {
  background: var(--tone-err-bg);
  border-color: var(--tone-err-line);
  color: var(--tone-err-text);
}
/*
 * Номер шага гасится прозрачностью поверх и без того приглушённого цвета, и два гашения
 * перемножаются: `--dim` под `0.55` давал на панели **1.71:1** — номера не «бледные»,
 * а физически неразличимые. Даже с новым, более тёмным `--dim` та же прозрачность даёт 2.04:1.
 *
 * `0.8` поверх нового цвета — 3.01:1: номер остаётся тише текста, но читается.
 * Ступень тоже на одну выше: `--fs-1` для двух цифр рядом со строкой в `--fs-5` слишком мелко.
 */
.sa-step__n {
  flex-shrink: 0;
  font-family: var(--mono);
  font-size: var(--fs-2);
  opacity: 0.8;
}

.sa-result {
  display: flex;
  flex-direction: column;
  gap: 9px;
}
/*
 * ⚠️ Итог — та же проза, что и шаги над ним, поэтому и ступень та же: `--fs-5`. Стоял `--fs-6`,
 * и последняя строка панели выходила на ступень крупнее соседей (замечание автора курса,
 * 2026-10-03). На дев-сервере сверху ложился ещё и моноширинный шрифт: голый `.result__box`
 * из `lookup-chain`. Отсюда префиксы `sa-` у всех классов слайса.
 */
.sa-result__box {
  padding: 13px 15px;
  border-radius: var(--r2);
  font-size: var(--fs-5);
  line-height: 1.55;
  transition: all 0.2s;
}
.sa-result__box[data-tone='idle'] {
  border: 1px solid var(--divider);
  background: var(--sunk-dim);
  color: var(--dim);
}
.sa-result__box[data-tone='ok'] {
  border: 1px solid var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.sa-result__box[data-tone='warn'] {
  border: 1px solid var(--tone-warn-line);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.sa-result__box[data-tone='err'] {
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}

.sa-out {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 10px;
}
.sa-out__mode {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 12px 14px;
  border: 1px solid var(--divider);
  border-radius: var(--r2);
  background: var(--surface);
}
.sa-out[data-on='no'] .sa-out__mode {
  background: var(--sunk-dim);
}
.sa-out__head {
  margin-bottom: 4px;
  font-family: var(--mono);
  font-size: var(--fs-2);
  font-weight: 600;
  color: var(--ink);
}
.sa-out__k {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-faint);
}
.sa-out__v {
  margin-bottom: 6px;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
  overflow-wrap: anywhere;
}
.sa-out__v[data-err='yes'] {
  color: var(--tone-err-text);
}

@media (max-width: 720px) {
  .sa-split {
    grid-template-columns: 1fr;
  }
  .sa-pane {
    border-right: 0;
    border-bottom: 1px solid var(--divider);
  }
}
</style>
