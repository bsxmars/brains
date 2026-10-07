<script setup lang="ts">
/**
 * «Почему победило именно это правило» — главное демо урока.
 *
 * Всё здесь настоящее. Виджет собирает из включённых кандидатов таблицу стилей, кладёт её
 * в `document.head`, инлайновые объявления пишет в атрибут `style` подопытного элемента —
 * и элемент на странице действительно перекрашивается. Победителя виджет вычисляет сам,
 * сортировкой по шести критериям каскада, а потом сверяет своё предсказание с тем, что
 * вернул `getComputedStyle`. Если разойдётся — это увидит читатель, а не останется ошибкой
 * в тексте урока.
 *
 * ⚠️ **Селекторы кандидатов дописываются к `:where(#cascade-referee-root)`** — иначе правило
 * `.btn { color: … }` красило бы всё, что похоже, на всей странице. Префикс выбран именно
 * такой, потому что `:where()` даёт вклад `(0,0,0)`: разбор от него не меняется ни на разряд.
 * Это же первый повод показать `:where()` в деле.
 *
 * Шаги — это критерии. На шаге `k` показано, кто дожил до критерия `k` и кто на нём выбыл;
 * отсюда видно главное, ради чего демо существует: до специфичности спор обычно не доходит.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import CodeListing from '@/shared/ui/CodeListing.vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import PlayerToolbar from '@/shared/ui/PlayerToolbar.vue';
import { usePlayer } from '@/shared/lib/usePlayer';
import { useStepper } from '@/shared/lib/useStepper';
import type { CascadeDecl, CascadeLayers, CriterionCopy, CriterionKey } from '../model/types';

const props = defineProps<{
  decls: CascadeDecl[];
  layers: CascadeLayers;
  criteria: CriterionCopy[];
}>();

/** Корень демо: к нему привязаны все правила. */
const ROOT = 'cascade-referee-root';

const enabled = ref<Record<string, boolean>>(
  Object.fromEntries(props.decls.map((d) => [d.id, d.on])),
);
const flip = (id: string) => {
  enabled.value = { ...enabled.value, [id]: !enabled.value[id] };
};

/** Порядок в этом массиве — и порядок в таблице стилей, то есть шестой критерий. */
const active = computed(() => props.decls.filter((d) => enabled.value[d.id]));

const valueOf = (d: CascadeDecl) => `color: var(${d.token})${d.important ? ' !important' : ''}`;

/** Объявление так, как оно выглядит в листинге, — без служебного префикса. */
function declText(d: CascadeDecl): string {
  if (d.selector === null) return `<span class="btn" style="${valueOf(d)}">`;
  const rule = `${d.selector} { ${valueOf(d)}; }`;
  return d.layer ? `@layer ${d.layer} { ${rule} }` : rule;
}

/** А это то, что реально уезжает в документ. */
const cssText = computed(() => {
  const out = [props.layers.code];
  for (const d of active.value) {
    if (d.selector === null) continue;
    const rule = `:where(#${ROOT}) ${d.selector} { ${valueOf(d)}; }`;
    out.push(d.layer ? `@layer ${d.layer} { ${rule} }` : rule);
  }
  return out.join('\n');
});

/** Атрибут `style` подопытного элемента: он собирается из включённых инлайновых кандидатов. */
const styleAttr = computed(() =>
  active.value
    .filter((d) => d.selector === null)
    .map(valueOf)
    .join('; '),
);

const listing = computed(() => [props.layers.code, ...active.value.map(declText)]);

// ---- Сортировка по шести критериям ----

const layerPos = (d: CascadeDecl) => (d.layer ? props.layers.names.indexOf(d.layer) : -1);
const orderOf = (d: CascadeDecl) => props.decls.indexOf(d);

/**
 * Сила объявления по одному критерию: больше — сильнее. Возвращается массив, потому что
 * специфичность сравнивается лексикографически по трём разрядам, а остальные критерии —
 * одним числом.
 */
