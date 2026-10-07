<script setup lang="ts">
/**
 * `this` в колбэке: восемь способов передать метод — и настоящий ответ на каждый.
 *
 * Раньше демо показывало строку из `data.ts`: автор написал «undefined → TypeError», читатель
 * поверил. Теперь случай **исполняется**, а в `this` заглядывает сам подопытный метод и
 * записывает то, что ему пришло. Разница не косметическая: в разделе восемь утверждений
 * о семантике языка, и ни одно из них больше не держится на памяти автора.
 *
 * Ключ к теме остался прежним — средняя панель «точка вызова внутри чужого кода». `this`
 * вычисляется по ней, а не по месту, где функция написана; поставив варианты рядом, видно,
 * что меняется именно точка вызова, а всё остальное — следствие.
 *
 * Считает не компонент, а `model/run.ts`: тот же модуль читает юнит-тест, и страница с тестом
 * разойтись не могут. Здесь только показ.
 *
 * Прогон идёт в `onMounted` и на каждую смену переключателя. Это не перестраховка: два случая
 * из восьми трогают DOM (создают элемент, вешают слушатель, кликают), а остров сперва
 * рендерится в Node — на сервере такой прогон уронил бы сборку всей страницы.
 *
 * Переключатель — радиогруппа: восемь вариантов читаются стрелками с клавиатуры, и состояние
 * «выбрано 3 из 8» объявляется скринридером. В оригинале это были восемь `<button>`.
 */
import { computed, onMounted, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import CodeListing from '@/shared/ui/CodeListing.vue';
import ConsoleView from '@/shared/ui/ConsoleView.vue';
import { SegmentedControl } from '@/shared/ui';
import { THIS_CASES } from '../model/cases';
import { runThisCase } from '../model/run';
import type { ThisCaseKey, ThisOption, ThisRun } from '../model/types';

/**
 * ⚠️ `options` больше не читается. Проп оставлен принятым, чтобы вставка урока
 * `<ThisInCallback options={THIS_OPTIONS} />` продолжала собираться: ответы теперь вычисляются,
 * и данные случаев живут в `model/cases.ts`. Из `index.mdx` его можно убрать.
 */
defineProps<{ options?: ThisOption[] }>();

const picked = ref<ThisCaseKey>(THIS_CASES[0].key);
const choices = THIS_CASES.map((item) => ({ value: item.key, label: item.label }));

const run = ref<ThisRun | null>(null);
const refresh = () => {
  run.value = runThisCase(picked.value);
};

onMounted(refresh);
watch(picked, refresh);

/** Строка вердикта: её собирает не автор, а исход прогона. */
const headline = computed(() => {
  if (!run.value) return '';
  if (run.value.verdict === 'err') return 'this потерян — вызов упал';
  if (run.value.verdict === 'warn') return 'this есть, но чужой';
  return 'объект на месте';
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="bar">
        <SegmentedControl v-model="picked" class="l-pills" label="Способ передать метод" :options="choices" />
        <span class="bar__note">считает ваш браузер прямо сейчас</span>
      </div>
    </template>

    <div v-if="run" class="split">
      <div class="pane">
        <CodeListing :lines="run.code" label="что исполнилось" />

        <div class="cell">
          <div class="t-label">точка вызова внутри чужого кода</div>
          <div class="site">{{ run.site }}</div>
        </div>

        <ConsoleView
          label="что вернул вызов"
          :lines="[run.read, run.returned]"
          :min-height="64"
        />
      </div>

      <div class="pane pane--right">
        <div class="cell">
          <div class="t-label">this внутри колбэка</div>
          <div class="value" :data-tone="run.verdict">{{ run.thisValue }}</div>
          <div class="headline" :data-tone="run.verdict">{{ headline }}</div>
        </div>

        <div v-if="run.error" class="cell">
          <div class="t-label">{{ run.errorName }} — дословно от движка</div>
          <div class="error">{{ run.error }}</div>
        </div>

        <div v-if="run.sloppy" class="cell">
          <div class="t-label">то же самое вне strict</div>
          <div class="value value--small" data-tone="warn">{{ run.sloppy.thisValue }}</div>
          <div class="sloppy">{{ run.sloppy.read }} · вызов вернул {{ run.sloppy.returned }}</div>
        </div>

        <p v-if="!run.ranInDom" class="wait">Случай требует DOM — здесь его нет.</p>

        <Md class="note" :text="run.note" />
        <Md v-if="run.extra" class="extra" :text="run.extra" />
        <Md class="cost" :text="run.cost" />
      </div>
    </div>

    <p v-else class="wait">случаи выполняются в вашем браузере…</p>
  </DemoFrame>
</template>

<style scoped>
.bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}
.bar__note {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-faint);
}

.split {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(290px, 100%), 1fr));
}
.pane {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
  border-right: 1px solid var(--divider);
  min-width: 0;
}
.pane--right {
  gap: 16px;
  border-right: 0;
  background: var(--surface-2);
}

.cell {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.site {
  padding: 11px 13px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--surface-2);
  font-family: var(--mono);
  font-size: var(--fs-4);
  color: var(--chip-text);
}
.pane--right .site {
  background: var(--surface);
}

.value {
  padding: 12px 14px;
  border-radius: var(--r2);
  font-family: var(--mono);
  font-size: var(--fs-5);
  overflow-wrap: anywhere;
  transition: all 0.2s;
}
.value--small {
  font-size: var(--fs-3);
}
.value[data-tone='ok'] {
  background: var(--tone-ok-bg);
  border: 1px solid var(--tone-ok-line);
  color: var(--tone-ok-strong);
}
.value[data-tone='warn'] {
  background: var(--tone-warn-bg);
  border: 1px solid var(--tone-warn-line);
  color: var(--tone-warn-strong);
}
.value[data-tone='err'] {
  background: var(--tone-err-bg);
  border: 1px solid var(--tone-err-line);
  color: var(--tone-err-strong);
}

.headline {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.headline[data-tone='ok'] {
  color: var(--tone-ok-strong);
}
.headline[data-tone='warn'] {
  color: var(--tone-warn-strong);
}
.headline[data-tone='err'] {
  color: var(--tone-err-strong);
}

/* Текст исключения дословный, поэтому моно и с переносом в любом месте: он длинный. */
.error {
  padding: 11px 13px;
  border: 1px solid var(--tone-err-line);
  border-radius: var(--r2);
  background: var(--tone-err-bg);
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.5;
  color: var(--tone-err-text);
  overflow-wrap: anywhere;
}

.sloppy {
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.5;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

.note {
  font-size: var(--fs-6);
  line-height: 1.6;
  color: var(--prose);
}

/* Факт, добытый прогоном рядом с основным: список методов, отписка, собственное поле. */
.extra {
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--surface);
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--ink);
  overflow-wrap: anywhere;
}

/* Цена всегда янтарная: у каждого работающего способа она есть, и это не ошибка. */
.cost {
  padding: 12px 14px;
  border: 1px solid var(--tone-warn-line);
  border-radius: var(--r2);
  background: var(--tone-warn-bg);
  font-size: var(--fs-6);
  line-height: 1.55;
  color: var(--tone-warn-text);
}

.wait {
  margin: 0;
  padding: 20px;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--dim);
}
.pane--right .wait {
  padding: 0;
}

@media (max-width: 720px) {
  .pane {
    border-right: 0;
    border-bottom: 1px solid var(--divider);
  }
}
</style>
