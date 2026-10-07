<script setup lang="ts">
/**
 * Специфичность как тройка чисел: читатель собирает селектор из кусков и смотрит, что стало
 * с разрядами и кто теперь побеждает.
 *
 * Как и в главном демо, ничего не изображается: из включённых кусков складывается настоящий
 * селектор, правило уезжает в документ **перед** правилом-соперником, и цвет ссылки читается
 * у браузера. Сумма разрядов считается по данным (у каждого куска вклад записан явно), а
 * проверка приходит не из арифметики — из того, кто победил на самом деле. Разойдётся —
 * будет видно в строке «сходится».
 *
 * ⚠️ Соперник стоит **позже**, поэтому ничья по специфичности достаётся ему. Это не деталь
 * реализации, а шестой критерий каскада, и на нём же держится вся ловушка `:where()`.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import CodeListing from '@/shared/ui/CodeListing.vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import type { Spec, SpecPiece, SpecRival } from '../model/types';

const props = defineProps<{ pieces: SpecPiece[]; rival: SpecRival; token: string }>();

const ROOT = 'specificity-lab-root';

const enabled = ref<Record<string, boolean>>(
  Object.fromEntries(props.pieces.map((p) => [p.id, p.on])),
);
const flip = (id: string) => {
  enabled.value = { ...enabled.value, [id]: !enabled.value[id] };
};

const chosen = computed(() => props.pieces.filter((p) => enabled.value[p.id]));

/**
 * Пустой селектор писать нельзя, а универсальный — можно: его вклад ровно `(0,0,0)`,
 * и это честное начало отсчёта.
 */
const selector = computed(() => (chosen.value.length ? chosen.value.map((p) => p.text).join('') : '*'));

const spec = computed<Spec>(() =>
  chosen.value.reduce<Spec>(
    (sum, p) => [sum[0] + p.spec[0], sum[1] + p.spec[1], sum[2] + p.spec[2]],
    [0, 0, 0],
  ),
);