function strength(d: CascadeDecl, key: CriterionKey): number[] {
  switch (key) {
    case 'origin':
      // Все кандидаты демо — авторские, поэтому от лестницы origin остаётся одна ступенька:
      // важное сильнее обычного. Пользовательские и браузерные стили — в таблице урока.
      return [d.important ? 1 : 0];
    case 'context':
      // Одно дерево: границы shadow DOM здесь нет, критерий всегда даёт ничью.
      return [0];
    case 'inline':
      return [d.selector === null ? 1 : 0];
    case 'layer': {
      // Инлайн в слоях не участвует: спор с правилами закончился критерием раньше.
      if (d.selector === null) return [0];
      const i = layerPos(d);
      const n = props.layers.names.length;
      // Для обычных объявлений сильнее слой, объявленный позже, а unlayered сильнее всех.
      // Для важных порядок перевёрнут, и unlayered становится слабее любого слоя.
      if (!d.important) return [i === -1 ? n : i];
      return [i === -1 ? -1 : n - i];
    }
    case 'specificity':
      return d.selector === null ? [0, 0, 0] : [...d.spec];
    case 'order':
      return [orderOf(d)];
  }
}

function cmp(a: CascadeDecl, b: CascadeDecl, key: CriterionKey): number {
  const left = strength(a, key);
  const right = strength(b, key);
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}

interface Round {
  key: CriterionKey;
  survivors: CascadeDecl[];
  dropped: CascadeDecl[];
}

const rounds = computed<Round[]>(() => {
  let alive = active.value.slice();
  const result: Round[] = [];
  for (const criterion of props.criteria) {
    if (!alive.length) {
      result.push({ key: criterion.key, survivors: [], dropped: [] });
      continue;
    }
    let best = alive[0];
    for (const d of alive) if (cmp(d, best, criterion.key) > 0) best = d;
    const survivors = alive.filter((d) => cmp(d, best, criterion.key) === 0);
    result.push({ key: criterion.key, survivors, dropped: alive.filter((d) => !survivors.includes(d)) });
    alive = survivors;
  }
  return result;
});

const winner = computed(() => rounds.value[rounds.value.length - 1]?.survivors[0] ?? null);

/** Номер критерия, на котором кандидат выбыл; `null` — дожил до конца. */
function droppedAt(d: CascadeDecl): number | null {
  const i = rounds.value.findIndex((round) => round.dropped.includes(d));
  return i === -1 ? null : i;
}

// ---- Шаги ----

const stepper = useStepper(computed(() => props.criteria.length + 1));
const { index, counter, atStart, atEnd, next, prev, reset, go } = stepper;
const { playing, speed, speeds, available, toggle: togglePlay, setSpeed } = usePlayer(stepper, {
  interval: 1400,
});

/** Смена набора кандидатов начинает разбор заново: половина старого разбора к нему не относится. */
watch(active, () => reset());

const criterion = computed(() => (index.value === 0 ? null : props.criteria[index.value - 1]));

/** Состояние кандидата на текущем шаге. */
function stateOf(d: CascadeDecl): 'alive' | 'out' | 'win' {
  const at = droppedAt(d);
  if (at !== null && at < index.value) return 'out';
  if (at === null && index.value >= props.criteria.length) return 'win';
  return 'alive';
}

/** Подпись выбывшего: на каком критерии закончился его спор. Считается здесь, а не в шаблоне. */
function dropLabel(d: CascadeDecl): string {
  const at = droppedAt(d);
  if (at === null) return '';
  const criterion = props.criteria[at];
  return `выбыл · критерий ${criterion.n} · ${criterion.label}`;
}

// ---- Живая проверка ----

const target = ref<HTMLElement | null>(null);
const probe = ref<HTMLElement | null>(null);
const panel = ref<HTMLElement | null>(null);
const actual = ref('');
const expected = ref('');
/** Чей это цвет с точки зрения демо: подпись кандидата, наследование или чужое правило. */
const actualLabel = ref('');

/** Предсказание и реальность сходятся. До гидратации и измерения — `null`, а не «нет». */
const agrees = computed(() =>
  actual.value && expected.value ? actual.value === expected.value : null,
);

