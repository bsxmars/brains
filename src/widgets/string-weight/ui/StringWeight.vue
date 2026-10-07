<script setup lang="ts">
/**
 * Вес строки — посчитанный на машине читателя, а не взятый из таблицы урока.
 *
 * Тема утверждает, что одна нелатинская буква удваивает всю строку: «+19.1 МБ» против
 * «+38.1 МБ». Здесь это проверяется на пяти образцах сразу, и главная пара стоит первой —
 * две строки одинаковой длины, различающиеся одной буквой: в UTF-8 разница в один байт,
 * в памяти — вдвое.
 *
 * ⚠️ **Чего здесь нет и быть не может.** Внутреннее представление строки из JS не наблюдаемо:
 * `%DebugPrint` требует флага у самого бинарника, а сайт собирается статически. Столбец
 * «в памяти» — **вывод** из кодов символов по правилу «есть знак выше U+00FF — значит вся
 * строка по два байта на единицу», и так об этом написано в подвале. Правило проверено
 * запуском, разбор — в докстринге `../model/weigh.ts`.
 *
 * ⚠️ Автостарта нет: числа появляются по кнопке. Остров гидратируется по `client:visible`,
 * и стенд, посчитавший что-то до того, как читатель попросил, выглядит как таблица
 * с готовыми данными — ровно то, чем этот стенд не является.
 *
 * Считает `../model/weigh.ts` — тот же модуль зовёт юнит-тест. Здесь только показ.
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button } from '@/shared/ui';
import { WEIGHT_SAMPLES, weighAll } from '../model/weigh';
import type { WeightResult, WeightSample } from '../model/types';

const props = withDefaults(
  defineProps<{
    /** Что взвешивать. По умолчанию — набор из модели, тот же, что видит тест. */
    samples?: WeightSample[];
    /** Подпись в подвале: граница между посчитанным и выведенным. */
    note?: string;
  }>(),
  {
    samples: () => WEIGHT_SAMPLES,
    note: 'Единицы, точки, графемы и байты UTF-8 — ответы вашего движка. Столбец «в памяти» — **вывод**, а не наблюдение: внутреннее представление строки из JS не видно, и стенд получает его из кодов символов по правилу «есть знак выше U+00FF — значит два байта на единицу, на всю строку целиком».',
  },
);

const result = ref<WeightResult | null>(null);

const run = () => {
  result.value = weighAll(props.samples);
};

/** До запуска — те же строки, но с прочерками: видно, что именно будет посчитано. */
const rows = computed(() => {
  const measured = result.value;

  return props.samples.map((sample, i) => {
    const row = measured?.ok ? measured.rows[i] : null;
    const two = row?.twoByte ?? false;

    return {
      key: sample.key,
      label: sample.label,
      value: sample.value,
      note: sample.note,
      tone: row ? (two ? 'err' : 'ok') : 'idle',
      units: row ? String(row.units) : '—',
      points: row ? String(row.points) : '—',
      graphemes: row ? String(row.graphemes) : '—',
      utf8: row ? String(row.utf8) : '—',
      storage: row ? String(row.storage) : '—',
      perUnit: row ? row.bytesPerUnit.toFixed(2) : '—',
      kind: row ? (two ? 'два байта на единицу' : 'один байт на единицу') : 'пока не считали',
      why: row
        ? two
          ? `выше U+00FF: ${row.culprit} — U+${row.culpritHex}`
          : 'все коды ≤ U+00FF'
        : '',
    };
  });
});

/**
 * Приговор по главной паре: две строки одной длины, разошедшиеся вдвое.
 *
 * Считается по первым двум образцам и только если их длины действительно совпали —
 * иначе сравнение потеряло бы смысл, а текст остался бы убедительным.
 */
