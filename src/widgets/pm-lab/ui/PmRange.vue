<script setup lang="ts">
/**
 * Калькулятор диапазонов semver: диапазон → развёртка в сравнения → вердикт по каждой версии.
 *
 * Считает **не** таблица и не копия логики в компоненте, а строка `SEMVER_CODE`, которую тема
 * печатает выше: она приходит пропом `code` и компилируется `compileSemver`. Ту же строку
 * `tests/unit/package-managers.test.ts` сверяет с пакетом `semver` 7.8.5.
 *
 * Компиляция — в `onMounted`: до гидратации остров честно говорит, что считать пока нечем.
 */
import { computed, onMounted, ref, shallowRef } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { compileSemver } from '../model/semver';
import type { SemverApi } from '../model/semver';

const props = defineProps<{
  code: string;
  versions: string[];
  presets: { label: string; range: string }[];
}>();

const range = ref(props.presets[0]?.range ?? '^1.0.0');
const versionsText = ref(props.versions.join(' '));
const api = shallowRef<SemverApi | null>(null);
const failure = ref('');

onMounted(() => {
  try {
    api.value = compileSemver(props.code);
  } catch (error) {
    failure.value = error instanceof Error ? error.message : String(error);
  }
});

const NOTE_TEXT =
  'Считает функция `satisfies` из кода выше — та же строка, что сверена тестом темы с пакетом `semver` 7.8.5. Версии по умолчанию — все версии `c` в учебном реестре; их можно заменить своими через пробел.';

interface Row {
  version: string;
  ok: boolean;
  /** Отметка по каждому сравнению каждого набора. */
  checks: { cmp: string; pass: boolean }[][];
  /** Все сравнения какого-то набора прошли, но пререлиз отсечён отдельным правилом. */
  preCut: boolean;
  best: boolean;
}

const result = computed(() => {
  const s = api.value;
  if (!s) return null;
  try {
    const sets = s.desugar(range.value);
    const list = versionsText.value.split(/[\s,]+/).filter(Boolean);
    for (const v of list) s.compare(v, v); // бросит на «не версии» — покажем ошибку, а не мусор
    const best = s.maxSatisfying(list, range.value);
    const rows: Row[] = list.map((version) => {
      const checks = sets.map((set) => set.map((cmp) => ({ cmp, pass: s.check(version, cmp) })));
      const ok = s.satisfies(version, range.value);
      const allPass = checks.some((set) => set.every((c) => c.pass));
      return { version, ok, checks, preCut: allPass && !ok, best: version === best };
    });
    return { sets, rows, best, error: '' };
  } catch (error) {
    return { sets: [], rows: [], best: null, error: error instanceof Error ? error.message : String(error) };
  }
});

function usePreset(r: string) {
  range.value = r;
}
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="pm-range__controls">
        <label class="pm-range__field">
          <span class="t-label">диапазон</span>
          <input v-model="range" class="pm-range__input" type="text" spellcheck="false" autocomplete="off" />
        </label>
        <label class="pm-range__field">
          <span class="t-label">версии в реестре</span>
          <input v-model="versionsText" class="pm-range__input" type="text" spellcheck="false" autocomplete="off" />
        </label>
        <div class="pm-range__presets">
          <button
            v-for="p in presets"
            :key="p.range"
            type="button"
            class="pm-range__preset"
            :aria-pressed="range === p.range"
            @click="usePreset(p.range)"
          >
            <Md as="span" :text="p.label" />
          </button>
        </div>
      </div>
    </template>

    <div class="pm-range__body">
      <div v-if="failure" class="pm-range__verdict" data-tone="warn">Код не собрался: {{ failure }}</div>
      <div v-else-if="!result" class="pm-range__verdict" data-tone="idle">
        Проверка ещё не загружена — ответ появится, когда демо оживёт: считает код выше, а не заготовка.
      </div>
      <div v-else-if="result.error" class="pm-range__verdict" data-tone="warn">{{ result.error }}</div>
      <template v-else>
        <div class="pm-range__sets">
          <span class="t-label">развёртка</span>
          <div class="pm-range__chips">
            <template v-for="(set, i) in result.sets" :key="i">
              <span v-if="i > 0" class="pm-range__or">или</span>
              <span class="pm-range__set" data-code>{{ set.length ? set.join(' и ') : 'любая версия, кроме пререлизов' }}</span>
            </template>
          </div>
        </div>

        <ul class="pm-range__list">
          <li
            v-for="row in result.rows"
            :key="row.version"
            class="pm-range__row"
            :data-tone="row.ok ? 'ok' : 'err'"
            :data-best="row.best || undefined"
          >
            <span class="pm-range__ver" data-code>{{ row.version }}</span>
            <span class="pm-range__marks">
              <template v-for="(set, i) in row.checks" :key="i">
                <span v-if="i > 0" class="pm-range__or">или</span>
                <span
                  v-for="c in set"
                  :key="c.cmp"
                  class="pm-range__mark"
                  :data-pass="c.pass"
                  data-code
                >{{ c.pass ? '✓' : '✗' }} {{ c.cmp }}</span>
              </template>
            </span>
            <span class="pm-range__why">
              <template v-if="row.best">выберет менеджер — старшая подходящая</template>
              <template v-else-if="row.preCut">отсечена правилом пререлизов</template>
              <template v-else-if="row.ok">подходит</template>
              <template v-else>не подходит</template>
            </span>
          </li>
        </ul>
      </template>
    </div>

    <template #footer>
      <Md class="pm-range__note" :text="NOTE_TEXT" />
    </template>
  </DemoFrame>