/**
 * ⚠️ **Измеряемое свойство не должно иметь перехода** — и однажды это демо на том и погорело.
 * У `.btn` стоял `transition: color .2s`; во время идущего перехода `getComputedStyle`
 * возвращает интерполированное значение, а не результат каскада. Замер честно читал цвет —
 * и получал прежний, потому что переход только начался: на экране элемент был уже перекрашен,
 * а строка «браузер вернул» показывала предыдущее состояние и красное «сходится: нет».
 *
 * Ирония ровно по теме урока: transition-объявления стоят на верхнем этаже лестницы origin,
 * выше любого `!important`, — то есть демо про каскад мерило не каскад, а анимацию поверх него.
 * Лечится это в стилях ниже, а не здесь: перехода на `color` у подопытного элемента нет.
 */
async function measure() {
  await nextTick();
  const node = target.value;
  const dot = probe.value;
  if (!node || !dot) return;

  actual.value = getComputedStyle(node).color;

  /** Токен → настоящий цвет: пробник красится тем же объявлением и меряется так же. */
  const resolveToken = (token: string) => {
    dot.style.color = `var(${token})`;
    return getComputedStyle(dot).color;
  };

  const won = winner.value;
  if (won) expected.value = resolveToken(won.token);
  else if (panel.value) expected.value = getComputedStyle(panel.value).color;

  // Кто из кандидатов на самом деле покрасил элемент. Если никто — значит, в спор влезло
  // правило со страницы, и сказать об этом надо прямо, а не молча показать «не сходится».
  const named = active.value.find((d) => resolveToken(d.token) === actual.value);
  dot.style.color = '';
  actualLabel.value = named
    ? named.label
    : won
      ? 'постороннее правило страницы'
      : 'наследование от родителя';
}

let sheet: HTMLStyleElement | null = null;

onMounted(() => {
  sheet = document.createElement('style');
  sheet.setAttribute('data-demo', 'cascade-referee');
  document.head.append(sheet);
  sheet.textContent = cssText.value;
  measure();
});

watch([cssText, styleAttr], () => {
  if (sheet) sheet.textContent = cssText.value;
  measure();
});

onBeforeUnmount(() => {
  sheet?.remove();
  sheet = null;
});

const specText = (d: CascadeDecl) => (d.selector === null ? 'нет' : `(${d.spec.join(',')})`);

/**
 * Тексты со строчной разметкой держим строками и выводим через `Md`: голая строка с обратными
 * кавычками, написанная прямо в шаблоне, доедет до страницы вместе с кавычками — за этим
 * следит `tests/e2e/markup.spec.ts`.
 */
const START_NOTE =
  'Все объявления `color`, какие нашлись для этого элемента. Дальше их сортируют — по одному критерию за шаг.';
const EMPTY_NOTE =
  'Ни одного объявления `color` для этого элемента. Каскад пуст — значит, включается наследование, и цвет приходит от родителя.';
