<script setup lang="ts">
/**
 * `inherit` · `initial` · `unset` · `revert` · `revert-layer` — шесть настоящих элементов,
 * по одному на ключевое слово, и живые значения с них.
 *
 * Спор `initial` против `revert` рассказом не закрывается: надо видеть, что на одном и том же
 * `<div>` первое даёт `inline`, а второе — `block`. Поэтому виджет строит настоящую таблицу
 * стилей с двумя слоями, вешает по ключевому слову на каждый элемент и читает результат
 * `getComputedStyle` у читателя в браузере.
 *
 * Расклад одинаковый для всех трёх свойств:
 *   слой `dl-base`  — «библиотека»: к нему возвращает `revert-layer`;
 *   слой `dl-theme` — «тема»: её значение стоит, пока ключевого слова нет;
 *   родитель        — к нему ведёт `inherit`;
 *   встроенные стили браузера — к ним ведёт `revert`.
 *
 * ⚠️ Свойства нарочно не про цвет: `color: initial` — чёрный, `color: revert` на ссылке —
 * браузерный синий, и ни того ни другого в палитре курса нет. Эти два значения разобраны
 * в тексте урока таблицей, снятой запуском.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import type { DefaultProp, KeywordCopy } from '../model/types';

const props = defineProps<{ subjects: DefaultProp[]; keywords: KeywordCopy[] }>();

const ROOT = 'defaulting-lab-root';

const pickedId = ref(props.subjects[0].id);
const options = computed(() => props.subjects.map((s) => ({ value: s.id, label: s.label })));
const subject = computed(() => props.subjects.find((s) => s.id === pickedId.value) ?? props.subjects[0]);

/**
 * Таблица стилей демо. Слои объявлены один раз: порядок слоя задаётся первым упоминанием
 * имени, и переобъявление ничего уже не изменит.
 */
const cssText = computed(() => {
  const s = subject.value;
  const scope = `:where(#${ROOT})`;
  const lines = [
    '@layer dl-base, dl-theme;',
    `@layer dl-base { ${scope} .subject { ${s.id}: ${s.base}; } }`,
    `@layer dl-theme { ${scope} .subject { ${s.id}: ${s.theme}; } }`,
    `${scope} .parent { ${s.id}: ${s.parent}; }`,
  ];
  for (const kw of props.keywords) {
    if (kw.key === 'none') continue;
    lines.push(`@layer dl-theme { ${scope} .subject[data-kw="${kw.key}"] { ${s.id}: ${kw.key}; } }`);
  }
  return lines.join('\n');
});

/**
 * Собранные узлы держим **вне реактивности**, и это не мелочь стиля.
 *
 * Функция-`ref` в шаблоне вызывается на каждом рендере. Пока список узлов лежал в `ref`,
 * `setCell` читал и тут же записывал его — то есть писал в величину, прочитанную во время
 * рендера. Render-эффект от собственной записи инвалидировался заново, и компонент уходил
 * в бесконечный цикл обновлений: страница переставала отвечать **молча**, без единой ошибки
 * в консоли, потому что предупреждение «Maximum recursive updates exceeded» есть только
 * в dev-сборке, а страницы курса собраны в прод.
 *
 * Наружу светит только `values` — он и остаётся реактивным.
 */
let cells: HTMLElement[] = [];
const values = ref<Record<string, string>>({});

/**
 * Значения читаются у настоящих элементов. Пока остров не гидратирован — значений нет,
 * и показывать вместо них выдуманное нельзя: это ровно тот случай, ради которого демо
 * и существует.
 */
/**
 * ⚠️ Ни на одном из трёх измеряемых свойств не должно быть перехода: во время идущего
 * `transition` `getComputedStyle` отдаёт интерполированное значение, и демо показало бы
 * не результат defaulting, а кадр анимации. У образцов переходов нет.
 */