function cmpSpec(a: Spec, b: Spec): number {
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** Ничья достаётся сопернику: он написан позже. */
const predicted = computed<'mine' | 'rival'>(() =>
  cmpSpec(spec.value, props.rival.spec) > 0 ? 'mine' : 'rival',
);

const reason = computed(() => {
  const d = cmpSpec(spec.value, props.rival.spec);
  if (d > 0) return 'критерий 5 · специфичность выше';
  if (d < 0) return 'критерий 5 · специфичность ниже';
  return 'критерий 6 · ничья по специфичности, решил порядок';
});

const cssText = computed(
  () =>
    `:where(#${ROOT}) ${selector.value} { color: var(${props.token}); }\n` +
    `:where(#${ROOT}) ${props.rival.selector} { color: var(${props.rival.token}); }`,
);

const listing = computed(() => [
  `${selector.value} { color: собранный; }`,
  `${props.rival.selector} { color: соперник; }`,
]);

// ---- Живая проверка ----

const link = ref<HTMLElement | null>(null);
const probe = ref<HTMLElement | null>(null);
const actual = ref('');
const mineColor = ref('');
const rivalColor = ref('');

const measured = computed<'mine' | 'rival' | null>(() => {
  if (!actual.value) return null;
  if (actual.value === mineColor.value) return 'mine';
  if (actual.value === rivalColor.value) return 'rival';
  return null;
});

const agrees = computed(() => (measured.value === null ? null : measured.value === predicted.value));

/**
 * ⚠️ У измеряемой ссылки не должно быть перехода на `color` — см. стили ниже. Во время идущего
 * `transition` `getComputedStyle` возвращает интерполированное значение, и замер показывает
 * прежний цвет, а не результат каскада. Соседнее демо на этом уже обожглось.
 */
async function measure() {
  await nextTick();
  const node = link.value;
  const dot = probe.value;
  if (!node || !dot) return;
  actual.value = getComputedStyle(node).color;
  dot.style.color = `var(${props.token})`;
  mineColor.value = getComputedStyle(dot).color;
  dot.style.color = `var(${props.rival.token})`;
  rivalColor.value = getComputedStyle(dot).color;
  dot.style.color = '';
}

let sheet: HTMLStyleElement | null = null;

onMounted(() => {
  sheet = document.createElement('style');
  sheet.setAttribute('data-demo', 'specificity-lab');
  document.head.append(sheet);
  sheet.textContent = cssText.value;
  measure();
});

watch(cssText, () => {
  if (sheet) sheet.textContent = cssText.value;
  measure();
});

onBeforeUnmount(() => {
  sheet?.remove();
  sheet = null;
});

const FOOTER_NOTE =
  'Оба правила действительно лежат в документе, и цвет ссылки прочитан у браузера через ' +
  '`getComputedStyle`. Служебный префикс `:where(#specificity-lab-root)` у обоих селекторов ' +
  'даёт `(0,0,0)` и на разбор не влияет. Соперник написан **позже**: при равной специфичности ' +
  'побеждает он — это шестой критерий, порядок в источнике.';
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="controls">
        <span class="t-label">куски селектора</span>
        <div class="toggles">
          <button
            v-for="p in pieces"
            :key="p.id"
            class="toggle"
            type="button"
            :data-kind="p.kind"
            :aria-pressed="enabled[p.id]"
            @click="flip(p.id)"
          >
            {{ p.text }}
          </button>
        </div>
      </div>
    </template>

    <div class="body">
      <div :id="ROOT" class="stage">
        <p class="prose">
          Абзац, внутри которого живёт
          <a
            id="lab"
            ref="link"
            class="link"
            data-state="open"
            href="#"
            @click.prevent
          >ссылка</a>. Её цвет и есть предмет спора.
        </p>
        <span ref="probe" class="probe" aria-hidden="true" />
      </div>

      <div class="counters">
        <div class="counter" v-for="(digit, i) in spec" :key="i" :data-rank="i">
          <span class="t-label">{{ ['a · идентификаторы', 'b · классы', 'c · типы'][i] }}</span>
          <span class="counter__value">{{ digit }}</span>
        </div>
        <div class="counter counter--sum">
          <span class="t-label">итого</span>
          <span class="counter__value counter__value--sum">({{ spec.join(',') }})</span>
        </div>
      </div>

      <div class="built" data-code>{{ selector }}</div>

      <ul class="pieces">
        <li v-for="p in chosen" :key="p.id" class="piece">
          <span class="piece__text" data-code>{{ p.text }}</span>
          <span class="piece__spec">+({{ p.spec.join(',') }})</span>
          <Md class="piece__note" :text="p.note" />
        </li>
        <li v-if="!chosen.length" class="piece piece--empty">
          <span class="piece__text" data-code>*</span>
          <span class="piece__spec">+(0,0,0)</span>
          <span class="piece__note">Универсальный селектор не добавляет ничего — как и комбинаторы.</span>
        </li>
      </ul>

      <CodeListing
        label="правила демо · соперник стоит позже"
        :lines="listing"
        :active="predicted === 'mine' ? 0 : 1"
      />

      <div class="verdict">
        <div class="verdict__cell">
          <span class="t-label">разбор говорит</span>
          <span class="verdict__value">{{ predicted === 'mine' ? 'собранный селектор' : 'соперник' }}</span>
          <span class="verdict__why">{{ reason }}</span>
        </div>
        <div class="verdict__cell">
          <span class="t-label">браузер покрасил как</span>
          <span class="verdict__value">
            {{ measured === null ? '—' : measured === 'mine' ? 'собранный селектор' : 'соперник' }}
          </span>
          <span class="verdict__why verdict__why--mono">{{ actual || '…' }}</span>
        </div>
        <div class="verdict__cell">
          <span class="t-label">сходится</span>
          <span class="verdict__value" :data-agrees="agrees === null ? 'wait' : agrees ? 'yes' : 'no'">
            {{ agrees === null ? '…' : agrees ? 'да' : 'нет' }}
          </span>
          <Md class="verdict__why" :text="rival.note" />
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
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.controls .t-label {
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
/* Куски, которые ничего не добавляют, помечены и в невыбранном виде: это их главная черта. */
.toggle[data-kind='zero'][aria-pressed='false'] {
  border-style: dashed;
  color: var(--dim);
}

.body {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 22px 20px;
  min-width: 0;
}

.stage {
  position: relative;
  padding: 20px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.prose {
  font-size: var(--fs-7);
  line-height: 1.6;
  color: var(--prose);
}
/* ⚠️ Переход на `color` здесь запрещён намеренно: демо читает цвет ссылки через
   `getComputedStyle`, а во время перехода оттуда приходит промежуточное значение — то есть
   цвет до спора, а не победивший. Проверено на собранной странице. */
.probe {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  visibility: hidden;
}

.counters {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(150px, 100%), 1fr));
  gap: 12px;
}
.counter {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 12px 14px;
  border-radius: var(--r2);
  background: var(--surface);
  box-shadow: var(--shadow-card);
  min-width: 0;
}
.counter__value {
  font-family: var(--mono);
  font-size: var(--fs-8);
  color: var(--ink);
}
.counter--sum {
  background: var(--tone-info-bg);
  box-shadow: none;
}
.counter__value--sum {
  color: var(--tone-info-strong);
}

.built {
  padding: 13px 15px;
  border-radius: var(--r2);
  background: var(--ink);
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--code-fg);
  overflow-wrap: anywhere;
}

.pieces {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.piece {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 10px;
  padding: 10px 13px;
  border-radius: var(--r1);
  background: var(--surface-2);
  min-width: 0;
}
.piece--empty {
  background: var(--sunk-dim);
}
.piece__text {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
  overflow-wrap: anywhere;
}
.piece__spec {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--accent);
}
.piece__note {
  flex: 1 1 220px;
  font-size: var(--fs-5);
  line-height: 1.5;
  color: var(--text-muted);
}

.verdict {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(190px, 100%), 1fr));
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
.verdict__why {
  font-size: var(--fs-4);
  line-height: 1.5;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}
.verdict__why--mono {
  font-family: var(--mono);
  font-size: var(--fs-2);
}

.disclaimer {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}
</style>