const headline = computed(() => {
  const measured = result.value;
  if (!measured?.ok || measured.rows.length < 2) return '';

  const [plain, mixed] = measured.rows;
  if (plain.units !== mixed.units) return '';

  return `Одинаковая длина: ${plain.units} кодовых единиц у обеих. В UTF-8 разница в ${mixed.utf8 - plain.utf8} байт, в памяти — ${plain.storage} против ${mixed.storage}, то есть вдвое.`;
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="sw-bar">
        <Button variant="primary" @click="run">
          {{ result ? 'взвесить ещё раз' : 'взвесить' }}
        </Button>
        <span v-if="!result" class="sw-hint">числа появятся после запуска — их считает ваш браузер</span>
        <span v-else-if="!result.ok" class="sw-hint">взвесить не удалось</span>
      </div>
    </template>

    <div class="sw-body">
      <div v-if="result && !result.ok" class="sw-verdict" data-tone="warn">
        <Md :text="result.note" />
      </div>

      <div class="sw-rows">
        <section v-for="row in rows" :key="row.key" class="sw-row" :data-tone="row.tone">
          <header class="sw-row__head">
            <span class="sw-row__label">{{ row.label }}</span>
            <span class="sw-row__glyph">{{ row.value }}</span>
          </header>

          <dl class="sw-metrics">
            <div class="sw-metric">
              <dt class="sw-metric__key">length</dt>
              <dd class="sw-metric__value">{{ row.units }}</dd>
            </div>
            <div class="sw-metric">
              <dt class="sw-metric__key">кодовых точек</dt>
              <dd class="sw-metric__value">{{ row.points }}</dd>
            </div>
            <div class="sw-metric">
              <dt class="sw-metric__key">графем</dt>
              <dd class="sw-metric__value">{{ row.graphemes }}</dd>
            </div>
            <div class="sw-metric">
              <dt class="sw-metric__key">байт в UTF-8</dt>
              <dd class="sw-metric__value">{{ row.utf8 }}</dd>
            </div>
            <div class="sw-metric sw-metric--inferred">
              <dt class="sw-metric__key">байт в памяти</dt>
              <dd class="sw-metric__value">{{ row.storage }}</dd>
            </div>
            <div class="sw-metric sw-metric--inferred">
              <dt class="sw-metric__key">байт на символ</dt>
              <dd class="sw-metric__value">{{ row.perUnit }}</dd>
            </div>
          </dl>

          <div class="sw-kind">
            <span class="sw-kind__what">{{ row.kind }}</span>
            <span v-if="row.why" class="sw-kind__why">{{ row.why }}</span>
          </div>

          <Md class="sw-row__note" :text="row.note" />
        </section>
      </div>

      <div v-if="headline" class="sw-verdict" data-tone="err">{{ headline }}</div>

      <Md v-if="result?.ok" class="sw-source" :text="result.note" />
    </div>

    <template #footer>
      <Md class="sw-foot" :text="note" />
    </template>
  </DemoFrame>
</template>

<style scoped>
.sw-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}
.sw-hint {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}

.sw-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
}

.sw-rows {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sw-row {
  display: flex;
  flex-direction: column;
  gap: 11px;
  padding: 15px 16px;
  border: 1px solid var(--border);
  border-radius: var(--r3);
  background: var(--surface-2);
  min-width: 0;
  transition: all 0.2s;
}
.sw-row[data-tone='ok'] {
  border-color: var(--tone-ok-line);
  background: var(--tone-ok-bg);
}
.sw-row[data-tone='err'] {
  border-color: var(--tone-err-line);
  background: var(--tone-err-bg);
}

.sw-row__head {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}
.sw-row__label {
  font-family: var(--mono);
  font-size: var(--fs-3);
  font-weight: 600;
  color: var(--ink);
}
.sw-row__glyph {
  font-family: var(--mono);
  font-size: var(--fs-5);
  line-height: 1.4;
  overflow-wrap: anywhere;
  color: var(--prose);
}

.sw-metrics {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(112px, 100%), 1fr));
  gap: 7px;
  margin: 0;
}
.sw-metric {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r1);
  background: var(--surface);
  min-width: 0;
}
/* Выведенное отделено от посчитанного: у него своя подложка и пунктирная рамка. */
.sw-metric--inferred {
  border-style: dashed;
  border-color: var(--border-strong);
  background: var(--sunk-dim);
}
.sw-metric__key {
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.35;
  overflow-wrap: anywhere;
  color: var(--text-faint);
}
.sw-metric__value {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--fs-6);
  font-weight: 600;
  color: var(--ink);
}

.sw-kind {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}
.sw-kind__what {
  padding: 3px 10px;
  border-radius: var(--r-full);
  font-family: var(--mono);
  font-size: var(--fs-2);
  font-weight: 600;
  white-space: nowrap;
}
.sw-row[data-tone='ok'] .sw-kind__what {
  background: var(--tone-ok-chip);
  color: var(--tone-ok-text);
}
.sw-row[data-tone='err'] .sw-kind__what {
  background: var(--tone-err-chip);
  color: var(--tone-err-text);
}
.sw-row[data-tone='idle'] .sw-kind__what {
  background: var(--sunk-dim);
  color: var(--dim);
}
.sw-kind__why {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}

.sw-row__note {
  font-size: var(--fs-4);
  line-height: 1.55;
  color: var(--text-muted);
}

.sw-verdict {
  padding: 12px 14px;
  border-radius: var(--r2);
  font-size: var(--fs-5);
  line-height: 1.55;
}
.sw-verdict[data-tone='err'] {
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}
.sw-verdict[data-tone='warn'] {
  border: 1px solid var(--tone-warn-line);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}

.sw-source {
  font-size: var(--fs-4);
  line-height: 1.5;
  color: var(--dim);
}

.sw-foot {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}
</style>