const FOOTER_NOTE =
  'Правила по-настоящему вставлены в документ, инлайновые объявления — в атрибут `style` элемента, ' +
  'а цвет прочитан у браузера. Одно отличие от листинга: каждый селектор в реальной таблице стилей ' +
  'начинается с `:where(#cascade-referee-root)`, иначе демо перекрасило бы всю страницу. ' +
  'Вклад `:where()` в специфичность — `(0,0,0)`, поэтому разбор от префикса не зависит. ' +
  'И ещё одна деталь, ровно по теме урока: у подопытного элемента **нет перехода** на `color`. ' +
  'Идущий `transition` стоит на верхнем этаже лестницы origin, выше любого `!important`, — ' +
  'и `getComputedStyle` во время него вернул бы интерполированное значение вместо того, ' +
  'что выиграло каскад.';
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="controls">
        <div class="control">
          <span class="t-label">кандидаты</span>
          <div class="toggles">
            <button
              v-for="d in decls"
              :key="d.id"
              class="toggle"
              type="button"
              :aria-pressed="enabled[d.id]"
              @click="flip(d.id)"
            >
              {{ d.label }}
            </button>
          </div>
        </div>

        <PlayerToolbar
          :counter="counter"
          :index="index"
          :total="criteria.length + 1"
          :playing="playing"
          :speed="speed"
          :speeds="speeds"
          :available="available"
          :at-start="atStart"
          :at-end="atEnd"
          next-label="Критерий →"
          @toggle="togglePlay"
          @prev="prev"
          @next="next"
          @reset="reset"
          @scrub="go"
          @speed="setSpeed"
        />
      </div>
    </template>

    <div class="body">
      <div :id="ROOT" class="stage">
        <div id="panel" ref="panel" class="panel">
          <span ref="target" class="btn" :style="styleAttr">Кнопка</span>
          <span ref="probe" class="probe" aria-hidden="true" />
        </div>
        <div class="stage__note t-label">живой элемент · цвет посчитан браузером</div>
      </div>

      <div v-if="criterion" class="step" :data-final="index >= criteria.length ? 'yes' : 'no'">
        <span class="step__n">критерий {{ criterion.n }}</span>
        <div class="step__body">
          <div class="step__label">{{ criterion.label }}</div>
          <Md class="step__note" :text="criterion.note" />
        </div>
      </div>
      <div v-else class="step" data-final="no">
        <span class="step__n">шаг 0</span>
        <div class="step__body">
          <div class="step__label">кандидаты собраны</div>
          <Md class="step__note" :text="START_NOTE" />
        </div>
      </div>

      <ol class="cands">
        <li v-for="d in active" :key="d.id" class="cand" :data-state="stateOf(d)">
          <div class="cand__head">
            <span class="cand__code" data-code>{{ declText(d) }}</span>
            <span class="cand__marks">
              <span class="mark">{{ d.selector === null ? 'style=""' : d.layer ? 'слой ' + d.layer : 'вне слоёв' }}</span>
              <span class="mark">{{ specText(d) }}</span>
              <span v-if="d.important" class="mark mark--imp">!important</span>
            </span>
          </div>
          <div class="cand__verdict">
            <span v-if="stateOf(d) === 'out'" class="out">{{ dropLabel(d) }}</span>
            <span v-else-if="stateOf(d) === 'win'" class="win">победил</span>
            <span v-else class="alive">в споре</span>
          </div>
          <Md class="cand__note" :text="d.note" />
        </li>
        <li v-if="!active.length" class="empty"><Md :text="EMPTY_NOTE" /></li>
      </ol>

      <CodeListing
        label="таблица стилей демо"
        :lines="listing"
        :active="winner && index >= criteria.length ? active.indexOf(winner) + 1 : -1"
      />

      <div class="verdict">
        <div class="verdict__cell">
          <span class="t-label">разбор говорит</span>
          <span class="verdict__value">{{ winner ? winner.label : 'наследование от родителя' }}</span>
        </div>
        <div class="verdict__cell">
          <span class="t-label">браузер покрасил как</span>
          <span class="verdict__value">{{ actualLabel || '—' }}</span>
          <span class="verdict__why">{{ actual || '…' }}</span>
        </div>
        <div class="verdict__cell">
          <span class="t-label">сходится</span>
          <span class="verdict__value" :data-agrees="agrees === null ? 'wait' : agrees ? 'yes' : 'no'">
            {{ agrees === null ? '…' : agrees ? 'да' : 'нет' }}
          </span>
        </div>
      </div>
    </div>

    <template #footer>
      <Md class="disclaimer" :text="FOOTER_NOTE" />
    </template>
  </DemoFrame>
</template>

