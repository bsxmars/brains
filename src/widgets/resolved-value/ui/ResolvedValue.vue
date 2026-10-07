<script setup lang="ts">
/**
 * Что на самом деле возвращает `getComputedStyle`.
 *
 * Название обманывает: возвращается не computed value, а **resolved value**, и определено оно
 * отдельно для каждого свойства. Для большинства это computed; для `width`, `height`, отступов
 * и `inset` — used, то есть значение, которого до лейаута не существует. Отсюда и цена чтения.
 *
 * Демо не пересказывает это правило, а показывает его на живом элементе: объявления настоящие,
 * значения сняты `getComputedStyle` прямо на странице. Главный опыт — спрятать элемент:
 * бокса нет, брать used неоткуда, и `width` возвращается к computed, то есть к `auto`.
 * Проценты при этом остаются процентами — лейаут их так и не разрешил.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import type { ResolvedProp } from '../model/types';

const props = defineProps<{ items: ResolvedProp[]; note: string }>();

const ROOT = 'resolved-value-root';

const mode = ref('shown');
const options = [
  { value: 'shown', label: 'элемент на странице' },
  { value: 'none', label: 'display: none' },
];

const cssText = computed(() => {
  const decls = props.items.map((item) => `  ${item.name}: ${item.declared};`).join('\n');
  const hidden = mode.value === 'none' ? `:where(#${ROOT}) .subject { display: none; }` : '';
  return `:where(#${ROOT}) .subject {\n${decls}\n}\n${hidden}`;
});

const subject = ref<HTMLElement | null>(null);
const values = ref<Record<string, string>>({});

/**
 * ⚠️ У подопытного блока нет переходов, и это не стилистика: во время идущего `transition`
 * `getComputedStyle` возвращает интерполированное значение, и таблица показывала бы кадр
 * анимации вместо resolved value.
 */
async function measure() {
  await nextTick();
  const el = subject.value;
  if (!el) return;
  const cs = getComputedStyle(el);
  const next: Record<string, string> = {};
  for (const item of props.items) {
    const raw = cs.getPropertyValue(item.name);
    // Пустая строка означает «движок ничего не вернул» — показываем это как есть, а не прячем.
    next[item.name] = raw === '' ? '(пусто)' : JSON.stringify(raw);
  }
  values.value = next;
}

let sheet: HTMLStyleElement | null = null;

onMounted(() => {
  sheet = document.createElement('style');
  sheet.setAttribute('data-demo', 'resolved-value');
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
  'Значения сняты с настоящего элемента вашим браузером. Строки показаны в кавычках намеренно: ' +
  'у пользовательских свойств значением служит поток токенов, и вопрос «остаются ли в нём пробелы» ' +
  'решается не спецификацией свойства, а движком — посмотрите на строку `--gap`.';
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="controls">
        <span class="t-label">элемент</span>
        <SegmentedControl v-model="mode" class="l-pills" label="Состояние элемента" :options="options" />
      </div>
    </template>

    <div class="body">
      <div :id="ROOT" class="stage">
        <div class="host">
          <div ref="subject" class="subject">подопытный блок</div>
        </div>
        <div class="stage__note t-label">ширина контейнера — 100%, у блока объявлено width: 50%</div>
      </div>

      <div class="rows">
        <div class="row row--head">
          <span class="t-label">свойство</span>
          <span class="t-label">объявлено</span>
          <span class="t-label">вернул getComputedStyle</span>
          <span class="t-label">стадия</span>
        </div>
        <div v-for="item in items" :key="item.name" class="row" :data-stage="item.stage">
          <span class="cell cell--name">{{ item.name }}</span>
          <span class="cell cell--decl">{{ item.declared }}</span>
          <span class="cell cell--value">{{ values[item.name] ?? '…' }}</span>
          <span class="cell cell--stage">{{ item.stage === 'used' ? 'used · после лейаута' : 'computed' }}</span>
        </div>
      </div>

      <ul class="notes">
        <li v-for="item in items" :key="item.name" class="noteline">
          <span class="noteline__name">{{ item.name }}</span>
          <Md class="noteline__text" :text="item.note" />
        </li>
      </ul>

      <Md class="summary" :text="note" />
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

.stage {
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 18px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.host {
  /* Контейнер с известной шириной: без него `width: 50%` не от чего считать. */
  width: 100%;
  max-width: 360px;
  padding: 10px;
  border-radius: var(--r2);
  background: var(--surface-3);
}
.subject {
  border-radius: var(--r1);
  background: var(--surface);
  box-shadow: var(--shadow-card);
  /* Размер шрифта задан относительно — в этом и суть примера: `em` резолвится на шаге
     computed, до всякого лейаута. Основание — ступень шкалы, унаследованная от страницы. */
  font-family: var(--mono);
}
.stage__note {
  color: var(--dim);
}

.rows {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  overflow-x: auto;
}
.row {
  display: grid;
  grid-template-columns: minmax(120px, 1fr) minmax(110px, 1fr) minmax(150px, 1.2fr) minmax(150px, 1fr);
  gap: 10px;
  align-items: baseline;
  min-width: 560px;
  padding: 9px 12px;
  border-radius: var(--r1);
  background: var(--surface);
}
.row--head {
  background: none;
}
.row[data-stage='used'] {
  background: var(--tone-warn-bg);
}
.cell {
  font-size: var(--fs-5);
  line-height: 1.45;
  color: var(--ink);
  overflow-wrap: anywhere;
}
.cell--name,
.cell--decl,
.cell--value {
  font-family: var(--mono);
  font-size: var(--fs-3);
}
.cell--value {
  color: var(--tone-info-strong);
}
.row[data-stage='used'] .cell--value {
  color: var(--tone-warn-strong);
}
.cell--stage {
  font-size: var(--fs-4);
  color: var(--text-muted);
}

.notes {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.noteline {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  min-width: 0;
}
.noteline__name {
  flex-shrink: 0;
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--accent);
}
.noteline__text {
  flex: 1 1 240px;
  font-size: var(--fs-5);
  line-height: 1.5;
  color: var(--text-muted);
}

.summary {
  padding: 14px 16px;
  border-radius: var(--r2);
  background: var(--tone-info-bg);
  font-size: var(--fs-6);
  line-height: 1.6;
  color: var(--tone-info-text);
}

.disclaimer {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}
</style>