</template>

<style scoped>
.pm-range__controls {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.pm-range__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.pm-range__input {
  /* У `input` шрифт и цвет свои, браузерные, — в курсе таких нет. */
  font: inherit;
  color: inherit;
  box-sizing: border-box;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--border-strong);
  border-radius: var(--r1);
  background: var(--surface);
  color: var(--ink);
  font-family: var(--mono);
  font-size: var(--fs-3);
}
.pm-range__presets {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.pm-range__preset {
  font: inherit;
  font-size: var(--fs-3);
  line-height: 1.4;
  color: var(--prose);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r1);
  padding: 6px 10px;
  cursor: pointer;
  text-align: start;
}
.pm-range__preset:hover {
  border-color: var(--tone-info-line);
}
.pm-range__preset[aria-pressed='true'] {
  border-color: var(--tone-info-line);
  background: var(--tone-info-bg);
  color: var(--ink);
}

.pm-range__body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
}
.pm-range__sets {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.pm-range__chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.pm-range__set {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--code-fg);
  background: var(--ink);
  border-radius: var(--r1);
  padding: 6px 10px;
}
.pm-range__or {
  font-size: var(--fs-3);
  color: var(--text-muted);
}

.pm-range__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.pm-range__row {
  display: grid;
  grid-template-columns: minmax(96px, 0.5fr) minmax(0, 1.6fr) minmax(0, 1fr);
  gap: 6px 14px;
  align-items: center;
  padding: 8px 12px;
  border-radius: var(--r1);
  border: 1px solid var(--border);
  background: var(--surface-2);
}
.pm-range__row[data-tone='ok'] {
  border-color: var(--tone-ok-line);
  background: var(--tone-ok-bg);
}
.pm-range__row[data-best] {
  box-shadow: inset 4px 0 0 var(--tone-ok-strong);
}
.pm-range__ver {
  font-family: var(--mono);
  font-size: var(--fs-4);
  color: var(--ink);
  font-weight: 600;
}
.pm-range__marks {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  align-items: center;
  min-width: 0;
}
.pm-range__mark {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--tone-err-text);
}
.pm-range__mark[data-pass='true'] {
  color: var(--tone-ok-text);
}
.pm-range__why {
  font-size: var(--fs-3);
  color: var(--prose);
}
.pm-range__row[data-best] .pm-range__why {
  color: var(--tone-ok-strong);
  font-weight: 600;
}

.pm-range__verdict {
  padding: 14px 16px;
  border-radius: var(--r2);
  border: 1px solid var(--border);
  background: var(--surface-2);
  font-size: var(--fs-4);
  color: var(--prose);
}
.pm-range__verdict[data-tone='warn'] {
  border-color: var(--tone-warn-line);
  background: var(--tone-warn-bg);
}
.pm-range__note {
  font-size: var(--fs-4);
  line-height: 1.55;
  color: var(--text-muted);
}

@media (max-width: 560px) {
  .pm-range__row {
    grid-template-columns: minmax(0, 1fr);
  }
}

/* Код внутри мелкой подписи: базовое `code { font-size: .86em }` уводило его ниже 11px.
   Пол — ступень `--fs-2`. */
.pm-range__preset :deep(code) {
  font-size: max(0.86em, var(--fs-2));
}
</style>