<style scoped>
.controls {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.control {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.control .t-label {
  min-width: 86px;
}
.toggles {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.toggle {
  padding: 6px 11px;
  border: 1px solid var(--border-strong);
  border-radius: var(--r-full);
  background: var(--surface);
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--chip-text);
  cursor: pointer;
  transition: all 0.15s;
}
.toggle[aria-pressed='true'] {
  border-color: var(--ink);
  background: var(--ink);
  color: var(--on-ink);
}

.body {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 22px 20px;
  min-width: 0;
}

.stage {
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 22px 20px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.panel {
  display: flex;
  align-items: center;
  gap: 10px;
  /* Родитель подопытного элемента: именно его цвет достанется наследованием, если каскад пуст. */
  color: var(--dim);
}
/* ⚠️ Здесь нет и не должно быть `transition: color`. Демо читает цвет этого элемента
   через `getComputedStyle`, а во время идущего перехода оттуда приходит интерполированное
   значение — то есть прежний цвет, пока переход не доедет. Именно так демо однажды и соврало:
   элемент был уже перекрашен победителем, а в строке «браузер вернул» стояло предыдущее
   состояние. Проверено на собранной странице: с переходом новый цвет читается только через
   ~400 мс, без перехода — сразу же. */
.btn {
  padding: 9px 16px;
  border-radius: var(--r2);
  background: var(--surface);
  box-shadow: var(--shadow-card);
  font-family: var(--mono);
  font-size: var(--fs-6);
}
.probe {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  /* Пробник нужен, чтобы перевести токен в настоящий `rgb(...)` тем же способом, каким его
     считает браузер для подопытного элемента. Видеть его читателю незачем. */
  visibility: hidden;
}
.stage__note {
  color: var(--dim);
}

.step {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 14px 16px;
  border-radius: var(--r2);
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
}
.step[data-final='yes'] {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.step__n {
  flex-shrink: 0;
  font-family: var(--mono);
  font-size: var(--fs-2);
  text-transform: uppercase;
  letter-spacing: 0.1em;
}
.step__body {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}
.step__label {
  font-size: var(--fs-6);
  font-weight: 500;
}
.step__note {
  font-size: var(--fs-5);
  line-height: 1.55;
}

.cands {
  display: flex;
  flex-direction: column;
  gap: 9px;
  margin: 0;
  padding: 0;
  list-style: none;
  min-width: 0;
}
.cand {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 13px 15px;
  border-radius: var(--r2);
  background: var(--surface);
  box-shadow: var(--shadow-card);
  transition: all 0.2s;
}
.cand[data-state='out'] {
  background: var(--sunk-dim);
  box-shadow: none;
  color: var(--dim);
}
.cand[data-state='win'] {
  box-shadow: inset 3px 0 0 var(--tone-ok-strong), var(--shadow-card);
}
.cand__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.cand__code {
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.5;
  color: var(--ink);
  overflow-wrap: anywhere;
}
.cand[data-state='out'] .cand__code {
  color: var(--dim);
}
.cand__marks {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.mark {
  padding: 2px 8px;
  border-radius: var(--r-full);
  background: var(--surface-3);
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--chip-text);
}
.mark--imp {
  background: var(--tone-err-chip);
  color: var(--tone-err-strong);
}
.cand__verdict {
  font-family: var(--mono);
  font-size: var(--fs-2);
}
.out {
  color: var(--tone-err-strong);
}
.win {
  color: var(--tone-ok-strong);
}
.alive {
  color: var(--text-faint);
}
.cand__note {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}
.empty {
  padding: 13px 15px;
  border-radius: var(--r2);
  background: var(--tone-warn-bg);
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--tone-warn-text);
}

.verdict {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(180px, 100%), 1fr));
  gap: 12px;
  padding-top: 16px;
  border-top: 1px solid var(--rule);
}
.verdict__cell {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}
.verdict__value {
  font-size: var(--fs-6);
  line-height: 1.4;
  color: var(--ink);
  overflow-wrap: anywhere;
}
.verdict__value--mono {
  font-family: var(--mono);
  font-size: var(--fs-3);
}
.verdict__why {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
  overflow-wrap: anywhere;
}
.verdict__value[data-agrees='yes'] {
  color: var(--tone-ok-strong);
}
.verdict__value[data-agrees='no'] {
  color: var(--tone-err-strong);
}
.verdict__value[data-agrees='wait'] {
  color: var(--dim);
}

.disclaimer {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}
</style>