async function measure() {
  await nextTick();
  const next: Record<string, string> = {};
  for (const el of cells) {
    const key = el.dataset.kw;
    if (!key) continue;
    next[key] = getComputedStyle(el).getPropertyValue(subject.value.id);
  }
  values.value = next;
}

let sheet: HTMLStyleElement | null = null;

onMounted(() => {
  sheet = document.createElement('style');
  sheet.setAttribute('data-demo', 'defaulting-lab');
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

/**
 * Собранные элементы кладём в массив вручную: их состав меняется вместе со свойством.
 *
 * Запись идёт в обычный массив (см. объявление `cells` выше) — реактивной она быть не должна:
 * эта функция вызывается из шаблона на каждом рендере.
 */
const setCell = (el: unknown, key: string) => {
  const node = el as HTMLElement | null;
  cells = cells.filter((item) => item.dataset.kw !== key || item === node);
  if (node && !cells.includes(node)) cells.push(node);
};

const sourceRows = computed(() => {
  const s = subject.value;
  return [
    { k: 'слой dl-base', v: s.base },
    { k: 'слой dl-theme', v: s.theme },
    { k: 'родитель', v: s.parent },
    { k: 'встроенный стиль браузера', v: 'зависит от тега — его и показывает revert' },
  ];
});

const FOOTER_NOTE =
  'Значения не выписаны в данные, а прочитаны с элементов рядом: виджет вставляет в документ ' +
  'настоящие правила и спрашивает `getComputedStyle` у вашего браузера. Поэтому строка ' +
  '`revert` показывает встроенный стиль **вашего** движка, а не то, что помнил автор.';
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="controls">
        <span class="t-label">свойство</span>
        <SegmentedControl v-model="pickedId" class="l-pills" label="Свойство опыта" :options="options" />
      </div>
    </template>

    <div class="body">
      <Md class="lead" :text="subject.note" />

      <div :id="ROOT" class="stage">
        <div class="parent">
          <div v-for="kw in keywords" :key="kw.key" class="cell">
            <span class="cell__kw">{{ kw.label }}</span>
            <component
              :is="subject.tag"
              :ref="(el: unknown) => setCell(el, kw.key)"
              class="subject"
              :data-kw="kw.key"
              v-bind="subject.tag === 'a' ? { href: '#' } : {}"
              @click.prevent
            >
              образец
            </component>
            <span class="cell__value">{{ values[kw.key] ?? '…' }}</span>
            <Md class="cell__note" :text="kw.source" />
          </div>
        </div>
      </div>

      <div class="sources">
        <div v-for="row in sourceRows" :key="row.k" class="source">
          <span class="t-label">{{ row.k }}</span>
          <span class="source__value">{{ row.v }}</span>
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

.body {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 22px 20px;
  min-width: 0;
}
.lead {
  font-size: var(--fs-6);
  line-height: 1.6;
  color: var(--prose);
}

.stage {
  padding: 18px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
/* Родитель задаёт то, к чему ведёт `inherit`, — поэтому он настоящий, а не обёртка для вида. */
.parent {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(170px, 100%), 1fr));
  gap: 12px;
  color: var(--prose);
}
.cell {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 13px 14px;
  border-radius: var(--r2);
  background: var(--surface);
  box-shadow: var(--shadow-card);
  min-width: 0;
}
.cell__kw {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--accent);
}
.subject {
  /* Свой вид у образца минимальный: всё, что на нём видно, должно приходить из опыта. */
  font-size: var(--fs-6);
  color: var(--ink);
}
.cell__value {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--tone-info-strong);
  overflow-wrap: anywhere;
}
.cell__note {
  font-size: var(--fs-4);
  line-height: 1.5;
  color: var(--text-muted);
}

.sources {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(200px, 100%), 1fr));
  gap: 12px;
  padding-top: 16px;
  border-top: 1px solid var(--rule);
}
.source {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.source__value {
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.5;
  color: var(--ink);
  overflow-wrap: anywhere;
}

.disclaimer {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}
</style>
